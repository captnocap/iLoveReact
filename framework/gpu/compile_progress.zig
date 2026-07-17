//! Compile heartbeat (req_2692) — narrates slow, opaque GPU shader compiles to
//! stdout so a cold-driver-cache boot never reads as a hang.
//!
//! createShaderModule/createRenderPipeline are single blocking driver calls; on
//! a cold Mesa cache a megashader-class module (the effect fill catalog, the
//! ground formula) takes MINUTES with zero output. A watchdog thread stays
//! silent for the first second (cache hits never log), then prints a line every
//! 2s — a real % when a previous slow compile on this machine left a duration
//! baseline (persisted per machine, scaled by WGSL size), plain elapsed seconds
//! plus a "building the driver cache" note when there is none.
//!
//! Usage (both effect pipelines and the 3d ground pipeline):
//!   var progress = CompileProgress{};
//!   progress.start(wgsl.len);
//!   defer progress.stop();          // covers error paths
//!   ... createShaderModule / createRenderPipeline ...
//!   progress.finishOk();            // stops, prints "compiled in Xs", saves baseline

const std = @import("std");
const host_io = @import("../host_io.zig");
const log = @import("../diag/log.zig");

/// The last slow compile's `<wgsl bytes> <duration ms>`, persisted per machine
/// so the NEXT cold compile (source changed, driver upgraded) can show a %.
fn baselinePath(buf: []u8) ?[]const u8 {
    if (std.posix.getenv("XDG_CACHE_HOME")) |dir| {
        return std.fmt.bufPrint(buf, "{s}/reactjit-effect-compile-baseline", .{dir}) catch null;
    }
    if (std.posix.getenv("HOME")) |home| {
        return std.fmt.bufPrint(buf, "{s}/.cache/reactjit-effect-compile-baseline", .{home}) catch null;
    }
    return null;
}

fn expectedMs(wgsl_len: usize) ?u64 {
    var path_buf: [512]u8 = undefined;
    const path = baselinePath(&path_buf) orelse return null;
    const file = std.fs.openFileAbsolute(path, .{}) catch return null;
    defer file.close();
    var buf: [64]u8 = undefined;
    const n = file.read(&buf) catch return null;
    var it = std.mem.tokenizeAny(u8, buf[0..n], " \n");
    const bytes = std.fmt.parseInt(u64, it.next() orelse return null, 10) catch return null;
    const ms = std.fmt.parseInt(u64, it.next() orelse return null, 10) catch return null;
    if (bytes == 0 or ms == 0) return null;
    // Compile time scales roughly with source size; stretch the baseline to
    // this module's size so the % stays honest as the catalog grows.
    return @max(1, ms * @as(u64, wgsl_len) / bytes);
}

fn writeBaseline(wgsl_len: usize, took_ms: i64) void {
    if (took_ms <= 0) return;
    var path_buf: [512]u8 = undefined;
    const path = baselinePath(&path_buf) orelse return;
    var content_buf: [64]u8 = undefined;
    const content = std.fmt.bufPrint(&content_buf, "{d} {d}\n", .{ wgsl_len, took_ms }) catch return;
    const file = std.fs.createFileAbsolute(path, .{ .truncate = true }) catch return;
    defer file.close();
    file.writeAll(content) catch {};
}

pub const CompileProgress = struct {
    done: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    thread: ?std.Thread = null,
    start_ms: i64 = 0,
    wgsl_len: usize = 0,
    wgsl_kb: u64 = 0,
    expected_ms: ?u64 = null,

    /// Heartbeats stay quiet this long so cache-hit compiles never log.
    pub const SILENT_MS: i64 = 1000;
    const LINE_EVERY_MS: i64 = 2000;

    pub fn start(self: *CompileProgress, wgsl_len: usize) void {
        self.start_ms = host_io.milliTimestamp();
        self.wgsl_len = wgsl_len;
        self.wgsl_kb = @max(1, wgsl_len / 1024);
        self.expected_ms = expectedMs(wgsl_len);
        self.thread = std.Thread.spawn(.{}, loop, .{self}) catch null;
    }

    /// Idempotent — success paths stop before printing their completion line
    /// (no heartbeat interleave); a defer'd stop covers error paths.
    pub fn stop(self: *CompileProgress) void {
        self.done.store(true, .release);
        if (self.thread) |t| {
            t.join();
            self.thread = null;
        }
    }

    pub fn elapsedMs(self: *const CompileProgress) i64 {
        return host_io.milliTimestamp() - self.start_ms;
    }

    /// Stop and close the story: slow compiles get a "compiled in Xs" line and
    /// refresh the machine's baseline so the NEXT cold compile shows a %.
    pub fn finishOk(self: *CompileProgress) void {
        self.stop();
        const took_ms = self.elapsedMs();
        if (took_ms >= SILENT_MS) {
            log.print("[shaders] shader compiled in {d}.{d}s ({d} KB WGSL)\n", .{ @divTrunc(took_ms, 1000), @mod(@divTrunc(took_ms, 100), 10), self.wgsl_kb });
            writeBaseline(self.wgsl_len, took_ms);
        }
    }

    fn loop(self: *CompileProgress) void {
        var last_line_ms: i64 = 0;
        while (!self.done.load(.acquire)) {
            std.Thread.sleep(200 * std.time.ns_per_ms);
            const elapsed = self.elapsedMs();
            if (elapsed < SILENT_MS) continue;
            if (elapsed - last_line_ms < LINE_EVERY_MS) continue;
            last_line_ms = elapsed;
            const secs = @divTrunc(elapsed, 1000);
            if (self.expected_ms) |exp| {
                const pct = @min(99, @as(u64, @intCast(elapsed)) * 100 / exp);
                log.print("[shaders] compiling shader ({d} KB WGSL) — ~{d}% ({d}s)\n", .{ self.wgsl_kb, pct, secs });
            } else {
                log.print("[shaders] compiling shader ({d} KB WGSL) — {d}s elapsed; first compile on this machine builds the driver's shader cache and can take minutes\n", .{ self.wgsl_kb, secs });
            }
        }
    }
};
