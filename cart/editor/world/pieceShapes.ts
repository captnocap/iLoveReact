// world/pieceShapes.ts — the editor's REAL build-piece geometry (req_2575).
//
// The live overlay used to draw ONE flat unit box per piece, so a window wall
// showed no window, a doorway showed no opening, and you couldn't tell which way
// a wall faced. The editor-owned decomposition makes a piece a SET of shapes:
// front/back face
// slabs, window jamb/sill/header + glass pane, door leaf, ramps, gable roofs,
// elevator frames — the same meaning the colliders carry, as boxes.
//
// Simplified vs the source: the cross-piece wall-JOIN logic (corner miters, open
// runs, lifted-wall rest-Y — all of which need a neighbour scan) is dropped. A
// wall is one full-width band; the openings, facing, and roof/ramp shapes — the
// things the user needs to SEE — are all here. Joins can return as a later slice.
import { catalogRowFor, rowHex, type CatalogRow, type WallEdit } from './buildCatalog';
import type { PlacedPiece } from './pieces';

const DEG = Math.PI / 180;

// Editor-owned visual tuning for readable placements.
const UI = {
  faceSlabThicknessMeters: 0.02,
  faceSlabLiftMeters: 0.012,
  editCutoutWidthMeters: 1.2,
  doubleWindowCutoutWidthMeters: 2.2,
  editCutoutHeightMeters: 1.2,
  // Floor-standing doorway openings (door/garage/arch) — reach the floor, so
  // their rect starts at the wall base and has no sill, unlike the mid-wall
  // window band. Width/height differ; the cutout mechanism is identical.
  doorOpeningWidthMeters: 1.0,
  doorOpeningHeightMeters: 2.1,
  archOpeningWidthMeters: 1.4,
  garageOpeningWidthMeters: 2.6,
  garageOpeningHeightMeters: 2.4,
  windowPaneDepthMeters: 0.04,
  windowPaneColor: '#bcd3dd',
  windowPaneOpacity: 0.3,
  rampSlabThicknessMeters: 0.2,
  stairVisualSteps: 5,
  elevatorWallThicknessMeters: 0.12,
  elevatorPostSizeMeters: 0.24,
  elevatorHeaderHeightMeters: 0.4,
};
const DOOR_PANEL_COLOR = '#0c1018';

// A skinnable face role — carried on every shape so the texture stage (Stage B)
// can map piece.slots[slot] → a live material. Stage A colours every box flat.
export type FaceSlot = 'front' | 'back' | 'sides' | 'top';

export type VisualBox = {
  key: string;
  cx: number; cy: number; cz: number;
  sx: number; sy: number; sz: number;
  yawDegrees: number;
  color: string;
  opacity?: number;
  slot?: FaceSlot;
  door?: true;
};
export type VisualRamp = {
  key: string;
  x: number; y: number; z: number;
  width: number; height: number; depth: number;
  slabThickness: number;
  yawDegrees: number;
  color: string;
  opacity?: number;
  slot?: FaceSlot;
};
export type VisualShape =
  | { kind: 'box'; box: VisualBox }
  | { kind: 'ramp'; ramp: VisualRamp };

/** local (u along width, v along depth) → world offset under R(+yaw). Matches the
 *  Scene3D/render3d yaw frame (local +v turns toward world +x at yaw 90). */
function localOffset(u: number, v: number, yawDegrees: number): { dx: number; dz: number } {
  const cos = Math.cos(yawDegrees * DEG);
  const sin = Math.sin(yawDegrees * DEG);
  return { dx: u * cos + v * sin, dz: -u * sin + v * cos };
}

// An OPENING is the one operation every wall edit fundamentally is: a rectangular
// cutout in the wall. A window, a double window, an open doorway, a door, a
// garage, an arch — all the SAME cut; they differ ONLY in the opening's rect
// (width/height/where it sits) and what FILLS it (a glass pane, a door leaf, or
// nothing). This derives that rect+fill from the edit's parameters instead of
// hardcoding a per-piece look (req_2576) — so an open doorway is a real cutout,
// not a special case that fell through to "solid wall".
type Opening = { width: number; bottom: number; top: number; fill: 'pane' | 'leaf' | 'none' };

function openingFor(edit: WallEdit | undefined, baseY: number, wallH: number): Opening | null {
  if (!edit) return null;
  switch (edit) {
    // Window family: a mid-wall band (sill below, header above). A glass pane
    // fills it; a broken window is the same cut with the glass gone.
    case 'window':
    case 'doubleWindow':
    case 'brokenWindow': {
      const width = edit === 'doubleWindow' ? UI.doubleWindowCutoutWidthMeters : UI.editCutoutWidthMeters;
      const h = UI.editCutoutHeightMeters;
      const bottom = baseY + wallH * 0.55 - h / 2;
      return { width, bottom, top: bottom + h, fill: edit === 'brokenWindow' ? 'none' : 'pane' };
    }
    // Doorway family: a floor-standing opening (no sill). A door/garage fills it
    // with a leaf; an (open) arch is the same cut left open — the case the old
    // code missed, rendering it as a full wall.
    case 'door':
    case 'garageDoor':
    case 'arch': {
      const width = edit === 'garageDoor' ? UI.garageOpeningWidthMeters : edit === 'arch' ? UI.archOpeningWidthMeters : UI.doorOpeningWidthMeters;
      const height = edit === 'garageDoor' ? UI.garageOpeningHeightMeters : UI.doorOpeningHeightMeters;
      return { width, bottom: baseY, top: baseY + Math.min(height, wallH), fill: edit === 'arch' ? 'none' : 'leaf' };
    }
  }
}

// roof.<shape>.* → the pitched profile it lifts. flat stays a plate.
function roofProfile(pieceId: string): { shape: 'flat' | 'shed' | 'gable'; rise: number } {
  const seg = pieceId.split('.')[1] ?? 'flat';
  const steep = seg.includes('Steep');
  const pitch = steep ? 1.0 : 0.5; // ROOF_PITCH semiSlant/fullSlant
  if (seg.startsWith('shed')) return { shape: 'shed', rise: pitch * 3 };
  if (seg.startsWith('gable') || seg === 'shingle') return { shape: 'gable', rise: pitch * 1.5 };
  return { shape: 'flat', rise: 0 };
}

/** Decompose a placed piece into real visual shapes. `color` tints every solid
 *  face (Stage A: the slot material's colour, resolved by the caller); the glass
 *  pane keeps its own translucent look. */
export function pieceVisualShapes(piece: PlacedPiece, color: string): VisualShape[] {
  const def: CatalogRow | null = catalogRowFor(piece.pieceId);
  if (!def) return [];
  const yaw = piece.yawDegrees;
  const size = { w: def.w, h: def.h, d: def.d };
  const depthSize = size.d;
  const depthCenter = 0;
  const faceColor = color;

  const box = (k: string, u: number, v: number, baseY: number, w: number, h: number, d: number, slot: FaceSlot, col = faceColor, opacity?: number): VisualShape => {
    const { dx, dz } = localOffset(u, v, yaw);
    return { kind: 'box', box: { key: `${piece.id}.${k}`, cx: piece.x + dx, cy: baseY + h / 2, cz: piece.z + dz, sx: w, sy: h, sz: d, yawDegrees: yaw, color: col, opacity, slot } };
  };

  if (def.kind === 'ramp') {
    return [{ kind: 'ramp', ramp: { key: `${piece.id}.slope`, x: piece.x, y: piece.y, z: piece.z, width: size.w, height: size.h, depth: size.d, slabThickness: UI.rampSlabThicknessMeters, yawDegrees: yaw, color: faceColor, slot: 'top' } }];
  }

  if (def.kind === 'stairs') {
    const boxes: VisualShape[] = [];
    const steps = UI.stairVisualSteps;
    for (let i = 0; i < steps; i += 1) {
      const v = -size.d / 2 + ((i + 0.5) / steps) * size.d;
      const h = ((i + 1) / steps) * size.h;
      boxes.push(box(`s${i}`, 0, v, piece.y, size.w, h, size.d / steps, 'top'));
    }
    return boxes;
  }

  if (def.kind === 'elevator') {
    const halfW = size.w / 2;
    const halfD = size.d / 2;
    const wall = UI.elevatorWallThicknessMeters;
    const post = UI.elevatorPostSizeMeters;
    const h = size.h;
    const shapes: VisualShape[] = [
      box('left', -halfW + wall / 2, 0, piece.y, wall, h, size.d - post * 2, 'sides'),
      box('right', halfW - wall / 2, 0, piece.y, wall, h, size.d - post * 2, 'sides'),
      box('back', 0, halfD - wall / 2, piece.y, size.w - post * 2, h, wall, 'back'),
      box('header', 0, -halfD + wall / 2, piece.y + h - UI.elevatorHeaderHeightMeters, size.w - post * 2, UI.elevatorHeaderHeightMeters, wall, 'front'),
    ];
    for (const [pu, pv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      shapes.push(box(`post${pu}${pv}`, pu * (halfW - post / 2), pv * (halfD - post / 2), piece.y, post, h, post, 'front'));
    }
    return shapes;
  }

  if (def.kind === 'wall' || def.kind === 'arch' || def.kind === 'fence' || def.kind === 'railing') {
    const shapes: VisualShape[] = [];
    const slab = UI.faceSlabThicknessMeters;
    const lift = UI.faceSlabLiftMeters;
    const frontV = depthSize / 2 + lift;
    const backV = -depthSize / 2 - lift;
    // front/back are PIECE-FIXED: the local +v slab is the front at every yaw,
    // so a painted face rotates WITH the wall. (req_3567 removed the old
    // odd-quarter-turn tag swap — it compensated for faceRoleForHit un-rotating
    // the hit normal with the wrong sign, and made menu-assigned front/back
    // land on the physically opposite slab at yaw 90/270.)
    const frontSlot: FaceSlot = 'front';
    const backSlot: FaceSlot = 'back';
    // The wall's opening, derived from the edit's PARAMETERS (window band vs
    // floor-standing doorway) — one cut for every edit; the fill distinguishes
    // them (req_2576). No edit ⇒ no opening ⇒ a solid band.
    // An arch-kind row is intrinsically open even though it does not use the
    // wall edit family. Treat its semantic KIND as the same opening profile as
    // an open-doorway wall; otherwise "Concrete Arch" degenerates to a slab.
    const opening = openingFor(def.kind === 'arch' ? 'arch' : def.edit, piece.y, size.h);

    // One full-width band [-w/2, w/2] at full height (no join trimming).
    const addWallRun = (label: string, u0: number, u1: number, baseY: number, h: number): void => {
      const runW = u1 - u0;
      if (runW <= 0.001 || h <= 0.001) return;
      const uMid = (u0 + u1) / 2;
      if (depthSize <= slab * 3) {
        // Thin wall: two half-depth boxes meeting at the centreline (keeps the
        // exact thickness + each side its own face, no floating proud plates).
        const half = depthSize / 2;
        shapes.push(box(`${label}.front`, uMid, depthCenter + half / 2, baseY, runW, h, half, frontSlot));
        shapes.push(box(`${label}.back`, uMid, depthCenter - half / 2, baseY, runW, h, half, backSlot));
      } else {
        shapes.push(box(`${label}.core`, uMid, depthCenter, baseY, runW, h, depthSize, 'sides'));
        shapes.push(box(`${label}.front`, uMid, frontV, baseY, runW, h, slab, frontSlot));
        shapes.push(box(`${label}.back`, uMid, backV, baseY, runW, h, slab, backSlot));
      }
    };

    if (!opening) {
      addWallRun('band', -size.w / 2, size.w / 2, piece.y, size.h);
    } else {
      // Cut the wall around the opening: side jambs, a sill below it (zero-height
      // for a floor-standing doorway → skipped), a header above it.
      const holeU0 = -opening.width / 2;
      const holeU1 = opening.width / 2;
      addWallRun('leftJamb', -size.w / 2, holeU0, piece.y, size.h);
      addWallRun('rightJamb', holeU1, size.w / 2, piece.y, size.h);
      addWallRun('sill', holeU0, holeU1, piece.y, Math.max(0, opening.bottom - piece.y));
      addWallRun('header', holeU0, holeU1, opening.top, Math.max(0, piece.y + size.h - opening.top));
      // Fill the cut: a window gets a glass pane, a door/garage a leaf, an open
      // doorway / broken window nothing (a true see-through hole).
      const openingH = opening.top - opening.bottom;
      if (opening.fill === 'pane') {
        shapes.push(box('glassPane', 0, depthCenter, opening.bottom, opening.width, openingH, UI.windowPaneDepthMeters, 'front', UI.windowPaneColor, UI.windowPaneOpacity));
      } else if (opening.fill === 'leaf') {
        const leaf = box('door', 0, depthCenter, opening.bottom, opening.width, openingH, depthSize + 0.06, 'front', DOOR_PANEL_COLOR);
        if (leaf.kind === 'box') leaf.box.door = true;
        shapes.push(leaf);
      }
    }
    return shapes;
  }

  // Plate decomposition (floors + flat roofs): a core slab with thin top/bottom.
  const plate = (w: number, d: number, plateH: number): VisualShape[] => {
    const slab = UI.faceSlabThicknessMeters;
    const lift = UI.faceSlabLiftMeters;
    const coreH = Math.max(0.01, plateH - lift);
    return [
      box('edges', 0, 0, piece.y, w, coreH, d, 'sides'),
      box('top', 0, 0, piece.y + plateH - slab, w, slab, d, 'top'),
      box('bottom', 0, 0, piece.y, w, slab, d, 'back'),
    ];
  };

  if (def.kind === 'roof') {
    const { shape, rise } = roofProfile(piece.pieceId);
    const W = size.w;
    const D = size.d;
    const thick = UI.rampSlabThicknessMeters;
    const rampAt = (k: string, u: number, v: number, w: number, dep: number, riseH: number, ramYaw: number): VisualShape => {
      const { dx, dz } = localOffset(u, v, yaw);
      return { kind: 'ramp', ramp: { key: `${piece.id}.${k}`, x: piece.x + dx, y: piece.y, z: piece.z + dz, width: w, height: riseH, depth: dep, slabThickness: thick, yawDegrees: ramYaw, color: faceColor, slot: 'top' } };
    };
    if ((shape === 'shed' || shape === 'gable') && rise > 0.01) {
      if (shape === 'shed') return [rampAt('slope', 0, 0, W, D, rise, yaw)];
      const shapes: VisualShape[] = [
        rampAt('slopeA', 0, -D / 4, W, D / 2, rise, yaw),
        rampAt('slopeB', 0, D / 4, W, D / 2, rise, yaw + 180),
      ];
      // Gable-end walls closing each side (approximated as thin boxes rising to
      // the ridge — a triangular prim is a later refinement).
      const endThickness = thick;
      for (const eu of [-1, 1] as const) {
        shapes.push(box(`gableEnd${eu}`, eu * (W / 2 - endThickness / 2), 0, piece.y, endThickness, rise, D, 'sides'));
      }
      return shapes;
    }
    return plate(W, D, size.h);
  }

  if (def.kind === 'floor') {
    return plate(size.w, size.d, size.h);
  }

  // pillar / corner / trim / sign — a single body box.
  return [box('body', 0, 0, piece.y, size.w, size.h, size.d, 'front')];
}
