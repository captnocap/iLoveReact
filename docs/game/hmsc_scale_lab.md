# hmsc_scale_lab cart inventory

Source cart: `cart/hmsc_scale_lab.tsx`

Reviewed: 2026-06-04

## High-level purpose

`hmsc_scale_lab` is a measurement instrument, not a game. It renders the HMSC player figure inside a 3D "scale room" — a meter ruler, colored reference blocks (asphalt lip, sidewalk curb, two ledges), a door frame, and horizontal height lines — so a human can visually verify that every world metric in `cart/hmsc/world/scale.ts` (`HMSC_SCALE`) agrees with the player's painted body. It answers questions like "does the physics capsule actually cover the visible figure?", "is the door taller than the hat?", "where does the step height land against a curb?" by putting all of those numbers in one scene at true relative size.

It is the visual enforcement end of the HMSC scale contract (1 tile = 1.00m, the player is the fixed human anchor). The numbers live in `scale.ts`; the lab draws them; a human eyeballs the agreement. Nothing here writes anything anywhere — no disk, no localstore, no network. The only state is the orbit camera.

Interaction: drag anywhere to orbit, `+`/`-` to zoom, keys `1`–`4` (or the on-screen buttons) for camera presets (front/side/top/three-quarter). A HUD legend panel maps every colored line to its metric and prints the live values.

## Files touched by this behavior

The cart itself:

- `cart/hmsc_scale_lab.tsx`: everything cart-specific — scene composition, orbit camera state, keyboard/drag input, HUD legend. 300 lines, single component `HmscScaleLab` plus seven small local components (`MeterBlock`, `DoorFrame`, `RulerTick`, `HeightLine`, `GroundGrid`, `LabelSwatch`, `CameraButton`).

The shared HMSC modules it consumes:

- `cart/hmsc/world/scale.ts`: `HMSC_SCALE` — the single source of truth for world metrics (tile=1m, capsule 1.65m×0.34r, step 0.35m, door 1×2.4m, story 3m, car/bus/room dimensions). The lab reads 9 of its fields. Other consumers of the same object: `cart/hmsc/world/{buildings,structures,interiors,propKinds,placementCheck,roadProfile,buildingKinds,grid}.ts`, `cart/hmsc/render3d/{GameWorld3D,Building}.tsx`, `cart/hmsc/state/defaults.ts`, and `cart/hmsc_massive_map_lab.tsx` — this lab is the visual checker for the constants all of those build on.
- `cart/hmsc/render3d/PlayerFigure.tsx`: the player model. Now a 23-line thin wrapper: gait pose (`drivePose`) → skeleton solve (`solveHumanoid` with `PLAYER_FACE_KEY`) → `<Figure rig palette={PLAYER_PALETTE} marker>`.
- `cart/hmsc/render3d/humanoid/` (via its `index.ts` barrel): the shared humanoid module —
  - `skeleton.ts`: `solveHumanoid()` solves a pose into world-space joints and emits BOTH render parts (`rig.parts`) and hit capsules (`rig.zones`) from the same joints. All limb math is plain JS trig (`rotateY`/`rotateX`/`segmentPose`).
  - `pose.ts`: `drivePose(seconds, moving, running)` — the one gait. This lab passes `(0, false, false)`, so only the idle branch executes; the figure is a statue.
  - `Figure.tsx`: the ONE humanoid renderer — maps `rig.parts` to `<Scene3D.Mesh>`, resolving each part's `MaterialSlot` through a palette; draws the teal position marker (cylinder + torus) when `marker` is passed.
  - `palette.ts`: `PLAYER_PALETTE` (slot → hex color). NPC palettes exist in the same file but are only used here indirectly (face pool, below).
  - `face.tsx`: `HumanoidFaceCaptures` + `PLAYER_FACE_KEY` — the baked face decal pool (see "Face pipeline").
- `runtime/hooks/useIFTTT.ts`: `busOn()` (line 207) — the keyboard subscription rides the IFTTT event bus.
- `runtime/primitives.tsx`: `Box, Col, Row, Text, Pressable, Scene3D` (Scene3D wrapper section starts line 405; `Scene3D.Mesh` geometry shipping lines 535–708).
- `runtime/geometries/` (`@reactjit/geometries`): `Box`, `Cylinder`, `Sphere`, `Cone`, `Torus`, `Head` generators + the intern cache (`intern.ts`).

Host (Zig) machinery underneath (none called by name in the cart — all reached through primitives/event plumbing):

- `framework/engine.zig`: SDL3 keydown → `callGlobalInt("__ifttt_onKeyDown", packed_key)` at line 4237.
- `v8_app.zig`: handler installation `__dispatchEvent(id,'onMouseDown'/'onMouseMove'/'onMouseUp')` (lines 2429–2436); `scene3d*` prop consumption; `staticSurface`/`staticKey` (lines 1753–1755); `scene3dTexKey` (line 1929).
- `framework/gpu/3d.zig`: the wgpu render-to-texture 3D pipeline that consumes the `scene3d_*` node flags; resolves `scene3d_tex_key` → baked texture at line 1382.
- `runtime/index.tsx`: `__dispatchEvent` (line 426) and `getPointerPayload` (line 372) — the JS half of pointer events.

## Duplication finding (important)

**`cart/hmsc/labs/ScaleLabScene.tsx` is a near-verbatim orphaned copy of this cart's scene.** It re-implements `MeterBlock`, `HeightLine`, `RulerTick`, `DoorFrame`, the capsule meshes, the ground slab, and all the height lines — offset by a `labX/labZ` origin so it could be embedded inside another scene — and **nothing imports it** (grep finds zero consumers). It has already drifted: the purple height line there uses `PLAYER_VISUAL_TOTAL_HEIGHT` (2.45m) where the cart draws it at `PLAYER_VISUAL_HEAD_TOP` (2.04m). Same names, same shapes, divergent values, no canonical owner. For the glossary effort this is a textbook case: the "scale reference scene" wants to be one shared module that both the standalone cart and any in-game embed import, or the orphan should be deleted.

A second, subtler duplication: the cart's `PLAYER_VISUAL_*` constants (lines 15–17: shoe bottom −0.16, head top 2.04, hat top 2.29) are **hand-transcribed** from geometry in `skeleton.ts` (head capsule top `[0, 2.04, 0]` at line 207; hat cone center 2.12 + height 0.34 → apex 2.29; foot sphere at shin end −0.03 with radius 0.155 ≈ −0.16 dip). Nothing ties them together — if the skeleton's proportions change, the lab's purple/yellow lines silently lie. `ScaleLabScene.tsx` repeats the same transcription a third time. These want to be exported from the humanoid module (it already exports the hitbox numbers) so the ruler can't drift from the body.

## Host functions vs JavaScript functions

The cart source contains **zero direct host calls** — no `callHost`, no `__fs_*`, no `__exec`. Every host interaction is mediated:

**Keyboard (host → JS push, via the IFTTT bus).** `useEffect` (lines 185–196) subscribes `busOn('__keydown', handler)` and returns the unsubscribe directly as the effect cleanup. The path: SDL3 keydown in `framework/engine.zig:4237` → `callGlobalInt("__ifttt_onKeyDown", packed)` where `packed = keysym | (modifiers << 16)` → `runtime/hooks/useIFTTT.ts:371` installs that global and decodes the int into `{key, ctrlKey, shiftKey, altKey, metaKey}` (`decodeKey`, line 352 — SDL3 keysym table, printable ASCII lowercased) → `emit('__keydown', ev)` → every `busOn` subscriber. So a key event costs one Zig→JS call and fans out in JS. The cart matches `'1'`–`'4'` (presets) and `'-'/'='/'+'` (zoom, ±0.45 clamped to [3.4, 10]). Note `key` is already lowercased by the decoder; the cart's `.toLowerCase()` is belt-and-braces.

**Pointer drag (host hit-test → JS pull).** The root `Pressable` carries `onMouseDown/onMouseMove/onMouseUp` (lines 224–226). At CREATE time `v8_app.zig:2429–2436` sees those handler names and installs `js_on_mouse_*` expressions — `__dispatchEvent(<nodeId>,'onMouseMove')` etc. The host does hit-testing and evals the expression; `__dispatchEvent` (`runtime/index.tsx:426`) builds the payload by **pulling** coordinates from host getters — `getMouseX()` / `getMouseY()` / `getMouseDown()` (`getPointerPayload`, `runtime/index.tsx:372`) — and dispatches through alias resolution (`onMouseMove` ≡ `onPointerMove`, etc.). So `event.x`/`event.y` in the cart are window-pixel coordinates fetched from the host at dispatch time, not carried in the event.

**3D rendering (declarative props, no calls).** `<Scene3D>` and children are plain `View` nodes with `scene3d*` props (`runtime/primitives.tsx:405+`); `framework/gpu/3d.zig` reads `node.scene3d_*` off the layout tree each frame and renders to texture, composited back as a quad. Camera position changes are just prop diffs — orbiting re-renders React, ships 3 floats, no geometry re-uploads.

**Geometry (JS generates, host caches).** Every `Scene3D.Mesh geometry={Geometry.X} params={...}` runs the TS generator **once per unique params** via the intern cache (`runtime/geometries/intern.ts`); the first mesh for a key ships `{key, vertices, count}` across the bridge, every subsequent mesh ships only the key (`primitives.tsx:665–693`). This matters here: the 30+ minor ruler ticks share one `Box{0.54×0.018×0.035}` key — one vertex payload, 30 cheap references. All params in this cart are constants, so the intern cache stays bounded (the geometry-intern OOM rule — unit params + scale transforms — is respected by never animating params).

**Pure JS, no host involvement:** orbit math (`cameraFromOrbit`, spherical → cartesian with hardcoded center offsets), `clamp`, drag delta accumulation in a `useRef`, the entire skeleton solve (`solveHumanoid` — rotation matrices, segment chains), the gait (`drivePose` — `Math.sin/cos`), hex→RGB conversion (`_hexToRgb` in primitives), and palette hashing. The skeleton re-solves on every render (every camera move) — ~30 parts of trig per frame, trivial.

## Scene content (what is actually drawn)

All meshes are `Scene3D.Mesh` with registry geometry + hex `material` (converted JS-side to `scene3dColorR/G/B` floats). One `Scene3D.Camera` (fov 42), one ambient + one directional light. `showGrid={false} showAxes={false}`; fog is **not** opted out (`Scene3D.Fog` absent), but at ~6.5m camera distance the auto-derived fade never visibly engages.

- **Ground**: an 8.4×5.4m slab at y≈−0.018, plus `GroundGrid` — 9×9 thin box lines at `TILE_SIZE` (1m) spacing, axis lines lighter (`#94a3b8`), others dark. The grid IS the "1 square = 1m" claim in the HUD.
- **Physics capsule ghost**: a translucent-looking (actually opaque dark blue) box 0.68×1.65×0.68 at z=0.72 beside the figure, with two cyan cylinder discs marking the capsule's foot and head planes. This is `playerCapsuleHeightMeters` × `playerCapsuleRadiusMeters` made visible.
- **The player figure** at origin, yaw 180 (facing the default camera), `animationSeconds=0, moving=false, running=false` → idle pose statue. Rendered through the full shared pipeline (pose → skeleton → Figure → ~22 meshes: cylinder limbs, sphere joints/head-or-Head-decal, box torso, cone nose + hat, teal marker discs).
- **Reference blocks** (`MeterBlock` = colored box + white cap plate): asphalt 0.08m, sidewalk 0.11m, ledge-a 1.2m, ledge-b 1.6m, at x = 1.35/2.35/3.05/4.05. Note `MeterBlock` takes a `label` prop it never renders — labels exist only in the HUD legend (a 3D text label was presumably planned; dead prop).
- **Door frame** (`DoorFrame`): two amber jambs + lintel sized from `HMSC_SCALE.doorWidthMeters`/`doorHeightMeters` (1×2.4m) at x=5.25.
- **Height lines** (`HeightLine` = 5.6m-wide flat box at z=−0.92, behind the figure): eleven of them — ground 0, step 0.35, ledge A 1.2, ledge B 1.6, capsule top 1.65, human band 1.7/2.0, visual head top 2.04, hat top 2.29, door 2.4, story 3.0. Each color matches its HUD swatch.
- **Ruler**: 34 ticks at 0.1m intervals (`Array.from({length: 34}, ...)`, keyed `tick-<y>`), major (wider, white) where y is integer; plus a 3.3m vertical pole at x=−2.8.

The ledges are deliberately a pair: 1.2m (vaultable-ish) vs 1.6m (capsule-height-ish), with the HUD printing their 0.40m delta — these are the climb/vault tuning references, the two heights `HMSC_SCALE` does *not* own (they're lab-local constants, lines 24–25).

## Face pipeline (the one subtle subsystem here)

The figure's head is not a plain sphere — `PlayerFigure` passes `PLAYER_FACE_KEY` into `solveHumanoid`, which swaps the head part to **`Geometry.Head`** (`runtime/geometries/Head.ts`): a sphere whose UVs planar-project a flat texture onto the front (−Z) hemisphere and clamp back-hemisphere UVs to the texture's border circle (the Animal Crossing/Mii decal trick — border pixels wrap the back of the head, so face textures are authored with plain-skin borders and a hair-shadow top band).

The texture that key resolves to is baked 2D UI: `HumanoidFaceCaptures` (`cart/hmsc/render3d/humanoid/face.tsx:218`) is mounted at line 266 of the cart as a **2D sibling of the Scene3D** (the comment in `PlayerFigure.tsx:15–17` makes this a contract: any mount drawing the figure must also mount the captures). It renders the player face plus all 4×6 NPC palette×feature combinations as `StaticSurface` nodes parked off-screen at `left: -99999`, each a `FACE_PX`(96)-square composition of plain `Box`es (eyes/brows/mouth/stubble — no images, no canvas). The StaticSurface→textureKey pipeline does the rest: `staticKey` (`v8_app.zig:1755`) bakes the painted subtree to a GPU texture; the head mesh's `textureKey` ships as `scene3dTexKey` (`v8_app.zig:1929`); `gpu/3d.zig:1382` samples it. `Figure.tsx:29` renders any textured part white so the bake's colors read true. Identities are static (memoized components, hoisted style objects) so the pool bakes once and never re-bakes — the StaticSurface inline-prop rebake trap deliberately dodged.

So this little ruler cart incidentally exercises: 2D-composition→GPU-bake→3D-decal, the full shared-humanoid solve, and the geometry registry — which is exactly why it's a good canary cart.

## Camera model

State is one `useState` object `{yaw, pitch, distance, preset}` (line 171) plus a `useRef` for drag anchor. `cameraFromOrbit` (line 38) converts spherical→cartesian and adds a hardcoded center offset `[+0.9, +1.1, +0.2]` — which does **not** equal `cameraTarget = [0.85, 1.05, 0.02]` (line 170). The orbit pivots around a point ~6cm off from where the camera looks; harmless at this scale but it's the kind of near-duplicate constant the glossary pass exists to flag. Presets are just four hardcoded `{yaw, pitch, distance}` tuples (line 176).

Drag follows the **pointer-capture idiom**: `onMouseDown` + `onMouseMove` + `onMouseUp` all on the SAME node (the full-screen root `Pressable`) — required because move/up handlers on other nodes don't get capture in this runtime. Deltas scale by `CAMERA_DRAG_SPEED` (0.006 rad/px); pitch clamps to [−0.12, 1.34] (no under-floor, no gimbal flip). One quirk: dragging keeps `preset` unchanged, so a preset button stays highlighted after the camera has been dragged away from it.

## HUD / 2D layer

Two absolutely-positioned `Box` panels rendered **after** the Scene3D inside the root Pressable (overlays-as-last-children, the hit-test/paint-order rule):

- Top-left legend (368px): title, the "1 grid square = 1.00m" anchor sentence, eleven `LabelSwatch` rows (12px color chip + bold label + value text, every value computed live from the same constants the meshes use — `toFixed(2)` formatting), the ledge delta line, and a car/bus dimensions line read straight from `HMSC_SCALE.car`/`.bus` (the only place those render — no car mesh in the scene).
- Top-right camera panel: four `CameraButton` Pressables (selected styling driven by `camera.preset`) + the "drag to orbit, +/− zoom" hint.

All styling is inline objects — no `className`/Tailwind anywhere in this cart. Layout primitives only (`Box`/`Col`/`Row`/`Text`).

## What is not here

- No host fn calls by name, no `callHost`, no fs/localstore/SQLite/HTTP/clipboard/`__exec`.
- No persistence — camera state resets every launch.
- No animation loop — no `setInterval`, no rAF (doesn't exist anyway); the figure is frozen at `animationSeconds=0`. The scene only re-renders on input.
- No physics — the capsule is a picture of the collider, not a collider.
- No `Effect`/WGSL, no `Canvas`/`Graph`, no `StaticSurface` of its own (the face captures bring theirs).
- No NPCs — `NPC_PALETTES` faces get baked into the pool by `HumanoidFaceCaptures` anyway (24 unused 96px bakes; negligible, but the pool is all-or-nothing by design).
- No use of `Geometry.Humanoid` (the registry's baked humanoid) — the figure here is the parts-based skeleton, a different (and the canonical HMSC) humanoid path.

## Integration-relevant observations

- **`HMSC_SCALE` is the metric hub** — one object, ~15 consumers across world/render/state. The lab is its *verification surface*. Recurring shape: "constants module + visual lab that draws the constants." `combat_lab`, `camera_lab`, `physics_lab` are siblings of this pattern; whatever glossary entry covers "lab cart" should note that a lab's job is to make a contract *visible*, and that the lab must derive everything it draws from the contract module or it rots (see the hand-transcribed `PLAYER_VISUAL_*` constants, which already violate this).
- **The shared-humanoid module is the model of "one category, solved once"**: one skeleton produces mesh AND hitbox from the same joints (cannot drift), one renderer recolors via palettes, one face pool guarantees any key resolves. This is the same instinct as the scape3d thingymajigger model and the buildings-are-one-category rule — it should be a top-level glossary concept ("solve the shape once, derive every consumer from the solve").
- **Bus-mediated keyboard (`busOn('__keydown')`) is the standing global-key idiom** — same channel hmsc-int's WASD pan uses. Packed-int host→JS push, decode once, fan out in JS.
- **Pull-based pointer payloads**: mouse events don't carry coordinates; JS pulls `getMouseX/Y` from the host at dispatch. Anything that wants historical/queued positions can't get them from this path.
- **Geometry-registry shipping discipline** (intern key, verts-once, constant params) is what lets a scene casually use 80+ meshes. The recurring rule: params are *unit-ish constants*; anything animated belongs in position/rotation/scale.
- **The face decal stack (2D Boxes → StaticSurface bake → textureKey → Head decal UV)** is a full vertical slice of the "2D on 3D faces" capability and recurs in every cart that draws humanoids (hmsc gameplay, both labs, combat_lab via head_lab figures). The contract "mount `<HumanoidFaceCaptures/>` next to your Scene3D" is documented only in a comment in `PlayerFigure.tsx` — a glossary-level invariant.
- **The orphan `ScaleLabScene.tsx`** should be reconciled (deleted or made the shared source for this cart) before the pattern propagates further.

## Glossary

Capsule ghost: The box+disc visualization of the player's physics capsule (`playerCapsuleHeightMeters` × `playerCapsuleRadiusMeters`) drawn beside the figure so collider-vs-art coverage is eyeballable.

Face pool: The complete set of baked face textures (player + every NPC palette×feature combo) mounted statically by `HumanoidFaceCaptures` so any figure's `faceKey` always resolves. Bakes once; identities are static by construction.

Head decal: `Geometry.Head` — a sphere whose front hemisphere planar-samples a flat face texture and whose back hemisphere clamps UVs to the texture border (border pixels = skin/hair wrap). The Mii/Animal Crossing register.

Height line: A flat, wide, thin box at a fixed world y behind the figure — the 3D equivalent of a horizontal rule, color-keyed to a HUD swatch. The lab's core visualization unit.

HMSC_SCALE: The world-metric contract object (`cart/hmsc/world/scale.ts`). 1 tile = 1m; capsule, step, door, story, vehicle, room dimensions. Single source of truth; this lab is its checker.

Lab cart: A standalone cart whose purpose is making a contract visible/tunable rather than being gameplay. This one verifies scale; siblings verify cameras, physics, combat.

Material slot: The named region (`skin|shirt|pants|shoe|hat|eye|belt|nose|marker`) a rig part paints; a palette maps slots → colors, so one skeleton recolors into any character.

Meter block: A reference-height colored box with a white cap plate — a physical "this is N meters" exhibit (asphalt/sidewalk/ledges).

Orbit camera (lab-style): `{yaw, pitch, distance}` state + spherical→cartesian conversion in JS, presets as hardcoded tuples, drag via same-node mouse capture, zoom via bus keyboard. Entirely cart-side; the host just receives the resulting camera position props.

Packed key event: The host's keydown payload — one int, keysym in the low 16 bits, SDL modifier mask in the high 16 — decoded JS-side (`useIFTTT.ts decodeKey`) and emitted on the `__keydown` bus channel.

Rig: The output of `solveHumanoid` — `{parts, zones, eye}`: render meshes, hit capsules, and the vision origin, all in world space from one solve so they can never disagree.

Ruler tick: The 0.1m-spaced tick marks (wider+white at whole meters) forming the lab's vertical ruler.

Visual constants (`PLAYER_VISUAL_*`): Hand-copied figure extremes (shoe bottom −0.16, head top 2.04, hat top 2.29) the skeleton doesn't export — the lab's known drift risk.
