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
//! lump): authored objects lower to keyed primitive instances. Boxes are the
//! common path; ramps, cylinders, and spheres carry semantic prop/build shapes
//! without reintroducing JS. 3D is the ONLY path — there is no 2D tile grid and
//! no flag to gate it.
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
const material_tex = @import("framework/gpu/material_tex.zig");
const layout = @import("framework/layout.zig");
const Node = layout.Node;
const constructor = @import("framework/world/constructor.zig");
const streaming = @import("framework/world/streaming.zig");
const game_physics = @import("framework/game/physics.zig");

// Resolution of each materialized shader's 1-tile texture (the shader's canvas
// is exactly one 1m tile; the face sampler REPEATS it across the surface).
const MATERIAL_TILE_PX: u32 = 256;

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
const SHAPE_CYLINDER8: f32 = 2;
const SHAPE_CYLINDER16: f32 = 3;
const SHAPE_SPHERE: f32 = 4;
const SCAN_A: usize = 4;
const SCAN_D: usize = 7;
const SCAN_S: usize = 22;
const SCAN_W: usize = 26;
const SCAN_SPACE: usize = 44;
const SCAN_LSHIFT: usize = 225;
// Spawn drops in from slightly above the resolved ground (req_0523): an exact
// or stale surface sample must settle ONTO the floor, never inside it.
const SPAWN_DROP_CLEARANCE_METERS: f32 = 0.35;
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
// Camera-collision spring-arm (parity with the editor's play-camera-occlusion
// tuning): when a wall/roof sits between the eye and the player-side pivot, pull
// the eye in to the wall's near side instead of clipping through it.
const CAMERA_SPRING_MIN_DISTANCE_METERS: f32 = 0.7;
const CAMERA_SPRING_SKIN_METERS: f32 = 0.14;
const CAMERA_SPRING_SWEEP_RADIUS_METERS: f32 = 0.08;
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
    // 256MB read cap. Real editor bakes are a few MB; the headroom is for the
    // procedural scale lab (`rjit game play --massive --blocks N`), where the
    // instance buffer alone can run to hundreds of MB — we want the test to probe
    // the GPU/physics limit, not an artificial I/O wall.
    const raw = try std.fs.cwd().readFileAlloc(allocator, path, 256 << 20);
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

fn spherePos(radius: f32, theta: f32, phi: f32) [3]f32 {
    const st = @sin(theta);
    return .{ radius * st * @cos(phi), radius * @cos(theta), radius * st * @sin(phi) };
}

fn sphereNormal(theta: f32, phi: f32) [3]f32 {
    const st = @sin(theta);
    return .{ st * @cos(phi), @cos(theta), st * @sin(phi) };
}

fn sphereUv(n: [3]f32) [2]f32 {
    return .{ (n[0] + 1.0) * 0.5, (1.0 - n[1]) * 0.5 };
}

fn buildUnitSphere(comptime segments: usize, comptime rings: usize) [segments * rings * 6 * 8]f32 {
    var out: [segments * rings * 6 * 8]f32 = undefined;
    var idx: usize = 0;
    var i: usize = 0;
    while (i < rings) : (i += 1) {
        const t1 = std.math.pi * @as(f32, @floatFromInt(i)) / @as(f32, @floatFromInt(rings));
        const t2 = std.math.pi * @as(f32, @floatFromInt(i + 1)) / @as(f32, @floatFromInt(rings));
        var j: usize = 0;
        while (j < segments) : (j += 1) {
            const p1 = 2.0 * std.math.pi * @as(f32, @floatFromInt(j)) / @as(f32, @floatFromInt(segments));
            const p2 = 2.0 * std.math.pi * @as(f32, @floatFromInt(j + 1)) / @as(f32, @floatFromInt(segments));
            const a = spherePos(0.5, t1, p1);
            const b = spherePos(0.5, t1, p2);
            const c0 = spherePos(0.5, t2, p2);
            const d = spherePos(0.5, t2, p1);
            const na = sphereNormal(t1, p1);
            const nb = sphereNormal(t1, p2);
            const nc = sphereNormal(t2, p2);
            const nd = sphereNormal(t2, p1);
            pushTri(out[0..], &idx, a, c0, d, na, sphereUv(na), sphereUv(nc), sphereUv(nd));
            pushTri(out[0..], &idx, a, b, c0, na, sphereUv(na), sphereUv(nb), sphereUv(nc));
        }
    }
    return out;
}

fn buildUnitCylinder(comptime segments: usize) [segments * 12 * 8]f32 {
    var out: [segments * 12 * 8]f32 = undefined;
    var idx: usize = 0;
    const radius: f32 = 0.5;
    const hy: f32 = 0.5;
    var j: usize = 0;
    while (j < segments) : (j += 1) {
        const a1 = 2.0 * std.math.pi * @as(f32, @floatFromInt(j)) / @as(f32, @floatFromInt(segments));
        const a2 = 2.0 * std.math.pi * @as(f32, @floatFromInt(j + 1)) / @as(f32, @floatFromInt(segments));
        const c1 = @cos(a1);
        const s1 = @sin(a1);
        const c2 = @cos(a2);
        const s2 = @sin(a2);
        const a = [3]f32{ radius * c1, -hy, radius * s1 };
        const b = [3]f32{ radius * c2, -hy, radius * s2 };
        const c0 = [3]f32{ radius * c2, hy, radius * s2 };
        const d = [3]f32{ radius * c1, hy, radius * s1 };
        const n1 = [3]f32{ c1, 0, s1 };
        const n2 = [3]f32{ c2, 0, s2 };
        pushTri(out[0..], &idx, a, d, c0, n1, .{ 0, 0 }, .{ 0, 1 }, .{ 1, 1 });
        pushTri(out[0..], &idx, a, c0, b, n2, .{ 0, 0 }, .{ 1, 1 }, .{ 1, 0 });
        pushTri(out[0..], &idx, .{ 0, hy, 0 }, c0, d, .{ 0, 1, 0 }, .{ 0.5, 0.5 }, .{ 1, 1 }, .{ 0, 1 });
        pushTri(out[0..], &idx, .{ 0, -hy, 0 }, a, b, .{ 0, -1, 0 }, .{ 0.5, 0.5 }, .{ 0, 0 }, .{ 1, 0 });
    }
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
    cylinder8s: []f32,
    cylinder8_count: u32,
    cylinder16s: []f32,
    cylinder16_count: u32,
    spheres: []f32,
    sphere_count: u32,

    pub fn deinit(self: ShapeBatches, allocator: std.mem.Allocator) void {
        allocator.free(self.boxes);
        allocator.free(self.ramps);
        allocator.free(self.cylinder8s);
        allocator.free(self.cylinder16s);
        allocator.free(self.spheres);
    }
};

// One textured draw: the instance rows that wear material slot N, plus the key
// the materialized shader is installed under (scene3d_tex_key). One instanced
// mesh node per batch — the flat (material-less) rows stay in ShapeBatches.
const MaterialBatch = struct {
    boxes: []f32,
    count: u32,
    key: []u8,
    translucent: bool,
    opacity: f32,

    pub fn deinit(self: MaterialBatch, allocator: std.mem.Allocator) void {
        allocator.free(self.boxes);
        allocator.free(self.key);
    }
};

// Rows referencing a material (material_refs[row] != 0) are drawn TEXTURED in
// their own per-material batch, so they're skipped here — the flat instanced
// batch is the material-less remainder. `material_refs` may be empty (no
// materials), in which case nothing is skipped.
fn buildShapeBatches(allocator: std.mem.Allocator, insts: []const f32, inst_count: u32, stride: usize, material_refs: []const u32) !ShapeBatches {
    var boxes: std.ArrayList(f32) = .{};
    errdefer boxes.deinit(allocator);
    var ramps: std.ArrayList(f32) = .{};
    errdefer ramps.deinit(allocator);
    var cylinder8s: std.ArrayList(f32) = .{};
    errdefer cylinder8s.deinit(allocator);
    var cylinder16s: std.ArrayList(f32) = .{};
    errdefer cylinder16s.deinit(allocator);
    var spheres: std.ArrayList(f32) = .{};
    errdefer spheres.deinit(allocator);
    var box_count: u32 = 0;
    var ramp_count: u32 = 0;
    var cylinder8_count: u32 = 0;
    var cylinder16_count: u32 = 0;
    var sphere_count: u32 = 0;
    var row: usize = 0;
    while (row < @as(usize, @intCast(inst_count))) : (row += 1) {
        if (row < material_refs.len and material_refs[row] != 0) continue; // textured batch
        const b = row * stride;
        const src = insts[b .. b + stride];
        const shape = instanceShapeId(insts, row, stride);
        if (@abs(shape - SHAPE_RAMP) < 0.5) {
            try ramps.appendSlice(allocator, src);
            ramp_count += 1;
        } else if (@abs(shape - SHAPE_CYLINDER8) < 0.5) {
            try cylinder8s.appendSlice(allocator, src);
            cylinder8_count += 1;
        } else if (@abs(shape - SHAPE_CYLINDER16) < 0.5) {
            try cylinder16s.appendSlice(allocator, src);
            cylinder16_count += 1;
        } else if (@abs(shape - SHAPE_SPHERE) < 0.5) {
            try spheres.appendSlice(allocator, src);
            sphere_count += 1;
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
        .cylinder8s = try cylinder8s.toOwnedSlice(allocator),
        .cylinder8_count = cylinder8_count,
        .cylinder16s = try cylinder16s.toOwnedSlice(allocator),
        .cylinder16_count = cylinder16_count,
        .spheres = try spheres.toOwnedSlice(allocator),
        .sphere_count = sphere_count,
    };
}

/// Force every row's tint to white: a SHADER material samples a texture, and the
/// row's color would multiply into it. Applied at the DRAW arrays' final home —
/// the monolithic batch, or the streaming world's sorted copy (after the LOD
/// shell has already accumulated the original colors). A TRANSLUCENT flat
/// material (glass) is never whitened — that tint IS the glass look.
fn whitenRows(rows: []f32, stride: usize) void {
    const color_off: usize = if (stride >= 12) 9 else 6;
    var b: usize = 0;
    while (b + stride <= rows.len) : (b += stride) {
        rows[b + color_off + 0] = 1;
        rows[b + color_off + 1] = 1;
        rows[b + color_off + 2] = 1;
    }
}

// Partition the material-referencing rows into one instanced batch per material
// slot (the shaders themselves are run later, at first render — gpu isn't ready
// at build time). Rows keep their authored fallback color here; the caller
// whitens whichever array actually draws (whitenRows above), so the streaming
// LOD shell can read the real colors first. Empty when the map has no materials.
fn buildMaterialBatches(allocator: std.mem.Allocator, insts: []const f32, inst_count: u32, stride: usize, materials: []const constructor.Material, material_refs: []const u32) ![]MaterialBatch {
    const mat_count = materials.len;
    if (mat_count == 0 or material_refs.len == 0) return try allocator.alloc(MaterialBatch, 0);
    var lists = try allocator.alloc(std.ArrayList(f32), mat_count);
    defer allocator.free(lists);
    for (lists) |*l| l.* = .{};
    defer for (lists) |*l| l.deinit(allocator);

    var row: usize = 0;
    while (row < @as(usize, @intCast(inst_count))) : (row += 1) {
        const ref = if (row < material_refs.len) material_refs[row] else 0;
        if (ref == 0 or ref > mat_count) continue;
        const b = row * stride;
        try lists[ref - 1].appendSlice(allocator, insts[b .. b + stride]);
    }

    var batches = try allocator.alloc(MaterialBatch, mat_count);
    var built: usize = 0;
    errdefer {
        for (batches[0..built]) |batch| batch.deinit(allocator);
        allocator.free(batches);
    }
    while (built < mat_count) : (built += 1) {
        const key = try std.fmt.allocPrint(allocator, "wmat-{d}", .{built});
        errdefer allocator.free(key);
        const count: u32 = @intCast(lists[built].items.len / stride);
        const boxes = try lists[built].toOwnedSlice(allocator);
        batches[built] = .{
            .boxes = boxes,
            .count = count,
            .key = key,
            .translucent = materials[built].wgsl.len == 0,
            .opacity = materials[built].opacity,
        };
    }
    return batches;
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

/// The 9 axis-aligned-rect collider floats for one instance row (shared by the
/// static build and the windowed rebuild).
fn rectFloats(insts: []const f32, row: usize, stride: usize, solid: bool) [game_physics.RECT_FLOATS]f32 {
    const scale_base: usize = if (stride >= 12) 6 else 3;
    const b = row * stride;
    const sx = @abs(insts[b + scale_base + 0]);
    const sy = @abs(insts[b + scale_base + 1]);
    const sz = @abs(insts[b + scale_base + 2]);
    const top = insts[b + 1] + sy * 0.5;
    const floor = if (solid) insts[b + 1] - sy * 0.5 else -1.0e9;
    return .{
        insts[b + 0] - sx * 0.5,
        insts[b + 2] - sz * 0.5,
        insts[b + 0] + sx * 0.5,
        insts[b + 2] + sz * 0.5,
        top,
        if (solid) 1 else 0,
        PLAYER_SURFACE_FRICTION,
        PLAYER_SURFACE_RESTITUTION,
        floor,
    };
}

/// The 12 oriented-rect collider floats for one (yawed) instance row.
fn orientedFloats(insts: []const f32, row: usize, stride: usize, solid: bool) [game_physics.ORIENTED_FLOATS]f32 {
    const r = rectFloats(insts, row, stride, solid);
    return .{
        r[0],                    r[1],                    r[2],                                   r[3], r[4], r[5], r[6], r[7], r[8],
        insts[row * stride + 0], insts[row * stride + 2], instanceYawRadians(insts, row, stride),
    };
}

fn appendPhysicsRect(allocator: std.mem.Allocator, list: *std.ArrayList(f32), insts: []const f32, row: usize, stride: usize, solid: bool) !void {
    try list.appendSlice(allocator, &rectFloats(insts, row, stride, solid));
}

fn appendPhysicsOrientedRect(allocator: std.mem.Allocator, list: *std.ArrayList(f32), insts: []const f32, row: usize, stride: usize, solid: bool) !void {
    try list.appendSlice(allocator, &orientedFloats(insts, row, stride, solid));
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

fn registerSceneHeightfield(field: constructor.HeightfieldMesh, slot: usize) bool {
    const count = @as(usize, field.cols) * @as(usize, field.rows);
    if (count == 0 or count > game_physics.HF_MAX_SAMPLES) return false;
    const sample_bytes = std.mem.sliceAsBytes(field.heights[0..count]);
    return game_physics.registerHeightfield(.{
        .id = slot,
        .origin_x = field.center_x - field.width * 0.5,
        .origin_z = field.center_z - field.depth * 0.5,
        .cell = field.cell,
        .cols = field.cols,
        .rows = field.rows,
        .base_y = field.base_y,
        .walk_cos = field.walk_cos,
    }, sample_bytes);
}

/// Register a baked ramp/stair slope (placedPieceRamps) as a host heightfield
/// collider — the authored slope the editor walks up, not an instance guess.
fn registerColliderField(field: constructor.ColliderField, slot: usize) bool {
    const count = @as(usize, field.cols) * @as(usize, field.rows);
    if (count == 0 or count > game_physics.HF_MAX_SAMPLES) return false;
    const sample_bytes = std.mem.sliceAsBytes(field.heights[0..count]);
    return game_physics.registerHeightfield(.{
        .id = slot,
        .origin_x = field.origin_x,
        .origin_z = field.origin_z,
        .cell = field.cell,
        .cols = field.cols,
        .rows = field.rows,
        .base_y = field.base_y,
        .walk_cos = field.walk_cos,
        .yaw = field.yaw,
        .pivot_x = field.pivot_x,
        .pivot_z = field.pivot_z,
    }, sample_bytes);
}

fn maxAbsHeight(heights: []const f32) f32 {
    var max_abs: f32 = 0;
    for (heights) |height| max_abs = @max(max_abs, @abs(height));
    return max_abs;
}

fn buildPhysicsColliders(allocator: std.mem.Allocator, scene: constructor.Scene, insts: []const f32, inst_count: u32, stride: usize) !PhysicsColliders {
    var rects: std.ArrayList(f32) = .{};
    errdefer rects.deinit(allocator);
    var oriented: std.ArrayList(f32) = .{};
    errdefer oriented.deinit(allocator);
    var rect_count: usize = 0;
    var oriented_count: usize = 0;
    var heightfield_count: usize = 0;
    var clipped_rows: usize = 0;

    game_physics.clearHeightfields();
    for (scene.heightfields) |field| {
        if (heightfield_count < game_physics.MAX_HEIGHTFIELDS and registerSceneHeightfield(field, heightfield_count)) {
            heightfield_count += 1;
        } else {
            clipped_rows += 1;
        }
    }

    // AUTHORED colliders present → step against THEM (the editor's +-join-aware
    // wall / floor / ramp solids), not a guess re-derived from the render boxes.
    // The painted-floor heightfields above already collide; here we add the
    // baked ramp slopes and hand the rects/oriented straight to the step (they
    // are already packed in host wire order). Absent → fall through to the
    // instance-derived path below (pre-lump bakes).
    if (scene.baked_colliders) |bc| {
        for (bc.ramps) |ramp| {
            if (heightfield_count < game_physics.MAX_HEIGHTFIELDS and registerColliderField(ramp, heightfield_count)) {
                heightfield_count += 1;
            } else {
                clipped_rows += 1;
            }
        }
        // The baked solids ARE the authored PIECES (walls/floors/pillars) — copy
        // them in host wire order. Clamp to the host caps (step @min-clamps the
        // counts; copying past the cap would slide the oriented slice into rect
        // data). A normal authored map is far under the caps.
        const kept_rects = @min(@as(usize, bc.rect_count), game_physics.MAX_RECTS);
        const kept_oriented = @min(@as(usize, bc.oriented_count), game_physics.MAX_ORIENTED);
        clipped_rows += (@as(usize, bc.rect_count) - kept_rects) + (@as(usize, bc.oriented_count) - kept_oriented);
        try rects.appendSlice(allocator, bc.rects[0 .. kept_rects * game_physics.RECT_FLOATS]);
        rect_count = kept_rects;

        try oriented.appendSlice(allocator, bc.oriented[0 .. kept_oriented * game_physics.ORIENTED_FLOATS]);
        oriented_count = kept_oriented;

        // We DON'T derive any colliders from the render instances here — exactly
        // like /test, the pieces collide ONLY through the baked colliders above
        // and the painted ground through the heightfields. This matters: a piece
        // floor's BAKED rect is banded (floor = piece.y, so you walk UNDER a
        // raised floor), whereas an instance-derived walkable rect is solid to the
        // ground (floor = −∞) and, being too tall to step onto, side-pushes the
        // player below it — an invisible wall under upper floors. Letting the
        // banded baked collider own the floor is what keeps it standable from
        // above AND passable from below. (Heightfields above handle the ground;
        // baked rects/oriented handle every authored piece.)

        const values = try allocator.alloc(f32, game_physics.INPUT_HEADER_FLOATS + rects.items.len + oriented.items.len);
        @memset(values, 0);
        @memcpy(values[game_physics.INPUT_HEADER_FLOATS .. game_physics.INPUT_HEADER_FLOATS + rects.items.len], rects.items);
        @memcpy(values[game_physics.INPUT_HEADER_FLOATS + rects.items.len ..], oriented.items);
        rects.deinit(allocator);
        oriented.deinit(allocator);
        return .{
            .values = values,
            .rect_count = rect_count,
            .oriented_count = oriented_count,
            .heightfield_count = heightfield_count,
            .clipped_rows = clipped_rows,
        };
    }

    // Two passes so WALKABLE FLOORS win the collider cap over solid walls. A
    // huge world (the --massive scale lab) has far more instances than MAX_RECTS;
    // if buildings (which lead the buffer) fill the cap first, the ground gets
    // clipped and the player falls through the world. Registering floors first
    // guarantees the ground you stand on always collides — at worst, distant
    // walls become walk-through, never the floor. For real bakes (< MAX_RECTS
    // instances) this is a no-op: everything fits regardless of order.
    const total_rows: usize = @intCast(inst_count);
    var pass: usize = 0;
    while (pass < 2) : (pass += 1) {
        const want_solid = pass == 1;
        var row: usize = 0;
        while (row < total_rows) : (row += 1) {
            if (isRampInstance(insts, row, stride)) {
                if (want_solid) continue; // ramps are heightfields — registered in the floor pass
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
            if (solid != want_solid) continue; // floors in pass 0, walls in pass 1
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
    }

    var values = try allocator.alloc(f32, game_physics.INPUT_HEADER_FLOATS + rects.items.len + oriented.items.len);
    @memset(values, 0);
    @memcpy(values[game_physics.INPUT_HEADER_FLOATS .. game_physics.INPUT_HEADER_FLOATS + rects.items.len], rects.items);
    @memcpy(values[game_physics.INPUT_HEADER_FLOATS + rects.items.len ..], oriented.items);
    rects.deinit(allocator);
    oriented.deinit(allocator);
    return .{ .values = values, .rect_count = rect_count, .oriented_count = oriented_count, .heightfield_count = heightfield_count, .clipped_rows = clipped_rows };
}

// ── spatial collider windowing (huge maps) ─────────────────────────────────
// When the full collider set overflows MAX_RECTS (a --massive city), collide only
// the instances NEAR the player, rebuilt as they move, so the whole world is solid
// in the near field. Local instances bucket into a uniform grid; world-spanning
// instances (the ground slab, the long road strips) bucket by center into ONE cell,
// so they are pulled into an ALWAYS list every rebuild includes — that keeps the
// floor under the player everywhere, not just near the world origin.
const COLLIDER_CELL_METERS: f32 = 64.0;
const COLLIDER_WINDOW_CELLS: i32 = 3; // gather ±3 cells around the player (7×7 ≈ 448m)

fn clampCell(v: i32, n: i32) i32 {
    return @max(0, @min(n - 1, v));
}

const SpatialGrid = struct {
    cell: f32,
    min_x: f32,
    min_z: f32,
    cols: i32,
    rows: i32,
    starts: []u32, // CSR offsets, len cols*rows+1
    items: []u32, // local row indices, bucketed by cell
    always: []u32, // world-spanning rows, included in every rebuild

    fn deinit(self: SpatialGrid, allocator: std.mem.Allocator) void {
        allocator.free(self.starts);
        allocator.free(self.items);
        allocator.free(self.always);
    }

    fn cellXZ(self: SpatialGrid, x: f32, z: f32) struct { cx: i32, cz: i32 } {
        const cx = clampCell(@as(i32, @intFromFloat(@floor((x - self.min_x) / self.cell))), self.cols);
        const cz = clampCell(@as(i32, @intFromFloat(@floor((z - self.min_z) / self.cell))), self.rows);
        return .{ .cx = cx, .cz = cz };
    }
};

fn instIsSpanning(insts: []const f32, row: usize, stride: usize, cell: f32) bool {
    const scale_base: usize = if (stride >= 12) 6 else 3;
    const b = row * stride;
    return @abs(insts[b + scale_base + 0]) > cell or @abs(insts[b + scale_base + 2]) > cell;
}

fn gridCellIndex(insts: []const f32, row: usize, stride: usize, min_x: f32, min_z: f32, cell: f32, cols: i32, rows: i32) usize {
    const b = row * stride;
    const cx = clampCell(@as(i32, @intFromFloat(@floor((insts[b + 0] - min_x) / cell))), cols);
    const cz = clampCell(@as(i32, @intFromFloat(@floor((insts[b + 2] - min_z) / cell))), rows);
    return @intCast(cz * cols + cx);
}

/// Bucket every instance into a uniform grid (local rows) + an always list
/// (world-spanning rows). One O(n) classify/count pass, a prefix sum, one scatter.
fn buildSpatialGrid(allocator: std.mem.Allocator, insts: []const f32, inst_count: u32, stride: usize) !SpatialGrid {
    const cell = COLLIDER_CELL_METERS;
    var min_x: f32 = std.math.floatMax(f32);
    var min_z: f32 = std.math.floatMax(f32);
    var max_x: f32 = -std.math.floatMax(f32);
    var max_z: f32 = -std.math.floatMax(f32);
    var i: usize = 0;
    while (i < inst_count) : (i += 1) {
        const b = i * stride;
        min_x = @min(min_x, insts[b + 0]);
        max_x = @max(max_x, insts[b + 0]);
        min_z = @min(min_z, insts[b + 2]);
        max_z = @max(max_z, insts[b + 2]);
    }
    const cols = @max(1, @as(i32, @intFromFloat(@floor((max_x - min_x) / cell))) + 1);
    const rows = @max(1, @as(i32, @intFromFloat(@floor((max_z - min_z) / cell))) + 1);
    const ncells: usize = @intCast(@as(i64, cols) * @as(i64, rows));

    var starts = try allocator.alloc(u32, ncells + 1);
    errdefer allocator.free(starts);
    @memset(starts, 0);

    var local_count: usize = 0;
    var always_count: usize = 0;
    i = 0;
    while (i < inst_count) : (i += 1) {
        if (instIsSpanning(insts, i, stride, cell)) {
            always_count += 1;
        } else {
            starts[gridCellIndex(insts, i, stride, min_x, min_z, cell, cols, rows) + 1] += 1;
            local_count += 1;
        }
    }
    var s: usize = 0;
    while (s < ncells) : (s += 1) starts[s + 1] += starts[s];

    var items = try allocator.alloc(u32, local_count);
    errdefer allocator.free(items);
    var always = try allocator.alloc(u32, always_count);
    errdefer allocator.free(always);
    var cursor = try allocator.alloc(u32, ncells);
    defer allocator.free(cursor);
    @memcpy(cursor, starts[0..ncells]);

    var ai: usize = 0;
    i = 0;
    while (i < inst_count) : (i += 1) {
        if (instIsSpanning(insts, i, stride, cell)) {
            always[ai] = @intCast(i);
            ai += 1;
        } else {
            const cidx = gridCellIndex(insts, i, stride, min_x, min_z, cell, cols, rows);
            items[cursor[cidx]] = @intCast(i);
            cursor[cidx] += 1;
        }
    }
    return .{ .cell = cell, .min_x = min_x, .min_z = min_z, .cols = cols, .rows = rows, .starts = starts, .items = items, .always = always };
}

fn runPlayerPhysics(player: *PlayerState, colliders: *PhysicsColliders, dt: f32, intent: game_physics.movement.Direction, speed: f32, jump_down: bool, cfg: ?constructor.PhysicsConfig) void {
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
    // Slots 11–23 are the player tuning. With a baked PHYSICS_CONFIG lump they
    // come from the editor's own config (so the shipped game feels identical);
    // without it they fall back to the loader's built-in constants.
    input[11] = if (cfg) |cf| cf.walkable_side_push_grace else WALKABLE_SIDE_PUSH_GRACE_METERS;
    input[12] = 0;
    input[13] = @floatFromInt(colliders.rect_count);
    input[14] = if (cfg) |cf| cf.gravity else PLAYER_GRAVITY_METERS_PER_SECOND2;
    input[15] = if (cfg) |cf| cf.jump_speed else PLAYER_JUMP_SPEED_METERS_PER_SECOND;
    input[16] = if (cfg) |cf| cf.player_radius else PLAYER_RADIUS_METERS;
    input[17] = if (cfg) |cf| cf.player_height else PLAYER_HEIGHT_METERS;
    input[18] = if (cfg) |cf| cf.wall_restitution else PLAYER_WALL_RESTITUTION;
    input[19] = if (cfg) |cf| cf.body_restitution else 0;
    input[20] = if (cfg) |cf| cf.step_height else PLAYER_STEP_HEIGHT_METERS;
    input[21] = if (cfg) |cf| cf.accel_mult else PLAYER_ACCELERATION_MULTIPLIER;
    input[22] = if (cfg) |cf| cf.surface_friction else PLAYER_SURFACE_FRICTION;
    input[23] = if (cfg) |cf| cf.surface_restitution else PLAYER_SURFACE_RESTITUTION;
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

/// The painted-terrain surface at (x, z): the highest heightfield sample under
/// the point, or null when no field covers it. Nearest-sample is enough here —
/// the spawn adds a drop clearance and settles through physics.
fn sceneTerrainTopAt(fields: []const constructor.HeightfieldMesh, x: f32, z: f32) ?f32 {
    var best: ?f32 = null;
    for (fields) |field| {
        if (field.cols == 0 or field.rows == 0 or field.cell <= 0) continue;
        const origin_x = field.center_x - field.width * 0.5;
        const origin_z = field.center_z - field.depth * 0.5;
        if (x < origin_x or z < origin_z or x > origin_x + field.width or z > origin_z + field.depth) continue;
        const max_col: f32 = @floatFromInt(field.cols - 1);
        const max_row: f32 = @floatFromInt(field.rows - 1);
        const col: usize = @intFromFloat(@round(std.math.clamp((x - origin_x) / field.cell, 0, max_col)));
        const row: usize = @intFromFloat(@round(std.math.clamp((z - origin_z) / field.cell, 0, max_row)));
        const idx = row * @as(usize, field.cols) + col;
        if (idx >= field.heights.len) continue;
        const top = field.base_y + field.heights[idx];
        if (best == null or top > best.?) best = top;
    }
    return best;
}

fn chooseSpawn(insts: []const f32, inst_count: u32, piece_count: u32, stride: usize, bounds: Bounds) Vec3 {
    // Spawn at the CITY, not the geometric centre of every road stripe on the
    // map (req_0526): when authored pieces exist, their bbox centre is where
    // the user's content is — the all-instance centre landed on a bare road
    // line hundreds of meters from anything built.
    var wanted_x = bounds.cx;
    var wanted_z = bounds.cz;
    if (piece_count > 0) {
        var min_px: f32 = std.math.floatMax(f32);
        var max_px: f32 = -std.math.floatMax(f32);
        var min_pz: f32 = std.math.floatMax(f32);
        var max_pz: f32 = -std.math.floatMax(f32);
        var pr: usize = 0;
        const pieces_end: usize = @min(@as(usize, @intCast(piece_count)), @as(usize, @intCast(inst_count)));
        while (pr < pieces_end) : (pr += 1) {
            const pb = pr * stride;
            min_px = @min(min_px, insts[pb + 0]);
            max_px = @max(max_px, insts[pb + 0]);
            min_pz = @min(min_pz, insts[pb + 2]);
            max_pz = @max(max_pz, insts[pb + 2]);
        }
        if (min_px <= max_px) {
            wanted_x = (min_px + max_px) * 0.5;
            wanted_z = (min_pz + max_pz) * 0.5;
        }
    }
    var best_row: ?usize = null;
    var best_dist2: f32 = std.math.floatMax(f32);
    const total_rows: usize = @intCast(inst_count);
    // ALL rows, pieces included (req_0526): this map's only non-piece flat rows
    // are 1m road stripes — the real standable floors ARE the authored piece
    // plates. Spawning on the city's own floor beats a stripe in the void.
    var row: usize = 0;
    while (row < total_rows) : (row += 1) {
        const b = row * stride;
        const scale_base: usize = if (stride >= 12) 6 else 3;
        const sx = @abs(insts[b + scale_base + 0]);
        const sy = @abs(insts[b + scale_base + 1]);
        const sz = @abs(insts[b + scale_base + 2]);
        if (sy > 0.75) continue;
        // A REAL floor, not a paint stripe (req_0526): the nearest flat row to
        // the centre was a 61×1m road line — a body can't reliably stand on a
        // 1m-wide strip, and there may be no other ground around it at all.
        if (sx < 2.0 or sz < 2.0) continue;
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
    /// The player-side anchor the eye sits back from — the spring-arm casts
    /// pivot→pos against the walls and pulls the eye in to the wall's near side.
    pivot: Vec3,
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
        .pivot = pivot,
    };
}

fn desiredCamera(cam: CameraState, player: PlayerState) CameraSolve {
    if (cam.aiming) return solveAimCamera(player, cam.yaw_degrees, cam.pitch_degrees);
    const target = Vec3{ .x = player.x, .y = player.y + CAMERA_TARGET_HEIGHT_METERS, .z = player.z };
    return .{
        .pos = orbitEye(target, cam.yaw_degrees, cam.pitch_degrees, CAMERA_DISTANCE_METERS),
        .target = target,
        .fov = CAMERA_FOV_DEGREES,
        .pivot = target,
    };
}

/// Pull the desired eye in to the near side of any wall/roof between it and the
/// pivot (the compiled-game spring-arm — parity with the editor's JS one).
fn springArmEye(want: CameraSolve, maybe_colliders: ?PhysicsColliders) Vec3 {
    const dxp = want.pos.x - want.pivot.x;
    const dyp = want.pos.y - want.pivot.y;
    const dzp = want.pos.z - want.pivot.z;
    const base = @sqrt(dxp * dxp + dyp * dyp + dzp * dzp);
    if (base <= 0.0001) return want.pos;
    // The eye must clear BOTH the wall/roof boxes AND the terrain/ramp
    // heightfields (a separate collider type) — take the most restrictive cap.
    var cap: f32 = -1;
    if (maybe_colliders) |colliders| {
        if (colliders.rect_count != 0 or colliders.oriented_count != 0) {
            const wall = game_physics.cameraOcclusionStepColliders(
                colliders.values,
                colliders.rect_count,
                colliders.oriented_count,
                want.pos.x,
                want.pos.y,
                want.pos.z,
                want.pivot.x,
                want.pivot.y,
                want.pivot.z,
                CAMERA_SPRING_SWEEP_RADIUS_METERS,
            );
            if (wall > 0) cap = wall;
        }
    }
    const terrain = game_physics.cameraOcclusionHeightfields(
        want.pos.x,
        want.pos.y,
        want.pos.z,
        want.pivot.x,
        want.pivot.y,
        want.pivot.z,
        CAMERA_SPRING_SWEEP_RADIUS_METERS,
    );
    if (terrain > 0 and (cap < 0 or terrain < cap)) cap = terrain;
    if (cap < 0) return want.pos;
    const safe = clamp(cap - CAMERA_SPRING_SKIN_METERS, CAMERA_SPRING_MIN_DISTANCE_METERS, base);
    const k = safe / base;
    return .{
        .x = want.pivot.x + dxp * k,
        .y = want.pivot.y + dyp * k,
        .z = want.pivot.z + dzp * k,
    };
}

fn updateCameraNode(camera_node: *Node, cam: *CameraState, player: PlayerState, colliders: ?PhysicsColliders, dt: f32) void {
    var want = desiredCamera(cam.*, player);
    want.pos = springArmEye(want, colliders);
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

// ── world content streaming (req_0524, V30 applied to the render plane) ─────
// The GTA 3/VC/SA-era residency model: full-detail geometry streams in around
// the player by RADIUS (promotion instant, demotion hysteretic), draws are
// culled by sight (frustum now; the Compile-precomputed VIS lump shares the
// seam), and a derived LOD shell keeps the whole skyline visible for cheap.
// Draw distance (camera far + fog) is unchanged — this governs what is drawn
// at full detail, not how far the camera sees. framework/world/streaming.zig
// owns the partition/LOD/draw-set logic; here we feed it the draw batches and
// turn its ranges into sub-range static draws (scene3d_instance_first).
const STREAM_CELL_METERS: f32 = 64.0; // same granularity as the collider grid
const STREAM_DETAIL_RADIUS_METERS: f32 = 240.0;

const StreamMode = enum { off, auto, force };

fn streamModeFromEnv() StreamMode {
    const s = std.posix.getenv("RJIT_STREAM") orelse return .auto;
    if (s.len == 0) return .auto;
    if (std.mem.eql(u8, s, "0") or std.ascii.eqlIgnoreCase(s, "off")) return .off;
    return .force;
}

fn streamRadiusFromEnv() f32 {
    const s = std.posix.getenv("RJIT_STREAM_RADIUS") orelse return STREAM_DETAIL_RADIUS_METERS;
    const v = std.fmt.parseFloat(f32, s) catch return STREAM_DETAIL_RADIUS_METERS;
    return clamp(v, 64.0, 4096.0);
}

/// What a streamed family draws as: the shared geometry + texture every range
/// node of that family carries. Indexes align with streaming.World.families.
const StreamProto = struct {
    geom_key: []const u8,
    verts: []const f32,
    tex_key: ?[]const u8,
};

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
    // The CAMERA spring-arm always steps against the FULL baked authored wall/roof
    // colliders, never the per-frame windowed/instance-derived physics set. On a
    // huge map (spatial windowing ON) the physics set is re-derived from render
    // instances and capped (MAX_ORIENTED=256), which silently DROPS yawed building
    // walls near the player — the camera then buries inside a building it can't see.
    // Keeping a dedicated unclamped baked buffer for the camera means "see myself
    // against the building" works at any world scale (req_0407/0420). Null on a
    // pre-lump bake (no baked_colliders) — the camera falls back to physics_colliders.
    camera_colliders: ?PhysicsColliders = null,
    // Spatial collider windowing: enabled only when the full collider set overflows
    // MAX_RECTS (a huge --massive map), so normal maps keep their static full set.
    windowed: bool = false,
    grid: ?SpatialGrid = null,
    cube: [36 * 8]f32 = undefined,
    ramp_slab: [36 * 8]f32 = undefined,
    cylinder8: [8 * 12 * 8]f32 = undefined,
    cylinder16: [16 * 12 * 8]f32 = undefined,
    sphere: [12 * 8 * 6 * 8]f32 = undefined,
    shape_batches: ShapeBatches = undefined,
    has_shape_batches: bool = false,
    // Per-material textured batches (geometry built at construct; the shaders are
    // run into textures lazily by ensureMaterials at first render, once gpu is up).
    material_batches: []MaterialBatch = &.{},
    materials_ready: bool = false,
    player_geom_keys: std.ArrayList([]u8) = .{},
    kid_list: std.ArrayList(Node) = .{},
    root: Node = .{},
    player_first_child: usize = 0,
    player: PlayerState = undefined,
    camera: CameraState = undefined,
    last_ns: i64 = 0,
    frame: u32 = 0,
    // Content streaming (engaged when the world outgrows the detail radius):
    // per-frame draw-node tail rebuilt from the streaming world's ranges.
    stream: ?streaming.World = null,
    stream_protos: std.ArrayList(StreamProto) = .{},
    stream_radius: f32 = STREAM_DETAIL_RADIUS_METERS,
    stream_tail_start: usize = 0,
    stream_draw_count: usize = 0,
    stream_logged: bool = false,
    stream_drop_warned: bool = false,
    last_aspect: f32 = @as(f32, WIN_W) / @as(f32, WIN_H),

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

    /// Run each face material's SHADER into its texture and install it under the
    /// batch key (idempotent; needs gpu up, so it runs at first render not build).
    /// A material that fails to materialize leaves its faces on the fallback color.
    fn ensureMaterials(self: *Runtime) void {
        if (self.materials_ready) return;
        self.materials_ready = true;
        for (self.scene.materials, 0..) |m, i| {
            // Translucent flat materials (glass: empty wgsl) have no shader to run —
            // they render through the transparent pass with the row's own color.
            // Feeding "" to the shader pipeline would crash wgpu, so skip them.
            if (m.wgsl.len == 0) continue;
            var buf: [32]u8 = undefined;
            const key = std.fmt.bufPrint(&buf, "wmat-{d}", .{i}) catch continue;
            if (!material_tex.materialize(key, m.wgsl, m.data, MATERIAL_TILE_PX))
                log.print("[loader] material {d} not materialized — faces show fallback color\n", .{i});
        }
    }

    pub fn deinit(self: *Runtime) void {
        for (self.player_geom_keys.items) |key| self.allocator.free(key);
        self.player_geom_keys.deinit(self.allocator);
        if (self.material_batches.len > 0) {
            for (self.material_batches) |batch| batch.deinit(self.allocator);
            self.allocator.free(self.material_batches);
        }
        self.kid_list.deinit(self.allocator);
        if (self.stream) |*w| w.deinit(self.allocator);
        self.stream_protos.deinit(self.allocator);
        if (self.has_shape_batches) self.shape_batches.deinit(self.allocator);
        if (self.has_physics_colliders) self.physics_colliders.deinit(self.allocator);
        if (self.camera_colliders) |cam_cols| cam_cols.deinit(self.allocator);
        if (self.grid) |g| g.deinit(self.allocator);
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

        self.physics_colliders = try buildPhysicsColliders(self.allocator, self.scene, self.insts, self.inst_count, self.stride);
        self.has_physics_colliders = true;
        log.print("[loader] built {d} physics rects + {d} oriented physics rects + {d} heightfields\n", .{ self.physics_colliders.rect_count, self.physics_colliders.oriented_count, self.physics_colliders.heightfield_count });
        if (self.physics_colliders.clipped_rows > 0) {
            log.print("[loader] physics collider cap clipped {d} rendered instance rows\n", .{self.physics_colliders.clipped_rows});
        }
        // The camera's own collider set: the FULL baked authored rects/oriented,
        // unclamped, packed in cameraOcclusionStepColliders wire order. Built once
        // and queried every frame by springArmEye regardless of physics windowing,
        // so a yawed building wall the windowed physics set drops is still seen by
        // the spring-arm and the eye is pushed to the player's side of it.
        if (self.scene.baked_colliders) |bc| {
            const rect_floats = bc.rects.len;
            const oriented_floats = bc.oriented.len;
            if (self.allocator.alloc(f32, game_physics.INPUT_HEADER_FLOATS + rect_floats + oriented_floats)) |buf| {
                @memset(buf, 0);
                @memcpy(buf[game_physics.INPUT_HEADER_FLOATS .. game_physics.INPUT_HEADER_FLOATS + rect_floats], bc.rects);
                @memcpy(buf[game_physics.INPUT_HEADER_FLOATS + rect_floats ..], bc.oriented);
                self.camera_colliders = .{
                    .values = buf,
                    .rect_count = @intCast(bc.rect_count),
                    .oriented_count = @intCast(bc.oriented_count),
                    .heightfield_count = 0,
                    .clipped_rows = 0,
                };
                log.print("[loader] camera spring-arm collider set: {d} baked rects + {d} oriented (full, unclamped)\n", .{ bc.rect_count, bc.oriented_count });
            } else |_| {}
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
        var spawn = chooseSpawn(self.insts, self.inst_count, self.piece_count, self.stride, bounds);
        // Painted terrain is HEIGHTFIELDS, not instance rows — chooseSpawn's
        // flat-box top can sit UNDER a painted hill, burying the player below
        // the surface where no collider can catch a body (req_0523: "falling
        // thru the world when trying to just load it"). Clamp the spawn to the
        // terrain surface, then drop in from a small clearance so an imprecise
        // sample still settles ONTO the ground instead of inside it.
        const terrain_top = sceneTerrainTopAt(self.scene.heightfields, spawn.x, spawn.z);
        if (terrain_top) |top| {
            if (top > spawn.y) spawn.y = top;
        }
        spawn.y += SPAWN_DROP_CLEARANCE_METERS;
        log.print("[loader] spawn x={d:.2} y={d:.2} z={d:.2} (terrain={d:.2} fields={d})\n", .{
            spawn.x, spawn.y, spawn.z, terrain_top orelse -999, self.scene.heightfields.len,
        });
        self.player = .{
            .x = spawn.x,
            .y = spawn.y,
            .z = spawn.z,
            .yaw = authored_yaw,
        };
        {
            // probe: every instance row whose footprint covers the spawn column
            var row: usize = 0;
            const total: usize = @intCast(self.inst_count);
            while (row < total) : (row += 1) {
                if (!instanceCovers(self.insts, row, self.stride, spawn.x, spawn.z)) continue;
                const sb: usize = if (self.stride >= 12) 6 else 3;
                const b = row * self.stride;
                log.print("[loader] spawn-col row={d} piece={} pos=({d:.1},{d:.2},{d:.1}) scale=({d:.1},{d:.2},{d:.1}) yaw={d:.2}\n", .{
                    row,                                              row < @as(usize, @intCast(self.piece_count)),
                    self.insts[b + 0],                                self.insts[b + 1],
                    self.insts[b + 2],                                self.insts[b + sb + 0],
                    self.insts[b + sb + 1],                           self.insts[b + sb + 2],
                    instanceYawRadians(self.insts, row, self.stride),
                });
            }
        }
        // The static collider set overflowed MAX_RECTS (a huge --massive map): switch
        // to SPATIAL WINDOWING so collision follows the player and the whole world is
        // solid in the near field. Build the grid, widen the physics input buffer to
        // MAX capacity for in-place per-frame refills, and seed the window at spawn.
        if (self.physics_colliders.clipped_rows > 0) {
            if (buildSpatialGrid(self.allocator, self.insts, self.inst_count, self.stride)) |g| {
                const cap = game_physics.INPUT_HEADER_FLOATS + game_physics.MAX_RECTS * game_physics.RECT_FLOATS + game_physics.MAX_ORIENTED * game_physics.ORIENTED_FLOATS;
                if (self.allocator.alloc(f32, cap)) |buf| {
                    @memset(buf, 0);
                    self.allocator.free(self.physics_colliders.values);
                    self.physics_colliders.values = buf;
                    self.grid = g;
                    self.windowed = true;
                    self.rebuildWindow(spawn.x, spawn.z);
                    log.print("[loader] spatial collider windowing ON — {d} spanning + grid {d}x{d}; near-field {d} rects + {d} oriented\n", .{ g.always.len, g.cols, g.rows, self.physics_colliders.rect_count, self.physics_colliders.oriented_count });
                } else |_| {
                    g.deinit(self.allocator);
                }
            } else |_| {}
        }
        self.camera = .{
            .yaw_degrees = authored_yaw * 180.0 / std.math.pi,
            .pitch_degrees = CAMERA_INITIAL_PITCH_DEGREES,
            .far = @max(far, bounds.radius * 4.0 + 64.0),
        };
        self.cube = buildCube();
        self.ramp_slab = buildRampSlab();
        self.cylinder8 = buildUnitCylinder(8);
        self.cylinder16 = buildUnitCylinder(16);
        self.sphere = buildUnitSphere(12, 8);
        self.shape_batches = try buildShapeBatches(self.allocator, self.insts, self.inst_count, self.stride, self.scene.material_refs);
        self.has_shape_batches = true;
        // The textured remainder: rows wearing a material, partitioned per slot.
        // The shaders run at first render (gpu isn't up yet); the nodes carry the
        // material key now so scene3d samples it once it's materialized.
        self.material_batches = try buildMaterialBatches(self.allocator, self.insts, self.inst_count, self.stride, self.scene.materials, self.scene.material_refs);

        // ── content streaming gate (req_0524) ── engage when the world's extent
        // outgrows the detail radius (auto), or RJIT_STREAM=1 forces it; tiny
        // maps keep the exact monolithic path. RJIT_STREAM=0 kills it. Setup
        // failure leaves stream null and the monolithic path takes over.
        self.stream_radius = streamRadiusFromEnv();
        const full_bounds = instanceBounds(self.insts, self.inst_count, self.stride);
        const want_stream = switch (streamModeFromEnv()) {
            .off => false,
            .force => self.inst_count > 0,
            .auto => full_bounds.radius > self.stream_radius,
        };
        if (want_stream) self.setupStreaming() catch |err| {
            log.print("[loader] streaming setup FAILED ({any}) — monolithic draws\n", .{err});
        };
        // Whichever array DRAWS a shader material must wear white (the sampled
        // texture would multiply with the row tint): the streaming world's
        // sorted copies, or the monolithic batch arrays. The streaming LOD
        // shell accumulated the REAL colors before this — distant buildings
        // keep their look. Translucent (glass) batches always keep their tint.
        if (self.stream) |*w| {
            for (self.stream_protos.items, 0..) |proto, fi| {
                if (proto.tex_key != null) whitenRows(w.families[fi].rows, w.families[fi].stride);
            }
        } else {
            for (self.material_batches) |batch| {
                if (!batch.translucent) whitenRows(batch.boxes, self.stride);
            }
        }

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
        for (self.scene.heightfields, 0..) |field, i| {
            const key = try std.fmt.allocPrint(self.allocator, "~hf~loader-floor-{d}~1", .{i});
            self.player_geom_keys.append(self.allocator, key) catch |err| {
                self.allocator.free(key);
                return err;
            };
            const max_abs_y = maxAbsHeight(field.heights);
            const bounds_radius = @sqrt(field.width * field.width * 0.25 + field.depth * field.depth * 0.25 + max_abs_y * max_abs_y);
            try self.kid_list.append(self.allocator, .{
                .scene3d_mesh = true,
                .scene3d_geom_key = key,
                .scene3d_heights = field.heights,
                .scene3d_hf_cols = field.cols,
                .scene3d_hf_rows = field.rows,
                .scene3d_hf_width = field.width,
                .scene3d_hf_depth = field.depth,
                .scene3d_hf_base = 0,
                .scene3d_bounds_radius = bounds_radius,
                .scene3d_pos_x = field.center_x,
                .scene3d_pos_y = field.base_y,
                .scene3d_pos_z = field.center_z,
                .scene3d_color_r = if (field.tex_rgba != null) 1 else field.color[0],
                .scene3d_color_g = if (field.tex_rgba != null) 1 else field.color[1],
                .scene3d_color_b = if (field.tex_rgba != null) 1 else field.color[2],
                .scene3d_tex_w = field.tex_w,
                .scene3d_tex_h = field.tex_h,
                .scene3d_tex_rgba = field.tex_rgba,
            });
        }
        if (self.scene.heightfields.len > 0) {
            const first = self.scene.heightfields[0];
            log.print("[loader] built {d} terrain heightfield mesh(es); first grid {d}x{d} at ({d:.2},{d:.2}) span {d:.2}x{d:.2}\n", .{ self.scene.heightfields.len, first.cols, first.rows, first.center_x, first.center_z, first.width, first.depth });
        }
        // The world batches are STATIC (built once at construct, never mutated) —
        // flag them so the host uploads each ONCE and redraws from the retained
        // instance buffer with no per-frame restage/upload. This is what makes a
        // 776k-instance city render flat-out: the world is data, the camera moves.
        // STREAMING replaces these two monolithic draws (and the instanced
        // material batches below) with per-chunk sub-range draws of the same
        // one-time upload, rebuilt each frame by refreshStreamNodes.
        if (self.stream == null) {
            try self.kid_list.append(self.allocator, .{
                .scene3d_mesh = self.shape_batches.box_count > 0,
                .scene3d_geom_key = "box",
                .scene3d_vertices = self.cube[0..],
                .scene3d_vert_count = 36,
                .scene3d_instance_data = self.shape_batches.boxes,
                .scene3d_instance_count = self.shape_batches.box_count,
                .scene3d_instance_stride = @intCast(self.stride),
                .scene3d_instance_static = true,
            });
            try self.kid_list.append(self.allocator, .{
                .scene3d_mesh = self.shape_batches.ramp_count > 0,
                .scene3d_geom_key = "ramp-slab",
                .scene3d_vertices = self.ramp_slab[0..],
                .scene3d_vert_count = 36,
                .scene3d_instance_data = self.shape_batches.ramps,
                .scene3d_instance_count = self.shape_batches.ramp_count,
                .scene3d_instance_stride = @intCast(self.stride),
                .scene3d_instance_static = true,
            });
            try self.kid_list.append(self.allocator, .{
                .scene3d_mesh = self.shape_batches.cylinder8_count > 0,
                .scene3d_geom_key = "cylinder8",
                .scene3d_vertices = self.cylinder8[0..],
                .scene3d_vert_count = 8 * 12,
                .scene3d_instance_data = self.shape_batches.cylinder8s,
                .scene3d_instance_count = self.shape_batches.cylinder8_count,
                .scene3d_instance_stride = @intCast(self.stride),
                .scene3d_instance_static = true,
            });
            try self.kid_list.append(self.allocator, .{
                .scene3d_mesh = self.shape_batches.cylinder16_count > 0,
                .scene3d_geom_key = "cylinder16",
                .scene3d_vertices = self.cylinder16[0..],
                .scene3d_vert_count = 16 * 12,
                .scene3d_instance_data = self.shape_batches.cylinder16s,
                .scene3d_instance_count = self.shape_batches.cylinder16_count,
                .scene3d_instance_stride = @intCast(self.stride),
                .scene3d_instance_static = true,
            });
            try self.kid_list.append(self.allocator, .{
                .scene3d_mesh = self.shape_batches.sphere_count > 0,
                .scene3d_geom_key = "sphere12x8",
                .scene3d_vertices = self.sphere[0..],
                .scene3d_vert_count = 12 * 8 * 6,
                .scene3d_instance_data = self.shape_batches.spheres,
                .scene3d_instance_count = self.shape_batches.sphere_count,
                .scene3d_instance_stride = @intCast(self.stride),
                .scene3d_instance_static = true,
            });
        }

        // Per material: a SHADER material draws as one TEXTURED instanced box batch
        // (sampling the materialized shader via scene3d_tex_key, resolved once
        // ensureMaterials runs). A TRANSLUCENT flat material (glass) has no texture
        // and can't go through the opaque instanced pass — emit each of its rows as
        // an individual see-through mesh (scene3d_color_a) so the transparent pass
        // (single meshes, sorted far→near) draws it; those stay OUT of streaming
        // (sparse, already distance-culled). Both share the interned "box".
        var translucent_meshes: u32 = 0;
        for (self.material_batches) |batch| {
            if (batch.translucent) {
                var r: usize = 0;
                while (r < batch.count) : (r += 1) {
                    const o = @as(usize, r) * self.stride;
                    try self.kid_list.append(self.allocator, .{
                        .scene3d_mesh = true,
                        .scene3d_geom_key = "box",
                        .scene3d_vertices = self.cube[0..],
                        .scene3d_vert_count = 36,
                        .scene3d_pos_x = batch.boxes[o + 0],
                        .scene3d_pos_y = batch.boxes[o + 1],
                        .scene3d_pos_z = batch.boxes[o + 2],
                        .scene3d_rot_y = batch.boxes[o + 4],
                        .scene3d_scale_x = batch.boxes[o + 6],
                        .scene3d_scale_y = batch.boxes[o + 7],
                        .scene3d_scale_z = batch.boxes[o + 8],
                        .scene3d_color_r = batch.boxes[o + 9],
                        .scene3d_color_g = batch.boxes[o + 10],
                        .scene3d_color_b = batch.boxes[o + 11],
                        .scene3d_color_a = batch.opacity,
                    });
                    translucent_meshes += 1;
                }
                continue;
            }
            if (self.stream != null) continue; // streamed: drawn as per-chunk ranges
            try self.kid_list.append(self.allocator, .{
                .scene3d_mesh = batch.count > 0,
                .scene3d_geom_key = "box",
                .scene3d_vertices = self.cube[0..],
                .scene3d_vert_count = 36,
                .scene3d_instance_data = batch.boxes,
                .scene3d_instance_count = batch.count,
                .scene3d_instance_stride = @intCast(self.stride),
                .scene3d_instance_static = true,
                .scene3d_tex_key = batch.key,
            });
        }
        if (self.scene.materials.len > 0) log.print("[loader] {d} face material(s) → {d} batch(es), {d} translucent meshes\n", .{ self.scene.materials.len, self.material_batches.len, translucent_meshes });

        // The streamed draw tail begins after every static-prefix node above;
        // refreshStreamNodes truncates back to here each frame. Capacity is
        // reserved once so the per-frame rebuild never allocates.
        if (self.stream) |*w| {
            self.stream_tail_start = self.kid_list.items.len;
            try self.kid_list.ensureUnusedCapacity(self.allocator, w.draws.len);
        }

        self.root = .{ .children = self.kid_list.items };
        updateCameraNode(&self.kid_list.items[0], &self.camera, self.player, self.cameraColliderSet(), 0);
        updatePlayerModelNodes(self.kid_list.items, self.player_first_child, self.scene.player_model, self.scene.player_animation, self.player, false, false, false);
        // Seed the bubble at spawn and assemble the first draw tail — the very
        // first rendered frame already streams (the camera was just solved).
        self.refreshStreamNodes();
        self.last_ns = nowNs();
    }

    /// Feed the draw batches through the streaming partitioner
    /// (framework/world/streaming.zig). On success the monolithic world nodes
    /// are not emitted; refreshStreamNodes rebuilds the draw tail every frame.
    /// Leaves self.stream null (and says so) when the world isn't worth
    /// chunking; any failure falls back to monolithic draws.
    fn setupStreaming(self: *Runtime) !void {
        var fams: std.ArrayList(streaming.FamilyRows) = .{};
        defer fams.deinit(self.allocator);
        errdefer self.stream_protos.clearAndFree(self.allocator);

        try fams.append(self.allocator, .{ .rows = self.shape_batches.boxes, .stride = @intCast(self.stride) });
        try self.stream_protos.append(self.allocator, .{ .geom_key = "box", .verts = self.cube[0..], .tex_key = null });
        try fams.append(self.allocator, .{ .rows = self.shape_batches.ramps, .stride = @intCast(self.stride) });
        try self.stream_protos.append(self.allocator, .{ .geom_key = "ramp-slab", .verts = self.ramp_slab[0..], .tex_key = null });
        try fams.append(self.allocator, .{ .rows = self.shape_batches.cylinder8s, .stride = @intCast(self.stride) });
        try self.stream_protos.append(self.allocator, .{ .geom_key = "cylinder8", .verts = self.cylinder8[0..], .tex_key = null });
        try fams.append(self.allocator, .{ .rows = self.shape_batches.cylinder16s, .stride = @intCast(self.stride) });
        try self.stream_protos.append(self.allocator, .{ .geom_key = "cylinder16", .verts = self.cylinder16[0..], .tex_key = null });
        try fams.append(self.allocator, .{ .rows = self.shape_batches.spheres, .stride = @intCast(self.stride) });
        try self.stream_protos.append(self.allocator, .{ .geom_key = "sphere12x8", .verts = self.sphere[0..], .tex_key = null });
        for (self.material_batches) |batch| {
            if (batch.translucent or batch.count == 0) continue;
            try fams.append(self.allocator, .{ .rows = batch.boxes, .stride = @intCast(self.stride) });
            try self.stream_protos.append(self.allocator, .{ .geom_key = "box", .verts = self.cube[0..], .tex_key = batch.key });
        }
        var total_rows: u64 = 0;
        for (fams.items) |fam| total_rows += fam.rows.len / fam.stride;
        // The LOD shell shares the retained static buffer with the detail rows —
        // budget it from what's left so the upload can never overflow.
        const lod_budget: u32 = if (total_rows < scene3d.MAX_STATIC_INSTANCES)
            @intCast(scene3d.MAX_STATIC_INSTANCES - total_rows)
        else
            0;

        var world = try streaming.build(self.allocator, fams.items, STREAM_CELL_METERS, lod_budget);
        const s = world.stats;
        if (s.occupied_chunks < 4) {
            // A world this small sits inside the detail bubble whole — one
            // monolithic draw is strictly better.
            world.deinit(self.allocator);
            self.stream_protos.clearAndFree(self.allocator);
            log.print("[loader] streaming skipped — only {d} occupied chunk(s)\n", .{s.occupied_chunks});
            return;
        }
        self.stream = world;
        log.print("[loader] streaming ON — grid {d}x{d} ({d} occupied chunks), {d} local + {d} spanning rows, lod shell {d} rows (≥{d:.0}m verbatim), detail radius {d:.0}m (cell {d:.0}m)\n", .{
            world.cols, world.rows, s.occupied_chunks, s.local_rows, s.spanning_rows, s.lod_rows, s.lod_min_height, self.stream_radius, world.cell,
        });
        if (s.lod_truncated_chunks > 0) {
            log.print("[loader] streaming LOD budget clipped {d} chunk(s) — far field thins there\n", .{s.lod_truncated_chunks});
        }
    }

    /// Rebuild the per-frame draw tail: detail ranges for the resident bubble
    /// around the player, LOD-shell ranges for the visible rest of the city.
    /// Allocation-free (capacity reserved at build; the streaming world merges
    /// and caps its draw list).
    fn refreshStreamNodes(self: *Runtime) void {
        const w = if (self.stream) |*world| world else return;
        w.updateResidency(self.player.x, self.player.z, self.stream_radius);
        const draws = w.assembleDraws(.{
            .pos = .{ self.camera.current_pos.x, self.camera.current_pos.y, self.camera.current_pos.z },
            .look = .{ self.camera.current_target.x, self.camera.current_target.y, self.camera.current_target.z },
            .fov_degrees = self.camera.current_fov,
            .aspect = self.last_aspect,
            .far = self.camera.far,
        });
        self.kid_list.shrinkRetainingCapacity(self.stream_tail_start);
        for (draws) |d| {
            if (d.range.count == 0) continue;
            const fam = if (d.lod) &w.lod else &w.families[d.family];
            const proto: StreamProto = if (d.lod)
                .{ .geom_key = "box", .verts = self.cube[0..], .tex_key = null }
            else
                self.stream_protos.items[d.family];
            self.kid_list.appendAssumeCapacity(.{
                .scene3d_mesh = true,
                .scene3d_geom_key = proto.geom_key,
                .scene3d_vertices = proto.verts,
                .scene3d_vert_count = 36,
                .scene3d_instance_data = fam.rows,
                .scene3d_instance_count = d.range.count,
                .scene3d_instance_first = d.range.first,
                .scene3d_instance_stride = fam.stride,
                .scene3d_instance_static = true,
                .scene3d_tex_key = proto.tex_key,
            });
        }
        self.stream_draw_count = self.kid_list.items.len - self.stream_tail_start;
        self.root.children = self.kid_list.items;
        if (w.dropped_draws > 0 and !self.stream_drop_warned) {
            self.stream_drop_warned = true;
            log.print("[loader] streaming draw cap hit — {d} range(s) dropped this frame (far field thins; raise MAX_DRAWS if persistent)\n", .{w.dropped_draws});
        }
        if (!self.stream_logged) {
            self.stream_logged = true;
            var detail_rows: u64 = 0;
            var lod_rows: u64 = 0;
            for (draws) |d| {
                if (d.lod) lod_rows += d.range.count else detail_rows += d.range.count;
            }
            log.print("[loader] streaming first frame — {d} draws: {d} detail + {d} lod shell instances (of {d} total rows)\n", .{
                self.stream_draw_count, detail_rows, lod_rows, w.stats.local_rows + w.stats.spanning_rows,
            });
        }
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

    /// Emit one instance row's collider into the windowed physics input (floors-first
    /// over two passes: want_solid=false then true). Mirrors buildPhysicsColliders'
    /// per-row decision, but writes straight into the preallocated input buffer.
    fn emitRowCollider(self: *Runtime, row: usize, want_solid: bool, values: []f32, oriented_tmp: []f32, rc: *usize, oc: *usize, hf: *usize, clipped: *usize) void {
        if (isRampInstance(self.insts, row, self.stride)) {
            if (want_solid) return; // ramps are heightfields — registered in the floor pass
            if (hf.* < game_physics.MAX_HEIGHTFIELDS and registerRampHeightfield(self.insts, row, self.stride, hf.*)) hf.* += 1 else clipped.* += 1;
            return;
        }
        const scale_base: usize = if (self.stride >= 12) 6 else 3;
        const b = row * self.stride;
        const sx = @abs(self.insts[b + scale_base + 0]);
        const sy = @abs(self.insts[b + scale_base + 1]);
        const sz = @abs(self.insts[b + scale_base + 2]);
        if (sx <= 0.001 or sy <= 0.001 or sz <= 0.001) return;
        const solid = sy > PHYSICS_SOLID_HEIGHT_METERS;
        if (solid != want_solid) return;
        if (@abs(instanceYawRadians(self.insts, row, self.stride)) > 0.0001) {
            if (oc.* >= game_physics.MAX_ORIENTED) {
                clipped.* += 1;
                return;
            }
            const of = orientedFloats(self.insts, row, self.stride, solid);
            @memcpy(oriented_tmp[oc.* * game_physics.ORIENTED_FLOATS ..][0..game_physics.ORIENTED_FLOATS], &of);
            oc.* += 1;
        } else {
            if (rc.* >= game_physics.MAX_RECTS) {
                clipped.* += 1;
                return;
            }
            const rf = rectFloats(self.insts, row, self.stride, solid);
            @memcpy(values[game_physics.INPUT_HEADER_FLOATS + rc.* * game_physics.RECT_FLOATS ..][0..game_physics.RECT_FLOATS], &rf);
            rc.* += 1;
        }
    }

    /// One square shell of window cells at Chebyshev distance `ring` from the
    /// player's cell — the unit of the nearest-first cap policy (req_0526).
    fn emitWindowRing(self: *Runtime, grid: *const SpatialGrid, pcx: i32, pcz: i32, ring: i32, want_solid: bool, values: []f32, oriented_tmp: []f32, rc: *usize, oc: *usize, hf: *usize, clipped: *usize) void {
        var czi = pcz - ring;
        while (czi <= pcz + ring) : (czi += 1) {
            if (czi < 0 or czi >= grid.rows) continue;
            var cxi = pcx - ring;
            while (cxi <= pcx + ring) : (cxi += 1) {
                if (cxi < 0 or cxi >= grid.cols) continue;
                if (@max(@abs(cxi - pcx), @abs(czi - pcz)) != ring) continue; // shell only — inner rings already emitted
                const cellv: usize = @intCast(czi * grid.cols + cxi);
                var k = grid.starts[cellv];
                while (k < grid.starts[cellv + 1]) : (k += 1) {
                    self.emitRowCollider(grid.items[k], want_solid, values, oriented_tmp, rc, oc, hf, clipped);
                }
            }
        }
    }

    /// Rebuild the player's near-field collider set from the spatial grid: the
    /// always list (world-spanning floors/walls) plus every local instance in the
    /// window of cells around (center_x, center_z). Floors-first so the ground always
    /// wins the cap. Refills the preallocated physics input in place — no allocation.
    fn rebuildWindow(self: *Runtime, center_x: f32, center_z: f32) void {
        const grid = self.grid orelse return;
        const values = self.physics_colliders.values;
        const need = game_physics.INPUT_HEADER_FLOATS + game_physics.MAX_RECTS * game_physics.RECT_FLOATS + game_physics.MAX_ORIENTED * game_physics.ORIENTED_FLOATS;
        if (values.len < need) return;
        var oriented_tmp: [game_physics.MAX_ORIENTED * game_physics.ORIENTED_FLOATS]f32 = undefined;
        var rc: usize = 0;
        var oc: usize = 0;
        var hf: usize = 0;
        var clipped: usize = 0;

        game_physics.clearHeightfields();
        for (self.scene.heightfields) |field| {
            if (hf < game_physics.MAX_HEIGHTFIELDS and registerSceneHeightfield(field, hf)) hf += 1 else clipped += 1;
        }

        const pc = grid.cellXZ(center_x, center_z);

        var pass: usize = 0;
        while (pass < 2) : (pass += 1) {
            const want_solid = pass == 1;
            // NEAREST GEOMETRY WINS THE CAP (req_0526): the window over a dense
            // city holds MORE floors than MAX_RECTS, and the old raw lo→hi scan
            // let far cells fill the cap before the cell the player STANDS IN —
            // zero floor under their feet, a guaranteed fall through the world.
            // Emission order per pass: rings 0–1 (the ground underfoot), then
            // the spanning list (world-sized slabs/roads — the base ground),
            // then the outer rings. The cap now drops only the FAR field.
            self.emitWindowRing(&grid, pc.cx, pc.cz, 0, want_solid, values, oriented_tmp[0..], &rc, &oc, &hf, &clipped);
            self.emitWindowRing(&grid, pc.cx, pc.cz, 1, want_solid, values, oriented_tmp[0..], &rc, &oc, &hf, &clipped);
            for (grid.always) |row| self.emitRowCollider(row, want_solid, values, oriented_tmp[0..], &rc, &oc, &hf, &clipped);
            var ring: i32 = 2;
            while (ring <= COLLIDER_WINDOW_CELLS) : (ring += 1) {
                self.emitWindowRing(&grid, pc.cx, pc.cz, ring, want_solid, values, oriented_tmp[0..], &rc, &oc, &hf, &clipped);
            }
        }
        // oriented rects sit right after the actual rects in the physics input layout.
        const oriented_base = game_physics.INPUT_HEADER_FLOATS + rc * game_physics.RECT_FLOATS;
        @memcpy(values[oriented_base .. oriented_base + oc * game_physics.ORIENTED_FLOATS], oriented_tmp[0 .. oc * game_physics.ORIENTED_FLOATS]);
        self.physics_colliders.rect_count = rc;
        self.physics_colliders.oriented_count = oc;
        self.physics_colliders.heightfield_count = hf;
        self.physics_colliders.clipped_rows = clipped;
    }

    /// The collider set the camera spring-arm steps against: the FULL baked
    /// authored walls when we have them (so the eye is pushed out of every
    /// authored building regardless of the per-frame physics windowing), else
    /// the live physics set (pre-lump bakes have no baked colliders).
    fn cameraColliderSet(self: *const Runtime) ?PhysicsColliders {
        if (self.camera_colliders) |cam_cols| return cam_cols;
        if (self.has_physics_colliders) return self.physics_colliders;
        return null;
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
        // Locomotion speed from the baked PHYSICS_CONFIG (the editor's walk/run),
        // falling back to the loader's built-in constants for pre-lump bakes.
        const cfg = self.scene.physics_config;
        const walk_speed = if (cfg) |cf| cf.walk_speed else PLAYER_WALK_SPEED_METERS_PER_SECOND;
        const run_speed = if (cfg) |cf| cf.run_speed else PLAYER_RUN_SPEED_METERS_PER_SECOND;
        const speed: f32 = if (run_down) run_speed else walk_speed;
        // Refresh the near-field collider window around the player (huge maps only).
        // Cheap — it touches only the spanning list + the cells around the player.
        if (self.windowed) self.rebuildWindow(self.player.x, self.player.z);
        runPlayerPhysics(&self.player, &self.physics_colliders, dt, intent, speed, keyDown(SCAN_SPACE), cfg);
        if (self.camera.aiming) self.player.yaw = self.camera.yaw_degrees * std.math.pi / 180.0;
        const moving = @sqrt(intent.x * intent.x + intent.z * intent.z) > 0.001;
        const airborne = !self.player.grounded or @abs(self.player.vy) > 0.05;
        updatePlayerAnimationClock(&self.player, dt, moving, run_down, airborne);

        updateCameraNode(&self.kid_list.items[0], &self.camera, self.player, self.cameraColliderSet(), dt);
        updatePlayerModelNodes(self.kid_list.items, self.player_first_child, self.scene.player_model, self.scene.player_animation, self.player, moving, run_down, airborne);
        // Re-stream the world around wherever the player ended up this step
        // (uses the camera solved just above for sight culling).
        self.refreshStreamNodes();
        self.frame += 1;
    }

    pub fn sceneNodeForFrame(self: *Runtime) *Node {
        self.stepNow();
        return &self.root;
    }

    pub fn statusAlloc(self: *const Runtime, allocator: std.mem.Allocator) ![]u8 {
        if (self.stream) |*w| {
            return std.fmt.allocPrint(
                allocator,
                "loaded {d} instances ({d} pieces), {d} player mesh groups; streaming {d}x{d} grid ({d} occupied), lod {d} rows, {d} draws",
                .{ self.inst_count, self.piece_count, self.scene.player_model.len, w.cols, w.rows, w.stats.occupied_chunks, w.stats.lod_rows, self.stream_draw_count },
            );
        }
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
    runtime.last_aspect = w / @max(h, 1); // streaming's sight culling needs the real pane shape
    runtime.stepNow();
    runtime.ensureMaterials();
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
        if (screenshotting and runtime.frame % 30 == 0) {
            // what does the LIVE physics set hold under the player's column?
            var covering: usize = 0;
            var best_top: f32 = -1.0e9;
            var ri: usize = 0;
            while (ri < runtime.physics_colliders.rect_count) : (ri += 1) {
                const r = runtime.physics_colliders.values[game_physics.INPUT_HEADER_FLOATS + ri * game_physics.RECT_FLOATS ..][0..game_physics.RECT_FLOATS];
                if (runtime.player.x >= r[0] and runtime.player.z >= r[1] and runtime.player.x <= r[2] and runtime.player.z <= r[3]) {
                    covering += 1;
                    if (r[4] > best_top) best_top = r[4];
                }
            }
            log.print("[loader] f{d} player y={d:.3} vy={d:.3} grounded={} rects={d} underCol={d} underTop={d:.2}\n", .{
                runtime.frame, runtime.player.y, runtime.player.vy, runtime.player.grounded, runtime.physics_colliders.rect_count, covering, best_top,
            });
        }
        runtime.ensureMaterials();
        _ = scene3d.render(&runtime.root, 0, 0, @floatFromInt(WIN_W), @floatFromInt(WIN_H), 1.0);
        gpu.frame(0.52, 0.62, 0.74); // sky-ish clear so the ground reads against it

        if (screenshotting) {
            if (capture.tick(null) or runtime.frame >= MAX_FRAMES) break; // captured → exit
        } else {
            c.SDL_Delay(16); // ~60fps cap so a static scene doesn't spin the CPU
        }
    }
    log.print("[loader] done after {d} frames — player x={d:.2} y={d:.2} z={d:.2} vy={d:.2} grounded={}\n", .{
        runtime.frame, runtime.player.x, runtime.player.y, runtime.player.z, runtime.player.vy, runtime.player.grounded,
    });
}
