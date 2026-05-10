# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Claude-Code Specific Warnings

**Task tool is forbidden.** Do not use the `Agent` / `Explore` / `Task` tools. They go blind to supervisor context and have produced materially false reports in this repo (e.g., claimed frozen `tsz/` had `.map()` when it did not; ~57% false-claim rate on prior audits). Read files directly with Read / Grep / Glob / Bash. Treat "does this exist?" as source verification, not delegation.

**Memory persistence:** Claude Code's memory system lives at `~/.claude-overflow/projects/<project-name>/memory/`. Session hints are written to `session-env task.json` for inter-session continuity. If you need to leave a breadcrumb for the next session, write it there.

**This repo uses the supervisor + worker pattern.** Multiple agent sessions run in parallel across kitty terminal panes. The supervisor pane orchestrates workers. If `git status` is unexpectedly clean, run `git log --oneline -5` ONCE — another you committed it. Move on. Do not loop on `git status`.

---

# HARD RULE: DO NOT CHMOD, UNLOCK, OR MODIFY FROZEN DIRECTORIES

The following directories are READ-ONLY and FROZEN:
- `archive/` — old compiler iterations (v1 tsz, v2 tsz-gen). Reference only.
- `love2d/` — Lua reference stack. Read for porting reference, do not modify.
- `tsz/` — Smith-era stack (.tsz compiler, d-suite conformance, cockpit/Sweatshop .tsz carts, InspectorTsz tools). Read for porting reference, do not modify. Same treatment as `love2d/`.

---

# HARD RULE: V8 IS THE DEFAULT RUNTIME

The default JS runtime is **V8** (embedded via zig-v8). `scripts/ship` builds V8. `--qjs` is legacy opt-in.

The "V8 has baggage" myth is fake. The baggage is Chromium (~200MB CEF), not V8 itself (~6MB standalone). We measured it.

**How we got here:** For several days we chased phantom performance problems through multiple architecture refactors. The actual bottleneck was a synchronous `npx tsc` call in the React reconciler path, blocking every click. Once async'd, clicks dropped from ~1800ms to ~40ms — a 75× improvement. V8 gave headroom QJS couldn't. Don't assume V8 is slow; assume the bug is somewhere else.

Do not build new features on `qjs_app.zig` or QJS bindings. QJS is maintenance-only legacy.

---

# HARD RULE: DO NOT USE EXPLORE IN THIS REPOSITORY

For feature verification, compiler capability checks, and architecture comparisons:
- NEVER invoke the built-in Explore agent.
- Read files directly with Read / Grep / Glob / Bash.
- Treat "does this exist?" and "what is missing?" as source-verification tasks.

Measured evidence:
- Direct Opus read: ~1m13s, correct result
- Explore-agent path: ~3m46s, incorrect result
- Explore has produced materially false feature reports here

Why: this repo contains a custom compiler, DSL, and runtime not represented in training data. Explore summaries are less reliable than direct source inspection.

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

Do not write `until ! pgrep -f "zig build ..."; do sleep 3; done`-style wait loops. `pgrep -f` finds the *current polling shell* whose command line contains the search string — that's a self-matching deadlock. `scripts/ship` already has internal flock serialization; call it directly and let it queue.

---

# HARD RULE: NO SUBAGENTS, NO `-A`

No Task / Agent / Explore tool calls. Supervisor goes blind when a worker spawns a subagent. Do all work yourself in your own context. When committing, stage files by name — never `git add -A` or `git add .` (both catch unrelated working-tree state from other workers).

---

## Who Maintains This

**You do.** Bugs are from other versions of yourself in parallel instances. If a bug from another Claude is blocking you, fix it — it is your code. All of it.

**Committing:** If you commit on your own, only commit your own work. If prompted to commit, commit everything unaccounted for.

---

## What This Is (active shape)

ReactJIT is a React-reconciler-driven UI framework. Apps are written in `.tsx` (standard React), bundled by esbuild.

**Cart runtime:** V8 is default. QJS is legacy maintenance-only.

React's reconciler emits CREATE/APPEND/UPDATE mutation commands; the Zig framework's layout, paint, hit-test, text, input, events, effects, and GPU machinery consumes them.

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
./scripts/ship <cart-name>          # cart/<name>.tsx → zig-out/bin/<name> (self-extracting)
```

There are no debug or raw-ELF flags. `-d` and `--raw` were removed on 2026-05-04 — `-d` produced a binary that crashed on launch, and `--raw` was never wired up.

What happens: esbuild bundles TSX → `bundle.js`, Zig compiles the cart host with the bundle embedded via `@embedFile`, Linux packaging bundles all `.so` deps into a self-extracting shell wrapper, macOS produces a `.app` bundle.

**No `.tsz`. No Smith. No d-suite conformance.** When you need a feature — inspector, classifier, theme, custom primitive — port the pattern from `love2d/packages/core/src/` or `love2d/lua/` by hand into `runtime/`, or regenerate it fresh in `.tsx`.

---

## Dev Path (iterate without rebuilding)

```bash
./scripts/dev <cart-name>       # launches the dev host + watches <cart>
./scripts/dev <other-cart>      # second terminal: pushes to running host, adds tab
```

The dev host is a single persistent ReleaseFast binary:
- **Hot reload for React / TSX / TS** — editing files under `cart/` or `runtime/` re-bundles and re-evals in ~300ms. No rebuild needed.
- **Rebuild required for Zig / framework / build-pipeline changes** — anything under `framework/`, `build.zig`, or `scripts/` needs the binary rebuilt.
- **Tabs in the titlebar** — borderless host, top strip IS window chrome. Click tab to switch. Double-click empty chrome toggles maximize. Drag to move.
- **Debug builds silently crash on click.** Always use `ReleaseFast` (default in `scripts/dev`).

**State preservation across reloads is NOT working yet.** `useHotState` + `framework/hotstate.zig` are wired but state resets on every reload.

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

---

## Skills & Agents

Love2D-specific skills live in `love2d/.claude/` and only apply when working inside the frozen `love2d/` tree. The Smith-era skills (`flight-check-loop`, `chad-audit`, `conformance`) are retained only for reference while touching the frozen `tsz/` tree; do not invoke them against root-level work.
