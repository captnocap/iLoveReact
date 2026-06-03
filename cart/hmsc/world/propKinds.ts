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
};

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
