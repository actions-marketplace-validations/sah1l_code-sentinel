import * as core from '@actions/core';
import type { SentinelConfig } from '../config/schema.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import { OllamaProvider } from './ollama.js';
import { OpenAIProvider } from './openai.js';
import type { LLMProvider } from './types.js';

export function createLLMProvider(config: SentinelConfig): LLMProvider {
  const { provider, model, base_url } = config.llm;

  switch (provider) {
    case 'openai': {
      const apiKey = core.getInput('openai_api_key');

      if (!apiKey) {
        throw new Error(
          'OpenAI API key is required. Set the openai_api_key input in your workflow.'
        );
      }

      return new OpenAIProvider(apiKey, model || 'gpt-4o');
    }

    case 'ollama': {
      const baseUrl = base_url || core.getInput('ollama_base_url') || 'http://localhost:11434';
      const ollamaModel = model || core.getInput('ollama_model') || 'codellama:13b';

      return new OllamaProvider(baseUrl, ollamaModel);
    }

    case 'anthropic': {
      const apiKey = core.getInput('anthropic_api_key');

      if (!apiKey) {
        throw new Error(
          'Anthropic API key is required. Set the anthropic_api_key input in your workflow.'
        );
      }

      return new AnthropicProvider(apiKey, model || 'claude-sonnet-4-20250514');
    }

    case 'gemini': {
      const apiKey = core.getInput('gemini_api_key');

      if (!apiKey) {
        throw new Error(
          'Gemini API key is required. Set the gemini_api_key input in your workflow.'
        );
      }

      return new GeminiProvider(apiKey, model || 'gemini-2.0-flash');
    }

    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}
