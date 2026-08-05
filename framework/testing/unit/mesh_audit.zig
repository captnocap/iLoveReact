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

    const facts = mesh_audit.audit(allocator, verts.items, faces(verts), .{}, null);
    try testing.expect(facts.computed);
    try testing.expectEqual(@as(u32, 0), facts.intersecting);
    try testing.expectEqual(@as(u32, 0), facts.unreachable_faces);
}

test "a closed box is fully reachable from outside and never self-intersects" {
    const allocator = testing.allocator;
    var verts: std.ArrayListUnmanaged(f32) = .empty;
    defer verts.deinit(allocator);
    try box(&verts, allocator, .{ 0, 0, 0 }, .{ 1, 1, 1 });

    const facts = mesh_audit.audit(allocator, verts.items, faces(verts), .{}, null);
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

    const facts = mesh_audit.audit(allocator, verts.items, faces(verts), .{}, null);
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

    const facts = mesh_audit.audit(allocator, verts.items, faces(verts), .{}, null);
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

    const facts = mesh_audit.audit(allocator, verts.items, faces(verts), .{}, null);
    try testing.expect(facts.computed);
    // Perfect contact is not penetration. This is the case a naive overlap test gets
    // wrong, and the case a user would legitimately author before welding a seam.
    try testing.expectEqual(@as(u32, 0), facts.intersecting);
}

test "a T-junction join at a direction change is contact, not penetration" {
    // The req_3808 failure shape, lifted from the police_sedan wheel wells: bounded
    // cuts leave a vertex resting mid-edge of a neighbouring face, and the joined
    // geometry changes direction there. No interior is crossed anywhere, but the old
    // edge-ray test registered the boundary graze (barycentric u/v/w of exactly 0 or
    // 1) and reported 16 phantom "intersecting" triangles on an honestly built car.
    const allocator = testing.allocator;
    var verts: std.ArrayListUnmanaged(f32) = .empty;
    defer verts.deinit(allocator);

    // Big face in the z=0 plane, bottom edge from (0,0,0) to (2,0,0).
    try tri(&verts, allocator, .{ 0, 0, 0 }, .{ 2, 0, 0 }, .{ 1, 2, 0 });
    // A tilted face whose corner rests exactly mid-edge at (0.6,0,0) — no shared
    // vertex, angled off the big face's plane. The sedan's notch-cut far end on the
    // nose face's bottom edge.
    try tri(&verts, allocator, .{ 0.6, 0, 0 }, .{ 1.1, -1, 0.5 }, .{ 0.1, -1, 0.5 });
    // A wall rising off the LINE of the big face's bottom edge, its feet mid-edge —
    // the wheel-well wall standing on the underbody quad's boundary.
    try tri(&verts, allocator, .{ 1.2, 0, 0 }, .{ 1.8, 0, 0.001 }, .{ 1.5, -1.2, 0.4 });

    const facts = mesh_audit.audit(allocator, verts.items, faces(verts), .{}, null);
    try testing.expect(facts.computed);
    try testing.expectEqual(@as(u32, 0), facts.intersecting);
}

test "a genuine stab through a face interior still counts" {
    // Control for the T-junction case: the same big face, but the second triangle
    // actually passes THROUGH its interior — corners strictly on both sides.
    const allocator = testing.allocator;
    var verts: std.ArrayListUnmanaged(f32) = .empty;
    defer verts.deinit(allocator);

    try tri(&verts, allocator, .{ 0, 0, 0 }, .{ 2, 0, 0 }, .{ 1, 2, 0 });
    try tri(&verts, allocator, .{ 1, 0.5, -0.5 }, .{ 1.4, 0.9, 0.5 }, .{ 0.6, 0.9, 0.5 });

    const facts = mesh_audit.audit(allocator, verts.items, faces(verts), .{}, null);
    try testing.expect(facts.computed);
    try testing.expectEqual(@as(u32, 2), facts.intersecting);
}

test "an interior sealed behind GLASS is reachable — glass never blocks rays" {
    // The police_sedan failure shape (req_3763 P3-1): seats inside a glazed cabin
    // reported unreachable because the audit treated glass as opaque. With the
    // shell marked transparent, the inner box is reachable; with no transparency
    // rows the same fixture still counts 12 buried faces (the opaque baseline).
    const allocator = testing.allocator;
    var verts: std.ArrayListUnmanaged(f32) = .empty;
    defer verts.deinit(allocator);
    try box(&verts, allocator, .{ 0, 0, 0 }, .{ 4, 4, 4 }); // the glazed shell
    try box(&verts, allocator, .{ 1, 1, 1 }, .{ 2, 2, 2 }); // the interior

    const face_count = faces(verts);
    const transparent = try allocator.alloc(bool, face_count);
    defer allocator.free(transparent);
    @memset(transparent[0..12], true); // shell faces are glass
    @memset(transparent[12..], false);

    const through_glass = mesh_audit.audit(allocator, verts.items, face_count, .{}, transparent);
    try testing.expect(through_glass.computed);
    try testing.expectEqual(@as(u32, 0), through_glass.unreachable_faces);
    // Glass changes reachability ONLY — the intersection fact is untouched.
    try testing.expectEqual(@as(u32, 0), through_glass.intersecting);

    const opaque_shell = mesh_audit.audit(allocator, verts.items, face_count, .{}, null);
    try testing.expectEqual(@as(u32, 12), opaque_shell.unreachable_faces);
}

test "over budget reports NOT MEASURED instead of an unearned zero" {
    const allocator = testing.allocator;
    var verts: std.ArrayListUnmanaged(f32) = .empty;
    defer verts.deinit(allocator);
    try box(&verts, allocator, .{ 0, 0, 0 }, .{ 1, 1, 1 });

    const facts = mesh_audit.audit(allocator, verts.items, faces(verts), .{ .max_faces = 4 }, null);
    try testing.expect(!facts.computed);
    try testing.expectEqual(@as(u32, 0), facts.intersecting);
    try testing.expectEqual(@as(u32, 0), facts.unreachable_faces);
}
