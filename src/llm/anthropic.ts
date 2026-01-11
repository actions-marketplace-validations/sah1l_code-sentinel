// Created by Claude AI Agent
import * as core from '@actions/core';
import Anthropic from '@anthropic-ai/sdk';
import { buildReviewPrompt, getSystemPrompt } from '../prompts/review.js';
import type { LLMProvider, ReviewRequest, ReviewResponse } from './types.js';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = 'claude-sonnet-4-20250514') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async analyze(request: ReviewRequest): Promise<ReviewResponse> {
    const systemPrompt = getSystemPrompt();
    const userPrompt = buildReviewPrompt(request);

    core.info(`Sending review request to Anthropic (${this.model})...`);
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
