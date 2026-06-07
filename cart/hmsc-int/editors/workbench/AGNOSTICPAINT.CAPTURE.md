# AGNOSTICPAINT-0606 CAPTURE — the agnostic paint surface parity table

USER RULING, verbatim: "it needs to be treated as 'this is an agnostic
painting surface, put whatever u want here' since the reality is this: any
thing at all is all just the same thing at this level. from here we
materialize something and it gets then put on the face of a building or a
shirt, or anything."

Parity source: `editors/cutout/CutoutRoute.tsx` re-read END TO END at its
working-tree state at capture (1160 lines, including the paint lane's
in-flight brush work where visible). **THE FLIP LANDED (CUTOUTFLIP-0606)**:
the user passed the bench ("its at least got everything from the route in
there so its g2g nuke that shit"), the route is DELETED, the freeze is
LIFTED — the bench is THE painting surface. The Cutout:NNN line references
below cite the dead file's last state (git history) as the parity record.

The workbench translation (shape-honest, capability-total): the PAINT
source's roster lists every paintable THING (figures · vehicles · stored
materials · recipes · documents · cutouts · blank); for model rows the PART
is a panel enum (gutter 3 — the workbench's sub-selection idiom, same as
the character source's PART group) instead of cutout's expanding rail rows.
Every target /cutout serves stays reachable; nothing needs >2 clicks.

Landing legend: **R** roster · **P** panel · **S** stage (the bench) ·
**A** hero action · **ST** store (editors/workbench/paint/store.ts) ·
**DEFERRED** (listed, never dropped).

## A. Targets — every way the canvas gets a subject

| # | source | capability | landing |
|---|---|---|---|
| A1 | Cutout:371-378 newCanvas (clamped PAINT.tuning.canvas) | blank canvas at W×H | **R** 'blank canvas' row + **P** TARGET w/h num fields + new-canvas act (the SOURCE tab's size editor stays too — same component) |
| A2 | Cutout:380-395 loadImage (identifyImage, stemOf, useFileDrop anywhere) | image file as canvas + smart-select source | **S/ST** — open-image picker + file drop on the bench → store.openImage; no SOURCE tab path field |
| A3 | Cutout:299-308 gray source async per target | edge snap / refine source | **ST** (same loadGraySource wire) |
| A4 | Cutout:555-562 paintOnMaterial | a registry texture as the canvas under the paint | **R** MATERIALS + RECIPES rows → store.openMaterial (Effect underlay) |
| A5 | Cutout:464-505 openModelTarget (figure) | paint a figure part: saved doc resolve, TATTOODRAFT slot resume, overlay reopen, head face-layer underlay, OPEN-SLOT intent write | **R** figure row + **P** `part` enum (FIGURE_PAINT_TARGETS w/ painted ● in opts? — ● rides the panel painted-parts val + roster detail) |
| A6 | Cutout:464-505 (vehicle branch) | paint a vehicle part (VEHICLE_PART_IDS) | **R** vehicle row + **P** `part` enum |
| A7 | Cutout:438-447 openDocument | reopen a saved library document (id kept — re-saves upsert) | **R** DOCUMENTS rows |
| A8 | Cutout:449-458 openCutout | reopen a cutout asset as a NEW document | **R** CUTOUTS rows |
| A9 | Cutout:507-514 takePendingModelTarget | the deep-link mailbox (other routes say "paint this") | **ST** — store.open consumes the mailbox on mount; the character PAINT lens is the new primary door and drives the SAME store.open |
| A10 | Cutout:188-232 restoreOrBlank | mount restore: current draft slot → model binding re-resolved live (vanished model keeps the PAINTING as plain canvas; missing image keeps layers, drops image) | **ST** restore (workbench book) + TWIGSTATE: the workbench frame twigs already restore source/row; the bench restores its slot |

## B. Output — save / extract / materialize (the routing verb)

| # | source | capability | landing |
|---|---|---|---|
| B1 | Cutout:398-412 saveDocument | library save ('saved' commit, upsert by docId, labeled) | **A** save (document/blank/image/material subjects) → **ST** router |
| B2 | Cutout:519-549 saveModelPaint | figure/vehicle part save: bake → applyBodyPaint/applyVehiclePaint → ONE labeled commit on the OWNING channel (lazy sessions), empty CLEARS, slot dropped, painted dots refresh | **A** save (model subjects) → **ST** router; figure branch also pokes the character store's open draft (the lens-adopt law, K3) |
| B3 | Cutout:414-436 extract | selection → cutout asset (composeExportMask, uniqueAssetName, lookColors, 'extracted' commit) | **A** extract |
| B4 | Cutout:568-572 materializeCutout | cutout asset → stored material (saveCustomTexture + 'cutout-stencil' recipe) → allTextures (faces/tiles/parts) | **A** materialize (cutout-asset subjects) — THE routing verb the user named |
| B5 | Cutout:584-589 removeEntry | remove document/cutout ('removed' commit; history stays) | **A** remove (document/cutout subjects) |

## C. Working state

| # | source | capability | landing |
|---|---|---|---|
| C1 | Cutout:125-165 Work + freshWork (docId mint, epoch remount) | the one working-target model | **ST** (same shape; epoch keys the painter mount) |
| C2 | Cutout:356-368 rename + commitWorkName | name edit; commit on submit/blur (note + flush) | **P** TARGET `name` text field → store.rename/commitName |
| C3 | Cutout:310-351 draft book (debounce 600ms, flushDraft pre-switch, edited gate — pristine opens never evict, TATTOODRAFT per-target slots, legacy single-draft fallback) | unsaved-work lifeline | **ST** — the WORKBENCH-SCOPED book (K5 ruling, `_workbench_paint_drafts.json`); cutout's book stays cutout's until the flip |
| C4 | Cutout:284-288 status/edited/lastSavedAt | save-state surface | **ST** + the bench status bar (same CutoutStatusBar) |
| C5 | Cutout:291-297 backendChoice twig + SAM fallback | smart-backend pick | **S** (same Inspector picker; twig moves to /workbench keys) |
| C6 | Cutout:80-101 VIEW P2 tunables | chrome numbers in /settings | **ST** registers its own 'workbench-paint' view table (additive; cutout's stays until flip) |

## D. The rail → the roster (gutter 2)

| # | source | capability | landing |
|---|---|---|---|
| D1 | Cutout:648-678 MODELS section (figures + vehicles, part chips, painted ●, modelPick twig, counts) | model targets browse | **R** rows per figure/vehicle (icon User/Car; detail `N painted`); part picking moves to the panel enum (the translation note above) |
| D2 | Cutout:679-691 DOCUMENTS | library docs (active highlight, dims·layers·src tag, remove) | **R** rows + **A** remove |
| D3 | Cutout:692-703 CUTOUTS (PaintQuad preview swatch) | extracted assets (open, →mat, remove) | **R** rows (swatch DEFERRED-1) + **A** materialize/remove |
| D4 | Cutout:704-728 MATERIALS (live Effect swatch) + RECIPES | registry textures as canvases | **R** rows (swatch DEFERRED-1) |
| D5 | Cutout:630-636 session error banner | store-offline visibility | **S** bench status strip (same message) |

## E. The painter mount (already ONE chrome — ONEPAINTER-0606)

| # | source | capability | landing |
|---|---|---|---|
| E1 | Cutout:761-891 Workbench mount | CutoutToolRail · PaintSurface (underlay: model bg+face layers / material Effect) · ModelPreview3D above Inspector (model targets) · Inspector · CutoutStatusBar · backend gated on srcPath · onDirty wiring | **S** PaintBench.tsx — the ONE surface, generalized from the character lens's mount (which becomes a thin preload door) |
| E2 | Cutout:888,928-1007 EffectModal (custom WGSL, twig'd draft, live/stale preview, add→gallery) | custom FX authoring | **S** `workbench/paint/EffectModal.tsx` (CUTOUTFLIP-0606: extracted verbatim at the flip; drafts twig under /workbench; the FX button opens it — deferral 2 CLOSED) |

## Deferred (listed, never dropped)

1. **Roster preview swatches** (cutout/material rows' PaintQuad/Effect
   thumbnails): the frame's RosterRow is icon+label today. Lands as a
   RosterRow `swatch` extension when the frame grows it — capability
   (opening the thing) is fully present; the swatch is recognition sugar.
2. ~~**EffectModal in the bench** — extracts from the frozen CutoutRoute at
   the flip commit (it cannot be imported from there today; ONEPAINTER K2a).~~
   DONE at the flip (CUTOUTFLIP-0606) — see E2.
3. **modelPick expand-state twig** (D1) — obviated by the panel-enum
   translation; noted so the audit is total.

## The character PAINT lens after this

The lens REMAINS as the doorway (dispatch §2): it drives the ONE bench store
to `{figure-part, draftId, selPart}` and renders the same PaintBench. Zero
forked mounts; leaving the lens and opening the PAINT source shows the same
target, same unsaved strokes, same brush.
