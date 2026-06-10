# Recurrence Report 3 — Cross-Document Synthesis of docs/game/

Synthesized from all 33 per-cart audit documents in `docs/game/` (excluding `_reports/`). Every claim cites the supporting doc filenames. This is a synthesis of what the auditors recorded — taken at face value, not re-verified against source.

The corpus splits into roughly four tiers: **the game** (`hmsc.md`, `scape.md`), **the editors** (`hmsc-int.md`, `head_lab.md`, `cutout.md`, `composer.md`, `pixel_icon_demo.md`, `vehicle_lab.md`), **the labs** (everything `*_lab.md` plus the demos), and **the shared infrastructure docs** (`physics3d.md`, `bake-geometry.md`, `animationDsl.md`). The recurrences below are strongest precisely where they cross those tiers.

---

## 1. Recurring Patterns / Shapes

Ordered by document count. The high-count entries are the load-bearing concepts the project should consolidate around.

### 1.1 The `Scene3D` declarative 3D bridge (≈24/33)
The single most pervasive shape. A `<Scene3D>` tree of prop-mapped `View` nodes (`scene3d*` props) consumed host-side by `framework/gpu/3d.zig`; geometry runs through the JS intern cache and ships vertices once per key.
Docs: `animation_lab.md`, `bodylab.md`, `billboard_demo.md`, `camera_lab.md`, `carve_lab.md`, `combat_lab.md`, `geometry_demo.md`, `game_item_gallery.md`, `head_lab.md`, `hmsc.md`, `hmsc-int.md`, `hmsc_massive_map_lab.md`, `hmsc_scale_lab.md`, `input_bench.md`, `pathing_lab.md`, `physics_lab.md`, `physics3d.md` (would-be), `planet_run.md`, `ragdoll_lab.md`, `scape.md` (fork ref), `skybox_demo.md`, `vehicle_lab.md`, `voxel_stack_demo.md`, `bake-geometry.md`.
Variations: per-mesh nodes (most) vs `Scene3D.Instances` one-batch (`hmsc_massive_map_lab.md`, `voxel_stack_demo.md`) vs the dead per-mesh contender left in-file (`hmsc_massive_map_lab.md`).

### 1.2 The geometry registry + intern cache (≈18/33)
`@reactjit/geometries` generators are TS `generate(params)` functions, framework knows zero shape names; `internKey(id, params)` dedupes; unit-params + scale-transform is the OOM-avoidance rule.
Docs: `animation_lab.md`, `bake-geometry.md`, `billboard_demo.md`, `bodylab.md`, `camera_lab.md`, `carve_lab.md`, `combat_lab.md`, `geometry_demo.md`, `game_item_gallery.md`, `hmsc_massive_map_lab.md`, `hmsc_scale_lab.md`, `physics_lab.md`, `ragdoll_lab.md`, `skybox_demo.md`, `vehicle_lab.md`, `voxel_stack_demo.md`, `head_lab.md`, `scape.md` (SDF analog).
Variations: built-in defs vs **inline cart-local `def()` generators** proving the open authoring path — `geometry_demo.md` (Pyramid/Octahedron/Prism), `physics_lab.md` and `game_item_gallery.md` (Blade/Sail/BoatHull/Surfboard, duplicated between these two carts), `carve_lab.md` (`Geometry.Carve`).

### 1.3 The rAF-probe / setTimeout-16 game loop (≈17/33)
`globalThis.requestAnimationFrame ? rAF : setTimeout(fn,16)` because the V8 cart host has no rAF; dt from `performance.now()` clamped (typically [0.001, 0.05]).
Docs: `animation_lab.md`, `billboard_demo.md`, `bodylab.md`, `camera_lab.md`, `combat_lab.md`, `game_item_gallery.md`, `hmsc.md`, `hmsc_massive_map_lab.md`, `input_bench.md`, `pathing_lab.md`, `physics_lab.md`, `planet_run.md`, `ragdoll_lab.md`, `scape.md`, `skybox_demo.md`, `vehicle_lab.md` (interval), `head_lab.md` (interval).
Variation: the **editor idiom is `setInterval`, not the rAF-probe** — `head_lab.md` and `vehicle_lab.md` explicitly drive animation with `setInterval` at fixed rates; `head_lab.md` names this distinction (game loop vs editor clock).

### 1.4 "Sim-in-refs + render-by-tick-counter + UI-mirrored-into-refs" loop (≈11/33)
Mutable sim object behind a `useRef`, `setTick(t=>t+1)` as the only render trigger, React state mirrored into refs so the closed-over loop reads live values.
Docs: `animation_lab.md`, `combat_lab.md`, `hmsc.md` (live snapshot), `hmsc_massive_map_lab.md`, `input_bench.md` (the "Controller"), `pathing_lab.md`, `physics_lab.md`, `planet_run.md`, `ragdoll_lab.md`, `scape.md`, `head_lab.md` (per-part).
`ragdoll_lab.md` explicitly proposes a `useGameLoop` hook packaging scheduler-guard + dt-clamp + tick-counter — the consolidation target.

### 1.5 StaticSurface → textureKey "2D-on-3D" bridge (≈13/33)
Render a 2D subtree to an offscreen GPU texture by `staticKey`; a `Scene3D.Mesh textureKey` samples it host-side per frame. Sources parked at `left: -99999`.
Docs: `billboard_demo.md` (canonical proof), `carve_lab.md`, `effect_fills.md` (prescribed bake path), `game_item_gallery.md`, `head_lab.md`, `hmsc.md` (floors/roads/facades/faces/landforms/drive-in), `hmsc-int.md`, `hmsc_massive_map_lab.md` (face captures), `hmsc_scale_lab.md` (face pool), `planet_run.md` (planet surface), `ragdoll_lab.md` (character captures), `scape.md` (item icon), `cutout.md` (uses Paintable+Effect instead, noted as the non-StaticSurface variant).
Sub-pattern: **the HumanoidFaceCaptures contract** — any cart drawing a figure must mount the offscreen face-bake sibling next to its Scene3D (`hmsc.md`, `hmsc_scale_lab.md`, `hmsc_massive_map_lab.md`, `planet_run.md`, `ragdoll_lab.md`).

### 1.6 The `<Effect>` WGSL quad + flat-f32-storage-buffer (≈12/33)
The one user-WGSL surface; `data` → `effectData` → storage buffer at `@group(0) @binding(1)`; animate by re-uploading data, not recompiling.
Docs: `billboard_demo.md`, `cutout.md` (MaskQuad), `effect_fills.md` (170-swatch mega-shader), `game_item_gallery.md`, `hmsc.md` (minimap, all tile/road/landform fills), `hmsc-int.md` (chunk surfaces), `pixel_icon_gallery.md` (icon shader), `planet_run.md` (planet), `scape.md` (the whole world quad), `skybox_demo.md` (analytic sky), `voxel_stack_demo.md` (no — uses instances), `effect_fills.md`.
Apex variation: **world-as-one-shader-quad** — entire tile world (+heightfield march for extruded buildings) painted by one Effect with per-fragment inverse projection (`scape.md` canonical; `hmsc.md` minimap; the memory `world_as_shader_quad`).
Sibling: **"pack a struct into a flat f32 array → Effect data → storage buffer"** as the standard dynamic-data path (`pixel_icon_gallery.md`, `effect_fills.md`, `scape.md`).

### 1.7 Registry-driven "kind" data architecture (≈11/33)
A struct stores a `kind` string; a registry gives it meaning (stats, color, behavior). "Struct stores kind, registry gives it meaning" is named the project's load-bearing data architecture.
Docs: `combat_lab.md` (kinds.ts/tileKinds.ts), `hmsc.md` (tiles/buildings/props/NPCs/roles/landforms), `hmsc-int.md` (thin references into shared registries), `vehicle_lab.md` (VEHICLE_STYLES/ROLES, semantic part ids), `game_item_gallery.md` (ITEMS), `scape.md` (packed-bits tile encoding + item modules), `voxel_stack_demo.md` (BLOCKS registry), `pathing_lab.md` (tileKinds), `effect_fills.md` (board/material tables), `shitcoin.md` (app registry), `pixel_icon_gallery.md` (PixelMatrix as the lingua franca).

### 1.8 "Keep high-frequency input out of React" family (≈10/33)
Pointer/key/stroke streams mutate refs or host-side state; React state only at commit/heartbeat.
Docs: `head_lab.md` (GPU-paint/readback-on-release + host latches), `cutout.md` (Paintable direct GPU writes), `pixel_icon_demo.md` (hi-res mask in a ref, version-bump on commit), `hmsc-int.md` (usePaintedField coalesced upload), `combat_lab.md` (cameraAimRef), `hmsc_massive_map_lab.md` (ref-buffer + coalesced flush), `physics_lab.md`, `ragdoll_lab.md`, `planet_run.md` (keysRef), `scape.md`.
Named sub-shapes: **host latches** (`'latch:key'` + `__latchSet`, `head_lab.md`), **GPU-paint/readback-on-release** (`head_lab.md`, `cutout.md`, `pixel_icon_demo.md`), **ref-buffer + coalesced-flush** (`hmsc_massive_map_lab.md`, `hmsc-int.md`).

### 1.9 Hand-rolled camera math vs the `@reactjit/cameras` registry (≈14/33)
A pure `solve(params) → {pos, target, fov}` rig + generic `unprojectGround` picking from `Solved`.
Docs using the registry: `camera_lab.md` (canonical, all 7 rigs), `bodylab.md`, `carve_lab.md`, `game_item_gallery.md`, `pathing_lab.md`, `planet_run.md` (FollowCamera), `ragdoll_lab.md`, `vehicle_lab.md`, `voxel_stack_demo.md`, `head_lab.md`, `input_bench.md` (Orbit+FirstPerson).
Docs hand-rolling the same trig (pre-registry / convergence candidates): `hmsc_scale_lab.md`, `hmsc_massive_map_lab.md` (dual-rig = Follow+Orbit by hand), `physics_lab.md`, `scape.md` (its own projection), `hmsc.md` (gameplay camera constants in camera.ts).

### 1.10 The bones-record figure interface (≈6/33)
`Record<BoneId, SkeletonBone>` produced by three sources (animation `buildSkeleton`, physics `bonesFromRagdoll`, blend `blendBones`) and consumed by one sink (`buildRigFrameFromBones` → meshes+clothing+hitboxes+anchors).
Docs: `head_lab.md` (the source), `ragdoll_lab.md`, `combat_lab.md`, `pathing_lab.md`, `planet_run.md`, `hmsc_scale_lab.md` (the parallel hmsc `rig` solve — same instinct, different stack; see §3.1).

### 1.11 Verlet-in-cart physics (≈4/33)
A position-based Verlet solver in cart TS as the standing answer to "no 3D physics in the host."
Docs: `head_lab.md` (the solver lives in `ragdoll.ts`), `ragdoll_lab.md`, `combat_lab.md`, `pathing_lab.md`. Contrasted against the dormant Bullet module in `physics3d.md`.

### 1.12 Seeded PRNG + procedural generation (≈8/33)
`Math.imul` xorshift/mulberry32 mixers seeded for reproducible worlds/characters; rejection-sampling scatter.
Docs: `planet_run.md` (planet+person from one seed), `hmsc_massive_map_lab.md` (hash-deterministic city, no storage), `geometry_demo.md` (LCG blob), `vehicle_lab.md` (seeded vehicle doc), `physics_lab.md`, `pathing_lab.md`, `shitcoin.md` (deterministic cold engine), `pixel_icon_gallery.md` (pixelMatrixFromSeed).

### 1.13 The workspace-cart persistence pattern (3 named consumers)
Envelope + 600ms-debounced autosave + snapshot undo/redo + `commit`/`commitCoalesced` over `runtime/workspace`; disk = truth.
Docs: `cutout.md` (the origin), `composer.md` ("proven 2-consumer abstraction"), `hmsc-int.md` ("third consumer"). Related disk-as-channel producer/consumer pairs: `pixel_icon_demo.md`↔`pixel_icon_gallery.md`.

### 1.14 Lab = make-a-contract-visible (≈7/33)
A standalone cart whose job is to render/tune a constants module so a human can eyeball agreement; it must derive everything from the contract or it rots.
Docs: `hmsc_scale_lab.md` (names the pattern; verifies HMSC_SCALE), `camera_lab.md`, `combat_lab.md`, `physics_lab.md`, `animation_lab.md`, `effect_fills.md` (eval gallery + CATALOG.md), `render_perf_lab.md`.

### 1.15 The host-twin / dual-backend benchmark (≈3/33)
The same world implemented twice (JS + Zig), runtime-switchable, with self-reported µs timings; packed-f32 ArrayBuffer (hot) + CSV-scanner (debug) snapshot channels.
Docs: `physics_lab.md` (the worked example), `input_bench.md` (four backends incl. LuaJIT+Zig), `hmsc.md` (host physics step is the graduated product).

### 1.16 Other repeated micro-shapes
- **Offscreen parking (`left:-99999`)**: `billboard_demo.md`, `carve_lab.md`, `game_item_gallery.md`, `head_lab.md`, `ragdoll_lab.md`, `hmsc_scale_lab.md`, and every face-capture cart.
- **Overlays = root's last child (hit-test by paint order)**: `planet_run.md`, `scape.md`, `voxel_stack_demo.md`, `hmsc-int.md`, `hmsc_scale_lab.md`.
- **Pointer-capture: down+move+up on the SAME node**: `physics_lab.md`, `hmsc_massive_map_lab.md`, `ragdoll_lab.md`, `hmsc_scale_lab.md`, `carve_lab.md`, `voxel_stack_demo.md`.
- **Drag-vs-click travel threshold (≈6px)**: `pathing_lab.md`, `voxel_stack_demo.md`, `bodylab.md`.
- **Telemetry panel idiom (`useTelemetry` scalars@250ms + JSON@500ms + thresholds)**: `hmsc_massive_map_lab.md`, `render_perf_lab.md`, `hmsc.md` (DebugHud), `cutout.md`.
- **Packed-int keyboard via `busOn('__keydown'/'__keyup')`**: `camera_lab.md`, `combat_lab.md`, `hmsc.md`, `hmsc-int.md`, `hmsc_scale_lab.md`, `physics_lab.md`, `planet_run.md`, `ragdoll_lab.md`, `scape.md`, `input_bench.md`, `hmsc_massive_map_lab.md`.
- **Animation DSL** (`[dur,target,action;...]` → sampled actions w/ sin-envelope weight): `animationDsl.md`, `head_lab.md`, `vehicle_lab.md`, `pathing_lab.md`, `planet_run.md`.

---

## 2. Naming / Placement Lies

Places where a filename or directory misleads about live-vs-dead, lab-vs-production, or ownership. AI agents and humans anchor on names.

### 2.1 `framework/v8_bindings_physics_lab.zig` IS the live HMSC physics backend (the gold standard, multiply confirmed)
A file named "physics **lab**" sounds like temporary lab glue; it actually contains the LIVE production HMSC physics (`__hmsc_physics_step`, `__hmsc_register_heightfield`, `__hmsc_clear_heightfields`).
Confirmed by: `physics_lab.md` ("has since grown into the **real hmsc physics backend**" / "this lab is the proving ground that file graduated from"), `physics3d.md` ("The live path is the custom host sim in `framework/v8_bindings_physics_lab.zig`"), `hmsc.md` (consumes `__hmsc_physics_step`/`__hmsc_register_heightfield` via `state/hostPhysics.ts` + `terrainColliders.ts`).
The lie compounds: the file's name says "lab," its *stateful* `__physics_lab_*` fns are the actual toy, and the *stateless* `__hmsc_*` fns sharing the file are production.

### 2.2 `framework/phys/physics3d.zig` looks like serious framework physics but is fully DORMANT
Sits in a serious `framework/phys/` path, ~320 lines + a C++ Bullet shim, fully implemented — and wired to nothing. Its own header comment describes `<3D.Physics>` and `Node.physics3d_world_id` that **do not exist**.
Confirmed by: `physics3d.md` ("fully implemented and completely disconnected … Nothing imports `phys/physics3d.zig`"; "doc-comment drift as a trap"). The one collider it never implemented (heightfield) is exactly the one hmsc needed — which is why the game grew its own sim instead.

### 2.3 `cart/hmsc-int/labs/ScaleLabScene.tsx` — name implies the live scale lab; it's an orphan copy that has already drifted
A near-verbatim duplicate of `cart/hmsc_scale_lab.tsx`'s scene, **imported by nothing**, and already divergent (purple height line at `PLAYER_VISUAL_TOTAL_HEIGHT` 2.45m vs the cart's `PLAYER_VISUAL_HEAD_TOP` 2.04m).
Confirmed by: `hmsc_scale_lab.md`. Note `hmsc.md` lists `labs/ScaleLabScene.tsx` as a real in-cart lab scene — so the two docs disagree on whether it's live (see §4.1).

### 2.4 `cart/input_bench` (the input benchmark) is the de-facto **drive-mode movement backend** for animation_lab
`animation_lab.md` imports `framework/v8_bindings_input_bench.zig`'s `__input_bench_*` for its real drive-mode WASD movement; the doc calls it "Input bench: Zig-side WASD movement backend originally from input benchmarking, **reused here for drive mode**." A "bench" file is load-bearing gameplay input.
Confirmed by: `animation_lab.md`, `input_bench.md`, `physics_lab.md` (also pulls `__bench_now_us` from the same file as its preferred clock).

### 2.5 `cart/head_lab` — the name says "head," but it's the whole-body character subsystem
"This is not a lab anymore — it's the **character subsystem** for the whole game effort." Downstream consumers (`planet_run`, `ragdoll_lab`, `combat_lab`, `pathing_lab`) import body parts/skeleton/ragdoll/figures, not just heads.
Confirmed by: `head_lab.md`, and the import lists in `combat_lab.md`, `pathing_lab.md`, `planet_run.md`, `ragdoll_lab.md`.

### 2.6 `cart/physics_lab.tsx` is also a ≈19-model **item gallery**, and the "lab" carts are routinely production-feature proving grounds
`physics_lab.md` notes its `ITEM_CATALOG` mirrors `game_item_gallery`'s models; `combat_lab.md` is explicitly "the integration prototype for HMSC combat" (production assembly), not an isolated lab; `pathing_lab.md` is "the integration cart … the integration proof preceding hmsc adoption." The `_lab` suffix systematically undersells production-critical work.

### 2.7 `cart/hmsc-int/AGENTS.md` references `MapCanvas.tsx` which is now `PaintCanvas.tsx`
The cart's own agent contract names a renamed file.
Confirmed by: `hmsc-int.md` ("doc drift inside the cart's own contract").

### 2.8 `cart/ragdoll_lab/car.tsx` header claims pathing_lab drives fleets of it — but pathing_lab uses vehicle_lab now
The comment says the sedan is "shared … pathing_lab drives fleets of them"; in fact `CarMeshes` has exactly one consumer (ragdoll_lab itself), while pathing_lab imports `buildVehicle` from `vehicle_lab`.
Confirmed by: `ragdoll_lab.md`, `pathing_lab.md`.

### 2.9 `runtime/hooks/useLuaWorker.ts` is "not a React hook despite its name"
Exports an imperative `luaWorker` object; the `use*` prefix implies a hook.
Confirmed by: `input_bench.md`.

### 2.10 `cart/hmsc-int/assist3d/scene.json` "MeshSpec" is deliberately NOT a game kind
Looks like world data but is raw geometry primitives that don't bridge into placements — a parallel model.
Confirmed by: `hmsc-int.md`.

### 2.11 `cart/cutout/*_old.*` and `cart/input_bench/*_old.*` — `_old` names correctly signal dead, but they sit in the live directory
`cutout.md`, `input_bench.md` both note `_old` files remain in-folder, not imported. The naming is honest (per the `_old` convention) but the placement still risks confusion; both docs flag "do not treat as current."

---

## 3. Duplicated / Parallel Systems

Two or more implementations of one concept with no canonical winner.

### 3.1 TWO humanoid/figure systems (the single biggest convergence candidate)
- **head_lab `figureRender`** (sculptable Globe parts, `.hed` faces, 25 named bones, box hitboxes, Verlet ragdoll, clothing) — used by `planet_run`, `ragdoll_lab`, `combat_lab`, `pathing_lab`, `head_lab`.
- **hmsc `render3d/humanoid`** (fixed primitive parts, baked face decals, 6 **capsule** hit zones, palette recolors, no physics) — used by `hmsc`, `hmsc_scale_lab`, `hmsc_massive_map_lab`.
Docs: `ragdoll_lab.md` ("Two parallel humanoid stacks now exist" — calls it the biggest convergence candidate), `planet_run.md`, `combat_lab.md` (where the two finally meet via `boneZone()`), `hmsc_scale_lab.md`, `head_lab.md`, `hmsc.md`.
Most damning detail: the **same six-region locational-damage model with reversed naming** — ragdoll_lab `lArm/rArm/lLeg/rLeg` vs hmsc `armL/armR/legL/legR` (`ragdoll_lab.md`, `combat_lab.md`). `combat_lab.md`'s `boneZone()` is the half-done bridge. Consolidation winner: unclear — combat_lab leans on hmsc's `ZONE_DAMAGE` table while keeping head_lab's hitboxes, suggesting the merge target is "head_lab geometry + hmsc damage vocabulary."

### 3.2 TWO percent-to-hit / chance engines (both in shipped *games*)
- **`scape/systems/chance.ts`** — multiplier `ChanceBreakdown`, weapon `RangeProfile`, tile-grid LoS with glass windows.
- **`hmsc/npc/systems/chance.ts`** — `hitChance` with `coverFraction`.
Docs: `scape.md` ("Two chance engines now exist in the repo"), `combat_lab.md` (builds the missing `coverFractionOf` producer for the hmsc one). Both honor the same ground-truth-vs-display law. Winner: `scape.md` argues scape's breakdown legibility is the richer *surface*, hmsc's cover-fraction is the richer *input* — merge needed, no clear single owner.

### 3.3 TWO car/vehicle geometry sources (fragmenting across ≥4 places)
`ragdoll_lab/car.tsx` `CarMeshes`, `vehicle_lab`'s `buildVehicle`, the collision constants in `ragdoll_lab/index.tsx` (`CAR_HALF`), and `HMSC_SCALE.car` (4×2×1.5m).
Docs: `ragdoll_lab.md` ("car geometry/metrics are fragmenting across three places" + HMSC_SCALE as a fourth), `vehicle_lab.md` (the canonical `VehicleDoc`+`buildVehicle`+`VehiclePartId` trio — the likely winner), `pathing_lab.md` (consumes vehicle_lab). Winner: `vehicle_lab`'s semantic rig.

### 3.4 The pixel-icon `decodeMatrix`/`encodeMatrix` + `PixelMatrix` format module (un-extracted)
`decodeMatrix` is "a near-verbatim copy" in `pixel_icon_gallery.tsx` and `pixel_icon_demo.tsx`; `encodeMatrix` lives only in the demo; the `.64.json`/`.64.anim.json` filename convention is an undocumented file-format module.
Docs: `pixel_icon_gallery.md`, `pixel_icon_demo.md` (both explicitly call for extraction next to `matrix.ts`). `PixelMatrix` is the lingua franca with 4 producers + 2 renderers.

### 3.5 Two renderers for `PixelMatrix` (intentional, not a lie)
Box-per-cell `PixelIcon` (editor, needs hit targets) vs shader-quad `ShaderPixelIcon` (display, cheap). `pixel_icon_gallery.md`, `pixel_icon_demo.md` — flagged as the *correct* precedent (choose per use-site, don't fork the data).

### 3.6 The `FILL_SHADER` two-copy seed-coefficient invariant
`fillData`'s per-board seed-spread formulas are duplicated as `seedCoef` in `textureShaders.ts`; drift silently invalidates the eval. Plus eight near-identical `*Column` components and three copies of the material/variant naming tables.
Docs: `effect_fills.md`. Also the WGSL itself is "authored in effect_fills, canonical copy lives game-side" (`cart/hmsc-int/render3d/fillShader.ts`) — a deliberate one-copy rule that the seed tables violate.

### 3.7 The hand-rolled `screenRay` / view-basis duplication (3 bodies)
`voxel_stack_demo`'s `screenRay`, `runtime/cameras/unproject.ts`'s `unprojectGround` internal basis, and scape3d's original `projection.ts` all build the same camera inverse. The registry only exports ground-plane picking.
Docs: `voxel_stack_demo.md` (extraction candidate: export `screenRay(sx,sy,rect,solved)`), `hmsc-int.md` (assist3d `picking.ts` is "the same unexported-camera-math duplicate family"), `camera_lab.md` (`unprojectGround`).

### 3.8 Color-utility sprawl ("darken a hex" ≥4×, `clamp`/`lerp3`/V3 helpers re-rolled per file)
`darkHex`, `darkShoe`, `darken`, `mixHex` all parse `#rrggbb` and re-emit; `lerp3` defined twice in one dependency chain; `clamp` re-rolled in 4+ files within scape alone; `mixHex`/`hpColor`/`BONE_JOINTS`/`SETTLE_*` copied combat_lab↔ragdoll_lab.
Docs: `ragdoll_lab.md`, `combat_lab.md`, `scape.md`, `skybox_demo.md` (its own `mixHex`), `head_lab.md` (`PartRender`/`clothingGeometry`/`PART_LOD` duplicated index.tsx↔figureRender.tsx).

### 3.9 The lab-chrome kit (`Chip`/`Knob`/`MeterRow`) re-rolled per lab
`combat_lab.md` notes `Chip` exists in multiple labs with slightly different styling; `Knob` appears independently in `carve_lab.md`, `vehicle_lab.md`, `pixel_icon_demo.md`, `combat_lab.md`. The "lab environment" Skybox/lights fragment is copy-identical combat_lab↔ragdoll_lab.

### 3.10 Two authoring lanes inside hmsc-int (GameState vs world-as-.tsx)
`worldFile.ts`/`assets.ts`/`assetPrompt.ts` (world-as-`.tsx` + AI asset gen + bake) coexists with the live GameState lane, "built but not wired into the main flow."
Docs: `hmsc-int.md` ("the coherence pass must reconcile the two authoring models").

### 3.11 `world/tiles.ts` `Kind` enum duplicates `citymap.ts` `T` enum verbatim (scape)
Acknowledged compat façade. Docs: `scape.md`.

---

## 4. Cross-Doc Contradictions

### 4.1 Is `cart/hmsc-int/labs/ScaleLabScene.tsx` live or orphaned?
- `hmsc.md` lists it as a real in-cart lab scene ("Scene3D lab for physical scale … Uses `HMSC_SCALE`").
- `hmsc_scale_lab.md` says it is "a near-verbatim **orphaned** copy … **nothing imports it**" and already drifted.
The hmsc.md inventory documents it as part of the cart structure; the scale-lab audit (which specifically grepped consumers) says it's dead. The lab scene may be *registered* in `labDefinitions.ts` but its *Scene* component unreferenced, or hmsc.md over-trusted the directory listing. Either way the two docs give opposite live/dead verdicts.

### 4.2 Does rAF exist on the host? (consistent NO, but one stale-comment trap)
Every loop cart agrees rAF does not exist (`billboard_demo.md`, `ragdoll_lab.md`, `planet_run.md`, etc., all "always the setTimeout branch"). But `skybox_demo.md` describes the rAF branch as "the V8 path" as if it runs, and `bodylab.md` shows the probe without flagging that rAF is always absent. No factual disagreement, but the framing drifts: most docs say "the probe always falls through," a few imply rAF is a live path.

### 4.3 Stale mesh-cap constants
`hmsc_massive_map_lab.md` flags its panel hardcodes `meshCap: 8192`/`nodeIndexCap: 4096` while `framework/gpu/3d.zig` now says `MAX_INSTANCES = 65536`, `MAX_SCENE_MESHES = 32768`. The cart's printed ceilings contradict the live host constants the same doc cites.

### 4.4 The locational-damage naming contradiction (already in §3.1)
`ragdoll_lab.md` documents the lesson "reconcile the region map before a third variant appears"; `combat_lab.md` shows a third surface already leaning on hmsc's vocabulary while keeping head_lab's geometry — i.e. the convergence the ragdoll_lab doc warned about is mid-violation. Two docs, same model, opposite naming (`lArm` vs `armL`).

### 4.5 `setEffect`/effects-API present vs absent in the EarSketch idiom
`composer.md` notes `setEffect` (the EarSketch idiom) is **absent** from the composer's surfaced API, while the brother-EarSketch memory and the cart's own one-liner philosophy imply it should be central. An internal gap the doc flags as "built-ahead-of-UI / declared-not-implemented."

### 4.6 `car.tsx` consumer claim (already in §2.8)
`ragdoll_lab.md` (car has one consumer) directly contradicts `ragdoll_lab/car.tsx`'s own header (pathing_lab drives fleets) — and `pathing_lab.md` confirms ragdoll_lab is right.

### 4.7 Lesson documented in one cart, violated in another
- **StaticSurface inline-prop rebake**: `billboard_demo.md` documents the every-frame rebake hazard; `planet_run.md` explicitly obeys it (memo'd capture); `head_lab.md`/`hmsc-int.md` cite the fix. No cart is shown actively violating it, but `billboard_demo.md` does it *intentionally* — a footgun that reads as correct if copied.
- **Geometry intern OOM (unit-params rule)**: documented everywhere; `billboard_demo.md` uses literal dimensions (2.2×1.1×0.006) and flags that copying the pattern for *varying* sizes would OOM — a documented-correct-here-but-dangerous-if-generalized case.

---

## 5. Isolated One-Offs That Could Connect

Capabilities in exactly one cart that closely follow a recurring shape.

### 5.1 `coverFractionOf` (combat_lab) — the declared-missing producer for hmsc's chance engine
Built in `combat_lab.md` specifically because `hmsc/npc/systems/chance.ts` declares it needs `coverFraction` but ships no producer. 9-sample eye→bone occlusion test. The doc says hmsc should lift it directly. One-off today, the connective tissue for §3.2.

### 5.2 The Hitman-style perception ladder + noise-event bus (combat_lab)
FoV cones, tile-noise hearing, `stimulus`/`lastKnown` separation, upward escalation. `combat_lab.md` says hmsc should lift the noise-event bus and awareness ladder. scape has the *consequence* vocabulary (`WitnessMemory`, the Case) but no perception (`scape.md`); the two halves "haven't met." Connecting combat_lab's perception to scape's consequences is a near-complete vertical slice.

### 5.3 The `provider-adapter + normalized-schema + injectable-transport + offline-smoke-harness` (composer)
`composer.md` calls `sources/` "the repo's most complete networking-integration template," including tri-state-null metadata honesty and provenance-at-import. Mirrors `cutout`'s `backends/` interface shape. One reusable networking template, currently dark-launched (no UI).

### 5.4 `new Function(...bindingNames, body)` user-scripting sandbox (composer)
The EarSketch flat-binding mechanism. `composer.md` says it's "directly reusable for any 'user writes code that drives the engine' surface (the IF/THEN composer, game scripting)." shitcoin's IFTTT rules (`shitcoin.md`) and scape's design hint at the same need.

### 5.5 The two-tolerance flood fill (pixel_icon_demo)
Seed-tolerance + stricter step-tolerance wand. `pixel_icon_demo.md` says carve_lab and any future mask tool will want it; cutout's flood backend (`cutout.md`) is the obvious second consumer.

### 5.6 `Geometry.Carve` Teddy-inflate (carve_lab) + `Geometry.Globe` profile-sculpt (head_lab)
Two image/silhouette→3D generators that both belong in the geometry registry and both already produce textured meshes. `carve_lab.md` and `head_lab.md` — sibling "mask/profile → inflated mesh" shapes that no shared abstraction unifies yet.

### 5.7 The deterministic-motion-plan + pre-calculated-until-disrupted pair (pathing_lab)
`runtime/motion.ts` closed-form position-as-function-of-time + the generation-counter disruption test. `pathing_lab.md` notes walkers still use per-tick integration (cars-only so far) — unifying walkers onto plans is the stated open consolidation, and the shape generalizes to any agent (vehicles, NPCs).

### 5.8 `Scene3D.Instances` one-batch field (voxel_stack_demo, hmsc_massive_map_lab)
Stride-9 `[pos, scale, rgb]` instanced draw per kind. `voxel_stack_demo.md` flags the per-instance-opacity gap (translucent kinds render opaque). Connecting this to hmsc's prop rendering (`hmsc.md` renders props as individual meshes) is the obvious scale win; `hmsc-int/VoxelHybridRoute.tsx` is the sibling exploration.

### 5.9 The live-LLM NPC (scape) and AI scene authoring (hmsc-int)
`scape.md`'s Roach (claude_code subprocess, roleplay prime, streamed bubbles, input gating) and `hmsc-int.md`'s assist3d backends (claude_code/openai_compat/local_ai) are the same `useAssistant`/`__worker_*` infrastructure applied to NPC dialog vs scene generation. One bridge, two consumers — connectable into a general "agent-driven game content" capability.

### 5.10 The `Render` app-capture surface (render_perf_lab)
`app:kitty` virtual-display capture into a GPU quad. `render_perf_lab.md` proves the capability at stress scale; no game cart uses it yet, but it's a drop-in for in-world screens / the drive-in (`hmsc.md`'s `driveInScreen.tsx` uses `Video`+StaticSurface — `Render` is the live-app upgrade).

---

## 6. Concrete Recommendations

### Renames / honest-status splits (highest value — these mislead agents)
1. **Split `framework/v8_bindings_physics_lab.zig`** into honest `framework/v8_bindings_hmsc_physics.zig` (the live `__hmsc_*` step + heightfields) and `framework/v8_bindings_physics_lab.zig` (the stateful `__physics_lab_*` toy). The name currently hides the game's entire physics backend. (`physics_lab.md`, `physics3d.md`, `hmsc.md`)
2. **Mark `framework/phys/physics3d.zig` DORMANT loudly** at the top of all three files (`.zig`/`.h`/`.cpp`), and **fix or delete its lying header comment** about `<3D.Physics>`/`Node.physics3d_world_id`. Rename to `bullet3d_dormant.zig` or commit to deleting the trio — a user decision, but the status must be loud either way. (`physics3d.md`)
3. **Delete or canonicalize `cart/hmsc-int/labs/ScaleLabScene.tsx`** — it's an already-drifted orphan and two docs disagree on whether it's live. Make it import the standalone cart's scene, or remove it. (`hmsc_scale_lab.md`, `hmsc.md`)
4. **Rename `framework/v8_bindings_input_bench.zig`'s `__input_bench_*`** or at least add a comment that animation_lab's *drive mode* depends on it — it's not just a benchmark. (`animation_lab.md`, `input_bench.md`)
5. **Update `cart/hmsc-int/AGENTS.md`** `MapCanvas.tsx` → `PaintCanvas.tsx`. (`hmsc-int.md`)
6. **Fix `cart/ragdoll_lab/car.tsx`'s header** (it falsely claims pathing_lab fleets it). (`ragdoll_lab.md`, `pathing_lab.md`)

### Extractions (kill the parallel re-implementations)
7. **Unify the two humanoid stacks** (head_lab `figureRender` ↔ hmsc `render3d/humanoid`), starting with the **six-region damage vocabulary** (`lArm/rArm/lLeg/rLeg` vs `armL/armR/legL/legR`) — combat_lab's `boneZone()` is the half-built bridge to finish. This is the corpus's #1 convergence. (`ragdoll_lab.md`, `combat_lab.md`, `head_lab.md`, `hmsc_scale_lab.md`)
8. **Reconcile the two chance engines** (`scape/systems/chance.ts` ↔ `hmsc/npc/systems/chance.ts`): keep scape's `ChanceBreakdown` legibility as the surface, hmsc's `coverFraction` (+ combat_lab's `coverFractionOf` producer) as the input. (`scape.md`, `combat_lab.md`)
9. **Extract the pixel-icon format module** (`encodeMatrix`/`decodeMatrix`/`PixelMatrix` + the `.64.json` convention) into `cart/pixel_icons/` next to `matrix.ts`; both carts import it. (`pixel_icon_gallery.md`, `pixel_icon_demo.md`)
10. **Export `screenRay(sx, sy, rect, solved)` from `@reactjit/cameras`** and make `unprojectGround` + voxel_stack + hmsc-int/assist3d picking consume it. Three bodies build the same basis. (`voxel_stack_demo.md`, `hmsc-int.md`, `camera_lab.md`)
11. **One color utility** (`mixHex`/`darken`/`hpColor`) and **one V3/clamp/lerp3 math module** — the sprawl is the top frustration signal across `ragdoll_lab.md`, `combat_lab.md`, `scape.md`, `skybox_demo.md`, `head_lab.md`.
12. **One vehicle module** = `VehicleDoc` + `buildVehicle` + `VehiclePartId`, with the lab as one viewer; retire `CarMeshes`/`CAR_HALF`/`HMSC_SCALE.car` fragmentation. (`vehicle_lab.md`, `ragdoll_lab.md`)
13. **Export the seed/board/material tables from `fillShader.ts`** so `effect_fills` and `textureShaders.ts` import one source instead of duplicating `seedCoef`; collapse the eight `*Column` components into one parameterized component. (`effect_fills.md`)
14. **Promote a `useGameLoop` hook** packaging rAF-guard + dt-clamp + tick-counter + ref-mirror — every real-time cart re-rolls it. (`ragdoll_lab.md`, plus §1.3/§1.4 cohort)
15. **Promote a shared "lab environment" fragment** (Skybox + lights) and a **lab-chrome kit** (`Chip`/`Knob`/`MeterRow`) — re-rolled per lab. (`combat_lab.md`, `ragdoll_lab.md`, `carve_lab.md`, `vehicle_lab.md`)

### Taxonomy / coherence fixes
16. **Name the see-it==hit-it doctrine as a project principle**: "the rendered thing IS the tested thing" (cover boxes = ray AABBs, floor patches = noise defs, hitboxes = damage surface, camera axis = bullet line) matches the terrain see-it==walk-it rule. (`combat_lab.md`, `hmsc_scale_lab.md`, `hmsc.md`)
17. **Name the "solve the shape once, derive every consumer" principle** (one skeleton → mesh + hitbox + eye; one item module → world look + UI + type; one VehicleDoc → meshes + hitboxes + anchors). (`hmsc_scale_lab.md`, `combat_lab.md`, `vehicle_lab.md`, `scape.md`)
18. **Reconcile hmsc-int's two authoring lanes** (GameState vs world-as-`.tsx`) before the bake pipeline lands — pick one or define the boundary. (`hmsc-int.md`)
19. **Distinguish "implemented" from "declared"** in scape (player/high/items/interactions/chance/doors/clock are live; zones/assets/Case/quests/agents are types-only) and composer (online sources, `durationMs`, credentials are built-ahead-of-UI). A coherence pass should label these so they don't read as wired. (`scape.md`, `composer.md`)

### Loud-status-comment additions
20. **Add `__fs_write_bytes`/`__fs_copy` host fns** — the UTF-8-only `writeFile` boundary forces the P5-maxval-1 PNM trick, the `cp` shell-out, and ImageMagick text gymnastics in three carts (binary-file boundary "third sighting"). (`pixel_icon_demo.md`, `composer.md`, `cutout.md`)
21. **Mark stale caps loudly**: `hmsc_massive_map_lab`'s panel labels (`meshCap 8192`/`nodeIndexCap 4096`) are wrong vs the live 65536/32768; either derive from telemetry or comment the staleness. (`hmsc_massive_map_lab.md`)
22. **Loud comment on the YXZ euler-order knowledge** (`3d.zig` `T·Ry·Rx·Rz·S`) that currently lives only in scattered cart-side comments and is load-bearing for every cart doing free 3D rotation. (`planet_run.md`, `combat_lab.md`, `head_lab.md`, `ragdoll_lab.md`)
23. **Flag the shader/JS-twin-must-stay-in-lockstep hazard** wherever it occurs (planet_run terrain, scape projection, effect_fills seed tables) — "edit one side and the other silently lies." (`planet_run.md`, `scape.md`, `effect_fills.md`)
24. **Clean up the documented dead code**: `hmsc_massive_map_lab`'s `ChunkGround/ChunkRoads/BuildingMesh` trio, `pixel_icon_demo`'s vestigial Canvas editor, `scape/ui/Wheel.tsx`, voxel_stack's `solid`/water-slot scaffolding — each flagged by its own doc as delete-or-rewire. (`hmsc_massive_map_lab.md`, `pixel_icon_demo.md`, `scape.md`, `voxel_stack_demo.md`)
