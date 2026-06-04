# Recurrence Report 5 — Cross-Document Synthesis of `docs/game/`

Synthesized from all 33 per-cart docs in `docs/game/` (the `_reports/` subdirectory excluded). Each claim cites the supporting doc filename(s). Counts are out of 33 docs. This report takes the docs at face value as the source of truth; it is a cross-document synthesis, not a code re-audit.

The corpus splits into roughly three families that the patterns cut across:
- **Game/world carts**: `hmsc`, `hmsc-int`, `scape`, `planet_run`, `shitcoin`, `voxel_stack_demo`, `vehicle_lab`.
- **Lab/probe carts**: `animation_lab`, `bodylab`, `camera_lab`, `carve_lab`, `combat_lab`, `geometry_demo`, `head_lab`, `hmsc_massive_map_lab`, `hmsc_scale_lab`, `input_bench`, `pathing_lab`, `physics_lab`, `ragdoll_lab`, `render_perf_lab`, `skybox_demo`.
- **Tooling/asset/format carts & modules**: `animationDsl`, `bake-geometry`, `billboard_demo`, `boxxx_demo`, `composer`, `cutout`, `effect_fills`, `game_item_gallery`, `pixel_icon_demo`, `pixel_icon_gallery`, `physics3d`.

---

## 1. Recurring Patterns / Shapes

Ordered by recurrence count (most-recurring first). The high-count entries are the project's fundamental concepts; it should consolidate around them.

### 1.1 rAF-probe → setTimeout(16) game loop — **~18/33**
The single most universal idiom. The V8 cart host has **no `requestAnimationFrame`**, so every animated cart probes `globalThis.requestAnimationFrame` and falls back to `setTimeout(fn, 16)`; time via `performance.now()` ?? `Date.now()`; `dt` clamped (commonly `[0.001, 0.05]` or `min(0.05, …)`).
Docs: `billboard_demo.md`, `bodylab.md`, `camera_lab.md`, `combat_lab.md`, `animation_lab.md`, `hmsc.md`, `hmsc_massive_map_lab.md`, `planet_run.md`, `ragdoll_lab.md`, `physics_lab.md`, `pathing_lab.md`, `scape.md`, `skybox_demo.md`, `input_bench.md`, `game_item_gallery.md` (setTimeout-only), `voxel_stack_demo.md` (none — state-driven), and named as a recurring shape in `head_lab.md` (which contrasts it with the *interval* idiom).
**Variation — interval clocks, not rAF-probe**: editor-style carts drive animation with `setInterval` (`head_lab.md` 150/90/50 ms, `game_item_gallery.md` 40 ms, `pixel_icon_gallery.md`/`pixel_icon_demo.md` `max(33, 1000/fps)`, `vehicle_lab.md` 33 ms, `shitcoin.md` ~1 Hz cold tick). `head_lab.md` explicitly frames "rAF-probe = game idiom, intervals = editor idiom."

### 1.2 Sim-in-refs + render-by-tick-counter + UI-mirrored-into-refs — **~12/33**
The standing real-time loop architecture: all mutable simulation lives in a `useRef` object; React state holds only UI knobs + a frame counter bumped (`setTick(t=>t+1 & 0xffff)`) once per tick to force a render; UI values the loop needs are copied into refs each render so the closed-over tick reads live values (stale-closure dodge).
Docs: `ragdoll_lab.md` (most explicit — proposes a `useGameLoop` hook), `combat_lab.md`, `planet_run.md`, `physics_lab.md`, `pathing_lab.md`, `scape.md`, `hmsc_massive_map_lab.md` (ref-buffer + coalesced flush variant), `input_bench.md` (the "mutable Controller + heartbeat" form), `head_lab.md` (ref-buffer/commit-on-release sibling), `animation_lab.md`, `hmsc.md`. `ragdoll_lab.md` and `combat_lab.md` both nominate it as a glossary-level concept.

### 1.3 Geometry registry + intern cache (unit-params + scale-transform) — **~16/33**
`@reactjit/geometries` shapes are TS `generate(params)` functions, not a Zig enum; `internGeometry` keys on `(id, stableParams)`, generates once, ships vertices across the bridge once per key. The load-bearing rule: per-frame-varying sizes use **module-constant unit params + a `scale` transform**, never a continuous float in `params` (which would mint unbounded intern entries and OOM V8).
Docs: `bake-geometry.md` (the build-time seed of this), `geometry_demo.md` (the test-bed), `billboard_demo.md`, `bodylab.md`, `camera_lab.md`, `combat_lab.md` (`UNIT_CYL/BOX/SPHERE/TORUS` constants), `hmsc_massive_map_lab.md`, `hmsc_scale_lab.md`, `skybox_demo.md`, `voxel_stack_demo.md`, `physics_lab.md`, `vehicle_lab.md`, `head_lab.md`, `animation_lab.md`, `game_item_gallery.md`, `carve_lab.md`. Carts can author registry-shaped geometry inline (`def(id, defaults, generate)`): `physics_lab.md`, `game_item_gallery.md`, `geometry_demo.md`.

### 1.4 StaticSurface → textureKey "2D-on-3D" bridge — **~12/33**
A 2D subtree (Box/Text/Effect/Filter) is captured to an offscreen GPU texture keyed by a string; a `Scene3D.Mesh textureKey` samples it host-side per frame. The two trees never reference each other in JS — only the key string. Capture sources are parked offscreen at `left: -99999`.
Docs: `billboard_demo.md` (the canonical proof), `carve_lab.md`, `game_item_gallery.md`, `hmsc.md` (floors/roads/junctions/facades/parts/faces/landforms/water/drive-in screens), `hmsc-int.md`, `hmsc_scale_lab.md`/`hmsc_massive_map_lab.md` (`HumanoidFaceCaptures` contract), `planet_run.md`, `ragdoll_lab.md`, `combat_lab.md`, `effect_fills.md` (prescribed bake/live paths), `head_lab.md` (`CharacterCaptures`). **Variation**: bake-once (memoized capture + `useMemo`'d data/style — `planet_run.md`, `hmsc_scale_lab.md`) vs deliberate per-frame rebake (`billboard_demo.md`'s live `frame {tick}`). The rebake hazard (`static_surface_inline_props_rebake`) is flagged in `billboard_demo.md`, `hmsc.md` (`tileSurface.tsx` stabilizes identities), and is the subject of `hmsc-int.md`'s preview-rebake-choke fix.

### 1.5 Effect quad fed by one flat `f32` data array → WGSL storage buffer — **~11/33**
`<Effect data={number[]}>` → `effectData` host prop → `@group(0) @binding(1) var<storage, read> D: array<f32>`. The standard way carts feed dynamic data to WGSL. Two sub-shapes: **header-once/payload-per-frame** packing (`pixel_icon_gallery.md`'s `ShaderAnimIcon`), and the **mega-shader-with-selector** (one WGSL, `D[]` indices pick the look — `effect_fills.md`'s 58-material FILL_SHADER, `pixel_icon_gallery.md`'s palette-lookup quad).
Docs: `effect_fills.md`, `pixel_icon_gallery.md`, `pixel_icon_demo.md`, `billboard_demo.md`, `scape.md` (the whole world is one such quad + buffer), `cutout.md` (`MaskQuad`), `game_item_gallery.md`, `hmsc.md` (minimap, tile/road/junction/landform/water fills), `boxxx_demo.md` (`effectData` as the rect-batch buffer), `carve_lab.md`, `voxel_stack_demo.md` (instance data, sibling shape). WGSL gotchas (`no unary +`, no backticks in comments, namespace-prefix helpers because the shared math lib is prepended) recur in `billboard_demo.md`, `effect_fills.md`, `planet_run.md` (`pr_` prefix), `scape.md`.

### 1.6 Registry-driven kinds: "struct stores `kind`, registry gives it meaning" — **~12/33**
A live instance stores a `kind` string; a registry table supplies behavior/appearance/stats. Named by `combat_lab.md` as "the project's load-bearing data architecture."
Docs: `hmsc.md` (tile kinds, building kinds, prop kinds, NPC kinds/factions/roles, landform kinds — the densest example), `combat_lab.md` (`kinds.ts`/`tileKinds.ts` consumed unmodified; lab-local tables carry explicit "graduate me to the registry" notes), `vehicle_lab.md` (`VEHICLE_STYLES`/`VEHICLE_ROLES`/`VehiclePartId`), `voxel_stack_demo.md` (`BLOCKS` registry — a miniature), `scape.md` (item modules + packed-bits tile kinds), `game_item_gallery.md` (`ITEMS` registry), `bodylab.md` (`FigureDef`/`MaterialSlot`/`ModelStyle`), `hmsc-int.md` (thin-reference maps over shared global registries), `pathing_lab.md` (legality-from-tile-kinds), `head_lab.md` (`PART_PRESETS`/`BODY_SHAPES`), `pixel_icon_gallery.md` (`PixelMatrix` as lingua franca), `shitcoin.md` (NPC archetypes, hardware tiers).

### 1.7 Camera as pure `solve(params) → {pos, target, fov}` + generic ground-pick inverse — **~10/33**
`@reactjit/cameras`: each rig is a pure solver producing the common `Solved` shape; rendering AND picking both consume `Solved`; `unprojectGround` inverts any solved camera for click-to-ground.
Docs: `camera_lab.md` (the reference — Orbit/Follow/TopDown/Iso/FirstPerson/FreeFly/Cinematic), `bodylab.md`, `carve_lab.md`, `game_item_gallery.md`, `ragdoll_lab.md`, `planet_run.md` (FollowCamera), `pathing_lab.md` (`solveCamera`+`unprojectGround` picking), `voxel_stack_demo.md` (`solveCamera`+`CAMERAS.Orbit`), `vehicle_lab.md`, `input_bench.md` (Orbit+FirstPerson). **Variation — hand-rolled orbit trig** (pre-registry): `hmsc_scale_lab.md`, `hmsc_massive_map_lab.md` (dual-rig in one state object), `combat_lab.md` (bespoke aim rig), `animation_lab.md`, `skybox_demo.md` (static). These are the named consolidation targets toward the registry.

### 1.8 Bus-mediated input (`__keydown`/`__keyup` packed-int → JS bus) + pull-based pointer + held-key refs — **~14/33**
SDL keydown → host calls `__ifttt_onKeyDown(packed)` → `useIFTTT.decodeKey` unpacks → `busOn('__keydown')` fans out. Held keys go into a `keysRef` polled by the tick; discrete actions fire on the event through a latest-closure ref. Pointer events carry no coordinates — JS pulls `getMouseX/Y` at dispatch; drag handlers must all sit on the **same node** (pointer-capture rule).
Docs: `hmsc_scale_lab.md` (most detailed trace), `combat_lab.md` (first to consume `__keyup`; also `__mouse_capture`/`__mouse_delta`/`getMouseRightDown`), `hmsc.md`, `planet_run.md`, `ragdoll_lab.md`, `physics_lab.md`, `pathing_lab.md`, `scape.md` (adds `onRightClick`), `camera_lab.md`, `hmsc_massive_map_lab.md`, `input_bench.md` (benchmarks JS-bus vs IFTTT vs Lua vs Zig paths), `animation_lab.md` (`isKeyDown` polling), `voxel_stack_demo.md` (no keyboard — props only), `hmsc-int.md` (`system:cursor:move` global cursor channel + `__tel_input` focus gate). The packed-int decode and pointer-capture rules are named glossary candidates in `hmsc_scale_lab.md`.

### 1.9 Publish-the-world-once host service (one bulk transfer, then queries) — **~5/33, but architecturally central**
The cart authors data in JS, ships it once via a host call, the host owns the hot loop. Same shape across three subsystems.
Docs: `pathing_lab.md` (`__path_set_grid` → host A*), `hmsc.md`/`physics_lab.md`/`physics3d.md` (`__hmsc_register_heightfield` → host physics; `__hmsc_physics_step` packed-f32 ArrayBuffer per frame), `hmsc_massive_map_lab.md` (the instanced-batch ship), `shitcoin.md` (`__zig_call('sim', …)` hot/cold split). Named in `pathing_lab.md` as a recurring shape alongside physics and rendering.

### 1.10 Hash/seed-deterministic procedural world (no storage) — **~5/33**
World = pure function of (coords, seed-salts) via `Math.imul` mixing; regenerate on demand, identical every time.
Docs: `hmsc_massive_map_lab.md` (4,000-chunk city from `hash2`), `planet_run.md` (mulberry32 → planet + person), `voxel_stack_demo.md` (sine/cosine terrain), `geometry_demo.md` (LCG blob), `vehicle_lab.md` (`seededRandom` vehicle gen). Rejection-sampling scatter with guard counters appears in `planet_run.md` and `hmsc_massive_map_lab.md`.

### 1.11 Workspace-cart pattern (envelope + debounced autosave + snapshot undo) — **3/33, an explicit proven abstraction**
Stateless view over an on-disk `SessionEnvelope`; 600 ms debounced autosave; full-snapshot undo via `commit`/`commitCoalesced`; `sessions/<stem>.session.json` + `_last.txt` pointer; disk = truth.
Docs: `cutout.md` (the originator/7-file shape), `composer.md` (second consumer; mirrors cutout's shape explicitly), `hmsc-int.md` (third consumer; v2 payload carrying a whole world). `composer.md` calls it "a proven 2-consumer abstraction"; `hmsc-int.md` confirms the third.

### 1.12 Ground-truth-vs-display-warp separation (physically separate modules) — **3/33, a stated project law**
Real odds computed in one module; the UI's lying/warped display computed in a *different* module that can't see the truth; the dice always roll the truth.
Docs: `scape.md` (`systems/chance.ts` vs `systems/perception.ts` — the strongest version), `combat_lab.md` (chance.ts header restates the law; HUD shows ground truth), and named via the `project_scape_perception_split` memory. The "see-it == hit-it / what-you-see-is-what-they-hear" doctrine in `combat_lab.md` is the rendering sibling of this.

### 1.13 Other repeated minor shapes
- **Memoized static scene / hard-memoized mesh bundle isolated from camera state**: `bodylab.md`, `camera_lab.md`, `input_bench.md`, `skybox_demo.md`, `head_lab.md`, `pathing_lab.md`, `ragdoll_lab.md` (~7).
- **Thin-box ground instead of `geometry="plane"`** (planes back-face-cull from above): `camera_lab.md`, `carve_lab.md`, `skybox_demo.md`, `input_bench.md`, `hmsc_scale_lab.md` (~5).
- **Overlays as root's last children** (hit-test is paint-order, not zIndex): `scape.md`, `planet_run.md`, `hmsc_scale_lab.md`, `hmsc-int.md`, `voxel_stack_demo.md` (~5).
- **Drag-vs-click travel threshold (<6 px) on one Pressable**: `pathing_lab.md`, `voxel_stack_demo.md`, plus the same-node capture rule everywhere (~6).
- **Packed-f32 snapshot over zero-copy ArrayBuffer (hot) + CSV charCode-scanner (debug fallback)**: `physics_lab.md` (canonical), `input_bench.md` (Zig CSV), `hmsc.md`.
- **External-tool orchestration via `run()`/`execAsync` subprocess**: `pixel_icon_demo.md`, `carve_lab.md`, `cutout.md`, `composer.md` (ffmpeg/magick/zenity/cp) — and the shell-out-for-bytes workaround (next section).

---

## 2. Naming / Placement Lies

Cases where a file's name or location misleads a future reader about live-vs-dead, lab-vs-production, or ownership. The gold standard the task names is fully corroborated by the corpus.

### 2.1 GOLD STANDARD (corroborated): `physics_lab.zig` is the live production physics backend; `physics3d.zig` is dead
- `framework/v8_bindings_physics_lab.zig` — named like throwaway lab glue — **contains the LIVE HMSC physics backend**: `__hmsc_physics_step`, `__hmsc_register_heightfield`, `__hmsc_clear_heightfields`. The lab cart never even calls these; they serve `cart/hmsc`. Source: `physics_lab.md` ("the host side… has since grown into the **real hmsc physics backend** — this lab is the proving ground that file graduated from"), `physics3d.md` ("The live path is the custom host sim in `framework/v8_bindings_physics_lab.zig`"), `hmsc.md` (consumes `__hmsc_physics_step` via `state/hostPhysics.ts`).
- `framework/phys/physics3d.zig` — named like serious framework physics — is **fully implemented and wired to NOTHING**: nothing imports it, `build.zig` never compiles its shim or links Bullet, `layout.zig` has no `physics3d_*` fields, no JS primitive maps to it. Its own header comment describes `<3D.Physics>` and `Node.physics3d_world_id` that **do not exist** (Smith-era aspirational drift). Source: `physics3d.md` ("DORMANT — wired to nothing"; verified by repo-wide grep). The one collider hmsc needed — heightfield — is the exact enum case `physics3d` left stubbed `null`.

### 2.2 `input_bench` is named a benchmark but is a production movement backend reused under another cart
`framework/v8_bindings_input_bench.zig`'s `__input_bench_*` host fns ("Input bench: Zig-side WASD movement backend originally from input benchmarking") are **reused as `animation_lab`'s live drive-mode movement integrator**. A reader seeing "input_bench" in `animation_lab` would assume test scaffolding. Source: `animation_lab.md` (drive mode calls `__input_bench_set_yaw/speed/pos`), `input_bench.md` (the file's origin), `physics_lab.md` (`__bench_now_us` lives here too — the monotonic clock several carts prefer).

### 2.3 `cart/hmsc/render3d/fillShader.ts` — "canonical copy lives game-side" but is authored in `effect_fills`
The WGSL mega-shader's true authoring home is the eval cart `effect_fills`, but the canonical copy lives under `cart/hmsc/render3d/` "because the game's texture catalog registers these looks." A reader in `hmsc` sees a 1653-line shader file and would not guess its authoring/eval loop lives in a sibling gallery cart. Source: `effect_fills.md` (explicit: "authored in effect_fills, canonical copy lives game-side… exactly one copy of the WGSL").

### 2.4 `cart/hmsc/labs/ScaleLabScene.tsx` — looks like the live scale lab; it is an orphaned, drifted copy
`hmsc_scale_lab.tsx` (the standalone cart) is the real one. `cart/hmsc/labs/ScaleLabScene.tsx` is a **near-verbatim orphan that nothing imports** and has already drifted (purple height line at `PLAYER_VISUAL_TOTAL_HEIGHT` 2.45 m vs the cart's `PLAYER_VISUAL_HEAD_TOP` 2.04 m). Same names, divergent values, no canonical owner. Source: `hmsc_scale_lab.md` ("textbook case").

### 2.5 `cart/hmsc_massive_map_lab.tsx` — `ChunkGround`/`ChunkRoads`/`BuildingMesh` look like the renderer; they are dead
Three fully-written per-chunk `<Scene3D.Mesh>` components are **never rendered** (grep-confirmed zero JSX usage) — the abandoned per-mesh draft, superseded by the instanced batch which duplicates their exact geometry recipe. They read as live render code. Source: `hmsc_massive_map_lab.md`.

### 2.6 `cart/ragdoll_lab/car.tsx` — stale header claims "pathing_lab drives fleets of them"; it has one consumer
`CarMeshes`' header says the sedan is shared and pathing_lab drives fleets, but `pathing_lab` now imports `buildVehicle` from `cart/vehicle_lab/` — `CarMeshes` has exactly one consumer (ragdoll_lab itself). Source: `ragdoll_lab.md`, corroborated by `pathing_lab.md` (imports vehicle_lab) and `vehicle_lab.md`.

### 2.7 `cart/hmsc-int/AGENTS.md` documents `MapCanvas.tsx`, which is now `PaintCanvas.tsx`
Doc drift inside the cart's own contract file — a reader following AGENTS.md looks for a file that was renamed. Source: `hmsc-int.md` (twice: file map note and open-seams).

### 2.8 `cart/head_lab/animDsl.ts` is a one-line re-export, not the real module
The real animation DSL is `cart/animationDsl.ts`; `head_lab/animDsl.ts` is `export * from '../animationDsl'`. A reader importing from head_lab would think head_lab owns the DSL. Source: `animationDsl.md`, `head_lab.md`, `planet_run.md`.

### 2.9 `useLuaWorker.ts` is named a hook but is an imperative object
"`runtime/hooks/useLuaWorker.ts` is not a React hook despite its name. It exports an imperative `luaWorker` object." Source: `input_bench.md`.

### 2.10 The `_old` / vestigial-file family (correctly-named history, but a live-vs-dead trap if imports flip)
`_old`-suffixed snapshots and abandoned-in-place editors that the active path does not import: `cart/cutout/{state,session,Editor,Inspector}_old.*` (`cutout.md`), `cart/input_bench/{index_old,backend_lua_old}.tsx` (`input_bench.md`), `pixel_icon_demo.md`'s "Vestigial Canvas editor" (dead `canvasRect`/`screenToWorld`/`paintAtWorld`/`hiResOverlayCells`), `scape.md`'s `ui/Wheel.tsx` (intentional, documented orphan), `cutout.md`'s `AdvancedProperties` (exists, not rendered by the tab switch). These are honestly named but require an import check, not a name read, to know what's live.

---

## 3. Duplicated / Parallel Systems

Two-or-more implementations of one concept with no canonical winner.

### 3.1 TWO humanoid/figure systems (the biggest convergence candidate) — flagged in 5+ docs
- **head_lab stack** (`cart/head_lab/`): sculptable `Geometry.Globe` parts + silhouette profiles, `.hed`/`.body` documents, 25 named bones (`BoneId`), oriented-box hitboxes, clothing/accessory system, Verlet ragdoll. **Consumers**: `planet_run`, `ragdoll_lab`, `combat_lab`, `pathing_lab`, head_lab itself.
- **hmsc humanoid** (`cart/hmsc/render3d/humanoid/`): fixed primitive parts, baked face decals, **6 capsule** damage zones, palette recolors, no physics. **Consumers**: `hmsc` + its labs (`hmsc_scale_lab`, `hmsc_massive_map_lab`), `camera_lab`/`input_bench` (parts-array copies).
- The same six-region locational-damage model exists in both with **reversed naming**: ragdoll_lab `lArm/rArm/lLeg/rLeg` vs hmsc `armL/armR/legL/legR`. `combat_lab` already bridges them via `boneZone()` (head_lab boxes + hmsc `ZONE_DAMAGE` table) — "the convergence is half-done, by design."
Docs: `ragdoll_lab.md` ("single biggest convergence candidate"), `planet_run.md`, `combat_lab.md`, `hmsc_scale_lab.md`, `head_lab.md`. **Winner signal**: `head_lab.md`'s "bones-as-interface" + figureRender kit is the richer authoring model; hmsc's "solve once → mesh + hitbox from same joints" is the cleaner runtime contract. They want one vocabulary.

### 3.2 TWO chance/percent-to-hit engines — 2 docs
- `scape/systems/chance.ts`: multiplier `ChanceBreakdown` (legible WHY-is-it-33%), weapon `RangeProfile`, tile-grid line-of-sight with glass-window shots.
- `hmsc/npc/systems/chance.ts`: `hitChance({rangeMeters, coverFraction, …})` with a `coverFractionOf` producer (built in combat_lab).
Both are *games* (2D vs 3D), both honor the ground-truth/display-warp law. `scape.md` names the reconciliation: "scape's breakdown legibility… hmsc's cover-fraction producer is the richer input." Docs: `scape.md`, `combat_lab.md`.

### 3.3 FOUR+ car/vehicle geometries & metric sources — 3 docs
`CarMeshes` visual (`ragdoll_lab/car.tsx`), its separate collision constants `CAR_HALF`/`CAR_CENTER_Y` (`ragdoll_lab/index.tsx`), `vehicle_lab`'s `buildVehicle` semantic rig (the rich one — styles/roles/hitboxes/anchors/damage), `hmsc`'s structure cars (`render3d/structures/Car.tsx`), and `HMSC_SCALE.car` (4×2×1.5 m) — all describe "a car" with no shared source. `vehicle_lab.md` names the consolidation: a shared vehicle module owning types + registries + `buildVehicle`, with the lab as one viewer. Docs: `ragdoll_lab.md`, `vehicle_lab.md`, `hmsc.md`, `hmsc_scale_lab.md`.

### 3.4 `decodeMatrix` duplicated verbatim; `PixelMatrix` format module unextracted — 2 docs
`decodeMatrix` is a near-verbatim copy in `pixel_icon_gallery.tsx` and `pixel_icon_demo.tsx`; `encodeMatrix` lives only in the demo. The encode/decode pair + filename convention (`.64.json`/`.64.anim.json`) is an undocumented file-format module that should be extracted (alongside `matrix.ts`, which already plays the shared-parser role). Docs: `pixel_icon_gallery.md`, `pixel_icon_demo.md`. `PixelMatrix` itself is a four-producer/two-renderer lingua franca (`pixel_icon_gallery.md`).

### 3.5 Hex-color helpers re-rolled 4+ times — 2 docs
"Darken a hex" exists as `darkHex` (`car.tsx`), `darkShoe` (`head_lab/parts.ts`), `darken` (`hmsc/.../face.tsx`), plus `mixHex`/`hpColor` general lerps. `combat_lab` copies `mixHex`/`hpColor` from ragdoll_lab verbatim ("hex-helper sprawl grows by two"). Docs: `ragdoll_lab.md`, `combat_lab.md`, `skybox_demo.md` (`mixHex` again).

### 3.6 `clamp` / V3 math (`sub/len3/mid3/lerp3`) re-implemented per file — 4+ docs
`clamp` re-rolled in 4+ files within scape alone; `lerp3` defined twice in the ragdoll chain; `clamp` re-rolled across `player.ts/chance.ts/perception.ts/world.ts`. Docs: `scape.md`, `ragdoll_lab.md`, plus the implicit per-cart math helpers in `animation_lab.md`/`physics_lab.md`/`camera_lab.md`.

### 3.7 The `screenRay` / camera-inverse view-basis duplicated 3× — 2 docs
The cameras registry exports `unprojectGround` (ground-plane only) but **not** the underlying `screenRay`. So any cart needing non-ground picking re-rolls the view-basis: `voxel_stack_demo` (block-face picks), the math inside `runtime/cameras/unproject.ts`, and scape3d's original `projection.ts` it was lifted from; `hmsc-int.md` adds the assist3d/`picking.ts` "same unexported-camera-math duplicate family." Docs: `voxel_stack_demo.md` (names the extraction: export `screenRay`, make `unprojectGround` a consumer), `hmsc-int.md`.

### 3.8 Bone-helper / placement duplication inside the figure stack — 2 docs
`combat_lab`'s `boneZone` near-copies `ragdoll_lab`'s `boneRegion`; `BONE_JOINTS` (25-entry kick map) duplicated verbatim from ragdoll_lab; `SETTLE_MOTION/SETTLE_TICKS` settle block repeated; `eyeOf` vs hmsc `rig.eye` ("two definitions of where a humanoid sees from"). The prepend-a-yaw transform (`place()`/`turn()`/`placeBones`) is three implementations of one helper. Docs: `combat_lab.md`, `ragdoll_lab.md`. `head_lab.md` adds internal drift: `index.tsx` vs `figureRender.tsx` each define their own `PartRender`, `clothingGeometry`, layer-paint component, and `PART_LOD`.

### 3.9 The hand-rolled "transform hierarchy" (`ModelCtx` + `Part`) re-invented per cart — 3 docs
Because `Scene3D` has no parent/child transform nesting, carts re-roll a `{origin, rotation, scale}` context threaded through a `Part` wrapper that bakes parent transform into each mesh. Independent copies in `game_item_gallery` (`local/scl/rot/Part`), `physics_lab` (`ModelCtx`/`Part`), and the `segmentPose` style in `animation_lab`/`head_lab`. `physics_lab.md` reads it as "recurring evidence that Scene3D wants nested transforms or a shared part-composition helper." Docs: `game_item_gallery.md`, `physics_lab.md`, `animation_lab.md`.

### 3.10 Duplicated physics constant/step tables (the host-twin cost) — 2 docs
`physics_lab`'s 19-entry `ITEM_CATALOG` (radius/mass/cog) is hand-synced with Zig's `items`; the whole `stepPhysics` is a line-for-line TS↔Zig port; `input_bench`'s movement formula is mirrored across `keys.ts`, `backend_lua.tsx`, and Zig. The cost of the twin pattern. Docs: `physics_lab.md`, `input_bench.md`.

### 3.11 `world/tiles.ts` `Kind` enum duplicates `citymap.ts` `T` enum verbatim — 1 doc (`scape.md`).

---

## 4. Cross-Document Contradictions

Places where docs disagree on facts, carry stale constants, or where one doc's documented lesson another cart violates.

### 4.1 Stale instance/mesh caps printed vs current host values
`hmsc_massive_map_lab.md`: the diagnostics panel hardcodes `meshCap: 8192` / `nodeIndexCap: 4096`, but `framework/gpu/3d.zig` now says `MAX_INSTANCES = 65536`, `MAX_SCENE_MESHES = 32768`. The lab's printed ceilings are wrong (conservative). A reader comparing the lab's HUD to reality would mis-budget.

### 4.2 The "derive-everything-from-the-contract" lesson is documented AND violated in the same family
`hmsc_scale_lab.md` states the rule ("a lab must derive everything it draws from the contract module or it rots") and then catalogs its own violation: `PLAYER_VISUAL_*` constants (shoe −0.16, head 2.04, hat 2.29) are **hand-transcribed** from `skeleton.ts` geometry — and `ScaleLabScene.tsx` transcribes them a third time, already drifted (2.45 vs 2.04). The lesson and the violation co-exist.

### 4.3 `StaticSurface` rebake: documented hazard vs deliberate use
`billboard_demo.md` documents the `static_surface_inline_props_rebake` hazard (inline `data={[tick*0.05]}` causes per-frame rebake) and *intentionally* triggers it to animate, while `hmsc.md` (`tileSurface.tsx` "stabilizes data/style identities to avoid rebakes") and `planet_run.md`/`hmsc_scale_lab.md` (bake-once memoization) treat the same mechanism as a bug to avoid. Not a factual contradiction but a doctrine the docs apply in opposite directions; `hmsc-int.md`'s preview-rebake-choke is the cost when the discipline lapses.

### 4.4 Header comments contradicting code (intra-doc, but cross-checkable)
- `physics3d.md`: the module header describes `<3D.Physics>` and `Node.physics3d_world_id` that don't exist — "trust grep over header comments."
- `pixel_icon_gallery.md`: the file header comment claims y-inversion ("per `v8_app.zig:2251`") but the in-shader comment supersedes it (uv arrives top-down, no inversion). Also `SCALES = [1,2,3,4,6]` in code vs header saying "1/2/3/4."
- `pixel_icon_gallery.md`: `ShaderAnimIcon`'s "no React reconciliation" comment is accurate only at the per-cell level (it does `setIdx` per tick); the `idxRef`/"pause when document not visible" comment is aspirational (no `document` exists).
These are doc-noted comment/code contradictions a future reader anchoring on the comment would get wrong.

### 4.5 `car.tsx` ownership claim contradicted by sibling docs
`ragdoll_lab.md` notes `car.tsx`'s header ("pathing_lab drives fleets of them") is contradicted by `pathing_lab.md` (pathing_lab imports `buildVehicle` from vehicle_lab). The two docs disagree on who consumes `CarMeshes`; ragdoll_lab.md is correct, the header is stale.

### 4.6 Import-path convention split (not a contradiction, but an inconsistency the docs flag)
`planet_run.md` notes it imports `@reactjit/runtime/primitives` (full path) where other carts write `@reactjit/primitives`; `carve_lab.md` uses `@reactjit/runtime/primitives` too. Both resolve through the `--alias:@reactjit=runtime` catch-all, but the corpus is split on the convention.

---

## 5. Isolated One-Offs That Could Connect

Capabilities present in exactly one cart that closely follow a recurring shape and could become a fundamental concept with little work.

### 5.1 `coverFractionOf` (combat_lab) — the declared-missing producer for hmsc's chance engine
Eye→bone-sample occlusion test (9 samples riding the target's skeleton). Built in combat_lab; `hmsc/npc/systems/chance.ts` already *expects* this input. Lifting it completes the hmsc combat loop. Source: `combat_lab.md` (explicitly "the missing producer, built here").

### 5.2 The true ADS aim rig (combat_lab) — the only camera that can actually aim
combat_lab measured and documented that hmsc's shipped follow cam **cannot raise its screen axis above the horizon** ("the aim ceiling") and built a true aim rig. This is a one-off that the cameras registry (§1.7) should absorb as a rig, and that hmsc must lift to ship combat. Source: `combat_lab.md`.

### 5.3 Verlet-in-cart physics (head_lab/ragdoll.ts) — the standing answer to "no 3D physics in the host"
A 15-particle/24-constraint position-based solver, the cart-side answer to the dormant Bullet module (§2.1). Used by ragdoll_lab/combat_lab/pathing_lab/planet_run via the bones-as-interface seam. This *is* the de-facto 3D physics; it should be named as such rather than living as a head_lab helper. Source: `head_lab.md`, `ragdoll_lab.md`, `physics3d.md` (which contrasts it with the dead module).

### 5.4 Two-tolerance flood fill (pixel_icon_demo) — the wand algorithm worth canonizing
Seed-tolerance + stricter step-tolerance BFS that stops bleed across anti-aliased edges. carve_lab and cutout's mask tools want exactly this; only pixel_icon_demo has it. Source: `pixel_icon_demo.md` (names it a canonization candidate).

### 5.5 `kickSpin` COG-cross-normal torque heuristic (physics_lab) — cheapest believable tumble
Already exists identically in TS and Zig; a candidate shared utility for any tumbling object. Source: `physics_lab.md`.

### 5.6 Variable-jump-height (edge-detected impulse + hold-boost) (physics_lab) — the platformer-feel jump
The recipe the actual game's jump should canonize. Source: `physics_lab.md`.

### 5.7 Quaternion-accumulate → euler-extract matched to host `Ry·Rx·Rz` order (planet_run)
planet_run carries a ~100-line quat/matrix lib because the host's only rotation interface is the `rotation` euler prop. Any cart doing free 3D rotation repeats this; the YXZ-order knowledge is load-bearing and currently only in cart comments. A shared `eulerFromQuat` (host-order-aware) would serve all of them. Source: `planet_run.md`.

### 5.8 Live LLM NPC via claude subprocess (scape) — a working prototype of the agent-NPC plan
Roach the fixer: `__worker_*` claude_code subprocess, roleplay prime, streamed bubbles, input gating. The bridge-thread-sessions / agent-NPC ambition has a shipped prototype here, isolated in one cart. Source: `scape.md`.

### 5.9 Semantic vehicle rig: meshes/hitboxes/anchors share `VehiclePartId` (vehicle_lab)
The "visual + collision + interaction points share one name vocabulary" model — the vehicle twin of the humanoid bones-as-interface and the scape item-module doctrine. Only vehicle_lab has it; it should become *the* vehicle module hmsc connects to. Source: `vehicle_lab.md`.

### 5.10 Semantic interaction anchors (head_lab `anchorsFromSkeleton`) — the Hitman targeting layer
10 role-tagged, verb-accepting anchors (`face_grab` accepts `grab_face`/`cover_mouth`/`shove`). The interaction-targeting layer combat/scape's action menus want; only head_lab produces it. Source: `head_lab.md`, with scape's action-menu (`scape.md`) as the natural consumer.

### 5.11 Off-thread LuaJIT worker with bounded queues (input_bench) — the scripting-runtime pattern
A concrete off-thread script runtime with explicit lifecycle and message queues — the candidate pattern for game scripting experiments, currently only exercised as a benchmark backend. Source: `input_bench.md`. Pairs with composer's `new Function(...bindings, body)` sandbox (`composer.md`) as the two "user code drives the engine" recipes.

---

## 6. Concrete Recommendations

In the spirit of "split the misnamed file; mark the dormant one loudly."

### Renames / file splits (the naming lies)
1. **Split `framework/v8_bindings_physics_lab.zig`** into honest `v8_bindings_hmsc_physics.zig` (the live `__hmsc_*` backend + `__physics_lab_*` lab fns can stay, but the LIVE production surface must not hide behind "lab"). At minimum add a loud header: `// LIVE PRODUCTION: __hmsc_physics_step / __hmsc_register_heightfield serve cart/hmsc. NOT lab-only.` Source: `physics_lab.md`, `physics3d.md`, `hmsc.md`.
2. **Mark `framework/phys/physics3d.zig` DORMANT loudly** (e.g. rename `bullet3d_dormant.zig`) or delete all three files (`physics3d.zig`, `physics3d_shim.h/.cpp`) — a user decision. Fix the lying header that describes `<3D.Physics>`/`Node.physics3d_world_id` (neither exists). Source: `physics3d.md`.
3. **Rename `framework/v8_bindings_input_bench.zig`'s reused movement surface** or add a header noting `__input_bench_*` is `animation_lab`'s LIVE drive backend, not just a benchmark. Source: `animation_lab.md`, `input_bench.md`.
4. **Delete or reconcile `cart/hmsc/labs/ScaleLabScene.tsx`** (orphan, drifted) — make it the shared source the standalone `hmsc_scale_lab` imports, or remove it. Source: `hmsc_scale_lab.md`.
5. **Delete the dead trio in `hmsc_massive_map_lab.tsx`** (`ChunkGround`/`ChunkRoads`/`BuildingMesh`) or gate them behind a toggle so the two geometry recipes can't drift. Source: `hmsc_massive_map_lab.md`.
6. **Fix `cart/hmsc-int/AGENTS.md`** `MapCanvas.tsx` → `PaintCanvas.tsx`. Source: `hmsc-int.md`.
7. **Correct `cart/ragdoll_lab/car.tsx`'s stale header** (it does NOT feed pathing_lab fleets). Source: `ragdoll_lab.md`.
8. **Rename `runtime/hooks/useLuaWorker.ts`** (it's an imperative object, not a hook) or document the not-a-hook fact at the top. Source: `input_bench.md`.

### Extractions (the duplications)
9. **Unify the two humanoid stacks** under one bones-as-interface vocabulary; the urgent first step is reconciling the six-region damage model's reversed naming (`lArm`/`rArm` vs `armL`/`armR`) — combat_lab already half-bridges it. Source: `ragdoll_lab.md`, `combat_lab.md`, `planet_run.md`, `hmsc_scale_lab.md`.
10. **Extract one `PixelMatrix` format module** (`encode`/`decode` + filename convention) imported by both pixel-icon carts, beside `matrix.ts`. Source: `pixel_icon_gallery.md`, `pixel_icon_demo.md`.
11. **One color utility** (`darken`/`mixHex`/`hpColor`) and **one V3/clamp math module** to end the 4+ re-rolls. Source: `ragdoll_lab.md`, `combat_lab.md`, `scape.md`, `skybox_demo.md`.
12. **Export `screenRay(sx, sy, rect, solved)` from `@reactjit/cameras`** and make `unprojectGround` + the voxel/assist3d pickers consume it (3 copies of the view-basis today). Source: `voxel_stack_demo.md`, `hmsc-int.md`.
13. **Move bone helpers** (`boneZone`/`boneRegion`, `BONE_JOINTS`, settle detection, `eyeOf`) into `head_lab/ragdoll.ts` as the single home. Source: `combat_lab.md`, `ragdoll_lab.md`.
14. **Add a `Scene3D` nested-transform primitive (or one shared `Part`/`ModelCtx` helper)** to kill the hand-rolled transform hierarchies in game_item_gallery/physics_lab/animation_lab. Source: `physics_lab.md`, `game_item_gallery.md`.
15. **Consolidate vehicle data** into one module owning types + `VEHICLE_STYLES`/`VEHICLE_ROLES` + `buildVehicle`, with vehicle_lab as the viewer and hmsc/ragdoll_lab consuming it (kills the 4-source car-metric fragmentation). Source: `vehicle_lab.md`, `ragdoll_lab.md`, `hmsc.md`.
16. **Promote `effect_fills`'s board/material/seed-coefficient tables to one module** both `index.tsx` and `textureShaders.ts` import — the duplicated `seedCoef` is a silent eval-invalidation hazard. Source: `effect_fills.md`.

### Taxonomy / loud-status comments
17. **Name the de-facto 3D physics**: the Verlet-in-cart solver is the real answer; document `physics3d.zig`'s dormancy *next to* a pointer to `head_lab/ragdoll.ts` + the `__hmsc_*` host sim so a future "real physics" effort chooses consciously. Source: `physics3d.md`, `head_lab.md`.
18. **Codify the standing loop as a `useGameLoop` hook** (rAF-guard + dt-clamp + tick-counter + ref-mirror) — proposed in `ragdoll_lab.md`; ~12 carts re-roll it.
19. **Promote the workspace-cart abstraction to a named SDK pattern** (envelope + debounced autosave + snapshot undo); 3 consumers prove it. Source: `cutout.md`, `composer.md`, `hmsc-int.md`.
20. **Make the "ground-truth vs display-warp" split a documented project law** with the two chance engines (scape, hmsc) as the reconciliation target. Source: `scape.md`, `combat_lab.md`.
21. **Add a binary-file host fn (`__fs_write_bytes`/`__fs_copy`)** — the UTF-8-only `writeFile` constraint forces the PNM/P5-maxval-1 trick (pixel_icon_demo), the `cp` shell-out (composer, third sighting), and carve_lab's text-file dance. Source: `pixel_icon_demo.md`, `composer.md`, `cutout.md`.
22. **Standardize the import-path convention** (`@reactjit/primitives` vs `@reactjit/runtime/primitives`) and audit the `_old`/vestigial-file family for deletion so live-vs-dead is a name read, not an import trace. Source: `planet_run.md`, `carve_lab.md`, `cutout.md`, `input_bench.md`, `pixel_icon_demo.md`.

---

### Appendix: highest-signal counts at a glance
- rAF-probe/setTimeout-16 loop: **~18/33**
- Geometry registry + intern (unit-params rule): **~16/33**
- Bus-mediated input + pointer-capture + keysRef: **~14/33**
- StaticSurface→textureKey 2D-on-3D bridge: **~12/33**
- Sim-in-refs + tick-counter loop: **~12/33**
- Registry-driven kinds ("struct stores kind"): **~12/33**
- Effect-quad + flat-f32 storage buffer: **~11/33**
- Camera pure-solve + `Solved` + unproject: **~10/33**
- Two humanoid systems (the top convergence candidate): flagged in **5+/33**
