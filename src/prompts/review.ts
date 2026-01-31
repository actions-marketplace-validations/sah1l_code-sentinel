import type { FileContext, ReviewRequest } from '../llm/types.js';

export function getSystemPrompt(): string {
  return `You are Code Sentinel, an expert AI code reviewer. Your role is to analyze pull request changes and provide actionable, high-quality feedback focused on:

1. **Security**: Identify vulnerabilities like SQL injection, XSS, hardcoded secrets, insecure authentication, and OWASP Top 10 issues.

2. **Architecture**: Spot SOLID violations, improper layer dependencies, circular imports, missing abstractions, and inconsistent patterns.

3. **Performance**: Find N+1 queries, memory leaks, unnecessary re-renders, blocking operations, and inefficient algorithms.

4. **Bugs**: Detect logic errors, null pointer risks, edge cases, race conditions, and error handling gaps.

5. **Best Practices**: Note code style inconsistencies, missing error handling, and deviations from team conventions.

## Guidelines

- Focus on substantive issues, not style nitpicks (unless they affect readability significantly)
- Consider the context of the codebase and team conventions provided
- Provide specific, actionable suggestions with code examples when helpful
- Reference line numbers when possible for inline comments
- Be constructive and educational in tone
- Prioritize issues by severity: critical > warning > suggestion > nitpick

## Response Format

You MUST respond with valid JSON matching this structure:

{
  "summary": "Brief overview of the changes and assessment",
  "effortScore": 1-5,
  "issues": [
    {
      "severity": "critical|warning|suggestion|nitpick",
      "category": "security|architecture|performance|best-practices|bugs",
      "file": "path/to/file.ts",
      "line": 42,
      "title": "Short issue title",
      "description": "Detailed explanation of the issue",
      "suggestion": "How to fix it (optional)",
      "codeBlock": "suggested code fix (optional)"
    }
  ]
}`;
}

export function getDeepReviewSystemPrompt(): string {
  return `You are Code Sentinel, an expert AI code reviewer with access to tools for exploring the codebase.

## Your Goal
Analyze pull request changes and provide actionable, high-quality feedback focused on security, architecture, performance, bugs, and best practices.

## Available Tools
You have access to these tools to gather context:
- **read_file**: Read file contents to understand imports, types, or related code
- **list_files**: List files in a directory to explore project structure
- **search_code**: Search for code patterns to find definitions or usages
- **get_structure**: Get the project directory tree

## How to Use Tools
Use tools strategically to:
1. Follow imports to understand dependencies
2. Find type definitions or interfaces
3. Check how similar code is structured elsewhere
4. Understand the project architecture

Don't over-use tools - only request what you need for a thorough review.

## Review Focus
1. **Security**: Vulnerabilities, secrets, injection, OWASP Top 10
2. **Architecture**: SOLID violations, coupling, patterns
3. **Performance**: N+1 queries, memory leaks, blocking operations
4. **Bugs**: Logic errors, null checks, edge cases
5. **Best Practices**: Consistency, error handling, conventions

## Response Format
After gathering context, respond with valid JSON:

{
  "summary": "Brief overview of changes and assessment",
  "effortScore": 1-5,
  "issues": [
    {
      "severity": "critical|warning|suggestion|nitpick",
      "category": "security|architecture|performance|best-practices|bugs",
      "file": "path/to/file.ts",
      "line": 42,
      "title": "Short issue title",
      "description": "Detailed explanation",
      "suggestion": "How to fix it (optional)",
      "codeBlock": "suggested code (optional)"
    }
  ]
}`;
}

export function buildReviewPrompt(request: ReviewRequest): string {
  const sections: string[] = [];

  // PR Information
  sections.push(`## Pull Request
**Title:** ${request.pr.title}
**Author:** ${request.pr.author}
${request.pr.body ? `**Description:**\n${request.pr.body}` : ''}`);

  // Codebase Context
  const hasContextFiles = request.context.contextFiles && request.context.contextFiles.length > 0;
  const hasInstructions = request.context.instructions.length > 0;

  if (hasContextFiles || hasInstructions) {
    sections.push('## Codebase Context');

    if (request.context.stack) {
      sections.push(`**Technology Stack:** ${request.context.stack.frameworks.join(', ')}`);
    }

    // Include all AI context files (CLAUDE.md, AGENTS.md, etc.)
    if (hasContextFiles) {
      for (const ctxFile of request.context.contextFiles) {
        sections.push(
          `### Team Conventions (from ${ctxFile.name})\n${truncate(ctxFile.content, 2000)}`
        );
      }
    }

    if (hasInstructions) {
      sections.push(
        `### Custom Instructions\n${request.context.instructions.map((i) => `- ${i}`).join('\n')}`
      );
    }
  }

  // Team Patterns
  if (request.context.patterns.length > 0) {
    const patternLines = request.context.patterns.map((p) => `- **${p.category}**: ${p.pattern}`);
    sections.push(`### Team Patterns\n${patternLines.join('\n')}`);
  }

  // Related Files (for pattern reference)
  if (request.relatedFiles.length > 0) {
    sections.push('## Related Files (for pattern reference)');

    for (const file of request.relatedFiles.slice(0, 3)) {
      const excerpt = truncate(file.content, 1000);
      sections.push(`### ${file.path} (${file.role})\n\`\`\`\n${excerpt}\n\`\`\``);
    }
  }

  // Changed Files with full content
  sections.push('## Changed Files');

  for (const file of request.changedFiles) {
    sections.push(`### ${file.path}\n\`\`\`\n${truncate(file.content, 3000)}\n\`\`\``);
  }

  // Diff
  sections.push(`## Diff\n\`\`\`diff\n${truncate(request.diff, 8000)}\n\`\`\``);

  // Review Categories
  sections.push(`## Focus Areas
Please focus your review on these categories: ${request.categories.join(', ')}`);

  // Instructions
  sections.push(`## Instructions
Review the code changes above. Consider:
1. The team's established conventions and patterns
2. Consistency with related files shown
3. Security, performance, and correctness concerns
4. Best practices for the technology stack

Return your analysis as JSON.`);

  return sections.join('\n\n');
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.substring(0, maxLength)}\n... (truncated, ${text.length - maxLength} more characters)`;
}

export function formatFileContext(files: FileContext[]): string {
  if (files.length === 0) {
    return 'No related files found.';
  }

  return files
    .map((f) => {
      const lines = f.content.split('\n');
      const preview = lines.slice(0, 30).join('\n');

      return `### ${f.path}\n\`\`\`\n${preview}${lines.length > 30 ? '\n... (truncated)' : ''}\n\`\`\``;
    })
    .join('\n\n');
}
