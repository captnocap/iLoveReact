import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { Box, Col, Row, Text, Pressable, ScrollView, Terminal } from '@reactjit/runtime/primitives';
import { useTerminal } from '@reactjit/runtime/hooks/useTerminal';
import type { ThreadId, TerminalGroup, TerminalContextSelection } from '../types';

const MIN_DRAWER_HEIGHT = 180;
const MAX_DRAWER_HEIGHT_RATIO = 0.75;
const DEFAULT_THREAD_TERMINAL_ID = 'terminal-1';
const MAX_TERMINALS_PER_GROUP = 4;

const COLORS = {
  bg: '#0e1218',
  surface: '#151a21',
  surfaceRaised: '#1c232d',
  border: '#2a3340',
  borderStrong: '#3d4d5f',
  text: '#e8ecf1',
  textMuted: '#8a95a5',
  textFaint: '#5c6675',
  accent: '#6fa1ff',
  danger: '#d86c6c',
  tabActive: '#1c232d',
  tabHover: '#1a2029',
  groupHeader: '#11161d',
  resizeHandle: '#3d4d5f',
};

function getViewportHeight(): number {
  const host: any = globalThis as any;
  return typeof host?.innerHeight === 'number'
    ? host.innerHeight
    : typeof host?.__viewportHeight === 'number'
    ? host.__viewportHeight
    : 840;
}

function maxDrawerHeight(): number {
  return Math.max(MIN_DRAWER_HEIGHT, Math.floor(getViewportHeight() * MAX_DRAWER_HEIGHT_RATIO));
}

function clampDrawerHeight(height: number): number {
  const safeHeight = Number.isFinite(height) ? height : 240;
  return Math.min(Math.max(Math.round(safeHeight), MIN_DRAWER_HEIGHT), maxDrawerHeight());
}

interface TerminalDrawerProps {
  threadId: ThreadId | null;
  visible: boolean;
  height: number;
  terminalIds: string[];
  activeTerminalId: string;
  terminalGroups: TerminalGroup[];
  activeTerminalGroupId: string;
  onHeightChange: (height: number) => void;
  onSplitTerminal: () => void;
  onNewTerminal: () => void;
  onCloseTerminal: (terminalId: string) => void;
  onActiveTerminalChange: (terminalId: string) => void;
  onAddTerminalContext: (ctx: TerminalContextSelection) => void;
  splitShortcutLabel?: string;
  newShortcutLabel?: string;
  closeShortcutLabel?: string;
}

export default function TerminalDrawer({
  threadId,
  visible,
  height,
  terminalIds,
  activeTerminalId,
  terminalGroups,
  activeTerminalGroupId,
  onHeightChange,
  onSplitTerminal,
  onNewTerminal,
  onCloseTerminal,
  onActiveTerminalChange,
  onAddTerminalContext,
  splitShortcutLabel,
  newShortcutLabel,
  closeShortcutLabel,
}: TerminalDrawerProps) {
  const _term = useTerminal();
  const [drawerHeight, setDrawerHeight] = useState(() => clampDrawerHeight(height));
  const [resizeEpoch, setResizeEpoch] = useState(0);
  const drawerHeightRef = useRef(drawerHeight);
  const lastSyncedHeightRef = useRef(clampDrawerHeight(height));
  const onHeightChangeRef = useRef(onHeightChange);
  const resizeStateRef = useRef<{
    startY: number;
    startHeight: number;
  } | null>(null);
  const didResizeDuringDragRef = useRef(false);
  const terminalNumberRef = useRef<Map<string, number>>(new Map());
  const terminalCounterRef = useRef(1);

  const getTerminalNumber = useCallback((id: string): number => {
    if (!terminalNumberRef.current.has(id)) {
      terminalNumberRef.current.set(id, terminalCounterRef.current++);
    }
    return terminalNumberRef.current.get(id)!;
  }, []);

  const normalizedTerminalIds = useMemo(() => {
    const cleaned = [...new Set(terminalIds.map((id) => id.trim()).filter((id) => id.length > 0))];
    return cleaned.length > 0 ? cleaned : [DEFAULT_THREAD_TERMINAL_ID];
  }, [terminalIds]);

  const resolvedActiveTerminalId = normalizedTerminalIds.includes(activeTerminalId)
    ? activeTerminalId
    : (normalizedTerminalIds[0] ?? DEFAULT_THREAD_TERMINAL_ID);

  const resolvedTerminalGroups = useMemo(() => {
    const validTerminalIdSet = new Set(normalizedTerminalIds);
    const assignedTerminalIds = new Set<string>();
    const usedGroupIds = new Set<string>();
    const nextGroups: TerminalGroup[] = [];

    const assignUniqueGroupId = (groupId: string): string => {
      if (!usedGroupIds.has(groupId)) {
        usedGroupIds.add(groupId);
        return groupId;
      }
      let suffix = 2;
      while (usedGroupIds.has(`${groupId}-${suffix}`)) {
        suffix += 1;
      }
      const uniqueGroupId = `${groupId}-${suffix}`;
      usedGroupIds.add(uniqueGroupId);
      return uniqueGroupId;
    };

    for (const terminalGroup of terminalGroups) {
      const nextTerminalIds = [
        ...new Set(terminalGroup.terminalIds.map((id) => id.trim()).filter((id) => id.length > 0)),
      ].filter((terminalId) => {
        if (!validTerminalIdSet.has(terminalId)) return false;
        if (assignedTerminalIds.has(terminalId)) return false;
        return true;
      });
      if (nextTerminalIds.length === 0) continue;

      for (const terminalId of nextTerminalIds) {
        assignedTerminalIds.add(terminalId);
      }

      const baseGroupId =
        terminalGroup.id.trim().length > 0
          ? terminalGroup.id.trim()
          : `group-${nextTerminalIds[0] ?? DEFAULT_THREAD_TERMINAL_ID}`;
      nextGroups.push({
        id: assignUniqueGroupId(baseGroupId),
        terminalIds: nextTerminalIds,
      });
    }

    for (const terminalId of normalizedTerminalIds) {
      if (assignedTerminalIds.has(terminalId)) continue;
      nextGroups.push({
        id: assignUniqueGroupId(`group-${terminalId}`),
        terminalIds: [terminalId],
      });
    }

    if (nextGroups.length > 0) {
      return nextGroups;
    }

    return [
      {
        id: `group-${resolvedActiveTerminalId}`,
        terminalIds: [resolvedActiveTerminalId],
      },
    ];
  }, [normalizedTerminalIds, resolvedActiveTerminalId, terminalGroups]);

  const resolvedActiveGroupIndex = useMemo(() => {
    const indexById = resolvedTerminalGroups.findIndex(
      (terminalGroup) => terminalGroup.id === activeTerminalGroupId,
    );
    if (indexById >= 0) return indexById;
    const indexByTerminal = resolvedTerminalGroups.findIndex((terminalGroup) =>
      terminalGroup.terminalIds.includes(resolvedActiveTerminalId),
    );
    return indexByTerminal >= 0 ? indexByTerminal : 0;
  }, [activeTerminalGroupId, resolvedActiveTerminalId, resolvedTerminalGroups]);

  const visibleTerminalIds = resolvedTerminalGroups[resolvedActiveGroupIndex]?.terminalIds ?? [
    resolvedActiveTerminalId,
  ];
  const hasTerminalSidebar = normalizedTerminalIds.length > 1;
  const isSplitView = visibleTerminalIds.length > 1;
  const showGroupHeaders =
    resolvedTerminalGroups.length > 1 ||
    resolvedTerminalGroups.some((terminalGroup) => terminalGroup.terminalIds.length > 1);
  const hasReachedSplitLimit = visibleTerminalIds.length >= MAX_TERMINALS_PER_GROUP;

  const terminalLabelById = useMemo(
    () =>
      new Map(
        normalizedTerminalIds.map((terminalId, index) => [terminalId, `Terminal ${index + 1}`]),
      ),
    [normalizedTerminalIds],
  );

  const splitTerminalActionLabel = hasReachedSplitLimit
    ? `Split (max ${MAX_TERMINALS_PER_GROUP})`
    : splitShortcutLabel
    ? `Split (${splitShortcutLabel})`
    : 'Split';
  const newTerminalActionLabel = newShortcutLabel ? `New (${newShortcutLabel})` : 'New';
  const closeTerminalActionLabel = closeShortcutLabel ? `Close (${closeShortcutLabel})` : 'Close';

  const onSplitTerminalAction = useCallback(() => {
    if (hasReachedSplitLimit) return;
    onSplitTerminal();
  }, [hasReachedSplitLimit, onSplitTerminal]);

  const syncHeight = useCallback((nextHeight: number) => {
    const clampedHeight = clampDrawerHeight(nextHeight);
    if (lastSyncedHeightRef.current === clampedHeight) return;
    lastSyncedHeightRef.current = clampedHeight;
    onHeightChangeRef.current(clampedHeight);
  }, []);

  useEffect(() => {
    onHeightChangeRef.current = onHeightChange;
  }, [onHeightChange]);

  useEffect(() => {
    drawerHeightRef.current = drawerHeight;
  }, [drawerHeight]);

  useEffect(() => {
    const clampedHeight = clampDrawerHeight(height);
    setDrawerHeight(clampedHeight);
    drawerHeightRef.current = clampedHeight;
    lastSyncedHeightRef.current = clampedHeight;
  }, [height, threadId]);

  const handleResizeMouseDown = useCallback((payload: any) => {
    if ((payload?.button ?? 0) !== 0) return;
    didResizeDuringDragRef.current = false;
    resizeStateRef.current = {
      startY: payload?.y ?? 0,
      startHeight: drawerHeightRef.current,
    };
  }, []);

  const handleResizeMouseMove = useCallback((payload: any) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState) return;
    const clampedHeight = clampDrawerHeight(
      resizeState.startHeight + (resizeState.startY - (payload?.y ?? 0)),
    );
    if (clampedHeight === drawerHeightRef.current) return;
    didResizeDuringDragRef.current = true;
    drawerHeightRef.current = clampedHeight;
    setDrawerHeight(clampedHeight);
  }, []);

  const handleResizeMouseUp = useCallback(() => {
    resizeStateRef.current = null;
    if (!didResizeDuringDragRef.current) return;
    syncHeight(drawerHeightRef.current);
    setResizeEpoch((v) => v + 1);
  }, [syncHeight]);

  useEffect(() => {
    if (!visible) return;
    const onWindowResize = () => {
      const clampedHeight = clampDrawerHeight(drawerHeightRef.current);
      const changed = clampedHeight !== drawerHeightRef.current;
      if (changed) {
        setDrawerHeight(clampedHeight);
        drawerHeightRef.current = clampedHeight;
      }
      if (!resizeStateRef.current) {
        syncHeight(clampedHeight);
      }
      setResizeEpoch((v) => v + 1);
    };
    const host: any = globalThis as any;
    const target =
      typeof host?.addEventListener === 'function'
        ? host
        : typeof window !== 'undefined'
        ? window
        : null;
    if (!target) return;
    target.addEventListener('resize', onWindowResize);
    return () => target.removeEventListener('resize', onWindowResize);
  }, [syncHeight, visible]);

  useEffect(() => {
    if (!visible) return;
    setResizeEpoch((v) => v + 1);
  }, [visible]);

  useEffect(() => {
    return () => {
      syncHeight(drawerHeightRef.current);
    };
  }, [syncHeight]);

  if (!visible) return null;

  return (
    <Col
      style={{
        height: drawerHeight,
        backgroundColor: COLORS.bg,
        borderTopWidth: 1,
        borderColor: COLORS.border,
        position: 'relative',
      }}
    >
      {/* Resize handle */}
      <Box
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: 6,
          zIndex: 20,
          cursor: 'row-resize',
        }}
        onMouseDown={handleResizeMouseDown}
        onMouseMove={handleResizeMouseMove}
        onMouseUp={handleResizeMouseUp}
      />

      {/* Top-right floating toolbar (only when sidebar is hidden) */}
      {!hasTerminalSidebar && (
        <Row
          style={{
            position: 'absolute',
            right: 8,
            top: 8,
            zIndex: 20,
            gap: 0,
            borderWidth: 1,
            borderColor: COLORS.border,
            borderRadius: 6,
            backgroundColor: COLORS.surface,
            overflow: 'hidden',
          }}
        >
          <Pressable
            onPress={onSplitTerminalAction}
            tooltip={splitTerminalActionLabel}
            style={{
              width: 28,
              height: 26,
              justifyContent: 'center',
              alignItems: 'center',
              opacity: hasReachedSplitLimit ? 0.45 : 1,
            }}
          >
            <Text style={{ fontSize: 12, color: COLORS.textMuted }}>⫴</Text>
          </Pressable>
          <Box style={{ width: 1, height: 16, backgroundColor: COLORS.border, marginTop: 5 }} />
          <Pressable
            onPress={onNewTerminal}
            tooltip={newTerminalActionLabel}
            style={{
              width: 28,
              height: 26,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 14, color: COLORS.textMuted }}>+</Text>
          </Pressable>
          <Box style={{ width: 1, height: 16, backgroundColor: COLORS.border, marginTop: 5 }} />
          <Pressable
            onPress={() => onCloseTerminal(resolvedActiveTerminalId)}
            tooltip={closeTerminalActionLabel}
            style={{
              width: 28,
              height: 26,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 12, color: COLORS.danger }}>×</Text>
          </Pressable>
        </Row>
      )}

      <Row style={{ flexGrow: 1, minHeight: 0 }}>
        {/* Terminal viewport area */}
        <Box style={{ flexGrow: 1, minWidth: 0 }}>
          {isSplitView ? (
            <Row style={{ height: '100%', minWidth: 0 }}>
              {visibleTerminalIds.map((terminalId) => (
                <Box
                  key={terminalId}
                  style={{
                    flexGrow: 1,
                    minWidth: 0,
                    borderLeftWidth: terminalId === visibleTerminalIds[0] ? 0 : 1,
                    borderColor:
                      terminalId === resolvedActiveTerminalId
                        ? COLORS.borderStrong
                        : COLORS.border,
                  }}
                  onMouseDown={() => {
                    if (terminalId !== resolvedActiveTerminalId) {
                      onActiveTerminalChange(terminalId);
                    }
                  }}
                >
                  <Box style={{ padding: 4, height: '100%' }}>
                    <Terminal
                      shell="bash"
                      session={`t3code-${terminalId}`}
                    />
                  </Box>
                </Box>
              ))}
            </Row>
          ) : (
            <Box style={{ padding: 4, height: '100%' }}>
              <Terminal
                shell="bash"
                session={`t3code-${resolvedActiveTerminalId}`}
              />
            </Box>
          )}
        </Box>

        {/* Terminal sidebar */}
        {hasTerminalSidebar && (
          <Col
            style={{
              width: 144,
              minWidth: 144,
              borderLeftWidth: 1,
              borderColor: COLORS.border,
              backgroundColor: COLORS.surface,
            }}
          >
            {/* Sidebar toolbar */}
            <Row
              style={{
                height: 26,
                justifyContent: 'flex-end',
                borderBottomWidth: 1,
                borderColor: COLORS.border,
                alignItems: 'stretch',
              }}
            >
              <Pressable
                onPress={onSplitTerminalAction}
                tooltip={splitTerminalActionLabel}
                style={{
                  width: 28,
                  justifyContent: 'center',
                  alignItems: 'center',
                  opacity: hasReachedSplitLimit ? 0.45 : 1,
                }}
              >
                <Text style={{ fontSize: 11, color: COLORS.textMuted }}>⫴</Text>
              </Pressable>
              <Box style={{ width: 1, backgroundColor: COLORS.border }} />
              <Pressable
                onPress={onNewTerminal}
                tooltip={newTerminalActionLabel}
                style={{
                  width: 28,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontSize: 13, color: COLORS.textMuted }}>+</Text>
              </Pressable>
              <Box style={{ width: 1, backgroundColor: COLORS.border }} />
              <Pressable
                onPress={() => onCloseTerminal(resolvedActiveTerminalId)}
                tooltip={closeTerminalActionLabel}
                style={{
                  width: 28,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontSize: 11, color: COLORS.danger }}>×</Text>
              </Pressable>
            </Row>

            {/* Group / terminal list */}
            <ScrollView style={{ flexGrow: 1 }}>
              <Box style={{ padding: 4 }}>
                {resolvedTerminalGroups.map((terminalGroup, groupIndex) => {
                  const isGroupActive =
                    terminalGroup.terminalIds.includes(resolvedActiveTerminalId);
                  const groupActiveTerminalId = isGroupActive
                    ? resolvedActiveTerminalId
                    : (terminalGroup.terminalIds[0] ?? resolvedActiveTerminalId);

                  return (
                    <Box key={terminalGroup.id} style={{ marginBottom: 2 }}>
                      {showGroupHeaders && (
                        <Pressable
                          onPress={() => onActiveTerminalChange(groupActiveTerminalId)}
                          style={{
                            paddingLeft: 4,
                            paddingRight: 4,
                            paddingTop: 2,
                            paddingBottom: 2,
                            borderRadius: 4,
                            backgroundColor: isGroupActive ? COLORS.tabActive : 'transparent',
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 10,
                              color: isGroupActive ? COLORS.text : COLORS.textFaint,
                              letterSpacing: 0.5,
                            }}
                          >
                            {terminalGroup.terminalIds.length > 1
                              ? `SPLIT ${groupIndex + 1}`
                              : `TERM ${groupIndex + 1}`}
                          </Text>
                        </Pressable>
                      )}

                      <Box
                        style={
                          showGroupHeaders
                            ? {
                                marginLeft: 8,
                                borderLeftWidth: 1,
                                borderColor: COLORS.border,
                                paddingLeft: 6,
                              }
                            : {}
                        }
                      >
                        {terminalGroup.terminalIds.map((terminalId) => {
                          const isActive = terminalId === resolvedActiveTerminalId;
                          const closeLabel = `Close ${
                            terminalLabelById.get(terminalId) ?? 'terminal'
                          }${isActive && closeShortcutLabel ? ` (${closeShortcutLabel})` : ''}`;
                          return (
                            <Row
                              key={terminalId}
                              style={{
                                alignItems: 'center',
                                gap: 4,
                                paddingLeft: 4,
                                paddingRight: 4,
                                paddingTop: 2,
                                paddingBottom: 2,
                                borderRadius: 4,
                                backgroundColor: isActive ? COLORS.tabActive : 'transparent',
                              }}
                            >
                              {showGroupHeaders && (
                                <Text style={{ fontSize: 10, color: COLORS.textFaint }}>└</Text>
                              )}
                              <Pressable
                                onPress={() => onActiveTerminalChange(terminalId)}
                                style={{ flexGrow: 1, flexBasis: 0 }}
                              >
                                <Row style={{ alignItems: 'center', gap: 4 }}>
                                  <Text
                                    style={{
                                      fontSize: 10,
                                      color: isActive ? COLORS.text : COLORS.textMuted,
                                    }}
                                  >
                                    ▶
                                  </Text>
                                  <Text
                                    style={{
                                      fontSize: 10,
                                      color: isActive ? COLORS.text : COLORS.textMuted,
                                    }}
                                  >
                                    {terminalLabelById.get(terminalId) ?? 'Terminal'}
                                  </Text>
                                </Row>
                              </Pressable>
                              {normalizedTerminalIds.length > 1 && (
                                <Pressable
                                  onPress={() => onCloseTerminal(terminalId)}
                                  tooltip={closeLabel}
                                  style={{
                                    width: 16,
                                    height: 16,
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                  }}
                                >
                                  <Text style={{ fontSize: 9, color: COLORS.textFaint }}>×</Text>
                                </Pressable>
                              )}
                            </Row>
                          );
                        })}
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </ScrollView>
          </Col>
        )}
      </Row>
    </Col>
  );
}
