// Agent Seat — the deliberately small TS boundary over the live model editor.
// It does not generate geometry. Every verb bottoms out in the same host doors
// used by ModelView, while semantic names make topology addressable after context
// loss. Transports (CLI/dev socket) are adapters around this module.

export const NO_SEMANTIC_ID = 0xffffffff;
export const DEFAULT_NAMING_DEBT_BUDGET = 8;

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
  regions: { id: number; faces: number; instances: number; bbox: [number, number, number, number, number, number] }[];
  table: SemanticTable;
  /** Shell-owned Outliner identity paired with the host-authored ranges. This is
   * durable parts.json data, not a reconstruction from semantic face names. */
  activePartId: string | null;
  parts: SeatPart[];
};
export type SelectorReceipt = { ok: boolean; faces?: number; bbox?: [number, number, number, number, number, number]; reason?: string };
export type TopologyReceipt = { ok: number; key?: string; count?: number; generation?: number; [key: string]: unknown };
export type InsetReceipt =
  | { ok: true; topology: TopologyReceipt; transforms: number }
  | { ok: false; stage: 'validate' | 'extrude' | 'scale-0' | 'scale-1' | 'offset'; reason: string };
export type SeatReply = { ok: boolean; op: string; result?: unknown; percept: SeatPercept | null; reason?: string };
export type SeatElements = {
  vertices: { id: number; at: [number, number, number] }[];
  edges: { id: number; vertices: [number, number] }[];
};

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
  /** Detach changes both native part ranges and the shell-owned Outliner table. */
  detachSelection?: (name: string) => { lo: number; hi: number } | null;
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

/** Compile the stable selector text agents use into the native query shape. */
export function compileSeatSelector(selector: string, percept: SeatPercept): Record<string, unknown> | null {
  const text = selector.trim();
  if (text === 'all') return { kind: 'all' };
  const named = regionByName(percept.table, text.replace(/^region:/, ''));
  if (named) return { kind: 'region', region: named.id };
  const facing = /^facing:([+-])([xyz])(?:@(\d+(?:\.\d+)?))?$/.exec(text);
  if (facing) return { kind: 'facing', axis: axisIndex(facing[2]!)!, sign: facing[1] === '+' ? 1 : -1, tolerance_degrees: Number(facing[3] ?? 15) };
  if (text === 'top') return { kind: 'extremal', axis: 1, sign: 1 };
  if (text === 'bottom') return { kind: 'extremal', axis: 1, sign: -1 };
  const extremal = /^outermost:([+-])([xyz])$/.exec(text);
  if (extremal) return { kind: 'extremal', axis: axisIndex(extremal[2]!)!, sign: extremal[1] === '+' ? 1 : -1 };
  const plane = /^(above|below):([xyz])([<>])(-?\d+(?:\.\d+)?)$/.exec(text);
  if (plane) return { kind: plane[1], axis: axisIndex(plane[2]!)!, threshold: Number(plane[4]) };
  const part = /^part:(\d+)\.\.(\d+)$/.exec(text);
  if (part) return { kind: 'part', lo: Number(part[1]), hi: Number(part[2]) };
  const box = /^inside:box\(([^)]+)\)$/.exec(text);
  if (box) {
    const values = box[1]!.split(',').map(Number);
    if (values.length === 6 && values.every(Number.isFinite)) return { kind: 'box', min: values.slice(0, 3), max: values.slice(3) };
  }
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

export function createAgentSeat(adapter: SeatAdapter = {}) {
  const debtBudget = adapter.namingDebtBudget ?? DEFAULT_NAMING_DEBT_BUDGET;
  let primitiveBootstrapAttempted = false;
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
    const query = compileSeatSelector(selector, percept);
    if (!query) return { ok: false, reason: `unknown selector "${selector}"` };
    // The seat's selection is face-only, and host ops gate on the edit MODE, not just the
    // selection set — meshLoopCutFaceBegin bails outright unless mode() == .face. Assert it
    // here rather than inside those verbs, because setting the mode clears the selection:
    // asserting it later would wipe the very faces the verb was handed.
    host.__mesh_edit_mode?.(3);
    return parseJson<SelectorReceipt>(host.__mesh_select_query?.(JSON.stringify(query))) ?? { ok: false, reason: 'selector door unavailable' };
  };
  const elements = (): SeatElements | null => parseJson<SeatElements>(host.__mesh_edit_elements?.());
  const selectEdge = (index: number, additive = false): boolean =>
    Number.isInteger(index) && index >= 0 && host.__mesh_edit_select_edge?.(index, additive ? 1 : 0) === 1;
  const selectVertex = (index: number, additive = false): boolean =>
    Number.isInteger(index) && index >= 0 && host.__mesh_edit_select_vertex?.(index, additive ? 1 : 0) === 1;
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
  const atlas = (base: 'template' | 'solid' | 'blank', rgb: [number, number, number], detail?: number): boolean => {
    if (!['template', 'solid', 'blank'].includes(base) || !rgbBytes(rgb) ||
        (detail !== undefined && (!Number.isInteger(detail) || detail < 1))) return false;
    const mode = base === 'solid' ? 1 : base === 'blank' ? 2 : 0;
    if (automation(() => host.__model_atlas_base?.(mode, ...rgb)) !== 1) return false;
    return detail === undefined || Number(automation(() => host.__model_set_paint_detail?.(detail)) ?? -1) >= 0;
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
  const save = (): boolean => adapter.persist?.() === true;
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
  const loopCut = (direction: number, cuts: number, offsetFraction: number): TopologyReceipt | null => {
    if (parseJson<{ ok?: number }>(host.__mesh_lc_begin?.(0))?.ok !== 1) return null;
    const preview = parseJson<{ ok?: number; fallbackReason?: string }>(host.__mesh_lc_preview?.(direction, cuts, offsetFraction));
    if (preview?.ok !== 1) { host.__mesh_lc_end?.(0); return null; } // cancel restores the pre-cut mesh exactly
    const result = readTopology(automation(() => host.__mesh_lc_end?.(1)));
    adapter.adoptTopology?.(result);
    return result;
  };
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
    select(`part:${range.lo}..${range.hi}`);
    const declared = declareRegion(before?.table ?? { version: 1, regions: [] }, name, 'part', `add ${spec.kind}`, adapter.take?.());
    // One assign both names the new part AND writes the merged table back, repairing the reset.
    host.__mesh_semantic_assign?.(declared.region.id, 0, JSON.stringify(declared.table));
    return range;
  };
  const newPrimitive = (spec: SeatPrimitiveSpec): boolean => adapter.newPrimitive?.(spec) === true;
  const shot = (path: string): boolean => adapter.captureFrame?.(path) === true;
  const reply = (op: string, ok: boolean, result?: unknown, reason?: string): SeatReply => ({ ok, op, result, percept: look(), ...(reason ? { reason } : {}) });
  return {
    look, elements, select, selectEdge, selectVertex, nameSelection, extrude, extrudeEdge,
    connectVertices, createFace, bevel, inset, move, scale, rotate, deleteSelection,
    mergeFaces, weld, solidify, detach, flip, glass, paint, atlas, material, uv, save,
    undo, redo, symmetrize, loopCut, addPrimitive, newPrimitive, shot, reply,
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
      case 'select-edge': {
        const ok = seat.selectEdge(Number(args.index), args.additive === true);
        return seat.reply('select-edge', ok, undefined, ok ? undefined : 'edge index is invalid, stale, or outside the active scope');
      }
      case 'select-vertex': {
        const ok = seat.selectVertex(Number(args.index), args.additive === true);
        return seat.reply('select-vertex', ok, undefined, ok ? undefined : 'vertex index is invalid, stale, or outside the active scope');
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
      case 'rotate': { const ok = seat.rotate(args.axis as [number, number, number], args.pivot as [number, number, number], Number(args.degrees ?? 0)); return seat.reply('rotate', ok, undefined, ok ? undefined : 'transform rejected'); }
      case 'undo': { const result = seat.undo(); return seat.reply('undo', !!result, result ?? undefined, result ? undefined : 'nothing to undo'); }
      case 'redo': { const result = seat.redo(); return seat.reply('redo', !!result, result ?? undefined, result ? undefined : 'nothing to redo'); }
      case 'delete': { const result = seat.deleteSelection(); return seat.reply('delete', !!result, result ?? undefined, result ? undefined : 'nothing selected to delete'); }
      case 'merge-faces': { const result = seat.mergeFaces(); return seat.reply('merge-faces', !!result, result ?? undefined, result ? undefined : 'select two or more compatible faces'); }
      case 'weld': { const result = seat.weld(); return seat.reply('weld', !!result, result ?? undefined, result ? undefined : 'select at least two vertices or one edge'); }
      case 'solidify': { const result = seat.solidify(Number(args.thickness ?? 0)); return seat.reply('solidify', !!result, result ?? undefined, result ? undefined : 'select faces and provide a valid thickness'); }
      case 'detach': { const result = seat.detach(String(args.name ?? '')); return seat.reply('detach', !!result, result ?? undefined, result ? undefined : 'detach needs a named face selection in a multi-part document'); }
      case 'flip': { const result = seat.flip(); return seat.reply('flip', !!result, result ?? undefined, result ? undefined : 'select faces first'); }
      case 'glass': { const result = seat.glass(); return seat.reply('glass', !!result, result ?? undefined, result ? undefined : 'select faces first'); }
      case 'paint': {
        const changed = seat.paint(args.rgb as [number, number, number]);
        return seat.reply('paint', changed > 0, { changed }, changed > 0 ? undefined : 'select faces and use RGB bytes while the paint layout is current');
      }
      case 'atlas': {
        const ok = seat.atlas(
          String(args.base ?? 'template') as 'template' | 'solid' | 'blank',
          (args.rgb as [number, number, number]) ?? [220, 220, 225],
          args.detail === undefined ? undefined : Number(args.detail),
        );
        return seat.reply('atlas', ok, undefined, ok ? undefined : 'the active model could not rebuild its paint atlas');
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
      case 'save': { const ok = seat.save(); return seat.reply('save', ok, undefined, ok ? undefined : 'the shell could not persist the active model package'); }
      case 'mirror': {
        const result = seat.symmetrize(Number(args.axis ?? 0), args.keep !== false);
        return seat.reply('mirror', !!result, result ?? undefined, result ? undefined : 'symmetrize rejected');
      }
      case 'cut': {
        const result = seat.loopCut(Number(args.direction ?? 0), Number(args.cuts ?? 1), Number(args.offset ?? 0.5));
        return seat.reply('cut', !!result, result ?? undefined, result ? undefined : 'loop cut rejected — it needs a face selection to cut across');
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
      default: return seat.reply(request.action, false, undefined, `unknown seat action "${request.action}"`);
    }
  } catch (error) {
    return seat.reply(request.action, false, undefined, error instanceof Error ? error.message : String(error));
  }
}
