# Cross-Cart Recurrence Report 1

Synthesis across all 33 per-cart docs in `docs/game/` (the `_reports/` subdir excluded). Every claim below cites the supporting doc filename(s). Counts are out of 33 docs. This is a documentation synthesis, taken at the docs' face value — no source was re-read.

The corpus splits roughly into: **3D-scene carts** (most), **2D-tool/editor carts** (cutout, composer, pixel_icon_*, render_perf_lab, boxxx_demo), **the two games** (hmsc, scape) and their game-adjacent labs, **pure modules** (animationDsl, bake-geometry, physics3d), and **the character/figure hub** (head_lab).

---

## 1. RECURRING PATTERNS / SHAPES

Ordered by recurrence count (highest = the project's load-bearing concepts).

### 1.1 rAF-probe → `setTimeout(fn, 16)` game loop — **~17/33**
The single most universal idiom. The V8 cart host has **no `requestAnimationFrame`**, so every animated cart probes `globalThis.requestAnimationFrame` and falls back to `setTimeout(fn,16)`; `setInterval`/`performance.now` exist. dt is read from `performance.now()` (fallback `Date.now()`) and clamped (commonly `[0.001, 0.05]` or `[1,50]ms`).
Docs: billboard_demo, bodylab, camera_lab, combat_lab, animation_lab, geometry_demo (none — static), hmsc, hmsc_massive_map_lab, hmsc_scale_lab (notes its absence), input_bench, pathing_lab, physics_lab, planet_run, ragdoll_lab, scape, skybox_demo, vehicle_lab, voxel_stack_demo (none — event-driven), head_lab (uses `setInterval` deliberately, calls out the contrast).
Variation worth canonizing: **head_lab explicitly uses `setInterval` (150/90/50ms), declaring "rAF-probe is the GAME loop idiom, intervals are the EDITOR idiom"** (head_lab). billboard_demo/massive_map_lab note the loop probe "always lands on setTimeout."

### 1.2 Sim-in-refs + dummy `setTick` render trigger — **~10/33**
The standing real-time-cart state architecture: all mutable sim lives in a `useRef` object; React state holds only UI knobs + a frame counter bumped once per tick (`setTick(t=>t+1)` / `force(n=>(n+1)&0xffff)`); UI state the loop needs is **mirrored into refs** so the closed-over tick avoids stale closures.
Docs: combat_lab, hmsc_massive_map_lab, input_bench (the "mutable Controller" + "render heartbeat"), physics_lab, planet_run, ragdoll_lab, scape, head_lab (ref+commit-on-release variants), animation_lab, pathing_lab. ragdoll_lab's doc explicitly proposes a `useGameLoop` hook packaging "scheduler-guard + dt-clamp + tick-counter."

### 1.3 StaticSurface → `textureKey` "2D-on-3D" bridge — **~9/33**
String-keyed render-to-texture: a `<StaticSurface staticKey="K">` subtree (often parked offscreen at `left:-99999`) is baked to a GPU texture; a `<Scene3D.Mesh textureKey="K">` samples it host-side per frame. The 2D and 3D trees never reference each other in JS — only the key string. Canonical reference: billboard_demo.
Docs: billboard_demo (canonical), carve_lab, game_item_gallery, hmsc, hmsc_massive_map_lab, hmsc_scale_lab, planet_run, head_lab, effect_fills (prescribed in CATALOG). The **`<HumanoidFaceCaptures/>` mount contract** ("any cart drawing the figure must mount the captures next to its Scene3D") is the same shape: hmsc_scale_lab, hmsc_massive_map_lab, planet_run, ragdoll_lab.

### 1.4 Geometry registry + intern cache (`@reactjit/geometries`) — **~16/33**
Geometries are TS `generate(params)` defs (`{id, defaults, generate}`), not a Zig enum; `internGeometry(def, params)` keys by `id+stableStringify(params)`, runs the generator once, ships verts to the host only on first key sighting. The **unit-params-plus-scale-transform rule** (`geometry_intern_unbounded`) recurs as a hard constraint: per-frame-varying params OOM V8.
Docs: animation_lab, bake-geometry, billboard_demo, bodylab, camera_lab, carve_lab, combat_lab (UNIT_CYL/BOX module constants), geometry_demo, game_item_gallery, hmsc, hmsc_massive_map_lab, hmsc_scale_lab, physics_lab, planet_run, skybox_demo, vehicle_lab, voxel_stack_demo. Inline `def()` cart-authored geometry: game_item_gallery, physics_lab (Blade/Sail/BoatHull/Surfboard — *duplicated between these two*).

### 1.5 `<Effect>` data-array → WGSL storage buffer (mega-shader-with-selector) — **~11/33**
`<Effect data={[…]}>` → `effectData` → `@group(0)@binding(1) var<storage,read> D: array<f32>`; animate by re-uploading the array (no pipeline recompile). Scaled up: **one mega-shader, a `D[]` selector picks the look** (effect_fills' 5-float `[materialId,variant,seed,quality,board]` selecting one of ~58 materials; pixel_icon's palette+indices; scape's per-fragment world).
Docs: billboard_demo, effect_fills (canonical mega-shader), game_item_gallery, pixel_icon_gallery, pixel_icon_demo, scape, cutout (MaskQuad), skybox_demo (SkyUniforms), hmsc (minimap/tile fills), hmsc-int (chunk shaders), planet_run (PLANET_WGSL).

### 1.6 Orbit/drag camera + click-vs-drag threshold on one Pressable — **~12/33**
`onMouseDown/Move/Up` on the **same node** (the pointer-capture rule — move/up on other nodes lose capture); yaw/pitch from horizontal/vertical drag with pitch clamps; a `<6px` total-travel threshold disambiguates orbit-drag from a pick-click.
Docs: bodylab, camera_lab, carve_lab, game_item_gallery, hmsc_scale_lab, physics_lab, ragdoll_lab, scape (right-click variant), vehicle_lab, voxel_stack_demo (6px gate), pathing_lab (6px gate), combat_lab (host pointer-lock variant). The registry winner (`@reactjit/cameras`) adopters: camera_lab, carve_lab, bodylab, game_item_gallery, planet_run (FollowCamera), ragdoll_lab, vehicle_lab, voxel_stack_demo, input_bench, pathing_lab (picking). Hand-rolled holdouts: hmsc_scale_lab, hmsc_massive_map_lab, animation_lab.

### 1.7 Registry-driven "kinds" — struct stores `kind`, registry gives meaning — **~10/33**
The project's load-bearing data architecture (combat_lab names it explicitly). One table maps a kind id → behavior/appearance; instances store only the id.
Docs: combat_lab (`kinds.ts`, `tileKinds.ts`), hmsc (tile/building/prop/NPC/role/landform registries), scape (item modules, packed-bits tiles), game_item_gallery (`ITEMS`), vehicle_lab (`VEHICLE_STYLES`/`ROLES`), voxel_stack_demo (`BLOCKS` registry), shitcoin (app registry, skin/classifier registries), hmsc-int (kind textures, placeables), pathing_lab (tile kinds), physics3d (the pool pattern is a sibling). The companion rule **legality (CAN) vs sanity (WOULD) split** lives in profile multipliers, not new kinds (pathing_lab).

### 1.8 Seeded PRNG + deterministic procedural world — **~8/33**
`Math.imul`/xorshift mixers (mulberry32 family) seeded for reproducible content; rejection-sampling scatter with guard counters; no storage, regenerate on demand.
Docs: hmsc_massive_map_lab (hash-deterministic city, no storage), planet_run (seed → planet AND person), geometry_demo (LCG blob), bodylab (phase offsets), vehicle_lab (`makeVehicle(seed)`), shitcoin (deterministic cold-content PRNG), voxel_stack_demo (deterministic world), head_lab (`generateFace(seed)`, mulberry32). The **shader/JS twin terrain** sub-pattern (bake terrain in WGSL, hand-mirror the noise in JS for gameplay "is this on land?" queries) recurs in planet_run and scape; hmsc solved the equivalent host-side (one height fn in mesh AND collider).

### 1.9 Bus-mediated keyboard (`busOn('__keydown'/'__keyup')`) — **~13/33**
Host pushes a **packed int** (keysym low 16 bits | modifier mask high 16) into `__ifttt_onKeyDown`; `useIFTTT.decodeKey` unpacks and fans out on the `__keydown`/`__keyup` JS bus; carts keep a `keysRef` boolean map polled by the tick. Discrete actions fire on the event through a latest-closure ref.
Docs: animation_lab (via input_bench backend), camera_lab, combat_lab (first to consume keyup), hmsc, hmsc_massive_map_lab, hmsc_scale_lab, hmsc-int, input_bench, physics_lab, planet_run, ragdoll_lab, scape, pathing_lab. Quirk recorded repeatedly: **Shift arrives as raw SDL keysyms** (`sdl:1073742049`) not `'shift'`, tracked by code + modifier flag (combat_lab, physics_lab, planet_run).

### 1.10 Offscreen-parking convention (`position:absolute; left:-99999`) — **~7/33**
Keep capture sources in the layout tree (so the host renders/caches them) but off the visible screen.
Docs: billboard_demo, carve_lab, game_item_gallery, hmsc_scale_lab, planet_run, ragdoll_lab, head_lab (with the extra "paintables must sit OUTSIDE flex flow or they take proportional-fallback space and blow up layout" footgun).

### 1.11 Overlays = root's last child (hit-test = paint order) — **~6/33**
Hit-test is sibling/paint order, not zIndex; full-area-absolute overlays must be the shell root's LAST children.
Docs: planet_run, scape, voxel_stack_demo, hmsc_scale_lab, hmsc-int (ProjectBar menus), combat_lab (implicitly via fx-last).

### 1.12 Bones-as-interface (the figure-stack lingua franca) — **~5/33**
`Record<BoneId, SkeletonBone>` is produced by 3 sources (animation `buildSkeleton`, physics `bonesFromRagdoll`, blend `blendBones`) and consumed by one sink (`buildRigFrameFromBones` → meshes+clothing+hitboxes+anchors). Mode switches swap only the producer.
Docs: head_lab (origin), ragdoll_lab, combat_lab, pathing_lab, planet_run. The hmsc humanoid has the same instinct one level up (skeleton → render parts AND hit capsules from one solve): hmsc, hmsc_scale_lab.

### 1.13 Verlet-in-cart physics (no host 3D rigid bodies) — **~3/33**
Position-based dynamics in TS (particles + distance constraints, relaxation passes, terminal-velocity clamp) as the standing answer to "the framework has no 3D physics."
Docs: ragdoll_lab (full detail), combat_lab, head_lab (`ragdoll.ts`). Justified explicitly against the dormant Bullet module (physics3d).

### 1.14 Workspace cart pattern (envelope + debounced autosave + snapshot undo) — **~4/33**
`useWorkspace` over an on-disk `SessionEnvelope`; 600ms debounced autosave; full-snapshot undo/redo; `commit()` vs `commitCoalesced()` (250ms) for discrete vs streaming mutations; `sessions/_last.txt` pointer; disk = truth.
Docs: cutout (origin), composer (second consumer, explicitly mirrors cutout's 7-file shape), hmsc-int (third consumer, v2 payload), pixel_icon_demo (in-memory miniature: FrameSlot + atomic history).

### 1.15 GPU-paint / readback-on-release (keep high-frequency input out of React) — **~4/33**
`usePaintable`/`Paintable` host R8 textures: brush dabs write straight to GPU at input rate, ONE `readback()` on stroke release commits to React; live overlay is an `<Effect>` sampling the paintable. Sibling: host latches (`'latch:key'` + `__latchSet`), and the ref-buffer + coalesced-flush of #1.2.
Docs: head_lab (paint + latches), cutout (Paintable layers), hmsc-int (`usePaintedField` coalesced GPU paint), pixel_icon_demo (hi-res mask in a ref).

### 1.16 Publish-the-world-once host service — **~3/33**
Cart authors data in JS, ships it via one bulk host call, host owns the hot loop; queries/patches after.
Docs: pathing_lab (`__path_set_grid` + A*), hmsc/physics_lab (`__hmsc_register_heightfield` + `__hmsc_physics_step`), hmsc_massive_map_lab (instanced-batch ship). All three named as the same shape in pathing_lab.

### 1.17 One-batch instancing (`Scene3D.Instances`, stride-9) — **~2/33**
Flatten every box-like thing into one stride-9 `[x,y,z, sx,sy,sz, r,g,b]` float stream on one unit-box `Scene3D.Instances` → one draw call; verts shipped once.
Docs: hmsc_massive_map_lab (city), voxel_stack_demo (voxel field, grouped by kind). Both note per-instance opacity is NOT in the stride-9 format (translucent kinds render opaque).

### 1.18 Producer/consumer cart pairs over shared disk/state — **~3/33**
Editor writes, viewer reads; the on-disk format is the channel.
Docs: pixel_icon_demo↔pixel_icon_gallery, hmsc-int↔hmsc (localstore boot key), cutout/composer (self-pairs via sessions).

---

## 2. NAMING / PLACEMENT LIES

Cases where a file's name or directory placement misleads a future reader about live-vs-dead, lab-vs-production, or ownership.

### 2.1 `framework/v8_bindings_physics_lab.zig` IS the live HMSC physics backend (GOLD-STANDARD CASE)
The file name reads as throwaway lab glue, but it contains the **production** `__hmsc_physics_step`, `__hmsc_register_heightfield`, `__hmsc_clear_heightfields` — the real game's 3D physics — alongside the actual lab fns (`__physics_lab_*`). "This lab is the proving ground that file graduated from."
Docs: physics_lab, physics3d, combat_lab, hmsc (consumes `__hmsc_physics_step` via `state/hostPhysics.ts`).

### 2.2 `framework/phys/physics3d.zig` is fully DORMANT (the inverse lie)
Named like serious framework physics (Bullet 3.25 rigid bodies); **wired to nothing** — never compiled in `build.zig`, no Node fields, no JS primitive, no host fn. Its own header comment describes `<3D.Physics>` and `Node.physics3d_world_id` that **do not exist** (Smith-era aspirational drift). The one collider hmsc needed — heightfield — is the one case it stubs to `null`.
Docs: physics3d (entire doc), ragdoll_lab + head_lab (cite it as the dead module justifying Verlet-in-cart).

### 2.3 `cart/hmsc/labs/ScaleLabScene.tsx` — orphaned near-verbatim copy, already drifted
A `*Scene.tsx` in hmsc's `labs/` re-implements the whole `hmsc_scale_lab` cart scene (MeterBlock/HeightLine/RulerTick/DoorFrame…), **imported by nothing**, and has already drifted (purple height line uses `PLAYER_VISUAL_TOTAL_HEIGHT 2.45m` where the cart uses `PLAYER_VISUAL_HEAD_TOP 2.04m`). Same name, same shapes, divergent values, no canonical owner.
Docs: hmsc_scale_lab (the find), hmsc (lists `labs/ScaleLabScene.tsx` as live).

### 2.4 `cart/ragdoll_lab/car.tsx` header comment is stale ("pathing_lab drives fleets of them")
`CarMeshes` claims shared use by pathing_lab, but pathing_lab now imports `buildVehicle` from `vehicle_lab/`; `CarMeshes` has exactly one consumer (ragdoll_lab itself).
Docs: ragdoll_lab, pathing_lab (confirms vehicle_lab import).

### 2.5 `cart/head_lab/animDsl.ts` is a one-line re-export shim of `cart/animationDsl.ts`
The "real" animation DSL lives at top-level `cart/animationDsl.ts`; `head_lab/animDsl.ts` is `export * from '../animationDsl'`. A reader in head_lab/ would assume the DSL is owned there.
Docs: animationDsl, head_lab, planet_run (imports the shim), vehicle_lab.

### 2.6 `cart/input_bench/…`'s "input bench" host backend is reused as production drive-mode movement
`v8_bindings_input_bench.zig`'s `__input_bench_*` movement integrator (named for a benchmark) is the **live drive-mode backend** in `animation_lab` ("Input bench: Zig-side WASD movement backend originally from input benchmarking, reused here for drive mode"). Also exports `__bench_now_us`, the µs clock physics_lab prefers.
Docs: animation_lab, input_bench, physics_lab.

### 2.7 `cart/hmsc-int/AGENTS.md` documents `MapCanvas.tsx` — file is now `PaintCanvas.tsx`
The cart's own agent contract names a file that has been renamed; doc drift inside the contract meant to prevent drift.
Docs: hmsc-int.

### 2.8 `useLuaWorker.ts` is "not a React hook despite its name" — it's an imperative object
Docs: input_bench.

### 2.9 `runtime/geometries/_baked.generated.ts` is committed EMPTY and restored after every ship
Reads like a populated build artifact; it's an always-empty seed (ship generates+restores it transiently), so a reader sees `BAKED = {}` and might assume baking is unused — it's just not persisted.
Docs: bake-geometry.

### 2.10 The `_old` / `index_old` / `backend_lua_old` / `*_old.ts` files (kept in-tree, not the active path)
Multiple carts keep prior-architecture snapshots in the live directory; only an import-graph check distinguishes them.
Docs: cutout (state_old/session_old/Editor_old/Inspector_old), input_bench (index_old, backend_lua_old), and the global `_old` convention (per repo CLAUDE.md). hmsc_massive_map_lab's dead `ChunkGround/ChunkRoads/BuildingMesh` (zero JSX usage) and pixel_icon_demo's vestigial Canvas editor (setter never called) are the un-suffixed equivalents.

### 2.11 `cart/scape/ui/Wheel.tsx` — orphan, but *documented* (the honest version)
Unlike #2.3, scape's unused `Wheel.tsx` is recorded as intentional in PROGRESS.md. Worth contrasting: same "unused file" smell, opposite hygiene.
Docs: scape.

---

## 3. DUPLICATED / PARALLEL SYSTEMS

### 3.1 TWO humanoid/figure systems (the single biggest convergence candidate)
- **head_lab `figureRender`/`parts`/`ragdoll`/`hed`**: sculptable `Geometry.Globe` parts, `.hed` faces, 25 named bones, oriented-box hitboxes, clothing/accessories, Verlet ragdoll. Consumers: planet_run, ragdoll_lab, combat_lab, pathing_lab, head_lab.
- **hmsc `render3d/humanoid`**: fixed primitive parts, baked face decals, 6 capsule hit zones, palette recolors, no physics. Consumers: hmsc, hmsc_scale_lab, hmsc_massive_map_lab (PlayerFigure).

Same concepts (bones, hitboxes, damage regions, gait, face-bake), two vocabularies. **Most telling drift: damage regions are `lArm/rArm/lLeg/rLeg` (ragdoll_lab) vs `armL/armR/legL/legR` (hmsc `DamageZone`)** — the same six-region model with reversed naming. combat_lab is where they're already being bridged (`boneZone()` renames head_lab bones into hmsc's zone vocab). No canonical winner declared; combat_lab is the de-facto convergence site.
Docs: ragdoll_lab (names it the biggest find), combat_lab, head_lab, planet_run, hmsc, hmsc_scale_lab.

### 3.2 TWO chance/hit-% engines
- **scape `systems/chance.ts`**: multiplier `ChanceBreakdown` (legible WHY), weapon `RangeProfile`, tile-grid LoS with glass-window shots.
- **hmsc `npc/systems/chance.ts`**: `hitChance({rangeMeters, coverFraction, …})`, the cover-fraction producer.

Both implement ground-truth-odds + display-warp split; different shapes/inputs; both in live *games*. Consolidation note (scape doc): scape's breakdown legibility is the richer surface, hmsc's cover-fraction is the richer input. combat_lab builds the missing `coverFractionOf` producer hmsc's chance.ts needs.
Docs: scape, combat_lab, hmsc.

### 3.3 THREE+ humanoid/part-cluster renderers (the "primitive-cluster character")
A character built from many primitive `Scene3D.Mesh` parts positioned by a solver appears re-implemented:
- bodylab `solveHumanoid`/`HumanoidFigure` (full `BodyProportions` system, 6 figures).
- camera_lab `HUMANOID` (18-part array) + `Figure`.
- input_bench `scene.tsx` `Figure` ("humanoid part table copied from camera_lab" — stated).
- animation_lab `AnimatedFigure` (hardcoded proportions, no shared model).
- hmsc/head_lab solved figures (the two stacks of #3.1).

camera_lab + input_bench share a copied part table verbatim; animation_lab notes it resembles a reusable primitive but isn't extracted; bodylab is the richest non-canonical one. Each doc flags "no shared humanoid package despite resembling one."
Docs: bodylab, camera_lab, input_bench, animation_lab.

### 3.4 Hand-rolled `screenRay` / camera-inverse picking duplicated 3+ times
The cameras registry exports `unprojectGround` (ground-plane only) but **not** the generic ray. So any non-ground pick re-rolls the view-basis math: voxel_stack_demo's `screenRay` (block-face picks), hmsc-int's `assist3d/picking.ts` screenRay, and the original it was lifted from (scape3d's projection). combat_lab/pathing_lab/camera_lab use the ground variant. Extraction candidate named in two docs: export `screenRay(sx,sy,rect,solved)` and make `unprojectGround` a consumer.
Docs: voxel_stack_demo, hmsc-int, camera_lab, pathing_lab, combat_lab.

### 3.5 `decodeMatrix` / `encodeMatrix` + `PixelMatrix` file-format — duplicated, no shared module
`decodeMatrix` is a near-verbatim copy in `pixel_icon_gallery.tsx` and `pixel_icon_demo.tsx`; `encodeMatrix` lives only in the demo; `PixelMatrix` is the lingua franca with 4 producers (matrix.ts ImageMagick parse, pixelMatrixFromSeed, editor edits, disk decode) and 2 renderers. Both docs name the same extraction: promote encode/decode + the `.64.json` filename convention into a shared `cart/pixel_icons/` module beside `matrix.ts`.
Docs: pixel_icon_gallery, pixel_icon_demo, carve_lab (shares `matrix.ts`/`parseTxt`).

### 3.6 Car / vehicle geometry & metrics fragmented across 4 places
ragdoll_lab's `CarMeshes` (visual) + its separate `CAR_HALF`/`CAR_CENTER_Y` collision constants (index.tsx) + vehicle_lab's `buildVehicle` car + `HMSC_SCALE.car` (4×2×1.5m vs ragdoll's ~3.7×1.8 chassis) + hmsc `render3d/structures/Car.tsx`. No single owner.
Docs: ragdoll_lab, vehicle_lab, hmsc_scale_lab (HMSC_SCALE.car), hmsc.

### 3.7 Color "darken a hex" / `mixHex` / `lerp3` / `clamp` / V3-math sprawl — re-rolled per file
- "darken a hex": `darkHex` (car.tsx), `darkShoe` (parts.ts), `darken` (hmsc face.tsx), `mixHex` (ragdoll index.tsx) — 4+ copies. (ragdoll_lab, head_lab, combat_lab adds two more `mixHex`/`hpColor`).
- `clamp` re-rolled in 4+ files in scape alone (player/chance/perception/world); also flagged repo-wide.
- `lerp3` defined twice within the ragdoll dependency chain; V3 helpers (`sub/len3/mid3`) re-rolled per lab.
Docs: ragdoll_lab, combat_lab, scape, head_lab, skybox_demo (its own hexToRgb/mixHex), planet_run.

### 3.8 Two authoring lanes inside hmsc-int (GameState mutators vs world-as-.tsx)
hmsc-int has the live "stage a GameState, Compile to boot key" lane AND a built-but-unwired `worldFile.ts`/`assets.ts`/`assetPrompt.ts` "world as a hand-editable .tsx importing asset components" lane awaiting the bake pipeline. Two authoring models coexisting; the coherence pass must reconcile.
Docs: hmsc-int.

### 3.9 Transform-hierarchy substitutes (`Part`/`ModelCtx`/`segmentPose`/`local()`) re-rolled
Because `Scene3D` has no parent/child transform nesting, multiple carts hand-roll a "bake parent transform into each mesh" helper: game_item_gallery `Part`, physics_lab `Part`/`ModelCtx`, animation_lab `segmentPose`, head_lab/ragdoll `place()/turn()`. Recurring evidence Scene3D "wants nested transforms or a shared part-composition helper."
Docs: physics_lab, game_item_gallery, animation_lab, ragdoll_lab.

### 3.10 fillShader.ts canonical-copy-but-authored-elsewhere
`cart/hmsc/render3d/fillShader.ts` is the canonical WGSL but authored in `effect_fills`; the board/material **seed coefficients are duplicated** (`fillData` in effect_fills vs `seedCoef` in textureShaders.ts) as a two-copy hand-synced invariant. Material-name tables exist in 3 copies (index.tsx, textureShaders.ts FILL_BOARDS, CATALOG.md).
Docs: effect_fills, hmsc.

---

## 4. CROSS-DOC CONTRADICTIONS

### 4.1 Stale mesh/instance caps (massive_map_lab vs hmsc's 3d.zig)
hmsc_massive_map_lab's diagnostics panel hardcodes `meshCap: 8192`, `nodeIndexCap: 4096`, but the doc notes `framework/gpu/3d.zig:170-171` now says `MAX_INSTANCES = 65536`, `MAX_SCENE_MESHES = 32768`. The lab's printed ceilings are stale/wrong (conservative). Trust host telemetry, not the labels.
Docs: hmsc_massive_map_lab.

### 4.2 `PLAYER_VISUAL_*` height constants disagree across the scale-lab triplet
Same purple "head top" line: `hmsc_scale_lab.tsx` draws it at 2.04m (`PLAYER_VISUAL_HEAD_TOP`), the orphan `hmsc/labs/ScaleLabScene.tsx` at 2.45m (`PLAYER_VISUAL_TOTAL_HEIGHT`). Both hand-transcribe from `skeleton.ts` geometry (a third copy). The skeleton doesn't export these, so the rulers silently lie if proportions change.
Docs: hmsc_scale_lab.

### 4.3 A doc documents a lesson another cart violates: `static_surface_inline_props_rebake`
billboard_demo *intentionally* uses inline `data={[tick*0.05]}` to force a per-frame StaticSurface rebake (animate-by-rebake), and explicitly warns copying that line into a static capture context causes the 40ms+ rebake bug. planet_run and hmsc-int's tileSurface document the **disciplined opposite** (memo'd capture + `useMemo`'d data/style, bake-once). The "lesson" and its deliberate violation coexist; a reader copying billboard_demo's pattern into the wrong place hits the bug head_lab/hmsc spent hunts on.
Docs: billboard_demo (the violation, intentional), planet_run (the discipline), hmsc-int, hmsc (tileSurface "stabilizes data/style identities to avoid rebakes").

### 4.4 In-shader comment supersedes the file header (pixel_icon_gallery)
ShaderPixelIcon's header comment claims y-inversion (citing `v8_app.zig:2251`); the in-shader comment explicitly says uv arrives top-down so no inversion is needed and supersedes the header. Stale header vs correct body inside one file.
Docs: pixel_icon_gallery.

### 4.5 SCALES label drift (pixel_icon_gallery)
Header comment says scale buttons are "1/2/3/4"; code (`SCALES = [1,2,3,4,6]`) includes 6. Minor, but a documented in-file disagreement.
Docs: pixel_icon_gallery.

### 4.6 physics3d header describes wiring that doesn't exist
The module header confidently describes `<3D.Physics>` and `Node.physics3d_world_id`; the doc verifies via grep that neither exists. "Trust grep over header comments" is the stated lesson. (Same class as 4.4 but cross-file: the comment contradicts the codebase reality.)
Docs: physics3d.

### 4.7 `solid: false` / `water` slots declared but never read
voxel_stack_demo's `BLOCKS[water].solid:false` is "declared but never read — dead field" (no physics to consume it); scape's `Player.simWalletId` and design.ts's entire zone/Case/quest vocabulary are types with no consumers. Not a contradiction between docs, but a recurring "table ahead of mechanics" the coherence pass must not read as wired. (combat_lab's `SHOOTER_SKILL`/`FIRE_COOLDOWN` carry explicit "graduate me to kinds.ts" eviction notes — the honest version.)
Docs: voxel_stack_demo, scape, combat_lab.

---

## 5. ISOLATED ONE-OFFS (could connect into a fundamental concept)

### 5.1 `onWheel` (zoom) — only voxel_stack_demo
First and only `onWheel` sighting; every other orbit cart zooms via keyboard (`+`/`-`) or a knob button. Wheel-zoom should join the standard orbit-camera shape (#1.6).
Docs: voxel_stack_demo (also notes onRightClick is scape-only — see 5.2).

### 5.2 `onRightClick`/`onContextMenu` — only scape
The action-menu primitive's trigger; scape is "the first cart in this series using it." The action menu itself (right-click → `availableActions` → contextual verb list with hit-%) is the load-bearing interaction primitive scape and combat_lab both want; only scape implements it.
Docs: scape, combat_lab (perception/interaction parallels).

### 5.3 Semantic interaction **anchors** (verb-accepting body/object points) — head_lab + vehicle_lab
head_lab's `anchorsFromSkeleton` (face_grab accepts `['grab_face','cover_mouth','shove']`) and vehicle_lab's `anchors` (driverSeat/gasPort/towRear/hoodLatch) are the *same shape* — named, role-tagged interaction points separate from mesh and hitbox — for two entity types. The interaction-targeting layer combat/scape want; not yet unified.
Docs: head_lab, vehicle_lab.

### 5.4 Off-thread LuaJIT scripting worker — only input_bench
A concrete off-thread script runtime (bounded string queues, explicit lifecycle, `dlopen` of libluajit). A candidate "game scripting" pattern, exercised in exactly one bench.
Docs: input_bench.

### 5.5 `<Render>` external-app capture (`app:kitty`, Xvfb) — only render_perf_lab
Bridges ReactJIT into external processes (virtual display + XShm capture). One-off, but the same string-keyed-source identity discipline as StaticSurface/textureKey (#1.3).
Docs: render_perf_lab.

### 5.6 Live LLM NPC (claude_code subprocess) — scape (+ hmsc-int chat, head_lab held-items unrelated)
scape's Roach is a shipped live-LLM NPC (`__worker_*`, roleplay prime, streamed bubbles, input gating). hmsc-int has the sibling `useAssistant` chat + assist3d backends. The agent-NPC ambition has exactly one in-game prototype.
Docs: scape, hmsc-int.

### 5.7 Provider-adapter + normalized-schema + injectable-transport + offline-smoke-harness — composer
composer's `sources/` is "the repo's most complete networking-integration template" (tri-state-null honesty, provenance-at-import, the only cart-local test suite). Built but UI-dark. Mirrors cutout's backend interface (#3 family) — could become the canonical networking-integration shape.
Docs: composer, cutout (backend interface sibling).

### 5.8 `new Function(...bindingNames, body)` user-scripting sandbox — composer
The EarSketch-flat compile sandbox (identifier-validated bindings, instrument-the-wrappers-for-UI). Directly reusable for the IF/THEN composer and any "user writes code that drives the engine" surface (game scripting). One implementation today.
Docs: composer.

### 5.9 Two-tolerance flood-fill wand — pixel_icon_demo
seed-tolerance + stricter step-tolerance to stop bleed across AA edges. Named as the wand algorithm "worth canonizing" for carve_lab and any mask tool.
Docs: pixel_icon_demo, carve_lab (cutout's flood backend is the sibling).

### 5.10 `Boxxx`/`RectBatch` batched-paint primitive — boxxx_demo only
Batches a box-only subtree into one instanced-rect emit. A real primitive (`<Boxxx>`), proven in one demo, box-only (no text/image/shadow). The 2D analog of #1.17.
Docs: boxxx_demo.

### 5.11 Diegetic 3D UI (mesh-as-HUD) — planet_run
The compass is a `Geometry.Cone` mesh in the scene positioned by gameplay math, not a HUD element. A one-off worth generalizing (in-world markers/indicators).
Docs: planet_run.

---

## 6. CONCRETE RECOMMENDATIONS

Renames, extractions, taxonomy fixes, and loud-status-comment additions. Ordered by impact.

### Renames / loud status comments
1. **Split `framework/v8_bindings_physics_lab.zig`** into honest `v8_bindings_hmsc_physics.zig` (the live `__hmsc_*` production backend) vs `v8_bindings_physics_lab.zig` (the `__physics_lab_*` toy). The current single file makes the live game physics look like lab scaffolding. (physics_lab, physics3d, hmsc)
2. **Mark `framework/phys/physics3d.zig` DORMANT loudly** — top-of-file banner `// DORMANT: never compiled, never wired. The header below describing <3D.Physics>/Node.physics3d_world_id is Smith-era fiction — those do not exist.` Or rename to `bullet3d_dormant.zig`. Delete-vs-keep is a user decision; either way the aspirational header comment must go. (physics3d)
3. **Rename `cart/hmsc-int/MapCanvas.tsx` reference in its own `AGENTS.md`** to `PaintCanvas.tsx` (the file already renamed; the contract lags). (hmsc-int)
4. **Add a loud "LIVE PRODUCTION, despite the name" comment** to `v8_bindings_input_bench.zig`'s movement integrator and `__bench_now_us`, since animation_lab/physics_lab depend on them as production. (animation_lab, input_bench, physics_lab)
5. **Reconcile the `ScaleLabScene.tsx` orphan**: either delete `cart/hmsc/labs/ScaleLabScene.tsx` or make it the single shared scene `hmsc_scale_lab.tsx` imports — it has already drifted (2.04 vs 2.45). (hmsc_scale_lab, hmsc)
6. **Fix or delete stale comments**: ragdoll_lab `car.tsx` header ("pathing_lab drives fleets"), pixel_icon_gallery's y-inversion header + SCALES "1/2/3/4", massive_map_lab's `meshCap 8192`/`nodeIndexCap 4096` panel labels. (ragdoll_lab, pixel_icon_gallery, hmsc_massive_map_lab)

### Extractions (kill duplication)
7. **Export `PLAYER_VISUAL_*` / figure extremes from the humanoid module** so rulers and capsule visualizers derive from the body instead of hand-transcribing (kills the 2.04/2.45 drift). The module already exports hitbox numbers. (hmsc_scale_lab)
8. **Extract `cart/pixel_icons/format.ts`** owning `encodeMatrix`/`decodeMatrix` + the `.64(.anim).json` filename convention; import from both pixel_icon carts. (pixel_icon_gallery, pixel_icon_demo)
9. **Export `screenRay(sx,sy,rect,solved)` from `@reactjit/cameras`** and make `unprojectGround` a consumer; retire the 3 hand-rolled copies (voxel_stack_demo, hmsc-int/picking, scape3d projection). (voxel_stack_demo, hmsc-int)
10. **One color utility** (`darken`/`mixHex`/`hpColor`) — 4+ copies across car.tsx, parts.ts, face.tsx, ragdoll, skybox_demo. Plus one V3/`clamp`/`lerp3` math module (re-rolled in scape ×4, every lab). (ragdoll_lab, combat_lab, scape, head_lab)
11. **Move the board/material/seed tables out of `effect_fills/index.tsx`** into the one module both `fillData` (cart) and `seedCoef` (textureShaders.ts) import, ending the hand-synced two-copy invariant; collapse the 8 near-identical `*Column` components into one parameterized component. (effect_fills)
12. **Promote `cart/animationDsl.ts`** as the canonical name and treat `head_lab/animDsl.ts` purely as the documented shim (or drop it and re-point consumers). (animationDsl, head_lab)
13. **A shared part-composition helper or Scene3D nested transforms** to retire `Part`/`ModelCtx`/`segmentPose`/`place()` re-rolls. (physics_lab, game_item_gallery, animation_lab, ragdoll_lab)
14. **A `useGameLoop` hook** packaging scheduler-guard + dt-clamp + tick-counter + ref-mirror — the #1.1/#1.2 pattern is in ~10 carts verbatim. (ragdoll_lab proposes it)

### Taxonomy / convergence fixes
15. **Pick a canonical humanoid stack** (head_lab figure vs hmsc humanoid) and a single six-region damage vocabulary — `armL/legL` (hmsc) vs `lArm/lLeg` (head_lab) is the same model spelled two ways. combat_lab is already the bridge; bless it as the convergence site and unify the zone names there. (ragdoll_lab, combat_lab, head_lab, hmsc)
16. **Reconcile the two chance engines** (scape `ChanceBreakdown` vs hmsc `hitChance`/coverFraction) before a third appears; the scape doc proposes keeping scape's breakdown legibility + hmsc's cover-fraction input. (scape, combat_lab)
17. **Decide the "real physics" direction consciously**: revive the dormant Bullet module (implement its stubbed heightfield) OR commit to extending the hmsc bespoke sim. Verlet-in-cart is the current de-facto answer. (physics3d, ragdoll_lab, head_lab)
18. **Add a binary FS host fn** (`__fs_write_bytes`/`__fs_copy`): the "third sighting" of the UTF-8-only-`writeFile` workaround (cp shell-out in composer, P5-maxval-1 PNM trick in pixel_icon_demo, PGM gymnastics in cutout) is overdue to delete. (composer, pixel_icon_demo, cutout)
19. **Name the "see-it == hit-it / solve-once-derive-everything" principle** as a project doctrine: rendered thing IS tested thing (combat_lab: cover boxes = ray AABBs, hitboxes = damage surface, camera axis = bullet line), terrain see-it==walk-it (hmsc), skeleton solve → mesh AND hitbox (hmsc/head_lab). combat_lab explicitly asks for this to become a named principle. (combat_lab, hmsc_scale_lab, hmsc)
20. **Distinguish implemented vs declared in design-first carts** (scape's design.ts is far ahead of code; hmsc-int's two authoring lanes; voxel `solid`; composer's dark sources). The coherence pass must not read declared types as wired. (scape, hmsc-int, voxel_stack_demo, composer)

---

### Appendix: doc → primary recurring shapes (quick index)
- **animationDsl / animation_lab**: DSL, procedural pose, parts-cluster figure, input-bench reuse.
- **bake-geometry / geometry_demo**: geometry registry + intern key + empty-seed lie.
- **billboard_demo**: StaticSurface→textureKey canonical, rAF-probe, inline-data rebake hazard.
- **bodylab / camera_lab / input_bench**: parallel parts-cluster humanoids; camera registry.
- **boxxx_demo**: Boxxx/RectBatch batched paint (one-off).
- **carve_lab / cutout / pixel_icon_***: PixelMatrix lingua franca, paintable/readback, subprocess orchestration, format duplication.
- **combat_lab**: the convergence dress rehearsal (two figure stacks + two shot paths + perception).
- **composer**: workspace pattern, new-Function sandbox, provider-adapter networking template.
- **effect_fills**: mega-shader-with-selector, seed-coef duplication.
- **head_lab**: the character subsystem hub + 12 named recurring shapes.
- **hmsc / hmsc-int**: registry-driven everything, command-first state, author-with-the-game's-own-code, StaticSurface texture system.
- **physics3d / physics_lab**: the gold-standard naming lies (dormant vs live).
- **planet_run / scape / shitcoin / voxel_stack_demo**: the games + game-shaped toys; world-as-transform, world-as-shader-quad, hot/cold sim split, instancing.
- **ragdoll_lab / pathing_lab / vehicle_lab**: figure systems integration, host A*/deterministic motion, semantic part/anchor contracts.
- **render_perf_lab / hmsc_massive_map_lab / hmsc_scale_lab / skybox_demo**: measurement labs + the "lab draws a contract" pattern + stale-constant drift.
