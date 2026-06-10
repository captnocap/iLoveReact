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

export const VOXEL_BLOCKOUT_TUNING = Object.freeze({
  /** Item-source default: 10cm cells, not the world builder's 1m substrate. */
  defaultCellSizeMeters: 0.1,
  minCellSizeMeters: 0.02,
  maxCellSizeMeters: 1,
  cellSizeStepMeters: 0.01,
});

export type VoxelBlockSnap = {
  id: number;
  x: number;
  y: number;
  z: number;
  kind: VoxelBlockKind;
};

export type VoxelBlockoutDoc = {
  dims: { w: number; d: number; h: number };
  /** edge length of one authored cell, in meters */
  cellSizeMeters: number;
  /** the user-placed blocks (the derived floor lattice is NOT stored — it
   *  regenerates from dims, the same split the route renders from) */
  blocks: VoxelBlockSnap[];
};

export type VoxelsStreamState = {
  /** the working blockout — null until the first authored event */
  doc: VoxelBlockoutDoc | null;
};

export type VoxelsEvent = { kind: 'authored'; doc: VoxelBlockoutDoc };

export function normalizeVoxelCellSizeMeters(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value)
    ? value
    : VOXEL_BLOCKOUT_TUNING.defaultCellSizeMeters;
  return Math.max(VOXEL_BLOCKOUT_TUNING.minCellSizeMeters, Math.min(VOXEL_BLOCKOUT_TUNING.maxCellSizeMeters, n));
}

export const voxelsStream: StreamDef<VoxelsStreamState, VoxelsEvent> = Object.freeze({
  name: 'voxels',
  initial: (): VoxelsStreamState => ({ doc: null }),
  apply: (state: VoxelsStreamState, event: VoxelsEvent): VoxelsStreamState => {
    switch (event?.kind) {
      case 'authored':
        return { doc: { ...event.doc, cellSizeMeters: normalizeVoxelCellSizeMeters(event.doc.cellSizeMeters) } };
      default:
        // Unknown kinds are future additions — old materializers skip them.
        return state;
    }
  },
});
