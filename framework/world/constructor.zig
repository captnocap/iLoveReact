//! Platform constructor (PLATMOD §4.4, V28) — "the loader takes in all the data,
//! constructs the game from it."
//!
//! Reads a game-file (gamefile.zig), runs the load-time dependency gate
//! (install + sha256-verify every asset into the content store, resolve every
//! stream reference), then composes the smallest renderable: the game-map
//! stream's tile grid. The composed Scene is handed to the stateless render
//! capability (the loader's gpu draw loop) — NO per-game script, NO V8. This
//! is the data-only construct half of the keystone; the render half lives in
//! world_loader.zig.

const std = @import("std");
const gamefile = @import("gamefile.zig");
const mapfile = gamefile.mapfile;

pub const Error = gamefile.Error || error{
    NoMapTiles,
    UnsupportedTileEncoding,
    BadPlayerModel,
    BadHeightfields,
    BadColliders,
    BadPhysicsConfig,
};

const COLLIDERS_VERSION: u32 = 1;
const PHYSICS_CONFIG_VERSION: u32 = 1;
const PHYSICS_CONFIG_FLOATS: usize = 13;

const SCENE_ENV_VERSION: u32 = 1;
const SCENE_ENV_FLOATS: usize = 35;
const PLAYER_MODEL_VERSION: u32 = 2;
const PLAYER_ANIMATION_VERSION: u32 = 1;
const PLAYER_ANIMATION_HASH_BYTES: usize = 32;
const PLAYER_MODEL_ASSET_KEY: u32 = 2001;
const PLAYER_ANIMATION_ASSET_KEY: u32 = 2002;
const HEIGHTFIELDS_VERSION: u32 = 2;
const HEIGHTFIELD_RECORD_FLOATS: usize = 10;

/// The scene render environment (lighting / sky / camera), DATA the loader
/// consumes instead of hardcoding the look (USER req_0308). Defaults mirror
/// compile/sceneEnv.ts DEFAULT_SCENE_ENVIRONMENT so a game-file with no
/// environment lump (e.g. the codec fixture) still renders sensibly.
pub const SceneEnv = struct {
    // White ambient + a sun direction that points UP TOWARD the sun (the shader
    // does max(dot(N, light_dir), 0) with light_dir = direction-to-light, so a
    // downward vector leaves every top face unlit — the dark-scene bug).
    ambient_color: [3]f32 = .{ 1, 1, 1 },
    ambient_intensity: f32 = 0.48,
    dir: [3]f32 = .{ 0.4, 0.82, 0.4 },
    dir_color: [3]f32 = .{ 1.0, 0.96, 0.85 },
    dir_intensity: f32 = 0.95,
    sky_zenith: [3]f32 = .{ 0.12, 0.44, 0.84 },
    sky_horizon: [3]f32 = .{ 0.74, 0.84, 0.94 },
    sky_ground: [3]f32 = .{ 0.05, 0.05, 0.06 },
    sky_sun_dir: [3]f32 = .{ 0.4, 0.82, 0.4 },
    sky_sun_color: [3]f32 = .{ 1.0, 0.96, 0.84 },
    sky_haze: f32 = 0.42,
    sky_cloud: f32 = 0.14,
    sky_night: f32 = 0.0,
    cam_fov: f32 = 50,
    cam_horiz_factor: f32 = 1.25,
    cam_horiz_base: f32 = 8,
    cam_height_factor: f32 = 0.55,
    cam_height_base: f32 = 7,
    cam_far_factor: f32 = 3.0,
};

pub const PlayerModelGroup = struct {
    color: [3]f32,
    alpha: f32,
    vertices: []f32,
    vertex_count: u32,
    tex_w: u32,
    tex_h: u32,
    tex_rgba: ?[]u8,
    position: [3]f32,
    rotation: [3]f32,
    scale: [3]f32,

    pub fn deinit(self: PlayerModelGroup, allocator: std.mem.Allocator) void {
        allocator.free(self.vertices);
        if (self.tex_rgba) |tex| allocator.free(tex);
    }
};

pub const PlayerTransform = struct {
    position: [3]f32,
    rotation: [3]f32,
    scale: [3]f32,
};

pub const PlayerAnimationKeyframe = struct {
    time: f32,
    transforms: []PlayerTransform,

    pub fn deinit(self: PlayerAnimationKeyframe, allocator: std.mem.Allocator) void {
        allocator.free(self.transforms);
    }
};

pub const PlayerAnimationClip = struct {
    id: u32,
    duration: f32,
    looping: bool,
    keyframes: []PlayerAnimationKeyframe,

    pub fn deinit(self: PlayerAnimationClip, allocator: std.mem.Allocator) void {
        for (self.keyframes) |key| key.deinit(allocator);
        allocator.free(self.keyframes);
    }
};

pub const PlayerAnimationSet = struct {
    node_count: u32,
    content_hash: [PLAYER_ANIMATION_HASH_BYTES]u8,
    clips: []PlayerAnimationClip,

    pub fn deinit(self: PlayerAnimationSet, allocator: std.mem.Allocator) void {
        for (self.clips) |clip| clip.deinit(allocator);
        if (self.clips.len > 0) allocator.free(self.clips);
    }
};

pub const HeightfieldMesh = struct {
    cols: u32,
    rows: u32,
    center_x: f32,
    center_z: f32,
    base_y: f32,
    width: f32,
    depth: f32,
    cell: f32,
    walk_cos: f32,
    color: [3]f32,
    heights: []f32,
    tex_w: u32 = 0,
    tex_h: u32 = 0,
    tex_rgba: ?[]u8 = null,

    pub fn deinit(self: HeightfieldMesh, allocator: std.mem.Allocator) void {
        allocator.free(self.heights);
        if (self.tex_rgba) |rgba| allocator.free(rgba);
    }
};

/// Decode the ENVIRONMENT lump (u32 version | f32[35]); on any mismatch keep the
/// struct defaults so the look is always well-formed.
fn decodeEnvironment(data: []const u8) SceneEnv {
    var env = SceneEnv{};
    if (data.len < 4 + SCENE_ENV_FLOATS * 4) return env;
    if (std.mem.readInt(u32, data[0..4], .little) != SCENE_ENV_VERSION) return env;
    var f: [SCENE_ENV_FLOATS]f32 = undefined;
    var i: usize = 0;
    while (i < SCENE_ENV_FLOATS) : (i += 1) {
        f[i] = @bitCast(std.mem.readInt(u32, data[4 + i * 4 ..][0..4], .little));
    }
    env.ambient_color = .{ f[0], f[1], f[2] };
    env.ambient_intensity = f[3];
    env.dir = .{ f[4], f[5], f[6] };
    env.dir_color = .{ f[7], f[8], f[9] };
    env.dir_intensity = f[10];
    env.sky_zenith = .{ f[11], f[12], f[13] };
    env.sky_horizon = .{ f[14], f[15], f[16] };
    env.sky_ground = .{ f[17], f[18], f[19] };
    env.sky_sun_dir = .{ f[20], f[21], f[22] };
    env.sky_sun_color = .{ f[23], f[24], f[25] };
    env.sky_haze = f[26];
    env.sky_cloud = f[27];
    env.sky_night = f[28];
    env.cam_fov = f[29];
    env.cam_horiz_factor = f[30];
    env.cam_horiz_base = f[31];
    env.cam_height_factor = f[32];
    env.cam_height_base = f[33];
    env.cam_far_factor = f[34];
    return env;
}

/// The composed, renderable world. `tiles` is the row-major map tile grid
/// (null = absent cell); heap-owned. `instances` is the packed 3D instance
/// buffer the loader renders as one instanced unit-cube batch — `instance_stride`
/// floats per row (12 = pos3/rot3/scale3/color3). Empty when the game-file
/// carries no instance lump (e.g. the codec round-trip fixture). Grows as more
/// streams compose.
/// A face material shipped as its RECIPE (GUIDING_LIGHT): a WGSL shader source
/// plus its data[] params. The loader runs it once at load to a 1-tile texture
/// (via a StaticSurface+Effect node) and samples it on the referencing faces.
/// DECALS (DECALPIX-0610) are the no-formula case: authored content the editor
/// baked by execution — `pixels` is the decoded w×h RGBA the loader uploads
/// instead of running a shader. See compile/worldGeometry.ts (encodeMaterials).
pub const Material = struct {
    wgsl: []u8,
    data: []f32,
    /// < 1 marks a TRANSLUCENT material. With an empty `wgsl` it's a flat
    /// translucent look (glass/chainlink) the loader renders see-through using
    /// the referencing rows' own color; with a shader it tints the texture.
    opacity: f32 = 1,
    /// Editor-baked decal pixels (RGBA, tight pix_w*4 rows) — empty for shader
    /// and flat materials. Decoded from the lump's pixel-PackBits tail.
    pixels: []u8 = &.{},
    pix_w: u32 = 0,
    pix_h: u32 = 0,

    pub fn deinit(self: Material, allocator: std.mem.Allocator) void {
        allocator.free(self.wgsl);
        allocator.free(self.data);
        if (self.pixels.len > 0) allocator.free(self.pixels);
    }
};

/// Host wire widths (mirror framework/game/physics.zig RECT_FLOATS/ORIENTED_FLOATS
/// + hmsc-int/game/physics.ts writeRect): a blocking rect is 9 floats, an
/// oriented rect is those 9 + pivotX, pivotZ, yawRadians. The COLLIDERS lump
/// already packs them in this order, so the loader memcpys them straight into
/// the physics step input behind the header.
pub const COLLIDER_RECT_FLOATS: usize = 9;
pub const COLLIDER_ORIENTED_FLOATS: usize = 12;

/// One baked ramp/stair slope collider — registered as a host heightfield (the
/// ramp's render geometry rides the instance buffer; this is collision only).
pub const ColliderField = struct {
    origin_x: f32,
    origin_z: f32,
    cell: f32,
    cols: u32,
    rows: u32,
    base_y: f32,
    walk_cos: f32,
    yaw: f32,
    pivot_x: f32,
    pivot_z: f32,
    heights: []f32,

    pub fn deinit(self: ColliderField, allocator: std.mem.Allocator) void {
        allocator.free(self.heights);
    }
};

/// The AUTHORED physics solids the COLLIDERS lump ships — the same +-join-aware
/// bands the editor's play view steps against, NOT a guess re-derived from the
/// render boxes. `rects`/`oriented` are flat, already in host wire order.
pub const BakedColliders = struct {
    rects: []f32,
    rect_count: u32,
    oriented: []f32,
    oriented_count: u32,
    ramps: []ColliderField,

    pub fn deinit(self: BakedColliders, allocator: std.mem.Allocator) void {
        allocator.free(self.rects);
        allocator.free(self.oriented);
        for (self.ramps) |ramp| ramp.deinit(allocator);
        allocator.free(self.ramps);
    }
};

/// Player physics tuning + walk/run speeds from the PHYSICS_CONFIG lump, so the
/// shipped game moves and collides exactly like the editor play view instead of
/// world_loader.zig re-declaring its own constants.
pub const PhysicsConfig = struct {
    gravity: f32,
    jump_speed: f32,
    player_radius: f32,
    player_height: f32,
    step_height: f32,
    wall_restitution: f32,
    body_restitution: f32,
    walkable_side_push_grace: f32,
    accel_mult: f32,
    surface_friction: f32,
    surface_restitution: f32,
    walk_speed: f32,
    run_speed: f32,
};

pub const Scene = struct {
    width: u32,
    height: u32,
    tiles: []?u16,
    instances: []f32,
    instance_count: u32,
    instance_stride: u32,
    has_instance_lump: bool,
    /// Face material vocab (the shipped shader recipes). Empty when nothing is
    /// material-skinned.
    materials: []Material,
    /// Per-instance-row material reference: 1-based into `materials` (0 = flat
    /// color). Parallel to instance rows; empty when the lump is absent.
    material_refs: []u32,
    /// The first `piece_count` instance rows are the PLACED PIECES (the city's
    /// structures); the rest are the painted ground. Lets the loader frame the
    /// camera on the city, not the whole 240m ground plane.
    piece_count: u32,
    /// The render environment (lighting / sky / camera) — data, not hardcoded.
    env: SceneEnv,
    /// The compiled player model: local-coordinate mesh groups, moved by the
    /// runtime player transform in world_loader.zig.
    player_model: []PlayerModelGroup,
    /// Baked transform clips for the compiled player model.
    player_animation: PlayerAnimationSet,
    /// Regular-grid terrain heightfields. The loader hands these to the native
    /// Scene3D heightfield primitive so gpu/3d.zig owns the triangulation.
    heightfields: []HeightfieldMesh,
    /// The AUTHORED physics solids (placedPieceColliders / placedPieceRamps),
    /// when the COLLIDERS lump is present. null → the loader falls back to
    /// deriving colliders from the render instance buffer (pre-lump bakes).
    baked_colliders: ?BakedColliders,
    /// Player tuning + walk/run speed from the PHYSICS_CONFIG lump. null → the
    /// loader keeps its built-in defaults (pre-lump bakes).
    physics_config: ?PhysicsConfig,

    pub fn deinit(self: Scene, allocator: std.mem.Allocator) void {
        allocator.free(self.tiles);
        allocator.free(self.instances);
        for (self.player_model) |group| group.deinit(allocator);
        allocator.free(self.player_model);
        self.player_animation.deinit(allocator);
        for (self.heightfields) |field| field.deinit(allocator);
        allocator.free(self.heightfields);
        for (self.materials) |material| material.deinit(allocator);
        allocator.free(self.materials);
        allocator.free(self.material_refs);
        if (self.baked_colliders) |bc| bc.deinit(allocator);
    }
};

const DecodedInstances = struct { values: []f32, count: u32, stride: u32, pieces: u32 };

fn readF32(data: []const u8, at: usize) f32 {
    return @bitCast(std.mem.readInt(u32, data[at..][0..4], .little));
}

fn emptyPlayerAnimationSet() PlayerAnimationSet {
    return .{
        .node_count = 0,
        .content_hash = [_]u8{0} ** PLAYER_ANIMATION_HASH_BYTES,
        .clips = &.{},
    };
}

/// Decode an instance lump payload
/// (u32 count | u32 stride | u32 pieceCount | f32[count*stride]) into a heap-
/// owned f32 buffer. Returns an empty buffer when the lump is absent or malformed.
fn decodeInstances(allocator: std.mem.Allocator, data: []const u8) Error!DecodedInstances {
    if (data.len < 12) return .{ .values = &.{}, .count = 0, .stride = 0, .pieces = 0 };
    const count = std.mem.readInt(u32, data[0..4], .little);
    const stride = std.mem.readInt(u32, data[4..8], .little);
    const pieces = std.mem.readInt(u32, data[8..12], .little);
    if (count == 0 or stride == 0) return .{ .values = &.{}, .count = 0, .stride = 0, .pieces = 0 };
    const floats = @as(usize, count) * @as(usize, stride);
    const need = 12 + floats * 4;
    if (need > data.len) return .{ .values = &.{}, .count = 0, .stride = 0, .pieces = 0 };
    const values = allocator.alloc(f32, floats) catch return Error.OutOfMemory;
    errdefer allocator.free(values);
    var i: usize = 0;
    while (i < floats) : (i += 1) {
        const bits = std.mem.readInt(u32, data[12 + i * 4 ..][0..4], .little);
        values[i] = @bitCast(bits);
    }
    return .{ .values = values, .count = count, .stride = stride, .pieces = @min(pieces, count) };
}

fn decodePlayerModel(allocator: std.mem.Allocator, data: []const u8) Error![]PlayerModelGroup {
    if (data.len < 8) return try allocator.alloc(PlayerModelGroup, 0);
    if (std.mem.readInt(u32, data[0..4], .little) != PLAYER_MODEL_VERSION) return try allocator.alloc(PlayerModelGroup, 0);
    const count = std.mem.readInt(u32, data[4..8], .little);
    if (count == 0) return try allocator.alloc(PlayerModelGroup, 0);

    var groups = try allocator.alloc(PlayerModelGroup, count);
    var initialized: usize = 0;
    errdefer {
        for (groups[0..initialized]) |group| group.deinit(allocator);
        allocator.free(groups);
    }

    var at: usize = 8;
    var i: usize = 0;
    while (i < count) : (i += 1) {
        if (at + 68 > data.len) return Error.BadPlayerModel;
        const color = [3]f32{ readF32(data, at + 0), readF32(data, at + 4), readF32(data, at + 8) };
        const alpha = readF32(data, at + 12);
        const vertex_count = std.mem.readInt(u32, data[at + 16 ..][0..4], .little);
        const tex_w = std.mem.readInt(u32, data[at + 20 ..][0..4], .little);
        const tex_h = std.mem.readInt(u32, data[at + 24 ..][0..4], .little);
        const tex_len = std.mem.readInt(u32, data[at + 28 ..][0..4], .little);
        const position = [3]f32{ readF32(data, at + 32), readF32(data, at + 36), readF32(data, at + 40) };
        const rotation = [3]f32{ readF32(data, at + 44), readF32(data, at + 48), readF32(data, at + 52) };
        const scale = [3]f32{ readF32(data, at + 56), readF32(data, at + 60), readF32(data, at + 64) };
        at += 68;

        const floats = @as(usize, vertex_count) * 8;
        const vertex_bytes = floats * 4;
        if (at + vertex_bytes + @as(usize, tex_len) > data.len) return Error.BadPlayerModel;
        const vertices = try allocator.alloc(f32, floats);
        errdefer allocator.free(vertices);
        var vi: usize = 0;
        while (vi < floats) : (vi += 1) {
            vertices[vi] = readF32(data, at + vi * 4);
        }
        at += vertex_bytes;

        const tex_rgba: ?[]u8 = if (tex_len > 0) blk: {
            if (tex_w == 0 or tex_h == 0) return Error.BadPlayerModel;
            const tex = try allocator.alloc(u8, tex_len);
            @memcpy(tex, data[at .. at + tex_len]);
            at += tex_len;
            break :blk tex;
        } else null;

        groups[i] = .{
            .color = color,
            .alpha = alpha,
            .vertices = vertices,
            .vertex_count = vertex_count,
            .tex_w = tex_w,
            .tex_h = tex_h,
            .tex_rgba = tex_rgba,
            .position = position,
            .rotation = rotation,
            .scale = scale,
        };
        initialized += 1;
    }
    return groups;
}

fn decodePlayerAnimationPayload(allocator: std.mem.Allocator, payload: []const u8, hash: [PLAYER_ANIMATION_HASH_BYTES]u8) Error!PlayerAnimationSet {
    if (payload.len < 12) return Error.BadPlayerModel;
    if (std.mem.readInt(u32, payload[0..4], .little) != PLAYER_ANIMATION_VERSION) return Error.BadPlayerModel;
    const clip_count = std.mem.readInt(u32, payload[4..8], .little);
    const node_count = std.mem.readInt(u32, payload[8..12], .little);
    var clips = try allocator.alloc(PlayerAnimationClip, clip_count);
    var clip_initialized: usize = 0;
    errdefer {
        for (clips[0..clip_initialized]) |clip| clip.deinit(allocator);
        allocator.free(clips);
    }

    var at: usize = 12;
    var ci: usize = 0;
    while (ci < clip_count) : (ci += 1) {
        if (at + 16 > payload.len) return Error.BadPlayerModel;
        const clip_id = std.mem.readInt(u32, payload[at + 0 ..][0..4], .little);
        const duration = readF32(payload, at + 4);
        const looping = std.mem.readInt(u32, payload[at + 8 ..][0..4], .little) != 0;
        const key_count = std.mem.readInt(u32, payload[at + 12 ..][0..4], .little);
        at += 16;

        var keyframes = try allocator.alloc(PlayerAnimationKeyframe, key_count);
        var key_initialized: usize = 0;
        errdefer {
            for (keyframes[0..key_initialized]) |key| key.deinit(allocator);
            allocator.free(keyframes);
        }
        var ki: usize = 0;
        while (ki < key_count) : (ki += 1) {
            if (at + 4 > payload.len) return Error.BadPlayerModel;
            const time = readF32(payload, at);
            at += 4;
            const transforms = try allocator.alloc(PlayerTransform, node_count);
            errdefer allocator.free(transforms);
            var ni: usize = 0;
            while (ni < node_count) : (ni += 1) {
                if (at + 36 > payload.len) return Error.BadPlayerModel;
                transforms[ni] = .{
                    .position = .{ readF32(payload, at + 0), readF32(payload, at + 4), readF32(payload, at + 8) },
                    .rotation = .{ readF32(payload, at + 12), readF32(payload, at + 16), readF32(payload, at + 20) },
                    .scale = .{ readF32(payload, at + 24), readF32(payload, at + 28), readF32(payload, at + 32) },
                };
                at += 36;
            }
            keyframes[ki] = .{ .time = time, .transforms = transforms };
            key_initialized += 1;
        }
        clips[ci] = .{ .id = clip_id, .duration = duration, .looping = looping, .keyframes = keyframes };
        clip_initialized += 1;
    }
    return .{ .node_count = node_count, .content_hash = hash, .clips = clips };
}

fn decodePlayerAnimation(allocator: std.mem.Allocator, data: []const u8) Error!PlayerAnimationSet {
    if (data.len == 0) return emptyPlayerAnimationSet();
    if (data.len < 4 + PLAYER_ANIMATION_HASH_BYTES + 12) return Error.BadPlayerModel;
    if (std.mem.readInt(u32, data[0..4], .little) != PLAYER_ANIMATION_VERSION) return Error.BadPlayerModel;
    var expected: [PLAYER_ANIMATION_HASH_BYTES]u8 = undefined;
    @memcpy(expected[0..], data[4 .. 4 + PLAYER_ANIMATION_HASH_BYTES]);
    const payload = data[4 + PLAYER_ANIMATION_HASH_BYTES ..];
    var actual: [PLAYER_ANIMATION_HASH_BYTES]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(payload, &actual, .{});
    if (!std.mem.eql(u8, &expected, &actual)) return Error.BadPlayerModel;
    return decodePlayerAnimationPayload(allocator, payload, expected);
}

fn decodeHeightfields(allocator: std.mem.Allocator, data: []const u8) Error![]HeightfieldMesh {
    if (data.len == 0) return try allocator.alloc(HeightfieldMesh, 0);
    if (data.len < 8) return Error.BadHeightfields;
    const version = std.mem.readInt(u32, data[0..4], .little);
    if (version != 1 and version != HEIGHTFIELDS_VERSION) return Error.BadHeightfields;
    const count = std.mem.readInt(u32, data[4..8], .little);
    var fields = try allocator.alloc(HeightfieldMesh, count);
    var initialized: usize = 0;
    errdefer {
        for (fields[0..initialized]) |field| field.deinit(allocator);
        allocator.free(fields);
    }

    var at: usize = 8;
    var i: usize = 0;
    while (i < count) : (i += 1) {
        const fixed_header_bytes: usize = if (version >= 2) 16 else 8;
        if (at + fixed_header_bytes + HEIGHTFIELD_RECORD_FLOATS * 4 > data.len) return Error.BadHeightfields;
        const cols = std.mem.readInt(u32, data[at + 0 ..][0..4], .little);
        const rows = std.mem.readInt(u32, data[at + 4 ..][0..4], .little);
        const tex_w = if (version >= 2) std.mem.readInt(u32, data[at + 8 ..][0..4], .little) else 0;
        const tex_h = if (version >= 2) std.mem.readInt(u32, data[at + 12 ..][0..4], .little) else 0;
        at += fixed_header_bytes;
        if (cols < 2 or rows < 2) return Error.BadHeightfields;
        const samples = std.math.mul(usize, @as(usize, cols), @as(usize, rows)) catch return Error.BadHeightfields;
        const values_bytes = samples * 4;
        const texture_bytes = if (version >= 2 and tex_w > 0 and tex_h > 0)
            (std.math.mul(usize, @as(usize, tex_w), @as(usize, tex_h)) catch return Error.BadHeightfields) * 4
        else
            0;
        if (at + HEIGHTFIELD_RECORD_FLOATS * 4 + values_bytes + texture_bytes > data.len) return Error.BadHeightfields;
        const center_x = readF32(data, at + 0);
        const center_z = readF32(data, at + 4);
        const base_y = readF32(data, at + 8);
        const width = readF32(data, at + 12);
        const depth = readF32(data, at + 16);
        const cell = readF32(data, at + 20);
        const walk_cos = readF32(data, at + 24);
        const color = [3]f32{ readF32(data, at + 28), readF32(data, at + 32), readF32(data, at + 36) };
        at += HEIGHTFIELD_RECORD_FLOATS * 4;

        const heights = try allocator.alloc(f32, samples);
        errdefer allocator.free(heights);
        var h: usize = 0;
        while (h < samples) : (h += 1) {
            heights[h] = readF32(data, at + h * 4);
        }
        at += values_bytes;
        const tex_rgba = if (texture_bytes > 0) blk: {
            const rgba = try allocator.alloc(u8, texture_bytes);
            errdefer allocator.free(rgba);
            @memcpy(rgba, data[at .. at + texture_bytes]);
            at += texture_bytes;
            break :blk rgba;
        } else null;

        fields[i] = .{
            .cols = cols,
            .rows = rows,
            .center_x = center_x,
            .center_z = center_z,
            .base_y = base_y,
            .width = width,
            .depth = depth,
            .cell = cell,
            .walk_cos = walk_cos,
            .color = color,
            .heights = heights,
            .tex_w = tex_w,
            .tex_h = tex_h,
            .tex_rgba = tex_rgba,
        };
        initialized += 1;
    }
    return fields;
}

/// Decode the COLLIDERS lump — the authored physics solids in host wire order
/// (see runtime/workspace/lumps.ts COLLIDERS). Layout:
///   u32 version | u32 rectCount | f32[rectCount*9] |
///   u32 orientedCount | f32[orientedCount*12] |
///   u32 rampCount | per ramp: f32 originX,originZ,cellSize | u32 cols,rows |
///   f32 baseY,walkCos,yawRad,pivotX,pivotZ | f32[cols*rows] heights.
fn decodeColliders(allocator: std.mem.Allocator, data: []const u8) Error!BakedColliders {
    if (data.len < 12) return Error.BadColliders;
    if (std.mem.readInt(u32, data[0..4], .little) != COLLIDERS_VERSION) return Error.BadColliders;
    var at: usize = 4;

    const rect_count = std.mem.readInt(u32, data[at..][0..4], .little);
    at += 4;
    const rect_floats = std.math.mul(usize, rect_count, COLLIDER_RECT_FLOATS) catch return Error.BadColliders;
    if (at + rect_floats * 4 > data.len) return Error.BadColliders;
    const rects = try allocator.alloc(f32, rect_floats);
    errdefer allocator.free(rects);
    for (rects, 0..) |*v, i| v.* = readF32(data, at + i * 4);
    at += rect_floats * 4;

    if (at + 4 > data.len) return Error.BadColliders;
    const oriented_count = std.mem.readInt(u32, data[at..][0..4], .little);
    at += 4;
    const oriented_floats = std.math.mul(usize, oriented_count, COLLIDER_ORIENTED_FLOATS) catch return Error.BadColliders;
    if (at + oriented_floats * 4 > data.len) return Error.BadColliders;
    const oriented = try allocator.alloc(f32, oriented_floats);
    errdefer allocator.free(oriented);
    for (oriented, 0..) |*v, i| v.* = readF32(data, at + i * 4);
    at += oriented_floats * 4;

    if (at + 4 > data.len) return Error.BadColliders;
    const ramp_count = std.mem.readInt(u32, data[at..][0..4], .little);
    at += 4;
    var ramps = try allocator.alloc(ColliderField, ramp_count);
    var ramp_initialized: usize = 0;
    errdefer {
        for (ramps[0..ramp_initialized]) |ramp| ramp.deinit(allocator);
        allocator.free(ramps);
    }
    var r: usize = 0;
    while (r < ramp_count) : (r += 1) {
        // 3 f32 + 2 u32 + 5 f32 = 10 scalars before the height grid.
        if (at + 10 * 4 > data.len) return Error.BadColliders;
        const origin_x = readF32(data, at + 0);
        const origin_z = readF32(data, at + 4);
        const cell = readF32(data, at + 8);
        const cols = std.mem.readInt(u32, data[at + 12 ..][0..4], .little);
        const rows = std.mem.readInt(u32, data[at + 16 ..][0..4], .little);
        const base_y = readF32(data, at + 20);
        const walk_cos = readF32(data, at + 24);
        const yaw = readF32(data, at + 28);
        const pivot_x = readF32(data, at + 32);
        const pivot_z = readF32(data, at + 36);
        at += 10 * 4;
        if (cols < 2 or rows < 2) return Error.BadColliders;
        const samples = std.math.mul(usize, @as(usize, cols), @as(usize, rows)) catch return Error.BadColliders;
        if (at + samples * 4 > data.len) return Error.BadColliders;
        const heights = try allocator.alloc(f32, samples);
        errdefer allocator.free(heights);
        for (heights, 0..) |*v, i| v.* = readF32(data, at + i * 4);
        at += samples * 4;
        ramps[r] = .{
            .origin_x = origin_x,
            .origin_z = origin_z,
            .cell = cell,
            .cols = cols,
            .rows = rows,
            .base_y = base_y,
            .walk_cos = walk_cos,
            .yaw = yaw,
            .pivot_x = pivot_x,
            .pivot_z = pivot_z,
            .heights = heights,
        };
        ramp_initialized += 1;
    }

    return .{
        .rects = rects,
        .rect_count = rect_count,
        .oriented = oriented,
        .oriented_count = oriented_count,
        .ramps = ramps,
    };
}

/// Decode the PHYSICS_CONFIG lump (u32 version | f32[13]); see
/// runtime/workspace/lumps.ts PHYSICS_CONFIG for the field order.
fn decodePhysicsConfig(data: []const u8) Error!PhysicsConfig {
    if (data.len < 4 + PHYSICS_CONFIG_FLOATS * 4) return Error.BadPhysicsConfig;
    if (std.mem.readInt(u32, data[0..4], .little) != PHYSICS_CONFIG_VERSION) return Error.BadPhysicsConfig;
    const f = struct {
        fn at(d: []const u8, i: usize) f32 {
            return readF32(d, 4 + i * 4);
        }
    }.at;
    return .{
        .gravity = f(data, 0),
        .jump_speed = f(data, 1),
        .player_radius = f(data, 2),
        .player_height = f(data, 3),
        .step_height = f(data, 4),
        .wall_restitution = f(data, 5),
        .body_restitution = f(data, 6),
        .walkable_side_push_grace = f(data, 7),
        .accel_mult = f(data, 8),
        .surface_friction = f(data, 9),
        .surface_restitution = f(data, 10),
        .walk_speed = f(data, 11),
        .run_speed = f(data, 12),
    };
}

/// Max decal pixel texture side the loader will allocate (mirrors the TS
/// codec's MAX_PIXEL_DIM — a corrupt header can't ask for a 4GB upload).
const MAX_DECAL_PIXEL_DIM: u32 = 4096;

/// Decode one pixel-PackBits stream (compile/.../decalPixels.ts) to tight RGBA
/// bytes. Control byte n: n < 128 → (n+1) literal pixels follow; n >= 128 →
/// the one pixel that follows repeats (256-n) times. Null on any malformation
/// (truncated stream, count mismatch) — the caller degrades to pixel-less.
fn decodePixelRle(allocator: std.mem.Allocator, rle: []const u8, pixel_count: usize) ?[]u8 {
    const out = allocator.alloc(u8, pixel_count * 4) catch return null;
    var at: usize = 0;
    var emitted: usize = 0;
    while (emitted < pixel_count) {
        if (at >= rle.len) {
            allocator.free(out);
            return null;
        }
        const control = rle[at];
        at += 1;
        if (control >= 128) {
            const run: usize = 256 - @as(usize, control);
            if (at + 4 > rle.len or emitted + run > pixel_count) {
                allocator.free(out);
                return null;
            }
            var k: usize = 0;
            while (k < run) : (k += 1) {
                const di = (emitted + k) * 4;
                out[di + 0] = rle[at + 0];
                out[di + 1] = rle[at + 1];
                out[di + 2] = rle[at + 2];
                out[di + 3] = rle[at + 3];
            }
            at += 4;
            emitted += run;
        } else {
            const lit: usize = @as(usize, control) + 1;
            if (at + lit * 4 > rle.len or emitted + lit > pixel_count) {
                allocator.free(out);
                return null;
            }
            @memcpy(out[emitted * 4 ..][0 .. lit * 4], rle[at..][0 .. lit * 4]);
            at += lit * 4;
            emitted += lit;
        }
    }
    if (at != rle.len) {
        allocator.free(out);
        return null;
    }
    return out;
}

/// Parse the optional DECAL PIXEL TAIL (DECALPIX-0610): u32 'PIXS' magic |
/// u32 entryCount | per entry: u32 materialIndex | u32 w | u32 h | u32 rleLen |
/// rle bytes. Attaches decoded RGBA to the referenced materials. Defensive by
/// design: any inconsistency stops the tail parse and leaves the remaining
/// materials pixel-less (their faces fall back to flat color) — a decal
/// payload problem never fails the whole map construct.
fn decodeMaterialPixelTail(allocator: std.mem.Allocator, data: []const u8, start: usize, materials: []Material) void {
    var at = start;
    if (at + 8 > data.len) return;
    if (std.mem.readInt(u32, data[at..][0..4], .little) != 0x53584950) return; // 'PIXS'
    at += 4;
    const entries = std.mem.readInt(u32, data[at..][0..4], .little);
    at += 4;
    var n: u32 = 0;
    while (n < entries) : (n += 1) {
        if (at + 16 > data.len) return;
        const mat_index = std.mem.readInt(u32, data[at..][0..4], .little);
        const w = std.mem.readInt(u32, data[at + 4 ..][0..4], .little);
        const h = std.mem.readInt(u32, data[at + 8 ..][0..4], .little);
        const rle_len = std.mem.readInt(u32, data[at + 12 ..][0..4], .little);
        at += 16;
        if (at + rle_len > data.len) return;
        const rle = data[at .. at + rle_len];
        at += rle_len;
        if (mat_index >= materials.len) continue;
        if (w == 0 or h == 0 or w > MAX_DECAL_PIXEL_DIM or h > MAX_DECAL_PIXEL_DIM) continue;
        const m = &materials[mat_index];
        if (m.pixels.len > 0) continue; // duplicate entry — first one wins
        const rgba = decodePixelRle(allocator, rle, @as(usize, w) * @as(usize, h)) orelse continue;
        m.pixels = rgba;
        m.pix_w = w;
        m.pix_h = h;
    }
}

/// Decode the MATERIALS lump (u32 count, then per material: u32 wgsl byte len |
/// wgsl utf8 | u32 data float count | f32[data]), plus the optional decal
/// pixel tail (decodeMaterialPixelTail above). A malformed lump yields an
/// empty vocab (faces fall back to their flat color) rather than aborting.
fn decodeMaterials(allocator: std.mem.Allocator, data: []const u8) Error![]Material {
    if (data.len < 4) return try allocator.alloc(Material, 0);
    const count = std.mem.readInt(u32, data[0..4], .little);
    var out = try allocator.alloc(Material, count);
    var built: usize = 0;
    errdefer {
        for (out[0..built]) |m| m.deinit(allocator);
        allocator.free(out);
    }
    var at: usize = 4;
    while (built < count) : (built += 1) {
        if (at + 4 > data.len) return Error.BadHeightfields;
        const wgsl_len = std.mem.readInt(u32, data[at..][0..4], .little);
        at += 4;
        if (at + wgsl_len > data.len) return Error.BadHeightfields;
        const wgsl = try allocator.dupe(u8, data[at .. at + wgsl_len]);
        errdefer allocator.free(wgsl);
        at += wgsl_len;
        if (at + 4 > data.len) {
            allocator.free(wgsl);
            return Error.BadHeightfields;
        }
        const data_len = std.mem.readInt(u32, data[at..][0..4], .little);
        at += 4;
        if (at + @as(usize, data_len) * 4 > data.len) {
            allocator.free(wgsl);
            return Error.BadHeightfields;
        }
        const params = try allocator.alloc(f32, data_len);
        for (0..data_len) |i| params[i] = readF32(data, at + i * 4);
        at += @as(usize, data_len) * 4;
        if (at + 4 > data.len) {
            allocator.free(params);
            allocator.free(wgsl);
            return Error.BadHeightfields;
        }
        const opacity = readF32(data, at);
        at += 4;
        out[built] = .{ .wgsl = wgsl, .data = params, .opacity = opacity };
    }
    decodeMaterialPixelTail(allocator, data, at, out);
    return out;
}

/// Decode the MATERIAL_REFS lump (u32 count | u32[count]). Empty when absent.
fn decodeMaterialRefs(allocator: std.mem.Allocator, data: []const u8) Error![]u32 {
    if (data.len < 4) return try allocator.alloc(u32, 0);
    const count = std.mem.readInt(u32, data[0..4], .little);
    if (4 + @as(usize, count) * 4 > data.len) return try allocator.alloc(u32, 0);
    const out = try allocator.alloc(u32, count);
    for (0..count) |i| out[i] = std.mem.readInt(u32, data[4 + i * 4 ..][0..4], .little);
    return out;
}

fn streamReferences(stream: gamefile.Stream, key: u32) bool {
    for (stream.refs) |ref| {
        if (ref == key) return true;
    }
    return false;
}

fn readInstalledAsset(allocator: std.mem.Allocator, file: gamefile.GameFile, store_dir: std.fs.Dir, key: u32) Error!?[]u8 {
    const hash = file.assetHashForKey(key) orelse return null;
    const hex = std.fmt.bytesToHex(hash, .lower);
    return store_dir.readFileAlloc(allocator, hex[0..], 64 << 20) catch return Error.MissingAsset;
}

/// Construct a Scene from a game-file's bytes: validate the dependency gate
/// against `store_dir`, then decode the map stream's tile grid. The asset
/// vocabulary is installed/verified as a side effect (the gate must pass before
/// anything is composed).
pub fn construct(allocator: std.mem.Allocator, bytes: []const u8, store_dir: std.fs.Dir) Error!Scene {
    const file = try gamefile.readGameFile(allocator, bytes);
    defer file.deinit(allocator);

    // The gate: install + sha256-verify every asset, resolve every reference.
    // Nothing is constructed until the whole vocabulary checks out.
    try file.installAndValidate(allocator, store_dir);

    // The game-map stream's data is a nested RJMP map container; pull its tiles.
    const map_lumps = try mapfile.readLumps(allocator, file.map.data, null);
    defer allocator.free(map_lumps);
    const tiles_lump = mapfile.findLump(map_lumps, mapfile.LumpType.tiles) orelse return Error.NoMapTiles;

    const grid = switch (tiles_lump.encoding) {
        .rle16 => try mapfile.decodeRle16(allocator, tiles_lump.data),
        .rle8 => try mapfile.decodeRle8(allocator, tiles_lump.data),
        else => return Error.UnsupportedTileEncoding,
    };
    errdefer allocator.free(grid.values);

    // The 3D geometry: the authored world's instance buffer (optional — absent
    // in the codec round-trip fixture, present in the real editor bake).
    const instances_lump = mapfile.findLump(map_lumps, mapfile.LumpType.instances);
    const inst: DecodedInstances = if (instances_lump) |lump|
        try decodeInstances(allocator, lump.data)
    else
        .{ .values = &.{}, .count = 0, .stride = 0, .pieces = 0 };

    // The render environment (lighting / sky / camera) — data, defaulted when
    // the lump is absent.
    const env: SceneEnv = if (mapfile.findLump(map_lumps, mapfile.LumpType.environment)) |lump|
        decodeEnvironment(lump.data)
    else
        .{};
    var player_model_asset: ?[]u8 = null;
    defer if (player_model_asset) |bytes_model| allocator.free(bytes_model);
    const player_model: []PlayerModelGroup = if (mapfile.findLump(map_lumps, mapfile.LumpType.player_model)) |lump|
        try decodePlayerModel(allocator, lump.data)
    else if (streamReferences(file.map, PLAYER_MODEL_ASSET_KEY)) blk: {
        player_model_asset = try readInstalledAsset(allocator, file, store_dir, PLAYER_MODEL_ASSET_KEY);
        break :blk if (player_model_asset) |bytes_model| try decodePlayerModel(allocator, bytes_model) else try allocator.alloc(PlayerModelGroup, 0);
    } else try allocator.alloc(PlayerModelGroup, 0);
    var player_animation_asset: ?[]u8 = null;
    defer if (player_animation_asset) |bytes_animation| allocator.free(bytes_animation);
    const player_animation = if (mapfile.findLump(map_lumps, mapfile.LumpType.player_animation)) |lump|
        try decodePlayerAnimation(allocator, lump.data)
    else if (streamReferences(file.map, PLAYER_ANIMATION_ASSET_KEY)) blk: {
        player_animation_asset = try readInstalledAsset(allocator, file, store_dir, PLAYER_ANIMATION_ASSET_KEY);
        break :blk if (player_animation_asset) |bytes_animation| try decodePlayerAnimation(allocator, bytes_animation) else emptyPlayerAnimationSet();
    } else emptyPlayerAnimationSet();
    const heightfields = if (mapfile.findLump(map_lumps, mapfile.LumpType.heightfields)) |lump|
        try decodeHeightfields(allocator, lump.data)
    else
        try allocator.alloc(HeightfieldMesh, 0);

    // Face materials: the shipped shader recipes + the per-row reference into
    // them (both optional — absent on a map with no material-skinned faces).
    const materials = if (mapfile.findLump(map_lumps, mapfile.LumpType.materials)) |lump|
        try decodeMaterials(allocator, lump.data)
    else
        try allocator.alloc(Material, 0);
    errdefer {
        for (materials) |m| m.deinit(allocator);
        allocator.free(materials);
    }
    const material_refs = if (mapfile.findLump(map_lumps, mapfile.LumpType.material_refs)) |lump|
        try decodeMaterialRefs(allocator, lump.data)
    else
        try allocator.alloc(u32, 0);
    errdefer allocator.free(material_refs);
    errdefer {
        for (heightfields) |field| field.deinit(allocator);
        allocator.free(heightfields);
    }

    // The AUTHORED physics solids + player config (optional — absent in pre-lump
    // bakes and the codec round-trip fixture, present in the real editor bake).
    // When present the loader steps against THESE instead of guessing colliders
    // from the render boxes; absent, it falls back to the instance-derived path.
    const baked_colliders: ?BakedColliders = if (mapfile.findLump(map_lumps, mapfile.LumpType.colliders)) |lump|
        try decodeColliders(allocator, lump.data)
    else
        null;
    errdefer if (baked_colliders) |bc| bc.deinit(allocator);
    const physics_config: ?PhysicsConfig = if (mapfile.findLump(map_lumps, mapfile.LumpType.physics_config)) |lump|
        try decodePhysicsConfig(lump.data)
    else
        null;

    // grid.values ownership transfers to the Scene; do not deinit grid.
    return .{
        .width = grid.width,
        .height = grid.height,
        .tiles = grid.values,
        .instances = inst.values,
        .instance_count = inst.count,
        .instance_stride = inst.stride,
        .has_instance_lump = instances_lump != null,
        .piece_count = inst.pieces,
        .env = env,
        .player_model = player_model,
        .player_animation = player_animation,
        .heightfields = heightfields,
        .materials = materials,
        .material_refs = material_refs,
        .baked_colliders = baked_colliders,
        .physics_config = physics_config,
    };
}
