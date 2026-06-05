// voxels.test.ts — P4 behavior tests for the V20 'voxels' concern
// (AUTOSAVE-0605): the working blockout materializes, tolerates additions,
// and round-trips author → stream → snapshot through a real on-disk store.

import { openStore } from '../../data';
import { voxelsStream, type VoxelBlockoutDoc, type VoxelsStreamState } from './stream';
import { assert, assertEqual, finish, test } from '../../game/_testkit';

declare const globalThis: any;

const ROOT = 'zig-out/game/test-voxels-data';

function wipeScratch(): void {
  for (const path of [
    `${ROOT}/streams/voxels.jsonl`,
    `${ROOT}/snapshots/voxels.snapshot.json`,
  ]) globalThis.__fs_remove?.(path);
}

function blockout(n: number): VoxelBlockoutDoc {
  return {
    dims: { w: 5, d: 6, h: 7 },
    blocks: Array.from({ length: n }, (_, i) => ({ id: 1000 + i, x: i % 5, y: 1, z: Math.floor(i / 5), kind: 'wall' as const })),
  };
}

test('the working blockout materializes: authored replaces, additions tolerated (V20)', () => {
  let state = voxelsStream.initial();
  assertEqual(state.doc, null, 'starts blank');
  state = voxelsStream.apply(state, { kind: 'authored', doc: blockout(3) });
  state = voxelsStream.apply(state, { kind: 'authored', doc: blockout(7) });
  assertEqual(state.doc!.blocks.length, 7, 'the latest authored doc IS the blockout');
  const same = voxelsStream.apply(state, { kind: 'mirrorTool', axis: 'x' } as any);
  assertEqual(same.doc!.blocks.length, 7, 'a future event kind passes through untouched');
});

test('round-trip: autosave → stream → snapshot → restore identical', () => {
  wipeScratch();
  const store = openStore(ROOT);
  const channel = store.defineStream(voxelsStream);
  const doc = blockout(12);
  channel.append({ kind: 'authored', doc: blockout(2) });
  const checkpoint = store.undoPoint();
  channel.append({ kind: 'authored', doc });
  store.materializeSnapshots();

  const snapshot = openStore(ROOT).loadSnapshot<VoxelsStreamState>('voxels');
  assert(snapshot !== null, 'the voxels snapshot exists');
  assertEqual(JSON.stringify(snapshot!.state.doc), JSON.stringify(doc), 'the restored blockout is byte-exact');
  assertEqual(channel.stateAt(checkpoint).doc!.blocks.length, 2, 'the undo point steps back to the earlier blockout');
});

finish('editors/voxels');
