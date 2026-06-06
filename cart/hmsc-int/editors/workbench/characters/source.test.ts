// source.test.ts — P4 behavior tests for the character WorkbenchSource
// (WBCHAR-0606): spec generation round-trip, list/select resolution, the
// route-parity semantics the panel must keep (autosave minting, clothes→
// bottoms coupling, accessory exclusivity, region zero-snap, lens flips).
// Headless: a fake channel/session pair stands in for the V20 wires
// (autosaveMs 0 → synchronous commits; twig io off).

import { assert, assertEqual, finish, test } from '../../../game/_testkit';
import { createCharacterStore, type CharacterStoreDeps } from './store';
// the HEADLESS core (panel.ts) — never source.tsx, which carries the stage's
// React half (the characters.test.ts bundling law)
import { characterSourceCore as charactersSource, characterPanel } from './panel';
import { draftToDocument } from '../../characters/draft';
import { generateCharacterDraft } from '../../characters/generate';
import { SHAPE_REGIONS } from '../../characters/regions';
import { PAINT_EDITOR_TUNING } from '../../characters/paintKit';
import { CLOTHING_ACCESSORIES, DEFAULT_BOTTOMS, PART_PRESETS } from '../../../game/figure/shapes';
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

test('clothes enum couples bottoms and flips the lens to FIGURE', () => {
  const { deps } = fakeDeps(false);
  const store = createCharacterStore(deps);
  store.setLens('sculpt');
  (field(characterPanel(store), 'BODY', 'clothes') as any).set('hoodie');
  assertEqual(store.draft.clothing, 'hoodie', 'the clothing landed');
  assertEqual(store.draft.bottoms, DEFAULT_BOTTOMS.hoodie, 'bottoms follow DEFAULT_BOTTOMS (route coupling)');
  assertEqual(store.view.lens, 'figure', 'a wardrobe pick shows the figure (route setView parity)');
});

test('extras keep the cap⇄beanie exclusivity', () => {
  const { deps } = fakeDeps(false);
  const store = createCharacterStore(deps);
  const capLabel = CLOTHING_ACCESSORIES.cap.label;
  const beanieLabel = CLOTHING_ACCESSORIES.beanie.label;
  (field(characterPanel(store), 'EXTRAS', capLabel) as any).set(true);
  assert(store.draft.accessories.includes('cap'), 'cap toggles on');
  (field(characterPanel(store), 'EXTRAS', beanieLabel) as any).set(true);
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

test('the held-prop enum lists sculpted /items and resolves labels back to ids', () => {
  const { deps } = fakeDeps(false);
  const store = createCharacterStore(deps);
  const held = field(characterPanel(store), 'PROP', 'held') as any;
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

finish('editors/workbench/characters');
