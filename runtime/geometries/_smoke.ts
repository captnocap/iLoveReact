// Smoke/conformance check for @reactjit/geometries generators.
//
// Asserts each generator emits the exact vertex count the old native Zig path
// produced (the tessellation is frozen for byte-equivalence). Run via:
//   tools/esbuild runtime/geometries/_smoke.ts --bundle --format=iife \
//     --outfile=/tmp/geom_smoke.js && tools/v8cli /tmp/geom_smoke.js
//
// Expected counts (triangle-list, non-indexed):
//   Box         6 faces × 6                       = 36
//   Sphere      16 rings × 24 seg × 6             = 2304
//   Plane       1 quad × 6                        = 6
//   Cylinder    24 seg × (6 side + 3 + 3 caps)    = 288
//   Cone        24 seg × (3 side + 3 cap)         = 144
//   Torus       24 seg × 16 sides × 6             = 2304
//   Heightfield 3×3 flat@1: 4 top quads×6 + 8 skirt quads×6 = 72
import { Box, Sphere, Plane, Cylinder, Cone, Torus, Heightfield, WAVE_NONE } from './index';

type Case = { name: string; got: number; want: number };
const cases: Case[] = [];

cases.push({ name: 'Box', got: Box.generate(Box.defaults).count, want: 36 });
cases.push({ name: 'Sphere', got: Sphere.generate(Sphere.defaults).count, want: 2304 });
cases.push({ name: 'Plane', got: Plane.generate(Plane.defaults).count, want: 6 });
cases.push({ name: 'Cylinder', got: Cylinder.generate(Cylinder.defaults).count, want: 288 });
cases.push({ name: 'Cone', got: Cone.generate(Cone.defaults).count, want: 144 });
cases.push({ name: 'Torus', got: Torus.generate(Torus.defaults).count, want: 2304 });

const hf = Heightfield.generate({
  heights: [1, 1, 1, 1, 1, 1, 1, 1, 1],
  cols: 3,
  rows: 3,
  width: 2,
  depth: 2,
  base: 0,
  wave: WAVE_NONE,
  t: 0,
});
cases.push({ name: 'Heightfield', got: hf.count, want: 72 });

// Bounds sanity: a unit Box's corner is sqrt(0.5²×3) ≈ 0.866.
const boxBounds = Box.generate(Box.defaults).bounds.radius;
const boxBoundsOk = Math.abs(boxBounds - Math.sqrt(0.75)) < 1e-5;

let fails = 0;
for (const c of cases) {
  const ok = c.got === c.want;
  if (!ok) fails++;
  __writeStderr(`${ok ? 'OK  ' : 'FAIL'} ${c.name}: count=${c.got} (want ${c.want})\n`);
}
__writeStderr(`${boxBoundsOk ? 'OK  ' : 'FAIL'} Box bounds.radius=${boxBounds.toFixed(5)} (want ${Math.sqrt(0.75).toFixed(5)})\n`);
if (!boxBoundsOk) fails++;

__writeStderr(fails === 0 ? '\nALL PASS\n' : `\n${fails} FAILED\n`);
