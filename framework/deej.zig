//! deej serial control-surface input (homemade fader boards).
//!
//! A deej board is an Arduino printing `|`-separated 10-bit fader values
//! ("1023|512|0|256|768\n") over USB serial. This module reads that stream
//! directly — plain POSIX serial, no ALSA, no MIDI. Linux only; other
//! platforms degrade to unavailable, same policy as audio/midi.zig.
//!
//! Physical faders can't be motorized, so the contract is one-way: the
//! board only speaks when a fader actually MOVES (raw delta past the ADC
//! jitter threshold, measured against the last emitted value). The first
//! complete line after a connect is adopted silently as the baseline so
//! plugging the board in never yanks whatever the faders happen to rest at.
//! The consumer's own UI stays authoritative the rest of the time.
//!
//! Port resolution: explicit start() arg > RJIT_DEEJ_PORT env var >
//! autodetect scan of /dev/ttyACM0-3 then /dev/ttyUSB0-3. A vanished
//! device (read error) drops to disconnected and the poll loop retries
//! the scan about once a second until the board comes back.

const std = @import("std");
const builtin = @import("builtin");

const MAX_SLIDERS: usize = 16;
const MAX_EVENTS: usize = 128;
const MAX_PORT: usize = 128;
const MAX_LINE: usize = 256;
const RAW_MAX: i32 = 1023;
/// Raw ADC delta a fader must cross (vs the last emitted value) to count
/// as a real move. Slow creep accumulates against the emitted value, so
/// it still gets through; endpoint touches (0 / 1023) always emit.
const JITTER_RAW: i32 = 4;
/// Polls between reopen attempts while disconnected (~1s at the hook's
/// default 30Hz drain).
const REOPEN_EVERY_POLLS: u32 = 30;
const READ_QUEUE_CAPACITY: usize = 4096;

pub const DeejEvent = struct {
    slider: u8 = 0,
    value: f32 = 0,
};

const State = struct {
    started: bool = false,
    allocator: ?std.mem.Allocator = null,
    reader: ?*SerialReader = null,
    port: [MAX_PORT]u8 = [_]u8{0} ** MAX_PORT,
    port_len: usize = 0,
    explicit: [MAX_PORT]u8 = [_]u8{0} ** MAX_PORT,
    explicit_len: usize = 0,
    baud: u32 = 9600,
    line: [MAX_LINE]u8 = [_]u8{0} ** MAX_LINE,
    line_len: usize = 0,
    /// Last EMITTED raw value per slider; -1 = no baseline yet.
    raw: [MAX_SLIDERS]i32 = [_]i32{-1} ** MAX_SLIDERS,
    count: usize = 0,
    seen_line: bool = false,
    events: [MAX_EVENTS]DeejEvent = [_]DeejEvent{.{}} ** MAX_EVENTS,
    head: usize = 0,
    tail: usize = 0,
    polls_since_reopen: u32 = 0,
};

var S: State = .{};

const SerialReader = struct {
    allocator: std.mem.Allocator,
    io: std.Io,
    file: std.Io.File,
    tasks: std.Io.Group = .init,
    bytes: std.Io.Queue(u8),
    byte_storage: [READ_QUEUE_CAPACITY]u8 = undefined,
    terminal: std.atomic.Value(bool) = .init(false),

    fn readLoop(self: *SerialReader) std.Io.Cancelable!void {
        var buf: [512]u8 = undefined;
        while (true) {
            const n = self.file.readStreaming(self.io, &.{&buf}) catch |err| switch (err) {
                error.Canceled => return error.Canceled,
                error.EndOfStream => {
                    self.terminal.store(true, .release);
                    return;
                },
                else => {
                    self.terminal.store(true, .release);
                    return;
                },
            };
            if (n == 0) continue;
            self.bytes.putAll(self.io, buf[0..n]) catch |err| switch (err) {
                error.Canceled => return error.Canceled,
                error.Closed => return,
            };
        }
    }

    fn create(allocator: std.mem.Allocator, io: std.Io, file: std.Io.File) !*SerialReader {
        const self = try allocator.create(SerialReader);
        errdefer allocator.destroy(self);
        self.* = .{
            .allocator = allocator,
            .io = io,
            .file = file,
            .bytes = .init(&self.byte_storage),
        };
        try self.tasks.concurrent(io, readLoop, .{self});
        return self;
    }

    fn destroy(self: *SerialReader) void {
        self.tasks.cancel(self.io);
        self.bytes.close(self.io);
        self.file.close(self.io);
        self.allocator.destroy(self);
    }
};

pub fn start(io: std.Io, environ: *const std.process.Environ.Map, allocator: std.mem.Allocator, port: ?[]const u8, baud: u32) bool {
    if (builtin.os.tag != .linux) return false;
    S.baud = if (baud == 0) 9600 else baud;
    S.allocator = allocator;
    S.explicit_len = 0;
    if (port) |p| {
        if (p.len > 0 and p.len < MAX_PORT) {
            @memcpy(S.explicit[0..p.len], p);
            S.explicit_len = p.len;
        }
    }
    S.started = true;
    S.polls_since_reopen = 0;
    if (S.reader == null) _ = tryOpen(io, environ);
    return true;
}

pub fn stop() void {
    disconnect();
    S.started = false;
}

pub fn isStarted() bool {
    return S.started;
}

pub fn isConnected() bool {
    return S.reader != null;
}

/// Drain the serial line and queue move events. Returns queued count.
pub fn poll(io: std.Io, environ: *const std.process.Environ.Map) u32 {
    if (!S.started or builtin.os.tag != .linux) return 0;
    if (S.reader == null) {
        S.polls_since_reopen += 1;
        if (S.polls_since_reopen >= REOPEN_EVERY_POLLS) {
            S.polls_since_reopen = 0;
            _ = tryOpen(io, environ);
        }
    }
    const reader = S.reader orelse return queuedCount();
    var buf: [512]u8 = undefined;
    while (true) {
        const n = reader.bytes.getUncancelable(io, &buf, 0) catch 0;
        if (n == 0) break;
        feed(buf[0..n]);
    }
    if (reader.terminal.load(.acquire)) disconnect();
    return queuedCount();
}

pub fn nextEvent() ?DeejEvent {
    if (S.head == S.tail) return null;
    const ev = S.events[S.head];
    S.head = (S.head + 1) % MAX_EVENTS;
    return ev;
}

pub fn eventJson(ev: DeejEvent, buf: []u8) []const u8 {
    return std.fmt.bufPrint(buf, "{{\"slider\":{d},\"value\":{d:.4}}}", .{ ev.slider, ev.value }) catch "";
}

pub fn stateJson(buf: []u8) []const u8 {
    var w = std.Io.Writer.fixed(buf);
    w.print("{{\"connected\":{},\"port\":\"{s}\",\"count\":{d},\"values\":[", .{
        S.reader != null, S.port[0..S.port_len], S.count,
    }) catch return "{}";
    var i: usize = 0;
    while (i < S.count) : (i += 1) {
        if (i > 0) w.print(",", .{}) catch return "{}";
        const raw: f32 = @floatFromInt(if (S.raw[i] < 0) 0 else S.raw[i]);
        w.print("{d:.4}", .{raw / @as(f32, @floatFromInt(RAW_MAX))}) catch return "{}";
    }
    w.print("]}}", .{}) catch return "{}";
    return w.buffered();
}

// ── internals ──────────────────────────────────────────────

fn disconnect() void {
    if (S.reader) |reader| reader.destroy();
    S.reader = null;
    S.line_len = 0;
    S.seen_line = false;
}

fn tryOpen(io: std.Io, environ: *const std.process.Environ.Map) bool {
    if (S.explicit_len > 0) return openPort(io, S.explicit[0..S.explicit_len]);
    if (environ.get("RJIT_DEEJ_PORT")) |env_port| {
        if (env_port.len > 0) return openPort(io, env_port);
    }
    const candidates = [_][]const u8{
        "/dev/ttyACM0", "/dev/ttyACM1", "/dev/ttyACM2", "/dev/ttyACM3",
        "/dev/ttyUSB0", "/dev/ttyUSB1", "/dev/ttyUSB2", "/dev/ttyUSB3",
    };
    for (candidates) |path| {
        if (openPort(io, path)) return true;
    }
    return false;
}

fn openPort(io: std.Io, path: []const u8) bool {
    if (path.len >= MAX_PORT) return false;
    const file = std.Io.Dir.openFileAbsolute(io, path, .{ .mode = .read_only }) catch return false;
    if (!configureSerial(file.handle, S.baud)) {
        file.close(io);
        return false;
    }
    const allocator = S.allocator orelse {
        file.close(io);
        return false;
    };
    S.reader = SerialReader.create(allocator, io, file) catch {
        file.close(io);
        return false;
    };
    @memcpy(S.port[0..path.len], path);
    S.port_len = path.len;
    S.line_len = 0;
    S.seen_line = false;
    S.raw = [_]i32{-1} ** MAX_SLIDERS;
    return true;
}

fn speedFor(baud: u32) std.posix.speed_t {
    return switch (baud) {
        19200 => .B19200,
        38400 => .B38400,
        57600 => .B57600,
        115200 => .B115200,
        else => .B9600,
    };
}

/// Raw 8N1 read-only mode. Also confirms the fd is actually a tty —
/// tcgetattr fails on anything else, which is what makes the autodetect
/// scan safe.
fn configureSerial(fd: std.posix.fd_t, baud: u32) bool {
    var tio = std.posix.tcgetattr(fd) catch return false;
    const spd = speedFor(baud);
    tio.iflag = .{};
    tio.oflag = .{};
    tio.lflag = .{};
    var cf: std.os.linux.tc_cflag_t = .{ .CSIZE = .CS8, .CREAD = true, .CLOCAL = true };
    if (@hasField(std.os.linux.tc_cflag_t, "_0")) {
        // Kernel baud lives in cflag: CBAUD low bits (bits 0-3) + CBAUDEX
        // (bit 12). Zeroing the rest of _12 also clears CIBAUD, so input
        // speed follows output speed.
        const v: u32 = @intFromEnum(spd);
        cf._0 = @truncate(v & 0xF);
        cf._12 = @truncate((v >> 12) & 0x1);
    }
    tio.cflag = cf;
    tio.cc[@intFromEnum(std.os.linux.V.MIN)] = 0;
    tio.cc[@intFromEnum(std.os.linux.V.TIME)] = 0;
    tio.ispeed = spd;
    tio.ospeed = spd;
    std.posix.tcsetattr(fd, .NOW, tio) catch return false;
    return true;
}

fn feed(bytes: []const u8) void {
    for (bytes) |b| {
        if (b == '\n') {
            parseLine(S.line[0..S.line_len]);
            S.line_len = 0;
            continue;
        }
        if (b == '\r') continue;
        if (S.line_len >= MAX_LINE) {
            // Garbage flood (wrong baud, boot noise) — drop and resync.
            S.line_len = 0;
            continue;
        }
        S.line[S.line_len] = b;
        S.line_len += 1;
    }
}

fn parseLine(line: []const u8) void {
    var vals: [MAX_SLIDERS]i32 = undefined;
    var n: usize = 0;
    var it = std.mem.tokenizeAny(u8, line, "| ,\t");
    while (it.next()) |tok| {
        if (n >= MAX_SLIDERS) break;
        const v = std.fmt.parseInt(i32, tok, 10) catch return;
        vals[n] = std.math.clamp(v, 0, RAW_MAX);
        n += 1;
    }
    if (n == 0) return;
    if (!S.seen_line or n != S.count) {
        // Baseline (or board firmware changed slider count): adopt
        // silently so connecting never fires a phantom move.
        S.count = n;
        @memcpy(S.raw[0..n], vals[0..n]);
        S.seen_line = true;
        return;
    }
    var i: usize = 0;
    while (i < n) : (i += 1) {
        const old = S.raw[i];
        const new = vals[i];
        const endpoint_touch = (new == 0 or new == RAW_MAX) and new != old;
        if (@abs(new - old) <= JITTER_RAW and !endpoint_touch) continue;
        S.raw[i] = new;
        pushEvent(.{
            .slider = @intCast(i),
            .value = @as(f32, @floatFromInt(new)) / @as(f32, @floatFromInt(RAW_MAX)),
        });
    }
}

fn pushEvent(ev: DeejEvent) void {
    S.events[S.tail] = ev;
    S.tail = (S.tail + 1) % MAX_EVENTS;
    if (S.tail == S.head) S.head = (S.head + 1) % MAX_EVENTS;
}

fn queuedCount() u32 {
    return @intCast((S.tail + MAX_EVENTS - S.head) % MAX_EVENTS);
}

// ── tests (pure parser paths; no device needed) ────────────

fn resetForTest() void {
    S = .{};
    S.started = true;
}

test "first line is a silent baseline" {
    resetForTest();
    feed("512|1023|0|300|700\n");
    try std.testing.expectEqual(@as(usize, 5), S.count);
    try std.testing.expect(nextEvent() == null);
}

test "move past jitter emits, jitter alone does not" {
    resetForTest();
    feed("512|512|512|512|512\n");
    feed("514|512|512|512|512\n");
    try std.testing.expect(nextEvent() == null);
    feed("600|512|512|512|512\n");
    const ev = nextEvent().?;
    try std.testing.expectEqual(@as(u8, 0), ev.slider);
    try std.testing.expectApproxEqAbs(@as(f32, 600.0 / 1023.0), ev.value, 0.001);
    try std.testing.expect(nextEvent() == null);
}

test "slow creep accumulates against last emitted value" {
    resetForTest();
    feed("100|0|0|0|0\n");
    feed("103|0|0|0|0\n");
    feed("106|0|0|0|0\n");
    try std.testing.expect(nextEvent().?.slider == 0);
}

test "endpoint touch always emits" {
    resetForTest();
    feed("3|0|0|0|0\n");
    feed("0|0|0|0|0\n");
    const ev = nextEvent().?;
    try std.testing.expectEqual(@as(f32, 0), ev.value);
}

test "garbage lines and partial chunks are ignored" {
    resetForTest();
    feed("boot noise\n51");
    feed("2|512|512|512|512\n");
    try std.testing.expectEqual(@as(usize, 5), S.count);
    try std.testing.expect(nextEvent() == null);
    feed("not|a|number|x|y\n");
    try std.testing.expect(nextEvent() == null);
}

test "start degrades cleanly with no device" {
    resetForTest();
    var environ = std.process.Environ.Map.init(std.testing.allocator);
    defer environ.deinit();
    try std.testing.expect(start(std.testing.io, &environ, std.testing.allocator, "/dev/definitely-not-a-real-port", 9600));
    try std.testing.expect(!isConnected());
    _ = poll(std.testing.io, &environ);
    var buf: [512]u8 = undefined;
    try std.testing.expect(std.mem.indexOf(u8, stateJson(&buf), "\"connected\":false") != null);
    stop();
}
