# editors/cutout — EDITOR-CAPTURE note (CUTOUTAPP-0605)

> **THE ROUTE IS DEAD (CUTOUTFLIP-0606):** the user passed the bench and
> ruled the flip ("its at least got everything from the route in there so
> its g2g nuke that shit") — `CutoutRoute.tsx` is deleted, `/cutout` and
> its nav icon are deregistered, EffectModal lives at
> `editors/workbench/paint/EffectModal.tsx`. What REMAINS in this directory
> (ToolRail · Inspector · StatusBar · ModelPreview · models/extraction/
> sources/draft/stream + tests) are the workbench PAINT bench's shared
> modules — live code, consumed by `editors/workbench/paint/` and the
> vehicle/character lenses. See WORKBENCH.md §6 step 8 (done).

The cutout APP EXPERIENCE remade as its own route in the one shell — the
full-canvas, layer-stack, smart-select image/texture editor, for painting
SKINS/TEXTURES (the user's ruling: NOT map painting, and NOT head-part
painting embedded in /characters — that earlier landing missed the ask).

Source (BEHAVIOR REFERENCE — read, never imported, never modified):
`cart/cutout/` (~4,500 lines; `docs/game/cutout.md` is its audit; **the user
deletes it, not us**). The PAINTING ENGINE was already captured to
`editors/paint/` (34/34, its own CAPTURE.md) — this route CONSUMES that
engine, never forks it. THIS contract covers the APP/WORKFLOW surface only.

Ruling chain: the user's direct ask ("the cutout painter" as a page, "strictly
painting for skins/textures not the map"), the QoL correction ("the fine
details... did a quarter of the QoL features" → the full audit below),
V17-TRIAGE (authoring UI = an editors/ route, written fresh), V20 (editors
write to the data layer from their first version), P2/P3/P4.

## The deletion contract — the full app-surface audit

Every workflow affordance in the original app (cutout.md + a line-by-line
read of `cart/cutout/components/`), marked against this route. ENGINE rows
(strokes, bands, lasso math, smart re-refine, history, surfaces, hotkeys…)
are paint/CAPTURE.md's 34 and are not repeated; PRESENT(engine) marks where
the route gets them by mounting the engine surface.

### Source & document lifecycle

| # | Affordance (reference) | Route status |
|---|---|---|
| 1 | Blank canvas creation (`createBlankSurface`) | PRESENT — Source tab `new canvas` + 256/512/1024 presets |
| 2 | Canvas size editor, **Enter-to-apply** (Inspector `CanvasSizeEditor`, "↵ to apply" hint) | PRESENT — Source tab W×H inputs, onSubmit applies, clamp 16..4096 |
| 3 | Image ingest: `identify` dims + grayscale for edge snap (`magick.ts`) | PRESENT — `sources.ts` |
| 4 | File-drop ingest (`useFileDrop`) | PRESENT — drop anywhere on the route |
| 5 | Path-based open | PRESENT — Source tab path input + load (Enter submits) |
| 6 | Zenity OS picker | NOT CARRIED — path + drop instead (ambiguity 5) |
| 7 | **Autosave every edit + restore-on-mount** (debounced session file + `_last.txt`) | PRESENT — `draft.ts`: 600ms-debounced working draft to `sessions/_cutout_draft.json`, restored on mount (missing source image → layers kept, image dropped). Deliberate Saves go to the stream |
| 8 | Document tab/name identity (TopBar tab + stem) | PRESENT — header name field (one canonical home), library row highlights the open document |
| 9 | Save readiness gating (`canSave`: source + edits + not busy; disabled-look buttons) | PRESENT — save/extract chips dim until edited; guarded with status feedback |
| 10 | PNG cutout export (`CopyOpacity`) | LANDED IN-APP as the cutout ASSET on the stream (full-res RLE mask + preview + srcPath + docId); file export awaits the user's ruling (ambiguity 3) |
| 11 | Pixel-icon JSON export · `.sqi` build/parse/import | NOT CARRIED (file-export family / cutout's own format — ambiguity 3) |
| 12 | Window controls + `windowDrag` · context menu · tabs ("reserved" stubs) | N/A — the shell owns the window; ProjectBar is the workspace surface |
| 13 | EmptyState onboarding card | N/A — the route boots into a paintable blank canvas (or the restored draft); the HUD + status line carry the guidance |
| 14 | **NEW** — the LIBRARY: saved documents + extracted cutouts as V20 game data; reopen, delete; cutout reopens as an editable document | PRESENT — `stream.ts` + `extraction.ts` + the rail |
| 15 | **NEW** — V20 session history (notes per interaction; commit-grade saves/extractions/removals) | PRESENT — `/cutout` on the `cutout` channel |

### Tools, canvas feel, keyboard

| # | Affordance | Route status |
|---|---|---|
| 16 | Tool palette: ICON tiles w/ tooltips (Hand/Brush/ScanLine/Spline/WandSparkles; Eraser/RotateCcw modes; X clear, RefreshCcw invert) | PRESENT — `ToolRail.tsx` (CUTOUTQOL2: was shipped as text chips and rationalized as "style difference"; the user ruled the affordance IS the product — see the audit-failure section) |
| 17 | Brush size SLIDER: drag track + detents + +/- nudge + px readout | PRESENT — `ToolRail.tsx BrushSlider` (CUTOUTQOL2: was shipped as chips over the same detents; same audit failure) |
| 18 | Pan/zoom hand tool (Canvas), wheel zoom | PRESENT(engine) |
| 19 | Per-tool cursors (brush ring w/ mode tint, smart crosshair, lasso/refine rings, 60ms throttle) | PRESENT(engine) |
| 20 | HUD strip: tool · mode · active layer · contextual help line | PRESENT(engine) |
| 21 | Lasso preview (path + vertices + closed fill), double-click/return-to-start close, Enter/Esc | PRESENT(engine) |
| 22 | Smart click markers (keep green / reject red) | PRESENT(engine) |
| 23 | Full keyboard map (ctrl+z/y/shift+z, ctrl+c/x/v, b/h/s/l/f, e/r, [/], Enter/Esc) | PRESENT(engine) — ON; host suppresses key triggers while a TextInput is focused |
| 24 | Color slots (P/S) + 10-swatch palette | PRESENT(engine) — tool rail |

### Inspector (the right stack)

| # | Affordance | Route status |
|---|---|---|
| 25 | Tabbed properties: Tool · FX · Source | PRESENT — `Inspector.tsx` |
| 26 | Mask state pill (edited/empty) + refining pill | PRESENT — Tool tab |
| 27 | Selection metrics (backend · clicks · layers) + clear-clicks | PRESENT — Tool tab |
| 28 | **Backend picker** (Flood/SAM pills, SAM greyed without onnx, tooltips) | PRESENT — Tool tab; choice rebuilds the painter's backend |
| 29 | Backend tunables, live re-refine on change (sliders in the original) | PRESENT — chrome Knobs (fuzz/reject · threshold); the engine's 250ms retune is wired |
| 30 | SAM mask candidate picker with names (Whole/Part/Subpart) | PRESENT — Tool tab chips |
| 31 | **FX surface gallery with LIVE animated preview cards** + custom FX cards | PRESENT — FX tab `SurfaceCard` (cells-mode PaintQuad per card) |
| 32 | **"New FX" entry + custom-WGSL modal** (name, editor, live/stale preview, apply-preview/add) | PRESENT — `EffectModal` in the route (template matches the engine's cells data layout) |
| 33 | Global-vs-layer FX targeting (Global + numbered buttons) | PRESENT — FX tab `defaults` + numbered chips (`setActiveLayer(-1)` = the engine's defaults target) |
| 34 | Parameters: hue/phase/dim, blend modes, visibility | PRESENT — FX tab knobs + chips |
| 35 | Source tab: path display, dims, last-saved info | PRESENT — Source tab |
| 36 | **Resizable properties/layers split** (drag handle + capture overlay) | PRESENT — Inspector drag handle |
| 37 | onnx diagnostics block (`AdvancedProperties`) | NOT CARRIED — dead in the original too (never rendered by the tab switch) |

### Layers panel

| # | Affordance | Route status |
|---|---|---|
| 38 | Layer rows: selection stripe, surface preview, name, surface label, group tag, visibility | PRESENT — and upgraded: the row preview is the layer's REAL silhouette (texture-mode PaintQuad on its live masks), not a generic swatch |
| 39 | **Rename control** (icon → inline TextInput) | PRESENT — pencil → inline input, Enter closes |
| 40 | Visibility eye button (+ muted row dimming) | PRESENT — Eye/EyeOff + 0.55 opacity |
| 41 | Action bar: add / duplicate / move up / move down / merge / delete, disabled states | PRESENT — icon bar; plus cut-to-clipboard and paste (engine clipboard) |
| 42 | Smart-click count per layer | PRESENT — `Nc` tag on rows |

### Status bar

| # | Affordance | Route status |
|---|---|---|
| 43 | Status pill (WORKING/SAVED/READY) + live status text | PRESENT — `StatusBar.tsx` (the painter's `s.status` is the live feedback line) |
| 44 | Stats strip: FPS · ZOOM · CANVAS · SIZE · MASK · LAYERS · CLICKS · SAVED, 1Hz telemetry, stable "—" placeholders | PRESENT — same cells, same 1Hz rule (the reference's re-render lesson kept) |

### The material/shader lab connection (CUTOUTQOL2-0605 — not in the reference; the point of living in the one app)

| # | Affordance | Route status |
|---|---|---|
| 45 | Paint ON a registry texture: any stored material or catalog recipe becomes the canvas under the paint (the material canvas) | PRESENT — library rail MATERIALS (live swatches) + RECIPES sections → `PaintSurface underlay` (the engine's post-capture addition); 1-tile square canvas; smart select stays off (needs an image FILE, the blank-canvas rule) |
| 46 | Materialize OUT: an extracted cutout becomes a stored MATERIAL through the system's own door (`saveCustomTexture` + the `cutout-stencil` recipe in the canonical catalog) — joins `allTextures`, assignable in /textures, on faces/tiles/parts, deletable in the studio | PRESENT — `→mat` on cutout rows; `packStencilData`/`stencilDataFromAsset` (layout pinned by test against the LIVE catalog); fill = the look's slot-0 color at extraction, shape floats on transparency |
| 47 | The connection identity persists: material-canvas id rides extractions, saves, drafts, and reopens | PRESENT — `textureId` on assets/saved docs/drafts (V20 addition; old events/drafts read as null) |
| 48 | Shared surfaces as LAYER overlays (a catalog recipe as a paint-layer look) | NOT BUILT — a recipe is a complete `fs_main` with its own data layout; composing it under the painter's mask sampling means WGSL surgery per recipe (the fragile path the shader-vs-polyline lesson warns about). The two built directions (paint ON it / materialize INTO it) are the lossless connections; surfaced for a ruling if layer-level composition is wanted |

## The audit failure — how the user's misses passed a "44/44" audit (CUTOUTQOL2-0605)

The user found in minutes three things the audit claimed were covered. Each
miss, and the exact way the audit let it through:

1. **Tool icons.** The audit row said "PRESENT(engine) — text chips; the
   original's icon tiles are a style difference, noted." The failure mode:
   the audit scored CAPABILITY (can you switch tools?) and demoted the
   AFFORDANCE (does the rail read visually?) to a footnote — then
   self-granted the demotion under "deliberate style differences" instead of
   surfacing it as a question. The reference's `Tools.tsx` is unambiguous:
   icon tiles with tooltips. An audit row that needs a rationalizing clause
   is a MISSING row.
2. **Brush size slider.** Same failure, same clause: "chips over the same 5
   detents" scored the VALUES and discarded the INTERACTION (drag a track).
   The reference's `TopBar.tsx` `BrushSlider` is 90 lines of deliberate
   drag/detent/nudge feel — the audit read it and still filed it as a skin.
3. **The material/shader lab connection.** Not even a row. The audit's scope
   was "cart/cutout's own surface" — but the entire point of remaking the
   app INSIDE hmsc-int is participation in the tool's systems. The reference
   couldn't have this connection (it was a standalone cart); auditing only
   against the reference structurally guaranteed the miss. Integration with
   the host tool's systems is part of the app surface.

The lesson, recorded for the next capture: parity rows must score the
interaction, not the capability; "style difference" is a question for the
user, never an auditor's self-granted pass; and a capture into the one app
gets an INTEGRATION section auditing against the tool's systems, not just
the reference.

## Ambiguities (surfaced, not guessed)

1. **The `cutout` stream def lives route-side** (`editors/cutout/stream.ts`),
   not behind a game/ door — nothing in the game compile consumes painted
   assets yet. When characters skins / build-catalog textures start loading
   them, the def graduates into game/ (the figure-stream precedent); the
   stream FILE and history stay valid as-is (V20). Alternative considered:
   minting a game/ art module now — rejected as colliding with the locked
   material-pipeline vocabulary (art/paint/texture → Materialize) before the
   user rules on how painted images enter it.
2. **Extraction is COMMIT-grade.** The dispatch's note/commit sentence listed
   extractions beside notes, but its persistence paragraph requires cutouts
   to land as game data on the route's streams — an extraction whose asset
   isn't event-sourced cannot persist. Chose commit (content event + marker);
   downgrading to note-only is a one-line change if ruled otherwise.
3. **Export-to-file (PNG / pixel-icon / .sqi) is deliberately absent** — the
   surfaced-not-decided question. The in-app landing is the stream asset;
   the user rules on file export later. The asset carries everything a file
   exporter needs (source path + full-res mask).
4. **The working draft debounces 600ms** (the reference's rate). Unmounting
   the route inside that window loses at most 600ms of strokes — flushing at
   unmount would read back textures after the paintables are already gone.
5. **No OS file picker** — typing/pasting a path or dropping a file replaces
   Zenity. An in-tool file browser would be a shell-level capability, not a
   route fork.
6. **Style differences:** RULED (CUTOUTQOL2-0605) — the user rejected the
   text-chip tools and chip brush sizes; icon tiles + the drag slider are
   the product and now shipped. Remaining deliberate difference: backend/FX
   tunables are chrome Knobs rather than drag sliders (the tool's
   established control, the vehicles precedent) — surfaced, swap on request.
7. **The `PaintSurface underlay` prop is a post-capture ENGINE addition**
   (recorded in editors/paint/CAPTURE.md): the engine had no way to put a
   non-image surface under the paint, and the material canvas needs exactly
   that. Additive — absent, behavior is byte-identical.
8. **Recipes as layer overlays are deliberately not built** (audit row 48):
   composing a catalog recipe's complete fs_main under the painter's mask
   sampling is per-recipe WGSL surgery. Paint-ON + materialize-INTO are the
   two lossless connections; layer-level composition awaits a ruling.

## Tests (P4, `rjit game verify` — `editors/` suite root)

`cutout.test.ts`, 10 cases: empty/short-mask extraction refusal, mask→asset→
mask exact round-trip + pixel bookkeeping + preview-downsample law,
cutout-reopens-as-document (parse gate + base equality + no override),
library stream semantics (upsert/remove/unknown-kind tolerance), the
one-commit-per-save session contract (content event + labeled marker +
snapshot materialization), replay-identical reopen, id/name minting laws,
working-draft round-trip + strict version/shape gate, the MATERIALIZE
contract (the stencil packer pinned against the LIVE catalog recipe: layout,
preview-grid resolution, look-color fill, transparency default, clamping,
bounds), and the material-canvas identity riding extractions/saves/drafts
(with pre-connection drafts still parsing). Route JSX bundle-verified
through the real cart pipeline aliases.

## MODELPAINT-0605 (2026-06-05): model texture painting lives HERE

THE USER'S RULING, verbatim: "the painting tools for the TEXTURE of the
character MODEL and vehicle MODEL are need to migrate entirely to the
cutout painter, thats a start. from there, we need to bbeee able to save
the painting. we will want to have a live 3d preview to see along side our
paintings." And the scope ruling: "i dont want to paint depth, i want to
paint their face though, or body parts, is that clear." All three landed:

- TARGETS: the MODELS rail section (characters roster + vehicle garage off
  the one store; part pickers — face/torso/limbs/hands/feet/fingers,
  18 vehicle parts; ● = painted). `models.ts` is the pure half (binding,
  dims, bg, bake, reopen, mailbox); figure parts paint the kit's 512×256
  unwrap, vehicles a square box-mapped canvas.
- SAVE: bake (per-layer effective masks → cell grid + look colors — PIXELS
  ONLY by ruling) → applyBodyPaint/applyVehiclePaint through the doors →
  ONE labeled commit-grade upsert on the owning channel ('/cutout' sessions
  on the characters/vehicles streams). Empty painting = slot CLEARED. The
  overlay carries its PaintDocument — reopen is lossless (pinned).
- LIVE 3D PREVIEW: ModelPreview.tsx — the figure part / whole vehicle
  beside the canvas, painting applied as you stroke (one StaticSurface
  sampling the painter's live GPU masks; throttled bake clock, P2 knobs;
  V23 native orbit).

REPRESENTATIONAL PICKS (named): bake fidelity is CELL-GRID (default 96,
tunable 'cutout-modelpaint.bakeRes') — what saves is the painter's own
preview language, not source-res pixels; overlay z-order = the photo slot
(over skin, under shape layers); vehicle capture raster fixed at 256²
(independent of the canvas knob — the bake is resolution-projected).

SURFACED SEAMS (not guessed):
- ~~Model targets SKIP the working-draft autosave~~ CLOSED (HOTDRAFT,
  2026-06-05, USER ASK: "make sure a hot update doesn't wipe it before I
  save"): the draft carries the model binding (additive `model` field,
  old drafts stay valid); a hot update mid-painting restores the SAME
  face/part with the unsaved strokes intact and saves keep applying to the
  MODEL. The binding gates against the real part vocabularies
  (`draftModelBinding`); a vanished model or garbage binding keeps the
  PAINTING as a plain canvas — strokes are never the thing dropped. At
  most the draft debounce window (`cutout-view.draftDebounceMs`, default
  600ms) of strokes is at risk — same as every cutout target.
- The cutout underlay shows skin + face shape layers; torso underwear
  stamps and clothing prints are NOT in the paint underlay yet (they
  composite in the /characters captures over the painting).
- The COMPILED game does not composite overlays yet — bake.ts's texture
  story is the bake lane's (figure CAPTURE carries the same row).
- Smart select stays off for model targets (needs an image FILE — the
  material-canvas rule).

## TATTOODRAFT (2026-06-05, USER ASK: "the same for all the body parts — tattoos")

The draft lifeline grew into a BOOK: one slot PER working target
(_cutout_drafts.json — each body part, each vehicle panel, the library
canvas), MRU-ordered, capped (P2 'cutout-view.draftSlots', default 12,
oldest evicts). The tattoo workflow this serves: hop torso → arm → hand
mid-design and EVERY part keeps its unsaved strokes —

- target switches flush the old target's slot synchronously (the debounce
  window can't eat the tail) — but only targets actually painted earn a
  slot (a pristine open-and-leave never evicts real work);
- re-opening a part resumes its unsaved slot OVER the saved overlay
  ("unsaved draft resumed" in the status);
- a save releases its slot (the model carries the painting; a lingering
  slot could resurrect stale strokes after an external edit);
- one torn slot never costs the others; the legacy single-draft file reads
  as one slot (addition, not migration); a fresh mount restores the newest
  slot — hot updates land you exactly where you were.

SURFACED for the user's eyes (tattoo-shaped, not guessed): the figure's
limbs are ONE part ('pipe') — all four limb instances share one texture, so
a forearm tattoo appears on every limb (hands/feet/fingers likewise share
across left/right). Per-limb tattoos need per-INSTANCE texture slots in the
figure kit (a door extension + new paint targets) — awaiting a ruling
before inventing the granularity.

## LIMBPAINT + OPEN-SLOT + the preview panel (2026-06-05, USER ASKS)

- ~~limbs share one texture~~ CLOSED by ruling: the MODELS rail offers
  per-segment targets (L/R upper/lower arm + leg, L/R hand/foot, pelvis,
  plus the broad all-limbs/both-hands/both-feet surfaces). A forearm tattoo
  lands on THAT forearm. The pelvis is its own target and never inherits
  torso paint (the "two sets of tits" report).
- /characters body parts: 'detail paint' renamed 'sculpt detail' (it shapes
  geometry — the user read it as the painter) and every body part's row
  carries the same 'paint texture → /cutout' deep-link the face has.
- OPEN-SLOT (the "took a torso to the cutout → a hot update hit → it went
  away" report): OPENING a model target records its book slot immediately
  (an open-intent placeholder when stroke-less), so the TARGET survives a
  pre-stroke hot update; placeholders restore as a fresh canvas, never as
  a fake painting.
- The live 3D preview is a PANEL in the right stack above the inspector
  (280×300, P2 'cutout-modelpreview.panelWidth/Height') — the full-height
  thin column is gone ("the column is bad").

## FINEBRUSH (2026-06-06, USER ASK: "finer brush sizes")

- The brushSizes ladder went 5 detents → 18 (1,2,3,4,6,8,12,16,24,32,48,64,
  96,128,192,256,384,512): tattoo-line control at the low end. [ and ] (and
  the slider's +/- nudges) still step the ladder.
- The BrushSlider drags CONTINUOUS between 1 and 512 on a LOG-mapped track
  (the low end is fine-grained; a linear track wasted its travel on
  256–512). The pure mapping pair brushTrackToPx/brushPxToTrack lives in
  editors/paint/strokes.ts (P4: monotonic, clamps, round-trips the ladder,
  low third of the track stays at or under 8px). The 18 ladder sizes render
  as tick marks on the track.
- ALSO IN THIS COMMIT (another lane's stranded sources, riding to unbreak
  main): editors/paint/colors.ts + ColorWheel.tsx were referenced by
  already-pushed code (ToolRail, paint.test.ts) but never git-added, and
  layers.ts/usePaintEditor.ts backendTunables persistence backs the pushed
  test expectations. main could not bundle without them.

## LIVEBRUSH (2026-06-06, USER ASK: "a actual live brush preview so i can
## see where im painting")

- The brush/refine cursor ring is now the dab's TRUE screen footprint at
  any canvas zoom: source radius = pressureRadius(brushPx) (the no-pressure
  fallback dab — exactly brushPx on the stock curve; the ring follows the
  DAB if the P2 pressure curve is retuned), converted source → screen with
  the live zoom measured from two __canvas_screen_to_graph probes (no new
  host bindings). The old display clamp (cursor.radiusMin/Max) papered over
  the zoom lie and is DELETED from the tuning table + the /settings
  registry (stale stored overrides park harmlessly in the registry's
  pending map).
- Paint mode fills the ring with the ACTIVE slot-0 color at low alpha (the
  ring shows WHAT will paint); the border keeps the mode hue (warn=Paint /
  good=Eraser, accent=refine). Eraser keeps the green eraser look.
- Mirror on → a second, dimmer twin ring tracks at x' = w − sx (the engine
  paints a mirrored twin; the preview no longer hides it). The twin skips
  inside mirrorMinSeparationPx of the axis, matching the engine's seam rule.
