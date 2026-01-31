/**
 * Tool executor for agentic review mode.
 * Executes tools requested by the LLM during deep review.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as core from '@actions/core';
import { minimatch } from 'minimatch';
import type { ToolCall, ToolResult } from './definitions.js';

/** Maximum file size to read (500KB) */
const MAX_FILE_SIZE = 500 * 1024;

/** Maximum search results */
const MAX_SEARCH_RESULTS = 20;

/** Maximum directory depth for structure */
const MAX_STRUCTURE_DEPTH = 4;

/** Directories to skip */
const SKIP_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '__pycache__',
  'venv',
];

export class ToolExecutor {
  constructor(private workingDir: string) {}

  /**
   * Execute a tool call and return the result.
   */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const { name, arguments: args } = toolCall;

    core.debug(`Executing tool: ${name} with args: ${JSON.stringify(args)}`);

    try {
      let result: string;

      switch (name) {
        case 'read_file':
          result = await this.readFile(args.path as string);
          break;
        case 'list_files':
          result = await this.listFiles(
            args.directory as string,
            args.pattern as string | undefined
          );
          break;
        case 'search_code':
          result = await this.searchCode(args.query as string, args.path as string | undefined);
          break;
        case 'get_structure':
          result = await this.getStructure();
          break;
        default:
          return { name, result: '', error: `Unknown tool: ${name}` };
      }

      return { name, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      core.debug(`Tool ${name} error: ${message}`);
      return { name, result: '', error: message };
    }
  }

  /**
   * Execute multiple tool calls in parallel.
   */
  async executeAll(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    return Promise.all(toolCalls.map((tc) => this.execute(tc)));
  }

  private async readFile(filePath: string): Promise<string> {
    const fullPath = path.join(this.workingDir, filePath);

    // Security: ensure path is within working directory
    const resolved = path.resolve(fullPath);
    if (!resolved.startsWith(path.resolve(this.workingDir))) {
      throw new Error('Path traversal not allowed');
    }

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const stats = fs.statSync(fullPath);
    if (stats.size > MAX_FILE_SIZE) {
      const content = fs.readFileSync(fullPath, 'utf-8').substring(0, MAX_FILE_SIZE);
      return `${content}\n\n... (file truncated, ${stats.size - MAX_FILE_SIZE} bytes remaining)`;
    }

    return fs.readFileSync(fullPath, 'utf-8');
  }

  private async listFiles(directory: string, pattern?: string): Promise<string> {
    const fullPath = path.join(this.workingDir, directory);

    // Security check
    const resolved = path.resolve(fullPath);
    if (!resolved.startsWith(path.resolve(this.workingDir))) {
      throw new Error('Path traversal not allowed');
    }

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Directory not found: ${directory}`);
    }

    const results: string[] = [];
    this.scanDir(fullPath, '', pattern, results, 3);

    if (results.length === 0) {
      return 'No files found matching criteria.';
    }

    return results.join('\n');
  }

  private scanDir(
    basePath: string,
    relativePath: string,
    pattern: string | undefined,
    results: string[],
    maxDepth: number
  ): void {
    if (maxDepth <= 0 || results.length >= 100) return;

    const fullPath = path.join(basePath, relativePath);
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });

    for (const entry of entries) {
      if (SKIP_DIRS.includes(entry.name)) continue;

      const entryRelPath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        this.scanDir(basePath, entryRelPath, pattern, results, maxDepth - 1);
      } else if (entry.isFile()) {
        if (!pattern || minimatch(entryRelPath, pattern)) {
          results.push(entryRelPath);
        }
      }
    }
  }

  private async searchCode(query: string, searchPath?: string): Promise<string> {
    const basePath = searchPath ? path.join(this.workingDir, searchPath) : this.workingDir;

    // Security check
    const resolved = path.resolve(basePath);
    if (!resolved.startsWith(path.resolve(this.workingDir))) {
      throw new Error('Path traversal not allowed');
    }

    const regex = new RegExp(query, 'gi');
    const results: string[] = [];

    this.searchInDir(basePath, regex, results);

    if (results.length === 0) {
      return `No matches found for: ${query}`;
    }

    return results.slice(0, MAX_SEARCH_RESULTS).join('\n\n');
  }

  private searchInDir(dirPath: string, regex: RegExp, results: string[]): void {
    if (results.length >= MAX_SEARCH_RESULTS) return;

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (results.length >= MAX_SEARCH_RESULTS) return;
        if (SKIP_DIRS.includes(entry.name)) continue;

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          this.searchInDir(fullPath, regex, results);
        } else if (entry.isFile() && this.isSearchableFile(entry.name)) {
          this.searchInFile(fullPath, regex, results);
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }

  private isSearchableFile(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    const searchableExts = [
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.py',
      '.java',
      '.go',
      '.rs',
      '.rb',
      '.php',
      '.cs',
      '.cpp',
      '.c',
      '.h',
      '.swift',
      '.kt',
      '.scala',
      '.vue',
      '.svelte',
      '.json',
      '.yaml',
      '.yml',
      '.md',
    ];
    return searchableExts.includes(ext);
  }

  private searchInFile(filePath: string, regex: RegExp, results: string[]): void {
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > MAX_FILE_SIZE) return;

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const relativePath = path.relative(this.workingDir, filePath);
      const matches: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          const lineNum = i + 1;
          const preview = lines[i].trim().substring(0, 100);
          matches.push(`  L${lineNum}: ${preview}`);
          if (matches.length >= 5) break; // Max 5 matches per file
        }
        regex.lastIndex = 0; // Reset regex state
      }

      if (matches.length > 0) {
        results.push(`${relativePath}:\n${matches.join('\n')}`);
      }
    } catch (error) {
      // Skip files we can't read
    }
  }

  private async getStructure(): Promise<string> {
    const lines: string[] = [];
    this.buildStructure(this.workingDir, '', lines, MAX_STRUCTURE_DEPTH);
    return lines.join('\n');
  }

  private buildStructure(basePath: string, prefix: string, lines: string[], depth: number): void {
    if (depth <= 0) return;

    try {
      const entries = fs.readdirSync(basePath, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory() && !SKIP_DIRS.includes(e.name));
      const files = entries.filter((e) => e.isFile());

      // Show directories first
      for (const dir of dirs.sort((a, b) => a.name.localeCompare(b.name))) {
        lines.push(`${prefix}${dir.name}/`);
        this.buildStructure(path.join(basePath, dir.name), `${prefix}  `, lines, depth - 1);
      }

      // Then files (limited)
      const sortedFiles = files.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 10);
      for (const file of sortedFiles) {
        lines.push(`${prefix}${file.name}`);
      }

      if (files.length > 10) {
        lines.push(`${prefix}... (${files.length - 10} more files)`);
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }
}
