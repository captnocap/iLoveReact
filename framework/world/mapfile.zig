//! Platform mapfile reader for the slice-1 RJMP lump container.

const std = @import("std");

pub const MAGIC: u32 = 0x504d4a52; // "RJMP", little-endian
pub const VERSION: u16 = 0;
pub const HEADER_BYTES: usize = 16;
pub const DIRECTORY_ENTRY_BYTES: usize = 24;

pub const Encoding = enum(u16) {
    raw = 0,
    rle8 = 1,
    rle16 = 2,
    text = 3,
};

pub const LumpType = struct {
    pub const strings: u32 = 1;
    pub const tiles: u32 = 2;
    pub const heights: u32 = 3;
    pub const zones: u32 = 4;
    pub const placements: u32 = 5;
    pub const entities: u32 = 6;
    /// Packed 3D instance buffer: u32 count | f32[count*9] (pos3/scale3/color3).
    pub const instances: u32 = 7;
    /// Scene render environment (lighting / sky / camera framing) as data.
    pub const environment: u32 = 8;
    /// Baked local-coordinate player model mesh groups.
    pub const player_model: u32 = 9;
    /// Baked player animation clips: declarative transform keyframes.
    pub const player_animation: u32 = 10;
    /// Baked regular-grid terrain heightfields.
    pub const heightfields: u32 = 11;
    /// Material vocab: face shaders shipped as recipes (WGSL + data[]); the host
    /// materializes them at load. See compile/worldGeometry.ts (encodeMaterials).
    pub const materials: u32 = 12;
    /// Per-instance-row material reference (1-based into materials; 0 = none).
    pub const material_refs: u32 = 13;
    /// Authored physics colliders — the editor's semantic solids
    /// (placedPieceColliders / placedPieceRamps), packed in host wire order so a
    /// "+" wall collides where it looks. See runtime/workspace/lumps.ts COLLIDERS.
    pub const colliders: u32 = 14;
    /// Player physics tuning + walk/run speeds, baked so the shipped game matches
    /// the editor play view. See runtime/workspace/lumps.ts PHYSICS_CONFIG.
    pub const physics_config: u32 = 15;
    /// The prop interaction layer (PROPUSE req_0624): seat/container archetypes
    /// + thin instance refs, so E-to-sit/search works in the compiled game.
    /// See runtime/workspace/lumps.ts INTERACTABLES + compile/worldInteractables.ts.
    pub const interactables: u32 = 16;
    /// Kickable dynamic props (KICKPROP req_0625): sphere-body recipes + local
    /// render parts. See runtime/workspace/lumps.ts DYNAMIC_PROPS +
    /// compile/worldDynamicProps.ts.
    pub const dynamic_props: u32 = 17;
    /// Elevator shafts (req_0652): car footprint/thickness/speed + module
    /// footprint + one stop per stacked storey. The loader appends one LIVE
    /// car rect per shaft and rides it (E to ride/call, /test parity). See
    /// runtime/workspace/lumps.ts ELEVATORS + compile/worldElevators.ts.
    pub const elevators: u32 = 18;
    /// Door panels (DOORS-0611, req_0654): the closed leaf's box + reach +
    /// flags per interactable wall cutout. The loader appends one LIVE rect
    /// per door and toggles it on E (/test's two-state door). See
    /// runtime/workspace/lumps.ts DOORS + compile/worldDoors.ts.
    pub const doors: u32 = 19;
    /// Imported OBJ/GLB prop meshes: shared baked vertex payloads plus placed
    /// transforms. See runtime/workspace/lumps.ts MESH_PROPS +
    /// compile/worldGeometry.ts encodeMeshProps.
    pub const mesh_props: u32 = 20;
    /// Bodies of water (world/water): per-body flat surface-level height grids
    /// the loader renders as translucent heightfields with a host-clock
    /// travelling wave. See runtime/workspace/lumps.ts WATER +
    /// compile/worldGeometry.ts encodeWaterBodies.
    pub const water: u32 = 21;
    /// Player-stats config (GAME_STATS): the flat stat tuning the formulas read,
    /// baked so the no-V8 loader seeds the same numbers as the editor. Fixed
    /// layout u32 version | f32[43]; see runtime/workspace/lumps.ts STATS_CONFIG
    /// + compile/playerStats.ts encodeStatsConfig.
    pub const stats_config: u32 = 22;
    /// LED ticker boards (req_0893 #3): per ticker — anchor + yaw + board dims +
    /// lit color + scroll speed + the message column bitmasks. world_loader.zig
    /// scrolls + draws the lit LEDs per frame. Layout: runtime/workspace/lumps.ts
    /// TICKER + compile/worldTicker.ts encodeTickers.
    pub const ticker: u32 = 23;

    /// NPC population (req_0935): the figures that walk the compiled world,
    /// baked as DATA. NPC_MODELS carries one or more figure models in the SAME
    /// 68-byte-header mesh-group layout as player_model; NPCs reuse the
    /// player_animation clips (shared skeleton). Layout:
    /// runtime/workspace/lumps.ts NPC_MODELS + compile/npcModels.ts.
    pub const npc_models: u32 = 24;
    /// NPC spawn rows: u32 modelIndex | f32 x,z,yaw | u32 kind | u32 faction.
    /// The loader grounds each on the terrain and animates it. Layout:
    /// runtime/workspace/lumps.ts NPC_SPAWNS + compile/npcModels.ts.
    pub const npc_spawns: u32 = 25;
    /// Foliage RECIPE (FOLIAGEFORMULA, req_1591): painted flora CELLS, not
    /// expanded blade/plant rows. The loader expands recipes at load via
    /// framework/world/foliage.zig. Layout: u32 version | f32 cellSizeMeters |
    /// u32 cellCount | per cell: u32 cellKey | f32 wx | f32 wz | f32 top |
    /// u16 append-only specId | u16 count. runtime/workspace/lumps.ts FLORA.
    pub const flora: u32 = 26;
    /// Per-instance-row WALL flag (req_2053): u32 count | u8[count], 1 = wall
    /// piece. Parallel to the instance rows; the editor's build pane hides the
    /// flagged rows live (set_hide_walls) so you can edit a building's interior.
    /// runtime/workspace/lumps.ts WALL_FLAGS + worldGeometry.ts encodeWallFlags.
    pub const wall_flags: u32 = 27;
    /// Ambient road traffic (req_2056): per vehicle — a buildVehicle prototype
    /// (local instance rows pos3/rot3/scale3/color3/shape) + a looping route
    /// polyline + cruise speed + phase. world_loader.zig samples each route per
    /// frame and rebuilds the vehicle's instance rows at the pose (the ticker
    /// mutable-instance pattern). runtime/workspace/lumps.ts TRAFFIC +
    /// cart/hmsc-int/compile/worldTraffic.ts encodeTraffic.
    pub const traffic: u32 = 28;
};

pub const Lump = struct {
    type_id: u32,
    encoding: Encoding,
    offset: u32,
    length: u32,
    decoded_length: u32,
    data: []const u8,
};

pub const RleGrid = struct {
    width: u32,
    height: u32,
    values: []?u16,

    pub fn deinit(self: RleGrid, allocator: std.mem.Allocator) void {
        allocator.free(self.values);
    }
};

pub const Error = error{
    OutOfMemory,
    MapTooSmall,
    BadMagic,
    UnsupportedVersion,
    DirectoryOutOfBounds,
    UnknownEncoding,
    LumpOutOfBounds,
    RleTooSmall,
    RleTruncated,
    RleSizeOverflow,
};

fn readU16(bytes: []const u8, at: usize) u16 {
    return std.mem.readInt(u16, bytes[at..][0..2], .little);
}

fn readU32(bytes: []const u8, at: usize) u32 {
    return std.mem.readInt(u32, bytes[at..][0..4], .little);
}

fn known(type_id: u32, known_types: ?[]const u32) bool {
    const types = known_types orelse return true;
    for (types) |known_type| {
        if (known_type == type_id) return true;
    }
    return false;
}

pub fn readLumps(allocator: std.mem.Allocator, bytes: []const u8, known_types: ?[]const u32) Error![]Lump {
    if (bytes.len < HEADER_BYTES) return Error.MapTooSmall;
    if (readU32(bytes, 0) != MAGIC) return Error.BadMagic;
    if (readU16(bytes, 4) != VERSION) return Error.UnsupportedVersion;
    const count = readU32(bytes, 8);
    const dir_offset = readU32(bytes, 12);
    const dir_end = @as(usize, dir_offset) + @as(usize, count) * DIRECTORY_ENTRY_BYTES;
    if (dir_end > bytes.len) return Error.DirectoryOutOfBounds;

    var out: std.ArrayList(Lump) = .{};
    errdefer out.deinit(allocator);
    var i: usize = 0;
    while (i < count) : (i += 1) {
        const at = @as(usize, dir_offset) + i * DIRECTORY_ENTRY_BYTES;
        const type_id = readU32(bytes, at);
        const encoding_raw = readU16(bytes, at + 4);
        const encoding: Encoding = switch (encoding_raw) {
            0 => .raw,
            1 => .rle8,
            2 => .rle16,
            3 => .text,
            else => return Error.UnknownEncoding,
        };
        const offset = readU32(bytes, at + 8);
        const length = readU32(bytes, at + 12);
        const decoded_length = readU32(bytes, at + 16);
        const end = @as(usize, offset) + @as(usize, length);
        if (end > bytes.len) return Error.LumpOutOfBounds;
        if (!known(type_id, known_types)) continue;
        try out.append(allocator, .{
            .type_id = type_id,
            .encoding = encoding,
            .offset = offset,
            .length = length,
            .decoded_length = decoded_length,
            .data = bytes[@as(usize, offset)..end],
        });
    }
    return try out.toOwnedSlice(allocator);
}

pub fn findLump(lumps: []const Lump, type_id: u32) ?Lump {
    for (lumps) |lump| {
        if (lump.type_id == type_id) return lump;
    }
    return null;
}

pub fn decodeRle8(allocator: std.mem.Allocator, bytes: []const u8) Error!RleGrid {
    if (bytes.len < 12) return Error.RleTooSmall;
    const width = readU32(bytes, 0);
    const height = readU32(bytes, 4);
    const pair_count = readU32(bytes, 8);
    const payload_end = 12 + @as(usize, pair_count) * 3;
    if (payload_end > bytes.len) return Error.RleTruncated;
    const total = std.math.mul(usize, @as(usize, width), @as(usize, height)) catch return Error.RleSizeOverflow;
    const values = allocator.alloc(?u16, total) catch return Error.RleSizeOverflow;
    errdefer allocator.free(values);
    @memset(values, null);

    var out_index: usize = 0;
    var at: usize = 12;
    var i: usize = 0;
    while (i < pair_count) : (i += 1) {
        const count = readU16(bytes, at);
        const encoded = bytes[at + 2];
        at += 3;
        const value: ?u16 = if (encoded == 0) null else @as(u16, encoded) - 1;
        var n: usize = 0;
        while (n < count and out_index < values.len) : (n += 1) {
            values[out_index] = value;
            out_index += 1;
        }
    }
    return .{ .width = width, .height = height, .values = values };
}

pub fn decodeRle16(allocator: std.mem.Allocator, bytes: []const u8) Error!RleGrid {
    if (bytes.len < 12) return Error.RleTooSmall;
    const width = readU32(bytes, 0);
    const height = readU32(bytes, 4);
    const pair_count = readU32(bytes, 8);
    const payload_end = 12 + @as(usize, pair_count) * 4;
    if (payload_end > bytes.len) return Error.RleTruncated;
    const total = std.math.mul(usize, @as(usize, width), @as(usize, height)) catch return Error.RleSizeOverflow;
    const values = allocator.alloc(?u16, total) catch return Error.RleSizeOverflow;
    errdefer allocator.free(values);
    @memset(values, null);

    var out_index: usize = 0;
    var at: usize = 12;
    var i: usize = 0;
    while (i < pair_count) : (i += 1) {
        const count = readU16(bytes, at);
        const encoded = readU16(bytes, at + 2);
        at += 4;
        const value: ?u16 = if (encoded == 0) null else encoded - 1;
        var n: usize = 0;
        while (n < count and out_index < values.len) : (n += 1) {
            values[out_index] = value;
            out_index += 1;
        }
    }
    return .{ .width = width, .height = height, .values = values };
}
