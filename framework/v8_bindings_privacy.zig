//! v8_bindings_privacy.zig — V8 FFI bridge for the privacy/crypto stack.
//!
//! Single JS-facing surface that ultimately drives runtime/hooks/usePrivacy.ts.
//! Convention:
//!
//!   - Bytes cross the bridge as base64 strings (matches runtime/hooks/crypto.ts).
//!   - Compound returns are JSON strings (the JS hook parses).
//!   - Backend selection (`std` | `sodium`) is a string arg where applicable.
//!   - Error handling: on failure the binding returns an empty string (or
//!     a JSON `{"ok":false,"error":"..."}` for compound calls). The JS hook
//!     translates that to an exception.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const privacy = @import("privacy/privacy.zig");
const sodium = @import("privacy/sodium.zig");
const keyring = @import("privacy/keyring.zig");
const crmod = @import("privacy/crypto.zig");

const alloc = std.heap.c_allocator;

// ════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════

const b64e = std.base64.standard.Encoder;
const b64d = std.base64.standard.Decoder;

fn argStr(info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (idx >= info.length()) return null;
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const s = info.getArg(idx).toString(ctx) catch return null;
    const n = s.lenUtf8(iso);
    const buf = alloc.alloc(u8, n) catch return null;
    _ = s.writeUtf8(iso, buf);
    return buf;
}

fn argI64(info: v8.FunctionCallbackInfo, idx: u32) ?i64 {
    if (idx >= info.length()) return null;
    const ctx = info.getIsolate().getCurrentContext();
    const f = info.getArg(idx).toF64(ctx) catch return null;
    return @intFromFloat(f);
}

fn argBool(info: v8.FunctionCallbackInfo, idx: u32) bool {
    if (idx >= info.length()) return false;
    return info.getArg(idx).toBool(info.getIsolate());
}

fn returnString(info: v8.FunctionCallbackInfo, s: []const u8) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(iso.initStringUtf8(s).toValue());
}

fn returnEmpty(info: v8.FunctionCallbackInfo) void {
    returnString(info, "");
}

fn returnBool(info: v8.FunctionCallbackInfo, b: bool) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(iso.initBoolean(b));
}

fn returnNumber(info: v8.FunctionCallbackInfo, n: f64) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(iso.initNumber(n).toValue());
}

fn listPrint(buf: *std.ArrayList(u8), comptime format: []const u8, args: anytype) !void {
    var writer: std.Io.Writer.Allocating = .fromArrayList(alloc, buf);
    defer buf.* = writer.toArrayList();
    try writer.writer.print(format, args);
}

fn b64Encode(bytes: []const u8) ![]u8 {
    const sz = b64e.calcSize(bytes.len);
    const out = try alloc.alloc(u8, sz);
    _ = b64e.encode(out, bytes);
    return out;
}

fn b64Decode(s: []const u8) ![]u8 {
    const sz = try b64d.calcSizeForSlice(s);
    const out = try alloc.alloc(u8, sz);
    try b64d.decode(out, s);
    return out;
}

fn parseBackend(s: []const u8) privacy.Backend {
    if (std.mem.eql(u8, s, "sodium")) return .sodium;
    return .std;
}

fn hexEncodeAlloc(bytes: []const u8) ![]u8 {
    const out = try alloc.alloc(u8, bytes.len * 2);
    crmod.bytesToHex(bytes, out);
    return out;
}

fn hexDecodeAlloc(hex: []const u8) ![]u8 {
    const out = try alloc.alloc(u8, hex.len / 2);
    _ = try crmod.hexToBytes(hex, out);
    return out;
}

// ════════════════════════════════════════════════════════════════════════
// Backend-selectable primitives
// ════════════════════════════════════════════════════════════════════════

fn privSha256(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const backend_s = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(backend_s);
    const data_b64 = argStr(info, 1) orelse return returnEmpty(info);
    defer alloc.free(data_b64);

    const data = b64Decode(data_b64) catch return returnEmpty(info);
    defer alloc.free(data);

    const digest = privacy.sha256With(parseBackend(backend_s), data);
    const enc = b64Encode(&digest) catch return returnEmpty(info);
    defer alloc.free(enc);
    returnString(info, enc);
}

fn privHmacSha256(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const backend_s = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(backend_s);
    const key_b64 = argStr(info, 1) orelse return returnEmpty(info);
    defer alloc.free(key_b64);
    const msg_b64 = argStr(info, 2) orelse return returnEmpty(info);
    defer alloc.free(msg_b64);

    const key = b64Decode(key_b64) catch return returnEmpty(info);
    defer alloc.free(key);
    const msg = b64Decode(msg_b64) catch return returnEmpty(info);
    defer alloc.free(msg);

    const mac = privacy.hmacSha256With(parseBackend(backend_s), key, msg);
    const enc = b64Encode(&mac) catch return returnEmpty(info);
    defer alloc.free(enc);
    returnString(info, enc);
}

fn privHkdfSha256(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const backend_s = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(backend_s);
    const ikm_b64 = argStr(info, 1) orelse return returnEmpty(info);
    defer alloc.free(ikm_b64);
    const salt_b64 = argStr(info, 2) orelse return returnEmpty(info);
    defer alloc.free(salt_b64);
    const info_b64 = argStr(info, 3) orelse return returnEmpty(info);
    defer alloc.free(info_b64);
    const length = argI64(info, 4) orelse return returnEmpty(info);
    if (length <= 0 or length > 8192) return returnEmpty(info);

    const ikm = b64Decode(ikm_b64) catch return returnEmpty(info);
    defer alloc.free(ikm);
    const salt = b64Decode(salt_b64) catch return returnEmpty(info);
    defer alloc.free(salt);
    const info_bytes = b64Decode(info_b64) catch return returnEmpty(info);
    defer alloc.free(info_bytes);

    const out = alloc.alloc(u8, @intCast(length)) catch return returnEmpty(info);
    defer alloc.free(out);
    privacy.hkdfSha256With(parseBackend(backend_s), ikm, salt, info_bytes, out) catch return returnEmpty(info);

    const enc = b64Encode(out) catch return returnEmpty(info);
    defer alloc.free(enc);
    returnString(info, enc);
}

fn privXchachaEncrypt(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const backend_s = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(backend_s);
    const pt_b64 = argStr(info, 1) orelse return returnEmpty(info);
    defer alloc.free(pt_b64);
    const key_b64 = argStr(info, 2) orelse return returnEmpty(info);
    defer alloc.free(key_b64);
    const nonce_b64 = argStr(info, 3) orelse return returnEmpty(info);
    defer alloc.free(nonce_b64);
    const aad_b64 = argStr(info, 4) orelse return returnEmpty(info);
    defer alloc.free(aad_b64);

    const pt = b64Decode(pt_b64) catch return returnEmpty(info);
    defer alloc.free(pt);
    const key = b64Decode(key_b64) catch return returnEmpty(info);
    defer alloc.free(key);
    const nonce = b64Decode(nonce_b64) catch return returnEmpty(info);
    defer alloc.free(nonce);
    const aad = b64Decode(aad_b64) catch return returnEmpty(info);
    defer alloc.free(aad);

    if (key.len != 32 or nonce.len != 24) return returnEmpty(info);
    const key_arr: *const [32]u8 = key[0..32];
    const nonce_arr: *const [24]u8 = nonce[0..24];

    const out = alloc.alloc(u8, pt.len + 16) catch return returnEmpty(info);
    defer alloc.free(out);
    const n = privacy.xchachaEncryptWith(parseBackend(backend_s), out, pt, aad, nonce_arr, key_arr) catch return returnEmpty(info);

    const enc = b64Encode(out[0..n]) catch return returnEmpty(info);
    defer alloc.free(enc);
    returnString(info, enc);
}

fn privXchachaDecrypt(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const backend_s = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(backend_s);
    const ct_b64 = argStr(info, 1) orelse return returnEmpty(info);
    defer alloc.free(ct_b64);
    const key_b64 = argStr(info, 2) orelse return returnEmpty(info);
    defer alloc.free(key_b64);
    const nonce_b64 = argStr(info, 3) orelse return returnEmpty(info);
    defer alloc.free(nonce_b64);
    const aad_b64 = argStr(info, 4) orelse return returnEmpty(info);
    defer alloc.free(aad_b64);

    const ct = b64Decode(ct_b64) catch return returnEmpty(info);
    defer alloc.free(ct);
    const key = b64Decode(key_b64) catch return returnEmpty(info);
    defer alloc.free(key);
    const nonce = b64Decode(nonce_b64) catch return returnEmpty(info);
    defer alloc.free(nonce);
    const aad = b64Decode(aad_b64) catch return returnEmpty(info);
    defer alloc.free(aad);

    if (key.len != 32 or nonce.len != 24 or ct.len < 16) return returnEmpty(info);
    const key_arr: *const [32]u8 = key[0..32];
    const nonce_arr: *const [24]u8 = nonce[0..24];

    const out = alloc.alloc(u8, ct.len - 16) catch return returnEmpty(info);
    defer alloc.free(out);
    const n = privacy.xchachaDecryptWith(parseBackend(backend_s), out, ct, aad, nonce_arr, key_arr) catch return returnEmpty(info);

    const enc = b64Encode(out[0..n]) catch return returnEmpty(info);
    defer alloc.free(enc);
    returnString(info, enc);
}

fn privRandomBytes(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const backend_s = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(backend_s);
    const n = argI64(info, 1) orelse return returnEmpty(info);
    if (n <= 0 or n > 1 << 20) return returnEmpty(info);

    const buf = alloc.alloc(u8, @intCast(n)) catch return returnEmpty(info);
    defer alloc.free(buf);
    privacy.randomBytesWith(parseBackend(backend_s), buf);

    const enc = b64Encode(buf) catch return returnEmpty(info);
    defer alloc.free(enc);
    returnString(info, enc);
}

// ════════════════════════════════════════════════════════════════════════
// Hash file / directory / manifest
// ════════════════════════════════════════════════════════════════════════

fn privHashFile(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const path = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(path);
    var hex: [64]u8 = undefined;
    privacy.hashFile(path, &hex) catch return returnEmpty(info);
    returnString(info, &hex);
}

fn privHashDirectory(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const path = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(path);
    const recursive = argBool(info, 1);

    var manifest = privacy.hashDirectory(alloc, path, recursive) catch return returnEmpty(info);
    defer manifest.deinit();
    const json = privacy.manifestToJson(alloc, &manifest) catch return returnEmpty(info);
    defer alloc.free(json);
    returnString(info, json);
}

fn privVerifyManifest(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const json_in = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(json_in);

    var parsed = std.json.parseFromSlice(std.json.Value, alloc, json_in, .{}) catch return returnEmpty(info);
    defer parsed.deinit();
    const root = parsed.value;
    if (root != .object) return returnEmpty(info);
    const entries_v = root.object.get("entries") orelse return returnEmpty(info);
    if (entries_v != .array) return returnEmpty(info);

    var manifest_entries: std.ArrayList(privacy.ManifestEntry) = .empty;
    defer {
        for (manifest_entries.items) |e| alloc.free(e.path);
        manifest_entries.deinit(alloc);
    }
    for (entries_v.array.items) |item| {
        if (item != .object) continue;
        const path_v = item.object.get("path") orelse continue;
        const hash_v = item.object.get("hash") orelse continue;
        if (path_v != .string or hash_v != .string) continue;
        if (hash_v.string.len != 64) continue;
        var hex: [64]u8 = undefined;
        @memcpy(&hex, hash_v.string);
        const owned = alloc.dupe(u8, path_v.string) catch continue;
        manifest_entries.append(alloc, .{ .path = owned, .hash_hex = hex }) catch {
            alloc.free(owned);
            continue;
        };
    }

    const manifest: privacy.Manifest = .{ .entries = manifest_entries, .alloc = alloc };
    var result = privacy.verifyManifest(alloc, &manifest) catch return returnEmpty(info);
    defer result.deinit();

    var buf: std.ArrayList(u8) = .empty;
    defer buf.deinit(alloc);
    buf.appendSlice(alloc, "{\"ok\":") catch return returnEmpty(info);
    buf.appendSlice(alloc, if (result.ok) "true" else "false") catch return returnEmpty(info);
    buf.appendSlice(alloc, ",\"missing\":[") catch return returnEmpty(info);
    for (result.missing, 0..) |m, i| {
        if (i > 0) buf.append(alloc, ',') catch return returnEmpty(info);
        buf.append(alloc, '"') catch return returnEmpty(info);
        buf.appendSlice(alloc, m) catch return returnEmpty(info);
        buf.append(alloc, '"') catch return returnEmpty(info);
    }
    buf.appendSlice(alloc, "],\"mismatched\":[") catch return returnEmpty(info);
    for (result.mismatched, 0..) |m, i| {
        if (i > 0) buf.append(alloc, ',') catch return returnEmpty(info);
        buf.append(alloc, '"') catch return returnEmpty(info);
        buf.appendSlice(alloc, m) catch return returnEmpty(info);
        buf.append(alloc, '"') catch return returnEmpty(info);
    }
    buf.appendSlice(alloc, "]}") catch return returnEmpty(info);
    returnString(info, buf.items);
}

// ════════════════════════════════════════════════════════════════════════
// Secure buffers (libsodium-only)
// ════════════════════════════════════════════════════════════════════════

const SecBufEntry = struct { id: u32, buf: privacy.SecureBuffer };
var g_secbufs: ?std.ArrayList(SecBufEntry) = null;
var g_secbuf_next_id: u32 = 1;

fn secbufRegistry() *std.ArrayList(SecBufEntry) {
    if (g_secbufs == null) g_secbufs = .empty;
    return &g_secbufs.?;
}

fn privSecbufAlloc(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const hex = argStr(info, 0) orelse return returnNumber(info, 0);
    defer alloc.free(hex);

    var buf = privacy.SecureBuffer.init(alloc, hex) catch return returnNumber(info, 0);
    const id = g_secbuf_next_id;
    g_secbuf_next_id += 1;
    secbufRegistry().append(alloc, .{ .id = id, .buf = buf }) catch {
        buf.deinit(alloc);
        return returnNumber(info, 0);
    };
    returnNumber(info, @floatFromInt(id));
}

fn privSecbufRead(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argI64(info, 0) orelse return returnEmpty(info);
    if (id <= 0) return returnEmpty(info);

    const reg = secbufRegistry();
    for (reg.items) |*e| {
        if (e.id == @as(u32, @intCast(id))) {
            const out = alloc.alloc(u8, e.buf.size * 2) catch return returnEmpty(info);
            defer alloc.free(out);
            e.buf.readHex(out);
            returnString(info, out);
            return;
        }
    }
    returnEmpty(info);
}

fn privSecbufFree(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argI64(info, 0) orelse return;
    if (id <= 0) return;

    const reg = secbufRegistry();
    var i: usize = 0;
    while (i < reg.items.len) : (i += 1) {
        if (reg.items[i].id == @as(u32, @intCast(id))) {
            reg.items[i].buf.deinit(alloc);
            _ = reg.orderedRemove(i);
            return;
        }
    }
}

fn privSecbufProtect(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argI64(info, 0) orelse return;
    const mode_s = argStr(info, 1) orelse return;
    defer alloc.free(mode_s);

    const mode: privacy.SecureBuffer.AccessMode = if (std.mem.eql(u8, mode_s, "readonly"))
        .readonly
    else if (std.mem.eql(u8, mode_s, "noaccess"))
        .noaccess
    else
        .readwrite;

    const reg = secbufRegistry();
    for (reg.items) |*e| {
        if (e.id == @as(u32, @intCast(id))) {
            e.buf.setAccess(mode);
            return;
        }
    }
}

// ════════════════════════════════════════════════════════════════════════
// File encrypt/decrypt + secure delete + steg
// ════════════════════════════════════════════════════════════════════════

fn privEncryptFile(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const in_path = argStr(info, 0) orelse return returnBool(info, false);
    defer alloc.free(in_path);
    const out_path = argStr(info, 1) orelse return returnBool(info, false);
    defer alloc.free(out_path);
    const key_b64 = argStr(info, 2) orelse return returnBool(info, false);
    defer alloc.free(key_b64);

    const key = b64Decode(key_b64) catch return returnBool(info, false);
    defer alloc.free(key);
    if (key.len != 32) return returnBool(info, false);
    const key_arr: *const [32]u8 = key[0..32];

    privacy.encryptFile(alloc, in_path, out_path, key_arr) catch return returnBool(info, false);
    returnBool(info, true);
}

fn privDecryptFile(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const in_path = argStr(info, 0) orelse return returnBool(info, false);
    defer alloc.free(in_path);
    const out_path = argStr(info, 1) orelse return returnBool(info, false);
    defer alloc.free(out_path);
    const key_b64 = argStr(info, 2) orelse return returnBool(info, false);
    defer alloc.free(key_b64);

    const key = b64Decode(key_b64) catch return returnBool(info, false);
    defer alloc.free(key);
    if (key.len != 32) return returnBool(info, false);
    const key_arr: *const [32]u8 = key[0..32];

    privacy.decryptFile(alloc, in_path, out_path, key_arr) catch return returnBool(info, false);
    returnBool(info, true);
}

fn privSecureDelete(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const path = argStr(info, 0) orelse return returnBool(info, false);
    defer alloc.free(path);
    const passes = argI64(info, 1) orelse 3;
    privacy.secureDelete(path, @intCast(@max(0, passes))) catch return returnBool(info, false);
    returnBool(info, true);
}

fn privStegEmbed(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const carrier = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(carrier);
    const secret_b64 = argStr(info, 1) orelse return returnEmpty(info);
    defer alloc.free(secret_b64);
    const secret = b64Decode(secret_b64) catch return returnEmpty(info);
    defer alloc.free(secret);

    const cap = carrier.len + secret.len * 8 * 3 + 16;
    const out = alloc.alloc(u8, cap) catch return returnEmpty(info);
    defer alloc.free(out);
    const n = privacy.stegEmbedWhitespace(carrier, secret, out);
    returnString(info, out[0..n]);
}

fn privStegExtract(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const encoded = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(encoded);
    const max_out = encoded.len / 8 / 3 + 32;
    const out = alloc.alloc(u8, max_out) catch return returnEmpty(info);
    defer alloc.free(out);
    const n = privacy.stegExtractWhitespace(encoded, out);
    const enc = b64Encode(out[0..n]) catch return returnEmpty(info);
    defer alloc.free(enc);
    returnString(info, enc);
}

fn privTokenize(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const value = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(value);
    const salt = argStr(info, 1) orelse return returnEmpty(info);
    defer alloc.free(salt);
    const hex = privacy.tokenize(value, salt);
    returnString(info, &hex);
}

// ════════════════════════════════════════════════════════════════════════
// GPG
// ════════════════════════════════════════════════════════════════════════

fn privGpgEncrypt(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const pt = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(pt);
    const recipient = argStr(info, 1) orelse return returnEmpty(info);
    defer alloc.free(recipient);
    const out = privacy.gpgEncrypt(alloc, pt, recipient) catch return returnEmpty(info);
    defer alloc.free(out);
    returnString(info, out);
}

fn privGpgDecrypt(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ct = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(ct);
    const out = privacy.gpgDecrypt(alloc, ct) catch return returnEmpty(info);
    defer alloc.free(out);
    returnString(info, out);
}

fn privGpgSign(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const msg = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(msg);
    const out = privacy.gpgSign(alloc, msg) catch return returnEmpty(info);
    defer alloc.free(out);
    returnString(info, out);
}

fn privGpgVerify(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const signed = argStr(info, 0) orelse return returnBool(info, false);
    defer alloc.free(signed);
    const ok = privacy.gpgVerify(alloc, signed) catch return returnBool(info, false);
    returnBool(info, ok);
}

fn privGpgListKeys(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const out = privacy.gpgListKeys(alloc) catch return returnEmpty(info);
    defer alloc.free(out);
    returnString(info, out);
}

fn privGpgImport(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const armored = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(armored);
    const out = privacy.gpgImportKey(alloc, armored) catch return returnEmpty(info);
    defer alloc.free(out);
    returnString(info, out);
}

fn privGpgExport(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(id);
    const out = privacy.gpgExportKey(alloc, id) catch return returnEmpty(info);
    defer alloc.free(out);
    returnString(info, out);
}

// ════════════════════════════════════════════════════════════════════════
// Metadata
// ════════════════════════════════════════════════════════════════════════

fn privMetaStrip(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const path = argStr(info, 0) orelse return returnBool(info, false);
    defer alloc.free(path);
    privacy.metaStrip(alloc, path) catch return returnBool(info, false);
    returnBool(info, true);
}

fn privMetaRead(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const path = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(path);
    const out = privacy.metaRead(alloc, path) catch return returnEmpty(info);
    defer alloc.free(out);
    returnString(info, out);
}

// ════════════════════════════════════════════════════════════════════════
// Identity
// ════════════════════════════════════════════════════════════════════════

fn privAnonymousId(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const backend_s = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(backend_s);
    const domain = argStr(info, 1) orelse return returnEmpty(info);
    defer alloc.free(domain);
    const seed_b64 = argStr(info, 2) orelse return returnEmpty(info);
    defer alloc.free(seed_b64);

    const seed = b64Decode(seed_b64) catch return returnEmpty(info);
    defer alloc.free(seed);

    const out = privacy.anonymousId(parseBackend(backend_s), domain, seed);
    const enc = b64Encode(&out) catch return returnEmpty(info);
    defer alloc.free(enc);
    returnString(info, enc);
}

fn privPseudonym(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const backend_s = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(backend_s);
    const master_b64 = argStr(info, 1) orelse return returnEmpty(info);
    defer alloc.free(master_b64);
    const context = argStr(info, 2) orelse return returnEmpty(info);
    defer alloc.free(context);

    const master = b64Decode(master_b64) catch return returnEmpty(info);
    defer alloc.free(master);
    var out: [32]u8 = undefined;
    privacy.pseudonym(parseBackend(backend_s), master, context, &out) catch return returnEmpty(info);

    const enc = b64Encode(&out) catch return returnEmpty(info);
    defer alloc.free(enc);
    returnString(info, enc);
}

fn privIsolatedCredential(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const domain = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(domain);

    var cred = privacy.isolatedCredential(alloc, domain) catch return returnEmpty(info);
    defer cred.deinit(alloc);

    const pub_b64 = b64Encode(&cred.public_key) catch return returnEmpty(info);
    defer alloc.free(pub_b64);
    const sec_b64 = b64Encode(&cred.secret_key) catch return returnEmpty(info);
    defer alloc.free(sec_b64);
    const id_hex = hexEncodeAlloc(&cred.key_id) catch return returnEmpty(info);
    defer alloc.free(id_hex);

    const json = std.fmt.allocPrint(alloc,
        \\{{"domain":"{s}","publicKey":"{s}","secretKey":"{s}","keyId":"{s}"}}
    , .{ cred.domain, pub_b64, sec_b64, id_hex }) catch return returnEmpty(info);
    defer alloc.free(json);
    returnString(info, json);
}

// ════════════════════════════════════════════════════════════════════════
// Noise sessions
// ════════════════════════════════════════════════════════════════════════

fn privNoiseInitiate(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const pub_b64 = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(pub_b64);
    const remote_pub_bytes = b64Decode(pub_b64) catch return returnEmpty(info);
    defer alloc.free(remote_pub_bytes);
    if (remote_pub_bytes.len != 32) return returnEmpty(info);
    const remote_pub: [32]u8 = remote_pub_bytes[0..32].*;

    const result = privacy.noiseInitiateSession(remote_pub) catch return returnEmpty(info);
    const handshake_b64 = b64Encode(&result.handshake) catch return returnEmpty(info);
    defer alloc.free(handshake_b64);

    const json = std.fmt.allocPrint(alloc,
        \\{{"sessionId":{d},"message":"{s}"}}
    , .{ result.session_id, handshake_b64 }) catch return returnEmpty(info);
    defer alloc.free(json);
    returnString(info, json);
}

fn privNoiseRespond(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const priv_b64 = argStr(info, 0) orelse return returnNumber(info, 0);
    defer alloc.free(priv_b64);
    const msg_b64 = argStr(info, 1) orelse return returnNumber(info, 0);
    defer alloc.free(msg_b64);

    const priv_bytes = b64Decode(priv_b64) catch return returnNumber(info, 0);
    defer alloc.free(priv_bytes);
    const msg_bytes = b64Decode(msg_b64) catch return returnNumber(info, 0);
    defer alloc.free(msg_bytes);
    if (priv_bytes.len != 32 or msg_bytes.len != 32) return returnNumber(info, 0);

    const priv_arr: [32]u8 = priv_bytes[0..32].*;
    const msg_arr: [32]u8 = msg_bytes[0..32].*;

    const id = privacy.noiseRespondSession(priv_arr, msg_arr) catch return returnNumber(info, 0);
    returnNumber(info, @floatFromInt(id));
}

fn privNoiseSend(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argI64(info, 0) orelse return returnEmpty(info);
    if (id <= 0) return returnEmpty(info);
    const pt_b64 = argStr(info, 1) orelse return returnEmpty(info);
    defer alloc.free(pt_b64);
    const pt = b64Decode(pt_b64) catch return returnEmpty(info);
    defer alloc.free(pt);

    const out = alloc.alloc(u8, pt.len + 64) catch return returnEmpty(info);
    defer alloc.free(out);
    const n = privacy.noiseSendSession(@intCast(id), pt, out) catch return returnEmpty(info);

    const enc = b64Encode(out[0..n]) catch return returnEmpty(info);
    defer alloc.free(enc);
    returnString(info, enc);
}

fn privNoiseReceive(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argI64(info, 0) orelse return returnEmpty(info);
    if (id <= 0) return returnEmpty(info);
    const ct_b64 = argStr(info, 1) orelse return returnEmpty(info);
    defer alloc.free(ct_b64);
    const ct = b64Decode(ct_b64) catch return returnEmpty(info);
    defer alloc.free(ct);

    const out = alloc.alloc(u8, ct.len) catch return returnEmpty(info);
    defer alloc.free(out);
    const n = privacy.noiseReceiveSession(@intCast(id), ct, out) catch return returnEmpty(info);

    const enc = b64Encode(out[0..n]) catch return returnEmpty(info);
    defer alloc.free(enc);
    returnString(info, enc);
}

fn privNoiseClose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argI64(info, 0) orelse return;
    if (id <= 0) return;
    privacy.noiseCloseSession(@intCast(id));
}

// ════════════════════════════════════════════════════════════════════════
// Keyring
// ════════════════════════════════════════════════════════════════════════

const KeyringEntry = struct { id: u32, ring: keyring.Keyring };
var g_keyrings: ?std.ArrayList(KeyringEntry) = null;
var g_keyring_next_id: u32 = 1;

fn keyringRegistry() *std.ArrayList(KeyringEntry) {
    if (g_keyrings == null) g_keyrings = .empty;
    return &g_keyrings.?;
}

fn findKeyring(id: u32) ?*KeyringEntry {
    const reg = keyringRegistry();
    for (reg.items) |*e| if (e.id == id) return e;
    return null;
}

fn privKeyringCreate(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const path = argStr(info, 0) orelse return returnNumber(info, 0);
    defer alloc.free(path);
    const password = argStr(info, 1) orelse return returnNumber(info, 0);
    defer alloc.free(password);

    var ring = keyring.create(alloc, path, password) catch return returnNumber(info, 0);
    const id = g_keyring_next_id;
    g_keyring_next_id += 1;
    keyringRegistry().append(alloc, .{ .id = id, .ring = ring }) catch {
        ring.deinit();
        return returnNumber(info, 0);
    };
    returnNumber(info, @floatFromInt(id));
}

fn privKeyringOpen(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const path = argStr(info, 0) orelse return returnNumber(info, 0);
    defer alloc.free(path);
    const password = argStr(info, 1) orelse return returnNumber(info, 0);
    defer alloc.free(password);

    var ring = keyring.open(alloc, path, password) catch return returnNumber(info, 0);
    const id = g_keyring_next_id;
    g_keyring_next_id += 1;
    keyringRegistry().append(alloc, .{ .id = id, .ring = ring }) catch {
        ring.deinit();
        return returnNumber(info, 0);
    };
    returnNumber(info, @floatFromInt(id));
}

fn privKeyringClose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argI64(info, 0) orelse return;
    if (id <= 0) return;
    const reg = keyringRegistry();
    var i: usize = 0;
    while (i < reg.items.len) : (i += 1) {
        if (reg.items[i].id == @as(u32, @intCast(id))) {
            reg.items[i].ring.deinit();
            _ = reg.orderedRemove(i);
            return;
        }
    }
}

fn privKeyringGenerate(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argI64(info, 0) orelse return returnEmpty(info);
    const opts_json = argStr(info, 1) orelse return returnEmpty(info);
    defer alloc.free(opts_json);

    const entry = findKeyring(@intCast(id)) orelse return returnEmpty(info);

    var parsed = std.json.parseFromSlice(std.json.Value, alloc, opts_json, .{}) catch return returnEmpty(info);
    defer parsed.deinit();
    const obj = if (parsed.value == .object) parsed.value.object else return returnEmpty(info);

    var opts: keyring.GenerateOpts = .{};
    if (obj.get("type")) |t| if (t == .string) {
        if (std.mem.eql(u8, t.string, "x25519")) opts.key_type = .x25519;
    };
    if (obj.get("label")) |l| if (l == .string) {
        opts.label = l.string;
    };
    if (obj.get("expiresIn")) |e| if (e == .integer) {
        opts.expires_in = e.integer;
    };

    const new_id = keyring.generateKey(&entry.ring, opts) catch return returnEmpty(info);
    const hex = hexEncodeAlloc(&new_id) catch return returnEmpty(info);
    defer alloc.free(hex);
    returnString(info, hex);
}

fn keyEntryToJson(buf: *std.ArrayList(u8), e: *const keyring.KeyEntry) !void {
    try buf.append(alloc, '{');
    try buf.appendSlice(alloc, "\"id\":\"");
    const id_hex = try hexEncodeAlloc(&e.id);
    defer alloc.free(id_hex);
    try buf.appendSlice(alloc, id_hex);
    try buf.appendSlice(alloc, "\",\"type\":\"");
    try buf.appendSlice(alloc, switch (e.key_type) {
        .ed25519 => "ed25519",
        .x25519 => "x25519",
    });
    try buf.appendSlice(alloc, "\",\"publicKey\":\"");
    const pub_hex = try hexEncodeAlloc(&e.public_key);
    defer alloc.free(pub_hex);
    try buf.appendSlice(alloc, pub_hex);
    try buf.append(alloc, '"');
    if (e.label) |l| {
        try buf.appendSlice(alloc, ",\"label\":\"");
        try buf.appendSlice(alloc, l);
        try buf.append(alloc, '"');
    }
    try listPrint(buf, ",\"created\":{d}", .{e.created});
    if (e.expires) |x| try listPrint(buf, ",\"expires\":{d}", .{x});
    if (e.revoked) |r| try listPrint(buf, ",\"revoked\":{d}", .{r});
    if (e.rotated_to) |rt| {
        try buf.appendSlice(alloc, ",\"rotatedTo\":\"");
        const rt_hex = try hexEncodeAlloc(&rt);
        defer alloc.free(rt_hex);
        try buf.appendSlice(alloc, rt_hex);
        try buf.append(alloc, '"');
    }
    try buf.append(alloc, '}');
}

fn privKeyringList(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argI64(info, 0) orelse return returnEmpty(info);
    const entry = findKeyring(@intCast(id)) orelse return returnEmpty(info);

    var buf: std.ArrayList(u8) = .empty;
    defer buf.deinit(alloc);
    buf.append(alloc, '[') catch return returnEmpty(info);
    for (entry.ring.entries.items, 0..) |*e, i| {
        if (i > 0) buf.append(alloc, ',') catch return returnEmpty(info);
        keyEntryToJson(&buf, e) catch return returnEmpty(info);
    }
    buf.append(alloc, ']') catch return returnEmpty(info);
    returnString(info, buf.items);
}

fn privKeyringGet(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argI64(info, 0) orelse return returnEmpty(info);
    const key_hex = argStr(info, 1) orelse return returnEmpty(info);
    defer alloc.free(key_hex);
    const entry = findKeyring(@intCast(id)) orelse return returnEmpty(info);

    var key_id: [16]u8 = undefined;
    if (key_hex.len != 32) return returnEmpty(info);
    _ = crmod.hexToBytes(key_hex, &key_id) catch return returnEmpty(info);

    const e = keyring.getKey(&entry.ring, key_id) orelse return returnEmpty(info);

    var buf: std.ArrayList(u8) = .empty;
    defer buf.deinit(alloc);
    keyEntryToJson(&buf, e) catch return returnEmpty(info);
    returnString(info, buf.items);
}

fn privKeyringRotate(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argI64(info, 0) orelse return returnEmpty(info);
    const key_hex = argStr(info, 1) orelse return returnEmpty(info);
    defer alloc.free(key_hex);
    const entry = findKeyring(@intCast(id)) orelse return returnEmpty(info);

    var key_id: [16]u8 = undefined;
    if (key_hex.len != 32) return returnEmpty(info);
    _ = crmod.hexToBytes(key_hex, &key_id) catch return returnEmpty(info);

    const new_id = keyring.rotateKey(&entry.ring, key_id) catch return returnEmpty(info);
    const hex = hexEncodeAlloc(&new_id) catch return returnEmpty(info);
    defer alloc.free(hex);
    returnString(info, hex);
}

fn privKeyringRevoke(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argI64(info, 0) orelse return returnBool(info, false);
    const key_hex = argStr(info, 1) orelse return returnBool(info, false);
    defer alloc.free(key_hex);
    const reason = argStr(info, 2) orelse return returnBool(info, false);
    defer alloc.free(reason);
    const entry = findKeyring(@intCast(id)) orelse return returnBool(info, false);

    var key_id: [16]u8 = undefined;
    if (key_hex.len != 32) return returnBool(info, false);
    _ = crmod.hexToBytes(key_hex, &key_id) catch return returnBool(info, false);

    keyring.revokeKey(&entry.ring, key_id, reason) catch return returnBool(info, false);
    returnBool(info, true);
}

fn privKeyringExport(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argI64(info, 0) orelse return returnEmpty(info);
    const key_hex = argStr(info, 1) orelse return returnEmpty(info);
    defer alloc.free(key_hex);
    const entry = findKeyring(@intCast(id)) orelse return returnEmpty(info);

    var key_id: [16]u8 = undefined;
    if (key_hex.len != 32) return returnEmpty(info);
    _ = crmod.hexToBytes(key_hex, &key_id) catch return returnEmpty(info);

    const pub_key = keyring.exportPublic(&entry.ring, key_id) orelse return returnEmpty(info);
    const enc = b64Encode(&pub_key) catch return returnEmpty(info);
    defer alloc.free(enc);
    returnString(info, enc);
}

// ════════════════════════════════════════════════════════════════════════
// PII + sanitize (delegates to crypto.zig)
// ════════════════════════════════════════════════════════════════════════

fn privPiiDetect(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const text = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(text);
    var matches: [64]crmod.PiiMatch = undefined;
    const n = crmod.detectPii(text, &matches);

    var buf: std.ArrayList(u8) = .empty;
    defer buf.deinit(alloc);
    buf.append(alloc, '[') catch return returnEmpty(info);
    for (matches[0..n], 0..) |m, i| {
        if (i > 0) buf.append(alloc, ',') catch return returnEmpty(info);
        const type_str = switch (m.pii_type) {
            .email => "email",
            .ssn => "ssn",
            .credit_card => "credit_card",
        };
        listPrint(&buf,
            \\{{"type":"{s}","start":{d},"end":{d}}}
        , .{ type_str, m.start, m.end }) catch return returnEmpty(info);
    }
    buf.append(alloc, ']') catch return returnEmpty(info);
    returnString(info, buf.items);
}

fn privPiiRedact(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const text = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(text);
    const out = alloc.alloc(u8, text.len + text.len + 256) catch return returnEmpty(info);
    defer alloc.free(out);
    const n = crmod.redactPii(text, out);
    returnString(info, out[0..n]);
}

fn privSanitizeHtml(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const text = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(text);
    const out = alloc.alloc(u8, text.len * 6 + 16) catch return returnEmpty(info);
    defer alloc.free(out);
    const n = crmod.sanitizeHtml(text, out);
    returnString(info, out[0..n]);
}

// ════════════════════════════════════════════════════════════════════════

// Shamir
// ════════════════════════════════════════════════════════════════════════

fn privShamirSplit(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const secret_b64 = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(secret_b64);
    const n = argI64(info, 1) orelse return returnEmpty(info);
    const k = argI64(info, 2) orelse return returnEmpty(info);
    if (n <= 0 or k <= 0 or n > 255 or k > 255) return returnEmpty(info);

    const secret = b64Decode(secret_b64) catch return returnEmpty(info);
    defer alloc.free(secret);

    const shares = privacy.shamirSplit(alloc, secret, @intCast(n), @intCast(k)) catch return returnEmpty(info);
    defer {
        for (shares) |sh| alloc.free(sh.bytes);
        alloc.free(shares);
    }

    var buf: std.ArrayList(u8) = .empty;
    defer buf.deinit(alloc);
    buf.append(alloc, '[') catch return returnEmpty(info);
    for (shares, 0..) |sh, i| {
        if (i > 0) buf.append(alloc, ',') catch return returnEmpty(info);
        const enc = b64Encode(sh.bytes) catch return returnEmpty(info);
        defer alloc.free(enc);
        listPrint(&buf,
            \\{{"index":{d},"data":"{s}"}}
        , .{ sh.index, enc }) catch return returnEmpty(info);
    }
    buf.append(alloc, ']') catch return returnEmpty(info);
    returnString(info, buf.items);
}

fn privShamirCombine(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const json_in = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(json_in);

    var parsed = std.json.parseFromSlice(std.json.Value, alloc, json_in, .{}) catch return returnEmpty(info);
    defer parsed.deinit();
    const arr = switch (parsed.value) {
        .array => |a| a,
        else => return returnEmpty(info),
    };
    if (arr.items.len < 2) return returnEmpty(info);

    var shares = alloc.alloc(privacy.ShamirShare, arr.items.len) catch return returnEmpty(info);
    var allocated: usize = 0;
    defer {
        for (shares[0..allocated]) |sh| alloc.free(sh.bytes);
        alloc.free(shares);
    }
    for (arr.items, 0..) |item, i| {
        const obj = switch (item) {
            .object => |o| o,
            else => return returnEmpty(info),
        };
        const idx_v = obj.get("index") orelse return returnEmpty(info);
        const data_v = obj.get("data") orelse return returnEmpty(info);
        const idx_i = switch (idx_v) {
            .integer => |x| x,
            else => return returnEmpty(info),
        };
        const data_b64 = switch (data_v) {
            .string => |s| s,
            else => return returnEmpty(info),
        };
        const data = b64Decode(data_b64) catch return returnEmpty(info);
        shares[i] = .{ .index = @intCast(idx_i), .bytes = data };
        allocated += 1;
    }

    const out = privacy.shamirCombine(alloc, shares) catch return returnEmpty(info);
    defer alloc.free(out);
    const enc = b64Encode(out) catch return returnEmpty(info);
    defer alloc.free(enc);
    returnString(info, enc);
}

// ════════════════════════════════════════════════════════════════════════
// Envelope
// ════════════════════════════════════════════════════════════════════════

fn privEnvelopeEncrypt(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const data_b64 = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(data_b64);
    const kek_b64 = argStr(info, 1) orelse return returnEmpty(info);
    defer alloc.free(kek_b64);

    const data = b64Decode(data_b64) catch return returnEmpty(info);
    defer alloc.free(data);
    const kek_bytes = b64Decode(kek_b64) catch return returnEmpty(info);
    defer alloc.free(kek_bytes);
    if (kek_bytes.len != 32) return returnEmpty(info);
    var kek: [32]u8 = undefined;
    @memcpy(&kek, kek_bytes);

    const env = privacy.envelopeEncrypt(alloc, data, kek) catch return returnEmpty(info);
    defer alloc.free(env.ciphertext);

    const edek = b64Encode(&env.encrypted_dek) catch return returnEmpty(info);
    defer alloc.free(edek);
    const dn = b64Encode(&env.dek_nonce) catch return returnEmpty(info);
    defer alloc.free(dn);
    const ct = b64Encode(env.ciphertext) catch return returnEmpty(info);
    defer alloc.free(ct);
    const dan = b64Encode(&env.data_nonce) catch return returnEmpty(info);
    defer alloc.free(dan);

    var buf: std.ArrayList(u8) = .empty;
    defer buf.deinit(alloc);
    listPrint(&buf,
        \\{{"encryptedDEK":"{s}","dekNonce":"{s}","ciphertext":"{s}","dataNonce":"{s}","algorithm":"xchacha20-poly1305"}}
    , .{ edek, dn, ct, dan }) catch return returnEmpty(info);
    returnString(info, buf.items);
}

fn privEnvelopeDecrypt(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const env_json = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(env_json);
    const kek_b64 = argStr(info, 1) orelse return returnEmpty(info);
    defer alloc.free(kek_b64);

    var parsed = std.json.parseFromSlice(std.json.Value, alloc, env_json, .{}) catch return returnEmpty(info);
    defer parsed.deinit();
    const obj = switch (parsed.value) {
        .object => |o| o,
        else => return returnEmpty(info),
    };
    const edek_v = obj.get("encryptedDEK") orelse return returnEmpty(info);
    const dn_v = obj.get("dekNonce") orelse return returnEmpty(info);
    const ct_v = obj.get("ciphertext") orelse return returnEmpty(info);
    const dan_v = obj.get("dataNonce") orelse return returnEmpty(info);

    const edek_bytes = b64Decode(switch (edek_v) { .string => |s| s, else => return returnEmpty(info) }) catch return returnEmpty(info);
    defer alloc.free(edek_bytes);
    const dn_bytes = b64Decode(switch (dn_v) { .string => |s| s, else => return returnEmpty(info) }) catch return returnEmpty(info);
    defer alloc.free(dn_bytes);
    const ct_bytes = b64Decode(switch (ct_v) { .string => |s| s, else => return returnEmpty(info) }) catch return returnEmpty(info);
    defer alloc.free(ct_bytes);
    const dan_bytes = b64Decode(switch (dan_v) { .string => |s| s, else => return returnEmpty(info) }) catch return returnEmpty(info);
    defer alloc.free(dan_bytes);

    if (edek_bytes.len != 48 or dn_bytes.len != 24 or dan_bytes.len != 24) return returnEmpty(info);

    const kek_bytes = b64Decode(kek_b64) catch return returnEmpty(info);
    defer alloc.free(kek_bytes);
    if (kek_bytes.len != 32) return returnEmpty(info);

    var edek: [48]u8 = undefined;
    var dn: [24]u8 = undefined;
    var dan: [24]u8 = undefined;
    var kek: [32]u8 = undefined;
    @memcpy(&edek, edek_bytes);
    @memcpy(&dn, dn_bytes);
    @memcpy(&dan, dan_bytes);
    @memcpy(&kek, kek_bytes);

    const pt = privacy.envelopeDecrypt(alloc, edek, dn, ct_bytes, dan, kek) catch return returnEmpty(info);
    defer alloc.free(pt);
    const enc = b64Encode(pt) catch return returnEmpty(info);
    defer alloc.free(enc);
    returnString(info, enc);
}

// ════════════════════════════════════════════════════════════════════════
// Image steg (raw RGBA in/out)
// ════════════════════════════════════════════════════════════════════════

fn privStegImageEmbed(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const rgba_b64 = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(rgba_b64);
    const data_b64 = argStr(info, 1) orelse return returnEmpty(info);
    defer alloc.free(data_b64);
    const rgba = b64Decode(rgba_b64) catch return returnEmpty(info);
    defer alloc.free(rgba);
    const data = b64Decode(data_b64) catch return returnEmpty(info);
    defer alloc.free(data);
    privacy.stegEmbedImageRGBA(rgba, data) catch return returnEmpty(info);
    const enc = b64Encode(rgba) catch return returnEmpty(info);
    defer alloc.free(enc);
    returnString(info, enc);
}

fn privStegImageExtract(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const rgba_b64 = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(rgba_b64);
    const rgba = b64Decode(rgba_b64) catch return returnEmpty(info);
    defer alloc.free(rgba);
    const data = privacy.stegExtractImageRGBA(alloc, rgba) catch return returnEmpty(info);
    defer alloc.free(data);
    const enc = b64Encode(data) catch return returnEmpty(info);
    defer alloc.free(enc);
    returnString(info, enc);
}

// ════════════════════════════════════════════════════════════════════════
// Audit log
// ════════════════════════════════════════════════════════════════════════

fn privAuditCreate(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const key_hex = argStr(info, 0) orelse return returnBool(info, false);
    defer alloc.free(key_hex);
    privacy.auditCreate(key_hex) catch return returnBool(info, false);
    returnBool(info, true);
}

fn privAuditAppend(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const event = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(event);
    const data_json = argStr(info, 1) orelse return returnEmpty(info);
    defer alloc.free(data_json);
    const e = privacy.auditAppend(event, data_json) catch return returnEmpty(info);
    var buf: std.ArrayList(u8) = .empty;
    defer buf.deinit(alloc);
    listPrint(&buf,
        "{{\"index\":{d},\"timestamp\":{d},\"event\":", .{ e.index, e.timestamp }) catch return returnEmpty(info);
    // event re-quoted from the dup'd copy
    var qbuf: std.ArrayList(u8) = .empty;
    defer qbuf.deinit(alloc);
    qbuf.append(alloc, '"') catch return returnEmpty(info);
    for (e.event) |c| {
        switch (c) {
            '"' => qbuf.appendSlice(alloc, "\\\"") catch return returnEmpty(info),
            '\\' => qbuf.appendSlice(alloc, "\\\\") catch return returnEmpty(info),
            '\n' => qbuf.appendSlice(alloc, "\\n") catch return returnEmpty(info),
            '\r' => qbuf.appendSlice(alloc, "\\r") catch return returnEmpty(info),
            '\t' => qbuf.appendSlice(alloc, "\\t") catch return returnEmpty(info),
            else => qbuf.append(alloc, c) catch return returnEmpty(info),
        }
    }
    qbuf.append(alloc, '"') catch return returnEmpty(info);
    buf.appendSlice(alloc, qbuf.items) catch return returnEmpty(info);
    buf.appendSlice(alloc, ",\"data\":") catch return returnEmpty(info);
    buf.appendSlice(alloc, e.data_json) catch return returnEmpty(info);
    buf.appendSlice(alloc, ",\"hash\":\"") catch return returnEmpty(info);
    buf.appendSlice(alloc, &e.hash_hex) catch return returnEmpty(info);
    buf.appendSlice(alloc, "\",\"prevHash\":\"") catch return returnEmpty(info);
    buf.appendSlice(alloc, &e.prev_hash_hex) catch return returnEmpty(info);
    buf.appendSlice(alloc, "\"}") catch return returnEmpty(info);
    returnString(info, buf.items);
}

fn privAuditVerify(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const r = privacy.auditVerify();
    var buf: std.ArrayList(u8) = .empty;
    defer buf.deinit(alloc);
    listPrint(&buf,
        \\{{"valid":{s},"entries":{d},"brokenAt":{d}}}
    , .{ if (r.valid) "true" else "false", r.entries, r.broken_at }) catch return returnEmpty(info);
    returnString(info, buf.items);
}

fn privAuditEntries(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const from = argI64(info, 0) orelse 0;
    const to = argI64(info, 1) orelse std.math.maxInt(i32);
    const json = privacy.auditEntriesJson(alloc, @intCast(@max(from, 0)), @intCast(@max(to, 0))) catch return returnEmpty(info);
    defer alloc.free(json);
    returnString(info, json);
}

// ════════════════════════════════════════════════════════════════════════
// Policy / consent
// ════════════════════════════════════════════════════════════════════════

fn privPolicySetRetention(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const category = argStr(info, 0) orelse return returnBool(info, false);
    defer alloc.free(category);
    const json = argStr(info, 1) orelse return returnBool(info, false);
    defer alloc.free(json);
    privacy.policySetRetention(category, json) catch return returnBool(info, false);
    returnBool(info, true);
}

fn privPolicyRecordConsent(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const user_id = argStr(info, 0) orelse return returnBool(info, false);
    defer alloc.free(user_id);
    const purpose = argStr(info, 1) orelse return returnBool(info, false);
    defer alloc.free(purpose);
    const granted = argBool(info, 2);
    privacy.policyRecordConsent(user_id, purpose, granted) catch return returnBool(info, false);
    returnBool(info, true);
}

fn privPolicyCheckConsent(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const user_id = argStr(info, 0) orelse return returnBool(info, false);
    defer alloc.free(user_id);
    const purpose = argStr(info, 1) orelse return returnBool(info, false);
    defer alloc.free(purpose);
    returnBool(info, privacy.policyCheckConsent(user_id, purpose));
}

fn privPolicyRevokeConsent(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const user_id = argStr(info, 0) orelse return returnBool(info, false);
    defer alloc.free(user_id);
    const purpose_opt: ?[]u8 = argStr(info, 1);
    defer if (purpose_opt) |p| alloc.free(p);
    privacy.policyRevokeConsent(user_id, if (purpose_opt) |p| p else null) catch return returnBool(info, false);
    returnBool(info, true);
}

fn privPolicyErasure(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const user_id = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(user_id);
    const r = privacy.policyRightToErasure(user_id);
    var buf: std.ArrayList(u8) = .empty;
    defer buf.deinit(alloc);
    listPrint(&buf,
        \\{{"recordsFound":{d},"recordsDeleted":{d}}}
    , .{ r.records_found, r.records_deleted }) catch return returnEmpty(info);
    returnString(info, buf.items);
}

// ════════════════════════════════════════════════════════════════════════
// Algorithm strength
// ════════════════════════════════════════════════════════════════════════

fn privCheckAlgo(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const algo = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(algo);
    const r = privacy.checkAlgorithmStrength(algo);
    var buf: std.ArrayList(u8) = .empty;
    defer buf.deinit(alloc);
    listPrint(&buf,
        \\{{"strength":"{s}","deprecated":{s},"recommendation":"{s}"}}
    , .{
        privacy.strengthString(r.strength),
        if (r.deprecated) "true" else "false",
        r.recommendation,
    }) catch return returnEmpty(info);
    returnString(info, buf.items);
}

// ════════════════════════════════════════════════════════════════════════
// Filename / timestamp helpers
// ════════════════════════════════════════════════════════════════════════

fn privSanitizeFilename(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const name = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(name);
    const out = alloc.alloc(u8, name.len) catch return returnEmpty(info);
    defer alloc.free(out);
    const slice = privacy.sanitizeFilename(name, out);
    returnString(info, slice);
}

fn privNormalizeTimestamp(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ts = argStr(info, 0) orelse return returnEmpty(info);
    defer alloc.free(ts);
    const out = alloc.alloc(u8, ts.len + 1) catch return returnEmpty(info);
    defer alloc.free(out);
    const slice = privacy.normalizeTimestamp(ts, out);
    returnString(info, slice);
}

// ════════════════════════════════════════════════════════════════════════
// Registration
// ════════════════════════════════════════════════════════════════════════

pub fn registerPrivacy(_: anytype) void {
    _ = sodium.init();

    v8_runtime.registerHostFn("__priv_sha256", privSha256);
    v8_runtime.registerHostFn("__priv_hmac_sha256", privHmacSha256);
    v8_runtime.registerHostFn("__priv_hkdf_sha256", privHkdfSha256);
    v8_runtime.registerHostFn("__priv_xchacha_encrypt", privXchachaEncrypt);
    v8_runtime.registerHostFn("__priv_xchacha_decrypt", privXchachaDecrypt);
    v8_runtime.registerHostFn("__priv_random_bytes", privRandomBytes);

    v8_runtime.registerHostFn("__priv_hash_file", privHashFile);
    v8_runtime.registerHostFn("__priv_hash_directory", privHashDirectory);
    v8_runtime.registerHostFn("__priv_verify_manifest", privVerifyManifest);

    v8_runtime.registerHostFn("__priv_secbuf_alloc", privSecbufAlloc);
    v8_runtime.registerHostFn("__priv_secbuf_read", privSecbufRead);
    v8_runtime.registerHostFn("__priv_secbuf_free", privSecbufFree);
    v8_runtime.registerHostFn("__priv_secbuf_protect", privSecbufProtect);

    v8_runtime.registerHostFn("__priv_encrypt_file", privEncryptFile);
    v8_runtime.registerHostFn("__priv_decrypt_file", privDecryptFile);
    v8_runtime.registerHostFn("__priv_secure_delete", privSecureDelete);

    v8_runtime.registerHostFn("__priv_steg_embed", privStegEmbed);
    v8_runtime.registerHostFn("__priv_steg_extract", privStegExtract);
    v8_runtime.registerHostFn("__priv_tokenize", privTokenize);

    v8_runtime.registerHostFn("__priv_gpg_encrypt", privGpgEncrypt);
    v8_runtime.registerHostFn("__priv_gpg_decrypt", privGpgDecrypt);
    v8_runtime.registerHostFn("__priv_gpg_sign", privGpgSign);
    v8_runtime.registerHostFn("__priv_gpg_verify", privGpgVerify);
    v8_runtime.registerHostFn("__priv_gpg_list_keys", privGpgListKeys);
    v8_runtime.registerHostFn("__priv_gpg_import", privGpgImport);
    v8_runtime.registerHostFn("__priv_gpg_export", privGpgExport);

    v8_runtime.registerHostFn("__priv_meta_strip", privMetaStrip);
    v8_runtime.registerHostFn("__priv_meta_read", privMetaRead);

    v8_runtime.registerHostFn("__priv_anonymous_id", privAnonymousId);
    v8_runtime.registerHostFn("__priv_pseudonym", privPseudonym);
    v8_runtime.registerHostFn("__priv_isolated_credential", privIsolatedCredential);

    v8_runtime.registerHostFn("__priv_noise_initiate", privNoiseInitiate);
    v8_runtime.registerHostFn("__priv_noise_respond", privNoiseRespond);
    v8_runtime.registerHostFn("__priv_noise_send", privNoiseSend);
    v8_runtime.registerHostFn("__priv_noise_receive", privNoiseReceive);
    v8_runtime.registerHostFn("__priv_noise_close", privNoiseClose);

    v8_runtime.registerHostFn("__priv_keyring_create", privKeyringCreate);
    v8_runtime.registerHostFn("__priv_keyring_open", privKeyringOpen);
    v8_runtime.registerHostFn("__priv_keyring_close", privKeyringClose);
    v8_runtime.registerHostFn("__priv_keyring_generate", privKeyringGenerate);
    v8_runtime.registerHostFn("__priv_keyring_list", privKeyringList);
    v8_runtime.registerHostFn("__priv_keyring_get", privKeyringGet);
    v8_runtime.registerHostFn("__priv_keyring_rotate", privKeyringRotate);
    v8_runtime.registerHostFn("__priv_keyring_revoke", privKeyringRevoke);
    v8_runtime.registerHostFn("__priv_keyring_export", privKeyringExport);

    v8_runtime.registerHostFn("__priv_pii_detect", privPiiDetect);
    v8_runtime.registerHostFn("__priv_pii_redact", privPiiRedact);
    v8_runtime.registerHostFn("__priv_sanitize_html", privSanitizeHtml);

    v8_runtime.registerHostFn("__priv_shamir_split", privShamirSplit);
    v8_runtime.registerHostFn("__priv_shamir_combine", privShamirCombine);

    v8_runtime.registerHostFn("__priv_envelope_encrypt", privEnvelopeEncrypt);
    v8_runtime.registerHostFn("__priv_envelope_decrypt", privEnvelopeDecrypt);

    v8_runtime.registerHostFn("__priv_steg_image_embed", privStegImageEmbed);
    v8_runtime.registerHostFn("__priv_steg_image_extract", privStegImageExtract);

    v8_runtime.registerHostFn("__priv_audit_create", privAuditCreate);
    v8_runtime.registerHostFn("__priv_audit_append", privAuditAppend);
    v8_runtime.registerHostFn("__priv_audit_verify", privAuditVerify);
    v8_runtime.registerHostFn("__priv_audit_entries", privAuditEntries);

    v8_runtime.registerHostFn("__priv_policy_set_retention", privPolicySetRetention);
    v8_runtime.registerHostFn("__priv_policy_record_consent", privPolicyRecordConsent);
    v8_runtime.registerHostFn("__priv_policy_check_consent", privPolicyCheckConsent);
    v8_runtime.registerHostFn("__priv_policy_revoke_consent", privPolicyRevokeConsent);
    v8_runtime.registerHostFn("__priv_policy_erasure", privPolicyErasure);

    v8_runtime.registerHostFn("__priv_check_algorithm", privCheckAlgo);
    v8_runtime.registerHostFn("__priv_sanitize_filename", privSanitizeFilename);
    v8_runtime.registerHostFn("__priv_normalize_timestamp", privNormalizeTimestamp);
}
