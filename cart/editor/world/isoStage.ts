// isoStage.ts — the iso authoring camera: a Sims-style build-mode view over the
// REAL 3D world (not a second renderer). It pans, zooms, rotates in 90° detents,
// and resolves a screen click to a world cell on the active FLOOR LEVEL.
//
// The editor owns this controller and uses the framework camera kit directly.
//
// Pure controller, no React: it solves and picks headless. The pane holds one
// in a ref and drives it from input.

import { solveCamera } from '@reactjit/cameras/solve';
import { screenRay, unprojectGround, worldToScreen } from '@reactjit/cameras/unproject';
import { Isometric } from '@reactjit/cameras/rigs/isometric';
import type { Rect, Solved, Vec3 } from '@reactjit/cameras/types';

export type { Rect, Solved, Vec3 };

const ISO_YAW_START = 45;      // true-iso opens looking at tile CORNERS, not faces
export const ISO_FOV = 22;     // narrow → flattens perspective toward orthographic
const BASE_DIST = 90;          // metres from target at zoom 1 (a chunk is 120m)
const MIN_ZOOM = 0.12;         // far out — survey a whole district
const MAX_ZOOM = 10;           // close in — detail a single wall
export const ISO_PITCH = 35.264; // true isometric elevation: atan(1/sqrt(2))
// Tilt range (req_2710): low enough to almost level out with the horizon,
// high enough for a near-plan view — but shy of 90°, where the yaw basis
// degenerates (the host brush ray bails on a straight-down camera).
const MIN_PITCH = 12;
const MAX_PITCH = 80;

// One floor level == one storey == one build-mode wall. The value is the
// editor-owned R4-adjacent storey module and does not drift.
export const METERS_PER_LEVEL = 3;

export interface IsoPose {
  centerX: number; // world tile the view orbits over (pan), in tiles
  centerZ: number;
  // Metres above the terrain beneath the focus point. Camera height remains
  // independent of the active editing storey: changing floors moves the
  // placement/pick surface, not the user's view.
  viewY: number;
  yaw: number;     // compass rotation in DEGREES — continuous (mouse-drag) + 90° buttons
  pitch: number;   // elevation above the horizon in DEGREES — tilt between near-level and near-plan
  zoom: number;    // 1 = BASE_DIST; larger = closer
  level: number;   // active floor; clicks land on its slab (>= 0)
}

// A picked cell: the integer tile (tx,tz) for snapping, plus the exact world hit
// (wx,wz) for sub-tile placement (object centres, wall edges).
export interface CellPick {
  tx: number;
  tz: number;
  wx: number;
  wz: number;
}

/** The build-door ray shape (runtime/game/build.ts BuildRay). */
export interface WorldRay {
  origin: { x: number; y: number; z: number };
  dir: { x: number; y: number; z: number };
}

// World (x,z) -> ground height in metres, so a level-0 pick follows painted
// terrain. The stage owns the level offset; the caller owns terrain sampling, so
// the camera never learns what a landform is (deep boundary, narrow surface).
export type HeightSampler = (x: number, z: number) => number;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class IsoStage {
  pose: IsoPose;
  private sampleHeight: HeightSampler;
  private focusTerrainY = 0;

  constructor(initial?: Partial<IsoPose>, heightAt: HeightSampler = () => 0) {
    // Old hot-state twigs predate viewY and encoded the camera target in level.
    // Preserve that view once on migration; later setLevel calls never alter it.
    const migratedViewY = initial?.viewY ?? (initial?.level ?? 0) * METERS_PER_LEVEL;
    this.pose = { centerX: 0, centerZ: 0, yaw: ISO_YAW_START, pitch: ISO_PITCH, zoom: 1, level: 0, ...initial, viewY: migratedViewY };
    this.sampleHeight = heightAt;
  }

  // Swap the terrain sampler when the painted world changes, without rebuilding the
  // stage (which would drop the pose).
  setHeightSampler(heightAt: HeightSampler): void {
    this.sampleHeight = heightAt;
  }

  // Sample exactly once at an interaction/update boundary. `solve()` is also
  // used by every projected overlay corner, so doing capability I/O inside it
  // would multiply host crossings by the number of visible guides.
  refreshTerrainElevation(): boolean {
    const sampled = this.sampleHeight(this.pose.centerX, this.pose.centerZ);
    const next = Number.isFinite(sampled) ? sampled : 0;
    if (next === this.focusTerrainY) return false;
    this.focusTerrainY = next;
    return true;
  }

  yawDegrees(): number {
    return this.pose.yaw;
  }

  levelElevation(): number {
    return this.pose.level * METERS_PER_LEVEL;
  }

  terrainElevation(): number {
    return this.focusTerrainY;
  }

  focusElevation(): number {
    return this.terrainElevation() + this.pose.viewY;
  }

  // Semantic solve for boot-frame parity and picking. The rendered author viewport
  // is native-driven (the pose is pushed through __compiled_world_set_camera), not
  // per-frame JS camera props.
  solve(): Solved {
    const dist = BASE_DIST / clamp(this.pose.zoom, MIN_ZOOM, MAX_ZOOM);
    const target: Vec3 = [this.pose.centerX, this.focusElevation(), this.pose.centerZ];
    return solveCamera(Isometric, {
      target,
      yaw: this.yawDegrees(),
      dist,
      fov: ISO_FOV,
      pitch: clamp(this.pose.pitch ?? ISO_PITCH, MIN_PITCH, MAX_PITCH),
    });
  }

  // Rotate the whole view 90° (the ⟲⟳ buttons / Q·E). Snaps to the nearest iso detent
  // (45° + k·90° — the corner-on views) from wherever a free drag left the yaw, then
  // steps, so the buttons always land square on a clean quarter turn.
  rotate(dir: 1 | -1): void {
    const detent = Math.round((this.pose.yaw - ISO_YAW_START) / 90) * 90 + ISO_YAW_START;
    this.pose.yaw = detent + dir * 90;
  }

  // Continuous rotate from a mouse drag (degrees). Lets you spin the view to any angle,
  // not just the four detents.
  rotateBy(deltaDegrees: number): void {
    this.pose.yaw += deltaDegrees;
  }

  // Tilt the view (req_2710): raise toward a plan view or lower toward the
  // horizon. Clamped so the camera never goes level or straight-down.
  pitchBy(deltaDegrees: number): void {
    this.pose.pitch = clamp((this.pose.pitch ?? ISO_PITCH) + deltaDegrees, MIN_PITCH, MAX_PITCH);
  }

  zoomBy(factor: number): void {
    this.pose.zoom = clamp(this.pose.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  }

  // The cursor's world point on a local analytic plane through the terrain
  // beneath the camera focus + the active storey. Distance-independent on
  // purpose: the marching
  // unprojectGround caps its ray at MAX_T≈400m, but the iso eye sits BASE_DIST/zoom
  // (up to ~750m at MIN_ZOOM) from the target, so a zoomed-out cursor ray never
  // reaches the ground and the march bails to cam.target — which made zoom-to-cursor
  // jump the centre to the middle of nowhere. A plane solve has no range limit and
  // is exact for the "keep this point under the cursor" anchor (terrain height under
  // the pointer is irrelevant to a horizontal pan delta). Returns null only if the
  // ray is parallel to the plane or the plane sits behind the eye.
  private pointOnPlane(sx: number, sy: number, rect: Rect, planeY: number): { x: number; z: number } | null {
    const r = screenRay(sx, sy, rect, this.solve());
    const dy = r.dir[1];
    if (Math.abs(dy) < 1e-6) return null;
    const t = (planeY - r.origin[1]) / dy;
    if (t <= 0) return null;
    return { x: r.origin[0] + t * r.dir[0], z: r.origin[2] + t * r.dir[2] };
  }

  groundPoint(sx: number, sy: number, rect: Rect): { x: number; z: number } | null {
    return this.pointOnPlane(sx, sy, rect, this.terrainElevation() + this.levelElevation());
  }

  private navigationPoint(sx: number, sy: number, rect: Rect): { x: number; z: number } | null {
    return this.pointOnPlane(sx, sy, rect, this.focusElevation());
  }

  // Zoom toward the cursor (map/Sims behaviour): keep the ground point under the
  // pointer fixed while the distance changes, instead of diving at the screen
  // centre. Solve the cursor's plane point before and after the zoom and shift centre
  // by the difference — so "point at a building and roll in" brings THAT building
  // closer. If either solve fails (degenerate ray), zoom in place rather than jump.
  zoomToCursor(sx: number, sy: number, factor: number, rect: Rect): void {
    const before = this.navigationPoint(sx, sy, rect);
    this.zoomBy(factor);
    const after = this.navigationPoint(sx, sy, rect);
    if (!before || !after) return;
    this.pose.centerX += before.x - after.x;
    this.pose.centerZ += before.z - after.z;
  }

  // Metres the eye sits from the target at the current zoom — pan speed scales by
  // this so a gesture crosses the same fraction of the view whether you're
  // surveying a district or detailing a wall.
  distance(): number {
    return BASE_DIST / clamp(this.pose.zoom, MIN_ZOOM, MAX_ZOOM);
  }

  // Pan: slide the centre across the GROUND along the view's own forward and right
  // axes (derived from the solved eye→target), so "up" always means "deeper into
  // the screen" regardless of which 90° facing you've rotated to. Units: metres.
  nudge(forward: number, strafe: number): void {
    const cam = this.solve();
    let fx = cam.target[0] - cam.pos[0];
    let fz = cam.target[2] - cam.pos[2];
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl; fz /= fl;           // ground-forward (into the screen)
    const rx = -fz, rz = fx;      // ground-right (forward rotated +90° about Y)
    this.pose.centerX += fx * forward + rx * strafe;
    this.pose.centerZ += fz * forward + rz * strafe;
  }

  // Active floor. setLevel clamps at the ground; raise/lower step one storey.
  setLevel(level: number): void {
    this.pose.level = Math.max(0, Math.round(level));
  }
  raiseLevel(): void {
    this.setLevel(this.pose.level + 1);
  }
  lowerLevel(): void {
    this.setLevel(this.pose.level - 1);
  }

  // "Grab the map" pan: solve the cursor's previous and current plane points and shift
  // the centre so the grabbed world point stays under the cursor. Rig-agnostic and
  // trig-free — it rides the same analytic focus plane as zoomToCursor, so it stays
  // exact through every rotation and zoom (no per-facing sign juggling) and never
  // suffers the marched-ray range cap. No-op if either solve is degenerate.
  dragPan(prevX: number, prevY: number, curX: number, curY: number, rect: Rect): void {
    const a = this.navigationPoint(prevX, prevY, rect);
    const b = this.navigationPoint(curX, curY, rect);
    if (!a || !b) return;
    this.pose.centerX += a.x - b.x;
    this.pose.centerZ += a.z - b.z;
  }

  // Screen pixel -> world cell on the active level. Level 0 follows painted terrain;
  // higher floors pick a flat slab at levelElevation() so upper-storey edits land on
  // a plane, not on whatever roof happens to be under the cursor.
  pickCell(sx: number, sy: number, rect: Rect): CellPick {
    const g = unprojectGround(sx, sy, rect, this.solve(), this.levelHeightSampler());
    return { tx: Math.floor(g.x), tz: Math.floor(g.y), wx: g.x, wz: g.y };
  }

  // The cursor's world ray, in the build-door shape raycastBuild consumes — so the
  // pane drives the SAME picking the host does, just from the pointer.
  worldRay(sx: number, sy: number, rect: Rect): WorldRay {
    const r = screenRay(sx, sy, rect, this.solve());
    return {
      origin: { x: r.origin[0], y: r.origin[1], z: r.origin[2] },
      dir: { x: r.dir[0], y: r.dir[1], z: r.dir[2] },
    };
  }

  // World point -> pane-local screen pixel (the exact inverse of worldRay/groundPoint),
  // for the 2D projected overlay the pane draws its ghost with (no second React 3D
  // surface). Returns null when the point sits at/behind the eye plane. Pane-local
  // because worldToScreen reads only rect.width/height.
  project(wx: number, wy: number, wz: number, rect: Rect): { x: number; y: number } | null {
    const s = worldToScreen([wx, wy, wz], rect, this.solve());
    return s ? { x: s.x, y: s.y } : null;
  }

  // Centre the view on a world tile (e.g. jump to a placement, or to the painted
  // centre on open) without disturbing facing/zoom/level.
  centerOn(tx: number, tz: number): void {
    this.pose.centerX = tx;
    this.pose.centerZ = tz;
  }

  // The height field picks resolve against: terrain at level 0, else a flat slab.
  private levelHeightSampler(): HeightSampler {
    if (this.pose.level <= 0) return this.sampleHeight;
    const elev = this.levelElevation();
    return () => elev;
  }
}
