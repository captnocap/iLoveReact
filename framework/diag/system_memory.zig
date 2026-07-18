//! system_memory — Linux `/proc` memory sampler for host telemetry.
//!
//! The editor dock wants the process's real RSS beside total system memory.
//! Keep the parsing here, away from V8 binding code, so it is testable and can
//! be reused by other diagnostics surfaces.

const std = @import("std");
const builtin = @import("builtin");
const host_io = struct {
    fn io() std.Io {
        return std.Io.Threaded.global_single_threaded.io();
    }
};

pub const ProcStatus = struct {
    rss_bytes: u64 = 0,
    rss_peak_bytes: u64 = 0,
    rss_anon_bytes: u64 = 0,
    rss_file_bytes: u64 = 0,
    rss_shmem_bytes: u64 = 0,
    vsize_bytes: u64 = 0,
    vsize_peak_bytes: u64 = 0,
    data_bytes: u64 = 0,
    stack_bytes: u64 = 0,
    exe_bytes: u64 = 0,
    lib_bytes: u64 = 0,
    swap_bytes: u64 = 0,
    threads: u32 = 0,
};

pub const MemInfo = struct {
    total_bytes: u64 = 0,
    available_bytes: u64 = 0,
};

pub const Snapshot = struct {
    process_rss_bytes: u64 = 0,
    process_rss_peak_bytes: u64 = 0,
    process_rss_anon_bytes: u64 = 0,
    process_rss_file_bytes: u64 = 0,
    process_rss_shmem_bytes: u64 = 0,
    process_vsize_bytes: u64 = 0,
    process_vsize_peak_bytes: u64 = 0,
    process_vm_data_bytes: u64 = 0,
    process_vm_stack_bytes: u64 = 0,
    process_vm_exe_bytes: u64 = 0,
    process_vm_lib_bytes: u64 = 0,
    process_vm_swap_bytes: u64 = 0,
    process_threads: u32 = 0,
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
        } else if (std.mem.startsWith(u8, line, "VmHWM:")) {
            status.rss_peak_bytes = parseFirstU64(line) * 1024;
        } else if (std.mem.startsWith(u8, line, "RssAnon:")) {
            status.rss_anon_bytes = parseFirstU64(line) * 1024;
        } else if (std.mem.startsWith(u8, line, "RssFile:")) {
            status.rss_file_bytes = parseFirstU64(line) * 1024;
        } else if (std.mem.startsWith(u8, line, "RssShmem:")) {
            status.rss_shmem_bytes = parseFirstU64(line) * 1024;
        } else if (std.mem.startsWith(u8, line, "VmSize:")) {
            status.vsize_bytes = parseFirstU64(line) * 1024;
        } else if (std.mem.startsWith(u8, line, "VmPeak:")) {
            status.vsize_peak_bytes = parseFirstU64(line) * 1024;
        } else if (std.mem.startsWith(u8, line, "VmData:")) {
            status.data_bytes = parseFirstU64(line) * 1024;
        } else if (std.mem.startsWith(u8, line, "VmStk:")) {
            status.stack_bytes = parseFirstU64(line) * 1024;
        } else if (std.mem.startsWith(u8, line, "VmExe:")) {
            status.exe_bytes = parseFirstU64(line) * 1024;
        } else if (std.mem.startsWith(u8, line, "VmLib:")) {
            status.lib_bytes = parseFirstU64(line) * 1024;
        } else if (std.mem.startsWith(u8, line, "VmSwap:")) {
            status.swap_bytes = parseFirstU64(line) * 1024;
        } else if (std.mem.startsWith(u8, line, "Threads:")) {
            status.threads = @intCast(@min(parseFirstU64(line), std.math.maxInt(u32)));
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
    var file = std.Io.Dir.openFileAbsolute(host_io.io(), path, .{}) catch return null;
    defer file.close(host_io.io());
    const n = file.readStreaming(host_io.io(), &.{buf}) catch return null;
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
        .process_rss_peak_bytes = status.rss_peak_bytes,
        .process_rss_anon_bytes = status.rss_anon_bytes,
        .process_rss_file_bytes = status.rss_file_bytes,
        .process_rss_shmem_bytes = status.rss_shmem_bytes,
        .process_vsize_bytes = status.vsize_bytes,
        .process_vsize_peak_bytes = status.vsize_peak_bytes,
        .process_vm_data_bytes = status.data_bytes,
        .process_vm_stack_bytes = status.stack_bytes,
        .process_vm_exe_bytes = status.exe_bytes,
        .process_vm_lib_bytes = status.lib_bytes,
        .process_vm_swap_bytes = status.swap_bytes,
        .process_threads = status.threads,
        .total_bytes = meminfo.total_bytes,
        .available_bytes = meminfo.available_bytes,
    };
}
