// grassPopulation.test.ts — flora population contracts for the editor + bake path.

import { makeChunk } from '../chunks';
import { chunkToFloor, floorToLandform } from '../chunkFloor';
import { floraKindIndex, paintFlora } from '../floraData';
import { buildFlowerInstances, buildGrassInstances, FLOWER_CONFIG } from './grassPopulation';
import { assert, assertEqual, finish, test } from '../game/_testkit';

function worldForPaintedFlora(kind: string) {
  const chunk = makeChunk(0, 0);
  paintFlora(chunk.flora, 10, 12, floraKindIndex(kind));
  return {
    cellSizeMeters: 1,
    surfaceRegions: [],
    landforms: [floorToLandform(chunkToFloor(chunk))],
  } as any;
}

test('flower grass emits both grass blades and flower heads', () => {
  const world = worldForPaintedFlora('grassFlowers');
  const grass = buildGrassInstances(world);
  const flowers = buildFlowerInstances(world);
  assert(grass.count > 0, 'flower grass still grows a grass blade bed');
  assertEqual(flowers.count, Math.round(FLOWER_CONFIG.density), 'flower heads are populated over the flower grass cell');
});

test('plain grass does not emit flower heads', () => {
  const world = worldForPaintedFlora('grassMed');
  assertEqual(buildFlowerInstances(world).count, 0, 'plain grass has no flower heads');
});

finish('render3d/grass-population');
