// editor/data/buildStarters.ts — File → New Mesh semantic build-piece starters.
//
// A starter is not another primitive vocabulary. It points at one canonical row
// in the existing BUILD_CATALOG, so its dimensions and silhouette come from the
// same semantic piece the world editor places. The model editor then opens that
// geometry as an ordinary editable mesh: shape from the KIND, later variety from
// whatever catalog material/style the author exports it with (V24).
import { KIND_ORDER, KIND_LABEL, type BuildKind, type WallEdit } from '../world/buildCatalog';

/** Stable starter identity. Variants are semantic wall edits, not new build kinds. */
export type BuildPieceStarterId = BuildKind | 'door-wall' | 'garage-door-wall';

export type BuildPieceStarter = {
  id: BuildPieceStarterId;
  kind: BuildKind;
  name: string;
  icon: string;
  /** The canonical catalog row whose existing piece decomposition seeds the mesh. */
  catalogPieceId: string;
  /** Meaningful wall edit carried by this starter (V24); absent for the base kind. */
  edit?: WallEdit;
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

const BASE_STARTERS: readonly BuildPieceStarter[] = KIND_ORDER.map((kind) => ({
  id: kind,
  kind,
  name: STARTER_NAME[kind] ?? `${KIND_LABEL[kind]} Piece`,
  icon: STARTER_ICON[kind],
  catalogPieceId: STARTER_CATALOG_ROW[kind],
}));

// A door is a meaningful WALL edit, not a new piece kind and not the map's door
// tile. These point at the existing edited catalog rows whose decomposition owns
// the opening dimensions. The mesh adapter preserves the frame and leaf as two
// named Outliner parts so the export compiler can identify the movable panel.
const WALL_EDIT_STARTERS: readonly BuildPieceStarter[] = [
  {
    id: 'door-wall',
    kind: 'wall',
    edit: 'door',
    name: 'Door Wall',
    icon: 'DoorOpen',
    catalogPieceId: 'wall.concrete.doorway',
  },
  {
    id: 'garage-door-wall',
    kind: 'wall',
    edit: 'garageDoor',
    name: 'Garage Door Wall',
    icon: 'Warehouse',
    catalogPieceId: 'wall.metal.garageDoor',
  },
];

/** Base kinds plus their meaningful edited variants, in palette-family order. */
export const BUILD_PIECE_STARTERS: readonly BuildPieceStarter[] = BASE_STARTERS.flatMap((starter) => (
  starter.kind === 'wall' ? [starter, ...WALL_EDIT_STARTERS] : [starter]
));

const STARTER_BY_ID = new Map(BUILD_PIECE_STARTERS.map((starter) => [starter.id, starter]));

export function buildPieceStarter(id: BuildPieceStarterId): BuildPieceStarter | null {
  return STARTER_BY_ID.get(id) ?? null;
}
