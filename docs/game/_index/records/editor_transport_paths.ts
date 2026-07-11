import type { DocIndex } from '../types';

export const editor_transport_paths: DocIndex = {
  name: 'editor_transport_paths',
  file: 'editor_transport_paths.md',
  cart: 'cart/editor/stage/MapPaintDock.tsx',
  purpose: ['world_gen', 'pathing', 'vehicle', 'ui', 'rendering', 'persistence', 'host_bridge'],
  summary:
    'req_2924/2933/2934/2936/2938: one native semantic road/light-rail/railway pen with immediate 3D preview, signed 3 m storey levels, path-attached TC Stops, RMAP v4 persistence, 3 m lane-aware Road material markings, and Studio traffic/transit prop roles. Roads compile gameplay tiles plus derived paint; rail and controls remain semantic recipes.',
  interfaces: [
    {
      name: 'transport.zig semantic path table + live draft',
      purpose: ['world_gen', 'pathing', 'vehicle'],
      kind: 'data_model',
      sourceFile: 'framework/game/map/transport.zig',
      description:
        'Path points carry snapped X/Z plus signed terrain-relative elevation; profiles remain road|light_rail|railway. curvePoints/samplePath are the shared 3D sampler. Control {id,path_id,distance_m,stop} attaches gameplay to that path. Rail radius and grade validation, 3 m storeys, control snap, and limits live in TUNING. Separate revisions keep rendering event-driven.',
      consumers: ['framework/game/map/roads.zig', 'framework/game/map/store.zig', 'world_loader.zig'],
      status: 'live',
    },
    {
      name: 'native live transport-path viewport',
      purpose: ['rendering', 'geometry', 'interaction'],
      kind: 'module',
      sourceFile: 'world_loader.zig',
      description:
        'The loader turns its terrain hover into a 3D draft endpoint or projected TC Stop. Road previews are curb-to-curb; light rail is slab+steel; railway gains sleepers once committed; stop controls render as transverse bars/posts. Invalid curve/grade/duplicate-stop ghosts are red. Instance rows rebuild only on semantic/terrain revisions.',
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
        'UI-rate typed boundary: select draw|stop, set tagged profile/curve/signed level, Finish/Cancel/Undo Point/Delete path or control, and read compact grade/target stats. MapPaintDock polls at 10 Hz because native viewport clicks intentionally bypass React. Older hosts remain honestly road-only.',
      dependsOn: ['transport.zig semantic path table + live draft'],
      consumers: ['cart/editor/stage/mapPaint.ts', 'cart/editor/stage/MapPaintDock.tsx'],
      status: 'live',
    },
    {
      name: 'RMAP v4 transport recipes and controls',
      purpose: ['persistence', 'format'],
      kind: 'data_model',
      sourceFile: 'framework/game/map/store.zig',
      description:
        'The RMAP path table carries tagged profile, curve reach, stable id, and point elevation; a trailing table stores path-attached controls. Chunk/material layout is unchanged. v1/v2 roads retain their 5 m fillet and v3 rail migrates at Ground with no controls.',
      dependsOn: ['transport.zig semantic path table + live draft'],
      status: 'live',
    },
    {
      name: 'three-metre road lane markings',
      purpose: ['rendering', 'world_gen'],
      kind: 'module',
      sourceFile: 'cart/editor/render3d/groundFormula.ts',
      description:
        'req_2936/2938: road cells bind the Road catalog instead of concrete. roads.zig derives a marking byte from the ruled 3 m cross-section: 7 m minimum two-way carriageway, yellow median, dashed internal splits, solid outer edges, crosswalk band, and longitudinal axis. engine.zig packs it above binding+1 in the existing material-reference plane; the ground formula rotates metre/UV axes and composites the semantic markings.',
      dependsOn: ['transport.zig semantic path table + live draft'],
      status: 'live',
    },
    {
      name: 'semantic Studio prop export roles',
      purpose: ['vehicle', 'world_gen', 'persistence', 'ui'],
      kind: 'data_model',
      sourceFile: 'cart/editor/data/propExports.ts',
      description:
        'req_2938: File → Export → Prop declares scenery|stopSign|trafficLight|streetSign|busStop|trainStop in manifest.placeable.role. Existing role-less props read as scenery. Geometry remains one free-placeable authored prop; later derived intersections and transport controls select catalog models by role instead of filenames.',
      consumers: ['cart/editor/data/commands.ts', 'cart/editor/shell/AppFrame.tsx', 'cart/editor/data/initialState.ts'],
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
        'The live/persisted 3D rail network, TC Stops, lane marking recipe, and traffic/transit prop roles exist, but automatic junction prop placement, center-turn/exit stencils, runtime traffic gates, switches, stations, bridge/tunnel structure, and train motion are later consumers. Do not create a second route graph from rendered geometry; consume Path + Control and samplePath.',
      evidence: ['framework/game/map/transport.zig', 'docs/game/editor_transport_paths.md'],
      severity: 'medium',
    },
  ],
};
