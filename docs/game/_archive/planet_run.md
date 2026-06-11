# planet_run — "the world rolls under your feet" coin-rush mini-game

**Cart file:** `cart/planet_run/index.tsx` (single file, ~720 lines)
**Ship:** `./scripts/ship planet_run` · Dev: `./scripts/dev planet_run`
**Imports from other carts:** `cart/head_lab/parts.ts` (`buildRigFrame`), `cart/head_lab/animDsl.ts` (re-export shim → real module is `cart/animationDsl.ts`), `cart/head_lab/hed.ts` (`generateFace`, `hedDepthGrid`), `cart/head_lab/figureRender.tsx` (`buildPartRender`, `CharacterCaptures`, `FigureMeshes`)
**Runtime imports:** `@reactjit/runtime/primitives`, `@reactjit/runtime/hooks/useIFTTT` (`busOn`), `@reactjit/geometries`, `@reactjit/cameras` (`FollowCamera`)

## What it is, in one sentence

A complete, finished mini-game (start screen → 60-second coin rush → win/lose → restart) whose central trick is that **the player never moves**: they walk in place at the north pole of a small planet (R = 7.5 m) centered at `[0, −R, 0]`, and the entire world — one shader-textured Globe plus every tree, rock, tuft and coin pinned to it — rolls underneath via an accumulated quaternion.

This is the first cart in the survey that's a *game*, not a lab: it's the integration proof that the pieces built in the labs (head_lab character, animation DSL, cameras registry, Effect-bake terrain, geometry registry) compose into actual gameplay.

## The rolling-planet mechanic (all JS math, in-cart)

- One quaternion `s.q` is the planet's orientation. Walking forward with heading `h` (forward = `[sin h, 0, cos h]`) applies `quatAxisAngle([-fz, 0, fx], dist / PLANET_R)` pre-multiplied onto `q` — the surface flows *backward* under the feet, so what's ahead on the sphere crests the horizon toward you. Curvature sells the scale.
- The cart carries its own small **quaternion/matrix library** (~100 lines): `quatAxisAngle/quatMul/quatNormalize/quatRotate`, 3×3 matrix builders, and — the load-bearing part — `eulerYXZ()`, which decomposes the quaternion's matrix back to **euler degrees in exactly the order the host composes mesh rotations** (`model = T·Ry·Rx·Rz·S`, per `framework/gpu/3d.zig` makeInstance). The planet mesh then just takes `rotation={planetEuler}` like any other mesh — no host-side quaternion support needed or used.
- Surface objects are stored as **planet-local unit directions** (`V3` on the unit sphere). Per frame each is rotated by `q` (`quatRotate`), scaled out to its radius, and positioned/oriented with `alignRotation(d)` (point mesh +Y along the surface normal) or `coinRotation(d, spin)` (upright disc spun about the normal: `align · Ry(spin) · Rz(90°)`, composed in 3×3 land then decomposed via `eulerYXZ`).
- **Coin collection is angular**: a coin is collected when `acos(worldDir.y) * R < 1.35 m` — i.e. its rotated direction is within an arc-distance of the pole the player stands on (and the player isn't mid-hop above 1.2 m). Same math powers the HUD "nearest coin N m" and the compass bearing.

## The planet surface — shader bake with an exact JS mirror

- `PLANET_WGSL` is an fbm continents/ocean/ice-caps fragment shader baked ONCE: `<StaticSurface staticKey="planetrun.surface">` wrapping an `<Effect>` (512×256, equirect like the Globe unwrap), sampled by the planet mesh via `textureKey` — the same 2D-on-3D bridge documented in `docs/game/billboard_demo.md`. The capture is a `memo` component with `useMemo`'d style/data so it bakes once and never again (deliberate contrast with billboard_demo's every-frame rebake — this cart obeys the `static_surface_inline_props_rebake` rule).
- Seam handling: longitude feeds the noise as `cos/sin(ang)`, so u=0 and u=1 sample identical fields — no seam down the back of the globe.
- **Namespace collision rule:** all shader helpers wear a `pr_` prefix because the Effect pipeline prepends the shared WGSL math library (`framework/gpu/effect_math.wgsl` — fbm/snoise/voronoi/...), and a bare `fn fbm` redefinition hard-crashes shader-module creation.
- **The dual-implementation contract:** `prHash/prVnoise/prFbm/terrainAt` in JS mirror the shader math *exactly*, including the Globe-unwrap inverse (`phi = π/2 − 2πu`), so world generation can ask "is this direction on land?" and trees/rocks/tufts only spawn on continents that visibly exist on the baked texture. The shader is the source of truth; the JS is a hand-kept copy. Powerful and fragile — edit one side and the other silently lies.

## World generation

`generateWorld(seed)` (re-run via `useMemo` on seed change; `R` key rerolls with `Date.now() & 0x7fffffff`):
- `seededRandom(seed)` — a mulberry32-style integer-mixing PRNG (`Math.imul` xorshift), so each seed is a reproducible planet.
- `randomDir()` — uniform random unit vectors (uniform y, random azimuth).
- **Rejection-sampling scatter** with guard counters: coins avoid the spawn pole (`d.y > 0.93` rejected) and each other (`dot > 0.9`); trees/rocks/tufts must pass the `terrainAt` land bar, avoid the pole, and not crowd coins (`dot > 0.985`).
- The character is generated too: `generateFace(seed, {style})` from head_lab's hed module → face document + `hedDepthGrid` depth map → `buildPartRender(doc, faceDepth, 'planetrun', seed)` produces per-part Globe params + dyn/texture keys. **A new seed = a new planet AND a new person.**

## Game loop and state architecture

- **Sim lives in a ref** (`simRef: Sim`), mutated imperatively by the tick; React phase (`'ready' | 'playing' | 'won' | 'lost'`) is the only meaningful `useState`. The render is driven by a dummy `setTick(t => t+1)` once per tick — re-render-the-world-every-frame, with all derivation (euler extraction, rig pose, nearest-coin scan) done inline in the component body each render.
- **Tick:** the standard rAF-probe → `setTimeout(fn, 16)` loop (host has no rAF), `dt` clamped to [1, 50] ms, `performance.now()` with `Date.now()` fallback.
- **Input:** hmsc's bus pattern — `busOn('__keydown')`/`busOn('__keyup')` maintain a `keysRef` map (plus a `__shift` synthetic from the event's modifier flag); the tick polls the map. Restart keys (`R`, `Enter`) act on keydown directly through `beginRoundRef` (a ref holding the latest closure — the Pressable-stale-closure defense applied to bus handlers).
- **Per-phase behavior in one tick fn:** `playing` = turn (A/D, 160°/s) → roll quaternion (W/S, 2.8 or 5.4 m/s with SHIFT) → hop ballistics (SPACE, v0 5.4, g 13.5) → coin sweep → countdown; `ready` = attract mode, the planet idles around a lazy tilted axis (`quatAxisAngle([0.25, 1, 0.18], 0.12·dt)`).

## Character — the head_lab kit as a consumer

- The figure is head_lab's whole dressed rig: `buildRigFrame('neutral', pose, rigPhase, actions, 'armor', 'plain', [], 'slacks')` → `<FigureMeshes rig parts yawDeg lift>` inside the Scene3D, with `<CharacterCaptures headTexKey skinTexKey skin layers>` parked in the 2D tree (the offscreen face-unwrap + skin StaticSurface bakes the part meshes sample — same contract as hmsc's HumanoidFaceCaptures, different kit).
- Note the repo has **two humanoid systems**: hmsc's `render3d/humanoid` (used by hmsc + its labs) and head_lab's `figureRender` (used by planet_run, ragdoll_lab, head_lab). This cart uses the latter. Consolidation flag for the glossary.
- **Animation DSL:** gameplay events drive one-line declarative timelines parsed once at module scope — `'[0.5,right_arm,lift_and_bend;0.5,right_fist,clench]'` (fist pump on each collect), swing/tap/bounce/nod loops (win dance), `'[1.4,body,sit]'` (defeat). `parseAnimationDsl`/`sampleAnimationTimeline` live in `cart/animationDsl.ts` (head_lab's `animDsl.ts` is a pure re-export). Sampling is `t - eventStart` against the timeline, merged into `buildRigFrame`'s action list — gait pose and DSL actions compose.
- `figureYaw = headingDeg + 180` because parts face −Z at yaw 0.
- Walk gait: `gaitPhase` accumulates at 1.55 (walk) / 2.3 (run) cycles/s, `pose='walk'`, `rigPhase = gaitPhase % 1`.

## Camera, lighting, dressing

- **`<FollowCamera>`** from `@reactjit/cameras` (`runtime/cameras/index.tsx:66`, rig in `runtime/cameras/rigs/follow.ts` — pure `solve(params)` chase rig): trails the heading at distance 5.8, height 2.9, half-tracking the hop (`target=[0, hopY*0.5, 0]`). First surveyed cart actually using the cameras registry instead of hand-rolled trig.
- **`<Scene3D.Fog enabled={false} />`** — explicit opt-out of the always-on distance fog (the only off switch), correct here because the planet must stay crisp against space.
- Night `Scene3D.Skybox` (dark zenith/ground, faint blue horizon, tiny dim sun), ambient + directional + a warm point light over the player.
- Dressing: an orbiting moon (`Sphere`, position animated from `t`), a **contact shadow** under the figure — a flat dark cylinder with `material={{ color: '#000000', opacity: 0.32 }}`, which routes through the host's back-to-front transparent pass (`scene3d_color_a < 1`), and a **diegetic compass** — a small gold cone orbiting the player's head at the bearing of the nearest coin (`rotation={[90, bearing, 0]}` — lay flat, then yaw).

## Layout / hit-test discipline

- Trees render trunk+canopy inside a `<Fragment>`, NOT a wrapper Box — with an in-code comment explaining why: **the 3D pass reads meshes off the scene's DIRECT children; a wrapper View hides both meshes.** (Scene3D child-flattening rule — glossary-worthy.)
- Phase overlays (start/won/lost panels) are the root's last children — full-area absolute over everything, per the overlays-last hit-test rule.
- HUD is absolutely positioned 2D over the Scene3D: coins counter, countdown (color-staged white→gold→red at 20 s/10 s), nearest-coin meter.
- Import-path variant worth noting: this cart imports `@reactjit/runtime/primitives` (full path) where other carts write `@reactjit/primitives` — both resolve through the `--alias:@reactjit=runtime` catch-all in the bundler.

## What it does NOT use

No host physics (`__hmsc_*` or otherwise — hop is 5 lines of in-cart ballistics; no collision with trees/rocks, you ghost through them), no localstore (score/seed not persisted), no networking, no telemetry, no Tailwind, no `Scene3D.Instances` (≈45 props render as individual meshes — fine at this count), no hmsc humanoid (head_lab kit instead).

## Recurring shapes (glossary candidates)

1. **Move-the-world-not-the-player** — the player is fixed at the origin/pole; world state is one transform (here a quaternion) everything else derives from. The sphere-world variant of hmsc's flat "world flows past".
2. **Quaternion accumulate → euler extract matched to host order** — JS owns orientation as a quat, converts to YXZ-degree eulers because the host's `rotation` prop is the only interface. Any cart doing free 3D rotation repeats this; the YXZ order knowledge (`3d.zig` `T·Ry·Rx·Rz·S`) is load-bearing and currently lives in cart-side comments.
3. **Shader/JS twin terrain** — bake terrain in WGSL, hand-mirror the noise in JS for gameplay queries (spawn-on-land). The see-it==walk-it contract, lab-grade version (hmsc solved the same problem host-side with one height fn baked into mesh AND collider).
4. **Bake-once StaticSurface** — memo'd capture component + useMemo'd data/style = the disciplined opposite of billboard_demo's animate-by-rebake.
5. **Sim-in-ref + dummy setTick** — mutable sim object in a ref, one state-bump per tick to trigger render, all view math derived inline per render. THE cart game-loop state shape (massive_map_lab buffers camera in a ref the same way).
6. **keysRef polled by tick** — `__keydown`/`__keyup` bus → boolean map in a ref → the loop polls; discrete actions (restart) fire on the event itself through a latest-closure ref.
7. **Seeded PRNG + rejection-sampling scatter** — `Math.imul` mixer seeded for reproducible worlds; placement = loop {random candidate, reject by pole/spacing/land/crowding} with a guard counter.
8. **Animation-DSL event riding** — gameplay events record a start time; render samples `timeline(t − start)` and merges into the rig. Declarative one-string animations as game feedback.
9. **rrAF-probe / setTimeout-16** — fourth consecutive cart; universal.
10. **Fragment-for-multi-mesh** — multi-mesh world objects must be Fragments under Scene3D, never wrapper Views.
11. **Diegetic 3D UI** — the compass is a mesh in the scene, not a HUD element; positioned by gameplay math.
12. **Phase state machine + overlay-last** — `ready/playing/won/lost` enum, full-screen translucent overlay as root's final child.

## Quirks / honest caveats

- The whole scene re-renders every ~16 ms (the dummy setTick) — ~50 meshes' props recomputed per frame. Fine at this scale; it's the pattern the baked-world direction (`feedback_react_3d_is_authoring_not_runtime`) exists to outgrow.
- Module-scope `parseAnimationDsl` calls run at bundle eval — cheap, but means a DSL syntax error crashes at load, not at use.
- No collision with props: trees and rocks are scenery you walk through. Coins are the only interactive surface objects.
- The two-humanoid-systems split (hmsc `render3d/humanoid` vs head_lab `figureRender`) is now load-bearing in two shipped surfaces; whichever consolidation wins, this cart is the head_lab kit's reference consumer.
- `keys.space`/`keys.spacebar` fallbacks suggest uncertainty about the host's key-name for space (`' '` is the primary); harmless belt-and-suspenders.
