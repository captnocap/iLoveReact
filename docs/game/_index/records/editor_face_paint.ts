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
        'World hit normal + piece yaw → the slot role the touched face wears: wall family front/back/sides, plate family top/bottom/edges, single-surface kinds their one role. The host piece-local frame at odd quarter turns lands on the same slab pieceShapes tags via its frontSlot/backSlot swap, so no extra swap here. Quarter-turn placements only; null for non-catalog (authored/prop) ids — nothing to paint. Proven by pieceSlots.test.ts incl. the yaw-90 swap case.',
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
        'The role-explicit slot chain governing ONE decomposition box (back←bottom, sides←edges, front default, surface/face covers all) — moved from pieceSkins into pieceSlots and now ALSO drives pieces.ts pieceInstanceRows: each live-overlay box takes its OWN slot\'s material colour, unpainted boxes keep the catalog look. Fixes req_2886 — the old piece-wide pieceBaseHex (primary slot tints everything) made one painted face recolour the whole piece; primarySlotRole is deleted with it. Doors/glass keep their fixed look; shader slots additionally get real textures via pieceSkins skin boxes.',
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
      name: 'front/back classification assumes quarter-turn yaw',
      purpose: ['building', 'interaction'],
      description:
        'faceRoleForHit\'s u/v split (and pieceShapes\' odd-quarter frontSlot swap it mirrors) only agree at 90° steps — the piece grammar\'s rotation step. If free-yaw placement ever lands, a 45° wall would misread front/back as sides; revisit both together.',
      evidence: ['cart/editor/world/pieceSlots.ts', 'cart/editor/world/pieceShapes.ts'],
      severity: 'low',
    },
  ],
};
