// Coordination policy between the ordinary model Save transaction and Lore.
//
// Lore captures exact package geometry only after native readback issues a
// one-use receipt. It is a recovery journal, not another phase of the package
// transaction: a Lore outage must never roll back a package whose artifacts and
// manifest already passed their read-back checks. Conversely, a failed or
// background/non-resident Save must never archive an unrelated model.

import type {
  VerifiedNormalSnapshotRequestV1,
  VerifiedSaveReceiptIssueRequestV1,
  VerifiedSaveReceiptV1,
} from '../../../runtime/vcs/loreSaveCoordinator';
import type {
  LoreErrorV1,
  RecoverySnapshotReceiptV1,
} from '../../../runtime/vcs/lore';

export type LoreSnapshotResponse = RecoverySnapshotReceiptV1 | LoreErrorV1;

export type VerifiedSaveReceiptCall = (
  payload: VerifiedSaveReceiptIssueRequestV1,
) => VerifiedSaveReceiptV1 | LoreErrorV1;

export type VerifiedNormalSnapshotCall = (
  payload: VerifiedNormalSnapshotRequestV1,
) => LoreSnapshotResponse;

export type NormalModelLoreSnapshotInput = Readonly<{
  saveSucceeded: boolean;
  modelId: string;
  activeResidentModelId: string | null;
  packageGeometryPath: string;
  packageGeometrySha256: string;
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
  issueReceipt: VerifiedSaveReceiptCall,
  capture: VerifiedNormalSnapshotCall,
): NormalModelLoreSnapshotOutcome {
  if (!input.saveSucceeded || input.activeResidentModelId !== input.modelId) {
    return { attempted: false, archived: false, response: null, statusSuffix: '' };
  }

  let response: LoreSnapshotResponse;
  try {
    if (!/^[0-9a-f]{64}$/.test(input.packageGeometrySha256)) {
      response = {
        ok: false,
        version: 1,
        code: 'hash_mismatch',
        detail: 'verified ordinary Save did not provide an exact lowercase package geometry SHA-256',
      };
    } else {
      const receipt = issueReceipt({
        version: 1,
        modelId: input.modelId,
        packageGeometryPath: input.packageGeometryPath,
        expectedSha256: input.packageGeometrySha256,
      });
      response = receipt.ok ? capture({
        version: 1,
        modelId: input.modelId,
        kind: 'normal',
        saveReceiptToken: receipt.saveReceiptToken,
        push: true,
        label: input.label,
        ...(input.note ? { note: input.note } : {}),
      }) : receipt;
    }
  } catch (error) {
    response = {
      ok: false,
      version: 1,
      code: 'internal_error',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (!response.ok) {
    return {
      attempted: true,
      archived: false,
      response,
      statusSuffix: `; package saved, but recovery snapshot failed (${response.detail})`,
    };
  }

  const revision = response.revisionNumber;
  const pushWarning = response.pushState !== 'pushed'
    ? `; recovery snapshot is ${response.pushState === 'local' ? 'local only' : 'not confirmed remote'}`
    : '';
  const indexWarning = response.indexed ? '' : '; recovery snapshot index is pending repair';
  return {
    attempted: true,
    archived: true,
    response,
    statusSuffix: `; recovery snapshot ${revision}${pushWarning}${indexWarning}`,
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
