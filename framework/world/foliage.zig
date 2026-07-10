//! foliage.zig — the FIXED foliage population SYSTEM (FOLIAGEFORMULA).
//!
//! GUIDING_LIGHT: store the recipe, not the dense form. Grass/bush/palm cover is a
//! pure deterministic FORMULA — each blade's transform is a hash of (cell, blade
//! index, seed). Baking ~1M expanded blade rows into the game-file is storing the
//! product of a formula whose factors are a few KB (req_1588: foliage was 99.4% of
//! the instances / 56MB of a 70MB file). So the artifact ships only the RECIPE (which
//! cells carry which foliage kind + the spec), and THIS fixed system — shared by the
//! no-V8 game loader AND, via a door, the V8 editor preview — expands it at load.
//!
//! This is the Zig twin of render3d/grassPopulation.ts `emitClump`; it MUST stay
//! bit-for-bit identical (same hash, same arithmetic order, same f32 store) so the
//! compiled world looks exactly like the editor preview and like the old baked rows.
//! The parity test below asserts that against golden values generated from the TS
//! source (see /tmp/foliage_golden.js in the authoring commit).

const std = @import("std");

/// 32-bit integer hash — the twin of game/kinds/scatter.ts `mix`. JS `Math.imul`
/// is a signed 32-bit multiply; the low-32 bit pattern equals Zig's u32 `*%`.
pub fn mix(a: u32) u32 {
    var h: u32 = a;
    h = (h ^ (h >> 16)) *% 0x45d9f3b;
    h = (h ^ (h >> 16)) *% 0x45d9f3b;
    return h ^ (h >> 16);
}

/// hash → uniform [0,1) — twin of scatter.ts `unit`. Computed in f64 to match the
/// JS double pipeline exactly; the caller narrows the final transform to f32.
pub fn unit(h: u32) f64 {
    return @as(f64, @floatFromInt(h >> 8)) / @as(f64, 0x1000000);
}

inline fn lerp(a: f64, b: f64, t: f64) f64 {
    return a + (b - a) * t;
}

inline fn rgb(comptime r: f64, comptime g: f64, comptime b: f64) [3]f64 {
    return .{ r, g, b };
}

/// The flora recipe vocabulary shared by the editor painter, compiled loader,
/// and live preview. Numeric values are the persisted/wire contract: existing
/// ids 0...3 never move; new kinds append. Unknown ids are rejected at the
/// boundary rather than silently turning into grass.
pub const Spec = enum(u8) {
    grass = 0,
    bush = 1,
    flowers = 2,
    palm = 3,
    pine = 4,
    maple = 5,
    oak = 6,
    cedar = 7,
    spruce = 8,
    tall_grass = 9,
    reeds = 10,
    low_bush = 11,
    dense_bush = 12,
};

pub const SPEC_MAX: u8 = @intFromEnum(Spec.dense_bush);

pub fn specFromWire(value: u16) ?Spec {
    return switch (value) {
        0 => .grass,
        1 => .bush,
        2 => .flowers,
        3 => .palm,
        4 => .pine,
        5 => .maple,
        6 => .oak,
        7 => .cedar,
        8 => .spruce,
        9 => .tall_grass,
        10 => .reeds,
        11 => .low_bush,
        12 => .dense_bush,
        else => null,
    };
}

pub const TreeSpecies = enum(u8) { pine, maple, oak, cedar, spruce };
pub const TREE_SPECIES_COUNT: usize = @intFromEnum(TreeSpecies.spruce) + 1;

pub fn treeSpecies(spec: Spec) ?TreeSpecies {
    return switch (spec) {
        .pine => .pine,
        .maple => .maple,
        .oak => .oak,
        .cedar => .cedar,
        .spruce => .spruce,
        else => null,
    };
}

pub fn treeSpec(species: TreeSpecies) Spec {
    return switch (species) {
        .pine => .pine,
        .maple => .maple,
        .oak => .oak,
        .cedar => .cedar,
        .spruce => .spruce,
    };
}

/// A foliage population spec — the tunable config a painted cell rolls its clump
/// from. Mirrors GRASS_CONFIG / BUSH_CONFIG (render3d/grassPopulation.ts). Values
/// are f64 so the arithmetic matches the JS doubles before the f32 store.
pub const FoliageConfig = struct {
    height_min: f64,
    height_max: f64,
    width_min: f64,
    width_max: f64,
    root_lo: [3]f64,
    root_hi: [3]f64,
};

/// The registered grass globals (GRASS_CONFIG). Kept in lockstep with the TS table;
/// when /settings tuning ships in the recipe these become per-bake values.
pub const GRASS = FoliageConfig{
    .height_min = 0.26,
    .height_max = 0.55,
    .width_min = 0.8,
    .width_max = 1.35,
    .root_lo = rgb(0.16, 0.26, 0.10),
    .root_hi = rgb(0.27, 0.40, 0.16),
};

/// The registered bush globals (BUSH_CONFIG).
pub const BUSH = FoliageConfig{
    .height_min = 0.7,
    .height_max = 1.6,
    .width_min = 1.4,
    .width_max = 2.4,
    .root_lo = rgb(0.12, 0.22, 0.08),
    .root_hi = rgb(0.22, 0.38, 0.14),
};

/// Shape variants that still share the grass/bush meshes and 24-byte slim
/// pipeline. Their differences are authored tuning data, not literals hidden
/// in the population walk.
pub const TALL_GRASS = FoliageConfig{
    .height_min = 0.65,
    .height_max = 1.25,
    .width_min = 0.42,
    .width_max = 0.78,
    .root_lo = rgb(0.12, 0.24, 0.07),
    .root_hi = rgb(0.24, 0.38, 0.12),
};

pub const REEDS = FoliageConfig{
    .height_min = 1.1,
    .height_max = 2.1,
    .width_min = 0.22,
    .width_max = 0.46,
    .root_lo = rgb(0.20, 0.24, 0.08),
    .root_hi = rgb(0.42, 0.44, 0.16),
};

pub const LOW_BUSH = FoliageConfig{
    .height_min = 0.38,
    .height_max = 0.75,
    .width_min = 2.0,
    .width_max = 3.2,
    .root_lo = rgb(0.10, 0.20, 0.07),
    .root_hi = rgb(0.18, 0.34, 0.12),
};

pub const DENSE_BUSH = FoliageConfig{
    .height_min = 1.0,
    .height_max = 2.1,
    .width_min = 1.8,
    .width_max = 3.0,
    .root_lo = rgb(0.07, 0.17, 0.06),
    .root_hi = rgb(0.16, 0.31, 0.11),
};

pub const BladeFamily = enum { grass, bush };

pub const BladePopulation = struct {
    family: BladeFamily,
    config: *const FoliageConfig,
};

pub fn bladePopulation(spec: Spec) ?BladePopulation {
    return switch (spec) {
        .grass => .{ .family = .grass, .config = &GRASS },
        .bush => .{ .family = .bush, .config = &BUSH },
        .tall_grass => .{ .family = .grass, .config = &TALL_GRASS },
        .reeds => .{ .family = .grass, .config = &REEDS },
        .low_bush => .{ .family = .bush, .config = &LOW_BUSH },
        .dense_bush => .{ .family = .bush, .config = &DENSE_BUSH },
        else => null,
    };
}

/// stride-12 instance row: px,py,pz, rx,ry,rz(deg), sx,sy,sz, cr,cg,cb
/// (framework/gpu/3d.zig makeInstance layout — identical to the foliage field
/// the bake/editor produce).
pub const STRIDE = 12;

/// Emit blade `k` of the clump at painted cell (wx,wz,top) seeded by `cell_key`,
/// in a `c`-metre cell. Twin of emitClump's inner loop body. Computes in f64 and
/// narrows each component to f32 (matching the Float32Array store / Math.fround).
pub fn bladeRow(cfg: *const FoliageConfig, wx: f64, wz: f64, top: f64, c: f64, cell_key: u32, k: u32) [STRIDE]f32 {
    const cell_seed = mix(cell_key);
    const h0 = mix(cell_seed ^ ((k +% 1) *% 0x9e3779b9));
    const h1 = mix(h0 ^ 0x68bc21eb);
    const h2 = mix(h1 ^ 0x7feb352d);
    const h3 = mix(h2 ^ 0x846ca68b);
    const px = wx + (unit(h0) - 0.5) * c;
    const pz = wz + (unit(h1) - 0.5) * c;
    const yaw = unit(h2) * 360.0;
    const height = lerp(cfg.height_min, cfg.height_max, unit(h3));
    const width_scale = lerp(cfg.width_min, cfg.width_max, unit(mix(h3 ^ 0x9b)));
    const tint = unit(mix(h2 ^ 0x51));
    const cr = lerp(cfg.root_lo[0], cfg.root_hi[0], tint);
    const cg = lerp(cfg.root_lo[1], cfg.root_hi[1], tint);
    const cb = lerp(cfg.root_lo[2], cfg.root_hi[2], tint);
    return .{
        @floatCast(px),         @floatCast(top),         @floatCast(pz),
        0,                      @floatCast(yaw),         0,
        @floatCast(width_scale), @floatCast(height),     @floatCast(width_scale),
        @floatCast(cr),         @floatCast(cg),          @floatCast(cb),
    };
}

/// Flower head population (FLOWER_CONFIG in grassPopulation.ts). A 'grassFlowers'
/// cell rolls a few colored blossom cards at blade-tip height — its own roll seed
/// + palette, so flowers don't collapse onto the grass-blade positions.
pub const FlowerConfig = struct {
    density: u32,
    height_min: f64,
    height_max: f64,
    radius_min: f64,
    radius_max: f64,
    tip_tuck: f64,
    grass_height_min: f64,
    grass_height_max: f64,
    palette: [4][3]f64,
};

pub const FLOWER = FlowerConfig{
    .density = 4,
    .height_min = 0.32,
    .height_max = 0.52,
    .radius_min = 0.035,
    .radius_max = 0.075,
    .tip_tuck = 0.5,
    .grass_height_min = 0.26, // GRASS_CONFIG.height.min/max — flowers clamp to the canopy
    .grass_height_max = 0.55,
    .palette = .{ rgb(0.95, 0.35, 0.68), rgb(1.0, 0.82, 0.24), rgb(0.92, 0.88, 0.76), rgb(0.55, 0.36, 0.9) },
};

/// Emit flower head `k` of the clump at (wx,wz,top). Bit-exact twin of
/// grassPopulation.ts buildFlowerInstances `emitHead` (own cellSeed ^ 0x54f4c5a7,
/// 0.9·c jitter, blossom radius as uniform scale, palette pick). Stride-12 row.
pub fn flowerRow(cfg: *const FlowerConfig, wx: f64, wz: f64, top: f64, c: f64, cell_key: u32, k: u32) [STRIDE]f32 {
    const cell_seed = mix(cell_key ^ 0x54f4c5a7);
    const h0 = mix(cell_seed ^ ((k +% 1) *% 0x9e3779b9));
    const h1 = mix(h0 ^ 0x68bc21eb);
    const h2 = mix(h1 ^ 0x7feb352d);
    const h3 = mix(h2 ^ 0x846ca68b);
    const px = wx + (unit(h0) - 0.5) * c * 0.9;
    const pz = wz + (unit(h1) - 0.5) * c * 0.9;
    const radius = lerp(cfg.radius_min, cfg.radius_max, unit(h2));
    const stem_height = lerp(cfg.height_min, cfg.height_max, unit(h3));
    const canopy_height = cfg.grass_height_max - radius * cfg.tip_tuck;
    const py = top + @max(cfg.grass_height_min, @min(stem_height, canopy_height));
    const ci: usize = @intFromFloat(@floor(unit(mix(h3 ^ 0x91)) * 4.0));
    const color = cfg.palette[@min(ci, 3)];
    const yaw = unit(mix(h2 ^ 0x51)) * 360.0;
    return .{
        @floatCast(px),       @floatCast(py),       @floatCast(pz),
        0,                    @floatCast(yaw),      0,
        @floatCast(radius),   @floatCast(radius),   @floatCast(radius),
        @floatCast(color[0]), @floatCast(color[1]), @floatCast(color[2]),
    };
}

/// Palm crown population (PALM_CONFIG in palmPopulation.ts). A spawned palm's frond
/// crown — two rings (drooping outer + steeper inner) radiating from the trunk top.
/// Trunks stay baked as distinct meshes (req_1861); only the fronds recipe-ize here.
pub const PalmConfig = struct {
    trunk_h_min: f64,
    trunk_h_max: f64,
    fronds_min: f64,
    fronds_max: f64,
    frond_len_min: f64,
    frond_len_max: f64,
    root_lo: [3]f64,
    root_hi: [3]f64,
};

pub const PALM = PalmConfig{
    .trunk_h_min = 4.2,
    .trunk_h_max = 7.0,
    .fronds_min = 12,
    .fronds_max = 18,
    .frond_len_min = 3.0,
    .frond_len_max = 4.2,
    .root_lo = rgb(0.1, 0.3, 0.15),
    .root_hi = rgb(0.16, 0.4, 0.18),
};

/// The per-palm crown shape, derived once per spawned cell (twin of buildPalmInstances'
/// per-cell body — minus the density gate, which the bake applies before shipping the cell).
pub const PalmCrown = struct {
    px: f64,
    pz: f64,
    top_y: f64,
    frond_len: f64,
    root: [3]f64,
    outer: u32, // drooping ring frond count
    inner: u32, // steeper inner ring count = max(5, round(outer*0.6))
    pub fn total(self: *const PalmCrown) u32 {
        return self.outer + self.inner;
    }
};

pub fn palmCrown(cfg: *const PalmConfig, wx: f64, wz: f64, top: f64, c: f64, cell_key: u32) PalmCrown {
    const seed = mix(cell_key ^ 0x9d2c5680);
    const h0 = mix(seed ^ 0x1b56c4e9);
    const h1 = mix(h0 ^ 0x68bc21eb);
    const h2 = mix(h1 ^ 0x7feb352d);
    const h3 = mix(h2 ^ 0x846ca68b);
    const trunk_h = lerp(cfg.trunk_h_min, cfg.trunk_h_max, unit(h0));
    const outer: u32 = @intFromFloat(@round(lerp(cfg.fronds_min, cfg.fronds_max, unit(h2))));
    const frond_len = lerp(cfg.frond_len_min, cfg.frond_len_max, unit(h3));
    const px = wx + (unit(mix(h0 ^ 0xa5)) - 0.5) * c * 0.7;
    const pz = wz + (unit(mix(h1 ^ 0xa5)) - 0.5) * c * 0.7;
    const inner_raw: i64 = @intFromFloat(@round(@as(f64, @floatFromInt(outer)) * 0.6));
    return .{
        .px = px,
        .pz = pz,
        .top_y = top + trunk_h,
        .frond_len = frond_len,
        .root = .{
            lerp(cfg.root_lo[0], cfg.root_hi[0], unit(mix(h3 ^ 0x9b))),
            lerp(cfg.root_lo[1], cfg.root_hi[1], unit(mix(h3 ^ 0x9c))),
            lerp(cfg.root_lo[2], cfg.root_hi[2], unit(mix(h3 ^ 0x9d))),
        },
        .outer = outer,
        .inner = @intCast(@max(@as(i64, 5), inner_raw)),
    };
}

/// Frond `k` (0..crown.total()) — outer ring then inner ring. Twin of crownRing's body
/// for whichever ring k falls in (yaw/pitch/length jitter by index). Stride-12 row.
pub fn palmFrondRow(crown: *const PalmCrown, k: u32) [STRIDE]f32 {
    const outer = k < crown.outer;
    const ring_count: u32 = if (outer) crown.outer else crown.inner;
    const ring_top_y: f64 = if (outer) crown.top_y else crown.top_y + crown.frond_len * 0.12;
    const ring_len: f64 = if (outer) crown.frond_len else crown.frond_len * 0.62;
    const pitch_base: f64 = if (outer) 40 else 18;
    const i: u32 = if (outer) k else k - crown.outer;
    const yaw = (@as(f64, @floatFromInt(i)) / @as(f64, @floatFromInt(ring_count))) * 360.0 + @as(f64, @floatFromInt(i % 2)) * 14.0;
    const pitch = pitch_base + @as(f64, @floatFromInt(i % 3)) * 12.0;
    const len = ring_len * (0.8 + 0.2 * (@as(f64, @floatFromInt((i * 7) % 5)) / 4.0));
    const wide = len * 0.55;
    return .{
        @floatCast(crown.px),     @floatCast(ring_top_y),   @floatCast(crown.pz),
        @floatCast(pitch),        @floatCast(yaw),          0,
        @floatCast(wide),         @floatCast(len),          @floatCast(wide),
        @floatCast(crown.root[0]), @floatCast(crown.root[1]), @floatCast(crown.root[2]),
    };
}

/// One whole non-palm tree is ONE slim foliage instance. The shared baked mesh
/// contains its trunk, branches, and wrapped canopy; this row supplies only the
/// deterministic transform and leaf tint. The GPU pack therefore remains the
/// existing 24-byte SlimInstance regardless of how detailed the shared mesh is.
pub const TreeConfig = struct {
    height_min: f64,
    height_max: f64,
    crown_radius_min: f64,
    crown_radius_max: f64,
    root_lo: [3]f64,
    root_hi: [3]f64,
    seed_salt: u32,
};

pub const TREE_CONFIGS: [TREE_SPECIES_COUNT]TreeConfig = .{
    // Pacific Northwest silhouettes, kept below the slim pack's 16 m scale
    // ceiling. Mature giants remain authored props; painted forests use this
    // urban/wildland band so the compact instance contract stays exact.
    .{
        .height_min = 10.5,
        .height_max = 15.5,
        .crown_radius_min = 3.1,
        .crown_radius_max = 4.5,
        .root_lo = rgb(0.055, 0.18, 0.075),
        .root_hi = rgb(0.12, 0.30, 0.12),
        .seed_salt = 0x7a6f13d1,
    },
    .{
        .height_min = 8.5,
        .height_max = 13.0,
        .crown_radius_min = 3.5,
        .crown_radius_max = 5.2,
        .root_lo = rgb(0.13, 0.28, 0.08),
        .root_hi = rgb(0.28, 0.48, 0.12),
        .seed_salt = 0x4d41504c,
    },
    .{
        .height_min = 9.5,
        .height_max = 15.0,
        .crown_radius_min = 4.2,
        .crown_radius_max = 6.2,
        .root_lo = rgb(0.10, 0.24, 0.07),
        .root_hi = rgb(0.24, 0.42, 0.11),
        .seed_salt = 0x0a4b51d3,
    },
    .{
        .height_min = 11.0,
        .height_max = 15.5,
        .crown_radius_min = 2.6,
        .crown_radius_max = 3.8,
        .root_lo = rgb(0.045, 0.16, 0.11),
        .root_hi = rgb(0.10, 0.28, 0.17),
        .seed_salt = 0xce4da219,
    },
    .{
        .height_min = 10.0,
        .height_max = 15.5,
        .crown_radius_min = 3.3,
        .crown_radius_max = 4.8,
        .root_lo = rgb(0.035, 0.13, 0.095),
        .root_hi = rgb(0.085, 0.24, 0.15),
        .seed_salt = 0x5f2c7e91,
    },
};

const TREE_CELL_JITTER: f64 = 0.72;

pub fn treeConfig(species: TreeSpecies) *const TreeConfig {
    return &TREE_CONFIGS[@intFromEnum(species)];
}

pub fn treeSeed(species: TreeSpecies, cell_key: u32) u32 {
    return mix(cell_key ^ treeConfig(species).seed_salt);
}

pub fn treeSpawnRoll(species: TreeSpecies, cell_key: u32) f64 {
    return unit(treeSeed(species, cell_key));
}

pub fn treeRow(species: TreeSpecies, wx: f64, wz: f64, top: f64, c: f64, cell_key: u32) [STRIDE]f32 {
    const cfg = treeConfig(species);
    const seed = treeSeed(species, cell_key);
    const h0 = mix(seed ^ 0x1b56c4e9);
    const h1 = mix(h0 ^ 0x68bc21eb);
    const h2 = mix(h1 ^ 0x7feb352d);
    const h3 = mix(h2 ^ 0x846ca68b);
    const height = lerp(cfg.height_min, cfg.height_max, unit(h0));
    const radius = lerp(cfg.crown_radius_min, cfg.crown_radius_max, unit(h1));
    const px = wx + (unit(mix(h0 ^ 0xa5)) - 0.5) * c * TREE_CELL_JITTER;
    const pz = wz + (unit(mix(h1 ^ 0xa5)) - 0.5) * c * TREE_CELL_JITTER;
    const yaw = unit(h2) * 360.0;
    const tint = unit(h3);
    const root = [3]f64{
        lerp(cfg.root_lo[0], cfg.root_hi[0], tint),
        lerp(cfg.root_lo[1], cfg.root_hi[1], tint),
        lerp(cfg.root_lo[2], cfg.root_hi[2], tint),
    };
    return .{
        @floatCast(px),      @floatCast(top),     @floatCast(pz),
        0,                   @floatCast(yaw),     0,
        @floatCast(radius),  @floatCast(height),  @floatCast(radius),
        @floatCast(root[0]), @floatCast(root[1]), @floatCast(root[2]),
    };
}

// ── parity against the TS source (golden values from /tmp/foliage_golden.js) ──
test "mix matches scatter.ts mix" {
    try std.testing.expectEqual(@as(u32, 0), mix(0));
    try std.testing.expectEqual(@as(u32, 824515495), mix(1));
    try std.testing.expectEqual(@as(u32, 1747545881), mix(12345));
    try std.testing.expectEqual(@as(u32, 3108667723), mix(0x9e3779b9));
    try std.testing.expectEqual(@as(u32, 539527247), mix(0xffffffff));
}

test "bladeRow matches grassPopulation.ts emitClump (grass, cell 12345)" {
    const golden = [3][STRIDE]f32{
        .{ 10.746906280517578, 2, 20.041458129882812, 0, 256.31640625, 0, 0.8377671241760254, 0.3651975095272064, 0.8377671241760254, 0.22520025074481964, 0.34298214316368103, 0.13556377589702606 },
        .{ 10.462559700012207, 2, 20.118112564086914, 0, 330.4200744628906, 0, 1.3092083930969238, 0.30311331152915955, 1.3092083930969238, 0.24227553606033325, 0.3647143244743347, 0.1448775678873062 },
        .{ 10.519265174865723, 2, 20.76885414123535, 0, 54.92479705810547, 0, 0.8978322148323059, 0.4657551348209381, 0.8978322148323059, 0.1741386502981186, 0.27799463272094727, 0.10771198570728302 },
    };
    var k: u32 = 0;
    while (k < 3) : (k += 1) {
        const row = bladeRow(&GRASS, 10.5, 20.5, 2.0, 1.0, 12345, k);
        for (row, golden[k]) |got, want| {
            try std.testing.expectEqual(want, got);
        }
    }
}

test "flowerRow matches grassPopulation.ts buildFlowerInstances emitHead (cell 12345)" {
    const golden = [3][STRIDE]f32{
        .{ 10.725759506225586, 2.4573845863342285, 20.808073043823242, 0, 243.3610076904297, 0, 0.03575613349676132, 0.03575613349676132, 0.03575613349676132, 1, 0.8199999928474426, 0.23999999463558197 },
        .{ 10.339483261108398, 2.3936259746551514, 20.560565948486328, 0, 239.36659240722656, 0, 0.06389902532100677, 0.06389902532100677, 0.06389902532100677, 1, 0.8199999928474426, 0.23999999463558197 },
        .{ 10.368546485900879, 2.4676008224487305, 20.092653274536133, 0, 211.04710388183594, 0, 0.06995167583227158, 0.06995167583227158, 0.06995167583227158, 0.9200000166893005, 0.8799999952316284, 0.7599999904632568 },
    };
    var k: u32 = 0;
    while (k < 3) : (k += 1) {
        const row = flowerRow(&FLOWER, 10.5, 20.5, 2.0, 1.0, 12345, k);
        for (row, golden[k]) |got, want| {
            try std.testing.expectEqual(want, got);
        }
    }
}

test "palmFrondRow matches palmPopulation.ts crown (cell 12345)" {
    const crown = palmCrown(&PALM, 10.5, 20.5, 2.0, 1.0, 12345);
    try std.testing.expectEqual(@as(u32, 22), crown.total()); // 14 outer + 8 inner
    // golden: frond 0, 1, and the last (21)
    const want = [3][STRIDE]f32{
        .{ 10.291945457458496, 7.441481113433838, 20.42505645751953, 40, 0, 0, 1.3557775020599365, 2.465049982070923, 1.3557775020599365, 0.13072878122329712, 0.3507298231124878, 0.15855048596858978 },
        .{ 10.291945457458496, 7.441481113433838, 20.42505645751953, 52, 39.71428680419922, 0, 1.525249719619751, 2.773181200027466, 1.525249719619751, 0.13072878122329712, 0.3507298231124878, 0.15855048596858978 },
        .{ 10.291945457458496, 7.811238765716553, 20.42505645751953, 30, 329, 0, 1.0507276058197021, 1.9104137420654297, 1.0507276058197021, 0.13072878122329712, 0.3507298231124878, 0.15855048596858978 },
    };
    const ks = [3]u32{ 0, 1, 21 };
    for (ks, want) |kk, golden_row| {
        const row = palmFrondRow(&crown, kk);
        for (row, golden_row) |got, w| try std.testing.expectEqual(w, got);
    }
}

test "flora spec wire ids are append-only and reject unknown content" {
    try std.testing.expectEqual(Spec.grass, specFromWire(0).?);
    try std.testing.expectEqual(Spec.palm, specFromWire(3).?);
    try std.testing.expectEqual(Spec.pine, specFromWire(4).?);
    try std.testing.expectEqual(Spec.spruce, specFromWire(8).?);
    try std.testing.expectEqual(Spec.dense_bush, specFromWire(SPEC_MAX).?);
    try std.testing.expect(specFromWire(SPEC_MAX + 1) == null);
    try std.testing.expect(specFromWire(std.math.maxInt(u16)) == null);
}

test "whole-tree rows stay inside the 24-byte slim instance scale contract" {
    for (TREE_CONFIGS, 0..) |cfg, i| {
        try std.testing.expect(cfg.height_min > 0);
        try std.testing.expect(cfg.height_max >= cfg.height_min);
        try std.testing.expect(cfg.height_max < 16.0);
        try std.testing.expect(cfg.crown_radius_min > 0);
        try std.testing.expect(cfg.crown_radius_max >= cfg.crown_radius_min);
        try std.testing.expect(cfg.crown_radius_max < 16.0);
        const species: TreeSpecies = @enumFromInt(i);
        const row = treeRow(species, 10.5, 20.5, 2.0, 1.0, 12345);
        try std.testing.expect(row[0] >= 10.14 and row[0] <= 10.86);
        try std.testing.expectEqual(@as(f32, 2), row[1]);
        try std.testing.expect(row[2] >= 20.14 and row[2] <= 20.86);
        try std.testing.expect(row[4] >= 0 and row[4] < 360);
        try std.testing.expect(row[6] >= @as(f32, @floatCast(cfg.crown_radius_min)));
        try std.testing.expect(row[6] <= @as(f32, @floatCast(cfg.crown_radius_max)));
        try std.testing.expect(row[7] >= @as(f32, @floatCast(cfg.height_min)));
        try std.testing.expect(row[7] <= @as(f32, @floatCast(cfg.height_max)));
        try std.testing.expectEqual(row[6], row[8]);
    }
}
