# pixel_icon_gallery cart inventory

Source cart: `cart/pixel_icon_gallery.tsx`

Reviewed: 2026-06-04

## High-level purpose

`pixel_icon_gallery` is a read-only viewer cart. It scans one directory on disk (`cart/pixel_icons/`), loads every saved 64×64 pixel-art icon — static and animated — and renders each one as a single GPU quad driven by a WGSL fragment shader. It is the *consumer* end of a producer/consumer pair: `cart/pixel_icon_demo.tsx` is the editor that creates and saves the icon files; this gallery just displays them. A scale picker (1×/2×/3×/4×/6× pixels per cell) lets you judge how icons hold up at different display sizes, and a reload button re-scans the directory without restarting the cart.

It has no editing, no persistence of its own (it never writes), no networking, no 3D, and no input beyond button presses. Its load-bearing concepts are: synchronous host filesystem reads, a run-length-encoded on-disk pixel format, a palette-indexed in-memory pixel matrix, and a shader-quad icon renderer whose entire input is one flat `f32` array in a storage buffer.

## Files touched by this behavior

- `cart/pixel_icon_gallery.tsx`: the cart itself. Directory scan, file decode, scale/reload UI, grid layout.
- `cart/pixel_icons/ShaderPixelIcon.tsx`: the two renderer components the gallery actually draws icons with (`ShaderPixelIcon` for static, `ShaderAnimIcon` for animated). Contains the WGSL shader and the matrix→f32-array packers.
- `cart/pixel_icons/PixelIcon.tsx`: imported **type-only** (`PixelMatrix`). None of its runtime code (the box-per-cell `PixelIcon` component, `MaskOverlay`, `PaintOverlay`) executes in this cart — those serve the editor cart, where individual cells need hit targets.
- `runtime/hooks/fs.ts`: the JS-side filesystem wrappers `readFile` and `listDir` used for the scan.
- `runtime/ffi.ts`: `callHost` / `callHostJson`, the generic bridge that `fs.ts` rides. Looks up `globalThis.__fs_*`, returns a fallback if the host function is missing or throws.
- `framework/v8_bindings_fs.zig`: the Zig host side. Registers `__fs_read` (line 634) and `__fs_list_json` (line 641) on globalThis.
- `runtime/primitives.tsx`: `Box`, `Col`, `Row`, `Pressable`, `Text`, and `Effect`. `Effect` (line 886) renames the cart-facing `data` prop to the host prop `effectData`.
- `v8_app.zig`: consumes `effectData` in applyProps (line 2141) into `node.effect_data`, which becomes the WGSL storage buffer the shader reads; the engine's paint path draws the quad.
- `cart/pixel_icons/*.64.json` and `*.64.anim.json`: the data files. Produced by `pixel_icon_demo`'s save path (and historically `scripts/img-to-pixels.py`).

Related but NOT used by this cart (same directory, same data shapes — listed for the recurrence map):

- `cart/pixel_icons/matrix.ts`: parses ImageMagick `txt:` output into a `PixelMatrix`. Used by `pixel_icon_demo` and `carve_lab`.
- `cart/pixel_icons/pixelMatrixFromSeed.ts`: deterministic procedural `PixelMatrix` from a u32 seed (identicon-style NPC/avatar faces). Pure JS, no host calls.
- `cart/pixel_icon_demo.tsx`: the editor/producer. Owns `encodeMatrix` (the run-length encoder, line 316) and its own copy of `decodeMatrix` (line 337).

## Host functions vs JavaScript functions

Host (Zig) calls — exactly two, both synchronous, both filesystem:

- `__fs_read(path)` via `readFile()` at `runtime/hooks/fs.ts:26-28` → `callHost` (`runtime/ffi.ts:53-63`). Returns the file body as a UTF-8 string, or the fallback `null` if missing. Implemented/registered at `framework/v8_bindings_fs.zig:634`.
- `__fs_list_json(path)` via `listDir()` at `runtime/hooks/fs.ts:41-43` → `callHostJson` (`runtime/ffi.ts:88-92`). The host returns the directory's child names as **one JSON string** (cheaper to cross the bridge as a single string than N FFI calls — the stated convention in `ffi.ts`); JS `JSON.parse`s it into `string[]`. Registered at `framework/v8_bindings_fs.zig:641`.

Both wrappers degrade silently: missing host fn or thrown error → fallback (`null` / `[]`), so the gallery renders the empty-state message rather than crashing on a host without fs bindings.

Path semantics: `ICON_DIR = 'cart/pixel_icons'` (`pixel_icon_gallery.tsx:15`) is a **relative path**, resolved against the binary's working directory (per the `fs.ts` header). The gallery therefore only finds icons when launched from the repo root (the dev-host norm). A shipped binary run from elsewhere scans an empty/nonexistent directory and shows "No icons yet".

Everything else is plain JavaScript: `JSON.parse`, regex filename filtering, array sort, run decoding, hex→float palette conversion, `setInterval`/`clearInterval` for animation timing. No `requestAnimationFrame` (doesn't exist on this host anyway), no `performance.now`, no Date.

## On-disk format (the contract with pixel_icon_demo)

Filename convention, enforced by regex `/\.64(\.anim)?\.json$/` at `pixel_icon_gallery.tsx:65`:

- `<stem>.64.json` — static icon.
- `<stem>.64.anim.json` — animation.
- `stemOf()` (line 53) strips the suffix to get the display name.

The directory also contains `.128.json` / `.512.json` resolution variants, `.cutout.png` source images, and `.sqi.json` files — **all skipped** by this gallery. It is strictly a 64-resolution viewer. (The 512s are explicitly "source data, don't render as boxes" per `PixelIcon.tsx:11`; here they're simply filtered out.)

Static file body (`EncodedMatrix`, `pixel_icon_gallery.tsx:24`):

```
{ size: 64, palette: ["#RRGGBB", ...], rows: EncodedRunEntry[][] }
```

`rows` is a run-length encoding, one array per row, left-to-right. Each entry is either a bare value (`number` palette index or `null` transparent = one cell) or a `[count, value]` pair (a run). Long flat regions collapse to single runs; worst case degrades to bare-number-per-cell, never significantly larger than flat. The encoder lives in the producer at `cart/pixel_icon_demo.tsx:316` (`encodeMatrix`).

Anim file body (`EncodedAnim`, line 25): same `size`/`palette` hoisted to the top level (one shared palette for all frames), plus `fps` and `frames: [{ rows }, ...]` where each frame carries only its own run-encoded rows. The static-vs-anim discriminator at load time is simply `Array.isArray(obj.frames)` (line 71).

## In-memory format

`PixelMatrix` (`cart/pixel_icons/PixelIcon.tsx:25-29`) is the flat canonical form used everywhere in memory:

```
{ size: N, palette: string[], pixels: Array<number | null> }   // length N², row-major
```

`pixels[i]` is an index into `palette`, or `null` for transparent. The two-part palette format is a disk-size optimization (512² with ~1000 unique colors: ~2.4MB inlined hex → a few hundred KB indexed).

`decodeMatrix` (`pixel_icon_gallery.tsx:27-43`) expands runs back to the flat array. **Duplication note for the glossary effort:** this function is a near-verbatim copy of `decodeMatrix` in `cart/pixel_icon_demo.tsx:337-352`. Same name, same logic, two files, no shared module — exactly the recurring-shape candidate this inventory exists to find. The encode/decode pair plus `PixelMatrix` itself wants to be one shared module (e.g. promoted out of the two carts into `cart/pixel_icons/` alongside `matrix.ts`, which already plays that shared-parser role for the ImageMagick path).

## Load path

`loadIcons()` (`pixel_icon_gallery.tsx:57-93`) is a plain synchronous function — not a hook, no async:

1. `listDir(ICON_DIR)` → host call, names only.
2. Sort a copy alphabetically (stable display order).
3. For each name matching the 64-res regex: `readFile()` → host call, then `JSON.parse`.
4. `frames` array present → decode every frame through `decodeMatrix` (sharing the file-level `size`/`palette`), keep only each frame's `pixels`, default `fps` to 12 if falsy → `AnimIconData`.
5. Otherwise → single `decodeMatrix` → `StaticIcon`.
6. Read failures and parse exceptions accumulate into an `errors: string[]` instead of throwing — one bad file never blocks the rest.

It runs inside `useEffect` keyed on `reloadKey` (lines 108-110): once at mount, again whenever the reload button increments the key. All disk I/O blocks the main thread for the duration of the scan (the `fs.ts` header sanctions this for typical sizes; the directory currently holds ~16 files).

## Render path — one quad per icon

The gallery renders **every** icon through the shader path; the box-per-cell `PixelIcon` is deliberately not used here (comment at `pixel_icon_gallery.tsx:95-99`: that renderer is kept for the editor where per-cell hit targets matter).

`ShaderPixelIcon` (`cart/pixel_icons/ShaderPixelIcon.tsx:84-88`):

- `packMatrix` (line 70, memoized on `data` identity) packs the matrix into one flat `number[]`:
  - `[0]` size, `[1]` palette count,
  - `[2 .. 2+3P)` palette as normalized RGB triples (hex parsed in JS via `parseInt`, `paletteToFloats` line 59),
  - then size² per-cell entries: palette index, or `-1` for null/transparent.
  - For a 64×64 icon with P colors: `2 + 3P + 4096` floats.
- Renders `<Effect shader={SHADER} data={packed} style={{width: dim, height: dim}} />` where `dim = size × pixelSize`.
- `Effect` (`runtime/primitives.tsx:886`) forwards `data` as the `effectData` host prop; `v8_app.zig:2141` copies it into `node.effect_data`, which is bound as a read-only WGSL storage buffer (`@group(0) @binding(1)`).

The WGSL shader (`ShaderPixelIcon.tsx:25-57`), per fragment: uv → cell coords (`floor(uv * size)`) → clamp into range (the host's 3-vertex fullscreen-triangle overdraw can push uv slightly past [0,1]; unclamped, edge fragments read garbage palette indices) → pixel index → palette lookup → opaque color, or fully transparent `vec4f(0)` for `-1`. uv arrives top-down, matching matrix row order, so no y-inversion is needed — the in-shader comment (lines 33-36) explicitly supersedes the stale header comment (lines 18-19) claiming inversion per `v8_app.zig:2251`.

Why this beats boxes (header, lines 3-9): 1 draw call instead of N² boxes, zero layout cost, no rect-shader AA dimming on 1px cells, and animation never touches per-cell React reconciliation.

## Animation path

`ShaderAnimIcon` (`ShaderPixelIcon.tsx:102-137`):

- Timing is JS `setInterval` (exists on this host; `requestAnimationFrame` does not), period `max(33, floor(1000/fps))` — capped at ~30fps regardless of stored fps. Interval recreated when `data` identity changes; skipped entirely for single-frame anims. Cleanup via `clearInterval`.
- Header (size + palette count + palette floats) packed once per `data` via `useMemo` (line 114); each tick re-packs only header + current frame's pixels into a fresh array (line 123).
- Each tick *does* re-render React (`setIdx` state update) — the source comment "no React reconciliation" is accurate only at the per-cell level: the diff is one `Effect` node's `effectData` prop, and the host's update is effectively "memcpy size² f32s into the storage buffer," vs. reconciling 4096 `Box` children in the box renderer.
- Dead code: `idxRef` (line 105) is written every render and never read; the "pause when document not visible" comment above it is aspirational — there is no `document` in this runtime and no pause logic exists.

With N animated icons mounted, there are N independent `setInterval` timers, each driving its own state update and quad rewrite. Fine at gallery scale; a shared ticker would be the consolidation if this pattern spreads.

## UI structure

Component `PixelIconGallery` (`pixel_icon_gallery.tsx:103`):

React state — three `useState` slots: `scale` (default 3), `loaded` (`{items, errors}`), `reloadKey`. One `useEffect`. No refs, no context, no memo at the gallery level.

Layout, all flex primitives with inline styles (no `className`/Tailwind in this cart):

- Root `Col`, full-size, dark background, hardcoded hex palette constants (lines 17-21).
- Header `Col`: title + live count line ("N icons (M animated)").
- Controls `Row`: scale buttons from `SCALES = [1, 2, 3, 4, 6]` (line 101 — note the file's header comment says "1/2/3/4", drifted from the code), each a `Pressable`→`Box`→`Text` with selected-state styling; spacer `Box`; reload `Pressable` that bumps `reloadKey`.
- Error panel: only when `errors` is non-empty; shows at most the first 5 (`slice(0, 5)`), dark-red card.
- Icon grid: a wrapping `Row` (`flexWrap: 'wrap'`), one `Col` per icon keyed by **filename** (unique per directory listing): padded card `Box` → fixed `64×scale` square `Box` → shader icon; stem label; meta line ("Kf @ Nfps" or "static").
- Empty state: text pointing the user at `pixel_icon_demo` as the producer.

Note the sizing wrapper hardcodes `64 * scale` while the shader components size themselves `data.size × pixelSize` — consistent only because the filename filter guarantees size=64. A non-64 file named `*.64.json` would overflow its card.

## What is not here

- No writes — `writeFile`, `mkdir`, `remove` are imported nowhere; this cart never mutates disk.
- No localstore/SQLite/HTTP/clipboard/`__exec`/eventbus host calls.
- No 3D (`Scene3D`), no `Canvas`/`Graph`, no `StaticSurface`.
- No Tailwind/`className`; all styling is inline objects.
- No keyboard or pointer handling beyond `Pressable.onPress`.
- No fs watcher — reload is manual. (A `useConnection`-style live binding to the directory would be the upgrade if the editor and gallery are ever open simultaneously.)
- No editing, selection, or per-cell interaction — that's the editor cart's domain.
- No use of `matrix.ts`, `pixelMatrixFromSeed.ts`, `MaskOverlay`, `PaintOverlay`, or the box-per-cell `PixelIcon` despite living next to them.

## Integration-relevant observations

- **`PixelMatrix` is the lingua franca.** Four independent producers exist in the repo — ImageMagick parse (`matrix.ts`), seed-procedural (`pixelMatrixFromSeed.ts`), the editor's interactive edits, and disk decode — and two renderers consume it (box-per-cell, shader-quad). The type is the stable hub; everything else is an adapter.
- **`decodeMatrix` is duplicated** (gallery line 27 vs demo line 337) and `encodeMatrix` lives only in the demo. The encode/decode pair + the filename convention (`.64.json` / `.64.anim.json`) constitute an undocumented file-format module that should be extracted once and imported by both carts.
- **The "pack a struct into a flat f32 array → `Effect data` → storage buffer" shape** is the standard way carts feed dynamic data to WGSL (palette+indices here; same idiom as the chart/fill shaders elsewhere). Header-once/payload-per-frame packing (`ShaderAnimIcon`) is the animation refinement of it.
- **Two-renderer pattern**: same data, shader-quad for display (cheap, no hit targets) vs. box-per-cell for editing (per-cell interaction). Choosing per use-site rather than forking the data is the right precedent.
- **Sync host fs + degrade-to-fallback (`callHost` with fallback)** is the standing idiom for optional host capability; the gallery works (empty) even on a host without fs bindings.
- **Producer/consumer cart pairs over shared state**: the editor writes files; the gallery reads files. Disk is the channel — same philosophy as the cutout session pattern (disk = truth).
- The relative `ICON_DIR` ties the cart to being launched from the repo root; any "real game asset" version of this needs an asset-path convention instead.

## Glossary

Anim icon: An icon whose file ends `.64.anim.json` — shared palette, `fps`, and a `frames` array of run-encoded pixel grids. Played by `ShaderAnimIcon` on a `setInterval`.

EncodedMatrix / rows-of-runs: The on-disk run-length encoding — `{size, palette, rows}` where each row entry is a bare cell value or a `[count, value]` run. Produced by `encodeMatrix` (pixel_icon_demo), expanded by `decodeMatrix`.

Effect data / effectData: The flat `number[]` a cart passes via `<Effect data={...}>`; renamed to the `effectData` host prop by `runtime/primitives.tsx:886`, stored on the node by `v8_app.zig:2141`, and bound to the fragment shader as a read-only storage buffer at `@binding(1)`.

Header packing: `ShaderAnimIcon`'s split of the storage-buffer payload into a memoized constant prefix (size, palette count, palette floats) and a per-frame pixel slice, so frame swaps recompute only the pixels.

Palette-indexed matrix: The `PixelMatrix` storage scheme — unique hex colors in `palette`, per-cell indices (or `null`) in `pixels` — chosen for on-disk compactness.

PixelMatrix: The canonical flat in-memory icon form: `{size, palette, pixels}`, `pixels` length size², row-major, `null` = transparent. Defined in `cart/pixel_icons/PixelIcon.tsx:25`.

Reload key: Integer state whose increments re-run the `useEffect` directory scan — the manual refresh mechanism.

Scale: Display pixels per matrix cell (1/2/3/4/6). Pure presentation; the same packed data renders at any scale because the shader samples by uv.

Shader-quad icon: An icon drawn as one `<Effect>` quad whose WGSL does cell lookup + palette fetch per fragment — vs. the box-per-cell renderer kept for editing.

Stem: The icon's display name — filename with the `.64(.anim).json` suffix stripped (`stemOf`, line 53).

uv clamp: The `clamp(cell, 0, size-1)` in the shader guarding against the fullscreen-triangle overdraw pushing uv past [0,1] and reading garbage palette indices at the right/bottom edges.
