//! keyring.zig — encrypted on-disk keyring, mirroring privacy.lua's keyringX
//! API surface and double-encryption scheme:
//!
//!   - File master encryption: Argon2id(password) → KEK → XChaCha20-Poly1305
//!     wraps the JSON entry list.
//!   - Per-entry private-key encryption: each Ed25519/X25519 secret key is
//!     additionally wrapped under the same password (independent salt+nonce).
//!     This keeps the secret keys protected even if the file is decrypted
//!     into memory.
//!
//! On-disk layout (binary):
//!
//!   "KRG1" (4)              — magic
//!   version u8 (1)          — currently 1
//!   file_salt (16)          — Argon2id input
//!   file_nonce (24)         — XChaCha20 input
//!   file_ciphertext+tag (N) — JSON of the entry list
//!
//! Inside the JSON each entry has a base64 `encryptedPrivateKey` value
//! whose decoded layout is `salt(16) || nonce(24) || ciphertext+tag`.

const std = @import("std");
const sodium = @import("sodium.zig");

const file_magic = "KRG1".*;
const file_version: u8 = 1;
const argon2_opslimit: u64 = 3;
const argon2_memlimit: usize = 64 * 1024 * 1024;

pub const KeyType = enum { ed25519, x25519 };

pub const KeyEntry = struct {
    id: [16]u8,
    key_type: KeyType,
    label: ?[]const u8 = null, // owned
    public_key: [32]u8,
    encrypted_private: []u8, // owned: salt(16)||nonce(24)||ct+tag
    created: i64,
    expires: ?i64 = null,
    revoked: ?i64 = null,
    revoke_reason: ?[]const u8 = null, // owned
    rotated_to: ?[16]u8 = null,

    pub fn deinit(self: *KeyEntry, alloc: std.mem.Allocator) void {
        if (self.label) |l| alloc.free(l);
        if (self.revoke_reason) |r| alloc.free(r);
        // Zero secret material before freeing.
        std.crypto.secureZero(u8, self.encrypted_private);
        alloc.free(self.encrypted_private);
    }
};

pub const Keyring = struct {
    path: []u8, // owned
    master_password: []u8, // owned, lifetime-coupled
    entries: std.ArrayList(KeyEntry),
    alloc: std.mem.Allocator,

    pub fn deinit(self: *Keyring) void {
        for (self.entries.items) |*e| e.deinit(self.alloc);
        self.entries.deinit(self.alloc);
        std.crypto.secureZero(u8, self.master_password);
        self.alloc.free(self.master_password);
        self.alloc.free(self.path);
    }
};

// ════════════════════════════════════════════════════════════════════════
// Internal: derive KEK + encrypt/decrypt blobs
// ════════════════════════════════════════════════════════════════════════

fn deriveKek(password: []const u8, salt: *const [16]u8, kek: *[32]u8) !void {
    if (!sodium.ready()) _ = sodium.init();
    try sodium.pwhashArgon2id(kek, password, salt, .{
        .opslimit = argon2_opslimit,
        .memlimit = argon2_memlimit,
    });
}

/// Wrap arbitrary bytes with a fresh salt + nonce. Output:
///   salt(16) || nonce(24) || ciphertext+tag
fn wrap(alloc: std.mem.Allocator, password: []const u8, plaintext: []const u8) ![]u8 {
    var salt: [16]u8 = undefined;
    sodium.randomBytes(&salt);
    var nonce: [24]u8 = undefined;
    sodium.randomBytes(&nonce);

    var kek: [32]u8 = undefined;
    try deriveKek(password, &salt, &kek);
    defer std.crypto.secureZero(u8, &kek);

    const total = 16 + 24 + plaintext.len + 16;
    var out = try alloc.alloc(u8, total);
    errdefer alloc.free(out);

    @memcpy(out[0..16], &salt);
    @memcpy(out[16..40], &nonce);
    _ = try sodium.xchachaEncrypt(out[40..], plaintext, "", &nonce, &kek);
    return out;
}

fn unwrap(alloc: std.mem.Allocator, password: []const u8, blob: []const u8) ![]u8 {
    if (blob.len < 16 + 24 + 16) return error.InvalidBlob;
    const salt: *const [16]u8 = blob[0..16];
    const nonce: *const [24]u8 = blob[16..40];
    const ct = blob[40..];

    var kek: [32]u8 = undefined;
    try deriveKek(password, salt, &kek);
    defer std.crypto.secureZero(u8, &kek);

    const out = try alloc.alloc(u8, ct.len - 16);
    errdefer alloc.free(out);
    _ = sodium.xchachaDecrypt(out, ct, "", nonce, &kek) catch return error.WrongPassword;
    return out;
}

// ════════════════════════════════════════════════════════════════════════
// File serialization
// ════════════════════════════════════════════════════════════════════════

fn writeKeyringFile(path: []const u8, password: []const u8, json_blob: []const u8, alloc: std.mem.Allocator) !void {
    var file_salt: [16]u8 = undefined;
    sodium.randomBytes(&file_salt);
    var file_nonce: [24]u8 = undefined;
    sodium.randomBytes(&file_nonce);

    var kek: [32]u8 = undefined;
    try deriveKek(password, &file_salt, &kek);
    defer std.crypto.secureZero(u8, &kek);

    const ct = try alloc.alloc(u8, json_blob.len + 16);
    defer alloc.free(ct);
    _ = try sodium.xchachaEncrypt(ct, json_blob, "", &file_nonce, &kek);

    const f = try std.fs.cwd().createFile(path, .{ .truncate = true });
    defer f.close();
    try f.writeAll(&file_magic);
    try f.writeAll(&[_]u8{file_version});
    try f.writeAll(&file_salt);
    try f.writeAll(&file_nonce);
    try f.writeAll(ct);
}

fn readKeyringFile(alloc: std.mem.Allocator, path: []const u8, password: []const u8) ![]u8 {
    const raw = try std.fs.cwd().readFileAlloc(alloc, path, 16 * 1024 * 1024);
    defer alloc.free(raw);
    if (raw.len < 4 + 1 + 16 + 24 + 16) return error.InvalidKeyring;
    if (!std.mem.eql(u8, raw[0..4], &file_magic)) return error.InvalidKeyring;
    if (raw[4] != file_version) return error.UnsupportedVersion;

    const file_salt: *const [16]u8 = raw[5..21];
    const file_nonce: *const [24]u8 = raw[21..45];
    const ct = raw[45..];

    var kek: [32]u8 = undefined;
    try deriveKek(password, file_salt, &kek);
    defer std.crypto.secureZero(u8, &kek);

    const pt = try alloc.alloc(u8, ct.len - 16);
    errdefer alloc.free(pt);
    _ = sodium.xchachaDecrypt(pt, ct, "", file_nonce, &kek) catch return error.WrongPassword;
    return pt;
}

// ════════════════════════════════════════════════════════════════════════
// JSON for the in-memory entry list
// (hand-rolled — minimal, predictable, no external dep)
// ════════════════════════════════════════════════════════════════════════

fn jsonAppendString(alloc: std.mem.Allocator, out: *std.ArrayList(u8), s: []const u8) !void {
    try out.append(alloc, '"');
    for (s) |b| switch (b) {
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
    };
    try out.append(alloc, '"');
}

fn jsonAppendBytesAsHex(alloc: std.mem.Allocator, out: *std.ArrayList(u8), bytes: []const u8) !void {
    try out.append(alloc, '"');
    const chars = "0123456789abcdef";
    for (bytes) |b| {
        try out.append(alloc, chars[b >> 4]);
        try out.append(alloc, chars[b & 0xF]);
    }
    try out.append(alloc, '"');
}

fn jsonAppendBase64(alloc: std.mem.Allocator, out: *std.ArrayList(u8), bytes: []const u8) !void {
    const enc = std.base64.standard.Encoder;
    const sz = enc.calcSize(bytes.len);
    const buf = try alloc.alloc(u8, sz);
    defer alloc.free(buf);
    _ = enc.encode(buf, bytes);
    try out.append(alloc, '"');
    try out.appendSlice(alloc, buf);
    try out.append(alloc, '"');
}

fn serializeEntries(alloc: std.mem.Allocator, entries: []const KeyEntry) ![]u8 {
    var buf: std.ArrayList(u8) = .{};
    errdefer buf.deinit(alloc);
    try buf.appendSlice(alloc, "{\"version\":1,\"keys\":[");
    for (entries, 0..) |e, i| {
        if (i > 0) try buf.append(alloc, ',');
        try buf.append(alloc, '{');
        try buf.appendSlice(alloc, "\"id\":");
        try jsonAppendBytesAsHex(alloc, &buf, &e.id);
        try buf.appendSlice(alloc, ",\"type\":\"");
        try buf.appendSlice(alloc, switch (e.key_type) {
            .ed25519 => "ed25519",
            .x25519 => "x25519",
        });
        try buf.append(alloc, '"');
        if (e.label) |l| {
            try buf.appendSlice(alloc, ",\"label\":");
            try jsonAppendString(alloc, &buf, l);
        }
        try buf.appendSlice(alloc, ",\"publicKey\":");
        try jsonAppendBytesAsHex(alloc, &buf, &e.public_key);
        try buf.appendSlice(alloc, ",\"encryptedPrivateKey\":");
        try jsonAppendBase64(alloc, &buf, e.encrypted_private);
        try std.fmt.format(buf.writer(alloc), ",\"created\":{d}", .{e.created});
        if (e.expires) |exp| try std.fmt.format(buf.writer(alloc), ",\"expires\":{d}", .{exp});
        if (e.revoked) |r| try std.fmt.format(buf.writer(alloc), ",\"revoked\":{d}", .{r});
        if (e.revoke_reason) |r| {
            try buf.appendSlice(alloc, ",\"revokeReason\":");
            try jsonAppendString(alloc, &buf, r);
        }
        if (e.rotated_to) |rt| {
            try buf.appendSlice(alloc, ",\"rotatedTo\":");
            try jsonAppendBytesAsHex(alloc, &buf, &rt);
        }
        try buf.append(alloc, '}');
    }
    try buf.appendSlice(alloc, "]}");
    return try buf.toOwnedSlice(alloc);
}

fn parseEntries(alloc: std.mem.Allocator, json_blob: []const u8) !std.ArrayList(KeyEntry) {
    // Parse with std.json — we only need a simple object → array → object walk.
    var parsed = try std.json.parseFromSlice(std.json.Value, alloc, json_blob, .{});
    defer parsed.deinit();

    const root = parsed.value;
    if (root != .object) return error.InvalidJson;
    const keys_v = root.object.get("keys") orelse return error.InvalidJson;
    if (keys_v != .array) return error.InvalidJson;

    var out: std.ArrayList(KeyEntry) = .{};
    errdefer {
        for (out.items) |*e| e.deinit(alloc);
        out.deinit(alloc);
    }

    for (keys_v.array.items) |item| {
        if (item != .object) return error.InvalidJson;
        const obj = item.object;

        const id_hex = (obj.get("id") orelse return error.InvalidJson).string;
        const type_str = (obj.get("type") orelse return error.InvalidJson).string;
        const pub_hex = (obj.get("publicKey") orelse return error.InvalidJson).string;
        const enc_b64 = (obj.get("encryptedPrivateKey") orelse return error.InvalidJson).string;
        const created = (obj.get("created") orelse return error.InvalidJson).integer;

        var entry: KeyEntry = .{
            .id = undefined,
            .key_type = if (std.mem.eql(u8, type_str, "ed25519")) .ed25519 else .x25519,
            .public_key = undefined,
            .encrypted_private = &.{},
            .created = created,
        };
        try hexDecodeFixed(id_hex, &entry.id);
        try hexDecodeFixed(pub_hex, &entry.public_key);

        const dec = std.base64.standard.Decoder;
        const dec_size = try dec.calcSizeForSlice(enc_b64);
        const enc_bytes = try alloc.alloc(u8, dec_size);
        errdefer alloc.free(enc_bytes);
        try dec.decode(enc_bytes, enc_b64);
        entry.encrypted_private = enc_bytes;

        if (obj.get("label")) |l| if (l == .string) {
            entry.label = try alloc.dupe(u8, l.string);
        };
        if (obj.get("expires")) |e| if (e == .integer) {
            entry.expires = e.integer;
        };
        if (obj.get("revoked")) |r| if (r == .integer) {
            entry.revoked = r.integer;
        };
        if (obj.get("revokeReason")) |r| if (r == .string) {
            entry.revoke_reason = try alloc.dupe(u8, r.string);
        };
        if (obj.get("rotatedTo")) |rt| if (rt == .string) {
            var id: [16]u8 = undefined;
            try hexDecodeFixed(rt.string, &id);
            entry.rotated_to = id;
        };

        try out.append(alloc, entry);
    }
    return out;
}

fn hexDecodeFixed(hex: []const u8, out: []u8) !void {
    if (hex.len != out.len * 2) return error.InvalidHexLength;
    for (out, 0..) |*b, i| {
        b.* = (try hexDigit(hex[2 * i])) << 4 | (try hexDigit(hex[2 * i + 1]));
    }
}

fn hexDigit(c: u8) !u8 {
    return switch (c) {
        '0'...'9' => c - '0',
        'a'...'f' => c - 'a' + 10,
        'A'...'F' => c - 'A' + 10,
        else => error.InvalidHexChar,
    };
}

// ════════════════════════════════════════════════════════════════════════
// Public API (mirrors privacy.lua's keyring* functions)
// ════════════════════════════════════════════════════════════════════════

pub fn create(alloc: std.mem.Allocator, path: []const u8, master_password: []const u8) !Keyring {
    if (!sodium.ready()) _ = sodium.init();

    var ring: Keyring = .{
        .path = try alloc.dupe(u8, path),
        .master_password = try alloc.dupe(u8, master_password),
        .entries = .{},
        .alloc = alloc,
    };
    errdefer ring.deinit();

    const json = try serializeEntries(alloc, ring.entries.items);
    defer alloc.free(json);
    try writeKeyringFile(path, master_password, json, alloc);

    return ring;
}

pub fn open(alloc: std.mem.Allocator, path: []const u8, master_password: []const u8) !Keyring {
    if (!sodium.ready()) _ = sodium.init();
    const json_blob = try readKeyringFile(alloc, path, master_password);
    defer alloc.free(json_blob);

    const entries = try parseEntries(alloc, json_blob);

    return .{
        .path = try alloc.dupe(u8, path),
        .master_password = try alloc.dupe(u8, master_password),
        .entries = entries,
        .alloc = alloc,
    };
}

pub fn save(ring: *Keyring) !void {
    const json = try serializeEntries(ring.alloc, ring.entries.items);
    defer ring.alloc.free(json);
    try writeKeyringFile(ring.path, ring.master_password, json, ring.alloc);
}

pub const GenerateOpts = struct {
    key_type: KeyType = .ed25519,
    label: ?[]const u8 = null,
    expires_in: ?i64 = null, // seconds from now
};

pub fn generateKey(ring: *Keyring, opts: GenerateOpts) ![16]u8 {
    var entry: KeyEntry = .{
        .id = undefined,
        .key_type = opts.key_type,
        .label = if (opts.label) |l| try ring.alloc.dupe(u8, l) else null,
        .public_key = undefined,
        .encrypted_private = &.{},
        .created = std.time.timestamp(),
        .expires = if (opts.expires_in) |e| std.time.timestamp() + e else null,
    };
    sodium.randomBytes(&entry.id);

    switch (opts.key_type) {
        .ed25519 => {
            const kp = sodium.signKeypair();
            entry.public_key = kp.public;
            entry.encrypted_private = try wrap(ring.alloc, ring.master_password, &kp.secret);
        },
        .x25519 => {
            const kp = sodium.dhKeypair();
            entry.public_key = kp.public;
            entry.encrypted_private = try wrap(ring.alloc, ring.master_password, &kp.secret);
        },
    }

    try ring.entries.append(ring.alloc, entry);
    try save(ring);
    return entry.id;
}

pub fn listKeys(ring: *const Keyring) []const KeyEntry {
    return ring.entries.items;
}

pub fn getKey(ring: *const Keyring, id: [16]u8) ?*const KeyEntry {
    for (ring.entries.items) |*e| {
        if (std.mem.eql(u8, &e.id, &id)) return e;
    }
    return null;
}

pub fn rotateKey(ring: *Keyring, id: [16]u8) ![16]u8 {
    const old = getKey(ring, id) orelse return error.KeyNotFound;
    if (old.revoked != null) return error.AlreadyRevoked;

    const new_id = try generateKey(ring, .{
        .key_type = old.key_type,
        .label = old.label,
    });

    // Mark old as rotated.
    for (ring.entries.items) |*e| {
        if (std.mem.eql(u8, &e.id, &id)) {
            e.rotated_to = new_id;
            break;
        }
    }
    try save(ring);
    return new_id;
}

pub fn revokeKey(ring: *Keyring, id: [16]u8, reason: []const u8) !void {
    for (ring.entries.items) |*e| {
        if (std.mem.eql(u8, &e.id, &id)) {
            e.revoked = std.time.timestamp();
            if (e.revoke_reason) |r| ring.alloc.free(r);
            e.revoke_reason = try ring.alloc.dupe(u8, reason);
            try save(ring);
            return;
        }
    }
    return error.KeyNotFound;
}

pub fn exportPublic(ring: *const Keyring, id: [16]u8) ?[32]u8 {
    const e = getKey(ring, id) orelse return null;
    return e.public_key;
}

/// Decrypt and return the private key for use. Caller must zero+free.
pub fn unlockPrivate(ring: *const Keyring, id: [16]u8) ![]u8 {
    const e = getKey(ring, id) orelse return error.KeyNotFound;
    return try unwrap(ring.alloc, ring.master_password, e.encrypted_private);
}
