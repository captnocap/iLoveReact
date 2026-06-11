# head_lab — the character system: sculpt/paint editor + the shared figure kit

**Cart directory:** `cart/head_lab/` — 6 files, ~4,200 lines
- `index.tsx` (1,733) — the editor cart itself
- `parts.ts` (1,425) — body parts, skeleton, poses, clothing, hitboxes, anchors, `.body` documents
- `hed.ts` (488) — the `.hed` head-document format, face generator, face animations
- `ragdoll.ts` (355) — Verlet ragdoll solver + bone-record utilities
- `figureRender.tsx` (211) — the shared "put a figure in a game cart" kit
- `animDsl.ts` (1) — pure re-export of `cart/animationDsl.ts` (the real animation DSL module)

**Ship:** `./scripts/ship head_lab` · Dev: `./scripts/dev head_lab`
**Downstream consumers (verified by grep):** `cart/planet_run`, `cart/ragdoll_lab`, `cart/combat_lab`, `cart/pathing_lab` import parts/figureRender/ragdoll/hed. head_lab itself imports `cart/game_item_gallery` (held-item props).
**Save directory:** `cart/heads/` (`head_<stamp>.hed.json`, `body_<stamp>.body.json` via the fs hooks).

This is not a lab anymore — it's the **character subsystem** for the whole game effort, with an editor cart on top. Every humanoid in planet_run, ragdoll_lab, combat_lab and pathing_lab is built from these files.

## The core idea (the whole architecture in one paragraph)

Every body part is the SAME sculptable surface — a `Geometry.Globe` (radius-1 lathe sphere) wearing a different **silhouette profile** — and every part has a 2:1 equirect unwrap where **paint space IS texture space IS sculpt space**. A "nose" is not a picture of a nose: it's an ellipse at a canonical unwrap position that paints skin-shadow AND bulges geometry outward, because color and depth are stamped by the same shapes in the same coordinates. That single decision makes faces *generatable* (place shapes at anatomy positions with seeded variation → coherent by construction), *animatable* (transform the shapes → texture and sculpt move in lockstep), and *editable* (paint on the unwrap → mesh re-sculpts).

## hed.ts — the `.hed` document (the .sqi idea applied to heads)

- **`HedDocument`**: `kind:'hed', version:1` magic (cheap wrong-file rejection, same convention as `.sqi.json`), skin color, displacement `amount`, skull `scaleY`, a 48×24 quantized signed-byte `sculpt` grid (hand-sculpt residue), and N **feature layers**.
- **`HedLayer`** = shapes (+ color | null + signed depth + feather). `color: null` = depth-only invisible relief (brow ridge, cheekbones, eye sockets). `depth: 0` = paint-only (eye whites, iris, tears). Shapes are ellipses/rects in unwrap UV with optional `mirror` (auto-stamp across u=0.5 — eyes, brows, ears).
- **Seam wrapping**: `shapeCoverage()` wraps u-distance (`du > 0.5 → 1 − du`), so a shape at u=0 (the BACK of the head — the seam) stays one round piece. Back hair is literally a rect at cx=0.
- **`hedDepthGrid(doc)`** composites sculpt residue + every layer's feathered depth stamp into one clamped −1..1 grid of 48×24 — fed directly to `Geometry.Globe`'s `displace` param.
- **`generateFace(seed, {style})`**: mulberry32 PRNG → masculine/feminine proportion ranges, palette picks (5 skins/6 hairs/5 eyes/4 lips), 7 hair styles (crew/buzz/afro/bald/long/bob/bangs — gender-weighted pools), optional smile/stubble, and ~14 anatomy layers placed at canonical positions (brow ridge relief → carved sockets → painted eyes inside them → nose as the color+bulge coherence demo → cheeks/chin/jaw relief → ears at u=0.25/0.75 with depth 0.4 stick-out). Same seed = same face, forever.
- **`animateHed(doc, anim, phase)`** — face animation as a **pure document transform**: returns a new doc with affected layers replaced. `talk` (4-frame jaw flap with teeth on full-open), `yell`, `chew` (cheek wad bulging side to side — a depth-only layer!), `cry` (sad brows, lids, frown, two tears falling offset half a loop). Deterministic per (anim, phase) so texture/mesh keys stay **content-addressed: a looping animation cycles N cached bakes, not N×time**.

## parts.ts — one pipe, eight placements: the body

- **Six part ids:** `head, torso, pipe, hand, foot, finger`. The user's decomposition: ONE limb pipe placed eight times (upper/fore arms AND thighs/shins), wide flat blocks for hands/feet, fingers as tiny pipes. Sculpt the pipe once — both arms and both legs follow; one finger sculpt fans across both hands.
- **`PART_PRESETS`** — per-part Globe profile + scaleX/Y/Z. The scaleY comment block encodes the **detached-wrist lesson** (memory `globe_profile_radial_only`): Globe profiles thin the radial silhouette ONLY; length comes from scaleY alone, so no dragged/generated/clothing-shrunk profile can ever shorten a limb.
- **`buildSkeleton(shape, pose, phase, actions)`** → 25 named bones (`BoneId`), each `{position, rotation, scale, thickness, hitbox}`. Forward-kinematic chains hand-built in local space: torso → head/pelvis → hips/shoulders → elbows/knees → wrists → hands/feet, using `segmentEnd` (hang a segment off a joint at an angle) and `pitchBetween` (orient a bone along its joint pair). All rotation math composes in the **host's Ry·Rx·Rz order** (`rotateEulerVec` implements it explicitly).
- **8 body shapes** (`BODY_SHAPES`): neutral/female/male/tall/short/heavy/skinny/bodybuilder — pure multiplier records (height, shoulder, hip, torsoWide, limbLong, limbThick, head, hand, foot, plus `stance` for the femur angle: wide hips + sub-1 stance = knees converge).
- **5 authored poses** (stand/walk/kneel/flex/wave) + the **action system**: `RigTimelineAction[]` from the DSL modulate the skeleton — `actionWeight`/`actionPhase`/`actionOsc`/`actionArg` query the action list by (family, action, side) with target matching (`right_arm`, `both_fists`...). ~30 actions wired: punch (5 styles — jab/cross/hook/uppercut/body — each with chamber/thrust/follow-through keyframe targets blended by smoothstepped phase), guard, point, salute, wave_loop, swing_loop, kick, stomp_loop, crouch/sit/lay (posture drops), nod/shake/twist/bounce loops, and a full hand layer (clench, open, pinch, middle finger, thumbs-up, wiggle/crawl/jazz loops).
- **`assemblyFromSkeleton`** maps bones → part instances (which Globe goes where, with `thickness` making the same pipe sculpt render slimmer as a forearm than a thigh). **`fingerFan`** hangs 4 fingers + thumb off each palm's actual half-extents, with curl/extend/live-wiggle math per digit.
- **`anatomyFromSkeleton`** — joint "sockets": deltoid balls, elbow/hip/knee balls, pelvis egg, plus pecs (bodybuilder) and belly (heavy). All positioned **bone-relative** (`offsetBone`), with comments preserving the "phantom shoulders" lesson: absolute offsets strand anatomy at the origin when bones go world-space (ragdoll).
- **`buildClothing`** — clothing as primitive meshes (box/sphere/cone/cylinder specs, NOT Globes): 6 tops (underwear/tee/hoodie/dress/armor/suit), 5 independent bottoms (briefs/shorts/jeans/slacks/skirt) with `DEFAULT_BOTTOMS` snapping, 4 clothing prints (StaticSurface-baked tee graphics via `clothingSkinTextureKey`), 4 accessories (shades/cap/beanie/backpack). Leg tubes lerp along the ACTUAL hip→knee→ankle chain wearing the leg bones' rotations so pants track strides and kneels; thigh tubes start at t=−0.35 (up under the seat box) to kill the groin gap; female briefs are their own garment (low-rise panty + bra), not shrunken male boxes.
- **`buildHitboxes`** — every bone's hitbox box (combat_lab's bone-hitbox source). **`anchorsFromSkeleton`** — 10 semantic interaction anchors (face, face_grab, eyes, mouth, neck, palms, grab origins) each with role/radius/priority/`accepts` verb list (`['grab_face','cover_mouth','shove']`...) — the Hitman-style interaction targeting layer.
- **`buildRigFrame(...)`** — THE entry point: bones + assembly + clothing + anatomy + hitboxes + anchors in one `BodyRigFrame`. **`buildRigFrameFromBones(bones, ...)`** — the physics seam: same frame from a CUSTOM bones record; pose/phase never enter because the bones ARE the pose. This is what lets the ragdoll drive the whole dressed figure.
- **`.body` documents** — `buildBody/parseBody/serializeBody`: whole character (per-part sculpts + profiles + face layers + shape/clothing/pose/heldItem) under the same `kind`/`version` conventions.

## ragdoll.ts — Verlet physics because the host has none

Explicit framing in the header: the host's `<Physics>` is Box2D 2D-only and there are no 3D rigid bodies in the framework (see `docs/game/physics3d.md` — the Bullet module exists but is wired to nothing), so body physics is a small **position-based Verlet solver in cart TS**: 15 joints become particles (with per-joint mass — trunk heavy, hands light — and ground-collision radius), 24 distance constraints become the skeleton (stiff limb pipes, cross-braced trunk so the torso quad can't shear, head braces so the skull can't fold through the chest), 6 relaxation iterations per step, ground plane with friction+restitution, optional arena walls, and a **terminal-velocity clamp** (MAX_SPEED 32 — the comment records the lab's maiden flight where stacked uppercut impulses launched the body out of the world).

The bones-in/bones-out contract: `createRagdoll(liveBones)` seeds particles from any mid-animation frame (rest lengths from the canonical stand skeleton, so a mid-punch handoff never snaps segment sizes) → `stepRagdoll`/`ragdollImpulse` → `bonesFromRagdoll` rebuilds a full bone record (limb orientation = "+Y along the joint line" — valid because pipes are radially symmetric, no twist tracking) → `buildRigFrameFromBones` and the whole dressed figure tumbles. Plus the shared placement utilities every figure-placing cart uses: `offsetBones`, `placeBones` (yaw+translate a skeleton — exact because of host Ry·Rx·Rz order), `blendBones` (shortest-arc per-component lerp — the ragdoll→stand get-up blend), `ragdollMaxMotion` (at-rest detector), `ragdollCenter`.

## animDsl.ts → cart/animationDsl.ts — the one-line animation language

Grammar: `[duration,target,action,args;parallel...],[next step...]` — steps run sequentially, `;` actions run in parallel within a step, step duration = max of its actions. `parseAnimationDsl` normalizes via a big alias table (`arm`→`both_arms`, `l_fist`→`left_fist`, plus **vehicle aliases** — car/wheels/steering/suspension — the same DSL drives vehicle_lab). `sampleAnimationTimeline(timeline, seconds)` finds the active step and returns `SampledAction[]` with `phase` (0..1 through the action) and `weight = sin(phase·π)` — the universal ease-in-out envelope. `isAnimationTimelineLooping` = any `_loop` action (or `shake_in_air`) makes the whole timeline loop. The editor ships ~30 preset strings (`ANIM_PRESETS`) from `point` to `faceGrab` to `dance`.

## figureRender.tsx — the kit consumers actually import

Extracted "when ragdoll_lab became its second user" (the no-duplication rule executing itself). Three exports:
- **`buildPartRender(doc, faceDepth, cartKey, seed)`** → per-part `{params, dynKey, texKey}`: game-distance LODs (lighter than the lab's), head gets the face displacement + doc scaleY, dyn keys follow the **`"<slotId>~<version>"` contract** (3d.zig `dynSlotLocate` — the `~` is REQUIRED or the host silently drops the mesh), head texture key is per-seed, all other parts share ONE skin bake.
- **`<CharacterCaptures>`** — the two offscreen StaticSurface bakes (face unwrap composition + plain skin) parked at left:−99999; memo'd, bake-once.
- **`<FigureMeshes rig parts yawDeg lift offset>`** — assembly + anatomy as `Geometry.Globe` meshes with `dynamicKey` + `textureKey`, clothing as primitive meshes, whole-body yaw applied by rotating positions about Y and adding yawDeg to each ry (exact under host order).

## index.tsx — the editor cart

- **Layout:** left = part tabs + the unwrap painter (768×384 canvas); right = the selected part alone OR the assembled figure (`view` toggle), under an `OrbitCamera` (`@reactjit/cameras`) with hand-rolled drag-to-orbit handlers feeding yaw/pitch state.
- **The paint pipeline (the headline mechanism):** strokes paint **straight into a per-part GPU texture** via `usePaintable` (`runtime/hooks/usePaintable.ts` → host fns `__paintable_circle/clear/upload/readback`; importing the hook flips the build gate). The visible overlay is ONE `<Effect>` quad (`DEPTH_OVERLAY_WGSL`) sampling TWO paintable textures (`textures=[paints[selPart].id, relief.id]`): live stroke heat (blue=raise/orange=carve), contour rings of the current combined relief (topo line every 1/12 depth), and unwrap guide meridians. **React sees nothing until mouse-up**: stroke release does ONE `readback()` → average 4×4 blocks down to the 48×24 grid → `setPartGrid` bumps the part's `seq` → new `dynamicKey` → host re-sculpts the mesh through its dyn slot. Zero re-renders while brushing.
- **Per-part editing surfaces:** the head gets sculpt paint + **face-color paint** (strokes become `.hed` paint layers — points collected in a ref, committed on release as ONE layer with mirrored ellipses, undoable by popping the last `paint-*` layer). Non-head parts get an **outline editor** (drag the silhouette like a lathe — writes `__latchSet` host latches live, commits PROFILE_N radius samples on release) + detail paint. Plus **region sliders** (`SHAPE_REGIONS` — named anatomy zones per part: brow/eyes/nose/cheeks..., chest/belly/waist/hips...) that stamp parabolic-falloff bumps into the grid via `stampGrid`.
- **The latch system** (`setLatch` → host global `__latchSet`): sliders and outline drags write **host-side numeric latches** referenced from styles as `'latch:key'` strings — live visual feedback with ZERO React re-renders, state committed only on release. Third instance of the ref-buffer/commit-on-release shape in this one file.
- **Generate:** `generate face` (seeded face onto current body) and `generate character` (everything: shape, profiles fitted under clothing, body sculpt grids with per-shape stamps — pecs for bodybuilder, belly for heavy — clothing/bottoms/print/accessories/held-item rolls with coherence rules: dress→female, cap and beanie mutually exclusive, bodybuilder boots up flexing).
- **Animation stack in the editor:** face animations (`setInterval` 150 ms — **no rAF, and this cart uses intervals, not the rAF-probe**), rig walk clock (90 ms), DSL script clock (50 ms, `scriptFrame/20` seconds). A DSL `mouth` action (talk/chew/cry/yell) routes into the FACE animation system — `animateHed` rides the script's phase, so one timeline drives body AND face.
- **Content-addressed keys everywhere:** `headTexKey` = photo stamp + face id + anim + phase + skin + photo knobs; `partDynKey` = seq + face id + anim/phase + amount + region signature. Comment credits "the carve_lab stale-bake lesson." Looping animations therefore hit a small cycle of cached bakes.
- **Perf isolation:** `PartMeshes` is memo'd HARD with one stable `partRender` bundle — an orbit drag re-renders ONLY the camera node; ~14 sculpt-vertex-carrying mesh nodes re-diff only on sculpt/knob/anim changes ("same perf isolation hmsc's GameWorld3D uses").
- **File I/O:** `useFileDrop` routes `.body.json` → whole character load, `.hed.json` → head load, anything else → face **photo** (an `<Image>` composited under the layers in the unwrap — paint depth over a photo). Save via `mkdir`/`writeFile` from the fs hooks into `cart/heads/`.
- **Held items:** imports `ITEMS` + `TextureSources` from `cart/game_item_gallery`; `HeldGameItem` renders the item's `model(ctx)` at the right hand with a per-item scale table — cross-cart item-model reuse (the scape3d "items have hand-authored 3D models" idea, hmsc-side).
- **Paintables must sit outside flex flow** (parked in an absolute box at −99999) — a bare host node in the flow takes proportional-fallback space and blows up the layout (the in-file comment preserves this footgun).

## Recurring shapes (glossary candidates)

1. **Shared-unwrap-space documents** (`.hed`/`.body`/`.sqi` family) — color+depth from the SAME shapes in the SAME UV space; `kind`+`version` magic; quantized signed-byte grids; JSON on disk; drop-back-in round-trip. THE content format pattern.
2. **One surface, many silhouettes** — every body part is the same Globe + profile; sculpt once, reuse mirrored/repeated. Radial-only profiles (length never coupled) is load-bearing.
3. **Content-addressed bake keys** — texture/dyn keys as pure functions of inputs; animations cycle N cached bakes. The anti-stale-bake discipline.
4. **GPU-paint / readback-on-release** — usePaintable host textures for live brushing, ONE readback per stroke, React state only at commit. Sibling of the latch system and the ref+flush camera (massive_map_lab): the repo-wide "keep high-frequency input out of React" family.
5. **Host latches (`'latch:key'` styles + `__latchSet`)** — live UI feedback with zero re-renders; commit on release.
6. **Bones-as-interface** — skeleton record in/out everywhere: poses build bones, ragdoll rebuilds bones, `buildRigFrameFromBones` dresses ANY bones. Physics, animation and rendering decouple through one type.
7. **Animation DSL** — `[dur,target,action;...]` strings → sampled actions with sin-envelope weights → skeleton modulation. Shared body/face/vehicle vocabulary (the alias table already speaks car).
8. **Semantic anchors** — named, role-tagged, verb-accepting interaction points on the body (face_grab accepts grab_face/cover_mouth/shove) — the interaction-targeting layer combat/scape want.
9. **Verlet-in-cart physics** — particles+constraints in TS as the standing answer to "no 3D physics in the host" (vs the dormant Bullet module).
10. **Editor-cart pattern** — the lab IS the editor; game carts import the kit (figureRender), not the editor. Extraction happened at the second consumer.
11. **Memo'd mesh bundle vs camera state** — isolate sculpt-heavy mesh subtrees from orbit-drag re-renders via one useMemo'd props bundle.
12. **interval clocks, not rAF-probe** — this cart drives animation with `setInterval` at three rates (150/90/50 ms); the rAF-probe is the GAME loop idiom, intervals are the EDITOR idiom.

## Quirks / honest caveats

- `index.tsx` and `figureRender.tsx` each define their own `PartRender` type, `clothingGeometry` helper, and layer-paint component (`HedLayerPaint` vs `FaceLayerPaint` — near-identical); the editor predates the kit extraction and was never re-pointed at it. Mild drift hazard, flagged for the consolidation pass.
- `PART_LOD` exists twice with different values (editor close-up LODs in index.tsx vs game-distance LODs in figureRender.tsx) — intentional, but the same name in two files invites confusion.
- The hooks-in-a-loop pattern (`usePaintable` per PART_IDS entry) is safe only because PART_IDS is a module constant — preserved by an eslint-disable with the reasoning inline.
- `paints` is rebuilt every render and captured by `useEffect` closures — works because handles are stable per id, but it reads as a trap.
- The skeleton is forward-kinematics only — no IK; foot placement during posture drops (sit/lay) is hand-tuned, not solved.
- `anatomy` dyn keys get `.anatomy.${i}` suffixes in the editor's PartMeshes but NOT in figureRender's FigureMeshes (it reuses the part's dynKey directly — fine, same geometry, but the asymmetry is another editor/kit drift datum).
