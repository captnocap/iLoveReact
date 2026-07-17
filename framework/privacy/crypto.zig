//! crypto.zig — Framework-level privacy & security primitives.
//!
//! Standards-backed cryptographic building blocks for the iLoveReact framework.
//! Uses Zig std crypto exclusively — no external dependencies.
//!
//! Implements:
//!   - HMAC-SHA256 (RFC 2104 / RFC 4231)
//!   - HKDF-SHA256 (RFC 5869)
//!   - Shamir's Secret Sharing (GF(256) with AES polynomial 0x11B)
//!   - PII detection (email, SSN, credit card patterns)
//!   - Input sanitization (XSS/injection prevention)
//!   - Envelope encryption (XChaCha20-Poly1305)

const std = @import("std");
const host_io = @import("../host_io.zig");
const log = @import("../diag/log.zig");
const crypto = std.crypto;
const HmacSha256 = crypto.auth.hmac.sha2.HmacSha256;
const XChaCha20Poly1305 = crypto.aead.chacha_poly.XChaCha20Poly1305;

// ════════════════════════════════════════════════════════════════════════
// Hex utilities
// ════════════════════════════════════════════════════════════════════════

pub fn hexToBytes(hex: []const u8, out: []u8) !usize {
    if (hex.len % 2 != 0) return error.InvalidHexLength;
    const n = hex.len / 2;
    if (out.len < n) return error.BufferTooSmall;
    for (0..n) |i| {
        out[i] = @as(u8, try hexDigit(hex[2 * i])) << 4 | @as(u8, try hexDigit(hex[2 * i + 1]));
    }
    return n;
}

pub fn bytesToHex(bytes: []const u8, out: []u8) void {
    const chars = "0123456789abcdef";
    for (bytes, 0..) |b, i| {
        out[2 * i] = chars[b >> 4];
        out[2 * i + 1] = chars[b & 0x0f];
    }
}

fn hexDigit(c: u8) !u4 {
    if (c >= '0' and c <= '9') return @intCast(c - '0');
    if (c >= 'a' and c <= 'f') return @intCast(c - 'a' + 10);
    if (c >= 'A' and c <= 'F') return @intCast(c - 'A' + 10);
    return error.InvalidHexChar;
}

// ════════════════════════════════════════════════════════════════════════
// HMAC-SHA256
// ════════════════════════════════════════════════════════════════════════

/// Compute HMAC-SHA256(key, message) → 32-byte digest.
pub fn hmacSha256(key: []const u8, message: []const u8) [32]u8 {
    var mac: [32]u8 = undefined;
    HmacSha256.create(&mac, message, key);
    return mac;
}

/// HMAC-SHA256 with hex-encoded inputs → hex-encoded output.
pub fn hmacSha256Hex(key_hex: []const u8, msg_hex: []const u8, out_hex: []u8) !void {
    var key_buf: [256]u8 = undefined;
    var msg_buf: [1024]u8 = undefined;
    const klen = try hexToBytes(key_hex, &key_buf);
    const mlen = try hexToBytes(msg_hex, &msg_buf);
    const mac = hmacSha256(key_buf[0..klen], msg_buf[0..mlen]);
    bytesToHex(&mac, out_hex[0..64]);
}

// ════════════════════════════════════════════════════════════════════════
// HKDF-SHA256 (RFC 5869)
// ════════════════════════════════════════════════════════════════════════

const HASH_LEN = 32; // SHA-256 output

/// HKDF-Extract: PRK = HMAC-SHA256(salt, IKM)
pub fn hkdfExtract(salt: []const u8, ikm: []const u8) [HASH_LEN]u8 {
    const effective_salt = if (salt.len == 0) &([_]u8{0} ** HASH_LEN) else salt;
    return hmacSha256(effective_salt, ikm);
}

/// HKDF-Expand: OKM = T(1) || T(2) || ... truncated to length
pub fn hkdfExpand(prk: []const u8, info: []const u8, out: []u8) !void {
    const n = (out.len + HASH_LEN - 1) / HASH_LEN;
    if (n > 255) return error.HkdfOutputTooLong;

    var t: [HASH_LEN]u8 = undefined;
    var t_len: usize = 0;
    var offset: usize = 0;

    for (0..n) |i| {
        var hmac = HmacSha256.init(prk);
        if (t_len > 0) hmac.update(&t);
        hmac.update(info);
        const counter: [1]u8 = .{@intCast(i + 1)};
        hmac.update(&counter);
        hmac.final(&t);
        t_len = HASH_LEN;

        const copy_len = @min(HASH_LEN, out.len - offset);
        @memcpy(out[offset..][0..copy_len], t[0..copy_len]);
        offset += copy_len;
    }
}

/// Full HKDF: Extract + Expand with hex-encoded I/O.
/// salt and info may be empty slices. Returns hex-encoded OKM.
pub fn hkdfDeriveHex(
    ikm_hex: []const u8,
    salt_hex: []const u8,
    info_hex: []const u8,
    length: usize,
    out_hex: []u8,
) !void {
    var ikm_buf: [256]u8 = undefined;
    var salt_buf: [256]u8 = undefined;
    var info_buf: [256]u8 = undefined;
    var okm_buf: [512]u8 = undefined;

    const ikm_len = try hexToBytes(ikm_hex, &ikm_buf);
    const salt_len = if (salt_hex.len > 0) try hexToBytes(salt_hex, &salt_buf) else 0;
    const info_len = if (info_hex.len > 0) try hexToBytes(info_hex, &info_buf) else 0;

    if (length > okm_buf.len) return error.HkdfOutputTooLong;

    const prk = hkdfExtract(salt_buf[0..salt_len], ikm_buf[0..ikm_len]);
    try hkdfExpand(&prk, info_buf[0..info_len], okm_buf[0..length]);
    bytesToHex(okm_buf[0..length], out_hex[0 .. length * 2]);
}

// ════════════════════════════════════════════════════════════════════════
// Shamir's Secret Sharing — GF(256) with AES polynomial 0x11B
// ════════════════════════════════════════════════════════════════════════

const GF256 = struct {
    // Precomputed exp/log tables for GF(256) with generator 0x03 and polynomial 0x11B
    const exp_table = blk: {
        @setEvalBranchQuota(100000);
        var t: [512]u8 = undefined;
        var x: u16 = 1;
        for (0..256) |i| {
            t[i] = @intCast(x);
            t[i + 256] = @intCast(x);
            x = mul_nomod(x, 3);
        }
        break :blk t;
    };

    const log_table = blk: {
        var t: [256]u8 = undefined;
        t[0] = 0; // log(0) is undefined but we guard against it
        for (0..255) |i| {
            t[exp_table[i]] = @intCast(i);
        }
        break :blk t;
    };

    fn mul_nomod(a: u16, b: u16) u16 {
        var result: u16 = 0;
        var aa = a;
        var bb = b;
        while (bb > 0) {
            if (bb & 1 != 0) result ^= aa;
            aa <<= 1;
            if (aa & 0x100 != 0) aa ^= 0x11B;
            bb >>= 1;
        }
        return result;
    }

    pub fn mul(a: u8, b: u8) u8 {
        if (a == 0 or b == 0) return 0;
        const log_sum = @as(u16, log_table[a]) + @as(u16, log_table[b]);
        return exp_table[@intCast(log_sum % 255)];
    }

    pub fn inv(a: u8) u8 {
        if (a == 0) return 0; // undefined, but safe fallback
        return exp_table[255 - @as(u16, log_table[a])];
    }
};

/// Evaluate polynomial at x in GF(256). coeffs[0] = constant term.
fn gf256PolyEval(coeffs: []const u8, x: u8) u8 {
    var result: u8 = 0;
    var xi: u8 = 1; // x^0 = 1
    for (coeffs) |c| {
        result ^= GF256.mul(c, xi);
        xi = GF256.mul(xi, x);
    }
    return result;
}

/// Lagrange interpolation at x=0 in GF(256).
/// xs and ys must have the same length (threshold k).
fn gf256LagrangeInterp0(xs: []const u8, ys: []const u8) u8 {
    var result: u8 = 0;
    const k = xs.len;
    for (0..k) |i| {
        var num: u8 = 1;
        var den: u8 = 1;
        for (0..k) |j| {
            if (i == j) continue;
            num = GF256.mul(num, xs[j]); // 0 ^ xs[j] = xs[j]
            den = GF256.mul(den, xs[i] ^ xs[j]);
        }
        const coeff = GF256.mul(ys[i], GF256.mul(num, GF256.inv(den)));
        result ^= coeff;
    }
    return result;
}

/// Split a secret (hex string) into n shares with threshold k.
/// Returns shares as (index, hex) pairs. index is 1-based.
pub fn shamirSplit(
    secret_hex: []const u8,
    n: u8,
    k: u8,
    out_indices: []u8,
    out_shares_hex: [][]u8,
) !usize {
    if (k < 2 or n < k) return error.InvalidThreshold;
    var secret_buf: [256]u8 = undefined;
    const secret_len = try hexToBytes(secret_hex, &secret_buf);

    // For each byte of the secret, generate random polynomial of degree k-1
    var rng = std.Random.DefaultPrng.init(@bitCast(host_io.nanoTimestamp()));
    const random = rng.random();

    for (0..secret_len) |bi| {
        var coeffs: [256]u8 = undefined;
        coeffs[0] = secret_buf[bi]; // constant = secret byte
        for (1..k) |ci| {
            coeffs[ci] = random.int(u8);
            // Ensure leading coefficient is nonzero
            if (ci == k - 1 and coeffs[ci] == 0) coeffs[ci] = 1;
        }

        for (0..n) |si| {
            const x: u8 = @intCast(si + 1); // 1-based
            const y = gf256PolyEval(coeffs[0..k], x);
            out_indices[si] = x;
            // Write hex byte to share
            bytesToHex(&[_]u8{y}, out_shares_hex[si][bi * 2 ..][0..2]);
        }
    }
    return secret_len;
}

/// Combine k shares to recover the secret.
/// shares: array of {index, hex_data} where hex_data has length == secret_len*2.
pub fn shamirCombine(
    indices: []const u8,
    shares_hex: []const []const u8,
    out_hex: []u8,
) !usize {
    const k = indices.len;
    if (k < 2) return error.InvalidThreshold;

    // All shares must have same hex length
    const hex_len = shares_hex[0].len;
    const byte_len = hex_len / 2;

    var share_bufs: [16][256]u8 = undefined;
    for (0..k) |i| {
        _ = try hexToBytes(shares_hex[i], &share_bufs[i]);
    }

    var xs: [16]u8 = undefined;
    for (0..k) |i| {
        xs[i] = indices[i];
    }

    var result: [256]u8 = undefined;
    for (0..byte_len) |bi| {
        var ys: [16]u8 = undefined;
        for (0..k) |i| {
            ys[i] = share_bufs[i][bi];
        }
        result[bi] = gf256LagrangeInterp0(xs[0..k], ys[0..k]);
    }

    bytesToHex(result[0..byte_len], out_hex[0 .. byte_len * 2]);
    return byte_len;
}

// ════════════════════════════════════════════════════════════════════════
// Envelope Encryption (XChaCha20-Poly1305)
// ════════════════════════════════════════════════════════════════════════

const tag_length = XChaCha20Poly1305.tag_length; // 16
const nonce_length = XChaCha20Poly1305.nonce_length; // 24
const key_length = XChaCha20Poly1305.key_length; // 32

pub const Envelope = struct {
    encrypted_dek: [key_length]u8,
    dek_tag: [tag_length]u8,
    dek_nonce: [nonce_length]u8,
    ciphertext: [1024]u8,
    ciphertext_len: usize,
    data_tag: [tag_length]u8,
    data_nonce: [nonce_length]u8,
};

pub fn envelopeEncrypt(plaintext: []const u8, kek: *const [key_length]u8) Envelope {
    var env: Envelope = undefined;

    // Generate random DEK + nonces
    var dek: [key_length]u8 = undefined;
    host_io.io().random(&dek);
    host_io.io().random(&env.dek_nonce);
    host_io.io().random(&env.data_nonce);

    // Encrypt DEK with KEK
    XChaCha20Poly1305.encrypt(&env.encrypted_dek, &env.dek_tag, &dek, "", env.dek_nonce, kek.*);

    // Encrypt plaintext with DEK
    XChaCha20Poly1305.encrypt(env.ciphertext[0..plaintext.len], &env.data_tag, plaintext, "", env.data_nonce, dek);
    env.ciphertext_len = plaintext.len;

    return env;
}

pub fn envelopeDecrypt(env: *const Envelope, kek: *const [key_length]u8, out: []u8) !usize {
    // Decrypt DEK
    var dek: [key_length]u8 = undefined;
    XChaCha20Poly1305.decrypt(&dek, &env.encrypted_dek, env.dek_tag, "", env.dek_nonce, kek.*) catch return error.WrongKey;

    // Decrypt data
    const pt_len = env.ciphertext_len;
    XChaCha20Poly1305.decrypt(out[0..pt_len], env.ciphertext[0..pt_len], env.data_tag, "", env.data_nonce, dek) catch return error.TamperedCiphertext;

    return pt_len;
}

// ════════════════════════════════════════════════════════════════════════
// PII Detection
// ════════════════════════════════════════════════════════════════════════

pub const PiiMatch = struct {
    pii_type: PiiType,
    start: usize,
    end: usize,
};

pub const PiiType = enum { email, ssn, credit_card };

/// Detect PII patterns in text. Returns matches found.
pub fn detectPii(text: []const u8, out: []PiiMatch) usize {
    var count: usize = 0;

    // Email: look for @ with surrounding word chars
    var i: usize = 0;
    while (i < text.len) : (i += 1) {
        if (text[i] == '@' and i > 0) {
            // Scan backward for local part start
            var start = i;
            while (start > 0 and isEmailChar(text[start - 1])) start -= 1;
            // Scan forward for domain
            var end = i + 1;
            var has_dot = false;
            while (end < text.len and (isEmailChar(text[end]) or text[end] == '.')) : (end += 1) {
                if (text[end] == '.') has_dot = true;
            }
            if (has_dot and end > i + 2 and start < i) {
                if (count < out.len) {
                    out[count] = .{ .pii_type = .email, .start = start, .end = end };
                    count += 1;
                }
                i = end;
                continue;
            }
        }
    }

    // SSN: ###-##-####
    i = 0;
    while (i + 10 < text.len) : (i += 1) {
        if (isDigit(text[i]) and isDigit(text[i + 1]) and isDigit(text[i + 2]) and
            text[i + 3] == '-' and isDigit(text[i + 4]) and isDigit(text[i + 5]) and
            text[i + 6] == '-' and isDigit(text[i + 7]) and isDigit(text[i + 8]) and
            isDigit(text[i + 9]) and isDigit(text[i + 10]))
        {
            if (count < out.len) {
                out[count] = .{ .pii_type = .ssn, .start = i, .end = i + 11 };
                count += 1;
            }
            i += 11;
            continue;
        }
    }

    // Credit card: 4 groups of 4 digits separated by spaces
    i = 0;
    while (i + 18 < text.len) : (i += 1) {
        if (isCcGroup(text, i) and text[i + 4] == ' ' and
            isCcGroup(text, i + 5) and text[i + 9] == ' ' and
            isCcGroup(text, i + 10) and text[i + 14] == ' ' and
            isCcGroup(text, i + 15))
        {
            if (count < out.len) {
                out[count] = .{ .pii_type = .credit_card, .start = i, .end = i + 19 };
                count += 1;
            }
            i += 19;
            continue;
        }
    }

    return count;
}

/// Redact all detected PII from text, replacing with [REDACTED].
pub fn redactPii(text: []const u8, out: []u8) usize {
    var matches: [32]PiiMatch = undefined;
    const match_count = detectPii(text, &matches);

    var oi: usize = 0;
    var ti: usize = 0;

    for (0..match_count) |mi| {
        const m = matches[mi];
        // Copy text before match
        const before_len = m.start - ti;
        if (oi + before_len <= out.len) {
            @memcpy(out[oi..][0..before_len], text[ti..m.start]);
            oi += before_len;
        }
        // Insert [REDACTED]
        const redacted = "[REDACTED]";
        if (oi + redacted.len <= out.len) {
            @memcpy(out[oi..][0..redacted.len], redacted);
            oi += redacted.len;
        }
        ti = m.end;
    }
    // Copy remaining
    const remaining = text.len - ti;
    if (oi + remaining <= out.len) {
        @memcpy(out[oi..][0..remaining], text[ti..]);
        oi += remaining;
    }
    return oi;
}

fn isEmailChar(c: u8) bool {
    return (c >= 'a' and c <= 'z') or (c >= 'A' and c <= 'Z') or
        (c >= '0' and c <= '9') or c == '.' or c == '_' or c == '-' or c == '+';
}

fn isDigit(c: u8) bool {
    return c >= '0' and c <= '9';
}

fn isCcGroup(text: []const u8, pos: usize) bool {
    return pos + 3 < text.len and isDigit(text[pos]) and isDigit(text[pos + 1]) and
        isDigit(text[pos + 2]) and isDigit(text[pos + 3]);
}

// ════════════════════════════════════════════════════════════════════════
// Input Sanitization (XSS/injection prevention)
// ════════════════════════════════════════════════════════════════════════

/// HTML-escape dangerous characters to prevent XSS.
pub fn sanitizeHtml(input: []const u8, out: []u8) usize {
    var oi: usize = 0;
    for (input) |c| {
        const replacement: ?[]const u8 = switch (c) {
            '<' => "&lt;",
            '>' => "&gt;",
            '&' => "&amp;",
            '"' => "&quot;",
            '\'' => "&#x27;",
            else => null,
        };
        if (replacement) |r| {
            if (oi + r.len <= out.len) {
                @memcpy(out[oi..][0..r.len], r);
                oi += r.len;
            }
        } else {
            if (oi < out.len) {
                out[oi] = c;
                oi += 1;
            }
        }
    }
    return oi;
}

// ════════════════════════════════════════════════════════════════════════
// FFI test runner — callable from .tsz carts via @ffi <crypto_test.h>
// Runs all known-answer vectors, prints green/red to terminal.
// Returns number of tests passed (0..13).
// ════════════════════════════════════════════════════════════════════════

fn printPass(name: [*:0]const u8) void {
    log.print("\x1b[32m  \xe2\x9c\x93 {s}\x1b[0m\n", .{name});
}
fn printFail(name: [*:0]const u8) void {
    log.print("\x1b[31m  \xe2\x9c\x97 {s}\x1b[0m\n", .{name});
}

export fn crypto_run_all_tests() callconv(.c) c_int {
    var passed: c_int = 0;

    log.print("\n\x1b[1mCrypto Test Suite\x1b[0m\n", .{});

    // 1. HMAC-SHA256 RFC 4231
    {
        const mac = hmacSha256("key", "The quick brown fox jumps over the lazy dog");
        var hex: [64]u8 = undefined;
        bytesToHex(&mac, &hex);
        if (std.mem.eql(u8, "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8", &hex)) {
            printPass("HMAC-SHA256 RFC 4231 known vector");
            passed += 1;
        } else printFail("HMAC-SHA256 RFC 4231 known vector");
    }

    // 2. HKDF RFC 5869 test case 1
    {
        var out: [168]u8 = undefined;
        if (hkdfDeriveHex(
            "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
            "000102030405060708090a0b0c",
            "f0f1f2f3f4f5f6f7f8f9",
            42,
            &out,
        )) |_| {
            if (std.mem.eql(u8, "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865", out[0..84])) {
                printPass("HKDF RFC 5869 test case 1");
                passed += 1;
            } else printFail("HKDF RFC 5869 test case 1");
        } else |_| printFail("HKDF RFC 5869 test case 1");
    }

    // 3. HKDF RFC 5869 test case 2
    {
        var out: [328]u8 = undefined;
        if (hkdfDeriveHex(
            "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f",
            "606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9fa0a1a2a3a4a5a6a7a8a9aaabacadaeaf",
            "b0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff",
            82,
            &out,
        )) |_| {
            if (std.mem.eql(u8, "b11e398dc80327a1c8e7f78c596a49344f012eda2d4efad8a050cc4c19afa97c59045a99cac7827271cb41c65e590e09da3275600c2f09b8367793a9aca3db71cc30c58179ec3e87c14c01d5c1f3434f1d87", out[0..164])) {
                printPass("HKDF RFC 5869 test case 2");
                passed += 1;
            } else printFail("HKDF RFC 5869 test case 2");
        } else |_| printFail("HKDF RFC 5869 test case 2");
    }

    // 4. HKDF RFC 5869 test case 3 (empty salt/info)
    {
        var out: [168]u8 = undefined;
        if (hkdfDeriveHex("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b", "", "", 42, &out)) |_| {
            if (std.mem.eql(u8, "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8", out[0..84])) {
                printPass("HKDF RFC 5869 test case 3 (empty salt/info)");
                passed += 1;
            } else printFail("HKDF RFC 5869 test case 3 (empty salt/info)");
        } else |_| printFail("HKDF RFC 5869 test case 3 (empty salt/info)");
    }

    // 5. HKDF rejects overlong output
    {
        var out: [1024]u8 = undefined;
        const result = hkdfDeriveHex("aa", "", "", 8161, &out);
        if (result) |_| {
            printFail("HKDF rejects overlong output");
        } else |_| {
            printPass("HKDF rejects overlong output");
            passed += 1;
        }
    }

    // 6. Shamir GF(256) hardcoded vector
    {
        const coeffs = [_]u8{ 0x42, 0x17, 0x99 };
        const eval_ok = gf256PolyEval(&coeffs, 1) == 0xCC;
        const xs = [_]u8{ 1, 2, 3 };
        const ys = [_]u8{ 0xCC, 0x3E, 0xB0 };
        const recovered = gf256LagrangeInterp0(&xs, &ys);
        if (eval_ok and recovered == 0x42) {
            printPass("Shamir GF(256) hardcoded vector");
            passed += 1;
        } else printFail("Shamir GF(256) hardcoded vector");
    }

    // 7. Shamir combine hex API
    {
        const indices = [_]u8{ 1, 2, 3 };
        const shares = [_][]const u8{ "cc", "3e", "b0" };
        var out: [4]u8 = undefined;
        if (shamirCombine(&indices, &shares, &out)) |_| {
            if (std.mem.eql(u8, "42", out[0..2])) {
                printPass("Shamir combine hex API");
                passed += 1;
            } else printFail("Shamir combine hex API");
        } else |_| printFail("Shamir combine hex API");
    }

    // 8. Envelope encrypt/decrypt round trip
    {
        const kek = [_]u8{0x11} ** 32;
        const pt = [_]u8{ 0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE, 0xBA, 0xBE };
        const env = envelopeEncrypt(&pt, &kek);
        var dec: [8]u8 = undefined;
        if (envelopeDecrypt(&env, &kek, &dec)) |len| {
            if (len == 8 and std.mem.eql(u8, &pt, dec[0..8])) {
                printPass("Envelope encrypt/decrypt round trip");
                passed += 1;
            } else printFail("Envelope encrypt/decrypt round trip");
        } else |_| printFail("Envelope encrypt/decrypt round trip");
    }

    // 9. Envelope rejects wrong KEK
    {
        const kek_a = [_]u8{0x11} ** 32;
        const kek_b = [_]u8{0x22} ** 32;
        const pt = [_]u8{ 0xDE, 0xAD, 0xBE, 0xEF };
        const env = envelopeEncrypt(&pt, &kek_a);
        var out: [4]u8 = undefined;
        if (envelopeDecrypt(&env, &kek_b, &out)) |_| {
            printFail("Envelope rejects wrong KEK");
        } else |_| {
            printPass("Envelope rejects wrong KEK");
            passed += 1;
        }
    }

    // 10. Envelope fresh randomness
    {
        const kek = [_]u8{0xEF} ** 32;
        const pt = [_]u8{ 0x11, 0x22, 0x33, 0x44 };
        const env1 = envelopeEncrypt(&pt, &kek);
        const env2 = envelopeEncrypt(&pt, &kek);
        if (!std.mem.eql(u8, &env1.dek_nonce, &env2.dek_nonce) and
            !std.mem.eql(u8, &env1.data_nonce, &env2.data_nonce) and
            !std.mem.eql(u8, &env1.encrypted_dek, &env2.encrypted_dek))
        {
            printPass("Envelope uses fresh randomness");
            passed += 1;
        } else printFail("Envelope uses fresh randomness");
    }

    // 11. PII detection: email + SSN
    {
        const input = "mail alice@example.com ssn 123-45-6789";
        var matches: [8]PiiMatch = undefined;
        const count = detectPii(input, &matches);
        var email_found = false;
        var ssn_found = false;
        for (matches[0..count]) |m| {
            if (m.pii_type == .email and std.mem.eql(u8, "alice@example.com", input[m.start..m.end])) email_found = true;
            if (m.pii_type == .ssn and std.mem.eql(u8, "123-45-6789", input[m.start..m.end])) ssn_found = true;
        }
        if (email_found and ssn_found) {
            printPass("PII detection: email + SSN");
            passed += 1;
        } else printFail("PII detection: email + SSN");
    }

    // 12. PII redaction
    {
        const input = "u=bob@example.com cc=4111 1111 1111 1111";
        var out: [256]u8 = undefined;
        const len = redactPii(input, &out);
        const redacted = out[0..len];
        if (std.mem.indexOf(u8, redacted, "bob@example.com") == null and
            std.mem.indexOf(u8, redacted, "4111 1111 1111 1111") == null)
        {
            printPass("PII redaction removes values");
            passed += 1;
        } else printFail("PII redaction removes values");
    }

    // 13. HTML sanitization
    {
        const input = "<script>alert('xss')</script>";
        var out: [256]u8 = undefined;
        const len = sanitizeHtml(input, &out);
        const sanitized = out[0..len];
        if (std.mem.indexOf(u8, sanitized, "<script>") == null and
            std.mem.indexOf(u8, sanitized, "&lt;script&gt;") != null)
        {
            printPass("HTML sanitization prevents XSS");
            passed += 1;
        } else printFail("HTML sanitization prevents XSS");
    }

    const color = if (passed == 13) "\x1b[32m" else "\x1b[33m";
    log.print("\n{s}{d}/13 tests passed\x1b[0m\n\n", .{ color, passed });
    return passed;
}

// ════════════════════════════════════════════════════════════════════════
// Tests — RFC known-answer vectors
// ════════════════════════════════════════════════════════════════════════

fn expectHex(expected: []const u8, actual: []const u8) !void {
    if (!std.mem.eql(u8, expected, actual)) {
        log.print("expected: {s}\n  actual: {s}\n", .{ expected, actual });
        return error.TestMismatch;
    }
}

test "HMAC-SHA256 RFC 4231 known vector" {
    // HMAC-SHA256("key", "The quick brown fox jumps over the lazy dog")
    const mac = hmacSha256("key", "The quick brown fox jumps over the lazy dog");
    var hex: [64]u8 = undefined;
    bytesToHex(&mac, &hex);
    try expectHex("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8", &hex);
}

test "HKDF RFC 5869 test case 1" {
    var out: [168]u8 = undefined; // 42 * 2 hex chars + some padding
    try hkdfDeriveHex(
        "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
        "000102030405060708090a0b0c",
        "f0f1f2f3f4f5f6f7f8f9",
        42,
        &out,
    );
    try expectHex(
        "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
        out[0..84],
    );
}

test "HKDF RFC 5869 test case 2" {
    var out: [328]u8 = undefined;
    try hkdfDeriveHex(
        "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f",
        "606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9fa0a1a2a3a4a5a6a7a8a9aaabacadaeaf",
        "b0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff",
        82,
        &out,
    );
    try expectHex(
        "b11e398dc80327a1c8e7f78c596a49344f012eda2d4efad8a050cc4c19afa97c59045a99cac7827271cb41c65e590e09da3275600c2f09b8367793a9aca3db71cc30c58179ec3e87c14c01d5c1f3434f1d87",
        out[0..164],
    );
}

test "HKDF RFC 5869 test case 3 (empty salt/info)" {
    var out: [168]u8 = undefined;
    try hkdfDeriveHex(
        "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
        "",
        "",
        42,
        &out,
    );
    try expectHex(
        "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8",
        out[0..84],
    );
}

test "HKDF rejects overlong output" {
    var out: [1024]u8 = undefined;
    const result = hkdfDeriveHex("aa", "", "", 8161, &out);
    try std.testing.expectError(error.HkdfOutputTooLong, result);
}

test "Shamir GF(256) hardcoded vector" {
    // f(x) = 0x42 + 0x17*x + 0x99*x^2 over GF(256) with AES polynomial
    // f(1) should be 0x42 ^ mul(0x17, 1) ^ mul(0x99, 1) = 0x42 ^ 0x17 ^ 0x99 = 0xCC
    // f(2) should be 0x42 ^ mul(0x17, 2) ^ mul(0x99, 4)
    // f(3) should be 0x42 ^ mul(0x17, 3) ^ mul(0x99, 9)
    const coeffs = [_]u8{ 0x42, 0x17, 0x99 };
    try std.testing.expectEqual(@as(u8, 0xCC), gf256PolyEval(&coeffs, 1));

    // Combine shares at x=1,2,3 to recover constant term 0x42
    const xs = [_]u8{ 1, 2, 3 };
    const ys = [_]u8{ 0xCC, 0x3E, 0xB0 };
    const recovered = gf256LagrangeInterp0(&xs, &ys);
    try std.testing.expectEqual(@as(u8, 0x42), recovered);
}

test "Shamir combine hex API matches Love2D vector" {
    const indices = [_]u8{ 1, 2, 3 };
    const shares = [_][]const u8{ "cc", "3e", "b0" };
    var out: [4]u8 = undefined;
    _ = try shamirCombine(&indices, &shares, &out);
    try expectHex("42", out[0..2]);
}

test "Envelope encrypt/decrypt round trip" {
    const kek = [_]u8{0x11} ** 32;
    const plaintext = "deadbeefcafebabe";
    var pt_bytes: [8]u8 = undefined;
    _ = try hexToBytes(plaintext, &pt_bytes);

    const env = envelopeEncrypt(&pt_bytes, &kek);

    var decrypted: [8]u8 = undefined;
    const pt_len = try envelopeDecrypt(&env, &kek, &decrypted);
    try std.testing.expectEqual(@as(usize, 8), pt_len);
    try std.testing.expectEqualSlices(u8, &pt_bytes, decrypted[0..pt_len]);
}

test "Envelope rejects wrong KEK" {
    const kek_a = [_]u8{0x11} ** 32;
    const kek_b = [_]u8{0x22} ** 32;
    const plaintext = [_]u8{ 0xDE, 0xAD, 0xBE, 0xEF };

    const env = envelopeEncrypt(&plaintext, &kek_a);

    var out: [4]u8 = undefined;
    const result = envelopeDecrypt(&env, &kek_b, &out);
    try std.testing.expectError(error.WrongKey, result);
}

test "Envelope uses fresh randomness" {
    const kek = [_]u8{0xEF} ** 32;
    const plaintext = [_]u8{ 0x11, 0x22, 0x33, 0x44 };

    const env1 = envelopeEncrypt(&plaintext, &kek);
    const env2 = envelopeEncrypt(&plaintext, &kek);

    try std.testing.expect(!std.mem.eql(u8, &env1.dek_nonce, &env2.dek_nonce));
    try std.testing.expect(!std.mem.eql(u8, &env1.data_nonce, &env2.data_nonce));
    try std.testing.expect(!std.mem.eql(u8, &env1.encrypted_dek, &env2.encrypted_dek));
}

test "PII detection: email + SSN boundaries" {
    const input = "mail alice@example.com ssn 123-45-6789";
    var matches: [8]PiiMatch = undefined;
    const count = detectPii(input, &matches);
    try std.testing.expect(count >= 2);

    // Find email match
    var email_found = false;
    var ssn_found = false;
    for (matches[0..count]) |m| {
        if (m.pii_type == .email) {
            try std.testing.expectEqualStrings("alice@example.com", input[m.start..m.end]);
            email_found = true;
        }
        if (m.pii_type == .ssn) {
            try std.testing.expectEqualStrings("123-45-6789", input[m.start..m.end]);
            ssn_found = true;
        }
    }
    try std.testing.expect(email_found);
    try std.testing.expect(ssn_found);
}

test "PII redaction removes raw values" {
    const input = "u=bob@example.com cc=4111 1111 1111 1111";
    var out: [256]u8 = undefined;
    const len = redactPii(input, &out);
    const redacted = out[0..len];
    try std.testing.expect(std.mem.indexOf(u8, redacted, "bob@example.com") == null);
    try std.testing.expect(std.mem.indexOf(u8, redacted, "4111 1111 1111 1111") == null);
}

test "HTML sanitization prevents XSS" {
    const input = "<script>alert('xss')</script>";
    var out: [256]u8 = undefined;
    const len = sanitizeHtml(input, &out);
    const sanitized = out[0..len];
    try std.testing.expect(std.mem.indexOf(u8, sanitized, "<script>") == null);
    try std.testing.expect(std.mem.indexOf(u8, sanitized, "&lt;script&gt;") != null);
}
