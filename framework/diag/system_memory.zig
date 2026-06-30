//! system_memory — Linux `/proc` memory sampler for host telemetry.
//!
//! The editor dock wants the process's real RSS beside total system memory.
//! Keep the parsing here, away from V8 binding code, so it is testable and can
//! be reused by other diagnostics surfaces.

const std = @import("std");
const builtin = @import("builtin");

pub const ProcStatus = struct {
    rss_bytes: u64 = 0,
    vsize_bytes: u64 = 0,
};

pub const MemInfo = struct {
    total_bytes: u64 = 0,
    available_bytes: u64 = 0,
};

pub const Snapshot = struct {
    process_rss_bytes: u64 = 0,
    process_vsize_bytes: u64 = 0,
    total_bytes: u64 = 0,
    available_bytes: u64 = 0,
};

pub fn parseFirstU64(line: []const u8) u64 {
    var p: usize = 0;
    while (p < line.len and (line[p] < '0' or line[p] > '9')) p += 1;
    const start = p;
    while (p < line.len and line[p] >= '0' and line[p] <= '9') p += 1;
    if (start == p) return 0;
    return std.fmt.parseInt(u64, line[start..p], 10) catch 0;
}

pub fn parseProcStatus(text: []const u8) ProcStatus {
    var status = ProcStatus{};
    var line_iter = std.mem.splitScalar(u8, text, '\n');
    while (line_iter.next()) |line| {
        if (std.mem.startsWith(u8, line, "VmRSS:")) {
            status.rss_bytes = parseFirstU64(line) * 1024;
        } else if (std.mem.startsWith(u8, line, "VmSize:")) {
            status.vsize_bytes = parseFirstU64(line) * 1024;
        }
    }
    return status;
}

pub fn parseMemInfo(text: []const u8) MemInfo {
    var info = MemInfo{};
    var line_iter = std.mem.splitScalar(u8, text, '\n');
    while (line_iter.next()) |line| {
        if (std.mem.startsWith(u8, line, "MemTotal:")) {
            info.total_bytes = parseFirstU64(line) * 1024;
        } else if (std.mem.startsWith(u8, line, "MemAvailable:")) {
            info.available_bytes = parseFirstU64(line) * 1024;
        }
    }
    return info;
}

fn readFileInto(comptime path: []const u8, buf: []u8) ?[]const u8 {
    if (comptime builtin.os.tag != .linux) return null;
    var file = std.fs.openFileAbsolute(path, .{}) catch return null;
    defer file.close();
    const n = file.read(buf) catch return null;
    return buf[0..n];
}

pub fn readSnapshot() Snapshot {
    if (comptime builtin.os.tag != .linux) return .{};

    var status_buf: [8192]u8 = undefined;
    const status = if (readFileInto("/proc/self/status", &status_buf)) |text|
        parseProcStatus(text)
    else
        ProcStatus{};

    var meminfo_buf: [4096]u8 = undefined;
    const meminfo = if (readFileInto("/proc/meminfo", &meminfo_buf)) |text|
        parseMemInfo(text)
    else
        MemInfo{};

    return .{
        .process_rss_bytes = status.rss_bytes,
        .process_vsize_bytes = status.vsize_bytes,
        .total_bytes = meminfo.total_bytes,
        .available_bytes = meminfo.available_bytes,
    };
}
