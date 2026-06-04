# hmsc_massive_map_lab — city-scale chunk-streaming + instancing stress lab

**Cart file:** `cart/hmsc_massive_map_lab.tsx` (single file, ~780 lines)
**Ship:** `./scripts/ship hmsc_massive_map_lab`
**Imports from the hmsc game:** `cart/hmsc/render3d/PlayerFigure.tsx`, `cart/hmsc/render3d/humanoid/face.tsx` (`HumanoidFaceCaptures`), `cart/hmsc/world/scale.ts` (`HMSC_SCALE`)

## What it is, in one sentence

A perf-measurement lab that answers "can we render a Miami-scale procedural city (12.8 km × 8 km, 4,000 chunks) in one `<Scene3D>`" by streaming a radius of deterministic hash-generated chunks around a movable focus and drawing the **entire visible city as ONE `<Scene3D.Instances>` batch**, with an extremely dense on-screen diagnostics panel reading the host telemetry surface.

This cart is a *question*, not a game: it exists to measure chunk-build cost, mesh counts vs caps, host fps vs JS-loop fps, and camera-input latency — and to be copy-pasted (it has a "copy diagnostics" button that snapshots everything to the system clipboard as JSON, clearly built so the user can paste the numbers back to a Claude).

## The world model (all JS-side, all deterministic, nothing stored)

- **Dimensions:** `MAP_WIDTH_METERS = 12,800`, `MAP_DEPTH_METERS = 8,000`, `CHUNK_METERS = 160` → 80 × 50 = **4,000 total chunks**. 1 unit = 1 meter (consistent with the scape3d/hmsc scale contract).
- **No storage anywhere** — no localstore, no files. The whole city is a pure function of coordinates: `hash2(a, b)` is an integer-mixing hash (`Math.imul`/xor-shift, plain JS) → `randRange(cx, cz, salt, min, max)` gives each chunk reproducible randomness. Pan away and back, the identical buildings reappear.
- **Zoning is analytic** (`chunkKind`): east third of the map = `water`; a 900 m disc near (18%, −4%) = `downtown`; central cross bands = `urban`; far west/south = `industrial`; rest = `suburb`. Kind drives building count/height/palette (`colorForHeight`) and ground color.
- **Buildings** (`generateBuildings`): each chunk splits into 2×2 blocks; per block up to N lots (downtown 7 → suburb 4 → industrial 3, scaled by the `density` knob 0.2–1.0); a hash gate skips lots probabilistically; position/footprint/height all `randRange`-derived; downtown heights to 155 m, suburbs 4–14 m.
- **Streaming** (`visibleChunks`): re-generates the square of chunks of `chunkRadius` (1–8, default 3 → 7×7=49 chunks) around the camera focus on every focus/radius/density change, clipped to map bounds. Wrapped in `useMemo` keyed on `[targetX, targetZ, chunkRadius, density]`, and self-timed (`chunkBuild.ms` shows on the panel). There is no cache and no incremental diffing — every step rebuilds all visible chunks from scratch; the lab's bet is that pure-hash generation is cheap enough (and the panel proves it).

## The rendering strategy — and the dead code that documents its history

**Live path:** `buildCityBatch()` flattens the entire visible city — ground slab, 2 sidewalk strips, road + avenue + center-line (skipped on water), and every building — into one flat `number[]` with **stride 9: x,y,z, sx,sy,sz, r,g,b** (`pushBoxInstance`, colors via `rgb01` hex→0-1 floats). That feeds a single `<Scene3D.Instances geometry={Geometry.Box} params={{1,1,1}} data stride={9} center boundsRadius>`.

- JS side: `runtime/primitives.tsx:709` (`Scene3DBase.Instances`) — interns the **unit box once** and ships `scene3dInstanceData/Count/Stride` host props.
- Host side: `framework/gpu/3d.zig` reads `scene3d_instance_stride` (~line 1435) and issues **one instanced draw call** for the whole batch. ~3,000+ boxes → 1 draw.
- This is textbook compliance with the unit-params + scale-transform rule (memory `geometry_intern_unbounded`): every box in the city shares ONE interned geometry; per-box size lives in the instance stream, not in geometry params.

**Dead code:** `ChunkGround` (line 317), `ChunkRoads` (346), `BuildingMesh` (375) are fully-written per-chunk `<Scene3D.Mesh>` components that are **never rendered** — grep confirms zero JSX usage. They are the abandoned mesh-per-box first draft, superseded by the instance batch, and `buildCityBatch` duplicates their exact geometry recipe (same offsets: ground at y −0.04, sidewalks 0.015/0.017, road 0.045, avenue 0.047, center-line 0.071). They survive as in-file documentation of the per-mesh ↔ instanced comparison the lab was built to make. If touched again: delete or rewire behind a toggle, don't let the two recipes drift.

## Camera system — two modes, hand-rolled, with self-instrumentation

One `CameraState` holds BOTH rigs (`mode: 'gameplay' | 'map'`):
- **gameplay** (key `1`): third-person chase — eye 15 m behind the focus at 4.4 m height along yaw, looking 44 m ahead, fov 62. Drag = mouselook (yaw/pitch per-pixel constants, pitch clamped −0.65..0.85 rad).
- **map** (key `2`): orbit — yaw/pitch/distance sphere around the focus (distance 320–4,200 m via `+`/`-`), fov 48. A cyan cylinder marker (`Geometry.Cylinder`) renders at the focus only in map mode.

`cameraPosition()`/`cameraTarget()` are pure trig — **no `@reactjit/cameras` rig is used** (this predates/parallels the registry; a consolidation candidate: gameplay ≈ Follow, map ≈ Orbit).

**The update pipeline is the interesting part** (`updateCamera`): writes go to a **ref** first (`cameraRef`), then either flush to React state immediately (key presses, mode buttons — `immediate=true`) or are **coalesced through a scheduled flush** (drags): first drag event schedules a flush via the rAF-probe (→ `setTimeout(fn,16)` on this host, since the V8 host has no rAF), subsequent drag events within the window just mutate the ref and bump a `coalesced` counter. Result: any number of mousemove events per frame collapse to ONE `setCameraState` → one chunk rebuild + one batch rebuild per frame, not per event. Every step of this is self-counted into `CameraDiagnostics` (updates/immediate/scheduled/coalesced/flushes, last flush delay ms, last drag deltas) and displayed — the lab instruments its own input pipeline because camera-drag jank was evidently a suspect.

## Input — two host channels

- **Keyboard:** `busOn('__keydown', ...)` from `runtime/hooks/useIFTTT.ts` — the host's `engine.zig` calls the registered `__ifttt_onKeyDown(packed)` global with a packed integer; `decodeKey` (useIFTTT.ts:352) unpacks key + modifiers and re-emits on the JS event bus. WASD/arrows pan the focus in 80 m steps (also snapping `playerYawDegrees` so the figure faces the walk direction), `+`/`-` zoom, `1`/`2` switch modes. Note: WASD pans in **world axes**, not camera-relative — fine for a lab, wrong feel for gameplay.
- **Mouse:** the whole cart root is a `<Pressable>` with `onMouseDown/Move/Up` → drag orbit/mouselook. Correctly follows the pointer-capture rule (all three handlers on the SAME node — memory `feedback_pointer_capture`).

## Telemetry — the heaviest user of `useTelemetry` in the repo

Nine simultaneous subscriptions via `runtime/hooks/useTelemetry.ts`: scalars `fps`/`layoutUs`/`paintUs`/`tickUs` @ 250 ms, `nodeCount` @ 500 ms, JSON snapshots `frame`/`gpu`/`nodes`/`input` @ 500 ms. Mechanism: each maps to a **registered V8 host fn** (`getFps`, `getLayoutUs`, `getPaintUs`, `getTickUs`, `__tel_node_count`, `__tel_frame`, `__tel_gpu`, `__tel_nodes`, `__tel_input`) via `callHost` from `runtime/ffi.ts`, polled with `setInterval`. Importing `useTelemetry` is what gates those bindings into the binary (metafile-gate, `sdk/dependency-registry.json`).

The panel cross-checks **host fps (Zig-measured) vs "raf fps" (JS-loop-measured)** — a second `useEffect` runs a free-running rAF-probe loop purely to measure JS-side frame cadence (fps/avg/min/max over 250 ms windows). Divergence between the two = the bridge or JS loop stalling while the host engine keeps ticking. It also surfaces `gpu` telemetry fields specific to the 3D pipeline: `scene3d_draw_us`, `scene3d_meshes_collected/_children/_dropped`, `scene3d_instances`, `scene3d_draw_calls` — i.e. the counters `framework/gpu/3d.zig`'s telemetry struct exports.

**Stale constants flag:** the diagnostics hardcode `meshCap: 8192` and `nodeIndexCap: 4096`, but `framework/gpu/3d.zig:170-171` now says `MAX_INSTANCES = 65536`, `MAX_SCENE_MESHES = 32768`. The caps were raised after this lab was written; its printed ceilings are wrong (conservative). 

## Clipboard export

"copy diagnostics" serializes the full snapshot (world params, visible counts, chunk-build ms, camera state+derived pos/target, all telemetry blobs, input diagnostics, `capturedAt` ISO timestamp) and calls `set()` from `runtime/hooks/clipboard.ts` → host fn `__clipboard_set`. Button label flips to copied/failed and resets on a `setTimeout`. This is the lab's *output device*.

## Player figure integration

`<PlayerFigure position={focus} yawDegrees animationSeconds={Date.now()/1000} moving={false}>` — the shared hmsc humanoid (skeleton/pose/palette in `cart/hmsc/render3d/humanoid/`), same model as the game and every NPC. Per its contract, the cart also mounts `<HumanoidFaceCaptures />` (`humanoid/face.tsx:218`) as a 2D sibling of the Scene3D — the offscreen StaticSurface bakes whose keys the figure's head decal samples (the same StaticSurface→textureKey bridge documented in `docs/game/billboard_demo.md`). `animationSeconds` only advances when something re-renders — fine here since the figure never `moving`.

## What this cart does NOT use

No localstore/persistence, no networking, no physics (no collision — the focus pans through buildings), no `@reactjit/cameras`, no Tailwind classes, no StaticSurface of its own (only via HumanoidFaceCaptures), no Skybox/Fog overrides (default auto-fog active), no `__hmsc_*` host physics, no road grammar / `__path_*` (its roads are paint, not drivable lanes).

## Recurring shapes (glossary candidates)

1. **Hash-deterministic procedural world** — world = pure function of (coords, seed-salts) via `Math.imul` mix; no storage, regenerate on demand. The "infinite city from nothing" shape.
2. **Chunk streaming around a focus** — radius window over a chunk grid, regenerate on focus move, clip to map bounds, `useMemo` keyed on focus+knobs.
3. **One-batch instanced city** — flatten everything box-like into a stride-9 float stream on ONE unit-box `Scene3D.Instances`. The proven scale answer (vs the dead per-mesh components left in-file as the losing contender). Sibling of `world_as_shader_quad` (2D) — same "one node, N things" move in 3D.
4. **Ref-buffer + coalesced-flush input** — high-frequency input mutates a ref; a scheduled once-per-frame flush commits to React state. THE pattern for drag/mouselook without re-render storms.
5. **rAF-probe / setTimeout-16** — third cart in a row (see billboard_demo); universal.
6. **Self-instrumenting lab + clipboard export** — labs measure themselves (timed useMemo, input counters, dual fps sources) and ship a copy-JSON button as the human↔AI feedback channel.
7. **Dual-rig camera in one state object** — gameplay chase + map orbit sharing a focus point, mode-switched. Pre-registry hand-rolled trig; convergence target = `@reactjit/cameras` Follow/Orbit.
8. **Telemetry panel idiom** — `useTelemetry` scalars at 250 ms + JSON at 500 ms + color-coded thresholds (green ≥55, amber ≥30, red below).
9. **Shared humanoid + face-capture contract** — any cart drawing `PlayerFigure` must mount `HumanoidFaceCaptures` next to its Scene3D. Cross-cart reuse of the game's own model.

## Quirks / honest caveats

- Every camera flush rebuilds all visible chunks AND the full instance array from scratch — measured-and-accepted brute force (the `chunk build ms` stat exists to watch exactly this). At radius 8 (17×17=289 chunks) this is the knob that hurts.
- The instance `data` array gets a fresh identity every rebuild → the whole batch re-ships across the bridge each camera flush. That's the cost being measured, not a bug — but it's the number to remember when comparing against the baked-world direction (memory `feedback_react_3d_is_authoring_not_runtime`).
- `capturedAt: new Date().toISOString()` and `Date.now()` are fine in carts (the no-Date rule is Workflow-script-specific, not cart-side).
- The dead trio (`ChunkGround`/`ChunkRoads`/`BuildingMesh`) duplicates the batch recipe — drift hazard if either side is edited alone.
- `meshCap 8192` / `nodeIndexCap 4096` printed on the panel are stale (real caps now 32768 / see layout); trust the host telemetry numbers, not the labels.
