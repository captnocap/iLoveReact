//! system_memory — Linux `/proc` memory sampler for host telemetry.
//!
//! The editor dock wants the process's real RSS beside total system memory.
//! Keep the parsing here, away from V8 binding code, so it is testable and can
//! be reused by other diagnostics surfaces.

const std = @import("std");
const builtin = @import("builtin");

/// glibc's allocator-wide counters. These include allocations made through
/// libc by Zig, V8, wgpu, Mesa, and any other linked native library; they are
/// therefore an overlapping process view, not a subsystem total that may be
/// blindly added to the owner counters below. Linux/glibc is the editor's
/// current host target. Other targets return zeroes without referencing the
/// glibc-only symbols.
pub const AllocatorSnapshot = struct {
    arena_bytes: u64 = 0,
    mmap_bytes: u64 = 0,
    in_use_bytes: u64 = 0,
    free_bytes: u64 = 0,
    releasable_bytes: u64 = 0,
};

const MallInfo2 = extern struct {
    arena: usize,
    ordblks: usize,
    smblks: usize,
    hblks: usize,
    hblkhd: usize,
    usmblks: usize,
    fsmblks: usize,
    uordblks: usize,
    fordblks: usize,
    keepcost: usize,
};

extern fn mallinfo2() callconv(.c) MallInfo2;
extern fn malloc_trim(pad: usize) callconv(.c) c_int;

fn hasGlibcAllocatorApi() bool {
    return builtin.os.tag == .linux and builtin.target.abi.isGnu();
}

pub fn readAllocatorSnapshot() AllocatorSnapshot {
    if (comptime !hasGlibcAllocatorApi()) return .{};
    const m = mallinfo2();
    return .{
        .arena_bytes = m.arena,
        .mmap_bytes = m.hblkhd,
        .in_use_bytes = @as(u64, m.uordblks) + m.hblkhd,
        .free_bytes = m.fordblks,
        .releasable_bytes = m.keepcost,
    };
}

/// Ask glibc to return every currently-free top page to the OS. This is kept at
/// the narrow platform boundary because Zig's allocator interface has no
/// process-wide equivalent. Shader compilation calls it only after releasing
/// temporary shader modules/layouts; it never runs on the frame hot path.
pub fn trimAllocator() bool {
    if (comptime !hasGlibcAllocatorApi()) return false;
    return malloc_trim(0) != 0;
}

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

/// A disjoint kernel-VMA partition. Every mapping's `Rss:` value lands in
/// exactly one bucket, so `total_bytes` is an actual sum rather than a set of
/// overlapping allocator estimates.
pub const MappingRss = struct {
    heap_bytes: u64 = 0,
    anonymous_bytes: u64 = 0,
    file_bytes: u64 = 0,
    stack_bytes: u64 = 0,
    special_bytes: u64 = 0,
    total_bytes: u64 = 0,
    mapping_count: u32 = 0,
    complete: bool = false,
};

const MappingKind = enum { heap, anonymous, file, stack, special };

fn smapsHeaderKind(line: []const u8) ?MappingKind {
    var fields = std.mem.tokenizeScalar(u8, line, ' ');
    const address = fields.next() orelse return null;
    if (std.mem.indexOfScalar(u8, address, '-') == null) return null;
    _ = fields.next() orelse return null; // permissions
    _ = fields.next() orelse return null; // offset
    _ = fields.next() orelse return null; // device
    _ = fields.next() orelse return null; // inode
    const name = fields.next() orelse return .anonymous;
    if (std.mem.eql(u8, name, "[heap]")) return .heap;
    if (std.mem.startsWith(u8, name, "[stack")) return .stack;
    if (std.mem.startsWith(u8, name, "[anon:")) return .anonymous;
    if (name[0] == '[') return .special;
    return .file;
}

pub fn parseSmaps(text: []const u8) MappingRss {
    var out = MappingRss{ .complete = true };
    var current: ?MappingKind = null;
    var lines = std.mem.splitScalar(u8, text, '\n');
    while (lines.next()) |line| {
        if (smapsHeaderKind(line)) |kind| {
            current = kind;
            out.mapping_count += 1;
            continue;
        }
        if (!std.mem.startsWith(u8, line, "Rss:")) continue;
        const bytes = parseFirstU64(line) * 1024;
        switch (current orelse continue) {
            .heap => out.heap_bytes += bytes,
            .anonymous => out.anonymous_bytes += bytes,
            .file => out.file_bytes += bytes,
            .stack => out.stack_bytes += bytes,
            .special => out.special_bytes += bytes,
        }
        out.total_bytes += bytes;
    }
    if (out.mapping_count == 0) out.complete = false;
    return out;
}

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

fn readFileInto(io: std.Io, comptime path: []const u8, buf: []u8) ?[]const u8 {
    if (comptime builtin.os.tag != .linux) return null;
    var file = std.Io.Dir.openFileAbsolute(io, path, .{}) catch return null;
    defer file.close(io);
    const n = file.readStreaming(io, &.{buf}) catch return null;
    return buf[0..n];
}

pub fn readSnapshot(io: std.Io) Snapshot {
    if (comptime builtin.os.tag != .linux) return .{};

    var status_buf: [8192]u8 = undefined;
    const status = if (readFileInto(io, "/proc/self/status", &status_buf)) |text|
        parseProcStatus(text)
    else
        ProcStatus{};

    var meminfo_buf: [4096]u8 = undefined;
    const meminfo = if (readFileInto(io, "/proc/meminfo", &meminfo_buf)) |text|
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

/// Detailed `/proc/self/smaps` ownership is intentionally separate from
/// readSnapshot: shader compilation samples the lightweight status file every
/// 200 ms, while this larger mapping walk is only requested by the ~1 Hz memory
/// diagnostics door.
pub fn readMappingRss(io: std.Io) MappingRss {
    if (comptime builtin.os.tag != .linux) return .{};
    var file = std.Io.Dir.openFileAbsolute(io, "/proc/self/smaps", .{}) catch return .{};
    defer file.close(io);
    var buf: [512 * 1024]u8 = undefined;
    const n = file.readPositionalAll(io, &buf, 0) catch return .{};
    if (n == buf.len) return .{}; // never present a truncated partition as exact
    return parseSmaps(buf[0..n]);
}
