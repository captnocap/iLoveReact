import type { GameState, TileKind } from '../design';

// The master-list read-model: the whole world rolled up into a nested tree
// (world -> chunk -> base kind + sparse overrides + zones) with
// per-kind world totals. A DERIVED view — never a storage shape. Honest model:
// a chunk is ONE base kind (its surfaceRegion) plus sparse overrides stacked on
// top (placedCells), NOT a flat per-cell array. When `painted` is supplied (the
// chunk painter's staging buffer), its staged cells are tallied too so the tree
// previews edits before they are exported.

export type CellRef = { x: number; z: number };
export type KindGroup = { count: number; cells: CellRef[] };

export type ChunkSummary = {
  id: string;
  label: string;
  bounds: { x: number; z: number; width: number; depth: number };
  baseKind: TileKind;
  baseCount: number;
  // Per-kind placed-cell overrides sitting on top of the base, within the chunk.
  overrides: Partial<Record<TileKind, KindGroup>>;
  zones: { id: string; name: string }[];
};

export type WorldTree = {
  layoutKey: string;
  widthCells: number;
  depthCells: number;
  // Authored inventory: `tile:<kind>` -> summed surfaceRegion area; `zone` ->
  // layer count. Region areas, not pixel-exact resolved kinds.
  worldTotals: Record<string, number>;
  chunks: ChunkSummary[];
  // Staged paint preview (placeableId -> cell count) when a painter buffer is
  // passed; undefined otherwise.
  paintedTotals?: Record<string, number>;
};

function within(x: number, z: number, rx: number, rz: number, rw: number, rd: number): boolean {
  return x >= rx && x < rx + rw && z >= rz && z < rz + rd;
}

function rectsOverlap(
  ax: number, az: number, aw: number, ad: number,
  bx: number, bz: number, bw: number, bd: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && az < bz + bd && az + ad > bz;
}

export function buildWorldTree(state: GameState, painted?: Map<string, string>): WorldTree {
  const world = state.world;
  const placedCells = Object.values(world.placedCells);

  const chunks: ChunkSummary[] = world.surfaceRegions.map((region) => {
    const overrides: Partial<Record<TileKind, KindGroup>> = {};
    for (const placed of placedCells) {
      if (!within(placed.cell.x, placed.cell.z, region.x, region.z, region.width, region.depth)) continue;
      const group = overrides[placed.kind] ?? { count: 0, cells: [] };
      group.count += 1;
      group.cells.push({ x: placed.cell.x, z: placed.cell.z });
      overrides[placed.kind] = group;
    }
    const zones = world.zones
      .filter((z) => rectsOverlap(region.x, region.z, region.width, region.depth, z.x, z.z, z.width, z.depth))
      .map((z) => ({ id: z.id, name: z.name }));
    return {
      id: region.id,
      label: region.label,
      bounds: { x: region.x, z: region.z, width: region.width, depth: region.depth },
      baseKind: region.kind,
      baseCount: region.width * region.depth,
      overrides,
      zones,
    };
  });

  const worldTotals: Record<string, number> = {};
  for (const region of world.surfaceRegions) {
    const key = `tile:${region.kind}`;
    worldTotals[key] = (worldTotals[key] ?? 0) + region.width * region.depth;
  }
  if (world.zones.length) worldTotals.zone = world.zones.length;

  let paintedTotals: Record<string, number> | undefined;
  if (painted && painted.size > 0) {
    paintedTotals = {};
    for (const id of painted.values()) {
      paintedTotals[id] = (paintedTotals[id] ?? 0) + 1;
    }
  }

  return {
    layoutKey: world.layout.key,
    widthCells: world.layout.widthCells,
    depthCells: world.layout.depthCells,
    worldTotals,
    chunks,
    paintedTotals,
  };
}
