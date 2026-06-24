// Pure tests for the model-store compaction (req_1789). The sqlite/fs IO is
// exercised live via `rjit game compact-store`; here we pin the two decisions:
// which events are superseded, and that stripping removes only the heavy field.

import { assert, assertEqual, finish, test } from '../../game/_testkit';
import { supersededIds, stripField } from './compactModelStore';

test('supersededIds keeps the latest id per key, returns the rest', () => {
  const rows = [
    { id: 1, key: 'm/a' }, { id: 2, key: 'm/b' }, { id: 3, key: 'm/a' },
    { id: 4, key: 'm/a' }, { id: 5, key: 'm/b' },
  ];
  // latest: m/a=4, m/b=5 → superseded = 1,3 (a) and 2 (b)
  assertEqual(supersededIds(rows).sort((x, y) => x - y).join(','), '1,2,3', 'older ids per key');
});

test('supersededIds with one event per key strips nothing', () => {
  assertEqual(supersededIds([{ id: 1, key: 'm/a' }, { id: 2, key: 'm/b' }]).length, 0, 'all are latest');
});

test('stripField removes only the named event field, keeps the rest', () => {
  const rec = JSON.stringify({ seq: 7, at: 9, event: { kind: 'partMeshUpdated', model: 'm', id: 'p', mesh: { v: [1, 2, 3] } } });
  const out = stripField(rec, 'mesh');
  assert(!out.includes('"mesh"'), 'mesh field gone');
  assert(out.includes('"kind":"partMeshUpdated"') && out.includes('"id":"p"'), 'identity fields kept');
  assert(out.includes('"seq":7'), 'envelope kept');
  assertEqual(stripField(out, 'mesh'), out, 'idempotent');
});

test('stripField on a record without the field returns it unchanged', () => {
  const rec = JSON.stringify({ event: { kind: 'partAdded', model: 'm' } });
  assertEqual(stripField(rec, 'mesh'), rec, 'unchanged');
});

finish('editors/model/compactModelStore');
