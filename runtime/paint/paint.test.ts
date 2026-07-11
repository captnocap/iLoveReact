// runtime/paint/paint.test.ts — meaning-tests for the universal paint kit's
// pure core (no GPU, no React). The chrome is verified by `rjit shot`; this
// locks the stroke math, the model invariants, and the color round-trips that
// every cart now depends on.
//
//   tools/esbuild runtime/paint/paint.test.ts --bundle \
//     --outfile=/tmp/paint.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit=runtime
//   tools/v8cli /tmp/paint.test.js

import {
  createStrokeEngine, pressureRadius, sizeTrackToPx, sizePxToTrack,
  stepSizeLadder, constrainLine, constrainSquare, dabsAlongSegment, STROKE_TUNING,
} from './stroke';
import {
  normalizeBrush, blendModeIndex, brushFromPreset, BRUSH_PRESETS,
  BRUSH_SHAPE_ID, pushRecent, defaultPalette, inkKey, DEFAULT_BRUSH,
} from './model';
import {
  hexToHsv, hexToOklch, hsvToHex, isFullHexColor, isHexColor,
  hexToRgb01, normalizeHexColor, oklchToHex, rgb01ToHex,
} from './colors';
import { layoutText, hasGlyph, GLYPH_W, GLYPH_H } from './glyphs';

// ── micro harness (self-contained; the repo has no test framework) ───────────
let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }
function close(a: number, b: number, eps: number, m: string) { if (!(Math.abs(a - b) <= eps)) throw new Error(`${m} (got ${a}, want ${b}±${eps})`); }

// ── stroke engine ────────────────────────────────────────────────────────────
test('a fast stroke interpolates gap-free dabs within the dab radius', () => {
  const eng = createStrokeEngine({ sizePx: 40 });
  eng.begin();
  const first = eng.move(0, 0);
  assert(first.length === 1, 'first sample is one dab');
  const dabs = eng.move(400, 0);
  assert(dabs.length > 1, 'a long jump interpolates');
  for (let i = 1; i < dabs.length; i++) {
    const d = Math.hypot(dabs[i].x - dabs[i - 1].x, dabs[i].y - dabs[i - 1].y);
    assert(d < dabs[i].radius, `gap ${d} exceeds radius ${dabs[i].radius}`);
  }
  close(dabs[dabs.length - 1].x, 400, 1e-9, 'stroke ends at the pointer');
  eng.end();
  assert(!eng.drawing(), 'engine inactive after end');
});

test('move() before begin() yields nothing (no stray dabs)', () => {
  const eng = createStrokeEngine({ sizePx: 20 });
  assert(eng.move(5, 5).length === 0, 'no dabs while inactive');
});

test('pressureRadius scales from the size with the cutout curve', () => {
  const { base, gain } = STROKE_TUNING.pressure;
  close(pressureRadius(40, 1), 20 * (base + gain), 1e-9, 'full pressure');
  close(pressureRadius(40, 0.0001), 20 * base, 1e-2, 'min pressure ≈ base');
  assert(pressureRadius(1, 0) >= 1, 'radius floors at 1px');
});

test('mirror axis emits a reflected dab', () => {
  const eng = createStrokeEngine({ sizePx: 20, mirrorAxisX: 100 });
  eng.begin();
  const dabs = eng.move(20, 50);
  assert(dabs.length === 2, 'origin + mirror');
  close(dabs[1].x, 180, 1e-9, 'mirrored across x=100');
});

// ── size mapping ─────────────────────────────────────────────────────────────
test('size track maps logarithmically and inverts cleanly', () => {
  close(sizePxToTrack(sizeTrackToPx(0.5)), 0.5, 0.02, 'round-trip mid');
  assert(sizeTrackToPx(0) <= 2, 'low end is fine-grained');
  assert(sizeTrackToPx(1) >= 384, 'high end reaches the ladder top');
  // log curve: first half of the track spans less px than the second half
  assert(sizeTrackToPx(0.5) - sizeTrackToPx(0) < sizeTrackToPx(1) - sizeTrackToPx(0.5), 'log-eased');
});

test('[ and ] step the detent ladder', () => {
  assert(stepSizeLadder(32, +1) > 32, 'up steps larger');
  assert(stepSizeLadder(32, -1) < 32, 'down steps smaller');
  assert(stepSizeLadder(512, +1) === 512, 'clamps at the top');
  assert(stepSizeLadder(1, -1) === 1, 'clamps at the bottom');
});

// ── shift constraints ────────────────────────────────────────────────────────
test('constrainLine snaps to 45° increments when axis-locked', () => {
  const p = constrainLine(0, 0, 100, 8, true); // ~4.5° → snaps to 0°
  close(p.y, 0, 1e-6, 'near-horizontal snaps flat');
  const q = constrainLine(0, 0, 100, 90, true); // ~42° → snaps to 45°
  close(q.x, q.y, 1e-6, '45° has equal run/rise');
  const free = constrainLine(0, 0, 100, 8, false);
  close(free.y, 8, 1e-9, 'free angle is unchanged');
});

test('constrainSquare makes the drag rect square toward the pointer quadrant', () => {
  const p = constrainSquare(0, 0, 30, -80);
  close(Math.abs(p.x), Math.abs(p.y), 1e-9, 'equal extents');
  assert(p.x > 0 && p.y < 0, 'grows into the pointer quadrant');
});

test('dabsAlongSegment covers the segment endpoints and stays gap-free', () => {
  const dabs = dabsAlongSegment(0, 0, 200, 0, 30);
  close(dabs[0].x, 0, 1e-9, 'starts at a');
  close(dabs[dabs.length - 1].x, 200, 1e-9, 'ends at b');
  for (let i = 1; i < dabs.length; i++) assert(dabs[i].x - dabs[i - 1].x < dabs[i].radius, 'no gaps');
});

// ── model invariants ─────────────────────────────────────────────────────────
test('normalizeBrush clamps every dial into range', () => {
  const b = normalizeBrush({ size: 99999, hardness: 5, flow: 0, scatter: -1, aspect: 100, angleDeg: 999 });
  assert(b.size <= 4096 && b.hardness <= 1 && b.flow >= 0.02 && b.scatter >= 0 && b.aspect <= 8, 'clamped');
  assert(b.angleDeg <= 180 && b.angleDeg >= -180, 'angle wrapped to range');
});

test('blend mode indices are stable and contiguous from 0', () => {
  assert(blendModeIndex('normal') === 0, 'normal is 0');
  assert(blendModeIndex('erase') === 8, 'erase is 8');
  assert(blendModeIndex('multiply') === 1 && blendModeIndex('screen') === 2, 'order held');
});

test('every preset normalizes to a valid analytic brush with a known shape id', () => {
  for (const p of BRUSH_PRESETS) {
    const b = brushFromPreset(p);
    assert(b.stamp.kind === 'analytic', `${p.id} is analytic`);
    assert(BRUSH_SHAPE_ID[(b.stamp as any).shape] !== undefined, `${p.id} maps to a host kind`);
  }
});

test('palette recents dedupe by ink and cap', () => {
  let pal = defaultPalette();
  pal = pushRecent(pal, { kind: 'color', hex: '#ff0000' });
  pal = pushRecent(pal, { kind: 'color', hex: '#00ff00' });
  pal = pushRecent(pal, { kind: 'color', hex: '#ff0000' }); // re-add → moves to front, no dup
  assert(pal.recents.length === 2, 'deduped');
  assert(inkKey(pal.recents[0].ink) === 'color:#ff0000', 'most-recent first');
  for (let i = 0; i < 30; i++) pal = pushRecent(pal, { kind: 'color', hex: `#0000${(i % 100).toString().padStart(2, '0')}` });
  assert(pal.recents.length <= 12, 'capped');
});

test('texture and shader inks are first-class palette entries', () => {
  assert(inkKey({ kind: 'texture', key: 'wood' }) === 'texture:wood', 'texture ink keyed');
  assert(inkKey({ kind: 'shader', surface: 'plasma' }) === 'shader:plasma', 'shader ink keyed');
  const b = normalizeBrush({ ...DEFAULT_BRUSH, ink: { kind: 'texture', key: 'wood' } });
  assert(b.ink.kind === 'texture', 'brush carries a texture ink');
});

// ── color round-trips ────────────────────────────────────────────────────────
test('hex → HSV → hex round-trips for saturated colors', () => {
  for (const hex of ['#ff4d4d', '#34d399', '#3da9ff', '#7c5cff', '#111827', '#ffffff']) {
    const back = hsvToHex(hexToHsv(hex));
    assert(back === normalizeHexColor(hex), `${hex} round-trips (got ${back})`);
  }
});

test('rgb01 helpers round-trip and normalize shorthand hex', () => {
  const [r, g, b] = hexToRgb01('#3da9ff');
  assert(rgb01ToHex(r, g, b) === '#3da9ff', 'rgb01 round-trip');
  assert(normalizeHexColor('#abc') === '#aabbcc', 'shorthand expands');
  assert(normalizeHexColor('garbage') === '#ffffff', 'garbage → fallback');
});

test('hex entry accepts shorthand or full RGB and rejects incomplete drafts', () => {
  assert(isHexColor('#abc') && isHexColor('3da9ff'), 'shorthand and bare full hex are valid');
  assert(isFullHexColor('#3da9ff') && !isFullHexColor('#abc'), 'only six digits are full hex');
  assert(!isHexColor('#3da9f') && !isHexColor('#12xz56'), 'incomplete and non-hex drafts are invalid');
});

test('hex → OKLCH → hex preserves typed sRGB colors', () => {
  for (const hex of ['#e0463f', '#34d399', '#3da9ff', '#111827', '#ffffff', '#000000']) {
    assert(oklchToHex(hexToOklch(hex)) === hex, `${hex} survives the Color Studio conversion`);
  }
});

// ── text tool bitmap font (req_1600) ─────────────────────────────────────────
test('a glyph lays out into a 5×7 cell block', () => {
  const a = layoutText('A');
  assert(a.cells.length > 0, 'A has lit cells');
  assert(a.width === GLYPH_W && a.height === GLYPH_H, `A is ${GLYPH_W}×${GLYPH_H}`);
  assert(a.cells.every((c) => c.x < GLYPH_W && c.y < GLYPH_H), 'cells stay inside the grid');
});

test('glyphs advance with a 1px gap and lowercase folds to uppercase', () => {
  const hi = layoutText('HI');
  assert(hi.width === GLYPH_W * 2 + 1, 'two glyphs = 5 + gap + 5 = 11 wide');
  assert(layoutText('hi').cells.length === hi.cells.length, 'lowercase renders as uppercase');
});

test('whitespace and unknown chars advance but light no cells', () => {
  assert(layoutText('   ').cells.length === 0, 'spaces are blank');
  assert(layoutText('').cells.length === 0 && layoutText('').width === 0, 'empty is empty');
});

test('newlines stack lines a glyph-height apart', () => {
  assert(layoutText('A\nB').height === GLYPH_H * 2 + 1, 'two lines = 15 tall');
});

test('hasGlyph covers the painted ASCII set and rejects the rest', () => {
  assert(hasGlyph('Z') && hasGlyph('9') && hasGlyph('_') && hasGlyph('?'), 'ASCII covered');
  assert(!hasGlyph('☃'), 'non-ASCII rejected');
});

log(`\npaint kit: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
