const std = @import("std");
const paint_ops = @import("paint_ops");

const Stream = struct {
    bytes: std.ArrayList(u8) = .empty,

    fn deinit(stream: *Stream) void {
        stream.bytes.deinit(std.testing.allocator);
    }

    fn op(stream: *Stream, tag: u8, operands: []const u8) !void {
        try stream.bytes.append(std.testing.allocator, tag);
        try stream.bytes.appendSlice(std.testing.allocator, operands);
    }

    fn inkColor(stream: *Stream, rgb: [3]u8) !void {
        try stream.op(paint_ops.OP_INK_COLOR, &rgb);
    }

    fn inkMaterial(stream: *Stream, idx: u16) !void {
        var operands: [2]u8 = undefined;
        std.mem.writeInt(u16, &operands, idx, .little);
        try stream.op(paint_ops.OP_INK_MATERIAL, &operands);
    }

    fn fill(stream: *Stream, group: u32, ord: u32) !void {
        var operands: [8]u8 = undefined;
        std.mem.writeInt(u32, operands[0..4], group, .little);
        std.mem.writeInt(u32, operands[4..8], ord, .little);
        try stream.op(paint_ops.OP_FILL, &operands);
    }

    fn dab(stream: *Stream, group: u32, ord: u32) !void {
        var operands = [_]u8{0} ** 24;
        std.mem.writeInt(u32, operands[0..4], group, .little);
        std.mem.writeInt(u32, operands[4..8], ord, .little);
        try stream.op(paint_ops.OP_DAB, &operands);
    }

    fn shapedDab(stream: *Stream, group: u32, ord: u32) !void {
        var operands = [_]u8{0} ** 44;
        std.mem.writeInt(u32, operands[0..4], group, .little);
        std.mem.writeInt(u32, operands[4..8], ord, .little);
        try stream.op(paint_ops.OP_DAB_SHAPED, &operands);
    }
};

test "empty stream has no redundant fills" {
    const offsets = try paint_ops.redundantFillOffsets(std.testing.allocator, &.{});
    defer std.testing.allocator.free(offsets);
    try std.testing.expectEqualSlices(usize, &.{}, offsets);
}

test "repeated fill reports the first tag offset" {
    var stream = Stream{};
    defer stream.deinit();
    try stream.inkColor(.{ 1, 2, 3 });
    try stream.fill(1, 0);
    try stream.fill(1, 0);

    const offsets = try paint_ops.redundantFillOffsets(std.testing.allocator, stream.bytes.items);
    defer std.testing.allocator.free(offsets);
    try std.testing.expectEqualSlices(usize, &.{4}, offsets);
}

test "interleaved face keys retain only each last fill" {
    var stream = Stream{};
    defer stream.deinit();
    try stream.fill(1, 0);
    try stream.fill(2, 0);
    try stream.fill(1, 0);

    const offsets = try paint_ops.redundantFillOffsets(std.testing.allocator, stream.bytes.items);
    defer std.testing.allocator.free(offsets);
    try std.testing.expectEqualSlices(usize, &.{0}, offsets);
}

test "ink changes between repeats do not protect fills" {
    var stream = Stream{};
    defer stream.deinit();
    try stream.inkColor(.{ 1, 2, 3 });
    try stream.fill(1, 0);
    try stream.inkMaterial(0);
    try stream.fill(1, 0);

    const offsets = try paint_ops.redundantFillOffsets(std.testing.allocator, stream.bytes.items);
    defer std.testing.allocator.free(offsets);
    try std.testing.expectEqualSlices(usize, &.{4}, offsets);
}

test "dabs interleaved with fills are walked without affecting dedupe" {
    var stream = Stream{};
    defer stream.deinit();
    try stream.fill(1, 0);
    try stream.dab(1, 0);
    try stream.fill(1, 0);

    const offsets = try paint_ops.redundantFillOffsets(std.testing.allocator, stream.bytes.items);
    defer std.testing.allocator.free(offsets);
    try std.testing.expectEqualSlices(usize, &.{0}, offsets);

    var shaped = Stream{};
    defer shaped.deinit();
    try shaped.shapedDab(1, 0);
    try shaped.fill(1, 0);
    try shaped.fill(1, 0);
    const shaped_offsets = try paint_ops.redundantFillOffsets(std.testing.allocator, shaped.bytes.items);
    defer std.testing.allocator.free(shaped_offsets);
    try std.testing.expectEqualSlices(usize, &.{45}, shaped_offsets);
}

test "truncated stream stops after the valid prefix" {
    var stream = Stream{};
    defer stream.deinit();
    try stream.fill(1, 0);
    try stream.fill(1, 0);
    try stream.op(paint_ops.OP_FILL, &.{ 1, 2, 3 });

    const offsets = try paint_ops.redundantFillOffsets(std.testing.allocator, stream.bytes.items);
    defer std.testing.allocator.free(offsets);
    try std.testing.expectEqualSlices(usize, &.{0}, offsets);
}

test "unknown tag stops after the valid prefix" {
    var stream = Stream{};
    defer stream.deinit();
    try stream.fill(1, 0);
    try stream.fill(1, 0);
    try stream.op(0xff, &.{ 3, 1, 4, 1, 5 });

    const offsets = try paint_ops.redundantFillOffsets(std.testing.allocator, stream.bytes.items);
    defer std.testing.allocator.free(offsets);
    try std.testing.expectEqualSlices(usize, &.{0}, offsets);
}

test "operand sizes match the frozen wire format" {
    try std.testing.expectEqual(@as(?usize, 3), paint_ops.operandSize(0));
    try std.testing.expectEqual(@as(?usize, 2), paint_ops.operandSize(1));
    try std.testing.expectEqual(@as(?usize, 24), paint_ops.operandSize(2));
    try std.testing.expectEqual(@as(?usize, 8), paint_ops.operandSize(3));
    try std.testing.expectEqual(@as(?usize, 44), paint_ops.operandSize(4));
    try std.testing.expectEqual(@as(?usize, null), paint_ops.operandSize(9));
}
