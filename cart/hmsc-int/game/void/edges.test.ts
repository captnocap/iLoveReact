// edges.test.ts — the declared edge-aware void (USER req_2005): void-edge tiles
// the author paints become the EdgeProfile exits the void continues. Pure modules.

import { assert, assertEqual, finish, test } from '../_testkit';
import type { WorldState, VoidEdgeDecl } from '../../design';
import type { WorldCore } from './distance';
import { buildEdgeProfile, type EdgeProfile } from './edges';
import { buildVoidWaterBodies } from './voidWater';
import { buildShellBatch } from './shell';

const CORE: WorldCore = { minX: 0, minZ: 0, maxX: 240, maxZ: 240, centerX: 120, centerZ: 120 };

// A world stub: cell size + void-edge declarations + (optional) water bodies for
// surface-height matching. Declared cells sit at x=239 = the +X edge column.
function declWorld(voidEdges: VoidEdgeDecl[], waterBodies: WorldState['waterBodies'] = []): WorldState {
  return { cellSizeMeters: 1, waterBodies, voidEdges } as unknown as WorldState;
}

test('a painted run of void_road cells groups into ONE road exit at the edge', () => {
  const p = buildEdgeProfile(declWorld([
    { x: 239, z: 118, kind: 'road' }, { x: 239, z: 119, kind: 'road' },
    { x: 239, z: 120, kind: 'road' }, { x: 239, z: 121, kind: 'road' },
  ]), CORE);
  assertEqual(p.roadExits.length, 1, 'four adjacent cells → one exit');
  assertEqual(p.roadExits[0]!.width, 4, 'width = run length in metres');
  assertEqual(p.roadExits[0]!.nx, 1, 'outward normal points off the +X edge');
  assert(Math.abs(p.roadExits[0]!.z - 120) < 1e-6, 'centred on the run');
  assert(Math.abs(p.roadExits[0]!.x - 240) < 1e-6, 'sits on the boundary rim');
});

test('a gap splits a run into two exits; kinds route to their channels', () => {
  const p = buildEdgeProfile(declWorld([
    { x: 239, z: 10, kind: 'road' }, { x: 239, z: 11, kind: 'road' },
    { x: 239, z: 40, kind: 'road' }, // gap → second exit
    { x: 239, z: 80, kind: 'river' },
    { x: 239, z: 120, kind: 'sea' }, { x: 239, z: 121, kind: 'sea' },
    { x: 239, z: 200, kind: 'grass' },
  ]), CORE);
  assertEqual(p.roadExits.length, 2, 'the gap breaks the road into two exits');
  assertEqual(p.waterEdges.length, 2, 'one river + one sea');
  assertEqual(p.waterEdges.filter((w) => !w.sea).length, 1, 'void_water → river (sea:false)');
  assertEqual(p.waterEdges.filter((w) => w.sea).length, 1, 'void_sea → sea (sea:true)');
  assertEqual(p.grassEdges.length, 1, 'void_grass → a grass edge');
});

test('an undeclared world yields an empty profile (pure opt-in, no auto-detect)', () => {
  const p = buildEdgeProfile(declWorld([]), CORE);
  assertEqual(p.roadExits.length + p.waterEdges.length + p.grassEdges.length, 0, 'nothing continues without a declaration');
});

test('a void river continues at the nearby authored water level (no step at the seam)', () => {
  const p = buildEdgeProfile(declWorld(
    [{ x: 239, z: 120, kind: 'river' }],
    [{ id: 'lake', label: 'l', shape: 'rect', x: 200, z: 100, width: 39, depth: 40, surfaceY: 1.7, createdByCommand: 't' }],
  ), CORE);
  assert(Math.abs(p.waterEdges[0]!.surfaceY - 1.7) < 1e-6, 'river surface matches the adjacent lake');
  const bodies = buildVoidWaterBodies(p, 8);
  assert(bodies.length > 1 && bodies.every((b) => Math.abs(b.surfaceY - 1.7) < 1e-6), 'continuation bodies inherit that level');
});

// Direct EdgeProfile drivers for the shell (no world needed).
const ROAD_COLOR = [0.13, 0.13, 0.15];
const GRASS_COLOR = [0.22, 0.42, 0.18];
function rows(data: number[]): number[][] {
  return Array.from({ length: data.length / 9 }, (_, i) => data.slice(i * 9, i * 9 + 9));
}
const colorIs = (r: number[], c: number[]) => Math.abs(r[6]! - c[0]!) < 1e-6 && Math.abs(r[7]! - c[1]!) < 1e-6 && Math.abs(r[8]! - c[2]!) < 1e-6;
const isBuilding = (r: number[]) => r[6]! >= 0.3;

test('a declared road seams straight out; a declared grass field re-skins the ground', () => {
  const roadEdge: EdgeProfile = { roadExits: [{ x: 240, z: 120, nx: 1, nz: 0, width: 10 }], waterEdges: [], grassEdges: [] };
  const road = rows(buildShellBatch(440, 120, CORE, 2, roadEdge, []).data);
  assert(road.some((r) => colorIs(r, ROAD_COLOR) && r[0]! > 240 && Math.abs(r[2]! - 120) < 6), 'road continues outward along the corridor');
  assertEqual(road.filter((r) => isBuilding(r) && Math.abs(r[2]! - 120) < 10 && r[0]! > 240).length, 0, 'no towers on the road seam');

  const grassEdge: EdgeProfile = { roadExits: [], waterEdges: [], grassEdges: [{ x: 240, z: 120, nx: 1, nz: 0, span: 40 }] };
  const grass = rows(buildShellBatch(440, 120, CORE, 2, grassEdge, []).data);
  assert(grass.some((r) => colorIs(r, GRASS_COLOR) && r[0]! > 240 && Math.abs(r[2]! - 120) < 22), 'a green field re-skins the ground over the corridor');
  assertEqual(grass.filter((r) => isBuilding(r) && Math.abs(r[2]! - 120) < 22 && r[0]! > 240).length, 0, 'no towers on the grass field');
});

finish('void edges — declared (req_2005)');
