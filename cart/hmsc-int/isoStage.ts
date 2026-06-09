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

import { GAME_CAMERA, type Rect, type Solved, type Vec3 } from './game';
import { HMSC_SCALE } from '../hmsc/world/scale';

const FACING_COUNT = 4;        // 90° rotate detents, Sims-style (Q/E)
const ISO_YAW_BASE = 45;       // true-iso looks at tile CORNERS, not faces
const ISO_FOV = 22;            // narrow → flattens perspective toward orthographic
const BASE_DIST = 90;          // metres from target at zoom 1 (a chunk is 120m)
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 4;

// One floor level == one storey == one F2 build-mode wall. This is NOT a number we
// pick: it IS the build catalog's WALL_SIZE.heightMeters, which is the storey module
// (HMSC_SCALE.storyHeightMeters). Sourcing it here keeps the iso pane's floors in
// lockstep with the pieces the build mode stacks — a wall placed on floor 2 and an
// object dropped on floor 2 sit at the same height because they read one constant.
export const METERS_PER_LEVEL = HMSC_SCALE.storyHeightMeters;

export type Facing = 0 | 1 | 2 | 3;

export interface IsoPose {
  centerX: number; // world tile the view orbits over (pan), in tiles
  centerZ: number;
  facing: Facing;  // 90° yaw detent
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
    this.pose = { centerX: 0, centerZ: 0, facing: 0, zoom: 1, level: 0, ...initial };
    this.sampleHeight = heightAt;
  }

  // Swap the terrain sampler when the painted world changes, without rebuilding the
  // stage (which would drop the pose).
  setHeightSampler(heightAt: HeightSampler): void {
    this.sampleHeight = heightAt;
  }

  yawDegrees(): number {
    return ISO_YAW_BASE + this.pose.facing * 90;
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

  // Rotate the whole view in 90° steps (see behind walls), wrapping 0..3.
  rotate(dir: 1 | -1): void {
    this.pose.facing = (((this.pose.facing + dir) % FACING_COUNT) + FACING_COUNT) % FACING_COUNT as Facing;
  }

  zoomBy(factor: number): void {
    this.pose.zoom = clamp(this.pose.zoom * factor, MIN_ZOOM, MAX_ZOOM);
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
