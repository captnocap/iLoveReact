//! IPC — NDJSON over TCP for inter-process communication.
//!
//! Port of love2d/lua/window_ipc.lua. Provides a lightweight, non-blocking
//! TCP channel using newline-delimited JSON (NDJSON) for message framing.
//!
//! Used by windows.zig for independent (multi-process) windows, but
//! available to any module that needs local IPC.
//!
//! Protocol (matching the Lua implementation):
//!   Parent → Child:
//!     {"type":"init","commands":[...]}       — Initial subtree
//!     {"type":"mutations","commands":[...]}  — Incremental updates
//!     {"type":"resize","width":N,"height":N} — Window resized
//!     {"type":"quit"}                        — Shutdown
//!
//!   Child → Parent:
//!     {"type":"event","payload":{...}}           — Input event
//!     {"type":"windowEvent","handler":"onClose"} — Window lifecycle
//!     {"type":"ready"}                           — Connection established
//!
//! Usage (server / parent side):
//!   var server = try ipc.Server.bind(0);       // port 0 = OS-assigned
//!   const port = server.getPort();             // tell child this port
//!   // per-frame:
//!   server.acceptClient();                     // non-blocking
//!   server.send("{\"type\":\"quit\"}\n");
//!   var msgs = server.poll();                  // returns slice of complete lines
//!   server.close();
//!
//! Usage (client / child side):
//!   var client = try ipc.Client.connect(port);
//!   client.send("{\"type\":\"ready\"}\n");
//!   var msgs = client.poll();
//!   client.close();

const std = @import("std");
const netx = @import("netx.zig");
// ZIG_016_MIGRATION §6 exemption (door b): this file is part of the hand-rolled
// nonblocking readiness loop and stays on raw posix-shaped syscalls via sysx
// (0.15-faithful wrappers). Do NOT migrate to std.Io.net.
const sysx = @import("sysx.zig");
const log = @import("../diag/log.zig");
const event_bus = @import("../diag/event_bus.zig");

// ════════════════════════════════════════════════════════════════════════
// Constants
// ════════════════════════════════════════════════════════════════════════

// Receive-buffer size — has to be larger than the largest INITIAL FLUSH a
// parent ever queues up before the child connects. font_lab's first paint
// alone runs ~330KB; more elaborate carts go higher. The old 256K cap was
// silently truncating once a flush exceeded it, corrupting JSON mid-token
// and leaving the child window blank with no error log.
const MAX_MSG_SIZE = 4 * 1024 * 1024; // 4MB
const READ_BUF_SIZE = 8192; // per-read chunk

// ════════════════════════════════════════════════════════════════════════
// Message iterator — yields complete NDJSON lines from a buffer
// ════════════════════════════════════════════════════════════════════════

pub const Message = struct {
    data: []const u8, // one complete JSON line (without trailing \n)
};

/// Up to 32 messages per poll cycle.
pub const MAX_MESSAGES_PER_POLL = 32;

// ════════════════════════════════════════════════════════════════════════
// Receive buffer — accumulates partial lines across reads
// ════════════════════════════════════════════════════════════════════════

const RecvBuffer = struct {
    buf: [MAX_MSG_SIZE]u8 = undefined,
    len: usize = 0, // bytes occupied (read_pos..len is the live region)
    read_pos: usize = 0, // first byte not yet drained

    /// Append raw bytes from a read.
    ///
    /// Compaction happens HERE, never inside drain. drain returns slices
    /// that point into `buf`; if drain compacted on the way out, those
    /// slices would silently start reading whatever bytes the compaction
    /// shoved into their range. That manifested as "first letter dropped",
    /// "tile missing its number", "half the tree gone" — random partial
    /// corruption depending on which lines drain extracted vs. which lines
    /// got slid in over them.
    ///
    /// Doing the compaction at the start of append is safe because by then
    /// the caller is done iterating any messages from the previous drain.
    fn append(self: *RecvBuffer, data: []const u8) void {
        // Reclaim space by sliding the live region (read_pos..len) to the
        // front. Slices returned from earlier drain calls are invalidated
        // here — by contract the caller has finished using them before the
        // next poll().
        if (self.read_pos > 0) {
            const remaining = self.len - self.read_pos;
            if (remaining > 0) {
                std.mem.copyForwards(u8, self.buf[0..remaining], self.buf[self.read_pos..self.len]);
            }
            self.len = remaining;
            self.read_pos = 0;
        }

        const space = self.buf.len - self.len;
        if (data.len > space) {
            const dropped = data.len - space;
            log.print(
                "[ipc] RecvBuffer OVERFLOW — dropping {d} bytes; bump MAX_MSG_SIZE (cap={d}, len={d}, incoming={d})\n",
                .{ dropped, self.buf.len, self.len, data.len },
            );
            // Bus event at near-fatal importance — this is THE bug class
            // that just cost two days. Anyone tailing the bus during a
            // mystery "blank window" will see this immediately.
            var pbuf: [192]u8 = undefined;
            if (std.fmt.bufPrint(
                &pbuf,
                "{{\"dropped\":{d},\"cap\":{d},\"len\":{d},\"incoming\":{d}}}",
                .{ dropped, self.buf.len, self.len, data.len },
            )) |p| {
                _ = event_bus.emit("ipc.overflow", "framework/net/ipc.zig", null, p);
            } else |_| {
                _ = event_bus.emit("ipc.overflow", "framework/net/ipc.zig", null, "{}");
            }
        } else if (self.len + data.len > self.buf.len / 2 and data.len >= 4096) {
            // Early warning: ≥50% capacity used and a non-trivial chunk
            // just landed. Lets us see "headed for overflow" before the
            // cliff. Manual mid-importance — auto-rule would land at 0.5
            // (no keyword), but this is genuinely worth surfacing.
            var pbuf: [128]u8 = undefined;
            if (std.fmt.bufPrint(
                &pbuf,
                "{{\"len\":{d},\"cap\":{d},\"incoming\":{d}}}",
                .{ self.len, self.buf.len, data.len },
            )) |p| {
                _ = event_bus.emitWithImportance("ipc.recv.large", "framework/net/ipc.zig", 0.65, null, p);
            } else |_| {}
        }
        const n = @min(data.len, space);
        if (n > 0) {
            @memcpy(self.buf[self.len..][0..n], data[0..n]);
            self.len += n;
        }
    }

    /// Extract complete lines (terminated by \n) into the output slice.
    /// Returns how many messages were written into `out`. Lines past the
    /// out-slice cap stay in the buffer for the caller's next drain call.
    ///
    /// Slices in `out` are valid until the next call to `append` — by
    /// then the caller is expected to have iterated them.
    fn drain(self: *RecvBuffer, out: []Message) usize {
        var count: usize = 0;
        var i: usize = self.read_pos;
        while (i < self.len) : (i += 1) {
            if (self.buf[i] != '\n') continue;
            const line_end = i;
            const new_read_pos = i + 1;
            const line = self.buf[self.read_pos..line_end];
            self.read_pos = new_read_pos;
            if (line.len == 0) continue; // empty line — consume newline, no out slot
            if (count >= out.len) {
                // out is full — rewind read_pos back to the start of this
                // line so the next drain call picks it up.
                self.read_pos = line_end - line.len;
                break;
            }
            out[count] = .{ .data = line };
            count += 1;
        }
        return count;
    }
};

// ════════════════════════════════════════════════════════════════════════
// Server (parent side)
// ════════════════════════════════════════════════════════════════════════

pub const Server = struct {
    listener: sysx.socket_t,
    client_fd: ?sysx.socket_t = null,
    recv_buf: RecvBuffer = .{},
    msg_out: [MAX_MESSAGES_PER_POLL]Message = undefined,
    port: u16 = 0,
    dead: bool = false,

    /// Bind a TCP server on localhost. Pass port=0 to let the OS pick a free port.
    pub fn bind(port: u16) !Server {
        const addr = try netx.Address.parseIp4("127.0.0.1", port);
        const fd = try sysx.socket(addr.any.family, sysx.SOCK.STREAM | sysx.SOCK.NONBLOCK, 0);
        errdefer sysx.close(fd);

        // SO_REUSEADDR
        const optval: c_int = 1;
        try sysx.setsockopt(fd, sysx.SOL.SOCKET, sysx.SO.REUSEADDR, std.mem.asBytes(&optval));

        try sysx.bind(fd, &addr.any, addr.getOsSockLen());
        try sysx.listen(fd, 1); // single client expected

        // Read back the assigned port
        var bound_addr: sysx.sockaddr = undefined;
        var addr_len: sysx.socklen_t = @sizeOf(sysx.sockaddr);
        try sysx.getsockname(fd, &bound_addr, &addr_len);
        // Extract port from the sockaddr_in
        const sa_in: *const sysx.sockaddr.in = @ptrCast(@alignCast(&bound_addr));
        const assigned_port = std.mem.bigToNative(u16, sa_in.port);

        return Server{
            .listener = fd,
            .port = assigned_port,
        };
    }

    /// The port the server is listening on.
    pub fn getPort(self: *const Server) u16 {
        return self.port;
    }

    /// Non-blocking accept. Call once per frame. Returns true if a client connected.
    pub fn acceptClient(self: *Server) bool {
        if (self.client_fd != null) return true; // already connected
        const accepted = sysx.accept(self.listener, null, null, sysx.SOCK.NONBLOCK) catch return false;
        // TCP_NODELAY
        const optval: c_int = 1;
        sysx.setsockopt(accepted, sysx.IPPROTO.TCP, sysx.TCP.NODELAY, std.mem.asBytes(&optval)) catch {};
        self.client_fd = accepted;
        return true;
    }

    /// Non-blocking poll for messages. Returns a slice of complete NDJSON lines.
    /// Sets self.dead = true if the connection was closed by the remote end.
    pub fn poll(self: *Server) []const Message {
        const fd = self.client_fd orelse return self.msg_out[0..0];
        return pollFd(fd, &self.recv_buf, &self.msg_out, &self.dead);
    }

    /// Send a raw NDJSON line (must include trailing \n).
    pub fn send(self: *Server, data: []const u8) bool {
        const fd = self.client_fd orelse return false;
        return sendAll(fd, data);
    }

    /// Send a message string and append \n.
    pub fn sendLine(self: *Server, line: []const u8) bool {
        if (!self.send(line)) return false;
        return self.send("\n");
    }

    /// Is a client connected?
    pub fn connected(self: *const Server) bool {
        return self.client_fd != null and !self.dead;
    }

    /// Close the server and any connected client.
    pub fn close(self: *Server) void {
        if (self.client_fd) |fd| {
            sysx.close(fd);
            self.client_fd = null;
        }
        sysx.close(self.listener);
        self.dead = true;
    }
};

// ════════════════════════════════════════════════════════════════════════
// Client (child side)
// ════════════════════════════════════════════════════════════════════════

pub const Client = struct {
    fd: sysx.socket_t,
    recv_buf: RecvBuffer = .{},
    msg_out: [MAX_MESSAGES_PER_POLL]Message = undefined,
    dead: bool = false,

    /// Connect to a server on localhost:port. Blocking connect, then sets non-blocking.
    pub fn connect(port: u16) !Client {
        const addr = try netx.Address.parseIp4("127.0.0.1", port);
        const fd = try sysx.socket(addr.any.family, sysx.SOCK.STREAM, 0);
        errdefer sysx.close(fd);

        try sysx.connect(fd, &addr.any, addr.getOsSockLen());

        // Set non-blocking after connect (raw POSIX constants for Zig 0.15)
        const F_GETFL: i32 = 3;
        const F_SETFL: i32 = 4;
        const O_NONBLOCK: usize = 0x800;
        const cur_flags = sysx.fcntl(fd, F_GETFL, @as(usize, 0)) catch 0;
        _ = sysx.fcntl(fd, F_SETFL, cur_flags | O_NONBLOCK) catch {};

        // TCP_NODELAY
        const optval: c_int = 1;
        sysx.setsockopt(fd, sysx.IPPROTO.TCP, sysx.TCP.NODELAY, std.mem.asBytes(&optval)) catch {};

        return Client{ .fd = fd };
    }

    /// Non-blocking poll for messages.
    pub fn poll(self: *Client) []const Message {
        return pollFd(self.fd, &self.recv_buf, &self.msg_out, &self.dead);
    }

    /// Send a raw NDJSON line (must include trailing \n).
    pub fn send(self: *Client, data: []const u8) bool {
        return sendAll(self.fd, data);
    }

    /// Send a message string and append \n.
    pub fn sendLine(self: *Client, line: []const u8) bool {
        if (!self.send(line)) return false;
        return self.send("\n");
    }

    /// Close the connection.
    pub fn close(self: *Client) void {
        sysx.close(self.fd);
        self.dead = true;
    }
};

// ════════════════════════════════════════════════════════════════════════
// Shared helpers
// ════════════════════════════════════════════════════════════════════════

/// Non-blocking read + line extraction on a socket fd.
fn pollFd(
    fd: sysx.socket_t,
    recv_buf: *RecvBuffer,
    msg_out: []Message,
    dead: *bool,
) []const Message {
    // Read all available data
    var tmp: [READ_BUF_SIZE]u8 = undefined;
    while (true) {
        const n = sysx.read(fd, &tmp) catch |err| switch (err) {
            error.WouldBlock => break,
            else => {
                dead.* = true;
                break;
            },
        };
        if (n == 0) {
            dead.* = true; // EOF — remote closed
            break;
        }
        recv_buf.append(tmp[0..n]);
    }

    // Extract complete lines
    const count = recv_buf.drain(msg_out);
    return msg_out[0..count];
}

/// Blocking write-all on a socket fd. Returns false on error.
fn sendAll(fd: sysx.socket_t, data: []const u8) bool {
    var written: usize = 0;
    while (written < data.len) {
        const n = sysx.write(fd, data[written..]) catch return false;
        if (n == 0) return false;
        written += n;
    }
    return true;
}
