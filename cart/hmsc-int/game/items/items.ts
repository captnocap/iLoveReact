// game/items/items.ts — the ITEMS registry (V11), captured as DATA.
//
// cart/game_item_gallery/index.tsx is the behavior reference (read, never
// moved/edited/imported — V15-TRANSITION). Its 19 item model functions were
// JSX emitters over a Part() wrapper; at identity ctx (origin 0, yaw 0,
// scale 1) every Part reduces to literal {geometry, params, material,
// textureKey?, position, rotation, scale} props — so the models are
// REWRITTEN here as part TABLES (P2: the registry IS the data; a renderer or
// the bake maps parts → Scene3D.Mesh rows; nothing here imports React).
//
// V11: the item IDEAS are on point; the SCALE is trash ("the boat is smaller
// than the player model's hand"). The authored numbers are carried VERBATIM —
// every item is `scaleStatus: 'unaudited'` until the mandatory scale audit
// (the editors/items workbench) reworks it against the 1-tile=1m contract
// (R4). approxItemBoundsMeters() below is the audit's starting data.

import * as EngineGeometry from '@reactjit/geometries';
import {
  ITEM_CUSTOM_GEOMETRIES,
  ITEM_GEOMETRY_DEFAULTS,
  type BladeParams,
  type BoatHullParams,
  type SailParams,
  type SurfboardParams,
  type V3,
} from './geometries';

const PI = Math.PI;

// ── geometry name table (the registry's whole geometry vocabulary) ──

export const ITEM_GEOMETRIES = {
  box: EngineGeometry.Box,
  cylinder: EngineGeometry.Cylinder,
  cone: EngineGeometry.Cone,
  sphere: EngineGeometry.Sphere,
  torus: EngineGeometry.Torus,
  // ITEMSCULPT-0606: the sculpted-item surface — /items bakes a voxel
  // blockout into a Globe displacement field and saves ONE 'globe' part
  globe: EngineGeometry.Globe,
  blade: ITEM_CUSTOM_GEOMETRIES.blade,
  sail: ITEM_CUSTOM_GEOMETRIES.sail,
  boatHull: ITEM_CUSTOM_GEOMETRIES.boatHull,
  surfboard: ITEM_CUSTOM_GEOMETRIES.surfboard,
} as const;

export type ItemGeometryName = keyof typeof ITEM_GEOMETRIES;

// Shared param bundles, verbatim from the reference.
const box1 = { width: 1, height: 1, depth: 1 };
const cyl12 = { radius: 0.5, height: 1, segments: 12 };
const cyl18 = { radius: 0.5, height: 1, segments: 18 };
const cone12 = { radius: 0.5, height: 1, segments: 12 };
const sphere12 = { radius: 0.5, segments: 16, rings: 10 };

// ── texture keys (fresh canonical namespace; see CAPTURE.md — the texture
// CONTENT stays gallery-side until the materials/texture capture) ──

export const ITEM_TEXTURE_KEYS = {
  cash: 'game-items/cash',
  football: 'game-items/football',
  basketball: 'game-items/basketball',
  pillLabel: 'game-items/pillbottle/label',
  beerLabel: 'game-items/beer/label',
  liquorLabel: 'game-items/liquor/label',
  medkit: 'game-items/medkit',
  tvScreen: 'game-items/tv/screen',
  cigFront: 'game-items/cigarettes/front',
  cigSide: 'game-items/cigarettes/side',
  cigTop: 'game-items/cigarettes/top',
  cigBack: 'game-items/cigarettes/back',
  cigBottom: 'game-items/cigarettes/bottom',
} as const;

// ── the registry types ──

export type ItemPart = {
  geometry: ItemGeometryName;
  params: Record<string, unknown>;
  /** flat color (#rrggbb); textured parts use #ffffff under their texture */
  material: string;
  textureKey?: string;
  /** item-local meters */
  position: V3;
  /** radians, [x, y, z] euler — omitted = [0,0,0] */
  rotation?: V3;
  /** per-axis or uniform — omitted = 1 */
  scale?: V3 | number;
};

export type ItemScaleStatus = 'unaudited' | 'audited';

export type ItemDefinition = {
  id: string;
  label: string;
  /** accent color for chrome/UI */
  tone: string;
  /** the idea, in the reference's words (V11: "the ideas are on point") */
  note: string;
  /** V11: every item owes the scale audit; nothing is audited yet */
  scaleStatus: ItemScaleStatus;
  /** in-hand scale override (ITEMSCULPT-0606): sculpted items are authored
   *  at real meters and carry 1; absent = the gallery-calibrated per-id
   *  table in the renderer (HELD_ITEM_TUNING.scale) */
  heldScale?: number;
  parts: ItemPart[];
};

// ── the 19 items, parts transcribed verbatim at identity ctx ──

const T = ITEM_TEXTURE_KEYS;

export const ITEM_DEFINITIONS: ItemDefinition[] = [
  {
    id: 'knife', label: 'Knife', tone: '#cbd5df', note: 'wedge blade, riveted grip', scaleStatus: 'unaudited',
    parts: [
      { geometry: 'blade', params: { length: 1.1, width: 0.28, thickness: 0.055 }, material: '#cbd5df', position: [0.15, 0.18, 0], rotation: [0, 0, -0.18] },
      { geometry: 'box', params: box1, material: '#3a261b', position: [-0.47, 0.14, 0], rotation: [0, 0, -0.18], scale: [0.5, 0.16, 0.16] },
      { geometry: 'box', params: box1, material: '#20242c', position: [-0.18, 0.14, 0], rotation: [0, 0, -0.18], scale: [0.08, 0.24, 0.18] },
    ],
  },
  {
    id: 'pistol', label: 'Pistol', tone: '#9aa4b2', note: 'blocky sidearm silhouette', scaleStatus: 'unaudited',
    parts: [
      { geometry: 'box', params: box1, material: '#20242d', position: [0, 0.42, 0], scale: [0.9, 0.23, 0.2] },
      { geometry: 'box', params: box1, material: '#11151c', position: [0.42, 0.39, 0], scale: [0.28, 0.12, 0.18] },
      { geometry: 'box', params: box1, material: '#2e333c', position: [-0.25, 0.2, 0], rotation: [0, 0, -0.45], scale: [0.22, 0.56, 0.2] },
    ],
  },
  {
    id: 'pitchfork', label: 'Pitchfork', tone: '#aeb8c2', note: 'wood shaft and four tines', scaleStatus: 'unaudited',
    parts: [
      { geometry: 'cylinder', params: cyl12, material: '#725238', position: [0, 0.45, 0], rotation: [0, 0, 0.1], scale: [0.055, 1.35, 0.055] },
      { geometry: 'box', params: box1, material: '#3f4650', position: [0, 1.16, 0], scale: [0.68, 0.08, 0.08] },
      ...[-0.24, -0.08, 0.08, 0.24].map((x): ItemPart => (
        { geometry: 'cone', params: cone12, material: '#aeb8c2', position: [x, 1.5, 0], scale: [0.055, 0.7, 0.055] }
      )),
    ],
  },
  {
    id: 'bat', label: 'Baseball bat', tone: '#d09a5d', note: 'tapered wood club', scaleStatus: 'unaudited',
    parts: [
      { geometry: 'cylinder', params: cyl18, material: '#b77a42', position: [0, 0.62, 0], rotation: [0, 0, -0.34], scale: [0.16, 1.6, 0.16] },
      { geometry: 'cylinder', params: cyl18, material: '#6a3f22', position: [-0.25, -0.02, 0], rotation: [0, 0, -0.34], scale: [0.09, 0.5, 0.09] },
    ],
  },
  {
    id: 'cash', label: 'Cash', tone: '#7ac77d', note: 'stacked loose bills', scaleStatus: 'unaudited',
    parts: [
      { geometry: 'box', params: box1, material: '#5fb86b', position: [0, 0.13, 0], scale: [1.0, 0.16, 0.5] },
      { geometry: 'box', params: box1, material: '#ffffff', textureKey: T.cash, position: [0.03, 0.23, -0.02], rotation: [0, 0.08, 0], scale: [0.96, 0.04, 0.48] },
    ],
  },
  {
    id: 'vehicle', label: 'Vehicle', tone: '#f08a6b', note: 'compact low-poly car', scaleStatus: 'unaudited',
    parts: [
      { geometry: 'box', params: box1, material: '#c34c42', position: [0, 0.34, 0], scale: [1.25, 0.36, 0.66] },
      { geometry: 'box', params: box1, material: '#f08a6b', position: [-0.12, 0.64, 0], scale: [0.62, 0.34, 0.54] },
      { geometry: 'box', params: box1, material: '#91c8e8', position: [-0.14, 0.72, 0.285], scale: [0.34, 0.16, 0.04] },
      ...([[-0.52, 0.08, 0.37], [0.52, 0.08, 0.37]] as V3[]).map((p): ItemPart => (
        { geometry: 'cylinder', params: cyl18, material: '#111111', position: p, rotation: [PI / 2, 0, 0], scale: [0.23, 0.16, 0.23] }
      )),
    ],
  },
  {
    id: 'sailboat', label: 'Sail boat', tone: '#f3ead4', note: 'hull, mast, twin sails', scaleStatus: 'unaudited',
    parts: [
      { geometry: 'boatHull', params: { length: 1.35, width: 0.62, height: 0.32 }, material: '#865236', position: [0, 0.24, 0] },
      { geometry: 'cylinder', params: cyl12, material: '#6b4a2d', position: [0.02, 0.82, 0], scale: [0.04, 1.15, 0.04] },
      { geometry: 'sail', params: { width: 0.78, height: 1.08, thickness: 0.025 }, material: '#f3ead4', position: [0.15, 0.52, 0.02] },
      { geometry: 'sail', params: { width: 0.55, height: 0.78, thickness: 0.02 }, material: '#dbe8f2', position: [-0.34, 0.6, -0.025], rotation: [0, PI, 0] },
    ],
  },
  {
    id: 'surfboard', label: 'Surfboard', tone: '#f3e36f', note: 'custom oval board mesh', scaleStatus: 'unaudited',
    parts: [
      { geometry: 'surfboard', params: { length: 1.6, width: 0.44, thickness: 0.075, segments: 24 }, material: '#f3e36f', position: [0, 0.25, 0], rotation: [0, 0, 0.18] },
      { geometry: 'box', params: box1, material: '#3c8fd2', position: [0, 0.305, 0], rotation: [0, 0, 0.18], scale: [1.05, 0.018, 0.055] },
      { geometry: 'box', params: box1, material: '#f06452', position: [-0.38, 0.315, 0], rotation: [0, 0, 0.18], scale: [0.12, 0.025, 0.24] },
    ],
  },
  {
    id: 'football', label: 'Football', tone: '#c9793c', note: 'squashed ball and laces', scaleStatus: 'unaudited',
    parts: [
      { geometry: 'sphere', params: sphere12, material: '#ffffff', textureKey: T.football, position: [0, 0.42, 0], scale: [0.82, 0.46, 0.46] },
    ],
  },
  {
    id: 'basketball', label: 'Basketball', tone: '#da7627', note: 'sphere with seam bands', scaleStatus: 'unaudited',
    parts: [
      { geometry: 'sphere', params: { radius: 0.5, segments: 24, rings: 14 }, material: '#ffffff', textureKey: T.basketball, position: [0, 0.48, 0], scale: [0.75, 0.75, 0.75] },
    ],
  },
  {
    id: 'pillbottle', label: 'Pill bottle', tone: '#d98238', note: 'amber bottle and label', scaleStatus: 'unaudited',
    parts: [
      { geometry: 'cylinder', params: cyl18, material: '#ffffff', textureKey: T.pillLabel, position: [0, 0.42, 0], scale: [0.32, 0.72, 0.32] },
      { geometry: 'cylinder', params: cyl18, material: '#f7f1df', position: [0, 0.84, 0], scale: [0.34, 0.14, 0.34] },
    ],
  },
  {
    id: 'beer', label: 'Beer bottle', tone: '#2f593a', note: 'green glass and paper label', scaleStatus: 'unaudited',
    parts: [
      { geometry: 'cylinder', params: cyl18, material: '#ffffff', textureKey: T.beerLabel, position: [0, 0.42, 0], scale: [0.22, 0.62, 0.22] },
      { geometry: 'cylinder', params: cyl18, material: '#24472f', position: [0, 0.88, 0], scale: [0.11, 0.42, 0.11] },
      { geometry: 'cylinder', params: cyl18, material: '#d7b46a', position: [0, 1.11, 0], scale: [0.13, 0.05, 0.13] },
    ],
  },
  {
    id: 'liquor', label: 'Liquor bottle', tone: '#7b58ad', note: 'square bottle, long neck', scaleStatus: 'unaudited',
    parts: [
      { geometry: 'box', params: box1, material: '#ffffff', textureKey: T.liquorLabel, position: [0, 0.46, 0], scale: [0.42, 0.7, 0.28] },
      { geometry: 'cylinder', params: cyl18, material: '#3b2763', position: [0, 0.96, 0], scale: [0.12, 0.38, 0.12] },
    ],
  },
  {
    id: 'pills', label: 'Pills', tone: '#e65353', note: 'loose capsule scatter', scaleStatus: 'unaudited',
    parts: [
      { geometry: 'cylinder', params: cyl18, material: '#f7f4e8', position: [-0.34, 0.18, -0.12], rotation: [PI / 2, 0, 0.2], scale: [0.13, 0.38, 0.13] },
      { geometry: 'cylinder', params: cyl18, material: '#e65353', position: [0.04, 0.19, 0.05], rotation: [PI / 2, 0, -0.4], scale: [0.13, 0.38, 0.13] },
      { geometry: 'cylinder', params: cyl18, material: '#70a8f0', position: [0.36, 0.17, -0.03], rotation: [PI / 2, 0, 0.7], scale: [0.13, 0.38, 0.13] },
    ],
  },
  {
    id: 'weed', label: 'Weed', tone: '#5fc25b', note: 'leafy low-poly pickup', scaleStatus: 'unaudited',
    parts: [
      // leaves first, buds second — the reference's emission order
      { geometry: 'surfboard', params: { length: 0.46, width: 0.12, thickness: 0.018, segments: 12 }, material: '#4fb84e', position: [-0.22, 0.16, -0.08], rotation: [0.1, -0.6, 0.7], scale: [0.42, 0.9, 0.42] },
      { geometry: 'surfboard', params: { length: 0.46, width: 0.12, thickness: 0.018, segments: 12 }, material: '#5fca59', position: [0.18, 0.15, 0.08], rotation: [0.05, 0.8, -0.65], scale: [0.38, 0.82, 0.38] },
      { geometry: 'surfboard', params: { length: 0.46, width: 0.12, thickness: 0.018, segments: 12 }, material: '#3f9f42', position: [0.02, 0.14, 0], rotation: [0.18, 0.1, PI / 2], scale: [0.34, 0.72, 0.34] },
      { geometry: 'sphere', params: sphere12, material: '#2f7d37', position: [-0.18, 0.3, 0.02], scale: [0.24, 0.22, 0.2] },
      { geometry: 'sphere', params: sphere12, material: '#3f9a43', position: [0.02, 0.36, -0.02], scale: [0.28, 0.26, 0.22] },
      { geometry: 'sphere', params: sphere12, material: '#2d7135', position: [0.22, 0.28, 0.04], scale: [0.22, 0.2, 0.18] },
      { geometry: 'sphere', params: sphere12, material: '#5fb858', position: [-0.02, 0.18, 0.14], scale: [0.22, 0.18, 0.16] },
      { geometry: 'sphere', params: sphere12, material: '#6fbd5b', position: [0.12, 0.2, -0.16], scale: [0.18, 0.16, 0.14] },
    ],
  },
  {
    id: 'cigarettes', label: 'Cigarettes', tone: '#d73e36', note: 'pack and loose smokes', scaleStatus: 'unaudited',
    parts: [
      { geometry: 'box', params: box1, material: '#d9362e', position: [-0.28, 0.33, 0], scale: [0.42, 0.62, 0.18] },
      { geometry: 'box', params: box1, material: '#ffffff', textureKey: T.cigFront, position: [-0.28, 0.33, 0.096], scale: [0.36, 0.52, 0.012] },
      { geometry: 'box', params: box1, material: '#ffffff', textureKey: T.cigSide, position: [-0.062, 0.33, 0], scale: [0.012, 0.52, 0.16] },
      { geometry: 'box', params: box1, material: '#ffffff', textureKey: T.cigTop, position: [-0.28, 0.648, 0], scale: [0.36, 0.012, 0.16] },
      { geometry: 'box', params: box1, material: '#ffffff', textureKey: T.cigBack, position: [-0.28, 0.33, -0.096], scale: [0.36, 0.52, 0.012] },
      { geometry: 'box', params: box1, material: '#ffffff', textureKey: T.cigBottom, position: [-0.28, 0.012, 0], scale: [0.36, 0.012, 0.16] },
      ...[-0.42, -0.28, -0.14].map((x, i): ItemPart => (
        { geometry: 'cylinder', params: cyl12, material: '#f4f0df', position: [x, 0.82 + i * 0.03, 0.02], scale: [0.045, 0.42, 0.045] }
      )),
      ...[-0.42, -0.28, -0.14].map((x, i): ItemPart => (
        { geometry: 'cylinder', params: cyl12, material: '#d49a55', position: [x, 0.61 + i * 0.03, 0.02], scale: [0.047, 0.12, 0.047] }
      )),
    ],
  },
  {
    id: 'backpack', label: 'Backpack', tone: '#315c8f', note: 'straps, pouch, zipper pull', scaleStatus: 'unaudited',
    parts: [
      { geometry: 'box', params: box1, material: '#315c8f', position: [0, 0.55, 0], scale: [0.62, 0.82, 0.34] },
      { geometry: 'box', params: box1, material: '#244a78', position: [0, 0.72, 0.22], scale: [0.52, 0.18, 0.15] },
      { geometry: 'torus', params: { radius: 0.45, tube: 0.035, segments: 18, sides: 8 }, material: '#1e3352', position: [-0.2, 0.48, -0.22], rotation: [0, PI / 2, 0], scale: [0.48, 0.8, 0.48] },
      { geometry: 'torus', params: { radius: 0.45, tube: 0.035, segments: 18, sides: 8 }, material: '#1e3352', position: [0.2, 0.48, -0.22], rotation: [0, PI / 2, 0], scale: [0.48, 0.8, 0.48] },
      { geometry: 'cylinder', params: cyl12, material: '#d6b46c', position: [0.25, 0.64, 0.39], rotation: [PI / 2, 0, 0], scale: [0.035, 0.16, 0.035] },
    ],
  },
  {
    id: 'medkit', label: 'Med kit', tone: '#f1f4f4', note: 'bonus utility prop', scaleStatus: 'unaudited',
    parts: [
      { geometry: 'box', params: box1, material: '#ffffff', textureKey: T.medkit, position: [0, 0.38, 0], scale: [0.82, 0.52, 0.32] },
      { geometry: 'cylinder', params: cyl12, material: '#c8ccd0', position: [0, 0.71, 0], rotation: [0, 0, PI / 2], scale: [0.055, 0.44, 0.055] },
    ],
  },
  {
    id: 'tv', label: 'TV', tone: '#8cc8ff', note: 'React dashboard through CRT filter', scaleStatus: 'unaudited',
    parts: [
      { geometry: 'box', params: box1, material: '#242a34', position: [0, 0.55, 0], scale: [1.15, 0.78, 0.32] },
      { geometry: 'box', params: box1, material: '#ffffff', textureKey: T.tvScreen, position: [-0.13, 0.58, 0.174], scale: [0.68, 0.42, 0.018] },
      { geometry: 'cylinder', params: cyl12, material: '#11151c', position: [0.42, 0.64, 0.19], rotation: [PI / 2, 0, 0], scale: [0.055, 0.045, 0.055] },
      { geometry: 'cylinder', params: cyl12, material: '#11151c', position: [0.42, 0.48, 0.19], rotation: [PI / 2, 0, 0], scale: [0.055, 0.045, 0.055] },
      { geometry: 'box', params: box1, material: '#151922', position: [-0.34, 0.1, 0], scale: [0.16, 0.2, 0.18] },
      { geometry: 'box', params: box1, material: '#151922', position: [0.34, 0.1, 0], scale: [0.16, 0.2, 0.18] },
    ],
  },
];

// ── lookup surface (the kinds-family conventions) ──

export const ITEM_IDS: string[] = ITEM_DEFINITIONS.map((item) => item.id);

const ITEM_BY_ID = new Map(ITEM_DEFINITIONS.map((item) => [item.id, item]));

export function isItemId(id: string): boolean {
  return ITEM_BY_ID.has(id);
}

export function itemDefinition(id: string): ItemDefinition {
  const item = ITEM_BY_ID.get(id);
  if (!item) throw new Error(`unknown item ${id}; expected one of ${itemNamesForConsole()}`);
  return item;
}

export function itemNamesForConsole(): string {
  return ITEM_IDS.join(', ');
}

// ── scale-audit starting data (V11) ──

function scaleVec(scale: V3 | number | undefined): V3 {
  if (scale == null) return [1, 1, 1];
  if (typeof scale === 'number') return [scale, scale, scale];
  return scale;
}

/**
 * Approximate item-local size of one part in meters, BEFORE its rotation.
 * Engine shapes are unit-extent by construction (box 1³; cylinder/cone/sphere
 * diameter 1 × height 1; torus radius .45 + tube .035 ≈ 0.97), so a part's
 * size ≈ its scale vector. Custom generators derive from their params.
 */
export function approxPartSizeMeters(part: ItemPart): V3 {
  const s = scaleVec(part.scale);
  const p = part.params as any;
  switch (part.geometry) {
    case 'blade': {
      const d = p as BladeParams;
      return [1.03 * d.length * s[0], d.width * s[1], d.thickness * s[2]];
    }
    case 'sail': {
      const d = p as SailParams;
      return [0.87 * d.width * s[0], d.height * s[1], d.thickness * s[2]];
    }
    case 'boatHull': {
      const d = p as BoatHullParams;
      return [d.length * s[0], d.height * s[1], d.width * s[2]];
    }
    case 'surfboard': {
      const d = p as SurfboardParams;
      return [d.length * s[0], d.thickness * s[1], d.width * s[2]];
    }
    default:
      return s;
  }
}

export type ItemBounds = { min: V3; max: V3; size: V3 };

/**
 * Approximate axis-aligned bounds of an item in item-local meters — part
 * rotations are IGNORED and every part is treated as centered on its position
 * (the boat hull's keel offset etc. are absorbed by the approximation). This
 * is deliberately rough: it exists so the V11 scale audit starts from numbers
 * instead of eyeballs, not to be a collider.
 */
export function approxItemBoundsMeters(id: string): ItemBounds {
  const item = itemDefinition(id);
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const part of item.parts) {
    const size = approxPartSizeMeters(part);
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], part.position[axis] - size[axis] * 0.5);
      max[axis] = Math.max(max[axis], part.position[axis] + size[axis] * 0.5);
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

export { ITEM_GEOMETRY_DEFAULTS };
