//! NDJSON line → Message parser for the Claude Code SDK.
//!
//! Ported from codeberg/duhnist/claude-code-sdk-zig parser.zig.
//! Adjusted for Zig 0.15.2 unmanaged ArrayList API.
//! All strings in the returned Message are allocated from the caller's arena.

const std = @import("std");
const types = @import("types.zig");

/// Parse one NDJSON line. Returns null for empty lines or unknown event types.
///
/// Errors:
///   error.InvalidJson — line is not valid JSON
///   error.MissingField — required field absent
pub fn parseMessage(arena: std.mem.Allocator, line: []const u8) !?types.Message {
    const trimmed = std.mem.trim(u8, line, &std.ascii.whitespace);
    if (trimmed.len == 0) return null;

    const parsed = std.json.parseFromSlice(std.json.Value, arena, trimmed, .{}) catch {
        return error.InvalidJson;
    };
    // parsed.deinit() not called — arena backs everything.

    const obj = getObject(parsed.value) orelse return error.MissingField;
    const type_val = obj.get("type") orelse return error.MissingField;
    const event_type = getString(type_val) orelse return error.MissingField;

    if (std.mem.eql(u8, event_type, "system")) {
        return .{ .system = try parseSystem(arena, obj) };
    } else if (std.mem.eql(u8, event_type, "assistant")) {
        return .{ .assistant = try parseAssistant(arena, obj) };
    } else if (std.mem.eql(u8, event_type, "user")) {
        return .{ .user = try parseUser(arena, obj) };
    } else if (std.mem.eql(u8, event_type, "result")) {
        return .{ .result = try parseResult(arena, obj) };
    }

    return null; // unknown event type — silently skip
}

fn parseSystem(arena: std.mem.Allocator, obj: std.json.ObjectMap) !types.SystemMsg {
    const session_id = try dupeStr(
        arena,
        getString(obj.get("session_id") orelse return error.MissingField) orelse return error.MissingField,
    );
    const model = if (obj.get("model")) |v|
        if (getString(v)) |s| try dupeStr(arena, s) else null
    else
        null;
    const cwd = if (obj.get("cwd")) |v|
        if (getString(v)) |s| try dupeStr(arena, s) else null
    else
        null;

    var tools: std.ArrayList([]const u8) = .{};
    if (obj.get("tools")) |tv| {
        if (getArray(tv)) |arr| {
            for (arr.items) |item| {
                if (getString(item)) |s| {
                    try tools.append(arena, try dupeStr(arena, s));
                }
            }
        }
    }

    return .{
        .session_id = session_id,
        .model = model,
        .cwd = cwd,
        .tools = try tools.toOwnedSlice(arena),
    };
}

fn parseAssistant(arena: std.mem.Allocator, obj: std.json.ObjectMap) !types.AssistantMsg {
    const msg_val = obj.get("message") orelse return error.MissingField;
    const msg_obj = getObject(msg_val) orelse return error.MissingField;

    const id = if (msg_obj.get("id")) |v|
        if (getString(v)) |s| try dupeStr(arena, s) else null
    else
        null;
    const session_id = if (obj.get("session_id")) |v|
        if (getString(v)) |s| try dupeStr(arena, s) else null
    else
        null;
    const stop_reason = if (msg_obj.get("stop_reason")) |v|
        if (getString(v)) |s| try dupeStr(arena, s) else null
    else
        null;

    var usage: types.Usage = .{};
    if (msg_obj.get("usage")) |uv| {
        if (getObject(uv)) |uo| {
            if (uo.get("input_tokens")) |it| usage.input_tokens = @intCast(getInt(it) orelse 0);
            if (uo.get("output_tokens")) |ot| usage.output_tokens = @intCast(getInt(ot) orelse 0);
            if (uo.get("cache_creation_input_tokens")) |ct|
                usage.cache_creation_input_tokens = @intCast(getInt(ct) orelse 0);
            if (uo.get("cache_read_input_tokens")) |rt|
                usage.cache_read_input_tokens = @intCast(getInt(rt) orelse 0);
        }
    }

    const content = try parseContentBlocks(arena, msg_obj.get("content"));

    return .{
        .id = id,
        .session_id = session_id,
        .content = content,
        .stop_reason = stop_reason,
        .usage = usage,
    };
}

fn parseUser(arena: std.mem.Allocator, obj: std.json.ObjectMap) !types.UserMsg {
    const session_id = if (obj.get("session_id")) |v|
        if (getString(v)) |s| try dupeStr(arena, s) else null
    else
        null;

    const content_json = blk: {
        if (obj.get("message")) |mv| {
            if (getObject(mv)) |mo| {
                if (mo.get("content")) |cv| {
                    break :blk stringifyAlloc(arena, cv) catch try dupeStr(arena, "null");
                }
            }
        }
        break :blk try dupeStr(arena, "null");
    };

    return .{
        .session_id = session_id,
        .content_json = content_json,
    };
}

fn parseResult(arena: std.mem.Allocator, obj: std.json.ObjectMap) !types.ResultMsg {
    const session_id = try dupeStr(
        arena,
        getString(obj.get("session_id") orelse return error.MissingField) orelse return error.MissingField,
    );

    const subtype_str = if (obj.get("subtype")) |v| getString(v) else null;
    const is_error = if (obj.get("is_error")) |v| getBool(v) orelse false else false;
    const subtype: types.ResultSubtype = if (is_error or
        (subtype_str != null and std.mem.eql(u8, subtype_str.?, "error")))
        .error_result
    else
        .success;

    const result_text = if (obj.get("result")) |v|
        if (getString(v)) |s| try dupeStr(arena, s) else null
    else
        null;

    const total_cost = if (obj.get("total_cost_usd")) |v| getFloat(v) orelse 0.0 else 0.0;
    const duration_ms: u64 = if (obj.get("duration_ms")) |v| @intCast(@max(0, getInt(v) orelse 0)) else 0;
    const duration_api_ms: u64 = if (obj.get("duration_api_ms")) |v| @intCast(@max(0, getInt(v) orelse 0)) else 0;
    const num_turns: u32 = if (obj.get("num_turns")) |v| @intCast(@max(0, getInt(v) orelse 0)) else 0;

    return .{
        .subtype = subtype,
        .session_id = session_id,
        .result = result_text,
        .total_cost_usd = total_cost,
        .duration_ms = duration_ms,
        .duration_api_ms = duration_api_ms,
        .num_turns = num_turns,
        .is_error = is_error,
    };
}

fn parseContentBlocks(arena: std.mem.Allocator, content_val: ?std.json.Value) ![]const types.ContentBlock {
    var blocks: std.ArrayList(types.ContentBlock) = .{};
    const arr = if (content_val) |v| getArray(v) else null;
    if (arr == null) return blocks.toOwnedSlice(arena);

    for (arr.?.items) |item| {
        const bobj = getObject(item) orelse continue;
        const btype_val = bobj.get("type") orelse continue;
        const btype = getString(btype_val) orelse continue;

        if (std.mem.eql(u8, btype, "text")) {
            const text_val = bobj.get("text") orelse continue;
            const text = getString(text_val) orelse continue;
            try blocks.append(arena, .{ .text = .{ .text = try dupeStr(arena, text) } });
        } else if (std.mem.eql(u8, btype, "thinking")) {
            const thinking_val = bobj.get("thinking") orelse continue;
            const thinking = getString(thinking_val) orelse continue;
            try blocks.append(arena, .{ .thinking = .{ .thinking = try dupeStr(arena, thinking) } });
        } else if (std.mem.eql(u8, btype, "tool_use")) {
            const id_val = bobj.get("id") orelse continue;
            const id = getString(id_val) orelse continue;
            const name_val = bobj.get("name") orelse continue;
            const name = getString(name_val) orelse continue;
            const input_json = if (bobj.get("input")) |iv|
                stringifyAlloc(arena, iv) catch try dupeStr(arena, "{}")
            else
                try dupeStr(arena, "{}");

            try blocks.append(arena, .{
                .tool_use = .{
                    .id = try dupeStr(arena, id),
                    .name = try dupeStr(arena, name),
                    .input_json = input_json,
                },
            });
        }
        // Unknown block types silently skipped.
    }

    return blocks.toOwnedSlice(arena);
}

// ── Value accessors ──────────────────────────────────────────────────────

fn getString(v: std.json.Value) ?[]const u8 {
    return switch (v) {
        .string => |s| s,
        else => null,
    };
}

fn getObject(v: std.json.Value) ?std.json.ObjectMap {
    return switch (v) {
        .object => |o| o,
        else => null,
    };
}

fn getArray(v: std.json.Value) ?std.json.Array {
    return switch (v) {
        .array => |a| a,
        else => null,
    };
}

fn getInt(v: std.json.Value) ?i64 {
    return switch (v) {
        .integer => |i| i,
        .float => |f| @intFromFloat(f),
        else => null,
    };
}

fn getFloat(v: std.json.Value) ?f64 {
    return switch (v) {
        .float => |f| f,
        .integer => |i| @floatFromInt(i),
        else => null,
    };
}

fn getBool(v: std.json.Value) ?bool {
    return switch (v) {
        .bool => |b| b,
        else => null,
    };
}

fn dupeStr(arena: std.mem.Allocator, s: []const u8) ![]const u8 {
    return arena.dupe(u8, s);
}

/// Serialize a std.json.Value back to its JSON string representation.
/// Uses std.json.Stringify.valueAlloc on 0.15.2.
fn stringifyAlloc(arena: std.mem.Allocator, value: std.json.Value) ![]const u8 {
    return std.json.Stringify.valueAlloc(arena, value, .{});
}
