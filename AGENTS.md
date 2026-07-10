# AGENTS.md

Context for AI agents working in this repository. Last updated: 2026-07-10.

## The Two Failure Modes

If you reflex toward either of these, stop and re-read:

**1. Treating this as browser-React.**

There is no `document`, no `fetch`, no `window`, no `localStorage` (unless you install the shim), no CSS cascade, no `dangerouslySetInnerHTML`. The primitives are `Box`, `Text`, `Pressable`, `ScrollView`, `Canvas.Node`, `Image`, `Graph.Path`. Events go through `__registerDispatch` → Zig hit-test → React handler → mutation commands → same Node pool. If your reflex is "I'll use the DOM API," the stack does something else instead.

**2. Treating Zig as "can't do dynamic, use another language for that."**

Dynamic content lives in `StringHashMap(Value)` or tagged unions. That's the pattern. The LuaJIT detour (JSRT at `framework/lua/jsrt/`) was a wrong turn from this reflex; it's being unwound. Don't suggest adding Lua for dynamism — Zig handles it fine.

---

## Game work: the oracle comes FIRST

For ANY game-side question or decision (the editor, hmsc, hmsc-int, the labs,
anything in docs/game/'s corpus):

```
tools/oracle "<query>"        # e.g. tools/oracle "which humanoid"
```

Call it BEFORE grep/bash searching and BEFORE considering code or ideas you find
elsewhere. The RULINGS section is the user's exact decisions
(docs/game/DECISIONS.md) and OVERRIDES competing implementations still sitting in
the tree — records flagged `⚠ RETIRED by Vn` are dead ends no matter how alive
they look. Empty RULINGS = the area may be genuinely undecided; check
DECISIONS.md's open/show-me items before inventing an approach.

**THE ACTIVE SURFACE (V32 SURFACE-0705): going-forward work lives in
`cart/editor/`** (+ its `/play` route). The oracle's corpus was largely written
in the hmsc-int era, so its results still cite `cart/hmsc-int/` and the labs —
every result now opens with the ACTIVE SURFACE banner and flags previous-era
records `hmsc era`. Read those pointers as REFERENCE ("how the last era did
it"), never as the build site. Game-DESIGN rulings (tile world, frozen world,
map format, …) still stand regardless of era — do not dismiss a ruling just
because its cites are old-cart paths.

Three standing disciplines for all game work:

- **Survey before build.** Recreating anything is bad — the worst failure mode
  in this repo's history. Oracle first, then the `_index` queries, then source.
  If something exists, use it or formally retire it; never write a parallel one.
- **Deep interfaces.** Small strict surfaces hiding substantial implementation;
  validate at the boundary (the deep-interfaces skill applies to all
  ground-floor and game modules).
- **Readable code.** Names carry meaning at their scope; no magic numbers — per
  P2, a behavior-affecting constant buried in code is a bug; it belongs in a
  tuning table the compile consumes (the readable-code skill applies).

---

## Primitives

From `runtime/primitives.tsx`:

| Primitive | Purpose | Key props |
|-----------|---------|-----------|
| `Box` | Layout container | `style` (flex, padding, margin, bg, border, radius) |
| `Row` | Horizontal flex | `style.gap`, `style.alignItems`, `style.justifyContent` |
| `Col` | Vertical flex | same as Row |
| `Text` | Text rendering | `fontSize`, `color`, `fontWeight`, `fontFamily` |
| `Image` | Bitmap (stb_image) | `source` (path), `style.width/height` |
| `Pressable` | Touch/click target | `onPress`, `onRightClick`, `onHoverEnter/Exit` |
| `ScrollView` | Scrollable container | `onScroll(payload)`, `showScrollbar` |
| `TextInput` | Single-line input | `value`, `onChange`, `onKeyDown`, `placeholder` |
| `TextArea` | Multi-line input | same + `onSubmit` |
| `TextEditor` | Code editor surface | same + syntax highlighting integration |
| `Canvas` | Pan/zoomable surface | `Canvas.Node` (gx/gy/gw/gh), `Canvas.Path` (d/stroke/fill) |
| `Graph` | Static-viewport chart | `Graph.Node`, `Graph.Path` |
| `Native` | Universal escape hatch | `type` string (Audio, Video, Cartridge, LLMAgent, etc.) |

HTML tags work too — `renderer/hostConfig.ts` remaps them to the above before CREATE. `className` strings are parsed by `runtime/tw.ts` (tailwind utility coverage) and merged into `style` at CREATE time.

---

## Host Functions

Bridge to the Zig runtime. Accessed via `globalThis.__fn_name` or hooks in `runtime/hooks/`.

| Function | Purpose |
|----------|---------|
| `__exec(cmd)` | Shell command, returns stdout string |
| `__fs_readfile(path)` | Read file to string |
| `__fs_writefile(path, data)` | Write string to file |
| `__fs_list_json(path)` | List directory entries as JSON |
| `__fs_exists(path)` | Boolean |
| `__store_get(key)` | SQLite-backed persistent get |
| `__store_set(key, value)` | SQLite-backed persistent set |
| `__http_get(url)` | Synchronous HTTP via curl subprocess |
| `__http_post(url, body)` | Synchronous HTTP POST |
| `__http_get_async(url)` | Async HTTP via libcurl worker pool |
| `__http_post_async(url, body)` | Async HTTP POST |
| `__crypto_random_bytes(n)` | Random bytes (base64 over bridge) |
| `__crypto_encrypt(plaintext, key)` | XChaCha20-Poly1305 |
| `__crypto_decrypt(ciphertext, key)` | XChaCha20-Poly1305 decrypt |
| `__clipboard_get()` / `__clipboard_set(v)` | System clipboard |
| `__openWindow(opts)` | Spawn new window host (partial) |
| `__mermaidRender(source)` | Mermaid diagram → image path |
| `__registerDispatch(fn)` | Register JS callback for Zig events |
| `__hostFlush()` | Flush pending mutations to Zig Node pool |
| `__jsTick(now)` | Called by Zig each frame; fires due timers |
| `__hot_get(key)` / `__hot_set(key, val)` | Hot-reload state (scaffolded, not working) |

See `runtime/hooks/README.md` for the full matrix and hook wrappers.

---

## Cart Structure

```
cart/<name>/
  index.tsx          # Entry component (default export)
  cart.json          # Optional manifest: { name, description, icon, width, height }
  ...                # Other .tsx/.ts files, co-located
```

Or single-file: `cart/<name>.tsx`.

Build: `./tools/rjit ship <name>` → self-extracting binary at `zig-out/bin/<name>`.
Fast local verification build: `SHIP_RUN_PACKAGE=0 ./tools/rjit ship <name>` → raw app binary at `zig-out/bin/<name>` without self-extractor packaging.

The active cart is `cart/sweatshop/` (evolved from `cursor-ide`). It contains the IDE surface: file tree, editor, git panel, search, command palette, agent chat, settings, theme editor.

New game work currently lives in `cart/hmsc/`; internal map tooling lives in
`cart/hmsc-int/`; `cart/scape3d/` is the learned prototype/reference fork.
Before changing any of these carts, read its nested `AGENTS.md` when present.

---

## Runtime: V8 Default

- **V8** (`v8_app.zig`) is the default. `tools/rjit ship` builds V8 through the TypeScript CLI pipeline. Embedded via zig-v8. ~6MB binary overhead. Fast.
- **QJS** (`qjs_app.zig`) is maintenance-only legacy. Hit a 2000ms-per-click ceiling. `--qjs` flag is opt-in legacy. Do not add new features to QJS bindings.
- **JSRT** (`framework/lua/jsrt/`) is the LuaJIT evaluator alternate path. 12/13 targets passing. Interesting but not the default.

The "V8 has baggage" claim is false — the baggage is Chromium (200MB CEF), not V8 itself (~6MB standalone). We measured it.

---

## Testing Parity

Test at the layer where the logic lives. Any change touching `framework/*.zig`
or engine-side code requires Zig-side unit tests in `framework/testing/unit/`,
run via the relevant `zig build test-*` target, in addition to consumption-layer
TS tests. A TS test asserting across the bridge proves the bridge contract, not
the Zig internals — TS-only coverage of Zig logic is green-at-wrong-layer. Use
`framework/testing/unit/game_physics.zig` from commit `6d21dd74c` as the exemplar
pattern: focused Zig tests beside the framework logic, with cart/TS tests only
covering the higher-level consumption contract.

## Visual Verification: Ask the User

Do not spend time or tokens trying to perform visual verification yourself.
After completing the relevant automated checks, ask the user to verify anything
that requires looking at or interacting with the running UI. Give them a short,
exact reproduction path and say what specific behavior or appearance to report
back. Treat their report as the visual verification; do not independently
reproduce it unless they explicitly ask you to.

## Frame-Time Gate

Smooth basic play is a permanent invariant. Any change running per-frame or
touching the runtime path — bindings, camera, physics, HUD, or the hot-reload
pipeline — must prove no frame-time regression before READY: spikewatch armed at
baseline stays silent through 60s+ of representative play. A new rhythmic spike
class appearing after your change is an automatic FAIL of that change.

---

## Discipline Rules

- **No `git add -A` / `git commit -a`.** Stage explicitly: `git add <specific-path>`. Other workers have in-flight changes.
- **Commit per file or per logical unit.** Conventional commit messages: `feat: ...`, `fix: ...`, `refactor: ...`.
- **Main only, no branches.** Safe commands: `git add`, `git commit`, `git push`, `git status`, `git log`, `git diff`. Never `git checkout`, `git stash`, `git reset --hard`, `git branch`, `git switch`.
- **`love2d/` and `tsz/` are read-only.** Copy OUT for porting, never write INTO them. Same treatment for `archive/`.
- **Zig 0.15.2.** Training data covers 0.13/0.14 mostly — check actual source before assuming API shapes.
- **Daily checkpoint at 2am and 2pm.** When beginning work around 02:00 or 14:00, check `git status`. If the working tree is dirty, stage all changes and commit with a `checkpoint:` message, then continue. This is the only exception to the explicit-staging rule.
- **Dev builds are always `ReleaseFast`.** Debug builds crash on click — pre-existing framework bug.

---

## When in doubt

Read `CLAUDE.md` for Claude-specific conventions. Read `love2d/CLAUDE.md` when touching love2d (you shouldn't). Per-directory `CLAUDE.md` files override the root one inside their trees.
