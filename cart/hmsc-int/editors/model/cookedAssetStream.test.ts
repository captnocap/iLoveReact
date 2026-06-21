// cookedAssetStream.test.ts — P4 tests for the cooked-asset content store (Part 7,
// req_1122/req_1129). Proves install once → reference everywhere: idempotent
// install, content-addressed blob dedup, rename/remove, kind filtering, blob
// retrieval, and cold-reopen persistence (the modelStream.test.ts idiom).

import { openStore } from '../../data';
import { addTextureSlot, cuboid } from './editMesh';
import { cookProp, type PropDescriptorInput } from './cookedAsset';
import {
  cookedAssetStream, cookedAssetsByKind, installEvent, installedAssets, meshBlobFor, textureBlobFor,
  type CookedAssetEvent, type CookedAssetStreamState,
} from './cookedAssetStream';
import { assert, assertEqual, finish, test } from '../../game/_testkit';

declare const globalThis: any;

const ROOT = 'zig-out/game/test-cookedasset';
const PROP: PropDescriptorInput = { solid: true, tileKind: 'wall' };

function wipeScratch(): void {
  for (const path of [
    `${ROOT}/store.db`, `${ROOT}/store.db-wal`, `${ROOT}/store.db-shm`,
    `${ROOT}/streams/cooked-asset.jsonl`,
    `${ROOT}/snapshots/cooked-asset.snapshot.json`,
  ]) globalThis.__fs_remove?.(path);
}

function fold(events: CookedAssetEvent[]): CookedAssetStreamState {
  return events.reduce((s, e) => cookedAssetStream.apply(s, e), cookedAssetStream.initial());
}

function cookCrate(id = 'studio.crate', name = 'Crate', dims: [number, number, number] = [2, 2, 2]) {
  return cookProp({ id, name, parts: [{ mesh: cuboid(...dims), lift: dims[1] / 2, visible: true }], descriptor: PROP });
}

test('installEvent + apply puts a cooked prop in the catalog', () => {
  const s = fold([installEvent(cookCrate())]);
  const all = installedAssets(s);
  assertEqual(all.length, 1, 'one installed asset');
  assertEqual(all[0].id, 'studio.crate', 'by its id');
  assertEqual(cookedAssetsByKind(s, 'prop').length, 1, 'shows in the prop catalog');
  assertEqual(cookedAssetsByKind(s, 'item').length, 0, 'not in the item catalog');
});

test('the geometry factor is retrievable as the loader soup', () => {
  const r = cookCrate();
  const s = fold([installEvent(r)]);
  const verts = meshBlobFor(s, r.asset.meshRef);
  assert(verts != null, 'mesh blob present');
  assertEqual(verts!.length, r.blob.verts.length, 'soup round-trips length');
  assertEqual(verts!.length % 8, 0, '8 floats per vertex');
});

test('re-installing the same asset is idempotent (no duplicate catalog row)', () => {
  const s = fold([installEvent(cookCrate()), installEvent(cookCrate())]);
  assertEqual(installedAssets(s).length, 1, 'still one row');
});

test('a shared mesh blob is interned ONCE (content-addressed dedup)', () => {
  // two assets cooked from the SAME 2×2×2 cuboid → the SAME meshRef → one blob.
  const a = cookCrate('studio.a', 'A');
  const b = cookCrate('studio.b', 'B');
  assertEqual(a.asset.meshRef, b.asset.meshRef, 'same geometry → same content hash');
  const s = fold([installEvent(a), installEvent(b)]);
  assertEqual(Object.keys(s.meshBlobs).length, 1, 'one blob backs both assets (a sum, not a product)');
  assertEqual(installedAssets(s).length, 2, 'two catalog rows');
});

test('the texture factor interns by texRef', () => {
  const r = cookProp({ id: 'studio.t', name: 'T', parts: [{ mesh: cuboid(1, 1, 1), lift: 0.5, visible: true }], texRef: 'tex-hash-1', descriptor: PROP });
  const s = fold([installEvent(r, 'V0VCUA==')]);
  assertEqual(textureBlobFor(s, 'tex-hash-1'), 'V0VCUA==', 'texture blob stored under its hash');
});

test('texture slot metadata round-trips through installEvent + apply', () => {
  const mesh = addTextureSlot(cuboid(1, 1, 1), 'Screen', [0]).mesh;
  const r = cookProp({ id: 'studio.slot', name: 'Slot', parts: [{ mesh, lift: 0.5, visible: true }], descriptor: PROP });
  const s = fold([installEvent(r)]);
  const asset = installedAssets(s)[0];
  assertEqual(asset.slots?.length ?? 0, 1, 'one slot persisted on the asset');
  assertEqual(asset.slots![0].label, 'Screen', 'slot label persisted');
  assertEqual(asset.slots![0].count, 6, 'one quad face persisted as six vertices');
});

test('rename + remove edit the catalog', () => {
  let s = fold([installEvent(cookCrate())]);
  s = cookedAssetStream.apply(s, { kind: 'assetRenamed', id: 'studio.crate', name: 'Wooden Crate' });
  assertEqual(installedAssets(s)[0].name, 'Wooden Crate', 'renamed');
  s = cookedAssetStream.apply(s, { kind: 'assetRemoved', id: 'studio.crate' });
  assertEqual(installedAssets(s).length, 0, 'removed from the catalog');
});

test('unknown event kinds pass through (schema-by-addition)', () => {
  const s = cookedAssetStream.apply(fold([installEvent(cookCrate())]), { kind: 'futureThing' } as any);
  assertEqual(installedAssets(s).length, 1, 'an unknown kind is a no-op, not a crash');
});

test('a cooked asset survives a cold reopen (install once, persisted)', () => {
  wipeScratch();
  const store = openStore(ROOT);
  const ch = store.defineStream(cookedAssetStream);
  const r = cookCrate('studio.persist', 'Persist');
  ch.append(installEvent(r));
  store.materializeSnapshots();

  const reopened = openStore(ROOT);
  const ch2 = reopened.defineStream(cookedAssetStream);
  const all = installedAssets(ch2.state());
  assertEqual(all.length, 1, 'the asset survived the reopen');
  assertEqual(all[0].descriptor.footprintWidthMeters, r.asset.descriptor.footprintWidthMeters, 'descriptor persisted');
  assert(meshBlobFor(ch2.state(), r.asset.meshRef) != null, 'its mesh blob survived');
});

finish('cookedAssetStream');
