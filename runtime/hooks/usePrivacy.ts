/**
 * usePrivacy — one hook, many privacy "kinds". Backed by framework/privacy.zig
 * + framework/keyring.zig + libsodium FFI through framework/sodium.zig.
 *
 *   const p = usePrivacy();                    // default backend = 'sodium'
 *   const p = usePrivacy({ backend: 'std' });  // pin to std.crypto
 *   p.hash.sha256(data);
 *   p.aead.xchachaEncrypt(pt, key, nonce);
 *   p.gpg.sign(message);
 *   p.keyring.open(path, password);
 *   p.noise.initiate(remotePub);
 *
 * Backend selection
 *   Several primitives have two implementations side-by-side:
 *     - 'std'    — Zig stdlib (std.crypto)
 *     - 'sodium' — libsodium via C FFI (the same lib privacy.lua used)
 *   The default is whichever you set on the hook; per-call override is also
 *   accepted as `{ backend: ... }`. libsodium-only operations (real secure
 *   memory, Argon2 keyring KEK) ignore this — they're sodium-or-nothing.
 *
 * Encoding
 *   Bytes cross the FFI boundary as base64 (matches runtime/hooks/crypto.ts).
 *   The hook converts to/from Uint8Array on the JS side.
 */

import { callHost, callHostJson } from '../ffi';

// ── Types ──────────────────────────────────────────────────────────

export type Backend = 'std' | 'sodium';

export interface PrivacyOptions {
  /** Default backend for primitives that have both. Defaults to 'sodium'. */
  backend?: Backend;
}

export interface CallOpts {
  /** Per-call backend override. */
  backend?: Backend;
}

export interface ManifestEntry { path: string; hash: string; }
export interface Manifest { version: number; entries: ManifestEntry[]; }
export interface VerifyResult { ok: boolean; missing: string[]; mismatched: string[]; }

export type KeyType = 'ed25519' | 'x25519';

export interface KeyringEntryView {
  id: string;             // 16-byte hex id
  type: KeyType;
  publicKey: string;      // 32-byte hex
  label?: string;
  created: number;
  expires?: number;
  revoked?: number;
  rotatedTo?: string;
}

export interface GenerateKeyOpts {
  type?: KeyType;
  label?: string;
  expiresIn?: number; // seconds
}

export interface IsolatedCredential {
  domain: string;
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  keyId: string; // hex
}

export interface NoiseInitiateResult {
  sessionId: number;
  message: Uint8Array; // wire bytes the responder needs
}

export type SecureBufferMode = 'readwrite' | 'readonly' | 'noaccess';

// ── byte ↔ base64 helpers ──────────────────────────────────────────

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function asBytes(x: Uint8Array | string): Uint8Array {
  if (typeof x !== 'string') return x;
  const out = new Uint8Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x.charCodeAt(i) & 0xff;
  return out;
}
const EMPTY = new Uint8Array(0);

// ── Hook ───────────────────────────────────────────────────────────

export function usePrivacy(opts: PrivacyOptions = {}): PrivacyAPI {
  const defaultBackend: Backend = opts.backend ?? 'sodium';
  const pickBackend = (call?: CallOpts): Backend => call?.backend ?? defaultBackend;

  // ── Backend-selectable primitives ────────────────────────────────

  const hash = {
    sha256(data: Uint8Array | string, call?: CallOpts): Uint8Array {
      const out = callHost<string>('__priv_sha256', '', pickBackend(call), b64encode(asBytes(data)));
      return out ? b64decode(out) : EMPTY;
    },
    file(path: string): string {
      return callHost<string>('__priv_hash_file', '', path);
    },
    directory(path: string, recursive: boolean = false): Manifest | null {
      return callHostJson<Manifest | null>('__priv_hash_directory', null, path, recursive);
    },
    verify(manifest: Manifest): VerifyResult | null {
      return callHostJson<VerifyResult | null>('__priv_verify_manifest', null, JSON.stringify(manifest));
    },
  };

  const hmac = {
    sha256(key: Uint8Array | string, message: Uint8Array | string, call?: CallOpts): Uint8Array {
      const out = callHost<string>('__priv_hmac_sha256', '',
        pickBackend(call), b64encode(asBytes(key)), b64encode(asBytes(message)));
      return out ? b64decode(out) : EMPTY;
    },
  };

  const hkdf = {
    derive(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number, call?: CallOpts): Uint8Array {
      const out = callHost<string>('__priv_hkdf_sha256', '',
        pickBackend(call), b64encode(ikm), b64encode(salt), b64encode(info), length);
      return out ? b64decode(out) : EMPTY;
    },
  };

  const aead = {
    xchachaEncrypt(plaintext: Uint8Array, key: Uint8Array, nonce: Uint8Array, aad?: Uint8Array, call?: CallOpts): Uint8Array {
      const out = callHost<string>('__priv_xchacha_encrypt', '',
        pickBackend(call), b64encode(plaintext), b64encode(key), b64encode(nonce), b64encode(aad ?? EMPTY));
      return out ? b64decode(out) : EMPTY;
    },
    xchachaDecrypt(ciphertext: Uint8Array, key: Uint8Array, nonce: Uint8Array, aad?: Uint8Array, call?: CallOpts): Uint8Array | null {
      const out = callHost<string>('__priv_xchacha_decrypt', '',
        pickBackend(call), b64encode(ciphertext), b64encode(key), b64encode(nonce), b64encode(aad ?? EMPTY));
      return out ? b64decode(out) : null;
    },
  };

  const random = {
    bytes(n: number, call?: CallOpts): Uint8Array {
      const out = callHost<string>('__priv_random_bytes', '', pickBackend(call), n);
      return out ? b64decode(out) : EMPTY;
    },
  };

  // ── Secure memory (libsodium-only) ───────────────────────────────

  const secureBuffer = {
    alloc(hex: string): number {
      return callHost<number>('__priv_secbuf_alloc', 0, hex);
    },
    read(handle: number): string {
      return callHost<string>('__priv_secbuf_read', '', handle);
    },
    free(handle: number): void {
      callHost<void>('__priv_secbuf_free', undefined, handle);
    },
    protect(handle: number, mode: SecureBufferMode): void {
      callHost<void>('__priv_secbuf_protect', undefined, handle, mode);
    },
  };

  // ── File AEAD + secure delete ────────────────────────────────────

  const encrypt = {
    file(inputPath: string, outputPath: string, key: Uint8Array): boolean {
      return callHost<boolean>('__priv_encrypt_file', false, inputPath, outputPath, b64encode(key));
    },
    decryptFile(inputPath: string, outputPath: string, key: Uint8Array): boolean {
      return callHost<boolean>('__priv_decrypt_file', false, inputPath, outputPath, b64encode(key));
    },
  };

  const del = {
    secure(path: string, passes: number = 3): boolean {
      return callHost<boolean>('__priv_secure_delete', false, path, passes);
    },
  };

  // ── Steg + tokenize ──────────────────────────────────────────────

  const steg = {
    embed(carrier: string, secret: Uint8Array): string {
      return callHost<string>('__priv_steg_embed', '', carrier, b64encode(secret));
    },
    extract(encoded: string): Uint8Array {
      const out = callHost<string>('__priv_steg_extract', '', encoded);
      return out ? b64decode(out) : EMPTY;
    },
  };

  const tokenize = (value: string, salt: string): string => {
    return callHost<string>('__priv_tokenize', '', value, salt);
  };

  // ── GPG ──────────────────────────────────────────────────────────

  const gpg = {
    encrypt(plaintext: string, recipient: string): string {
      return callHost<string>('__priv_gpg_encrypt', '', plaintext, recipient);
    },
    decrypt(ciphertext: string): string {
      return callHost<string>('__priv_gpg_decrypt', '', ciphertext);
    },
    sign(message: string): string {
      return callHost<string>('__priv_gpg_sign', '', message);
    },
    verify(signedMessage: string): boolean {
      return callHost<boolean>('__priv_gpg_verify', false, signedMessage);
    },
    listKeys(): string {
      return callHost<string>('__priv_gpg_list_keys', '');
    },
    import(armoredKey: string): string {
      return callHost<string>('__priv_gpg_import', '', armoredKey);
    },
    export(keyId: string): string {
      return callHost<string>('__priv_gpg_export', '', keyId);
    },
  };

  // ── File metadata ────────────────────────────────────────────────

  const meta = {
    strip(path: string): boolean {
      return callHost<boolean>('__priv_meta_strip', false, path);
    },
    read(path: string): string {
      return callHost<string>('__priv_meta_read', '', path);
    },
  };

  // ── Identity ─────────────────────────────────────────────────────

  const identity = {
    anonymousId(domain: string, seed: Uint8Array, call?: CallOpts): Uint8Array {
      const out = callHost<string>('__priv_anonymous_id', '',
        pickBackend(call), domain, b64encode(seed));
      return out ? b64decode(out) : EMPTY;
    },
    pseudonym(masterSecret: Uint8Array, context: string, call?: CallOpts): Uint8Array {
      const out = callHost<string>('__priv_pseudonym', '',
        pickBackend(call), b64encode(masterSecret), context);
      return out ? b64decode(out) : EMPTY;
    },
    isolatedCredential(domain: string): IsolatedCredential | null {
      const json = callHost<string>('__priv_isolated_credential', '', domain);
      if (!json) return null;
      try {
        const o = JSON.parse(json);
        return {
          domain: o.domain,
          publicKey: b64decode(o.publicKey),
          secretKey: b64decode(o.secretKey),
          keyId: o.keyId,
        };
      } catch {
        return null;
      }
    },
  };

  // ── Noise sessions ───────────────────────────────────────────────

  const noise = {
    initiate(remotePublicKey: Uint8Array): NoiseInitiateResult | null {
      const json = callHost<string>('__priv_noise_initiate', '', b64encode(remotePublicKey));
      if (!json) return null;
      try {
        const o = JSON.parse(json);
        return { sessionId: o.sessionId, message: b64decode(o.message) };
      } catch {
        return null;
      }
    },
    respond(staticPrivate: Uint8Array, message: Uint8Array): number {
      return callHost<number>('__priv_noise_respond', 0,
        b64encode(staticPrivate), b64encode(message));
    },
    send(sessionId: number, plaintext: Uint8Array): Uint8Array {
      const out = callHost<string>('__priv_noise_send', '', sessionId, b64encode(plaintext));
      return out ? b64decode(out) : EMPTY;
    },
    receive(sessionId: number, ciphertext: Uint8Array): Uint8Array | null {
      const out = callHost<string>('__priv_noise_receive', '', sessionId, b64encode(ciphertext));
      return out ? b64decode(out) : null;
    },
    close(sessionId: number): void {
      callHost<void>('__priv_noise_close', undefined, sessionId);
    },
  };

  // ── Keyring ──────────────────────────────────────────────────────

  const keyring = {
    create(path: string, masterPassword: string): number {
      return callHost<number>('__priv_keyring_create', 0, path, masterPassword);
    },
    open(path: string, masterPassword: string): number {
      return callHost<number>('__priv_keyring_open', 0, path, masterPassword);
    },
    close(handle: number): void {
      callHost<void>('__priv_keyring_close', undefined, handle);
    },
    generate(handle: number, opts: GenerateKeyOpts = {}): string {
      return callHost<string>('__priv_keyring_generate', '', handle, JSON.stringify(opts));
    },
    list(handle: number): KeyringEntryView[] {
      return callHostJson<KeyringEntryView[]>('__priv_keyring_list', [], handle);
    },
    get(handle: number, keyId: string): KeyringEntryView | null {
      return callHostJson<KeyringEntryView | null>('__priv_keyring_get', null, handle, keyId);
    },
    rotate(handle: number, keyId: string): string {
      return callHost<string>('__priv_keyring_rotate', '', handle, keyId);
    },
    revoke(handle: number, keyId: string, reason: string): boolean {
      return callHost<boolean>('__priv_keyring_revoke', false, handle, keyId, reason);
    },
    export(handle: number, keyId: string): Uint8Array {
      const out = callHost<string>('__priv_keyring_export', '', handle, keyId);
      return out ? b64decode(out) : EMPTY;
    },
  };

  // ── PII + sanitize ───────────────────────────────────────────────

  const pii = {
    detect(text: string): { type: string; start: number; end: number }[] {
      return callHostJson<{ type: string; start: number; end: number }[]>('__priv_pii_detect', [], text);
    },
    redact(text: string): string {
      return callHost<string>('__priv_pii_redact', '', text);
    },
  };

  const sanitize = {
    html(text: string): string {
      return callHost<string>('__priv_sanitize_html', '', text);
    },
  };

  // ── Shamir secret sharing ────────────────────────────────────────

  const shamir = {
    split(secret: Uint8Array, n: number, k: number): Array<{ index: number; data: Uint8Array }> {
      const json = callHost<string>('__priv_shamir_split', '[]', b64encode(secret), n, k);
      try {
        const arr = JSON.parse(json) as Array<{ index: number; data: string }>;
        return arr.map((s) => ({ index: s.index, data: b64decode(s.data) }));
      } catch { return []; }
    },
    combine(shares: Array<{ index: number; data: Uint8Array }>): Uint8Array {
      const wire = shares.map((s) => ({ index: s.index, data: b64encode(s.data) }));
      const out = callHost<string>('__priv_shamir_combine', '', JSON.stringify(wire));
      return out ? b64decode(out) : EMPTY;
    },
  };

  // ── Envelope encryption (DEK wrapped by KEK) ─────────────────────

  interface EnvelopeWire {
    encryptedDEK: string;
    dekNonce: string;
    ciphertext: string;
    dataNonce: string;
    algorithm: string;
  }
  interface Envelope {
    encryptedDEK: Uint8Array;
    dekNonce: Uint8Array;
    ciphertext: Uint8Array;
    dataNonce: Uint8Array;
    algorithm: string;
  }
  const envelope = {
    encrypt(data: Uint8Array, kek: Uint8Array): Envelope | null {
      const json = callHost<string>('__priv_envelope_encrypt', '', b64encode(data), b64encode(kek));
      if (!json) return null;
      try {
        const w = JSON.parse(json) as EnvelopeWire;
        return {
          encryptedDEK: b64decode(w.encryptedDEK),
          dekNonce: b64decode(w.dekNonce),
          ciphertext: b64decode(w.ciphertext),
          dataNonce: b64decode(w.dataNonce),
          algorithm: w.algorithm,
        };
      } catch { return null; }
    },
    decrypt(env: Envelope, kek: Uint8Array): Uint8Array | null {
      const wire: EnvelopeWire = {
        encryptedDEK: b64encode(env.encryptedDEK),
        dekNonce: b64encode(env.dekNonce),
        ciphertext: b64encode(env.ciphertext),
        dataNonce: b64encode(env.dataNonce),
        algorithm: env.algorithm,
      };
      const out = callHost<string>('__priv_envelope_decrypt', '', JSON.stringify(wire), b64encode(kek));
      return out ? b64decode(out) : null;
    },
  };

  // ── Image steg (raw RGBA in / out) ───────────────────────────────

  const stegImage = {
    /** Embed `data` into `rgba` (W*H*4 LSB-stuff). Returns the modified RGBA. */
    embed(rgba: Uint8Array, data: Uint8Array): Uint8Array {
      const out = callHost<string>('__priv_steg_image_embed', '', b64encode(rgba), b64encode(data));
      return out ? b64decode(out) : EMPTY;
    },
    extract(rgba: Uint8Array): Uint8Array {
      const out = callHost<string>('__priv_steg_image_extract', '', b64encode(rgba));
      return out ? b64decode(out) : EMPTY;
    },
  };

  // ── Audit log ────────────────────────────────────────────────────

  interface AuditEntry {
    index: number;
    timestamp: number;
    event: string;
    data: unknown;
    hash: string;
    prevHash: string;
  }
  const audit = {
    create(chainKeyHex: string): boolean {
      return callHost<boolean>('__priv_audit_create', false, chainKeyHex);
    },
    append(event: string, data: unknown): AuditEntry | null {
      return callHostJson<AuditEntry | null>('__priv_audit_append', null, event, JSON.stringify(data ?? null));
    },
    verify(): { valid: boolean; entries: number; brokenAt: number } {
      return callHostJson<{ valid: boolean; entries: number; brokenAt: number }>(
        '__priv_audit_verify', { valid: false, entries: 0, brokenAt: -1 },
      );
    },
    entries(from: number = 0, to: number = 0x7fffffff): AuditEntry[] {
      return callHostJson<AuditEntry[]>('__priv_audit_entries', [], from, to);
    },
  };

  // ── Policy / consent / right-to-erasure ──────────────────────────

  const policy = {
    setRetention(category: string, opts: Record<string, unknown>): boolean {
      return callHost<boolean>('__priv_policy_set_retention', false, category, JSON.stringify(opts));
    },
    recordConsent(userId: string, purpose: string, granted: boolean): boolean {
      return callHost<boolean>('__priv_policy_record_consent', false, userId, purpose, granted);
    },
    checkConsent(userId: string, purpose: string): boolean {
      return callHost<boolean>('__priv_policy_check_consent', false, userId, purpose);
    },
    revokeConsent(userId: string, purpose?: string): boolean {
      return purpose
        ? callHost<boolean>('__priv_policy_revoke_consent', false, userId, purpose)
        : callHost<boolean>('__priv_policy_revoke_consent', false, userId);
    },
    rightToErasure(userId: string): { recordsFound: number; recordsDeleted: number } {
      return callHostJson<{ recordsFound: number; recordsDeleted: number }>(
        '__priv_policy_erasure', { recordsFound: 0, recordsDeleted: 0 }, userId,
      );
    },
  };

  // ── Algorithm strength ───────────────────────────────────────────

  const algorithm = {
    check(name: string): { strength: 'strong' | 'acceptable' | 'weak' | 'broken'; deprecated: boolean; recommendation: string } {
      return callHostJson<{ strength: 'strong' | 'acceptable' | 'weak' | 'broken'; deprecated: boolean; recommendation: string }>(
        '__priv_check_algorithm', { strength: 'weak', deprecated: false, recommendation: '' }, name,
      );
    },
    /** Pure-JS config validator; mirrors love2d/lua/privacy.lua:Privacy.validateConfig. */
    validateConfig(config: Record<string, unknown> | null): { valid: boolean; errors: string[]; warnings: string[] } {
      if (!config || typeof config !== 'object') {
        return { valid: false, errors: ['Config must be a non-null object'], warnings: [] };
      }
      const errors: string[] = [];
      const warnings: string[] = [];
      const algo = config.algorithm;
      if (typeof algo === 'string') {
        const a = algorithm.check(algo);
        if (a.strength === 'broken') errors.push(`Algorithm "${algo}" is broken and must not be used.`);
        else if (a.strength === 'weak') warnings.push(`Algorithm "${algo}" is weak. Consider upgrading.`);
      }
      const num = (k: string): number | undefined =>
        typeof config[k] === 'number' ? (config[k] as number) : undefined;
      const ks = num('keySize');
      if (ks !== undefined) {
        if (ks < 16) errors.push(`Key size must be at least 16 bytes. Got ${ks}.`);
        else if (ks < 32) warnings.push(`Key size ${ks} is below recommended 32 bytes.`);
      }
      const ns = num('nonceSize');
      if (ns !== undefined && ns < 8) errors.push(`Nonce size must be at least 8 bytes. Got ${ns}.`);
      const ss = num('saltSize');
      if (ss !== undefined) {
        if (ss < 8) errors.push(`Salt size must be at least 8 bytes. Got ${ss}.`);
        else if (ss < 16) warnings.push(`Salt size ${ss} is below recommended 16 bytes.`);
      }
      const iter = num('iterations') ?? num('pbkdf2Iterations');
      if (iter !== undefined) {
        if (iter < 10000) errors.push(`Iterations must be at least 10000. Got ${iter}.`);
        else if (iter < 100000) warnings.push(`Iterations ${iter} is below recommended 100000.`);
      }
      const ops = num('argon2Ops');
      if (ops !== undefined && ops < 1) errors.push(`argon2Ops must be at least 1. Got ${ops}.`);
      const mem = num('argon2Mem');
      if (mem !== undefined && mem < 8192) errors.push(`argon2Mem must be at least 8192 bytes. Got ${mem}.`);
      const sn = num('scryptN');
      if (sn !== undefined && sn < 1024) errors.push(`scryptN must be at least 1024. Got ${sn}.`);
      return { valid: errors.length === 0, errors, warnings };
    },
  };

  // ── Filename / timestamp ─────────────────────────────────────────

  const filename = {
    sanitize(name: string): string {
      return callHost<string>('__priv_sanitize_filename', '', name);
    },
  };
  const timestamp = {
    normalize(ts: string): string {
      return callHost<string>('__priv_normalize_timestamp', '', ts);
    },
  };

  return {
    backend: defaultBackend,
    hash, hmac, hkdf, aead, random,
    secureBuffer,
    encrypt, delete: del,
    steg, tokenize,
    gpg, meta,
    identity, noise, keyring,
    pii, sanitize,
    shamir, envelope, stegImage,
    audit, policy, algorithm,
    filename, timestamp,
  };
}

// ── Non-hook alias ─────────────────────────────────────────────────
//
// `usePrivacy` is a pure builder — no `useState`/`useEffect`/`useRef` —
// so it's safe to call from non-React contexts (service modules, batch
// scripts, error paths). Use `privacyOps` there to avoid React's
// rules-of-hooks lint warnings on the `use*` name.

export const privacyOps = usePrivacy;

// ── Inferred surface type (exported for app type-checking) ─────────

export type PrivacyAPI = ReturnType<typeof makeStub>;

// `makeStub` is only used for type inference, never executed at runtime.
function makeStub() {
  return usePrivacy();
}
