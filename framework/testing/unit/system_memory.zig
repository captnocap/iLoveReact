const std = @import("std");
const testing = std.testing;
const system_memory = @import("system_memory");

test "parse proc status memory fields in bytes" {
    const status =
        \\Name: rjit
        \\VmSize:   456789 kB
        \\VmRSS:    12345 kB
        \\Threads: 12
        \\
    ;
    const parsed = system_memory.parseProcStatus(status);
    try testing.expectEqual(@as(u64, 456789 * 1024), parsed.vsize_bytes);
    try testing.expectEqual(@as(u64, 12345 * 1024), parsed.rss_bytes);
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
