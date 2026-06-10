# ragdoll_lab cart inventory

Source cart: `cart/ragdoll_lab/` (`index.tsx` + `car.tsx`)

Reviewed: 2026-06-04

## High-level purpose

`ragdoll_lab` answers one gameplay question end-to-end: **when something hits the body — where did it hit, how hard, and what does the body do about it?** It composes three systems around the head_lab figure:

1. **Hitbox damage** — every bone of the figure carries an oriented box hitbox (`BodyRigFrame.hitboxes`); a launched car is AABB-tested against each bone, hits map to one of six damage regions (head/torso/arms/legs) with per-region HP, multipliers, and a kill log.
2. **Ragdoll physics** — a pure-JS Verlet particle solver (`head_lab/ragdoll.ts`): joints become particles, bones become distance constraints. On impact the live animated pose seeds the particles mid-stride, the car's velocity becomes joint impulses, and the *entire dressed figure* (sculpted parts, clothing, cap, hitboxes) tumbles, because the render path is bones-driven all the way down.
3. **Recovery** — when the ragdoll settles (and no region is at 0 HP), the landed pose blends back to a standing pose over 0.85s and the walk animation resumes where the body fell. K.O. (any region at 0) keeps the body down until healed.

Stimuli: launch a car at adjustable speed (15–110 km/h, from either side), an uppercut, a trip. Auto slow-motion on impact (time-scale 0.22 for ~1.1s). Drag-orbit camera that follows the body. The cart writes nothing to disk and makes zero direct host calls — the whole simulation is JavaScript; the host only renders meshes and delivers input.

This is a *systems rehearsal* for the actual game: locational damage, animation→physics handoff, physics→animation recovery, and impact presentation (slow-mo, flash, K.O. banner) are all game-event mechanics being proven in isolation.

## Files touched by this behavior

The cart:

- `cart/ragdoll_lab/index.tsx` (583 lines): damage model, sim state machine, the frame loop, car collision, UI (controls column, damage diagram, hit log), orbit input, scene composition.
- `cart/ragdoll_lab/car.tsx`: `CarMeshes` — the boxy sedan as 9 `Scene3D.Mesh`es (chassis, cabin, glass with `opacity: 0.85` riding the transparent pass, 4 cylinder wheels, 2 headlights). Pure visual; the collision box lives in `index.tsx`.

The head_lab modules it consumes (head_lab is the editor; these are its game-consumption surface):

- `cart/head_lab/parts.ts` (1425 lines): the figure definition. Used here: `buildSkeleton(shape, pose, phase)` → `Record<BoneId, SkeletonBone>` (25 bones, each `{position, rotation, scale, thickness, hitbox}`), and `buildRigFrameFromBones(bones, 'neutral', 'tee', 'plain', ['cap'], 'jeans')` (line 1317) → `BodyRigFrame {bones, assembly, anatomy, clothing, hitboxes, anchors}`. The comment at line 1312 names the design seam: every downstream layer is bones-driven, so a physics solver only has to produce bone positions/rotations and the whole dressed figure follows.
- `cart/head_lab/ragdoll.ts` (355 lines): the Verlet solver + the bone-record utility belt (`offsetBones`, `placeBones`, `blendBones`, `bonesFromRagdoll`). Detailed below.
- `cart/head_lab/hed.ts`: `.hed` face documents. `generateFace(seed, {style:'masculine'})` (line 338) procedurally authors a face doc; `hedDepthGrid(doc)` (line 153) flattens its layers+sculpt to the 48×24 signed depth grid the head mesh displaces by.
- `cart/head_lab/figureRender.tsx` (211 lines): the shared "put a head_lab figure in a game cart" kit — `buildPartRender` (Globe params + dyn/texture keys per part), `CharacterCaptures` (offscreen StaticSurface bakes), `FigureMeshes` (the rig as Scene3D meshes).

Runtime modules:

- `runtime/cameras/` (`@reactjit/cameras`): `OrbitCamera` — the registry rig. `rigs/orbit.ts` is a pure `solve({target,yaw,pitch,dist,zoom,fov}) → {pos,target,fov}`; `index.tsx:60-65` wraps it as a component emitting one `<Scene3D.Camera>`.
- `runtime/hooks/useIFTTT.ts`: `busOn('__keydown', ...)` for the l/u/t/h/r hotkeys (same packed-int SDL3→bus path documented in `docs/game/hmsc_scale_lab.md`).
- `runtime/primitives.tsx`: `Box/Col/Row/Pressable/Text/Scene3D`; the `Scene3D.Mesh` dynamicKey path (lines 571–663) carries the figure's sculpted Globe parts; the `material={{color, opacity}}` object form (line 544) routes hitbox tint and car glass through the host's transparent pass.
- `runtime/geometries/`: `Geometry.Box/Cylinder` (scene dressing, car), `Geometry.Globe` (every body part, via figureRender), `Geometry.Sphere/Cone` (clothing instances).

Host machinery (reached only through primitives/events — the cart calls none of it by name): `v8_app.zig` mouse handler installation + `scene3d*` props; `framework/gpu/3d.zig` (mesh pipeline, dyn slots, transparent pass); `framework/engine.zig` keydown push.

## Host functions vs JavaScript functions

**Everything that thinks is JavaScript.** The Verlet integration, constraint relaxation, ground/wall collision, AABB hit-testing, damage rolls, pose blending, face generation, depth-grid math, orbit solve — all plain JS executing in V8 every frame. The host contributes rendering, input delivery, and timers:

- **Frame loop**: `useEffect` (line 310) builds the scheduler as `host.requestAnimationFrame ? rAF : (fn) => setTimeout(fn, 16)`. On this host **rAF does not exist** (grep confirms no binding in `v8_app.zig`/`runtime/index.tsx`), so the cart always runs on `setTimeout(fn, 16)` — the sanctioned game-loop idiom. Time comes from `host.performance?.now?.() ?? Date.now()` (performance.now exists on this host). `dtReal` is clamped to [0.001, 0.05]s so a hitch can't explode the sim.
- **Keyboard**: `busOn('__keydown')` — host pushes a packed int, JS decodes and fans out. Handlers read through `actionsRef.current` (refreshed every render, line 294-295) so the one-time subscription never goes stale — the standing stale-closure dodge.
- **Pointer orbit**: `onMouseDown/Move/Up` all on the same full-scene `Pressable` (pointer-capture idiom); coordinates pulled from host `getMouseX/getMouseY` at dispatch (see hmsc_scale_lab.md for the full path).
- **Why JS physics at all**: the header of `ragdoll.ts` states it — the host's `<Physics>` is Box2D, 2D only; there are no 3D rigid bodies or joint constraints in the framework. The Verlet solver is the zero-host-changes answer. 15 particles × 24 constraints × 6 relaxation iterations per frame is trivial for V8.

## The sim architecture (ref-held state + tick-counter renders)

All simulation state lives in **one mutable object behind a ref** (`simRef`, type `Sim`, line 114): mode, clocks, ragdoll, car, HP, hit log, camera target. React state holds only UI knobs (yaw/pitch/dist, speed, toggles) and a frame counter — `const [, setTick] = useState(0)` whose only job is `setTick(t => t+1)` at the end of every loop tick (line 431) to force a render. UI values the loop needs are mirrored into `uiRef` by an effect (line 236) so the closed-over tick function reads live values. This **"sim in refs, render by counter"** shape is the standing pattern for game loops in this runtime (the loop closure can't see fresh React state, and per-frame `setState` of a big object would churn the reconciler).

The per-frame order (lines 317–433): clock → choose `dt` (slow-mo scales it) → derive `bones` for this frame (by mode) → car motion + collision → physics step + settle detection → camera-target chase → `setTick`.

### Mode machine

`mode: 'anim' | 'ragdoll' | 'recover'` — three sources for the same `Record<BoneId, SkeletonBone>`:

- **anim**: `buildSkeleton('neutral', walking ? 'walk' : 'stand', gaitPhase)` offset to `origin` via `offsetBones`. The gait phase advances 1.5/s of *scaled* time, so slow-mo slows the walk too.
- **ragdoll**: `bonesFromRagdoll(ragdoll)` — bones rebuilt from particles every frame.
- **recover**: `blendBones(recoverFrom, recoverTarget, smoothstep(t))` over `RECOVER_SECONDS` 0.85; at t≥1, back to anim.

The frame's bones are stashed in `lastBonesRef` — that's the **handoff buffer**: `enterRagdoll()` seeds `createRagdoll(lastBonesRef.current)` from whatever pose was last rendered, which is what makes a mid-stride hit look continuous.

### Damage model

Six regions (`head/torso/lArm/rArm/lLeg/rLeg`), 100 HP each. `boneRegion()` (line 65) maps the 25 `BoneId`s to regions by name pattern (arm-segment names list + l/r prefix). Damage = `carSpeed(m/s) × REGION_MULT × rand(0.9–1.2) × 1.35`, head ×1.7, arms ×0.65, legs ×0.8 (line 62). **Once per region per launch**: `regionsHit` resets on each launch, so a car shredding through 8 leg bones charges the leg once. Uppercut is a flat head −12. HP≤0 in any region = K.O.: recovery is suppressed, banner shows, only HEAL revives. The hit log is a 6-entry ring of strings.

### Car + collision

The car is sim-side a moving AABB: `CAR_HALF = [1.85, 0.7, 0.95]` (x-major — it always drives down the x-axis road), center fixed at y=0.7, spawned at `x = ∓19` toward the body's current z, despawned past |x|>21. Each frame every bone is tested box-vs-box: bone half-extents from `bone.hitbox` (+0.05 skin) vs car halves (lines 347–355). Note the collision box never rotates — only ±x travel exists, and the *visual* car (`CarMeshes yawDeg={dir*90}`) is rotated so its long (z) axis lies along x, matching the collision box. The collision/visual split is explicit: physics in `index.tsx`, looks in `car.tsx`.

On hit: enter ragdoll (seeded from the current pose), slow-mo window opens, each struck bone kicks its mapped ragdoll joints (`BONE_JOINTS`, line 73 — e.g. a forearm hit kicks elbow+hand) with the car's velocity plus an upward lift and lateral scatter (lines 375–380). Then the **hood-carry rule** (lines 386–399): any joint still inside the car box is teleported just ahead of the bumper and shoved — that's what makes the body ride the hood instead of clipping through.

### The Verlet solver (`head_lab/ragdoll.ts`)

15 joints (`JointId`), each a particle with `pos`/`prev` (velocity is implicit position history). 24 distance constraints (`CONSTRAINT_DEFS`): stiff spine/girdles/limbs, soft cross-braces (pelvis↔head 0.55, head↔shoulders 0.45) to stop the torso shearing and the skull folding through the chest. Per-joint mass (trunk 2.4–2.6, hands 0.4) weights constraint corrections so the trunk drags the limbs. Per step: integrate (gravity −10.5, air damping 0.995, **per-step displacement clamped to 32 m/s** — impulses stack, and unbounded Verlet launched the body out of the world on the lab's maiden flight, per the comment at line 167), 6 relaxation passes, ground plane at each joint's collision radius with restitution 0.3 + friction (keep 55% tangential), optional soft **arena walls** (`arenaHalf` — the cart passes 15.5 to keep uppercut-juggled bodies on the platform).

Key contracts:

- `createRagdoll(bones)`: particle positions from the live pose; **rest lengths from the canonical stand skeleton** (`buildSkeleton('neutral','stand')`) — joint distances are pose-invariant for rigid bones, so a mid-punch handoff never snaps segment lengths.
- `ragdollImpulse(r, joint, v, dt)`: implemented as `prev -= v·dt`. The cart's loop comment (line 403) preserves the hard-won rule: impulses and `stepRagdoll` must use the **same dt** — mismatched dt silently rescales every kick (slow-mo would otherwise change impact energy, not just playback speed).
- `bonesFromRagdoll(r)`: rebuilds all 25 bones from 15 particles — orientations are just "+Y along the joint-to-joint line" (`alignY`; limbs are radially symmetric pipes, so no twist tracking), positions interpolate along segments (forearm at 0.42 of elbow→hand, wrist at 0.85), scale/thickness/hitbox copied from the stand-pose template, feet flattened to 0.35 of the shin pitch because "the foot block reads better".
- `ragdollMaxMotion` < 0.0025 for 55 consecutive ticks (car gone, not K.O.) → recovery: `origin` moves to the pelvis landing point, blend begins. `ragdollCenter` = pelvis.

### Figure pipeline (built once, rendered every frame)

`useMemo` (line 238): `generateFace(4242, {style:'masculine'})` → a `.hed` document (procedural face: shapes at anatomical unwrap positions + seeded variation — color and relief share coordinates by construction); `hedDepthGrid(doc)` → 48×24 signed displacement grid; `buildPartRender(doc, faceDepth, 'ragdoll_lab', 4242)` → per-part `{params, dynKey, texKey}` where every body part is a **`Geometry.Globe`** with a silhouette profile (head also carries the depth grid + displacement amount), `dynKey` follows the host's `"<slotId>~<version>"` dyn-slot contract (`ragdoll_lab.head~4242` — the `~` is load-bearing; without it the host silently drops the mesh), and `texKey` points at a baked texture.

Per render: `buildRigFrameFromBones(bones, 'neutral', 'tee', 'plain', ['cap'], 'jeans')` → the full dressed rig; `<FigureMeshes rig parts>` maps `rig.assembly` + `rig.anatomy` (joint sockets) to Globe meshes (`material="#ffffff"` so textures read true) and `rig.clothing` to primitive meshes; `<CharacterCaptures>` parks two offscreen `StaticSurface` bakes (the 512×256 face unwrap — skin base + `.hed` layers as absolute Boxes — and a plain skin tile) that the part meshes sample by `textureKey`. Same bake-once discipline as the hmsc face pool (memoized component, hoisted style identities).

Hitbox visualization: `rig.hitboxes` (oriented boxes per bone, recomputed from the same bones as the meshes — drawn tinted by their region's HP through `hpColor` (green→amber→red two-segment hex lerp), 0.2 opacity, flashing white/0.85 for 0.16s after a strike (`lastHitAt` timestamps). The 2D `DamageDiagram` in the left column is the same six regions as absolute-positioned boxes wearing the same `hpColor` — the "2D twin of the 3D hitboxes."

### Camera

`OrbitCamera` from `@reactjit/cameras` — first lab in this doc series on the registry rig instead of a hand-rolled `cameraFromOrbit` (contrast hmsc_scale_lab). Yaw/pitch/dist are React state driven by drag/zoom; the **target** chases the body with an exponential lerp `k = 1 − e^(−5·dtReal)` (frame-rate-independent smoothing, real time so slow-mo doesn't slow the camera), targeting the ragdoll's pelvis (floored at y 0.6) or the standing origin.

## Duplication & drift findings

- **Two parallel humanoid stacks now exist.** This cart (plus pathing_lab, combat_lab, planet_run) renders the **head_lab figure**: sculptable Globe parts, `.hed` faces, 25 named bones, box hitboxes, clothing/accessory system, Verlet ragdoll. The hmsc carts render the **hmsc humanoid** (`cart/hmsc-int/render3d/humanoid/`): fixed primitive parts, baked face decals, 6 capsule hit zones, palette recolors, no physics. Same concepts — bones, hitboxes, damage regions, gait, face baking — implemented twice with different vocabularies. Most telling: ragdoll_lab's regions are `lArm/rArm/lLeg/rLeg` while hmsc's `DamageZone` is `armL/armR/legL/legR` — the *same six-region locational damage model* with reversed naming. This is the single biggest convergence candidate the glossary effort has surfaced so far.
- **"Darken a hex" exists 4+ times**: `darkHex` (`car.tsx:22`), `darkShoe` (`head_lab/parts.ts:1337`), `darken` (`hmsc/render3d/humanoid/face.tsx:78`), plus `mixHex` (`index.tsx:88`, the general two-color lerp). All parse `#rrggbb`, scale channels, re-emit hex. Wants to be one color utility.
- **`car.tsx`'s header comment is stale**: it says the sedan is "shared … pathing_lab drives fleets of them," but `pathing_lab/index.tsx` now imports `buildVehicle` from `cart/vehicle_lab/` — `CarMeshes` has exactly one consumer (this cart). The *collision* constants (`CAR_HALF`, `CAR_CENTER_Y`) live in `index.tsx`, separate from the visual model, and `vehicle_lab` presumably owns yet another car shape — car geometry/metrics are fragmenting across three places (and `HMSC_SCALE.car` is a fourth: 4×2×1.5m vs this car's visual ~3.7×1.8 chassis).
- **`lerp3` is defined twice in this dependency chain alone** (`index.tsx:103`, `ragdoll.ts:87`) — trivial, but symptomatic; V3 math helpers (`sub/len3/mid3/lerp3`) are re-rolled per file across the labs.
- The **heading convention** is consistently honored (car faces +Z at yaw 0, `forward = [sin(yaw), 0, cos(yaw)]`, "rotate local offsets about Y, add yawDeg to each ry" under the host's Ry·Rx·Rz order) — `car.tsx`'s `place()`, `FigureMeshes`' `place()/turn()`, and `placeBones` are three implementations of the same prepend-a-yaw transform. Recurring shape; candidates for one `placeLocal(yaw, origin)` helper.

## What is not here

- No host calls by name: no fs, localstore, SQLite, HTTP, `__exec`, clipboard.
- No persistence — HP, log, camera all reset on relaunch.
- No host physics — `<Physics>` (Box2D) unused; no `__hmsc_*` heightfield/collider bindings.
- No `Effect`/WGSL shaders, no `Canvas`/`Graph`, no Tailwind (all inline styles).
- No sound (impact events are visually presented only — slow-mo, flash, log).
- No NPC/AI — the figure has no agency; stimuli are user-triggered.
- The ragdoll has no self-collision and no joint-angle limits (knees bend backward freely) — acceptable at lab fidelity, worth knowing before this graduates.

## Integration-relevant observations

- **The bones record is the lingua franca of the figure stack** — `Record<BoneId, SkeletonBone>` is produced by three sources (animation `buildSkeleton`, physics `bonesFromRagdoll`, blend `blendBones`) and consumed by one sink (`buildRigFrameFromBones` → meshes+clothing+hitboxes+anchors). Mode switches swap the *producer*; everything downstream is oblivious. This producer/sink seam is exactly how the hmsc humanoid solves mesh+hitbox-from-one-source, one level up — and it's the shape any future "animation system" should preserve.
- **Animation→physics→animation round trip**: seed particles from the live pose (handoff), run physics, detect rest by max joint motion, blend back to authored pose. Each leg of that trip is a named function with a small contract — the whole pattern is portable to any game entity (vehicles included).
- **Slow-motion = scaled dt, with the impulse-dt invariant**: time dilation falls out of one multiplier *only because* impulses and steps share dt. The real-time/sim-time split (`dtReal` for UI/camera/flash windows, `dt` for sim) is the generalizable discipline.
- **Locational damage as region map over bone hits** (bone → region → multiplier → once-per-event set) is the model the actual game will need; reconcile it with hmsc's `DamageZone`/`ZONE_DAMAGE` raycast model before a third variant appears (combat_lab already leans on hmsc's).
- **`@reactjit/cameras` adoption**: pure-solve rigs + one emitted `Scene3D.Camera` works cleanly here (with cart-side target smoothing). hmsc_scale_lab's hand-rolled orbit is the pre-registry shape of the same thing.
- **The "sim in refs, render by tick counter, UI mirrored into refs" loop** recurs in every real-time cart; it deserves a glossary entry (and possibly a `useGameLoop` hook that packages scheduler-guard + dt-clamp + tick-counter).

## Glossary

Arena walls: Optional soft x/z bounds in `stepRagdoll` (`arenaHalf`) treated like sideways ground planes — keeps juggled bodies on the platform.

Bones record: `Record<BoneId, SkeletonBone>` — the figure's full pose as data. The interchange format between animation, physics, blending, placement helpers, and the rig builder.

Bone→joint kick map: `BONE_JOINTS` — which ragdoll joints a struck bone transfers impulse to (segment bones kick both endpoint joints).

Damage region: One of six HP pools (`head/torso/lArm/rArm/lLeg/rLeg`); bones map to regions by name; damage is charged once per region per launch event. (hmsc's `DamageZone` is the same idea, different naming — convergence pending.)

Dyn-key contract: `dynamicKey = "<slotId>~<version>"` for live/sculpted geometry — the host keeps one reusable GPU slot per id, overwrites on version change; a missing `~` silently drops the mesh.

Handoff frame: The last-rendered bones (`lastBonesRef`) used to seed `createRagdoll` — physics takes over from the exact mid-animation pose.

Hood carry: The rule that joints still inside the moving car's box get repositioned ahead of the bumper and re-shoved — bodies ride the hood instead of tunneling.

Impulse-dt invariant: `ragdollImpulse(..., dt)` and `stepRagdoll(r, dt)` must share the same (possibly slow-mo-scaled) dt, or every kick's energy silently rescales.

K.O.: Any region at 0 HP. Suppresses recovery (body stays down), shows the banner; only HEAL resets.

Recovery blend: `blendBones(settledPose, standPose, smoothstep(t))` over 0.85s, positioned at the pelvis landing point — physics hands the body back to animation where it fell.

Rest length: A constraint's target distance, measured on the canonical stand skeleton (pose-invariant), never on the seed pose.

Settle detection: `ragdollMaxMotion < 0.0025` for 55 consecutive ticks with no car active — "the body is at rest."

Sim-in-refs loop: The real-time cart pattern — mutable sim object in a `useRef`, scheduler = rAF-guard→`setTimeout(16)`, dt from `performance.now` clamped [0.001, 0.05], UI state mirrored into refs for the loop, `setTick(t=>t+1)` as the only render trigger.

Slow-mo window: `sloMoUntil` timestamp; while active, sim dt is `dtReal × 0.22` but UI/camera keep real time.

Verlet ragdoll: Position-based dynamics — particles with implicit velocity (`pos`−`prev`), distance constraints relaxed 6×/step, mass-weighted corrections, ground/wall response by position projection. Chosen because the framework has no 3D rigid bodies; lives entirely in JS.
