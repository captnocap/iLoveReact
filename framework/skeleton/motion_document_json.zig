//! JSON authoring codec for RJAN motion documents (req_4285).
//!
//! The workbench authors keys as data — a name→quaternion map per key, so
//! partial coverage is the natural spelling — and this codec is the one
//! translation between that authoring JSON and the binary document. The
//! parser lives beside the format it parses; carts never hand-roll either.
//!
//! Authoring shape:
//!   { "name": "wave", "looping": true, "durationSeconds": 1.0,
//!     "source": "hand" | "capture" | "clip_migration",
//!     "channels": ["upper_arm_left", ...],
//!     "keys": [ { "timeSeconds": 0.0, "easing": "slerp"|"smooth"|"hold",
//!                 "root": [x,y,z] (optional),
//!                 "planted": ["upper_arm_left"] (optional),
//!                 "channels": { "upper_arm_left": [x,y,z,w], ... } } ],
//!     "runs":  [ { "startSeconds": 0.0, "channels": ["..."],
//!                  "times": [0, ...], "roots": [[x,y,z], ...] (optional),
//!                  "deltas": [[x,y,z,w], ...] (frame-major) } ] }

const std = @import("std");
pub const motion = @import("motion_document.zig");

pub const Error = motion.Error || error{
    InvalidDocumentJson,
    UnknownChannel,
};

fn number(value: std.json.Value) Error!f64 {
    return switch (value) {
        .float => |raw| raw,
        .integer => |raw| @floatFromInt(raw),
        else => error.InvalidDocumentJson,
    };
}

fn floatField(map: std.json.ObjectMap, key: []const u8) Error!f32 {
    const raw = map.get(key) orelse return error.InvalidDocumentJson;
    return @floatCast(try number(raw));
}

fn stringField(map: std.json.ObjectMap, key: []const u8) Error![]const u8 {
    const raw = map.get(key) orelse return error.InvalidDocumentJson;
    return switch (raw) {
        .string => |text| text,
        else => error.InvalidDocumentJson,
    };
}

fn quatFromValue(value: std.json.Value) Error!motion.Quat {
    const items = switch (value) {
        .array => |array| array.items,
        else => return error.InvalidDocumentJson,
    };
    if (items.len != 4) return error.InvalidDocumentJson;
    var out: motion.Quat = undefined;
    for (items, &out) |item, *lane| lane.* = @floatCast(try number(item));
    return out;
}

fn vec3FromValue(value: std.json.Value) Error!motion.Vec3 {
    const items = switch (value) {
        .array => |array| array.items,
        else => return error.InvalidDocumentJson,
    };
    if (items.len != 3) return error.InvalidDocumentJson;
    var out: motion.Vec3 = undefined;
    for (items, &out) |item, *axis| axis.* = @floatCast(try number(item));
    return out;
}

fn channelBit(channel_ids: []const []const u8, name: []const u8) Error!u5 {
    for (channel_ids, 0..) |id, index| {
        if (std.mem.eql(u8, id, name)) return @intCast(index);
    }
    return error.UnknownChannel;
}

/// Parse authoring JSON into an owned, validated document.
pub fn parseAlloc(allocator: std.mem.Allocator, json_bytes: []const u8) Error!motion.Document {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, json_bytes, .{}) catch {
        return error.InvalidDocumentJson;
    };
    defer parsed.deinit();
    const root = switch (parsed.value) {
        .object => |map| map,
        else => return error.InvalidDocumentJson,
    };
    return parseObject(allocator, root);
}

/// Parse an already-decoded JSON object (the door's `document` payload).
pub fn parseObject(allocator: std.mem.Allocator, root: std.json.ObjectMap) Error!motion.Document {
    const name = try allocator.dupe(u8, try stringField(root, "name"));
    errdefer allocator.free(name);

    const looping = switch (root.get("looping") orelse std.json.Value{ .bool = false }) {
        .bool => |flag| flag,
        else => return error.InvalidDocumentJson,
    };
    const duration = try floatField(root, "durationSeconds");
    const source_text = if (root.get("source")) |raw| switch (raw) {
        .string => |text| text,
        else => return error.InvalidDocumentJson,
    } else "hand";
    const source: motion.SourceKind = if (std.mem.eql(u8, source_text, "hand"))
        .hand
    else if (std.mem.eql(u8, source_text, "capture"))
        .capture
    else if (std.mem.eql(u8, source_text, "clip_migration"))
        .clip_migration
    else
        return error.InvalidSourceKind;

    const channels_value = root.get("channels") orelse return error.InvalidDocumentJson;
    const channel_items = switch (channels_value) {
        .array => |array| array.items,
        else => return error.InvalidDocumentJson,
    };
    if (channel_items.len == 0 or channel_items.len > motion.MAX_CHANNELS) return error.InvalidChannelCount;
    const channel_ids = try allocator.alloc([]const u8, channel_items.len);
    errdefer allocator.free(channel_ids);
    var channels_owned: usize = 0;
    errdefer for (channel_ids[0..channels_owned]) |id| allocator.free(id);
    for (channel_items, channel_ids) |item, *id| {
        id.* = switch (item) {
            .string => |text| try allocator.dupe(u8, text),
            else => return error.InvalidDocumentJson,
        };
        channels_owned += 1;
    }

    const key_items: []std.json.Value = if (root.get("keys")) |raw| switch (raw) {
        .array => |array| array.items,
        else => return error.InvalidDocumentJson,
    } else &.{};
    const keys = try allocator.alloc(motion.Key, key_items.len);
    errdefer allocator.free(keys);
    var keys_owned: usize = 0;
    errdefer for (keys[0..keys_owned]) |key| allocator.free(key.deltas);
    for (key_items, keys) |item, *key| {
        const key_map = switch (item) {
            .object => |map| map,
            else => return error.InvalidDocumentJson,
        };
        const easing_text = if (key_map.get("easing")) |raw| switch (raw) {
            .string => |text| text,
            else => return error.InvalidDocumentJson,
        } else "slerp";
        const easing: motion.Easing = if (std.mem.eql(u8, easing_text, "slerp"))
            .slerp
        else if (std.mem.eql(u8, easing_text, "smooth"))
            .smooth
        else if (std.mem.eql(u8, easing_text, "hold"))
            .hold
        else
            return error.InvalidEasing;

        const pose_map = switch (key_map.get("channels") orelse return error.InvalidDocumentJson) {
            .object => |map| map,
            else => return error.InvalidDocumentJson,
        };
        var coverage: u32 = 0;
        var iterator = pose_map.iterator();
        while (iterator.next()) |entry| {
            coverage |= @as(u32, 1) << try channelBit(channel_ids, entry.key_ptr.*);
        }
        if (coverage == 0) return error.InvalidCoverage;
        const deltas = try allocator.alloc(motion.Quat, @popCount(coverage));
        errdefer allocator.free(deltas);
        var lane: usize = 0;
        for (channel_ids, 0..) |id, index| {
            const bit = @as(u32, 1) << @intCast(index);
            if ((coverage & bit) == 0) continue;
            deltas[lane] = try quatFromValue(pose_map.get(id).?);
            lane += 1;
        }

        var planted: u32 = 0;
        if (key_map.get("planted")) |raw| switch (raw) {
            .array => |array| for (array.items) |entry| {
                planted |= @as(u32, 1) << try channelBit(channel_ids, switch (entry) {
                    .string => |text| text,
                    else => return error.InvalidDocumentJson,
                });
            },
            else => return error.InvalidDocumentJson,
        };

        key.* = .{
            .time_seconds = try floatField(key_map, "timeSeconds"),
            .coverage = coverage,
            .planted = planted,
            .easing = easing,
            .root_translation = if (key_map.get("root")) |raw| try vec3FromValue(raw) else null,
            .deltas = deltas,
        };
        keys_owned += 1;
    }

    const run_items: []std.json.Value = if (root.get("runs")) |raw| switch (raw) {
        .array => |array| array.items,
        else => return error.InvalidDocumentJson,
    } else &.{};
    const runs = try allocator.alloc(motion.Run, run_items.len);
    errdefer allocator.free(runs);
    var runs_owned: usize = 0;
    errdefer for (runs[0..runs_owned]) |run| {
        allocator.free(run.times);
        if (run.root_translations) |roots| allocator.free(roots);
        allocator.free(run.deltas);
    };
    for (run_items, runs) |item, *run| {
        const run_map = switch (item) {
            .object => |map| map,
            else => return error.InvalidDocumentJson,
        };
        var coverage: u32 = 0;
        const run_channels = switch (run_map.get("channels") orelse return error.InvalidDocumentJson) {
            .array => |array| array.items,
            else => return error.InvalidDocumentJson,
        };
        for (run_channels) |entry| {
            coverage |= @as(u32, 1) << try channelBit(channel_ids, switch (entry) {
                .string => |text| text,
                else => return error.InvalidDocumentJson,
            });
        }
        if (coverage == 0) return error.InvalidCoverage;

        const time_items = switch (run_map.get("times") orelse return error.InvalidDocumentJson) {
            .array => |array| array.items,
            else => return error.InvalidDocumentJson,
        };
        const times = try allocator.alloc(f32, time_items.len);
        errdefer allocator.free(times);
        for (time_items, times) |raw, *time| time.* = @floatCast(try number(raw));

        var roots: ?[]motion.Vec3 = null;
        errdefer if (roots) |owned| allocator.free(owned);
        if (run_map.get("roots")) |raw| switch (raw) {
            .array => |array| {
                const owned = try allocator.alloc(motion.Vec3, array.items.len);
                errdefer allocator.free(owned);
                for (array.items, owned) |entry, *root_value| root_value.* = try vec3FromValue(entry);
                roots = owned;
            },
            .null => {},
            else => return error.InvalidDocumentJson,
        };

        const delta_items = switch (run_map.get("deltas") orelse return error.InvalidDocumentJson) {
            .array => |array| array.items,
            else => return error.InvalidDocumentJson,
        };
        const deltas = try allocator.alloc(motion.Quat, delta_items.len);
        errdefer allocator.free(deltas);
        for (delta_items, deltas) |entry, *delta| delta.* = try quatFromValue(entry);

        run.* = .{
            .start_seconds = try floatField(run_map, "startSeconds"),
            .coverage = coverage,
            .times = times,
            .root_translations = roots,
            .deltas = deltas,
        };
        runs_owned += 1;
    }

    const document = motion.Document{
        .allocator = allocator,
        .name = name,
        .looping = looping,
        .duration_seconds = duration,
        .source = source,
        .channel_ids = channel_ids,
        .keys = keys,
        .runs = runs,
    };
    try motion.validate(&document);
    return document;
}

fn writeJsonString(writer: *std.Io.Writer, value: []const u8) !void {
    try writer.writeByte('"');
    for (value) |byte| switch (byte) {
        '"' => try writer.writeAll("\\\""),
        '\\' => try writer.writeAll("\\\\"),
        '\n' => try writer.writeAll("\\n"),
        '\r' => try writer.writeAll("\\r"),
        '\t' => try writer.writeAll("\\t"),
        0...8, 11, 12, 14...31 => try writer.print("\\u{x:0>4}", .{byte}),
        else => try writer.writeByte(byte),
    };
    try writer.writeByte('"');
}

fn writeQuat(writer: *std.Io.Writer, value: motion.Quat) !void {
    try writer.print("[{d},{d},{d},{d}]", .{ value[0], value[1], value[2], value[3] });
}

fn writeVec3(writer: *std.Io.Writer, value: motion.Vec3) !void {
    try writer.print("[{d},{d},{d}]", .{ value[0], value[1], value[2] });
}

/// Serialize a document back into the authoring shape.
pub fn writeJson(writer: *std.Io.Writer, document: *const motion.Document) !void {
    try writer.writeAll("{\"name\":");
    try writeJsonString(writer, document.name);
    try writer.print(",\"looping\":{s},\"durationSeconds\":{d},\"source\":", .{
        if (document.looping) "true" else "false",
        document.duration_seconds,
    });
    try writeJsonString(writer, @tagName(document.source));
    try writer.writeAll(",\"channels\":[");
    for (document.channel_ids, 0..) |id, index| {
        if (index != 0) try writer.writeByte(',');
        try writeJsonString(writer, id);
    }
    try writer.writeAll("],\"keys\":[");
    for (document.keys, 0..) |key, key_index| {
        if (key_index != 0) try writer.writeByte(',');
        try writer.print("{{\"timeSeconds\":{d},\"easing\":", .{key.time_seconds});
        try writeJsonString(writer, @tagName(key.easing));
        if (key.root_translation) |root| {
            try writer.writeAll(",\"root\":");
            try writeVec3(writer, root);
        }
        if (key.planted != 0) {
            try writer.writeAll(",\"planted\":[");
            var first = true;
            for (document.channel_ids, 0..) |id, index| {
                const bit = @as(u32, 1) << @intCast(index);
                if ((key.planted & bit) == 0) continue;
                if (!first) try writer.writeByte(',');
                first = false;
                try writeJsonString(writer, id);
            }
            try writer.writeByte(']');
        }
        try writer.writeAll(",\"channels\":{");
        var lane: usize = 0;
        var first = true;
        for (document.channel_ids, 0..) |id, index| {
            const bit = @as(u32, 1) << @intCast(index);
            if ((key.coverage & bit) == 0) continue;
            if (!first) try writer.writeByte(',');
            first = false;
            try writeJsonString(writer, id);
            try writer.writeByte(':');
            try writeQuat(writer, key.deltas[lane]);
            lane += 1;
        }
        try writer.writeAll("}}");
    }
    try writer.writeAll("],\"runs\":[");
    for (document.runs, 0..) |run, run_index| {
        if (run_index != 0) try writer.writeByte(',');
        try writer.print("{{\"startSeconds\":{d},\"channels\":[", .{run.start_seconds});
        var first = true;
        for (document.channel_ids, 0..) |id, index| {
            const bit = @as(u32, 1) << @intCast(index);
            if ((run.coverage & bit) == 0) continue;
            if (!first) try writer.writeByte(',');
            first = false;
            try writeJsonString(writer, id);
        }
        try writer.writeAll("],\"times\":[");
        for (run.times, 0..) |time, index| {
            if (index != 0) try writer.writeByte(',');
            try writer.print("{d}", .{time});
        }
        try writer.writeByte(']');
        if (run.root_translations) |roots| {
            try writer.writeAll(",\"roots\":[");
            for (roots, 0..) |root, index| {
                if (index != 0) try writer.writeByte(',');
                try writeVec3(writer, root);
            }
            try writer.writeByte(']');
        }
        try writer.writeAll(",\"deltas\":[");
        for (run.deltas, 0..) |delta, index| {
            if (index != 0) try writer.writeByte(',');
            try writeQuat(writer, delta);
        }
        try writer.writeAll("]}");
    }
    try writer.writeAll("]}");
}
