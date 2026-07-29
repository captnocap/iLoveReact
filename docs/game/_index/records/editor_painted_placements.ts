import type { DocIndex } from '../types';

export const editor_painted_placements: DocIndex = {
  name: 'editor_painted_placements',
  file: 'editor_painted_placements.md',
  cart: 'cart/editor/world/livePush.ts',
  purpose: ['building', 'texture_bake', 'rendering', 'persistence', 'physics', 'geometry', 'ui'],
  summary:
    'Which mesh, UV document, editable infinite image workspace, derived UV guide, coverage-cleaned raster, compiled shared skin atlas, and collision shape a saved/placed authored model uses (req_2832/2833/2930/3133/3328/3329/3362/3431/3515/3520/3522/3523/3524/3525/3526/3527/3528): UV corners move freely in signed workspace coordinates, UV mode keeps source images visible beneath the editable graph, finite model-atlas samples outside the image alpha-discard, and content-addressed native-pixel image layers explicitly compile to their smallest transparent finite union while remaining separately editable and lockable. base.paint.json v4 cold-restores every exact face-corner UV; welded corner identity stitches selected broken islands to one fixed active island, authored quad-aware edges export as an atlas-sized transparent uv-wireframe.png, finalized source PNGs neutralize texels outside exact UV coverage, and Compile Shared Atlas best-fit packs independent paint looks. Placement uses the full-res meshdoc with the painting\'s UVs rebound onto it except when painting a quality-DECIMATED display. Visible full-res saved Outliner ranges bake both bounded coarse boxes and exact immutable player-collision triangles; painted.json stamps which doc revision owns a decimated exported look; every save also persists mesh/collision.blob (RJCB v1).',
  interfaces: [
    {
      name: 'signed UV image workspace + explicit transparent compile',
      purpose: ['texture_bake', 'persistence', 'ui', 'geometry', 'rendering'],
      kind: 'utility',
      sourceFile: 'cart/editor/data/uvTextureWorkspace.ts',
      description:
        'req_3524–3528: the UV editor is a signed, pannable workspace rather than a 0..atlas clamp. UV islands/faces/vertices and welded seam fits may live before or beyond the finite image; the native exact-corner boundary and topology builder retain those coordinates. A full-surface alpha checker and visible signed grid make empty space explicit, while Scene3D finite-atlas bind groups alpha-cut samples outside [0,1] without changing ordinary material-texture sampling. atlases/uv-workspace.json orders immutable native-pixel sources under atlases/uv-sources/<sha256>.png. Add Image snapshots the paint raster baseline and retains every original. UV mode renders the visible source stack beneath the UV graph while reserving image transforms; IMAGES mode moves only an unlocked image under the pointer, with locked-image and empty-space hits falling through to UV editing. Persisted layer locks do not stale Compile. Explicit Compile yields while reading, source-over composites the smallest visible integer union with transparent gaps and no resampling, applies oldOrigin-newOrigin so workspace UVs stay fixed, then preserves/replays the editable paint program over the reconstructed baseline.',
      dependsOn: ['cart/editor/data/uvTextureWorkspaceStore.ts', 'framework/v8_bindings_core.zig __model_atlas_workspace_apply', 'framework/gpu/model_paint.zig importAtlasTranslatingUvGeometry', 'framework/gpu/shaders.zig finite diffuse sampling flag'],
      consumers: ['cart/editor/inspector/UvEditor.tsx', 'cart/editor/stage/ModelView.tsx'],
      status: 'live',
    },
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
      name: '__model_uv_coverage_write + writeUvCoverageRasters (finalized atlas cleanup)',
      purpose: ['texture_bake', 'persistence', 'host_bridge', 'ui'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_core.zig',
      description:
        'req_3520: Save/Update derives package and variant PNGs from the resident composite/baseline without mutating the live imported texture. model_paint.buildVariantUvCoverage unions every exact UV triangle with the shared two-texel filtering gutter; covered bytes (including authored glass) survive exactly, while every other texel becomes one opaque neutral clay pixel. Dimensions and cornerUv never move, but arbitrary unused image regions become highly PNG-compressible. Opaque clearing is load-bearing because atlas alpha is world material opacity and transparent cleanup would revive req_3450 invisible faces. __model_atlas_read(0) omits the large base64 raster; data/uvCoverageRaster.ts validates dimensions/counts and landed file stats, variant json records kept/cleared/total + byte sizes, and the panel reports percent trimmed after save. Native failure lazily falls back to the old base64 writer without a false cleanup claim.',
      dependsOn: ['framework/gpu/model_paint.zig VariantUvCoverage/VariantRasterTuning', 'framework/gpu/capture.zig writeRgbaPng', 'cart/editor/data/uvCoverageRaster.ts'],
      consumers: ['cart/editor/data/paintVariants.ts', 'cart/editor/data/modelPackageStore.ts', 'cart/editor/library/ModelPaintVariants.tsx'],
      status: 'live',
    },
    {
      name: 'compilePaintAtlas (editable looks → one content-addressed shared atlas)',
      purpose: ['texture_bake', 'persistence', 'building', 'ui'],
      kind: 'utility',
      sourceFile: 'cart/editor/data/paintAtlasCompiler.ts',
      description:
        'req_3522/3523: atlases/base.* and paints/paint_N.* remain independent editable sources forever; nothing repacks on Save. The explicit Compile/Recompile Shared Atlas button scans their paint-space meshes, retains UV coverage plus filter safety, edge-extrudes each crop, aliases byte-identical source/crop pairs, and searches deterministic skyline orders/widths for the smallest valid lossless placement it finds. It writes one compiled-atlas-<sha256>.png plus content-addressed UV-remapped mesh copies, then commits compiled-atlas.json last. No source file is changed, scaled, resampled, or deleted. Source count/stat fingerprints mark the manifest fresh/stale as variants arrive; progress yields between raster sources. livePush reads the shared PNG once and uses each independently current compiled entry, falling back to only a changed/new individual look until explicit Recompile.',
      dependsOn: ['cart/editor/data/paintVariants.ts independent source files', 'runtime/image.ts raw decode/lossless PNG encode', 'runtime/workspace/sha256.ts'],
      consumers: ['cart/editor/library/ModelPaintVariants.tsx', 'cart/editor/world/livePush.ts'],
      status: 'live',
    },
    {
      name: 'welded-identity UV stitch + transparent authored-edge guide',
      purpose: ['geometry', 'ui', 'texture_bake', 'persistence'],
      kind: 'utility',
      sourceFile: 'cart/editor/model/uvLayout.ts',
      description:
        'req_3515/3516/3517/3518/3519/3524: stitchUvIslands consumes the cornerVertices ids already published for UV corner colors. It cancels internal edges to recover welded boundaries, keeps the white active island fixed, then walks every selected island reachable by a shared topology edge (or one unambiguous boundary vertex). Boundary topology and two-owner seam relations are indexed once; a priority heap evaluates each reachable pair once instead of repeatedly rescanning remaining×fixed islands, with a 6,831-island candidate-bound regression covering the Torso freeze and ambiguous many-island poles refused. A handed similarity fit preserves the moving island while exact seam endpoints make the host rebuild one connected island; unrelated selections stay put and a valid fit may now land outside the finite image in signed workspace space. UvEditor exposes Stitch Matching Seams as a direct RMB row carrying the detected island count; it records the entire sweep as one append-only stitch UV seams history action. WIRE PNG rasterizes the same authored face edges plus heavier island boundaries onto alpha-zero RGBA, so authored quads do not regain resident triangle diagonals; writeModelUvWireframe atomically writes atlases/uv-wireframe.png and the UI copies the proven absolute path.',
      dependsOn: ['framework/v8_bindings_core.zig __model_atlas_read / __model_uv_geometry_apply', 'cart/editor/model/uvWireframe.ts rasterizeUvWireframe', 'cart/editor/data/modelPackageStore.ts writeModelUvWireframe'],
      consumers: ['cart/editor/inspector/UvEditor.tsx', 'cart/editor/stage/ModelView.tsx'],
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
