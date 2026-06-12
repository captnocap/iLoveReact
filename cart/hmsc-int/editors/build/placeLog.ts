// editors/build/placeLog — the req_0671 placement-lattice log. Every build
// commit path (F2 + iso: click place, prefab stamp, drag paint, clone, move,
// tower/building) warns ONE line per landed piece with its 3m-lattice phase
// and an ON/OFF verdict, so a mis-gridded placement names itself in the dev
// terminal the moment it lands. console.warn on purpose: severity-0 lines
// only reach the in-memory ring, never the terminal.
//
// The lattice law being checked (GRIDSNAP-0605 + req_0668):
//   3m plates (floor/roof)  center phase ≡ (1.5, 1.5) mod 3
//   3m walls                line axis ≡ 0 mod 3, run axis ≡ 1.5 mod 3
//   everything else         no verdict (props legitimately ride the 1m grid)

import { GAME_BUILD, type BuildPrefabDef } from '@game';

const TAG = '[placelog]';
const BATCH_CAP = 12; // a 352-piece building move must not firehose the terminal
const TOLERANCE = 1e-3;

type Landed = { pieceId: string; x: number; y: number; z: number; yawDegrees: number };

function phase(v: number, pitch: number): number {
  return ((v % pitch) + pitch) % pitch;
}

function fmtPhase(v: number): string {
  return phase(v, 3).toFixed(2);
}

/** ON/OFF verdict against the 3m module lattice — only for pieces whose law
 *  is unambiguous (3m plates and 3m walls). */
function latticeVerdict(kind: string, sizeWidthMeters: number, x: number, z: number, yawDegrees: number): string {
  const off = (axis: string, v: number, want: number) => {
    const d = phase(v - want + 1.5, 3) - 1.5; // signed distance to the wanted phase
    return `${axis}${d >= 0 ? '+' : ''}${d.toFixed(2)}`;
  };
  if ((kind === 'floor' || kind === 'roof') && Math.abs(sizeWidthMeters - 3) < TOLERANCE) {
    const okX = Math.abs(phase(x - 1.5, 3)) < TOLERANCE || Math.abs(phase(x - 1.5, 3) - 3) < TOLERANCE;
    const okZ = Math.abs(phase(z - 1.5, 3)) < TOLERANCE || Math.abs(phase(z - 1.5, 3) - 3) < TOLERANCE;
    return okX && okZ ? 'ON' : `OFF(${off('x', x, 1.5)} ${off('z', z, 1.5)})`;
  }
  if (kind === 'wall' && Math.abs(sizeWidthMeters - 3) < TOLERANCE) {
    const quarter = Math.round((((yawDegrees % 360) + 360) % 360) / 90) % 4;
    const [line, run, lineAxis, runAxis] = quarter % 2 === 0 ? [z, x, 'z', 'x'] : [x, z, 'x', 'z'];
    const okLine = phase(line, 3) < TOLERANCE || phase(line, 3) > 3 - TOLERANCE;
    const okRun = Math.abs(phase(run - 1.5, 3)) < TOLERANCE || Math.abs(phase(run - 1.5, 3) - 3) < TOLERANCE;
    return okLine && okRun ? 'ON' : `OFF(${off(lineAxis, line, 0)} ${off(runAxis, run, 1.5)})`;
  }
  return '·'; // no single lattice law for this piece — phase printed, judge by eye
}

function pieceLine(indent: string, landed: Landed): string {
  const def = GAME_BUILD.catalog.is(landed.pieceId) ? GAME_BUILD.catalog.get(landed.pieceId) : null;
  const kind = def ? def.kind : '?';
  const verdict = def ? latticeVerdict(kind, def.size.widthMeters, landed.x, landed.z, landed.yawDegrees) : '·';
  return `${indent}${landed.pieceId} (${kind}) → x=${landed.x.toFixed(2)} z=${landed.z.toFixed(2)} y=${landed.y.toFixed(2)} yaw=${landed.yawDegrees} phase3=(${fmtPhase(landed.x)},${fmtPhase(landed.z)}) ${verdict}`;
}

/** One landed piece (click place, and each piece of a batch). */
export function logPiecePlaced(source: string, placement: Landed): void {
  console.warn(`${TAG} ${source} ${pieceLine('', placement)}`);
}

/** A multi-piece commit (drag paint, clone, move, building shell) — capped. */
export function logPiecesPlaced(source: string, placements: readonly Landed[]): void {
  console.warn(`${TAG} ${source} — ${placements.length} piece(s):`);
  for (const p of placements.slice(0, BATCH_CAP)) console.warn(`${TAG}   ${pieceLine('', p)}`);
  if (placements.length > BATCH_CAP) console.warn(`${TAG}   … ${placements.length - BATCH_CAP} more (capped)`);
}

/** A prefab stamp: the armed def, the anchor the snap used, the committed
 *  origin, and where every decomposed piece LANDS. */
export function logPrefabStamped(source: string, def: BuildPrefabDef, origin: { x: number; y: number; z: number }, yawDegrees: number): void {
  const anchor = GAME_BUILD.prefabs.gridAnchor(def);
  const anchorText = anchor
    ? `anchor=(${anchor.x.toFixed(2)},${anchor.z.toFixed(2)}) pitch=${anchor.size.widthMeters}m`
    : 'anchor=NONE (plateless → origin snap)';
  console.warn(`${TAG} ${source} stamp ${def.id} origin=(${origin.x.toFixed(2)},${origin.z.toFixed(2)}) y=${origin.y.toFixed(2)} yaw=${yawDegrees} ${anchorText}`);
  const stamped = GAME_BUILD.placed.stamp(def, origin, yawDegrees);
  for (const p of stamped.slice(0, BATCH_CAP)) console.warn(`${TAG}   ${pieceLine('', p)}`);
  if (stamped.length > BATCH_CAP) console.warn(`${TAG}   … ${stamped.length - BATCH_CAP} more (capped)`);
}
