const std = @import("std");
const testing = std.testing;
const system_memory = @import("system_memory");

test "parse proc status memory fields in bytes" {
    const status =
        \\Name: rjit
        \\VmPeak:   567890 kB
        \\VmSize:   456789 kB
        \\VmHWM:    23456 kB
        \\VmRSS:    12345 kB
        \\RssAnon:  10000 kB
        \\RssFile:   2000 kB
        \\RssShmem:   345 kB
        \\VmData:   32100 kB
        \\VmStk:      132 kB
        \\VmExe:     1500 kB
        \\VmLib:     2200 kB
        \\VmSwap:     512 kB
        \\Threads: 12
        \\
    ;
    const parsed = system_memory.parseProcStatus(status);
    try testing.expectEqual(@as(u64, 567890 * 1024), parsed.vsize_peak_bytes);
    try testing.expectEqual(@as(u64, 456789 * 1024), parsed.vsize_bytes);
    try testing.expectEqual(@as(u64, 23456 * 1024), parsed.rss_peak_bytes);
    try testing.expectEqual(@as(u64, 12345 * 1024), parsed.rss_bytes);
    try testing.expectEqual(@as(u64, 10000 * 1024), parsed.rss_anon_bytes);
    try testing.expectEqual(@as(u64, 2000 * 1024), parsed.rss_file_bytes);
    try testing.expectEqual(@as(u64, 345 * 1024), parsed.rss_shmem_bytes);
    try testing.expectEqual(@as(u64, 32100 * 1024), parsed.data_bytes);
    try testing.expectEqual(@as(u64, 132 * 1024), parsed.stack_bytes);
    try testing.expectEqual(@as(u64, 1500 * 1024), parsed.exe_bytes);
    try testing.expectEqual(@as(u64, 2200 * 1024), parsed.lib_bytes);
    try testing.expectEqual(@as(u64, 512 * 1024), parsed.swap_bytes);
    try testing.expectEqual(@as(u32, 12), parsed.threads);
}

test "parse meminfo total and available fields in bytes" {
    const meminfo =
        \\MemTotal:       33456789 kB
        \\MemFree:         1111111 kB
        \\MemAvailable:   22334455 kB
        \\
    ;
    const parsed = system_memory.parseMemInfo(meminfo);
    try testing.expectEqual(@as(u64, 33456789 * 1024), parsed.total_bytes);
    try testing.expectEqual(@as(u64, 22334455 * 1024), parsed.available_bytes);
}

test "native allocator snapshot is internally consistent" {
    const allocator = system_memory.readAllocatorSnapshot();
    // On the Linux/glibc test host this also proves the mallinfo2 ABI. On other
    // targets the deliberately unsupported snapshot is all-zero.
    try testing.expect(allocator.in_use_bytes >= allocator.mmap_bytes);
    try testing.expect(allocator.arena_bytes >= allocator.free_bytes);
    try testing.expect(allocator.free_bytes >= allocator.releasable_bytes);
}

test "smaps parser assigns every mapping rss byte to one disjoint class" {
    const smaps =
        \\00400000-00452000 r-xp 00000000 08:01 1 /app/editor
        \\Size:                328 kB
        \\Rss:                 100 kB
        \\00652000-00653000 rw-p 00052000 08:01 1 /app/editor
        \\Rss:                  20 kB
        \\01000000-02000000 rw-p 00000000 00:00 0 [heap]
        \\Rss:                 300 kB
        \\70000000-71000000 rw-p 00000000 00:00 0
        \\Rss:                 400 kB
        \\72000000-72100000 rw-p 00000000 00:00 0 [anon:v8]
        \\Rss:                  50 kB
        \\7fff0000-80000000 rw-p 00000000 00:00 0 [stack]
        \\Rss:                  30 kB
        \\ffff0000-ffff1000 r-xp 00000000 00:00 0 [vdso]
        \\Rss:                   4 kB
        \\
    ;
    const parsed = system_memory.parseSmaps(smaps);
    try testing.expect(parsed.complete);
    try testing.expectEqual(@as(u32, 7), parsed.mapping_count);
    try testing.expectEqual(@as(u64, 120 * 1024), parsed.file_bytes);
    try testing.expectEqual(@as(u64, 300 * 1024), parsed.heap_bytes);
    try testing.expectEqual(@as(u64, 450 * 1024), parsed.anonymous_bytes);
    try testing.expectEqual(@as(u64, 30 * 1024), parsed.stack_bytes);
    try testing.expectEqual(@as(u64, 4 * 1024), parsed.special_bytes);
    try testing.expectEqual(
        parsed.total_bytes,
        parsed.file_bytes + parsed.heap_bytes + parsed.anonymous_bytes + parsed.stack_bytes + parsed.special_bytes,
    );
}
