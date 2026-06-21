// grassPopulation.test.ts — flora population contracts for the editor + bake path.

import { makeChunk } from '../chunks';
import { chunkToFloor, floorToLandform } from '../chunkFloor';
import { floraKindIndex, paintFlora } from '../floraData';
import { buildFlowerInstances, buildGrassInstances, FLOWER_CONFIG, GRASS_CONFIG } from './grassPopulation';
import { assert, assertEqual, finish, test } from '../game/_testkit';

const INSTANCE_STRIDE = 12;

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

test('flower heads tuck into the grass canopy instead of floating above it', () => {
  const flowers = buildFlowerInstances(worldForPaintedFlora('grassFlowers'));
  for (let i = 0; i < flowers.count; i += 1) {
    const o = i * INSTANCE_STRIDE;
    const centerY = flowers.data[o + 1];
    const radius = flowers.data[o + 7];
    assert(centerY - radius <= GRASS_CONFIG.height.max + 1e-6, 'flower head bottom overlaps the grass canopy');
  }
});

test('plain grass does not emit flower heads', () => {
  const world = worldForPaintedFlora('grassMed');
  assertEqual(buildFlowerInstances(world).count, 0, 'plain grass has no flower heads');
});

finish('render3d/grass-population');
