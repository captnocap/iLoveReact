// Run with the same esbuild aliases as pieces.test.ts.
import { WORLD_PREFAB_TUNING, mintWorldPrefabId, prefabFromPieces, prefabGridAnchor, resolvePrefabPlacement, stampWorldPrefab, worldPrefabById } from './prefabs';
import { RUN_PLACEMENT_CAP, type PlacedPiece } from './pieces';

function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }

const source: PlacedPiece[] = [
  { id: 'wall', pieceId: 'wall.stucco.motel', x: 0, y: 0, z: 0, yawDegrees: 0, floor: 0, slots: { front: { assetId: 'skin.stucco' } } },
  { id: 'floor', pieceId: 'floor.concrete.common', x: 1.5, y: 0, z: 1.5, yawDegrees: 0, floor: 0 },
  { id: 'upper', pieceId: 'wall.stucco.motel', x: 0, y: 3, z: 0, yawDegrees: 90, floor: 1, generatedSite: undefined },
];

const prefab = prefabFromPieces('prefab.room', 'Room', source);
assert(prefab.pieces.length === 3 && prefab.pieces[1]!.x === 1.5 && prefab.pieces[2]!.floorOffset === 1, 'capture lost local/floor structure');
assert(prefabGridAnchor(prefab)?.pieceId === 'floor.concrete.common', 'floor did not own prefab lattice alignment');
assert(prefab.pieces[0]!.slots?.front !== source[0]!.slots?.front, 'capture retained mutable material references');

const restored = stampWorldPrefab(prefab, { x: 0, y: 0, z: 0, floor: 0 }, 0);
assert(restored.every((piece, index) => piece.pieceId === source[index]!.pieceId), 'zero-yaw stamp changed semantic pieces');
assert(restored[2]!.floor === 1 && restored[2]!.yawDegrees === 90, 'stamp lost storey/yaw');

const turned = stampWorldPrefab(prefab, { x: 10, y: 0, z: 10, floor: 2 }, 90);
assert(Math.abs(turned[1]!.x - 11.5) < 1e-9 && Math.abs(turned[1]!.z - 8.5) < 1e-9, 'group yaw disagrees with active Scene3D frame');
assert(turned[2]!.floor === 3 && turned[2]!.yawDegrees === 180, 'turned stamp did not compose member transforms');

const snapped = resolvePrefabPlacement(prefab, { x: 9.8, z: 9.8, terrainY: 2 }, 0, 0);
const floor = snapped.find((piece) => piece.pieceId === 'floor.concrete.common')!;
assert(((floor.x % 3) + 3) % 3 === 1.5 && ((floor.z % 3) + 3) % 3 === 1.5, 'prefab floor landed off the native floor lattice');
assert(floor.y === 2, 'prefab did not ride the terrain as one rigid composition');

assert(mintWorldPrefabId('My Room', [prefab, { ...prefab, id: 'prefab.myRoom' }]) === 'prefab.myRoom2', 'prefab id collision was not repaired');
assert(worldPrefabById([prefab], prefab.id) === prefab, 'viewport lookup lost a real prefab');
assert(worldPrefabById(undefined, 'wall.stucco.motel') === null, 'missing prefab hydration must behave like an ordinary piece, not throw');

const scene = Array.from({ length: RUN_PLACEMENT_CAP + 1 }, (_, index): PlacedPiece => ({
  id: `scene-${index}`,
  pieceId: 'floor.concrete.common',
  x: index * 3 + 1.5,
  y: 0,
  z: 1.5,
  yawDegrees: 0,
  floor: 0,
}));
assert(WORLD_PREFAB_TUNING.maxPieces > RUN_PLACEMENT_CAP, 'scene prefabs still share the pointer drag-run cap');
assert(prefabFromPieces('prefab.scene', 'Scene', scene).pieces.length === scene.length, 'scene-sized selection did not capture intact');

console.log('prefabs.test.ts: ok');
