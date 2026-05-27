import { useMemo, useState, memo } from 'react';
import { Box, Col, Row, Text, Pressable } from '@reactjit/runtime/primitives';
import type { SessionPhase } from '../types';

// ── logic ported from BranchToolbar.logic.ts ───────────────────────────────

export type EnvMode = 'local' | 'worktree';

export interface EnvironmentOption {
  environmentId: string;
  label: string;
  isPrimary: boolean;
}

export function resolveEnvModeLabel(mode: EnvMode): string {
  return mode === 'worktree' ? 'New worktree' : 'Current checkout';
}

export function resolveCurrentWorkspaceLabel(activeWorktreePath: string | null): string {
  return activeWorktreePath ? 'Current worktree' : resolveEnvModeLabel('local');
}

export function resolveLockedWorkspaceLabel(activeWorktreePath: string | null): string {
  return activeWorktreePath ? 'Worktree' : 'Local checkout';
}

export function resolveEffectiveEnvMode(input: {
  activeWorktreePath: string | null;
  hasServerThread: boolean;
  draftThreadEnvMode: EnvMode | undefined;
}): EnvMode {
  const { activeWorktreePath, hasServerThread, draftThreadEnvMode } = input;
  if (!hasServerThread) {
    if (activeWorktreePath) {
      return 'local';
    }
    return draftThreadEnvMode === 'worktree' ? 'worktree' : 'local';
  }
  return activeWorktreePath ? 'worktree' : 'local';
}

export function resolveBranchToolbarValue(input: {
  envMode: EnvMode;
  activeWorktreePath: string | null;
  activeThreadBranch: string | null;
  currentGitBranch: string | null;
}): string | null {
  const { envMode, activeWorktreePath, activeThreadBranch, currentGitBranch } = input;
  if (envMode === 'worktree' && !activeWorktreePath) {
    return activeThreadBranch ?? currentGitBranch;
  }
  return currentGitBranch ?? activeThreadBranch;
}

// ── sub-components ─────────────────────────────────────────────────────────

function ModelBadge({
  instanceId,
  model,
  providerLabel,
}: {
  instanceId?: string;
  model?: string;
  providerLabel?: string | null;
}) {
  const label = providerLabel || instanceId || 'Unknown';
  return (
    <Box
      style={{
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: '#333',
        backgroundColor: '#1a1a1e',
      }}
    >
      <Text fontSize={10} color="#888">
        {label} • {model || 'unknown'}
      </Text>
    </Box>
  );
}

function PhaseBadge({ phase }: { phase: SessionPhase }) {
  const colors: Record<SessionPhase, string> = {
    idle: '#666',
    streaming: '#3b82f6',
    failed: '#ef4444',
    starting: '#eab308',
  };
  const labels: Record<SessionPhase, string> = {
    idle: 'Idle',
    streaming: 'Streaming',
    failed: 'Failed',
    starting: 'Starting',
  };
  return (
    <Box
      style={{
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 4,
        backgroundColor: colors[phase] + '20',
        borderWidth: 1,
        borderColor: colors[phase] + '40',
      }}
    >
      <Text fontSize={10} color={colors[phase]}>
        {labels[phase]}
      </Text>
    </Box>
  );
}

function GitStatusBadge({
  isGitRepo,
  branchName,
}: {
  isGitRepo?: boolean;
  branchName?: string | null;
}) {
  if (isGitRepo === false) {
    return (
      <Box
        style={{
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: 4,
          borderWidth: 1,
          borderColor: '#451a03',
          backgroundColor: '#451a0320',
        }}
      >
        <Text fontSize={10} color="#d97706">
          No Git
        </Text>
      </Box>
    );
  }
  if (branchName) {
    return (
      <Box
        style={{
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: 4,
          borderWidth: 1,
          borderColor: '#333',
          backgroundColor: '#1a1a1e',
        }}
      >
        <Text fontSize={10} color="#888">
          {branchName}
        </Text>
      </Box>
    );
  }
  return null;
}

function TerminalToggle({
  open,
  available,
  onToggle,
}: {
  open: boolean;
  available?: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        if (available !== false) onToggle();
      }}
    >
      <Box
        style={{
          padding: 6,
          borderRadius: 4,
          borderWidth: 1,
          borderColor: open ? '#555' : '#333',
          backgroundColor: open ? '#2a2a30' : 'transparent',
          opacity: available === false ? 0.4 : 1,
        }}
      >
        <Text fontSize={10} color="#aaa">
          Terminal
        </Text>
      </Box>
    </Pressable>
  );
}

function DiffToggle({
  open,
  disabled,
  onToggle,
}: {
  open: boolean;
  disabled?: boolean;
  onToggle?: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        if (!disabled && onToggle) onToggle();
      }}
    >
      <Box
        style={{
          padding: 6,
          borderRadius: 4,
          borderWidth: 1,
          borderColor: open ? '#555' : '#333',
          backgroundColor: open ? '#2a2a30' : 'transparent',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        <Text fontSize={10} color="#aaa">
          Diff
        </Text>
      </Box>
    </Pressable>
  );
}

function EnvironmentSelector({
  environments,
  activeId,
  onChange,
  locked,
}: {
  environments?: { id: string; label: string; isPrimary: boolean }[];
  activeId?: string;
  onChange?: (id: string) => void;
  locked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const active = environments?.find((e) => e.id === activeId);

  if (!environments || environments.length <= 1) return null;

  return (
    <Box style={{ position: 'relative' }}>
      <Pressable
        onPress={() => {
          if (!locked) setOpen((v) => !v);
        }}
      >
        <Box
          style={{
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 4,
            borderWidth: 1,
            borderColor: '#333',
            backgroundColor: '#1a1a1e',
          }}
        >
          <Text fontSize={10} color="#aaa">
            {active?.label || 'Env'}
          </Text>
        </Box>
      </Pressable>
      {open && (
        <Col
          style={{
            position: 'absolute',
            top: 28,
            left: 0,
            backgroundColor: '#1a1a1e',
            borderWidth: 1,
            borderColor: '#333',
            borderRadius: 4,
            padding: 4,
            gap: 2,
            zIndex: 10,
            minWidth: 120,
          }}
        >
          {environments.map((env) => (
            <Pressable
              key={env.id}
              onPress={() => {
                onChange?.(env.id);
                setOpen(false);
              }}
            >
              <Box
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 4,
                  backgroundColor: env.id === activeId ? '#2a2a30' : 'transparent',
                }}
              >
                <Text
                  fontSize={10}
                  color={env.id === activeId ? '#e8e8e8' : '#aaa'}
                >
                  {env.isPrimary ? '🖥 ' : '☁ '}
                  {env.label}
                </Text>
              </Box>
            </Pressable>
          ))}
        </Col>
      )}
    </Box>
  );
}

function BranchSelector({
  branchName,
}: {
  branchName?: string | null;
}) {
  return (
    <Box
      style={{
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: '#333',
        backgroundColor: '#1a1a1e',
        minWidth: 0,
        flexShrink: 1,
      }}
    >
      <Text
        fontSize={10}
        color="#888"
        style={{
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {branchName || 'No branch'}
      </Text>
    </Box>
  );
}

// ── props ──────────────────────────────────────────────────────────────────

export interface ChatHeaderProps {
  threadTitle: string;
  modelSelection?: { instanceId: string; model: string } | null;
  providerLabel?: string | null;
  phase: SessionPhase;
  projectName?: string | null;
  isGitRepo?: boolean;
  gitBranch?: string | null;
  terminalOpen: boolean;
  terminalAvailable?: boolean;
  onToggleTerminal: () => void;
  diffOpen?: boolean;
  onToggleDiff?: () => void;
  environments?: { id: string; label: string; isPrimary: boolean }[];
  activeEnvironmentId?: string;
  onEnvironmentChange?: (id: string) => void;
  branchName?: string | null;
  onBranchChange?: (branch: string) => void;
}

// ── main component ─────────────────────────────────────────────────────────

export const ChatHeader = memo(function ChatHeader(props: ChatHeaderProps) {
  const {
    threadTitle,
    modelSelection,
    providerLabel,
    phase,
    projectName,
    isGitRepo,
    gitBranch,
    terminalOpen,
    terminalAvailable,
    onToggleTerminal,
    diffOpen,
    onToggleDiff,
    environments,
    activeEnvironmentId,
    onEnvironmentChange,
    branchName,
  } = props;

  const showEnvironmentPicker = Boolean(
    environments && environments.length > 1 && onEnvironmentChange,
  );

  return (
    <Col
      style={{
        borderBottomWidth: 1,
        borderColor: '#1f1f23',
        backgroundColor: '#0e0e10',
      }}
    >
      {/* Top row: title, badges, toggles */}
      <Row
        style={{
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
          minWidth: 0,
        }}
      >
        {/* Left cluster */}
        <Row
          style={{
            alignItems: 'center',
            gap: 8,
            flexShrink: 1,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <Text
            fontSize={14}
            color="#e8e8e8"
            style={{
              fontWeight: 'bold',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {threadTitle}
          </Text>
          {projectName && (
            <Box
              style={{
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 4,
                borderWidth: 1,
                borderColor: '#333',
                backgroundColor: '#1a1a1e',
              }}
            >
              <Text fontSize={10} color="#888">
                {projectName}
              </Text>
            </Box>
          )}
          <ModelBadge
            instanceId={modelSelection?.instanceId}
            model={modelSelection?.model}
            providerLabel={providerLabel}
          />
          <GitStatusBadge isGitRepo={isGitRepo} branchName={gitBranch} />
        </Row>

        {/* Right cluster */}
        <Row
          style={{
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <PhaseBadge phase={phase} />
          {showEnvironmentPicker && (
            <EnvironmentSelector
              environments={environments}
              activeId={activeEnvironmentId}
              onChange={onEnvironmentChange}
            />
          )}
          <TerminalToggle
            open={terminalOpen}
            available={terminalAvailable}
            onToggle={onToggleTerminal}
          />
          <DiffToggle
            open={diffOpen ?? false}
            disabled={isGitRepo === false && !diffOpen}
            onToggle={onToggleDiff}
          />
        </Row>
      </Row>

      {/* Branch toolbar row */}
      <Row
        style={{
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 12,
          paddingBottom: 8,
          minWidth: 0,
        }}
      >
        <Row
          style={{
            alignItems: 'center',
            gap: 8,
            flexShrink: 1,
            minWidth: 0,
          }}
        >
          {showEnvironmentPicker && environments && onEnvironmentChange && (
            <>
              <EnvironmentSelector
                environments={environments}
                activeId={activeEnvironmentId}
                onChange={onEnvironmentChange}
              />
              <Box
                style={{
                  width: 1,
                  height: 14,
                  backgroundColor: '#333',
                }}
              />
            </>
          )}
          <BranchSelector branchName={branchName} />
        </Row>
      </Row>
    </Col>
  );
});
