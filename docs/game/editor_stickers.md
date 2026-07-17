# Editor stickers (Place Sticker)

Active surface: `cart/editor/` world document. Last verified: 2026-07-14.
USER ASK req_3018 / req_3021 / req_3025 / req_3028 / req_3062 / req_3063.

## In one sentence

Place Sticker is an armed world tool (Build menu, `K`): the click's face hit
stamps the armed sticker — an imported texture with a real meter footprint —
at the ray's exact hit point, rendered as a thin skin-box quad that keeps the
sticker's own resolution regardless of the wall's paint density.

## Why it exists

The user's ask (req_3018): "draw up a logo in here, and then reuse that logo
across many assets ontop of whatever that asset may have on it, you know so
like basically a sticker." Two rulings shape the design:

- **A sticker is label-scale art** (req_3021, "a 4x6 thermal label size"): at
  any ambient surface density a 10×15cm sticker baked into a wall texture is
  mush (26×39 texels at 256 px/m), so stickers are NEVER resampled into the
  surface — each stamp renders as its own quad sampling the sticker's
  authored-resolution texture, crisp at any placement scale.
- **The formal import flow is the only art source** (req_3025, "those imports
  become a duplication of the original, and then is stored with the rest of
  the assets appropriately"): sticker art is an imported texture package
  (`data/texturePackage.ts` — bytes copied into the project at import, the
  original path never referenced again). A sticker adds only the meter
  footprint.

## Mechanism (host fn vs JS, file:line)

- `cart/editor/data/stickerStore.ts` — the sticker asset:
  `cart/editor/data/stickers/<slug>/manifest.json` = {id `stk-<slug>`, name,
  textureId (`img-<slug>` ShaderSpec id), widthMeters, heightMeters}.
  `ensureStickerForTexture` materializes a sticker on FIRST STAMP of a texture
  (4×6 label default `DEFAULT_STICKER_METERS`) — arming any imported texture
  IS creating its sticker; no separate ceremony (one-liner law).
- `cart/editor/world/pieces.ts StickerPlacement` — a stamp is a piece-LOCAL
  row on its `PlacedPiece.stickers[]`: {stickerId, role, lx/ly/lz anchor,
  nx/ny/nz outward face normal (axis-snapped), scale, rot 0-3 quarter turns}.
  Piece-local means stamps ride move/rotate/delete/undo and persist with the
  map's pieces (worldStore validates the rows).
- `cart/editor/world/pieceSkins.ts` — rendering: `stickerBoxFor` emits a FLAT
  quad row (thickness exactly 0, floated 8mm off the face) sized to the
  sticker's meters × scale through the EXISTING
  `__compiled_world_set_live_skin_boxes` door. A zero dimension makes the
  loader draw a 12-vert two-sided sticker plane instead of the 36-vert cube
  (req_3028, "stickers are flat and dont have sides" — 4 tris, not 12;
  `framework/world_loader/geometry.zig buildStickerQuad`, one quad per thin
  axis, cube winding/UV convention). The material is the texture's
  own `PIXEL_TEXTURE_SHADER` spec with rotation baked into the packed data by
  `rotatePackedTexture` (`textures/pixelTexture.ts`) — no rotation uniform, one
  shader contract. `stickerLocalFrom` is the exact inverse (world hit →
  placement row); both proven by `world/stickers.test.ts` (9 cases: rotation
  re-lay, yaw-0/90 round-trips, quarter-turn footprint swap, floor stamps,
  missing-sticker no-op).
- `cart/editor/world/WorldViewport.tsx stampStickerAt` — the same host raycast
  as Paint Faces (`__game_build_raycast` point + normal via
  `pickBuildPieceHostHit`), role from `faceRoleForHit`, then
  `onStampSticker(pieceId, role, local)` up into AppFrame's `stampSticker`
  (undoable via `recordWorldEdit`).
- `cart/editor/stage/ToolOptions.tsx` — while armed, the action bar shows the
  sticker rail: imported-texture swatches (live `Effect` previews), quarter-
  turn rotate, and ×0.5/×1/×2/×4 scale presets (`state.stickerArm`).

## Scale contract (req_3020, the density decisions)

1 tile = 1m (R4). Ambient facade paint density is RULED 256 px/m (user picked
from the rendered density-comparison artifact). Stickers side-step that
density entirely by carrying their own texture — the far-LoD plan (bake
stamps into the facade canvas beyond ~20m, where 256 px/m is exactly the
across-the-street look) lands with the facade painter arc.

## The facade painter (req_3057 / req_3062 / req_3063 — SHIPPED)

With the Select tool, click a wall piece and **shift-click** every additional
piece that belongs in the mural. Right-click any selected piece → **Paint
Facade** (`WorldContextMenu`, command `paint-facade`). The selected pieces are
the authority: `world/facades.ts facadeFromSelection` requires wall-family
faces on one plane (facing may differ by 180°), then unions exactly those face
rects into one flat, meter-true canvas. Gaps are legal because scope is an
authorial choice. The one-piece context action keeps `gatherFacade`'s
contiguous coplanar-run gather as a convenience.

The facade document (`stage/FacadePainterSurface.tsx`) consumes the SAME
Studio paint action bar as model painting (`shell/PaintToolbar.tsx`): color or
live shader ink from the material catalog, the canonical brush presets and
dynamics, brush/eraser/line/rect/ellipse, eyedropper, marquee, lasso, and
128/256/512 px/m preview resolution. Its layer panel is the SAME
`PaintLayersPanel` used by the model painter: add, select, hide, rename,
reorder, merge, and delete. Every layer is a separate RGBA `Paintable`; visible
layers composite bottom-to-top. Marquee is a host clip rectangle; lasso is an
exact polygon clip carried by each affected stroke.

The durable form is the paint program in world.json, never pixels. Every
stroke records its full ink recipe (color or shader spec + tuned data), brush
recipe (stamp, meter size, hardness, flow, scatter, angle, aspect, spacing,
blend), tool, meter-space path, and optional selection mask. Replay sends that
recipe back through the universal host brush-footprint engine. Plain
Paintables do not yet run the model painter's host shader-destination pass, so
the facade surface captures the selected Studio shader into pixels and applies
it through the host-generated coverage mask; the durable row still retains
the shader recipe, not the capture.

SAVE composites the visible layers, normalizes the result to the RULED 256
px/m, then CPU-composites any legacy facade stamp rows
(`world/facadeBake.ts`, die-cut transparency) → PNG cached at
`maps/<stem>/facades/<id>.png` (regenerable) → a two-sided quad floated 12mm
off the wall through the existing resident-mesh doors (`livePush`). Unpainted
texels keep alpha 0, so the quad shows exactly the mural. Proven by
`world/facades.test.ts` (10 cases, including exact selection scope, shader
masking, lasso clipping, stroke migration, and resolution normalization) plus
the universal paint replay tests.

## Not yet built (follow-ups)

Per-stamp remove verbs (legacy facade stamps and quad stickers both ride
undo/Clear only); stamp-as-paint on AUTHORED-mesh atlases + the isometric
cylinder unwrap for pole wraps (req_3052/req_3054 design, greenlit direction);
facade far-LoD baking of quad stickers.
