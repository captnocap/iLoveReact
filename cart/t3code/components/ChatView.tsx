import {
  useMemo, useState, useEffect, useRef, memo, useCallback,
} from 'react';
import {
  Box, Col, Row, Text, Pressable, ScrollView, TextInput,
} from '@reactjit/runtime/primitives';
import type {
  Thread, ChatMessage, TurnId, TurnDiffSummary, SessionPhase,
  ProposedPlan, ProviderInstance, RuntimeMode, InteractionMode,
} from '../types';
import { MessagesTimeline } from './MessagesTimeline';

// ── constants ────────────────────────────────────────────────────────────────

const C = {
  bg: '#0e0e10',
  bgSurface: '#141418',
  border: '#1f1f23',
  text: '#e8e8e8',
  textMuted: '#8a8a95',
  primary: '#3b82f6',
  danger: '#ef4444',
  warning: '#f59e0b',
  success: '#22c55e',
  info: '#3b82f6',
};

// ── helpers ──────────────────────────────────────────────────────────────────

function formatPhaseLabel(phase: SessionPhase): string {
  switch (phase) {
    case 'idle': return 'Idle';
    case 'streaming': return 'Working…';
    case 'failed': return 'Failed';
    case 'starting': return 'Starting…';
    default: return 'Idle';
  }
}

function formatPhaseColor(phase: SessionPhase): string {
  switch (phase) {
    case 'idle': return '#666';
    case 'streaming': return C.primary;
    case 'failed': return C.danger;
    case 'starting': return C.warning;
    default: return '#666';
  }
}

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

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── types ────────────────────────────────────────────────────────────────────

export interface ChatViewProps {
  thread: Thread | null;
  isWorking: boolean;
  phase: SessionPhase;
  error: string | null;
  onSend: (text: string) => void;
  onRevertTurn: (turnId: TurnId) => void;
  onOpenDiff: (turnId: TurnId, filePath?: string) => void;
  showTerminal: boolean;
  onToggleTerminal: () => void;
  turnDiffSummaries: TurnDiffSummary[];
  terminalShortcutLabel?: string;
  provider?: ProviderInstance | null;
}

interface BannerItem {
  id: string;
  variant: 'error' | 'warning' | 'info';
  title: string;
  description?: string;
  dismissLabel?: string;
  onDismiss?: () => void;
}

interface LocalDispatchSnapshot {
  startedAt: number;
  preparingWorktree: boolean;
}

interface PlanSidebarProps {
  plan: ProposedPlan | null;
  open: boolean;
  onClose: () => void;
  activeSteps?: PlanStep[];
}

// ── sub-components ───────────────────────────────────────────────────────────

const ChatHeader = memo(function ChatHeader({
  thread,
  projectName,
  phase,
  showTerminal,
  onToggleTerminal,
  terminalShortcutLabel,
  provider,
  onToggleDiff,
  diffOpen,
  isGitRepo,
  branchName,
  environmentLabel,
}: {
  thread: Thread;
  projectName?: string;
  phase: SessionPhase;
  showTerminal: boolean;
  onToggleTerminal: () => void;
  terminalShortcutLabel?: string;
  provider?: ProviderInstance | null;
  onToggleDiff?: () => void;
  diffOpen?: boolean;
  isGitRepo?: boolean;
  branchName?: string | null;
  environmentLabel?: string | null;
}) {
  return (
    <Row
      style={{
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderColor: C.border,
      }}
    >
      <Row style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0, flexShrink: 1 }}>
        <Text
          style={{
            fontSize: 14,
            fontWeight: '600',
            color: C.text,
            maxWidth: 400,
          }}
          numberOfLines={1}
        >
          {thread.title}
        </Text>
        {projectName && (
          <Box
            style={{
              paddingHorizontal: 6,
              paddingVertical: 2,
              backgroundColor: C.bgSurface,
              borderRadius: 4,
              borderWidth: 1,
              borderColor: '#27272e',
            }}
          >
            <Text style={{ fontSize: 10, color: C.textMuted }}>{projectName}</Text>
          </Box>
        )}
        {environmentLabel && (
          <Box
            style={{
              paddingHorizontal: 6,
              paddingVertical: 2,
              backgroundColor: C.bgSurface,
              borderRadius: 4,
              borderWidth: 1,
              borderColor: '#27272e',
            }}
          >
            <Text style={{ fontSize: 10, color: C.textMuted }}>{environmentLabel}</Text>
          </Box>
        )}
        {branchName && (
          <Box
            style={{
              paddingHorizontal: 6,
              paddingVertical: 2,
              backgroundColor: 'rgba(59,130,246,0.08)',
              borderRadius: 4,
            }}
          >
            <Text style={{ fontSize: 10, color: C.primary }}>{branchName}</Text>
          </Box>
        )}
        {isGitRepo === false && (
          <Box
            style={{
              paddingHorizontal: 6,
              paddingVertical: 2,
              backgroundColor: 'rgba(245,158,11,0.08)',
              borderRadius: 4,
            }}
          >
            <Text style={{ fontSize: 10, color: C.warning }}>No Git</Text>
          </Box>
        )}
        <Box
          style={{
            paddingHorizontal: 6,
            paddingVertical: 2,
            backgroundColor: 'rgba(59,130,246,0.08)',
            borderRadius: 4,
          }}
        >
          <Text style={{ fontSize: 10, color: formatPhaseColor(phase) }}>
            {formatPhaseLabel(phase)}
          </Text>
        </Box>
        {provider && (
          <Box
            style={{
              paddingHorizontal: 6,
              paddingVertical: 2,
              backgroundColor: C.bgSurface,
              borderRadius: 4,
              borderWidth: 1,
              borderColor: '#27272e',
            }}
          >
            <Text style={{ fontSize: 10, color: C.textMuted }}>
              {provider.label} · {provider.model}
            </Text>
          </Box>
        )}
      </Row>

      <Row style={{ alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <Pressable onPress={onToggleTerminal}>
          <Box
            style={{
              paddingHorizontal: 8,
              paddingVertical: 4,
              backgroundColor: showTerminal ? 'rgba(59,130,246,0.12)' : C.bgSurface,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: showTerminal ? 'rgba(59,130,246,0.3)' : '#27272e',
            }}
          >
            <Text style={{ fontSize: 11, color: showTerminal ? C.primary : C.textMuted }}>
              Terminal {terminalShortcutLabel ?? ''}
            </Text>
          </Box>
        </Pressable>
        {onToggleDiff && (
          <Pressable onPress={onToggleDiff}>
            <Box
              style={{
                paddingHorizontal: 8,
                paddingVertical: 4,
                backgroundColor: diffOpen ? 'rgba(59,130,246,0.12)' : C.bgSurface,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: diffOpen ? 'rgba(59,130,246,0.3)' : '#27272e',
              }}
            >
              <Text style={{ fontSize: 11, color: diffOpen ? C.primary : C.textMuted }}>
                Diff
              </Text>
            </Box>
          </Pressable>
        )}
      </Row>
    </Row>
  );
});

const ProviderStatusBanner = memo(function ProviderStatusBanner({
  provider,
}: {
  provider?: ProviderInstance | null;
}) {
  if (!provider || provider.enabled) return null;
  return (
    <Box
      style={{
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: 'rgba(245,158,11,0.06)',
        borderBottomWidth: 1,
        borderColor: 'rgba(245,158,11,0.15)',
      }}
    >
      <Row style={{ alignItems: 'center', gap: 8 }}>
        <Text style={{ fontSize: 12, color: C.warning }}>⚠</Text>
        <Text style={{ fontSize: 12, color: C.text }}>
          {provider.label} provider is disabled.
        </Text>
      </Row>
    </Box>
  );
});

const ThreadErrorBanner = memo(function ThreadErrorBanner({
  error,
  onDismiss,
}: {
  error: string | null;
  onDismiss?: () => void;
}) {
  if (!error) return null;
  return (
    <Box
      style={{
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: 'rgba(239,68,68,0.06)',
        borderBottomWidth: 1,
        borderColor: 'rgba(239,68,68,0.15)',
      }}
    >
      <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Row style={{ alignItems: 'center', gap: 8, flexShrink: 1 }}>
          <Text style={{ fontSize: 12, color: C.danger }}>⚠</Text>
          <Text style={{ fontSize: 12, color: C.text }} numberOfLines={2}>
            {error}
          </Text>
        </Row>
        {onDismiss && (
          <Pressable onPress={onDismiss}>
            <Box
              style={{
                width: 24,
                height: 24,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 12, color: C.textMuted }}>✕</Text>
            </Box>
          </Pressable>
        )}
      </Row>
    </Box>
  );
});

const ComposerBannerStack = memo(function ComposerBannerStack({
  items,
}: {
  items: BannerItem[];
}) {
  const [exitingId, setExitingId] = useState<string | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (exitingId && !items.some((item) => item.id === exitingId)) {
      setExitingId(null);
    }
  }, [exitingId, items]);

  if (items.length === 0) return null;
  const front = items[0];
  if (!front) return null;
  const stack = items.slice(1);

  const requestDismiss = (item: BannerItem) => {
    if (!item.onDismiss || exitingId) return;
    setExitingId(item.id);
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null;
      item.onDismiss?.();
    }, 220);
  };

  return (
    <Col style={{ gap: 8, marginBottom: 8 }}>
      <BannerAlert
        item={front}
        exiting={exitingId === front.id}
        onDismissRequest={() => requestDismiss(front)}
      />
      {stack.map((item) => (
        <BannerAlert
          key={item.id}
          item={item}
          exiting={exitingId === item.id}
          onDismissRequest={() => requestDismiss(item)}
        />
      ))}
    </Col>
  );
});

function BannerAlert({
  item,
  exiting,
  onDismissRequest,
}: {
  item: BannerItem;
  exiting: boolean;
  onDismissRequest: () => void;
}) {
  const bg =
    item.variant === 'error'
      ? 'rgba(239,68,68,0.08)'
      : item.variant === 'warning'
      ? 'rgba(245,158,11,0.08)'
      : 'rgba(59,130,246,0.08)';
  const border =
    item.variant === 'error'
      ? 'rgba(239,68,68,0.2)'
      : item.variant === 'warning'
      ? 'rgba(245,158,11,0.2)'
      : 'rgba(59,130,246,0.2)';
  const titleColor =
    item.variant === 'error' ? C.danger : item.variant === 'warning' ? C.warning : C.primary;

  return (
    <Box
      style={{
        padding: 10,
        backgroundColor: bg,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: border,
        opacity: exiting ? 0.3 : 1,
      }}
    >
      <Row style={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <Col style={{ gap: 4, flexShrink: 1 }}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: titleColor }}>
            {item.title}
          </Text>
          {item.description && (
            <Text style={{ fontSize: 11, color: C.textMuted }} numberOfLines={3}>
              {item.description}
            </Text>
          )}
        </Col>
        {item.onDismiss && (
          <Pressable onPress={onDismissRequest}>
            <Box
              style={{
                width: 22,
                height: 22,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 11, color: C.textMuted }}>✕</Text>
            </Box>
          </Pressable>
        )}
      </Row>
    </Box>
  );
}

const WorkingTimer = memo(function WorkingTimer({ startMs }: { startMs: number | null }) {
  const [label, setLabel] = useState(() => {
    if (!startMs) return 'Working…';
    const elapsed = Date.now() - startMs;
    return formatDuration(elapsed);
  });

  useEffect(() => {
    if (!startMs) return;
    const tick = () => {
      const elapsed = Date.now() - startMs;
      setLabel(formatDuration(elapsed));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startMs]);

  return (
    <Row style={{ alignItems: 'center', gap: 6 }}>
      <Box
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: C.primary,
        }}
      />
      <Text style={{ fontSize: 11, color: C.textMuted }}>{label}</Text>
    </Row>
  );
});

const NoActiveThreadState = memo(function NoActiveThreadState() {
  return (
    <Box style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Col style={{ alignItems: 'center', gap: 12 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: C.text }}>
          No thread selected
        </Text>
        <Text style={{ fontSize: 13, color: '#555' }}>
          Select a thread from the sidebar or press Ctrl+N to create one.
        </Text>
      </Col>
    </Box>
  );
});

const ScrollToBottomButton = memo(function ScrollToBottomButton({
  onPress,
}: {
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress}>
      <Box
        style={{
          position: 'absolute',
          bottom: 12,
          left: '50%',
          transform: [{ translateX: -60 }],
          paddingHorizontal: 12,
          paddingVertical: 6,
          backgroundColor: C.bgSurface,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: '#27272e',
          zIndex: 30,
        }}
      >
        <Row style={{ alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 11, color: C.textMuted }}>↓</Text>
          <Text style={{ fontSize: 11, color: C.text }}>Scroll to bottom</Text>
        </Row>
      </Box>
    </Pressable>
  );
});

const PlanSidebarPanel = memo(function PlanSidebarPanel({
  plan,
  open,
  onClose,
}: PlanSidebarProps) {
  if (!open || !plan) return null;
  return (
    <Box
      style={{
        width: 280,
        borderLeftWidth: 1,
        borderColor: C.border,
        backgroundColor: C.bg,
      }}
    >
      <Col style={{ padding: 12, gap: 10, height: '100%' }}>
        <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: C.text }}>
            {plan.title}
          </Text>
          <Pressable onPress={onClose}>
            <Text style={{ fontSize: 12, color: C.textMuted }}>✕</Text>
          </Pressable>
        </Row>
        <Text style={{ fontSize: 11, color: C.textMuted }}>{plan.description}</Text>
        <ScrollView style={{ flexGrow: 1 }}>
          <Col style={{ gap: 6 }}>
            {plan.steps.map((step) => (
              <Row key={step.id} style={{ alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 11, color: C.textMuted }}>
                  {step.status === 'done' ? '✓' : step.status === 'skipped' ? '⊘' : '○'}
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: step.status === 'done' ? C.textMuted : C.text,
                    textDecorationLine: step.status === 'skipped' ? 'line-through' : 'none',
                  }}
                >
                  {step.description}
                </Text>
              </Row>
            ))}
          </Col>
        </ScrollView>
        <Row style={{ justifyContent: 'flex-end', gap: 8 }}>
          <Pressable onPress={onClose}>
            <Box
              style={{
                paddingHorizontal: 10,
                paddingVertical: 5,
                backgroundColor: C.bgSurface,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: '#27272e',
              }}
            >
              <Text style={{ fontSize: 11, color: C.text }}>Close</Text>
            </Box>
          </Pressable>
        </Row>
      </Col>
    </Box>
  );
});

const ExpandedImageDialog = memo(function ExpandedImageDialog({
  previewUrl,
  onClose,
}: {
  previewUrl: string;
  onClose: () => void;
}) {
  return (
    <Pressable onPress={onClose}>
      <Box
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(0,0,0,0.85)',
          zIndex: 100,
        }}
      >
        <Box
          style={{
            width: '80%',
            height: '80%',
            backgroundImage: previewUrl,
            backgroundSize: 'contain',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
          }}
        />
      </Box>
    </Pressable>
  );
});

const RevertConfirmDialog = memo(function RevertConfirmDialog({
  turnCount,
  onConfirm,
  onCancel,
}: {
  turnCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Box
      style={{
        position: 'absolute',
        inset: 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.7)',
        zIndex: 100,
      }}
    >
      <Box
        style={{
          width: 360,
          padding: 20,
          backgroundColor: C.bgSurface,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: C.border,
          gap: 12,
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: '600', color: C.text }}>
          Revert to checkpoint {turnCount}?
        </Text>
        <Text style={{ fontSize: 12, color: C.textMuted }}>
          This will discard newer messages and turn diffs in this thread. This action cannot be undone.
        </Text>
        <Row style={{ justifyContent: 'flex-end', gap: 8 }}>
          <Pressable onPress={onCancel}>
            <Box
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                backgroundColor: C.bgSurface,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              <Text style={{ fontSize: 12, color: C.text }}>Cancel</Text>
            </Box>
          </Pressable>
          <Pressable onPress={onConfirm}>
            <Box
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                backgroundColor: C.danger,
                borderRadius: 6,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#fff' }}>
                Revert
              </Text>
            </Box>
          </Pressable>
        </Row>
      </Box>
    </Box>
  );
});

const PullRequestDialog = memo(function PullRequestDialog({
  open,
  onClose,
  onCheckout,
}: {
  open: boolean;
  onClose: () => void;
  onCheckout: (reference: string) => void;
}) {
  const [reference, setReference] = useState('');
  if (!open) return null;
  return (
    <Box
      style={{
        position: 'absolute',
        inset: 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.7)',
        zIndex: 100,
      }}
    >
      <Box
        style={{
          width: 400,
          padding: 20,
          backgroundColor: C.bgSurface,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: C.border,
          gap: 12,
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: '600', color: C.text }}>
          Checkout pull request
        </Text>
        <Text style={{ fontSize: 12, color: C.textMuted }}>
          Enter a PR reference (e.g. #123 or branch name)
        </Text>
        <TextInput
          value={reference}
          onChange={setReference}
          placeholder="#123"
          style={{
            padding: 8,
            fontSize: 13,
            color: C.text,
            backgroundColor: C.bg,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: C.border,
          }}
          onSubmit={() => {
            if (reference.trim()) {
              onCheckout(reference.trim());
              setReference('');
            }
          }}
        />
        <Row style={{ justifyContent: 'flex-end', gap: 8 }}>
          <Pressable onPress={onClose}>
            <Box
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                backgroundColor: C.bgSurface,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              <Text style={{ fontSize: 12, color: C.text }}>Cancel</Text>
            </Box>
          </Pressable>
          <Pressable
            onPress={() => {
              if (reference.trim()) {
                onCheckout(reference.trim());
                setReference('');
              }
            }}
          >
            <Box
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                backgroundColor: C.primary,
                borderRadius: 6,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#fff' }}>
                Checkout
              </Text>
            </Box>
          </Pressable>
        </Row>
      </Box>
    </Box>
  );
});

// ── useLocalDispatchState hook equivalent ────────────────────────────────────

function useLocalDispatchState({
  activeThread,
  phase,
}: {
  activeThread: Thread | null;
  phase: SessionPhase;
}) {
  const [localDispatch, setLocalDispatch] = useState<LocalDispatchSnapshot | null>(null);

  const beginLocalDispatch = useCallback((options?: { preparingWorktree?: boolean }) => {
    const preparingWorktree = Boolean(options?.preparingWorktree);
    setLocalDispatch((current) => {
      if (current) {
        return current.preparingWorktree === preparingWorktree
          ? current
          : { ...current, preparingWorktree };
      }
      return {
        startedAt: Date.now(),
        preparingWorktree,
      };
    });
  }, []);

  const resetLocalDispatch = useCallback(() => {
    setLocalDispatch(null);
  }, []);

  const serverAcknowledged = useMemo(() => {
    if (!localDispatch) return false;
    if (phase === 'idle' || phase === 'failed') return true;
    return false;
  }, [localDispatch, phase]);

  useEffect(() => {
    if (!serverAcknowledged) return;
    resetLocalDispatch();
  }, [serverAcknowledged, resetLocalDispatch]);

  return {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt: localDispatch?.startedAt ?? null,
    isPreparingWorktree: localDispatch?.preparingWorktree ?? false,
    isSendBusy: localDispatch !== null && !serverAcknowledged,
  };
}

// ── main component ───────────────────────────────────────────────────────────

export default function ChatView(props: ChatViewProps) {
  const {
    thread,
    isWorking,
    phase,
    error,
    onRevertTurn,
    onOpenDiff,
    showTerminal,
    onToggleTerminal,
    turnDiffSummaries,
    terminalShortcutLabel,
    provider,
  } = props;

  // ── refs ─────────────────────────────────────────────────────────────
  const isAtEndRef = useRef(true);
  const planSidebarDismissedForTurnRef = useRef<string | null>(null);
  const planSidebarOpenOnNextThreadRef = useRef(false);
  const sendInFlightRef = useRef(false);
  const showScrollDebouncerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── state ────────────────────────────────────────────────────────────
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<ChatMessage[]>([]);
  const optimisticMessagesRef = useRef(optimisticUserMessages);
  optimisticMessagesRef.current = optimisticUserMessages;

  const [isRevertingCheckpoint, setIsRevertingCheckpoint] = useState(false);
  const [planSidebarOpen, setPlanSidebarOpen] = useState(false);
  const [pullRequestDialogState, setPullRequestDialogState] = useState<{
    open: boolean;
    reference: string | null;
  } | null>(null);
  const [dismissedVersionMismatch, setDismissedVersionMismatch] = useState(false);
  const [environmentUnavailableDismissed, setEnvironmentUnavailableDismissed] = useState(false);
  const [revertDialog, setRevertDialog] = useState<{
    turnCount: number;
    turnId: TurnId;
  } | null>(null);

  // Local dispatch (optimistic send state)
  const {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt,
    isPreparingWorktree,
    isSendBusy,
  } = useLocalDispatchState({ activeThread: thread, phase });

  // ── derived ──────────────────────────────────────────────────────────
  const activeTurnId = useMemo<TurnId | null>(() => {
    if (!isWorking) return null;
    const lastUser = [...(thread?.messages ?? [])].reverse().find((m) => m.kind === 'user');
    return lastUser?.turnId ?? null;
  }, [isWorking, thread?.messages]);

  const activeLatestTurn = useMemo(() => {
    if (!thread?.messages.length) return null;
    const turnIds = [...new Set(thread.messages.map((m) => m.turnId).filter((t): t is TurnId => t != null))];
    const latestTurnId = turnIds[turnIds.length - 1] ?? null;
    const turnMessages = latestTurnId ? thread.messages.filter((m) => m.turnId === latestTurnId) : [];
    const first = turnMessages[0];
    const last = turnMessages[turnMessages.length - 1];
    if (!first || !last) return null;
    return {
      turnId: latestTurnId,
      startedAt: first.createdAt,
      completedAt: phase === 'idle' || phase === 'failed' ? last.createdAt : undefined,
    };
  }, [thread?.messages, phase]);

  const latestTurnSettled = useMemo(() => {
    if (!activeLatestTurn) return true;
    return phase !== 'streaming' && phase !== 'starting';
  }, [activeLatestTurn, phase]);

  const activeWorkStartedAt = useMemo(() => {
    if (!isWorking) return null;
    return activeLatestTurn?.startedAt ?? localDispatchStartedAt ?? Date.now();
  }, [isWorking, activeLatestTurn?.startedAt, localDispatchStartedAt]);

  const completionSummary = useMemo(() => {
    if (!latestTurnSettled || !activeLatestTurn?.startedAt || !activeLatestTurn.completedAt) {
      return null;
    }
    const elapsed = formatElapsed(activeLatestTurn.startedAt, activeLatestTurn.completedAt);
    return elapsed ? `Worked for ${elapsed}` : null;
  }, [latestTurnSettled, activeLatestTurn]);

  const activeProposedPlan = useMemo(() => {
    if (!latestTurnSettled) return null;
    return thread?.proposedPlans?.find((p) => p.status === 'pending') ?? null;
  }, [latestTurnSettled, thread?.proposedPlans]);

  const sidebarProposedPlan = activeProposedPlan;
  const activePlan = useMemo(() => {
    if (!activeLatestTurn?.turnId) return null;
    const plan = thread?.proposedPlans?.find(
      (p) => p.status === 'accepted' || p.status === 'pending',
    );
    if (!plan) return null;
    return { turnId: activeLatestTurn.turnId };
  }, [activeLatestTurn?.turnId, thread?.proposedPlans]);

  const planSidebarLabel = sidebarProposedPlan || thread?.interactionMode === 'plan' ? 'Plan' : 'Tasks';
  const showPlanFollowUpPrompt =
    latestTurnSettled && thread?.interactionMode === 'plan' && activeProposedPlan !== null;

  // Timeline messages (including optimistic)
  const timelineMessages = useMemo(() => {
    const serverMessages = thread?.messages ?? [];
    if (optimisticUserMessages.length === 0) return serverMessages;
    const serverIds = new Set(serverMessages.map((m) => m.id));
    const pending = optimisticUserMessages.filter((m) => !serverIds.has(m.id));
    if (pending.length === 0) return serverMessages;
    return [...serverMessages, ...pending];
  }, [thread?.messages, optimisticUserMessages]);

  // Revert turn count by user message id
  const revertTurnCountByUserMessageId = useMemo(() => {
    const byId = new Map<string, number>();
    const chatMessages = timelineMessages.filter(
      (m): m is ChatMessage & { kind: 'user' | 'assistant' } => m.kind === 'user' || m.kind === 'assistant',
    );
    let userIndex = 0;
    for (let i = 0; i < chatMessages.length; i++) {
      const msg = chatMessages[i];
      if (msg.kind !== 'user') continue;
      userIndex += 1;
      for (let j = i + 1; j < chatMessages.length; j++) {
        const next = chatMessages[j];
        if (next.kind === 'user') break;
        const summary = turnDiffSummaries.find((s) => s.turnId === next.turnId);
        if (!summary) continue;
        byId.set(msg.id, Math.max(0, userIndex - 1));
        break;
      }
    }
    return byId;
  }, [timelineMessages, turnDiffSummaries]);

  // Banner items
  const bannerItems = useMemo<BannerItem[]>(() => {
    const items: BannerItem[] = [];
    if (error) {
      items.push({
        id: 'thread-error',
        variant: 'error',
        title: 'Thread error',
        description: error,
      });
    }
    if (provider && !provider.enabled) {
      items.push({
        id: 'provider-disabled',
        variant: 'warning',
        title: `${provider.label} provider disabled`,
        description: 'Enable this provider in settings to use it.',
      });
    }
    if (!dismissedVersionMismatch) {
      items.push({
        id: 'version-mismatch',
        variant: 'warning',
        title: 'Client and server versions differ',
        description: 'Sync them if RPC calls or reconnects fail.',
        onDismiss: () => setDismissedVersionMismatch(true),
      });
    }
    if (thread?.environmentId === 'disconnected' && !environmentUnavailableDismissed) {
      items.push({
        id: 'environment-unavailable',
        variant: 'error',
        title: 'Environment disconnected',
        description: 'Reconnect this environment before sending messages or running actions.',
        onDismiss: () => setEnvironmentUnavailableDismissed(true),
      });
    }
    return items;
  }, [error, provider, dismissedVersionMismatch, environmentUnavailableDismissed, thread?.environmentId]);

  // ── effects ──────────────────────────────────────────────────────────

  // Reset state on thread change
  useEffect(() => {
    setIsRevertingCheckpoint(false);
    setShowScrollToBottom(false);
    isAtEndRef.current = true;
    setExpandedImage(null);
    setPullRequestDialogState(null);
    setRevertDialog(null);
    setOptimisticUserMessages((existing) => {
      if (existing.length === 0) return existing;
      return [];
    });
    resetLocalDispatch();
    if (planSidebarOpenOnNextThreadRef.current) {
      planSidebarOpenOnNextThreadRef.current = false;
      setPlanSidebarOpen(true);
    } else {
      setPlanSidebarOpen(false);
    }
    planSidebarDismissedForTurnRef.current = null;
    setDismissedVersionMismatch(false);
    setEnvironmentUnavailableDismissed(false);
  }, [thread?.id, resetLocalDispatch]);

  // Auto-open plan sidebar
  useEffect(() => {
    const autoOpen = thread?.settings?.autoOpenPlanSidebar ?? false;
    if (!autoOpen && thread?.interactionMode !== 'plan') return;
    if (!activePlan) return;
    if (planSidebarOpen) return;
    const latestTurnId = activeLatestTurn?.turnId ?? null;
    if (latestTurnId && activePlan.turnId !== latestTurnId) return;
    const turnKey = activePlan.turnId ?? sidebarProposedPlan?.id ?? '__dismissed__';
    if (planSidebarDismissedForTurnRef.current === turnKey) return;
    setPlanSidebarOpen(true);
  }, [activePlan, activeLatestTurn?.turnId, planSidebarOpen, sidebarProposedPlan?.id, thread?.interactionMode, thread?.settings?.autoOpenPlanSidebar]);

  // Sync optimistic messages with server
  useEffect(() => {
    if (!thread?.messages.length) return;
    const serverIds = new Set(thread.messages.map((m) => m.id));
    const toRemove = optimisticUserMessages.filter((m) => serverIds.has(m.id));
    if (toRemove.length === 0) return;
    const timer = setTimeout(() => {
      setOptimisticUserMessages((existing) =>
        existing.filter((m) => !serverIds.has(m.id)),
      );
    }, 0);
    return () => clearTimeout(timer);
  }, [thread?.messages, optimisticUserMessages]);

  // ── callbacks ────────────────────────────────────────────────────────

  const handleScroll = useCallback((e: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } }) => {
    const { contentOffset, contentSize, layoutMeasurement } = e;
    const isNearBottom = contentSize.height - contentOffset.y - layoutMeasurement.height < 60;
    isAtEndRef.current = isNearBottom;
    if (isNearBottom) {
      if (showScrollDebouncerRef.current) {
        clearTimeout(showScrollDebouncerRef.current);
        showScrollDebouncerRef.current = null;
      }
      setShowScrollToBottom(false);
    } else {
      if (!showScrollDebouncerRef.current) {
        showScrollDebouncerRef.current = setTimeout(() => {
          showScrollDebouncerRef.current = null;
          if (!isAtEndRef.current) {
            setShowScrollToBottom(true);
          }
        }, 150);
      }
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    isAtEndRef.current = true;
    setShowScrollToBottom(false);
    if (showScrollDebouncerRef.current) {
      clearTimeout(showScrollDebouncerRef.current);
      showScrollDebouncerRef.current = null;
    }
  }, []);

  const onRevertUserMessage = useCallback(
    (messageId: string) => {
      const turnCount = revertTurnCountByUserMessageId.get(messageId);
      if (typeof turnCount !== 'number') return;
      const msg = thread?.messages.find((m) => m.id === messageId);
      if (msg?.turnId) {
        setRevertDialog({ turnCount, turnId: msg.turnId });
      }
    },
    [revertTurnCountByUserMessageId, thread?.messages],
  );

  const handleConfirmRevert = useCallback(() => {
    if (!revertDialog) return;
    setIsRevertingCheckpoint(true);
    onRevertTurn(revertDialog.turnId);
    setRevertDialog(null);
    setTimeout(() => setIsRevertingCheckpoint(false), 500);
  }, [revertDialog, onRevertTurn]);

  const onExpandTimelineImage = useCallback((url: string) => {
    setExpandedImage(url);
  }, []);

  const closeExpandedImage = useCallback(() => {
    setExpandedImage(null);
  }, []);

  const togglePlanSidebar = useCallback(() => {
    setPlanSidebarOpen((open) => {
      if (open) {
        planSidebarDismissedForTurnRef.current =
          activePlan?.turnId ?? sidebarProposedPlan?.id ?? '__dismissed__';
      } else {
        planSidebarDismissedForTurnRef.current = null;
      }
      return !open;
    });
  }, [activePlan?.turnId, sidebarProposedPlan?.id]);

  const closePlanSidebar = useCallback(() => {
    setPlanSidebarOpen(false);
    planSidebarDismissedForTurnRef.current =
      activePlan?.turnId ?? sidebarProposedPlan?.id ?? '__dismissed__';
  }, [activePlan?.turnId, sidebarProposedPlan?.id]);

  const openPullRequestDialog = useCallback(() => {
    setPullRequestDialogState({ open: true, reference: null });
  }, []);

  const closePullRequestDialog = useCallback(() => {
    setPullRequestDialogState(null);
  }, []);

  const handleCheckoutPullRequest = useCallback((reference: string) => {
    closePullRequestDialog();
    // In a full port this would checkout the PR branch
  }, [closePullRequestDialog]);

  const handleDismissError = useCallback(() => {
    // In a full port this clears thread error via store
  }, []);

  // ── render ───────────────────────────────────────────────────────────

  if (!thread) {
    return (
      <Box style={{ width: '100%', height: '100%', backgroundColor: C.bg }}>
        <NoActiveThreadState />
      </Box>
    );
  }

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: C.bg, flexDirection: 'row' }}>
      {/* Main chat column */}
      <Col style={{ flexGrow: 1, minWidth: 0, minHeight: 0 }}>
        {/* Header */}
        <ChatHeader
          thread={thread}
          projectName={thread.projectId}
          phase={phase}
          showTerminal={showTerminal}
          onToggleTerminal={onToggleTerminal}
          terminalShortcutLabel={terminalShortcutLabel}
          provider={provider}
          onToggleDiff={() => onOpenDiff(activeTurnId ?? '')}
          diffOpen={false}
          isGitRepo={true}
          branchName={null}
          environmentLabel={thread.environmentId}
        />

        {/* Banners */}
        <ProviderStatusBanner provider={provider} />
        <ThreadErrorBanner error={error} onDismiss={handleDismissError} />

        {/* Messages area */}
        <Box style={{ flexGrow: 1, minHeight: 0, position: 'relative', flexDirection: 'row' }}>
          <Col style={{ flexGrow: 1, minWidth: 0, minHeight: 0 }}>
            {/* Composer banner stack above messages */}
            <Box style={{ paddingHorizontal: 12, paddingTop: 8 }}>
              <ComposerBannerStack items={bannerItems} />
            </Box>

            {/* Working timer when active */}
            {isWorking && activeWorkStartedAt && (
              <Box style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
                <WorkingTimer startMs={activeWorkStartedAt} />
              </Box>
            )}

            {/* Messages timeline */}
            <Box style={{ flexGrow: 1, minHeight: 0 }}>
              <MessagesTimeline
                messages={timelineMessages}
                isWorking={isWorking}
                activeTurnId={activeTurnId}
                onRevertUserMessage={onRevertUserMessage}
                onOpenTurnDiff={onOpenDiff}
                turnDiffSummaries={turnDiffSummaries}
              />
            </Box>

            {/* Scroll to bottom */}
            {showScrollToBottom && <ScrollToBottomButton onPress={scrollToBottom} />}
          </Col>

          {/* Inline plan sidebar */}
          <PlanSidebarPanel
            plan={activeProposedPlan}
            open={planSidebarOpen}
            onClose={closePlanSidebar}
          />
        </Box>
      </Col>

      {/* Expanded image overlay */}
      {expandedImage && (
        <ExpandedImageDialog previewUrl={expandedImage} onClose={closeExpandedImage} />
      )}

      {/* Revert confirmation dialog */}
      {revertDialog && (
        <RevertConfirmDialog
          turnCount={revertDialog.turnCount}
          onConfirm={handleConfirmRevert}
          onCancel={() => setRevertDialog(null)}
        />
      )}

      {/* Pull request dialog */}
      {pullRequestDialogState?.open && (
        <PullRequestDialog
          open={pullRequestDialogState.open}
          onClose={closePullRequestDialog}
          onCheckout={handleCheckoutPullRequest}
        />
      )}
    </Box>
  );
}
