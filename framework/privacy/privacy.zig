//! privacy.zig — Higher-level privacy operations for the tsz framework.
//!
//! Ports the remaining functions from love2d/lua/privacy.lua that aren't in crypto.zig.
//! Uses Zig std crypto exclusively — no external C dependencies (libsodium not needed).
//!
//! Implements:
//!   - Secure memory (mlock + secureZero)
//!   - File/directory integrity hashing (SHA-256)
//!   - Secure file deletion (overwrite + fsync + unlink)
//!   - Streaming file encryption/decryption (XChaCha20-Poly1305)
//!   - Whitespace steganography (zero-width Unicode chars)
//!   - Noise-NK secure channels (X25519 + HKDF + XChaCha20-Poly1305)
//!   - Tokenization (HMAC-SHA256 wrapper)
//!   - GPG operations (shell out to gpg CLI)
//!   - Metadata stripping (shell out to exiftool CLI)

const std = @import("std");
const crypto = std.crypto;
const Sha256 = crypto.hash.sha2.Sha256;
const X25519 = crypto.dh.X25519;
const XChaCha20Poly1305 = crypto.aead.chacha_poly.XChaCha20Poly1305;
const HmacSha256 = crypto.auth.hmac.sha2.HmacSha256;

const crmod = @import("crypto.zig");
const sodium = @import("sodium.zig");

/// Backend selector for any operation that can be served by either
/// std.crypto (Zig stdlib) or libsodium (battle-tested C).
pub const Backend = enum { std, sodium };

// ════════════════════════════════════════════════════════════════════════
// Secure Memory
// ════════════════════════════════════════════════════════════════════════

/// Backed by libsodium's `sodium_malloc` (page-aligned, mlock'd, guard pages,
/// canary, mprotect-ready). This replaces an earlier std-allocator-backed
/// implementation that only zeroed memory on free — that one couldn't honor
/// noaccess/readonly modes at the OS level, which is the whole point of a
/// secure buffer. Real protection requires libsodium.
pub const SecureBuffer = struct {
    region: sodium.SecureRegion,
    size: usize,
    access: AccessMode,

    pub const AccessMode = enum { readwrite, readonly, noaccess };

    /// Allocate a secure buffer from hex data.
    pub fn init(_: std.mem.Allocator, hex: []const u8) !SecureBuffer {
        if (!sodium.ready()) _ = sodium.init();
        const byte_len = hex.len / 2;
        if (byte_len == 0) return error.EmptyInput;

        const region = try sodium.secureAlloc(byte_len);
        errdefer sodium.secureFree(region);

        var dest: []u8 = undefined;
        dest.ptr = region.ptr;
        dest.len = byte_len;
        _ = crmod.hexToBytes(hex, dest) catch {
            sodium.secureFree(region);
            return error.InvalidHex;
        };

        return .{ .region = region, .size = byte_len, .access = .readwrite };
    }

    fn asSlice(self: *const SecureBuffer) []u8 {
        var s: []u8 = undefined;
        s.ptr = self.region.ptr;
        s.len = self.size;
        return s;
    }

    /// Read the buffer contents as hex. If currently noaccess/readonly,
    /// temporarily promote to readwrite for the duration of the read.
    pub fn readHex(self: *SecureBuffer, out: []u8) void {
        const prev = self.access;
        if (prev != .readwrite) sodium.secureProtect(self.region, .readwrite) catch {};
        crmod.bytesToHex(self.asSlice(), out[0 .. self.size * 2]);
        if (prev != .readwrite) sodium.secureProtect(self.region, switch (prev) {
            .readonly => .readonly,
            .noaccess => .noaccess,
            .readwrite => .readwrite,
        }) catch {};
    }

    /// Set OS-level page protection. Backed by sodium_mprotect_*.
    pub fn setAccess(self: *SecureBuffer, mode: AccessMode) void {
        self.access = mode;
        sodium.secureProtect(self.region, switch (mode) {
            .readwrite => .readwrite,
            .readonly => .readonly,
            .noaccess => .noaccess,
        }) catch {};
    }

    /// Zero and free. sodium_free zeroes by design before unmapping.
    pub fn deinit(self: *SecureBuffer, _: std.mem.Allocator) void {
        // sodium_free expects readwrite to clear; restore if needed.
        if (self.access != .readwrite) sodium.secureProtect(self.region, .readwrite) catch {};
        sodium.secureFree(self.region);
        self.size = 0;
    }
};

// ════════════════════════════════════════════════════════════════════════
// File Integrity Hashing
// ════════════════════════════════════════════════════════════════════════

/// SHA-256 hash of a byte slice. Returns 32-byte digest.
pub fn sha256Hash(data: []const u8) [32]u8 {
    var h = Sha256.init(.{});
    h.update(data);
    return h.finalResult();
}

/// SHA-256 hash a file. Returns hex-encoded digest.
pub fn hashFile(path: []const u8, out_hex: []u8) !void {
    const file = try std.fs.cwd().openFile(path, .{});
    defer file.close();

    var h = Sha256.init(.{});
    var buf: [8192]u8 = undefined;
    while (true) {
        const n = try file.read(&buf);
        if (n == 0) break;
        h.update(buf[0..n]);
    }
    const digest = h.finalResult();
    crmod.bytesToHex(&digest, out_hex[0..64]);
}

// ════════════════════════════════════════════════════════════════════════
// Secure File Deletion
// ════════════════════════════════════════════════════════════════════════

/// Overwrite a file with random data for N passes, fsync, then unlink.
/// Falls back to simple unlink on errors.
pub fn secureDelete(path: []const u8, passes: u32) !void {
    const n_passes = if (passes == 0) 3 else passes;

    // Get file size
    const stat = std.fs.cwd().statFile(path) catch {
        // If stat fails, just try to delete
        std.fs.cwd().deleteFile(path) catch {};
        return;
    };
    const size = stat.size;

    if (size > 0) {
        const file = try std.fs.cwd().openFile(path, .{ .mode = .write_only });
        defer file.close();

        var buf: [4096]u8 = undefined;

        for (0..n_passes) |pass| {
            try file.seekTo(0);
            var remaining = size;
            while (remaining > 0) {
                const chunk: usize = @min(buf.len, @as(usize, @intCast(remaining)));
                if (pass % 2 == 0) {
                    crypto.random.bytes(buf[0..chunk]);
                } else {
                    @memset(buf[0..chunk], 0xFF);
                }
                _ = try file.write(buf[0..chunk]);
                remaining -= @intCast(chunk);
            }
            try file.sync();
        }

        // Final zero pass
        try file.seekTo(0);
        @memset(&buf, 0);
        var remaining = size;
        while (remaining > 0) {
            const chunk: usize = @min(buf.len, @as(usize, @intCast(remaining)));
            _ = try file.write(buf[0..chunk]);
            remaining -= @intCast(chunk);
        }
        try file.sync();
    }

    try std.fs.cwd().deleteFile(path);
}

// ════════════════════════════════════════════════════════════════════════
// File Encryption / Decryption (XChaCha20-Poly1305)
// ════════════════════════════════════════════════════════════════════════

const file_magic = [_]u8{ 'T', 'S', 'Z', 'E' }; // "TSZE" = tsz encrypted
const file_version: u8 = 1;

/// Encrypt a file with password-derived key. Writes: magic|version|salt|nonce|tag|ciphertext.
pub fn encryptFile(
    alloc: std.mem.Allocator,
    input_path: []const u8,
    output_path: []const u8,
    key: *const [32]u8,
) !void {
    // Read input
    const data = try std.fs.cwd().readFileAlloc(alloc, input_path, 64 * 1024 * 1024);
    defer alloc.free(data);

    // Generate nonce
    var nonce: [24]u8 = undefined;
    crypto.random.bytes(&nonce);

    // Encrypt
    const ct = try alloc.alloc(u8, data.len);
    defer alloc.free(ct);
    var tag: [16]u8 = undefined;
    XChaCha20Poly1305.encrypt(ct, &tag, data, "", nonce, key.*);

    // Write output: magic(4) | version(1) | nonce(24) | tag(16) | ciphertext
    const out = try std.fs.cwd().createFile(output_path, .{});
    defer out.close();
    try out.writeAll(&file_magic);
    try out.writeAll(&[_]u8{file_version});
    try out.writeAll(&nonce);
    try out.writeAll(&tag);
    try out.writeAll(ct);
}

/// Decrypt a file. Reads the format written by encryptFile.
pub fn decryptFile(
    alloc: std.mem.Allocator,
    input_path: []const u8,
    output_path: []const u8,
    key: *const [32]u8,
) !void {
    const raw = try std.fs.cwd().readFileAlloc(alloc, input_path, 64 * 1024 * 1024);
    defer alloc.free(raw);

    // Parse header: magic(4) + version(1) + nonce(24) + tag(16) = 45 bytes
    if (raw.len < 45) return error.InvalidFileFormat;
    if (!std.mem.eql(u8, raw[0..4], &file_magic)) return error.InvalidFileFormat;
    if (raw[4] != file_version) return error.UnsupportedVersion;

    const nonce: [24]u8 = raw[5..29].*;
    const tag: [16]u8 = raw[29..45].*;
    const ct = raw[45..];

    const pt = try alloc.alloc(u8, ct.len);
    defer alloc.free(pt);
    XChaCha20Poly1305.decrypt(pt, ct, tag, "", nonce, key.*) catch return error.DecryptionFailed;

    const out = try std.fs.cwd().createFile(output_path, .{});
    defer out.close();
    try out.writeAll(pt);
}

// ════════════════════════════════════════════════════════════════════════
// Whitespace Steganography
// ════════════════════════════════════════════════════════════════════════

// U+200B ZERO WIDTH SPACE = 0xE2 0x80 0x8B
// U+200C ZERO WIDTH NON-JOINER = 0xE2 0x80 0x8C
const ZWS = [3]u8{ 0xE2, 0x80, 0x8B };
const ZWNJ = [3]u8{ 0xE2, 0x80, 0x8C };

/// Embed secret bytes into carrier text using zero-width characters.
/// Bits are inserted between the first and second visible characters.
/// Returns number of bytes written to out.
pub fn stegEmbedWhitespace(carrier: []const u8, secret: []const u8, out: []u8) usize {
    if (carrier.len < 2 or secret.len == 0) {
        const copy_len = @min(carrier.len, out.len);
        @memcpy(out[0..copy_len], carrier[0..copy_len]);
        return copy_len;
    }

    // Find first UTF-8 character boundary
    const first_len = utf8CharLen(carrier[0]);
    if (first_len >= carrier.len) {
        const copy_len = @min(carrier.len, out.len);
        @memcpy(out[0..copy_len], carrier[0..copy_len]);
        return copy_len;
    }

    var oi: usize = 0;

    // Write first visible character
    if (oi + first_len > out.len) return oi;
    @memcpy(out[oi..][0..first_len], carrier[0..first_len]);
    oi += first_len;

    // Embed all secret bits as ZWS (0) / ZWNJ (1)
    for (secret) |byte| {
        var bit: u3 = 7;
        while (true) {
            const is_one = (byte >> bit) & 1 != 0;
            const zwchar = if (is_one) &ZWNJ else &ZWS;
            if (oi + 3 > out.len) return oi;
            @memcpy(out[oi..][0..3], zwchar);
            oi += 3;
            if (bit == 0) break;
            bit -= 1;
        }
    }

    // Write remaining carrier characters
    const rest = carrier[first_len..];
    if (oi + rest.len > out.len) return oi;
    @memcpy(out[oi..][0..rest.len], rest);
    oi += rest.len;
    return oi;
}

/// Extract hidden bytes from steg-encoded text.
/// Returns number of secret bytes extracted into out.
pub fn stegExtractWhitespace(encoded: []const u8, out: []u8) usize {
    // Collect bits from ZWS/ZWNJ sequences
    var bits: [4096]u1 = undefined;
    var bit_count: usize = 0;
    var i: usize = 0;

    while (i + 2 < encoded.len) {
        if (encoded[i] == 0xE2 and encoded[i + 1] == 0x80) {
            if (encoded[i + 2] == 0x8B) { // ZWS = 0
                if (bit_count < bits.len) bits[bit_count] = 0;
                bit_count += 1;
                i += 3;
                continue;
            } else if (encoded[i + 2] == 0x8C) { // ZWNJ = 1
                if (bit_count < bits.len) bits[bit_count] = 1;
                bit_count += 1;
                i += 3;
                continue;
            }
        }
        i += utf8CharLen(encoded[i]);
    }

    // Assemble bits into bytes
    const byte_count = bit_count / 8;
    const n = @min(byte_count, out.len);
    for (0..n) |bi| {
        var byte: u8 = 0;
        for (0..8) |shift| {
            byte |= @as(u8, bits[bi * 8 + shift]) << @intCast(7 - shift);
        }
        out[bi] = byte;
    }
    return n;
}

fn utf8CharLen(first_byte: u8) usize {
    if (first_byte < 0x80) return 1;
    if (first_byte < 0xE0) return 2;
    if (first_byte < 0xF0) return 3;
    return 4;
}

// ════════════════════════════════════════════════════════════════════════
// Noise-NK Secure Channel
// ════════════════════════════════════════════════════════════════════════

pub const NoiseSession = struct {
    send_key: [32]u8,
    recv_key: [32]u8,
    send_nonce: u64,
    recv_nonce: u64,
    active: bool,

    /// Encrypt a message. Returns nonce(24) || tag(16) || ciphertext.
    pub fn send(self: *NoiseSession, plaintext: []const u8, out: []u8) !usize {
        if (!self.active) return error.SessionClosed;
        if (out.len < 40 + plaintext.len) return error.BufferTooSmall;

        // Build nonce from counter (padded to 24 bytes)
        var nonce: [24]u8 = [_]u8{0} ** 24;
        std.mem.writeInt(u64, nonce[16..24], self.send_nonce, .little);
        self.send_nonce += 1;

        var tag: [16]u8 = undefined;
        XChaCha20Poly1305.encrypt(out[40..][0..plaintext.len], &tag, plaintext, "", nonce, self.send_key);

        @memcpy(out[0..24], &nonce);
        @memcpy(out[24..40], &tag);
        return 40 + plaintext.len;
    }

    /// Decrypt a message. Input is nonce(24) || tag(16) || ciphertext.
    pub fn receive(self: *NoiseSession, message: []const u8, out: []u8) !usize {
        if (!self.active) return error.SessionClosed;
        if (message.len < 40) return error.MessageTooShort;

        const nonce: [24]u8 = message[0..24].*;
        const tag: [16]u8 = message[24..40].*;
        const ct = message[40..];

        if (out.len < ct.len) return error.BufferTooSmall;

        XChaCha20Poly1305.decrypt(out[0..ct.len], ct, tag, "", nonce, self.recv_key) catch
            return error.DecryptionFailed;

        self.recv_nonce += 1;
        return ct.len;
    }

    /// Close the session, zeroing keys.
    pub fn close(self: *NoiseSession) void {
        crypto.secureZero(u8, &self.send_key);
        crypto.secureZero(u8, &self.recv_key);
        self.active = false;
    }
};

/// Initiate a Noise-NK handshake. Takes the responder's static public key.
/// Returns the initiator session + ephemeral public key (handshake message).
pub fn noiseInitiate(responder_pub: [32]u8) !struct { session: NoiseSession, handshake: [32]u8 } {
    // Generate ephemeral X25519 key pair
    const eph_secret = X25519.KeyPair.generate();

    // DH(ephemeral_private, remote_static_public)
    const shared = try X25519.scalarmult(eph_secret.secret_key, responder_pub);

    // Derive send/recv keys via HKDF
    const send_info = "noise-nk-send";
    const recv_info = "noise-nk-recv";
    var send_key: [32]u8 = undefined;
    var recv_key: [32]u8 = undefined;

    const prk = crmod.hkdfExtract(&[_]u8{}, &shared);
    try crmod.hkdfExpand(&prk, send_info, &send_key);
    try crmod.hkdfExpand(&prk, recv_info, &recv_key);

    return .{
        .session = .{
            .send_key = send_key,
            .recv_key = recv_key,
            .send_nonce = 0,
            .recv_nonce = 0,
            .active = true,
        },
        .handshake = eph_secret.public_key,
    };
}

/// Respond to a Noise-NK handshake. Takes own static private key + initiator's ephemeral public.
/// Returns the responder session.
pub fn noiseRespond(static_secret: [32]u8, initiator_ephemeral: [32]u8) !NoiseSession {
    // DH(static_private, remote_ephemeral_public)
    const shared = try X25519.scalarmult(static_secret, initiator_ephemeral);

    // Derive keys (reversed: responder send = initiator recv)
    const send_info = "noise-nk-recv"; // reversed
    const recv_info = "noise-nk-send"; // reversed
    var send_key: [32]u8 = undefined;
    var recv_key: [32]u8 = undefined;

    const prk = crmod.hkdfExtract(&[_]u8{}, &shared);
    try crmod.hkdfExpand(&prk, send_info, &send_key);
    try crmod.hkdfExpand(&prk, recv_info, &recv_key);

    return .{
        .send_key = send_key,
        .recv_key = recv_key,
        .send_nonce = 0,
        .recv_nonce = 0,
        .active = true,
    };
}

// ════════════════════════════════════════════════════════════════════════
// Tokenization
// ════════════════════════════════════════════════════════════════════════

/// Tokenize a value using HMAC-SHA256(salt, value). Returns hex digest.
pub fn tokenize(value: []const u8, salt: []const u8) [64]u8 {
    const mac = crmod.hmacSha256(salt, value);
    var hex: [64]u8 = undefined;
    crmod.bytesToHex(&mac, &hex);
    return hex;
}

// ════════════════════════════════════════════════════════════════════════
// Shell helpers (for GPG and exiftool)
// ════════════════════════════════════════════════════════════════════════

fn runCommand(alloc: std.mem.Allocator, argv: []const []const u8) ![]u8 {
    const result = try std.process.Child.run(.{
        .allocator = alloc,
        .argv = argv,
        .max_output_bytes = 1024 * 1024,
    });
    alloc.free(result.stderr);
    return result.stdout;
}

fn commandExists(alloc: std.mem.Allocator, name: []const u8) bool {
    const result = runCommand(alloc, &.{ "which", name }) catch return false;
    alloc.free(result);
    return true;
}

// ════════════════════════════════════════════════════════════════════════
// GPG Operations (shell out to gpg CLI)
// ════════════════════════════════════════════════════════════════════════

pub fn gpgEncrypt(alloc: std.mem.Allocator, plaintext: []const u8, recipient: []const u8) ![]u8 {
    if (!commandExists(alloc, "gpg")) return error.GpgNotInstalled;

    // Write plaintext to temp file
    var tmp_path_buf: [64]u8 = undefined;
    const tmp_path = try std.fmt.bufPrint(&tmp_path_buf, "/tmp/tsz-gpg-{x}", .{std.crypto.random.int(u64)});

    {
        const f = try std.fs.cwd().createFile(tmp_path, .{});
        defer f.close();
        try f.writeAll(plaintext);
    }
    defer std.fs.cwd().deleteFile(tmp_path) catch {};

    const out_path_str = try std.fmt.allocPrint(alloc, "{s}.gpg", .{tmp_path});
    defer alloc.free(out_path_str);

    const result = runCommand(alloc, &.{
        "gpg", "--batch", "--yes", "--armor", "--encrypt",
        "--recipient", recipient, "--output", out_path_str, tmp_path,
    }) catch return error.GpgFailed;
    alloc.free(result);

    const encrypted = std.fs.cwd().readFileAlloc(alloc, out_path_str, 1024 * 1024) catch return error.GpgFailed;
    std.fs.cwd().deleteFile(out_path_str) catch {};
    return encrypted;
}

pub fn gpgDecrypt(alloc: std.mem.Allocator, ciphertext: []const u8) ![]u8 {
    if (!commandExists(alloc, "gpg")) return error.GpgNotInstalled;

    var tmp_path_buf: [64]u8 = undefined;
    const tmp_path = try std.fmt.bufPrint(&tmp_path_buf, "/tmp/tsz-gpg-{x}", .{std.crypto.random.int(u64)});

    {
        const f = try std.fs.cwd().createFile(tmp_path, .{});
        defer f.close();
        try f.writeAll(ciphertext);
    }
    defer std.fs.cwd().deleteFile(tmp_path) catch {};

    return runCommand(alloc, &.{ "gpg", "--batch", "--yes", "--decrypt", tmp_path });
}

pub fn gpgSign(alloc: std.mem.Allocator, message: []const u8) ![]u8 {
    if (!commandExists(alloc, "gpg")) return error.GpgNotInstalled;

    var tmp_path_buf: [64]u8 = undefined;
    const tmp_path = try std.fmt.bufPrint(&tmp_path_buf, "/tmp/tsz-gpg-{x}", .{std.crypto.random.int(u64)});

    {
        const f = try std.fs.cwd().createFile(tmp_path, .{});
        defer f.close();
        try f.writeAll(message);
    }
    defer std.fs.cwd().deleteFile(tmp_path) catch {};

    const result = runCommand(alloc, &.{ "gpg", "--batch", "--yes", "--armor", "--clearsign", tmp_path }) catch return error.GpgFailed;
    alloc.free(result);

    const asc_path = try std.fmt.allocPrint(alloc, "{s}.asc", .{tmp_path});
    defer alloc.free(asc_path);

    const signed = std.fs.cwd().readFileAlloc(alloc, asc_path, 1024 * 1024) catch return error.GpgFailed;
    std.fs.cwd().deleteFile(asc_path) catch {};
    return signed;
}

// ════════════════════════════════════════════════════════════════════════
// Metadata Stripping (shell out to exiftool CLI)
// ════════════════════════════════════════════════════════════════════════

pub fn metaStrip(alloc: std.mem.Allocator, path: []const u8) !void {
    if (!commandExists(alloc, "exiftool")) return error.ExiftoolNotInstalled;
    const result = try runCommand(alloc, &.{ "exiftool", "-all=", "-overwrite_original", path });
    alloc.free(result);
}

pub fn metaRead(alloc: std.mem.Allocator, path: []const u8) ![]u8 {
    if (!commandExists(alloc, "exiftool")) return error.ExiftoolNotInstalled;
    return runCommand(alloc, &.{ "exiftool", "-json", path });
}

// ════════════════════════════════════════════════════════════════════════
// Backend-selectable primitives (std.crypto vs libsodium)
//
// Higher-level callers — and ultimately the JS hook surface — pass a
// `Backend` to choose which implementation runs. The two backends are
// numerically equivalent on the standard test vectors; the choice is
// about which battle-tested codebase you trust.
// ════════════════════════════════════════════════════════════════════════

pub fn sha256With(backend: Backend, data: []const u8) [32]u8 {
    switch (backend) {
        .std => return sha256Hash(data),
        .sodium => {
            var out: [32]u8 = undefined;
            sodium.sha256(&out, data);
            return out;
        },
    }
}

pub fn hmacSha256With(backend: Backend, key: []const u8, message: []const u8) [32]u8 {
    switch (backend) {
        .std => return crmod.hmacSha256(key, message),
        .sodium => {
            var out: [32]u8 = undefined;
            sodium.hmacSha256(&out, message, key);
            return out;
        },
    }
}

pub fn hkdfSha256With(
    backend: Backend,
    ikm: []const u8,
    salt: []const u8,
    info: []const u8,
    out: []u8,
) !void {
    switch (backend) {
        .std => {
            const prk = crmod.hkdfExtract(salt, ikm);
            try crmod.hkdfExpand(&prk, info, out);
        },
        .sodium => {
            var prk: [32]u8 = undefined;
            sodium.hkdfExtract(&prk, salt, ikm);
            try sodium.hkdfExpand(&prk, info, out);
        },
    }
}

/// XChaCha20-Poly1305 encrypt. `out` must be plaintext.len + 16 bytes.
pub fn xchachaEncryptWith(
    backend: Backend,
    out: []u8,
    plaintext: []const u8,
    aad: []const u8,
    nonce: *const [24]u8,
    key: *const [32]u8,
) !usize {
    switch (backend) {
        .std => {
            if (out.len < plaintext.len + 16) return error.BufferTooSmall;
            var tag: [16]u8 = undefined;
            XChaCha20Poly1305.encrypt(out[0..plaintext.len], &tag, plaintext, aad, nonce.*, key.*);
            @memcpy(out[plaintext.len..][0..16], &tag);
            return plaintext.len + 16;
        },
        .sodium => return sodium.xchachaEncrypt(out, plaintext, aad, nonce, key),
    }
}

pub fn xchachaDecryptWith(
    backend: Backend,
    out: []u8,
    ciphertext: []const u8,
    aad: []const u8,
    nonce: *const [24]u8,
    key: *const [32]u8,
) !usize {
    switch (backend) {
        .std => {
            if (ciphertext.len < 16) return error.CiphertextTooShort;
            const ct_len = ciphertext.len - 16;
            if (out.len < ct_len) return error.BufferTooSmall;
            const tag: [16]u8 = ciphertext[ct_len..][0..16].*;
            XChaCha20Poly1305.decrypt(out[0..ct_len], ciphertext[0..ct_len], tag, aad, nonce.*, key.*) catch
                return error.DecryptFailed;
            return ct_len;
        },
        .sodium => return sodium.xchachaDecrypt(out, ciphertext, aad, nonce, key),
    }
}

pub fn randomBytesWith(backend: Backend, out: []u8) void {
    switch (backend) {
        .std => crypto.random.bytes(out),
        .sodium => sodium.randomBytes(out),
    }
}

// ════════════════════════════════════════════════════════════════════════
// Directory Hashing & Manifest Verification
// ════════════════════════════════════════════════════════════════════════

pub const ManifestEntry = struct {
    path: []const u8, // owned by alloc
    hash_hex: [64]u8,
};

pub const Manifest = struct {
    entries: std.ArrayList(ManifestEntry),
    alloc: std.mem.Allocator,

    pub fn deinit(self: *Manifest) void {
        for (self.entries.items) |e| self.alloc.free(e.path);
        self.entries.deinit(self.alloc);
    }
};

fn pathLessThan(_: void, a: ManifestEntry, b: ManifestEntry) bool {
    return std.mem.lessThan(u8, a.path, b.path);
}

/// Walk a directory and SHA-256 every file. Sorted entries → deterministic.
pub fn hashDirectory(
    alloc: std.mem.Allocator,
    dir_path: []const u8,
    recursive: bool,
) !Manifest {
    var entries: std.ArrayList(ManifestEntry) = .{};
    errdefer {
        for (entries.items) |e| alloc.free(e.path);
        entries.deinit(alloc);
    }

    var dir = try std.fs.cwd().openDir(dir_path, .{ .iterate = true });
    defer dir.close();

    if (recursive) {
        var walker = try dir.walk(alloc);
        defer walker.deinit();
        while (try walker.next()) |entry| {
            if (entry.kind != .file) continue;
            const full = try std.fmt.allocPrint(alloc, "{s}/{s}", .{ dir_path, entry.path });
            errdefer alloc.free(full);
            var hex: [64]u8 = undefined;
            try hashFile(full, &hex);
            try entries.append(alloc, .{ .path = full, .hash_hex = hex });
        }
    } else {
        var it = dir.iterate();
        while (try it.next()) |entry| {
            if (entry.kind != .file) continue;
            const full = try std.fmt.allocPrint(alloc, "{s}/{s}", .{ dir_path, entry.name });
            errdefer alloc.free(full);
            var hex: [64]u8 = undefined;
            try hashFile(full, &hex);
            try entries.append(alloc, .{ .path = full, .hash_hex = hex });
        }
    }

    std.mem.sort(ManifestEntry, entries.items, {}, pathLessThan);
    return .{ .entries = entries, .alloc = alloc };
}

/// Serialize a manifest to JSON: `{"version":1,"entries":[{"path":...,"hash":...},...]}`.
pub fn manifestToJson(alloc: std.mem.Allocator, manifest: *const Manifest) ![]u8 {
    var buf: std.ArrayList(u8) = .{};
    errdefer buf.deinit(alloc);
    try buf.appendSlice(alloc, "{\"version\":1,\"entries\":[");
    for (manifest.entries.items, 0..) |entry, i| {
        if (i > 0) try buf.append(alloc, ',');
        try buf.appendSlice(alloc, "{\"path\":");
        try jsonQuoteString(alloc, &buf, entry.path);
        try buf.appendSlice(alloc, ",\"hash\":\"");
        try buf.appendSlice(alloc, &entry.hash_hex);
        try buf.appendSlice(alloc, "\"}");
    }
    try buf.appendSlice(alloc, "]}");
    return try buf.toOwnedSlice(alloc);
}

fn jsonQuoteString(alloc: std.mem.Allocator, out: *std.ArrayList(u8), s: []const u8) !void {
    try out.append(alloc, '"');
    for (s) |b| {
        switch (b) {
            '"' => try out.appendSlice(alloc, "\\\""),
            '\\' => try out.appendSlice(alloc, "\\\\"),
            '\n' => try out.appendSlice(alloc, "\\n"),
            '\r' => try out.appendSlice(alloc, "\\r"),
            '\t' => try out.appendSlice(alloc, "\\t"),
            0...0x08, 0x0B, 0x0C, 0x0E...0x1F => {
                var hex: [6]u8 = undefined;
                _ = std.fmt.bufPrint(&hex, "\\u{x:0>4}", .{b}) catch unreachable;
                try out.appendSlice(alloc, &hex);
            },
            else => try out.append(alloc, b),
        }
    }
    try out.append(alloc, '"');
}

pub const ManifestVerifyResult = struct {
    ok: bool,
    /// Files in the manifest whose current hash differs.
    mismatched: []const []const u8,
    /// Files in the manifest that no longer exist.
    missing: []const []const u8,
    alloc: std.mem.Allocator,

    pub fn deinit(self: *ManifestVerifyResult) void {
        for (self.mismatched) |s| self.alloc.free(s);
        for (self.missing) |s| self.alloc.free(s);
        self.alloc.free(self.mismatched);
        self.alloc.free(self.missing);
    }
};

/// Compare each manifest entry against the current filesystem state.
pub fn verifyManifest(alloc: std.mem.Allocator, manifest: *const Manifest) !ManifestVerifyResult {
    var mismatched: std.ArrayList([]const u8) = .{};
    errdefer {
        for (mismatched.items) |s| alloc.free(s);
        mismatched.deinit(alloc);
    }
    var missing: std.ArrayList([]const u8) = .{};
    errdefer {
        for (missing.items) |s| alloc.free(s);
        missing.deinit(alloc);
    }

    for (manifest.entries.items) |entry| {
        var hex: [64]u8 = undefined;
        hashFile(entry.path, &hex) catch {
            const owned = try alloc.dupe(u8, entry.path);
            try missing.append(alloc, owned);
            continue;
        };
        if (!std.mem.eql(u8, &hex, &entry.hash_hex)) {
            const owned = try alloc.dupe(u8, entry.path);
            try mismatched.append(alloc, owned);
        }
    }

    return .{
        .ok = mismatched.items.len == 0 and missing.items.len == 0,
        .mismatched = try mismatched.toOwnedSlice(alloc),
        .missing = try missing.toOwnedSlice(alloc),
        .alloc = alloc,
    };
}

// ════════════════════════════════════════════════════════════════════════
// GPG Operations (extended) — verify, listKeys, importKey, exportKey
// ════════════════════════════════════════════════════════════════════════

/// Verify a clearsigned message. Returns true on a good signature.
pub fn gpgVerify(alloc: std.mem.Allocator, signed_message: []const u8) !bool {
    if (!commandExists(alloc, "gpg")) return error.GpgNotInstalled;

    var tmp_path_buf: [64]u8 = undefined;
    const tmp_path = try std.fmt.bufPrint(&tmp_path_buf, "/tmp/tsz-gpg-{x}", .{std.crypto.random.int(u64)});

    {
        const f = try std.fs.cwd().createFile(tmp_path, .{});
        defer f.close();
        try f.writeAll(signed_message);
    }
    defer std.fs.cwd().deleteFile(tmp_path) catch {};

    var child = std.process.Child.init(&.{ "gpg", "--batch", "--verify", tmp_path }, alloc);
    child.stdout_behavior = .Ignore;
    child.stderr_behavior = .Ignore;
    try child.spawn();
    const term = try child.wait();
    return switch (term) {
        .Exited => |code| code == 0,
        else => false,
    };
}

pub fn gpgListKeys(alloc: std.mem.Allocator) ![]u8 {
    if (!commandExists(alloc, "gpg")) return error.GpgNotInstalled;
    return runCommand(alloc, &.{ "gpg", "--batch", "--list-keys", "--with-colons" });
}

pub fn gpgImportKey(alloc: std.mem.Allocator, armored_key: []const u8) ![]u8 {
    if (!commandExists(alloc, "gpg")) return error.GpgNotInstalled;

    var tmp_path_buf: [64]u8 = undefined;
    const tmp_path = try std.fmt.bufPrint(&tmp_path_buf, "/tmp/tsz-gpg-{x}.asc", .{std.crypto.random.int(u64)});

    {
        const f = try std.fs.cwd().createFile(tmp_path, .{});
        defer f.close();
        try f.writeAll(armored_key);
    }
    defer std.fs.cwd().deleteFile(tmp_path) catch {};

    return runCommand(alloc, &.{ "gpg", "--batch", "--import", tmp_path });
}

pub fn gpgExportKey(alloc: std.mem.Allocator, key_id: []const u8) ![]u8 {
    if (!commandExists(alloc, "gpg")) return error.GpgNotInstalled;
    return runCommand(alloc, &.{ "gpg", "--batch", "--armor", "--export", key_id });
}

// ════════════════════════════════════════════════════════════════════════
// Identity & Anonymity
//
// anonymousId      — HMAC-SHA256(domain, seed). Deterministic within domain,
//                    unlinkable across.
// pseudonym        — HKDF-SHA256(masterSecret, info=context). Per-context
//                    32-byte derived identifier.
// isolatedCredential — fresh Ed25519 keypair scoped to a domain.
// ════════════════════════════════════════════════════════════════════════

pub fn anonymousId(backend: Backend, domain: []const u8, seed: []const u8) [32]u8 {
    return hmacSha256With(backend, domain, seed);
}

pub fn pseudonym(
    backend: Backend,
    master_secret: []const u8,
    context: []const u8,
    out: *[32]u8,
) !void {
    try hkdfSha256With(backend, master_secret, &.{}, context, out);
}

pub const IsolatedCredential = struct {
    domain: []u8, // owned
    public_key: [32]u8,
    secret_key: [64]u8, // Ed25519 secret = seed||public
    key_id: [16]u8,

    pub fn deinit(self: *IsolatedCredential, alloc: std.mem.Allocator) void {
        // Zero secret material before freeing.
        crypto.secureZero(u8, &self.secret_key);
        alloc.free(self.domain);
    }
};

/// Generate a fresh Ed25519 credential scoped to `domain`. Always libsodium
/// because Ed25519 detached signing is what the lua surface exposed.
pub fn isolatedCredential(alloc: std.mem.Allocator, domain: []const u8) !IsolatedCredential {
    if (!sodium.ready()) _ = sodium.init();
    const kp = sodium.signKeypair();
    var key_id: [16]u8 = undefined;
    sodium.randomBytes(&key_id);
    return .{
        .domain = try alloc.dupe(u8, domain),
        .public_key = kp.public,
        .secret_key = kp.secret,
        .key_id = key_id,
    };
}

// ════════════════════════════════════════════════════════════════════════
// Noise-NK Session Registry
//
// Mirrors love2d/lua/privacy.lua's sessionId-based API:
//   noiseInitiateSession(remotePub) → { sessionId, message }
//   noiseRespondSession(staticPriv, message) → { sessionId }
//   noiseSendSession(sessionId, plaintext) → ciphertext
//   noiseReceiveSession(sessionId, ciphertext) → plaintext  (replay-checked)
//   noiseCloseSession(sessionId) → void
// ════════════════════════════════════════════════════════════════════════

const NoiseRegistryEntry = struct {
    id: u32,
    session: NoiseSession,
    /// Replay protection: hash of every received ciphertext seen so far.
    seen_hashes: std.AutoArrayHashMapUnmanaged([32]u8, void),
};

var g_noise_registry: ?std.ArrayList(NoiseRegistryEntry) = null;
var g_noise_next_id: u32 = 1;
var g_noise_alloc: std.mem.Allocator = std.heap.c_allocator;

fn noiseRegistry() *std.ArrayList(NoiseRegistryEntry) {
    if (g_noise_registry == null) {
        g_noise_registry = .{};
    }
    return &g_noise_registry.?;
}

fn noiseFindEntry(id: u32) ?*NoiseRegistryEntry {
    const reg = noiseRegistry();
    for (reg.items) |*e| {
        if (e.id == id) return e;
    }
    return null;
}

pub const NoiseInitiateResult = struct {
    session_id: u32,
    handshake: [32]u8,
};

pub fn noiseInitiateSession(responder_pub: [32]u8) !NoiseInitiateResult {
    const result = try noiseInitiate(responder_pub);
    const id = g_noise_next_id;
    g_noise_next_id += 1;
    try noiseRegistry().append(g_noise_alloc, .{
        .id = id,
        .session = result.session,
        .seen_hashes = .{},
    });
    return .{ .session_id = id, .handshake = result.handshake };
}

pub fn noiseRespondSession(static_secret: [32]u8, initiator_ephemeral: [32]u8) !u32 {
    const session = try noiseRespond(static_secret, initiator_ephemeral);
    const id = g_noise_next_id;
    g_noise_next_id += 1;
    try noiseRegistry().append(g_noise_alloc, .{
        .id = id,
        .session = session,
        .seen_hashes = .{},
    });
    return id;
}

pub fn noiseSendSession(session_id: u32, plaintext: []const u8, out: []u8) !usize {
    const entry = noiseFindEntry(session_id) orelse return error.NoSuchSession;
    return entry.session.send(plaintext, out);
}

/// Decrypts the message and rejects replays via a per-session seen-hash set.
pub fn noiseReceiveSession(session_id: u32, message: []const u8, out: []u8) !usize {
    const entry = noiseFindEntry(session_id) orelse return error.NoSuchSession;

    // Replay check: SHA-256 of the wire bytes acts as the dedupe key.
    var hash: [32]u8 = undefined;
    var h = Sha256.init(.{});
    h.update(message);
    h.final(&hash);
    if (entry.seen_hashes.contains(hash)) return error.ReplayDetected;

    const n = try entry.session.receive(message, out);
    try entry.seen_hashes.put(g_noise_alloc, hash, {});
    return n;
}

pub fn noiseCloseSession(session_id: u32) void {
    const reg = noiseRegistry();
    var i: usize = 0;
    while (i < reg.items.len) : (i += 1) {
        if (reg.items[i].id == session_id) {
            reg.items[i].session.close();
            reg.items[i].seen_hashes.deinit(g_noise_alloc);
            _ = reg.orderedRemove(i);
            return;
        }
    }
}

// ════════════════════════════════════════════════════════════════════════
// Shamir Secret Sharing — GF(256), polynomial of degree k-1
// ════════════════════════════════════════════════════════════════════════

var gf_exp: [512]u8 = undefined;
var gf_log: [256]u8 = undefined;
var gf_inited: bool = false;

fn gfInit() void {
    if (gf_inited) return;
    var x: u16 = 1;
    var i: usize = 0;
    while (i < 255) : (i += 1) {
        gf_exp[i] = @intCast(x);
        gf_log[@as(usize, @intCast(x))] = @intCast(i);
        x = (x << 1) ^ x;
        if ((x & 0x100) != 0) x ^= 0x11B;
        x &= 0xFF;
    }
    var j: usize = 255;
    while (j < 511) : (j += 1) gf_exp[j] = gf_exp[j - 255];
    gf_exp[511] = gf_exp[256];
    gf_log[0] = 0;
    gf_inited = true;
}

fn gfMul(a: u8, b: u8) u8 {
    if (a == 0 or b == 0) return 0;
    return gf_exp[@as(usize, gf_log[a]) + @as(usize, gf_log[b])];
}

fn gfInv(a: u8) u8 {
    return gf_exp[255 - @as(usize, gf_log[a])];
}

fn evalPoly(coeffs: []const u8, x: u8) u8 {
    var r: u8 = 0;
    var i: usize = coeffs.len;
    while (i > 0) {
        i -= 1;
        r = gfMul(r, x) ^ coeffs[i];
    }
    return r;
}

pub const ShamirShare = struct { index: u8, bytes: []u8 };

pub fn shamirSplit(
    a: std.mem.Allocator,
    secret: []const u8,
    n: u8,
    k: u8,
) ![]ShamirShare {
    if (k < 2) return error.ThresholdTooLow;
    if (n < k) return error.NotEnoughShares;
    gfInit();
    const shares = try a.alloc(ShamirShare, n);
    errdefer a.free(shares);
    var allocated: usize = 0;
    errdefer for (shares[0..allocated]) |sh| a.free(sh.bytes);
    for (shares, 0..) |*sh, idx| {
        sh.* = .{ .index = @intCast(idx + 1), .bytes = try a.alloc(u8, secret.len) };
        allocated += 1;
    }
    const coeffs = try a.alloc(u8, k);
    defer a.free(coeffs);
    var byte_idx: usize = 0;
    while (byte_idx < secret.len) : (byte_idx += 1) {
        coeffs[0] = secret[byte_idx];
        crypto.random.bytes(coeffs[1..]);
        for (shares) |sh| sh.bytes[byte_idx] = evalPoly(coeffs, sh.index);
    }
    return shares;
}

pub fn shamirCombine(
    a: std.mem.Allocator,
    shares: []const ShamirShare,
) ![]u8 {
    if (shares.len < 2) return error.NotEnoughShares;
    gfInit();
    const len = shares[0].bytes.len;
    const out = try a.alloc(u8, len);
    var byte: usize = 0;
    while (byte < len) : (byte += 1) {
        var secret: u8 = 0;
        for (shares, 0..) |si, i| {
            var li: u8 = 1;
            for (shares, 0..) |sj, j| {
                if (i == j) continue;
                li = gfMul(li, gfMul(sj.index, gfInv(si.index ^ sj.index)));
            }
            secret ^= gfMul(si.bytes[byte], li);
        }
        out[byte] = secret;
    }
    return out;
}

// ════════════════════════════════════════════════════════════════════════
// Envelope Encryption — random DEK wrapped by KEK; both XChaCha20-Poly1305
// ════════════════════════════════════════════════════════════════════════

pub const Envelope = struct {
    /// 32-byte ciphertext + 16-byte tag = 48 bytes.
    encrypted_dek: [48]u8,
    dek_nonce: [24]u8,
    /// data ciphertext (variable) + 16-byte tag.
    ciphertext: []u8,
    data_nonce: [24]u8,
};

pub fn envelopeEncrypt(a: std.mem.Allocator, data: []const u8, kek: [32]u8) !Envelope {
    var dek: [32]u8 = undefined;
    crypto.random.bytes(&dek);
    defer crypto.secureZero(u8, &dek);

    var data_nonce: [24]u8 = undefined;
    var dek_nonce: [24]u8 = undefined;
    crypto.random.bytes(&data_nonce);
    crypto.random.bytes(&dek_nonce);

    const ct = try a.alloc(u8, data.len + 16);
    var data_tag: [16]u8 = undefined;
    XChaCha20Poly1305.encrypt(ct[0..data.len], &data_tag, data, "", data_nonce, dek);
    @memcpy(ct[data.len..], &data_tag);

    var edek: [48]u8 = undefined;
    var dek_tag: [16]u8 = undefined;
    XChaCha20Poly1305.encrypt(edek[0..32], &dek_tag, &dek, "", dek_nonce, kek);
    @memcpy(edek[32..], &dek_tag);

    return .{ .encrypted_dek = edek, .dek_nonce = dek_nonce, .ciphertext = ct, .data_nonce = data_nonce };
}

pub fn envelopeDecrypt(
    a: std.mem.Allocator,
    encrypted_dek: [48]u8,
    dek_nonce: [24]u8,
    ciphertext: []const u8,
    data_nonce: [24]u8,
    kek: [32]u8,
) ![]u8 {
    if (ciphertext.len < 16) return error.InvalidEnvelope;
    var dek: [32]u8 = undefined;
    defer crypto.secureZero(u8, &dek);
    var dek_tag: [16]u8 = undefined;
    @memcpy(&dek_tag, encrypted_dek[32..]);
    XChaCha20Poly1305.decrypt(&dek, encrypted_dek[0..32], dek_tag, "", dek_nonce, kek) catch
        return error.DecryptionFailed;

    const pt_len = ciphertext.len - 16;
    const out = try a.alloc(u8, pt_len);
    errdefer a.free(out);
    var data_tag: [16]u8 = undefined;
    @memcpy(&data_tag, ciphertext[pt_len..]);
    XChaCha20Poly1305.decrypt(out, ciphertext[0..pt_len], data_tag, "", data_nonce, dek) catch
        return error.DecryptionFailed;
    return out;
}

// ════════════════════════════════════════════════════════════════════════
// Image Steganography (raw RGBA pixel buffer, 1 LSB / channel × 3 channels)
// The cart wraps in/out with PNG codec. Buffer is W*H*4 bytes; channels 0..2
// are R/G/B (alpha untouched). 4-byte big-endian length header is embedded
// before the payload.
// ════════════════════════════════════════════════════════════════════════

inline fn stegWriteBit(buf: []u8, bit_idx: usize, bit: u8) void {
    const px = bit_idx / 3;
    const ch = bit_idx % 3;
    const byte_idx = px * 4 + ch;
    buf[byte_idx] = (buf[byte_idx] & 0xFE) | (bit & 1);
}

inline fn stegReadBit(buf: []const u8, bit_idx: usize) u8 {
    const px = bit_idx / 3;
    const ch = bit_idx % 3;
    return buf[px * 4 + ch] & 1;
}

pub fn stegEmbedImageRGBA(rgba: []u8, data: []const u8) !void {
    const pixels = rgba.len / 4;
    const capacity_bytes = (pixels * 3) / 8;
    if (data.len + 4 > capacity_bytes) return error.InsufficientCapacity;
    var idx: usize = 0;
    const dl: u32 = @intCast(data.len);
    const hdr: [4]u8 = .{
        @intCast((dl >> 24) & 0xFF),
        @intCast((dl >> 16) & 0xFF),
        @intCast((dl >> 8) & 0xFF),
        @intCast(dl & 0xFF),
    };
    for (hdr) |b| {
        var bb: u32 = 0;
        while (bb < 8) : (bb += 1) {
            stegWriteBit(rgba, idx, @intCast((b >> @intCast(7 - bb)) & 1));
            idx += 1;
        }
    }
    for (data) |b| {
        var bb: u32 = 0;
        while (bb < 8) : (bb += 1) {
            stegWriteBit(rgba, idx, @intCast((b >> @intCast(7 - bb)) & 1));
            idx += 1;
        }
    }
}

pub fn stegExtractImageRGBA(a: std.mem.Allocator, rgba: []const u8) ![]u8 {
    var idx: usize = 0;
    var dl: u32 = 0;
    var i: usize = 0;
    while (i < 32) : (i += 1) {
        dl = (dl << 1) | stegReadBit(rgba, idx);
        idx += 1;
    }
    const pixels = rgba.len / 4;
    const capacity_bytes = (pixels * 3) / 8;
    if (dl == 0 or dl > capacity_bytes - 4) return error.InvalidStegData;
    const out = try a.alloc(u8, dl);
    errdefer a.free(out);
    for (out) |*b| {
        var v: u8 = 0;
        var bb: usize = 0;
        while (bb < 8) : (bb += 1) {
            v = (v << 1) | stegReadBit(rgba, idx);
            idx += 1;
        }
        b.* = v;
    }
    return out;
}

// ════════════════════════════════════════════════════════════════════════
// Audit Log — HMAC-SHA-256 hash chain (in-memory)
// ════════════════════════════════════════════════════════════════════════

pub const AuditEntry = struct {
    index: u32,
    timestamp: i64,
    event: []u8,
    data_json: []u8,
    hash_hex: [64]u8,
    prev_hash_hex: [64]u8,
};

const AuditState = struct {
    chain_key: [32]u8 = undefined,
    initialized: bool = false,
    entries: std.ArrayList(AuditEntry) = .{},
};

var g_audit: AuditState = .{};
const audit_alloc = std.heap.c_allocator;

const ZERO_HASH: [64]u8 = [_]u8{'0'} ** 64;

fn buildAuditMsg(buf: *std.ArrayList(u8), prev_hex: [64]u8, idx: u32, ts: i64, event: []const u8, data_json: []const u8) !void {
    try buf.appendSlice(audit_alloc, &prev_hex);
    try std.fmt.format(buf.writer(audit_alloc),
        "{{\"index\":{d},\"timestamp\":{d},\"event\":", .{ idx, ts });
    try jsonQuoteString(audit_alloc, buf, event);
    try buf.appendSlice(audit_alloc, ",\"data\":");
    try buf.appendSlice(audit_alloc, data_json);
    try buf.appendSlice(audit_alloc, ",\"prevHash\":\"");
    try buf.appendSlice(audit_alloc, &prev_hex);
    try buf.appendSlice(audit_alloc, "\"}");
}

pub fn auditCreate(key_hex: []const u8) !void {
    if (key_hex.len != 64) return error.InvalidKey;
    _ = try crmod.hexToBytes(key_hex, &g_audit.chain_key);
    for (g_audit.entries.items) |e| {
        audit_alloc.free(e.event);
        audit_alloc.free(e.data_json);
    }
    g_audit.entries.clearRetainingCapacity();
    g_audit.initialized = true;
}

pub fn auditAppend(event: []const u8, data_json: []const u8) !AuditEntry {
    if (!g_audit.initialized) return error.NotInitialized;
    const idx: u32 = @intCast(g_audit.entries.items.len);
    var prev_hex: [64]u8 = ZERO_HASH;
    if (idx > 0) prev_hex = g_audit.entries.items[idx - 1].hash_hex;
    const ts = std.time.milliTimestamp();

    var msg: std.ArrayList(u8) = .{};
    defer msg.deinit(audit_alloc);
    try buildAuditMsg(&msg, prev_hex, idx, ts, event, data_json);

    var hash: [32]u8 = undefined;
    HmacSha256.create(&hash, msg.items, &g_audit.chain_key);
    var hash_hex: [64]u8 = undefined;
    crmod.bytesToHex(&hash, &hash_hex);

    const entry = AuditEntry{
        .index = idx,
        .timestamp = ts,
        .event = try audit_alloc.dupe(u8, event),
        .data_json = try audit_alloc.dupe(u8, data_json),
        .hash_hex = hash_hex,
        .prev_hash_hex = prev_hex,
    };
    try g_audit.entries.append(audit_alloc, entry);
    return entry;
}

pub const AuditVerifyResult = struct { valid: bool, entries: u32, broken_at: i32 };

pub fn auditVerify() AuditVerifyResult {
    const n: u32 = @intCast(g_audit.entries.items.len);
    if (n == 0) return .{ .valid = true, .entries = 0, .broken_at = -1 };
    for (g_audit.entries.items, 0..) |e, i| {
        var expected: [64]u8 = ZERO_HASH;
        if (i > 0) expected = g_audit.entries.items[i - 1].hash_hex;
        if (!std.mem.eql(u8, &e.prev_hash_hex, &expected)) {
            return .{ .valid = false, .entries = n, .broken_at = @intCast(i) };
        }
        var msg: std.ArrayList(u8) = .{};
        defer msg.deinit(audit_alloc);
        buildAuditMsg(&msg, e.prev_hash_hex, e.index, e.timestamp, e.event, e.data_json) catch
            return .{ .valid = false, .entries = n, .broken_at = @intCast(i) };
        var hash: [32]u8 = undefined;
        HmacSha256.create(&hash, msg.items, &g_audit.chain_key);
        var hash_hex: [64]u8 = undefined;
        crmod.bytesToHex(&hash, &hash_hex);
        if (!std.mem.eql(u8, &hash_hex, &e.hash_hex)) {
            return .{ .valid = false, .entries = n, .broken_at = @intCast(i) };
        }
    }
    return .{ .valid = true, .entries = n, .broken_at = -1 };
}

pub fn auditEntriesJson(a: std.mem.Allocator, from: u32, to_inclusive: u32) ![]u8 {
    var buf: std.ArrayList(u8) = .{};
    defer buf.deinit(a);
    try buf.append(a, '[');
    const total: u32 = @intCast(g_audit.entries.items.len);
    const lo = @min(from, total);
    const hi = @min(to_inclusive + 1, total);
    var i: u32 = lo;
    var first = true;
    while (i < hi) : (i += 1) {
        const e = g_audit.entries.items[i];
        if (!first) try buf.append(a, ',');
        first = false;
        try std.fmt.format(buf.writer(a),
            "{{\"index\":{d},\"timestamp\":{d},\"event\":", .{ e.index, e.timestamp });
        try jsonQuoteString(a, &buf, e.event);
        try buf.appendSlice(a, ",\"data\":");
        try buf.appendSlice(a, e.data_json);
        try buf.appendSlice(a, ",\"hash\":\"");
        try buf.appendSlice(a, &e.hash_hex);
        try buf.appendSlice(a, "\",\"prevHash\":\"");
        try buf.appendSlice(a, &e.prev_hash_hex);
        try buf.appendSlice(a, "\"}");
    }
    try buf.append(a, ']');
    return buf.toOwnedSlice(a);
}

// ════════════════════════════════════════════════════════════════════════
// Policy / Consent / Right-to-Erasure (in-memory)
// ════════════════════════════════════════════════════════════════════════

pub const ConsentRecord = struct {
    user_id: []u8,
    purpose: []u8,
    granted: bool,
    timestamp: i64,
};

pub const RetentionPolicy = struct {
    category: []u8,
    json: []u8,
};

const PolicyState = struct {
    consents: std.ArrayList(ConsentRecord) = .{},
    retentions: std.ArrayList(RetentionPolicy) = .{},
};

var g_policy: PolicyState = .{};
const policy_alloc = std.heap.c_allocator;

pub fn policySetRetention(category: []const u8, json: []const u8) !void {
    for (g_policy.retentions.items) |*r| {
        if (std.mem.eql(u8, r.category, category)) {
            policy_alloc.free(r.json);
            r.json = try policy_alloc.dupe(u8, json);
            return;
        }
    }
    try g_policy.retentions.append(policy_alloc, .{
        .category = try policy_alloc.dupe(u8, category),
        .json = try policy_alloc.dupe(u8, json),
    });
}

pub fn policyRecordConsent(user_id: []const u8, purpose: []const u8, granted: bool) !void {
    try g_policy.consents.append(policy_alloc, .{
        .user_id = try policy_alloc.dupe(u8, user_id),
        .purpose = try policy_alloc.dupe(u8, purpose),
        .granted = granted,
        .timestamp = std.time.milliTimestamp(),
    });
}

pub fn policyCheckConsent(user_id: []const u8, purpose: []const u8) bool {
    var i: usize = g_policy.consents.items.len;
    while (i > 0) {
        i -= 1;
        const r = g_policy.consents.items[i];
        if (std.mem.eql(u8, r.user_id, user_id) and std.mem.eql(u8, r.purpose, purpose)) {
            return r.granted;
        }
    }
    return false;
}

pub fn policyRevokeConsent(user_id: []const u8, purpose: ?[]const u8) !void {
    const now = std.time.milliTimestamp();
    if (purpose) |p| {
        try g_policy.consents.append(policy_alloc, .{
            .user_id = try policy_alloc.dupe(u8, user_id),
            .purpose = try policy_alloc.dupe(u8, p),
            .granted = false,
            .timestamp = now,
        });
        return;
    }
    // Revoke all unique purposes for user
    var seen: std.StringHashMap(void) = .init(policy_alloc);
    defer seen.deinit();
    for (g_policy.consents.items) |r| {
        if (std.mem.eql(u8, r.user_id, user_id)) {
            _ = try seen.getOrPut(r.purpose);
        }
    }
    var it = seen.keyIterator();
    while (it.next()) |k| {
        try g_policy.consents.append(policy_alloc, .{
            .user_id = try policy_alloc.dupe(u8, user_id),
            .purpose = try policy_alloc.dupe(u8, k.*),
            .granted = false,
            .timestamp = now,
        });
    }
}

pub const ErasureReport = struct { records_found: u32, records_deleted: u32 };

pub fn policyRightToErasure(user_id: []const u8) ErasureReport {
    var found: u32 = 0;
    var i: usize = g_policy.consents.items.len;
    while (i > 0) {
        i -= 1;
        const r = g_policy.consents.items[i];
        if (std.mem.eql(u8, r.user_id, user_id)) {
            found += 1;
            policy_alloc.free(r.user_id);
            policy_alloc.free(r.purpose);
            _ = g_policy.consents.orderedRemove(i);
        }
    }
    return .{ .records_found = found, .records_deleted = found };
}

// ════════════════════════════════════════════════════════════════════════
// Algorithm Strength + Config Validator
// ════════════════════════════════════════════════════════════════════════

pub const Strength = enum { strong, acceptable, weak, broken };

pub const StrengthInfo = struct {
    strength: Strength,
    deprecated: bool,
    /// Static recommendation string (may be empty).
    recommendation: []const u8,
};

pub fn checkAlgorithmStrength(algorithm: []const u8) StrengthInfo {
    var lower_buf: [64]u8 = undefined;
    const n = @min(algorithm.len, lower_buf.len);
    for (algorithm[0..n], 0..) |c, i| {
        lower_buf[i] = std.ascii.toLower(c);
    }
    const lower = lower_buf[0..n];

    const broken = [_][]const u8{ "md4", "des-ecb", "rc2", "none" };
    const weak = [_][]const u8{ "sha1", "md5", "des", "rc4", "3des", "rsa-1024" };
    const acceptable = [_][]const u8{ "aes-128-gcm", "sha384", "scrypt", "pbkdf2", "blake2s" };
    const strong = [_][]const u8{
        "xchacha20-poly1305", "chacha20-poly1305", "aes-256-gcm",
        "ed25519", "x25519", "sha256", "sha512", "blake2b", "blake3", "argon2id",
    };

    for (broken) |b| if (std.mem.eql(u8, lower, b))
        return .{ .strength = .broken, .deprecated = true, .recommendation = "broken; use xchacha20-poly1305" };
    for (weak) |w| if (std.mem.eql(u8, lower, w))
        return .{ .strength = .weak, .deprecated = true, .recommendation = "weak; migrate to xchacha20-poly1305" };
    for (acceptable) |aok| if (std.mem.eql(u8, lower, aok))
        return .{ .strength = .acceptable, .deprecated = false, .recommendation = "" };
    for (strong) |s| if (std.mem.eql(u8, lower, s))
        return .{ .strength = .strong, .deprecated = false, .recommendation = "" };
    return .{ .strength = .weak, .deprecated = false, .recommendation = "unknown algorithm; verify it meets current standards" };
}

pub fn strengthString(s: Strength) []const u8 {
    return switch (s) {
        .strong => "strong",
        .acceptable => "acceptable",
        .weak => "weak",
        .broken => "broken",
    };
}

// ════════════════════════════════════════════════════════════════════════
// Filename / timestamp helpers
// ════════════════════════════════════════════════════════════════════════

/// Strip "../", "./", null bytes, and other control chars; trim ASCII space.
/// Writes into `out` (must be at least `name.len`); returns the slice written.
pub fn sanitizeFilename(name: []const u8, out: []u8) []u8 {
    var w: usize = 0;
    var i: usize = 0;
    while (i < name.len) {
        if (i + 2 < name.len and name[i] == '.' and name[i + 1] == '.' and name[i + 2] == '/') {
            i += 3;
            continue;
        }
        if (i + 1 < name.len and name[i] == '.' and name[i + 1] == '/') {
            i += 2;
            continue;
        }
        const c = name[i];
        if (c == 0 or c < 0x20 or c == 0x7F) {
            i += 1;
            continue;
        }
        out[w] = c;
        w += 1;
        i += 1;
    }
    var lo: usize = 0;
    while (lo < w and out[lo] == ' ') lo += 1;
    var hi: usize = w;
    while (hi > lo and out[hi - 1] == ' ') hi -= 1;
    if (lo > 0) std.mem.copyForwards(u8, out[0 .. hi - lo], out[lo..hi]);
    return out[0 .. hi - lo];
}

/// Strip fractional seconds from an ISO-8601 timestamp ("...123Z" → "...Z").
/// Writes into `out`; returns the slice written.
pub fn normalizeTimestamp(ts: []const u8, out: []u8) []u8 {
    if (ts.len == 0) return out[0..0];
    if (ts[ts.len - 1] != 'Z') {
        @memcpy(out[0..ts.len], ts);
        return out[0..ts.len];
    }
    // Walk back from before the Z, skip digits, then if we hit '.', drop it.
    var dot: ?usize = null;
    const i: usize = ts.len - 1; // 'Z'
    if (i == 0) {
        out[0] = 'Z';
        return out[0..1];
    }
    var j: usize = i - 1;
    while (true) : (j -%= 1) {
        const c = ts[j];
        if (c >= '0' and c <= '9') {
            if (j == 0) break;
            continue;
        }
        if (c == '.') dot = j;
        break;
    }
    if (dot) |d| {
        @memcpy(out[0..d], ts[0..d]);
        out[d] = 'Z';
        return out[0 .. d + 1];
    }
    @memcpy(out[0..ts.len], ts);
    return out[0..ts.len];
}

// ════════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════════

test "secure buffer alloc, read, free" {
    const alloc = std.testing.allocator;
    var buf = try SecureBuffer.init(alloc, "deadbeefcafebabe");
    defer buf.deinit(alloc);

    try std.testing.expectEqual(@as(usize, 8), buf.size);

    var hex: [16]u8 = undefined;
    buf.readHex(&hex);
    try std.testing.expectEqualStrings("deadbeefcafebabe", &hex);
}

test "secure buffer access modes (software-managed)" {
    const alloc = std.testing.allocator;
    var buf = try SecureBuffer.init(alloc, "0011223344556677");
    defer buf.deinit(alloc);

    buf.setAccess(.noaccess);
    try std.testing.expectEqual(SecureBuffer.AccessMode.noaccess, buf.access);

    // Read-through still works (software-managed, matching Lua impl)
    var hex: [16]u8 = undefined;
    buf.readHex(&hex);
    try std.testing.expectEqualStrings("0011223344556677", &hex);

    buf.setAccess(.readwrite);
    buf.readHex(&hex);
    try std.testing.expectEqualStrings("0011223344556677", &hex);
}

test "SHA-256 hash known vector" {
    const input = "abc";
    const digest = sha256Hash(input);
    var hex: [64]u8 = undefined;
    crmod.bytesToHex(&digest, &hex);
    try std.testing.expectEqualStrings(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        &hex,
    );
}

test "whitespace steg embed and extract round trip" {
    const carrier = "ABCD";
    const secret = "Hi"; // 0x48 0x69

    var encoded: [1024]u8 = undefined;
    const enc_len = stegEmbedWhitespace(carrier, secret, &encoded);

    // Verify visible text is preserved (strip ZW chars)
    var visible: [64]u8 = undefined;
    var vi: usize = 0;
    var i: usize = 0;
    while (i < enc_len) {
        if (i + 2 < enc_len and encoded[i] == 0xE2 and encoded[i + 1] == 0x80 and
            (encoded[i + 2] == 0x8B or encoded[i + 2] == 0x8C))
        {
            i += 3;
            continue;
        }
        visible[vi] = encoded[i];
        vi += 1;
        i += 1;
    }
    try std.testing.expectEqualStrings("ABCD", visible[0..vi]);

    // Extract and verify
    var extracted: [64]u8 = undefined;
    const ext_len = stegExtractWhitespace(encoded[0..enc_len], &extracted);
    try std.testing.expectEqual(@as(usize, 2), ext_len);
    try std.testing.expectEqualStrings("Hi", extracted[0..ext_len]);
}

test "whitespace steg single-char carrier unchanged" {
    var out: [64]u8 = undefined;
    const len = stegEmbedWhitespace("A", "secret", &out);
    try std.testing.expectEqualStrings("A", out[0..len]);
}

test "Noise-NK handshake and bidirectional messaging" {
    // Generate responder's static key pair
    const responder_kp = X25519.KeyPair.generate();

    // Initiator starts handshake
    const init_result = try noiseInitiate(responder_kp.public_key);
    var init_session = init_result.session;
    defer init_session.close();

    // Responder completes handshake
    var resp_session = try noiseRespond(responder_kp.secret_key, init_result.handshake);
    defer resp_session.close();

    // Initiator sends "ping"
    var msg1: [256]u8 = undefined;
    const msg1_len = try init_session.send("ping", &msg1);

    // Responder decrypts
    var pt1: [256]u8 = undefined;
    const pt1_len = try resp_session.receive(msg1[0..msg1_len], &pt1);
    try std.testing.expectEqualStrings("ping", pt1[0..pt1_len]);

    // Responder sends "pong"
    var msg2: [256]u8 = undefined;
    const msg2_len = try resp_session.send("pong", &msg2);

    // Initiator decrypts
    var pt2: [256]u8 = undefined;
    const pt2_len = try init_session.receive(msg2[0..msg2_len], &pt2);
    try std.testing.expectEqualStrings("pong", pt2[0..pt2_len]);
}

test "Noise-NK wrong responder key fails" {
    const good_kp = X25519.KeyPair.generate();
    const bad_kp = X25519.KeyPair.generate();

    const init_result = try noiseInitiate(good_kp.public_key);
    var init_session = init_result.session;
    defer init_session.close();

    // Bad responder tries to use wrong key
    var bad_session = try noiseRespond(bad_kp.secret_key, init_result.handshake);
    defer bad_session.close();

    var msg: [256]u8 = undefined;
    const msg_len = try init_session.send("top-secret", &msg);

    var pt: [256]u8 = undefined;
    const result = bad_session.receive(msg[0..msg_len], &pt);
    try std.testing.expectError(error.DecryptionFailed, result);
}

test "Noise-NK session close invalidates send" {
    const kp = X25519.KeyPair.generate();
    const init_result = try noiseInitiate(kp.public_key);
    var session = init_result.session;
    session.close();

    var msg: [256]u8 = undefined;
    const result = session.send("after-close", &msg);
    try std.testing.expectError(error.SessionClosed, result);
}

test "Noise-NK different sessions produce different ciphertext" {
    const kp = X25519.KeyPair.generate();

    const r1 = try noiseInitiate(kp.public_key);
    var s1 = r1.session;
    defer s1.close();

    const r2 = try noiseInitiate(kp.public_key);
    var s2 = r2.session;
    defer s2.close();

    var msg1: [256]u8 = undefined;
    var msg2: [256]u8 = undefined;
    const len1 = try s1.send("same plaintext", &msg1);
    const len2 = try s2.send("same plaintext", &msg2);

    // Different ephemeral keys → different shared secrets → different ciphertext
    try std.testing.expect(!std.mem.eql(u8, msg1[0..len1], msg2[0..len2]));
}

test "tokenize matches HMAC-SHA256 known vector" {
    const token = tokenize(
        "The quick brown fox jumps over the lazy dog",
        "key",
    );
    try std.testing.expectEqualStrings(
        "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
        &token,
    );
}

test "file encrypt/decrypt round trip" {
    const alloc = std.testing.allocator;
    const test_data = "Hello, encrypted world! This is a test of file encryption.";
    const key = [_]u8{0x42} ** 32;

    // Write test file
    {
        const f = try std.fs.cwd().createFile("/tmp/tsz-crypto-test-plain", .{});
        defer f.close();
        try f.writeAll(test_data);
    }
    defer std.fs.cwd().deleteFile("/tmp/tsz-crypto-test-plain") catch {};
    defer std.fs.cwd().deleteFile("/tmp/tsz-crypto-test-enc") catch {};
    defer std.fs.cwd().deleteFile("/tmp/tsz-crypto-test-dec") catch {};

    try encryptFile(alloc, "/tmp/tsz-crypto-test-plain", "/tmp/tsz-crypto-test-enc", &key);
    try decryptFile(alloc, "/tmp/tsz-crypto-test-enc", "/tmp/tsz-crypto-test-dec", &key);

    const recovered = try std.fs.cwd().readFileAlloc(alloc, "/tmp/tsz-crypto-test-dec", 1024);
    defer alloc.free(recovered);
    try std.testing.expectEqualStrings(test_data, recovered);
}

test "file decrypt rejects wrong key" {
    const alloc = std.testing.allocator;
    const key_a = [_]u8{0x42} ** 32;
    const key_b = [_]u8{0x99} ** 32;

    {
        const f = try std.fs.cwd().createFile("/tmp/tsz-crypto-test-wrongkey", .{});
        defer f.close();
        try f.writeAll("secret data");
    }
    defer std.fs.cwd().deleteFile("/tmp/tsz-crypto-test-wrongkey") catch {};
    defer std.fs.cwd().deleteFile("/tmp/tsz-crypto-test-wrongkey-enc") catch {};

    try encryptFile(alloc, "/tmp/tsz-crypto-test-wrongkey", "/tmp/tsz-crypto-test-wrongkey-enc", &key_a);

    const result = decryptFile(alloc, "/tmp/tsz-crypto-test-wrongkey-enc", "/tmp/tsz-crypto-test-wrongkey-dec", &key_b);
    try std.testing.expectError(error.DecryptionFailed, result);
}
