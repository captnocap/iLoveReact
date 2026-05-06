// Module-level supervisor-thread store, multi-session, pg-backed.
//
// Why module-level state instead of React context? Identity continuity
// across the rail ↔ activity morph: the chat panel re-mounts when its
// slot changes (rail vs activity-content area), and the thread state
// must survive that swap unchanged. A module-level store is the
// simplest version of this that doesn't fight the renderer.
//
// Persistence: each session is a row in `cart-chat-session` (assistant
// bucket); each turn is a row in `cart-chat-turn` linked by
// `session_id`. Both use the JSONB-blob schema (id PK, data JSONB).
// The store loads the most recent session's turns on first read and
// otherwise lazy-loads sessions as the rail history list demands them.
//
// `_turns` is the live transcript of the *current* session only. The
// rail's history list reads `_sessions` directly via useChatSessions().

import * as React from 'react';
import * as pgConn from '../db/connections';
import { ensureBootstrapped } from '../db/bootstrap';
import { lit, val, ident, tableName } from '../db/sql';
import type { AssistantTurn, ChatSession, ChatSurface, ParallelCandidate } from './types';

const TURN_TABLE = ident(tableName('chat-turn'));
const SESSION_TABLE = ident(tableName('chat-session'));

// ── Live state ────────────────────────────────────────────────────────

let _sessions: ChatSession[] = [];
let _currentSessionId: string | null = null;
let _turns: AssistantTurn[] = [];
let _loaded = false;
let _loadingPromise: Promise<void> | null = null;

const _subs = new Set<() => void>();
const _sessionSubs = new Set<() => void>();

function _notify(): void {
  for (const s of _subs) s();
}

function _notifySessions(): void {
  for (const s of _sessionSubs) s();
}

function _subscribe(fn: () => void): () => void {
  _subs.add(fn);
  return () => { _subs.delete(fn); };
}

function _subscribeSessions(fn: () => void): () => void {
  _sessionSubs.add(fn);
  return () => { _sessionSubs.delete(fn); };
}

function _getTurns(): AssistantTurn[] {
  return _turns;
}

function _getSessions(): ChatSession[] {
  return _sessions;
}

// ── Persistence helpers ───────────────────────────────────────────────

function _loadSessionsFromPg(): ChatSession[] {
  const rows = pgConn.query<{ data: any }>(
    'assistant',
    `SELECT data FROM ${SESSION_TABLE}`,
  );
  const out: ChatSession[] = rows.map(r => {
    const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    return d as ChatSession;
  });
  // Newest first.
  out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return out;
}

function _loadTurnsFromPg(sessionId: string): AssistantTurn[] {
  const rows = pgConn.query<{ data: any }>(
    'assistant',
    `SELECT data FROM ${TURN_TABLE} WHERE data->>'session_id' = ${lit(sessionId)}`,
  );
  const turns: Array<AssistantTurn & { session_id?: string; created_at?: string }> = rows.map(r => {
    const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    return d;
  });
  turns.sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
  return turns.map(t => {
    const { session_id: _sid, created_at: _ca, ...rest } = t as any;
    return rest as AssistantTurn;
  });
}

function _writeSession(session: ChatSession): void {
  const sql =
    `INSERT INTO ${SESSION_TABLE} (id, data) VALUES (${val(session.id)}, ${val(session)}) ` +
    `ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`;
  if (!pgConn.exec('assistant', sql)) {
    throw new Error(`chat: persist session ${session.id} failed`);
  }
}

function _writeTurn(sessionId: string, turn: AssistantTurn): void {
  const row: any = { ...turn, session_id: sessionId, created_at: new Date().toISOString() };
  const sql =
    `INSERT INTO ${TURN_TABLE} (id, data) VALUES (${val(turn.id)}, ${val(row)}) ` +
    `ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`;
  if (!pgConn.exec('assistant', sql)) {
    throw new Error(`chat: persist turn ${turn.id} failed`);
  }
}

function _deleteSessionFromPg(sessionId: string): void {
  pgConn.exec('assistant', `DELETE FROM ${TURN_TABLE} WHERE data->>'session_id' = ${lit(sessionId)}`);
  pgConn.exec('assistant', `DELETE FROM ${SESSION_TABLE} WHERE id = ${lit(sessionId)}`);
}

function _bumpSessionUpdatedAt(): void {
  if (!_currentSessionId) return;
  const i = _sessions.findIndex(s => s.id === _currentSessionId);
  if (i < 0) return;
  const cur = _sessions[i];
  const updated: ChatSession = {
    ...cur,
    updated_at: new Date().toISOString(),
    turn_count: _turns.length,
  };
  _sessions = [updated, ..._sessions.slice(0, i), ..._sessions.slice(i + 1)];
  _writeSession(updated);
  _notifySessions();
}

// ── Public API ────────────────────────────────────────────────────────

/** Trigger an async load of the session list from pg. Idempotent. The
 *  rail history list calls this on mount; subsequent appendTurn /
 *  loadSession calls assume bootstrap has already completed. */
export function ensureChatLoaded(): Promise<void> {
  if (_loaded) return Promise.resolve();
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = (async () => {
    try {
      await ensureBootstrapped();
      _sessions = _loadSessionsFromPg();
      _loaded = true;
      _notifySessions();
    } finally {
      _loadingPromise = null;
    }
  })();
  return _loadingPromise;
}

export function getTurns(): AssistantTurn[] {
  return _turns;
}

export function getCurrentSessionId(): string | null {
  return _currentSessionId;
}

/** Append a turn to the current session. Auto-creates a session on the
 *  first turn so callers don't need a separate startNewSession step;
 *  they can just send. */
export function appendTurn(turn: AssistantTurn): void {
  if (!_currentSessionId) {
    // First turn of a fresh chat — mint a session row first.
    const now = new Date().toISOString();
    const titleSeed = turn.author === 'user' && turn.body
      ? turn.body.slice(0, 60)
      : '(untitled)';
    const session: ChatSession = {
      id: `chs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      title: titleSeed,
      created_at: now,
      updated_at: now,
      turn_count: 0,
    };
    _currentSessionId = session.id;
    _sessions = [session, ..._sessions];
    _writeSession(session);
    _notifySessions();
  }
  _turns = [..._turns, turn];
  _writeTurn(_currentSessionId, turn);
  _bumpSessionUpdatedAt();
  _notify();
}

export function replaceTurns(next: AssistantTurn[]): void {
  _turns = next;
  _notify();
}

/** Mutates the body of an existing turn (matched by id). No-op if the id
 *  isn't found — the asker may race the store on streaming updates and
 *  we'd rather drop a late update than throw. */
export function updateTurnBody(id: string, body: string): void {
  const i = _turns.findIndex((t) => t.id === id);
  if (i < 0) return;
  const cur = _turns[i];
  const updated = { ...cur, body } as AssistantTurn;
  _turns = [..._turns.slice(0, i), updated, ..._turns.slice(i + 1)];
  if (_currentSessionId) _writeTurn(_currentSessionId, updated);
  _notify();
}

/** Mark or clear an asst turn's `pending` flag. The render layer reads
 *  this to drive the generating-pixelate animation. Provider sets true
 *  when appending the empty asst turn and false once the final reply
 *  (body or surface) has landed. */
export function setTurnPending(id: string, pending: boolean): void {
  const i = _turns.findIndex((t) => t.id === id);
  if (i < 0) return;
  const cur = _turns[i];
  if (cur.author !== 'asst') return;
  const next: any = { ...cur };
  if (pending) next.pending = true;
  else delete next.pending;
  _turns = [..._turns.slice(0, i), next, ..._turns.slice(i + 1)];
  if (_currentSessionId) _writeTurn(_currentSessionId, next);
  _notify();
}

/** Attach (or clear) an embedded surface card on an assistant turn.
 *  Provider calls this after parseIntent on the finalized reply when
 *  the model emitted chat-loom tags. Pass `null` to drop a surface. */
export function updateTurnSurface(id: string, surface: ChatSurface | null): void {
  const i = _turns.findIndex((t) => t.id === id);
  if (i < 0) return;
  const cur = _turns[i];
  if (cur.author !== 'asst') return;
  const next: any = { ...cur };
  if (surface == null) delete next.surface;
  else next.surface = surface;
  _turns = [..._turns.slice(0, i), next, ..._turns.slice(i + 1)];
  if (_currentSessionId) _writeTurn(_currentSessionId, next);
  _notify();
}

/** Mutate one model candidate inside a parallel-response turn. */
export function updateParallelCandidate(
  turnId: string,
  candidateId: string,
  patch: Partial<ParallelCandidate>,
): void {
  const i = _turns.findIndex((t) => t.id === turnId);
  if (i < 0) return;
  const cur = _turns[i];
  if (cur.author !== 'parallel') return;
  const candidates = cur.candidates.map((c) => (
    c.id === candidateId ? { ...c, ...patch } : c
  ));
  const updated: AssistantTurn = { ...cur, candidates };
  _turns = [..._turns.slice(0, i), updated, ..._turns.slice(i + 1)];
  if (_currentSessionId) _writeTurn(_currentSessionId, updated);
  _notify();
}

/** Mark the candidate the user chose as canonical for this round. */
export function selectParallelCandidate(turnId: string, candidateId: string): ParallelCandidate | null {
  const i = _turns.findIndex((t) => t.id === turnId);
  if (i < 0) return null;
  const cur = _turns[i];
  if (cur.author !== 'parallel') return null;
  let selected: ParallelCandidate | null = null;
  const candidates = cur.candidates.map((c) => {
    const isSelected = c.id === candidateId;
    const next = { ...c, selected: isSelected };
    if (isSelected) selected = next;
    return next;
  });
  const updated: AssistantTurn = { ...cur, candidates };
  _turns = [..._turns.slice(0, i), updated, ..._turns.slice(i + 1)];
  if (_currentSessionId) _writeTurn(_currentSessionId, updated);
  _notify();
  return selected;
}

/** Switch the live transcript to a different session. Loads its turns
 *  synchronously from pg (we already paid the bootstrap cost). */
export function loadSession(id: string): void {
  if (id === _currentSessionId) return;
  _currentSessionId = id;
  _turns = _loadTurnsFromPg(id);
  _notify();
}

/** Clear the current session pointer and turns — the rail's chat slot
 *  will fall back to the history list. Used when the user asks for a
 *  fresh conversation; the existing session stays persisted. */
export function startNewSession(): void {
  _currentSessionId = null;
  _turns = [];
  _notify();
}

/** Permanently delete a session and its turns from pg. */
export function deleteSession(id: string): void {
  _deleteSessionFromPg(id);
  _sessions = _sessions.filter(s => s.id !== id);
  if (_currentSessionId === id) {
    _currentSessionId = null;
    _turns = [];
    _notify();
  }
  _notifySessions();
}

/** Hook — returns the live turn list. Subscribers re-render on mutate. */
export function useChatTurns(): AssistantTurn[] {
  return React.useSyncExternalStore(_subscribe, _getTurns, _getTurns);
}

/** Hook — returns the persisted session list (newest-first). Triggers
 *  the lazy load on first read so the rail's empty-state can render
 *  immediately and update once pg responds. */
export function useChatSessions(): ChatSession[] {
  React.useEffect(() => { void ensureChatLoaded(); }, []);
  return React.useSyncExternalStore(_subscribeSessions, _getSessions, _getSessions);
}

/** Hook — returns the active session id (null when in fresh-chat state). */
export function useCurrentSessionId(): string | null {
  return React.useSyncExternalStore(_subscribe, getCurrentSessionId, getCurrentSessionId);
}

/** True iff the cart has any chat presence — current session has turns
 *  OR the persisted session list is non-empty. The shell uses this to
 *  decide whether the side rail should follow the user back to home,
 *  matching the user's intuition that the chat "follows me" once it
 *  exists. The hook subscribes to both stores so it re-renders on
 *  appendTurn AND on session-list changes. */
function _getHasAny(): boolean {
  return _turns.length > 0 || _sessions.length > 0;
}
export function useChatHasAny(): boolean {
  React.useEffect(() => { void ensureChatLoaded(); }, []);
  // Subscribe to BOTH the turn store and the session store. We pick
  // turn-store as the primary subscription target (since useSyncExternalStore
  // only takes one) and trip the session-store via a side-effect hook
  // that forces a re-render when it fires.
  const [, force] = React.useState(0);
  React.useEffect(() => {
    return _subscribeSessions(() => force((n) => (n + 1) | 0));
  }, []);
  return React.useSyncExternalStore(_subscribe, _getHasAny, _getHasAny);
}

// ── Asker (provider → input strip seam) ──────────────────────────────
//
// `<AssistantChatProvider>` mounts inside ShellBody, owns the
// useAssistantChat hook, and publishes its orchestrated `ask` here.
// `InputStrip.submit()` calls `askAssistant(text)` to fire a chat turn
// without depending on hook context (the strip's slot changes during
// the morph; we can't host the hook there).

let _askerId = 0;
let _askers: Array<{ id: number; priority: number; fn: (text: string) => Promise<string> }> = [];

export function setAsker(fn: ((text: string) => Promise<string>) | null): void {
  _askers = fn ? [{ id: ++_askerId, priority: 0, fn }] : [];
}

/** Push a temporary ask handler. The newest handler wins until its
 *  disposer runs, which lets routes such as /chat override the global
 *  rail assistant without losing the provider's base handler. */
export function pushAsker(fn: (text: string) => Promise<string>, priority = 0): () => void {
  const id = ++_askerId;
  _askers = [..._askers, { id, priority, fn }];
  return () => {
    _askers = _askers.filter((a) => a.id !== id);
  };
}

export function askAssistant(text: string): Promise<string> {
  const top = _askers.reduce<typeof _askers[number] | null>((best, cur) => {
    if (!best) return cur;
    if (cur.priority > best.priority) return cur;
    if (cur.priority === best.priority && cur.id > best.id) return cur;
    return best;
  }, null);
  if (!top) {
    return Promise.reject(new Error('chat: AssistantChatProvider not mounted'));
  }
  return top.fn(text);
}

// Monotonic id helper for fresh turns — small + sufficient for an
// in-memory transcript. Used by the provider; ids are also written
// through to pg verbatim.
let _idCounter = 0;
export function nextTurnId(prefix: string): string {
  _idCounter = (_idCounter + 1) | 0;
  return `${prefix}_${Date.now().toString(36)}_${_idCounter}`;
}

// ── Chat status (provider → header subline) ───────────────────────────

export interface ChatStatus {
  phase: string;
  lastStatus: string;
  error: string | null;
}

let _status: ChatStatus = { phase: 'init', lastStatus: '', error: null };
const _statusSubs = new Set<() => void>();

export function setChatStatus(next: ChatStatus): void {
  if (
    _status.phase === next.phase &&
    _status.lastStatus === next.lastStatus &&
    _status.error === next.error
  ) return;
  _status = next;
  for (const s of _statusSubs) s();
}

function _subscribeStatus(fn: () => void): () => void {
  _statusSubs.add(fn);
  return () => { _statusSubs.delete(fn); };
}
function _getStatus(): ChatStatus { return _status; }

export function useChatStatus(): ChatStatus {
  return React.useSyncExternalStore(_subscribeStatus, _getStatus, _getStatus);
}
