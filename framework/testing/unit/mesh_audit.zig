//! The two hard facts reported beside every seat operation (req_3749).
//! Run: tools/zig/zig build test-mesh-audit
//!
//! Fixtures are hand-checkable on purpose: a lone triangle, a closed cube, a cube
//! sealed inside another cube (burial with NO penetration), and two cubes driven
//! through each other (penetration). The pair that matters most is #3 vs #4 — they
//! prove the counts are independent, which is the whole reason there are two.

const std = @import("std");
const testing = std.testing;
const mesh_audit = @import("mesh_audit");

/// Append one triangle in the resident edit layout: 8 floats per vertex, position in
/// the first three, the rest untouched by the audit.
fn tri(out: *std.ArrayListUnmanaged(f32), allocator: std.mem.Allocator, a: [3]f32, b: [3]f32, c: [3]f32) !void {
    for ([_][3]f32{ a, b, c }) |p| {
        try out.appendSlice(allocator, &[_]f32{ p[0], p[1], p[2], 0, 0, 0, 0, 0 });
    }
}

/// A closed axis-aligned box, 12 triangles, every face wound counter-clockwise seen
/// from OUTSIDE so `cross(b-a, c-a)` points away from the interior. The audit samples
/// each face's front side, so winding is load-bearing here.
fn box(out: *std.ArrayListUnmanaged(f32), allocator: std.mem.Allocator, lo: [3]f32, hi: [3]f32) !void {
    const p000 = [3]f32{ lo[0], lo[1], lo[2] };
    const p100 = [3]f32{ hi[0], lo[1], lo[2] };
    const p110 = [3]f32{ hi[0], hi[1], lo[2] };
    const p010 = [3]f32{ lo[0], hi[1], lo[2] };
    const p001 = [3]f32{ lo[0], lo[1], hi[2] };
    const p101 = [3]f32{ hi[0], lo[1], hi[2] };
    const p111 = [3]f32{ hi[0], hi[1], hi[2] };
    const p011 = [3]f32{ lo[0], hi[1], hi[2] };
    const quads = [_][4][3]f32{
        .{ p001, p101, p111, p011 }, // +Z
        .{ p100, p000, p010, p110 }, // -Z
        .{ p101, p100, p110, p111 }, // +X
        .{ p000, p001, p011, p010 }, // -X
        .{ p010, p011, p111, p110 }, // +Y
        .{ p000, p100, p101, p001 }, // -Y
    };
    for (quads) |q| {
        try tri(out, allocator, q[0], q[1], q[2]);
        try tri(out, allocator, q[0], q[2], q[3]);
    }
}

fn faces(verts: std.ArrayListUnmanaged(f32)) u32 {
    return @intCast(verts.items.len / 24);
}

test "a lone triangle is reachable and intersects nothing" {
    const allocator = testing.allocator;
    var verts: std.ArrayListUnmanaged(f32) = .empty;
    defer verts.deinit(allocator);
    try tri(&verts, allocator, .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 0, 1, 0 });

    const facts = mesh_audit.audit(allocator, verts.items, faces(verts), .{});
    try testing.expect(facts.computed);
    try testing.expectEqual(@as(u32, 0), facts.intersecting);
    try testing.expectEqual(@as(u32, 0), facts.unreachable_faces);
}

test "a closed box is fully reachable from outside and never self-intersects" {
    const allocator = testing.allocator;
    var verts: std.ArrayListUnmanaged(f32) = .empty;
    defer verts.deinit(allocator);
    try box(&verts, allocator, .{ 0, 0, 0 }, .{ 1, 1, 1 });

    const facts = mesh_audit.audit(allocator, verts.items, faces(verts), .{});
    try testing.expect(facts.computed);
    try testing.expectEqual(@as(u32, 12), faces(verts));
    // Adjacent faces share edges everywhere; sharing an edge is correct topology.
    try testing.expectEqual(@as(u32, 0), facts.intersecting);
    try testing.expectEqual(@as(u32, 0), facts.unreachable_faces);
}

test "a box sealed inside another box is buried WITHOUT any penetration" {
    const allocator = testing.allocator;
    var verts: std.ArrayListUnmanaged(f32) = .empty;
    defer verts.deinit(allocator);
    try box(&verts, allocator, .{ 0, 0, 0 }, .{ 4, 4, 4 }); // shell
    try box(&verts, allocator, .{ 1, 1, 1 }, .{ 2, 2, 2 }); // fully contained

    const facts = mesh_audit.audit(allocator, verts.items, faces(verts), .{});
    try testing.expect(facts.computed);
    try testing.expectEqual(@as(u32, 24), faces(verts));
    // Nothing touches anything: the surfaces never cross.
    try testing.expectEqual(@as(u32, 0), facts.intersecting);
    // The inner box's 12 triangles cannot be reached from any direction.
    try testing.expectEqual(@as(u32, 12), facts.unreachable_faces);
}

test "two boxes driven through each other are counted as penetrating" {
    const allocator = testing.allocator;
    var verts: std.ArrayListUnmanaged(f32) = .empty;
    defer verts.deinit(allocator);
    try box(&verts, allocator, .{ 0, 0, 0 }, .{ 2, 2, 2 });
    try box(&verts, allocator, .{ 1, 1, 1 }, .{ 3, 3, 3 }); // corner-overlaps the first

    const facts = mesh_audit.audit(allocator, verts.items, faces(verts), .{});
    try testing.expect(facts.computed);
    try testing.expect(facts.intersecting > 0);
    // Overlapping corners leave interior slivers no ray can leave.
    try testing.expect(facts.unreachable_faces > 0);
}

test "faces that merely touch at a shared plane do not count as penetrating" {
    const allocator = testing.allocator;
    var verts: std.ArrayListUnmanaged(f32) = .empty;
    defer verts.deinit(allocator);
    try box(&verts, allocator, .{ 0, 0, 0 }, .{ 1, 1, 1 });
    try box(&verts, allocator, .{ 1, 0, 0 }, .{ 2, 1, 1 }); // shares the x=1 plane exactly

    const facts = mesh_audit.audit(allocator, verts.items, faces(verts), .{});
    try testing.expect(facts.computed);
    // Perfect contact is not penetration. This is the case a naive overlap test gets
    // wrong, and the case a user would legitimately author before welding a seam.
    try testing.expectEqual(@as(u32, 0), facts.intersecting);
}

test "over budget reports NOT MEASURED instead of an unearned zero" {
    const allocator = testing.allocator;
    var verts: std.ArrayListUnmanaged(f32) = .empty;
    defer verts.deinit(allocator);
    try box(&verts, allocator, .{ 0, 0, 0 }, .{ 1, 1, 1 });

    const facts = mesh_audit.audit(allocator, verts.items, faces(verts), .{ .max_faces = 4 });
    try testing.expect(!facts.computed);
    try testing.expectEqual(@as(u32, 0), facts.intersecting);
    try testing.expectEqual(@as(u32, 0), facts.unreachable_faces);
}
