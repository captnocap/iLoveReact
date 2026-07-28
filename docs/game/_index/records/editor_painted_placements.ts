import type { DocIndex } from '../types';

export const editor_painted_placements: DocIndex = {
  name: 'editor_painted_placements',
  file: 'editor_painted_placements.md',
  cart: 'cart/editor/world/livePush.ts',
  purpose: ['building', 'texture_bake', 'rendering', 'persistence', 'physics'],
  summary:
    'Which mesh, UV document, and collision shape a saved/placed authored model uses (req_2832/2833/2930/3133/3328/3329/3362/3431): base.paint.json v4 cold-restores every exact face-corner UV; placement uses the full-res meshdoc with the painting\'s UVs rebound onto it except when painting a quality-DECIMATED display. Visible full-res saved Outliner ranges bake both bounded coarse boxes and exact immutable player-collision triangles; painted.json stamps which doc revision owns a decimated exported look; every save also persists the placeable-frame collision bake into the package as mesh/collision.blob (RJCB v1).',
  interfaces: [
    {
      name: 'base.paint.json v4 exact UV restart record',
      purpose: ['persistence', 'texture_bake'],
      kind: 'utility',
      sourceFile: 'cart/editor/data/modelPackageStore.ts',
      description:
        'Save strips __model_atlas_read triangle rows to one six-float absolute-atlas coordinate row per render face and writes them as cornerUv beside the raster baseline. Cold ModelView hydration imports that fixed raster, applies the complete corner table through the unjournaled __model_uv_geometry_apply boundary, then replays paint. v1-v3 records remain readable through their historical program/island-rectangle paths. Rectangles alone cannot reproduce rotations, detached wedges, or moved UV vertices and are never the authored geometry for a new save.',
      dependsOn: ['framework/v8_bindings_core.zig __model_atlas_read / __model_uv_geometry_apply', 'cart/editor/model/paintHydration.ts'],
      consumers: ['cart/editor/stage/ModelView.tsx hydratePersistedAtlas'],
      status: 'live',
    },
    {
      name: 'paint variants as full LOOKS (paints/paint_N.json cornerUv + raster base)',
      purpose: ['persistence', 'texture_bake'],
      kind: 'utility',
      sourceFile: 'cart/editor/data/paintVariants.ts',
      description:
        'req_3439: a variant stores the same v4 triple as base.paint.json — cornerUv + rasterBase + stroke program (may be EMPTY: an imported texture atlas mapped over the mesh saves as a look with zero strokes, which the panel previously refused). With strokes the baseline persists as paint_N.base.png; without, the composite paint_N.png doubles as the raster base. Load goes through ModelFocusBridge.loadPaintVariant into the same paintHydration engine as cold load (detail → import raster base → cornerUv → strokes over base), so importing a new atlas or remapping UVs only changes the LIVE look — saved variants reload their own texture + UV layout. listPaintVariants strips look claims whose raster is gone; hydration fails loudly over half-restoring. Atlas-only looks emit png + blob, so they are placeable skins too. Variants rename in place (req_3448, renamePaintVariant + the panel pencil verb): label-only, ids/files/placed #p references untouched, quick-menu chips pick up the new name.',
      dependsOn: ['cart/editor/model/paintHydration.ts hydratePersistedModelPaint', 'framework/v8_bindings_core.zig __model_paint_baseline_read / __model_atlas_import / __model_uv_geometry_apply / __model_paint_program_apply_over_base', 'cart/editor/data/modelPackageStore.ts exactUvCornersFromAtlasTriangles/parsedUvCornerGeometry'],
      consumers: ['cart/editor/library/ModelPaintVariants.tsx', 'cart/editor/stage/ModelView.tsx loadPaintVariant'],
      status: 'live',
    },
    {
      name: 'world.piece.skin — paint skins are instance wardrobe, never palette rows',
      purpose: ['building', 'texture_bake'],
      kind: 'utility',
      sourceFile: 'cart/editor/world/pieceEditCommand.ts',
      description:
        'req_3443 (USER RULING: skins must not multiply build-menu entries — "the build menu will explode"): an exported model is exactly ONE palette tile (authoredRegistry authoredPaletteEntries); stored paintings dress the PLACED INSTANCE via the world quick menu\'s PAINTINGS section (Current + each placeable skin). planPieceSkin is a real undoable piece-edit transaction swapping the instance\'s placeable id between prop:X and prop:X#p<skin> in place — transform/slots/overrides/stickers/order stay; EditorPieceEditAdapter.skinPolicy (AppFrame: authoredPieceFor + listPaintSkins) rejects unknown paintings and catalog pieces before commit. Rendering rides the existing per-skin resident meshes livePush registers under <placeableId>#p<skinId>.',
      dependsOn: ['cart/editor/world/authoredRegistry.ts skinnedPieceId/paintSkinIdOf', 'cart/editor/data/paintVariants.ts listPaintSkins', 'cart/editor/data/applicationCommands.ts WORLD_PIECE_SKIN_COMMAND_ID'],
      consumers: ['cart/editor/stage/WorldContextMenu.tsx PAINTINGS section', 'cart/editor/shell/AppFrame.tsx pieceEdit adapter'],
      status: 'live',
    },
    {
      name: 'painted.json doc-stamp (writeModelArtifacts ↔ paintedFormIsCurrent)',
      purpose: ['persistence', 'texture_bake'],
      kind: 'utility',
      sourceFile: 'cart/editor/data/modelPackageStore.ts',
      description:
        'Save writes mesh/doc.blob (full-res source), mesh/painted.blob (DISPLAYED mesh with island UVs), and mesh/painted.json = {docStamp: "<size>:<mtimeMs>" of doc.blob} in one call. Placement (livePush.ts) resolves a count-mismatched painted form by the stamp: current → the painted decimated mesh is the render geometry (residentMeshFor takes separate collisionVertices so the full-res doc keeps Outliner bands); absent/stale → req_2832 rule, painting drops. A failed painted write removes the stamp so it never endorses an old blob.',
      dependsOn: ['framework/v8_bindings_core.zig __model_painted_mesh_write (DISPLAYED verts)', 'framework/gpu/model_source.zig (decimation = displayed projection, source retained)'],
      consumers: ['cart/editor/world/livePush.ts pushResidentMeshes'],
      status: 'live',
    },
    {
      name: 'compileOutlinerCollision (saved Outliner → coarse boxes + exact MESH_PROPS v10 triangles)',
      purpose: ['building', 'physics', 'geometry'],
      kind: 'utility',
      sourceFile: 'cart/editor/model/meshCollision.ts',
      description:
        'Bakes at most 24 local-frame broadphase/camera boxes plus every finite triangle owned by visible full-resolution RJMD Outliner ranges. Saved ranges remain hard box roots; one-row models refine too, over-budget multi-row models merge nearby same-family roots locally, and hidden rows emit nothing. livePush writes both views into MESH_PROPS v10. world_loader retains those coarse rows for the spring-arm camera, dynamic bodies, and whole-prop broadphase while player contact clips the immutable local triangles to the body band for exact side/top/ceiling response. This removes req_3329\'s sloped-face empty-corner wall without generating geometry per frame; older wire versions and semantic doors retain box collision.',
      dependsOn: ['cart/editor/data/meshDoc.ts PackageMeshDoc ranges', 'framework/world/constructor.zig MeshPropMesh.collision_boxes/collision_triangles', 'framework/game/mesh_collision.zig'],
      consumers: ['cart/editor/world/livePush.ts residentMeshFor', 'framework/world_loader/physics.zig meshPropIslands/resolveMeshPropPlayer'],
      status: 'live',
    },
    {
      name: 'writePackageCollision (mesh/collision.blob — the package carries its own bake, RJCB v1)',
      purpose: ['building', 'physics', 'persistence'],
      kind: 'utility',
      sourceFile: 'cart/editor/data/modelPackageStore.ts',
      description:
        'FLOCKBOOK §10 quick win (req_3431): every save/export persists compileOutlinerCollision over the ground-rebased doc vertices into mesh/collision.blob — placeable-frame box tree + exact player triangles, header-stamped with the doc revision (legacy: prefix off base.blob for pre-meshdoc packages). Stamp-gated idempotent; writeModelArtifacts lands it on every branch (paint-only saves self-heal), materializePackageArtifacts bakes GLB/OBJ imports at arrival, and file-backed viewerPath packages shed any stale blob instead. Codec (encodeCollisionBake/decodeCollisionBake, strict null-on-damage decode) lives in model/meshCollision.ts. residentMeshFor deliberately keeps baking live from rendered verts — the persisted record is the package\'s declaration for consumers reading the folder without the editor; when disk is current the two are bit-identical by construction.',
      dependsOn: ['cart/editor/model/meshCollision.ts encodeCollisionBake/decodeCollisionBake', 'cart/editor/model/groundRebase.ts', 'cart/editor/data/meshDoc.ts readMeshDoc/readMeshDocParts'],
      consumers: ['future package consumers (asset cook, direct host loads) — nothing reads it in the /play hot path by design'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'the quality slider is a display projection, never a document edit',
      purpose: ['geometry', 'rendering'],
      description:
        'model_source.zig retains the full-res source; __model_set_quality re-meshes a displayed projection (paint and edits write back through displayed→source maps). Saving keeps the doc full-res so quality scrubbing is reversible — which is exactly why the placeable look needs the painted.json stamp to carry a decimated export.',
      examples: ['editor_painted_placements'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'paint skins and doors do not take the decimated path',
      purpose: ['texture_bake', 'building'],
      description:
        'paints/paint_N.blob skins painted at decimated quality still cardinality-gate against the doc and leave the palette / skip placement (loud warn) — they would need per-skin stamps. Door exports need doc topology (compileDoorMesh), so doors must be saved at full quality. Packages saved before the stamp existed render the old way until their next save.',
      evidence: ['docs/game/editor_painted_placements.md "Not yet covered"'],
      severity: 'medium',
    },
    {
      name: 'atlas alpha is glass in the world; the editor preview hides it (closed at import, req_3450)',
      purpose: ['texture_bake', 'rendering'],
      description:
        'The world textured resident route renders ATLAS ALPHA through the transparent pass (LIVE_TEXTURED_ALPHA_ROUTE_ALPHA); the editor opaque preview ignores it. An imported PNG with transparent padding (38% of bookshelf_001\'s texture) turns any UV drift into invisible placed faces that look fine in the editor. CLOSED: scene3d.replacePaintAtlas/importPaintAtlas force alpha 255 on arrival (opaqueImportCopy) — glass is authored (req_2928) and re-applies from the doc trailing run (req_3402); legacy packages heal on open+save. Sibling repair: all four mesh import doors run scene3d.normalizeSoupWinding (mesh_edit.inconsistentWindingMask — 2-incidence orientation propagation + centroid-centered volume for boundary-free components), so mixed-winding GLB/OBJ sources can no longer enter with faces back-face culling eats. Residual (documented, open): a placed instance renders the SESSION export-time cached geometry bound to the painted form of the moment — topology edits/UV remaps after export mis-pair until the next export/save refreshes the push.',
      evidence: ['docs/game/editor_painted_placements.md "Import boundary invariants"'],
      severity: 'medium',
    },
  ],
};
