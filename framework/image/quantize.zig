//! framework/image/quantize.zig — median-cut palette quantization over raw
//! RGBA. The import-time probe for "should this image live as a palette-indexed
//! PIXEL TEXTURE (tiny, recolorable — palette entries become color slots) or as
//! exact bytes?" Flat art quantizes cleanly (low error, long RLE runs); photos
//! and anti-aliased text don't — the returned mean-squared error IS the
//! decision signal. No dithering, ever: dither scatters near-duplicate colors
//! and destroys the run-length wins (same ruling as the paint stroke-program).
//!
//! Pure CPU, no GPU/wgpu deps. Transparent pixels (a < 128) map to index 0xFF,
//! so palettes are capped at 255 entries.

const std = @import("std");

pub const TRANSPARENT_INDEX: u8 = 0xFF;
pub const MAX_COLORS: u32 = 255;

pub const Result = struct {
    palette: [][3]u8, // <= max_colors entries
    indices: []u8, // w*h, row-major; 0xFF = transparent
    mse: f32, // mean squared RGB error over opaque pixels (0 = exact)

    pub fn deinit(self: Result, alloc: std.mem.Allocator) void {
        alloc.free(self.palette);
        alloc.free(self.indices);
    }
};

const Box = struct {
    start: usize,
    len: usize,
};

fn channelOf(px: u32, ch: u2) u8 {
    return switch (ch) {
        0 => @truncate(px >> 0),
        1 => @truncate(px >> 8),
        2 => @truncate(px >> 16),
        else => 0,
    };
}

/// Widest RGB channel of a box (the split axis), and its range.
fn widestChannel(pixels: []const u32, box: Box) struct { ch: u2, range: u16 } {
    var mins = [3]u8{ 255, 255, 255 };
    var maxs = [3]u8{ 0, 0, 0 };
    for (pixels[box.start .. box.start + box.len]) |px| {
        inline for (0..3) |c| {
            const v = channelOf(px, @intCast(c));
            if (v < mins[c]) mins[c] = v;
            if (v > maxs[c]) maxs[c] = v;
        }
    }
    var best: u2 = 0;
    var best_range: u16 = 0;
    inline for (0..3) |c| {
        const r: u16 = @as(u16, maxs[c]) - @as(u16, mins[c]);
        if (r > best_range) {
            best_range = r;
            best = @intCast(c);
        }
    }
    return .{ .ch = best, .range = best_range };
}

/// Median-cut quantize `rgba` (tight w*h*4) to at most `max_colors` opaque
/// colors. Caller owns the Result (free with deinit).
pub fn quantize(alloc: std.mem.Allocator, rgba: []const u8, w: u32, h: u32, max_colors_req: u32) !Result {
    const count: usize = @as(usize, w) * @as(usize, h);
    if (rgba.len < count * 4 or count == 0) return error.BadInput;
    const max_colors = @min(@max(max_colors_req, 2), MAX_COLORS);

    // Opaque pixels packed as 0x00BBGGRR words for cheap channel access.
    var opaque_px = try alloc.alloc(u32, count);
    defer alloc.free(opaque_px);
    var n_opaque: usize = 0;
    for (0..count) |i| {
        const a = rgba[i * 4 + 3];
        if (a < 128) continue;
        opaque_px[n_opaque] = @as(u32, rgba[i * 4]) | (@as(u32, rgba[i * 4 + 1]) << 8) | (@as(u32, rgba[i * 4 + 2]) << 16);
        n_opaque += 1;
    }

    var palette: std.ArrayListUnmanaged([3]u8) = .empty;
    errdefer palette.deinit(alloc);

    if (n_opaque == 0) {
        // Fully transparent image: empty palette, all indices transparent.
        const indices = try alloc.alloc(u8, count);
        @memset(indices, TRANSPARENT_INDEX);
        return .{ .palette = try palette.toOwnedSlice(alloc), .indices = indices, .mse = 0 };
    }

    const work = opaque_px[0..n_opaque];

    // Median cut: repeatedly split the box with the widest channel range.
    var boxes: std.ArrayListUnmanaged(Box) = .empty;
    defer boxes.deinit(alloc);
    try boxes.append(alloc, .{ .start = 0, .len = n_opaque });
    while (boxes.items.len < max_colors) {
        // Widest-range splittable box wins.
        var pick: ?usize = null;
        var pick_range: u16 = 0;
        var pick_ch: u2 = 0;
        for (boxes.items, 0..) |box, bi| {
            if (box.len < 2) continue;
            const wc = widestChannel(work, box);
            if (wc.range > pick_range) {
                pick_range = wc.range;
                pick_ch = wc.ch;
                pick = bi;
            }
        }
        const bi = pick orelse break;
        if (pick_range == 0) break; // every remaining box is a single color
        const box = boxes.items[bi];
        const slice = work[box.start .. box.start + box.len];
        const ch = pick_ch;
        std.mem.sort(u32, slice, ch, struct {
            fn lessThan(c: u2, a: u32, b: u32) bool {
                return channelOf(a, c) < channelOf(b, c);
            }
        }.lessThan);
        const half = box.len / 2;
        boxes.items[bi] = .{ .start = box.start, .len = half };
        try boxes.append(alloc, .{ .start = box.start + half, .len = box.len - half });
    }

    // Palette = mean color per box.
    for (boxes.items) |box| {
        var sums = [3]u64{ 0, 0, 0 };
        for (work[box.start .. box.start + box.len]) |px| {
            inline for (0..3) |c| sums[c] += channelOf(px, @intCast(c));
        }
        const n: u64 = @max(box.len, 1);
        try palette.append(alloc, .{
            @intCast(sums[0] / n),
            @intCast(sums[1] / n),
            @intCast(sums[2] / n),
        });
    }

    // Remap every pixel to its nearest palette color; accumulate error.
    const indices = try alloc.alloc(u8, count);
    errdefer alloc.free(indices);
    var err_sum: f64 = 0;
    for (0..count) |i| {
        const a = rgba[i * 4 + 3];
        if (a < 128) {
            indices[i] = TRANSPARENT_INDEX;
            continue;
        }
        const r: i32 = rgba[i * 4];
        const g: i32 = rgba[i * 4 + 1];
        const b: i32 = rgba[i * 4 + 2];
        var best: usize = 0;
        var best_d: i64 = std.math.maxInt(i64);
        for (palette.items, 0..) |pc, pi| {
            const dr = r - @as(i32, pc[0]);
            const dg = g - @as(i32, pc[1]);
            const db = b - @as(i32, pc[2]);
            const d: i64 = @as(i64, dr * dr) + @as(i64, dg * dg) + @as(i64, db * db);
            if (d < best_d) {
                best_d = d;
                best = pi;
            }
        }
        indices[i] = @intCast(best);
        err_sum += @floatFromInt(best_d);
    }

    return .{
        .palette = try palette.toOwnedSlice(alloc),
        .indices = indices,
        .mse = @floatCast(err_sum / @as(f64, @floatFromInt(n_opaque))),
    };
}

test "two flat colors quantize exactly" {
    const alloc = std.testing.allocator;
    // 4x1: red, red, blue, blue — all opaque.
    const rgba = [_]u8{
        200, 10, 10, 255, 200, 10, 10, 255,
        10, 10, 200, 255, 10, 10, 200, 255,
    };
    const q = try quantize(alloc, &rgba, 4, 1, 8);
    defer q.deinit(alloc);
    try std.testing.expectEqual(@as(usize, 2), q.palette.len);
    try std.testing.expectEqual(@as(f32, 0), q.mse);
    // Same input color → same index; the two colors get distinct indices.
    try std.testing.expectEqual(q.indices[0], q.indices[1]);
    try std.testing.expectEqual(q.indices[2], q.indices[3]);
    try std.testing.expect(q.indices[0] != q.indices[2]);
}

test "transparent pixels map to the reserved index" {
    const alloc = std.testing.allocator;
    const rgba = [_]u8{
        200, 10, 10, 255, // opaque red
        0, 0, 0, 0, // transparent
    };
    const q = try quantize(alloc, &rgba, 2, 1, 8);
    defer q.deinit(alloc);
    try std.testing.expectEqual(@as(usize, 1), q.palette.len);
    try std.testing.expectEqual(TRANSPARENT_INDEX, q.indices[1]);
    try std.testing.expect(q.indices[0] != TRANSPARENT_INDEX);
}

test "gradient error grows with fewer colors" {
    const alloc = std.testing.allocator;
    // A 64-step red ramp: with 64 colors error is 0; with 4 it is not.
    var rgba: [64 * 4]u8 = undefined;
    for (0..64) |i| {
        rgba[i * 4] = @intCast(i * 4);
        rgba[i * 4 + 1] = 30;
        rgba[i * 4 + 2] = 30;
        rgba[i * 4 + 3] = 255;
    }
    const fine = try quantize(alloc, &rgba, 64, 1, 64);
    defer fine.deinit(alloc);
    const coarse = try quantize(alloc, &rgba, 64, 1, 4);
    defer coarse.deinit(alloc);
    try std.testing.expect(coarse.mse > fine.mse);
    try std.testing.expectEqual(@as(usize, 4), coarse.palette.len);
}
