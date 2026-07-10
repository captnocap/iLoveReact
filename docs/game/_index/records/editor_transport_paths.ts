import type { DocIndex } from '../types';

export const editor_transport_paths: DocIndex = {
  name: 'editor_transport_paths',
  file: 'editor_transport_paths.md',
  cart: 'cart/editor/stage/MapPaintDock.tsx',
  purpose: ['world_gen', 'pathing', 'vehicle', 'ui', 'rendering', 'persistence', 'host_bridge'],
  summary:
    'req_2924: the active editor now has one native semantic transport-path pen for roads, light rail, and railway. First click anchors and hover immediately previews the complete next 3D piece; accepted points + adjustable curve reach remain editable until Finish. Roads compile the ruled tile grammar, rail renders/persists from the same path recipe without becoming a second tile or mesh truth.',
  interfaces: [
    {
      name: 'transport.zig semantic path table + live draft',
      purpose: ['world_gen', 'pathing', 'vehicle'],
      kind: 'data_model',
      sourceFile: 'framework/game/map/transport.zig',
      description:
        'Path {id, points, tagged profile road|light_rail|railway, curve_radius_m}; one host-owned committed table plus accepted draft points and one transient hover point. curvePoints is the shared quadratic-fillet sampler. Rail validation gates turns below the light-rail/railway minimum; all limits live in TUNING. Separate committed/draft revisions keep rendering event-driven.',
      consumers: ['framework/game/map/roads.zig', 'framework/game/map/store.zig', 'world_loader.zig'],
      status: 'live',
    },
    {
      name: 'native live transport-path viewport',
      purpose: ['rendering', 'geometry', 'interaction'],
      kind: 'module',
      sourceFile: 'world_loader.zig',
      description:
        'The loader turns its existing painted-terrain hover hit into the draft virtual endpoint. Road previews are full curb-to-curb ribbons; light rail is slab+steel; railway is ballast+steel while moving and gains sleepers once committed. Invalid rail ghosts are red. Dynamic cube-instance rows rebuild only on snapped draft/terrain revisions; no React/frame-loop geometry.',
      dependsOn: ['transport.zig semantic path table + live draft'],
      consumers: ['cart/editor/world/WorldViewport.tsx'],
      status: 'live',
    },
    {
      name: 'mapPath* host/runtime door',
      purpose: ['host_bridge', 'ui'],
      kind: 'host_fn',
      sourceFile: 'runtime/game/map.ts',
      description:
        'UI-rate typed boundary: set tagged profile/curve, Finish, Cancel, Undo Point, Delete, and read the eleven-float stats/validation record. MapPaintDock polls stats at 10 Hz because native viewport clicks intentionally bypass React. Older hosts honestly fall back to road-only rather than pretending to save rail.',
      dependsOn: ['transport.zig semantic path table + live draft'],
      consumers: ['cart/editor/stage/mapPaint.ts', 'cart/editor/stage/MapPaintDock.tsx'],
      status: 'live',
    },
    {
      name: 'RMAP v3 transport recipes',
      purpose: ['persistence', 'format'],
      kind: 'data_model',
      sourceFile: 'framework/game/map/store.zig',
      description:
        'The RMAP trailing recipe table is tagged road/light-rail/railway and carries curve reach. Chunk/material layout is unchanged. v1/v2 road strokes load with their historical 5 m fillet; road undercoat still serializes the base grid and restamps after load.',
      dependsOn: ['transport.zig semantic path table + live draft'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'one semantic path, separate compilers',
      purpose: ['world_gen', 'pathing', 'vehicle'],
      description:
        'Share the authored curve and interaction, not the derived systems: roads filter into lane/crosswalk tiles; rail renders and later feeds train routing from the tagged path. Preview and consumers sample the same curve. Never infer a rail network back from its sleepers/meshes.',
      examples: ['editor_transport_paths'],
      status: 'resolved',
    },
  ],
  hazards: [
    {
      name: 'rail path is authored, train gameplay consumer is not yet attached',
      purpose: ['vehicle', 'pathing'],
      description:
        'The live/persisted rail network and visual grammar exist, but switches, stations, signals, and train motion are later consumers. Do not create a second route graph from rendered geometry; extend the tagged Path contract and compile from it.',
      evidence: ['framework/game/map/transport.zig', 'docs/game/editor_transport_paths.md'],
      severity: 'medium',
    },
  ],
};
