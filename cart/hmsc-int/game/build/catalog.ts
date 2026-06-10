// game/build/catalog — the BuildPieceDef CATALOG: where variety lives (V24:
// "Skin by catalog"). THE TABLE IS THE DATA (P2): a new look/size/feel is a
// new row, never new logic. Every entry validates against its kind's contract
// (validateCatalog) — an entry may not claim a gameplay capability its kind's
// bake promise lacks.
//
// ONE MODEL, TWO VIEWS (V24 addendum 2): these rows are the one semantic
// piece model every authoring mode edits — Creative Build (embodied) and
// Plan Build (Sims topdown/iso) are VIEWS over it. Nothing here may assume a
// camera or interaction mode; `snap` describes the substrate relationship of
// the piece itself, not a mode's controls.
//
// Sizes are meters (R4: 1 tile = 1m). The piece module is the 3m storey
// (HMSC_SCALE.storyHeightMeters) snapped on the 1m substrate. Glass
// durability seeds from render3d/materials.ts (Glass 30 / AutoGlass 20 /
// Storefront 60) so a pane breaks the same everywhere. Prop entries carry a
// `propKind` reference into the prop registry (game/kinds/props) — props are
// PROMPT-GENERATED assets filled by the items/model pipelines, never modeled
// by the builder; the borrow mirrors how props borrow tile bundles.

import { PROP_KINDS, isPropKind, propKindDefinition, type PropKind } from '../kinds';
import {
  BUILD_KIND_CONTRACTS,
  isBuildPieceKind,
  type BuildGameplayTags,
  type BuildPieceKind,
  type BuildSnapMode,
} from './pieces';
import { applyWallEdit, type WallEdit } from './edits';

// The V24 theme vocabulary, verbatim — plus 'common' for the theme-neutral
// structural rows every district uses (surfaced in the capture note).
export type BuildTheme =
  | 'common'
  | 'downtown'
  | 'motel'
  | 'trap_lot'
  | 'suburb'
  | 'industrial';

// The physical material axis (drives look + break feel). Seeded from what the
// corpus already renders: building facade palettes, the materials.ts glass
// family, chainlink/wood fencing. Extend by row.
export type BuildMaterial =
  | 'concrete'
  | 'brick'
  | 'stucco'
  | 'wood'
  | 'metal'
  | 'glass'
  | 'chainlink';

export type BuildPieceSize = {
  widthMeters: number;
  heightMeters: number;
  depthMeters: number;
};

export type BuildPieceDef = {
  id: string;
  kind: BuildPieceKind;
  label: string;
  theme: BuildTheme;
  material: BuildMaterial;
  size: BuildPieceSize;
  snap: BuildSnapMode;
  tags: BuildGameplayTags;
  // kind 'prop' only — the prop registry entry whose asset/bundle this row
  // places. REQUIRED on prop rows, forbidden elsewhere (validateCatalog).
  propKind?: PropKind;
};

// ── shared tag rows (named, not buried) ──────────────────────────────────────

const SOLID_WALL_TAGS: BuildGameplayTags = {
  collision: true,
  blocksSight: true,
  blocksSound: true,
  cover: 'full',
  durability: null, // structural masonry: indestructible until destruction systems rule otherwise
  climbable: false,
  vaultable: false,
  portal: false,
};

const SOLID_PLATE_TAGS: BuildGameplayTags = {
  // floors/roofs: solid mass, but cover/sight are wall concerns.
  collision: true,
  blocksSight: false,
  blocksSound: true,
  cover: 'none',
  durability: null,
  climbable: false,
  vaultable: false,
  portal: false,
};

// The standard piece module: one storey tall, one cell-run wide.
const WALL_SIZE: BuildPieceSize = { widthMeters: 3, heightMeters: 3, depthMeters: 0.25 };
const PLATE_SIZE: BuildPieceSize = { widthMeters: 3, heightMeters: 0.2, depthMeters: 3 };

function propMaterial(kind: PropKind): BuildMaterial {
  switch (kind) {
    case 'bush':
    case 'bushLarge':
    case 'bushLow':
    case 'bushSparse':
    case 'treeOak':
    case 'treePine':
    case 'treeBirch':
    case 'treeCypress':
    case 'treePalm':
    case 'treeDead':
    case 'planter':
    case 'chair':
    case 'couch':
    case 'table':
    case 'bench':
    case 'wallPainting':
      return 'wood';
    case 'rock':
    case 'rockLarge':
    case 'rockSmall':
    case 'boulder':
    case 'rockFlat':
    case 'rockSpire':
    case 'rockMossy':
    case 'rockPile':
    case 'barrier':
      return 'concrete';
    default:
      return 'metal';
  }
}

function propCover(kind: PropKind): BuildGameplayTags['cover'] {
  switch (kind) {
    case 'dumpster':
    case 'rockLarge':
    case 'fence':
    case 'boulder':
    case 'rockSpire':
    case 'barrier':
      return 'high';
    case 'rock':
    case 'rockSmall':
    case 'fireHydrant':
    case 'payphone':
    case 'mailbox':
    case 'rockFlat':
    case 'rockMossy':
    case 'rockPile':
    case 'trashCan':
    case 'bench':
    case 'planter':
    case 'chair':
    case 'couch':
    case 'table':
    case 'treeOak':
    case 'treePine':
    case 'treeBirch':
    case 'treeCypress':
    case 'treePalm':
    case 'treeDead':
      return 'low';
    default:
      return 'none';
  }
}

const PROP_DEPTH_OVERRIDES: Partial<Record<PropKind, number>> = {
  dumpster: 0.86,
  mailbox: 0.44,
  payphone: 0.34,
  streetSign: 0.24,
  streetLight: 0.4,
  stopSign: 0.24,
  trafficLight: 0.46,
  fence: 0.08,
  // segment props span local X; their depth is the thin axis
  barrier: 0.6,
  bench: 0.56,
  couch: 0.9,
  // wall decor sits flush against its wall
  wallPainting: 0.16,
  ledLight: 0.12,
};

function propCatalogEntry(kind: PropKind): BuildPieceDef {
  const def = propKindDefinition(kind);
  const width = def.kind === 'fence' ? def.footprintRadiusMeters * 1.9 : def.footprintRadiusMeters * 2;
  const depth = PROP_DEPTH_OVERRIDES[kind] ?? def.footprintRadiusMeters * 2;
  return {
    id: `prop.${kind}`,
    kind: 'prop',
    label: def.label,
    theme: 'common',
    material: propMaterial(kind),
    size: { widthMeters: width, heightMeters: def.heightMeters, depthMeters: depth },
    snap: 'free',
    propKind: kind,
    tags: {
      collision: def.solid,
      blocksSight: def.tileKind === 'wall' && def.solid && def.heightMeters >= 1.2,
      blocksSound: false,
      cover: propCover(kind),
      durability: null,
      climbable: kind === 'dumpster' || kind === 'rockLarge',
      vaultable: def.solid && def.heightMeters <= 1.5,
      portal: false,
    },
  };
}

const PROP_CATALOG = Object.fromEntries(PROP_KINDS.map((kind) => [`prop.${kind}`, propCatalogEntry(kind)])) as Record<`prop.${PropKind}`, BuildPieceDef>;

export const BUILD_CATALOG: Record<string, BuildPieceDef> = {
  // ── walls (the edit-bearing family) ────────────────────────────────────────
  'wall.concrete.common': {
    id: 'wall.concrete.common',
    kind: 'wall',
    label: 'Concrete Wall',
    theme: 'common',
    material: 'concrete',
    size: WALL_SIZE,
    snap: 'edge',
    tags: SOLID_WALL_TAGS,
  },
  'wall.brick.downtown': {
    id: 'wall.brick.downtown',
    kind: 'wall',
    label: 'Brick Wall',
    theme: 'downtown',
    material: 'brick',
    size: WALL_SIZE,
    snap: 'edge',
    tags: SOLID_WALL_TAGS,
  },
  'wall.stucco.suburb': {
    id: 'wall.stucco.suburb',
    kind: 'wall',
    label: 'Stucco Wall',
    theme: 'suburb',
    material: 'stucco',
    size: WALL_SIZE,
    snap: 'edge',
    tags: { ...SOLID_WALL_TAGS, durability: 240 }, // light residential shell breaks before masonry
  },
  'wall.stucco.motel': {
    id: 'wall.stucco.motel',
    kind: 'wall',
    label: 'Motel Wall',
    theme: 'motel',
    material: 'stucco',
    size: WALL_SIZE,
    snap: 'edge',
    tags: { ...SOLID_WALL_TAGS, durability: 240 },
  },
  'wall.metal.industrial': {
    id: 'wall.metal.industrial',
    kind: 'wall',
    label: 'Sheet-Metal Wall',
    theme: 'industrial',
    material: 'metal',
    size: WALL_SIZE,
    snap: 'edge',
    tags: { ...SOLID_WALL_TAGS, blocksSound: false }, // tin shell: see nothing, hear everything
  },
  'wall.plywood.trap_lot': {
    id: 'wall.plywood.trap_lot',
    kind: 'wall',
    label: 'Plywood Wall',
    theme: 'trap_lot',
    material: 'wood',
    size: WALL_SIZE,
    snap: 'edge',
    tags: { ...SOLID_WALL_TAGS, blocksSound: false, durability: 120 },
  },
  'wall.storefront.downtown': {
    id: 'wall.storefront.downtown',
    kind: 'wall',
    label: 'Storefront Glass',
    theme: 'downtown',
    material: 'glass',
    size: WALL_SIZE,
    snap: 'edge',
    // The showroom sheet (materials.ts Storefront, health 60): full collision,
    // wide open sightline, no meaningful cover behind glass.
    tags: {
      collision: true,
      blocksSight: false,
      blocksSound: true,
      cover: 'none',
      durability: 60,
      climbable: false,
      vaultable: false,
      portal: false,
    },
  },

  // ── floors / roofs ─────────────────────────────────────────────────────────
  'floor.concrete.common': {
    id: 'floor.concrete.common',
    kind: 'floor',
    label: 'Concrete Floor',
    theme: 'common',
    material: 'concrete',
    size: PLATE_SIZE,
    snap: 'grid',
    tags: SOLID_PLATE_TAGS,
  },
  'floor.wood.suburb': {
    id: 'floor.wood.suburb',
    kind: 'floor',
    label: 'Wood Floor',
    theme: 'suburb',
    material: 'wood',
    size: PLATE_SIZE,
    snap: 'grid',
    tags: { ...SOLID_PLATE_TAGS, durability: 180 },
  },
  'roof.flat.common': {
    id: 'roof.flat.common',
    kind: 'roof',
    label: 'Flat Roof',
    theme: 'common',
    material: 'concrete',
    size: PLATE_SIZE,
    snap: 'grid',
    // Roof lips read as low cover for anyone up there.
    tags: { ...SOLID_PLATE_TAGS, cover: 'low' },
  },
  'roof.shingle.suburb': {
    id: 'roof.shingle.suburb',
    kind: 'roof',
    label: 'Shingle Roof',
    theme: 'suburb',
    material: 'wood',
    size: { widthMeters: 3, heightMeters: 1.2, depthMeters: 3 }, // pitched
    snap: 'grid',
    tags: { ...SOLID_PLATE_TAGS, cover: 'low', durability: 180, climbable: true },
  },

  // ── vertical links ─────────────────────────────────────────────────────────
  'ramp.concrete.common': {
    id: 'ramp.concrete.common',
    kind: 'ramp',
    label: 'Concrete Ramp',
    theme: 'common',
    material: 'concrete',
    size: { widthMeters: 3, heightMeters: 3, depthMeters: 3 },
    snap: 'grid',
    // The Fortnite ramp truth: a placed slope IS hard cover from the far side.
    // blocksSound stays false — a freestanding slope occludes nothing the
    // ramp contract promises (rooms it never bounds).
    tags: { ...SOLID_PLATE_TAGS, cover: 'high', blocksSight: true, blocksSound: false },
  },
  'stairs.wood.common': {
    id: 'stairs.wood.common',
    kind: 'stairs',
    label: 'Wood Stairs',
    theme: 'common',
    material: 'wood',
    size: { widthMeters: 1.2, heightMeters: 3, depthMeters: 3 },
    snap: 'grid',
    tags: { ...SOLID_PLATE_TAGS, cover: 'low', durability: 150, blocksSound: false },
  },

  // ── columns / corners / arches ─────────────────────────────────────────────
  'pillar.concrete.common': {
    id: 'pillar.concrete.common',
    kind: 'pillar',
    label: 'Concrete Pillar',
    theme: 'common',
    material: 'concrete',
    // The parking-garage column: a body hides behind it.
    size: { widthMeters: 0.6, heightMeters: 3, depthMeters: 0.6 },
    snap: 'grid',
    tags: { ...SOLID_WALL_TAGS, cover: 'full', blocksSound: false },
  },
  'corner.concrete.common': {
    id: 'corner.concrete.common',
    kind: 'corner',
    label: 'Concrete Corner',
    theme: 'common',
    material: 'concrete',
    size: { widthMeters: 3, heightMeters: 3, depthMeters: 3 },
    snap: 'edge',
    tags: SOLID_WALL_TAGS,
  },
  'arch.concrete.downtown': {
    id: 'arch.concrete.downtown',
    kind: 'arch',
    label: 'Concrete Arch',
    theme: 'downtown',
    material: 'concrete',
    size: WALL_SIZE,
    snap: 'edge',
    // Open by nature: the frame is solid wall; the opening is a walk portal.
    tags: { ...SOLID_WALL_TAGS, blocksSight: false, blocksSound: false, portal: true },
  },

  // ── boundary lines ─────────────────────────────────────────────────────────
  'fence.chainlink.trap_lot': {
    id: 'fence.chainlink.trap_lot',
    kind: 'fence',
    label: 'Chainlink Fence',
    theme: 'trap_lot',
    material: 'chainlink',
    size: { widthMeters: 3, heightMeters: 2, depthMeters: 0.05 },
    snap: 'edge',
    // See through it, climb over it — blocks the path, never the sightline.
    tags: {
      collision: true,
      blocksSight: false,
      blocksSound: false,
      cover: 'none',
      durability: 80,
      climbable: true,
      vaultable: false,
      portal: false,
    },
  },
  'fence.wood.suburb': {
    id: 'fence.wood.suburb',
    kind: 'fence',
    label: 'Wood Fence',
    theme: 'suburb',
    material: 'wood',
    size: { widthMeters: 3, heightMeters: 1.8, depthMeters: 0.08 },
    snap: 'edge',
    tags: {
      collision: true,
      blocksSight: true,
      blocksSound: false,
      cover: 'high',
      durability: 90,
      climbable: true,
      vaultable: false,
      portal: false,
    },
  },
  'railing.metal.motel': {
    id: 'railing.metal.motel',
    kind: 'railing',
    label: 'Walkway Railing',
    theme: 'motel',
    material: 'metal',
    size: { widthMeters: 3, heightMeters: 1, depthMeters: 0.08 },
    snap: 'edge',
    // The motel-balcony rail: waist-high, made to be vaulted.
    tags: {
      collision: true,
      blocksSight: false,
      blocksSound: false,
      cover: 'low',
      durability: 110,
      climbable: false,
      vaultable: true,
      portal: false,
    },
  },

  // ── signal-only pieces ─────────────────────────────────────────────────────
  'trim.cornice.downtown': {
    id: 'trim.cornice.downtown',
    kind: 'trim',
    label: 'Cornice Trim',
    theme: 'downtown',
    material: 'concrete',
    size: { widthMeters: 3, heightMeters: 0.3, depthMeters: 0.3 },
    snap: 'surface',
    tags: {
      collision: false,
      blocksSight: false,
      blocksSound: false,
      cover: 'none',
      durability: null,
      climbable: false,
      vaultable: false,
      portal: false,
    },
  },
  'sign.shop.downtown': {
    id: 'sign.shop.downtown',
    kind: 'sign',
    label: 'Shop Sign',
    theme: 'downtown',
    material: 'metal',
    size: { widthMeters: 2.4, heightMeters: 0.8, depthMeters: 0.2 },
    snap: 'surface',
    tags: {
      collision: false, // face-mounted: nothing to bump
      blocksSight: false,
      blocksSound: false,
      cover: 'none',
      durability: 40,
      climbable: false,
      vaultable: false,
      portal: false,
    },
  },
  'sign.pole.common': {
    id: 'sign.pole.common',
    kind: 'sign',
    label: 'Pole Sign',
    theme: 'common',
    material: 'metal',
    // The streetSign prop's read: panel clears head height (R4 stylized-tall).
    size: { widthMeters: 0.24, heightMeters: 3.3, depthMeters: 0.24 },
    snap: 'free',
    tags: {
      collision: true,
      blocksSight: false,
      blocksSound: false,
      cover: 'none',
      durability: 70,
      climbable: false,
      vaultable: false,
      portal: false,
    },
  },

  // ── props (assets from the prop/items pipelines — prompt-generated) ───────
  // Generated from the prop registry so the build palette cannot silently omit
  // signs/lights/mailboxes/etc. The row still carries semantic `propKind`; the
  // renderer and bake delegate to the prop model instead of treating it as a box.
  ...PROP_CATALOG,
};

export const BUILD_CATALOG_IDS = Object.keys(BUILD_CATALOG);

export function isCatalogId(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILD_CATALOG, value);
}

export function catalogEntry(id: string): BuildPieceDef {
  const entry = BUILD_CATALOG[id];
  if (!entry) throw new Error(`build catalog: unknown piece id '${id}'`);
  return entry;
}

/** A placed piece's EFFECTIVE tags: the catalog row's tags with the edit's
 *  deltas applied (the one composition the bake and every authoring view
 *  read — authored meaning and baked meaning cannot drift). */
export function effectiveTags(entry: BuildPieceDef, edit?: WallEdit): BuildGameplayTags {
  if (edit === undefined) return entry.tags;
  if (BUILD_KIND_CONTRACTS[entry.kind].edits !== 'wall') {
    throw new Error(`build catalog: kind '${entry.kind}' (piece '${entry.id}') accepts no edits`);
  }
  return applyWallEdit(entry.tags, edit);
}

export function catalogEntriesByKind(kind: BuildPieceKind): BuildPieceDef[] {
  return BUILD_CATALOG_IDS.map((id) => BUILD_CATALOG[id]).filter((entry) => entry.kind === kind);
}

export function catalogEntriesByTheme(theme: BuildTheme): BuildPieceDef[] {
  return BUILD_CATALOG_IDS.map((id) => BUILD_CATALOG[id]).filter(
    (entry) => entry.theme === theme || entry.theme === 'common',
  );
}

// ── contract validation (the boundary, P3) ──────────────────────────────────

/** Every way one catalog entry can violate its kind's contract. Empty = valid. */
export function validateCatalogEntry(entry: BuildPieceDef): string[] {
  const problems: string[] = [];
  if (!isBuildPieceKind(entry.kind)) {
    return [`${entry.id}: unknown kind '${entry.kind}'`];
  }
  const contract = BUILD_KIND_CONTRACTS[entry.kind];
  const promise = contract.promise;
  const tags = entry.tags;

  if (tags.collision && !promise.collisionBoxes)
    problems.push(`${entry.id}: tags.collision but kind '${entry.kind}' promises no collision boxes`);
  if (tags.cover !== 'none' && !promise.coverFaces)
    problems.push(`${entry.id}: tags.cover '${tags.cover}' but kind '${entry.kind}' promises no cover faces`);
  if (tags.blocksSound && !promise.soundOcclusion)
    problems.push(`${entry.id}: tags.blocksSound but kind '${entry.kind}' promises no sound occlusion`);
  if (tags.portal && !promise.navPortal)
    problems.push(`${entry.id}: tags.portal but kind '${entry.kind}' promises no nav portal`);
  if (tags.durability !== null && !promise.destructibleSections)
    problems.push(`${entry.id}: finite durability but kind '${entry.kind}' promises no destructible sections`);

  if (entry.kind === 'prop') {
    if (entry.propKind === undefined)
      problems.push(`${entry.id}: prop entries must reference a propKind (assets come from the prop/items pipelines)`);
    else if (!isPropKind(entry.propKind))
      problems.push(`${entry.id}: unknown propKind '${entry.propKind}'`);
  } else if (entry.propKind !== undefined) {
    problems.push(`${entry.id}: propKind is only meaningful on kind 'prop'`);
  }

  const { widthMeters, heightMeters, depthMeters } = entry.size;
  if (!(widthMeters > 0) || !(heightMeters > 0) || !(depthMeters > 0))
    problems.push(`${entry.id}: size dimensions must be positive meters`);

  return problems;
}

/** Validate the whole table (or any P2-authored extension of it). */
export function validateCatalog(catalog: Record<string, BuildPieceDef> = BUILD_CATALOG): string[] {
  const problems: string[] = [];
  for (const id of Object.keys(catalog)) {
    const entry = catalog[id];
    if (entry.id !== id) problems.push(`${id}: entry.id '${entry.id}' does not match its table key`);
    problems.push(...validateCatalogEntry(entry));
  }
  return problems;
}

export function catalogIdsForConsole(): string {
  return BUILD_CATALOG_IDS.join(', ');
}
