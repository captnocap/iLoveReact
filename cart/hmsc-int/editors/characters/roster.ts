// editors/characters/roster.ts — the route's persistence seam (V20, from the
// FIRST version: persistence is not a retrofit).
//
// The roster wraps the 'characters' stream (game/figure/stream.ts) on a Store:
// save appends the RESULTING BodyDocument as an 'authored' event AND
// materializes snapshots in the same breath, so data/snapshots/ is never
// stale relative to what the user last saved — the compile reads the snapshot,
// never the history. createRoster(store) is the testable door (tests hand it
// a scratch store); editorRoster() is the live singleton on editors/store.ts.

import type { LogPosition, Store, StreamHandle } from '../../data';
import { charactersStream, type CharactersEvent, type CharactersStreamState } from '../../game/figure/stream';
import type { BodyDocument } from '../../game/figure/body';

export type Roster = {
  /** append the authored document (upsert by id) + materialize snapshots */
  save: (id: string, doc: BodyDocument) => LogPosition;
  /** forget a character (its history stays in the log) + materialize */
  remove: (id: string) => LogPosition;
  /** the current roster (id → doc + rail order) */
  state: () => CharactersStreamState;
  /** the roster AS OF an undo point (a global log position) */
  stateAt: (globalSeq: number) => CharactersStreamState;
  /** the current undo-chain position */
  undoPoint: () => number;
};

export function createRoster(store: Store): Roster {
  const stream: StreamHandle<CharactersStreamState, CharactersEvent> = store.defineStream(charactersStream);
  return {
    save: (id, doc) => {
      const at = stream.append({ kind: 'authored', id, doc });
      store.materializeSnapshots();
      return at;
    },
    remove: (id) => {
      const at = stream.append({ kind: 'removed', id });
      store.materializeSnapshots();
      return at;
    },
    state: () => stream.state(),
    stateAt: (globalSeq) => stream.stateAt(globalSeq),
    undoPoint: () => store.undoPoint(),
  };
}

/** Mint a roster id: time-sortable, collision-safe at edit rate. */
export function mintCharacterId(): string {
  return `chr-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(36)}`;
}

// NOTE: the route no longer rides a roster singleton — it opens the
// 'characters' channel via editorChannel() and a RouteSession
// (editors/sessions.ts), so every save is a labeled session commit on the one
// undo chain. createRoster stays as the headless/testable door (the P4
// round-trip suite drives it against scratch stores).
