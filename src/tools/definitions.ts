/**
 * Tool definitions for agentic review mode.
 * These tools allow the LLM to explore the codebase during review.
 */

/** Tool definition for Anthropic's tool_use */
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

/** Tool definition for OpenAI's function calling */
export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required?: string[];
    };
  };
}

/** Tool definition for Gemini's function declarations */
export interface GeminiTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

/** Common tool names */
export type ToolName = 'read_file' | 'list_files' | 'search_code' | 'get_structure';

/** Tool call result */
export interface ToolResult {
  name: ToolName;
  result: string;
  error?: string;
}

/** Tool call request */
export interface ToolCall {
  id: string;
  name: ToolName;
  arguments: Record<string, unknown>;
}

// Base tool definitions
const toolDefinitions = {
  read_file: {
    description:
      'Read the contents of a file. Use this to understand imports, types, or related code.',
    parameters: {
      path: { type: 'string', description: 'Relative path to the file from repository root' },
    },
    required: ['path'],
  },
  list_files: {
    description:
      'List files in a directory. Use this to explore project structure or find related files.',
    parameters: {
      directory: { type: 'string', description: 'Relative path to directory (use "." for root)' },
      pattern: {
        type: 'string',
        description: 'Optional glob pattern to filter files (e.g., "*.ts")',
      },
    },
    required: ['directory'],
  },
  search_code: {
    description:
      'Search for code patterns in the repository. Use this to find function definitions, usages, or related code.',
    parameters: {
      query: { type: 'string', description: 'Search query (regex pattern)' },
      path: { type: 'string', description: 'Optional directory to limit search scope' },
    },
    required: ['query'],
  },
  get_structure: {
    description:
      'Get the project directory structure. Use this to understand the overall codebase organization.',
    parameters: {},
    required: [],
  },
} as const;

/** Get tool definitions for Anthropic */
export function getAnthropicTools(): AnthropicTool[] {
  return Object.entries(toolDefinitions).map(([name, def]) => ({
    name,
    description: def.description,
    input_schema: {
      type: 'object' as const,
      properties: def.parameters,
      required: [...def.required],
    },
  }));
}

/** Get tool definitions for OpenAI */
export function getOpenAITools(): OpenAITool[] {
  return Object.entries(toolDefinitions).map(([name, def]) => ({
    type: 'function' as const,
    function: {
      name,
      description: def.description,
      parameters: {
        type: 'object' as const,
        properties: def.parameters,
        required: [...def.required],
      },
    },
  }));
}

/** Get tool definitions for Gemini */
export function getGeminiTools(): GeminiTool[] {
  return Object.entries(toolDefinitions).map(([name, def]) => ({
    name,
    description: def.description,
    parameters: {
      type: 'object' as const,
      properties: def.parameters,
      required: [...def.required],
    },
  }));
}
