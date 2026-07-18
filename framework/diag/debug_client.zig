//! Debug client — connects to a remote debug server over encrypted IPC.
//!
//! Mirrors the protocol in debug_server.zig:
//!   1. Client sends {"pubkey":"<hex>"} (plaintext)
//!   2. Server responds {"challenge":"trusted"|"enter_code"|"auto_accepted"}
//!   3. If "enter_code": client sends {"code":"123456"} (plaintext)
//!   4. Server sends encrypted {"method":"debug.handshake","ok":true}
//!   5. All subsequent messages are encrypted with XChaCha20-Poly1305
//!
//! Used by the Tools inspector to attach to running .tsz apps.

const std = @import("std");
const log = @import("log.zig");
const ipc = @import("../net/ipc.zig");
const app_crypto = @import("../privacy/crypto.zig");
const json_probe = @import("json_probe.zig");

const jsonStr = json_probe.str;
const jsonInt = json_probe.int;

const X25519 = std.crypto.dh.X25519;
const XChaCha = std.crypto.aead.chacha_poly.XChaCha20Poly1305;

// ── State ──────────────────────────────────────────────────────────

var client: ?ipc.Client = null;
var our_keypair: X25519.KeyPair = undefined;
var server_pubkey: [32]u8 = undefined;
var shared_key: [32]u8 = undefined;
var tx_nonce_counter: u64 = 0;

var authenticated: bool = false;
var awaiting_code: bool = false;
var handshake_sent: bool = false;
var challenge_received: bool = false;

// Response cache — last decrypted JSON from the server
const RESP_SIZE = 65536;
var resp_cache: [RESP_SIZE]u8 = undefined;
var resp_cache_len: usize = 0;

// Tree cache — parsed from debug.tree responses
const MAX_TREE_NODES = 2048;

pub const TreeNode = struct {
    index: i32 = 0,
    tag: [32]u8 = [_]u8{0} ** 32,
    tag_len: usize = 0,
    depth: i32 = 0,
};

var tree_nodes: [MAX_TREE_NODES]TreeNode = undefined;
var tree_node_count: usize = 0;

// Perf cache — parsed from debug.perf / debug.telemetry.frame responses
pub const PerfData = struct {
    fps: i32 = 0,
    layout_us: i32 = 0,
    paint_us: i32 = 0,
    gpu_us: i32 = 0,
    frame_total_us: i32 = 0,
    rects: i32 = 0,
    glyphs: i32 = 0,
    total_nodes: i32 = 0,
    visible_nodes: i32 = 0,
    window_w: i32 = 0,
    window_h: i32 = 0,
    valid: bool = false,
};

var perf_cache: PerfData = .{};
var telemetry_streaming: bool = false;

// ── Public API ─────────────────────────────────────────────────────

/// Connect to a debug server. server_pubkey_hex is the 64-char hex pubkey
/// from the session file (~/.tsz/sessions/<pid>.json).
pub fn connect(allocator: std.mem.Allocator, io: std.Io, port: u16, server_pubkey_hex: []const u8) bool {
    if (client != null) disconnect();
    if (server_pubkey_hex.len != 64) return false;

    _ = app_crypto.hexToBytes(server_pubkey_hex, &server_pubkey) catch return false;
    our_keypair = X25519.KeyPair.generate(io);

    var c = ipc.Client.connect(allocator, io, port) catch return false;

    // Send our pubkey as the handshake initiation
    var pubkey_hex: [64]u8 = undefined;
    app_crypto.bytesToHex(&our_keypair.public_key, &pubkey_hex);
    var msg_buf: [128]u8 = undefined;
    const msg = std.fmt.bufPrint(&msg_buf, "{{\"pubkey\":\"{s}\"}}", .{pubkey_hex[0..64]}) catch return false;
    if (!c.sendLine(msg)) {
        c.close();
        return false;
    }

    client = c;
    handshake_sent = true;
    challenge_received = false;
    authenticated = false;
    awaiting_code = false;
    tx_nonce_counter = 0;
    resp_cache_len = 0;
    tree_node_count = 0;
    perf_cache = .{};
    telemetry_streaming = false;
    return true;
}

/// Submit the 6-digit pairing code shown on the target app's screen.
/// Optimistically completes DH — if the code is wrong, the server drops
/// the connection and the next poll() detects it.
pub fn submitCode(code: []const u8) bool {
    if (!awaiting_code) return false;
    var c = &(client orelse return false);
    var buf: [64]u8 = undefined;
    const msg = std.fmt.bufPrint(&buf, "{{\"code\":\"{s}\"}}", .{code}) catch return false;
    if (!c.sendLine(msg)) return false;
    // Complete DH now — server does the same after verifying the code.
    // If wrong, server drops connection; poll() will detect dead socket.
    completeDH();
    awaiting_code = false;
    return true;
}

/// Disconnect from the remote debug server.
pub fn disconnect() void {
    if (client) |*c| c.close();
    client = null;
    authenticated = false;
    awaiting_code = false;
    handshake_sent = false;
    challenge_received = false;
    resp_cache_len = 0;
    tree_node_count = 0;
}

/// Poll for incoming messages. Must be called each frame.
/// Returns true if a new response was received and cached.
pub fn poll() bool {
    if (client == null) {
        log.print("[dc] poll: client=null\n", .{});
        return false;
    }
    var c = &(client.?);
    if (c.dead) {
        disconnect();
        return false;
    }

    const msgs = c.poll();
    var got_response = false;

    log.print("[dc] poll: dead={} auth={} msgs={d} tree_cached={d}\n", .{ c.dead, authenticated, msgs.len, tree_node_count });

    for (msgs) |msg| {
        if (!authenticated) {
            handleChallenge(msg.data);
        } else {
            if (decryptResponse(msg.data)) {
                got_response = true;
                log.print("[dc] decrypted {d} bytes\n", .{resp_cache_len});
                parseResponse();
            } else {
                log.print("[dc] DECRYPT FAILED: {d} byte wire msg\n", .{msg.data.len});
            }
        }
    }

    return got_response;
}

/// Send an encrypted request to the debug server.
pub fn request(method: []const u8) void {
    if (!authenticated) return;
    var buf: [256]u8 = undefined;
    var pos: usize = 0;
    ap(&buf, &pos, "{\"method\":\"");
    ap(&buf, &pos, method);
    ap(&buf, &pos, "\"}");
    sendEncrypted(buf[0..pos]);
}

/// Send an encrypted request with an integer parameter.
pub fn requestWithId(method: []const u8, id: i32) void {
    if (!authenticated) return;
    var buf: [256]u8 = undefined;
    var pos: usize = 0;
    ap(&buf, &pos, "{\"method\":\"");
    ap(&buf, &pos, method);
    ap(&buf, &pos, "\",\"id\":");
    var tmp: [12]u8 = undefined;
    const s = std.fmt.bufPrint(&tmp, "{d}", .{id}) catch return;
    ap(&buf, &pos, s);
    ap(&buf, &pos, "}");
    sendEncrypted(buf[0..pos]);
}

pub fn isConnected() bool {
    return client != null and !client.?.dead;
}

pub fn isAuthenticated() bool {
    return authenticated;
}

pub fn isAwaitingCode() bool {
    return awaiting_code;
}

/// Get the last decrypted response JSON.
pub fn getLastResponse() ?[]const u8 {
    if (resp_cache_len == 0) return null;
    return resp_cache[0..resp_cache_len];
}

/// Get cached perf data from remote.
pub fn getPerf() PerfData {
    return perf_cache;
}

/// Enable telemetry streaming (server pushes perf every frame).
pub fn enableTelemetryStream() void {
    if (telemetry_streaming) return;
    request("debug.telemetry.stream");
    telemetry_streaming = true;
}

/// Get cached tree node count.
pub fn getTreeNodeCount() usize {
    return tree_node_count;
}

/// Get a cached tree node by index.
pub fn getTreeNode(idx: usize) ?*const TreeNode {
    if (idx >= tree_node_count) return null;
    return &tree_nodes[idx];
}

// ── Handshake ──────────────────────────────────────────────────────

fn handleChallenge(raw: []const u8) void {
    // Look for "challenge" field in the plaintext JSON
    const val = jsonStr(raw, "challenge") orelse return;

    if (eql(val, "trusted") or eql(val, "auto_accepted")) {
        // Server auto-accepted — complete DH immediately
        awaiting_code = false;
        challenge_received = true;
        completeDH();
    } else if (eql(val, "enter_code")) {
        // Server wants visual pairing — user must enter code
        awaiting_code = true;
        challenge_received = true;
    } else {
        // After code submission, server sends encrypted handshake OK
        // Try to decrypt as a post-auth message
        if (awaiting_code) {
            // The server might have accepted our code and sent encrypted OK
            // Try completing DH first, then decrypt
            completeDH();
            if (authenticated) {
                if (decryptResponse(raw)) {
                    awaiting_code = false;
                }
            }
        }
    }
}

fn completeDH() void {
    const dh_shared = X25519.scalarmult(our_keypair.secret_key, server_pubkey) catch return;
    const prk = app_crypto.hkdfExtract("tsz-debug-v1", &dh_shared);
    app_crypto.hkdfExpand(&prk, "debug-channel", &shared_key) catch return;
    tx_nonce_counter = 0;
    authenticated = true;
}

// ── Encrypted I/O ──────────────────────────────────────────────────

fn sendEncrypted(plaintext: []const u8) void {
    var c = &(client orelse return);
    if (plaintext.len > RESP_SIZE / 2 - 128) return;

    const nonce = nextTxNonce();
    var ct_buf: [RESP_SIZE / 2]u8 = undefined;
    var tag: [XChaCha.tag_length]u8 = undefined;
    XChaCha.encrypt(ct_buf[0..plaintext.len], &tag, plaintext, "", nonce, shared_key);

    // Hex-encode: nonce + ciphertext + tag
    var wire_buf: [RESP_SIZE]u8 = undefined;
    var pos: usize = 0;
    hexEncode(&wire_buf, &pos, &nonce);
    hexEncode(&wire_buf, &pos, ct_buf[0..plaintext.len]);
    hexEncode(&wire_buf, &pos, &tag);
    if (pos < RESP_SIZE) {
        wire_buf[pos] = '\n';
        pos += 1;
    }
    _ = c.send(wire_buf[0..pos]);
}

fn decryptResponse(wire_hex: []const u8) bool {
    const min_hex = (XChaCha.nonce_length + XChaCha.tag_length) * 2;
    if (wire_hex.len < min_hex) return false;

    var wire_buf: [RESP_SIZE / 2]u8 = undefined;
    const wire_len = app_crypto.hexToBytes(wire_hex, &wire_buf) catch return false;
    if (wire_len < XChaCha.nonce_length + XChaCha.tag_length) return false;

    const nonce = wire_buf[0..XChaCha.nonce_length].*;
    const ct_len = wire_len - XChaCha.nonce_length - XChaCha.tag_length;
    const ct = wire_buf[XChaCha.nonce_length .. XChaCha.nonce_length + ct_len];
    const tag = wire_buf[XChaCha.nonce_length + ct_len ..][0..XChaCha.tag_length].*;

    XChaCha.decrypt(resp_cache[0..ct_len], ct, tag, "", nonce, shared_key) catch return false;
    resp_cache_len = ct_len;
    return true;
}

fn nextTxNonce() [XChaCha.nonce_length]u8 {
    var nonce: [XChaCha.nonce_length]u8 = [_]u8{0} ** XChaCha.nonce_length;
    nonce[0] = 'C'; // Client prefix (server uses 'T')
    const bytes = std.mem.asBytes(&tx_nonce_counter);
    @memcpy(nonce[16..24], bytes);
    tx_nonce_counter += 1;
    return nonce;
}

// ── Tree parser ────────────────────────────────────────────────────

fn parseResponse() void {
    if (resp_cache_len == 0) return;
    const data = resp_cache[0..resp_cache_len];
    const method = jsonStr(data, "method") orelse return;

    if (eql(method, "debug.tree")) {
        log.print("[ipc_client] parseTree: {d} bytes, parsing...\n", .{data.len});
        parseTree(data);
        log.print("[ipc_client] parseTree: got {d} nodes\n", .{tree_node_count});
    } else if (eql(method, "debug.perf") or eql(method, "debug.telemetry.frame")) {
        parsePerf(data);
    }
}

fn parseTree(data: []const u8) void {
    const log2 = @import("log.zig");
    const nodes_start = std.mem.indexOf(u8, data, "\"nodes\":[") orelse {
        log2.info(.engine, "parseTree: no nodes array found in {d} bytes", .{data.len});
        return;
    };
    var i = nodes_start + 9;
    tree_node_count = 0;

    while (i < data.len and tree_node_count < MAX_TREE_NODES) {
        if (data[i] == ']') break;
        if (data[i] != '{') {
            i += 1;
            continue;
        }

        const obj_start = i;
        while (i < data.len and data[i] != '}') i += 1;
        if (i >= data.len) break;
        i += 1;

        const obj = data[obj_start..i];
        var node = TreeNode{};
        if (jsonInt(obj, "i")) |v| node.index = v;
        if (jsonInt(obj, "d")) |v| node.depth = v;
        if (jsonStr(obj, "t")) |t| {
            const n = @min(t.len, 32);
            @memcpy(node.tag[0..n], t[0..n]);
            node.tag_len = n;
        }
        tree_nodes[tree_node_count] = node;
        tree_node_count += 1;
    }
}

fn parsePerf(data: []const u8) void {
    perf_cache.valid = true;
    if (jsonInt(data, "fps")) |v| perf_cache.fps = v;
    if (jsonInt(data, "layout_us")) |v| perf_cache.layout_us = v;
    if (jsonInt(data, "paint_us")) |v| perf_cache.paint_us = v;
    if (jsonInt(data, "gpu_us")) |v| perf_cache.gpu_us = v;
    if (jsonInt(data, "frame_total_us")) |v| perf_cache.frame_total_us = v;
    if (jsonInt(data, "rects")) |v| perf_cache.rects = v;
    if (jsonInt(data, "glyphs")) |v| perf_cache.glyphs = v;
    if (jsonInt(data, "total")) |v| perf_cache.total_nodes = v;
    if (jsonInt(data, "visible")) |v| perf_cache.visible_nodes = v;
    if (jsonInt(data, "window_w")) |v| perf_cache.window_w = v;
    if (jsonInt(data, "window_h")) |v| perf_cache.window_h = v;
}

// ── Helpers ────────────────────────────────────────────────────────

fn hexEncode(buf: []u8, pos: *usize, data: []const u8) void {
    const hc = "0123456789abcdef";
    for (data) |b| {
        if (pos.* + 2 > buf.len) return;
        buf[pos.*] = hc[b >> 4];
        buf[pos.* + 1] = hc[b & 0x0f];
        pos.* += 2;
    }
}

fn ap(buf: []u8, pos: *usize, s: []const u8) void {
    const n = @min(s.len, buf.len - pos.*);
    @memcpy(buf[pos.* .. pos.* + n], s[0..n]);
    pos.* += n;
}

fn eql(a: []const u8, b: []const u8) bool {
    return std.mem.eql(u8, a, b);
}
