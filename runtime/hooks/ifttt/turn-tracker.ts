// turn-tracker — emits agent turn boundaries and per-turn counts onto
// the bus.
//
// Claude Code hook fanout already places phase events on
// 'system:claude:<phase>' (see useIFTTT.md "Claude hook path"). This
// module subscribes to those phase events and re-emits the canonical
// turn-grain channels:
//
//   turn:start            — { at, turnId, phase: 'session-start'|'user-prompt' }
//   turn:end              — { at, turnId, count, tools, durationMs }
//   turn:tool-use         — { at, turnId, name, count }    every tool_use
//
// Plus the running tool-count is exposed through a registered IFTTT
// source `turn:tool-count` whose payload on every fire is the live
// counter — useful as a leaf in composables ("turn ended with exactly
// 1 tool call → end_turn-as-API"):
//
//   useIFTTT(
//     { all: ['turn:end', () => lastTurn.count <= 1] },
//     'flag-pathology:pat_premature_stop',
//   );
//
// Spec for the static-form source: the trigger 'turn:end' is itself a
// raw bus channel that fires once per turn. Pair with
// match: / count: / composable shapes for the per-tool / per-count
// scenarios in the catalog.
//
// Producer mapping:
//
//   system:claude:session-start  → turn:start (phase='session-start')
//   system:claude:user-prompt    → turn:start (phase='user-prompt')
//   system:claude:pre-tool       → turn:tool-use, increments counter
//   system:claude:stop           → turn:end
//
// Other phases (post-tool, etc.) flow through `system:claude:<phase>`
// untouched; this module only canonicalizes the boundaries.

import { subscribe, emit } from '../ffi';
import { registerIfttSource } from './ifttt-registry';

interface TurnState {
  turnId: string;
  startedAt: number;
  count: number;
  tools: string[];
}

let _current: TurnState | null = null;
let _nextTurnId = 1;
let _installed = false;

function newTurnId(): string {
  return `t_${Date.now().toString(36)}_${(_nextTurnId++).toString(36)}`;
}

function startTurn(phase: 'session-start' | 'user-prompt' | 'unknown'): void {
  if (_current) endTurn();
  _current = {
    turnId: newTurnId(),
    startedAt: Date.now(),
    count: 0,
    tools: [],
  };
  emit('turn:start', { at: _current.startedAt, turnId: _current.turnId, phase });
}

function endTurn(): void {
  if (!_current) return;
  const at = Date.now();
  emit('turn:end', {
    at,
    turnId: _current.turnId,
    count: _current.count,
    tools: _current.tools,
    durationMs: at - _current.startedAt,
  });
  _current = null;
}

function recordTool(name: string): void {
  if (!_current) {
    // Tool fire with no open turn — synthesize one so we don't miss
    // the count. Common when SessionStart hook isn't wired.
    startTurn('unknown');
  }
  if (!_current) return;
  _current.count++;
  _current.tools.push(name);
  emit('turn:tool-use', {
    at: Date.now(),
    turnId: _current.turnId,
    name,
    count: _current.count,
  });
}

/** Subscribe to system:claude phase events and emit canonical turn
 *  channels. Idempotent. Auto-runs on module import. */
export function installTurnTracker(): void {
  if (_installed) return;
  _installed = true;

  subscribe('system:claude:session-start', () => startTurn('session-start'));
  subscribe('system:claude:user-prompt', () => startTurn('user-prompt'));

  subscribe('system:claude:pre-tool', (payload: any) => {
    const name = String(payload?.tool ?? payload?.name ?? 'unknown');
    recordTool(name);
  });

  subscribe('system:claude:stop', () => endTurn());
}

// Auto-install on import — same pattern as the other ifttt-* modules.
installTurnTracker();

// ── IFTTT source registrations ───────────────────────────────────

// `turn:tool-count` — fires the live counter on every tool use.
// Useful as a leaf in composables. Static form: subscribe to
// 'turn:tool-count' to get every increment with the running total.
registerIfttSource('turn:tool-count', {
  match(spec) {
    if (spec !== 'turn:tool-count') return null;
    return {
      subscribe(onFire) {
        return subscribe('turn:tool-use', (payload: any) => {
          onFire({ count: payload?.count ?? 0, name: payload?.name, turnId: payload?.turnId });
        });
      },
    };
  },
});

/** Inspect: state of the in-progress turn, if any. */
export function currentTurn(): Readonly<TurnState> | null {
  return _current;
}
