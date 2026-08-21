// data/buildExports.ts — explicit meanings offered by File → Export → Build Piece.
//
// Base kinds keep their ordinary snap affinity. They are intentionally not
// derived from names and never touch tile kinds.
//
// The old 'Door Wall' / 'Garage Door Wall' targets are GONE (req_4725): they
// duplicated Export → Doors & Windows → Door / Garage Door — the ruled
// opening-kit lane — and two menu homes for the same meaning is how a model
// gets exported into the wrong system. Already-exported door-wall manifests
// keep working; the menu just never mints another.
import { KIND_LABEL, KIND_ORDER, type BuildKind, type WallEdit } from '../world/buildCatalog';

export type BuildPieceExportId = BuildKind;

export type BuildPieceExportTarget = {
  id: BuildPieceExportId;
  label: string;
  kind: BuildKind;
  edit?: WallEdit;
};

export const BUILD_PIECE_EXPORT_TARGETS: readonly BuildPieceExportTarget[] = KIND_ORDER.map((kind) => ({
  id: kind,
  label: KIND_LABEL[kind],
  kind,
}));

const TARGET_BY_ID = new Map(BUILD_PIECE_EXPORT_TARGETS.map((target) => [target.id, target]));

export function buildPieceExportTarget(id: string): BuildPieceExportTarget | null {
  return TARGET_BY_ID.get(id as BuildPieceExportId) ?? null;
}
