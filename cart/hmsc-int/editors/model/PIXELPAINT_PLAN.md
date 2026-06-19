# Pixel-paint rebuild (req_1371/req_1372)

Replace the box-atlas paint RENDERER (boxes → StaticSurface → texture) with
**direct RGBA pixel painting** into a GPU paintable the mesh samples. Keeps the
mesh's per-face UVs and the proven raycast; deletes the cell-grid/bleed machine.

## Why this kills the whole bug class
- No boxes → no AA seams between adjacent run-merged boxes (the cube two-tone seam).
- No packed cell-grid slots → no 1px gutters/pinstripes.
- No StaticSurface capture → no stale/partial bake.
- Nearest sampling (already shipped, req_1321) → crisp colour boundaries, no blend.
- Per-face SCISSOR clamp on each dab → a stroke can't bleed into a neighbour island.

## Phase A — framework (needs `tools/rjit ship hmsc-int`)
`framework/gpu/paintable.zig`:
- per-paintable `rgba: bool` (format r8_unorm | rgba8_unorm); `bpp()` 1|4.
- brush op carries rgb (`value`,`value_g`,`value_b`) + a clip/scissor rect.
- two brush pipelines (r8 / rgba target); fs outputs vec4(rgb*cov, cov) premult.
- `ensure(key,w,h,rgba)`; upload/readback use bpp; clear takes rgba.
- lazy-register a resolver with gpu.zig so a mesh `textureKey` resolves to the
  paintable's view; paintable owns+caches its own 3D bind group (nearest sampler).
`framework/gpu/gpu.zig`: `setPaintableResolver` fn-ptr; `staticSurfaceBindGroup3D`
falls through to it on miss; `scene3dTexLayout()`/`scene3dDiffuseSampler()` accessors.
`framework/v8_bindings_paintable.zig`: `__paintable_brush_rgba`, `__paintable_clear_rgba`.
`v8_app.zig`: `paintableRGBA` prop → `paintable.ensure(...,rgba)`.
`runtime/`: `<Paintable rgba>`, `usePaintable({rgba})` ops `brushColor`/`clearColor`, .d.ts.

## Phase B — cart (hot-reloads)
- `meshPaintTexture.ts`: `STUDIO_PAINT_KEY`, fixed res, ensure + `paintUV(u,v,rgba,rPx,clip)` + `baseCoat`.
- `meshPaint.tsx`: `pickFaceUV` → {partIndex, faceIndex, u, v, islandRectPx}; keep screenRay/rayTri.
- `Studio.tsx`: paint handlers stamp UV dabs into the paintable; mesh samples
  `STUDIO_PAINT_KEY` in paint mode; fill-all = clear(color); detail = brush radius.
- Prove cube + AK: two adjacent colours, no seam/leak/vanish, brush hits what's clicked.

## Phase C
- persist: readback RGBA → PNG (image codec) → V20 branch (`modelStream.partPaintUpdated`); reload.
- DELETE dead box-atlas: faceCellGrid/cellRects/rectAtlasRect/resamplePaint/dabRadiusCells,
  the paint half of TextureAtlas.tsx, BLEED. (`/break-shit-quick`.)
- later: compiled-game bake of painted models (bake-geometry-auto.ts).

## Verify
`tools/rjit shot hmsc-int` + actual pixel inspection — never eyeball, never desktop capture.
Done = user paints a two-tone gun without it degrading. Not from a clean compile.
