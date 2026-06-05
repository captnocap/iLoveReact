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
painting for skins/textures not the map"), V17-TRIAGE (authoring UI = an
editors/ route, written fresh), V20 (editors write to the data layer from
their first version), P2/P3/P4.

## The deletion contract — app-surface inventory

Every cutout-app capability outside the engine, where it landed:

| # | Capability (cutout.md section) | New home | Status |
|---|---|---|---|
| 1 | App shell: top bar / left tools / center editor / right inspector / bottom status, fixed viewport | `CutoutRoute` header + library rail + `PaintEditor` (rail · viewport · layers/look) | DONE |
| 2 | Image ingest: `identify` dims + grayscale load for edge snapping | `sources.ts` (`identifyImage`/`loadGraySource`, magick subprocess — the engine takes dims/srcPath/gray as DATA) | DONE |
| 3 | Blank canvas creation + size clamp 16..4096 + checkerboard | header W×H inputs + 256/512/1024 presets + `new canvas` (clamp = `PAINT.tuning.canvas`; checkerboard is the engine viewport's) | DONE |
| 4 | File-drop ingest | `useFileDrop` on the route (drop anywhere → load) | DONE |
| 5 | Working-document persistence (autosaved `sessions/*.session.json` + `_last.txt` restore) | REPLACED by V20: deliberate **Save** commits the full `PaintDocument` to the `cutout` stream; the library rail reopens any saved document (upsert by id) | DONE |
| 6 | PNG cutout export (`CopyOpacity` composite) | LANDED IN-APP as the cutout ASSET: **Extract** commits {RLE mask @ source res, preview cells, pixels, srcPath, docId} to the stream — a named, reopenable, consumable region. Export-to-FILE deliberately not built (ambiguity 3) | DONE (as asset) |
| 7 | Pixel-icon JSON export | not carried (file-export family — ambiguity 3) | — |
| 8 | `.sqi` build/parse/import | not carried (cutout's document format; `PaintDocument` is the document here) | — |
| 9 | Zenity file picker | not carried — path field + file drop instead (ambiguity 5) | — |
| 10 | Window controls (min/max/close) + `windowDrag` title | N/A — the shell owns the window | — |
| 11 | Status bar telemetry (fps / zoom / size estimate / saved age) | not carried — the painter HUD + header status line carry editor state; perf lives in the tool's own surfaces (`/log`) | — |
| 12 | Context menu / recent files / tabs (reserved-disabled in the original) | not carried — ProjectBar is the workspace surface | — |
| 13 | Tool palette / inspector / layer stack / tunables / undo / hotkeys | engine capabilities (paint CAPTURE.md 1–34), mounted whole via `PaintEditor`. Hotkeys stay ON (cutout parity) — the host suppresses key triggers while a TextInput is focused, so the route's name/path/dims inputs are safe | DONE |
| 14 | Theme (`theme.ts` palette/sizes) | GAME_CHROME tokens (the one chrome) | DONE |
| 15 | **NEW — not in cutout:** the LIBRARY: saved documents + extracted cutouts as game data (V20 `cutout` stream: saved/extracted/removed; snapshot = what consumers load) | `stream.ts` + the rail | DONE |
| 16 | **NEW:** cutout reopens as a working document (one layer whose base IS the mask — refinable, extendable) | `extraction.ts cutoutToDocument` + rail open | DONE |
| 17 | **NEW — V20 session history:** strokes/lasso/smart/layer-ops = labeled notes (the engine's per-interaction contract); saves + extractions + removals = commit-grade on the route's own `cutout` channel | `/cutout` session in `CutoutRoute` | DONE |

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
4. **No mid-stroke autosave of the working canvas.** The original debounced a
   session file per edit; here saves are deliberate (a stroke is a note, not
   a full-document event — per-stroke document blobs would bloat the append
   log). If the user wants crash-safe drafts, a debounced workspace-file
   draft (the map editor's pattern) can sit beside the stream without
   touching it.
5. **No OS file picker** — typing/pasting a path or dropping a file replaces
   Zenity. An in-tool file browser would be a shell-level capability, not a
   route fork.

## Tests (P4, `rjit game verify` — `editors/` suite root)

`cutout.test.ts`, 7 cases: empty/short-mask extraction refusal, mask→asset→
mask exact round-trip + pixel bookkeeping + preview-downsample law,
cutout-reopens-as-document (parse gate + base equality + no override),
library stream semantics (upsert/remove/unknown-kind tolerance), the
one-commit-per-save session contract (content event + labeled marker +
snapshot materialization), replay-identical reopen, id/name minting laws.
Route JSX bundle-verified through the real cart pipeline aliases.
