// The shared humanoid gait. One pose model drives every humanoid in HMSC — the
// player and every NPC — so a walk cycle looks the same on all of them and there
// is one place to tune it. Ported from the drive-mode gait in animation_lab and
// previously inlined in PlayerFigure. `drivePose` is idle when standing and a
// walk/run cycle when moving; `animationSeconds` is the per-figure clock so each
// NPC can be at its own phase.

export type HumanoidPose = {
  rootPitch: number;
  bodyY: number;
  torsoLean: number;
  headNod: number;
  leftLeg: number;
  rightLeg: number;
  leftKnee: number;
  rightKnee: number;
  leftArm: number;
  rightArm: number;
  armLift: number;
};

export function drivePose(animationSeconds: number, moving: boolean, running: boolean): HumanoidPose {
  if (!moving) {
    return {
      rootPitch: 0,
      bodyY: 0,
      torsoLean: 0,
      headNod: 0,
      leftLeg: 0,
      rightLeg: 0,
      leftKnee: 5,
      rightKnee: 5,
      leftArm: 4,
      rightArm: -4,
      armLift: 0,
    };
  }

  const phase = animationSeconds * (running ? 8.6 : 5.0);
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const legAmp = running ? 52 : 30;
  const armAmp = running ? 60 : 34;
  const kneeBase = running ? 14 : 8;
  return {
    rootPitch: 0,
    bodyY: Math.abs(c) * (running ? 0.085 : 0.035),
    torsoLean: running ? -9 : -3,
    headNod: -Math.abs(c) * (running ? 5 : 2),
    leftLeg: s * legAmp,
    rightLeg: -s * legAmp,
    leftKnee: kneeBase + Math.max(0, -s) * (running ? 42 : 24),
    rightKnee: kneeBase + Math.max(0, s) * (running ? 42 : 24),
    leftArm: -s * armAmp,
    rightArm: s * armAmp,
    armLift: running ? 9 : 2,
  };
}
