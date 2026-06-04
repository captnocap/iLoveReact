# pixel_icon_demo cart inventory

Source cart: `cart/pixel_icon_demo.tsx` (1693 lines, single file)

Reviewed: 2026-06-04

## High-level purpose

`pixel_icon_demo` is the **producer/editor** half of the pixel-icon pair (`pixel_icon_gallery` is the viewer). It ingests any image — or any video/GIF — by shelling out to **ImageMagick and ffmpeg as host subprocesses**, quantizes it into palette-indexed pixel matrices at three resolutions (64/128/512), and gives the user an interactive 64-grid editor (erase / restore / paint, brush or magic wand, per-frame undo/redo, manual frame animation) before saving. Two export paths:

1. **Pixel-icon JSON** → `cart/pixel_icons/<stem>.<size>.json` (or `.anim.json`) in the run-length `rows` format the gallery reads.
2. **Full-resolution PNG cutout** → `cart/pixel_icons/<stem>.cutout.png` — the original image with the mask applied as alpha and paint composited on top, built by handing magick hand-written ASCII/binary PGM/PPM files.

It is the repo's heaviest *external-tool orchestration* cart: nothing here decodes an image in JS; all pixel work is done by `magick`/`ffmpeg` writing text files the cart parses back.

## Files touched by this behavior

- `cart/pixel_icon_demo.tsx`: everything — pipelines, editor state machine, exports, UI.
- `cart/pixel_icons/PixelIcon.tsx`: `PixelIcon` (the box-per-cell renderer — used here *because* cells need hit-targets and per-cell overlays), `MaskOverlay`, `PaintOverlay`, `PixelMatrix` type.
- `cart/pixel_icons/matrix.ts`: `parseTxt` — ImageMagick `txt:` enumeration → `PixelMatrix`. Shared with carve_lab (one parser, two consumers; the magick *invocations* stay per-cart because flags differ).
- `runtime/hooks/process.ts`: `run(cmd, args)` (spawn → collect stdout/stderr via proc event channels → resolve on exit; line 115) and `execAsync(cmd)` (host `popen` on a detached thread, resolves over the `exec:<rid>` ffi bus channel; line 142). Backed by `framework/process.zig` / `v8_bindings_process.zig` (`__proc_spawn`, `__proc_kill`, `__proc_wait`, proc events via `__ffiEmit('proc:stdout/stderr/exit:<pid>')`, `__exec_async`).
- `runtime/hooks/fs.ts`: `readFile`, `writeFile`, `mkdir` → `__fs_read` / `__fs_write` / `__fs_mkdir` (`framework/v8_bindings_fs.zig`).
- `runtime/hooks/useFileDrop.ts`: window file-drop → `__filedropSeq` / `__filedropLastPath`, bridging `framework/filedrop.zig`.
- `runtime/ffi.ts`: `callHost` (used directly for the one raw binding below).
- `framework/v8_bindings_telemetry.zig:1242`: `__canvas_screen_to_graph` — imported and wrapped (cart line 27) but **only reachable from dead code** (see "Vestigial Canvas editor" below).
- External binaries (must be on PATH): `magick`, `ffmpeg`, `sh`, `zenity`.
- Scratch: `/tmp/_reactjit_pixel` (`SCRATCH_DIR`) for all intermediate `.txt`/`.png`/`.pgm`/`.ppm` files.

## Host functions vs JavaScript functions

Host (Zig) surface used:

- **Subprocess**: `run()` → `__proc_spawn` + ffi-bus listeners; every magick/ffmpeg/sh call goes through it. `execAsync()` → `__exec_async` (+`exec:<rid>` bus reply) for the two zenity file pickers — the comment in `process.ts` is explicit that sync `__exec` would block the click frame.
- **Filesystem**: `mkdir` (scratch + `cart/pixel_icons`), `readFile` (magick's txt output), `writeFile` (JSON saves, PGM/PPM masks). All synchronous.
- **File drop**: `useFileDrop` is *not* event-push — `filedrop.zig` bumps a monotonic seq + `markDirty()`; the hook re-reads `__filedropSeq` **during every render** and fires the handler when it advances (read-on-render polling, hook file lines 30-37).
- **Canvas math**: `__canvas_screen_to_graph` (screen px → pan/zoom-aware Canvas world coords) — wrapped but dead here.

Everything else is JS: `parseTxt` regex parsing, RLE encode/decode, flood fills, mask/paint set algebra, palette math, PGM/PPM text assembly, `setInterval` playback.

## Ingest pipelines

**Static image** (`ingest` → `imageToMatrix`, lines 56-75): for each of 64/128/512 — `magick <src> -resize NxN! +dither -colors <K> -depth 8 txt:<scratch>` then `readFile` + `parseTxt`. `+dither` is deliberate: dithering would scatter near-duplicate colors and kill the RLE; banding + long flat runs are preferred for icons. Color count K is user-selectable (16/32/64/128/256, default 64); `requantize` re-runs the pipeline on the same source.

**Video/GIF** (`ingestVideo` → `videoToAnim`, lines 96-181), per size:
1. `ffmpeg -i <src> -vf fps=<fps>,scale=N:N:flags=lanczos frame_%04d.png` — frame dump at target fps (6/12/24/30, default 12).
2. **Shared palette**: sample ≤60 evenly-strided frames (a flat `+append` of all frames can blow ImageMagick's 16KP width policy), `magick montage` them into a near-square tile, quantize once → `palette.png`.
3. Per frame: `magick <frame> +dither -remap palette.png -depth 8 txt:` → `parseTxt`.
4. **Reindexing**: magick's txt header lists colors in first-appearance order, which varies per frame even under `-remap`; frame 0's palette becomes canonical and later frames' indices are remapped (appending genuinely-new colors), so all frames share one palette ordering — the property the gallery's `ShaderAnimIcon` depends on (swap pixels under a stable palette).

A `tokenRef` guard (`++tokenRef.current` per ingest, checked after every await) cancels stale async pipelines when the user drops a new file mid-conversion. Drop-vs-pick routing is by filename regex (`VIDEO_EXT_RE`, line 93).

## The editing model (the heart of the cart)

All editing happens at **64-grid resolution** (`MASK_RES = 64`), regardless of which matrix you're previewing:

- `mask: Set<number>` — erased cell indices (cell = y*64+x).
- `paint: Map<number, string>` — painted cell → hex color.
- These are the **live** stroke state, updated per mousemove; the **committed** state + undo history live per frame in `frames: FrameSlot[]` where `FrameSlot = { mask, paint, history: HistEntry[], histIdx }` and `HistEntry` snapshots mask AND paint atomically (one undo reverses a whole stroke regardless of mode). History capped at 50; `commitMask` fires on mouseup/mouseleave; the wand commits immediately (no drag stroke).

Tools/modes matrix:
- **brush** (square, radius 0/1/2/4 → 1/3/5/9 cells) × **erase** (mask.add, paint.delete — mask wins), **restore** (delete from both), **paint** (paint.set(currentColor), mask.delete). Copy-on-write inside `paintAt` (`ensureMask`/`ensurePaint`) so untouched maps keep their identity.
- **wand** × erase/paint uses `floodFillColor` (lines 384-431): BFS over the 64-matrix with a **two-tolerance** rule — candidate cells must be within `tol` (RGB euclidean, user 8-96) of the *seed* color AND within `max(6, tol/3)` of the *cell expanded from*; the stricter step tolerance kills bleed-through across anti-aliased edges ("Pepe's mouth → face"). Palette pre-filtered to valid indices so the BFS body is Set.has, no per-pixel hex parsing. Wand × restore uses `floodFillMask` — plain connectivity over the erased set.
- Mask/paint are resolution-independent: at save, each 64-cell scales to a 2×2 block at 128 and 8×8 at 512 (`applyMaskToMatrix`/`applyPaintToMatrix`, which also extends the palette with new paint colors; both return new matrices, never mutate).

**Hi-res mask** (independent layer for the PNG path): a `Uint8Array` at *native source resolution* held in a **ref** (`hiResMaskRef` — 20MB+ at 4K; recreating per mousemove would thrash GC), allocated after `magick identify -format '%w %h'` returns dims. "fine" brush mode stamps circles of `brushPx` (2-512 source px) via `paintHiResCircle`, positioned by fractional-cell `screenToCellF` → source-pixel scale. `hiResVersion` state bumps **only on stroke commit** so React stays out of the per-mousemove path. The 64-grid and hi-res masks are explicitly independent: 64-grid drives the JSON icons, hi-res drives the PNG silhouette, and export merges 64-grid erases *into* the hi-res mask so coarse + fine stack.

**Perf discipline** (comment at lines 1213-1218 is the canonical statement): `PixelIcon`'s `data` prop stays pinned to the raw matrix (it's `React.memo`'d — a fresh masked matrix per mousemove would reconcile 4096 cells per event, "a hard thread-lock"); live edits render as `MaskOverlay`/`PaintOverlay` sparse absolute layers costing O(edit size). The three size thumbnails use a `useMemo` of paint-then-mask applied to the **committed** state only, so they're stable through a drag and snap to truth on commit.

## Animation: two distinct modes

- **Video anim** (`isAnim`, from ffmpeg ingest): frames are real per-frame pixels under the shared palette. Frame change refreshes `matrices` with that frame's pixels (effect at line 864) so all single-frame render paths just work. The 64-grid mask applies to **every frame** at save (a crop persists across the loop); paint is not per-frame here.
- **Manual anim** (`isManualAnim`, `frames.length > 1` on a static image): one base image, **per-frame mask + paint** — flipbook editing by erasing/painting differently per frame. `+ frame` clones the current live mask/paint as the new frame's start; goToFrame/addFrame/removeFrame all persist in-flight edits into the slot first; an effect (line 879) loads the target frame's committed state into the live mask/paint, guarded by `lastLoadedFrameRef` so playback doesn't clobber an in-flight stroke.

Playback: `setInterval` at `max(33, 1000/fps)` cycling `frameIdx` (same ≥33ms clamp as the gallery player). ◀/▶ pause playback and step.

## Save paths

**JSON** (`onSave`, line 888): three flavors —
- static: paint→mask applied to each size's matrix → `encodeMatrix` → `<stem>.<size>.json`;
- video anim: mask baked into every frame's pixels → `{size, palette, fps, frames:[{rows}]}` → `.anim.json`;
- manual anim: per-frame paint+mask applied over the shared base per size; the canonical palette is the *largest* paint-extended palette (paint only appends, so smaller ones are prefixes).

`encodeMatrix` (line 316) is the RLE encoder (`rows` of bare values / `[count, value]` runs); `decodeMatrix` (line 337) is kept compiled-in (`void decodeMatrix`) for future round-trip tooling but unused — and is the duplicate of the gallery's copy (see gallery doc).

**PNG cutout** (`onSavePNG`, line 964): the mask is rendered to ImageMagick-readable images written with `writeFile`:
- 64-grid mask → **ASCII P2 PGM** (0=erased, 255=keep; trailing newline required — magick 7 rejects the file without it).
- hi-res mask → **binary P5 PGM with maxval=1** — the byte values 0/1 are single-byte UTF-8 codepoints, so they survive the runtime's **UTF-8-only `writeFile`** unchanged (the trick at line 458; string assembled via `String.fromCharCode.apply` in 32KB chunks to avoid blowing the call stack).
- paint → P3 PPM (RGB) + P2 PGM (binary alpha).

Then one `magick` call with **argv parentheses** (`(` `)` as plain argv tokens — no shell, no escaping): optional paint layer = CopyOpacity(rgb,alpha) → point-resize to source dims → Over-composite onto the source; then mask point-resized (no-op if hi-res) → `-blur 0x<feather>` (0.5px for hi-res; `max(0.5, maxDim*0.0005)` to soften the 64-grid stairstep) → CopyOpacity as final alpha → `<stem>.cutout.png`. Interior detail is full source resolution; only the silhouette is 64-grid-constrained (unless fine-brushed).

## Vestigial Canvas editor (dead code)

A Canvas-based hi-res editing surface was started and abandoned in place: the `Canvas` primitive import (line 14), the `canvasScreenToGraph` wrapper (line 27), `canvasRect` state (its setter is **never called**), `screenToWorld` (line 1090), `paintAtWorld` (line 1106), and the `hiResOverlayCells` downsampling memo (line 1243, computed every `hiResVersion` bump but **rendered nowhere**). No `<Canvas>` element exists in the JSX. The live fine-brush path instead goes through the preview rect (`screenToCellF`). Cleanup or completion candidate — as written it costs one wasted O(srcW×srcH) scan per stroke commit.

## UI structure

Single `Col` page (no Tailwind, inline styles, same `BG/INK/DIM/ACCENT` palette family as the gallery): title; pick buttons + colors row + fps row; status card (border color = busy WARN / loaded GOOD); then a 3-column row — source `<Image>` (240², the host image loader showing the original), the editable preview (`PixelIcon` at 64×(6×zoom)px + PaintOverlay + MaskOverlay stacked in a relative Box with onLayout→`previewRect` and mouse handlers), and the three committed-state thumbnails (64@1/2/3px). Below: frame nav row, tool/mode/brush/tolerance/palette/undo-redo/zoom/save row (the paint swatches include 8 colors sampled from the image's own palette), save-as row, saved-files card. Status text (`mask.size erased · paint.size painted · h<idx>/<len>`) doubles as the history debugger.

## What is not here

- No `Effect`/shader rendering (editing needs per-cell hit targets — the box renderer is the point; the gallery is the shader consumer).
- No Scene3D/Graph; no networking; no localstore/SQLite (disk files are the product); no IFTTT bus use beyond what `run()` uses internally.
- No keyboard shortcuts — all tools are buttons.
- No binary file writes — every magick input is text-encoded (the UTF-8-only `writeFile` constraint shapes the whole PNM strategy).
- No image decoding in JS — magick is the only pixel reader.

## Integration-relevant observations

- **External-tool orchestration via `run()`** is proven here at scale: ffmpeg + montage-pipe + per-frame remap loops with progress callbacks (`onProgress` → status line). Any future asset-bake step can copy this shape, including the stale-token cancellation guard.
- **The UTF-8-only `writeFile` boundary** is load-bearing: ASCII PNM formats + the P5-maxval-1 trick are the established workaround. A binary `__fs_write_bytes` host fn would delete ~60 lines of encoding gymnastics here and unblock other binary producers.
- **Live-vs-committed edit state + atomic snapshot history per frame** is the same disk-adjacent undo philosophy as the cutout session pattern — this is its in-memory miniature. `FrameSlot` is a reusable shape for any stroke-based editor.
- **Two-tolerance flood fill** (seed tol + stricter step tol) is the wand algorithm worth canonizing; carve_lab and any future mask tool will want it.
- **Overlay-don't-rebuild** (memo'd base + sparse absolute overlays for live edits) is the established recipe for interactive grids — same MAX_CHILDREN-aware run-coalescing in the overlays.
- **Duplication ledger**: `encodeMatrix`/`decodeMatrix` ↔ gallery's `decodeMatrix` (the file-format module that wants extracting); save-time mask scaling (`onSave` anim branch, lines 899-911) re-implements `applyMaskToMatrix`'s loop inline; `loadSrcDims` and `onSavePNG` both run `magick identify` separately.
- **useFileDrop's seq-poll-on-render** is a third host-event idiom (alongside ffi bus push and `isKeyDown` polling) — worth noting in the glossary effort as the "markDirty + read-on-render" pattern.

## Glossary

64-grid: The fixed 64×64 editing resolution. All masks/paints index cells `y*64+x`; saves scale cells up to each matrix size.

Canonical palette: Frame 0's palette ordering (video anim) or the largest paint-extended palette (manual anim) — the single palette all frames index into.

Committed vs live: Live `mask`/`paint` mutate per mousemove; the per-frame `FrameSlot` holds the committed snapshot + history, updated by `commitMask` on stroke end.

Cutout: The full-resolution PNG export — source image with mask as alpha and paint composited, built entirely by magick from text-encoded mask layers.

Fine brush: The hi-res erase mode — circular stamps of `brushPx` source pixels into the hi-res mask, bypassing the 64-grid sets.

FrameSlot: `{mask, paint, history[≤50], histIdx}` — one manual-animation frame's committed state plus its undo stack of atomic `{mask, paint}` snapshots.

Hi-res mask: Source-resolution `Uint8Array` in a ref (1=erased), versioned by `hiResVersion` on commit only; merged with the 64-grid mask at PNG export.

Ingest token: `tokenRef` counter incremented per ingest; every await checks it so a newer drop silently cancels the older pipeline.

Manual anim: Multi-frame animation authored by per-frame mask+paint over one static base image (flipbook), saved as `.anim.json`.

P5-maxval-1 trick: Encoding a binary PGM whose bytes are all 0/1 — valid single-byte UTF-8 — so the UTF-8-only `writeFile` can emit a "binary" file magick accepts.

Reindexing: Remapping each video frame's first-appearance-ordered palette indices onto the canonical palette so all frames share index meaning.

Requantize: Re-run the full ingest on the current source with a new color count.

Shared palette: One palette quantized from a ≤60-frame montage sample, `-remap`'d onto every frame — the property that makes anim playback a pixels-only swap.

Step tolerance: The stricter neighbor-to-neighbor color tolerance (`max(6, tol/3)`) in `floodFillColor` that stops the wand leaking across anti-aliased boundaries.

Wand: Flood-fill selection — color-similarity BFS (erase/paint) or mask-connectivity BFS (restore), committed immediately.
