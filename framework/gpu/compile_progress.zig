//! Compile heartbeat (req_2692) — narrates slow, opaque GPU shader compiles to
//! stdout so a cold-driver-cache boot never reads as a hang.
//!
//! createShaderModule/createRenderPipeline are single blocking driver calls; on
//! a cold Mesa cache a megashader-class module (the effect fill catalog, the
//! ground formula) takes MINUTES with zero output. A concurrent Io task stays
//! silent for the first second (cache hits never log), then prints a line every
//! 2s — a real % when a previous slow compile on this machine left a duration
//! baseline (persisted per machine, scaled by WGSL size), plain elapsed seconds
//! plus a "building the driver cache" note when there is none.
//!
//! Usage (both effect pipelines and the 3d ground pipeline):
//!   var progress = CompileProgress{};
//!   progress.start(io, environ, wgsl.len);
//!   defer progress.stop();          // covers error paths
//!   ... createShaderModule / createRenderPipeline ...
//!   progress.finishOk();            // stops, prints "compiled in Xs", saves baseline

const std = @import("std");
const log = @import("../diag/log.zig");

/// The last slow compile's `<wgsl bytes> <duration ms>`, persisted per machine
/// so the NEXT cold compile (source changed, driver upgraded) can show a %.
fn baselinePath(environ: *const std.process.Environ.Map, buf: []u8) ?[]const u8 {
    if (environ.get("XDG_CACHE_HOME")) |dir| {
        return std.fmt.bufPrint(buf, "{s}/reactjit-effect-compile-baseline", .{dir}) catch null;
    }
    if (environ.get("HOME")) |home| {
        return std.fmt.bufPrint(buf, "{s}/.cache/reactjit-effect-compile-baseline", .{home}) catch null;
    }
    return null;
}

fn expectedMs(io: std.Io, environ: *const std.process.Environ.Map, wgsl_len: usize) ?u64 {
    var path_buf: [512]u8 = undefined;
    const path = baselinePath(environ, &path_buf) orelse return null;
    const file = std.Io.Dir.openFileAbsolute(io, path, .{}) catch return null;
    defer file.close(io);
    var buf: [64]u8 = undefined;
    const n = file.readPositionalAll(io, &buf, 0) catch return null;
    var it = std.mem.tokenizeAny(u8, buf[0..n], " \n");
    const bytes = std.fmt.parseInt(u64, it.next() orelse return null, 10) catch return null;
    const ms = std.fmt.parseInt(u64, it.next() orelse return null, 10) catch return null;
    if (bytes == 0 or ms == 0) return null;
    // Compile time scales roughly with source size; stretch the baseline to
    // this module's size so the % stays honest as the catalog grows.
    return @max(1, ms * @as(u64, wgsl_len) / bytes);
}

fn writeBaseline(io: std.Io, environ: *const std.process.Environ.Map, wgsl_len: usize, took_ms: i64) void {
    if (took_ms <= 0) return;
    var path_buf: [512]u8 = undefined;
    const path = baselinePath(environ, &path_buf) orelse return;
    var content_buf: [64]u8 = undefined;
    const content = std.fmt.bufPrint(&content_buf, "{d} {d}\n", .{ wgsl_len, took_ms }) catch return;
    const file = std.Io.Dir.createFileAbsolute(io, path, .{ .truncate = true }) catch return;
    defer file.close(io);
    file.writeStreamingAll(io, content) catch {};
}

pub const CompileProgress = struct {
    io: std.Io = undefined,
    environ: *const std.process.Environ.Map = undefined,
    group: std.Io.Group = .init,
    running: bool = false,
    started: std.Io.Timestamp = .zero,
    wgsl_len: usize = 0,
    wgsl_kb: u64 = 0,
    expected_ms: ?u64 = null,

    /// Heartbeats stay quiet this long so cache-hit compiles never log.
    pub const SILENT_MS: i64 = 1000;
    const LINE_EVERY_MS: i64 = 2000;

    pub fn start(self: *CompileProgress, io: std.Io, environ: *const std.process.Environ.Map, wgsl_len: usize) void {
        self.io = io;
        self.environ = environ;
        self.started = std.Io.Clock.now(.awake, io);
        self.wgsl_len = wgsl_len;
        self.wgsl_kb = @max(1, wgsl_len / 1024);
        self.expected_ms = expectedMs(io, environ, wgsl_len);
        self.group.concurrent(io, loop, .{self}) catch return;
        self.running = true;
    }

    /// Idempotent — success paths stop before printing their completion line
    /// (no heartbeat interleave); a defer'd stop covers error paths.
    pub fn stop(self: *CompileProgress) void {
        if (!self.running) return;
        self.group.cancel(self.io);
        self.running = false;
    }

    pub fn elapsedMs(self: *const CompileProgress) i64 {
        const now = std.Io.Clock.now(.awake, self.io);
        return @intCast(@divTrunc(now.toNanoseconds() - self.started.toNanoseconds(), std.time.ns_per_ms));
    }

    /// Stop and close the story: slow compiles get a "compiled in Xs" line and
    /// refresh the machine's baseline so the NEXT cold compile shows a %.
    pub fn finishOk(self: *CompileProgress) void {
        self.stop();
        const took_ms = self.elapsedMs();
        if (took_ms >= SILENT_MS) {
            log.print("[shaders] shader compiled in {d}.{d}s ({d} KB WGSL)\n", .{ @divTrunc(took_ms, 1000), @mod(@divTrunc(took_ms, 100), 10), self.wgsl_kb });
            writeBaseline(self.io, self.environ, self.wgsl_len, took_ms);
        }
    }

    fn loop(self: *CompileProgress) std.Io.Cancelable!void {
        var last_line_ms: i64 = 0;
        while (true) {
            try std.Io.sleep(self.io, .fromMilliseconds(200), .awake);
            const elapsed = self.elapsedMs();
            if (elapsed < SILENT_MS) continue;
            if (elapsed - last_line_ms < LINE_EVERY_MS) continue;
            last_line_ms = elapsed;
            const secs = @divTrunc(elapsed, 1000);
            var line_buf: [384]u8 = undefined;
            const line = if (self.expected_ms) |exp| blk: {
                const pct = @min(99, @as(u64, @intCast(elapsed)) * 100 / exp);
                break :blk std.fmt.bufPrint(
                    &line_buf,
                    "[shaders] compiling shader ({d} KB WGSL) — ~{d}% ({d}s)\n",
                    .{ self.wgsl_kb, pct, secs },
                ) catch return;
            } else std.fmt.bufPrint(
                &line_buf,
                "[shaders] compiling shader ({d} KB WGSL) — {d}s elapsed; first compile on this machine builds the driver's shader cache and can take minutes\n",
                .{ self.wgsl_kb, secs },
            ) catch return;
            // This task is deliberately concurrent with the driver-blocked
            // main thread. The normal logger is a single-producer queue, so
            // the heartbeat writes directly through its injected capability.
            std.Io.File.stderr().writeStreamingAll(self.io, line) catch |err| switch (err) {
                error.Canceled => return error.Canceled,
                else => return,
            };
        }
    }
};

test "compile heartbeat task starts and cancels through injected Io" {
    var environ = try std.testing.environ.createMap(std.testing.allocator);
    defer environ.deinit();
    var progress = CompileProgress{};
    progress.start(std.testing.io, &environ, 1024);
    progress.stop();
}
