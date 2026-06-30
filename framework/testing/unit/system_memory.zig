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
