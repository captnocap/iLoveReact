//! hmsc parity compiler: Zig side.
//!
//! Reads the same tiny source spec as cart/hmsc-int/compile/parityGameFile.ts,
//! generates the same deterministic large world, and writes the same platform
//! game-file bytes through framework/world/gamefile_writer.zig.

const std = @import("std");
const writer = @import("world_gamefile_writer");

const Spec = struct {
    width: u32 = 1536,
    height: u32 = 1536,
    seed: u32 = 0x5eed1234,
    asset_count: u32 = 8,
    asset_bytes: u32 = 4096,
};

fn usage() void {
    std.debug.print("usage: hmsc_parity_compile --source <spec> --out <gamefile>\n", .{});
}

fn argValue(args: []const []const u8, name: []const u8) ?[]const u8 {
    for (args, 0..) |arg, i| {
        if (std.mem.eql(u8, arg, name) and i + 1 < args.len) return args[i + 1];
        if (std.mem.startsWith(u8, arg, name) and arg.len > name.len and arg[name.len] == '=') {
            return arg[name.len + 1 ..];
        }
    }
    return null;
}

fn parseSource(text: []const u8) !Spec {
    var spec: Spec = .{};
    var saw_format = false;
    var lines = std.mem.splitScalar(u8, text, '\n');
    while (lines.next()) |raw| {
        const line = std.mem.trim(u8, raw, " \t\r");
        if (line.len == 0 or line[0] == '#') continue;
        const eq = std.mem.indexOfScalar(u8, line, '=') orelse continue;
        const key = line[0..eq];
        const value = line[eq + 1 ..];
        if (std.mem.eql(u8, key, "format")) {
            if (!std.mem.eql(u8, value, "hmsc.parity.v0")) return error.BadSourceFormat;
            saw_format = true;
        } else if (std.mem.eql(u8, key, "width")) {
            spec.width = try std.fmt.parseInt(u32, value, 10);
        } else if (std.mem.eql(u8, key, "height")) {
            spec.height = try std.fmt.parseInt(u32, value, 10);
        } else if (std.mem.eql(u8, key, "seed")) {
            spec.seed = try std.fmt.parseInt(u32, value, 10);
        } else if (std.mem.eql(u8, key, "asset_count")) {
            spec.asset_count = try std.fmt.parseInt(u32, value, 10);
        } else if (std.mem.eql(u8, key, "asset_bytes")) {
            spec.asset_bytes = try std.fmt.parseInt(u32, value, 10);
        }
    }
    if (!saw_format) return error.BadSourceFormat;
    return spec;
}

fn cellHash(x: u32, y: u32, seed: u32) u32 {
    var h = ((x +% 0x9e3779b9) *% 0x85ebca6b) ^ ((y +% 0xc2b2ae35) *% 0x27d4eb2d) ^ seed;
    h ^= h >> 16;
    h *%= 0x7feb352d;
    h ^= h >> 15;
    h *%= 0x846ca68b;
    h ^= h >> 16;
    return h;
}

fn tileValue(spec: *const Spec, x: u32, y: u32) ?u16 {
    if ((x % 64) == 0 or (y % 64) == 0) return 1;
    const h = cellHash(x, y, spec.seed);
    if ((h & 0x3f) == 0) return null;
    return @intCast(2 + (h % 7));
}

fn heightValue(spec: *const Spec, x: u32, y: u32) ?u16 {
    return @intCast(cellHash(x / 4, y / 4, spec.seed ^ 0xa511e9b3) & 0x03ff);
}

fn assetPayload(allocator: std.mem.Allocator, index: u32, bytes: u32, seed: u32) ![]u8 {
    const out = try allocator.alloc(u8, bytes);
    var i: u32 = 0;
    while (i < bytes) : (i += 1) {
        out[i] = @as(u8, @truncate(cellHash(index, i, seed ^ 0x51ed1234)));
    }
    return out;
}

fn compile(allocator: std.mem.Allocator, spec: Spec) ![]u8 {
    const strings =
        "0\tnull\n" ++
        "1\troad\n" ++
        "2\tgrass\n" ++
        "3\tasphalt\n" ++
        "4\tsidewalk\n" ++
        "5\tmud\n" ++
        "6\tsand\n" ++
        "7\twater\n" ++
        "8\tfoliage\n";

    const tiles = try writer.encodeRle16Grid(allocator, spec.width, spec.height, &spec, tileValue);
    defer allocator.free(tiles);
    const heights = try writer.encodeRle16Grid(allocator, spec.width, spec.height, &spec, heightValue);
    defer allocator.free(heights);
    const zones = try std.fmt.allocPrint(
        allocator,
        "{{\"bounds\":{{\"depth\":{d},\"minX\":0,\"minZ\":0,\"width\":{d}}},\"zones\":[]}}",
        .{ spec.height, spec.width },
    );
    defer allocator.free(zones);
    const entities = try std.fmt.allocPrint(
        allocator,
        "format=hmsc.parity.v0\nwidth={d}\nheight={d}\nseed={d}\n",
        .{ spec.width, spec.height, spec.seed },
    );
    defer allocator.free(entities);

    var map_lumps = [_]writer.LumpInput{
        .{ .type_id = writer.MapLump.strings, .encoding = .text, .data = strings },
        .{ .type_id = writer.MapLump.tiles, .encoding = .rle16, .data = tiles },
        .{ .type_id = writer.MapLump.heights, .encoding = .rle16, .data = heights },
        .{ .type_id = writer.MapLump.zones, .encoding = .text, .data = zones },
        .{ .type_id = writer.MapLump.placements, .encoding = .text, .data = "{\"landforms\":[],\"placedCells\":[],\"props\":[]}" },
        .{ .type_id = writer.MapLump.entities, .encoding = .text, .data = entities },
    };
    const map_container = try writer.writeLumpContainer(allocator, map_lumps[0..]);
    defer allocator.free(map_container);

    const asset_count: usize = @intCast(spec.asset_count);
    const assets = try allocator.alloc(writer.AssetInput, asset_count);
    defer allocator.free(assets);
    const refs = try allocator.alloc(u32, asset_count);
    defer allocator.free(refs);
    const payloads = try allocator.alloc([]u8, asset_count);
    defer {
        for (payloads) |payload| allocator.free(payload);
        allocator.free(payloads);
    }

    var i: usize = 0;
    while (i < asset_count) : (i += 1) {
        const idx: u32 = @intCast(i);
        const key = 1000 + idx;
        const payload = try assetPayload(allocator, idx, spec.asset_bytes, spec.seed);
        payloads[i] = payload;
        refs[i] = key;
        assets[i] = .{
            .key = key,
            .kind = @intCast(30 + (idx % 4)),
            .bytes = payload,
            .embed = true,
        };
    }

    const logic = try std.fmt.allocPrint(allocator, "format=hmsc.logic.parity.v0\nseed={d}\n", .{spec.seed});
    defer allocator.free(logic);
    const skins = try std.fmt.allocPrint(allocator, "format=hmsc.skins.parity.v0\nassets={d}\n", .{spec.asset_count});
    defer allocator.free(skins);

    return try writer.writeGameFile(allocator, .{
        .logic = .{ .refs = &.{}, .data = logic },
        .map = .{ .refs = refs, .data = map_container },
        .skins = .{ .refs = &.{}, .data = skins },
        .assets = assets,
    });
}

fn nanoNow() i128 {
    return std.Io.Clock.now(.awake, std.Io.Threaded.global_single_threaded.io()).toNanoseconds();
}

pub fn main(init: std.process.Init) !void {
    const io = std.Io.Threaded.global_single_threaded.io();
    var gpa: std.heap.DebugAllocator(.{}) = .{};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    var args_list: std.ArrayList([:0]const u8) = .empty;
    defer args_list.deinit(allocator);
    var args_it = std.process.Args.Iterator.init(init.minimal.args);
    while (args_it.next()) |a| try args_list.append(allocator, a);
    const args = args_list.items;
    const source_path = argValue(args, "--source") orelse {
        usage();
        return error.MissingSource;
    };
    const out_path = argValue(args, "--out") orelse {
        usage();
        return error.MissingOut;
    };

    const t0 = nanoNow();
    const source = try std.Io.Dir.cwd().readFileAlloc(io, source_path, allocator, .limited(1024 * 1024));
    defer allocator.free(source);
    const spec = try parseSource(source);
    const file_bytes = try compile(allocator, spec);
    defer allocator.free(file_bytes);

    var file = try std.Io.Dir.cwd().createFile(io, out_path, .{ .truncate = true });
    try file.writeStreamingAll(io, file_bytes);
    try file.sync(io);
    file.close(io);

    const elapsed_ns = nanoNow() - t0;
    const elapsed_ms = @as(f64, @floatFromInt(elapsed_ns)) / 1_000_000.0;
    var stdout_buffer: [256]u8 = undefined;
    var stdout_writer = std.Io.File.stdout().writer(io, &stdout_buffer);
    const stdout = &stdout_writer.interface;
    try stdout.print(
        "{{\"compiler\":\"zig\",\"width\":{d},\"height\":{d},\"cells\":{d},\"bytes\":{d},\"compileMs\":{d:.3}}}\n",
        .{ spec.width, spec.height, @as(u64, spec.width) * @as(u64, spec.height), file_bytes.len, elapsed_ms },
    );
    try stdout.flush();
}
