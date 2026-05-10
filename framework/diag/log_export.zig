//! Log Export — format and export structured log data.
//!
//! Provides format conversion (JSON, Markdown, plain text, CSV) for structured
//! log entries. Designed as a reusable framework module — any .tsz app can use
//! it for exporting logs, crash reports, console output, or telemetry.
//!
//! Stateless: no init/deinit needed. All functions take entries + writer.
//!
//! Usage from Zig:
//!   try log_export.exportToFile(entries[0..n], .json, "/tmp/logs.json");
//!   const len = try log_export.exportToBuffer(entries[0..n], .md, &buf);
//!
//! QuickJS bridge: register via qjs_runtime.registerHostFn. See docs/LOG_EXPORT.md.

const std = @import("std");

// ── Types ───────────────────────────────────────────────────────────

pub const Level = enum(u8) {
    debug = 0,
    info = 1,
    warn = 2,
    err = 3,
    fatal = 4,

    pub fn label(self: Level) []const u8 {
        return switch (self) {
            .debug => "DEBUG",
            .info => "INFO",
            .warn => "WARN",
            .err => "ERROR",
            .fatal => "FATAL",
        };
    }

    pub fn fromString(s: []const u8) Level {
        if (s.len == 0) return .info;
        return switch (s[0]) {
            'd', 'D' => .debug,
            'w', 'W' => .warn,
            'e', 'E' => .err,
            'f', 'F' => .fatal,
            else => .info,
        };
    }
};

pub const Format = enum {
    json,
    md,
    txt,
    csv,

    pub fn fromString(s: []const u8) ?Format {
        if (std.mem.eql(u8, s, "json")) return .json;
        if (std.mem.eql(u8, s, "md") or std.mem.eql(u8, s, "markdown")) return .md;
        if (std.mem.eql(u8, s, "txt") or std.mem.eql(u8, s, "text")) return .txt;
        if (std.mem.eql(u8, s, "csv")) return .csv;
        return null;
    }

    pub fn extension(self: Format) []const u8 {
        return switch (self) {
            .json => ".json",
            .md => ".md",
            .txt => ".txt",
            .csv => ".csv",
        };
    }
};

/// A single structured log entry. All slices are borrowed — caller owns the data.
pub const LogEntry = struct {
    timestamp: []const u8 = "",
    level: Level = .info,
    source: []const u8 = "",
    message: []const u8 = "",
    metadata: []const u8 = "",
};

pub const MAX_ENTRIES = 4096;

// ── Format dispatch ─────────────────────────────────────────────────

/// Format entries to any writer. Primary API — all output functions build on this.
pub fn format(entries: []const LogEntry, fmt: Format, writer: anytype) !void {
    switch (fmt) {
        .json => try formatJson(entries, writer),
        .md => try formatMarkdown(entries, writer),
        .txt => try formatPlain(entries, writer),
        .csv => try formatCsv(entries, writer),
    }
}

// ── Output targets ──────────────────────────────────────────────────

/// Write formatted entries to a file. Creates or truncates.
pub fn exportToFile(entries: []const LogEntry, fmt: Format, path: []const u8) !void {
    const file = if (path.len > 0 and path[0] == '/')
        try std.fs.createFileAbsolute(path, .{ .truncate = true })
    else
        try std.fs.cwd().createFile(path, .{ .truncate = true });
    defer file.close();
    try format(entries, fmt, file.writer());
}

/// Format entries into a buffer. Returns bytes written.
pub fn exportToBuffer(entries: []const LogEntry, fmt: Format, buf: []u8) !usize {
    var fbs = std.io.fixedBufferStream(buf);
    try format(entries, fmt, fbs.writer());
    return fbs.pos;
}

/// Write formatted entries to stdout.
pub fn exportToStdout(entries: []const LogEntry, fmt: Format) !void {
    try format(entries, fmt, std.io.getStdOut().writer());
}

// ── JSON ────────────────────────────────────────────────────────────

fn formatJson(entries: []const LogEntry, writer: anytype) !void {
    try writer.writeAll("[\n");
    for (entries, 0..) |entry, i| {
        try writer.writeAll("  {\n");
        try writer.writeAll("    \"timestamp\": \"");
        try writeJsonEscaped(writer, entry.timestamp);
        try writer.writeAll("\",\n");
        try writer.print("    \"level\": \"{s}\",\n", .{entry.level.label()});
        try writer.writeAll("    \"source\": \"");
        try writeJsonEscaped(writer, entry.source);
        try writer.writeAll("\",\n");
        try writer.writeAll("    \"message\": \"");
        try writeJsonEscaped(writer, entry.message);
        try writer.writeByte('"');
        if (entry.metadata.len > 0) {
            try writer.writeAll(",\n    \"metadata\": \"");
            try writeJsonEscaped(writer, entry.metadata);
            try writer.writeByte('"');
        }
        try writer.writeAll("\n  }");
        if (i + 1 < entries.len) try writer.writeByte(',');
        try writer.writeByte('\n');
    }
    try writer.writeAll("]\n");
}

fn writeJsonEscaped(writer: anytype, s: []const u8) !void {
    for (s) |c| {
        switch (c) {
            '"' => try writer.writeAll("\\\""),
            '\\' => try writer.writeAll("\\\\"),
            '\n' => try writer.writeAll("\\n"),
            '\r' => try writer.writeAll("\\r"),
            '\t' => try writer.writeAll("\\t"),
            else => try writer.writeByte(c),
        }
    }
}

// ── Markdown ────────────────────────────────────────────────────────

fn formatMarkdown(entries: []const LogEntry, writer: anytype) !void {
    try writer.writeAll("# Log Export\n\n");
    try writer.print("{d} entries\n\n---\n\n", .{entries.len});

    for (entries) |entry| {
        try writer.print("### [{s}] {s}", .{ entry.level.label(), entry.timestamp });
        if (entry.source.len > 0) {
            try writer.print(" -- {s}", .{entry.source});
        }
        try writer.writeAll("\n\n");
        try writer.print("{s}\n", .{entry.message});
        if (entry.metadata.len > 0) {
            try writer.print("\n> {s}\n", .{entry.metadata});
        }
        try writer.writeAll("\n---\n\n");
    }
}

// ── Plain text ──────────────────────────────────────────────────────

fn formatPlain(entries: []const LogEntry, writer: anytype) !void {
    for (entries) |entry| {
        try writer.print("[{s}] {s}", .{ entry.level.label(), entry.timestamp });
        if (entry.source.len > 0) {
            try writer.print(" ({s})", .{entry.source});
        }
        try writer.print(": {s}\n", .{entry.message});
        if (entry.metadata.len > 0) {
            try writer.print("  metadata: {s}\n", .{entry.metadata});
        }
    }
}

// ── CSV ─────────────────────────────────────────────────────────────

fn formatCsv(entries: []const LogEntry, writer: anytype) !void {
    try writer.writeAll("timestamp,level,source,message,metadata\n");
    for (entries) |entry| {
        try writeCsvField(writer, entry.timestamp);
        try writer.writeByte(',');
        try writer.writeAll(entry.level.label());
        try writer.writeByte(',');
        try writeCsvField(writer, entry.source);
        try writer.writeByte(',');
        try writeCsvField(writer, entry.message);
        try writer.writeByte(',');
        try writeCsvField(writer, entry.metadata);
        try writer.writeByte('\n');
    }
}

fn writeCsvField(writer: anytype, s: []const u8) !void {
    var needs_quote = false;
    for (s) |c| {
        if (c == ',' or c == '"' or c == '\n' or c == '\r') {
            needs_quote = true;
            break;
        }
    }
    if (needs_quote) {
        try writer.writeByte('"');
        for (s) |c| {
            if (c == '"') {
                try writer.writeAll("\"\"");
            } else {
                try writer.writeByte(c);
            }
        }
        try writer.writeByte('"');
    } else {
        try writer.writeAll(s);
    }
}

// ── Tests ───────────────────────────────────────────────────────────

test "format plain text" {
    const entries = [_]LogEntry{
        .{ .timestamp = "2026-03-22T14:32:07Z", .level = .err, .source = "layout.zig", .message = "RSS exceeded 512MB" },
        .{ .timestamp = "2026-03-22T11:05:43Z", .level = .fatal, .source = "engine.zig", .message = "index out of bounds" },
    };
    var buf: [4096]u8 = undefined;
    const len = try exportToBuffer(&entries, .txt, &buf);
    const output = buf[0..len];
    try std.testing.expect(std.mem.indexOf(u8, output, "[ERROR]") != null);
    try std.testing.expect(std.mem.indexOf(u8, output, "RSS exceeded 512MB") != null);
    try std.testing.expect(std.mem.indexOf(u8, output, "[FATAL]") != null);
}

test "format json" {
    const entries = [_]LogEntry{
        .{ .timestamp = "2026-03-22T14:32:07Z", .level = .warn, .source = "gpu", .message = "device lost" },
    };
    var buf: [4096]u8 = undefined;
    const len = try exportToBuffer(&entries, .json, &buf);
    const output = buf[0..len];
    try std.testing.expect(std.mem.indexOf(u8, output, "\"level\": \"WARN\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, output, "\"message\": \"device lost\"") != null);
}

test "format csv" {
    const entries = [_]LogEntry{
        .{ .timestamp = "2026-03-22T14:32:07Z", .level = .info, .source = "app", .message = "started" },
    };
    var buf: [4096]u8 = undefined;
    const len = try exportToBuffer(&entries, .csv, &buf);
    const output = buf[0..len];
    try std.testing.expect(std.mem.indexOf(u8, output, "timestamp,level,source,message,metadata\n") != null);
    try std.testing.expect(std.mem.indexOf(u8, output, "INFO") != null);
}

test "csv escaping" {
    const entries = [_]LogEntry{
        .{ .timestamp = "t", .level = .info, .source = "s", .message = "has, comma" },
    };
    var buf: [4096]u8 = undefined;
    const len = try exportToBuffer(&entries, .csv, &buf);
    const output = buf[0..len];
    try std.testing.expect(std.mem.indexOf(u8, output, "\"has, comma\"") != null);
}

test "json escaping" {
    const entries = [_]LogEntry{
        .{ .timestamp = "t", .level = .info, .source = "s", .message = "has \"quotes\" and\nnewline" },
    };
    var buf: [4096]u8 = undefined;
    const len = try exportToBuffer(&entries, .json, &buf);
    const output = buf[0..len];
    try std.testing.expect(std.mem.indexOf(u8, output, "has \\\"quotes\\\" and\\nnewline") != null);
}

test "format dispatch" {
    const entries = [_]LogEntry{
        .{ .timestamp = "t", .level = .debug, .source = "test", .message = "ok" },
    };
    var buf: [4096]u8 = undefined;

    const json_len = try exportToBuffer(&entries, .json, &buf);
    try std.testing.expect(json_len > 0);

    const md_len = try exportToBuffer(&entries, .md, &buf);
    try std.testing.expect(md_len > 0);

    const txt_len = try exportToBuffer(&entries, .txt, &buf);
    try std.testing.expect(txt_len > 0);

    const csv_len = try exportToBuffer(&entries, .csv, &buf);
    try std.testing.expect(csv_len > 0);
}

test "empty entries" {
    const entries = [_]LogEntry{};
    var buf: [4096]u8 = undefined;
    const len = try exportToBuffer(&entries, .json, &buf);
    const output = buf[0..len];
    try std.testing.expect(std.mem.eql(u8, output, "[\n]\n"));
}

test "Level.fromString" {
    try std.testing.expect(Level.fromString("debug") == .debug);
    try std.testing.expect(Level.fromString("ERROR") == .err);
    try std.testing.expect(Level.fromString("FATAL") == .fatal);
    try std.testing.expect(Level.fromString("unknown") == .info);
}

test "Format.fromString" {
    try std.testing.expect(Format.fromString("json") == .json);
    try std.testing.expect(Format.fromString("markdown") == .md);
    try std.testing.expect(Format.fromString("text") == .txt);
    try std.testing.expect(Format.fromString("csv") == .csv);
    try std.testing.expect(Format.fromString("xml") == null);
}
