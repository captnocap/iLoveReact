// editors/characters/gridData.ts — the MATRIX DATA DOOR (MESHSMOOTH-0606):
// the per-part deformation grid as data the user (and AI lanes) edit by hand.
//
// The user's ask, verbatim: "if we get the matrix data we can use it to edit
// by hand and get a few samples". So: a readable file form of the 48×24
// signed grid (one row per line — hand-editable in any editor), exact
// round-trip back onto the part, and NAMED SAMPLES — shaped grids saved as
// snapshots to study, hand-round, and reapply.
//
// Storage: cart/hmsc-int/sessions/sculpt-grids/ — the workspace's disk-only
// family (sessions/ is gitignored BY DESIGN; disk = truth). V20 by-addition:
// saves never overwrite — a name collision appends -2, -3... A sample file a
// Claude lane is handed can be rounded numerically and saved back; values are
// plain JSON floats, −1..1, row-major north→south, x wraps (longitude).
//
// Pure data + explicit-dir fs (tests run on /tmp) — surfaces own state/UI.

import { HED_GRID_H, HED_GRID_W } from '../../game/figure/hed';
import { REGION_TUNING } from './regions';

declare const __fs_read: (path: string) => string | null;
declare const __fs_write: (path: string, content: string) => boolean;
declare const __fs_exists: (path: string) => boolean;
declare const __fs_list_json: (path: string) => string;

/** the workspace's sample shelf (cwd-relative like every sessions/ path) */
export const SCULPT_GRID_DIR = 'cart/hmsc-int/sessions/sculpt-grids';

export type SculptGridFile = {
  kind: 'sculpt-grid';
  version: 1;
  /** which part family shaped it (informational — any part can wear any grid) */
  part: string;
  cols: number;
  rows: number;
  label: string;
  savedAt: string;
  /** rows[y][x], y north→south, x wraps; signed −1 (carve) .. 1 (raise) */
  values: number[][];
};

export type GridSampleEntry = { name: string; path: string; part: string; label: string; savedAt: string };

/** A flat working grid as the file form. */
export function gridToFile(part: string, grid: number[], label: string): SculptGridFile {
  if (grid.length !== HED_GRID_W * HED_GRID_H) {
    throw new Error(`grid must be ${HED_GRID_W}×${HED_GRID_H} (${HED_GRID_W * HED_GRID_H} cells), got ${grid.length}`);
  }
  const values: number[][] = [];
  for (let y = 0; y < HED_GRID_H; y++) {
    values.push(grid.slice(y * HED_GRID_W, (y + 1) * HED_GRID_W));
  }
  return {
    kind: 'sculpt-grid', version: 1, part,
    cols: HED_GRID_W, rows: HED_GRID_H,
    label, savedAt: new Date().toISOString(), values,
  };
}

/** The file form back to the flat working grid — validated at the boundary,
 *  cells clamped to the signed range (a hand-typed 1.3 lands as 1). */
export function fileToGrid(file: SculptGridFile): number[] {
  if (file.kind !== 'sculpt-grid') throw new Error(`not a sculpt-grid file (kind: ${JSON.stringify((file as any).kind)})`);
  if (file.cols !== HED_GRID_W || file.rows !== HED_GRID_H) {
    throw new Error(`grid is ${file.cols}×${file.rows}; this build sculpts ${HED_GRID_W}×${HED_GRID_H}`);
  }
  if (!Array.isArray(file.values) || file.values.length !== file.rows) {
    throw new Error(`values must be ${file.rows} rows, got ${Array.isArray(file.values) ? file.values.length : typeof file.values}`);
  }
  const out: number[] = [];
  for (let y = 0; y < file.rows; y++) {
    const row = file.values[y];
    if (!Array.isArray(row) || row.length !== file.cols) throw new Error(`row ${y} must be ${file.cols} numbers, got ${Array.isArray(row) ? row.length : typeof row}`);
    for (let x = 0; x < file.cols; x++) {
      const v = row[x];
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`row ${y} col ${x}: not a finite number`);
      out.push(Math.max(REGION_TUNING.clamp.min, Math.min(REGION_TUNING.clamp.max, v)));
    }
  }
  return out;
}

/** One row per line — the hand-editing format. JSON-parseable as-is, and
 *  numbers serialize at full double precision, so round-trip is EXACT. */
export function serializeGridFile(file: SculptGridFile): string {
  const head = `{
  "kind": ${JSON.stringify(file.kind)},
  "version": ${file.version},
  "part": ${JSON.stringify(file.part)},
  "cols": ${file.cols},
  "rows": ${file.rows},
  "label": ${JSON.stringify(file.label)},
  "savedAt": ${JSON.stringify(file.savedAt)},
  "values": [`;
  const rows = file.values.map((row) => `    [${row.map((v) => JSON.stringify(v)).join(',')}]`).join(',\n');
  return `${head}\n${rows}\n  ]\n}\n`;
}

export function parseGridFile(text: string): SculptGridFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('not valid JSON — check for a missing comma/bracket from the hand edit');
  }
  const file = parsed as SculptGridFile;
  fileToGrid(file); // shape validation happens here; throws with the honest reason
  return file;
}

// ── the sample shelf ──────────────────────────────────────────────────────────

function slug(label: string): string {
  const s = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.length > 0 ? s : 'sample';
}

/** Save as a named sample — additive: an existing name gets -2, -3… */
export function saveGridSample(file: SculptGridFile, dir: string = SCULPT_GRID_DIR): { name: string; path: string } {
  const base = slug(`${file.label}`);
  let name = base;
  for (let n = 2; __fs_exists(`${dir}/${name}.grid.json`); n++) name = `${base}-${n}`;
  const path = `${dir}/${name}.grid.json`;
  if (!__fs_write(path, serializeGridFile(file))) throw new Error(`failed to write ${path}`);
  return { name, path };
}

export function listGridSamples(dir: string = SCULPT_GRID_DIR): GridSampleEntry[] {
  const names: string[] = JSON.parse(__fs_list_json(dir));
  const out: GridSampleEntry[] = [];
  for (const fileName of names.sort()) {
    if (!fileName.endsWith('.grid.json')) continue;
    const path = `${dir}/${fileName}`;
    try {
      const file = parseGridFile(__fs_read(path) ?? '');
      out.push({ name: fileName.slice(0, -'.grid.json'.length), path, part: file.part, label: file.label, savedAt: file.savedAt });
    } catch {
      // an unreadable sample stays listed nowhere but never breaks the shelf;
      // readGridSample on it reports the honest parse error
    }
  }
  return out;
}

export function readGridSample(name: string, dir: string = SCULPT_GRID_DIR): SculptGridFile {
  const path = `${dir}/${name}.grid.json`;
  const text = __fs_read(path);
  if (text === null) throw new Error(`no such sample: ${path}`);
  return parseGridFile(text);
}
