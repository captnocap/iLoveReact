//! world_loader.zig — the stateless Zig loader (PLATMOD §4, V28). NO V8.
//!
//! Built with -Duse-v8=false: the binary links the GPU substrate (SDL3 + wgpu +
//! the framework draw pipelines + capture) and ZERO V8 / zero embedded bundle.
//! It reads a baked game-file, hands it to the constructor (which installs +
//! verifies the asset vocabulary and resolves every reference), and renders the
//! constructed world's 3D geometry to the swapchain via gpu/3d.zig — then (in
//! headless mode) captures its OWN frame to a PNG (SELFSHOT-0606, hidden window,
//! no desktop). This proves the user's pipeline end to end: TypeScript/React ->
//! encoded data -> stateless engine -> rendered 3D frame, no JS.
//!
//! The world's geometry rides as a packed instance buffer (the INSTANCES map
//! lump): every authored object — region, road, prop, building, landform — is
//! one box instance. The host expands the whole batch with a single interned
//! unit-cube geometry and one instanced draw. 3D is the ONLY path — there is no
//! 2D tile grid and no flag to gate it.
//!
//! Build:
//!   zig build app -Dapp-name=world_loader -Dapp-source=world_loader.zig \
//!     -Duse-v8=false -Dhas-gpu=true -Doptimize=ReleaseFast
//! Run (headless self-capture):
//!   ZIGOS_HEADLESS=1 ZIGOS_SCREENSHOT=1 ZIGOS_SCREENSHOT_OUTPUT=out.png \
//!     ZIGOS_SCREENSHOT_FRAMES=8 ./zig-out/bin/world_loader [game-file.b64]

const std = @import("std");
const c = @import("framework/c.zig").imports;
const gpu = @import("framework/gpu/gpu.zig");
const capture = @import("framework/gpu/capture.zig");
const scene3d = @import("framework/gpu/3d.zig");
const layout = @import("framework/layout.zig");
const Node = layout.Node;
const constructor = @import("framework/world/constructor.zig");
const game_physics = @import("framework/game/physics.zig");

const WIN_W: c_int = 800;
const WIN_H: c_int = 600;
const DEFAULT_FIXTURE = "framework/testing/fixtures/gamefile_roundtrip.b64";
const RJMP_MAGIC: u32 = 0x504d4a52;
const STORE_DIR = "zig-out/game/contentstore";
const MAX_FRAMES: u32 = 600;
// Instance row: pos3 + rot3 + scale3 + color3 + optional shape id. The first
// 12 floats match gpu/3d.zig; shape id is loader metadata for keyed geometry.
const INSTANCE_STRIDE: usize = 12;
const SHAPE_BOX: f32 = 0;
const SHAPE_RAMP: f32 = 1;
const SCAN_A: usize = 4;
const SCAN_D: usize = 7;
const SCAN_S: usize = 22;
const SCAN_W: usize = 26;
const SCAN_SPACE: usize = 44;
const SCAN_LSHIFT: usize = 225;
const CAMERA_DISTANCE_METERS: f32 = 7.65;
const CAMERA_INITIAL_PITCH_DEGREES: f32 = 17.8;
const CAMERA_MIN_PITCH_DEGREES: f32 = -10.0;
const CAMERA_MAX_PITCH_DEGREES: f32 = 62.0;
const CAMERA_TARGET_HEIGHT_METERS: f32 = 1.45;
const CAMERA_FOV_DEGREES: f32 = 52.0;
const CAMERA_YAW_DEGREES_PER_PIXEL: f32 = 0.28;
const CAMERA_PITCH_DEGREES_PER_PIXEL: f32 = 0.22;
const CAMERA_SMOOTHING_PER_SECOND: f32 = 14.0;
const AIM_SHOULDER_SHIFT_METERS: f32 = 0.62;
const AIM_PIVOT_HEIGHT_METERS: f32 = 1.62;
const AIM_CROUCH_DROP_METERS: f32 = 0.42;
const AIM_DISTANCE_METERS: f32 = 2.4;
const AIM_LOOK_AHEAD_METERS: f32 = 12.0;
const AIM_MIN_PITCH_DEGREES: f32 = -1.15 * 180.0 / std.math.pi;
const AIM_MAX_PITCH_DEGREES: f32 = 1.0 * 180.0 / std.math.pi;
const AIM_FOV_DEGREES: f32 = 47.0;
const PLAYER_WALK_SPEED_METERS_PER_SECOND: f32 = 4.5;
const PLAYER_RUN_SPEED_METERS_PER_SECOND: f32 = 8.0;
const PLAYER_RADIUS_METERS: f32 = 0.42;
const PLAYER_HEIGHT_METERS: f32 = 1.9;
const PLAYER_STEP_HEIGHT_METERS: f32 = 0.42;
const PLAYER_WALL_RESTITUTION: f32 = 0.0;
const PLAYER_SURFACE_FRICTION: f32 = 0.55;
const PLAYER_SURFACE_RESTITUTION: f32 = 0.0;
const PLAYER_ACCELERATION_MULTIPLIER: f32 = 1.0;
const PLAYER_GRAVITY_METERS_PER_SECOND2: f32 = 10.0;
const PLAYER_JUMP_SPEED_METERS_PER_SECOND: f32 = 5.2;
const WALKABLE_SIDE_PUSH_GRACE_METERS: f32 = 0.08;
const PHYSICS_SOLID_HEIGHT_METERS: f32 = PLAYER_STEP_HEIGHT_METERS + 0.05;
const RAMP_SLAB_THICKNESS_METERS: f32 = 0.2;
const RAMP_SLAB_THICKNESS_RATIO: f32 = RAMP_SLAB_THICKNESS_METERS / 3.0;
const RAMP_HEIGHTFIELD_CELL_METERS: f32 = 0.6;
const RAMP_WALKABLE_SLOPE_COS: f32 = 0.6;
const PLAYER_WALK_CYCLES_PER_SECOND: f32 = 1.6;
const PLAYER_RUN_CYCLES_PER_SECOND: f32 = 2.3;
const PLAYER_CLIP_IDLE: u32 = 0;
const PLAYER_CLIP_WALK: u32 = 1;
const PLAYER_CLIP_JUMP: u32 = 2;
const MAX_EMBEDDED_LOADERS: usize = 8;

const log = std.debug;

const Vec3 = struct {
    x: f32,
    y: f32,
    z: f32,
};

const PlayerState = struct {
    x: f32,
    y: f32,
    z: f32,
    vx: f32 = 0,
    vy: f32 = 0,
    vz: f32 = 0,
    yaw: f32,
    grounded: bool = false,
    gait_phase: f32 = 0,
    jump_time: f32 = 0,
};

const CameraState = struct {
    yaw_degrees: f32,
    pitch_degrees: f32,
    current_pos: Vec3 = .{ .x = 0, .y = 0, .z = 0 },
    current_target: Vec3 = .{ .x = 0, .y = 0, .z = 0 },
    current_fov: f32 = CAMERA_FOV_DEGREES,
    initialized: bool = false,
    aiming: bool = false,
    far: f32,
};

const PhysicsColliders = struct {
    values: []f32,
    rect_count: usize,
    oriented_count: usize,
    heightfield_count: usize,
    clipped_rows: usize,

    pub fn deinit(self: PhysicsColliders, allocator: std.mem.Allocator) void {
        allocator.free(self.values);
    }
};

fn clamp(v: f32, lo: f32, hi: f32) f32 {
    return @max(lo, @min(hi, v));
}

fn lerp(a: f32, b: f32, t: f32) f32 {
    return a + (b - a) * t;
}

fn lerpVec3(a: Vec3, b: Vec3, t: f32) Vec3 {
    return .{
        .x = lerp(a.x, b.x, t),
        .y = lerp(a.y, b.y, t),
        .z = lerp(a.z, b.z, t),
    };
}

fn rotateYLocal(local: [3]f32, yaw_degrees: f32) Vec3 {
    const rad = yaw_degrees * std.math.pi / 180.0;
    const c0 = @cos(rad);
    const s = @sin(rad);
    return .{
        .x = local[0] * c0 + local[2] * s,
        .y = local[1],
        .z = -local[0] * s + local[2] * c0,
    };
}

fn nowNs() i64 {
    return @as(i64, @truncate(std.time.nanoTimestamp()));
}

fn keyDown(scancode: usize) bool {
    const keys = c.SDL_GetKeyboardState(null);
    if (keys == null) return false;
    return keys[scancode];
}

/// Read a game-file. Runtime artifacts are raw RJMP bytes; legacy round-trip
/// fixtures remain base64 text and are decoded only as a compatibility path.
fn loadGameFile(allocator: std.mem.Allocator, path: []const u8) ![]u8 {
    const raw = try std.fs.cwd().readFileAlloc(allocator, path, 8 << 20);
    if (raw.len >= 4 and std.mem.readInt(u32, raw[0..4], .little) == RJMP_MAGIC) return raw;
    defer allocator.free(raw);
    const trimmed = std.mem.trim(u8, raw, " \t\r\n");
    const dec = std.base64.standard.Decoder;
    const size = try dec.calcSizeForSlice(trimmed);
    const out = try allocator.alloc(u8, size);
    errdefer allocator.free(out);
    try dec.decode(out, trimmed);
    return out;
}

/// Map a tile value to a fill color. Empty cells are not drawn: a null cell, and
/// — by hmsc's string-table convention — tile index 0, the 'null' kind. Indices
/// 1.. are distinct map kinds. Used only for the tile-extrusion fallback when a
/// game-file carries no instance buffer (e.g. the codec round-trip fixture).
fn tileColor(value: ?u16) ?[3]f32 {
    const v = value orelse return null;
    if (v == 0) return null;
    const palette = [_][3]f32{
        .{ 0.18, 0.65, 0.62 }, // teal
        .{ 0.92, 0.52, 0.18 }, // orange
        .{ 0.30, 0.45, 0.85 }, // blue
        .{ 0.45, 0.72, 0.34 }, // green
        .{ 0.82, 0.35, 0.55 }, // magenta
        .{ 0.85, 0.78, 0.30 }, // yellow
        .{ 0.55, 0.55, 0.62 }, // gray
        .{ 0.70, 0.45, 0.30 }, // brown
    };
    return palette[@as(usize, v - 1) % palette.len];
}

/// A unit cube as 36 interleaved verts (pos3 + normal3 + uv2), CCW-wound for the
/// back-face/ccw mesh pipeline. ONE interned geometry; every world object is an
/// instance of it, scaled + positioned + colored by the instance buffer.
fn buildCube() [36 * 8]f32 {
    const Corner = [3]f32;
    const Face = struct { n: Corner, a: Corner, b: Corner, c: Corner, d: Corner };
    const v0 = Corner{ -0.5, -0.5, -0.5 };
    const v1 = Corner{ 0.5, -0.5, -0.5 };
    const v2 = Corner{ 0.5, 0.5, -0.5 };
    const v3 = Corner{ -0.5, 0.5, -0.5 };
    const v4 = Corner{ -0.5, -0.5, 0.5 };
    const v5 = Corner{ 0.5, -0.5, 0.5 };
    const v6 = Corner{ 0.5, 0.5, 0.5 };
    const v7 = Corner{ -0.5, 0.5, 0.5 };
    const faces = [_]Face{
        .{ .n = .{ 0, 0, 1 }, .a = v4, .b = v5, .c = v6, .d = v7 }, // +Z
        .{ .n = .{ 0, 0, -1 }, .a = v1, .b = v0, .c = v3, .d = v2 }, // -Z
        .{ .n = .{ 1, 0, 0 }, .a = v5, .b = v1, .c = v2, .d = v6 }, // +X
        .{ .n = .{ -1, 0, 0 }, .a = v0, .b = v4, .c = v7, .d = v3 }, // -X
        .{ .n = .{ 0, 1, 0 }, .a = v7, .b = v6, .c = v2, .d = v3 }, // +Y
        .{ .n = .{ 0, -1, 0 }, .a = v0, .b = v1, .c = v5, .d = v4 }, // -Y
    };
    const uvs = [4][2]f32{ .{ 0, 0 }, .{ 1, 0 }, .{ 1, 1 }, .{ 0, 1 } };
    var out: [36 * 8]f32 = undefined;
    var i: usize = 0;
    for (faces) |f| {
        const quad = [4]Corner{ f.a, f.b, f.c, f.d };
        for ([6]usize{ 0, 1, 2, 0, 2, 3 }) |q| {
            const p = quad[q];
            out[i + 0] = p[0];
            out[i + 1] = p[1];
            out[i + 2] = p[2];
            out[i + 3] = f.n[0];
            out[i + 4] = f.n[1];
            out[i + 5] = f.n[2];
            out[i + 6] = uvs[q][0];
            out[i + 7] = uvs[q][1];
            i += 8;
        }
    }
    return out;
}

fn pushVertex(out: []f32, idx: *usize, p: [3]f32, n: [3]f32, uv: [2]f32) void {
    out[idx.* + 0] = p[0];
    out[idx.* + 1] = p[1];
    out[idx.* + 2] = p[2];
    out[idx.* + 3] = n[0];
    out[idx.* + 4] = n[1];
    out[idx.* + 5] = n[2];
    out[idx.* + 6] = uv[0];
    out[idx.* + 7] = uv[1];
    idx.* += 8;
}

fn pushTri(out: []f32, idx: *usize, a: [3]f32, b: [3]f32, c0: [3]f32, n: [3]f32, uva: [2]f32, uvb: [2]f32, uvc: [2]f32) void {
    pushVertex(out, idx, a, n, uva);
    pushVertex(out, idx, b, n, uvb);
    pushVertex(out, idx, c0, n, uvc);
}

fn pushFace(out: []f32, idx: *usize, a: [3]f32, b: [3]f32, c0: [3]f32, d: [3]f32, n: [3]f32) void {
    pushTri(out, idx, a, b, c0, n, .{ 0, 0 }, .{ 1, 0 }, .{ 1, 1 });
    pushTri(out, idx, a, c0, d, n, .{ 0, 0 }, .{ 1, 1 }, .{ 0, 1 });
}

fn normalize3(x: f32, y: f32, z: f32) [3]f32 {
    const len = @sqrt(x * x + y * y + z * z);
    if (len <= 0.000001) return .{ 0, 1, 0 };
    return .{ x / len, y / len, z / len };
}

/// /test's RampSlabGeometry normalized for instancing: local x/z are unit
/// footprint, local y is centered so scale.y = catalog rise and position.y is
/// base + rise/2. The slab thickness ratio matches the common 3m ramp.
fn buildRampSlab() [36 * 8]f32 {
    const hx: f32 = 0.5;
    const hz: f32 = 0.5;
    const rise0: f32 = -0.5;
    const rise1: f32 = 0.5;
    const t: f32 = RAMP_SLAB_THICKNESS_RATIO;
    const low_top = [2][3]f32{ .{ -hx, rise0, -hz }, .{ hx, rise0, -hz } };
    const high_top = [2][3]f32{ .{ -hx, rise1, hz }, .{ hx, rise1, hz } };
    const low_bottom = [2][3]f32{ .{ -hx, rise0 - t, -hz }, .{ hx, rise0 - t, -hz } };
    const high_bottom = [2][3]f32{ .{ -hx, rise1 - t, hz }, .{ hx, rise1 - t, hz } };
    const top_normal = normalize3(0, 1, -1);
    const bottom_normal = normalize3(0, -1, 1);
    var out: [36 * 8]f32 = undefined;
    var i: usize = 0;
    pushTri(out[0..], &i, low_top[0], high_top[1], low_top[1], top_normal, .{ 0, 0 }, .{ 1, 1 }, .{ 1, 0 });
    pushTri(out[0..], &i, low_top[0], high_top[0], high_top[1], top_normal, .{ 0, 0 }, .{ 0, 1 }, .{ 1, 1 });
    pushTri(out[0..], &i, low_bottom[0], low_bottom[1], high_bottom[1], bottom_normal, .{ 0, 0 }, .{ 1, 0 }, .{ 1, 1 });
    pushTri(out[0..], &i, low_bottom[0], high_bottom[1], high_bottom[0], bottom_normal, .{ 0, 0 }, .{ 1, 1 }, .{ 0, 1 });
    pushFace(out[0..], &i, low_bottom[1], low_top[1], high_top[1], high_bottom[1], .{ 1, 0, 0 });
    pushFace(out[0..], &i, low_top[0], low_bottom[0], high_bottom[0], high_top[0], .{ -1, 0, 0 });
    pushFace(out[0..], &i, low_bottom[0], low_bottom[1], low_top[1], low_top[0], .{ 0, 0, -1 });
    pushFace(out[0..], &i, high_bottom[1], high_bottom[0], high_top[0], high_top[1], .{ 0, 0, 1 });
    return out;
}

/// Fallback geometry for a game-file with no instance buffer: extrude each
/// non-null tile into one box instance (stride 9: pos3/scale3/color3). Heap-
/// owned; the caller frees it after the frame loop.
fn extrudeTiles(allocator: std.mem.Allocator, scene: constructor.Scene) ![]f32 {
    var list: std.ArrayList(f32) = .{};
    errdefer list.deinit(allocator);
    var y: u32 = 0;
    while (y < scene.height) : (y += 1) {
        var x: u32 = 0;
        while (x < scene.width) : (x += 1) {
            const color = tileColor(scene.tiles[y * scene.width + x]) orelse continue;
            try list.appendSlice(allocator, &[_]f32{
                @floatFromInt(x), 0.25, @floatFromInt(y), // position (center)
                0, 0, 0, // rotation (yaw unused)
                0.9, 0.5, 0.9, // scale
                color[0], color[1], color[2], // color
            });
        }
    }
    return list.toOwnedSlice(allocator);
}

const ShapeBatches = struct {
    boxes: []f32,
    box_count: u32,
    ramps: []f32,
    ramp_count: u32,

    pub fn deinit(self: ShapeBatches, allocator: std.mem.Allocator) void {
        allocator.free(self.boxes);
        allocator.free(self.ramps);
    }
};

fn buildShapeBatches(allocator: std.mem.Allocator, insts: []const f32, inst_count: u32, stride: usize) !ShapeBatches {
    var boxes: std.ArrayList(f32) = .{};
    errdefer boxes.deinit(allocator);
    var ramps: std.ArrayList(f32) = .{};
    errdefer ramps.deinit(allocator);
    var box_count: u32 = 0;
    var ramp_count: u32 = 0;
    var row: usize = 0;
    while (row < @as(usize, @intCast(inst_count))) : (row += 1) {
        const b = row * stride;
        const src = insts[b .. b + stride];
        if (isRampInstance(insts, row, stride)) {
            try ramps.appendSlice(allocator, src);
            ramp_count += 1;
        } else {
            try boxes.appendSlice(allocator, src);
            box_count += 1;
        }
    }
    return .{
        .boxes = try boxes.toOwnedSlice(allocator),
        .box_count = box_count,
        .ramps = try ramps.toOwnedSlice(allocator),
        .ramp_count = ramp_count,
    };
}

const Bounds = struct {
    cx: f32,
    cy: f32,
    cz: f32,
    radius: f32, // half the largest world extent (xz), min-clamped
};

/// Axis-aligned bounds of an instance batch (each row: pos3/scale3/color3),
/// used to auto-frame the camera so the whole world fits in view.
fn instanceBounds(insts: []const f32, count: u32, stride: usize) Bounds {
    if (count == 0) return .{ .cx = 0, .cy = 0, .cz = 0, .radius = 16 };
    // Scale floats follow the optional rot3 block: at +6 for stride>=12, else +3.
    const scale_base: usize = if (stride >= 12) 6 else 3;
    var min_x: f32 = std.math.floatMax(f32);
    var min_y: f32 = std.math.floatMax(f32);
    var min_z: f32 = std.math.floatMax(f32);
    var max_x: f32 = -std.math.floatMax(f32);
    var max_y: f32 = -std.math.floatMax(f32);
    var max_z: f32 = -std.math.floatMax(f32);
    var i: usize = 0;
    while (i < count) : (i += 1) {
        const b = i * stride;
        const px = insts[b + 0];
        const py = insts[b + 1];
        const pz = insts[b + 2];
        const hx = @abs(insts[b + scale_base + 0]) * 0.5;
        const hy = @abs(insts[b + scale_base + 1]) * 0.5;
        const hz = @abs(insts[b + scale_base + 2]) * 0.5;
        min_x = @min(min_x, px - hx);
        max_x = @max(max_x, px + hx);
        min_y = @min(min_y, py - hy);
        max_y = @max(max_y, py + hy);
        min_z = @min(min_z, pz - hz);
        max_z = @max(max_z, pz + hz);
    }
    const span_x = max_x - min_x;
    const span_z = max_z - min_z;
    const radius = @max(8.0, @max(span_x, span_z) * 0.5);
    return .{
        .cx = (min_x + max_x) * 0.5,
        .cy = (min_y + max_y) * 0.5,
        .cz = (min_z + max_z) * 0.5,
        .radius = radius,
    };
}

fn instanceTop(insts: []const f32, row: usize, stride: usize) f32 {
    const scale_base: usize = if (stride >= 12) 6 else 3;
    const b = row * stride;
    return insts[b + 1] + @abs(insts[b + scale_base + 1]) * 0.5;
}

fn instanceCovers(insts: []const f32, row: usize, stride: usize, x: f32, z: f32) bool {
    const scale_base: usize = if (stride >= 12) 6 else 3;
    const b = row * stride;
    const hx = @abs(insts[b + scale_base + 0]) * 0.5;
    const hz = @abs(insts[b + scale_base + 2]) * 0.5;
    return x >= insts[b + 0] - hx and x <= insts[b + 0] + hx and
        z >= insts[b + 2] - hz and z <= insts[b + 2] + hz;
}

fn instanceYawRadians(insts: []const f32, row: usize, stride: usize) f32 {
    if (stride < 12) return 0;
    return insts[row * stride + 4] * std.math.pi / 180.0;
}

fn instanceShapeId(insts: []const f32, row: usize, stride: usize) f32 {
    if (stride < 13) return SHAPE_BOX;
    return insts[row * stride + 12];
}

fn isRampInstance(insts: []const f32, row: usize, stride: usize) bool {
    return @abs(instanceShapeId(insts, row, stride) - SHAPE_RAMP) < 0.5;
}

fn appendPhysicsRect(allocator: std.mem.Allocator, list: *std.ArrayList(f32), insts: []const f32, row: usize, stride: usize, solid: bool) !void {
    const scale_base: usize = if (stride >= 12) 6 else 3;
    const b = row * stride;
    const sx = @abs(insts[b + scale_base + 0]);
    const sy = @abs(insts[b + scale_base + 1]);
    const sz = @abs(insts[b + scale_base + 2]);
    const hx = sx * 0.5;
    const hz = sz * 0.5;
    const top = insts[b + 1] + sy * 0.5;
    const floor = if (solid) insts[b + 1] - sy * 0.5 else -1.0e9;
    try list.appendSlice(allocator, &[_]f32{
        insts[b + 0] - hx,
        insts[b + 2] - hz,
        insts[b + 0] + hx,
        insts[b + 2] + hz,
        top,
        if (solid) 1 else 0,
        PLAYER_SURFACE_FRICTION,
        PLAYER_SURFACE_RESTITUTION,
        floor,
    });
}

fn appendPhysicsOrientedRect(allocator: std.mem.Allocator, list: *std.ArrayList(f32), insts: []const f32, row: usize, stride: usize, solid: bool) !void {
    const scale_base: usize = if (stride >= 12) 6 else 3;
    const b = row * stride;
    const sx = @abs(insts[b + scale_base + 0]);
    const sy = @abs(insts[b + scale_base + 1]);
    const sz = @abs(insts[b + scale_base + 2]);
    const hx = sx * 0.5;
    const hz = sz * 0.5;
    const top = insts[b + 1] + sy * 0.5;
    const floor = if (solid) insts[b + 1] - sy * 0.5 else -1.0e9;
    try list.appendSlice(allocator, &[_]f32{
        insts[b + 0] - hx,
        insts[b + 2] - hz,
        insts[b + 0] + hx,
        insts[b + 2] + hz,
        top,
        if (solid) 1 else 0,
        PLAYER_SURFACE_FRICTION,
        PLAYER_SURFACE_RESTITUTION,
        floor,
        insts[b + 0],
        insts[b + 2],
        instanceYawRadians(insts, row, stride),
    });
}

fn registerRampHeightfield(insts: []const f32, row: usize, stride: usize, slot: usize) bool {
    const scale_base: usize = if (stride >= 12) 6 else 3;
    const b = row * stride;
    const width = @abs(insts[b + scale_base + 0]);
    const rise = @abs(insts[b + scale_base + 1]);
    const depth = @abs(insts[b + scale_base + 2]);
    if (width <= 0.001 or rise <= 0.001 or depth <= 0.001) return false;
    const cols: usize = @max(2, @as(usize, @intFromFloat(@round(width / RAMP_HEIGHTFIELD_CELL_METERS))) + 1);
    const rows: usize = @max(2, @as(usize, @intFromFloat(@round(depth / RAMP_HEIGHTFIELD_CELL_METERS))) + 1);
    const count = cols * rows;
    if (count > game_physics.HF_MAX_SAMPLES) return false;
    var samples: [game_physics.HF_MAX_SAMPLES]f32 = [_]f32{0} ** game_physics.HF_MAX_SAMPLES;
    var r: usize = 0;
    while (r < rows) : (r += 1) {
        const h = (@as(f32, @floatFromInt(r)) / @as(f32, @floatFromInt(rows - 1))) * rise;
        var cidx: usize = 0;
        while (cidx < cols) : (cidx += 1) {
            samples[r * cols + cidx] = h;
        }
    }
    const base_y = insts[b + 1] - rise * 0.5;
    const sample_bytes = std.mem.sliceAsBytes(samples[0..count]);
    return game_physics.registerHeightfield(.{
        .id = slot,
        .origin_x = insts[b + 0] - width * 0.5,
        .origin_z = insts[b + 2] - depth * 0.5,
        .cell = RAMP_HEIGHTFIELD_CELL_METERS,
        .cols = cols,
        .rows = rows,
        .base_y = base_y,
        .walk_cos = RAMP_WALKABLE_SLOPE_COS,
        .yaw = instanceYawRadians(insts, row, stride),
        .pivot_x = insts[b + 0],
        .pivot_z = insts[b + 2],
    }, sample_bytes);
}

fn buildPhysicsColliders(allocator: std.mem.Allocator, insts: []const f32, inst_count: u32, stride: usize) !PhysicsColliders {
    var rects: std.ArrayList(f32) = .{};
    errdefer rects.deinit(allocator);
    var oriented: std.ArrayList(f32) = .{};
    errdefer oriented.deinit(allocator);
    var rect_count: usize = 0;
    var oriented_count: usize = 0;
    var heightfield_count: usize = 0;
    var clipped_rows: usize = 0;

    game_physics.clearHeightfields();
    const total_rows: usize = @intCast(inst_count);
    var row: usize = 0;
    while (row < total_rows) : (row += 1) {
        if (isRampInstance(insts, row, stride)) {
            if (heightfield_count < game_physics.MAX_HEIGHTFIELDS and registerRampHeightfield(insts, row, stride, heightfield_count)) {
                heightfield_count += 1;
            } else {
                clipped_rows += 1;
            }
            continue;
        }
        const scale_base: usize = if (stride >= 12) 6 else 3;
        const b = row * stride;
        const sx = @abs(insts[b + scale_base + 0]);
        const sy = @abs(insts[b + scale_base + 1]);
        const sz = @abs(insts[b + scale_base + 2]);
        if (sx <= 0.001 or sy <= 0.001 or sz <= 0.001) continue;
        const solid = sy > PHYSICS_SOLID_HEIGHT_METERS;
        const yaw = instanceYawRadians(insts, row, stride);
        if (@abs(yaw) > 0.0001) {
            if (oriented_count >= game_physics.MAX_ORIENTED) {
                clipped_rows += 1;
                continue;
            }
            try appendPhysicsOrientedRect(allocator, &oriented, insts, row, stride, solid);
            oriented_count += 1;
        } else {
            if (rect_count >= game_physics.MAX_RECTS) {
                clipped_rows += 1;
                continue;
            }
            try appendPhysicsRect(allocator, &rects, insts, row, stride, solid);
            rect_count += 1;
        }
    }

    var values = try allocator.alloc(f32, game_physics.INPUT_HEADER_FLOATS + rects.items.len + oriented.items.len);
    @memset(values, 0);
    @memcpy(values[game_physics.INPUT_HEADER_FLOATS .. game_physics.INPUT_HEADER_FLOATS + rects.items.len], rects.items);
    @memcpy(values[game_physics.INPUT_HEADER_FLOATS + rects.items.len ..], oriented.items);
    rects.deinit(allocator);
    oriented.deinit(allocator);
    return .{ .values = values, .rect_count = rect_count, .oriented_count = oriented_count, .heightfield_count = heightfield_count, .clipped_rows = clipped_rows };
}

fn runPlayerPhysics(player: *PlayerState, colliders: *PhysicsColliders, dt: f32, intent: game_physics.movement.Direction, speed: f32, jump_down: bool) void {
    if (colliders.values.len < game_physics.INPUT_HEADER_FLOATS) return;
    const input = colliders.values;
    input[0] = dt;
    input[1] = intent.x;
    input[2] = intent.z;
    input[3] = speed;
    input[4] = if (jump_down) 1 else 0;
    input[5] = player.x;
    input[6] = player.y;
    input[7] = player.z;
    input[8] = player.vx;
    input[9] = player.vy;
    input[10] = player.vz;
    input[11] = WALKABLE_SIDE_PUSH_GRACE_METERS;
    input[12] = 0;
    input[13] = @floatFromInt(colliders.rect_count);
    input[14] = PLAYER_GRAVITY_METERS_PER_SECOND2;
    input[15] = PLAYER_JUMP_SPEED_METERS_PER_SECOND;
    input[16] = PLAYER_RADIUS_METERS;
    input[17] = PLAYER_HEIGHT_METERS;
    input[18] = PLAYER_WALL_RESTITUTION;
    input[19] = 0;
    input[20] = PLAYER_STEP_HEIGHT_METERS;
    input[21] = PLAYER_ACCELERATION_MULTIPLIER;
    input[22] = PLAYER_SURFACE_FRICTION;
    input[23] = PLAYER_SURFACE_RESTITUTION;
    input[24] = @floatFromInt(colliders.oriented_count);

    const out = game_physics.step(input) orelse return;
    player.x = out[1];
    player.y = out[2];
    player.z = out[3];
    player.vx = out[4];
    player.vy = out[5];
    player.vz = out[6];
    player.grounded = out[7] > 0.5;
    const horizontal_speed = @sqrt(player.vx * player.vx + player.vz * player.vz);
    if (horizontal_speed > 0.05) {
        player.yaw = std.math.atan2(player.vx, player.vz);
    } else if (@sqrt(intent.x * intent.x + intent.z * intent.z) > 0.001) {
        player.yaw = std.math.atan2(intent.x, intent.z);
    }
}

fn chooseSpawn(insts: []const f32, inst_count: u32, piece_count: u32, stride: usize, bounds: Bounds) Vec3 {
    const wanted_x = bounds.cx;
    const wanted_z = bounds.cz;
    var best_row: ?usize = null;
    var best_dist2: f32 = std.math.floatMax(f32);
    const total_rows: usize = @intCast(inst_count);
    var row: usize = @min(@as(usize, @intCast(piece_count)), total_rows);
    while (row < total_rows) : (row += 1) {
        const b = row * stride;
        const scale_base: usize = if (stride >= 12) 6 else 3;
        const sy = @abs(insts[b + scale_base + 1]);
        if (sy > 0.75) continue;
        const dx = insts[b + 0] - wanted_x;
        const dz = insts[b + 2] - wanted_z;
        const d2 = dx * dx + dz * dz;
        if (d2 < best_dist2) {
            best_dist2 = d2;
            best_row = row;
        }
    }
    if (best_row == null) {
        row = 0;
        while (row < total_rows) : (row += 1) {
            const b = row * stride;
            const scale_base: usize = if (stride >= 12) 6 else 3;
            const sx = @abs(insts[b + scale_base + 0]);
            const sy = @abs(insts[b + scale_base + 1]);
            const sz = @abs(insts[b + scale_base + 2]);
            if (sy > 1.0 or sx < 1.0 or sz < 1.0) continue;
            const dx = insts[b + 0] - wanted_x;
            const dz = insts[b + 2] - wanted_z;
            const d2 = dx * dx + dz * dz;
            if (d2 < best_dist2) {
                best_dist2 = d2;
                best_row = row;
            }
        }
    }
    if (best_row) |r| {
        const b = r * stride;
        return .{ .x = insts[b + 0], .y = instanceTop(insts, r, stride), .z = insts[b + 2] };
    }

    var y = bounds.cy;
    row = 0;
    var found_cover = false;
    while (row < total_rows) : (row += 1) {
        if (!instanceCovers(insts, row, stride, wanted_x, wanted_z)) continue;
        const top = instanceTop(insts, row, stride);
        if (!found_cover or top > y) {
            y = top;
            found_cover = true;
        }
    }
    if (!found_cover) y = 0;
    return .{ .x = wanted_x, .y = y, .z = wanted_z };
}

fn groundHeightAt(insts: []const f32, inst_count: u32, piece_count: u32, stride: usize, x: f32, z: f32) ?f32 {
    const total_rows: usize = @intCast(inst_count);
    var row: usize = @min(@as(usize, @intCast(piece_count)), total_rows);
    var best: ?f32 = null;
    while (row < total_rows) : (row += 1) {
        const b = row * stride;
        const scale_base: usize = if (stride >= 12) 6 else 3;
        if (@abs(insts[b + scale_base + 1]) > 0.75) continue;
        if (!instanceCovers(insts, row, stride, x, z)) continue;
        const top = instanceTop(insts, row, stride);
        if (best == null or top > best.?) best = top;
    }
    return best;
}

fn orbitEye(target: Vec3, yaw_degrees: f32, pitch_degrees: f32, distance: f32) Vec3 {
    const yaw = yaw_degrees * std.math.pi / 180.0;
    const elev = pitch_degrees * std.math.pi / 180.0;
    const horiz = distance * @cos(elev);
    const height = distance * @sin(elev);
    return .{
        .x = target.x - @sin(yaw) * horiz,
        .y = target.y + height,
        .z = target.z - @cos(yaw) * horiz,
    };
}

const CameraSolve = struct {
    pos: Vec3,
    target: Vec3,
    fov: f32,
};

const PitchLimits = struct {
    min: f32,
    max: f32,
};

fn solveAimCamera(player: PlayerState, yaw_degrees: f32, orbit_pitch_degrees: f32) CameraSolve {
    const yaw = yaw_degrees * std.math.pi / 180.0;
    const pitch = clamp(-orbit_pitch_degrees, AIM_MIN_PITCH_DEGREES, AIM_MAX_PITCH_DEGREES) * std.math.pi / 180.0;
    const cp = @cos(pitch);
    const fwd = Vec3{
        .x = @sin(yaw) * cp,
        .y = @sin(pitch),
        .z = @cos(yaw) * cp,
    };
    const pivot = Vec3{
        .x = player.x - @cos(yaw) * AIM_SHOULDER_SHIFT_METERS,
        .y = player.y + AIM_PIVOT_HEIGHT_METERS - 0 * AIM_CROUCH_DROP_METERS,
        .z = player.z + @sin(yaw) * AIM_SHOULDER_SHIFT_METERS,
    };
    return .{
        .pos = .{
            .x = pivot.x - fwd.x * AIM_DISTANCE_METERS,
            .y = pivot.y - fwd.y * AIM_DISTANCE_METERS,
            .z = pivot.z - fwd.z * AIM_DISTANCE_METERS,
        },
        .target = .{
            .x = pivot.x + fwd.x * AIM_LOOK_AHEAD_METERS,
            .y = pivot.y + fwd.y * AIM_LOOK_AHEAD_METERS,
            .z = pivot.z + fwd.z * AIM_LOOK_AHEAD_METERS,
        },
        .fov = AIM_FOV_DEGREES,
    };
}

fn desiredCamera(cam: CameraState, player: PlayerState) CameraSolve {
    if (cam.aiming) return solveAimCamera(player, cam.yaw_degrees, cam.pitch_degrees);
    const target = Vec3{ .x = player.x, .y = player.y + CAMERA_TARGET_HEIGHT_METERS, .z = player.z };
    return .{
        .pos = orbitEye(target, cam.yaw_degrees, cam.pitch_degrees, CAMERA_DISTANCE_METERS),
        .target = target,
        .fov = CAMERA_FOV_DEGREES,
    };
}

fn updateCameraNode(camera_node: *Node, cam: *CameraState, player: PlayerState, dt: f32) void {
    const want = desiredCamera(cam.*, player);
    if (!cam.initialized or dt <= 0 or CAMERA_SMOOTHING_PER_SECOND <= 0) {
        cam.current_pos = want.pos;
        cam.current_target = want.target;
        cam.current_fov = want.fov;
        cam.initialized = true;
    } else {
        const t = clamp(1.0 - @exp(-CAMERA_SMOOTHING_PER_SECOND * dt), 0, 1);
        cam.current_pos = lerpVec3(cam.current_pos, want.pos, t);
        cam.current_target = lerpVec3(cam.current_target, want.target, t);
        cam.current_fov = lerp(cam.current_fov, want.fov, t);
    }
    camera_node.scene3d_pos_x = cam.current_pos.x;
    camera_node.scene3d_pos_y = cam.current_pos.y;
    camera_node.scene3d_pos_z = cam.current_pos.z;
    camera_node.scene3d_look_x = cam.current_target.x;
    camera_node.scene3d_look_y = cam.current_target.y;
    camera_node.scene3d_look_z = cam.current_target.z;
    camera_node.scene3d_fov = cam.current_fov;
    camera_node.scene3d_far = cam.far;
}

fn aimPitchLimitsInOrbitSpace() PitchLimits {
    return .{ .min = -AIM_MAX_PITCH_DEGREES, .max = -AIM_MIN_PITCH_DEGREES };
}

fn setAimMode(cam: *CameraState, aiming: bool) void {
    if (cam.aiming == aiming) return;
    cam.aiming = aiming;
    if (!aiming) {
        cam.pitch_degrees = clamp(cam.pitch_degrees, CAMERA_MIN_PITCH_DEGREES, CAMERA_MAX_PITCH_DEGREES);
    }
}

fn findPlayerClip(animation: constructor.PlayerAnimationSet, clip_id: u32) ?constructor.PlayerAnimationClip {
    for (animation.clips) |clip| {
        if (clip.id == clip_id) return clip;
    }
    return null;
}

fn sampleClipTransform(clip: constructor.PlayerAnimationClip, node_index: usize, t_raw: f32) ?constructor.PlayerTransform {
    if (clip.keyframes.len == 0) return null;
    if (node_index >= clip.keyframes[0].transforms.len) return null;
    const duration = if (clip.duration > 0) clip.duration else 1.0;
    var t = t_raw;
    if (clip.looping) {
        t = @mod(t, duration);
        if (t < 0) t += duration;
    } else {
        t = clamp(t, 0, duration);
    }
    if (clip.keyframes.len == 1) return clip.keyframes[0].transforms[node_index];

    var prev = clip.keyframes[0];
    var next = clip.keyframes[clip.keyframes.len - 1];
    var i: usize = 1;
    while (i < clip.keyframes.len) : (i += 1) {
        if (t <= clip.keyframes[i].time) {
            next = clip.keyframes[i];
            break;
        }
        prev = clip.keyframes[i];
    }
    const span = @max(@as(f32, 0.000001), next.time - prev.time);
    const k = clamp((t - prev.time) / span, 0, 1);
    const a = prev.transforms[node_index];
    const b = next.transforms[node_index];
    return .{
        .position = .{ lerp(a.position[0], b.position[0], k), lerp(a.position[1], b.position[1], k), lerp(a.position[2], b.position[2], k) },
        .rotation = .{ lerp(a.rotation[0], b.rotation[0], k), lerp(a.rotation[1], b.rotation[1], k), lerp(a.rotation[2], b.rotation[2], k) },
        .scale = .{ lerp(a.scale[0], b.scale[0], k), lerp(a.scale[1], b.scale[1], k), lerp(a.scale[2], b.scale[2], k) },
    };
}

fn updatePlayerModelNodes(kids: []Node, first: usize, groups: []const constructor.PlayerModelGroup, animation: constructor.PlayerAnimationSet, player: PlayerState, moving: bool, running: bool, airborne: bool) void {
    const model_yaw_degrees = player.yaw * 180.0 / std.math.pi + 180.0;
    const clip_id: u32 = if (airborne) PLAYER_CLIP_JUMP else if (moving or running) PLAYER_CLIP_WALK else PLAYER_CLIP_IDLE;
    const clip_time: f32 = if (clip_id == PLAYER_CLIP_WALK) player.gait_phase else if (clip_id == PLAYER_CLIP_JUMP) player.jump_time else 0;
    const clip = if (animation.node_count == groups.len) findPlayerClip(animation, clip_id) else null;
    var i: usize = 0;
    while (i < groups.len) : (i += 1) {
        const base = groups[i];
        const base_transform = constructor.PlayerTransform{
            .position = base.position,
            .rotation = base.rotation,
            .scale = base.scale,
        };
        const t = if (clip) |cclip| sampleClipTransform(cclip, i, clip_time) orelse base_transform else base_transform;
        const local = rotateYLocal(t.position, model_yaw_degrees);
        const node = &kids[first + i];
        node.scene3d_pos_x = player.x + local.x;
        node.scene3d_pos_y = player.y + local.y;
        node.scene3d_pos_z = player.z + local.z;
        node.scene3d_rot_x = t.rotation[0];
        node.scene3d_rot_y = t.rotation[1] + model_yaw_degrees;
        node.scene3d_rot_z = t.rotation[2];
        node.scene3d_scale_x = t.scale[0];
        node.scene3d_scale_y = t.scale[1];
        node.scene3d_scale_z = t.scale[2];
    }
}

fn updatePlayerAnimationClock(player: *PlayerState, dt: f32, moving: bool, running: bool, airborne: bool) void {
    if (moving) {
        const cycles = if (running) PLAYER_RUN_CYCLES_PER_SECOND else PLAYER_WALK_CYCLES_PER_SECOND;
        player.gait_phase += dt * cycles;
        player.gait_phase = @mod(player.gait_phase, 1.0);
    }
    if (airborne) {
        player.jump_time += dt;
    } else {
        player.jump_time = 0;
    }
}

pub const Runtime = struct {
    allocator: std.mem.Allocator,
    node_id: u32 = 0,
    scene: constructor.Scene,
    fallback: ?[]f32 = null,
    insts: []const f32 = &.{},
    inst_count: u32 = 0,
    stride: usize = INSTANCE_STRIDE,
    piece_count: u32 = 0,
    physics_colliders: PhysicsColliders = undefined,
    has_physics_colliders: bool = false,
    cube: [36 * 8]f32 = undefined,
    ramp_slab: [36 * 8]f32 = undefined,
    shape_batches: ShapeBatches = undefined,
    has_shape_batches: bool = false,
    player_geom_keys: std.ArrayList([]u8) = .{},
    kid_list: std.ArrayList(Node) = .{},
    root: Node = .{},
    player_first_child: usize = 0,
    player: PlayerState = undefined,
    camera: CameraState = undefined,
    last_ns: i64 = 0,
    frame: u32 = 0,

    pub fn create(allocator: std.mem.Allocator, path: []const u8, store_dir: []const u8, node_id: u32) !*Runtime {
        const self = try allocator.create(Runtime);
        errdefer allocator.destroy(self);
        try self.initInPlace(allocator, path, store_dir, node_id);
        return self;
    }

    pub fn destroy(self: *Runtime) void {
        const allocator = self.allocator;
        self.deinit();
        allocator.destroy(self);
    }

    pub fn initInPlace(self: *Runtime, allocator: std.mem.Allocator, path: []const u8, store_dir: []const u8, node_id: u32) !void {
        const bytes = loadGameFile(allocator, path) catch |err| {
            log.print("[loader] failed to read game-file {s}: {any}\n", .{ path, err });
            return err;
        };
        defer allocator.free(bytes);

        var store = std.fs.cwd().makeOpenPath(store_dir, .{}) catch |err| {
            log.print("[loader] cannot open content store {s}: {any}\n", .{ store_dir, err });
            return err;
        };
        defer store.close();

        const scene = constructor.construct(allocator, bytes, store) catch |err| {
            log.print("[loader] construct FAILED: {any}\n", .{err});
            return err;
        };
        self.* = Runtime{
            .allocator = allocator,
            .node_id = node_id,
            .scene = scene,
        };
        errdefer self.deinit();
        log.print("[loader] constructed map {d}x{d} from {s} (no JS)\n", .{ self.scene.width, self.scene.height, path });
        try self.build();
    }

    pub fn deinit(self: *Runtime) void {
        for (self.player_geom_keys.items) |key| self.allocator.free(key);
        self.player_geom_keys.deinit(self.allocator);
        self.kid_list.deinit(self.allocator);
        if (self.has_shape_batches) self.shape_batches.deinit(self.allocator);
        if (self.has_physics_colliders) self.physics_colliders.deinit(self.allocator);
        if (self.fallback) |f| self.allocator.free(f);
        self.scene.deinit(self.allocator);
        self.* = undefined;
    }

    fn build(self: *Runtime) !void {
        self.insts = self.scene.instances;
        self.inst_count = self.scene.instance_count;
        self.stride = if (self.scene.instance_stride > 0) self.scene.instance_stride else INSTANCE_STRIDE;
        if (self.inst_count == 0 and !self.scene.has_instance_lump) {
            const f = extrudeTiles(self.allocator, self.scene) catch |err| {
                log.print("[loader] tile extrusion FAILED: {any}\n", .{err});
                return err;
            };
            self.fallback = f;
            self.insts = f;
            self.stride = INSTANCE_STRIDE;
            self.inst_count = @intCast(f.len / INSTANCE_STRIDE);
            log.print("[loader] no instance buffer — extruded {d} tile boxes\n", .{self.inst_count});
        }
        self.piece_count = self.scene.piece_count;
        log.print("[loader] built {d} mesh instances ({d} placed pieces)\n", .{ self.inst_count, self.piece_count });
        if (self.inst_count == 0) log.print("[loader] empty world — rendering sky/model over void\n", .{});

        self.physics_colliders = try buildPhysicsColliders(self.allocator, self.insts, self.inst_count, self.stride);
        self.has_physics_colliders = true;
        log.print("[loader] built {d} physics rects + {d} oriented physics rects + {d} heightfields\n", .{ self.physics_colliders.rect_count, self.physics_colliders.oriented_count, self.physics_colliders.heightfield_count });
        if (self.physics_colliders.clipped_rows > 0) {
            log.print("[loader] physics collider cap clipped {d} rendered instance rows\n", .{self.physics_colliders.clipped_rows});
        }

        const env = self.scene.env;
        const frame_count: u32 = if (self.piece_count > 0) self.piece_count else self.inst_count;
        const bounds = instanceBounds(self.insts, frame_count, self.stride);
        const horiz = bounds.radius * env.cam_horiz_factor + env.cam_horiz_base;
        const height = bounds.radius * env.cam_height_factor + env.cam_height_base;
        const far = (horiz + height + bounds.radius) * env.cam_far_factor;
        const authored_eye = Vec3{
            .x = bounds.cx + horiz * 0.72,
            .y = bounds.cy + height,
            .z = bounds.cz + horiz * 0.72,
        };
        const authored_dx = authored_eye.x - bounds.cx;
        const authored_dz = authored_eye.z - bounds.cz;
        const authored_yaw = std.math.atan2(authored_dx, authored_dz);
        const spawn = chooseSpawn(self.insts, self.inst_count, self.piece_count, self.stride, bounds);
        self.player = .{
            .x = spawn.x,
            .y = spawn.y,
            .z = spawn.z,
            .yaw = authored_yaw,
        };
        self.camera = .{
            .yaw_degrees = authored_yaw * 180.0 / std.math.pi,
            .pitch_degrees = CAMERA_INITIAL_PITCH_DEGREES,
            .far = @max(far, bounds.radius * 4.0 + 64.0),
        };
        self.cube = buildCube();
        self.ramp_slab = buildRampSlab();
        self.shape_batches = try buildShapeBatches(self.allocator, self.insts, self.inst_count, self.stride);
        self.has_shape_batches = true;

        try self.kid_list.append(self.allocator, .{
            .scene3d_camera = true,
            .scene3d_pos_x = 0,
            .scene3d_pos_y = 0,
            .scene3d_pos_z = 0,
            .scene3d_look_x = 0,
            .scene3d_look_y = 0,
            .scene3d_look_z = 0,
            .scene3d_fov = CAMERA_FOV_DEGREES,
            .scene3d_far = far,
        });
        try self.kid_list.append(self.allocator, .{
            .scene3d_skybox = true,
            .scene3d_sky_zenith = env.sky_zenith,
            .scene3d_sky_horizon = env.sky_horizon,
            .scene3d_sky_ground = env.sky_ground,
            .scene3d_sky_sun_dir = env.sky_sun_dir,
            .scene3d_sky_sun_color = env.sky_sun_color,
            .scene3d_sky_haze = env.sky_haze,
            .scene3d_sky_cloud = env.sky_cloud,
            .scene3d_sky_night = env.sky_night,
        });
        try self.kid_list.append(self.allocator, .{ .scene3d_light = true, .scene3d_light_type = "ambient", .scene3d_color_r = env.ambient_color[0], .scene3d_color_g = env.ambient_color[1], .scene3d_color_b = env.ambient_color[2], .scene3d_intensity = env.ambient_intensity });
        try self.kid_list.append(self.allocator, .{ .scene3d_light = true, .scene3d_light_type = "directional", .scene3d_dir_x = env.dir[0], .scene3d_dir_y = env.dir[1], .scene3d_dir_z = env.dir[2], .scene3d_color_r = env.dir_color[0], .scene3d_color_g = env.dir_color[1], .scene3d_color_b = env.dir_color[2], .scene3d_intensity = env.dir_intensity });

        self.player_first_child = self.kid_list.items.len;
        for (self.scene.player_model, 0..) |group, i| {
            const key = try std.fmt.allocPrint(self.allocator, "player-model-{d}", .{i});
            self.player_geom_keys.append(self.allocator, key) catch |err| {
                self.allocator.free(key);
                return err;
            };
            try self.kid_list.append(self.allocator, .{
                .scene3d_mesh = group.vertex_count > 0,
                .scene3d_geom_key = key,
                .scene3d_vertices = group.vertices,
                .scene3d_vert_count = group.vertex_count,
                .scene3d_color_r = group.color[0],
                .scene3d_color_g = group.color[1],
                .scene3d_color_b = group.color[2],
                .scene3d_color_a = group.alpha,
                .scene3d_tex_w = group.tex_w,
                .scene3d_tex_h = group.tex_h,
                .scene3d_tex_rgba = group.tex_rgba,
            });
        }
        if (self.scene.player_model.len == 0) log.print("[loader] no player model lump — camera target only\n", .{});
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = self.shape_batches.box_count > 0,
            .scene3d_geom_key = "box",
            .scene3d_vertices = self.cube[0..],
            .scene3d_vert_count = 36,
            .scene3d_instance_data = self.shape_batches.boxes,
            .scene3d_instance_count = self.shape_batches.box_count,
            .scene3d_instance_stride = @intCast(self.stride),
        });
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = self.shape_batches.ramp_count > 0,
            .scene3d_geom_key = "ramp-slab",
            .scene3d_vertices = self.ramp_slab[0..],
            .scene3d_vert_count = 36,
            .scene3d_instance_data = self.shape_batches.ramps,
            .scene3d_instance_count = self.shape_batches.ramp_count,
            .scene3d_instance_stride = @intCast(self.stride),
        });

        self.root = .{ .children = self.kid_list.items };
        updateCameraNode(&self.kid_list.items[0], &self.camera, self.player, 0);
        updatePlayerModelNodes(self.kid_list.items, self.player_first_child, self.scene.player_model, self.scene.player_animation, self.player, false, false, false);
        self.last_ns = nowNs();
    }

    fn pollStandaloneEvents(self: *Runtime, running: *bool) void {
        var event: c.SDL_Event = undefined;
        while (c.SDL_PollEvent(&event)) {
            switch (event.type) {
                c.SDL_EVENT_QUIT, c.SDL_EVENT_WINDOW_CLOSE_REQUESTED => running.* = false,
                c.SDL_EVENT_KEY_DOWN => {
                    if (event.key.key == c.SDLK_ESCAPE) running.* = false;
                },
                c.SDL_EVENT_MOUSE_BUTTON_DOWN => {
                    if (event.button.button == c.SDL_BUTTON_RIGHT) setAimMode(&self.camera, true);
                },
                c.SDL_EVENT_MOUSE_BUTTON_UP => {
                    if (event.button.button == c.SDL_BUTTON_RIGHT) setAimMode(&self.camera, false);
                },
                c.SDL_EVENT_MOUSE_MOTION => {
                    self.mouseLook(event.motion.xrel, event.motion.yrel);
                },
                else => {},
            }
        }
    }

    pub fn mouseLook(self: *Runtime, dx: f32, dy: f32) void {
        const pitch_limits: PitchLimits = if (self.camera.aiming) aimPitchLimitsInOrbitSpace() else .{ .min = CAMERA_MIN_PITCH_DEGREES, .max = CAMERA_MAX_PITCH_DEGREES };
        self.camera.yaw_degrees -= dx * CAMERA_YAW_DEGREES_PER_PIXEL;
        self.camera.pitch_degrees = clamp(
            self.camera.pitch_degrees - dy * CAMERA_PITCH_DEGREES_PER_PIXEL,
            pitch_limits.min,
            pitch_limits.max,
        );
    }

    pub fn setAiming(self: *Runtime, aiming: bool) void {
        setAimMode(&self.camera, aiming);
    }

    pub fn stepNow(self: *Runtime) void {
        const ns = nowNs();
        const dt = clamp(@as(f32, @floatFromInt(ns - self.last_ns)) / 1_000_000_000.0, 0.001, 0.05);
        self.last_ns = ns;

        var forward: f32 = 0;
        var strafe: f32 = 0;
        if (keyDown(SCAN_W)) forward += 1;
        if (keyDown(SCAN_S)) forward -= 1;
        if (keyDown(SCAN_A)) strafe -= 1;
        if (keyDown(SCAN_D)) strafe += 1;
        const intent = game_physics.movement.wasdDirection(forward, strafe, self.camera.yaw_degrees * std.math.pi / 180.0);
        const run_down = keyDown(SCAN_LSHIFT);
        const speed: f32 = if (run_down) PLAYER_RUN_SPEED_METERS_PER_SECOND else PLAYER_WALK_SPEED_METERS_PER_SECOND;
        runPlayerPhysics(&self.player, &self.physics_colliders, dt, intent, speed, keyDown(SCAN_SPACE));
        if (self.camera.aiming) self.player.yaw = self.camera.yaw_degrees * std.math.pi / 180.0;
        const moving = @sqrt(intent.x * intent.x + intent.z * intent.z) > 0.001;
        const airborne = !self.player.grounded or @abs(self.player.vy) > 0.05;
        updatePlayerAnimationClock(&self.player, dt, moving, run_down, airborne);

        updateCameraNode(&self.kid_list.items[0], &self.camera, self.player, dt);
        updatePlayerModelNodes(self.kid_list.items, self.player_first_child, self.scene.player_model, self.scene.player_animation, self.player, moving, run_down, airborne);
        self.frame += 1;
    }

    pub fn sceneNodeForFrame(self: *Runtime) *Node {
        self.stepNow();
        return &self.root;
    }

    pub fn statusAlloc(self: *const Runtime, allocator: std.mem.Allocator) ![]u8 {
        return std.fmt.allocPrint(
            allocator,
            "loaded {d} instances ({d} pieces), {d} player mesh groups",
            .{ self.inst_count, self.piece_count, self.scene.player_model.len },
        );
    }
};

const MountedLoader = struct {
    active: bool = false,
    runtime: ?*Runtime = null,
};

var g_mounted_loaders: [MAX_EMBEDDED_LOADERS]MountedLoader = [_]MountedLoader{.{}} ** MAX_EMBEDDED_LOADERS;

fn findMounted(node_id: u32) ?*MountedLoader {
    for (&g_mounted_loaders) |*entry| {
        const runtime = entry.runtime orelse continue;
        if (entry.active and runtime.node_id == node_id) return entry;
    }
    return null;
}

fn findVacantMounted() ?*MountedLoader {
    for (&g_mounted_loaders) |*entry| {
        if (!entry.active) return entry;
    }
    return null;
}

pub fn mount(allocator: std.mem.Allocator, node_id: u32, game_file: []const u8, store_dir: []const u8) !void {
    if (node_id == 0) return error.BadNodeId;
    unmount(node_id);
    const entry = findVacantMounted() orelse return error.TooManyWorldLoaders;
    entry.runtime = try Runtime.create(allocator, game_file, store_dir, node_id);
    entry.active = true;
}

pub fn unmount(node_id: u32) void {
    if (findMounted(node_id)) |entry| {
        if (entry.runtime) |runtime| runtime.destroy();
        entry.runtime = null;
        entry.active = false;
    }
}

fn runtimeForNode(allocator: std.mem.Allocator, node: *Node) !*Runtime {
    if (node.id == 0) return error.BadNodeId;
    if (findMounted(node.id)) |entry| {
        if (entry.runtime) |runtime| return runtime;
    }
    const game_file = node.world_loader_game_file orelse "zig-out/game/hmsc.gamefile";
    const store_dir = node.world_loader_store_dir orelse STORE_DIR;
    try mount(allocator, node.id, game_file, store_dir);
    const entry = findMounted(node.id) orelse return error.MountFailed;
    return entry.runtime orelse error.MountFailed;
}

pub fn renderEmbedded(allocator: std.mem.Allocator, node: *Node, x: f32, y: f32, w: f32, h: f32, opacity: f32) bool {
    const runtime = runtimeForNode(allocator, node) catch |err| {
        log.print("[loader] embedded mount/render failed for node {d}: {any}\n", .{ node.id, err });
        return false;
    };
    runtime.stepNow();
    return scene3d.render(&runtime.root, x, y, w, h, opacity);
}

pub fn mouseLook(node_id: u32, dx: f32, dy: f32) void {
    const entry = findMounted(node_id) orelse return;
    const runtime = entry.runtime orelse return;
    runtime.mouseLook(dx, dy);
}

pub fn setAiming(node_id: u32, aiming: bool) void {
    const entry = findMounted(node_id) orelse return;
    const runtime = entry.runtime orelse return;
    runtime.setAiming(aiming);
}

pub fn statusAlloc(allocator: std.mem.Allocator, node_id: u32) ![]u8 {
    const entry = findMounted(node_id) orelse return try allocator.dupe(u8, "unmounted");
    const runtime = entry.runtime orelse return try allocator.dupe(u8, "unmounted");
    return runtime.statusAlloc(allocator);
}

pub fn main() !void {
    const allocator = std.heap.c_allocator;

    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);
    var path: []const u8 = DEFAULT_FIXTURE;
    for (args[1..]) |a| {
        if (!std.mem.startsWith(u8, a, "--")) path = a;
    }

    var runtime: Runtime = undefined;
    runtime.initInPlace(allocator, path, STORE_DIR, 0) catch |err| return err;
    defer runtime.deinit();

    // ── render the constructed scene (stateless GPU substrate) ───────────
    if (!c.SDL_Init(c.SDL_INIT_VIDEO)) {
        log.print("[loader] SDL_Init failed\n", .{});
        return error.SDLInitFailed;
    }
    defer c.SDL_Quit();

    const headless = std.posix.getenv("ZIGOS_HEADLESS") != null;
    const flags: u64 = if (headless) c.SDL_WINDOW_HIDDEN else 0;
    const window = c.SDL_CreateWindow("world_loader", WIN_W, WIN_H, flags) orelse {
        log.print("[loader] SDL_CreateWindow failed\n", .{});
        return error.WindowFailed;
    };

    gpu.init(window) catch |err| {
        log.print("[loader] gpu.init failed: {any}\n", .{err});
        return err;
    };
    capture.init();

    const screenshotting = capture.isScreenshotMode();
    if (!screenshotting) log.print("[loader] live window — close it or press ESC to exit (WASD move, Shift run, Space jump, mouse look, RMB aim)\n", .{});
    if (!headless and !screenshotting) {
        _ = c.SDL_SetWindowRelativeMouseMode(window, true);
    }

    var running = true;
    while (running) {
        runtime.pollStandaloneEvents(&running);
        runtime.stepNow();
        _ = scene3d.render(&runtime.root, 0, 0, @floatFromInt(WIN_W), @floatFromInt(WIN_H), 1.0);
        gpu.frame(0.52, 0.62, 0.74); // sky-ish clear so the ground reads against it

        if (screenshotting) {
            if (capture.tick(null) or runtime.frame >= MAX_FRAMES) break; // captured → exit
        } else {
            c.SDL_Delay(16); // ~60fps cap so a static scene doesn't spin the CPU
        }
    }
    log.print("[loader] done after {d} frames\n", .{runtime.frame});
}
