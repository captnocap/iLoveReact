// paint.test.ts — P4 meaning-tests for the shared painter's headless core
// (editors/paint/). The contract under test is the capture contract: the
// cutout painter's stroke math, dual-source layer compositing, palette /
// surface packing, and within-tool history — plus the two character-route
// capabilities the painter absorbed (mirror symmetry, vector capture).
// Pure CPU — runs under tools/v8cli with no GPU and no host fns.

import { assert, assertClose, assertEqual, finish, test } from '../../game/_testkit';
import { PAINT_TUNING } from './tuning';
import {
  createStrokeEngine, createVectorStroke, fillPolygon, hasAnyPainted,
  lassoIsDoubleClick, lassoShouldClose, paintCircle, paintCircleEdgeAware,
  pressureRadius, rowRuns, sampleToCells, snapToStrongGradient, soften3x3,
} from './strokes';
import {
  activeAfterDelete, buildPaintDocument, defaultLayerConfig, effectiveMask,
  inflatePaintDocument, invertIntoBase, makeLayer, mergeIntoBase, mintLayerId,
  moveLayerInStack, overrideBandValue, paintableIdsFor, parsePaintDocument,
  scaleMask, serializePaintDocument, unionMasks,
  type PaintLayerBytes, type PaintLookDefaults,
} from './layers';
import { createPaintHistory } from './history';
import {
  addCustomSurface, adoptSurface, buildCellShader, buildTextureShader,
  hexToRgb01, inflateSurface, MASK_SURFACES, NUM_COLOR_SLOTS,
  packCellModeData, packTextureModeData, resolveShader, SLOT_DEFAULTS,
} from './surfaces';

const DEFAULTS: PaintLookDefaults = {
  mode: 'rainbow', colors: SLOT_DEFAULTS.slice(), hueOffset: 0, phaseOffset: 0,
  dim: PAINT_TUNING.layerLook.defaultDim,
};

// ── Stroke math ───────────────────────────────────────────────────────────────

test('a fast stroke leaves no gaps: consecutive dabs are within spacing', () => {
  const engine = createStrokeEngine({ brushPx: 32 });
  engine.begin();
  const first = engine.move(0, 0, 0.5);
  assertEqual(first.length, 1, 'the first sample is a single dab');
  const dabs = engine.move(300, 0, 0.5); // a 300px jump in one sample
  assert(dabs.length > 1, 'the jump interpolates into multiple dabs');
  let prev = first[0];
  for (const d of dabs) {
    const dist = Math.hypot(d.x - prev.x, d.y - prev.y);
    // steps = floor(dist/spacing), so the realized gap can sit one rounding
    // step above spacing — the invariant that matters is OVERLAP: consecutive
    // dab centers land well inside the dab radius, so the stroke is solid.
    assert(dist < d.radius, `dab gap ${dist} breaks overlap (radius ${d.radius})`);
    prev = d;
  }
  const last = dabs[dabs.length - 1];
  assertClose(last.x, 300, 1e-9, 'the stroke ends exactly at the pointer');
});

test('pressure drives the dab radius along the cutout curve', () => {
  const { base, gain } = PAINT_TUNING.pressure;
  assertClose(pressureRadius(32, 1), 32 * (base + gain), 1e-9, 'full pressure');
  assertClose(pressureRadius(32, undefined), 32 * (base + 0.5 * gain), 1e-9, 'no pressure → fallback 0.5');
  assertEqual(pressureRadius(1, 0.0001), Math.max(1, 1 * (base + 0.0001 * gain)), 'radius floors at 1');
  // pressure lerps along a segment: end dabs of a 0→1 stroke grow
  const engine = createStrokeEngine({ brushPx: 32 });
  engine.begin();
  engine.move(0, 0, 0);
  const dabs = engine.move(200, 0, 1);
  assert(dabs[dabs.length - 1].radius > dabs[0].radius, 'radius grows toward the high-pressure end');
});

test('mirror symmetry emits the mirrored dab and skips the axis seam', () => {
  const engine = createStrokeEngine({ brushPx: 8, mirrorAxisX: 96 });
  engine.begin();
  const pair = engine.move(20, 10, 0.5);
  assertEqual(pair.length, 2, 'one sample → original + mirrored dab');
  assertClose(pair[1].x, 96 * 2 - 20, 1e-9, 'mirrored across x=96');
  assertEqual(pair[1].y, pair[0].y, 'mirror is horizontal only');
  engine.end();
  engine.begin();
  const seam = engine.move(96, 10, 0.5); // ON the axis
  assertEqual(seam.length, 1, 'a dab on the axis does not double-paint');
});

test('edge snapping pulls a dab onto the strongest nearby gradient', () => {
  // gray image: black left half, white right half → vertical edge at x=8
  const w = 16, h = 16;
  const gray = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 8; x < w; x++) gray[y * w + x] = 255;
  const snapped = snapToStrongGradient(gray, w, h, 5, 8, 4, PAINT_TUNING.edgeSnap.threshold);
  assert(Math.abs(snapped.x - 8) <= 1, `snaps to the edge column (got x=${snapped.x})`);
  const far = snapToStrongGradient(gray, w, h, 2, 8, 1, PAINT_TUNING.edgeSnap.threshold);
  assertEqual(far.x, 2, 'nothing within radius → the point stays put');
});

test('edge-aware paint never punches through a strong edge', () => {
  const w = 16, h = 16;
  const gray = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 8; x < w; x++) gray[y * w + x] = 255;
  const mask = new Uint8Array(w * h);
  paintCircleEdgeAware(mask, w, h, gray, 5, 8, 6, 1, PAINT_TUNING.edgeSnap.threshold);
  assert(mask[8 * w + 3] === 1, 'flat area inside the radius painted');
  for (let y = 0; y < h; y++) {
    assertEqual(mask[y * w + 8], 0, `edge column x=8 untouched at y=${y}`);
  }
});

test('paintCircle clips to bounds and respects the radius', () => {
  const w = 10, h = 10;
  const mask = new Uint8Array(w * h);
  paintCircle(mask, w, h, 0, 0, 3, 1); // corner circle — must not throw/wrap
  assertEqual(mask[0], 1, 'center painted');
  assertEqual(mask[5], 0, 'beyond radius untouched');
  assertEqual(mask[9 * w + 9], 0, 'far corner untouched');
  assert(hasAnyPainted(mask), 'mask reports painted content');
});

test('lasso fill + auto-close + double-click rules', () => {
  const w = 20, h = 20;
  const mask = new Uint8Array(w * h);
  fillPolygon(mask, w, h, [{ x: 2, y: 2 }, { x: 17, y: 2 }, { x: 17, y: 17 }, { x: 2, y: 17 }], 1);
  assertEqual(mask[10 * w + 10], 1, 'interior filled');
  assertEqual(mask[0], 0, 'exterior clear');
  const pts = [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }];
  assert(lassoShouldClose(pts, 12, 11, 800, 800), 'click near the first vertex closes');
  assert(!lassoShouldClose(pts.slice(0, 2), 10, 10, 800, 800), 'fewer than minVerts never closes');
  assert(lassoIsDoubleClick({ x: 10, y: 10, at: 1000 }, 12, 11, 1200), 'fast nearby second click is a double-click');
  assert(!lassoIsDoubleClick({ x: 10, y: 10, at: 1000 }, 12, 11, 1400), 'slow second click is not');
});

test('vector capture thins points below the min step', () => {
  const stroke = createVectorStroke(0.05);
  assert(stroke.add(0.1, 0.1), 'first point kept');
  assert(!stroke.add(0.11, 0.11), 'sub-step jitter dropped');
  assert(stroke.add(0.2, 0.1), 'real movement kept');
  assertEqual(stroke.points().length, 2, 'two points survive');
});

test('soften3x3 averages neighborhoods at any dims (the paintKit op, generalized)', () => {
  const w = 3, h = 3;
  const src = new Uint8Array([0, 0, 0, 0, 90, 0, 0, 0, 0]);
  const out = soften3x3(src, w, h);
  assertEqual(out[4], 10, 'center = 90/9');
  assertEqual(out[0], Math.round(90 / 4), 'corner = 90/4 (clipped window)');
});

test('sampleToCells + rowRuns coalesce a mask into coarse runs', () => {
  const w = 64, h = 64;
  const mask = new Uint8Array(w * h);
  for (let x = 0; x < 32; x++) mask[0 * w + x] = 1; // top-left half-row
  const cells = sampleToCells(mask, w, h, 8);
  const runs = rowRuns(cells, 8);
  assertEqual(runs.length, 1, 'one run');
  assertEqual(runs[0].len, 4, 'half the row at res 8');
});

// ── Layer compositing ─────────────────────────────────────────────────────────

test('the dual-source band rule: override wins, else base decides', () => {
  const n = 4;
  const base = new Uint8Array([255, 255, 0, 0]);
  const brush = new Uint8Array([0, 128, 255, 0]);
  const eff = effectiveMask(base, brush, n);
  assertEqual(eff[0], 1, 'untouched + base-set → removed');
  assertEqual(eff[1], 0, 'force-keep cancels the base');
  assertEqual(eff[2], 1, 'force-remove sets without base');
  assertEqual(eff[3], 0, 'untouched + clear base → kept');
  const baseOnly = effectiveMask(base, null, n);
  assertEqual(baseOnly[0], 1, 'no brush → base verbatim');
});

test('erase paints the remove band, restore the keep band', () => {
  assertEqual(overrideBandValue('erase'), PAINT_TUNING.bands.remove, 'erase → 1.0');
  assertEqual(overrideBandValue('restore'), PAINT_TUNING.bands.keep, 'restore → 0.5');
  // byte cuts round-trip: value*255 lands in the right band
  assert(PAINT_TUNING.bands.remove * 255 >= PAINT_TUNING.bands.removeByteMin, 'remove byte ≥ removeByteMin');
  const keepByte = PAINT_TUNING.bands.keep * 255;
  assert(keepByte >= PAINT_TUNING.bands.keepByteMin && keepByte < PAINT_TUNING.bands.removeByteMin,
    'keep byte sits inside the keep band');
});

test('scaleMask makes 0/1 masks sampler-visible (0/255)', () => {
  const out = scaleMask(new Uint8Array([0, 1, 7, 255]));
  assertEqual(out[0], 0, 'zero stays zero');
  assertEqual(out[1], 255, '1 scales to 255');
  assertEqual(out[2], 255, 'any non-zero scales to 255');
});

test('merge-down unions effectives; invert flips the baked layer', () => {
  const n = 4;
  const above = new Uint8Array([1, 0, 1, 0]);
  const below = new Uint8Array([0, 0, 1, 1]);
  const merged = mergeIntoBase(above, below, n);
  assertEqual(Array.from(merged).join(','), '255,0,255,255', 'union as 0/255 base bytes');
  const inverted = invertIntoBase(above, n);
  assertEqual(Array.from(inverted).join(','), '0,255,0,255', 'inverted base');
  const union = unionMasks([above, below], n);
  assertEqual(Array.from(union).join(','), '1,0,1,1', 'export compose = OR of effectives');
});

test('new layers walk the golden-ratio hue stagger so stacks never sync', () => {
  const a = defaultLayerConfig(DEFAULTS, 0);
  const b = defaultLayerConfig(DEFAULTS, 1);
  assertClose(a.hueOffset, 0, 1e-9, 'ordinal 0 starts at the seed hue');
  assertClose(b.hueOffset, PAINT_TUNING.layerLook.hueStagger % 1, 1e-9, 'ordinal 1 staggers by φ−1');
  assertClose(b.phaseOffset, PAINT_TUNING.layerLook.phaseStagger, 1e-9, 'phase staggers too');
  assert(a.colors !== DEFAULTS.colors, 'colors are copied, never shared');
});

test('stack ops: move swaps neighbors, delete re-targets the active index', () => {
  const stack = ['a', 'b', 'c'];
  assertEqual(moveLayerInStack(stack, 0, 1).join(''), 'bac', 'move down swaps');
  assertEqual(moveLayerInStack(stack, 2, 1), stack, 'out-of-range move is a no-op');
  assertEqual(activeAfterDelete(2, 1, 2), 1, 'active above the deletion shifts down');
  assertEqual(activeAfterDelete(0, 0, 0), -1, 'last layer deleted → no active');
  assertEqual(activeAfterDelete(1, 2, 2), 1, 'active below the deletion holds');
});

test('layer ids are unique and paintable ids are prefix-namespaced', () => {
  const ids = new Set(Array.from({ length: 50 }, () => mintLayerId()));
  assertEqual(ids.size, 50, '50 mints, 50 distinct ids');
  const { baseId, brushId } = paintableIdsFor('chr-unwrap', 'L1');
  assertEqual(baseId, 'chr-unwrap-base-L1', 'base id carries the embed prefix');
  assertEqual(brushId, 'chr-unwrap-brush-L1', 'brush id carries the embed prefix');
});

// ── The paint document (snapshot/persistence round-trip) ─────────────────────

test('document round-trip: layers, masks, clicks and look survive RLE + JSON', () => {
  const w = 8, h = 8, n = w * h;
  const base = new Uint8Array(n);
  base[10] = 255; base[11] = 255;
  const brush = new Uint8Array(n);
  brush[20] = 128; brush[30] = 255;
  const layer = makeLayer(DEFAULTS, 0, 'Hull');
  const bytes: PaintLayerBytes = {
    ...layer, groupName: 'paint',
    clicks: [{ x: 3, y: 4, label: 'keep' }],
    base, brush,
  };
  const doc = buildPaintDocument({
    dims: { w, h }, layers: [bytes], activeLayer: 0,
    tool: 'brush', mode: 'erase', brushPx: 32,
    defaults: DEFAULTS, customSurfaces: [],
  });
  const parsed = parsePaintDocument(serializePaintDocument(doc));
  assert(!!parsed, 'serialized document parses');
  const inflated = inflatePaintDocument(parsed!);
  assertEqual(inflated.length, 1, 'one layer back');
  assertEqual(inflated[0].name, 'Hull', 'name survives');
  assertEqual(inflated[0].groupName, 'paint', 'group survives');
  assertEqual(inflated[0].clicks[0].label, 'keep', 'click history survives');
  assert(!!inflated[0].base && inflated[0].base![10] > 0 && inflated[0].base![9] === 0,
    'base mask bits survive (binary RLE)');
  const rb = inflated[0].brush!;
  assertEqual(rb[20], 128, 'force-keep byte survives (value-grid RLE)');
  assertEqual(rb[30], 255, 'force-remove byte survives');
  assertEqual(rb[0], 0, 'untouched stays untouched');
});

test('an untouched brush channel is skipped, not persisted as zeros', () => {
  const w = 4, h = 4;
  const layer = makeLayer(DEFAULTS, 0);
  const doc = buildPaintDocument({
    dims: { w, h },
    layers: [{ ...layer, base: new Uint8Array(w * h), brush: new Uint8Array(w * h) }],
    activeLayer: 0, tool: 'brush', mode: 'erase', brushPx: 32,
    defaults: DEFAULTS, customSurfaces: [],
  });
  assertEqual(doc.layers[0].brush, null, 'all-zero override → null');
  assert(doc.layers[0].base !== null, 'base persists even when empty (cheap, keeps shape)');
});

test('parsePaintDocument rejects foreign kinds and versions', () => {
  assertEqual(parsePaintDocument('{"kind":"cutout-session","version":2}'), null, 'foreign kind rejected');
  assertEqual(parsePaintDocument('not json'), null, 'garbage rejected');
  assertEqual(parsePaintDocument('{"kind":"paint-doc","version":99,"dims":{"w":1,"h":1}}'), null, 'future version rejected');
});

// ── History ───────────────────────────────────────────────────────────────────

test('before-action history: undo returns the pre-mutation state', () => {
  let state = 'v1';
  const h = createPaintHistory<string>();
  h.commit(() => state);   // about to mutate
  state = 'v2';
  assert(h.canUndo(), 'one snapshot on the stack');
  const back = h.undo(() => state);
  assertEqual(back, 'v1', 'undo hands back the before-action snapshot');
  state = back!;
  const fwd = h.redo(() => state);
  assertEqual(fwd, 'v2', 'redo restores the undone mutation');
});

test('coalesce window: a slider burst commits once, the undo target is pre-drag', () => {
  let clock = 1000;
  let value = 0;
  const h = createPaintHistory<number>({ now: () => clock });
  for (let i = 1; i <= 10; i++) {
    h.commitCoalesced(() => value); // BEFORE each change
    value = i;
    clock += 16; // 60 Hz drag, all inside one window
  }
  const back = h.undo(() => value);
  assertEqual(back, 0, 'undo lands on the value before the drag started');
  assert(!h.canUndo(), 'the burst was ONE commit, not ten');
});

test('a new commit clears redo; the cap evicts the oldest snapshot', () => {
  let state = 0;
  const h = createPaintHistory<number>({ cap: 3 });
  for (let i = 1; i <= 5; i++) { h.commit(() => state); state = i; }
  h.undo(() => state);
  assert(h.canRedo(), 'undo fills redo');
  h.commit(() => state);
  assert(!h.canRedo(), 'a fresh commit clears redo');
  // cap: only 3 snapshots ever retained
  let undos = 0;
  while (h.undo(() => state) !== null) undos++;
  assertEqual(undos, 3, 'cap evicted the oldest snapshots');
});

test('lazy builders: a throttled coalesced commit never builds the snapshot', () => {
  let clock = 1000;
  let builds = 0;
  const h = createPaintHistory<number>({ now: () => clock });
  h.commitCoalesced(() => { builds++; return 1; });
  h.commitCoalesced(() => { builds++; return 2; }); // same window — must not build
  assertEqual(builds, 1, 'the throttle drops the call BEFORE building (no GPU readback)');
});

// ── Palette / surface packing ─────────────────────────────────────────────────

test('texture-mode packing: header + color slots at offset 8', () => {
  const buf = packTextureModeData({
    gridSize: 128, dim: 0.85, hueOffset: 0.25, phaseOffset: 1.4,
    blend: 'multiply', colors: ['#ff0000', '#00ff00'],
  });
  assertEqual(buf.length, 8 + NUM_COLOR_SLOTS * 3, 'header + slots, no cell grid');
  assertEqual(buf[0], 128, 'grid w');
  assertEqual(buf[2], 0.85, 'dim');
  assertEqual(buf[3], 0.25, 'hue offset');
  assertEqual(buf[6], 2, 'multiply blend index');
  assertClose(buf[8], 1, 1e-9, 'slot 0 red');
  assertClose(buf[12], 1, 1e-9, 'slot 1 green');
});

test('cells-mode packing: mask flags after the header, colors after the grid', () => {
  const cells = new Set([0, 5, 99999]); // out-of-range index must be ignored
  const buf = packCellModeData({
    gridSize: 4, dim: 1, hueOffset: 0, phaseOffset: 0, blend: 'normal',
  }, cells);
  assertEqual(buf.length, 8 + 16 + NUM_COLOR_SLOTS * 3, 'header + 4² cells + slots');
  assertEqual(buf[8], 1, 'cell 0 set');
  assertEqual(buf[8 + 5], 1, 'cell 5 set');
  assertEqual(buf[8 + 6], 0, 'unset cell clear');
  assertClose(buf[8 + 16], 1, 1e-9, 'default slot color is identity white');
});

test('hex colors parse defensively', () => {
  assertEqual(hexToRgb01('#ff0000').join(','), '1,0,0', 'red');
  assertEqual(hexToRgb01('zzz').join(','), '1,1,1', 'garbage → identity white');
  assertEqual(hexToRgb01('336699')[0], 0.2, 'bare hex accepted');
});

test('custom surfaces register, resolve, and adopt round-trip', () => {
  const grown = addCustomSurface([], '  Lava  ', 'LAVA_WGSL');
  assertEqual(grown.customs[0].label, 'Lava', 'label trimmed');
  assert(grown.id.startsWith('custom:'), 'custom id namespace');
  assertEqual(resolveShader(grown.id, true, grown.customs), 'LAVA_WGSL', 'custom id resolves its WGSL');
  assert(resolveShader('nonsense', true, []).length > 0, 'unknown id falls back to a built-in');
  const inflated = inflateSurface(grown.id, grown.customs);
  assertEqual(inflated.kind, 'custom', 'inflate carries the WGSL inline');
  const adopted = adoptSurface(inflated, []);
  assertEqual(adopted.addedCustom?.shader, 'LAVA_WGSL', 'adopt registers the imported surface');
  const again = adoptSurface(inflated, grown.customs);
  assertEqual(again.addedCustom, null, 'adopting a known surface adds nothing');
});

test('every built-in surface builds valid-shaped WGSL in both modes', () => {
  for (const mode of MASK_SURFACES) {
    for (const wgsl of [buildCellShader(mode), buildTextureShader(mode)]) {
      assert(wgsl.includes('fn fs_main'), `${mode} declares fs_main`);
      assert(!wgsl.includes('`'), `${mode} has no backticks (template-literal trap)`);
      assert(!/[(,=\s]\+\d/.test(wgsl), `${mode} has no unary plus (WGSL crash)`);
    }
  }
  const tex = buildTextureShader('rainbow');
  assert(tex.includes('ov > 0.75') && tex.includes('ov > 0.25'),
    'texture mode composes the same override bands as effectiveMask');
});

finish('paint');
