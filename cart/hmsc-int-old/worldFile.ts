// The world is a real .tsx file on disk — the single source of truth. The editor
// READS it to show what's placed and WRITES it on every place/move/edit. The AI
// generates asset COMPONENTS (Scene3D-emitting .tsx); the world file IMPORTS them
// and INSTANTIATES one per placement at an address. React is the authoring
// language; ship transpiles this file to baked Zig (the static world the host
// draws directly — no reconciler at game runtime). See the
// hmsc_world_authoring_rebuild + feedback_react_3d_is_authoring_not_runtime memos.
//
// This module owns the FORMAT: the in-memory Placement model and the
// serialize/parse between it and the .tsx text. It writes via @reactjit/hooks fs
// (carts can write files; hmsc-int declares bindings:['fs']). It does NOT render
// or evaluate React — that's the editor (live preview) and the flatten pass
// (sidecar). Keeping this pure text<->model means the file stays hand-editable.

import { readFile, writeFile, exists, mkdir } from '@reactjit/hooks/fs';
import { cellAddress, parseAddress } from './address';

// One placed asset: a component instantiated at a grid address with a rotation.
// `asset` is the imported component's name (e.g. 'ParkingGarage'); `props` are
// any extra literal attributes the asset accepts (size overrides, skin, tint).
// Position is authored as a spreadsheet address (GJ82) in the .tsx for human
// readability; col/row are the integer truth the editor + bake use.
export type Placement = {
  id: string;
  asset: string;
  col: number;
  row: number;
  rot: 0 | 90 | 180 | 270;
  props: Record<string, string | number | boolean>;
};

// An import the world file needs: the asset component and where it lives. The
// editor adds one when a new asset kind is first placed; the file lists them at
// the top so both humans and the bake transpiler resolve every <Asset/> tag.
export type AssetImport = {
  name: string;     // 'ParkingGarage'
  from: string;     // './assets/ParkingGarage' (relative to the world file)
};

export type WorldDoc = {
  imports: AssetImport[];
  placements: Placement[];
};

// Where a cart's authored world + its asset library live. One world file per
// cart, assets beside it. The flatten sidecar is generated next to the world.
export function worldFilePath(cartDir: string): string {
  return `${cartDir}/world/authoredWorld.tsx`;
}
export function assetsDir(cartDir: string): string {
  return `${cartDir}/world/assets`;
}
export function flatSidecarPath(cartDir: string): string {
  return `${cartDir}/world/authoredWorld.flat.ts`;
}

// ── Serialize: WorldDoc -> .tsx text ────────────────────────────────────────
//
// The emitted file is plain, diff-friendly TSX: import lines, then a default-
// exported <World> composition of <Asset/> placements, one per line, addressed
// by the spreadsheet label. Attribute order is stable (asset, at, rot, then
// sorted extra props) so re-saving an unchanged world is a no-op diff.

function serializeProps(props: Record<string, string | number | boolean>): string {
  const keys = Object.keys(props).sort();
  let out = '';
  for (const k of keys) {
    const v = props[k];
    if (typeof v === 'string') out += ` ${k}=${JSON.stringify(v)}`;
    else if (typeof v === 'boolean') out += v ? ` ${k}` : '';
    else out += ` ${k}={${v}}`;
  }
  return out;
}

export function serializeWorld(doc: WorldDoc): string {
  const lines: string[] = [
    '// authoredWorld.tsx — GENERATED + hand-editable. The hmsc world, as React.',
    '// Each <Asset at="GJ82" .../> is one placement. The editor rewrites this file',
    '// on every edit; ship transpiles it to baked Zig. Edit by hand if you like —',
    '// re-open it in hmsc-int to regenerate the flatten sidecar.',
    '',
  ];
  // Stable import order: by component name.
  for (const imp of [...doc.imports].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`import { ${imp.name} } from ${JSON.stringify(imp.from)};`);
  }
  lines.push('');
  lines.push('export default function World() {');
  lines.push('  return (');
  lines.push('    <world>');
  // Placements in reading order: row-major by (row, col), so the file reads like
  // a map scan and a moved asset lands near its neighbours in the diff.
  const ordered = [...doc.placements].sort((a, b) => (a.row - b.row) || (a.col - b.col));
  for (const p of ordered) {
    const at = cellAddress(p.col, p.row);
    const rot = p.rot ? ` rot={${p.rot}}` : '';
    lines.push(`      <${p.asset} key=${JSON.stringify(p.id)} at=${JSON.stringify(at)}${rot}${serializeProps(p.props)} />`);
  }
  lines.push('    </world>');
  lines.push('  );');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ── Parse: .tsx text -> WorldDoc ────────────────────────────────────────────
//
// A deliberately small line-oriented reader for the canonical shape serializeWorld
// emits (it is the writer's inverse, not a general TSX parser). It recovers the
// import list and each <Asset at=... rot=... ...props /> placement so the editor
// can re-open a world it (or a careful hand-edit) wrote. Anything it can't parse
// is skipped, never guessed — a malformed line drops that placement rather than
// inventing one.

const IMPORT_RE = /^import\s*\{\s*([A-Za-z0-9_]+)\s*\}\s*from\s*["']([^"']+)["']/;
const TAG_RE = /^<([A-Za-z0-9_]+)\s+(.*)\/>$/;

function parseAttrs(s: string): Record<string, string | number | boolean> {
  const attrs: Record<string, string | number | boolean> = {};
  // key="str" | key={num} | key (boolean true)
  const re = /([A-Za-z0-9_]+)(?:=(?:"([^"]*)"|\{([^}]*)\}))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const key = m[1];
    if (m[2] !== undefined) attrs[key] = m[2];
    else if (m[3] !== undefined) {
      const n = Number(m[3]);
      attrs[key] = Number.isFinite(n) ? n : (m[3] === 'true' ? true : m[3] === 'false' ? false : m[3]);
    } else attrs[key] = true;
  }
  return attrs;
}

export function parseWorld(text: string): WorldDoc {
  const imports: AssetImport[] = [];
  const placements: Placement[] = [];
  let autoId = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const imp = IMPORT_RE.exec(line);
    if (imp) { imports.push({ name: imp[1], from: imp[2] }); continue; }
    const tag = TAG_RE.exec(line);
    if (!tag) continue;
    const asset = tag[1];
    if (asset === 'world' || asset === 'World') continue;
    const attrs = parseAttrs(tag[2]);
    const at = typeof attrs.at === 'string' ? parseAddress(attrs.at) : null;
    if (!at) continue; // a placement with no resolvable address is dropped, not guessed
    const { at: _at, rot: _rot, key: _key, ...rest } = attrs;
    const rotNum = typeof _rot === 'number' ? _rot : 0;
    const rot: Placement['rot'] = rotNum === 90 || rotNum === 180 || rotNum === 270 ? rotNum : 0;
    placements.push({
      id: typeof _key === 'string' ? _key : `p${autoId += 1}`,
      asset,
      col: at.x,
      row: at.z,
      rot,
      props: rest,
    });
  }
  return { imports, placements };
}

// ── Disk I/O (the editor's read/write of the source of truth) ───────────────

export function loadWorld(cartDir: string): WorldDoc {
  const path = worldFilePath(cartDir);
  const text = exists(path) ? readFile(path) : null;
  return text ? parseWorld(text) : { imports: [], placements: [] };
}

// Write the world .tsx. Ensures the world/ dir exists first. Returns false if the
// host fs write failed (caller surfaces it; never silently swallow).
export function saveWorld(cartDir: string, doc: WorldDoc): boolean {
  if (!exists(`${cartDir}/world`)) mkdir(`${cartDir}/world`);
  return writeFile(worldFilePath(cartDir), serializeWorld(doc));
}
