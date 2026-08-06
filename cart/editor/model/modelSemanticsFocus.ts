export const NO_SEMANTIC_ID = 0xffffffff;

export type SavedModelSemantics = {
  regions?: Uint32Array | number[];
  instances?: Uint32Array | number[];
  table?: { version: 1; regions: unknown[]; [key: string]: unknown } | null;
};

export type ResidentModelSemantics = {
  faces: number;
  unnamed: number;
  hiddenFaces?: number;
  hiddenNamedFaces?: number;
  hiddenRegions?: number;
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
  presence: 'resident' | 'not-visible' | 'mount-only' | 'saved-only';
};

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
  const savedNamedFaces = savedRows.filter((id) => id !== NO_SEMANTIC_ID).length;
  const mountNamedFaces = mountRows.filter((id) => id !== NO_SEMANTIC_ID).length;
  const residentNamedFaces = resident ? Math.max(0, resident.faces - resident.unnamed) : 0;
  const residentHiddenFaces = resident?.hiddenFaces ?? 0;
  const residentHiddenNamedFaces = resident?.hiddenNamedFaces ?? 0;
  const residentHiddenRegions = resident?.hiddenRegions ?? 0;
  const visibilityFiltered = residentHiddenFaces > 0 && residentNamedFaces + residentHiddenNamedFaces === mountNamedFaces;
  const rows = [...names.values()].map((row): ModelFocusSemanticRow => {
    const counts = residentCounts.get(row.id);
    return {
      ...row,
      faces: counts?.faces ?? 0,
      instances: counts?.instances ?? 0,
      presence: counts ? 'resident'
        : visibilityFiltered && residentTable.some((candidate) => candidate.id === row.id) ? 'not-visible'
        : mountTable.some((candidate) => candidate.id === row.id) ? 'mount-only'
          : 'saved-only',
    };
  }).sort((a, b) => a.id - b.id);
  const savedRegions = savedTable.length;
  const mountRegions = mountTable.length;
  const residentRegions = resident?.regions.length ?? 0;
  const status = savedRegions > 0 && mountRegions === 0 ? 'mount-mismatch'
    : mountRegions > 0
      ? (visibilityFiltered ? 'visibility-filtered'
        : residentRegions > 0 && residentNamedFaces === mountNamedFaces ? 'healthy' : 'load-mismatch')
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
    residentHiddenFaces,
    residentHiddenNamedFaces,
    residentHiddenRegions,
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
