// render tests - the ASCII adapter consumes the same compiled bytes as the
// native/Three load path and emits a stable terminal-sized projection.

import { assert, assertEqual, finish, test } from '../../../game/_testkit';
import { MAP_LUMP, writeLumpContainer, type LumpInput } from '@reactjit/workspace';
import { writeGameFile } from '@reactjit/workspace/gamefile';
import { encodeInstanceLump, INSTANCE_STRIDE } from '../../../compile/worldGeometry';
import { asciiFromGameFile, buildAsciiMap } from './render';
import { loadSceneFromMapContainer } from '../tsLoader/decode';

function container(extra: LumpInput[]): Uint8Array {
  return writeLumpContainer(extra);
}

function gamefileWithInstances(rows: Float32Array, pieceCount: number): Uint8Array {
  const map = container([
    { type: MAP_LUMP.INSTANCES, encoding: 'raw', data: encodeInstanceLump(rows, pieceCount, INSTANCE_STRIDE) },
  ]);
  return writeGameFile({
    logic: { refs: [], data: new Uint8Array(0) },
    map: { refs: [], data: map },
    skins: { refs: [], data: new Uint8Array(0) },
    assets: [],
  });
}

test('gamefile bytes project into fixed-size ASCII lines', () => {
  const rows = new Float32Array([
    -6, 0, -6, 0, 0, 0, 3, 12, 3, 0.2, 0.2, 0.2, 0,
     0, 0,  0, 0, 0, 0, 4,  0.2, 4, 0.1, 0.1, 0.1, 0,
     6, 0,  6, 0, 0, 0, 1,  2,   1, 0.1, 0.6, 0.1, 9,
  ]);

  const map = asciiFromGameFile(gamefileWithInstances(rows, 3), { cols: 24, rows: 10, scope: 'pieces', paddingMeters: 1 });
  const text = map.lines.join('\n');

  assertEqual(map.lines.length, 10, 'line count');
  assert(map.lines.every((line) => line.length <= 24), 'line width is bounded');
  assert(text.includes('H'), 'tall box appears as building glyph');
  assert(text.includes('*'), 'foliage-shaped row appears as foliage glyph');
  assertEqual(map.stats.sceneInstances, 3, 'scene instance count');
  assertEqual(map.stats.pieceCount, 3, 'piece count');
});

test('higher-priority structures survive low ground at the same cell', () => {
  const rows = new Float32Array([
    0, 0, 0, 0, 0, 0, 8, 0.2, 8, 0.1, 0.1, 0.1, 0,
    0, 0, 0, 0, 0, 0, 2, 6,   2, 0.4, 0.4, 0.4, 0,
  ]);
  const scene = loadSceneFromMapContainer(container([
    { type: MAP_LUMP.INSTANCES, encoding: 'raw', data: encodeInstanceLump(rows, 2, INSTANCE_STRIDE) },
  ]));

  const map = buildAsciiMap(scene, { cols: 9, rows: 5, scope: 'pieces', paddingMeters: 1, maxFootprintCells: 100 });
  assert(map.lines.join('\n').includes('#'), 'structure glyph wins over ground glyph');
});

finish('asciiLoader/render');
