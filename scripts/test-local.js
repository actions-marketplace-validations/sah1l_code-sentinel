#!/usr/bin/env node
/**
 * Local test script for code-sentinel GitHub Action
 *
 * Usage:
 *   node scripts/test-local.js
 *
 * Prerequisites:
 *   1. Set environment variables (see below)
 *   2. Run from a git repository with a PR context
 *
 * Environment variables:
 *   - GITHUB_TOKEN: Your GitHub personal access token
 *   - OPENAI_API_KEY or ANTHROPIC_API_KEY or GEMINI_API_KEY: LLM provider key
 *   - INPUT_DRY_RUN: Set to 'true' to skip posting comments
 */

// Mock GitHub Actions environment
process.env.GITHUB_ACTIONS = 'true';

// Set required inputs (prefix with INPUT_)
process.env.INPUT_GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
process.env.INPUT_DRY_RUN = process.env.INPUT_DRY_RUN || 'true';

// LLM provider keys (set the one you want to use)
if (process.env.OPENAI_API_KEY) {
  process.env.INPUT_OPENAI_API_KEY = process.env.OPENAI_API_KEY;
}
if (process.env.ANTHROPIC_API_KEY) {
  process.env.INPUT_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
}
if (process.env.GEMINI_API_KEY) {
  process.env.INPUT_GEMINI_API_KEY = process.env.GEMINI_API_KEY;
}

// Mock GitHub context - you can customize these for your test
process.env.GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY || 'sah1l/code-sentinel';
process.env.GITHUB_EVENT_NAME = 'pull_request';
process.env.GITHUB_EVENT_PATH = process.env.GITHUB_EVENT_PATH || '';

// Create a mock event payload if not provided
if (!process.env.GITHUB_EVENT_PATH) {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');

  const mockEvent = {
    action: 'opened',
    number: 1,
    pull_request: {
      number: 1,
      head: { sha: 'test-sha', ref: 'test-branch' },
      base: { sha: 'main-sha', ref: 'main' },
      title: 'Test PR',
      body: 'Test PR description',
    },
    repository: {
      owner: { login: 'sah1l' },
      name: 'code-sentinel',
      full_name: 'sah1l/code-sentinel',
    },
  };

  const eventPath = path.join(os.tmpdir(), 'github-event.json');
  fs.writeFileSync(eventPath, JSON.stringify(mockEvent, null, 2));
  process.env.GITHUB_EVENT_PATH = eventPath;

  console.log('📋 Created mock event at:', eventPath);
}

console.log('🚀 Starting local test of code-sentinel...');
console.log('📝 Dry run:', process.env.INPUT_DRY_RUN);
console.log('📦 Repository:', process.env.GITHUB_REPOSITORY);
console.log('');

// Run the action
require('../dist/index.js');
