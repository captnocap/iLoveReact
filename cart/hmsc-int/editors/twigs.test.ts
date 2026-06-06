// twigs.test.ts — route working-state persistence contract.

import { assert, assertEqual, finish, test } from '../game/_testkit';
import { patchRouteTwig, routeTwigKey } from './twigs';

test('route twig keys are stable and scoped by route plus field', () => {
  assertEqual(routeTwigKey('/build', 'armed'), 'hmsc-int:twig:/build:armed', 'route + field names the atom');
  assert(routeTwigKey('/build', 'armed') !== routeTwigKey('/voxels', 'armed'), 'routes never share twigs by accident');
});

test('patchRouteTwig merges over defaults without erasing unknown untouched fields', () => {
  const base = { tool: 'brush', brush: 4, tab: 'objects' };
  const prev = { brush: 9 };
  const next = patchRouteTwig(base, prev, { tab: 'paint' });
  assertEqual(next.tool, 'brush', 'defaults fill missing fields');
  assertEqual(next.brush, 9, 'stored values win over defaults');
  assertEqual(next.tab, 'paint', 'the patch wins last');
});

finish('editors/twigs');
