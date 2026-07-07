// runtime/skeleton/rigs.ts — the canonical RIG vocabulary + templates.
//
// "Rigging" (req_2712/req_2713): exporting an authored thing is not dumping a
// mesh — it is rigging it onto the skeleton object model (schema.ts). This file
// is the shared VOCABULARY layer on top of the generic skeleton: the canonical
// contact/mount names and behavior capability params that every consumer (the
// editor's rig panel, the export writer, the game's ingest) agrees on. It is
// pure data declaration — no validation lives here (that is the host's
// bones_loader), and no thing-type reaches the framework: a "prop" or an "item"
// is just a skeleton whose carried data uses these names (data-not-code, V28).
//
// The capability params mirror the LOAD-BEARING gameplay fields of the retired
// hmsc-int prop table (cart/hmsc-int/game/kinds/props.ts — PropContainer /
// PropSeat / PropCoverClass / PropDynamics): searchable slots, open/locked/keyed
// access, sit/lay seats, soft/hard cover, kickable dynamics. Anything the old
// TS prop files could express, an exported rig can carry.
import type { Bone, Contact, NamedBehavior, CapabilityRef, Skeleton, Vec3 } from './schema';
import { defineSkeleton } from './schema';

// ── canonical contact names (pins off bones — where OTHER skeletons interface) ──
// A pocket is a searchable slot an item can live in; a placement is a tabletop
// point items can be set ON; a seat pins a pelvis; a grip pins a hand.
export const POCKET_PREFIX = 'pocket_';
export const PLACEMENT_PREFIX = 'placement_';
export const SEAT_PREFIX = 'seat_';
export const GRIP_LEFT = 'grip_left';
export const GRIP_RIGHT = 'grip_right';
/** The contact region that makes physical contact with other models (a knife's
 *  blade, a bat's barrel) — the item vocabulary's `physical`. */
export const PHYSICAL_CONTACT = 'physical';

export function pocketName(index: number): string { return `${POCKET_PREFIX}${index + 1}`; }
export function placementName(index: number): string { return `${PLACEMENT_PREFIX}${index + 1}`; }
export function seatName(index: number): string { return `${SEAT_PREFIX}${index + 1}`; }

// ── canonical mount names (sockets where parts / effects attach) ──────────────
/** Where ammo reloads INTO (a magazine well). */
export const AMMO_MOUNT = 'ammo';
/** Where a projectile leaves FROM (a muzzle). */
export const PROJECTILE_MOUNT = 'projectile';

// ── behavior capability names + carried params ────────────────────────────────
// Every gameplay meaning is a NAMED framework capability + params on the rig —
// never a script (V28). The params shapes below are the shared contract.

export const CONTAINER_CAPABILITY = 'container';
export const SEAT_CAPABILITY = 'seat';
export const COVER_CAPABILITY = 'cover';
export const DOOR_CAPABILITY = 'door';
export const DYNAMICS_CAPABILITY = 'dynamics';

/** The user's loot taxonomy, as data (carried over from the hmsc prop table). */
export type LootCategory = 'junk' | 'kitchen' | 'bathroom' | 'clothing' | 'office' | 'valuables' | 'tools';
export const LOOT_CATEGORIES: LootCategory[] = ['junk', 'kitchen', 'bathroom', 'clothing', 'office', 'valuables', 'tools'];

/** open = searchable freely; locked = needs lockpicking/force; keyed = needs its key. */
export type ContainerAccess = 'open' | 'locked' | 'keyed';
export const CONTAINER_ACCESS: ContainerAccess[] = ['open', 'locked', 'keyed'];

/** Searchable-slot params. Slot COUNT is not a param — it is the number of
 *  `pocket_<n>` contacts on the rig (the formation carries the capacity). */
export type ContainerParams = {
  lootCategory: LootCategory;
  access: ContainerAccess;
  /** The search loading bar, seconds. */
  searchSeconds: number;
  /** 0..1 chance each pocket spawns filled. */
  spawnFillChance: number;
  /** The key that opens a `keyed` container (an item id, matched at runtime). */
  keyId?: string;
};

/** Sit/lay params. CAPACITY is the number of `seat_<n>` contacts on the rig. */
export type SeatParams = {
  pose: 'sit' | 'lay';
  /** Pelvis height above the placement anchor, meters. */
  seatHeightMeters: number;
};

export type CoverClass = 'soft' | 'hard';
export type CoverParams = { class: CoverClass };

/** Two-state door leaf behavior, bound to a hinge-jointed bone. */
export type DoorParams = { reachMeters: number; vehicle?: boolean };

/** Kickable dynamic body (the hmsc KICKPROP sphere). */
export type DynamicsParams = { bodyRadiusMeters: number; restitution: number };

// ── the PROP rig (authoring draft) ────────────────────────────────────────────
// The editor-facing shape the rig panel edits. It compiles DOWN to a Skeleton
// (propRigToSkeleton) and parses back UP from one (skeletonToPropRig), so the
// manifest stores ONLY the skeleton — the draft is a projection, never a second
// source of truth.
export type PropRig = {
  /** Searchable pockets: `slots` many `pocket_<n>` contacts + container params. */
  container?: ContainerParams & { slots: number };
  /** How many `placement_<n>` tabletop contacts sit on the mesh top. */
  placements?: number;
  /** Sit/lay anchors: `capacity` many `seat_<n>` contacts + seat params. */
  seat?: SeatParams & { capacity: number };
  cover?: CoverClass;
  dynamics?: DynamicsParams;
};

/** The mesh-space AABB the rig derives contact positions from (measured, never
 *  hand-typed — the cookedAsset law carried forward). */
export type RigBounds = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };

const ROOT_BONE = 'root';

function spreadAcross(bounds: RigBounds, index: number, count: number, y: number): Vec3 {
  // n points spread evenly along the X extent (1 point = the center). Placement
  // positions refine in the rigging host tools (skeleton slice 3); the DATA
  // carries a sane measured default now.
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  if (count <= 1) return [cx, y, cz];
  const span = (bounds.maxX - bounds.minX) * 0.8;
  const x = bounds.minX + (bounds.maxX - bounds.minX) * 0.1 + (span * index) / (count - 1);
  return [x, y, cz];
}

/** Compile a PropRig draft + its mesh into the exported Skeleton: one static
 *  root bone carrying the geometry, contacts for every pocket/placement/seat,
 *  and behaviors/physics for container/cover/dynamics. */
export function propRigToSkeleton(id: string, geometryKey: string, rig: PropRig, bounds: RigBounds): Skeleton {
  const contacts: Contact[] = [];
  const behaviors: NamedBehavior[] = [];
  let physics: CapabilityRef | undefined;
  const midY = (bounds.minY + bounds.maxY) / 2;

  if (rig.container && rig.container.slots > 0) {
    const { slots, ...params } = rig.container;
    for (let i = 0; i < slots; i += 1) {
      contacts.push({ name: pocketName(i), boneId: ROOT_BONE, transform: { pos: spreadAcross(bounds, i, slots, midY) } });
    }
    behaviors.push({ name: CONTAINER_CAPABILITY, capability: { name: CONTAINER_CAPABILITY, params } });
  }
  for (let i = 0; i < (rig.placements ?? 0); i += 1) {
    contacts.push({ name: placementName(i), boneId: ROOT_BONE, transform: { pos: spreadAcross(bounds, i, rig.placements!, bounds.maxY) } });
  }
  if (rig.seat && rig.seat.capacity > 0) {
    const { capacity, ...params } = rig.seat;
    for (let i = 0; i < capacity; i += 1) {
      contacts.push({ name: seatName(i), boneId: ROOT_BONE, transform: { pos: spreadAcross(bounds, i, capacity, params.seatHeightMeters) } });
    }
    behaviors.push({ name: SEAT_CAPABILITY, capability: { name: SEAT_CAPABILITY, params } });
  }
  if (rig.cover) {
    behaviors.push({ name: COVER_CAPABILITY, capability: { name: COVER_CAPABILITY, params: { class: rig.cover } } });
  }
  if (rig.dynamics) {
    physics = { name: DYNAMICS_CAPABILITY, params: rig.dynamics };
  }
  return defineSkeleton(id, [{ id: ROOT_BONE }], {
    static: true,
    meshes: { kind: 'perBone', items: [{ boneId: ROOT_BONE, geometryKey }] },
    contacts,
    behaviors,
    physics,
  });
}

/** Project a stored Skeleton back into the editable PropRig draft (the inverse
 *  of propRigToSkeleton — counts from contact names, params from behaviors). */
export function skeletonToPropRig(skel: Skeleton): PropRig {
  const rig: PropRig = {};
  const contacts = skel.contacts ?? [];
  const count = (prefix: string): number => contacts.filter((c) => c.name.startsWith(prefix)).length;
  const behavior = (name: string): Record<string, unknown> | null => {
    const b = (skel.behaviors ?? []).find((x) => x.name === name);
    return b ? { ...(b.capability.params ?? {}) } : null;
  };
  const container = behavior(CONTAINER_CAPABILITY);
  const pockets = count(POCKET_PREFIX);
  if (container && pockets > 0) rig.container = { slots: pockets, ...(container as ContainerParams) };
  const placements = count(PLACEMENT_PREFIX);
  if (placements > 0) rig.placements = placements;
  const seat = behavior(SEAT_CAPABILITY);
  const seats = count(SEAT_PREFIX);
  if (seat && seats > 0) rig.seat = { capacity: seats, ...(seat as SeatParams) };
  const cover = behavior(COVER_CAPABILITY);
  if (cover?.class === 'soft' || cover?.class === 'hard') rig.cover = cover.class;
  if (skel.physics?.name === DYNAMICS_CAPABILITY && skel.physics.params) {
    rig.dynamics = skel.physics.params as DynamicsParams;
  }
  return rig;
}

/** One-line human summary of a PropRig — export status lines + the rig panel
 *  header ("2 pockets (kitchen, locked) · 1 placement · sit ×3"). */
export function describePropRig(rig: PropRig): string {
  const bits: string[] = [];
  if (rig.container && rig.container.slots > 0) {
    bits.push(`${rig.container.slots} pocket${rig.container.slots === 1 ? '' : 's'} (${rig.container.lootCategory}, ${rig.container.access})`);
  }
  if (rig.placements) bits.push(`${rig.placements} placement${rig.placements === 1 ? '' : 's'}`);
  if (rig.seat && rig.seat.capacity > 0) bits.push(`${rig.seat.pose} ×${rig.seat.capacity}`);
  if (rig.cover) bits.push(`${rig.cover} cover`);
  if (rig.dynamics) bits.push('kickable');
  return bits.length ? bits.join(' · ') : 'plain (no capabilities)';
}

// ── the ITEM rig (authoring draft) ────────────────────────────────────────────
// Items are the held things: where the player grabs it (grips), where ammo
// reloads (mount), where a projectile leaves (mount), what part makes contact
// (physical). Vocabulary + builder land now; the item export UI is a later cut.
export type ItemRig = {
  grip?: { left?: boolean; right?: boolean };
  ammo?: boolean;
  projectile?: boolean;
  physical?: boolean;
};

export function itemRigToSkeleton(id: string, geometryKey: string, rig: ItemRig, bounds: RigBounds): Skeleton {
  const contacts: Contact[] = [];
  const mounts: Skeleton['mounts'] = [];
  const center: Vec3 = [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, (bounds.minZ + bounds.maxZ) / 2];
  if (rig.grip?.left) contacts.push({ name: GRIP_LEFT, boneId: ROOT_BONE, transform: { pos: center } });
  if (rig.grip?.right) contacts.push({ name: GRIP_RIGHT, boneId: ROOT_BONE, transform: { pos: center } });
  if (rig.physical) contacts.push({ name: PHYSICAL_CONTACT, boneId: ROOT_BONE, transform: { pos: [center[0], bounds.maxY, center[2]] } });
  if (rig.ammo) mounts!.push({ name: AMMO_MOUNT, boneId: ROOT_BONE, transform: { pos: [center[0], bounds.minY, center[2]] } });
  if (rig.projectile) mounts!.push({ name: PROJECTILE_MOUNT, boneId: ROOT_BONE, transform: { pos: [bounds.maxX, center[1], center[2]] } });
  return defineSkeleton(id, [{ id: ROOT_BONE }], {
    static: true,
    meshes: { kind: 'perBone', items: [{ boneId: ROOT_BONE, geometryKey }] },
    contacts,
    mounts,
  });
}

// ── formation templates (starting bone lists, per the user's rig draft) ───────
// These are CONTENT — suggested formations a rigger starts from, not engine
// types. A left/right pair is two bones named `<name>_left` / `<name>_right`.

/** Two mirrored bones (`<name>_left` / `<name>_right`) under ONE shared parent. */
function pair(name: string, parent: string): Bone[] {
  return (['left', 'right'] as const).map((side) => ({ id: `${name}_${side}`, parent }));
}

/** Two mirrored bones, each under its OWN side's parent (`<parent>_left` /
 *  `<parent>_right`) — the limb-chain link (elbow under upper_arm, etc.). */
function pairUnder(name: string, parentPair: string): Bone[] {
  return (['left', 'right'] as const).map((side) => ({ id: `${name}_${side}`, parent: `${parentPair}_${side}` }));
}

/** The humanoid BODY formation (head→toes, mirrored limbs). */
export function bodyRigBones(): Bone[] {
  return [
    { id: 'body' },
    { id: 'abdomen', parent: 'body' },
    { id: 'butt', parent: 'abdomen' },
    { id: 'crotch', parent: 'abdomen' },
    { id: 'chest', parent: 'abdomen' },
    { id: 'breast', parent: 'chest' },
    { id: 'back', parent: 'chest' },
    { id: 'head', parent: 'chest' },
    { id: 'mouth', parent: 'head' },
    { id: 'lips', parent: 'mouth' },
    { id: 'teeth', parent: 'mouth' },
    { id: 'hair', parent: 'head' },
    { id: 'nose', parent: 'head' },
    ...pair('eye', 'head'),
    ...pair('shoulder', 'chest'),
    ...pairUnder('upper_arm', 'shoulder'),
    ...pairUnder('elbow', 'upper_arm'),
    ...pairUnder('lower_arm', 'elbow'),
    ...pairUnder('wrist', 'lower_arm'),
    ...pairUnder('hand', 'wrist'),
    ...pairUnder('fingers', 'hand'),
    ...pair('hip', 'abdomen'),
    ...pairUnder('upper_leg', 'hip'),
    ...pairUnder('knee', 'upper_leg'),
    ...pairUnder('lower_leg', 'knee'),
    ...pairUnder('foot', 'lower_leg'),
    ...pairUnder('toes', 'foot'),
  ];
}

/** The CAR formation: hinged panels, spinning wheels, seats as bones the seat
 *  contacts pin to. Wheel spin axis = local X; hinges swing about local Y. */
export function carRigBones(): Bone[] {
  const hingeY: Bone['joint'] = { kind: 'hinge', axis: [0, 1, 0] };
  const spinX: Bone['joint'] = { kind: 'spin', axis: [1, 0, 0] };
  return [
    { id: 'body' },
    { id: 'bumper_front', parent: 'body' },
    { id: 'bumper_back', parent: 'body' },
    { id: 'hood', parent: 'body', joint: hingeY },
    { id: 'trunk', parent: 'body', joint: hingeY },
    { id: 'door_driver', parent: 'body', joint: hingeY },
    { id: 'door_passenger', parent: 'body', joint: hingeY },
    { id: 'gas', parent: 'body', joint: hingeY },
    { id: 'windshield', parent: 'body' },
    { id: 'window', parent: 'body' },
    { id: 'lights_front', parent: 'body' },
    { id: 'lights_back', parent: 'body' },
    { id: 'seat_driver', parent: 'body' },
    { id: 'seat_passenger', parent: 'body' },
    { id: 'wheel_front_left', parent: 'body', joint: spinX },
    { id: 'wheel_front_right', parent: 'body', joint: spinX },
    { id: 'wheel_back_left', parent: 'body', joint: spinX },
    { id: 'wheel_back_right', parent: 'body', joint: spinX },
  ];
}

// ── the CHARACTER rig compiler (req_2777) ─────────────────────────────────────
// A character export derives its skeleton FROM THE LIVE OUTLINER at export time
// — the same measured-at-export law the prop rig follows, never a stored
// snapshot. Part NAME → bone id is the binding contract: rename an outliner row
// to a body bone and it binds; anything else is reported unbound, LOUDLY. This
// is what makes "import an arbitrary model, chop it up, rename the parts" a
// first-class rigging workflow, and what keeps a delete honest (a bone whose
// part is gone simply carries no mesh — a valid formation).

/** Outliner-row shape the compiler consumes: the part's name and, when known,
 *  its measured world center (bounds center — measured, never hand-typed). */
export type CharacterPartRow = { name: string; center?: Vec3 };

export type CharacterBinding = {
  /** bone id → the part name bound to it, in formation order. */
  bound: { bone: string; part: string }[];
  /** Part names that match no body bone (exported as geometry, bound to nothing). */
  unbound: string[];
  /** Bone ids claimed by MORE THAN ONE part — first claimant wins, rest report. */
  duplicates: string[];
};

/** Normalize an outliner name to a bone id: case/space/dash-insensitive, with
 *  the common `.l`/`_l` / `.r`/`_r` side suffixes (Blender convention) accepted
 *  as `_left`/`_right`. */
export function normalizeBoneName(name: string): string {
  let n = name.trim().toLowerCase().replace(/[\s\-.]+/g, '_');
  n = n.replace(/_l$/, '_left').replace(/_r$/, '_right');
  return n;
}

/** Match outliner part names against the body formation — the dialog's binding
 *  readout and the compiler share this one matcher. First claimant wins a bone. */
export function matchCharacterBones(names: string[]): CharacterBinding {
  const boneIds = new Set(bodyRigBones().map((b) => b.id));
  const claimed = new Map<string, string>();
  const unbound: string[] = [];
  const duplicates: string[] = [];
  for (const name of names) {
    const bone = normalizeBoneName(name);
    if (!boneIds.has(bone)) { unbound.push(name); continue; }
    if (claimed.has(bone)) { duplicates.push(bone); continue; }
    claimed.set(bone, name);
  }
  const bound = bodyRigBones()
    .filter((b) => claimed.has(b.id))
    .map((b) => ({ bone: b.id, part: claimed.get(b.id)! }));
  return { bound, unbound, duplicates };
}

export type CharacterRigCompile = CharacterBinding & { skeleton: Skeleton };

/** Compile the live outliner into the exported character Skeleton: the full
 *  body formation, a per-bone mesh assignment for every BOUND part (geometry
 *  key = the bone id — the parts.json row it binds), and rest transforms
 *  stamped parent-relative from the parts' MEASURED centers (bones without a
 *  measured part keep identity — absence is a valid default). */
export function partsToCharacterSkeleton(id: string, rows: CharacterPartRow[]): CharacterRigCompile {
  const binding = matchCharacterBones(rows.map((r) => r.name));
  const centerByPart = new Map(rows.filter((r) => r.center).map((r) => [r.name, r.center!]));
  const world = new Map<string, Vec3>();
  for (const { bone, part } of binding.bound) {
    const center = centerByPart.get(part);
    if (center) world.set(bone, center);
  }
  const formation = bodyRigBones();
  const parentOf = new Map(formation.map((b) => [b.id, b.parent ?? null]));
  /** Nearest ancestor with a measured world position (the transform base). */
  const ancestorWorld = (boneId: string): Vec3 => {
    let cur = parentOf.get(boneId) ?? null;
    while (cur) {
      const at = world.get(cur);
      if (at) return at;
      cur = parentOf.get(cur) ?? null;
    }
    return [0, 0, 0];
  };
  const bones = formation.map((bone) => {
    const at = world.get(bone.id);
    if (!at) return bone;
    const base = ancestorWorld(bone.id);
    return { ...bone, transform: { pos: [at[0] - base[0], at[1] - base[1], at[2] - base[2]] as Vec3 } };
  });
  const items = binding.bound.map(({ bone }) => ({ boneId: bone, geometryKey: bone }));
  const skeleton = defineSkeleton(id, bones, items.length ? { meshes: { kind: 'perBone', items } } : {});
  return { ...binding, skeleton };
}
