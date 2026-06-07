// editors/workbench/livePoll.ts — the ONE live-doors poll both step-9 sources
// share (WBSET9-0606). The settings panel and the logs stream both go stale
// the same two ways: the sessions stream moved (a commit landed anywhere) or
// the tunables registry moved (a knob turned — possibly on the still-living
// /settings route). SettingsRoute.tsx:79-92 polls exactly these two doors;
// this module is that poll as a shared subscription so neither source grows
// its own interval (the §8 no-duplication law).
//
// The poll interval is itself a registered tunable (the settings page's
// dogfood rule, census/settings.md C9): the workbench view registers its own
// numbers where they live.

import { editorSessions } from '../sessions';
import { editorTunables } from '../tunables';

/** P2: the workbench view's own behavior numbers — registered like everyone's. */
export const WORKBENCH_VIEW = {
  /** how often the live doors (sessions seq + tunables revision) are checked */
  pollMs: 500,
  /** newest-first stream rows the logs stage renders per frame */
  logRowCap: 300,
  /** bus rows the settings rig's tuning feed shows */
  feedRowCap: 24,
};
editorTunables().register({
  system: 'workbench-view', route: '/workbench', table: WORKBENCH_VIEW,
  specs: {
    pollMs: { label: 'live poll ms', min: 100, max: 5000, step: 100, precision: 0 },
    logRowCap: { label: 'log row cap', min: 40, max: 2000, step: 20, precision: 0 },
    feedRowCap: { label: 'tuning feed rows', min: 5, max: 200, step: 5, precision: 0 },
  },
});

/** undoPoint moves on any session commit; revision on any knob event. */
function readDoors(): { undo: number; rev: number } {
  let undo = -1;
  try { undo = editorSessions().undoPoint(); } catch { /* no store host (headless) */ }
  return { undo, rev: editorTunables().revision() };
}

/**
 * Subscribe to live-door movement. ONE interval serves every subscriber
 * (starts with the first, stops with the last); each notify fires only when
 * either door actually moved since the previous check.
 */
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let last = { undo: -2, rev: -2 };

function tick(): void {
  const next = readDoors();
  if (next.undo === last.undo && next.rev === last.rev) return;
  last = next;
  for (const fn of Array.from(listeners)) {
    try { fn(); } catch { /* a dead subscriber never kills the poll */ }
  }
}

export function subscribeLiveDoors(fn: () => void): () => void {
  listeners.add(fn);
  if (!timer) {
    last = readDoors();
    timer = setInterval(tick, WORKBENCH_VIEW.pollMs);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
