//! sim/rng.zig — seeded xoshiro RNG for the shitcoin sim.

const std = @import("std");

pub const Rng = struct {
    prng: std.Random.Xoshiro256,

    pub fn init(seed: u64) Rng {
        return .{ .prng = std.Random.Xoshiro256.init(seed) };
    }

    pub fn float(self: *Rng) f64 {
        return self.prng.random().float(f64);
    }

    pub fn signed(self: *Rng) f64 {
        return self.float() * 2.0 - 1.0;
    }
};
