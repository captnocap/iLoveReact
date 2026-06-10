// editors/sessions.ts — the route-scoped session history (V20, ruled).
//
// THE USER'S WORDS: "the workspace session history and different channels for
// the history... route specific session commit histories and then sprinkle in
// the edit commits after each interaction so i can work while the interface
// is being built around it."
//
// The shape: a route opens a SESSION on its concern channel ('/vehicles' on
// 'vehicles', '/' on 'world', '/characters' on 'characters'). Every authoring
// INTERACTION appends one edit-commit. The 'sessions' stream records ONLY the
// session lifecycle — opened/committed/closed markers — while content events
// keep landing in their own concern stream, untouched. Because every marker
// and every content event rides the ONE global sequence (data/), the history
// is cross-channel ordered for free, an interaction's undo point is its
// commit's log position (V20), and "what did I do this session, on this
// route" is a fold of the sessions stream.
//
// Two commit grades, so routes adopt the layer at whatever depth their
// content has reached:
//   commit(event, label) — the interaction's content event goes to the
//     channel stream AND the marker records its position. The full V20 deal:
//     replayable content + a labeled undo point. (vehicles, characters)
//   note(label) — marker only, for routes whose content is not event-sourced
//     yet (the map editor: its world still saves through the workspace
//     session files; the marker gives it the per-interaction commit history
//     TODAY, and content events join the same channel later by addition —
//     V20 schema evolution, nothing to migrate).
//
// createSessionLog(store) is the testable door (tests hand it a scratch
// store); editorSessions() is the live singleton on editors/store.ts — the
// same split roster.ts uses.

import type { LogPosition, Store, StreamDef, StreamHandle } from '../data';
import { appendProbe, resetAppendProbe } from '../data';
import { GAME_TELEMETRY } from '../game/telemetry';
import { editorStore } from './store';

export type SessionsEvent =
  | { kind: 'opened'; session: string; route: string; channel: string }
  | { kind: 'committed'; session: string; channel: string; label: string; at: number | null }
  | { kind: 'closed'; session: string };

export type SessionCommit = {
  /** the marker's own log position — stateAt(seq) on ANY channel is the
   *  world as of this interaction (the content event, if any, sits below it) */
  seq: number;
  /** the content event's position in the concern stream (null = marker-only) */
  at: number | null;
  label: string;
};

export type SessionRecord = {
  id: string;
  route: string;
  channel: string;
  openedSeq: number;
  /** null while the session is open (or if the process died before close) */
  closedSeq: number | null;
  commits: SessionCommit[];
};

export type SessionsState = {
  sessions: Record<string, SessionRecord>;
  /** open order — the total cross-session timeline */
  order: string[];
};

export const sessionsStream: StreamDef<SessionsState, SessionsEvent> = Object.freeze({
  name: 'sessions',
  initial: (): SessionsState => ({ sessions: {}, order: [] }),
  apply: (state: SessionsState, event: SessionsEvent, seq = 0): SessionsState => {
    switch (event?.kind) {
      case 'opened': {
        if (event.session in state.sessions) return state; // replays can't fork a session
        state.sessions[event.session] = {
          id: event.session, route: event.route, channel: event.channel,
          openedSeq: seq, closedSeq: null, commits: [],
        };
        state.order.push(event.session);
        return state;
      }
      case 'committed': {
        const open = state.sessions[event.session];
        if (!open) return state; // a marker without its session is future noise, not a crash
        open.commits.push({ seq, at: event.at ?? null, label: event.label });
        return state;
      }
      case 'closed': {
        const open = state.sessions[event.session];
        if (!open) return state;
        open.closedSeq = seq;
        return state;
      }
      default:
        // Unknown kinds from the future MUST pass through untouched (V20
        // schema evolution by addition; old streams stay valid forever).
        return state;
    }
  },
});

/** One open authoring session on one route's channel. */
export type RouteSession<Event> = {
  id: string;
  route: string;
  channel: string;
  /** one authoring interaction: content event → the channel stream, labeled
   *  commit marker → the sessions stream, snapshots re-materialized (the
   *  roster.ts invariant: snapshots are never stale relative to the last
   *  save). Returns the marker's position — the interaction's undo point. */
  commit: (event: Event, label: string) => LogPosition;
  /** MANY content events as ONE batch: append every event + its marker, then
   *  materialize snapshots ONCE at the end. Per-event commit() re-materializes
   *  the whole store on every call, so a 352-piece building move (704 events)
   *  stalls the editor; this folds it into a single snapshot pass. Returns the
   *  last marker position, or null for an empty batch. */
  commitMany: (items: ReadonlyArray<{ event: Event; label: string }>) => LogPosition | null;
  /** an interaction whose content isn't event-sourced yet: marker only, no
   *  snapshot churn (no content changed). Still an undo-chain position. */
  note: (label: string) => LogPosition;
  /** record the close marker + materialize. Idempotent. */
  close: () => void;
};

export type SessionLog = {
  /** open a session for a route on its concern channel */
  open: <State, Event>(route: string, channel: StreamHandle<State, Event>, id?: string) => RouteSession<Event>;
  /** the materialized session history */
  state: () => SessionsState;
  /** the history AS OF an undo point */
  stateAt: (globalSeq: number) => SessionsState;
  /** the current undo-chain position */
  undoPoint: () => number;
};

export type SessionLogOptions = {
  /** Live build interactions keep the append durable now, then materialize
   *  snapshots off the frame. Tests and non-live callers default to sync. */
  snapshotMode?: 'sync' | 'defer';
  scheduleSnapshot?: (fn: () => void) => unknown;
};

function perfMs(): number {
  const host = globalThis as any;
  if (typeof host.__bench_now_us === 'function') {
    const us = Number(host.__bench_now_us());
    if (Number.isFinite(us)) return us / 1000;
  }
  const perf = (globalThis as any).performance;
  return typeof perf?.now === 'function' ? perf.now() : Date.now();
}

function defaultSnapshotScheduler(fn: () => void): unknown {
  const timer = (globalThis as any).setTimeout;
  return typeof timer === 'function' ? timer(fn, 0) : fn();
}

/** Mint a session id: time-sortable, collision-safe at route-visit rate
 *  (the mintCharacterId idiom). */
export function mintSessionId(route: string): string {
  const stem = route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root';
  return `ses-${stem}-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(36)}`;
}

export function createSessionLog(store: Store, options: SessionLogOptions = {}): SessionLog {
  const stream: StreamHandle<SessionsState, SessionsEvent> = store.defineStream(sessionsStream);
  const snapshotMode = options.snapshotMode ?? 'sync';
  const scheduleSnapshot = options.scheduleSnapshot ?? defaultSnapshotScheduler;
  let snapshotPending = false;
  let snapshotToken = 0;

  const materializeNow = (reason: string, scheduledAtMs: number | null = null): void => {
    snapshotPending = false;
    snapshotToken += 1;
    const t0 = perfMs();
    const written = store.materializeSnapshots();
    const ms = perfMs() - t0;
    const delayMs = scheduledAtMs == null ? 0 : Math.max(0, t0 - scheduledAtMs);
    GAME_TELEMETRY.recordDiagnostic('worldStream', 'session.snapshot.flush', {
      reason,
      mode: snapshotMode,
      streams: written.length,
      delayMs,
      ms,
    });
    if (ms >= 16) {
      console.warn(`[PLACEFREEZE] snapshot flush reason=${reason} mode=${snapshotMode} streams=${written.length} delayMs=${delayMs.toFixed(2)} ms=${ms.toFixed(2)}`);
    }
  };

  const materializeAfterCommit = (reason: string): void => {
    if (snapshotMode === 'sync') {
      materializeNow(reason);
      return;
    }
    if (snapshotPending) {
      GAME_TELEMETRY.recordDiagnostic('worldStream', 'session.snapshot.coalesced', { reason, mode: snapshotMode });
      return;
    }
    snapshotPending = true;
    const token = snapshotToken + 1;
    snapshotToken = token;
    const scheduledAtMs = perfMs();
    GAME_TELEMETRY.recordDiagnostic('worldStream', 'session.snapshot.schedule', { reason, mode: snapshotMode });
    scheduleSnapshot(() => {
      if (!snapshotPending || snapshotToken !== token) return;
      materializeNow(reason, scheduledAtMs);
    });
  };

  const open = <State, Event>(route: string, channel: StreamHandle<State, Event>, id?: string): RouteSession<Event> => {
    const session = id ?? mintSessionId(route);
    stream.append({ kind: 'opened', session, route, channel: channel.name });
    let closed = false;
    return {
      id: session,
      route,
      channel: channel.name,
      commit: (event: Event, label: string): LogPosition => {
        const t0 = perfMs();
        const appendT0 = perfMs();
        const at = channel.append(event);
        const appendMs = perfMs() - appendT0;
        const markerT0 = perfMs();
        const pos = stream.append({ kind: 'committed', session, channel: channel.name, label, at: at.globalSeq });
        const markerMs = perfMs() - markerT0;
        const scheduleT0 = perfMs();
        materializeAfterCommit('commit');
        const scheduleMs = perfMs() - scheduleT0;
        const totalMs = perfMs() - t0;
        GAME_TELEMETRY.recordDiagnostic('worldStream', 'session.commit', {
          route,
          channel: channel.name,
          label,
          mode: snapshotMode,
          appendMs,
          markerMs,
          snapshotScheduleMs: scheduleMs,
          totalMs,
        });
        if (totalMs >= 16) {
          console.warn(`[PLACEFREEZE] session.commit route=${route} channel=${channel.name} mode=${snapshotMode} appendMs=${appendMs.toFixed(2)} markerMs=${markerMs.toFixed(2)} snapshotScheduleMs=${scheduleMs.toFixed(2)} totalMs=${totalMs.toFixed(2)}`);
        }
        return pos;
      },
      commitMany: (items: ReadonlyArray<{ event: Event; label: string }>): LogPosition | null => {
        if (!items.length) return null;
        const t0 = perfMs();
        let pos: LogPosition | null = null;
        let channelMs = 0;
        let markerMs = 0;
        // ONE write transaction per touched DB for the whole batch
        // (PLACEPERF-0610), and the FULL cost story (req_0492): channel vs
        // marker appends timed separately, and the data layer's appendProbe
        // splits each append into seq-read / stringify / insert / fold so
        // the warn line names where a slow batch actually spends.
        resetAppendProbe();
        store.batch(() => {
          for (const item of items) {
            const a0 = perfMs();
            const at = channel.append(item.event);
            channelMs += perfMs() - a0;
            const m0 = perfMs();
            pos = stream.append({ kind: 'committed', session, channel: channel.name, label: item.label, at: at.globalSeq });
            markerMs += perfMs() - m0;
          }
        });
        // ONE snapshot pass for the whole batch — the per-commit cost that stalled.
        materializeAfterCommit('commitMany');
        const totalMs = perfMs() - t0;
        GAME_TELEMETRY.recordDiagnostic('worldStream', 'session.commitMany', {
          route,
          channel: channel.name,
          count: items.length,
          mode: snapshotMode,
          channelMs,
          markerMs,
          seqMs: appendProbe.seqMs,
          jsonMs: appendProbe.jsonMs,
          insertMs: appendProbe.insertMs,
          foldMs: appendProbe.foldMs,
          totalMs,
        });
        if (totalMs >= 16) {
          console.warn(
            `[PLACEFREEZE] session.commitMany route=${route} channel=${channel.name} count=${items.length} mode=${snapshotMode}`
            + ` channelMs=${channelMs.toFixed(2)} markerMs=${markerMs.toFixed(2)}`
            + ` | seqMs=${appendProbe.seqMs.toFixed(2)} jsonMs=${appendProbe.jsonMs.toFixed(2)} insertMs=${appendProbe.insertMs.toFixed(2)} foldMs=${appendProbe.foldMs.toFixed(2)}`
            + ` totalMs=${totalMs.toFixed(2)}`,
          );
        }
        return pos;
      },
      note: (label: string): LogPosition =>
        stream.append({ kind: 'committed', session, channel: channel.name, label, at: null }),
      close: (): void => {
        if (closed) return;
        closed = true;
        stream.append({ kind: 'closed', session });
        materializeNow('close');
      },
    };
  };

  return {
    open,
    state: () => stream.state(),
    stateAt: (globalSeq) => stream.stateAt(globalSeq),
    undoPoint: () => store.undoPoint(),
  };
}

/** "What did I do on this route" — every session on `route`, in open order. */
export function sessionsOnRoute(state: SessionsState, route: string): SessionRecord[] {
  return state.order.map((id) => state.sessions[id]).filter((s) => s && s.route === route);
}

let live: SessionLog | null = null;

/** The LIVE session log on the tool's one store — route code only (never tests). */
export function editorSessions(): SessionLog {
  if (!live) live = createSessionLog(editorStore(), { snapshotMode: 'defer' });
  return live;
}
