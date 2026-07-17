//! Host physics lab bindings — Zig-side copy of cart/physics_lab's toy world.
//! ONLY the toy lives here.
//!
//! GRADUATION (WO-1, 2026-06): the game's `__hmsc_*` sim that used to share
//! this file moved to framework/game/physics.zig (+ movement.zig), registered
//! by framework/v8_bindings_game_physics.zig behind -Dhas-game-physics. This
//! file's name finally tells the truth (V18/R1): it registers the
//! __physics_lab_* demo world for cart/physics_lab and nothing else.
//!
//! Host fns:
//!   __physics_lab_reset(count?)        reset the sim, optional seeded ball count
//!   __physics_lab_burst(count?)        add more balls
//!   __physics_lab_step(cameraYaw, paused?) -> CSV snapshot
//!   __physics_lab_step_buffer(cameraYaw, paused?) -> Float32 ArrayBuffer snapshot
//!
//! The hot snapshot path is a host-owned packed f32 buffer:
//!   t,contacts,peak,px,py,pz,pvy,pyaw,onGround,moving,count,us,
//!   bx,by,bz,br,itemIndex,rx,ry,rz,spin,...
//!
//! CSV is retained as a compatibility/debug fallback.

const std = @import("std");
const host_io = @import("host_io.zig");
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
    return @as(i64, @truncate(host_io.nanoTimestamp()));
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
    var out: std.ArrayList(u8) = .empty;
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

pub fn registerPhysicsLab(_: anytype) void {
    reset(5);
    v8_runtime.registerHostFn("__physics_lab_reset", hostReset);
    v8_runtime.registerHostFn("__physics_lab_burst", hostBurst);
    v8_runtime.registerHostFn("__physics_lab_step", hostStep);
    v8_runtime.registerHostFn("__physics_lab_step_buffer", hostStepBuffer);
}
