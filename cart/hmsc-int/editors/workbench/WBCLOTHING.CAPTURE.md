# CLOTHSOURCE-0606 CAPTURE — the clothing-centric GARMENT source (req_0187)

USER verbatim: "the clothing workspace needs work. workspace is not really
any different than the character workspace, and just shows the character in
clothing. it should just show the clothing items, and then the variety in
that same item (shirt with many materials type of ordeal)"

Dispatch terms: roster = clothing ITEMS rendered as the GARMENT ALONE (no
body unless a try-on lens is explicitly added later); within an item,
VARIANTS — the same shirt across many materials/skins; each variant is a
material assignment per the one-source-of-truth materials rule (the SAME
chooser as BUILDSKIN, never a parallel texture path).

## What landed (editors/workbench/clothing/, additive)

| piece | mechanism |
|---|---|
| roster | GENERATED from the garment tables (shapes.ts P2 data, never enumerated): 5 tops (CLOTHING minus `underwear` — painted-on by ruling, buildClothing emits ZERO top instances for it; nothing to show alone) + 5 bottoms (BOTTOMS) + 4 accessories (CLOTHING_ACCESSORIES). Ids `top:tee` / `bottom:jeans` / `acc:cap`; labels carry the kind (`tee · top`) |
| garment alone | `buildClothingSlices` (game/figure/clothing.ts, ADDITIVE): buildClothing now fills optional section marks (the instance list builds top → bottoms → shoes → accessories in fixed order) and the slices are ITS OWN output cut at those marks — one placement truth, no fork. Suite pins the partition exactly (sum of slices = the whole outfit, byte-equal first instance). Existing render/bake callers pass no marks; byte-identical behavior |
| variants (seeds) | the 5 built-in CLOTHING_SKINS prints, printable tops only — clothing.ts:82 is the placement law (armor/dress take no print box; the panel renders NO variants section for them, the conditional-sections law). A seed selects → the render folds `headlab.clothing.<skin>` in; the stage mounts the SHARED ClothingSkinCaptures (editors/characters/preview.tsx:463) — the same bake every dressed stage samples |
| variants (saved materials) | a textureId into THE texture registry, picked through THE shared MATERIAL chooser (`pick` field → shell/picker.tsx, grouped by the a-/b-/… families through `editors/workbench/materials/chooser.ts` — one implementation, §8). One pick = one `garmentVariantSaved` commit on the new V20 `clothing-variants` stream (game/figure/clothingVariants.ts: dumb upsert keyed (garment, `mat:<textureId>`), unknown kinds skipped — V20 by-addition). Existence gated at the store boundary (deps.validMaterial — live `textureById`); render maps the TORSO (first top instance, suite-pinned) to `clothvar:<textureId>` front/back and the stage mounts exactly one TextureCapture |
| variant strip | column 4's bottom band: every variant as a chip, selected marked, CLICK SELECTS (view state through a setter — the WBCHAR C1/C3 precedents). Creation/assignment lives in gutter 3 (LAW 1) |
| stage | the garment ALONE, instance-bounds framing, the buildings stage's native-orbit wire (engage once + setInputDeltas; drag orbit, wheel zoom) and THE stage kit's studio rig VERBATIM (req_0184's dark-stage verdict: `Fog enabled={false}` + ambient 0.55 + directional [0.5,1,0.35] 0.95, bg `accentFor('bgElevated')`) |
| store wiring | live.ts: own V20 session on the clothing-variants channel ('/workbench' route id, the buildings/live precedent); store-down error surfaces per the census convention; tables still roster read-only when down |

## W-row accounting (WBCLOTH.CAPTURE.md parity — nothing silently dropped)

The dispatch replaces the clothing VIEW, not the wardrobe attachment
machinery. The W-rows live in the ATTACHMENT context
(characters/clothingSource — USER RULING req_0040's dressing surface), which
this source COEXISTS with until the supervisor flips:

| row | capability | accounting |
|---|---|---|
| W2 | OUTFIT · clothes enum | **stays in clothingSource (characters)** — dressing a FIGURE is per-character draft state; the garment source's roster shows the same CLOTHING table as ITEMS |
| W3 | OUTFIT · bottoms enum | **stays in clothingSource (characters)** — same; BOTTOMS appear here as roster items |
| W4 | OUTFIT · print enum | **stays in clothingSource (characters)** for dressing; the prints THEMSELVES are this source's seed VARIANTS (same CLOTHING_SKINS table, same headlab.clothing.* keys) |
| W5 | EXTRAS · accessory bools | **stays in clothingSource (characters)** — attachment; accessories appear here as roster items (garment alone) |
| W6 | PROP · held enum | **stays in clothingSource (characters)** — a held item rides a FIGURE's bones; no figure exists on this stage |

## Deviations / seams (named, not hidden)

- **Registry registration: COEXIST, not replace.** The new source carries
  none of the W2-W6 attachment fields (they are per-character), so per the
  BUILDSKIN rule (replace only if every row folds in) both register:
  `clothing` (attachment) + `garment` (items+variants). The flip — and
  whether the attachment context then renames — is the supervisor's call.
- **Material variants are TOPS-only (v1).** The material rides the torso
  front/back (the only print-bearing body in clothing.ts); bottoms/
  accessories refuse with a loud store error. Extending the placement law to
  bottoms (seat box) is a clothing.ts follow-up, not a panel hack.
- **Armor's knee pads land in the `bottoms` slice** (they ride the leg loop
  in clothing.ts) — the armor-alone view shows the chest rig without knee
  spheres. Named in buildClothingSlices' doc.
- **Try-on (garment on a body) is OUT OF SCOPE** per the dispatch — a future
  explicit LENS if the user asks.
- **Variant identity is `mat:<textureId>`** — one saved variant per material
  per garment (saving the same material twice upserts, never duplicates).

## P4 (the mechanical pin)

`editors/workbench/clothing/clothing.test.ts` — 9 tests: roster generation
(tables, kinds, underwear exclusion), bodiless fold + exact slice partition,
seed prints incl. the armor/dress placement law, seed render keys, material
save through the REAL clothingVariantsStream.apply (one action one commit,
torso mapping, mount list), the three refusal gates, removal + plain
fallback, panel generation + conditional sections, shared material chooser
grouping, selection-as-view-state.
Headless per the characters.test.ts bundling law (store.ts + panel.ts only).

## CLOTHFLIP-0607 (req_0234) — the flip + the design spine + the grid

USER verbatim (the spine): "i want to just have to select a t shirt, and
then i can go through the designs, add a new design, brings me to the
painter save, done now that shirt exists i can give it a name, and all that
important meta data. not this shit where its asking me about a prop."
USER verbatim (the refinement): "the ux is still horrible lmao" + the
print-per-face fear + the near-black-blob stage.

| change | mechanism |
|---|---|
| THE FLIP | `characters/clothingSource.tsx` DELETED; `clothingPanel`/`clothingSourceCore` deleted from characters/panel.ts; the `clothing` registration removed from sources.ts. The garment source IS the clothing category (icon Shirt, kicker CLOTHING; id stays `garment` — twig continuity). Outfit/extras/prop draft DOORS stay in characters/store.ts (character/play domain), pinned by the amended source.test.ts. Coexist→REPLACED. |
| THE SPINE | `+ new design` (panel verb) → `store.startDesign` → THE shared paint bench opens a `garment-design` target (paint/targets.ts — a new target FAMILY, symmetric with figure/vehicle parts: resolve gates on the garment, reopens a saved design's own paintDoc, TATTOODRAFT slot law) and the source's controlled lens flips to DESIGN (the vehicles PaintLens doorway). The bench's SAVE routes by family (paint/store.ts saveGarmentDesign): bakeOverlayFromDocument — the model-paint bake, ONE truth — lands ONE `garmentVariantSaved` commit on the clothing-variants stream; first save mints the design id, re-saves UPSERT (A7). The DESIGN lens watches the stream: a new design auto-selects and flips back to the stage — "save, done, now that shirt exists." Name = the bench's own TARGET name field at save time + `design name` text field after (rename = upsert, artwork intact); `meta` val shows kind + layer count. |
| VARIANTS GRID | the panel dropdown is DEAD (pinned by suite). Column 4 grows the visual grid: every variant a 104×78 swatch showing THE LOOK ITSELF — plain = the garment's own color, seed prints = the real ClothingSkinSurface artwork (exported from editors/characters/preview), designs = PaintedOverlayPaint of the saved bake, shader materials = the live Effect; click selects (twig-persisted, '/garment' variantSel — TWIGSTATE). |
| PRINT-PER-FACE | a design lands on buildClothing's OWN chest print box (build with a forcing print, re-key exactly the print-box instance) — FRONT placement by construction, suite-pinned: "EXACTLY ONE instance samples the design"; the torso body stays untextured. Material variants (fabric) remain torso front/back — intended wallpaper, named here. |
| STAGE | LabEnvironment preset="studio" — the SAME kit every character stage mounts (sky + ambient #aab8d6 0.6 + key #fff0d6 0.85 + floor; no void, no blob) — replacing the bare light triple; framing tightened (radius×2.3, min 1.2); camera look twig-persisted ('/garment' camera) so reload and headless shots keep the pose. |

Suite grown to 11 (panel respec pins, the spine end-to-end through the REAL
clothingVariantsStream AND the REAL paint-bench store — open/save/upsert/
ghost-refuse — rename, the one-instance design mapping). bench.test 15/15
and characters source.test 24/24 green against the additive bench edits.
