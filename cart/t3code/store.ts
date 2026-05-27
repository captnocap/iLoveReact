// T3 Code — central store (1:1 behavior port)
//
// Replaces the Zustand + React Query stack from the original with a
// lightweight `__store_get`/`__store_set` layer. All state is JSON-
// serialized to the host SQLite-backed store.

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  type Thread,
  type Project,
  type Settings,
  type ProviderInstance,
  type ThreadTerminalState,
  type TerminalGroup,
  type TerminalTab,
  type ChatMessage,
  type ModelSelection,
  type RuntimeMode,
  type InteractionMode,
  type TurnDiffSummary,
  type ThreadId,
  type MessageId,
  type TurnId,
} from './types';

// ── host bridge ────────────────────────────────────────────────────────────

const host = (): any => globalThis as any;
const has = (name: string): boolean => typeof host()[name] === 'function';
const call = (name: string, ...args: any[]): any => host()[name]?.(...args);

function storeGet<T>(key: string, fallback: T): T {
  if (!has('__store_get')) return fallback;
  try {
    const raw = call('__store_get', key);
    if (typeof raw !== 'string' || raw.length === 0) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function storeSet(key: string, value: unknown): void {
  if (!has('__store_set')) return;
  try {
    call('__store_set', key, JSON.stringify(value));
  } catch { /* ignore */ }
}

// ── defaults ───────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: Settings = {
  defaultRuntimeMode: 'approval-required',
  defaultInteractionMode: 'build',
  timestampFormat: 'relative',
  autoOpenPlanSidebar: false,
  sidebarThreadSortOrder: 'updated_at',
  sidebarProjectSortOrder: 'updated_at',
  confirmThreadArchive: true,
  providers: [
    { id: 'claude-default', driver: 'claude_code', label: 'Claude', model: 'claude-opus-4-7', enabled: true },
    { id: 'codex-default', driver: 'codex_app_server', label: 'Codex', model: 'gpt-5.5', enabled: true },
    { id: 'kimi-default', driver: 'kimi_cli_wire', label: 'Kimi', model: 'kimi-k2', enabled: false },
  ],
};

const DEFAULT_TERMINAL_STATE: ThreadTerminalState = {
  terminalOpen: false,
  terminalHeight: 240,
  terminalIds: ['terminal-1'],
  activeTerminalId: 'terminal-1',
  terminalGroups: [{ id: 'group-1', terminalIds: ['terminal-1'] }],
  activeTerminalGroupId: 'group-1',
};

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowMs(): number {
  return Date.now();
}

// ── persisted slices ───────────────────────────────────────────────────────

const KEYS = {
  projects: 't3code:projects:v1',
  threads: 't3code:threads:v1',
  settings: 't3code:settings:v1',
  terminalState: 't3code:terminal:v1',
  activeThreadId: 't3code:activeThread:v1',
  uiState: 't3code:ui:v1',
} as const;

// ── hook: useT3Store ───────────────────────────────────────────────────────

export interface T3Store {
  // projects
  projects: Project[];
  addProject(cwd: string, name?: string): Project;
  removeProject(id: string): void;

  // threads
  threads: Thread[];
  activeThreadId: ThreadId | null;
  setActiveThreadId(id: ThreadId | null): void;
  createThread(projectId: string, opts?: Partial<Pick<Thread, 'title' | 'modelSelection'>>): Thread;
  updateThread(id: ThreadId, patch: Partial<Thread>): void;
  archiveThread(id: ThreadId): void;
  deleteThread(id: ThreadId): void;
  renameThread(id: ThreadId, title: string): void;
  appendMessages(id: ThreadId, messages: ChatMessage[]): void;

  // settings
  settings: Settings;
  updateSettings(patch: Partial<Settings>): void;
  setProvider(id: string, patch: Partial<ProviderInstance>): void;
  addProvider(p: ProviderInstance): void;
  removeProvider(id: string): void;

  // terminal
  terminalState: ThreadTerminalState;
  setTerminalOpen(open: boolean): void;
  setTerminalHeight(height: number): void;
  newTerminal(): void;
  splitTerminal(): void;
  closeTerminal(terminalId: string): void;
  setActiveTerminal(terminalId: string): void;

  // ui
  showSettings: boolean;
  setShowSettings(v: boolean): void;
  showCommandPalette: boolean;
  setShowCommandPalette(v: boolean): void;
  planSidebarOpen: boolean;
  setPlanSidebarOpen(v: boolean): void;
  rightPanelOpen: boolean;
  setRightPanelOpen(v: boolean): void;
}

export function useT3Store(): T3Store {
  // Load from host store on mount
  const [projects, setProjects] = useState<Project[]>(() =>
    storeGet<Project[]>(KEYS.projects, [{
      id: 'default-project',
      name: 'Default',
      cwd: processCwd(),
      environmentId: 'local',
      defaultModelSelection: { instanceId: 'claude-default', model: 'claude-opus-4-7' },
    }])
  );

  const [threads, setThreads] = useState<Thread[]>(() => storeGet<Thread[]>(KEYS.threads, []));
  const [activeThreadId, setActiveThreadId] = useState<ThreadId | null>(() => storeGet<ThreadId | null>(KEYS.activeThreadId, null));
  const [settings, setSettings] = useState<Settings>(() => storeGet<Settings>(KEYS.settings, DEFAULT_SETTINGS));
  const [terminalState, setTerminalState] = useState<ThreadTerminalState>(() => storeGet<ThreadTerminalState>(KEYS.terminalState, DEFAULT_TERMINAL_STATE));
  const [uiState, setUiState] = useState(() => storeGet<Record<string, any>>(KEYS.uiState, {}));

  // Persist on change
  useEffect(() => storeSet(KEYS.projects, projects), [projects]);
  useEffect(() => storeSet(KEYS.threads, threads), [threads]);
  useEffect(() => storeSet(KEYS.activeThreadId, activeThreadId), [activeThreadId]);
  useEffect(() => storeSet(KEYS.settings, settings), [settings]);
  useEffect(() => storeSet(KEYS.terminalState, terminalState), [terminalState]);
  useEffect(() => storeSet(KEYS.uiState, uiState), [uiState]);

  const addProject = useCallback((cwd: string, name?: string): Project => {
    const now = nowMs();
    const p: Project = {
      id: newId(),
      name: name || cwd.split('/').pop() || 'untitled',
      cwd,
      environmentId: 'local',
      createdAt: now,
      updatedAt: now,
      defaultModelSelection: settings.providers.find(pr => pr.enabled)
        ? { instanceId: settings.providers.find(pr => pr.enabled)!.id, model: settings.providers.find(pr => pr.enabled)!.model }
        : undefined,
    };
    setProjects(prev => [...prev, p]);
    return p;
  }, [settings.providers]);

  const removeProject = useCallback((id: string) => {
    setProjects(prev => prev.filter(p => p.id !== id));
    setThreads(prev => prev.filter(t => t.projectId !== id));
  }, []);

  const createThread = useCallback((projectId: string, opts?: Partial<Pick<Thread, 'title' | 'modelSelection'>>): Thread => {
    const project = projects.find(p => p.id === projectId);
    const modelSelection = opts?.modelSelection ?? project?.defaultModelSelection ?? { instanceId: settings.providers[0]?.id ?? '', model: settings.providers[0]?.model ?? '' };
    const t: Thread = {
      id: newId(),
      projectId,
      environmentId: project?.environmentId ?? 'local',
      title: opts?.title ?? 'New thread',
      messages: [],
      modelSelection,
      runtimeMode: settings.defaultRuntimeMode,
      interactionMode: settings.defaultInteractionMode,
      createdAt: nowMs(),
      updatedAt: nowMs(),
    };
    setThreads(prev => [t, ...prev]);
    setActiveThreadId(t.id);
    return t;
  }, [projects, settings]);

  const updateThread = useCallback((id: ThreadId, patch: Partial<Thread>) => {
    setThreads(prev => prev.map(t => t.id === id ? { ...t, ...patch, updatedAt: nowMs() } : t));
  }, []);

  const archiveThread = useCallback((id: ThreadId) => {
    setThreads(prev => prev.map(t => t.id === id ? { ...t, archived: true, updatedAt: nowMs() } : t));
    if (activeThreadId === id) setActiveThreadId(null);
  }, [activeThreadId]);

  const deleteThread = useCallback((id: ThreadId) => {
    setThreads(prev => prev.filter(t => t.id !== id));
    if (activeThreadId === id) setActiveThreadId(null);
  }, [activeThreadId]);

  const renameThread = useCallback((id: ThreadId, title: string) => {
    setThreads(prev => prev.map(t => t.id === id ? { ...t, title, updatedAt: nowMs() } : t));
  }, []);

  const appendMessages = useCallback((id: ThreadId, messages: ChatMessage[]) => {
    setThreads(prev => prev.map(t =>
      t.id === id
        ? { ...t, messages: [...t.messages, ...messages], updatedAt: nowMs() }
        : t
    ));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings(prev => ({ ...prev, ...patch }));
  }, []);

  const setProvider = useCallback((id: string, patch: Partial<ProviderInstance>) => {
    setSettings(prev => ({
      ...prev,
      providers: prev.providers.map(p => p.id === id ? { ...p, ...patch } : p),
    }));
  }, []);

  const addProvider = useCallback((p: ProviderInstance) => {
    setSettings(prev => ({ ...prev, providers: [...prev.providers, p] }));
  }, []);

  const removeProvider = useCallback((id: string) => {
    setSettings(prev => ({ ...prev, providers: prev.providers.filter(p => p.id !== id) }));
  }, []);

  const setTerminalOpen = useCallback((open: boolean) => {
    setTerminalState(prev => ({ ...prev, terminalOpen: open }));
  }, []);

  const setTerminalHeight = useCallback((height: number) => {
    setTerminalState(prev => ({ ...prev, terminalHeight: Math.max(120, Math.min(600, height)) }));
  }, []);

  const newTerminal = useCallback(() => {
    setTerminalState(prev => {
      const id = `terminal-${newId()}`;
      return {
        ...prev,
        terminalIds: [...prev.terminalIds, id],
        activeTerminalId: id,
        terminalGroups: [...prev.terminalGroups, { id: `group-${id}`, terminalIds: [id] }],
      };
    });
  }, []);

  const splitTerminal = useCallback(() => {
    setTerminalState(prev => {
      const activeGroup = prev.terminalGroups.find(g => g.id === prev.activeTerminalGroupId) ?? prev.terminalGroups[0];
      if (!activeGroup || activeGroup.terminalIds.length >= 4) return prev; // max 4 per group
      const id = `terminal-${newId()}`;
      const newGroup: TerminalGroup = {
        id: activeGroup.id,
        terminalIds: [...activeGroup.terminalIds, id],
      };
      return {
        ...prev,
        terminalIds: [...prev.terminalIds, id],
        activeTerminalId: id,
        terminalGroups: prev.terminalGroups.map(g => g.id === newGroup.id ? newGroup : g),
      };
    });
  }, []);

  const closeTerminal = useCallback((terminalId: string) => {
    setTerminalState(prev => {
      const ids = prev.terminalIds.filter(id => id !== terminalId);
      const groups = prev.terminalGroups
        .map(g => ({ ...g, terminalIds: g.terminalIds.filter(id => id !== terminalId) }))
        .filter(g => g.terminalIds.length > 0);
      return {
        ...prev,
        terminalIds: ids,
        activeTerminalId: ids.includes(prev.activeTerminalId) ? prev.activeTerminalId : (ids[0] ?? ''),
        terminalGroups: groups.length > 0 ? groups : [{ id: 'group-1', terminalIds: ids.length > 0 ? [ids[0]] : [] }],
      };
    });
  }, []);

  const setActiveTerminal = useCallback((terminalId: string) => {
    setTerminalState(prev => ({ ...prev, activeTerminalId: terminalId }));
  }, []);

  const setShowSettings = useCallback((v: boolean) => {
    setUiState(prev => ({ ...prev, showSettings: v }));
  }, []);

  const setShowCommandPalette = useCallback((v: boolean) => {
    setUiState(prev => ({ ...prev, showCommandPalette: v }));
  }, []);

  const setPlanSidebarOpen = useCallback((v: boolean) => {
    setUiState(prev => ({ ...prev, planSidebarOpen: v }));
  }, []);

  const setRightPanelOpen = useCallback((v: boolean) => {
    setUiState(prev => ({ ...prev, rightPanelOpen: v }));
  }, []);

  return {
    projects,
    addProject,
    removeProject,
    threads,
    activeThreadId,
    setActiveThreadId,
    createThread,
    updateThread,
    archiveThread,
    deleteThread,
    renameThread,
    appendMessages,
    settings,
    updateSettings,
    setProvider,
    addProvider,
    removeProvider,
    terminalState,
    setTerminalOpen,
    setTerminalHeight,
    newTerminal,
    splitTerminal,
    closeTerminal,
    setActiveTerminal,
    showSettings: uiState.showSettings ?? false,
    setShowSettings,
    showCommandPalette: uiState.showCommandPalette ?? false,
    setShowCommandPalette,
    planSidebarOpen: uiState.planSidebarOpen ?? false,
    setPlanSidebarOpen,
    rightPanelOpen: uiState.rightPanelOpen ?? false,
    setRightPanelOpen,
  };
}

// ── helpers ────────────────────────────────────────────────────────────────

function processCwd(): string {
  if (has('__cwd')) {
    try {
      const v = call('__cwd', '');
      if (typeof v === 'string' && v.length > 0) return v;
    } catch { /* ignore */ }
  }
  if (has('__env')) {
    try {
      const home = call('__env', '', 'HOME');
      if (typeof home === 'string' && home.length > 0) return home;
    } catch { /* ignore */ }
  }
  return '/tmp';
}

// ── selectors ──────────────────────────────────────────────────────────────

export function selectActiveThread(store: T3Store): Thread | null {
  return store.threads.find(t => t.id === store.activeThreadId) ?? null;
}

export function selectThreadsForProject(store: T3Store, projectId: string): Thread[] {
  return store.threads.filter(t => t.projectId === projectId && !t.archived);
}

export function selectProviderForThread(store: T3Store, thread: Thread | null): ProviderInstance | undefined {
  if (!thread) return undefined;
  return store.settings.providers.find(p => p.id === thread.modelSelection.instanceId);
}

export function selectEnabledProviders(settings: Settings): ProviderInstance[] {
  return settings.providers.filter(p => p.enabled);
}
