export const NO_SEMANTIC_ID = 0xffffffff;

export type SavedModelSemantics = {
  regions?: Uint32Array | number[];
  instances?: Uint32Array | number[];
  table?: { version: 1; regions: unknown[]; [key: string]: unknown } | null;
};

export type ResidentModelSemantics = {
  faces: number;
  unnamed: number;
  regions: { id: number; faces: number; instances: number }[];
  table: { version: 1; regions: unknown[]; [key: string]: unknown };
} | null;

export type ModelFocusSemanticRow = {
  id: number;
  name: string;
  role: string;
  parent: number | null;
  faces: number;
  instances: number;
  presence: 'resident' | 'mount-only' | 'saved-only';
};

export type ModelFocusSemantics = {
  status: 'healthy' | 'mount-mismatch' | 'load-mismatch' | 'resident-only' | 'none';
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
  rows: ModelFocusSemanticRow[];
};

type Region = { id: number; name: string; role: string; parent: number | null };

function regionsFrom(value: unknown): Region[] {
  const table = value as { version?: unknown; regions?: unknown } | null;
  if (!table || table.version !== 1 || !Array.isArray(table.regions)) return [];
  return table.regions.flatMap((value: unknown) => {
    const row = value as { id?: unknown; name?: unknown; role?: unknown; parent?: unknown } | null;
    if (!row || !Number.isInteger(row.id) || typeof row.name !== 'string' || row.name.length === 0) return [];
    return [{
      id: row.id as number,
      name: row.name,
      role: typeof row.role === 'string' ? row.role : '',
      parent: Number.isInteger(row.parent) ? row.parent as number : null,
    }];
  });
}

/** Compare durable RJMD semantics to the resident native mesh without inferring either. */
export function modelFocusSemantics(
  saved: SavedModelSemantics,
  resident: ResidentModelSemantics,
  mount: SavedModelSemantics = saved,
  context: Pick<ModelFocusSemantics, 'documentId' | 'packageDir' | 'mountSource'> = {},
): ModelFocusSemantics {
  const savedRows = Array.from(saved.regions ?? []);
  const savedTable = regionsFrom(saved.table);
  const mountRows = Array.from(mount.regions ?? []);
  const mountTable = regionsFrom(mount.table);
  const residentTable = regionsFrom(resident?.table ?? null);
  const residentCounts = new Map((resident?.regions ?? []).map((row) => [row.id, row]));
  const names = new Map<number, Region>();
  for (const row of savedTable) names.set(row.id, row);
  for (const row of mountTable) names.set(row.id, row);
  for (const row of residentTable) names.set(row.id, row);
  const rows = [...names.values()].map((row): ModelFocusSemanticRow => {
    const counts = residentCounts.get(row.id);
    return {
      ...row,
      faces: counts?.faces ?? 0,
      instances: counts?.instances ?? 0,
      presence: counts ? 'resident'
        : mountTable.some((candidate) => candidate.id === row.id) ? 'mount-only'
          : 'saved-only',
    };
  }).sort((a, b) => a.id - b.id);
  const savedNamedFaces = savedRows.filter((id) => id !== NO_SEMANTIC_ID).length;
  const mountNamedFaces = mountRows.filter((id) => id !== NO_SEMANTIC_ID).length;
  const residentNamedFaces = resident ? Math.max(0, resident.faces - resident.unnamed) : 0;
  const savedRegions = savedTable.length;
  const mountRegions = mountTable.length;
  const residentRegions = resident?.regions.length ?? 0;
  const status = savedRegions > 0 && mountRegions === 0 ? 'mount-mismatch'
    : mountRegions > 0
      ? (residentRegions > 0 && residentNamedFaces === mountNamedFaces ? 'healthy' : 'load-mismatch')
    : residentRegions > 0 ? 'resident-only' : 'none';
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
    rows,
  };
}
