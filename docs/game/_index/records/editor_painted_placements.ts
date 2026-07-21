import type { DocIndex } from '../types';

export const editor_painted_placements: DocIndex = {
  name: 'editor_painted_placements',
  file: 'editor_painted_placements.md',
  cart: 'cart/editor/world/livePush.ts',
  purpose: ['building', 'texture_bake', 'rendering', 'persistence'],
  summary:
    'Which mesh and collision shape a placed authored model uses (req_2832/2833/2930/3133/3328): the full-res meshdoc with the painting\'s UVs rebound onto it — except when the painting was made on a quality-DECIMATED display. The full-res saved Outliner ranges always own a bounded, geometry-refined collision-box bake, including one-row models; painted.json stamps which doc revision owns a decimated exported look.',
  interfaces: [
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
      name: 'compileOutlinerCollisionBoxes (saved Outliner → resident MESH_PROPS colliders)',
      purpose: ['building', 'physics', 'geometry'],
      kind: 'utility',
      sourceFile: 'cart/editor/model/meshCollision.ts',
      description:
        'Bakes at most 24 local-frame boxes from the full-resolution RJMD triangles. Saved visible Outliner ranges are hard roots; spare rows recursively split a root only when child surface-area hulls materially tighten the fit. This includes a one-row Outliner — req_3328 removed the old ranges.length < 2 opt-out that sent most props to the host\'s one whole-mesh AABB fallback. Over-budget multi-row paths still merge nearby same-family roots locally; flat faces thicken 4 cm downward. livePush writes the boxes into the existing MESH_PROPS collision block and world_loader consumes them verbatim, so no dynamic shape work enters the frame loop.',
      dependsOn: ['cart/editor/data/meshDoc.ts PackageMeshDoc ranges', 'framework/world/constructor.zig MeshPropMesh.collision_boxes'],
      consumers: ['cart/editor/world/livePush.ts residentMeshFor', 'framework/world_loader/physics.zig meshPropIslands'],
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
