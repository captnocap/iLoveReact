// editors/workbench/clothing/clothing.test.ts — P4 behavior suite for the
// GARMENT WorkbenchSource (CLOTHSOURCE-0606, dispatch req_0187).
//
// THE PASS, asserted as dispatched: the roster shows clothing ITEMS (not
// characters), each renders as the GARMENT ALONE (no body), and one item
// holds VARIANTS — the same shirt across prints and saved materials. Every
// variant save is ONE commit the REAL clothingVariantsStream materializer
// accepts (the fake session folds through stream.apply — store → stream →
// read, the whole loop proven headless).
//
//   tools/esbuild cart/hmsc-int/editors/workbench/clothing/clothing.test.ts \
//     --bundle --outfile=zig-out/game/tests/wb_clothing.test.js --format=iife \
//     --platform=neutral --target=es2022 --alias:@reactjit=runtime \
//     --alias:@game=cart/hmsc-int/game
//   tools/v8cli zig-out/game/tests/wb_clothing.test.js
//
// Headless per the characters.test.ts bundling law: store.ts/panel.ts + the
// game/figure vocabulary only (never source.tsx/Stage.tsx — the React half).

import { assert, assertEqual, assertThrows, finish, test } from '../../../game/_testkit';
import { buildClothing, buildClothingSlices } from '../../../game/figure/clothing';
import { clothingVariantsStream, type ClothingVariantsEvent, type ClothingVariantsState } from '../../../game/figure/clothingVariants';
import { BOTTOMS, CLOTHING, CLOTHING_ACCESSORIES, CLOTHING_SKINS, clothingSkinTextureKey } from '../../../game/figure/shapes';
import { createClothingStore, garmentLabelById, PLAIN_VARIANT, type ClothingStore } from './store';
import { clothingPanel, clothingRoster, garmentRender, DESIGN_KEY_PREFIX, MATERIAL_KEY_PREFIX } from './panel';
// the SPINE crosses into THE shared bench — drive its real headless store
import { createPaintBenchStore, type PainterApi } from '../paint/store';
import { GARMENT_DESIGN_DIMS } from '../paint/targets';
import { emptyDraftBook, type CutoutDraftBook } from '../../cutout/draft';
import { PAINT_DOC_KIND, PAINT_DOC_VERSION, type PaintDocument } from '../../paint/layers';

function fixture(): { store: ClothingStore; labels: string[]; state: () => ClothingVariantsState; apply: (e: ClothingVariantsEvent, label: string) => void } {
  let state = clothingVariantsStream.initial();
  const labels: string[] = [];
  // the REAL materializer is the gate — an event it drops would be a bug
  const apply = (event: ClothingVariantsEvent, label: string) => {
    state = clothingVariantsStream.apply(state, event);
    labels.push(label);
  };
  const store = createClothingStore({
    variants: () => state,
    session: { commit: apply },
    error: null,
    validMaterial: (id) => id === 'mat.asphalt' || id === 'brickRed',
    materials: () => [
      { id: 'mat.asphalt', label: 'Asphalt' },
      { id: 'brickRed', label: 'Brick Red' },
    ],
    twig: false, // headless suite — no twig io (the characters-store gate)
  });
  return { store, labels, state: () => state, apply };
}

// ── the bench-side fakes (the bench.test.ts idioms) ──────────────────────────

function bag(): { read(): CutoutDraftBook; write(b: CutoutDraftBook): void } {
  let book = emptyDraftBook();
  return { read: () => book, write: (b) => { book = b; } };
}

// a tiny real PaintDocument: one solid layer, left half painted (RLE rows)
function paintedDoc(): PaintDocument {
  const w = 8, h = 4;
  return {
    kind: PAINT_DOC_KIND, version: PAINT_DOC_VERSION,
    dims: { w, h },
    layers: [{
      id: 'A', name: 'A', groupName: null,
      config: { mode: 'solid', blend: 'normal', hueOffset: 0, phaseOffset: 0, muted: false, colors: ['#ff0000'], dim: 1 },
      base: { w, h, rows: Array.from({ length: h }, () => [[w / 2, 1], [w / 2, 0]]) },
      brush: null, clicks: [],
    }] as unknown as PaintDocument['layers'],
    activeLayer: 0, tool: 'brush', mode: 'erase', brushPx: 8,
    defaults: { mode: 'solid', colors: ['#ffffff'], hueOffset: 0, phaseOffset: 0, dim: 1 },
    customSurfaces: [],
  } as unknown as PaintDocument;
}

function fakePainter(): PainterApi {
  return {
    buildDocument: () => paintedDoc(),
    composeExportMask: () => null,
    lookColors: () => ['#ff0000'],
    addImageLayer: () => 0,
    undo: () => {},
    redo: () => {},
  };
}

/** a bench wired to the SAME fixture stream the clothing store reads */
function benchFor(fx: ReturnType<typeof fixture>) {
  return createPaintBenchStore({
    library: null, session: null, error: null,
    figures: null, vehicles: null, figureSession: null, vehicleSession: null,
    materialize: null, textureById: () => null, catalogs: () => ({ materials: [], recipes: [] }),
    charAdopt: null, identify: null, grayLoad: null,
    book: bag(), draftMs: 0,
    garmentLabel: (id) => garmentLabelById(id),
    garmentDesigns: { state: () => fx.state() },
    garmentSession: () => ({ commit: (e: any, label: string) => fx.apply(e, label) }),
  });
}

// ── the roster: clothing ITEMS, generated from the tables ────────────────────

test('the roster is GENERATED from the garment tables: tops + bottoms + accessories, never characters', () => {
  const { store } = fixture();
  const rows = clothingRoster(store);
  const topCount = Object.keys(CLOTHING).length - 1; // underwear excluded (painted-on by ruling)
  const expected = topCount + Object.keys(BOTTOMS).length + Object.keys(CLOTHING_ACCESSORIES).length;
  assertEqual(rows.length, expected, 'one row per table garment');
  assert(rows.some((r) => r.id === 'top:tee' && r.label === 'tee · top'), 'tops carry their kind');
  assert(rows.some((r) => r.id === 'bottom:jeans' && r.label === 'jeans · bottom'), 'bottoms listed');
  assert(rows.some((r) => r.id === 'acc:cap' && r.label === 'cap · acc'), 'accessories listed');
  assert(!rows.some((r) => r.id === 'top:underwear'), 'underwear excluded — zero mesh instances (painted-on)');
});

// ── the garment-alone fold (the dispatch core: no body on the stage) ─────────

test('every roster item renders BODILESS and non-empty; slices partition buildClothing exactly', () => {
  const { store } = fixture();
  for (const row of clothingRoster(store)) {
    const r = garmentRender(store, row.id);
    assert(r.instances.length > 0, `${row.id} renders at least one garment piece`);
    for (const inst of r.instances) {
      assert(['box', 'sphere', 'cone', 'cylinder'].includes(inst.geometry), `${row.id} pieces are garment primitives, never body parts`);
    }
  }
  // the slices ARE buildClothing's own output — the partition is exact
  const slices = buildClothingSlices('tee', 'neutral', 'stand', 0, [], 'designer', ['cap'], 'jeans');
  const whole = buildClothing('tee', 'neutral', 'stand', 0, [], 'designer', ['cap'], 'jeans');
  const sum = slices.top.length + slices.bottoms.length + slices.shoes.length + slices.accessories.length;
  assertEqual(sum, whole.length, 'top+bottoms+shoes+accessories = the whole outfit');
  assertEqual(JSON.stringify(slices.top[0]), JSON.stringify(whole[0]), 'the top slice starts with the torso (the material anchor)');
});

// ── seed variants: the built-in prints, placement law respected ──────────────

test('a printable top seeds every CLOTHING_SKINS print; armor/dress hold only plain (clothing.ts:82)', () => {
  const { store } = fixture();
  const tee = store.variantsOf('top:tee');
  assertEqual(tee.filter((v) => v.seed).length, Object.keys(CLOTHING_SKINS).length, 'one seed per print');
  assertEqual(store.variantsOf('top:armor').length, 1, 'armor: plain only — no print surface');
  assertEqual(store.variantsOf('bottom:jeans').length, 1, 'bottoms: one base look');
  assert(!store.printable('top:dress'), 'dress takes no print');
  assert(store.printable('top:suit'), 'suit takes prints');
});

test('the print sits PROUD of every printable garment front (the swallowed-hoodie-print bug, pinned)', () => {
  const { store } = fixture();
  for (const id of ['top:tee', 'top:hoodie', 'top:suit']) {
    store.selectVariant(id, 'skin:designer');
    const r = garmentRender(store, id);
    const torso = r.instances[0];
    const print = r.instances.find((i) => i.textureKey)!;
    assert(!!print, `${id}: the print box exists`);
    const torsoFront = torso.position[2] - (torso.scale as [number, number, number])[2] / 2;
    const printFront = print.position[2] - (print.scale as [number, number, number])[2] / 2;
    assert(printFront < torsoFront, `${id}: the print's front face (${printFront.toFixed(4)}) clears the torso's (${torsoFront.toFixed(4)}) — never swallowed`);
  }
});

test('selecting a seed print folds its texture key into the render (headlab.clothing.*)', () => {
  const { store } = fixture();
  store.selectVariant('top:tee', 'skin:designer');
  const r = garmentRender(store, 'top:tee');
  const print = r.instances.find((i) => i.textureKey);
  assert(!!print, 'the print box appears');
  assertEqual(print!.textureKey, clothingSkinTextureKey('designer'), 'the SAME key every dressed stage samples');
  assert(r.needsSkinCaptures, 'the stage mounts the shared print captures');
  assertEqual(r.mounts.length, 0, 'no material capture for a seed');
});

// ── saved material variants: CRUD through the REAL stream apply ──────────────

test('saving a material variant is ONE commit the real materializer accepts; render maps the torso', () => {
  const { store, labels, state } = fixture();
  store.saveMaterialVariant('top:tee', 'mat.asphalt');
  assertEqual(labels.length, 1, 'one action, one commit');
  assertEqual(state().variants['top:tee'][0].textureId, 'mat.asphalt', 'the commit landed in the stream');
  assertEqual(store.selectedVariant('top:tee'), 'mat:mat.asphalt', 'the new variant is selected (show what was made)');
  const r = garmentRender(store, 'top:tee');
  assertEqual(r.instances[0].textureKey, `${MATERIAL_KEY_PREFIX}mat.asphalt`, 'the torso samples the material capture');
  assertEqual(r.instances[0].color, '#ffffff', 'textured faces paint white so the material reads true');
  assertEqual(r.mounts.length, 1, 'the stage mounts exactly the assigned material');
  assertEqual(r.mounts[0].textureId, 'mat.asphalt', 'mount = the registry id');
  assert(!r.needsSkinCaptures, 'no print capture for a material variant');
});

test('variant gates: unknown materials refuse, non-printable garments refuse, seeds refuse removal', () => {
  const { store } = fixture();
  assertThrows(() => store.saveMaterialVariant('top:tee', 'not-a-material'), 'a non-registry id must throw (the material system gate)');
  assertThrows(() => store.saveMaterialVariant('top:armor', 'mat.asphalt'), 'armor takes no material variant');
  assertThrows(() => store.saveMaterialVariant('bottom:jeans', 'mat.asphalt'), 'bottoms take no material variant (v1)');
  assertThrows(() => store.removeVariant('top:tee', 'skin:designer'), 'built-in prints never remove');
});

test('removing a saved variant lands the removal commit; selection falls back to plain', () => {
  const { store, state } = fixture();
  store.saveMaterialVariant('top:tee', 'brickRed');
  assertEqual(store.selectedVariant('top:tee'), 'mat:brickRed', 'selected after save');
  store.removeVariant('top:tee', 'mat:brickRed');
  assertEqual((state().variants['top:tee'] ?? []).length, 0, 'the stream dropped it');
  assertEqual(store.selectedVariant('top:tee'), PLAIN_VARIANT, 'selection falls back to the plain seed');
  assert(!store.variantsOf('top:tee').some((v) => v.id === 'mat:brickRed'), 'gone from the strip');
});

// ── the panel (CLOTHFLIP-0607 respec): creation + identity; the GRID selects ──

test('the panel is GENERATED: identity vals + creation verbs; the variant DROPDOWN is dead (the grid selects)', () => {
  const { store } = fixture();
  const tee = clothingPanel(store, 'top:tee');
  assertEqual(tee.groups[0].title, 'GARMENT', 'identity first');
  assertEqual(tee.groups[1].title, 'VARIANTS', 'printable tops carry the variant section');
  const ks = tee.groups[1].fields.map((f) => f.k);
  assert(ks.includes('+ new design'), 'THE SPINE verb — add a new design');
  assert(ks.includes('add material'), 'THE material chooser');
  assert(!ks.includes('variant'), 'the text-chip dropdown is DEAD (the ruled grid selects)');
  const materialPick = tee.groups[1].fields.find((f) => f.k === 'add material') as any;
  assertEqual(materialPick.opts()[0].group, 'misc', 'garment material pick consumes the shared material chooser grouping');
  const jeans = clothingPanel(store, 'bottom:jeans');
  assertEqual(jeans.groups.length, 1, 'non-printable garments render NO variant section (conditional-sections law)');
  // saved-selection identity fields appear only when a saved variant is selected
  assert(!ks.includes('remove variant') && !ks.includes('design name'), 'no saved-row verbs while a seed is selected');
  store.saveMaterialVariant('top:tee', 'mat.asphalt');
  const after = clothingPanel(store, 'top:tee').groups[1].fields.map((f) => f.k);
  assert(after.includes('remove variant'), 'remove appears for the saved selection');
  assert(after.includes('design name') && after.includes('meta'), 'name + metadata appear for the saved selection');
});

test('selection is view state through a setter (the grid drives it); per-garment', () => {
  const { store } = fixture();
  assertEqual(store.selectedVariant('top:hoodie'), PLAIN_VARIANT, 'plain by default');
  store.selectVariant('top:hoodie', 'skin:stupid'); // the grid swatch's press
  assertEqual(store.selectedVariant('top:hoodie'), 'skin:stupid', 'the click selects');
  assertEqual(store.selectedVariant('top:tee'), PLAIN_VARIANT, 'selection is per-garment');
});

// ── THE SPINE (CLOTHFLIP-0607): tee → + new design → painter → save → named ──

test('THE SPINE: + new design opens the painter; the bench SAVE lands a design the shirt wears; rename works', () => {
  const fx = fixture();
  const { store, state } = fx;
  // `+ new design` — the panel verb opens the designer (lens flips)
  const opened: Array<{ g: string; d: string | null }> = [];
  (store.deps as any).openDesigner = (g: string, d: string | null) => { opened.push({ g, d }); };
  const plus = clothingPanel(store, 'top:tee').groups[1].fields.find((f) => f.k === '+ new design') as any;
  plus.run();
  assertEqual(JSON.stringify(opened), JSON.stringify([{ g: 'top:tee', d: null }]), 'the painter door opened on a fresh design');
  assertEqual(store.lens(), 'design', '"brings me to the painter" — the lens flipped');
  // the BENCH side: a garment-design target resolves + its save commits
  // through the REAL clothingVariantsStream (the same state this store reads)
  const bench = benchFor(fx);
  assert(bench.open({ kind: 'garment-design', garmentId: 'top:tee', designId: null }), 'the design target resolves');
  assertEqual(bench.work.dims.w, GARMENT_DESIGN_DIMS.w, 'the print canvas dims');
  assertEqual(bench.work.name, 'tee design', 'named for the garment');
  // paint something (the painter api is the bench's lifted door)
  bench.painterApi.current = fakePainter();
  bench.onDirty();
  bench.saveCurrent();
  const designs = state().variants['top:tee'] ?? [];
  assertEqual(designs.length, 1, 'ONE design landed on the stream');
  assert(!!designs[0].overlay, 'the design IS a painted overlay (the model-paint bake, one truth)');
  assertEqual(designs[0].label, 'tee design', 'the bench work name became the design name');
  assert((bench.work as any).garment.designId === designs[0].id, 'the work adopted the minted id — re-saves upsert');
  // the shirt wears it: render maps the chest PRINT BOX (front placement —
  // the per-face fear answered), never the whole torso
  store.selectVariant('top:tee', designs[0].id);
  const r = garmentRender(store, 'top:tee');
  const printBoxes = r.instances.filter((i) => i.textureKey);
  assertEqual(printBoxes.length, 1, 'EXACTLY ONE instance samples the design (the chest print box)');
  assert(printBoxes[0].textureKey!.startsWith(DESIGN_KEY_PREFIX), 'keyed as a design bake');
  assertEqual(r.overlayMounts.length, 1, 'the stage mounts exactly the design overlay');
  assert(r.instances[0].textureKey === undefined, 'the torso body stays UNtextured for a design');
  // "now that shirt exists i can give it a name"
  store.renameVariant('top:tee', designs[0].id, 'flame shirt');
  assertEqual((state().variants['top:tee'] ?? [])[0].label, 'flame shirt', 'the rename upserted');
  assert(!!(state().variants['top:tee'] ?? [])[0].overlay, 'the rename kept the artwork');
});

test('a saved design REOPENS in the painter (the re-edit law) and a re-save upserts', () => {
  const fx = fixture();
  const { state } = fx;
  const bench = benchFor(fx);
  bench.open({ kind: 'garment-design', garmentId: 'top:hoodie', designId: null });
  bench.painterApi.current = fakePainter();
  bench.onDirty();
  bench.saveCurrent();
  const first = (state().variants['top:hoodie'] ?? [])[0];
  assert(!!first, 'the first save landed');
  // reopen by id — the overlay's own paintDoc round-trips
  assert(bench.open({ kind: 'garment-design', garmentId: 'top:hoodie', designId: first.id }), 'the saved design reopens');
  assert(bench.work.initial !== null, 'with its re-editable document');
  bench.onDirty();
  bench.saveCurrent();
  assertEqual((state().variants['top:hoodie'] ?? []).length, 1, 'the re-save UPSERTED (no duplicate)');
  // a ghost design refuses to open (the vanished-model degrade)
  assert(!bench.open({ kind: 'garment-design', garmentId: 'top:hoodie', designId: 'dsn-ghost' }), 'a ghost design is a no-open');
});

finish('workbench/clothing');
