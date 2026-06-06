// editors/items/stream.ts — the V20 concern for sculpted items (ITEMSCULPT-0606).
//
// The roster of items authored in /items: each is a Globe-wrapped sculpt
// (base radius + depth amount + the 48×24 signed displacement grid — the ONE
// deformation truth the grab tool and the depth paint both edit) plus its
// surface color and blockout provenance. The shape mirrors the characters
// roster ('authored' upserts, 'removed' deletes, unknown kinds pass through —
// V20 schema evolution by addition), so the route, the compile, and any
// future consumer fold it the same way.

import type { StreamDef } from '../../data';

export type SculptedItemDoc = {
  kind: 'sculpted-item';
  version: 1;
  name: string;
  /** base sphere radius, meters */
  radius: number;
  /** world meters at displace = ±1 */
  amount: number;
  /** displacement grid dims (48×24 — the sculpt stack's unwrap space) */
  cols: number;
  rows: number;
  /** signed −1..1 displacement, row-major */
  grid: number[];
  /** flat surface color (#rrggbb) */
  color: string;
  /** the blockout this was baked from (null = sculpted from the blank sphere) */
  source: { blocks: number; dims: { w: number; d: number; h: number } } | null;
  metadata?: { title?: string };
};

export type ItemsStreamState = {
  items: Record<string, SculptedItemDoc>;
  /** save order — the roster row */
  order: string[];
};

export type ItemsEvent =
  | { kind: 'authored'; id: string; doc: SculptedItemDoc }
  | { kind: 'removed'; id: string };

export const itemsStream: StreamDef<ItemsStreamState, ItemsEvent> = Object.freeze({
  name: 'items',
  initial: (): ItemsStreamState => ({ items: {}, order: [] }),
  apply: (state: ItemsStreamState, event: ItemsEvent): ItemsStreamState => {
    switch (event?.kind) {
      case 'authored': {
        const known = event.id in state.items;
        return {
          items: { ...state.items, [event.id]: event.doc },
          order: known ? state.order : [...state.order, event.id],
        };
      }
      case 'removed': {
        if (!(event.id in state.items)) return state;
        const items = { ...state.items };
        delete items[event.id];
        return { items, order: state.order.filter((id) => id !== event.id) };
      }
      default:
        // Unknown kinds are future additions — old materializers skip them.
        return state;
    }
  },
});

/** Mint an item id: time-sortable, collision-safe at save rate (the
 *  mintCharacterId idiom). */
export function mintItemId(): string {
  return `itm-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(36)}`;
}
