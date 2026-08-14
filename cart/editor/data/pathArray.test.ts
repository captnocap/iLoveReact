import { appendPathArrayPoint, arcPathArrayPoints, defaultPathArrayParams, linearArrayParams, materializePathArrayRows, sanitizePathArrayParams } from './pathArray';
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
const part = (id: string, name: string, groupId?: string, groupName?: string): ModelPart => ({
  id, name, groupId, groupName, visible: true, color: '#8899aa', lo: Number(id.slice(1)) * 10, hi: Number(id.slice(1)) * 10 + 2,
});

test('a loose source and every generated bay land in one collapsible group', () => {
  const source = { ...part('p1', 'Deck'), sourcePath: '/tmp/source.glb' };
  const result = materializePathArrayRows([source], [source.id], [{ lo: 20, hi: 22 }, { lo: 22, hi: 24 }], 7);
  assert(Boolean(result), 'valid host ranges were rejected');
  assert(result!.parts.every((row) => row.groupId === result!.groupId && row.groupName === 'Deck Path'), 'array rows did not share one folder');
  assert(result!.created.map((row) => row.name).join('|') === 'Deck (2)|Deck (3)', 'duplicate family drifted');
  assert(result!.created.map((row) => `${row.lo}-${row.hi}`).join('|') === '20-22|22-24', 'host range order was lost');
  assert(result!.created.every((row) => !row.sourcePath && !row.mesh), 'generated host geometry retained stale seed/file sources');
});

test('a multi-part grouped bay preserves member order and folder identity', () => {
  const parts = [part('p1', 'Deck', 'bridge', 'Bridge'), part('p2', 'Rail', 'bridge', 'Bridge'), part('p3', 'Loose')];
  const ranges = [{ lo: 40, hi: 42 }, { lo: 42, hi: 44 }, { lo: 44, hi: 46 }, { lo: 46, hi: 48 }];
  const result = materializePathArrayRows(parts, ['p1', 'p2'], ranges, 20);
  assert(Boolean(result), 'group template was rejected');
  assert(result!.groupId === 'bridge' && result!.groupName === 'Bridge', 'existing folder identity was replaced');
  assert(result!.created.map((row) => row.name).join('|') === 'Deck (2)|Rail (2)|Deck (3)|Rail (3)', 'bay-major/member-minor order drifted');
  assert(result!.parts.find((row) => row.id === 'p3')?.groupId === undefined, 'unselected loose row was regrouped');
});

test('range cardinality and numeric parameters are bounded at the cart boundary', () => {
  const source = part('p1', 'Deck');
  assert(materializePathArrayRows([source], ['p1'], [], 1) === null, 'empty host result was accepted');
  assert(materializePathArrayRows([source, part('p2', 'Rail')], ['p1', 'p2'], [{ lo: 9, hi: 10 }], 1) === null, 'partial generated bay was accepted');
  const clean = sanitizePathArrayParams({ ...defaultPathArrayParams(), axis: 9 as any, bays: 999, turnDegrees: Number.NaN, riseU: Number.POSITIVE_INFINITY, profile: 'wat' as any });
  assert(clean.axis === 0 && clean.bays === 64 && clean.turnDegrees === 0 && clean.riseU === 0 && clean.profile === 'eased', 'boundary sanitization drifted');
});

test('linear array is the strict straight preset and names its generated family plainly', () => {
  const params = linearArrayParams(3, 6);
  assert(params.axis === 3 && params.bays === 6, 'linear direction or bay count drifted');
  assert(params.turnDegrees === 0 && params.riseU === 0 && params.profile === 'linear' && !params.points, 'linear preset leaked curved-path state');
  const source = part('p1', 'Picket Bay');
  const result = materializePathArrayRows([source], [source.id], [{ lo: 20, hi: 22 }], 7, 'linear');
  assert(result?.groupName === 'Picket Bay Array', `linear folder was named ${result?.groupName}`);
  assert(result?.created[0]?.id.startsWith('part:array:') === true, 'linear copy retained a path identity');
});

test('arc parameters seed editable authoring-space XYZ boundary points', () => {
  const points = arcPathArrayPoints({ ...defaultPathArrayParams(), axis: 0, bays: 3, turnDegrees: 0, riseU: 2, profile: 'linear' }, 1);
  assert(points.length === 3, 'point count must equal total bays');
  assert(points.map((point) => `${point.xU},${point.yU},${point.zU}`).join('|') === '0,0,0|1,1,0|2,2,0', 'straight XYZ seed drifted');
  const extended = appendPathArrayPoint(points, 0, 1);
  assert(extended[3]?.xU === 3 && extended[3]?.yU === 3, 'new run did not continue the last vector');
  const clean = sanitizePathArrayParams({ ...defaultPathArrayParams(), points: [{ xU: 99, yU: 99, zU: 99 }, { xU: 2, yU: 1, zU: 0 }] });
  assert(clean.bays === 2 && clean.points?.[0]?.xU === 0 && clean.points?.[0]?.yU === 0, 'point zero must stay pinned to the source end');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
