// painter.test.ts — the One Painter contracts (PAINTER-0610, req_0593).
//
// P4 behavior suite: pins the pure seams of the painter rebuild —
//   1. resolvePainterBehavior: tool × target → overlay behavior, including the
//      Object+Select → 'none' rule that keeps native Canvas.Node drag alive.
//   2. painterToolUsable: erase-everywhere + the one dim case (Paint on Object
//      with nothing armed).
//   3. encodePainterSurface: the combined chunk buffer's section offsets —
//      every section ALWAYS emitted with explicit headers (GHOSTROAD-0610), so
//      the shader (painterView.wgsl.ts) can derive offsets from the data alone.

import { resolvePainterBehavior, painterToolUsable, type PainterBehavior } from '../../painterBehavior';
import { encodePainterSurface, PAINTER_EMPHASIS_FLOATS } from '../../painterSurface';
import { makeChunk, CHUNK_TILES } from '../../chunks';
import { paintTile, tileKindIndex } from '../../tileData';
import { paintZoneCell, type ZoneDef } from '../../zoneData';
import type { Layer, Tool } from '../../PaintCanvas';
import { assert, assertEqual, finish, test } from '../../game/_testkit';

test('PAINTER-0610: the behavior resolver truth table (tool × target)', () => {
  const expect: Array<[Tool, Layer, boolean, PainterBehavior]> = [
    // Select is universal — except Object, where the native nodes own the pointer.
    ['pointer', 'paint', false, 'select'],
    ['pointer', 'height', false, 'select'],
    ['pointer', 'zone', false, 'select'],
    ['pointer', 'road', false, 'select'],
    ['pointer', 'place', true, 'none'],
    // Paint strokes the brush targets, lays road points, stamps the armed object.
    ['brush', 'paint', false, 'stroke'],
    ['brush', 'height', false, 'stroke'],
    ['brush', 'zone', false, 'stroke'],
    ['brush', 'road', false, 'click'],
    ['brush', 'place', true, 'stroke'],
    ['brush', 'place', false, 'none'], // nothing armed → native nodes stay live
    // Erase works on EVERY target (the erase-everywhere ruling).
    ['eraser', 'paint', false, 'stroke'],
    ['eraser', 'height', false, 'stroke'],
    ['eraser', 'zone', false, 'stroke'],
    ['eraser', 'road', false, 'click'],
    ['eraser', 'place', false, 'stroke'],
  ];
  for (const [tool, target, placeArmed, want] of expect) {
    assertEqual(
      resolvePainterBehavior({ tool, target, placeArmed }),
      want,
      `${tool} on ${target}${placeArmed ? ' (armed)' : ''} → ${want}`,
    );
  }
});

test('PAINTER-0610: tool usability — erase everywhere, Paint dims on an unarmed Object target', () => {
  const targets: Layer[] = ['paint', 'height', 'zone', 'place', 'road'];
  for (const t of targets) {
    assert(painterToolUsable('pointer', t, false), `select usable on ${t}`);
    assert(painterToolUsable('eraser', t, false), `erase usable on ${t}`);
  }
  assert(!painterToolUsable('brush', 'place', false), 'Paint on Object with nothing armed is dimmed');
  assert(painterToolUsable('brush', 'place', true), 'Paint on Object with an armed object is live');
  assert(painterToolUsable('brush', 'road', false), 'Paint on Road lays centerline points');
});

test('PAINTER-0610 + GHOSTROAD-0610: the combined surface buffer emits every section with explicit headers', () => {
  const chunk = makeChunk(0, 0);
  const sidewalk = tileKindIndex('sidewalk');
  paintTile(chunk.tiles, 3, 5, sidewalk);
  paintZoneCell(chunk.zones, 2, 2, 0);
  chunk.height.z[7] = 4.5;
  const zones: ZoneDef[] = [{ id: 'z_1', name: 'Zone 1', color: '#22d3ee', flags: [] }];
  const enc = encodePainterSurface(chunk, zones, undefined, { road: 1, height: 0.3, zone: 0.25 });

  // Emphasis header rides the front.
  assertEqual(enc[0], 1, 'opRoad at [0]');
  assertEqual(enc[1], 0.3, 'opHeight at [1]');
  assertEqual(enc[2], 0.25, 'opZone at [2]');

  // Tile section.
  const tBase = PAINTER_EMPHASIS_FLOATS;
  const cols = enc[tBase]!, rows = enc[tBase + 1]!, pal = enc[tBase + 2]!;
  assertEqual(cols, CHUNK_TILES, 'tile cols');
  assertEqual(rows, CHUNK_TILES, 'tile rows');
  assert(pal > 0, 'tile palette present');
  const cellBase = tBase + 3 + pal * 3;
  assertEqual(enc[cellBase + 5 * cols + 3], sidewalk, 'painted tile rides the tile section');

  // Road section: ALWAYS present, segN=0 when no roads — omission would leave
  // the previous tenant alive in the grow-only Effect buffer (GHOSTROAD-0610).
  const cellEnd = cellBase + cols * rows;
  assertEqual(enc[cellEnd], 0, 'segN=0 header emitted with no roads');

  // Height section (encodeField layout: hcols, hrows, visRef, tilesX, tilesY, z…).
  const hBase = cellEnd + 5 + enc[cellEnd]! * 8;
  const hcols = enc[hBase]!, hrows = enc[hBase + 1]!;
  assert(hcols > 1 && hrows > 1, 'height grid present');
  assertEqual(enc[hBase + 5 + 7], 4.5, 'height sample rides the height section');

  // Zone section closes the buffer exactly.
  const zBase = hBase + 5 + hcols * hrows;
  assertEqual(enc[zBase], cols, 'zone cols');
  assertEqual(enc[zBase + 1], rows, 'zone rows');
  assertEqual(enc[zBase + 2], 1, 'zone palette count = zone defs');
  const zCellBase = zBase + 3 + 1 * 3;
  assertEqual(enc[zCellBase + 2 * cols + 2], 0, 'painted zone cell rides the zone section');
  assertEqual(enc.length, zCellBase + cols * rows, 'buffer ends exactly after the zone cells — no trailing slack');

  // A road section round-trips its segments at the same derivable offsets.
  const seg = [10, 10, 30, 10, 2.5, 2.5, 1, 0];
  const enc2 = encodePainterSurface(chunk, zones, seg, { road: 1, height: 1, zone: 1 });
  assertEqual(enc2[cellEnd], 1, 'segN counts the appended segment');
  assertEqual(enc2[cellEnd + 5], 10, 'segment floats follow the road header');
  const hBase2 = cellEnd + 5 + 1 * 8;
  assertEqual(enc2[hBase2], hcols, 'height section shifts past the road segs and stays addressable');
});

finish('editors/world/painter');
