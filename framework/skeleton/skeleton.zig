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
/// a turret `pivot`s. `fixed` ⇒ no articulation (the default when absent).
pub const JointKind = enum { fixed, hinge, slide, pivot, spin };

/// A joint's articulation. Non-`fixed` joints require a non-zero `axis`; `limits`,
/// when both present, must satisfy min <= max. The validator enforces both.
pub const Joint = struct {
    kind: JointKind = .fixed,
    /// Rotation/slide axis in bone-local space. Required (non-zero) for non-fixed.
    axis: ?Vec3 = null,
    /// Articulation limits (radians for hinge/pivot/spin, units for slide).
    limit_min: ?f32 = null,
    limit_max: ?f32 = null,
};

/// One bone in the formation. `parent` is another bone's `id`, or null for a root
/// bone. "Any valid formation" = every parent resolves (or is root), no cycles,
/// ids unique. A single-bone skeleton is valid (the common static prop).
pub const Bone = struct {
    id: []const u8,
    parent: ?[]const u8 = null,
    transform: Transform = .{},
    joint: ?Joint = null,
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

/// meshes — either per-bone geometry (meshes at positions) OR one mesh skinned
/// across the whole formation. A data-shape choice, NOT a thing-type branch.
pub const Meshes = union(enum) {
    per_bone: []const MeshAssignment,
    skinned: []const u8, // geometry_key
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
    /// Is the formation frozen (prop fast path) or articulated.
    static: bool = false,
    collision: []const Collider = &.{},
    physics: ?CapabilityRef = null,
    animation: ?CapabilityRef = null,
    mounts: []const Mount = &.{},
    contacts: []const Contact = &.{},
    behaviors: []const NamedBehavior = &.{},
};
