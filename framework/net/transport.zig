//! Explicit-Io transport primitives for the polling-facing network modules.
//!
//! Zig 0.16's network streams are blocking, cancelable capabilities.  The
//! framework still exposes frame-friendly `update` methods, so blocking reads
//! and accepts run in `std.Io.Group` tasks and hand completed work back through
//! bounded `std.Io.Queue` instances.  No socket flags or raw fd operations are
//! needed here.

const std = @import("std");

pub const Io = std.Io;
pub const Stream = Io.net.Stream;
pub const Server = Io.net.Server;
pub const IpAddress = Io.net.IpAddress;

const STREAM_QUEUE_CAPACITY = 128 * 1024;
const STREAM_READ_CAPACITY = 16 * 1024;
const ACCEPT_QUEUE_CAPACITY = 64;
const DATAGRAM_CAPACITY = 65_536;
const DATAGRAM_QUEUE_CAPACITY = 4;

pub fn connectHost(io: Io, host: []const u8, port: u16) !Stream {
    if (IpAddress.parse(host, port)) |address| {
        return address.connect(io, .{ .mode = .stream, .protocol = .tcp });
    } else |_| {}
    if (std.mem.indexOfScalar(u8, host, ':') != null) {
        const address = try IpAddress.resolve(io, host, port);
        return address.connect(io, .{ .mode = .stream, .protocol = .tcp });
    }

    const host_name = try Io.net.HostName.init(host);
    return host_name.connect(io, port, .{ .mode = .stream, .protocol = .tcp });
}

pub fn resolveHost(io: Io, host: []const u8, port: u16) !IpAddress {
    if (IpAddress.parse(host, port)) |address| return address else |_| {}
    if (std.mem.indexOfScalar(u8, host, ':') != null) return IpAddress.resolve(io, host, port);

    const host_name = try Io.net.HostName.init(host);
    var result_storage: [16]Io.net.HostName.LookupResult = undefined;
    var results: Io.Queue(Io.net.HostName.LookupResult) = .init(&result_storage);
    try host_name.lookup(io, &results, .{ .port = port });

    while (results.getOneUncancelable(io)) |result| switch (result) {
        .address => |address| return address,
        .canonical_name => {},
    } else |err| switch (err) {
        error.Closed => return error.NoAddressReturned,
    }
}

pub const StreamPump = struct {
    state: *State,
    terminal_reported: bool = false,

    const Terminal = enum(u8) { running, eof, failed };

    const State = struct {
        allocator: std.mem.Allocator,
        io: Io,
        stream: Stream,
        tasks: Io.Group = .init,
        bytes: Io.Queue(u8),
        byte_storage: [STREAM_QUEUE_CAPACITY]u8 = undefined,
        write_mutex: Io.Mutex = .init,
        readable: Io.Event = .unset,
        terminal: std.atomic.Value(Terminal) = .init(.running),
        read_error: ?Stream.Reader.Error = null,

        fn readLoop(state: *State) Io.Cancelable!void {
            var backing: [STREAM_READ_CAPACITY]u8 = undefined;
            var reader = state.stream.reader(state.io, &backing);

            while (true) {
                reader.interface.fillMore() catch |err| switch (err) {
                    error.EndOfStream => {
                        state.terminal.store(.eof, .release);
                        state.readable.set(state.io);
                        return;
                    },
                    error.ReadFailed => {
                        const read_err = reader.err orelse error.Unexpected;
                        if (read_err == error.Canceled) return error.Canceled;
                        state.read_error = read_err;
                        state.terminal.store(.failed, .release);
                        state.readable.set(state.io);
                        return;
                    },
                };

                const available = reader.interface.buffered();
                if (available.len == 0) continue;
                state.bytes.putAll(state.io, available) catch |err| switch (err) {
                    error.Canceled => return error.Canceled,
                    error.Closed => return,
                };
                state.readable.set(state.io);
                reader.interface.tossBuffered();
            }
        }
    };

    pub const ReadResult = union(enum) {
        empty,
        data: usize,
        closed,
        failed: Stream.Reader.Error,
    };

    pub fn init(allocator: std.mem.Allocator, io: Io, stream: Stream) !StreamPump {
        const state = try allocator.create(State);
        errdefer allocator.destroy(state);
        state.* = .{
            .allocator = allocator,
            .io = io,
            .stream = stream,
            .bytes = .init(&state.byte_storage),
        };
        try state.tasks.concurrent(io, State.readLoop, .{state});
        return .{ .state = state };
    }

    pub fn drain(pump: *StreamPump, out: []u8) ReadResult {
        if (out.len != 0) {
            const n = pump.state.bytes.getUncancelable(pump.state.io, out, 0) catch |err| switch (err) {
                error.Closed => 0,
            };
            if (n != 0) return .{ .data = n };
        }

        if (pump.terminal_reported) return .empty;
        return switch (pump.state.terminal.load(.acquire)) {
            .running => .empty,
            .eof => blk: {
                pump.terminal_reported = true;
                break :blk .closed;
            },
            .failed => blk: {
                pump.terminal_reported = true;
                break :blk .{ .failed = pump.state.read_error orelse error.Unexpected };
            },
        };
    }

    /// Waits until bytes or a terminal state are available, then performs one
    /// drain. Only one consumer may call `drain`/`drainWait` on a pump at a
    /// time; writers remain independently concurrent.
    pub fn drainWait(
        pump: *StreamPump,
        out: []u8,
        timeout: Io.Timeout,
    ) Io.Event.WaitTimeoutError!ReadResult {
        const immediate = pump.drain(out);
        switch (immediate) {
            .empty => {},
            else => return immediate,
        }

        // Clear a notification left by an earlier partial drain, then inspect
        // the queue again. This second inspection closes the set/reset race:
        // data arriving before reset is observed here, while data arriving
        // after it sets the event that we wait on below.
        const state = pump.state;
        state.readable.reset();
        const after_reset = pump.drain(out);
        switch (after_reset) {
            .empty => {},
            else => return after_reset,
        }

        try state.readable.waitTimeout(state.io, timeout);
        return pump.drain(out);
    }

    pub fn send(pump: *StreamPump, data: []const u8) Stream.Writer.Error!void {
        const state = pump.state;
        try state.write_mutex.lock(state.io);
        defer state.write_mutex.unlock(state.io);

        var backing: [4096]u8 = undefined;
        var writer = state.stream.writer(state.io, &backing);
        writer.interface.writeAll(data) catch return writer.err orelse error.Unexpected;
        writer.interface.flush() catch return writer.err orelse error.Unexpected;
    }

    pub fn deinit(pump: *StreamPump) void {
        const state = pump.state;
        _ = state.stream.shutdown(state.io, .both) catch {};
        state.tasks.cancel(state.io);
        state.bytes.close(state.io);
        state.stream.close(state.io);
        state.allocator.destroy(state);
        pump.* = undefined;
    }
};

pub const ListenerPump = struct {
    state: *State,

    const State = struct {
        allocator: std.mem.Allocator,
        io: Io,
        server: Server,
        tasks: Io.Group = .init,
        accepted: Io.Queue(Stream),
        accepted_storage: [ACCEPT_QUEUE_CAPACITY]Stream = undefined,
        failed: std.atomic.Value(bool) = .init(false),
        accept_error: ?Server.AcceptError = null,

        fn acceptLoop(state: *State) Io.Cancelable!void {
            while (true) {
                const stream = state.server.accept(state.io) catch |err| {
                    if (err == error.Canceled) return error.Canceled;
                    state.accept_error = err;
                    state.failed.store(true, .release);
                    return;
                };
                state.accepted.putOne(state.io, stream) catch |err| switch (err) {
                    error.Canceled => {
                        stream.close(state.io);
                        return error.Canceled;
                    },
                    error.Closed => {
                        stream.close(state.io);
                        return;
                    },
                };
            }
        }
    };

    pub fn init(allocator: std.mem.Allocator, io: Io, server: Server) !ListenerPump {
        const state = try allocator.create(State);
        errdefer allocator.destroy(state);
        state.* = .{
            .allocator = allocator,
            .io = io,
            .server = server,
            .accepted = .init(&state.accepted_storage),
        };
        try state.tasks.concurrent(io, State.acceptLoop, .{state});
        return .{ .state = state };
    }

    pub fn accept(pump: *ListenerPump) ?Stream {
        var out: [1]Stream = undefined;
        const n = pump.state.accepted.getUncancelable(pump.state.io, &out, 0) catch return null;
        return if (n == 1) out[0] else null;
    }

    pub fn port(pump: *const ListenerPump) u16 {
        return pump.state.server.socket.address.getPort();
    }

    pub fn failure(pump: *const ListenerPump) ?Server.AcceptError {
        if (!pump.state.failed.load(.acquire)) return null;
        return pump.state.accept_error orelse error.Unexpected;
    }

    pub fn deinit(pump: *ListenerPump) void {
        const state = pump.state;
        state.tasks.cancel(state.io);
        state.accepted.close(state.io);
        while (pump.accept()) |stream| stream.close(state.io);
        state.server.deinit(state.io);
        state.allocator.destroy(state);
        pump.* = undefined;
    }
};

pub const DatagramPump = struct {
    state: *State,
    terminal_reported: bool = false,

    pub const Packet = struct {
        len: usize,
        bytes: [DATAGRAM_CAPACITY]u8,
    };

    const Terminal = enum(u8) { running, failed };

    const State = struct {
        allocator: std.mem.Allocator,
        io: Io,
        socket: Io.net.Socket,
        peer: IpAddress,
        tasks: Io.Group = .init,
        packets: Io.Queue(Packet),
        packet_storage: [DATAGRAM_QUEUE_CAPACITY]Packet = undefined,
        terminal: std.atomic.Value(Terminal) = .init(.running),
        receive_error: ?Io.net.Socket.ReceiveError = null,

        fn receiveLoop(state: *State) Io.Cancelable!void {
            var packet: Packet = undefined;
            while (true) {
                const message = state.socket.receive(state.io, &packet.bytes) catch |err| {
                    if (err == error.Canceled) return error.Canceled;
                    state.receive_error = err;
                    state.terminal.store(.failed, .release);
                    return;
                };
                packet.len = message.data.len;
                state.packets.putOne(state.io, packet) catch |err| switch (err) {
                    error.Canceled => return error.Canceled,
                    error.Closed => return,
                };
            }
        }
    };

    pub const ReceiveResult = union(enum) {
        empty,
        packet: usize,
        failed: Io.net.Socket.ReceiveError,
    };

    pub fn connect(allocator: std.mem.Allocator, io: Io, peer: IpAddress) !DatagramPump {
        // Preserve connected-UDP semantics: the kernel filters inbound
        // datagrams to this peer and selects an ephemeral local address.
        const stream = try peer.connect(io, .{ .mode = .dgram, .protocol = .udp });
        const socket = stream.socket;
        errdefer socket.close(io);

        const state = try allocator.create(State);
        errdefer allocator.destroy(state);
        state.* = .{
            .allocator = allocator,
            .io = io,
            .socket = socket,
            .peer = peer,
            .packets = .init(&state.packet_storage),
        };
        try state.tasks.concurrent(io, State.receiveLoop, .{state});
        return .{ .state = state };
    }

    pub fn send(pump: *DatagramPump, data: []const u8) Io.net.Socket.SendError!void {
        return pump.state.socket.send(pump.state.io, &pump.state.peer, data);
    }

    pub fn receive(pump: *DatagramPump, out: []u8) ReceiveResult {
        var packet: [1]Packet = undefined;
        const n = pump.state.packets.getUncancelable(pump.state.io, &packet, 0) catch 0;
        if (n == 1) {
            const copy_len = @min(out.len, packet[0].len);
            @memcpy(out[0..copy_len], packet[0].bytes[0..copy_len]);
            return .{ .packet = copy_len };
        }
        if (pump.terminal_reported or pump.state.terminal.load(.acquire) == .running) return .empty;
        pump.terminal_reported = true;
        return .{ .failed = pump.state.receive_error orelse error.Unexpected };
    }

    pub fn deinit(pump: *DatagramPump) void {
        const state = pump.state;
        state.tasks.cancel(state.io);
        state.packets.close(state.io);
        state.socket.close(state.io);
        state.allocator.destroy(state);
        pump.* = undefined;
    }
};

test "literal host parsing stays allocation-free" {
    const address = try resolveHost(std.testing.io, "127.0.0.1", 7331);
    try std.testing.expectEqual(@as(u16, 7331), address.getPort());
}

test "stream pumps provide nonblocking polls and bounded waits" {
    const io = std.testing.io;
    const allocator = std.testing.allocator;
    const listen_address: IpAddress = .{ .ip4 = .loopback(0) };
    const server = try listen_address.listen(io, .{ .kernel_backlog = 1 });
    var listener = try ListenerPump.init(allocator, io, server);
    defer listener.deinit();

    const connect_address: IpAddress = .{ .ip4 = .loopback(listener.port()) };
    const client_stream = try connect_address.connect(io, .{ .mode = .stream, .protocol = .tcp });
    var client = try StreamPump.init(allocator, io, client_stream);
    defer client.deinit();

    const accepted = wait: for (0..1000) |_| {
        if (listener.accept()) |stream| break :wait stream;
        std.Io.sleep(io, .fromMilliseconds(1), .awake) catch {};
    } else return error.TestExpectedEqual;
    var peer = try StreamPump.init(allocator, io, accepted);
    defer peer.deinit();

    var buffer: [16]u8 = undefined;
    try std.testing.expectError(error.Timeout, peer.drainWait(&buffer, .{ .duration = .{
        .clock = .awake,
        .raw = .fromMilliseconds(1),
    } }));

    try client.send("ping");
    const result = try peer.drainWait(&buffer, .{ .duration = .{
        .clock = .awake,
        .raw = .fromMilliseconds(1_000),
    } });
    const received = switch (result) {
        .data => |n| n,
        .failed => |err| return err,
        .closed, .empty => return error.TestUnexpectedResult,
    };
    try std.testing.expectEqualStrings("ping", buffer[0..received]);
}

test "datagram pump preserves connected UDP request response semantics" {
    const io = std.testing.io;
    const allocator = std.testing.allocator;
    const listen_address: IpAddress = .{ .ip4 = .loopback(0) };
    const server = try listen_address.bind(io, .{ .mode = .dgram, .protocol = .udp });
    defer server.close(io);

    var client = try DatagramPump.connect(allocator, io, server.address);
    defer client.deinit();
    try client.send("ping");

    var request_buffer: [16]u8 = undefined;
    const request = try server.receiveTimeout(io, &request_buffer, .{ .duration = .{
        .clock = .awake,
        .raw = .fromMilliseconds(1_000),
    } });
    try std.testing.expectEqualStrings("ping", request.data);
    try server.send(io, &request.from, "pong");

    var response_buffer: [16]u8 = undefined;
    const received = wait: for (0..1_000) |_| {
        switch (client.receive(&response_buffer)) {
            .packet => |n| break :wait n,
            .failed => |err| return err,
            .empty => std.Io.sleep(io, .fromMilliseconds(1), .awake) catch {},
        }
    } else return error.TestExpectedEqual;
    try std.testing.expectEqualStrings("pong", response_buffer[0..received]);
}
