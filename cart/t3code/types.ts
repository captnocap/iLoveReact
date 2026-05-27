// T3 Code — shared types (1:1 behavior port from pingdotgg/t3code)

export type Backend = 'claude_code' | 'codex_app_server' | 'kimi_cli_wire' | 'local_ai' | 'openai_compat';

export type RuntimeMode = 'approval-required' | 'auto-accept-edits' | 'full-access';
export type InteractionMode = 'build' | 'plan';

export type ProviderInstance = {
  id: string;
  driver: Backend;
  label: string;
  model: string;
  enabled: boolean;
};

export type Project = {
  id: string;
  name: string;
  cwd: string;
  environmentId: string;
  createdAt?: number;
  updatedAt?: number;
  defaultModelSelection?: ModelSelection;
};

export type ThreadId = string;
export type MessageId = string;
export type TurnId = string;

export type ModelSelection = {
  instanceId: string;
  model: string;
};

export type ChatMessage = {
  id: MessageId;
  kind: 'user' | 'assistant' | 'tool_call' | 'tool_output' | 'reasoning' | 'system';
  text: string;
  payload_json?: string;
  turnId?: TurnId;
  createdAt: number;
};

export type Thread = {
  id: ThreadId;
  projectId: string;
  environmentId: string;
  title: string;
  messages: ChatMessage[];
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: InteractionMode;
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
  proposedPlans?: ProposedPlan[];
};

export type ProposedPlan = {
  id: string;
  title: string;
  description: string;
  steps: PlanStep[];
  status: 'pending' | 'accepted' | 'rejected';
};

export type PlanStep = {
  id: string;
  description: string;
  status: 'pending' | 'done' | 'skipped';
};

export type TerminalContextSelection = {
  terminalId: string;
  terminalLabel: string;
  lineStart: number;
  lineEnd: number;
  text: string;
};

export type TerminalContextDraft = TerminalContextSelection & {
  id: string;
};

export type TerminalTab = {
  id: string;
  label: string;
  cwd: string;
  active: boolean;
};

export type TerminalGroup = {
  id: string;
  terminalIds: string[];
};

export type ThreadTerminalState = {
  terminalOpen: boolean;
  terminalHeight: number;
  terminalIds: string[];
  activeTerminalId: string;
  terminalGroups: TerminalGroup[];
  activeTerminalGroupId: string;
};

export type Settings = {
  defaultRuntimeMode: RuntimeMode;
  defaultInteractionMode: InteractionMode;
  timestampFormat: 'relative' | 'absolute';
  autoOpenPlanSidebar: boolean;
  sidebarThreadSortOrder: 'updated_at' | 'created_at';
  sidebarProjectSortOrder: 'updated_at' | 'created_at' | 'manual';
  confirmThreadArchive: boolean;
  providers: ProviderInstance[];
};

export type CommandPaletteItem =
  | { kind: 'action'; id: string; title: string; description?: string; shortcut?: string; run(): void }
  | { kind: 'submenu'; id: string; title: string; description?: string; children: CommandPaletteItem[] };

export type DiffStat = {
  added: number;
  removed: number;
  modified: number;
};

export type TurnDiffSummary = {
  turnId: TurnId;
  files: { path: string; stat: DiffStat }[];
};

export type EnvironmentUnavailableState = {
  environmentId: string;
  label: string;
  connectionState: 'connecting' | 'disconnected' | 'error';
};

export type SessionPhase = 'idle' | 'streaming' | 'failed' | 'starting';

// ── Composer-specific types ────────────────────────────────────────────────

export type PendingApproval = {
  requestId: string;
  requestKind: 'command' | 'file-read' | 'file-change';
  detail?: string;
};

export type PendingUserInputQuestion = {
  id: string;
  header: string;
  question: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
};

export type PendingUserInput = {
  requestId: string;
  questions: PendingUserInputQuestion[];
};

export type PendingUserInputDraftAnswer = {
  selectedOptionLabels?: string[];
  customAnswer?: string;
};

export type ComposerImageAttachment = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl?: string;
};

export type ComposerCommandItem =
  | { id: string; type: 'path'; path: string; pathKind: 'file' | 'directory'; label: string; description: string }
  | { id: string; type: 'slash-command'; command: string; label: string; description: string }
  | { id: string; type: 'provider-slash-command'; provider: string; command: { name: string; description?: string }; label: string; description: string }
  | { id: string; type: 'skill'; provider: string; skill: { name: string; shortDescription?: string; description?: string }; label: string; description: string };

export type ProviderSkill = {
  name: string;
  shortDescription?: string;
  description?: string;
  scope?: string;
};

export type ContextWindowSnapshot = {
  used: number;
  limit: number;
};
