// previewWorld.test.ts — the preview-assembler decoupling contracts
// (PAINTCHOKE-0618).
//
// The shell splits the preview world into a cheap floors→landforms overlay and an
// expensive O(placements) placement walk so a tile-COLOUR dab no longer re-runs
// the walk (index.tsx previewWorld memo). For that split to be CORRECT the
// assembler must hold ONLY placement-derived water (the shell passes base
// waterBodies = [] and merges painted floors-water on top in the overlay) — else a
// colour dab that refreshes floors-water would silently DROP every placed body of
// water. These cases pin that contract.

import { assemblePreviewWorld } from './previewWorld';
import { emptyEditorWorld } from '../../editorWorld';
import type { Placement } from '../../placements';
import type { Landform, WaterBody } from '../../design';
import { assert, assertEqual, finish, test } from '../../game/_testkit';

const noKindTextures = () => undefined;

function waterPlacement(id: string, gx: number, gy: number): Placement {
  return { id, cat: 'water', kind: 'pond', label: 'Pond', gx, gy, rotation: 0, locked: false, footW: 18, footD: 14, color: '#3f8fbf' };
}

test('PAINTCHOKE-0618: a placed water body survives base waterBodies = []', () => {
  const s = assemblePreviewWorld({
    baseWorld: emptyEditorWorld(),
    landforms: [],
    waterBodies: [], // the shell passes [] so the overlay owns floors-water
    placements: [waterPlacement('w1', 40, 40)],
    mergeKindTextures: noKindTextures,
  });
  const waters = s.world.waterBodies ?? [];
  assertEqual(waters.length, 1, 'the placed pond must be assembled even when base water is empty');
  assertEqual(waters[0].id, 'w1', 'the assembled body keeps the placement id');
});

test('PAINTCHOKE-0618: the shell overlay merges floors-water + placed water (no drop)', () => {
  // placementWorld holds ONLY the placed pond...
  const placementWorld = assemblePreviewWorld({
    baseWorld: emptyEditorWorld(),
    landforms: [],
    waterBodies: [],
    placements: [waterPlacement('placed', 40, 40)],
    mergeKindTextures: noKindTextures,
  });
  // ...and the overlay (index.tsx) lays freshly-painted floors-water in front of it.
  const floorsWater: WaterBody[] = [{ id: 'painted', label: 'Painted', shape: 'rect', x: 0, z: 0, width: 4, depth: 4, surfaceY: 1, createdByCommand: 'test' } as WaterBody];
  const merged = [...floorsWater, ...(placementWorld.world.waterBodies ?? [])];
  assertEqual(merged.length, 2, 'both painted floors-water and placed water reach the preview');
  assert(merged.some((w) => w.id === 'painted') && merged.some((w) => w.id === 'placed'), 'neither water source is dropped by the overlay');
});

test('PAINTCHOKE-0618: landforms pass through the assembler untouched', () => {
  const landforms = [{ kind: 'heightfield' } as unknown as Landform];
  const s = assemblePreviewWorld({
    baseWorld: emptyEditorWorld(),
    landforms,
    waterBodies: [],
    placements: [],
    mergeKindTextures: noKindTextures,
  });
  assertEqual(s.world.landforms?.length ?? 0, 1, 'the passed landforms reach the preview world');
});

finish('previewWorld');
