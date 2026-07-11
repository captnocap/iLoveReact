import type { DocIndex } from '../types';

export const editor_map_paint_history: DocIndex = {
  name: 'editor_map_paint_history',
  file: 'editor_map_paint_history.md',
  cart: 'cart/editor/shell/AppFrame.tsx',
  purpose: ['ui', 'persistence', 'host_bridge', 'world_gen'],
  summary:
    'req_2935: Map Paint owns a bounded native RMAP gesture journal. Terrain/water/tile/flora/zone strokes, structural map edits, transport paths, and TC Stops undo/redo without consuming the building workspace history; Ctrl+Z routes by active concern and the dock shows native depths.',
  interfaces: [
    {
      name: 'native Map Paint gesture journal',
      purpose: ['persistence', 'world_gen'],
      kind: 'module',
      sourceFile: 'framework/game/map/engine.zig',
      description:
        'Two 64-entry/64 MiB bounded stacks hold compact RMAP snapshots at real native mutation boundaries. Undo/redo restores through the canonical loader, recompiles road undercoat, dirties render mirrors, autosaves, and never crosses a reset/load/named map.',
      consumers: ['framework/v8_bindings_game_map.zig', 'cart/editor/shell/AppFrame.tsx'],
      status: 'live',
    },
    {
      name: 'mapHistory/mapUndo/mapRedo runtime door',
      purpose: ['host_bridge', 'ui'],
      kind: 'host_fn',
      sourceFile: 'runtime/game/map.ts',
      description:
        'Typed UI-rate depth/result boundary over the native journal. AppFrame routes world+MapPaint undo here before world-piece undo, mirrors restored tile bindings back into chrome, and BuildDock polls the owning counts at 2 Hz.',
      dependsOn: ['native Map Paint gesture journal'],
      consumers: ['cart/editor/shell/AppFrame.tsx', 'cart/editor/shell/BuildDock.tsx'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'undo belongs to the active authored concern',
      purpose: ['ui', 'persistence'],
      description:
        'Model mesh, model texture paint, Map Paint RMAP, and world pieces retain separate journals. Ctrl+Z routes to the concern that currently owns input and an empty concern journal refuses instead of falling through into unrelated history.',
      examples: ['editor_map_paint_history'],
      status: 'resolved',
    },
  ],
  hazards: [],
};
