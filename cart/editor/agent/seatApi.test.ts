// Run:
//   tools/esbuild cart/editor/agent/seatApi.test.ts --bundle --outfile=/tmp/editor-seat-api.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-seat-api.test.js
import { compileSeatSelector, createAgentSeat, executeSeatRequest, type SeatPercept } from './seatApi';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

const percept: SeatPercept = {
  version: 1, generation: 4, faces: 60, unnamed: 0,
  regions: [{ id: 7, faces: 16, instances: 4, bbox: [0, 0, 0, 1, 2, 1] }],
  table: { version: 1, regions: [{ id: 7, name: 'window.rim' }], nextRegionId: 8 },
};
(globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);

test('cold agent resolves a durable name without geometry archaeology', () => {
  const query = compileSeatSelector('window.rim', percept);
  assert(query?.kind === 'region' && query.region === 7, 'name did not resolve to its durable region id');
});

test('geometric selectors compile to native query arguments', () => {
  const query = compileSeatSelector('facing:+y@30', percept);
  assert(query?.kind === 'facing' && query.axis === 1 && query.sign === 1 && query.tolerance_degrees === 30, 'facing selector changed meaning');
});

test('named extrude declares cap and wall roles before topology runs', () => {
  let staged: any[] | null = null;
  (globalThis as any).__mesh_semantic_extrude_intent = (...args: any[]) => { staged = args; return 1; };
  (globalThis as any).__mesh_topo_extrude_face = () => JSON.stringify({ ok: 1, key: 'doc', count: 180, generation: 5 });
  const seat = createAgentSeat();
  const reply = executeSeatRequest(seat, { action: 'extrude', args: { distance: 0.2, name: 'window' } });
  assert(reply.ok, 'named extrude was rejected');
  assert(!!staged, 'semantic intent was not staged');
  const table = JSON.parse(staged![3]);
  assert(table.regions.some((row: any) => row.name === 'window.cap'), 'cap role missing');
  assert(table.regions.some((row: any) => row.name === 'window.wall'), 'wall role missing');
});

test('anonymous growth is blocked after the naming-debt budget', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify({ ...percept, unnamed: 9 });
  let called = false;
  (globalThis as any).__mesh_topo_extrude_face = () => { called = true; return JSON.stringify({ ok: 1 }); };
  const seat = createAgentSeat({ namingDebtBudget: 8 });
  const reply = executeSeatRequest(seat, { action: 'extrude', args: { distance: 0.2, name: '_' } });
  assert(!reply.ok && !called, 'anonymous complexity escaped the hard debt gate');
});

if (failed > 0) throw new Error(`${failed} seat API test(s) failed; ${passed} passed`);
log(`seatApi: ${passed} passed`);
