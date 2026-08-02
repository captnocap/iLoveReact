// Run:
//   tools/esbuild cart/editor/agent/seatApi.test.ts --bundle --outfile=/tmp/editor-seat-api.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-seat-api.test.js
import { compactSeatReply, compileSeatSelector, createAgentSeat, executeSeatRequest, orbitPoseByDegrees, seatBatchGenerationReason, type SeatPartPercept, type SeatPercept, type SeatPrimitiveSpec } from './seatApi';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

const percept: SeatPercept = {
  version: 1, generation: 4, faces: 60, unnamed: 0,
  activePartId: null, parts: [],
  regions: [{ id: 7, faces: 16, instances: 4, bbox: [0, 0, 0, 1, 2, 1] }],
  table: { version: 1, regions: [{ id: 7, name: 'window.rim' }], nextRegionId: 8 },
};
(globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);

test('cold agent resolves a durable name without geometry archaeology', () => {
  const query = compileSeatSelector('window.rim', percept);
  assert(query?.kind === 'region' && query.region === 7, 'name did not resolve to its durable region id');
});

test('geometric keywords cannot be shadowed by saved region names', () => {
  const shadowed: SeatPercept = {
    ...percept,
    table: { version: 1, regions: [{ id: 2, name: 'top' }], nextRegionId: 3 },
  };
  const top = compileSeatSelector('top', shadowed);
  const explicitTop = compileSeatSelector('extremal:top', shadowed);
  const namedTop = compileSeatSelector('region:top', shadowed);
  assert(top?.kind === 'extremal' && top.axis === 1 && top.sign === 1, 'saved name stole the top keyword');
  assert(explicitTop?.kind === 'extremal', 'explicit extremal namespace did not compile');
  assert(namedTop?.kind === 'region' && namedTop.region === 2, 'explicit region namespace did not reach the saved name');
});

test('face ranges have their own namespace and part remains reserved for Outliner ids', () => {
  const faces = compileSeatSelector('faces:12..18', percept);
  assert(faces?.kind === 'part' && faces.lo === 12 && faces.hi === 18, 'face range did not compile');
  assert(compileSeatSelector('part:12..18', percept) === null, 'legacy part range remained ambiguous');
});

test('brief replies keep row outcomes but strip repeated percepts', () => {
  const row = { ok: true, op: 'select', result: { faces: 2 }, percept };
  const compact = compactSeatReply({ ok: true, op: 'batch', result: [row, row], percept });
  assert(compact.brief.includes('60 faces'), 'brief formatter was not used');
  assert(!(compact.result as any[])[0].percept, 'batch row percept survived compact transport');
});

test('per-row generation guard closes a batch after a human topology edit', () => {
  assert(seatBatchGenerationReason(4, 4, 2) === null, 'matching generation was rejected');
  assert(seatBatchGenerationReason(4, 5, 2)?.includes('row 3'), 'external generation bump did not close the next row');
});

test('Follow pairs native Delete Faces and Create Face into one demonstrated strip lesson', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  const patch = (group: number) => ({
    version: 1, rings: 2, selectedTriangles: [4, 5], selectedGroups: [group],
    vertices: [
      { id: 10, at: [0, 0, 0] }, { id: 11, at: [1, 0, 0] },
      { id: 12, at: [1, 1, 0] }, { id: 13, at: [0, 1, 0] },
    ],
    triangles: [
      { id: 4, selected: true, group, part: 0, material: 2, region: 7, instance: 0, vertices: [10, 11, 12] },
      { id: 5, selected: true, group, part: 0, material: 2, region: 7, instance: 0, vertices: [10, 12, 13] },
      { id: 6, selected: false, group: 90, part: 0, material: 2, region: 7, instance: 0, vertices: [11, 14, 12] },
    ],
    frontier: [{ vertices: [11, 12], inside: 4, outside: 6, nonManifold: false }],
  });
  const edges = {
    version: 1,
    selectedEdges: [
      { id: 8, vertices: [10, 11], at: [[0, 0, 0], [1, 0, 0]], boundary: true },
      { id: 9, vertices: [13, 12], at: [[0, 1, 0], [1, 1, 0]], boundary: true },
    ],
    patch: patch(90),
  };
  let nativeEvents: any[] = [];
  (globalThis as any).__mesh_follow_action_drain = () => {
    const events = nativeEvents;
    nativeEvents = [];
    return JSON.stringify({ version: 1, events });
  };
  let stored: any = null;
  const seat = createAgentSeat({ followState: { read: () => stored, write: (value) => { stored = value; } } });

  const started = executeSeatRequest(seat, { action: 'follow', args: { operation: 'start', label: 'torso strips' } });
  assert(started.ok && stored?.active === true, 'Follow did not enter its real recording state');
  nativeEvents.push(
    { kind: 5, source: 9, before: patch(20), after: { version: 1, deleted: true } },
    { kind: 2, source: 9, before: edges, after: patch(21) },
    { kind: 5, source: 2, before: patch(31), after: { version: 1, deleted: true } },
    { kind: 2, source: 2, before: edges, after: patch(77) },
  );

  const read = executeSeatRequest(seat, { action: 'follow', args: { operation: 'read' } });
  const session = read.result as any;
  assert(read.ok && session.examples.length === 1, 'Follow transcript did not report the demonstrated delete/create pair');
  assert(session.examples[0].delete.before.selectedGroups[0] === 31 && session.examples[0].create.after.selectedGroups[0] === 77,
    'Follow did not pair the exact delete and replacement-face observations');
  assert(session.examples[0].create.before.selectedEdges.length === 2, 'Follow dropped the two demonstrated bridge edges');
  assert(session.examples[0].create.after.frontier[0].outside === 6, 'Follow dropped the adjacent continuation candidate');

  const stopped = executeSeatRequest(seat, { action: 'follow', args: { operation: 'stop' } });
  assert(stopped.ok && (stopped.result as any).active === false, 'Follow transcript did not close cleanly');
});

test('camera orbit uses explicit degrees instead of undocumented pixel calibration', () => {
  const pose = orbitPoseByDegrees([0, 0, 3, 1, 2, 3], 90, -45);
  assert(!!pose && Math.abs(pose[0]! - Math.PI / 2) < 1e-9 && Math.abs(pose[1]! + Math.PI / 4) < 1e-9, 'degree orbit did not convert exactly');
  assert(pose?.slice(2).join(',') === '3,1,2,3', 'degree orbit moved the frame target');
});

test('look joins durable outliner parts to the resident semantic percept', () => {
  const partPercept: SeatPartPercept = {
    activePartId: 'part:body',
    parts: [{
      id: 'part:body', name: 'Radio Body', kind: 'cube', visible: true,
      lo: 0, hi: 6, groupPath: [{ id: 'group:shell', name: 'Shell' }],
    }],
  };
  const reply = executeSeatRequest(createAgentSeat({ partPercept: () => partPercept }), { action: 'look' });
  assert(reply.ok && reply.percept?.activePartId === 'part:body', 'active part scope was omitted');
  assert(reply.percept?.parts[0]?.name === 'Radio Body' && reply.percept.parts[0]?.lo === 0, 'named part range was omitted');
  assert(reply.percept?.parts[0]?.groupPath[0]?.name === 'Shell', 'outliner hierarchy was omitted');
});

test('semantic-status exposes the same resident-vs-mount diagnosis as Model Focus', () => {
  const diagnostics = {
    status: 'load-mismatch', savedFaces: 28, savedNamedFaces: 28, savedRegions: 10,
    residentFaces: 28, residentNamedFaces: 0, residentRegions: 0, residentUnnamed: 28, rows: [],
  };
  (globalThis as any).__modelSemanticDiagnostics = diagnostics;
  const reply = executeSeatRequest(createAgentSeat(), { action: 'semantic-status' });
  assert(reply.ok && reply.result === diagnostics, 'CLI and GUI semantic diagnosis diverged');
});

test('geometric selectors compile to native query arguments', () => {
  const query = compileSeatSelector('facing:+y@30', percept);
  assert(query?.kind === 'facing' && query.axis === 1 && query.sign === 1 && query.tolerance_degrees === 30, 'facing selector changed meaning');
});

test('compound region and facing selectors include the named descendant family', () => {
  const nested: SeatPercept = {
    ...percept,
    table: { version: 1, regions: [
      { id: 10, name: 'hood', role: 'part' },
      { id: 11, name: 'hood.cap.top', role: '+y', parent: 10 },
      { id: 12, name: 'hood.wall', role: 'wall', parent: 10 },
    ] },
  };
  const query = compileSeatSelector('region:hood & facing:+y', nested);
  assert(query?.kind === 'region_facing' && (query.regions as number[]).join(',') === '10,11,12', 'compound selector lost the region family');
});

test('select all expands native scope to every visible part before selecting', () => {
  const multipart: SeatPercept = {
    ...percept, activePartId: 'body', parts: [
      { id: 'body', name: 'Body', kind: 'cube', visible: true, lo: 0, hi: 6, groupPath: [] },
      { id: 'hood', name: 'Hood', kind: 'cylinder', visible: true, lo: 6, hi: 18, groupPath: [] },
    ],
  };
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(multipart);
  (globalThis as any).__mesh_select_query = () => JSON.stringify({ ok: true, faces: 60, actionableFaces: 60, bbox: [0, 0, 0, 1, 1, 1] });
  let selectedIds: string[] = [];
  const seat = createAgentSeat({
    partPercept: () => ({ activePartId: multipart.activePartId, parts: multipart.parts }),
    shellAction: (action, args) => { if (action === 'part-select') selectedIds = args.ids as string[]; return { ok: true }; },
  });
  const reply = executeSeatRequest(seat, { action: 'select', args: { selector: 'all' } });
  assert(reply.ok && selectedIds.join(',') === 'body,hood', 'select all remained clipped to the active part');
});

test('a selector that resolves beyond active scope is rejected instead of partially succeeding', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  (globalThis as any).__mesh_select_query = () => JSON.stringify({ ok: true, faces: 12, actionableFaces: 2, bbox: [0, 0, 0, 1, 1, 1] });
  let cleared = false;
  (globalThis as any).__mesh_edit_clear = () => { cleared = true; };
  const reply = executeSeatRequest(createAgentSeat(), { action: 'select', args: { selector: 'all' } });
  assert(!reply.ok && cleared && reply.reason?.includes('permits 2'), 'silent partial selection escaped the scope guard');
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
    activePartId: null, parts: [],
    regions: [{ id: 7, faces: 8, instances: 1, bbox: [0, 0, 0, 1, 1, 1] }],
    table: { version: 1, regions: [{ id: 7, name: 'faceplate.wall' }], nextRegionId: 8 },
  };
  let live = named;
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(live);
  (globalThis as any).__mesh_select_query = () => JSON.stringify({ ok: true, faces: 24 });
  let written: any = null;
  let roleIds: number[] = [];
  (globalThis as any).__mesh_semantic_name_primitive = (_lo: number, _hi: number, kind: string, ids: Uint32Array, table: string) => {
    written = JSON.parse(table); roleIds = Array.from(ids); return kind === 'cylinder' ? 1 : 0;
  };
  const seat = createAgentSeat({
    // The append resets the host table — exactly what the live editor does.
    addPrimitive: () => { live = { ...named, faces: 156, table: { version: 1, regions: [], nextRegionId: 0 } }; return { lo: 66, hi: 84 }; },
  });
  const reply = executeSeatRequest(seat, { action: 'add', args: { kind: 'cylinder', size: 0.26, height: 0.1, sides: 6, name: 'hexDial' } });
  assert(reply.ok, 'add was rejected');
  assert(!!written, 'no semantic table was written back');
  assert(written.regions.some((row: any) => row.name === 'faceplate.wall'), 'the append wiped an existing name');
  assert(written.regions.some((row: any) => row.name === 'hexDial'), 'the new part root was not named');
  assert(written.regions.some((row: any) => row.name === 'hexDial.cap.top'), 'the primitive top cap was not born named');
  assert(written.regions.some((row: any) => row.name === 'hexDial.cap.bottom'), 'the primitive bottom cap was not born named');
  assert(written.regions.some((row: any) => row.name === 'hexDial.wall') && roleIds.length === 3, 'the primitive wall role was not born named');
});

test('an unnamed primitive is refused rather than added anonymously', () => {
  let appended = false;
  const seat = createAgentSeat({ addPrimitive: () => { appended = true; return { lo: 0, hi: 1 }; } });
  const reply = executeSeatRequest(seat, { action: 'add', args: { kind: 'cube', name: '' } });
  assert(!reply.ok && !appended, 'an anonymous part reached the mesh');
});

test('new routes through the shell document constructor instead of replacing the host mesh', () => {
  let created: SeatPrimitiveSpec | null = null;
  const seat = createAgentSeat({ newPrimitive: (spec) => { created = spec; return true; } });
  const reply = executeSeatRequest(seat, { action: 'new', args: { kind: 'cube', size: 1, height: 1, sides: 4 } });
  assert(reply.ok && created?.kind === 'cube', 'new model did not reach the shell boundary');
});

test('element inspection makes ephemeral edge and vertex indices discoverable', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  (globalThis as any).__mesh_edit_elements = () => JSON.stringify({
    vertices: [{ id: 2, at: [0, 1, 0] }], edges: [{ id: 4, vertices: [2, 3] }],
  });
  let vertexArgs: unknown[] = [];
  let edgeArgs: unknown[] = [];
  let faceArgs: unknown[] = [];
  (globalThis as any).__mesh_edit_select_vertex = (...args: unknown[]) => { vertexArgs = args; return 1; };
  (globalThis as any).__mesh_edit_select_edge = (...args: unknown[]) => { edgeArgs = args; return 1; };
  (globalThis as any).__mesh_edit_select_face = (...args: unknown[]) => { faceArgs = args; return 1; };
  const seat = createAgentSeat();
  assert(executeSeatRequest(seat, { action: 'elements' }).ok, 'element vocabulary was unavailable');
  assert(executeSeatRequest(seat, { action: 'select-vertex', args: { index: 2, additive: true } }).ok, 'vertex selection failed');
  assert(executeSeatRequest(seat, { action: 'select-edge', args: { index: 4 } }).ok, 'edge selection failed');
  assert(executeSeatRequest(seat, { action: 'select-face', args: { index: 7, additive: true } }).ok, 'face selection failed');
  assert(vertexArgs[0] === 2 && vertexArgs[1] === 1, 'vertex selection arguments drifted');
  assert(edgeArgs[0] === 4 && edgeArgs[1] === 0, 'edge selection arguments drifted');
  assert(faceArgs[0] === 7 && faceArgs[1] === 1, 'face selection arguments drifted');
  assert(executeSeatRequest(seat, { action: 'select-elements', args: { kind: 'vertex', indices: [2, 3] } }).ok, 'multi-element selection failed');
  assert(vertexArgs[0] === 3 && vertexArgs[1] === 1, 'multi-element selection did not add subsequent indices');
});

test('basic cut and triangle conversion use their native topology sessions', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  let basic = -1;
  (globalThis as any).__mesh_lc_begin = (kind: number) => { basic = kind; return JSON.stringify({ ok: 1 }); };
  (globalThis as any).__mesh_lc_preview = () => JSON.stringify({ ok: 1 });
  (globalThis as any).__mesh_lc_end = () => JSON.stringify({ ok: 1, key: 'doc', count: 64, generation: 5 });
  (globalThis as any).__mesh_topo_tris_to_quads = () => JSON.stringify({ ok: 1, key: 'doc', count: 58, generation: 6 });
  const seat = createAgentSeat();
  assert(executeSeatRequest(seat, { action: 'basic-cut', args: { direction: 1, cuts: 2, offset: 0.4 } }).ok && basic === 1, 'basic cut did not select the basic-cut session');
  assert(executeSeatRequest(seat, { action: 'tris-to-quads' }).ok, 'triangle conversion stayed unreachable');
});

test('uniform scale uses the same selection-pivot operation as the visible Scale By tool', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  let factor = 0;
  (globalThis as any).__mesh_gizmo_scale_by = (value: number) => { factor = value; return 1; };
  const reply = executeSeatRequest(createAgentSeat(), { action: 'scale-uniform', args: { factor: 1.25 } });
  assert(reply.ok && factor === 1.25, 'uniform scale did not reach the resident selection-pivot door');
});

test('axis scale preserves sub-centimetre factors exactly at the seat boundary', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  let factor = 0;
  (globalThis as any).__mesh_transform_scale_axis = (...values: number[]) => { factor = values[6]!; return 1; };
  const reply = executeSeatRequest(createAgentSeat(), { action: 'scale', args: { axis: [1, 0, 0], pivot: [0, 0, 0], factor: 0.018 } });
  assert(reply.ok && factor === 0.018, 'seat rounded 0.018 before the native exact-scale door');
});

test('shell-owned modeling tools delegate through one bounded authority', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  const calls: { action: string; args: Record<string, unknown> }[] = [];
  const seat = createAgentSeat({ shellAction: (action, args) => { calls.push({ action, args }); return { ok: true, result: { accepted: action } }; } });
  const reply = executeSeatRequest(seat, { action: 'viewport', args: { operation: 'pose', pose: [0, 0, 2, 0, 0, 0] } });
  assert(reply.ok && calls.length === 1 && calls[0]!.action === 'viewport', 'shell action bypassed or failed to delegate');
  assert((reply.result as any).accepted === 'viewport', 'shell receipt was not preserved');
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
  (globalThis as any).__model_atlas_read = () => JSON.stringify({ w: 512, h: 512, detail: 256, islands: [0, 0, 32, 32, 32, 0, 16, 24] });
  (globalThis as any).__model_atlas_base = () => 1;
  (globalThis as any).__model_set_paint_detail = () => 16;
  let appliedFit = 0;
  (globalThis as any).__model_set_paint_fit = (texels: number) => { appliedFit = texels; return 1686; };
  (globalThis as any).__model_paint_fit_estimate = () => JSON.stringify({ w: 798, h: 1060, density: 1686 });
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
  assert(appliedFit === 0, 'an explicit texels/meter detail was rerouted through the atlas budget');
  // Naming no resolution must take the painter's 1024² budget rather than inheriting whatever
  // density is live: a small prop left on a low density paints into a handful of pixels and
  // reads as unpainted while every other signal reports success.
  const defaulted = executeSeatRequest(seat, { action: 'atlas', args: { base: 'solid', rgb: [10, 20, 30] } });
  const sheet = defaulted.result as { density: number; fit: number; w: number; h: number };
  assert(defaulted.ok && appliedFit === 1024, `atlas without a resolution did not take the 1024 budget (fit=${appliedFit})`);
  assert(sheet.density === 1686 && sheet.w === 798 && sheet.h === 1060, 'atlas did not report the sheet it actually built');
  assert(!executeSeatRequest(seat, { action: 'atlas', args: { base: 'solid', rgb: [10, 20, 30], fit: 900 } }).ok, 'a non-budget fit was accepted');
  assert(executeSeatRequest(seat, { action: 'material', args: { slot: 2 } }).ok, 'material role stayed unreachable');
  assert(executeSeatRequest(seat, { action: 'uv', args: { operation: 'auto-size' } }).ok, 'UV auto-size stayed unreachable');
  assert(uvIslands.join(',') === '1,3', 'UV operation ignored the selected islands');
  assert(executeSeatRequest(seat, { action: 'detach', args: { name: 'roof' } }).ok, 'shell-owned detach stayed unreachable');
  assert(executeSeatRequest(seat, { action: 'save' }).ok && persisted, 'save did not cross the package persistence boundary');
});

test('paint rejects an atlas whose islands filter into invisibility and recommends a budget', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  (globalThis as any).__model_atlas_read = () => JSON.stringify({ w: 25, h: 26, detail: 16, islands: [0, 0, 6, 4, 6, 0, 5, 6] });
  let painted = false;
  (globalThis as any).__model_paint_selection = () => { painted = true; return 4; };
  const reply = executeSeatRequest(createAgentSeat(), { action: 'paint', args: { rgb: [10, 20, 30] } });
  assert(!reply.ok && !painted, 'invisible paint still reported success');
  assert(reply.reason?.includes('rebuild with atlas fit='), 'paint rejection omitted the actionable atlas recommendation');
});

test('save is a zero-debt durable boundary', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify({ ...percept, unnamed: 2 });
  let persisted = false;
  const reply = executeSeatRequest(createAgentSeat({ persist: () => { persisted = true; return true; } }), { action: 'save' });
  assert(!reply.ok && !persisted, 'save persisted unnamed faces');
  assert(reply.reason?.includes('zero naming debt'), 'save did not explain the durable-boundary invariant');
});

test('dial is a callable candidate recipe that seats a resident cylinder on a target face', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  (globalThis as any).__mesh_select_query = () => JSON.stringify({ ok: true, faces: 2, bbox: [1, 2, 3, 1, 4, 5] });
  (globalThis as any).__mesh_semantic_name_primitive = () => 1;
  const rotations: number[][] = [];
  const moves: number[][] = [];
  (globalThis as any).__mesh_transform_rotate_axis = (...values: number[]) => { rotations.push(values); return 1; };
  (globalThis as any).__mesh_transform_translate = (...values: number[]) => { moves.push(values); return 1; };
  let added: SeatPrimitiveSpec | null = null;
  const seat = createAgentSeat({ addPrimitive: (spec) => { added = spec; return { lo: 20, hi: 44 }; } });
  const reply = executeSeatRequest(seat, { action: 'recipe', args: {
    recipe: 'dial', params: { name: 'tuner', target: 'region:window.rim', normal: '+x', diameter: 0.26, depth: 0.1, sides: 24 },
  } });
  assert(reply.ok && (reply.result as any).status === 'candidate', 'dial recipe was unavailable or prematurely approved');
  assert(added?.kind === 'cylinder' && added.size === 0.26, 'dial did not use the resident cylinder generator');
  assert(rotations.length === 1 && rotations[0]![6] < 0, 'dial did not orient +Y to +X');
  assert(moves.length === 1 && moves[0]!.join(',') === '1,3,4', 'dial base was not seated at the target bbox center');
});

if (failed > 0) throw new Error(`${failed} seat API test(s) failed; ${passed} passed`);
log(`seatApi: ${passed} passed`);
