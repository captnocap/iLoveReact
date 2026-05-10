//! Standalone HTTP client test — verifies ring buffer + std.http.Client worker pool.
//! Run: zig build-exe framework/testing/unit/http.zig && ./http

const std = @import("std");
const log = @import("../../diag/log.zig");
const http = @import("../../net/http.zig");

pub fn main() !void {
    log.print("=== HTTP Client Test ===\n", .{});

    // Init
    http.init();
    defer http.destroy();
    log.print("[ok] Workers spawned\n", .{});

    // Queue a GET request
    _ = http.request(1, .{ .url = "https://httpbin.org/get" });
    log.print("[ok] Request queued (id=1, GET https://httpbin.org/get)\n", .{});

    // Queue a second request
    _ = http.request(2, .{ .url = "https://httpbin.org/status/404" });
    log.print("[ok] Request queued (id=2, GET https://httpbin.org/status/404)\n", .{});

    // Poll for responses (with timeout)
    var completed: u32 = 0;
    var attempts: u32 = 0;
    while (completed < 2 and attempts < 600) : (attempts += 1) {
        var responses: [16]http.Response = undefined;
        const n = http.poll(&responses);
        for (responses[0..n]) |resp| {
            completed += 1;
            if (resp.response_type == .err) {
                log.print("[response id={d}] ERROR: {s}\n", .{ resp.id, resp.errorSlice() });
            } else {
                log.print("[response id={d}] status={d} body_len={d} body_preview=\"{s}\"\n", .{
                    resp.id,
                    resp.status,
                    resp.body_len,
                    resp.bodySlice()[0..@min(resp.body_len, 80)],
                });
            }
        }
        if (completed < 2) std.Thread.sleep(50_000_000); // 50ms
    }

    if (completed >= 2) {
        log.print("\n[PASS] All {d} responses received\n", .{completed});
    } else {
        log.print("\n[FAIL] Only {d}/2 responses received (timeout)\n", .{completed});
    }
}
