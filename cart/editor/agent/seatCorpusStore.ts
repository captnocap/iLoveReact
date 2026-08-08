// editor/agent/seatCorpusStore.ts — where the two memories physically live.
//
// The split is the point (req_4057). NOTES are cheap, mutable, disposable, and belong to
// ONE model: they ride that model's package as `notes.json`, so a cold agent picking the
// model up reads the previous agent's intent, and deleting the model deletes them. The
// CORPUS is curated, measured, and permanent: approved exemplars and the append-only
// trajectory log live in one repo-level store, and nothing reaches it without a person
// naming themselves.
//
// seatNotes.ts / seatClassSpec.ts / seatTelemetry.ts hold the logic and stay pure. This
// module is the only one that touches disk.

import { exists, mkdir, readFile, writeFile } from '../../../runtime/hooks/fs';
import { resolvePackageDir } from '../data/modelPackageStore';
import { invalidateMeshDoc, readMeshDoc, readMeshDocParts, meshDocBounds } from '../data/meshDoc';
import { modelPackageById } from '../data/content';
import { NO_SEMANTIC_ID } from '../model/meshSemantics';
import {
  deriveClassSpec,
  emptyClassCorpus,
  isClassCorpus,
  type ClassCorpus,
  type ExemplarFacts,
} from './seatClassSpec';
import { parseTelemetry, summarizeTelemetry } from './seatTelemetry';
import { emptyNoteBook, isNoteBook, type SeatNoteBook } from './seatNotes';

export const SEAT_CORPUS_STORE_DIR = 'cart/editor/data/corpus';
export const CLASS_EXEMPLARS_FILE = `${SEAT_CORPUS_STORE_DIR}/exemplars.json`;
export const TRAJECTORY_FILE = `${SEAT_CORPUS_STORE_DIR}/trajectory.jsonl`;
const NOTES_FILE = 'notes.json';
/** Keep the log bounded without ever rewriting history mid-run: once it passes this many
 *  rows the oldest half is dropped in one pass. Difficulty statistics care about recent
 *  agent behaviour, not about every refusal since the store was created. */
const TRAJECTORY_ROW_LIMIT = 4000;

type Receipt = { ok: boolean; result?: unknown; reason?: string };

function packageDirOf(model: string | null): string | null {
  if (!model) return null;
  const pkg = modelPackageById(model);
  return pkg ? resolvePackageDir(pkg.kind, pkg.id) : null;
}

// ── notes: per model, beside its geometry ─────────────────────────────────────

/** Models that have never been saved keep their pad in memory. It is explicitly NOT
 *  durable, and the seat says so on every append rather than implying a handoff that
 *  will not survive. */
const volatileNotes = new Map<string, SeatNoteBook>();

export function readSeatNotes(model: string | null): SeatNoteBook | null {
  const dir = packageDirOf(model);
  if (dir) {
    const text = readFile(`${dir}/${NOTES_FILE}`);
    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (isNoteBook(parsed)) return parsed;
      } catch { /* an unreadable pad is a lost pad, never a lost model */ }
    }
    // A model saved after notes were taken should not lose them.
    const pending = model ? volatileNotes.get(model) : null;
    if (pending) return pending;
    return emptyNoteBook(model);
  }
  return (model ? volatileNotes.get(model) : null) ?? emptyNoteBook(model);
}

/** True when the pad landed somewhere that survives a cold restart. */
export function writeSeatNotes(model: string | null, book: unknown): boolean {
  if (!isNoteBook(book)) return false;
  const dir = packageDirOf(model);
  if (!dir) {
    if (model) volatileNotes.set(model, book);
    return false;
  }
  const wrote = writeFile(`${dir}/${NOTES_FILE}`, `${JSON.stringify(book, null, 2)}\n`);
  if (wrote && model) volatileNotes.delete(model);
  return wrote;
}

// ── the class corpus ──────────────────────────────────────────────────────────

export function readClassCorpus(): ClassCorpus {
  const text = readFile(CLASS_EXEMPLARS_FILE);
  if (!text) return emptyClassCorpus();
  try {
    const parsed = JSON.parse(text);
    return isClassCorpus(parsed) ? parsed : emptyClassCorpus();
  } catch { return emptyClassCorpus(); }
}

function ensureStoreDir(): void {
  if (!exists(SEAT_CORPUS_STORE_DIR)) mkdir(SEAT_CORPUS_STORE_DIR);
}

/** Record a person's verdict on a model. An approval adds the model to the class's
 *  exemplars; a rejection removes it and keeps the reason, because a rejection with a
 *  reason is the row most likely to become a new check. */
export function recordExemplar(
  classId: string,
  model: string,
  verdict: 'approved' | 'rejected',
  reason: string | null,
  by: string,
  at: string,
): Receipt {
  const corpus = readClassCorpus();
  const entry = corpus.classes[classId] ?? { signals: [classId], exemplars: [] };
  const without = entry.exemplars.filter((row) => row.model !== model);
  if (verdict === 'approved') {
    if (!packageDirOf(model)) {
      return { ok: false, reason: `"${model}" has no package on disk — only a saved model can be measured into a class spec` };
    }
    without.push({ model, approvedBy: by, at, ...(reason ? { note: reason } : {}) });
  }
  const next: ClassCorpus = {
    ...corpus,
    classes: { ...corpus.classes, [classId]: { ...entry, exemplars: without } },
  };
  ensureStoreDir();
  const wrote = writeFile(CLASS_EXEMPLARS_FILE, `${JSON.stringify(next, null, 2)}\n`);
  return wrote
    ? { ok: true, result: { class: classId, model, verdict, by, exemplars: without.length } }
    : { ok: false, reason: `could not write ${CLASS_EXEMPLARS_FILE}` };
}

/** Measure one approved exemplar from its SAVED package — the same decoder `package`
 *  uses, never a hand-rolled read. */
export function exemplarFacts(model: string): ExemplarFacts | null {
  const pkg = modelPackageById(model);
  const dir = pkg ? resolvePackageDir(pkg.kind, pkg.id) : null;
  if (!pkg || !dir) return null;
  invalidateMeshDoc(dir);
  const doc = readMeshDoc(dir);
  if (!doc) return null;
  const triangles = Math.floor(doc.vertices.length / 24);
  const named = new Set<number>();
  for (const id of doc.semanticRegions ?? []) if (id !== NO_SEMANTIC_ID) named.add(id);
  const table = doc.semanticTable?.regions ?? [];
  return {
    model,
    triangles,
    authoredFaces: doc.faceGroups ? new Set(doc.faceGroups).size : null,
    bbox: meshDocBounds(doc),
    // Only regions that actually carry geometry describe the class; an orphaned row in
    // the table would inflate the naming range without naming anything.
    regionNames: table.filter((region) => named.has(region.id)).map((region) => region.name),
    partNames: (readMeshDocParts(dir) ?? []).map((part) => part.name),
  };
}

export function deriveSpec(classId: string): Receipt {
  const corpus = readClassCorpus();
  const entry = corpus.classes[classId];
  if (!entry || entry.exemplars.length === 0) {
    const known = Object.keys(corpus.classes);
    return { ok: false, reason: `no approved exemplars for class "${classId}"${known.length ? ` — known classes: ${known.join(', ')}` : ' — the corpus is empty'}. Approve one with \`tools/seat oracle exemplar <class> <model> --by <you>\`` };
  }
  const facts = entry.exemplars.map((row) => exemplarFacts(row.model)).filter((row): row is ExemplarFacts => !!row);
  const unreadable = entry.exemplars.length - facts.length;
  const spec = deriveClassSpec(classId, facts);
  if ('reason' in spec) return { ok: false, reason: spec.reason };
  return { ok: true, result: unreadable > 0 ? { ...spec, unreadableExemplars: unreadable } : spec };
}

// ── telemetry ─────────────────────────────────────────────────────────────────

export function appendTelemetry(row: unknown): void {
  if (!row || typeof row !== 'object') return;
  ensureStoreDir();
  const existing = readFile(TRAJECTORY_FILE) ?? '';
  const rows = existing ? existing.split('\n').filter((line) => line.trim()) : [];
  rows.push(JSON.stringify(row));
  const kept = rows.length > TRAJECTORY_ROW_LIMIT ? rows.slice(Math.floor(rows.length / 2)) : rows;
  writeFile(TRAJECTORY_FILE, `${kept.join('\n')}\n`);
}

export function readTelemetry(): Receipt {
  const text = readFile(TRAJECTORY_FILE);
  if (!text) return { ok: true, result: { rows: 0, sessions: 0, checks: [], phases: [], outcomes: { approved: 0, rejected: 0, reasons: [] }, note: 'no trajectory recorded yet' } };
  return { ok: true, result: summarizeTelemetry(parseTelemetry(text)) };
}

/** The seat-facing bundle. One object so both the visible viewer and a background lane
 *  reach the same store through the same door. */
export const seatCorpusAdapter = {
  readCorpus: () => readClassCorpus(),
  approve: (classId: string, model: string, verdict: 'approved' | 'rejected', reason: string | null, by: string) =>
    recordExemplar(classId, model, verdict, reason, by, new Date().toISOString()),
  spec: (classId: string) => deriveSpec(classId),
  logTelemetry: (row: unknown) => appendTelemetry(row),
  telemetry: () => readTelemetry(),
};
