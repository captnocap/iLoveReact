// isoStage.ts — the iso authoring camera: a Sims-style build-mode view over hmsc's
// REAL 3D world (not a second renderer). It pans, zooms, rotates in 90° detents,
// and resolves a screen click to a world cell on the active FLOOR LEVEL — so you
// can customise the 4th floor without climbing to it on foot, the whole reason iso
// authoring beats the embodied view at scale.
//
// This is the literal "capture scape's iso camera" piece, but done right: scape
// fakes 3D with a pitch-squash shader quad welded to its tile/palette model; we
// already render hmsc's world in genuine 3D, so a real Isometric rig (locked
// elevation, long dist + narrow fov → near-orthographic) gives the same readable
// dimetric look while staying preview==game. Every durable piece it leans on —
// the Isometric rig, unprojectGround, worldToScreen — already ships in
// @reactjit/cameras and is re-exported through ./game.
//
// Pure controller, no React: it solves and picks headless, the same contract the
// game's other cameras keep (cutscene clocks + verify runs solve cameras with no
// reconciler in sight). The pane holds one in a ref and drives it from input.

import { GAME_CAMERA, type PieceRay, type Rect, type Solved, type Vec3 } from './game';
import { HMSC_SCALE } from '../hmsc/world/scale';

const ISO_YAW_START = 45;      // true-iso opens looking at tile CORNERS, not faces
const ISO_FOV = 22;            // narrow → flattens perspective toward orthographic
const BASE_DIST = 90;          // metres from target at zoom 1 (a chunk is 120m)
const MIN_ZOOM = 0.12;         // far out — survey a whole district
const MAX_ZOOM = 10;           // close in — detail a single wall

// One floor level == one storey == one F2 build-mode wall. This is NOT a number we
// pick: it IS the build catalog's WALL_SIZE.heightMeters, which is the storey module
// (HMSC_SCALE.storyHeightMeters). Sourcing it here keeps the iso pane's floors in
// lockstep with the pieces the build mode stacks — a wall placed on floor 2 and an
// object dropped on floor 2 sit at the same height because they read one constant.
export const METERS_PER_LEVEL = HMSC_SCALE.storyHeightMeters;

export interface IsoPose {
  centerX: number; // world tile the view orbits over (pan), in tiles
  centerZ: number;
  yaw: number;     // compass rotation in DEGREES — continuous (mouse-drag) + 90° buttons
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

// World (x,z) -> ground height in metres, so a level-0 pick follows painted
// terrain. The stage owns the level offset; the caller owns terrain sampling, so
// the camera never learns what a landform is (deep boundary, narrow surface).
export type HeightSampler = (x: number, z: number) => number;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class IsoStage {
  pose: IsoPose;
  private sampleHeight: HeightSampler;

  constructor(initial?: Partial<IsoPose>, heightAt: HeightSampler = () => 0) {
    this.pose = { centerX: 0, centerZ: 0, yaw: ISO_YAW_START, zoom: 1, level: 0, ...initial };
    this.sampleHeight = heightAt;
  }

  // Swap the terrain sampler when the painted world changes, without rebuilding the
  // stage (which would drop the pose).
  setHeightSampler(heightAt: HeightSampler): void {
    this.sampleHeight = heightAt;
  }

  yawDegrees(): number {
    return this.pose.yaw;
  }

  levelElevation(): number {
    return this.pose.level * METERS_PER_LEVEL;
  }

  // {pos,target,fov} for <Scene3D.Camera>. The target rides the active level so
  // rotating and zooming keep the edited floor centred under the cursor.
  solve(): Solved {
    const dist = BASE_DIST / clamp(this.pose.zoom, MIN_ZOOM, MAX_ZOOM);
    const target: Vec3 = [this.pose.centerX, this.levelElevation(), this.pose.centerZ];
    return GAME_CAMERA.solve(GAME_CAMERA.rigs.Isometric, {
      target,
      yaw: this.yawDegrees(),
      dist,
      fov: ISO_FOV,
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
  // not just the four detents — the locked iso pitch keeps the dimetric look.
  rotateBy(deltaDegrees: number): void {
    this.pose.yaw += deltaDegrees;
  }

  zoomBy(factor: number): void {
    this.pose.zoom = clamp(this.pose.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  }

  // Zoom toward the cursor (map/Sims behaviour): keep the ground point under the
  // pointer fixed while the distance changes, instead of diving at the screen
  // centre. Unproject the cursor before and after the zoom and shift centre by the
  // difference — so "point at a building and roll in" brings THAT building closer.
  zoomToCursor(sx: number, sy: number, factor: number, rect: Rect): void {
    const before = GAME_CAMERA.unprojectGround(sx, sy, rect, this.solve(), this.levelHeightSampler());
    this.zoomBy(factor);
    const after = GAME_CAMERA.unprojectGround(sx, sy, rect, this.solve(), this.levelHeightSampler());
    this.pose.centerX += before.x - after.x;
    this.pose.centerZ += before.y - after.y;
  }

  // Metres the eye sits from the target at the current zoom — the pan loop scales
  // WASD speed by this so a keystroke crosses the same fraction of the view whether
  // you're surveying a district or detailing a wall.
  distance(): number {
    return BASE_DIST / clamp(this.pose.zoom, MIN_ZOOM, MAX_ZOOM);
  }

  // WASD/arrow pan: slide the centre across the GROUND along the view's own forward
  // and right axes (derived from the solved eye→target), so "up" always means "deeper
  // into the screen" regardless of which 90° facing you've rotated to. Units: metres.
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

  // "Grab the map" pan: unproject the cursor's previous and current screen points to
  // the active level, and shift the centre so the grabbed world point stays under
  // the cursor. Rig-agnostic and trig-free — it reuses unprojectGround, so it stays
  // exact through every rotation and zoom (no per-facing sign juggling).
  dragPan(prevX: number, prevY: number, curX: number, curY: number, rect: Rect): void {
    const cam = this.solve();
    const heightAt = this.levelHeightSampler();
    const a = GAME_CAMERA.unprojectGround(prevX, prevY, rect, cam, heightAt);
    const b = GAME_CAMERA.unprojectGround(curX, curY, rect, cam, heightAt);
    this.pose.centerX += a.x - b.x;
    this.pose.centerZ += a.y - b.y;
  }

  // Screen pixel -> world cell on the active level. Level 0 follows painted terrain;
  // higher floors pick a flat slab at levelElevation() so upper-storey edits land on
  // a plane, not on whatever roof happens to be under the cursor.
  pickCell(sx: number, sy: number, rect: Rect): CellPick {
    const g = GAME_CAMERA.unprojectGround(sx, sy, rect, this.solve(), this.levelHeightSampler());
    return { tx: Math.floor(g.x), tz: Math.floor(g.y), wx: g.x, wz: g.y };
  }

  // The cursor's world ray, in the PieceRay shape resolveSnapTarget/raycastPieces
  // consume — so the iso pane drives the SAME snap (grid/face/edge) the F2 crosshair
  // does, just from the pointer instead of screen centre. Converts the framework's
  // array-vec3 screenRay into the build model's {x,y,z} ray.
  pieceRay(sx: number, sy: number, rect: Rect): PieceRay {
    const r = GAME_CAMERA.screenRay(sx, sy, rect, this.solve());
    return {
      origin: { x: r.origin[0], y: r.origin[1], z: r.origin[2] },
      dir: { x: r.dir[0], y: r.dir[1], z: r.dir[2] },
    };
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
