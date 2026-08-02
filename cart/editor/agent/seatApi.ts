// Agent Seat — the deliberately small TS boundary over the live model editor.
// It does not generate geometry. Every verb bottoms out in the same host doors
// used by ModelView, while semantic names make topology addressable after context
// loss. Transports (CLI/dev socket) are adapters around this module.

export const NO_SEMANTIC_ID = 0xffffffff;
export const DEFAULT_NAMING_DEBT_BUDGET = 8;
const PAINT_ATLAS_TUNING = {
  minMedianIslandTexels: 8,
  fitLevels: [512, 1024, 2048, 4096] as readonly number[],
  defaultFit: 1024,
};

const host = globalThis as any;

export type SemanticRegion = {
  id: number;
  name: string;
  parent?: number | null;
  role?: string;
  createdBy?: { op: string; take?: number; at?: number };
};

export type SemanticTable = { version: 1; regions: SemanticRegion[]; nextRegionId?: number };
export type SeatPart = {
  id: string;
  name: string;
  kind: string | null;
  visible: boolean;
  lo: number | null;
  hi: number | null;
  groupPath: { id: string; name: string }[];
};
export type SeatPartPercept = { activePartId: string | null; parts: SeatPart[] };
export type SeatPercept = {
  version: 1;
  generation: number;
  faces: number;
  unnamed: number;
  hiddenFaces?: number;
  hiddenNamedFaces?: number;
  hiddenRegions?: number;
  regions: { id: number; faces: number; instances: number; bbox: [number, number, number, number, number, number] }[];
  table: SemanticTable;
  /** Shell-owned Outliner identity paired with the host-authored ranges. This is
   * durable parts.json data, not a reconstruction from semantic face names. */
  activePartId: string | null;
  parts: SeatPart[];
};
export type SelectorReceipt = { ok: boolean; faces?: number; actionableFaces?: number; bbox?: [number, number, number, number, number, number]; reason?: string };
export type TopologyReceipt = { ok: number; key?: string; count?: number; generation?: number; [key: string]: unknown };
export type InsetReceipt =
  | { ok: true; topology: TopologyReceipt; transforms: number }
  | { ok: false; stage: 'validate' | 'extrude' | 'scale-0' | 'scale-1' | 'offset'; reason: string };
// What the rebuilt paint sheet actually came out as: the derived texels/meter, the atlas
// budget that derived it, and the sheet's pixel dimensions.
export type AtlasReceipt = { density: number; fit?: number; w?: number; h?: number };
export type SeatReply = { ok: boolean; op: string; result?: unknown; percept: SeatPercept | null; reason?: string };
export type SeatBriefReply = Omit<SeatReply, 'percept'> & { brief: string };
export type SeatElements = {
  vertices: { id: number; at: [number, number, number] }[];
  edges: { id: number; vertices: [number, number] }[];
};
export type SeatFollowPatch = {
  version: 1;
  rings: number;
  selectedTriangles: number[];
  selectedGroups: number[];
  vertices: { id: number; at: [number, number, number] }[];
  triangles: {
    id: number;
    selected: boolean;
    group: number;
    part: number;
    material: number;
    region: number;
    instance: number;
    vertices: [number, number, number];
  }[];
  frontier: {
    vertices: [number, number];
    inside: number;
    outside: number | null;
    nonManifold: boolean;
  }[];
};
export type SeatFollowEdgePatch = {
  version: 1;
  selectedEdges: {
    id: number;
    vertices: [number, number];
    at: [[number, number, number], [number, number, number]];
    boundary: boolean;
  }[];
  patch: SeatFollowPatch | null;
};
export type SeatFollowExample = {
  index: number;
  action: 'delete-create-face';
  source: string;
  at: number;
  delete: { before: SeatFollowPatch };
  create: { before: SeatFollowEdgePatch; after: SeatFollowPatch };
};
type SeatFollowPendingDelete = { source: string; at: number; before: SeatFollowPatch };
export type SeatFollowSession = {
  version: 1;
  id: number;
  label: string;
  active: boolean;
  startedAt: number;
  stoppedAt?: number;
  startedGeneration: number;
  examples: SeatFollowExample[];
  pendingDelete?: SeatFollowPendingDelete;
};
type NativeFollowActionDrain = {
  version: 1;
  events: { kind: number; source: number; before: unknown; after: unknown }[];
};
export type SeatShellReceipt = { ok: boolean; result?: unknown; reason?: string };
export type SeatRecipeReceipt = {
  ok: boolean;
  recipe: string;
  status: 'candidate' | 'approved';
  steps: string[];
  result?: unknown;
  reason?: string;
};
export type RetopoWidthPath = { vertices: number[]; closed?: boolean };

/** A primitive the seat asks the editor's RESIDENT generators to build (editMesh.ts
 *  cuboid/cylinder/cone/…). The seat still never emits vertex arrays — it names a
 *  shape and the editor builds it, exactly as `extrude` names a face operation.
 *  Dimensions are METERS (the R4 scale contract: 1 unit = 1 meter); the adapter
 *  converts to the asset catalog's u units. `sides` is the resolution knob —
 *  cylinder/cone/sphere segments, clamped 3..48 by editMesh.clampSides. */
export type SeatPrimitiveSpec = {
  kind: string;
  size: number;
  height: number;
  sides: number;
  at?: [number, number, number];
};

export type SeatAdapter = {
  /** ModelView uses this to adopt the new host key/count after topology changes. */
  adoptTopology?: (result: TopologyReceipt | null) => void;
  take?: () => number | undefined;
  namingDebtBudget?: number;
  /** Append a primitive as a new outliner part; returns its authored group range.
   *  ModelView wires this to the shell's addPrimitivePart rather than calling
   *  __mesh_append_group directly, because the outliner row and the host mesh must
   *  stay ONE truth — req_3465 is what a cart/host part-table divergence costs.
   *  Absent = the seat reports the verb unavailable instead of half-adding. */
  addPrimitive?: (spec: SeatPrimitiveSpec) => { lo: number; hi: number } | null;
  /** File → New Mesh through AppFrame's document constructor. A new model is
   * workspace + outliner + package state, not a host-mesh replacement. */
  newPrimitive?: (spec: SeatPrimitiveSpec) => boolean;
  /** Frame self-capture (SELFSHOT-0606). Absent unless the cart imports
   *  runtime/capture.ts AND the binary carries -Dhas-capture. Never touches the
   *  desktop: it reads back the frame the app itself composed. */
  captureFrame?: (path: string) => boolean;
  /** Full package save through AppFrame: meshdoc v4, semantic table, parts,
   *  atlas, and package metadata cross the cold-restart boundary together. */
  persist?: () => boolean;
  /** Live shell-owned Outliner names and hierarchy. The native semantic state
   *  intentionally knows geometry only; the seat joins both truths at look time. */
  partPercept?: () => SeatPartPercept;
  /** Existing shell/Outliner/focus-panel authority for human-facing commands
   *  whose truth is cart-owned rather than a native mesh operation. */
  shellAction?: (action: string, args: Record<string, unknown>) => SeatShellReceipt;
  /** Detach changes both native part ranges and the shell-owned Outliner table. */
  detachSelection?: (name: string) => { lo: number; hi: number } | null;
  /** Follow is short-lived editor working state. It survives a dev hot reload in
   * the existing hot-state twig, but deliberately resets on a cold process. */
  followState?: {
    read: () => SeatFollowSession | null;
    write: (state: SeatFollowSession | null) => void;
  };
};

function parseJson<T>(raw: unknown): T | null {
  if (typeof raw !== 'string' || !raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function readTopology(raw: unknown): TopologyReceipt | null {
  const value = parseJson<TopologyReceipt>(raw);
  return value?.ok === 1 ? value : null;
}

export function readSeatPercept(): SeatPercept | null {
  const value = parseJson<SeatPercept>(host.__mesh_semantic_state?.());
  if (!value || value.version !== 1 || !Array.isArray(value.regions) || value.table?.version !== 1) return null;
  return {
    ...value,
    activePartId: typeof value.activePartId === 'string' ? value.activePartId : null,
    parts: Array.isArray(value.parts) ? value.parts : [],
  };
}

function regionByName(table: SemanticTable, name: string): SemanticRegion | null {
  return table.regions.find((region) => region.name === name) ?? null;
}

function regionFamily(table: SemanticTable, name: string): number[] {
  const root = regionByName(table, name);
  if (!root) return [];
  const byId = new Map(table.regions.map((region) => [region.id, region]));
  return table.regions.filter((region) => {
    let cursor: SemanticRegion | undefined = region;
    const visited = new Set<number>();
    while (cursor && !visited.has(cursor.id)) {
      if (cursor.id === root.id) return true;
      visited.add(cursor.id);
      cursor = cursor.parent == null ? undefined : byId.get(cursor.parent);
    }
    return false;
  }).map((region) => region.id);
}

function declareRegion(table: SemanticTable, name: string, role: string, op: string, take?: number, parent?: number): { table: SemanticTable; region: SemanticRegion } {
  const existing = regionByName(table, name);
  if (existing) return { table, region: existing };
  const occupied = new Set(table.regions.map((region) => region.id));
  let id = Math.max(0, table.nextRegionId ?? 0);
  while (occupied.has(id) || id === NO_SEMANTIC_ID) id += 1;
  const region: SemanticRegion = {
    id, name, role,
    ...(parent === undefined ? {} : { parent }),
    createdBy: { op, ...(take === undefined ? {} : { take }), at: Date.now() },
  };
  return { table: { ...table, regions: [...table.regions, region], nextRegionId: id + 1 }, region };
}

function axisIndex(axis: string): number | null {
  return axis === 'x' ? 0 : axis === 'y' ? 1 : axis === 'z' ? 2 : null;
}

function finiteVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((item) => Number.isFinite(item));
}

function rgbBytes(value: unknown): value is [number, number, number] {
  return finiteVec3(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255);
}

export function orbitPoseByDegrees(pose: unknown, yawDegrees: number, pitchDegrees: number): number[] | null {
  if (!Array.isArray(pose) || pose.length !== 6 || pose.some((value) => !Number.isFinite(value)) ||
      !Number.isFinite(yawDegrees) || !Number.isFinite(pitchDegrees)) return null;
  return [
    pose[0] + yawDegrees * Math.PI / 180,
    pose[1] + pitchDegrees * Math.PI / 180,
    pose[2], pose[3], pose[4], pose[5],
  ];
}

/** Compile the stable selector text agents use into the native query shape. */
export function compileSeatSelector(selector: string, percept: SeatPercept): Record<string, unknown> | null {
  const text = selector.trim();
  if (text === 'all') return { kind: 'all' };
  const regionFacing = /^region:(.+?)\s*&\s*facing:([+-])([xyz])(?:@(\d+(?:\.\d+)?))?$/.exec(text);
  if (regionFacing) {
    const regions = regionFamily(percept.table, regionFacing[1]!);
    if (regions.length === 0) return null;
    return {
      kind: 'region_facing', regions,
      axis: axisIndex(regionFacing[3]!)!, sign: regionFacing[2] === '+' ? 1 : -1,
      tolerance_degrees: Number(regionFacing[4] ?? 15),
    };
  }
  const facing = /^facing:([+-])([xyz])(?:@(\d+(?:\.\d+)?))?$/.exec(text);
  if (facing) return { kind: 'facing', axis: axisIndex(facing[2]!)!, sign: facing[1] === '+' ? 1 : -1, tolerance_degrees: Number(facing[3] ?? 15) };
  if (text === 'top' || text === 'extremal:top') return { kind: 'extremal', axis: 1, sign: 1 };
  if (text === 'bottom' || text === 'extremal:bottom') return { kind: 'extremal', axis: 1, sign: -1 };
  const extremal = /^outermost:([+-])([xyz])$/.exec(text);
  if (extremal) return { kind: 'extremal', axis: axisIndex(extremal[2]!)!, sign: extremal[1] === '+' ? 1 : -1 };
  const plane = /^(above|below):([xyz])([<>])(-?\d+(?:\.\d+)?)$/.exec(text);
  if (plane) return { kind: plane[1], axis: axisIndex(plane[2]!)!, threshold: Number(plane[4]) };
  const faces = /^faces:(\d+)\.\.(\d+)$/.exec(text);
  if (faces) return { kind: 'part', lo: Number(faces[1]), hi: Number(faces[2]) };
  const box = /^inside:box\(([^)]+)\)$/.exec(text);
  if (box) {
    const values = box[1]!.split(',').map(Number);
    if (values.length === 6 && values.every(Number.isFinite)) return { kind: 'box', min: values.slice(0, 3), max: values.slice(3) };
  }
  // Region names live in an explicit namespace whenever they collide with a
  // geometric keyword. Bare non-keyword names remain accepted for existing scripts,
  // but a saved region called "top" can never steal the extremal query again.
  const regionName = text.startsWith('region:') ? text.slice('region:'.length) : text;
  const named = regionByName(percept.table, regionName);
  if (named) return { kind: 'region', region: named.id, regions: regionFamily(percept.table, regionName) };
  return null;
}

export function formatSeatPercept(percept: SeatPercept): string {
  const names = new Map(percept.table.regions.map((region) => [region.id, region.name]));
  const lines = [`mesh · ${percept.faces} faces · generation ${percept.generation} · unnamed ${percept.unnamed}`];
  for (const part of percept.parts) {
    const range = part.lo == null || part.hi == null ? 'range pending' : `[${part.lo},${part.hi})`;
    const folder = part.groupPath.length > 0 ? `${part.groupPath.map((row) => row.name).join('/')} / ` : '';
    lines.push(`  part ${folder}${part.name}  ${range}${part.id === percept.activePartId ? '  ACTIVE' : ''}${part.visible ? '' : '  hidden'}`);
  }
  for (const row of percept.regions) lines.push(`  ${names.get(row.id) ?? `region:${row.id}`}  ${row.faces} faces${row.instances > 1 ? ` ×${row.instances}` : ''}  bbox ${row.bbox.join(',')}`);
  if (percept.unnamed > 0) lines.push(`  ⚠ unnamed  ${percept.unnamed}`);
  return lines.join('\n');
}

/** Strip repeated full percepts from a wire reply while preserving every accepted/
 * rejected row. The live editor calls this when tools/seat requests --brief, so the
 * formatter is the shipped transport boundary rather than unused documentation. */
export function compactSeatReply(reply: SeatReply): SeatBriefReply {
  const compactResult = reply.op === 'batch' && Array.isArray(reply.result)
    ? reply.result.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const { percept: _percept, ...rest } = row as SeatReply;
      return rest;
    })
    : reply.result;
  return {
    ok: reply.ok,
    op: reply.op,
    ...(compactResult === undefined ? {} : { result: compactResult }),
    ...(reply.reason ? { reason: reply.reason } : {}),
    brief: reply.percept ? formatSeatPercept(reply.percept) : 'no live mesh',
  };
}

export function seatBatchGenerationReason(expected: number, live: number, rowIndex: number): string | null {
  return live === expected
    ? null
    : `batch closed before row ${rowIndex + 1} — editor generation changed from ${expected} to ${live}`;
}

export function createAgentSeat(adapter: SeatAdapter = {}) {
  const debtBudget = adapter.namingDebtBudget ?? DEFAULT_NAMING_DEBT_BUDGET;
  let primitiveBootstrapAttempted = false;
  const restoredFollow = adapter.followState?.read();
  let followSession: SeatFollowSession | null = restoredFollow?.version === 1 ? restoredFollow : null;
  const storeFollow = (state: SeatFollowSession | null) => {
    followSession = state;
    adapter.followState?.write(state);
  };
  const automation = <T>(invoke: () => T): T => {
    host.__mesh_action_source?.(9); // CommandSource 'automation'
    try { return invoke(); } finally { host.__mesh_action_source?.(0); }
  };
  const withParts = (percept: SeatPercept | null): SeatPercept | null => {
    if (!percept) return null;
    const shell = adapter.partPercept?.();
    return shell ? { ...percept, ...shell } : percept;
  };
  const look = (): SeatPercept | null => {
    const initial = withParts(readSeatPercept());
    if (!initial || primitiveBootstrapAttempted || initial.table.regions.length > 0 || initial.unnamed !== initial.faces || initial.faces < 6 || initial.faces > 12) return initial;
    primitiveBootstrapAttempted = true;
    let table = initial.table;
    const ids: number[] = [];
    for (const [name, role] of [['right', '+x'], ['left', '-x'], ['top', '+y'], ['bottom', '-y'], ['back', '+z'], ['front', '-z']] as const) {
      const declared = declareRegion(table, name, role, 'new cube', adapter.take?.());
      table = declared.table;
      ids.push(declared.region.id);
    }
    if (host.__mesh_semantic_bootstrap_axes?.(new Uint32Array(ids), JSON.stringify(table)) === 1) return withParts(readSeatPercept());
    return initial;
  };
  const select = (selector: string): SelectorReceipt => {
    const percept = look();
    if (!percept) return { ok: false, reason: 'no live mesh' };
    const visiblePartIds = percept.parts.filter((part) => part.visible && part.lo != null && part.hi != null).map((part) => part.id);
    if (selector.trim() === 'all' && visiblePartIds.length > 1) {
      const scoped = adapter.shellAction?.('part-select', { ids: visiblePartIds, primary: visiblePartIds[visiblePartIds.length - 1] });
      if (!scoped?.ok) return { ok: false, reason: scoped?.reason ?? 'select all could not expand the active scope to every visible part' };
    }
    const query = compileSeatSelector(selector, percept);
    if (!query) {
      if (/^part:\d+\.\.\d+$/.test(selector.trim())) return { ok: false, reason: 'face ranges use faces:<lo>..<hi>; part: is reserved for Outliner part ids' };
      if (selector.trim().startsWith('part:')) return { ok: false, reason: 'Outliner parts are selected with part-select, not the face selector' };
      return { ok: false, reason: `unknown selector "${selector}"` };
    }
    // The seat's selection is face-only, and host ops gate on the edit MODE, not just the
    // selection set — meshLoopCutFaceBegin bails outright unless mode() == .face. Assert it
    // here rather than inside those verbs, because setting the mode clears the selection:
    // asserting it later would wipe the very faces the verb was handed.
    host.__mesh_edit_mode?.(3);
    const receipt = parseJson<SelectorReceipt>(host.__mesh_select_query?.(JSON.stringify(query))) ?? { ok: false, reason: 'selector door unavailable' };
    const actionable = receipt.actionableFaces ?? receipt.faces;
    if (receipt.ok && receipt.faces !== undefined && actionable !== undefined && actionable < receipt.faces) {
      host.__mesh_edit_clear?.();
      return {
        ok: false, faces: receipt.faces, actionableFaces: actionable, bbox: receipt.bbox,
        reason: `selector matched ${receipt.faces} faces but active part scope permits ${actionable}; select every intended part first`,
      };
    }
    return receipt;
  };
  const elements = (): SeatElements | null => parseJson<SeatElements>(host.__mesh_edit_elements?.());
  const followPatch = (faces?: number[], rings = 1): SeatFollowPatch | null => {
    const cleanFaces = Array.isArray(faces)
      ? [...new Set(faces.map(Number).filter((face) => Number.isInteger(face) && face >= 0))]
      : undefined;
    const depth = Math.max(0, Math.min(4, Math.trunc(Number(rings) || 0)));
    const value = parseJson<SeatFollowPatch>(host.__mesh_follow_patch?.(
      cleanFaces === undefined ? undefined : new Uint32Array(cleanFaces), depth,
    ));
    return value?.version === 1 && Array.isArray(value.selectedTriangles) && Array.isArray(value.frontier)
      ? value
      : null;
  };
  const isFollowPatch = (value: unknown): value is SeatFollowPatch => {
    const patch = value as SeatFollowPatch | null;
    return patch?.version === 1 && Array.isArray(patch.selectedTriangles) && Array.isArray(patch.frontier);
  };
  const isFollowEdgePatch = (value: unknown): value is SeatFollowEdgePatch => {
    const patch = value as SeatFollowEdgePatch | null;
    return patch?.version === 1 && Array.isArray(patch.selectedEdges) &&
      patch.selectedEdges.length >= 2 && patch.selectedEdges.every((edge) => edge.boundary === true);
  };
  const drainNativeFollowActions = (): number => {
    const drained = parseJson<NativeFollowActionDrain>(host.__mesh_follow_action_drain?.());
    if (!drained || drained.version !== 1 || !Array.isArray(drained.events)) return 0;
    if (!followSession?.active) return 0;
    const sourceNames = ['native', 'menu', 'hotkey', 'toolbar', 'dock', 'context-menu', 'palette', 'viewport', 'remote', 'automation'];
    const examples = [...followSession.examples];
    let pendingDelete = followSession.pendingDelete;
    for (const event of drained.events) {
      const source = sourceNames[Math.trunc(Number(event.source))] ?? 'native';
      if (source === 'automation' || source === 'remote') continue;
      if (event.kind === 5 && isFollowPatch(event.before)) {
        pendingDelete = { source, at: Date.now(), before: event.before };
        continue;
      }
      if (event.kind !== 2 || !pendingDelete || !isFollowEdgePatch(event.before) || !isFollowPatch(event.after)) continue;
      examples.push({
        index: examples.length + 1,
        action: 'delete-create-face',
        source: pendingDelete.source === source ? source : `${pendingDelete.source}+${source}`,
        at: pendingDelete.at,
        delete: { before: pendingDelete.before },
        create: { before: event.before, after: event.after },
      });
      pendingDelete = undefined;
    }
    const added = examples.length - followSession.examples.length;
    if (added !== 0 || pendingDelete !== followSession.pendingDelete) {
      storeFollow({ ...followSession, examples, ...(pendingDelete ? { pendingDelete } : { pendingDelete: undefined }) });
    }
    return added;
  };
  const follow = (operation: string, args: Record<string, unknown> = {}): SeatShellReceipt => {
    if (operation === 'start') {
      const live = look();
      if (!live) return { ok: false, reason: 'no live mesh to follow' };
      // A Follow session observes only work performed after READY. Native capture
      // is a queue so rapid UI commands cannot overwrite one another; clear any
      // pre-session residue before opening this transcript.
      host.__mesh_follow_action_drain?.();
      const state: SeatFollowSession = {
        version: 1,
        id: Date.now(),
        label: String(args.label ?? '').trim() || 'mesh demonstration',
        active: true,
        startedAt: Date.now(),
        startedGeneration: live.generation,
        examples: [],
      };
      storeFollow(state);
      return { ok: true, result: state };
    }
    if (operation === 'read') {
      drainNativeFollowActions();
      return followSession
        ? { ok: true, result: followSession }
        : { ok: false, reason: 'no Follow demonstration has been started' };
    }
    if (operation === 'stop') {
      if (!followSession) return { ok: false, reason: 'no Follow demonstration has been started' };
      drainNativeFollowActions();
      const state = { ...followSession, active: false, stoppedAt: Date.now() };
      storeFollow(state);
      return { ok: true, result: state };
    }
    if (operation === 'clear') {
      host.__mesh_follow_action_drain?.();
      storeFollow(null);
      return { ok: true, result: { cleared: true } };
    }
    if (operation === 'inspect') {
      const patch = followPatch(args.faces as number[] | undefined, Number(args.rings ?? 1));
      return patch
        ? { ok: true, result: patch }
        : { ok: false, reason: 'Follow inspect needs a live face selection or valid resident triangle ids' };
    }
    return { ok: false, reason: `unknown Follow operation "${operation}"` };
  };
  const selectEdge = (index: number, additive = false): boolean =>
    Number.isInteger(index) && index >= 0 && host.__mesh_edit_select_edge?.(index, additive ? 1 : 0) === 1;
  const selectVertex = (index: number, additive = false): boolean =>
    Number.isInteger(index) && index >= 0 && host.__mesh_edit_select_vertex?.(index, additive ? 1 : 0) === 1;
  const selectFace = (index: number, additive = false): boolean =>
    Number.isInteger(index) && index >= 0 && host.__mesh_edit_select_face?.(index, additive ? 1 : 0) === 1;
  const selectElements = (kind: 'face' | 'edge' | 'vertex', values: unknown): number => {
    const indices = Array.isArray(values)
      ? [...new Set(values.map(Number).filter((index) => Number.isInteger(index) && index >= 0))]
      : [];
    if (indices.length === 0) return 0;
    host.__mesh_edit_mode?.(kind === 'vertex' ? 1 : kind === 'edge' ? 2 : 3);
    const door = kind === 'vertex' ? host.__mesh_edit_select_vertex
      : kind === 'edge' ? host.__mesh_edit_select_edge
        : host.__mesh_edit_select_face;
    if (typeof door !== 'function') return 0;
    let changed = 0;
    for (let at = 0; at < indices.length; at += 1) changed += door(indices[at], at === 0 ? 0 : 1) === 1 ? 1 : 0;
    return changed;
  };
  const nameSelection = (name: string, instance = 0, role = 'authored', op = 'name'): number => {
    const percept = look();
    if (!percept || !name || name === '_') return 0;
    const declared = declareRegion(percept.table, name, role, op, adapter.take?.());
    return Number(automation(() => host.__mesh_semantic_assign?.(declared.region.id, instance, JSON.stringify(declared.table))) ?? 0);
  };
  const extrude = (distance: number, name: string, instance = 0): TopologyReceipt | null => {
    const before = look();
    if (!before) return null;
    if (!name || name === '_') {
      if (before.unnamed > debtBudget) return null;
      const result = readTopology(automation(() => host.__mesh_topo_extrude_face?.(distance)));
      adapter.adoptTopology?.(result);
      return result;
    }
    let table = before.table;
    const parent = regionByName(table, name)?.id;
    const cap = declareRegion(table, `${name}.cap`, 'cap', 'extrude', adapter.take?.(), parent);
    table = cap.table;
    const wall = declareRegion(table, `${name}.wall`, 'wall', 'extrude', adapter.take?.(), parent);
    table = wall.table;
    if (host.__mesh_semantic_extrude_intent?.(cap.region.id, wall.region.id, instance, JSON.stringify(table)) !== 1) return null;
    const result = readTopology(automation(() => host.__mesh_topo_extrude_face?.(distance)));
    adapter.adoptTopology?.(result);
    return result;
  };
  const move = (delta: [number, number, number]) => finiteVec3(delta) && automation(() => host.__mesh_transform_translate?.(...delta)) === 1;
  const scale = (axis: [number, number, number], pivot: [number, number, number], factor: number) =>
    finiteVec3(axis) && finiteVec3(pivot) && Number.isFinite(factor) && automation(() => host.__mesh_transform_scale_axis?.(...axis, ...pivot, factor)) === 1;
  const scaleUniform = (factor: number) => Number.isFinite(factor) && factor !== 0
    && automation(() => host.__mesh_gizmo_scale_by?.(factor)) === 1;
  const rotate = (axis: [number, number, number], pivot: [number, number, number], degrees: number) =>
    finiteVec3(axis) && finiteVec3(pivot) && Number.isFinite(degrees) && automation(() => host.__mesh_transform_rotate_axis?.(...axis, ...pivot, degrees * Math.PI / 180)) === 1;
  const topology = (invoke: () => unknown): TopologyReceipt | null => {
    const result = readTopology(automation(invoke));
    adapter.adoptTopology?.(result);
    return result;
  };
  const extrudeEdge = (distance: number): TopologyReceipt | null => topology(() => host.__mesh_topo_extrude_edge?.(distance));
  const connectVertices = (): TopologyReceipt | null => topology(() => host.__mesh_topo_connect_vertices?.());
  const createFace = (name: string, instance = 0): TopologyReceipt | null => {
    if (!name || name === '_') return null;
    const result = topology(() => host.__mesh_topo_create_face?.());
    if (!result) return null;
    if (nameSelection(name, instance, 'face', 'create face') > 0) return result;
    topology(() => host.__mesh_undo?.());
    return null;
  };
  const bevel = (width: number): TopologyReceipt | null => {
    if (!Number.isFinite(width) || width <= 0) return null;
    const begin = parseJson<{ ok?: number }>(host.__mesh_bevel_begin?.());
    if (begin?.ok !== 1) return null;
    const preview = readTopology(host.__mesh_bevel_preview?.(width));
    if (!preview) { host.__mesh_bevel_end?.(0); return null; }
    const result = readTopology(automation(() => host.__mesh_bevel_end?.(1)));
    adapter.adoptTopology?.(result);
    return result;
  };
  const deleteSelection = (): TopologyReceipt | null => topology(() => host.__mesh_delete_selection?.());
  const mergeFaces = (): TopologyReceipt | null => topology(() => host.__mesh_topo_merge_faces?.());
  const weld = (): TopologyReceipt | null => topology(() => host.__mesh_topo_weld?.());
  const weldPairs = (values: unknown, maxDistance?: number): TopologyReceipt | null => {
    if (!Array.isArray(values) || values.length === 0 || values.length > 4096) return null;
    const used = new Set<number>();
    const pairs: [number, number][] = [];
    for (const value of values) {
      if (!Array.isArray(value) || value.length !== 2) return null;
      const a = Number(value[0]);
      const b = Number(value[1]);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a === b || used.has(a) || used.has(b)) return null;
      used.add(a); used.add(b); pairs.push([a, b]);
    }
    if (maxDistance !== undefined && (!Number.isFinite(maxDistance) || maxDistance <= 0)) return null;
    return topology(() => host.__mesh_retopo_weld_pairs?.(JSON.stringify({ pairs, ...(maxDistance === undefined ? {} : { maxDistance }) })));
  };
  const normalizeWidths = (values: unknown, strength = 1): TopologyReceipt | null => {
    if (!Array.isArray(values) || values.length === 0 || values.length > 128 ||
        !Number.isFinite(strength) || strength <= 0 || strength > 1) return null;
    const used = new Set<number>();
    const paths: RetopoWidthPath[] = [];
    let total = 0;
    for (const value of values) {
      if (!value || typeof value !== 'object') return null;
      const rawVertices = (value as RetopoWidthPath).vertices;
      if (!Array.isArray(rawVertices) || rawVertices.length < 3) return null;
      const vertices = rawVertices.map(Number);
      total += vertices.length;
      if (total > 8192 || vertices.some((vertex) => !Number.isInteger(vertex) || vertex < 0 || used.has(vertex))) return null;
      vertices.forEach((vertex) => used.add(vertex));
      paths.push({ vertices, closed: (value as RetopoWidthPath).closed === true });
    }
    return topology(() => host.__mesh_retopo_normalize_widths?.(JSON.stringify({ paths, strength })));
  };
  const solidify = (thickness: number): TopologyReceipt | null => topology(() => host.__mesh_topo_solidify?.(thickness));
  const flip = (): TopologyReceipt | null => topology(() => host.__mesh_topo_flip_faces?.());
  const glass = (): TopologyReceipt | null => topology(() => host.__mesh_topo_glass?.());
  const detach = (name: string): { lo: number; hi: number } | null =>
    name && name !== '_' ? adapter.detachSelection?.(name) ?? null : null;
  const inset = (
    distance: number,
    name: string,
    pivot: [number, number, number],
    axes: [[number, number, number], [number, number, number]],
    factors: [number, number],
    offset: [number, number, number] = [0, 0, 0],
  ): InsetReceipt => {
    if (!Number.isFinite(distance) || !finiteVec3(pivot) || !Array.isArray(axes) || axes.length !== 2 ||
        !axes.every(finiteVec3) || !Array.isArray(factors) || factors.length !== 2 ||
        !factors.every((factor) => Number.isFinite(factor) && factor > 0) || !finiteVec3(offset)) {
      return { ok: false, stage: 'validate', reason: 'inset arguments are malformed or non-finite' };
    }
    const result = extrude(distance, name);
    if (!result) {
      return { ok: false, stage: 'extrude', reason: 'hairline extrude rejected; select exactly one authored face before inset' };
    }
    let transforms = 0;
    const rollback = (stage: 'scale-0' | 'scale-1' | 'offset', reason: string): InsetReceipt => {
      for (let step = 0; step < transforms + 1; step += 1) topology(() => host.__mesh_undo?.());
      return { ok: false, stage, reason };
    };
    for (let at = 0; at < 2; at += 1) {
      if (factors[at] === 1) continue;
      if (!scale(axes[at]!, pivot, factors[at]!)) {
        return rollback(`scale-${at}` as 'scale-0' | 'scale-1', `axis ${at + 1} scale rejected; the inset was rolled back`);
      }
      transforms += 1;
    }
    if (offset.some((value) => value !== 0)) {
      if (!move(offset)) return rollback('offset', 'offset translate rejected; the inset was rolled back');
      transforms += 1;
    }
    return { ok: true, topology: result, transforms };
  };
  const paint = (rgb: [number, number, number]): number => rgbBytes(rgb)
    ? Number(automation(() => host.__model_paint_selection?.(...rgb)) ?? 0)
    : 0;
  const paintReadiness = (): { ok: boolean; w?: number; h?: number; detail?: number; medianIslandTexels?: number; recommendedFit?: number; reason?: string } => {
    const atlasState = parseJson<{ w?: number; h?: number; detail?: number; islands?: number[] }>(host.__model_atlas_read?.(0));
    if (!atlasState || !Number.isFinite(atlasState.w) || !Number.isFinite(atlasState.h) || !Array.isArray(atlasState.islands)) {
      return { ok: false, reason: 'paint blocked — no readable UV atlas; run atlas first' };
    }
    const shortEdges: number[] = [];
    for (let at = 0; at + 3 < atlasState.islands.length; at += 4) {
      const short = Math.min(Number(atlasState.islands[at + 2]), Number(atlasState.islands[at + 3]));
      if (Number.isFinite(short) && short > 0) shortEdges.push(short);
    }
    shortEdges.sort((a, b) => a - b);
    const median = shortEdges.length > 0 ? shortEdges[Math.floor(shortEdges.length / 2)]! : 0;
    if (median >= PAINT_ATLAS_TUNING.minMedianIslandTexels) return { ok: true, w: atlasState.w, h: atlasState.h, detail: atlasState.detail, medianIslandTexels: median };
    const largest = Math.max(Number(atlasState.w), Number(atlasState.h));
    const recommendedFit = PAINT_ATLAS_TUNING.fitLevels.find((fit) =>
      median * (fit / Math.max(1, largest)) >= PAINT_ATLAS_TUNING.minMedianIslandTexels
    ) ?? PAINT_ATLAS_TUNING.fitLevels[PAINT_ATLAS_TUNING.fitLevels.length - 1];
    return {
      ok: false, w: atlasState.w, h: atlasState.h, detail: atlasState.detail,
      medianIslandTexels: median, recommendedFit,
      reason: `paint blocked — atlas ${atlasState.w}×${atlasState.h} at ${atlasState.detail ?? 0} px/m gives a ${median}px median island; rebuild with atlas fit=${recommendedFit}`,
    };
  };
  // Paint fidelity is an atlas BUDGET, not a hand-picked density (req_2518, the same law the
  // visible painter's Density button cycles): the model's islands fit a texels² sheet and the
  // host DERIVES px/m from the model's own size, so a small prop gets writing-grade texels and
  // a car divides the same budget. An agent naming no resolution now gets the painter's proven
  // 1024², instead of inheriting whatever density happened to be live — a 0.3m prop left on a
  // low density packs its whole atlas into ~25×26px, where a lens region owns six pixels and
  // reads as unpainted no matter how correct the paint program is.
  const atlas = (base: 'template' | 'solid' | 'blank', rgb: [number, number, number], detail?: number, fit?: number): AtlasReceipt | null => {
    if (!['template', 'solid', 'blank'].includes(base) || !rgbBytes(rgb) ||
        (detail !== undefined && (!Number.isInteger(detail) || detail < 1)) ||
        (fit !== undefined && !PAINT_ATLAS_TUNING.fitLevels.includes(fit))) return null;
    const mode = base === 'solid' ? 1 : base === 'blank' ? 2 : 0;
    // Size the sheet BEFORE laying the base colour — createAtlasAndPaint's order, so the fill
    // lands on the final layout rather than being rescaled out from under itself.
    const budget = fit ?? (detail === undefined ? PAINT_ATLAS_TUNING.defaultFit : 0);
    const density = budget
      ? Number(automation(() => host.__model_set_paint_fit?.(budget)) ?? -1)
      : Number(automation(() => host.__model_set_paint_detail?.(detail)) ?? -1);
    if (!(density >= 0)) return null;
    if (automation(() => host.__model_atlas_base?.(mode, ...rgb)) !== 1) return null;
    // Report the sheet the agent actually got. The resolution was previously invisible from
    // the seat, so a too-small atlas looked exactly like paint that silently did nothing.
    let sheet: { w?: number; h?: number } = {};
    if (budget) {
      try {
        const json = host.__model_paint_fit_estimate?.(budget);
        const parsed = typeof json === 'string' && json ? JSON.parse(json) : null;
        if (parsed && Number.isFinite(parsed.w) && Number.isFinite(parsed.h)) sheet = { w: parsed.w, h: parsed.h };
      } catch { /* an unreadable estimate is not a failed rebuild */ }
    }
    return { density, ...(budget ? { fit: budget } : {}), ...sheet };
  };
  const material = (slot: number | null): number => slot !== null && (!Number.isInteger(slot) || slot < 0) ? 0 : Number(automation(() => slot == null
    ? host.__mesh_texture_slot_clear?.()
    : host.__mesh_texture_slot_assign?.(slot)) ?? 0);
  const uv = (operation: 'restore' | 'auto-size' | 'project-view'): boolean => {
    if (!['restore', 'auto-size', 'project-view'].includes(operation)) return false;
    const selected = parseJson<{ islands?: number[] }>(host.__model_uv_selection_read?.());
    const islands = new Uint32Array((selected?.islands ?? []).filter((value) => Number.isInteger(value) && value >= 0));
    if (islands.length === 0) return false;
    if (operation === 'restore') return automation(() => host.__model_uv_restore_shape?.(islands)) === 1;
    if (operation === 'auto-size') return automation(() => host.__model_uv_auto_size?.(islands)) === 1;
    return automation(() => host.__model_uv_project_view?.(islands)) === 1;
  };
  const save = (): SeatShellReceipt => {
    const percept = look();
    if (!percept) return { ok: false, reason: 'no live mesh' };
    if (percept.unnamed > 0) return {
      ok: false,
      reason: `save blocked — ${percept.unnamed} unnamed faces remain; durable boundaries require zero naming debt`,
    };
    return adapter.persist?.() === true
      ? { ok: true }
      : { ok: false, reason: 'the shell could not persist the active model package' };
  };
  const undo = (): TopologyReceipt | null => { const result = readTopology(automation(() => host.__mesh_undo?.())); adapter.adoptTopology?.(result); return result; };
  const redo = (): TopologyReceipt | null => { const result = readTopology(automation(() => host.__mesh_redo?.())); adapter.adoptTopology?.(result); return result; };
  /** Mirror the mesh exactly across an axis plane (0 = X, 1 = Y, 2 = Z), keeping the
   *  +side or the −side. One host op, journaled — the seat never hand-computes a
   *  reflection, which is what made mirrored features drift when it could not. */
  const symmetrize = (axis: number, keepPositive: boolean): TopologyReceipt | null => {
    const result = readTopology(automation(() => host.__mesh_symmetrize?.(axis, keepPositive ? 1 : 0)));
    adapter.adoptTopology?.(result);
    return result;
  };
  /** Loop cut the CURRENT FACE SELECTION. Deliberately the lc_* session door, not
   *  __mesh_topo_loop_cut: that one cuts across the one selected EDGE, and the seat
   *  has no edge selection to give it. This one cuts along one of the clicked face's
   *  two in-plane axes, which is addressable from a face selector. Authored grouping
   *  carries through, so each crossed face becomes two faces in the SAME semantic
   *  region — a cut never creates naming debt. */
  const loopCut = (direction: number, cuts: number, offsetFraction: number, basic = false): TopologyReceipt | null => {
    if (![0, 1].includes(direction) || !Number.isInteger(cuts) || cuts < 1 || !Number.isFinite(offsetFraction) || offsetFraction < 0 || offsetFraction > 1) return null;
    if (parseJson<{ ok?: number }>(host.__mesh_lc_begin?.(basic ? 1 : 0))?.ok !== 1) return null;
    const preview = parseJson<{ ok?: number; fallbackReason?: string }>(host.__mesh_lc_preview?.(direction, cuts, offsetFraction));
    if (preview?.ok !== 1) { host.__mesh_lc_end?.(0); return null; } // cancel restores the pre-cut mesh exactly
    const result = readTopology(automation(() => host.__mesh_lc_end?.(1)));
    adapter.adoptTopology?.(result);
    return result;
  };
  const trisToQuads = (): TopologyReceipt | null => topology(() => host.__mesh_topo_tris_to_quads?.());
  const collectUvOrientation = (): number => Number(automation(() => host.__mesh_edit_select_uv_orientation?.()) ?? 0);
  const shellAction = (action: string, args: Record<string, unknown>): SeatShellReceipt =>
    adapter.shellAction?.(action, args) ?? { ok: false, reason: 'editor shell action bridge unavailable' };
  /** Append a resident primitive as a new named part, then leave it selected so the
   *  very next transform lands on it. Naming happens in the same beat as the append
   *  for the same reason extrude names its cap/wall: a cold `look` must show the part,
   *  not a slab of anonymous faces. */
  const addPrimitive = (spec: SeatPrimitiveSpec, name: string): { lo: number; hi: number } | null => {
    if (!adapter.addPrimitive || !name || name === '_') return null; // a part must be named, like extrude's cap/wall
    // Capture the semantic table BEFORE the append. The append REPLACES the live mesh and
    // resets the host's semantic table, so a post-append read returns an empty one — and
    // re-stamping from that drops every existing name while leaving the faces still bound
    // to their (now nameless) ids. This is req_3465's part-range bug one layer up, and its
    // fix is the same shape: grow the table from a PRE-replace capture, never a post read.
    const before = look();
    const range = adapter.addPrimitive(spec);
    if (!range) return null;
    select(`faces:${range.lo}..${range.hi}`);
    let table = before?.table ?? { version: 1 as const, regions: [] };
    const root = declareRegion(table, name, 'part', `add ${spec.kind}`, adapter.take?.());
    table = root.table;
    const roleSpecs: Record<string, readonly (readonly [string, string])[]> = {
      cube: [['.right', '+x'], ['.left', '-x'], ['.top', '+y'], ['.bottom', '-y'], ['.back', '+z'], ['.front', '-z']],
      cylinder: [['.cap.top', '+y'], ['.cap.bottom', '-y'], ['.wall', 'wall']],
      cone: [['.base', '-y'], ['.wall', 'wall']],
      pyramid: [['.base', '-y'], ['.wall', 'wall']],
      plane: [['.surface', 'surface']], sphere: [['.surface', 'surface']], icosphere: [['.surface', 'surface']],
    };
    const roles = roleSpecs[spec.kind];
    if (!roles) return null;
    const ids: number[] = [];
    for (const [suffix, role] of roles) {
      const declared = declareRegion(table, `${name}${suffix}`, role, `add ${spec.kind}`, adapter.take?.(), root.region.id);
      table = declared.table;
      ids.push(declared.region.id);
    }
    if (host.__mesh_semantic_name_primitive?.(range.lo, range.hi, spec.kind, new Uint32Array(ids), JSON.stringify(table)) !== 1) return null;
    return range;
  };
  const newPrimitive = (spec: SeatPrimitiveSpec): boolean => adapter.newPrimitive?.(spec) === true;
  const shot = (path: string): boolean => adapter.captureFrame?.(path) === true;
  const recipeList = () => [{
    name: 'dial', status: 'candidate' as const,
    description: 'Place a resident cylinder normal to one selected target face.',
    args: ['target', 'normal', 'diameter', 'depth', 'name', 'sides?'],
  }];
  const runRecipe = (name: string, args: Record<string, unknown>): SeatRecipeReceipt => {
    const status = 'candidate' as const;
    if (name !== 'dial') return { ok: false, recipe: name, status, steps: [], reason: `unknown recipe "${name}"` };
    const target = String(args.target ?? '');
    const normal = String(args.normal ?? '');
    const semanticName = String(args.name ?? '');
    const diameter = Number(args.diameter);
    const depth = Number(args.depth);
    const sides = args.sides === undefined ? 24 : Number(args.sides);
    const orientation: Record<string, { axis: [number, number, number]; degrees: number }> = {
      '+y': { axis: [1, 0, 0], degrees: 0 }, '-y': { axis: [1, 0, 0], degrees: 180 },
      '+x': { axis: [0, 0, 1], degrees: -90 }, '-x': { axis: [0, 0, 1], degrees: 90 },
      '+z': { axis: [1, 0, 0], degrees: 90 }, '-z': { axis: [1, 0, 0], degrees: -90 },
    };
    const pose = orientation[normal];
    if (!target || !semanticName || semanticName === '_' || !pose ||
        !Number.isFinite(diameter) || diameter <= 0 || !Number.isFinite(depth) || depth <= 0 ||
        !Number.isInteger(sides) || sides < 3 || sides > 96) {
      return { ok: false, recipe: name, status, steps: [], reason: 'dial needs target, normal (+/-x/y/z), positive diameter/depth, a name, and sides 3..96' };
    }
    const selected = select(target);
    if (!selected.ok || !selected.bbox || !selected.faces) {
      return { ok: false, recipe: name, status, steps: [], reason: selected.reason ?? 'dial target resolved to no faces' };
    }
    const bbox = selected.bbox;
    const center: [number, number, number] = [
      (bbox[0] + bbox[3]) * 0.5,
      (bbox[1] + bbox[4]) * 0.5,
      (bbox[2] + bbox[5]) * 0.5,
    ];
    const steps = [`select ${target} (${selected.faces} faces)`, `add cylinder ${diameter} × ${depth} as ${semanticName}`];
    let journalUnits = 0;
    const rollback = (reason: string): SeatRecipeReceipt => {
      for (let at = 0; at < journalUnits; at += 1) undo();
      return { ok: false, recipe: name, status, steps, reason: `${reason}; ${journalUnits} recipe unit(s) rolled back` };
    };
    const range = addPrimitive({ kind: 'cylinder', size: diameter, height: depth, sides }, semanticName);
    if (!range) return rollback('dial cylinder append was rejected');
    journalUnits += 1;
    if (pose.degrees !== 0) {
      if (!rotate(pose.axis, [0, 0, 0], pose.degrees)) return rollback('dial orientation was rejected');
      journalUnits += 1;
      steps.push(`rotate ${pose.degrees}° about ${pose.axis.join(',')}`);
    }
    // Primitives rest with their base at y=0. Rotating around the origin points that
    // base along the requested normal; translating to the face center seats it flush.
    if (!move(center)) return rollback('dial placement was rejected');
    journalUnits += 1;
    steps.push(`move base to ${center.join(',')}`);
    return { ok: true, recipe: name, status, steps, result: { range, target: { faces: selected.faces, bbox }, normal, center } };
  };
  const reply = (op: string, ok: boolean, result?: unknown, reason?: string): SeatReply => ({ ok, op, result, percept: look(), ...(reason ? { reason } : {}) });
  return {
    look, elements, follow, followPatch,
    select, selectEdge, selectVertex, selectFace, selectElements, nameSelection, extrude, extrudeEdge,
    connectVertices, createFace, bevel, inset, move, scale, scaleUniform, rotate, deleteSelection,
    mergeFaces, weld, weldPairs, normalizeWidths, solidify, detach, flip, glass, paint, paintReadiness, atlas, material, uv, save,
    undo, redo, symmetrize, loopCut, trisToQuads, collectUvOrientation, shellAction,
    addPrimitive, newPrimitive, shot, recipeList, runRecipe, reply,
  };
}

export type AgentSeat = ReturnType<typeof createAgentSeat>;
export type SeatRequest = { action: string; args?: Record<string, unknown> };

/** Transport-neutral request dispatcher used by the live editor and tests. */
export function executeSeatRequest(seat: AgentSeat, request: SeatRequest): SeatReply {
  const args = request.args ?? {};
  try {
    switch (request.action) {
      case 'semantic-status': {
        const result = (globalThis as any).__modelSemanticDiagnostics ?? null;
        return seat.reply('semantic-status', !!result, result ?? undefined, result ? undefined : 'Model Focus semantic diagnostics unavailable');
      }
      case 'look': return seat.reply('look', !!seat.look());
      case 'select': {
        const result = seat.select(String(args.selector ?? ''));
        return seat.reply('select', result.ok, result, result.reason);
      }
      case 'elements': {
        const result = seat.elements();
        return seat.reply('elements', !!result, result ?? undefined, result ? undefined : 'topology descriptors unavailable');
      }
      case 'follow': {
        const operation = String(args.operation ?? 'read');
        const result = seat.follow(operation, args);
        return seat.reply('follow', result.ok, result.result, result.reason);
      }
      case 'select-edge': {
        const ok = seat.selectEdge(Number(args.index), args.additive === true);
        return seat.reply('select-edge', ok, undefined, ok ? undefined : 'edge index is invalid, stale, or outside the active scope');
      }
      case 'select-vertex': {
        const ok = seat.selectVertex(Number(args.index), args.additive === true);
        return seat.reply('select-vertex', ok, undefined, ok ? undefined : 'vertex index is invalid, stale, or outside the active scope');
      }
      case 'select-face': {
        const ok = seat.selectFace(Number(args.index), args.additive === true);
        return seat.reply('select-face', ok, undefined, ok ? undefined : 'face index is invalid, stale, or outside the active scope');
      }
      case 'select-elements': {
        const kind = String(args.kind ?? 'face');
        if (kind !== 'face' && kind !== 'edge' && kind !== 'vertex') return seat.reply('select-elements', false, undefined, 'kind must be face, edge, or vertex');
        const changed = seat.selectElements(kind, args.indices);
        return seat.reply('select-elements', changed > 0, { changed }, changed > 0 ? undefined : 'no valid in-scope element indices were selected');
      }
      case 'name': {
        const changed = seat.nameSelection(String(args.name ?? ''), Number(args.instance ?? 0));
        return seat.reply('name', changed > 0, { changed }, changed > 0 ? undefined : 'no selected faces or invalid name');
      }
      case 'extrude': {
        const result = seat.extrude(Number(args.distance ?? 0), String(args.name ?? ''), Number(args.instance ?? 0));
        return seat.reply('extrude', !!result, result ?? undefined, result ? undefined : 'extrude rejected (selection, name, or naming debt)');
      }
      case 'extrude-edge': {
        const result = seat.extrudeEdge(Number(args.distance ?? 0));
        return seat.reply('extrude-edge', !!result, result ?? undefined, result ? undefined : 'select exactly one edge first');
      }
      case 'connect': {
        const result = seat.connectVertices();
        return seat.reply('connect', !!result, result ?? undefined, result ? undefined : 'select exactly two non-adjacent vertices on one face');
      }
      case 'create-face': {
        const result = seat.createFace(String(args.name ?? ''), Number(args.instance ?? 0));
        return seat.reply('create-face', !!result, result ?? undefined, result ? undefined : 'select two bridge edges or a closed 3/4-edge loop and provide a name');
      }
      case 'bevel': {
        const result = seat.bevel(Number(args.width ?? 0));
        return seat.reply('bevel', !!result, result ?? undefined, result ? undefined : 'select one bevelable edge or vertex and use a valid width');
      }
      case 'inset': {
        const result = seat.inset(
          Number(args.distance ?? 0.001), String(args.name ?? ''),
          args.pivot as [number, number, number],
          args.axes as [[number, number, number], [number, number, number]],
          args.factors as [number, number],
          (args.offset as [number, number, number]) ?? [0, 0, 0],
        );
        return seat.reply('inset', result.ok, result, result.ok ? undefined : `${result.stage}: ${result.reason}`);
      }
      case 'move': { const ok = seat.move(args.delta as [number, number, number]); return seat.reply('move', ok, undefined, ok ? undefined : 'transform rejected'); }
      case 'scale': { const ok = seat.scale(args.axis as [number, number, number], args.pivot as [number, number, number], Number(args.factor ?? 1)); return seat.reply('scale', ok, undefined, ok ? undefined : 'transform rejected'); }
      case 'scale-uniform': { const ok = seat.scaleUniform(Number(args.factor)); return seat.reply('scale-uniform', ok, undefined, ok ? undefined : 'uniform scale rejected'); }
      case 'rotate': { const ok = seat.rotate(args.axis as [number, number, number], args.pivot as [number, number, number], Number(args.degrees ?? 0)); return seat.reply('rotate', ok, undefined, ok ? undefined : 'transform rejected'); }
      case 'undo': { const result = seat.undo(); return seat.reply('undo', !!result, result ?? undefined, result ? undefined : 'nothing to undo'); }
      case 'redo': { const result = seat.redo(); return seat.reply('redo', !!result, result ?? undefined, result ? undefined : 'nothing to redo'); }
      case 'delete': { const result = seat.deleteSelection(); return seat.reply('delete', !!result, result ?? undefined, result ? undefined : 'nothing selected to delete'); }
      case 'merge-faces': { const result = seat.mergeFaces(); return seat.reply('merge-faces', !!result, result ?? undefined, result ? undefined : 'select two or more compatible faces'); }
      case 'weld': { const result = seat.weld(); return seat.reply('weld', !!result, result ?? undefined, result ? undefined : 'select at least two vertices or one edge'); }
      case 'weld-pairs': {
        const result = seat.weldPairs(args.pairs, args.maxDistance === undefined ? undefined : Number(args.maxDistance));
        return seat.reply('weld-pairs', !!result, result ?? undefined,
          result ? undefined : 'pairs must be unique in-scope same-part vertex ids; maxDistance is an optional positive metre leash');
      }
      case 'normalize-widths': {
        const result = seat.normalizeWidths(args.paths, Number(args.strength ?? 1));
        return seat.reply('normalize-widths', !!result, result ?? undefined,
          result ? undefined : 'paths must be disjoint ordered vertex rows joined by real edges; strength must be in (0,1]');
      }
      case 'solidify': { const result = seat.solidify(Number(args.thickness ?? 0)); return seat.reply('solidify', !!result, result ?? undefined, result ? undefined : 'select faces and provide a valid thickness'); }
      case 'detach': { const result = seat.detach(String(args.name ?? '')); return seat.reply('detach', !!result, result ?? undefined, result ? undefined : 'detach needs a named face selection in a multi-part document'); }
      case 'flip': { const result = seat.flip(); return seat.reply('flip', !!result, result ?? undefined, result ? undefined : 'select faces first'); }
      case 'glass': { const result = seat.glass(); return seat.reply('glass', !!result, result ?? undefined, result ? undefined : 'select faces first'); }
      case 'paint': {
        const readiness = seat.paintReadiness();
        if (!readiness.ok) return seat.reply('paint', false, readiness, readiness.reason);
        const changed = seat.paint(args.rgb as [number, number, number]);
        return seat.reply('paint', changed > 0, { changed }, changed > 0 ? undefined : 'select faces and use RGB bytes while the paint layout is current');
      }
      case 'atlas': {
        const result = seat.atlas(
          String(args.base ?? 'template') as 'template' | 'solid' | 'blank',
          (args.rgb as [number, number, number]) ?? [220, 220, 225],
          args.detail === undefined ? undefined : Number(args.detail),
          args.fit === undefined ? undefined : Number(args.fit),
        );
        return seat.reply('atlas', !!result, result ?? undefined, result ? undefined : 'the atlas could not rebuild — fit must be 512, 1024, 2048, or 4096, and detail a texels/meter integer ≥ 1');
      }
      case 'material': {
        const changed = seat.material(args.slot == null ? null : Number(args.slot));
        return seat.reply('material', changed > 0, { changed }, changed > 0 ? undefined : 'selection already has that material role or no faces are selected');
      }
      case 'uv': {
        const operation = String(args.operation ?? '') as 'restore' | 'auto-size' | 'project-view';
        const ok = seat.uv(operation);
        return seat.reply('uv', ok, undefined, ok ? undefined : 'no UV islands are selected or the operation was rejected');
      }
      case 'save': { const result = seat.save(); return seat.reply('save', result.ok, result.result, result.reason); }
      case 'mirror': {
        const result = seat.symmetrize(Number(args.axis ?? 0), args.keep !== false);
        return seat.reply('mirror', !!result, result ?? undefined, result ? undefined : 'symmetrize rejected');
      }
      case 'cut': {
        const result = seat.loopCut(Number(args.direction ?? 0), Number(args.cuts ?? 1), Number(args.offset ?? 0.5));
        return seat.reply('cut', !!result, result ?? undefined, result ? undefined : 'loop cut rejected — it needs a face selection to cut across');
      }
      case 'basic-cut': {
        const result = seat.loopCut(Number(args.direction ?? 0), Number(args.cuts ?? 1), Number(args.offset ?? 0.5), true);
        return seat.reply('basic-cut', !!result, result ?? undefined, result ? undefined : 'basic cut rejected — select one or more faces');
      }
      case 'tris-to-quads': {
        const result = seat.trisToQuads();
        return seat.reply('tris-to-quads', !!result, result ?? undefined, result ? undefined : 'no compatible triangle pairs were available');
      }
      case 'collect-uv-orientation': {
        const changed = seat.collectUvOrientation();
        return seat.reply('collect-uv-orientation', changed > 0, { changed }, changed > 0 ? undefined : 'select one face with an authored UV orientation first');
      }
      case 'add': {
        const spec: SeatPrimitiveSpec = {
          kind: String(args.kind ?? 'cube'),
          size: Number(args.size ?? 0.25),
          height: Number(args.height ?? 0.25),
          sides: Number(args.sides ?? 16),
          ...(Array.isArray(args.at) ? { at: args.at as [number, number, number] } : {}),
        };
        const range = seat.addPrimitive(spec, String(args.name ?? ''));
        return seat.reply('add', !!range, range ?? undefined, range ? undefined
          : 'add rejected — no primitive adapter wired, Paint is active, or no model is open');
      }
      case 'new': {
        const spec: SeatPrimitiveSpec = {
          kind: String(args.kind ?? 'cube'),
          size: Number(args.size ?? 1),
          height: Number(args.height ?? 1),
          sides: Number(args.sides ?? 16),
        };
        const ok = seat.newPrimitive(spec);
        return seat.reply('new', ok, ok ? { kind: spec.kind } : undefined, ok ? undefined
          : 'new rejected — unknown primitive or the editor shell bridge is unavailable');
      }
      case 'shot': {
        const path = String(args.path ?? '');
        const ok = seat.shot(path);
        return seat.reply('shot', ok, ok ? { path } : undefined, ok ? undefined
          : 'capture door unavailable — the cart must import runtime/capture.ts and the binary must be built with -Dhas-capture');
      }
      case 'recipe-list': return seat.reply('recipe-list', true, seat.recipeList());
      case 'recipe': {
        const result = seat.runRecipe(String(args.recipe ?? ''), (args.params as Record<string, unknown>) ?? {});
        return seat.reply('recipe', result.ok, result, result.reason);
      }
      case 'command':
      case 'part-select': case 'part-rename': case 'part-visibility': case 'part-delete':
      case 'part-duplicate': case 'part-merge': case 'part-path-array': case 'part-import':
      case 'parts-group': case 'parts-ungroup': case 'group-rename': case 'group-visibility':
      case 'group-duplicate': case 'group-dissolve': case 'outliner-move': case 'role-name':
      case 'model-rename': case 'model-import': case 'model-export': case 'model-starter':
      case 'viewport': case 'reference': case 'uv-state': case 'uv-select': case 'uv-layout':
      case 'uv-geometry': case 'uv-history': case 'uv-atlas': case 'uv-layer':
      case 'paint-tool': case 'paint-variant': case 'texture-slot': case 'rig': case 'path': {
        const result = seat.shellAction(request.action, args);
        return seat.reply(request.action, result.ok, result.result, result.reason);
      }
      default: return seat.reply(request.action, false, undefined, `unknown seat action "${request.action}"`);
    }
  } catch (error) {
    return seat.reply(request.action, false, undefined, error instanceof Error ? error.message : String(error));
  }
}
