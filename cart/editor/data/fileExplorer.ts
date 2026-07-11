// editor/data/fileExplorer.ts — the LIVE project asset index behind the Project
// Asset Explorer dialog (Ctrl+P). This replaced the original fabricated preview shim:
// every folder, file row, size, and modified time here is a real filesystem read
// through the fs door (runtime/hooks/fs → __fs_list_json / __fs_stat_json — the same
// doors the asset catalog and modelPackageStore already use). The index is built
// lazily on first use and cached; "rescan" drops the cache and re-reads the disk.
//
// Model files (.glb / .obj) found here are IMPORTABLE: opening one routes through the
// native host mesh importer (__mesh_load_file) into a model document. .gltf/.fbx are
// listed but not importable (the host parses self-contained .glb and .obj only).
import { listDir, stat, type FsStat } from '../../../runtime/hooks/fs';

// Folder ids are strings: 'all' (everything), 'virt:<class>' (import-class filters),
// or 'dir:<path>' (a real scanned directory).
export type ExplorerFolderId = string;

export type ExplorerCategory = 'model' | 'texture' | 'audio' | 'doc' | 'data';

export type ExplorerFolder = {
  id: ExplorerFolderId;
  label: string;
  icon?: string;
  children?: ExplorerFolder[];
};

export type ExplorerFile = {
  id: string; // the path — unique and stable across rescans
  folder: ExplorerFolderId; // 'dir:<parent dir>'
  path: string;
  name: string;
  kind: string; // lowercase extension ('glb', 'png', ...)
  category: ExplorerCategory;
  importable: boolean; // .glb/.obj → opens through the native mesh importer
  size: number;
  sizeLabel: string;
  mtimeMs: number;
  modifiedLabel: string;
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

export type ExplorerIndex = {
  folders: ExplorerFolder[];
  files: ExplorerFile[];
  // The scan stops LOUDLY at MAX_FILES — when true, the dialog must say the index is
  // capped rather than silently reading as "everything" (truncation is never quiet).
  truncated: boolean;
};

// The product surfaces worth indexing: editor-authored packages only. Model and
// texture imports materialize into cart/editor/data/*, so the explorer reads the editor's
// own portable on-disk project assets.
const SCAN_DIRS = [
  'cart/editor/data/models',
  'cart/editor/data/textures',
];
const TREE_ROOTS = SCAN_DIRS;
// Machine/state dirs that would drown the index in generated noise (request ledger,
// session stores, build output). Matched by directory NAME at any depth.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'zig-out', '.zig-cache', 'build',
  '_generated', '_requests', '_threads', '_reports',
  'sessions', 'domains', 'blobs', 'streams',
]);
const MAX_DEPTH = 4;
const MAX_FILES = 800;

const EXT_CATEGORY: Record<string, ExplorerCategory> = {
  glb: 'model', gltf: 'model', obj: 'model', fbx: 'model',
  png: 'texture', jpg: 'texture', jpeg: 'texture', webp: 'texture',
  wav: 'audio', ogg: 'audio', mp3: 'audio',
  md: 'doc',
  json: 'data', map: 'data',
};

const IMPORTABLE_EXTS = new Set(['glb', 'obj']);

let g_index: ExplorerIndex | null = null;

/** The cached live index — built from disk on first use. */
export function explorerIndex(): ExplorerIndex {
  if (!g_index) g_index = buildIndex();
  return g_index;
}

/** Drop the cache and re-read the disk (the dialog's "rescan"). */
export function refreshExplorerIndex(): ExplorerIndex {
  g_index = null;
  return explorerIndex();
}

function buildIndex(): ExplorerIndex {
  const files: ExplorerFile[] = [];
  const dirsWithFiles = new Set<string>();
  let truncated = false;
  // Breadth-first so a capped scan keeps the shallow (most browsable) files.
  const queue: { path: string; depth: number }[] = SCAN_DIRS
    .filter((root) => stat(root)?.isDir)
    .map((root) => ({ path: root, depth: 0 }));
  while (queue.length > 0 && !truncated) {
    const { path, depth } = queue.shift()!;
    for (const name of listDir(path)) {
      if (name.startsWith('.')) continue;
      const childPath = `${path}/${name}`;
      const info = stat(childPath);
      if (!info) continue;
      if (info.isDir) {
        if (depth + 1 <= MAX_DEPTH && !SKIP_DIRS.has(name)) queue.push({ path: childPath, depth: depth + 1 });
        continue;
      }
      const dot = name.lastIndexOf('.');
      const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
      if (!EXT_CATEGORY[ext]) continue;
      if (!addIndexedFile(files, dirsWithFiles, childPath, info)) {
        truncated = true;
        break;
      }
    }
  }
  return { folders: buildFolderTree(dirsWithFiles), files, truncated };
}

function addIndexedFile(files: ExplorerFile[], dirsWithFiles: Set<string>, path: string, info: FsStat): boolean {
  const slash = path.lastIndexOf('/');
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const dir = slash >= 0 ? path.slice(0, slash) : '.';
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const category = EXT_CATEGORY[ext];
  if (!category) return true;
  if (files.length >= MAX_FILES) return false;
  files.push({
    id: path,
    folder: `dir:${dir}`,
    path,
    name,
    kind: ext,
    category,
    importable: IMPORTABLE_EXTS.has(ext),
    size: info.size,
    sizeLabel: formatSize(info.size),
    mtimeMs: info.mtimeMs,
    modifiedLabel: formatAgo(info.mtimeMs),
  });
  dirsWithFiles.add(dir);
  return true;
}

// The nav tree: an /Imports group of import-class filters, then one node per scanned
// directory that (transitively) holds indexed files.
function buildFolderTree(dirsWithFiles: Set<string>): ExplorerFolder[] {
  const allDirs = new Set<string>();
  for (const dir of dirsWithFiles) {
    let current = dir;
    while (true) {
      allDirs.add(current);
      const parent = current.slice(0, current.lastIndexOf('/'));
      if (!current.includes('/') || TREE_ROOTS.includes(current)) break;
      current = parent;
    }
  }
  const nodeFor = new Map<string, ExplorerFolder>();
  for (const dir of [...allDirs].sort()) {
    nodeFor.set(dir, { id: `dir:${dir}`, label: dir.slice(dir.lastIndexOf('/') + 1), icon: 'Folder' });
  }
  const roots: ExplorerFolder[] = [];
  for (const dir of [...allDirs].sort()) {
    const node = nodeFor.get(dir)!;
    if (TREE_ROOTS.includes(dir)) {
      node.label = dir; // roots show their full path
      node.icon = 'FolderOpen';
      roots.push(node);
      continue;
    }
    const parent = nodeFor.get(dir.slice(0, dir.lastIndexOf('/')));
    if (parent) (parent.children ??= []).push(node);
    else roots.push(node);
  }
  return [
    {
      id: 'all',
      label: '/Assets',
      icon: 'FolderTree',
      children: [
        {
          id: 'virt:imports',
          label: '/Imports',
          icon: 'FolderInput',
          children: [
            { id: 'virt:models', label: 'Models', icon: 'Box' },
            { id: 'virt:textures', label: 'Textures', icon: 'Image' },
            { id: 'virt:audio', label: 'Audio', icon: 'Volume2' },
          ],
        },
        ...roots,
      ],
    },
  ];
}

export function explorerFileById(id: string): ExplorerFile | null {
  return explorerIndex().files.find((file) => file.id === id) ?? null;
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
  return visit(explorerIndex().folders)?.label ?? (folder.startsWith('dir:') ? folder.slice(4) : folder);
}

export function explorerFileIcon(file: ExplorerFile): string {
  if (file.category === 'model') return 'Box';
  if (file.category === 'texture') return 'Image';
  if (file.category === 'audio') return 'Volume2';
  if (file.kind === 'map') return 'Map';
  if (file.kind === 'md') return 'BookOpen';
  return 'FileJson';
}

export function explorerMatchesFolder(file: ExplorerFile, folder: ExplorerFolderId): boolean {
  if (folder === 'all') return true;
  if (folder === 'virt:imports') return file.category === 'model' || file.category === 'texture' || file.category === 'audio';
  if (folder === 'virt:models') return file.category === 'model';
  if (folder === 'virt:textures') return file.category === 'texture';
  if (folder === 'virt:audio') return file.category === 'audio';
  if (folder.startsWith('dir:')) {
    const dir = folder.slice(4);
    return file.path === dir || file.path.startsWith(`${dir}/`);
  }
  return file.folder === folder;
}

export function explorerSearchText(file: ExplorerFile): string {
  return [file.name, file.path, file.kind, file.category].join(' ').toLowerCase();
}

/** The 'at' stamp for history entries — a real clock, not a fabricated "Nm ago". */
export function explorerNowLabel(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatAgo(mtimeMs: number): string {
  const delta = Date.now() - mtimeMs;
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
}
