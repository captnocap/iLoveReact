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
};

const SCENE_ENV_VERSION: u32 = 1;
const SCENE_ENV_FLOATS: usize = 35;
const PLAYER_MODEL_VERSION: u32 = 2;
const PLAYER_ANIMATION_VERSION: u32 = 1;
const PLAYER_ANIMATION_HASH_BYTES: usize = 32;

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
pub const Scene = struct {
    width: u32,
    height: u32,
    tiles: []?u16,
    instances: []f32,
    instance_count: u32,
    instance_stride: u32,
    has_instance_lump: bool,
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

    pub fn deinit(self: Scene, allocator: std.mem.Allocator) void {
        allocator.free(self.tiles);
        allocator.free(self.instances);
        for (self.player_model) |group| group.deinit(allocator);
        allocator.free(self.player_model);
        self.player_animation.deinit(allocator);
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
    const player_model: []PlayerModelGroup = if (mapfile.findLump(map_lumps, mapfile.LumpType.player_model)) |lump|
        try decodePlayerModel(allocator, lump.data)
    else
        try allocator.alloc(PlayerModelGroup, 0);
    const player_animation = if (mapfile.findLump(map_lumps, mapfile.LumpType.player_animation)) |lump|
        try decodePlayerAnimation(allocator, lump.data)
    else
        emptyPlayerAnimationSet();

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
    };
}
