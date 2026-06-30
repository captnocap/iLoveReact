// runtime/attribution/ledger.ts — the shared asset-attribution ledger (req_2141/2142).
//
// ONE uniform system for "who made this, under what license, where from" across every
// asset that enters the project — imported models AND hand-made Studio models alike.
// It is deliberately NOT coupled to the model viewer: the viewer records imports here,
// and the Studio will record its hand-made models here too (recordStudioModel), so
// everything is accounted for in one place and exported as credits when due.
//
// An entry is keyed by IDENTITY: a content sha256 for an imported file (so attribution
// follows the bytes through renames/re-downloads), or the model id for a Studio model.
// Status is `pending` until the obligation is satisfied (an import needs an author + a
// license); self-made Studio models are `accounted` by their nature.
import { readFile, writeFile, exists, listDir, mkdir } from '@reactjit/runtime/hooks/fs';

export type AttributionStatus = 'accounted' | 'pending';
export type AttributionKind = 'import' | 'studio';

export interface Attribution {
  id: string; // sha256 (import) | model id (studio)
  kind: AttributionKind;
  title: string;
  author: string;
  source: string; // URL or origin folder
  license: string; // e.g. CC0-1.0, CC-BY-4.0, MIT, Proprietary, Self-made
  file?: string; // original path (imports)
  note?: string; // freeform / a scraped sidecar hint
  createdAt: number; // epoch ms
  status: AttributionStatus;
}

export type Ledger = Record<string, Attribution>;

// The one shared ledger both the viewer and the Studio write to, sitting with the
// game's other asset data so a shipped build can bundle it. Functions accept an
// override, but defaulting here is what keeps the system uniform.
export const DEFAULT_LEDGER_PATH = 'cart/hmsc-int/data/attributions.json';

// Common licenses surfaced as quick-picks. Free text is always allowed too.
export const LICENSES = [
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC-BY-NC-4.0',
  'MIT',
  'Proprietary',
  'Self-made',
] as const;

// An import is satisfied once it credits an author and names a license. Self-made work
// is accounted by definition.
export function deriveStatus(a: Pick<Attribution, 'kind' | 'author' | 'license'>): AttributionStatus {
  if (a.kind === 'studio') return 'accounted';
  return a.author.trim() && a.license.trim() ? 'accounted' : 'pending';
}

export function loadLedger(path: string = DEFAULT_LEDGER_PATH): Ledger {
  const raw = readFile(path);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Ledger) : {};
  } catch {
    return {};
  }
}

export function saveLedger(ledger: Ledger, path: string = DEFAULT_LEDGER_PATH): boolean {
  const slash = path.lastIndexOf('/');
  if (slash > 0) mkdir(path.slice(0, slash));
  return writeFile(path, JSON.stringify(ledger, null, 2));
}

/** Upsert one entry, recomputing its status, and persist. Returns the saved entry. */
export function putEntry(ledger: Ledger, entry: Attribution, path: string = DEFAULT_LEDGER_PATH): Attribution {
  const final = { ...entry, status: deriveStatus(entry) };
  ledger[entry.id] = final;
  saveLedger(ledger, path);
  return final;
}

// ── auto-detect from the file + its folder ───────────────────────────────────────
const LICENSE_HINTS: [RegExp, string][] = [
  [/cc0|public\s*domain/i, 'CC0-1.0'],
  [/\bby[-\s]?sa\b|attribution[-\s]?sharealike/i, 'CC-BY-SA-4.0'],
  [/\bby[-\s]?nc\b|noncommercial/i, 'CC-BY-NC-4.0'],
  [/\bcc[-\s]?by\b|creative\s*commons.*attribution/i, 'CC-BY-4.0'],
  [/\bmit\b/i, 'MIT'],
];

function baseName(path: string): string {
  const n = path.split('/').pop() || path;
  const dot = n.lastIndexOf('.');
  return dot > 0 ? n.slice(0, dot) : n;
}

/** Best-effort attribution scraped from the import path + any sidecar license/readme in
 *  its folder. Never authoritative — it seeds the form so the user only confirms. */
export function detectFromPath(path: string): { title: string; source: string; license: string; note: string } {
  const slash = path.lastIndexOf('/');
  const dir = slash > 0 ? path.slice(0, slash) : '.';
  const title = baseName(path);
  let license = '';
  let note = '';
  try {
    for (const name of listDir(dir)) {
      if (!/licen[cs]e|readme|credit|attribution/i.test(name)) continue;
      const text = readFile(`${dir}/${name}`);
      if (!text) continue;
      note = `${name}: ${text.slice(0, 400).trim()}`;
      for (const [re, id] of LICENSE_HINTS) {
        if (re.test(text)) { license = id; break; }
      }
      break;
    }
  } catch {
    // listing/reading the folder is best-effort
  }
  return { title, source: dir, license, note };
}

/** Record (or fetch the existing) attribution for an imported file. `sha` keys it to the
 *  bytes (via __file_sha256). A first import seeds the form from auto-detection and lands
 *  `pending` until the user supplies author + license. */
export function recordImport(sha: string, path: string, ledger: Ledger, ledgerPath: string = DEFAULT_LEDGER_PATH): Attribution {
  const existing = ledger[sha];
  if (existing) return existing;
  const d = detectFromPath(path);
  const entry: Attribution = {
    id: sha,
    kind: 'import',
    title: d.title,
    author: '',
    source: d.source,
    license: d.license,
    file: path,
    note: d.note,
    createdAt: nowMs(),
    status: 'pending',
  };
  return putEntry(ledger, entry, ledgerPath);
}

/** Record (or fetch) attribution for a hand-made Studio model. Self-made ⇒ accounted;
 *  the author defaults to the project owner's chosen name (blank is fine). Ready for the
 *  Studio to call so its models live in the same ledger as imports. */
export function recordStudioModel(id: string, title: string, ledger: Ledger, author = '', ledgerPath: string = DEFAULT_LEDGER_PATH): Attribution {
  const existing = ledger[id];
  if (existing) return existing;
  const entry: Attribution = {
    id,
    kind: 'studio',
    title,
    author,
    source: 'Studio (hand-modeled)',
    license: 'Self-made',
    createdAt: nowMs(),
    status: 'accounted',
  };
  return putEntry(ledger, entry, ledgerPath);
}

function nowMs(): number {
  try {
    return Date.now();
  } catch {
    return 0;
  }
}
