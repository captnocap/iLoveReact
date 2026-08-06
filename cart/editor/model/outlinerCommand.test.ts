import type { ModelPart } from '../data/types';
import {
  ModelOutlinerRejected,
  modelPartRecords,
  modelOutlinerNote,
  recoverAppendedPartUndoRows,
  planGroupDissolve,
  planGroupRename,
  planOutlinerMove,
  planPartRename,
  planPartsGroup,
  planPartsUngroup,
} from './outlinerCommand';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((text: string) => (globalThis as any).__writeStdout?.(`${text}\n`));
function test(name: string, run: () => void): void {
  try { run(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string): void { if (!condition) throw new Error(message); }
const part = (id: string, name: string, groupId?: string, groupName?: string): ModelPart => ({
  id, name, groupId, groupName, visible: true, color: '#999999', lo: Number(id.length), hi: Number(id.length) + 2,
});
const snapshot = (parts: ModelPart[], nextSequence = 8) => ({ modelId: 'model-a', parts: modelPartRecords(parts), nextSequence });

test('rename records an exact before/after metadata transaction', () => {
  const before = [part('a', 'Door'), part('bb', 'Frame')];
  const result = planPartRename(snapshot(before), { modelId: 'model-a', partId: 'a', name: '  Front Door  ' });
  assert(result.next.parts[0]?.name === 'Front Door', 'trimmed name not applied');
  assert(result.transaction.before[0]?.name === 'Door', 'before snapshot was mutated');
  assert(result.transaction.after[0]?.lo === before[0]?.lo, 'host range metadata was lost');
});

test('group, partial ungroup, rename, and dissolve preserve part identity', () => {
  const base = snapshot([part('a', 'Deck'), part('b', 'Rail'), part('c', 'Lamp')], 12);
  const grouped = planPartsGroup(base, { modelId: 'model-a', partIds: ['a', 'b'] });
  assert(grouped.transaction.groupId === 'part-group:12' && grouped.next.nextSequence === 13, 'fresh group identity was not deterministic');
  assert(grouped.next.parts[2]?.groupId === undefined, 'unselected part was regrouped');

  const renamed = planGroupRename(grouped.next, { modelId: 'model-a', groupId: 'part-group:12', name: 'Bridge' });
  assert(renamed.next.parts.slice(0, 2).every((row) => row.groupName === 'Bridge'), 'group label did not update every member');
  const ungrouped = planPartsUngroup(renamed.next, { modelId: 'model-a', partIds: ['a'] });
  assert(!ungrouped.next.parts[0]?.groupId && ungrouped.next.parts[1]?.groupId === 'part-group:12', 'partial ungroup changed the wrong rows');
  const dissolved = planGroupDissolve(ungrouped.next, { modelId: 'model-a', groupId: 'part-group:12' });
  assert(dissolved.next.parts.every((row) => !row.groupId), 'dissolve left group metadata behind');
  assert(dissolved.next.parts.map((row) => row.id).join(',') === 'a,b,c', 'organizational commands reordered parts');
});

test('adding loose parts to one selected group reuses that group identity', () => {
  const base = snapshot([part('a', 'Deck', 'g', 'Bridge'), part('b', 'Rail'), part('c', 'Lamp')], 20);
  const result = planPartsGroup(base, { modelId: 'model-a', partIds: ['a', 'b'] });
  assert(result.transaction.groupId === 'g' && result.next.nextSequence === 20, 'existing group was replaced instead of extended');
  assert(result.next.parts[1]?.groupName === 'Bridge', 'loose row did not join the group');
});

test('outliner move is one exact journal transaction and nested dissolve keeps children', () => {
  const base = snapshot([
    part('a', 'Loose'),
    { ...part('b', 'Door', 'body', 'Body'), groupPath: [{ id: 'body', name: 'Body' }] },
    { ...part('c', 'Lamp', 'lights', 'Lights'), groupPath: [{ id: 'lights', name: 'Lights' }] },
  ]);
  const moved = planOutlinerMove(base, {
    modelId: 'model-a', item: { kind: 'group', id: 'lights' }, target: { kind: 'group', id: 'body', position: 'inside' },
  });
  assert(moved.transaction.action === 'outliner.move' && moved.transaction.before[2]?.groupId === 'lights', 'move did not retain an exact inverse');
  assert(moved.next.parts.find((row) => row.id === 'c')?.groupPath?.map((g) => g.id).join('/') === 'body/lights', 'move plan flattened nested folder');
  const dissolved = planGroupDissolve(moved.next, { modelId: 'model-a', groupId: 'body' });
  assert(dissolved.next.parts.find((row) => row.id === 'c')?.groupPath?.map((g) => g.id).join('/') === 'lights', 'dissolving parent destroyed child folder');
});

test('invalid and inert requests reject before a mutation plan exists', () => {
  const base = snapshot([part('a', 'Deck', 'g', 'Bridge'), part('b', 'Rail', 'g', 'Bridge')]);
  const rejects = [
    () => planPartRename(base, { modelId: 'model-a', partId: 'a', name: 'Deck' }),
    () => planPartsGroup(base, { modelId: 'model-a', partIds: ['a', 'b'] }),
    () => planPartsUngroup(base, { modelId: 'model-a', partIds: [] }),
    () => planGroupRename(base, { modelId: 'model-a', groupId: 'g', name: ' ' }),
    () => planGroupDissolve(base, { modelId: 'other', groupId: 'g' }),
  ];
  for (const reject of rejects) {
    let threw = false;
    try { reject(); } catch (error) { threw = error instanceof ModelOutlinerRejected; }
    assert(threw, 'invalid request was not rejected by the domain boundary');
  }
});

test('journal notes exclude mesh blobs while retaining exact durable metadata', () => {
  const withMesh = { ...part('a', 'Deck'), mesh: { vertices: [], faces: [] } as any };
  const note = modelOutlinerNote('model-a', modelPartRecords([withMesh]));
  assert(!note.includes('"mesh"'), 'mesh geometry leaked into the journal note');
  assert(note.includes('"modelId":"model-a"') && note.includes('"name":"Deck"'), 'journal note lost identity metadata');
});

test('mirror undo preserves authored row identities when its journal note is unusable', () => {
  const before = [
    { ...part('hood', 'Hood'), lo: 20, hi: 25 },
    { ...part('door', 'Driver Door'), lo: 40, hi: 44 },
    { ...part('glass', 'Windshield'), lo: 70, hi: 73 },
  ];
  // Display order is deliberately not range order; the mirrored append is the
  // highest native range, not necessarily the last visible outliner row.
  const mirrored = { ...part('mirror', 'Driver Door mirror X'), lo: 90, hi: 94 };
  const current = [before[0]!, mirrored, before[1]!, before[2]!];
  const restored = recoverAppendedPartUndoRows(current, [
    { lo: 0, hi: 6 }, { lo: 6, hi: 12 }, { lo: 12, hi: 18 },
  ], 'mirror part');
  assert(restored?.map((row) => row.id).join(',') === 'hood,door,glass', 'mirror row was not removed by native range rank');
  assert(restored?.map((row) => row.name).join('|') === 'Hood|Driver Door|Windshield', 'authored names were replaced by anonymous rows');
  assert(restored?.map((row) => `${row.lo}:${row.hi}`).join(',') === '0:6,6:12,12:18', 'surviving rows did not follow restored host ranges');
  assert(recoverAppendedPartUndoRows(current, [{ lo: 0, hi: 6 }], 'mirror part') === null, 'ambiguous cardinality guessed at row ownership');
  assert(recoverAppendedPartUndoRows(current, [{ lo: 0, hi: 6 }, { lo: 6, hi: 12 }, { lo: 12, hi: 18 }], 'merge parts') === null, 'non-append history used the append-only inverse');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
