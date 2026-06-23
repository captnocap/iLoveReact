// wallSlabs.test.ts — visual wall face slabs must not cross at joined endpoints.
// Collision cores extend through perpendicular walls to close the gameplay
// blocker; rendered wall solids stop before the corner square and L-corners
// fill it with paired triangular miter prisms.

import { assertClose, finish, test } from '../../game/_testkit';
import type { PlacedBuildPiece } from '@game';
import { pieceVisualShapes, type VisualBox, type VisualShape } from './pieceShapes';

let nextId = 0;
function placed(pieceId: string, x: number, z: number, over: Partial<PlacedBuildPiece> = {}): PlacedBuildPiece {
  nextId += 1;
  return { id: `wall_slab_${nextId}`, pieceId, x, y: 0, z, yawDegrees: 0, ...over };
}

function wallBoxes(piece: PlacedBuildPiece, pieces: readonly PlacedBuildPiece[]): VisualBox[] {
  return pieceVisualShapes(piece, piece.id, pieces)
    .filter((shape) => shape.kind === 'box')
    .map((shape) => (shape as Extract<ReturnType<typeof pieceVisualShapes>[number], { kind: 'box' }>).box);
}

function wallCornerMiters(piece: PlacedBuildPiece, pieces: readonly PlacedBuildPiece[]): VisualBox[] {
  return pieceVisualShapes(piece, piece.id, pieces)
    .filter((shape): shape is Extract<VisualShape, { kind: 'cornerMiter' | 'cornerMiterMirror' }> =>
      shape.kind === 'cornerMiter' || shape.kind === 'cornerMiterMirror')
    .map((shape) => shape.box);
}

function box(piece: PlacedBuildPiece, pieces: readonly PlacedBuildPiece[], suffix: string): VisualBox {
  const hit = wallBoxes(piece, pieces).find((b) => b.key.endsWith(suffix));
  if (!hit) throw new Error(`missing visual box ${suffix}`);
  return hit;
}

function runRange(box: VisualBox): { min: number; max: number } {
  const yaw = ((box.yawDegrees % 360) + 360) % 360;
  if (Math.abs(yaw - 0) < 1e-6 || Math.abs(yaw - 180) < 1e-6) {
    return { min: box.cx - box.sx / 2, max: box.cx + box.sx / 2 };
  }
  if (Math.abs(yaw - 90) < 1e-6 || Math.abs(yaw - 270) < 1e-6) {
    return { min: box.cz - box.sx / 2, max: box.cz + box.sx / 2 };
  }
  throw new Error(`unsupported test yaw ${box.yawDegrees}`);
}

function planRect(box: VisualBox): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const yaw = ((box.yawDegrees % 360) + 360) % 360;
  if (Math.abs(yaw - 0) < 1e-6 || Math.abs(yaw - 180) < 1e-6) {
    return { minX: box.cx - box.sx / 2, maxX: box.cx + box.sx / 2, minZ: box.cz - box.sz / 2, maxZ: box.cz + box.sz / 2 };
  }
  if (Math.abs(yaw - 90) < 1e-6 || Math.abs(yaw - 270) < 1e-6) {
    return { minX: box.cx - box.sz / 2, maxX: box.cx + box.sz / 2, minZ: box.cz - box.sx / 2, maxZ: box.cz + box.sx / 2 };
  }
  throw new Error(`unsupported test yaw ${box.yawDegrees}`);
}

function assertNoPlanOverlap(a: VisualBox, b: VisualBox, message: string): void {
  const ar = planRect(a);
  const br = planRect(b);
  const overlapX = Math.min(ar.maxX, br.maxX) - Math.max(ar.minX, br.minX);
  const overlapZ = Math.min(ar.maxZ, br.maxZ) - Math.max(ar.minZ, br.minZ);
  if (overlapX > 1e-9 && overlapZ > 1e-9) throw new Error(`${message} (overlap ${overlapX} x ${overlapZ})`);
}

test('an L-corner splits the endpoint square between both wall skins', () => {
  const horizontal = placed('wall.concrete.common', 1.5, 0, {
    yawDegrees: 0,
    skin: {
      front: { kind: 'color', value: '#cc3311' },
      back: { kind: 'color', value: '#cc3311' },
      sides: { kind: 'color', value: '#111111' },
    },
  });
  const vertical = placed('wall.concrete.common', 3, 1.5, {
    yawDegrees: 90,
    skin: {
      front: { kind: 'color', value: '#1144cc' },
      back: { kind: 'color', value: '#1144cc' },
      sides: { kind: 'color', value: '#111111' },
    },
  });
  const pieces = [horizontal, vertical];

  // These walls are CENTERED (no support plate), so their bodies cross in the
  // square x[2.875,3.125] × z[-0.125,0.125]. Each core stops at that square's
  // near edge (half a wall thickness short of the partner's centerline) and the
  // miter triangle fills the square — landing the joint on the REAL crossing,
  // not a half-thickness off (the old 2.75 baked in the floor-offset geometry,
  // which on centered walls left a see-through gap + a sliver overhang).
  assertClose(runRange(box(horizontal, pieces, '.core')).max, 2.875, 1e-9, 'horizontal rendered core stops at the corner-square near edge');
  assertClose(runRange(box(horizontal, pieces, '.front')).max, 2.875, 1e-9, 'horizontal front skin stops at the corner-square near edge');
  assertClose(runRange(box(horizontal, pieces, '.back')).max, 2.875, 1e-9, 'horizontal back skin stops at the corner-square near edge');
  if (!box(horizontal, pieces, '.core').openRunMax || !box(horizontal, pieces, '.front').openRunMax || !box(horizontal, pieces, '.back').openRunMax) {
    throw new Error('horizontal wall boxes must omit the cut max-end cap at an L-corner');
  }

  assertClose(runRange(box(vertical, pieces, '.core')).min, 0.125, 1e-9, 'perpendicular rendered core stops at the corner-square near edge');
  assertClose(runRange(box(vertical, pieces, '.front')).min, 0.125, 1e-9, 'perpendicular front skin stops at the corner-square near edge');
  assertClose(runRange(box(vertical, pieces, '.back')).min, 0.125, 1e-9, 'perpendicular back skin stops at the corner-square near edge');
  if (!box(vertical, pieces, '.core').openRunMax || !box(vertical, pieces, '.front').openRunMax || !box(vertical, pieces, '.back').openRunMax) {
    throw new Error('vertical yaw-90 wall boxes must omit the local max cap at the world min end of an L-corner');
  }

  const horizontalMiter = wallCornerMiters(horizontal, pieces)[0];
  const verticalMiter = wallCornerMiters(vertical, pieces)[0];
  if (!horizontalMiter || !verticalMiter) throw new Error('L-corner must emit one miter triangle from each wall');
  assertClose(horizontalMiter.cx, verticalMiter.cx, 1e-9, 'paired miter triangles share the same corner-square center x');
  assertClose(horizontalMiter.cz, verticalMiter.cz, 1e-9, 'paired miter triangles share the same corner-square center z');
  assertClose(Math.abs(horizontalMiter.sx), 0.25, 1e-9, 'horizontal miter cut spans one full wall thickness along the run');
  assertClose(Math.abs(verticalMiter.sx), 0.25, 1e-9, 'vertical miter cut spans one full wall thickness along the run');
  if (horizontalMiter.slot === 'sides' || verticalMiter.slot === 'sides') {
    throw new Error('corner miter triangles must wear the painted wall face, not the dark side/end-cap material');
  }
  if (horizontalMiter.color !== '#cc3311' || verticalMiter.color !== '#1144cc') {
    throw new Error(`corner miter triangles should keep both painted wall colors, got ${horizontalMiter.color} and ${verticalMiter.color}`);
  }
  assertNoPlanOverlap(box(horizontal, pieces, '.core'), box(vertical, pieces, '.core'), 'rendered wall cores must not overlap at an L-corner');
});

test('a T-junction clamps both side skins at the stem endpoint', () => {
  const cross = placed('wall.concrete.common', 1.5, 0, { yawDegrees: 0 });
  const stem = placed('wall.concrete.common', 1.5, 1.5, { yawDegrees: 90 });
  const pieces = [cross, stem];

  assertClose(runRange(box(stem, pieces, '.core')).min, 0.125, 1e-9, 'rendered core/end cap butts into the crossing wall');
  assertClose(runRange(box(stem, pieces, '.front')).min, 0.125, 1e-9, 'front skin butts into the crossing wall');
  assertClose(runRange(box(stem, pieces, '.back')).min, 0.125, 1e-9, 'back skin also butts into the crossing wall');
  if (!box(stem, pieces, '.core').openRunMax || !box(stem, pieces, '.front').openRunMax || !box(stem, pieces, '.back').openRunMax) {
    throw new Error('yaw-90 T-junction stem boxes must omit the local max cap at the world min end');
  }
  assertNoPlanOverlap(box(cross, pieces, '.core'), box(stem, pieces, '.core'), 'rendered wall cores must not overlap at a T-junction');
});

// Real-world L-corner from a live snapshot (req_1709): centered walls (painted
// floor, no support plate). The horizontal wall ends at x=129 (the vertical
// wall's centerline); their bodies cross in the square x[128.875,129.125] ×
// z[281.875,282.125]. The core must stop at that square's near edge (128.875)
// and emit a miter that lands ON the crossing — the bug was a half-thickness
// drift that left a gap + sliver at every such corner.
test('a real centered L-corner lands the miter on the wall crossing', () => {
  const bp_2883 = placed('wall.concrete.common', 127.5, 282, { id: 'bp_2883', yawDegrees: 0 });
  const bp_2882 = placed('wall.concrete.common', 129, 283.5, { id: 'bp_2882', yawDegrees: 90 });
  const bp_2881 = placed('wall.concrete.common', 129, 286.5, { id: 'bp_2881', yawDegrees: 90 });
  const pieces = [bp_2881, bp_2882, bp_2883];

  assertClose(runRange(box(bp_2883, pieces, '.core')).max, 128.875, 1e-9, 'horizontal core stops at the corner-square near edge');
  const miter = wallCornerMiters(bp_2883, pieces)[0];
  if (!miter) throw new Error('the L-corner must emit a miter triangle');
  assertClose(miter.cx, 129, 1e-9, 'miter centers on the vertical wall crossing x');
  assertClose(miter.cz, 282, 1e-9, 'miter centers on the horizontal wall crossing z');
});

finish('wall-slabs');
