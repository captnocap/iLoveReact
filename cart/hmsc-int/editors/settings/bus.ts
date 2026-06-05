// editors/settings/bus.ts — the session event bus FOLD (SETTINGS-0605).
//
// The user's ruling: "a grand settings page that shows an event bus for all
// of these [the routes' session/autosave systems]". The unified record
// already exists — every route's session lifecycle and every labeled
// commit/note marker lands in the ONE 'sessions' stream (editors/sessions.ts,
// V20), cross-channel ordered by the global sequence. So the bus viewer is a
// PURE FOLD over SessionsState read through the existing doors
// (editorSessions().state() / .undoPoint()) — read-only, no second event
// system, no new persistence. This module is that fold; the route renders it.
//
// "Timestamp-order" is the global seq: V20 says an undo point IS a log
// position, and seq is strictly increasing across all streams. (Wall-clock
// display would need sessions.ts to fold the stored `at` stamp — a recorded
// hand-off, not built here.)

import type { SessionsState } from '../sessions';

/** one commit/note marker, bus-flattened */
export type BusRow = {
  /** the marker's global-sequence position — the bus ordering key */
  seq: number;
  route: string;
  channel: string;
  session: string;
  label: string;
  /** the content event's position (null = note-grade marker) */
  at: number | null;
};

export type BusChannelSummary = {
  channel: string;
  /** every route that has opened a session on this channel, first-seen order */
  routes: string[];
  sessions: number;
  /** sessions without a close marker (open now, or a process died) */
  open: number;
  commits: number;
};

/** Every commit/note across every session, newest first (seq DESC). */
export function busRows(state: SessionsState): BusRow[] {
  const rows: BusRow[] = [];
  for (const id of state.order) {
    const session = state.sessions[id];
    if (!session) continue;
    for (const commit of session.commits) {
      rows.push({
        seq: commit.seq,
        route: session.route,
        channel: session.channel,
        session: session.id,
        label: commit.label,
        at: commit.at,
      });
    }
  }
  rows.sort((a, b) => b.seq - a.seq);
  return rows;
}

/** Per-channel rollup: routes, session/commit counts, open sessions. */
export function busChannels(state: SessionsState): BusChannelSummary[] {
  const byChannel = new Map<string, BusChannelSummary>();
  for (const id of state.order) {
    const session = state.sessions[id];
    if (!session) continue;
    let summary = byChannel.get(session.channel);
    if (!summary) {
      summary = { channel: session.channel, routes: [], sessions: 0, open: 0, commits: 0 };
      byChannel.set(session.channel, summary);
    }
    if (!summary.routes.includes(session.route)) summary.routes.push(session.route);
    summary.sessions += 1;
    if (session.closedSeq === null) summary.open += 1;
    summary.commits += session.commits.length;
  }
  return [...byChannel.values()];
}

/** The page's filter: null = every channel. */
export function filterBusRows(rows: BusRow[], channel: string | null): BusRow[] {
  return channel === null ? rows : rows.filter((row) => row.channel === channel);
}
