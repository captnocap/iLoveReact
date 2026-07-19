//! Small wire-boundary invariants shared by the resident mesh owner and RJMD writer.

const std = @import("std");

/// A durable Outliner table is exactly one sorted, non-overlapping [lo,hi) pair
/// per declared part. Extra, missing, empty, or crossed ranges are all corruption.
pub fn rangesValid(pairs: ?[]const u32, expected_count: u32) bool {
    if (expected_count == 0) return pairs == null or pairs.?.len == 0;
    const values = pairs orelse return false;
    const count: usize = @intCast(expected_count);
    if (count > std.math.maxInt(usize) / 2 or values.len != count * 2) return false;
    var previous_hi: u32 = 0;
    for (0..count) |index| {
        const lo = values[index * 2];
        const hi = values[index * 2 + 1];
        if (hi <= lo or (index > 0 and lo < previous_hi)) return false;
        previous_hi = hi;
    }
    return true;
}
