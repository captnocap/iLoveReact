// Bridge types — direct extraction from cart/claude_openai_bridge_tui.tsx.
// Every field/shape is preserved (fold contract).

export interface SessionHookRow {
  sid: string;
  short: string;
  pingMs: number;
  status: string;
  transcriptPath: string;
  transcriptSize: number;
  transcriptMtimeMs: number;
}

export interface TurnParseResult {
  complete: boolean;
  text: string;
  sawUser: boolean;
  endedMsgId: string;
  lastStopReason: string;
  newAssistantEntries: number;
  newUserEntries: number;
}

export interface PendingCompletion {
  baseline: { path: string; size: number } | null;
  startMs: number;
  sessionPrefix: string;
  /** Ping-time snapshot of every live session BEFORE writePty fired. The
   *  session whose ping advances past its snapshot value is the one our
   *  prompt activated. */
  sessionSnapshot: Map<string, number>;
  /** Once identified, lock to this session's transcript path so the poller
   *  and file watcher stop fanning out across every JSONL in the project. */
  lockedSid: string;
  lockedPath: string;
  trace: BridgeTrace;
  resolve: (text: string) => void;
}

export interface PendingToolCall {
  mcpReqId: any;
  mcpRes: { send: (status: number, contentType: string, body: string) => void };
  toolName: string;
  argumentsJson: string;
  createdAt: number;
  responded: boolean;
}

export interface BridgeTrace {
  requestId: string;
  cwd: string;
  home: string;
  projectDir: string;
  watchDir: string;
  baseline: any;
  promptPreview: string;
  sessionPrefix?: string;
  runtimeDir?: string;
  events: Array<Record<string, any>>;
  resolvedBy?: string;
  fallbackReason?: string;
}
