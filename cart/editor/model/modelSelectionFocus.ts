export type ModelSelectionMode = 0 | 1 | 2 | 3;
export type ModelSelectionVec3 = [number, number, number];
export type ModelSelectionBounds = [number, number, number, number, number, number];

export type ModelSelectionVertex = {
  id: number;
  at: ModelSelectionVec3;
  part: number | null;
};

export type ModelSelectionEdge = {
  id: number;
  vertices: [number, number];
  length: number;
  faces: number;
  open: boolean;
  part: number | null;
};

export type ModelSelectionTriangle = {
  id: number;
  group: number | null;
  part: number | null;
  material: number | null;
  region: number | null;
  instance: number | null;
  vertices: [number, number, number];
  normal: ModelSelectionVec3;
  area: number;
};

export type ModelSelectionSnapshot = {
  version: 1;
  mode: ModelSelectionMode;
  count: number;
  affectedVertices: number;
  selectedTriangles: number;
  truncated: boolean;
  pivot: ModelSelectionVec3 | null;
  bounds: ModelSelectionBounds | null;
  vertices: ModelSelectionVertex[];
  edges: ModelSelectionEdge[];
  triangles: ModelSelectionTriangle[];
};

export type ModelSelectionFaceFact = number | null | 'mixed';
export type ModelSelectionFaceSummary = {
  key: string;
  group: number | null;
  triangleIds: number[];
  vertices: number[];
  area: number;
  normal: ModelSelectionVec3;
  part: ModelSelectionFaceFact;
  material: ModelSelectionFaceFact;
  region: ModelSelectionFaceFact;
  instance: ModelSelectionFaceFact;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const whole = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0;
const optionalWhole = (value: unknown): value is number | null => value === null || whole(value);

function tuple(value: unknown, size: number): number[] | null {
  if (!Array.isArray(value) || value.length !== size || !value.every(finite)) return null;
  return value as number[];
}

function parseVertex(value: unknown): ModelSelectionVertex | null {
  if (!isRecord(value) || !whole(value.id) || !optionalWhole(value.part)) return null;
  const at = tuple(value.at, 3);
  return at ? { id: value.id, at: at as ModelSelectionVec3, part: value.part } : null;
}

function parseEdge(value: unknown): ModelSelectionEdge | null {
  if (!isRecord(value) || !whole(value.id) || !whole(value.faces) ||
      !finite(value.length) || value.length < 0 || typeof value.open !== 'boolean' ||
      !optionalWhole(value.part)) return null;
  const vertices = tuple(value.vertices, 2);
  if (!vertices || !vertices.every(whole)) return null;
  return {
    id: value.id,
    vertices: vertices as [number, number],
    length: value.length,
    faces: value.faces,
    open: value.open,
    part: value.part,
  };
}

function parseTriangle(value: unknown): ModelSelectionTriangle | null {
  if (!isRecord(value) || !whole(value.id) || !optionalWhole(value.group) ||
      !optionalWhole(value.part) || !optionalWhole(value.material) ||
      !optionalWhole(value.region) || !optionalWhole(value.instance) ||
      !finite(value.area) || value.area < 0) return null;
  const vertices = tuple(value.vertices, 3);
  const normal = tuple(value.normal, 3);
  if (!vertices || !vertices.every(whole) || !normal) return null;
  return {
    id: value.id,
    group: value.group,
    part: value.part,
    material: value.material,
    region: value.region,
    instance: value.instance,
    vertices: vertices as [number, number, number],
    normal: normal as ModelSelectionVec3,
    area: value.area,
  };
}

function parseRows<T>(value: unknown, parse: (row: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const rows: T[] = [];
  for (const row of value) {
    const parsed = parse(row);
    if (!parsed) return null;
    rows.push(parsed);
  }
  return rows;
}

/** Validate the host boundary as one unit. A malformed row rejects the snapshot instead
 * of letting the UI mix current counts with stale or partially understood topology. */
export function parseModelSelectionSnapshot(raw: unknown): ModelSelectionSnapshot | null {
  let value: unknown = raw;
  if (typeof value === 'string') {
    if (!value) return null;
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!isRecord(value) || value.version !== 1 || !whole(value.mode) || value.mode > 3 ||
      !whole(value.count) || !whole(value.affectedVertices) || !whole(value.selectedTriangles) ||
      typeof value.truncated !== 'boolean') return null;
  const pivot = value.pivot === null ? null : tuple(value.pivot, 3);
  const bounds = value.bounds === null ? null : tuple(value.bounds, 6);
  if ((value.pivot !== null && !pivot) || (value.bounds !== null && !bounds)) return null;
  if (value.affectedVertices === 0 ? (pivot !== null || bounds !== null) : (pivot === null || bounds === null)) return null;
  const vertices = parseRows(value.vertices, parseVertex);
  const edges = parseRows(value.edges, parseEdge);
  const triangles = parseRows(value.triangles, parseTriangle);
  if (!vertices || !edges || !triangles) return null;
  const mode = value.mode as ModelSelectionMode;
  if ((mode !== 2 && edges.length > 0) || (mode !== 3 && triangles.length > 0)) return null;
  if (mode === 0 && (value.count !== 0 || value.affectedVertices !== 0 || value.selectedTriangles !== 0)) return null;
  if (mode !== 3 && value.selectedTriangles !== 0) return null;
  if (vertices.length > value.affectedVertices || edges.length > value.count || triangles.length > value.selectedTriangles) return null;
  return {
    version: 1,
    mode,
    count: value.count,
    affectedVertices: value.affectedVertices,
    selectedTriangles: value.selectedTriangles,
    truncated: value.truncated,
    pivot: pivot as ModelSelectionVec3 | null,
    bounds: bounds as ModelSelectionBounds | null,
    vertices,
    edges,
    triangles,
  };
}

function mergeFact(current: ModelSelectionFaceFact, next: number | null): ModelSelectionFaceFact {
  return current === 'mixed' || current !== next ? 'mixed' : current;
}

/** Collapse resident triangle details into the authored-face unit the user selected. */
export function summarizeSelectedFaces(snapshot: ModelSelectionSnapshot): ModelSelectionFaceSummary[] {
  const summaries = new Map<string, ModelSelectionFaceSummary>();
  for (const triangle of snapshot.triangles) {
    const key = triangle.group === null ? `triangle:${triangle.id}` : `group:${triangle.group}`;
    const found = summaries.get(key);
    if (!found) {
      summaries.set(key, {
        key,
        group: triangle.group,
        triangleIds: [triangle.id],
        vertices: [...new Set(triangle.vertices)].sort((a, b) => a - b),
        area: triangle.area,
        normal: [triangle.normal[0] * triangle.area, triangle.normal[1] * triangle.area, triangle.normal[2] * triangle.area],
        part: triangle.part,
        material: triangle.material,
        region: triangle.region,
        instance: triangle.instance,
      });
      continue;
    }
    found.triangleIds.push(triangle.id);
    found.vertices = [...new Set([...found.vertices, ...triangle.vertices])].sort((a, b) => a - b);
    found.area += triangle.area;
    found.normal[0] += triangle.normal[0] * triangle.area;
    found.normal[1] += triangle.normal[1] * triangle.area;
    found.normal[2] += triangle.normal[2] * triangle.area;
    found.part = mergeFact(found.part, triangle.part);
    found.material = mergeFact(found.material, triangle.material);
    found.region = mergeFact(found.region, triangle.region);
    found.instance = mergeFact(found.instance, triangle.instance);
  }
  return [...summaries.values()].map((summary) => {
    const length = Math.hypot(...summary.normal);
    return { ...summary, normal: length > 1e-8
      ? [summary.normal[0] / length, summary.normal[1] / length, summary.normal[2] / length]
      : [0, 0, 0] };
  });
}

export const modelSelectionModeName = (mode: ModelSelectionMode): 'view' | 'vertex' | 'edge' | 'face' =>
  mode === 1 ? 'vertex' : mode === 2 ? 'edge' : mode === 3 ? 'face' : 'view';

// ── Why won't Create Face fill THIS selection? (req_4202) ─────────────────────
// `meshTopoCreateFaceFromEdges` (framework/gpu/3d.zig) answers one bool. When it is
// false the person holding the mouse has no way to learn WHICH of its gates closed,
// and the only probe available — pressing C again — mutates the model on the runs
// where it happens to work. The shape gates are pure arithmetic over the selection
// snapshot the host already publishes, so they can be read without touching anything.
// Winding and edit-scope are NOT: those live behind host state this snapshot does not
// carry, and they are reported as the host's to decide rather than guessed at.

/** The host reads at most this many selected edges (`selected: [16]Edge` in 3d.zig). */
export const CREATE_FACE_MAX_EDGES = 16;

export type CreateFaceShape = 'bridge' | 'corner' | 'loop-fill' | 'none';
export type CreateFaceReadiness = {
  /** Which of the host's three fills this selection is asking for. */
  shape: CreateFaceShape;
  /** Gates this selection FAILS, measured from the snapshot. Empty means nothing
   *  visible in the selection blocks the fill. */
  blocking: string[];
  /** Gates only the host can answer. Never reported as passing — an unmeasured
   *  gate is unknown, and unknown is not clean. */
  hostDecides: string[];
};

/** Undirected vertex degree over the selected edges, the same adjacency the host's
 *  `closedEdgeLoopOrder` walks. */
function selectedEdgeDegrees(edges: ModelSelectionEdge[]): Map<number, number> {
  const degree = new Map<number, number>();
  for (const edge of edges) for (const vertex of edge.vertices) degree.set(vertex, (degree.get(vertex) ?? 0) + 1);
  return degree;
}

const edgesShareVertex = (a: ModelSelectionEdge, b: ModelSelectionEdge): boolean =>
  a.vertices.some((vertex) => b.vertices.includes(vertex));

/** Read a live selection against Create Face's own gate ladder. Pure. */
export function describeCreateFaceReadiness(snapshot: ModelSelectionSnapshot): CreateFaceReadiness {
  const mode = modelSelectionModeName(snapshot.mode);
  if (mode !== 'edge') {
    return {
      shape: 'none',
      blocking: [`Create Face fills an EDGE selection; the editor is in ${mode} mode`],
      hostDecides: [],
    };
  }
  const { count, edges } = snapshot;
  const blocking: string[] = [];
  const hostDecides: string[] = [];
  if (snapshot.truncated) {
    hostDecides.push(`the snapshot lists ${edges.length} of ${count} selected edges — the rest were truncated`);
  }
  if (count === 0) return { shape: 'none', blocking: ['no edge is selected'], hostDecides };
  if (count === 1) {
    return {
      shape: 'none',
      blocking: ['Create Face needs 2 or more edges; 1 is selected — the second pick must be ADDITIVE (a plain click replaces the selection)'],
      hostDecides,
    };
  }
  if (count > CREATE_FACE_MAX_EDGES) {
    return {
      shape: 'none',
      blocking: [`the host reads at most ${CREATE_FACE_MAX_EDGES} selected edges; ${count} are selected`],
      hostDecides,
    };
  }
  // Only the host's `edgeInScopePub`-filtered view decides which selected edges it
  // actually receives; the snapshot lists the selection unfiltered.
  hostDecides.push('whether every selected edge is inside the active part scope, and is an authored edge rather than a triangulation diagonal');

  if (count > 4) {
    return {
      shape: 'none',
      blocking: [`past 2 edges Create Face only fills a CLOSED loop of 3 or 4 edges; ${count} are selected`],
      hostDecides,
    };
  }
  if (count >= 3) {
    const degree = selectedEdgeDegrees(edges);
    const open = [...degree.entries()].filter(([, uses]) => uses !== 2).map(([vertex]) => vertex);
    if (degree.size !== count || open.length > 0) {
      blocking.push(`a ${count}-edge fill must be a CLOSED loop — ${degree.size} distinct corners over ${count} edges, and ${open.length} of them are not shared by exactly two selected edges`);
    }
    hostDecides.push('whether the surfaces beside all selected edges agree on a facing — the loop fill takes its winding from their averaged normal and refuses when any two oppose');
    return { shape: 'loop-fill', blocking, hostDecides };
  }

  const [first, second] = edges;
  if (!first || !second) return { shape: 'none', blocking: ['the selected edges could not be read'], hostDecides };
  if (edgesShareVertex(first, second)) {
    hostDecides.push('whether the two surfaces beside the selected edges agree on a facing — a corner triangle has no fallback and refuses outright when they oppose');
    return { shape: 'corner', blocking, hostDecides };
  }
  // The disjoint bridge has three winding authorities in order: the two edges' own
  // neighbour normals, then the quad's OTHER two sides when those already exist as
  // edges, then boundary circulation — and that last one needs exactly one incident
  // triangle per selected edge, which is measurable here.
  const closed = [first, second].filter((edge) => edge.faces > 1);
  if (closed.length > 0) {
    blocking.push(`${closed.map((edge) => `edge ${edge.id} already carries ${edge.faces} faces`).join(' and ')} — a bridge across closed surface has no boundary circulation to take its winding from, so it lands only if those surfaces already agree on a facing`);
  }
  const bare = [first, second].filter((edge) => edge.faces === 0);
  if (bare.length > 0) {
    blocking.push(`${bare.map((edge) => `edge ${edge.id}`).join(' and ')} carries no face at all — a wire edge has no surface to take a winding from`);
  }
  hostDecides.push('whether a winding survives: the two edges\' neighbour normals, else the quad\'s other two sides if BOTH already exist as edges, else boundary circulation across the selected pair, else any one side the quad already shares with the mesh');
  return { shape: 'bridge', blocking, hostDecides };
}
