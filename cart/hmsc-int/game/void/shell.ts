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
import { distanceOutsideCore, type WorldCore } from './distance';

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

// One emitted shell box: world CENTER (cx,cy,cz), full scale (sx,sy,sz), RGB
// color in 0..1. The ONE box vocabulary every consumer of the shell shares — the
// React streaming batch (stride-9 rows) and the compiled bake (pushBox into the
// gamefile's stride-13 instances) both feed this same callback, so there is no
// second copy of the generator to drift (rule of two).
export type ShellBoxEmit = (
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
function generateChunk(emit: ShellBoxEmit, cx: number, cz: number, distMeters: number, groundY: number): void {
  const ox = cx * SHELL_CHUNK_METERS;
  const oz = cz * SHELL_CHUNK_METERS;
  const half = SHELL_CHUNK_METERS / 2;
  const profile = chunkProfile(cx, cz, distMeters);

  // Ground slab — one flat box per chunk, a muted asphalt grey.
  emit(
    ox + half, groundY - GROUND_THICKNESS / 2, oz + half,
    SHELL_CHUNK_METERS, GROUND_THICKNESS, SHELL_CHUNK_METERS,
    0.20, 0.21, 0.24,
  );

  // A simple street cross through the chunk (sells "blocks" cheaply).
  const roadW = 9;
  emit(ox + half, groundY + 0.03, oz + half, SHELL_CHUNK_METERS, GROUND_THICKNESS, roadW, 0.13, 0.13, 0.15);
  emit(ox + half, groundY + 0.03, oz + half, roadW, GROUND_THICKNESS, SHELL_CHUNK_METERS, 0.13, 0.13, 0.15);

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
        const w = rand(cx + bx, cz + bz, salt + 1, 10, blockSpan * 0.42);
        const d = rand(cx + bx, cz + bz, salt + 2, 10, blockSpan * 0.42);
        const h = rand(cx + bx, cz + bz, salt + 3, 6, profile.maxHeight);
        const px = blockX + rand(cx + bx, cz + bz, salt + 4, w / 2 + 4, blockSpan - w / 2 - 4);
        const pz = blockZ + rand(cx + bx, cz + bz, salt + 5, d / 2 + 4, blockSpan - d / 2 - 4);
        const [r, g, b] = colorForHeight(h, profile.tint);
        emit(px, groundY + h / 2, pz, w, h, d, r, g, b);
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
export function forEachShellRingBox(core: WorldCore, ringChunks: number, emit: ShellBoxEmit, groundY = SHELL_GROUND_TOP_Y): void {
  const ringMeters = ringChunks * SHELL_CHUNK_METERS;
  const minCX = Math.floor((core.minX - ringMeters) / SHELL_CHUNK_METERS);
  const maxCX = Math.floor((core.maxX + ringMeters) / SHELL_CHUNK_METERS);
  const minCZ = Math.floor((core.minZ - ringMeters) / SHELL_CHUNK_METERS);
  const maxCZ = Math.floor((core.maxZ + ringMeters) / SHELL_CHUNK_METERS);
  const edgeGrace = SHELL_CHUNK_METERS;
  for (let cz = minCZ; cz <= maxCZ; cz += 1) {
    for (let cx = minCX; cx <= maxCX; cx += 1) {
      const centerX = cx * SHELL_CHUNK_METERS + SHELL_CHUNK_METERS / 2;
      const centerZ = cz * SHELL_CHUNK_METERS + SHELL_CHUNK_METERS / 2;
      const dist = distanceOutsideCore(centerX, centerZ, core);
      if (dist < edgeGrace) continue;
      generateChunk(emit, cx, cz, dist, groundY);
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
): ShellBatch {
  const out: number[] = [];
  const fcx = Math.floor(focusX / SHELL_CHUNK_METERS);
  const fcz = Math.floor(focusZ / SHELL_CHUNK_METERS);
  // A chunk is "core" (skip it) if its CENTER still falls inside the authored
  // rectangle — measured by distance-to-rect, so the procedural sprawl begins
  // right at the authored edge (one chunk of grace) with no double-city overlap.
  // The void fills everything outside the rectangle, so it is visible on the
  // horizon the moment you look past the city's edge — not gated behind a circle
  // that swallowed the whole reachable area (the earlier invisible-shell bug).
  const edgeGrace = SHELL_CHUNK_METERS;
  // Stride-9 emit (pos3 scale3 color3) — the live host instance layout.
  const emit: ShellBoxEmit = (cx, cy, cz, sx, sy, sz, r, g, b) => {
    out.push(cx, cy, cz, sx, sy, sz, r, g, b);
  };
  for (let dz = -radiusChunks; dz <= radiusChunks; dz += 1) {
    for (let dx = -radiusChunks; dx <= radiusChunks; dx += 1) {
      const cx = fcx + dx;
      const cz = fcz + dz;
      const centerX = cx * SHELL_CHUNK_METERS + SHELL_CHUNK_METERS / 2;
      const centerZ = cz * SHELL_CHUNK_METERS + SHELL_CHUNK_METERS / 2;
      const dist = distanceOutsideCore(centerX, centerZ, core);
      if (dist < edgeGrace) continue;
      generateChunk(emit, cx, cz, dist, GROUND_TOP_Y);
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
