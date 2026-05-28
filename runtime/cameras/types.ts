// @reactjit/cameras — shared types.
//
// A camera rig is a PURE solver: params -> Solved. `Solved` is the universal
// currency — exactly what <Scene3D.Camera> consumes and what unprojectGround
// inverts. Because picking depends only on Solved (never on the rig type), one
// generic unproject serves every rig, and a cart swaps rigs in one line.

export type Vec3 = [number, number, number];

export type Rect = { x: number; y: number; width: number; height: number };

// The resolved camera. Angles never appear here — a rig has already turned its
// (degrees-flavoured) params into an eye, a look point, and a field of view.
export type Solved = { pos: Vec3; target: Vec3; fov: number };

// A rig solver. No React, no host calls, no globals — just params -> Solved.
export type Rig<P> = (params: P) => Solved;

// A registry entry. Mirrors `GeometryDef` in @reactjit/geometries: a stable id
// (for tooling/debug), the pure solver, and a defaults base that callers spread
// over. `id` is not part of any cache key today, but keep it unique + stable.
export type CameraDef<P = any> = {
  id: string;
  solve: Rig<P>;
  defaults: P;
};

// A composable post-solve decorator (the swayCam analog): Solved -> Solved.
// Modifiers stack in order and must stay pure (time is passed in, not read).
export type Modifier = (s: Solved) => Solved;
