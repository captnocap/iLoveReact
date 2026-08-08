// Coordination policy between the ordinary model Save transaction and Lore.
//
// Lore captures the resident native document through its own host door. It is a
// recovery journal, not another phase of the package transaction: a Lore outage
// must never roll back a package whose artifacts and manifest already passed
// their read-back checks. Conversely, a failed or background/non-resident Save
// must never archive whichever unrelated document happens to own Scene3D.

export type LoreSnapshotResponse = Readonly<{
  ok: boolean;
  error?: string;
  revision?: string;
  revisionNumber?: number;
  pushed?: boolean;
  pushError?: string;
}>;

export type LoreSnapshotCall = (
  payload: Readonly<Record<string, unknown>>,
) => LoreSnapshotResponse;

export type NormalModelLoreSnapshotInput = Readonly<{
  saveSucceeded: boolean;
  modelId: string;
  activeResidentModelId: string | null;
  packageGeometryPath: string;
  objectRows: readonly Readonly<{ id: string; lo?: number }>[];
  label: string;
  note?: string;
}>;

export type NormalModelLoreSnapshotOutcome = Readonly<{
  attempted: boolean;
  archived: boolean;
  response: LoreSnapshotResponse | null;
  statusSuffix: string;
}>;

/** Match the native range mirror's rank order. Native still validates that the
 * count is coherent before stamping these stable IDs into its v5 snapshot. */
export function loreSnapshotObjectIds(
  rows: readonly Readonly<{ id: string; lo?: number }>[],
): string[] | null {
  if (rows.some((row) => !Number.isInteger(row.lo) || row.lo! < 0)) return null;
  return rows
    .slice()
    .sort((left, right) => left.lo! - right.lo!)
    .map((row) => row.id);
}

/** Capture a successful active Save without making Lore part of the package's
 * commit/rollback protocol. This function intentionally catches the host door:
 * recovery unavailability is reported, never re-thrown into Save. */
export function snapshotNormalModelSave(
  input: NormalModelLoreSnapshotInput,
  capture: LoreSnapshotCall,
): NormalModelLoreSnapshotOutcome {
  if (!input.saveSucceeded || input.activeResidentModelId !== input.modelId) {
    return { attempted: false, archived: false, response: null, statusSuffix: '' };
  }

  let response: LoreSnapshotResponse;
  try {
    const objectIds = loreSnapshotObjectIds(input.objectRows);
    response = capture({
      modelId: input.modelId,
      packageGeometryPath: input.packageGeometryPath,
      ...(objectIds ? { objectIds } : {}),
      kind: 'normal',
      push: true,
      label: input.label,
      ...(input.note ? { note: input.note } : {}),
    });
  } catch (error) {
    response = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!response.ok) {
    return {
      attempted: true,
      archived: false,
      response,
      statusSuffix: `; package saved, but recovery snapshot failed (${response.error ?? 'unknown Lore error'})`,
    };
  }

  const revision = response.revisionNumber ?? response.revision;
  const pushWarning = response.pushed === false
    ? `; recovery snapshot is local only${response.pushError ? ` (${response.pushError})` : ''}`
    : '';
  return {
    attempted: true,
    archived: true,
    response,
    statusSuffix: `; recovery snapshot${revision !== undefined ? ` ${revision}` : ''}${pushWarning}`,
  };
}

/** The package path that an explicit restore would replace after native RJMD
 * validation. Characters use their manifest-declared immutable artifact; props
 * use the ordinary document location. */
export function modelPackageGeometryPath(
  packageDir: string,
  skeleton: Readonly<{
    meshes?: Readonly<{ kind?: string; geometryPath?: string }>;
  }> | undefined,
): string {
  const declared = skeleton?.meshes?.kind === 'skinned'
    ? skeleton.meshes.geometryPath?.trim()
    : '';
  return declared ? `${packageDir}/${declared}` : `${packageDir}/mesh/doc.blob`;
}
