import { assert, assertEqual, finish, test } from './game/_testkit';
import { MAP_LUMP, findLump, readLumpContainer } from '@reactjit/workspace';
import { createInitialGameState } from './state/gameState';
import { createHmscMapfile } from './packageMap';
import { INSTANCE_SHAPE_CYLINDER8, INSTANCE_STRIDE } from './compile/worldGeometry';

function decodeInstances(bytes: Uint8Array): number[][] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(0, true);
  const stride = view.getUint32(4, true);
  assertEqual(stride, INSTANCE_STRIDE, 'packaged instance stride matches loader stride');
  const rows: number[][] = [];
  let at = 12;
  for (let i = 0; i < count; i += 1) {
    const row: number[] = [];
    for (let k = 0; k < stride; k += 1) {
      row.push(view.getFloat32(at, true));
      at += 4;
    }
    rows.push(row);
  }
  return rows;
}

test('packaged map includes authored stop-sign prop geometry in the instance lump', () => {
  const base = createInitialGameState();
  const state = {
    ...base,
    world: {
      ...base.world,
      surfaceRegions: [],
      placedCells: {},
      roads: [],
      junctions: [],
      buildings: [],
      props: [{
        id: 'stop-sign-regression',
        kind: 'stopSign',
        x: 10,
        y: 0,
        z: 20,
        yawDegrees: 90,
        createdByCommand: 'test',
      }],
      landforms: [],
      waterBodies: [],
      zones: [],
      spawnedEntities: {},
      npcs: {},
    },
  };

  const mapfile = createHmscMapfile(state, [], [], undefined, { includePlayerLumps: false });
  const records = readLumpContainer(mapfile, { knownTypes: new Set(Object.values(MAP_LUMP)) });
  const inst = findLump(records, MAP_LUMP.INSTANCES);
  assert(inst, 'mapfile carries an instance lump');
  const rows = decodeInstances(inst!.data);
  const redFace = rows.find((r) =>
    Math.hypot(r[0]! - 10, r[2]! - 20) < 0.05
    && Math.abs(r[9]! - 0.75) < 0.001
    && Math.abs(r[10]! - 0.14) < 0.001
    && Math.abs(r[11]! - 0.12) < 0.001
  );

  assert(redFace, 'stop sign red octagon face is emitted at the authored prop');
  assertEqual(redFace![12], INSTANCE_SHAPE_CYLINDER8, 'stop sign face uses the cylinder8 octagon geometry');
});

finish();
