// data/buildExports.ts — explicit meanings offered by File → Export Build Piece.
//
// Base kinds keep their ordinary snap affinity. Door variants remain wall-kind
// pieces while carrying the meaningful WallEdit the game/compiler consumes.
// They are intentionally not derived from names and never touch tile kinds.
import { KIND_LABEL, KIND_ORDER, type BuildKind, type WallEdit } from '../world/buildCatalog';

export type BuildPieceExportId = BuildKind | 'door-wall' | 'garage-door-wall';

export type BuildPieceExportTarget = {
  id: BuildPieceExportId;
  label: string;
  kind: BuildKind;
  edit?: WallEdit;
};

const BASE_TARGETS: readonly BuildPieceExportTarget[] = KIND_ORDER.map((kind) => ({
  id: kind,
  label: KIND_LABEL[kind],
  kind,
}));

const WALL_EDIT_TARGETS: readonly BuildPieceExportTarget[] = [
  { id: 'door-wall', label: 'Door Wall', kind: 'wall', edit: 'door' },
  { id: 'garage-door-wall', label: 'Garage Door Wall', kind: 'wall', edit: 'garageDoor' },
];

export const BUILD_PIECE_EXPORT_TARGETS: readonly BuildPieceExportTarget[] = BASE_TARGETS.flatMap((target) => (
  target.kind === 'wall' ? [target, ...WALL_EDIT_TARGETS] : [target]
));

const TARGET_BY_ID = new Map(BUILD_PIECE_EXPORT_TARGETS.map((target) => [target.id, target]));

export function buildPieceExportTarget(id: string): BuildPieceExportTarget | null {
  return TARGET_BY_ID.get(id as BuildPieceExportId) ?? null;
}
