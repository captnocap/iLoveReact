# combat-arena — lab notes

> P6: these notes are the lab's contract — read by humans, AI, and the oracle.
> They are what make "broken" detectable: after a graduation re-run, a behavior
> change against these notes is a real choice surfaced for ruling, never a
> silent patch. Keep them current; an AI referencing this lab reads this first.

## What this lab demonstrates

The **combat integration lab** — the merge of the two archived standalone labs
(`ragdoll_lab`'s locational body damage + `combat_lab`'s LoS / aim / perception
/ chance) onto the graduated `@game` ground floor.

**It rides the GAME'S OWN player substrate (req_0925).** The lab mounts
`useEmbodiedPlayer` — the exact controller `PlayRoute` uses — so the movement,
the V23 host camera (orbit + ADS), the frame loop, and the player figure are the
REAL ones, not re-rolled. There is no second rAF loop and no per-frame multi-
figure rebuild (that was the first cut's lag + "scuffed" camera/movement). Combat
is layered ON TOP, in the substrate's `onFrame` hook; arena colliders (stairs,
cover) ride `worldExtras.solids`; the arena is the default world stripped to its
flat chunk floor. (STRUCTURE caveat: the integrated on-foot controller lives in
`Embodied.tsx`, not yet a `game/` door — the user ruled the lab must reuse it, so
it's imported directly until it graduates to a door.) It proves four things
firing together in one arena:

- **Fall damage (collision).** `GAME_PHYSICS.step` owns gravity, the jump arc,
  and ground/step/wall resolution (the host integrator). The lab climbs a 10-step
  stair to a 4m ledge, walks off, and prices the landing off the **airborne→
  grounded transition**: impact speed is the downward velocity the frame before
  `grounded` flips true; past `FALL.safeSpeed` (7 m/s) it charges the legs and
  torso, scaling with the excess (and ×3 past `lethalSpeed`). The fall and the
  bullet feed ONE six-zone health model.
- **Line of sight (`GAME_PERCEPTION`).** Each NPC runs a forward FoV cone
  (`inVisionCone`, heading = figure-yaw + 180° since perception faces +Z at 0)
  gated by **cover sampling**: rays from the NPC eye to 9 points riding the
  PLAYER's own bones (`GAME_CHANCE.coverSampleSpec`), blocked/total = the
  `coverFraction`. Crouch (C) pulls the samples under the 1.7m crates — genuine
  cover, because the samples ride the skeleton. `exposure = 1 − coverFraction`
  fills suspicion.
- **Aiming with items (`GAME_ITEMS` + the geometric ray).** RMB drives the
  host ADS camera (`GAME_NATIVE_CAMERA.setAim`); the equipped weapon (fists /
  pistol / SMG / rifle) fires a ray from the eye along the look axis, slab-tested
  against every NPC's per-bone **oriented hitboxes** (`GAME_FIGURE` rig) after
  cover. The pierced bone → ruled zone → `ZONE_MULT` × weapon damage. A headshot
  is a headshot because the ray pierced the head box — **skill, never a roll**
  (the asymmetric-combat thesis).
- **Combat with NPCs (`GAME_KINDS` + `GAME_CHANCE`).** Four kinds spawn
  (thug / police / civilian / paramedic) with their registry health / speed /
  faction / `canFight` / perception. The awareness ladder climbs calm → spooked
  → alert → hostile/panic; fighters hunt `lastKnown` and **return fire by DICE**
  (`attackChance` over exposure → `rollHit` → `rollZone` → `zoneDamage`), the
  unarmed flee. Incoming shots never ray the player's body — exposure management
  is the defense.

The loop is the substrate's — `useEmbodiedPlayer` owns the frame clock, the
movement step, and the camera. Combat state lives in refs mutated inside the
substrate's `onFrame` (which runs after the movement step, reading the REAL
player pose); the lab re-renders the NPCs/fx at ~30 Hz (the player figure
re-renders through the substrate). No parallel rAF, no re-rolled camera/movement.

Controls: click the scene to capture the mouse, **Esc** releases. **WASD** move,
**Shift** run, **Space** jump, **RMB** aim, **LMB** fire, **V** toggle FoV
cones, **B** toggle hitboxes — all the game's real bindings.

## What broken looks like

- **You fall off the ledge and take no damage / die from a hop** — the
  `prevGrounded → grounded` transition isn't read, or impact uses the post-step
  (already-zeroed) velocity instead of `prevVy`. A safe hop (<7 m/s) must be free.
- **NPCs see you through the crates / never see you in the open** — the cover
  sampling is wrong: samples not riding the player bones, or `inVisionCone`
  heading not converted (+180°) so the cone points backward.
- **What's under the crosshair isn't what gets hit** — the fire ray must come
  from the eye along the look axis; the host solves the camera, so the lab's
  analytic aim axis is used (a known, documented approximation — see below). A
  large miss offset means `aimForward`'s yaw/pitch convention drifted.
- **Headshots do flat damage / every shot hits center mass** — the player path
  must pick the zone from the pierced bone (`damageZoneForBone`), not `rollZone`;
  only the NPC dice path calls `rollZone`.
- **NPCs shoot you through full cover, or never miss** — the incoming path isn't
  feeding `coverFraction = 1 − exposure` into `attackChance`, or it's casting a
  ray at the body instead of rolling the dice.
- **A dead NPC keeps shooting / disappears** — death must set `dead` (frozen,
  laid down, still MOUNTED — unmounting shifts Scene3D's child list and corrupts
  trailing siblings).
- **Per-frame paint/OOM spikes** — a tracer/cone/ring minted geometry with a
  per-frame param instead of unit geometry + a scale transform.

## Known approximations (first slice)

- **The fire ray comes from the HOST** (req_0929): `GAME_NATIVE_CAMERA.activeRay()`
  reads the active camera's resolved optical axis from the host
  (`__game_camera_ray` → `framework/game/camera.zig activeCameraRay`). This is the
  truth only the host has — JS deriving a direction from yaw/pitch diverges from
  the real camera (the diagonal-bullets bug). Until the host is rebuilt the door
  returns null and the lab falls back to the game's own orientation mapping
  (`GAME_CAMERA.orientation`). Needs a Zig rebuild to use the exact path.
- **NPCs are full distinct figures (same system as the player), via interning.**
  `FigureMeshes intern` (req_0933) omits the per-part `dynamicKey`, so NPC
  geometry interns into the big retained buffer instead of the scarce 48-slot
  live-sculpt pool. That pool starving — NOT a real figure limit — is what
  dropped the player's head; the player (one live figure) keeps its dyn slots,
  NPCs cost none. `GEO_CACHE_SIZE=2048` interns hold hundreds of static figure
  parts; the shipped game's crowds go through the bake/instance path, not this.
- **Death is a laid-down stand-in, not a ragdoll.** `GAME_FIGURE.ragdoll` is a
  CONTRACT — the solver is the physics lane's host feature and
  `ragdoll.hostReady()` is honestly false. When it lands: bones →
  `seedJointsFromBones` → host → `jointsToBones` → the rig.
- **Lab-local tables that graduate** (each marked in source): `FALL` (→ a player
  condition system), `ZONE_MULT` (→ beside `DAMAGE_ZONES`), `WEAPONS` range
  profiles (→ `GAME_ITEMS`), `SHOOTER_SKILL` / `NPC_PROFILE` (→ `GAME_KINDS`).
- **No NPC patrols / no NPC↔NPC fire / no social escalation** (notify, gang
  shout, paramedic tend) — the perception hooks return them; wiring them is the
  next slice.

## Log

- 2026-06-14: scaffolded + first slice (req_0916) — the four-pillar combat lab
  (fall damage, LoS cover sampling, item aiming via geometric ray, NPC dice
  combat) on the `@game` door. Merges the archived ragdoll_lab + combat_lab.
- 2026-06-14: fixed dropped figure bodies + dup keys (req_0918) — unique cartKey
  per figure.
- 2026-06-14: REWRITE onto the real player substrate (req_0925) — replaced the
  hand-rolled loop/camera/movement/player-figure with `useEmbodiedPlayer` +
  `EmbodiedScene`/`EmbodiedCaptures`/`EmbodiedMouseSurface` (what `PlayRoute`
  uses). Combat now runs in the substrate's `onFrame`; arena colliders ride
  `worldExtras.solids`. Kills the lag (no second loop, no 5-figure-per-frame
  rebuild) and the scuffed camera/movement (they're the game's now).
- 2026-06-14: full NPC figures via interning (req_0933) — `FigureMeshes intern`
  omits the per-part dynamicKey so static NPC geometry interns (retained buffer)
  instead of taking a live-sculpt dyn slot. NPCs are now real distinct figures
  (own face/outfit), same system as the player; the player keeps its head because
  only it uses dyn slots. No cap raise, no rebuild needed for this.
- 2026-06-14: no-head fix + host aim ray (req_0927/0928/0929). First cut rendered
  NPCs as hitbox proxies (superseded by interned figures above). NEW host
  binding `__game_camera_ray` (`GAME_NATIVE_CAMERA.activeRay()`) returns the
  resolved crosshair ray — the fire ray uses it (fixes diagonal bullets), with a
  `GAME_CAMERA.orientation` fallback until the host is rebuilt. Crosshair centered
  (was pinned to the corner by `left:'50%'` — absolute children take left/top RAW).
  NEEDS A ZIG REBUILD for the host ray.
