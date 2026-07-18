//! Tor integration — subprocess manager for hidden services.
//!
//! Port of love2d/lua/tor.lua. Spawns a Tor process, generates torrc,
//! polls for .onion hostname. Provides SOCKS5 proxy port for routing.
//!
//! Usage:
//!   try tor.start(io, environ_map, .{ .identity = "myapp", .hidden_service_port = 80 });
//!   // poll each frame:
//!   if (tor.getHostname(io)) |hostname| {
//!       // hostname is "abc...xyz.onion"
//!   }
//!   // on shutdown:
//!   tor.stop(io);

const std = @import("std");

// ── Configuration ────────────────────────────────────────────────────────

const MAX_HOSTNAME = 128;
const MAX_PATH = 512;
const BASE_SOCKS_PORT: u16 = 9050;
const BASE_HS_PORT: u16 = 16667;

// ── Public types ─────────────────────────────────────────────────────────

pub const TorOpts = struct {
    identity: []const u8 = "default",
    hidden_service_port: u16 = 80,
    socks_port: u16 = 0, // 0 = auto-find starting from 9050
};

// ── Module state ─────────────────────────────────────────────────────────

var socks_port: u16 = 0;
var hs_port: u16 = 0;
var hostname_buf: [MAX_HOSTNAME]u8 = undefined;
var hostname_len: usize = 0;
var config_dir: [MAX_PATH]u8 = undefined;
var config_dir_len: usize = 0;
var pid: ?std.process.Child = null;
var running = false;

// ── Public API ───────────────────────────────────────────────────────────

/// Start Tor with the given options.
pub fn start(io: std.Io, environ: *const std.process.Environ.Map, opts: TorOpts) !void {
    if (running) return;

    // Find available SOCKS port
    socks_port = if (opts.socks_port != 0) opts.socks_port else findOpenPort(io, BASE_SOCKS_PORT);

    // Find available hidden service port
    hs_port = findOpenPort(io, BASE_HS_PORT);

    // Create config directory: ~/.cache/reactjit-tor/<identity>/
    const home = environ.get("HOME") orelse "/tmp";
    const identity = opts.identity;
    const dir = try std.fmt.bufPrint(&config_dir, "{s}/.cache/reactjit-tor/{s}", .{ home, identity });
    config_dir_len = dir.len;

    // Create the full hierarchy through the native 0.16 path operation.
    try std.Io.Dir.cwd().createDirPath(io, dir);

    // Create hidden service directory
    var hs_dir_buf: [MAX_PATH]u8 = undefined;
    const hs_dir = try std.fmt.bufPrint(&hs_dir_buf, "{s}/hidden_service", .{dir});
    try std.Io.Dir.cwd().createDirPath(io, hs_dir);

    // Generate torrc
    var torrc_path_buf: [MAX_PATH]u8 = undefined;
    const torrc_path = try std.fmt.bufPrint(&torrc_path_buf, "{s}/torrc", .{dir});

    const torrc_file = try std.Io.Dir.createFileAbsolute(io, torrc_path, .{});
    defer torrc_file.close(io);
    var torrc_buf: [2048]u8 = undefined;
    const torrc = try std.fmt.bufPrint(
        &torrc_buf,
        "SocksPort {d}\n" ++
            "HiddenServiceDir {s}\n" ++
            "HiddenServicePort {d} 127.0.0.1:{d}\n" ++
            "DataDirectory {s}/data\n" ++
            "Log notice file {s}/tor.log\n",
        .{ socks_port, hs_dir, opts.hidden_service_port, hs_port, dir, dir },
    );
    try torrc_file.writeStreamingAll(io, torrc);

    // Create data directory
    var data_dir_buf: [MAX_PATH]u8 = undefined;
    const data_dir = try std.fmt.bufPrint(&data_dir_buf, "{s}/data", .{dir});
    try std.Io.Dir.cwd().createDirPath(io, data_dir);

    // Spawn Tor process
    const child = try std.process.spawn(io, .{
        .argv = &[_][]const u8{ "tor", "-f", torrc_path },
        .environ_map = environ,
        .stdin = .ignore,
        .stdout = .ignore,
        .stderr = .ignore,
    });

    pid = child;
    running = true;
    hostname_len = 0;
}

/// Get the .onion hostname. Returns null while Tor is still bootstrapping.
/// Reference: love2d/lua/tor.lua:213-229
pub fn getHostname(io: std.Io) ?[]const u8 {
    if (!running) return null;
    if (hostname_len > 0) return hostname_buf[0..hostname_len];

    // Poll for hostname file
    var path_buf: [MAX_PATH]u8 = undefined;
    const path = std.fmt.bufPrint(&path_buf, "{s}/hidden_service/hostname", .{config_dir[0..config_dir_len]}) catch return null;

    const file = std.Io.Dir.openFileAbsolute(io, path, .{}) catch return null;
    defer file.close(io);

    var buf: [MAX_HOSTNAME]u8 = undefined;
    const n = file.readPositionalAll(io, &buf, 0) catch return null;
    if (n == 0) return null;

    // Strip trailing whitespace
    var end = n;
    while (end > 0 and (buf[end - 1] == '\n' or buf[end - 1] == '\r' or buf[end - 1] == ' ')) end -= 1;
    if (end == 0) return null;

    @memcpy(hostname_buf[0..end], buf[0..end]);
    hostname_len = end;
    return hostname_buf[0..end];
}

/// Get the SOCKS proxy port (for routing traffic through Tor).
pub fn getProxyPort() u16 {
    return socks_port;
}

/// Get the hidden service port (local port Tor forwards to).
pub fn getHsPort() u16 {
    return hs_port;
}

/// Check if Tor is running.
pub fn isRunning() bool {
    return running;
}

/// Stop Tor and cleanup.
pub fn stop(io: std.Io) void {
    if (!running) return;
    if (pid) |*child| {
        child.kill(io);
        _ = child.wait(io) catch {};
    }
    pid = null;
    running = false;
    hostname_len = 0;
}

// ── Internal ─────────────────────────────────────────────────────────────

/// Find an open TCP port starting from `base`.
fn findOpenPort(io: std.Io, base: u16) u16 {
    var port = base;
    while (port < 65535) : (port += 1) {
        const addr: std.Io.net.IpAddress = .{ .ip4 = .loopback(port) };
        var server = addr.listen(io, .{}) catch continue;
        server.deinit(io);
        // Port is available
        return port;
    }
    return base; // fallback
}

test "public Tor API compiles" {
    std.testing.refAllDecls(@This());
}
