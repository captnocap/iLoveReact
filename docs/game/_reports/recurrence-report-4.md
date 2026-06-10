# Recurrence Report 4 — Cross-Document Synthesis of `docs/game/`

Source corpus: all 33 per-cart audit docs in `docs/game/` (excluding `_reports/`).
Method: each doc taken at face value as ground truth; no source code read. Counts are over the 33 docs.

The corpus splits into four families:
- **Game carts** (playable): `hmsc.md`, `scape.md`, `planet_run.md`, `shitcoin.md`, `voxel_stack_demo.md`.
- **System labs** (one mechanic in isolation): `combat_lab.md`, `ragdoll_lab.md`, `pathing_lab.md`, `vehicle_lab.md`, `physics_lab.md`, `input_bench.md`, `hmsc_scale_lab.md`, `hmsc_massive_map_lab.md`, `animation_lab.md`, `camera_lab.md`, `render_perf_lab.md`.
- **Authoring / content tools**: `head_lab.md`, `bodylab.md`, `carve_lab.md`, `cutout.md`, `composer.md`, `pixel_icon_demo.md`, `pixel_icon_gallery.md`, `hmsc-int.md`, `effect_fills.md`, `game_item_gallery.md`.
- **Capability demos / shared modules**: `billboard_demo.md`, `skybox_demo.md`, `geometry_demo.md`, `boxxx_demo.md`, `bake-geometry.md`, `animationDsl.md`, `physics3d.md`.

---

## 1. Recurring Patterns / Shapes

Ordered by recurrence count. The high-count entries are the project's load-bearing concepts.

### 1.1 `Scene3D.Mesh` + geometry-registry interning (the only living mesh path) — ~22/33
Carts: `animation_lab`, `bodylab`, `camera_lab`, `carve_lab`, `geometry_demo`, `skybox_demo`, `billboard_demo`, `game_item_gallery`, `combat_lab`, `ragdoll_lab`, `pathing_lab`, `vehicle_lab`, `physics_lab`, `input_bench`, `hmsc`, `hmsc_scale_lab`, `hmsc_massive_map_lab`, `planet_run`, `voxel_stack_demo`, `head_lab`, `hmsc-int`, `bake-geometry`.
Every 3D cart routes meshes through `@reactjit/geometries` generators (`{id, defaults, generate}`) + the `internKey`/`internGeometry` cache; string geometry names are explicitly dead (`billboard_demo.md`, `geometry_demo.md`). `bake-geometry.md` is the build-time precompute of this exact path. The **unit-params + scale-transform** discipline (don't put per-frame-varying floats in `params` or the intern cache OOMs) is restated as a hard rule in `combat_lab.md`, `hmsc_massive_map_lab.md`, `physics_lab.md`, `hmsc_scale_lab.md`, `voxel_stack_demo.md`.

### 1.2 rAF-probe → `setTimeout(fn,16)` game loop — ~18/33
Carts: `billboard_demo`, `bodylab`, `camera_lab`, `combat_lab`, `ragdoll_lab`, `pathing_lab`, `physics_lab`, `input_bench`, `hmsc`, `hmsc_massive_map_lab`, `planet_run`, `animation_lab`, `skybox_demo`, `scape`, `vehicle_lab` (interval variant), `head_lab` (interval variant), `game_item_gallery` (interval variant), `pixel_icon_*` (interval variant).
The host has no `requestAnimationFrame` (`reactjit_no_raf` memory; verified in `billboard_demo.md`, `physics3d.md`). Universal idiom: probe `globalThis.requestAnimationFrame`, fall back to `setTimeout(fn,16)`; `performance.now()` with `Date.now()` fallback; `dt` clamped (typically `[0.001, 0.05]`). Editor/tool carts (`head_lab`, `vehicle_lab`, `game_item_gallery`, `pixel_icon_*`) deliberately use `setInterval` instead — `head_lab.md` names this the "editor idiom vs game idiom" distinction.

### 1.3 Sim-in-refs + dummy `setTick` render trigger — ~12/33
Carts: `combat_lab`, `ragdoll_lab`, `pathing_lab`, `physics_lab`, `input_bench`, `hmsc_massive_map_lab`, `planet_run`, `scape`, `hmsc`, `animation_lab`, `head_lab`, `vehicle_lab`.
Real-time state lives in a `useRef` mutable object; React state holds only a frame counter bumped once per tick to force re-render; UI state is mirrored into refs so the loop closure reads live values. `ragdoll_lab.md` and `combat_lab.md` both nominate a `useGameLoop` hook (scheduler-guard + dt-clamp + tick-counter + ref-mirror) as the extraction.

### 1.4 StaticSurface → `textureKey` bridge (2D-on-3D) — ~13/33
Carts: `billboard_demo` (the canonical proof), `carve_lab`, `game_item_gallery`, `hmsc`, `hmsc_scale_lab`, `hmsc_massive_map_lab`, `head_lab`, `ragdoll_lab`, `planet_run`, `combat_lab` (via figures), `cutout` (Paintable variant), `effect_fills` (prescribed), `hmsc-int`.
String-keyed, cross-tree, host-resolved-per-frame render-to-texture. Two sub-uses: **bake-once** (memoized capture + `useMemo` data/style — `planet_run.md`, `hmsc_scale_lab.md`, `head_lab.md`) vs **live re-bake** (animated, accepted cost — `billboard_demo.md`, `effect_fills.md` live fills). The `static_surface_inline_props_rebake` trap (inline `data`/`style` → per-frame rebake) is flagged in `billboard_demo.md`, `head_lab.md`, `hmsc` (`tileSurface.tsx`).

### 1.5 `<Effect>` WGSL quad + flat `f32` data buffer — ~12/33
Carts: `billboard_demo`, `effect_fills` (~170 swatches, one mega-shader), `game_item_gallery`, `scape` (whole world is one quad), `pixel_icon_gallery`, `pixel_icon_demo`, `hmsc` (minimap, all tile/road/landform fills), `cutout` (MaskQuad), `planet_run` (planet surface), `hmsc-int` (every painted chunk), `hmsc_massive_map_lab` (no), `shitcoin` (no — but Filter CRT). The "pack a struct into a flat `f32` array → `effectData` → storage buffer `@binding(1)`" idiom is named canonical in `pixel_icon_gallery.md`, `effect_fills.md`, `scape.md`. The **mega-shader-with-selector** variant (one WGSL, `D[]` indexes the look) appears in `effect_fills.md` (58 materials) and `pixel_icon_gallery.md` (palette lookup).

### 1.6 Registry-driven kinds ("struct stores `kind`, registry gives it meaning") — ~11/33
Carts: `hmsc` (tiles/buildings/props/NPCs/roles/landforms), `combat_lab` (kinds.ts/tileKinds.ts consumed unmodified), `vehicle_lab` (style/role registries), `game_item_gallery` (`ITEMS`), `scape` (item modules, packed-bits tiles), `voxel_stack_demo` (`BLOCKS`), `pathing_lab` (tile kinds), `hmsc-int` (kind textures, placeables), `bodylab` (FigureDef), `shitcoin` (app registry), `head_lab` (PART_PRESETS/BODY_SHAPES). `combat_lab.md` calls registries "the project's load-bearing data architecture" and notes every lab-local table carries a "graduate me to the registry" comment.

### 1.7 Orbit/Follow camera + drag-to-orbit + click-vs-drag threshold — ~12/33
Carts: `bodylab`, `camera_lab`, `carve_lab`, `game_item_gallery`, `ragdoll_lab`, `vehicle_lab`, `voxel_stack_demo`, `pathing_lab`, `planet_run`, `hmsc_scale_lab` (hand-rolled), `hmsc_massive_map_lab` (hand-rolled), `head_lab`. Two camps: **registry** (`@reactjit/cameras` `OrbitCamera`/`FollowCamera`) in `bodylab`, `carve_lab`, `game_item_gallery`, `ragdoll_lab`, `vehicle_lab`, `voxel_stack_demo`, `pathing_lab`, `planet_run`, `camera_lab`; **hand-rolled trig** in `hmsc_scale_lab`, `hmsc_massive_map_lab`, `animation_lab`, `input_bench` (see §3.2). The <6px-travel click gate on a single Pressable recurs in `voxel_stack_demo.md`, `pathing_lab.md`, `physics_lab.md`.

### 1.8 Bus-mediated input (`__keydown`/`__keyup` packed-int → JS fan-out) — ~13/33
Carts: `camera_lab`, `combat_lab`, `ragdoll_lab`, `pathing_lab`, `physics_lab`, `input_bench`, `hmsc`, `hmsc_scale_lab`, `hmsc_massive_map_lab`, `planet_run`, `scape`, `hmsc-int`, `animation_lab`. `keysRef` boolean map polled by the tick; discrete actions fire on the event through a latest-closure ref (`planet_run.md`, `ragdoll_lab.md`). Quirk repeated across docs: Shift/modifiers arrive as raw SDL keysyms not `'shift'` (`combat_lab.md`, `physics_lab.md`).

### 1.9 Pointer-capture rule (down+move+up on the SAME node) — ~10/33
Carts: `hmsc_massive_map_lab`, `hmsc_scale_lab`, `ragdoll_lab`, `physics_lab`, `carve_lab`, `bodylab`, `combat_lab`, `voxel_stack_demo`, `vehicle_lab`, `scape`. Universally honored; documented as a footgun (`feedback_pointer_capture`).

### 1.10 Bones-as-interface humanoid (skeleton record in/out) — ~6/33
Carts: `head_lab`, `ragdoll_lab`, `combat_lab`, `pathing_lab`, `planet_run`, `hmsc`/`hmsc_scale_lab` (the parallel hmsc humanoid). `Record<BoneId, SkeletonBone>` produced by three sources (animation `buildSkeleton`, physics `bonesFromRagdoll`, blend `blendBones`) and consumed by one sink (`buildRigFrameFromBones`). The single most-cited convergence shape; see §3.1.

### 1.11 Workspace cart pattern (envelope + debounced autosave + snapshot undo + commit/commitCoalesced) — 4/33
Carts: `cutout` (origin), `composer` (2nd consumer), `hmsc-int` (3rd consumer, v2 payload), and `pixel_icon_demo` (in-memory miniature, `FrameSlot`). `composer.md` calls it "a proven 2-consumer abstraction"; `hmsc-int.md` is the third. Disk = truth; the `_old`-file breadcrumb pattern (`cutout`, `input_bench`, `head_lab`) accompanies it.

### 1.12 Hash/seed-deterministic procedural world (no storage) — 5/33
Carts: `hmsc_massive_map_lab` (`hash2`/`randRange`, 4000 chunks from nothing), `planet_run` (mulberry32 planet+person), `voxel_stack_demo` (deterministic sine terrain), `geometry_demo` (LCG blob), `scape` (seeded but authored city). "Regenerate on demand, pan-away-and-back is identical."

### 1.13 Publish-the-world-once host service (bulk transfer, then queries) — 3/33 (named in more)
Carts: `pathing_lab` (`__path_set_grid` → host A*), `hmsc` (`__hmsc_register_heightfield` physics), `hmsc_massive_map_lab` (instanced batch ship). `pathing_lab.md` explicitly groups these three as one shape.

### 1.14 One-batch instanced rendering (`Scene3D.Instances`, group-by-kind, stride-9) — 3/33
Carts: `hmsc_massive_map_lab` (whole city), `voxel_stack_demo` (voxel field), referenced as sibling of `boxxx_demo` (2D RectBatch). Ship-vertices-once intern behavior. Caveat surfaced in `voxel_stack_demo.md`: per-instance opacity is NOT in stride-9, so translucent kinds render opaque.

### 1.15 Ground-truth-vs-display perception split — 4/33
Carts: `scape` (chance.ts vs perception.ts, physically separate modules), `combat_lab` (chance.ts header rule, HUD shows truth), `hmsc` (chance.ts vs HUD), restated in `pathing_lab` (deterministic plan vs reactive display). The "never compute odds elsewhere, never let display warp touch the sim" law.

### 1.16 Verlet-in-cart physics (no host 3D rigid bodies) — 3/33
Carts: `ragdoll_lab`, `combat_lab`, `head_lab` (the solver lives in `head_lab/ragdoll.ts`). Position-based dynamics in TS because the framework's `<Physics>` is Box2D-only and `physics3d.zig` is dormant (§2.1).

### 1.17 "The rendered thing IS the tested thing" (see-it == hit-it) — named in 4
Carts: `combat_lab` (cover boxes = ray AABBs, hitboxes = damage surface, camera axis = bullet line), `hmsc` (terrain mesh = collider), `hmsc-int` (paint shader = game terrain shader), `pathing_lab` (rendered strips = same tile data). `combat_lab.md` proposes it as a named project principle.

### 1.18 Animation DSL (`[dur,target,action;...]` → sampled sin-envelope actions) — 5/33
Carts: `animationDsl` (the module), `vehicle_lab`, `pathing_lab`, `planet_run`, `head_lab`. One alias table speaks body AND vehicle (`car`/`wheels`/`suspension`). `animation_lab` has a parallel `poseFor` table that does NOT use the DSL (see §3.3).

---

## 2. Naming / Placement Lies

Cases where a file's name or directory misleads about live-vs-dead, lab-vs-production, or ownership.

### 2.1 `framework/v8_bindings_physics_lab.zig` contains the LIVE production HMSC physics — GOLD STANDARD
Docs: `physics3d.md`, `physics_lab.md`, `combat_lab.md`, `hmsc.md`.
The file named for a *lab* hosts `__hmsc_physics_step`, `__hmsc_register_heightfield`, `__hmsc_clear_heightfields` — the real game physics backend consumed by `cart/hmsc-int/state/hostPhysics.ts`. `physics_lab.md`: "the host side has since grown into the **real hmsc physics backend** … this lab is the proving ground that file graduated from." The lab's own `__physics_lab_*` fns cohabit but are a different (stateful) API.

### 2.2 `framework/phys/physics3d.zig` looks like serious framework physics but is fully DORMANT
Doc: `physics3d.md` (entire doc). Fully implemented Bullet 3.25 integration, **wired to nothing** — `build.zig` never compiles the shim, no Node fields, no JS primitive, no host fn registered. Its own header comment describes `<3D.Physics>` and `Node.physics3d_world_id` that **do not exist** (stale Smith-era aspiration). The one collider hmsc needed (heightfield) is the one case stubbed `null`. Recommendation in the doc: rename `bullet3d_dormant.zig` or delete all three files.

### 2.3 "input bench" Zig backend is reused as production drive-movement
Docs: `animation_lab.md`, `input_bench.md`. `framework/v8_bindings_input_bench.zig`'s `__input_bench_*` WASD integrator is imported by `animation_lab` for its actual drive mode. `animation_lab.md` glossary: "Input bench: Zig-side WASD movement backend **originally from input benchmarking, reused here for drive mode**." Name says benchmark; role is shared movement.

### 2.4 `_old` files left in-tree that read as current
Docs: `cutout.md` (8 `_old` files: `state_old.ts`, `session_old.ts`, `Editor_old.tsx`, `Inspector_old.tsx`), `input_bench.md` (`index_old.tsx`, `backend_lua_old.tsx`), `head_lab.md` (predates kit extraction). Not imported by the active path but same directory, same base names — a reader grepping by name can land on dead code. The docs are explicit these are reference-only.

### 2.5 Orphaned near-duplicate scenes with no consumer
Docs: `hmsc_scale_lab.md` (`cart/hmsc-int/labs/ScaleLabScene.tsx` is a near-verbatim copy of the standalone `hmsc_scale_lab.tsx`, already drifted — purple line at 2.45m vs 2.04m, zero importers), `scape.md` (`ui/Wheel.tsx` — but documented-intentional, recorded in PROGRESS.md). The scale-scene orphan is the dangerous one (silent value drift, no canonical owner).

### 2.6 `useLuaWorker.ts` is "not a React hook despite its name"
Doc: `input_bench.md` explicit: "is not a React hook despite its name. It exports an imperative `luaWorker` object." The `use*` prefix lies about it being a hook.

### 2.7 `cart/hmsc-int/AGENTS.md` documents `MapCanvas.tsx` which is now `PaintCanvas.tsx`
Doc: `hmsc-int.md` (flagged twice). The cart's own contract names a renamed file — doc drift inside the authoritative contract.

### 2.8 `car.tsx` header claims pathing_lab drives fleets of it — false
Doc: `ragdoll_lab.md`. `car.tsx`'s comment says "shared … pathing_lab drives fleets of them," but `pathing_lab` now imports `buildVehicle` from `vehicle_lab`; `CarMeshes` has exactly one consumer (ragdoll_lab). Stale ownership claim.

### 2.9 Dead code that looks reachable
Docs: `pixel_icon_demo.md` (the entire vestigial Canvas editor — `canvasScreenToGraph`, `canvasRect` setter never called, `paintAtWorld`, `hiResOverlayCells` memo computed-but-never-rendered), `hmsc_massive_map_lab.md` (`ChunkGround`/`ChunkRoads`/`BuildingMesh` fully-written `Scene3D.Mesh` components with zero JSX usage — the abandoned per-mesh first draft duplicating the live batch recipe), `pixel_icon_gallery.md` (`idxRef` written-never-read; "pause when not visible" comment with no `document`). `__canvas_screen_to_graph` in `pixel_icon_demo` is wrapped but "only reachable from dead code" — vs the SAME binding being *live* in `hmsc-int`.

---

## 3. Duplicated / Parallel Systems

### 3.1 TWO humanoid/figure systems — the biggest convergence candidate
Docs: `ragdoll_lab.md` (most explicit), `combat_lab.md`, `planet_run.md`, `hmsc.md`, `hmsc_scale_lab.md`, `bodylab.md`, `head_lab.md`, `camera_lab.md`, `animation_lab.md`, `input_bench.md`.
- **head_lab figure stack** (`cart/head_lab/`: sculptable Globe parts, `.hed` faces, 25 named bones, box hitboxes, clothing system, Verlet ragdoll) — used by `ragdoll_lab`, `combat_lab`, `pathing_lab`, `planet_run`, `head_lab`.
- **hmsc humanoid** (`cart/hmsc-int/render3d/humanoid/`: fixed primitive parts, baked face decals, 6 capsule hit zones, palette recolor, no physics) — used by `hmsc`, its labs, `hmsc_scale_lab`, `hmsc_massive_map_lab`.
- **Third + fourth variants**: `bodylab`'s primitive-cluster `HumanoidFigure`/`solveHumanoid` (its own `drivePose`/`BodyProportions`); `camera_lab`/`animation_lab`/`input_bench` each carry an inline 18-part `HUMANOID` array (input_bench's is "copied from camera_lab"); the registry's single-baked `Geometry.Humanoid` (used only by `camera_lab` for contrast).
- **The smoking gun** (`ragdoll_lab.md`, `combat_lab.md`): the SAME six-region locational-damage model with reversed naming — ragdoll_lab `lArm/rArm/lLeg/rLeg` vs hmsc `DamageZone armL/armR/legL/legR`. `combat_lab` already bridges them via `boneZone()` renaming head_lab hitboxes into hmsc's `ZONE_DAMAGE` vocabulary — "the convergence move ragdoll_lab predicted," but half-done.
- **Consolidation winner**: undecided in the docs. The hmsc humanoid is "solve once → mesh AND hitbox from same joints" (cleaner contract, `hmsc_scale_lab.md`); the head_lab kit is richer (sculpt, faces, clothing, ragdoll). `combat_lab` is the active merge site.

### 3.2 TWO chance/hit-percent engines
Docs: `scape.md`, `combat_lab.md`, `hmsc.md`. `scape/systems/chance.ts` (multiplier `ChanceBreakdown`, weapon `RangeProfile`, tile-grid LoS with glass-window shots) vs `hmsc/npc/systems/chance.ts` (`hitChance` with `coverFraction`). Both games, both implement ground-truth-odds-with-separate-display. `scape.md`: "scape's breakdown legibility (WHY 33%) is the richer surface, hmsc's cover-fraction producer is the richer input" — reconcile when worlds converge.

### 3.3 Multiple pose/animation paths
Docs: `animation_lab.md`, `head_lab.md`, `bodylab.md`, `animationDsl.md`, `vehicle_lab.md`. `animation_lab` has its own `poseFor(action,t)` table and inline `AnimatedFigure` that does NOT use the shared `cart/animationDsl.ts`; `bodylab` has its own `drivePose`; head_lab/vehicle_lab/pathing_lab/planet_run all ride the shared DSL. `animation_lab.md` itself notes "No shared animation DSL" as a gap — it predates DSL adoption. The DSL is the consolidation winner (alias table already speaks body+vehicle+face).

### 3.4 Multiple camera implementations (registry vs hand-rolled)
Docs: see §1.7. `camera_lab.md` is the canonical registry showcase (`Solved = {pos,target,fov}`, picking inverts via `unprojectGround`). Hand-rolled survivors: `hmsc_scale_lab` (`cameraFromOrbit`), `hmsc_massive_map_lab` (dual-rig trig, "convergence target = Follow/Orbit"), `animation_lab`, `input_bench` (1P/3P split), `hmsc` (gameplay cam in `camera.ts`). Registry is the winner; the hand-rolled ones are pre-registry or game-specific. `combat_lab` and `pathing_lab` use `solveCamera`/`unprojectGround` for picking.

### 3.5 `screenRay` / camera-inverse picking duplicated 3+ times
Docs: `voxel_stack_demo.md`, `hmsc-int.md` (`assist3d/picking.ts`), `camera_lab.md`. The cameras registry exports only `unprojectGround` (ground-plane), not the generic ray, so any cart needing non-ground picking (voxel face hits, AABB picks) re-rolls the view-basis math. `voxel_stack_demo.md`: "Three code bodies now build the same view basis (unproject.ts, this cart, scape3d's original projection.ts)." Extraction candidate: export `screenRay(sx,sy,rect,solved)` and make `unprojectGround` consume it.

### 3.6 Color/hex helper sprawl — 4+ copies
Docs: `ragdoll_lab.md` (most explicit: `darkHex`/`darkShoe`/`darken`/`mixHex` across 4 files), `combat_lab.md` (`mixHex`/`hpColor` copied from ragdoll_lab), `skybox_demo.md` (`mixHex`/`hexToRgb`), `scape.md` (palette module is the anti-drift answer). All parse `#rrggbb`, scale channels, re-emit. Wants one color utility.

### 3.7 `clamp` / V3 math re-rolled per file
Docs: `scape.md` ("4+ files within this one cart"), `ragdoll_lab.md` (`lerp3` twice in one dep chain; `sub/len3/mid3/lerp3` per file), `combat_lab.md`. Repo-wide utility sprawl flagged in nearly every lab.

### 3.8 `decodeMatrix` / pixel-format codec duplicated
Docs: `pixel_icon_gallery.md`, `pixel_icon_demo.md`. `decodeMatrix` near-verbatim in both; `encodeMatrix` only in the demo; `PixelMatrix` type + `.64.json`/`.anim.json` filename convention constitute an undocumented file-format module wanting extraction into `cart/pixel_icons/` alongside the shared `matrix.ts`.

### 3.9 ModelCtx/Part transform-hierarchy workaround re-implemented
Docs: `physics_lab.md`, `game_item_gallery.md`, `animation_lab.md` (`segmentPose`), `head_lab.md` (parts), `ragdoll_lab.md` (`place()/turn()` × 3). `Scene3D` has no parent/child transform nesting, so carts hand-roll `local(ctx,p)` (scale → rotate-by-yaw → translate) repeatedly. `physics_lab.md`: "recurring evidence that `Scene3D` wants nested transforms or a shared part-composition helper."

### 3.10 Inline custom geometry (`Blade/Sail/BoatHull/Surfboard`) authored in 2 carts
Docs: `physics_lab.md`, `game_item_gallery.md`. Both define the same four custom geometries inline via a local `def(id,defaults,generate)`. Proves the registry's open authoring path, but the four generators are copy-reusable and should live once.

### 3.11 Item physics/visual split + item registry parallels
Docs: `physics_lab.md` (`{radius,mass,cog}` + model fn), `combat_lab.md`, `game_item_gallery.md` (`ITEMS`), `scape.md` (item modules with WGSL-as-data), `vehicle_lab.md` (semantic part ids). The "physics triple host-side, visuals cart-side, joined by index" pattern (`physics_lab.md`) recurs; scape's item-module registry is the scape-side twin of scape3d's thingymajigger doctrine.

---

## 4. Cross-Doc Contradictions

### 4.1 Stale mesh/instance caps printed in `hmsc_massive_map_lab`
Doc: `hmsc_massive_map_lab.md`. Panel hardcodes `meshCap: 8192`, `nodeIndexCap: 4096`, but `framework/gpu/3d.zig` now says `MAX_INSTANCES = 65536`, `MAX_SCENE_MESHES = 32768`. The doc itself flags the labels as wrong ("trust host telemetry, not labels"). A reader comparing this cart's stated ceilings against the live engine would be misled.

### 4.2 `ScaleLabScene.tsx` height constant diverges from the standalone scale lab
Doc: `hmsc_scale_lab.md`. The orphan draws the purple height line at `PLAYER_VISUAL_TOTAL_HEIGHT` (2.45m); the live cart draws it at `PLAYER_VISUAL_HEAD_TOP` (2.04m). Two files, same names, divergent values, no canonical owner — a doc-internal contradiction about "where the top of the player is."

### 4.3 `PLAYER_VISUAL_*` hand-transcribed from skeleton.ts — silently lies if skeleton changes
Doc: `hmsc_scale_lab.md`. The lab's visual constants are hand-copied from geometry in `skeleton.ts` (head top 2.04, hat apex 2.29, shoe dip −0.16); transcribed a *third* time in `ScaleLabScene.tsx`. Nothing ties them together — the doc names this an active drift violation of the lab's own "derive everything from the contract module" rule.

### 4.4 Damage-region naming contradiction across the two humanoid stacks
Docs: `ragdoll_lab.md` vs `combat_lab.md`/`hmsc.md`. `lArm/rArm/lLeg/rLeg` (head_lab/ragdoll_lab) vs `armL/armR/legL/legR` (hmsc). Same model, opposite naming convention — the very thing `combat_lab`'s `boneZone()` exists to paper over. A cross-stack reader can't assume one vocabulary.

### 4.5 "Lab cart derives from the contract or it rots" — documented lesson, violated nearby
Doc: `hmsc_scale_lab.md` states the lesson, then catches itself: the hand-transcribed `PLAYER_VISUAL_*` constants already violate it. Same doc, lesson-and-violation in one breath — a self-contradiction worth fixing.

### 4.6 Minor header-vs-code drifts (each within one doc)
`pixel_icon_gallery.md`: header comment says scales "1/2/3/4" but code is `[1,2,3,4,6]`; in-shader comment supersedes a stale header comment about y-inversion. `skybox_demo.md`/`geometry_demo.md`: "spinning slowly on Y" comment but rotation is a fixed pose. These are intra-file but show the corpus-wide pattern of comments outliving code.

---

## 5. Isolated One-Offs (close to a recurring shape, cheap to connect)

### 5.1 `<Boxxx>` RectBatch (2D instanced rect paint) — only `boxxx_demo`
Doc: `boxxx_demo.md`. The 2D sibling of `Scene3D.Instances`; `hmsc_massive_map_lab.md` and `voxel_stack_demo.md` already name it the 2D analog. One unification away from a single "batch N identical primitives" story across 2D and 3D. (Also the `project_ui_as_one_quad` direction.)

### 5.2 `Geometry.Carve` image→3D inflate — only `carve_lab` (+ head decals)
Doc: `carve_lab.md`. Teddy cutout-inflate (chamfer DT → sqrt profile). Shares the StaticSurface→textureKey bridge and the geometry-registry path with everything else; `head_lab` already uses the carve lesson (stale-bake key discipline). One step from being a general "mask → mesh" capability in the registry.

### 5.3 LuaJIT off-thread worker — only `input_bench`
Doc: `input_bench.md`. Bounded string-queue scripting runtime with explicit lifecycle. `composer.md`'s `new Function` sandbox and `scape.md`'s claude-subprocess NPC are sibling "user/AI code drives the engine" surfaces — a "scripting backend" abstraction could unify them.

### 5.4 `Render` app-capture surfaces (Xvfb + XShm) — only `render_perf_lab`
Doc: `render_perf_lab.md`. `app:kitty` virtual-display capture into a GPU quad. `scape`/`shitcoin` spawn claude subprocesses but don't capture their display; the render-surface bridge is the generalization of "external process in the game world."

### 5.5 Live-LLM NPC (claude subprocess) — only `scape` (+ `hmsc-int` chat)
Docs: `scape.md`, `hmsc-int.md`. `useAssistant` with `claude_code` backend, roleplay prime, streamed bubbles, input-gating. `hmsc-int` uses the same hook for its Chat tab and assist3d scene authoring. One `useAssistant` away from being a reusable "agent-NPC" / "AI authoring" capability.

### 5.6 `new Function(...bindings, body)` user-scripting sandbox — only `composer`
Doc: `composer.md`. Flat EarSketch-idiom API, identifier-validated bindings, instrument-the-wrappers-for-UI. `composer.md` names it "directly reusable for any user-writes-code-that-drives-the-engine surface (the IF/THEN composer, game scripting)."

### 5.7 Provider-adapter + normalized-schema + injectable-transport + offline-smoke-harness — only `composer` (`sources/`)
Doc: `composer.md`. "The repo's most complete networking-integration template." Mirrors `cutout/backends` (flood/SAM) shape; one generalization from being THE backend-adapter pattern.

### 5.8 Quality-grade-as-runtime-knob — only `effect_fills`
Doc: `effect_fills.md`. PSX→Max retro-register/additive-detail slider applied globally. Named "a reusable idea for the whole game: one detail slider that means something artistic, not just LOD."

### 5.9 Heightfield-march building extrusion in a shader — only `scape`
Doc: `scape.md`. Packed-bits tile heights → 56-step ray descent → rooftops + facades with zero geometry. Extends `world_as_shader_quad` to 2.5D skylines; directly relevant to any tile-world cart.

### 5.10 Hot/cold sim split with a facade — only `shitcoin`
Doc: `shitcoin.md`. Zig-native AMM at frame rate + TS meta-systems at ~1 Hz, unified behind `sim.ts` hooks + `__zig_call`. The "host twin" pattern (`physics_lab.md`) and "publish-once host service" (`pathing_lab.md`) are its cousins; the facade-over-hot-and-cold is a distinct, reusable architecture.

### 5.11 Semantic anchors (role-tagged, verb-accepting interaction points) — head_lab + vehicle_lab
Docs: `head_lab.md` (`anchorsFromSkeleton` — `face_grab accepts grab_face/cover_mouth/shove`), `vehicle_lab.md` (`gasPort/driverSeat/towRear`). Same "named non-collision interaction point" shape on body and vehicle; `scape`/`combat_lab`'s action-menu/interaction systems are the natural consumers. One vocabulary away from a unified interaction-targeting layer.

---

## 6. Concrete Recommendations

### Renames / loud status comments
1. **Split `framework/v8_bindings_physics_lab.zig`** into honest `v8_bindings_hmsc_physics.zig` (the live `__hmsc_*` backend) vs the lab toy (`__physics_lab_*`). The gold-standard lie (§2.1; `physics_lab.md`, `physics3d.md`).
2. **Mark `framework/phys/physics3d.zig` DORMANT loudly** or rename `bullet3d_dormant.zig`; fix or delete its stale header describing nonexistent `<3D.Physics>`/`Node.physics3d_world_id`. Decide consciously: revive (wire build.zig gate + Node fields + heightfield shape) or delete all three files (§2.2).
3. **Rename `useLuaWorker.ts`** to drop the `use` prefix (it is an imperative object, not a hook) (§2.6; `input_bench.md`).
4. **Update `cart/hmsc-int/AGENTS.md`** `MapCanvas.tsx` → `PaintCanvas.tsx` (§2.7).
5. **Fix `car.tsx` header** (no longer shared with pathing_lab) (§2.8).
6. **Refresh `hmsc_massive_map_lab` stale caps** (8192/4096 → live 65536/32768) or read them from telemetry (§4.1).

### Deletions / orphan reconciliation
7. **Reconcile `cart/hmsc-int/labs/ScaleLabScene.tsx`** — delete it or make it the shared source the standalone cart imports; it has already drifted (2.45 vs 2.04m) (§2.5, §4.2).
8. **Delete the dead Canvas editor in `pixel_icon_demo`** and the dead `ChunkGround/ChunkRoads/BuildingMesh` trio in `hmsc_massive_map_lab` (both duplicate live recipes, drift hazards) (§2.9).
9. **Audit `_old` files** (`cutout` ×8, `input_bench` ×2) — keep as breadcrumbs but ensure no active import; consider a `_archive/` subfolder so name-grep can't mislead (§2.4).

### Extractions (utilities)
10. **One color utility** — collapse `darkHex`/`darkShoe`/`darken`/`mixHex`/`hexToRgb` (4+ copies) into a shared module; adopt scape's palette-token approach for shader+chrome carts (§3.6).
11. **One math utility** — `clamp`, `lerp3`, `sub/len3/mid3`, V3 ops re-rolled in nearly every lab (§3.7).
12. **Export `screenRay(sx,sy,rect,solved)` from `@reactjit/cameras`** and make `unprojectGround` consume it (3+ duplicate view-basis bodies) (§3.5).
13. **Extract the pixel-format module** (`encodeMatrix`/`decodeMatrix`/`PixelMatrix`/filename convention) into `cart/pixel_icons/` alongside `matrix.ts` (§3.8).
14. **Extract a `placeLocal(yaw, origin)` / part-composition helper** for the ModelCtx/Part transform-hierarchy workaround (5+ re-implementations); or add nested transforms to `Scene3D` (§3.9).
15. **Move `Blade/Sail/BoatHull/Surfboard` inline geometries** into the registry once (authored in physics_lab AND game_item_gallery) (§3.10).
16. **Package a `useGameLoop` hook** (scheduler-guard + dt-clamp + tick-counter + ref-mirror) — the sim-in-refs loop recurs in 12 carts (§1.3; named in `ragdoll_lab.md`, `combat_lab.md`).

### Taxonomy / convergence
17. **Pick a humanoid winner and converge** (§3.1) — the single biggest item. Unify the locational-damage vocabulary first (`lArm`↔`armL`), then decide head_lab-kit-vs-hmsc-humanoid; `combat_lab`'s `boneZone()` is the active bridge. Also fold `BONE_JOINTS`, `boneZone`/`boneRegion`, `SETTLE_MOTION`, `eyeOf` into `head_lab/ragdoll.ts` (`combat_lab.md` duplication ledger).
18. **Reconcile the two chance engines** (`scape` legibility + `hmsc` cover-input) before a third appears (§3.2).
19. **Make the DSL the one animation path** — retire `animation_lab`'s `poseFor` table and `bodylab`'s standalone `drivePose` onto `cart/animationDsl.ts` (§3.3).
20. **Promote lab-local tables to registries** — every lab carries explicit "graduate me" notes (`SHOOTER_SKILL`, `FIRE_COOLDOWN`, `MOVE_NOISE` in combat_lab; weapons, etc.). The registry-driven-kinds pattern (§1.6) is the home (`combat_lab.md`).
21. **Name and document the standing invariants** as project principles: "see-it == hit-it" (§1.17), "ground-truth vs display split" (§1.15), "mount `<HumanoidFaceCaptures/>` next to your Scene3D" (currently only a code comment per `hmsc_scale_lab.md`/`hmsc_massive_map_lab.md`), the YXZ euler-order knowledge (load-bearing, lives only in cart comments per `planet_run.md`).
22. **A binary `__fs_write_bytes`/`__fs_copy` host fn is overdue** — the UTF-8-only `writeFile` boundary forces the PNM/P5-maxval-1 tricks (`pixel_icon_demo`) and `cp`/ffmpeg shell-outs (`composer`, `cutout`); "third sighting, same workaround family" (`composer.md`).
