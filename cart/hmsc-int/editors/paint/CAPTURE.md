# editors/paint — EDITOR-CAPTURE note (editors wave 2026-06-04)

THE shared painter. The user's ruling: bring the cutout painter — "actually
good for painting" — into the one app so the better tool lives in the better
place, serving "something way better than the shit painter in the character
route". Source: `cart/cutout/` (~4,500 lines — BEHAVIOR REFERENCE: read,
never imported, never edited; **the user deletes it, not us**;
`docs/game/cutout.md` is its audit). COMPOSABILITY IS THE POINT: one painter
for every editor that paints — characters first, materials/textures later, no
per-route forks.

Shape: a HEADLESS CORE (`PAINT` — tuning tables P2, stroke math, dual-source
layer model, history, WGSL surface system, smart backends; pure, 29 P4 cases
in `paint.test.ts` on the editors suite root) behind ONE door (`index.ts`,
P3), plus the LIVE half (`usePaintEditor` + `PaintSurface` viewport +
`PaintToolRail`/`PaintLayerStrip`/`PaintLookPanel` chrome-kit controls +
`PaintEditor` one-liner).

## The deletion contract — inventory checklist

Every painting capability the cutout painter has, where it landed:

| # | Capability | New home | |
|---|---|---|---|
| 1 | Brush tool, dual-band override painting (erase→force-remove 1.0, restore→force-keep 0.5; brush never touches base) | `usePaintEditor` strokes + `tuning.bands` | DONE |
| 2 | Pressure→radius curve (base 0.35 + p·1.3, fallback 0.5, floor 1px) | `strokes.ts` `pressureRadius` | DONE |
| 3 | Dab interpolation (spacing r·0.32, position+pressure lerp — gap-free fast strokes) | `strokes.ts` `createStrokeEngine` | DONE |
| 4 | Sobel edge snapping for brush/refine (threshold 150, radius clamp 2..12) | `strokes.ts` `snapToStrongGradient` + engine `snap` | DONE |
| 5 | Refine brush (edge-aware paint; CPU `paintCircleEdgeAware` + snap path) | `strokes.ts` + refine tool | DONE |
| 6 | Brush sizes [2,8,32,128,512] + [/] step keys + size rail | `tuning.brushSizes`, `stepBrush`, `PaintToolRail` | DONE |
| 7 | Lasso (vertices, auto-close radius rule, 320ms/8px double-click close, Enter/Esc, scanline fill, path+vertex preview) | `strokes.ts` lasso fns + `usePaintEditor` + `PaintSurface` | DONE |
| 8 | Smart select (pluggable `SelectionBackend`, keep/reject click history, full-history re-refine rebuilds ONLY base, stale tokens, busy state, markers) | `backends/types.ts` + `usePaintEditor` | DONE |
| 9 | Flood backend (magenta sentinel, fuzz, reject disks, O(1) compose, PGM parse, per-keep cell sets) | `backends/flood.ts` | DONE |
| 10 | SAM backend (onnx gate, threshold + candidate, fused mask) | `backends/sam.ts` (+ `makeDefaultBackend`) | DONE |
| 11 | Backend tunables + 250ms debounced live re-refine | `tuning.backends` + retune effect + `PaintLookPanel` | DONE |
| 12 | Hand tool (Canvas pan/zoom; input overlay absent) | `PaintSurface` | DONE |
| 13 | Dual-source masks per layer (base 0/255 + brush 0/128/255; effective bands ≥192/≥64/≥128) | `layers.ts` `effectiveMask` (in-shader twin in `surfaces.ts`) | DONE |
| 14 | Stack ops: add/delete/duplicate(texture copy)/move/merge-down/mute/rename/group | `usePaintEditor` + pure math in `layers.ts` | DONE |
| 15 | Active-layer targeting (tools never disturb the stack) | `usePaintEditor` | DONE |
| 16 | Layer clipboard (copy/cut/paste with bytes+config+clicks) | `usePaintEditor` | DONE |
| 17 | Clear / invert (bake effective → inverted base, drop overrides+clicks) | `layers.ts` `invertIntoBase` + hook | DONE |
| 18 | Export compose (union of unmuted effectives) | `layers.ts` `unionMasks` + `composeExportMask` | DONE |
| 19 | Always-mounted paintables + pending-uploads queue + `scaleMask` sampler law | `PaintSurface` + `usePaintEditor` + `layers.ts` | DONE |
| 20 | 6 built-in animated WGSL surfaces, texture-mode AND cells-mode, shader caches | `surfaces.ts` | DONE |
| 21 | Edge detection + marching ants + per-surface pulse/alpha flags | `surfaces.ts` | DONE |
| 22 | Custom WGSL surfaces (mint/registry/per-layer assignment/adopt/inflate) | `surfaces.ts` + hook `addCustomSurface` | DONE |
| 23 | Per-layer look: surface/blend/hue(φ-stagger)/phase/dim/mute | `layers.ts` `defaultLayerConfig` + look setters | DONE |
| 24 | 2 color slots (interior/edge tints) + 10-swatch palette + global defaults (`i = -1` targeting) | `surfaces.ts` slots + `tuning.palette` + `PaintToolRail` | DONE |
| 25 | Undo/redo (50-deep, before-action, LAZY builders, 250ms coalesce, clear-on-new-target) | `history.ts` `createPaintHistory` (generic) | DONE |
| 26 | RLE snapshot model (binary base + value-grid brush via `@reactjit/workspace/rle`) | `layers.ts` `PaintDocument` build/parse/inflate | DONE |
| 27 | Coordinate discipline (SCREEN→WORLD `__canvas_screen_to_graph`→SOURCE, OOB rejected) | `PaintSurface` | DONE |
| 28 | Viewport: pan-zoom Canvas, native-res image, blank checkerboard, dims 16..4096 clamp | `PaintSurface` + `tuning.canvas` | DONE |
| 29 | Per-tool cursor (60ms throttle) + HUD strip + status + 60ms throttled maskVersion bump | `PaintSurface` + `usePaintEditor` | DONE |
| 30 | Keyboard map (ctrl+z/y/shift+z, ctrl+c/x/v, b/h/s/l/f, e/r, Enter/Esc, [/]) | `usePaintEditor` (gate with `hotkeys: false`) | DONE |
| 31 | **From paintKit:** mirror symmetry (axis dab, seam skip) | `createStrokeEngine` `mirrorAxisX` + rail chip | DONE |
| 32 | **From paintKit:** arbitrary-value painting (engine is value-agnostic; bands are one caller) | `strokes.ts` (host passes any value to `circle`) | DONE |
| 33 | **From paintKit:** 3×3 soften (dims-generic) + min-step vector capture | `soften3x3`, `createVectorStroke` | DONE |
| 34 | **NEW — not in cutout:** V20 session history: one labeled edit-commit per interaction | `PaintSession` prop — stroke/lasso/smart/layer-op labels via `session.note` | DONE |

## Deliberately NOT carried (cutout-app concerns, stay behind)

- **ImageMagick exports** (PNG cutout, pixel-icon JSON) and **`.sqi`**
  build/parse/import — cutout document formats. The painter exposes
  `composeExportMask()` + `buildDocument()`; what an editor EXPORTS is its
  own business. (`inflateSurface`/`adoptSurface` did come over — they're the
  generic self-contained-surface conversion, not `.sqi` itself.)
- **Zenity picker / file-drop ingest / ImageMagick `identify`+grayscale
  loading** — the host hands the painter `dims`, `srcPath`, and `gray` as
  DATA. How sources load is the hosting editor's concern.
- **Autosave file layout** (`sessions/_last.txt` pointer) — the painter bumps
  `documentVersion` and hands out lazy `buildDocument`; persistence belongs
  to the host (workspace files, V20 streams — the host's call).
- **Telemetry status bar / window controls / app shell** — the painter is a
  module, not an app.
- **Cells-mode per-keep smart layers as separate quads** (cutout's
  SAM-vs-flood rendering fork) — the painter renders each layer's fused base
  in texture mode; cells mode is kept in `surfaces.ts`/`PaintQuad` for
  doc-preview consumers. Flood still RETURNS per-keep cell sets (capability
  9) so nothing is lost if a consumer wants them.

## The session contract (V20)

`usePaintEditor({ session })` — every completed interaction calls
`session.note(label)` exactly once (`brush stroke · erase · 32px · Layer 1`,
`lasso · erase · 5 pts · Layer 2`, `smart keep · Layer 1`, `merge down · …`).
A `RouteSession` from `editors/sessions.ts` satisfies the type structurally
(note-grade markers). A route whose channel event-sources paint content
upgrades to commit-grade WITHOUT the painter knowing its event type:

```ts
const ses = editorSessions().open('/materials', channel);
usePaintEditor({ ..., session: { note: (label) => ses.commit(myEvent(), label) } });
```

## Adoption hand-off — the characters lane (OWNERSHIP FENCE: they swap, not us)

What `editors/characters/` replaces, precisely. paintKit.ts does NOT die
whole: its sculpt-domain pieces (resolutions, `sculptModeValue`,
`facePaintDepth`, byte↔grid conversion, `editorPartParams`, dyn/texture keys,
`DEPTH_OVERLAY_WGSL`) are figure semantics, not painting — they stay. The
PAINTING-INPUT plumbing is what the shared painter replaces:

1. **`dab()` + manual mirror (CharactersRoute.tsx ~246–257) → the stroke
   engine.** On `onPaintDown`:
   `engineRef.current = PAINT.createStrokeEngine({ brushPx: brush, mirrorAxisX: mirror ? PAINT_W / 2 : null }); engineRef.current.begin();`
   then in down+move: `for (const d of engine.move(tx, ty, e.pressure)) paints[selPart].paint.circle(d.x, d.y, d.radius, sculptModeValue(mode, strength));`
   Gains: gap-free fast strokes (the route's current per-event dab leaves
   gaps) + pressure response. **Fidelity note:** at the no-pressure fallback
   (0.5), the engine's radius = `brushPx · (0.35 + 0.5·1.3) = brushPx` — so
   passing the route's `brush` knob value preserves today's default dab size
   EXACTLY; a real stylus modulates 0.35×..1.65× around it.
2. **`appendFacePoint` min-step thinning (~259–269) → `PAINT.createVectorStroke(minStep)`**
   with `minStep = Math.max(TUNE.faceStrokeMinStep, brush / PAINT_W * 0.35)`;
   `add(p.cx, p.cy)` returns whether the point was kept. `commitFaceStroke`
   reads `.points()` and resets.
3. **`softenBytes(src)` (paintKit ~109–127) → `PAINT.soften3x3(src, PAINT_W, PAINT_H)`**
   — same 3×3 box blur, dims explicit. Delete `softenBytes` from paintKit.
4. **Stroke-end session labels** — the route already rides
   `editors/sessions.ts`; call `ses.note(\`sculpt stroke · ${mode} · ${brush}px · ${selPart}\`)`
   in `onPaintUp` (and for fill/soften/clear) for per-interaction commits.
5. **Optional upgrade (their call):** host the full `PaintEditor` (or
   `usePaintEditor` + `PaintSurface`) for the unwrap canvas to gain layers,
   lasso, undo/redo, and surface overlays on face paint. Use
   `idPrefix: 'chr-unwrap'`, `dims: TUNE.editor`, `hotkeys: false` (the route
   owns its keys), and the route's `RouteSession` as `session`. The painter's
   per-layer textures would then carry face-paint layers GPU-side instead of
   `.hed` layer accumulation — a model change; the seam exists, no pressure.

Imports: `import { PAINT } from '../paint'` (the door; engine + soften +
vector capture are all on it).

## Ambiguities (surfaced, not guessed)

1. **Refine writes through the snap path, not `circleEdgeAware`.** Faithful
   to the active cutout path (state.ts snaps dab CENTERS; the CPU
   edge-aware fill + `__paintable_circle_edge` host fn exist but the active
   brush path doesn't call them). The painter captures both: engine `snap`
   is live; `paintCircleEdgeAware` is on the door for consumers that want
   per-pixel edge-aware fills.
2. **Hotkeys default ON** (cutout parity). useIFTTT key triggers are global —
   an embedding route with TextInputs should pass `hotkeys: false` and own
   its keys (the characters route case).
3. **`PaintDocument` is painter-versioned (`paint-doc` v1)**, deliberately
   NOT cutout's `cutout-session` v2 — no migration path, the painter is new.
   Cutout sessions stay readable only by cutout (which the user deletes).
4. **Smart tool surfaces only with `backend` + `srcPath`.** A blank-canvas
   embed never sees it — matches cutout's `isBlank` guard. `makeDefaultBackend()`
   picks SAM when the onnx binding exists, else flood (cutout's auto rule).
5. **Where painter documents persist is the HOST's call** — workspace files
   (the cutout autosave pattern) or a V20 stream event carrying the document
   (the roster idiom). The painter deliberately ships no `fs` writes.

## Tests (P4, `rjit game verify` — `editors/` suite root)

`paint.test.ts`, 29 cases: stroke interpolation overlap law, pressure curve
+ lerp, mirror + seam skip, edge snap + edge-aware no-punch-through, circle
bounds, lasso fill/auto-close/double-click, vector thinning, soften, cell
sampling/runs, the dual-source band rule, band byte cuts, scaleMask, merge/
invert/union, φ hue stagger, stack move/delete laws, id minting/namespacing,
document RLE round-trip + brush-skip + version gate, history before-action /
coalesce / cap / redo-clear / lazy-builder laws, texture+cells packing
layouts, defensive hex, custom surface registry + adopt round-trip, WGSL
shape checks (fs_main, no backticks, no unary plus, in-shader band parity).
JSX surfaces bundle-verified through the real cart pipeline aliases.
