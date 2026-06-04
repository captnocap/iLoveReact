# combat_lab cart inventory

Source cart: `cart/combat_lab/index.tsx` (single file, 1842 lines)

Reviewed: 2026-06-04

## High-level purpose

`combat_lab` is the **integration prototype for HMSC combat**: player-vs-bot line-of-sight, aiming, shooting, locational damage, death ragdolls, and Hitman-style NPC perception — all running together in one arena. Unlike the other labs (each isolating one system), this cart deliberately *joins* systems from both figure stacks and four hmsc registries the way the actual game will join them:

- **Bodies** are head_lab dressed figures (`parts.ts` skeleton → rig; same stack as pathing_lab/ragdoll_lab), per-bone oriented-box hitboxes as the damage surface, head_lab's Verlet ragdoll on death.
- **Aiming** is hmsc's real over-the-shoulder system (`gameplay/camera.ts` constants, host mouse capture/deltas), upgraded with a true ADS aim rig.
- **Shot rules** are hmsc's two paths, joined as the game joins them: a **geometric** crosshair ray for the player's shots, a **probabilistic** dice path (`npc/systems/chance.ts`) for bots — with this cart *building the missing producer* (`coverFractionOf`) that chance.ts needs.
- **Perception** is driven by the hmsc kind registry (`npc/kinds.ts NpcPerceptionProfile` — FoV cones, hearing acuity, reaction time) and the tile registry (`world/tileKinds` `npc.noise` underfoot), with an awareness ladder (calm→spooked→alert→hostile/panic) and upward escalation (civilians notify police, thugs shout to gang, the paramedic tends the downed).

Controls: click to capture the mouse (host pointer-lock), Esc releases, RMB hold = aim (shoulder cam + crosshair), LMB = fire, WASD move (camera-relative), Shift run, C crouch, 1/2/3 weapons, V LoS rays, B hitboxes, H heal, P pause, R reset. Everything observable is visualized: FoV cones colored by state, your own noise as expanding rings, cover-sample rays green/cut-red, suspicion bars over heads, a shot log, and a debug strip.

## Files touched by this behavior

The cart:

- `cart/combat_lab/index.tsx`: arena, sim loop, both shot paths, perception/AI state machine, aim camera, all UI. The 60-line header comment is itself a design document — read it.

head_lab figure stack (same imports as ragdoll_lab — see `docs/game/ragdoll_lab.md` for internals):

- `cart/head_lab/parts.ts`: `buildSkeleton` (now with the `kneel` pose + `CROUCH_ACTION` body-crouch timeline action for the full crouch), `buildRigFrameFromBones` (per-actor shape/top/skin/accessories/bottoms), `BodyHitbox` (oriented boxes).
- `cart/head_lab/ragdoll.ts`: `createRagdoll/stepRagdoll/ragdollImpulse/ragdollMaxMotion/bonesFromRagdoll/placeBones/blendBones`. `placeBones` (yaw+translate) is the placement used for every walking actor here.
- `cart/head_lab/hed.ts` + `figureRender.tsx`: per-actor faces (`generateFace(seed, style)`) and the `buildPartRender`/`CharacterCaptures`/`FigureMeshes` kit, cartKey `'combatlab'`.

hmsc systems under test (the game's own modules, imported across the cart boundary):

- `cart/hmsc/npc/systems/chance.ts`: the probabilistic path's ground truth. `hitChance({rangeMeters, coverFraction, targetCrouched, shooterSkill})` → skill sets the base (0.35–0.95), range bleeds it (full <4m, ~0 by 40m), cover cuts up to 80%, crouched ×0.7. `rollHit`, `rollZone` (torso 0.5, legs 0.12×2, arms 0.09×2, head 0.08 — the AI aims center mass). Header rule: any "perceived odds" display warps *this*, never recomputes (the scape perception-split law, restated).
- `cart/hmsc/npc/systems/damage.ts`: `zoneDamage(baseDamage, zone)` = base × `ZONE_DAMAGE[zone]`. The file is the declared join point of the two shot paths — one health subtraction, death decided in one place.
- `cart/hmsc/npc/kinds.ts`: the kind registry — per-kind health/speeds/faction/`canFight`/`weaponDamage` and the `NpcPerceptionProfile` (vision range/FoV, hearing acuity, reactionSeconds). Includes the lab-driven `paramedic` kind. The cart's bots read all stats from here.
- `cart/hmsc/render3d/humanoid/hitbox.ts`: `ZONE_DAMAGE` (head ×2.5, torso ×1, arms ×0.55, legs ×0.7) — **the hmsc humanoid's table applied to head_lab hitboxes** (see convergence note below).
- `cart/hmsc/render3d/humanoid/skeleton.ts`: the `DamageZone` type (`head|torso|armL|armR|legL|legR`).
- `cart/hmsc/gameplay/camera.ts`: `HMSC_GAMEPLAY_CAMERA` (every mouse-look/follow-cam constant: 0.0032 rad/px yaw, smoothing 24/s, follow dist 5.9m / height 3.05m, aim shoulder shift 0.62m, FoVs) + `clampCameraValue` + `angleDeltaDegrees` (shortest-arc yaw smoothing).
- `cart/hmsc/world/tileKinds.ts`: `TILE_KIND_DEFINITIONS` — each floor patch is a real tile kind; its `npc.noise` (road 0.7, mud 0.15–0.25…) scales footstep carry AND its `render.color` paints the patch. One definition drives both what you see and what bots hear.

Runtime/host:

- `runtime/hooks/useIFTTT.ts`: `busOn('__keydown')` **and `'__keyup'`** — this cart tracks held keys (`keysRef`) for WASD, the first in this doc series to consume keyup.
- `framework/v8_bindings_core.zig`: the named host mouse bindings — `getMouseRightDown` (line 807, impl 305), `__mouse_capture` (808/310), `__mouse_delta` (809/318); plus `getMouseDown` from the pointer-payload set.
- `runtime/primitives.tsx` / `runtime/geometries/`: Scene3D wrapper, `{color, opacity}` material objects (transparent pass), the geometry intern cache whose OOM rule shapes the fx rendering (below).

## Host functions vs JavaScript functions

This is the first cart in the series that **calls host functions by name**, because mouse-look needs polled relative input that the event system can't deliver:

- `__mouse_capture(1|0)` — host pointer-lock. Driven by React state `mouseFocused` via an effect (click scene → capture, Esc → release, unmount cleanup → release). While captured, the OS cursor is gone and the host accumulates relative deltas.
- `__mouse_delta()` — returns `{dx, dy}` accumulated since last read; polled **once per tick** and integrated into yaw/pitch accumulators (`cameraAimRef`), with hmsc's `maxMouseDeltaPixels` (220) spike filter and per-axis sensitivities. Wrapped defensively (`readHostMouseDelta`, missing binding → `{0,0}`).
- `getMouseRightDown()` / `getMouseDown()` — polled button state, read every tick: RMB = aiming, LMB while aiming = autofire (cooldown-gated). Wrapped by `readHostNumber` (missing → fallback).

So the input model is split three ways: **polled host state** (mouse buttons, deltas) for the combat loop, **bus events** (`__keydown`/`__keyup` packed-int push) for held-key tracking and hotkeys, and **one Pressable onMouseDown** whose only job is "click scene to focus." A quirk preserved in a comment: Shift arrives from the key decoder as raw SDL keysyms (`sdl:1073742049`/`sdl:1073742053`) rather than `'shift'`, so the cart tracks it both by those codes and by the `shiftKey` modifier flag on other key events.

Everything else — both raycast paths, the Verlet physics, perception math, the AI ladder, camera solve, collision — is plain JavaScript per tick. The loop is the standard sim-in-refs shape (rAF guard → always `setTimeout(16)` on this host, `performance.now` dt clamped [0.001, 0.05], `setTick` counter), with one hardening unique to this cart: **the crash-proof tick**. `step()` runs inside try/catch; an exception is `console.error`'d (severity ≥ warn is the only console level that reaches the dev terminal) and the loop keeps scheduling — a thrown frame used to silently kill the rAF chain and freeze the cart with zero output. The debug strip renders `s.frame` so a frozen counter is *visible* evidence of a dead loop.

## The two shot paths (the cart's thesis)

**Geometric — player → bot.** The bullet is the render camera's exact screen-center axis: `origin = s.cam.position`, `dir = normalize(s.cam.target − origin)`. The comment marks the original sin this fixes: deriving the ray from `aimForward(yaw, pitch)` instead diverges from the crosshair line by meters at combat range — *what's under the crosshair must be what gets hit*, so fire, render, and crosshair-targeting all read the **one camera resolved per tick** (`s.cam`). The ray runs `nearestCoverT` (slab test vs all obstacle AABBs; origins inside a box are blocked at t≈0) and `raycastFigures` (each bone's `BodyHitbox` is an oriented box — the ray is transformed into box-local space by inverting the host's Ry·Rx·Rz rotation order and slab-tested against ±size/2; nearest pierced bone across all bots wins, so one bot can absorb a bullet meant for another). Cover closer than the body eats the shot. The struck bone maps to a `DamageZone` via `boneZone()` and `ZONE_DAMAGE` scales the weapon — a headshot is a headshot because the ray pierced the head box, never a dice roll. Misses are still observable (tracer into the distance + log line).

**Probabilistic — bot → player.** *No ray is ever cast at the player's body.* `coverFractionOf(botEye, playerBones)` supplies the cover input, `hitChance` owns the odds, `rollHit` decides, `rollZone` picks where, `zoneDamage(kindDef.weaponDamage, zone)` scales. The tracer is **theater drawn after the dice** — landed shots draw to the player's zone-mapped bone (`ZONE_IMPACT_BONE`), misses whiz past with a perpendicular offset. The HUD shows each fighter's live `would hit N%` from the same `hitChance` call — ground truth displayed, never recomputed.

**The missing producer, built here.** `coverFractionOf(eye, targetBones)` casts eye→sample segments to 9 points riding the target's *own bones* (head twice — it's what peeks over cover — shoulders, torso, pelvis, thighs, a shin); blocked/total = the `coverFraction` chance.ts wants. Riding bones instead of fixed heights is the trick: crouching (kneel pose + body-crouch action, head down to ~1.36m) genuinely pulls samples under a 1.7m crate. Cover tiers are sized against the real figure: walls 2.7m block everything, crates 1.7m hide a crouch entirely / a stander to the shoulders, barriers 0.95m eat legs only. **The rendered boxes ARE the tested AABBs** — no separate collision geometry.

The damage table is shared: `ZONE_DAMAGE` comes from the *hmsc humanoid* module while the boxes come from *head_lab* — `boneZone()` is ragdoll_lab's region map renamed into hmsc's zone vocabulary (`armL`, not `lArm`), so both paths and both figure stacks finally speak one damage language. This is the convergence move the ragdoll_lab doc predicted.

## Perception (Hitman rules, no wallhacks)

Per tick, per live bot:

- **Vision** = forward cone test (per-kind `visionFovDegrees`/`visionRangeMeters` from kinds.ts) → if in cone, run `coverFractionOf(botEye, playerBones)`; `exposure = 1 − fraction`; `seeing = inCone && exposure > 0.1`. Suspicion fills at `exposure × proximity / reactionSeconds` per second (proximity ramps 1.15 at point-blank to 0.4 at max range) — a glimpse of a crouched player at range takes seconds, point-blank in the open is near-instant. No stimulus → suspicion decays at 0.12/s.
- **Hearing** is omnidirectional, mediated by **noise events**: footsteps emitted on a cadence while moving (run 0.32s / walk 0.5s / crouch 0.65s) with carry = mode radius (16/8/3.5m) × the tile's `npc.noise` underfoot; gunshots carry 40m at salience 1 (tile noise doesn't quiet a muzzle blast). Each `NoiseEvent` is born unprocessed, **heard by every bot exactly once on the next tick** (the `processed` flag — mid-loop gunshots wait one frame so all bots hear them uniformly), and drawn for 0.6s as an expanding ring at its true radius — *you see how loud you just were*, before per-listener `hearingAcuity` scales reception.
- **The ladder**: `calm → spooked (0.33: freeze, face the stimulus — the Hitman "huh?") → alert (0.66: walk to it, look around) → terminal by kind`: fighters go `hostile`, the unarmed go `panic`. Being shot is total awareness (suspicion 1 + your position confirmed). De-escalation paths exist at each rung (dwell timers + suspicion decay).
- **`stimulus` vs `lastKnown`** is the load-bearing distinction: stimulus = where to look/investigate (a sound, a glimpse, a report); `lastKnown` = the last *confirmed* player position (full sight, being shot, or a notify report) — hostiles hunt `lastKnown`, never the live position; break line of sight and they run to where you *were*, lose the trail, and drop back to alert.
- **Upward escalation by kind**: civilians/paramedics in panic switch to `notify` — run to the nearest standing officer and hand him your last reported position (he goes hostile *toward that spot*); thugs going hostile shout to gang members within 14m; the paramedic, once gunfire has been quiet 5s and bodies are down, enters `tend` (kneel pose at the nearest downed body). Bot kind ≠ behavior is a switch statement in the cart for now, but every *parameter* reads from kinds.ts.

Local tables the cart carries with eviction notes: `SHOOTER_SKILL` and `FIRE_COOLDOWN` per kind ("kinds.ts doesn't carry skill yet — when it graduates there, delete this table").

## The camera (the aim-ceiling fix)

At rest: hmsc's shipped follow cam **verbatim** — position 5.9m behind at fixed height 3.05m, pitch implemented by sliding the look *target* ±0.82m/rad around target height 2.08m. The cart's comment documents why that camera can't aim: composed this way its screen axis can never rise above the horizon (at full up-pitch it still points slightly down), so the crosshair line at 30m sat at ~0.8m — below an enemy's head. The "aim ceiling."

While aiming (RMB): a **true aim rig** — orbit a shoulder-height pivot (1.62m, dropped 0.42m by the crouch tween, shifted 0.62m onto the shoulder) with a genuinely pitched forward axis; camera 2.4m behind the pivot (ADS framing vs the 5.9m follow), look-ahead 12m, pitch clamps widened to ±~60° ("aiming needs the sky"). The accumulator is re-clamped every tick, not just on deltas, so a sky-high aim eases back into the follow cam's narrow range when RMB releases. Yaw/pitch chase their accumulators with hmsc's exponential smoothing (`smoothingPerSecond` 24, shortest-arc via `angleDeltaDegrees`).

Camera collision: if cover sits between pivot and lens (`nearestCoverT` on that segment), the camera position is pulled forward along its own axis (min 18% of the distance). Once dead, the camera follows the ragdoll's pelvis. **One `s.cam` per tick feeds render, fire ray, and crosshair-target highlight** — the invariant the whole cart hangs on.

## Render discipline (two hard-won rules, applied)

- **Unit geometry + scale transforms** (the intern-cache OOM rule): everything sized per-frame — tracers, cover rays, cone edges, noise rings, sparks, health bars — renders unit-param geometry (`UNIT_CYL/BOX/SPHERE/TORUS` module constants = one intern entry each, forever) scaled by transform. A continuous float in `params` (a tracer's length) would mint a fresh vertex buffer every frame and OOM V8 in minutes. `SegmentMesh` is the workhorse: A→B as a unit Y-cylinder via swing/yaw rotation + `[r, length, r]` scale.
- **Fixed-shape scene children** (the reconciler sibling-shift rule): per-bot health bars, suspicion bars, and ground rings stay **mounted when a bot dies and hide via opacity** (`hidden` fades, never unmounts) — unmounting would shift Scene3D's flattened child list mid-stream and corrupt trailing siblings. All variable-length fx (cones, rays, hitboxes, rings, tracers, sparks) collapse into **one keyed `fx[]` list rendered last**.

Movement collision is deliberately cheap: 2D circle vs obstacle footprints (`bodyCollides` — all tiers block walking; only *sight* cares about height), axis-separated slide (`slideMove` — blocked diagonals skim along walls), and pairwise pushout so live bodies don't stack.

## Duplication & drift findings

- **The convergence is half-done, by design**: head_lab hitboxes + hmsc damage table meet here through `boneZone()`. But `boneZone` is a near-copy of ragdoll_lab's `boneRegion` (same `ARM_MARKS` array, same logic, different output vocabulary), and `BONE_JOINTS` (25-entry bone→joint kick map) is **duplicated verbatim** from `ragdoll_lab/index.tsx` — both want to live in `head_lab/ragdoll.ts` next to the other bone-record helpers. `mixHex`/`hpColor` are also copied verbatim from ragdoll_lab (the hex-helper sprawl noted there grows by two).
- `SETTLE_MOTION`/`SETTLE_TICKS` (0.0025/55) and the settle-detection block are repeated from ragdoll_lab — a `ragdollSettled(r, ticksRef)` helper is implied.
- `eyeOf` (head + 0.06) here vs the hmsc skeleton's `rig.eye` — two definitions of "where a humanoid sees from," one per stack.
- The Skybox/lights block is copy-identical to ragdoll_lab's (same zenith/horizon/sun numbers) — a shared "lab environment" fragment is forming.
- `Chip` exists in both labs with slightly different styling; the lab-chrome kit (`Chip`/`Knob`/`MeterRow`) keeps being re-rolled.
- Floor zones vs hmsc tiles: `FLOOR_ZONES` are free rectangles, not grid tiles — fine for a lab, but the noise lookup (`floorKindAt` linear scan) won't scale to the game's tile grid (the game already has `world/grid.ts`).

## What is not here

- No fs/localstore/SQLite/HTTP — nothing persists; reset rebuilds `makeSim()`.
- No host pathing (`__path_*`), no `motion.ts` — bot movement is straight-line seek + slide, patrols are hardcoded waypoint loops. (pathing_lab owns that integration.)
- No `<Physics>`, no heightfield — flat arena, JS-only collision.
- No sound *output* — "hearing" is pure simulation; noise rings are the only feedback.
- No NPC↔NPC chance shots (bots never shoot each other; the chance path's NPC→NPC case from the design doc is unexercised).
- No Tailwind, no Effect/WGSL, no Canvas/Graph.
- The player's own hitboxes render (B) but nothing ray-tests them — incoming fire is dice-only, per design.

## Integration-relevant observations

- **This cart is the game-assembly dress rehearsal.** It proves the cross-stack wiring order: kind registry → perception → suspicion ladder → chance.ts odds → zoneDamage, and camera → crosshair ray → cover → hitboxes → ZONE_DAMAGE → ragdoll. When hmsc lifts this, the things to lift are: `coverFractionOf` (chance.ts's declared missing producer), the aim rig (the follow cam *cannot* aim — measured and documented here), the noise-event bus, and the awareness ladder with `stimulus`/`lastKnown` separation.
- **"The rendered thing IS the tested thing"** recurs at every level (cover boxes = ray AABBs, floor patches = noise definitions, hitboxes = damage surface, camera axis = bullet line). This see-it==hit-it doctrine matches the terrain see-it==walk-it rule; it should be a named project principle.
- **Registries as the tuning surface**: kinds.ts and tileKinds.ts are consumed unmodified; every lab-local table (`SHOOTER_SKILL`, `FIRE_COOLDOWN`, `MOVE_NOISE`, weapons) carries an explicit "graduate me to the registry" note. The pattern — struct stores `kind`, registry gives it meaning — is the project's load-bearing data architecture.
- **One resolved camera per tick** consumed by render/fire/UI is the anti-divergence pattern; the same discipline (solve once, share the result) shows up as bones/rigs solved once per tick into `bonesRef`/`rigsRef` shared by AI, raycasts, and render.
- **Geometric-out / probabilistic-in** is the asymmetric combat thesis: player shots are skill (aim), incoming shots are odds (exposure management). The scape memory's perception split (ground truth vs display warp) is restated in chance.ts's header and honored by the HUD.
- The crash-proof tick + frame-counter debug strip is a pattern every loop cart should adopt (combined with `console.error`-only-reaches-terminal).

## Glossary

Aim ceiling: The hmsc follow cam's inability to raise its screen axis above the horizon (pitch slides the look target around a fixed-height camera) — the bug that motivated the true aim rig.

Aim rig (ADS): The RMB camera — orbit a shoulder-shifted, crouch-aware pivot with a genuinely pitched forward axis, 2.4m back, wide pitch clamps; the fire ray IS its screen-center axis.

Awareness ladder: calm → spooked (freeze+face) → alert (investigate) → hostile / panic, driven by a 0..1 suspicion accumulator with thresholds 0.33/0.66/1.0, dwell timers, and decay.

coverFractionOf: Eye→bone-sample occlusion test (9 samples riding the target's skeleton, head double-weighted); blocked/total = the `coverFraction` input chance.ts requires. Built here; hmsc lifts it.

Exposure: `1 − coverFraction` — how much of a body an eye can see. Gates bot fire (≥0.12), scales suspicion fill, and is the player's main HUD meter.

Fixed-shape children: Scene3D fragments keep a constant child count — dead bots' bars/rings hide via opacity instead of unmounting (reconciler sibling-shift protection); all variable-length fx live in one keyed list rendered last.

Geometric path: Player→bot shots — the camera-axis ray vs cover then per-bone oriented boxes; zone chosen by which box the ray pierced. Skill-based by construction.

Kind registry: `npc/kinds.ts` — per-kind health/speed/faction/canFight/weaponDamage + perception profile. The struct stores `kind`; the registry gives it meaning.

lastKnown: The last *confirmed* player position (full sight, being shot, or a notify report). Hostiles hunt it, never the live position — breaking line of sight works.

Noise event: A transient stimulus `{p, radiusMeters, salience, kind}` — footsteps (cadence × mode radius × tile noise) and gunshots (40m, salience 1). Heard by every bot exactly once the tick after birth; drawn as an expanding ring at its true carry radius.

Notify: The upward-escalation behavior — an unarmed kind runs to the nearest officer and transfers its report into his `lastKnown`, flipping him hostile toward that spot.

One camera per tick: `s.cam` resolved once in the loop and read by render, fire ray, and crosshair targeting — never re-derive the bullet from yaw/pitch.

Probabilistic path: Bot→player shots — `coverFractionOf` → `hitChance` → `rollHit`/`rollZone` → `zoneDamage`. No ray at the body; tracers are theater drawn after the dice.

Suspicion: The per-bot 0..1 awareness accumulator; fills at `exposure × proximity / reactionSeconds`, jumps to 1 on gunshots/being shot, decays 0.12/s unstimulated. Rendered as a state-colored bar under the health bar.

Tile noise: `TILE_KIND_DEFINITIONS[kind].npc.noise` — the per-tile multiplier on footstep carry. The same definition's `render.color` paints the patch: what you see is what they hear.

Unit geometry rule: Anything sized per-frame uses module-constant unit params + a `scale` transform; per-frame params would mint unbounded intern-cache entries and OOM V8.

ZONE_DAMAGE: The shared zone-multiplier table (head ×2.5 … legs ×0.7) from the hmsc humanoid module — now scaling head_lab hitbox hits too, via `boneZone()`'s bone→zone rename. Both shot paths and both figure stacks speak this one damage language.
