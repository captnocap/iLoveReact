//! HTTP server — non-blocking static files + dynamic routes.
//!
//! Port of love2d/lua/httpserver.lua. Accepts connections, parses HTTP
//! requests, serves static files or emits events for dynamic handlers.
//!
//! Usage:
//!   var server: httpserver.HttpServer = undefined;
//!   try server.listen(8080, &[_]httpserver.Route{
//!       .{ .path = "/static", .route_type = .static, .root = "/var/www" },
//!       .{ .path = "/api", .route_type = .handler },
//!   });
//!   // each frame:
//!   var events: [16]httpserver.HttpEvent = undefined;
//!   const n = server.update(&events);
//!   for (events[0..n]) |ev| {
//!       server.respond(ev.client_id, 200, "OK");
//!   }
//!   server.close();

const std = @import("std");
// ZIG_016_MIGRATION §6 exemption (door b): this file is part of the hand-rolled
// nonblocking readiness loop and stays on raw posix-shaped syscalls via sysx
// (0.15-faithful wrappers). Do NOT migrate to std.Io.net.
const sysx = @import("sysx.zig");

// ── Configuration ────────────────────────────────────────────────────────

const MAX_CLIENTS = 64;
// Per-connection request buffer (headers + body). 256 KB ≈ 64k tokens of
// text — comfortably covers large API requests like an OpenAI-compatible
// chat-completions body that carries conversation history + a full tools
// schema. The previous 8 KB silently truncated such requests: the buffer
// filled, the body stayed incomplete, the next read hit a zero-length
// slice → read returned 0 → the server mistook it for EOF and closed, so
// the request was never parsed or delivered. Oversized requests now get a
// clean 413 (see tryParseRequest) instead of hanging.
const MAX_REQ = 262144;
const MAX_RESP = 65536;
const MAX_PATH = 512;
const MAX_ROUTES = 16;

// ── Diagnostic logging (env-gated; no-op unless REACTJIT_HTTPSRV_DEBUG=1) ──
// Writes to stderr. Run the cart with `2>/tmp/srv.log` to capture cleanly
// without corrupting a TUI's stdout. Temporary instrument for the
// "accepted-but-never-read" investigation.
var g_dbg_checked: bool = false;
var g_dbg: bool = false;
fn dbg(comptime fmt: []const u8, args: anytype) void {
    if (!g_dbg_checked) {
        g_dbg_checked = true;
        g_dbg = sysx.getenv("REACTJIT_HTTPSRV_DEBUG") != null;
    }
    if (g_dbg) std.debug.print("[httpsrv] " ++ fmt ++ "\n", args);
}

// ── Public types ─────────────────────────────────────────────────────────

pub const RouteType = enum { static, handler };

pub const Route = struct {
    path: []const u8,
    route_type: RouteType = .handler,
    root: ?[]const u8 = null, // filesystem root for static routes
};

pub const HttpEvent = struct {
    client_id: u32 = 0,
    method: [8]u8 = undefined,
    method_len: usize = 0,
    path: [MAX_PATH]u8 = undefined,
    path_len: usize = 0,
    body: [MAX_REQ]u8 = undefined,
    body_len: usize = 0,

    pub fn methodSlice(self: *const HttpEvent) []const u8 {
        return self.method[0..self.method_len];
    }
    pub fn pathSlice(self: *const HttpEvent) []const u8 {
        return self.path[0..self.path_len];
    }
    pub fn bodySlice(self: *const HttpEvent) []const u8 {
        return self.body[0..self.body_len];
    }
};

const ClientState = enum { reading, done, closed };

const HttpClient = struct {
    active: bool = false,
    id: u32 = 0,
    stream: ?std.net.Stream = null,
    state: ClientState = .closed,
    req_buf: [MAX_REQ]u8 = undefined,
    req_len: usize = 0,
};

// ── Server ───────────────────────────────────────────────────────────────

pub const HttpServer = struct {
    listener: sysx.socket_t,
    clients: [MAX_CLIENTS]HttpClient = [_]HttpClient{.{}} ** MAX_CLIENTS,
    next_id: u32 = 1,
    routes: [MAX_ROUTES]Route = undefined,
    route_count: usize = 0,
    event_count: usize = 0,
    // The Route.path / Route.root slices passed into listen() are caller-owned
    // and may dangle after listen() returns (V8 bindings build them on the stack).
    // Copy the bytes into server-owned storage and re-point the slices here so
    // matchRoute() never reads through a stale pointer.
    route_path_storage: [MAX_ROUTES][512]u8 = undefined,
    route_root_storage: [MAX_ROUTES][512]u8 = undefined,

    /// Initialize an in-place HttpServer. Storage for routes lives inside
    /// `self`; routes[].path slices in this struct point at self.route_path_storage,
    /// so the struct must NOT be moved/copied after this returns.
    pub fn listen(self: *HttpServer, port: u16, routes: []const Route) !void {
        const addr = try std.net.Address.parseIp4("0.0.0.0", port);
        const fd = try sysx.socket(addr.any.family, sysx.SOCK.STREAM | sysx.SOCK.NONBLOCK, 0);
        errdefer sysx.close(fd);

        const optval: c_int = 1;
        try sysx.setsockopt(fd, sysx.SOL.SOCKET, sysx.SO.REUSEADDR, std.mem.asBytes(&optval));
        try sysx.bind(fd, &addr.any, addr.getOsSockLen());
        try sysx.listen(fd, 16);

        self.* = HttpServer{ .listener = fd };
        const rcount = @min(routes.len, MAX_ROUTES);
        for (0..rcount) |i| {
            const src = routes[i];
            const plen = @min(src.path.len, self.route_path_storage[i].len);
            @memcpy(self.route_path_storage[i][0..plen], src.path[0..plen]);
            var copied = Route{
                .path = self.route_path_storage[i][0..plen],
                .route_type = src.route_type,
                .root = null,
            };
            if (src.root) |r| {
                const rlen = @min(r.len, self.route_root_storage[i].len);
                @memcpy(self.route_root_storage[i][0..rlen], r[0..rlen]);
                copied.root = self.route_root_storage[i][0..rlen];
            }
            self.routes[i] = copied;
        }
        self.route_count = rcount;
    }

    /// Non-blocking poll. Returns event count.
    pub fn update(self: *HttpServer, out: []HttpEvent) usize {
        self.event_count = 0;

        // Accept new connections
        while (true) {
            const accepted = sysx.accept(self.listener, null, null, sysx.SOCK.NONBLOCK) catch |err| {
                if (err != error.WouldBlock) dbg("accept ERR={s}", .{@errorName(err)});
                break;
            };
            const slot = self.findSlot() orelse {
                dbg("accept fd={d} NO FREE SLOT (closing)", .{accepted});
                sysx.close(accepted);
                break;
            };
            self.clients[slot] = .{
                .active = true,
                .id = self.next_id,
                .stream = .{ .handle = accepted },
                .state = .reading,
            };
            dbg("accept fd={d} -> slot={d} id={d}", .{ accepted, slot, self.next_id });
            self.next_id += 1;
        }

        // Process clients
        for (&self.clients) |*client| {
            if (!client.active or client.state != .reading) continue;
            self.processClient(client, out);
        }

        return @min(self.event_count, out.len);
    }

    /// Send an HTTP response to a client.
    pub fn respond(self: *HttpServer, client_id: u32, status: u16, content_type: []const u8, body: []const u8) void {
        for (&self.clients) |*client| {
            if (client.active and client.id == client_id) {
                if (client.stream) |stream| {
                    const status_text = statusText(status);
                    var hdr_buf: [512]u8 = undefined;
                    const hdr = std.fmt.bufPrint(&hdr_buf,
                        "HTTP/1.1 {d} {s}\r\n" ++
                            "Content-Type: {s}\r\n" ++
                            "Content-Length: {d}\r\n" ++
                            "Connection: close\r\n\r\n",
                        .{ status, status_text, content_type, body.len },
                    ) catch "";
                    stream.writeAll(hdr) catch {};
                    stream.writeAll(body) catch {};
                    stream.close();
                }
                client.active = false;
                return;
            }
        }
    }

    /// Shut down the server.
    pub fn close(self: *HttpServer) void {
        for (&self.clients) |*client| {
            if (client.active) {
                if (client.stream) |s| s.close();
                client.active = false;
            }
        }
        sysx.close(self.listener);
    }

    // ── Internal ─────────────────────────────────────────────────────

    fn processClient(self: *HttpServer, client: *HttpClient, out: []HttpEvent) void {
        const stream = client.stream orelse return;
        const n = stream.read(client.req_buf[client.req_len..]) catch |err| {
            if (err == error.WouldBlock) {
                dbg("read id={d} WOULDBLOCK req_len={d}", .{ client.id, client.req_len });
                if (client.req_len > 0) self.tryParseRequest(client, out);
                return;
            }
            dbg("read id={d} ERR={s}", .{ client.id, @errorName(err) });
            client.active = false;
            return;
        };
        if (n == 0) {
            dbg("read id={d} EOF n=0 (closing)", .{client.id});
            client.active = false;
            return;
        }
        client.req_len += n;
        dbg("read id={d} n={d} req_len={d}", .{ client.id, n, client.req_len });
        self.tryParseRequest(client, out);
    }

    fn tryParseRequest(self: *HttpServer, client: *HttpClient, out: []HttpEvent) void {
        const req = client.req_buf[0..client.req_len];
        // Need complete headers
        const header_end = std.mem.indexOf(u8, req, "\r\n\r\n") orelse {
            // Headers alone overflowed the buffer with no terminator —
            // malformed or absurdly large. Reject cleanly rather than
            // looping forever / EOF-closing silently.
            if (client.req_len >= MAX_REQ) {
                dbg("parse id={d} HEADERS TOO LARGE (req_len={d} >= MAX_REQ)", .{ client.id, client.req_len });
                self.respondDirect(client, 413, "Payload Too Large");
            }
            return;
        };

        // Parse Content-Length to know if we have the full body
        const headers = req[0..header_end];
        const content_length = parseContentLength(headers);
        const body_start = header_end + 4;
        // Will the full request fit? If the declared body can't fit in the
        // buffer we'll never complete the read — reject with 413 instead of
        // hanging (the old bug: buffer fills, next read returns 0 = EOF,
        // connection closes, request silently lost).
        if (body_start + content_length > MAX_REQ) {
            dbg("parse id={d} TOO LARGE body_start={d} content_length={d} > MAX_REQ={d}", .{ client.id, body_start, content_length, MAX_REQ });
            self.respondDirect(client, 413, "Payload Too Large");
            return;
        }
        const body_received = if (client.req_len > body_start) client.req_len - body_start else 0;
        if (body_received < content_length) {
            dbg("parse id={d} INCOMPLETE body_received={d} content_length={d} (waiting)", .{ client.id, body_received, content_length });
            return; // wait for full body
        }

        // Parse request line: "METHOD /path HTTP/1.1"
        const first_line_end = std.mem.indexOf(u8, req[0..header_end], "\r\n") orelse return;
        const first_line = req[0..first_line_end];

        var parts_iter = std.mem.splitScalar(u8, first_line, ' ');
        const method = parts_iter.next() orelse return;
        const path = parts_iter.next() orelse return;

        // Security: reject path traversal
        if (std.mem.indexOf(u8, path, "..") != null) {
            self.respondDirect(client, 403, "Forbidden");
            return;
        }

        // Match route (exact prefix — path must equal route or continue with '/')
        const route = self.matchRoute(path);

        if (route) |r| {
            if (r.route_type == .static) {
                self.serveStatic(client, path, r);
                return;
            }
            // handler route matched — emit event below
        } else {
            // No route matched — 404
            self.respondDirect(client, 404, "Not Found");
            return;
        }

        // Dynamic route — emit event
        dbg("parse id={d} COMPLETE method={s} path={s} body_recv={d} -> EMIT", .{ client.id, method, path, body_received });
        if (self.event_count < out.len) {
            var ev = &out[self.event_count];
            ev.client_id = client.id;
            const mlen = @min(method.len, 8);
            @memcpy(ev.method[0..mlen], method[0..mlen]);
            ev.method_len = mlen;
            const plen = @min(path.len, MAX_PATH);
            @memcpy(ev.path[0..plen], path[0..plen]);
            ev.path_len = plen;
            // Body (after headers — full body guaranteed by Content-Length check)
            if (body_received > 0) {
                const blen = @min(body_received, MAX_REQ);
                @memcpy(ev.body[0..blen], req[body_start .. body_start + blen]);
                ev.body_len = blen;
            } else {
                ev.body_len = 0;
            }
            self.event_count += 1;
        }
        client.state = .done;
    }

    fn serveStatic(self: *HttpServer, client: *HttpClient, path: []const u8, route: *const Route) void {
        const root = route.root orelse {
            self.respondDirect(client, 500, "No root configured");
            return;
        };

        // Build filesystem path: root + path suffix after route prefix
        var fs_path: [MAX_PATH * 2]u8 = undefined;
        const root_len = root.len;
        @memcpy(fs_path[0..root_len], root);
        const suffix = if (path.len > route.path.len) path[route.path.len..] else "/index.html";
        const suffix_to_use = if (suffix.len == 0 or (suffix.len == 1 and suffix[0] == '/')) "/index.html" else suffix;
        const slen = suffix_to_use.len;
        @memcpy(fs_path[root_len .. root_len + slen], suffix_to_use);

        // Read file
        const file = std.fs.openFileAbsolute(fs_path[0 .. root_len + slen], .{}) catch {
            self.respondDirect(client, 404, "Not Found");
            return;
        };
        defer file.close();
        var body: [MAX_RESP]u8 = undefined;
        const file_len = file.readAll(&body) catch {
            self.respondDirect(client, 500, "Read Error");
            return;
        };

        const content_type = mimeType(suffix_to_use);
        const stream = client.stream orelse return;
        var hdr_buf: [512]u8 = undefined;
        const hdr = std.fmt.bufPrint(&hdr_buf,
            "HTTP/1.1 200 OK\r\n" ++
                "Content-Type: {s}\r\n" ++
                "Content-Length: {d}\r\n" ++
                "Connection: close\r\n\r\n",
            .{ content_type, file_len },
        ) catch "";
        stream.writeAll(hdr) catch {};
        stream.writeAll(body[0..file_len]) catch {};
        stream.close();
        client.active = false;
    }

    fn respondDirect(self: *HttpServer, client: *HttpClient, status: u16, body: []const u8) void {
        _ = self;
        if (client.stream) |stream| {
            var hdr_buf: [512]u8 = undefined;
            const hdr = std.fmt.bufPrint(&hdr_buf,
                "HTTP/1.1 {d} {s}\r\n" ++
                    "Content-Type: text/plain\r\n" ++
                    "Content-Length: {d}\r\n" ++
                    "Connection: close\r\n\r\n",
                .{ status, statusText(status), body.len },
            ) catch "";
            stream.writeAll(hdr) catch {};
            stream.writeAll(body) catch {};
            stream.close();
        }
        client.active = false;
    }

    fn matchRoute(self: *HttpServer, path: []const u8) ?*const Route {
        var best: ?*const Route = null;
        var best_len: usize = 0;
        for (0..self.route_count) |i| {
            const r = &self.routes[i];
            // Exact prefix match with boundary: path must equal route prefix,
            // or the character after the prefix must be '/' or end of string.
            // This prevents /api matching /api2.
            if (std.mem.startsWith(u8, path, r.path) and r.path.len > best_len) {
                if (path.len == r.path.len or path[r.path.len] == '/' or r.path[r.path.len - 1] == '/') {
                    best = r;
                    best_len = r.path.len;
                }
            }
        }
        return best;
    }

    fn findSlot(self: *HttpServer) ?usize {
        for (0..MAX_CLIENTS) |i| {
            if (!self.clients[i].active) return i;
        }
        return null;
    }
};

// ── MIME types ────────────────────────────────────────────────────────────

fn mimeType(path: []const u8) []const u8 {
    if (std.mem.endsWith(u8, path, ".html")) return "text/html";
    if (std.mem.endsWith(u8, path, ".css")) return "text/css";
    if (std.mem.endsWith(u8, path, ".js")) return "application/javascript";
    if (std.mem.endsWith(u8, path, ".json")) return "application/json";
    if (std.mem.endsWith(u8, path, ".png")) return "image/png";
    if (std.mem.endsWith(u8, path, ".jpg") or std.mem.endsWith(u8, path, ".jpeg")) return "image/jpeg";
    if (std.mem.endsWith(u8, path, ".gif")) return "image/gif";
    if (std.mem.endsWith(u8, path, ".svg")) return "image/svg+xml";
    if (std.mem.endsWith(u8, path, ".ico")) return "image/x-icon";
    if (std.mem.endsWith(u8, path, ".woff2")) return "font/woff2";
    if (std.mem.endsWith(u8, path, ".woff")) return "font/woff";
    if (std.mem.endsWith(u8, path, ".txt")) return "text/plain";
    if (std.mem.endsWith(u8, path, ".xml")) return "application/xml";
    return "application/octet-stream";
}

fn statusText(code: u16) []const u8 {
    return switch (code) {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        301 => "Moved Permanently",
        302 => "Found",
        304 => "Not Modified",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        else => "OK",
    };
}

/// Parse Content-Length from HTTP headers. Returns 0 if not found (GET, etc.).
fn parseContentLength(headers: []const u8) usize {
    // Case-insensitive search for "Content-Length: " or "content-length: "
    var pos: usize = 0;
    while (pos + 16 < headers.len) {
        if (std.ascii.startsWithIgnoreCase(headers[pos..], "content-length:")) {
            var start = pos + 15;
            // Skip whitespace after colon
            while (start < headers.len and headers[start] == ' ') start += 1;
            var end = start;
            while (end < headers.len and headers[end] >= '0' and headers[end] <= '9') end += 1;
            if (end > start) {
                return std.fmt.parseInt(usize, headers[start..end], 10) catch 0;
            }
            return 0;
        }
        // Skip to next line
        if (std.mem.indexOf(u8, headers[pos..], "\r\n")) |nl| {
            pos += nl + 2;
        } else break;
    }
    return 0;
}
