// Agent Seat — the deliberately small TS boundary over the live model editor.
// It does not generate geometry. Every verb bottoms out in the same host doors
// used by ModelView, while semantic names make topology addressable after context
// loss. Transports (CLI/dev socket) are adapters around this module.

import { countUvTextureFootprints, parseUvIslandRects } from '../model/uvLayout';
import {
  describeCreateFaceReadiness,
  modelSelectionModeName,
  parseModelSelectionSnapshot,
  type CreateFaceReadiness,
  type ModelSelectionSnapshot,
} from '../model/modelSelectionFocus';
import {
  NO_SEMANTIC_ID,
  declareRegion,
  type MeshSemanticRegion as SemanticRegion,
  type MeshSemanticTable as SemanticTable,
} from '../model/meshSemantics';
import { claimActiveModel, claimAdmits, claimHolder, claimModel, dismissClaim, listClaims } from './claims';
import {
  CONTACT_EPSILON,
  axisIndexOf,
  boundaryLoopCount,
  boxFacts,
  boxOfPoints,
  boxSize,
  findAnomalies,
  isBox,
  measureContact,
  measureDistance,
  measureSymmetry,
  planAlign,
  spread,
  triangleEdgeLengths,
  unionBoxes,
  type SeatBox,
} from './seatGeometry';
import {
  appendNote,
  dropNote,
  emptyNoteBook,
  isNoteBook,
  parseNoteKind,
  summarizeNotes,
  type SeatNoteBook,
} from './seatNotes';
import { classifyByCorpus, isClassCorpus } from './seatClassSpec';
import {
  ORACLE_PLANS,
  advanceSession,
  askCorpus,
  currentPhase,
  isComplete,
  startSession,
  viewSession,
  type OracleDocReader,
  type OracleFacts,
  type OracleSession,
} from './seatOracle';
import type { CharacterRigSeatStatus } from './characterRigSeat';

export { NO_SEMANTIC_ID, declareRegion } from '../model/meshSemantics';
export type { MeshSemanticRegion as SemanticRegion, MeshSemanticTable as SemanticTable } from '../model/meshSemantics';
export const DEFAULT_NAMING_DEBT_BUDGET = 8;
const PAINT_ATLAS_TUNING = {
  minMedianIslandTexels: 8,
  fitLevels: [512, 1024, 2048, 4096] as readonly number[],
  defaultFit: 1024,
};

const host = globalThis as any;

export type SeatPart = {
  id: string;
  name: string;
  kind: string | null;
  visible: boolean;
  lo: number | null;
  hi: number | null;
  groupPath: { id: string; name: string }[];
};
export type SeatPartPercept = { model?: string | null; activePartId: string | null; parts: SeatPart[] };
export type SeatPercept = {
  version: 1;
  model: string | null;
  generation: number;
  /** RENDER TRIANGLES, not authored faces. Two triangles of one authored quad count
   * twice here, so this number alone cannot tell a quad mesh from triangle soup —
   * read `authoredFaces` for that. */
  faces: number;
  /** Distinct authored face groups: the quads and n-gons the modeller actually made.
   * `faces === authoredFaces` means every quad has been split into loose triangles.
   * Null when no atlas is readable yet and the grouping cannot be observed. */
  authoredFaces: number | null;
  /** Did the host measure the geometry facts below? False means the mesh was over
   * budget, so the counts are UNMEASURED, not zero. Undefined on a pre-audit host. */
  auditComputed?: boolean;
  /** Triangles that pass through another triangle. Sharing an edge or meeting on an
   * exact plane is correct topology and is not counted. */
  intersectingFaces?: number;
  /** Triangles no sampled direction escapes — geometry sealed inside other geometry,
   * reachable by no camera and deserving of no UV island. */
  unreachableFaces?: number;
  /** Directions sampled per face by the reachability pass. */
  auditDirections?: number;
  /** Logical UV islands in the resident atlas. Zero means no readable atlas yet. */
  islands: number;
  /** Exact coverage-compatible texture footprints after stacking. */
  footprints: number;
  unnamed: number;
  /** Regions still carrying geometry that a GENERATOR named, not a person: the
   * naming debt an intentional pass must clear (req_3961). */
  placeholders: number;
  /** Triangles under those regions. */
  placeholderFaces: number;
  hiddenFaces?: number;
  hiddenNamedFaces?: number;
  hiddenRegions?: number;
  regions: { id: number; faces: number; instances: number; bbox: [number, number, number, number, number, number] }[];
  table: SemanticTable;
  /** Ambient workflow position (req_4053). Present on EVERY reply once a plan is
   * running, so an agent is reminded where it is and how much debt stands between it
   * and the next phase without having to remember to ask. Cheap by construction: it
   * counts only percept-derivable and already-attested checks — `oracle status` is
   * what pays for the disk and diagnostics reads. */
  oracle?: { phase: string; blocked: number; plan: string; position: string };
  /** Ambient resident character-rig debt. Null means no attached/open native
   * character rig; a value is the same structured matrix as `rig-status`. */
  rig?: CharacterRigSeatStatus | null;
  /** Shell-owned Outliner identity paired with the host-authored ranges. This is
   * durable parts.json data, not a reconstruction from semantic face names. */
  activePartId: string | null;
  parts: SeatPart[];
};
/** `unmatchedSources` belongs to `mirror:` alone — how many faces of the source selection
 * had nothing standing at their reflection. A partial mirror otherwise reads as a clean one. */
export type SelectorReceipt = { ok: boolean; faces?: number; actionableFaces?: number; unmatchedSources?: number; bbox?: [number, number, number, number, number, number]; reason?: string };
export type TopologyReceipt = { ok: number; key?: string; count?: number; generation?: number; [key: string]: unknown };
/** mirror-quads receipt counters — present even on ok:0 so a zero explains itself. */
export type MirrorQuadStats = { ok?: number; changed?: number; quads?: number; symmetric?: number; pairs?: number; refused?: number };
/** mirror-replace receipt counters — present even on ok:0 so a zero explains itself. */
export type MirrorReplaceStats = { ok?: number; changed?: number; copied?: number; replaced?: number; welded?: number; seam?: number };
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
  edges: { id: number; vertices: [number, number]; faces: number; open: boolean }[];
};
/** The resident selection with its mode spelled out, plus the Create Face gate ladder
 *  read against it. `elements` describes the MESH; this describes what is selected in it. */
export type SeatSelectionReport = Omit<ModelSelectionSnapshot, 'mode'> & {
  mode: 'view' | 'vertex' | 'edge' | 'face';
  createFace: CreateFaceReadiness;
};
export type SeatBoundaryContinuation = {
  open: [number, number];
  endpoints: [
    { vertex: number; at: [number, number, number]; candidates: { edge: number; vertices: [number, number]; next: number; at: [number, number, number] }[] },
    { vertex: number; at: [number, number, number]; candidates: { edge: number; vertices: [number, number]; next: number; at: [number, number, number] }[] },
  ];
  pairs: { edges: [[number, number], [number, number]]; forward: [number, number] }[];
};
export type SeatDeletedBoundary = {
  version: 1;
  deletedFaces: number;
  components: {
    closed: boolean;
    branched: boolean;
    vertices: number[];
    at: [number, number, number][];
    outside: (number | null)[];
    nonManifold: boolean[];
    bbox: [number, number, number, number, number, number];
  }[];
};
export type SeatRetopoBandPlan = {
  version: 1;
  mode: 'axis' | 'rails' | 'manual';
  axis: 'x' | 'y' | 'z';
  width: number;
  origin: number;
  railSamples: number;
  faces: number;
  covered: number;
  bands: {
    id: number;
    bucket: number;
    faces: number;
    range: [number, number];
    bbox: [number, number, number, number, number, number];
    color: [number, number, number];
  }[];
};
export type SeatRetopoSourceGhost = {
  captured: true;
  visible: boolean;
  faces: number;
  covered: number;
  generation: number;
};

/** Recover the ordered lower/upper cross-sections of a demonstrated quad strip.
 * Every authored quad is two triangles/four vertices; consecutive quads share
 * exactly one cross edge. The two unshared vertices at each end are the caps. */
export function retopoRailPairsFromPatch(patch: SeatFollowPatch): Float32Array | null {
  const selected = patch.triangles.filter((triangle) => triangle.selected);
  const positions = new Map(patch.vertices.map((vertex) => [vertex.id, vertex.at] as const));
  const groups = new Map<number, Set<number>>();
  for (const triangle of selected) {
    const vertices = groups.get(triangle.group) ?? new Set<number>();
    triangle.vertices.forEach((vertex) => vertices.add(vertex));
    groups.set(triangle.group, vertices);
  }
  const ids = [...groups.keys()];
  if (ids.length < 2 || ids.some((id) => groups.get(id)?.size !== 4)) return null;
  const adjacency = new Map<number, { id: number; edge: [number, number] }[]>();
  ids.forEach((id) => adjacency.set(id, []));
  for (let left = 0; left < ids.length; left += 1) {
    for (let right = left + 1; right < ids.length; right += 1) {
      const a = ids[left]!;
      const b = ids[right]!;
      const shared = [...groups.get(a)!].filter((vertex) => groups.get(b)!.has(vertex));
      if (shared.length !== 2) continue;
      adjacency.get(a)!.push({ id: b, edge: [shared[0]!, shared[1]!] });
      adjacency.get(b)!.push({ id: a, edge: [shared[0]!, shared[1]!] });
    }
  }
  const ends = ids.filter((id) => adjacency.get(id)!.length === 1);
  if (ends.length !== 2 || ids.some((id) => adjacency.get(id)!.length < 1 || adjacency.get(id)!.length > 2)) return null;
  const order: number[] = [];
  let prior: number | null = null;
  let current = ends[0]!;
  while (order.length < ids.length) {
    order.push(current);
    const next = adjacency.get(current)!.find((row) => row.id !== prior)?.id;
    if (next === undefined) break;
    prior = current;
    current = next;
  }
  if (order.length !== ids.length || new Set(order).size !== ids.length) return null;
  const sharedEdge = (a: number, b: number): [number, number] | null => adjacency.get(a)!.find((row) => row.id === b)?.edge ?? null;
  const firstShared = sharedEdge(order[0]!, order[1]!);
  const lastShared = sharedEdge(order[order.length - 2]!, order[order.length - 1]!);
  if (!firstShared || !lastShared) return null;
  const pairs: [number, number][] = [
    [...groups.get(order[0]!)!].filter((vertex) => !firstShared.includes(vertex)) as [number, number],
  ];
  for (let at = 0; at + 1 < order.length; at += 1) {
    const edge = sharedEdge(order[at]!, order[at + 1]!);
    if (!edge) return null;
    pairs.push(edge);
  }
  pairs.push([...groups.get(order[order.length - 1]!)!].filter((vertex) => !lastShared.includes(vertex)) as [number, number]);
  if (pairs.some((pair) => pair.length !== 2)) return null;
  const flattened: number[] = [];
  for (const pair of pairs) {
    const a = positions.get(pair[0]);
    const b = positions.get(pair[1]);
    if (!a || !b || a[1] === b[1]) return null;
    const lower = a[1] < b[1] ? a : b;
    const upper = a[1] < b[1] ? b : a;
    flattened.push(...lower, ...upper);
  }
  return new Float32Array(flattened);
}
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

export function deletedBoundaryFromPatch(patch: SeatFollowPatch): SeatDeletedBoundary | null {
  const positions = new Map(patch.vertices.map((vertex) => [vertex.id, vertex.at] as const));
  const incident = new Map<number, number[]>();
  for (let index = 0; index < patch.frontier.length; index += 1) {
    const edge = patch.frontier[index]!;
    if (!positions.has(edge.vertices[0]) || !positions.has(edge.vertices[1])) return null;
    for (const vertex of edge.vertices) incident.set(vertex, [...(incident.get(vertex) ?? []), index]);
  }
  const remaining = new Set(patch.frontier.map((_, index) => index));
  const components: SeatDeletedBoundary['components'] = [];
  while (remaining.size > 0) {
    const seed = remaining.values().next().value as number;
    const memberEdges = new Set<number>();
    const memberVertices = new Set<number>();
    const stack = [...patch.frontier[seed]!.vertices];
    while (stack.length > 0) {
      const vertex = stack.pop()!;
      if (memberVertices.has(vertex)) continue;
      memberVertices.add(vertex);
      for (const edgeIndex of incident.get(vertex) ?? []) {
        memberEdges.add(edgeIndex);
        stack.push(...patch.frontier[edgeIndex]!.vertices);
      }
    }
    memberEdges.forEach((index) => remaining.delete(index));
    const ends = [...memberVertices].filter((vertex) => (incident.get(vertex)?.filter((edge) => memberEdges.has(edge)).length ?? 0) === 1);
    const branched = [...memberVertices].some((vertex) => (incident.get(vertex)?.filter((edge) => memberEdges.has(edge)).length ?? 0) > 2);
    const closed = !branched && ends.length === 0 && memberEdges.size === memberVertices.size;
    const start = ends.length === 2 ? Math.min(...ends) : Math.min(...memberVertices);
    const orderedVertices: number[] = [start];
    const orderedEdges: number[] = [];
    const unused = new Set(memberEdges);
    let current = start;
    while (unused.size > 0 && !branched) {
      const edgeIndex = (incident.get(current) ?? []).find((index) => unused.has(index));
      if (edgeIndex === undefined) break;
      unused.delete(edgeIndex);
      orderedEdges.push(edgeIndex);
      const edge = patch.frontier[edgeIndex]!;
      current = edge.vertices[0] === current ? edge.vertices[1] : edge.vertices[0];
      if (!(closed && current === start)) orderedVertices.push(current);
    }
    const vertices = branched || unused.size > 0 ? [...memberVertices].sort((a, b) => a - b) : orderedVertices;
    const edgeOrder = branched || unused.size > 0 ? [...memberEdges].sort((a, b) => a - b) : orderedEdges;
    const at = vertices.map((vertex) => positions.get(vertex)!);
    const bbox: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const point of at) for (let axis = 0; axis < 3; axis += 1) {
      bbox[axis] = Math.min(bbox[axis], point[axis]);
      bbox[axis + 3] = Math.max(bbox[axis + 3], point[axis]);
    }
    components.push({
      closed, branched: branched || unused.size > 0, vertices, at,
      outside: edgeOrder.map((index) => patch.frontier[index]!.outside),
      nonManifold: edgeOrder.map((index) => patch.frontier[index]!.nonManifold),
      bbox,
    });
  }
  components.sort((a, b) => b.vertices.length - a.vertices.length);
  return { version: 1, deletedFaces: patch.selectedTriangles.length, components };
}
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
export type SeatFollowEvent = {
  index: number;
  kind: number;
  source: string;
  at: number;
  before: unknown;
  after: unknown;
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
  /** Append-only authority. Examples below are only a derived convenience view. */
  events: SeatFollowEvent[];
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
  /** Resident transforms do not re-key the mesh, so they must explicitly tell
   * the shell that the document no longer matches its on-disk package. */
  documentMutated?: () => void;
  selectionChanged?: () => void;
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
  shotOffscreen?: (path: string, width: number, height: number, pose: number[] | null) => boolean;
  /** Full package save through AppFrame: meshdoc v4, semantic table, parts,
   *  atlas, and package metadata cross the cold-restart boundary together. */
  persist?: () => boolean;
  /** Retopology tint/ghost mutations persist immediately into the active model
   * package; false means the live change landed but its cold-restart record did not. */
  retopoStateChanged?: (clearWhenAbsent?: boolean) => boolean;
  /** Per-model handoff notes. Written into the model package when it has a dir on disk
   *  (so the handoff survives a cold restart) and held in hot state otherwise; `write`
   *  returns whether the note actually landed somewhere durable. */
  noteState?: {
    read: (model: string | null) => unknown;
    write: (model: string | null, book: unknown) => boolean;
  };
  /** The curated class corpus: approved exemplars in, derived specs out, plus the
   *  append-only telemetry log. Human-gated by construction — the shell only ever
   *  records a verdict a person asked for. */
  corpus?: {
    readCorpus: () => unknown;
    approve: (classId: string, model: string, verdict: 'approved' | 'rejected', reason: string | null, by: string) => SeatShellReceipt;
    spec: (classId: string) => SeatShellReceipt;
    logTelemetry: (row: unknown) => void;
    telemetry: () => SeatShellReceipt;
  };
  /** Read one phase slice of the agent-seat corpus by name. The docs live as markdown
   *  under .agents/skills/agent-seat/corpus/ so they stay reviewable and editable in
   *  the repo; the oracle only routes them. Absent = phases run on checklists alone. */
  readSkillDoc?: (name: string) => string | null;
  /** Live shell-owned Outliner names and hierarchy. The native semantic state
   *  intentionally knows geometry only; the seat joins both truths at look time. */
  partPercept?: () => SeatPartPercept;
  /** Cached compact character-rig state. Reading a Seat reply must never poll
   * native or acquire the viewport, so the shell supplies its latest snapshot. */
  rigPercept?: () => CharacterRigSeatStatus | null;
  /** Existing shell/Outliner/focus-panel authority for human-facing commands
   *  whose truth is cart-owned rather than a native mesh operation. */
  shellAction?: (action: string, args: Record<string, unknown>) => SeatShellReceipt;
  /** The same atlas transaction used by the visible Create Paint Atlas dialog.
   * It owns the cart-side paint gate, package persistence, and Paint entry. */
  createAtlasAndPaint?: (request: {
    base: 'template' | 'solid' | 'blank';
    rgb: [number, number, number];
    detail?: number;
    fit?: number;
  }) => AtlasReceipt | null;
  /** Detach changes both native part ranges and the shell-owned Outliner table. */
  detachSelection?: (name: string) => { lo: number; hi: number } | null;
  /** Follow is short-lived editor working state. It survives a dev hot reload in
   * the existing hot-state twig, but deliberately resets on a cold process. */
  followState?: {
    read: () => SeatFollowSession | null;
    write: (state: SeatFollowSession | null) => void;
  };
  /** The oracle's plan cursor rides the same hot-state twig as Follow, so a JS hot
   *  reload does not silently drop an agent's workflow position mid-plan. It is
   *  deliberately the ONLY oracle state that persists — every exit criterion is
   *  recomputed from the live model, so a reconnecting agent gets real answers rather
   *  than a remembered verdict. */
  oracleState?: {
    read: () => OracleSession | null;
    write: (state: OracleSession | null) => void;
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

/** Distinct authored face groups behind the resident triangles. `__model_atlas_read`
 * emits `triangles` as [island, faceGroup, x0,y0, x1,y1, x2,y2] — slot 1 is the
 * authored group every triangle belongs to, which is the only observable that separates
 * a real quad mesh from the same vertices flattened into loose triangles. Null when no
 * atlas is readable, because "unknown" must never be reported as "no quads". */
function countAuthoredFaces(triangles: readonly number[] | undefined): number | null {
  if (!Array.isArray(triangles) || triangles.length === 0 || triangles.length % 8 !== 0) return null;
  const groups = new Set<number>();
  for (let at = 1; at < triangles.length; at += 8) groups.add(triangles[at]!);
  return groups.size;
}

function measurePlaceholderRegions(
  regions: SeatPercept['regions'],
  table: SemanticTable,
): Pick<SeatPercept, 'placeholders' | 'placeholderFaces'> {
  const provenance = new Map(table.regions.map((region) => [region.id, region.createdBy?.op]));
  let placeholders = 0;
  let placeholderFaces = 0;
  for (const region of regions) {
    if (region.faces <= 0) continue;
    const op = provenance.get(region.id);
    // Missing provenance belongs to an older saved blob. Treat it as intentional:
    // a lossy historical boundary must never lock a person out of their model.
    if (typeof op !== 'string' || (!op.startsWith('new ') && !op.startsWith('add '))) continue;
    placeholders += 1;
    placeholderFaces += region.faces;
  }
  return { placeholders, placeholderFaces };
}

export function readSeatPercept(): SeatPercept | null {
  const value = parseJson<SeatPercept>(host.__mesh_semantic_state?.());
  if (!value || value.version !== 1 || !Array.isArray(value.regions) || value.table?.version !== 1) return null;
  const atlas = parseJson<{ islands?: number[]; groups?: number[]; triangles?: number[]; cornerVertices?: number[] }>(host.__model_atlas_read?.(0));
  const islands = Array.isArray(atlas?.islands) && atlas.islands.length % 4 === 0
    ? atlas.islands.length / 4
    : 0;
  const footprints = countUvTextureFootprints(parseUvIslandRects(
    atlas?.islands,
    atlas?.groups,
    atlas?.triangles,
    atlas?.cornerVertices,
  ));
  return {
    ...value,
    model: null,
    islands,
    footprints,
    authoredFaces: countAuthoredFaces(atlas?.triangles),
    ...measurePlaceholderRegions(value.regions, value.table),
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
  // The counterpart of a named surface is reachable without being named first: select the
  // source, then mirror it. Twins are paired positionally across the model-origin plane,
  // so this is the read-only sibling of mirror-quads/mirror-replace rather than a second
  // notion of symmetry. The optional @<metres> widens the match for an imperfect import.
  const mirror = /^mirror:([xyz])(?:@(\d+(?:\.\d+)?))?$/.exec(text);
  if (mirror) return { kind: 'mirror', axis: axisIndex(mirror[1]!)!, epsilon: Number(mirror[2] ?? 0.0001) };
  if (text === 'top' || text === 'extremal:top') return { kind: 'extremal', axis: 1, sign: 1 };
  if (text === 'bottom' || text === 'extremal:bottom') return { kind: 'extremal', axis: 1, sign: -1 };
  const extremal = /^outermost:([+-])([xyz])$/.exec(text);
  if (extremal) return { kind: 'extremal', axis: axisIndex(extremal[2]!)!, sign: extremal[1] === '+' ? 1 : -1 };
  const plane = /^(above|below):([xyz])([<>])(-?\d+(?:\.\d+)?)$/.exec(text);
  if (plane) return { kind: plane[1], axis: axisIndex(plane[2]!)!, threshold: Number(plane[4]) };
  const groups = /^groups:(\d+)\.\.(\d+)$/.exec(text);
  if (groups) return { kind: 'part', lo: Number(groups[1]), hi: Number(groups[2]) };
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

/** The two hard facts, on every reply (req_3749). Nothing here refuses anything — a
 * threshold would just teach a model to launder around it, while these counts only
 * fall when the mesh is actually fixed. Never prints a zero it did not measure. */
export function formatGeometryFacts(percept: SeatPercept): string {
  if (percept.auditComputed === undefined) return 'geometry facts unavailable — host predates the audit pass';
  if (!percept.auditComputed) return 'geometry facts NOT MEASURED — mesh over the audit budget; treat the counts as unknown, not clean';
  const intersecting = percept.intersectingFaces ?? 0;
  const unreachable = percept.unreachableFaces ?? 0;
  const dirs = percept.auditDirections ?? 0;
  // Neither count can exceed the mesh it describes — a triangle cannot be unreachable
  // without existing. Over-count means the facts belong to a DIFFERENT mesh than the
  // one being reported (req_3752: a stale host cache handed a 12-triangle cube a
  // moped's 890, which rendered as "7417% of the mesh"). Say so; never do arithmetic on
  // numbers that cannot both be true.
  if (intersecting > percept.faces || unreachable > percept.faces) {
    return `⚠ geometry facts INCONSISTENT — ${intersecting} intersecting / ${unreachable} unreachable reported against only ${percept.faces} triangles. These counts describe a different mesh; do not trust them`;
  }
  if (intersecting === 0 && unreachable === 0) return 'geometry · 0 intersecting · 0 unreachable';
  const share = percept.faces > 0 ? Math.round((unreachable / percept.faces) * 100) : 0;
  return `⚠ geometry · ${intersecting} triangles pass through other triangles · ${unreachable} unreachable from any of ${dirs} directions (${share}% of the mesh no camera can see)`;
}

export function formatSeatPercept(percept: SeatPercept): string {
  const names = new Map(percept.table.regions.map((region) => [region.id, region.name]));
  // Lead with authored faces, not triangles. A percept that reports only triangles reads
  // identically before and after a quad mesh is flattened into soup, which is exactly how
  // a destroyed model went unnoticed (req_3740).
  const authored = percept.authoredFaces == null
    ? `${percept.faces} triangles · authored faces unknown (no readable atlas)`
    : `${percept.authoredFaces} authored faces · ${percept.faces} triangles`;
  const lines = [`mesh · model ${percept.model ?? 'unknown'} · ${authored} · ${percept.footprints} paint footprints · ${percept.islands} logical UV islands · generation ${percept.generation} · unnamed ${percept.unnamed}`];
  if (percept.authoredFaces != null && percept.authoredFaces === percept.faces && percept.faces > 0) {
    lines.push(`  ⚠ TRIANGLE SOUP — every triangle is its own authored face; this mesh has no quads left`);
  }
  lines.push(`  ${formatGeometryFacts(percept)}`);
  for (const part of percept.parts) {
    const range = part.lo == null || part.hi == null ? 'range pending' : `[${part.lo},${part.hi})`;
    const folder = part.groupPath.length > 0 ? `${part.groupPath.map((row) => row.name).join('/')} / ` : '';
    lines.push(`  part ${folder}${part.name}  ${range}${part.id === percept.activePartId ? '  ACTIVE' : ''}${part.visible ? '' : '  hidden'}`);
  }
  for (const row of percept.regions) lines.push(`  ${names.get(row.id) ?? `region:${row.id}`}  ${row.faces} faces${row.instances > 1 ? ` ×${row.instances}` : ''}  bbox ${row.bbox.join(',')}`);
  if (percept.unnamed > 0) lines.push(`  ⚠ unnamed  ${percept.unnamed}`);
  if (percept.placeholders > 0) lines.push(`  ⚠ ${percept.placeholders} generator names over ${percept.placeholderFaces} triangles — no intentional naming pass yet`);
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

export function seatBatchGenerationReason(expected: number, live: number, rowIndex: number, model?: string): string | null {
  return live === expected
    ? null
    : model === undefined
      ? `batch closed before row ${rowIndex + 1} — editor generation changed from ${expected} to ${live}`
      : `batch closed before row ${rowIndex + 1} on model ${model} — editor generation changed from ${expected} to ${live}`;
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
    const rig = adapter.rigPercept?.();
    return shell
      ? { ...percept, ...shell, model: shell.model ?? null, ...(adapter.rigPercept ? { rig: rig ?? null } : {}) }
      : { ...percept, model: null, ...(adapter.rigPercept ? { rig: rig ?? null } : {}) };
  };
  // Viewport input already emits this one committed-selection notification. Seat
  // automation changes the same resident sets, so it must wake the human's inspector too.
  const notifySelectionChanged = () => adapter.selectionChanged?.();
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
  const expandAllVisibleParts = (percept: SeatPercept): string | null => {
    const visiblePartIds = percept.parts.filter((part) => part.visible && part.lo != null && part.hi != null).map((part) => part.id);
    if (visiblePartIds.length <= 1) return null;
    const scoped = adapter.shellAction?.('part-select', { ids: visiblePartIds, primary: visiblePartIds[visiblePartIds.length - 1] });
    return scoped?.ok ? null : scoped?.reason ?? 'could not expand native edit scope to every visible part';
  };
  const select = (selector: string): SelectorReceipt => {
    const percept = look();
    if (!percept) return { ok: false, reason: 'no live mesh' };
    if (selector.trim() === 'all') {
      const scopeReason = expandAllVisibleParts(percept);
      if (scopeReason) return { ok: false, reason: `select all ${scopeReason}` };
    }
    const query = compileSeatSelector(selector, percept);
    if (!query) {
      if (/^faces:\d+\.\.\d+$/.test(selector.trim())) return { ok: false, reason: 'faces: was ambiguous and is refused; authored face-group ranges use groups:<lo>..<hi>, while triangle ids use select-elements kind:"triangle"' };
      if (/^part:\d+\.\.\d+$/.test(selector.trim())) return { ok: false, reason: 'authored face-group ranges use groups:<lo>..<hi>; part: is reserved for Outliner part ids' };
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
      notifySelectionChanged();
      return {
        ok: false, faces: receipt.faces, actionableFaces: actionable, bbox: receipt.bbox,
        reason: `selector matched ${receipt.faces} faces but active part scope permits ${actionable}; select every intended part first`,
      };
    }
    if (receipt.ok) notifySelectionChanged();
    return receipt;
  };
  const elements = (): SeatElements | null => parseJson<SeatElements>(host.__mesh_edit_elements?.());
  /** The LIVE selection, measured (req_4202). Every edge-mode topology verb gates on
   *  facts about the selected edges — how many faces each already carries, whether they
   *  meet, which part they sit in — and the only way to learn them used to be running
   *  the verb and reading its refusal. A probe that mutates on the runs where it happens
   *  to succeed is the crossed wire req_4114 already paid for, so this reads and nothing
   *  else: it sets no selection, changes no mode, and touches no geometry. */
  const selection = (): SeatSelectionReport | null => {
    const snapshot = parseModelSelectionSnapshot(host.__mesh_edit_selection?.());
    if (!snapshot) return null;
    return { ...snapshot, mode: modelSelectionModeName(snapshot.mode), createFace: describeCreateFaceReadiness(snapshot) };
  };
  const readRetopoBands = (): SeatRetopoBandPlan | null => {
    const plan = parseJson<SeatRetopoBandPlan>(host.__mesh_retopo_bands_read?.());
    return plan?.version === 1 && Array.isArray(plan.bands) &&
      (plan.mode === 'manual' ? plan.covered >= 0 && plan.covered <= plan.faces : plan.covered === plan.faces) ? plan : null;
  };
  const retopoBands = (operation: string, args: Record<string, unknown> = {}): SeatShellReceipt => {
    const persistRetopo = (clearWhenAbsent = false): boolean => adapter.retopoStateChanged?.(clearWhenAbsent) !== false;
    if (operation === 'clear') {
      const changed = host.__mesh_retopo_bands_clear?.() === 1;
      if (!changed) return { ok: false, reason: 'no retopology band preview is active' };
      return persistRetopo(true)
        ? { ok: true, result: { cleared: true, persisted: true } }
        : { ok: false, result: { cleared: true, persisted: false }, reason: 'retopology map cleared live but the model-package record could not be updated' };
    }
    if (operation === 'read') {
      const plan = readRetopoBands();
      return plan ? { ok: true, result: plan } : { ok: false, reason: 'no complete retopology band preview is active' };
    }
    if (operation === 'deleted-patch') {
      const events = readNativeFollowEvents();
      applyNativeFollowEvents(events);
      const event = [...events].reverse().find((row) => row.kind === 5 && isFollowPatch(row.before));
      const boundary = event && isFollowPatch(event.before) ? deletedBoundaryFromPatch(event.before) : null;
      return event && boundary
        ? { ok: true, result: { source: followSourceName(event.source), boundary } }
        : { ok: false, reason: 'no unread Delete Faces transaction is available' };
    }
    if (operation === 'tint-selection' || operation === 'untint-selection') {
      const id = operation === 'untint-selection' ? -1 : Number(args.id);
      if (!Number.isInteger(id) || id < -1 || id > 11) {
        return { ok: false, reason: 'tint-selection needs id 0..11; untint-selection erases the current face selection' };
      }
      const tinted = Number(host.__mesh_retopo_band_tint_selection?.(id) ?? -1);
      if (tinted <= 0) return { ok: false, reason: tinted === 0 ? 'select one or more faces before tinting' : 'manual retopology tint is unavailable' };
      return persistRetopo()
        ? { ok: true, result: { id: id < 0 ? 'unassigned' : id, faces: tinted, persisted: true } }
        : { ok: false, result: { id: id < 0 ? 'unassigned' : id, faces: tinted, persisted: false }, reason: 'faces were tinted live but the model-package guide could not be written' };
    }
    if (operation === 'ghost') {
      const requested = args.visible;
      if (requested !== undefined && typeof requested !== 'boolean') {
        return { ok: false, reason: 'ghost visible must be true or false; omit it to toggle' };
      }
      const raw = requested === undefined
        ? host.__mesh_retopo_source_ghost?.()
        : host.__mesh_retopo_source_ghost?.(requested ? 1 : 0);
      const ghost = parseJson<SeatRetopoSourceGhost>(raw);
      if (ghost?.captured !== true || typeof ghost.visible !== 'boolean') {
        return { ok: false, reason: 'no frozen retopology source exists — tint the source soup before editing' };
      }
      return persistRetopo()
        ? { ok: true, result: { ...ghost, persisted: true } }
        : { ok: false, result: { ...ghost, persisted: false }, reason: 'ghost visibility changed live but the model-package guide could not be written' };
    }
    const live = look();
    if (!live) return { ok: false, reason: 'no live mesh' };
    const scopeReason = expandAllVisibleParts(live);
    if (scopeReason) return { ok: false, reason: `retopology map ${scopeReason}` };
    if (operation === 'plan-from-selection') {
      const patch = followPatch(undefined, 0);
      if (!patch) return { ok: false, reason: 'select an established open quad strip before planning from rails' };
      const rails = retopoRailPairsFromPatch(patch);
      if (!rails) return { ok: false, reason: 'selected seed must be a chain of 2+ authored quads sharing one cross edge each' };
      const plan = parseJson<SeatRetopoBandPlan>(host.__mesh_retopo_bands_plan_rails?.(rails));
      if (!plan || plan.version !== 1 || plan.mode !== 'rails' || plan.covered !== plan.faces || plan.faces !== live.faces) {
        return { ok: false, reason: 'native rail planner rejected the seed or did not cover every resident face' };
      }
      return persistRetopo() ? { ok: true, result: { ...plan, persisted: true } }
        : { ok: false, result: { ...plan, persisted: false }, reason: 'rail map was built live but the model-package guide could not be written' };
    }
    if (operation === 'plan') {
      const rawAxis = args.axis ?? 'y';
      const axis = typeof rawAxis === 'string' ? ({ x: 0, y: 1, z: 2 } as const)[rawAxis as 'x' | 'y' | 'z'] : Number(rawAxis);
      const width = Number(args.width);
      const origin = args.origin === undefined ? undefined : Number(args.origin);
      if (!Number.isInteger(axis) || axis < 0 || axis > 2 || !Number.isFinite(width) || width < 0.0001 ||
          (origin !== undefined && !Number.isFinite(origin))) {
        return { ok: false, reason: 'plan needs axis x/y/z, width >= 0.0001 metres, and an optional finite origin' };
      }
      const raw = origin === undefined
        ? host.__mesh_retopo_bands_plan?.(axis, width)
        : host.__mesh_retopo_bands_plan?.(axis, width, origin);
      const plan = parseJson<SeatRetopoBandPlan>(raw);
      if (!plan || plan.version !== 1 || plan.covered !== plan.faces || plan.faces !== live.faces) {
        return { ok: false, reason: 'native band planner rejected the dimensions or did not cover every resident face' };
      }
      return persistRetopo() ? { ok: true, result: { ...plan, persisted: true } }
        : { ok: false, result: { ...plan, persisted: false }, reason: 'band map was built live but the model-package guide could not be written' };
    }
    if (operation === 'select') {
      const id = args.id === 'all' ? -1 : Number(args.id);
      if (!Number.isInteger(id) || id < -1) return { ok: false, reason: 'select needs a non-negative band id or id:"all"' };
      const selected = Number(host.__mesh_retopo_band_select?.(id) ?? -1);
      if (selected > 0) notifySelectionChanged();
      return selected > 0 ? { ok: true, result: { id: id < 0 ? 'all' : id, selected } }
        : { ok: false, reason: 'band id is absent, stale, or selected no resident faces' };
    }
    return { ok: false, reason: `unknown retopology band operation "${operation}"` };
  };
  const edgePair = (value: unknown): [number, number] | null => {
    if (!Array.isArray(value) || value.length !== 2) return null;
    const a = Number(value[0]);
    const b = Number(value[1]);
    return Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 && a !== b ? [a, b] : null;
  };
  const edgeKey = ([a, b]: [number, number]): string => a < b ? `${a}:${b}` : `${b}:${a}`;
  const boundaryContinuation = (value: unknown): SeatBoundaryContinuation | null => {
    const open = edgePair(value);
    const topology = elements();
    if (!open || !topology) return null;
    const openKey = edgeKey(open);
    if (!topology.edges.some((edge) => edge.open === true && edgeKey(edge.vertices) === openKey)) return null;
    const positions = new Map(topology.vertices.map((vertex) => [vertex.id, vertex.at] as const));
    const endpoint = (vertex: number) => {
      const at = positions.get(vertex);
      if (!at) return null;
      const candidates = topology.edges.flatMap((edge) => {
        if (edge.open !== true || edgeKey(edge.vertices) === openKey || !edge.vertices.includes(vertex)) return [];
        const next = edge.vertices[0] === vertex ? edge.vertices[1] : edge.vertices[0];
        const nextAt = positions.get(next);
        return nextAt ? [{ edge: edge.id, vertices: [vertex, next] as [number, number], next, at: nextAt }] : [];
      }).sort((a, b) => a.edge - b.edge);
      return { vertex, at, candidates };
    };
    const a = endpoint(open[0]);
    const b = endpoint(open[1]);
    if (!a || !b) return null;
    const pairs = a.candidates.flatMap((left) => b.candidates.flatMap((right) => left.next === right.next ? [] : [{
      edges: [left.vertices, right.vertices] as [[number, number], [number, number]],
      forward: [left.next, right.next] as [number, number],
    }]));
    return { open, endpoints: [a, b], pairs };
  };
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
  const followSourceName = (source: number): string => {
    const sourceNames = ['native', 'menu', 'hotkey', 'toolbar', 'dock', 'context-menu', 'palette', 'viewport', 'remote', 'automation'];
    return sourceNames[Math.trunc(Number(source))] ?? 'native';
  };
  const readNativeFollowEvents = (): NativeFollowActionDrain['events'] => {
    const drained = parseJson<NativeFollowActionDrain>(host.__mesh_follow_action_drain?.());
    return drained?.version === 1 && Array.isArray(drained.events) ? drained.events : [];
  };
  const applyNativeFollowEvents = (events: NativeFollowActionDrain['events']): number => {
    if (!followSession?.active) return 0;
    const recorded = [...(Array.isArray(followSession.events) ? followSession.events : [])];
    const examples = [...followSession.examples];
    let pendingDelete = followSession.pendingDelete;
    for (const event of events) {
      const source = followSourceName(event.source);
      recorded.push({
        index: recorded.length + 1,
        kind: Math.trunc(Number(event.kind)),
        source,
        at: Date.now(),
        before: event.before,
        after: event.after,
      });
      // Raw events are authoritative and include every source. Demonstration
      // examples intentionally remain human-only derived sugar so a Seat cannot
      // train on its own continuation attempts.
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
    if (events.length !== 0 || added !== 0 || pendingDelete !== followSession.pendingDelete) {
      storeFollow({ ...followSession, events: recorded, examples, ...(pendingDelete ? { pendingDelete } : { pendingDelete: undefined }) });
    }
    return added;
  };
  const drainNativeFollowActions = (): number => applyNativeFollowEvents(readNativeFollowEvents());
  const followPage = (state: SeatFollowSession, args: Record<string, unknown>): Record<string, unknown> => {
    const total = Array.isArray(state.events) ? state.events.length : 0;
    const offset = Math.max(0, Math.min(total, Math.trunc(Number(args.offset ?? 0) || 0)));
    const limit = Math.max(1, Math.min(32, Math.trunc(Number(args.limit ?? 8) || 8)));
    const end = Math.min(total, offset + limit);
    return {
      ...state,
      events: state.events.slice(offset, end),
      eventTotal: total,
      eventOffset: offset,
      eventLimit: limit,
      eventNext: end < total ? end : null,
    };
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
        events: [],
        examples: [],
      };
      storeFollow(state);
      return { ok: true, result: state };
    }
    if (operation === 'read') {
      drainNativeFollowActions();
      return followSession
        ? { ok: true, result: followPage(followSession, args) }
        : { ok: false, reason: 'no Follow demonstration has been started' };
    }
    if (operation === 'stop') {
      if (!followSession) return { ok: false, reason: 'no Follow demonstration has been started' };
      drainNativeFollowActions();
      const state = { ...followSession, active: false, stoppedAt: Date.now() };
      storeFollow(state);
      return { ok: true, result: followPage(state, args) };
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
  const selectEdge = (index: number, additive = false): boolean => {
    const changed = Number.isInteger(index) && index >= 0 && host.__mesh_edit_select_edge?.(index, additive ? 1 : 0) === 1;
    if (changed) notifySelectionChanged();
    return changed;
  };
  const selectVertex = (index: number, additive = false): boolean => {
    const changed = Number.isInteger(index) && index >= 0 && host.__mesh_edit_select_vertex?.(index, additive ? 1 : 0) === 1;
    if (changed) notifySelectionChanged();
    return changed;
  };
  /** Select the triangles behind the percept's geometry counts (req_3883). The host
   *  marks them in the SAME pass that counts them, so the selection can never
   *  disagree with the number the reply already reported. */
  const selectAudit = (kind: string): { faces: number; actionableFaces: number; bbox: number[] } | null => {
    const ordinal = kind === 'intersecting' ? 0 : kind === 'unreachable' ? 1 : kind === 'both' ? 2 : -1;
    if (ordinal < 0) return null;
    try {
      const reply = JSON.parse(String(automation(() => host.__mesh_select_audit?.(ordinal)) ?? 'null'));
      if (reply?.ok !== true) return null;
      notifySelectionChanged();
      return { faces: Number(reply.faces) || 0, actionableFaces: Number(reply.actionableFaces) || 0, bbox: reply.bbox ?? [] };
    } catch { return null; }
  };
  /** Put the selection on every point whose corners carry more than one logical row
   *  (req_4206) — the set that can block a fill. Reports POINTS in `points`; a number
   *  nobody can locate is not actionable, so this marks them and lets the viewport
   *  settle it. These are NOT coincident vertices: `stats anomalies` is the verb that
   *  answers that, and it read zero on the model that hit this. */
  const selectSplitPoints = (): { points: number; actionablePoints: number; bbox: number[] } | null => {
    try {
      const reply = JSON.parse(String(automation(() => host.__mesh_select_split_points?.()) ?? 'null'));
      if (reply?.ok !== true) return null;
      notifySelectionChanged();
      return { points: Number(reply.faces) || 0, actionablePoints: Number(reply.actionableFaces) || 0, bbox: reply.bbox ?? [] };
    } catch { return null; }
  };
  /** Rename a region, or remove it so its faces go back to unnamed (req_3894).
   *  Naming used to be a one-way door — a mistyped or repurposed region was
   *  permanent, for the Seat exactly as for the GUI. */
  const editRegion = (name: string, rename: string | null, remove: boolean): { changed: number; name: string } | null => {
    const percept = look();
    if (!percept || !host.__mesh_semantic_region_edit) return null;
    const region = percept.table.regions.find((row) => row.name === name);
    if (!region) return null;
    const target = (rename ?? '').trim();
    if (!remove && (!target || target === '_' || percept.table.regions.some((row) => row.id !== region.id && row.name === target))) return null;
    const next: SemanticTable = {
      ...percept.table,
      regions: remove
        ? percept.table.regions.filter((row) => row.id !== region.id)
          .map((row) => (row.parent === region.id ? { ...row, parent: null } : row))
        : percept.table.regions.map((row) => (row.id === region.id ? { ...row, name: target } : row)),
    };
    const changed = Number(automation(() => host.__mesh_semantic_region_edit(region.id, remove ? 1 : 0, JSON.stringify(next))) ?? -1);
    return changed < 0 ? null : { changed, name: remove ? name : target };
  };
  const selectFace = (index: number, additive = false): boolean => {
    const changed = Number.isInteger(index) && index >= 0 && host.__mesh_edit_select_face?.(index, additive ? 1 : 0) === 1;
    if (changed) notifySelectionChanged();
    return changed;
  };
  const selectElements = (kind: 'triangle' | 'edge' | 'vertex', values: unknown): number => {
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
    if (changed > 0) notifySelectionChanged();
    return changed;
  };
  const selectBoundaryEdgePairs = (values: unknown): { changed: number; edges: number[] } | null => {
    if (!Array.isArray(values) || values.length === 0) return null;
    const pairs: [number, number][] = [];
    const wanted = new Set<string>();
    for (const value of values) {
      if (!Array.isArray(value) || value.length !== 2) return null;
      const a = Number(value[0]);
      const b = Number(value[1]);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a === b) return null;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (wanted.has(key)) return null;
      wanted.add(key);
      pairs.push([a, b]);
    }
    const topology = elements();
    if (!topology) return null;
    const byVertices = new Map<string, number>();
    for (const edge of topology.edges) {
      const [a, b] = edge.vertices;
      byVertices.set(a < b ? `${a}:${b}` : `${b}:${a}`, edge.id);
    }
    const edgeIds = pairs.map(([a, b]) => byVertices.get(a < b ? `${a}:${b}` : `${b}:${a}`));
    if (edgeIds.some((id) => id === undefined)) return null;
    const edges = edgeIds as number[];
    const changed = selectElements('edge', edges);
    return changed === edges.length ? { changed, edges } : null;
  };
  const selectBoundaryContinuation = (openValue: unknown, values: unknown): { changed: number; edges: number[]; open: [number, number]; vertices: [[number, number], [number, number]]; forward: [number, number] } | null => {
    const continuation = boundaryContinuation(openValue);
    if (!continuation || !Array.isArray(values) || values.length !== 2) return null;
    const requested = values.map(edgePair);
    if (requested.some((pair) => pair === null)) return null;
    const requestedKeys = new Set((requested as [number, number][]).map(edgeKey));
    if (requestedKeys.size !== 2) return null;
    const pair = continuation.pairs.find((candidate) => candidate.edges.every((edge) => requestedKeys.has(edgeKey(edge))));
    if (!pair) return null;
    const selected = selectBoundaryEdgePairs(pair.edges);
    return selected ? { ...selected, open: continuation.open, vertices: pair.edges, forward: pair.forward } : null;
  };
  const selectBoundaryEdgePoints = (values: unknown, tolerance = 0.000001): { changed: number; edges: number[]; vertices: [number, number][] } | null => {
    if (!Array.isArray(values) || values.length === 0 || !Number.isFinite(tolerance) || tolerance <= 0) return null;
    const pointPairs: [[number, number, number], [number, number, number]][] = [];
    for (const value of values) {
      if (!Array.isArray(value) || value.length !== 2 || !finiteVec3(value[0]) || !finiteVec3(value[1])) return null;
      pointPairs.push([value[0] as [number, number, number], value[1] as [number, number, number]]);
    }
    const topology = elements();
    if (!topology) return null;
    const limit2 = tolerance * tolerance;
    const resolveVertex = (point: [number, number, number]): number | null => {
      const matches = topology.vertices.filter(({ at }) => {
        const dx = at[0] - point[0];
        const dy = at[1] - point[1];
        const dz = at[2] - point[2];
        return dx * dx + dy * dy + dz * dz <= limit2;
      });
      return matches.length === 1 ? matches[0].id : null;
    };
    const pairs: [number, number][] = [];
    for (const [aPoint, bPoint] of pointPairs) {
      const a = resolveVertex(aPoint);
      const b = resolveVertex(bPoint);
      if (a === null || b === null || a === b) return null;
      pairs.push([a, b]);
    }
    const selected = selectBoundaryEdgePairs(pairs);
    return selected ? { ...selected, vertices: pairs } : null;
  };
  const nameSelection = (name: string, instance = 0, role = 'authored', op = 'name'): number => {
    const percept = look();
    if (!percept || !name || name === '_') return 0;
    const declared = declareRegion(percept.table, name, role, op, adapter.take?.());
    return Number(automation(() => host.__mesh_semantic_assign?.(declared.region.id, instance, JSON.stringify(declared.table))) ?? 0);
  };
  /** Extrude had FOUR distinct failure paths collapsing into one "(selection, name, or
   *  naming debt)" message, which sent agents digging to find out which (req_4187). Each
   *  now says which, and what to do about it — a refusal that does not name the fix is a
   *  refusal an agent routes around. */
  const HOST_EXTRUDE_REFUSAL = 'the host refused the extrude — a MULTI-face selection region-extrudes as one shell, so wire faces, non-manifold selection edges, and closed selections are refused. Check the selection with `measure bbox selection`';
  const extrude = (distance: number, name: string, instance = 0): { ok: true; result: TopologyReceipt } | { ok: false; reason: string } => {
    const before = look();
    if (!before) return { ok: false, reason: 'no live mesh' };
    if (!Number.isFinite(distance) || distance === 0) {
      return { ok: false, reason: 'extrude needs a finite nonzero distance in METERS (1 unit = 1 meter)' };
    }
    if (!name || name === '_') {
      if (before.unnamed > debtBudget) {
        return { ok: false, reason: `naming debt: ${before.unnamed} unnamed triangles is over the ${debtBudget}-face budget, so an UNNAMED extrude is refused. Pass a name to this extrude, or name what is already there first` };
      }
      const result = readTopology(automation(() => host.__mesh_topo_extrude_face?.(distance)));
      adapter.adoptTopology?.(result);
      return result ? { ok: true, result } : { ok: false, reason: HOST_EXTRUDE_REFUSAL };
    }
    let table = before.table;
    const parent = regionByName(table, name)?.id;
    const cap = declareRegion(table, `${name}.cap`, 'cap', 'extrude', adapter.take?.(), parent);
    table = cap.table;
    const wall = declareRegion(table, `${name}.wall`, 'wall', 'extrude', adapter.take?.(), parent);
    table = wall.table;
    if (host.__mesh_semantic_extrude_intent?.(cap.region.id, wall.region.id, instance, JSON.stringify(table)) !== 1) {
      return { ok: false, reason: `the host refused to reserve the semantic names "${name}.cap" and "${name}.wall" for instance ${instance} — a different instance may already own them, or the selection is empty` };
    }
    const result = readTopology(automation(() => host.__mesh_topo_extrude_face?.(distance)));
    adapter.adoptTopology?.(result);
    return result ? { ok: true, result } : { ok: false, reason: HOST_EXTRUDE_REFUSAL };
  };
  const recordTransform = (changed: boolean): boolean => {
    if (changed) adapter.documentMutated?.();
    return changed;
  };
  const move = (delta: [number, number, number]) => finiteVec3(delta)
    && recordTransform(automation(() => host.__mesh_transform_translate?.(...delta)) === 1);
  const scale = (axis: [number, number, number], pivot: [number, number, number], factor: number) =>
    finiteVec3(axis) && finiteVec3(pivot) && Number.isFinite(factor)
    && recordTransform(automation(() => host.__mesh_transform_scale_axis?.(...axis, ...pivot, factor)) === 1);
  const scaleUniform = (factor: number) => Number.isFinite(factor) && factor !== 0
    && recordTransform(automation(() => host.__mesh_gizmo_scale_by?.(factor)) === 1);
  const alignLoop = (): { axis: 'x' | 'y' | 'z' } | null => {
    const code = Number(automation(() => host.__mesh_align_loop?.()) ?? 0);
    if (code < 1 || code > 3 || !Number.isInteger(code)) return null;
    adapter.documentMutated?.();
    return { axis: 'xyz'[code - 1] as 'x' | 'y' | 'z' };
  };
  const rotate = (axis: [number, number, number], pivot: [number, number, number], degrees: number) =>
    finiteVec3(axis) && finiteVec3(pivot) && Number.isFinite(degrees)
    && recordTransform(automation(() => host.__mesh_transform_rotate_axis?.(...axis, ...pivot, degrees * Math.PI / 180)) === 1);
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
  const bevel = (width: number, requestedTargetSides?: number): TopologyReceipt | null => {
    if (!Number.isFinite(width) || width <= 0) return null;
    const begin = parseJson<{
      ok?: number;
      kind?: 'edge' | 'vertex' | 'boundary' | 'face-polygon';
      defaultTargetSides?: number;
      minimumTargetSides?: number;
      maximumTargetSides?: number;
    }>(host.__mesh_bevel_begin?.());
    if (begin?.ok !== 1) return null;
    let targetSides = 0;
    if (begin.kind === 'boundary' || begin.kind === 'face-polygon') {
      targetSides = requestedTargetSides ?? begin.defaultTargetSides ?? 0;
      if (!Number.isSafeInteger(targetSides) ||
          targetSides < (begin.minimumTargetSides ?? Number.POSITIVE_INFINITY) ||
          targetSides > (begin.maximumTargetSides ?? Number.NEGATIVE_INFINITY)) {
        host.__mesh_bevel_end?.(0);
        return null;
      }
    }
    const preview = readTopology(host.__mesh_bevel_preview?.(width, targetSides));
    if (!preview) { host.__mesh_bevel_end?.(0); return null; }
    const result = readTopology(automation(() => host.__mesh_bevel_end?.(1)));
    adapter.adoptTopology?.(result);
    return result;
  };
  const deleteSelection = (): TopologyReceipt | null => {
    const result = topology(() => host.__mesh_delete_selection?.());
    if (!result) return null;
    const events = readNativeFollowEvents();
    applyNativeFollowEvents(events);
    const event = [...events].reverse().find((row) => row.kind === 5 && isFollowPatch(row.before));
    const boundary = event && isFollowPatch(event.before) ? deletedBoundaryFromPatch(event.before) : null;
    return boundary ? { ...result, deletedBoundary: boundary } : result;
  };
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
    const extruded = extrude(distance, name);
    if (!extruded.ok) {
      // Carry the extrude's own reason instead of flattening it back to one line —
      // inset's rejected stage is only useful if it says WHY that stage rejected.
      return { ok: false, stage: 'extrude', reason: `hairline extrude rejected; select exactly one authored face before inset — ${extruded.reason}` };
    }
    const result = extruded.result;
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
    if (adapter.createAtlasAndPaint) return adapter.createAtlasAndPaint({ base, rgb, detail, fit });
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
    if (percept.placeholderFaces > 0) return {
      ok: false,
      reason: `save blocked — ${percept.placeholders} generator-named regions still cover ${percept.placeholderFaces} triangles. Do the intentional naming pass first: select each real part or affordance and \`name\` it, so the table describes the model instead of its construction.`,
    };
    return adapter.persist?.() === true
      ? { ok: true }
      : { ok: false, reason: 'the shell could not persist the active model package' };
  };
  const undo = (): TopologyReceipt | null => { const result = readTopology(automation(() => host.__mesh_undo?.())); adapter.adoptTopology?.(result); return result; };
  const redo = (): TopologyReceipt | null => { const result = readTopology(automation(() => host.__mesh_redo?.())); adapter.adoptTopology?.(result); return result; };
  /** Mirror the mesh exactly across the model-origin axis plane (0 = X, 1 = Y, 2 = Z),
   *  keeping the +side or the −side. The plane is the fixed workspace origin — never a
   *  bounds midpoint, which drifted with every one-sided edit (req_3795). One host op,
   *  journaled — the seat never hand-computes a reflection. */
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
  /** The host's own account of why the last indexed topology session refused to open
   *  (req_4114). Loop cut, Basic Cut, bevel, merge-faces and tris-to-quads all failed as
   *  a bare null, so every one of them reported the seat's GUESS — "it needs a face
   *  selection" — for causes that had nothing to do with the selection. Refusals are
   *  data: say what the host actually said. */
  const topoRefusal = (): string => {
    const raw = host.__mesh_topo_refusal?.();
    return typeof raw === 'string' ? raw.trim() : '';
  };
  const withTopoRefusal = (fallback: string): string => topoRefusal() || fallback;
  const loopCut = (direction: number, cuts: number, offsetFraction: number, basic = false): TopologyReceipt | null => {
    if (![0, 1].includes(direction) || !Number.isInteger(cuts) || cuts < 1 || !Number.isFinite(offsetFraction) || offsetFraction < 0 || offsetFraction > 1) return null;
    if (parseJson<{ ok?: number }>(host.__mesh_lc_begin?.(basic ? 1 : 0))?.ok !== 1) return null;
    const preview = parseJson<{ ok?: number; worldDirection?: [number, number, number]; fallbackReason?: string }>(host.__mesh_lc_preview?.(direction, cuts, offsetFraction));
    if (preview?.ok !== 1) { host.__mesh_lc_end?.(0); return null; } // cancel restores the pre-cut mesh exactly
    const committed = readTopology(automation(() => host.__mesh_lc_end?.(1)));
    const result = committed && preview.worldDirection
      ? { ...committed, worldDirection: preview.worldDirection }
      : committed;
    adapter.adoptTopology?.(result);
    return result;
  };
  /** UV MASK ZONES (req_4152). A zone groups faces into ONE unfold chart for texturing.
   *  It never merges, moves, or regroups an authored face — USER RULING (req_4149): "UV
   *  grouping is a view; face distribution is the model; the view never rewrites the
   *  model." Merging faces to get the same UV also creases the shading and makes the
   *  result miserable to edit, which is the whole reason this layer exists. */
  const uvZone = (operation: string, zone: number): Record<string, unknown> | null => {
    const op = operation === 'assign' ? 1 : operation === 'delete' ? 2 : operation === 'clear' ? 3 : 0;
    const raw = automation(() => host.__mesh_uv_zone?.(op, Number.isFinite(zone) ? zone : -1));
    const parsed = parseJson<Record<string, unknown>>(raw);
    return parsed && parsed.ok === 1 ? parsed : null;
  };
  const trisToQuads = (): TopologyReceipt | null => topology(() => host.__mesh_topo_tris_to_quads?.());
  // Mirror quad symmetrize (req_3855): fuse twin triangle pairs into quads wherever the
  // reflected authored face across the model-origin axis plane is already a quad. The
  // stats ride the reply even on ok:0 so a zero explains itself instead of hiding
  // behind a generic refusal (the exact opacity that cost a debugging session).
  const mirrorMatchQuads = (axis: number): { receipt: TopologyReceipt | null; stats: MirrorQuadStats | null } => {
    const raw = automation(() => host.__mesh_topo_mirror_quads?.(1 << axis));
    const receipt = readTopology(raw);
    adapter.adoptTopology?.(receipt);
    return { receipt, stats: parseJson<MirrorQuadStats>(raw) };
  };
  // Selection-scoped mirror stamp (req_3864): reflect the selected faces across the
  // model-origin axis plane, deleting every whole twin face buried in the stamped
  // space and welding the seam + region border. Deliberate asymmetry survives by
  // simply not being selected.
  const mirrorReplace = (axis: number): { receipt: TopologyReceipt | null; stats: MirrorReplaceStats | null } => {
    const raw = automation(() => host.__mesh_topo_mirror_replace?.(1 << axis));
    const receipt = readTopology(raw);
    adapter.adoptTopology?.(receipt);
    return { receipt, stats: parseJson<MirrorReplaceStats>(raw) };
  };
  const collectUvOrientation = (): number => {
    const changed = Number(automation(() => host.__mesh_edit_select_uv_orientation?.()) ?? 0);
    if (changed > 0) notifySelectionChanged();
    return changed;
  };
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
    select(`groups:${range.lo}..${range.hi}`);
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
  const shotOffscreen = (path: string, width: number, height: number, pose: number[] | null): boolean => adapter.shotOffscreen?.(path, width, height, pose) === true;
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
  // ── measure / stats / align: the editor computes, the agent reads ─────────────
  // Every fact below was previously reconstructed agent-side by piping `look` into
  // python3 (req_4052 found 89 such geometry-math escapes). Hand arithmetic over
  // seat output is unversioned: when the meaning of a number changes, the private
  // formula keeps returning a confident wrong answer. These verbs read the SAME
  // resident data the viewport draws.
  const TARGET_SYNTAX = 'targets are any selector (region:<name>, facing:+y, outermost:-x, groups:lo..hi, inside:box(...)), plus "selection" and "model"';
  type ResolvedTarget = { selector: string; bbox: SeatBox; faces: number; selectionSet: boolean };
  /** A target's extent. `region:` names and the whole model answer from the resident
   *  percept and leave the live selection ALONE; the richer selector algebra has to
   *  run through the host query, so the reply says which happened rather than
   *  quietly clobbering a selection the agent spent ten verbs building. */
  const resolveTargetBox = (spec: unknown): ResolvedTarget | { reason: string } => {
    const selector = String(spec ?? '').trim();
    if (!selector) return { reason: `missing target — ${TARGET_SYNTAX}` };
    const percept = look();
    if (!percept) return { reason: 'no live mesh' };
    if (selector === 'selection') {
      const patch = followPatch(undefined, 0);
      const box = boxOfPoints((patch?.vertices ?? []).map((vertex) => vertex.at));
      return box
        ? { selector, bbox: box, faces: patch?.selectedTriangles.length ?? 0, selectionSet: false }
        : { reason: 'nothing is selected — select faces first or name a selector target' };
    }
    if (selector === 'model' || selector === 'all') {
      const rows = percept.regions.filter((region) => region.faces > 0);
      const named = unionBoxes(rows.map((region) => region.bbox));
      if (named) {
        return { selector: 'model', bbox: named, faces: rows.reduce((sum, region) => sum + region.faces, 0), selectionSet: false };
      }
      // A freshly imported mesh has no names yet but still has an extent, and asking
      // for it is exactly what an agent does before naming anything. Fall back to raw
      // topology rather than refusing — `elements` honours the active part scope, so
      // this measures the mesh in scope, which is what the viewport is showing.
      const box = boxOfPoints((elements()?.vertices ?? []).map((vertex) => vertex.at));
      return box
        ? { selector: 'model', bbox: box, faces: percept.faces, selectionSet: false }
        : { reason: 'the model carries no geometry to measure' };
    }
    const name = selector.startsWith('region:') ? selector.slice('region:'.length) : selector;
    const family = new Set(regionFamily(percept.table, name));
    if (family.size > 0) {
      const rows = percept.regions.filter((region) => family.has(region.id) && region.faces > 0);
      const box = unionBoxes(rows.map((region) => region.bbox));
      if (!box) return { reason: `region "${name}" exists but carries no faces to measure` };
      return { selector, bbox: box, faces: rows.reduce((sum, region) => sum + region.faces, 0), selectionSet: false };
    }
    const receipt = select(selector);
    if (!receipt.ok || !isBox(receipt.bbox)) {
      // A selector the host rejected outright is usually a target-syntax mistake, so
      // repeat what a target may be rather than leaving the agent to guess.
      const rejected = receipt.reason ?? `selector "${selector}" matched no faces`;
      return { reason: receipt.ok ? rejected : `${rejected} — ${TARGET_SYNTAX}` };
    }
    return { selector, bbox: receipt.bbox, faces: receipt.faces ?? 0, selectionSet: true };
  };
  const isResolvedTarget = (value: ResolvedTarget | { reason: string }): value is ResolvedTarget => 'bbox' in value;
  /** Per-triangle data for a target. Unlike a bbox this cannot come from the percept,
   *  so it always sets the live selection — reported as `selectionSet` so the agent
   *  never has to guess whether its selection survived a measurement. */
  const resolveTargetPatch = (spec: unknown): { selector: string; patch: SeatFollowPatch; selectionSet: boolean } | { reason: string } => {
    const selector = String(spec ?? 'selection').trim() || 'selection';
    if (selector === 'selection') {
      const patch = followPatch(undefined, 0);
      return patch && patch.selectedTriangles.length > 0
        ? { selector, patch, selectionSet: false }
        : { reason: 'nothing is selected — select faces first or name a selector target' };
    }
    const receipt = select(selector === 'model' ? 'all' : selector);
    if (!receipt.ok) return { reason: receipt.reason ?? `selector "${selector}" matched no faces — ${TARGET_SYNTAX}` };
    const patch = followPatch(undefined, 0);
    return patch
      ? { selector, patch, selectionSet: true }
      : { reason: `the topology patch for "${selector}" was unavailable` };
  };
  // ── intent amplifiers: two decisions expand to N elements (req_4061) ──────────
  // The agent supplies intent; the HOST supplies the walk. Preview is the default and
  // the token is the whole safety story: an agent applies only the walk it just read,
  // and a topology change in between is a refusal rather than a different set.
  const WALK_SYNTAX = 'path {from,to,[axis]} · loop {edge} · ring {edge} · grow {rings} · similar {face,by:normal|coplanar|area,tolerance}';
  const walk = (kind: string, args: Record<string, unknown>): SeatShellReceipt => {
    const request: Record<string, unknown> = { kind };
    const whole = (value: unknown, fallback?: number) => {
      const number = Number(value);
      return Number.isInteger(number) && number >= 0 ? number : fallback;
    };
    if (kind === 'path') {
      const from = whole(args.from);
      const to = whole(args.to);
      if (from === undefined || to === undefined) return { ok: false, reason: `path needs from and to vertex ids from \`elements\` — ${WALK_SYNTAX}` };
      request.from = from;
      request.to = to;
      const axis = axisIndexOf(args.axis);
      // 255 is the host's "unconstrained" sentinel; an axis restricts travel to
      // monotone progress so a spine walk cannot detour around a limb.
      request.axis = args.axis === undefined || axis === null ? 255 : axis;
    } else if (kind === 'loop' || kind === 'ring') {
      const edge = whole(args.edge);
      if (edge === undefined) return { ok: false, reason: `${kind} needs a seed edge id from \`elements\` — ${WALK_SYNTAX}` };
      request.edge = edge;
    } else if (kind === 'grow') {
      request.rings = whole(args.rings, 1);
    } else if (kind === 'similar') {
      const face = whole(args.face);
      if (face === undefined) return { ok: false, reason: `similar needs a seed face id — ${WALK_SYNTAX}` };
      request.face = face;
      const by = String(args.by ?? 'normal');
      if (!['normal', 'coplanar', 'area'].includes(by)) return { ok: false, reason: 'similar compares by normal, coplanar, or area' };
      request.by = by;
      request.tolerance = Number.isFinite(Number(args.tolerance)) ? Number(args.tolerance) : 10;
    } else {
      return { ok: false, reason: `unknown walk "${kind}" — ${WALK_SYNTAX}` };
    }
    const plan = parseJson<Record<string, unknown>>(host.__mesh_walk?.(JSON.stringify(request)));
    if (!plan || plan.ok !== true) {
      return { ok: false, reason: String(plan?.reason ?? 'the walk door is unavailable on this host — rebuild the editor binary') };
    }
    if (args.apply !== true) return { ok: true, result: { ...plan, applied: false } };
    const applied = Number(automation(() => host.__mesh_walk_apply?.(String(plan.token), args.additive === true ? 1 : 0)) ?? -1);
    if (applied < 0) {
      return { ok: false, result: plan, reason: 'the walk was computed but its token no longer matches the live topology — re-read the walk and apply again' };
    }
    notifySelectionChanged();
    return { ok: true, result: { ...plan, applied: true, selected: applied } };
  };
  /** Absolute placement. Agents think in target coordinates — "tabletop at 0.75 m" —
   *  but only relative `move` existed, so every placement became read-bbox, subtract,
   *  move. The delta is computed from the host's own selection bounds and applied as
   *  one transaction, so the number reported is the number that moved. */
  const setPosition = (args: Record<string, unknown>): SeatShellReceipt => {
    const axis = axisIndexOf(args.axis);
    if (axis === null) return { ok: false, reason: 'set-position needs axis x, y, or z' };
    const value = Number(args.value);
    if (!Number.isFinite(value)) return { ok: false, reason: 'set-position needs a finite target coordinate in METERS' };
    const anchor = String(args.anchor ?? 'min');
    if (!['min', 'center', 'max'].includes(anchor)) {
      return { ok: false, reason: 'set-position anchors the selection by its min, center, or max on that axis' };
    }
    const patch = followPatch(undefined, 0);
    const box = boxOfPoints((patch?.vertices ?? []).map((vertex) => vertex.at));
    if (!box) return { ok: false, reason: 'nothing is selected — select the faces to place first' };
    const current = anchor === 'min' ? box[axis]! : anchor === 'max' ? box[axis + 3]! : (box[axis]! + box[axis + 3]!) / 2;
    const delta: [number, number, number] = [0, 0, 0];
    delta[axis] = value - current;
    if (!move(delta)) return { ok: false, reason: `set-position computed delta ${delta[axis]} but the move was rejected — check the active part scope` };
    return { ok: true, result: { axis: String(args.axis).toLowerCase(), anchor, from: current, to: value, delta, bbox: box } };
  };
  /** The region table as ONE joined row set (req_4187). `look` returns semantics
   *  (`table.regions`: id, name, role, parent) and geometry (`regions`: id, faces,
   *  instances, bbox) as two separate arrays keyed by id, so every agent that wanted
   *  "what are the named surfaces and how big are they" joined them by hand in python.
   *  The join belongs here, once, where both halves are already in scope. */
  const regionTable = (args: Record<string, unknown>): SeatShellReceipt => {
    const percept = look();
    if (!percept) return { ok: false, reason: 'no live mesh' };
    const geometry = new Map(percept.regions.map((region) => [region.id, region] as const));
    const filter = String(args.filter ?? '').trim().toLowerCase();
    const rows = percept.table.regions
      .map((region) => {
        const shape = geometry.get(region.id);
        return {
          id: region.id,
          name: region.name,
          role: region.role ?? null,
          parent: region.parent ?? null,
          createdBy: region.createdBy?.op ?? null,
          faces: shape?.faces ?? 0,
          instances: shape?.instances ?? 0,
          bbox: shape?.bbox ?? null,
          ...(shape && shape.faces > 0 ? { size: boxSize(shape.bbox) } : {}),
        };
      })
      // An EMPTY region is a name with no geometry under it — worth seeing, never worth
      // hiding, because it is usually the residue of an edit that moved faces elsewhere.
      .filter((row) => (args.all === true || row.faces > 0))
      .filter((row) => !filter || row.name.toLowerCase().includes(filter));
    const named = rows.reduce((sum, row) => sum + row.faces, 0);
    return { ok: true, result: {
      model: percept.model,
      regions: rows,
      shown: rows.length,
      total: percept.table.regions.length,
      namedTriangles: named,
      unnamed: percept.unnamed,
      placeholders: percept.placeholders,
    } };
  };
  const measure = (operation: string, args: Record<string, unknown>): SeatShellReceipt => {
    const tolerance = Number.isFinite(Number(args.tolerance)) ? Number(args.tolerance) : CONTACT_EPSILON;
    if (operation === 'bbox') {
      const target = resolveTargetBox(args.target);
      if (!isResolvedTarget(target)) return { ok: false, reason: target.reason };
      return { ok: true, result: { target: target.selector, faces: target.faces, selectionSet: target.selectionSet, ...boxFacts(target.bbox) } };
    }
    if (operation === 'distance' || operation === 'contact') {
      const moving = resolveTargetBox(args.a ?? args.moving);
      if (!isResolvedTarget(moving)) return { ok: false, reason: `first target: ${moving.reason}` };
      const stationary = resolveTargetBox(args.b ?? args.target);
      if (!isResolvedTarget(stationary)) return { ok: false, reason: `second target: ${stationary.reason}` };
      const report = operation === 'contact'
        ? measureContact(moving.bbox, stationary.bbox, tolerance)
        : measureDistance(moving.bbox, stationary.bbox, tolerance);
      return { ok: true, result: {
        a: { target: moving.selector, faces: moving.faces, bbox: moving.bbox },
        b: { target: stationary.selector, faces: stationary.faces, bbox: stationary.bbox },
        selectionSet: moving.selectionSet || stationary.selectionSet,
        tolerance,
        ...report,
      } };
    }
    return { ok: false, reason: `unknown measure operation "${operation}" — bbox, distance, or contact` };
  };
  const stats = (operation: string, args: Record<string, unknown>): SeatShellReceipt => {
    const tolerance = Number.isFinite(Number(args.tolerance)) ? Number(args.tolerance) : CONTACT_EPSILON;
    if (operation === 'edges') {
      const target = resolveTargetPatch(args.target);
      if ('reason' in target) return { ok: false, reason: target.reason };
      const triangles = target.patch.triangles.filter((triangle) => triangle.selected);
      const lengths = triangleEdgeLengths(triangles, target.patch.vertices);
      const measured = spread(lengths);
      return measured
        ? { ok: true, result: { target: target.selector, selectionSet: target.selectionSet, triangles: triangles.length, edges: measured } }
        : { ok: false, reason: `"${target.selector}" resolved to no measurable edges` };
    }
    if (operation === 'symmetry') {
      const axis = axisIndexOf(args.axis ?? 'x');
      if (axis === null) return { ok: false, reason: 'symmetry needs axis x, y, or z' };
      const topology = elements();
      if (!topology) return { ok: false, reason: 'topology descriptors unavailable' };
      return { ok: true, result: measureSymmetry(topology.vertices, axis, tolerance) };
    }
    if (operation === 'boundary') {
      // "Is this watertight, and if not where are the holes" — asked by hand-parsing a
      // dumped `elements` file for edges with faces<2, then grouping the open vertices
      // by position to find seams that should weld (req_4187).
      const topology = elements();
      if (!topology) return { ok: false, reason: 'topology descriptors unavailable' };
      const open = topology.edges.filter((edge) => edge.open || edge.faces < 2);
      const openVertices = new Set<number>();
      for (const edge of open) for (const vertex of edge.vertices) openVertices.add(vertex);
      const positions = new Map(topology.vertices.map((vertex) => [vertex.id, vertex.at] as const));
      // Coincident open vertices are the weld candidates: two boundary rims sitting in
      // the same place is a seam nobody closed, which is exactly what `weld-pairs` fixes.
      const byPosition = new Map<string, number[]>();
      const quantize = (value: number) => Math.round(value / Math.max(tolerance, Number.EPSILON));
      for (const vertex of openVertices) {
        const at = positions.get(vertex);
        if (!at) continue;
        const key = `${quantize(at[0])}|${quantize(at[1])}|${quantize(at[2])}`;
        byPosition.set(key, [...(byPosition.get(key) ?? []), vertex]);
      }
      const coincident = [...byPosition.values()].filter((ids) => ids.length > 1)
        .map((ids) => ({ vertices: ids, at: positions.get(ids[0]!)! }));
      return { ok: true, result: {
        watertight: open.length === 0,
        boundaryEdges: open.length,
        openVertices: openVertices.size,
        loops: boundaryLoopCount(open),
        coincidentOpenVertices: coincident.slice(0, 24),
        coincidentGroups: coincident.length,
        edges: open.slice(0, 48).map((edge) => ({ id: edge.id, vertices: edge.vertices, faces: edge.faces })),
        totalEdges: topology.edges.length,
        tolerance,
      } };
    }
    if (operation === 'anomalies') {
      const percept = look();
      const topology = elements();
      if (!percept || !topology) return { ok: false, reason: 'no live mesh' };
      const target = resolveTargetPatch(args.target ?? 'model');
      if ('reason' in target) return { ok: false, reason: target.reason };
      const triangles = target.patch.triangles.filter((triangle) => triangle.selected);
      const report = findAnomalies(triangles, target.patch.vertices, topology.edges, tolerance);
      return { ok: true, result: {
        target: target.selector,
        selectionSet: target.selectionSet,
        ...report,
        // The audit counts are the host's own pass, not a recomputation. Never
        // print them as zero when the mesh was over budget and they were never run.
        audit: percept.auditComputed === undefined
          ? { measured: false, reason: 'host predates the geometry audit pass' }
          : percept.auditComputed
            ? { measured: true, intersectingFaces: percept.intersectingFaces ?? 0, unreachableFaces: percept.unreachableFaces ?? 0, directions: percept.auditDirections ?? 0 }
            : { measured: false, reason: 'mesh is over the audit budget — intersecting/unreachable are UNKNOWN, not zero' },
      } };
    }
    return { ok: false, reason: `unknown stats operation "${operation}" — edges, boundary, symmetry, or anomalies` };
  };
  /** Seat one target's facing plane onto another's. `dryRun` returns the delta the
   *  agent used to compute by hand; the plain form applies it as one undo step, so
   *  the number that was reported is provably the number that moved. */
  const align = (args: Record<string, unknown>): SeatShellReceipt => {
    const tolerance = Number.isFinite(Number(args.tolerance)) ? Number(args.tolerance) : CONTACT_EPSILON;
    const axis = args.axis === undefined || args.axis === null ? null : axisIndexOf(args.axis);
    if (args.axis !== undefined && args.axis !== null && axis === null) {
      return { ok: false, reason: 'align axis must be x, y, or z — omit it to let the seat pick the contact axis' };
    }
    const moving = resolveTargetBox(args.moving ?? args.a);
    if (!isResolvedTarget(moving)) return { ok: false, reason: `moving target: ${moving.reason}` };
    const stationary = resolveTargetBox(args.onto ?? args.b);
    if (!isResolvedTarget(stationary)) return { ok: false, reason: `onto target: ${stationary.reason}` };
    const plan = planAlign(moving.bbox, stationary.bbox, axis, tolerance);
    const summary = {
      moving: { target: moving.selector, faces: moving.faces, bbox: moving.bbox },
      onto: { target: stationary.selector, faces: stationary.faces, bbox: stationary.bbox },
      tolerance,
      ...plan,
    };
    if (args.dryRun === true) return { ok: true, result: { ...summary, applied: false } };
    if (moving.selector === 'model') return { ok: false, reason: 'align refuses to move the whole model onto part of itself — name the part that should move' };
    // Re-select the moving target so the transform lands on it and nothing else,
    // even when resolveTargetBox answered from the percept without touching the
    // selection. One selector, one delta, one undo step.
    const selected = moving.selector === 'selection' ? { ok: true } : select(moving.selector);
    if (!selected.ok) return { ok: false, reason: `align could not select "${moving.selector}": ${selected.reason ?? 'selector matched no faces'}` };
    if (!move(plan.delta)) return { ok: false, reason: `align computed delta [${plan.delta.join(', ')}] but the move was rejected — check the active part scope` };
    return { ok: true, result: { ...summary, applied: true } };
  };
  // ── the oracle: phased docs behind a gate (req_4053) ─────────────────────────
  // Sessions are per-agent-seat and live for as long as the editor process does, so a
  // cold AGENT reconnects into its plan. Almost nothing is stored — the task string and
  // the phase cursor — because every check is recomputed from the live model, which is
  // what makes `oracle status` answer honestly for an agent that has forgotten everything.
  const restoredOracle = adapter.oracleState?.read();
  let oracleSession: OracleSession | null =
    restoredOracle && Array.isArray(restoredOracle.phases) && restoredOracle.phases.length > 0 ? restoredOracle : null;
  const storeOracle = (state: OracleSession | null) => {
    oracleSession = state;
    adapter.oracleState?.write(state);
  };
  /** Facts a check can read. `shell` is true only for the lanes that pay for a disk or
   *  diagnostics read; the ambient per-reply counter never does. */
  const oracleFacts = (percept: SeatPercept | null, shell: boolean, claimToken?: string): OracleFacts => {
    const diagnostics = shell ? (host.__modelSemanticDiagnostics ?? null) : null;
    const savedDiff = shell && percept?.model
      ? adapter.shellAction?.('package', { operation: 'diff', model: percept.model })
      : null;
    const saved = savedDiff?.ok ? savedDiff.result as Record<string, unknown> : null;
    const classSpec = shell && oracleSession?.classId
      ? (() => {
          const derived = adapter.corpus?.spec(oracleSession.classId!);
          return derived?.ok ? derived.result as never : null;
        })()
      : null;
    return {
      classSpec,
      shape: percept ? {
        bbox: unionBoxes(percept.regions.filter((region) => region.faces > 0).map((region) => region.bbox)),
        regionNames: percept.table.regions.map((region) => region.name),
        partNames: percept.parts.map((part) => part.name),
      } : null,
      model: percept ? {
        id: percept.model,
        faces: percept.faces,
        unnamed: percept.unnamed,
        placeholders: percept.placeholders,
        // Populated regions only: renaming a generator region leaves its old table
        // row behind empty, and an empty row labels no face — counting it turned
        // the naming-density gate into a tax on the correct rename workflow.
        regions: percept.regions.length,
        islands: percept.islands,
        parts: percept.parts.length,
        auditComputed: percept.auditComputed,
        intersectingFaces: percept.intersectingFaces,
        unreachableFaces: percept.unreachableFaces,
      } : null,
      claimed: percept?.model ? seatModelClaimedByToken(percept.model, claimToken) : null,
      packageInSync: saved ? saved.inSync === true : null,
      packageDirty: saved ? saved.dirty === true : null,
      semanticHealthy: diagnostics ? (diagnostics as Record<string, unknown>).status === 'healthy' : null,
      rig: percept?.rig ?? null,
      attest: oracleSession?.attest ?? {},
    };
  };
  // ── notes: cheap, mutable, disposable handoff memory ─────────────────────────
  // Deliberately NOT the class corpus. Notes carry intent a percept can never answer;
  // the corpus carries measurements. Keeping them apart is what stops the corpus
  // filling with noise.
  const noteBook = (percept: SeatPercept | null): SeatNoteBook => {
    const stored = adapter.noteState?.read(percept?.model ?? null);
    return isNoteBook(stored) ? stored : emptyNoteBook(percept?.model ?? null);
  };
  const notes = (operation: string, args: Record<string, unknown>): SeatShellReceipt => {
    const percept = look();
    const generation = percept?.generation ?? 0;
    const book = noteBook(percept);
    if (operation === 'read') {
      return { ok: true, result: { model: book.model, ...summarizeNotes(book, generation), generation } };
    }
    if (operation === 'append') {
      const kind = parseNoteKind(args.kind);
      if (!kind) return { ok: false, reason: 'a note is a decision, an observation, or a todo' };
      const appended = appendNote(book, {
        text: String(args.text ?? ''), kind, generation,
        phase: oracleSession ? currentPhase(oracleSession) : null,
        agent: typeof args.agent === 'string' ? args.agent : null,
        at: new Date().toISOString(),
      });
      if ('reason' in appended) return { ok: false, reason: appended.reason };
      const durable = adapter.noteState?.write(book.model, appended.book) ?? false;
      return { ok: true, result: {
        note: appended.note, dropped: appended.dropped, durable,
        ...(durable ? {} : { warning: 'this model has no package on disk yet, so the note lives only in hot state — save the model to make the handoff survive a cold restart' }),
      } };
    }
    if (operation === 'drop') {
      const dropped = dropNote(book, Number(args.id));
      if ('reason' in dropped) return { ok: false, reason: dropped.reason };
      adapter.noteState?.write(book.model, dropped);
      return { ok: true, result: summarizeNotes(dropped, generation) };
    }
    if (operation === 'clear') {
      const cleared = emptyNoteBook(book.model);
      adapter.noteState?.write(book.model, cleared);
      return { ok: true, result: { cleared: book.notes.length } };
    }
    return { ok: false, reason: `unknown note operation "${operation}" — read, append, drop, or clear` };
  };
  // One tag per resident seat, so telemetry can tell "four attempts in one session"
  // apart from "one attempt in four sessions" — the whole point of the difficulty stat.
  const refusalsByPhase = new Map<string, number>();
  const sessionTag = `seat-${Math.random().toString(16).slice(2, 10)}`;
  const logTrajectory = (event: string, view: { phase: string | null; plan: string; classId: string | null }, checks: string[], attempt?: number) => {
    adapter.corpus?.logTelemetry({
      at: new Date().toISOString(), session: sessionTag, model: look()?.model ?? null,
      plan: view.plan, classId: view.classId, phase: view.phase ?? 'complete', event,
      ...(checks.length ? { checks } : {}), ...(attempt === undefined ? {} : { attempt }),
    });
  };
  const readOracleDoc: OracleDocReader = (name) => adapter.readSkillDoc?.(name) ?? null;
  const oracleDocFor = (phase: string): string =>
    readOracleDoc(phase) ?? `(no corpus slice for "${phase}" — the phase runs on its checklist alone; that gap is worth reporting)`;
  const oracle = (operation: string, args: Record<string, unknown>, claimToken?: string): SeatShellReceipt => {
    if (operation === 'plans') {
      return { ok: true, result: { plans: ORACLE_PLANS.map(({ id, summary, phases }) => ({ id, summary, phases })) } };
    }
    if (operation === 'ask') {
      const query = String(args.query ?? '').trim();
      const hits = askCorpus(query, readOracleDoc, Number(args.limit) || 3);
      // A lookup must never move the plan: routing is not state.
      return hits.length > 0
        ? { ok: true, result: { query, hits, phaseUnchanged: oracleSession ? currentPhase(oracleSession) : null } }
        : { ok: false, reason: query ? `nothing in the corpus matches "${query}"` : 'oracle ask needs a query' };
    }
    if (operation === 'start') {
      const task = String(args.task ?? '').trim();
      if (!task) return { ok: false, reason: 'oracle start needs a task description — it is what selects the plan' };
      const session = startSession(task);
      // A class is matched from the SAME task string that picked the plan, so
      // "build a compact sedan" loads the car spec and gets graded against the
      // distribution of approved cars rather than against a phrase.
      const corpus = adapter.corpus?.readCorpus();
      session.classId = isClassCorpus(corpus) ? classifyByCorpus(task, corpus)?.classId ?? null : null;
      storeOracle(session);
      const view = viewSession(session, oracleFacts(look(), true, claimToken));
      logTrajectory('start', view, []);
      return { ok: true, result: { ...view, matched: session.matchedSignal, doc: oracleDocFor(view.phase!) } };
    }
    if (operation === 'spec') {
      const classId = String(args.class ?? oracleSession?.classId ?? '').trim();
      if (!classId) return { ok: false, reason: 'name a class, or start a plan whose task matches one' };
      return adapter.corpus?.spec(classId) ?? { ok: false, reason: 'the class corpus is unavailable in this editor' };
    }
    if (operation === 'exemplar') {
      // Human-gated on purpose: an unguarded corpus converges on average agent output.
      const verdict = args.verdict === 'rejected' ? 'rejected' as const : 'approved' as const;
      const classId = String(args.class ?? '').trim();
      const model = String(args.model ?? look()?.model ?? '').trim();
      const by = String(args.by ?? '').trim();
      if (!classId || !model) return { ok: false, reason: 'oracle exemplar needs a class and a model id' };
      if (!by) return { ok: false, reason: 'oracle exemplar needs --by: only a person can approve an exemplar, and the corpus records who' };
      const reason = typeof args.reason === 'string' ? args.reason : null;
      if (verdict === 'rejected' && !reason) {
        return { ok: false, reason: 'a rejection needs a reason — rejections with reasons are the rows that become new checks' };
      }
      const recorded = adapter.corpus?.approve(classId, model, verdict, reason, by)
        ?? { ok: false, reason: 'the class corpus is unavailable in this editor' };
      if (recorded.ok) {
        const percept = look();
        adapter.corpus?.logTelemetry({
          at: new Date().toISOString(), session: sessionTag, model, plan: oracleSession?.planId ?? 'none',
          classId, phase: oracleSession ? currentPhase(oracleSession) : 'none', event: 'outcome',
          outcome: { verdict, ...(reason ? { reason } : {}), triangles: percept?.faces ?? 0, unnamed: percept?.unnamed ?? 0,
            unreachableFaces: percept?.auditComputed ? percept.unreachableFaces ?? 0 : null },
        });
      }
      return recorded;
    }
    if (operation === 'telemetry') {
      return adapter.corpus?.telemetry() ?? { ok: false, reason: 'the telemetry store is unavailable in this editor' };
    }
    if (operation === 'note') {
      return notes(String(args.note ?? 'read'), args);
    }
    if (!oracleSession) {
      return { ok: false, reason: 'no plan is running — start one with `tools/seat oracle start "<what you are here to do>"`' };
    }
    if (operation === 'stop') {
      // Abandoning a plan is a real move: a lane that finished, or picked the wrong
      // task description, should be able to clear the ambient counter rather than
      // leaving a stale phase on every reply for the next agent to misread.
      const ending = { plan: oracleSession.planId, phase: currentPhase(oracleSession), complete: isComplete(oracleSession) };
      storeOracle(null);
      return { ok: true, result: { stopped: ending } };
    }
    if (operation === 'status') {
      const view = viewSession(oracleSession, oracleFacts(look(), true, claimToken));
      return { ok: true, result: { ...view, ...(args.doc === true ? { doc: view.phase ? oracleDocFor(view.phase) : null } : {}) } };
    }
    if (operation === 'attest') {
      const id = String(args.id ?? '').trim();
      const note = String(args.note ?? '').trim();
      const known = viewSession(oracleSession, oracleFacts(look(), false, claimToken)).checks.find((check) => check.id === id);
      if (!known) return { ok: false, reason: `"${id}" is not an exit criterion of the current phase` };
      if (known.verified === 'host') {
        return { ok: false, reason: `"${id}" is HOST-measured — attesting cannot pass it. ${known.detail}` };
      }
      if (!note) return { ok: false, reason: `attesting "${id}" requires saying how you verified it` };
      oracleSession.attest[id] = note;
      storeOracle(oracleSession);
      return { ok: true, result: viewSession(oracleSession, oracleFacts(look(), true, claimToken)) };
    }
    if (operation === 'advance') {
      const outcome = advanceSession(oracleSession, oracleFacts(look(), true, claimToken));
      if (outcome.ok) {
        storeOracle(oracleSession);
        logTrajectory('advance', outcome.view, outcome.view.checks.map((check) => check.id));
      } else {
        refusalsByPhase.set(outcome.view.phase ?? 'complete', (refusalsByPhase.get(outcome.view.phase ?? 'complete') ?? 0) + 1);
        logTrajectory('refused', outcome.view, outcome.failing.map((check) => check.id), refusalsByPhase.get(outcome.view.phase ?? 'complete'));
      }
      // Passing hands back the next phase's doc in the SAME reply — the agent never has
      // to remember to fetch it, which is what keeps the gate on the path of least
      // resistance rather than beside it.
      return outcome.ok
        ? { ok: true, result: { ...outcome, doc: outcome.to ? oracleDocFor(outcome.to) : null } }
        : { ok: false, reason: outcome.reason, result: { failing: outcome.failing, view: outcome.view } };
    }
    return { ok: false, reason: `unknown oracle operation "${operation}" — start, status, advance, attest, note, ask, spec, exemplar, telemetry, stop, or plans` };
  };
  /** The ambient field every reply carries. Percept-only, so it costs nothing. */
  const oracleAmbient = (percept: SeatPercept | null): SeatPercept | null => {
    if (!percept || !oracleSession) return percept;
    const view = viewSession(oracleSession, oracleFacts(percept, false));
    return { ...percept, oracle: {
      phase: view.phase ?? 'complete', blocked: view.blocked, plan: view.plan, position: view.position,
    } };
  };
  const reply = (op: string, ok: boolean, result?: unknown, reason?: string): SeatReply => ({ ok, op, result, percept: oracleAmbient(look()), ...(reason ? { reason } : {}) });
  return {
    look, elements, selection, retopoBands, boundaryContinuation, follow, followPatch,
    select, selectEdge, selectVertex, selectFace, selectAudit, selectSplitPoints, editRegion, selectElements, selectBoundaryEdgePairs, selectBoundaryEdgePoints, selectBoundaryContinuation, nameSelection, extrude, extrudeEdge,
    connectVertices, createFace, bevel, inset, move, scale, scaleUniform, alignLoop, rotate, deleteSelection,
    mergeFaces, weld, weldPairs, normalizeWidths, solidify, detach, flip, glass, paint, paintReadiness, atlas, material, uv, save,
    undo, redo, symmetrize, loopCut, trisToQuads, uvZone, mirrorMatchQuads, mirrorReplace, collectUvOrientation, shellAction, withTopoRefusal,
    addPrimitive, newPrimitive, shot, shotOffscreen, recipeList, runRecipe, reply,
    measure, stats, align, oracle, walk, setPosition, regionTable,
  };
}

export type AgentSeat = ReturnType<typeof createAgentSeat>;
export type SeatRequest = {
  action: string;
  args?: Record<string, unknown>;
  /** Claim password (req_3850). The transport stamps one payload-level token
   * onto every row so a batch carries it once. Absent on an unclaimed model. */
  token?: string;
  /** Target model id. Claim admission keys on this target; the shell receiver
   * owns per-document session routing. */
  model?: string;
};
export type SeatBootstrapAdapter = { newPrimitive: (spec: SeatPrimitiveSpec) => boolean };

export const seatRequestTarget = (request: SeatRequest, activeModel: string | null): string | null =>
  request.action === 'new' ? null : request.model ?? activeModel ?? null;

export const seatModelClaimedByToken = (model: string | null, token: string | undefined): boolean =>
  claimHolder(model) !== null && claimAdmits(model, token).ok;

const BACKGROUND_VISIBLE_VIEWPORT_ACTIONS = new Set(['viewport', 'reference', 'paint-tool', 'path', 'thumbnail', 'auto-rig']);
const BACKGROUND_FOCUS_BRIDGE_ACTIONS = new Set([
  'uv-state', 'uv-select', 'uv-layout', 'uv-prestack', 'uv-stitch', 'uv-two-sheet',
  'uv-geometry', 'uv-history', 'uv-atlas', 'uv-layer', 'paint-variant', 'semantic-status', 'face-table', 'face-select',
]);
const BACKGROUND_EDITOR_COMMAND_ACTIONS = new Set(['command', 'model-export', 'model-starter', 'model-import']);
const BACKGROUND_PART_GEOMETRY_ACTIONS = new Set([
  'add', 'detach', 'part-visibility', 'part-delete', 'part-duplicate', 'part-merge',
  'part-path-array', 'part-import',
]);

export function backgroundSeatRefusal(action: string, args: Record<string, unknown>): string | null {
  if (action === 'rig-status') {
    return 'character rig status belongs to the visible model document; open the target model before reading its resident rig';
  }
  if (action === 'rig' && !['read', 'replace', 'lights-replace'].includes(String(args.operation ?? 'read'))) {
    return 'character rig operations belong to the visible model document; open the target model before changing its resident rig';
  }
  if (BACKGROUND_VISIBLE_VIEWPORT_ACTIONS.has(action)) {
    return `${action} drives the visible model viewport; a background model is not the document on screen`;
  }
  if (BACKGROUND_FOCUS_BRIDGE_ACTIONS.has(action)) {
    return `the UV/paint focus bridge belongs to the visible ModelView; ${action} cannot target a background model`;
  }
  if (action === 'shot' && args.offscreen !== true) {
    return 'a window capture renders the frame the editor is composing; a background model has no framed scene — pass offscreen:true to render the model itself';
  }
  if (BACKGROUND_EDITOR_COMMAND_ACTIONS.has(action)) return 'editor commands run against the visible editor';
  if (BACKGROUND_PART_GEOMETRY_ACTIONS.has(action)) return "part geometry ops mirror through the visible viewer's part-range table; they cannot target a background model yet";
  if (action === 'atlas') return 'the paint atlas transaction is owned by the visible painter';
  if (action === 'follow') return "Follow records the human's demonstrations in the visible editor";
  if (action === 'new') return 'new creates a document and has no target model';
  if (action === 'recipe') return 'recipes compose part-geometry verbs';
  if (action === 'retopo-bands' && String(args.operation ?? 'read') !== 'read') {
    return 'retopology guides persist into the visible model package';
  }
  return null;
}

// ---- Claim admission (req_3850) --------------------------------------------
// Reads are never gated; every other action on a claimed model needs its
// password. `operation:"read"` covers the read lane of operation-carrying
// actions (viewport, retopo-bands, follow, uv-prestack diagnostics, ...).

const SEAT_READ_ACTIONS = new Set([
  'look', 'semantic-status', 'rig-status', 'face-table', 'elements', 'selection', 'boundary-continuation', 'uv-state',
  'topo-refusal',
  'recipe-list', 'shot', 'claims', 'lore',
  // The host's part-ownership truth is a pure read of the journal log's `current`
  // view. It is the ONLY way an agent can see the shell's Outliner rows disagree
  // with the native range table (req_4189), so a supervisor must be able to run it
  // against a claimed model without taking the claim away from its holder.
  'part-ownership',
  // Saved-package reads touch neither the resident mesh nor the live selection, so
  // a supervisor can inspect a claimed model's disk state without taking the claim.
  // `measure`/`stats` are deliberately NOT here: their richer selector targets set
  // the live selection, and clobbering a claimed agent's selection is a crossed wire.
  'package',
  // `regions` joins two arrays of the percept and touches nothing else, so a supervisor
  // can read a claimed model's named surfaces without taking the claim.
  'regions',
  // Listing/opening a saved package changes only visible editor focus. It is
  // the cold-start door that lets a verifier mount a model without scraping
  // manifests for ids or asking a person to reconstruct UI state.
  'model-open',
  // The oracle routes docs and reads its own workflow cursor. It never touches the
  // resident mesh or the live selection, so a lane can consult it before it claims.
  'oracle',
]);

const seatRequestReads = (request: SeatRequest): boolean => {
  if (request.action === 'auto-rig' && request.args?.operation === 'status') return true;
  if (SEAT_READ_ACTIONS.has(request.action)) return true;
  const operation = String((request.args ?? {}).operation ?? '');
  if (operation === 'read') return true;
  if (request.action === 'follow' && operation === 'inspect') return true;
  return false;
};

const seatAdmission = (request: SeatRequest): { ok: boolean; reason?: string } => {
  // `new` creates a fresh document; an unrelated claim on the currently visible
  // model has no authority over that targetless shell operation.
  if (request.action === 'new') return { ok: true };
  if (seatRequestReads(request)) return { ok: true };
  const target = request.model ?? claimActiveModel();
  return claimAdmits(target, request.token);
};

function executeClaimRequest(request: SeatRequest): SeatReply {
  const args = request.args ?? {};
  if (request.action === 'claims') {
    return { ok: true, op: 'claims', result: { claims: listClaims(), activeModel: claimActiveModel() }, percept: null };
  }
  // Target resolution mirrors seatAdmission: the payload-level model target
  // (RJIT_SEAT_MODEL rides there) binds a claim to the agent's OWN model, not
  // whichever tab happens to be active mid-bootstrap (live bug, req_3923).
  const model = String(args.model ?? request.model ?? claimActiveModel() ?? '');
  const password = String(args.password ?? request.token ?? '');
  if (request.action === 'claim') {
    const outcome = claimModel(model, password, String(args.agent ?? 'agent'));
    return { ok: outcome.ok, op: 'claim', ...(outcome.ok ? { result: { model } } : { reason: outcome.reason }), percept: null };
  }
  const outcome = dismissClaim(model, password);
  return { ok: outcome.ok, op: 'dismiss', ...(outcome.ok ? { result: { model } } : { reason: outcome.reason }), percept: null };
}

const primitiveSpecFromRequest = (
  args: Record<string, unknown>,
  defaults: Pick<SeatPrimitiveSpec, 'size' | 'height' | 'sides'>,
): SeatPrimitiveSpec => ({
  kind: String(args.kind ?? 'cube'),
  size: Number(args.size ?? defaults.size),
  height: Number(args.height ?? defaults.height),
  sides: Number(args.sides ?? defaults.sides),
});

/** The editor shell owns the Seat transport even before a ModelView exists.
 * This boundary breaks the bootstrap cycle where a person had to create a
 * disposable model merely to expose the API whose first verb is `new`. */
export function executeSeatRequestAtShell(
  seat: AgentSeat | null,
  request: SeatRequest,
  bootstrap: SeatBootstrapAdapter,
): SeatReply {
  if (request.action === 'claim' || request.action === 'dismiss' || request.action === 'claims') {
    return executeClaimRequest(request);
  }
  const admission = seatAdmission(request);
  if (!admission.ok) {
    return { ok: false, op: request.action, percept: seat?.look() ?? null, reason: admission.reason };
  }
  if (seat) return executeSeatRequest(seat, request);
  if (request.action === 'look') {
    return { ok: true, op: 'look', result: { state: 'no-live-model' }, percept: null };
  }
  if (request.action === 'new') {
    const spec = primitiveSpecFromRequest(request.args ?? {}, { size: 1, height: 1, sides: 16 });
    const ok = bootstrap.newPrimitive(spec);
    return {
      ok,
      op: 'new',
      ...(ok ? { result: { kind: spec.kind } } : { reason: 'new rejected — unknown primitive or the editor shell bridge is unavailable' }),
      percept: null,
    };
  }
  return {
    ok: false,
    op: request.action,
    percept: null,
    reason: 'no live model — create one with new before using mesh actions',
  };
}

/** One decision applied per matching part, instead of the 40-row batch an agent must
 *  generate and get every id right in. Parts are the unit because they are the durable
 *  identities a repeat is actually about — they survive the generation bump each step
 *  causes, which a list of triangle ids does not. Each row is its own transaction and a
 *  refusal names the part that refused, so a partial sweep is visible rather than silent. */
export function runSeatForEach(seat: AgentSeat, args: Record<string, unknown>): SeatShellReceipt {
  const selector = String(args.selector ?? '').trim();
  const step = args.do as { action?: string; args?: Record<string, unknown> } | undefined;
  if (!selector || !step?.action) return { ok: false, reason: 'for-each needs a selector and a {action,args} step' };
  if (step.action === 'for-each' || step.action === 'batch') return { ok: false, reason: 'for-each cannot nest — it is already the repeat' };
  const percept = seat.look();
  if (!percept) return { ok: false, reason: 'no live mesh' };
  const needle = selector.replace(/^part:/, '');
  const targets = percept.parts.filter((part) => part.visible && part.name.includes(needle));
  if (targets.length === 0) return { ok: false, reason: `no visible Outliner part matches "${selector}"` };
  const rows: { part: string; ok: boolean; reason?: string }[] = [];
  for (const part of targets) {
    const scoped = seat.shellAction('part-select', { ids: [part.id] });
    if (!scoped.ok) { rows.push({ part: part.name, ok: false, reason: scoped.reason }); continue; }
    const outcome = executeSeatRequest(seat, { action: step.action, args: step.args ?? {} });
    rows.push({ part: part.name, ok: outcome.ok, ...(outcome.reason ? { reason: outcome.reason } : {}) });
  }
  const failed = rows.filter((row) => !row.ok);
  return failed.length === 0
    ? { ok: true, result: { selector, applied: rows.length, rows } }
    : { ok: false, result: { selector, applied: rows.length - failed.length, rows }, reason: `${failed.length} of ${rows.length} parts refused: ${failed.map((row) => row.part).join(', ')}` };
}

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
      // Why did the last topology op refuse? Reading it must not REQUIRE attempting an
      // op: a probe that happens to succeed mutates a model somebody is editing, which
      // is exactly the crossed wire that cost a face during req_4114. This is a pure
      // read of the host's last recorded refusal.
      case 'topo-refusal': {
        const reason = seat.withTopoRefusal('');
        return seat.reply('topo-refusal', true, { reason: reason || null }, undefined);
      }
      case 'elements': {
        const result = seat.elements();
        return seat.reply('elements', !!result, result ?? undefined, result ? undefined : 'topology descriptors unavailable');
      }
      case 'selection': {
        const result = seat.selection();
        return seat.reply('selection', !!result, result ?? undefined, result ? undefined : 'the live selection snapshot is unavailable — no model is mounted');
      }
      // The read-only arithmetic lane (req_4052). These never generate geometry;
      // `align` is the one that acts, and it applies exactly the delta its own
      // dry run reports.
      case 'measure': {
        const result = seat.measure(String(args.operation ?? 'bbox'), args);
        return seat.reply('measure', result.ok, result.result, result.reason);
      }
      case 'stats': {
        const result = seat.stats(String(args.operation ?? 'anomalies'), args);
        return seat.reply('stats', result.ok, result.result, result.reason);
      }
      case 'align': {
        const result = seat.align(args);
        return seat.reply('align', result.ok, result.result, result.reason);
      }
      // The phase-gate router (req_4053). `start`/`ask`/`plans` are reads; `advance`
      // and `attest` move the agent's own workflow cursor, never the model.
      case 'select-path': case 'select-loop': case 'select-ring':
      case 'select-grow': case 'select-similar': {
        const result = seat.walk(request.action.slice('select-'.length), args);
        return seat.reply(request.action, result.ok, result.result, result.reason);
      }
      case 'regions': {
        const result = seat.regionTable(args);
        return seat.reply('regions', result.ok, result.result, result.reason);
      }
      case 'set-position': {
        const result = seat.setPosition(args);
        return seat.reply('set-position', result.ok, result.result, result.reason);
      }
      case 'for-each': {
        const result = runSeatForEach(seat, args);
        return seat.reply('for-each', result.ok, result.result, result.reason);
      }
      case 'oracle': {
        const result = seat.oracle(String(args.operation ?? 'status'), args, request.token);
        return seat.reply('oracle', result.ok, result.result, result.reason);
      }
      case 'retopo-bands': {
        const result = seat.retopoBands(String(args.operation ?? 'read'), args);
        return seat.reply('retopo-bands', result.ok, result.result, result.reason);
      }
      case 'boundary-continuation': {
        const result = seat.boundaryContinuation(args.open);
        return seat.reply(
          'boundary-continuation',
          !!result,
          result ?? undefined,
          result ? undefined : 'open must be one current boundary edge expressed as [vertexA,vertexB]',
        );
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
      case 'region-edit': {
        const remove = args.remove === true;
        const result = seat.editRegion(String(args.name ?? ''), remove ? null : String(args.rename ?? ''), remove);
        return seat.reply('region-edit', !!result, result ?? undefined, result ? undefined : 'needs an existing region name plus either rename:"<new>" (unique, non-empty) or remove:true');
      }
      case 'select-split-points': {
        const result = seat.selectSplitPoints();
        return seat.reply('select-split-points', !!result, result ?? undefined, result ? undefined : 'no live mesh, or the resident mesh carries no logical row table to compare against');
      }
      case 'select-audit': {
        const result = seat.selectAudit(String(args.kind ?? 'both'));
        return seat.reply('select-audit', !!result, result ?? undefined, result ? undefined : 'kind must be "intersecting", "unreachable", or "both", and a model must be open');
      }
      case 'select-elements': {
        const kind = String(args.kind ?? 'face');
        if (kind === 'face') return seat.reply('select-elements', false, undefined, 'kind:"face" is ambiguous and refused — indices here are render triangles, so use kind:"triangle"; authored face-group ranges use groups:<lo>..<hi>');
        if (kind !== 'triangle' && kind !== 'edge' && kind !== 'vertex') return seat.reply('select-elements', false, undefined, 'kind must be triangle, edge, or vertex');
        const changed = seat.selectElements(kind, args.indices);
        return seat.reply('select-elements', changed > 0, { changed }, changed > 0 ? undefined : 'no valid in-scope element indices were selected');
      }
      case 'select-edge-pairs': {
        const result = seat.selectBoundaryEdgePairs(args.pairs);
        return seat.reply(
          'select-edge-pairs',
          !!result,
          result ?? undefined,
          result ? undefined : 'every pair must resolve to one current boundary edge; selection was left unchanged',
        );
      }
      case 'select-edge-points': {
        const result = seat.selectBoundaryEdgePoints(args.pairs, Number(args.tolerance ?? 0.000001));
        return seat.reply(
          'select-edge-points',
          !!result,
          result ?? undefined,
          result ? undefined : 'every point must resolve uniquely to one current boundary-edge endpoint; selection was left unchanged',
        );
      }
      case 'select-edge-continuation': {
        const result = seat.selectBoundaryContinuation(args.open, args.edges);
        return seat.reply(
          'select-edge-continuation',
          !!result,
          result ?? undefined,
          result ? undefined : 'continuation needs one boundary edge sharing each endpoint of open; disjoint, same-side, and collapsed pairs are rejected',
        );
      }
      case 'name': {
        const changed = seat.nameSelection(String(args.name ?? ''), Number(args.instance ?? 0));
        return seat.reply('name', changed > 0, { changed }, changed > 0 ? undefined : 'no selected faces or invalid name');
      }
      case 'extrude': {
        const outcome = seat.extrude(Number(args.distance ?? 0), String(args.name ?? ''), Number(args.instance ?? 0));
        return seat.reply('extrude', outcome.ok, outcome.ok ? outcome.result : undefined, outcome.ok ? undefined : outcome.reason);
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
        return seat.reply('create-face', !!result, result ?? undefined, result ? undefined : seat.withTopoRefusal('select two bridge edges or a closed 3/4-edge loop and provide a name'));
      }
      case 'bevel': {
        const targetSides = args.targetSides == null ? undefined : Number(args.targetSides);
        const result = seat.bevel(Number(args.width ?? 0), targetSides);
        return seat.reply('bevel', !!result, result ?? undefined, result ? undefined : seat.withTopoRefusal('select one filled convex face, one bevelable edge/vertex, or one complete 3+ edge open boundary loop, then use a valid width and targetSides'));
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
      case 'move': { const ok = seat.move(args.delta as [number, number, number]); return seat.reply('move', ok, undefined, ok ? undefined : 'move rejected — needs delta:[x,y,z] finite meters and an in-scope vertex/edge/face selection (view mode transforms nothing)'); }
      case 'scale': { const ok = seat.scale(args.axis as [number, number, number], args.pivot as [number, number, number], Number(args.factor ?? 1)); return seat.reply('scale', ok, undefined, ok ? undefined : 'scale rejected — needs axis:[x,y,z], pivot:[x,y,z], finite nonzero factor, and an in-scope vertex/edge/face selection (view mode transforms nothing)'); }
      case 'scale-uniform': { const ok = seat.scaleUniform(Number(args.factor)); return seat.reply('scale-uniform', ok, undefined, ok ? undefined : 'uniform scale rejected — needs a finite nonzero factor and an in-scope vertex/edge/face selection'); }
      case 'align-loop': {
        const result = seat.alignLoop();
        return seat.reply('align-loop', !!result, result ?? undefined, result ? undefined : 'align loop rejected — select a skewed vertex row or at least two connected loop edges');
      }
      case 'rotate': { const ok = seat.rotate(args.axis as [number, number, number], args.pivot as [number, number, number], Number(args.degrees ?? 0)); return seat.reply('rotate', ok, undefined, ok ? undefined : 'rotate rejected — needs axis:[x,y,z], pivot:[x,y,z], finite degrees, and an in-scope vertex/edge/face selection (view mode transforms nothing)'); }
      case 'undo': { const result = seat.undo(); return seat.reply('undo', !!result, result ?? undefined, result ? undefined : 'nothing to undo'); }
      case 'redo': { const result = seat.redo(); return seat.reply('redo', !!result, result ?? undefined, result ? undefined : 'nothing to redo'); }
      case 'delete': { const result = seat.deleteSelection(); return seat.reply('delete', !!result, result ?? undefined, result ? undefined : 'nothing selected to delete'); }
      case 'merge-faces': { const result = seat.mergeFaces(); return seat.reply('merge-faces', !!result, result ?? undefined, result ? undefined : seat.withTopoRefusal('Merge Faces joins exactly two triangles across a shared diagonal (a quadifier, not an n-gon builder) — to push a multi-face patch, select it and extrude: a region selection extrudes as one shell')); }
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
        return seat.reply('cut', !!result, result ?? undefined, result ? undefined : seat.withTopoRefusal('loop cut rejected — it needs a face selection to cut across (note: cut PROPAGATES the edge ring around the whole body; basic-cut subdivides only the selected faces)'));
      }
      case 'basic-cut': {
        const result = seat.loopCut(Number(args.direction ?? 0), Number(args.cuts ?? 1), Number(args.offset ?? 0.5), true);
        return seat.reply('basic-cut', !!result, result ?? undefined, result ? undefined : seat.withTopoRefusal('basic cut rejected — select one or more faces (basic-cut subdivides ONLY the selection; use cut when you want the ring to propagate around the body)'));
      }
      case 'uv-zone': {
        const operation = String(args.operation ?? 'read');
        const result = seat.uvZone(operation, Number(args.zone ?? -1));
        return seat.reply('uv-zone', !!result, result ?? undefined, result
          ? undefined
          : 'uv-zone rejected — assign needs FACE mode, a face selection, and zone 0..127; operations are read|assign|delete|clear');
      }
      case 'tris-to-quads': {
        const result = seat.trisToQuads();
        return seat.reply('tris-to-quads', !!result, result ?? undefined, result ? undefined : seat.withTopoRefusal('no compatible triangle pairs were available'));
      }
      case 'mirror-quads': {
        const axisRaw = args.axis;
        const axis = typeof axisRaw === 'string' ? 'xyz'.indexOf(axisRaw.toLowerCase()) : Number(axisRaw ?? 0);
        if (axis < 0 || axis > 2 || !Number.isInteger(axis)) return seat.reply('mirror-quads', false, undefined, 'axis must be 0|1|2 or x|y|z');
        const { receipt, stats } = seat.mirrorMatchQuads(axis);
        const reason = receipt
          ? undefined
          : stats
            ? `nothing fused — scanned ${stats.quads ?? 0} quads: ${stats.symmetric ?? 0} already have a quad twin, ${stats.pairs ?? 0} twin lone-triangle pairs found, ${stats.refused ?? 0} refused by the indexed merge`
            : 'mirror-quads door unavailable — the running host binary predates it; rebuild the dev host';
        return seat.reply('mirror-quads', !!receipt, receipt ?? stats ?? undefined, reason);
      }
      case 'mirror-replace': {
        const axisRaw = args.axis;
        const axis = typeof axisRaw === 'string' ? 'xyz'.indexOf(axisRaw.toLowerCase()) : Number(axisRaw ?? 0);
        if (axis < 0 || axis > 2 || !Number.isInteger(axis)) return seat.reply('mirror-replace', false, undefined, 'axis must be 0|1|2 or x|y|z');
        const { receipt, stats } = seat.mirrorReplace(axis);
        const reason = receipt
          ? undefined
          : stats
            ? 'nothing stamped — select the faces to mirror first (face mode); the selection is reflected across the model-origin plane, the twin space is cleared, and the seam + borders weld'
            : 'mirror-replace door unavailable — the running host binary predates it; rebuild the dev host';
        return seat.reply('mirror-replace', !!receipt, receipt ?? stats ?? undefined, reason);
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
        const spec = primitiveSpecFromRequest(args, { size: 1, height: 1, sides: 16 });
        const ok = seat.newPrimitive(spec);
        return seat.reply('new', ok, ok ? { kind: spec.kind } : undefined, ok ? undefined
          : 'new rejected — unknown primitive or the editor shell bridge is unavailable');
      }
      case 'shot': {
        const path = String(args.path ?? '');
        if (args.offscreen === true) {
          const width = Number(args.width ?? 1024);
          const height = Number(args.height ?? 1024);
          const pose = Array.isArray(args.pose) ? args.pose.map(Number) : null;
          const ok = seat.shotOffscreen(path, width, height, pose);
          return seat.reply('shot', ok, ok ? { path } : undefined, ok ? undefined
            : 'capture door unavailable — the cart must import runtime/capture.ts and the binary must be built with -Dhas-capture');
        }
        const ok = seat.shot(path);
        return seat.reply('shot', ok, ok ? { path } : undefined, ok ? undefined
          : 'capture door unavailable — the cart must import runtime/capture.ts and the binary must be built with -Dhas-capture');
      }
      case 'recipe-list': return seat.reply('recipe-list', true, seat.recipeList());
      case 'recipe': {
        const result = seat.runRecipe(String(args.recipe ?? ''), (args.params as Record<string, unknown>) ?? {});
        return seat.reply('recipe', result.ok, result, result.reason);
      }
      case 'editor-status':
      case 'part-ownership':
      case 'rig-status':
      case 'face-table':
      case 'face-select':
      case 'lore':
      case 'command':
      // The saved package is disk state, so only the shell can read it — but the
      // READER is this editor's own RJMD decoder (req_4052). Agents were parsing
      // the blob by hand with a guessed header offset, which silently returned
      // wrong counts the moment RJMD went v4 → v5 and the header grew 40 → 48 bytes.
      case 'package':
      case 'part-select': case 'part-rename': case 'part-visibility': case 'part-delete':
      case 'part-duplicate': case 'part-merge': case 'part-path-array': case 'part-import':
      case 'parts-group': case 'parts-ungroup': case 'group-rename': case 'group-visibility':
      case 'group-duplicate': case 'group-dissolve': case 'outliner-move': case 'role-name':
      case 'model-rename': case 'model-import': case 'model-export': case 'model-starter':
      case 'model-open': case 'auto-rig':
      case 'thumbnail':
      case 'viewport': case 'reference': case 'uv-state': case 'uv-select': case 'uv-layout': case 'uv-prestack': case 'uv-stitch': case 'uv-two-sheet':
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

// req_4189 probe
