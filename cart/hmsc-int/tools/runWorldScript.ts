// Headless seed-world auditor — runs the placement validator over the world AS
// AUTHORED IN CODE (state/gameState.ts createInitialGameState → createInitialWorld
// + seed props/seed mountains), with NO game window.
//
// Why the seed and not arbitrary `wv_*` commands: the command registry imports the
// renderer (render3d/buildingSkins.tsx = React), so it can't be bundled into a
// plain v8cli script. The seed builders and the validator are React-free, so this
// runner imports only those — and the seed IS how the world is actually authored
// (data literals in gameState.ts). Ad-hoc runtime placement is covered in-game by
// the wv_validate command + the auto-warn on wv_prop.
//
// Bundled by tools/esbuild directly (see scripts/hmsc-check) — NOT scripts/
// cart-bundle.js, which only wraps cart Apps. Output goes through __writeStderr
// (the cart shims console.log to its event ring, invisible in a terminal); exit
// code is non-zero when any ✗ placement error fires, so an agent loop can gate.

import type { GameState } from '../design';
import { createInitialGameState } from '../state/gameState';
import {
  propSubject,
  landformSubject,
  checkPlacement,
  formatPlacementIssues,
  type PlacementSubject,
} from '../world/placementCheck';

declare const __writeStderr: (s: string) => void;
declare const __exit: (code: number) => void;

function subjectsForAudit(state: GameState): PlacementSubject[] {
  return [
    ...state.world.props.map(propSubject),
    ...(state.world.landforms ?? []).map(landformSubject),
  ];
}

const state = createInitialGameState();
const subjects = subjectsForAudit(state);
const lines: string[] = [];
let errors = 0;
let flagged = 0;

for (const subject of subjects) {
  const issues = checkPlacement(state, subject);
  if (issues.length === 0) continue;
  flagged += 1;
  errors += issues.filter((issue) => issue.severity === 'error').length;
  lines.push(`${subject.id} (${subject.label}):`);
  for (const line of formatPlacementIssues(issues)) lines.push(`  ${line}`);
}

const verdict = errors > 0
  ? `FAIL — ${errors} error(s) across ${flagged}/${subjects.length} placed things`
  : flagged > 0
    ? `WARN — ${flagged}/${subjects.length} placed things flagged (no hard errors)`
    : `OK — all ${subjects.length} placed things look fine`;

__writeStderr([verdict, ...lines].join('\n') + '\n');
__exit(errors > 0 ? 1 : 0);
