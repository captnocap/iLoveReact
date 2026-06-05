// mapload.test.ts — P4 regression for MAPGONE2-0605: the homepage map canvas's
// LOAD/DISPLAY chain, pinned end to end so "the map looks gone" can never again
// hide in an untested hop.
//
// What tonight's diagnosis established (probes, hop by hop): the painted data
// survives pointer → session file → envelope → deserializeMap → encodeTileMap →
// the GPU buffer → the shader lookup. The actual break was the BOOT VIEW — the
// 2D canvas camera was never persisted, so every remount (map restore, undo,
// hot reload) snapped the viewport to the lattice origin; on a map whose origin
// chunk is featureless at that zoom, the canvas reads as "blank" while every
// byte is intact. This suite pins BOTH: the data chain delivers N painted cells
// (never zero), and the boot view law (saved view restored; otherwise the
// painted-content centre, never the bare origin on a non-empty map).

import { buildEnvelope, parseEnvelope, serializeEnvelope } from '@reactjit/workspace';
import { deserializeMap, emptyMap, isSaneView2d, paintedCenter, VIEW_SANITY, serializeMap, type EditorWorld, type MapSnapshot } from '../../mapStore';
import { encodeTileMap, paintTile, tileKindIndex, TILE_PALETTE } from '../../tileData';
import { chunkKey, makeChunk, CHUNK_TILES } from '../../chunks';
import { TILE_UNITS } from '../../heightData';
import { assert, assertClose, assertEqual, finish, test } from '../../game/_testkit';

const CART = 'hmsc-int';
const VERSION = 2;
const PATCH = CHUNK_TILES * TILE_UNITS;

/** A synthetic authored map: chunk (1,1) carries a known mixed paint job
 *  AWAY from the lattice origin (tonight's real shape — origin featureless,
 *  city elsewhere). */
function paintedWorld(): { world: EditorWorld; painted: number } {
  const chunks = new Map();
  const c = makeChunk(1, 1);
  let painted = 0;
  const sidewalk = tileKindIndex('sidewalk');
  const water = tileKindIndex('water');
  const road = tileKindIndex('road');
  assert(sidewalk >= 0 && water >= 0 && road >= 0, 'the global kinds exist');
  for (let y = 10; y < 30; y++) {
    for (let x = 10; x < 30; x++) {
      paintTile(c.tiles, x, y, (x + y) % 3 === 0 ? water : (x + y) % 3 === 1 ? road : sidewalk);
      painted++;
    }
  }
  chunks.set(chunkKey(1, 1), c);
  return {
    world: { chunks, zones: [], focus: new Set([chunkKey(1, 1)]), placements: [] },
    painted,
  };
}

test('the renderer-consumed surface receives N painted cells, not zero (the full load chain)', () => {
  const { world, painted } = paintedWorld();
  // author → session file text → envelope parse → decode (exactly index.tsx's boot)
  const text = serializeEnvelope(buildEnvelope({ cartName: CART, version: VERSION, stem: 'mapgone-regression', payload: { world: serializeMap(world) } }));
  const env = parseEnvelope<{ world: MapSnapshot }>(text, { cartName: CART, version: VERSION });
  assert(env !== null, 'the session envelope parses');
  const decoded = deserializeMap(env!.payload.world);

  // the EXACT array ChunkSurface hands its Effect quad
  const chunk = decoded.chunks.get(chunkKey(1, 1))!;
  assert(chunk != null, 'the painted chunk survives the chain');
  const enc = encodeTileMap(chunk.tiles);
  const header = 3 + enc[2] * 3;
  let received = 0;
  const kinds = new Set<number>();
  for (let i = header; i < enc.length; i++) {
    if (enc[i] >= 0) {
      received++;
      kinds.add(enc[i]);
    }
  }
  assertEqual(received, painted, 'the renderer-consumed surface receives every painted cell');
  assert(kinds.size >= 3, 'the cells keep their distinct kinds (no uniform-wash)');
  // the palette region is multi-color (a uniform palette renders everything one color)
  const colors = new Set<string>();
  for (let k = 0; k < enc[2]; k++) colors.add(`${enc[3 + k * 3]},${enc[4 + k * 3]},${enc[5 + k * 3]}`);
  assert(colors.size >= 6, 'the palette ships distinct colors');
  assertEqual(enc[2], TILE_PALETTE.length, 'the palette count matches the registry');
});

test('the boot view law: painted-content centre when no view is saved — never the bare origin', () => {
  const { world } = paintedWorld();
  const center = paintedCenter(world, TILE_UNITS);
  assert(center !== null, 'a painted map has a content centre');
  // painted block: cells 10..29 of chunk (1,1) → centred at cell 20 →
  // graph = 1*PATCH − PATCH/2 + 20*TILE_UNITS (the ChunkSurface lattice law)
  const expected = PATCH - PATCH / 2 + 20 * TILE_UNITS;
  assertClose(center!.gx, expected, TILE_UNITS, 'the centre sits on the painted block (x)');
  assertClose(center!.gy, expected, TILE_UNITS, 'the centre sits on the painted block (y)');
  assert(Math.hypot(center!.gx, center!.gy) > PATCH / 2, 'the centre is NOT the lattice origin (tonight\'s blank-canvas view)');

  assertEqual(paintedCenter(emptyMap(), TILE_UNITS), null, 'an empty map has no content centre (host default applies)');
});

test('a saved 2D view round-trips the envelope (schema addition — old files stay valid)', () => {
  const view2d = { x: 3120, y: 2880, zoom: 1.6 };
  const text = serializeEnvelope(buildEnvelope({ cartName: CART, version: VERSION, stem: 'view-roundtrip', payload: { world: serializeMap(paintedWorld().world), view2d } }));
  const env = parseEnvelope<{ world: MapSnapshot; view2d?: { x: number; y: number; zoom: number } }>(text, { cartName: CART, version: VERSION });
  assert(env !== null, 'parses');
  assertEqual(JSON.stringify(env!.payload.view2d), JSON.stringify(view2d), 'the saved camera survives byte-exact');

  // an OLD payload (no view2d) still parses — schema evolution by addition
  const old = serializeEnvelope(buildEnvelope({ cartName: CART, version: VERSION, stem: 'old-file', payload: { world: serializeMap(paintedWorld().world) } }));
  const oldEnv = parseEnvelope<{ view2d?: unknown }>(old, { cartName: CART, version: VERSION });
  assert(oldEnv !== null && oldEnv!.payload.view2d === undefined, 'a pre-fix file parses with no view (fallback path)');
});

test('VIEWRUNAWAY-0605: the sanity law rejects the runaway, accepts the workshop', () => {
  const { world } = paintedWorld(); // content in chunk (1,1): roughly x/z [3,12] graph units ×24
  // the user's ACTUAL degraded saves (a buried canvas drifting under /build for minutes)
  assert(!isSaneView2d({ x: -174185, y: -1439464, zoom: 0.1 }, world, TILE_UNITS), 'the first logged runaway is rejected');
  assert(!isSaneView2d({ x: -298347, y: -2255629, zoom: 0.1 }, world, TILE_UNITS), 'the later, worse one too');
  assert(!isSaneView2d({ x: NaN, y: 0, zoom: 1 }, world, TILE_UNITS), 'non-finite is rejected');
  assert(!isSaneView2d({ x: 0, y: 0, zoom: 0 }, world, TILE_UNITS), 'degenerate zoom is rejected');
  assert(!isSaneView2d(null, world, TILE_UNITS), 'absent is not sane (the fallback path)');
  // a view over the painted content (or within the margin) is believable
  const center = paintedCenter(world, TILE_UNITS)!;
  assert(isSaneView2d({ x: center.gx, y: center.gy, zoom: 1 }, world, TILE_UNITS), 'the content centre passes');
  const margin = VIEW_SANITY.marginChunks * CHUNK_TILES * TILE_UNITS;
  assert(isSaneView2d({ x: center.gx + margin * 0.9, y: center.gy, zoom: 0.2 }, world, TILE_UNITS), 'wandering inside the margin passes');
  assert(!isSaneView2d({ x: center.gx + margin * 3, y: center.gy, zoom: 1 }, world, TILE_UNITS), 'far past the margin fails');
  // a blank map measures against the origin chunk
  assert(isSaneView2d({ x: 0, y: 0, zoom: 1 }, emptyMap(), TILE_UNITS), 'a blank map accepts the origin');
  assert(!isSaneView2d({ x: -174185, y: -1439464, zoom: 0.1 }, emptyMap(), TILE_UNITS), 'and still rejects the runaway');
});

finish('editors/world/mapload');
