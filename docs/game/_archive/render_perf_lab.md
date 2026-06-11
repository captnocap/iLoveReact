# render_perf_lab cart inventory

Source cart: `cart/render_perf_lab.tsx`

Reviewed: 2026-06-04

## High-level purpose

`render_perf_lab` is a single-file performance stress cart for ReactJIT `Render` capture surfaces. It creates a grid of live external app captures, usually `kitty` terminals, and shows how frame rate, paint time, tick time, layout time, GPU counters, node count, and memory usage change as more captures are added.

Each tile renders a `<Render renderSrc="app:kitty ...">` source. On the host side, `app:` sources are parsed as virtual displays: Xvfb is spawned, the app command is launched into that display, XShm captures pixels, those pixels are uploaded to a wgpu texture, and the texture is drawn as a quad.

The cart is intentionally a worst-case load tool. Idle shells still cost capture and upload work because the render-surface backend polls and uploads live feeds every frame when dirty.

## Files involved

- `cart/render_perf_lab.tsx`: cart entry and all cart-specific UI, tile grid, source generation, telemetry panel, memory sampling, soft memory guard, and helper components.
- `runtime/primitives.tsx`: exports `Render` and layout primitives used by the cart.
- `runtime/host_props.ts`: declares `renderSrc` as a host prop.
- `runtime/hooks/useTelemetry.ts`: polling hook for host telemetry counters.
- `runtime/hooks/fs.ts`: provides `readFile`, used here to read `/proc/meminfo`.
- `framework/engine.zig`: detects nodes with `render_src` during paint and calls `render_surfaces.paintSurface`.
- `framework/render/render_surfaces.zig`: host implementation for render feeds, source parsing, Xvfb/app spawning, XShm capture, GPU texture upload, memory guard, and painting.
- `framework/render/render_surfaces_vm.zig`: VM/VNC helper module and render-surface input mapping support. This cart does not use VM sources directly.

## Imports and primitive surface

At `cart/render_perf_lab.tsx:25-28`, the cart imports React hooks, ReactJIT primitives, telemetry hook, and filesystem read helper.

React hooks used:

- `useState`: terminal count, command mode, source nonce, memory snapshot, and sampled history.
- `useEffect`: telemetry-history sampling interval and `/proc/meminfo` polling interval.
- `useRef`: live telemetry snapshot and zero-terminal memory baseline.

ReactJIT primitives used:

- `Col`: root layout, matrix column, right-side perf panel, memory/stat sections, sample log.
- `Row`: top toolbar, tile rows, stats, sparkline, hero fps row.
- `Box`: spacers, matrix cells, tile frames, sparkline bars, memory bar.
- `Text`: all labels and numeric readouts.
- `Pressable`: toolbar buttons.
- `Render`: live external display/app capture surface.

No `Scene3D`, `Canvas`, `Graph`, `Image`, or `Native` primitives are used.

## Constants and data types

Constants at `cart/render_perf_lab.tsx:30-34`:

- `CAP = 64`: mirrors host `MAX_FEEDS`.
- `SAMPLE_MS = 500`: telemetry/history sampling cadence.
- `HIST = 120`: history length, roughly one minute at two samples per second.
- `MEM_RESERVE_MB = 2048`: mirrors default host `RENDER_MEM_RESERVE_MB`.
- `MEM_PER_FEED_MB = 600`: mirrors default host `RENDER_MEM_PER_FEED_MB`.

`Cmd` at line 36 is the command mode: `shell` or `claude`.

The cart treats these constants as UI policy. The host is still the hard backstop for feed cap and memory refusal.

## Render source generation

`srcFor(id, cmd, nonce)` at `cart/render_perf_lab.tsx:43-48` returns the exact `renderSrc` string for each tile.

Base source:

```text
app:kitty --title rlab-<id>-<nonce> -o remember_window_size=no -o initial_window_width=640 -o initial_window_height=400
```

If `cmd` is `claude`, the source appends:

```text
-e claude
```

Important behavior:

- Host feeds are matched by exact `renderSrc` string.
- The title includes tile id so tiles do not collapse into one shared feed.
- The title includes `nonce` so the refresh button can change all sources, retiring old feeds and spawning fresh ones at the current tile size.
- The source uses `app:` so `framework/render/render_surfaces.zig:221-224` parses it as `.display` with an app command.

## Color thresholds

`fpsColor` at `cart/render_perf_lab.tsx:50-54` maps fps to theme tokens:

- `>= 55`: `theme:success`.
- `>= 30`: `theme:warning`.
- otherwise: `theme:error`.

The same helper colors the toolbar fps readout, hero fps number, and sparkline bars.

## Main component state

`App` starts at `cart/render_perf_lab.tsx:56`.

State:

- `count` at line 57: number of active tiles.
- `cmd` at line 58: source command mode, `shell` or `claude`.
- `nonce` at line 59: refresh token that changes every source string.
- `mem` at line 60: parsed memory snapshot `{ totalMb, availMb }`.
- `hist` at line 76: sampled performance history.

Refs:

- `liveRef` at line 74: latest telemetry values and count, used by the fixed sampler without stale closure issues.
- `baseUsedRef` at line 94: RAM used when count is zero, used as baseline for estimating memory per terminal.

## Telemetry hook usage

The cart uses `useTelemetry` from `runtime/hooks/useTelemetry.ts`.

Live telemetry reads at `cart/render_perf_lab.tsx:63-68`:

- `fps`, polled every 500 ms through host `getFps`.
- `paintUs`, polled every 500 ms through host `getPaintUs`.
- `tickUs`, polled every 500 ms through host `getTickUs`.
- `layoutUs`, polled every 500 ms through host `getLayoutUs`.
- `nodeCount`, polled every 1000 ms through host `__tel_node_count`.
- `gpu`, polled every 1000 ms through host `__tel_gpu`.

`runtime/hooks/useTelemetry.ts` maps scalar kinds to host functions at lines 94-100 and JSON kinds to host functions at lines 102-115. The hook reads once on mount unless `pollMs` is provided. This cart always supplies polling intervals.

The cart reads GPU fields:

- `rect_count`
- `glyph_count`
- `gpu_surface_w`
- `gpu_surface_h`

## Sampled history

At `cart/render_perf_lab.tsx:70-83`, the cart samples live telemetry into `hist`.

Behavior:

- `liveRef.current` is updated every render with `fps`, `paintUs`, `tickUs`, and `count`.
- A `setInterval` runs every `SAMPLE_MS`.
- Each sample stores `{ t: Date.now(), fps, paintUs, n: count }`.
- The array is truncated to the last `HIST` samples.

This history drives:

- `Sparkline`, using the last 90 samples.
- sample log, using the last 22 samples reversed newest-first.

## Memory sampling and soft guard

At `cart/render_perf_lab.tsx:85-91`, the cart reads `/proc/meminfo` once and then every second.

It uses `readFile('/proc/meminfo')` from `runtime/hooks/fs.ts`, which calls host function `__fs_read`. The hook returns `null` if the file does not exist.

`parseMeminfo` at `cart/render_perf_lab.tsx:298-309` extracts:

- `MemTotal`
- `MemAvailable`

It converts kB to rounded MB.

Memory calculations:

- `usedMb = totalMb - availMb`.
- `baseUsedRef` is reset to used memory whenever `count === 0`.
- `memPerTerm` estimates `(usedMb - baseUsedRef.current) / count`.
- `guardActive` is true when available memory is less than `MEM_RESERVE_MB + MEM_PER_FEED_MB`.
- `canAdd` is true when the guard is not active and count is below `CAP`.

This is a soft UI guard. The host still enforces memory refusal in `framework/render/render_surfaces.zig:1254-1263` and `createFeed` at lines 1274-1280.

## Buttons and count controls

Handlers at `cart/render_perf_lab.tsx:103-107`:

- `add`: increment by 1 if `canAdd`.
- `add5`: increment by 5 if memory guard is inactive.
- `remove`: decrement by 1, not below 0.
- `reset`: set count to 0.
- `refresh`: increment `nonce`.

The top toolbar buttons at lines 134-143 expose:

- `+ kitty`
- `+5`
- minus
- `refresh`
- `reset`
- `shell`
- `claude`

When `cmd` changes, every `Tile` receives a different `renderSrc`, so host feeds change from shell to claude or vice versa.

## Grid arrangement

At `cart/render_perf_lab.tsx:109-120`, the cart computes a square-ish grid:

- `cols = ceil(sqrt(count))`, minimum 1.
- `rows = ceil(count / cols)`, minimum 1.
- `rowList` contains tile ids per row.
- The last row is padded with empty `Box` cells so visible cells keep uniform width.

The grid is a pure layout calculation. It does not know host feed state.

## Top-level layout

The returned tree starts at `cart/render_perf_lab.tsx:125`.

Root:

- Full-size `Col`.
- Toolbar row.
- Body row containing tile matrix and right-side perf panel.

Toolbar at lines 128-154:

- Title and subtitle.
- Count control buttons.
- Command mode buttons.
- Memory-guard warning badge when active.
- Count readout.
- Current fps readout.

Body at lines 156-227:

- Left matrix area grows to fill.
- Right perf panel has fixed width 300.

When `count === 0`, the matrix shows an instruction message. When count is positive, it renders `Tile` components from `rowList`.

## Tile component

`Tile` at `cart/render_perf_lab.tsx:232-244` renders one capture tile.

Structure:

- Outer `Box` with flex sizing, border, radius, hidden overflow, theme surface background.
- Header `Row` with accent dot and tile number.
- Body `Box` with black background.
- `Render` primitive with `renderSrc={srcFor(id, cmd, nonce)}`.

`Render` is exported from `runtime/primitives.tsx:876-878` as a direct host element:

```ts
export const Render: any = (props: any) => h('Render', props, props.children);
```

`renderSrc` is a host prop declared in `runtime/host_props.ts:84-89`.

## Perf panel components

`Stat` at `cart/render_perf_lab.tsx:247-254` renders a label/value row.

`Sparkline` at `cart/render_perf_lab.tsx:256-278` renders a small bar chart:

- Uses the last 90 history samples.
- Empty state says "collecting...".
- Each bar height is clamped between 4 and 100 percent from `fps / 60`.
- Each bar uses `fpsColor`.

`MemBar` at `cart/render_perf_lab.tsx:282-295` renders RAM usage:

- Width is `usedMb / totalMb`.
- Color is error if used memory is beyond the reserve floor, otherwise success.
- Adds a warning marker at `((totalMb - reserveMb) / totalMb) * 100`.

Formatters:

- `pad2` at lines 311-313 zero-pads numbers under 10.
- `hms` at lines 314-317 formats minutes and seconds from a timestamp.

`Btn` at `cart/render_perf_lab.tsx:319-331` renders a styled `Pressable`. Disabled buttons use a no-op handler and opacity 0.4.

## Host render-surface path

In `framework/engine.zig:2605-2608`, if a node has `render_src`, the engine calls:

```zig
render_surfaces.setSuspended(src, node.render_suspended);
_ = render_surfaces.paintSurface(src, r.x, r.y, r.w, r.h, g_paint_opacity);
```

This cart does not set `renderSuspended`, so feeds are not intentionally suspended by the cart.

`framework/render/render_surfaces.zig` owns the feed lifecycle.

Source parsing:

- `parseSource` at `framework/render/render_surfaces.zig:212-263` maps strings to source types.
- `app:<command>` at lines 221-224 becomes source type `.display` with `command = source[4..]`.

Feed cap:

- `MAX_FEEDS = 64` at `framework/render/render_surfaces.zig:285`.
- `acquireFeedSlot` at lines 1201-1211 reuses stopped slots or grows the feed array until `MAX_FEEDS`.

Memory guard:

- `availableMemMb` at lines 1220-1233 reads host `/proc/meminfo`.
- `memoryHeadroomOk` at lines 1254-1263 uses env vars `RENDER_MEM_RESERVE_MB` and `RENDER_MEM_PER_FEED_MB`, defaulting to 2048 and 600.
- `createFeed` at lines 1274-1280 refuses `.display` or `.vm` feeds when the guard fails.

Feed matching:

- `findFeed` at lines 1184-1190 matches existing feeds by exact source string.
- This is why `srcFor` must make each tile source unique.

Feed creation for `app:`:

- `createFeed` at lines 1265-1481 parses source and dispatches by source type.
- `.display` handling at lines 1386-1400 chooses virtual display size from the node rect, floored to 320 by 240 unless an explicit resolution is provided.
- `startVirtualDisplay` at lines 1060-1087 spawns Xvfb, stores display number, stores app command, allocates pixel buffer, sets backend `.display_xshm`, waits for startup, and marks the feed interactive.
- `finalizeVirtualDisplay` at lines 1090-1177 opens the display, creates XShm capture, marks the feed ready, and launches the app command into the virtual display.
- `spawnXvfb` at lines 1039-1057 starts Xvfb, preferably through `setpriv --pdeathsig KILL` so the display dies with the parent process.

Frame update:

- `update` at lines 1511-1588 runs every frame.
- Ready `display_xshm` feeds call `captureXShm` at lines 1542-1544.
- If dirty, the feed ensures a texture and calls `uploadPixels` at line 1559.
- Inactive feeds are retired after `UNLOAD_DEBOUNCE_FRAMES`, defined as 180 frames at line 286.

Capture and upload:

- `captureXShm` at lines 648-689 captures X pixels and converts BGRX to RGBA in `pixel_buf`.
- `uploadPixels` at lines 750-790 and following forces alpha to 255, flips rows into a scratch buffer, and uploads to the wgpu texture.

Painting:

- `paintSurface` at lines 1594-1670 creates a feed when none exists, marks it active, waits until ready, computes draw rect, stores rect mapping, and queues a textured quad through `images.queueQuad`.
- For `.display_xshm`, the source is stretch-filled to the node rect.
- Other sources use aspect-ratio contain fit.

## Birth-size behavior

The cart's source comment describes a key behavior that comes from `.display` feed creation:

- Display feed size is chosen when the feed is created.
- For `.display`, host code uses `max(320, node_w)` by `max(240, node_h)` at `framework/render/render_surfaces.zig:1386-1391`.
- Later layout changes do not resize the existing Xvfb feed.
- Early tiles can keep larger birth resolutions after the grid shrinks.
- When the tile is smaller than the feed texture, the texture downscales into the tile.
- Pressing refresh changes `nonce`, changes source strings, retires old feeds, and spawns new feeds at current cell sizes.

This is why per-terminal cost trends with the feed's birth area, not just the currently visible cell size.

## Host functions and browser-like globals

Direct host-function paths:

- `readFile('/proc/meminfo')` calls `__fs_read` through `runtime/hooks/fs.ts`.
- `useTelemetry` calls host telemetry functions through `callHost`.

Indirect host paths:

- `Render` emits a host node with `renderSrc`.
- The engine calls `render_surfaces.paintSurface`.
- The render-surface host code spawns Xvfb and app subprocesses for `app:` sources.
- XShm and wgpu upload happen in Zig.

Browser-like globals used:

- `setInterval` and `clearInterval`.
- `Date.now`.
- `new Date`.

Not used:

- No `Scene3D`.
- No `Canvas`.
- No network/HTTP.
- No persistent store.
- No clipboard.
- No shell execution from JavaScript. Shell/app spawning is host-side through `app:` render source handling.
- No direct keyboard or pointer event handling beyond button presses.

## What is not here

- No cart folder or manifest. This is a single-file cart.
- No nested `AGENTS.md` applies to this path.
- No game world, entities, player, or camera.
- No game input movement.
- No 3D geometry.
- No imported assets.
- No external state persistence.
- No custom host binding from this cart.
- No direct feed-status query in the cart.
- No hard memory enforcement in JavaScript; enforcement is host-side.

## Integration-relevant observations

- `Render` sources are stable identities. Changing the string changes the host feed.
- `app:` render sources are a powerful bridge from ReactJIT UI into external processes.
- Virtual display capture has a lifecycle cost: Xvfb spawn, app spawn, XShm capture, GPU upload, quad paint.
- Source identity can be used as a deliberate refresh/re-rack mechanism.
- The host memory guard and UI soft guard should stay numerically aligned.
- Birth resolution matters for performance and memory, so feed sizing is a first-class concept.
- Telemetry hooks are the standard way carts observe host performance.
- `/proc/meminfo` is read in-cart for Linux-specific memory display, while the host independently reads the same file for safety.
- A performance lab like this is useful for finding hard renderer limits before integrating many live capture surfaces into a game or tool.

## Glossary

App source: A `renderSrc` beginning with `app:` that launches a command inside a virtual display.

Birth resolution: The Xvfb/feed pixel size chosen when the feed is first created.

CAP: Cart-side feed limit of 64, mirroring host `MAX_FEEDS`.

Capture tile: One UI tile containing a header and a `Render` surface.

Dirty feed: Host feed whose pixel buffer has a new captured frame that should be uploaded.

Feed: Host-side per-source capture state in `render_surfaces.zig`.

Guard active: Cart-side state where available RAM is below reserve plus one feed budget.

HIST: Number of samples retained for performance history.

Kitty capture surface: A `Render` tile that launches kitty in an Xvfb display.

MemAvailable: Linux `/proc/meminfo` field used to estimate free memory.

Nonce: Cart-side integer included in every render source to force all feeds to respawn.

PaintUs: Host paint time in microseconds from telemetry.

Render: ReactJIT primitive for external display/app capture surfaces.

renderSrc: Host prop string that identifies the source to capture.

Sample history: Cart-side array of recent fps/paint/count samples.

Soft guard: UI-level add-button disablement that mirrors the host OOM guard.

Telemetry: Host performance and observability counters read through `useTelemetry`.

Tile matrix: Auto-sized grid of capture tiles.

UploadPixels: Host function that uploads captured pixel data to a GPU texture.

XShm: X11 shared-memory capture path used for screen/window/virtual-display pixels.

Xvfb: Virtual X server spawned for each `app:` display feed.
