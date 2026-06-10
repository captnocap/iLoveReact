// bakeMassiveGameFile.ts — procedurally bake a HUGE city into a platform game-file.
//
// A scale lab for the compile-to-data path (PLATMOD §4). Instead of the authored
// editor world (bakeGameFile.ts), this emits a procedurally-generated city of
// arbitrary size so we can answer ONE question by eye in `rjit game play`: how
// big a world does the stateless no-V8 loader render before it chokes? The whole
// world rides as ONE packed instance buffer (the INSTANCES map lump) drawn as a
// single instanced unit-cube batch — the "one big mesh" the massive_map_lab
// proved out, now lowered through the real game-file pipe with zero V8 in the
// render loop.
//
// We reuse createHmscMapfile for ALL the boilerplate (the required TILES lump,
// the scene environment, the embedded player model/animation lumps) and then
// swap in our own giant INSTANCES lump — so the file is byte-identical in shape
// to a real editor bake, just with a procedural city for geometry.
//
// Size knob (argv under v8cli):  tools/rjit game play --massive [--blocks N]
//   blocks N  → an N×N grid of city blocks. Default 120 (≈ 58k instances, ≈5MB).
//   The loader read cap is raised to 256MB for this lab, so the ceiling is the
//   GPU/physics, not I/O — crank --blocks until play stutters to find it.
//
// Emits the game-file as the same {gamefile, assets} base64 envelope bakeGameFile
// uses, so `rjit game play/shot --massive` can capture it.

import { createInitialGameState } from '../state/gameState';
import { buildHmscSky } from '../render3d/sky';
import { sceneEnvironmentFromSky } from './sceneEnv';
import { createHmscMapfile } from '../packageMap';
import { INSTANCE_STRIDE, INSTANCE_SHAPE_BOX, encodeInstanceLump } from './worldGeometry';
import {
  MAP_LUMP,
  bytesToBase64,
  findLump,
  readLumpContainer,
  writeLumpContainer,
  type LumpInput,
} from '@reactjit/workspace';
import { writeGameFile } from '@reactjit/workspace/gamefile';

const warn = (msg: string): void => {
  (globalThis as any).console?.warn?.(msg);
};

// ── size knob ───────────────────────────────────────────────────────────────

function readBlocks(): number {
  const argv: string[] = (globalThis as any).process?.argv ?? [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--blocks' && argv[i + 1]) return clampInt(Number(argv[i + 1]), 8, 512);
    const m = /^--blocks=(\d+)$/.exec(argv[i] ?? '');
    if (m) return clampInt(Number(m[1]), 8, 512);
  }
  return 120;
}

function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(v)));
}

// ── deterministic noise (no Math.random — same city every bake) ───────────────

function hash2(a: number, b: number): number {
  let x = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) ^ 0xc2b2ae35, 0x27d4eb2d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  return (x >>> 0) / 0xffffffff;
}

function rand(bx: number, bz: number, salt: number, min: number, max: number): number {
  return min + hash2(bx * 73856093 + salt * 19349663, bz * 83492791 - salt * 50331653) * (max - min);
}

// ── city layout ───────────────────────────────────────────────────────────────

const BLOCK_METERS = 44; // full block pitch (buildable lot + bordering road)
const ROAD_METERS = 10; // road width between blocks
const LOT_METERS = BLOCK_METERS - ROAD_METERS; // 34m buildable lot

type Color = readonly [number, number, number];

function pushBox(out: number[], cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: Color, yawDegrees = 0): void {
  out.push(cx, cy, cz, 0, yawDegrees, 0, sx, sy, sz, color[0], color[1], color[2], INSTANCE_SHAPE_BOX);
}

/** Downtown is tall near the world center and tapers to low-rise at the edges. */
function buildingColor(height: number): Color {
  if (height > 70) return [0.62, 0.66, 0.78];
  if (height > 36) return [0.55, 0.6, 0.7];
  if (height > 16) return [0.6, 0.55, 0.62];
  return [0.7, 0.62, 0.5];
}

type City = { instances: Float32Array; pieceCount: number; buildings: number; ground: number };

function generateCity(blocks: number): City {
  const span = blocks * BLOCK_METERS;
  const origin = -span / 2;
  const half = span / 2;

  // Buildings come FIRST so the loader frames the camera on the skyline and the
  // spawn search (which skips the first `pieceCount` rows) lands on the ground.
  const pieces: number[] = [];
  const ground: number[] = [];

  // One big base slab so there are never gaps to fall through.
  pushBox(ground, 0, -0.05, 0, span, 0.1, span, [0.07, 0.08, 0.1]);

  // Road grid: one strip per gridline, cheap and reads as a city from above.
  const roadColor: Color = [0.12, 0.13, 0.16];
  for (let i = 0; i <= blocks; i += 1) {
    const at = origin + i * BLOCK_METERS;
    pushBox(ground, 0, 0.02, at, span, 0.04, ROAD_METERS, roadColor); // east-west road
    pushBox(ground, at, 0.025, 0, ROAD_METERS, 0.04, span, roadColor); // north-south road
  }

  let buildings = 0;
  for (let bz = 0; bz < blocks; bz += 1) {
    for (let bx = 0; bx < blocks; bx += 1) {
      const lotCenterX = origin + bx * BLOCK_METERS + BLOCK_METERS / 2;
      const lotCenterZ = origin + bz * BLOCK_METERS + BLOCK_METERS / 2;

      // Lot pad — a faintly distinct ground square inside the road grid.
      const padShade = 0.1 + hash2(bx, bz) * 0.06;
      pushBox(ground, lotCenterX, 0.04, lotCenterZ, LOT_METERS, 0.06, LOT_METERS, [padShade, padShade + 0.01, padShade + 0.03]);

      // Downtown factor: 1 at center, ~0 at the rim — drives height + density.
      const distNorm = Math.hypot(lotCenterX, lotCenterZ) / half;
      const downtown = Math.max(0, 1 - distNorm);
      const count = 1 + Math.floor(rand(bx, bz, 1, 0, 2.2 + downtown * 2.5));

      for (let k = 0; k < count; k += 1) {
        const w = rand(bx, bz, 10 + k, 7, LOT_METERS * 0.46);
        const d = rand(bx, bz, 20 + k, 7, LOT_METERS * 0.46);
        const maxH = 6 + downtown * downtown * 150 + rand(bx, bz, 30 + k, 0, 14);
        const h = rand(bx, bz, 40 + k, 5, maxH);
        const ox = rand(bx, bz, 50 + k, -LOT_METERS * 0.28, LOT_METERS * 0.28);
        const oz = rand(bx, bz, 60 + k, -LOT_METERS * 0.28, LOT_METERS * 0.28);
        pushBox(pieces, lotCenterX + ox, h / 2, lotCenterZ + oz, w, h, d, buildingColor(h));
        buildings += 1;
      }
    }
  }

  const all = pieces.concat(ground);
  return {
    instances: new Float32Array(all),
    pieceCount: Math.floor(pieces.length / INSTANCE_STRIDE),
    buildings,
    ground: Math.floor(ground.length / INSTANCE_STRIDE),
  };
}

// ── assemble the game-file ────────────────────────────────────────────────────

/** Rewrite the map container, swapping its (empty) INSTANCES lump for ours. */
function withInstances(container: Uint8Array, instances: Uint8Array): Uint8Array {
  const records = readLumpContainer(container, { knownTypes: new Set(Object.values(MAP_LUMP)) });
  if (!findLump(records, MAP_LUMP.INSTANCES)) {
    throw new Error('massive bake: createHmscMapfile produced no INSTANCES lump to swap');
  }
  // Drop the COLLIDERS lump: it reflects createHmscMapfile's (default) placed
  // pieces, not the massive instances we swap in here. Without it the loader
  // falls back to deriving colliders from the massive instance buffer (with the
  // spatial windowing the --massive scale lab needs). PHYSICS_CONFIG stays — the
  // player tuning/speed is map-independent.
  const lumps: LumpInput[] = records
    .filter((r) => r.type !== MAP_LUMP.COLLIDERS)
    .map((r) => ({
      type: r.type,
      encoding: r.encoding,
      data: r.type === MAP_LUMP.INSTANCES ? instances : r.data,
    }));
  return writeLumpContainer(lumps);
}

const blocks = readBlocks();
const city = generateCity(blocks);
warn(`[massive] generated ${blocks}x${blocks} blocks → ${city.buildings} buildings + ${city.ground} ground/road = ${city.instances.length / INSTANCE_STRIDE} instances`);

const state = createInitialGameState();
const sky = buildHmscSky(state.config.sky.hour, state.config.sky.weather, state.config.sky.gloom);
const env = sceneEnvironmentFromSky(sky);

// createHmscMapfile gives a valid container (required TILES lump, env, embedded
// player model/animation) with an empty instance buffer; we swap ours in.
const boilerplate = createHmscMapfile(state, [], [], env);
const mapContainer = withInstances(boilerplate, encodeInstanceLump(city.instances, city.pieceCount, INSTANCE_STRIDE));

const file = writeGameFile({
  logic: { refs: [], data: new Uint8Array(0) },
  map: { refs: [], data: mapContainer },
  skins: { refs: [], data: new Uint8Array(0) },
  assets: [],
});

const sizeMb = (file.byteLength / (1 << 20)).toFixed(2);
warn(`[massive] game-file ${file.byteLength} bytes (${sizeMb}MB; loader read cap is 256MB)`);
if (file.byteLength >= 256 << 20) {
  warn('[massive] WARNING: game-file exceeds the loader 256MB read cap — lower --blocks or raise the cap in world_loader.zig loadGameFile');
}

const emit = (globalThis as any).print ?? console.log;
emit(JSON.stringify({ gamefile: bytesToBase64(file), assets: [] }));
