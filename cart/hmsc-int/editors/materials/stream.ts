// editors/materials/stream — the V20 concern for authored materials
// (AUTOSAVE-0605: /textures persisted Materialized materials only to the
// legacy shared 'hmsc' localstore blob — durable, but OFF the chain: no
// global sequence, no undo position, exactly the monolith V20 rules out).
//
// The concern records every Materialize/delete as its own event; the
// materialized snapshot is the CATALOG (id → material record, authoring
// order). The legacy localstore keeps serving renderers unchanged (stuff-
// first: no redesign) — this stream is the V20 truth the future
// editors/materials capture inherits. Unknown kinds pass through (addition).

import type { StreamDef } from '../../data';

export type MaterialRecord = {
  id: string;
  label: string;
  shaderId: string;
  /** the Effect data[] knob values at Materialize time — the recipe */
  data: number[];
};

export type MaterialsStreamState = {
  materials: Record<string, MaterialRecord>;
  order: string[];
};

export type MaterialsEvent =
  | { kind: 'materialized'; material: MaterialRecord }
  | { kind: 'removed'; id: string };

export const materialsStream: StreamDef<MaterialsStreamState, MaterialsEvent> = Object.freeze({
  name: 'materials',
  initial: (): MaterialsStreamState => ({ materials: {}, order: [] }),
  apply: (state: MaterialsStreamState, event: MaterialsEvent): MaterialsStreamState => {
    switch (event?.kind) {
      case 'materialized': {
        const known = event.material.id in state.materials;
        return {
          materials: { ...state.materials, [event.material.id]: event.material },
          order: known ? state.order : [...state.order, event.material.id],
        };
      }
      case 'removed': {
        if (!(event.id in state.materials)) return state;
        const materials = { ...state.materials };
        delete materials[event.id];
        return { materials, order: state.order.filter((id) => id !== event.id) };
      }
      default:
        // Unknown kinds are future additions — old materializers skip them.
        return state;
    }
  },
});
