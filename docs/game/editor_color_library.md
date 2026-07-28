# Editor Color Library + shader browser

Active surface: `cart/editor/`. Last verified: 2026-07-21.

## User contract — req_3097

The ink popover (PaintToolbar → Color / Shader tabs) was ruled "the most
un-friendly color picking component" — six named defects, each now a mechanism:

1. **Hex overlap** — the HTML-hex field drew over the color name. The CURRENT
   header is two rows now (swatch + name/readout, then hex + save); nothing
   shares a line it can't fit on (`cart/editor/stage/ColorLibraryPanel.tsx`).
2. **Fake SAVED** — the tray seeded three pretend colors and evaporated on cold
   restart. The seeds are gone; SAVED starts from
   `zig-out/game/editor/color-library.json`
   (`cart/editor/data/colorLibraryStore.ts`, globalsStore pattern: load at boot
   in `persistView.loadPersistedState`, debounced micro-save on every change).
3. **No raw history** — RECENT: every committed color select funnels through the
   Color Studio color-select command; `AppFrame` commitChoice pushes it into
   `colorSpineRecents` (`pushRecentColor`, newest first, deduped by hex, cap
   14). Persisted beside SAVED. Use a color, never save it — it's still there.
4. **Fake SCENE** — the hardcoded scene rows are dead. `sceneSwatches()`
   (`cart/editor/data/colorSpine.ts`) reads `__model_atlas_palette(n)`: the
   host histograms the LIVE paint atlas (4-bit/channel bins over island texels,
   strided past 1M, top-N bins averaged back to true colors —
   `model_paint.atlasPalette`). No paint target → empty → the section hides.
5. **Dead eyedropper** — `__model_paint_sample(x, y)`: host pickBary raycast +
   atlas texel read (`model_paint.sampleTexel`, selection tint lifted), packed
   0xRRGGBB or -1. ModelView's paint surface routes the eyedropper tool through
   it (click or drag = live sampling) and announces via the
   `__modelColorSampled` global → spine color-select → RECENT + ink sync. The
   facade painter's readback eyedropper announces through the same global.
6. **Shader browser** — searchable (label/group/id substring over all specs),
   a FIXED 8-wide × 6-row grid (48 visible materials; group shelving used to
   restart the wrap per group), group names in one caption line + per-thumb
   tooltips, and the Paint panel REMEMBERS tab/page/search across close/reopen
   (module-scope memos in `PaintSidePanel.tsx`); opening with a shader dipped
   lands on that shader's page until you page by hand. The complete interactive
   grid is one `StaticSurface`: after its first capture, 48 live Effect
   render-to-texture passes collapse to one cached image quad. Pressables remain
   in the layout/hit-test tree, and `ShaderThumb` compares shader-data values so
   fresh-but-equal arrays from unrelated parent renders do not force re-capture.
   The cold capture/page path is batched too (`req_3333`): all generated fill
   cells pack their variable-length material rows behind an offset table and one
   grid-routed Effect renders them. Since `req_3473` the batch composes a
   PER-PAGE module (`shaders/compose.ts` — the page's material fns + a small
   `fill_pick` chain + the same `FILL_MAIN` envelope) instead of the canonical
   409-material `FILL_SHADER`, whose single ~730 KB module cost every boot a
   ~90 s render-thread compile; a page module is ~20-40 KB and compiles in
   milliseconds. Slot-keyed transparent Pressables preserve all 48 independent
   targets instead of remounting them on every page. Only recipes with genuinely
   different WGSL use the per-cell fallback (built-in pages 2–8: one Effect
   total; page 1: batch + Road; last page: batch + two special recipes).

## Mechanism map

- `framework/gpu/model_paint.zig` — `sampleTexel(face, u, v)` (bary → island
  texel, affine inverse of the dab mapping), `atlasPalette(out)` (dominant-color
  histogram).
- `framework/gpu/3d.zig` — `samplePaintAt(mx, my)`, `paintAtlasPalette(out)`
  (viewport-pixel + hasTarget guards).
- `framework/v8_bindings_core.zig` — `__model_paint_sample`,
  `__model_atlas_palette` (JSON `[[r,g,b],...]`), both tint-lifted like
  `__model_atlas_read`.
- `cart/editor/data/colorLibraryStore.ts` — the per-concern disk file (V20).
- `cart/editor/data/colorSpine.ts` — `pushRecentColor`, host-fed
  `sceneSwatches`; the pretend palettes deleted.
- `cart/editor/shell/AppFrame.tsx` — RECENT recording in the color-select
  commit, color-library micro-save effect, `__modelColorSampled` installer.
- `cart/editor/stage/ColorLibraryPanel.tsx` — two-row CURRENT header, RECENT +
  SAVED rows, SCENE hidden when empty (host read memoized per mount).
- `cart/editor/shell/PaintSidePanel.tsx` — shader search + 48-cell cached grid +
  remembered position; slot-stable Pressable overlay for page changes.
- `cart/editor/shell/ShaderGridBatch.tsx` — validates/packs standard material
  rows, renders one canonical fill Effect, and value-compares packed buffers so
  unrelated parent renders do not dirty the cache.
- `cart/editor/render3d/shaders/index.ts` — the `FILL_MAIN` fs_main handling
  ordinary material rows and the negative-id grid envelope; `FILL_SHADER` (the
  full catalog) survives only as the unknown-fn fallback.
- `cart/editor/render3d/shaders/compose.ts` — per-set module composition
  (`req_3473`): splits the generated dispatch once, then builds
  `fillShaderFor(fns)` / ground / region modules carrying only the materials a
  surface actually renders.
- `cart/editor/shell/ShaderThumb.tsx` — value-stable memo boundary for live
  shader previews; real shader/data/size changes still invalidate captures.

Rebuild required for the two new host doors; everything else hot-reloads.
