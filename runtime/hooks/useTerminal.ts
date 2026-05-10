// useTerminal — single surface for the terminal subsystem.
//
// One hook covers everything framework/terminal/ exposes: shell control,
// recording, playback, classifier mode, semantic graph queries. Mirrors the
// useAssistant philosophy — every host fn the cluster registers is reachable
// from here, no separate hooks per concern.
//
// The <Terminal> primitive still drives input/paint by itself — this hook is
// for inspecting, recording, replaying, and reading the structural parse of
// terminal output.
//
// Single-terminal model (vterm.zig is one global). Multi-slot variant arrives
// when the host fns gain Idx parameters.

import { useEffect, useRef, useState } from 'react';

const host = (): any => globalThis as any;
const call = (name: string, ...args: any[]): any => host()[name]?.(...args);

// ── Public types ─────────────────────────────────────────────────────────

export type ClassifierMode = 'none' | 'basic' | 'claude_code' | 'json';

export type TokenName =
  | 'output' | 'command' | 'error' | 'success' | 'heading' | 'separator' | 'progress'
  | 'user_prompt' | 'user_text' | 'assistant_text' | 'thinking' | 'thought_complete'
  | 'tool' | 'result' | 'diff'
  | 'banner' | 'status_bar' | 'box_drawing' | 'input_border' | 'input_zone'
  | 'permission' | 'menu_title' | 'menu_option' | 'menu_desc' | 'hint'
  | 'task_done' | 'task_active' | 'task_open' | 'task_summary'
  | 'text';

export type SemanticRole = 'user' | 'assistant' | 'system';
export type SemanticLane =
  | 'prompt' | 'text' | 'think' | 'tool' | 'result' | 'diff' | 'error' | 'state';

export interface SessionState {
  mode: string;
  is_thinking: boolean;
  is_responding: boolean;
  is_tool_using: boolean;
  permission_pending: boolean;
  current_turn_id: number;
  turn_count: number;
  frame: number;
  [k: string]: any;
}

export interface GraphNode {
  id: string;
  parent_id: string | null;
  role: SemanticRole;
  lane: SemanticLane;
  row_start: number;
  row_end: number;
  text_preview?: string;
  [k: string]: any;
}

export interface CacheEntry {
  row: number;
  kind: TokenName;
  text: string;
  color?: { r: number; g: number; b: number; a: number };
  role?: SemanticRole;
  lane?: SemanticLane;
  [k: string]: any;
}

export interface PlayerState {
  is_loaded: boolean;
  is_playing: boolean;
  position_us: number;
  duration_us: number;
  speed: number;
  frame: number;
  total_frames: number;
  [k: string]: any;
}

export interface SemanticSnapshot {
  classifier: ClassifierMode;
  frame: number;
  state: SessionState;
  rows: CacheEntry[];
  [k: string]: any;
}

export interface SemanticExport {
  node_count: number;
  tree: string;
  rows: CacheEntry[];
  [k: string]: any;
}

// ── Sub-namespaces ───────────────────────────────────────────────────────

export interface TerminalRecording {
  start(rows: number, cols: number): void;
  stop(): void;
  toggle(): void;
  save(path: string): boolean;
}

export interface TerminalPlayer {
  load(): void;
  play(): void;
  pause(): void;
  toggle(): void;
  step(): void;
  seek(fraction: number): void;
  speed(x: number): void;
  state(): PlayerState | null;
}

export interface TerminalSemantic {
  setMode(mode: ClassifierMode): void;
  markDirty(): void;
  state(): SessionState | null;
  nodeCount(): number;
  node(idx: number): GraphNode | null;
  cacheCount(): number;
  cacheEntry(idx: number): CacheEntry | null;
  rowText(row: number): string;
  rowToken(row: number): TokenName;
  tree(): string;
  snapshot(): SemanticSnapshot | null;
  export(): SemanticExport | null;
  buildGraph(): void;
  vtermRows(): number;
  setRowToken(row: number, name: TokenName): void;
}

export interface UseTerminal {
  /** True while a recording is active. Reactive. */
  isRecording: boolean;
  /** Frame count of the current/last recording. Reactive. */
  frameCount: number;
  /** Semantic frame counter — bumps each time the graph rebuilds. Reactive. */
  semFrame: number;
  /** Whether the semantic state has a pending diff vs. the previous snapshot. Reactive. */
  hasDiff: boolean;

  /** Set the working directory for the next shell spawn. */
  setCwd(path: string): void;

  /** Recording controls. */
  rec: TerminalRecording;
  /** Replay controls — operates on the in-memory recorder buffer. */
  play: TerminalPlayer;
  /** Semantic graph + classifier access. */
  sem: TerminalSemantic;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const POLL_MS = 250;

const tryParse = <T,>(s: any): T | null => {
  if (typeof s !== 'string' || s.length === 0) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

const toTokenName = (s: any): TokenName => (typeof s === 'string' ? (s as TokenName) : 'text');

const modeIndex = (m: ClassifierMode): number => {
  switch (m) {
    case 'none': return 0;
    case 'basic': return 1;
    case 'claude_code': return 2;
    case 'json': return 3;
  }
};

// ── The hook ─────────────────────────────────────────────────────────────

export interface UseTerminalOpts {
  /** Initial classifier mode applied on mount. Default: leave unchanged. */
  classifier?: ClassifierMode;
}

export function useTerminal(opts: UseTerminalOpts = {}): UseTerminal {
  const [isRecording, setIsRecording] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [semFrame, setSemFrame] = useState(0);
  const [hasDiff, setHasDiff] = useState(false);

  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Apply initial classifier mode once.
  useEffect(() => {
    const m = optsRef.current.classifier;
    if (m !== undefined) call('__sem_set_mode', modeIndex(m));
  }, []);

  // Poll reactive bits. Heavier queries (nodes, cache) stay imperative.
  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const rec = (call('__rec_is_recording') ?? 0) === 1;
      const fc = call('__rec_frame_count') ?? 0;
      const sf = call('__sem_frame') ?? 0;
      const diff = (call('__sem_has_diff') ?? 0) === 1;
      setIsRecording((prev) => (prev !== rec ? rec : prev));
      setFrameCount((prev) => (prev !== fc ? fc : prev));
      setSemFrame((prev) => (prev !== sf ? sf : prev));
      setHasDiff((prev) => (prev !== diff ? diff : prev));
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const rec: TerminalRecording = {
    start: (rows, cols) => call('__rec_start', rows, cols),
    stop: () => call('__rec_stop'),
    toggle: () => call('__rec_toggle'),
    save: (path) => (call('__rec_save', path) ?? 0) === 1,
  };

  const play: TerminalPlayer = {
    load: () => call('__play_load'),
    play: () => call('__play_play'),
    pause: () => call('__play_pause'),
    toggle: () => call('__play_toggle'),
    step: () => call('__play_step'),
    seek: (fraction) => call('__play_seek', fraction),
    speed: (x) => call('__play_speed', x),
    state: (): PlayerState | null => {
      const raw = call('__play_state');
      return raw && typeof raw === 'object' ? (raw as PlayerState) : null;
    },
  };

  const sem: TerminalSemantic = {
    setMode: (mode) => call('__sem_set_mode', modeIndex(mode)),
    markDirty: () => call('__sem_build_graph'),
    state: () => {
      const raw = call('__sem_state');
      return raw && typeof raw === 'object' ? (raw as SessionState) : null;
    },
    nodeCount: () => call('__sem_node_count') ?? 0,
    node: (idx) => {
      const raw = call('__sem_node', idx);
      return raw && typeof raw === 'object' ? (raw as GraphNode) : null;
    },
    cacheCount: () => call('__sem_cache_count') ?? 0,
    cacheEntry: (idx) => {
      const raw = call('__sem_cache_entry', idx);
      return raw && typeof raw === 'object' ? (raw as CacheEntry) : null;
    },
    rowText: (row) => call('__sem_row_text', row) ?? '',
    rowToken: (row) => toTokenName(call('__sem_row_token', row)),
    tree: () => call('__sem_tree') ?? '',
    snapshot: () => {
      const raw = call('__sem_snapshot');
      if (raw && typeof raw === 'object') return raw as SemanticSnapshot;
      return tryParse<SemanticSnapshot>(raw);
    },
    export: () => {
      const raw = call('__sem_export');
      if (raw && typeof raw === 'object') return raw as SemanticExport;
      return tryParse<SemanticExport>(raw);
    },
    buildGraph: () => call('__sem_build_graph'),
    vtermRows: () => call('__sem_vterm_rows') ?? 0,
    setRowToken: (row, name) => call('__sem_set_row_token', row, name),
  };

  return {
    isRecording,
    frameCount,
    semFrame,
    hasDiff,
    setCwd: (path) => call('__terminal_set_cwd', path),
    rec,
    play,
    sem,
  };
}
