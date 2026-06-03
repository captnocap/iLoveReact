//! Host physics lab bindings — Zig-side copy of cart/physics_lab's toy world.
//!
//! Host fns:
//!   __physics_lab_reset(count?)        reset the sim, optional seeded ball count
//!   __physics_lab_burst(count?)        add more balls
//!   __physics_lab_step(cameraYaw, paused?) -> CSV snapshot
//!   __physics_lab_step_buffer(cameraYaw, paused?) -> Float32 ArrayBuffer snapshot
//!   __hmsc_physics_step(inputFloat32Array) -> Float32 ArrayBuffer snapshot
//!
//! The hot snapshot path is a host-owned packed f32 buffer:
//!   t,contacts,peak,px,py,pz,pvy,pyaw,onGround,moving,count,us,
//!   bx,by,bz,br,itemIndex,rx,ry,rz,spin,...
//!
//! CSV is retained as a compatibility/debug fallback.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const c = @import("engine.zig").c;

const alloc = std.heap.c_allocator;

const Vec3 = struct { x: f32, y: f32, z: f32 };
const ItemDef = struct {
    r: f32,
    m: f32,
    cog: Vec3,
};
const Ball = struct {
    item: u8,
    x: f32,
    y: f32,
    z: f32,
    vx: f32,
    vy: f32,
    vz: f32,
    rx: f32,
    ry: f32,
    rz: f32,
    wx: f32,
    wy: f32,
    wz: f32,
    r: f32,
    m: f32,
    cog: Vec3,
};
const Player = struct {
    x: f32,
    y: f32,
    z: f32,
    vx: f32,
    vy: f32,
    vz: f32,
    yaw: f32,
    on_ground: bool,
    moving: bool,
    jump_hold: f32,
    jump_was_down: bool,
};
const Block = struct {
    x: f32,
    z: f32,
    hx: f32,
    hz: f32,
    h: f32,
};

const MAX_BALLS: usize = 512;
const SNAPSHOT_HEADER_FLOATS: usize = 12;
const SNAPSHOT_BODY_FLOATS: usize = 9;
const SNAPSHOT_FLOATS: usize = SNAPSHOT_HEADER_FLOATS + MAX_BALLS * SNAPSHOT_BODY_FLOATS;
const HMSC_MAX_ENTITIES: usize = 128;
const HMSC_MAX_RECTS: usize = 512;
const HMSC_MAX_ORIENTED: usize = 256;
const HMSC_INPUT_HEADER_FLOATS: usize = 25;
const HMSC_ENTITY_FLOATS: usize = 8;
// A rect is [minX, minZ, maxX, maxZ, top, solid, friction, restitution, floor].
// `floor` (index 8) is the BOTTOM of the solid band: the rect blocks horizontally
// only while the body overlaps [floor, top], so a thin platform (floor = top −
// thickness) is solid to stand ON yet open to walk UNDER — the primitive that
// makes stacked parking decks, overpasses, and mezzanines possible. A normal wall
// passes floor = −∞ (HMSC_RECT_SOLID_FLOOR) so it stays solid to the ground exactly
// as before. Standing-on-top is unchanged (the top + step-height gate already only
// grounds you when your feet are within a step of the top, so a deck overhead never
// snaps a player on the floor below up onto it).
const HMSC_RECT_FLOATS: usize = 9;
// An oriented rect: the same 9-float AABB in the building's OWN un-rotated frame,
// then [pivotX, pivotZ, yawRadians]. The host tests a point by rotating it into
// that frame about the pivot (inverse of the mesh's +Y yaw) and reusing the AABB
// math; a push is rotated back out. yaw 0 would be identical to an AABB rect, so
// only rotated buildings are sent here (state/hostPhysics.ts physicsOrientedRects).
const HMSC_ORIENTED_FLOATS: usize = 12;
const HMSC_OUTPUT_HEADER_FLOATS: usize = 9;
const HMSC_OUTPUT_FLOATS: usize = HMSC_OUTPUT_HEADER_FLOATS + HMSC_MAX_ENTITIES * HMSC_ENTITY_FLOATS;
const WORLD_HALF: f32 = 6.2;
const GRAVITY: f32 = 13.5;
const BALL_RESTITUTION: f32 = 0.82;
const WALL_RESTITUTION: f32 = 0.74;
const PLAYER_RADIUS: f32 = 0.36;
const PLAYER_HEIGHT: f32 = 1.65;
const PLAYER_SPEED: f32 = 3.1;
const PLAYER_RUN_SPEED: f32 = 5.2;
const JUMP_SPEED: f32 = 5.65;
const JUMP_HOLD_ACCEL: f32 = 19.5;
const JUMP_HOLD_SECONDS: f32 = 0.18;

const SCAN_A: usize = 4;
const SCAN_D: usize = 7;
const SCAN_S: usize = 22;
const SCAN_W: usize = 26;
const SCAN_SPACE: usize = 44;
const SCAN_LSHIFT: usize = 225;

const blocks = [_]Block{
    .{ .x = -2.75, .z = -0.75, .hx = 0.72, .hz = 1.15, .h = 0.62 },
    .{ .x = 2.55, .z = 0.85, .hx = 0.9, .hz = 0.75, .h = 0.9 },
    .{ .x = 0, .z = 2.95, .hx = 1.45, .hz = 0.28, .h = 0.36 },
};

const items = [_]ItemDef{
    .{ .r = 0.62, .m = 0.42, .cog = .{ .x = -0.18, .y = 0.08, .z = 0.02 } },
    .{ .r = 0.66, .m = 0.88, .cog = .{ .x = -0.18, .y = 0.2, .z = 0.01 } },
    .{ .r = 0.86, .m = 0.58, .cog = .{ .x = 0, .y = 0.43, .z = 0.02 } },
    .{ .r = 0.75, .m = 0.64, .cog = .{ .x = 0.08, .y = 0.31, .z = 0 } },
    .{ .r = 0.56, .m = 0.24, .cog = .{ .x = 0.12, .y = 0.05, .z = -0.04 } },
    .{ .r = 0.78, .m = 1.25, .cog = .{ .x = -0.1, .y = 0.2, .z = 0.07 } },
    .{ .r = 0.82, .m = 0.48, .cog = .{ .x = 0.02, .y = 0.62, .z = 0.02 } },
    .{ .r = 0.66, .m = 0.34, .cog = .{ .x = -0.16, .y = 0.04, .z = 0.03 } },
    .{ .r = 0.45, .m = 0.45, .cog = .{ .x = 0.08, .y = 0, .z = 0 } },
    .{ .r = 0.46, .m = 0.42, .cog = .{ .x = 0, .y = 0, .z = 0 } },
    .{ .r = 0.5, .m = 0.4, .cog = .{ .x = 0.02, .y = 0.28, .z = -0.02 } },
    .{ .r = 0.55, .m = 0.75, .cog = .{ .x = 0, .y = 0.36, .z = 0.03 } },
    .{ .r = 0.58, .m = 0.95, .cog = .{ .x = 0.04, .y = 0.31, .z = 0.02 } },
    .{ .r = 0.42, .m = 0.16, .cog = .{ .x = -0.06, .y = 0.02, .z = 0.05 } },
    .{ .r = 0.42, .m = 0.18, .cog = .{ .x = 0.03, .y = 0.08, .z = -0.05 } },
    .{ .r = 0.58, .m = 0.26, .cog = .{ .x = -0.16, .y = 0.22, .z = 0 } },
    .{ .r = 0.64, .m = 0.82, .cog = .{ .x = 0.01, .y = 0.34, .z = -0.14 } },
    .{ .r = 0.58, .m = 0.92, .cog = .{ .x = 0, .y = 0.2, .z = 0.02 } },
    .{ .r = 0.76, .m = 1.55, .cog = .{ .x = -0.04, .y = 0.32, .z = 0.08 } },
};

var g_player: Player = makePlayer();
var g_balls: [MAX_BALLS]Ball = undefined;
var g_ball_count: usize = 0;
var g_t: f32 = 0;
var g_contacts: u32 = 0;
var g_peak_contacts: f32 = 0;
var g_last_ns: i64 = 0;
var g_spawn_seq: u32 = 0;
var g_snapshot: [SNAPSHOT_FLOATS]f32 = undefined;
var g_hmsc_snapshot: [HMSC_OUTPUT_FLOATS]f32 = undefined;

// ── Heightfield colliders ──────────────────────────────────────────────
// A generic terrain collider: a cols×rows grid of corner heights the host
// samples bilinearly to get the ground under a point, plus a per-field walk
// slope cosine. Surfaces flatter than the limit (normal.y >= walk_cos) are
// walkable ground you stand on; steeper ones are walls you can't ascend. The
// host knows ZERO shapes — TS bakes the grid (a cone, a carved trail, anything)
// the same way it bakes a Heightfield mesh, registers it once via
// __hmsc_register_heightfield, and the step samples it every frame. This is what
// makes hit detection follow a real slope instead of a stack of flat boxes.
// 64 slots × HMSC_HF_MAX_SAMPLES f32 = ~4 MB of static memory — negligible for a
// desktop binary (one tile texture dwarfs it), and the per-frame step only samples
// ACTIVE fields, so an empty slot is free. Headroom for many heightfield-floored
// structures (garages, ramps, overpasses) on top of the terrain landforms.
const HMSC_MAX_HEIGHTFIELDS: usize = 64;
// Must fit hmsc-int's tile-resolution painted chunks: one collider sample per tile,
// 121×121 = 14,641 over a 120-tile chunk (mesh and collider share the field, so
// see-it==walk-it). The old 8192 cap rejected that whole field — count >
// HMSC_HF_MAX_SAMPLES returns null and registers NO collider, so a tile-res painted
// chunk would have rendered but had no collision (walk straight through it).
const HMSC_HF_MAX_SAMPLES: usize = 16384; // up to a 127×127 grid (121×121 = 14,641 fits)

const HmscHeightfield = struct {
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
    samples: [HMSC_HF_MAX_SAMPLES]f32 = [_]f32{0} ** HMSC_HF_MAX_SAMPLES,
};
var g_hmsc_heightfields: [HMSC_MAX_HEIGHTFIELDS]HmscHeightfield = [_]HmscHeightfield{.{}} ** HMSC_MAX_HEIGHTFIELDS;

fn makePlayer() Player {
    return .{
        .x = 0,
        .y = 0,
        .z = 0.55,
        .vx = 0,
        .vy = 0,
        .vz = 0,
        .yaw = std.math.pi,
        .on_ground = true,
        .moving = false,
        .jump_hold = 0,
        .jump_was_down = false,
    };
}

inline fn nowNs() i64 {
    return @as(i64, @truncate(std.time.nanoTimestamp()));
}

fn argToF64(info: v8.FunctionCallbackInfo, idx: u32) ?f64 {
    if (idx >= info.length()) return null;
    const ctx = info.getIsolate().getCurrentContext();
    return info.getArg(idx).toF64(ctx) catch null;
}

fn argToBool(info: v8.FunctionCallbackInfo, idx: u32) ?bool {
    if (idx >= info.length()) return null;
    return info.getArg(idx).toBool(info.getIsolate());
}

fn argBytes(info: v8.FunctionCallbackInfo, idx: u32) ?[]const u8 {
    if (idx >= info.length()) return null;
    const value = info.getArg(idx);
    if (!value.isArrayBufferView()) return null;
    const view: v8.ArrayBufferView = .{ .handle = @ptrCast(value.handle) };
    const byte_len = view.getByteLength();
    if (byte_len == 0) return &[_]u8{};
    const byte_off = view.getByteOffset();
    const ab = view.getBuffer();
    var shared = ab.getBackingStore();
    defer v8.BackingStore.sharedPtrReset(&shared);
    const bs = v8.BackingStore.sharedPtrGet(&shared);
    const base = bs.getData() orelse return null;
    const base_bytes: [*]const u8 = @ptrCast(base);
    return base_bytes[byte_off .. byte_off + byte_len];
}

fn setReturnString(info: v8.FunctionCallbackInfo, text: []const u8) void {
    info.getReturnValue().set(v8.String.initUtf8(info.getIsolate(), text));
}

fn setReturnNull(info: v8.FunctionCallbackInfo) void {
    info.getReturnValue().set(info.getIsolate().initNull());
}

fn noopBackingStoreDeleter(_: ?*anyopaque, _: usize, _: ?*anyopaque) callconv(.c) void {}

fn setReturnF32Buffer(info: v8.FunctionCallbackInfo, floats: []f32) void {
    const iso = info.getIsolate();
    const bytes = std.mem.sliceAsBytes(floats);
    const bs_raw = v8.c.v8__ArrayBuffer__NewBackingStore2(
        @ptrCast(bytes.ptr),
        bytes.len,
        noopBackingStoreDeleter,
        null,
    ) orelse {
        setReturnNull(info);
        return;
    };
    var shared = v8.c.v8__BackingStore__TO_SHARED_PTR(bs_raw);
    defer v8.BackingStore.sharedPtrReset(&shared);
    const ab = v8.ArrayBuffer.initWithBackingStore(iso, &shared);
    info.getReturnValue().set(ab);
}

fn keyDown(scancode: usize) bool {
    const keys = c.SDL_GetKeyboardState(null);
    if (keys == null) return false;
    return keys[scancode];
}

fn clamp(n: f32, a: f32, b: f32) f32 {
    return @max(a, @min(b, n));
}

fn len3(x: f32, y: f32, z: f32) f32 {
    return @sqrt(x * x + y * y + z * z);
}

fn makeBall(item_idx: usize, x: f32, y: f32, z: f32, vx: f32, vy: f32, vz: f32, seq: usize) Ball {
    const item = items[item_idx % items.len];
    const fs: f32 = @floatFromInt(seq);
    return .{
        .item = @intCast(item_idx % items.len),
        .x = x,
        .y = y,
        .z = z,
        .vx = vx,
        .vy = vy,
        .vz = vz,
        .rx = @mod(fs * 0.41, std.math.pi * 2),
        .ry = @mod(fs * 0.67, std.math.pi * 2),
        .rz = @mod(fs * 0.29, std.math.pi * 2),
        .wx = @sin(fs * 1.7) * 1.4,
        .wy = @cos(fs * 1.3) * 1.2,
        .wz = @sin(fs * 1.1) * 1.6,
        .r = item.r,
        .m = item.m,
        .cog = item.cog,
    };
}

fn addBall(t: f32) void {
    if (g_ball_count >= MAX_BALLS) return;
    const i = g_ball_count;
    const fi: f32 = @floatFromInt(i);
    g_balls[i] = makeBall(i % items.len, @sin(t * 1.7 + fi * 0.11) * 3.8, 4.2 + @as(f32, @floatFromInt(i % 3)) * 0.55, @cos(t * 1.3 + fi * 0.07) * 3.2, @cos(t * 2.1 + fi * 0.13) * 2.7, 0.4, @sin(t * 1.9 + fi * 0.17) * 2.7, i);
    g_ball_count += 1;
    g_spawn_seq +%= 1;
}

fn seedBalls(count: usize) void {
    g_ball_count = 0;
    const n = @min(count, MAX_BALLS);
    if (n <= 5) {
        g_balls[0] = makeBall(0, -3.8, 3.2, -2.1, 2.7, 0.4, 1.15, 0);
        g_balls[1] = makeBall(5, -1.35, 2.15, 1.45, 1.2, 0.1, -2.45, 1);
        g_balls[2] = makeBall(8, 1.8, 3.7, -2.75, -2.2, -0.5, 1.75, 2);
        g_balls[3] = makeBall(11, 3.55, 1.85, 2.2, -1.8, 0.15, -1.5, 3);
        g_balls[4] = makeBall(17, 0.15, 4.9, -0.15, 1.65, -0.3, 0.8, 4);
        g_ball_count = n;
        return;
    }
    while (g_ball_count < n) addBall(@as(f32, @floatFromInt(g_ball_count)) * 0.19);
}

fn reset(count: usize) void {
    g_player = makePlayer();
    g_t = 0;
    g_contacts = 0;
    g_peak_contacts = 0;
    g_spawn_seq = 0;
    seedBalls(count);
    g_last_ns = nowNs();
}

fn collideCircleBlock(p: *Player, block: Block) bool {
    const closest_x = clamp(p.x, block.x - block.hx, block.x + block.hx);
    const closest_z = clamp(p.z, block.z - block.hz, block.z + block.hz);
    var dx = p.x - closest_x;
    var dz = p.z - closest_z;
    var d = @sqrt(dx * dx + dz * dz);
    if (d >= PLAYER_RADIUS or p.y > block.h + 0.02) return false;
    if (d < 0.0001) {
        const side_x = block.hx - @abs(p.x - block.x);
        const side_z = block.hz - @abs(p.z - block.z);
        if (side_x < side_z) {
            dx = if (p.x < block.x) -1 else 1;
            dz = 0;
        } else {
            dx = 0;
            dz = if (p.z < block.z) -1 else 1;
        }
        d = 1;
    }
    const nx = dx / d;
    const nz = dz / d;
    const push = PLAYER_RADIUS - d;
    p.x += nx * push;
    p.z += nz * push;
    const into = p.vx * nx + p.vz * nz;
    if (into < 0) {
        p.vx -= into * nx;
        p.vz -= into * nz;
    }
    return true;
}

fn rotateEuler(p: Vec3, rx: f32, ry: f32, rz: f32) Vec3 {
    var x = p.x;
    var y = p.y;
    var z = p.z;
    const cx = @cos(rx);
    const sx = @sin(rx);
    const cy = @cos(ry);
    const sy = @sin(ry);
    const cz = @cos(rz);
    const sz = @sin(rz);
    const y1 = y * cx - z * sx;
    const z1 = y * sx + z * cx;
    y = y1;
    z = z1;
    const x2 = x * cy + z * sy;
    const z2 = -x * sy + z * cy;
    x = x2;
    z = z2;
    const x3 = x * cz - y * sz;
    const y3 = x * sz + y * cz;
    return .{ .x = x3, .y = y3, .z = z };
}

fn kickSpin(ball: *Ball, nx: f32, ny: f32, nz: f32, strength: f32) void {
    const cog = rotateEuler(ball.cog, ball.rx, ball.ry, ball.rz);
    const tx = cog.y * nz - cog.z * ny;
    const ty = cog.z * nx - cog.x * nz;
    const tz = cog.x * ny - cog.y * nx;
    const inv = 1.0 / @max(@as(f32, 0.16), ball.m);
    ball.wx += tx * strength * inv;
    ball.wy += ty * strength * inv;
    ball.wz += tz * strength * inv;
}

fn collideSphereBlock(ball: *Ball, block: Block) bool {
    const min_x = block.x - block.hx;
    const max_x = block.x + block.hx;
    const max_y = block.h;
    const min_z = block.z - block.hz;
    const max_z = block.z + block.hz;
    const cx = clamp(ball.x, min_x, max_x);
    const cy = clamp(ball.y, 0, max_y);
    const cz = clamp(ball.z, min_z, max_z);
    var dx = ball.x - cx;
    var dy = ball.y - cy;
    var dz = ball.z - cz;
    var d = len3(dx, dy, dz);
    if (d >= ball.r) return false;
    if (d < 0.0001) {
        var best_d = @abs(ball.x - min_x);
        var n = Vec3{ .x = -1, .y = 0, .z = 0 };
        if (@abs(max_x - ball.x) < best_d) {
            best_d = @abs(max_x - ball.x);
            n = .{ .x = 1, .y = 0, .z = 0 };
        }
        if (@abs(max_y - ball.y) < best_d) {
            best_d = @abs(max_y - ball.y);
            n = .{ .x = 0, .y = 1, .z = 0 };
        }
        if (@abs(ball.z - min_z) < best_d) {
            best_d = @abs(ball.z - min_z);
            n = .{ .x = 0, .y = 0, .z = -1 };
        }
        if (@abs(max_z - ball.z) < best_d) n = .{ .x = 0, .y = 0, .z = 1 };
        dx = n.x;
        dy = n.y;
        dz = n.z;
        d = 1;
    }
    const nx = dx / d;
    const ny = dy / d;
    const nz = dz / d;
    const push = ball.r - d;
    ball.x += nx * push;
    ball.y += ny * push;
    ball.z += nz * push;
    const vn = ball.vx * nx + ball.vy * ny + ball.vz * nz;
    if (vn < 0) {
        ball.vx -= (1 + WALL_RESTITUTION) * vn * nx;
        ball.vy -= (1 + WALL_RESTITUTION) * vn * ny;
        ball.vz -= (1 + WALL_RESTITUTION) * vn * nz;
        kickSpin(ball, nx, ny, nz, @min(@as(f32, 18), @abs(vn) * 5.5));
    }
    return true;
}

fn resolveBallPair(a: *Ball, b: *Ball) bool {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var dz = b.z - a.z;
    var d = len3(dx, dy, dz);
    const min_d = a.r + b.r;
    if (d >= min_d) return false;
    if (d < 0.0001) {
        dx = 1;
        dy = 0;
        dz = 0;
        d = 1;
    }
    const nx = dx / d;
    const ny = dy / d;
    const nz = dz / d;
    const inv_a = 1 / a.m;
    const inv_b = 1 / b.m;
    const push = (min_d - d) / (inv_a + inv_b);
    a.x -= nx * push * inv_a;
    a.y -= ny * push * inv_a;
    a.z -= nz * push * inv_a;
    b.x += nx * push * inv_b;
    b.y += ny * push * inv_b;
    b.z += nz * push * inv_b;

    const rvx = b.vx - a.vx;
    const rvy = b.vy - a.vy;
    const rvz = b.vz - a.vz;
    const vel_along = rvx * nx + rvy * ny + rvz * nz;
    if (vel_along > 0) return true;
    const j = -(1 + BALL_RESTITUTION) * vel_along / (inv_a + inv_b);
    a.vx -= j * inv_a * nx;
    a.vy -= j * inv_a * ny;
    a.vz -= j * inv_a * nz;
    b.vx += j * inv_b * nx;
    b.vy += j * inv_b * ny;
    b.vz += j * inv_b * nz;
    const spin = @min(@as(f32, 16), @abs(j) * 2.5);
    kickSpin(a, -nx, -ny, -nz, spin);
    kickSpin(b, nx, ny, nz, spin);
    return true;
}

fn stepPhysics(camera_yaw: f32, dt: f32) u32 {
    var contacts: u32 = 0;
    const jump_down = keyDown(SCAN_SPACE);
    const shift = keyDown(SCAN_LSHIFT);
    const forward_x = -@sin(camera_yaw);
    const forward_z = -@cos(camera_yaw);
    const right_x = @cos(camera_yaw);
    const right_z = -@sin(camera_yaw);
    var ix: f32 = 0;
    var iz: f32 = 0;
    if (keyDown(SCAN_W)) {
        ix += forward_x;
        iz += forward_z;
    }
    if (keyDown(SCAN_S)) {
        ix -= forward_x;
        iz -= forward_z;
    }
    if (keyDown(SCAN_D)) {
        ix += right_x;
        iz += right_z;
    }
    if (keyDown(SCAN_A)) {
        ix -= right_x;
        iz -= right_z;
    }

    const ilen = @sqrt(ix * ix + iz * iz);
    const speed = if (shift) PLAYER_RUN_SPEED else PLAYER_SPEED;
    g_player.moving = ilen > 0.001;
    if (g_player.moving) {
        ix /= ilen;
        iz /= ilen;
        g_player.vx += (ix * speed - g_player.vx) * @min(@as(f32, 1), dt * 18);
        g_player.vz += (iz * speed - g_player.vz) * @min(@as(f32, 1), dt * 18);
        const target_yaw = std.math.atan2(-ix, -iz);
        g_player.yaw += std.math.atan2(@sin(target_yaw - g_player.yaw), @cos(target_yaw - g_player.yaw)) * @min(@as(f32, 1), dt * 14);
    } else {
        const drag = std.math.pow(f32, 0.001, dt);
        g_player.vx *= drag;
        g_player.vz *= drag;
    }

    if (jump_down and !g_player.jump_was_down and g_player.on_ground) {
        g_player.vy = JUMP_SPEED;
        g_player.on_ground = false;
        g_player.jump_hold = 0;
    }
    if (jump_down and !g_player.on_ground and g_player.vy > 0 and g_player.jump_hold < JUMP_HOLD_SECONDS) {
        g_player.vy += JUMP_HOLD_ACCEL * dt;
        g_player.jump_hold += dt;
    }
    g_player.jump_was_down = jump_down;

    g_player.vy -= GRAVITY * dt;
    g_player.x += g_player.vx * dt;
    g_player.y += g_player.vy * dt;
    g_player.z += g_player.vz * dt;
    if (g_player.y <= 0) {
        if (!g_player.on_ground and g_player.vy < -1.2) contacts += 1;
        g_player.y = 0;
        g_player.vy = 0;
        g_player.on_ground = true;
        g_player.jump_hold = 0;
    } else {
        g_player.on_ground = false;
    }

    if (g_player.x < -WORLD_HALF + PLAYER_RADIUS) {
        g_player.x = -WORLD_HALF + PLAYER_RADIUS;
        g_player.vx = @max(@as(f32, 0), g_player.vx);
        contacts += 1;
    }
    if (g_player.x > WORLD_HALF - PLAYER_RADIUS) {
        g_player.x = WORLD_HALF - PLAYER_RADIUS;
        g_player.vx = @min(@as(f32, 0), g_player.vx);
        contacts += 1;
    }
    if (g_player.z < -WORLD_HALF + PLAYER_RADIUS) {
        g_player.z = -WORLD_HALF + PLAYER_RADIUS;
        g_player.vz = @max(@as(f32, 0), g_player.vz);
        contacts += 1;
    }
    if (g_player.z > WORLD_HALF - PLAYER_RADIUS) {
        g_player.z = WORLD_HALF - PLAYER_RADIUS;
        g_player.vz = @min(@as(f32, 0), g_player.vz);
        contacts += 1;
    }
    for (blocks) |block| {
        if (collideCircleBlock(&g_player, block)) contacts += 1;
    }

    for (g_balls[0..g_ball_count]) |*ball| {
        ball.vy -= GRAVITY * dt;
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;
        ball.z += ball.vz * dt;
        ball.rx += ball.wx * dt;
        ball.ry += ball.wy * dt;
        ball.rz += ball.wz * dt;
        const angular_drag = std.math.pow(f32, 0.28, dt);
        ball.wx *= angular_drag;
        ball.wy *= angular_drag;
        ball.wz *= angular_drag;

        if (ball.y - ball.r < 0) {
            ball.y = ball.r;
            if (ball.vy < 0) {
                ball.vy = -ball.vy * BALL_RESTITUTION;
                ball.vx *= 0.985;
                ball.vz *= 0.985;
                kickSpin(ball, 0, 1, 0, @min(@as(f32, 22), @abs(ball.vy) * 4 + @sqrt(ball.vx * ball.vx + ball.vz * ball.vz) * 2));
                contacts += 1;
            }
        }
        if (ball.x - ball.r < -WORLD_HALF) {
            ball.x = -WORLD_HALF + ball.r;
            ball.vx = @abs(ball.vx) * WALL_RESTITUTION;
            kickSpin(ball, 1, 0, 0, @min(@as(f32, 18), @abs(ball.vx) * 4));
            contacts += 1;
        }
        if (ball.x + ball.r > WORLD_HALF) {
            ball.x = WORLD_HALF - ball.r;
            ball.vx = -@abs(ball.vx) * WALL_RESTITUTION;
            kickSpin(ball, -1, 0, 0, @min(@as(f32, 18), @abs(ball.vx) * 4));
            contacts += 1;
        }
        if (ball.z - ball.r < -WORLD_HALF) {
            ball.z = -WORLD_HALF + ball.r;
            ball.vz = @abs(ball.vz) * WALL_RESTITUTION;
            kickSpin(ball, 0, 0, 1, @min(@as(f32, 18), @abs(ball.vz) * 4));
            contacts += 1;
        }
        if (ball.z + ball.r > WORLD_HALF) {
            ball.z = WORLD_HALF - ball.r;
            ball.vz = -@abs(ball.vz) * WALL_RESTITUTION;
            kickSpin(ball, 0, 0, -1, @min(@as(f32, 18), @abs(ball.vz) * 4));
            contacts += 1;
        }
        for (blocks) |block| {
            if (collideSphereBlock(ball, block)) contacts += 1;
        }

        const vertical_overlap = ball.y > g_player.y + 0.12 and ball.y < g_player.y + PLAYER_HEIGHT;
        const dx = ball.x - g_player.x;
        const dz = ball.z - g_player.z;
        var d = @sqrt(dx * dx + dz * dz);
        const min_d = ball.r + PLAYER_RADIUS;
        if (vertical_overlap and d < min_d) {
            var nx: f32 = 1;
            var nz: f32 = 0;
            if (d >= 0.0001) {
                nx = dx / d;
                nz = dz / d;
            } else {
                d = 0;
            }
            const push = min_d - d;
            ball.x += nx * push * 0.7;
            ball.z += nz * push * 0.7;
            g_player.x -= nx * push * 0.3;
            g_player.z -= nz * push * 0.3;
            const hit = @max(@as(f32, 0), g_player.vx * nx + g_player.vz * nz) + 1.2;
            ball.vx += nx * hit;
            ball.vz += nz * hit;
            kickSpin(ball, nx, 0, nz, hit * 6);
            contacts += 1;
        }
    }

    var i: usize = 0;
    while (i < g_ball_count) : (i += 1) {
        var j = i + 1;
        while (j < g_ball_count) : (j += 1) {
            if (resolveBallPair(&g_balls[i], &g_balls[j])) contacts += 1;
        }
    }

    return contacts;
}

fn hostReset(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const count_f = argToF64(info, 0) orelse 5;
    const count: usize = if (count_f > 0) @intFromFloat(@min(count_f, @as(f64, @floatFromInt(MAX_BALLS)))) else 5;
    reset(count);
}

fn hostBurst(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const count_f = argToF64(info, 0) orelse 4;
    const count: usize = if (count_f > 0) @intFromFloat(@min(count_f, @as(f64, @floatFromInt(MAX_BALLS)))) else 4;
    var i: usize = 0;
    while (i < count and g_ball_count < MAX_BALLS) : (i += 1) addBall(g_t + @as(f32, @floatFromInt(i)) * 0.19 + @as(f32, @floatFromInt(g_spawn_seq)) * 0.011);
}

fn advanceWorld(yaw: f32, paused: bool, t0: i64) f64 {
    const now = t0;
    var dt_ns: i64 = if (g_last_ns == 0) 0 else now - g_last_ns;
    g_last_ns = now;
    if (dt_ns > 50_000_000) dt_ns = 50_000_000;
    if (dt_ns < 1_000_000) dt_ns = 1_000_000;
    const dt = @as(f32, @floatFromInt(dt_ns)) / 1_000_000_000.0;

    if (!paused) {
        g_t += dt;
        var contacts: u32 = 0;
        const steps = 3;
        var i: usize = 0;
        while (i < steps) : (i += 1) contacts += stepPhysics(yaw, dt / @as(f32, @floatFromInt(steps)));
        g_contacts = contacts;
        g_peak_contacts = @max(g_peak_contacts * 0.965, @as(f32, @floatFromInt(contacts)));
    }

    return @as(f64, @floatFromInt(nowNs() - t0)) / 1000.0;
}

fn writeSnapshot(host_us: f32) []f32 {
    var at: usize = 0;
    g_snapshot[at] = g_t;
    at += 1;
    g_snapshot[at] = @floatFromInt(g_contacts);
    at += 1;
    g_snapshot[at] = g_peak_contacts;
    at += 1;
    g_snapshot[at] = g_player.x;
    at += 1;
    g_snapshot[at] = g_player.y;
    at += 1;
    g_snapshot[at] = g_player.z;
    at += 1;
    g_snapshot[at] = g_player.vy;
    at += 1;
    g_snapshot[at] = g_player.yaw;
    at += 1;
    g_snapshot[at] = if (g_player.on_ground) 1 else 0;
    at += 1;
    g_snapshot[at] = if (g_player.moving) 1 else 0;
    at += 1;
    g_snapshot[at] = @floatFromInt(g_ball_count);
    at += 1;
    g_snapshot[at] = host_us;
    at += 1;

    for (g_balls[0..g_ball_count]) |ball| {
        g_snapshot[at] = ball.x;
        at += 1;
        g_snapshot[at] = ball.y;
        at += 1;
        g_snapshot[at] = ball.z;
        at += 1;
        g_snapshot[at] = ball.r;
        at += 1;
        g_snapshot[at] = @floatFromInt(ball.item);
        at += 1;
        g_snapshot[at] = ball.rx;
        at += 1;
        g_snapshot[at] = ball.ry;
        at += 1;
        g_snapshot[at] = ball.rz;
        at += 1;
        g_snapshot[at] = @sqrt(ball.wx * ball.wx + ball.wy * ball.wy + ball.wz * ball.wz);
        at += 1;
    }

    return g_snapshot[0..at];
}

fn hostStep(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const t0 = nowNs();
    const yaw: f32 = @floatCast(argToF64(info, 0) orelse 0);
    const paused = argToBool(info, 1) orelse false;
    const elapsed_us = advanceWorld(yaw, paused, t0);
    var out: std.ArrayList(u8) = .{};
    defer out.deinit(alloc);
    out.ensureTotalCapacity(alloc, 256 + g_ball_count * 72) catch {
        setReturnString(info, "");
        return;
    };
    out.writer(alloc).print("{d:.4},{d},{d:.2},{d:.4},{d:.4},{d:.4},{d:.4},{d:.4},{d},{d},{d},{d:.2}", .{
        g_t,
        g_contacts,
        g_peak_contacts,
        g_player.x,
        g_player.y,
        g_player.z,
        g_player.vy,
        g_player.yaw,
        @as(u8, if (g_player.on_ground) 1 else 0),
        @as(u8, if (g_player.moving) 1 else 0),
        g_ball_count,
        elapsed_us,
    }) catch {
        setReturnString(info, "");
        return;
    };
    for (g_balls[0..g_ball_count]) |ball| {
        out.writer(alloc).print(",{d:.4},{d:.4},{d:.4},{d:.4},{d},{d:.4},{d:.4},{d:.4},{d:.4}", .{
            ball.x,
            ball.y,
            ball.z,
            ball.r,
            ball.item,
            ball.rx,
            ball.ry,
            ball.rz,
            @sqrt(ball.wx * ball.wx + ball.wy * ball.wy + ball.wz * ball.wz),
        }) catch {
            setReturnString(info, "");
            return;
        };
    }
    setReturnString(info, out.items);
}

fn hostStepBuffer(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const t0 = nowNs();
    const yaw: f32 = @floatCast(argToF64(info, 0) orelse 0);
    const paused = argToBool(info, 1) orelse false;
    const elapsed_us = advanceWorld(yaw, paused, t0);
    const snapshot = writeSnapshot(@floatCast(elapsed_us));
    setReturnF32Buffer(info, snapshot);
}

// Bilinear height of one heightfield at (x,z), in stored units (above base_y).
// null when (x,z) is outside the grid.
fn hmscHfRawHeight(hf: *const HmscHeightfield, x: f32, z: f32) ?f32 {
    if (hf.cols < 2 or hf.rows < 2 or hf.cell <= 0) return null;
    // A rotated grid (a turned parking garage's floor) is sampled in its own
    // un-rotated frame: rotate the query point into local coords about the pivot.
    // The returned height (above base_y) and the Y-normal are rotation-invariant,
    // so only the sample coordinate moves. Axis-aligned grids skip this.
    var qx = x;
    var qz = z;
    if (hf.yaw != 0) {
        hmscWorldToLocal(x, z, hf.pivot_x, hf.pivot_z, @cos(hf.yaw), @sin(hf.yaw), &qx, &qz);
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

const HmscHfSurface = struct { height: f32, normal_y: f32, walk_cos: f32 };

// The highest registered-heightfield surface under (x,z), with its up-normal —
// the terrain's contribution to ground/wall resolution. normal.y comes from a
// central difference of the sampled height (the real surface slope), so a steep
// face reports a low normal.y the step treats as a wall.
fn hmscHeightfieldSurfaceAt(x: f32, z: f32) ?HmscHfSurface {
    var best: ?HmscHfSurface = null;
    for (&g_hmsc_heightfields) |*hf| {
        if (!hf.active) continue;
        const raw = hmscHfRawHeight(hf, x, z) orelse continue;
        const h = hf.base_y + raw;
        const e = hf.cell;
        const hx0 = hmscHfRawHeight(hf, x - e, z) orelse raw;
        const hx1 = hmscHfRawHeight(hf, x + e, z) orelse raw;
        const hz0 = hmscHfRawHeight(hf, x, z - e) orelse raw;
        const hz1 = hmscHfRawHeight(hf, x, z + e) orelse raw;
        const dhdx = (hx1 - hx0) / (2 * e);
        const dhdz = (hz1 - hz0) / (2 * e);
        const ny = 1.0 / @sqrt(dhdx * dhdx + 1.0 + dhdz * dhdz);
        if (best == null or h > best.?.height) best = .{ .height = h, .normal_y = ny, .walk_cos = hf.walk_cos };
    }
    return best;
}

// __hmsc_register_heightfield(id, originX, originZ, cell, cols, rows, baseY,
// walkCos, samplesFloat32Array) — upload/replace a terrain grid by id. Called
// once when a mountain loads (the grid is static), then referenced every frame
// by the step. Heights are stored above baseY, row-major (iz*cols + ix).
fn hostHmscRegisterHeightfield(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id_f = argToF64(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    const id: usize = @intFromFloat(@max(0.0, id_f));
    if (id >= HMSC_MAX_HEIGHTFIELDS) {
        setReturnNull(info);
        return;
    }
    const cols: usize = @intFromFloat(@max(0.0, argToF64(info, 4) orelse 0));
    const rows: usize = @intFromFloat(@max(0.0, argToF64(info, 5) orelse 0));
    const cell = argToF64(info, 3) orelse 1;
    const count = cols * rows;
    if (count < 4 or count > HMSC_HF_MAX_SAMPLES or cell <= 0) {
        setReturnNull(info);
        return;
    }
    const bytes = argBytes(info, 8) orelse {
        setReturnNull(info);
        return;
    };
    if (bytes.len < count * @sizeOf(f32)) {
        setReturnNull(info);
        return;
    }
    var hf = &g_hmsc_heightfields[id];
    hf.origin_x = @floatCast(argToF64(info, 1) orelse 0);
    hf.origin_z = @floatCast(argToF64(info, 2) orelse 0);
    hf.cell = @floatCast(cell);
    hf.cols = cols;
    hf.rows = rows;
    hf.base_y = @floatCast(argToF64(info, 6) orelse 0);
    hf.walk_cos = @floatCast(argToF64(info, 7) orelse 1);
    // Optional rotation (args after the samples array): yaw radians + pivot. A
    // mountain/hill/painted field passes 0s (axis-aligned); a rotated building's
    // floor passes its yaw + centre so the collider turns with the model.
    hf.yaw = @floatCast(argToF64(info, 9) orelse 0);
    hf.pivot_x = @floatCast(argToF64(info, 10) orelse 0);
    hf.pivot_z = @floatCast(argToF64(info, 11) orelse 0);
    // Byte copy (the source view may be unaligned) into the sample store.
    const dst_bytes = std.mem.sliceAsBytes(hf.samples[0..count]);
    @memcpy(dst_bytes, bytes[0 .. count * @sizeOf(f32)]);
    hf.active = true;
    setReturnNull(info);
}

// __hmsc_clear_heightfields() — drop all registered terrain (world reset / cart
// swap). TS re-registers what the new world needs.
fn hostHmscClearHeightfields(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    for (&g_hmsc_heightfields) |*hf| hf.active = false;
    setReturnNull(info);
}

// __hmsc_spike_trace(on) — flip the engine's host-side per-frame spike logger.
// Driven by `gv_perflog 2` so the host's ground-truth frame phases print
// alongside the JS perfWatch report for cross-checking.
fn hostHmscSpikeTrace(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    @import("engine.zig").g_host_spike_trace = argToBool(info, 0) orelse false;
    setReturnNull(info);
}

// A world XZ point rotated into an oriented rect's local (un-rotated) frame —
// the inverse of the mesh's +Y yaw about the pivot. `cs`/`sn` are cos/sin(yaw);
// the inverse rotation is [[cs, -sn],[sn, cs]] applied to (point - pivot). Matches
// render3d/buildingTransform.ts (whose local→world offset is its transpose).
// (cos/sin are passed in, not named `c` — `c` is the engine C-import at file top.)
fn hmscWorldToLocal(x: f32, z: f32, pivot_x: f32, pivot_z: f32, cs: f32, sn: f32, out_x: *f32, out_z: *f32) void {
    const dx = x - pivot_x;
    const dz = z - pivot_z;
    out_x.* = pivot_x + cs * dx - sn * dz;
    out_z.* = pivot_z + sn * dx + cs * dz;
}

// The reverse: a local point/push back to world (forward +Y yaw), [[cs, sn],[-sn, cs]].
fn hmscLocalToWorld(x: f32, z: f32, pivot_x: f32, pivot_z: f32, cs: f32, sn: f32, out_x: *f32, out_z: *f32) void {
    const dx = x - pivot_x;
    const dz = z - pivot_z;
    out_x.* = pivot_x + cs * dx + sn * dz;
    out_z.* = pivot_z - sn * dx + cs * dz;
}

fn hmscGroundAt(rects: []const f32, oriented: []const f32, x: f32, z: f32, current_y: f32, step_height: f32) f32 {
    var ground_y: f32 = -1000000;
    var at: usize = 0;
    while (at + HMSC_RECT_FLOATS <= rects.len) : (at += HMSC_RECT_FLOATS) {
        // Solid rects (walls, props) ARE standable tops, not just side blockers.
        // The step-height gate below keeps a tall wall from counting as ground at
        // its base (its top is far above current_y + step), so it only becomes
        // ground once you're actually on it — hop onto a hydrant and stand. The
        // side push (hmscCollideSolidRects) still blocks you while your feet are
        // below the top, so "bump from the side, stand from above" both hold.
        if (x >= rects[at] and x <= rects[at + 2] and z >= rects[at + 1] and z <= rects[at + 3]) {
            const rect_height = rects[at + 4];
            if (rect_height <= current_y + step_height) ground_y = @max(ground_y, rect_height);
        }
    }
    // Oriented walls: rotate the foot point into each rect's frame, same test.
    var o: usize = 0;
    while (o + HMSC_ORIENTED_FLOATS <= oriented.len) : (o += HMSC_ORIENTED_FLOATS) {
        const yaw = oriented[o + 11];
        var lx: f32 = undefined;
        var lz: f32 = undefined;
        hmscWorldToLocal(x, z, oriented[o + 9], oriented[o + 10], @cos(yaw), @sin(yaw), &lx, &lz);
        if (lx >= oriented[o] and lx <= oriented[o + 2] and lz >= oriented[o + 1] and lz <= oriented[o + 3]) {
            const rect_height = oriented[o + 4];
            if (rect_height <= current_y + step_height) ground_y = @max(ground_y, rect_height);
        }
    }
    return ground_y;
}

fn hmscSurfaceValueAt(rects: []const f32, oriented: []const f32, x: f32, z: f32, current_y: f32, step_height: f32, value_offset: usize, fallback: f32) f32 {
    var ground_y: f32 = -1000000;
    var value = fallback;
    var at: usize = 0;
    while (at + HMSC_RECT_FLOATS <= rects.len) : (at += HMSC_RECT_FLOATS) {
        // Mirror hmscGroundAt: solids are standable, so when you rest on a prop's
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
    while (o + HMSC_ORIENTED_FLOATS <= oriented.len) : (o += HMSC_ORIENTED_FLOATS) {
        const yaw = oriented[o + 11];
        var lx: f32 = undefined;
        var lz: f32 = undefined;
        hmscWorldToLocal(x, z, oriented[o + 9], oriented[o + 10], @cos(yaw), @sin(yaw), &lx, &lz);
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

fn hmscCollideCircleRect(x: *f32, z: *f32, vx: *f32, vz: *f32, radius: f32, rect: []const f32, restitution: f32) bool {
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

fn hmscCollideSolidRects(x: *f32, y: f32, z: *f32, vx: *f32, vz: *f32, radius: f32, height: f32, rects: []const f32, oriented: []const f32, restitution: f32, step_height: f32) void {
    var at: usize = 0;
    while (at + HMSC_RECT_FLOATS <= rects.len) : (at += HMSC_RECT_FLOATS) {
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
        _ = hmscCollideCircleRect(x, z, vx, vz, radius, rects[at .. at + HMSC_RECT_FLOATS], restitution);
    }
    // Oriented walls (yawed buildings): rotate the body + its velocity into the
    // rect's frame, run the SAME AABB push there, then rotate the result back to
    // world. The first 9 floats are the AABB the push reads; [9..12] are pivot+yaw.
    var o: usize = 0;
    while (o + HMSC_ORIENTED_FLOATS <= oriented.len) : (o += HMSC_ORIENTED_FLOATS) {
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
        hmscWorldToLocal(x.*, z.*, pivot_x, pivot_z, cs, sn, &lx, &lz);
        var lvx = cs * vx.* - sn * vz.*;
        var lvz = sn * vx.* + cs * vz.*;
        if (hmscCollideCircleRect(&lx, &lz, &lvx, &lvz, radius, oriented[o .. o + HMSC_RECT_FLOATS], restitution)) {
            hmscLocalToWorld(lx, lz, pivot_x, pivot_z, cs, sn, x, z);
            vx.* = cs * lvx + sn * lvz;
            vz.* = -sn * lvx + cs * lvz;
        }
    }
}

fn hmscResolveSpherePair(a: []f32, b: []f32) void {
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

fn hostHmscPhysicsStep(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const t0 = nowNs();
    const bytes = argBytes(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    if (bytes.len < HMSC_INPUT_HEADER_FLOATS * @sizeOf(f32)) {
        setReturnNull(info);
        return;
    }
    const input_len = bytes.len / @sizeOf(f32);
    const input_ptr: [*]const f32 = @ptrCast(@alignCast(bytes.ptr));
    const input = input_ptr[0..input_len];

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
    const entity_count = @min(HMSC_MAX_ENTITIES, @as(usize, @intFromFloat(@max(0, input[12]))));
    const rect_count = @min(HMSC_MAX_RECTS, @as(usize, @intFromFloat(@max(0, input[13]))));
    const oriented_count = @min(HMSC_MAX_ORIENTED, @as(usize, @intFromFloat(@max(0, input[24]))));
    const gravity = @max(0, input[14]);
    const jump_speed = @max(0, input[15]);
    const player_radius = @max(0.05, input[16]);
    const player_height = @max(0.2, input[17]);
    const wall_restitution = clamp(input[18], 0, 1);
    const body_restitution = clamp(input[19], 0, 1);
    const step_height = @max(0, input[20]);
    const acceleration_multiplier = clamp(input[21], 0.05, 4);
    const player_surface_friction = clamp(input[22], 0, 1);
    const player_surface_restitution = clamp(input[23], 0, 1);

    const entity_start = HMSC_INPUT_HEADER_FLOATS;
    const rect_start = entity_start + entity_count * HMSC_ENTITY_FLOATS;
    const oriented_start = rect_start + rect_count * HMSC_RECT_FLOATS;
    if (input.len < oriented_start + oriented_count * HMSC_ORIENTED_FLOATS) {
        setReturnNull(info);
        return;
    }
    const rects = input[rect_start .. rect_start + rect_count * HMSC_RECT_FLOATS];
    const oriented = input[oriented_start .. oriented_start + oriented_count * HMSC_ORIENTED_FLOATS];

    const move_len = @sqrt(move_x * move_x + move_z * move_z);
    if (move_len > 0.001) {
        const target_vx = move_x / move_len * speed;
        const target_vz = move_z / move_len * speed;
        const acceleration_blend = clamp(dt * 18 * acceleration_multiplier, 0, 1);
        pvx += (target_vx - pvx) * acceleration_blend;
        pvz += (target_vz - pvz) * acceleration_blend;
    } else {
        const drag = @max(@as(f32, 0), 1 - dt * (6 + player_surface_friction * 16));
        pvx *= drag;
        pvz *= drag;
    }

    // Ground support = highest of the rect floor and any walkable terrain
    // surface under the feet (terrain steeper than its slope limit does not
    // support you, so it is excluded here and handled as a wall after the move).
    var player_ground_y = hmscGroundAt(rects, oriented, px, pz, py, step_height);
    if (hmscHeightfieldSurfaceAt(px, pz)) |s| {
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
    hmscCollideSolidRects(&px, py, &pz, &pvx, &pvz, player_radius, player_height, rects, oriented, @max(wall_restitution, player_surface_restitution * 0.15), step_height);
    var next_ground_y = hmscGroundAt(rects, oriented, px, pz, py, step_height);
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
    if (hmscHeightfieldSurfaceAt(px, pz)) |s| {
        const walkable = s.normal_y >= s.walk_cos;
        if (!walkable and s.height > py + 0.02) {
            px = prev_px;
            pz = prev_pz;
            pvx = 0;
            pvz = 0;
            if (hmscHeightfieldSurfaceAt(px, pz)) |held| {
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

    var at: usize = HMSC_OUTPUT_HEADER_FLOATS;
    var i: usize = 0;
    while (i < entity_count) : (i += 1) {
        const src = entity_start + i * HMSC_ENTITY_FLOATS;
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
        hmscCollideSolidRects(&x, y - r, &z, &vx, &vz, r, r * 2, rects, oriented, wall_restitution, entity_step_height);
        const gy = hmscGroundAt(rects, oriented, x, z, y - r, entity_step_height) + r;
        const surface_friction = clamp(hmscSurfaceValueAt(rects, oriented, x, z, y - r, entity_step_height, 6, 0.2), 0, 1);
        const surface_restitution = clamp(hmscSurfaceValueAt(rects, oriented, x, z, y - r, entity_step_height, 7, 0.8), 0, 1);
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

        g_hmsc_snapshot[at] = x;
        at += 1;
        g_hmsc_snapshot[at] = y;
        at += 1;
        g_hmsc_snapshot[at] = z;
        at += 1;
        g_hmsc_snapshot[at] = vx;
        at += 1;
        g_hmsc_snapshot[at] = vy;
        at += 1;
        g_hmsc_snapshot[at] = vz;
        at += 1;
        g_hmsc_snapshot[at] = r;
        at += 1;
        g_hmsc_snapshot[at] = grounded;
        at += 1;
    }

    i = 0;
    while (i < entity_count) : (i += 1) {
        var j = i + 1;
        while (j < entity_count) : (j += 1) {
            const a = HMSC_OUTPUT_HEADER_FLOATS + i * HMSC_ENTITY_FLOATS;
            const b = HMSC_OUTPUT_HEADER_FLOATS + j * HMSC_ENTITY_FLOATS;
            hmscResolveSpherePair(g_hmsc_snapshot[a .. a + HMSC_ENTITY_FLOATS], g_hmsc_snapshot[b .. b + HMSC_ENTITY_FLOATS]);
        }
    }

    g_hmsc_snapshot[0] = @floatCast(@as(f64, @floatFromInt(nowNs() - t0)) / 1000.0);
    g_hmsc_snapshot[1] = px;
    g_hmsc_snapshot[2] = py;
    g_hmsc_snapshot[3] = pz;
    g_hmsc_snapshot[4] = pvx;
    g_hmsc_snapshot[5] = pvy;
    g_hmsc_snapshot[6] = pvz;
    g_hmsc_snapshot[7] = if (player_grounded) 1 else 0;
    g_hmsc_snapshot[8] = @floatFromInt(entity_count);
    _ = body_restitution;
    setReturnF32Buffer(info, g_hmsc_snapshot[0 .. HMSC_OUTPUT_HEADER_FLOATS + entity_count * HMSC_ENTITY_FLOATS]);
}

pub fn registerPhysicsLab(_: anytype) void {
    reset(5);
    v8_runtime.registerHostFn("__physics_lab_reset", hostReset);
    v8_runtime.registerHostFn("__physics_lab_burst", hostBurst);
    v8_runtime.registerHostFn("__physics_lab_step", hostStep);
    v8_runtime.registerHostFn("__physics_lab_step_buffer", hostStepBuffer);
    v8_runtime.registerHostFn("__hmsc_physics_step", hostHmscPhysicsStep);
    v8_runtime.registerHostFn("__hmsc_register_heightfield", hostHmscRegisterHeightfield);
    v8_runtime.registerHostFn("__hmsc_clear_heightfields", hostHmscClearHeightfields);
    v8_runtime.registerHostFn("__hmsc_spike_trace", hostHmscSpikeTrace);
}
