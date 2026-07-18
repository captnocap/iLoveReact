# !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
# !!!!!!!! THE PURPOSE OF THIS SPEC IS TO WRITE TYPESCRIPT. DO NOT REUSE EXISTING JAVASCRIPT FILES
# !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!



# `cli/` — the typed `rjit` CLI: migration spec

**Status:** complete. Sections 1–8 are the migration blueprint; Appendix B is the working set of file contents that implementation sessions copy-paste from. Section 9 is the live session log — pick up from the last entry.

---

## 1. Context & goal

`scripts/` is the last unvendored corner of the project. Two patterns of fragility have been observed in the wild:

- **Positional contracts that drift silently.** `scripts/ship-metafile-gate.js` emits 18 space-separated `0/1` flags. `scripts/ship:290` reads them with `read -r WANT_PRIVACY WANT_USEHOST WANT_USECONN WANT_FS …`. `scripts/ship-tui:115` reads the *same* flags positionally with `set -- $GATE_FLAGS; WANT_USEHOST=$2; … WANT_WINDOW=${17}`. The contract has already silently misaligned once — `WANT_TERMINAL` was picking up sqlite's value before the comment on `scripts/ship:286-289` was added.
- **Duplication that compounds drift.** The esbuild flag list (jsx-factory, ambient injects, vendored alias map) lives in four places: `scripts/cart-bundle.js`, `scripts/watch-and-push.js`, `scripts/tui`, `scripts/ship-tui`. The comment on `watch-and-push.js:38-39` says: *"drift would mean saved files build differently from the startup ship."*

Adjacent symptoms:

- `scripts/ship` has 18 parallel `WANT_*` shell vars, 3 parallel arrays (`BUILD_BINDINGS`, `BUILD_LIBS`, `BUILD_TRIGGERS`), and a 10-key `EXPECTED` map (`scripts/ship:503-514`) kept in lock-step by hand. The `sdk/dependency-registry.json` these all derive from already exists as the authoritative source.
- 40 `__*` host bindings in `framework/v8_bindings_{cli,fs,process}.zig` have **zero documentation**. Every script re-discovers them implicitly.
- `normalizeArgv`, `die()`, `readJson()`, the `__spawnSync` → `JSON.parse` dance — copy-pasted into essentially every `.js` script (~150 LOC of glue per script).

**End state.** A single typed `rjit` CLI bundled through v8cli. The bash that remains is limited to what genuinely can't leave it (~120 LOC total): three bootstrap fetchers, the git commit-msg hook, and the `#!/bin/sh` self-extractor *emitted as a string* by `ship.ts` (the wrapper has to run on the user's machine with zero SDK installed).

**Non-goals.** Renaming anything user-facing. `./scripts/ship hello` keeps working through the migration (becomes a thin shim that execs the new CLI). No behavior change in the shipped binaries.

---

## 2. End-state shape

### Binary

- Name: **`rjit`** (per existing `scripts/help.js` and `sdk/dependency-registry.json`).
- Shape: `tools/rjit.js` (bundled TS, ~1 file) + `tools/rjit` (thin shell wrapper that execs `tools/v8cli tools/rjit.js "$@"`). Matches the existing pattern of `scripts/classify`, `scripts/gallery-component`, `scripts/strip-ambient-imports` — each a bash wrapper around a v8cli script.
- Bundling: built by `tools/esbuild cli/main.ts --bundle --outfile=tools/rjit.js --format=iife --platform=neutral --target=es2022`. Same toolchain the rest of the carts use.

### Migration strategy: side-by-side, not in-place

`cli/` is a **new tree** built alongside `scripts/`. Nothing in `scripts/` moves or breaks until each command's port lands and the shim is in place. The supervisor + worker pattern in this repo means parallel sessions can edit either side without conflict.

### Tree

```
cli/
  SPEC.md                  # this file
  main.ts                  # dispatch: rjit <subcommand> [args]
  host/
    bindings.d.ts          # the 40 __* host fns, typed (section 4)
    fs.ts                  # typed wrappers around __fs_*
    process.ts             # typed wrappers around __proc_*, __spawn*
    net.ts                 # typed wrappers around __unix*
    log.ts                 # __writeStdout/Stderr + level prefixes
    argv.ts                # one canonical argv parser
  registry/
    schema.ts              # FeatureSpec, Trigger, BuildOption, ShipGate (section 5)
    load.ts                # parse + validate dependency-registry.json
    resolve.ts             # metafile + registry → typed FeatureSelection
  cart/
    resolve.ts             # CartLayout: cart/<name>/index.tsx vs cart/<name>.tsx
    bundle.ts              # canonical esbuild flag list (replaces the 4-place dup)
    metafile.ts            # typed esbuild metafile + shipped() helper
    manifest.ts            # cart.json reader (replaces cart-manifest-field.js)
  commands/
    cart-manifest-field.ts
    push-bundle.ts
    cart-bundle.ts
    metafile-gate.ts       # subsumes ship-metafile-gate.js + sdk-dependency-resolve.js
    watch-and-push.ts
    help.ts
    init.ts
    ship.ts                # the big payoff: bash → TS. Packages both substrates (gui + tui).
    dev.ts                 # persistent hot-reload host, both substrates (gui + tui)
    ship-tui.ts            # alias → ship --tui (deleted in shim sweep)
    tui.ts                 # alias → dev --tui (deleted in shim sweep)
    autotest.ts
    classify.ts
    gallery-component.ts
    gallery-sizes.ts
    gallery-suspects.ts
    strip-ambient-imports.ts
    bake-icons.ts
    pack-sdk.ts
    firecracker-build.ts
```

### Dispatch

`cli/main.ts` is a switch on `argv[1]` (subcommand name) into the matching `commands/*.ts`. Unknown subcommand prints `commands/help.ts`. Each command exports a single `async function run(argv: string[]): Promise<number>` returning exit code.

### Substrate selection (gui vs tui)

`ship` and `dev` each target **both** substrates — the windowed GPU host and the headless TUI host. There is **no separate `ship-tui` / `tui` command** in the end state; the substrate is a *parameter*, not a command name. This mirrors the runtime, which (per `build.zig`'s C-series refactor, commit `5bf461d25`) has one `zig build app` target where `-Dhas-gpu=false` flips it headless — `framework/v8_tui_app.zig` and the dedicated `tui-app` build step are gone, and `v8_app.runHeadless()` is the single dispatch.

Why this matters: four near-identical cart-running scripts (`ship`, `dev`, `ship-tui`, `tui`) were the confusing surface this migration exists to flatten. They collapse to two axes — **substrate** (gui/tui) × **mode** (iterate via `dev`, package via `ship`).

A `SubstrateSelector` (in `cli/cart/resolve.ts`) resolves the substrate for a cart, **first match wins**:

1. **Explicit flag** — `--tui` (alias `--headless`) or `--gui` on the command line. Always wins.
2. **Manifest** — `cart.json`'s `"surface": "tui" | "gui"` field (see `cli/cart/manifest.ts`). Lets a TUI-only cart declare itself once instead of every caller remembering `--tui`.
3. **Default** — `gui`.

The resolved substrate maps to exactly one build difference: `tui` adds `-Dhas-gpu=false` (→ `v8_app.runHeadless()`) and selects `BundleMode = 'tui-host'` in `cli/cart/bundle.ts`; `gui` is the default `app` target with `BundleMode = 'gpu-host'`. Everything downstream — metafile gate, ingredient resolution, packaging — is substrate-agnostic and shared, so neither `ship` nor `dev` forks into a parallel code path.

`ship-tui` and `tui` survive only as thin aliases (`ship --tui` / `dev --tui`) for muscle memory and existing callers (`scripts/devshell` execs `tui`); they are deleted in the shim sweep alongside the other shims.

### Shim policy

For each ported command, the old bash/JS entrypoint becomes a 3-line shim:

```bash
#!/bin/sh
cd "$(dirname "$0")/.." || exit 1
exec tools/v8cli tools/rjit.js ship "$@"
```

Shims keep user muscle memory (`./scripts/ship hello`) and external references (docs, agent skills, gallery procedural memory) working unchanged. Shims get deleted when the docs sweep at the end of the migration completes.

---

## 3. Bash floor — what stays

After the migration, these are the only `.sh` / `bash` files left in the repo:

| File | LOC | Why it stays |
|------|-----|--------------|
| `scripts/fetch-zig.sh` | ~30 | Bootstrap. Runs on a fresh clone before `tools/zig/` exists → before `v8cli` can be built. |
| `scripts/fetch-v8-prebuilt.sh` | ~30 | Bootstrap. Downloads `deps/v8-prebuilt/libc_v8.a` (~116 MB), which v8cli itself links against. |
| `scripts/setup` | ~30 | Orchestrates the two fetchers above + a friendly first-run message. POSIX shell because v8cli doesn't exist yet. |
| `scripts/hooks/commit-msg` | ~30 | Git invokes hooks directly. A fresh clone after `setup` has `tools/v8cli`, but the hook predates `tools/` being populated. Shimming through v8cli is more brittle than 30 lines of sh. |

Plus the **emitted strings** that `cli/commands/ship.ts` and `cli/commands/ship-tui.ts` produce: the `#!/bin/sh` self-extractor wrapper and the inner `run` launcher inside each cart tarball. These are user-deliverables that have to run on machines with zero SDK installed. The bash content is small (~30 lines), generated by a TS template literal, not maintained as bash.

**Soft floor (small v8cli gaps to plug):**

- `flock(2)` — `scripts/ship:50` uses `flock -n 9` against `.zig-cache/.ship.lock` to serialize parallel ships. v8cli has no flock binding. Two options: add a ~15-line `__flock` binding to `framework/v8_bindings_cli.zig`, or shell out to `/usr/bin/flock(1)` once. Decision: **shell out** until a second use case shows up (YAGNI).
- PIL/Pillow image work in `scripts/autotest-grid` (Python) and `scripts/img-to-pixels.py`. The framework already has `freetype` + `stb_image` linked in via `nativeLibraries`; exposing a `__image_*` binding is plausible but not free. Decision: **Python stays for image manipulation** — these are leaf tools called only by `autotest` and the screenshot pipeline.
- Other Python (`scripts/fix-react-imports`, `scripts/vsock-bridge`, `scripts/ingest-quests`, `scripts/claudewrap-sync-*`) — all migratable to TS but not on the critical path. Decision: **Python stays** unless explicitly revisited; these live closer to ops than to the build.

---

## 4. Host binding surface

40 `__*` host functions registered across three Zig files. Source files have zero JSDoc/header documentation per fn — the contracts below were reverse-engineered from `argString/argI32/argF64/argBool` calls and `setString/setBool/setNumber/setNull` returns.

**Implication:** `cli/host/bindings.d.ts` is the first authoritative typed contract for these. It is hand-written through leaf 4 of section 6; once leaf 5 (`codegen-bindings`) lands, the hand-written portion is replaced by `runtime/_generated_host_globals.d.ts` emitted from `sdk/bindings.ts` (the registry surface — see section 5). `cli/host/bindings.d.ts` after the cutover keeps only the runtime-shim section (console / process) and re-exports the generated declarations. The 40-binding table below is the reverse-engineered baseline that seeds the registry's entries during leaf 5.

### From `framework/v8_bindings_cli.zig` (25)

| Binding | Signature | Returns | Behavior |
|---------|-----------|---------|----------|
| `__argv` | `()` | `string` (JSON array) | Script argv. `argv[0]` is the script path; `argv[1..]` are user args. |
| `__env` | `(name: string)` | `string \| null` | Get environment variable. |
| `__exit` | `(code: number)` | `void` | Exit process with code (truncated to i32). |
| `__cwd` | `()` | `string` | Current working directory. |
| `__nowMs` | `()` | `number` | Monotonic-ish millis since epoch. |
| `__sleepMs` | `(ms: number)` | `void` | Block the script for N ms. |
| `__writeStdout` | `(text: string)` | `void` | Raw write to stdout (no trailing newline added). |
| `__writeStderr` | `(text: string)` | `void` | Raw write to stderr. |
| `__setStdinRaw` | `(enable: number)` | `boolean` | Toggle terminal raw mode (no echo, no canonical). |
| `__readStdin` | `()` | `string` | Non-blocking drain of the host-owned stdin queue. |
| `__termSize` | `()` | `string` (JSON `[cols, rows]`) | TIOCGWINSZ. |
| `__spawnSync` | `(cmd: string, argsJson: string, stdin: string)` | `string` (JSON `{code, stdout, stderr}`) | Blocking subprocess. |
| `__spawn` | `(cmd: string, argsJson: string)` | `number` | Async subprocess. Returns child id, or `-1`. |
| `__childReadLine` | `(id: number, timeoutMs: number)` | `string \| null` | One line from spawned child's stdout. |
| `__childKill` | `(id: number)` | `boolean` | SIGTERM a spawned child. |
| `__unixConnect` | `(path: string)` | `number` | Unix socket connect. Returns fd or `-1`. |
| `__unixWrite` | `(fd: number, data: string)` | `number` | Write bytes. Returns bytes written or `-1`. |
| `__unixReadAll` | `(fd: number, timeoutMs: number, maxBytes: number)` | `string` | Drain socket within timeout. |
| `__unixClose` | `(fd: number)` | `void` | Close socket fd. |
| `__hotGet` | `(key: string)` | `string \| null` | Hotstate read (persists across reload). |
| `__hotSet` | `(key: string, value: string)` | `void` | Hotstate write. |
| `__hotRemove` | `(key: string)` | `void` | Hotstate delete. |
| `__hotClear` | `()` | `void` | Hotstate wipe. |
| `__hotKeys` | `()` | `string` (JSON array) | All hotstate keys. |

### From `framework/v8_bindings_fs.zig` (14)

Two parallel APIs are present — the `_json` family returns parsed JSON strings (used by newer scripts), the bare/`_file` family returns raw content (legacy). New TS code should prefer the `_json` family.

| Binding | Signature | Returns | Notes |
|---------|-----------|---------|-------|
| `__fs_read` | `(path: string)` | `string \| null` | Read file (max 16 MB). `null` on any error. |
| `__fs_write` | `(path: string, content: string)` | `boolean` | Creates parent dirs. |
| `__fs_exists` | `(path: string)` | `boolean` | |
| `__fs_list_json` | `(path: string)` | `string` (JSON array) | Directory entries, names only. |
| `__fs_stat_json` | `(path: string)` | `string \| null` (JSON `{size, mtimeMs, isDir}`) | |
| `__fs_mkdir` | `(path: string)` | `boolean` | Recursive. |
| `__fs_remove` | `(path: string)` | `boolean` | Recursive. |
| `__fs_readfile` | `(path: string)` | `string` | Legacy: empty string on error (no null). |
| `__fs_writefile` | `(path: string, content: string)` | `number` | Legacy: `0` ok, `-1` error. |
| `__fs_deletefile` | `(path: string)` | `number` | Legacy: `0` ok, `-1` error. |
| `__fs_scandir` | `(path: string)` | `string[]` (V8 Array, not JSON) | Note: returns a real Array, not a JSON string. |
| `__fs_media_scan_json` | `(dir: string, recursive?: boolean, maxDepth?: number)` | `string` (JSON array) | Media-file walk. |
| `__fs_media_stats_json` | `(dir: string, recursive?: boolean, maxDepth?: number)` | `string` (JSON `{total, byType, totalSize, largestFile}`) | |
| `__fs_media_index_json` | `(dir: string, …)` | `string` (JSON array) | Alias of media_scan_json. |

### From `framework/v8_bindings_process.zig` (7) — event-emitting subprocess API

This family **emits events** through the runtime FFI bus rather than returning data inline. Channel names: `proc:stdout:<pid>`, `proc:stderr:<pid>`, `proc:exit:<pid>`, `proc:ram:<pid>`, `proc:cpu:<pid>`. The bus is the runtime's `__ffiEmit` mechanism; scripts that subscribe must wire up a listener.

| Binding | Signature | Returns | Notes |
|---------|-----------|---------|-------|
| `__proc_spawn` | `(specJson: string)` | `number` (pid or `0`) | Spec: `{cmd, args[], cwd?, stdin: "pipe"\|"inherit"\|"ignore"}` |
| `__proc_kill` | `(pid: number, signal?: string)` | `boolean` | Default SIGTERM; `"SIGKILL"` for kill. |
| `__proc_stdin_write` | `(pid: number, data: string)` | `boolean` | |
| `__proc_stdin_close` | `(pid: number)` | `void` | |
| `__proc_stat` | `(pid: number)` | `string \| null` (JSON `{pid, rss, vsize, utime, stime, memTotal, percent}`) | Linux only. |
| `__proc_watch_add` | `(pid: number, intervalMs: number)` | `void` | Start CPU/RAM sampler. |
| `__proc_watch_remove` | `(pid: number)` | `void` | Stop sampler. |

### Implementation notes for `cli/host/`

- `bindings.d.ts` declares `globalThis.__fs_read: (path: string) => string | null;` etc.
- `cli/host/fs.ts`, `process.ts`, `net.ts` wrap each `__*` binding in a typed function that throws on the documented failure modes (e.g. `fsRead(path)` throws `FsReadError` instead of returning `null`, leaving the null-or-throw decision to per-caller `tryFsRead` wrappers).
- The `_json`/`_file` legacy split should not propagate up. `cli/host/fs.ts` exposes one canonical `fsRead`/`fsList`/`fsStat` that internally chooses the right binding.

---

## 5. Registry surface

The registry layer at `cli/registry/` is the single thing the CLI consults to answer "what does this build need?" Five facets — features, ship-gate flags, native libraries, the CLI payload, and bindings — all live here. The first four are read from `sdk/dependency-registry.json`. The fifth (bindings) is read from a new typed companion file `sdk/bindings.ts`, which together with the hook-side declaration replaces the grep-based metafile gate that lives in `scripts/ship-metafile-gate.js` today.

Everything the build emits — Zig source for `_generated_bindings.zig`, TypeScript declarations for `_generated_host_globals.d.ts`, gate flags, `-Dhas-X` options, native-library link decisions — derives from this registry. The CLI commands (`metafile-gate`, `codegen-bindings`, `ship`, `dev`, `ship-tui`) are all consumers.

### Top-level shape

```
{
  schemaVersion: 1,
  description: string,
  cliPayload: { tools: {...}, jsPackages: {...} },
  nativeLibraries: {...},
  features: {...},
  shipGate: { flagOrder: string[] }
}
```

### `features` (33 entries)

Each has the shape:

```ts
type FeatureSpec = {
  triggers?: Trigger[];
  buildOptions?: string[];      // -D<name>=true flags (without the -D prefix)
  v8Bindings?: string[];        // names matching framework/v8_bindings_<name>.zig
  nativeLibraries?: string[];   // refs into nativeLibraries map
  tools?: string[];             // refs into cliPayload.tools
  jsPackages?: string[];        // refs into cliPayload.jsPackages
  requiredFor?: ('scaffold' | 'build' | 'ship' | 'scripts')[];
  shipGate?: string;            // gate flag name (must appear in shipGate.flagOrder)
};
```

Feature catalogue:

| Feature | Triggers (paths) | buildOptions | v8Bindings | nativeLibraries | shipGate |
|---------|------------------|--------------|------------|------------------|----------|
| react-runtime | — | — | — | — | — |
| cli-toolchain | — | — | — | — | — |
| v8-engine | — | use-v8 | — | v8 | — |
| window-runtime | — | has-window-runtime | — | — | — |
| window | runtime/primitives/window.tsx | has-window | — | — | window |
| canvas | — | has-canvas | — | — | — |
| graph | — | has-graph | — | — | — |
| text-rendering | — | has-text-rendering | — | — | — |
| image | — | has-image | — | — | — |
| video | — | has-video | — | libmpv | — |
| audio | runtime/audio.tsx | has-audio | — | luajit | — |
| midi | runtime/hooks/useMIDI.ts | has-midi | — | alsa | — |
| terminal | runtime/hooks/useTerminal.ts | has-terminal | — | libvterm | terminal |
| physics | — | has-physics | — | box2d | — |
| sqlite | runtime/hooks/{sqlite,localstore,useLocalStore}.ts + prefix cart/sweatshop/lib/storage/ | — | — | sqlite3 | sqlite |
| crypto | runtime/hooks/crypto.ts | has-crypto | — | libsodium | — |
| privacy | runtime/hooks/usePrivacy.ts | has-privacy | privacy | libsodium | privacy |
| process | runtime/hooks/{process,useProcess}.ts | has-process | process | — | process |
| use-host | runtime/hooks/useHost.ts | has-process, has-httpsrv, has-wssrv, has-net | process, httpsrv, wssrv, net | — | useHost |
| connection | runtime/hooks/{useConnection,useTheInternet}.ts | has-net, has-tor, has-websocket | net, tor, websocket | — | useConnection |
| fs | runtime/hooks/{fs,useFileContent,useFileDrop,useFileWatch}.ts | has-fs | fs | — | fs |
| websocket | runtime/hooks/{websocket,useConnection}.ts | has-websocket | websocket | — | websocket |
| telemetry | runtime/hooks/useTelemetry.ts + 4 cart paths | has-telemetry | telemetry | sqlite3 | telemetry |
| zigcall | runtime/hooks/math.ts | has-zigcall | zigcall, zigcall_list | — | zigcall |
| sdk | runtime/hooks/{useTheInternet,fetch,useFetchBrowser,useBrowse}.ts | has-sdk | sdk | tls.zig | sdk |
| voice | runtime/hooks/{useVoiceInput,useAudioInput}.ts | has-voice | voice | — | voice |
| whisper | runtime/hooks/whisper.ts | has-whisper | whisper | — | whisper |
| onnx | runtime/hooks/useSegment.ts | has-onnx | onnx | onnx-runtime | onnx |
| lua-worker | — | — | — | luajit | — |
| pg | runtime/hooks/{pg,usePostgres,embed,useEmbed}.ts | has-pg | pg | — | pg |
| embed | runtime/hooks/{embed,useEmbed}.ts | has-embed | embed | — | embed |
| doom | runtime/hooks/useDoom.ts | has-doom | doom | — | doom |

### `shipGate.flagOrder` (verbatim, 18 flags)

```
privacy, useHost, useConnection, fs, websocket, telemetry, zigcall, sdk,
voice, whisper, onnx, pg, embed, sqlite, terminal, process, window, doom
```

This ordering is **the** load-bearing positional contract `scripts/ship-metafile-gate.js` writes and `scripts/ship` / `scripts/ship-tui` read. In the TS rewrite this becomes a typed record (`GateFlags = { privacy: boolean; useHost: boolean; … }`) and the ordering disappears entirely — `flagOrder` is only consulted by code that emits the legacy positional output for back-compat shims.

### `nativeLibraries` (22 entries, summary)

Categorized by `linkPolicy` (how the build links it) and `bundlePolicy` (how `ship` packages it):

- **engine-v8 / always-bundled:** `v8`
- **foundational / always-bundled:** `sdl3` (dynamic), `wgpu-native` (zig pkg), `freetype` (dynamic), `stb-image` (vendored C), `stb-image-write` (vendored C)
- **system-assumed / never-bundled:** `x11`, `posix-threading`, `macos-ui-frameworks`
- **feature-gated:** `libmpv` (video), `libsodium` (privacy), `sqlite3` (sqlite/telemetry), `onnx-runtime` (onnx), `libvterm` (terminal), `box2d` (physics), `alsa` (midi), `tls.zig` (sdk), `luajit` (audio/lua-worker)
- **deprecated / never-bundled:** `curl`

### `cliPayload`

```
tools:       zig (toolchain), v8cli (host-tool), esbuild (bundler)
jsPackages:  react, react-reconciler, scheduler, loose-envify, js-tokens, typescript
```

All `packPolicy: required`. The `pack-sdk` command verifies presence at staging time.

### Trigger kinds

Only two appear in the registry data despite the schema documenting a third:

- `metafileInput` — exact path match against keys of the esbuild metafile's `outputs[].inputs`. Used by 25 features.
- `metafileInputPrefix` — directory prefix match. Used by `sqlite` (cart/sweatshop/lib/storage/) only.
- `featureMarker` — documented in `sdk/README.md` but **not in use**. The TS schema should accept it (forward-compat) but `cli/registry/resolve.ts` can leave the implementation as a TODO until something actually uses it.

### Binding shape (`sdk/bindings.ts`)

The bindings facet of the registry. Replaces the three-place hand-sync today's setup requires:

1. `INGREDIENTS` array in `v8_app.zig` (`.name`, `.grep_prefix`, `.reg_fn`, `.mod`).
2. `-Dhas-X` option in `build.zig`.
3. `grep_prefix` entry in `scripts/ship-metafile-gate.js`.

Forgetting any one is the "burrito ingredient drift" failure the `INGREDIENTS` comment block in `v8_app.zig:99–138` warns about. The bindings registry collapses all three into one TS file:

```ts
// sdk/bindings-schema.ts — strict types (full source in Appendix B.18)
export type HostFn = {
  js:  `__${string}`;       // bridge surface name; must start with __
  zig: `host${string}`;     // Zig fn symbol inside the binding module
};

export type BindingSpec =
  | { required: true;  module: `framework/v8_bindings_${string}.zig`; registerSuffix: string; hostFns: HostFn[]; tickDrain?: 'noop' | 'real'; init?: 'real'; needs?: string[]; }
  | { required: false; module: `framework/v8_bindings_${string}.zig`; registerSuffix: string; hostFns: HostFn[]; tickDrain?: 'noop' | 'real'; init?: 'real'; needs?: string[]; };

export type BindingRegistry = Record<string, BindingSpec>;
export function defineBindings<T extends BindingRegistry>(r: T): T { return r; }
```

The codegen step (`rjit codegen-bindings`, leaf 5 in section 6) reads this file and emits two artifacts:

- `framework/_generated_bindings.zig` — the `INGREDIENTS` array + an `enabledFor` helper + per-binding `pub fn register<Suffix>` bodies + the conditional `@import` ladder. `v8_app.zig` and `v8_tui_app.zig` import this generated file; their hand-written copies of the conditional binding ladder go away.
- `runtime/_generated_host_globals.d.ts` — `declare global { function __pg_connect(...): ...; }` for every host fn. Carts get IDE autocomplete on every host-fn surface they import. Replaces the hand-written portion of `cli/host/bindings.d.ts`.

Note the absence of a `grep` or `requiredBy` field on `BindingSpec`. The hook-side declaration below is the resolution mechanism; the registry only describes *what the binding is*, not *what makes it turn on*.

`tickDrain: 'noop'` and `init: 'real'` are codegen toggles: `'noop'` means the codegen emits the stub body; `'real'` means the hand-written `.zig` file is expected to provide its own. The codegen verifies that expectation with `@hasDecl` at compile time.

### Hook-side declaration

`scripts/ship-metafile-gate.js` decides which bindings get linked today by grepping the bundle for host-fn prefixes. The grep is a textual heuristic that lies in both directions:

- **False positive:** a comment, log line, or template string containing `__pg_connect` flips the gate even when no live call site exists.
- **False negative:** a hook that calls bindings through a lazy require / `host[name]` / minified accessor never trips the grep — the binding silently fails to link and the cart silently fails to launch.

The replacement is a declaration, not a fingerprint. Each hook file that calls host fns exports the contract at the top:

```ts
// runtime/hooks/usePg.ts
import type { Binding } from '../../sdk/binding-names';

export const bindings = ['pg'] as const satisfies readonly Binding[];

export function usePg() { /* uses __pg_connect, __pg_query_json, ... */ }
```

`sdk/binding-names.ts` is a type-only sibling of `sdk/bindings.ts` whose entire purpose is to give hook files something to import without forming an import cycle:

```ts
// sdk/binding-names.ts — TYPE-ONLY.
import bindings from './bindings';
export type Binding = keyof typeof bindings;
```

Hook files import `type Binding` only — at runtime this elides to nothing, so there's no actual import edge between hooks and `sdk/bindings.ts`'s value.

### Walker resolution

`cli/registry/resolve.ts` does the work. Algorithm:

1. Load `sdk/bindings.ts` (the codegen produces a JSON intermediate the walker consumes — see Appendix B.21).
2. From the cart's esbuild metafile, enumerate input files matching `cart/**` or `runtime/**`, excluding `node_modules/**` and the `_generated_*` layer.
3. For each candidate file, statically extract its `export const bindings = [...]` value. Two viable extractors: bundle-time AST scan, or a tiny esbuild pass that evaluates the candidate to read its `bindings` export. Either works; pick the simpler one when implementing.
4. Union the harvested arrays. Plus every binding marked `required: true` (those don't need a declaration — required-ness is a property of the binding).
5. Emit the resulting typed `GateFlags` and the `-Dhas-X` set. Output stays in the same shape as today's metafile-gate output for compatibility.

### Locked-in design decisions

1. **Export name: `bindings`.** Not `__bindings__` — the double-underscore convention is reserved for bridge surface (host-fn names like `__pg_connect`). A binding-declaration export isn't bridge surface and shouldn't visually collide with it.

2. **Walker scope: `cart/**` + `runtime/**`, excluding `node_modules/**` and `framework/_generated_*`.** Wide enough to cover hooks defined inline in carts, narrow enough that random transitive deps can't claim a binding by accident.

3. **Unmediated-call lint at review time, not build time.** The codegen also produces a list of `__<prefix>_` calls in files that don't declare `bindings`. This is a *grep* — but it runs as a lint, where a false positive becomes a PR comment ("declare bindings here or move into a hook"), not a broken build. See section 8 for the full lint set.

4. **Optional bindings deferred.** The current schema can't express "I prefer fs but degrade if absent." When that's needed, the shape is `optionalBindings: readonly Binding[]` — the walker doesn't flip a gate based on optional; it adds a runtime-checkable manifest to the bundle and the hook writes the check. Until that lands, every declared binding is mandatory.

5. **`binding-names.ts` is split from `bindings.ts` preemptively.** TS elides `import type`, so the cycle wouldn't actually bite at runtime, but the split costs nothing and means `sdk/bindings.ts` can grow to import absolute paths and helper utilities without ever forming an edge with the hook files consuming the binding union type.

---

## 6. Migration order

Smallest blast radius first. Each leaf is shippable in isolation; nothing references a later leaf.

| # | Command | Old LOC | Blast radius | Notes |
|---|---------|---------|--------------|-------|
| 1 | `cart-manifest-field` | 41 | Trivial. Single JSON read, one field lookup. | Smoke test for `cli/host/fs.ts`. |
| 2 | `push-bundle` | 97 | Tight. Single Unix socket op. | Smoke test for `cli/host/net.ts`. |
| 3 | `cart-bundle` | 129 | Medium. First user of `cli/cart/bundle.ts` (canonical esbuild flags). | Replaces 1 of 4 flag-duplication sites. |
| 4 | `metafile-gate` | 90 + 170 | Medium. Subsumes `ship-metafile-gate.js` + `sdk-dependency-resolve.js`. First real exercise of `cli/registry/`. | Output stays backwards-compatible (still emits positional flag line) until ship.ts is ported. Grep path still in use here — replaced by leaf 5. |
| 5 | `codegen-bindings` | 0 (new) | **High value** — kills the grep gate. | Populates `sdk/bindings.ts` + `sdk/binding-names.ts` from the current `INGREDIENTS` array. Emits `framework/_generated_bindings.zig` + `runtime/_generated_host_globals.d.ts`. Extends `cli/registry/resolve.ts` to harvest hook-side `bindings` exports (section 5). Both paths (grep + harvest) coexist during the per-hook conversion in section 8's lints; grep path is deleted as part of leaf 9 (`ship`). |
| 6 | `watch-and-push` | 99 | Medium. Spawns esbuild watcher + polls mtime + pushes. | Second consumer of `cli/cart/bundle.ts` — removes 1 more dup. |
| 7 | `help` | 150 | Low. Reads registry, prints. | First command users hit; gets the framing right. |
| 8 | `init` | 838 | Medium. Template scaffolder. | Self-contained, doesn't talk to build pipeline. |
| 9 | `ship` (bash 963 + 213) | 1176 | **High** — the payoff. **Absorbs `ship-tui`.** | One command, two substrates (see "Substrate selection" in §2). Collapses 18 `WANT_*` vars, 3 parallel arrays, the `EXPECTED` map; removes the `read -r WANT_…` contract. The `-Dhas-gpu=false` headless path that was `ship-tui` becomes `ship --tui` (or `"surface":"tui"` in the manifest) — not a second command. Also where the grep-fallback path inside `metafile-gate` finally deletes (every cart's hooks have declared `bindings` by this point). |
| 10 | `dev` (bash 306 + 110) | 416 | Medium-high. **Absorbs `tui`.** | One persistent hot-reload host, two substrates. Spawn-or-push, orphan reap, signal trap; trap logic moves to v8cli's `installSignalHandlers()`, orphan reap via `__fs_stat_json` on `/proc/<pid>/`. The old `scripts/tui` (a one-shot esbuild→zig build→exec) is **upgraded** into `dev --tui`: a real persistent hot-reload host for the TUI substrate, matching what users already assumed `tui` was. Final consumer of `cli/cart/bundle.ts` — last flag dup gone. |
| 11 | `ship-tui` alias | — | Trivial. | Thin shim: `rjit ship-tui X` → `rjit ship X --tui`. No separate port; kept for muscle memory, deleted in the shim sweep. |
| 12 | `tui` alias | — | Trivial. | Thin shim: `rjit tui X` → `rjit dev X --tui`. `scripts/devshell` (which execs `tui`) rides the alias unchanged. Deleted in the shim sweep. |
| 13 | `autotest` (bash 136) | 136 | Medium. Subprocess streaming + grep verdict. | Calls Python `autotest-grid` (keeps Python). |
| 14 | `classify` | 2,991 | High by LOC but isolated (no callers). | Mostly mechanical TS port; the AST scanning logic is the value, not the framing. |
| 15 | `gallery-component` | 1,638 | Medium. Generator with template logic. | Self-contained. |
| 16 | `gallery-sizes`, `gallery-suspects` | 717 + 177 | Low. Static analyzers. | |
| 17 | `strip-ambient-imports` | 189 | Low. AST-light rewriter. | |
| 18 | `bake-icons` | 329 | Low. SDF atlas baker. | |
| 19 | `pack-sdk` | 336 | Medium. Builds the SDK distributable — meta. | Updates needed when `cli/` itself joins the payload. |
| 20 | `firecracker-build` | 246 | Low. Standalone. | |

**Shim deletion pass** (post-migration): walk every reference from section 7 and update `scripts/X` → `rjit X`. Delete shims. Update docs.

---

## 7. External callers map

~172 references to `scripts/` and `tools/` outside `scripts/` itself. Three categories:

### Must-update at port time (user-facing CLI surface)

- `README.md` — multiple `./scripts/ship hello`, `./scripts/dev hello`, `./scripts/fetch-zig.sh` examples.
- `CLAUDE.md` — behavior docs for `./scripts/ship`, `./scripts/dev`, internal flock note.
- `AGENTS.md` — build command examples.

These get updated as their referenced command ports. During the side-by-side phase, shims keep them valid; the docs update is the last step before deleting a shim.

### Should-update (docs sweep at end)

- `docs/v8/cli.md`, `docs/v8/classifier.md`, `docs/v8/cli_init.md`, `docs/v8/tui.md`, `docs/v8/postgres.md`, `docs/v8/whisper.md`, `docs/v8/telemetry.md`, `docs/v8/llamacpp.md` — the technical reference set.
- `sdk/README.md` — `tools/v8cli scripts/sdk-dependency-resolve.js` example becomes `rjit metafile-gate`.
- Cart gallery procedural memory (`cart/app/gallery/data/core/procedural-memory.ts:127,226`) — AI instruction strings that say "Run `./scripts/gallery-component …`". These are read by the gallery cart itself at runtime; updating them improves AI behavior but doesn't break anything.
- `cart/app/app.md`, `cart/{image-gen,media}/README.md`.

### No action needed

- `build.zig` (12 comment refs at lines 65, 67, 264, 356, 374, 382, 412, 472, 508, 586, 627, 643) — internal notes explaining what scripts/ship does. Update only if the comments become misleading.
- `runtime/hooks/useHotState.ts:4,20` — comments only.
- `framework/firecracker/lib/with-worker-runtime.ts` and `framework/firecracker/recipes/worker-dev.ts` — reference `tools/v8cli` and `tools/esbuild` *paths*. These paths don't change. No action.
- `.claude/skills/{conformance,flight-check-loop,chad-audit,readme-sync,tidy}/*` — most refs are TSZ-era (frozen, in `tsz/`). The non-frozen ones can be updated alongside the docs sweep.
- `love2d/Makefile` — frozen tree. Ignored.

---

## 8. Verification recipe

Each port is verified against a **byte-identical or behavior-identical** signal versus the bash/JS predecessor. The user's `[POV verdict]` rule applies — if a port doesn't change observable behavior in the expected ways, it shipped.

### Per-command verification

| Command | Verification signal |
|---------|--------------------|
| `cart-manifest-field` | Diff: `tools/v8cli scripts/cart-manifest-field.js cart.json icon` vs `rjit cart-manifest-field cart.json icon` → identical stdout, identical exit code, on every cart with a `cart.json`. |
| `push-bundle` | Push a known-good bundle to a running dev host with both implementations; both must produce `OK` reply and identical exit codes for {missing socket, refused, ok, timeout}. |
| `cart-bundle` | Run both on the same cart entry; diff the output `.metafile.json` (must be identical) and the bundle (must be byte-identical modulo esbuild-internal nondeterminism, if any). |
| `metafile-gate` | Diff the `0/1` positional output line. Order must match `shipGate.flagOrder` exactly. |
| `codegen-bindings` | Run on a clean checkout: `rjit codegen-bindings` must produce a `framework/_generated_bindings.zig` whose `INGREDIENTS` array is semantically identical to the hand-written one in today's `v8_app.zig` (same names, same `required` flags, same register-fn suffixes). Then `zig build app -Dapp-name=hello` succeeds. And `rjit codegen-bindings --check` is a no-op (exit 0) — any drift exits nonzero. |
| `watch-and-push` | Touch a cart file under both watchers; both push within 500 ms of esbuild's "[watch] build finished". |
| `ship` | **The big one.** For each of 3 representative carts (hello, sweatshop, media), run both `./scripts/ship` and `rjit ship` and diff: (1) zig command line (must match), (2) `zig-out/manifest/v8-ingredients/*.flag` (must match), (3) the produced `zig-out/bin/<name>` size + ldd output + extracted tarball contents (must match modulo timestamps). |
| `dev` | Boot both, run a cart, hot-reload a file, switch tabs. Behavior must be observably identical (the user's POV rule). |
| `ship --tui` (was `ship-tui`) | Same shape as ship — bytes-identical headless binary. Plus three substrate checks: (1) `rjit ship X --tui` == `rjit ship-tui X` (alias) == the old `./scripts/ship-tui X` binary; (2) a cart with `"surface":"tui"` in `cart.json` builds headless with **no** flag; (3) `--gui` on a `"surface":"tui"` cart overrides back to windowed. |
| `dev --tui` (was `tui`) | Persistent host boots for the TUI substrate; hot-reload a `.tsx`, observe re-eval (the *new* behavior — old `tui` was one-shot). `rjit tui X` (alias) and `rjit dev X --tui` behave identically; `scripts/devshell` still launches. |
| `autotest` | Same shape as ship — bytes-identical binary or run-identical behavior. |
| Codegen tools (`classify`, `gallery-*`, `strip-ambient-imports`, `bake-icons`) | Output diff on a fixed corpus. |
| `pack-sdk` | `rjit pack-sdk` produces a distributable that, when extracted, can build a hello-world cart. Same test the bash version implicitly relied on. |

### Codegen lints

`rjit codegen-bindings --strict` emits four diagnostics; nonzero exit on any. These enforce the discipline that makes the hook-declared contract self-reinforcing. They run in CI once leaf 9 lands and the grep fallback is deleted (the lints replace it).

| Lint | Detects | Fix |
|------|---------|-----|
| `orphan-binding` | A `BindingSpec` in `sdk/bindings.ts` that no hook file declares and that isn't `required: true`. | Remove the entry or add the hook that uses it. |
| `stale-declaration` | A hook file declares `bindings: ['pg']` but contains no `__pg_*` call. | Either remove `'pg'` from the array or remove the dead host-fn call. |
| `unmediated-call` | A file under `cart/**` or `runtime/**` calls a `__<prefix>_*` host fn matching some binding's `hostFns[].js`, but the file does not declare `bindings: [<that-binding>]`. | Declare the binding in the file, or move the call into a hook that does. |
| `missing-zig-decl` | A `BindingSpec` has `tickDrain: 'real'` or `init: 'real'`, but the referenced `.zig` module doesn't actually declare those fns. | Either change the spec to `'noop'` or add the fn to the module. Verified via `@hasDecl` in the generated file (becomes a compile-time error in Zig, but the lint catches it earlier with a friendlier message). |

The `unmediated-call` lint is grep at *review time*, not at build time — its job is enforcing the convention, not gating the build. A false positive becomes a PR comment, not a broken cart.

### Cross-cutting

- **No new Zig bindings without justification.** Section 3's flock decision (shell out) is the template.
- **Registry round-trip.** `cli/registry/load.ts` parses `sdk/dependency-registry.json`, serializes it back, and the serialized form is byte-identical (modulo key ordering) to the input. Catches schema drift.
- **`.d.ts` syntax check.** `tools/v8cli` won't load a `.d.ts` directly, but `tools/esbuild --bundle cli/host/bindings.d.ts --check` (or equivalent) ensures the file parses.

### Done criteria for the migration as a whole

1. Every command in section 6 has a passing per-command verification.
2. Every reference in section 7's "must-update" list points at a `rjit X` invocation.
3. The shims in `scripts/` have been deleted.
4. The bash floor in section 3 is the only `.sh`/`bash` in the repo (verified by `find . -type f \( -name '*.sh' -o -name 'scripts/*' \) | grep -v archive/ | grep -v tsz/ | grep -v love2d/`).
5. The `WHISPER_TODO.md` analog for this migration — call it `cli/PROGRESS.md` if it grows large — is empty or removed.

---

## 9. Session log

Append-only. Each entry: date, session id (if known), what landed, what's next, what surprised us.

### 2026-05-22 — session a478 — spec written

- The spec is complete (sections 1–8 + Appendix B as the file-content reference set). Sessions from here forward are **implementation**, not "finalize section X".
- Decisions locked in this session:
  - Spec location: `cli/SPEC.md` (co-located with future code).
  - CLI binary: `rjit`.
  - Bundling target: `tools/rjit.js` + `tools/rjit` shell wrapper.
  - Migration: side-by-side. `cli/` is a new tree. `scripts/` keeps working until each port's shim lands.
  - Bash floor: 3 fetchers + `commit-msg` hook + emitted self-extractor strings (~120 LOC total).
  - flock: shell out to `flock(1)` rather than add a v8cli binding.
  - Image manipulation: Python stays.
  - TS strictness: `"strict": true` + `"noUncheckedIndexedAccess": true` from the first `.ts` file (Appendix B's `tsconfig.json`).
  - `.d.ts` strategy: hand-write the first pass from Appendix B.1; revisit codegen from Zig only if the surface grows past ~60 bindings.
  - `event-loop-smoke.ts`: stays at `scripts/event-loop-smoke.ts` for now. Moves to `cli/commands/smoke/event-loop.ts` only if a sibling smoke-test family materializes.
  - Verification test corpus: hello + sweatshop + media. Locked when ship.ts port begins.
- Inventory captured: 40 host bindings (cli=25, fs=14, process=7), 33 features, 18 ship-gate flags, 22 native libraries, 2 trigger kinds, ~172 external refs.
- **Next session — implementation Leaf 1 (`cart-manifest-field`).** Create `cli/`, `cli/tsconfig.json`, `cli/host/bindings.d.ts`, `cli/host/{fs,log,argv}.ts`, `cli/cart/manifest.ts`, `cli/commands/cart-manifest-field.ts`, `cli/main.ts` (dispatch with only this one command wired), `tools/rjit` shell wrapper, and bundle to `tools/rjit.js`. Verify against `scripts/cart-manifest-field.js` per section 8. Land the `scripts/cart-manifest-field.js` shim last. Estimated agent-time: 20–40 min.
- **Surprised us:** registry has a `featureMarker` trigger kind documented in `sdk/README.md` but never used in the JSON. Appendix B's schema accepts it; the resolver leaves it as TODO.

### 2026-05-22 — session 97ec — bindings registry & codegen folded into Section 5

- The grep-based metafile gate (`scripts/ship-metafile-gate.js`'s `__pg_` / `__tcp_` / `__proc_` etc. string-matching) is being replaced by a typed registry + hook-declared contract + codegen-into-Zig.
- **Initially drafted as a parallel Section 10 + Appendix C, then consolidated.** The two ideas (CLI migration + bindings registry) share a single source of truth (`cli/registry/`) and a single consumer (the CLI), so they belong in one place. Final shape:
  - The bindings facet lives in Section 5 ("Registry surface") alongside features / shipGate / nativeLibraries / cliPayload / trigger kinds. Four new subsections cover it: *Binding shape*, *Hook-side declaration*, *Walker resolution*, *Locked-in design decisions*.
  - `codegen-bindings` is a real leaf in Section 6's migration table (leaf 5, between `metafile-gate` and `watch-and-push`).
  - The four lints (`orphan-binding` / `stale-declaration` / `unmediated-call` / `missing-zig-decl`) live in Section 8 as a new "Codegen lints" subsection — they're build-time verifications, not a separate concept.
  - Section 4's hand-written `cli/host/bindings.d.ts` gets a forward-reference: replaced by `runtime/_generated_host_globals.d.ts` once leaf 5 lands.
  - The implementation skeletons (TS schema, registry seed, emitter, sample outputs, converted hook, walker extension) are appended to Appendix B as B.18–B.25. Appendix C was absorbed.
- **Next session for this workstream:** materialize Appendix B.18–B.25 — write `sdk/bindings.ts` (the registry), `sdk/binding-names.ts` (the type-only file hook files import), `cli/commands/codegen-bindings.ts` (the emitter), and one or two converted hook files (`runtime/hooks/usePg.ts` declares `export const bindings = ['pg'] as const`). Verify by running the codegen, confirming `framework/_generated_bindings.zig` builds inside `v8_app.zig` and matches the current INGREDIENTS array byte-for-byte (modulo formatting).

### 2026-05-23 — session 89f3 — substrate folded into ship/dev; ship-tui/tui demoted to aliases

- **User directive:** `ship` and `dev` should each cover **both** the GUI and TUI substrates, selected by a flag or a `cart.json` field — "so that we don't have so many confusing script entries." Four cart-running scripts (`ship` / `dev` / `ship-tui` / `tui`) collapse to two commands × a substrate parameter.
- **Why now:** caught the migration exactly at the boundary. `cli/PROGRESS.md` shows slices 1–8 done; slice 9 (`ship`) is next and unstarted, and `dev`/`ship-tui`/`tui` (10–12) are untouched. No port to redo — this just redirects the upcoming leaves. Encoding it after `ship.ts`/`dev.ts` had landed would have meant a re-port.
- **What landed in the spec:**
  - New §2 subsection *Substrate selection (gui vs tui)*: first-match-wins resolver — `--tui`/`--gui` flag > `cart.json` `"surface"` > default `gui`. Maps to the single `-Dhas-gpu=false` / `BundleMode='tui-host'` difference; everything downstream is shared. Anchored to the runtime's own one-target reality (commit `5bf461d25` deleted `v8_tui_app.zig` + the `tui-app` build step; `v8_app.runHeadless()` is the dispatch).
  - §6 table: leaf 9 `ship` absorbs `ship-tui`; leaf 10 `dev` absorbs `tui`; leaves 11/12 demoted to thin aliases deleted in the shim sweep.
  - `surface?: 'gui' | 'tui'` added to `CartManifest` (Appendix B.13).
  - §8 verification: substrate-equivalence checks (flag == alias == old script binary; manifest-only build; `--gui` override).
- **Deliberate behavior change (flagged, not silent):** the old `scripts/tui` was a one-shot esbuild→zig build→exec, **not** a persistent host — a real surprise to the user, who assumed it was "dev for TUI." The directive resolves that by *making it true*: `dev --tui` becomes a persistent hot-reload TUI host. The implementing session (leaf 10) must confirm the dev host's spawn-or-push / watcher path works headless; if persistent-TUI-dev proves infeasible, fall back to one-shot under the same `dev --tui` name and note it here.
- **Bug surfaced en route (separate, unfixed):** `scripts/tui` currently calls the dead `zig build tui-app` step → `no step named 'tui-app'`; `scripts/devshell` is broken transitively (it execs `tui`). `scripts/ship-tui` was migrated to `zig build app -Dhas-gpu=false` in `5bf461d25` but `scripts/tui` was missed. The alias-ification above fixes this for good once leaf 10 lands; until then `scripts/tui` needs a one-line repair if anyone needs it working in the interim.
- **Next session:** unchanged target — slice 9 (`ship`), now scoped to both substrates per the §2 resolver. Land `ship-tui` as an alias in the same slice rather than as separate leaf 11.

---

## Appendix A — pending decisions (review when their leaf is reached)

1. **macOS code-signing path in `ship.ts`.** The bash version runs `install_name_tool` + `codesign --force --sign -` if available. The TS port should preserve this but also detect `XCODE_PATH` / `DEVELOPER_DIR` for future signing-key flows. Decide when porting `ship.ts`.
2. **Watchdog for `dev.ts`'s embedded pg.** Bash `dev` `ensure_pg_running()` spawns pg via `pg_ctl` which daemonizes — survives the dev process. The TS port should preserve this (no `__proc_watch_*` attached). Confirm at port time.
3. **Shim deletion timing.** Delete shims per-command or all at once after the docs sweep? Default: per-command, immediately after the docs sweep for that command. Reconsider if the partial state causes parallel-session confusion.

---

## Appendix B — implementation skeletons (the working set)

The contents below are the files implementation sessions create. Copy-paste, then fill in marked `// TODO(leaf-N)` lines as the corresponding migration leaf is reached. Each file is self-contained.

### B.0 — `cli/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "isolatedModules": true,
    "esModuleInterop": false,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": false,
    "noEmit": true,
    "types": []
  },
  "include": ["**/*.ts", "**/*.d.ts"]
}
```

No `dom` lib — v8cli is a CLI host, not a browser. `noEmit: true` because bundling is via `tools/esbuild`, not `tsc`. `types: []` keeps `@types/node` off; v8cli is not Node.

### B.1 — `cli/host/bindings.d.ts` (complete)

```ts
// cli/host/bindings.d.ts — typed contract for the 40 __* host functions
// registered by framework/v8_bindings_{cli,fs,process}.zig.
//
// Source: framework/v8_bindings_cli.zig (lines 938–965),
//         framework/v8_bindings_fs.zig (lines 634–647),
//         framework/v8_bindings_process.zig (lines 650–656).
//
// Signatures reverse-engineered from argString/argI32/argF64/argBool calls.
// Until the Zig sources gain /// doc-comments and a codegen step, this file
// is the authoritative contract.

declare global {
  // ── v8_bindings_cli.zig ─────────────────────────────────────────────

  /** Script argv as a JSON-encoded string array. argv[0] is the script path. */
  function __argv(): string;

  /** Get an environment variable, or null if unset. */
  function __env(name: string): string | null;

  /** Exit process with the given code (truncated to i32). */
  function __exit(code: number): void;

  /** Process cwd. */
  function __cwd(): string;

  /** Millis since epoch (monotonic-ish). */
  function __nowMs(): number;

  /** Block the script for `ms` milliseconds. */
  function __sleepMs(ms: number): void;

  /** Raw write to stdout. No newline appended. */
  function __writeStdout(text: string): void;

  /** Raw write to stderr. No newline appended. */
  function __writeStderr(text: string): void;

  /** Toggle terminal raw mode. enable=1 turns off echo + canonical. */
  function __setStdinRaw(enable: number): boolean;

  /** Non-blocking drain of stdin. Returns "" when no data is queued. */
  function __readStdin(): string;

  /** Terminal size via TIOCGWINSZ. Returns JSON.stringify([cols, rows]). */
  function __termSize(): string;

  /**
   * Blocking subprocess. argsJson = JSON.stringify(string[]).
   * Returns JSON.stringify({code: number, stdout: string, stderr: string}).
   */
  function __spawnSync(cmd: string, argsJson: string, stdin: string): string;

  /** Async subprocess. Returns child id (>= 0) or -1 on failure. */
  function __spawn(cmd: string, argsJson: string): number;

  /** Read one line from a spawned child's stdout. null on timeout. */
  function __childReadLine(id: number, timeoutMs: number): string | null;

  /** SIGTERM a spawned child. */
  function __childKill(id: number): boolean;

  /** Unix socket connect. Returns fd (>= 0) or -1 on failure. */
  function __unixConnect(path: string): number;

  /** Write bytes to a unix socket fd. Returns bytes written or -1. */
  function __unixWrite(fd: number, data: string): number;

  /** Drain a unix socket fd within timeoutMs, up to maxBytes. */
  function __unixReadAll(fd: number, timeoutMs: number, maxBytes: number): string;

  /** Close a unix socket fd. */
  function __unixClose(fd: number): void;

  /** Hotstate (persists across dev hot-reload). */
  function __hotGet(key: string): string | null;
  function __hotSet(key: string, value: string): void;
  function __hotRemove(key: string): void;
  function __hotClear(): void;
  /** Returns JSON.stringify(allKeys). */
  function __hotKeys(): string;

  // ── v8_bindings_fs.zig ──────────────────────────────────────────────

  /** Read file (max 16 MB). null on any error. PREFER over __fs_readfile. */
  function __fs_read(path: string): string | null;

  /** Write file (creates parent dirs). true on success. */
  function __fs_write(path: string, content: string): boolean;

  /** File or directory exists. */
  function __fs_exists(path: string): boolean;

  /** List directory entries as JSON.stringify(string[]). Names only, no recursion. */
  function __fs_list_json(path: string): string;

  /** Stat as JSON.stringify({size, mtimeMs, isDir}) or null. */
  function __fs_stat_json(path: string): string | null;

  /** mkdir -p. */
  function __fs_mkdir(path: string): boolean;

  /** rm -rf. */
  function __fs_remove(path: string): boolean;

  /** Legacy: read file, empty string on error. Prefer __fs_read. */
  function __fs_readfile(path: string): string;

  /** Legacy: write file, 0=ok / -1=err. Prefer __fs_write. */
  function __fs_writefile(path: string, content: string): number;

  /** Legacy: delete file, 0=ok / -1=err. Prefer __fs_remove. */
  function __fs_deletefile(path: string): number;

  /** Legacy: list directory — returns a real V8 Array, NOT a JSON string. */
  function __fs_scandir(path: string): string[];

  /** Recursive media-file scan. Returns JSON.stringify(MediaFile[]). */
  function __fs_media_scan_json(dir: string, recursive?: boolean, maxDepth?: number): string;

  /** Media stats. Returns JSON.stringify({total, byType, totalSize, largestFile}). */
  function __fs_media_stats_json(dir: string, recursive?: boolean, maxDepth?: number): string;

  /** Alias of __fs_media_scan_json. */
  function __fs_media_index_json(dir: string, recursive?: boolean, maxDepth?: number): string;

  // ── v8_bindings_process.zig ─────────────────────────────────────────
  //
  // The proc_* family emits events on the runtime FFI bus rather than
  // returning data inline:
  //   proc:stdout:<pid>   (line-buffered)
  //   proc:stderr:<pid>   (line-buffered)
  //   proc:exit:<pid>     ({code, signal})
  //   proc:ram:<pid>      (after __proc_watch_add)
  //   proc:cpu:<pid>      (after __proc_watch_add)

  /**
   * Spawn process with explicit stdin handling.
   * specJson = JSON.stringify({cmd, args, cwd?, stdin: "pipe" | "inherit" | "ignore"}).
   * Returns pid, or 0 on failure.
   */
  function __proc_spawn(specJson: string): number;

  /** Send a signal to a tracked pid. Default SIGTERM. */
  function __proc_kill(pid: number, signal?: 'SIGTERM' | 'SIGKILL' | 'SIGHUP' | 'SIGINT'): boolean;

  function __proc_stdin_write(pid: number, data: string): boolean;
  function __proc_stdin_close(pid: number): void;

  /** Process stats (Linux only). Returns JSON.stringify or null. */
  function __proc_stat(pid: number): string | null;

  function __proc_watch_add(pid: number, intervalMs: number): void;
  function __proc_watch_remove(pid: number): void;

  // ── runtime shims (installed by v8_cli.zig:69–90, not bindings) ─────

  const console: {
    log: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };

  const process: {
    readonly argv: string[];
    readonly env: Record<string, string | undefined>;
    exit: (code: number) => void;
    cwd: () => string;
    readonly platform: 'linux';
  };
}

export {};
```

### B.2 — `cli/host/fs.ts`

```ts
// cli/host/fs.ts — typed, throwing wrappers over __fs_*.
//
// Throws on the documented failure modes. Use try* variants when the
// caller wants null instead.

export class FsError extends Error {
  constructor(public op: string, public path: string, message?: string) {
    super(`fs ${op} failed: ${path}${message ? ' — ' + message : ''}`);
  }
}

export function fsRead(path: string): string {
  const r = __fs_read(path);
  if (r === null) throw new FsError('read', path);
  return r;
}

export function tryFsRead(path: string): string | null {
  return __fs_read(path);
}

export function fsWrite(path: string, content: string): void {
  if (!__fs_write(path, content)) throw new FsError('write', path);
}

export function fsExists(path: string): boolean {
  return __fs_exists(path);
}

export interface FsStat { size: number; mtimeMs: number; isDir: boolean; }

export function fsStat(path: string): FsStat {
  const r = __fs_stat_json(path);
  if (r === null) throw new FsError('stat', path);
  return JSON.parse(r) as FsStat;
}

export function tryFsStat(path: string): FsStat | null {
  const r = __fs_stat_json(path);
  return r === null ? null : (JSON.parse(r) as FsStat);
}

export function fsList(path: string): string[] {
  const r = __fs_list_json(path);
  return JSON.parse(r) as string[];
}

export function fsMkdir(path: string): void {
  if (!__fs_mkdir(path)) throw new FsError('mkdir', path);
}

export function fsRemove(path: string): void {
  if (!__fs_remove(path)) throw new FsError('remove', path);
}

/** JSON read with parse-error reporting. */
export function fsReadJson<T>(path: string): T {
  const raw = fsRead(path);
  try { return JSON.parse(raw) as T; }
  catch (e) { throw new FsError('parse-json', path, (e as Error).message); }
}
```

### B.3 — `cli/host/process.ts`

```ts
// cli/host/process.ts — typed wrappers over __spawn{,Sync} and __proc_*.

export interface SpawnResult { code: number; stdout: string; stderr: string; }

export function spawnSync(cmd: string, args: string[], stdin: string = ''): SpawnResult {
  const r = __spawnSync(cmd, JSON.stringify(args), stdin);
  return JSON.parse(r) as SpawnResult;
}

/** Spawn and throw if non-zero. Returns stdout. */
export function run(cmd: string, args: string[], stdin: string = ''): string {
  const r = spawnSync(cmd, args, stdin);
  if (r.code !== 0) {
    const msg = `${cmd} exited ${r.code}\n${r.stderr || r.stdout}`;
    throw new Error(msg);
  }
  return r.stdout;
}

export interface AsyncChild { id: number; }

export function spawn(cmd: string, args: string[]): AsyncChild {
  const id = __spawn(cmd, JSON.stringify(args));
  if (id < 0) throw new Error(`spawn failed: ${cmd}`);
  return { id };
}

export function readChildLine(child: AsyncChild, timeoutMs: number): string | null {
  return __childReadLine(child.id, timeoutMs);
}

export function killChild(child: AsyncChild): void {
  __childKill(child.id);
}

// ── event-bus subprocess (__proc_*) — used by dev's pg / cart hooks ───
// Most build scripts only need spawnSync/run/spawn above. The
// event-emitting family below is for dev.ts's pg supervisor and any
// future long-lived watchers.

export interface ProcSpec {
  cmd: string;
  args: string[];
  cwd?: string;
  stdin: 'pipe' | 'inherit' | 'ignore';
}

export function procSpawn(spec: ProcSpec): number {
  const pid = __proc_spawn(JSON.stringify(spec));
  if (pid === 0) throw new Error(`procSpawn failed: ${spec.cmd}`);
  return pid;
}

export function procKill(pid: number, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): void {
  __proc_kill(pid, signal);
}
```

### B.4 — `cli/host/net.ts`

```ts
// cli/host/net.ts — typed wrappers over __unix*.

export class SocketError extends Error {}

export function unixConnect(path: string): number {
  const fd = __unixConnect(path);
  if (fd < 0) throw new SocketError(`connect failed: ${path}`);
  return fd;
}

export function unixWrite(fd: number, data: string): void {
  const n = __unixWrite(fd, data);
  if (n < 0) throw new SocketError(`write failed (fd=${fd})`);
}

export function unixReadLine(fd: number, deadlineMs: number): string {
  let reply = '';
  while (reply.indexOf('\n') === -1) {
    const remaining = deadlineMs - __nowMs();
    if (remaining <= 0) throw new SocketError('timeout');
    const chunk = __unixReadAll(fd, remaining, 4096);
    if (chunk === null) continue;          // timeout on this poll
    if (chunk === '') throw new SocketError('EOF before newline');
    reply += chunk;
  }
  return reply.slice(0, reply.indexOf('\n'));
}

export function unixClose(fd: number): void {
  __unixClose(fd);
}
```

### B.5 — `cli/host/log.ts`

```ts
// cli/host/log.ts — leveled writes. Replaces the per-script `die()` pattern.

export function out(...parts: string[]): void { __writeStdout(parts.join('') + '\n'); }
export function err(...parts: string[]): void { __writeStderr(parts.join('') + '\n'); }

export function info(tag: string, ...parts: string[]): void {
  __writeStdout(`[${tag}] ${parts.join('')}\n`);
}

export function warn(tag: string, ...parts: string[]): void {
  __writeStderr(`[${tag}] ${parts.join('')}\n`);
}

export function die(tag: string, msg: string, code: number = 1): never {
  __writeStderr(`[${tag}] ${msg}\n`);
  __exit(code);
  throw new Error('unreachable');          // appease TS control flow
}
```

### B.6 — `cli/host/argv.ts`

```ts
// cli/host/argv.ts — one argv parser. Replaces normalizeArgv copy-paste.

export interface ArgSpec {
  positional?: string[];                   // names of expected positional args
  flags?: Record<string, 'bool' | 'string' | 'number'>;
  passthroughAfter?: string;               // e.g. "--" — everything after collected as rest
}

export interface ParsedArgs {
  positional: Record<string, string>;
  flags: Record<string, string | number | boolean>;
  rest: string[];
}

export function parseArgs(argv: string[], spec: ArgSpec): ParsedArgs {
  const out: ParsedArgs = { positional: {}, flags: {}, rest: [] };
  const positionals = spec.positional ?? [];
  let posIdx = 0;
  let collecting = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (collecting) { out.rest.push(a); continue; }
    if (a === spec.passthroughAfter) { collecting = true; continue; }
    if (a.startsWith('--')) {
      const name = a.slice(2);
      const kind = spec.flags?.[name];
      if (!kind) throw new Error(`unknown flag: ${a}`);
      if (kind === 'bool') { out.flags[name] = true; continue; }
      const next = argv[i + 1];
      if (next === undefined) throw new Error(`flag ${a} requires a value`);
      i++;
      out.flags[name] = kind === 'number' ? Number(next) : next;
      continue;
    }
    const posName = positionals[posIdx++];
    if (!posName) throw new Error(`unexpected positional: ${a}`);
    out.positional[posName] = a;
  }

  return out;
}
```

### B.7 — `cli/registry/schema.ts`

```ts
// cli/registry/schema.ts — typed mirror of sdk/dependency-registry.json.
//
// 1:1 with the JSON. No .optional() escape hatches where the JSON is
// consistent. Validators in cli/registry/load.ts enforce shape at load.

export interface Registry {
  schemaVersion: 1;
  description: string;
  cliPayload: CliPayload;
  nativeLibraries: Record<string, NativeLibrarySpec>;
  features: Record<string, FeatureSpec>;
  shipGate: { flagOrder: ShipGateFlag[] };
}

export interface CliPayload {
  tools: Record<string, ToolSpec>;
  jsPackages: Record<string, JsPackageSpec>;
}

export type Phase = 'scaffold' | 'build' | 'ship' | 'scripts';

export interface ToolSpec {
  kind: 'toolchain' | 'host-tool' | 'bundler';
  requiredFor: Phase[];
  version?: string;
  payloadPath: string;
  supportPaths?: string[];
  packPolicy: 'required' | 'optional';
  status: 'present' | 'missing';
}

export interface JsPackageSpec {
  requiredFor: Phase[];
  vendorPath: string;
  packPolicy: 'required' | 'optional';
}

export type LinkPolicy =
  | 'engine-v8' | 'foundational' | 'system-assumed'
  | 'feature-gated' | 'never' | 'deprecated';
export type BundlePolicy =
  | 'always' | 'feature-gated' | 'vendored-source' | 'never';
export type NativeLibKind =
  | 'static-library' | 'dynamic-library' | 'zig-package'
  | 'vendored-c-source' | 'vendored-library'
  | 'platform-library' | 'platform-framework';

export interface NativeLibrarySpec {
  kind: NativeLibKind;
  payloadPath?: string | string[];
  systemNames?: string[];
  frameworks?: string[];
  buildImport?: string;
  linkPolicy: LinkPolicy;
  bundlePolicy: BundlePolicy;
  buildFlag?: string;
  includePaths?: string[];
  sources?: string[];
  platforms?: ('linux' | 'macos' | 'windows')[];
}

export type TriggerKind = 'metafileInput' | 'metafileInputPrefix' | 'featureMarker';

export interface Trigger { kind: TriggerKind; input: string; }

export interface FeatureSpec {
  triggers?: Trigger[];
  buildOptions?: string[];
  v8Bindings?: string[];
  nativeLibraries?: string[];
  tools?: string[];
  jsPackages?: string[];
  requiredFor?: Phase[];
  shipGate?: ShipGateFlag;
}

// ── Typed gate flags (replaces the positional `read -r WANT_…` contract) ──

export const SHIP_GATE_FLAGS = [
  'privacy', 'useHost', 'useConnection', 'fs', 'websocket',
  'telemetry', 'zigcall', 'sdk', 'voice', 'whisper',
  'onnx', 'pg', 'embed', 'sqlite', 'terminal',
  'process', 'window', 'doom',
] as const;
export type ShipGateFlag = typeof SHIP_GATE_FLAGS[number];

export type GateFlags = Record<ShipGateFlag, boolean>;

export function emptyGateFlags(): GateFlags {
  const out = {} as GateFlags;
  for (const k of SHIP_GATE_FLAGS) out[k] = false;
  return out;
}

/** Render a GateFlags into the legacy positional 0/1 line that scripts/ship + scripts/ship-tui parse. */
export function gateFlagsToPositional(g: GateFlags): string {
  return SHIP_GATE_FLAGS.map(k => g[k] ? '1' : '0').join(' ');
}
```

### B.8 — `cli/registry/load.ts`

```ts
// cli/registry/load.ts — read + validate sdk/dependency-registry.json.

import { Registry, SHIP_GATE_FLAGS } from './schema.ts';
import { fsReadJson } from '../host/fs.ts';
import { die } from '../host/log.ts';

export function loadRegistry(path: string = 'sdk/dependency-registry.json'): Registry {
  const raw = fsReadJson<Registry>(path);
  validateRegistry(raw, path);
  return raw;
}

function validateRegistry(r: Registry, path: string): void {
  if (r.schemaVersion !== 1) die('registry', `${path}: unsupported schemaVersion ${r.schemaVersion}`);

  const flagSet = new Set<string>(SHIP_GATE_FLAGS);
  for (const name of r.shipGate.flagOrder) {
    if (!flagSet.has(name)) die('registry', `${path}: unknown gate flag ${name}`);
  }
  if (r.shipGate.flagOrder.length !== SHIP_GATE_FLAGS.length) {
    die('registry', `${path}: shipGate.flagOrder length drift: schema has ${SHIP_GATE_FLAGS.length}, JSON has ${r.shipGate.flagOrder.length}`);
  }

  // Cross-reference features → nativeLibraries / tools / jsPackages.
  for (const [name, f] of Object.entries(r.features)) {
    for (const lib of f.nativeLibraries ?? []) {
      if (!(lib in r.nativeLibraries)) die('registry', `${path}: feature '${name}' references missing nativeLibrary '${lib}'`);
    }
    for (const tool of f.tools ?? []) {
      if (!(tool in r.cliPayload.tools)) die('registry', `${path}: feature '${name}' references missing tool '${tool}'`);
    }
    for (const pkg of f.jsPackages ?? []) {
      if (!(pkg in r.cliPayload.jsPackages)) die('registry', `${path}: feature '${name}' references missing jsPackage '${pkg}'`);
    }
    if (f.shipGate && !flagSet.has(f.shipGate)) {
      die('registry', `${path}: feature '${name}' references unknown shipGate '${f.shipGate}'`);
    }
  }
}
```

### B.9 — `cli/registry/resolve.ts`

```ts
// cli/registry/resolve.ts — esbuild metafile → typed FeatureSelection.

import { Registry, FeatureSpec, GateFlags, emptyGateFlags } from './schema.ts';
import { Metafile, shippedInputs } from '../cart/metafile.ts';

export interface FeatureSelection {
  features: string[];                      // names of matched features
  buildOptions: Set<string>;                // -D<x>=true, without prefix
  v8Bindings: Set<string>;
  nativeLibraries: Set<string>;
  tools: Set<string>;
  jsPackages: Set<string>;
  gateFlags: GateFlags;
}

export function resolveFeatures(registry: Registry, metafile: Metafile): FeatureSelection {
  const shipped = shippedInputs(metafile);
  const out: FeatureSelection = {
    features: [],
    buildOptions: new Set(),
    v8Bindings: new Set(),
    nativeLibraries: new Set(),
    tools: new Set(),
    jsPackages: new Set(),
    gateFlags: emptyGateFlags(),
  };

  for (const [name, f] of Object.entries(registry.features)) {
    const required = (f.requiredFor ?? []).length > 0;
    const matched = required || (f.triggers ?? []).some(t => triggerMatch(t, shipped));
    if (!matched) continue;

    out.features.push(name);
    for (const x of f.buildOptions ?? []) out.buildOptions.add(x);
    for (const x of f.v8Bindings ?? []) out.v8Bindings.add(x);
    for (const x of f.nativeLibraries ?? []) out.nativeLibraries.add(x);
    for (const x of f.tools ?? []) out.tools.add(x);
    for (const x of f.jsPackages ?? []) out.jsPackages.add(x);
    if (f.shipGate) out.gateFlags[f.shipGate] = true;
  }
  return out;
}

function triggerMatch(t: FeatureSpec['triggers'] extends (infer U)[] | undefined ? U : never, shipped: Set<string>): boolean {
  switch (t.kind) {
    case 'metafileInput':       return shipped.has(t.input);
    case 'metafileInputPrefix': for (const p of shipped) if (p.startsWith(t.input)) return true; return false;
    case 'featureMarker':       return shipped.has(t.input);  // currently unused; same semantics as metafileInput
  }
}
```

### B.10 — `cli/cart/resolve.ts`

```ts
// cli/cart/resolve.ts — resolve cart/<name>/index.tsx vs cart/<name>.tsx.

import { fsExists } from '../host/fs.ts';
import { die } from '../host/log.ts';

export interface CartLayout {
  name: string;
  entry: string;                           // absolute path to .tsx
  dir: string;                             // absolute path to cart dir (parent of entry)
  manifest: string | null;                 // absolute path to cart.json if present
}

export function resolveCart(name: string, cartRoot: string): CartLayout {
  const dir1 = `${cartRoot}/cart/${name}`;
  const file1 = `${dir1}/index.tsx`;
  if (fsExists(file1)) {
    const m = `${dir1}/cart.json`;
    return { name, entry: file1, dir: dir1, manifest: fsExists(m) ? m : null };
  }
  const file2 = `${cartRoot}/cart/${name}.tsx`;
  if (fsExists(file2)) {
    return { name, entry: file2, dir: `${cartRoot}/cart`, manifest: null };
  }
  die('cart', `not found: ${file1} or ${file2}`);
}
```

### B.11 — `cli/cart/bundle.ts` (the 4-place dup killer)

```ts
// cli/cart/bundle.ts — the canonical esbuild flag list for cart bundling.
//
// This module is the SINGLE source for the esbuild config that today lives
// in scripts/cart-bundle.js, scripts/watch-and-push.js, scripts/tui, and
// scripts/ship-tui. Every consumer goes through here.

import { run } from '../host/process.ts';

export type BundleMode = 'gpu-host' | 'tui-host' | 'cartridge';

export interface BundleOptions {
  rjitHome: string;                        // SDK install root
  cartEntry: string;                       // absolute path to cart .tsx
  outFile: string;                         // absolute path to bundle .js
  mode: BundleMode;
  watch?: boolean;
  termCols?: number;                       // tui modes only
  termRows?: number;
}

export function bundleFlags(opts: BundleOptions): string[] {
  const { rjitHome, cartEntry, outFile, mode } = opts;
  const cartridge = mode === 'cartridge';
  const tui = mode === 'tui-host';
  const runtimeEntry = cartridge
    ? `${rjitHome}/runtime/cartridge_entry.tsx`
    : tui
      ? `${rjitHome}/tui/entry.tsx`
      : `${rjitHome}/runtime/index.tsx`;

  const reactAlias = cartridge
    ? `${rjitHome}/runtime/cart_externs/react.cjs`
    : `${rjitHome}/deps/react`;
  const reconcilerAlias = cartridge
    ? `${rjitHome}/runtime/cart_externs/react_reconciler.cjs`
    : `${rjitHome}/deps/react-reconciler`;
  const schedulerAlias = cartridge
    ? `${rjitHome}/runtime/cart_externs/scheduler.cjs`
    : `${rjitHome}/deps/scheduler`;

  const base = [
    runtimeEntry,
    '--bundle',
    `--outfile=${outFile}`,
    `--metafile=${outFile}.metafile.json`,
    `--alias:@cart-entry=${cartEntry}`,
    `--alias:@reactjit/core=${rjitHome}/runtime/core_stub.ts`,
    `--alias:@reactjit/runtime=${rjitHome}/runtime`,
    `--alias:react=${reactAlias}`,
    `--alias:react-reconciler=${reconcilerAlias}`,
    `--alias:scheduler=${schedulerAlias}`,
    `--alias:loose-envify=${rjitHome}/deps/loose-envify`,
    `--alias:js-tokens=${rjitHome}/deps/js-tokens`,
    '--external:path',
    '--external:typescript',
  ];

  if (tui) {
    base.push(
      '--platform=neutral',
      '--main-fields=module,main',
      '--target=es2020',
      '--jsx=automatic',
      '--jsx-import-source=react',
      '--format=cjs',
      `--define:process.env.NODE_ENV="production"`,
      `--define:__TUI_COLS__=${opts.termCols ?? 80}`,
      `--define:__TUI_ROWS__=${opts.termRows ?? 24}`,
      '--log-level=warning',
      '--resolve-extensions=.tsx,.ts,.jsx,.js',
      '--conditions=default',
    );
  } else {
    base.push(
      '--format=iife',
      '--jsx-factory=__jsx',
      '--jsx-fragment=Fragment',
      `--inject:${rjitHome}/runtime/jsx_shim.ts`,
      `--inject:${rjitHome}/runtime/ambient.ts`,
      `--inject:${rjitHome}/runtime/ambient_primitives.ts`,
    );
  }

  if (opts.watch) base.push('--watch=forever', '--log-level=info');
  return base;
}

export function bundleCart(opts: BundleOptions): void {
  run(`${opts.rjitHome}/tools/esbuild`, bundleFlags(opts));
}
```

### B.12 — `cli/cart/metafile.ts`

```ts
// cli/cart/metafile.ts — typed view of esbuild's metafile output.

import { fsReadJson } from '../host/fs.ts';

export interface Metafile {
  inputs: Record<string, { bytes: number; imports: unknown[] }>;
  outputs: Record<string, {
    bytes: number;
    inputs: Record<string, { bytesInOutput: number }>;
    entryPoint?: string;
    imports?: unknown[];
  }>;
}

export function loadMetafile(path: string): Metafile {
  return fsReadJson<Metafile>(path);
}

/**
 * Inputs that survived tree-shaking. This is the set the registry's
 * trigger matchers consult. Bytes-in-output > 0 is the correct signal —
 * top-level `inputs` includes everything esbuild parsed, even
 * tree-shaken-away files.
 */
export function shippedInputs(meta: Metafile): Set<string> {
  const out = new Set<string>();
  for (const o of Object.values(meta.outputs)) {
    for (const [path, info] of Object.entries(o.inputs)) {
      if (info.bytesInOutput > 0) out.add(path);
    }
  }
  return out;
}
```

### B.13 — `cli/cart/manifest.ts`

```ts
// cli/cart/manifest.ts — cart.json reader (replaces cart-manifest-field.js).

import { fsReadJson } from '../host/fs.ts';

export interface CartManifest {
  name?: string;
  icon?: string;
  icons?: { default?: string; linux?: string; macos?: string; windows?: string };
  customChrome?: boolean;
  /**
   * Build substrate. Lets a TUI-only cart declare itself once instead of
   * every caller passing --tui. Read by the SubstrateSelector (§2); a
   * `--tui`/`--gui` flag still overrides it. Absent → 'gui'.
   */
  surface?: 'gui' | 'tui';
  [k: string]: unknown;
}

export function loadManifest(path: string): CartManifest {
  return fsReadJson<CartManifest>(path);
}

/** Get a dotted field (e.g. "icons.linux"). Returns undefined if any segment is missing. */
export function manifestField(manifest: CartManifest, dotted: string): unknown {
  let cur: unknown = manifest;
  for (const part of dotted.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}
```

### B.14 — `cli/main.ts` (dispatcher)

```ts
// cli/main.ts — rjit <subcommand> [args] dispatcher.
//
// Each command exports `run(argv: string[]): Promise<number>`. main parses
// argv[1] as the subcommand, dispatches, awaits, exits.

import { err } from './host/log.ts';

import * as cartManifestField from './commands/cart-manifest-field.ts';
// import * as pushBundle from './commands/push-bundle.ts';        // leaf 2
// import * as cartBundle from './commands/cart-bundle.ts';        // leaf 3
// import * as metafileGate from './commands/metafile-gate.ts';    // leaf 4
// import * as watchAndPush from './commands/watch-and-push.ts';   // leaf 5
// import * as help from './commands/help.ts';                     // leaf 6
// import * as init from './commands/init.ts';                     // leaf 7
// import * as ship from './commands/ship.ts';                     // leaf 8
// import * as dev from './commands/dev.ts';                       // leaf 9
// ...etc

interface Command { run: (argv: string[]) => Promise<number>; }

const COMMANDS: Record<string, Command> = {
  'cart-manifest-field': cartManifestField,
  // 'push-bundle': pushBundle,
  // 'cart-bundle': cartBundle,
  // 'metafile-gate': metafileGate,
  // 'watch-and-push': watchAndPush,
  // 'help': help,
  // 'init': init,
  // 'ship': ship,
  // 'dev': dev,
  // ...
};

async function main(): Promise<number> {
  // process.argv: [scriptPath, subcommand, ...rest]
  const sub = process.argv[1];
  if (!sub) {
    err('rjit: usage: rjit <subcommand> [args]');
    err('rjit: known subcommands: ', Object.keys(COMMANDS).join(', '));
    return 1;
  }
  const cmd = COMMANDS[sub];
  if (!cmd) {
    err(`rjit: unknown subcommand: ${sub}`);
    return 1;
  }
  return cmd.run(process.argv.slice(2));
}

main().then(__exit, (e: Error) => { err(`rjit: ${e.message}`); __exit(1); });
```

### B.15 — `tools/rjit` (shell wrapper)

```sh
#!/bin/sh
# tools/rjit — invoke the bundled CLI through v8cli.
# Usage: rjit <subcommand> [args]
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/v8cli" "$DIR/rjit.js" "$@"
```

### B.16 — bundling recipe

The CLI is built with `tools/esbuild`. Add to `Makefile`-equivalent (or, until there is one, run by hand at the end of each implementation leaf):

```sh
tools/esbuild cli/main.ts \
  --bundle \
  --outfile=tools/rjit.js \
  --format=iife \
  --platform=neutral \
  --target=es2022 \
  --log-level=warning
chmod +x tools/rjit
```

### B.17 — per-command shim template

After leaf N lands and the verification in section 8 passes, the old entrypoint becomes a 3-line shim. Example for `scripts/cart-manifest-field.js`:

The original `tools/v8cli scripts/cart-manifest-field.js cart.json icon` invocations stay valid because `cart-manifest-field.js` is dispatched directly. Drop-in:

```js
// scripts/cart-manifest-field.js — shim. Real impl is cli/commands/cart-manifest-field.ts.
const r = JSON.parse(__spawnSync(__cwd() + '/tools/rjit', JSON.stringify(['cart-manifest-field'].concat(JSON.parse(__argv()).slice(1))), ''));
if (r.stdout) __writeStdout(r.stdout);
if (r.stderr) __writeStderr(r.stderr);
__exit(r.code | 0);
```

For bash entrypoints (`scripts/classify`, etc.) the shim is the 3-line `#!/bin/sh; exec tools/rjit X "$@"` pattern.


### B.18 — `sdk/bindings-schema.ts`

```ts
// sdk/bindings-schema.ts — strict types for the bindings registry.
// Imported by sdk/bindings.ts (the registry) and by sdk/binding-names.ts
// (the type-only file hooks import).

/** A single host-fn pair: the JS-side name and the Zig symbol that backs it. */
export type HostFn = {
  /** Bridge surface name. Must start with __. Carts call this. */
  js:  `__${string}`;
  /** Zig fn symbol inside the binding module. Codegen builds register fn body from these. */
  zig: `host${string}`;
};

/** Codegen toggle for a fn that some bindings define and others don't.
 *  'noop' = codegen emits the stub; 'real' = the .zig file must declare it. */
export type FnPresence = 'noop' | 'real';

type Common = {
  /** Path to the binding module, relative to repo root. */
  module: `framework/v8_bindings_${string}.zig`;
  /** Emit `pub fn register<Suffix>`. */
  registerSuffix: string;
  /** All host fns this binding exposes. Codegen uses these to build the
   *  register fn body and to type the JS-side declaration. */
  hostFns: HostFn[];
  tickDrain?: FnPresence;
  init?: FnPresence;
  /** Native libraries from sdk/dependency-registry.json this binding needs. */
  needs?: string[];
};

export type BindingSpec =
  | (Common & { required: true })
  | (Common & { required: false });

export type BindingRegistry = Record<string, BindingSpec>;

/** Identity-typed registry helper. Use in sdk/bindings.ts to preserve
 *  the literal record type (so keyof yields the precise string union). */
export function defineBindings<T extends BindingRegistry>(r: T): T { return r; }
```

### B.19 — `sdk/binding-names.ts`

```ts
// sdk/binding-names.ts — TYPE-ONLY. The file every hook imports `type Binding` from.
// Kept separate from sdk/bindings.ts so hook files never form a runtime
// import edge with the registry's value. `import type` elides to nothing.

import type bindings from './bindings';

export type Binding = keyof typeof bindings;
```

### B.20 — `sdk/bindings.ts` (excerpt — 3 entries; full file has all 32)

```ts
// sdk/bindings.ts — the registry. Single source of truth for the codegen.

import { defineBindings } from './bindings-schema';

export default defineBindings({
  // Framework-essential. Always linked; no hook declaration needed. The
  // walker auto-includes every `required: true` entry regardless of what
  // hooks declared — required-ness is a property of the binding, not of
  // any particular hook.
  fs: {
    required:       true,
    module:         'framework/v8_bindings_fs.zig',
    registerSuffix: 'Fs',
    tickDrain:      'noop',
    hostFns: [
      { js: '__fs_read',             zig: 'hostFsRead'           },
      { js: '__fs_write',            zig: 'hostFsWrite'          },
      { js: '__fs_exists',           zig: 'hostFsExists'         },
      { js: '__fs_list_json',        zig: 'hostFsListJson'       },
      { js: '__fs_stat_json',        zig: 'hostFsStatJson'       },
      { js: '__fs_mkdir',            zig: 'hostFsMkdir'          },
      { js: '__fs_remove',           zig: 'hostFsRemove'         },
      { js: '__fs_readfile',         zig: 'hostFsReadfile'       },
      { js: '__fs_writefile',        zig: 'hostFsWritefile'      },
      { js: '__fs_deletefile',       zig: 'hostFsDeletefile'     },
      { js: '__fs_scandir',          zig: 'hostFsScandir'        },
      { js: '__fs_media_scan_json',  zig: 'hostFsMediaScanJson'  },
      { js: '__fs_media_stats_json', zig: 'hostFsMediaStatsJson' },
      { js: '__fs_media_index_json', zig: 'hostFsMediaIndexJson' },
    ],
  },

  // Opt-in. Gated by whether any hook file declares `bindings: ['pg']`.
  pg: {
    required:       false,
    module:         'framework/v8_bindings_pg.zig',
    registerSuffix: 'Pg',
    tickDrain:      'noop',
    needs:          ['libpq'],
    hostFns: [
      { js: '__pg_connect',    zig: 'hostConnect'   },
      { js: '__pg_close',      zig: 'hostClose'     },
      { js: '__pg_exec',       zig: 'hostExec'      },
      { js: '__pg_query_json', zig: 'hostQueryJson' },
      { js: '__pg_changes',    zig: 'hostChanges'   },
    ],
  },

  // Event-emitting subprocess binding. tickDrain is 'real' because the
  // hand-written .zig file drains the proc event queue inside its own body.
  process: {
    required:       false,
    module:         'framework/v8_bindings_process.zig',
    registerSuffix: 'Process',
    tickDrain:      'real',
    hostFns: [
      { js: '__proc_spawn',         zig: 'hostSpawn'           },
      { js: '__proc_kill',          zig: 'hostKill'            },
      { js: '__proc_stdin_write',   zig: 'hostStdinWrite'      },
      { js: '__proc_stdin_close',   zig: 'hostStdinClose'      },
      { js: '__proc_stat',          zig: 'hostProcStat'        },
      { js: '__proc_watch_add',     zig: 'hostProcWatchAdd'    },
      { js: '__proc_watch_remove',  zig: 'hostProcWatchRemove' },
    ],
  },

  // ... 29 more entries (see leaf 5 of section 6).
});
```

### B.21 — `cli/commands/codegen-bindings.ts` (the emitter)

```ts
// cli/commands/codegen-bindings.ts — regenerate generated layer from sdk/bindings.ts.
//
//   rjit codegen-bindings            # emit + write all generated files
//   rjit codegen-bindings --check    # emit + diff against on-disk; nonzero exit on drift
//   rjit codegen-bindings --strict   # also fail on lint diagnostics from section 8 (Codegen lints)

import { fsRead, fsWrite, fsReadJson } from '../host/fs';
import { out, err, die } from '../host/log';
import { parseArgs } from '../host/argv';
import { spawnSync } from '../host/process';
import type { BindingRegistry, BindingSpec, HostFn } from '../../sdk/bindings-schema';

interface ResolvedRegistry { bindings: BindingRegistry; }

async function loadRegistry(): Promise<ResolvedRegistry> {
  // sdk/bindings.ts is TS. Run esbuild over it once, eval the output, read
  // the default export. The codegen does NOT type-check — that's TS's job
  // during the project's normal tsc pass. We only need the runtime value.
  const tmp = '.zig-cache/bindings-eval.cjs';
  spawnSync('tools/esbuild', [
    'sdk/bindings.ts',
    '--bundle',
    '--format=cjs',
    '--platform=neutral',
    `--outfile=${tmp}`,
  ]);
  const code = fsRead(tmp);
  // Tiny CJS evaluator: wrap in a fn, run, harvest module.exports.default.
  const module = { exports: {} as Record<string, unknown> };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', code)(module, module.exports);
  return { bindings: (module.exports as { default: BindingRegistry }).default };
}

function emitZig(reg: BindingRegistry): string {
  const lines: string[] = [];
  lines.push('// framework/_generated_bindings.zig — DO NOT EDIT.');
  lines.push('// Regenerated from sdk/bindings.ts by `rjit codegen-bindings`.');
  lines.push('');
  lines.push('const build_options = @import("build_options");');
  lines.push('const v8_runtime    = @import("v8_runtime.zig");');
  lines.push('');
  lines.push('pub inline fn enabledFor(comptime opt: []const u8) bool {');
  lines.push('    return @hasDecl(build_options, "has_" ++ opt) and @field(build_options, "has_" ++ opt);');
  lines.push('}');
  lines.push('');

  // Conditional module aliases. Empty struct when gated off.
  for (const [name, spec] of Object.entries(reg)) {
    const path = spec.module.replace(/^framework\//, '');
    lines.push(`pub const v8_bindings_${name} = if (enabledFor("${name}")) @import("${path}") else struct {};`);
  }
  lines.push('');

  // Per-binding register fn. Codegen builds the body from hostFns; if the
  // gate is off, the @import dead-strips and the fn becomes unreachable.
  for (const [name, spec] of Object.entries(reg)) {
    lines.push(`pub fn register${spec.registerSuffix}(_: anytype) void {`);
    lines.push(`    if (!enabledFor("${name}")) return;`);
    for (const fn of spec.hostFns) {
      lines.push(`    v8_runtime.registerHostFn("${fn.js}", v8_bindings_${name}.${fn.zig});`);
    }
    if (spec.tickDrain === 'noop') {
      // No tickDrain registration needed; the noop is consumed elsewhere.
    } else if (spec.tickDrain === 'real') {
      lines.push(`    // tickDrain provided by ${spec.module} — called from the tick loop.`);
    }
    lines.push('}');
    lines.push('');
  }

  // INGREDIENTS array.
  lines.push('pub const Ingredient = struct {');
  lines.push('    name: []const u8,');
  lines.push('    required: bool,');
  lines.push('    reg_fn: []const u8,');
  lines.push('    mod: type,');
  lines.push('};');
  lines.push('');
  lines.push('pub const INGREDIENTS = [_]Ingredient{');
  for (const [name, spec] of Object.entries(reg)) {
    lines.push(`    .{ .name = "${name}", .required = ${spec.required}, .reg_fn = "register${spec.registerSuffix}", .mod = v8_bindings_${name} },`);
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

function emitDts(reg: BindingRegistry): string {
  const lines: string[] = [];
  lines.push('// runtime/_generated_host_globals.d.ts — DO NOT EDIT.');
  lines.push('// Regenerated from sdk/bindings.ts by `rjit codegen-bindings`.');
  lines.push('');
  lines.push('declare global {');
  for (const [name, spec] of Object.entries(reg)) {
    lines.push(`  // ── ${name} (${spec.module}) ──`);
    for (const fn of spec.hostFns) {
      // TODO(step-2): pull arg + return types from a per-fn signature map.
      //               For now everything is (...args: unknown[]) => unknown.
      lines.push(`  function ${fn.js}(...args: unknown[]): unknown;`);
    }
    lines.push('');
  }
  lines.push('}');
  lines.push('export {};');
  return lines.join('\n');
}

export async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv, { flags: { check: 'bool', strict: 'bool' } });
  const reg = (await loadRegistry()).bindings;

  const zig = emitZig(reg);
  const dts = emitDts(reg);

  const zigPath = 'framework/_generated_bindings.zig';
  const dtsPath = 'runtime/_generated_host_globals.d.ts';

  if (args.flags.check) {
    const current = fsRead(zigPath);
    if (current !== zig) { err('codegen-bindings', `${zigPath} drift`); return 1; }
    const currentDts = fsRead(dtsPath);
    if (currentDts !== dts) { err('codegen-bindings', `${dtsPath} drift`); return 1; }
    out('codegen-bindings: clean');
    return 0;
  }

  fsWrite(zigPath, zig);
  fsWrite(dtsPath, dts);
  out(`codegen-bindings: wrote ${zigPath} (${zig.length} bytes), ${dtsPath} (${dts.length} bytes)`);

  // TODO(step-7): if --strict, run the four lints from section 8 (Codegen lints) and
  //               return nonzero on any diagnostic.
  return 0;
}
```

### B.22 — sample emitter output: `framework/_generated_bindings.zig`

```zig
// framework/_generated_bindings.zig — DO NOT EDIT.
// Regenerated from sdk/bindings.ts by `rjit codegen-bindings`.

const build_options = @import("build_options");
const v8_runtime    = @import("v8_runtime.zig");

pub inline fn enabledFor(comptime opt: []const u8) bool {
    return @hasDecl(build_options, "has_" ++ opt) and @field(build_options, "has_" ++ opt);
}

pub const v8_bindings_fs       = if (enabledFor("fs"))      @import("v8_bindings_fs.zig")      else struct {};
pub const v8_bindings_pg       = if (enabledFor("pg"))      @import("v8_bindings_pg.zig")      else struct {};
pub const v8_bindings_process  = if (enabledFor("process")) @import("v8_bindings_process.zig") else struct {};

pub fn registerFs(_: anytype) void {
    if (!enabledFor("fs")) return;
    v8_runtime.registerHostFn("__fs_read",  v8_bindings_fs.hostFsRead);
    v8_runtime.registerHostFn("__fs_write", v8_bindings_fs.hostFsWrite);
    // ...
}

pub fn registerPg(_: anytype) void {
    if (!enabledFor("pg")) return;
    v8_runtime.registerHostFn("__pg_connect",    v8_bindings_pg.hostConnect);
    v8_runtime.registerHostFn("__pg_close",      v8_bindings_pg.hostClose);
    v8_runtime.registerHostFn("__pg_exec",       v8_bindings_pg.hostExec);
    v8_runtime.registerHostFn("__pg_query_json", v8_bindings_pg.hostQueryJson);
    v8_runtime.registerHostFn("__pg_changes",    v8_bindings_pg.hostChanges);
}

pub fn registerProcess(_: anytype) void {
    if (!enabledFor("process")) return;
    v8_runtime.registerHostFn("__proc_spawn",        v8_bindings_process.hostSpawn);
    v8_runtime.registerHostFn("__proc_kill",         v8_bindings_process.hostKill);
    v8_runtime.registerHostFn("__proc_stdin_write",  v8_bindings_process.hostStdinWrite);
    v8_runtime.registerHostFn("__proc_stdin_close",  v8_bindings_process.hostStdinClose);
    v8_runtime.registerHostFn("__proc_stat",         v8_bindings_process.hostProcStat);
    v8_runtime.registerHostFn("__proc_watch_add",    v8_bindings_process.hostProcWatchAdd);
    v8_runtime.registerHostFn("__proc_watch_remove", v8_bindings_process.hostProcWatchRemove);
    // tickDrain provided by framework/v8_bindings_process.zig — called from the tick loop.
}

pub const Ingredient = struct {
    name: []const u8,
    required: bool,
    reg_fn: []const u8,
    mod: type,
};

pub const INGREDIENTS = [_]Ingredient{
    .{ .name = "fs",      .required = true,  .reg_fn = "registerFs",      .mod = v8_bindings_fs },
    .{ .name = "pg",      .required = false, .reg_fn = "registerPg",      .mod = v8_bindings_pg },
    .{ .name = "process", .required = false, .reg_fn = "registerProcess", .mod = v8_bindings_process },
};
```

`v8_app.zig` and `v8_tui_app.zig` change from hand-rolling the ladder to:

```zig
const generated = @import("framework/_generated_bindings.zig");
// generated.enabledFor, generated.INGREDIENTS, generated.v8_bindings_*
//
// inline for (generated.INGREDIENTS) |ing| @field(ing.mod, ing.reg_fn)({});
```

### B.23 — sample emitter output: `runtime/_generated_host_globals.d.ts`

```ts
// runtime/_generated_host_globals.d.ts — DO NOT EDIT.
// Regenerated from sdk/bindings.ts by `rjit codegen-bindings`.

declare global {
  // ── fs (framework/v8_bindings_fs.zig) ──
  function __fs_read(path: string): string | null;
  function __fs_write(path: string, content: string): boolean;
  // ... (per-fn types pulled from a signature map in step-2)

  // ── pg (framework/v8_bindings_pg.zig) ──
  function __pg_connect(spec: string): number;
  function __pg_close(handle: number): void;
  function __pg_exec(handle: number, sql: string): number;
  function __pg_query_json(handle: number, sql: string, paramsJson: string): string;
  function __pg_changes(handle: number): number;

  // ── process (framework/v8_bindings_process.zig) ──
  function __proc_spawn(specJson: string): number;
  function __proc_kill(pid: number, signal?: string): boolean;
  // ...
}

export {};
```

This file replaces the hand-written portion of `cli/host/bindings.d.ts` after step 2 lands. The hand-written `bindings.d.ts` keeps only the runtime-shim section (console / process) and re-exports the generated declarations.

### B.24 — example converted hook: `runtime/hooks/usePg.ts`

```ts
// runtime/hooks/usePg.ts — Postgres hook. The `bindings` export is read by
// the build walker; the value is also valid TypeScript (`as const` makes
// the array a tuple, `satisfies` checks every entry is a known binding).

import type { Binding } from '../../sdk/binding-names';

export const bindings = ['pg'] as const satisfies readonly Binding[];

export function usePg(connectSpec: string): PgHandle {
  const h = __pg_connect(connectSpec);
  if (h <= 0) throw new Error('pg connect failed');
  return new PgHandle(h);
}

// ... rest of the hook
```

Multi-binding example:

```ts
// runtime/hooks/useEmbed.ts — needs both pg (vector storage) and embed (compute).
import type { Binding } from '../../sdk/binding-names';
export const bindings = ['pg', 'embed'] as const satisfies readonly Binding[];
```

### B.25 — walker extension

Patch to `cli/registry/resolve.ts`. Adds a second resolution path that runs alongside the existing trigger-based one; the gate set is the union of both.

```ts
// cli/registry/resolve.ts (additions only — existing code unchanged)

import { spawnSync } from '../host/process';
import { fsReadJson } from '../host/fs';
import type { BindingRegistry } from '../../sdk/bindings-schema';

/**
 * Harvest hook-declared `bindings` exports from every metafile input under
 * cart/** or runtime/**. Returns the set of binding names any of them
 * declared. The exclusion list keeps node_modules and the generated layer
 * from accidentally claiming bindings.
 */
export function harvestHookBindings(metafile: Metafile, registry: BindingRegistry): Set<string> {
  const claimed = new Set<string>();
  const candidates: string[] = [];
  for (const path of Object.keys(metafile.inputs)) {
    if (!path.startsWith('cart/') && !path.startsWith('runtime/')) continue;
    if (path.startsWith('node_modules/')) continue;
    if (path.includes('_generated_')) continue;
    candidates.push(path);
  }
  if (candidates.length === 0) return claimed;

  // Bundle every candidate through esbuild once, capturing exported values.
  // Output goes to a single .cjs we eval. Faster than per-file passes.
  const tmp = '.zig-cache/bindings-harvest.cjs';
  spawnSync('tools/esbuild', [
    ...candidates,
    '--bundle=false',
    `--outdir=${tmp}-dir`,
    '--platform=neutral',
    '--format=cjs',
  ]);
  // ... evaluate each compiled candidate, read its `bindings` export if
  //     present, union into `claimed`. (Implementation detail; runs once
  //     per metafile-gate invocation, output is a small set.)

  // Validate against registry — drops typos before they reach the build.
  for (const name of claimed) {
    if (!(name in registry)) throw new Error(`harvest: unknown binding '${name}' declared by a hook`);
  }
  return claimed;
}

// In resolveFeatures(), union the harvested set with the trigger-matched set:
//
//   const harvested = harvestHookBindings(metafile, bindingRegistry);
//   for (const name of harvested) {
//     // flip the matching gate flag + add buildOptions/nativeLibraries
//     // for that binding (look up in bindingRegistry).
//   }
```

The grep-based path in `scripts/ship-metafile-gate.js` keeps working alongside this during steps 3–5. At step 6, the grep path is deleted and `harvestHookBindings` plus the registry's `required: true` set become the sole gate source.
