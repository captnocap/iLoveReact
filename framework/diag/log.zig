//! Runtime logging — always compiled in, enabled by ZIGOS_LOG env var.
//!
//! Usage in framework code:
//!     const log = @import("log.zig");
//!     log.info(.events, "mouse down at ({d}, {d})", .{mx, my});
//!     log.warn(.state, "slot {d} overflow", .{id});
//!
//! Enable at runtime:
//!     ZIGOS_LOG=all ./app              — everything
//!     ZIGOS_LOG=events,state ./app     — specific categories
//!     (no env var)                     — silent

const std = @import("std");
const event_bus = @import("event_bus.zig");
const host_io = @import("../host_io.zig");

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

var enabled: [NUM_CATEGORIES]bool = [_]bool{false} ** NUM_CATEGORIES;
var initialized: bool = false;
var log_file: ?std.Io.File = null;

fn ensureInit() void {
    if (initialized) return;
    initialized = true;
    std.debug.print("[log] ensureInit called\n", .{});

    if (host_io.getenv("ZIGOS_LOG_FILE")) |path| {
        log_file = std.Io.Dir.createFileAbsolute(host_io.io(), path, .{ .truncate = true }) catch |e| blk: {
            std.debug.print("ZIGOS_LOG_FILE open failed: {}\n", .{e});
            break :blk null;
        };
        if (log_file != null) std.debug.print("ZIGOS_LOG_FILE: {s}\n", .{path});
    }

    const env = host_io.getenv("ZIGOS_LOG") orelse return;

    if (std.mem.eql(u8, env, "all")) {
        for (&enabled) |*e| e.* = true;
        return;
    }

    var iter = std.mem.splitScalar(u8, env, ',');
    while (iter.next()) |name| {
        const trimmed = std.mem.trim(u8, name, " ");
        inline for (@typeInfo(Category).@"enum".fields, 0..) |field, i| {
            if (std.mem.eql(u8, trimmed, field.name)) {
                enabled[i] = true;
            }
        }
    }
}

/// Drop-in replacement for std.debug.print. Formats into a stack buf and
/// emits to the event bus at imp 0.30 (info-level), scope="debug".
/// Trailing newlines are stripped — the bus payload is one event per
/// call, no need for terminal-friendly framing. Output is bus-only;
/// stderr stays quiet for normal operation. The `framework/log.zig`
/// import is the single seam between the framework's diagnostic prints
/// and the bus.
pub fn print(comptime fmt: []const u8, args: anytype) void {
    var buf: [4096]u8 = undefined;
    const formatted: []const u8 = std.fmt.bufPrint(&buf, fmt, args) catch buf[0..];
    const trimmed = std.mem.trimEnd(u8, formatted, " \t\r\n");
    _ = event_bus.emitFromLog(.info, "debug", trimmed);
}

/// Write a line to the log file (always, regardless of category filters).
/// Used by engine.zig for unconditional telemetry.
pub fn writeLine(comptime fmt: []const u8, args: anytype) void {
    ensureInit();
    const f = log_file orelse return;
    var buf: [512]u8 = undefined;
    const s = std.fmt.bufPrint(&buf, fmt ++ "\n", args) catch return;
    _ = f.writeStreamingAll(host_io.io(), s) catch {};
}

pub fn isEnabled(cat: Category) bool {
    ensureInit();
    return enabled[@intFromEnum(cat)];
}

fn fileWrite(s: []const u8) void {
    if (log_file) |f| _ = f.writeStreamingAll(host_io.io(), s) catch {};
}

/// Per-frame / per-tick noise that the user only wants to see when
/// they've explicitly opted into trace-tier in the dev shell. Bus
/// importance 0.15, default-filtered.
pub fn debug(cat: Category, comptime fmt: []const u8, args: anytype) void {
    ensureInit();
    const name = @tagName(cat);
    var msg_buf: [1024]u8 = undefined;
    const msg = std.fmt.bufPrint(&msg_buf, fmt, args) catch return;
    _ = event_bus.emitFromLog(.debug, name, msg);
    if (enabled[@intFromEnum(cat)]) {
        var line_buf: [1100]u8 = undefined;
        const line = std.fmt.bufPrint(&line_buf, "[{s}] {s}\n", .{ name, msg }) catch return;
        fileWrite(line);
    }
}

pub fn info(cat: Category, comptime fmt: []const u8, args: anytype) void {
    ensureInit();
    const name = @tagName(cat);
    var msg_buf: [1024]u8 = undefined;
    const msg = std.fmt.bufPrint(&msg_buf, fmt, args) catch return;
    // Bus emit happens regardless of category enable — the bus has its own
    // importance filter; the env var only gates the legacy file write.
    _ = event_bus.emitFromLog(.info, name, msg);
    if (enabled[@intFromEnum(cat)]) {
        var line_buf: [1100]u8 = undefined;
        const line = std.fmt.bufPrint(&line_buf, "[{s}] {s}\n", .{ name, msg }) catch return;
        fileWrite(line);
    }
}

pub fn warn(cat: Category, comptime fmt: []const u8, args: anytype) void {
    ensureInit();
    const name = @tagName(cat);
    var msg_buf: [1024]u8 = undefined;
    const msg = std.fmt.bufPrint(&msg_buf, fmt, args) catch return;
    // .warn → bus emit + stderr fallthrough handled inside emitFromLog.
    _ = event_bus.emitFromLog(.warn, name, msg);
    if (enabled[@intFromEnum(cat)]) {
        var line_buf: [1100]u8 = undefined;
        const line = std.fmt.bufPrint(&line_buf, "[{s}] WARN: {s}\n", .{ name, msg }) catch return;
        fileWrite(line);
    }
}

pub fn err(cat: Category, comptime fmt: []const u8, args: anytype) void {
    ensureInit();
    const name = @tagName(cat);
    var msg_buf: [1024]u8 = undefined;
    const msg = std.fmt.bufPrint(&msg_buf, fmt, args) catch return;
    // .err → bus emit + stderr fallthrough handled inside emitFromLog.
    _ = event_bus.emitFromLog(.err, name, msg);
    if (enabled[@intFromEnum(cat)]) {
        var line_buf: [1100]u8 = undefined;
        const line = std.fmt.bufPrint(&line_buf, "[{s}] ERROR: {s}\n", .{ name, msg }) catch return;
        fileWrite(line);
    }
}

// ── Telemetry ────────────────────────────────────────────────────────────

pub fn telemetryEnabledMask() u16 {
    ensureInit();
    var mask: u16 = 0;
    for (0..NUM_CATEGORIES) |i| {
        if (enabled[i]) mask |= @as(u16, 1) << @intCast(i);
    }
    return mask;
}
