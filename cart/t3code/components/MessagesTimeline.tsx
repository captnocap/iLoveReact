import {
  useMemo,
  useState,
  useEffect,
  useRef,
  memo,
  useCallback,
  createContext,
  useContext,
} from 'react';
import { Box, Col, Row, Text, Pressable, ScrollView } from '@reactjit/runtime/primitives';
import type {
  ChatMessage,
  TurnDiffSummary,
  MessageId,
  TurnId,
  ProposedPlan,
  DiffStat,
} from '../types';

// ── helpers ────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0ms';
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  if (seconds === 0) return `${minutes}m`;
  if (seconds === 60) return `${minutes + 1}m`;
  return `${minutes}m ${seconds}s`;
}

function formatElapsed(startMs: number, endMs: number | undefined): string | null {
  if (endMs == null) return null;
  if (endMs < startMs) return null;
  return formatDuration(endMs - startMs);
}

function formatWorkingTimer(startMs: number, endMs: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`;
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatWorkingTimerNow(startMs: number): string {
  return formatWorkingTimer(startMs, Date.now());
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function summarizeDiffStat(
  files: { path: string; stat: DiffStat }[],
): { added: number; removed: number; modified: number } {
  let added = 0;
  let removed = 0;
  let modified = 0;
  for (const f of files) {
    added += f.stat.added;
    removed += f.stat.removed;
    modified += f.stat.modified;
  }
  return { added, removed, modified };
}

function hasNonZeroStat(stat: { added: number; removed: number; modified: number }): boolean {
  return stat.added !== 0 || stat.removed !== 0 || stat.modified !== 0;
}

function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, '').trim();
}

function capitalizePhrase(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return value;
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function parseToolPayload(
  message: ChatMessage,
): { name?: string; arguments?: Record<string, unknown>; result?: string } {
  if (!message.payload_json) return {};
  try {
    return JSON.parse(message.payload_json) as any;
  } catch {
    return {};
  }
}

function toolWorkEntryHeading(message: ChatMessage): string {
  const payload = parseToolPayload(message);
  if (payload.name) {
    return capitalizePhrase(normalizeCompactToolLabel(payload.name));
  }
  return capitalizePhrase(normalizeCompactToolLabel(message.text || 'Tool call'));
}

function resolveAssistantMessageCopyState({
  text,
  showCopyButton,
  streaming,
}: {
  text: string | null;
  showCopyButton: boolean;
  streaming: boolean;
}) {
  const hasText = text !== null && text.trim().length > 0;
  return {
    text: hasText ? text : null,
    visible: showCopyButton && hasText && !streaming,
  };
}

// ── timeline row types ─────────────────────────────────────────────────────

type TimelineDurationMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  createdAt: number;
  completedAt?: number;
};

type MessagesTimelineRow =
  | { kind: 'user'; id: string; message: ChatMessage }
  | {
      kind: 'assistant';
      id: string;
      message: ChatMessage;
      durationStart: number;
      showCompletionDivider: boolean;
      completionSummary: string | null;
      turnDiffSummary: TurnDiffSummary | undefined;
      showAssistantCopyButton: boolean;
      assistantCopyStreaming: boolean;
    }
  | { kind: 'tool_group'; id: string; entries: ChatMessage[] }
  | { kind: 'reasoning'; id: string; message: ChatMessage }
  | { kind: 'system'; id: string; message: ChatMessage }
  | { kind: 'working'; id: string; startMs: number | null }
  | { kind: 'proposed-plan'; id: string; plan: ProposedPlan };

interface StableMessagesTimelineRowsState {
  byId: Map<string, MessagesTimelineRow>;
  result: MessagesTimelineRow[];
}

// ── row derivation logic (ported from MessagesTimeline.logic.ts) ───────────

function computeMessageDurationStart(
  messages: ReadonlyArray<TimelineDurationMessage>,
): Map<string, number> {
  const result = new Map<string, number>();
  let lastBoundary: number | null = null;

  for (const message of messages) {
    if (message.role === 'user') {
      lastBoundary = message.createdAt;
    }
    result.set(message.id, lastBoundary ?? message.createdAt);
    if (message.role === 'assistant' && message.completedAt) {
      lastBoundary = message.completedAt;
    }
  }

  return result;
}

function deriveTerminalAssistantMessageIds(messages: ReadonlyArray<ChatMessage>): Set<string> {
  const lastAssistantMessageIdByResponseKey = new Map<string, string>();
  let nullTurnResponseIndex = 0;

  for (const message of messages) {
    if (message.kind === 'user') {
      nullTurnResponseIndex += 1;
      continue;
    }
    if (message.kind !== 'assistant') {
      continue;
    }

    const responseKey = message.turnId
      ? `turn:${message.turnId}`
      : `unkeyed:${nullTurnResponseIndex}`;
    lastAssistantMessageIdByResponseKey.set(responseKey, message.id);
  }

  return new Set(lastAssistantMessageIdByResponseKey.values());
}

function deriveMessagesTimelineRows(input: {
  messages: ReadonlyArray<ChatMessage>;
  isWorking: boolean;
  activeTurnId: TurnId | null;
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
  proposedPlan?: ProposedPlan | null;
}): MessagesTimelineRow[] {
  const nextRows: MessagesTimelineRow[] = [];
  const durationStartByMessageId = computeMessageDurationStart(
    input.messages.map((m) => ({
      id: m.id,
      role: m.kind === 'user' ? 'user' : m.kind === 'assistant' ? 'assistant' : 'system',
      createdAt: m.createdAt,
    })),
  );
  const terminalAssistantMessageIds = deriveTerminalAssistantMessageIds(input.messages);

  // Determine latest turn and whether it's the active one
  const turnIds = [
    ...new Set(input.messages.map((m) => m.turnId).filter((t): t is TurnId => t != null)),
  ];
  const latestTurnId = turnIds.length > 0 ? turnIds[turnIds.length - 1] : null;
  const latestTurnIsActive =
    latestTurnId != null && latestTurnId === input.activeTurnId && input.isWorking;

  let completionTargetId: MessageId | null = null;
  let completionSummaryText: string | null = null;

  if (latestTurnId && !latestTurnIsActive) {
    const turnMessages = input.messages.filter((m) => m.turnId === latestTurnId);
    const userMsg = turnMessages.find((m) => m.kind === 'user');
    const lastAssistant = turnMessages.filter((m) => m.kind === 'assistant').pop();
    if (userMsg && lastAssistant) {
      const elapsed = formatElapsed(userMsg.createdAt, lastAssistant.createdAt);
      if (elapsed) {
        completionSummaryText = `Worked for ${elapsed}`;
        completionTargetId = lastAssistant.id;
      }
    }
  }

  // Diff summary lookup by turnId
  const diffByTurnId = new Map<TurnId, TurnDiffSummary>();
  for (const d of input.turnDiffSummaries) {
    diffByTurnId.set(d.turnId, d);
  }

  // Build rows, grouping consecutive tool_call / tool_output
  let index = 0;
  while (index < input.messages.length) {
    const msg = input.messages[index];
    if (!msg) break;

    if (msg.kind === 'tool_call' || msg.kind === 'tool_output') {
      const group: ChatMessage[] = [];
      while (
        index < input.messages.length &&
        (input.messages[index].kind === 'tool_call' || input.messages[index].kind === 'tool_output')
      ) {
        group.push(input.messages[index]);
        index += 1;
      }
      nextRows.push({ kind: 'tool_group', id: `tool-group-${group[0].id}`, entries: group });
      continue;
    }

    if (msg.kind === 'user') {
      nextRows.push({ kind: 'user', id: msg.id, message: msg });
    } else if (msg.kind === 'assistant') {
      const showCompletionDivider = msg.id === completionTargetId;
      const assistantTurnStillInProgress =
        input.isWorking && input.activeTurnId != null && msg.turnId === input.activeTurnId;

      nextRows.push({
        kind: 'assistant',
        id: msg.id,
        message: msg,
        durationStart: durationStartByMessageId.get(msg.id) ?? msg.createdAt,
        showCompletionDivider,
        completionSummary: showCompletionDivider ? completionSummaryText : null,
        turnDiffSummary: msg.turnId ? diffByTurnId.get(msg.turnId) : undefined,
        showAssistantCopyButton: terminalAssistantMessageIds.has(msg.id),
        assistantCopyStreaming: assistantTurnStillInProgress,
      });
    } else if (msg.kind === 'reasoning') {
      nextRows.push({ kind: 'reasoning', id: msg.id, message: msg });
    } else if (msg.kind === 'system') {
      nextRows.push({ kind: 'system', id: msg.id, message: msg });
    }

    index += 1;
  }

  if (input.proposedPlan) {
    nextRows.push({
      kind: 'proposed-plan',
      id: `plan-${input.proposedPlan.id}`,
      plan: input.proposedPlan,
    });
  }

  if (input.isWorking) {
    const activeTurnMessages = input.activeTurnId
      ? input.messages.filter((m) => m.turnId === input.activeTurnId)
      : [];
    const startMs = activeTurnMessages[0]?.createdAt ?? Date.now();
    nextRows.push({ kind: 'working', id: 'working-indicator-row', startMs });
  }

  return nextRows;
}

function computeStableMessagesTimelineRows(
  rows: MessagesTimelineRow[],
  previous: StableMessagesTimelineRowsState,
): StableMessagesTimelineRowsState {
  const next = new Map<string, MessagesTimelineRow>();
  let anyChanged = rows.length !== previous.byId.size;

  const result = rows.map((row, index) => {
    const prevRow = previous.byId.get(row.id);
    const nextRow = prevRow && isRowUnchanged(prevRow, row) ? prevRow : row;
    next.set(row.id, nextRow);
    if (!anyChanged && previous.result[index] !== nextRow) {
      anyChanged = true;
    }
    return nextRow;
  });

  return anyChanged ? { byId: next, result } : previous;
}

/** Shallow field comparison per row variant — avoids deep equality cost. */
function isRowUnchanged(a: MessagesTimelineRow, b: MessagesTimelineRow): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;

  switch (a.kind) {
    case 'working':
      return a.startMs === (b as Extract<MessagesTimelineRow, { kind: 'working' }>).startMs;

    case 'proposed-plan':
      return a.plan === (b as Extract<MessagesTimelineRow, { kind: 'proposed-plan' }>).plan;

    case 'tool_group': {
      const bg = (b as Extract<MessagesTimelineRow, { kind: 'tool_group' }>).entries;
      if (a.entries.length !== bg.length) return false;
      return a.entries.every((e, i) => e === bg[i]);
    }

    case 'user':
    case 'reasoning':
    case 'system':
      return a.message === (b as any).message;

    case 'assistant': {
      const bm = b as Extract<MessagesTimelineRow, { kind: 'assistant' }>;
      return (
        a.message === bm.message &&
        a.durationStart === bm.durationStart &&
        a.showCompletionDivider === bm.showCompletionDivider &&
        a.completionSummary === bm.completionSummary &&
        a.showAssistantCopyButton === bm.showAssistantCopyButton &&
        a.assistantCopyStreaming === bm.assistantCopyStreaming &&
        a.turnDiffSummary === bm.turnDiffSummary
      );
    }

    default:
      return false;
  }
}

// ── context ────────────────────────────────────────────────────────────────

interface TimelineRowSharedState {
  onRevertUserMessage: (messageId: MessageId) => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onCopyText: (text: string) => void;
}

interface TimelineRowActivityState {
  isWorking: boolean;
}

const TimelineRowCtx = createContext<TimelineRowSharedState | null>(null);
const TimelineRowActivityCtx = createContext<TimelineRowActivityState | null>(null);

function useTimelineRowCtx(): TimelineRowSharedState {
  const ctx = useContext(TimelineRowCtx);
  if (!ctx) throw new Error('Missing TimelineRowCtx');
  return ctx;
}

function useTimelineRowActivityCtx(): TimelineRowActivityState {
  const ctx = useContext(TimelineRowActivityCtx);
  if (!ctx) throw new Error('Missing TimelineRowActivityCtx');
  return ctx;
}

// ── leaf components ────────────────────────────────────────────────────────

/** Live "Working for Xs" label that ticks every second. */
function WorkingTimerLabel({ startMs }: { startMs: number }) {
  const [label, setLabel] = useState(() => formatWorkingTimerNow(startMs));

  useEffect(() => {
    const tick = () => setLabel(formatWorkingTimerNow(startMs));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startMs]);

  return (
    <Text fontSize={11} color="#888">
      {label}
    </Text>
  );
}

/** Live timestamp + elapsed duration for a streaming assistant message. */
function LiveMessageMeta({
  createdAt,
  durationStart,
}: {
  createdAt: number;
  durationStart: number | null | undefined;
}) {
  const [label, setLabel] = useState(() => formatLiveMessageMetaNow(createdAt, durationStart));

  useEffect(() => {
    const update = () => setLabel(formatLiveMessageMetaNow(createdAt, durationStart));
    update();
    if (durationStart == null) return;
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [createdAt, durationStart]);

  return (
    <Text fontSize={10} color="#555">
      {label}
    </Text>
  );
}

function formatLiveMessageMetaNow(
  createdAt: number,
  durationStart: number | null | undefined,
): string {
  const elapsed = durationStart != null ? formatElapsed(durationStart, Date.now()) : null;
  return formatMessageMeta(createdAt, elapsed);
}

function formatMessageMeta(createdAt: number, duration: string | null): string {
  if (!duration) return formatTimestamp(createdAt);
  return `${formatTimestamp(createdAt)} • ${duration}`;
}

// ── diff stat label ────────────────────────────────────────────────────────

const DiffStatLabel = memo(function DiffStatLabel({
  stat,
}: {
  stat: { added: number; removed: number; modified: number };
}) {
  const parts: string[] = [];
  if (stat.added) parts.push(`+${stat.added}`);
  if (stat.removed) parts.push(`-${stat.removed}`);
  if (stat.modified) parts.push(`~${stat.modified}`);
  if (parts.length === 0) return null;
  return (
    <Text fontSize={10} color="#666">
      {parts.join(' ')}
    </Text>
  );
});

// ── copy button ────────────────────────────────────────────────────────────

const CopyButton = memo(function CopyButton({
  text,
  size = 'default',
}: {
  text: string;
  size?: 'default' | 'xs';
}) {
  const [copied, setCopied] = useState(false);

  const handlePress = useCallback(() => {
    try {
      const h = globalThis as any;
      if (typeof h.__clipboard_set === 'function') {
        h.__clipboard_set(text);
      }
    } catch {
      /* ignore */
    }
    setCopied(true);
    const timeout = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timeout);
  }, [text]);

  return (
    <Pressable onPress={handlePress}>
      <Box
        style={{
          paddingTop: size === 'xs' ? 2 : 4,
          paddingBottom: size === 'xs' ? 2 : 4,
          paddingLeft: size === 'xs' ? 6 : 8,
          paddingRight: size === 'xs' ? 6 : 8,
          backgroundColor: '#2a2a30',
          borderRadius: 4,
        }}
      >
        <Text fontSize={size === 'xs' ? 9 : 10} color={copied ? '#4ade80' : '#aaa'}>
          {copied ? 'Copied' : 'Copy'}
        </Text>
      </Box>
    </Pressable>
  );
});

// ── revert button ──────────────────────────────────────────────────────────

const RevertUserMessageButton = memo(function RevertUserMessageButton({
  messageId,
}: {
  messageId: MessageId;
}) {
  const ctx = useTimelineRowCtx();
  const activity = useTimelineRowActivityCtx();

  return (
    <Pressable
      onPress={() => {
        if (!activity.isWorking) {
          ctx.onRevertUserMessage(messageId);
        }
      }}
    >
      <Box
        style={{
          paddingTop: 4,
          paddingBottom: 4,
          paddingLeft: 8,
          paddingRight: 8,
          backgroundColor: activity.isWorking ? '#3a3a40' : '#33333a',
          borderRadius: 4,
        }}
      >
        <Text fontSize={10} color={activity.isWorking ? '#666' : '#aaa'}>
          Revert
        </Text>
      </Box>
    </Pressable>
  );
});

// ── user message body ──────────────────────────────────────────────────────

const MAX_COLLAPSED_USER_MESSAGE_LINES = 8;
const MAX_COLLAPSED_USER_MESSAGE_LENGTH = 600;

function shouldCollapseUserMessage(text: string): boolean {
  if (text.trim().length === 0) return false;
  return (
    text.length > MAX_COLLAPSED_USER_MESSAGE_LENGTH ||
    text.split('\n').length > MAX_COLLAPSED_USER_MESSAGE_LINES
  );
}

const UserMessageBody = memo(function UserMessageBody({ text }: { text: string }) {
  if (text.trim().length === 0) return null;
  return (
    <Text fontSize={13} color="#e8e8e8" style={{ whiteSpace: 'pre-wrap', lineHeight: 20 }}>
      {text}
    </Text>
  );
});

const CollapsibleUserMessageBody = memo(function CollapsibleUserMessageBody({
  text,
  footer,
}: {
  text: string;
  footer?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasVisibleBody = text.trim().length > 0;
  const canCollapse = hasVisibleBody && shouldCollapseUserMessage(text);
  const isCollapsed = canCollapse && !expanded;

  if (!hasVisibleBody) {
    return footer ? (
      <Box style={{ marginTop: 4 }}>{footer}</Box>
    ) : null;
  }

  return (
    <Col style={{ gap: 4 }}>
      <Box
        style={{
          maxHeight: isCollapsed ? 176 : undefined,
          overflow: isCollapsed ? 'hidden' : undefined,
        }}
      >
        <UserMessageBody text={text} />
      </Box>
      {(canCollapse || footer) && (
        <Row
          style={{
            alignItems: 'center',
            gap: 8,
            marginTop: 4,
            justifyContent: canCollapse && footer ? 'space-between' : 'flex-end',
          }}
        >
          {canCollapse && (
            <Pressable onPress={() => setExpanded((v) => !v)}>
              <Box style={{ paddingHorizontal: 6, paddingVertical: 4, borderRadius: 4 }}>
                <Text fontSize={11} color="#888">
                  {expanded ? 'Show less' : 'Show full message'}
                </Text>
              </Box>
            </Pressable>
          )}
          {footer && (
            <Row style={{ alignItems: 'center', gap: 8 }}>
              {footer}
            </Row>
          )}
        </Row>
      )}
    </Col>
  );
});

// ── user message row ───────────────────────────────────────────────────────

const UserMessageRow = memo(function UserMessageRow({
  row,
}: {
  row: Extract<MessagesTimelineRow, { kind: 'user' }>;
}) {
  const message = row.message;

  return (
    <Row style={{ justifyContent: 'flex-end', width: '100%' }}>
      <Col
        style={{
          maxWidth: '80%',
          backgroundColor: '#2a2a30',
          borderRadius: 12,
          borderBottomRightRadius: 4,
          paddingTop: 12,
          paddingBottom: 12,
          paddingLeft: 16,
          paddingRight: 16,
          gap: 6,
        }}
      >
        <CollapsibleUserMessageBody
          text={message.text}
          footer={
            <Row style={{ justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
              <CopyButton text={message.text} size="xs" />
              <RevertUserMessageButton messageId={message.id} />
              <Text fontSize={10} color="#555">
                {formatTimestamp(message.createdAt)}
              </Text>
            </Row>
          }
        />
      </Col>
    </Row>
  );
});

// ── assistant completion divider ───────────────────────────────────────────

const AssistantCompletionDivider = memo(function AssistantCompletionDivider({
  completionSummary,
}: {
  completionSummary: string | null;
}) {
  return (
    <Row style={{ alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 4 }}>
      <Box style={{ height: 1, backgroundColor: '#333', flexGrow: 1 }} />
      <Text fontSize={10} color="#888" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
        {completionSummary ? `Response • ${completionSummary}` : 'Response'}
      </Text>
      <Box style={{ height: 1, backgroundColor: '#333', flexGrow: 1 }} />
    </Row>
  );
});

// ── assistant changed files section ────────────────────────────────────────

const AssistantChangedFilesSection = memo(function AssistantChangedFilesSection({
  turnSummary,
}: {
  turnSummary: TurnDiffSummary | undefined;
}) {
  const ctx = useTimelineRowCtx();

  if (!turnSummary || turnSummary.files.length === 0) return null;

  const stat = summarizeDiffStat(turnSummary.files);
  const changedFileCountLabel = String(turnSummary.files.length);

  return (
    <Col
      style={{
        gap: 4,
        marginTop: 8,
        padding: 10,
        backgroundColor: '#1a1a1e',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#2a2a30',
      }}
    >
      <Row style={{ alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Text fontSize={10} color="#666">
          Changed files ({changedFileCountLabel})
        </Text>
        {hasNonZeroStat(stat) && (
          <>
            <Text fontSize={10} color="#666">
              •
            </Text>
            <DiffStatLabel stat={stat} />
          </>
        )}
        <Pressable
          onPress={() =>
            ctx.onOpenTurnDiff(turnSummary.turnId, turnSummary.files[0]?.path)
          }
        >
          <Box
            style={{
              paddingTop: 2,
              paddingBottom: 2,
              paddingLeft: 6,
              paddingRight: 6,
              backgroundColor: '#2a2a30',
              borderRadius: 4,
            }}
          >
            <Text fontSize={10} color="#aaa">
              View diff
            </Text>
          </Box>
        </Pressable>
      </Row>
      <Col style={{ gap: 2, marginTop: 4 }}>
        {turnSummary.files.slice(0, 6).map((file) => (
          <Row key={file.path} style={{ alignItems: 'center', gap: 6 }}>
            <Text
              fontSize={10}
              color="#888"
              style={{
                flexShrink: 1,
                minWidth: 0,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {file.path}
            </Text>
            <DiffStatLabel stat={file.stat} />
          </Row>
        ))}
        {turnSummary.files.length > 6 && (
          <Text fontSize={10} color="#555">
            +{turnSummary.files.length - 6} more
          </Text>
        )}
      </Col>
    </Col>
  );
});

// ── assistant copy button ──────────────────────────────────────────────────

const AssistantCopyButton = memo(function AssistantCopyButton({
  row,
}: {
  row: Extract<MessagesTimelineRow, { kind: 'assistant' }>;
}) {
  const state = resolveAssistantMessageCopyState({
    text: row.message.text ?? null,
    showCopyButton: row.showAssistantCopyButton,
    streaming: row.assistantCopyStreaming,
  });

  if (!state.visible || !state.text) return null;

  return (
    <Box style={{ marginLeft: 8 }}>
      <CopyButton text={state.text} size="xs" />
    </Box>
  );
});

// ── assistant message row ──────────────────────────────────────────────────

const AssistantMessageRow = memo(function AssistantMessageRow({
  row,
}: {
  row: Extract<MessagesTimelineRow, { kind: 'assistant' }>;
}) {
  const activity = useTimelineRowActivityCtx();
  const { message, showCompletionDivider, completionSummary, turnDiffSummary, durationStart } =
    row;
  const messageText = message.text || (activity.isWorking ? '' : '(empty response)');

  return (
    <Col style={{ gap: 4, maxWidth: '100%', paddingLeft: 4, paddingRight: 4 }}>
      {showCompletionDivider && (
        <AssistantCompletionDivider completionSummary={completionSummary} />
      )}
      <Text fontSize={13} color="#c8c8d0" style={{ whiteSpace: 'pre-wrap' }}>
        {messageText}
      </Text>
      <AssistantChangedFilesSection turnSummary={turnDiffSummary} />
      <Row style={{ alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
        <Text fontSize={10} color="#555">
          {activity.isWorking ? (
            <LiveMessageMeta createdAt={message.createdAt} durationStart={durationStart} />
          ) : (
            formatMessageMeta(
              message.createdAt,
              formatElapsed(durationStart, message.createdAt),
            )
          )}
        </Text>
        <AssistantCopyButton row={row} />
      </Row>
    </Col>
  );
});

// ── tool entry row ─────────────────────────────────────────────────────────

const ToolEntryRow = memo(function ToolEntryRow({ message }: { message: ChatMessage }) {
  const payload = parseToolPayload(message);
  const heading = toolWorkEntryHeading(message);
  const rawPreview = payload.arguments
    ? JSON.stringify(payload.arguments)
    : message.text || null;
  const preview =
    rawPreview && rawPreview.length > 120 ? rawPreview.slice(0, 120) + '…' : rawPreview;

  return (
    <Row style={{ alignItems: 'center', gap: 8, paddingVertical: 3 }}>
      <Box
        style={{
          width: 18,
          height: 18,
          borderRadius: 4,
          backgroundColor: '#222226',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text fontSize={8} color="#666">
          🔧
        </Text>
      </Box>
      <Col style={{ flexShrink: 1, minWidth: 0, gap: 1 }}>
        <Text
          fontSize={11}
          color="#aaa"
          style={{
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {heading}
        </Text>
        {preview && (
          <Text
            fontSize={10}
            color="#666"
            style={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {preview}
          </Text>
        )}
      </Col>
    </Row>
  );
});

// ── tool group row ─────────────────────────────────────────────────────────

const MAX_VISIBLE_TOOL_ENTRIES = 6;

const ToolGroupRow = memo(function ToolGroupRow({
  row,
}: {
  row: Extract<MessagesTimelineRow, { kind: 'tool_group' }>;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasOverflow = row.entries.length > MAX_VISIBLE_TOOL_ENTRIES;
  const visibleEntries =
    hasOverflow && !isExpanded
      ? row.entries.slice(-MAX_VISIBLE_TOOL_ENTRIES)
      : row.entries;
  const hiddenCount = row.entries.length - visibleEntries.length;
  const onlyToolCalls = row.entries.every((e) => e.kind === 'tool_call');

  return (
    <Col
      style={{
        gap: 4,
        padding: 8,
        backgroundColor: '#16161a',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#2a2a30',
      }}
    >
      <Row style={{ alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text
          fontSize={9}
          color="#555"
          style={{ textTransform: 'uppercase', letterSpacing: 1 }}
        >
          {onlyToolCalls ? 'Tool calls' : 'Work log'} ({row.entries.length})
        </Text>
        {hasOverflow && (
          <Pressable onPress={() => setIsExpanded((v) => !v)}>
            <Box style={{ paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text fontSize={9} color="#555">
                {isExpanded ? 'Show less' : `Show ${hiddenCount} more`}
              </Text>
            </Box>
          </Pressable>
        )}
      </Row>
      <Col style={{ gap: 2 }}>
        {visibleEntries.map((entry, idx) => (
          <ToolEntryRow key={`${entry.id}-${idx}`} message={entry} />
        ))}
      </Col>
    </Col>
  );
});

// ── reasoning row ──────────────────────────────────────────────────────────

const ReasoningRow = memo(function ReasoningRow({
  row,
}: {
  row: Extract<MessagesTimelineRow, { kind: 'reasoning' }>;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Col
      style={{
        gap: 4,
        padding: 8,
        backgroundColor: '#1a1a1e',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#2a2a30',
      }}
    >
      <Pressable onPress={() => setExpanded((v) => !v)}>
        <Row style={{ alignItems: 'center', gap: 6 }}>
          <Text fontSize={10} color="#666">
            {expanded ? '▼' : '▶'}
          </Text>
          <Text fontSize={11} color="#888">
            Reasoning
          </Text>
        </Row>
      </Pressable>
      {expanded && (
        <Text fontSize={12} color="#888" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>
          {row.message.text}
        </Text>
      )}
    </Col>
  );
});

// ── system message row ─────────────────────────────────────────────────────

const SystemMessageRow = memo(function SystemMessageRow({
  row,
}: {
  row: Extract<MessagesTimelineRow, { kind: 'system' }>;
}) {
  return (
    <Row style={{ justifyContent: 'center', paddingVertical: 4 }}>
      <Text fontSize={10} color="#555" style={{ fontStyle: 'italic', textAlign: 'center' }}>
        {row.message.text}
      </Text>
    </Row>
  );
});

// ── blinking dots (working animation) ──────────────────────────────────────

function BlinkingDots() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setPhase((p) => (p + 1) % 3), 400);
    return () => clearInterval(id);
  }, []);

  return (
    <Row style={{ gap: 3, alignItems: 'center' }}>
      <Box
        style={{
          width: 4,
          height: 4,
          borderRadius: 2,
          backgroundColor: phase === 0 ? '#888' : '#444',
        }}
      />
      <Box
        style={{
          width: 4,
          height: 4,
          borderRadius: 2,
          backgroundColor: phase === 1 ? '#888' : '#444',
        }}
      />
      <Box
        style={{
          width: 4,
          height: 4,
          borderRadius: 2,
          backgroundColor: phase === 2 ? '#888' : '#444',
        }}
      />
    </Row>
  );
}

// ── working row ────────────────────────────────────────────────────────────

const WorkingRow = memo(function WorkingRow({
  row,
}: {
  row: Extract<MessagesTimelineRow, { kind: 'working' }>;
}) {
  return (
    <Row style={{ alignItems: 'center', gap: 8, paddingTop: 4, paddingBottom: 4, paddingLeft: 6 }}>
      <BlinkingDots />
      <Row style={{ alignItems: 'center', gap: 4 }}>
        {row.startMs != null ? (
          <>
            <Text fontSize={11} color="#888">
              Working for
            </Text>
            <WorkingTimerLabel startMs={row.startMs} />
          </>
        ) : (
          <Text fontSize={11} color="#888">
            Working...
          </Text>
        )}
      </Row>
    </Row>
  );
});

// ── proposed plan row ──────────────────────────────────────────────────────

const ProposedPlanRow = memo(function ProposedPlanRow({
  row,
}: {
  row: Extract<MessagesTimelineRow, { kind: 'proposed-plan' }>;
}) {
  const plan = row.plan;

  return (
    <Col
      style={{
        gap: 8,
        padding: 12,
        backgroundColor: '#16161a',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#2a2a30',
      }}
    >
      <Text fontSize={12} color="#e8e8e8" style={{ fontWeight: 'bold' }}>
        {plan.title}
      </Text>
      <Text fontSize={11} color="#888" style={{ whiteSpace: 'pre-wrap' }}>
        {plan.description}
      </Text>
      <Row style={{ gap: 8, marginTop: 4 }}>
        <Pressable>
          <Box
            style={{
              paddingHorizontal: 12,
              paddingVertical: 6,
              backgroundColor: '#166534',
              borderRadius: 4,
            }}
          >
            <Text fontSize={11} color="#ffffff">
              Accept
            </Text>
          </Box>
        </Pressable>
        <Pressable>
          <Box
            style={{
              paddingHorizontal: 12,
              paddingVertical: 6,
              backgroundColor: '#7f1d1d',
              borderRadius: 4,
            }}
          >
            <Text fontSize={11} color="#ffffff">
              Reject
            </Text>
          </Box>
        </Pressable>
      </Row>
    </Col>
  );
});

// ── row dispatcher ─────────────────────────────────────────────────────────

const TimelineRowContent = memo(function TimelineRowContent({
  row,
}: {
  row: MessagesTimelineRow;
}) {
  switch (row.kind) {
    case 'user':
      return <UserMessageRow row={row} />;
    case 'assistant':
      return <AssistantMessageRow row={row} />;
    case 'tool_group':
      return <ToolGroupRow row={row} />;
    case 'reasoning':
      return <ReasoningRow row={row} />;
    case 'system':
      return <SystemMessageRow row={row} />;
    case 'working':
      return <WorkingRow row={row} />;
    case 'proposed-plan':
      return <ProposedPlanRow row={row} />;
    default:
      return null;
  }
});

// ── stable rows hook ───────────────────────────────────────────────────────

function useStableRows(rows: MessagesTimelineRow[]): MessagesTimelineRow[] {
  const prevState = useRef<StableMessagesTimelineRowsState>({
    byId: new Map(),
    result: [],
  });

  return useMemo(() => {
    const nextState = computeStableMessagesTimelineRows(rows, prevState.current);
    prevState.current = nextState;
    return nextState.result;
  }, [rows]);
}

// ── main component ─────────────────────────────────────────────────────────

export interface MessagesTimelineProps {
  messages: ChatMessage[];
  isWorking: boolean;
  activeTurnId: TurnId | null;
  onRevertUserMessage: (messageId: MessageId) => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  turnDiffSummaries: TurnDiffSummary[];
  proposedPlan?: ProposedPlan | null;
}

export const MessagesTimeline = memo(function MessagesTimeline(
  props: MessagesTimelineProps,
) {
  const {
    messages,
    isWorking,
    activeTurnId,
    onRevertUserMessage,
    onOpenTurnDiff,
    turnDiffSummaries,
    proposedPlan,
  } = props;

  const rawRows = useMemo(
    () =>
      deriveMessagesTimelineRows({
        messages,
        isWorking,
        activeTurnId,
        turnDiffSummaries,
        proposedPlan,
      }),
    [messages, isWorking, activeTurnId, turnDiffSummaries, proposedPlan],
  );

  const rows = useStableRows(rawRows);

  const sharedState = useMemo<TimelineRowSharedState>(
    () => ({
      onRevertUserMessage,
      onOpenTurnDiff,
      onCopyText: (text: string) => {
        try {
          const h = globalThis as any;
          if (typeof h.__clipboard_set === 'function') {
            h.__clipboard_set(text);
          }
        } catch {
          /* ignore */
        }
      },
    }),
    [onRevertUserMessage, onOpenTurnDiff],
  );

  const activityState = useMemo<TimelineRowActivityState>(
    () => ({ isWorking }),
    [isWorking],
  );

  if (rows.length === 0 && !isWorking) {
    return (
      <Box
        style={{
          flexGrow: 1,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text fontSize={12} color="#444">
          Send a message to start the conversation.
        </Text>
      </Box>
    );
  }

  const reversedRows = [...rows].reverse();

  return (
    <ScrollView showScrollbar style={{ flexGrow: 1, width: '100%' }}>
      <TimelineRowCtx.Provider value={sharedState}>
        <TimelineRowActivityCtx.Provider value={activityState}>
          <Col
            style={{
              flexDirection: 'column-reverse',
              gap: 12,
              paddingTop: 12,
              paddingBottom: 12,
              paddingLeft: 12,
              paddingRight: 12,
            }}
          >
            {reversedRows.map((row) => (
              <Box key={row.id} style={{ width: '100%' }}>
                <TimelineRowContent row={row} />
              </Box>
            ))}
          </Col>
        </TimelineRowActivityCtx.Provider>
      </TimelineRowCtx.Provider>
    </ScrollView>
  );
});
