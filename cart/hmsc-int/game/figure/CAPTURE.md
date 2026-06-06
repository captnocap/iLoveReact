# game/figure — capture note (V2/V2-AMENDED/V1, captured 2026-06-05)

Sources (BEHAVIOR REFERENCES — read, never imported, never modified):

| Old file | Lines | Disposition |
|---|---|---|
| `cart/head_lab/parts.ts` | 1425 | rewritten across `shapes.ts` (data) + `skeleton.ts` (FK) + `assembly.ts` + `clothing.ts` + `rig.ts` + `body.ts` |
| `cart/head_lab/hed.ts` | 488 | rewritten as `hed.ts` (codec + depth law + animations + generator) |
| `cart/head_lab/ragdoll.ts` | 355 | V1 treatment: seam + tuning survive in `ragdoll.ts`; the Verlet SOLVER is NOT kept |
| `cart/head_lab/figureRender.tsx` | 211 | rewritten as `render.tsx` (preview path; params via the bake's `partGlobeParams` — one recipe) |
| `cart/head_lab/index.tsx` | 1733 | **NOT CAPTURED — the editor UI.** Becomes `editors/characters/` in its own wave (V17-TRIAGE) |
| `cart/head_lab/animDsl.ts` | 1 | re-export shim of `cart/animationDsl.ts` — the ANIMATION lane's source, not figure's |

New here (no old twin): `math.ts` (the one euler/vec home — Ry·Rx·Rz host
order), `bake.ts` (THE BAKE ENTRY V2-AMENDED demands: documents/seeds →
host-shaped `BakedFigure`; previously nothing implemented the ruling),
`rig.ts`'s `DAMAGE_ZONE_BY_BONE` (V2 rules the lArm/rArm/lLeg/rLeg spelling;
the 25-bone → 6-zone map existed nowhere in head_lab — combat_lab's
`boneZone()` renamed INTO hmsc's vocabulary, which V2 overrules).

## Deliberately dropped

- **The Verlet solver runtime** (`createRagdoll`/`stepRagdoll`/`ragdollImpulse`/
  `ragdollMaxMotion`/`ragdollCenter`) — V1: "its implementation is not kept."
  What survives: the bones-in/bones-out SEAM (`seedJointsFromBones`/
  `jointsToBones`/`restLengths` + `buildRigFrameFromBones`) and EVERY solver
  behavior number as `RAGDOLL_TUNING` (P2). The archived JS solver is the
  acceptance baseline the future Zig feature validates against.
- **`ASSEMBLY` eager const** (a stand assembly built at module load) — dead
  convenience; callers build what they need.
- **`exposureSamples`-era leftovers**: none found in the kit files (they live
  in combat_lab — the chance lane captured the cover-sample contract).

## Ambiguities (surfaced, not guessed)

1. **P2 grain in the FK.** The designer-tunable TABLES are lifted and exported
   (`shapes.ts`, `RAGDOLL_TUNING`, `FACE_GEN_PALETTES`, `PART_LOD`). The FK's
   inline pose-geometry coefficients (`0.4 * armLen` segment fractions, posture
   drops, punch target tables, etc.) remain inside `buildSkeleton` — they are
   the pose function itself, and flattening hundreds of them into one table
   would shred the readable anatomy. If P2 is ruled to demand the full lift,
   that's a follow-up pass (the kinds capture's LANDFORM_TUNING precedent
   applied at the same grain).
2. **Visual height.** The reference's own comments disagree ("~1.9 units" vs
   "~2.2"); R4 canon says ~2.04m visual head-top. Measured here: ≈2.0 at
   neutral stand (tested as a 1.7–2.3 band). Exact canon belongs to the scale
   audit, not this capture.
3. **`clothingSkinTextureKey` keeps the `headlab.clothing.*` prefix** —
   texture keys are shared global state; renaming would orphan whatever
   registered the existing textures. The texture/materials lane owns renames.
4. **`ragdollHostReady()` is a `false` constant** — no host binding exists and
   inventing a name is how gates break silently. The physics lane re-points it
   when `framework/game/` grows the ragdoll feature (V1).
5. **`.body.heldItem`** is an opaque string into the ITEMS registry — passed
   through untouched; resolution is the V11 lane's.
6. **Bake textures are DESCRIPTIONS, not pixels** (`BakedTexture` = skin +
   layers + dims). Rasterization is the capture/compile concern (StaticSurface
   today, the Zig lowering tomorrow); baking pixels in JS here would duplicate
   the renderer.

## Cross-system needs SURFACED (scope fence — not implemented here)

- **animation lane (V6):** `RigTimelineAction` is consumed here; the timeline/
  RLE format that PRODUCES action arrays is animation's. The action vocabulary
  the FK answers to (crouch/sit/lay/punch/…) is enumerable from `skeleton.ts`.
- **physics lane (V1/V18):** the host ragdoll feature + its honest binding;
  `RAGDOLL_TUNING` + `restLengths()` are its input contract, the archived JS
  solver its acceptance behavior.
- **items lane (V11):** held-item resolution for `.body.heldItem`.
- **materials lane:** clothing-skin texture registration + unwrap rasterization
  at compile time.
- **editors wave:** `editors/characters/` re-creates head_lab's authoring UI on
  this kit (sculpt grids, outline drags, layer painting, photo path).

## Tests (P4, tools/v8cli)

`skeleton.test.ts` 8 · `rig.test.ts` 5 · `documents.test.ts` 5 ·
`bake.test.ts` 6 — 24 meaning-level cases; `render.tsx` is bundle-verified
through the real cart pipeline (JSX can't run under v8cli).

## Editors-wave addition (2026-06-04): the V20 `characters` stream + `bakeBodyDocument`

`stream.ts` defines the `characters` concern (the ROSTER: authored
`BodyDocument` per id + first-authored rail order), following the
`world`/`missions`/`vehicles` precedent of the stream def living beside its
system. Events carry the RESULTING document (`authored` upsert / `removed`),
never the edit verb — sculpt strokes, outline drags, region stamps and
wardrobe picks are editor-side in `editors/characters/`, so the materializer
is a dumb upsert and the round-trip author → stream → snapshot → bake is
exact by construction.

`bake.ts` grows `bakeBodyDocument(doc)` — the ONE BodyDocument → BakedFigure
adapter (reconstructs the head's face document from the doc's own head part;
what compile, verify, and the editor's bake trigger all call). Note:
`.body.heldItem` rides the document but not `BakedFigure` — item resolution
stays the V11 lane's (ambiguity 5 above, unchanged).

`GAME_FIGURE.stream` + `GAME_FIGURE.bakeBody` carry both; `game/index.ts`
re-exports `charactersStream`/`bakeBodyDocument` + the doc types as NAMED
exports (not a 20th GAME_* door). `stream.test.ts` (6 P4 cases) pins roster
semantics, schema-evolution tolerance, the deletion-contract round-trip
through a real on-disk store, undo-as-log-position, and the door.

## The painted-overlay channel (MODELPAINT-0605, 2026-06-05)

THE USER'S RULING, verbatim: "i dont want to paint depth, i want to paint
their face though, or body parts, is that clear." The coupled color+depth
face stroke (one .hed layer per stroke, depth ±0.16·strength) is RETIRED —
/cutout paints color PIXELS; sculpt remains /characters' geometry tool. The
.hed one-shape coherence law is untouched for SHAPE layers (generated faces,
features); the painted overlay is a separate, additive color-only channel.

- `body.ts`: `BodyDocument.paint?` — per-part `PaintedOverlay` slots
  (game/painted.ts: baked cell-grid color layers + the painter's re-editable
  document held opaque). `applyBodyPaint(doc, part, overlay|null)` is the
  pure save-path step; removing the last overlay drops the channel, so
  paint → unpaint is byte-parity. `parseBody` degrades a torn overlay to
  unpainted, never to a rejected document. Pre-paint documents parse
  byte-unaffected (pinned).
- `render.tsx`: `buildPartRender` takes optional `paint` — a painted part's
  texKey leaves the shared plain-skin bake, content-addressed by the save
  stamp (`paintedPartTexKey`). `CharacterCaptures` composites the head's
  overlay where the photo sits (over skin, UNDER the shape layers — the
  ruled z-order) and mounts one `PaintedOverlaySurface` per painted
  non-head part. Paintless callers are byte-identical (Embodied.tsx,
  fenced, passes 4 args and is untouched).
- NOT DONE HERE (the bake lane's follow-up): `bake.ts`'s BakedTexture does
  not yet composite overlays into the COMPILED game's textures — the editor
  preview paths render them; the compile-side composite belongs to the bake
  capture when texture baking lands. Surfaced, not guessed.

## CLOTHSPLIT-0606 phase 1 (2026-06-06, USER RULING req_0040): clothing as attachments

"have someone move clothing into its own thing that is decoupled from the
body... clothing should effectively be a prop that is seperate but tightly
related, not entirely coupled." The DATA layer decouples (phase 1; the editor
separation is phase 2, gated):

- `outfit.ts` (NEW) — the wardrobe ATTACHMENT family. `OutfitDocument` =
  {top, bottoms, print, accessories}: its own document, attached to a body as
  ONE optional channel (`BodyDocument.outfit` — the paint precedent), never
  interleaved with the body's mesh truth (parts). The prop analogy holds end
  to end: the outfit names WHAT is worn; `attachOutfit(bones, outfit, ...)`
  builds garment instances against an EXISTING bones record (the V1 seam —
  a ragdoll keeps its clothes), bottoms anchoring the pelvis bone
  (PELVISMESH's part), tops the torso/arm chain. Placement code
  (clothing.ts) untouched.
- `rig.ts` — `MeshRigFrame` + `buildMeshFrame` (bones + parts + sockets +
  hitboxes + anchors, NO clothing — what mesh editing looks at; phase 2
  mounts it). `BodyRigFrame = MeshRigFrame + clothing`; the dressed doors
  (`buildRigFrame`/`FromBones`) keep their pre-split signatures and compose
  mesh-frame + attachOutfit — equality pinned in rig.test.ts (every route
  call site unchanged).
- `body.ts` — `buildBody` takes/writes `outfit` ONLY (the legacy
  clothing/bottoms/clothingSkin/clothingAccessories fields stay in the type,
  readable forever, never written by new saves); `bodyWithOutfit` =
  attach/detach (applyBodyPaint idiom; attach clears legacy fields — one
  wardrobe truth; detach removes every wardrobe channel); parseBody degrades
  a torn outfit away (legacy fields/defaults catch the fall).
- `outfitOf(doc)` — THE V20 read door: outfit channel wins; pre-split
  documents map their legacy fields deterministically INCLUDING the
  DEFAULT_BOTTOMS coupling a missing bottoms always meant; a bare doc wears
  the default dress. Consumers: draftFromDocument, bakeBodyDocument (both
  normalize themselves — stream docs bypass parseBody).
- `bake.ts` — BakeWardrobe retired for `BakeOutfit` (buildOutfit's partial);
  bakeFigure dresses via mesh-frame + attachOutfit, same composition.

**Deliberate non-changes:** clothing.ts garment placement byte-identical;
CharacterDraft keeps its wardrobe fields for phase 1 (the EDITOR relocation
is phase 2 — gated on the workbench lane); BakedFigure.clothing unchanged
(the compiled shape is the compile lane's contract).

**Surfaced (phase 2 will need rulings):** the editor shape for the clothing
context — proposal from the attachment model: CLOTHING as its own
WorkbenchSource (roster = outfits; panel = top/bottoms/print/accessories
specs; stage = dressed figure on the current body) with the mesh stage
mounting buildMeshFrame (no garments, no toggles); ANIMATION as its own
rig/posing context (where pose/anim-script commands live). Nothing
constitution-grade in phase 1: no vocabulary changed, garments still
bones-driven, V20 by addition.

**Phase 2 LANDED (2026-06-06, same ruling):** the proposal above built as
proposed, with two surfaced decisions — body SHAPE stayed mesh-side (it
reshapes the skeleton; flip-to-FIGURE gesture kept) and the held PROP went
clothing-side (an attachment, the outfit's sibling). One deviation from the
proposal: the clothing roster is the CHARACTER roster (the outfit is
per-character today — no separate outfit stream invented; that would be a
new V20 concern needing its own ruling). The mesh context's stage mounts
`buildMeshFrame` exactly as phase 1 staged it; the dressed contexts compose
mesh + attachOutfit through the unchanged `buildRigFrame` door. The
line-referenced relocation ledger (every moved control, its old line, its
new home, nothing dropped) is `editors/workbench/WBCLOTH.CAPTURE.md`;
mechanical parity pin in `editors/workbench/characters/source.test.ts`.

## PELVISMESH-0606 (2026-06-06, USER ASK req_0022): the pelvis is a real mesh

"i thought i asked someone earlier to make the torso and the pelvis not the
same mesh but it seems to be the same and i dont see a pelvis mesh to edit" —
LIMBPAINT had split the pelvis as a PAINT SEGMENT only; the geometry stayed
the torso worn by an anatomy socket. Now the GEOMETRY splits:

- `shapes.ts`: `'pelvis'` is a **PartId** (roster, presets, LOD, regions) and
  no longer a LimbPaintTargetId. The string `'pelvis'` is still a valid
  PaintTargetId, so old `paint.pelvis` overlays keep meaning — same 512×256
  unwrap contract, now sampled by the pelvis's own mesh 1:1. The pelvis
  PRESET is the torso preset verbatim (the socket wore the whole torso globe
  scaled down — a fresh pelvis looks exactly like it always did).
- `assembly.ts`: the pelvis is an ASSEMBLY instance on the pelvis bone with
  the dead pelvisSocket's exact sizing (bone scale ×1.18, thickness hip
  ×1.18). Being assembly (not anatomy) makes it grab-sculptable in figure
  view and selectable by grab, like every part.
- `body.ts` `partsWithPelvisFallback`: THE deterministic old-doc mapping —
  a pre-split document's pelvis is a COPY of its torso sculpt + profile
  (what the socket displayed). Called at parseBody, draftFromDocument,
  bakeBodyDocument, and the cutout ModelPreview (stream docs bypass
  parseBody). New saves carry a real `parts.pelvis` (buildBody loops
  PART_IDS).
- Paint plumbing: `PAINT_TARGET_NO_PART_FALLBACK` is now EMPTY (the bare-key
  seam stays for future no-fallback segments; the bare-torso captures in the
  editors died — nothing samples them). The two-sets-of-tits cascade is dead
  STRUCTURALLY: pelvis paint lives on the pelvis unwrap.
- `generate.ts`: a generated pelvis copies the generated torso's profile +
  detail grid with ZERO extra rand draws — pre-split seeds keep producing
  the same citizens.

**Deliberate couplings (checked, not incidental):**
- **rig/bones**: no skeleton change — the pelvis bone always existed; the
  part now rides it. 25 bones, 27 assembly instances (was 26), 8 anatomy
  sockets (was 9).
- **damage zones**: pelvis bone stays in the `torso` zone (V2's six-zone
  vocabulary untouched — splitting the ZONE would be constitution-grade and
  is NOT done here; surfaced in case the user wants a 'pelvis' damage zone).
- **clothing**: bottoms were ALREADY pelvis-bone-driven (seat/crotch boxes,
  skirt/dress cones ride `bones.pelvis`); the part split moves no garment.
- **hitboxes**: per-bone, unchanged (the pelvis bone always had its oriented
  box).
- **the bra-stamp note from LIMBPAINT is MOOT**: the underwear texture
  stamps were deleted by ruling before this split landed.

## LIMBPAINT (2026-06-05, USER RULING): per-segment paint targets

"can we update it so we can say this is a left upper arm, lower arm, upper
leg, lower leg, so we dont have some stupid shit" — GEOMETRY keeps the
shared-part model (one pipe sculpted once); PAINT now addresses instances:
`PaintTargetId` = PartId | segment (L/R upper/lower arm + leg, L/R hand,
L/R foot, pelvis), mapped per skeleton bone (`PAINT_TARGET_BY_BONE`;
wrists ride the lower arm). Resolution: SEGMENT WINS, PART IS THE FALLBACK
("all limbs" stays a broad-stroke target; old documents keep meaning) —
EXCEPT the pelvis (`PAINT_TARGET_NO_PART_FALLBACK`): the pelvis SOCKET
wears the torso globe (assembly pelvisSocket — the user's "two sets of
tits"), so torso paint never cascades there; unpainted it samples the
torso's BARE key (`PartRender.bareTexKey`; the route mounts the bare torso
surface beside the painted one). Fingers stay shared (tiny fan instances —
the one remaining shared paint surface). SURFACED, pre-existing: the
underwear BRA stamps still render on the pelvis socket via the shared
torso texture when the torso is UNPAINTED — splitting the stamp layout
between torso/pelvis surfaces changes dressed appearance and needs the
user's eyes.
