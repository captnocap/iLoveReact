// game/figure/stream — the V20 per-concern stream for authored characters,
// defined in ONE registration (log name + materializer; a stream without
// snapshot support cannot be expressed — the data layer's incompleteness
// guard).
//
// The materialized snapshot is the ROSTER: every BodyDocument the user has
// authored in editors/characters/, keyed by id, in authoring order. The game/
// compile loads THIS view and hands each doc to bakeBodyDocument (V2-AMENDED:
// documents in, compiled figures out) — never the history (V20). Events carry
// the RESULTING document, not the edit verb: sculpt strokes, outline drags,
// wardrobe picks and region stamps are editor-side; the materializer stays a
// dumb upsert, so the round-trip author → stream → snapshot → bake is exact
// by construction, and every save is still its own undo position. The
// materializer tolerates unknown event kinds by contract — new character
// features arrive as event ADDITIONS, old logs stay valid forever (V20).

import type { StreamDef } from '../../data';
import type { BodyDocument } from './body';

export type CharactersStreamState = {
  /** the roster — every authored character, by id */
  characters: Record<string, BodyDocument>;
  /** first-authored order — the editor rail's stable listing */
  order: string[];
};

export type CharactersEvent =
  | { kind: 'authored'; id: string; doc: BodyDocument }
  | { kind: 'removed'; id: string };

export const charactersStream: StreamDef<CharactersStreamState, CharactersEvent> = Object.freeze({
  name: 'characters',
  initial: (): CharactersStreamState => ({ characters: {}, order: [] }),
  apply: (state: CharactersStreamState, event: CharactersEvent): CharactersStreamState => {
    switch (event?.kind) {
      case 'authored': {
        const known = event.id in state.characters;
        return {
          characters: { ...state.characters, [event.id]: event.doc },
          order: known ? state.order : [...state.order, event.id],
        };
      }
      case 'removed': {
        if (!(event.id in state.characters)) return state;
        const characters = { ...state.characters };
        delete characters[event.id];
        return { characters, order: state.order.filter((id) => id !== event.id) };
      }
      default:
        // Unknown kinds are future additions — old materializers skip them.
        return state;
    }
  },
});
