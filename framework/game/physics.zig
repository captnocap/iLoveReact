//! framework/game/physics.zig — the game's host-side physics sim (V1).
//!
//! ONE coherent system: player locomotion (via framework/game/movement.zig,
//! V7), gravity, collision against flat axis-aligned rects, yawed oriented
//! rects, and bilinear heightfield terrain, plus the spawned-entity sphere
//! sim. Graduated out of framework/v8_bindings_physics_lab.zig (2026-06);
//! that file keeps only the __physics_lab_* toy world. The V8 registrar for
//! THIS module is framework/v8_bindings_game_physics.zig, which preserves the
//! host-fn names cart JS grew up with (__hmsc_physics_step etc.).
//!
//! The bridge contract (repo revealed preference): cross the JS↔host bridge
//! ONCE per frame with a packed f32 buffer rather than maintain per-body node
//! bindings to a general engine.
//!
//! Input buffer (f32):
//!   [0]  dt                      [13] rect count
//!   [1]  move x                  [14] gravity
//!   [2]  move z                  [15] jump speed
//!   [3]  speed                   [16] player radius
//!   [4]  jump down (>0.5)        [17] player height
//!   [5..7]  player x,y,z         [18] wall restitution
//!   [8..10] player vx,vy,vz      [19] body restitution (reserved, unused)
//!   [11] (reserved)              [20] step height
//!   [12] entity count            [21] acceleration multiplier
//!                                [22] player surface friction
//!                                [23] player surface restitution
//!                                [24] oriented rect count
//!   then entity_count × ENTITY_FLOATS  [x,y,z,vx,vy,vz,r,restitution]
//!   then rect_count   × RECT_FLOATS    (see below)
//!   then oriented_count × ORIENTED_FLOATS
//!
//! Output snapshot (f32):
//!   [0] host µs (stamped by the registrar) · [1..3] player x,y,z ·
//!   [4..6] player vx,vy,vz · [7] grounded · [8] entity count ·
//!   then entity_count × ENTITY_FLOATS [x,y,z,vx,vy,vz,r,grounded]
//!
//! Pure math — no V8, no SDL, no engine import. Behavior-tested in
//! framework/testing/unit/game_physics.zig.

const std = @import("std");
pub const movement = @import("movement.zig");

pub const MAX_ENTITIES: usize = 128;
pub const MAX_RECTS: usize = 512;
pub const MAX_ORIENTED: usize = 256;
pub const INPUT_HEADER_FLOATS: usize = 25;
pub const ENTITY_FLOATS: usize = 8;
// A rect is [minX, minZ, maxX, maxZ, top, solid, friction, restitution, floor].
// `floor` (index 8) is the BOTTOM of the solid band: the rect blocks horizontally
// only while the body overlaps [floor, top], so a thin platform (floor = top −
// thickness) is solid to stand ON yet open to walk UNDER — the primitive that
// makes stacked parking decks, overpasses, and mezzanines possible. A normal wall
// passes floor = −∞ so it stays solid to the ground exactly as before.
// Standing-on-top is unchanged (the top + step-height gate already only grounds
// you when your feet are within a step of the top, so a deck overhead never
// snaps a player on the floor below up onto it).
pub const RECT_FLOATS: usize = 9;
// An oriented rect: the same 9-float AABB in the building's OWN un-rotated frame,
// then [pivotX, pivotZ, yawRadians]. The sim tests a point by rotating it into
// that frame about the pivot (inverse of the mesh's +Y yaw) and reusing the AABB
// math; a push is rotated back out. yaw 0 would be identical to an AABB rect, so
// only rotated buildings are sent here (state/hostPhysics.ts physicsOrientedRects).
pub const ORIENTED_FLOATS: usize = 12;
pub const OUTPUT_HEADER_FLOATS: usize = 9;
pub const OUTPUT_FLOATS: usize = OUTPUT_HEADER_FLOATS + MAX_ENTITIES * ENTITY_FLOATS;

// ── Heightfield colliders ──────────────────────────────────────────────
// A generic terrain collider: a cols×rows grid of corner heights the sim
// samples bilinearly to get the ground under a point, plus a per-field walk
// slope cosine. Surfaces flatter than the limit (normal.y >= walk_cos) are
// walkable ground you stand on; steeper ones are walls you can't ascend. The
// sim knows ZERO shapes — TS bakes the grid (a cone, a carved trail, anything)
// the same way it bakes a Heightfield mesh, registers it once via
// __hmsc_register_heightfield, and the step samples it every frame. This is what
// makes hit detection follow a real slope instead of a stack of flat boxes.
// 64 slots × HF_MAX_SAMPLES f32 = ~4 MB of static memory — negligible for a
// desktop binary (one tile texture dwarfs it), and the per-frame step only samples
// ACTIVE fields, so an empty slot is free. Headroom for many heightfield-floored
// structures (garages, ramps, overpasses) on top of the terrain landforms.
pub const MAX_HEIGHTFIELDS: usize = 64;
// Must fit hmsc-int's tile-resolution painted chunks: one collider sample per tile,
// 121×121 = 14,641 over a 120-tile chunk (mesh and collider share the field, so
// see-it==walk-it). The old 8192 cap rejected that whole field — count >
// HF_MAX_SAMPLES registers NO collider, so a tile-res painted chunk would have
// rendered but had no collision (walk straight through it).
pub const HF_MAX_SAMPLES: usize = 16384; // up to a 127×127 grid (121×121 = 14,641 fits)

const Heightfield = struct {
    active: bool = false,
    origin_x: f32 = 0, // world position of sample (0,0)
    origin_z: f32 = 0,
    cell: f32 = 1, // world meters between samples
    cols: usize = 0,
    rows: usize = 0,
    base_y: f32 = 0, // world Y the stored heights are measured above
    walk_cos: f32 = 1, // cos(slope limit): normal.y >= this ⇒ walkable
    // Rotation of the grid about (pivot_x, pivot_z), radians +Y. 0 = axis-aligned
    // (mountains/hills/painted terrain). A rotated building's heightfield floor (a
    // parking garage) sets these so the ramp you walk follows the rotated model.
    yaw: f32 = 0,
    pivot_x: f32 = 0,
    pivot_z: f32 = 0,
    samples: [HF_MAX_SAMPLES]f32 = [_]f32{0} ** HF_MAX_SAMPLES,
};

pub const HeightfieldDesc = struct {
    id: usize,
    origin_x: f32,
    origin_z: f32,
    cell: f32,
    cols: usize,
    rows: usize,
    base_y: f32,
    walk_cos: f32,
    yaw: f32 = 0,
    pivot_x: f32 = 0,
    pivot_z: f32 = 0,
};

var g_heightfields: [MAX_HEIGHTFIELDS]Heightfield = [_]Heightfield{.{}} ** MAX_HEIGHTFIELDS;
var g_snapshot: [OUTPUT_FLOATS]f32 = undefined;

fn clamp(n: f32, a: f32, b: f32) f32 {
    return @max(a, @min(b, n));
}

/// Upload/replace a terrain grid by id. Called once when a landform loads
/// (the grid is static), then referenced every frame by the step. Heights are
/// stored above base_y, row-major (iz*cols + ix). `samples_bytes` is the raw
/// f32 payload (a possibly-unaligned ArrayBuffer view — byte-copied here).
/// Returns false (registering nothing) on a malformed descriptor.
pub fn registerHeightfield(desc: HeightfieldDesc, samples_bytes: []const u8) bool {
    if (desc.id >= MAX_HEIGHTFIELDS) return false;
    const count = desc.cols * desc.rows;
    if (count < 4 or count > HF_MAX_SAMPLES or desc.cell <= 0) return false;
    if (samples_bytes.len < count * @sizeOf(f32)) return false;
    var hf = &g_heightfields[desc.id];
    hf.origin_x = desc.origin_x;
    hf.origin_z = desc.origin_z;
    hf.cell = desc.cell;
    hf.cols = desc.cols;
    hf.rows = desc.rows;
    hf.base_y = desc.base_y;
    hf.walk_cos = desc.walk_cos;
    hf.yaw = desc.yaw;
    hf.pivot_x = desc.pivot_x;
    hf.pivot_z = desc.pivot_z;
    // Byte copy (the source view may be unaligned) into the sample store.
    const dst_bytes = std.mem.sliceAsBytes(hf.samples[0..count]);
    @memcpy(dst_bytes, samples_bytes[0 .. count * @sizeOf(f32)]);
    hf.active = true;
    return true;
}

/// Drop all registered terrain (world reset / cart swap). TS re-registers
/// what the new world needs.
pub fn clearHeightfields() void {
    for (&g_heightfields) |*hf| hf.active = false;
}

// A world XZ point rotated into an oriented rect's local (un-rotated) frame —
// the inverse of the mesh's +Y yaw about the pivot. `cs`/`sn` are cos/sin(yaw);
// the inverse rotation is [[cs, -sn],[sn, cs]] applied to (point - pivot). Matches
// render3d/buildingTransform.ts (whose local→world offset is its transpose).
fn worldToLocal(x: f32, z: f32, pivot_x: f32, pivot_z: f32, cs: f32, sn: f32, out_x: *f32, out_z: *f32) void {
    const dx = x - pivot_x;
    const dz = z - pivot_z;
    out_x.* = pivot_x + cs * dx - sn * dz;
    out_z.* = pivot_z + sn * dx + cs * dz;
}

// The reverse: a local point/push back to world (forward +Y yaw), [[cs, sn],[-sn, cs]].
fn localToWorld(x: f32, z: f32, pivot_x: f32, pivot_z: f32, cs: f32, sn: f32, out_x: *f32, out_z: *f32) void {
    const dx = x - pivot_x;
    const dz = z - pivot_z;
    out_x.* = pivot_x + cs * dx + sn * dz;
    out_z.* = pivot_z - sn * dx + cs * dz;
}

// Bilinear height of one heightfield at (x,z), in stored units (above base_y).
// null when (x,z) is outside the grid.
fn rawHeight(hf: *const Heightfield, x: f32, z: f32) ?f32 {
    if (hf.cols < 2 or hf.rows < 2 or hf.cell <= 0) return null;
    // A rotated grid (a turned parking garage's floor) is sampled in its own
    // un-rotated frame: rotate the query point into local coords about the pivot.
    // The returned height (above base_y) and the Y-normal are rotation-invariant,
    // so only the sample coordinate moves. Axis-aligned grids skip this.
    var qx = x;
    var qz = z;
    if (hf.yaw != 0) {
        worldToLocal(x, z, hf.pivot_x, hf.pivot_z, @cos(hf.yaw), @sin(hf.yaw), &qx, &qz);
    }
    const fx = (qx - hf.origin_x) / hf.cell;
    const fz = (qz - hf.origin_z) / hf.cell;
    if (fx < 0 or fz < 0) return null;
    const fxi = @floor(fx);
    const fzi = @floor(fz);
    const ix: usize = @intFromFloat(fxi);
    const iz: usize = @intFromFloat(fzi);
    if (ix + 1 >= hf.cols or iz + 1 >= hf.rows) return null;
    const tx = fx - fxi;
    const tz = fz - fzi;
    const h00 = hf.samples[iz * hf.cols + ix];
    const h10 = hf.samples[iz * hf.cols + ix + 1];
    const h01 = hf.samples[(iz + 1) * hf.cols + ix];
    const h11 = hf.samples[(iz + 1) * hf.cols + ix + 1];
    const h0 = h00 + (h10 - h00) * tx;
    const h1 = h01 + (h11 - h01) * tx;
    return h0 + (h1 - h0) * tz;
}

pub const HfSurface = struct { height: f32, normal_y: f32, walk_cos: f32 };

/// The highest registered-heightfield surface under (x,z), with its up-normal —
/// the terrain's contribution to ground/wall resolution. normal.y comes from a
/// central difference of the sampled height (the real surface slope), so a steep
/// face reports a low normal.y the step treats as a wall. Pub for behavior tests.
pub fn heightfieldSurfaceAt(x: f32, z: f32) ?HfSurface {
    var best: ?HfSurface = null;
    for (&g_heightfields) |*hf| {
        if (!hf.active) continue;
        const raw = rawHeight(hf, x, z) orelse continue;
        const h = hf.base_y + raw;
        const e = hf.cell;
        const hx0 = rawHeight(hf, x - e, z) orelse raw;
        const hx1 = rawHeight(hf, x + e, z) orelse raw;
        const hz0 = rawHeight(hf, x, z - e) orelse raw;
        const hz1 = rawHeight(hf, x, z + e) orelse raw;
        const dhdx = (hx1 - hx0) / (2 * e);
        const dhdz = (hz1 - hz0) / (2 * e);
        const ny = 1.0 / @sqrt(dhdx * dhdx + 1.0 + dhdz * dhdz);
        if (best == null or h > best.?.height) best = .{ .height = h, .normal_y = ny, .walk_cos = hf.walk_cos };
    }
    return best;
}

fn groundAt(rects: []const f32, oriented: []const f32, x: f32, z: f32, current_y: f32, step_height: f32) f32 {
    var ground_y: f32 = -1000000;
    var at: usize = 0;
    while (at + RECT_FLOATS <= rects.len) : (at += RECT_FLOATS) {
        // Solid rects (walls, props) ARE standable tops, not just side blockers.
        // The step-height gate below keeps a tall wall from counting as ground at
        // its base (its top is far above current_y + step), so it only becomes
        // ground once you're actually on it — hop onto a hydrant and stand. The
        // side push (collideSolidRects) still blocks you while your feet are
        // below the top, so "bump from the side, stand from above" both hold.
        if (x >= rects[at] and x <= rects[at + 2] and z >= rects[at + 1] and z <= rects[at + 3]) {
            const rect_height = rects[at + 4];
            if (rect_height <= current_y + step_height) ground_y = @max(ground_y, rect_height);
        }
    }
    // Oriented walls: rotate the foot point into each rect's frame, same test.
    var o: usize = 0;
    while (o + ORIENTED_FLOATS <= oriented.len) : (o += ORIENTED_FLOATS) {
        const yaw = oriented[o + 11];
        var lx: f32 = undefined;
        var lz: f32 = undefined;
        worldToLocal(x, z, oriented[o + 9], oriented[o + 10], @cos(yaw), @sin(yaw), &lx, &lz);
        if (lx >= oriented[o] and lx <= oriented[o + 2] and lz >= oriented[o + 1] and lz <= oriented[o + 3]) {
            const rect_height = oriented[o + 4];
            if (rect_height <= current_y + step_height) ground_y = @max(ground_y, rect_height);
        }
    }
    return ground_y;
}

fn surfaceValueAt(rects: []const f32, oriented: []const f32, x: f32, z: f32, current_y: f32, step_height: f32, value_offset: usize, fallback: f32) f32 {
    var ground_y: f32 = -1000000;
    var value = fallback;
    var at: usize = 0;
    while (at + RECT_FLOATS <= rects.len) : (at += RECT_FLOATS) {
        // Mirror groundAt: solids are standable, so when you rest on a prop's
        // top its friction/restitution (rect[6]/rect[7]) is the surface you read,
        // not the fallback. Same step-height gate keeps wall bases out.
        if (x >= rects[at] and x <= rects[at + 2] and z >= rects[at + 1] and z <= rects[at + 3]) {
            const rect_height = rects[at + 4];
            if (rect_height <= current_y + step_height and rect_height >= ground_y) {
                ground_y = rect_height;
                value = rects[at + value_offset];
            }
        }
    }
    var o: usize = 0;
    while (o + ORIENTED_FLOATS <= oriented.len) : (o += ORIENTED_FLOATS) {
        const yaw = oriented[o + 11];
        var lx: f32 = undefined;
        var lz: f32 = undefined;
        worldToLocal(x, z, oriented[o + 9], oriented[o + 10], @cos(yaw), @sin(yaw), &lx, &lz);
        if (lx >= oriented[o] and lx <= oriented[o + 2] and lz >= oriented[o + 1] and lz <= oriented[o + 3]) {
            const rect_height = oriented[o + 4];
            if (rect_height <= current_y + step_height and rect_height >= ground_y) {
                ground_y = rect_height;
                value = oriented[o + value_offset];
            }
        }
    }
    return value;
}

fn collideCircleRect(x: *f32, z: *f32, vx: *f32, vz: *f32, radius: f32, rect: []const f32, restitution: f32) bool {
    const closest_x = clamp(x.*, rect[0], rect[2]);
    const closest_z = clamp(z.*, rect[1], rect[3]);
    var dx = x.* - closest_x;
    var dz = z.* - closest_z;
    var d = @sqrt(dx * dx + dz * dz);
    if (d >= radius) return false;
    if (d < 0.0001) {
        const side_x = @min(@abs(x.* - rect[0]), @abs(rect[2] - x.*));
        const side_z = @min(@abs(z.* - rect[1]), @abs(rect[3] - z.*));
        if (side_x < side_z) {
            dx = if (x.* < (rect[0] + rect[2]) * 0.5) -1 else 1;
            dz = 0;
        } else {
            dx = 0;
            dz = if (z.* < (rect[1] + rect[3]) * 0.5) -1 else 1;
        }
        d = 1;
    }
    const nx = dx / d;
    const nz = dz / d;
    const push = radius - d;
    x.* += nx * push;
    z.* += nz * push;
    const into = vx.* * nx + vz.* * nz;
    if (into < 0) {
        vx.* -= (1 + restitution) * into * nx;
        vz.* -= (1 + restitution) * into * nz;
    }
    return true;
}

fn collideSolidRects(x: *f32, y: f32, z: *f32, vx: *f32, vz: *f32, radius: f32, height: f32, rects: []const f32, oriented: []const f32, restitution: f32, step_height: f32) void {
    var at: usize = 0;
    while (at + RECT_FLOATS <= rects.len) : (at += RECT_FLOATS) {
        const solid = rects[at + 5] > 0.5;
        const rect_height = rects[at + 4];
        const rect_floor = rects[at + 8];
        const too_tall_to_step = rect_height > y + step_height;
        if (!solid and !too_tall_to_step) continue;
        if (y >= rect_height - 0.04 or y + height < 0) continue;
        // Banded solid: skip the side push when the body is entirely below the
        // rect's floor — you walk UNDER a raised platform (a parking deck), not
        // into it. Walls pass floor = −∞ so this never skips them.
        if (y + height <= rect_floor) continue;
        _ = collideCircleRect(x, z, vx, vz, radius, rects[at .. at + RECT_FLOATS], restitution);
    }
    // Oriented walls (yawed buildings): rotate the body + its velocity into the
    // rect's frame, run the SAME AABB push there, then rotate the result back to
    // world. The first 9 floats are the AABB the push reads; [9..12] are pivot+yaw.
    var o: usize = 0;
    while (o + ORIENTED_FLOATS <= oriented.len) : (o += ORIENTED_FLOATS) {
        const solid = oriented[o + 5] > 0.5;
        const rect_height = oriented[o + 4];
        const rect_floor = oriented[o + 8];
        const too_tall_to_step = rect_height > y + step_height;
        if (!solid and !too_tall_to_step) continue;
        if (y >= rect_height - 0.04 or y + height < 0) continue;
        if (y + height <= rect_floor) continue;
        const pivot_x = oriented[o + 9];
        const pivot_z = oriented[o + 10];
        const yaw = oriented[o + 11];
        const cs = @cos(yaw);
        const sn = @sin(yaw);
        var lx: f32 = undefined;
        var lz: f32 = undefined;
        worldToLocal(x.*, z.*, pivot_x, pivot_z, cs, sn, &lx, &lz);
        var lvx = cs * vx.* - sn * vz.*;
        var lvz = sn * vx.* + cs * vz.*;
        if (collideCircleRect(&lx, &lz, &lvx, &lvz, radius, oriented[o .. o + RECT_FLOATS], restitution)) {
            localToWorld(lx, lz, pivot_x, pivot_z, cs, sn, x, z);
            vx.* = cs * lvx + sn * lvz;
            vz.* = -sn * lvx + cs * lvz;
        }
    }
}

fn resolveSpherePair(a: []f32, b: []f32) void {
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    var dz = b[2] - a[2];
    var d = @sqrt(dx * dx + dy * dy + dz * dz);
    const min_d = a[6] + b[6];
    if (d >= min_d) return;
    if (d < 0.0001) {
        dx = 1;
        dy = 0;
        dz = 0;
        d = 1;
    }
    const nx = dx / d;
    const ny = dy / d;
    const nz = dz / d;
    const push = (min_d - d) * 0.5;
    a[0] -= nx * push;
    a[1] -= ny * push;
    a[2] -= nz * push;
    b[0] += nx * push;
    b[1] += ny * push;
    b[2] += nz * push;
    const rvx = b[3] - a[3];
    const rvy = b[4] - a[4];
    const rvz = b[5] - a[5];
    const into = rvx * nx + rvy * ny + rvz * nz;
    if (into >= 0) return;
    const impulse = -into * 0.5;
    a[3] -= nx * impulse;
    a[4] -= ny * impulse;
    a[5] -= nz * impulse;
    b[3] += nx * impulse;
    b[4] += ny * impulse;
    b[5] += nz * impulse;
}

/// One frame of the game sim. `input` is the packed f32 buffer described in
/// the module header. Returns the packed snapshot (player header + entities),
/// or null on a malformed buffer. Slot [0] of the snapshot is left at 0 for
/// the registrar to stamp with the host-fn wall time in µs.
pub fn step(input: []const f32) ?[]f32 {
    if (input.len < INPUT_HEADER_FLOATS) return null;

    const dt = clamp(input[0], 0.001, 0.05);
    const move_x = input[1];
    const move_z = input[2];
    const speed = @max(0, input[3]);
    const jump_down = input[4] > 0.5;
    var px = input[5];
    var py = input[6];
    var pz = input[7];
    var pvx = input[8];
    var pvy = input[9];
    var pvz = input[10];
    const entity_count = @min(MAX_ENTITIES, @as(usize, @intFromFloat(@max(0, input[12]))));
    const rect_count = @min(MAX_RECTS, @as(usize, @intFromFloat(@max(0, input[13]))));
    const oriented_count = @min(MAX_ORIENTED, @as(usize, @intFromFloat(@max(0, input[24]))));
    const gravity = @max(0, input[14]);
    const jump_speed = @max(0, input[15]);
    const player_radius = @max(0.05, input[16]);
    const player_height = @max(0.2, input[17]);
    const wall_restitution = clamp(input[18], 0, 1);
    const body_restitution = clamp(input[19], 0, 1); // reserved — parsed to document the layout
    const step_height = @max(0, input[20]);
    const acceleration_multiplier = clamp(input[21], 0.05, 4);
    const player_surface_friction = clamp(input[22], 0, 1);
    const player_surface_restitution = clamp(input[23], 0, 1);
    _ = body_restitution;

    const entity_start = INPUT_HEADER_FLOATS;
    const rect_start = entity_start + entity_count * ENTITY_FLOATS;
    const oriented_start = rect_start + rect_count * RECT_FLOATS;
    if (input.len < oriented_start + oriented_count * ORIENTED_FLOATS) return null;
    const rects = input[rect_start .. rect_start + rect_count * RECT_FLOATS];
    const oriented = input[oriented_start .. oriented_start + oriented_count * ORIENTED_FLOATS];

    // V7: the ONE host-side movement integrator, inside the physics step.
    movement.integrateHorizontal(&pvx, &pvz, move_x, move_z, speed, acceleration_multiplier, player_surface_friction, dt);

    // Ground support = highest of the rect floor and any walkable terrain
    // surface under the feet (terrain steeper than its slope limit does not
    // support you, so it is excluded here and handled as a wall after the move).
    var player_ground_y = groundAt(rects, oriented, px, pz, py, step_height);
    if (heightfieldSurfaceAt(px, pz)) |s| {
        if (s.normal_y >= s.walk_cos and s.height <= py + step_height) player_ground_y = @max(player_ground_y, s.height);
    }
    var player_grounded = py <= player_ground_y + 0.015 and pvy <= 0;
    if (jump_down and player_grounded) {
        pvy = jump_speed;
        player_grounded = false;
    }
    pvy -= gravity * dt;
    const prev_px = px;
    const prev_pz = pz;
    px += pvx * dt;
    py += pvy * dt;
    pz += pvz * dt;
    collideSolidRects(&px, py, &pz, &pvx, &pvz, player_radius, player_height, rects, oriented, @max(wall_restitution, player_surface_restitution * 0.15), step_height);
    var next_ground_y = groundAt(rects, oriented, px, pz, py, step_height);
    // Terrain hit detection on the real slope. The slope LIMIT is enforced by the
    // surface normal, not the step height: a single frame only nudges the player a
    // few cm, so a step-height gate would let them creep up any grade. Instead —
    //   • walkable surface (normal.y >= limit): stand on it, climbing the gentle
    //     grade smoothly (this is the carved trail);
    //   • too-steep surface that rises ABOVE the feet (by any amount): a wall —
    //     cancel the move into it so the steep cone face can't be climbed at all;
    //   • too-steep surface at/below the feet: stand on it (sidehill / descend,
    //     no fall-through) but you still can't gain height on it.
    // So the only way UP a steep cone is the gently-graded trail cut into it.
    if (heightfieldSurfaceAt(px, pz)) |s| {
        const walkable = s.normal_y >= s.walk_cos;
        if (!walkable and s.height > py + 0.02) {
            px = prev_px;
            pz = prev_pz;
            pvx = 0;
            pvz = 0;
            if (heightfieldSurfaceAt(px, pz)) |held| {
                if (held.height <= py + step_height) next_ground_y = @max(next_ground_y, held.height);
            }
        } else if (s.height <= py + step_height) {
            next_ground_y = @max(next_ground_y, s.height);
        }
    }
    if (py <= next_ground_y) {
        py = next_ground_y;
        if (pvy < 0) pvy = 0;
        player_grounded = true;
    }

    var at: usize = OUTPUT_HEADER_FLOATS;
    var i: usize = 0;
    while (i < entity_count) : (i += 1) {
        const src = entity_start + i * ENTITY_FLOATS;
        var x = input[src];
        var y = input[src + 1];
        var z = input[src + 2];
        var vx = input[src + 3];
        var vy = input[src + 4];
        var vz = input[src + 5];
        const r = @max(0.05, input[src + 6]);
        const restitution = clamp(input[src + 7], 0, 1);

        vy -= gravity * dt;
        x += vx * dt;
        y += vy * dt;
        z += vz * dt;
        const entity_step_height = @max(0.05, r * 0.35);
        collideSolidRects(&x, y - r, &z, &vx, &vz, r, r * 2, rects, oriented, wall_restitution, entity_step_height);
        const gy = groundAt(rects, oriented, x, z, y - r, entity_step_height) + r;
        const surface_friction = clamp(surfaceValueAt(rects, oriented, x, z, y - r, entity_step_height, 6, 0.2), 0, 1);
        const surface_restitution = clamp(surfaceValueAt(rects, oriented, x, z, y - r, entity_step_height, 7, 0.8), 0, 1);
        var grounded: f32 = 0;
        if (y <= gy) {
            y = gy;
            if (vy < 0) {
                vy = -vy * restitution * surface_restitution;
                const impact_drag = @max(@as(f32, 0), 1 - surface_friction * 0.22);
                vx *= impact_drag;
                vz *= impact_drag;
            }
            if (@abs(vy) < 0.08) {
                vy = 0;
                grounded = 1;
            }
            const surface_drag = @max(@as(f32, 0), 1 - dt * (1.5 + surface_friction * 12));
            vx *= surface_drag;
            vz *= surface_drag;
        }

        g_snapshot[at] = x;
        at += 1;
        g_snapshot[at] = y;
        at += 1;
        g_snapshot[at] = z;
        at += 1;
        g_snapshot[at] = vx;
        at += 1;
        g_snapshot[at] = vy;
        at += 1;
        g_snapshot[at] = vz;
        at += 1;
        g_snapshot[at] = r;
        at += 1;
        g_snapshot[at] = grounded;
        at += 1;
    }

    i = 0;
    while (i < entity_count) : (i += 1) {
        var j = i + 1;
        while (j < entity_count) : (j += 1) {
            const a = OUTPUT_HEADER_FLOATS + i * ENTITY_FLOATS;
            const b = OUTPUT_HEADER_FLOATS + j * ENTITY_FLOATS;
            resolveSpherePair(g_snapshot[a .. a + ENTITY_FLOATS], g_snapshot[b .. b + ENTITY_FLOATS]);
        }
    }

    g_snapshot[0] = 0; // host-fn µs — stamped by the registrar
    g_snapshot[1] = px;
    g_snapshot[2] = py;
    g_snapshot[3] = pz;
    g_snapshot[4] = pvx;
    g_snapshot[5] = pvy;
    g_snapshot[6] = pvz;
    g_snapshot[7] = if (player_grounded) 1 else 0;
    g_snapshot[8] = @floatFromInt(entity_count);
    return g_snapshot[0 .. OUTPUT_HEADER_FLOATS + entity_count * ENTITY_FLOATS];
}
