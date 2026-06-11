import { assert, assertClose, finish, test } from '../game/_testkit';
import { makeHeightField, slopeHeightAtDistance, stampSlopeBrush, stampSlopeSegment, stampSmoothBrush } from '../heightData';

test('freehand slope height rises with painted distance and clamps at the end height', () => {
  const opts = { startZ: 1, endZ: 9, runM: 20 };
  assertClose(slopeHeightAtDistance(opts, 0), 1, 1e-9, 'mouse-down starts at the low height');
  assertClose(slopeHeightAtDistance(opts, 10), 5, 1e-9, 'half the run reaches half the height span');
  assertClose(slopeHeightAtDistance(opts, 40), 9, 1e-9, 'distance past the run stays capped');
});

test('freehand slope brush stamps a higher field later along the same stroke', () => {
  const f = makeHeightField(12, 2);
  stampSlopeBrush(f, 2, 2, {
    startZ: 1,
    endZ: 7,
    runM: 12,
    distanceM: 0,
    radiusM: 0.5,
    shape: 'circle',
    profile: 'flat',
  });
  stampSlopeBrush(f, 18, 2, {
    startZ: 1,
    endZ: 7,
    runM: 12,
    distanceM: 8,
    radiusM: 0.5,
    shape: 'circle',
    profile: 'flat',
  });

  const first = f.z[2 * f.cols + 2];
  const later = f.z[2 * f.cols + 18];
  assertClose(first, 1, 1e-9, 'first slope stamp uses the start height');
  assert(later > first, 'later slope stamp is higher than the starting point');
  assertClose(later, 5, 1e-9, 'later slope stamp uses distance/run interpolation');
});

test('freehand slope segment fills one continuous grade instead of dab stairs', () => {
  const f = makeHeightField(12, 2);
  stampSlopeSegment(f, 2, 2, 18, 2, {
    startZ: 1,
    endZ: 5,
    runM: 8,
    distanceStartM: 0,
    radiusM: 0.5,
    profile: 'flat',
  });

  const row = (x: number) => f.z[2 * f.cols + x];
  assertClose(row(2), 1, 1e-9, 'segment starts at the start height');
  assertClose(row(10), 3, 1e-9, 'segment midpoint is the midpoint height');
  assertClose(row(18), 5, 1e-9, 'segment end reaches the end height');
  for (let x = 3; x <= 18; x += 1) {
    assert(row(x) >= row(x - 1), `height sample ${x} is monotonic along the slope`);
  }
});

test('smooth brush preserves a clean sloped plane', () => {
  const f = makeHeightField(8, 8);
  for (let y = 0; y < f.rows; y += 1) {
    for (let x = 0; x < f.cols; x += 1) {
      f.z[y * f.cols + x] = x * 0.25 + y * 0.1 + 2;
    }
  }
  const before = f.z[8 * f.cols + 8];
  stampSmoothBrush(f, 8, 8, { radiusM: 2.5, shape: 'circle', profile: 'flat', strength: 1 });
  assertClose(f.z[8 * f.cols + 8], before, 1e-6, 'a clean sloped plane remains unchanged');
});

test('smooth brush levels a spike toward the local terrain plane', () => {
  const f = makeHeightField(8, 8);
  for (let y = 0; y < f.rows; y += 1) {
    for (let x = 0; x < f.cols; x += 1) {
      f.z[y * f.cols + x] = x * 0.25 + y * 0.1 + 2;
    }
  }
  const idx = 8 * f.cols + 8;
  const plane = f.z[idx];
  f.z[idx] = plane + 6;
  stampSmoothBrush(f, 8, 8, { radiusM: 2.5, shape: 'circle', profile: 'flat', strength: 0.75 });
  assert(f.z[idx] < plane + 6, 'the spike is lowered');
  assert(Math.abs(f.z[idx] - plane) < 6, 'the spike moves closer to the fitted terrain plane');
});

finish('heightData');
