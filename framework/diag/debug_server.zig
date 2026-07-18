//! Debug server — thin encrypted IPC server embedded in dev builds.
//!
//! Compiled in only when HAS_DEBUG_SERVER=true (dev builds). Dead-code
//! eliminated in dist builds — no TCP listener in the binary at all.
//!
//! Security:
//!   - X25519 key exchange → HKDF-SHA256 → XChaCha20-Poly1305 encrypted channel
//!   - Session file at ~/.tsz/sessions/<pid>.json (pubkey discovery)
//!   - Terminal/PTY nodes are read-only — simulate commands are rejected
//!   - debug.script() cannot spawn shells or touch PTY file descriptors
//!
//! Spec: tsz/docs/TSZ_TOOLS_SPEC.md

const std = @import("std");
const ipc = @import("../net/ipc.zig");
const telemetry = @import("telemetry.zig");
const app_crypto = @import("../privacy/crypto.zig");
const json_probe = @import("json_probe.zig");

const jsonStr = json_probe.str;
const jsonInt = json_probe.int;

const X25519 = std.crypto.dh.X25519;
const XChaCha = std.crypto.aead.chacha_poly.XChaCha20Poly1305;

// POSIX externs (same pattern as process.zig)
extern fn getpid() c_int;

// ── State ──────────────────────────────────────────────────────────

var server: ?ipc.Server = null;
var enabled: bool = false;
var authenticated: bool = false;
var awaiting_code: bool = false;
var streaming_telemetry: bool = false;
var last_push_ms: i64 = 0;
var selected_node_id: i32 = -1;

var our_keypair: X25519.KeyPair = undefined;
var shared_key: [32]u8 = undefined;
var tx_nonce_counter: u64 = 0;
var pending_client_pubkey: [32]u8 = undefined;
var pairing_code: [6]u8 = undefined;

var session_path_buf: [256]u8 = undefined;
var session_path_len: usize = 0;
var app_name_buf: [128]u8 = undefined;
var app_name_len: usize = 0;
var home_buf: [std.fs.max_path_bytes]u8 = undefined;
var home_len: usize = 0;
var auto_accept: bool = false;

// Persistent pairing — SHA-256 fingerprint of trusted tools pubkeys
const MAX_TRUSTED = 8;
var trusted_fingerprints: [MAX_TRUSTED][32]u8 = undefined;
var trusted_count: u8 = 0;

const RESP_SIZE = 65536;
var resp_buf: [RESP_SIZE]u8 = undefined;

// ── Public API ─────────────────────────────────────────────────────

pub fn init(allocator: std.mem.Allocator, io: std.Io, environ: *const std.process.Environ.Map, title: [*:0]const u8) void {
    const name = std.mem.span(title);
    const n = @min(name.len, 128);
    @memcpy(app_name_buf[0..n], name[0..n]);
    app_name_len = n;
    home_len = 0;
    auto_accept = false;
    const env = environ.get("TSZ_DEBUG") orelse return;
    if (env.len == 0 or env[0] != '1') return;
    if (environ.get("HOME")) |home| {
        home_len = @min(home.len, home_buf.len);
        @memcpy(home_buf[0..home_len], home[0..home_len]);
    }
    if (environ.get("TSZ_DEBUG_AUTOACCEPT")) |value| {
        auto_accept = value.len > 0 and value[0] == '1';
    }
    startServer(allocator, io);
}

pub fn poll(io: std.Io) void {
    var srv = &(server orelse return);
    _ = srv.acceptClient();
    if (!srv.connected()) {
        authenticated = false;
        awaiting_code = false;
        return;
    }
    const msgs = srv.poll();
    for (msgs) |msg| {
        if (awaiting_code) {
            handleCodeVerify(io, srv, msg.data);
        } else if (!authenticated) {
            handleHandshake(io, srv, msg.data);
        } else {
            handleEncrypted(io, srv, msg.data);
        }
    }
    if (streaming_telemetry and authenticated) {
        // Throttle to ~4 pushes/sec (every 250ms matches client poll rate)
        // Prevents recv buffer overflow from 230fps frame spam
        const now = std.Io.Clock.now(.awake, io).toMilliseconds();
        if (now - last_push_ms >= 250) {
            last_push_ms = now;
            pushTelemetryFrame(srv);
        }
    }
}

pub fn getSelectedNode() i32 {
    return selected_node_id;
}

/// Returns the 6-digit pairing code if a client is awaiting confirmation.
/// Engine uses this to render a modal overlay. Returns null when not pairing.
pub fn getPairingCode() ?[]const u8 {
    if (!awaiting_code) return null;
    return &pairing_code;
}

pub fn deinit(io: std.Io) void {
    if (server) |*s| s.close();
    server = null;
    enabled = false;
    authenticated = false;
    home_len = 0;
    auto_accept = false;
    last_push_ms = 0;
    removeSessionFile(io);
}

// ── Server startup ─────────────────────────────────────────────────

fn startServer(allocator: std.mem.Allocator, io: std.Io) void {
    if (server != null) return;
    server = ipc.Server.bind(allocator, io, 0) catch return;
    enabled = true;
    our_keypair = X25519.KeyPair.generate(io);
    loadTrustedKeys(io);
    const port = server.?.getPort();
    writeSessionFile(io, port);
    var port_buf: [64]u8 = undefined;
    const msg = std.fmt.bufPrint(&port_buf, "[debug_server] port {d}\n", .{port}) catch return;
    std.Io.File.stderr().writeStreamingAll(io, msg) catch {};
}

// ── Session file ───────────────────────────────────────────────────

fn writeSessionFile(io: std.Io, port: u16) void {
    const home = home_buf[0..home_len];
    if (home.len == 0) return;
    const pid: c_int = getpid();

    // mkdir -p ~/.tsz/sessions/ (ignore errors if exists)
    var parent_buf: [256]u8 = undefined;
    const parent = std.fmt.bufPrint(&parent_buf, "{s}/.tsz", .{home}) catch return;
    std.Io.Dir.createDirAbsolute(io, parent, .default_dir) catch |err| switch (err) {
        error.PathAlreadyExists => {},
        else => return,
    };
    var dir_buf: [256]u8 = undefined;
    const dir = std.fmt.bufPrint(&dir_buf, "{s}/.tsz/sessions", .{home}) catch return;
    std.Io.Dir.createDirAbsolute(io, dir, .default_dir) catch |err| switch (err) {
        error.PathAlreadyExists => {},
        else => return,
    };

    // Session file path
    const path_slice = std.fmt.bufPrint(&session_path_buf, "{s}/.tsz/sessions/{d}.json", .{ home, pid }) catch return;
    session_path_len = path_slice.len;

    // Hex-encode pubkey
    var pubkey_hex: [64]u8 = undefined;
    app_crypto.bytesToHex(&our_keypair.public_key, &pubkey_hex);

    // Write JSON
    var json_buf: [512]u8 = undefined;
    const json = std.fmt.bufPrint(
        &json_buf,
        "{{\"pid\":{d},\"port\":{d},\"pubkey\":\"{s}\",\"app\":\"{s}\"}}\n",
        .{ pid, port, pubkey_hex[0..64], app_name_buf[0..app_name_len] },
    ) catch return;

    // Absolute file I/O keeps this independent of the process working directory.
    const file = std.Io.Dir.createFileAbsolute(io, session_path_buf[0..session_path_len], .{}) catch return;
    defer file.close(io);
    file.writeStreamingAll(io, json) catch {};
}

fn removeSessionFile(io: std.Io) void {
    if (session_path_len == 0) return;
    std.Io.Dir.deleteFileAbsolute(io, session_path_buf[0..session_path_len]) catch {};
    session_path_len = 0;
}

// ── Handshake ──────────────────────────────────────────────────────

/// Compute pairing hash: SHA256(app_pubkey || tools_pubkey). Key pinning
/// prevents MITM key substitution between sessions.
fn computePairingHash(tools_pubkey: [32]u8) [32]u8 {
    var combined: [64]u8 = undefined;
    @memcpy(combined[0..32], &our_keypair.public_key);
    @memcpy(combined[32..64], &tools_pubkey);
    return app_crypto.hmacSha256("tsz-pairing-pin", &combined);
}

/// Fingerprint a tools pubkey: SHA256(pubkey).
fn keyFingerprint(pubkey: [32]u8) [32]u8 {
    return app_crypto.hmacSha256("tsz-key-fp", &pubkey);
}

/// Phase 1: client sends pubkey → check trust or show pairing code.
fn handleHandshake(io: std.Io, srv: *ipc.Server, raw: []const u8) void {
    const hex = jsonStr(raw, "pubkey") orelse {
        dropClient(srv);
        return;
    };
    if (hex.len != 64) {
        dropClient(srv);
        return;
    }
    _ = app_crypto.hexToBytes(hex, &pending_client_pubkey) catch {
        dropClient(srv);
        return;
    };

    // Check persistent trust: is this tools key already paired?
    const fp = keyFingerprint(pending_client_pubkey);
    for (trusted_fingerprints[0..trusted_count]) |tfp| {
        if (std.crypto.timing_safe.eql([32]u8, tfp, fp)) {
            // Key is trusted — verify pinning hash to detect key substitution
            if (verifyPinningHash(io, pending_client_pubkey)) {
                // Auto-reconnect: send challenge first, then encrypted OK
                _ = srv.sendLine("{\"challenge\":\"trusted\"}");
                completeDH(srv) catch {
                    dropClient(srv);
                    return;
                };
                return;
            }
            // Pinning hash mismatch — possible MITM, force fresh pairing
            break;
        }
    }

    // TSZ_DEBUG_AUTOACCEPT=1 — skip visual pairing for automated testing.
    // Only compiled in dev builds (behind HAS_DEBUG_SERVER comptime gate).
    if (auto_accept) {
        // Send challenge first (plaintext), then encrypted OK
        _ = srv.sendLine("{\"challenge\":\"auto_accepted\"}");
        completeDH(srv) catch {
            dropClient(srv);
            return;
        };
        savePairing(io, pending_client_pubkey);
        return;
    }

    // Not trusted or pin mismatch — require visual pairing
    var rng_bytes: [4]u8 = undefined;
    io.random(&rng_bytes);
    const rng_val = std.mem.readInt(u32, &rng_bytes, .little) % 1_000_000;
    _ = std.fmt.bufPrint(&pairing_code, "{d:0>6}", .{rng_val}) catch {};
    awaiting_code = true;
    _ = srv.sendLine("{\"challenge\":\"enter_code\"}");
}

/// Phase 2: client sends code → verify → complete DH → save trust.
fn handleCodeVerify(io: std.Io, srv: *ipc.Server, raw: []const u8) void {
    const code = jsonStr(raw, "code") orelse {
        dropClient(srv);
        awaiting_code = false;
        return;
    };
    if (code.len != 6 or !std.crypto.timing_safe.eql([6]u8, code[0..6].*, pairing_code)) {
        dropClient(srv);
        awaiting_code = false;
        return;
    }

    completeDH(srv) catch {
        dropClient(srv);
        awaiting_code = false;
        return;
    };
    awaiting_code = false;

    // Save persistent trust
    savePairing(io, pending_client_pubkey);
}

/// Complete X25519 DH + HKDF → shared key, mark authenticated.
fn completeDH(srv: *ipc.Server) !void {
    _ = srv;
    const dh_shared = try X25519.scalarmult(our_keypair.secret_key, pending_client_pubkey);
    const prk = app_crypto.hkdfExtract("tsz-debug-v1", &dh_shared);
    try app_crypto.hkdfExpand(&prk, "debug-channel", &shared_key);
    tx_nonce_counter = 0;
    authenticated = true;
    sendEncrypted(&(server.?), "{\"method\":\"debug.handshake\",\"ok\":true}");
}

// ── Persistent pairing ────────────────────────────────────────────

fn loadTrustedKeys(io: std.Io) void {
    trusted_count = 0;
    const home = home_buf[0..home_len];
    if (home.len == 0) return;
    var path_buf: [256]u8 = undefined;
    const path = std.fmt.bufPrint(&path_buf, "{s}/.tsz/paired/zigos.json", .{home}) catch return;
    const file = std.Io.Dir.openFileAbsolute(io, path, .{}) catch return;
    defer file.close(io);
    var buf: [1024]u8 = undefined;
    const n = file.readPositionalAll(io, &buf, 0) catch return;
    const data = buf[0..n];

    // Extract fingerprint hex and last_active from JSON
    const fp_hex = jsonStr(data, "tools_key_fingerprint") orelse return;
    const ts_str = jsonStr(data, "last_active") orelse return;
    const last_active = std.fmt.parseInt(i64, ts_str, 10) catch return;

    // Check 15 minute freshness
    const now = std.Io.Clock.now(.real, io).toSeconds();
    if (now - last_active > 15 * 60) return; // stale — require fresh pairing

    if (fp_hex.len != 64) return;
    if (trusted_count < MAX_TRUSTED) {
        _ = app_crypto.hexToBytes(fp_hex, &trusted_fingerprints[trusted_count]) catch return;
        trusted_count += 1;
    }
}

fn verifyPinningHash(io: std.Io, tools_pubkey: [32]u8) bool {
    const home = home_buf[0..home_len];
    if (home.len == 0) return false;
    var path_buf: [256]u8 = undefined;
    const path = std.fmt.bufPrint(&path_buf, "{s}/.tsz/paired/zigos.json", .{home}) catch return false;
    const file = std.Io.Dir.openFileAbsolute(io, path, .{}) catch return false;
    defer file.close(io);
    var buf: [1024]u8 = undefined;
    const n = file.readPositionalAll(io, &buf, 0) catch return false;
    const data = buf[0..n];

    const stored_hex = jsonStr(data, "pairing_hash") orelse return false;
    if (stored_hex.len != 64) return false;
    var stored_hash: [32]u8 = undefined;
    _ = app_crypto.hexToBytes(stored_hex, &stored_hash) catch return false;

    const computed = computePairingHash(tools_pubkey);
    return std.crypto.timing_safe.eql([32]u8, stored_hash, computed);
}

fn savePairing(io: std.Io, tools_pubkey: [32]u8) void {
    const home = home_buf[0..home_len];
    if (home.len == 0) return;

    // Ensure ~/.tsz/paired/ exists
    var dir_buf: [256]u8 = undefined;
    const dir = std.fmt.bufPrint(&dir_buf, "{s}/.tsz/paired", .{home}) catch return;
    std.Io.Dir.createDirAbsolute(io, dir, .default_dir) catch |err| switch (err) {
        error.PathAlreadyExists => {},
        else => return,
    };

    // Compute key pinning hash and fingerprint
    const pin_hash = computePairingHash(tools_pubkey);
    const fp = keyFingerprint(tools_pubkey);

    var pin_hex: [64]u8 = undefined;
    app_crypto.bytesToHex(&pin_hash, &pin_hex);
    var fp_hex: [64]u8 = undefined;
    app_crypto.bytesToHex(&fp, &fp_hex);

    const now = std.Io.Clock.now(.real, io).toSeconds();

    var json_buf: [512]u8 = undefined;
    const json = std.fmt.bufPrint(
        &json_buf,
        "{{\"pairing_hash\":\"{s}\",\"tools_key_fingerprint\":\"{s}\",\"last_active\":\"{d}\"}}\n",
        .{ pin_hex[0..64], fp_hex[0..64], now },
    ) catch return;

    var path_buf: [256]u8 = undefined;
    const path = std.fmt.bufPrint(&path_buf, "{s}/.tsz/paired/zigos.json", .{home}) catch return;
    const file = std.Io.Dir.createFileAbsolute(io, path, .{}) catch return;
    defer file.close(io);
    file.writeStreamingAll(io, json) catch {};

    // Update in-memory trust
    if (trusted_count < MAX_TRUSTED) {
        trusted_fingerprints[trusted_count] = fp;
        trusted_count += 1;
    }
}

/// Update last_active timestamp on incoming debug messages.
fn touchPairing(io: std.Io) void {
    const home = home_buf[0..home_len];
    if (home.len == 0) return;
    var path_buf: [256]u8 = undefined;
    const path = std.fmt.bufPrint(&path_buf, "{s}/.tsz/paired/zigos.json", .{home}) catch return;
    const file = std.Io.Dir.openFileAbsolute(io, path, .{ .mode = .read_write }) catch return;
    defer file.close(io);
    var buf: [1024]u8 = undefined;
    const n = file.readPositionalAll(io, &buf, 0) catch return;
    const data = buf[0..n];

    // Find and replace last_active value
    const key = "\"last_active\":\"";
    const key_pos = std.mem.indexOf(u8, data, key) orelse return;
    const val_start = key_pos + key.len;
    const val_end_pos = std.mem.indexOfPos(u8, data, val_start, "\"") orelse return;

    // Rebuild with new timestamp
    const now = std.Io.Clock.now(.real, io).toSeconds();
    var new_buf: [1024]u8 = undefined;
    var pos: usize = 0;
    ap(&new_buf, &pos, data[0..val_start]);
    var ts_buf: [20]u8 = undefined;
    const ts_str = std.fmt.bufPrint(&ts_buf, "{d}", .{now}) catch return;
    ap(&new_buf, &pos, ts_str);
    ap(&new_buf, &pos, data[val_end_pos..n]);

    file.writePositionalAll(io, new_buf[0..pos], 0) catch {};
}

fn dropClient(srv: *ipc.Server) void {
    if (srv.client) |*client| {
        client.deinit();
        srv.client = null;
    }
    // A protocol rejection drops only this peer; the listener remains ready
    // for the next connection.
    srv.dead = false;
    authenticated = false;
}

// ── Encrypted message I/O ──────────────────────────────────────────

fn nextTxNonce() [XChaCha.nonce_length]u8 {
    var nonce: [XChaCha.nonce_length]u8 = [_]u8{0} ** XChaCha.nonce_length;
    nonce[0] = 'T';
    const bytes = std.mem.asBytes(&tx_nonce_counter);
    @memcpy(nonce[16..24], bytes);
    tx_nonce_counter += 1;
    return nonce;
}

fn sendEncrypted(srv: *ipc.Server, plaintext: []const u8) void {
    if (plaintext.len > RESP_SIZE / 2 - 128) return;
    const nonce = nextTxNonce();
    var ct_buf: [RESP_SIZE / 2]u8 = undefined;
    var tag: [XChaCha.tag_length]u8 = undefined;
    XChaCha.encrypt(ct_buf[0..plaintext.len], &tag, plaintext, "", nonce, shared_key);

    var pos: usize = 0;
    hexEncode(&resp_buf, &pos, &nonce);
    hexEncode(&resp_buf, &pos, ct_buf[0..plaintext.len]);
    hexEncode(&resp_buf, &pos, &tag);
    if (pos < RESP_SIZE) {
        resp_buf[pos] = '\n';
        pos += 1;
    }
    _ = srv.send(resp_buf[0..pos]);
}

fn handleEncrypted(io: std.Io, srv: *ipc.Server, raw: []const u8) void {
    const min_hex = (XChaCha.nonce_length + XChaCha.tag_length) * 2;
    if (raw.len < min_hex) return;

    var wire_buf: [RESP_SIZE / 2]u8 = undefined;
    const wire_len = app_crypto.hexToBytes(raw, &wire_buf) catch return;
    if (wire_len < XChaCha.nonce_length + XChaCha.tag_length) return;

    const nonce = wire_buf[0..XChaCha.nonce_length].*;
    const ct_len = wire_len - XChaCha.nonce_length - XChaCha.tag_length;
    const ct = wire_buf[XChaCha.nonce_length .. XChaCha.nonce_length + ct_len];
    const tag = wire_buf[XChaCha.nonce_length + ct_len ..][0..XChaCha.tag_length].*;

    var pt_buf: [RESP_SIZE / 2]u8 = undefined;
    XChaCha.decrypt(pt_buf[0..ct_len], ct, tag, "", nonce, shared_key) catch {
        dropClient(srv);
        return;
    };
    handleRequest(io, srv, pt_buf[0..ct_len]);
}

// ── Request dispatch ───────────────────────────────────────────────

fn handleRequest(io: std.Io, srv: *ipc.Server, raw: []const u8) void {
    const method = jsonStr(raw, "method") orelse return;

    // Bump last_active on meaningful authenticated traffic
    touchPairing(io);

    if (eql(method, "debug.tree")) {
        respondTree(srv);
    } else if (eql(method, "debug.node")) {
        respondNode(srv, jsonInt(raw, "id") orelse return);
    } else if (eql(method, "debug.select")) {
        selected_node_id = jsonInt(raw, "id") orelse return;
        sendEncrypted(srv, "{\"method\":\"debug.select\",\"ok\":true}");
    } else if (eql(method, "debug.state")) {
        respondState(srv);
    } else if (eql(method, "debug.perf")) {
        respondPerf(srv);
    } else if (eql(method, "debug.telemetry.stream")) {
        streaming_telemetry = !streaming_telemetry;
        sendEncrypted(srv, if (streaming_telemetry)
            "{\"method\":\"debug.telemetry.stream\",\"streaming\":true}"
        else
            "{\"method\":\"debug.telemetry.stream\",\"streaming\":false}");
    } else if (eql(method, "debug.telemetry.history")) {
        respondTelemetryHistory(srv);
    } else if (eql(method, "debug.simulate.press") or
        eql(method, "debug.simulate.type") or
        eql(method, "debug.simulate.scroll"))
    {
        // SECURITY: reject if target is a terminal/PTY node
        sendEncrypted(srv, "{\"error\":\"simulate commands not yet implemented; terminal nodes are always read-only\"}");
    } else if (eql(method, "debug.script")) {
        // SECURITY: script execution blocked from PTY/shell access
        sendEncrypted(srv, "{\"error\":\"debug.script not yet implemented\"}");
    } else if (eql(method, "debug.snapshot")) {
        sendEncrypted(srv, "{\"error\":\"debug.snapshot not yet implemented\"}");
    } else {
        sendEncrypted(srv, "{\"error\":\"unknown method\"}");
    }
}

// ── Responders ─────────────────────────────────────────────────────

fn respondTree(srv: *ipc.Server) void {
    var pos: usize = 0;
    ap(&resp_buf, &pos, "{\"method\":\"debug.tree\",\"nodes\":[");
    const count = telemetry.nodeCount();
    for (0..count) |i| {
        const node = telemetry.getNode(i) orelse continue;
        if (i > 0) ap(&resp_buf, &pos, ",");
        ap(&resp_buf, &pos, "{\"i\":");
        apInt(&resp_buf, &pos, @intCast(i));
        ap(&resp_buf, &pos, ",\"t\":\"");
        ap(&resp_buf, &pos, telemetry.nodeTypeName(node));
        ap(&resp_buf, &pos, "\",\"d\":");
        apInt(&resp_buf, &pos, telemetry.getNodeDepth(i));
        ap(&resp_buf, &pos, "}");
        if (pos > RESP_SIZE / 2 - 256) break;
    }
    ap(&resp_buf, &pos, "]}");
    sendEncrypted(srv, resp_buf[0..pos]);
}

fn respondNode(srv: *ipc.Server, id: i32) void {
    if (id < 0) return;
    const node = telemetry.getNode(@intCast(id)) orelse {
        sendEncrypted(srv, "{\"method\":\"debug.node\",\"error\":\"not found\"}");
        return;
    };
    var pos: usize = 0;
    ap(&resp_buf, &pos, "{\"method\":\"debug.node\",\"id\":");
    apInt(&resp_buf, &pos, id);
    ap(&resp_buf, &pos, ",\"type\":\"");
    ap(&resp_buf, &pos, telemetry.nodeTypeName(node));
    ap(&resp_buf, &pos, "\",\"depth\":");
    apInt(&resp_buf, &pos, telemetry.getNodeDepth(@intCast(id)));
    ap(&resp_buf, &pos, "}");
    sendEncrypted(srv, resp_buf[0..pos]);
}

fn respondState(srv: *ipc.Server) void {
    const snap = telemetry.current;
    var pos: usize = 0;
    ap(&resp_buf, &pos, "{\"method\":\"debug.state\"");
    ap(&resp_buf, &pos, ",\"total_nodes\":");
    apInt(&resp_buf, &pos, @intCast(snap.total_nodes));
    ap(&resp_buf, &pos, ",\"visible_nodes\":");
    apInt(&resp_buf, &pos, @intCast(snap.visible_nodes));
    ap(&resp_buf, &pos, "}");
    sendEncrypted(srv, resp_buf[0..pos]);
}

fn respondPerf(srv: *ipc.Server) void {
    var pos: usize = 0;
    ap(&resp_buf, &pos, "{\"method\":\"debug.perf\"");
    appendPerfFields(&resp_buf, &pos, telemetry.current);
    ap(&resp_buf, &pos, "}");
    sendEncrypted(srv, resp_buf[0..pos]);
}

fn respondTelemetryHistory(srv: *ipc.Server) void {
    var pos: usize = 0;
    ap(&resp_buf, &pos, "{\"method\":\"debug.telemetry.history\",\"frames\":[");
    const max_frames: usize = @min(telemetry.historyCount(), 120);
    for (0..max_frames) |i| {
        const snap = telemetry.getHistory(i) orelse continue;
        if (i > 0) ap(&resp_buf, &pos, ",");
        ap(&resp_buf, &pos, "{");
        appendPerfFields(&resp_buf, &pos, snap.*);
        ap(&resp_buf, &pos, "}");
        if (pos > RESP_SIZE / 2 - 512) break;
    }
    ap(&resp_buf, &pos, "]}");
    sendEncrypted(srv, resp_buf[0..pos]);
}

fn pushTelemetryFrame(srv: *ipc.Server) void {
    var pos: usize = 0;
    ap(&resp_buf, &pos, "{\"method\":\"debug.telemetry.frame\"");
    appendPerfFields(&resp_buf, &pos, telemetry.current);
    ap(&resp_buf, &pos, "}");
    sendEncrypted(srv, resp_buf[0..pos]);
}

fn appendPerfFields(buf: []u8, pos: *usize, snap: telemetry.Snapshot) void {
    ap(buf, pos, ",\"fps\":");
    apInt(buf, pos, @intCast(snap.fps));
    ap(buf, pos, ",\"frame\":");
    apInt(buf, pos, @intCast(snap.frame_number));
    ap(buf, pos, ",\"layout_us\":");
    apInt(buf, pos, @intCast(snap.layout_us));
    ap(buf, pos, ",\"paint_us\":");
    apInt(buf, pos, @intCast(snap.paint_us));
    ap(buf, pos, ",\"gpu_us\":");
    apInt(buf, pos, @intCast(snap.gpu_us));
    ap(buf, pos, ",\"frame_total_us\":");
    apInt(buf, pos, @intCast(snap.frame_total_us));
    ap(buf, pos, ",\"rects\":");
    apInt(buf, pos, @intCast(snap.rect_count));
    ap(buf, pos, ",\"glyphs\":");
    apInt(buf, pos, @intCast(snap.glyph_count));
    ap(buf, pos, ",\"visible\":");
    apInt(buf, pos, @intCast(snap.visible_nodes));
    ap(buf, pos, ",\"total\":");
    apInt(buf, pos, @intCast(snap.total_nodes));
    ap(buf, pos, ",\"window_w\":");
    apInt(buf, pos, @intCast(snap.window_w));
    ap(buf, pos, ",\"window_h\":");
    apInt(buf, pos, @intCast(snap.window_h));
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

fn apInt(buf: []u8, pos: *usize, val: i64) void {
    var tmp: [20]u8 = undefined;
    const s = std.fmt.bufPrint(&tmp, "{d}", .{val}) catch return;
    ap(buf, pos, s);
}

fn eql(a: []const u8, b: []const u8) bool {
    return std.mem.eql(u8, a, b);
}

// ── Tests ──────────────────────────────────────────────────────────

test "e2e: X25519 handshake + visual pairing + encrypted debug.select" {
    // Start server
    startServer(std.testing.allocator, std.testing.io);
    defer deinit(std.testing.io);
    const port = server.?.getPort();
    try std.testing.expect(port > 0);

    // Client connects
    var client = try ipc.Client.connect(std.testing.allocator, std.testing.io, port);
    defer client.close();
    try std.testing.expect(server.?.acceptClient());

    // Phase 1: Client sends pubkey
    const client_kp = X25519.KeyPair.generate(std.testing.io);
    var pubkey_hex: [64]u8 = undefined;
    app_crypto.bytesToHex(&client_kp.public_key, &pubkey_hex);
    var msg_buf: [128]u8 = undefined;
    const hs_msg = std.fmt.bufPrint(&msg_buf, "{{\"pubkey\":\"{s}\"}}", .{pubkey_hex[0..64]}) catch unreachable;
    try std.testing.expect(client.sendLine(hs_msg));

    try std.Io.sleep(std.testing.io, .fromMilliseconds(20), .awake);
    poll(std.testing.io);

    // Server should be awaiting code, NOT authenticated yet
    try std.testing.expect(awaiting_code);
    try std.testing.expect(!authenticated);

    // Pairing code should be visible
    const code = getPairingCode() orelse return error.NoPairingCode;
    try std.testing.expectEqual(@as(usize, 6), code.len);

    // Client reads challenge response
    try std.Io.sleep(std.testing.io, .fromMilliseconds(20), .awake);
    const challenge_msgs = client.poll();
    try std.testing.expect(challenge_msgs.len > 0);
    try std.testing.expect(std.mem.indexOf(u8, challenge_msgs[0].data, "enter_code") != null);

    // Phase 2: Client sends the code (read from app screen by user)
    var code_buf: [64]u8 = undefined;
    const code_msg = std.fmt.bufPrint(&code_buf, "{{\"code\":\"{s}\"}}", .{code}) catch unreachable;
    try std.testing.expect(client.sendLine(code_msg));

    try std.Io.sleep(std.testing.io, .fromMilliseconds(20), .awake);
    poll(std.testing.io);

    // Now authenticated, pairing dismissed
    try std.testing.expect(authenticated);
    try std.testing.expect(!awaiting_code);
    try std.testing.expectEqual(@as(?[]const u8, null), getPairingCode());

    // Client derives same shared key
    const client_dh = X25519.scalarmult(client_kp.secret_key, our_keypair.public_key) catch unreachable;
    const client_prk = app_crypto.hkdfExtract("tsz-debug-v1", &client_dh);
    var client_shared: [32]u8 = undefined;
    app_crypto.hkdfExpand(&client_prk, "debug-channel", &client_shared) catch unreachable;

    // Read + decrypt handshake OK
    try std.Io.sleep(std.testing.io, .fromMilliseconds(20), .awake);
    const resp_msgs = client.poll();
    try std.testing.expect(resp_msgs.len > 0);
    const pt = try decryptWire(resp_msgs[0].data, client_shared);
    try std.testing.expect(std.mem.indexOf(u8, pt, "debug.handshake") != null);

    // Send encrypted debug.select
    const select_json = "{\"method\":\"debug.select\",\"id\":42}";
    var enc_buf: [2048]u8 = undefined;
    const enc_msg = encryptForSend(select_json, client_shared, &enc_buf);
    try std.testing.expect(client.sendLine(enc_msg));

    try std.Io.sleep(std.testing.io, .fromMilliseconds(20), .awake);
    poll(std.testing.io);
    try std.testing.expectEqual(@as(i32, 42), getSelectedNode());
}

test "wrong pairing code is rejected" {
    startServer(std.testing.allocator, std.testing.io);
    defer deinit(std.testing.io);
    var client = try ipc.Client.connect(std.testing.allocator, std.testing.io, server.?.getPort());
    defer client.close();
    _ = server.?.acceptClient();

    // Send pubkey
    const client_kp = X25519.KeyPair.generate(std.testing.io);
    var pubkey_hex: [64]u8 = undefined;
    app_crypto.bytesToHex(&client_kp.public_key, &pubkey_hex);
    var msg_buf: [128]u8 = undefined;
    const hs_msg = std.fmt.bufPrint(&msg_buf, "{{\"pubkey\":\"{s}\"}}", .{pubkey_hex[0..64]}) catch unreachable;
    _ = client.sendLine(hs_msg);
    try std.Io.sleep(std.testing.io, .fromMilliseconds(20), .awake);
    poll(std.testing.io);
    try std.testing.expect(awaiting_code);

    // Send wrong code
    _ = client.sendLine("{\"code\":\"000000\"}");
    try std.Io.sleep(std.testing.io, .fromMilliseconds(20), .awake);
    poll(std.testing.io);

    // Should be rejected
    try std.testing.expect(!authenticated);
    try std.testing.expect(!awaiting_code);
}

test "unauthenticated client is dropped" {
    startServer(std.testing.allocator, std.testing.io);
    defer deinit(std.testing.io);
    var client = try ipc.Client.connect(std.testing.allocator, std.testing.io, server.?.getPort());
    defer client.close();
    _ = server.?.acceptClient();
    _ = client.sendLine("{\"method\":\"debug.tree\"}");
    try std.Io.sleep(std.testing.io, .fromMilliseconds(10), .awake);
    poll(std.testing.io);
    try std.testing.expect(!authenticated);
}

// ── Test helpers ───────────────────────────────────────────────────

fn decryptWire(wire_hex: []const u8, key: [32]u8) ![]const u8 {
    const S = struct {
        var pt: [RESP_SIZE / 2]u8 = undefined;
        var wb: [RESP_SIZE / 2]u8 = undefined;
    };
    const wl = try app_crypto.hexToBytes(wire_hex, &S.wb);
    if (wl < XChaCha.nonce_length + XChaCha.tag_length) return error.TooShort;
    const nonce = S.wb[0..XChaCha.nonce_length].*;
    const ctl = wl - XChaCha.nonce_length - XChaCha.tag_length;
    const ct = S.wb[XChaCha.nonce_length .. XChaCha.nonce_length + ctl];
    const tag = S.wb[XChaCha.nonce_length + ctl ..][0..XChaCha.tag_length].*;
    try XChaCha.decrypt(S.pt[0..ctl], ct, tag, "", nonce, key);
    return S.pt[0..ctl];
}

fn encryptForSend(plaintext: []const u8, key: [32]u8, out: []u8) []const u8 {
    const S = struct {
        var ct: [512]u8 = undefined;
        var nc: u64 = 0;
    };
    var nonce: [XChaCha.nonce_length]u8 = [_]u8{0} ** XChaCha.nonce_length;
    nonce[0] = 'C';
    const nb = std.mem.asBytes(&S.nc);
    @memcpy(nonce[16..24], nb);
    S.nc += 1;
    var tag: [XChaCha.tag_length]u8 = undefined;
    XChaCha.encrypt(S.ct[0..plaintext.len], &tag, plaintext, "", nonce, key);
    var pos: usize = 0;
    hexEncode(out, &pos, &nonce);
    hexEncode(out, &pos, S.ct[0..plaintext.len]);
    hexEncode(out, &pos, &tag);
    return out[0..pos];
}
