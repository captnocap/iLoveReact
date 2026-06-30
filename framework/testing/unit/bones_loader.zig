//! Unit proof for framework/skeleton/bones_loader.zig — the generic skeleton
//! VALIDATOR (slice 1 of the Skeleton Object Model).
//!
//! Run: zig build test-bones-loader
//!
//! The validator's contract: accept ANY valid formation of bones + carried data
//! (a 1-bone static prop, a multi-bone articulated formation), and reject a
//! malformed one (cycle, dangling parent, duplicate id, bad joint, a carried ref
//! to an absent bone) — with NO per-type branches. These tests pin both sides.

const std = @import("std");
const testing = std.testing;
const bl = @import("bones_loader");
const sk = bl.model;

fn expectAccepted(skel: sk.Skeleton) !void {
    const r = try bl.validate(testing.allocator, skel, bl.accept_all);
    try testing.expect(r.accepted());
}

fn expectRejected(skel: sk.Skeleton, reason: bl.RejectReason) !void {
    const r = try bl.validate(testing.allocator, skel, bl.accept_all);
    try testing.expect(!r.accepted());
    try testing.expectEqual(reason, r.reject.reason);
}

// ── ACCEPT ────────────────────────────────────────────────────────────────────

test "accept: a valid 1-bone static prop (one bone, one mesh, a collider)" {
    const bones = [_]sk.Bone{.{ .id = "root" }};
    const meshes = [_]sk.MeshAssignment{.{ .bone_id = "root", .geometry_key = "crate" }};
    const colliders = [_]sk.Collider{.{ .capability = .{ .name = "box" } }};
    try expectAccepted(.{
        .id = "crate",
        .bones = &bones,
        .static = true,
        .meshes = .{ .per_bone = &meshes },
        .collision = &colliders,
    });
}

test "accept: a multi-bone articulated formation (vehicle: chassis + spun wheels + hinged door)" {
    const bones = [_]sk.Bone{
        .{ .id = "chassis" },
        .{ .id = "axle-f", .parent = "chassis" },
        .{ .id = "wheel-fl", .parent = "axle-f", .joint = .{ .kind = .spin, .axis = .{ 1, 0, 0 } } },
        .{ .id = "door-l", .parent = "chassis", .joint = .{ .kind = .hinge, .axis = .{ 0, 1, 0 }, .limit_min = 0, .limit_max = 1.5 } },
    };
    const mounts = [_]sk.Mount{
        .{ .name = "seat-0", .bone_id = "chassis" },
        .{ .name = "wheel-fl", .bone_id = "axle-f", .joint = .{ .kind = .spin, .axis = .{ 1, 0, 0 } } },
    };
    const contacts = [_]sk.Contact{.{ .name = "driver", .bone_id = "chassis" }};
    const behaviors = [_]sk.NamedBehavior{.{ .name = "roll", .capability = .{ .name = "wheel.roll" }, .mount = "wheel-fl" }};
    const meshes = [_]sk.MeshAssignment{.{ .bone_id = "chassis", .geometry_key = "car-body" }};
    try expectAccepted(.{
        .id = "car",
        .bones = &bones,
        .meshes = .{ .per_bone = &meshes },
        .mounts = &mounts,
        .contacts = &contacts,
        .behaviors = &behaviors,
        .physics = .{ .name = "rigidbody", .params_json = "{\"mass\":1200}" },
    });
}

test "accept: a skinned-mesh player rig (one mesh skinned across the formation)" {
    const bones = [_]sk.Bone{
        .{ .id = "pelvis" },
        .{ .id = "spine", .parent = "pelvis" },
        .{ .id = "head", .parent = "spine" },
    };
    try expectAccepted(.{
        .id = "player",
        .bones = &bones,
        .meshes = .{ .skinned = "body-skin" },
        .animation = .{ .name = "humanoid.locomotion" },
    });
}

// ── REJECT ──────────────────────────────────────────────────────────────────────

test "reject: empty formation" {
    try expectRejected(.{ .id = "nothing", .bones = &.{} }, .empty_formation);
}

test "reject: a cycle in the parent graph" {
    const bones = [_]sk.Bone{
        .{ .id = "a", .parent = "b" },
        .{ .id = "b", .parent = "a" },
    };
    try expectRejected(.{ .id = "loop", .bones = &bones }, .cycle);
}

test "reject: a bone that is its own parent is a cycle" {
    const bones = [_]sk.Bone{.{ .id = "a", .parent = "a" }};
    try expectRejected(.{ .id = "selfloop", .bones = &bones }, .cycle);
}

test "reject: a dangling parent reference" {
    const bones = [_]sk.Bone{
        .{ .id = "root" },
        .{ .id = "child", .parent = "ghost" },
    };
    try expectRejected(.{ .id = "dangle", .bones = &bones }, .dangling_parent);
}

test "reject: a duplicate bone id" {
    const bones = [_]sk.Bone{
        .{ .id = "root" },
        .{ .id = "root" },
    };
    try expectRejected(.{ .id = "dup", .bones = &bones }, .duplicate_bone_id);
}

test "reject: a non-fixed joint with no axis" {
    const bones = [_]sk.Bone{.{ .id = "root", .joint = .{ .kind = .hinge } }};
    try expectRejected(.{ .id = "badjoint", .bones = &bones }, .invalid_joint);
}

test "reject: a joint with an inverted limit range" {
    const bones = [_]sk.Bone{.{ .id = "root", .joint = .{ .kind = .hinge, .axis = .{ 0, 1, 0 }, .limit_min = 2, .limit_max = 1 } }};
    try expectRejected(.{ .id = "badlimit", .bones = &bones }, .invalid_joint);
}

test "reject: a mesh referencing an absent bone" {
    const bones = [_]sk.Bone{.{ .id = "root" }};
    const meshes = [_]sk.MeshAssignment{.{ .bone_id = "ghost", .geometry_key = "crate" }};
    try expectRejected(.{ .id = "badmesh", .bones = &bones, .meshes = .{ .per_bone = &meshes } }, .carried_bone_missing);
}

test "reject: a mount referencing an absent bone (same uniform check)" {
    const bones = [_]sk.Bone{.{ .id = "root" }};
    const mounts = [_]sk.Mount{.{ .name = "grip", .bone_id = "ghost" }};
    try expectRejected(.{ .id = "badmount", .bones = &bones, .mounts = &mounts }, .carried_bone_missing);
}

// ── slice-2 hook: resolvability is deferred but wired ────────────────────────────

test "hook: a custom geometry resolver can reject an unresolved geometry key" {
    const bones = [_]sk.Bone{.{ .id = "root" }};
    const meshes = [_]sk.MeshAssignment{.{ .bone_id = "root", .geometry_key = "missing" }};
    const skel = sk.Skeleton{ .id = "p", .bones = &bones, .meshes = .{ .per_bone = &meshes } };

    const Resolver = struct {
        fn geo(_: ?*anyopaque, key: []const u8) bool {
            return !std.mem.eql(u8, key, "missing");
        }
    };
    const hooks = bl.ResolveHooks{ .resolve_geometry = Resolver.geo };
    const r = try bl.validate(testing.allocator, skel, hooks);
    try testing.expect(!r.accepted());
    try testing.expectEqual(bl.RejectReason.unresolved_geometry, r.reject.reason);

    // Under the slice-1 default (accept_all) the SAME formation validates.
    try expectAccepted(skel);
}
