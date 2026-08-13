//! The SKELETON OBJECT MODEL — Zig types (the host side of the shared contract).
//!
//! Design of record: docs/game/SKELETON_OBJECT_MODEL.md. A skeleton is the ONE
//! shape every authored thing conforms to — a static prop, an item, clothing, a
//! player, a vehicle, a building, a weapon, a turret. It is a `formation of bones`
//! plus `carried data` (what the bones mean), and that pair describes anything.
//!
//! The framework does NOT know what a "vehicle" or a "player" is. It knows bones +
//! carried data: it validates the formation (bones_loader.zig), accepts it, and
//! runs it through capabilities it already owns. "A new kind of thing" is "new
//! skeleton data", not new Zig — a forker adds thing-types without touching this.
//!
//! These types MIRROR the TS authoring shape in runtime/skeleton/schema.ts. They
//! are deliberately plain/borrowed (slices reference caller-owned memory) so the
//! validator stays headless and allocation-light. Every carried section is
//! optional/empty by default — absence is a valid, meaningful default.

const std = @import("std");

pub const Vec3 = [3]f32;
/// Quaternion (x, y, z, w). Identity = .{ 0, 0, 0, 1 }.
pub const Quat = [4]f32;

/// A bone's local rest transform. Defaults are identity (the host fills these when
/// the authoring side omits them).
pub const Transform = struct {
    pos: Vec3 = .{ 0, 0, 0 },
    rot: Quat = .{ 0, 0, 0, 1 },
    scale: Vec3 = .{ 1, 1, 1 },
};

/// Articulation at a bone. A wheel `spin`s, a door `hinge`s, a magazine `slide`s,
/// a turret `pivot`s, and an anatomical shoulder uses a constrained `ball`.
pub const JointKind = enum { fixed, hinge, slide, pivot, spin, ball };

pub const JointRange = struct {
    min: f32,
    max: f32,
};

/// A joint's articulation. Non-`fixed` joints require a non-zero `axis`; `limits`,
/// when both present, must satisfy min <= max. The validator enforces both.
pub const Joint = struct {
    kind: JointKind = .fixed,
    /// Rotation/slide axis in bone-local space. Required (non-zero) for non-fixed.
    axis: ?Vec3 = null,
    /// Articulation limits (radians for hinge/pivot/spin, units for slide).
    limit_min: ?f32 = null,
    limit_max: ?f32 = null,
    /// Anatomical ball-joint ranges, in radians around the bone-local axes.
    swing_x: ?JointRange = null,
    swing_z: ?JointRange = null,
    twist_y: ?JointRange = null,
};

/// One bone in the formation. `parent` is another bone's `id`, or null for a root
/// bone. "Any valid formation" = every parent resolves (or is root), no cycles,
/// ids unique. A single-bone skeleton is valid (the common static prop).
pub const Bone = struct {
    id: []const u8,
    /// User-facing label. Stable identity remains `id` when this changes.
    display_name: ?[]const u8 = null,
    parent: ?[]const u8 = null,
    transform: Transform = .{},
    /// Terminal endpoint in this bone's local frame.
    tip: ?Vec3 = null,
    joint: ?Joint = null,
};

// ── humanoid semantics and saved character binding ───────────────────────────

pub const HumanoidSide = enum { left, right };

pub const HumanoidSemanticRole = enum {
    pelvis,
    abdomen,
    chest,
    head,
    upper_arm,
    lower_arm,
    hand,
    upper_leg,
    lower_leg,
    foot,
    neck,
    clavicle,
    fingers,
    toes,
};

pub const HumanoidSemanticBinding = struct {
    role: HumanoidSemanticRole,
    side: ?HumanoidSide = null,
    bone_id: []const u8,
};

fn pairedRetargetId(
    side: ?HumanoidSide,
    left: []const u8,
    right: []const u8,
) error{InvalidSemanticSide}![]const u8 {
    return switch (side orelse return error.InvalidSemanticSide) {
        .left => left,
        .right => right,
    };
}

/// The canonical retarget wire id one bound humanoid role answers to (req_4285):
/// the channel vocabulary motion documents and the built-in clips speak. This
/// is the single role→channel alias table; palette builders and pose samplers
/// share it rather than re-declaring the mapping.
pub fn semanticRetargetId(binding: HumanoidSemanticBinding) error{InvalidSemanticSide}![]const u8 {
    return switch (binding.role) {
        .pelvis => "pelvis",
        .abdomen => "spine_lower",
        .chest => "spine_upper",
        .head => "head",
        .neck => "neck",
        .clavicle => pairedRetargetId(binding.side, "clavicle_left", "clavicle_right"),
        .upper_arm => pairedRetargetId(binding.side, "upper_arm_left", "upper_arm_right"),
        .lower_arm => pairedRetargetId(binding.side, "lower_arm_left", "lower_arm_right"),
        .hand => pairedRetargetId(binding.side, "hand_left", "hand_right"),
        .fingers => pairedRetargetId(binding.side, "fingers_left", "fingers_right"),
        .upper_leg => pairedRetargetId(binding.side, "upper_leg_left", "upper_leg_right"),
        .lower_leg => pairedRetargetId(binding.side, "lower_leg_left", "lower_leg_right"),
        .foot => pairedRetargetId(binding.side, "foot_left", "foot_right"),
        .toes => pairedRetargetId(binding.side, "toes_left", "toes_right"),
    };
}

pub const RigidObjectBinding = struct {
    object_id: []const u8,
    bone_id: []const u8,
};

pub const CharacterObjectBinding = union(enum) {
    body: []const u8,
    deformable: []const u8,
    rigid: RigidObjectBinding,

    pub fn objectId(self: CharacterObjectBinding) []const u8 {
        return switch (self) {
            .body => |id| id,
            .deformable => |id| id,
            .rigid => |binding| binding.object_id,
        };
    }
};

pub const FitSource = enum { boundary, template, external, manual };

pub const BoneFitMetadata = struct {
    bone_id: []const u8,
    source: FitSource,
    confidence: f32,
    locked: bool,
};

pub const CharacterRigState = enum { draft, needs_bind, bound };

pub const ExternalRigProvenance = struct {
    provider: []const u8,
    model_class: ?[]const u8 = null,
    seconds: ?f32 = null,
};

pub const CharacterRigDescriptor = struct {
    version: u16 = 1,
    state: CharacterRigState = .draft,
    semantic_bindings: []const HumanoidSemanticBinding = &.{},
    object_bindings: []const CharacterObjectBinding = &.{},
    fit: []const BoneFitMetadata = &.{},
    shape_hash: []const u8 = "",
    external_provenance: ?ExternalRigProvenance = null,
};

pub const SkinFormat = enum { RJSK };

pub const SkinBindingRef = struct {
    path: []const u8,
    format: SkinFormat = .RJSK,
    version: u16 = 1,
    artifact_hash: []const u8,
    topology_hash: []const u8,
    semantic_hash: []const u8,
    skeleton_hash: []const u8,
    object_binding_hash: []const u8,
    logical_vertex_count: u32,
    max_influences: u8 = 4,
};

pub const HumanoidBendPresets = struct {
    shoulder_abduction: f32,
    elbow_flex: f32,
    wrist_flex: f32,
    hip_flex: f32,
    knee_flex: f32,
};

pub const HumanoidRigTuning = struct {
    specimen_separation_bounds_width: f32,
    bend_presets_deg: HumanoidBendPresets,
};

pub const HumanoidTemplate = struct {
    version: u16 = 1,
    id: []const u8,
    bones: []const Bone,
    semantic_bindings: []const HumanoidSemanticBinding,
    tuning: HumanoidRigTuning,
};

// ── carried data (what the bones mean) ────────────────────────────────────────
// All carried capability is a REFERENCE to a framework capability + params, never
// a script on the skeleton (V28). `params_json` is opaque to slice 1 — the loader
// resolves the named capability + parses its params at ingest (slice 2).

/// A named framework capability + its carried params (raw JSON, parsed by the
/// resolving capability at ingest). Used by physics, animation, behaviors, and
/// colliders. Resolvability is a slice-2 loader concern; see bones_loader.zig.
pub const CapabilityRef = struct {
    name: []const u8,
    params_json: []const u8 = "{}",
};

/// Geometry placed at a bone. `geometry_key` references the geometry registry / an
/// imported mesh — the skeleton stays geometry-blind (never embeds geometry).
pub const MeshAssignment = struct {
    bone_id: []const u8,
    geometry_key: []const u8,
};

pub const SkinnedMesh = struct {
    /// Generic non-character registry lookup retained for prop formations.
    geometry_key: ?[]const u8 = null,
    /// Immutable RJMD artifact path for the character loader.
    geometry_path: ?[]const u8 = null,
    binding: ?SkinBindingRef = null,
};

/// meshes — either per-bone geometry (meshes at positions) OR one mesh skinned
/// across the whole formation. A data-shape choice, NOT a thing-type branch.
pub const Meshes = union(enum) {
    per_bone: []const MeshAssignment,
    skinned: SkinnedMesh,
};

/// collision — a collider bound to a bone (or, with null bone_id, the whole hull).
pub const Collider = struct {
    bone_id: ?[]const u8 = null,
    capability: CapabilityRef,
};

/// mounts — a named attachment socket where parts or OTHER skeletons attach. An
/// articulated mount carries (or sits on) a `joint`.
pub const Mount = struct {
    name: []const u8,
    bone_id: []const u8,
    transform: Transform = .{},
    joint: ?Joint = null,
};

/// contacts — where ANOTHER skeleton interfaces with this one (a hand grips a
/// grip-mount, a pelvis sits at a seat-anchor). Pins off bones (prop pins/gates
/// generalized to every thing-type).
pub const Contact = struct {
    name: []const u8,
    bone_id: []const u8,
    transform: Transform = .{},
};

/// behaviors — a named framework capability the thing DOES (open, eject, roll,
/// rotate, dispense), optionally bound to a named mount.
pub const NamedBehavior = struct {
    name: []const u8,
    capability: CapabilityRef,
    /// A mount name this behavior is bound to (optional).
    mount: ?[]const u8 = null,
};

/// A skeleton: the formation (`bones`) + carried data. Every carried section is
/// optional/empty. This is the universal object model — the substrate every
/// thing-type conforms to. Mirror of schema.ts `Skeleton`.
pub const Skeleton = struct {
    id: []const u8,
    bones: []const Bone,
    meshes: ?Meshes = null,
    character_rig: ?CharacterRigDescriptor = null,
    /// Is the formation frozen (prop fast path) or articulated.
    static: bool = false,
    collision: []const Collider = &.{},
    physics: ?CapabilityRef = null,
    animation: ?CapabilityRef = null,
    mounts: []const Mount = &.{},
    contacts: []const Contact = &.{},
    behaviors: []const NamedBehavior = &.{},
};
