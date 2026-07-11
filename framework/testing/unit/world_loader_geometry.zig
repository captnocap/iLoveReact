//! Procedural geometry contract for the split world loader.
//!
//! Run: zig build test-world-loader

const std = @import("std");
const geometry = @import("world_loader_geometry");

fn fingerprint(value: anytype) u64 {
    return std.hash.Wyhash.hash(0, std.mem.asBytes(&value));
}

test "procedural meshes retain their parity fingerprints" {
    const cube = geometry.buildCube();
    const ramp = geometry.buildRampSlab(0.2 / 3.0);
    const gable = geometry.buildGablePrism();
    const grass = geometry.buildGrassBlade();
    const frond = geometry.buildFrond();
    const palm = geometry.buildPalmTrunk();

    try std.testing.expectEqual(@as(u64, 0x15ba25a788de410d), fingerprint(cube));
    try std.testing.expectEqual(@as(u64, 0x1ba3c2c7f0d240cf), fingerprint(ramp));
    try std.testing.expectEqual(@as(u64, 0xfc0ad8158c5abc23), fingerprint(gable));
    try std.testing.expectEqual(@as(u64, 0xf11883bbc48d3221), fingerprint(grass));
    try std.testing.expectEqual(@as(u64, 0x3f2152c260b1e453), fingerprint(frond));
    try std.testing.expectEqual(@as(u64, 0xfac5ce537bfd9016), fingerprint(palm));
}

test "cube topology stays normalized and finite" {
    const cube = geometry.buildCube();
    try std.testing.expectEqual(@as(usize, 36 * 8), cube.len);
    var vertex: usize = 0;
    while (vertex < 36) : (vertex += 1) {
        const at = vertex * 8;
        const nx = cube[at + 3];
        const ny = cube[at + 4];
        const nz = cube[at + 5];
        try std.testing.expectApproxEqAbs(@as(f32, 1), @sqrt(nx * nx + ny * ny + nz * nz), 0.00001);
        for (cube[at .. at + 8]) |component| try std.testing.expect(std.math.isFinite(component));
    }
}
