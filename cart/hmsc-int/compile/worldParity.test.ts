// worldParity.test.ts — EDITOR ↔ COMPILED render parity (PARITY-0611, req_0655).
//
// THE FAILURE CLASS THIS PINS: every suite was green while the compiled game
// rendered door/window walls as SOLID slabs — the editor showed jambs + a real
// opening, the colliders shipped the opening, and the bake shipped a wall you
// could walk through but not see through (req_0654's screenshots). Unit tests
// that assert "the wall bakes as 3 boxes" pin the implementation, not the
// truth; the truth is THE SAME SOLIDS IN BOTH VIEWS.
//
// THE APPROACH: sample-occupancy comparison. For one placed piece, classify a
// 3D grid of probe points as solid/open twice — once against the editor's
// pieceVisualShapes boxes (editors/build/pieceShapes, the pure module), once
// against the baked instance rows (compile/worldGeometry) — and require the
// classifications to AGREE at every probe. Translucent geometry (glass walls,
// window panes — anything shipping opacity < 1 on either side) is excluded
// symmetrically: parity is about what OCCLUDES.
//
// A second invariant transcribes the bug as the player saw it: any point the
// authored colliders say a body passes through (a doorway) must not be opaquely
// occupied by baked render geometry — what you can walk through, you can see
// through. (The converse is not required: windows block bodies but not sight.)

import { assert, assertEqual, finish, test } from '../game/_testkit';
import { GAME_BUILD, type CollisionRect, type PlacedBuildPiece, type WallEdit } from '@game';
import { pieceVisualShapes, type VisualShape } from '../editors/build/pieceShapes';
import { buildWorldInstances, INSTANCE_SHAPE_BOX, INSTANCE_STRIDE, type MaterialAsset } from './worldGeometry';

const DEG = Math.PI / 180;
/** probe spacing — fine enough that the 1.2m cutout and 0.45m jambs each get
 *  several interior probes; offset half a step so probes never sit exactly on
 *  a box face */
const PROBE_STEP_METERS = 0.1;
/** opacity at or above this counts as occluding (1 = opaque; editor glass 0.3
 *  and window panes 0.3 fall out on both sides) */
const OPAQUE_MIN = 0.99;

type SolidBox = {
  cx: number; cy: number; cz: number;
  sx: number; sy: number; sz: number;
  yawDegrees: number;
};

/** face-inclusive margin: the baked rows live in a Float32Array, so a probe
 *  sitting EXACTLY on a box face (sill tops land on grid-aligned y) flips
 *  open/solid on f32-vs-f64 rounding alone. 1mm of inclusion absorbs that
 *  without hiding any real (≥ probe-step) geometry divergence. */
const FACE_EPS_METERS = 0.001;

function boxContains(b: SolidBox, x: number, y: number, z: number): boolean {
  if (Math.abs(y - b.cy) > b.sy / 2 + FACE_EPS_METERS) return false;
  const cos = Math.cos(b.yawDegrees * DEG);
  const sin = Math.sin(b.yawDegrees * DEG);
  const dx = x - b.cx;
  const dz = z - b.cz;
  // inverse of the renderer's yaw: world → piece-local (u along width, v along depth)
  const u = dx * cos - dz * sin;
  const v = dx * sin + dz * cos;
  return Math.abs(u) <= b.sx / 2 + FACE_EPS_METERS && Math.abs(v) <= b.sz / 2 + FACE_EPS_METERS;
}

function anyContains(boxes: readonly SolidBox[], x: number, y: number, z: number): boolean {
  for (const b of boxes) if (boxContains(b, x, y, z)) return true;
  return false;
}

/** The editor view's OPAQUE solids for one piece (boxes only — every wall/
 *  floor/pillar/elevator shape is a box; ramp pieces are out of scope here). */
function editorOpaqueBoxes(piece: PlacedBuildPiece): SolidBox[] {
  const out: SolidBox[] = [];
  for (const shape of pieceVisualShapes(piece, piece.id, [piece])) {
    if (shape.kind !== 'box') continue;
    if ((shape.box.opacity ?? 1) < OPAQUE_MIN) continue;
    out.push(shape.box);
  }
  return out;
}

/** The compiled bake's OPAQUE solids: box-shaped instance rows whose material
 *  slot is empty or fully opaque (a translucent material slot — glass, a
 *  window pane — does not occlude). */
function bakedOpaqueBoxes(built: { instances: Float32Array; materialRefs: number[]; materials: MaterialAsset[] }): SolidBox[] {
  const out: SolidBox[] = [];
  const rows = built.instances.length / INSTANCE_STRIDE;
  for (let i = 0; i < rows; i += 1) {
    const at = i * INSTANCE_STRIDE;
    if (built.instances[at + 12] !== INSTANCE_SHAPE_BOX) continue;
    const slot = built.materialRefs[i] ?? 0;
    if (slot > 0 && built.materials[slot - 1].opacity < OPAQUE_MIN) continue;
    out.push({
      cx: built.instances[at], cy: built.instances[at + 1], cz: built.instances[at + 2],
      yawDegrees: built.instances[at + 4],
      sx: built.instances[at + 6], sy: built.instances[at + 7], sz: built.instances[at + 8],
    });
  }
  return out;
}

type ParityReport = { probes: number; mismatches: { x: number; y: number; z: number; editor: boolean; baked: boolean }[] };

/** Walk a probe grid over the piece's catalog volume (inflated past slabs and
 *  the door panel's depth bulge) and compare editor vs bake occupancy. */
function compareOccupancy(piece: PlacedBuildPiece): ParityReport {
  const def = GAME_BUILD.catalog.get(piece.pieceId);
  const editor = editorOpaqueBoxes(piece);
  const baked = bakedOpaqueBoxes(buildWorldInstances({} as any, [piece], []));
  const reachX = def.size.widthMeters / 2 + 0.3;
  const reachZ = def.size.depthMeters / 2 + 0.3;
  const report: ParityReport = { probes: 0, mismatches: [] };
  for (let y = PROBE_STEP_METERS / 2; y < def.size.heightMeters + 0.3; y += PROBE_STEP_METERS) {
    for (let dx = -reachX + PROBE_STEP_METERS / 2; dx < reachX; dx += PROBE_STEP_METERS) {
      for (let dz = -reachZ + PROBE_STEP_METERS / 2; dz < reachZ; dz += PROBE_STEP_METERS) {
        const x = piece.x + dx;
        const z = piece.z + dz;
        const inEditor = anyContains(editor, x, piece.y + y, z);
        const inBake = anyContains(baked, x, piece.y + y, z);
        report.probes += 1;
        if (inEditor !== inBake) report.mismatches.push({ x, y: piece.y + y, z, editor: inEditor, baked: inBake });
      }
    }
  }
  return report;
}

function describeMismatches(report: ParityReport): string {
  const sample = report.mismatches.slice(0, 3)
    .map((m) => `(${m.x.toFixed(2)}, ${m.y.toFixed(2)}, ${m.z.toFixed(2)}) editor=${m.editor ? 'solid' : 'open'} baked=${m.baked ? 'solid' : 'open'}`)
    .join('; ');
  return `${report.mismatches.length}/${report.probes} probes disagree, e.g. ${sample}`;
}

function wallWith(edit: WallEdit | undefined, doorOpen?: boolean): PlacedBuildPiece {
  return {
    id: `parity-${edit ?? 'plain'}${doorOpen ? '-open' : ''}`,
    pieceId: 'wall.concrete.common',
    x: 12,
    y: 0,
    z: 30,
    yawDegrees: 0,
    ...(edit !== undefined ? { edit } : {}),
    ...(doorOpen !== undefined ? { doorOpen } : {}),
  };
}

// ── 1. the parity sweep: every wall edit in the vocabulary, by table row ─────
// (a new WallEdit lands in WALL_EDIT_DEFINITIONS and is swept here for free)

for (const edit of GAME_BUILD.edits.wallEdits) {
  test(`compiled render matches the editor render for a '${edit}' wall`, () => {
    const report = compareOccupancy(wallWith(edit === 'solid' ? undefined : edit));
    assertEqual(report.mismatches.length, 0, describeMismatches(report));
  });
}

test('compiled render matches the editor render for an OPEN door (doorOpen=true)', () => {
  const report = compareOccupancy(wallWith('door', true));
  assertEqual(report.mismatches.length, 0, describeMismatches(report));
});

// ── 2. harness honesty: pieces that already share one decomposition PASS ─────
// (proves the sweep measures real divergence, not probe-grid noise)

test('parity harness baseline: stairs agree editor↔bake', () => {
  const stairs: PlacedBuildPiece = { id: 'parity-stairs', pieceId: 'stairs.wood.common', x: 6, y: 0, z: 6, yawDegrees: 90 };
  const report = compareOccupancy(stairs);
  assertEqual(report.mismatches.length, 0, describeMismatches(report));
});

test('parity harness baseline: the elevator storey frame agrees editor↔bake', () => {
  const storey: PlacedBuildPiece = { id: 'parity-elev', pieceId: 'elevator.metal.common', x: 0, y: 0, z: 0, yawDegrees: 0 };
  const report = compareOccupancy(storey);
  assertEqual(report.mismatches.length, 0, describeMismatches(report));
});

// ── 3. the player's invariant: walk-through ⇒ see-through ────────────────────
// (req_0654: "I can stand in the wall and walk through it … visually it's a
// hidden wall." A body-passable point must never be opaquely rendered.)

function collisionBlocked(rects: readonly CollisionRect[], x: number, y: number, z: number): boolean {
  for (const r of rects) {
    if (!r.blocksPlayer) continue;
    if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
    if (y <= r.topMeters && y >= (r.floorMeters ?? -1e9)) return true;
  }
  return false;
}

test('a doorway the body passes through is open to the eye in the compiled bake (req_0654)', () => {
  const arch = wallWith('arch');
  const { rects } = GAME_BUILD.placed.colliders([arch]);
  const baked = bakedOpaqueBoxes(buildWorldInstances({} as any, [arch], []));
  // probe the corridor a player walks: the opening's center column, ankle to head
  for (const y of [0.3, 0.9, 1.5]) {
    assert(!collisionBlocked(rects, arch.x, y, arch.z), `collision must admit the body at y=${y} (the doorway is authored open)`);
    assert(
      !anyContains(baked, arch.x, y, arch.z),
      `walk-through point (y=${y}) is opaquely rendered — the compiled doorway is a hidden wall`,
    );
  }
});

test('an arch is open to the eye in the EDITOR view too — no phantom panel (req_0654)', () => {
  // The arch edit declares interaction: null — "a doorway with no door". The
  // editor's dark cutout placeholder box must not opaquely fill it, or the
  // authoring view shows a door that does not exist in the vocabulary.
  const boxes = editorOpaqueBoxes(wallWith('arch'));
  for (const y of [0.3, 0.9, 1.5]) {
    assert(!anyContains(boxes, 12, y, 30), `the arch opening is opaquely rendered in the editor at y=${y}`);
  }
});

test('a closed door occludes sight and an open door does not — the two-state look (editor view)', () => {
  const closed = editorOpaqueBoxes(wallWith('door'));
  const open = editorOpaqueBoxes(wallWith('door', true));
  assert(anyContains(closed, 12, 1.0, 30), 'the closed door panel must fill the opening');
  assert(!anyContains(open, 12, 1.0, 30), 'the open door must clear the opening');
});

test('a window ships a translucent pane in the compiled bake, not a solid wall', () => {
  const built = buildWorldInstances({} as any, [wallWith('window')], []);
  const opaque = bakedOpaqueBoxes(built);
  const paneY = 0.55 * GAME_BUILD.catalog.get('wall.concrete.common').size.heightMeters;
  assert(!anyContains(opaque, 12, paneY, 30), 'the window cutout must not be opaquely rendered');
  assert(
    built.materials.some((m) => m.opacity < OPAQUE_MIN),
    'the glass pane must travel as a translucent material',
  );
});

finish('compile/world-parity');
