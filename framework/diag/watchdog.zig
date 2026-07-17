//! Watchdog — spawns an external process to monitor RSS spikes and heartbeat.
//!
//! Ported from love2d/lua/watchdog.lua. The watchdog.sh script monitors
//! /proc/$PID/statm for sustained memory growth and kills the process
//! if it detects an infinite allocation loop (3 consecutive >50MB spikes).
//! Also detects frozen processes via heartbeat file staleness.

const std = @import("std");
const host_io = @import("../host_io.zig");
const log = @import("log.zig");
const builtin = @import("builtin");

extern "c" fn system(cmd: [*:0]const u8) c_int;

var g_heartbeat_path_buf: [128]u8 = undefined;
var g_heartbeat_path_len: usize = 0;
var g_clean_exit_path_buf: [128]u8 = undefined;
var g_clean_exit_path_len: usize = 0;
var g_initialized: bool = false;

/// Spawn the watchdog.sh script as a detached background process.
/// Linux only — /proc filesystem is required.
pub fn init() void {
    if (comptime builtin.os.tag != .linux) return;
    if (g_initialized) return;
    g_initialized = true;

    // Get our PID via libc
    const pid = std.os.linux.getpid();
    var pid_buf: [16]u8 = undefined;
    const pid_str = std.fmt.bufPrint(&pid_buf, "{d}", .{pid}) catch return;

    // Build paths
    const hb = std.fmt.bufPrint(&g_heartbeat_path_buf, "/tmp/reactjit_heartbeat_{s}", .{pid_str}) catch return;
    g_heartbeat_path_len = hb.len;
    const ce = std.fmt.bufPrint(&g_clean_exit_path_buf, "/tmp/reactjit_clean_exit_{s}", .{pid_str}) catch return;
    g_clean_exit_path_len = ce.len;

    // Clean stale files
    std.Io.Dir.cwd().deleteFile(host_io.io(), hb) catch {};
    std.Io.Dir.cwd().deleteFile(host_io.io(), ce) catch {};

    // Find watchdog.sh
    const script = findScript() orelse {
        log.print("[WATCHDOG] watchdog.sh not found, disabled\n", .{});
        return;
    };

    // Spawn via shell: nohup bash watchdog.sh PID 50 100 3000 >/dev/null &
    var cmd_buf: [256]u8 = undefined;
    const cmd = std.fmt.bufPrint(&cmd_buf, "nohup bash {s} {s} 50 100 3000 >/dev/null &", .{ script, pid_str }) catch return;

    // Null-terminate for system()
    var cmd_z: [257]u8 = undefined;
    @memcpy(cmd_z[0..cmd.len], cmd);
    cmd_z[cmd.len] = 0;

    _ = system(@ptrCast(&cmd_z));

    log.print("[WATCHDOG] PID {s} | spike=50MB sample=100ms warmup=3000ms\n", .{pid_str});
}

/// Write current timestamp to the heartbeat file.
/// Call every ~1 second from the main loop.
pub fn heartbeat() void {
    if (!g_initialized or g_heartbeat_path_len == 0) return;

    const ts = host_io.timestamp();
    var buf: [20]u8 = undefined;
    const ts_str = std.fmt.bufPrint(&buf, "{d}", .{ts}) catch return;

    // Write directly (not atomic — watchdog tolerates truncated reads)
    const path = g_heartbeat_path_buf[0..g_heartbeat_path_len];
    const file = std.Io.Dir.cwd().createFile(host_io.io(), path, .{}) catch return;
    defer file.close(host_io.io());
    file.writeStreamingAll(host_io.io(), ts_str) catch {};
}

/// Write the clean exit marker so the watchdog knows we shut down normally.
pub fn markCleanExit() void {
    if (!g_initialized or g_clean_exit_path_len == 0) return;

    const path = g_clean_exit_path_buf[0..g_clean_exit_path_len];
    const file = std.Io.Dir.cwd().createFile(host_io.io(), path, .{}) catch return;
    file.close(host_io.io());

    // Clean up heartbeat
    std.Io.Dir.cwd().deleteFile(host_io.io(), g_heartbeat_path_buf[0..g_heartbeat_path_len]) catch {};
}

fn findScript() ?[]const u8 {
    const candidates = [_][]const u8{
        "scripts/watchdog.sh",
        "../scripts/watchdog.sh",
    };
    for (candidates) |path| {
        std.Io.Dir.cwd().access(host_io.io(), path, .{}) catch continue;
        return path;
    }
    return null;
}
