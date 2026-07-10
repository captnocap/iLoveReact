import type { DocIndex } from '../types';

export const editor_flora: DocIndex = {
  name: 'editor_flora',
  file: 'editor_flora.md',
  cart: 'cart/editor/world/floraKinds.ts',
  purpose: ['world_gen', 'rendering', 'geometry', 'shader', 'persistence'],
  summary:
    'The active cart/editor Map Paint flora system: an append-only kind/spec catalog feeds fixed Zig recipes, off-thread chunked preview expansion, and shared wrapped tree meshes; every non-palm tree is one 24-byte slim GPU instance while map cells remain RLE kind references.',
  interfaces: [
    {
      name: 'editor flora catalog / FLORA_SPECS',
      purpose: ['world_gen', 'persistence'],
      kind: 'registry',
      sourceFile: 'cart/editor/world/floraKinds.ts',
      description:
        'The active painter legend and ONE population table. Original indices 0–8 are stable; NW Pine, Maple, Oak, Western Red Cedar, Spruce, Tall Grass, Reeds, Low Bush, and Dense Bush append. FLORA_SPECS derives from each definition\'s population record, preventing palette/spec order drift.',
      consumers: ['cart/editor/stage/mapPaint.ts', 'framework/game/map/engine.zig', 'world_loader.zig'],
      status: 'live',
    },
    {
      name: 'fixed foliage recipes / shared tree geometry',
      purpose: ['world_gen', 'geometry'],
      kind: 'module',
      sourceFile: 'framework/world/foliage.zig',
      description:
        'Append-only Spec ids, named ground-flora configs, deterministic species transforms, and flora_geometry.zig\'s immutable meshes. Conifers repeat a tapered plane around the trunk in 360-degree tiers; oak/maple use tapered branch tubes plus crossed crown cards. Geometry builds once and every non-palm tree emits one transform row.',
      dependsOn: ['editor flora catalog / FLORA_SPECS'],
      consumers: ['world_loader.zig'],
      status: 'live',
    },
    {
      name: '24-byte whole-tree foliage path',
      purpose: ['rendering', 'shader'],
      kind: 'shader',
      sourceFile: 'framework/gpu/shaders.zig',
      description:
        'The existing ~frond~ SlimInstance pipeline extended with UV bands for conifer spray, deciduous crown, and stationary bark. The complete shared tree mesh uses ONE compile-time-asserted 24-byte GPU row; palm remains the detailed exception with one ordinary trunk plus multiple slim fronds.',
      dependsOn: ['fixed foliage recipes / shared tree geometry'],
      consumers: ['world_loader.zig'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'store the flora recipe, reference the shared mesh',
      purpose: ['world_gen', 'persistence', 'rendering'],
      description:
        'Painted maps store RLE lane indices; a fixed deterministic system expands transforms and references one baked mesh per species. Detail changes shared geometry cost, never per-cell map size or the 24-byte tree instance.',
      examples: ['editor_flora'],
      status: 'resolved',
    },
  ],
  hazards: [
    {
      name: 'wood_probe oak was a demo, not painter output',
      purpose: ['world_gen', 'geometry'],
      description:
        'req_1149/77cc25443 proved SVG PathTube branches in cart/wood_probe.tsx but never connected them to Map Paint, the active editor, or compiled flora. Read it as geometry reference only; new flora work belongs in cart/editor plus the fixed Zig recipe/loader path.',
      evidence: ['cart/wood_probe.tsx', 'runtime/geometries/PathTube.ts', 'docs/game/editor_flora.md'],
      severity: 'high',
    },
  ],
};
