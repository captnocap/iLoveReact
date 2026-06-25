// materialStats.test.ts — pins the material tally (req_1882): authored materials
// split by source (shader vs decal). The store-reading reportMaterialCensus is
// verified live in `rjit dev`.

import { assertEqual, finish, test } from '../../game/_testkit';
import { tallyMaterials } from './materialStats';

test('empty → all zero', () => {
  const t = tallyMaterials([]);
  assertEqual(t.authored, 0, 'no materials');
  assertEqual(t.shaderBased, 0, 'no shader');
  assertEqual(t.decalBased, 0, 'no decal');
});

test('splits authored materials by source kind', () => {
  const t = tallyMaterials([
    { shaderId: 'asphalt' },
    { shaderId: 'road' },
    { decal: { foo: 1 } },
    {}, // neither (counts toward authored only)
  ]);
  assertEqual(t.authored, 4, 'four authored');
  assertEqual(t.shaderBased, 2, 'two shader-based');
  assertEqual(t.decalBased, 1, 'one decal-based');
});

finish();
