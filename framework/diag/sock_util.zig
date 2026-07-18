//! Tiny socket helpers shared across diag/ modules. The repo has a richer
//! `framework/net/ipc.zig` for length-framed RPC; this file is for ad-hoc
//! UNIX/HTTP-style streams that just want a complete write.

const std = @import("std");

/// Complete a blocking stream write through the injected Zig 0.16 I/O
/// capability. The stream writer retains the platform-specific error in
/// `writer.err`, so return that instead of collapsing everything to
/// `error.WriteFailed`.
pub fn writeAll(io: std.Io, stream: std.Io.net.Stream, data: []const u8) std.Io.net.Stream.Writer.Error!void {
    var backing: [4096]u8 = undefined;
    var writer = stream.writer(io, &backing);
    writer.interface.writeAll(data) catch return writer.err orelse error.Unexpected;
    writer.interface.flush() catch return writer.err orelse error.Unexpected;
}

test "native stream write completes" {
    const io = std.testing.io;
    const address: std.Io.net.IpAddress = .{ .ip4 = .loopback(0) };
    var server = try address.listen(io, .{ .kernel_backlog = 1 });
    defer server.deinit(io);

    const client_address: std.Io.net.IpAddress = .{ .ip4 = .loopback(server.socket.address.getPort()) };
    const client = try client_address.connect(io, .{ .mode = .stream, .protocol = .tcp });
    defer client.close(io);
    const peer = try server.accept(io);
    defer peer.close(io);

    try writeAll(io, client, "complete");
    var backing: [32]u8 = undefined;
    var reader = peer.reader(io, &backing);
    var received: [8]u8 = undefined;
    reader.interface.readSliceAll(&received) catch |err| switch (err) {
        error.EndOfStream => return error.TestUnexpectedResult,
        error.ReadFailed => return reader.err orelse error.Unexpected,
    };
    try std.testing.expectEqualStrings("complete", &received);
}
