// scripts/check-symmetry.js — find where a Studio model.json is NOT symmetric.
//
//   tools/v8cli scripts/check-symmetry.js [path/to/model.json] [axis]
//
// axis = x|y|z (default: auto-pick the axis the model is MOST symmetric about — for
// a car that's the left↔right axis). The plane is the ORIGIN (0), the same plane the
// Studio mirror/symmetrize use. Reports every vertex with no mirror twin: its index,
// position, where its twin SHOULD be, and the nearest actual vertex to that spot
// (so you see which vertex drifted and by how much). A clean drift shows as a PAIR.

const argv = process.argv.slice(1);
const path = argv.find((a) => a.endsWith('.json')) || 'cart/hmsc-int/model.json';
const axisArg = argv.find((a) => /^[xyz]$/i.test(a));
const EPS = 1e-3; // match tolerance (model coords are ~4 decimals)

const model = JSON.parse(__fs_read(path));
const verts = model.verts || [];
const AX = ['x', 'y', 'z'];

function unmatched(axis) {
  const out = [];
  for (let i = 0; i < verts.length; i += 1) {
    const v = verts[i];
    const r = [v[0], v[1], v[2]]; r[axis] = -r[axis]; // reflect across plane 0
    let nearestD = Infinity, nearestJ = -1;
    for (let j = 0; j < verts.length; j += 1) {
      const w = verts[j];
      const d = Math.hypot(w[0] - r[0], w[1] - r[1], w[2] - r[2]);
      if (d < nearestD) { nearestD = d; nearestJ = j; }
    }
    if (nearestD > EPS) out.push({ i, v, twin: r, nearestJ, nearestD });
  }
  return out;
}

// pick the axis: explicit, else the one with the FEWEST offenders (the real symmetry axis).
let axis;
if (axisArg) {
  axis = AX.indexOf(axisArg.toLowerCase());
} else {
  let best = 0, bestN = Infinity;
  for (let a = 0; a < 3; a += 1) { const n = unmatched(a).length; if (n < bestN) { bestN = n; best = a; } }
  axis = best;
}

const offenders = unmatched(axis).sort((a, b) => b.nearestD - a.nearestD); // worst (most visible) first
const fmt = (p) => `[${p.map((x) => (Math.round(x * 1e4) / 1e4)).join(', ')}]`;

__writeStdout(`\n=== symmetry check: ${path} ===\n`);
__writeStdout(`plane: ${AX[axis]} = 0   ·   ${verts.length} verts   ·   tolerance ${EPS}\n`);
if (!axisArg) __writeStdout(`(auto-picked ${AX[axis]} as the symmetry axis — fewest offenders)\n`);

if (offenders.length === 0) {
  __writeStdout(`\n  ✓ SYMMETRIC across ${AX[axis]} — every vertex has a mirror twin.\n\n`);
} else {
  __writeStdout(`\n  ⚠ ${offenders.length} vert(s) with NO mirror twin across ${AX[axis]}:\n\n`);
  for (const o of offenders) {
    __writeStdout(`  vert ${o.i}  ${fmt(o.v)}\n`);
    __writeStdout(`     twin should be at ${fmt(o.twin)}\n`);
    __writeStdout(`     nearest is vert ${o.nearestJ} ${fmt(verts[o.nearestJ])}  (off by ${Math.round(o.nearestD * 1e4) / 1e4})\n`);
  }
  __writeStdout(`\n  Tip: drift usually shows as a PAIR (the moved vert + its orphaned twin).\n`);
  __writeStdout(`  In Studio: vertex mode → these indices are the ones to nudge, or hit symmetrize.\n\n`);
}
