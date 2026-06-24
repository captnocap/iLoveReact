// Pure tests for paint-store compaction (req_1789). The sqlite IO is exercised
// live; here we pin the two decisions: which blobs to strip, and that stripping
// removes ONLY blobB64 byte-for-byte otherwise.

import { assert, assertEqual, finish, test } from '../../game/_testkit';
import { stripBlobFromRecord, planStrip, type PaintRow } from './compactPaintStore';

function rec(model: string, ref: string, blob?: string): string {
  const event: any = { kind: 'modelPaintBaked', model, paintRef: ref };
  if (blob !== undefined) event.blobB64 = blob;
  return JSON.stringify({ seq: 1, at: 2, event });
}

test('stripBlobFromRecord removes only blobB64, keeps the rest', () => {
  const before = rec('m1', 'refA', 'AAAA');
  const after = stripBlobFromRecord(before);
  assert(!after.includes('blobB64'), 'blob field gone');
  assert(after.includes('"paintRef":"refA"'), 'paintRef kept');
  assert(after.includes('"model":"m1"'), 'model kept');
  assertEqual(stripBlobFromRecord(after), after, 'idempotent — no blob to strip');
});

test('planStrip keeps the latest ref per model live, strips superseded blobs', () => {
  // model m1 painted refA (id1, blob), then refB (id3, blob); m2 painted refC (id2, blob)
  const rows: PaintRow[] = [
    { id: 1, model: 'm1', ref: 'refA', hasBlob: 1 },
    { id: 2, model: 'm2', ref: 'refC', hasBlob: 1 },
    { id: 3, model: 'm1', ref: 'refB', hasBlob: 1 },
  ];
  const { stripIds, liveRefs } = planStrip(rows);
  assertEqual(stripIds.join(','), '1', 'only the superseded refA blob (id1) is stripped');
  assert(liveRefs.includes('refB') && liveRefs.includes('refC'), 'latest refs of both models stay live');
  assert(!liveRefs.includes('refA'), 'refA is no longer live');
});

test('a live ref interned on an EARLIER event is preserved (A→B→A dedup case)', () => {
  // m1: refA(id1, blob), refB(id2, blob), refA again(id3, no blob — deduped). Latest = refA.
  const rows: PaintRow[] = [
    { id: 1, model: 'm1', ref: 'refA', hasBlob: 1 },
    { id: 2, model: 'm1', ref: 'refB', hasBlob: 1 },
    { id: 3, model: 'm1', ref: 'refA', hasBlob: 0 },
  ];
  const { stripIds } = planStrip(rows);
  assertEqual(stripIds.join(','), '2', 'only refB (id2) stripped; refA blob on id1 kept because refA is still live');
});

test('events without a blob are never in the strip list', () => {
  const rows: PaintRow[] = [
    { id: 1, model: 'm1', ref: 'refOld', hasBlob: 0 },
    { id: 2, model: 'm1', ref: 'refNew', hasBlob: 1 },
  ];
  assertEqual(planStrip(rows).stripIds.length, 0, 'nothing to strip — refOld has no blob, refNew is live');
});

finish('editors/model/compactPaintStore');
