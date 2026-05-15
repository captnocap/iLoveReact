// T3 Code — Main shell (1:1 behavior port from https://github.com/pingdotgg/t3code)
//
// Layout:
//   [ Sidebar ] [ Main Chat Area ]
//                 [ Messages ]
//                 [ Composer ]
//                 [ Terminal Drawer ]
//
// Overlays:
//   [ CommandPalette ]
//   [ Settings ]

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Box, Col, Row, Text, Pressable } from '@reactjit/runtime/primitives';
import { installBrowserShims } from '@reactjit/runtime/hooks';
import { useAssistant, type WorkerEvent, type AssistantPhase } from '@reactjit/runtime/hooks/useAssistant';
import { callHost, hasHost } from '@reactjit/runtime/ffi';

import { useT3Store, selectActiveThread, selectProviderForThread } from './store';
import type {
  Thread, ThreadId, ChatMessage, TurnId, ModelSelection,
  RuntimeMode, InteractionMode, TerminalContextSelection,
} from './types';

import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import Composer from './components/Composer';
import TerminalDrawer from './components/TerminalDrawer';
import CommandPalette from './components/CommandPalette';
import SettingsPanel from './components/Settings';

installBrowserShims();

// ── helpers ────────────────────────────────────────────────────────────────

function processCwd(): string {
  if (hasHost('__cwd')) {
    try { const v = callHost<string>('__cwd', ''); if (typeof v === 'string' && v.length > 0) return v; }
    catch { /* ignore */ }
  }
  if (hasHost('__env')) {
    try { const home = callHost<string>('__env', '', 'HOME'); if (typeof home === 'string' && home.length > 0) return home; }
    catch { /* ignore */ }
  }
  return '/tmp';
}

function eventToMessage(ev: WorkerEvent): ChatMessage {
  return {
    id: `ev-${ev.id}`,
    kind: ev.kind === 'assistant_message' ? 'assistant'
      : ev.kind === 'user_message' ? 'user'
      : ev.kind === 'tool_call' ? 'tool_call'
      : ev.kind === 'tool_output' ? 'tool_output'
      : ev.kind === 'reasoning' ? 'reasoning'
      : 'system',
    text: ev.text ?? '',
    payload_json: ev.payload_json,
    turnId: ev.turn_id,
    createdAt: ev.created_at_ms,
  };
}

function deriveSessionPhase(phase: AssistantPhase): 'idle' | 'streaming' | 'failed' | 'starting' {
  switch (phase) {
    case 'idle': return 'idle';
    case 'streaming': return 'streaming';
    case 'failed': return 'failed';
    case 'starting':
    case 'init': return 'starting';
    case 'closed': return 'idle';
    default: return 'idle';
  }
}

// ── PendingApproval / PendingUserInput types for Composer ──────────────────

export type PendingApproval = {
  id: string;
  requestId: string;
  title: string;
  description?: string;
};

export type PendingUserInput = {
  id: string;
  requestId: string;
  questions: { id: string; label: string; type: 'text' | 'choice'; options?: string[] }[];
};

// ── App ────────────────────────────────────────────────────────────────────

export default function T3CodeApp() {
  const store = useT3Store();
  const activeThread = selectActiveThread(store);
  const provider = selectProviderForThread(store, activeThread);

  // ── assistant lifecycle ──────────────────────────────────────────────
  const assistant = useAssistant({
    backend: provider?.driver,
    cwd: processCwd(),
    model: provider?.model,
    persistAcrossUnmount: true,
  });

  // Sync incoming assistant events into the active thread's message log.
  const lastEventIdRef = useRef(0);
  useEffect(() => {
    if (!activeThread || assistant.events.length === 0) return;
    const newEvents = assistant.events.filter(e => e.id > lastEventIdRef.current);
    if (newEvents.length === 0) return;
    lastEventIdRef.current = newEvents[newEvents.length - 1]!.id;
    const messages = newEvents.map(eventToMessage);
    store.appendMessages(activeThread.id, messages);
  }, [assistant.events, activeThread, store]);

  // Reset event cursor when thread changes so we don't double-append.
  useEffect(() => {
    lastEventIdRef.current = 0;
  }, [activeThread?.id]);

  // ── send / approve / respond ─────────────────────────────────────────
  const handleSend = useCallback((text: string) => {
    if (!activeThread) return;
    const ok = assistant.ask(text);
    if (!ok) return;
    store.appendMessages(activeThread.id, [{
      id: `user-${Date.now()}`,
      kind: 'user',
      text,
      createdAt: Date.now(),
    }]);
  }, [assistant, activeThread, store]);

  const handleApprove = useCallback((_requestId: string, _decision: 'accept' | 'reject') => {
    // In a full port this calls assistant.respond() with the tool result.
    // For now the worker contract handles approvals interactively.
  }, []);

  const handleRespondUserInput = useCallback((_requestId: string, _answers: Record<string, string>) => {
    // Stub — wire to assistant.respond() when the backend exposes user-input rows.
  }, []);

  // ── model / mode changes ─────────────────────────────────────────────
  const handleModelChange = useCallback((selection: ModelSelection) => {
    if (!activeThread) return;
    store.updateThread(activeThread.id, { modelSelection: selection });
  }, [activeThread, store]);

  const handleRuntimeModeChange = useCallback((mode: RuntimeMode) => {
    if (!activeThread) return;
    store.updateThread(activeThread.id, { runtimeMode: mode });
  }, [activeThread, store]);

  const handleInteractionModeChange = useCallback((mode: InteractionMode) => {
    if (!activeThread) return;
    store.updateThread(activeThread.id, { interactionMode: mode });
  }, [activeThread, store]);

  // ── thread actions ───────────────────────────────────────────────────
  const handleSelectThread = useCallback((id: ThreadId) => {
    store.setActiveThreadId(id);
  }, [store]);

  const handleNewThread = useCallback((projectId: string) => {
    store.createThread(projectId);
  }, [store]);

  const handleArchiveThread = useCallback((id: ThreadId) => {
    store.archiveThread(id);
  }, [store]);

  const handleDeleteThread = useCallback((id: ThreadId) => {
    store.deleteThread(id);
  }, [store]);

  const handleRenameThread = useCallback((id: ThreadId, title: string) => {
    store.renameThread(id, title);
  }, [store]);

  // ── keyboard shortcuts ───────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      // Command palette
      if (ctrl && shift && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        store.setShowCommandPalette(true);
        return;
      }

      // New thread
      if (ctrl && !shift && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        const firstProject = store.projects[0];
        if (firstProject) handleNewThread(firstProject.id);
        return;
      }

      // Toggle terminal
      if (ctrl && !shift && e.key === '`') {
        e.preventDefault();
        store.setTerminalOpen(!store.terminalState.terminalOpen);
        return;
      }

      // New terminal
      if (ctrl && shift && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        store.newTerminal();
        return;
      }

      // Split terminal
      if (ctrl && shift && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        store.splitTerminal();
        return;
      }

      // Close terminal
      if (ctrl && shift && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        store.closeTerminal(store.terminalState.activeTerminalId);
        return;
      }

      // Toggle settings
      if (ctrl && !shift && e.key === ',') {
        e.preventDefault();
        store.setShowSettings(!store.showSettings);
        return;
      }

      // Escape closes overlays
      if (e.key === 'Escape') {
        if (store.showCommandPalette) { store.setShowCommandPalette(false); return; }
        if (store.showSettings) { store.setShowSettings(false); return; }
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }
  }, [store, handleNewThread]);

  // ── derived state ────────────────────────────────────────────────────
  const isWorking = assistant.phase === 'streaming';
  const phase = deriveSessionPhase(assistant.phase);

  const terminalOpenByThreadId = useMemo(() => {
    const map: Record<ThreadId, boolean> = {};
    if (activeThread && store.terminalState.terminalOpen) {
      map[activeThread.id] = true;
    }
    return map;
  }, [activeThread, store.terminalState.terminalOpen]);

  const pendingApprovals: PendingApproval[] = useMemo(() => {
    // Derive from assistant events looking for tool_call rows that need approval.
    // In the original this comes from server state; here we approximate.
    const last = assistant.events[assistant.events.length - 1];
    if (last && last.kind === 'tool_call' && last.payload_json) {
      try {
        const payload = JSON.parse(last.payload_json);
        if (payload?.name && !payload?.result) {
          return [{ id: last.id.toString(), requestId: last.id.toString(), title: payload.name, description: payload.arguments ? JSON.stringify(payload.arguments) : undefined }];
        }
      } catch { /* ignore */ }
    }
    return [];
  }, [assistant.events]);

  const pendingUserInputs: PendingUserInput[] = [];
  const terminalContexts: TerminalContextSelection[] = [];
  const contextWindow = undefined;
  const hasActionableProposedPlan = false;
  const proposedPlan = activeThread?.proposedPlans?.find(p => p.status === 'pending') ?? null;

  // ── render ───────────────────────────────────────────────────────────
  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0e0e10', flexDirection: 'row' }}>
      {/* Sidebar */}
      <Box style={{ width: 260, borderRightWidth: 1, borderColor: '#1f1f23', flexDirection: 'column' }}>
        <Sidebar
          threads={store.threads}
          projects={store.projects}
          activeThreadId={store.activeThreadId}
          settings={store.settings}
          onSelectThread={handleSelectThread}
          onNewThread={handleNewThread}
          onArchiveThread={handleArchiveThread}
          onDeleteThread={handleDeleteThread}
          onRenameThread={handleRenameThread}
          onOpenSettings={() => store.setShowSettings(true)}
          onOpenCommandPalette={() => store.setShowCommandPalette(true)}
          terminalOpenByThreadId={terminalOpenByThreadId}
        />
      </Box>

      {/* Main area */}
      <Col style={{ flexGrow: 1, minWidth: 0 }}>
        {/* Chat view */}
        <Box style={{ flexGrow: 1, minHeight: 0 }}>
          <ChatView
            thread={activeThread}
            isWorking={isWorking}
            phase={phase}
            error={assistant.error}
            onSend={handleSend}
            onRevertTurn={() => {}}
            onOpenDiff={() => {}}
            showTerminal={store.terminalState.terminalOpen}
            onToggleTerminal={() => store.setTerminalOpen(!store.terminalState.terminalOpen)}
            turnDiffSummaries={[]}
            terminalShortcutLabel="Ctrl+`"
          />
        </Box>

        {/* Composer */}
        <Box style={{ borderTopWidth: 1, borderColor: '#1f1f23' }}>
          <Composer
            thread={activeThread}
            phase={phase}
            ready={assistant.ready()}
            providers={store.settings.providers}
            onSend={handleSend}
            onApprove={handleApprove}
            onRespondUserInput={handleRespondUserInput}
            onModelChange={handleModelChange}
            onRuntimeModeChange={handleRuntimeModeChange}
            onInteractionModeChange={handleInteractionModeChange}
            onTogglePlanSidebar={() => store.setPlanSidebarOpen(!store.planSidebarOpen)}
            planSidebarOpen={store.planSidebarOpen}
            pendingApprovals={pendingApprovals}
            pendingUserInputs={pendingUserInputs}
            terminalContexts={terminalContexts}
            onAddTerminalContext={() => {}}
            contextWindow={contextWindow}
            hasActionableProposedPlan={hasActionableProposedPlan}
            proposedPlan={proposedPlan}
            onAcceptPlan={() => {}}
            onRejectPlan={() => {}}
          />
        </Box>

        {/* Terminal drawer */}
        {store.terminalState.terminalOpen && (
          <Box style={{ height: store.terminalState.terminalHeight, borderTopWidth: 1, borderColor: '#1f1f23' }}>
            <TerminalDrawer
              threadId={activeThread?.id ?? null}
              visible={store.terminalState.terminalOpen}
              height={store.terminalState.terminalHeight}
              terminalIds={store.terminalState.terminalIds}
              activeTerminalId={store.terminalState.activeTerminalId}
              terminalGroups={store.terminalState.terminalGroups}
              activeTerminalGroupId={store.terminalState.activeTerminalGroupId}
              onHeightChange={store.setTerminalHeight}
              onSplitTerminal={store.splitTerminal}
              onNewTerminal={store.newTerminal}
              onCloseTerminal={store.closeTerminal}
              onActiveTerminalChange={store.setActiveTerminal}
              onAddTerminalContext={() => {}}
              splitShortcutLabel="Ctrl+Shift+D"
              newShortcutLabel="Ctrl+Shift+T"
              closeShortcutLabel="Ctrl+Shift+W"
            />
          </Box>
        )}
      </Col>

      {/* Overlays */}
      <CommandPalette
        open={store.showCommandPalette}
        onClose={() => store.setShowCommandPalette(false)}
        threads={store.threads}
        projects={store.projects}
        activeThreadId={store.activeThreadId}
        onSelectThread={handleSelectThread}
        onNewThread={handleNewThread}
        onOpenSettings={() => store.setShowSettings(true)}
      />

      {store.showSettings && (
        <SettingsPanel
          settings={store.settings}
          onUpdate={store.updateSettings}
          onSetProvider={store.setProvider}
          onAddProvider={store.addProvider}
          onRemoveProvider={store.removeProvider}
          onClose={() => store.setShowSettings(false)}
        />
      )}
    </Box>
  );
}
