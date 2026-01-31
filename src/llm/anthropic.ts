// Created by Claude AI Agent
import * as core from '@actions/core';
import Anthropic from '@anthropic-ai/sdk';
import {
  buildReviewPrompt,
  getDeepReviewSystemPrompt,
  getSystemPrompt,
} from '../prompts/review.js';
import { type ToolCall, type ToolName, getAnthropicTools } from '../tools/definitions.js';
import type { ToolExecutor } from '../tools/executor.js';
import type { LLMProvider, ReviewRequest, ReviewResponse } from './types.js';

/** Maximum number of tool-use iterations */
const MAX_TOOL_ITERATIONS = 10;

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private client: Anthropic;
  private model: string;
  private toolExecutor?: ToolExecutor;

  constructor(apiKey: string, model = 'claude-sonnet-4-20250514') {
    this.client = new Anthropic({ apiKey });
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

    core.info(`Sending review request to Anthropic (${this.model}) - quick mode...`);
    core.debug(`Prompt length: ${userPrompt.length} characters`);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const content = response.content[0];

      if (!content || content.type !== 'text') {
        throw new Error('Empty response from Anthropic');
      }

      core.debug(`Anthropic response: ${content.text.substring(0, 500)}...`);

      // Extract JSON from response (may be wrapped in markdown code blocks)
      const jsonMatch = content.text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content.text];
      const jsonString = jsonMatch[1]?.trim() || content.text.trim();

      const parsed = JSON.parse(jsonString) as ReviewResponse;

      return this.validateResponse(parsed);
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        core.error(`Anthropic API error: ${error.message}`);
        throw new Error(`Anthropic API error: ${error.message}`);
      }
      throw error;
    }
  }

  private async analyzeWithTools(request: ReviewRequest): Promise<ReviewResponse> {
    const systemPrompt = getDeepReviewSystemPrompt();
    const userPrompt = buildReviewPrompt(request);
    const tools = getAnthropicTools();

    core.info(`Sending review request to Anthropic (${this.model}) - deep mode with tools...`);

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userPrompt }];
    let iterations = 0;

    try {
      while (iterations < MAX_TOOL_ITERATIONS) {
        iterations++;
        core.debug(`Tool iteration ${iterations}/${MAX_TOOL_ITERATIONS}`);

        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 4096,
          system: systemPrompt,
          tools,
          messages,
        });

        // Check if we're done (no more tool calls)
        if (response.stop_reason === 'end_turn') {
          // Extract text response
          const textContent = response.content.find((c) => c.type === 'text');
          if (!textContent || textContent.type !== 'text') {
            throw new Error('No text response from Anthropic');
          }

          const jsonMatch = textContent.text.match(/```(?:json)?\s*([\s\S]*?)```/) || [
            null,
            textContent.text,
          ];
          const jsonString = jsonMatch[1]?.trim() || textContent.text.trim();
          const parsed = JSON.parse(jsonString) as ReviewResponse;

          core.info(`Deep review completed after ${iterations} iteration(s)`);
          return this.validateResponse(parsed);
        }

        // Handle tool use
        if (response.stop_reason === 'tool_use') {
          const toolUseBlocks = response.content.filter((c) => c.type === 'tool_use');

          if (toolUseBlocks.length === 0) {
            throw new Error('Tool use indicated but no tool calls found');
          }

          // Add assistant's response to messages
          messages.push({ role: 'assistant', content: response.content });

          // Execute tools and collect results
          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const block of toolUseBlocks) {
            if (block.type !== 'tool_use') continue;

            const toolCall: ToolCall = {
              id: block.id,
              name: block.name as ToolName,
              arguments: block.input as Record<string, unknown>,
            };

            core.info(`Executing tool: ${toolCall.name}`);
            if (!this.toolExecutor) {
              throw new Error('Tool executor not available');
            }
            const result = await this.toolExecutor.execute(toolCall);

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result.error ? `Error: ${result.error}` : result.result,
              is_error: !!result.error,
            });
          }

          // Add tool results to messages
          messages.push({ role: 'user', content: toolResults });
        }
      }

      throw new Error(`Max tool iterations (${MAX_TOOL_ITERATIONS}) exceeded`);
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        core.error(`Anthropic API error: ${error.message}`);
        throw new Error(`Anthropic API error: ${error.message}`);
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
