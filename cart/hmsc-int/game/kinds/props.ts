// game/kinds/props — the prop-kind registry: the pure, render-free property
// bundle for every prop kind. THE TABLE IS THE DATA (P2). The struct stores
// `kind`; this registry gives it meaning. Both the physics/pathing layer and
// the 3D prop models resolve a prop through here, so a hydrant's collision
// footprint and its mesh agree on one radius and one height. 1 tile = 1 meter.
//
// A prop borrows its gameplay property bundle (cover, concealment, line of
// sight, noise) from a TILE kind via `tileKind` — a bush points at the 'bush'
// foliage tile (walk-through, high concealment); solid obstacles point at
// 'wall' (they block sight and give cover). This is how a placement "gets all
// the property ideas of a tile" without a parallel schema.
//
// THE ONE TABLE since PROPMERGE-0611 (review §13.1): the legacy twin
// world/propKinds.ts is retired and every consumer — the editor palette,
// PropertiesPanel, placements, host physics, traffic, the prop meshes, AND
// compile/worldGeometry — resolves through here. The split-consumer
// divergence hazard (editor+compile on one table, the game door on another)
// is dead; a prop value edited here is the value everywhere.
// (Originally a fresh capture of cart/hmsc/world/propKinds.ts.)

import type { TileKind } from './tiles';
import {
  IMPORTED_PROP_DEFINITIONS,
  IMPORTED_PROP_KINDS,
  type ImportedPropKind,
} from './importedProps.generated';
// Per-prop defs live in each prop's own file (the file with the most data owns
// it); this registry assembles them. Migrating prop-by-prop — chairs first.
import { diningChairDef } from '../../compile/propRecipes/diningChair';
import { armchairDef } from '../../compile/propRecipes/armchair';
import { officeChairDef } from '../../compile/propRecipes/officeChair';
import { foldingChairDef } from '../../compile/propRecipes/foldingChair';
import { fireHydrantDef } from '../../compile/propRecipes/fireHydrant';
import { streetSignDef } from '../../compile/propRecipes/streetSign';
import { streetLightDef } from '../../compile/propRecipes/streetLight';
import { stopSignDef } from '../../compile/propRecipes/stopSign';
import { trafficLightDef } from '../../compile/propRecipes/trafficLight';
import { treeOakDef } from '../../compile/propRecipes/treeOak';
import { treePineDef } from '../../compile/propRecipes/treePine';
import { treeBirchDef } from '../../compile/propRecipes/treeBirch';
import { treeCypressDef } from '../../compile/propRecipes/treeCypress';
import { treePalmDef } from '../../compile/propRecipes/treePalm';
import { treeDeadDef } from '../../compile/propRecipes/treeDead';
import { boulderDef } from '../../compile/propRecipes/boulder';
import { rockFlatDef } from '../../compile/propRecipes/rockFlat';
import { rockSpireDef } from '../../compile/propRecipes/rockSpire';
import { rockMossyDef } from '../../compile/propRecipes/rockMossy';
import { rockPileDef } from '../../compile/propRecipes/rockPile';
import { payphoneDef } from '../../compile/propRecipes/payphone';
import { mailboxDef } from '../../compile/propRecipes/mailbox';
import { fenceDef } from '../../compile/propRecipes/fence';
import { trafficConeDef } from '../../compile/propRecipes/trafficCone';
import { barrierDef } from '../../compile/propRecipes/barrier';
import { trashCanDef } from '../../compile/propRecipes/trashCan';
import { benchDef } from '../../compile/propRecipes/bench';
import { planterDef } from '../../compile/propRecipes/planter';

export type BuiltinPropKind =
  | 'rock'
  | 'rockLarge'
  | 'rockSmall'
  | 'fireHydrant'
  | 'streetSign'
  | 'streetLight'
  | 'bush'
  | 'bushLarge'
  | 'bushLow'
  | 'bushSparse'
  | 'stopSign'
  | 'trafficLight'
  | 'payphone'
  | 'dumpster'
  | 'mailbox'
  | 'fence'
  // street furniture
  | 'trafficCone'
  | 'barrier'
  | 'trashCan'
  | 'bench'
  | 'planter'
  // trees (trunk-sized collision; canopy is visual)
  | 'treeOak'
  | 'treePine'
  | 'treeBirch'
  | 'treeCypress'
  | 'treePalm'
  | 'treeDead'
  // rock forms beyond the small/medium/large trio
  | 'boulder'
  | 'rockFlat'
  | 'rockSpire'
  | 'rockMossy'
  | 'rockPile'
  // balls — solid colliders the player bumps
  | 'ballBeach'
  | 'ballSoccer'
  | 'ballBasketball'
  // wall-mounted decor (anchor at the wall base, decor hangs at height)
  | 'wallPainting'
  | 'ledLight'
  // furniture (chairs are type-named: diningChair/armchair/officeChair/foldingChair
  // below in the PROPFURNITURE union — color is a skin, never a kind id)
  | 'couch'
  | 'table'
  | 'floorLamp'
  // household (bedroom/kitchen/bathroom)
  | 'bedSingle'
  | 'bedDouble'
  | 'cupboard'
  | 'mirror'
  | 'sink'
  | 'oven'
  | 'fridge'
  | 'computer'
  // utility + sport
  | 'telephonePole'
  | 'basketballHoop'
  // ── PROPBATCH-0611 (req_0633/req_0634/req_0635): the big variety drop ──────
  // ground foliage
  | 'grassPatch'
  | 'grassTall'
  // jagged rock forms (rotated-box facets, not sphere blobs)
  | 'rockJagged'
  | 'rockShard'
  // tree size variants (same models, registry-scaled)
  | 'treeOakYoung'
  | 'treeOakGiant'
  | 'treePineYoung'
  | 'treePineGiant'
  // broadcast / street commerce
  | 'radioTower'
  | 'gasPump'
  | 'vendingMachine'
  | 'storeShelf'
  | 'businessSign'
  | 'shopSign'
  | 'poster'
  | 'hospitalSign'
  | 'policeSign'
  // music / media (tabletop)
  | 'bookStack'
  | 'recordPlayer'
  | 'vinylRecord'
  | 'albumCover'
  | 'speaker'
  | 'speakerStack'
  | 'cassette'
  // the junkyard set
  | 'shippingContainer'
  | 'concretePipe'
  | 'pipeStack'
  | 'corrugatedSheet'
  | 'cableSpool'
  | 'lockerSet'
  | 'oilTank'
  | 'tire'
  | 'tireStack'
  | 'barrel'
  | 'steelDrum'
  | 'propaneTank'
  | 'jerryCan'
  | 'cinderBlock'
  | 'brick'
  | 'rubblePile'
  | 'crate'
  | 'pallet'
  | 'palletStack'
  // bathroom wall
  | 'toiletPaper'
  // ── PROPVENUE-0611 (req_0640): parks + shop interiors ──────────────────────
  // park / playground
  | 'fountain'
  | 'drinkingFountain'
  | 'loungeChair'
  | 'swingset'
  | 'sandCastle'
  | 'picketFence'
  | 'appleTree'
  | 'apple'
  // venue / shop interiors (arcade, casino, dispensary, liquor, fast food)
  | 'arcadeCabinet'
  | 'slotMachine'
  | 'clothingRack'
  | 'displayCase'
  | 'liquorShelf'
  | 'beerCase'
  | 'dinerBooth'
  | 'orderCounter'
  | 'menuBoard'
  | 'sodaMachine'
  | 'openSign'
  | 'greenCrossSign'
  // ── PROPFURNITURE-0613 (req_0783): dozens of interior props — chairs, desks,
  // shelves, couches, computers, poster sizes, tables, beds, appliances, storage,
  // lights, decor. All data-recipe, all skinnable, exact scale + physics. ─────
  // chairs
  | 'stool'
  | 'barStool'
  | 'officeChair'
  | 'diningChair'
  | 'armchair'
  | 'foldingChair'
  | 'rockingChair'
  | 'beanBag'
  | 'highChair'
  | 'directorsChair'
  | 'patioChair'
  // desks
  | 'officeDesk'
  | 'receptionDesk'
  | 'standingDesk'
  | 'cornerDesk'
  | 'draftingTable'
  | 'computerDesk'
  | 'writingDesk'
  | 'classroomDesk'
  // shelves
  | 'bookcase'
  | 'wallShelf'
  | 'wireShelf'
  | 'floatingShelf'
  | 'storageShelf'
  | 'displayShelf'
  | 'magazineRack'
  | 'dvdShelf'
  | 'wineRack'
  | 'toolShelf'
  // couches + lounge
  | 'loveseat'
  | 'sectional'
  | 'sofa'
  | 'chaiseLounge'
  | 'ottoman'
  | 'futon'
  | 'daybed'
  | 'recliner'
  // tables
  | 'coffeeTable'
  | 'endTable'
  | 'nightstand'
  | 'diningTable'
  | 'conferenceTable'
  | 'picnicTable'
  | 'sideTable'
  | 'consoleTable'
  | 'pokerTable'
  | 'workbench'
  // computers + tech
  | 'laptop'
  | 'monitor'
  | 'keyboard'
  | 'serverRack'
  | 'printer'
  | 'router'
  | 'tv'
  | 'gameConsole'
  | 'phone'
  | 'tablet'
  // posters + wall surfaces
  | 'posterSmall'
  | 'posterLarge'
  | 'posterWide'
  | 'posterTall'
  | 'noticeBoard'
  | 'corkboard'
  | 'whiteboard'
  | 'chalkboard'
  // beds
  | 'bunkBed'
  | 'hospitalBed'
  | 'mattress'
  // appliances + fixtures
  | 'microwave'
  | 'toaster'
  | 'blender'
  | 'washingMachine'
  | 'dryer'
  | 'toilet'
  | 'bathtub'
  | 'radiator'
  | 'waterCooler'
  // storage
  | 'wardrobe'
  | 'dresser'
  | 'filingCabinet'
  | 'toolCabinet'
  | 'safe'
  | 'cardboardBox'
  | 'storageBin'
  | 'coatRack'
  // lights
  | 'deskLamp'
  | 'ceilingLamp'
  | 'wallSconce'
  | 'neonSign'
  | 'exitSign'
  // decor
  | 'rug'
  | 'pottedPlant'
  | 'vase'
  | 'clock'
  | 'tvStand'
  | 'curtain';

export type PropKind = BuiltinPropKind | ImportedPropKind;

// How a prop governs vehicle traffic. 'none' props are scenery; 'stopSign' is
// always a hard stop; 'signal' free-runs a green→caution→stop cycle (the
// traffic light). The traffic system turns this into a live phase that NPC
// vehicle pathing reads to decide whether to yield at a junction — part of the
// locked road grammar's right-of-way layer (signals gate the junction box at
// runtime, never in the path graph).
export type PropTrafficControl = 'none' | 'stopSign' | 'signal';

export type PropKindDefinition = {
  kind: PropKind;
  label: string;
  // Whether the player (and vehicles) collide with it. Solid props add a small
  // blocking footprint to host physics; non-solid props (bushes) you walk into.
  solid: boolean;
  // Collision half-extent in meters around the ground anchor. Drives the host
  // physics blocking rect AND the model's base width, so they never drift.
  // For a NON-solid prop it is not collision — it sizes the concealment query.
  footprintRadiusMeters: number;
  // Optional rectangular footprint for props whose local X/Z extents are not
  // square. When present, physics/placement use this yaw-aware rectangle and
  // `footprintRadiusMeters` remains the coarse reach/concealment fallback.
  footprintWidthMeters?: number;
  footprintDepthMeters?: number;
  // Visual top in meters above the ground anchor — the prop's full height,
  // used by the model and as a scale reference. 1 tile = 1 meter.
  heightMeters: number;
  // The tile kind whose gameplay property bundle this prop borrows.
  tileKind: TileKind;
  trafficControl: PropTrafficControl;
  // Present = this prop is a DYNAMIC body, not static scenery: placed, it
  // becomes a host physics sphere the player kicks around by running into it
  // (KICKPROP-0610). Dynamic props contribute NO static blocking rect.
  dynamics?: PropDynamics;
  // PROPUSE-0610: the interaction bundle (all optional — plain scenery omits
  // everything). See the types below; helpers propMount/propSeat/propContainer/
  // propCoverClass resolve defaults.
  mount?: PropMount;
  seat?: PropSeat;
  container?: PropContainer;
  coverClass?: PropCoverClass;
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

// ── PROPUSE-0610: the interaction bundle — what a prop IS to gameplay ────────
// The user's taxonomy, as data: containers can be searched, seats can be sat
// in, soft cover hides you, hard cover blocks bullets/LoS, trash/utility
// objects hold junk, appliances hold category-appropriate loot. Street objects
// already affect movement through collision + dynamics; their perception hooks
// (noise on bump, light pools) ride the tile bundle and the perception system
// when those integrate. ITEMS ARE NOT BUILT YET — lootCategory names the slot
// the item system fills next; the schema (capacity, spawn rate, access) is
// authored NOW so containers don't need a second pass.

/** Where a prop may be placed: on the ground, on a piece's top face (a
 *  computer on a table), or against a wall (paintings, mirrors, LED strips). */
export type PropMount = 'floor' | 'surface' | 'wall';

/** A sit/lay anchor, resolved against the figure skeleton's posture actions
 *  ('sit' / 'lay' on body/torso — game/figure/skeleton.ts already poses them). */
export type PropSeat = {
  pose: 'sit' | 'lay';
  /** where the pelvis lands, meters above the prop's ground anchor */
  seatHeightMeters: number;
  /** how many figures fit (chair 1, couch/bench 3, double bed 2) */
  capacity: number;
};

/** The loot slot a container fills when the item system lands (next in line). */
export type PropLootCategory = 'junk' | 'kitchen' | 'bathroom' | 'clothing' | 'office' | 'valuables' | 'tools';

/** Can it be opened at all? 'locked' = pickable/forceable; 'keyed' = needs its key (safes, mailboxes). */
export type PropContainerAccess = 'open' | 'locked' | 'keyed';

/** A searchable container. Searching is a simple loading bar (searchSeconds). */
export type PropContainer = {
  lootCategory: PropLootCategory;
  /** item slots */
  capacity: number;
  /** 0..1 chance per slot to spawn filled */
  spawnFillChance: number;
  /** the search loading bar, in seconds */
  searchSeconds: number;
  access: PropContainerAccess;
};

/** How a prop reads to combat/stealth: soft = conceals you (shoot-through),
 *  hard = blocks bullets and line of sight. Feeds the coverFraction/exposure
 *  contracts (game/chance.ts, game/perception.ts). */
export type PropCoverClass = 'none' | 'soft' | 'hard';

export function propMount(kind: PropKind): PropMount {
  return PROP_KIND_DEFINITIONS[kind].mount ?? 'floor';
}

export function propSeat(kind: PropKind): PropSeat | null {
  return PROP_KIND_DEFINITIONS[kind].seat ?? null;
}

export function propContainer(kind: PropKind): PropContainer | null {
  return PROP_KIND_DEFINITIONS[kind].container ?? null;
}

/** Authored class wins; otherwise derive: foliage conceals (soft), a solid
 *  prop at least chest height blocks (hard), everything else is open air. */
export function propCoverClass(kind: PropKind): PropCoverClass {
  const def = PROP_KIND_DEFINITIONS[kind];
  if (def.coverClass) return def.coverClass;
  if (def.tileKind === 'bush') return 'soft';
  if (def.solid && def.heightMeters >= 0.9) return 'hard';
  return 'none';
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
  fireHydrant: fireHydrantDef,
  streetSign: streetSignDef,
  streetLight: streetLightDef,
  bush: {
    kind: 'bush',
    label: 'Bush',
    // Non-solid: the GTA shrub you walk straight through. A BIG hide-in bush —
    // taller than the player so standing inside it conceals you. The radius is
    // its canopy half-width, sizing the concealment query only (no physics rect).
    solid: false,
    footprintRadiusMeters: 1.2,
    heightMeters: 2.5,
    tileKind: 'bush',
    trafficControl: 'none',
  },
  bushLarge: {
    kind: 'bushLarge',
    // A MASSIVE bush — taller than a two-storey building. Same walk-through
    // foliage, just enormous: you can lose a whole car in it.
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
  stopSign: stopSignDef,
  trafficLight: trafficLightDef,
  payphone: payphoneDef,
  dumpster: {
    kind: 'dumpster',
    label: 'Dumpster',
    solid: true,
    // PROPSCALE-0611: real 4-yd front-load (1.83w × 1.37h × 1.37d) × 1.15
    footprintRadiusMeters: 0.9,
    heightMeters: 1.57,
    tileKind: 'wall',
    trafficControl: 'none',
    container: { lootCategory: 'junk', capacity: 6, spawnFillChance: 0.7, searchSeconds: 4, access: 'open' },
  },
  mailbox: mailboxDef,
  fence: fenceDef,

  // ── street furniture ──────────────────────────────────────────────────────
  trafficCone: trafficConeDef,
  barrier: barrierDef,
  trashCan: trashCanDef,
  bench: benchDef,
  planter: planterDef,

  // ── trees ──────────────────────────────────────────────────────────────────
  // footprintRadius is the TRUNK, not the canopy — you bump the trunk and walk
  // under the foliage edge, like every GTA tree. PROPSCALE-0611: heights are
  // real urban-mature averages × 1.15 (were ~half real size); trunks
  // thickened ~×1.4 to match.
  treeOak: treeOakDef,
  treePine: treePineDef,
  treeBirch: treeBirchDef,
  treeCypress: treeCypressDef,
  treePalm: treePalmDef,
  treeDead: treeDeadDef,

  // ── rock forms ─────────────────────────────────────────────────────────────
  boulder: boulderDef,
  rockFlat: rockFlatDef,
  rockSpire: rockSpireDef,
  rockMossy: rockMossyDef,
  rockPile: rockPileDef,

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
    // PROPSCALE-0611: regulation size-5 (Ø0.22m) × 1.15
    footprintRadiusMeters: 0.125,
    heightMeters: 0.25,
    tileKind: 'wall',
    trafficControl: 'none',
    dynamics: { bodyRadiusMeters: 0.125, restitution: 0.65 },
  },
  ballBasketball: {
    kind: 'ballBasketball',
    label: 'Basketball',
    solid: true,
    // PROPSCALE-0611: regulation size-7 (Ø0.24m) × 1.15
    footprintRadiusMeters: 0.14,
    heightMeters: 0.28,
    tileKind: 'wall',
    trafficControl: 'none',
    dynamics: { bodyRadiusMeters: 0.14, restitution: 0.78 },
  },

  // ── wall decor ─────────────────────────────────────────────────────────────
  // Anchored at the wall base; the decor hangs at height in the model. The
  // thin solid footprint sits flush against the wall it mounts on.
  wallPainting: {
    kind: 'wallPainting',
    label: 'Wall Painting',
    solid: true,
    footprintRadiusMeters: 0.08,
    footprintDepthMeters: 0.16,
    heightMeters: 2.1,
    tileKind: 'wall',
    trafficControl: 'none',
    mount: 'wall',
    coverClass: 'none',
  },
  ledLight: {
    kind: 'ledLight',
    label: 'LED Light',
    solid: true,
    footprintRadiusMeters: 0.06,
    footprintDepthMeters: 0.12,
    heightMeters: 2.4,
    tileKind: 'wall',
    trafficControl: 'none',
    mount: 'wall',
    coverClass: 'none',
  },

  // ── furniture ──────────────────────────────────────────────────────────────
  // Chairs own their data in their own files (the file with the most data owns
  // it) — see compile/propRecipes/<chair>.ts. This registry just collects them.
  diningChair: diningChairDef,
  couch: {
    kind: 'couch',
    label: 'Couch',
    // Long like a fence segment — yaw-aware thin AABB in the world props layer.
    solid: true,
    footprintRadiusMeters: 0.95,
    footprintDepthMeters: 0.9,
    heightMeters: 0.85,
    tileKind: 'wall',
    trafficControl: 'none',
    seat: { pose: 'sit', seatHeightMeters: 0.4, capacity: 3 },
    coverClass: 'soft',
  },
  table: {
    kind: 'table',
    label: 'Table',
    solid: true,
    footprintRadiusMeters: 0.6,
    heightMeters: 0.78,
    tileKind: 'wall',
    trafficControl: 'none',
    coverClass: 'soft',
  },
  floorLamp: {
    kind: 'floorLamp',
    label: 'Floor Lamp',
    solid: true,
    footprintRadiusMeters: 0.2,
    heightMeters: 1.7,
    tileKind: 'wall',
    trafficControl: 'none',
    coverClass: 'none',
  },
  // Chair TYPES (color is a skin, not a kind id) — each owns its data in its file.
  armchair: armchairDef,
  officeChair: officeChairDef,
  foldingChair: foldingChairDef,

  // ── household (bedroom / kitchen / bathroom) ───────────────────────────────
  bedSingle: {
    kind: 'bedSingle',
    label: 'Single Bed',
    // 2.1m long along local X, 1.0m wide — yaw-aware thin AABB in world props.
    solid: true,
    footprintRadiusMeters: 1.05,
    footprintDepthMeters: 1.0,
    heightMeters: 0.9,
    tileKind: 'wall',
    trafficControl: 'none',
    seat: { pose: 'lay', seatHeightMeters: 0.48, capacity: 1 },
    coverClass: 'soft',
  },
  bedDouble: {
    kind: 'bedDouble',
    label: 'Double Bed',
    // 2.1m long along local X, 1.5m wide — yaw-aware thin AABB in world props.
    solid: true,
    footprintRadiusMeters: 1.05,
    footprintDepthMeters: 1.5,
    heightMeters: 0.95,
    tileKind: 'wall',
    trafficControl: 'none',
    seat: { pose: 'lay', seatHeightMeters: 0.48, capacity: 2 },
    coverClass: 'soft',
  },
  cupboard: {
    kind: 'cupboard',
    label: 'Cupboard',
    // 1.0m wide, 0.5m deep — yaw-aware thin AABB in world props.
    solid: true,
    footprintRadiusMeters: 0.5,
    footprintDepthMeters: 0.5,
    heightMeters: 1.9,
    tileKind: 'wall',
    trafficControl: 'none',
    container: { lootCategory: 'clothing', capacity: 4, spawnFillChance: 0.6, searchSeconds: 3, access: 'open' },
  },
  mirror: {
    kind: 'mirror',
    label: 'Mirror',
    // Wall decor: anchor at the wall base, the glass hangs at height.
    solid: true,
    footprintRadiusMeters: 0.06,
    footprintDepthMeters: 0.12,
    heightMeters: 1.9,
    tileKind: 'wall',
    trafficControl: 'none',
    mount: 'wall',
    coverClass: 'none',
  },
  sink: {
    kind: 'sink',
    label: 'Sink',
    solid: true,
    footprintRadiusMeters: 0.3,
    footprintDepthMeters: 0.5,
    heightMeters: 0.9,
    tileKind: 'wall',
    trafficControl: 'none',
    container: { lootCategory: 'bathroom', capacity: 2, spawnFillChance: 0.3, searchSeconds: 2, access: 'open' },
    coverClass: 'soft',
  },
  oven: {
    kind: 'oven',
    label: 'Oven',
    solid: true,
    footprintRadiusMeters: 0.35,
    footprintDepthMeters: 0.62,
    heightMeters: 0.95,
    tileKind: 'wall',
    trafficControl: 'none',
    container: { lootCategory: 'kitchen', capacity: 2, spawnFillChance: 0.35, searchSeconds: 2.5, access: 'open' },
  },
  fridge: {
    kind: 'fridge',
    label: 'Fridge',
    solid: true,
    footprintRadiusMeters: 0.4,
    footprintDepthMeters: 0.72,
    heightMeters: 1.9,
    tileKind: 'wall',
    trafficControl: 'none',
    container: { lootCategory: 'kitchen', capacity: 5, spawnFillChance: 0.7, searchSeconds: 3, access: 'open' },
  },
  computer: {
    kind: 'computer',
    label: 'Computer',
    // A desktop setup (monitor + keyboard + tower) at its anchor.
    solid: true,
    footprintRadiusMeters: 0.3,
    heightMeters: 0.55,
    tileKind: 'wall',
    trafficControl: 'none',
    container: { lootCategory: 'office', capacity: 1, spawnFillChance: 0.5, searchSeconds: 3, access: 'open' },
    mount: 'surface',
  },

  // ── utility + sport ────────────────────────────────────────────────────────
  telephonePole: {
    kind: 'telephonePole',
    label: 'Telephone Pole',
    solid: true,
    footprintRadiusMeters: 0.16,
    // PROPSCALE-0611: real ~8.8m above ground × 1.15
    heightMeters: 10.1,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  basketballHoop: {
    kind: 'basketballHoop',
    label: 'Basketball Hoop',
    // Street hoop: pole + backboard + rim at 3.5m (regulation 3.05 × 1.15).
    solid: true,
    footprintRadiusMeters: 0.25,
    // PROPSCALE-0611: real backboard top ~3.95m × 1.15
    heightMeters: 4.5,
    tileKind: 'wall',
    trafficControl: 'none',
  },

  // ── PROPBATCH-0611 (req_0633 image set + named list, req_0634 grass,
  //    req_0635 image-flats). Real scale × 1.15 — the PROPSCALE presence law.
  //    Models are DATA (game/kinds/propModels.ts), rendered identically by
  //    /test's DataProp and the compile bake. ────────────────────────────────
  grassPatch: {
    kind: 'grassPatch',
    label: 'Grass Patch',
    // Walk-through ground foliage — too low to hide in (no concealment read).
    solid: false,
    footprintRadiusMeters: 0.7,
    heightMeters: 0.3,
    tileKind: 'bush',
    trafficControl: 'none',
    coverClass: 'none',
  },
  grassTall: {
    kind: 'grassTall',
    label: 'Tall Grass',
    // Waist-to-chest savanna grass — crouch in it and the bush tile conceals.
    solid: false,
    footprintRadiusMeters: 0.9,
    heightMeters: 1.0,
    tileKind: 'bush',
    trafficControl: 'none',
    coverClass: 'soft',
  },
  rockJagged: {
    kind: 'rockJagged',
    label: 'Jagged Rock',
    solid: true,
    footprintRadiusMeters: 0.7,
    heightMeters: 1.4,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  rockShard: {
    kind: 'rockShard',
    label: 'Rock Shard',
    solid: true,
    footprintRadiusMeters: 0.45,
    heightMeters: 2.6,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  // Tree size variants — same species models, different registry scale (the
  // tree recipes derive everything from height/footprint).
  treeOakYoung: {
    kind: 'treeOakYoung',
    label: 'Young Oak',
    solid: true,
    footprintRadiusMeters: 0.32,
    heightMeters: 9,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  treeOakGiant: {
    kind: 'treeOakGiant',
    label: 'Giant Oak',
    solid: true,
    footprintRadiusMeters: 0.8,
    heightMeters: 25,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  treePineYoung: {
    kind: 'treePineYoung',
    label: 'Young Pine',
    solid: true,
    footprintRadiusMeters: 0.24,
    heightMeters: 11,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  treePineGiant: {
    kind: 'treePineGiant',
    label: 'Giant Pine',
    solid: true,
    footprintRadiusMeters: 0.6,
    heightMeters: 32,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  radioTower: {
    kind: 'radioTower',
    label: 'Radio Tower',
    // Real small-market lattice tower ~30m × 1.15. The footprint is the leg
    // square's half-width.
    solid: true,
    footprintRadiusMeters: 2.2,
    heightMeters: 34,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  gasPump: {
    kind: 'gasPump',
    label: 'Gas Pump',
    // Real island pump ~1.8m × 1.15.
    solid: true,
    footprintRadiusMeters: 0.42,
    heightMeters: 2.1,
    tileKind: 'wall',
    trafficControl: 'none',
    coverClass: 'hard',
  },
  vendingMachine: {
    kind: 'vendingMachine',
    label: 'Vending Machine',
    // Real ~1.83m × 1.15. The front panel is an image target (partId 'front').
    solid: true,
    footprintRadiusMeters: 0.5,
    heightMeters: 2.1,
    tileKind: 'wall',
    trafficControl: 'none',
    container: { lootCategory: 'kitchen', capacity: 3, spawnFillChance: 0.5, searchSeconds: 3, access: 'locked' },
    coverClass: 'hard',
  },
  storeShelf: {
    kind: 'storeShelf',
    label: 'Store Shelf',
    // A gondola run, long like a fence — yaw-aware thin AABB in world props.
    solid: true,
    footprintRadiusMeters: 0.95,
    heightMeters: 1.9,
    tileKind: 'wall',
    trafficControl: 'none',
    container: { lootCategory: 'kitchen', capacity: 6, spawnFillChance: 0.65, searchSeconds: 3, access: 'open' },
  },
  businessSign: {
    kind: 'businessSign',
    label: 'A-Frame Sign',
    // The sidewalk sandwich board in front of a business; face takes an image.
    solid: true,
    footprintRadiusMeters: 0.35,
    heightMeters: 1.1,
    tileKind: 'wall',
    trafficControl: 'none',
    coverClass: 'none',
  },
  shopSign: {
    kind: 'shopSign',
    label: 'Shop Blade Sign',
    // Wall-mounted bracket sign hanging over the sidewalk; face takes an image.
    solid: true,
    footprintRadiusMeters: 0.1,
    heightMeters: 3.0,
    tileKind: 'wall',
    trafficControl: 'none',
    mount: 'wall',
    coverClass: 'none',
  },
  poster: {
    kind: 'poster',
    label: 'Poster',
    // The req_0635 flat: a wall sheet whose face takes any image.
    solid: true,
    footprintRadiusMeters: 0.05,
    heightMeters: 2.3,
    tileKind: 'wall',
    trafficControl: 'none',
    mount: 'wall',
    coverClass: 'none',
  },
  hospitalSign: {
    kind: 'hospitalSign',
    label: 'Hospital Sign',
    // The building-identity prop: bolt it to any structure and it reads as a
    // hospital (white panel + red cross).
    solid: true,
    footprintRadiusMeters: 0.12,
    heightMeters: 3.2,
    tileKind: 'wall',
    trafficControl: 'none',
    mount: 'wall',
    coverClass: 'none',
  },
  policeSign: {
    kind: 'policeSign',
    label: 'Police Sign',
    solid: true,
    footprintRadiusMeters: 0.12,
    heightMeters: 3.2,
    tileKind: 'wall',
    trafficControl: 'none',
    mount: 'wall',
    coverClass: 'none',
  },
  bookStack: {
    kind: 'bookStack',
    label: 'Books',
    solid: false,
    footprintRadiusMeters: 0.18,
    heightMeters: 0.38,
    tileKind: 'wall',
    trafficControl: 'none',
    mount: 'surface',
  },
  recordPlayer: {
    kind: 'recordPlayer',
    label: 'Record Player',
    solid: false,
    footprintRadiusMeters: 0.26,
    heightMeters: 0.21,
    tileKind: 'wall',
    trafficControl: 'none',
    mount: 'surface',
  },
  vinylRecord: {
    kind: 'vinylRecord',
    label: 'Vinyl Record',
    solid: false,
    footprintRadiusMeters: 0.18,
    heightMeters: 0.04,
    tileKind: 'wall',
    trafficControl: 'none',
    mount: 'surface',
  },
  albumCover: {
    kind: 'albumCover',
    label: 'Album Cover',
    // A standing record sleeve; the cover is an image target (req_0635).
    solid: false,
    footprintRadiusMeters: 0.19,
    heightMeters: 0.37,
    tileKind: 'wall',
    trafficControl: 'none',
    mount: 'surface',
  },
  speaker: {
    kind: 'speaker',
    label: 'Speaker',
    solid: true,
    footprintRadiusMeters: 0.22,
    heightMeters: 1.15,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  speakerStack: {
    kind: 'speakerStack',
    label: 'PA Speaker Stack',
    solid: true,
    footprintRadiusMeters: 0.46,
    heightMeters: 1.9,
    tileKind: 'wall',
    trafficControl: 'none',
    coverClass: 'hard',
  },
  cassette: {
    kind: 'cassette',
    label: 'Cassette',
    solid: false,
    footprintRadiusMeters: 0.06,
    heightMeters: 0.02,
    tileKind: 'wall',
    trafficControl: 'none',
    mount: 'surface',
  },
  shippingContainer: {
    kind: 'shippingContainer',
    label: 'Shipping Container',
    // Real 20ft box (6.06 × 2.44 × 2.59) × 1.15. Long — yaw-aware thin AABB.
    solid: true,
    footprintRadiusMeters: 3.5,
    heightMeters: 3.0,
    tileKind: 'wall',
    trafficControl: 'none',
    container: { lootCategory: 'tools', capacity: 8, spawnFillChance: 0.6, searchSeconds: 5, access: 'locked' },
    coverClass: 'hard',
  },
  concretePipe: {
    kind: 'concretePipe',
    label: 'Concrete Pipe',
    // A lying Ø1.4 culvert section; spans local X (yaw-aware AABB).
    solid: true,
    footprintRadiusMeters: 1.3,
    heightMeters: 1.6,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  pipeStack: {
    kind: 'pipeStack',
    label: 'Pipe Stack',
    // A pyramid of steel pipes lying along local X (yaw-aware AABB).
    solid: true,
    footprintRadiusMeters: 1.75,
    heightMeters: 1.0,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  corrugatedSheet: {
    kind: 'corrugatedSheet',
    label: 'Corrugated Sheet',
    // A leaning zinc sheet; thin span along local X (yaw-aware AABB).
    solid: true,
    footprintRadiusMeters: 1.0,
    heightMeters: 2.3,
    tileKind: 'wall',
    trafficControl: 'none',
    coverClass: 'hard',
  },
  cableSpool: {
    kind: 'cableSpool',
    label: 'Cable Spool',
    // The wooden spool — street furniture's free table; you can sit on it.
    solid: true,
    footprintRadiusMeters: 0.8,
    heightMeters: 0.95,
    tileKind: 'wall',
    trafficControl: 'none',
    seat: { pose: 'sit', seatHeightMeters: 0.95, capacity: 2 },
  },
  lockerSet: {
    kind: 'lockerSet',
    label: 'Lockers',
    solid: true,
    footprintRadiusMeters: 0.45,
    heightMeters: 2.1,
    tileKind: 'wall',
    trafficControl: 'none',
    container: { lootCategory: 'clothing', capacity: 4, spawnFillChance: 0.5, searchSeconds: 3, access: 'locked' },
  },
  oilTank: {
    kind: 'oilTank',
    label: 'Oil Tank',
    // A horizontal farm/fuel tank on cradles; spans local X (yaw-aware AABB).
    solid: true,
    footprintRadiusMeters: 2.3,
    heightMeters: 2.4,
    tileKind: 'wall',
    trafficControl: 'none',
    coverClass: 'hard',
  },
  tire: {
    kind: 'tire',
    label: 'Tire',
    // A standing car tire (Ø0.66 × 1.15) — it rolls when kicked.
    solid: true,
    footprintRadiusMeters: 0.38,
    heightMeters: 0.76,
    tileKind: 'wall',
    trafficControl: 'none',
    dynamics: { bodyRadiusMeters: 0.38, restitution: 0.45 },
  },
  tireStack: {
    kind: 'tireStack',
    label: 'Tire Stack',
    solid: true,
    footprintRadiusMeters: 0.45,
    heightMeters: 1.0,
    tileKind: 'wall',
    trafficControl: 'none',
    coverClass: 'soft',
  },
  barrel: {
    kind: 'barrel',
    label: 'Wooden Barrel',
    solid: true,
    footprintRadiusMeters: 0.36,
    heightMeters: 1.0,
    tileKind: 'wall',
    trafficControl: 'none',
    container: { lootCategory: 'junk', capacity: 3, spawnFillChance: 0.5, searchSeconds: 2.5, access: 'open' },
    coverClass: 'soft',
  },
  steelDrum: {
    kind: 'steelDrum',
    label: 'Steel Drum',
    // The rusty 55-gal drum — heavy but it topples and rolls when shoved.
    solid: true,
    footprintRadiusMeters: 0.32,
    heightMeters: 1.0,
    tileKind: 'wall',
    trafficControl: 'none',
    dynamics: { bodyRadiusMeters: 0.42, restitution: 0.18 },
  },
  propaneTank: {
    kind: 'propaneTank',
    label: 'Propane Tank',
    solid: true,
    footprintRadiusMeters: 0.24,
    heightMeters: 0.7,
    tileKind: 'wall',
    trafficControl: 'none',
    dynamics: { bodyRadiusMeters: 0.28, restitution: 0.32 },
  },
  jerryCan: {
    kind: 'jerryCan',
    label: 'Jerry Can',
    solid: true,
    footprintRadiusMeters: 0.19,
    heightMeters: 0.54,
    tileKind: 'wall',
    trafficControl: 'none',
    dynamics: { bodyRadiusMeters: 0.22, restitution: 0.15 },
  },
  cinderBlock: {
    kind: 'cinderBlock',
    label: 'Cinder Block',
    solid: true,
    footprintRadiusMeters: 0.22,
    heightMeters: 0.23,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  brick: {
    kind: 'brick',
    label: 'Brick',
    // Kickable street litter — tiny sphere body, near-dead bounce.
    solid: true,
    footprintRadiusMeters: 0.12,
    heightMeters: 0.08,
    tileKind: 'wall',
    trafficControl: 'none',
    dynamics: { bodyRadiusMeters: 0.1, restitution: 0.12 },
  },
  rubblePile: {
    kind: 'rubblePile',
    label: 'Rubble Pile',
    solid: true,
    footprintRadiusMeters: 0.8,
    heightMeters: 0.55,
    tileKind: 'wall',
    trafficControl: 'none',
    coverClass: 'soft',
  },
  crate: {
    kind: 'crate',
    label: 'Wooden Crate',
    solid: true,
    footprintRadiusMeters: 0.35,
    heightMeters: 0.65,
    tileKind: 'wall',
    trafficControl: 'none',
    container: { lootCategory: 'tools', capacity: 3, spawnFillChance: 0.55, searchSeconds: 2.5, access: 'open' },
  },
  pallet: {
    kind: 'pallet',
    label: 'Pallet',
    solid: true,
    footprintRadiusMeters: 0.65,
    heightMeters: 0.16,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  palletStack: {
    kind: 'palletStack',
    label: 'Pallet Stack',
    solid: true,
    footprintRadiusMeters: 0.65,
    heightMeters: 1.05,
    tileKind: 'wall',
    trafficControl: 'none',
    coverClass: 'soft',
  },
  toiletPaper: {
    kind: 'toiletPaper',
    label: 'Toilet Paper',
    solid: false,
    footprintRadiusMeters: 0.1,
    heightMeters: 0.78,
    tileKind: 'wall',
    trafficControl: 'none',
    mount: 'wall',
    coverClass: 'none',
  },

  // ── PROPVENUE-0611 (req_0640): parks + shop interiors. Real scale × 1.15. ──
  fountain: {
    kind: 'fountain',
    label: 'Plaza Fountain',
    // A round plaza fountain — basin, pedestal, upper bowl, jet. You can sit
    // on the basin edge like every city park.
    solid: true,
    footprintRadiusMeters: 1.8,
    heightMeters: 2.2,
    tileKind: 'wall',
    trafficControl: 'none',
    seat: { pose: 'sit', seatHeightMeters: 0.55, capacity: 3 },
  },
  drinkingFountain: {
    kind: 'drinkingFountain',
    label: 'Drinking Fountain',
    solid: true,
    footprintRadiusMeters: 0.2,
    heightMeters: 1.0,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  loungeChair: {
    kind: 'loungeChair',
    label: 'Lounge Chair',
    // The pool/beach lounger — long like a bed (yaw-aware thin AABB).
    solid: true,
    footprintRadiusMeters: 0.95,
    heightMeters: 0.8,
    tileKind: 'wall',
    trafficControl: 'none',
    seat: { pose: 'lay', seatHeightMeters: 0.38, capacity: 1 },
    coverClass: 'soft',
  },
  swingset: {
    kind: 'swingset',
    label: 'Swing Set',
    // Static A-frame with two hanging seats for now; the seats are sittable.
    // PHYSICS OPPORTUNITY (user, req_0640): swinging is a future dynamics
    // slice — the chain/seat pendulum wants the entity body system once
    // constrained bodies exist (today's bodies are free spheres only).
    solid: true,
    footprintRadiusMeters: 1.9,
    heightMeters: 2.5,
    tileKind: 'wall',
    trafficControl: 'none',
    seat: { pose: 'sit', seatHeightMeters: 0.55, capacity: 2 },
  },
  sandCastle: {
    kind: 'sandCastle',
    label: 'Sand Castle',
    solid: true,
    footprintRadiusMeters: 0.4,
    heightMeters: 0.5,
    tileKind: 'wall',
    trafficControl: 'none',
    coverClass: 'none',
  },
  picketFence: {
    kind: 'picketFence',
    label: 'Picket Fence',
    // A white 2.5m garden segment — same yaw-aware thin AABB as 'fence'.
    solid: true,
    footprintRadiusMeters: 1.35,
    heightMeters: 1.1,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  appleTree: {
    kind: 'appleTree',
    label: 'Apple Tree',
    // Orchard scale (~5.5m × 1.15), apples visible in the canopy. The DROP —
    // apples detaching as live bodies over time — is a future spawn slice;
    // today you place 'apple' props under it and they roll/kick like balls
    // (and become throwable/eatable when the item system lands, user ask).
    solid: true,
    footprintRadiusMeters: 0.35,
    heightMeters: 6.5,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  apple: {
    kind: 'apple',
    label: 'Apple',
    // Acts like a ball (user ask req_0640): tiny sphere body, modest bounce.
    // Future: throwable / eatable once items exist.
    solid: true,
    footprintRadiusMeters: 0.05,
    heightMeters: 0.09,
    tileKind: 'wall',
    trafficControl: 'none',
    dynamics: { bodyRadiusMeters: 0.06, restitution: 0.35 },
  },
  arcadeCabinet: {
    kind: 'arcadeCabinet',
    label: 'Arcade Cabinet',
    // Real upright cab ~1.75m × 1.15. The screen takes an image (partId
    // 'screen') so any art becomes the game on the marquee glass.
    solid: true,
    footprintRadiusMeters: 0.38,
    heightMeters: 2.0,
    tileKind: 'wall',
    trafficControl: 'none',
    coverClass: 'hard',
  },
  slotMachine: {
    kind: 'slotMachine',
    label: 'Slot Machine',
    solid: true,
    footprintRadiusMeters: 0.3,
    heightMeters: 1.45,
    tileKind: 'wall',
    trafficControl: 'none',
    container: { lootCategory: 'valuables', capacity: 2, spawnFillChance: 0.4, searchSeconds: 3, access: 'locked' },
  },
  clothingRack: {
    kind: 'clothingRack',
    label: 'Clothing Rack',
    solid: true,
    footprintRadiusMeters: 0.7,
    heightMeters: 1.6,
    tileKind: 'wall',
    trafficControl: 'none',
    container: { lootCategory: 'clothing', capacity: 4, spawnFillChance: 0.7, searchSeconds: 2.5, access: 'open' },
    coverClass: 'soft',
  },
  displayCase: {
    kind: 'displayCase',
    label: 'Display Case',
    // The glass counter case (dispensary/jewelry/pawn) — valuables, locked.
    solid: true,
    footprintRadiusMeters: 0.6,
    heightMeters: 1.0,
    tileKind: 'wall',
    trafficControl: 'none',
    container: { lootCategory: 'valuables', capacity: 3, spawnFillChance: 0.5, searchSeconds: 3, access: 'locked' },
  },
  liquorShelf: {
    kind: 'liquorShelf',
    label: 'Liquor Shelf',
    solid: true,
    footprintRadiusMeters: 0.9,
    heightMeters: 2.0,
    tileKind: 'wall',
    trafficControl: 'none',
    container: { lootCategory: 'kitchen', capacity: 5, spawnFillChance: 0.7, searchSeconds: 2.5, access: 'open' },
  },
  beerCase: {
    kind: 'beerCase',
    label: 'Beer Cases',
    solid: true,
    footprintRadiusMeters: 0.25,
    heightMeters: 0.55,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  dinerBooth: {
    kind: 'dinerBooth',
    label: 'Diner Booth',
    // Two facing vinyl benches + the table — one seat each side.
    solid: true,
    footprintRadiusMeters: 0.8,
    heightMeters: 1.35,
    tileKind: 'wall',
    trafficControl: 'none',
    seat: { pose: 'sit', seatHeightMeters: 0.45, capacity: 2 },
    coverClass: 'soft',
  },
  orderCounter: {
    kind: 'orderCounter',
    label: 'Order Counter',
    solid: true,
    footprintRadiusMeters: 0.9,
    heightMeters: 1.16,
    tileKind: 'wall',
    trafficControl: 'none',
    container: { lootCategory: 'valuables', capacity: 2, spawnFillChance: 0.5, searchSeconds: 3, access: 'locked' },
  },
  menuBoard: {
    kind: 'menuBoard',
    label: 'Menu Board',
    // Wall board over the counter; the face takes an image (the menu).
    solid: true,
    footprintRadiusMeters: 0.08,
    heightMeters: 2.6,
    tileKind: 'wall',
    trafficControl: 'none',
    mount: 'wall',
    coverClass: 'none',
  },
  sodaMachine: {
    kind: 'sodaMachine',
    label: 'Soda Machine',
    solid: true,
    footprintRadiusMeters: 0.35,
    heightMeters: 1.7,
    tileKind: 'wall',
    trafficControl: 'none',
  },
  openSign: {
    kind: 'openSign',
    label: 'OPEN Sign',
    // The neon window sign every storefront wants — liquor, dispensary, diner.
    solid: true,
    footprintRadiusMeters: 0.06,
    heightMeters: 2.2,
    tileKind: 'wall',
    trafficControl: 'none',
    mount: 'wall',
    coverClass: 'none',
  },
  greenCrossSign: {
    kind: 'greenCrossSign',
    label: 'Green Cross Sign',
    // The dispensary/pharmacy green cross — the policeSign/hospitalSign family.
    solid: true,
    footprintRadiusMeters: 0.1,
    heightMeters: 2.8,
    tileKind: 'wall',
    trafficControl: 'none',
    mount: 'wall',
    coverClass: 'none',
  },
  ...IMPORTED_PROP_DEFINITIONS,
};

export const PROP_KINDS = Object.keys(PROP_KIND_DEFINITIONS) as PropKind[];

// ── categories: how pickers SHELVE the kinds (PROPSHELF-0611, req_0636) ──────
// One registered table, category → kinds. With ~100 kinds a flat button wall
// is unusable ("the millions of buttons is insane"); every palette renders a
// category row first, then only that shelf's kinds. A kind lives on EXACTLY
// one shelf (props.test.ts asserts the partition is total and disjoint).
export type PropCategory =
  | 'nature' | 'trees' | 'rocks' | 'street' | 'signs' | 'furniture'
  | 'household' | 'media' | 'commerce' | 'junkyard' | 'sport'
  | 'park' | 'shops' | 'imported';

export const PROP_CATEGORIES: Record<PropCategory, PropKind[]> = {
  nature: ['bush', 'bushLarge', 'bushLow', 'bushSparse', 'grassPatch', 'grassTall'],
  trees: ['treeOak', 'treeOakYoung', 'treeOakGiant', 'treePine', 'treePineYoung', 'treePineGiant', 'treeBirch', 'treeCypress', 'treePalm', 'treeDead'],
  rocks: ['rock', 'rockLarge', 'rockSmall', 'boulder', 'rockFlat', 'rockSpire', 'rockMossy', 'rockPile', 'rockJagged', 'rockShard'],
  street: ['fireHydrant', 'streetLight', 'payphone', 'mailbox', 'dumpster', 'fence', 'trafficCone', 'barrier', 'trashCan', 'bench', 'planter', 'telephonePole'],
  signs: ['streetSign', 'stopSign', 'trafficLight', 'businessSign', 'shopSign', 'poster', 'hospitalSign', 'policeSign'],
  furniture: ['diningChair', 'armchair', 'officeChair', 'foldingChair', 'couch', 'table', 'floorLamp', 'wallPainting', 'ledLight', 'mirror'],
  household: ['bedSingle', 'bedDouble', 'cupboard', 'sink', 'oven', 'fridge', 'computer', 'toiletPaper'],
  media: ['bookStack', 'recordPlayer', 'vinylRecord', 'albumCover', 'cassette', 'speaker', 'speakerStack'],
  commerce: ['vendingMachine', 'gasPump', 'storeShelf', 'crate', 'pallet', 'palletStack'],
  junkyard: ['shippingContainer', 'concretePipe', 'pipeStack', 'corrugatedSheet', 'cableSpool', 'lockerSet', 'oilTank', 'tire', 'tireStack', 'barrel', 'steelDrum', 'propaneTank', 'jerryCan', 'cinderBlock', 'brick', 'rubblePile', 'radioTower'],
  sport: ['ballBeach', 'ballSoccer', 'ballBasketball', 'basketballHoop'],
  park: ['fountain', 'drinkingFountain', 'loungeChair', 'swingset', 'sandCastle', 'picketFence', 'appleTree', 'apple'],
  shops: ['arcadeCabinet', 'slotMachine', 'clothingRack', 'displayCase', 'liquorShelf', 'beerCase', 'dinerBooth', 'orderCounter', 'menuBoard', 'sodaMachine', 'openSign', 'greenCrossSign'],
  imported: [...IMPORTED_PROP_KINDS],
};

export const PROP_CATEGORY_NAMES = Object.keys(PROP_CATEGORIES) as PropCategory[];

const CATEGORY_BY_KIND: Record<string, PropCategory> = {};
for (const cat of PROP_CATEGORY_NAMES) for (const k of PROP_CATEGORIES[cat]) CATEGORY_BY_KIND[k] = cat;

/** The shelf a kind lives on (every kind has one — the suite enforces it). */
export function propCategory(kind: PropKind): PropCategory {
  return CATEGORY_BY_KIND[kind];
}

export function isPropKind(value: string): value is PropKind {
  return Object.prototype.hasOwnProperty.call(PROP_KIND_DEFINITIONS, value);
}

export function propKindDefinition(kind: PropKind): PropKindDefinition {
  return PROP_KIND_DEFINITIONS[kind];
}

export function propKindNamesForConsole(): string {
  return PROP_KINDS.join(', ');
}

// ── the dumpster body box, the ONE place it is defined (req_0623) ────────────
// The model is authored at DUMPSTER_AUTHORED_HEIGHT (the parts' AABB top) and
// derives its body width/depth from the footprint radius. Both renderers
// (render3d/props/Dumpster.tsx, compile/worldGeometry.ts) AND host physics
// (world/props.ts propFootprint) consume THIS, so the box you see is the box
// you bump — the player was clipping into the widened body because physics
// still used the old footprint square.

export const DUMPSTER_AUTHORED_HEIGHT = 1.09;

export function dumpsterBodyMeters(): { scale: number; widthMeters: number; depthMeters: number } {
  const def = PROP_KIND_DEFINITIONS.dumpster;
  const scale = def.heightMeters / DUMPSTER_AUTHORED_HEIGHT;
  return {
    scale,
    widthMeters: def.footprintRadiusMeters * 1.6 * scale,
    depthMeters: def.footprintRadiusMeters * 1.2 * scale,
  };
}
