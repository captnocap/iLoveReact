// thinFloorMigrate — retarget existing placed pieces from the OLD 0.2m floor
// top onto the new THINFLOOR 0.05m top (req_2041, USER ASK "apply it to all
// existing pieces in the data").
//
// WHY: catalog.ts thinned the floor plate 0.2m → 0.05m (req_2034). New floors
// read their size from the catalog, so they are already thin — but pieces that
// were placed RESTING on a fat 0.2 floor have a baked-in Y offset of 0.2 × (the
// number of floors stacked below them): a ground-floor wall sits at base+0.2, a
// 2nd-storey wall at base+0.4, an elevator stack at 0.2/3.2/6.2, etc. With thin
// floors those pieces now float 0.15 × (floors below) above where they belong.
// `liftWallsOntoFloors` only ever LIFTS (never lowers), so it cannot pull them
// back down — the stale offset is in the stored data and must be rewritten.
//
// THE TRANSFORM (exact, no magic): the fractional part of a resting piece's Y is
// 0.2 × k where k = floors-below. The new rest is base + 0.05 × k. So
//   y_new = floor(y) + 0.05 × round(frac(y) / 0.2)
// applied ONLY to pieces whose frac(y) is within 1e-4 of a 0.2-multiple (k∈1..4)
// — terrain props rest on the heightfield at arbitrary fractional heights and
// never land on an exact 0.2 boundary, so the filter leaves them untouched.
//
// HOW: this is an append-only event-sourced store (data/index.ts) — nothing
// rewrites the log. We append one `pieceMoved` event per piece (the same event
// the editor emits when you drag a piece), inside one batch, then materialize
// the snapshots the game/compile load. Fully undoable via the V20 undo chain.
//
// Run (dry-run prints the plan, applies nothing):
//   tools/esbuild cart/hmsc-int/tools/thinFloorMigrate.ts --bundle --format=iife \
//     --platform=neutral --target=es2022 <aliases> --outfile=.cache/thinmig.js
//   tools/v8cli .cache/thinmig.js            # dry-run
//   tools/v8cli .cache/thinmig.js --apply    # commit

import { openStreamStore } from '../data';
import { worldStream, type WorldStreamState } from '@game';
import type { PlacedBuildPiece } from '@game';

declare const globalThis: any;

const DATA_ROOT = 'cart/hmsc-int/data';
const OLD_FLOOR = 0.2;
const NEW_FLOOR = 0.05;
const TOL = 1e-4;

const argv: string[] = (() => {
  try {
    return typeof globalThis.__argv === 'function' ? JSON.parse(globalThis.__argv()) : [];
  } catch {
    return [];
  }
})();
const APPLY = argv.includes('--apply');

/** floors-below count k if y rests on a 0.2-multiple boundary, else 0 (untouched). */
function floorOffsetK(y: number): number {
  const frac = y - Math.floor(y);
  for (let k = 1; k <= 4; k += 1) {
    if (Math.abs(frac - OLD_FLOOR * k) < TOL) return k;
  }
  return 0;
}

type Planned = { id: string; x: number; y: number; z: number; yawDegrees: number; mapName?: string; oldY: number; pieceId: string };

const store = openStreamStore(DATA_ROOT, 'world');
const world = store.defineStream(worldStream);
const state = world.state() as WorldStreamState;

const planned: Planned[] = [];
const scan = (arr: readonly PlacedBuildPiece[] | undefined, mapName?: string): void => {
  for (const p of arr ?? []) {
    if (typeof p?.y !== 'number') continue;
    const k = floorOffsetK(p.y);
    if (k === 0) continue;
    planned.push({
      id: p.id,
      x: p.x,
      y: Math.floor(p.y) + NEW_FLOOR * k,
      z: p.z,
      yawDegrees: p.yawDegrees ?? 0,
      mapName,
      oldY: p.y,
      pieceId: p.pieceId,
    });
  }
};
scan(state.pieces, undefined);
for (const [map, arr] of Object.entries(state.piecesByMap ?? {})) scan(arr, map);

const byMap: Record<string, number> = {};
for (const pl of planned) byMap[pl.mapName ?? '(global)'] = (byMap[pl.mapName ?? '(global)'] ?? 0) + 1;

console.warn(`[thinfloor] ${planned.length} piece(s) to retarget 0.2-floor-top → 0.05; by map: ${JSON.stringify(byMap)}`);
for (const pl of planned.slice(0, 12)) {
  console.warn(`[thinfloor]   ${pl.mapName ?? '(global)'} ${pl.pieceId} ${pl.id}: y ${pl.oldY} → ${pl.y}`);
}
if (planned.length > 12) console.warn(`[thinfloor]   … ${planned.length - 12} more`);

if (!APPLY) {
  console.warn('[thinfloor] DRY RUN — nothing written. Re-run with --apply to commit.');
} else {
  store.batch(() => {
    for (const pl of planned) {
      world.append({ kind: 'pieceMoved', id: pl.id, x: pl.x, y: pl.y, z: pl.z, yawDegrees: pl.yawDegrees, mapName: pl.mapName });
    }
  });
  const written = store.materializeSnapshots();
  console.warn(`[thinfloor] APPLIED ${planned.length} pieceMoved event(s); materialized ${written.length} snapshot(s).`);
}
