# `/` Route Rework — Dashboard Playbook

> Status: DRAFT / thinking surface (req_1872). Nothing built yet. Decisions from
> the user are now baked in; remaining **[OPEN]** items are noted at the bottom.

## The complaint, in one line

Press Enter in the terminal → the window takes longer and longer to become
usable, because `/` boots the **entire editor + a full game map load** before you
can do anything. And once you're in, the surface you actually use is one of four
panes crammed into a 2×2 grid — the space split is wrong for how the tool is
really used.

## THE reframe (user ruling): the enemy is the FREEZE, not the clock

> "the problem is the ui just freezing up. its unacceptable. if you need to load
> data then do a spinner or something. but making the app freeze is not cool."

This is the north star. The target is **the window never blocks**, not merely
"boots faster." A spinner / progress while data streams in is acceptable and
expected; a frozen, unresponsive window is the bug. Practical law for this whole
effort:

- **Nothing heavy runs on the paint/main thread synchronously.** World load,
  chunk bakes, the `previewWorld` placement walk, AND the new dashboard stat
  computation all have to be async / chunked / off-thread / cached — anything
  but a synchronous block.
- If a thing takes time, it shows a **spinner or progressive fill**, and the rest
  of the UI stays live (you can click, move, navigate) while it loads.

Everything below serves that law.

## What `/` is today (so we know what we're moving)

`index.tsx` → `Router initialPath="/"` → `EditorShell`. On mount, `/` does ALL of:

- Opens two event-sourced sessions (`world`, `buildings`) + folds tunables.
- Builds `previewWorld` (placements walk, O(placements)).
- Mounts the **2×2 `QuadSplit`**:
  - top-left — `PropertiesPanel` ("in focus")
  - top-right — `RightPanel` (tabbed rail: objects / paint / notes / chat)
  - bottom-left — `PaintCanvas` (the 2D tile/height painter)
  - bottom-right — **`LoaderIsoView`** (native `world_loader` reads the whole
    baked gamefile — the heavy load) or `IsoAuthor` (React Scene3D). **This is
    the 90% pane** — the one the user lives in.
- Arms auto-compile, perf heartbeat, settle watcher.

`startupTimer.ts` already measures the honest "READY" = when the main thread
*settles*. That growing settle, and the freeze during it, IS the world load in
the bottom-right pane happening on the main thread.

**Key structural fact:** the heavy thing is bound to `/` only because the editor
*is* `/`. Move the editor to its own route and `/` is free to be cheap.

---

## Thread 1 — `/` becomes an instant, non-freezing dashboard

**Goal:** `Router initialPath="/"` lands on a surface that paints in one frame —
no world load, no `previewWorld`, no 3D pane. The editor becomes its own route
(working name `/editor`). The dashboard then fills its numbers in **without ever
blocking** — spinner/skeleton first, real values as they arrive.

### Route split (the mechanical part)

1. Extract today's `EditorShell` body (QuadSplit + all world/build/placement
   hooks) into an `EditorRoute`, mounted under `<Route path="/editor">` — exactly
   like `/test`, `/labs`, `/workbench` already are. The persistent `Chrome` strip
   stays on top for all routes.
2. New `<Route path="/">` → `DashboardRoute` (light; no world hooks).
3. `Chrome`'s "editor" button navigates to `/editor` instead of `/`.
4. The heavy hooks (`useMapSession`, `useBuildUndo`, `usePlacements`,
   `previewWorld`) move INTO `EditorRoute` so they run only when that route is
   mounted — today they run at shell scope, i.e. always, even on the dashboard.

Safe because the route surfaces already unmount/remount cleanly today, and the
map layer is "disk = truth" (leave `/editor`, come back, re-read from disk).

### Dashboard content (user's spec): a "glad you opened it" stat screen

Not a launcher — an **encouraging at-a-glance readout**:

- **Total triangles / vertices / edges across ALL assets.** Aggregate geometry
  counts over every mesh/asset in the library.
- **Map size vs real-world landmarks.** Compute the world's footprint (we already
  know world units → meters from the game's scale rulings) and compare to
  something tangible ("≈ 0.8× Central Park", "≈ 3 football fields"). Encouraging,
  legible to a non-coder.
- (room to add more vanity metrics later — keep it celebratory, not a control
  panel.)

**FREEZE LAW applies hardest here:** iterating every asset to sum triangles is
exactly the kind of heavy pass that would block. So:

- Show the dashboard chrome + skeleton/spinner **instantly**; numbers stream in.
- Compute the aggregate **async and cached** — likely a background pass that
  reads asset metadata (or a precomputed index) rather than re-tessellating on
  every open. **[OPEN 1c]** decide the data source: do counts already exist in
  the cooked-asset / model store metadata, or must we add a counts field at
  cook/import time so the dashboard just reads a number? (Strongly prefer the
  latter — counts computed once at cook time, read cheap forever.)

### Preload / "hot pizza" — folded into the freeze law

The user's earlier "subprocess so it's hot" instinct resolves to: **don't make
the editor open freeze either.** Plan:

- Editor route loads on navigation, but its world load must be async + spinner
  too (same law), so even the first open never blocks.
- Optional idle warm-up (start the world load after the dashboard is calm) is a
  *nice-to-have* once non-freezing load works — not the priority. True
  off-thread/subprocess is a later spike with a host-capability check; do NOT
  design around it.

---

## Thread 2 — Editor layout redo (COMMITTED, req_1873 sketch)

The user's sketch resolves [OPEN 2a]. The four quadrants collapse into **one big
swappable map + a contextual left rail + a corner picture-in-picture toggle.**

### The shape

```
┌────────┬──────────────────────────────────────┐
│ sel    │                                       │
│ piece  │                                       │
├────────┤                                       │
│ paint/ │           BIG  MAP  PANE              │   ← the 90% surface
│ skins  │     (3D iso build  ⟷  2D tile map)    │
│        │                                       │
├────────┤                              ┌──────┐ │
│ prop/  │                              │ PiP  │ │   ← corner inset = the OTHER
│ piece  │                              │switch│ │     map; click = switcharoo
│ menu   │                              └──────┘ │
└────────┴──────────────────────────────────────┘
```

- **Big map pane** = the primary surface. It is EITHER the iso-3D build view
  (today `LoaderIsoView`/`IsoAuthor`, the 90% pane) OR the 2D tile map (today
  `PaintCanvas`). Only one is big at a time.
- **Corner PiP "2d tile map switcharoo"** = a small inset in the big pane's
  bottom-right showing the *other* map. Clicking it **swaps**: the small one
  becomes the big focused pane, the big one shrinks into the corner inset. A
  minimap-style focus toggle.
- **Left rail** = a single narrow column, three stacked slots, all visible at
  once (not tabbed):
  1. **selected piece** — today's `PropertiesPanel` "in focus".
  2. **paint / skins** — today's RightPanel PAINT tab (face painter / skins).
  3. **prop / piece menu** — today's RightPanel OBJECTS tab (placeables).
- **The rail is CONTEXTUAL to which map is focused** (the user's underline):
  - **3D map focused** → rail shows selected-piece + paint/skins + prop/piece
    (the build tools).
  - **2D map focused** → the *paint/skins* and *prop/piece* slots are REPLACED
    by the **tile-paint tools** (palette / brush / layers / channels that today
    live inside `PaintCanvas`'s own chrome). The selected-piece slot may stay or
    swap to a tile inspector — minor, decide in build.

### What maps to what (current → new)

| sketch region | current component | new home |
|---|---|---|
| big map (3D) | `LoaderIsoView` / `IsoAuthor` | big pane, default focus |
| 2D tile map | `PaintCanvas` | big pane when switched / corner PiP otherwise |
| selected piece | `PropertiesPanel` | left rail, slot 1 |
| paint/skins | `RightPanel` PAINT tab | left rail, slot 2 (3D focus) |
| prop/piece menu | `RightPanel` OBJECTS tab | left rail, slot 3 (3D focus) |
| tile paint tools | `PaintCanvas` internal toolbar | left rail slots 2–3 (2D focus) |

This means `RightPanel`'s tabbing mostly dissolves into always-visible rail slots,
and `PaintCanvas`'s embedded toolbar gets lifted OUT into the rail so the 2D map
pane is just the canvas. The NOTES/CHAT tabs need a new home — **[OPEN 2b]** (a
rail overflow, a chrome popover, or drop from the editor surface).

**Reuse, don't reinvent:** `QuadSplit.tsx` already owns drag-resize + persisted
split fractions + reset — but this is a rail + single-pane + PiP, not a 2×2. The
rail width is one persisted fraction; the 3D⟷2D focus is one state flag; the PiP
is a small absolutely-positioned pressable over the big pane (same pattern as the
LOADER/AUTO-COMPILE toggles already pinned in the build pane corner). Extend the
split primitive, don't grow a second layout engine.

**Freeze law still applies:** the switcharoo must not re-mount/re-load the map it
swaps to from cold — keep both surfaces alive (one big, one PiP-small) and swap
which is large, so a focus flip is instant, never a reload stall.

---

## Sequencing

1. ✅ **Cut /test** (req_1878, `157c8c003`) — the only sibling reading the live
   world; removing it freed the workspace from being root-bound.
2. ✅ **Route split + dashboard** (req_1872, `54165d5ce`) — `/` → light
   `DashboardRoute` (geometry + footprint reports, deferred so it never blocks);
   editor → `/editor`; Chrome brand + Home button → `/`. Verified `rjit shot
   --route /` PASS, boots without the world load.
3. ⏳ **Deeper (b): scope the workspace to the route** — TODAY the EditorShell
   (workspace hooks) still mounts at the Router root, so `/` paints instantly but
   the map still *warms* in the background (the "hot pizza", which is desirable).
   The honest finish is to move the workspace into a component that mounts only
   for `/editor` (+ `/compiled`'s tiny compile signal), so `/` mounts literally
   nothing heavy. Bigger refactor (Chrome is editor-coupled); do it deliberately.
4. ⏳ **Editor layout redo** — the committed shape (rail + big swappable map + PiP
   switcharoo). Build against the now-isolated `/editor` route.
5. **Cleanup** — `editors/play/` is dead (8 files, reachable only via the removed
   `/test` import). Delete it (carries `/test`-keyed camera-tuning registrations
   that go with it). Held for the user's ok.
6. **(Optional)** idle warm-up / off-thread spike — later, gated on a host check.

## Verification

- Non-freeze claim → the window stays interactive during load; `startupMark`/
  `startupWatchSettle` deltas print to the `rjit dev` terminal.
- UI work → `rjit dev` (live) + `rjit shot` where it captures. Never desktop
  capture.
- Route split and layout redo land as **separate** commits, each citing req_1872.

## Open decisions still needed

- **[OPEN 2b]** where NOTES/CHAT go (today RightPanel tabs) once the rail is the
  three build slots — rail overflow, chrome popover, or dropped from the editor.
- **[OPEN 2c]** the rail's slot-1 (selected piece) when the 2D map is focused —
  stay as piece inspector, or swap to a tile inspector. Minor; decide in build.

## Prop thumbnails — model→image pipeline (req_1897 → req_1898)

The prop browser's tiles were unrecognizable: ONE fixed camera framed every
prop the same, so a phone booth and a bus both rendered as a tiny speck in a
black box ("tiny little shits in them i can barely see").

- ✅ **Phase 1 — auto-frame (LANDED, 58da948b9, hot-reloads).** `solveThumbCamera`
  in `PropBrowser.tsx` sizes a bounding sphere from each kind's own
  `propKindDefinition` (height + footprint) and backs an orbit camera off by
  `radius / tan(fov/2)` so the model FILLS its tile regardless of size. Switched
  the 12 tiles from a native camera (they'd each fight for the one host orbit
  controller) to static product-shot cameras; tiles 82×66 → 92×84. This is the
  direct fix for the recognizability complaint and is live now.

- ⏳ **Phase 2 — bake to a cached image (DESIGNED, NEEDS A FRAMEWORK PRIMITIVE +
  ZIG REBUILD — awaiting go-ahead).** Render each prop ONCE to a real PNG, cache
  it content-addressed, and the tiles become a cheap `<Image>` (paging dozens is
  then trivial). The whole downstream half ALREADY exists — `runtime/image.ts`
  `encode(rgba,w,h)` → PNG, and the blob-cache pattern in
  `editors/model/cookedAssetStream.ts` / `modelStream.ts`. The ONE missing piece
  is getting RGBA out of a 3D scene. Plan:
  - **Why StaticSurface can't do it (root cause, confirmed):** `Scene3D.render`
    only RECORDS the scene during the paint walk; the real `drawScene` is deferred
    to `r3d.flushPending()`, which runs AFTER `renderStaticSurfaceCaptures()`. So a
    StaticSurface bakes the 3D quad before its texture is filled → blank. Not
    fixable in the StaticSurface path; that's why the in-process 3D cache was a
    dead end.
  - **The right primitive:** `framework/gpu/3d.zig` already has `renderDetached`
    (renders one scene into a caller-owned target IMMEDIATELY, own command buffer).
    Add a `copy_src` bake target + a readback (mirror `gpu.readbackStaticSurface`,
    which already does the 256-aligned copyTextureToBuffer + map + RGBA swizzle).
    Drive it at the paint site (the node pointer is right there at
    `engine.zig:2989`) via a one-shot `scene3d_bake_key` node flag → stash bytes in
    a string-keyed map → a `__take_baked_scene(key)` host fn hands them to JS
    (zero-copy, same backing-store deleter pattern as `surfaceReadback`).
  - **JS side:** a hidden `<PropBaker>` renders one prop at a time at ~256², polls
    `takeBakedScene`, `encode()`s to PNG, caches by kind (persist via the blob
    store), then advances — a queue that never blocks the paint thread (freeze
    law). `PropThumb` prefers the cached `<Image>`, falls back to the Phase-1 live
    render until baked.
  - **Decision point:** this adds a real framework host primitive and a global Zig
    rebuild (the handoff flags rebuilds racing with parallel lanes). Phase 1 may
    already make a bounded page of 12 page smoothly. So: land Phase 1, let the user
    eyeball it in `rjit dev`, and green-light Phase 2 only if paging janks or the
    user wants the cached-PNG architecture regardless.

## Resolved
- **[1c]** dashboard stats data source — counts are already cheap to read (cooked
  MeshBlob stores vertex count; EditMesh is verts[]+faces[]), so NO cook-time
  field needed. `reportAssetGeometry()` + `reportMapFootprint()` shipped + tested.
- **[2a]** layout direction — committed from the req_1873 sketch (see Thread 2).
- **90% pane** — iso-3D build view.
- **freeze law** — never block the paint thread; spinner + async, UI stays live.
- **dashboard role** — vanity stat screen (geometry totals + map-vs-landmark),
  not a launcher.
