/**
 * @reactjit/tools — Built-in tools for agent sessions
 * 
 * File operations, bash execution, and search tools that work
 * with the agent session framework.
 * 
 * @example
 * ```tsx
 * import { useAgentSession } from '@reactjit/agent';
 * import { bash, readFile, writeFile, glob, grep } from '@reactjit/tools';
 * 
 * const session = useAgentSession({
 *   tools: [bash, readFile, writeFile, glob, grep],
 * });
 * ```
 */

// ═════════════════════════════════════════════════════════════════════════════
// Bash Tool
// ═════════════════════════════════════════════════════════════════════════════

export interface BashInput {
  /** Command to execute */
  command: string;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Working directory (defaults to session workDir) */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
}

/**
 * Bash tool - execute shell commands with PTY support.
 * 
 * Features:
 * - Command chaining with `&&` and `;` (runs sequentially)
 * - CWD tracking (cd commands update session state)
 * - Progress streaming for long-running commands
 * - Automatic timeout handling
 * 
 * @example
 * ```
 * // Simple command
 * bash({ command: "ls -la" })
 * 
 * // With timeout
 * bash({ command: "npm install", timeout: 120000 })
 * 
 * // Command chaining (sequential, not concurrent)
 * bash({ command: "cd src && npm run build" })
 * ```
 */
export const bash: Tool<BashInput, string>;

// ═════════════════════════════════════════════════════════════════════════════
// File Tools
// ═════════════════════════════════════════════════════════════════════════════

export interface ReadFileInput {
  /** Path to file */
  file_path: string;
  /** Line offset (0-indexed, default: 0) */
  offset?: number;
  /** Number of lines to read (default: 100) */
  limit?: number;
}

/**
 * Read file contents.
 * 
 * @example
 * ```
 * readFile({ file_path: "src/main.zig" })
 * readFile({ file_path: "src/main.zig", offset: 10, limit: 20 })
 * ```
 */
export const readFile: Tool<ReadFileInput, string>;

export interface WriteFileInput {
  /** Path to file */
  file_path: string;
  /** Content to write */
  content: string;
}

/**
 * Write file (creates or overwrites).
 * 
 * @example
 * ```
 * writeFile({ 
 *   file_path: "src/config.zig", 
 *   content: "pub const VERSION = \"1.0.0\";" 
 * })
 * ```
 */
export const writeFile: Tool<WriteFileInput, void>;

export interface FileEditInput {
  /** Path to file */
  file_path: string;
  /** Old text to replace */
  old_string: string;
  /** New text to insert */
  new_string: string;
}

/**
 * Edit file by replacing text.
 * 
 * @example
 * ```
 * fileEdit({
 *   file_path: "src/main.zig",
 *   old_string: "const DEBUG = false;",
 *   new_string: "const DEBUG = true;"
 * })
 * ```
 */
export const fileEdit: Tool<FileEditInput, void>;

// ═════════════════════════════════════════════════════════════════════════════
// Search Tools
// ═════════════════════════════════════════════════════════════════════════════

export interface GlobInput {
  /** Pattern to match (e.g., "**/*.zig") */
  pattern: string;
  /** Directory to search (default: workDir) */
  path?: string;
  /** Limit results (default: 1000) */
  limit?: number;
}

/**
 * Find files by glob pattern.
 * 
 * @example
 * ```
 * glob({ pattern: "**/*.zig" })
 * glob({ pattern: "src/**/*test*", limit: 50 })
 * ```
 */
export const glob: Tool<GlobInput, string[]>;

export interface GrepInput {
  /** Pattern to search for */
  pattern: string;
  /** File glob to search (e.g., "*.zig") */
  path?: string;
  /** Include line numbers (default: true) */
  output_line_numbers?: boolean;
  /** Limit results (default: 250) */
  limit?: number;
}

/**
 * Search file contents with ripgrep.
 * 
 * @example
 * ```
 * grep({ pattern: "fn main", path: "*.zig" })
 * grep({ pattern: "TODO|FIXME", output_line_numbers: true })
 * ```
 */
export const grep: Tool<GrepInput, string>;

// ═════════════════════════════════════════════════════════════════════════════
// Task/Background Tools
// ═════════════════════════════════════════════════════════════════════════════

export interface TaskCreateInput {
  /** Command to run in background */
  command: string;
  /** Description for the task */
  description?: string;
}

export interface TaskInfo {
  id: string;
  command: string;
  description?: string;
  status: 'running' | 'completed' | 'error';
  exitCode?: number;
  outputPath: string;
}

/**
 * Create a background task.
 * 
 * @example
 * ```
 * const task = await taskCreate({ 
 *   command: "npm run build:watch", 
 *   description: "Build watcher" 
 * });
 * 
 * // Later...
 * const output = await taskOutput({ task_id: task.id });
 * ```
 */
export const taskCreate: Tool<TaskCreateInput, TaskInfo>;

export interface TaskListInput {
  /** Include completed tasks (default: false) */
  include_completed?: boolean;
}

/**
 * List background tasks.
 */
export const taskList: Tool<TaskListInput, TaskInfo[]>;

export interface TaskOutputInput {
  /** Task ID */
  task_id: string;
  /** Get full output (default: false = tail only) */
  full?: boolean;
}

/**
 * Get background task output.
 */
export const taskOutput: Tool<TaskOutputInput, string>;

export interface TaskStopInput {
  /** Task ID */
  task_id: string;
  /** Signal to send (default: 'term') */
  signal?: 'term' | 'kill';
}

/**
 * Stop a background task.
 */
export const taskStop: Tool<TaskStopInput, void>;

// ═════════════════════════════════════════════════════════════════════════════
// Web Tools
// ═════════════════════════════════════════════════════════════════════════════

export interface WebSearchInput {
  /** Search query */
  query: string;
  /** Number of results (default: 5) */
  limit?: number;
}

/**
 * Search the web.
 * 
 * @example
 * ```
 * webSearch({ query: "zig async await tutorial" })
 * ```
 */
export const webSearch: Tool<WebSearchInput, string>;

export interface WebFetchInput {
  /** URL to fetch */
  url: string;
  /** Max characters (default: 10000) */
  max_length?: number;
}

/**
 * Fetch and extract content from a URL.
 * 
 * @example
 * ```
 * webFetch({ url: "https://ziglang.org/documentation/master/" })
 * ```
 */
export const webFetch: Tool<WebFetchInput, string>;

// ═════════════════════════════════════════════════════════════════════════════
// Custom Tool Creation
// ═════════════════════════════════════════════════════════════════════════════

export interface Tool<Input, Output> {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
    }>;
    required?: string[];
  };
  execute: (input: Input, context: ToolContext) => Promise<Output> | Output;
  isConcurrencySafe?: (input: Input) => boolean;
  isReadOnly?: (input: Input) => boolean;
  isDestructive?: (input: Input) => boolean;
}

export interface ToolContext {
  workDir: string | null;
  reportProgress: (status: 'running' | 'progress' | 'completed' | 'error', message?: string, percent?: number) => void;
  checkAbort: () => boolean;
}

/**
 * Create a custom tool.
 * 
 * @example
 * ```tsx
 * const calcTool = createTool({
 *   name: "calculator",
 *   description: "Evaluate math expressions",
 *   parameters: {
 *     type: "object",
 *     properties: {
 *       expression: { type: "string", description: "Math expression" }
 *     },
 *     required: ["expression"]
 *   },
 *   execute: ({ expression }) => {
 *     return eval(expression).toString();
 *   },
 *   isConcurrencySafe: () => true,
 *   isReadOnly: () => true,
 * });
 * ```
 */
export function createTool<Input, Output>(config: {
  name: string;
  description: string;
  parameters: Tool<Input, Output>['parameters'];
  execute: (input: Input, context: ToolContext) => Promise<Output> | Output;
  isConcurrencySafe?: (input: Input) => boolean;
  isReadOnly?: (input: Input) => boolean;
  isDestructive?: (input: Input) => boolean;
}): Tool<Input, Output>;

// ═════════════════════════════════════════════════════════════════════════════
// Tool Registry
// ═════════════════════════════════════════════════════════════════════════════

export interface ToolRegistry {
  /** Register a tool */
  register: (tool: Tool<unknown, unknown>) => void;
  /** Get a tool by name */
  get: (name: string) => Tool<unknown, unknown> | undefined;
  /** Unregister a tool */
  unregister: (name: string) => boolean;
  /** List all registered tools */
  list: () => Tool<unknown, unknown>[];
}

/** Get the global tool registry */
export function getToolRegistry(): ToolRegistry;

/** Create a new tool registry (isolated from global) */
export function createToolRegistry(): ToolRegistry;
