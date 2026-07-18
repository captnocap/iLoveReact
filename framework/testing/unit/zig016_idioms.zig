//! Compiler-contract tests for language forms adopted in Zig 0.16.

const std = @import("std");

test "unary float builtins forward their result type" {
    const square: u24 = 144;
    const root: f32 = @sqrt(@floatFromInt(square));

    try std.testing.expectEqual(@as(f32, 12), root);
}

test "rounding builtins directly produce integers" {
    const floored: i8 = @floor(@as(f32, -12.25));
    const ceiled: i8 = @ceil(@as(f32, -12.25));
    const rounded: u8 = @round(@as(f32, 12.5));
    const truncated: i8 = @trunc(@as(f32, -12.75));

    try std.testing.expectEqual(@as(i8, -13), floored);
    try std.testing.expectEqual(@as(i8, -12), ceiled);
    try std.testing.expectEqual(@as(u8, 13), rounded);
    try std.testing.expectEqual(@as(i8, -12), truncated);
}

test "exactly representable small integers coerce to floats" {
    const small: u24 = std.math.maxInt(u24);
    const medium: u32 = std.math.maxInt(u32);
    const as_f32: f32 = small;
    const as_f64: f64 = medium;

    try std.testing.expectEqual(@as(f32, 16_777_215), as_f32);
    try std.testing.expectEqual(@as(f64, 4_294_967_295), as_f64);
}

test "0.16 type-construction builtins are available" {
    const PackedIndex = @Int(.unsigned, 10);
    const scope: @EnumLiteral() = .zig016;

    try std.testing.expectEqual(@as(PackedIndex, 1023), 1023);
    try std.testing.expectEqualStrings("zig016", @tagName(scope));
}
