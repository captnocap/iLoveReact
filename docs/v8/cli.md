# V8 CLI, Ship, and SDK Payload

Last updated: 2026-04-26.

This document describes the V8-only CLI and build path used to scaffold, develop,
and ship ReactJIT carts without reaching for Node or Bun.

## Goals

- `scripts/ship` must build shippable carts through the local V8 tooling path.
- The shipped app binary must contain only the V8 bindings and native libraries
  required by the cart source.
- The dev hot-bundle host is the exception: it must be a fat binary with every
  supported V8 binding available, because it can receive any cart after startup.
- The CLI payload must carry everything needed to scaffold and ship: Zig,
  esbuild, v8cli, JS packages, native SDK payloads, and Zig package cache/vendor
  inputs. It must not rely on Node, Bun, network fetches, or a user-global Zig
  cache.

## CLI Tools

Current local tool payloads:

- `tools/v8cli`: V8-based script runner used for build scripts.
- `tools/esbuild`: local esbuild binary used by `scripts/cart-bundle.js`.
- `tools/zig/zig`: Zig 0.16.0 compiler.
- `tools/zig/lib`: Zig standard library and compiler support files.
- `tools/zig/cache/p`: packed Zig package cache used so builds do not fetch
  remote Zig dependencies.

The packed Zig toolchain must include more than the `zig` executable. A copied
binary without `lib/zig` fails to locate the Zig installation directory. A clean
global cache also causes dependency fetches, so package cache/vendor inputs must
be part of the CLI payload.

## Ship Script

`scripts/ship` is the user-facing production build script.

Supported usage:

```sh
scripts/ship <cart-name>
scripts/ship <cart-name> -d
scripts/ship <cart-name> --debug
```

There is no `--raw` flag and no `--qjs` flag. Unknown flags fail immediately.
`scripts/ship` always builds the V8 runtime:

```sh
zig build app -Dapp-source=v8_app.zig -Duse-v8=true ...
```

Release builds package the output into the platform artifact. Debug builds skip
packaging and move the debug ELF to:

```sh
zig-out/bin/<cart-name>-debug
```

The shippable Linux output remains:

```sh
zig-out/bin/<cart-name>
```

## Ship Pipeline

The ship pipeline is:

1. Resolve the cart entry:
   - `cart/<name>/index.tsx`
   - fallback: `cart/<name>.tsx`
2. Read cart metadata from `cart/<name>/cart.json` when present.
3. Bundle the cart through the V8 CLI path:
   ```sh
   BUNDLE_FROM_HARNESS=1 tools/v8cli scripts/cart-bundle.js <entry> --out bundle-<name>.js
   ```
4. Read the esbuild metafile:
   ```sh
   bundle-<name>.js.metafile.json
   ```
5. Resolve source-triggered V8 binding gates.
6. Print a build ingredient summary before compiling.
7. Build `v8_app.zig` with the selected `-Dhas-*` flags.
8. Verify the build manifest labels match the source-derived expectation.
9. Package the result:
   - macOS: `.app` bundle
   - Linux: self-extracting wrapper with bundled dynamic libraries
10. Run the post-build snapshot gate and optional autotest replay.

## Build Ingredient Echo

Before `zig build`, `scripts/ship` prints the selected ingredients for clarity.
The report includes:

- runtime: always `v8_app.zig (V8)`
- selected V8 bindings
- native feature libraries added by selected bindings
- source triggers that caused the bindings
- exact Zig flags passed to `zig build`

Example shape:

```text
[ship] build ingredients:
[ship]   runtime: v8_app.zig (V8)
[ship]   V8 bindings: process httpsrv wssrv net tor websocket telemetry
[ship]   native feature libs: none
[ship]   triggers:
[ship]     - useHost: runtime/hooks/useHost.ts
[ship]     - connection: runtime/hooks/useConnection.ts
[ship]     - websocket: runtime/hooks/websocket.ts or useConnection
[ship]   zig flags: -Duse-v8=true -Doptimize=ReleaseFast -Dhas-process=true ...
```

If no gated binding is needed, it prints `V8 bindings: none`.

## V8 Binding Gates

The current positional ship gate order is:

```text
privacy useHost useConnection fs websocket telemetry zigcall
```

Those gates currently map to build flags and binding domains as follows:

| Gate | Build flags | V8 binding domains |
| --- | --- | --- |
| `privacy` | `-Dhas-privacy=true` | `privacy` |
| `useHost` | `-Dhas-process=true -Dhas-httpsrv=true -Dhas-wssrv=true -Dhas-net=true` | `process`, `httpsrv`, `wssrv`, `net` |
| `useConnection` | `-Dhas-net=true -Dhas-tor=true -Dhas-websocket=true` | `net`, `tor`, `websocket` |
| `fs` | `-Dhas-fs=true` | `fs` |
| `websocket` | `-Dhas-websocket=true` | `websocket` |
| `telemetry` | `-Dhas-telemetry=true` | `telemetry` |
| `zigcall` | `-Dhas-zigcall=true` | `zigcall`, `zigcall_list` |

The ship script initializes all `WANT_*` values to `0`, so a missing metafile
means every opt-in binding is disabled and reported as such.

## Dependency Registry

The dependency registry lives at:

```text
sdk/dependency-registry.json
```

It is the source of truth for:

- CLI payload tools: Zig, v8cli, esbuild.
- JS packages: React, React reconciler, scheduler, TypeScript, and support
  packages.
- Native libraries: V8, SDL3, wgpu-native, freetype, libmpv, libsodium, sqlite3,
  curl, libvterm, box2d, LuaJIT, and platform libraries/frameworks.
- Source-triggered features and the build flags, bindings, and libraries they
  require.

`scripts/ship-metafile-gate.js` reads this registry and preserves the legacy
positional output expected by `scripts/ship`.

The broader resolver is:

```sh
tools/v8cli scripts/sdk-dependency-resolve.js --metafile bundle-hello.js.metafile.json
tools/v8cli scripts/sdk-dependency-resolve.js --metafile bundle-hello.js.metafile.json --format ship-gate
tools/v8cli scripts/sdk-dependency-resolve.js --metafile bundle-hello.js.metafile.json --format zig-flags
tools/v8cli scripts/sdk-dependency-resolve.js --format dev-zig-flags
```

Formats:

- `json`: selected features, build options, V8 bindings, native libraries, tools,
  and JS packages.
- `ship-gate`: positional `0/1` gate output for `scripts/ship`.
- `zig-flags`: source-selected `-D...=true` flags.
- `dev-zig-flags`: every registry feature currently declared by `build.zig`,
  used by the fat dev host.

## Dev Hot-Bundle Host

`scripts/dev` builds or launches `zig-out/bin/reactjit-dev`. Unlike shipped app
binaries, this binary must include every V8 binding that a hot-loaded cart might
use.

The dev build obtains its flags from:

```sh
tools/v8cli scripts/sdk-dependency-resolve.js --format dev-zig-flags --build-zig build.zig
```

Current dev flag set:

```sh
-Duse-v8=true
-Ddev-mode=true
-Dhas-privacy=true
-Dhas-process=true
-Dhas-httpsrv=true
-Dhas-wssrv=true
-Dhas-net=true
-Dhas-tor=true
-Dhas-websocket=true
-Dhas-fs=true
-Dhas-telemetry=true
-Dhas-zigcall=true
```

`scripts/dev` uses the packed Zig toolchain when present and points Zig at the
packed package cache:

```sh
ZIG_GLOBAL_CACHE_DIR="$REPO_ROOT/tools/zig/cache" tools/zig/zig build ...
```

This is required for offline/self-contained CLI behavior.

## App Icons

`scripts/ship` packages app icons when a cart declares one or uses a conventional
filename.

Manifest forms:

```json
{
  "icon": "icon.png"
}
```

or:

```json
{
  "icons": {
    "macos": "icon.icns",
    "linux": "icon.png",
    "default": "icon.png"
  }
}
```

Fallback filenames:

- `cart/<name>/icon.icns`
- `cart/<name>/icon.png`
- `cart/<name>/icon.svg`
- `cart/<name>/icon.ico`
- `cart/<name>.icns`
- `cart/<name>.png`
- `cart/<name>.svg`
- `cart/<name>.ico`

macOS packaging copies the icon into `Contents/Resources`. If the icon is
`.icns`, `CFBundleIconFile` is written into `Info.plist`.

Linux packaging copies the icon into `share/icons/` and includes a desktop entry
template. On first extraction, the wrapper materializes a `.desktop` file with
absolute `Exec` and `Icon` paths for the extracted cache directory.

`scripts/cart-manifest-field.js` reads cart manifest fields through `tools/v8cli`
so `scripts/ship` does not shell-parse JSON.

## Native Linking Contract

The shipped app binary must link a native dependency only when source usage
requires it. The V8 binding gates already follow this contract for the currently
gated domains above.

The registry also names broader native feature dependencies such as SDL3,
wgpu-native, freetype, libmpv, sqlite3, curl, libvterm, box2d, LuaJIT, and
platform libraries. `build.zig` still needs to consume those registry-derived
feature flags for complete native-library gating. Until that is wired through,
some native libraries may still be linked unconditionally by `build.zig`.

The dev host remains intentionally different: it links/registers everything so
any hot-loaded cart can run.

## Current Script Surface

User-facing `scripts/ship` flags:

```sh
-d
--debug
```

Removed:

- `--raw`
- `--qjs`

The QJS runtime files may still exist for maintenance or reference, but the ship
script no longer exposes a QJS build path.
