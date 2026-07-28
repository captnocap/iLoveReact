# reactjit

A native runtime for React. Write plain `.tsx`, ship a single-file binary. No DOM, no CSS engine, no browser, no Node.

Layout, paint, hit-testing, text, networking, audio, video, voice — all native Zig on top of V8 and wgpu. The reconciler handles standard React: JSX, hooks, HTML tag names, Tailwind via `className`, CSS transforms. The hard parts are ours, not a wrapped engine.

Highly experimental. Rough edges everywhere. The shape keeps moving.

## Make a cart

A cart is a `.tsx` file under `cart/` that exports a default React component:

```tsx
// cart/hello.tsx
export default function Hello() {
  return (
    <Box className="p-4 bg-zinc-900 h-full w-full items-center justify-center">
      <Text className="text-2xl text-white">hello</Text>
    </Box>
  );
}
```

Ship it:

```bash
./scripts/ship hello
```

You get `zig-out/bin/hello` — a self-extracting native binary with bundled glibc family + transitive `.so` deps. Runs on fresh Linux distros (Whonix, Debian, Ubuntu, Fedora) with no system toolchain, no `apt install`, no LD_LIBRARY_PATH gymnastics.

> **Don't use `node`, `bun`, or `npm`.** Build-time JS runs under `tools/v8cli` (a standalone V8 script host). The repo has zero npm/node/bun dependencies — `tools/zig/` and `tools/esbuild/` are vendored too. `scripts/fetch-zig.sh` populates the toolchain on a fresh clone.
>
> **Don't write `.jsx` or `.js` cart files.** `.tsx` and `.ts` only.
>
> **Cart resolution:** `cart/<name>/index.tsx` first, then `cart/<name>.tsx`. Single-file or directory, both fine. A directory cart can have a `cart.json` with `name` / `description` / `customChrome` / `width` / `height`.

## Iterate

Use the persistent dev host instead of rebuilding for every change:

```bash
./scripts/dev hello
```

A long-lived `ReleaseFast` binary listens on `/tmp/reactjit.sock`. Save a `.tsx` or `.ts` file, the bundler re-bundles and pushes the new bundle over IPC. Save-to-visible: ~300 ms. Run `./scripts/dev <other>` in a second terminal — same host, gets a new tab.

> **Stick to `ReleaseFast` (the default).** Debug builds have a pre-existing click-path issue.
>
> **Rebuild required for `framework/`, `build.zig`, or `scripts/` changes.** TSX/TS edits hot-reload. Zig edits need a fresh `./scripts/dev` (which rebuilds the host).
>
> **State across reloads:** `useHotState('key', initial)` survives re-eval — atoms persist in Zig-owned memory outside the JS context that gets torn down. Values must be JSON-serializable.

## Primitives

Standard React works. These are the type-string primitives the reconciler emits to the Zig host:

```
Box  Row  Col  Text  Image  Pressable  ScrollView
TextInput  TextArea  TextEditor  Terminal
Window  Notification
Canvas  Canvas.Node  Canvas.Path  Canvas.Clamp
Graph   Graph.Path   Graph.Node
Physics      Physics.World      Physics.Body         Physics.Collider
Audio        Audio.Module       Audio.Connection
Scene3D      Scene3D.Mesh       Scene3D.Camera       Scene3D.OrbitControls
             Scene3D.AmbientLight  Scene3D.DirectionalLight  Scene3D.PointLight
Video  Cartridge  RenderTarget  StaticSurface
Render  Effect  Native
```

Standard HTML tag names work too — `div`/`section`/`a`/`button` etc. → `View`; `h1`–`h6`/`p`/`span` → `Text`; `img` → `Image`; `input` → `TextInput`; `textarea` → `TextEditor`; `video` → `Video`. ARIA / `data-*` / HTML-only props are stripped at the bridge.

Tailwind via `className` is parsed by `tw()` at CREATE time. CSS `transform: rotate(...) scale(...) translate(...)` composes into a 2D matrix that paint, hit-test, and clipping all honor.

`<Native type="X" />` is the universal escape hatch — emits CREATE with that string for the Zig host to handle.

## What you can build with it

| Capability | API |
|---|---|
| 2D drawing surface (pan/zoom, SVG paths) | `<Canvas>` + `Canvas.Node` / `.Path` / `.Clamp` |
| Static-viewport graphs | `<Graph>` + `Graph.Path` / `.Node` |
| 3D scene | `<Scene3D>` + `.Mesh` / `.Camera` / `.OrbitControls` / lights, `useScene3D()` |
| 2D + 3D physics | `<Physics.World>` + `.Body` + `.Collider` (Box2D, feature-gated) |
| Modular synth + audio routing | `<Audio>` + `Audio.Module` / `.Connection`, `useAudio()` for note triggering |
| Video playback | `<Video src>` — libmpv embedded via `dlopen` + GL render API + `glReadPixels` → wgpu texture. Not a separate mpv window. |
| Voice + transcription | `useVoiceInput` (SDL3 mic + libfvad VAD), `useEnsembleTranscript` (whisper.cpp ensemble) |
| Networking | `useHost` (be a server) / `fetch` (one-shot) / `useConnection` (long-lived). Kinds: ws, tcp, udp, http, SSE. Transports composable via `via:` (Tor, SOCKS5). |
| Game-server protocols | RCON, A2S Source Query (built into `useConnection`) |
| Persistent state | `useHotState` (Zig memory, hot-reload-safe), `useLocalStore`, sqlite via `runtime/hooks/sqlite.ts`, DuckDB via `__db_query` |
| Filesystem | `useFileContent`, `useFileWatch`, `useFileDrop`, plus low-level `runtime/hooks/fs.ts` |
| If-this-then-that | `useIFTTT` + compositional triggers from `proc:*` / `fs:*` / clipboard / signal sources. `cart/watchdog.tsx` is the reference. |
| Render suspend/resume | `<StaticSurface>`, kitty-protocol + headless capture |
| Privacy / crypto | `usePrivacy` — sha256/hmac/hkdf/xchacha20, GPG, keyring, Noise protocol, Shamir, audit log, PII redact, secure buffers |
| Coding agents | `__claude_*` / `__kimi_*` / `__localai_*` host bindings + standalone `claude_runner.zig` CLI |
| Inspector telemetry | `useTelemetry` over `__tel_*` / `__sem_*` (frame, gpu, layout, input, net, state, history, semantic graph) |

For shape and exact prop names, see `runtime/primitives.tsx`, `runtime/hooks/`, and the cart roster in [Reference](#reference).

## What's native

This isn't React with a thinner browser. It's React without a browser. Behind the reconciler, the parts a browser would normally hand you are local Zig:

- **Layout** — `framework/layout.zig` + `framework/engine.zig`. Custom flexbox; no Yoga, no Taffy. Sizing tiers (explicit / content / proportional fallback), hit-testing, scroll, focus, z-index scissor breakouts.
- **Text** — `framework/text.zig` + `framework/gpu/text.zig`. Font loading, glyph cache, shaping, line-break, paint. No HarfBuzz, no Pango.
- **GPU drawing** — `framework/gpu/{rects,capsules,curves,polys,images,procgen,shaders,text,3d}.zig` on top of wgpu-native.
- **Networking** — `framework/net/{tcp,udp,http,httpserver,websocket,wsserver,socks5,tor,rcon,a2s,ipc}.zig`. HTTP/1.1, WS client+server, SOCKS5, Tor (control port + onion service), RCON, A2S. The `tcp via:tor` and `tcp via:socks5` composition is by design — not a passthrough to a system socks daemon.
- **Voice + audio + whisper** — `framework/voice.zig` (SDL3 + libfvad), `framework/audio.zig` (modular synth graph), `framework/whisper.zig` (whisper.cpp on a worker thread + VAD-gated buffer lifecycle).
- **Video** — `framework/videos.zig`. `dlopen("libmpv.so.2")` with `RTLD_DEEPBIND` to isolate mpv's bundled Lua 5.2; mpv renders into a private GL FBO; we `glReadPixels` and upload to a wgpu texture. Hand-rolled embedding, not a process spawn.

That's the load-bearing five — picked by where bugs land most often, not by importance. `ls framework/` is ~120 more `.zig` files in the same shape: read the file, fix the bug.

**What we actually depend on:** wgpu-native, V8 (lightpanda), SDL3, FreeType, esbuild, react / react-reconciler / scheduler. Behind feature gates: Box2D, libsodium, libsqlite3, libvterm, libfvad, libwhisper.cpp, DuckDB, libmpv (`dlopen`'d, embedding hand-rolled). The dep graph is shallow on purpose. When layout misbehaves, the bug is in a file you can read in one sitting, not buried under a million lines of Blink.

The line between "uses dependencies" and "is native" runs through how much of the hard parts you wrote yourself. We wrote most of them.

## Why

V8 standalone is ~6 MB. Node bundles V8 into ~50 MB. CEF (Chromium Embedded) is ~200 MB. The "V8 is heavy" intuition is really "Chromium is heavy." Copy-paste a React component, ship native performance, don't ship a browser.

---

# Reference

## Host bindings

The V8 host registers **338 functions** on the JS global, split across 16 binding files (`grep -h registerHostFn framework/v8_bindings_*.zig | wc -l`):

| File | Count | Surface |
|------|------:|---------|
| `privacy` | 66 | sha256/hmac/hkdf, xchacha20, libsodium, GPG, keyring, Noise, Shamir, audit log, PII detect/redact, steganography, secure buffers, manifest verify, policy/consent |
| `sdk` | 62 | sqlite (`__sql_*`), DuckDB (`__db_query`), local store, hot state, IPC, browser-page, coding agents (`__claude_*`, `__kimi_*`, `__localai_*`), recorder/replay, terminal recorder, router |
| `core` | 56 | input / clipboard / window, audio graph, classifier, hot-state, kv store, JS eval, frame timers (`getFps`, `getTickUs`, `getLayoutUs`, `getPaintUs`), `__nowMs`, `__sleepMs`, `__exit` |
| `telemetry` | 48 | `__tel_frame/gpu/layout/input/net/state/system/canvas/history/nodes/node*`, `__sem_*` semantic graph, PTY, kvstore |
| `fs` | 42 | `__fs_read/write/readfile/writefile/exists/list_json/scandir/stat_json/mkdir/remove`, media index, watchers, file-drop |
| `cli` | 23 | `__argv`, `__cwd`, `__readFile`, `__spawn`/`__spawnSync`, unix-socket client. Used by `tools/v8cli` for build-time scripts |
| `net` | 8 | `__tcp_*`, `__udp_*`, `__socks5_register/unregister` |
| `process` | 7 | `__proc_spawn`, `__proc_kill`, `__proc_stat`, `__proc_stdin_write/close`, `__proc_watch_add/remove` (watchdog source) |
| `gameserver` | 6 | `__rcon_open/command/close`, `__a2s_open/query/close` |
| `voice` | 5 | `__voice_start/stop/set_mode/set_floor/release_buffer` |
| `wsserver` | 4 | `__wssrv_listen/send/broadcast/close` |
| `websocket` | 3 | `__ws_open/send/close` |
| `httpserver` | 3 | `__httpsrv_listen/respond/close` |
| `tor` | 2 | `__tor_start/stop` (real bootstrap, exposes `socksPort`/`hostname`/`hsPort`) |
| `zigcall` | 2 | `__zig_call`, `__zig_call_list` (generic Zig FFI) |
| `whisper` | 1 | `__whisper_transcribe` |

TS hook wrappers live under `runtime/hooks/`. `runtime/hooks/index.ts:installBrowserShims()` installs `fetch`, `localStorage`, and a no-op `WebSocket` stub for paste-compatibility.

**Not available** (no browser): real `window`/`document`/`navigator`, `sessionStorage`, IndexedDB, cookies, `Blob`, `FormData`, `FileReader`, `XMLHttpRequest`, CSS Grid, media queries, pseudo-classes, inline SVG, blob URLs.

## SDK / dependency policy

`sdk/dependency-registry.json` is the build contract. Every native library has two orthogonal policies:

| Axis | Values | Meaning |
|---|---|---|
| `linkPolicy` | `foundational` | Always linked. SDL3, freetype, wgpu-native. |
| | `system-assumed` | Declared at link time but the host always provides it. X11, libc, macOS frameworks. |
| | `feature-gated` | Linked only when the cart's source triggers the feature. libmpv, libsodium, libsqlite3, libvterm, box2d, libcurl, tls.zig. |
| | `engine-v8` | V8 prebuilt static lib, selected via `-Duse-v8`. |
| `bundlePolicy` | `always` | `pack-sdk` always copies the .so into the SDK payload. |
| | `feature-gated` | Only copied when the feature is on. |
| | `vendored-source` | Compiled from C in-tree (stb-image\*). |
| | `never` | Host-provided, never packed. |

Triggers come from the cart's esbuild metafile — a feature only links if its marker appears in `outputs[].inputs`. A cart that never imports `<Video>` doesn't carry libmpv. The dev host is the deliberate exception: `dev-zig-flags` enables every feature so any cart can land on it after startup.

`scripts/sdk-dependency-resolve.js` (under `tools/v8cli`) reads the metafile and emits the right `-Dhas-*` flags. `scripts/pack-sdk.js` produces a self-contained SDK tarball — its own Zig, sysroot (glibc family + SDL3 transitive .so deps), pkg cache, vendored React, esbuild, and `v8cli`. Carts ship from outside the repo via `RJIT_HOME` (SDK install) + `CART_ROOT` (project) split.

## File layout

```
cart/                 .tsx carts (single-file or directory-based)
runtime/              JS entry, primitives, classifier, theme, tw, JSX shim,
                      hooks/, scene3d/, audio.tsx, router, intent system
renderer/             react-reconciler host config + mutation command stream
framework/            Zig runtime
  layout/engine/text/gpu       — flexbox, paint, fonts, wgpu
  audio/voice/whisper/videos   — synth, mic+VAD, whisper.cpp, libmpv embedding
  physics2d/physics3d          — Box2D + 3D shim
  net/                         — http(s), websocket, ws-server, http-server,
                                 tcp/udp, socks5, tor, RCON, A2S, IPC
  ifttt/watchdog/process       — composable triggers + per-proc/fs sources
  claude_sdk/                  — long-running coding-agent sessions
  render_surfaces*             — suspend/resume render pipeline
  v8_bindings_*.zig            — 338 host fns across 16 modules
  lua/ifttt.lua                — IFTTT compose helper (only Lua left in stack)
sdk/                  dependency-registry.json — feature → -D flags + bundle policy
scripts/              ship, run, dev, init.js, help.js, cart-bundle.js,
                      pack-sdk.js, sdk-dependency-resolve.js, fetch-zig.sh,
                      fetch-whisper-models, autotest, classify, watchdog.sh
tools/v8cli           Standalone V8 script host. Replaces every former
                      `node scripts/X.mjs` invocation. Zero npm/node/bun deps.
tools/zig/            Pinned Zig toolchain (populated by scripts/fetch-zig.sh)
deps/                 zig-v8, wgpu_native_zig, vello_ffi, libfvad,
                      whisper.cpp, llama.cpp.zig, libvterm, duckdb,
                      tls.zig, sysroot, v8-prebuilt
vendor/               react, react-reconciler, scheduler, typescript
build.zig             Root build

framework/v8_app.zig  Cart host (the app root source). Embeds V8 via deps/zig-v8.
framework/v8_hello.zig  Minimal V8 smoke-test host.
framework/v8_cli.zig  Backing host for tools/v8cli.

tsz/                  FROZEN. Smith-era AOT-compile-.tsz-to-Zig experiment.
love2d/               FROZEN. Reconciler-on-Lua predecessor stack.
archive/              FROZEN. Earlier compiler iterations.
os/                   Speculative (CartridgeOS). Mostly stubs.
```

Frozen trees are reference-only — read for porting patterns, do not modify.

## Status

| Working | Pending |
|---|---|
| V8 host (default), single ship path | QJS host kept around but not on the ship path |
| Every primitive listed above; HTML remap; Tailwind; CSS transforms | Multi-window orchestration beyond `__window_*` / `__openWindow` |
| Voice (SDL3 + libfvad VAD) + whisper.cpp ensemble transcription | Whisper streaming + diarization polish (see `framework/WHISPER_TODO.md`) |
| IFTTT registry + compose, watchdog cart, `proc:*` / `fs:*` sources | More built-in IFTTT sources |
| Networking trichotomy (`useHost` / `fetch` / `useConnection`) for ws/tcp/udp/http/SSE/tor/socks5 | `wireguard` / `stun` / `peer` connection kinds |
| RCON + A2S Source Query | `<Video>` cart-facing API polish (libmpv embedding lands frames) |
| Privacy / crypto stack: GPG, keyring, Noise, Shamir, steganography, audit logs, PII redaction, secure buffers | Inspector UI cart (host telemetry plumbing exists; UI sparse) |
| Persistent dev host + IPC bundle-push + hot reload, `useHotState` survives re-eval | |
| `scripts/ship` self-extracting packaging, cross-distro sysroot bundling | |
| Render suspend/resume + kitty/VM/headless render surfaces | Standalone `rjit` dispatcher (templates + help present, dispatcher in progress) |
| Physics + Audio + Scene3D runtime exports, CSS transforms, z-index scissor breakouts | |
| Coding-agent host APIs + standalone `claude_runner.zig` | macOS path: cross-compile works, native dev loop unverified recently |
| `cart/app/` onboarding + homepage, 128-component gallery | |

## Carts in this repo

| Cart | What it is |
|---|---|
| `cart/app/` | Product surface. Router, homepage, onboarding flow, recipe-driven Claude integration. |
| `cart/sweatshop/` | The IDE reactjit develops itself inside. Editor + chat + git + indexer + agents + charts + physics. One cart among many. |
| `cart/component-gallery/` | 128 documented gallery components. Closest thing to a Storybook. |
| `cart/cockpit/`, `cart/effects/`, `cart/browser/`, `cart/inspector/` | Larger reference carts. |
| `cart/dictation.tsx`, `cart/voice_lab.tsx`, `cart/whisper_bench.tsx`, `cart/pocket_operator.tsx` | Voice / VAD / whisper / synth. |
| `cart/watchdog.tsx`, `cart/ifttt_test.tsx` | IFTTT registry + per-process memory/CPU watcher demos. |
| `cart/chat-loom.tsx`, `cart/flow_editor.tsx`, `cart/card_grid.tsx`, `cart/nested_grid.tsx`, `cart/tile_drag.tsx`, `cart/context_menu_demo.tsx`, `cart/clipboard_menu_test.tsx`, `cart/rotate_text.tsx` | Standalone UX experiments. |

Everything else (`hello*`, `host_smoke`, `host_test`, `render-test`, `shadow_test`, `transparency_test`, `tooltip_test`, `text_chop_test`, `input_lab`, `router_probe`, `load_via_*`, `spinner`, `braille_graph`, `d152`, `canvas_stress`, `hello_stress`, `graph_demo`) is smoke / regression / contract carts.

## Pointers

- [`AGENTS.md`](AGENTS.md) — contributor conventions for AI/agent work.
- [`CLAUDE.md`](CLAUDE.md) — Claude Code-specific rules (frozen trees, git discipline, hard bans, banned shell commands).
- [`framework/WHISPER_TODO.md`](framework/WHISPER_TODO.md) — voice / whisper integration plan.
- `sdk/dependency-registry.json` — single source of truth for tools, vendored packages, native libs, feature flags.
- `git log` — the real story. Prior eras (react-love → iLoveReact → multi-target ReactJIT → SDL2/Love2D → Smith/.tsz → JSRT detour → current Zig+V8 cart runtime) all live in there.
