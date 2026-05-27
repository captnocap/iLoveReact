// scripts/gallery-suspects.js — flag gallery entries that are NOT components.
//
// A "component" should do one thing: render one shape. A dashboard, page,
// montage, wall, mock, demo, or comparison view dressed up as a single gallery
// entry breaks that contract — and they're the things that fight the gallery's
// presentation layer because they were never sized like atoms in the first place.
//
// This scan walks cart/app/gallery/components/<name>/, applies a handful of
// "smells like a dashboard" heuristics to each dir, and ranks the worst.
//
// Run:  ./tools/v8cli scripts/gallery-suspects.js

const COMPONENTS_DIR = 'cart/app/gallery/components';

// ──────────────────────────────────────────────────────────────────────────
// Host wrappers
// ──────────────────────────────────────────────────────────────────────────

function listDir(p) {
  let raw;
  try { raw = __fs_list_json(p); } catch { return []; }
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { const x = JSON.parse(raw); if (Array.isArray(x)) return x; } catch {}
  return [];
}
function statOf(p) {
  let raw;
  try { raw = __fs_stat_json(p); } catch { return null; }
  if (!raw) return null;
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return null; } }
  return raw;
}
function isDirAt(p) {
  const s = statOf(p); if (!s) return false;
  return !!(s.isDir || s.is_dir || s.type === 'dir');
}
function readText(p) { try { return __fs_read(p); } catch { return null; } }

function walkFiles(dir, out = []) {
  for (const n of listDir(dir)) {
    if (!n || n.startsWith('.')) continue;
    const full = `${dir}/${n}`;
    if (isDirAt(full)) walkFiles(full, out);
    else if (n.endsWith('.tsx') || n.endsWith('.ts')) out.push(full);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Heuristics
// ──────────────────────────────────────────────────────────────────────────

// Keywords that almost always mean "this is a screen / montage / app shell"
// rather than an atomic component.
const SUSPECT_NAMES = [
  'dashboard', 'wall', 'shell', 'mock', 'demo', 'page', 'viewer', 'hub',
  'gallery', 'board', 'system', 'suite', 'workspace', 'composer-panel',
  'editor', 'matrix', 'specimen', 'catalog', 'panel',
];
// Names that are explicitly OK even though they include suspect words
// (e.g. `command-composer-panel` is genuinely a single panel, not a montage).
// Keep this list short — when in doubt, keep the flag.
const ALLOW = new Set([
  'rubric-panel',
  'layer-control-panel',
  'task-panel',
  'command-composer-panel',
]);

function nameSmells(name) {
  if (ALLOW.has(name)) return [];
  const hits = [];
  for (const kw of SUSPECT_NAMES) {
    if (name.includes(kw)) hits.push(kw);
  }
  return hits;
}

function countMatches(src, re) {
  let c = 0; let m;
  while ((m = re.exec(src)) !== null) c++;
  return c;
}

// PascalCase top-level component-shaped exports (function or arrow const).
function countExportedComponents(src) {
  return (
    countMatches(src, /\bexport\s+function\s+[A-Z]\w*\s*\(/g) +
    countMatches(src, /\bexport\s+const\s+[A-Z]\w*\s*[:=]\s*(?:\([^)]*\)|[A-Z]\w*)\s*(?:=>|;|$)/gm)
  );
}

// Top-level constants whose name screams "I configure a whole system".
function configHeaviness(src) {
  const tags = [];
  if (/DEFAULT_[A-Z_]+_THEME/.test(src)) tags.push('default-theme-const');
  if (/\bresolve[A-Z]\w*Theme\s*\(/.test(src)) tags.push('theme-resolver');
  if (/\bPANEL_SIZES\s*=/.test(src)) tags.push('panel-sizes');
  if (/\bCASCADE_SIZES\s*=/.test(src)) tags.push('cascade-sizes');
  if (/\bMAIN_STAGE_SIZE\s*=/.test(src)) tags.push('stage-size');
  return tags;
}

function simulationHeaviness(src) {
  const tags = [];
  if (/setInterval\s*\(/.test(src)) tags.push('setInterval');
  if (/requestAnimationFrame\s*\(/.test(src)) tags.push('raf');
  // setTimeout is too common to flag; only flag chained / interval-style use
  if (/setTimeout\([^)]*\)\s*[,;]\s*[\s\S]{0,200}setTimeout/.test(src)) tags.push('chained-setTimeout');
  if (/Uint8Array\s*\(/.test(src) && /useRef\s*\(/.test(src)) tags.push('typed-array-state');
  return tags;
}

// ──────────────────────────────────────────────────────────────────────────
// Walk + score
// ──────────────────────────────────────────────────────────────────────────

const dirs = listDir(COMPONENTS_DIR)
  .filter((n) => n && !n.startsWith('.') && isDirAt(`${COMPONENTS_DIR}/${n}`))
  .sort();

const verdicts = [];
for (const dir of dirs) {
  const dirPath = `${COMPONENTS_DIR}/${dir}`;
  const files = walkFiles(dirPath);
  const tsx = files.filter((f) => f.endsWith('.tsx'));
  let totalLoc = 0;
  let exportedComponents = 0;
  const cfgTags = new Set();
  const simTags = new Set();
  for (const f of files) {
    const src = readText(f) || '';
    totalLoc += src.split('\n').length;
    if (f.endsWith('.tsx')) {
      exportedComponents += countExportedComponents(src);
    }
    for (const t of configHeaviness(src)) cfgTags.add(t);
    for (const t of simulationHeaviness(src)) simTags.add(t);
  }

  const reasons = [];
  let score = 0;

  const nameHits = nameSmells(dir);
  if (nameHits.length) { score += 3 * nameHits.length; reasons.push(`name:${nameHits.join('+')}`); }
  if (totalLoc > 800) { score += 4; reasons.push(`loc=${totalLoc}`); }
  else if (totalLoc > 500) { score += 2; reasons.push(`loc=${totalLoc}`); }
  else if (totalLoc > 300) { score += 1; reasons.push(`loc=${totalLoc}`); }
  if (exportedComponents > 4) { score += 3; reasons.push(`exports=${exportedComponents}`); }
  else if (exportedComponents > 2) { score += 1; reasons.push(`exports=${exportedComponents}`); }
  if (tsx.length > 4) { score += 2; reasons.push(`files=${tsx.length}`); }
  else if (tsx.length > 2) { score += 1; reasons.push(`files=${tsx.length}`); }
  if (cfgTags.size) { score += 2; reasons.push(`config:${[...cfgTags].join(',')}`); }
  if (simTags.size) { score += 1; reasons.push(`sim:${[...simTags].join(',')}`); }

  if (score >= 3) verdicts.push({ dir, score, reasons, totalLoc, exports: exportedComponents, tsx: tsx.length });
}

verdicts.sort((a, b) => b.score - a.score);

// ──────────────────────────────────────────────────────────────────────────
// Output
// ──────────────────────────────────────────────────────────────────────────

__writeStdout(`gallery suspects — ${verdicts.length} of ${dirs.length} entries flagged\n`);
__writeStdout(`(scored on: name, total LOC, # exported components, # files, theme/sim heaviness)\n`);
__writeStdout(''.padEnd(78, '─') + '\n');
const nameW = Math.max(20, ...verdicts.map((v) => v.dir.length));
for (const v of verdicts) {
  __writeStdout(
    `${String(v.score).padStart(2)}  ${v.dir.padEnd(nameW + 2)}${v.reasons.join('  ')}\n`
  );
}

__writeStdout(`\nlikely-real components (score 0..2): ${dirs.length - verdicts.length}\n`);
__exit(0);
