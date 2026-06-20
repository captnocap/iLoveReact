// Behavior tests for the water-body preset table (P4) and the preset → WaterBody
// → resolver chain the editor's WATER tool relies on. The painter drops a thin
// placement (cat 'water', kind = a preset id); previewWorld turns that into a
// world/water WaterBody using THIS table. These assert that round-trips.

import { WATER_BODY_PRESETS, WATER_BODY_PRESET_IDS, waterBodyPreset } from './waterBodies';
import { submergedInWaterBody, waterDepthAt, type WaterBody } from '../world/water';
import { assert, assertClose, assertEqual, finish, test } from '../_testkit';
import { floorToWaterBody } from '../../chunkFloor';
import { encodeWaterBodies } from '../../compile/worldGeometry';

test('every preset id resolves and carries a sane footprint + level', () => {
  assert(WATER_BODY_PRESET_IDS.length >= 3, 'a few presets exist');
  for (const id of WATER_BODY_PRESET_IDS) {
    const p = waterBodyPreset(id);
    assert(!!p, `${id} resolves`);
    assert(p!.footW > 0 && p!.footD > 0, `${id} has a footprint`);
    assert(p!.surfaceY > 0, `${id} fills to a positive surface`);
    assert(p!.shape === 'rect' || p!.shape === 'disc', `${id} has a real shape`);
  }
  assertEqual(waterBodyPreset('nope'), undefined, 'unknown preset is undefined');
});

// previewWorld's exact construction: a dropped placement at min-corner (wx,wz)
// with the preset footprint becomes this body.
function bodyFromPreset(id: string, wx: number, wz: number): WaterBody {
  const p = waterBodyPreset(id)!;
  return { id: `pl_${id}`, label: p.label, shape: p.shape, x: wx, z: wz, width: p.footW, depth: p.footD, surfaceY: p.surfaceY, createdByCommand: 'hmsc-int:place' };
}

test('a dropped pond holds water to its level over flat ground', () => {
  const pond = bodyFromPreset('pond', 50, 50);
  const cx = pond.x + pond.width / 2;
  const cz = pond.z + pond.depth / 2;
  assert(submergedInWaterBody(pond, cx, cz, 0.2), 'wading at the center');
  assertClose(waterDepthAt(pond, cx, cz, 0), pond.surfaceY, 1e-9, 'flat-ground depth = the level');
  // Dig the bed 3 m under the pond → 3 m deeper, same dropped body.
  assertClose(waterDepthAt(pond, cx, cz, -3), pond.surfaceY + 3, 1e-9, 'dug bed deepens the pond');
});

test('painted water fills negative terrain to surface zero and ships as a field body', () => {
  const heights = [
    0, 0, 0,
    0, -2, 0,
    0, 0, 0,
  ];
  const water = [
    0, 0, 0,
    0, 2, 0,
    0, 0, 0,
  ];
  const body = floorToWaterBody({
    cx: 0,
    cz: 0,
    tileData: [],
    heights,
    hcols: 3,
    hrows: 3,
    hver: 1,
    water,
  });
  assert(body.field, 'painted water produces a field-backed body');
  assertClose(body.field!.heights[4]!, 0, 1e-9, 'negative bed + water depth fills to surface zero');
  assert(body.field!.base < -2, 'dry cells tuck under the basin floor');
  const encoded = encodeWaterBodies([body as any]);
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  assertEqual(view.getUint32(4, true), 1, 'encoded WATER lump includes the painted body');
});

finish('kinds/waterBodies');
