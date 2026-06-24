// editors/model/compactPaintStore.ts — reclaim the mesh-paint bloat (req_1789).
//
// The painter bakes a full ~158KB PNG of the texture into a `modelPaintBaked`
// event on every stroke. The in-memory materializer already GCs superseded
// blobs (modelStream.apply), but the DURABLE event log keeps every historical
// blob forever — so the model store grew to ~695MB of dead stroke-history.
//
// This compaction keeps only the LIVE paint per model (the latest paintRef each
// model points at) and strips the heavy `blobB64` payload from every superseded
// event, leaving the event row (seq/structure) intact so the log still replays
// to the exact same current state. Then VACUUM reclaims the freed pages.
//
// SAFE: it never deletes events and never touches a live blob — only redundant
// history that the current materialized state does not reference. Back up
// store.db before running (the runner does).

import { open, query, exec, close } from '@reactjit/hooks/sqlite';

/** Remove only the `event.blobB64` field from a stored record string, leaving
 *  everything else byte-identical. Pure. Returns the input unchanged if it has
 *  no blob. */
export function stripBlobFromRecord(record: string): string {
  let obj: any;
  try { obj = JSON.parse(record); } catch { return record; }
  if (obj?.event && 'blobB64' in obj.event) { delete obj.event.blobB64; return JSON.stringify(obj); }
  return record;
}

export type PaintRow = { id: number; model: string | null; ref: string | null; hasBlob: number };

/** Decide which event ids should have their blob stripped: any blob-bearing
 *  paint event whose paintRef is NOT the current (latest-id) ref of its model.
 *  Pure — unit-tested without a DB. */
export function planStrip(rows: PaintRow[]): { stripIds: number[]; liveRefs: string[] } {
  const latestRefByModel = new Map<string, { id: number; ref: string | null }>();
  for (const r of rows) {
    const key = r.model ?? '∅';
    const cur = latestRefByModel.get(key);
    if (!cur || r.id > cur.id) latestRefByModel.set(key, { id: r.id, ref: r.ref });
  }
  const liveRefs = new Set<string>();
  for (const v of latestRefByModel.values()) if (v.ref) liveRefs.add(v.ref);
  const stripIds: number[] = [];
  for (const r of rows) {
    if (r.hasBlob && r.ref && !liveRefs.has(r.ref)) stripIds.push(r.id);
  }
  return { stripIds, liveRefs: [...liveRefs] };
}

export type CompactionReport = {
  paintEvents: number;
  liveRefs: number;
  stripped: number;
  beforeBytes: number;
  afterBytes: number;
};

/** Run the compaction against a model-domain store.db. `sizeOf` reports the file
 *  size (injected so the caller supplies host fs). */
export function compactPaintStore(dbPath: string, sizeOf: (p: string) => number): CompactionReport {
  const db = open(dbPath);
  const rows = query<PaintRow>(db,
    "SELECT id, json_extract(record,'$.event.model') AS model, json_extract(record,'$.event.paintRef') AS ref, " +
    "(record LIKE '%blobB64%') AS hasBlob FROM events WHERE record LIKE '%modelPaintBaked%'");
  const { stripIds, liveRefs } = planStrip(rows);
  const before = sizeOf(dbPath);
  exec(db, 'BEGIN');
  for (const id of stripIds) {
    const got = query<{ record: string }>(db, 'SELECT record FROM events WHERE id=?', [id]);
    if (!got.length) continue;
    exec(db, 'UPDATE events SET record=? WHERE id=?', [stripBlobFromRecord(got[0].record), id]);
  }
  exec(db, 'COMMIT');
  exec(db, 'VACUUM');
  close(db);
  return { paintEvents: rows.length, liveRefs: liveRefs.length, stripped: stripIds.length, beforeBytes: before, afterBytes: sizeOf(dbPath) };
}
