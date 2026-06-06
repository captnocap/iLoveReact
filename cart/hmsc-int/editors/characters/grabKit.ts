// editors/characters/grabKit.ts — direct mesh grabbing (GRABSHAPE-0605):
// hover the 3D preview to SEE where a grab will land, drag a grabbed point to
// pull the surface out / push it in.
//
// ONE TRUTH (the V24 invariant applied to sculpting): a grab edits the SAME
// 48×24 signed displacement grid the unwrap depth-paint edits — the stamp is
// regions.ts's stampGrid, the surface is @reactjit/geometries globeSurface
// (the exact math generate() builds vertices from), so the grabbable surface,
// the rendered mesh, and the painted grid can never disagree. There is no
// second deformation store.
//
// WHAT A GRAB CAN DO, honestly: the Globe is parameterized by RADIAL
// displacement only — a grabbed point moves along its outward direction
// (pull a cheek out, push a waist in, with stampGrid's smooth elliptical
// falloff). Mouse motion projects onto that radial axis; there is no
// tangential parameter to slide along (silhouette widths are the outline
// lathe's job). Handles never snap to nothing: every cell the hover marks is
// a cell a drag really edits.
//
// Pure math, headless-testable — the route owns React state, throttling, and
// the V20 session notes. Picking goes through GAME_CAMERA.screenRay /
// worldToScreen (registry pure math — sanctioned under V26, which kills JS
// viewport DRIVING, not semantic camera math).

import { GAME_CAMERA, type Rect, type Solved } from '../../game/camera';
import { globeSurface, type GlobeParams } from '@reactjit/geometries';
import { rotateEulerVec, type V3 } from '../../game/figure/math';
import { HED_GRID_H, HED_GRID_W } from '../../game/figure/hed';
import type { PartId } from '../../game/figure/shapes';
import type { BodyInstance } from '../../game/figure/assembly';
import { stampGrid } from './regions';

export const GRAB_TUNING = Object.freeze({
  /** grab radius = factor × the cloud's cell spacing (world units) */
  pickRadiusFactor: 0.8,
  /** a candidate must face the camera at least this much (dot(outward, rayDir) below it) */
  facingMax: 0.15,
  /** the FASTEST a drag gets: never fewer mouse-px per +1.0 grid value than
   *  this (small parts project a tiny axis; without the floor they'd be
   *  hair-trigger AND every part would feel different — the head-easier-
   *  than-torso report) */
  minPxPerUnit: 56,
  /** below this projected length the axis direction is noise (it points at
   *  the camera — the torso's flat front) — fall back to screen-up = pull out */
  degenerateAxisPx: 6,
  /** the fallback's sensitivity: a straight-up drag of this many px = +1.0 */
  fallbackPxPerUnit: 90,
  /** live mesh re-sculpt cadence mid-drag (release always lands the final) */
  liveSyncMs: 80,
  /** the stamp ellipse never gets narrower than this many grid columns */
  stampRxMinCells: 1.4,
  /** ry = aspect × rx: v spans half the circumference u does, so 2 keeps the
   *  stamp round on the surface */
  stampAspect: 2,
  /** |total drag value| is clamped here (stampGrid clamps cells to ±1 anyway) */
  maxDragValue: 2,
  /** handle sphere radius = scale × grab radius */
  handleScale: 0.5,
  /** the influence shell's translucency */
  shellOpacity: 0.16,
  /** the wireframe overlay: inflate factor (floats just above the skin),
   *  mesh tint + translucency (texture alpha carries the lines/dots) */
  grid: { inflate: 1.012, color: '#bfe6ff', opacity: 0.92 },
  colors: { hover: '#38bdf8', raise: '#38bdf8', carve: '#f97316' },
});

/** The grid overlay's texture key — ONE static bake (GRAB_GRID_WGSL below). */
export const GRAB_GRID_TEXTURE_KEY = 'chr.grabgrid';

// ── instances — which meshes are grabbable, and where they sit ───────────────

/** One grabbable mesh placement (a strict subset of the rendered transform). */
export type GrabInstance = {
  part: PartId;
  position: V3;
  rotation?: V3;
  /** RESOLVED per-axis scale — instanceScaleVec keeps it identical to render */
  scale: V3;
};

/** The mesh prop's scale resolution, shared by render and pick: `thickness`
 *  multiplies the lateral axes on top of the uniform scale. */
export function instanceScaleVec(scale: number, thickness?: number | null): V3 {
  return thickness != null ? [scale * thickness, scale, scale * thickness] : [scale, scale, scale];
}

/** The route's PART-view placement (preview.tsx renders the selected part here). */
export const PART_VIEW_PLACEMENT = Object.freeze({ position: [0, 1.4, 0] as V3 });

/** The grabbable instances for a view. Figure view grabs the ASSEMBLY only —
 *  anatomy sockets reuse other parts' grids (a shoulder ball is a 'hand'), so
 *  grabbing one would edit a surprising part; clothing is garments, not sculpt
 *  (a grab reaches through a sleeve onto the body part under it). */
export function grabInstancesFor(view: 'part' | 'figure', selPart: PartId, assembly: BodyInstance[]): GrabInstance[] {
  if (view === 'part') {
    return [{ part: selPart, position: PART_VIEW_PLACEMENT.position, scale: [1, 1, 1] }];
  }
  return assembly.map((inst) => ({
    part: inst.part,
    position: inst.position,
    rotation: inst.rotation,
    scale: instanceScaleVec(inst.scale, inst.thickness),
  }));
}

// host transform law (gpu/3d.zig): world = T · Ry·Rx·Rz · S · local —
// rotateEulerVec IS Ry·Rx·Rz (figure/math owns that convention)
function toWorld(local: V3, inst: GrabInstance): V3 {
  const scaled: V3 = [local[0] * inst.scale[0], local[1] * inst.scale[1], local[2] * inst.scale[2]];
  const rotated = inst.rotation ? rotateEulerVec(scaled, inst.rotation) : scaled;
  return [rotated[0] + inst.position[0], rotated[1] + inst.position[1], rotated[2] + inst.position[2]];
}

// ── clouds — every grid cell's surface point, in world space ─────────────────

export type GrabCloud = {
  part: PartId;
  instanceIndex: number;
  /** world cell-center points, xyz interleaved, row-major gy·48+gx */
  points: Float32Array;
  /** world outward directions (unit, the facing test), same layout */
  outward: Float32Array;
  /** adaptive pick radius (world) from this instance's cell spacing */
  grabRadius: number;
};

const CELLS = HED_GRID_W * HED_GRID_H;

/** uv center of grid cell (gx, gy) — the SAME convention the Globe's bilinear
 *  sample and the paint downsample use ((x+0.5)/W). */
export function cellUv(gx: number, gy: number): { cu: number; cv: number } {
  return { cu: (gx + 0.5) / HED_GRID_W, cv: (gy + 0.5) / HED_GRID_H };
}

/**
 * Sample every grid cell of every instance onto the displaced surface.
 * `paramsFor` is the route's editorPartParams output — the EXACT params the
 * rendered mesh carries, so the cloud sits on the rendered skin.
 */
export function buildGrabClouds(instances: GrabInstance[], paramsFor: (part: PartId) => GlobeParams): GrabCloud[] {
  // one local-space cloud per distinct part, shared across its instances
  const localByPart = new Map<PartId, { pts: Float32Array; out: Float32Array }>();
  for (const inst of instances) {
    if (localByPart.has(inst.part)) continue;
    const surf = globeSurface(paramsFor(inst.part));
    const pts = new Float32Array(CELLS * 3);
    const out = new Float32Array(CELLS * 3);
    for (let gy = 0; gy < HED_GRID_H; gy++) {
      for (let gx = 0; gx < HED_GRID_W; gx++) {
        const { cu, cv } = cellUv(gx, gy);
        const p = surf(cu, cv);
        // outward = the direction displacement moves the point (numeric, so it
        // respects profile/scale exactly): point at +0.5 minus point at -0.5
        const a = surf(cu, cv, 0.5);
        const b = surf(cu, cv, -0.5);
        const i = (gy * HED_GRID_W + gx) * 3;
        pts[i] = p[0]; pts[i + 1] = p[1]; pts[i + 2] = p[2];
        out[i] = a[0] - b[0]; out[i + 1] = a[1] - b[1]; out[i + 2] = a[2] - b[2];
      }
    }
    localByPart.set(inst.part, { pts, out });
  }

  return instances.map((inst, instanceIndex) => {
    const local = localByPart.get(inst.part)!;
    const points = new Float32Array(CELLS * 3);
    const outward = new Float32Array(CELLS * 3);
    for (let c = 0; c < CELLS; c++) {
      const i = c * 3;
      const w = toWorld([local.pts[i], local.pts[i + 1], local.pts[i + 2]], inst);
      points[i] = w[0]; points[i + 1] = w[1]; points[i + 2] = w[2];
      // directions ignore translation; mild nonuniform scale makes this an
      // approximation — fine for a facing THRESHOLD, never used as a normal
      const scaled: V3 = [local.out[i] * inst.scale[0], local.out[i + 1] * inst.scale[1], local.out[i + 2] * inst.scale[2]];
      const d = inst.rotation ? rotateEulerVec(scaled, inst.rotation) : scaled;
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      outward[i] = d[0] / l; outward[i + 1] = d[1] / l; outward[i + 2] = d[2] / l;
    }
    // adaptive grab radius: the widest neighbor spacing, BOTH directions —
    // columns at the equator (widest ring) AND rows along the part's length
    // (a long slim pipe's row spacing dwarfs its column spacing; radius from
    // columns alone let rays fall between rows and miss the forearm)
    const midRow = HED_GRID_H >> 1;
    const eq = midRow * HED_GRID_W * 3;
    let spacing = 0;
    const span = (a: number, b: number) =>
      Math.hypot(points[b] - points[a], points[b + 1] - points[a + 1], points[b + 2] - points[a + 2]);
    for (const gx of [0, HED_GRID_W >> 2, HED_GRID_W >> 1]) {
      spacing = Math.max(spacing, span(eq + gx * 3, eq + ((gx + 1) % HED_GRID_W) * 3));
      spacing = Math.max(spacing, span((midRow - 1) * HED_GRID_W * 3 + gx * 3, midRow * HED_GRID_W * 3 + gx * 3));
    }
    return { part: inst.part, instanceIndex, points, outward, grabRadius: spacing * GRAB_TUNING.pickRadiusFactor };
  });
}

// ── pick — pixel → the cell under it ─────────────────────────────────────────

export type GrabHit = {
  part: PartId;
  instanceIndex: number;
  gx: number;
  gy: number;
  cu: number;
  cv: number;
  /** the grabbed surface point (world) at pick time */
  world: V3;
  grabRadius: number;
  /** distance along the ray (the depth-order key) */
  t: number;
};

/** The cell whose surface point sits nearest the pixel's ray — front-facing,
 *  closest-along-ray wins (so a cheek beats the back of the skull). */
export function pickGrab(sx: number, sy: number, rect: Rect, cam: Solved, clouds: GrabCloud[]): GrabHit | null {
  const ray = GAME_CAMERA.screenRay(sx, sy, rect, cam);
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.dir;
  let best: GrabHit | null = null;
  for (const cloud of clouds) {
    const { points, outward, grabRadius } = cloud;
    const r2 = grabRadius * grabRadius;
    for (let c = 0; c < CELLS; c++) {
      const i = c * 3;
      const wx = points[i] - ox, wy = points[i + 1] - oy, wz = points[i + 2] - oz;
      const t = wx * dx + wy * dy + wz * dz;
      if (t <= 0 || (best && t >= best.t)) continue;
      const distSq = wx * wx + wy * wy + wz * wz - t * t;
      if (distSq > r2) continue;
      if (outward[i] * dx + outward[i + 1] * dy + outward[i + 2] * dz > GRAB_TUNING.facingMax) continue;
      const gx = c % HED_GRID_W;
      const gy = (c / HED_GRID_W) | 0;
      const { cu, cv } = cellUv(gx, gy);
      best = {
        part: cloud.part, instanceIndex: cloud.instanceIndex, gx, gy, cu, cv,
        world: [points[i], points[i + 1], points[i + 2]], grabRadius, t,
      };
    }
  }
  return best;
}

// ── drag — mouse deltas → grid value, value → stamped grid ───────────────────

/** World direction the grabbed point moves per +1.0 grid value (numeric over
 *  the same surface fn, so amount/profile/instance scale are all in it). */
export function grabDragAxis(hit: GrabHit, params: GlobeParams, inst: GrabInstance): V3 {
  const surf = globeSurface(params);
  const a = toWorld(surf(hit.cu, hit.cv, 0.5), inst);
  const b = toWorld(surf(hit.cu, hit.cv, -0.5), inst);
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export type ScreenAxis = { x: number; y: number; len2: number };

/** The drag axis in screen space — DIRECTION from the projected radial axis,
 *  SENSITIVITY floored at minPxPerUnit so every part drags with the same
 *  hand-feel (a small part's tiny projection used to make its direction noisy
 *  and its travel mushy — the head-easier-than-torso report). When the axis
 *  points at the camera (the torso's flat front: projection under
 *  degenerateAxisPx) there is no usable screen direction, so the mapping
 *  falls back to every sculpt tool's: drag UP pulls out, DOWN carves in, at
 *  fallbackPxPerUnit. The returned vector is dir × pxPerUnit, so
 *  gridDeltaFor's dot/len2 is dot(mouse, dir)/pxPerUnit. */
export function screenAxisFor(world: V3, axisWorld: V3, rect: Rect, cam: Solved): ScreenAxis {
  const p0 = GAME_CAMERA.worldToScreen(world, rect, cam);
  const p1 = GAME_CAMERA.worldToScreen([world[0] + axisWorld[0], world[1] + axisWorld[1], world[2] + axisWorld[2]], rect, cam);
  const fb = GRAB_TUNING.fallbackPxPerUnit;
  if (p0 && p1) {
    const x = p1.x - p0.x;
    const y = p1.y - p0.y;
    const len = Math.hypot(x, y);
    if (len >= GRAB_TUNING.degenerateAxisPx) {
      const pxPerUnit = Math.max(len, GRAB_TUNING.minPxPerUnit);
      const k = pxPerUnit / len;
      return { x: x * k, y: y * k, len2: pxPerUnit * pxPerUnit };
    }
  }
  return { x: 0, y: -fb, len2: fb * fb };
}

/** Mouse delta (px) → grid value delta along the screen axis, clamped. */
export function gridDeltaFor(dxPx: number, dyPx: number, axis: ScreenAxis): number {
  const raw = (dxPx * axis.x + dyPx * axis.y) / axis.len2;
  return Math.max(-GRAB_TUNING.maxDragValue, Math.min(GRAB_TUNING.maxDragValue, raw));
}

/** The stamp ellipse (uv radii) for the brush knob — the grab region follows
 *  the same brush size the paint canvas uses. */
export function stampRadiusUv(brushPx: number, paintW: number): { rx: number; ry: number } {
  const rx = Math.max(brushPx / paintW, GRAB_TUNING.stampRxMinCells / HED_GRID_W);
  return { rx, ry: Math.min(0.49, rx * GRAB_TUNING.stampAspect) };
}

/** A cell's CURRENT surface point (world) — the marker rides this, so it sits
 *  on the rendered skin and follows the surface up/down as a drag stamps. */
export function grabPointWorld(params: GlobeParams, inst: GrabInstance, cu: number, cv: number): V3 {
  return toWorld(globeSurface(params)(cu, cv), inst);
}

/** Half the world width the stamp ellipse spans at a cell — the influence
 *  shell's radius (what "this much of the surface will move" looks like). */
export function stampWorldRadius(params: GlobeParams, inst: GrabInstance, cu: number, cv: number, rxUv: number): number {
  const surf = globeSurface(params);
  const a = toWorld(surf(cu - rxUv, cv), inst);
  const b = toWorld(surf(cu + rxUv, cv), inst);
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2;
}

/** A drag's grid: ONE smooth stamp of the total delta onto the drag-start
 *  base (never incremental — re-stamping per move would compound falloff).
 *  This is regions.ts stampGrid — the identical math a region slider uses,
 *  writing the identical grid the depth-paint reads and writes. */
export function applyGrabStamp(base: number[], cu: number, cv: number, rxUv: number, ryUv: number, delta: number, mirror: boolean): number[] {
  const g = base.slice();
  if (delta !== 0) stampGrid(g, cu, cv, rxUv, ryUv, delta, mirror);
  return g;
}

// ── the wireframe grid texture (the "see the grid stretch" toggle) ───────────
// Baked ONCE under GRAB_GRID_TEXTURE_KEY (StaticSurface + this Effect) and
// sampled by an inflated twin of the part mesh, whose UVs ARE unwrap space —
// so the lines run exactly THROUGH the 48×24 cell centers (the pull points),
// every intersection dot IS a grabbable point, and the whole lattice stretches
// with the surface as a drag deforms it (vertices move, UVs don't).
// Transparent outside lines/dots: the capture clears to alpha 0 and the mesh
// shader multiplies texture alpha. (No backticks in WGSL.)
export const GRAB_GRID_WGSL = `
@group(0) @binding(1) var<storage, read> data: array<f32>;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  // cell space: integer steps are cell boundaries; centers sit at +0.5 —
  // lines/dots land ON the centers (the actual grab cells)
  let cell = vec2f(in.uv.x * ${HED_GRID_W}.0, in.uv.y * ${HED_GRID_H}.0);
  let f = fract(cell) - vec2f(0.5);
  let fw = max(fwidth(cell), vec2f(0.0001));

  // hairlines through every cell center, ~1.1px with screen-space AA
  let lx = 1.0 - smoothstep(0.0, fw.x * 1.1, abs(f.x));
  let ly = 1.0 - smoothstep(0.0, fw.y * 1.1, abs(f.y));
  let line_a = max(lx, ly) * 0.5;

  // a dot at every intersection — the pull points
  let d = length(f);
  let dot_a = 1.0 - smoothstep(0.16, 0.16 + max(fw.x, fw.y) * 1.4, d);

  let a = clamp(line_a + dot_a, 0.0, 0.92);
  let col = mix(vec3f(0.55, 0.82, 1.0), vec3f(1.0, 1.0, 1.0), dot_a);
  return vec4f(col * a, a);
}
`;
