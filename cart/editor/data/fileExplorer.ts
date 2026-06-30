export type ExplorerFolderId =
  | 'workspace'
  | 'imports'
  | 'imports-models'
  | 'imports-textures'
  | 'imports-audio'
  | 'imports-recent'
  | 'mock'
  | 'hmsc-int'
  | 'hmsc-int-editors'
  | 'hmsc-int-game'
  | 'hmsc-int-world'
  | 'runtime'
  | 'runtime-icons'
  | 'runtime-workspace'
  | 'framework'
  | 'framework-gpu'
  | 'tools'
  | 'docs';

export type ExplorerFileKind = 'tsx' | 'ts' | 'zig' | 'md' | 'json' | 'glb' | 'gltf' | 'obj' | 'fbx' | 'png' | 'wav';

export type ExplorerModelPreview = {
  kind: 'model';
  format: string;
  triangles: string;
  materials: number;
  bounds: string;
  upAxis: string;
  importAs: string;
  textureSlots: string[];
  checks: string[];
};

export type ExplorerFolder = {
  id: ExplorerFolderId;
  label: string;
  icon?: string;
  children?: ExplorerFolder[];
};

export type ExplorerFile = {
  id: string;
  folder: ExplorerFolderId;
  path: string;
  name: string;
  kind: ExplorerFileKind;
  owner: string;
  modified: string;
  opens: number;
  summary: string;
  imports: string[];
  tags: string[];
  preview?: ExplorerModelPreview;
};

export type ExplorerHistoryEntry = {
  id: string;
  fileId: string;
  action: string;
  query: string;
  at: string;
};

export type ExplorerDirectoryHistoryEntry = {
  id: string;
  folderId: ExplorerFolderId;
  label: string;
  path: string;
  at: string;
};

export const EXPLORER_FOLDERS: ExplorerFolder[] = [
  {
    id: 'workspace',
    label: '/workspace',
    icon: 'FolderTree',
    children: [
      {
        id: 'imports',
        label: '/Imports',
        icon: 'FolderInput',
        children: [
          { id: 'imports-recent', label: 'Recent', icon: 'Clock3' },
          { id: 'imports-models', label: 'Models', icon: 'Box' },
          { id: 'imports-textures', label: 'Textures', icon: 'Image' },
          { id: 'imports-audio', label: 'Audio', icon: 'Volume2' },
        ],
      },
      {
        id: 'mock',
        label: 'cart/hmsc-workspace-mock',
        icon: 'PanelLeft',
      },
      {
        id: 'hmsc-int',
        label: 'cart/hmsc-int',
        icon: 'FolderOpen',
        children: [
          { id: 'hmsc-int-editors', label: 'editors', icon: 'PanelRight' },
          {
            id: 'hmsc-int-game',
            label: 'game',
            icon: 'Database',
            children: [
              { id: 'hmsc-int-world', label: 'world', icon: 'MapPinned' },
            ],
          },
        ],
      },
      {
        id: 'runtime',
        label: 'runtime',
        icon: 'Code2',
        children: [
          { id: 'runtime-icons', label: 'icons', icon: 'Archive' },
          { id: 'runtime-workspace', label: 'workspace', icon: 'FolderInput' },
        ],
      },
      {
        id: 'framework',
        label: 'framework',
        icon: 'Cpu',
        children: [
          { id: 'framework-gpu', label: 'gpu', icon: 'Activity' },
        ],
      },
      { id: 'tools', label: 'tools / cli', icon: 'Wrench' },
      { id: 'docs', label: 'docs', icon: 'BookOpen' },
    ],
  },
];

export const EXPLORER_FILES: ExplorerFile[] = [
  {
    id: 'desk-glb',
    folder: 'imports-models',
    path: '/home/siah/creative/reactjit/cart/hmsc-int/Desk.glb',
    name: 'Desk.glb',
    kind: 'glb',
    owner: 'external import',
    modified: 'today',
    opens: 56,
    summary: 'Furniture prop candidate with separate wood, metal, and drawer material slots.',
    imports: ['embedded mesh: desk_body', 'embedded mesh: drawer_handles', 'texture: desk_albedo.png'],
    tags: ['model', 'prop', 'furniture', 'import candidate', 'recent'],
    preview: {
      kind: 'model',
      format: 'GLB 2.0',
      triangles: '12.8k',
      materials: 3,
      bounds: '2.1m x 0.8m x 1.0m',
      upAxis: 'Y+',
      importAs: 'searchable prop',
      textureSlots: ['wood_base', 'brushed_metal', 'drawer_shadow'],
      checks: ['scale pending', 'origin centered', 'collision hull needed'],
    },
  },
  {
    id: 'car-obj',
    folder: 'imports-models',
    path: '/home/siah/creative/reactjit/cart/hmsc-int/car.obj',
    name: 'car.obj',
    kind: 'obj',
    owner: 'external import',
    modified: 'today',
    opens: 44,
    summary: 'Vehicle shell import candidate with sidecar material file and loose texture references.',
    imports: ['car.mtl', 'body_diffuse.png', 'glass_mask.png'],
    tags: ['model', 'vehicle', 'OBJ', 'material sidecar'],
    preview: {
      kind: 'model',
      format: 'OBJ + MTL',
      triangles: '28.4k',
      materials: 6,
      bounds: '4.6m x 1.9m x 1.5m',
      upAxis: 'Z+ source',
      importAs: 'vehicle asset',
      textureSlots: ['body', 'glass', 'rubber', 'chrome', 'lights', 'interior'],
      checks: ['axis remap required', 'wheels not split', 'collision hull needed'],
    },
  },
  {
    id: 'motel-sign-gltf',
    folder: 'imports-models',
    path: '/mnt/assets/hmsc/dropbox/signage/motel_sign.gltf',
    name: 'motel_sign.gltf',
    kind: 'gltf',
    owner: 'asset inbox',
    modified: 'yesterday',
    opens: 31,
    summary: 'Neon motel sign model with emissive material channel and readable face plate.',
    imports: ['motel_sign.bin', 'neon_strip.png', 'painted_face.png'],
    tags: ['model', 'sign', 'emissive', 'architecture'],
    preview: {
      kind: 'model',
      format: 'glTF',
      triangles: '5.2k',
      materials: 4,
      bounds: '3.0m x 0.3m x 1.6m',
      upAxis: 'Y+',
      importAs: 'building prop',
      textureSlots: ['sign_face', 'neon_emissive', 'rust_edge', 'back_plate'],
      checks: ['emissive channel detected', 'origin at mounting edge', 'ready for prop tags'],
    },
  },
  {
    id: 'warehouse-door-fbx',
    folder: 'imports-models',
    path: '/mnt/assets/hmsc/vendor/warehouse_door.fbx',
    name: 'warehouse_door.fbx',
    kind: 'fbx',
    owner: 'asset inbox',
    modified: 'this week',
    opens: 22,
    summary: 'Industrial garage door candidate that should import as a semantic wall edit or prop variant.',
    imports: ['embedded animation: rollup_open', 'embedded material: scratched_steel'],
    tags: ['model', 'door', 'building piece', 'animation'],
    preview: {
      kind: 'model',
      format: 'FBX',
      triangles: '9.7k',
      materials: 2,
      bounds: '3.6m x 0.4m x 3.2m',
      upAxis: 'Y+',
      importAs: 'wall edit variant',
      textureSlots: ['scratched_steel', 'rubber_trim'],
      checks: ['animation track found', 'snap plane needed', 'semantic mapping pending'],
    },
  },
  {
    id: 'brick-texture-png',
    folder: 'imports-textures',
    path: '/mnt/assets/hmsc/materials/brick_worn_albedo.png',
    name: 'brick_worn_albedo.png',
    kind: 'png',
    owner: 'asset inbox',
    modified: 'this week',
    opens: 19,
    summary: 'Worn brick texture candidate for material recipe and shader-layer authoring.',
    imports: [],
    tags: ['texture', 'material', 'brick', 'albedo'],
  },
  {
    id: 'door-hit-wav',
    folder: 'imports-audio',
    path: '/mnt/assets/hmsc/audio/door_hit_02.wav',
    name: 'door_hit_02.wav',
    kind: 'wav',
    owner: 'asset inbox',
    modified: 'this week',
    opens: 7,
    summary: 'Short impact sound candidate for door hit and metal prop collision events.',
    imports: [],
    tags: ['audio', 'sfx', 'door', 'collision'],
  },
  {
    id: 'mock-index',
    folder: 'mock',
    path: 'cart/hmsc-workspace-mock/index.tsx',
    name: 'index.tsx',
    kind: 'tsx',
    owner: 'workspace mock',
    modified: 'today',
    opens: 38,
    summary: 'Interactive Photoshop-style editor shell mock: menus, panels, stage, dock, build journal, eventbus popover.',
    imports: ['runtime/icons/Icon', 'runtime/classifier', './theme', './workspace.cls'],
    tags: ['mock', 'workspace shell', 'menus', 'eventbus', 'dock'],
  },
  {
    id: 'mock-styles',
    folder: 'mock',
    path: 'cart/hmsc-workspace-mock/workspace.cls.ts',
    name: 'workspace.cls.ts',
    kind: 'ts',
    owner: 'workspace mock',
    modified: 'today',
    opens: 27,
    summary: 'Classifier-backed style contract for the mock workspace surfaces.',
    imports: ['runtime/classifier', './theme'],
    tags: ['classifiers', 'styles', 'controls', 'layout'],
  },
  {
    id: 'mock-intake',
    folder: 'mock',
    path: 'cart/hmsc-workspace-mock/DESIGN_INTAKE.md',
    name: 'DESIGN_INTAKE.md',
    kind: 'md',
    owner: 'design notes',
    modified: 'today',
    opens: 19,
    summary: 'Running design notes for disliked areas, workspace doctrine, placement latency, bottom dock, and content browser direction.',
    imports: [],
    tags: ['design notes', 'decisions', 'placement latency', 'content browser'],
  },
  {
    id: 'hmsc-int-index',
    folder: 'hmsc-int',
    path: 'cart/hmsc-int/index.tsx',
    name: 'index.tsx',
    kind: 'tsx',
    owner: 'hmsc-int shell',
    modified: 'yesterday',
    opens: 42,
    summary: 'Primary internal editor route composition and world preview assembly.',
    imports: ['editors/sessions', 'game/world/stream', 'game/world/buildings', 'LoaderIsoView'],
    tags: ['hmsc-int', 'route shell', 'placementWorld', 'preview'],
  },
  {
    id: 'loader-iso',
    folder: 'hmsc-int',
    path: 'cart/hmsc-int/LoaderIsoView.tsx',
    name: 'LoaderIsoView.tsx',
    kind: 'tsx',
    owner: '3d editor',
    modified: 'yesterday',
    opens: 36,
    summary: '3D loader and live overlay feedback path for placement, move, delete, and material pushes.',
    imports: ['game/build', 'pieceInstanceRows', 'meshPropLivePush', 'buildingSkinBoxes'],
    tags: ['live overlay', 'placement latency', '3d', 'authoring'],
  },
  {
    id: 'sessions',
    folder: 'hmsc-int-editors',
    path: 'cart/hmsc-int/editors/sessions.ts',
    name: 'sessions.ts',
    kind: 'ts',
    owner: 'sessions',
    modified: 'yesterday',
    opens: 34,
    summary: 'Route-scoped session history, commit batching, and deferred materialized snapshots.',
    imports: ['data', 'telemetry'],
    tags: ['history', 'sessions', 'snapshot', 'eventbus'],
  },
  {
    id: 'data-index',
    folder: 'hmsc-int',
    path: 'cart/hmsc-int/data/index.ts',
    name: 'data/index.ts',
    kind: 'ts',
    owner: 'persistence',
    modified: 'yesterday',
    opens: 33,
    summary: 'SQLite-backed append-only streams with snapshot-plus-tail boot and cold stateAt history reads.',
    imports: ['sqlite', 'workspace paths', 'telemetry'],
    tags: ['V20', 'persistence', 'streams', 'snapshot boot'],
  },
  {
    id: 'world-stream',
    folder: 'hmsc-int-world',
    path: 'cart/hmsc-int/game/world/stream.ts',
    name: 'stream.ts',
    kind: 'ts',
    owner: 'world stream',
    modified: 'this week',
    opens: 26,
    summary: 'World stream materializer for floors, pieces, prefabs, placement, move, edit, delete, and skin events.',
    imports: ['game/build', 'prefabs', 'textures'],
    tags: ['world', 'pieces', 'placement', 'stream apply'],
  },
  {
    id: 'buildings',
    folder: 'hmsc-int-world',
    path: 'cart/hmsc-int/game/world/buildings.ts',
    name: 'buildings.ts',
    kind: 'ts',
    owner: 'building stream',
    modified: 'this week',
    opens: 30,
    summary: 'Semantic building defs and instance references; one-event building moves and cached derived pieces.',
    imports: ['game/build', 'prefabFromPieces', 'stampPrefabPieces'],
    tags: ['buildings', 'semantic pieces', 'derived view', 'history'],
  },
  {
    id: 'build-index',
    folder: 'hmsc-int-game',
    path: 'cart/hmsc-int/game/build/index.ts',
    name: 'build/index.ts',
    kind: 'ts',
    owner: 'build catalog',
    modified: 'this week',
    opens: 22,
    summary: 'Building-piece catalog door and placement helpers for semantic construction.',
    imports: ['catalog', 'placed', 'prefabs'],
    tags: ['build pieces', 'catalog', 'placement'],
  },
  {
    id: 'runtime-icon',
    folder: 'runtime-icons',
    path: 'runtime/icons/Icon.tsx',
    name: 'Icon.tsx',
    kind: 'tsx',
    owner: 'runtime icons',
    modified: 'today',
    opens: 18,
    summary: 'Baked-aware icon component that routes named icons through the SDF atlas before path fallback.',
    imports: ['primitives/SdfIcon', 'icons/registry', 'icons/baked-names'],
    tags: ['icons', 'SDF', 'baked atlas', 'performance'],
  },
  {
    id: 'baked-names',
    folder: 'runtime-icons',
    path: 'runtime/icons/baked-names.ts',
    name: 'baked-names.ts',
    kind: 'ts',
    owner: 'runtime icons',
    modified: 'today',
    opens: 12,
    summary: 'Generated set of icon names present in the SDF icon atlas.',
    imports: [],
    tags: ['generated', 'icons', 'atlas'],
  },
  {
    id: 'bake-icons',
    folder: 'tools',
    path: 'cli/commands/bake-icons.ts',
    name: 'bake-icons.ts',
    kind: 'ts',
    owner: 'cli tools',
    modified: 'this week',
    opens: 15,
    summary: 'CLI command that bakes Lucide and paint glyph shapes into the framework GPU SDF icon atlas.',
    imports: ['runtime/icons/icons.ts', 'runtime/paint/icons.ts', 'framework/gpu/icon_atlas.zig'],
    tags: ['tools', 'icons', 'bake', 'performance'],
  },
  {
    id: 'icon-atlas',
    folder: 'framework-gpu',
    path: 'framework/gpu/icon_atlas.zig',
    name: 'icon_atlas.zig',
    kind: 'zig',
    owner: 'framework gpu',
    modified: 'generated',
    opens: 9,
    summary: 'Generated GPU icon atlas data consumed by the SDF icon renderer.',
    imports: ['framework/gpu/sdf_icons.zig'],
    tags: ['generated', 'zig', 'gpu', 'icons'],
  },
  {
    id: 'rle',
    folder: 'runtime-workspace',
    path: 'runtime/workspace/rle.ts',
    name: 'rle.ts',
    kind: 'ts',
    owner: 'workspace runtime',
    modified: 'this week',
    opens: 11,
    summary: 'Shared row-RLE codec used by source JSON and compiled map format expectations.',
    imports: [],
    tags: ['RLE', 'map format', 'runtime workspace'],
  },
  {
    id: 'compile-cache-doc',
    folder: 'docs',
    path: 'docs/game/COMPILE_CACHE_ARCHITECTURE.md',
    name: 'COMPILE_CACHE_ARCHITECTURE.md',
    kind: 'md',
    owner: 'game docs',
    modified: 'today',
    opens: 8,
    summary: 'Compile cache and manifest architecture for content-addressed compiled chunk artifacts.',
    imports: [],
    tags: ['compile cache', 'manifest', 'chunk history', 'V31'],
  },
];

export const INITIAL_EXPLORER_HISTORY: ExplorerHistoryEntry[] = [
  { id: 'fh-6', fileId: 'desk-glb', action: 'previewed', query: 'recent model imports', at: '1m ago' },
  { id: 'fh-5', fileId: 'mock-index', action: 'opened', query: 'workspace mock', at: '2m ago' },
  { id: 'fh-4', fileId: 'loader-iso', action: 'jumped', query: 'placement latency', at: '8m ago' },
  { id: 'fh-3', fileId: 'sessions', action: 'opened', query: 'history snapshots', at: '14m ago' },
  { id: 'fh-2', fileId: 'car-obj', action: 'staged import', query: 'vehicle model', at: '19m ago' },
  { id: 'fh-1', fileId: 'mock-intake', action: 'reviewed', query: 'design notes', at: '31m ago' },
];

export const INITIAL_EXPLORER_DIRECTORY_HISTORY: ExplorerDirectoryHistoryEntry[] = [
  { id: 'dh-5', folderId: 'imports-models', label: 'Models', path: '/mnt/assets/hmsc/models', at: '1m ago' },
  { id: 'dh-4', folderId: 'imports-recent', label: 'Recent imports', path: '/Imports/Recent', at: '7m ago' },
  { id: 'dh-3', folderId: 'hmsc-int', label: 'hmsc-int', path: 'cart/hmsc-int', at: '12m ago' },
  { id: 'dh-2', folderId: 'imports-textures', label: 'Textures', path: '/mnt/assets/hmsc/materials', at: '21m ago' },
];

export function explorerFileById(id: string): ExplorerFile {
  return EXPLORER_FILES.find((file) => file.id === id) ?? EXPLORER_FILES[0]!;
}

export function explorerFolderLabel(folder: ExplorerFolderId): string {
  const visit = (nodes: ExplorerFolder[]): ExplorerFolder | null => {
    for (const node of nodes) {
      if (node.id === folder) return node;
      const found = node.children ? visit(node.children) : null;
      if (found) return found;
    }
    return null;
  };
  return visit(EXPLORER_FOLDERS)?.label ?? folder;
}

export function explorerFileIcon(kind: ExplorerFileKind): string {
  if (kind === 'tsx') return 'FileCode2';
  if (kind === 'ts') return 'FileText';
  if (kind === 'zig') return 'Cpu';
  if (kind === 'md') return 'BookOpen';
  if (kind === 'glb' || kind === 'gltf' || kind === 'obj' || kind === 'fbx') return 'Box';
  if (kind === 'png') return 'Image';
  if (kind === 'wav') return 'Volume2';
  return 'FileJson';
}

export function explorerMatchesFolder(file: ExplorerFile, folder: ExplorerFolderId): boolean {
  if (folder === 'workspace') return true;
  if (folder === 'imports') return file.folder === 'imports-models' || file.folder === 'imports-textures' || file.folder === 'imports-audio';
  if (folder === 'imports-recent') return file.folder.startsWith('imports-') && (file.tags.includes('recent') || file.opens >= 20);
  if (folder === 'hmsc-int') return file.path.startsWith('cart/hmsc-int/');
  if (folder === 'hmsc-int-game') return file.path.startsWith('cart/hmsc-int/game/');
  if (folder === 'runtime') return file.path.startsWith('runtime/');
  if (folder === 'framework') return file.path.startsWith('framework/');
  if (folder === 'tools') return file.path.startsWith('cli/') || file.path.startsWith('tools/');
  return file.folder === folder;
}

export function explorerSearchText(file: ExplorerFile): string {
  return [
    file.name,
    file.path,
    file.summary,
    file.owner,
    file.kind,
    ...file.imports,
    ...file.tags,
  ].join(' ').toLowerCase();
}
