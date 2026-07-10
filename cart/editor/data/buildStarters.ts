// editor/data/buildStarters.ts — File → New Mesh semantic build-piece starters.
//
// A starter is not another primitive vocabulary. It points at one canonical row
// in the existing BUILD_CATALOG, so its dimensions and silhouette come from the
// same semantic piece the world editor places. The model editor then opens that
// geometry as an ordinary editable mesh: shape from the KIND, later variety from
// whatever catalog material/style the author exports it with (V24).
import { KIND_ORDER, KIND_LABEL, type BuildKind } from '../world/buildCatalog';

export type BuildPieceStarter = {
  kind: BuildKind;
  name: string;
  icon: string;
  /** The canonical catalog row whose existing piece decomposition seeds the mesh. */
  catalogPieceId: string;
};

// P2 starter choices: explicit and stable. Reordering or growing the world
// catalog must not silently turn "Roof Piece" into a pitched roof, for example.
const STARTER_CATALOG_ROW: Record<BuildKind, string> = {
  wall: 'wall.concrete.common',
  floor: 'floor.concrete.common',
  roof: 'roof.flat.common',
  ramp: 'ramp.concrete.common',
  stairs: 'stairs.concrete.common',
  elevator: 'elevator.metal.common',
  pillar: 'pillar.concrete.common',
  corner: 'corner.concrete.common',
  arch: 'arch.concrete.downtown',
  fence: 'fence.wood.suburb',
  railing: 'railing.metal.motel',
  trim: 'trim.cornice.downtown',
  sign: 'sign.shop.downtown',
};

const STARTER_ICON: Record<BuildKind, string> = {
  wall: 'BrickWall',
  floor: 'Layers',
  roof: 'House',
  ramp: 'MoveUpRight',
  stairs: 'ChartNoAxesColumnIncreasing',
  elevator: 'BetweenHorizontalStart',
  pillar: 'Columns',
  corner: 'PanelsTopLeft',
  arch: 'DoorOpen',
  fence: 'Fence',
  railing: 'GalleryHorizontalEnd',
  trim: 'RectangleHorizontal',
  sign: 'Signpost',
};

const STARTER_NAME: Partial<Record<BuildKind, string>> = {
  stairs: 'Stair Piece',
};

/** One starter for every active semantic build kind, in the build palette order. */
export const BUILD_PIECE_STARTERS: readonly BuildPieceStarter[] = KIND_ORDER.map((kind) => ({
  kind,
  name: STARTER_NAME[kind] ?? `${KIND_LABEL[kind]} Piece`,
  icon: STARTER_ICON[kind],
  catalogPieceId: STARTER_CATALOG_ROW[kind],
}));

const STARTER_BY_KIND = new Map(BUILD_PIECE_STARTERS.map((starter) => [starter.kind, starter]));

export function buildPieceStarter(kind: BuildKind): BuildPieceStarter | null {
  return STARTER_BY_KIND.get(kind) ?? null;
}
