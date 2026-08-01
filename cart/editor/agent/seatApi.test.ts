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

test('element inspection makes ephemeral edge and vertex indices discoverable', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  (globalThis as any).__mesh_edit_elements = () => JSON.stringify({
    vertices: [{ id: 2, at: [0, 1, 0] }], edges: [{ id: 4, vertices: [2, 3] }],
  });
  let vertexArgs: unknown[] = [];
  let edgeArgs: unknown[] = [];
  (globalThis as any).__mesh_edit_select_vertex = (...args: unknown[]) => { vertexArgs = args; return 1; };
  (globalThis as any).__mesh_edit_select_edge = (...args: unknown[]) => { edgeArgs = args; return 1; };
  const seat = createAgentSeat();
  assert(executeSeatRequest(seat, { action: 'elements' }).ok, 'element vocabulary was unavailable');
  assert(executeSeatRequest(seat, { action: 'select-vertex', args: { index: 2, additive: true } }).ok, 'vertex selection failed');
  assert(executeSeatRequest(seat, { action: 'select-edge', args: { index: 4 } }).ok, 'edge selection failed');
  assert(vertexArgs[0] === 2 && vertexArgs[1] === 1, 'vertex selection arguments drifted');
  assert(edgeArgs[0] === 4 && edgeArgs[1] === 0, 'edge selection arguments drifted');
});

test('bevel is one captured native session and cancels a rejected preview', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  let ended = -1;
  (globalThis as any).__mesh_bevel_begin = () => JSON.stringify({ ok: 1, kind: 'edge' });
  (globalThis as any).__mesh_bevel_preview = () => JSON.stringify({ ok: 0 });
  (globalThis as any).__mesh_bevel_end = (commit: number) => { ended = commit; return JSON.stringify({ ok: 1 }); };
  const seat = createAgentSeat();
  assert(!executeSeatRequest(seat, { action: 'bevel', args: { width: 0.02 } }).ok, 'failed bevel preview committed');
  assert(ended === 0, 'failed bevel preview left the editor modal');
  (globalThis as any).__mesh_bevel_preview = () => JSON.stringify({ ok: 1, key: 'preview', count: 36 });
  (globalThis as any).__mesh_bevel_end = (commit: number) => { ended = commit; return JSON.stringify({ ok: 1, key: 'doc', count: 36 }); };
  assert(executeSeatRequest(seat, { action: 'bevel', args: { width: 0.02 } }).ok && ended === 1, 'valid bevel did not commit atomically');
});

test('resident destructive and constructive topology doors are reachable', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  const topologyOk = () => JSON.stringify({ ok: 1, key: 'doc', count: 60, generation: 5 });
  for (const door of [
    '__mesh_topo_extrude_edge', '__mesh_topo_connect_vertices', '__mesh_delete_selection',
    '__mesh_topo_merge_faces', '__mesh_topo_weld', '__mesh_topo_solidify',
    '__mesh_topo_flip_faces', '__mesh_topo_glass',
  ]) (globalThis as any)[door] = topologyOk;
  const sources: number[] = [];
  (globalThis as any).__mesh_action_source = (source: number) => { sources.push(source); };
  const seat = createAgentSeat();
  for (const request of [
    { action: 'extrude-edge', args: { distance: 0.1 } }, { action: 'connect' },
    { action: 'delete' }, { action: 'merge-faces' }, { action: 'weld' },
    { action: 'solidify', args: { thickness: 0.03 } }, { action: 'flip' }, { action: 'glass' },
  ]) assert(executeSeatRequest(seat, request).ok, `${request.action} stayed unreachable`);
  assert(sources.includes(9) && sources[sources.length - 1] === 0, 'seat mutations were not attributed to automation');
  delete (globalThis as any).__mesh_action_source;
});

test('inset packages the proven hairline extrude and two-axis shrink recipe', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  (globalThis as any).__mesh_semantic_extrude_intent = () => 1;
  (globalThis as any).__mesh_topo_extrude_face = () => JSON.stringify({ ok: 1, key: 'doc', count: 68, generation: 5 });
  const transforms: unknown[][] = [];
  (globalThis as any).__mesh_transform_scale_axis = (...args: unknown[]) => { transforms.push(args); return 1; };
  (globalThis as any).__mesh_transform_translate = (...args: unknown[]) => { transforms.push(args); return 1; };
  const seat = createAgentSeat();
  const reply = executeSeatRequest(seat, { action: 'inset', args: {
    distance: 0.001, name: 'panel', pivot: [0, 0.5, 0],
    axes: [[1, 0, 0], [0, 0, 1]], factors: [0.5, 0.25], offset: [0, 0.1, 0],
  } });
  assert(reply.ok && transforms.length === 3, 'inset did not execute its declared compound recipe');
});

test('inset reports the exact rejected stage instead of hiding it behind rollback', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  (globalThis as any).__mesh_semantic_extrude_intent = () => 1;
  (globalThis as any).__mesh_topo_extrude_face = () => JSON.stringify({ ok: 0 });
  const seat = createAgentSeat();
  const reply = executeSeatRequest(seat, { action: 'inset', args: {
    distance: 0.001, name: 'panel', pivot: [0, 0.5, 0],
    axes: [[1, 0, 0], [0, 0, 1]], factors: [0.5, 0.25],
  } });
  assert(!reply.ok && reply.reason?.startsWith('extrude:'), 'inset did not identify its rejected extrude stage');
});

test('paint, material, UV, detach, and cold save use their authoritative boundaries', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  (globalThis as any).__model_paint_selection = () => 4;
  (globalThis as any).__model_atlas_base = () => 1;
  (globalThis as any).__model_set_paint_detail = () => 16;
  (globalThis as any).__mesh_texture_slot_assign = () => 4;
  (globalThis as any).__model_uv_selection_read = () => JSON.stringify({ islands: [1, 3], faces: [2, 4] });
  let uvIslands: number[] = [];
  (globalThis as any).__model_uv_auto_size = (values: Uint32Array) => { uvIslands = Array.from(values); return 1; };
  let persisted = false;
  const seat = createAgentSeat({
    detachSelection: (name) => name === 'roof' ? { lo: 8, hi: 12 } : null,
    persist: () => { persisted = true; return true; },
  });
  assert(executeSeatRequest(seat, { action: 'paint', args: { rgb: [10, 20, 30] } }).ok, 'selection paint stayed unreachable');
  assert(executeSeatRequest(seat, { action: 'atlas', args: { base: 'solid', rgb: [10, 20, 30], detail: 16 } }).ok, 'atlas remake stayed unreachable');
  assert(executeSeatRequest(seat, { action: 'material', args: { slot: 2 } }).ok, 'material role stayed unreachable');
  assert(executeSeatRequest(seat, { action: 'uv', args: { operation: 'auto-size' } }).ok, 'UV auto-size stayed unreachable');
  assert(uvIslands.join(',') === '1,3', 'UV operation ignored the selected islands');
  assert(executeSeatRequest(seat, { action: 'detach', args: { name: 'roof' } }).ok, 'shell-owned detach stayed unreachable');
  assert(executeSeatRequest(seat, { action: 'save' }).ok && persisted, 'save did not cross the package persistence boundary');
});

if (failed > 0) throw new Error(`${failed} seat API test(s) failed; ${passed} passed`);
log(`seatApi: ${passed} passed`);
