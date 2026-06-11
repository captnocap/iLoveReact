import type { PropKind, TileKind } from '../design';

// The pure, render-free property bundle for every prop kind — the propKinds
// twin of tileKinds.ts. Both the physics/pathing layer (state, world) and the
// 3D models (render3d/props) resolve a prop through here, so a hydrant's
// collision footprint and its mesh agree on one radius and one height. Keeping
// this module JSX-free is what lets host physics import it without dragging the
// renderer along (the same reason tileKinds.ts is pure).

// How a prop governs vehicle traffic. 'none' props are scenery; 'stopSign' is
// always a hard stop; 'signal' free-runs a green→caution→stop cycle (the
// traffic light). world/traffic.ts turns this into a live phase.
export type PropTrafficControl = 'none' | 'stopSign' | 'signal';

export type PropKindDefinition = {
  kind: PropKind;
  label: string;
  // Whether the player (and vehicles) collide with it. Solid props add a small
  // blocking footprint to host physics; non-solid props (bushes) you walk into.
  solid: boolean;
  // Collision half-extent in meters around the ground anchor. Drives the host
  // physics blocking rect AND the model's base width, so they never drift.
  footprintRadiusMeters: number;
  // Visual top in meters above the ground anchor — the prop's full height, used
  // by the model and as a scale reference against HMSC_SCALE. 1 tile = 1 meter.
  heightMeters: number;
  // The gameplay property bundle this prop borrows for cover, concealment, line
  // of sight, and noise — resolved through tileKindDefinition. A bush points at
  // the 'bush' foliage tile (walk-through, high concealment); solid obstacles
  // point at 'wall' (they block sight and give cover). This is how a placement
  // "gets all the property ideas of a tile" without a parallel schema.
  tileKind: TileKind;
  trafficControl: PropTrafficControl;
  // Present = this prop is a DYNAMIC body, not static scenery: placed, it
  // becomes a host physics sphere the player kicks around by running into it
  // (KICKPROP-0610). Dynamic props contribute NO static blocking rect.
  dynamics?: PropDynamics;
};

/** The dynamic-body recipe for a kickable prop (host sphere body). */
export type PropDynamics = {
  /** sphere body radius in meters (the mesh rides at body.y - radius) */
  bodyRadiusMeters: number;
  /** bounce on world contact, 0..1 — balls high, cones/cans low */
  restitution: number;
};

/** The dynamics recipe for a kind, or null for static scenery. */
export function propDynamics(kind: PropKind): PropDynamics | null {
  return PROP_KIND_DEFINITIONS[kind].dynamics ?? null;
}

export const PROP_KIND_DEFINITIONS: Record<PropKind, PropKindDefinition> = {
  rock: {
    kind: 'rock',
    label: 'Rock',
    solid: true,
    footprintRadiusMeters: 0.55,
    heightMeters: 0.9,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  rockLarge: {
    kind: 'rockLarge',
    label: 'Large Rock',
    solid: true,
    footprintRadiusMeters: 1.1,
    heightMeters: 1.6,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  rockSmall: {
    kind: 'rockSmall',
    label: 'Small Rock',
    solid: true,
    footprintRadiusMeters: 0.28,
    heightMeters: 0.42,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  fireHydrant: {
    kind: 'fireHydrant',
    label: 'Fire Hydrant',
    solid: true,
    footprintRadiusMeters: 0.27,
    heightMeters: 0.98,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  streetSign: {
    kind: 'streetSign',
    label: 'Street Sign',
    solid: true,
    footprintRadiusMeters: 0.12,
    // Tall enough that the panel clears head height (the player tops out ~2.3m).
    heightMeters: 3.3,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  streetLight: {
    kind: 'streetLight',
    label: 'Street Light',
    solid: true,
    footprintRadiusMeters: 0.16,
    heightMeters: 5.2,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  bush: {
    kind: 'bush',
    label: 'Bush',
    // Non-solid: the GTA shrub you walk straight through. A BIG hide-in bush —
    // taller than the player so standing inside it conceals you. The radius is
    // its canopy half-width; it is NOT collision (the kind is non-solid, so no
    // physics rect), it only sizes the concealment query in world/props.ts.
    solid: false,
    footprintRadiusMeters: 1.2,
    heightMeters: 2.5,
    tileKind: 'bush',
    trafficControl: 'none',
  },
  bushLarge: {
    kind: 'bushLarge',
    // A MASSIVE bush — ~4.5x the sidewalk shrub, taller than a two-storey
    // building. Same walk-through foliage, just enormous: you can lose a whole
    // car in it. Shares the bush model and texture; only the size differs.
    label: 'Massive Bush',
    solid: false,
    footprintRadiusMeters: 6.5,
    heightMeters: 13,
    tileKind: 'bush',
    trafficControl: 'none',
  },
  bushLow: {
    kind: 'bushLow',
    label: 'Low Hedge',
    solid: false,
    footprintRadiusMeters: 0.85,
    heightMeters: 0.9,
    tileKind: 'bush',
    trafficControl: 'none',
  },
  bushSparse: {
    kind: 'bushSparse',
    label: 'Sparse Bush',
    solid: false,
    footprintRadiusMeters: 0.7,
    heightMeters: 1.1,
    tileKind: 'bush',
    trafficControl: 'none',
  },
  stopSign: {
    kind: 'stopSign',
    label: 'Stop Sign',
    solid: true,
    footprintRadiusMeters: 0.12,
    // Real stop signs sit ~2.1m to the bottom of the plate; this puts the
    // octagon well above head height.
    heightMeters: 3.1,
    tileKind: 'wall',
    trafficControl: 'stopSign',
  },
  trafficLight: {
    kind: 'trafficLight',
    label: 'Traffic Light',
    solid: true,
    footprintRadiusMeters: 0.18,
    heightMeters: 5.6,
    tileKind: 'wall',
    trafficControl: 'signal',
  },
  payphone: {
    kind: 'payphone',
    label: 'Payphone',
    // A sidewalk phone on a stand with a small acoustic hood — the player bumps
    // it; it's the load-bearing low-tech comms prop (call contacts, no mobile).
    solid: true,
    footprintRadiusMeters: 0.3,
    heightMeters: 1.45,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  dumpster: {
    kind: 'dumpster',
    label: 'Dumpster',
    solid: true,
    footprintRadiusMeters: 0.95,
    heightMeters: 1.35,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  mailbox: {
    kind: 'mailbox',
    label: 'Mailbox',
    solid: true,
    footprintRadiusMeters: 0.22,
    heightMeters: 1.35,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  fence: {
    kind: 'fence',
    label: 'Fence',
    solid: true,
    // A 2.5m segment; footprintRadius sizes the collision square.
    footprintRadiusMeters: 1.35,
    heightMeters: 1.25,
    tileKind: 'wall',
    trafficControl: 'none',
  },

  // ── street furniture ──────────────────────────────────────────────────────
  trafficCone: {
    kind: 'trafficCone',
    label: 'Traffic Cone',
    solid: true,
    footprintRadiusMeters: 0.18,
    heightMeters: 0.7,
    tileKind: 'wall',
    trafficControl: 'none',
    dynamics: { bodyRadiusMeters: 0.22, restitution: 0.15 },
  },
  barrier: {
    kind: 'barrier',
    label: 'Jersey Barrier',
    // A concrete road segment, long like a fence — gets the same yaw-aware
    // thin AABB in world/props.ts so you can walk alongside it.
    solid: true,
    footprintRadiusMeters: 1.0,
    heightMeters: 1.05,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  trashCan: {
    kind: 'trashCan',
    label: 'Trash Can',
    solid: true,
    footprintRadiusMeters: 0.3,
    heightMeters: 1.0,
    tileKind: 'wall',
    trafficControl: 'none',
    dynamics: { bodyRadiusMeters: 0.38, restitution: 0.22 },
  },
  bench: {
    kind: 'bench',
    label: 'Park Bench',
    // Long like a fence segment — yaw-aware thin AABB (world/props.ts).
    solid: true,
    footprintRadiusMeters: 0.8,
    heightMeters: 0.85,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  planter: {
    kind: 'planter',
    label: 'Planter',
    solid: true,
    footprintRadiusMeters: 0.5,
    heightMeters: 0.6,
    tileKind: 'wall',
    trafficControl: 'none',
  },

  // ── trees ──────────────────────────────────────────────────────────────────
  // footprintRadius is the TRUNK, not the canopy — you bump the trunk and walk
  // under the foliage edge, like every GTA tree. Heights follow the R4
  // stylized-tall contract (scale verticals UP against the ~2m player).
  treeOak: {
    kind: 'treeOak',
    label: 'Oak Tree',
    solid: true,
    footprintRadiusMeters: 0.35,
    heightMeters: 7,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  treePine: {
    kind: 'treePine',
    label: 'Pine Tree',
    solid: true,
    footprintRadiusMeters: 0.3,
    heightMeters: 9,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  treeBirch: {
    kind: 'treeBirch',
    label: 'Birch Tree',
    solid: true,
    footprintRadiusMeters: 0.18,
    heightMeters: 6,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  treeCypress: {
    kind: 'treeCypress',
    label: 'Cypress Tree',
    solid: true,
    footprintRadiusMeters: 0.3,
    heightMeters: 7.5,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  treePalm: {
    kind: 'treePalm',
    label: 'Palm Tree',
    solid: true,
    footprintRadiusMeters: 0.22,
    heightMeters: 6.5,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  treeDead: {
    kind: 'treeDead',
    label: 'Dead Tree',
    solid: true,
    footprintRadiusMeters: 0.25,
    heightMeters: 5,
    tileKind: 'wall',
    trafficControl: 'none',
  },

  // ── rock forms ─────────────────────────────────────────────────────────────
  boulder: {
    kind: 'boulder',
    label: 'Boulder',
    solid: true,
    footprintRadiusMeters: 1.6,
    heightMeters: 2.6,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  rockFlat: {
    kind: 'rockFlat',
    label: 'Flat Rock',
    solid: true,
    footprintRadiusMeters: 0.9,
    heightMeters: 0.45,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  rockSpire: {
    kind: 'rockSpire',
    label: 'Rock Spire',
    solid: true,
    footprintRadiusMeters: 0.5,
    heightMeters: 2.4,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  rockMossy: {
    kind: 'rockMossy',
    label: 'Mossy Rock',
    solid: true,
    footprintRadiusMeters: 0.6,
    heightMeters: 0.85,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  rockPile: {
    kind: 'rockPile',
    label: 'Rock Pile',
    solid: true,
    footprintRadiusMeters: 0.8,
    heightMeters: 0.7,
    tileKind: 'wall',
    trafficControl: 'none',
  },

  // ── balls ──────────────────────────────────────────────────────────────────
  // Solid: they get a host-physics blocking rect like every obstacle, so the
  // player collides with them. (Rolling/kick dynamics is a separate system —
  // props are static world geometry today.)
  ballBeach: {
    kind: 'ballBeach',
    label: 'Beach Ball',
    solid: true,
    footprintRadiusMeters: 0.4,
    heightMeters: 0.8,
    tileKind: 'wall',
    trafficControl: 'none',
    dynamics: { bodyRadiusMeters: 0.4, restitution: 0.75 },
  },
  ballSoccer: {
    kind: 'ballSoccer',
    label: 'Soccer Ball',
    solid: true,
    footprintRadiusMeters: 0.11,
    heightMeters: 0.22,
    tileKind: 'wall',
    trafficControl: 'none',
    dynamics: { bodyRadiusMeters: 0.11, restitution: 0.65 },
  },
  ballBasketball: {
    kind: 'ballBasketball',
    label: 'Basketball',
    solid: true,
    footprintRadiusMeters: 0.12,
    heightMeters: 0.24,
    tileKind: 'wall',
    trafficControl: 'none',
    dynamics: { bodyRadiusMeters: 0.12, restitution: 0.78 },
  },

  // ── wall decor ─────────────────────────────────────────────────────────────
  // Anchored at the wall base; the decor hangs at height in the model. The
  // thin solid footprint sits flush against the wall it mounts on.
  wallPainting: {
    kind: 'wallPainting',
    label: 'Wall Painting',
    solid: true,
    footprintRadiusMeters: 0.08,
    heightMeters: 2.1,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  ledLight: {
    kind: 'ledLight',
    label: 'LED Light',
    solid: true,
    footprintRadiusMeters: 0.06,
    heightMeters: 2.4,
    tileKind: 'wall',
    trafficControl: 'none',
  },

  // ── furniture ──────────────────────────────────────────────────────────────
  chair: {
    kind: 'chair',
    label: 'Chair',
    solid: true,
    footprintRadiusMeters: 0.3,
    heightMeters: 0.95,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  couch: {
    kind: 'couch',
    label: 'Couch',
    // Long like a fence segment — yaw-aware thin AABB (world/props.ts).
    solid: true,
    footprintRadiusMeters: 0.95,
    heightMeters: 0.85,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  table: {
    kind: 'table',
    label: 'Table',
    solid: true,
    footprintRadiusMeters: 0.6,
    heightMeters: 0.78,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  floorLamp: {
    kind: 'floorLamp',
    label: 'Floor Lamp',
    solid: true,
    footprintRadiusMeters: 0.2,
    heightMeters: 1.7,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  // Colored chair variants — same body as 'chair', painted by kind (the model
  // resolves its palette from the kind, like the rock and bush families).
  chairRed: {
    kind: 'chairRed',
    label: 'Red Chair',
    solid: true,
    footprintRadiusMeters: 0.3,
    heightMeters: 0.95,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  chairBlue: {
    kind: 'chairBlue',
    label: 'Blue Chair',
    solid: true,
    footprintRadiusMeters: 0.3,
    heightMeters: 0.95,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  chairGreen: {
    kind: 'chairGreen',
    label: 'Green Chair',
    solid: true,
    footprintRadiusMeters: 0.3,
    heightMeters: 0.95,
    tileKind: 'wall',
    trafficControl: 'none',
  },

  // ── household (bedroom / kitchen / bathroom) ───────────────────────────────
  bedSingle: {
    kind: 'bedSingle',
    label: 'Single Bed',
    // 2.1m long along local X, 1.0m wide — yaw-aware thin AABB (world/props.ts).
    solid: true,
    footprintRadiusMeters: 1.05,
    heightMeters: 0.9,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  bedDouble: {
    kind: 'bedDouble',
    label: 'Double Bed',
    // 2.1m long along local X, 1.5m wide — yaw-aware thin AABB (world/props.ts).
    solid: true,
    footprintRadiusMeters: 1.05,
    heightMeters: 0.95,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  cupboard: {
    kind: 'cupboard',
    label: 'Cupboard',
    // 1.0m wide, 0.5m deep — yaw-aware thin AABB (world/props.ts).
    solid: true,
    footprintRadiusMeters: 0.5,
    heightMeters: 1.9,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  mirror: {
    kind: 'mirror',
    label: 'Mirror',
    // Wall decor: anchor at the wall base, the glass hangs at height.
    solid: true,
    footprintRadiusMeters: 0.06,
    heightMeters: 1.9,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  sink: {
    kind: 'sink',
    label: 'Sink',
    solid: true,
    footprintRadiusMeters: 0.3,
    heightMeters: 0.9,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  oven: {
    kind: 'oven',
    label: 'Oven',
    solid: true,
    footprintRadiusMeters: 0.35,
    heightMeters: 0.95,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  fridge: {
    kind: 'fridge',
    label: 'Fridge',
    solid: true,
    footprintRadiusMeters: 0.4,
    heightMeters: 1.9,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  computer: {
    kind: 'computer',
    label: 'Computer',
    // A desktop setup (monitor + keyboard + tower) at its anchor — drop it on
    // any raised surface piece, or the floor.
    solid: true,
    footprintRadiusMeters: 0.3,
    heightMeters: 0.55,
    tileKind: 'wall',
    trafficControl: 'none',
  },

  // ── utility + sport ────────────────────────────────────────────────────────
  telephonePole: {
    kind: 'telephonePole',
    label: 'Telephone Pole',
    solid: true,
    footprintRadiusMeters: 0.16,
    heightMeters: 8.5,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  basketballHoop: {
    kind: 'basketballHoop',
    label: 'Basketball Hoop',
    // Street hoop: pole + backboard + rim at the regulation-ish 3.05m.
    solid: true,
    footprintRadiusMeters: 0.25,
    heightMeters: 3.8,
    tileKind: 'wall',
    trafficControl: 'none',
  },
};

export const PROP_KINDS = Object.keys(PROP_KIND_DEFINITIONS) as PropKind[];

export function isPropKind(value: string): value is PropKind {
  return Object.prototype.hasOwnProperty.call(PROP_KIND_DEFINITIONS, value);
}

export function propKindDefinition(kind: PropKind): PropKindDefinition {
  return PROP_KIND_DEFINITIONS[kind];
}

export function propKindNamesForConsole(): string {
  return PROP_KINDS.join(', ');
}
