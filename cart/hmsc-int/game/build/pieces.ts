// game/build/pieces — the BuildPieceKind taxonomy + per-kind gameplay contract
// (V24: "Author by semantic piece. Bake by gameplay contract. Skin by catalog.")
//
// Game meaning lives HERE, on the kind — "a wall is always a wall. a floor is
// always a floor." Variety (theme, material, size, snap, tag values) lives in
// the CATALOG (./catalog.ts); meaningful cutouts live in the edit vocabulary
// (./edits.ts). The 1m grid (R4) is the SNAP SUBSTRATE pieces align to — it is
// never the authored object model.
//
// The kind contract DECLARES what a piece of this kind promises the bake
// (render geometry, collision boxes, cover faces, sound occlusion, room
// volumes, nav portals/blockers, destructible sections — V24's bake contract).
// The bake itself is NOT implemented here: it lands with the compile/world
// integration. This table is the shape the bake will consume — "the authored
// object already knows what it means."

import type { TileCoverHeight } from '../kinds';

// The Fortnite-semantics structural primitives (V24 ruling #1). ramp/stairs
// and pillar/corner are SEPARATE kinds because their game meanings differ
// (a ramp carries vehicles, stairs are body-only; a corner is two meeting
// wall faces with lean-around, a pillar is a freestanding column) — see the
// capture note if the user meant single kinds with catalog variants.
export type BuildPieceKind =
  | 'wall'
  | 'floor'
  | 'ramp'
  | 'stairs'
  | 'roof'
  | 'pillar'
  | 'corner'
  | 'arch'
  | 'fence'
  | 'railing'
  | 'trim'
  | 'sign'
  | 'prop';

// How a piece snaps when placed (V24 catalog axis, verbatim vocabulary).
// 'grid' = the 1m substrate cells; 'edge' = cell edges (walls/fences);
// 'surface' = onto an existing piece face (trim/signs); 'free' = unsnapped.
export type BuildSnapMode = 'grid' | 'edge' | 'surface' | 'free';

// The gameplay tags a catalog entry carries (V24 ruling #2, verbatim list).
// `cover` reuses the kinds registry's cover vocabulary so cover values CARRY
// straight into the chance engine's cover-fraction input (V9) — one
// vocabulary, never a parallel scale.
export type BuildGameplayTags = {
  collision: boolean;
  blocksSight: boolean;
  blocksSound: boolean;
  cover: TileCoverHeight;
  // Hit points of the destructible section; null = indestructible. The glass
  // family seeds from render3d/materials.ts health values (Glass 30,
  // AutoGlass 20, Storefront 60) so a pane breaks the same everywhere.
  durability: number | null;
  climbable: boolean;
  vaultable: boolean;
  // The piece (or its edit) connects rooms — a doorway knows it connects
  // rooms; the bake turns this into a nav portal + room-volume seam.
  portal: boolean;
};

// What a placed piece of this kind PROMISES the bake — which of the V24 bake
// outputs it can emit. A capability the promise lacks may never be claimed by
// a catalog entry's tags (validateCatalog enforces the contract). DECLARATION
// ONLY: emission is the compile/world integration's job.
export type BakePromise = {
  renderGeometry: boolean; // every kind renders; kept explicit so the contract is total
  collisionBoxes: boolean;
  coverFaces: boolean;
  soundOcclusion: boolean;
  roomBoundary: boolean; // participates in room-volume extraction
  navPortal: boolean; // can open a walk/vehicle portal (doorway, arch, garage door)
  navBlocker: boolean; // can block the path graph
  verticalLink: boolean; // connects floors (a ramp knows it connects floors)
  destructibleSections: boolean;
};

// Which edit vocabulary a kind accepts. Today only the wall family has one
// (WallEdit, ./edits.ts); kinds marked 'none' reject edits at validation.
export type BuildEditFamily = 'wall' | 'none';

export type BuildKindContract = {
  kind: BuildPieceKind;
  label: string;
  // The game meaning, one line — the part that never varies by catalog entry.
  meaning: string;
  edits: BuildEditFamily;
  snapDefault: BuildSnapMode;
  promise: BakePromise;
};

// Shared promise rows (named, not buried — the same convention as the kinds
// tables' shared bundles).
const PROMISE_SOLID_SHELL: BakePromise = {
  // wall/corner: the room-bounding solid family — full bake participation.
  renderGeometry: true,
  collisionBoxes: true,
  coverFaces: true,
  soundOcclusion: true,
  roomBoundary: true,
  navPortal: true,
  navBlocker: true,
  verticalLink: false,
  destructibleSections: true,
};

const PROMISE_DECOR_ONLY: BakePromise = {
  // trim: readable architectural signal, zero gameplay mass.
  renderGeometry: true,
  collisionBoxes: false,
  coverFaces: false,
  soundOcclusion: false,
  roomBoundary: false,
  navPortal: false,
  navBlocker: false,
  verticalLink: false,
  destructibleSections: false,
};

export const BUILD_KIND_CONTRACTS: Record<BuildPieceKind, BuildKindContract> = {
  wall: {
    kind: 'wall',
    label: 'Wall',
    meaning: 'A wall is always a wall: a vertical room-bounding plane; cutouts give it doors, windows, arches.',
    edits: 'wall',
    snapDefault: 'edge',
    promise: PROMISE_SOLID_SHELL,
  },
  floor: {
    kind: 'floor',
    label: 'Floor',
    meaning: 'A floor is always a floor: a walkable horizontal plate that bounds rooms vertically.',
    edits: 'none',
    snapDefault: 'grid',
    promise: {
      renderGeometry: true,
      collisionBoxes: true,
      coverFaces: false,
      soundOcclusion: true,
      roomBoundary: true,
      navPortal: false,
      navBlocker: false,
      verticalLink: false,
      destructibleSections: true,
    },
  },
  ramp: {
    kind: 'ramp',
    label: 'Ramp',
    meaning: 'A ramp knows it connects floors: a traversable slope, bodies AND vehicles.',
    edits: 'none',
    snapDefault: 'grid',
    promise: {
      renderGeometry: true,
      collisionBoxes: true,
      coverFaces: true,
      soundOcclusion: false,
      roomBoundary: false,
      navPortal: false,
      navBlocker: false,
      verticalLink: true,
      destructibleSections: true,
    },
  },
  stairs: {
    kind: 'stairs',
    label: 'Stairs',
    meaning: 'Stairs connect floors for bodies only — steps, never a vehicle surface.',
    edits: 'none',
    snapDefault: 'grid',
    promise: {
      renderGeometry: true,
      collisionBoxes: true,
      coverFaces: true,
      soundOcclusion: false,
      roomBoundary: false,
      navPortal: false,
      navBlocker: false,
      verticalLink: true,
      destructibleSections: true,
    },
  },
  roof: {
    kind: 'roof',
    label: 'Roof',
    meaning: 'A roof caps a room volume: the top boundary, walkable from above.',
    edits: 'none',
    snapDefault: 'grid',
    promise: {
      renderGeometry: true,
      collisionBoxes: true,
      coverFaces: true,
      soundOcclusion: true,
      roomBoundary: true,
      navPortal: false,
      navBlocker: false,
      verticalLink: false,
      destructibleSections: true,
    },
  },
  pillar: {
    kind: 'pillar',
    label: 'Pillar',
    meaning: 'A freestanding vertical column: point cover, blocks a cell, bounds nothing.',
    edits: 'none',
    snapDefault: 'grid',
    promise: {
      renderGeometry: true,
      collisionBoxes: true,
      coverFaces: true,
      soundOcclusion: false,
      roomBoundary: false,
      navPortal: false,
      navBlocker: true,
      verticalLink: false,
      destructibleSections: true,
    },
  },
  corner: {
    kind: 'corner',
    label: 'Corner',
    meaning: 'Two wall faces meeting: corner cover with lean-around; bounds rooms like a wall but takes no cutouts.',
    edits: 'none',
    snapDefault: 'edge',
    promise: {
      ...PROMISE_SOLID_SHELL,
      navPortal: false, // no cutouts → never a portal
    },
  },
  arch: {
    kind: 'arch',
    label: 'Arch',
    meaning: 'A wall that is already open: a freestanding portal frame — connects spaces by nature.',
    edits: 'none',
    snapDefault: 'edge',
    promise: {
      renderGeometry: true,
      collisionBoxes: true, // the frame is solid; the opening is the portal
      coverFaces: true,
      soundOcclusion: false,
      roomBoundary: true,
      navPortal: true,
      navBlocker: false,
      verticalLink: false,
      destructibleSections: true,
    },
  },
  fence: {
    kind: 'fence',
    label: 'Fence',
    meaning: 'A boundary line, not a room: blocks bodies along an edge; sight depends on the material.',
    edits: 'none',
    snapDefault: 'edge',
    promise: {
      renderGeometry: true,
      collisionBoxes: true,
      coverFaces: true,
      soundOcclusion: false,
      roomBoundary: false,
      navPortal: false,
      navBlocker: true,
      verticalLink: false,
      destructibleSections: true,
    },
  },
  railing: {
    kind: 'railing',
    label: 'Railing',
    meaning: 'A waist-high edge guard: low cover, made to be vaulted.',
    edits: 'none',
    snapDefault: 'edge',
    promise: {
      renderGeometry: true,
      collisionBoxes: true,
      coverFaces: true,
      soundOcclusion: false,
      roomBoundary: false,
      navPortal: false,
      navBlocker: true,
      verticalLink: false,
      destructibleSections: true,
    },
  },
  trim: {
    kind: 'trim',
    label: 'Trim',
    meaning: 'Pure architectural signal — cornice, baseboard, banding. The bake renders it and nothing else.',
    edits: 'none',
    snapDefault: 'surface',
    promise: PROMISE_DECOR_ONLY,
  },
  sign: {
    kind: 'sign',
    label: 'Sign',
    meaning: 'Readable signage on a pole or face: a navigation/flavor landmark; may block a cell, never a sightline system.',
    edits: 'none',
    snapDefault: 'surface',
    promise: {
      renderGeometry: true,
      collisionBoxes: true,
      coverFaces: false,
      soundOcclusion: false,
      roomBoundary: false,
      navPortal: false,
      navBlocker: true,
      verticalLink: false,
      destructibleSections: true,
    },
  },
  prop: {
    kind: 'prop',
    label: 'Prop',
    meaning: 'A dropped object (tree, hydrant, dumpster…): the builder PLACES it; the asset comes from the prop/items pipelines (prompt-generated), never from the builder.',
    edits: 'none',
    snapDefault: 'free',
    promise: {
      renderGeometry: true,
      collisionBoxes: true,
      coverFaces: true,
      soundOcclusion: false,
      roomBoundary: false,
      navPortal: false,
      navBlocker: true,
      verticalLink: false,
      destructibleSections: true,
    },
  },
};

export const BUILD_PIECE_KINDS = Object.keys(BUILD_KIND_CONTRACTS) as BuildPieceKind[];

export function isBuildPieceKind(value: string): value is BuildPieceKind {
  return Object.prototype.hasOwnProperty.call(BUILD_KIND_CONTRACTS, value);
}

export function buildKindContract(kind: BuildPieceKind): BuildKindContract {
  return BUILD_KIND_CONTRACTS[kind];
}

export function buildKindNamesForConsole(): string {
  return BUILD_PIECE_KINDS.join(', ');
}
