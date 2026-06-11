// propScaleCli.ts — `tools/prop-scale`'s entry (runs under tools/v8cli).
//
// A static size-comparison readout: every hmsc-int prop kind measured against
// the player model, so a wrong heightMeters is caught by reading one table
// instead of booting the editor (req_0605). The player reference is NOT a
// hardcoded number — it is measured from the live stand-pose skeleton
// (game/figure/skeleton.ts), so the readout tracks the figure if it changes.
//
//   tools/prop-scale                 # every prop, tallest first
//   tools/prop-scale tree bush       # substring filter on kind/label
//   tools/prop-scale --sort name     # alphabetical
//   tools/prop-scale --json          # machine-readable rows

import { PROP_KIND_DEFINITIONS, type PropKindDefinition } from './propKinds';
import { HMSC_SCALE } from './scale';
import { buildSkeleton } from '../game/figure/skeleton';

declare const process: { argv: string[] } | undefined;
const argv = typeof process !== 'undefined' ? process.argv.slice(1) : [];

// ── the player reference, measured off the actual figure ────────────────────
const bones = buildSkeleton('neutral', 'stand');
// Same formula the skeleton behavior test asserts: skull center + half its
// hit volume is the visual top of the head.
const headTop = bones.head.position[1] + bones.head.hitbox[1] / 2;
const eyes = bones.head.position[1];
const chest = bones.lShoulder.position[1];
const waist = bones.pelvis.position[1];
const knee = bones.lKnee.position[1];
const capsuleDiameter = HMSC_SCALE.playerCapsuleRadiusMeters * 2;

/** The body landmark a prop of height h tops out at — the instant-read column. */
function landmark(h: number): string {
  if (h <= knee) return 'below knee';
  if (h <= waist) return 'waist-high';
  if (h <= chest) return 'chest-high';
  if (h <= eyes) return 'eye-level';
  if (h <= headTop) return 'head-high';
  if (h <= headTop * 2) return 'over head';
  return 'towering';
}

// ── the bar chart: 1 cell = 25cm, with the player's head-top line marked ────
const M_PER_CELL = 0.25;
const BAR_CAP_CELLS = 56; // 14m — the 13m massive bush still fits on-scale
const playerCell = Math.round(headTop / M_PER_CELL);

function bar(h: number): string {
  const len = Math.min(Math.max(Math.round(h / M_PER_CELL), 1), BAR_CAP_CELLS);
  const cells: string[] = [];
  for (let i = 0; i < Math.max(len, playerCell + 1); i++) cells.push(i < len ? '█' : ' ');
  // the player line: visible whether the prop falls short of it or crosses it
  cells[playerCell] = len > playerCell ? '▓' : '│';
  if (h / M_PER_CELL > BAR_CAP_CELLS) cells.push('»');
  return cells.join('');
}

// ── args ─────────────────────────────────────────────────────────────────────
let sortBy: 'height' | 'name' = 'height';
let asJson = false;
const filters: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--sort') sortBy = argv[++i] === 'name' ? 'name' : 'height';
  else if (a === '--json') asJson = true;
  else if (a) filters.push(a.toLowerCase());
}

const defs = (Object.values(PROP_KIND_DEFINITIONS) as PropKindDefinition[]).filter(
  (d) => filters.length === 0
    || filters.some((f) => d.kind.toLowerCase().includes(f) || d.label.toLowerCase().includes(f)),
);
defs.sort(sortBy === 'name'
  ? (a, b) => a.kind.localeCompare(b.kind)
  : (a, b) => b.heightMeters - a.heightMeters || a.kind.localeCompare(b.kind));

if (defs.length === 0) {
  console.log(`no prop kind matches ${filters.join(' ')}`);
} else if (asJson) {
  console.log(JSON.stringify({
    player: { headTopMeters: +headTop.toFixed(3), eyesMeters: +eyes.toFixed(3), chestMeters: +chest.toFixed(3), waistMeters: +waist.toFixed(3), kneeMeters: +knee.toFixed(3), capsuleHeightMeters: HMSC_SCALE.playerCapsuleHeightMeters, capsuleDiameterMeters: capsuleDiameter },
    props: defs.map((d) => ({
      kind: d.kind,
      label: d.label,
      heightMeters: d.heightMeters,
      heightVsPlayer: +(d.heightMeters / headTop).toFixed(3),
      topsOutAt: landmark(d.heightMeters),
      footprintDiameterMeters: d.footprintRadiusMeters * 2,
      footprintVsPlayer: +((d.footprintRadiusMeters * 2) / capsuleDiameter).toFixed(3),
      solid: d.solid,
    })),
  }, null, 2));
} else {
  const m = (v: number) => `${v.toFixed(2)}m`;
  const lines: string[] = [];
  lines.push('player model reference (stand pose, neutral shape — measured from the live skeleton)');
  lines.push(`  head-top ${m(headTop)} (= 1.00×, the ratio base)   eyes ${m(eyes)}   chest ${m(chest)}   waist ${m(waist)}   knee ${m(knee)}`);
  lines.push(`  physics capsule ${m(HMSC_SCALE.playerCapsuleHeightMeters)} tall, Ø${m(capsuleDiameter)}   |   bar: 1 cell = ${M_PER_CELL}m, ▓/│ marks the player's head`);
  lines.push('');
  lines.push(`${'kind'.padEnd(16)} ${'height'.padStart(7)} ${'vs you'.padStart(7)}  ${'tops out at'.padEnd(11)} ${'Ø footp'.padStart(8)}  height bar`);
  for (const d of defs) {
    const ratio = `${(d.heightMeters / headTop).toFixed(2)}×`;
    lines.push(`${d.kind.padEnd(16)} ${m(d.heightMeters).padStart(7)} ${ratio.padStart(7)}  ${landmark(d.heightMeters).padEnd(11)} ${m(d.footprintRadiusMeters * 2).padStart(8)}  ${bar(d.heightMeters)}`);
  }
  lines.push('');
  lines.push(`${defs.length} prop kind${defs.length === 1 ? '' : 's'} (Ø footp = collision footprint diameter; player capsule is Ø${m(capsuleDiameter)})`);
  console.log(lines.join('\n'));
}
