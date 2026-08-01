//! Exact static triangle narrowphase for exported mesh props.
//!
//! The existing rect/oriented lanes remain the broadphase, camera, and semantic
//! building-piece representation. A v10 MESH_PROPS asset can additionally carry
//! its visible saved-Outliner triangles. This module resolves the game's vertical
//! player cylinder against those baked planes, so a sloped face does not inherit
//! the empty corner of its axis-aligned bounds.

const std = @import("std");

const Vec2 = struct { x: f32, z: f32 };
const Vec3 = struct { x: f32, y: f32, z: f32 };

pub const Transform = struct {
    x: f32 = 0,
    y: f32 = 0,
    z: f32 = 0,
    yaw_radians: f32 = 0,
    /// Uniform instance scale (req_3367 world-gizmo scaled props). The triangle
    /// payload stays the unscaled asset; resolve() works in the asset's local
    /// units by inverse-scaling the body, so contact math is exact at any scale.
    scale: f32 = 1,
};

pub const Body = struct {
    x: f32,
    y: f32,
    z: f32,
    vx: f32 = 0,
    vy: f32 = 0,
    vz: f32 = 0,
    radius: f32,
    height: f32,
    step_height: f32,
    restitution: f32 = 0,
    grounded: bool = false,
};

pub const Tuning = struct {
    // Same slope law as authored ramp heightfields.
    walkable_normal_y: f32 = 0.6,
    // Mirrors the rect lane's "feet are already on top" side-push clearance.
    top_side_clearance_meters: f32 = 0.04,
    // Keeps a resting body attached after the ordinary gravity integration.
    ground_snap_meters: f32 = 0.08,
    // Contact math below this scale is treated as coincident.
    coordinate_epsilon_meters: f32 = 0.0001,
    // Corners may need more than one plane projection, but the pass count stays
    // fixed so adversarial triangle soups cannot create an unbounded frame cost.
    solver_passes: usize = 3,
};

pub const DEFAULT_TUNING: Tuning = .{};

pub const Result = struct {
    side_contacts: usize = 0,
    grounded_on_mesh: bool = false,
    hit_ceiling: bool = false,
};

const Push = struct { x: f32, z: f32 };

fn vertex(triangles: []const f32, triangle: usize, corner: usize) Vec3 {
    const at = triangle * 9 + corner * 3;
    return .{ .x = triangles[at], .y = triangles[at + 1], .z = triangles[at + 2] };
}

fn normal(a: Vec3, b: Vec3, c: Vec3) Vec3 {
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    return .{
        .x = uy * vz - uz * vy,
        .y = uz * vx - ux * vz,
        .z = ux * vy - uy * vx,
    };
}

fn normalizedAbsY(n: Vec3) f32 {
    const length = @sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
    return if (length > 0.000001) @abs(n.y) / length else 0;
}

fn pointInsideProjectionBounds(a: Vec3, b: Vec3, c: Vec3, x: f32, z: f32, margin: f32) bool {
    return x + margin >= @min(a.x, @min(b.x, c.x)) and
        x - margin <= @max(a.x, @max(b.x, c.x)) and
        z + margin >= @min(a.z, @min(b.z, c.z)) and
        z - margin <= @max(a.z, @max(b.z, c.z));
}

fn overlapsVerticalRange(a: Vec3, b: Vec3, c: Vec3, lower_exclusive: f32, upper_exclusive: f32) bool {
    return @max(a.y, @max(b.y, c.y)) > lower_exclusive and
        @min(a.y, @min(b.y, c.y)) < upper_exclusive;
}

fn surfaceYAt(a: Vec3, b: Vec3, c: Vec3, x: f32, z: f32, epsilon: f32) ?f32 {
    const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (@abs(denominator) <= epsilon) return null;
    const wa = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denominator;
    const wb = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denominator;
    const wc = 1 - wa - wb;
    if (wa < -epsilon or wb < -epsilon or wc < -epsilon) return null;
    return wa * a.y + wb * b.y + wc * c.y;
}

fn walkableSurfaceAt(
    triangles: []const f32,
    x: f32,
    z: f32,
    lower_exclusive: f32,
    upper_inclusive: f32,
    tuning: Tuning,
) ?f32 {
    var best: ?f32 = null;
    const triangle_count = triangles.len / 9;
    for (0..triangle_count) |triangle| {
        const a = vertex(triangles, triangle, 0);
        const b = vertex(triangles, triangle, 1);
        const c = vertex(triangles, triangle, 2);
        // Most triangles in a detailed prop are nowhere near the player's
        // foot point. Cull on coordinate bounds before the cross-product and
        // barycentric work; the baked coarse boxes already culled whole props.
        if (!pointInsideProjectionBounds(a, b, c, x, z, 0)) continue;
        if (!overlapsVerticalRange(a, b, c, lower_exclusive, upper_inclusive + tuning.coordinate_epsilon_meters)) continue;
        if (normalizedAbsY(normal(a, b, c)) < tuning.walkable_normal_y) continue;
        const y = surfaceYAt(a, b, c, x, z, tuning.coordinate_epsilon_meters) orelse continue;
        if (y <= lower_exclusive or y > upper_inclusive) continue;
        if (best == null or y > best.?) best = y;
    }
    return best;
}

fn ceilingSurfaceAt(
    triangles: []const f32,
    x: f32,
    z: f32,
    feet_y: f32,
    head_y: f32,
    tuning: Tuning,
) ?f32 {
    var best: ?f32 = null;
    const triangle_count = triangles.len / 9;
    for (0..triangle_count) |triangle| {
        const a = vertex(triangles, triangle, 0);
        const b = vertex(triangles, triangle, 1);
        const c = vertex(triangles, triangle, 2);
        if (!pointInsideProjectionBounds(a, b, c, x, z, 0)) continue;
        if (!overlapsVerticalRange(a, b, c, feet_y + tuning.top_side_clearance_meters, head_y)) continue;
        if (normalizedAbsY(normal(a, b, c)) < tuning.walkable_normal_y) continue;
        const y = surfaceYAt(a, b, c, x, z, tuning.coordinate_epsilon_meters) orelse continue;
        if (y <= feet_y + tuning.top_side_clearance_meters or y >= head_y) continue;
        if (best == null or y < best.?) best = y;
    }
    return best;
}

fn insideY(point: Vec3, bound: f32, keep_above: bool, epsilon: f32) bool {
    return if (keep_above) point.y >= bound - epsilon else point.y <= bound + epsilon;
}

fn interpolateAtY(a: Vec3, b: Vec3, y: f32) Vec3 {
    const span = b.y - a.y;
    const t = if (@abs(span) > 0.000001) (y - a.y) / span else 0;
    return .{
        .x = a.x + (b.x - a.x) * t,
        .y = y,
        .z = a.z + (b.z - a.z) * t,
    };
}

fn clipAgainstY(input: []const Vec3, output: *[6]Vec3, bound: f32, keep_above: bool, epsilon: f32) usize {
    if (input.len == 0) return 0;
    var count: usize = 0;
    var previous = input[input.len - 1];
    var previous_inside = insideY(previous, bound, keep_above, epsilon);
    for (input) |current| {
        const current_inside = insideY(current, bound, keep_above, epsilon);
        if (current_inside != previous_inside) {
            output[count] = interpolateAtY(previous, current, bound);
            count += 1;
        }
        if (current_inside) {
            output[count] = current;
            count += 1;
        }
        previous = current;
        previous_inside = current_inside;
    }
    return count;
}

fn closestOnSegment(point: Vec2, a: Vec2, b: Vec2, epsilon: f32) Vec2 {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length2 = dx * dx + dz * dz;
    if (length2 <= epsilon * epsilon) return a;
    const t = std.math.clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / length2, 0, 1);
    return .{ .x = a.x + dx * t, .z = a.z + dz * t };
}

fn pointInConvexProjection(point: Vec2, polygon: []const Vec3, epsilon: f32) bool {
    if (polygon.len < 3) return false;
    var positive = false;
    var negative = false;
    var area2: f32 = 0;
    for (polygon, 0..) |a, index| {
        const b = polygon[(index + 1) % polygon.len];
        area2 += a.x * b.z - b.x * a.z;
        const cross = (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x);
        if (cross > epsilon) positive = true;
        if (cross < -epsilon) negative = true;
        if (positive and negative) return false;
    }
    return @abs(area2) > epsilon;
}

fn fallbackPushDirection(point: Vec2, velocity: Vec2, a: Vec3, b: Vec3, c: Vec3, epsilon: f32) Vec2 {
    const n = normal(a, b, c);
    var nx = n.x;
    var nz = n.z;
    var length = @sqrt(nx * nx + nz * nz);
    if (length <= epsilon) {
        nx = if (@abs(velocity.x) > @abs(velocity.z)) -std.math.sign(velocity.x) else 0;
        nz = if (nx == 0) -std.math.sign(velocity.z) else 0;
        length = @sqrt(nx * nx + nz * nz);
        if (length <= epsilon) return .{ .x = 1, .z = 0 };
    }
    nx /= length;
    nz /= length;
    const centroid = Vec2{ .x = (a.x + b.x + c.x) / 3, .z = (a.z + b.z + c.z) / 3 };
    var side = (point.x - centroid.x) * nx + (point.z - centroid.z) * nz;
    if (@abs(side) <= epsilon) side = -(velocity.x * nx + velocity.z * nz);
    if (side < 0) return .{ .x = -nx, .z = -nz };
    return .{ .x = nx, .z = nz };
}

fn projectedTrianglePush(
    point: Vec2,
    velocity: Vec2,
    radius: f32,
    feet_y: f32,
    head_y: f32,
    step_top_y: f32,
    a: Vec3,
    b: Vec3,
    c: Vec3,
    tuning: Tuning,
) ?Push {
    if (!overlapsVerticalRange(a, b, c, feet_y + tuning.top_side_clearance_meters, head_y)) return null;
    // The rect lane never side-pushes a solid whose top is within step reach
    // (grace_walkable / too_tall_to_step): its top is GROUND. Mirror that law: a
    // steep face topping out at/below feet + step_height is a stair riser, and
    // the mount pass (walkableSurfaceAt) owns seating the feet on the tread
    // behind it. Without this gate every riser of a placed staircase pushed like
    // a full wall, held the body's centre off the tread it should mount, and
    // step height was never consulted at all on the approach.
    if (@max(a.y, @max(b.y, c.y)) <= step_top_y) return null;
    if (!pointInsideProjectionBounds(a, b, c, point.x, point.z, radius)) return null;
    if (normalizedAbsY(normal(a, b, c)) >= tuning.walkable_normal_y) return null;

    const source = [_]Vec3{ a, b, c };
    var lower: [6]Vec3 = undefined;
    var clipped: [6]Vec3 = undefined;
    const lower_count = clipAgainstY(source[0..], &lower, feet_y, true, tuning.coordinate_epsilon_meters);
    const clipped_count = clipAgainstY(lower[0..lower_count], &clipped, head_y, false, tuning.coordinate_epsilon_meters);
    if (clipped_count < 2) return null;

    var closest = Vec2{ .x = clipped[0].x, .z = clipped[0].z };
    var closest_distance2 = std.math.floatMax(f32);
    for (clipped[0..clipped_count], 0..) |from, index| {
        const to = clipped[(index + 1) % clipped_count];
        const candidate = closestOnSegment(point, .{ .x = from.x, .z = from.z }, .{ .x = to.x, .z = to.z }, tuning.coordinate_epsilon_meters);
        const dx = point.x - candidate.x;
        const dz = point.z - candidate.z;
        const distance2 = dx * dx + dz * dz;
        if (distance2 < closest_distance2) {
            closest_distance2 = distance2;
            closest = candidate;
        }
    }

    const inside = pointInConvexProjection(point, clipped[0..clipped_count], tuning.coordinate_epsilon_meters);
    const distance: f32 = @sqrt(@max(@as(f32, 0), closest_distance2));
    if (!inside and distance >= radius) return null;

    var direction: Vec2 = undefined;
    var amount: f32 = undefined;
    if (distance <= tuning.coordinate_epsilon_meters) {
        direction = fallbackPushDirection(point, velocity, a, b, c, tuning.coordinate_epsilon_meters);
        amount = radius;
    } else if (inside) {
        direction = .{ .x = (closest.x - point.x) / distance, .z = (closest.z - point.z) / distance };
        amount = radius + distance;
    } else {
        direction = .{ .x = (point.x - closest.x) / distance, .z = (point.z - closest.z) / distance };
        amount = radius - distance;
    }
    return .{ .x = direction.x * amount, .z = direction.z * amount };
}

/// Resolve one vertical player cylinder against one placed triangle mesh.
/// `triangles` is local-frame xyz×3 and immutable: the asset is baked once;
/// only the instance transform and body state vary per frame.
pub fn resolve(body: *Body, triangles: []const f32, transform: Transform, world_tuning: Tuning) Result {
    var result: Result = .{};
    if (triangles.len == 0 or triangles.len % 9 != 0 or body.radius <= 0 or body.height <= 0) return result;

    const cs = @cos(transform.yaw_radians);
    const sn = @sin(transform.yaw_radians);
    // Uniform scale: solve in the asset's local units. Body extents divide by
    // the scale so a 2× prop presents 2× surfaces to a normal-sized player.
    const scale = if (transform.scale > 0) transform.scale else 1;
    const inv_scale = 1.0 / scale;
    const radius = body.radius * inv_scale;
    const height = body.height * inv_scale;
    const step_height = body.step_height * inv_scale;
    // Tuning distances are WORLD metres but the solve runs in local units, so
    // they inverse-scale exactly like the body extents — a 2× prop must not
    // read a doubled world snap band (nor a 0.5× prop a halved one).
    var tuning = world_tuning;
    tuning.top_side_clearance_meters *= inv_scale;
    tuning.ground_snap_meters *= inv_scale;
    const world_dx = body.x - transform.x;
    const world_dz = body.z - transform.z;
    var x = (cs * world_dx - sn * world_dz) * inv_scale;
    var z = (sn * world_dx + cs * world_dz) * inv_scale;
    var y = (body.y - transform.y) * inv_scale;
    var vx = (cs * body.vx - sn * body.vz) * inv_scale;
    var vz = (sn * body.vx + cs * body.vz) * inv_scale;

    if (body.vy > 0) {
        if (ceilingSurfaceAt(triangles, x, z, y, y + height, tuning)) |ceiling| {
            y = ceiling - height;
            body.vy = 0;
            result.hit_ceiling = true;
        }
    }

    // Pre-mount a walkable top within step reach so its vertical side does not
    // push the body away before the ordinary step-up law can seat the feet.
    if (body.vy <= 0) {
        if (walkableSurfaceAt(triangles, x, z, y - tuning.ground_snap_meters, y + step_height, tuning)) |ground| {
            y = ground;
            body.vy = 0;
            body.grounded = true;
            result.grounded_on_mesh = true;
        }
    }

    var pass: usize = 0;
    while (pass < tuning.solver_passes) : (pass += 1) {
        var pushed = false;
        const triangle_count = triangles.len / 9;
        for (0..triangle_count) |triangle| {
            const a = vertex(triangles, triangle, 0);
            const b = vertex(triangles, triangle, 1);
            const c = vertex(triangles, triangle, 2);
            const push = projectedTrianglePush(
                .{ .x = x, .z = z },
                .{ .x = vx, .z = vz },
                radius,
                y,
                y + height,
                y + step_height,
                a,
                b,
                c,
                tuning,
            ) orelse continue;
            x += push.x;
            z += push.z;
            const push_length: f32 = @sqrt(push.x * push.x + push.z * push.z);
            if (push_length > tuning.coordinate_epsilon_meters) {
                const nx = push.x / push_length;
                const nz = push.z / push_length;
                const into = vx * nx + vz * nz;
                if (into < 0) {
                    vx -= (1 + body.restitution) * into * nx;
                    vz -= (1 + body.restitution) * into * nz;
                }
            }
            pushed = true;
            result.side_contacts += 1;
        }
        if (!pushed) break;
    }

    // A side projection may move the body onto/off a different face. Re-evaluate
    // support at the final horizontal point; never clear grounding supplied by
    // the ordinary rect/heightfield lanes when no mesh top is present.
    if (body.vy <= 0) {
        if (walkableSurfaceAt(triangles, x, z, y - tuning.ground_snap_meters, y + step_height, tuning)) |ground| {
            y = ground;
            body.vy = 0;
            body.grounded = true;
            result.grounded_on_mesh = true;
        }
    }

    body.x = transform.x + (x * scale) * cs + (z * scale) * sn;
    body.y = transform.y + y * scale;
    body.z = transform.z - (x * scale) * sn + (z * scale) * cs;
    body.vx = (vx * cs + vz * sn) * scale;
    body.vz = (-vx * sn + vz * cs) * scale;
    return result;
}
