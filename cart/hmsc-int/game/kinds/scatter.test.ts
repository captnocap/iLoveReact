// Behavior tests for the scatter brushes (P4): the table's meaning + the
// determinism contract the painter's idempotent-repaint promise rests on.

import { SCATTER_BRUSHES, SCATTER_BRUSH_IDS, isScatterBrushId, scatterRollAt } from './scatter';
import { isPropKind, propKindDefinition } from './props';
import { assert, assertEqual, finish, test } from '../_testkit';

test('every brush entry names a real prop kind with positive weight', () => {
  for (const id of SCATTER_BRUSH_IDS) {
    const brush = SCATTER_BRUSHES[id];
    assert(brush.entries.length > 0, `${id} has entries`);
    assert(brush.density > 0 && brush.density <= 1, `${id} density in (0,1]`);
    for (const entry of brush.entries) {
      assert(isPropKind(entry.kind), `${id} entry kind ${entry.kind} is real`);
      assert(entry.weight > 0, `${id} ${entry.kind} weight positive`);
      // scatter only places ground scenery — never a dynamics body factory
      assert(!propKindDefinition(entry.kind).dynamics, `${id} ${entry.kind} is static scenery`);
    }
  }
});

test('isScatterBrushId accepts the table and rejects strangers', () => {
  for (const id of SCATTER_BRUSH_IDS) assert(isScatterBrushId(id), `accepts ${id}`);
  assert(!isScatterBrushId('lava'), 'rejects strangers');
  assert(!isScatterBrushId(''), 'rejects empty');
});

test('the roll is deterministic per (brush, tile)', () => {
  for (const id of SCATTER_BRUSH_IDS) {
    const brush = SCATTER_BRUSHES[id];
    for (let i = 0; i < 50; i += 1) {
      const a = scatterRollAt(brush, i * 7 - 100, i * 13 - 200);
      const b = scatterRollAt(brush, i * 7 - 100, i * 13 - 200);
      assertEqual(JSON.stringify(a), JSON.stringify(b), `${id} tile ${i} rolls identically`);
    }
  }
});

test('fill rate tracks density and rotations land on 15° steps', () => {
  for (const id of SCATTER_BRUSH_IDS) {
    const brush = SCATTER_BRUSHES[id];
    let hits = 0;
    const seen = new Set<string>();
    for (let x = 0; x < 50; x += 1) {
      for (let z = 0; z < 50; z += 1) {
        const roll = scatterRollAt(brush, x, z);
        if (!roll) continue;
        hits += 1;
        seen.add(roll.kind);
        assertEqual(roll.rotation % 15, 0, `${id} rotation in 15° steps`);
        assert(roll.rotation >= 0 && roll.rotation < 360, `${id} rotation in [0,360)`);
      }
    }
    const rate = hits / 2500;
    assert(Math.abs(rate - brush.density) < 0.08, `${id} fill rate ${rate.toFixed(3)} tracks density ${brush.density}`);
    assert(seen.size >= Math.min(3, brush.entries.length), `${id} variety: ${seen.size} kinds over the field`);
  }
});

finish('kinds/scatter');
