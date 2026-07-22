import type { DocIndex } from '../types';

export const editor_painted_placements: DocIndex = {
  name: 'editor_painted_placements',
  file: 'editor_painted_placements.md',
  cart: 'cart/editor/world/livePush.ts',
  purpose: ['building', 'texture_bake', 'rendering', 'persistence', 'physics'],
  summary:
    'Which mesh, UV document, and collision shape a saved/placed authored model uses (req_2832/2833/2930/3133/3328/3329/3362): base.paint.json v4 cold-restores every exact face-corner UV; placement uses the full-res meshdoc with the painting\'s UVs rebound onto it except when painting a quality-DECIMATED display. Visible full-res saved Outliner ranges bake both bounded coarse boxes and exact immutable player-collision triangles; painted.json stamps which doc revision owns a decimated exported look.',
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
  ],
};
