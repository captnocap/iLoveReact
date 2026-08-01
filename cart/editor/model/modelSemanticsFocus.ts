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
  presence: 'resident' | 'saved-only';
};

export type ModelFocusSemantics = {
  status: 'healthy' | 'load-mismatch' | 'resident-only' | 'none';
  savedFaces: number;
  savedNamedFaces: number;
  savedRegions: number;
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
export function modelFocusSemantics(saved: SavedModelSemantics, resident: ResidentModelSemantics): ModelFocusSemantics {
  const savedRows = Array.from(saved.regions ?? []);
  const savedTable = regionsFrom(saved.table);
  const residentTable = regionsFrom(resident?.table ?? null);
  const residentCounts = new Map((resident?.regions ?? []).map((row) => [row.id, row]));
  const names = new Map<number, Region>();
  for (const row of savedTable) names.set(row.id, row);
  for (const row of residentTable) names.set(row.id, row);
  const rows = [...names.values()].map((row): ModelFocusSemanticRow => {
    const counts = residentCounts.get(row.id);
    return {
      ...row,
      faces: counts?.faces ?? 0,
      instances: counts?.instances ?? 0,
      presence: counts ? 'resident' : 'saved-only',
    };
  }).sort((a, b) => a.id - b.id);
  const savedNamedFaces = savedRows.filter((id) => id !== NO_SEMANTIC_ID).length;
  const residentNamedFaces = resident ? Math.max(0, resident.faces - resident.unnamed) : 0;
  const savedRegions = savedTable.length;
  const residentRegions = resident?.regions.length ?? 0;
  const status = savedRegions > 0
    ? (residentRegions > 0 && residentNamedFaces === savedNamedFaces ? 'healthy' : 'load-mismatch')
    : residentRegions > 0 ? 'resident-only' : 'none';
  return {
    status,
    savedFaces: savedRows.length,
    savedNamedFaces,
    savedRegions,
    residentFaces: resident?.faces ?? 0,
    residentNamedFaces,
    residentRegions,
    residentUnnamed: resident?.unnamed ?? 0,
    rows,
  };
}
