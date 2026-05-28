// Cinematic — a DIRECTOR that cuts between SHOTS, not a looped dolly.
//
// A cinematic camera is the grammar of film: distinct framings of a subject —
// low hero angle, over-the-shoulder, hard profile, hip/waist level, worm's-eye,
// a wide establishing shot, a tight close-up — that you CUT between. Cuts are
// hard, the dwell is irregular, and the next shot isn't always chosen for a tidy
// reason. So the rig is: a list of `Shot`s (each a way to frame the subject) +
// a director that advances the active shot over time and hard-cuts to it.
//
// A Shot is data: `frame(subject) → Solved`, framed RELATIVE to the subject's
// position + facing (so "behind" / "side" track where the subject looks). Pass
// your own shots, or use the default SHOTS film-grammar set. The director cuts
// every `dwell` seconds, sequentially or shuffled.
//
// KNOWN GAP (flagged): true dutch/canted angles need camera ROLL, which the
// current Scene3D camera can't express (m4lookAt hardcodes up = +Y). Shots vary
// position/angle/fov richly; roll is a separate, additive framework change —
// extend Solved with an optional `up`/`roll` and thread it into m4lookAt.

import type { CameraDef, Solved, Vec3 } from '../types';
import { DEG } from '../_util';

export type Subject = { pos: Vec3; facing: number }; // facing in degrees
export type Shot = {
  id: string;
  frame: (s: Subject) => Solved;
};

// subject-relative basis: fwd is where the subject faces, right is 90° CW of it.
function basis(facingDeg: number) {
  const f = facingDeg * DEG;
  const fwd: Vec3 = [Math.sin(f), 0, Math.cos(f)];
  const right: Vec3 = [Math.cos(f), 0, -Math.sin(f)];
  return { fwd, right };
}

// Place an eye at subject + a·fwd + b·right + c·up, looking at subject + lookY·up
// (plus an optional along-facing look lead). The workhorse every shot composes.
function shot(
  id: string,
  a: number, b: number, c: number,
  lookY: number, fov: number,
  lookLead = 0,
): Shot {
  return {
    id,
    frame: (s) => {
      const { fwd, right } = basis(s.facing);
      const [px, py, pz] = s.pos;
      const pos: Vec3 = [
        px + fwd[0] * a + right[0] * b,
        py + c,
        pz + fwd[2] * a + right[2] * b,
      ];
      const target: Vec3 = [px + fwd[0] * lookLead, py + lookY, pz + fwd[2] * lookLead];
      return { pos, target, fov };
    },
  };
}

// The default film-grammar set. `a` > 0 sits in FRONT of the subject (sees the
// face); a < 0 sits behind (sees the back). Units ≈ metres; subject ≈ 2 tall.
export const SHOTS: Shot[] = [
  shot('wide', 9, 1.5, 5.5, 1.0, 42), // establishing — far, high, whole scene
  shot('heroLow', 3.2, 0.6, 0.5, 1.7, 52), // low, looking up — makes them tower
  shot('closeUp', 1.7, 0.3, 1.72, 1.78, 32), // tight on the head, long lens
  shot('overShoulder', -2.2, 0.8, 1.85, 1.2, 58, 4), // behind, looking past them
  shot('profile', 0.2, 5.0, 1.3, 1.1, 46), // hard side-on
  shot('highAngle', 4.0, -1.0, 6.5, 0.8, 44), // above, looking down — vulnerable
  shot('hip', 2.6, 1.4, 0.7, 1.0, 50), // waist level, off-centre, candid
  shot('wormsEye', 2.0, -0.4, 0.14, 1.5, 62), // ground, looking steeply up
];

export type CinematicParams = {
  subject: Subject;
  shots: Shot[];
  t: number; // clock seconds — the director's time base
  dwell: number; // seconds held per shot before the cut
  order: 'sequence' | 'shuffle';
  seed: number;
};

export const CINEMATIC_DEFAULTS: CinematicParams = {
  subject: { pos: [0, 0, 0], facing: 0 },
  shots: SHOTS,
  t: 0,
  dwell: 2.6,
  order: 'shuffle',
  seed: 7,
};

// Deterministic shot index for step `n`, avoiding a back-to-back repeat (a cut
// to the same framing reads as a hitch, not a cut). Pure: recomputes n-1.
function pickIndex(n: number, len: number, seed: number): number {
  if (len <= 1) return 0;
  const hash = (m: number) => ((m * 1103515245 + 12345 + seed) >>> 0) % len;
  let i = hash(n);
  if (i === hash(n - 1)) i = (i + 1) % len;
  return i;
}

function solve(p: CinematicParams): Solved {
  const shots = p.shots;
  if (!shots || shots.length === 0) return { pos: [0, 5, 10], target: [0, 1, 0], fov: 50 };

  const dwell = Math.max(0.2, p.dwell);
  const n = Math.floor(p.t / dwell);
  const idx = p.order === 'shuffle' ? pickIndex(n, shots.length, p.seed) : n % shots.length;
  const s = shots[idx].frame(p.subject);

  // A touch of life within the held shot: a slow ~5% push-in toward the look
  // point (a locked-off shot reads as a freeze-frame). Hard cut on the boundary.
  const local = p.t / dwell - n; // 0..1 through the current shot
  const frac = local * 0.05;
  const pos: Vec3 = [
    s.pos[0] + (s.target[0] - s.pos[0]) * frac,
    s.pos[1] + (s.target[1] - s.pos[1]) * frac,
    s.pos[2] + (s.target[2] - s.pos[2]) * frac,
  ];
  return { pos, target: s.target, fov: s.fov * (1 - frac * 0.25) };
}

export const Cinematic: CameraDef<CinematicParams> = {
  id: 'Cinematic', solve, defaults: CINEMATIC_DEFAULTS,
};
