import type { DocIndex } from '../types';

export const editor_map_documents: DocIndex = {
  name: 'editor_map_documents',
  file: 'editor_map_documents.md',
  cart: 'cart/editor/data/mapDocuments.ts',
  purpose: ['persistence', 'world_gen', 'ui', 'maintenance'],
  summary:
    'cart/editor named map lifecycle (req_2881/2882): each stem directory owns sibling native painting.rmap + React world.json concerns; New/Open synchronously flush and replace both, rollback on failure, and hot state is redacted so pieces/objects/zones/bindings never bleed across maps.',
  interfaces: [
    {
      name: 'editor named map document boundary',
      purpose: ['persistence', 'world_gen'],
      kind: 'data_model',
      sourceFile: 'cart/editor/data/mapDocuments.ts',
      description:
        'zig-out/game/editor/maps/<stem>/{painting.rmap,world.json}; _last.txt points at the active stem. world.json embeds the same document id and is rejected on mismatch. First boot registers fixed painted-map.rmap + world-pieces.json as one legacy document, then retires that fallback once both named concerns exist.',
      consumers: ['cart/editor/data/worldStore.ts', 'cart/editor/stage/mapPaint.ts', 'cart/editor/shell/AppFrame.tsx'],
      status: 'live',
    },
    {
      name: 'map New/Open switch transaction',
      purpose: ['persistence', 'ui'],
      kind: 'module',
      sourceFile: 'cart/editor/shell/AppFrame.tsx',
      description:
        'Validate target world JSON; synchronously flush outgoing JSON+RMAP; disable autosave; load/seed target painting; commit target JSON+pointer; replace all map-authored React slices, including pieces and semantic objects. Malformed/failing target reloads the outgoing painting and leaves state/pointer untouched. File New/Open and the chrome map pill are the UI.',
      dependsOn: ['editor named map document boundary'],
      consumers: ['cart/editor/dialogs/MapDocumentsDialog.tsx'],
      status: 'live',
    },
    {
      name: 'native map reset unbind law',
      purpose: ['persistence', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'framework/game/map/engine.zig',
      description:
        'reset clears chunks/road+rail transport paths/tool state AND the outgoing autosave path + per-map tile-binding table. A caller must bind a target after load/seed; a reset can no longer autosave into the previously active document or carry its material palette into a fresh map.',
      consumers: ['cart/editor/stage/mapPaint.ts'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'per-concern files inside one document directory',
      purpose: ['persistence'],
      description:
        'Keep native binary painting and React JSON placements as separate append-evolving concerns, but derive both paths from one validated stem and switch them through one transaction. Never use independent process-global save paths for concerns that must load together.',
      examples: ['editor_map_documents'],
      status: 'resolved',
    },
  ],
  hazards: [
    {
      name: 'fixed save paths pair unrelated map concerns',
      purpose: ['persistence', 'world_gen'],
      description:
        'A fixed painted-map.rmap plus fixed world-pieces.json can be reset/replaced independently, yielding old build pieces floating over new chunks. Hot-restoring full EditorState is the same bug through memory. Both paths are retired; do not reintroduce a fallback outside the active stem.',
      evidence: ['cart/editor/data/mapDocuments.ts', 'cart/editor/data/persistView.ts', 'docs/game/editor_map_documents.md'],
      severity: 'high',
    },
  ],
};
