// @reactjit/cameras — the pure spine: resolve a rig + params (+ modifiers) to
// a Solved. Lives apart from index.tsx so React-free consumers (game logic,
// headless verify runs, tooling) can solve cameras without dragging JSX in;
// index.tsx re-exports it, so cart imports are unchanged.

import type { CameraDef, Modifier, Solved } from './types';

// Pure: spread params over the rig's defaults, solve, then fold the modifier
// stack in order. Carts call this directly to get the Solved they feed to
// unprojectGround for picking — the SAME value the matching <*Camera> renders.
export function solveCamera(rig: CameraDef, params: any = {}, modifiers: Modifier[] = []): Solved {
  let s = rig.solve({ ...rig.defaults, ...params });
  for (const m of modifiers) s = m(s);
  return s;
}
