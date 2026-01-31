import * as core from '@actions/core';
import OpenAI from 'openai';
import {
  buildReviewPrompt,
  getDeepReviewSystemPrompt,
  getSystemPrompt,
} from '../prompts/review.js';
import { type ToolCall, type ToolName, getOpenAITools } from '../tools/definitions.js';
import type { ToolExecutor } from '../tools/executor.js';
import type { LLMProvider, ReviewRequest, ReviewResponse } from './types.js';

/** Maximum number of tool-use iterations */
const MAX_TOOL_ITERATIONS = 10;

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private client: OpenAI;
  private model: string;
  private toolExecutor?: ToolExecutor;

  constructor(apiKey: string, model = 'gpt-4o') {
    this.client = new OpenAI({ apiKey });
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

    core.info(`Sending review request to OpenAI (${this.model}) - quick mode...`);
    core.debug(`Prompt length: ${userPrompt.length} characters`);

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 4096,
      });

      const content = response.choices[0]?.message?.content;

      if (!content) {
        throw new Error('Empty response from OpenAI');
      }

      core.debug(`OpenAI response: ${content.substring(0, 500)}...`);

      const parsed = JSON.parse(content) as ReviewResponse;

      return this.validateResponse(parsed);
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        core.error(`OpenAI API error: ${error.message}`);
        throw new Error(`OpenAI API error: ${error.message}`);
      }
      throw error;
    }
  }

  private async analyzeWithTools(request: ReviewRequest): Promise<ReviewResponse> {
    const systemPrompt = getDeepReviewSystemPrompt();
    const userPrompt = buildReviewPrompt(request);
    const tools = getOpenAITools();

    core.info(`Sending review request to OpenAI (${this.model}) - deep mode with tools...`);

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
    let iterations = 0;

    try {
      while (iterations < MAX_TOOL_ITERATIONS) {
        iterations++;
        core.debug(`Tool iteration ${iterations}/${MAX_TOOL_ITERATIONS}`);

        const response = await this.client.chat.completions.create({
          model: this.model,
          messages,
          tools,
          temperature: 0.1,
          max_tokens: 4096,
        });

        const choice = response.choices[0];
        if (!choice) {
          throw new Error('No response choice from OpenAI');
        }

        const message = choice.message;

        // Check if we're done (no more tool calls)
        if (choice.finish_reason === 'stop' || !message.tool_calls?.length) {
          if (!message.content) {
            throw new Error('No content in final response');
          }

          // Try to parse JSON from response
          const jsonMatch = message.content.match(/```(?:json)?\s*([\s\S]*?)```/) || [
            null,
            message.content,
          ];
          const jsonString = jsonMatch[1]?.trim() || message.content.trim();
          const parsed = JSON.parse(jsonString) as ReviewResponse;

          core.info(`Deep review completed after ${iterations} iteration(s)`);
          return this.validateResponse(parsed);
        }

        // Handle tool calls
        messages.push(message);

        for (const toolCallMsg of message.tool_calls) {
          const toolCall: ToolCall = {
            id: toolCallMsg.id,
            name: toolCallMsg.function.name as ToolName,
            arguments: JSON.parse(toolCallMsg.function.arguments),
          };

          core.info(`Executing tool: ${toolCall.name}`);
          const result = await this.toolExecutor?.execute(toolCall);

          messages.push({
            role: 'tool',
            tool_call_id: toolCallMsg.id,
            content: result.error ? `Error: ${result.error}` : result.result,
          });
        }
      }

      throw new Error(`Max tool iterations (${MAX_TOOL_ITERATIONS}) exceeded`);
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        core.error(`OpenAI API error: ${error.message}`);
        throw new Error(`OpenAI API error: ${error.message}`);
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
