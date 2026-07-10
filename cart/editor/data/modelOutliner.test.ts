import { assignPartsToGroup, duplicateNameStem, modelOutlinerRoots, nextDuplicateGroupName, nextDuplicatePartName, nextModelGroupName, ungroupParts, withoutPartGroup } from './modelOutliner';
import type { ModelPart } from './types';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((text: string) => (globalThis as any).__writeStdout?.(`${text}\n`));
function test(name: string, run: () => void): void {
  try { run(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function part(id: string, name: string, groupId?: string, groupName?: string): ModelPart {
  return { id, name, visible: true, color: '#999999', groupId, groupName };
}

test('outliner folders gather non-contiguous parts without changing source rows', () => {
  const parts = [part('a', 'deck', 'g1', 'Bridge deck'), part('b', 'loose'), part('c', 'divider', 'g1', 'Bridge deck')];
  const roots = modelOutlinerRoots(parts);
  assert(roots.length === 2, 'one folder plus one loose root');
  assert(roots[0]?.kind === 'group' && roots[0].group.parts.map((p) => p.id).join(',') === 'a,c', 'folder membership follows ids');
  assert(roots[1]?.kind === 'part' && roots[1].part.id === 'b', 'loose part remains a root');
  assert(parts.map((p) => p.id).join(',') === 'a,b,c', 'source order is never rewritten');
});

test('duplicate names replace legacy copy chains with one numbered family', () => {
  const names = ['Cube', 'Cube copy', 'Cube copy copy', 'Cube (2)', 'Cube (20)'];
  assert(duplicateNameStem('Cube copy copy copy') === 'Cube', 'legacy copy suffixes collapse');
  assert(duplicateNameStem('Cube (20)') === 'Cube', 'number suffix collapses to its family');
  assert(nextDuplicatePartName('Cube copy copy', names) === 'Cube (21)', 'next number follows the family maximum');
  assert(nextDuplicatePartName('Cube', names, 'mirror X') === 'Cube mirror X', 'first mirror has a clean qualifier');
});

test('duplicated folders receive their own collision-free numbered family', () => {
  const grouped = [part('a', 'deck', 'g1', 'Bridge'), part('b', 'rail', 'g2', 'Bridge (2)')];
  assert(nextDuplicateGroupName('Bridge', grouped) === 'Bridge (3)', 'folder copy follows the existing folder family');
  assert(nextDuplicateGroupName('Bridge copy copy', grouped) === 'Bridge (3)', 'legacy folder copy chains normalize too');
});

test('group labels and dissolve semantics are collision-free and non-destructive', () => {
  const grouped = [part('a', 'one', 'g1', 'Group 1'), part('b', 'two', 'g2', 'Group 3')];
  assert(nextModelGroupName(grouped) === 'Group 2', 'fills the first available label');
  const dissolved = withoutPartGroup({ ...grouped[0]!, lo: 4, hi: 9 });
  assert(!dissolved.groupId && !dissolved.groupName, 'membership is removed');
  assert(dissolved.id === 'a' && dissolved.lo === 4 && dissolved.hi === 9, 'geometry identity/range survives');

  const loose = [part('a', 'one'), { ...part('b', 'two'), lo: 10, hi: 12 }, part('c', 'three')];
  const assigned = assignPartsToGroup(loose, ['a', 'b'], 'bridge', 'Bridge pieces');
  assert(assigned[0]?.groupId === 'bridge' && assigned[1]?.groupId === 'bridge' && !assigned[2]?.groupId, 'assignment touches only explicit ids');
  const ungrouped = ungroupParts(assigned, ['b']);
  assert(ungrouped[0]?.groupId === 'bridge' && !ungrouped[1]?.groupId, 'partial ungroup keeps other members');
  assert(ungrouped[1]?.lo === 10 && ungrouped[1]?.hi === 12, 'partial ungroup retains geometry range');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
