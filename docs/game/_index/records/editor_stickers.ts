import type { DocIndex } from '../types';

export const editor_stickers: DocIndex = {
  name: 'editor_stickers',
  file: 'editor_stickers.md',
  cart: 'cart/editor/data/stickerStore.ts',
  purpose: ['ui', 'building', 'texture_bake', 'interaction'],
  summary:
    'Place Sticker (req_3018/3021/3025): an armed cart/editor world tool (K) — the click\'s face hit stamps the armed sticker (an imported texture + a real meter footprint, 4x6 thermal-label default) at the ray\'s exact hit point. Stamps are piece-local rows rendered as thin skin-box quads through the existing live-skin door, so a sticker keeps its own authored resolution regardless of the wall\'s paint density (RULED: label-scale art is never resampled into the surface).',
  interfaces: [
    {
      name: 'stickerStore (saveSticker/loadStickers/ensureStickerForTexture)',
      purpose: ['building', 'texture_bake'],
      kind: 'utility',
      sourceFile: 'cart/editor/data/stickerStore.ts',
      description:
        'The sticker asset: data/stickers/<slug>/manifest.json referencing an imported texture package by ShaderSpec id plus widthMeters/heightMeters. ensureStickerForTexture materializes a sticker on FIRST STAMP at the 4x6 label default — arming any imported texture IS creating its sticker (one-liner law, no separate ceremony). Art bytes live only in the texture package (the formal import flow, req_3025 ruling: no loose disk paths).',
      dependsOn: ['data/texturePackage.ts', 'textures/shaders.ts registerImportedSpecs'],
      consumers: ['cart/editor/world/pieceSkins.ts', 'cart/editor/shell/AppFrame.tsx'],
      status: 'live',
    },
    {
      name: 'StickerPlacement + stickerBoxFor/stickerLocalFrom',
      purpose: ['building', 'texture_bake'],
      kind: 'utility',
      sourceFile: 'cart/editor/world/pieceSkins.ts',
      description:
        'A stamp is a piece-LOCAL row (anchor + axis-snapped outward normal + scale + quarter-turn rot) on PlacedPiece.stickers[] — it rides move/rotate/delete/undo and persists with the map. stickerBoxFor emits a FLAT row (thickness exactly 0, floated 8mm off the face) through the EXISTING __compiled_world_set_live_skin_boxes door; a zero dimension makes the loader draw a 12-vert two-sided sticker plane instead of the 36-vert cube (req_3028 — 4 tris not 12; framework/world_loader/geometry.zig buildStickerQuad per thin axis). Rotation bakes into the packed pixel data (rotatePackedTexture) so every stamp stays on the one PIXEL_TEXTURE_SHADER contract. stickerLocalFrom is the proven exact inverse (stickers.test.ts, 9 cases).',
      dependsOn: ['pieceVisualShapes yaw frame (localOffset)', 'textures/pixelTexture.ts rotatePackedTexture'],
      consumers: ['cart/editor/world/livePush.ts pushLiveWorld'],
      status: 'live',
    },
    {
      name: 'place-sticker tool (WorldViewport stamp gesture + sticker rail)',
      purpose: ['ui', 'interaction'],
      kind: 'component',
      sourceFile: 'cart/editor/world/WorldViewport.tsx',
      description:
        'Build-menu command place-sticker (key K, icon Sticker, worldTool sticker, not selection-gated). A click stamps once — same host raycast as Paint Faces (point + normal), role via faceRoleForHit, up into AppFrame stampSticker (undoable recordWorldEdit). While armed the action bar shows the sticker rail (ToolOptions.tsx): imported-texture swatches as live Effect previews, quarter-turn rotate, x0.5/x1/x2/x4 scale presets riding state.stickerArm.',
      dependsOn: ['faceRoleForHit', 'pickBuildPieceHostHit point/normal', 'stickerLocalFrom'],
      consumers: ['cart/editor/shell/AppFrame.tsx'],
      status: 'live',
    },
    {
      name: 'multi-piece facade painter (Studio paint target)',
      purpose: ['ui', 'building', 'texture_bake', 'interaction'],
      kind: 'component',
      sourceFile: 'cart/editor/stage/FacadePainterSurface.tsx',
      description:
        'req_3062/3063: shift-click establishes an explicit set of coplanar wall-family pieces; facadeFromSelection unions exactly those faces into one meter-true mural canvas (single-piece context keeps gatherFacade as a convenience). The facade document consumes the same PaintToolbar shader/color catalog, brush recipes, dynamics, resolution control, and the same PaintLayersPanel as model painting, plus durable marquee/lasso masks. Strokes persist full ink + brush + tool + meter-path recipes per layer; PNG at 256 px/m is only the regenerable world cache. Facade shader ink is sampled from a rendered Studio shader surface and applied through the universal host-generated brush coverage because plain Paintables do not own the model destination-sampling pass.',
      dependsOn: ['runtime/paint stroke + stamp engine', 'runtime Paintable RGBA ops', 'world/facadeBake.ts'],
      consumers: ['cart/editor/shell/AppFrame.tsx', 'cart/editor/world/livePush.ts'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'stickers are never resampled into the surface',
      purpose: ['texture_bake', 'building'],
      description:
        'RULED (req_3021): label-scale art (10x15cm) baked into any sane ambient density is mush — a sticker renders as its own quad sampling its own authored-resolution texture, crisp at every placement scale. The planned far LoD (facade-canvas bake beyond ~20m at the RULED 256 px/m ambient density, req_3020) is the free fallback: at distance the facade texel IS the across-the-street look.',
      examples: ['editor_stickers'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'sticker paint-program follow-ups remain',
      purpose: ['ui', 'building'],
      description:
        'Per-stamp remove verbs remain missing (legacy facade stamps + quad stickers ride undo/Clear only). The facade painter is now the shared Studio painter over an explicit multi-piece selection (req_3062/3063), but stamp-as-paint on authored-mesh atlases, the isometric cylinder unwrap (req_3052/3054 direction), and far-LoD facade baking of quad stickers remain.',
      evidence: ['docs/game/editor_stickers.md "Not yet built (follow-ups)"'],
      severity: 'medium',
    },
  ],
};
