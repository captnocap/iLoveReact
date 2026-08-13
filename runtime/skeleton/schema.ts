// runtime/skeleton/schema.ts — the SKELETON OBJECT MODEL authoring shape.
//
// Design of record: docs/game/SKELETON_OBJECT_MODEL.md. A skeleton is the ONE
// shape every authored thing conforms to — a static prop, an item, clothing, a
// player, a vehicle, a building, a weapon, a turret — all of them are
// `bones (a formation) + carried data (what the bones mean)`. The framework (Zig)
// does not know what a "vehicle" is; it knows bones + carried data, validates the
// formation, and runs it through capabilities it already owns. "A new kind of
// thing" is "new skeleton data", not new code (V28: data-not-code at the level of
// object-kinds).
//
// This file is the SHARED CONTRACT — the TS authoring shape that MIRRORS the Zig
// types in framework/skeleton/skeleton.zig. It is pure data declaration: React
// declares the shape, it NEVER implements the validator/loader (that is the host
// Zig system bones_loader.zig). Every carried section is OPTIONAL — absence is a
// valid, meaningful default (no `animation` ⇒ static pose; no `mounts` ⇒ nothing
// attaches).

// ── primitives ──────────────────────────────────────────────────────────────
export type Vec3 = [number, number, number];
/** Quaternion (x, y, z, w). Identity = [0,0,0,1]. */
export type Quat = [number, number, number, number];

/** A bone's local rest transform. All parts optional; the host fills identity
 *  defaults (pos 0, rot identity, scale 1) — mirror of skeleton.zig Transform. */
export interface Transform {
  pos?: Vec3;
  rot?: Quat;
  scale?: Vec3;
}

// ── bones (the formation) ─────────────────────────────────────────────────────

/** Articulation at a bone. Props use fixed/one-axis joints; anatomical bones can
 *  use a three-range ball joint. Absent means fixed. */
export type JointRange = { min: number; max: number };

export type FixedJoint = { kind: 'fixed' };

/** The existing prop-oriented one-axis joint contract. Rotational limits are
 * radians; slide limits are model-space units. */
export type AxisJoint = {
  kind: 'hinge' | 'slide' | 'pivot' | 'spin';
  /** Rotation/slide axis in the bone's local space. */
  axis: Vec3;
  limits?: JointRange;
};

/** Three-degree-of-freedom anatomical joint. All limits are radians in the
 * generated/runtime contract; the canonical JSON authors them in degrees. */
export type BallJoint = {
  kind: 'ball';
  swingX: JointRange;
  swingZ: JointRange;
  twistY: JointRange;
};

export type Joint = FixedJoint | AxisJoint | BallJoint;
export type JointKind = Joint['kind'];

/** One bone in the formation. `parent` is another bone's `id`, or null/undefined
 *  for a root bone. "Any valid formation" = every parent resolves (or is root),
 *  no cycles, ids unique. A single-bone skeleton is valid (the common prop). */
export interface Bone {
  /** Stable serialized identity. Display labels never replace this value. */
  id: string;
  /** User-facing label, deliberately separate from the stable bone id. */
  displayName?: string;
  parent?: string | null;
  transform?: Transform;
  /** Terminal segment endpoint in this bone's local frame. */
  tip?: Vec3;
  joint?: Joint;
}

// ── humanoid semantics and saved character binding ───────────────────────────

export type BoneId = string;
export type HumanoidSide = 'left' | 'right';

/** Stable anatomy vocabulary persisted on logical faces. Object names, display
 * names, and outliner order are never part of this identity. */
export type HumanoidSemanticRole =
  | 'pelvis' | 'abdomen' | 'chest' | 'head'
  | 'upper_arm' | 'lower_arm' | 'hand'
  | 'upper_leg' | 'lower_leg' | 'foot'
  | 'neck' | 'clavicle' | 'fingers' | 'toes';

export interface HumanoidSemanticBinding {
  role: HumanoidSemanticRole;
  side?: HumanoidSide;
  boneId: BoneId;
}

export type CharacterObjectBinding =
  | { objectId: string; mode: 'body' }
  | { objectId: string; mode: 'deformable' }
  | { objectId: string; mode: 'rigid'; boneId: BoneId };

export type BoneFitMetadata = {
  source: 'boundary' | 'template' | 'external' | 'manual';
  confidence: number;
  locked: boolean;
};

export type CharacterRigDescriptor = {
  version: 1;
  state: 'draft' | 'needs_bind' | 'bound';
  semanticBindings: HumanoidSemanticBinding[];
  objectBindings: CharacterObjectBinding[];
  fit: Record<BoneId, BoneFitMetadata>;
  shapeHash: string;
  externalProvenance?: {
    provider: 'SkinTokens' | string;
    modelClass?: string;
    seconds?: number;
  };
};

export type SkinBindingRef = {
  path: string;
  format: 'RJSK';
  version: 1;
  artifactHash: string;
  topologyHash: string;
  semanticHash: string;
  skeletonHash: string;
  objectBindingHash: string;
  logicalVertexCount: number;
  maxInfluences: 4;
};

export type HumanoidRigTuning = {
  specimenSeparationBoundsWidth: number;
  bendPresetsDeg: {
    shoulderAbduction: number;
    elbowFlex: number;
    wristFlex: number;
    hipFlex: number;
    kneeFlex: number;
  };
};

/** Generated canonical template data. It is read-only so the single generated
 * instance cannot become accidental process-local authoring state. */
export type HumanoidTemplate = {
  readonly version: 1;
  readonly id: 'humanoid-v1';
  readonly bones: readonly Bone[];
  readonly semanticBindings: readonly HumanoidSemanticBinding[];
  readonly tuning: HumanoidRigTuning;
};

// ── carried data (what the bones mean) ────────────────────────────────────────
// All carried capability is a REFERENCE to a framework capability + params, never
// a script on the skeleton (V28). A missing capability extends the framework, not
// the skeleton file.

/** A named framework capability + its carried params. The skeleton names physics,
 *  animation, and behaviors this way; the host resolves the name to a capability
 *  it already owns. (Resolvability is a slice-2 loader concern; slice 1 validates
 *  the formation, not the capability registry.) */
export interface CapabilityRef {
  name: string;
  params?: Record<string, unknown>;
}

/** Geometry placed at a bone. `geometryKey` references the geometry registry / an
 *  imported mesh — the skeleton stays geometry-blind (never embeds geometry). */
export interface MeshAssignment {
  boneId: string;
  geometryKey: string;
}

/** meshes — either per-bone geometry (meshes at positions) OR one mesh skinned
 *  across the whole formation. This is a data-shape choice, NOT a thing-type. */
export type Meshes =
  | { kind: 'perBone'; items: MeshAssignment[] }
  | {
      kind: 'skinned';
      /** Legacy registry key retained for generic non-character formations. */
      geometryKey?: string;
      /** Immutable RJMD artifact path used by saved characters. */
      geometryPath?: string;
      /** Absent for draft/needs-bind characters; required when state is bound. */
      binding?: SkinBindingRef;
    };

/** collision — a collider bound to a bone (or, with no boneId, the whole hull).
 *  `capability` names the collider shape/behavior; bakes into the V29 COLLIDERS
 *  lump at slice-2+ bake time. */
export interface Collider {
  boneId?: string;
  capability: CapabilityRef;
}

/** mounts — a named attachment socket where parts or OTHER skeletons attach
 *  (wheel, door, grip, barrel, magazine, sight, seat, room-anchor). An articulated
 *  mount carries (or sits on) a `joint`. */
export interface Mount {
  name: string;
  boneId: string;
  transform?: Transform;
  joint?: Joint;
}

/** contacts — where ANOTHER skeleton interfaces with this one (a hand grips the
 *  grip-mount, a pelvis sits at a seat-anchor). Contacts are PINS off bones — the
 *  prop pins/gates ruling, generalized to every thing-type. */
export interface Contact {
  name: string;
  boneId: string;
  transform?: Transform;
}

/** behaviors — a named framework capability the thing DOES (open, eject, roll,
 *  rotate, dispense), parameterized by carried params and optionally bound to a
 *  named mount. A "magazine that ejects" = the eject/slide capability referencing
 *  the magazine-mount, not a script. */
export interface NamedBehavior {
  name: string;
  capability: CapabilityRef;
  /** A mount name this behavior is bound to (e.g. the magazine-mount). */
  mount?: string;
}

/** A skeleton: the formation (`bones`) + carried data. Every carried section is
 *  optional. This is the universal object model — the substrate every thing-type
 *  conforms to. Mirror of skeleton.zig `Skeleton`. */
export interface Skeleton {
  id: string;
  bones: Bone[];
  meshes?: Meshes;
  /** Present only for the character artifact path. Generic prop validation and
   * the prop Rig inspector remain independent of this descriptor. */
  characterRig?: CharacterRigDescriptor;
  /** Is the formation frozen (prop fast path) or articulated. */
  static?: boolean;
  collision?: Collider[];
  physics?: CapabilityRef;
  animation?: CapabilityRef;
  mounts?: Mount[];
  contacts?: Contact[];
  behaviors?: NamedBehavior[];
}

// ── pure authoring helpers (declaration only — NO validation lives here) ──────

/** Assemble a Skeleton from its id + formation + optional carried data. A thin
 *  declarative builder so authoring code reads as a document; it performs NO
 *  validation (that is the host's bones_loader — React never implements it). */
export function defineSkeleton(
  id: string,
  bones: Bone[],
  carried: Omit<Partial<Skeleton>, 'id' | 'bones'> = {},
): Skeleton {
  return { id, bones, ...carried };
}

/** Convenience: a single-bone static prop — the most common skeleton. */
export function staticProp(id: string, geometryKey: string, boneId = 'root'): Skeleton {
  return defineSkeleton(id, [{ id: boneId }], {
    static: true,
    meshes: { kind: 'perBone', items: [{ boneId, geometryKey }] },
  });
}
