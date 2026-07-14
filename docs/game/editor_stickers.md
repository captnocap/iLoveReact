# Editor stickers (Place Sticker)

Active surface: `cart/editor/` world document. Last verified: 2026-07-13.
USER ASK req_3018 / req_3021 / req_3025 / req_3028.

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

## Not yet built (the next arc)

The multi-piece facade painter (req_3018's graffiti half): select multiple
pieces → merge coplanar faces into one meter-true canvas at 256 px/m → spray
(strokes, stored as the paint program per the paint ruling) + stamp tools →
bake back per face. Sticker deletion currently rides piece undo only — no
per-stamp remove verb yet.
