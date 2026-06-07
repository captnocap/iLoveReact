# CLOTHSPLIT-0606 phase 2 CAPTURE — editor separation parity table

USER RULING (req_0040), verbatim: "have someone move clothing into its own
thing that is decoupled from the body. i dont like it / find it useful to go
to the body editor and then have to turn off the clothing that is in place
just to edit the mesh, and clothing should effectively be a prop that is
seperate but tightly related, not entirely coupled. same with animation. the
fact that when im on the mesh editor and i have animation commands to see is
a problem."

Phase 1 (`f66ead7c3`) decoupled the DATA (outfit attachment family,
`game/figure/outfit.ts`; `buildMeshFrame` in rig.ts). This phase relocates
the EDITOR: the character (mesh) context shows MESH ONLY; CLOTHING and
ANIMATION become their own WorkbenchSources over the SAME
`characterWorkbenchStore()` — same draft, same autosave/undo/V20 doors, same
roster (the outfit is per-character; the rosters mirror).

The COVERAGE LAW deliverable (the WBCHAR.CAPTURE.md bar): every clothing- or
animation-flavored control in the pre-split character source, line-referenced
against the pre-split files (panel.ts / Stage.tsx / store.ts at `e694aa488`),
each with its named NEW home. Nothing disappears.

The three contexts (gutter-1 icons):

- **character** (`User`) — the MESH context: identity, part, body shape,
  face mesh, sculpt, regions. Stage = the UNDRESSED figure
  (`buildMeshFrame` — no garments, no held item, no animation clocks).
  Lenses FIGURE/PART/SCULPT/PAINT unchanged (they are mesh lenses).
- **clothing** (`Shirt`) — the wardrobe ATTACHMENT context: outfit +
  extras + held prop. Stage = the DRESSED figure (mesh + attachOutfit via
  `buildRigFrame`) on the current body, static pose.
- **animation** (`Clapperboard`) — the rig/posing context: pose, face anim,
  rig anim, script + presets. Stage = the dressed, ANIMATING figure (all
  clocks live HERE and only here).

Landing legend — **P(ctx)** panel group in that context · **S(ctx)** stage of
that context · unchanged rows named in §4 so nothing is silently assumed.

## 1. Panel rows that move (pre-split `characters/panel.ts`)

| # | source (pre-split) | capability | new home |
|---|---|---|---|
| W1 | panel.ts:73 | BODY · `shape` enum (BODY_SHAPES) | **STAYS P(character) BODY** — DECIDED mesh-side: the shape reshapes the skeleton/parts (it is body truth, not wardrobe). Setter keeps its flip-to-FIGURE gesture (a shape pick shows the whole figure). Surfaced for veto. |
| W2 | panel.ts:74 | BODY · `clothes` enum (CLOTHING; DEFAULT_BOTTOMS coupling in setter) | **P(clothing) OUTFIT · clothes** — coupling kept in the same store setter |
| W3 | panel.ts:75 | BODY · `bottoms` enum (BOTTOMS) | **P(clothing) OUTFIT · bottoms** |
| W4 | panel.ts:76 | BODY · `print` enum (CLOTHING_SKINS) | **P(clothing) OUTFIT · print** |
| W5 | panel.ts:80-88 | EXTRAS · per-accessory bool, cap⇄beanie exclusivity | **P(clothing) EXTRAS** — same `toggleAccessory` door, exclusivity intact |
| W6 | panel.ts:90-98 | PROP · `held` enum (none + GAME_ITEMS + ◆ sculpted /items) | **P(clothing) PROP** — DECIDED clothing-side: a held item is an attachment riding the bones, the outfit's sibling ("clothing should effectively be a prop"). Surfaced for veto. |
| A1 | panel.ts:115 | ANIMATION · `rig` pose enum (BODY_POSES) | **P(animation) POSE · rig** |
| A2 | panel.ts:116 | ANIMATION · `anim` bool (+ setLens('figure')) | **P(animation) POSE · anim** — the lens flip is DROPPED: the animation stage always shows the animating figure (structural fulfillment, see §3 F1) |
| A3 | panel.ts:118-124 | `face anim` enum, gated `isHead && d.face` | **P(animation) FACE · face anim** — gate becomes `d.face` only (part selection is a mesh concern; the animation context has no part) |
| A4 | panel.ts:126 | ANIMATION · `script` text | **P(animation) SCRIPT · script** |
| A5 | panel.ts:127 | `play` bool (+ setBodyRigAnim(false) + setLens) | **P(animation) SCRIPT · play** — the clock exclusivity (play stops rig anim) is KEPT; the lens flip dropped (§3 F1) |
| A6 | panel.ts:128 | `reset script` act | **P(animation) SCRIPT · reset script** |
| A7 | panel.ts:129-133 | ANIM_PRESETS act shelf (apply + autoplay + stop rig anim) | **P(animation) SCRIPT · one act per preset** — apply + autoplay + exclusivity kept; flip dropped |

## 2. Stage machinery that moves (pre-split `characters/Stage.tsx`)

| # | source (pre-split) | capability | new home |
|---|---|---|---|
| S1 | Stage.tsx:155-159 | face-anim 150ms clock | **S(animation)** `DressedStage` — the mesh stage NEVER ticks |
| S2 | Stage.tsx:160-164 | body-rig 90ms clock | **S(animation)** |
| S3 | Stage.tsx:165-171 | script 50ms clock + frame-zero reset on script change | **S(animation)** |
| S4 | Stage.tsx:173-182 | GAME_ANIMATION timeline parse/sample + non-looping auto-stop | **S(animation)** — identical computation |
| S5 | Stage.tsx:184-195 | scriptMouth beats manual face anim (activeAnim/phase fold) | **S(animation)** — identical; the mesh stage pins anim='still', phase=0 |
| S6 | Stage.tsx:237-241 | `buildRigFrame(...)` — the DRESSED rig | **split**: mesh stage mounts `buildMeshFrame` (UNDRESSED — garments never render there again); the dressed rig lives in `DressedStage` (clothing = static `bodyPose`, animation = animating) |
| S7 | Stage.tsx:578 | `HeldItemMeshes` (figure view, draft.heldItem) | **S(clothing) + S(animation)** — the prop demonstrates with the outfit and rides the animating hand |
| S8 | Stage.tsx:588 | `hitboxes` viewport chip | **STAYS S(character)** — hit volumes/anchors are mesh truth |
| S9 | Stage.tsx:753-766 | CharacterEditorCaptures (head/skin/segment keys; mounts ClothingSkinCaptures) | **every stage** via the shared `FigureCaptures` (figureFrame.tsx) — ONE derivation; `skinTextureKey` keeps its clothing/bottoms/bodyShape content-addressing on all three stages so PartMeshes texKey ↔ capture keys stay in lockstep |
| S10 | Stage.tsx:91-93, 237 | animFrame/rigFrame/scriptFrame state + bodyPhase | **S(animation)** — mesh stage has no clock state at all |

## 3. Store gestures that change meaning (pre-split `characters/store.ts`)

| # | source (pre-split) | capability | new home |
|---|---|---|---|
| F1 | store.ts:362-368 | `wearLens()` — wardrobe/pose/prop picks flip the lens to FIGURE ("show me what I changed") | **structurally fulfilled**: the clothing and animation stages ALWAYS show the dressed figure, so the gesture's purpose is built into the context. The flip is REMOVED from setClothing/setBottoms/setClothingSkin/toggleAccessory/setHeldItem/setBodyPose — a pick in the clothing context must not yank the mesh context's lens (the TWIGSTATE failure class). KEPT on setBodyShape (W1, mesh-side). |
| F2 | store.ts:129-132 | faceAnim/bodyRigAnim/animScript/scriptPlaying twigs ('/characters' keys) | **unchanged keys** — the state stays in the shared store; only the SURFACE reading them moved. Saved anim view state carries across the split. |
| F3 | store.ts (camera via useSculptCamera) | '/characters' camera twig keys | mesh stage unchanged; the new stages get their OWN twig namespaces (`/clothing`, `/animation` — TWIGSTATE-0606: new per-source view state gets its own keys) |

## 4. Named UNMOVED rows (so nothing is silently assumed)

IDENTITY (name/skin incl. SKINRANGE grid) · PART (enum/reset) · FACE mesh
fields (generate face / export .hed / remove face / skull stretch / photo
size / photo up-down) · SCULPT (depth amount) · REGION sliders + reset · all
sculpt/grab/smooth/paint machinery, unwrap canvas, outline lathe, grid
samples · sculpt camera + fly/orbit · ctrl+z/y hotkeys (mesh stage; the new
DressedStage mounts its own so undo works while dressing/posing) · file
drops (mesh stage — .body/.hed/photo are mesh-context verbs) · undo/redo
chips · autosave/roster/save/generate/export actions (hero bar; clothing
and animation carry `save` so a dressing session can land a labeled save
without context-switching) · the PAINT lens + workbench slot book · the
status strip (all three stages render it — store status lands everywhere).

## 5. The lens question (LAW 2 check)

CLOTHING and ANIMATION ship with NO lens bar (single implicit view — the
dressed figure). A lens changes how you look; these contexts each have
exactly one honest way to look. The character source's FIGURE/PART/SCULPT/
PAINT set is untouched — those are mesh lenses.

## 6. P4 (the mechanical parity pin)

`editors/workbench/characters/source.test.ts`:
- the three panels COLLECTIVELY expose every field `k` the pre-split panel
  had (hardcoded list pinned in the test — a dropped control fails the suite);
- the mesh panel exposes ZERO wardrobe/animation fields (the ruling itself,
  as a test);
- clothing writes reach `BodyDocument.outfit` through draftToDocument
  (autosave path untouched);
- play/preset keep the clock exclusivity, and wardrobe picks no longer
  flip the mesh lens (F1).

## CLOTHFLIP-0607 amendment (req_0234) — the cosplay clothing context is DEAD

USER verbatim: "The clothing route is still doing a character cosplay … i
want to just have to select a t shirt, and then i can go through the
designs, add a new design, brings me to the painter save, done now that
shirt exists i can give it a name, and all that important meta data. not
this shit where its asking me about a prop"

The wardrobe ATTACHMENT surface this capture defined (clothingPanel +
clothingSourceCore + the `clothing` registration) is DELETED. Final W-row
accounting:

| row | fate |
|---|---|
| W2 clothes / W3 bottoms / W4 print | PANEL DEAD by verdict. The draft doors (`setClothing`/`setBottoms`/`setClothingSkin`, the DEFAULT_BOTTOMS coupling, the BodyDocument.outfit channel) LIVE ON in characters/store.ts — pinned by source.test.ts ("the draft door" tests). Outfit-assembly is character/play domain awaiting its surface there; the garment tables/prints themselves are the GARMENT source's roster/seed variants |
| W5 extras | same: panel dead, `toggleAccessory` door + cap⇄beanie exclusivity live on (pinned); accessories are GARMENT-source roster items |
| W6 held prop | same: panel dead ("not this shit where its asking me about a prop"), `setHeldItem`/`sculptedItems` doors live on (pinned) |
| F1/F2/F3, S-rows | unaffected — DressedStage survives as the ANIMATION context's stage; the '/clothing' camera twig namespace dies unread (twigs are additive state, no cleanup needed) |

The clothing AUTHORITY is `editors/workbench/clothing/` (the GARMENT
source, WBCLOTHING.CAPTURE.md) — id `garment`, now wearing the Shirt icon
and the CLOTHING kicker.
