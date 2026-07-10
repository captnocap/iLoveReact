# Editor face painting (Paint Faces)

Active surface: `cart/editor/` world document. Last verified: 2026-07-10.
USER ASK req_2879.

## In one sentence

Paint Faces is an armed world tool (Build menu, `N`): touching a placed build
piece's face binds the content browser's active material into THAT face's slot
(`piece.slots[role]`), so exteriors and interiors of the same wall paint
independently, and a drag sweeps the brush across faces.

## Why it exists

Before this, per-face materials had two flows: pre-defining slots before
placement, or right-clicking a placed piece and walking the quick menu (target
a face chip, then pick a skin — req_2733/req_2737). The user's ruling
(req_2879): pre-defining is unclear and post-build picking is slow and
tedious; painting should be "if I just happen to touch a face that has a
texture slot, whatever I have as the active paint/texture in the brush applies
to that face" — explicitly per-face, so the exterior and interior of one wall
never fight.

## Mechanism (host fn vs JS, file:line)

- `framework/game/build.zig raycastPieces` (host, `__game_build_raycast`)
  already returns the hit point + outward world-space face normal from the
  oriented-box slab test; `runtime/game/build.ts pickBuildPieceHostHit` now
  surfaces `point`/`normal` instead of discarding them.
- `cart/editor/world/pieceSlots.ts faceRoleForHit(pieceId, yawDegrees, normal)`
  rotates the world normal back into the host's piece-local frame and names the
  slot role: wall family front/back/sides, plate family top/bottom/edges,
  single-surface kinds their one role, sign `face`. The host local frame at odd
  quarter turns lands on the SAME slab `pieceShapes` tags via its
  frontSlot/backSlot swap — so the painted role is exactly the slot the skin
  renderer reads for the touched slab (`slotRefForBox`, now home in
  `pieceSlots.ts`, shared by skins + overlay colours). Proven by
  `cart/editor/world/pieceSlots.test.ts` (11 cases incl. the yaw-90 swap and
  the per-box governance suite).
- `cart/editor/world/worldTool.ts` maps command `paint-faces` → tool
  `paintFace`; `cart/editor/data/commands.ts` registers the Build command
  (icon Paintbrush, key `N`, not selection-gated — the touch provides the
  target); `cart/editor/data/keymap.ts` binds `n`.
- `cart/editor/world/WorldViewport.tsx pickFaceAt/paintFaceAt`: down paints the
  face under the cursor, a drag sweeps, and a per-stroke `Set` of
  `piece:role` keys makes each face take the brush once per gesture. A nearer
  authored (`model:`) hit or a slotless kind is an intentional no-op — only
  faces that HAVE a texture slot take paint. Shift-drag still pans.
- `cart/editor/shell/AppFrame.tsx`: `onPaintFace` routes into the existing
  one write path `assignPieceSlotAsset` (req_2737) with the browser's
  `activeAssetId` — every paint records a real world-undo entry and feeds the
  RECENT materials row, same as the quick menu and Inspector.
- `cart/editor/world/pieces.ts pieceInstanceRows` (req_2886): the live-overlay
  flat colour resolves PER DECOMPOSITION BOX through the same
  `pieceSlots.ts slotRefForBox` chain the skin renderer uses — a painted slot
  recolours only its own slab. (Before this fix every box took the PRIMARY
  slot's colour — `pieceBaseHex` — so painting one face looked like it consumed
  the whole piece even though `piece.slots` was written per-face correctly.)
  Door leaves and the glass pane keep their fixed look. Shader materials
  additionally get their real texture via `pieceSkins.ts` skin boxes;
  non-shader materials show as their per-face flat colour.

## Relationship to the other paint modes

Map Paint (ground channels), Paint Material (2D map objects), and the quick
menu's FacePainter picker all stand; Paint Faces is the viewport-speed path
over the same `piece.slots` data. One mode at a time: arming it exits Map
Paint through the shared `withMapPaintOff` door (req_2666), Esc returns to
Select.

## Known limits (this slice)

- Quarter-turn placements only in the u/v classification (the piece grammar's
  rotation step); a free-yaw piece would misread front/back vs sides.
- A sweep records one undo entry per painted face (cap 32), not one per
  stroke.
- Authored/exported (`model:`) pieces expose no catalog slots yet, so they
  don't take face paint — same gap the Inspector slot editor has.
