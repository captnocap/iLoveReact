//! Minimal hand-rolled JSON helpers used by diag/ modules that don't want to
//! pull in `std.json` for tiny pair-handshake / log-export payloads.
//!
//! Two read helpers (`str`, `int`) — extract a single value by key from a flat
//! object. No nesting, no arrays, no escapes inside values. Good enough for the
//! debug RPC handshake and similar short messages.
//!
//! One write helper (`writeString`) — emit a JSON-quoted, escape-safe string
//! literal to any writer. Handles `"` `\` `\n` `\r` `\t` and control chars
//! 0x00..0x1F via `\uXXXX`.

const std = @import("std");

/// Find `"<key>": "<value>"` in `json` and return the value slice (unescaped,
/// borrowed from the input). Returns null if the key isn't present or the
/// value isn't a string.
pub fn str(json: []const u8, key: []const u8) ?[]const u8 {
    var i: usize = 0;
    while (i + key.len + 4 < json.len) : (i += 1) {
        if (json[i] == '"' and i + 1 + key.len < json.len and
            std.mem.eql(u8, json[i + 1 .. i + 1 + key.len], key) and
            json[i + 1 + key.len] == '"')
        {
            var j = i + 2 + key.len;
            while (j < json.len and (json[j] == ':' or json[j] == ' ')) j += 1;
            if (j < json.len and json[j] == '"') {
                j += 1;
                const vs = j;
                while (j < json.len and json[j] != '"') j += 1;
                return json[vs..j];
            }
        }
    }
    return null;
}

/// Find `"<key>": <number>` in `json` and parse it as i32. Returns null if the
/// key isn't present, the value isn't a number, or the number doesn't fit.
pub fn int(json: []const u8, key: []const u8) ?i32 {
    var i: usize = 0;
    while (i + key.len + 4 < json.len) : (i += 1) {
        if (json[i] == '"' and i + 1 + key.len < json.len and
            std.mem.eql(u8, json[i + 1 .. i + 1 + key.len], key) and
            json[i + 1 + key.len] == '"')
        {
            var j = i + 2 + key.len;
            while (j < json.len and (json[j] == ':' or json[j] == ' ')) j += 1;
            const ns = j;
            if (j < json.len and (json[j] == '-' or (json[j] >= '0' and json[j] <= '9'))) {
                j += 1;
                while (j < json.len and json[j] >= '0' and json[j] <= '9') j += 1;
                return std.fmt.parseInt(i32, json[ns..j], 10) catch null;
            }
        }
    }
    return null;
}

/// Write `s` as a JSON-quoted string literal, escaping `"` `\` `\n` `\r` `\t`
/// and control characters 0x00..0x1F. Emits the surrounding `"` quotes.
pub fn writeString(writer: anytype, s: []const u8) !void {
    try writer.writeByte('"');
    for (s) |c| switch (c) {
        '"' => try writer.writeAll("\\\""),
        '\\' => try writer.writeAll("\\\\"),
        '\n' => try writer.writeAll("\\n"),
        '\r' => try writer.writeAll("\\r"),
        '\t' => try writer.writeAll("\\t"),
        0x00...0x07, 0x0B, 0x0E...0x1F => try writer.print("\\u{x:0>4}", .{c}),
        else => try writer.writeByte(c),
    };
    try writer.writeByte('"');
}

test "str extracts values" {
    try std.testing.expectEqualStrings("debug.tree", str("{\"method\":\"debug.tree\"}", "method").?);
    try std.testing.expectEqual(@as(?[]const u8, null), str("{\"a\":1}", "missing"));
}

test "int parses numbers" {
    try std.testing.expectEqual(@as(?i32, 42), int("{\"port\":42}", "port"));
    try std.testing.expectEqual(@as(?i32, -7), int("{\"x\":-7}", "x"));
    try std.testing.expectEqual(@as(?i32, null), int("{\"x\":\"str\"}", "x"));
}

test "writeString escapes control chars" {
    var buf: [128]u8 = undefined;
    var writer: std.Io.Writer = .fixed(&buf);
    try writeString(&writer, "a\"b\nc\x01d");
    try std.testing.expectEqualStrings("\"a\\\"b\\nc\\u0001d\"", writer.buffered());
}
