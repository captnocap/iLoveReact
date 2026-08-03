// Run:
//   tools/esbuild cart/editor/agent/seatApi.test.ts --bundle --outfile=/tmp/editor-seat-api.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-seat-api.test.js
import { compactSeatReply, compileSeatSelector, createAgentSeat, executeSeatRequest, executeSeatRequestAtShell, formatGeometryFacts, formatSeatPercept, orbitPoseByDegrees, retopoRailPairsFromPatch, seatBatchGenerationReason, type SeatBoundaryContinuation, type SeatFollowPatch, type SeatPartPercept, type SeatPercept, type SeatPrimitiveSpec } from './seatApi';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

const percept: SeatPercept = {
  version: 1, generation: 4, faces: 60, authoredFaces: 30, islands: 0, footprints: 0, unnamed: 0,
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
  assert(compact.brief.includes('30 authored faces · 60 triangles'), 'brief formatter was not used');
  assert(!(compact.result as any[])[0].percept, 'batch row percept survived compact transport');
});

test('percept and brief distinguish logical UV islands from paint footprints', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  (globalThis as any).__model_atlas_read = () => JSON.stringify({ islands: [0, 0, 8, 8, 0, 0, 8, 8, 8, 0, 4, 4, 12, 0, 2, 2] });
  const reply = executeSeatRequest(createAgentSeat(), { action: 'look' });
  assert(reply.percept?.islands === 4, 'percept discarded the logical atlas island count');
  assert(reply.percept?.footprints === 3, 'percept failed to collapse stacked texture footprints');
  assert(compactSeatReply(reply).brief.includes('3 paint footprints · 4 logical UV islands'), 'brief output conflated topology with paint cost');
});

test('shell Seat bootstraps the first model without a mounted ModelView', () => {
  let created: SeatPrimitiveSpec | null = null;
  const bootstrap = { newPrimitive: (spec: SeatPrimitiveSpec) => { created = spec; return true; } };
  const empty = executeSeatRequestAtShell(null, { action: 'look' }, bootstrap);
  assert(empty.ok && empty.percept === null && (empty.result as any).state === 'no-live-model',
    'model-less look did not return a bounded shell state');
  const made = executeSeatRequestAtShell(null, {
    action: 'new', args: { kind: 'cube', size: 2, height: 3, sides: 8 },
  }, bootstrap);
  assert(made.ok && created?.kind === 'cube' && created.size === 2 && created.height === 3 && created.sides === 8,
    'shell Seat could not create the first real model');
  const rejected = executeSeatRequestAtShell(null, { action: 'extrude', args: { distance: 1 } }, bootstrap);
  assert(!rejected.ok && rejected.reason?.includes('no live model'),
    'mesh action did not explain the missing model at the shell boundary');
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
  assert(read.ok && session.events.length === 4 && session.events.map((event: any) => event.kind).join(',') === '5,2,5,2',
    'Follow did not retain the complete native event firehose in order');
  assert(session.events[0].source === 'automation' && session.events[1].before.selectedEdges.length === 2,
    'Follow raw events filtered a source or discarded its exact payload');
  assert(read.ok && session.examples.length === 1, 'Follow transcript did not report the demonstrated delete/create pair');
  assert(session.examples[0].delete.before.selectedGroups[0] === 31 && session.examples[0].create.after.selectedGroups[0] === 77,
    'Follow did not pair the exact delete and replacement-face observations');
  assert(session.examples[0].create.before.selectedEdges.length === 2, 'Follow dropped the two demonstrated bridge edges');
  assert(session.examples[0].create.after.frontier[0].outside === 6, 'Follow dropped the adjacent continuation candidate');

  const stopped = executeSeatRequest(seat, { action: 'follow', args: { operation: 'stop' } });
  assert(stopped.ok && (stopped.result as any).active === false, 'Follow transcript did not close cleanly');
});

test('Follow retains edits that do not fit the delete-create recipe', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  let nativeEvents: any[] = [];
  (globalThis as any).__mesh_follow_action_drain = () => {
    const events = nativeEvents;
    nativeEvents = [];
    return JSON.stringify({ version: 1, events });
  };
  let stored: any = null;
  const seat = createAgentSeat({ followState: { read: () => stored, write: (value) => { stored = value; } } });
  assert(executeSeatRequest(seat, { action: 'follow', args: { operation: 'start' } }).ok, 'Follow did not start');
  nativeEvents.push(
    { kind: 20, source: 0, before: { stream: 'journal', label: 'transform', x: 1 }, after: { x: 2 } },
    { kind: 255, source: 0, before: { stream: 'journal', label: 'weld', x: 2 }, after: { x: 3 } },
    { kind: 2, source: 0, before: { version: 1, selectedEdges: [] }, after: { version: 1, selectedTriangles: [] } },
    { kind: 5, source: 0, before: { version: 1, selectedTriangles: [9], frontier: [] }, after: { deleted: true } },
  );
  const read = executeSeatRequest(seat, { action: 'follow', args: { operation: 'read' } });
  const session = read.result as any;
  assert(read.ok && session.events.length === 4, 'Follow dropped an event that did not fit its derived recipe');
  assert(session.events[0].before.label === 'transform' && session.events[1].kind === 255 &&
    session.events[1].before.label === 'weld' && session.events[2].kind === 2 && session.events[3].kind === 5,
    'Follow raw event order or payload drifted');
  assert(session.examples.length === 0 && session.pendingDelete.before.selectedTriangles[0] === 9,
    'Derived examples stopped being an optional view over the raw transcript');
});

test('Follow pages the retained firehose without truncating the transport', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  let nativeEvents = Array.from({ length: 19 }, (_, index) => ({
    kind: 20, source: 0,
    before: { stream: 'journal', actionId: index + 1 },
    after: { accepted: true, actionId: index + 1 },
  }));
  (globalThis as any).__mesh_follow_action_drain = () => {
    const events = nativeEvents;
    nativeEvents = [];
    return JSON.stringify({ version: 1, events });
  };
  let stored: any = null;
  const seat = createAgentSeat({ followState: { read: () => stored, write: (value) => { stored = value; } } });
  assert(executeSeatRequest(seat, { action: 'follow', args: { operation: 'start' } }).ok, 'Follow did not start');
  // Start intentionally clears pre-session native residue.
  nativeEvents = Array.from({ length: 19 }, (_, index) => ({
    kind: 20, source: 0,
    before: { stream: 'journal', actionId: index + 1 },
    after: { accepted: true, actionId: index + 1 },
  }));
  const first = executeSeatRequest(seat, { action: 'follow', args: { operation: 'read', offset: 0, limit: 7 } }).result as any;
  const last = executeSeatRequest(seat, { action: 'follow', args: { operation: 'read', offset: first.eventNext, limit: 32 } }).result as any;
  assert(first.eventTotal === 19 && first.events.length === 7 && first.eventNext === 7,
    'Follow first page lost total or continuation state');
  assert(last.events.length === 12 && last.events[0].index === 8 && last.eventNext === null,
    'Follow continuation page repeated, skipped, or truncated retained events');
  assert(stored.events.length === 19, 'Paging mutated the append-only stored transcript');
});

test('Seat delete returns the exact pre-compaction patch instead of rediscovering its boundary', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  const deletedPatch = {
    version: 1, rings: 2, selectedTriangles: [40, 41], selectedGroups: [12],
    vertices: [
      { id: 10, at: [0, 0, 0] }, { id: 11, at: [1, 0, 0] },
      { id: 12, at: [1, 1, 0] }, { id: 13, at: [0, 1, 0] },
    ],
    triangles: [
      { id: 40, selected: true, group: 12, part: 0, material: 0, region: 0, instance: 0, vertices: [10, 11, 12] },
      { id: 41, selected: true, group: 12, part: 0, material: 0, region: 0, instance: 0, vertices: [10, 12, 13] },
    ],
    frontier: [
      { vertices: [10, 11], inside: 40, outside: 9, nonManifold: false },
      { vertices: [12, 13], inside: 41, outside: 42, nonManifold: false },
    ],
  };
  let events: any[] = [{ kind: 5, source: 9, before: deletedPatch, after: { version: 1, deleted: true } }];
  (globalThis as any).__mesh_delete_selection = () => JSON.stringify({ ok: 1, key: 'doc', count: 58, generation: 5 });
  (globalThis as any).__mesh_follow_action_drain = () => {
    const drained = events;
    events = [];
    return JSON.stringify({ version: 1, events: drained });
  };
  const seat = createAgentSeat();
  const deleted = executeSeatRequest(seat, { action: 'delete' });
  assert(deleted.ok && (deleted.result as any).deletedBoundary.components.length === 2 &&
    (deleted.result as any).deletedBoundary.components[0].at[1][0] === 1,
    'delete receipt discarded the exact surviving boundary');

  events = [{ kind: 5, source: 9, before: deletedPatch, after: { version: 1, deleted: true } }];
  const recovered = executeSeatRequest(seat, { action: 'retopo-bands', args: { operation: 'deleted-patch' } });
  assert(recovered.ok && (recovered.result as any).boundary.deletedFaces === 2 &&
    (recovered.result as any).boundary.components[1].vertices.join(',') === '12,13',
    'an unread delete transaction could not be recovered after a Seat reconnect');
});

test('retopology seam verbs preserve pair identity and require ordered disjoint width paths', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  let weldRequest: any = null;
  let normalizeRequest: any = null;
  (globalThis as any).__mesh_retopo_weld_pairs = (json: string) => {
    weldRequest = JSON.parse(json);
    return JSON.stringify({ ok: 1, key: 'torso', count: 52, generation: 4 });
  };
  (globalThis as any).__mesh_retopo_normalize_widths = (json: string) => {
    normalizeRequest = JSON.parse(json);
    return JSON.stringify({ ok: 1, key: 'torso', count: 52, generation: 5 });
  };
  const seat = createAgentSeat();

  const welded = executeSeatRequest(seat, {
    action: 'weld-pairs', args: { pairs: [[4, 9], [5, 10]], maxDistance: 0.02 },
  });
  assert(welded.ok && weldRequest.pairs.length === 2, 'pairwise seam weld stayed unreachable');
  assert(weldRequest.pairs[0].join(',') === '4,9' && weldRequest.pairs[1].join(',') === '5,10',
    'pairwise seam weld collapsed or reordered pair identity');
  assert(weldRequest.maxDistance === 0.02, 'pairwise weld dropped its distance leash');
  assert(!executeSeatRequest(seat, { action: 'weld-pairs', args: { pairs: [[4, 9], [9, 10]] } }).ok,
    'overlapping weld pairs reached native topology');

  const normalized = executeSeatRequest(seat, {
    action: 'normalize-widths',
    args: { paths: [{ vertices: [4, 5, 6, 7] }, { vertices: [9, 10, 11], closed: true }], strength: 0.75 },
  });
  assert(normalized.ok && normalizeRequest.paths.length === 2, 'width normalization stayed unreachable');
  assert(normalizeRequest.paths[1].closed === true && normalizeRequest.strength === 0.75,
    'width normalization dropped row closure or strength');
  assert(!executeSeatRequest(seat, {
    action: 'normalize-widths', args: { paths: [{ vertices: [4, 5, 6] }, { vertices: [6, 7, 8] }] },
  }).ok, 'overlapping normalization rows reached native geometry');
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
    version: 1, generation: 9, faces: 132, authoredFaces: 66, islands: 0, footprints: 0, unnamed: 0,
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
    vertices: [{ id: 2, at: [0, 1, 0] }, { id: 3, at: [1, 1, 0] }], edges: [{ id: 4, vertices: [2, 3], faces: 1, open: true }],
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
  const paired = executeSeatRequest(seat, { action: 'select-edge-pairs', args: { pairs: [[3, 2]] } });
  assert(paired.ok && edgeArgs[0] === 4 && edgeArgs[1] === 0, 'boundary edge pair did not resolve inside the live topology');
  const pointed = executeSeatRequest(seat, { action: 'select-edge-points', args: { pairs: [[[-0.0000001, 1, 0], [1, 1, 0]]] } });
  assert(pointed.ok && edgeArgs[0] === 4, 'boundary edge coordinates did not survive topology rekeying');
  assert(!executeSeatRequest(seat, { action: 'select-edge-pairs', args: { pairs: [[2, 99]] } }).ok, 'missing boundary edge pair was partially accepted');
});

test('boundary continuation exposes and accepts only one edge anchored at each open endpoint', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  (globalThis as any).__mesh_edit_elements = () => JSON.stringify({
    vertices: [
      { id: 1, at: [0, 0, 0] }, { id: 2, at: [1, 0, 0] },
      { id: 3, at: [0, 1, 0] }, { id: 4, at: [0, -1, 0] },
      { id: 5, at: [1, 1, 0] }, { id: 6, at: [2, 1, 0] },
    ],
    edges: [
      { id: 10, vertices: [1, 2], faces: 1, open: true }, { id: 11, vertices: [1, 3], faces: 1, open: true },
      { id: 12, vertices: [4, 1], faces: 1, open: true }, { id: 13, vertices: [2, 5], faces: 1, open: true },
      { id: 14, vertices: [5, 6], faces: 2, open: false },
    ],
  });
  const selected: number[] = [];
  (globalThis as any).__mesh_edit_select_edge = (index: number) => { selected.push(index); return 1; };
  const seat = createAgentSeat();
  const exposed = executeSeatRequest(seat, { action: 'boundary-continuation', args: { open: [1, 2] } });
  assert(exposed.ok, 'valid open edge was not exposed');
  const result = exposed.result as SeatBoundaryContinuation;
  assert(result.endpoints[0].candidates.length === 2 && result.endpoints[1].candidates.length === 1, 'local endpoint candidates were incomplete');
  assert(result.pairs.length === 2 && result.pairs.every((pair) => pair.edges[0][0] === 1 && pair.edges[1][0] === 2), 'candidate pairs lost endpoint anchoring');

  const accepted = executeSeatRequest(seat, { action: 'select-edge-continuation', args: { open: [1, 2], edges: [[3, 1], [5, 2]] } });
  assert(accepted.ok && selected.join(',') === '11,13', 'valid anchored continuation was not selected');
  selected.length = 0;
  assert(!executeSeatRequest(seat, { action: 'select-edge-continuation', args: { open: [1, 2], edges: [[1, 3], [5, 6]] } }).ok, 'disjoint edge was accepted');
  assert(!executeSeatRequest(seat, { action: 'select-edge-continuation', args: { open: [1, 2], edges: [[1, 3], [1, 4]] } }).ok, 'two edges from the same endpoint were accepted');
  assert(selected.length === 0, 'a rejected continuation changed selection');
});

test('retopology band preview covers and selects the full resident mesh without paint', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  const plan = {
    version: 1, axis: 'y', width: 0.08, origin: 0.24, faces: 60, covered: 60,
    bands: [
      { id: 0, bucket: 0, faces: 28, range: [0.24, 0.32], bbox: [-1, 0.24, -1, 1, 0.32, 1], color: [0.96, 0.3, 0.24] },
      { id: 1, bucket: 1, faces: 32, range: [0.32, 0.4], bbox: [-1, 0.32, -1, 1, 0.4, 1], color: [0.2, 0.62, 0.96] },
    ],
  };
  let selected = -2;
  let cleared = false;
  (globalThis as any).__mesh_retopo_bands_plan = (axis: number, width: number, origin: number) => {
    assert(axis === 1 && width === 0.08 && origin === 0.24, 'plan arguments drifted');
    return JSON.stringify(plan);
  };
  (globalThis as any).__mesh_retopo_bands_read = () => JSON.stringify(plan);
  (globalThis as any).__mesh_retopo_band_select = (id: number) => { selected = id; return 60; };
  (globalThis as any).__mesh_retopo_bands_clear = () => { cleared = true; return 1; };
  const seat = createAgentSeat();
  const planned = executeSeatRequest(seat, { action: 'retopo-bands', args: { operation: 'plan', axis: 'y', width: 0.08, origin: 0.24 } });
  assert(planned.ok && (planned.result as any).covered === 60, 'complete full-mesh plan was rejected');
  assert(executeSeatRequest(seat, { action: 'retopo-bands', args: { operation: 'read' } }).ok, 'installed preview could not be read');
  assert(executeSeatRequest(seat, { action: 'retopo-bands', args: { operation: 'select', id: 'all' } }).ok && selected === -1, 'select all did not use the complete mapped mask');
  assert(executeSeatRequest(seat, { action: 'retopo-bands', args: { operation: 'clear' } }).ok && cleared, 'preview clear did not stay view-only');
});

test('manual retopology tint records and erases the exact current face selection', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  const calls: number[] = [];
  (globalThis as any).__mesh_retopo_band_tint_selection = (id: number) => { calls.push(id); return 18; };
  (globalThis as any).__mesh_retopo_bands_read = () => JSON.stringify({
    version: 1, mode: 'manual', axis: 'y', width: 0, origin: 0, railSamples: 0,
    faces: 60, covered: 18,
    bands: [{ id: 3, bucket: 3, faces: 18, range: [0, 0], bbox: [0, 0, 0, 1, 1, 1], color: [0.34, 0.78, 0.42] }],
  });
  let persisted = 0;
  const seat = createAgentSeat({ retopoStateChanged: () => { persisted += 1; return true; } });
  const tinted = executeSeatRequest(seat, { action: 'retopo-bands', args: { operation: 'tint-selection', id: 3 } });
  assert(tinted.ok && calls[0] === 3 && (tinted.result as any).faces === 18, 'manual band did not preserve the chosen colour id');
  const read = executeSeatRequest(seat, { action: 'retopo-bands', args: { operation: 'read' } });
  assert(read.ok && (read.result as any).mode === 'manual' && (read.result as any).covered === 18,
    'partial user-authored map was rejected as an incomplete planner result');
  const erased = executeSeatRequest(seat, { action: 'retopo-bands', args: { operation: 'untint-selection' } });
  assert(erased.ok && calls[1] === -1, 'manual tint eraser did not reach the same exact-mask door');

  const ghostCalls: number[] = [];
  (globalThis as any).__mesh_retopo_source_ghost = (visible?: number) => {
    ghostCalls.push(visible ?? -1);
    return JSON.stringify({ captured: true, visible: visible === undefined ? true : visible === 1, faces: 60, covered: 18, generation: 4 });
  };
  const toggled = executeSeatRequest(seat, { action: 'retopo-bands', args: { operation: 'ghost' } });
  assert(toggled.ok && ghostCalls[0] === -1 && (toggled.result as any).visible === true,
    'source ghost toggle did not return its frozen comparison state');
  const hidden = executeSeatRequest(seat, { action: 'retopo-bands', args: { operation: 'ghost', visible: false } });
  assert(hidden.ok && ghostCalls[1] === 0 && (hidden.result as any).visible === false,
    'source ghost explicit visibility did not reach native state');
  assert(persisted === 4, 'each authored tint/erase/ghost change must cross the package persistence boundary');

  const refused = executeSeatRequest(createAgentSeat({ retopoStateChanged: () => false }), {
    action: 'retopo-bands', args: { operation: 'tint-selection', id: 3 },
  });
  assert(!refused.ok && (refused.result as any).persisted === false,
    'a live-only tint must report package persistence failure instead of claiming durable success');
});

test('retopology rail seed recovers ordered local heights from a quad chain', () => {
  const patch: SeatFollowPatch = {
    version: 1, rings: 0,
    selectedTriangles: [10, 11, 12, 13], selectedGroups: [7, 8], frontier: [],
    vertices: [
      { id: 1, at: [0, 0, 0] }, { id: 2, at: [0, 1, 0] },
      { id: 3, at: [1, 0.2, 0] }, { id: 4, at: [1, 1.2, 0] },
      { id: 5, at: [2, 0.4, 0] }, { id: 6, at: [2, 1.4, 0] },
    ],
    triangles: [
      { id: 10, selected: true, group: 7, part: 0, material: 0, region: 0, instance: 0, vertices: [1, 2, 4] },
      { id: 11, selected: true, group: 7, part: 0, material: 0, region: 0, instance: 0, vertices: [1, 4, 3] },
      { id: 12, selected: true, group: 8, part: 0, material: 0, region: 0, instance: 0, vertices: [3, 4, 6] },
      { id: 13, selected: true, group: 8, part: 0, material: 0, region: 0, instance: 0, vertices: [3, 6, 5] },
    ],
  };
  const rails = retopoRailPairsFromPatch(patch);
  assert(!!rails && rails.length === 18, 'quad chain did not yield three cross-sections');
  assert(rails![1] === 0 && rails![4] === 1, 'first cap was not ordered lower then upper');
  assert(Math.abs(rails![7] - 0.2) < 0.00001 && Math.abs(rails![10] - 1.2) < 0.00001, 'shared cross edge lost its local height');
  assert(Math.abs(rails![13] - 0.4) < 0.00001 && Math.abs(rails![16] - 1.4) < 0.00001, 'last cap was not recovered');

  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  (globalThis as any).__mesh_follow_patch = () => JSON.stringify(patch);
  let received = 0;
  (globalThis as any).__mesh_retopo_bands_plan_rails = (values: Float32Array) => {
    received = values.length;
    return JSON.stringify({
      version: 1, mode: 'rails', axis: 'y', width: 1, origin: 0, railSamples: 3,
      faces: 60, covered: 60, bands: [{ id: 0, bucket: 0, faces: 60, range: [0, 1], bbox: [0, 0, 0, 2, 1.4, 0], color: [1, 0, 0] }],
    });
  };
  const reply = executeSeatRequest(createAgentSeat(), { action: 'retopo-bands', args: { operation: 'plan-from-selection' } });
  assert(reply.ok && received === 18, 'selected quad rails did not reach the native planner');
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
  let paintedRgb: number[] = [];
  (globalThis as any).__model_paint_selection = (...rgb: number[]) => { paintedRgb = rgb; return 4; };
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
  assert(paintedRgb.join(',') === '10,20,30', 'selection paint changed the requested durable RGB fill');
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

test('Seat atlas uses the visible paint-atlas transaction when the editor provides it', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  let directCalls = 0;
  (globalThis as any).__model_set_paint_fit = () => { directCalls += 1; return 1; };
  let request: any = null;
  const seat = createAgentSeat({
    createAtlasAndPaint: (value) => {
      request = value;
      return { density: 441, fit: value.fit, w: 1651, h: 1899 };
    },
  });
  const reply = executeSeatRequest(seat, {
    action: 'atlas', args: { base: 'solid', rgb: [10, 20, 30], fit: 2048 },
  });
  assert(reply.ok && request?.base === 'solid' && request?.fit === 2048,
    'Seat atlas did not route through the editor-owned atlas transaction');
  assert((reply.result as any).w === 1651 && directCalls === 0,
    'Seat atlas bypassed the cart paint gate or lost its actual sheet receipt');
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

test('percept leads with authored faces and names triangle soup out loud', () => {
  const quads = formatSeatPercept({ ...percept, faces: 132, authoredFaces: 66 });
  assert(quads.includes('66 authored faces · 132 triangles'), `authored faces missing from readout: ${quads.split('\n')[0]}`);
  assert(!quads.includes('TRIANGLE SOUP'), 'a healthy quad mesh was reported as soup');

  // The exact state radio_001 was found in: same triangle count, every quad flattened.
  // The old readout printed "132 faces" for both and could not tell them apart.
  const soup = formatSeatPercept({ ...percept, faces: 132, authoredFaces: 132 });
  assert(soup.includes('TRIANGLE SOUP'), 'a fully flattened mesh was not flagged');

  const unknown = formatSeatPercept({ ...percept, faces: 132, authoredFaces: null });
  assert(unknown.includes('authored faces unknown'), 'an unobservable grouping must not read as a count');
  assert(!unknown.includes('TRIANGLE SOUP'), 'unknown grouping must never be reported as soup');
});

test('geometry facts ride every reply and never invent a clean zero', () => {
  const measured = { ...percept, faces: 2046, auditComputed: true, intersectingFaces: 402, unreachableFaces: 895, auditDirections: 42 };
  const line = formatGeometryFacts(measured);
  assert(line.includes('402 triangles pass through other triangles'), `penetration count missing: ${line}`);
  assert(line.includes('895 unreachable') && line.includes('44%'), `unreachable count/share missing: ${line}`);

  const clean = formatGeometryFacts({ ...percept, auditComputed: true, intersectingFaces: 0, unreachableFaces: 0, auditDirections: 42 });
  assert(clean === 'geometry \u00b7 0 intersecting \u00b7 0 unreachable', `clean model was not reported plainly: ${clean}`);

  // Over budget must never read as clean — that is the one way this lies.
  const skipped = formatGeometryFacts({ ...percept, auditComputed: false, intersectingFaces: 0, unreachableFaces: 0 });
  assert(skipped.includes('NOT MEASURED') && !skipped.includes('0 intersecting'), `over-budget was reported as clean: ${skipped}`);

  const old = formatGeometryFacts({ ...percept });
  assert(old.includes('host predates'), `pre-audit host was not distinguished: ${old}`);

  // And it must actually appear in the readout an agent sees on every operation.
  assert(formatSeatPercept(measured).includes('402 triangles pass through'), 'facts absent from the per-operation readout');
});

if (failed > 0) throw new Error(`${failed} seat API test(s) failed; ${passed} passed`);
log(`seatApi: ${passed} passed`);
