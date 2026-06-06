// source.test.ts — P4 behavior tests for the character-FAMILY WorkbenchSources
// (WBCHAR-0606 + CLOTHSPLIT-0606 phase 2): spec generation round-trip,
// list/select resolution, the route-parity semantics the panels must keep
// (autosave minting, clothes→bottoms coupling, accessory exclusivity, region
// zero-snap), the three-context split (mesh shows MESH ONLY; wardrobe and
// animation relocated, nothing lost — the WBCLOTH.CAPTURE.md pin).
// Headless: a fake channel/session pair stands in for the V20 wires
// (autosaveMs 0 → synchronous commits; twig io off).

import { assert, assertEqual, finish, test } from '../../../game/_testkit';
import { createCharacterStore, type CharacterStoreDeps } from './store';
// the HEADLESS cores (panel.ts) — never the source .tsx files, which carry
// the stages' React half (the characters.test.ts bundling law)
import {
  characterSourceCore as charactersSource, characterPanel,
  clothingSourceCore, clothingPanel,
  animationSourceCore, animationPanel,
} from './panel';
import { draftToDocument } from '../../characters/draft';
import { generateCharacterDraft } from '../../characters/generate';
import { SHAPE_REGIONS } from '../../characters/regions';
import { PAINT_EDITOR_TUNING } from '../../characters/paintKit';
import { ANIM_PRESETS } from '../../characters/animPresets';
import { CLOTHING_ACCESSORIES, DEFAULT_BOTTOMS, PART_PRESETS, defaultProfile } from '../../../game/figure/shapes';
import { generateFace } from '../../../game/figure/hed';
import { colorRangeCells } from '../../../shell/colorRange';
import type { PanelSpec, FieldSpec } from '../../../shell/fields';

type Rec = { commits: Array<{ e: any; label: string }>; notes: string[] };

function fakeDeps(withDocs: boolean): { deps: CharacterStoreDeps; rec: Rec } {
  const rec: Rec = { commits: [], notes: [] };
  const characters: Record<string, any> = withDocs
    ? {
        'chr-a': draftToDocument(generateCharacterDraft(1), 'alpha'),
        'chr-b': draftToDocument(generateCharacterDraft(2), 'beta'),
      }
    : {};
  const order = withDocs ? ['chr-a', 'chr-b'] : [];
  const deps: CharacterStoreDeps = {
    channel: { state: () => ({ characters, order }) },
    session: {
      commit: ((e: any, label: string) => { rec.commits.push({ e, label }); }) as any,
      note: (l: string) => { rec.notes.push(l); },
    },
    error: null,
    autosaveMs: 0,
    twig: false,
    items: () => [{ id: 'itm-x', label: 'shiv', tone: 'warn' }],
  };
  return { deps, rec };
}

function field(spec: PanelSpec, groupTitle: string, k: string): FieldSpec | undefined {
  const g = spec.groups.find((x) => x.title === groupTitle || x.title.startsWith(groupTitle));
  return g?.fields.find((f) => f.k === k);
}

test('list/defaultRow/onPick: roster order, last entry is the working draft', () => {
  const { deps } = fakeDeps(true);
  const store = createCharacterStore(deps);
  const src = charactersSource(store);
  const rows = src.list();
  assertEqual(rows.length, 2, 'two roster entries list');
  assertEqual(rows[0].label, 'alpha', 'titles come from metadata');
  assertEqual(src.defaultRow!(rows), 'chr-b', 'a fresh store restores the LAST entry (mount-restore law; no twig)');
  src.onPick!('chr-a');
  assertEqual(store.draftId, 'chr-a', 'onPick installs the picked entry');
  assertEqual(store.draftName, 'alpha', 'the name follows the document title');
  assertEqual(src.defaultRow!(rows), 'chr-a', 'the working draft wins defaultRow afterwards');
});

test('rename alone never autosaves; the next draft edit carries the new name', () => {
  const { deps, rec } = fakeDeps(true);
  const store = createCharacterStore(deps);
  const spec = characterPanel(store);
  const name = field(spec, 'IDENTITY', 'name') as any;
  name.set('bob');
  assertEqual(store.draftName, 'bob', 'the name field writes the store');
  assertEqual(rec.commits.length, 0, 'a rename is not a draft edit — no commit (route parity)');
  const skin = field(spec, 'IDENTITY', 'skin') as any;
  skin.set('#112233');
  assertEqual(rec.commits.length, 1, 'the skin edit autosaves (sync at autosaveMs 0)');
  assertEqual(rec.commits[0].label, 'autosave · bob', 'the autosave label carries the new name');
  assertEqual(rec.commits[0].e.kind, 'authored', 'the V20 event shape');
});

test('autosave mints a roster id on the first edit of a fresh draft', () => {
  const { deps, rec } = fakeDeps(false);
  const store = createCharacterStore(deps);
  assertEqual(store.draftId, null, 'a fresh store has no id');
  (field(characterPanel(store), 'IDENTITY', 'skin') as any).set('#445566');
  assert(rec.commits.length === 1 && !!rec.commits[0].e.id, 'the commit minted an id');
  assertEqual(store.draftId, rec.commits[0].e.id, 'the minted id becomes the working id');
});

test('clothes enum (CLOTHING context) couples bottoms; the mesh lens never flips', () => {
  const { deps } = fakeDeps(false);
  const store = createCharacterStore(deps);
  store.setLens('sculpt');
  (field(clothingPanel(store), 'OUTFIT', 'clothes') as any).set('hoodie');
  assertEqual(store.draft.clothing, 'hoodie', 'the clothing landed');
  assertEqual(store.draft.bottoms, DEFAULT_BOTTOMS.hoodie, 'bottoms follow DEFAULT_BOTTOMS (route coupling)');
  // CLOTHSPLIT-0606 row F1: the pre-split wearLens flip is structurally
  // fulfilled (the clothing stage IS the dressed figure) — a pick there
  // must not yank the MESH context's lens
  assertEqual(store.view.lens, 'sculpt', 'a wardrobe pick no longer flips the mesh lens (WBCLOTH F1)');
});

test('clothing writes land on BodyDocument.outfit through the same draft doors', () => {
  const { deps, rec } = fakeDeps(false);
  const store = createCharacterStore(deps);
  (field(clothingPanel(store), 'OUTFIT', 'clothes') as any).set('hoodie');
  (field(clothingPanel(store), 'OUTFIT', 'print') as any).set('designer');
  const doc = draftToDocument(store.draft, 'fit check');
  assertEqual(doc.outfit?.top, 'hoodie', 'the outfit channel carries the top');
  assertEqual(doc.outfit?.bottoms, DEFAULT_BOTTOMS.hoodie, 'with the coupled bottoms');
  assertEqual(doc.outfit?.print, 'designer', 'and the print');
  assert(rec.commits.length >= 1 && rec.commits[rec.commits.length - 1].e.kind === 'authored', 'the autosave chain saw every pick (same editDraft door)');
});

test('extras (CLOTHING context) keep the cap⇄beanie exclusivity', () => {
  const { deps } = fakeDeps(false);
  const store = createCharacterStore(deps);
  const capLabel = CLOTHING_ACCESSORIES.cap.label;
  const beanieLabel = CLOTHING_ACCESSORIES.beanie.label;
  (field(clothingPanel(store), 'EXTRAS', capLabel) as any).set(true);
  assert(store.draft.accessories.includes('cap'), 'cap toggles on');
  (field(clothingPanel(store), 'EXTRAS', beanieLabel) as any).set(true);
  assert(store.draft.accessories.includes('beanie'), 'beanie toggles on');
  assert(!store.draft.accessories.includes('cap'), 'cap leaves when beanie arrives (exclusive pair)');
});

test('region sliders write the SELECTED part and zero-snap small values', () => {
  const { deps } = fakeDeps(false);
  const store = createCharacterStore(deps);
  const region = SHAPE_REGIONS[store.view.selPart][0];
  const spec = characterPanel(store);
  const slider = field(spec, 'REGION ·', region.label) as any;
  slider.set(0.005);
  assertEqual(store.draft.regions[store.view.selPart]?.[region.id], 0, 'sub-0.01 snaps to zero (route law)');
  slider.set(0.5);
  assertEqual(store.draft.regions[store.view.selPart]?.[region.id], 0.5, 'a real value lands');
});

test('the part enum reshapes the REGION group', () => {
  const { deps } = fakeDeps(false);
  const store = createCharacterStore(deps);
  (field(characterPanel(store), 'PART', 'part') as any).set('torso');
  assertEqual(store.view.selPart, 'torso', 'part selection moved');
  const title = characterPanel(store).groups.find((g) => g.title.startsWith('REGION'))!.title;
  assert(title.includes(PART_PRESETS.torso.label.toUpperCase()), 'the region group names the new part');
});

test('num fields carry the tunables-shaped spec (skull stretch)', () => {
  const { deps } = fakeDeps(false);
  const store = createCharacterStore(deps);
  const skull = field(characterPanel(store), 'FACE', 'skull stretch') as any;
  const spec = PAINT_EDITOR_TUNING.knobs.skull;
  assertEqual(skull.min, spec.min, 'min carries');
  assertEqual(skull.max, spec.max, 'max carries');
  assertEqual(skull.step, spec.step, 'step carries');
  assertEqual(skull.precision, spec.precision, 'precision carries');
});

test('the held-prop enum (CLOTHING context) lists sculpted /items and resolves labels back to ids', () => {
  const { deps } = fakeDeps(false);
  const store = createCharacterStore(deps);
  const held = field(clothingPanel(store), 'PROP', 'held') as any;
  assert(held.opts.includes('none') && held.opts.includes('◆ shiv'), 'registry + sculpted items list');
  held.set('◆ shiv');
  assertEqual(store.draft.heldItem, 'itm-x', 'the sculpted label resolves to its id');
});

test('actions: save commits a labeled authored event; remove appears with an id', () => {
  // an EMPTY roster: the factory restore (TWIGSTATE-0606) now gives any
  // roster-backed store a working id at birth, so the no-id case is fresh
  const empty = createCharacterStore(fakeDeps(false).deps);
  assert(!charactersSource(empty).actions!(empty).some((a) => a.id === 'remove'), 'no remove before an id exists');
  const { deps, rec } = fakeDeps(true);
  const store = createCharacterStore(deps);
  const src = charactersSource(store);
  src.onPick!('chr-a');
  const actions = src.actions!(store);
  assert(actions.some((a) => a.id === 'remove'), 'remove appears for a loaded entry');
  actions.find((a) => a.id === 'save')!.run();
  const last = rec.commits[rec.commits.length - 1];
  assertEqual(last.label, 'alpha: saved', 'the save label is the route\'s');
  assertEqual(last.e.kind, 'authored', 'the save event shape');
});

test('undo restores the pre-edit draft through the history door', () => {
  const { deps } = fakeDeps(true);
  const store = createCharacterStore(deps);
  charactersSource(store).onPick!('chr-a');
  const before = store.draft.skin;
  (field(characterPanel(store), 'IDENTITY', 'skin') as any).set('#0a0b0c');
  assertEqual(store.draft.skin, '#0a0b0c', 'the edit landed');
  store.undo();
  assertEqual(store.draft.skin, before, 'undo returns the pre-edit skin');
  assertEqual(store.status, 'undo', 'the status narrates');
});

test('savePaintedModel: K3 — apply through the door, one labeled commit, draft adopts', () => {
  const { deps, rec } = fakeDeps(true);
  const store = createCharacterStore(deps);
  charactersSource(store).onPick!('chr-a');
  const overlay = { version: 1 as const, stamp: 4242, cols: 4, rows: 4, layers: [{ color: '#dc2626', cells: [1, 2] }] };
  store.savePaintedModel('torso' as any, overlay as any);
  const last = rec.commits[rec.commits.length - 1];
  assertEqual(last.label, 'chr-a: torso painted', 'the labeled commit (cutout save parity)');
  assertEqual(last.e.kind, 'authored', 'the authored event');
  assertEqual(JSON.stringify(last.e.doc.paint?.torso), JSON.stringify(overlay), 'the overlay rides the committed doc');
  assertEqual(JSON.stringify(store.draft.paint?.torso), JSON.stringify(overlay), 'the working draft adopts the committed paint');
  const commitsBefore = rec.commits.length;
  store.savePaintedModel('torso' as any, null);
  assertEqual(rec.commits[rec.commits.length - 1].label, 'chr-a: torso paint cleared', 'an empty painting CLEARS');
  assertEqual(rec.commits.length, commitsBefore + 1, 'exactly one commit per save (no autosave echo)');
});

test('the lens set is FIGURE/PART/SCULPT/PAINT and the source controls it', () => {
  const { deps } = fakeDeps(false);
  const store = createCharacterStore(deps);
  const src = charactersSource(store);
  assertEqual(src.lenses!(store).map((l) => l.id).join(','), 'figure,part,sculpt,paint', 'the lens set');
  assertEqual(src.activeLens!(store), 'part', 'the default lens');
  src.onLens!(store, 'sculpt');
  assertEqual(store.view.lens, 'sculpt', 'onLens writes the store');
});

test('TWIGSTATE-0606: the view round-trips — a reload returns to the same brush on the same part, still painting', () => {
  const bag = new Map<string, unknown>();
  const adapter = {
    read: <T,>(k: string, init: T): T => (bag.has(k) ? (bag.get(k) as T) : init),
    write: <T,>(k: string, v: T): void => { bag.set(k, v); },
  };
  // the session: the user picks a row, goes to PAINT on the torso, brush 2
  const a = fakeDeps(true);
  (a.deps as any).twig = adapter;
  const s1 = createCharacterStore(a.deps);
  charactersSource(s1).onPick!('chr-a');
  s1.setLens('paint');
  s1.setSelPart('torso');
  s1.setBrush(2);
  s1.setMirror(false);
  s1.setSculptMode('lower');
  // the hot reload: a FRESH store over the same twig bag (module state gone)
  const b = fakeDeps(true);
  (b.deps as any).twig = adapter;
  const s2 = createCharacterStore(b.deps);
  assertEqual(s2.view.lens, 'paint', 'PAINTING STAYS PAINTING — the named failure, dead');
  assertEqual(s2.view.selPart, 'torso', 'the painted part restores');
  assertEqual(s2.view.brush, 2, 'the sculpt brush restores');
  assertEqual(s2.view.mirror, false, 'toggles restore');
  assertEqual(s2.view.sculptMode, 'lower', 'tool modes restore');
  assertEqual(s2.draftId, 'chr-a', 'the WORKING ROW restores (not the newest entry)');
  assertEqual(s2.draftName, 'alpha', 'with its name');
  // a removed row degrades gracefully: twig points at a ghost → newest entry
  bag.set('wbDraftId', 'chr-ghost');
  const c = fakeDeps(true);
  (c.deps as any).twig = adapter;
  const s3 = createCharacterStore(c.deps);
  assertEqual(s3.draftId, 'chr-b', 'a stale twig row falls back to the newest entry');
});

test('SKINRANGE-0606: the tone grid reaches the whole range (pure generator)', () => {
  const range = { stops: ['#f9ece1', '#8d5a3c', '#2b1a10'], cols: 14, rows: 5, warmth: 16 };
  const grid = colorRangeCells(range);
  assertEqual(grid.length, 5, 'row count');
  assertEqual(grid[0].length, 14, 'column count');
  for (const row of grid) for (const c of row) assert(/^#[0-9a-f]{6}$/.test(c), `valid hex: ${c}`);
  const mid = grid[2];
  assertEqual(mid[0], '#f9ece1', 'the pure curve starts at the palest stop');
  assertEqual(mid[mid.length - 1], '#2b1a10', 'and ends at the deepest');
  assert(grid[0][7] !== grid[4][7], 'warm and cool rows actually differ');
  // the panel's spec carries the range (any tone reachable from gutter 3)
  const { deps } = fakeDeps(false);
  const store = createCharacterStore(deps);
  const skin = field(characterPanel(store), 'IDENTITY', 'skin') as any;
  assert(skin.range && skin.range.stops.length >= 3, 'the skin field carries the continuum');
  assert(skin.opts.length >= 8, 'quick-pick presets widened');
  skin.set('#5d3a26');
  assertEqual(store.draft.skin, '#5d3a26', 'an arbitrary tone lands on the draft');
});

test('RESETPART-0606: reset part wipes the data AND re-keys the view', () => {
  const { deps } = fakeDeps(false);
  const store = createCharacterStore(deps);
  const part = store.view.selPart;
  // sculpt something real: a grid value, an outline drag, a region slider
  const dirtyGrid = store.draft.grids[part].map((_, i) => (i === 5 ? 0.8 : 0));
  store.setPartGrid(part, dirtyGrid);
  store.editDraft((d) => ({ ...d, profiles: { ...d.profiles, [part]: d.profiles[part].map(() => 1.2) } }));
  store.setRegion(part, 'any', 0.6);
  assert(store.draft.grids[part][5] === 0.8, 'the sculpt landed');
  const seqBefore = store.seqs[part];
  const installBefore = store.installRev;
  // the panel's reset-part act (the user's button)
  (field(characterPanel(store), 'PART', 'reset part') as any).run();
  // (1) the DATA equals defaults
  assert(store.draft.grids[part].every((v) => v === 0), 'the sculpt grid is zeroed');
  assertEqual(JSON.stringify(store.draft.regions[part]), '{}', 'the region sliders are cleared');
  const def = defaultProfile(part);
  assert(store.draft.profiles[part].every((v, i) => Math.abs(v - def[i]) < 1e-9), 'the outline is back to the factory profile');
  // (2) the VIEW re-keys: the mesh slot's content address moves + textures re-upload
  assert(store.seqs[part] > seqBefore, 'the part seq bumped — partDynKey changes, the mesh re-sculpts');
  assert(store.installRev > installBefore, 'installRev bumped — the stage re-uploads the paint texture');
  // (3) undoable, like every edit
  store.undo();
  assertEqual(store.draft.grids[part][5], 0.8, 'ctrl+z returns the sculpt');
});

// ── CLOTHSPLIT-0606 phase 2 (USER RULING req_0040): the editor separation ──

test('CLOTHSPLIT parity pin: the three panels collectively expose every pre-split control', () => {
  const { deps } = fakeDeps(false);
  const store = createCharacterStore(deps);
  store.applyFaceDoc(generateFace(7), 'face on'); // head selected + face → every gated group shows
  const keys = new Set<string>();
  for (const spec of [characterPanel(store), clothingPanel(store), animationPanel(store)]) {
    for (const g of spec.groups) for (const f of g.fields) keys.add(f.k);
  }
  // the pre-split panel's full field roster (panel.ts at e694aa488) — a
  // control missing from EVERY context is a parity break and fails here
  const expected = [
    'name', 'skin',                                         // IDENTITY
    'part', 'reset part',                                   // PART
    'shape', 'clothes', 'bottoms', 'print',                 // BODY (split W1-W4)
    ...Object.values(CLOTHING_ACCESSORIES).map((a) => a.label), // EXTRAS (W5)
    'held',                                                 // PROP (W6)
    'generate face', 'export .hed', 'remove face',          // FACE acts
    'skull stretch', 'photo size', 'photo up/down',         // FACE knobs
    'rig', 'anim', 'face anim',                             // ANIMATION → POSE/FACE (A1-A3)
    'script', 'play', 'reset script',                       // SCRIPT (A4-A6)
    ...Object.keys(ANIM_PRESETS),                           // preset shelf (A7)
    'depth amount',                                         // SCULPT
    ...SHAPE_REGIONS[store.view.selPart].map((r) => r.label), // REGION
    'reset regions',
  ];
  for (const k of expected) assert(keys.has(k), `pre-split control "${k}" has a home in some context`);
});

test('CLOTHSPLIT: the mesh panel shows MESH ONLY (the ruling, as a test)', () => {
  const { deps } = fakeDeps(false);
  const store = createCharacterStore(deps);
  store.applyFaceDoc(generateFace(7), 'face on');
  const meshKeys = new Set<string>();
  for (const g of characterPanel(store).groups) for (const f of g.fields) meshKeys.add(f.k);
  const banned = [
    'clothes', 'bottoms', 'print', 'held',
    ...Object.values(CLOTHING_ACCESSORIES).map((a) => a.label),
    'rig', 'anim', 'face anim', 'script', 'play', 'reset script',
    ...Object.keys(ANIM_PRESETS),
  ];
  for (const k of banned) assert(!meshKeys.has(k), `"${k}" must not appear in the mesh context`);
  assert(meshKeys.has('shape'), 'body SHAPE stays mesh-side (WBCLOTH W1 — it reshapes the skeleton)');
  // W1's kept gesture: a shape pick still jumps the mesh view to FIGURE
  store.setLens('sculpt');
  (field(characterPanel(store), 'BODY', 'shape') as any).set('heavy');
  assertEqual(store.view.lens, 'figure', 'the body-shape pick keeps its flip-to-FIGURE gesture');
});

test('CLOTHSPLIT: animation panel keeps the clock exclusivity, drops the lens flips', () => {
  const { deps } = fakeDeps(false);
  const store = createCharacterStore(deps);
  store.setLens('sculpt');
  store.setBodyRigAnim(true);
  (field(animationPanel(store), 'SCRIPT', 'play') as any).set(true);
  assert(store.view.scriptPlaying, 'play starts the script');
  assert(!store.view.bodyRigAnim, 'play stops the rig anim (the pre-split exclusivity)');
  assertEqual(store.view.lens, 'sculpt', 'no lens flip — the animation stage IS the figure (WBCLOTH F1)');
  const presetLabel = Object.keys(ANIM_PRESETS)[0];
  const preset = field(animationPanel(store), 'SCRIPT', presetLabel) as any;
  preset.run();
  assertEqual(store.view.animScript, (ANIM_PRESETS as Record<string, string>)[presetLabel], 'a preset applies its script');
  assert(store.view.scriptPlaying, 'and autoplays (route semantics kept)');
  // pose lands without flipping anything
  (field(animationPanel(store), 'POSE', 'rig') as any).set('kneel');
  assertEqual(store.draft.bodyPose, 'kneel', 'the pose pick lands');
  assertEqual(store.view.lens, 'sculpt', 'still no flip');
});

test('CLOTHSPLIT: face-anim group gates on the FACE, not the selected part', () => {
  const { deps } = fakeDeps(false);
  const store = createCharacterStore(deps);
  assert(!field(animationPanel(store), 'FACE', 'face anim'), 'no face → no FACE group');
  store.applyFaceDoc(generateFace(3), 'face on');
  store.setSelPart('torso'); // the animation context must not care about the mesh part
  const fa = field(animationPanel(store), 'FACE', 'face anim') as any;
  assert(!!fa, 'a face brings the FACE group regardless of part selection');
  fa.set('talk');
  assertEqual(store.view.faceAnim, 'talk', 'the pick lands');
});

test('CLOTHSPLIT: clothing/animation sources mirror the character roster over ONE store', () => {
  const { deps } = fakeDeps(true);
  const store = createCharacterStore(deps);
  const cloth = clothingSourceCore(store);
  const anim = animationSourceCore(store);
  assertEqual(cloth.id, 'clothing', 'the clothing source id');
  assertEqual(anim.id, 'animation', 'the animation source id');
  const chr = charactersSource(store);
  assertEqual(
    JSON.stringify(cloth.list()), JSON.stringify(chr.list()),
    'the clothing roster IS the character roster (the outfit is per-character)',
  );
  assertEqual(JSON.stringify(anim.list()), JSON.stringify(chr.list()), 'animation too');
  cloth.onPick!('chr-a');
  assertEqual(store.draftId, 'chr-a', 'a pick in the clothing context installs the shared working draft');
  assertEqual(anim.defaultRow!(anim.list()), 'chr-a', 'every context resolves the same working row');
  assert((cloth.select('chr-a') as unknown) === (store as unknown), 'one store, three contexts');
  assert(cloth.actions!(store).some((a) => a.id === 'save'), 'a dressing session can save without context-switching');
  assert(!cloth.lenses, 'no lens bar — one honest view (LAW 2; WBCLOTH §5)');
});

finish('editors/workbench/characters');
