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
