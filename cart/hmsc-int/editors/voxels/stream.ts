// editors/voxels/stream — the V20 concern for the /voxels blockout
// (AUTOSAVE-0605: the route held its blockout in React state with a manual
// JSON export as the only persistence — a V20 violation; "stateless design,
// saved at every micro change" is the floor).
//
// The concern is THE working blockout: declared dims + the placed blocks.
// Events carry the RESULTING document ('authored' replaces it — the
// editors/cutout precedent of route-owned stream defs), so the materialized
// snapshot is always the current blockout and every autosave is its own undo
// position on the one chain. Unknown kinds pass through (V20 addition).

import type { StreamDef } from '../../data';

export type VoxelBlockKind = 'floor' | 'wall' | 'glass' | 'trim';

export type VoxelBlockSnap = {
  id: number;
  x: number;
  y: number;
  z: number;
  kind: VoxelBlockKind;
};

export type VoxelBlockoutDoc = {
  dims: { w: number; d: number; h: number };
  /** the user-placed blocks (the derived floor lattice is NOT stored — it
   *  regenerates from dims, the same split the route renders from) */
  blocks: VoxelBlockSnap[];
};

export type VoxelsStreamState = {
  /** the working blockout — null until the first authored event */
  doc: VoxelBlockoutDoc | null;
};

export type VoxelsEvent = { kind: 'authored'; doc: VoxelBlockoutDoc };

export const voxelsStream: StreamDef<VoxelsStreamState, VoxelsEvent> = Object.freeze({
  name: 'voxels',
  initial: (): VoxelsStreamState => ({ doc: null }),
  apply: (state: VoxelsStreamState, event: VoxelsEvent): VoxelsStreamState => {
    switch (event?.kind) {
      case 'authored':
        return { doc: event.doc };
      default:
        // Unknown kinds are future additions — old materializers skip them.
        return state;
    }
  },
});
