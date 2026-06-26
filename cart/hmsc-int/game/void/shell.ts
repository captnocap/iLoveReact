// void/shell.ts — the procedural shell. An endless hash-generated city that
// costs nothing to store, wrapping the authored core as the OUTER RING of the
// SAME citywide map (V30: one map, never a changelevel).
//
// This regenerates the proven `hmsc_massive_map_lab` pattern (documented in
// docs/game/_archive/hmsc_massive_map_lab.md; the standalone cart was demolished
// 2026-06-10) INTO the game: a pure function of coordinates — no storage, pan
// away and back and the identical city reappears — flattened to ONE stride-9
// instance batch (x,y,z, sx,sy,sz, r,g,b) the host draws in a single call.
//
// Discipline #3 (seeded, never random): every value derives from voidHash, the
// SAME hash the distortion layer uses, so the shell is fair and replayable.

import { voidHash } from './distortion';
import { distanceOutsideCore, pointInCore, type WorldCore } from './distance';
import type { EdgeProfile } from './edges';
import { EMPTY_EDGE_PROFILE } from './edges';

// An axis-aligned water footprint the shell suppresses buildings inside (the
// void-water generator owns the actual water render; the shell just steps aside).
export type WaterRect = { minX: number; minZ: number; maxX: number; maxZ: number };

// Margin (m) around a road corridor / water rect within which a building lot is
// suppressed, so towers don't crowd the seam or sprout mid-river.
const SEAM_CLEAR_METERS = 5;

function pointInAnyRect(x: number, z: number, rects: readonly WaterRect[], margin: number): boolean {
  for (const r of rects) {
    if (x >= r.minX - margin && x <= r.maxX + margin && z >= r.minZ - margin && z <= r.maxZ + margin) return true;
  }
  return false;
}

// An outward continuation corridor (road OR grass field): where it crosses the
// map edge, its outward normal, and its width along the edge.
type Corridor = { x: number; z: number; nx: number; nz: number; width: number };

// Where a corridor crosses one chunk: the strip box to draw (clipped to the chunk
// and to the outward side of the boundary crossing) and the centerline a building
// lot must clear. Null when the corridor misses the chunk. Corridors are
// axis-aligned (the normal is ±X or ±Z), so they run straight out — clean against
// the axis grid.
type RoadStrip = { cx: number; cz: number; sx: number; sz: number; lineX: number; lineZ: number; halfW: number; alongX: boolean };
function corridorStripInChunk(c: Corridor, ox: number, oz: number, span: number): RoadStrip | null {
  const halfW = Math.max(SEAM_CLEAR_METERS, c.width / 2);
  const alongX = Math.abs(c.nx) > 0.5;
  if (alongX) {
    // Corridor centerline z = c.z; runs in x toward sign(nx) from c.x.
    if (c.z < oz - halfW || c.z > oz + span + halfW) return null;
    const lo = c.nx > 0 ? Math.max(ox, c.x) : ox;
    const hi = c.nx > 0 ? ox + span : Math.min(ox + span, c.x);
    if (hi - lo <= 0) return null;
    return { cx: (lo + hi) / 2, cz: c.z, sx: hi - lo, sz: c.width, lineX: 0, lineZ: c.z, halfW, alongX };
  }
  if (c.x < ox - halfW || c.x > ox + span + halfW) return null;
  const lo = c.nz > 0 ? Math.max(oz, c.z) : oz;
  const hi = c.nz > 0 ? oz + span : Math.min(oz + span, c.z);
  if (hi - lo <= 0) return null;
  return { cx: c.x, cz: (lo + hi) / 2, sx: c.width, sz: hi - lo, lineX: c.x, lineZ: 0, halfW, alongX };
}

// One procedural chunk is 160 m square — the lab's proven streaming grain.
export const SHELL_CHUNK_METERS = 160;
// How thick (in chunks) the COMPILE-side baked ring is around the authored map —
// the finite band of procedural city the gamefile ships so /compiled shows the
// void. 8 chunks ≈ 1.28 km past every edge: fills a generous horizon while the
// baked instance count stays a perimeter band (cheap), not a filled area. The
// truly-infinite streamed shell is a later seam (native loader).
export const VOID_SHELL_RING_CHUNKS = 8;
// Each chunk splits into a 2×2 block grid; each block holds up to this many lots.
const BLOCKS_PER_AXIS = 2;
const MAX_LOTS_PER_BLOCK = 4;
// Buildings stack from slabs ~this tall so the facade texture repeats per floor
// instead of stretching one tile over the whole tower; footprints cap to this
// span so the facade isn't smeared horizontally either.
const FACADE_TILE_METERS = 9;
const MAX_BUILDING_SPAN = 22;
// Ground slab sits flush with the authored ground (~y 0); a thin readable slab.
// Exported so the compiled bake's walkable ground collider sits at the SAME
// height the shell ground renders (see-it == walk-it).
export const SHELL_GROUND_TOP_Y = 0;
const GROUND_TOP_Y = SHELL_GROUND_TOP_Y;
const GROUND_THICKNESS = 0.08;

// stride-9 row count, asserted against the host's layout (scale_base=3,
// color_base=6 for stride 9 in framework/gpu/3d.zig).
const STRIDE = 9;

export type ShellBatch = {
  data: number[];
  count: number;
  center: [number, number, number];
  radius: number;
};

// What a shell box IS, so the compiled bake can skin buildings with real facade
// materials (brick/windows/shopfronts) while leaving ground/road flat. The live
// React batch ignores the kind (it only ships flat color).
export type ShellBoxKind = 'ground' | 'road' | 'building';

// One emitted shell box: its kind, world CENTER (cx,cy,cz), full scale
// (sx,sy,sz), RGB color in 0..1. The ONE box vocabulary every consumer of the
// shell shares — the React streaming batch (stride-9 rows) and the compiled bake
// (pushBox into the gamefile's stride-13 instances, plus a per-building material)
// both feed this same callback, so there is no second copy of the generator to
// drift (rule of two).
export type ShellBoxEmit = (
  kind: ShellBoxKind,
  cx: number, cy: number, cz: number,
  sx: number, sy: number, sz: number,
  r: number, g: number, b: number,
) => void;

// Cold, slightly desaturated palette — the void city reads as the world THINNING
// (playbook §2: early decay is the world thinning, not punishment), not as a
// vivid second city. Taller boxes trend paler/greyer, like distant haze-washed
// towers.
function colorForHeight(h: number, tint: number): [number, number, number] {
  const t = Math.min(1, h / 90);
  // base concrete grey-blue, lifting toward pale grey with height
  const r = 0.32 + t * 0.34 + tint * 0.04;
  const g = 0.34 + t * 0.33 + tint * 0.03;
  const b = 0.40 + t * 0.30;
  return [r, g, b];
}

// Deterministic per-chunk randomness in [min, max).
function rand(cx: number, cz: number, salt: number, min: number, max: number): number {
  return min + voidHash(cx, cz, salt) * (max - min);
}

// Analytic zoning: density/height fall off with distance from the core, so the
// shell reads as a city thinning into sprawl as you drive out, never a uniform
// grid. Pure function of the chunk's distance + its own hash.
function chunkProfile(cx: number, cz: number, distMeters: number): { density: number; maxHeight: number; tint: number } {
  const ring = distMeters / 1000; // km out
  const falloff = Math.max(0.25, 1 - ring / 120);
  const jitter = voidHash(cx, cz, 7);
  return {
    density: 0.35 + 0.5 * falloff * jitter,
    maxHeight: 8 + 120 * falloff * (0.4 + 0.6 * voidHash(cx, cz, 11)),
    tint: jitter,
  };
}

// Generate one chunk's boxes (ground slab + a street cross + buildings) by
// calling `emit` per box. Chunk origin is its min corner in world meters.
// `groundY` is the world height the shell's ground sits at — flush with the
// authored map's ground so the seam at the edge doesn't step (see-it == walk-it).
//
// `edge` makes the chunk AWARE of the authored boundary (USER req_1970): a road
// that exits the map seams straight through here (and buildings step aside);
// `waterRects` are the void-water footprints the chunk keeps clear of towers (the
// water itself renders through the real ~water~ path, not as a shell box).
function generateChunk(
  emit: ShellBoxEmit,
  cx: number, cz: number,
  distMeters: number,
  groundY: number,
  core: WorldCore,
  edge: EdgeProfile = EMPTY_EDGE_PROFILE,
  waterRects: readonly WaterRect[] = [],
): void {
  const ox = cx * SHELL_CHUNK_METERS;
  const oz = cz * SHELL_CHUNK_METERS;
  const half = SHELL_CHUNK_METERS / 2;
  const profile = chunkProfile(cx, cz, distMeters);
  const watered = waterRects.length > 0 && pointInAnyRect(ox + half, oz + half, waterRects, 0);

  // Ground slab — one flat box per chunk, a muted asphalt grey. Kept even under
  // void water: it is the basin BED the translucent water sits over (authored
  // water works the same way), so there's no see-through hole.
  emit(
    'ground',
    ox + half, groundY - GROUND_THICKNESS / 2, oz + half,
    SHELL_CHUNK_METERS, GROUND_THICKNESS, SHELL_CHUNK_METERS,
    0.20, 0.21, 0.24,
  );

  // Declared continuations crossing THIS chunk. Each adds a strip (so buildings
  // step aside); roads draw their carriageway, grass re-skins the ground green.
  const strips: RoadStrip[] = [];
  for (const exit of edge.roadExits) {
    const strip = corridorStripInChunk(exit, ox, oz, SHELL_CHUNK_METERS);
    // Drawn a hair above the street-cross so the continuation reads as the road.
    if (strip) { strips.push(strip); emit('road', strip.cx, groundY + 0.04, strip.cz, strip.sx, GROUND_THICKNESS, strip.sz, 0.13, 0.13, 0.15); }
  }
  let grassy = false;
  for (const g of edge.grassEdges) {
    const strip = corridorStripInChunk({ x: g.x, z: g.z, nx: g.nx, nz: g.nz, width: g.span }, ox, oz, SHELL_CHUNK_METERS);
    // A green field re-skins the ground over the strip (just above the grey bed),
    // and like a road it keeps towers off — a meadow running out of the city.
    if (strip) { strips.push(strip); grassy = true; emit('ground', strip.cx, groundY + 0.02, strip.cz, strip.sx, GROUND_THICKNESS, strip.sz, 0.22, 0.42, 0.18); }
  }

  // A simple street cross sells "blocks" cheaply — but not over open water or a
  // grass field (both want clear ground, not a road grid).
  if (!watered && !grassy) {
    const roadW = 9;
    emit('road', ox + half, groundY + 0.03, oz + half, SHELL_CHUNK_METERS, GROUND_THICKNESS, roadW, 0.13, 0.13, 0.15);
    emit('road', ox + half, groundY + 0.03, oz + half, roadW, GROUND_THICKNESS, SHELL_CHUNK_METERS, 0.13, 0.13, 0.15);
  }

  // A lot is suppressed when it lands on a road corridor (the seam stays open) or
  // inside void water (no tower mid-river).
  const onSeam = (px: number, pz: number): boolean => {
    if (pointInAnyRect(px, pz, waterRects, SEAM_CLEAR_METERS)) return true;
    for (const s of strips) {
      if (s.alongX ? Math.abs(pz - s.lineZ) < s.halfW + SEAM_CLEAR_METERS : Math.abs(px - s.lineX) < s.halfW + SEAM_CLEAR_METERS) return true;
    }
    return false;
  };

  // Buildings: 2×2 blocks, up to MAX_LOTS_PER_BLOCK lots each, hash-gated by the
  // chunk's density so sprawl thins with distance.
  const blockSpan = SHELL_CHUNK_METERS / BLOCKS_PER_AXIS;
  for (let bx = 0; bx < BLOCKS_PER_AXIS; bx += 1) {
    for (let bz = 0; bz < BLOCKS_PER_AXIS; bz += 1) {
      const blockX = ox + bx * blockSpan;
      const blockZ = oz + bz * blockSpan;
      for (let lot = 0; lot < MAX_LOTS_PER_BLOCK; lot += 1) {
        const salt = (bx * 31 + bz * 17 + lot) | 0;
        // Hash gate: skip a fraction of lots so the city has gaps (parks, lots).
        if (voidHash(cx * 13 + bx, cz * 13 + bz, salt) > profile.density) continue;
        // Footprints capped narrower than the block so the facade isn't smeared
        // across a huge wall horizontally (one tile per ~MAX_BUILDING_SPAN face).
        const w = Math.min(MAX_BUILDING_SPAN, rand(cx + bx, cz + bz, salt + 1, 10, blockSpan * 0.42));
        const d = Math.min(MAX_BUILDING_SPAN, rand(cx + bx, cz + bz, salt + 2, 10, blockSpan * 0.42));
        const h = rand(cx + bx, cz + bz, salt + 3, 6, profile.maxHeight);
        const px = blockX + rand(cx + bx, cz + bz, salt + 4, w / 2 + 4, blockSpan - w / 2 - 4);
        const pz = blockZ + rand(cx + bx, cz + bz, salt + 5, d / 2 + 4, blockSpan - d / 2 - 4);
        // A boundary chunk's GROUND fills the gap to the edge, but its BUILDINGS
        // must not poke up inside the authored city — skip any lot landing in the
        // rectangle.
        if (pointInCore(px, pz, core)) continue;
        // …nor on a road seam or in void water.
        if (onSeam(px, pz)) continue;
        const [r, g, b] = colorForHeight(h, profile.tint);
        // Stack the building from FACADE_TILE_METERS-tall slabs instead of one
        // monolith, so the facade texture (windows/brick) REPEATS up the tower
        // instead of stretching a single tile over the whole height. Each slab is
        // a full-footprint box sharing the building's material; the host maps the
        // facade tile per slab, giving real floors.
        const tiles = Math.max(1, Math.round(h / FACADE_TILE_METERS));
        const tileH = h / tiles;
        for (let t = 0; t < tiles; t += 1) {
          emit('building', px, groundY + (t + 0.5) * tileH, pz, w, tileH, d, r, g, b);
        }
      }
    }
  }
}

// Enumerate every shell chunk in a fixed RING around the authored rectangle —
// the whole map footprint expanded by `ringChunks` chunks on every side, MINUS
// the chunks still inside the rectangle (the void never overdraws the authored
// city). This is the COMPILE-side emitter: a finite baked ring (not the infinite
// player-streamed window) the gamefile ships so the void shows in /compiled.
// `groundY` lifts the whole ring to the authored map's ground height (default 0).
export function forEachShellRingBox(
  core: WorldCore,
  ringChunks: number,
  emit: ShellBoxEmit,
  groundY = SHELL_GROUND_TOP_Y,
  edge: EdgeProfile = EMPTY_EDGE_PROFILE,
  waterRects: readonly WaterRect[] = [],
): void {
  const ringMeters = ringChunks * SHELL_CHUNK_METERS;
  const minCX = Math.floor((core.minX - ringMeters) / SHELL_CHUNK_METERS);
  const maxCX = Math.floor((core.maxX + ringMeters) / SHELL_CHUNK_METERS);
  const minCZ = Math.floor((core.minZ - ringMeters) / SHELL_CHUNK_METERS);
  const maxCZ = Math.floor((core.maxZ + ringMeters) / SHELL_CHUNK_METERS);
  for (let cz = minCZ; cz <= maxCZ; cz += 1) {
    for (let cx = minCX; cx <= maxCX; cx += 1) {
      const centerX = cx * SHELL_CHUNK_METERS + SHELL_CHUNK_METERS / 2;
      const centerZ = cz * SHELL_CHUNK_METERS + SHELL_CHUNK_METERS / 2;
      // Skip ONLY chunks centred inside the authored rectangle — the first ring
      // of chunks sits just outside the edge and its ground reaches in to butt
      // against the authored map, so there is no empty gap between them.
      if (pointInCore(centerX, centerZ, core)) continue;
      const dist = distanceOutsideCore(centerX, centerZ, core);
      generateChunk(emit, cx, cz, dist, groundY, core, edge, waterRects);
    }
  }
}

// Build the visible shell as ONE stride-9 batch: every chunk in the square window
// of `radiusChunks` around the focus, EXCEPT chunks still inside the authored
// core (the void is only what's beyond the hand-built city — never drawn on top
// of it). Returns the flat data plus the batch center + bounds radius the host
// uses to cull/transform the single instanced draw.
export function buildShellBatch(
  focusX: number,
  focusZ: number,
  core: WorldCore,
  radiusChunks: number,
  edge: EdgeProfile = EMPTY_EDGE_PROFILE,
  waterRects: readonly WaterRect[] = [],
): ShellBatch {
  const out: number[] = [];
  const fcx = Math.floor(focusX / SHELL_CHUNK_METERS);
  const fcz = Math.floor(focusZ / SHELL_CHUNK_METERS);
  // A chunk is skipped only if its CENTER falls inside the authored rectangle —
  // so the procedural sprawl begins right at the authored edge (the first ring of
  // chunks straddles it, ground reaching in to butt against the map) with no
  // empty gap. The void fills everything outside the rectangle, visible the
  // moment you look past the city's edge.
  // Stride-9 emit (pos3 scale3 color3) — the live host instance layout. The live
  // batch is flat-color, so it ignores the box kind (materials are a bake-only
  // refinement).
  const emit: ShellBoxEmit = (_kind, cx, cy, cz, sx, sy, sz, r, g, b) => {
    out.push(cx, cy, cz, sx, sy, sz, r, g, b);
  };
  for (let dz = -radiusChunks; dz <= radiusChunks; dz += 1) {
    for (let dx = -radiusChunks; dx <= radiusChunks; dx += 1) {
      const cx = fcx + dx;
      const cz = fcz + dz;
      const centerX = cx * SHELL_CHUNK_METERS + SHELL_CHUNK_METERS / 2;
      const centerZ = cz * SHELL_CHUNK_METERS + SHELL_CHUNK_METERS / 2;
      if (pointInCore(centerX, centerZ, core)) continue;
      const dist = distanceOutsideCore(centerX, centerZ, core);
      generateChunk(emit, cx, cz, dist, GROUND_TOP_Y, core, edge, waterRects);
    }
  }
  const count = (out.length / STRIDE) | 0;
  // Center + radius for the whole window: the focus at ground level, reaching to
  // the window's far corner so the host never culls a visible chunk early.
  const reach = (radiusChunks + 1) * SHELL_CHUNK_METERS * Math.SQRT2;
  return {
    data: out,
    count,
    center: [focusX, GROUND_TOP_Y, focusZ],
    radius: reach,
  };
}
