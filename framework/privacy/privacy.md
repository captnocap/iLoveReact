# framework/privacy

Privacy / cryptographic-vault subsystem. Higher-level primitives sit on top of
two backends: Zig std.crypto (always available) and libsodium (linked only
when `-Dhas-privacy=true`).

When a cart's source code doesn't import `usePrivacy`, this directory doesn't
compile, libsodium isn't linked, and the `__priv_*` host functions don't
register. Same shape as `framework/terminal/`, `framework/videos.zig`, etc.

## Pipeline

```
JS hook (usePrivacy)
   │
   ▼
v8_bindings_privacy.zig          (host-fn surface, base64 + JSON wire)
   │
   ├─► privacy.zig               (mlock, secureZero, dir hashing — std)
   ├─► keyring.zig               (encrypted on-disk keyring, sodium)
   └─► sodium.zig                (libsodium FFI — single trust boundary)
        │
        └─► libsodium             (linked iff -Dhas-privacy)

(plus an unconditional ../crypto.zig dep for HMAC / HKDF / hex codec —
 those are framework-general primitives, not privacy-feature-only)
```

## Files

| File | Role |
|---|---|
| `privacy.zig` | High-level privacy ops: secure memory (`mlock` + `secureZero`), file/directory integrity hashing (SHA-256). Uses Zig std.crypto only — no external deps. |
| `sodium.zig` | The libsodium FFI surface. Single trust boundary for sodium-backed ops: secure memory, secretbox, KX, signing. Every higher-level module that wants the libsodium backend routes through here. |
| `keyring.zig` | Encrypted on-disk keyring. Argon2id(password) → KEK → XChaCha20-Poly1305 wraps the entry list; each Ed25519/X25519 secret key is additionally wrapped under the same password (independent salt+nonce). Double encryption at rest. |
| `v8_bindings_privacy.zig` | V8 host bindings, drives `runtime/hooks/usePrivacy.ts`. Bytes cross the bridge as base64; compound returns as JSON; backend selection (`std` vs `sodium`) is a string arg where applicable. |

## Where `crypto.zig` lives

**`framework/crypto.zig` does NOT live in this directory.** It's general-purpose
Zig-std crypto (HMAC-SHA256, HKDF-SHA256, hex codec, ed25519 keypair) used
across the framework — debug pairing handshake, future protocol auth, etc. —
not privacy-feature-only. Treat it like `framework/log.zig` or
`framework/math.zig`: a peer utility module imported as `../crypto.zig`
from inside this folder.

## Feature gate

`sdk/dependency-registry.json`:

```json
"privacy": {
  "shipGate": "privacy",
  "triggers": [
    { "kind": "metafileInput", "input": "runtime/hooks/usePrivacy.ts" }
  ],
  "buildOptions": ["privacy"],
  "nativeLibraries": ["libsodium"]
}
```

`v8_app.zig` registers the binding only when `build_options.has_privacy`:

```zig
const v8_bindings_privacy = if (build_options.has_privacy)
    @import("framework/v8_bindings_privacy.zig")
else struct {
    pub fn registerPrivacy(_: anytype) void {}
    pub fn tickDrain() void {}
};
```

When the flag is off, the binding's host fns aren't registered, the
imports never resolve to real files, and `libsodium` isn't linked. No
inline empty-struct gates were needed elsewhere in the framework — the
cluster is self-contained behind the binding boundary.

## Don'ts

- **Don't import `sodium.zig` from outside this directory.** It's the trust
  boundary; only `privacy.zig` / `keyring.zig` / `v8_bindings_privacy.zig`
  should reach `extern "sodium"`. Outside callers should go through
  `privacy.zig` or the JS hook.
- **Don't merge `crypto.zig` into this directory.** Doing so would force a
  privacy-feature dependency on `debug_server.zig` and `engine.zig`'s
  comptime crypto-test export, neither of which is privacy-related.
- **Don't bypass the keyring's per-entry wrap** when storing private keys.
  The double encryption is what keeps secret keys protected if the file
  master KEK leaks separately from the password.
