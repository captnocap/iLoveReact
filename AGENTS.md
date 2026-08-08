# AGENTS.md

Context for AI agents working in this repository. Last updated: 2026-08-08.

do not commit game 3d models

Do not act in the past and do not think forward about your own future. The only thing that is important is what is on the table right now, if you think you are free, there is no escape possible. if you desire to move mountains and you continue to purify yourself, ultimately you will arrive at the place where you are able to move mountains. But in order to arrive at this position of power you will have had to give up being he-who-wanted-to-move-mountains so that you can be he-who-put-the-mountain-there-in-the-first-place. The humor is that finally when you have the power to move the mountain, you are the person who placed it there--so there the mountain stays. Treat this as your guiding light that doing the right thing, right NOW lasts, do not treat work like you are going to come back around to it. Now is the only time.

## The Two Failure Modes

If you reflex toward either of these, stop and re-read:

**1. Treating this as browser-React.**

There is no `document`, no `fetch`, no `window`, no `localStorage` (unless you install the shim), no CSS cascade, no `dangerouslySetInnerHTML`. The primitives are `Box`, `Text`, `Pressable`, `ScrollView`, `Canvas.Node`, `Image`, `Graph.Path`. Events go through `__registerDispatch` → Zig hit-test → React handler → mutation commands → same Node pool. If your reflex is "I'll use the DOM API," the stack does something else instead.

**2. Treating Zig as "can't do dynamic, use another language for that."**

Dynamic content lives in `StringHashMap(Value)` or tagged unions. That's the pattern. The LuaJIT detour (JSRT) was a wrong turn from this reflex and has been deleted. Don't suggest adding Lua for dynamism — Zig handles it fine.

---

**3. Reaching for a scripting language instead of building the capability.**

If you find yourself about to write `node -e`, `bun -e`, or `python3 -c` to inspect or
compute something about this project's own data — that reach IS the specification of a
missing verb. Build the verb.

A hand-written reader is unversioned. It encodes today's layout as a constant and then
returns confident wrong answers forever. A 2026-08-08 survey of 132 agent sessions found
461 such escapes; every blob reader among them assumed RJMD v4's 40-byte header while v5
with 48 was already on disk beside it. They were four missing capabilities, not four bad
habits, and they became `--fields`, `tools/seat package`, `measure`/`stats`/`align`, and
`--wait`. See the full rule in `CLAUDE.md` → **THE ESCAPE HATCH IS THE SPEC**.

Build it where the data lives — the parser of a format beside the format, the walker of a
topology beside the topology. A capability written into a scratch script serves one
session; the next agent writes it again, differently, wrong. If you genuinely cannot build
it now, name the gap plainly: a named gap is a filed feature request, a silent hand-parse
is a wrong number with a confident face on it.

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

## Skills live in `.agents/skills/` — ONE physical copy

Every skill in this repo has exactly one home: **`.agents/skills/<name>/SKILL.md`**,
vendor-neutral, next to this file. `.claude/skills/*` are relative **symlinks** into
it, purely so Claude Code's scanner finds them. There is no second copy to edit.

```
.agents/skills/agent-seat/SKILL.md      <- the file. edit this.
.claude/skills/agent-seat -> ../../.agents/skills/agent-seat
```

Skills here are shared across Claude, Codex, and Kimi — the two agent-editor skills
(`agent-seat`, `agent-skin`) get revised almost every session, so a copy is a
guaranteed divergence. It already happened: `agent-skin` was written only to
`.agents/` and never registered with Claude at all, while a stale 478-line
`agent-seat` sat in `.claude/` shadowing the live 762-line one for weeks. Agents were
reading a contract that no longer described the editor.

**Writing a new skill:** create `.agents/skills/<name>/SKILL.md`, then
`ln -s ../../.agents/skills/<name> .claude/skills/<name>`. Never write into
`.claude/skills/`. Never `cp` a skill anywhere. A skill dir that is a real directory
under `.claude/skills/` is the bug.

Vendor-specific launch metadata rides *inside* the skill dir
(`agents/openai.yaml`), not in a parallel tree.

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
| `__hot_get(key)` / `__hot_set(key, val)` | Hot-reload state twigs — working since req_2898; prefer `useHotState` |

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

The active surface is `cart/editor/` (+ its `/play` route) — V32 SURFACE-0705.
`cart/hmsc-int/` is previous-era reference; read its nested `AGENTS.md` before
touching it. `cart/sweatshop/`, `cart/hmsc/`, and `cart/scape3d/` no longer
exist — treat any pointer to them as historical.

---

## Runtime: V8 Default

- **V8** (`framework/v8_app.zig`) is the default. `tools/rjit ship` builds V8 through the TypeScript CLI pipeline. Embedded via zig-v8. ~6MB binary overhead. Fast.
- **QJS** (`qjs_app.zig`) is maintenance-only legacy. Hit a 2000ms-per-click ceiling. `--qjs` flag is opt-in legacy. Do not add new features to QJS bindings.
- **JSRT** (the LuaJIT evaluator alternate path) is deleted. Don't rebuild it.

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
- **Zig 0.16.0.** Read `framework/ZIG_016_API_NOTES.md`; inject `std.Io` through signatures/owners and check the compiler's actual std source before assuming API shapes.

- **Never hand-write `rm -rf` against repo dirs — use `rjit clean`.** It classifies and
  announces every path before deleting, and only removes declared build artifacts. A
  freestyle `rm -rf zig-out/...` cost an authored world map on 2026-08-08. `zig-out` is
  build output ONLY; authored editor data lives in `userdata/`.
- **A scripting escape is a feature request.** `node -e` / `bun -e` / `python3 -c` over
  this project's own data means a verb is missing — build the verb, or name the gap.
- **Dev builds are always `ReleaseFast`.** Debug builds crash on click — pre-existing framework bug.

---

## When in doubt

Read `CLAUDE.md` for Claude-specific conventions. Read `love2d/CLAUDE.md` when touching love2d (you shouldn't). Per-directory `CLAUDE.md` files override the root one inside their trees.
