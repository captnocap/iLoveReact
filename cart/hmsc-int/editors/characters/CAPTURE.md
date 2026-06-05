# editors/characters — EDITOR-CAPTURE note (V2/V17-TRIAGE, editors wave 2026-06-04)

The head_lab AUTHORING UI remade as the `/characters` route inside the tool.
Source: `cart/head_lab/index.tsx` (1734 lines — BEHAVIOR REFERENCE: read,
never imported, never edited; **the user deletes it, not us**). The kit it
edits is `game/figure/` (captured separately — see `game/figure/CAPTURE.md`);
this route is the ruled editors-reach-into-figure-internals exception.

## The deletion contract — inventory checklist

Every authoring capability the old editor has, where it landed, status:

| # | Capability | New home | |
|---|---|---|---|
| 1 | Six part tabs, per-part edit context | `CharactersRoute.tsx` part rail | DONE |
| 2 | Depth paint (raise/carve/flatten, size+strength, per-part GPU paintables, mirror symmetry, stroke→48×24→mesh) | route + `paintKit.ts` | DONE |
| 3 | Depth overlay (live heat + contour rings + unwrap guides) | `paintKit.ts` `DEPTH_OVERLAY_WGSL` | DONE |
| 4 | Fill-all / soften (3×3 blur) / clear | route + `paintKit.ts` | DONE |
| 5 | Outline lathe editor (drag silhouette, latch previews, commit on release, reset) | route | DONE |
| 6 | Region shape sliders per part + reset | `regions.ts` (tested) + `controls.tsx` slider | DONE |
| 7 | Knobs: depth amount, skull stretch | route (GAME_CHROME.Knob, specs in `PAINT_EDITOR_TUNING`) | DONE |
| 8 | Face color paint → .hed layers, palette, mirror, undo-last-layer | route | DONE |
| 9 | Generate face (seeded, masculine/feminine) | route → kit `generateFace` | DONE |
| 10 | Face animations preview (talk/chew/cry/yell) | route → kit `animateHed` | DONE |
| 11 | Photo drop → head texture + size/up-down knobs | route + `preview.tsx` `UnwrapContent` | DONE |
| 12 | Skin tone picker | `controls.tsx` `SwatchRow` (palette in `DRAFT_DEFAULTS.skins`) | DONE |
| 13 | 8 body shapes | route wardrobe rows | DONE |
| 14 | Clothing tops/bottoms/prints/accessories (cap-beanie conflict, print captures) | route + `preview.tsx` `ClothingSkinCaptures` | DONE |
| 15 | Held item, rHand attach | `preview.tsx` `HeldItemMeshes` over `game/items` part tables | DONE |
| 16 | 5 poses + rig walk-anim toggle | route | DONE |
| 17 | Hitboxes + anchors overlay | `preview.tsx` `PartMeshes` | DONE |
| 18 | Animation DSL script + play/reset, script drives rig AND mouth | route → `GAME_ANIMATION` | DONE |
| 19 | The 32 anim presets | `animPresets.ts` (P2 data) | DONE |
| 20 | Generate whole character (seeded everything) | `generate.ts` (tested, deterministic) | DONE |
| 21 | Save .hed / save .body | export buttons (`cart/heads/`) **and** the V20 roster | DONE |
| 22 | Drop-load .hed/.body/photo | route `useFileDrop` | DONE |
| 23 | Part-alone vs assembled-figure view toggle | route | DONE |
| 24 | Orbit camera (drag, zoom), lights, floor | route + `GAME_CHROME.LabEnvironment('studio')` + `@reactjit/cameras` OrbitCamera | DONE |
| 25 | Memo'd mesh perf isolation (orbit drag never re-diffs sculpt payloads) | `preview.tsx` `PartMeshes` (memo) | DONE |
| 26 | Texture captures (head unwrap, per-part skins incl. underwear stamps, prints) | `preview.tsx` `CharacterEditorCaptures` | DONE |
| 27 | **NEW — not in the old editor:** V20 persistence + the bake seam | `roster.ts`: save appends to the `characters` stream AND materializes the snapshot; the compile bakes via `GAME_FIGURE.bakeBody` | DONE |

## What persistence replaced

The old editor's only persistence was `cart/heads/*.json` file writes. The
route keeps that as EXPORT (portable documents) and adds the real channel:
the roster (V20 `characters` stream, `game/figure/stream.ts`) with snapshots
materialized on every save — `data/snapshots/characters.snapshot.json` is
what the compile consumes (V2-AMENDED: documents in, baked figures out via
`bakeBodyDocument`). There is no separate "bake button": saving IS the
handoff; baking happens compile-side from the snapshot.

## Deliberately NOT carried

- **`game_item_gallery` imports** (`ITEMS`, `TextureSources`, `item.model(ctx)`
  JSX) — the route renders held items from `game/items` part tables
  (`HeldItemMeshes`). Item texture CONTENT (cash face, TV screen, …) stays
  gallery-side until the materials lane captures it — textured item parts
  read as their material color in the preview until then.
- **`bodylab-*` paintable ids / `headlab.*` latch keys** — the route uses the
  `chr-`/`chr.` namespace. (The kit-side `headlab.clothing.*` TEXTURE keys are
  kept — shared global state, the materials lane owns renames; see the figure
  capture's ambiguity 3.)
- **The old `seededRandom` PRNG** — generation runs on the kit's `mulberry32`
  (one PRNG in the system). Same seed ≠ same character as the OLD editor —
  irrelevant, since the old editor minted seeds from `Date.now()` and never
  promised reproducibility across versions; within THIS editor a seed is
  fully deterministic (tested).
- **`ScrollView` of the gallery's per-item ctx wrappers** (`HELD_ITEM_SCALE`
  carried as `HELD_ITEM_TUNING.scale` instead — P2 table, default added).

## Ambiguities (surfaced, not guessed)

1. **Non-head sculpt detail vs the bake.** The editor previews displacement on
   EVERY part (`editorPartParams` — faithful to head_lab) and `.body`
   documents carry all six sculpts, but `game/figure/bake.ts`'s
   `partGlobeParams` composites displacement for the HEAD only — body detail
   paint does not currently ship in the compiled figure. Whether the bake
   should composite non-head sculpts is the figure/compile lanes' call.
2. **Item rotations ride verbatim** (V11): the registry transcribed the
   gallery's radian-ish rotation numbers, and the host reads rotation in
   degrees — items render exactly as they always did (positions rotate by the
   hand yaw as radians, the rotation prop gets the raw number). The mandatory
   scale audit (editors/items wave) owns making item transforms honest.
3. **`heldItem` is authored + stored but not baked** — `BakedFigure` has no
   held-item field (the V11 lane resolves items at runtime; figure capture
   ambiguity 5 unchanged).
4. **Editor session state is not persisted** (selected part, brush, camera,
   the dropped photo) — deliberate: the DOCUMENT is the artifact (V20 streams
   carry documents, not UI state). If session restore is wanted later, the
   workspace layer (`@reactjit/workspace`) is the home, not the stream.
5. **`editors/store.ts` is lane-neutral**: ONE Store instance per process =
   one globalSeq authority. The vehicles route should register its stream on
   `editorStore()` too — two `openStore()` instances would fork the undo
   chain's sequence numbers.

## Tests (P4, `rjit game verify` — `editors/` suite root)

`characters.test.ts` 6 cases: region stamp behavior, the lossless
draft↔document round-trip, the .hed coherence law (residue never
double-counts), deterministic+varied seeded generation, shape-warped
outlines, and the full chain author → stream → snapshot → bake through a
real on-disk store. The stream itself: `game/figure/stream.test.ts` (6).
JSX surfaces are bundle-verified through the real cart pipeline.

## Adoptions (post-capture, same wave)

- **V23 native camera (da1730e24):** the preview viewport rides the host
  per-node controller — `<Scene3D.Camera nativeCamera ref>` (static boot
  props) + `GAME_NATIVE_CAMERA.forNode(id)`; drags send `setInputDeltas`,
  the view toggle/zoom knob re-send `setOrbit`; per-mousemove yaw/pitch
  React state is GONE. Per-node because IsoPreview's camera stays mounted
  beneath every route overlay.
- **The shared painter (1f1891468, per its CAPTURE hand-off):** sculpt dabs
  ride `PAINT.createStrokeEngine` (gap-free interpolation + pressure→radius
  + engine-side mirror; fallback-pressure radius == the brush knob, so the
  default feel is unchanged), face strokes ride `PAINT.createVectorStroke`,
  soften rides `PAINT.soften3x3` (paintKit's `softenBytes` deleted).
  paintKit.ts deliberately does NOT die whole — its sculpt-domain pieces
  (resolutions, mode values, byte↔grid, `editorPartParams`, keys,
  `DEPTH_OVERLAY_WGSL`) are figure semantics, not painting (the hand-off's
  ownership fence). The optional full-`PaintEditor` unwrap upgrade (layers/
  lasso/undo on face paint) is a model change — seam exists, not taken.
- **Session history (editors/sessions.ts):** the route opens a
  `RouteSession` on the `characters` channel via `editorChannel()` (the one
  store, no double registration — `roster.ts`'s live singleton removed;
  `createRoster` stays the headless test door). Saves are commit-grade
  (document event + labeled marker + fresh snapshots); strokes/fill/soften/
  clear/outline drags/region slides are labeled notes. Pinned by the
  `paint session` P4 case (7/7).

## AUTOSAVE-0605 (2026-06-05): the draft auto-commits (V20 "saved at every micro change")

Every draft mutation auto-commits the resulting BodyDocument to the
characters channel (debounced, `PAINT_EDITOR_TUNING.autosaveDebounceMs`) as
its own labeled undo position (`autosave · <name>`); the route is STATELESS —
mount restores the most recent roster entry as the working draft. Restores/
loads arm a skip (re-committing unchanged content would churn the chain);
generate/import are authored content and DO autosave. The explicit Save stays
as the named commit.

## MODELPAINT-0605 (2026-06-05): texture painting migrated OUT, to /cutout

THE USER'S RULING, verbatim: "i dont want to paint depth, i want to paint
their face though, or body parts, is that clear." Executed:

- DELETED: the coupled color+depth face-paint tool (the stroke that landed
  color AND ±0.16·strength relief as one .hed layer), its `face color`
  mode chip, palette swatches, `undo paint`, the vector-stroke capture, and
  the paintKit numbers that served it (`faceStrokeMinStep`/`faceStrokeDepth`/
  `faceStrokeFeather`/`facePaints`, `facePaintDepth`). The .hed one-shape
  law is untouched for SHAPE layers (generated faces, animations); SCULPT
  stays exactly as it was — this route shapes geometry.
- The paint row now deep-links: `paint texture → /cutout` (the mailbox in
  editors/cutout/models.ts preloads the SAVED character's selected part;
  unsaved drafts are told to save first).
- The route RENDERS /cutout's work: `CharacterDraft.paint` carries the
  document's overlays OPAQUE through the edit cycle — pinned in
  characters.test.ts that a sculpt/wardrobe save never wipes a painting
  (the wipe hazard found during this capture: draftToDocument rebuilt the
  document from scratch). Captures composite the head overlay at the photo
  slot (over skin, UNDER shape layers — the ruled z-order) and painted body
  parts under their stamps; overlay stamps fold into the texture keys so
  /cutout saves re-bake exactly the affected captures.
