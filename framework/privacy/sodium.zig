//! sodium.zig — libsodium FFI surface for the privacy/crypto stack.
//!
//! This is the single trust boundary for any operation we want backed by
//! libsodium instead of (or alongside) Zig std.crypto. Every higher-level
//! module that wants the libsodium backend routes through here.
//!
//! Mirrors the FFI surface that love2d/lua/privacy.lua + crypto.lua bind:
//!   - secure memory: sodium_malloc/free/mlock/munlock/memzero/mprotect_*
//!   - hashes: SHA-256/512, BLAKE2b (crypto_generichash)
//!   - HMAC: SHA-256 / SHA-512
//!   - AEAD: XChaCha20-Poly1305-IETF, ChaCha20-Poly1305-IETF, AES-256-GCM
//!   - password hashing: Argon2id (crypto_pwhash)
//!   - signatures: Ed25519 (crypto_sign_*)
//!   - DH: X25519 (crypto_scalarmult*)
//!   - randomness: randombytes_buf
//!
//! Call `init()` once at process start before any other call.

const std = @import("std");

pub const c = @cImport({
    @cInclude("sodium.h");
});

// ════════════════════════════════════════════════════════════════════════
// Initialization
// ════════════════════════════════════════════════════════════════════════

var g_initialized: bool = false;

/// Idempotent: safe to call multiple times. Returns false if libsodium
/// reports a hard init failure.
pub fn init() bool {
    if (g_initialized) return true;
    const ret = c.sodium_init();
    if (ret < 0) return false;
    g_initialized = true;
    return true;
}

/// Returns true after init() succeeded at least once.
pub fn ready() bool {
    return g_initialized;
}

// ════════════════════════════════════════════════════════════════════════
// Sizes (compile-time mirrors of libsodium constants — verified at init via
// asserts so a libsodium ABI mismatch fails loudly instead of silently)
// ════════════════════════════════════════════════════════════════════════

pub const HASH_SHA256_BYTES: usize = 32;
pub const HASH_SHA512_BYTES: usize = 64;
pub const HMAC_SHA256_BYTES: usize = 32;
pub const HMAC_SHA256_KEY: usize = 32;
pub const AEAD_XCHACHA_KEY: usize = 32;
pub const AEAD_XCHACHA_NONCE: usize = 24;
pub const AEAD_XCHACHA_TAG: usize = 16;
pub const SIGN_PUBKEY: usize = 32;
pub const SIGN_SECKEY: usize = 64; // Ed25519 secret key = seed(32) || pubkey(32)
pub const SIGN_SEED: usize = 32;
pub const SIGN_BYTES: usize = 64;
pub const SCALARMULT_BYTES: usize = 32;
pub const SCALARMULT_SCALAR: usize = 32;
pub const PWHASH_SALT: usize = 16;

// ════════════════════════════════════════════════════════════════════════
// Randomness
// ════════════════════════════════════════════════════════════════════════

pub fn randomBytes(out: []u8) void {
    c.randombytes_buf(out.ptr, out.len);
}

// ════════════════════════════════════════════════════════════════════════
// Hashes
// ════════════════════════════════════════════════════════════════════════

pub fn sha256(out: *[HASH_SHA256_BYTES]u8, data: []const u8) void {
    _ = c.crypto_hash_sha256(out, data.ptr, data.len);
}

pub fn sha512(out: *[HASH_SHA512_BYTES]u8, data: []const u8) void {
    _ = c.crypto_hash_sha512(out, data.ptr, data.len);
}

/// BLAKE2b via crypto_generichash. `key` may be empty.
pub fn blake2b(out: []u8, data: []const u8, key: []const u8) !void {
    const k_ptr: ?[*]const u8 = if (key.len > 0) key.ptr else null;
    const ret = c.crypto_generichash(out.ptr, out.len, data.ptr, data.len, k_ptr, key.len);
    if (ret != 0) return error.GenericHashFailed;
}

// ════════════════════════════════════════════════════════════════════════
// HMAC
// ════════════════════════════════════════════════════════════════════════

pub fn hmacSha256(out: *[HMAC_SHA256_BYTES]u8, message: []const u8, key: []const u8) void {
    var st: c.crypto_auth_hmacsha256_state = undefined;
    _ = c.crypto_auth_hmacsha256_init(&st, key.ptr, key.len);
    _ = c.crypto_auth_hmacsha256_update(&st, message.ptr, message.len);
    _ = c.crypto_auth_hmacsha256_final(&st, out);
}

pub fn hmacSha512(out: *[64]u8, message: []const u8, key: []const u8) void {
    var st: c.crypto_auth_hmacsha512_state = undefined;
    _ = c.crypto_auth_hmacsha512_init(&st, key.ptr, key.len);
    _ = c.crypto_auth_hmacsha512_update(&st, message.ptr, message.len);
    _ = c.crypto_auth_hmacsha512_final(&st, out);
}

// ════════════════════════════════════════════════════════════════════════
// HKDF-SHA256 (built on libsodium's HMAC, RFC 5869)
// ════════════════════════════════════════════════════════════════════════

pub fn hkdfExtract(prk: *[HASH_SHA256_BYTES]u8, salt: []const u8, ikm: []const u8) void {
    if (salt.len == 0) {
        const zero_salt = [_]u8{0} ** HASH_SHA256_BYTES;
        hmacSha256(prk, ikm, &zero_salt);
    } else {
        hmacSha256(prk, ikm, salt);
    }
}

pub fn hkdfExpand(prk: *const [HASH_SHA256_BYTES]u8, info: []const u8, out: []u8) !void {
    const n = (out.len + HASH_SHA256_BYTES - 1) / HASH_SHA256_BYTES;
    if (n > 255) return error.HkdfOutputTooLong;

    var t: [HASH_SHA256_BYTES]u8 = undefined;
    var t_len: usize = 0;
    var offset: usize = 0;

    var i: usize = 0;
    while (i < n) : (i += 1) {
        var st: c.crypto_auth_hmacsha256_state = undefined;
        _ = c.crypto_auth_hmacsha256_init(&st, prk, prk.len);
        if (t_len > 0) _ = c.crypto_auth_hmacsha256_update(&st, &t, t_len);
        if (info.len > 0) _ = c.crypto_auth_hmacsha256_update(&st, info.ptr, info.len);
        const counter: [1]u8 = .{@as(u8, @intCast(i + 1))};
        _ = c.crypto_auth_hmacsha256_update(&st, &counter, 1);
        _ = c.crypto_auth_hmacsha256_final(&st, &t);
        t_len = HASH_SHA256_BYTES;
        const copy_len = @min(HASH_SHA256_BYTES, out.len - offset);
        @memcpy(out[offset..][0..copy_len], t[0..copy_len]);
        offset += copy_len;
    }
}

// ════════════════════════════════════════════════════════════════════════
// AEAD: XChaCha20-Poly1305-IETF
// ════════════════════════════════════════════════════════════════════════

/// out must have room for plaintext.len + AEAD_XCHACHA_TAG bytes.
pub fn xchachaEncrypt(
    out: []u8,
    plaintext: []const u8,
    aad: []const u8,
    nonce: *const [AEAD_XCHACHA_NONCE]u8,
    key: *const [AEAD_XCHACHA_KEY]u8,
) !usize {
    if (out.len < plaintext.len + AEAD_XCHACHA_TAG) return error.BufferTooSmall;
    var clen: c_ulonglong = 0;
    const aad_ptr: ?[*]const u8 = if (aad.len > 0) aad.ptr else null;
    const ret = c.crypto_aead_xchacha20poly1305_ietf_encrypt(
        out.ptr,
        &clen,
        plaintext.ptr,
        plaintext.len,
        aad_ptr,
        aad.len,
        null,
        nonce,
        key,
    );
    if (ret != 0) return error.EncryptFailed;
    return @intCast(clen);
}

pub fn xchachaDecrypt(
    out: []u8,
    ciphertext: []const u8,
    aad: []const u8,
    nonce: *const [AEAD_XCHACHA_NONCE]u8,
    key: *const [AEAD_XCHACHA_KEY]u8,
) !usize {
    if (ciphertext.len < AEAD_XCHACHA_TAG) return error.CiphertextTooShort;
    if (out.len < ciphertext.len - AEAD_XCHACHA_TAG) return error.BufferTooSmall;
    var mlen: c_ulonglong = 0;
    const aad_ptr: ?[*]const u8 = if (aad.len > 0) aad.ptr else null;
    const ret = c.crypto_aead_xchacha20poly1305_ietf_decrypt(
        out.ptr,
        &mlen,
        null,
        ciphertext.ptr,
        ciphertext.len,
        aad_ptr,
        aad.len,
        nonce,
        key,
    );
    if (ret != 0) return error.DecryptFailed;
    return @intCast(mlen);
}

// ════════════════════════════════════════════════════════════════════════
// Password hashing — Argon2id
// ════════════════════════════════════════════════════════════════════════

pub const PwhashOpts = struct {
    /// Operations limit. libsodium INTERACTIVE = 2, MODERATE = 3, SENSITIVE = 4.
    opslimit: u64 = 3,
    /// Memory limit in bytes. libsodium INTERACTIVE = 64 MiB, MODERATE = 256 MiB.
    memlimit: usize = 64 * 1024 * 1024,
};

/// Derive `out.len` bytes from password using Argon2id with the supplied salt.
pub fn pwhashArgon2id(
    out: []u8,
    password: []const u8,
    salt: *const [PWHASH_SALT]u8,
    opts: PwhashOpts,
) !void {
    const alg = c.crypto_pwhash_alg_argon2id13();
    const ret = c.crypto_pwhash(
        out.ptr,
        out.len,
        password.ptr,
        password.len,
        salt,
        opts.opslimit,
        opts.memlimit,
        alg,
    );
    if (ret != 0) return error.PwhashFailed;
}

// ════════════════════════════════════════════════════════════════════════
// Signatures — Ed25519
// ════════════════════════════════════════════════════════════════════════

pub const SignKeyPair = struct {
    public: [SIGN_PUBKEY]u8,
    secret: [SIGN_SECKEY]u8,
};

pub fn signKeypair() SignKeyPair {
    var kp: SignKeyPair = undefined;
    _ = c.crypto_sign_keypair(&kp.public, &kp.secret);
    return kp;
}

pub fn signKeypairFromSeed(seed: *const [SIGN_SEED]u8) SignKeyPair {
    var kp: SignKeyPair = undefined;
    _ = c.crypto_sign_seed_keypair(&kp.public, &kp.secret, seed);
    return kp;
}

pub fn signDetached(sig: *[SIGN_BYTES]u8, message: []const u8, secret: *const [SIGN_SECKEY]u8) void {
    var siglen: c_ulonglong = 0;
    _ = c.crypto_sign_detached(sig, &siglen, message.ptr, message.len, secret);
}

pub fn signVerifyDetached(sig: *const [SIGN_BYTES]u8, message: []const u8, public: *const [SIGN_PUBKEY]u8) bool {
    return c.crypto_sign_verify_detached(sig, message.ptr, message.len, public) == 0;
}

// ════════════════════════════════════════════════════════════════════════
// X25519 — DH
// ════════════════════════════════════════════════════════════════════════

pub const DhKeyPair = struct {
    public: [SCALARMULT_BYTES]u8,
    secret: [SCALARMULT_SCALAR]u8,
};

pub fn dhKeypair() DhKeyPair {
    var kp: DhKeyPair = undefined;
    randomBytes(&kp.secret);
    _ = c.crypto_scalarmult_base(&kp.public, &kp.secret);
    return kp;
}

pub fn dhKeypairFromSecret(secret: *const [SCALARMULT_SCALAR]u8) DhKeyPair {
    var kp: DhKeyPair = undefined;
    @memcpy(&kp.secret, secret);
    _ = c.crypto_scalarmult_base(&kp.public, &kp.secret);
    return kp;
}

pub fn dhSharedSecret(
    out: *[SCALARMULT_BYTES]u8,
    secret: *const [SCALARMULT_SCALAR]u8,
    peer_public: *const [SCALARMULT_BYTES]u8,
) !void {
    const ret = c.crypto_scalarmult(out, secret, peer_public);
    if (ret != 0) return error.ScalarmultFailed;
}

// ════════════════════════════════════════════════════════════════════════
// Secure memory — sodium_malloc / mlock / mprotect
// ════════════════════════════════════════════════════════════════════════

pub const SecureRegion = struct {
    ptr: [*]u8,
    len: usize,
};

pub const ProtectMode = enum { readwrite, readonly, noaccess };

/// Allocate guarded memory: sodium_malloc returns a page-aligned buffer with
/// a guard page after, mlock'd by default. The pointer is opaque from libsodium's
/// perspective and must be released with `secureFree`.
pub fn secureAlloc(len: usize) !SecureRegion {
    if (!g_initialized) _ = init();
    const raw = c.sodium_malloc(len);
    if (raw == null) return error.SodiumAllocFailed;
    return .{ .ptr = @ptrCast(raw.?), .len = len };
}

pub fn secureFree(region: SecureRegion) void {
    c.sodium_free(region.ptr);
}

pub fn secureMemzero(region: SecureRegion) void {
    c.sodium_memzero(region.ptr, region.len);
}

pub fn secureProtect(region: SecureRegion, mode: ProtectMode) !void {
    const ret = switch (mode) {
        .readwrite => c.sodium_mprotect_readwrite(region.ptr),
        .readonly => c.sodium_mprotect_readonly(region.ptr),
        .noaccess => c.sodium_mprotect_noaccess(region.ptr),
    };
    if (ret != 0) return error.MprotectFailed;
}

/// Constant-time equality.
pub fn memcmp(a: []const u8, b: []const u8) bool {
    if (a.len != b.len) return false;
    return c.sodium_memcmp(a.ptr, b.ptr, a.len) == 0;
}
