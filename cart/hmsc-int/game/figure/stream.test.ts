// stream.test.ts — P4 behavior tests for the V20 'characters' concern (the
// roster) and THE deletion-contract round-trip: author → stream → snapshot →
// bakeBodyDocument output identical. Runs under tools/v8cli against real
// __fs_* bindings in a scratch root under zig-out/ (never the live data/).

import { openStore } from '../../data';
import { GAME_FIGURE, charactersStream, bakeBodyDocument, buildBody, buildOutfit, generateFace, hedDepthGrid, PART_IDS, PROFILE_N, defaultProfile, type BodyDocument } from './index';
import { assert, assertEqual, finish, test } from '../_testkit';

declare const globalThis: any;

const ROOT = 'zig-out/game/test-characters-data';

function wipeScratch(): void {
  for (const path of [
    `${ROOT}/store.db`, `${ROOT}/store.db-wal`, `${ROOT}/store.db-shm`, // STOREDB-0606: the scratch store is a DB now
    `${ROOT}/streams/characters.jsonl`,
    `${ROOT}/snapshots/characters.snapshot.json`,
  ]) globalThis.__fs_remove?.(path);
}

/** A deterministic authored character: generated face + dragged outlines +
 *  a torso sculpt, dressed — the editor's full output, from one seed. */
function makeCharacter(seed: number, title: string): BodyDocument {
  const face = generateFace(seed);
  const sculpts = {} as Record<(typeof PART_IDS)[number], number[]>;
  const profiles = {} as Record<(typeof PART_IDS)[number], number[]>;
  for (const id of PART_IDS) {
    sculpts[id] = id === 'head'
      ? face.sculpt.map((b) => b / 127)
      : new Array(48 * 24).fill(0).map((_, i) => (i % 7 === 0 ? 0.25 : 0));
    profiles[id] = defaultProfile(id).map((v, i) => v * (1 + 0.02 * Math.sin(seed + i)));
  }
  return buildBody({
    skin: face.skin,
    amount: face.amount,
    headScaleY: face.scaleY,
    sculpts,
    profiles,
    headLayers: face.layers,
    bodyShape: 'heavy',
    // CLOTHSPLIT-0606: the wardrobe rides as the one attachment document
    outfit: buildOutfit({ top: 'hoodie', bottoms: 'jeans', print: 'fourtwenty', accessories: ['cap'] }),
    heldItem: 'bat',
    bodyPose: 'stand',
    title,
  });
}

test('the roster materializes: authored docs upsert by id, removal forgets', () => {
  const first = makeCharacter(7, 'first');
  let state = charactersStream.initial();
  state = charactersStream.apply(state, { kind: 'authored', id: 'a', doc: first });
  state = charactersStream.apply(state, { kind: 'authored', id: 'b', doc: makeCharacter(8, 'second') });
  const reskinned: BodyDocument = { ...first, skin: '#8d5a3c' };
  state = charactersStream.apply(state, { kind: 'authored', id: 'a', doc: reskinned });
  assertEqual(state.order.join(','), 'a,b', 're-authoring must not duplicate the rail entry');
  assertEqual(state.characters.a.skin, '#8d5a3c', 'an upsert carries the resulting doc');
  state = charactersStream.apply(state, { kind: 'removed', id: 'a' });
  assertEqual(state.order.join(','), 'b', 'removal drops the rail entry');
  assert(!('a' in state.characters), 'removal forgets the doc');
  const same = charactersStream.apply(state, { kind: 'removed', id: 'ghost' });
  assert(same === state, 'removing an unknown id is a no-op (same reference)');
});

test('unknown event kinds are tolerated (schema evolution by addition, V20)', () => {
  const state = charactersStream.apply(charactersStream.initial(), { kind: 'tattooParlor', ink: 3 } as any);
  assertEqual(Object.keys(state.characters).length, 0, 'a future event must not corrupt an old materializer');
});

test('THE round-trip: author → stream → snapshot → bakeBodyDocument identical', () => {
  wipeScratch();
  const authored = makeCharacter(20260604, 'hero');

  const store = openStore(ROOT);
  const roster = store.defineStream(charactersStream);
  roster.append({ kind: 'authored', id: 'hero', doc: makeCharacter(1, 'draft') });
  roster.append({ kind: 'authored', id: 'hero', doc: authored });
  store.materializeSnapshots();

  // A fresh store (a new session / the compile) loads the SNAPSHOT, never the history.
  const loaded = openStore(ROOT).loadSnapshot<{ characters: Record<string, BodyDocument>; order: string[] }>('characters');
  assert(loaded !== null, 'the characters snapshot must exist');
  const restored = loaded!.state.characters.hero;
  assertEqual(JSON.stringify(restored), JSON.stringify(authored), 'the doc must survive byte-exact');

  const before = bakeBodyDocument(authored);
  const after = bakeBodyDocument(restored);
  assertEqual(JSON.stringify(after.parts), JSON.stringify(before.parts), 'part recipes identical through the chain');
  assertEqual(JSON.stringify(after.bones), JSON.stringify(before.bones), 'skeleton identical through the chain');
  assertEqual(JSON.stringify(after.hitboxes), JSON.stringify(before.hitboxes), 'hitboxes identical through the chain');
  assertEqual(JSON.stringify(after.faceTexture), JSON.stringify(before.faceTexture), 'face texture identical through the chain');
  assertEqual(JSON.stringify(after.clothing), JSON.stringify(before.clothing), 'wardrobe identical through the chain');
});

test('bakeBodyDocument reconstructs the face from the doc itself (one mapping)', () => {
  const doc = makeCharacter(99, 'face-check');
  const baked = bakeBodyDocument(doc);
  assertEqual(baked.shape, 'heavy', 'the body shape rides through');
  assertEqual(baked.faceTexture.skin, doc.skin, 'face texture wears the doc skin');
  assertEqual(baked.faceTexture.layers.length, doc.parts.head.layers.length, 'face layers ride into the texture');
  // the head's displacement composites the doc's own sculpt + layer stamps
  const face = { kind: 'hed' as const, version: 1 as const, cols: 48, rows: 24, skin: doc.skin, amount: doc.amount, scaleY: doc.headScaleY, sculpt: doc.parts.head.sculpt, layers: doc.parts.head.layers };
  assertEqual(JSON.stringify(baked.parts.head.params.displace), JSON.stringify(hedDepthGrid(face)), 'head displacement = the doc composited');
  // dragged outlines survive: the baked pipe wears the doc profile, not the preset
  assertEqual(JSON.stringify(baked.parts.pipe.params.profile), JSON.stringify(doc.parts.pipe.profile), 'non-head parts wear their dragged outline');
  assertEqual(baked.parts.pipe.params.profile.length, PROFILE_N, 'a profile is PROFILE_N radius samples');
});

test('an undo point steps the roster back without rewriting the log', () => {
  wipeScratch();
  const store = openStore(ROOT);
  const roster = store.defineStream(charactersStream);
  roster.append({ kind: 'authored', id: 'one', doc: makeCharacter(1, 'one') });
  const checkpoint = store.undoPoint();
  roster.append({ kind: 'authored', id: 'two', doc: makeCharacter(2, 'two') });
  roster.append({ kind: 'removed', id: 'one' });
  assertEqual(roster.stateAt(checkpoint).order.join(','), 'one', 'as-of the checkpoint only one exists');
  assertEqual(roster.state().order.join(','), 'two', 'the present keeps the full fold');
  assertEqual(roster.length(), 3, 'history is immutable — undo never rewrote the log');
});

test('the GAME_FIGURE door carries the concern + the doc bake', () => {
  assertEqual(GAME_FIGURE.stream, charactersStream, 'GAME_FIGURE.stream is the V20 concern (like world/missions/vehicles)');
  assertEqual(GAME_FIGURE.stream.name, 'characters', 'the concern is named for its stream file');
  assertEqual(GAME_FIGURE.bakeBody, bakeBodyDocument, 'GAME_FIGURE.bakeBody is the snapshot consumer entry');
});

finish('game/figure/stream');
