//! Tiny socket helpers shared across diag/ modules. The repo has a richer
//! `framework/net/ipc.zig` for length-framed RPC; this file is for ad-hoc
//! UNIX/HTTP-style sockets that just want a blocking write loop.

const std = @import("std");
const sysx = @import("../net/sysx.zig");

/// Blocking write loop — `std.posix.write` may return short on a socket; this
/// keeps going until `data` is fully drained or an error is hit.
pub fn writeAll(fd: std.posix.socket_t, data: []const u8) !void {
    var written: usize = 0;
    while (written < data.len) {
        const n = try sysx.write(fd, data[written..]);
        if (n == 0) return error.EarlyEof;
        written += n;
    }
}
