// Created by Claude AI Agent
import * as core from '@actions/core';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { buildReviewPrompt, getSystemPrompt } from '../prompts/review.js';
import type { LLMProvider, ReviewRequest, ReviewResponse } from './types.js';

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  private client: GoogleGenerativeAI;
  private model: string;

  constructor(apiKey: string, model = 'gemini-2.0-flash') {
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = model;
  }

  async analyze(request: ReviewRequest): Promise<ReviewResponse> {
    const systemPrompt = getSystemPrompt();
    const userPrompt = buildReviewPrompt(request);

    core.info(`Sending review request to Gemini (${this.model})...`);
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
