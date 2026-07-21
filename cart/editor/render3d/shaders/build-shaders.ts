// shaders/build-shaders.ts — the folder sweep. Reads materials/*.wgsl, parses
// each self-describing header, and generates _generated/registry.ts +
// _generated/dispatch.ts. This is the ONLY place that ever needs to run when a
// material is added or deleted — no other file is touched.
//
// The editor owns this generator and its materials/ sources. PALETTE SLOTS:
// every
// color-looking vec3f literal in a material fn is extracted as a named slot
// (registry metadata) and rewritten to mat_pal(slot, baked) in the emitted
// dispatch, so D[5]=count, D[6+i*3..]=RGB overrides recolor the material with
// zero data → pixel-identical baked output.
//
// Runs via: tools/v8cli cart/editor/render3d/shaders/build-shaders.ts
//
// Stable ids: _generated/ids.json is an append-only table of {fn, board, index}.
// A material already in the table keeps its (board, index) forever, even across
// regens. A new material gets the next free index within its board. Deleting a
// material's .wgsl file leaves its id table entry in place (tombstoned) — it is
// simply never dispatched again. Ids are NEVER renumbered or reclaimed, so a
// deletion can never shift another material's D[0]/D[4].

function die(msg) {
  __writeStderr('[build-shaders] ' + msg + '\n');
  __exit(1);
}

const ROOT = __cwd();
const SHADERS_DIR = ROOT + '/cart/editor/render3d/shaders';
const MATERIALS_DIR = SHADERS_DIR + '/materials';
const GENERATED_DIR = SHADERS_DIR + '/_generated';
const IDS_PATH = GENERATED_DIR + '/ids.json';
const HELPERS_PATH = SHADERS_DIR + '/helpers.wgsl';
const BOARDS_PATH = SHADERS_DIR + '/boards.ts';

function statParse(raw) {
  if (raw === null) return null;
  try {
    const st = JSON.parse(raw);
    if (!st || typeof st !== 'object') return null;
    const isDir = typeof st.isDir === 'boolean' ? st.isDir
      : typeof st.is_dir === 'boolean' ? st.is_dir
      : typeof st.is_file === 'boolean' ? !st.is_file
      : false;
    return { isDir };
  } catch {
    return null;
  }
}

function listWgslFiles(dir) {
  const raw = __fs_list_json(dir);
  if (raw === null) die('cannot list ' + dir);
  let entries;
  try {
    entries = JSON.parse(raw);
  } catch {
    die('bad listing for ' + dir);
    return [];
  }
  return entries
    .filter((name) => name.endsWith('.wgsl'))
    .sort();
}

// ── parse boards.ts's BOARDS array by hand (build-shaders.ts avoids importing
// TS at runtime under v8cli — this is a small, stable, hand-owned literal, so a
// direct text scan is simpler than a TS import here). ──────────────────────
function loadBoards() {
  const src = __fs_read(BOARDS_PATH);
  if (src === null) die('missing ' + BOARDS_PATH);
  const boardRe = /\{ index: (\d+), letter: '(\w)', title: '([^']+)', slug: '(\w+)', seedCoef: \[(\d+), (\d+), (\d+)\] \}/g;
  const boards = [];
  let m;
  while ((m = boardRe.exec(src))) {
    boards.push({
      index: Number(m[1]), letter: m[2], title: m[3], slug: m[4],
      seedCoef: [Number(m[5]), Number(m[6]), Number(m[7])],
    });
  }
  if (boards.length !== 15) die('expected 15 boards in boards.ts, found ' + boards.length);
  return boards;
}

// ── parse one material file's header ────────────────────────────────────────
const HEADER_FIELD_RE = /^\/\/ @([\w-]+) (.*)$/;

function parseMaterial(path, fileName) {
  const src = __fs_read(path);
  if (src === null) die('cannot read ' + path);
  const lines = src.split('\n');
  const fields = {};
  let bodyStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = HEADER_FIELD_RE.exec(line);
    if (m) {
      fields[m[1]] = m[2].trim();
      continue;
    }
    if (line.startsWith('fn ')) { bodyStart = i; break; }
    if (line.trim() === '' || line.startsWith('//')) continue;
    die(fileName + ': unexpected line before fn declaration: ' + line);
  }
  if (bodyStart === -1) die(fileName + ': no `fn <name>(...)` found');
  const required = ['material', 'slug', 'name', 'board', 'variant-labels', 'kind', 'tags', 'author'];
  for (const key of required) {
    if (!(key in fields)) die(fileName + ': missing header field @' + key);
  }
  const fn = fields['material'];
  const expectedFile = fn + '.wgsl';
  if (fileName !== expectedFile) die(fileName + ': filename must match @material (' + expectedFile + ')');
  if (!src.includes('fn ' + fn + '(')) die(fileName + ': @material ' + fn + ' does not match its own fn declaration');
  const variantLabels = fields['variant-labels'].split(',').map((s) => s.trim()).filter(Boolean);
  if (variantLabels.length < 1) die(fileName + ': @variant-labels must list at least one take');
  const kind = fields['kind'];
  if (kind !== 'surface' && kind !== 'composition' && kind !== 'gradient') {
    die(fileName + ': @kind must be surface | composition | gradient, got ' + kind);
  }
  const tags = fields['tags'].split(',').map((s) => s.trim()).filter(Boolean);
  const body = lines.slice(bodyStart).join('\n').replace(/\n+$/, '');
  return {
    fn, slug: fields['slug'], name: fields['name'], boardSlug: fields['board'],
    variantLabels, kind, tags, author: fields['author'], raw: src.replace(/\n+$/, ''), body,
  };
}

// ── load / update the stable id table ───────────────────────────────────────
function loadIds() {
  if (!__fs_exists(IDS_PATH)) return [];
  const raw = __fs_read(IDS_PATH);
  try {
    return JSON.parse(raw);
  } catch {
    die('corrupt ids.json');
    return [];
  }
}

function assignIds(materials, existingIds) {
  const byFn = new Map(existingIds.map((e) => [e.fn, e]));
  const usedIndexByBoard = new Map(); // boardIndex -> Set(index) — INCLUDES tombstones
  for (const e of existingIds) {
    if (!usedIndexByBoard.has(e.board)) usedIndexByBoard.set(e.board, new Set());
    usedIndexByBoard.get(e.board).add(e.index);
  }
  const out = [...existingIds];
  const resolved = [];
  for (const m of materials) {
    let entry = byFn.get(m.fn);
    if (!entry) {
      const used = usedIndexByBoard.get(m.boardIndex) ?? new Set();
      let idx = 0;
      while (used.has(idx)) idx++;
      used.add(idx);
      usedIndexByBoard.set(m.boardIndex, used);
      entry = { fn: m.fn, board: m.boardIndex, index: idx };
      out.push(entry);
      byFn.set(m.fn, entry);
      __writeStderr('[build-shaders] new material "' + m.fn + '" -> board ' + m.boardIndex + ' index ' + idx + '\n');
    } else if (entry.board !== m.boardIndex) {
      die(m.fn + ': board changed from ' + entry.board + ' to ' + m.boardIndex + ' — moving a material between boards is not supported (its id is keyed by original board; delete + re-add as a new material if this is intentional)');
    }
    resolved.push({ ...m, materialId: entry.index });
  }
  return { resolved, table: out };
}

// ── palette-slot extraction (the editor's addition) ─────────────────────────
// Every color-looking vec3f LITERAL in a material body becomes a palette slot:
// recorded in the registry (name + baked RGB) and rewritten in the emitted
// dispatch to mat_pal(slot, vec3f(baked)) so a D[]-carried palette can override
// it. "Color-looking" = three numeric components all in [0,1], excluding pure
// all-0/all-1 triples (those are clamp bounds / axis vectors, not paint).
// Variant-specific literals simply become separate slots — only the selected
// variant's code path reads them, so per-variant palettes fall out for free.
const VEC3_LIT_RE = /vec3f\(\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*\)/g;

function isColorTriple(r, g, b) {
  const inRange = (v) => v >= 0 && v <= 1;
  if (!inRange(r) || !inRange(g) || !inRange(b)) return false;
  const all = (v) => r === v && g === v && b === v;
  return !all(0) && !all(1);
}

function prettifyIdent(ident) {
  return ident.replace(/_/g, ' ').replace(/\bcol\b/g, 'color').trim() || 'color';
}

// Human name for one slot from its line context. These names are what a
// non-coder reads in the palette panel, so spend effort here:
//   1. Accumulation mix — `x = mix(x, LIT, rot * 0.78)` — the FACTOR carries
//      the layer's meaning: name it "rot".
//   2. Otherwise the nearest assignment target left of the literal
//      ("let paint =", "paint =", including inside an if-block).
//   3. Fallback "color".
function slotNameAt(code, litPos, litText) {
  const acc = /(\w+)\s*=\s*mix\(\s*\1\b/.exec(code);
  if (acc) {
    const tail = code.slice(litPos + litText.length);
    const tm = /^\s*,\s*([A-Za-z_]\w*)/.exec(tail);
    if (tm) return prettifyIdent(tm[1]);
  }
  let best = null;
  const assignRe = /(?:let\s+|var\s+)?([A-Za-z_]\w*)\s*=(?!=)/g;
  let am;
  while ((am = assignRe.exec(code))) {
    if (am.index >= litPos) break;
    best = am[1];
  }
  return best ? prettifyIdent(best) : 'color';
}

function dedupSlotName(name, taken) {
  let candidate = name;
  let n = 2;
  while (taken.has(candidate)) candidate = name + ' ' + n++;
  taken.add(candidate);
  return candidate;
}

// Rewrite one material's raw source; returns { rewritten, slots }.
function extractSlots(raw) {
  const slots = [];
  const taken = new Set();
  const outLines = raw.split('\n').map((line) => {
    const commentAt = line.indexOf('//');
    const code = commentAt === -1 ? line : line.slice(0, commentAt);
    const comment = commentAt === -1 ? '' : line.slice(commentAt);
    // Collect this line's color literals first so a dual-literal mix() can name low/high.
    const found = [];
    let m;
    VEC3_LIT_RE.lastIndex = 0;
    while ((m = VEC3_LIT_RE.exec(code))) {
      const rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (isColorTriple(rgb[0], rgb[1], rgb[2])) found.push({ text: m[0], rgb, pos: m.index });
    }
    if (found.length === 0) return line;
    // Two literals inside one mix() = the shade/lift pair idiom → low/high.
    const isMixPair = found.length === 2 && code.includes('mix(');
    let newCode = code;
    let drift = 0; // literal positions shift as mat_pal( wrappers land ahead of them
    found.forEach((lit, i) => {
      const base = slotNameAt(code, lit.pos, lit.text);
      const name = dedupSlotName(isMixPair ? base + (i === 0 ? ' low' : ' high') : base, taken);
      const slotIndex = slots.length;
      slots.push({ name, rgb: lit.rgb });
      const at = lit.pos + drift;
      newCode = newCode.slice(0, at) + 'mat_pal(' + slotIndex + ', ' + lit.text + ')' + newCode.slice(at + lit.text.length);
      drift += ('mat_pal(' + slotIndex + ', ' + ')').length;
    });
    return newCode + comment;
  });
  return { rewritten: outLines.join('\n'), slots };
}

// The generated palette reader — lives in the emitted dispatch (not the
// hand-owned helpers.wgsl): the D[] palette section is this generator's
// contract. D[0..4] stay [materialId, variant, seed, quality, board];
// D[5] = provided slot count; D[6 + i*3 ..] = slot i RGB. With no palette
// (5-float data, count 0, or i beyond count) the baked constant returns —
// pixel-identical to pre-slot output.
//
// A private base keeps the same material functions reusable inside a packed
// grid Effect. Ordinary single-material fills leave it at zero; the grid entry
// selects one row before calling fill_pick(). Private storage is per fragment
// invocation, so neighboring thumbnail pixels cannot leak row selection.
const MAT_PAL_WGSL = `
var<private> mat_data_base: u32 = 0u;

fn mat_pal(i: i32, baked: vec3f) -> vec3f {
  if (arrayLength(&D) < mat_data_base + 7u) { return baked; }
  let n = i32(D[mat_data_base + 5u] + 0.5);
  if (i >= n) { return baked; }
  let base = mat_data_base + u32(6 + i * 3);
  if (arrayLength(&D) < base + 3u) { return baked; }
  return vec3f(D[base], D[base + 1u], D[base + 2u]);
}
`;

// ── main ─────────────────────────────────────────────────────────────────
const boards = loadBoards();
const boardBySlug = new Map(boards.map((b) => [b.slug, b]));

const files = listWgslFiles(MATERIALS_DIR);
if (files.length === 0) die('no materials found in ' + MATERIALS_DIR);

const materials = files.map((fileName) => {
  const m = parseMaterial(MATERIALS_DIR + '/' + fileName, fileName);
  const board = boardBySlug.get(m.boardSlug);
  if (!board) die(fileName + ': unknown @board "' + m.boardSlug + '" — not in boards.ts BOARD_SLUGS. Propose a new board there first, or fix the typo.');
  const ex = extractSlots(m.raw);
  return { ...m, boardIndex: board.index, rewritten: ex.rewritten, slots: ex.slots };
});

const existingIds = loadIds();
const { resolved, table } = assignIds(materials, existingIds);
table.sort((a, b) => a.board - b.board || a.index - b.index);
if (!__fs_write(IDS_PATH, JSON.stringify(table, null, 2) + '\n')) die('failed to write ' + IDS_PATH);

// group by board, ordered by materialId, for both registry + dispatch
const byBoard = new Map();
for (const m of resolved) {
  if (!byBoard.has(m.boardIndex)) byBoard.set(m.boardIndex, []);
  byBoard.get(m.boardIndex).push(m);
}
for (const list of byBoard.values()) list.sort((a, b) => a.materialId - b.materialId);

// ── registry.ts ──────────────────────────────────────────────────────────
function tsStringArray(arr) {
  return '[' + arr.map((s) => JSON.stringify(s)).join(', ') + ']';
}

let registryOut = '';
registryOut += '// _generated/registry.ts — GENERATED by build-shaders.ts. Do not hand-edit.\n';
registryOut += '// Run: tools/v8cli cart/editor/render3d/shaders/build-shaders.ts\n';
registryOut += "export type MaterialKind = 'surface' | 'composition' | 'gradient';\n\n";
registryOut += 'export type MaterialSlot = { name: string; rgb: [number, number, number] };\n\n';
registryOut += 'export type RegistryMaterial = {\n';
registryOut += '  fn: string;\n  slug: string;\n  name: string;\n  board: string;\n  boardIndex: number;\n  materialId: number;\n  variantLabels: string[];\n  kind: MaterialKind;\n  tags: string[];\n  author: string;\n';
registryOut += '  // Palette slots: the baked vec3f constants extracted from the material fn,\n';
registryOut += '  // in mat_pal() index order. D[5]=count, D[6+i*3..]=RGB overrides them.\n';
registryOut += '  slots: MaterialSlot[];\n};\n\n';
registryOut += 'export const MATERIALS: RegistryMaterial[] = [\n';
for (const boardIdx of [...byBoard.keys()].sort((a, b) => a - b)) {
  for (const m of byBoard.get(boardIdx)) {
    const slotsTs = '[' + m.slots.map((s) => '{ name: ' + JSON.stringify(s.name) + ', rgb: [' + s.rgb.join(', ') + '] }').join(', ') + ']';
    registryOut += '  { fn: ' + JSON.stringify(m.fn) + ', slug: ' + JSON.stringify(m.slug) + ', name: ' + JSON.stringify(m.name)
      + ', board: ' + JSON.stringify(m.boardSlug) + ', boardIndex: ' + m.boardIndex + ', materialId: ' + m.materialId
      + ', variantLabels: ' + tsStringArray(m.variantLabels) + ', kind: ' + JSON.stringify(m.kind)
      + ', tags: ' + tsStringArray(m.tags) + ', author: ' + JSON.stringify(m.author)
      + ',\n    slots: ' + slotsTs + ' },\n';
  }
}
registryOut += '];\n\n';

// FILL_BOARDS-shaped view — drop-in for shaders.ts's old hand-written table.
registryOut += 'export type FillMaterial = { slug: string; name: string; variants: [string, string, string] };\n';
registryOut += 'export type FillBoard = { board: number; letter: string; title: string; seedCoef: [number, number, number]; materials: FillMaterial[] };\n\n';
registryOut += 'export const FILL_BOARDS: FillBoard[] = [\n';
for (const b of boards) {
  const mats = byBoard.get(b.index) ?? [];
  registryOut += '  { board: ' + b.index + ', letter: ' + JSON.stringify(b.letter) + ', title: ' + JSON.stringify(b.title)
    + ', seedCoef: [' + b.seedCoef.join(', ') + '], materials: [\n';
  for (const m of mats) {
    const [v0, v1, v2] = m.variantLabels.length === 3 ? m.variantLabels : [m.variantLabels[0] ?? '', m.variantLabels[1] ?? m.variantLabels[0] ?? '', m.variantLabels[2] ?? m.variantLabels[0] ?? ''];
    registryOut += '    { slug: ' + JSON.stringify(m.slug) + ', name: ' + JSON.stringify(m.name) + ', variants: [' + JSON.stringify(v0) + ', ' + JSON.stringify(v1) + ', ' + JSON.stringify(v2) + '] },\n';
  }
  registryOut += '  ] },\n';
}
registryOut += '];\n';

if (!__fs_write(GENERATED_DIR + '/registry.ts', registryOut)) die('failed to write registry.ts');

// ── dispatch.ts ──────────────────────────────────────────────────────────
const helpersSrc = __fs_read(HELPERS_PATH);
if (helpersSrc === null) die('missing ' + HELPERS_PATH);

let dispatchFn = 'fn fill_pick(material: i32, board: f32, uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {\n';
dispatchFn += '  var col = vec3f(0.0, 0.0, 0.0);\n';
const boardIdxs = [...byBoard.keys()].sort((a, b) => a - b);
boardIdxs.forEach((boardIdx, bi) => {
  const mats = byBoard.get(boardIdx);
  const head = bi === 0 ? '  if (board < ' + (boardIdx + 0.5) + ') {\n' : '  } else if (board < ' + (boardIdx + 0.5) + ') {\n';
  const isLast = bi === boardIdxs.length - 1;
  dispatchFn += isLast ? '  } else {\n' : head;
  mats.forEach((m, mi) => {
    const cond = mi === 0 ? '    if (material == ' + m.materialId + ') { col = ' + m.fn + '(uv, px, variant, seed); }\n'
      : mi === mats.length - 1 ? '    else { col = ' + m.fn + '(uv, px, variant, seed); }\n'
      : '    else if (material == ' + m.materialId + ') { col = ' + m.fn + '(uv, px, variant, seed); }\n';
    dispatchFn += cond;
  });
});
dispatchFn += '  }\n  return col;\n}\n';

// Emit the slot-rewritten bodies — the .wgsl SOURCES stay pristine; mat_pal
// injection is a generation-time transform only.
const materialBodies = boardIdxs.map((boardIdx) => byBoard.get(boardIdx).map((m) => m.rewritten).join('\n\n')).join('\n\n');

let dispatchOut = '// _generated/dispatch.ts — GENERATED by build-shaders.ts. Do not hand-edit.\n';
dispatchOut += '// Run: tools/v8cli cart/editor/render3d/shaders/build-shaders.ts\n';
dispatchOut += 'export const FILL_FUNCS = `\n';
dispatchOut += helpersSrc.replace(/\n+$/, '');
dispatchOut += '\n';
dispatchOut += MAT_PAL_WGSL;
dispatchOut += '\n';
dispatchOut += materialBodies;
dispatchOut += '\n\n';
dispatchOut += dispatchFn;
dispatchOut += '`;\n';

if (!__fs_write(GENERATED_DIR + '/dispatch.ts', dispatchOut)) die('failed to write dispatch.ts');

__writeStderr('[build-shaders] ' + materials.length + ' materials across ' + boards.length + ' boards -> registry.ts + dispatch.ts\n');
