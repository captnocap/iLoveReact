import { createInitialGameState, reviveGameState } from '../state/gameState';
import { worldStream } from './world/stream';
import { assert, assertEqual, finish, test } from './_testkit';

test('AUTHBUILD-REMOVE-0606: fresh game state has no legacy authored buildings', () => {
  const state = createInitialGameState();
  assertEqual(state.world.buildings.length, 0, 'fresh boot must not spawn hardcoded building_demo structures');
  assertEqual(Object.keys(state.world.interiors).length, 0, 'fresh boot must not wire demo building interiors');
  assertEqual(Object.keys(state.world.placedCells).length, 0, 'fresh boot must not leave demo entry pads');
});

test('AUTHBUILD-REMOVE-0606: stale saved world.buildings are dropped on revive', () => {
  const base = createInitialGameState();
  const stale = {
    ...base,
    world: {
      ...base.world,
      buildings: [
        {
          id: 'seed_a',
          kind: 'tower',
          label: 'Seed Tower',
          enclosure: 'interior',
          x: 10,
          y: 0,
          z: 10,
          widthTiles: 8,
          depthTiles: 8,
          doorSide: 'south',
          createdByCommand: 'initial-world',
        },
        {
          id: 'user_a',
          kind: 'shop',
          label: 'User Shop',
          enclosure: 'hollow',
          x: 30,
          y: 0,
          z: 30,
          widthTiles: 8,
          depthTiles: 8,
          doorSide: 'south',
          createdByCommand: 'hmsc-int:place',
        },
      ],
      interiors: {
        seed_a_interior: { id: 'seed_a_interior' },
        user_a_interior: { id: 'user_a_interior' },
      },
      placedCells: {
        '10,0,9': {
          key: '10,0,9',
          kind: 'door',
          cell: { x: 10, y: 0, z: 9 },
          triggerCommand: 'wv_enter seed_a',
          triggerLabel: 'Enter Seed Tower',
          createdByCommand: 'building-interior',
        },
        '30,0,29': {
          key: '30,0,29',
          kind: 'door',
          cell: { x: 30, y: 0, z: 29 },
          triggerCommand: 'wv_enter user_a',
          triggerLabel: 'Enter User Shop',
          createdByCommand: 'building-interior',
        },
        '40,0,40': {
          key: '40,0,40',
          kind: 'spawn',
          cell: { x: 40, y: 0, z: 40 },
          createdByCommand: 'hmsc-int:marker',
        },
      },
    },
  };

  const revived = reviveGameState(JSON.stringify(stale));
  assert(revived !== null, 'stale save must still revive');
  assertEqual(revived!.world.buildings.length, 0, 'all legacy world.buildings records are removed');
  assertEqual(Object.keys(revived!.world.interiors).length, 0, 'legacy building interiors are removed');
  assertEqual(Boolean(revived!.world.placedCells['10,0,9']), false, 'seed entry pad is removed');
  assertEqual(Boolean(revived!.world.placedCells['30,0,29']), false, 'hmsc-int legacy building entry pad is removed');
  assertEqual(Boolean(revived!.world.placedCells['40,0,40']), true, 'non-building marker cells survive');
});

test('AUTHBUILD-REMOVE-0606: V24 bp_* build pieces are unaffected', () => {
  let state = worldStream.initial();
  state = worldStream.apply(state, {
    kind: 'piecePlaced',
    placement: { pieceId: 'floor.concrete.common', x: 0, y: 0, z: 0, yawDegrees: 0 },
    mapName: '/',
  });
  state = worldStream.apply(state, {
    kind: 'piecePlaced',
    placement: { pieceId: 'wall.concrete.common', x: 1.5, y: 0.2, z: 0, yawDegrees: 0 },
    mapName: '/',
  });

  const pieces = state.piecesByMap['/'];
  assertEqual(pieces.length, 2, 'build-piece stream still materializes placed pieces');
  assertEqual(pieces[0].id, 'bp_1', 'first build piece id survives AUTHBUILD removal');
  assertEqual(pieces[1].id, 'bp_2', 'second build piece id survives AUTHBUILD removal');
});

finish('game/authored-buildings');
