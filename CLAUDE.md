# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Claude-Code Specific Warnings

**Memory persistence:** Claude Code's memory system lives at `~/.claude-overflow/projects/<project-name>/memory/`. Session hints are written to `session-env task.json` for inter-session continuity. If you need to leave a breadcrumb for the next session, write it there.

**This repo uses the supervisor + worker pattern.** Multiple agent sessions run in parallel across kitty terminal panes. The supervisor pane orchestrates workers. If `git status` is unexpectedly clean, run `git log --oneline -5` ONCE — another you committed it. Move on. Do not loop on `git status`.

---

# HARD RULE: THIS REPO IS ON ZIG 0.16 — READ THE API NOTES BEFORE "FIXING" STD CALLS

The framework migrated to **Zig 0.16.0** (from 0.15.2) on 2026-07-18. 0.16 shipped
April 2026, after every current model's training cutoff, so your instinct for "correct"
`std` usage is the OLD 0.15 API and will silently REVERT the migration. Before touching any
`std.fs` / `std.time` / `std.Thread` / `std.posix` / `std.net` / `std.process` / `std.crypto`
call, **read `framework/ZIG_016_API_NOTES.md`** and confirm against the real std source at
`tools/zig/zig`'s `lib/std/`. Key facts: I/O is an injected `std.Io` capability now, reached
from `std.process.Init` and threaded through signatures/resource owners. V8 callbacks recover
the root `HostContext` from their isolate. Project-wide I/O accessors, inline singleton shims,
and copied old-stdlib networking are forbidden; networking uses `std.Io.net` plus bounded
`std.Io.Group` pumps. Toolchain lives at `tools/zig/zig` → 0.16. Full history:
`docs/ZIG_016_MIGRATION.md`.

---

# HARD RULE: DO NOT CHMOD, UNLOCK, OR MODIFY FROZEN DIRECTORIES

The following directories are READ-ONLY and FROZEN:
- `archive/` — old compiler iterations (v1 tsz, v2 tsz-gen). Reference only.
- `love2d/` — Lua reference stack. Read for porting reference, do not modify.
- `tsz/` — Smith-era stack (.tsz compiler, d-suite conformance, cockpit/Sweatshop .tsz carts, InspectorTsz tools). Read for porting reference, do not modify. Same treatment as `love2d/`.

---

# HARD RULE: V8 IS THE DEFAULT RUNTIME

The default JS runtime is **V8** (embedded via zig-v8). `tools/rjit ship` builds V8. `--qjs` is legacy opt-in.

The "V8 has baggage" myth is fake. The baggage is Chromium (~200MB CEF), not V8 itself (~6MB standalone). We measured it.

**How we got here:** For several days we chased phantom performance problems through multiple architecture refactors. The actual bottleneck was a synchronous `npx tsc` call in the React reconciler path, blocking every click. Once async'd, clicks dropped from ~1800ms to ~40ms — a 75× improvement. V8 gave headroom QJS couldn't. Don't assume V8 is slow; assume the bug is somewhere else.

Do not build new features on `qjs_app.zig` or QJS bindings. QJS is maintenance-only legacy.

---

# HARD RULE: BANNED SHELL COMMANDS (SESSION-KILL PREVENTION)

On 2026-04-22 a worker ran something that logged the user out of their entire desktop session and killed all 14 parallel worker panes. Recovery took hours. The following must never appear in any worker Bash call, `__exec`, or script:

- `pkill -f <pattern>` — matches the polling shell's own command line; cascades.
- `kill -9 -1` — SIGKILLs every process owned by the user; instant logout.
- `killall <anything>` — especially `killall node|bash|chrome`.
- `loginctl terminate-session` / `kill-user` / `lock-session`
- `systemctl --user stop <anything>` unless an explicitly-authorized build unit
- `pam_*`, `passwd`, `useradd`, `usermod`, `gpasswd`
- `swaymsg exit`, `i3-msg exit`, `hyprctl dispatch exit`
- `shutdown`, `reboot`, `halt`, `poweroff`, `init 0`, `init 6`
- `xkill`
- `reset -e` or anything that writes to another session's `/dev/tty`

To stop a specific known PID use `kill <PID>` with the exact numeric PID. Never with a pattern.

---

# HARD RULE: NO SELF-MATCHING PGREP POLLS

Do not write `until ! pgrep -f "zig build ..."; do sleep 3; done`-style wait loops. `pgrep -f` finds the *current polling shell* whose command line contains the search string — that's a self-matching deadlock. `tools/rjit ship` already has internal flock serialization (the same `.zig-cache/.ship.lock` the legacy `scripts/ship` holds, so all build paths queue against each other); call it directly and let it queue.

---

## Who Maintains This

**You do.** Bugs are from other versions of yourself in parallel instances. If a bug from another Claude is blocking you, fix it — it is your code. All of it.

**Committing:** If you commit on your own, only commit your own work. If prompted to commit, commit everything unaccounted for.

---

## What This Is (active shape)

ReactJIT lets you drive a Zig systems engine from React. Apps are written in `.tsx` (standard React), bundled by esbuild.

**Cart runtime:** V8 is default. QJS is legacy maintenance-only.

React's reconciler emits CREATE/APPEND/UPDATE mutation commands; the Zig framework's layout, paint, hit-test, text, input, events, effects, and GPU machinery consumes them.

**Where features live — Zig first.** The whole point of this framework is to take advantage of the Zig systems. **React's job is to structure the UI and author/declare data — not to implement intricate features.** When a request comes in, the default home for the capability is a Zig system or primitive in `framework/` (layout, GPU, physics, 3D, input, effects, text, storage, …); the `.tsx`/`runtime/` side wires it up, lays out the chrome, and feeds it data. Reaching for a JS/React implementation **first** — running real logic in the frame loop, re-rolling in hooks what a host system should do — is the anti-pattern, not the shortcut. This matches `GUIDING_LIGHT.md`: the CPU produces artifacts and runs the data; game/feature code does not live in the JS frame loop. Build the feature in Zig; let React declare it.

- **`framework/`** — Zig runtime. Layout, engine, GPU, events, input, state, effects, text, windows.
- **`runtime/`** — JS entry point, JSX shim, primitives, host globals, hooks.
- **`renderer/`** — reconciler host config. Mutation command stream.
- **`cart/`** — `.tsx` apps. `cart/sweatshop/` (was `cursor-ide`) is the active IDE cart.
- **`scripts/cart-bundle.js`** — esbuild bundler. Run via `tools/v8cli` (no node, no bun).
- **`tools/v8cli`** — standalone V8 script host. Replaces every former `node scripts/X.mjs` invocation. The repo has zero npm/node/bun dependencies; all build-time JS scripts live in `scripts/*.js` and run under `v8cli`.
- **`tsz/`** — FROZEN. Smith compiler + Smith-era carts. Reference only.
- **`love2d/`** — FROZEN. The proven reconciler-on-Lua stack. Reference for any runtime pattern.
- **`os/`** — CartridgeOS + Exodia (future).

---

## Ship Path (the only path)

```bash
./tools/rjit ship <cart-name>       # cart/<name>.tsx → zig-out/bin/<name> (self-extracting)
SHIP_RUN_PACKAGE=0 ./tools/rjit ship <cart-name>   # fast verification: raw app binary, no self-extractor packaging
```

**Never invoke `./scripts/ship` (or `./scripts/dev`) directly.** `tools/rjit` is
what agents invoke for all build/dev work. `scripts/ship` is the legacy bash
pipeline kept parallel to the TypeScript CLI (`cli/commands/ship.ts`) — rjit does
NOT call it; both serialize on the same flock lock, but rjit is the ruled entry
point (see AGENTS.md).

There are no debug or raw-ELF flags. `-d` and `--raw` were removed on 2026-05-04 — `-d` produced a binary that crashed on launch, and `--raw` was never wired up.

What happens: esbuild bundles TSX → `bundle.js`, Zig compiles the cart host with the bundle embedded via `@embedFile`, Linux packaging bundles all `.so` deps into a self-extracting shell wrapper, macOS produces a `.app` bundle.

**No `.tsz`. No Smith. No d-suite conformance.** When a feature needs a real capability — a new primitive, a GPU/physics/3D/text system, hit-testing, anything that runs per-frame or touches the engine — build it as a Zig system in `framework/` (the love2d stack is the reference pattern to port from). UI-level scaffolding — a `.tsx` component, classifier, theme — lives in `runtime/`/`cart/` and just declares and wires the Zig capability. Don't implement the feature itself in JS because the JS path hot-reloads and Zig needs a rebuild; that cost is iteration mechanics, not a reason to put logic in the wrong layer.

---

## Dev Path (iterate without rebuilding)

```bash
./tools/rjit dev <cart-name>    # launches the dev host + watches <cart>
./tools/rjit dev <other-cart>   # second terminal: pushes to running host, adds tab
```

The dev host is a single persistent ReleaseFast binary:
- **Hot reload for React / TSX / TS** — editing files under `cart/` or `runtime/` re-bundles and re-evals in ~300ms. No rebuild needed.
- **Rebuild required for Zig / framework / build-pipeline changes** — anything under `framework/`, `build.zig`, or `scripts/` needs the binary rebuilt. This is an iteration-speed fact, NOT a hint to keep features in JS — most real features belong in `framework/` (see "Where features live — Zig first" above); pay the rebuild.
- **Tabs in the titlebar** — borderless host, top strip IS window chrome. Click tab to switch. Double-click empty chrome toggles maximize. Drag to move.
- **Debug builds silently crash on click.** Always use `ReleaseFast` (default in `rjit dev`).

**State preservation across reloads WORKS (req_2898).** `useHotState` / `framework/state/hotstate.zig` twigs survive the JS teardown, and `cart/editor` uses them for real: mesh edits + undo journal + paint atlas + both cameras + tool/brush state resume on reload (`docs/game/editor_hot_reload.md`). New editor working-state should join an existing twig or the `__model_session_json` resume path — never a parallel store. Twigs are in-process: cold restarts reset them by design.

---

## Primitives

`Box`, `Row`, `Col`, `Text`, `Image`, `Pressable`, `ScrollView`, `TextInput`, `TextArea`, `TextEditor`, `Canvas`/`Canvas.Node`/`Canvas.Path`/`Canvas.Clamp`, `Graph`/`Graph.Path`/`Graph.Node`, `Native`.

`Canvas` and `Graph` are pan-zoomable and static-viewport surfaces with `gx/gy/gw/gh` coordinate-space positioning and SVG `d`/`stroke`/`strokeWidth`/`fill` on paths.

`<Native type="X" />` is the universal escape hatch — the reconciler emits CREATE with that type string, the Zig host handles it.

HTML tags work: `renderer/hostConfig.ts` remaps common tags to primitives. Copy-paste standard React markup and it works.

Tailwind via `className`: parsed by `runtime/tw.ts` at CREATE time. Full utility coverage.

---

## Chart rendering

Decide what's a fill and what's a stroke. They want different tools.

- **Fills, gradients, scalar fields, analytic rings** (donut/pie/contour/heatmap/depth area, fill polygons): one `<Effect>` quad with a WGSL fragment shader. Pixel-perfect at any zoom, no geometry. See `cart/donut_demo.tsx`, `cart/pie_demo.tsx`, `cart/contour_demo.tsx`, `cart/depth_demo.tsx`.
- **Multi-segment line strokes** (radar webs, axis spokes, polygon outlines, polylines): `<Graph.Polyline>` with one polyline per stroke. Per-segment analytic capsules from `framework/gpu/capsules.zig` give clean AA on every segment with no fwidth coupling. Proven clean in `cart/chart_bench.tsx` POLYLINE mode.
- **Text/labels**: TSX, absolutely positioned.

**Don't try to draw multi-segment outlines in a fragment shader.** No matter the formulation (per-wedge, min-over-segments, per-segment-with-its-own-fwidth-then-max), the composite SDF has derivative kinks at every segment boundary, and `fwidth` spikes there cause visible bleed (the "broken circle" / dashed-halo artifact). You can clamp the AA window to reduce it, but not eliminate it. Use `<Graph.Polyline>` instead — that's what `framework/gpu/capsules.zig` exists for.

`cart/radar_demo.tsx` is the reference for the hybrid pattern: shader for the dynamic fill, `<Graph.Polyline>` layered on top for every stroke.

WGSL gotchas worth saving you a debugging session: no unary `+` (`+0.85` errors; use `0.85`); no backticks in shader comments (they end the JS template literal).

---

## Layout Rules

Pixel-perfect flex, shared logic with love2d's layout engine.

### Sizing tiers (first match wins)
1. **Explicit dimensions** — `width`, `height`, `flexGrow`, `flexBasis`
2. **Content auto-sizing** — containers shrink-wrap children, text measures from font metrics
3. **Proportional fallback** — empty surfaces get 1/4 of parent (cascades)

### Rules that still cause bugs
- Root containers need `width: '100%', height: '100%'`
- Use `flexGrow: 1` for space-filling, never hardcoded pixel heights
- `ScrollView` needs explicit height (excluded from proportional fallback)
- Don't mix text and expressions in `<Text>` — use template literals

---

## One-Liner Design Philosophy

Every capability should be usable in one line by someone who doesn't code. The target user knows their domain (music, art, data, games) but doesn't know internals. An AI should be able to discover and control it without documentation.

---

## Model Selection

**Always use Opus 4.6 (`claude-opus-4-6`) for debugging.** Sonnet is fine for scaffolding and routine tasks. When tracking down layout bugs, coordinate mismatches, or anything structural — use Opus.

---

## User Asks: the Request Board (REQLEDGER-0606 → REQBOARD-0607)

git captures commits, not prompts. The ledger is a four-state job board —
**new → doing → review → done** (USER RULING: "so there are 4 states 1 new
2 in process 3 review 4 done") — and is how your work survives review.

**Capture is blanket** (REQSEC-0607, USER RULING: "we keep the hook on all
the same, nothing changes, we just have a secretary"): repo hooks log every
substantive user prompt — only trivial acks, sub-40-char prompts, and
slash/shell commands skip (tunable in `docs/game/_requests/_config.json`).
Watch for the `[request-ledger] captured req_NNNN` context line. The mess is
organized by the SECRETARY: a model tags entries (`bug`, `perf-log`, `ask`,
`ruling`, `ux`, `idea`, …) via the workbench; tags are organization ONLY and
searchable (`tools/request board --tag <t>`, `list --tag <t>`, `tags`).
Unsure model → entry untouched; no model → everything works untagged.

**The worker contract** (the only moves that are yours):

0. **SCOPE GATE first** (REQSCOPE-0705): is the ask about the editor/game
   building (the game, its editors, carts, framework)? IF NO — it is a
   one-off/unrelated: `tools/request oneoff <id> --by <you>` drops it off
   the board (record kept, no board flow) and you just answer it. IF YES —
   continue:
1. **Claim** before working: `tools/request move <id> doing --by <you>`.
2. Work. Append progress with `tools/request note <id> --by <you> "<text>"`.
3. **Move to review** when finished:
   `tools/request move <id> review --by <you> --para "<what was done, why, what changed>" --shas <sha,...|none>`
   (real paragraph, ≥120 chars). Then **STOP**. Your work lands in REVIEW.
4. **done is NEVER yours to flip.** Only the user's word — relayed by the
   supervisor as `--by user` — accepts review→done. The supervisor may
   bounce review→new with a note; rework re-claims from there.
5. Cite the req id in your commit message — the `USER ASK` marker convention
   gains an id: `(USER ASK req_0007)`.

`tools/request resolve` still exists but is an ALIAS for `move <id> review`
(it does NOT close anything). For relayed asks with no capture line, log
first: `tools/request log "<the user's words, VERBATIM>" --origin <pane|lane|supervisor-relay>`
— verbatim means verbatim: quote it, never paraphrase or trim.

`tools/request board` is the live board (`--since <ISO>` shows activity);
`list --open` is everything not done. `tools/oracle "<query>"` matches
request text + resolutions (the REQUEST LEDGER tier). Mechanism doc:
`docs/game/REQUESTS.md`. Backfill is not required — historical USER ASK
commits and pre-board entries stay as they are.

---

## Screenshots: the App Captures ITSELF (SELFSHOT-0606)

**Desktop/X11 capture of the user's system is BANNED.** No `import -window`,
no `scrot`, no `xwd`, no reading any X11/Wayland surface, no screenshots of
the user's screen — ever, for any reason. On 2026-06-06 lanes verifying UI
work via desktop capture got **every lane stopped**; the user's ruling,
verbatim: "they need to figure it out without using my desktop. make a
command to get the proper screenshot of whatever u need, dont look at the
system."

The replacement is first-class — the app reads back its OWN rendered frame
(framework/gpu/capture.zig; nothing touches the desktop):

- **Headless CLI (the default for self-verification):**
  `./tools/rjit shot <cart> [--out path.png] [--route /r] [--frames N]` —
  boots the cart with a HIDDEN window, navigates, renders, captures its own
  swapchain, asserts a well-formed PNG, exits (0 = PASS). Works with zero
  display attachment to your method.
- **Live app:** the in-app console verb `shot [path]`, or the
  `captureFrame(path)` door (`@reactjit/capture` → `__capture_frame`) from
  cart code. Importing the door flips `-Dhas-capture` (source-driven).

When you verify UI work, cite the shot command + the PNG path in your
report. A worker found desktop-capturing again is repeating the exact
failure that stopped all 14 lanes.

---

## Git Discipline (CRITICAL)

**Commit early and often. Do not leave work uncommitted.**

### MAIN ONLY — NO BRANCHES
**Do not create branches. Do not checkout branches. Do not use git switch.** Commit and push to `main`.

The only safe git commands: `git add`, `git commit`, `git push`, `git status`, `git log`, `git diff`.

### When to commit
- After completing each logical unit of work
- Before risky operations
- When you've touched 3+ files
- When in doubt, commit

### How to commit
- Descriptive conventional-commit messages: `feat: ...`, `fix: ...`, `refactor: ...`
- One logical change per commit
- Never leave a session with uncommitted work
- **Never `git add -A` or `git commit -a`.** Stage explicit paths only.

### Daily checkpoint
At roughly 2am and 2pm each day, if you are beginning work, check the time. If it is near 02:00 or 14:00, run `git status`. If the tree is dirty, commit everything as a checkpoint (`checkpoint: <note>`) and move on.

### Parallel sessions
Multiple Claude instances work simultaneously. If `git status` is unexpectedly clean:
1. Run `git log --oneline -5` ONCE
2. Another you committed it. Move on.
3. Do NOT loop on `git status`

---

## Documentation Workflow

Documentation is a completion criterion. After major features:
1. Emit a CHANGESET brief (what, why, affects, breaking changes, new APIs)
2. Update affected docs
3. Commit code + docs together

### The game knowledge layer (`docs/game/`)

There are effectively TWO projects in this repo: **reactjit** (the platform) and
**the game** (a factor of reactjit). `docs/game/` is the game's knowledge layer
and covers ONLY the game's carts/modules — the 33 documented there ARE the game.
Do not add app/tui/chat/test carts to it; they are platform-side and unrelated.

- **`tools/oracle "<query>"` — CALL THIS FIRST. This is ENFORCED, not
  advisory (V32 SURFACE-0705: "enforce it for both").** Before grep/bash
  searching, before considering code or ideas elsewhere, before any
  game/editor-side decision: `tools/oracle "which humanoid"`,
  `tools/oracle "player height"`. It returns the USER'S EXACT RULINGS
  (docs/game/DECISIONS.md, structured) ranked above index records and hazards
  — even when competing implementations exist in the code, the RULINGS
  section is the answer and the competitors are history. Records flagged
  `⚠ RETIRED by Vn` are dead ends regardless of their status. If RULINGS
  comes back empty, the area may be genuinely undecided — check DECISIONS.md's
  open/show-me items before inventing an approach.
- **THE ACTIVE SURFACE (V32): going-forward work lives in `cart/editor/`**
  (+ its `/play` route). The oracle's corpus is largely hmsc-int-era; every
  result opens with the ACTIVE SURFACE banner and flags previous-era records
  `hmsc era`. Read those pointers as reference ("how the last era did it"),
  never as the build site. Game-DESIGN rulings still stand regardless of era.
- `docs/game/DECISIONS.md` — the constitution: 16 verdicts + 6 principles ruled
  by the user. Anything contradicting a verdict is a bug.
- `docs/game/<cart>.md` — per-cart English audit (mechanism-specific: host fn vs
  JS, file:line). `_reports/CONSENSUS.md` — the tallied consolidation queue.
- `docs/game/_index/` — typed, queryable extraction (DocIndex / InterfaceRecord /
  PatternRecord / HazardRecord). Programmatic queries: `byPurpose('camera')`,
  `byStatus('dormant')`, `hazardsBySeverity('high')`, `duplicateNames()`.
- **Maintenance contract:** touching a documented game cart = update its `.md`
  AND its `_index/records/<name>.ts` in the same commit. Editing DECISIONS.md =
  update `_index/decisions.ts` in the same commit (the oracle reads it). A new
  game cart isn't done until it has both. An index that lags the code is the
  disease this layer was built to cure (see the physics_lab/physics3d naming
  inversion).

---

## Skills & Agents

Love2D-specific skills live in `love2d/.claude/` and only apply when working inside the frozen `love2d/` tree. The Smith-era skills (`flight-check-loop`, `chad-audit`, `conformance`) are retained only for reference while touching the frozen `tsz/` tree; do not invoke them against root-level work.
