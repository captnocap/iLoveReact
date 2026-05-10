/**
 * @reactjit/agent — Model-agnostic AI agent orchestration
 * 
 * Provides Claude Code-like agent capabilities for any LLM provider.
 * Works with Anthropic, OpenAI, local models, or custom providers.
 * 
 * @example
 * ```tsx
 * import { useAgentSession } from '@reactjit/agent';
 * import { bash, readFile, writeFile } from '@reactjit/tools';
 * 
 * function App() {
 *   const session = useAgentSession({
 *     provider: 'openai',
 *     model: 'gpt-4o',
 *     apiKey: env.OPENAI_API_KEY,
 *     tools: [bash, readFile, writeFile],
 *     workDir: '/home/user/project',
 *   });
 * 
 *   return (
 *     <AgentDashboard 
 *       messages={session.messages}
 *       onSend={session.send}
 *       isStreaming={session.isStreaming}
 *     />
 *   );
 * }
 * ```
 */

// ═════════════════════════════════════════════════════════════════════════════
// Core Types
// ═════════════════════════════════════════════════════════════════════════════

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  /** Unique ID for this tool call */
  id: string;
  /** Name of the tool to call */
  name: string;
  /** JSON-encoded arguments */
  arguments: string;
}

export interface Message {
  role: MessageRole;
  content: string;
  /** Present on assistant messages that request tool calls */
  toolCalls?: ToolCall[];
  /** Present on tool result messages */
  toolCallId?: string;
}

export interface ToolDefinition {
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
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolDefinition['parameters'];
  /**
   * Execute the tool. Runs in a worker thread - can be async.
   * Return a string result (will be sent to LLM as tool result).
   */
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<string> | string;
  /**
   * Can this tool run concurrently with other concurrent-safe tools?
   * - true: Runs in parallel (e.g., readFile, grep)
   * - false: Blocks other tools (e.g., bash with &&, file writes)
   */
  isConcurrencySafe?: (args: Record<string, unknown>) => boolean;
  /**
   * Does this tool only read files? (for permission tracking)
   */
  isReadOnly?: (args: Record<string, unknown>) => boolean;
  /**
   * Is this tool destructive? (delete, overwrite)
   */
  isDestructive?: (args: Record<string, unknown>) => boolean;
}

export interface ToolContext {
  /** Working directory for this tool execution */
  workDir: string | null;
  /** Report progress for streaming UI updates */
  reportProgress: (status: 'running' | 'progress' | 'completed' | 'error', message?: string, percent?: number) => void;
  /** Check if execution was cancelled (sibling error or user abort) */
  checkAbort: () => boolean;
}

// ═════════════════════════════════════════════════════════════════════════════
// Session Configuration
// ═════════════════════════════════════════════════════════════════════════════

export type AIProvider = 'anthropic' | 'openai' | 'custom' | 'ollama';

export interface SessionConfig {
  /** LLM provider */
  provider: AIProvider;
  /** Model name (e.g., 'gpt-4o', 'claude-3-sonnet') */
  model: string;
  /** API key (or set via env var) */
  apiKey?: string;
  /** Base URL for API (for custom/local providers) */
  baseUrl?: string;
  /** System prompt */
  systemPrompt?: string;
  /** Tools available to the agent */
  tools?: Tool[];
  /** Working directory for bash/file operations */
  workDir?: string;
  /** Max tool rounds before stopping (default: 10) */
  maxToolRounds?: number;
  /** Temperature (default: 0.7) */
  temperature?: number;
  /** Max tokens per response (default: 4096) */
  maxTokens?: number;
  /** HTTP proxy */
  proxy?: string;
}

// ═════════════════════════════════════════════════════════════════════════════
// Session State & Callbacks
// ═════════════════════════════════════════════════════════════════════════════

export type SessionState = 'idle' | 'streaming' | 'executing_tools' | 'error';

export interface ToolExecution {
  id: string;
  toolName: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  result?: string;
  startTime: number;
  endTime?: number;
}

export interface AgentSession {
  /** Current state */
  state: SessionState;
  /** Message history */
  messages: Message[];
  /** Currently executing tools */
  activeExecutions: ToolExecution[];
  /** Whether the LLM is currently streaming */
  isStreaming: boolean;
  /** Whether tools are currently executing */
  isExecutingTools: boolean;
  /** Current error (if state === 'error') */
  error: string | null;

  /** Send a user message and run the agent loop */
  send: (content: string) => Promise<void>;
  /** Stop the current operation */
  stop: () => void;
  /** Clear message history */
  clear: () => void;

  /** Callback: new message chunk from LLM */
  onStreamChunk?: (text: string) => void;
  /** Callback: tool started executing */
  onToolStart?: (execution: ToolExecution) => void;
  /** Callback: tool completed */
  onToolEnd?: (execution: ToolExecution) => void;
  /** Callback: error occurred */
  onError?: (error: string) => void;
}

// ═════════════════════════════════════════════════════════════════════════════
// React Hook
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Hook for conversational AI with streaming and tool execution.
 * 
 * @example
 * ```tsx
 * const session = useAgentSession({
 *   provider: 'openai',
 *   model: 'gpt-4o',
 *   tools: [bash, readFile],
 * });
 * 
 * // Send a message
 * await session.send("Fix the bug in main.zig");
 * 
 * // Access messages
 * session.messages.forEach(msg => console.log(msg.content));
 * ```
 */
export function useAgentSession(config: SessionConfig): AgentSession;

// ═════════════════════════════════════════════════════════════════════════════
// Forked Agents (Subagents)
// ═════════════════════════════════════════════════════════════════════════════

export interface ForkConfig {
  /** Task directive for the child */
  directive: string;
  /** Inherit parent's conversation context (default: true) */
  inheritsContext?: boolean;
  /** Inherit parent's system prompt for cache sharing (default: true) */
  inheritsSystemPrompt?: boolean;
  /** Model to use (null = inherit from parent) */
  model?: string;
  /** Provider to use (null = inherit from parent) */
  provider?: AIProvider;
  /** Working directory (null = inherit from parent) */
  workDir?: string;
  /** Tools to give the child (null = same as parent) */
  tools?: Tool[];
  /** Max turns before auto-termination (default: 200) */
  maxTurns?: number;
  /** Run in isolated git worktree */
  useWorktree?: boolean;
  /** Permission handling: 'inherit', 'bubble', 'isolated' */
  permissionMode?: 'inherit' | 'bubble' | 'isolated';
}

export type ForkedAgentStatus = 'spawning' | 'running' | 'paused' | 'completed' | 'error';

export interface ForkedAgent {
  /** Unique agent ID */
  id: string;
  /** Current status */
  status: ForkedAgentStatus;
  /** Current turn count */
  currentTurn: number;
  /** Final report (when status === 'completed') */
  finalReport?: string;
  /** Exit code (when completed) */
  exitCode: number;

  /** Send a message to resume the agent */
  sendMessage: (content: string) => Promise<void>;
  /** Pause the agent */
  pause: () => void;
  /** Resume a paused agent */
  resume: () => void;
  /** Terminate the agent */
  terminate: () => void;

  /** Callback: new message from agent */
  onMessage?: (message: Message) => void;
  /** Callback: agent completed */
  onComplete?: (report: string) => void;
  /** Callback: error occurred */
  onError?: (error: string) => void;
}

/**
 * Fork a subagent with inherited context.
 * Child runs in background, reports back when done.
 * 
 * @example
 * ```tsx
 * const analyzer = forkAgent({
 *   directive: "Analyze src/ for security issues",
 *   inheritsContext: true,
 *   model: 'gpt-4o-mini',
 * });
 * 
 * analyzer.onComplete = (report) => {
 *   console.log("Analysis done:", report);
 * };
 * ```
 */
export function forkAgent(config: ForkConfig): ForkedAgent;

/**
 * Fork multiple agents in parallel.
 * 
 * @example
 * ```tsx
 * const results = await forkAgents([
 *   { directive: "Fix bug A", inheritsContext: true },
 *   { directive: "Fix bug B", inheritsContext: true },
 * ]);
 * ```
 */
export function forkAgents(configs: ForkConfig[]): Promise<ForkedAgent[]>;

// ═════════════════════════════════════════════════════════════════════════════
// Agent Pool (manage multiple agents)
// ═════════════════════════════════════════════════════════════════════════════

export interface AgentPool {
  /** Spawn a new agent */
  spawn: (config: ForkConfig) => ForkedAgent;
  /** Get agent by ID */
  get: (agentId: string) => ForkedAgent | null;
  /** List all active agents */
  list: () => ForkedAgent[];
  /** Terminate all agents */
  terminateAll: () => void;
}

/**
 * Create an agent pool for managing multiple subagents.
 * 
 * @example
 * ```tsx
 * const pool = createAgentPool();
 * 
 * const agent1 = pool.spawn({ directive: "Task 1" });
 * const agent2 = pool.spawn({ directive: "Task 2" });
 * 
 * // Later...
 * pool.terminateAll();
 * ```
 */
export function createAgentPool(): AgentPool;
