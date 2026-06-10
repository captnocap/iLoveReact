# CONSENSUS — five independent recurrence reports, tallied

**Method:** 5 agents, identical instructions, each independently read all 33 docs in `docs/game/` and wrote a full report (`recurrence-report-{1..5}.md`). Same inputs, no shared state — so agreement across reports is signal, not echo. This file tallies the findings by how many of the 5 reports independently surfaced each one. 5/5 means every investigator found it without being told.

---

## TIER 1 — UNANIMOUS (5/5). This is the work queue.

### A. The physics naming inversion (the human-confirmed gold standard) — 5/5
`framework/v8_bindings_physics_lab.zig` contains the LIVE hmsc physics backend (`__hmsc_physics_step`, `__hmsc_register_heightfield`, `__hmsc_clear_heightfields`, consumed by `cart/hmsc-int/state/hostPhysics.ts`); `framework/phys/physics3d.zig` is fully-implemented Bullet wired to NOTHING, with a header describing `<3D.Physics>`/`Node.physics3d_world_id` that don't exist. All five reports independently sharpened the same irony: **the heightfield collider hmsc needed is the one case physics3d stubbed `null` while the "lab" file implemented it first-class.**
**Fix (all 5 agree):** split the bindings — `v8_bindings_hmsc_physics.zig` (live) vs the lab toy; mark physics3d DORMANT loudly (or rename `bullet3d_dormant.zig`) and delete its lying header; record that Verlet-in-cart (`head_lab/ragdoll.ts`) is the de-facto 3D physics so a future effort chooses consciously.

### B. The humanoid duplication — 5/5, with the same smoking gun in all five
Two load-bearing figure stacks: head_lab's (`parts.ts`/`figureRender` — Globe parts, .hed faces, 25 bones, box hitboxes, clothing, Verlet ragdoll; consumers: planet_run, ragdoll_lab, combat_lab, pathing_lab) vs hmsc's (`render3d/humanoid/` — primitive parts, face decals, 6 capsule zones; consumers: hmsc + its labs). Reports 2 & 4 extend the count to FOUR+ by including bodylab's own `solveHumanoid` and the inline parts-arrays copied across animation_lab/camera_lab/input_bench ("copied from camera_lab" is in the source).
**The smoking gun all 5 found:** the SAME six-region damage model spelled in reverse — `lArm/rArm/lLeg/rLeg` (head_lab side) vs `armL/armR/legL/legR` (hmsc `DamageZone`) — with combat_lab's `boneZone()` as the half-done bridge.
**Fix:** unify the damage vocabulary FIRST (cheap, unblocks), then converge on one stack. Convergence signal across reports: head_lab kit = richer authoring (sculpt/faces/clothing/ragdoll); hmsc humanoid = cleaner runtime contract (one solve → mesh AND hitbox). combat_lab is the blessed merge site. Retire bodylab's third solver + the inline copies.

### C. The fundamental concepts, ranked by recurrence (counts averaged across reports)
These are the shapes to consolidate around — the user's "most reoccurring = most fundamental" tally:

| Rank | Shape | ~Count | Canonical reference |
|---|---|---|---|
| 1 | Scene3D mesh path + geometry registry/intern + unit-params rule | 16–22/33 | geometry_demo, bake-geometry |
| 2 | rAF-probe → setTimeout(16) loop (+ editor `setInterval` split) | 17–19/33 | every game cart; head_lab names the split |
| 3 | Bus-mediated input (packed-int keydown, keysRef polled, pointer-capture, pull-based mouse) | 13–14/33 | hmsc_scale_lab (fullest trace) |
| 4 | StaticSurface→textureKey 2D-on-3D bridge (+ rebake discipline) | 9–13/33 | billboard_demo |
| 5 | Sim-in-refs + setTick render trigger + uiRef mirror | 10–12/33 | ragdoll_lab |
| 6 | Effect quad + flat-f32 storage buffer (+ mega-shader-with-selector) | 11–12/33 | effect_fills, scape |
| 7 | Registry-driven kinds ("struct stores kind, registry gives meaning") | 9–12/33 | hmsc, combat_lab |
| 8 | Camera pure-solve registry (vs hand-rolled trig holdouts) | 10–14/33 | camera_lab |
| 9 | Keep-high-frequency-input-out-of-React family (latches/paintables/ref-flush) | 7–10/33 | head_lab |
| 10 | Seeded-PRNG deterministic worlds | 5–8/33 | hmsc_massive_map_lab, planet_run |
| 11 | Bones-as-interface (3 producers, 1 sink) | 5–6/33 | head_lab ragdoll seam |
| 12 | Workspace cart (envelope/autosave/snapshot-undo) | 3–4 consumers | cutout |
| 13 | Publish-the-world-once host services | 3–5/33 | pathing_lab names the family |
| 14 | One-batch instancing stride-9 (+ 2D sibling Boxxx) | 3/33 | hmsc_massive_map_lab |
| 15 | Ground-truth vs display-warp law | 3–4/33 | scape chance/perception |

**Unanimous extraction:** a `useGameLoop` hook (scheduler-guard + dt-clamp + tick-counter + ref-mirror) packaging ranks 2+5 — proposed by name in all five reports.

### D. Unanimous secondary naming/placement lies — 5/5 each
- `v8_bindings_input_bench.zig` — "bench" file is animation_lab's LIVE drive-mode movement integrator (+ `__bench_now_us`, the preferred µs clock). Needs a loud "LIVE PRODUCTION" header.
- `cart/hmsc-int/labs/ScaleLabScene.tsx` — orphaned near-verbatim copy, zero importers, already drifted (purple line 2.45m vs the live cart's 2.04m). Delete or canonicalize.
- `cart/ragdoll_lab/car.tsx` header — claims "pathing_lab drives fleets"; pathing_lab uses vehicle_lab. One consumer.
- `cart/hmsc-int/AGENTS.md` — names `MapCanvas.tsx`, file is now `PaintCanvas.tsx` (drift inside the contract meant to prevent drift).
- Dead-but-live-looking code: massive_map_lab's `ChunkGround/ChunkRoads/BuildingMesh` trio (zero JSX usage, duplicates the live batch recipe), pixel_icon_demo's vestigial Canvas editor.
- The stale caps: massive_map_lab prints `meshCap 8192`/`nodeIndexCap 4096`; live values are 32768/65536.

### E. Unanimous duplications (beyond humanoids) — 5/5 each
- **Two chance engines** (scape `ChanceBreakdown` legibility vs hmsc `hitChance`+coverFraction input) — merge keeps scape's surface + hmsc's input; combat_lab's `coverFractionOf` is the missing producer hmsc already expects.
- **`screenRay` re-rolled 3×** (voxel_stack, hmsc-int/picking, scape3d origin) because `@reactjit/cameras` exports only `unprojectGround` — export the generic ray, make unprojectGround a consumer.
- **Vehicle/car fragmentation across 4+ sources** (`CarMeshes`, `CAR_HALF` constants, vehicle_lab `buildVehicle`, `HMSC_SCALE.car`, hmsc structures/Car.tsx) — winner: vehicle_lab's semantic `VehicleDoc` rig.
- **Utility sprawl:** hex-darken ×4+ (`darkHex`/`darkShoe`/`darken`/`mixHex`/`hpColor`), `clamp` ×4 in scape alone, `lerp3` twice in one dependency chain, V3 helpers per-file, `decodeMatrix` verbatim ×2 (pixel-icon codec wants extraction).
- **`__fs_write_bytes`/`__fs_copy` host fn overdue** — three independent sightings of the UTF-8-only `writeFile` workaround (PNM/P5-maxval-1 trick, `cp` shell-outs, PGM gymnastics).
- **`_old`-file family** — sanctioned breadcrumbs, but live-vs-dead requires an import trace, not a name read; audit pass wanted.

---

## TIER 2 — STRONG (3–4/5)

- **ModelCtx/Part transform-hierarchy workaround** re-rolled in 5+ carts because Scene3D has no nested transforms — add nesting or one shared `placeLocal`/Part helper (4/5).
- **`useLuaWorker.ts` is not a hook** — imperative object wearing a `use*` name (4/5).
- **Boxxx/RectBatch** as the 2D sibling of Scene3D.Instances — one "batch N identical primitives" story across 2D/3D (4/5).
- **Render app-capture** (Xvfb/`app:kitty`) and **provider-adapter networking template** (composer `sources/`) as proven one-offs awaiting consumers (4/5 each).
- **Live-LLM NPC** (scape Roach) + **assist3d authoring** (hmsc-int) = same `useAssistant`/`__worker_*` infra, one "agent-driven content" capability (5/5 mentioned, 4/5 as connectable).
- **Two-tolerance flood fill** (pixel_icon_demo) wanted by carve_lab/cutout (4/5).
- **see-it==hit-it doctrine** — name it as a project principle (rendered thing IS the tested thing: cover boxes = ray AABBs, terrain mesh = collider, camera axis = bullet line) (4–5/5).
- **`PLAYER_VISUAL_*` hand-transcription** — export figure extremes from the humanoid module so rulers derive instead of copy (the 2.04/2.45 root cause) (4/5).
- **fillShader.ts placement** — canonical WGSL lives game-side but is authored in effect_fills; the `seedCoef` tables are a hand-synced two-copy invariant (3/5).
- **YXZ euler-order knowledge** (`T·Ry·Rx·Rz·S`) is load-bearing and lives only in scattered cart comments — needs one canonical home + a shared host-order-aware `eulerFromQuat` (3/5).
- **Animation DSL as the one animation path** — animation_lab's `poseFor` and bodylab's `drivePose` predate it; the DSL's alias table already speaks body+vehicle+face (3/5).
- **hmsc-int's two authoring lanes** (GameState mutators vs world-as-.tsx bake lane) must be reconciled (3/5).
- **Semantic anchors** (head_lab body verbs + vehicle_lab ports) = one interaction-targeting layer for scape/combat action menus (3/5).
- **Per-instance opacity missing from stride-9** — translucent kinds render opaque in both instancing carts (3/5).
- **`head_lab` name undersells** — it's the whole-body character subsystem; `_lab` suffix systematically undersells production proving grounds (combat_lab, pathing_lab) (2–3/5).

## TIER 3 — single-report uniques worth keeping (not consensus, but sourced)

- ScaleLabScene live-vs-dead is itself a **cross-doc contradiction**: `hmsc.md` lists it live, `hmsc_scale_lab.md` grep-proved it orphaned (report 3).
- combat_lab's perception ladder + scape's consequence vocabulary (WitnessMemory/Case) are **two halves of one detective loop that haven't met** (report 3).
- The ADS aim rig is the only camera that can aim above the horizon — fixes hmsc's measured "aim ceiling"; absorb into the cameras registry (reports 2, 5).
- `_baked.generated.ts` committed empty by design — reads as "baking unused" (report 1).
- Import-path convention split: `@reactjit/primitives` vs `@reactjit/runtime/primitives` (report 5).
- shitcoin's hot/cold sim facade, effect_fills' quality-grade-as-artistic-knob, scape's heightfield-march extrusion, physics_lab's kickSpin + variable-jump recipes (reports 2, 4, 5).

---

## DIVERGENCES (where the five disagreed — ambiguity to resolve, not noise)

1. **Humanoid system count:** 2 (reports 1, 3, 5 — counting load-bearing stacks) vs 4+ (reports 2, 4 — counting bodylab + inline copies). Resolution: 2 stacks to converge, 3 informal copies to delete.
2. **Pattern counts vary ±4** (e.g. geometry registry 16–22) — different judges drew the "mentions it" line differently; the *ranking* is stable across all five, the absolute counts are soft.
3. **Scene3D itself**: reports 3 & 4 count it as the #1 pattern (~22–24/33); reports 1, 2, 5 treat it as substrate and don't rank it. Either way it's the universal floor.
4. **Winner of the humanoid merge**: report 4 says undecided; reports 3 & 5 lean "head_lab geometry + hmsc damage vocabulary"; report 2 says combat_lab's hybrid IS the answer. No report picks hmsc's stack wholesale.

---

## THE PRIORITIZED QUEUE (consensus-ordered, smallest-first within tiers)

**Cheap honesty fixes (do in one pass):**
1. Split `v8_bindings_physics_lab.zig` → `v8_bindings_hmsc_physics.zig` + lab toy; loud DORMANT banner on (or rename of) `phys/physics3d.zig` + delete its fictional header.
2. Loud "LIVE PRODUCTION" header on `v8_bindings_input_bench.zig`'s movement surface.
3. Fix the four stale claims: `car.tsx` header, `AGENTS.md` MapCanvas→PaintCanvas, massive_map_lab's 8192/4096 labels, pixel_icon_gallery's header drift.
4. Delete (or toggle-gate) the dead code: massive_map_lab trio, pixel_icon_demo vestigial editor, `ScaleLabScene.tsx` orphan.

**Small extractions (each kills a sprawl):**
5. Export `screenRay` from `@reactjit/cameras`.
6. One color utility + one V3/clamp/lerp3 math module.
7. Pixel-icon codec module (`encode`/`decode` + `.64.json` convention).
8. `__fs_write_bytes` host fn (binding + JS shim).
9. Export `PLAYER_VISUAL_*` extremes from the humanoid module.
10. `useGameLoop` hook.

**Structural convergences (each is a real project):**
11. Damage-zone vocabulary unification (`lArm`↔`armL`) → then the humanoid merge at combat_lab.
12. Chance-engine merge (scape surface + hmsc/combat_lab input).
13. Vehicle module consolidation around vehicle_lab's semantic rig.
14. Scene3D nested transforms (or blessed Part helper).
15. hmsc-int authoring-lane decision.

**Doctrine to write down (zero code):**
16. see-it==hit-it; ground-truth-vs-display; the YXZ order; "rAF-probe = game, interval = editor"; implemented-vs-declared labeling for design-first files.
