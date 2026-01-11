import * as fs from 'node:fs';
import * as path from 'node:path';
import * as core from '@actions/core';
import { parse as parseYaml } from 'yaml';
import {
  DEFAULT_CONTEXT_FILES,
  type SentinelConfig,
  SentinelConfigSchema,
  defaultConfig,
} from './schema.js';

export interface ContextFile {
  path: string;
  name: string;
  content: string;
}

export interface LoadedConfig {
  config: SentinelConfig;
  contextFiles: ContextFile[];
  // Deprecated: kept for backwards compatibility
  claudeMdContent?: string;
}

export async function loadConfig(configPath: string, workingDir: string): Promise<LoadedConfig> {
  let config = defaultConfig;

  // Try to load .sentinel.yml
  const fullConfigPath = path.isAbsolute(configPath)
    ? configPath
    : path.join(workingDir, configPath);

  if (fs.existsSync(fullConfigPath)) {
    try {
      const content = fs.readFileSync(fullConfigPath, 'utf-8');
      const parsed = parseYaml(content);
      config = SentinelConfigSchema.parse(parsed);
      core.info(`Loaded config from ${fullConfigPath}`);
    } catch (error) {
      core.warning(`Failed to parse config file: ${error}`);
      core.info('Using default configuration');
    }
  } else {
    core.info(`No config file found at ${fullConfigPath}, using defaults`);
  }

  // Load AI context files (provider-agnostic)
  const contextFiles = loadContextFiles(config, workingDir);

  // For backwards compatibility, also provide claudeMdContent
  const claudeMdFile = contextFiles.find(
    (f) => f.name.toLowerCase() === 'claude.md' || f.path.toLowerCase().includes('claude.md')
  );
  const claudeMdContent = claudeMdFile?.content;

  return { config, contextFiles, claudeMdContent };
}

function loadContextFiles(config: SentinelConfig, workingDir: string): ContextFile[] {
  const contextFiles: ContextFile[] = [];

  // Check if context files loading is enabled
  const contextConfig = config.context_files;
  const claudeConfig = config.claude_md;

  // If both are disabled, return empty
  if (!contextConfig.enabled && !claudeConfig.enabled) {
    return contextFiles;
  }

  // Build list of files to search for
  const filesToSearch: string[] = [];

  // Add default context files if enabled
  if (contextConfig.enabled && contextConfig.search_defaults) {
    filesToSearch.push(...DEFAULT_CONTEXT_FILES);
  }

  // Add custom paths from context_files config
  if (contextConfig.paths) {
    filesToSearch.push(...contextConfig.paths);
  }

  // Add legacy claude_md path if specified
  if (claudeConfig.enabled && claudeConfig.path) {
    filesToSearch.push(claudeConfig.path);
  }

  // Search for each file
  for (const fileName of filesToSearch) {
    const foundFiles = findContextFile(fileName, workingDir);
    for (const filePath of foundFiles) {
      // Avoid duplicates
      if (contextFiles.some((f) => f.path === filePath)) {
        continue;
      }

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const name = path.basename(filePath);
        contextFiles.push({ path: filePath, name, content });
        core.info(`Loaded AI context file: ${filePath}`);
      } catch (error) {
        core.warning(`Failed to read context file ${filePath}: ${error}`);
      }
    }
  }

  if (contextFiles.length === 0) {
    core.info('No AI context files found (CLAUDE.md, AGENTS.md, etc.)');
  } else {
    core.info(`Loaded ${contextFiles.length} AI context file(s)`);
  }

  return contextFiles;
}

function findContextFile(fileName: string, workingDir: string): string[] {
  const foundPaths: string[] = [];

  // Common locations to search
  const searchLocations = [
    workingDir,
    path.join(workingDir, '.claude'),
    path.join(workingDir, '.cursor'),
    path.join(workingDir, '.github'),
    path.join(workingDir, 'docs'),
  ];

  for (const location of searchLocations) {
    const fullPath = path.join(location, fileName);
    if (fs.existsSync(fullPath)) {
      foundPaths.push(fullPath);
    }
  }

  // Also check if fileName is already an absolute or relative path
  const directPath = path.isAbsolute(fileName) ? fileName : path.join(workingDir, fileName);
  if (fs.existsSync(directPath) && !foundPaths.includes(directPath)) {
    foundPaths.push(directPath);
  }

  return foundPaths;
}

export function mergeWithActionInputs(config: SentinelConfig): SentinelConfig {
  // Get all provider API keys and models from action inputs
  const openaiApiKey = core.getInput('openai_api_key');
  const openaiModel = core.getInput('openai_model');
  const anthropicApiKey = core.getInput('anthropic_api_key');
  const anthropicModel = core.getInput('anthropic_model');
  const geminiApiKey = core.getInput('gemini_api_key');
  const geminiModel = core.getInput('gemini_model');
  const ollamaBaseUrl = core.getInput('ollama_base_url');
  const ollamaModel = core.getInput('ollama_model');

  // Determine provider based on available credentials (priority order)
  let provider = config.llm.provider;
  let model = config.llm.model;

  // Auto-detect provider based on which API key is provided
  if (openaiApiKey) {
    provider = 'openai';
    model = openaiModel || model || 'gpt-4o';
  } else if (anthropicApiKey) {
    provider = 'anthropic';
    model = anthropicModel || model || 'claude-sonnet-4-20250514';
  } else if (geminiApiKey) {
    provider = 'gemini';
    model = geminiModel || model || 'gemini-2.0-flash';
  } else if (ollamaBaseUrl) {
    provider = 'ollama';
    model = ollamaModel || model || 'codellama:13b';
  }

  return {
    ...config,
    llm: {
      ...config.llm,
      provider,
      model,
      base_url: ollamaBaseUrl || config.llm.base_url,
    },
  };
}
