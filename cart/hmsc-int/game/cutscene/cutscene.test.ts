// cutscene.test.ts — P4 meaning-tests for the live scene format (V16).
//
// The behaviors pinned here ARE the ruling: one clock drives every track,
// every track evaluates as a pure function of t, and scrubbing backward and
// forward to T yields the identical state.

import {
  GAME_CUTSCENE,
  createClock,
  advanceClock,
  scrubClock,
  setClockPlaying,
  setClockRate,
  skipClock,
  clockDone,
  createCutscene,
  sampleCutscene,
} from './index';
import { GAME_CAMERA, CAMERA_RIGS } from '../camera';
import { GAME_PATHING } from '../pathing';
import { GAME_ANIMATION } from '../animation';
import { assert, assertClose, assertEqual, assertThrows, finish, test } from '../_testkit';

function assertSame(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  got      ${a}`);
}

// ── the shared scene fixture ─────────────────────────────────────────────────
//
// A 10-second scene exercising every track kind. The motion plans are built
// by the live system (GAME_PATHING.planMotion — identical JS schedule
// headless), exactly as an authored cutscene file would build them.

const WALK = { maxSpeed: 2, accel: 4, decel: 4 };
const PLAN_A = GAME_PATHING.planMotion([[0, 0], [8, 0]], { startTime: 1, profile: WALK });
const PLAN_B = GAME_PATHING.planMotion([[8, 0], [8, 6]], { startTime: 6, profile: WALK });
const WAVE_DSL = '[1, l_arm, wave]';
const WAVE_TIMELINE = GAME_ANIMATION.parse(WAVE_DSL);

const SCENE = createCutscene({
  id: 'meaning-test-scene',
  duration: 10,
  camera: [
    // authored OUT of order on purpose — createCutscene sorts
    { at: 4, rig: 'TopDown', params: (s: number) => ({ target: [s, 0, 0] }) },
    { at: 0, rig: 'Orbit', params: { yaw: 10 } },
  ],
  dialog: [
    { at: 1, duration: 2, speaker: 'vic', text: 'hello' },
    { at: 2, duration: 2, speaker: 'sal', text: 'overlap' },
  ],
  actors: [
    { actor: 'vic', motions: [PLAN_A, PLAN_B], animations: [{ at: 1, dsl: WAVE_DSL }] },
    { actor: 'sal' }, // a bare live instance: present, no motion, no actions
  ],
});

// ── THE ONE CLOCK ────────────────────────────────────────────────────────────

test('a fresh clock starts at t=0, playing, at the tuned default rate', () => {
  const clock = createClock(12);
  assertEqual(clock.t, 0, 'starts at zero');
  assertEqual(clock.playing, true, 'starts playing');
  assertEqual(clock.rate, GAME_CUTSCENE.tuning.defaultRate, 'starts at the default rate');
  assertEqual(clock.duration, 12, 'owns its bounds');
});

test('the clock fails loud on a non-positive or non-finite duration', () => {
  assertThrows(() => createClock(0), 'duration 0 must throw');
  assertThrows(() => createClock(-3), 'negative duration must throw');
  assertThrows(() => createClock(NaN), 'NaN duration must throw');
  assertThrows(() => createClock(Infinity), 'infinite duration must throw');
});

test('advancing accumulates dt × rate and clamps at both ends', () => {
  let clock = createClock(10);
  clock = advanceClock(clock, 3);
  assertClose(clock.t, 3, 1e-12, 'dt accumulates');
  clock = advanceClock(clock, 100);
  assertEqual(clock.t, 10, 'clamps at duration');
  clock = setClockRate(clock, -1);
  clock = advanceClock(clock, 4);
  assertClose(clock.t, 6, 1e-12, 'negative rate rewinds');
  clock = advanceClock(clock, 100);
  assertEqual(clock.t, 0, 'clamps at zero');
});

test('rate scales time: 2× covers the scene in half the wall time', () => {
  let fast = setClockRate(createClock(10), 2);
  let slow = createClock(10);
  for (let i = 0; i < 5; i++) fast = advanceClock(fast, 1);
  for (let i = 0; i < 10; i++) slow = advanceClock(slow, 1);
  assertEqual(fast.t, 10, '5 wall-seconds at 2× finish a 10s scene');
  assertEqual(slow.t, 10, '10 wall-seconds at 1× finish a 10s scene');
  const held = advanceClock(setClockRate(createClock(10), 0), 100);
  assertEqual(held.t, 0, 'rate 0 holds time still');
});

test('pause holds the one time and is the SAME reference (no-change citizenship)', () => {
  const paused = setClockPlaying(advanceClock(createClock(10), 4), false);
  const after = advanceClock(paused, 99);
  assert(after === paused, 'advancing a paused clock returns the same reference');
  assertEqual(after.t, 4, 'paused time holds');
  const resumed = setClockPlaying(paused, true);
  assertClose(advanceClock(resumed, 1).t, 5, 1e-12, 'resume continues from the held t');
});

test('scrub jumps the one time to T, clamped, even while paused', () => {
  const paused = setClockPlaying(createClock(10), false);
  assertEqual(scrubClock(paused, 7.5).t, 7.5, 'scrubbing works while paused');
  assertEqual(scrubClock(paused, -5).t, 0, 'scrub clamps below');
  assertEqual(scrubClock(paused, 50).t, 10, 'scrub clamps above');
  assertThrows(() => scrubClock(paused, NaN), 'NaN scrub must throw');
});

test('skip jumps to the end and the clock reports done there — and only there', () => {
  const clock = advanceClock(createClock(10), 3);
  assertEqual(clockDone(clock), false, 'mid-scene is not done');
  const skipped = skipClock(clock);
  assertEqual(skipped.t, 10, 'skip lands on duration');
  assertEqual(clockDone(skipped), true, 'the end is done');
  assertEqual(clockDone(scrubClock(skipped, 9.999)), false, 'scrubbing back un-dones');
});

test('determinism: stepped advance, one big advance, and scrub all land on the same t', () => {
  let stepped = createClock(10);
  for (let i = 0; i < 7; i++) stepped = advanceClock(stepped, 0.5);
  const jumped = advanceClock(createClock(10), 3.5);
  const scrubbed = scrubClock(createClock(10), 3.5);
  assertClose(stepped.t, 3.5, 1e-9, 'stepped lands on 3.5');
  assertEqual(jumped.t, 3.5, 'one advance lands on 3.5');
  assertEqual(scrubbed.t, 3.5, 'scrub lands on 3.5');
});

test('clock ops are pure: the input clock is never mutated', () => {
  const clock = createClock(10);
  const frozen = Object.freeze({ ...clock });
  advanceClock(frozen, 5);
  scrubClock(frozen, 7);
  setClockPlaying(frozen, false);
  setClockRate(frozen, 3);
  skipClock(frozen);
  assertEqual(frozen.t, 0, 'a frozen clock survives every op untouched');
});

// ── THE TRACKS ───────────────────────────────────────────────────────────────

test('createCutscene fails loud on every authoring bug — at build, not mid-scene', () => {
  const base = { id: 'bad', duration: 10, camera: [{ at: 0, rig: 'Orbit' }] };
  assertThrows(() => createCutscene({ ...base, camera: [] }), 'empty camera track must throw (V16: the camera IS the scene)');
  assertThrows(() => createCutscene({ ...base, camera: [{ at: 0, rig: 'DollyZoom9000' }] }), 'unknown rig must throw');
  assertThrows(() => createCutscene({ ...base, camera: [{ at: 11, rig: 'Orbit' }] }), 'cue past the clock must throw');
  assertThrows(() => createCutscene({ ...base, camera: [{ at: -1, rig: 'Orbit' }] }), 'negative cue must throw');
  assertThrows(() => createCutscene({ ...base, duration: 0 }), 'zero duration must throw');
  assertThrows(
    () => createCutscene({ ...base, actors: [{ actor: 'x' }, { actor: 'x' }] }),
    'two tracks for one actor must throw',
  );
  assertThrows(
    () => createCutscene({ ...base, actors: [{ actor: 'x', animations: [{ at: 0, dsl: '[nope]' }] }] }),
    'an unparseable DSL cue must throw',
  );
  assertThrows(
    () => createCutscene({ ...base, dialog: [{ at: 0, duration: 0, speaker: 's', text: 't' }] }),
    'a zero-duration dialog line must throw',
  );
});

test('camera: the last cue with at ≤ t holds the camera; the solve IS GAME_CAMERA.solve', () => {
  const early = sampleCutscene(SCENE, 2);
  assertEqual(early.camera.rig, 'Orbit', 'before 4s the Orbit cue holds');
  assertSame(early.camera.solved, GAME_CAMERA.solve(CAMERA_RIGS.Orbit, { yaw: 10 }), 'a static cue is the rig solve, verbatim');
  assertSame(sampleCutscene(SCENE, 3.9).camera.solved, early.camera.solved, 'a static cue is time-invariant');

  const boundary = sampleCutscene(SCENE, 4);
  assertEqual(boundary.camera.rig, 'TopDown', 'at exactly its at, the next cue takes the camera');
});

test('camera: params-as-pure-function receives CUE-LOCAL seconds (the moving shot)', () => {
  const atSix = sampleCutscene(SCENE, 6); // TopDown cue began at 4 → cue-local 2
  assertSame(atSix.camera.solved, GAME_CAMERA.solve(CAMERA_RIGS.TopDown, { target: [2, 0, 0] }), 'cue-local t=2 drives the params');
  assertClose(atSix.camera.solved.target[0], 2, 1e-12, 'the shot moved with the one clock');
});

test('camera: before the first cue’s at, the first cue already holds (a scene always has a camera)', () => {
  const lateStart = createCutscene({
    id: 'late-camera',
    duration: 10,
    camera: [{ at: 2, rig: 'TopDown', params: (s: number) => ({ target: [s, 0, 0] }) }],
  });
  const frame = sampleCutscene(lateStart, 0);
  assertEqual(frame.camera.rig, 'TopDown', 'the first cue holds before its at');
  assertSame(frame.camera.solved, GAME_CAMERA.solve(CAMERA_RIGS.TopDown, { target: [0, 0, 0] }), 'cue-local time clamps at 0 before the cue starts');
});

test('dialog: lines are active over [at, at+duration), phase runs 0→1, overlap stays overlap', () => {
  assertSame(sampleCutscene(SCENE, 0.5).dialog, [], 'no line before the first at');
  assertSame(
    sampleCutscene(SCENE, 1.5).dialog,
    [{ speaker: 'vic', text: 'hello', phase: 0.25 }],
    'one active line with its phase',
  );
  assertSame(
    sampleCutscene(SCENE, 2.5).dialog,
    [{ speaker: 'vic', text: 'hello', phase: 0.75 }, { speaker: 'sal', text: 'overlap', phase: 0.25 }],
    'overlapping chatter: BOTH lines, each at its own phase',
  );
  assertSame(
    sampleCutscene(SCENE, 3).dialog,
    [{ speaker: 'sal', text: 'overlap', phase: 0.5 }],
    'the interval is half-open: at at+duration the line is down',
  );
});

test('actor motion: the active plan’s closed-form sample IS GAME_PATHING.sampleMotion at the same t', () => {
  const vicAt = (t: number) => sampleCutscene(SCENE, t).actors[0];

  assertSame(vicAt(0).motion, GAME_PATHING.sampleMotion(PLAN_A, 0), 'before its t0 the first plan holds its start pose');
  assertClose(vicAt(0).motion!.x, 0, 1e-12, 'start pose is the path start');

  assertSame(vicAt(3).motion, GAME_PATHING.sampleMotion(PLAN_A, 3), 'mid-plan: the exact closed-form sample');
  assert(vicAt(3).motion!.x > 0, 'the walk moved');

  assertSame(vicAt(6).motion, GAME_PATHING.sampleMotion(PLAN_B, 6), 'at the second plan’s t0 it takes over');
  assertSame(vicAt(9.9).motion, GAME_PATHING.sampleMotion(PLAN_B, 9.9), 'past the last plan: its own done end-pose');
  assertClose(vicAt(9.9).motion!.x, 8, 1e-9, 'ends where the path ends (x)');
  assertClose(vicAt(9.9).motion!.z, 6, 1e-9, 'ends where the path ends (z)');
});

test('actor animation: actions at t ARE GAME_ANIMATION.sample at cue-local t; silence before the first cue', () => {
  const vicAt = (t: number) => sampleCutscene(SCENE, t).actors[0];
  assertSame(vicAt(0.5).actions, [], 'no actions before the first animation cue');
  assertSame(vicAt(1.25).actions, GAME_ANIMATION.sample(WAVE_TIMELINE, 0.25), 'mid-timeline: the DSL’s own sample');
  assertEqual(vicAt(1.25).actions[0].target, 'left_arm', 'the captured alias table applies');
  assertClose(vicAt(1.25).actions[0].phase, 0.25, 1e-12, 'phase rides the one clock');
  assertSame(vicAt(7).actions, GAME_ANIMATION.sample(WAVE_TIMELINE, 6), 'past a non-looping timeline: the DSL’s own end-pose hold');
});

test('a bare actor track is honest: present in the frame, no motion, no actions', () => {
  const sal = sampleCutscene(SCENE, 5).actors[1];
  assertEqual(sal.actor, 'sal', 'the live instance is in the frame');
  assertEqual(sal.motion, null, 'no motion plans → null pose (the consumer keeps the instance where it is)');
  assertSame(sal.actions, [], 'no animation cues → no actions');
});

test('the frame clamps to the clock bounds and reports done only at the end', () => {
  assertEqual(sampleCutscene(SCENE, -5).t, 0, 'sampling before the scene clamps to 0');
  const past = sampleCutscene(SCENE, 99);
  assertEqual(past.t, 10, 'sampling past the scene clamps to duration');
  assertEqual(past.done, true, 'the end reports done');
  assertEqual(sampleCutscene(SCENE, 9.999).done, false, 'mid-scene is not done');
  assertThrows(() => sampleCutscene(SCENE, NaN), 'NaN sample time must throw');
});

// ── SCRUBBING (the determinism the ruling says falls out free) ───────────────

test('scrub-to-time determinism: backward and forward to T yield the IDENTICAL frame', () => {
  const times: number[] = [];
  for (let t = 0; t <= 10 + 1e-9; t += 0.5) times.push(t);

  const forward = times.map((t) => JSON.stringify(sampleCutscene(SCENE, t)));
  const backward = [...times].reverse().map((t) => JSON.stringify(sampleCutscene(SCENE, t))).reverse();
  // a fixed jump-around order (what a scrubber actually does)
  const shuffled = [...times].sort((a, b) => ((a * 7919) % 13) - ((b * 7919) % 13));
  const byTime = new Map(shuffled.map((t) => [t, JSON.stringify(sampleCutscene(SCENE, t))]));

  for (let i = 0; i < times.length; i++) {
    assertEqual(backward[i], forward[i], `backward sweep diverged at t=${times[i]}`);
    assertEqual(byTime.get(times[i]), forward[i], `jump-around scrub diverged at t=${times[i]}`);
  }
});

test('sampling holds no state: repeated samples are identical and the scene is untouched', () => {
  const sceneBefore = JSON.stringify(SCENE);
  const first = JSON.stringify(sampleCutscene(SCENE, 6.25));
  for (let i = 0; i < 5; i++) {
    sampleCutscene(SCENE, (i * 7.3) % 10); // wander the clock
    assertEqual(JSON.stringify(sampleCutscene(SCENE, 6.25)), first, `resample ${i} diverged`);
  }
  assertEqual(JSON.stringify(SCENE), sceneBefore, 'sampling never mutates the scene');
});

test('played and scrubbed agree: stepping the clock to T samples the frame scrubbing to T sees', () => {
  let clock = createClock(SCENE.duration);
  while (clock.t < 6.25) clock = advanceClock(clock, 0.05);
  // float steps land NEAR 6.25 — scrub the last hair like a real transport bar would
  clock = scrubClock(clock, 6.25);
  const played = sampleCutscene(SCENE, clock.t);
  const scrubbed = sampleCutscene(SCENE, scrubClock(createClock(SCENE.duration), 6.25).t);
  assertSame(played, scrubbed, 'the path to T is irrelevant; only T matters');
});

test('FIDELITY SWEEP: every track equals its system’s own pure answer over the whole clock', () => {
  let cases = 0;
  for (let i = 0; i <= 200; i++) {
    const t = (i / 200) * SCENE.duration;
    const frame = sampleCutscene(SCENE, t);

    // the expected cue selection, re-derived from the authored fixture (independent spec)
    const camCue = t < 4
      ? { rig: 'Orbit', params: { yaw: 10 } }
      : { rig: 'TopDown', params: { target: [t - 4, 0, 0] } };
    assertSame(
      frame.camera,
      { rig: camCue.rig, solved: GAME_CAMERA.solve(CAMERA_RIGS[camCue.rig], camCue.params) },
      `camera diverged from GAME_CAMERA.solve at t=${t}`,
    );

    const plan = t < 6 ? PLAN_A : PLAN_B;
    assertSame(frame.actors[0].motion, GAME_PATHING.sampleMotion(plan, t), `motion diverged from sampleMotion at t=${t}`);

    const expectedActions = t < 1 ? [] : GAME_ANIMATION.sample(WAVE_TIMELINE, t - 1);
    assertSame(frame.actors[0].actions, expectedActions, `actions diverged from GAME_ANIMATION.sample at t=${t}`);

    const expectedDialog = [
      { at: 1, duration: 2, speaker: 'vic', text: 'hello' },
      { at: 2, duration: 2, speaker: 'sal', text: 'overlap' },
    ]
      .filter((line) => t >= line.at && t < line.at + line.duration)
      .map((line) => ({ speaker: line.speaker, text: line.text, phase: (t - line.at) / line.duration }));
    assertSame(frame.dialog, expectedDialog, `dialog diverged from the interval spec at t=${t}`);

    cases += 4;
  }
  assert(cases === 804, `the sweep ran all 804 cases (ran ${cases})`);
});

finish('game/cutscene');
