// editors/characters/smooth.test.ts — P4 behavior suite for MESHSMOOTH-0606:
// the smooth verb conserves the silhouette while killing roughness, and the
// matrix data door round-trips byte-exact.
//
//   tools/esbuild cart/hmsc-int/editors/characters/smooth.test.ts --bundle \
//     --outfile=zig-out/game/tests/smooth.test.js --format=iife \
//     --platform=neutral --target=es2022 --alias:@reactjit=runtime
//   tools/v8cli zig-out/game/tests/smooth.test.js
//
// (`rjit game verify` runs it via the cart/hmsc-int/editors suite root.)

import { test, assert, assertEqual, assertThrows, finish } from '../../game/_testkit';
import { HED_GRID_H, HED_GRID_W } from '../../game/figure/hed';
import { gridRoughness, relaxGrid, relaxStamp, SMOOTH_TUNING } from './smoothKit';
import {
  fileToGrid, gridToFile, listGridSamples, parseGridFile, readGridSample,
  saveGridSample, serializeGridFile,
} from './gridData';

declare const __fs_mkdir: (path: string) => boolean;
declare const __fs_remove: (path: string) => boolean;

const W = HED_GRID_W;
const H = HED_GRID_H;
const CELLS = W * H;

/** deterministic pseudo-random "hand-shaped" grid — spiky, like a real pull */
function shapedGrid(): number[] {
  const g = new Array<number>(CELLS).fill(0);
  let seed = 1234567;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < CELLS; i++) {
    // a broad lump + harsh per-cell noise + a few hard spikes
    const x = i % W, y = (i / W) | 0;
    const lump = Math.max(0, 1 - Math.hypot((x - 24) / 14, (y - 12) / 8));
    g[i] = Math.max(-1, Math.min(1, lump * 0.7 + (rand() - 0.5) * 0.5));
  }
  g[12 * W + 5] = 1; // isolated spikes — the screenshot's shoulder ridge
  g[6 * W + 40] = -1;
  return g;
}

// ── the smooth verb ───────────────────────────────────────────────────────────

test('relaxGrid conserves silhouette bounds (never grows past the input range)', () => {
  const g = shapedGrid();
  const inMin = Math.min(...g), inMax = Math.max(...g);
  const out = relaxGrid(g, 1, 6);
  assert(Math.min(...out) >= inMin - 1e-12, 'min never drops below input min');
  assert(Math.max(...out) <= inMax + 1e-12, 'max never rises above input max');
  assertEqual(out.length, CELLS, 'same grid shape');
});

test('relaxGrid kills the measured roughness (the screenshot quantity)', () => {
  const g = shapedGrid();
  const before = gridRoughness(g);
  const after = gridRoughness(relaxGrid(g, SMOOTH_TUNING.action.strength, SMOOTH_TUNING.action.iterations));
  assert(after.mean < before.mean * 0.5, `mean roughness halves at the defaults (${before.mean.toFixed(4)} → ${after.mean.toFixed(4)})`);
  assert(after.max < before.max, 'the worst spike shrinks');
});

test('relaxGrid leaves a flat grid and a constant grid alone', () => {
  const flat = new Array<number>(CELLS).fill(0);
  assert(relaxGrid(flat, 1, 4).every((v) => v === 0), 'flat stays flat');
  const constant = new Array<number>(CELLS).fill(0.4);
  assert(relaxGrid(constant, 1, 4).every((v) => Math.abs(v - 0.4) < 1e-12), 'constant stays constant');
});

test('the kernel wraps longitude: a seam spike smooths like an interior one', () => {
  const seam = new Array<number>(CELLS).fill(0);
  const interior = new Array<number>(CELLS).fill(0);
  seam[12 * W + 0] = 1;        // on the x seam
  interior[12 * W + 20] = 1;   // mid-grid
  const seamOut = relaxGrid(seam, 0.8, 2);
  const intOut = relaxGrid(interior, 0.8, 2);
  // the spike's surviving height must be identical in both placements
  assert(Math.abs(seamOut[12 * W + 0] - intOut[12 * W + 20]) < 1e-12, 'seam spike relaxes exactly like an interior spike');
  // and its wrapped neighbor (x = W-1) receives exactly what x = 19 receives
  assert(Math.abs(seamOut[12 * W + (W - 1)] - intOut[12 * W + 19]) < 1e-12, 'energy crosses the seam');
});

test('relaxStamp smooths inside the ellipse and leaves the outside untouched', () => {
  const g = shapedGrid();
  const out = relaxStamp(g, 0.25, 0.5, 0.12, 0.2, 1, 3);
  let changedInside = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = ((x + 0.5) / W - 0.25) / 0.12;
      const v = ((y + 0.5) / H - 0.5) / 0.2;
      const i = y * W + x;
      if (u * u + v * v >= 1) {
        assertEqual(out[i], g[i], `outside cell ${x},${y} untouched`);
      } else if (out[i] !== g[i]) changedInside += 1;
    }
  }
  assert(changedInside > 10, 'the ellipse interior actually relaxed');
  const inMin = Math.min(...g), inMax = Math.max(...g);
  assert(Math.min(...out) >= inMin - 1e-12 && Math.max(...out) <= inMax + 1e-12, 'stamp conserves bounds too');
});

test('relaxStamp mirror smooths the meridian twin (the regions.ts contract)', () => {
  const g = new Array<number>(CELLS).fill(0);
  g[12 * W + 10] = 1;            // under the stamp at u≈0.22
  g[12 * W + (W - 1 - 10)] = 1;  // under its mirror twin
  const out = relaxStamp(g, (10 + 0.5) / W, 0.5, 0.1, 0.16, 1, 2, true);
  assert(out[12 * W + 10] < 1, 'primary site relaxed');
  assert(out[12 * W + (W - 1 - 10)] < 1, 'mirror site relaxed');
});

// ── the matrix data door ──────────────────────────────────────────────────────

test('export → serialize → parse → import is EXACT (every cell ===)', () => {
  const g = shapedGrid();
  const file = gridToFile('torso', g, 'silhouette study');
  const text = serializeGridFile(file);
  const back = fileToGrid(parseGridFile(text));
  assertEqual(back.length, g.length, 'cell count');
  for (let i = 0; i < g.length; i++) {
    if (back[i] !== g[i]) throw new Error(`cell ${i} drifted: ${g[i]} → ${back[i]}`);
  }
  // the format is hand-editable: one row per line
  assertEqual(text.split('\n').filter((l) => l.trim().startsWith('[')).length, H, 'one line per row');
});

test('the boundary rejects malformed grids loudly', () => {
  const g = new Array<number>(CELLS).fill(0);
  assertThrows(() => gridToFile('torso', g.slice(1), 'short'), 'wrong cell count rejected');
  assertThrows(() => parseGridFile('{ not json'), 'broken hand edit rejected');
  const file = gridToFile('torso', g, 'ok');
  assertThrows(() => fileToGrid({ ...file, cols: 12 }), 'wrong dims rejected');
  assertThrows(() => fileToGrid({ ...file, values: file.values.slice(1) }), 'missing row rejected');
  assertThrows(() => fileToGrid({ ...file, kind: 'paint-doc' as any }), 'wrong kind rejected');
  // hand-typed overshoot clamps instead of exploding the mesh
  const hot = gridToFile('torso', g, 'hot');
  hot.values[0][0] = 7;
  assertEqual(fileToGrid(hot)[0], 1, 'overshoot clamps to +1');
});

test('named samples: save is additive, list sees it, apply equals the grid', () => {
  const dir = `/tmp/reactjit-sculpt-grids-test-${Date.now()}`;
  __fs_mkdir(dir);
  const g = shapedGrid();
  const saved = saveGridSample(gridToFile('torso', g, 'My Torso Take 1'), dir);
  assertEqual(saved.name, 'my-torso-take-1', 'label slugs to the file name');
  const again = saveGridSample(gridToFile('torso', g, 'My Torso Take 1'), dir);
  assertEqual(again.name, 'my-torso-take-1-2', 'a name collision appends, never overwrites (V20)');
  const listed = listGridSamples(dir);
  assertEqual(listed.length, 2, 'both samples on the shelf');
  assertEqual(listed[0].part, 'torso', 'entries carry the part');
  const applied = fileToGrid(readGridSample(saved.name, dir));
  for (let i = 0; i < g.length; i++) {
    if (applied[i] !== g[i]) throw new Error(`sample apply drifted at cell ${i}`);
  }
  assert(__fs_remove(dir), 'cleanup');
});

finish('smooth');
