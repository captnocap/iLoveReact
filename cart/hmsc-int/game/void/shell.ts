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
import { distanceFromCore, type WorldCore } from './distance';

// One procedural chunk is 160 m square — the lab's proven streaming grain.
export const SHELL_CHUNK_METERS = 160;
// Each chunk splits into a 2×2 block grid; each block holds up to this many lots.
const BLOCKS_PER_AXIS = 2;
const MAX_LOTS_PER_BLOCK = 4;
// Ground slab sits flush with the authored ground (~y 0); a thin readable slab.
const GROUND_TOP_Y = 0;
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

// Push one axis-aligned box as a stride-9 instance row: world position (box
// CENTER), full scale (footprint), and an RGB color in 0..1.
function pushBox(
  out: number[],
  cx: number, cy: number, cz: number,
  sx: number, sy: number, sz: number,
  r: number, g: number, b: number,
): void {
  out.push(cx, cy, cz, sx, sy, sz, r, g, b);
}

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

// Generate one chunk's boxes (ground slab + a street cross + buildings) into the
// shared output array. Chunk origin is its min corner in world meters.
function generateChunk(out: number[], cx: number, cz: number, distMeters: number): void {
  const ox = cx * SHELL_CHUNK_METERS;
  const oz = cz * SHELL_CHUNK_METERS;
  const half = SHELL_CHUNK_METERS / 2;
  const profile = chunkProfile(cx, cz, distMeters);

  // Ground slab — one flat box per chunk, a muted asphalt grey.
  pushBox(
    out,
    ox + half, GROUND_TOP_Y - GROUND_THICKNESS / 2, oz + half,
    SHELL_CHUNK_METERS, GROUND_THICKNESS, SHELL_CHUNK_METERS,
    0.20, 0.21, 0.24,
  );

  // A simple street cross through the chunk (sells "blocks" cheaply).
  const roadW = 9;
  pushBox(out, ox + half, GROUND_TOP_Y + 0.03, oz + half, SHELL_CHUNK_METERS, GROUND_THICKNESS, roadW, 0.13, 0.13, 0.15);
  pushBox(out, ox + half, GROUND_TOP_Y + 0.03, oz + half, roadW, GROUND_THICKNESS, SHELL_CHUNK_METERS, 0.13, 0.13, 0.15);

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
        pushBox(out, px, GROUND_TOP_Y + h / 2, pz, w, h, d, r, g, b);
      }
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
  // A chunk is "core" (skip it) if its center is within the safe radius plus a
  // chunk of grace, so the procedural sprawl starts cleanly outside the authored
  // rectangle with no double-city overlap at the seam.
  const skipRadius = core.safeRadius + SHELL_CHUNK_METERS;
  for (let dz = -radiusChunks; dz <= radiusChunks; dz += 1) {
    for (let dx = -radiusChunks; dx <= radiusChunks; dx += 1) {
      const cx = fcx + dx;
      const cz = fcz + dz;
      const centerX = cx * SHELL_CHUNK_METERS + SHELL_CHUNK_METERS / 2;
      const centerZ = cz * SHELL_CHUNK_METERS + SHELL_CHUNK_METERS / 2;
      const dist = distanceFromCore(centerX, centerZ, core);
      if (dist < skipRadius) continue;
      generateChunk(out, cx, cz, dist);
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
