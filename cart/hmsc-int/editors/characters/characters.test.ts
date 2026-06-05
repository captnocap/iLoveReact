// characters.test.ts — P4 behavior tests for the characters editor's
// headless core: the draft↔document exchange, region stamping, seeded
// generation, and the roster (save → stream → snapshot, through a real
// on-disk store in a scratch root — never the live data/).

import { openStore } from '../../data';
import { parseBody, serializeBody, type BodyDocument } from '../../game/figure/body';
import { bakeBodyDocument } from '../../game/figure/bake';
import { PART_IDS, PROFILE_N, defaultProfile } from '../../game/figure/shapes';
import { HED_GRID_W } from '../../game/figure/hed';
import {
  GRID_CELLS, draftFromDocument, draftPartGrid, draftToDocument, draftToHed, draftWithFace, emptyDraft, emptyGrid,
} from './draft';
import { SHAPE_REGIONS, applyRegionValues, regionSignature, stampGrid } from './regions';
import { generateCharacterDraft } from './generate';
import { createRoster } from './roster';
import { charactersStream, type CharactersStreamState } from '../../game/figure/stream';
import { createSessionLog } from '../sessions';
// the painter's headless module directly — the door also exports the JSX/hook
// half, which only bundles under the full cart alias set (paint.test.ts does
// the same)
import { createStrokeEngine } from '../paint/strokes';
import { assert, assertClose, assertEqual, finish, test } from '../../game/_testkit';

declare const globalThis: any;

const ROOT = 'zig-out/game/test-characters-editor';

function wipeScratch(): void {
  for (const path of [
    `${ROOT}/streams/characters.jsonl`,
    `${ROOT}/streams/sessions.jsonl`,
    `${ROOT}/snapshots/characters.snapshot.json`,
    `${ROOT}/snapshots/sessions.snapshot.json`,
  ]) globalThis.__fs_remove?.(path);
}

test('region stamps: smooth ellipse, mirror twin, clamp, zero is identity', () => {
  const grid = emptyGrid();
  stampGrid(grid, 0.25, 0.5, 0.1, 0.2, 0.8, true);
  const at = (u: number, v: number) => grid[Math.floor(v * 24) * HED_GRID_W + Math.floor(u * HED_GRID_W)];
  assert(at(0.25, 0.5) > 0.5, 'the stamp center raises hard');
  assert(at(0.75, 0.5) > 0.5, 'the mirror twin lands across u=0.5');
  assertEqual(at(0.5, 0.05), 0, 'outside the ellipse stays untouched');
  const saturated = emptyGrid();
  for (let i = 0; i < 5; i++) stampGrid(saturated, 0.5, 0.5, 0.4, 0.4, 1);
  assert(Math.max(...saturated) <= 1, 'repeated stamps clamp at the signed range');

  const base = emptyGrid();
  assert(applyRegionValues('head', base, {}) === base, 'all-zero sliders return the base reference (no copy, no re-bake)');
  const stamped = applyRegionValues('head', base, { brow: 0.5 });
  assert(stamped !== base && Math.max(...stamped) > 0, 'a live slider stamps a copy');
  assertEqual(regionSignature({ brow: 0.5 }), 'brow:0.50', 'the signature is stable for dyn keys');
  assertEqual(regionSignature({}), 'r0', 'empty values share the null signature');
  for (const part of PART_IDS) {
    assert(SHAPE_REGIONS[part].length >= 3, `${part} has named regions to slide`);
  }
});

test('draft → document → draft is lossless (the editor round-trip)', () => {
  const draft = generateCharacterDraft(424242);
  draft.regions.torso = { belly: 0.4 };
  const doc = draftToDocument(draft, 'round-trip');
  const parsed = parseBody(serializeBody(doc));
  assert(parsed !== null, 'the exported document must parse');
  const back = draftFromDocument(parsed!);

  assertEqual(back.skin, draft.skin, 'skin survives');
  assertEqual(back.clothing, draft.clothing, 'clothing survives');
  assertEqual(back.bottoms, draft.bottoms, 'bottoms survive');
  assertEqual(back.heldItem, draft.heldItem, 'the held item survives');
  assertEqual(back.bodyPose, draft.bodyPose, 'the pose survives');
  assertEqual(JSON.stringify(back.profiles.pipe), JSON.stringify(draft.profiles.pipe), 'dragged outlines survive exactly');
  assertEqual(back.face?.layers.length, draft.face?.layers.length, 'face layers survive');
  // regions baked INTO the sculpt: the loaded torso grid equals the composited
  // grid (to sculpt-byte quantization), and the loaded regions are empty
  const composited = draftPartGrid(draft, 'torso');
  for (const i of [0, 300, 600, 900]) {
    assertClose(back.grids.torso[i], composited[i], 1 / 127, `torso sculpt cell ${i} carries the baked region`);
  }
  assertEqual(Object.keys(back.regions.torso).length, 0, 'regions come back empty — their effect is in the sculpt');
});

test('the .hed coherence law: residue moves into the grid, never doubles', () => {
  const generated = generateCharacterDraft(7);
  const hed = draftToHed(generated, 'face-export');
  assertEqual(hed.sculpt.length, GRID_CELLS, 'the exported face carries the composited head sculpt');

  const fresh = draftWithFace(emptyDraft(), hed);
  assert(fresh.face !== null, 'the face document is kept');
  assertEqual(Math.max(...fresh.face!.sculpt.map(Math.abs)), 0, 'the kept face zeroes its sculpt (no double-count)');
  for (const i of [0, 500, 1000]) {
    assertClose(fresh.grids.head[i], hed.sculpt[i] / 127, 1e-9, `residue cell ${i} lives in the head grid now`);
  }
  assertEqual(fresh.skin, hed.skin, 'knobs ride the document in');
  assertEqual(fresh.headScaleY, hed.scaleY, 'skull stretch rides in');
});

test('seeded generation: deterministic, valid, varied (V2-AMENDED)', () => {
  const a = generateCharacterDraft(1234);
  const b = generateCharacterDraft(1234);
  assertEqual(JSON.stringify(draftToDocument(a, 't').parts), JSON.stringify(draftToDocument(b, 't').parts), 'the same seed reproduces the same character');

  const shapes = new Set<string>();
  const clothes = new Set<string>();
  for (let seed = 1; seed <= 24; seed++) {
    const draft = generateCharacterDraft(seed * 7919);
    shapes.add(draft.bodyShape);
    clothes.add(draft.clothing);
    assert(!(draft.accessories.includes('cap') && draft.accessories.includes('beanie')), 'cap and beanie never stack');
    if (draft.clothing === 'dress') assertEqual(draft.bodyShape, 'female', 'a dress forces the female shape');
    for (const id of PART_IDS) {
      assertEqual(draft.profiles[id].length, PROFILE_N, `${id} outline has PROFILE_N samples`);
      assert(draft.profiles[id].every((v) => v > 0), `${id} outline stays positive`);
      assertEqual(draft.grids[id].length, GRID_CELLS, `${id} grid is 48×24`);
    }
    const doc = draftToDocument(draft, `gen-${seed}`);
    assert(parseBody(serializeBody(doc)) !== null, 'every generated character exports a valid document');
  }
  assert(shapes.size >= 4, `generation varies body shapes (got ${shapes.size})`);
  assert(clothes.size >= 3, `generation varies clothing (got ${clothes.size})`);
});

test('outlines differ by shape: the generator warps the preset silhouette', () => {
  const heavyTorso = generateCharacterDraft(11).bodyShape;
  // find seeds with known shapes deterministically
  let heavy: number[] | null = null;
  let skinny: number[] | null = null;
  for (let seed = 1; seed < 400 && (!heavy || !skinny); seed++) {
    const d = generateCharacterDraft(seed);
    if (d.bodyShape === 'heavy' && d.clothing !== 'dress' && !heavy) heavy = d.profiles.torso;
    if (d.bodyShape === 'skinny' && d.clothing !== 'dress' && !skinny) skinny = d.profiles.torso;
  }
  assert(heavy !== null && skinny !== null, `the seed sweep finds both shapes (heavyTorso probe: ${heavyTorso})`);
  const mid = Math.floor(PROFILE_N / 2);
  assert(heavy![mid] > skinny![mid], 'a heavy torso outline is wider than a skinny one at the waist');
  const preset = defaultProfile('torso');
  assert(heavy!.some((v, i) => Math.abs(v - preset[i]) > 0.01), 'generated outlines leave the preset');
});

test('the roster: save → stream → snapshot; the saved doc bakes (the full chain)', () => {
  wipeScratch();
  const roster = createRoster(openStore(ROOT));
  const doc: BodyDocument = draftToDocument(generateCharacterDraft(555), 'roster-hero');
  roster.save('hero', doc);
  const checkpoint = roster.undoPoint();
  roster.save('extra', draftToDocument(generateCharacterDraft(556), 'extra'));
  roster.remove('extra');
  assertEqual(roster.state().order.join(','), 'hero', 'the roster folds saves and removals');
  assertEqual(roster.stateAt(checkpoint).order.join(','), 'hero', 'the checkpoint sees only hero');

  // save() materialized the snapshot in the same breath — a fresh store reads it
  const snapshot = openStore(ROOT).loadSnapshot<{ characters: Record<string, BodyDocument>; order: string[] }>('characters');
  assert(snapshot !== null, 'save() left a fresh snapshot for the compile');
  const restored = snapshot!.state.characters.hero;
  assertEqual(JSON.stringify(restored), JSON.stringify(doc), 'the snapshot doc is byte-exact');
  const baked = bakeBodyDocument(restored);
  assertEqual(baked.kind, 'baked-figure', 'the snapshot doc bakes into a figure');
  assert(baked.hitboxes.length > 0, 'the baked figure carries hit volumes');
});

test('the paint session: strokes note, saves commit — one labeled undo chain', () => {
  wipeScratch();
  const store = openStore(ROOT);
  const channel = store.defineStream(charactersStream);
  const log = createSessionLog(store);
  const ses = log.open('/characters', channel);

  // the shared painter's fidelity law the route leans on: at the no-pressure
  // fallback, a dab's radius IS the brush knob value — and mirror twins land
  // across the meridian (the route passes mirrorAxisX = PAINT_W / 2)
  const engine = createStrokeEngine({ brushPx: 14, mirrorAxisX: 96 });
  engine.begin();
  const dabs = engine.move(48, 40);
  assert(dabs.length >= 2, 'a mirrored stroke emits the dab and its twin');
  assertClose(dabs[0].radius, 14, 1e-9, 'fallback-pressure radius equals the brush knob');
  assertClose(dabs[1].x, 144, 1e-9, 'the twin lands mirrored across the meridian');
  engine.end();

  // route behavior: stroke release → note; Save → commit with the document
  ses.note('sculpt stroke · raise · 14px · torso');
  const doc = draftToDocument(generateCharacterDraft(777), 'painted-hero');
  ses.commit({ kind: 'authored', id: 'hero', doc }, 'painted-hero: saved');
  ses.close();

  const history = log.state();
  assertEqual(history.order.length, 1, 'one session this visit');
  const record = history.sessions[history.order[0]];
  assertEqual(record.route, '/characters', 'the session knows its route');
  assertEqual(record.commits.map((c) => c.label).join(' | '), 'sculpt stroke · raise · 14px · torso | painted-hero: saved', 'every interaction is a labeled commit, in order');
  assertEqual(record.commits[0].at, null, 'a stroke note is marker-only (content lands at save)');
  assert(record.commits[1].at !== null, 'the save carries its content event position');
  assert(record.closedSeq !== null, 'the session closed');

  // the undo chain: as of the stroke note hero does not exist; as of the save he does
  assert(!('hero' in channel.stateAt(record.commits[0].seq).characters), 'stateAt(the stroke) predates the save');
  assertEqual(JSON.stringify(channel.stateAt(record.commits[1].seq).characters.hero), JSON.stringify(doc), 'stateAt(the save) is the saved document');

  // the commit re-materialized the snapshot — the compile's view is fresh
  const snapshot = openStore(ROOT).loadSnapshot<CharactersStreamState>('characters');
  assert(snapshot !== null, 'the save left a fresh characters snapshot');
  assertEqual(JSON.stringify(snapshot!.state.characters.hero), JSON.stringify(doc), 'the snapshot doc is byte-exact');
});

finish('editors/characters');
