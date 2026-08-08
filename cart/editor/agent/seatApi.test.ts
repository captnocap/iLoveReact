// Run:
//   tools/esbuild cart/editor/agent/seatApi.test.ts --bundle --outfile=/tmp/editor-seat-api.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-seat-api.test.js
import { runSeatForEach, backgroundSeatRefusal, compactSeatReply, compileSeatSelector, createAgentSeat, executeSeatRequest, executeSeatRequestAtShell, formatGeometryFacts, formatSeatPercept, orbitPoseByDegrees, retopoRailPairsFromPatch, seatBatchGenerationReason, seatRequestTarget, type SeatBoundaryContinuation, type SeatFollowPatch, type SeatPartPercept, type SeatPercept, type SeatPrimitiveSpec } from './seatApi';
import { resetClaimsForTest, setClaimActiveModel } from './claims';
import type { CharacterRigSeatStatus } from './characterRigSeat';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

const percept: SeatPercept = {
  version: 1, model: null, generation: 4, faces: 60, authoredFaces: 30, islands: 0, footprints: 0, unnamed: 0,
  placeholders: 0, placeholderFaces: 0,
  activePartId: null, parts: [],
  regions: [{ id: 7, faces: 16, instances: 4, bbox: [0, 0, 0, 1, 2, 1] }],
  table: { version: 1, regions: [{ id: 7, name: 'window.rim' }], nextRegionId: 8 },
};
(globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);

const rigPercept: CharacterRigSeatStatus = {
  state: 'needs_bind',
  rows: {
    connected_body: { status: 'blocked', components: 2, main: 4732, detached: 1 },
    required_semantics: { status: 'blocked', missing: ['hand:left'], uncoveredBodyFaces: 214 },
    canonical_skeleton: 'ready',
    current_topology_hash: 'waiting',
    current_semantic_hash: 'waiting',
    current_object_binding_hash: 'waiting',
    saved_four_influence_weights: 'waiting',
  },
  weightsStale: false,
  fitReview: true,
  bindReview: false,
};

test('resident rig debt rides unrelated Seat replies without native polling', () => {
  let reads = 0;
  const seat = createAgentSeat({ rigPercept: () => { reads += 1; return rigPercept; } });
  const look = executeSeatRequest(seat, { action: 'look' });
  const recipes = executeSeatRequest(seat, { action: 'recipe-list' });
  assert(look.percept?.rig === rigPercept && recipes.percept?.rig === rigPercept,
    'ambient replies dropped the cached character-rig matrix');
  assert(look.percept?.rig?.rows.required_semantics.uncoveredBodyFaces === 214,
    'ambient rig percept collapsed structured semantic debt into prose');
  assert(reads > 0, 'Seat did not read the shell-owned cached rig percept');
});

test('rig-status forwards through the shell and returns the same ambient matrix', () => {
  let forwarded: { action: string; args: Record<string, unknown> } | null = null;
  const seat = createAgentSeat({
    rigPercept: () => rigPercept,
    shellAction: (action, args) => {
      forwarded = { action, args };
      return action === 'rig-status'
        ? { ok: true, result: rigPercept }
        : { ok: false, reason: `unexpected ${action}` };
    },
  });
  const reply = executeSeatRequest(seat, { action: 'rig-status' });
  assert(reply.ok && reply.result === rigPercept, 'rig-status rewrote or discarded the shell result');
  assert(forwarded?.action === 'rig-status' && Object.keys(forwarded.args).length === 0,
    'rig-status did not use the bounded zero-argument shell route');
  assert(reply.percept?.rig === rigPercept && reply.percept.rig.weightsStale === false,
    'rig-status reply disagreed with its ambient rig debt');
});

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

test('percept measures every live generator-named region and its triangles', () => {
  const generated = {
    ...percept,
    faces: 12,
    regions: [
      { id: 1, faces: 2, instances: 1, bbox: [0, 0, 0, 1, 1, 1] },
      { id: 2, faces: 4, instances: 1, bbox: [0, 0, 0, 1, 1, 1] },
      { id: 3, faces: 6, instances: 1, bbox: [0, 0, 0, 1, 1, 1] },
    ],
    table: { version: 1, regions: [
      { id: 1, name: 'right', createdBy: { op: 'new cube' } },
      { id: 2, name: 'body.top', createdBy: { op: 'add cube' } },
      { id: 3, name: 'body.wall', createdBy: { op: 'add cylinder' } },
    ] },
  };
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(generated);
  const reply = executeSeatRequest(createAgentSeat(), { action: 'look' });
  assert(reply.percept?.placeholders === 3, 'generator region count was not measured');
  assert(reply.percept?.placeholderFaces === 12, 'generator triangle coverage was not measured');
  assert(formatSeatPercept(reply.percept!).includes('⚠ 3 generator names over 12 triangles — no intentional naming pass yet'),
    'placeholder debt was absent from the percept readout');
});

test('intentional names, empty generator regions, and missing provenance do not count as placeholders', () => {
  const named = {
    ...percept,
    faces: 12,
    regions: [
      { id: 1, faces: 0, instances: 0, bbox: [0, 0, 0, 0, 0, 0] },
      { id: 2, faces: 7, instances: 1, bbox: [0, 0, 0, 1, 1, 1] },
      { id: 3, faces: 3, instances: 1, bbox: [0, 0, 0, 1, 1, 1] },
      { id: 4, faces: 2, instances: 1, bbox: [0, 0, 0, 1, 1, 1] },
    ],
    table: { version: 1, regions: [
      { id: 1, name: 'body.top', createdBy: { op: 'add cube' } },
      { id: 2, name: 'seat_cushion', createdBy: { op: 'name' } },
      { id: 3, name: 'legacy_backrest' },
      { id: 4, name: 'body.wall', createdBy: { op: 'add cylinder' } },
    ] },
  };
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(named);
  const reply = executeSeatRequest(createAgentSeat(), { action: 'look' });
  assert(reply.percept?.placeholders === 1 && reply.percept.placeholderFaces === 2,
    'intentional, emptied, or provenance-less regions were charged as generator debt');
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

test('accepted Seat transforms mark the document dirty and rejected transforms do not', () => {
  let mutations = 0;
  (globalThis as any).__mesh_transform_translate = () => 1;
  (globalThis as any).__mesh_transform_rotate_axis = () => 0;
  const seat = createAgentSeat({ documentMutated: () => { mutations += 1; } });
  const moved = executeSeatRequest(seat, { action: 'move', args: { delta: [0.25, 0, 0] } });
  const rejected = executeSeatRequest(seat, {
    action: 'rotate', args: { axis: [0, 1, 0], pivot: [0, 0, 0], degrees: 15 },
  });
  assert(moved.ok && !rejected.ok && mutations === 1,
    'Seat transform dirty notification did not follow accepted native mutations exactly');
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

test('a native Create Face receipt crosses the Seat boundary and names the new face', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  let assigned: { id: number; instance: number; table: any } | null = null;
  (globalThis as any).__mesh_topo_create_face = () => JSON.stringify({ ok: 1, key: 'doc', count: 62, generation: 5 });
  (globalThis as any).__mesh_semantic_assign = (id: number, instance: number, table: string) => {
    assigned = { id, instance, table: JSON.parse(table) };
    return 2;
  };
  const reply = executeSeatRequest(createAgentSeat(), {
    action: 'create-face', args: { name: 'torso_side_patch', instance: 0 },
  });
  assert(reply.ok && (reply.result as any).count === 62, 'accepted native face was lost at the Seat boundary');
  assert(assigned?.table.regions.some((row: any) => row.id === assigned!.id && row.name === 'torso_side_patch'),
    'Create Face returned without naming its selected result');
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
    version: 1, model: null, generation: 9, faces: 132, authoredFaces: 66, islands: 0, footprints: 0, unnamed: 0,
    placeholders: 0, placeholderFaces: 0,
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
  let selectionNotices = 0;
  (globalThis as any).__meshEditSelChanged = () => { selectionNotices += 1; };
  (globalThis as any).__mesh_edit_select_vertex = (...args: unknown[]) => { vertexArgs = args; return 1; };
  (globalThis as any).__mesh_edit_select_edge = (...args: unknown[]) => { edgeArgs = args; return 1; };
  (globalThis as any).__mesh_edit_select_face = (...args: unknown[]) => { faceArgs = args; return 1; };
  const seat = createAgentSeat({ selectionChanged: () => (globalThis as any).__meshEditSelChanged?.() });
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
  assert(selectionNotices >= 6, 'Seat selections did not wake the visible Model Focus readout');
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
  (globalThis as any).__mesh_lc_preview = () => JSON.stringify({ ok: 1, worldDirection: [0, 0, -1] });
  (globalThis as any).__mesh_lc_end = () => JSON.stringify({ ok: 1, key: 'doc', count: 64, generation: 5 });
  (globalThis as any).__mesh_topo_tris_to_quads = () => JSON.stringify({ ok: 1, key: 'doc', count: 58, generation: 6 });
  const seat = createAgentSeat();
  const cut = executeSeatRequest(seat, { action: 'basic-cut', args: { direction: 1, cuts: 2, offset: 0.4 } });
  assert(cut.ok && basic === 1, 'basic cut did not select the basic-cut session');
  assert(JSON.stringify((cut.result as any).worldDirection) === '[0,0,-1]', 'basic cut receipt dropped the applied seed world direction');
  assert(executeSeatRequest(seat, { action: 'tris-to-quads' }).ok, 'triangle conversion stayed unreachable');
});

test('uniform scale uses the same selection-pivot operation as the visible Scale By tool', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  let factor = 0;
  (globalThis as any).__mesh_gizmo_scale_by = (value: number) => { factor = value; return 1; };
  const reply = executeSeatRequest(createAgentSeat(), { action: 'scale-uniform', args: { factor: 1.25 } });
  assert(reply.ok && factor === 1.25, 'uniform scale did not reach the resident selection-pivot door');
});

test('loop alignment reports the native auto-selected world axis', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  (globalThis as any).__mesh_align_loop = () => 3;
  const reply = executeSeatRequest(createAgentSeat(), { action: 'align-loop' });
  assert(reply.ok && (reply.result as any).axis === 'z', 'Align Loop dropped or remapped the native axis receipt');
  (globalThis as any).__mesh_align_loop = () => 0;
  assert(!executeSeatRequest(createAgentSeat(), { action: 'align-loop' }).ok, 'rejected loop alignment reported success');
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
  const lore = executeSeatRequest(seat, { action: 'lore', args: { operation: 'history' } });
  assert(lore.ok && calls.length === 2 && calls[1]!.action === 'lore', 'Lore recovery API did not use the bounded shell authority');
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
  let previewTarget = 0;
  (globalThis as any).__mesh_bevel_begin = () => JSON.stringify({
    ok: 1, kind: 'boundary', sidesBefore: 4,
    defaultTargetSides: 8, minimumTargetSides: 5, maximumTargetSides: 256,
  });
  (globalThis as any).__mesh_bevel_preview = (_width: number, targetSides: number) => {
    previewTarget = targetSides;
    return JSON.stringify({ ok: 1, key: 'preview', count: 36 });
  };
  assert(executeSeatRequest(seat, { action: 'bevel', args: { width: 0.02, targetSides: 6 } }).ok && ended === 1,
    'generalized boundary chamfer stayed unreachable through Bevel');
  assert(previewTarget === 6, 'Seat collapsed an explicit non-doubling target back to the default');
  (globalThis as any).__mesh_bevel_begin = () => JSON.stringify({
    ok: 1, kind: 'face-polygon', sidesBefore: 4,
    defaultTargetSides: 8, minimumTargetSides: 3, maximumTargetSides: 256,
  });
  assert(executeSeatRequest(seat, { action: 'bevel', args: { width: 0.02, targetSides: 12 } }).ok && ended === 1,
    'filled-face N-gon conversion stayed unreachable through the captured topology session');
  assert(previewTarget === 12, 'Seat dropped the requested extrusion-center side count');
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

test('save refuses generator-named regions until the intentional naming pass', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify({
    ...percept,
    regions: [
      { id: 1, faces: 2, instances: 1, bbox: [0, 0, 0, 1, 1, 1] },
      { id: 2, faces: 4, instances: 1, bbox: [0, 0, 0, 1, 1, 1] },
    ],
    table: { version: 1, regions: [
      { id: 1, name: 'right', createdBy: { op: 'new cube' } },
      { id: 2, name: 'body.wall', createdBy: { op: 'add cube' } },
    ] },
  });
  let persisted = false;
  const reply = executeSeatRequest(createAgentSeat({ persist: () => { persisted = true; return true; } }), { action: 'save' });
  assert(!reply.ok && !persisted, 'save persisted unresolved generator names');
  assert(reply.reason === 'save blocked — 2 generator-named regions still cover 6 triangles. Do the intentional naming pass first: select each real part or affordance and `name` it, so the table describes the model instead of its construction.',
    `save returned the wrong generator-name refusal: ${reply.reason}`);
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
  assert(!quads.includes('intentional naming pass'), 'a zero-placeholder percept printed generator debt');

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

  // req_3752: a stale host cache handed a 12-triangle cube a moped's counts, and the
  // readout rendered "7417% of the mesh". Impossible arithmetic must never be printed.
  const stale = formatGeometryFacts({ ...percept, faces: 12, auditComputed: true, intersectingFaces: 1169, unreachableFaces: 890, auditDirections: 42 });
  assert(stale.includes('INCONSISTENT'), `impossible counts were not flagged: ${stale}`);
  assert(!stale.includes('%'), `a percentage was computed from counts that cannot both be true: ${stale}`);

  const old = formatGeometryFacts({ ...percept });
  assert(old.includes('host predates'), `pre-audit host was not distinguished: ${old}`);

  // And it must actually appear in the readout an agent sees on every operation.
  assert(formatSeatPercept(measured).includes('402 triangles pass through'), 'facts absent from the per-operation readout');
});

test('a claimed model admits only the password lane and stays readable (req_3850)', () => {
  resetClaimsForTest();
  setClaimActiveModel('m-radio');
  const bootstrap = { newPrimitive: () => true };

  const claimed = executeSeatRequestAtShell(null, { action: 'claim', args: { password: 'hush', agent: 'lane-a' } }, bootstrap);
  assert(claimed.ok && (claimed.result as any).model === 'm-radio', 'claim on the active model failed');

  const rival = executeSeatRequestAtShell(null, { action: 'claim', args: { password: 'other', agent: 'lane-b' } }, bootstrap);
  assert(!rival.ok && rival.reason?.includes('lane-a') === true, 'a second agent stole the claim');

  const blocked = executeSeatRequestAtShell(null, { action: 'extrude', args: { distance: 0.2 } }, bootstrap);
  assert(!blocked.ok && blocked.reason?.includes('lane-a') === true, 'tokenless mutation was not refused with the holder named');

  const wrongToken = executeSeatRequestAtShell(null, { action: 'extrude', args: { distance: 0.2 }, token: 'other' }, bootstrap);
  assert(!wrongToken.ok, 'a wrong token mutated a claimed model');

  // The right token clears admission; the refusal that remains is the ordinary
  // no-live-model shell boundary, proving the gate itself opened.
  const allowed = executeSeatRequestAtShell(null, { action: 'extrude', args: { distance: 0.2 }, token: 'hush' }, bootstrap);
  assert(!allowed.ok && allowed.reason?.includes('no live model') === true, 'the holder token did not pass the gate');

  const read = executeSeatRequestAtShell(null, { action: 'look' }, bootstrap);
  assert(read.ok, 'a claimed model stopped answering reads');
  const rigRead = executeSeatRequestAtShell(null, { action: 'rig-status' }, bootstrap);
  assert(!rigRead.ok && rigRead.reason?.includes('no live model') === true &&
    rigRead.reason?.includes('lane-a') !== true, 'rig-status was blocked by the claim instead of reaching ordinary model routing');

  const wrongDismiss = executeSeatRequestAtShell(null, { action: 'dismiss', args: { password: 'nope' } }, bootstrap);
  assert(!wrongDismiss.ok, 'a wrong password released the claim');
  const listed = executeSeatRequestAtShell(null, { action: 'claims' }, bootstrap);
  assert((listed.result as any).claims.length === 1 && (listed.result as any).claims[0].agent === 'lane-a', 'claims listing lost the holder');
  const released = executeSeatRequestAtShell(null, { action: 'dismiss', args: { password: 'hush' } }, bootstrap);
  assert(released.ok, 'the holder could not dismiss its own claim');
  const after = executeSeatRequestAtShell(null, { action: 'extrude', args: { distance: 0.2 } }, bootstrap);
  assert(!after.ok && after.reason?.includes('no live model') === true, 'dismiss did not reopen the model');
  resetClaimsForTest();
});

test('seat request target prefers the request model and otherwise uses the active model', () => {
  assert(seatRequestTarget({ action: 'look', model: 'm-b' }, 'm-a') === 'm-b', 'explicit request model lost to the active model');
  assert(seatRequestTarget({ action: 'look' }, 'm-a') === 'm-a', 'active model was not used as the request target');
  assert(seatRequestTarget({ action: 'look' }, null) === null, 'a missing model target was invented');
});

test('background seat policy names every refused limitation family', () => {
  const refused = [
    ['viewport', 'viewport'],
    // A staged product shot IS the visible viewport (req_4044) — a background
    // lane has no framed view to shoot.
    ['thumbnail', 'viewport'],
    ['uv-state', 'UV/paint'],
    ['rig-status', 'character rig'],
    ['shot', 'capture'],
    ['add', 'part geometry'],
    ['atlas', 'atlas'],
    ['follow', 'Follow'],
    ['new', 'new'],
    ['recipe', 'recipes'],
    ['command', 'editor commands'],
  ] as const;
  for (const [action, family] of refused) {
    const reason = backgroundSeatRefusal(action, {});
    assert(reason?.includes(family) === true, `${action} refusal did not name the ${family} limitation: ${reason}`);
  }
  for (const action of ['extrude', 'select', 'save', 'part-rename', 'part-select', 'texture-slot', 'rig', 'recipe-list']) {
    assert(backgroundSeatRefusal(action, {}) === null, `${action} was incorrectly refused for a background model`);
  }
  assert(backgroundSeatRefusal('rig', { operation: 'bind' })?.includes('character rig') === true,
    'a background character bind was allowed to target the singleton resident rig');
  for (const operation of ['read', 'replace', 'lights-replace']) {
    assert(backgroundSeatRefusal('rig', { operation }) === null,
      `legacy prop rig ${operation} was mistaken for a resident character operation`);
  }
  assert(backgroundSeatRefusal('retopo-bands', { operation: 'read' }) === null, 'retopology guide read was refused');
  assert(backgroundSeatRefusal('retopo-bands', { operation: 'plan' })?.includes('retopology guides') === true,
    'retopology guide mutation did not name its persistence limitation');
});

test('claim admission targets the request model', () => {
  resetClaimsForTest();
  setClaimActiveModel('m-a');
  const bootstrap = { newPrimitive: () => true };
  const claimed = executeSeatRequestAtShell(null, {
    action: 'claim', args: { model: 'm-b', password: 'hush', agent: 'lane-b' },
  }, bootstrap);
  assert(claimed.ok, 'the background target could not be claimed');
  const blocked = executeSeatRequestAtShell(null, { action: 'extrude', model: 'm-b' }, bootstrap);
  assert(!blocked.ok && blocked.reason?.includes('lane-b') === true, 'the request target claim did not block a tokenless mutation');
  const admitted = executeSeatRequestAtShell(null, { action: 'extrude', model: 'm-b', token: 'hush' }, bootstrap);
  assert(!admitted.ok && admitted.reason?.includes('no live model') === true, 'the target claim password did not pass admission');

  resetClaimsForTest();
  setClaimActiveModel('m-a');
  executeSeatRequestAtShell(null, { action: 'claim', args: { password: 'active-only', agent: 'lane-a' } }, bootstrap);
  const independent = executeSeatRequestAtShell(null, { action: 'extrude', model: 'm-b' }, bootstrap);
  assert(!independent.ok && independent.reason?.includes('no live model') === true,
    'a claim on the active model incorrectly blocked a different request target');
  resetClaimsForTest();
});

test('a background-model request reaches the ordinary no-live-model shell boundary', () => {
  resetClaimsForTest();
  setClaimActiveModel('m-active');
  const bootstrap = { newPrimitive: () => true };
  const misrouted = executeSeatRequestAtShell(null, { action: 'extrude', args: { distance: 0.2 }, model: 'm-other' }, bootstrap);
  assert(!misrouted.ok && misrouted.reason?.includes('no live model') === true,
    'a request for a background model was still refused by the removed routing policy');
  resetClaimsForTest();
});

test('percept model identity comes from the shell part percept', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  const modeled = executeSeatRequest(createAgentSeat({
    partPercept: () => ({ model: 'm-b', activePartId: null, parts: [] }),
  }), { action: 'look' }).percept;
  assert(modeled?.model === 'm-b', 'shell model identity was dropped while joining the part percept');
  assert(modeled != null && formatSeatPercept(modeled).includes('· model m-b ·'), 'formatted percept omitted the target model');

  const unknown = executeSeatRequest(createAgentSeat(), { action: 'look' }).percept;
  const formatted = unknown ? formatSeatPercept(unknown) : '';
  assert(unknown?.model === null && formatted.includes('· model unknown ·'), 'a native-only percept guessed a model identity');
  assert((formatted.match(/· model /g) ?? []).length === 1, 'the model identity appeared more than once in the percept header');
});

test('selection changes notify only through the seat adapter', () => {
  (globalThis as any).__mesh_semantic_state = () => JSON.stringify(percept);
  (globalThis as any).__mesh_select_query = () => JSON.stringify({ ok: true, faces: 60, actionableFaces: 60 });
  let rawSelectionChanged = false;
  (globalThis as any).__meshEditSelChanged = () => { rawSelectionChanged = true; };

  const unwired = createAgentSeat();
  assert(unwired.select('all').ok, 'unwired seat selection failed');
  assert(!rawSelectionChanged, 'an unwired seat called the visible selection door directly');

  const wired = createAgentSeat({ selectionChanged: () => (globalThis as any).__meshEditSelChanged?.() });
  assert(wired.select('all').ok, 'wired seat selection failed');
  assert(rawSelectionChanged, 'the adapter did not receive the selection notification');
});

test('batch generation refusal names an optional target model without changing legacy text', () => {
  assert(seatBatchGenerationReason(4, 5, 1, 'm-b')?.includes('m-b') === true, 'target model was omitted from the batch refusal');
  assert(seatBatchGenerationReason(4, 5, 1) === 'batch closed before row 2 — editor generation changed from 4 to 5',
    'the three-argument generation refusal changed');
});

if (failed > 0) throw new Error(`${failed} seat API test(s) failed; ${passed} passed`);

// ── measure / stats / align: the verbs that replaced agent-side python (req_4052) ──

const measurePercept: SeatPercept = {
  version: 1, model: null, generation: 9, faces: 24, authoredFaces: 12, islands: 0, footprints: 0, unnamed: 0,
  placeholders: 0, placeholderFaces: 0, auditComputed: true, intersectingFaces: 0, unreachableFaces: 2, auditDirections: 42,
  activePartId: null, parts: [],
  regions: [
    { id: 1, faces: 12, instances: 1, bbox: [-1, 0, -1, 1, 0.1, 1] },
    { id: 2, faces: 6, instances: 1, bbox: [-0.1, 0.14, -0.1, 0.1, 0.6, 0.1] },
    { id: 3, faces: 6, instances: 1, bbox: [-0.1, 0.6, -0.1, 0.1, 0.7, 0.1] },
  ],
  table: { version: 1, regions: [
    { id: 1, name: 'floor' },
    { id: 2, name: 'leg' },
    { id: 3, name: 'leg.cap', parent: 2 },
  ], nextRegionId: 4 },
};

/** Install the measure fixture and record whether anything touched the live selection. */
function withMeasureHost(run: (calls: { selectQueries: number; moves: number[][] }) => void) {
  const host = globalThis as any;
  const saved = {
    state: host.__mesh_semantic_state, query: host.__mesh_select_query, mode: host.__mesh_edit_mode,
    elements: host.__mesh_edit_elements, patch: host.__mesh_follow_patch, translate: host.__mesh_transform_translate,
    atlas: host.__model_atlas_read,
  };
  const calls = { selectQueries: 0, moves: [] as number[][] };
  host.__mesh_semantic_state = () => JSON.stringify(measurePercept);
  host.__model_atlas_read = () => null;
  host.__mesh_edit_mode = () => 3;
  host.__mesh_select_query = () => { calls.selectQueries += 1; return JSON.stringify({ ok: true, faces: 6, bbox: [-0.1, 0.14, -0.1, 0.1, 0.6, 0.1] }); };
  host.__mesh_edit_elements = () => JSON.stringify({
    vertices: [
      { id: 0, at: [-0.5, 1, 0] }, { id: 1, at: [0.5, 1, 0] }, { id: 2, at: [0, 1, 0.25] },
    ],
    edges: [
      { id: 0, vertices: [0, 1], faces: 1, open: true },
      { id: 1, vertices: [1, 2], faces: 3, open: false },
    ],
  });
  host.__mesh_follow_patch = () => JSON.stringify({
    version: 1, rings: 0, selectedTriangles: [0], selectedGroups: [0], frontier: [],
    vertices: [{ id: 0, at: [0, 0, 0] }, { id: 1, at: [1, 0, 0] }, { id: 2, at: [1, 2, 0] }],
    triangles: [{ id: 0, selected: true, group: 0, part: 0, material: 0, region: 2, instance: 0, vertices: [0, 1, 2] }],
  });
  host.__mesh_transform_translate = (x: number, y: number, z: number) => { calls.moves.push([x, y, z]); return 1; };
  try { run(calls); } finally {
    host.__mesh_semantic_state = saved.state; host.__mesh_select_query = saved.query; host.__mesh_edit_mode = saved.mode;
    host.__mesh_edit_elements = saved.elements; host.__mesh_follow_patch = saved.patch;
    host.__mesh_transform_translate = saved.translate; host.__model_atlas_read = saved.atlas;
  }
}

test('measure bbox rolls a region family up without touching the live selection', () => {
  withMeasureHost((calls) => {
    const reply = executeSeatRequest(createAgentSeat(), { action: 'measure', args: { operation: 'bbox', target: 'region:leg' } });
    const result = reply.result as any;
    assert(reply.ok, `measure bbox failed: ${reply.reason}`);
    // leg (up to y=0.6) plus its child leg.cap (up to y=0.7) — the family, not one row.
    assert(result.bbox[4] === 0.7, `family rollup missed the child region: ${result.bbox.join(',')}`);
    assert(result.faces === 12, `expected 12 faces, got ${result.faces}`);
    assert(result.selectionSet === false, 'a region measurement clobbered the live selection');
    assert(calls.selectQueries === 0, 'a region measurement ran a host selector query');
  });
});

test('measure contact reports the seating delta between two named regions', () => {
  withMeasureHost(() => {
    const reply = executeSeatRequest(createAgentSeat(), { action: 'measure', args: { operation: 'contact', a: 'region:leg.cap', b: 'region:floor' } });
    const result = reply.result as any;
    assert(reply.ok, `measure contact failed: ${reply.reason}`);
    assert(result.contact.axis === 'y', `contact axis was ${result.contact.axis}`);
    assert(Math.abs(result.contact.delta - (0.1 - 0.6)) < 1e-9, `delta was ${result.contact.delta}`);
    assert(result.verdict === 'gap', `verdict was ${result.verdict}`);
  });
});

test('a richer selector target says so instead of pretending it left the selection alone', () => {
  withMeasureHost((calls) => {
    const reply = executeSeatRequest(createAgentSeat(), { action: 'measure', args: { operation: 'bbox', target: 'facing:+y' } });
    assert(reply.ok, `measure bbox on a facing selector failed: ${reply.reason}`);
    assert((reply.result as any).selectionSet === true, 'a host-resolved target did not report that it set the selection');
    assert(calls.selectQueries === 1, 'the facing selector never reached the host query');
  });
});

test('measure names the target syntax when handed nothing usable', () => {
  withMeasureHost(() => {
    const reply = executeSeatRequest(createAgentSeat(), { action: 'measure', args: { operation: 'bbox', target: 'region:nope' } });
    assert(!reply.ok, 'an unknown region measured successfully');
    assert(/region:<name>/.test(reply.reason ?? ''), `reason did not teach the target syntax: ${reply.reason}`);
  });
});

test('stats anomalies never prints an audit zero it did not measure', () => {
  withMeasureHost(() => {
    const reply = executeSeatRequest(createAgentSeat(), { action: 'stats', args: { operation: 'anomalies', target: 'selection' } });
    const result = reply.result as any;
    assert(reply.ok, `stats anomalies failed: ${reply.reason}`);
    assert(result.audit.measured === true && result.audit.unreachableFaces === 2, 'the host audit counts were not carried through');
    assert(result.counts.nonManifoldEdges === 1, 'the 3-face edge was not reported');
    assert(result.openEdges === 1, 'the boundary edge was miscounted');
  });
});

test('stats symmetry measures about the model origin', () => {
  withMeasureHost(() => {
    const reply = executeSeatRequest(createAgentSeat(), { action: 'stats', args: { operation: 'symmetry', axis: 'x' } });
    const result = reply.result as any;
    assert(reply.ok, `stats symmetry failed: ${reply.reason}`);
    assert(result.plane === 0, 'the symmetry plane left the origin');
    assert(result.onPlane === 1 && result.unmatched === 0, `symmetry read ${result.onPlane} on-plane, ${result.unmatched} unmatched`);
  });
});

test('align dry-run reports a delta and moves nothing', () => {
  withMeasureHost((calls) => {
    const reply = executeSeatRequest(createAgentSeat(), { action: 'align', args: { moving: 'region:leg', onto: 'region:floor', dryRun: true } });
    const result = reply.result as any;
    assert(reply.ok, `align dry run failed: ${reply.reason}`);
    assert(result.applied === false, 'a dry run reported itself as applied');
    assert(Math.abs(result.delta[1] - (0.1 - 0.14)) < 1e-9, `delta was ${result.delta.join(',')}`);
    assert(calls.moves.length === 0, 'a dry run moved geometry');
  });
});

test('align applies exactly the delta its dry run reported', () => {
  withMeasureHost((calls) => {
    const seat = createAgentSeat();
    const planned = (executeSeatRequest(seat, { action: 'align', args: { moving: 'region:leg', onto: 'region:floor', dryRun: true } }).result as any).delta;
    const reply = executeSeatRequest(seat, { action: 'align', args: { moving: 'region:leg', onto: 'region:floor' } });
    assert(reply.ok, `align failed: ${reply.reason}`);
    assert((reply.result as any).applied === true, 'align did not report itself applied');
    assert(calls.moves.length === 1, `expected one move, got ${calls.moves.length}`);
    assert(calls.moves[0]!.every((value, axis) => Math.abs(value - planned[axis]) < 1e-9), `applied ${calls.moves[0]} but planned ${planned}`);
  });
});

test('align refuses to move the whole model onto part of itself', () => {
  withMeasureHost((calls) => {
    const reply = executeSeatRequest(createAgentSeat(), { action: 'align', args: { moving: 'model', onto: 'region:floor' } });
    assert(!reply.ok, 'aligning the model onto its own part was allowed');
    assert(calls.moves.length === 0, 'the refused align still moved geometry');
  });
});


// ── intent amplifiers (req_4061) ───────────────────────────────────────────────

function withWalkHost(run: (calls: { requests: any[]; applied: any[] }) => void) {
  const host = globalThis as any;
  const saved = { walk: host.__mesh_walk, apply: host.__mesh_walk_apply, state: host.__mesh_semantic_state, atlas: host.__model_atlas_read, patch: host.__mesh_follow_patch, translate: host.__mesh_transform_translate };
  const calls = { requests: [] as any[], applied: [] as any[] };
  host.__mesh_semantic_state = () => JSON.stringify(measurePercept);
  host.__model_atlas_read = () => null;
  host.__mesh_walk = (json: string) => {
    calls.requests.push(JSON.parse(json));
    return JSON.stringify({ ok: true, token: '77', domain: 'edge', count: 12, terminated: 'closed', stoppedAt: 4, tieBreak: 'lowest element id wins an equal-cost step', bbox: [0, 0, 0, 1, 1, 1], elements: [1, 2, 3] });
  };
  host.__mesh_walk_apply = (token: string, additive: number) => { calls.applied.push([token, additive]); return 12; };
  host.__mesh_follow_patch = () => JSON.stringify({
    version: 1, rings: 0, selectedTriangles: [0], selectedGroups: [0], frontier: [],
    vertices: [{ id: 0, at: [0, 0.2, 0] }, { id: 1, at: [1, 0.2, 0] }, { id: 2, at: [1, 0.9, 0] }],
    triangles: [{ id: 0, selected: true, group: 0, part: 0, material: 0, region: 2, instance: 0, vertices: [0, 1, 2] }],
  });
  host.__mesh_transform_translate = (x: number, y: number, z: number) => { calls.applied.push(['move', x, y, z]); return 1; };
  try { run(calls); } finally {
    host.__mesh_walk = saved.walk; host.__mesh_walk_apply = saved.apply; host.__mesh_semantic_state = saved.state;
    host.__model_atlas_read = saved.atlas; host.__mesh_follow_patch = saved.patch; host.__mesh_transform_translate = saved.translate;
  }
}

test('a walk previews by default and touches no selection', () => {
  withWalkHost((calls) => {
    const reply = executeSeatRequest(createAgentSeat(), { action: 'select-loop', args: { edge: 31 } });
    const result = reply.result as any;
    assert(reply.ok, `select-loop failed: ${reply.reason}`);
    assert(result.applied === false, 'a preview reported itself applied');
    assert(calls.applied.length === 0, 'a preview committed the walk');
    assert(result.terminated === 'closed' && result.tieBreak.length > 0, 'the reply did not carry its diagnostics');
  });
});

test('--apply commits the token the preview reported, never a recomputed one', () => {
  withWalkHost((calls) => {
    const reply = executeSeatRequest(createAgentSeat(), { action: 'select-ring', args: { edge: 31, apply: true, additive: true } });
    assert(reply.ok, `select-ring failed: ${reply.reason}`);
    assert((reply.result as any).selected === 12, 'the applied count was not carried through');
    assert(calls.applied[0]![0] === '77' && calls.applied[0]![1] === 1, `applied with ${calls.applied[0]}`);
  });
});

test('a stale token surfaces as a refusal that names the fix', () => {
  withWalkHost(() => {
    (globalThis as any).__mesh_walk_apply = () => -1;
    const reply = executeSeatRequest(createAgentSeat(), { action: 'select-path', args: { from: 0, to: 7, apply: true } });
    assert(!reply.ok, 'a stale token applied anyway');
    assert(/re-read the walk/.test(reply.reason ?? ''), `reason was ${reply.reason}`);
  });
});

test('an unconstrained path sends the host sentinel, a constrained one sends the axis', () => {
  withWalkHost((calls) => {
    const seat = createAgentSeat();
    executeSeatRequest(seat, { action: 'select-path', args: { from: 0, to: 7 } });
    assert(calls.requests[0]!.axis === 255, `unconstrained axis was ${calls.requests[0]!.axis}`);
    executeSeatRequest(seat, { action: 'select-path', args: { from: 0, to: 7, axis: 'y' } });
    assert(calls.requests[1]!.axis === 1, `y resolved to ${calls.requests[1]!.axis}`);
  });
});

test('a walk missing its seed names the whole syntax rather than failing bare', () => {
  withWalkHost(() => {
    const reply = executeSeatRequest(createAgentSeat(), { action: 'select-loop', args: {} });
    assert(!reply.ok, 'a seedless loop walked');
    assert(/select-loop|loop \{edge\}/.test(reply.reason ?? ''), `reason was ${reply.reason}`);
    const similar = executeSeatRequest(createAgentSeat(), { action: 'select-similar', args: { face: 3, by: 'vibes' } });
    assert(!similar.ok && /normal, coplanar, or area/.test(similar.reason ?? ''), 'an invalid comparison was accepted');
  });
});

test('set-position places by absolute coordinate instead of a computed delta', () => {
  withWalkHost((calls) => {
    const reply = executeSeatRequest(createAgentSeat(), { action: 'set-position', args: { axis: 'y', value: 0.75 } });
    const result = reply.result as any;
    assert(reply.ok, `set-position failed: ${reply.reason}`);
    // The selection's min y is 0.2, so seating it at 0.75 is a +0.55 move.
    assert(Math.abs(result.delta[1] - 0.55) < 1e-9, `delta was ${result.delta}`);
    const move = calls.applied.find((row) => row[0] === 'move')!;
    assert(Math.abs(move[2] - 0.55) < 1e-9, `moved ${move}`);
  });
});

test('set-position anchors by min, center, or max and refuses anything else', () => {
  withWalkHost(() => {
    const seat = createAgentSeat();
    const center = executeSeatRequest(seat, { action: 'set-position', args: { axis: 'y', value: 1, anchor: 'center' } });
    // bbox y spans 0.2..0.9, so its center is 0.55 and the delta is +0.45.
    assert(Math.abs((center.result as any).delta[1] - 0.45) < 1e-9, `center delta was ${(center.result as any).delta}`);
    const bad = executeSeatRequest(seat, { action: 'set-position', args: { axis: 'y', value: 1, anchor: 'edge' } });
    assert(!bad.ok, 'an unknown anchor was accepted');
  });
});

test('for-each refuses to nest and names the parts it could not reach', () => {
  withWalkHost(() => {
    const seat = createAgentSeat();
    const nested = runSeatForEach(seat, { selector: 'rivet', do: { action: 'for-each', args: {} } });
    assert(!nested.ok && /cannot nest/.test(nested.reason ?? ''), 'for-each nested');
    const missing = runSeatForEach(seat, { selector: 'rivet', do: { action: 'flip', args: {} } });
    assert(!missing.ok && /no visible Outliner part/.test(missing.reason ?? ''), `reason was ${missing.reason}`);
  });
});

log(`seatApi: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
