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
        const record: SessionRecord = {
          id: event.session, route: event.route, channel: event.channel,
          openedSeq: seq, closedSeq: null, commits: [],
        };
        return {
          sessions: { ...state.sessions, [event.session]: record },
          order: [...state.order, event.session],
        };
      }
      case 'committed': {
        const open = state.sessions[event.session];
        if (!open) return state; // a marker without its session is future noise, not a crash
        const commit: SessionCommit = { seq, at: event.at ?? null, label: event.label };
        return {
          ...state,
          sessions: { ...state.sessions, [event.session]: { ...open, commits: [...open.commits, commit] } },
        };
      }
      case 'closed': {
        const open = state.sessions[event.session];
        if (!open) return state;
        return {
          ...state,
          sessions: { ...state.sessions, [event.session]: { ...open, closedSeq: seq } },
        };
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

/** Mint a session id: time-sortable, collision-safe at route-visit rate
 *  (the mintCharacterId idiom). */
export function mintSessionId(route: string): string {
  const stem = route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root';
  return `ses-${stem}-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(36)}`;
}

export function createSessionLog(store: Store): SessionLog {
  const stream: StreamHandle<SessionsState, SessionsEvent> = store.defineStream(sessionsStream);

  const open = <State, Event>(route: string, channel: StreamHandle<State, Event>, id?: string): RouteSession<Event> => {
    const session = id ?? mintSessionId(route);
    stream.append({ kind: 'opened', session, route, channel: channel.name });
    let closed = false;
    return {
      id: session,
      route,
      channel: channel.name,
      commit: (event: Event, label: string): LogPosition => {
        const at = channel.append(event);
        const pos = stream.append({ kind: 'committed', session, channel: channel.name, label, at: at.globalSeq });
        store.materializeSnapshots();
        return pos;
      },
      note: (label: string): LogPosition =>
        stream.append({ kind: 'committed', session, channel: channel.name, label, at: null }),
      close: (): void => {
        if (closed) return;
        closed = true;
        stream.append({ kind: 'closed', session });
        store.materializeSnapshots();
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
  if (!live) live = createSessionLog(editorStore());
  return live;
}
