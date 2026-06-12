// pieceShapes — the PURE piece→visual-shape decomposition (no React, no
// Scene3D, no Embodied), split out of pieceMeshes.tsx (PARITY-0611, req_0655).
//
// WHY THIS FILE EXISTS: the compiled bake (compile/worldGeometry.ts) must emit
// THE SAME solids the editor renders, and the only way to test that end to end
// is for a headless v8cli suite to import BOTH sides. While this math lived in
// pieceMeshes.tsx it sat behind React imports the test bundler can't resolve —
// so the bake drifted (door/window walls compiled as SOLID slabs while the
// editor showed jambs + a real opening) and every suite stayed green.
// compile/worldParity.test.ts now compares occupancy of these shapes against
// the baked instance rows; new piece looks belong HERE so both views and the
// parity proof see them.
//
// pieceMeshes.tsx (the React renderer) and buildUi.ts re-export everything
// moved here — no import site changed.

import { GAME_BUILD } from '@game';
import type { BuildFaceSkin, BuildMaterial, BuildSkinSet, PlacedBuildPiece, WallEdit } from '@game';

const DEG = Math.PI / 180;

// ── BUILD-mode presentation/feel data (P2: named values, no inline numbers) ──
// Lifted out of PlayRoute so the embodied F2 build mode AND the iso authoring
// pane read ONE table; lives in this pure module so the compile bake and the
// parity suite read the same cutout/slab numbers (no hand-mirrored constants).
export const BUILD_UI = {
  ghostOpacity: 0.45,
  ghostColor: '#7dd3fc',
  ghostBlockedColor: '#fb7185',
  markColor: '#fbbf24',
  targetColor: '#a5f3fc',
  /** the snap indicator cube's edge, meters */
  indicatorSizeMeters: 0.14,
  faceSlabThicknessMeters: 0.02,
  faceSlabLiftMeters: 0.012,
  editCutoutWidthMeters: 1.2,
  doubleWindowCutoutWidthMeters: 2.2,
  editCutoutHeightMeters: 1.2,
  windowPaneDepthMeters: 0.04,
  windowPaneColor: '#bcd3dd',
  windowPaneOpacity: 0.3,
  buildingSkinTexturePx: 256,
  /** REQ-0647: the elevator car platform's look (a steel plate, distinct from
   *  the shaft frame's metal so the car reads against it) */
  elevatorCarColor: '#aeb6bf',
  panelBg: '#0f1a2ef0',
} as const;

// How each material READS (display table — gameplay truth stays in the
// catalog tags; glass opacity matches the materials.ts family look).
export const MATERIAL_LOOK: Record<BuildMaterial, { color: string; opacity?: number }> = {
  concrete: { color: '#9aa3ad' },
  brick: { color: '#8a4a3a' },
  stucco: { color: '#d8cdb8' },
  wood: { color: '#8a6a45' },
  metal: { color: '#7d858d' },
  glass: { color: '#cfe6f2', opacity: 0.3 },
  chainlink: { color: '#b9c2c9', opacity: 0.45 },
};
/** the closed door/garage panel's look — dark so the leaf reads against any
 *  wall material (the same value the old inline edit box carried) */
export const DOOR_PANEL_COLOR = '#0c1018';

// ── BUILD-mode piece visuals: the same meaning the colliders carry, as boxes ─

export type VisualBox = {
  key: string;
  cx: number; cy: number; cz: number;
  sx: number; sy: number; sz: number;
  yawDegrees: number;
  color: string;
  textureKey?: string;
  opacity?: number;
  /** which skin slot this box wears (PARITY-0611) — the compile bake reads
   *  piece.skin[slot] through the SAME decomposition to intern shader/decal
   *  materials; boxes with a fixed look (door panel, glass pane) carry none */
  slot?: 'front' | 'back' | 'sides';
  /** DOORS-0611: this box IS the closed door/garage panel (the live leaf of
   *  the two-state machine). The compile bake ships it through the DOORS lump
   *  as a LIVE toggleable rect+node, never a static instance row. */
  door?: true;
};

export type VisualRamp = {
  key: string;
  x: number; y: number; z: number;
  width: number; height: number; depth: number;
  slabThickness: number;
  yawDegrees: number;
  color: string;
  textureKey?: string;
  opacity?: number;
};

export type VisualShape =
  | { kind: 'box'; box: VisualBox }
  | { kind: 'ramp'; ramp: VisualRamp };

/** local (u along width, v along depth) → world offset, R(+yaw) — the same
 *  frame the colliders/raycast/stamp rotate with. */
function localOffset(u: number, v: number, yawDegrees: number): { dx: number; dz: number } {
  const cos = Math.cos(yawDegrees * DEG);
  const sin = Math.sin(yawDegrees * DEG);
  // Match Scene3D/render3d yaw: local +v turns toward world +x at yaw 90.
  return { dx: u * cos + v * sin, dz: -u * sin + v * cos };
}

type FaceLook = { color: string; textureKey?: string; slot?: 'front' | 'back' | 'sides' };

function visualLook(skin: BuildFaceSkin | undefined, fallback: string, slot: 'front' | 'back' | 'sides'): FaceLook {
  if (!skin) return { color: fallback, slot };
  if (skin.kind === 'color') return { color: skin.value, slot };
  return { color: '#ffffff', textureKey: `bldskin:${skin.id}`, slot };
}

function isHorizontalSkinPiece(kind: string): boolean {
  return kind === 'floor' || kind === 'roof';
}

export function pieceVisualShapes(
  piece: { pieceId: string; x: number; y: number; z: number; yawDegrees: number; edit?: WallEdit; skin?: BuildSkinSet; doorOpen?: boolean },
  key: string,
  pieces?: readonly PlacedBuildPiece[],
): VisualShape[] {
  const def = GAME_BUILD.catalog.get(piece.pieceId);
  const look = MATERIAL_LOOK[def.material];
  const sides = visualLook(piece.skin?.sides, look.color, 'sides');
  const front = visualLook(piece.skin?.front, look.color, 'front');
  const back = visualLook(piece.skin?.back, look.color, 'back');
  const size = def.size;
  const yaw = piece.yawDegrees;
  const depthSpan = GAME_BUILD.placed.depthSpan({ id: key, ...piece }, pieces);
  const depthCenter = (depthSpan.minV + depthSpan.maxV) / 2;
  const depthSize = depthSpan.maxV - depthSpan.minV;
  const box = (
    k: string,
    u: number,
    v: number,
    baseY: number,
    w: number,
    h: number,
    d: number,
    face: FaceLook,
    opacity?: number,
  ): VisualShape => {
    const { dx, dz } = localOffset(u, v, yaw);
    return {
      kind: 'box',
      box: {
        key: `${key}.${k}`,
        cx: piece.x + dx, cy: baseY + h / 2, cz: piece.z + dz,
        sx: w, sy: h, sz: d,
        yawDegrees: yaw,
        color: face.color,
        textureKey: face.textureKey,
        opacity: opacity ?? look.opacity,
        slot: face.slot,
      },
    };
  };

  if (def.kind === 'ramp') {
    return [{
      kind: 'ramp',
      ramp: {
        key: `${key}.slope`,
        x: piece.x, y: piece.y, z: piece.z,
        width: size.widthMeters,
        height: size.heightMeters,
        depth: size.depthMeters,
        slabThickness: GAME_BUILD.placed.tuning.rampSlabThicknessMeters,
        yawDegrees: yaw,
        color: front.color,
        textureKey: front.textureKey,
        opacity: look.opacity,
      },
    }];
  }

  if (def.kind === 'stairs') {
    // stepped boxes rising along local +v — the heightfield's own direction,
    // so stairs stay visually distinct from the ramp's smooth plane.
    const boxes: VisualShape[] = [];
    const steps = GAME_BUILD.placed.tuning.stairVisualSteps;
    for (let i = 0; i < steps; i += 1) {
      const v = (-size.depthMeters / 2) + ((i + 0.5) / steps) * size.depthMeters;
      const h = ((i + 1) / steps) * size.heightMeters;
      const { dx, dz } = localOffset(0, v, yaw);
      boxes.push({
        kind: 'box',
        box: {
          key: `${key}.s${i}`,
          cx: piece.x + dx, cy: piece.y + h / 2, cz: piece.z + dz,
          sx: size.widthMeters, sy: h, sz: size.depthMeters / steps,
          yawDegrees: yaw,
          color: front.color,
          textureKey: front.textureKey,
          opacity: look.opacity,
        },
      });
    }
    return boxes;
  }

  if (def.kind === 'elevator') {
    // REQ-0647: the shaft storey is an OPEN-FRONT frame — corner posts, thin
    // back/side walls, a header beam over the front opening — never a solid
    // box (the user's verdict: "a solid 1x* box that isnt an elevator at
    // all"). The CAR is live and rendered by its owner (PlayRoute's ride
    // layer / the iso pane's rest-car layer) via elevatorCarVisualShape.
    const t = GAME_BUILD.placed.tuning;
    const halfW = size.widthMeters / 2;
    const halfD = size.depthMeters / 2;
    const wall = t.elevatorShaftWallThicknessMeters;
    const post = t.elevatorPostSizeMeters;
    const h = size.heightMeters;
    const shapes: VisualShape[] = [
      box('left', -halfW + wall / 2, 0, piece.y, wall, h, size.depthMeters - post * 2, sides),
      box('right', halfW - wall / 2, 0, piece.y, wall, h, size.depthMeters - post * 2, sides),
      box('back', 0, halfD - wall / 2, piece.y, size.widthMeters - post * 2, h, wall, back),
      box('header', 0, -halfD + wall / 2, piece.y + h - t.elevatorHeaderHeightMeters, size.widthMeters - post * 2, t.elevatorHeaderHeightMeters, wall, front),
    ];
    for (const [pu, pv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      shapes.push(box(`post${pu}${pv}`, pu * (halfW - post / 2), pv * (halfD - post / 2), piece.y, post, h, post, front));
    }
    return shapes;
  }

  const edit = piece.edit;
  if (GAME_BUILD.kinds.get(def.kind).edits === 'wall') {
    const shapes: VisualShape[] = [];
    const slab = BUILD_UI.faceSlabThicknessMeters;
    const lift = BUILD_UI.faceSlabLiftMeters;
    const frontV = depthSpan.maxV + lift;
    const backV = depthSpan.minV - lift;
    const isWindowOpening = edit === 'window' || edit === 'doubleWindow' || edit === 'brokenWindow';
    const hasGlassPane = edit === 'window' || edit === 'doubleWindow';
    const openingW = edit === 'doubleWindow' ? BUILD_UI.doubleWindowCutoutWidthMeters : BUILD_UI.editCutoutWidthMeters;
    const openingH = BUILD_UI.editCutoutHeightMeters;
    const openingBottom = piece.y + size.heightMeters * 0.55 - openingH / 2;
    const openingTop = openingBottom + openingH;
    // CORNERSEAM-0610: miter the face slabs where two walls corner. The core
    // bodies already close (run limits extend through the joining wall), but
    // each slab floats `lift` proud of its core, leaving an open vertical
    // pocket at the convex corner. Closure: the x-axis wall's outer slab runs
    // THROUGH to the joining wall's slab outer surface; the z-axis wall's
    // BUTTS into the through slab's inner surface. One through + one butt =
    // pocket filled, end caps meet edge-to-edge, no coplanar faces to z-fight.
    const bands = GAME_BUILD.placed.bands(piece as PlacedBuildPiece, pieces);
    const ends = GAME_BUILD.placed.wallEnds(piece as PlacedBuildPiece, pieces);
    const cornerExt = ends.axis === 'x' ? lift + slab / 2 : Math.max(0, lift - slab / 2);
    const wallMinU = bands.length > 0 ? bands[0].u0 : 0;
    const wallMaxU = bands.length > 0 ? bands[bands.length - 1].u1 : 0;
    const slabU0 = (u0: number, vSign: 1 | -1): number =>
      u0 === wallMinU && ends.minU?.outerV === vSign ? u0 - cornerExt : u0;
    const slabU1 = (u1: number, vSign: 1 | -1): number =>
      u1 === wallMaxU && ends.maxU?.outerV === vSign ? u1 + cornerExt : u1;
    const addWallBox = (label: string, u0: number, u1: number, baseY: number, h: number): void => {
      if (u1 - u0 <= 0.001 || h <= 0.001) return;
      shapes.push(box(`${label}.core`, (u0 + u1) / 2, depthCenter, baseY, u1 - u0, h, depthSize, sides));
      const f0 = slabU0(u0, 1);
      const f1 = slabU1(u1, 1);
      shapes.push(box(`${label}.front`, (f0 + f1) / 2, frontV, baseY, f1 - f0, h, slab, front));
      const b0 = slabU0(u0, -1);
      const b1 = slabU1(u1, -1);
      shapes.push(box(`${label}.back`, (b0 + b1) / 2, backV, baseY, b1 - b0, h, slab, back));
    };
    for (const [index, band] of bands.entries()) {
      const label = `band${index}`;
      if (!isWindowOpening) {
        addWallBox(label, band.u0, band.u1, piece.y, band.top - piece.y);
        continue;
      }
      const holeU0 = -openingW / 2;
      const holeU1 = openingW / 2;
      const leftU0 = band.u0;
      const leftU1 = Math.min(band.u1, holeU0);
      const rightU0 = Math.max(band.u0, holeU1);
      const rightU1 = band.u1;
      addWallBox(`${label}.leftJamb`, leftU0, leftU1, piece.y, band.top - piece.y);
      addWallBox(`${label}.rightJamb`, rightU0, rightU1, piece.y, band.top - piece.y);
      const midU0 = Math.max(band.u0, holeU0);
      const midU1 = Math.min(band.u1, holeU1);
      if (midU1 > midU0) {
        addWallBox(`${label}.sill`, midU0, midU1, piece.y, Math.max(0, openingBottom - piece.y));
        addWallBox(`${label}.header`, midU0, midU1, openingTop, Math.max(0, band.top - openingTop));
      }
    }
    if (hasGlassPane) {
      shapes.push(box(
        'glassPane',
        0,
        depthCenter,
        openingBottom,
        openingW,
        openingH,
        BUILD_UI.windowPaneDepthMeters,
        { color: BUILD_UI.windowPaneColor },
        BUILD_UI.windowPaneOpacity,
      ));
    }
    // The closed DOOR PANEL — only edits that DECLARE an interaction have a
    // leaf (door/garageDoor); an arch is "a doorway with no door" and a
    // halfHeight wall has no cutout at all. The panel's footprint is the
    // COLLISION panel's (placedClosedDoorBand: the portal opening × the panel
    // height from PLACED_TUNING) so what blocks the body is exactly what
    // blocks the eye — req_0654's hidden-wall class, killed at the source.
    // (Replaces the old dark 'edit' placeholder box that also opaquely filled
    // arches and floated mid-wall on halfHeight.)
    const interaction = edit ? GAME_BUILD.edits.wall[edit]?.interaction : null;
    if (edit !== undefined && interaction && piece.doorOpen !== true) {
      const tuning = GAME_BUILD.placed.tuning;
      const vehicle = GAME_BUILD.edits.wall[edit].portalKind === 'vehicle';
      const panelW = vehicle ? tuning.vehicleOpeningWidthMeters : tuning.walkOpeningWidthMeters;
      const panelH = Math.min(size.heightMeters, vehicle ? tuning.garageDoorPanelHeightMeters : tuning.walkDoorPanelHeightMeters);
      const panel = box('door', 0, depthCenter, piece.y, panelW, panelH, depthSize + 0.06, { color: DOOR_PANEL_COLOR });
      if (panel.kind === 'box') panel.box.door = true;
      shapes.push(panel);
    }
    return shapes;
  }
  if (isHorizontalSkinPiece(def.kind)) {
    const slab = BUILD_UI.faceSlabThicknessMeters;
    const lift = BUILD_UI.faceSlabLiftMeters;
    const coreHeight = Math.max(0.01, size.heightMeters - lift * 2);
    return [
      box('edges', 0, 0, piece.y + lift, size.widthMeters, coreHeight, size.depthMeters, sides),
      box('top', 0, 0, piece.y + size.heightMeters + lift - slab / 2, size.widthMeters, slab, size.depthMeters, front),
      box('bottom', 0, 0, piece.y - lift - slab / 2, size.widthMeters, slab, size.depthMeters, back),
    ];
  }

  return [box('body', 0, 0, piece.y, size.widthMeters, size.heightMeters, size.depthMeters, front)];
}

/** REQ-0647: the elevator CAR as a renderable shape. The car is LIVE state —
 *  pieceVisualShapes never draws it; its owner does (PlayRoute's ride layer at
 *  the live height, the iso pane at the rest stop, the ghost at the snap
 *  target) — one footprint source (GAME_BUILD.elevators.carBox), one look. */
export function elevatorCarVisualShape(
  carBox: { cx: number; cy: number; cz: number; sx: number; sy: number; sz: number; yawDegrees: number },
  key: string,
): VisualShape {
  return {
    kind: 'box',
    box: {
      key,
      cx: carBox.cx, cy: carBox.cy, cz: carBox.cz,
      sx: carBox.sx, sy: carBox.sy, sz: carBox.sz,
      yawDegrees: carBox.yawDegrees,
      color: BUILD_UI.elevatorCarColor,
    },
  };
}

export function wallJoinSignature(piece: PlacedBuildPiece, pieces: readonly PlacedBuildPiece[]): string {
  const def = GAME_BUILD.catalog.get(piece.pieceId);
  if (GAME_BUILD.kinds.get(def.kind).edits !== 'wall') return '';
  // End-corner state rides the digest (CORNERSEAM-0610): a neighbor can change
  // only the slab miter (not the bands), and the memo must still re-render.
  const ends = GAME_BUILD.placed.wallEnds(piece, pieces);
  const endsKey = `#${ends.minU?.outerV ?? 0}:${ends.maxU?.outerV ?? 0}`;
  return GAME_BUILD.placed.bands(piece, pieces)
    .map((band) => `${band.u0.toFixed(3)}:${band.u1.toFixed(3)}:${band.top.toFixed(3)}`)
    .join('|') + endsKey;
}
