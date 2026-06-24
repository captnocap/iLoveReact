---
handoff_version: 1
original_conversation_id: 237d7d6a-e4a2-4028-a47c-52ac36b343b2
chain:
  - session: 237d7d6a-e4a2-4028-a47c-52ac36b343b2
    handed_off_at: 2026-06-24T15:26:49+00:00
    note: startup fixed via loader-backed iso pane; editing must be host-side, NOT React Scene3D
  - session: edc880d0-57ef-4fc0-8ae6-7cb21db91bb1
    handed_off_at: 2026-06-24T19:20:01+00:00
    note: edc8: render path proven; bug JS-side (props-skip); Full Part 1 done
task_title: loader iso: fix invisible placed item + Full bake-free editing via streaming
cwd: /home/siah/creative/reactjit
transcript: /home/siah/.claude/projects/-home-siah-creative-reactjit/edc880d0-57ef-4fc0-8ae6-7cb21db91bb1.jsonl
created_at: 2026-06-24T19:20:01+00:00
---

# Continuation brief

You are picking up an in-progress task from a previous session. Read this file fully, then execute. The user has NOT been re-prompted — everything you need is below. The user is resuming on a **MacBook** (was on Linux) — see the macOS gotcha in Constraints FIRST, it bites before anything else.

Claim both jobs before working: `tools/request move req_1812 doing --by <you>` and `tools/request move req_1804 doing --by <you>`.

## The goal (unchanged from session 1)

Original ask, verbatim: **"great. now add in the editor part, where i can edit the map again."** plus the hard constraint **"that sounds jank as hell… putting the same thing back in that we just removed is going to put us right back where we started, just now invisibly"** — i.e. restore full map editing in the hmsc-int iso build pane done PROPERLY for the **loader-rendered** pane, with **ZERO React `<Scene3D>` reintroduced** (that's the ~683MB/boot path that made startup take 30s and render blank).

Native editing is BUILT and works (place/select/move/delete/rotate/clone/drag-paint/hover-ghost, all committed). The two OPEN threads are below. **req_1812 is the immediate one — finish it first.**

## Where things stand

### req_1812 — placed item is INVISIBLE (but clickable). THE IMMEDIATE TASK.

The user: places an item in the loader iso pane, sees nothing, but can click its invisible box (so the piece exists in data + picking works) — the live overlay MESH doesn't render.

**Diagnosed this session — the host render path is PROVEN WORKING.** I injected a synthetic red box from the host (`RJIT_LIVE_PROBE=1`) and it rendered in the pane; `applyPendingLive` logged `count=1` with correct pos/scale/color. So the Zig draw path (live node + `applyPendingLive` + the door) is fine. **The bug is JS-side: real placed pieces produce no rows to push.**

Prime suspect: `pieceInstanceRows()` (cart/hmsc-int/editors/build/pieceMeshes.tsx, ~line 456) **skips props** — `if (propFromPiece(piece)) continue;`. `propFromPiece` returns null for non-prop pieces, so walls/floors SHOULD produce rows; only `kind === 'prop'` pieces are skipped → invisible. If the user is placing props, that's the bug.

**The disambiguation is already armed (hot-reloaded into the running host):** a TEMP `console.warn` in LoaderIsoView's live-push effect prints, on every placement:
`[live-push] node=… pending=N kinds=[…] rows=M door=ok`
- `kinds=[prop] rows=0` → props skipped → fix = render props in the overlay.
- `kinds=[wall] rows>0` but still invisible → the JS→host Float32Array bridge (`hostSetLivePieces`/`argView` in framework/v8_bindings_compiled_world.zig) is suspect — the probe did NOT exercise that path (it called `setLivePieces` from Zig). Add a byte-count log to `setLivePieces` and re-test.

**You did not get the user's `[live-push]` line before this handoff.** Get it (ask the user to place the invisible item and read the console line), OR reason from what they place. Then fix.

**Uncommitted diagnostics in the tree right now (commit them WITH this handoff per the user's request):**
- `world_loader.zig`: `RJIT_LIVE_PROBE=1` injects a red box at the camera look-target in `renderEmbedded`; `RJIT_LIVELOG=1` logs each `applyPendingLive` apply (count + first row). Env-gated, harmless (repo convention, like RJIT_STAIRLOG).
- `cart/hmsc-int/LoaderIsoView.tsx`: the TEMP `[live-push]` console.warn in the live-push effect. UNCONDITIONAL (spammy) — remove it once req_1812 is fixed.

### req_1804 — Full bake-free editing via streaming.zig. THE BIG ONE, AFTER req_1812.

The user chose "Full — bake-free editing": the editor renders the WHOLE piece layer LIVE through `framework/world/streaming.zig`; the gamefile bakes terrain/props only; every place/delete/move/rotate is instant with NO bake (Compile only for /compiled). This kills the 5s rebake AND the corruption fragility in one move.

**Premise MEASURED (green light):** `streaming.build()` on a piece-sized instance set is 3ms (8k rows ≈ main) → 31ms (100k extreme), ~1000× cheaper than the 5s bake. (Bench was a temp `_bench_stream.zig`, already deleted.)

**Part 1 DONE + verified (commit `39f9e359a`):** `rjit game bake --no-pieces --gamefile <path>` produces a piece-free editor gamefile. `bakeGameFile.ts` gates pieces on `--no-pieces` argv; `cli/commands/game.ts` `bake()` threads `--no-pieces`/`--gamefile`; rebuilt+committed `tools/rjit.js`. Verified: `hmsc-editor.gamefile` = 65.9MB piece-free vs `hmsc.gamefile` 74.6MB full; full file untouched (/compiled safe). This part is INERT until Parts 2/3 wire it.

**Part 2 (NOT started) — loader renders pieces from a LIVE per-shape streaming world (Zig + rebuild):** the current live overlay (`applyPendingLive`) is a single flat BOX node — so ramps/stairs/roofs/cylinders would render as boxes (a fidelity regression for the whole map). Fix: feed the pushed pieces as PER-SHAPE families into a `streaming.World` the loader rebuilds on each push, using the SAME protos `setupStreaming` already builds (box, ramp-slab, cylinder8/16, sphere, gable, corner-miter/-mirror), and refresh its draws each frame mirroring `refreshStreamNodes`. This keeps real geometry AND gives culling/LOD. Extend `pieceInstanceRows` to emit per-shape families and extend the door to carry them.

**Part 3 (NOT started) — editor rewiring (TS):** point `LoaderIsoView`'s `gameFile` at `zig-out/game/hmsc-editor.gamefile`; push the FULL current piece set on every edit (not just unbaked); DELETE the `bakedIds`/pending/settle-bake machinery (`requestSettleBake`, the tier-2 logic) — pieces never bake for the editor now; make the editor's auto-compile use `--no-pieces` and fire only on TERRAIN edits, writing `hmsc-editor.gamefile`. NOTE: editor and /compiled currently share `hmsc.gamefile`; the separate editor gamefile is what makes this safe.

**Folded-in follow-up (req_1806, also needs the Part 2 rebuild):** host-side smoothing of the EXTERNAL camera in `world_loader.zig` — interpolate toward the JS-pushed target each render frame (like the game camera's `CAMERA_SMOOTHING_PER_SECOND`) so motion stays butter even when the editor frame loop drops frames. Picking uses the JS-solved pose and happens at rest, so a light smoothing won't break pick parity.

## What you need to do next

1. **macOS first** (see Constraints): rebuild `tools/v8cli` and the dev host on the Mac — the committed `tools/v8cli` is a Linux binary and will NOT run on macOS.
2. **req_1812:** get the `[live-push]` console line from the user (place the invisible item). If `rows=0` + `kinds=[prop]` → make the overlay render props (they don't decompose via `pieceVisualShapes`; render a footprint box from the prop's `propModelFootprintMeters`/`propVerticalBand`, or the prop's real mesh if you wire that — a box placeholder is acceptable to start). If `rows>0` but invisible → add a `setLivePieces` byte-count log, rebuild, and chase the `hostSetLivePieces`/`argView` Float32Array bridge. Then REMOVE the temp `[live-push]` console.warn.
3. **Commit req_1812's fix.** Move req_1812 → review with the fix SHA.
4. **req_1804 Part 2:** build the per-shape live streaming world in `world_loader.zig` (+ door + `pieceInstanceRows` per-shape). Rebuild. Bundle the camera smoothing (req_1806) into this rebuild.
5. **req_1804 Part 3:** the editor rewiring (TS). Verify place/delete/move/rotate are all instant with no bake, real geometry, on `main`.
6. Move req_1804 → review when Full is working end-to-end.

## Files in play

- `/home/siah/creative/reactjit/cart/hmsc-int/LoaderIsoView.tsx` — the loader pane. Live-push effect (has the temp `[live-push]` log), pointer handlers, verbs, 2D HUD, camera push. Part 3 rewires this.
- `/home/siah/creative/reactjit/cart/hmsc-int/editors/build/pieceMeshes.tsx` — `pieceInstanceRows()` (~456, skips props — the req_1812 suspect), `propFromPiece` (~371), `pushBoxInstance`. Part 2 extends `pieceInstanceRows` to per-shape families.
- `/home/siah/creative/reactjit/world_loader.zig` — `applyPendingLive` (~4821) + `setLivePieces`/`pendingLiveFor`/`PendingLive` table, the live node in `build()` (`live_kid`, in the stable prefix before `stream_tail_start`), `renderEmbedded` (~4895, has the probe + camera doors), `setupStreaming` (~3881, the proto list to mirror for Part 2), `refreshStreamNodes` (~3974). Camera smoothing goes in `applyPendingCam`/the camera state.
- `/home/siah/creative/reactjit/framework/v8_bindings_compiled_world.zig` — `hostSetLivePieces`/`argView` (the JS→host bridge; req_1812 suspect #2), camera doors. Part 2 extends the door for per-shape families.
- `/home/siah/creative/reactjit/cart/hmsc-int/compile/bakeGameFile.ts` — `--no-pieces` gate (~173, DONE). `cli/commands/game.ts` `bake()` (~194, DONE). `cart/hmsc-int/index.tsx` — `compileToGame`/auto-compile (~420/480), the `LoaderIsoView` mount (~657) where Part 3 sets `gameFile` + drops settle-bake.
- `/home/siah/creative/reactjit/cart/hmsc-int/IsoAuthor.tsx` — the OLD React-Scene3D pane; reference for editing logic ONLY, never route its `<Scene3D>` into the loader pane.

## Constraints, conventions, and gotchas

- **macOS resume gotcha (CRITICAL):** `tools/v8cli` is a TRACKED 57MB **Linux** binary (the bake runs under it). It will NOT execute on macOS. On the Mac, run `zig build v8-cli` (writes `zig-out/bin/v8cli`) then sync `tools/v8cli` (the build install + a `cp`/rename — see how it was done this session). Same for `zig-out/bin/hmsc-int` and the dev host: framework/Zig changes need a rebuild on the new platform. Do NOT commit a macOS v8cli over the Linux one casually — the Linux box has parallel sessions; coordinate via the user.
- **NEVER reintroduce React `<Scene3D>` / `WorldStatics` / `PlacedPieceMeshes` into the loader pane.** Host-side or 2D-projected only. This is the user's hard line.
- **THE RENDER PATH WORKS** (proven via `RJIT_LIVE_PROBE`). Don't re-investigate the Zig draw side for req_1812 — the bug is the JS rows/bridge.
- **Build:** TSX hot-reloads (~300ms). `world_loader.zig`/`framework/*.zig` need `SHIP_RUN_PACKAGE=0 ./tools/rjit ship hmsc-int` (~5min) AND the user's dev host rebuilt (they get an in-app rebuild notice and are diligent). `tools/rjit` itself is a bundle: `tools/esbuild cli/main.ts --bundle --outfile=tools/rjit.js --format=iife --platform=neutral --target=es2022` then it's live. Bundle-check TSX fast: `BUNDLE_FROM_HARNESS=1 ./tools/v8cli scripts/cart-bundle.js cart/hmsc-int/index.tsx --out /tmp/x.js`.
- **Verify host renders headless:** `RJIT_LOADER_VIEW=1 ./tools/rjit shot hmsc-int --route / --out <png>` (loader view PASSES; the React-editor view OOMs). Headless CAN'T click — use `RJIT_LIVE_PROBE=1` to inject + `RJIT_LIVELOG=1` to log for the overlay.
- **streaming.zig instance row = `pos3 [rot3 if stride≥12] scale3 color3 [shape id at 12]`**; the live node uses INSTANCE_STRIDE=12 box rows; the baked world uses stride 13 (shape id). Scale = FULL box size, rotation = degrees, pos = center.
- **Live node placement:** it's appended in `build()` BEFORE `stream_tail_start`, so `refreshStreamNodes`' per-frame `shrinkRetainingCapacity(stream_tail_start)` won't wipe it. Keep any new live/stream nodes in that stable prefix or they vanish each frame.
- **Git:** main only, no branches, stage explicit paths (never `-A`/`-a` — parallel workers share the tree). Commit messages end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Cite `(USER ASK req_NNNN)`. Move reqs to `review` (never `done` — only the user). Parallel sessions checkpoint-commit uncommitted work (e.g. `93bacaacb` committed this session's atomic-write source) — if `git status` is unexpectedly clean, `git log` once and move on.
- **No subagents / no Explore in this repo** (CLAUDE.md hard rule — false reports). Read directly.
- **User profile:** not a coder; directs by outcome, judges the running app, zero patience for the 683MB problem returning. Be honest about verified-vs-assumed (this session I was upfront the overlay was never verified live — and that's exactly what surfaced this bug).

## What comes next (after this handoff's task is done)

Once Full (req_1804) lands, the loader-backed iso pane fully replaces `IsoAuthor` and the old React-Scene3D pane can be retired. Then the same live-streaming treatment likely applies to any other heavy React-3D editor surface. Remaining smaller verbs deferred this session: tower drag-shell, prop vertical (ctrl) move, multi-shelf prop surfaces. The host-side instant-hide of baked instances becomes moot once Full ships (pieces aren't baked for the editor anymore).

## How to report back

req_1812: commit the fix + remove the temp `[live-push]` log, move req_1812 → review with the SHA, tell the user to place an item and confirm it now shows. req_1804: commit Parts 2+3 (+ camera smoothing) across the rebuild, move req_1804 → review when place/delete/move/rotate are all instant + real-geometry on `main` with no bake. Do NOT flip anything to `done` — the user verifies review→done. Commit each working unit to `main` as you go.
