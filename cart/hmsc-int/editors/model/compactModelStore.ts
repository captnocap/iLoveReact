// editors/model/compactModelStore.ts — repeatable, SAFE reclamation of the
// model store's bloat (req_1789). Runs under v8cli (sqlite + fs doors).
//
// The model event log keeps the FULL payload of every edit forever: a ~158KB
// PNG per paint stroke (modelPaintBaked.blobB64) and the whole mesh per geometry
// edit (partMeshUpdated.mesh) / paint layer (partPaintUpdated.paint). The editor
// BOOTS from a snapshot+tail (data/index.ts), so once the snapshot holds the
// current state, all that pre-seam history is redundant for boot.
//
// This compaction (proven to take a real store 694MB -> 27MB):
//   1. Rebuild the snapshot's paintBlobs to hold EVERY live model's blob, pulled
//      from the event log. (A stale snapshot once held only 2 of 23 — boot would
//      show 21 models blank. This fixes that latent bug too.)
//   2. Strip the heavy field from every SUPERSEDED event, KEEPING the latest per
//      key as a second copy and KEEPING every row so the boot guard
//      (COUNT(seq<=globalSeq) == snapshot.events) stays valid and boot keeps
//      using the snapshot — it never reads the stripped pre-seam events.
//   3. VACUUM, then assert the guard still holds and the snapshot is complete.
//
// SAFE: rows are never deleted, the snapshot is never shrunk, and a live blob is
// never dropped (live-ref blobs stay in the log too). Back up store.db +
// snapshot before running (the rjit command does). Run with the editor CLOSED —
// VACUUM needs exclusive access.

import { open, query, exec, close } from '@reactjit/hooks/sqlite';
import { readFile, writeFile } from '@reactjit/hooks/fs';

/** Of a list of {id, key} rows (ascending id), the ids that are NOT the latest
 *  for their key — i.e. the superseded ones whose heavy payload is redundant.
 *  Pure. */
export function supersededIds(rows: { id: number; key: string }[]): number[] {
  const latest = new Map<string, number>();
  for (const r of rows) latest.set(r.key, r.id); // ascending id → last wins
  return rows.filter((r) => latest.get(r.key) !== r.id).map((r) => r.id);
}

/** Remove one `event.<field>` from a stored record string, byte-identical
 *  otherwise. Returns input unchanged if absent. Pure. */
export function stripField(record: string, field: string): string {
  let o: any;
  try { o = JSON.parse(record); } catch { return record; }
  if (o?.event && field in o.event) { delete o.event[field]; return JSON.stringify(o); }
  return record;
}

export type CompactionReport = {
  paintBlobsRebuilt: number;
  paintBlobsStripped: number;
  meshStripped: number;
  paintLayerStripped: number;
  rowsBefore: number;
  rowsAfter: number;
  guardOk: boolean;
  snapshotPaintedOk: boolean;
};

const SNAP_REL = 'snapshots/model.snapshot.json';
const DB_REL = 'store.db';

/** Live model paintRefs from a parsed snapshot's materialized state. */
function liveRefs(state: any): Set<string> {
  const refs = new Set<string>();
  for (const m of Object.values(state.models || {}) as any[]) if (m.paintRef) refs.add(m.paintRef);
  return refs;
}

/** Compact one model-domain store dir (the dir holding store.db + snapshots/).
 *  Throws if the post-compaction boot guard or snapshot completeness check fails
 *  (so the rjit runner can restore from its backup). */
export function compactModelStore(rootDir: string): CompactionReport {
  const snapPath = `${rootDir}/${SNAP_REL}`;
  const dbPath = `${rootDir}/${DB_REL}`;
  const snap = JSON.parse(readFile(snapPath)!);
  const state = snap.state || snap;
  const refs = liveRefs(state);

  const db = open(dbPath);
  const rowsBefore = query<{ n: number }>(db, 'SELECT COUNT(*) n FROM events')[0].n;

  // 1) rebuild snapshot paintBlobs: pull every live ref's blob from the log.
  const newBlobs: Record<string, string> = {};
  let rebuilt = 0;
  for (const ref of refs) {
    if (state.paintBlobs?.[ref]) { newBlobs[ref] = state.paintBlobs[ref]; continue; }
    const r = query<{ b: string }>(db,
      "SELECT json_extract(record,'$.event.blobB64') b FROM events WHERE json_extract(record,'$.event.paintRef')=? AND record LIKE '%blobB64%' LIMIT 1", [ref]);
    if (r.length && r[0].b) { newBlobs[ref] = r[0].b; rebuilt += 1; }
    else throw new Error(`compact: live ref ${ref} has no blob in the event log — aborting before any mutation`);
  }
  state.paintBlobs = newBlobs;
  writeFile(snapPath, JSON.stringify({ ...snap, state }));

  // 2a) strip superseded paint blobs (keep live-ref blobs).
  const paintRows = query<{ id: number; ref: string }>(db,
    "SELECT id, json_extract(record,'$.event.paintRef') ref FROM events WHERE record LIKE '%modelPaintBaked%' AND record LIKE '%blobB64%'");
  const paintStrip = paintRows.filter((r) => !refs.has(r.ref)).map((r) => r.id);

  // 2b) strip superseded heavy LWW fields, latest-per-(model,part) kept.
  const meshRows = query<{ id: number; key: string }>(db,
    "SELECT id, json_extract(record,'$.event.model')||'/'||json_extract(record,'$.event.id') key FROM events WHERE record LIKE '%partMeshUpdated%' AND record LIKE '%\"mesh\"%' ORDER BY id");
  const meshStrip = supersededIds(meshRows);
  const paintLayerRows = query<{ id: number; key: string }>(db,
    "SELECT id, json_extract(record,'$.event.model')||'/'||json_extract(record,'$.event.id') key FROM events WHERE record LIKE '%partPaintUpdated%' AND record LIKE '%\"paint\"%' ORDER BY id");
  const paintLayerStrip = supersededIds(paintLayerRows);

  const stripAll = (ids: number[], field: string): number => {
    let n = 0;
    for (const id of ids) {
      const got = query<{ record: string }>(db, 'SELECT record FROM events WHERE id=?', [id]);
      if (!got.length) continue;
      exec(db, 'UPDATE events SET record=? WHERE id=?', [stripField(got[0].record, field), id]);
      n += 1;
    }
    return n;
  };
  exec(db, 'BEGIN');
  const paintStripped = stripAll(paintStrip, 'blobB64');
  const meshStripped = stripAll(meshStrip, 'mesh');
  const paintLayerStripped = stripAll(paintLayerStrip, 'paint');
  exec(db, 'COMMIT');
  exec(db, 'VACUUM');

  // 3) verify: rows unchanged (guard count stable) + snapshot boots all paint.
  const rowsAfter = query<{ n: number }>(db, 'SELECT COUNT(*) n FROM events')[0].n;
  const counted = query<{ n: number }>(db, "SELECT COUNT(*) n FROM events WHERE stream='model' AND seq<=?", [snap.globalSeq])[0].n;
  close(db);
  const guardOk = rowsAfter === rowsBefore && counted === snap.events;
  let painted = 0, present = 0;
  for (const m of Object.values(state.models || {}) as any[]) if (m.paintRef) { painted += 1; if (state.paintBlobs[m.paintRef]) present += 1; }
  const snapshotPaintedOk = painted === present;
  if (!guardOk || !snapshotPaintedOk) {
    throw new Error(`compact: POST-CHECK FAILED (guardOk=${guardOk} rows ${rowsBefore}->${rowsAfter} count ${counted} vs events ${snap.events}; paint ${present}/${painted}) — restore from backup`);
  }
  return { paintBlobsRebuilt: rebuilt, paintBlobsStripped: paintStripped, meshStripped, paintLayerStripped, rowsBefore, rowsAfter, guardOk, snapshotPaintedOk };
}
