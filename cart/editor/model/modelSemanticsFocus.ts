import {
  NO_SEMANTIC_ID,
  parseMeshSemanticTable,
  type MeshEdgeRegion,
  type MeshSemanticRegion,
  type MeshSemanticTable,
} from './meshSemantics';

export { NO_SEMANTIC_ID } from './meshSemantics';

export type SavedModelSemantics = {
  regions?: Uint32Array | number[];
  instances?: Uint32Array | number[];
  table?: MeshSemanticTable | null;
};

export type ResidentModelSemantics = {
  faces: number;
  unnamed: number;
  hiddenFaces?: number;
  hiddenNamedFaces?: number;
  hiddenRegions?: number;
  // `groups` is the region's authored-group span [lo, hi) from the percept
  // (req_4392) — absent on hosts predating the field.
  regions: { id: number; faces: number; instances: number; groups?: number[] }[];
  table: MeshSemanticTable;
} | null;

export type ModelFocusFaceSemanticRow = {
  kind: 'face';
  id: number;
  name: string;
  role: string;
  parent: number | null;
  faces: number;
  instances: number;
  presence: 'resident' | 'not-visible' | 'mount-only' | 'saved-only';
  /** Authored-group span [lo, hi) of the region's resident faces (req_4392) —
   *  the join the Outliner nests regions under parts with. Null when the host
   *  percept predates the field or the region is not resident. */
  groupSpan: [number, number] | null;
};

export type ModelFocusEdgeSemanticRow = {
  kind: 'edge';
  id: number;
  name: string;
  role: MeshEdgeRegion['role'];
  objectId: string;
  closed: boolean;
  vertices: number;
  edges: number;
  presence: 'resident' | 'not-visible' | 'mount-only' | 'saved-only';
};

export type ModelFocusSemanticRow = ModelFocusFaceSemanticRow | ModelFocusEdgeSemanticRow;

export type ModelFocusSemanticRowGroups = {
  faces: ModelFocusFaceSemanticRow[];
  edges: ModelFocusEdgeSemanticRow[];
};

/** Search the shared semantic namespace, then retain an explicit geometry-kind
 *  split for UI consumers. Edge object identity is searchable because it is part
 *  of the durable rigging meaning even though the narrow Names pane does not print
 *  the full id beside every row. */
export function filterModelFocusSemanticRows(
  rows: ModelFocusSemanticRow[],
  filter: string,
): ModelFocusSemanticRowGroups {
  const needle = filter.trim().toLowerCase();
  const shown = needle ? rows.filter((row) => {
    const searchable = row.kind === 'edge'
      ? `${row.name} ${row.role} ${row.objectId}`
      : `${row.name} ${row.role}`;
    return searchable.toLowerCase().includes(needle);
  }) : rows;
  return {
    faces: shown.filter((row): row is ModelFocusFaceSemanticRow => row.kind === 'face'),
    edges: shown.filter((row): row is ModelFocusEdgeSemanticRow => row.kind === 'edge'),
  };
}

export type ModelFocusSemantics = {
  status: 'healthy' | 'visibility-filtered' | 'mount-mismatch' | 'load-mismatch' | 'resident-only' | 'none';
  documentId?: string;
  packageDir?: string | null;
  mountSource?: string;
  savedFaces: number;
  savedNamedFaces: number;
  savedRegions: number;
  mountFaces: number;
  mountNamedFaces: number;
  mountRegions: number;
  residentFaces: number;
  residentNamedFaces: number;
  residentRegions: number;
  residentUnnamed: number;
  residentHiddenFaces: number;
  residentHiddenNamedFaces: number;
  residentHiddenRegions: number;
  savedEdgeRegions: number;
  mountEdgeRegions: number;
  residentEdgeRegions: number;
  rows: ModelFocusSemanticRow[];
};

type Region = { id: number; name: string; role: string; parent: number | null };

function tableFrom(value: unknown): MeshSemanticTable | null { return parseMeshSemanticTable(value); }
function faceRegionsFrom(value: unknown): MeshSemanticRegion[] { return tableFrom(value)?.regions ?? []; }
function edgeRegionsFrom(value: unknown): MeshEdgeRegion[] { return tableFrom(value)?.edgeRegions ?? []; }

/** Compare durable RJMD semantics to the resident native mesh without inferring either. */
export function modelFocusSemantics(
  saved: SavedModelSemantics,
  resident: ResidentModelSemantics,
  mount: SavedModelSemantics = saved,
  context: Pick<ModelFocusSemantics, 'documentId' | 'packageDir' | 'mountSource'> = {},
): ModelFocusSemantics {
  const savedRows = Array.from(saved.regions ?? []);
  const savedTable = faceRegionsFrom(saved.table);
  const savedEdges = edgeRegionsFrom(saved.table);
  const mountRows = Array.from(mount.regions ?? []);
  const mountTable = faceRegionsFrom(mount.table);
  const mountEdges = edgeRegionsFrom(mount.table);
  const residentTable = faceRegionsFrom(resident?.table ?? null);
  const residentEdges = edgeRegionsFrom(resident?.table ?? null);
  const residentCounts = new Map((resident?.regions ?? []).map((row) => [row.id, row]));
  const names = new Map<number, Region>();
  const toRegion = (row: MeshSemanticRegion): Region => ({
    id: row.id, name: row.name, role: row.role ?? '', parent: Number.isInteger(row.parent) ? row.parent as number : null,
  });
  for (const row of savedTable) names.set(row.id, toRegion(row));
  for (const row of mountTable) names.set(row.id, toRegion(row));
  for (const row of residentTable) names.set(row.id, toRegion(row));
  const savedNamedFaces = savedRows.filter((id) => id !== NO_SEMANTIC_ID).length;
  const mountNamedFaces = mountRows.filter((id) => id !== NO_SEMANTIC_ID).length;
  const residentNamedFaces = resident ? Math.max(0, resident.faces - resident.unnamed) : 0;
  const residentHiddenFaces = resident?.hiddenFaces ?? 0;
  const residentHiddenNamedFaces = resident?.hiddenNamedFaces ?? 0;
  const residentHiddenRegions = resident?.hiddenRegions ?? 0;
  const visibilityFiltered = residentHiddenFaces > 0 && residentNamedFaces + residentHiddenNamedFaces === mountNamedFaces;
  const faceRows = [...names.values()].map((row): ModelFocusFaceSemanticRow => {
    const counts = residentCounts.get(row.id);
    const span = counts?.groups;
    return {
      kind: 'face',
      ...row,
      faces: counts?.faces ?? 0,
      instances: counts?.instances ?? 0,
      groupSpan: Array.isArray(span) && span.length === 2
        && Number.isInteger(span[0]) && Number.isInteger(span[1]) && span[1]! > span[0]!
        ? [span[0]!, span[1]!]
        : null,
      presence: counts ? 'resident'
        : visibilityFiltered && residentTable.some((candidate) => candidate.id === row.id) ? 'not-visible'
        : mountTable.some((candidate) => candidate.id === row.id) ? 'mount-only'
          : 'saved-only',
    };
  });
  const edges = new Map<number, MeshEdgeRegion>();
  for (const row of savedEdges) edges.set(row.id, row);
  for (const row of mountEdges) edges.set(row.id, row);
  for (const row of residentEdges) edges.set(row.id, row);
  const edgeRows = [...edges.values()].map((row): ModelFocusEdgeSemanticRow => ({
    kind: 'edge',
    id: row.id,
    name: row.name,
    role: row.role,
    objectId: row.objectId,
    closed: row.closed,
    vertices: row.vertices.length,
    edges: row.vertices.length - 1 + (row.closed ? 1 : 0),
    presence: residentEdges.some((candidate) => candidate.id === row.id) ? 'resident'
      : mountEdges.some((candidate) => candidate.id === row.id) ? 'mount-only'
        : 'saved-only',
  }));
  const rows: ModelFocusSemanticRow[] = [...faceRows, ...edgeRows].sort((a, b) => a.id - b.id);
  const savedRegions = savedTable.length;
  const mountRegions = mountTable.length;
  const residentRegions = resident?.regions.length ?? 0;
  const savedSemanticRows = savedRegions + savedEdges.length;
  const mountSemanticRows = mountRegions + mountEdges.length;
  const residentSemanticRows = residentRegions + residentEdges.length;
  const status = savedSemanticRows > 0 && mountSemanticRows === 0 ? 'mount-mismatch'
    : mountSemanticRows > 0
      ? (visibilityFiltered ? 'visibility-filtered'
        : residentSemanticRows > 0 && residentNamedFaces === mountNamedFaces && residentEdges.length === mountEdges.length ? 'healthy' : 'load-mismatch')
    : residentSemanticRows > 0 ? 'resident-only' : 'none';
  return {
    ...context,
    status,
    savedFaces: savedRows.length,
    savedNamedFaces,
    savedRegions,
    mountFaces: mountRows.length,
    mountNamedFaces,
    mountRegions,
    residentFaces: resident?.faces ?? 0,
    residentNamedFaces,
    residentRegions,
    residentUnnamed: resident?.unnamed ?? 0,
    residentHiddenFaces,
    residentHiddenNamedFaces,
    residentHiddenRegions,
    savedEdgeRegions: savedEdges.length,
    mountEdgeRegions: mountEdges.length,
    residentEdgeRegions: residentEdges.length,
    rows,
  };
}

/** One horizon's line in the SEMANTICS readout. */
export type SemanticHorizonLine = { label: string; value: string };

/** Short horizon names, so a shared row's label still fits the fixed label column. */
const HORIZON_SHORT_NAMES = { saved: 'saved', mount: 'mount', live: 'live' } as const;

/** Collapse the saved/mount/resident horizons into what actually needs saying.
 *
 * The three horizons exist to LOCATE a semantic drop, so a horizon only earns its
 * own row by DISAGREEING with the others. Horizons carrying identical numbers share
 * one row (req_3892 — an all-or-nothing collapse still printed saved and mount twice
 * whenever the resident mesh alone had drifted, which is the common case while
 * naming). All three agreeing reads "in sync"; nothing repeats at any point.
 *
 * The counts are per TRIANGLE (the percept aggregates that way), so they are
 * labelled as such rather than dressed up as faces (req_3888). */
export function semanticHorizonLines(semantics: ModelFocusSemantics): SemanticHorizonLine[] {
  const hidden = semantics.residentHiddenFaces > 0
    ? ` · ${semantics.residentHiddenNamedFaces}/${semantics.residentHiddenFaces} hidden`
    : '';
  const horizons = [
    { name: HORIZON_SHORT_NAMES.saved, value: `${semantics.savedRegions} regions · ${semantics.savedNamedFaces}/${semantics.savedFaces} tris` },
    { name: HORIZON_SHORT_NAMES.mount, value: `${semantics.mountRegions} regions · ${semantics.mountNamedFaces}/${semantics.mountFaces} tris` },
    { name: HORIZON_SHORT_NAMES.live, value: `${semantics.residentRegions} regions · ${semantics.residentNamedFaces}/${semantics.residentFaces} tris${hidden}` },
  ];
  const byValue: { value: string; names: string[] }[] = [];
  for (const horizon of horizons) {
    const existing = byValue.find((group) => group.value === horizon.value);
    if (existing) existing.names.push(horizon.name);
    else byValue.push({ value: horizon.value, names: [horizon.name] });
  }
  return byValue.map((group) => ({
    label: group.names.length === horizons.length ? 'in sync' : group.names.join('+'),
    value: group.value,
  }));
}
