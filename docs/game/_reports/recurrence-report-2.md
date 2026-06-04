# Recurrence Report 2 — Cross-Document Synthesis of `docs/game/`

Source corpus: all 33 per-cart/per-module audit docs in `docs/game/` (the `_reports/` subdirectory excluded). Every claim below cites the supporting doc filename(s). Counts are out of 33 docs reviewed. This is a synthesis of what the auditors wrote — taken at face value as the source of truth, no source code was re-read.

The corpus splits into roughly: **game carts** (hmsc, scape, planet_run, shitcoin, voxel_stack_demo, input_bench), **labs** (animation_lab, bodylab, camera_lab, carve_lab, combat_lab, hmsc_scale_lab, hmsc_massive_map_lab, pathing_lab, physics_lab, ragdoll_lab, render_perf_lab, head_lab, geometry_demo, billboard_demo, boxxx_demo, effect_fills), **editors/tools** (cutout, composer, hmsc-int, pixel_icon_demo), **viewers/galleries** (pixel_icon_gallery, game_item_gallery), and **shared modules / build tooling** (animationDsl, bake-geometry, physics3d).

---

## 1. RECURRING PATTERNS / SHAPES

Ordered by document count (the most-recurring are the project's fundamental concepts).

### 1.1 The rAF-probe / `setTimeout(16)` game loop — ~19 docs

The single most universal idiom. The V8 cart host has **no `requestAnimationFrame`**, so every animated cart probes `globalThis.requestAnimationFrame` and falls back to `setTimeout(fn, 16)`; in practice every cart runs on the setTimeout branch. Paired almost always with `performance.now()` (fallback `Date.now()`) and a `dt` clamp (commonly `[0.001, 0.05]` or `[1, 50]ms`) to keep a hitch from exploding the sim.

Docs: `billboard_demo.md`, `animation_lab.md`, `bodylab.md`, `camera_lab.md`, `combat_lab.md`, `hmsc_massive_map_lab.md`, `hmsc.md`, `physics_lab.md`, `planet_run.md`, `ragdoll_lab.md`, `scape.md`, `pathing_lab.md`, `game_item_gallery.md` (uses `setTimeout` loop), `shitcoin.md` (drainFrame rAF loop), `voxel_stack_demo.md` (notes absence), `hmsc-int.md` (usePaintedField coalesce), `head_lab.md` (notes it uses `setInterval` *instead* — the editor exception), `pixel_icon_gallery.md`/`pixel_icon_demo.md` (use `setInterval`, note rAF absent). Multiple docs explicitly call it "fourth/third consecutive cart" — `planet_run.md`, `hmsc_massive_map_lab.md`.

Variation worth canonizing: **editors use `setInterval`, games use the rAF-probe** (`head_lab.md` makes this explicit — 150/90/50ms interval clocks; pixel_icon and gallery use setInterval for playback).

### 1.2 Sim-in-refs + render-by-tick-counter (the game-loop state shape) — ~10 docs

All mutable simulation state lives in one `useRef` object; React state holds only UI knobs plus a dummy `setTick(t => t+1)` / `setFrame` bumped once per loop tick to force a render. UI values the loop needs are mirrored into refs (`uiRef`) so the closed-over tick function never reads stale React state. `ragdoll_lab.md` names it "sim in refs, render by tick counter, UI mirrored into refs" and proposes a `useGameLoop` hook.

Docs: `ragdoll_lab.md`, `planet_run.md`, `combat_lab.md`, `physics_lab.md`, `scape.md`, `hmsc_massive_map_lab.md` (ref-buffer + coalesced flush variant), `input_bench.md` (mutable `Controller` + render heartbeat), `animation_lab.md` (sim ref + frame counter), `pathing_lab.md`, `hmsc.md`.

### 1.3 StaticSurface → `textureKey` bridge ("2D on 3D faces") — ~12 docs

Render an offscreen 2D subtree (`<StaticSurface staticKey="X">`, parked at `left: -99999`) into a cached GPU texture; a `<Scene3D.Mesh textureKey="X">` samples it host-side per frame. String-keyed, cross-tree, the 2D capture and 3D mesh never reference each other in JS. `billboard_demo.md` is the canonical proof; the same bridge powers humanoid face decals, building facades, road/junction/tile surfaces, drive-in screens, and carve textures.

Docs: `billboard_demo.md` (canonical), `carve_lab.md`, `game_item_gallery.md`, `head_lab.md`, `hmsc.md` (floors/roads/junctions/facades/parts/props/faces/landforms/water/drive-in all use it), `hmsc_scale_lab.md`, `hmsc_massive_map_lab.md`, `planet_run.md`, `ragdoll_lab.md`, `combat_lab.md`, `effect_fills.md` (prescribes bake-once and live-StaticSurface paths), `hmsc-int.md` (face-skin mini-renders). Companion hazard `static_surface_inline_props_rebake` (inline `data`/`style` → per-frame rebake) cited in `billboard_demo.md`, `planet_run.md`, `hmsc.md` (tileSurface stabilizes identities).

### 1.4 Geometry registry + intern cache (`Geometry.X` generators, unit-params rule) — ~16 docs

`@reactjit/geometries` exposes shapes as TS `generate(params)` functions, not a Zig enum. `internGeometry(def, params)` computes a stable `id|stableStringify(params)` key, runs the generator once, ships verts to the host only on first use of a key. The load-bearing rule: **unit params + scale transforms** — a per-frame-varying float in `params` mints a fresh vertex buffer every frame and OOMs V8 (`geometry_intern_unbounded`). Carts can author registry-shaped geometry inline (`def(id, defaults, generate)`).

Docs: `bake-geometry.md` (the build-time bake of this), `geometry_demo.md` (the test-bed), `billboard_demo.md`, `animation_lab.md`, `bodylab.md`, `camera_lab.md`, `carve_lab.md`, `combat_lab.md` (UNIT_CYL/BOX module constants), `hmsc_massive_map_lab.md` (instanced unit box), `hmsc_scale_lab.md`, `physics_lab.md` (inline `def()`), `game_item_gallery.md` (custom Blade/Sail/BoatHull/Surfboard), `voxel_stack_demo.md`, `ragdoll_lab.md`, `planet_run.md`, `pathing_lab.md`.

### 1.5 The `<Effect>` shader quad fed by one flat `f32` array — ~12 docs

`<Effect shader={WGSL} data={[...]}>` is THE single user-WGSL surface; `data` → `effectData` host prop → storage buffer at `@group(0) @binding(1)`. Animating = re-uploading `data` per frame without recompiling the pipeline. The "pack a struct into a flat f32 array → storage buffer" shape is the standard dynamic-shader-data idiom. `scape.md` and `world_as_shader_quad` are its apex: the entire world is ONE Effect quad inverse-projecting every fragment.

Docs: `billboard_demo.md`, `effect_fills.md` (the mega-shader-with-selector — one WGSL, `D[]` picks the look across 58 materials), `scape.md` (world-as-quad + minimap + item icons), `pixel_icon_gallery.md` (palette+indices), `cutout.md` (MaskQuad), `game_item_gallery.md`, `planet_run.md` (PLANET_WGSL), `hmsc.md` (tile/road/junction/landform/water fills + minimap), `hmsc-int.md` (chunk surfaces, heightfield views), `carve_lab.md`, `composer.md` (SQI shaders are scape-cousins), `combat_lab.md` (none — flagged absent). WGSL gotchas (no unary `+`, no backticks in comments, `pr_` prefix to avoid colliding with the prepended shared math lib) recur in `billboard_demo.md`, `planet_run.md`.

### 1.6 Camera-rig system — the registry vs the hand-rolled trig fork — ~13 docs

`@reactjit/cameras`: every rig is a pure `solve(params) → Solved {pos, target, fov}`; `CameraRig` emits one `<Scene3D.Camera>`; picking inverts via the generic `unprojectGround`. Drop-in components: Orbit / Follow / TopDown / Isometric / FirstPerson / FreeFly / Cinematic. `camera_lab.md` is the showcase. The recurring tension (see §3): **many carts use the registry, several hand-roll the same trig.**

Registry users: `camera_lab.md`, `carve_lab.md`, `bodylab.md`, `game_item_gallery.md`, `ragdoll_lab.md`, `planet_run.md` (FollowCamera), `pathing_lab.md`, `voxel_stack_demo.md`, `head_lab.md`, `input_bench.md`, `hmsc-int.md` (ModelViewer). Hand-rolled trig: `hmsc_scale_lab.md` (`cameraFromOrbit`), `hmsc_massive_map_lab.md` (dual-rig gameplay+map, "convergence target = Follow/Orbit"), `animation_lab.md`, `combat_lab.md` (hmsc's own follow/aim cam), `hmsc.md` (GameWorld3D camera).

### 1.7 Bus-mediated keyboard + pull-based pointer input — ~13 docs

Keyboard: the host packs one int (`keysym | modifiers<<16`), calls `__ifttt_onKeyDown`, `useIFTTT.ts decodeKey` unpacks and `busOn('__keydown'/'__keyup')` fans out in JS; carts maintain a `keysRef` boolean map polled by the tick. Pointer drag: `onMouseDown/Move/Up` ALL on the SAME node (the pointer-capture rule, `feedback_pointer_capture`); coordinates are pulled from host `getMouseX/Y` at dispatch, not carried in the event.

Docs: `hmsc_scale_lab.md` (full path documented), `camera_lab.md`, `combat_lab.md` (first to consume keyup), `ragdoll_lab.md`, `planet_run.md`, `physics_lab.md`, `scape.md`, `hmsc_massive_map_lab.md`, `pathing_lab.md`, `input_bench.md`, `hmsc.md`, `hmsc-int.md`, `voxel_stack_demo.md`. Polled-host-input variant (`isKeyDown(scancode)`, `__mouse_delta`, `getMouseRightDown`) for camera-look: `combat_lab.md`, `physics_lab.md`, `animation_lab.md`, `hmsc.md`.

### 1.8 The primitive-cluster humanoid: `drivePose` → `solveHumanoid`/`solve` → `Figure` — ~9 docs

A character built from many small primitive meshes positioned each frame by a parametric solver: a `drivePose(t, moving, running)` gait generator feeds a skeleton solver that emits a flat parts array, rendered as `Scene3D.Mesh` clusters with palette-mapped material slots. This is a fundamental concept — but it is **implemented at least four times** (see §3.1).

Docs: `bodylab.md` (drivePose/solveHumanoid/HumanoidFigure in `humanoid.tsx`), `hmsc.md` + `hmsc_scale_lab.md` (`render3d/humanoid/` drivePose/solveHumanoid/Figure), `animation_lab.md` (inline AnimatedFigure + poseFor), `camera_lab.md` (HUMANOID parts array), `input_bench.md` (Figure "copied from camera_lab"), `head_lab.md` + `ragdoll_lab.md` + `planet_run.md` + `pathing_lab.md` + `combat_lab.md` (head_lab's parts.ts skeleton — the *other* stack).

### 1.9 Bones-as-interface (the figure stack's lingua franca) — ~5 docs

`Record<BoneId, SkeletonBone>` is the interchange format: produced by three sources (animation `buildSkeleton`, physics `bonesFromRagdoll`, blend `blendBones`) and consumed by one sink (`buildRigFrameFromBones` → meshes + clothing + hitboxes + anchors). Mode switches swap the *producer*; everything downstream is oblivious. Same instinct one level up: hmsc's skeleton solves mesh AND hitbox from one solve so they can't drift.

Docs: `head_lab.md` (the design seam), `ragdoll_lab.md` ("bones record is the lingua franca"), `pathing_lab.md`, `combat_lab.md`, `hmsc.md`/`hmsc_scale_lab.md` ("rig solved once → parts + zones + eye").

### 1.10 Registry-driven kinds: "struct stores `kind`, registry gives it meaning" — ~9 docs

The project's load-bearing data architecture. A live instance carries a `kind` string; a registry maps that kind to behavior/appearance. Recurs for tiles, buildings, props, NPCs, roles, landforms, items, blocks, physics items.

Docs: `hmsc.md` (tileKinds/buildingKinds/propKinds/npc kinds/roles/landforms), `combat_lab.md` ("registries as the tuning surface"), `scape.md` (packed-bits tile encoding + item modules), `voxel_stack_demo.md` (BLOCKS registry with drop/solid/opacity), `game_item_gallery.md` (ITEMS registry), `physics_lab.md` (ITEM_CATALOG), `pathing_lab.md` (tile kinds), `hmsc-int.md` (kind registries re-resolved, never stored), `effect_fills.md` (material/board tables).

### 1.11 Keep high-frequency input out of React (ref-buffer + commit/flush on release) — ~7 docs

A family: GPU-paint/readback-on-release (`usePaintable`, one readback per stroke), host latches (`'latch:key'` + `__latchSet`, zero re-renders, commit on release), ref-buffer + coalesced once-per-frame flush (camera drags), Paintable-as-state. `head_lab.md` calls it "the repo-wide keep-high-frequency-input-out-of-React family."

Docs: `head_lab.md` (paint readback + latch system — three instances in one file), `hmsc_massive_map_lab.md` (ref-buffer + coalesced flush), `cutout.md` (Paintable direct GPU writes, RLE/readback at commit only), `pixel_icon_demo.md` (hi-res mask in a ref, version bump on commit), `hmsc-int.md` (usePaintedField coalesce, settle-snap), `composer.md` (commitCoalesced), `ragdoll_lab.md` (UI mirrored into refs).

### 1.12 The workspace-cart pattern (envelope + autosave + snapshot undo) — 4 docs

Stateless view over an on-disk `SessionEnvelope`, 600ms debounced autosave on dep change, restore-on-mount from `_last.txt`, full-envelope snapshot undo/redo, `commit()` vs `commitCoalesced()` (250ms) history discipline. The 7-file cutout shape is the canonical template.

Docs: `cutout.md` (origin/reference), `composer.md` ("second consumer", mirrors cutout's 7-file shape), `hmsc-int.md` ("third consumer", v2 payload carrying the whole world), and `runtime/workspace` is the extracted shared layer. The `_old`-file convention (legacy snapshots kept in-tree, not imported) recurs here and in `input_bench.md`.

### 1.13 Producer/consumer cart pairs over a shared on-disk format — 3+ docs

Disk is the channel; one cart writes, another reads. `pixel_icon_demo` (producer) ↔ `pixel_icon_gallery` (consumer) over `.64.json`. cutout exports `.sqi.json`; head_lab's `.hed`/`.body` are the same family; hmsc-int Compile → game boot key.

Docs: `pixel_icon_gallery.md`, `pixel_icon_demo.md`, `cutout.md`, `head_lab.md`, `hmsc-int.md` (Compile = persist GameState to shared localstore boot key).

### 1.14 Shader/JS twin (hand-mirrored math, "see-it == use-it") — ~5 docs

Terrain/noise math written once in WGSL and hand-mirrored in JS so gameplay can query "is this on land?" against what the texture actually shows. The contract is powerful and fragile — edit one side, the other silently lies. The host-side resolution of the same problem is one height fn baked into both mesh AND collider.

Docs: `planet_run.md` (`prFbm`/`terrainAt` mirror PLANET_WGSL), `scape.md` (inverse projection twinned JS↔WGSL), `combat_lab.md` ("the rendered thing IS the tested thing"), `physics_lab.md` (TS↔Zig line-for-line sim port), `hmsc_terrain_is_flat_rects` referenced in `physics3d.md`/`physics_lab.md`. `combat_lab.md` proposes naming this the "see-it==hit-it doctrine."

### 1.15 One-batch instanced rendering (`Scene3D.Instances`, stride-9) — 3 docs

Flatten many identical box-like things into one stride-9 `[x,y,z, sx,sy,sz, r,g,b]` float stream on ONE unit-box `Scene3D.Instances`; the host issues one instanced draw. Ships vertices once per geometry key. The proven scale answer for big worlds.

Docs: `hmsc_massive_map_lab.md` (the whole city in one batch), `voxel_stack_demo.md` (one batch per block kind), `boxxx_demo.md` (the 2D sibling — `<Boxxx>`/RectBatch instanced-rect pipeline). Notable gap (`voxel_stack_demo.md`): per-instance opacity isn't in stride-9, so translucent kinds render opaque.

### 1.16 Lesser repeats (named, lower count)

- **Seeded PRNG + rejection-sampling scatter** (`Math.imul` mixers, mulberry32): `planet_run.md`, `hmsc_massive_map_lab.md`, `geometry_demo.md` (LCG), `pathing_lab.md`, `head_lab.md` (face gen).
- **Thin-box-not-plane ground** (a true `geometry="plane"` is single-sided and back-face-culls from above): `camera_lab.md`, `carve_lab.md`, `skybox_demo.md` (referenced), `input_bench.md`, `hmsc_scale_lab.md`.
- **Memo'd static scene / mesh bundle isolated from camera state**: `bodylab.md`, `camera_lab.md`, `input_bench.md`, `head_lab.md`, `hmsc.md` (GameWorld3D), `ragdoll_lab.md`.
- **Overlays as the root's LAST children** (hit-test is paint-order, not zIndex): `planet_run.md`, `voxel_stack_demo.md`, `hmsc_scale_lab.md`, `scape.md`, `hmsc-int.md` (ProjectBar menus).
- **Self-instrumenting lab + clipboard/copy-JSON export** (labs measure themselves, ship the numbers to a Claude): `hmsc_massive_map_lab.md`, `input_bench.md`, `physics_lab.md` (timing HUD).
- **Telemetry-panel idiom** (`useTelemetry` scalars @250ms + JSON @500ms + color thresholds): `hmsc_massive_map_lab.md`, `render_perf_lab.md`, `hmsc.md` (DebugHud), `cutout.md` (StatusBar fps).
- **The classifier/theme-token system** (`theme:` tokens, `.cls.ts` sheets, variant families): `shitcoin.md` (deepest), `hmsc-int.md` (studio.cls), `render_perf_lab.md` (theme tokens).
- **IFTTT bus as integration spine** (`busOn`/`busEmit`, `hmsc:event:*` channels, story flags): `hmsc.md`, `shitcoin.md`, `combat_lab.md`, `camera_lab.md`, `hmsc-int.md` (kind-texture broadcast).
- **Live LLM subprocess NPC / assistant** (`useAssistant`/`__worker_*`/claude_code): `scape.md` (Roach), `hmsc-int.md` (assist3d + ChatTab).
- **Packed-f32-snapshot-over-ArrayBuffer (zero-copy) hot path + CSV charCode-scanner fallback**: `physics_lab.md`, `animation_lab.md`/`input_bench.md` (CSV), `hmsc.md` (`__hmsc_physics_step`).

---

## 2. NAMING / PLACEMENT LIES

Cases where a filename or directory placement misleads a future reader about live-vs-dead, lab-vs-production, or ownership. The gold-standard pair the task names is confirmed by the docs and is the worst offender; several siblings exist.

### 2.1 `framework/v8_bindings_physics_lab.zig` is the LIVE production physics backend (GOLD STANDARD)

The filename reads as throwaway lab glue. It actually contains **the live hmsc physics backend**: `__hmsc_physics_step`, `__hmsc_register_heightfield`, `__hmsc_clear_heightfields`, `__hmsc_spike_trace` — consumed in production by `cart/hmsc/state/hostPhysics.ts`. The lab-specific fns (`__physics_lab_*`) are a minority cohabitant. `physics_lab.md` states it outright: "`framework/v8_bindings_physics_lab.zig` ... has since grown into the **real hmsc physics backend**." `physics3d.md` confirms it as "what actually does 3D physics in the game today." `hmsc.md` lists these host fns as load-bearing. **Recommendation in §6.**

### 2.2 `framework/phys/physics3d.zig` looks like serious framework physics but is fully DORMANT

The directory placement (`framework/phys/`) and name imply the canonical 3D physics module. It is "fully implemented and completely disconnected" — never compiled in `build.zig`, no Node fields, no JS primitive, no registered host fn, never reachable from a cart in the V8 era. Its own header comment describes `<3D.Physics>` and `Node.physics3d_world_id` wiring "that does not exist" — aspirational Smith-era drift. `physics3d.md` is the entire dedicated doc; it explicitly flags "doc-comment drift as a trap — trust grep over header comments."

**The pointed irony** (both docs): the one collider hmsc's terrain needed — heightfield — is exactly the enum case `physics3d.zig` stubbed `null`, while the "lab" file implemented it first-class. The names are backwards relative to reality.

### 2.3 `framework/v8_bindings_input_bench.zig` is reused as production drive movement

Named for input benchmarking, but `animation_lab.md` documents the cart driving its **drive-mode movement** through `__input_bench_*` host fns ("Input bench: Zig-side WASD movement backend originally from input benchmarking, reused here for drive mode"). A reader would assume it's only the input_bench cart's harness; it's a general movement integrator. Lower severity (it really is also the bench backend) but the name hides a second consumer.

### 2.4 `cart/hmsc/labs/ScaleLabScene.tsx` — an orphaned, drifted near-copy presenting as a live scene

`hmsc_scale_lab.md` flags it: a near-verbatim copy of the standalone `hmsc_scale_lab.tsx` scene, offset for embedding, **imported by nothing** (grep: zero consumers), and already drifted (purple height line uses `PLAYER_VISUAL_TOTAL_HEIGHT` 2.45m where the cart uses `PLAYER_VISUAL_HEAD_TOP` 2.04m). Its `labs/` placement implies it's the in-game scale lab; it's dead code with a divergent constant.

### 2.5 `hmsc-int/AGENTS.md` documents `MapCanvas.tsx` which is now `PaintCanvas.tsx`

`hmsc-int.md` flags doc-drift inside the cart's own agent contract: the file was renamed but the contract still names the old one. A reader following the contract looks for a file that doesn't exist.

### 2.6 `cart/ragdoll_lab/car.tsx` header comment claims pathing_lab drives fleets of it — false

`ragdoll_lab.md`: the `car.tsx` header says "shared … pathing_lab drives fleets of them," but `pathing_lab` now imports `buildVehicle` from `vehicle_lab`. `CarMeshes` has exactly one consumer (ragdoll_lab itself). The comment lies about ownership/reuse.

### 2.7 The `_old` / `_old.ext` shadow files (legacy-presenting-as-live across a directory)

Several carts keep `_old` snapshots in-tree, not imported by the active path: `cutout.md` (`state_old.ts`, `session_old.ts`, `Editor_old.tsx`, `Inspector_old.tsx`), `input_bench.md` (`index_old.tsx`, `backend_lua_old.tsx`). They are intentional breadcrumbs per the repo's `_old` convention, but a reader grepping a directory sees two implementations of the same thing with no in-file marker of which is live — a placement ambiguity by design that still misleads. (Per the user's global CLAUDE.md `_old` rule, these are sanctioned; flag for a cleanup pass, not a bug.)

### 2.8 Dead-but-present components inside live files

- `hmsc_massive_map_lab.md`: `ChunkGround`/`ChunkRoads`/`BuildingMesh` are fully-written `Scene3D.Mesh` components **never rendered** (the abandoned per-mesh first draft), duplicating the live instanced-batch recipe — drift hazard if either is edited alone.
- `pixel_icon_demo.md`: a whole "vestigial Canvas editor" (canvasRect setter never called, `screenToWorld`/`paintAtWorld`/`hiResOverlayCells` computed-but-never-rendered) — costs a wasted O(srcW×srcH) scan per stroke.
- `scape.md` / `composer.md`: `ui/Wheel.tsx` (documented orphan) and the entire `composer/sources/` online-sample subsystem (~1000 lines, "no component consumes them — grep finds zero references in components/") — built ahead of UI; reads as wired when it isn't.
- `cutout.md`: `AdvancedProperties` ONNX test UI exists but isn't rendered by the tab switch.

---

## 3. DUPLICATED / PARALLEL SYSTEMS (no canonical winner)

### 3.1 Humanoid / figure systems — at least FOUR implementations, two of them load-bearing

This is the single biggest convergence candidate in the corpus (every figure-drawing doc flags it).

1. **hmsc's `cart/hmsc/render3d/humanoid/`** — fixed primitive parts, baked face decals, 6 **capsule** hit zones, palette recolors, NO physics. `drivePose`/`solveHumanoid`/`Figure`. Used by: hmsc game, hmsc_scale_lab, hmsc_massive_map_lab, combat_lab (damage table). Docs: `hmsc.md`, `hmsc_scale_lab.md`, `hmsc_massive_map_lab.md`.
2. **head_lab's `cart/head_lab/parts.ts` + `figureRender.tsx`** — sculptable Globe parts, `.hed` faces, 25 named bones, oriented-**box** hitboxes, full clothing/accessory system, Verlet ragdoll. `buildSkeleton`/`buildRigFrameFromBones`/`FigureMeshes`. Used by: head_lab, planet_run, ragdoll_lab, combat_lab, pathing_lab. Docs: `head_lab.md`, `ragdoll_lab.md`, `planet_run.md`, `pathing_lab.md`, `combat_lab.md`.
3. **bodylab's `cart/bodylab/humanoid.tsx`** — its own `drivePose`/`solveHumanoid`/`HumanoidFigure` (same names as #1, different file) plus near-identical math helpers (`rotateY`/`rotateX`/`orient`/`segmentPose`). Doc: `bodylab.md`.
4. **The inline/copied parts-array figures** — `animation_lab.tsx` (inline `AnimatedFigure` + `poseFor` + `segmentPose`), `camera_lab.tsx` (`HUMANOID` 18-part array), `input_bench/scene.tsx` (`Figure` "humanoid part table copied from camera_lab"). Plus `Geometry.Humanoid` (the single baked registry mesh) used only by camera_lab. Docs: `animation_lab.md`, `camera_lab.md`, `input_bench.md`.

**The most telling drift** (`ragdoll_lab.md`, `combat_lab.md`): the *same six-region locational-damage model* with **reversed naming** — head_lab/ragdoll_lab use `lArm/rArm/lLeg/rLeg`; hmsc's `DamageZone` uses `armL/armR/legL/legR`. combat_lab already bridges them via `boneZone()`'s rename. **Consolidation winner:** combat_lab.md says hmsc lifts head_lab's hitboxes + its own ZONE_DAMAGE table; the head_lab stack is richer (physics, clothing, sculpt, faces) and is the reference for four carts; hmsc's is the in-game one. They must converge on one bone/zone vocabulary; combat_lab is the explicit dress-rehearsal for that merge.

### 3.2 "Hit chance / odds" engines — TWO, both production games

`scape/systems/chance.ts` (multiplier `ChanceBreakdown`, weapon `RangeProfile`, tile-grid LoS with glass-window shots) vs `hmsc/npc/systems/chance.ts` (`hitChance` with `coverFraction`). Both are *games* (scape 2D, hmsc 3D). Both honor the same project law (ground truth in chance.ts, display warp in a separate perception module). `scape.md` and `combat_lab.md` both flag it. **Winner per `scape.md`:** scape's breakdown legibility ("WHY is it 33%") is the richer surface; hmsc's cover-fraction producer (`coverFractionOf`, built in combat_lab) is the richer input — reconcile into one engine when the worlds converge.

### 3.3 Camera implementations — registry vs hand-rolled trig (the same rigs twice)

`@reactjit/cameras` Orbit/Follow exist as pure solvers, yet `hmsc_scale_lab` (`cameraFromOrbit`), `hmsc_massive_map_lab` (dual gameplay+map trig, "convergence target = Follow/Orbit"), `animation_lab`, and hmsc's GameWorld3D all hand-roll the equivalent. Docs: `camera_lab.md` (the registry), `hmsc_scale_lab.md`, `hmsc_massive_map_lab.md`, `animation_lab.md`. **Winner:** the registry — `ragdoll_lab.md` and `planet_run.md` show clean adoption; the hand-rolled ones are "the pre-registry shape of the same thing."

### 3.4 The screen→world picking ray — duplicated view-basis math (3+ bodies)

`runtime/cameras/unprojectGround` owns the camera inverse but only exposes **ground-plane** picking. Any cart needing non-ground picking re-rolls the view basis: `voxel_stack_demo` (`screenRay` for block faces), `hmsc-int/assist3d/picking.ts` (screenRay + AABB-slab pick), and the math also lives in scape3d's projection. `voxel_stack_demo.md` names the fix: export a generic `screenRay(sx, sy, rect, solved)` and make `unprojectGround` a consumer.

### 3.5 `decodeMatrix` / `encodeMatrix` + `PixelMatrix` format — duplicated across the pixel-icon pair

`decodeMatrix` is a near-verbatim copy in `pixel_icon_gallery.tsx` and `pixel_icon_demo.tsx`; `encodeMatrix` lives only in the demo. The encode/decode pair + the `.64.json`/`.64.anim.json` filename convention are an undocumented file-format module that should be one shared file. Docs: `pixel_icon_gallery.md`, `pixel_icon_demo.md`. (`PixelMatrix` itself is the lingua franca with **four producers** — magick parse, seed-procedural, editor edits, disk decode — and two renderers; the type is the stable hub, the codec is not.)

### 3.6 Color/hex utilities — re-rolled 4+ times

"Darken a hex" exists as `darkHex` (`car.tsx`), `darkShoe` (`parts.ts`), `darken` (`humanoid/face.tsx`), plus `mixHex`/`hpColor` (ragdoll_lab, combat_lab). All parse `#rrggbb`, scale channels, re-emit. Docs: `ragdoll_lab.md` (lists four), `combat_lab.md` ("hex-helper sprawl grows by two").

### 3.7 V3 / clamp / `lerp3` math helpers — re-rolled per file

`clamp` re-rolled in 4+ files within `scape` alone (`scape.md`); `lerp3` defined twice in the ragdoll dependency chain (`ragdoll_lab.md`); `sub/len3/mid3/add/rotateY/rotateX` per-file across the labs. The single most pervasive low-value duplication.

### 3.8 The yaw-prepend transform — three+ implementations of one helper

"rotate local offsets about Y, add yawDeg to each ry, under host Ry·Rx·Rz order" appears as `place()` in `car.tsx`, `place()/turn()` in `FigureMeshes`, `placeBones`, `local()`/`Part` in game_item_gallery and physics_lab, `point()`/`segmentPose` in animation_lab. `ragdoll_lab.md` and `physics_lab.md` both name it: `Scene3D` wants nested transforms or one shared `placeLocal(yaw, origin)` helper. Docs: `ragdoll_lab.md`, `physics_lab.md`, `game_item_gallery.md`, `animation_lab.md`.

### 3.9 Item / prop models — fragmenting across 4 places

The same item-model concept (`ModelCtx` + `Part` + model-function) exists in `game_item_gallery` (ITEMS), `physics_lab` (ITEM_CATALOG, hand-synced TS↔Zig), head_lab (imports game_item_gallery's ITEMS for held items), scape (item-module registry with WGSL branches), scape3d (thingymajiggers). Car geometry/metrics alone fragment across `ragdoll_lab/car.tsx`, `vehicle_lab` (`buildVehicle`), hmsc's `structures/Car.tsx`, and `HMSC_SCALE.car` (4×2×1.5m vs ragdoll's ~3.7×1.8). Docs: `game_item_gallery.md`, `physics_lab.md`, `ragdoll_lab.md`, `scape.md`.

---

## 4. CROSS-DOC CONTRADICTIONS

### 4.1 Damage-zone naming directly contradicts itself across the two figure stacks

`ragdoll_lab.md`: regions `lArm/rArm/lLeg/rLeg`. `combat_lab.md` + `hmsc.md`: `DamageZone` = `armL/armR/legL/legR`. The *same* six-region model, opposite naming order — and combat_lab must rename one into the other (`boneZone()`) to make them speak one language. A direct, load-bearing inconsistency.

### 4.2 The `ScaleLabScene` vs `hmsc_scale_lab` constant disagreement

`hmsc_scale_lab.md`: the orphan draws the purple height line at `PLAYER_VISUAL_TOTAL_HEIGHT` (2.45m); the live cart draws it at `PLAYER_VISUAL_HEAD_TOP` (2.04m). Two "authoritative" scale-reference scenes disagree on a player metric by 0.41m. Both also hand-transcribe `PLAYER_VISUAL_*` from `skeleton.ts` geometry that exports neither — a documented drift that "already violates" the contract.

### 4.3 Stale telemetry caps printed vs real caps

`hmsc_massive_map_lab.md`: the diagnostics panel hardcodes `meshCap: 8192` / `nodeIndexCap: 4096`, but `framework/gpu/3d.zig` now says `MAX_INSTANCES = 65536`, `MAX_SCENE_MESHES = 32768`. The lab built to measure renderer limits prints **wrong (stale, conservative) ceilings** — a reader trusting the panel under-estimates headroom by ~4–8×.

### 4.4 One doc documents a lesson another cart violates: the inline-data rebake trap

`billboard_demo.md` documents `data={[tick*0.05]}` as the canonical `static_surface_inline_props_rebake` hazard (fresh array identity each render → 40ms+ per-frame rebake in a static-capture context) — intentional there. `planet_run.md` and `hmsc.md`'s tileSurface explicitly *obey* the lesson (memo'd capture + useMemo'd data/style). The lesson is consistent across docs, but the corpus shows it's a live footgun (hmsc's open idle-paint-spike hunt, `devhost_hotreload_rebake_spike`) — i.e. somewhere a cart still trips it. Not a contradiction between docs, but a documented-lesson-vs-live-bug tension the corpus repeatedly circles.

### 4.5 "No host calls" vs reused host backends — the same Zig file framed two ways

`physics3d.md` frames `v8_bindings_physics_lab.zig` as "the live hmsc backend" (production). `physics_lab.md` frames the same file primarily as "the proving ground that file graduated from" (a lab). Both are true, but a reader of one doc gets the opposite first impression of the file's role from the other — a framing inconsistency the rename in §6 would resolve.

### 4.6 Minor header-vs-code drifts noted by the auditors themselves

`pixel_icon_gallery.md`: header comment says scales "1/2/3/4" but `SCALES = [1,2,3,4,6]`. `geometry_demo.md`: a comment says meshes are "spinning slowly on Y" but rotation is a fixed 35° pose, never animated. `pixel_icon_gallery.md`: a stale header comment about UV inversion superseded by an in-shader comment. These are intra-file, but they're the same drift class the corpus is mapping.

---

## 5. ISOLATED ONE-OFFS THAT COULD CONNECT INTO A FUNDAMENTAL CONCEPT

Capabilities living in exactly one cart that closely follow a recurring shape and would connect with little work.

- **`coverFractionOf(eye, targetBones)`** (`combat_lab.md`) — eye→bone-sample occlusion test, the declared-missing producer that `hmsc/npc/systems/chance.ts` needs. Built in one lab; the doc says "hmsc lifts it." One-off that completes the recurring chance-engine shape (§3.2).
- **The aim rig / ADS camera** (`combat_lab.md`) — the only thing that fixes hmsc's measured "aim ceiling" (the follow cam's screen axis can't rise above the horizon). Built once; should graduate into hmsc and into the camera registry (§3.3) as a Follow-with-aim variant.
- **Host A\* pathing service** (`pathing_lab.md`, `__path_*` via `runtime/pathing.ts`) — "publish the world once, host owns the hot loop." Exactly the same shape as `__hmsc_register_heightfield` (physics) and the instanced-batch ship (rendering): one bulk transfer then queries. Lives in one cart; is the standing answer to N-agent pathfinding and should be the hmsc traffic backend.
- **Deterministic motion plans** (`pathing_lab.md`, `runtime/motion.ts`) — position as a closed-form function of time between interruptions, frame-rate-independent, rewindable. Pairs with pathing as "plan once" for the time domain; currently cars-only, walkers still per-tick (the doc flags unifying them).
- **The two-tolerance flood fill** (`pixel_icon_demo.md`) — seed-tol + stricter step-tol wand that stops bleed across AA edges. `carve_lab` and any future mask tool want it; lives in one cart.
- **`kickSpin` (COG×normal torque heuristic)** (`physics_lab.md`, `ragdoll_lab.md`) — the cheapest believable tumble; already exists identically in TS and Zig. A candidate shared physics utility.
- **The Verlet ragdoll** (`head_lab.md`, `ragdoll_lab.md`) — the standing answer to "no 3D rigid bodies in the host" (vs the dormant Bullet module). One solver, consumed by ragdoll_lab/pathing_lab/combat_lab; the obvious home for "real physics" if `physics3d.zig` is declared dead.
- **`new Function(...bindingNames, body)` user-scripting sandbox** (`composer.md`) — flat API, identifier-validated bindings, instrument-the-wrappers-for-UI. The doc names it "directly reusable for the IF/THEN composer, game scripting." One-off that is the generic "user writes code that drives the engine" primitive.
- **Provider-adapter + normalized-schema + injectable-transport + offline-smoke-harness** (`composer.md`/`sources/`) — "the repo's most complete networking-integration template," mirroring `cutout/backends`. Dark-launched in one cart; the template for any future online-data feature.
- **`Boxxx`/RectBatch instanced-rect** (`boxxx_demo.md`) — the 2D sibling of `Scene3D.Instances` (§1.15); proven for box-only subtrees, the scale answer for big card grids. One demo cart; should pair with StaticSurface as the 2D batching story.
- **Live LLM NPC** (`scape.md` Roach) and **assist3d AI scene authoring** (`hmsc-int.md`) — two instances of the same `useAssistant`/`__worker_*` shape; could be one "agent-driven content" capability.
- **`Render` (`app:` source) external-process capture** (`render_perf_lab.md`) — Xvfb+app capture as a 2D texture quad. A one-cart capability that's a powerful bridge from ReactJIT UI into external processes (terminals, claude); recurs only here but follows the texture-quad shape exactly.

---

## 6. CONCRETE RECOMMENDATIONS

### Renames / honest splits (highest value — they fix the naming lies of §2)

1. **Split `framework/v8_bindings_physics_lab.zig`.** Move the production `__hmsc_*` host fns into `framework/v8_bindings_hmsc_physics.zig` (honest: this is the live game backend) and leave only the `__physics_lab_*` cohabitant in a renamed `v8_bindings_physics_lab.zig` (honestly a lab toy). Cited gold-standard fix; `physics3d.md` + `physics_lab.md` + `hmsc.md` all describe the conflation.
2. **Mark `framework/phys/physics3d.zig` DORMANT loudly, or rename it `bullet3d_dormant.zig`.** Add a loud top-of-file status banner ("WIRED TO NOTHING — see docs/game/physics3d.md") and delete the aspirational `<3D.Physics>`/`Node.physics3d_world_id` header comment that describes nonexistent wiring. `physics3d.md` lays out the full decision (revive vs delete) — that's a user call, but the loud-status comment is unconditional.
3. **Rename or alias `v8_bindings_input_bench.zig`'s movement role.** At minimum a header note that `__input_bench_*` is the reused drive-movement integrator for animation_lab, not just the bench (`animation_lab.md`).
4. **Reconcile `cart/hmsc/labs/ScaleLabScene.tsx`** — delete the orphan or make it the shared source both `hmsc_scale_lab.tsx` and any in-game embed import (`hmsc_scale_lab.md`), eliminating the 2.45m/2.04m disagreement.
5. **Fix `hmsc-int/AGENTS.md`** to name `PaintCanvas.tsx` (not `MapCanvas.tsx`) and **`ragdoll_lab/car.tsx`'s** stale "pathing_lab drives fleets" header (`hmsc-int.md`, `ragdoll_lab.md`).

### Extractions (kill the parallel systems of §3)

6. **One humanoid/figure stack.** Converge hmsc's `render3d/humanoid` and head_lab's `parts.ts`/`figureRender` onto one bone vocabulary and one damage-zone naming (pick `armL/legL` *or* `lArm/lLeg`, not both). combat_lab is the dress rehearsal; lift `coverFractionOf`, the aim rig, the noise-event bus, and the awareness ladder as that doc prescribes. Retire bodylab's third `solveHumanoid` and the camera_lab/input_bench copied parts-arrays. (`combat_lab.md`, `ragdoll_lab.md`, `bodylab.md`, `hmsc.md`.)
7. **One chance engine.** Merge `scape/systems/chance.ts` and `hmsc/npc/systems/chance.ts` — take scape's `ChanceBreakdown` legibility + hmsc's `coverFraction` input; keep the ground-truth-vs-perception module split intact (`scape.md`, `combat_lab.md`).
8. **Export a generic `screenRay(sx, sy, rect, solved)` from `@reactjit/cameras`** and make `unprojectGround` a consumer; delete the three copied view-basis bodies (`voxel_stack_demo.md`, `hmsc-int.md`).
9. **Extract the pixel-icon codec.** Promote `encodeMatrix`/`decodeMatrix` + the `.64.json` convention out of the two carts into `cart/pixel_icons/` beside `matrix.ts` (`pixel_icon_gallery.md`, `pixel_icon_demo.md`).
10. **One color utility** (`mixHex`/`darken`/`hpColor`) and **one V3/clamp/lerp3 math module** — kill the per-file re-rolls (`ragdoll_lab.md`, `combat_lab.md`, `scape.md`).
11. **One `placeLocal(yaw, origin)` yaw-prepend transform**, and seriously consider a `Scene3D` nested-transform feature — the workaround recurs in 5+ files and `Scene3D` "wants nested transforms" per two docs (`ragdoll_lab.md`, `physics_lab.md`).
12. **A `useGameLoop` hook** packaging the rAF-probe scheduler guard + dt-clamp + tick-counter + UI-ref-mirror — the §1.1/§1.2 shape recurs in ~10 carts verbatim (`ragdoll_lab.md` proposes exactly this).
13. **Lift the host A\* pathing + deterministic motion plans into the hmsc traffic backend** rather than copy-pasting the lane-discipline JS per cart — `pathing_lab.md` warns the road-grammar's hardest-won lessons (two probe-verified bug histories) shouldn't be re-derived.

### Loud-status-comment additions (cheap, high-signal)

14. Add "DEAD / never rendered" banners to `ChunkGround`/`ChunkRoads`/`BuildingMesh` (`hmsc_massive_map_lab.md`), the vestigial Canvas editor in `pixel_icon_demo` (`pixel_icon_demo.md`), `composer/sources/` (built-ahead-of-UI, `composer.md`), and `cutout`'s `AdvancedProperties` (`cutout.md`) — so they don't read as wired.
15. **Update the stale caps** printed in `hmsc_massive_map_lab` (8192/4096 → trust host telemetry; real caps 65536/32768) (`hmsc_massive_map_lab.md`).
16. **Export `PLAYER_VISUAL_*` from the humanoid module** so the scale labs can't drift from the body (`hmsc_scale_lab.md`).

### Taxonomy / project-principle fixes

17. **Name the see-it==use-it doctrine** ("the rendered thing IS the tested thing": cover boxes = ray AABBs, painted tiles = collider, camera axis = bullet line, baked texture = spawn mask) as a top-level project principle — combat_lab, scape, planet_run, hmsc terrain all assert it (`combat_lab.md`, `scape.md`, `planet_run.md`).
18. **Reconcile the two authoring lanes in hmsc-int** (the live GameState lane vs the built-but-unwired `worldFile.ts`/`assets.ts`/`assetPrompt.ts` `.tsx`+bake lane) — they coexist; the coherence pass must pick one (`hmsc-int.md`).
19. **A binary `__fs_write_bytes`/`__fs_copy` host fn is overdue** — the UTF-8-only `writeFile` boundary forced the PNM/P5-maxval-1 trick (pixel_icon_demo) and `cp` shell-outs (composer, cutout) three times; the doc says it would delete ~60 lines of encoding gymnastics (`pixel_icon_demo.md`, `composer.md`, `cutout.md`).
20. **Distinguish "implemented" from "declared"** when building any glossary from `scape/design.ts` and similar contract-first files — most of scape's design.ts has zero consumers yet (`scape.md`).

---

## Appendix: the fundamentals to consolidate around (by recurrence)

1. The rAF-probe loop + sim-in-refs + tick-counter render (one `useGameLoop`).
2. The geometry registry + intern cache + unit-params rule.
3. The `<Effect>`/StaticSurface/textureKey GPU surface family (one user-WGSL surface, one render-to-texture bridge).
4. The camera registry (`Solved` + pure solvers + generic picking ray).
5. Registry-driven kinds ("struct stores kind, registry gives meaning").
6. Bones-as-interface + ONE figure stack with ONE damage vocabulary.
7. Ground-truth-vs-display split (chance vs perception) as physically separate modules.
8. Keep-high-frequency-input-out-of-React (refs/latches/paintables, commit-on-release).
9. The workspace-cart pattern (envelope + autosave + snapshot undo).
10. Publish-the-world-once host services (physics heightfield, A* grid, instanced batch) — one bulk transfer, then queries.
