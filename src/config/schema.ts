import { z } from 'zod';

export const ReviewCategorySchema = z.enum([
  'security',
  'architecture',
  'performance',
  'best-practices',
  'bugs',
]);

export type ReviewCategory = z.infer<typeof ReviewCategorySchema>;

export const SeveritySchema = z.enum(['critical', 'warning', 'suggestion', 'nitpick']);

export type Severity = z.infer<typeof SeveritySchema>;

export const LLMProviderSchema = z.enum(['openai', 'ollama', 'anthropic', 'gemini']);

export type LLMProvider = z.infer<typeof LLMProviderSchema>;

export const PatternSchema = z.object({
  category: z.enum(['naming', 'architecture', 'testing', 'style', 'other']),
  pattern: z.string(),
  examples: z.array(z.string()).optional(),
});

export type Pattern = z.infer<typeof PatternSchema>;

export const LabelConfigSchema = z.object({
  enabled: z.boolean().default(true),
  security_issue: z.string().default('security'),
  needs_review: z.string().default('needs-review'),
  effort_prefix: z.string().default('effort:'),
});

export const OutputConfigSchema = z.object({
  summary: z.boolean().default(true),
  inline_comments: z.boolean().default(true),
  max_inline_comments: z.number().min(1).max(50).default(15),
  labels: LabelConfigSchema.default({}),
});

export const IgnoreConfigSchema = z.object({
  paths: z.array(z.string()).default([]),
  authors: z.array(z.string()).default([]),
});

export const ReviewModeSchema = z.enum(['quick', 'deep']);

export type ReviewMode = z.infer<typeof ReviewModeSchema>;

export const ReviewConfigSchema = z.object({
  categories: z.array(ReviewCategorySchema).default(['security', 'architecture', 'bugs']),
  min_severity: SeveritySchema.default('suggestion'),
  skip_if_effort_below: z.number().min(1).max(5).default(1),
  /** Review mode: 'quick' (single API call) or 'deep' (agentic with tool-use) */
  mode: ReviewModeSchema.default('quick'),
});

export const LLMConfigSchema = z.object({
  provider: LLMProviderSchema.default('openai'),
  model: z.string().optional(),
  base_url: z.string().optional(),
});

// Default AI context files to search for (provider-agnostic)
export const DEFAULT_CONTEXT_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  'COPILOT.md',
  'AI.md',
  'CONVENTIONS.md',
  '.cursorrules',
  'cursor.md',
  '.github/copilot-instructions.md',
];

export const ContextFilesConfigSchema = z.object({
  enabled: z.boolean().default(true),
  // Custom paths to search for AI context files
  paths: z.array(z.string()).optional(),
  // If true, search for all default files; if false, only use custom paths
  search_defaults: z.boolean().default(true),
});

// Keep backwards compatibility with claude_md config
export const ClaudeMdConfigSchema = z.object({
  enabled: z.boolean().default(true),
  path: z.string().optional(),
});

export const SentinelConfigSchema = z.object({
  llm: LLMConfigSchema.default({}),
  review: ReviewConfigSchema.default({}),
  ignore: IgnoreConfigSchema.default({}),
  instructions: z.array(z.string()).default([]),
  patterns: z.array(PatternSchema).default([]),
  output: OutputConfigSchema.default({}),
  // New provider-agnostic context files config
  context_files: ContextFilesConfigSchema.default({}),
  // Deprecated: kept for backwards compatibility
  claude_md: ClaudeMdConfigSchema.default({}),
});

export type SentinelConfig = z.infer<typeof SentinelConfigSchema>;

export const defaultConfig: SentinelConfig = SentinelConfigSchema.parse({});
