//! UDS server — listens on a Unix domain socket path, accepts inbound
//! connections, exposes per-connection read/write/close. Blocking native
//! `std.Io.net` operations run in cancelable tasks and are drained by host
//! bindings each tick.
//!
//! Used for two cases today:
//!   1. Firecracker vsock guest→host connections. Firecracker creates
//!      one UDS per (guest UDS path, port) pair on the host side at
//!      `<vsock_uds>_<port>`. The host process must listen there before
//!      the guest dials. We use this to accept the guest-side workspace
//!      sync daemon's connection on port 5002.
//!   2. Any other intra-machine IPC that wants a server-shaped channel
//!      driven from JS without a Python subprocess.
//!
//! Usage:
//!   var srv = try uds.UdsServer.listen(allocator, io, "/tmp/foo.sock");
//!   defer srv.deinit();
//!   var ev_buf: [16]uds.Event = undefined;
//!   const n = srv.update(&ev_buf);
//!   for (ev_buf[0..n]) |ev| switch (ev) {
//!       .accepted => |conn_id| ...,
//!       .data     => |d| process(d.conn_id, d.bytes),
//!       .closed   => |conn_id| ...,
//!       .err      => |e| ...,
//!   };
//!   srv.send(conn_id, bytes);
//!   srv.closeConn(conn_id);

const std = @import("std");
const transport = @import("transport.zig");
const workspace = @import("../sync/workspace.zig");

const READ_BUF = 65536;
const MAX_CONNS = 16;

pub const EventTag = enum { accepted, data, closed, err };

pub const Event = union(EventTag) {
    accepted: u32,
    data: struct { conn_id: u32, bytes: []const u8 },
    closed: u32,
    err: struct { conn_id: u32, msg: []const u8 },
};

const Conn = struct {
    stream: ?transport.StreamPump = null,
    active: bool = false,
    read_buf: [READ_BUF]u8 = undefined,
    err_buf: [128]u8 = undefined,
    /// When the server is in "workspace mode", incoming bytes feed
    /// this parser instead of being emitted to JS. The parser writes
    /// SET/DEL/DIR frames directly to the workspace root.
    parser: ?workspace.InboundParser = null,
};

pub const UdsServer = struct {
    allocator: std.mem.Allocator,
    io: std.Io,
    listener: transport.ListenerPump,
    path_buf: [108]u8 = undefined, // sun_path max is 108 on Linux
    path_len: usize = 0,
    conns: [MAX_CONNS]Conn = [_]Conn{.{}} ** MAX_CONNS,
    /// Optional workspace mode. When set, accepted connections route
    /// inbound bytes through workspace.InboundParser. The root is
    /// owned by the server and freed in deinit.
    workspace_root: ?[]u8 = null,
    workspace_allocator: std.mem.Allocator = std.heap.c_allocator,

    /// Bind + listen on the given UDS path. Removes any stale file at
    /// that path first. The path is copied into the server so callers
    /// don't need to keep it alive.
    pub fn listen(allocator: std.mem.Allocator, io: std.Io, path: []const u8) !UdsServer {
        if (path.len >= std.Io.net.UnixAddress.max_len) return error.PathTooLong;

        // Clean up any stale UDS file at this path. ENOENT is fine.
        std.Io.Dir.deleteFileAbsolute(io, path) catch |e| switch (e) {
            error.FileNotFound => {},
            else => return e,
        };

        const address = try std.Io.net.UnixAddress.init(path);
        var server = try address.listen(io, .{ .kernel_backlog = 8 });
        errdefer server.deinit(io);

        // Tighten perms so only this user can dial. fchmodat takes a
        // path slice (not toPosixPath) in this Zig version; null-byte
        // termination is handled internally.
        std.Io.Dir.cwd().setFilePermissions(io, path, .fromMode(0o600), .{}) catch {};

        var self = UdsServer{
            .allocator = allocator,
            .io = io,
            .listener = try transport.ListenerPump.init(allocator, io, server),
        };
        @memcpy(self.path_buf[0..path.len], path);
        self.path_len = path.len;
        return self;
    }

    pub fn deinit(self: *UdsServer) void {
        for (&self.conns) |*c| {
            if (c.active) {
                if (c.stream) |*stream| stream.deinit();
                c.stream = null;
                c.active = false;
            }
            if (c.parser) |*p| {
                p.deinit();
                c.parser = null;
            }
        }
        self.listener.deinit();
        if (self.path_len > 0) {
            std.Io.Dir.deleteFileAbsolute(self.io, self.path_buf[0..self.path_len]) catch {};
        }
        if (self.workspace_root) |root| {
            self.workspace_allocator.free(root);
            self.workspace_root = null;
        }
    }

    /// Switch the server into "workspace sync mode". Inbound bytes on
    /// all (current and future) connections are routed to a frame
    /// parser that applies SET/DEL/DIR/INIT frames to `root_path` on
    /// the local filesystem. Outbound is still the caller's job via
    /// the writer helpers in framework/sync/workspace.zig.
    pub fn setWorkspaceRoot(
        self: *UdsServer,
        allocator: std.mem.Allocator,
        root_path: []const u8,
    ) !void {
        // Clear any prior root.
        if (self.workspace_root) |old| self.workspace_allocator.free(old);
        const owned = try allocator.dupe(u8, root_path);
        self.workspace_root = owned;
        self.workspace_allocator = allocator;
        // Initialize parsers for any already-connected conns. New
        // accepts will pick up the same root via update().
        for (&self.conns) |*c| {
            if (!c.active) continue;
            if (c.parser != null) continue;
            c.parser = workspace.InboundParser.init(allocator, owned);
        }
    }

    /// Send bytes to one connection. Best-effort; callers don't have to loop.
    pub fn send(self: *UdsServer, conn_id: u32, data: []const u8) void {
        const conn = self.connPtr(conn_id) orelse return;
        if (!conn.active) return;
        const stream = if (conn.stream) |*pump| pump else return;
        stream.send(data) catch self.closeInternal(conn);
    }

    pub fn closeConn(self: *UdsServer, conn_id: u32) void {
        const conn = self.connPtr(conn_id) orelse return;
        self.closeInternal(conn);
    }

    /// Non-blocking pump. Accepts new connections, drains pending reads.
    /// Returns up to out.len events; call repeatedly until it returns 0
    /// to fully drain a tick.
    pub fn update(self: *UdsServer, out: []Event) usize {
        var n_out: usize = 0;

        // 1. Try accepting one new connection per call. More than one
        // per call is fine but we keep slices simple.
        if (n_out < out.len) {
            if (self.listener.accept()) |accepted| {
                const pump = transport.StreamPump.init(self.allocator, self.io, accepted) catch {
                    accepted.close(self.io);
                    return n_out;
                };
                if (self.allocConnId(pump)) |id| {
                    // If workspace mode is on, attach a parser to the
                    // freshly-allocated conn so inbound bytes route to
                    // the filesystem instead of bubbling up as data
                    // events.
                    if (self.workspace_root) |root| {
                        self.conns[id].parser = workspace.InboundParser.init(self.workspace_allocator, root);
                    }
                    out[n_out] = .{ .accepted = id };
                    n_out += 1;
                } else {
                    var rejected = pump;
                    rejected.deinit();
                }
            }
        }

        // 2. Drain reads from active conns. Multi-chunk drain per
        // conn keeps a 200MB INIT tar from spread-eagling across many
        // ticks — without this, the VM's send blocks on PTY buffer
        // pressure waiting for us to catch up.
        var i: u32 = 0;
        while (i < MAX_CONNS and n_out < out.len) : (i += 1) {
            const conn = &self.conns[i];
            if (!conn.active) continue;
            var iters: u32 = 0;
            while (iters < 32 and n_out < out.len) : (iters += 1) {
                const stream = if (conn.stream) |*pump| pump else break;
                const r = switch (stream.drain(&conn.read_buf)) {
                    .empty => break,
                    .data => |count| count,
                    .closed => {
                        out[n_out] = .{ .closed = i };
                        n_out += 1;
                        self.closeInternal(conn);
                        break;
                    },
                    .failed => |err| {
                        const msg = std.fmt.bufPrint(&conn.err_buf, "read: {s}", .{@errorName(err)}) catch "read err";
                        out[n_out] = .{ .err = .{ .conn_id = i, .msg = msg } };
                        n_out += 1;
                        self.closeInternal(conn);
                        break;
                    },
                };
                if (conn.parser) |*p| {
                    // Workspace mode: bytes go straight to filesystem;
                    // no data event up to JS. (Avoids the V8 string
                    // round-trip that would corrupt binary payloads.)
                    p.feed(self.io, conn.read_buf[0..r]);
                } else {
                    out[n_out] = .{ .data = .{ .conn_id = i, .bytes = conn.read_buf[0..r] } };
                    n_out += 1;
                    break; // Bubble up one chunk per tick when not in workspace mode.
                }
            }
        }

        return n_out;
    }

    // ── internals ─────────────────────────────────────────────────────

    fn connPtr(self: *UdsServer, conn_id: u32) ?*Conn {
        if (conn_id >= MAX_CONNS) return null;
        return &self.conns[conn_id];
    }

    fn allocConnId(self: *UdsServer, stream: transport.StreamPump) ?u32 {
        for (&self.conns, 0..) |*c, i| {
            if (!c.active) {
                c.stream = stream;
                c.active = true;
                return @intCast(i);
            }
        }
        return null;
    }

    fn closeInternal(self: *UdsServer, conn: *Conn) void {
        _ = self;
        if (!conn.active) return;
        if (conn.stream) |*stream| stream.deinit();
        conn.stream = null;
        conn.active = false;
        if (conn.parser) |*p| {
            p.deinit();
            conn.parser = null;
        }
    }
};

// ────────────────────────────────────────────────────────────────────
// Writer adapter — lets framework/sync/workspace.zig write outbound
// frames straight to a UDS connection.
// ────────────────────────────────────────────────────────────────────

pub const ConnWriter = struct {
    server: *UdsServer,
    conn_id: u32,

    pub fn writeAll(self: ConnWriter, bytes: []const u8) !void {
        const conn = self.server.connPtr(self.conn_id) orelse return error.NoSuchConn;
        if (!conn.active) return error.ConnClosed;
        const stream = if (conn.stream) |*pump| pump else return error.ConnClosed;
        try stream.send(bytes);
    }
};

/// Build a ConnWriter for a specific connection — used by binding
/// glue when calling workspace.writeFileFrame / writeMsgFrame.
pub fn writerForConn(server: *UdsServer, conn_id: u32) ConnWriter {
    return .{ .server = server, .conn_id = conn_id };
}

test "public UDS API compiles" {
    std.testing.refAllDecls(@This());
}
