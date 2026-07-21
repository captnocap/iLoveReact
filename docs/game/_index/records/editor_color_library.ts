import type { DocIndex } from '../types';

export const editor_color_library: DocIndex = {
  name: 'editor_color_library',
  file: 'editor_color_library.md',
  cart: 'cart/editor/shell/PaintSidePanel.tsx',
  purpose: ['ui', 'persistence', 'host_bridge', 'color'],
  summary:
    'req_3097 + req_3332 + req_3333: the ink surface uses real mechanisms — SAVED + raw RECENT persistence, live-atlas SCENE colors, a host eyedropper, and a searchable 48-material shader browser whose standard previews batch through one canonical fill Effect before the full interactive grid caches into one StaticSurface.',
  interfaces: [
    {
      name: '__model_paint_sample',
      purpose: ['host_bridge', 'ui'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_core.zig',
      description:
        'Eyedropper door: pickBary raycast + atlas texel read (model_paint.sampleTexel), selection tint lifted; returns packed 0xRRGGBB or -1 on a miss. ModelView routes the eyedropper tool through it (click or live drag) and announces picks on the __modelColorSampled global into the spine color-select command.',
      consumers: ['cart/editor/stage/ModelView.tsx', 'cart/editor/shell/AppFrame.tsx'],
      status: 'live',
    },
    {
      name: '__model_atlas_palette',
      purpose: ['host_bridge', 'ui'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_core.zig',
      description:
        'SCENE door: model_paint.atlasPalette histograms island texels of the live paint atlas (4-bit/channel bins, strided past 1M texels, top-N bins averaged back to true colors) and returns JSON [[r,g,b],...]; "[]" when no paint target, which hides the SCENE section.',
      consumers: ['cart/editor/data/colorSpine.ts', 'cart/editor/stage/ColorLibraryPanel.tsx'],
      status: 'live',
    },
    {
      name: 'color library disk store',
      purpose: ['persistence'],
      kind: 'module',
      sourceFile: 'cart/editor/data/colorLibraryStore.ts',
      description:
        'Per-concern save (V20) at zig-out/game/editor/color-library.json holding SAVED + RECENT as OKLCH triples. Loaded once at boot (persistView.loadPersistedState), debounced micro-save from AppFrame on every palette/recents change. The SPINE_DEFAULT_PALETTE pretend seeds are deleted.',
      consumers: ['cart/editor/data/persistView.ts', 'cart/editor/shell/AppFrame.tsx'],
      status: 'live',
    },
    {
      name: 'RECENT use-history',
      purpose: ['ui', 'persistence'],
      kind: 'module',
      sourceFile: 'cart/editor/data/colorSpine.ts',
      description:
        'pushRecentColor records every committed color select (map commit, hex, tray, fits/ramp/sets, scene, eyedropper — all funnel through the Color Studio color-select command) newest-first, deduped by hex, cap 14. Rendered as the RECENT row above SAVED in ColorLibraryPanel.',
      consumers: ['cart/editor/shell/AppFrame.tsx', 'cart/editor/stage/ColorLibraryPanel.tsx'],
      status: 'live',
    },
    {
      name: 'shader browser search + batched cached grid + position memory',
      purpose: ['ui'],
      kind: 'component',
      sourceFile: 'cart/editor/shell/PaintSidePanel.tsx',
      description:
        'Substring search over label/group/id of the full spec catalog, a FIXED 8-wide x 6-row grid (48 visible materials, no per-group wrap restarts), groups-on-page caption line, and module-scope memos so tab/page/search survive panel close/reopen. req_3332 wraps the complete grid in one StaticSurface. req_3333 packs generated material rows into one grid-routed Effect using the canonical FILL_SHADER pipeline and slot-stable transparent Pressables; only different-WGSL recipes fall back per cell. Density, layout, hit testing, tooltips, clicks, and cache invalidation on real data changes remain intact.',
      consumers: ['cart/editor/shell/AppFrame.tsx'],
      status: 'live',
    },
    {
      name: 'canonical fill grid envelope',
      purpose: ['ui'],
      kind: 'module',
      sourceFile: 'cart/editor/render3d/shaders/index.ts',
      description:
        'FILL_SHADER accepts either the ordinary [material, variant, seed, quality, board, palette...] row or a negative-material-id grid envelope containing geometry, cell offsets, and variable-length rows. Both paths call the same generated fill_pick and quality pass, so the browser does not compile a second 409-material shader. ShaderGridBatch validates rows, inserts explicit zero palette counts, and memoizes packed data by value.',
      consumers: ['cart/editor/shell/ShaderGridBatch.tsx'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'announce-global routes viewer picks into the spine',
      purpose: ['ui', 'host_bridge'],
      description:
        'Both eyedroppers (model painter, facade painter) announce sampled hexes on the __modelColorSampled global installed by AppFrame — the pick funnels through the one color-select command, so RECENT records it and the spine→ink syncs deposit it, with zero prop drilling through the document surfaces.',
      examples: ['editor_color_library'],
      status: 'resolved',
    },
  ],
  hazards: [],
};
