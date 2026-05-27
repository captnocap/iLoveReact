# Layout Performance — Session Handoff

**Date:** 2026-05-27 (work spans 2026-05-23 → 05-27, one long arc).
**Status:** Big wins built + proven in isolation; **none active in the running app yet.** A real architectural blocker was found, and the user identified the unlock. Read this top-to-bottom before touching layout.

> Line numbers below are as-of 2026-05-27 and WILL drift (multiple sessions edit these files). Treat them as "near here," grep to confirm.

---

## TL;DR

1. We benchmarked our flex layout against **pilatesjs/pilates** (pure-TS) and **yoga-layout** (WASM). We beat Yoga; we *lost* to Pilates' pure-TS core (~2× on full reflow).
2. Proved (with isolated benches) that **Zig is only ~1.1–1.3× faster than V8 at hot numeric loops** — so we can't win the "same work faster" race by much. The win is **doing less work**.
3. Built two classes of win, both verified **byte-identical** to current layout output:
   - **Per-element 2× wins** (Style-by-pointer, generation caches, lazy/cross-axis measure elision) → full reflow 68→34µs.
   - **Dirty cycle (incremental relayout)** → change one cell, recompute ~21 nodes not ~1051 → **~0.7µs, ~23× faster than Pilates' full reflow.**
4. **BLOCKER:** the host rebuilds the entire layout tree from scratch every frame (`v8_app.rebuildTree`). The dirty cycle needs *persistent* nodes; per-frame rebuild throws away its state. So it can't be wired up as-is.
5. **UNLOCK (user's insight):** the per-frame tree is messy only because window **decoration** (chrome bar, resize edges, sizing wrapper) is fused into the cart's content tree. It's client-side decoration (CSD) living in app space. **Decouple deco into its own layer → the content tree is born clean & persistable → the dirty cycle drops in.**

---

## Current benchmark numbers

Same-window, hot-relayout (1k-node grid, change one cell), measured 2026-05-27 under load (loadavg ~4, so absolute µs are inflated ~2× vs a quiet machine — only the *relative* ordering is trustworthy):

| engine | µs / change |
|---|---:|
| YOGA (WASM) | 86 |
| **OURS — full reflow** (`layout.zig`, dirty-cycle merged but per-element wins NOT) | 72 |
| PILATES (pure-TS) | 45 |
| **OURS — incremental (dirty cycle)** (harness drives `markNodeDirty`) | **1.18** |

Lighter-load reference (2026-05-23): ours-full-optimized ~34.5 · pilates ~16 · yoga ~86 · ours-incremental ~0.66.

**Why ours-full is slower than Pilates here:** `layout.zig` only got the *dirty cycle* merged, NOT the per-element 2× wins (those live only in `layout_refactor.zig`). So its full reflow ≈ the original unoptimized one.

---

## The three files — WHAT'S WHERE (critical)

All three are **uncommitted / untracked** (work was never committed; it survives on disk only).

### `framework/layout.zig` — the REAL framework file (in the build)
- Has the **dirty cycle MERGED** (additive: `parent`, `_size_locked`, `_in_*` Node fields; `markNodeDirty`/`markLayoutFull`/`findBoundary`/`relayoutSubtree`; incremental branch in `layout()`; frame-snapshot in `layoutNode`).
- **DORMANT** — nothing calls `markNodeDirty`, so every frame is still a full reflow. Behavior identical to before the merge.
- Does **NOT** have the per-element 2× wins or the Node/Style teardown.
- Also carries an input-sizing bugfix from another session (input check before text in the 3 size functions).
- Compiles in the full framework (built `card_stress`, ran headless 6s, no crash).

### `framework/layout_refactor.zig` — standalone reference, has EVERYTHING
- Fat-Node **teardown**: lean Node (1832→608B) + 10 cold subsystems behind `?*Ext` pointers + `Style`/`PaintStyle` split.
- **Per-element 2× wins**: Style-by-pointer, generation caches, lazy main-axis + cross-axis measure elision.
- The dirty cycle.
- **NOT wired into anything.** It's the design reference. Do NOT swap it in — the teardown changes the Node's public shape and would break the ~hundreds of `node.scene3d_x` / `node.style.background_color` sites across paint/3D/host.

### `framework/layout_bench.zig` — the benchmark harness
- Imports `layout.zig` by default; mirrors Pilates' exact tree shapes (tiny/realistic/stress/big/huge/hot-relayout).
- Run: `zig run -OReleaseFast -lc framework/layout_bench.zig`
- Swap target: `sed 's#@import("layout.zig")#@import("layout_refactor.zig")#'` on a copy.

---

## What we PROVED (durable, not benchmark-fragile)

- **Zig ~1.1–1.3× faster than V8/Node at hot numeric loops.** Same kernel both sides (Node+tinybench vs Zig ReleaseFast): transcendental 1.26×, pure arithmetic 1.09×, int-hash 1.03×. The "native nukes JS 10–100×" intuition is FALSE for tight math loops; JITs compile them to near-identical machine code. ⟹ any layout deficit vs Pilates is OUR code doing more work, not a language ceiling.
- **The "resolve unused fields" tax is real: ~14× over a bare read (~4.7 ns/element)** in Zig, **~18× in TS** — running resolve/clamp/branch across ~30 mostly-null style fields per element. Universal (both languages); Pilates is fast partly because it carries fewer knobs.
- **We are MORE CSS-spec-compliant than Pilates on flexbox:** we support percentage sizing, auto-margins, and baseline alignment; Pilates' `style.ts` has none of those (`Length = number | 'auto'`, no percent; margins are plain numbers; `Align` has no baseline). So some of our per-element cost is genuine capability, not waste — plus all our non-flexbox stuff (Canvas/3D/physics/Effect) they don't have at all.
- **Dirty cycle output is byte-identical to a full recompute** (verified on grid / mutated / fixed-height / realistic / center-align / wrap / overflow trees). It's correct, not approximate.

---

## The dirty cycle — mechanism (in `layout.zig` now, dormant)

Per-node (additive fields): `parent: ?*Node`, `_size_locked: bool`, cached call frame `_in_px/_in_py/_in_pw/_in_ph` + `_in_flexw/_in_stretchh`.

- During any full pass, `layoutNode` snapshots each node's call frame and sets `_size_locked = (width from explicit/percent/parent) AND (height from explicit/percent/parent)` — i.e. the node's outer size can't change from its descendants' content. Also links `child.parent = node`.
- `markNodeDirty(node)` records ONE changed node. A 2nd distinct node, or `markLayoutFull()` (resize/structural), escalates to a full pass.
- `layout()` incremental path: walk up from the changed node's parent to the nearest `_size_locked` ancestor (the **relayout boundary**), then `relayoutSubtree(boundary)` replays that subtree with its cached inputs. Provably identical because a locked boundary's size can't change from an internal edit, so its parent's distribution is unaffected.
- Falls back to full pass when: not yet had a full pass, escalated, or no locked ancestor (change ripples to root). Win scales with boundary density — grids are ideal; deep auto-sized trees trend toward full.

---

## THE BLOCKER — per-frame tree rebuild

`v8_app.zig:rebuildTree()` (~line 3013) runs every frame: `g_arena.reset()` → deep-copy the whole tree from the persistent `g_node_by_id` map into the per-frame arena (`materializeChildren`: `out[i] = src.*`) → that copy is what `layout()` + paint run on → discarded next frame. (Window `<Window>` slots go through `materializeWindowRoot` + `tickDrain` in `v8_bindings_host_window.zig` ~line 297, same pattern.)

**Why it kills the dirty cycle:** the cycle caches `parent`/`_in_*`/`_size_locked`/computed rects on nodes and stores a `*Node` in `markNodeDirty`. With the tree deep-copied and thrown away every frame, none of that survives, and the stored pointer dangles. The 23× bench used a tree **built once and kept** — which is how real engines (Yoga, browsers, Pilates' persistent path) work, but NOT how this host works today.

Architecture as of now (post-reorg — `v8_app.zig` is at the **repo root**, not `framework/`):
- `framework/host_tree.zig` = single tree owner (id→*Node map `g_node_by_id`, parent/children id maps). Migration "complete" per `v8_app.zig:36`.
- `v8_app.zig` applies props (`applyStyle` ~1311, `applyStyleEntry` ~1016, `applyProps` ~1642) onto the persistent `g_node_by_id` nodes, routes structural ops to `host_tree`.
- `v8_app.zig:rebuildTree` materializes the per-frame tree (+ injects synthetic deco). `engine.zig:~4363` calls `layout.layout(config.root, ...)`.

---

## THE UNLOCK — decouple the decoration layer (user's insight, the right move)

The per-frame tree is messy because window **decoration** is fused into the cart's content tree. These **synthetic nodes** (born fresh each frame in `rebuildTree`, no id, not in `g_node_by_id`) are:
1. **Dev chrome bar** (`buildChromeNode`, `if (DEV_MODE)`) — title strip + min/max/close buttons.
2. **Flex wrapper** (`if (chrome && cart children)`) — exists ONLY so the cart's `height:100%` means "below the chrome," not the full window.
3. **Resize edges** (`buildResizeEdges`, `if (BORDERLESS_MODE)`) — borderless-window resize hit regions.
4. **Per-`<Window>` root** (`materializeWindowRoot`) — default-bg column container.

This is **client-side decoration (CSD)** — like X11 server-side deco, but drawn by the app in app space, and wrongly mixed into the content layout tree. They're **conditional** (dev/borderless only — a shipped game cart has none → its tree is already nearly clean).

**The decoupling:** separate roots, composited.
- **Content root** = the cart's real nodes only. Clean → persistable → dirty cycle drops in with no scaffolding to fight.
- **Decoration layer** = chrome + edges, its own tiny tree, laid out & painted separately, on top.
- The **wrapper synthetic node DISAPPEARS**: instead of wrapping the cart to shrink it, hand the content root a frame that's already (window − chrome height). `height:100%` is then correct by construction. The wrapper was a hack papering over un-separated layers.

This is the same principle as the fat-Node teardown: **decouple things that were never the same thing.** Deco ≠ content.

**Cost/scope of the decoupling:** bounded to the window/chrome system — `rebuildTree` (produce separate roots), chrome **paint** (draw deco layer after content), chrome **hit-test** (resize edges currently work by being last-in-children-order so reverse hit-test finds them first → becomes explicit "edges → chrome → content" layer priority). Does NOT touch cart layout semantics or the 112 `.children` consumer sites.

---

## HAZARDS — before incremental can be trusted in the app

Incremental layout is only correct if EVERY layout-affecting input marks the right node dirty. Many inputs **bypass `applyStyle`** — miss one and you get a **frozen / stale layout** (screen stops updating). Inventory these before trusting incremental:
- **Transitions / animations** — `engine.zig` calls `markLayoutDirty()` (~4269/4300/4315) when `transition.needsRelayout()`. Animated layout props change with no React style update.
- **Latch-driven props** — `syncLatchesToNodes` writes `node.style.*` per frame from latches (the `g_latch_*_nodes` sets in `v8_app.zig`).
- **Scroll position** — `node.scroll_x/y` updated in events, not via `applyStyle`.
- **Async measurement** — text content change, image load, font load change measured size after the fact.
- **Window resize** — handled (root-frame-change check forces full pass), but confirm.

Safe rule: when unsure, `markLayoutFull()` (full reflow is always correct, just slower). Don't skip layout on "idle" frames until every source above is accounted for.

---

## PLAN FORWARD (recommended sequence)

**Path A — the real thing (the 23×):**
1. **Decouple the decoration layer** (the unlock above). Foundation; makes everything after it clean. Lower-risk than persisting the fused mess. Bounded to window/chrome system.
2. **Persist the content root** — stop rebuilding it every frame; maintain it across frames, rebuild only on structural change (append/insert/remove). Keep `children: []Node` (don't go to `[]*Node` — 112-site ripple). On style-only frames, sync just the changed nodes' props into the persistent tree.
3. **Wire the dirty cycle** — `markNodeDirty(node)` in `applyStyle`; `markLayoutFull()` on structural ops + after handling every hazard source above. Verify across many carts (build + run + eyeball; the headless smoke-test catches crashes, not stale layout).

**Path B — guaranteed safe win, do anytime (the 2×):**
- Port the per-element wins from `layout_refactor.zig` into `layout.zig` (Style-by-pointer: `const s = &node.style` + free helpers take `*const Style`; generation caches replacing the per-pass `invalidateCaches` walk + 1024-slot text wipe; lazy main-axis + cross-axis intrinsic elision in the slot-build loop). Contained to `layout.zig`, byte-identical output (verified), makes the every-frame full reflow ~2× faster (~72→~36µs). Zero render-pipeline risk. Helps even when incremental can't apply. ~15–20 mechanical edits.

**Blast-radius warning:** Path A touches the SHARED render pipeline every cart draws through — including the game carts in other sessions. A slip = "the game stopped redrawing." Do it behavior-preserving + verify rendering unchanged, ideally not while game sessions are live on screen. Path B is safe to do anytime (different file, nobody touching it).

---

## Reproduce / verify

```bash
# our layout bench (full reflow) — edit/sed the @import to pick layout.zig vs layout_refactor.zig
zig run -OReleaseFast -lc framework/layout_bench.zig

# pilates + yoga (re-clone; /tmp gets wiped)
cd /tmp && git clone --depth 1 https://github.com/pilatesjs/pilates && cd pilates \
  && pnpm install && pnpm build
# then a tiny tsx that imports ./bench/scenarios/hot-relayout.js {pilatesCoreLayout, yogaLayout}
# and benches with tinybench (timestampProvider:'hrtimeNow')

# build a real cart through the whole framework (compile check + binary)
./scripts/ship card_stress
# headless smoke (runs layout+paint loop, no window; 143/SIGTERM = ran fine)
ZIGOS_HEADLESS=1 timeout 6 ./zig-out/bin/card_stress
```

**Correctness check pattern (used all session):** build a tree, full layout, mutate one leaf, then compare (A) `markNodeDirty` + incremental `layout()` vs (B) a fresh full layout of the same mutated tree → assert computed rects byte-identical, and check `telemetryBudgetUsed()` (layoutNode call count) dropped (e.g. 1051→21).

**Zig microbench optimizer-defeat recipe (or you measure lies):** build inputs at RUNTIME (compile-time-known data → constant-folded to fake ~0); perturb the input each timed iteration (else LLVM hoists the call out of the loop); `std.mem.doNotOptimizeAway(sink)`. ONLY trust same-load-window back-to-back A/B — cross-time comparisons are polluted by other sessions' CPU load.

---

## Lessons / gotchas (hard-won this session)

- **Measure, don't theorize.** Claimed a cause without benching twice; was wrong both times. Bench first, then conclude.
- **Per-node parity is the wrong goal.** At ~1.2× language edge you can't out-compute Pilates much. The win is doing LESS work (incremental), not the same work faster.
- The fused decoration tree is the root obstacle to incremental — and it's an accidental coupling, not a requirement. Unfuse it.
- Repo conventions: `v8_app.zig` is at repo ROOT. No `node` binary (use `bun`/`tools/v8cli`). Stage explicit paths, never `git add -A`. `./scripts/ship <cart>` is the only build path; `-d`/debug builds crash on click.
- See also memory: `project_layout_decoupling.md`, `feedback_measure_dont_theorize_layout.md`.
