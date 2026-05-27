// T3 Code — Sidebar (1:1 behavior port)
//
// Ported from /tmp/t3code/apps/web/src/components/Sidebar.tsx and
// Sidebar.logic.ts.  Uses @reactjit/runtime/primitives.  Dark theme,
// monospace fonts.  All interaction state is kept locally; data flows
// through the props interface only.

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Box, Col, Row, Text, Pressable, ScrollView, TextInput } from '@reactjit/runtime/primitives';
import type { Thread, Project, ThreadId, Settings } from '../types';

// ── constants ──────────────────────────────────────────────────────────────

const PREVIEW_COUNT = 5;

const C = {
  bg: '#0e0e10',
  panel: '#1a1a1f',
  border: '#2a2a30',
  text: '#e8e8e8',
  textMuted: '#888888',
  textDim: '#555555',
  accent: '#3b82f6',
  accentHover: '#2563eb',
  activeRowBg: '#1e2030',
  selectedRowBg: '#2a2a35',
  hoverRowBg: '#252530',
  danger: '#ef4444',
  dangerHover: '#dc2626',
} as const;

// ── props ──────────────────────────────────────────────────────────────────

interface SidebarProps {
  threads: Thread[];
  projects: Project[];
  activeThreadId: ThreadId | null;
  settings: Settings;
  onSelectThread: (id: ThreadId) => void;
  onNewThread: (projectId: string) => void;
  onArchiveThread: (id: ThreadId) => void;
  onDeleteThread: (id: ThreadId) => void;
  onRenameThread: (id: ThreadId, title: string) => void;
  onOpenSettings: () => void;
  onOpenCommandPalette: () => void;
  terminalOpenByThreadId: Record<ThreadId, boolean>;
}

// ── sort logic (adapted from threadSort.ts) ────────────────────────────────

function toSortableTimestamp(ts: number | undefined): number | null {
  if (ts === undefined || Number.isNaN(ts)) return null;
  return ts;
}

function getLatestUserMessageTimestamp(thread: Thread): number {
  let latest: number | null = null;
  for (const m of thread.messages) {
    if (m.kind !== 'user') continue;
    const t = toSortableTimestamp(m.createdAt);
    if (t === null) continue;
    latest = latest === null ? t : Math.max(latest, t);
  }
  if (latest !== null) return latest;
  return toSortableTimestamp(thread.updatedAt) ?? Number.NEGATIVE_INFINITY;
}

function getThreadSortTimestamp(
  thread: Thread,
  sortOrder: Settings['sidebarThreadSortOrder'],
): number {
  if (sortOrder === 'created_at') {
    return toSortableTimestamp(thread.createdAt) ?? Number.NEGATIVE_INFINITY;
  }
  return getLatestUserMessageTimestamp(thread);
}

function sortThreads(
  threads: readonly Thread[],
  sortOrder: Settings['sidebarThreadSortOrder'],
): Thread[] {
  return [...threads].sort((left, right) => {
    const rt = getThreadSortTimestamp(right, sortOrder);
    const lt = getThreadSortTimestamp(left, sortOrder);
    if (rt !== lt) return rt > lt ? 1 : -1;
    return right.id.localeCompare(left.id);
  });
}

function getProjectSortTimestamp(
  project: Project,
  projectThreads: readonly Thread[],
  sortOrder: Exclude<Settings['sidebarProjectSortOrder'], 'manual'>,
): number {
  if (projectThreads.length > 0) {
    return projectThreads.reduce(
      (latest, thread) => Math.max(latest, getThreadSortTimestamp(thread, sortOrder)),
      Number.NEGATIVE_INFINITY,
    );
  }
  if (sortOrder === 'created_at') {
    return toSortableTimestamp(project.createdAt) ?? Number.NEGATIVE_INFINITY;
  }
  return toSortableTimestamp(project.updatedAt ?? project.createdAt) ?? Number.NEGATIVE_INFINITY;
}

function sortProjects(
  projects: readonly Project[],
  threads: readonly Thread[],
  sortOrder: Settings['sidebarProjectSortOrder'],
): Project[] {
  if (sortOrder === 'manual') return [...projects];

  const threadsByProjectId = new Map<string, Thread[]>();
  for (const t of threads) {
    const arr = threadsByProjectId.get(t.projectId) ?? [];
    arr.push(t);
    threadsByProjectId.set(t.projectId, arr);
  }

  return [...projects].sort((left, right) => {
    const rt = getProjectSortTimestamp(
      right,
      threadsByProjectId.get(right.id) ?? [],
      sortOrder,
    );
    const lt = getProjectSortTimestamp(
      left,
      threadsByProjectId.get(left.id) ?? [],
      sortOrder,
    );
    if (rt !== lt) return rt > lt ? 1 : -1;
    return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
}

// ── timestamp formatting ───────────────────────────────────────────────────

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(mo / 12)}y`;
}

function formatAbsoluteTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatTimestamp(ts: number, format: Settings['timestampFormat']): string {
  return format === 'relative' ? formatRelativeTime(ts) : formatAbsoluteTime(ts);
}

// ── thread status pills (adapted from Sidebar.logic.ts) ────────────────────

interface ThreadStatusPill {
  label: 'Working' | 'Connecting' | 'Completed' | 'Pending Approval' | 'Awaiting Input' | 'Plan Ready';
  color: string;
  dotColor: string;
  pulse: boolean;
}

const STATUS_PRIORITY: Record<ThreadStatusPill['label'], number> = {
  'Pending Approval': 5,
  'Awaiting Input': 4,
  Working: 3,
  Connecting: 3,
  'Plan Ready': 2,
  Completed: 1,
};

function resolveThreadStatusPill(thread: Thread): ThreadStatusPill | null {
  const hasPendingApproval = thread.proposedPlans?.some((p) => p.status === 'pending') ?? false;
  if (hasPendingApproval) {
    return {
      label: 'Pending Approval',
      color: '#f59e0b',
      dotColor: '#f59e0b',
      pulse: false,
    };
  }

  const lastMsg = thread.messages.at(-1);
  if (lastMsg && lastMsg.kind === 'assistant' && thread.messages.filter((m) => m.kind === 'user').length > 0) {
    return {
      label: 'Awaiting Input',
      color: '#6366f1',
      dotColor: '#6366f1',
      pulse: false,
    };
  }

  if (
    thread.interactionMode === 'plan' &&
    thread.proposedPlans &&
    thread.proposedPlans.length > 0 &&
    thread.proposedPlans.some((p) => p.status === 'pending')
  ) {
    return {
      label: 'Plan Ready',
      color: '#8b5cf6',
      dotColor: '#8b5cf6',
      pulse: false,
    };
  }

  if (thread.messages.length > 0 && lastMsg?.kind === 'assistant') {
    return {
      label: 'Completed',
      color: '#10b981',
      dotColor: '#10b981',
      pulse: false,
    };
  }

  return null;
}

function resolveProjectStatusIndicator(threads: readonly Thread[]): ThreadStatusPill | null {
  let best: ThreadStatusPill | null = null;
  for (const t of threads) {
    const s = resolveThreadStatusPill(t);
    if (!s) continue;
    if (!best || STATUS_PRIORITY[s.label] > STATUS_PRIORITY[best.label]) {
      best = s;
    }
  }
  return best;
}

function ThreadStatusLabel({ status }: { status: ThreadStatusPill }) {
  return (
    <Row style={{ alignItems: 'center', gap: 4 }}>
      <Box
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: status.dotColor,
          opacity: status.pulse ? 0.6 : 1,
        }}
      />
      <Text style={{ color: status.color, fontFamily: 'monospace', fontSize: 9 }}>
        {status.label}
      </Text>
    </Row>
  );
}

// ── visible threads helper (adapted from Sidebar.logic.ts) ─────────────────

function getVisibleThreads(
  threads: readonly Thread[],
  activeThreadId: ThreadId | null,
  isExpanded: boolean,
  previewLimit: number,
): { hasHidden: boolean; visible: Thread[]; hidden: Thread[] } {
  const hasHidden = threads.length > previewLimit;
  if (!hasHidden || isExpanded) {
    return { hasHidden, visible: [...threads], hidden: [] };
  }
  const preview = threads.slice(0, previewLimit);
  if (!activeThreadId || preview.some((t) => t.id === activeThreadId)) {
    return { hasHidden: true, visible: preview, hidden: threads.slice(previewLimit) };
  }
  const active = threads.find((t) => t.id === activeThreadId);
  if (!active) {
    return { hasHidden: true, visible: preview, hidden: threads.slice(previewLimit) };
  }
  const visibleSet = new Set([...preview, active].map((t) => t.id));
  return {
    hasHidden: true,
    hidden: threads.filter((t) => !visibleSet.has(t.id)),
    visible: threads.filter((t) => visibleSet.has(t.id)),
  };
}

// ── sub-components ─────────────────────────────────────────────────────────

function SidebarThreadRow({
  thread,
  isActive,
  terminalOpen,
  settings,
  onSelect,
  onArchive,
  onDelete,
  onRename,
}: {
  thread: Thread;
  isActive: boolean;
  terminalOpen: boolean;
  settings: Settings;
  onSelect: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState(thread.title);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const renameCommittedRef = useRef(false);
  const renameInputRef = useRef<any>(null);

  const status = useMemo(() => resolveThreadStatusPill(thread), [thread]);

  const commitRename = useCallback(() => {
    const trimmed = renameTitle.trim();
    if (trimmed.length === 0 || trimmed === thread.title) {
      setRenaming(false);
      return;
    }
    onRename(trimmed);
    setRenaming(false);
  }, [renameTitle, thread.title, onRename]);

  const cancelRename = useCallback(() => {
    setRenaming(false);
    setRenameTitle(thread.title);
  }, [thread.title]);

  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus?.();
    }
  }, [renaming]);

  const rowBg = isActive ? C.activeRowBg : 'transparent';

  return (
    <Pressable
      onPress={onSelect}
      onHoverEnter={() => setHovered(true)}
      onHoverExit={() => {
        setHovered(false);
        setConfirmingArchive(false);
      }}
    >
      <Row
        style={{
          alignItems: 'center',
          paddingLeft: 12,
          paddingRight: 8,
          paddingTop: 4,
          paddingBottom: 4,
          borderRadius: 4,
          backgroundColor: hovered ? C.hoverRowBg : rowBg,
          gap: 6,
        }}
      >
        {status ? <ThreadStatusLabel status={status} /> : null}

        {renaming ? (
          <TextInput
            ref={renameInputRef}
            value={renameTitle}
            onChangeText={setRenameTitle}
            onKeyDown={(payload: any) => {
              const key = payload?.key ?? payload?.keyCode ?? 0;
              if (key === 13 || key === 'Enter') {
                renameCommittedRef.current = true;
                commitRename();
              } else if (key === 27 || key === 'Escape') {
                renameCommittedRef.current = true;
                cancelRename();
              }
            }}
            onBlur={() => {
              if (!renameCommittedRef.current) {
                commitRename();
              }
            }}
            style={{
              flex: 1,
              color: C.text,
              fontFamily: 'monospace',
              fontSize: 11,
              backgroundColor: C.panel,
              borderWidth: 1,
              borderColor: C.accent,
              borderRadius: 3,
              paddingLeft: 4,
              paddingRight: 4,
              paddingTop: 2,
              paddingBottom: 2,
            }}
          />
        ) : (
          <Text
            style={{
              flex: 1,
              color: isActive ? C.text : C.textMuted,
              fontFamily: 'monospace',
              fontSize: 11,
            }}
          >
            {thread.title}
          </Text>
        )}

        <Row style={{ alignItems: 'center', gap: 6 }}>
          {terminalOpen ? (
            <Text style={{ color: '#14b8a6', fontFamily: 'monospace', fontSize: 10 }}>
              {'>'}
            </Text>
          ) : null}

          <Text style={{ color: C.textDim, fontFamily: 'monospace', fontSize: 9 }}>
            {formatTimestamp(
              getThreadSortTimestamp(thread, settings.sidebarThreadSortOrder),
              settings.timestampFormat,
            )}
          </Text>

          {(hovered || isActive) && !renaming ? (
            <Row style={{ gap: 4 }}>
              <Pressable
                onPress={(e: any) => {
                  e?.stopPropagation?.();
                  setRenaming(true);
                  setRenameTitle(thread.title);
                  renameCommittedRef.current = false;
                }}
              >
                <Text style={{ color: C.textDim, fontFamily: 'monospace', fontSize: 10 }}>
                  ✎
                </Text>
              </Pressable>
              {confirmingArchive ? (
                <Pressable
                  onPress={(e: any) => {
                    e?.stopPropagation?.();
                    setConfirmingArchive(false);
                    onArchive();
                  }}
                >
                  <Text
                    style={{
                      color: C.danger,
                      fontFamily: 'monospace',
                      fontSize: 9,
                      backgroundColor: 'rgba(239,68,68,0.12)',
                      borderRadius: 4,
                      paddingLeft: 5,
                      paddingRight: 5,
                      paddingTop: 1,
                      paddingBottom: 1,
                    }}
                  >
                    Confirm
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={(e: any) => {
                    e?.stopPropagation?.();
                    if (settings.confirmThreadArchive) {
                      setConfirmingArchive(true);
                    } else {
                      onArchive();
                    }
                  }}
                >
                  <Text style={{ color: C.textDim, fontFamily: 'monospace', fontSize: 10 }}>
                    ×
                  </Text>
                </Pressable>
              )}
              <Pressable
                onPress={(e: any) => {
                  e?.stopPropagation?.();
                  onDelete();
                }}
              >
                <Text style={{ color: C.danger, fontFamily: 'monospace', fontSize: 10 }}>
                  🗑
                </Text>
              </Pressable>
            </Row>
          ) : null}
        </Row>
      </Row>
    </Pressable>
  );
}

function SidebarProjectItem({
  project,
  threads,
  activeThreadId,
  terminalOpenByThreadId,
  settings,
  onSelectThread,
  onNewThread,
  onArchiveThread,
  onDeleteThread,
  onRenameThread,
}: {
  project: Project;
  threads: Thread[];
  activeThreadId: ThreadId | null;
  terminalOpenByThreadId: Record<ThreadId, boolean>;
  settings: Settings;
  onSelectThread: (id: ThreadId) => void;
  onNewThread: (projectId: string) => void;
  onArchiveThread: (id: ThreadId) => void;
  onDeleteThread: (id: ThreadId) => void;
  onRenameThread: (id: ThreadId, title: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [threadListExpanded, setThreadListExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);

  const sortedThreads = useMemo(
    () => sortThreads(threads.filter((t) => !t.archived), settings.sidebarThreadSortOrder),
    [threads, settings.sidebarThreadSortOrder],
  );

  const projectStatus = useMemo(
    () => resolveProjectStatusIndicator(sortedThreads),
    [sortedThreads],
  );

  const { hasHidden, visible, hidden } = useMemo(
    () =>
      getVisibleThreads(sortedThreads, activeThreadId, threadListExpanded, PREVIEW_COUNT),
    [sortedThreads, activeThreadId, threadListExpanded],
  );

  const showEmpty = expanded && sortedThreads.length === 0;
  const showThreadPanel = expanded || visible.length > 0;

  return (
    <Col style={{ gap: 1 }}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        onHoverEnter={() => setHovered(true)}
        onHoverExit={() => setHovered(false)}
      >
        <Row
          style={{
            alignItems: 'center',
            paddingLeft: 8,
            paddingRight: 8,
            paddingTop: 5,
            paddingBottom: 5,
            borderRadius: 4,
            backgroundColor: hovered ? C.hoverRowBg : 'transparent',
            gap: 6,
          }}
        >
          <Text style={{ color: C.textDim, fontFamily: 'monospace', fontSize: 11 }}>
            {expanded ? '▼' : '▶'}
          </Text>

          {!expanded && projectStatus ? (
            <Box
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: projectStatus.dotColor,
              }}
            />
          ) : null}

          <Text
            style={{
              flex: 1,
              color: C.text,
              fontFamily: 'monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            {project.name}
          </Text>

          {hovered || expanded ? (
            <Pressable
              onPress={(e: any) => {
                e?.stopPropagation?.();
                onNewThread(project.id);
              }}
            >
              <Text style={{ color: C.textDim, fontFamily: 'monospace', fontSize: 12 }}>
                +{' '}
              </Text>
            </Pressable>
          ) : null}
        </Row>
      </Pressable>

      {showThreadPanel ? (
        <Col style={{ paddingLeft: 8, gap: 1 }}>
          {showEmpty ? (
            <Text
              style={{
                color: C.textDim,
                fontFamily: 'monospace',
                fontSize: 10,
                paddingLeft: 18,
                paddingTop: 2,
                paddingBottom: 2,
              }}
            >
              No threads yet
            </Text>
          ) : null}

          {visible.map((thread) => (
            <SidebarThreadRow
              key={thread.id}
              thread={thread}
              isActive={thread.id === activeThreadId}
              terminalOpen={!!terminalOpenByThreadId[thread.id]}
              settings={settings}
              onSelect={() => onSelectThread(thread.id)}
              onArchive={() => onArchiveThread(thread.id)}
              onDelete={() => onDeleteThread(thread.id)}
              onRename={(title) => onRenameThread(thread.id, title)}
            />
          ))}

          {hasHidden && !threadListExpanded ? (
            <Pressable onPress={() => setThreadListExpanded(true)}>
              <Row
                style={{
                  alignItems: 'center',
                  paddingLeft: 18,
                  paddingRight: 8,
                  paddingTop: 3,
                  paddingBottom: 3,
                  borderRadius: 4,
                  gap: 6,
                }}
              >
                {resolveProjectStatusIndicator(hidden) ? (
                  <ThreadStatusLabel status={resolveProjectStatusIndicator(hidden)!} />
                ) : null}
                <Text
                  style={{
                    color: C.textDim,
                    fontFamily: 'monospace',
                    fontSize: 10,
                  }}
                >
                  Show more
                </Text>
              </Row>
            </Pressable>
          ) : null}

          {hasHidden && threadListExpanded ? (
            <Pressable onPress={() => setThreadListExpanded(false)}>
              <Row
                style={{
                  alignItems: 'center',
                  paddingLeft: 18,
                  paddingRight: 8,
                  paddingTop: 3,
                  paddingBottom: 3,
                  borderRadius: 4,
                }}
              >
                <Text
                  style={{
                    color: C.textDim,
                    fontFamily: 'monospace',
                    fontSize: 10,
                  }}
                >
                  Show less
                </Text>
              </Row>
            </Pressable>
          ) : null}
        </Col>
      ) : null}
    </Col>
  );
}

// ── main sidebar ───────────────────────────────────────────────────────────

export default function Sidebar(props: SidebarProps) {
  const {
    threads,
    projects,
    activeThreadId,
    settings,
    onSelectThread,
    onNewThread,
    onArchiveThread,
    onDeleteThread,
    onRenameThread,
    onOpenSettings,
    onOpenCommandPalette,
    terminalOpenByThreadId,
  } = props;

  const [showSortMenu, setShowSortMenu] = useState(false);

  const sortedProjects = useMemo(
    () => sortProjects(projects, threads, settings.sidebarProjectSortOrder),
    [projects, threads, settings.sidebarProjectSortOrder],
  );

  const threadsByProjectId = useMemo(() => {
    const map = new Map<string, Thread[]>();
    for (const t of threads) {
      const arr = map.get(t.projectId) ?? [];
      arr.push(t);
      map.set(t.projectId, arr);
    }
    return map;
  }, [threads]);

  return (
    <Col
      style={{
        width: 260,
        minWidth: 260,
        maxWidth: 260,
        height: '100%',
        backgroundColor: C.bg,
        borderRightWidth: 1,
        borderRightColor: C.border,
      }}
    >
      {/* Header */}
      <Row
        style={{
          alignItems: 'center',
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 10,
          paddingBottom: 10,
          borderBottomWidth: 1,
          borderBottomColor: C.border,
          gap: 6,
        }}
      >
        <Text style={{ color: C.text, fontFamily: 'monospace', fontSize: 13, fontWeight: 'bold' }}>
          T3
        </Text>
        <Text style={{ color: C.textMuted, fontFamily: 'monospace', fontSize: 12 }}>
          Code
        </Text>
      </Row>

      {/* Search trigger */}
      <Pressable onPress={onOpenCommandPalette}>
        <Row
          style={{
            alignItems: 'center',
            marginLeft: 8,
            marginRight: 8,
            marginTop: 8,
            marginBottom: 4,
            paddingLeft: 8,
            paddingRight: 8,
            paddingTop: 5,
            paddingBottom: 5,
            borderRadius: 4,
            backgroundColor: C.panel,
            borderWidth: 1,
            borderColor: C.border,
            gap: 6,
          }}
        >
          <Text style={{ color: C.textDim, fontFamily: 'monospace', fontSize: 11 }}>
            🔎
          </Text>
          <Text
            style={{
              flex: 1,
              color: C.textMuted,
              fontFamily: 'monospace',
              fontSize: 11,
            }}
          >
            Search
          </Text>
          <Text style={{ color: C.textDim, fontFamily: 'monospace', fontSize: 9 }}>
            ⌘K
          </Text>
        </Row>
      </Pressable>

      {/* Projects */}
      <ScrollView style={{ flex: 1 }} showScrollbar>
        <Col style={{ padding: 8, gap: 2 }}>
          <Row
            style={{
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingLeft: 4,
              paddingRight: 4,
              paddingTop: 4,
              paddingBottom: 4,
            }}
          >
            <Text
              style={{
                color: C.textDim,
                fontFamily: 'monospace',
                fontSize: 9,
                fontWeight: 'bold',
                letterSpacing: 1,
                textTransform: 'uppercase',
              }}
            >
              Projects
            </Text>
            <Row style={{ gap: 4 }}>
              <Pressable onPress={() => setShowSortMenu((v) => !v)}>
                <Text style={{ color: C.textDim, fontFamily: 'monospace', fontSize: 10 }}>
                  ⇅
                </Text>
              </Pressable>
              <Pressable onPress={() => onNewThread(projects[0]?.id ?? '')}>
                <Text style={{ color: C.textDim, fontFamily: 'monospace', fontSize: 10 }}>
                  +
                </Text>
              </Pressable>
            </Row>
          </Row>

          {showSortMenu ? (
            <Col
              style={{
                backgroundColor: C.panel,
                borderRadius: 4,
                borderWidth: 1,
                borderColor: C.border,
                padding: 6,
                gap: 4,
                marginBottom: 4,
              }}
            >
              <Text
                style={{
                  color: C.textDim,
                  fontFamily: 'monospace',
                  fontSize: 9,
                  fontWeight: 'bold',
                }}
              >
                Sort projects
              </Text>
              {(['updated_at', 'created_at', 'manual'] as const).map((o) => (
                <Pressable
                  key={o}
                  onPress={() => {
                    setShowSortMenu(false);
                  }}
                >
                  <Text
                    style={{
                      color:
                        settings.sidebarProjectSortOrder === o
                          ? C.accent
                          : C.textMuted,
                      fontFamily: 'monospace',
                      fontSize: 10,
                    }}
                  >
                    {o === 'updated_at'
                      ? 'Last user message'
                      : o === 'created_at'
                      ? 'Created at'
                      : 'Manual'}
                  </Text>
                </Pressable>
              ))}

              <Box style={{ height: 1, backgroundColor: C.border, marginTop: 2, marginBottom: 2 }} />

              <Text
                style={{
                  color: C.textDim,
                  fontFamily: 'monospace',
                  fontSize: 9,
                  fontWeight: 'bold',
                }}
              >
                Sort threads
              </Text>
              {(['updated_at', 'created_at'] as const).map((o) => (
                <Pressable
                  key={o}
                  onPress={() => {
                    setShowSortMenu(false);
                  }}
                >
                  <Text
                    style={{
                      color:
                        settings.sidebarThreadSortOrder === o
                          ? C.accent
                          : C.textMuted,
                      fontFamily: 'monospace',
                      fontSize: 10,
                    }}
                  >
                    {o === 'updated_at' ? 'Last user message' : 'Created at'}
                  </Text>
                </Pressable>
              ))}
            </Col>
          ) : null}

          {sortedProjects.map((project) => (
            <SidebarProjectItem
              key={project.id}
              project={project}
              threads={threadsByProjectId.get(project.id) ?? []}
              activeThreadId={activeThreadId}
              terminalOpenByThreadId={terminalOpenByThreadId}
              settings={settings}
              onSelectThread={onSelectThread}
              onNewThread={onNewThread}
              onArchiveThread={onArchiveThread}
              onDeleteThread={onDeleteThread}
              onRenameThread={onRenameThread}
            />
          ))}

          {projects.length === 0 ? (
            <Text
              style={{
                color: C.textDim,
                fontFamily: 'monospace',
                fontSize: 11,
                textAlign: 'center',
                paddingTop: 16,
              }}
            >
              No projects yet
            </Text>
          ) : null}
        </Col>
      </ScrollView>

      {/* Footer */}
      <Col
        style={{
          borderTopWidth: 1,
          borderTopColor: C.border,
          padding: 8,
          gap: 2,
        }}
      >
        <Pressable onPress={onOpenSettings}>
          <Row
            style={{
              alignItems: 'center',
              paddingLeft: 8,
              paddingRight: 8,
              paddingTop: 5,
              paddingBottom: 5,
              borderRadius: 4,
              gap: 6,
            }}
          >
            <Text style={{ color: C.textDim, fontFamily: 'monospace', fontSize: 11 }}>
              ⚙
            </Text>
            <Text style={{ color: C.textMuted, fontFamily: 'monospace', fontSize: 11 }}>
              Settings
            </Text>
          </Row>
        </Pressable>
      </Col>
    </Col>
  );
}
