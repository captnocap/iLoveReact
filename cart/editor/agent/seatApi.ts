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
export type SeatPercept = {
  version: 1;
  generation: number;
  faces: number;
  unnamed: number;
  regions: { id: number; faces: number; instances: number; bbox: [number, number, number, number, number, number] }[];
  table: SemanticTable;
};
export type SelectorReceipt = { ok: boolean; faces?: number; bbox?: [number, number, number, number, number, number]; reason?: string };
export type TopologyReceipt = { ok: number; key?: string; count?: number; generation?: number; [key: string]: unknown };
export type SeatReply = { ok: boolean; op: string; result?: unknown; percept: SeatPercept | null; reason?: string };

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
  /** Frame self-capture (SELFSHOT-0606). Absent unless the cart imports
   *  runtime/capture.ts AND the binary carries -Dhas-capture. Never touches the
   *  desktop: it reads back the frame the app itself composed. */
  captureFrame?: (path: string) => boolean;
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
  return value;
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
  for (const row of percept.regions) lines.push(`  ${names.get(row.id) ?? `region:${row.id}`}  ${row.faces} faces${row.instances > 1 ? ` ×${row.instances}` : ''}  bbox ${row.bbox.join(',')}`);
  if (percept.unnamed > 0) lines.push(`  ⚠ unnamed  ${percept.unnamed}`);
  return lines.join('\n');
}

export function createAgentSeat(adapter: SeatAdapter = {}) {
  const debtBudget = adapter.namingDebtBudget ?? DEFAULT_NAMING_DEBT_BUDGET;
  let primitiveBootstrapAttempted = false;
  const look = (): SeatPercept | null => {
    const initial = readSeatPercept();
    if (!initial || primitiveBootstrapAttempted || initial.table.regions.length > 0 || initial.unnamed !== initial.faces || initial.faces < 6 || initial.faces > 12) return initial;
    primitiveBootstrapAttempted = true;
    let table = initial.table;
    const ids: number[] = [];
    for (const [name, role] of [['right', '+x'], ['left', '-x'], ['top', '+y'], ['bottom', '-y'], ['back', '+z'], ['front', '-z']] as const) {
      const declared = declareRegion(table, name, role, 'new cube', adapter.take?.());
      table = declared.table;
      ids.push(declared.region.id);
    }
    if (host.__mesh_semantic_bootstrap_axes?.(new Uint32Array(ids), JSON.stringify(table)) === 1) return readSeatPercept();
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
  const nameSelection = (name: string, instance = 0, role = 'authored', op = 'name'): number => {
    const percept = look();
    if (!percept || !name || name === '_') return 0;
    const declared = declareRegion(percept.table, name, role, op, adapter.take?.());
    return Number(host.__mesh_semantic_assign?.(declared.region.id, instance, JSON.stringify(declared.table)) ?? 0);
  };
  const extrude = (distance: number, name: string, instance = 0): TopologyReceipt | null => {
    const before = look();
    if (!before) return null;
    if (!name || name === '_') {
      if (before.unnamed > debtBudget) return null;
      const result = readTopology(host.__mesh_topo_extrude_face?.(distance));
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
    const result = readTopology(host.__mesh_topo_extrude_face?.(distance));
    adapter.adoptTopology?.(result);
    return result;
  };
  const move = (delta: [number, number, number]) => host.__mesh_transform_translate?.(...delta) === 1;
  const scale = (axis: [number, number, number], pivot: [number, number, number], factor: number) => host.__mesh_transform_scale_axis?.(...axis, ...pivot, factor) === 1;
  const rotate = (axis: [number, number, number], pivot: [number, number, number], degrees: number) => host.__mesh_transform_rotate_axis?.(...axis, ...pivot, degrees * Math.PI / 180) === 1;
  const undo = (): TopologyReceipt | null => { const result = readTopology(host.__mesh_undo?.()); adapter.adoptTopology?.(result); return result; };
  const redo = (): TopologyReceipt | null => { const result = readTopology(host.__mesh_redo?.()); adapter.adoptTopology?.(result); return result; };
  /** Mirror the mesh exactly across an axis plane (0 = X, 1 = Y, 2 = Z), keeping the
   *  +side or the −side. One host op, journaled — the seat never hand-computes a
   *  reflection, which is what made mirrored features drift when it could not. */
  const symmetrize = (axis: number, keepPositive: boolean): TopologyReceipt | null => {
    const result = readTopology(host.__mesh_symmetrize?.(axis, keepPositive ? 1 : 0));
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
    const result = readTopology(host.__mesh_lc_end?.(1));
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
  const shot = (path: string): boolean => adapter.captureFrame?.(path) === true;
  const reply = (op: string, ok: boolean, result?: unknown, reason?: string): SeatReply => ({ ok, op, result, percept: look(), ...(reason ? { reason } : {}) });
  return { look, select, nameSelection, extrude, move, scale, rotate, undo, redo, symmetrize, loopCut, addPrimitive, shot, reply };
}

export type AgentSeat = ReturnType<typeof createAgentSeat>;
export type SeatRequest = { action: string; args?: Record<string, unknown> };

/** Transport-neutral request dispatcher used by the live editor and tests. */
export function executeSeatRequest(seat: AgentSeat, request: SeatRequest): SeatReply {
  const args = request.args ?? {};
  try {
    switch (request.action) {
      case 'look': return seat.reply('look', !!seat.look());
      case 'select': {
        const result = seat.select(String(args.selector ?? ''));
        return seat.reply('select', result.ok, result, result.reason);
      }
      case 'name': {
        const changed = seat.nameSelection(String(args.name ?? ''), Number(args.instance ?? 0));
        return seat.reply('name', changed > 0, { changed }, changed > 0 ? undefined : 'no selected faces or invalid name');
      }
      case 'extrude': {
        const result = seat.extrude(Number(args.distance ?? 0), String(args.name ?? ''), Number(args.instance ?? 0));
        return seat.reply('extrude', !!result, result ?? undefined, result ? undefined : 'extrude rejected (selection, name, or naming debt)');
      }
      case 'move': { const ok = seat.move(args.delta as [number, number, number]); return seat.reply('move', ok, undefined, ok ? undefined : 'transform rejected'); }
      case 'scale': { const ok = seat.scale(args.axis as [number, number, number], args.pivot as [number, number, number], Number(args.factor ?? 1)); return seat.reply('scale', ok, undefined, ok ? undefined : 'transform rejected'); }
      case 'rotate': { const ok = seat.rotate(args.axis as [number, number, number], args.pivot as [number, number, number], Number(args.degrees ?? 0)); return seat.reply('rotate', ok, undefined, ok ? undefined : 'transform rejected'); }
      case 'undo': { const result = seat.undo(); return seat.reply('undo', !!result, result ?? undefined, result ? undefined : 'nothing to undo'); }
      case 'redo': { const result = seat.redo(); return seat.reply('redo', !!result, result ?? undefined, result ? undefined : 'nothing to redo'); }
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
