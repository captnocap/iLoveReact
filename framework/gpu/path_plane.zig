//! Closed screen pen path → one camera-facing mesh plane. The path is authored
//! in normalized viewport space, triangulated without convex-only shortcuts,
//! then projected onto the plane through the orbit focus. One strict boundary
//! supplies interleaved vertices + one logical face group to meshAppendGroup.

const std = @import("std");

const EPS: f32 = 1e-6;

pub const Mesh = struct {
    verts: []f32,
    groups: []u32,

    pub fn deinit(self: *Mesh, allocator: std.mem.Allocator) void {
        allocator.free(self.verts);
        allocator.free(self.groups);
        self.* = undefined;
    }
};

pub const Camera = struct { eye: [3]f32, target: [3]f32, fov_deg: f32 };

fn cross2(ax: f32, ay: f32, bx: f32, by: f32, cx: f32, cy: f32) f32 {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

fn pointInTriangle(points: []const f32, p: u32, a: u32, b: u32, c: u32, orientation: f32) bool {
    const px = points[@as(usize, p) * 2 + 0];
    const py = points[@as(usize, p) * 2 + 1];
    const ax = points[@as(usize, a) * 2 + 0];
    const ay = points[@as(usize, a) * 2 + 1];
    const bx = points[@as(usize, b) * 2 + 0];
    const by = points[@as(usize, b) * 2 + 1];
    const cx = points[@as(usize, c) * 2 + 0];
    const cy = points[@as(usize, c) * 2 + 1];
    return cross2(ax, ay, bx, by, px, py) * orientation >= -EPS and
        cross2(bx, by, cx, cy, px, py) * orientation >= -EPS and
        cross2(cx, cy, ax, ay, px, py) * orientation >= -EPS;
}

/// Ear-clip a simple concave polygon. Returned indices address `points` and
/// preserve its winding. Null means malformed, degenerate, or self-intersecting.
pub fn triangulate(allocator: std.mem.Allocator, points: []const f32) ?[]u32 {
    if (points.len < 6 or points.len % 2 != 0) return null;
    const count = points.len / 2;
    var area: f32 = 0;
    var i: usize = 0;
    while (i < count) : (i += 1) {
        const next = (i + 1) % count;
        const x = points[i * 2 + 0];
        const y = points[i * 2 + 1];
        const nx = points[next * 2 + 0];
        const ny = points[next * 2 + 1];
        if (!std.math.isFinite(x) or !std.math.isFinite(y)) return null;
        area += x * ny - nx * y;
    }
    if (@abs(area) <= EPS) return null;
    const orientation: f32 = if (area > 0) 1.0 else -1.0;

    const live = allocator.alloc(u32, count) catch return null;
    defer allocator.free(live);
    for (live, 0..) |*index, at| index.* = @intCast(at);
    var live_count = count;
    const result = allocator.alloc(u32, (count - 2) * 3) catch return null;
    var written: usize = 0;
    while (live_count > 3) {
        var ear_found = false;
        var at: usize = 0;
        while (at < live_count) : (at += 1) {
            const prev = live[(at + live_count - 1) % live_count];
            const current = live[at];
            const next = live[(at + 1) % live_count];
            const ax = points[@as(usize, prev) * 2 + 0];
            const ay = points[@as(usize, prev) * 2 + 1];
            const bx = points[@as(usize, current) * 2 + 0];
            const by = points[@as(usize, current) * 2 + 1];
            const cx = points[@as(usize, next) * 2 + 0];
            const cy = points[@as(usize, next) * 2 + 1];
            if (cross2(ax, ay, bx, by, cx, cy) * orientation <= EPS) continue;
            var contains = false;
            var other: usize = 0;
            while (other < live_count) : (other += 1) {
                const candidate = live[other];
                if (candidate == prev or candidate == current or candidate == next) continue;
                if (pointInTriangle(points, candidate, prev, current, next, orientation)) {
                    contains = true;
                    break;
                }
            }
            if (contains) continue;
            result[written + 0] = prev;
            result[written + 1] = current;
            result[written + 2] = next;
            written += 3;
            var shift = at;
            while (shift + 1 < live_count) : (shift += 1) live[shift] = live[shift + 1];
            live_count -= 1;
            ear_found = true;
            break;
        }
        if (!ear_found) {
            allocator.free(result);
            return null;
        }
    }
    result[written + 0] = live[0];
    result[written + 1] = live[1];
    result[written + 2] = live[2];
    return result;
}

fn sub(a: [3]f32, b: [3]f32) [3]f32 {
    return .{ a[0] - b[0], a[1] - b[1], a[2] - b[2] };
}
fn dot(a: [3]f32, b: [3]f32) f32 {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
fn cross(a: [3]f32, b: [3]f32) [3]f32 {
    return .{ a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0] };
}
fn normalize(a: [3]f32) [3]f32 {
    const length = @sqrt(dot(a, a));
    if (length <= EPS) return .{ 0, 0, 1 };
    return .{ a[0] / length, a[1] / length, a[2] / length };
}

const Ray = struct { o: [3]f32, d: [3]f32 };
fn cameraRay(camera: Camera, viewport_w: f32, viewport_h: f32, x: f32, y: f32) Ray {
    const aspect = viewport_w / viewport_h;
    const tan_half = @tan(camera.fov_deg * std.math.pi / 180.0 * 0.5);
    const ndc_x = 2.0 * x / viewport_w - 1.0;
    const ndc_y = 1.0 - 2.0 * y / viewport_h;
    const forward = normalize(sub(camera.target, camera.eye));
    const right = normalize(cross(forward, .{ 0, 1, 0 }));
    const up = cross(right, forward);
    return .{ .o = camera.eye, .d = normalize(.{
        ndc_x * tan_half * aspect * right[0] + ndc_y * tan_half * up[0] + forward[0],
        ndc_x * tan_half * aspect * right[1] + ndc_y * tan_half * up[1] + forward[1],
        ndc_x * tan_half * aspect * right[2] + ndc_y * tan_half * up[2] + forward[2],
    }) };
}

/// Project every normalized viewport point onto the plane through the orbit focus,
/// perpendicular to the view. Null when a point leaves the viewport or its ray
/// grazes the plane. Caller owns the returned world positions.
fn projectToFocusPlane(
    allocator: std.mem.Allocator,
    points: []const f32,
    camera: Camera,
    viewport_w: f32,
    viewport_h: f32,
) ?[][3]f32 {
    const point_count = points.len / 2;
    const world = allocator.alloc([3]f32, point_count) catch return null;
    const plane_normal = normalize(sub(camera.target, camera.eye));
    for (world, 0..) |*destination, index| {
        const nx = points[index * 2 + 0];
        const ny = points[index * 2 + 1];
        if (nx < 0 or nx > 1 or ny < 0 or ny > 1) {
            allocator.free(world);
            return null;
        }
        const ray = cameraRay(camera, viewport_w, viewport_h, nx * viewport_w, ny * viewport_h);
        const denominator = dot(ray.d, plane_normal);
        if (@abs(denominator) <= EPS) {
            allocator.free(world);
            return null;
        }
        const distance = dot(sub(camera.target, ray.o), plane_normal) / denominator;
        if (distance <= EPS) {
            allocator.free(world);
            return null;
        }
        destination.* = .{
            ray.o[0] + ray.d[0] * distance,
            ray.o[1] + ray.d[1] * distance,
            ray.o[2] + ray.d[2] * distance,
        };
    }
    return world;
}

/// The pen path as naked EDGES: one zero-area render triangle (a, b, b) per segment
/// carries each wire edge through the ordinary triangle-soup part transaction — no
/// fill face is authored. mesh_edit's welded topology reads the repeated corner back
/// as a single real boundary edge, so a committed wire is immediately selectable and
/// gizmo-draggable vertex by vertex. Open paths are legal; closed adds the return
/// segment. Consecutive duplicate points contribute no segment.
pub fn buildWire(
    allocator: std.mem.Allocator,
    points: []const f32,
    closed: bool,
    camera: Camera,
    viewport_w: f32,
    viewport_h: f32,
) ?Mesh {
    if (viewport_w <= 0 or viewport_h <= 0) return null;
    if (points.len < 4 or points.len % 2 != 0) return null;
    const point_count = points.len / 2;
    if (closed and point_count < 3) return null;
    const world = projectToFocusPlane(allocator, points, camera, viewport_w, viewport_h) orelse return null;
    defer allocator.free(world);

    // The wire's carried normal looks back at the authoring eye — degenerate
    // triangles never rasterize, but readers of the soup still get a finite one.
    const normal = normalize(sub(camera.eye, camera.target));
    const segment_count = if (closed) point_count else point_count - 1;
    var verts = std.ArrayListUnmanaged(f32).empty;
    errdefer verts.deinit(allocator);
    var segments_written: usize = 0;
    var segment: usize = 0;
    while (segment < segment_count) : (segment += 1) {
        const a = world[segment];
        const b = world[(segment + 1) % point_count];
        const gap = sub(b, a);
        if (dot(gap, gap) <= EPS * EPS) continue;
        const corners = [3][3]f32{ a, b, b };
        for (corners) |corner| {
            const row = [8]f32{ corner[0], corner[1], corner[2], normal[0], normal[1], normal[2], 0, 0 };
            verts.appendSlice(allocator, row[0..]) catch {
                verts.deinit(allocator);
                return null;
            };
        }
        segments_written += 1;
    }
    if (segments_written == 0) {
        verts.deinit(allocator);
        return null;
    }
    const groups = allocator.alloc(u32, segments_written) catch {
        verts.deinit(allocator);
        return null;
    };
    @memset(groups, 0);
    const owned = verts.toOwnedSlice(allocator) catch {
        verts.deinit(allocator);
        allocator.free(groups);
        return null;
    };
    return .{ .verts = owned, .groups = groups };
}

/// Project and triangulate a normalized viewport path on the camera-focus plane.
pub fn build(
    allocator: std.mem.Allocator,
    points: []const f32,
    camera: Camera,
    viewport_w: f32,
    viewport_h: f32,
) ?Mesh {
    if (viewport_w <= 0 or viewport_h <= 0) return null;
    const triangles = triangulate(allocator, points) orelse return null;
    defer allocator.free(triangles);
    const point_count = points.len / 2;
    const world = projectToFocusPlane(allocator, points, camera, viewport_w, viewport_h) orelse return null;
    defer allocator.free(world);

    var min_x: f32 = 1.0;
    var min_y: f32 = 1.0;
    var max_x: f32 = 0.0;
    var max_y: f32 = 0.0;
    var i: usize = 0;
    while (i < point_count) : (i += 1) {
        min_x = @min(min_x, points[i * 2 + 0]);
        min_y = @min(min_y, points[i * 2 + 1]);
        max_x = @max(max_x, points[i * 2 + 0]);
        max_y = @max(max_y, points[i * 2 + 1]);
    }
    const span_x = @max(EPS, max_x - min_x);
    const span_y = @max(EPS, max_y - min_y);
    const verts = allocator.alloc(f32, triangles.len * 8) catch return null;
    errdefer allocator.free(verts);
    const groups = allocator.alloc(u32, triangles.len / 3) catch return null;
    @memset(groups, 0);
    var triangle: usize = 0;
    while (triangle < triangles.len) : (triangle += 3) {
        const ia = triangles[triangle + 0];
        var ib = triangles[triangle + 1];
        var ic = triangles[triangle + 2];
        const a = world[ia];
        var b = world[ib];
        var c = world[ic];
        var normal = normalize(cross(sub(b, a), sub(c, a)));
        // Back-face culling is active: every generated triangle must face the
        // camera regardless of whether the author wound the screen path CW/CCW.
        if (dot(normal, sub(camera.eye, a)) < 0) {
            const swap = ib;
            ib = ic;
            ic = swap;
            b = world[ib];
            c = world[ic];
            normal = normalize(cross(sub(b, a), sub(c, a)));
        }
        const ids = [3]u32{ ia, ib, ic };
        for (ids, 0..) |point_index, corner| {
            const vertex = triangle + corner;
            const position = world[point_index];
            verts[vertex * 8 + 0] = position[0];
            verts[vertex * 8 + 1] = position[1];
            verts[vertex * 8 + 2] = position[2];
            verts[vertex * 8 + 3] = normal[0];
            verts[vertex * 8 + 4] = normal[1];
            verts[vertex * 8 + 5] = normal[2];
            verts[vertex * 8 + 6] = (points[@as(usize, point_index) * 2 + 0] - min_x) / span_x;
            verts[vertex * 8 + 7] = (points[@as(usize, point_index) * 2 + 1] - min_y) / span_y;
        }
    }
    return .{ .verts = verts, .groups = groups };
}
