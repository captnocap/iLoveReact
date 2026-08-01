import type { DocIndex } from '../types';

export const editor_face_paint: DocIndex = {
  name: 'editor_face_paint',
  file: 'editor_face_paint.md',
  cart: 'cart/editor/world/pieceSlots.ts',
  purpose: ['ui', 'building', 'texture_bake', 'interaction'],
  summary:
    'Paint Faces (req_2879): an armed cart/editor world tool — touch a placed build piece\'s face and the browser\'s active material binds into THAT face\'s slot (piece.slots[role]); a drag sweeps, each face paints once per stroke. Rides the host raycast\'s hit normal, so the painted role is exactly the slab the skin renderer draws (front vs back stay independent — exterior/interior of one wall never fight).',
  interfaces: [
    {
      name: 'faceRoleForHit',
      purpose: ['building', 'interaction'],
      kind: 'utility',
      sourceFile: 'cart/editor/world/pieceSlots.ts',
      description:
        'World hit normal + piece yaw → the slot role the touched face wears: wall family front/back/sides, plate family top/bottom/edges, single-surface kinds their one role. Un-rotates by the exact transpose of pieceShapes localOffset (req_3567) — front/back are piece-fixed at every yaw, free angles included; the old wrong-sign recovery plus pieceShapes\' compensating odd-quarter tag swap (which flipped menu-assigned front/back at yaw 90/270) are both gone. Null for multi-role authored ids — their raycast is bounds-only. Proven by pieceSlots.test.ts incl. piece-fixed yaw 90/270 + free-yaw 45°.',
      dependsOn: ['pieceSlotRoles', '__game_build_raycast hit normal'],
      consumers: ['cart/editor/world/WorldViewport.tsx'],
      status: 'live',
    },
    {
      name: 'pickBuildPieceHostHit point/normal',
      purpose: ['building', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'runtime/game/build.ts',
      description:
        'The host build raycast door now surfaces the hit point + outward world-space face normal framework/game/build.zig raycastPieces always computed (previously discarded at the wrapper). Additive — piece-only callers (pickBuildPieceHost, hmsc-int LoaderIsoView) are unchanged.',
      consumers: ['cart/editor/world/WorldViewport.tsx'],
      status: 'live',
    },
    {
      name: 'slotRefForBox per-box overlay colours',
      purpose: ['building', 'texture_bake'],
      kind: 'utility',
      sourceFile: 'cart/editor/world/pieceSlots.ts',
      description:
        'The role-explicit slot chain governing ONE decomposition box (back←bottom, sides←edges, front default, surface/face covers all) — moved from pieceSkins into pieceSlots and now ALSO drives pieces.ts pieceInstanceRows: each live-overlay box takes its OWN slot\'s material colour, unpainted boxes keep the catalog look. Fixes req_2886 — the old piece-wide pieceBaseHex (primary slot tints everything) made one painted face recolour the whole piece; primarySlotRole is deleted with it. Doors/glass keep their fixed look; shader slots additionally get real textures via pieceSkins skin boxes — and their flat row is pushed COLLIDE-ONLY (r = -1, req_3569: applyPendingLive drops it from the render buffer, applyLiveColliders still reads it) because drawing the flat box under the outset skin box z-fought into tearing past ~45m. The glass pane never takes a skin box (an opaque cube would plate the window hole).',
      dependsOn: ['pieceSlotRoles'],
      consumers: ['cart/editor/world/pieces.ts', 'cart/editor/world/pieceSkins.ts'],
      status: 'live',
    },
    {
      name: 'paint-faces tool (WorldViewport paint gesture)',
      purpose: ['ui', 'interaction', 'building'],
      kind: 'component',
      sourceFile: 'cart/editor/world/WorldViewport.tsx',
      description:
        'Build-menu command paint-faces (key N, icon Paintbrush, worldTool paintFace, not selection-gated). Down paints the face under the cursor, drag sweeps; a per-stroke Set of piece:role keys means one write per face per gesture. Occluding authored meshes and slotless kinds are intentional no-ops; shift-drag keeps panning. onPaintFace routes into AppFrame assignPieceSlotAsset (the req_2737 one write path) with activeAssetId — real world-undo entries + the RECENT materials row for free.',
      dependsOn: ['faceRoleForHit', 'pickBuildPieceHostHit point/normal'],
      consumers: ['cart/editor/shell/AppFrame.tsx'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'touch-to-paint over the quick-menu picker',
      purpose: ['ui', 'interaction'],
      description:
        'Per-face material assignment has three coexisting paths over ONE data shape (piece.slots): the Inspector slot rows, the right-click FacePainter quick menu (req_2733/req_2737), and Paint Faces for viewport-speed sweeps. All route through assignPieceSlotAsset; never grow a second write path.',
      examples: ['editor_face_paint'],
      status: 'resolved',
    },
  ],
  hazards: [
    {
      name: 'compensating errors around the raycast frame (RESOLVED req_3567)',
      purpose: ['building', 'interaction'],
      description:
        'History lesson: faceRoleForHit un-rotated the hit normal with the wrong sign, and pieceShapes carried an odd-quarter frontSlot/backSlot tag swap that made touch-paint agree with it — leaving the right-click menu\'s front/back landing on the physically opposite slab at yaw 90/270 (and paint jumping sides on rotation). stickerLocalFrom was the proof of the correct inverse all along. If front/back ever misbehave again, suspect a NEW compensation before re-adding a swap.',
      evidence: ['cart/editor/world/pieceSlots.ts', 'cart/editor/world/pieceShapes.ts', 'cart/editor/world/pieceSkins.ts stickerLocalFrom'],
      severity: 'low',
    },
  ],
};
