// Created by Claude AI Agent
import * as core from '@actions/core';
import { GoogleGenerativeAI, type Part, SchemaType } from '@google/generative-ai';
import {
  buildReviewPrompt,
  getDeepReviewSystemPrompt,
  getSystemPrompt,
} from '../prompts/review.js';
import { type ToolCall, type ToolName, getGeminiTools } from '../tools/definitions.js';
import type { ToolExecutor } from '../tools/executor.js';
import type { LLMProvider, ReviewRequest, ReviewResponse } from './types.js';

/** Maximum number of tool-use iterations */
const MAX_TOOL_ITERATIONS = 10;

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  private client: GoogleGenerativeAI;
  private model: string;
  private toolExecutor?: ToolExecutor;

  constructor(apiKey: string, model = 'gemini-2.0-flash') {
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = model;
  }

  setToolExecutor(executor: ToolExecutor): void {
    this.toolExecutor = executor;
  }

  async analyze(request: ReviewRequest): Promise<ReviewResponse> {
    // Use deep mode with tools if enabled and executor is available
    if (request.reviewMode === 'deep' && this.toolExecutor) {
      return this.analyzeWithTools(request);
    }
    return this.analyzeQuick(request);
  }

  private async analyzeQuick(request: ReviewRequest): Promise<ReviewResponse> {
    const systemPrompt = getSystemPrompt();
    const userPrompt = buildReviewPrompt(request);

    core.info(`Sending review request to Gemini (${this.model}) - quick mode...`);
    core.debug(`Prompt length: ${userPrompt.length} characters`);

    try {
      const generativeModel = this.client.getGenerativeModel({
        model: this.model,
        systemInstruction: systemPrompt,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      });

      const result = await generativeModel.generateContent(userPrompt);
      const response = result.response;
      const content = response.text();

      if (!content) {
        throw new Error('Empty response from Gemini');
      }

      core.debug(`Gemini response: ${content.substring(0, 500)}...`);

      // Extract JSON from response (may be wrapped in markdown code blocks)
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      const jsonString = jsonMatch[1]?.trim() || content.trim();

      const parsed = JSON.parse(jsonString) as ReviewResponse;

      return this.validateResponse(parsed);
    } catch (error) {
      if (error instanceof Error) {
        core.error(`Gemini API error: ${error.message}`);
        throw new Error(`Gemini API error: ${error.message}`);
      }
      throw error;
    }
  }

  private async analyzeWithTools(request: ReviewRequest): Promise<ReviewResponse> {
    const systemPrompt = getDeepReviewSystemPrompt();
    const userPrompt = buildReviewPrompt(request);
    const tools = getGeminiTools();

    core.info(`Sending review request to Gemini (${this.model}) - deep mode with tools...`);

    try {
      // Convert tool definitions to Gemini's FunctionDeclaration format
      const functionDeclarations = tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: {
          type: SchemaType.OBJECT,
          properties: Object.fromEntries(
            Object.entries(t.parameters.properties).map(([key, value]) => [
              key,
              { type: SchemaType.STRING, description: value.description },
            ])
          ),
          required: t.parameters.required,
        },
      }));

      const generativeModel = this.client.getGenerativeModel({
        model: this.model,
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
        },
      });

      const chat = generativeModel.startChat();
      let iterations = 0;

      // Send initial message
      let result = await chat.sendMessage(userPrompt);

      while (iterations < MAX_TOOL_ITERATIONS) {
        iterations++;
        core.debug(`Tool iteration ${iterations}/${MAX_TOOL_ITERATIONS}`);

        const response = result.response;
        const candidate = response.candidates?.[0];

        if (!candidate) {
          throw new Error('No candidate in Gemini response');
        }

        // Check for function calls
        const functionCalls = candidate.content.parts.filter(
          (
            part
          ): part is Part & { functionCall: { name: string; args: Record<string, unknown> } } =>
            'functionCall' in part
        );

        // If no function calls, we're done
        if (functionCalls.length === 0) {
          const textPart = candidate.content.parts.find(
            (part): part is Part & { text: string } => 'text' in part
          );

          if (!textPart) {
            throw new Error('No text response from Gemini');
          }

          const jsonMatch = textPart.text.match(/```(?:json)?\s*([\s\S]*?)```/) || [
            null,
            textPart.text,
          ];
          const jsonString = jsonMatch[1]?.trim() || textPart.text.trim();
          const parsed = JSON.parse(jsonString) as ReviewResponse;

          core.info(`Deep review completed after ${iterations} iteration(s)`);
          return this.validateResponse(parsed);
        }

        // Execute function calls
        const functionResponses: Part[] = [];

        for (const fc of functionCalls) {
          const toolCall: ToolCall = {
            id: fc.functionCall.name,
            name: fc.functionCall.name as ToolName,
            arguments: fc.functionCall.args,
          };

          core.info(`Executing tool: ${toolCall.name}`);
          const toolResult = await this.toolExecutor?.execute(toolCall);

          functionResponses.push({
            functionResponse: {
              name: fc.functionCall.name,
              response: {
                result: toolResult.error ? `Error: ${toolResult.error}` : toolResult.result,
              },
            },
          });
        }

        // Send function responses back
        result = await chat.sendMessage(functionResponses);
      }

      throw new Error(`Max tool iterations (${MAX_TOOL_ITERATIONS}) exceeded`);
    } catch (error) {
      if (error instanceof Error) {
        core.error(`Gemini API error: ${error.message}`);
        throw new Error(`Gemini API error: ${error.message}`);
      }
      throw error;
    }
  }

  private validateResponse(response: unknown): ReviewResponse {
    const r = response as ReviewResponse;

    if (!r.summary || typeof r.summary !== 'string') {
      r.summary = 'Unable to generate summary.';
    }

    if (!r.effortScore || typeof r.effortScore !== 'number') {
      r.effortScore = 3;
    }

    r.effortScore = Math.max(1, Math.min(5, Math.round(r.effortScore))) as 1 | 2 | 3 | 4 | 5;

    if (!Array.isArray(r.issues)) {
      r.issues = [];
    }

    r.issues = r.issues.filter(
      (issue) =>
        issue &&
        typeof issue.severity === 'string' &&
        typeof issue.category === 'string' &&
        typeof issue.file === 'string' &&
        typeof issue.title === 'string' &&
        typeof issue.description === 'string'
    );

    return r;
  }
}
