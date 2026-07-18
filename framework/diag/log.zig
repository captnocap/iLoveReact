//! Runtime logging — non-I/O producer plus a root-owned sink.
//!
//! Call sites only format into bounded queues:
//!     log.info(.events, "mouse down at ({d}, {d})", .{ mx, my });
//!     log.warn(.state, "slot {d} overflow", .{id});
//!
//! The application root owns the effectful half:
//!     event_bus.init();
//!     log.init(environ);
//!     var sink = log.open(io, environ);
//!     defer { _ = sink.close(io); log.deinit(); event_bus.deinit(); }
//!     // once per frame / host turn:
//!     _ = sink.flush(io);

const std = @import("std");
const event_bus = @import("event_bus.zig");

pub const Category = enum {
    engine,
    events,
    layout,
    state,
    selection,
    gpu,
    geometry,
    text,
    ffi,
    tick,
    render,
};

const NUM_CATEGORIES = @typeInfo(Category).@"enum".fields.len;
const FILE_QUEUE_SIZE: usize = 1024;
const FILE_LINE_CAP: usize = 1152;

const FileLine = struct {
    buf: [FILE_LINE_CAP]u8 = undefined,
    len: u16 = 0,

    fn slice(self: *const FileLine) []const u8 {
        return self.buf[0..self.len];
    }

    fn set(self: *FileLine, value: []const u8) void {
        if (value.len <= self.buf.len) {
            @memcpy(self.buf[0..value.len], value);
            self.len = @intCast(value.len);
            return;
        }
        const suffix = "...\n";
        const prefix_len = self.buf.len - suffix.len;
        @memcpy(self.buf[0..prefix_len], value[0..prefix_len]);
        @memcpy(self.buf[prefix_len..], suffix);
        self.len = self.buf.len;
    }
};

var enabled: [NUM_CATEGORIES]bool = [_]bool{false} ** NUM_CATEGORIES;
var initialized: bool = false;
var file_requested: bool = false;
var file_queue: [FILE_QUEUE_SIZE]FileLine = undefined;
var file_write: u64 = 0;
var file_read: u64 = 0;
var file_dropped_total: u64 = 0;
var file_dropped_unreported: u64 = 0;

/// Parse configuration and initialize bounded producer state. No I/O occurs.
pub fn init(environ: *const std.process.Environ.Map) void {
    if (initialized) return;
    initialized = true;
    enabled = [_]bool{false} ** NUM_CATEGORIES;
    file_requested = environ.get("ZIGOS_LOG_FILE") != null;
    file_write = 0;
    file_read = 0;
    file_dropped_total = 0;
    file_dropped_unreported = 0;

    const env = environ.get("ZIGOS_LOG") orelse return;
    if (std.mem.eql(u8, env, "all")) {
        for (&enabled) |*entry| entry.* = true;
        return;
    }

    var iter = std.mem.splitScalar(u8, env, ',');
    while (iter.next()) |name| {
        const trimmed = std.mem.trim(u8, name, " ");
        inline for (@typeInfo(Category).@"enum".fields, 0..) |field, i| {
            if (std.mem.eql(u8, trimmed, field.name)) enabled[i] = true;
        }
    }
}

/// Release producer configuration. Close the root-owned Sink first.
pub fn deinit() void {
    enabled = [_]bool{false} ** NUM_CATEGORIES;
    initialized = false;
    file_requested = false;
    file_write = 0;
    file_read = 0;
}

pub const FlushStats = struct {
    events: event_bus.FlushStats = .{},
    file_lines_written: usize = 0,
    file_lines_discarded: usize = 0,
    file_lines_dropped: u64 = 0,
    file_failed: bool = false,
};

/// Explicit effectful owner for both event persistence/stderr and the optional
/// category log file. No `std.Io` escapes this value into producer globals.
pub const Sink = struct {
    events: event_bus.Sink,
    file: ?std.Io.File = null,
    closed: bool = false,
    file_error_reported: bool = false,

    pub fn flush(self: *Sink, io: std.Io) FlushStats {
        if (self.closed) return .{};
        var stats: FlushStats = .{};
        stats.file_lines_dropped = file_dropped_unreported;
        if (file_dropped_unreported > 0) {
            var msg_buf: [192]u8 = undefined;
            const msg = std.fmt.bufPrint(
                &msg_buf,
                "category log queue dropped {d} lines before flush",
                .{file_dropped_unreported},
            ) catch "category log queue overflow";
            _ = event_bus.emitFromLog(.warn, "log", msg);
            file_dropped_unreported = 0;
        }

        if (self.file) |file| {
            while (file_read < file_write) {
                const slot: usize = @intCast(file_read % FILE_QUEUE_SIZE);
                file.writeStreamingAll(io, file_queue[slot].slice()) catch {
                    stats.file_failed = true;
                    if (!self.file_error_reported) {
                        _ = event_bus.emitFromLog(.warn, "log", "category log file write failed");
                        self.file_error_reported = true;
                    }
                    break;
                };
                file_read += 1;
                stats.file_lines_written += 1;
                self.file_error_reported = false;
            }
        } else {
            stats.file_lines_discarded = @intCast(file_write - file_read);
            file_read = file_write;
        }

        // Event persistence and stderr are deliberately last so any log-file
        // failure/drop report enqueued above is visible in this same flush.
        stats.events = self.events.flush(io);
        return stats;
    }

    pub fn close(self: *Sink, io: std.Io) FlushStats {
        if (self.closed) return .{};
        const stats = self.flush(io);
        if (self.file) |file| file.close(io);
        self.file = null;
        _ = self.events.close(io);
        self.closed = true;
        return stats;
    }
};

/// Open effectful sinks at the application root. Open failures become queued
/// warnings and are emitted by the first `flush(io)`.
pub fn open(io: std.Io, environ: *const std.process.Environ.Map) Sink {
    if (!initialized) init(environ);
    var sink: Sink = .{ .events = event_bus.open(io, environ) };
    if (environ.get("ZIGOS_LOG_FILE")) |path| {
        sink.file = std.Io.Dir.createFileAbsolute(io, path, .{ .truncate = true }) catch |open_err| blk: {
            var msg_buf: [256]u8 = undefined;
            const msg = std.fmt.bufPrint(&msg_buf, "ZIGOS_LOG_FILE open failed: {s}", .{@errorName(open_err)}) catch
                "ZIGOS_LOG_FILE open failed";
            _ = event_bus.emitFromLog(.warn, "log", msg);
            break :blk null;
        };
    }
    return sink;
}

fn enqueueFile(line: []const u8) void {
    if (!file_requested) return;
    if (file_write - file_read >= FILE_QUEUE_SIZE) {
        file_read += 1;
        file_dropped_total += 1;
        file_dropped_unreported += 1;
    }
    const slot: usize = @intCast(file_write % FILE_QUEUE_SIZE);
    file_queue[slot].set(line);
    file_write += 1;
}

/// Formats into the event bus at info importance, scope="debug".
pub fn print(comptime fmt: []const u8, args: anytype) void {
    var buf: [4096]u8 = undefined;
    const formatted: []const u8 = std.fmt.bufPrint(&buf, fmt, args) catch buf[0..];
    const trimmed = std.mem.trimEnd(u8, formatted, " \t\r\n");
    _ = event_bus.emitFromLog(.info, "debug", trimmed);
}

/// Queue a line for the optional category log file regardless of filters.
pub fn writeLine(comptime fmt: []const u8, args: anytype) void {
    var buf: [512]u8 = undefined;
    const line = std.fmt.bufPrint(&buf, fmt ++ "\n", args) catch return;
    enqueueFile(line);
}

pub fn isEnabled(cat: Category) bool {
    if (!initialized) return false;
    return enabled[@intFromEnum(cat)];
}

fn enqueueCategoryLine(cat: Category, comptime prefix: []const u8, msg: []const u8) void {
    if (!enabled[@intFromEnum(cat)]) return;
    var line_buf: [FILE_LINE_CAP]u8 = undefined;
    const line = std.fmt.bufPrint(&line_buf, "[{s}] " ++ prefix ++ "{s}\n", .{ @tagName(cat), msg }) catch return;
    enqueueFile(line);
}

/// Per-frame / per-tick noise. Event-bus importance 0.15, default-filtered.
pub fn debug(cat: Category, comptime fmt: []const u8, args: anytype) void {
    const name = @tagName(cat);
    var msg_buf: [1024]u8 = undefined;
    const msg = std.fmt.bufPrint(&msg_buf, fmt, args) catch return;
    _ = event_bus.emitFromLog(.debug, name, msg);
    enqueueCategoryLine(cat, "", msg);
}

pub fn info(cat: Category, comptime fmt: []const u8, args: anytype) void {
    const name = @tagName(cat);
    var msg_buf: [1024]u8 = undefined;
    const msg = std.fmt.bufPrint(&msg_buf, fmt, args) catch return;
    _ = event_bus.emitFromLog(.info, name, msg);
    enqueueCategoryLine(cat, "", msg);
}

pub fn warn(cat: Category, comptime fmt: []const u8, args: anytype) void {
    const name = @tagName(cat);
    var msg_buf: [1024]u8 = undefined;
    const msg = std.fmt.bufPrint(&msg_buf, fmt, args) catch return;
    _ = event_bus.emitFromLog(.warn, name, msg);
    enqueueCategoryLine(cat, "WARN: ", msg);
}

pub fn err(cat: Category, comptime fmt: []const u8, args: anytype) void {
    const name = @tagName(cat);
    var msg_buf: [1024]u8 = undefined;
    const msg = std.fmt.bufPrint(&msg_buf, fmt, args) catch return;
    _ = event_bus.emitFromLog(.err, name, msg);
    enqueueCategoryLine(cat, "ERROR: ", msg);
}

pub fn telemetryEnabledMask() u16 {
    var mask: u16 = 0;
    for (0..NUM_CATEGORIES) |i| {
        if (enabled[i]) mask |= @as(u16, 1) << @intCast(i);
    }
    return mask;
}

pub fn pendingFileLines() usize {
    return @intCast(file_write - file_read);
}

pub fn droppedFileLines() u64 {
    return file_dropped_total;
}

test "log calls enqueue without Io" {
    var environ = std.process.Environ.Map.init(std.testing.allocator);
    defer environ.deinit();
    try environ.put("ZIGOS_LOG", "engine");
    try environ.put("ZIGOS_LOG_FILE", "/tmp/unused-log-test");

    event_bus.init();
    defer event_bus.deinit();
    init(&environ);
    defer deinit();

    info(.engine, "boot {d}", .{1});
    warn(.engine, "slow", .{});
    try std.testing.expectEqual(@as(usize, 2), pendingFileLines());
    try std.testing.expectEqual(@as(usize, 2), event_bus.pendingCount());
}

test "category file queue has explicit bounded backpressure" {
    var environ = std.process.Environ.Map.init(std.testing.allocator);
    defer environ.deinit();
    try environ.put("ZIGOS_LOG_FILE", "/tmp/unused-log-test");
    init(&environ);
    defer deinit();

    for (0..FILE_QUEUE_SIZE + 3) |i| writeLine("line {d}", .{i});
    try std.testing.expectEqual(FILE_QUEUE_SIZE, pendingFileLines());
    try std.testing.expectEqual(@as(u64, 3), droppedFileLines());
}

test "root-owned sink performs the queued file write" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    var dir_buf: [std.fs.max_path_bytes]u8 = undefined;
    const dir_path_len = try tmp.dir.realPath(std.testing.io, &dir_buf);
    const dir_path = dir_buf[0..dir_path_len];
    var path_buf: [std.fs.max_path_bytes]u8 = undefined;
    const log_path = try std.fmt.bufPrint(&path_buf, "{s}/diag.log", .{dir_path});

    var environ = std.process.Environ.Map.init(std.testing.allocator);
    defer environ.deinit();
    try environ.put("ZIGOS_LOG_FILE", log_path);
    event_bus.init();
    defer event_bus.deinit();
    init(&environ);
    defer deinit();

    var sink = open(std.testing.io, &environ);
    defer _ = sink.close(std.testing.io);
    writeLine("queued {d}", .{7});
    const stats = sink.flush(std.testing.io);
    try std.testing.expectEqual(@as(usize, 1), stats.file_lines_written);

    const file = try std.Io.Dir.openFileAbsolute(std.testing.io, log_path, .{});
    defer file.close(std.testing.io);
    var contents: [64]u8 = undefined;
    const n = try file.readPositionalAll(std.testing.io, &contents, 0);
    try std.testing.expectEqualStrings("queued 7\n", contents[0..n]);
}
