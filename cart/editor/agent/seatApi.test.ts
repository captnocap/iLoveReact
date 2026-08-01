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

// req_3588: `add` appends a part by REPLACING the live mesh, which resets the host's
// semantic table. Re-stamping from a post-append read wipes every existing name (the
// faces stay bound to ids that no longer have one) — req_3465's part-range bug, one
// layer up. The table the seat writes back must be grown from the PRE-append capture.
test('adding a primitive keeps every existing name', () => {
  const named: SeatPercept = {
    version: 1, generation: 9, faces: 132, unnamed: 0,
    regions: [{ id: 7, faces: 8, instances: 1, bbox: [0, 0, 0, 1, 1, 1] }],
    table: { version: 1, regions: [{ id: 7, name: 'faceplate.wall' }], nextRegionId: 8 },
  };
  let live = named;
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(live);
  (globalThis as any).__mesh_select_query = () => JSON.stringify({ ok: true, faces: 24 });
  let written: any = null;
  (globalThis as any).__mesh_semantic_assign = (_id: number, _instance: number, table: string) => { written = JSON.parse(table); return 1; };
  const seat = createAgentSeat({
    // The append resets the host table — exactly what the live editor does.
    addPrimitive: () => { live = { ...named, faces: 156, table: { version: 1, regions: [], nextRegionId: 0 } }; return { lo: 66, hi: 84 }; },
  });
  const reply = executeSeatRequest(seat, { action: 'add', args: { kind: 'cylinder', size: 0.26, height: 0.1, sides: 6, name: 'hexDial' } });
  assert(reply.ok, 'add was rejected');
  assert(!!written, 'no semantic table was written back');
  assert(written.regions.some((row: any) => row.name === 'faceplate.wall'), 'the append wiped an existing name');
  assert(written.regions.some((row: any) => row.name === 'hexDial'), 'the new part was not named');
});

test('an unnamed primitive is refused rather than added anonymously', () => {
  let appended = false;
  const seat = createAgentSeat({ addPrimitive: () => { appended = true; return { lo: 0, hi: 1 }; } });
  const reply = executeSeatRequest(seat, { action: 'add', args: { kind: 'cube', name: '' } });
  assert(!reply.ok && !appended, 'an anonymous part reached the mesh');
});

if (failed > 0) throw new Error(`${failed} seat API test(s) failed; ${passed} passed`);
log(`seatApi: ${passed} passed`);
