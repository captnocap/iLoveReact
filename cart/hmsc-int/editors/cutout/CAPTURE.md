# editors/cutout — EDITOR-CAPTURE note (CUTOUTAPP-0605)

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
| 16 | Tool palette: hand/brush/refine/lasso/smart; modes erase/restore; clear/invert | PRESENT(engine) — `PaintToolRail` (text chips; the original's icon tiles are a style difference, noted) |
| 17 | Brush size control: 5 detents [2,8,32,128,512], +/- nudge, px label, drag slider | PRESENT(engine) — size chips = the same 5 detents + `[`/`]` step keys; the slider skin not duplicated |
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
6. **Style differences kept deliberate:** tool chips are text (the chrome
   kit's idiom) where the original used icon tiles; brush sizes are chips
   over the same 5 detents instead of a drag slider; tunables are Knobs
   instead of drag sliders (the tool's established control, the vehicles
   precedent). Capabilities identical; skins differ with the one app.

## Tests (P4, `rjit game verify` — `editors/` suite root)

`cutout.test.ts`, 8 cases: empty/short-mask extraction refusal, mask→asset→
mask exact round-trip + pixel bookkeeping + preview-downsample law,
cutout-reopens-as-document (parse gate + base equality + no override),
library stream semantics (upsert/remove/unknown-kind tolerance), the
one-commit-per-save session contract (content event + labeled marker +
snapshot materialization), replay-identical reopen, id/name minting laws,
working-draft round-trip + strict version/shape gate. Route JSX
bundle-verified through the real cart pipeline aliases.
