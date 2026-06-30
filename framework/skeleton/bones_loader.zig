//! bones_loader — the generic skeleton VALIDATOR (slice 1 of the object model).
//!
//! Design of record: docs/game/SKELETON_OBJECT_MODEL.md. This is the host system
//! that accepts ANY valid formation of bones + carried data and rejects malformed
//! ones. It has NO per-type branches — a vehicle and a player take the IDENTICAL
//! path. The framework never enumerates thing-types; it only asks "is this a valid
//! formation of bones with resolvable carried data" and accepts it.
//!
//! Slice 1 is the validator only. It checks:
//!   - the formation is non-empty,
//!   - bone ids are unique (no duplicate),
//!   - every parent resolves to a present bone (no dangling parent) or is root,
//!   - there are no cycles in the parent graph,
//!   - every joint is well-formed (non-fixed ⇒ non-zero axis, limits min<=max),
//!   - every carried bone-reference (a mesh/collider/mount/contact's bone_id)
//!     resolves to a present bone.
//!
//! The carried-reference check is UNIFORM: one helper (`refPresent`) is applied to
//! the bone_id of each carried section the same way — there is no "if this is a
//! vehicle / a player" branch anywhere. The only `switch` is on the meshes union's
//! data shape (per-bone vs skinned), which the doc defines as data, not a type.
//!
//! INTEGRATION (slice 2 — ingest, NOT built here):
//!   - The GLB import path (framework/world/mesh_import.zig) already IS a bone
//!     formation: its `parseGlb` walks the glTF node TRS hierarchy (visitNode /
//!     nodeMatrix at mesh_import.zig:407-423) and merges meshes. The FOLD POINT is
//!     a slice-2 adapter that maps each glTF node → a `Bone` (node id → bone id,
//!     parent node → parent, node TRS → Transform) and each node's mesh →
//!     `Meshes.per_bone{ bone_id, geometry_key }` (the interned ParsedMesh key),
//!     then hands the resulting `Skeleton` to `validate` here. Import gives bones +
//!     meshes; authoring layers on mounts/contacts/behaviors/physics. This module
//!     does NOT import or rebuild mesh_import.zig — it generalizes it downstream.
//!   - Resolvability of geometry_key / capability names against the geometry
//!     registry + capability registry is the slice-2 concern. The hook is
//!     `ResolveHooks` below: slice 1 passes the always-accept default, so the
//!     formation validates before the registries are wired.

const std = @import("std");

/// The skeleton object-model types. Re-exported so a single `bones_loader` module
/// gives a caller both the validator and the model (the unit test relies on this).
pub const model = @import("skeleton.zig");

/// Why a formation was rejected. No reason names a thing-type — every reason is a
/// property of "a valid formation of bones + resolvable carried data".
pub const RejectReason = enum {
    empty_formation,
    duplicate_bone_id,
    dangling_parent,
    cycle,
    invalid_joint,
    carried_bone_missing,
    unresolved_capability, // slice-2 hook; never raised under the default hooks
    unresolved_geometry, // slice-2 hook; never raised under the default hooks
};

/// A rejection: the reason + a borrowed detail string (a bone/mount/contact id or
/// capability name pointing at the offending element). The detail borrows from the
/// input skeleton, so it is valid as long as the caller's skeleton is.
pub const Reject = struct {
    reason: RejectReason,
    detail: []const u8 = "",
};

/// The validator's verdict. `ok` ⇒ the formation is well-formed and (under the
/// active hooks) every carried reference resolves.
pub const Result = union(enum) {
    ok: void,
    reject: Reject,

    pub fn accepted(self: Result) bool {
        return self == .ok;
    }
};

/// Slice-2 resolvability hooks. Slice 1 uses `accept_all`: the formation is
/// validated structurally before the geometry/capability registries are wired.
/// When the registries land, the ingest path passes real resolvers and the loader
/// raises `unresolved_geometry` / `unresolved_capability` WITHOUT changing the
/// per-type-free structure of this validator.
pub const ResolveHooks = struct {
    ctx: ?*anyopaque = null,
    resolve_geometry: ?*const fn (ctx: ?*anyopaque, key: []const u8) bool = null,
    resolve_capability: ?*const fn (ctx: ?*anyopaque, name: []const u8) bool = null,

    fn geometryOk(self: ResolveHooks, key: []const u8) bool {
        const f = self.resolve_geometry orelse return true;
        return f(self.ctx, key);
    }
    fn capabilityOk(self: ResolveHooks, name: []const u8) bool {
        const f = self.resolve_capability orelse return true;
        return f(self.ctx, name);
    }
};

/// The slice-1 default: accept every geometry_key / capability name. The formation
/// is validated; resolvability is deferred to slice 2.
pub const accept_all: ResolveHooks = .{};

fn reject(reason: RejectReason, detail: []const u8) Result {
    return .{ .reject = .{ .reason = reason, .detail = detail } };
}

/// Validate a formation of bones + carried data. Returns a `Result` — never errors
/// on a malformed skeleton (those are `reject`); only allocation failure escapes.
/// `hooks` controls resolvability (pass `accept_all` for slice 1).
pub fn validate(alloc: std.mem.Allocator, skel: model.Skeleton, hooks: ResolveHooks) std.mem.Allocator.Error!Result {
    if (skel.bones.len == 0) return reject(.empty_formation, skel.id);

    // id → index, also the duplicate-id detector.
    var index = std.StringHashMap(u32).init(alloc);
    defer index.deinit();
    try index.ensureTotalCapacity(@intCast(skel.bones.len));
    for (skel.bones, 0..) |bone, i| {
        const gop = index.getOrPutAssumeCapacity(bone.id);
        if (gop.found_existing) return reject(.duplicate_bone_id, bone.id);
        gop.value_ptr.* = @intCast(i);
    }

    // Every parent resolves (or is root). Build a parent-index table for the cycle
    // walk in the same pass.
    const parent_idx = try alloc.alloc(?u32, skel.bones.len);
    defer alloc.free(parent_idx);
    for (skel.bones, 0..) |bone, i| {
        if (bone.parent) |pid| {
            const pe = index.get(pid) orelse return reject(.dangling_parent, bone.id);
            parent_idx[i] = pe;
        } else {
            parent_idx[i] = null; // root
        }
    }

    // No cycles: walk each bone's parent chain; revisiting the start, or exceeding
    // bones.len hops, is a cycle (this also catches a bone that is its own parent).
    for (0..skel.bones.len) |start| {
        var cur = parent_idx[start];
        var hops: usize = 0;
        while (cur) |p| {
            if (p == start) return reject(.cycle, skel.bones[start].id);
            hops += 1;
            if (hops > skel.bones.len) return reject(.cycle, skel.bones[start].id);
            cur = parent_idx[p];
        }
    }

    // Joints — on bones and on articulated mounts, validated the same way.
    for (skel.bones) |bone| {
        if (bone.joint) |j| if (!jointWellFormed(j)) return reject(.invalid_joint, bone.id);
    }
    for (skel.mounts) |m| {
        if (m.joint) |j| if (!jointWellFormed(j)) return reject(.invalid_joint, m.name);
    }

    // Carried bone-references — UNIFORM check across every carried section. No
    // per-type branch: each section just yields a bone_id, checked the same way.
    if (skel.meshes) |meshes| switch (meshes) {
        .per_bone => |items| for (items) |it| {
            if (!refPresent(&index, it.bone_id)) return reject(.carried_bone_missing, it.bone_id);
            if (!hooks.geometryOk(it.geometry_key)) return reject(.unresolved_geometry, it.geometry_key);
        },
        .skinned => |key| if (!hooks.geometryOk(key)) return reject(.unresolved_geometry, key),
    };
    for (skel.collision) |c| {
        if (c.bone_id) |bid| if (!refPresent(&index, bid)) return reject(.carried_bone_missing, bid);
        if (!hooks.capabilityOk(c.capability.name)) return reject(.unresolved_capability, c.capability.name);
    }
    for (skel.mounts) |m| {
        if (!refPresent(&index, m.bone_id)) return reject(.carried_bone_missing, m.bone_id);
    }
    for (skel.contacts) |ct| {
        if (!refPresent(&index, ct.bone_id)) return reject(.carried_bone_missing, ct.bone_id);
    }

    // Named-capability sections — resolvability only (no bone ref to check).
    if (skel.physics) |p| if (!hooks.capabilityOk(p.name)) return reject(.unresolved_capability, p.name);
    if (skel.animation) |a| if (!hooks.capabilityOk(a.name)) return reject(.unresolved_capability, a.name);
    for (skel.behaviors) |b| if (!hooks.capabilityOk(b.capability.name)) return reject(.unresolved_capability, b.capability.name);

    return .ok;
}

/// One carried bone-reference is valid iff its bone_id names a present bone. This
/// is the whole "no per-type branches" promise: every section's bone_id goes
/// through this one predicate.
fn refPresent(index: *const std.StringHashMap(u32), bone_id: []const u8) bool {
    return index.contains(bone_id);
}

/// A joint is well-formed iff: `fixed` is always fine; any other kind needs a
/// non-zero axis; and any present limit pair must satisfy min <= max.
fn jointWellFormed(j: model.Joint) bool {
    if (j.kind == .fixed) return true;
    const axis = j.axis orelse return false;
    const mag2 = axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2];
    if (mag2 < 1e-12) return false;
    if (j.limit_min) |lo| {
        if (j.limit_max) |hi| {
            if (lo > hi) return false;
        }
    }
    return true;
}
