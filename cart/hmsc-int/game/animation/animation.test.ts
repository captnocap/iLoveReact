// animation.test.ts - P4 behavior tests for the V6 animation action layer.
//
// These assert what a DSL program MEANS: sequencing, parallel composition,
// aliasing, loop rules, and the single built-in easing envelope.

import {
  ANIMATION_DSL_TUNING,
  ANIMATION_TARGET_ALIASES,
  GAME_ANIMATION,
  canonicalAnimationTarget,
  isAnimationTimelineLooping,
  normalizeAnimationToken,
  parseAnimationAction,
  parseAnimationDsl,
  sampleAnimationTimeline,
  sinusoidalAnimationWeight,
} from './index';
import { assert, assertClose, assertEqual, finish, test } from '../_testkit';

const EPS = 1e-12;

function only(source: string, seconds: number) {
  const sampled = sampleAnimationTimeline(parseAnimationDsl(source), seconds);
  assertEqual(sampled.length, 1, `${source} should produce one sampled action`);
  return sampled[0];
}

test('the parser understands bracket groups as sequential steps with parallel actions inside each group', () => {
  const timeline = parseAnimationDsl(
    '[0.5, right arm, lift-and-bend, Fast; 1.25, l_fist, clench], [2, head_face, talk]',
  );
  assertEqual(timeline.steps.length, 2, 'two bracket groups become two steps');
  assertEqual(timeline.total, 3.25, 'total is sum of max step durations');
  assertEqual(timeline.steps[0].duration, 1.25, 'parallel step lasts for its longest action');
  assertEqual(timeline.steps[0].actions.length, 2, 'semicolon means parallel action composition');
  assertEqual(timeline.steps[0].actions[0].target, 'right_arm', 'right arm canonicalized');
  assertEqual(timeline.steps[0].actions[0].action, 'lift_and_bend', 'action token normalized');
  assertEqual(timeline.steps[0].actions[0].args.join(','), 'fast', 'args normalized');
  assertEqual(timeline.steps[0].actions[1].target, 'left_fist', 'l_fist alias canonicalized');
  assertEqual(timeline.steps[1].actions[0].target, 'face', 'head_face alias canonicalized');
});

test('without brackets, pipe separates sequential steps and semicolon keeps actions parallel', () => {
  const timeline = parseAnimationDsl('1, arm, raise; 2, leg, step | 3, wheel, spin_loop');
  assertEqual(timeline.steps.length, 2, 'pipe fallback makes sequential chunks');
  assertEqual(timeline.steps[0].duration, 2, 'first step lasts for the leg action');
  assertEqual(timeline.steps[1].duration, 3, 'second step duration');
  assertEqual(timeline.total, 5, 'total sums both steps');
  assertEqual(timeline.steps[0].actions[0].target, 'both_arms', 'arm alias canonicalized');
  assertEqual(timeline.steps[0].actions[1].target, 'both_legs', 'leg alias canonicalized');
  assertEqual(timeline.steps[1].actions[0].target, 'wheels', 'wheel alias canonicalized');
});

test('invalid action segments are skipped; an all-invalid non-empty program reports the reference error', () => {
  const mixed = parseAnimationDsl('[0, arm, raise; nope; 1, unknown target, Wave]');
  assertEqual(mixed.steps.length, 1, 'valid action survives invalid neighbors');
  assertEqual(mixed.steps[0].actions.length, 1, 'only one valid action');
  assertEqual(mixed.steps[0].actions[0].target, 'unknown_target', 'unknown targets pass through normalized');
  assertEqual(mixed.error, undefined, 'some valid action means no error');

  const empty = parseAnimationDsl('[0, arm, raise] | nope');
  assertEqual(empty.steps.length, 0, 'no valid steps');
  assertEqual(empty.total, 0, 'no valid total');
  assertEqual(empty.error, ANIMATION_DSL_TUNING.emptyTimelineError, 'no-action error string');
  assertEqual(parseAnimationDsl('').error, undefined, 'blank input is an empty timeline, not an error');
});

test('sampling returns only the active step, with instant transitions and no cross-step blending', () => {
  const first = sampleAnimationTimeline(parseAnimationDsl('[1, arm, raise], [1, head, nod]'), 1);
  assertEqual(first.length, 1, 'one active action at the boundary');
  assertEqual(first[0].target, 'both_arms', 'the exact step boundary still belongs to the previous step');
  assertClose(first[0].phase, 1, EPS, 'boundary phase is complete');
  assertClose(first[0].weight, 0, 1e-12, 'sinusoidal envelope returns to zero at completion');

  const next = sampleAnimationTimeline(parseAnimationDsl('[1, arm, raise], [1, head, nod]'), 1.000001);
  assertEqual(next.length, 1, 'still only one active step after boundary');
  assertEqual(next[0].target, 'head', 'after the boundary the next step takes over instantly');
});

test('parallel actions share a step clock but each action computes phase from its own duration', () => {
  const sampled = sampleAnimationTimeline(parseAnimationDsl('[1, arm, raise; 2, leg, step]'), 0.5);
  assertEqual(sampled.length, 2, 'both parallel actions sampled');
  assertEqual(sampled[0].target, 'both_arms', 'first target');
  assertClose(sampled[0].phase, 0.5, EPS, 'short action halfway');
  assertClose(sampled[0].weight, 1, EPS, 'short action at peak weight');
  assertEqual(sampled[1].target, 'both_legs', 'second target');
  assertClose(sampled[1].phase, 0.25, EPS, 'long action one quarter through');
  assertClose(sampled[1].weight, Math.sin(0.25 * Math.PI), EPS, 'long action uses same envelope');
});

test('non-looping timelines clamp before the end; looping timelines modulo time including negative time', () => {
  const clamped = only('2, arm, raise', 99);
  assertClose(clamped.phase, (2 - ANIMATION_DSL_TUNING.nonLoopEndClampOffsetSeconds) / 2, EPS,
    'non-looping sample clamps to total minus the ruled epsilon');

  const looped = only('2, wheel, spin_loop', 5);
  assertClose(looped.phase, 0.5, EPS, '5s modulo a 2s loop lands at 1s');
  const negative = only('2, wheel, spin_loop', -0.5);
  assertClose(negative.phase, 0.75, EPS, 'negative loop time wraps forward');
});

test('looping is an action-name rule: suffix _loop or exact shake_in_air loops the whole timeline', () => {
  assert(isAnimationTimelineLooping(parseAnimationDsl('1, wheel, spin_loop')), '_loop suffix loops');
  assert(isAnimationTimelineLooping(parseAnimationDsl('1, body, shake_in_air')), 'shake_in_air loops');
  assert(isAnimationTimelineLooping(parseAnimationDsl('[1, arm, raise], [1, head, shake_in_air]')),
    'one looping action loops the whole timeline');
  assert(!isAnimationTimelineLooping(parseAnimationDsl('1, arm, loop_spin')), 'loop inside the name is not enough');
});

test('the target alias table carries every reference alias and unknowns are not rejected', () => {
  const expected: Record<string, string> = {
    arm: 'both_arms', arms: 'both_arms', both_arm: 'both_arms', l_arm: 'left_arm', r_arm: 'right_arm',
    hand: 'both_hands', hands: 'both_hands', both_hand: 'both_hands', l_hand: 'left_hand', r_hand: 'right_hand',
    wrist: 'both_wrists', wrists: 'both_wrists', both_wrist: 'both_wrists', l_wrist: 'left_wrist', r_wrist: 'right_wrist',
    fist: 'both_fists', fists: 'both_fists', both_fist: 'both_fists', l_fist: 'left_fist', r_fist: 'right_fist',
    finger: 'both_fingers', fingers: 'both_fingers', both_finger: 'both_fingers', l_finger: 'left_finger', r_finger: 'right_finger',
    leg: 'both_legs', legs: 'both_legs', both_leg: 'both_legs', l_leg: 'left_leg', r_leg: 'right_leg',
    foot: 'both_feet', feet: 'both_feet', both_foot: 'both_feet', l_foot: 'left_foot', r_foot: 'right_foot',
    head_face: 'face', face_target: 'face', grab_face: 'face_grab',
    car: 'vehicle', auto: 'vehicle', body_shell: 'vehicle',
    front_wheel: 'front_wheels', rear_wheel: 'rear_wheels',
    tire: 'wheels', tires: 'wheels', wheel: 'wheels',
    steering: 'front_wheels', shocks: 'suspension', shock: 'suspension',
  };

  assertEqual(Object.keys(ANIMATION_TARGET_ALIASES).length, Object.keys(expected).length, 'alias table size');
  for (const [alias, canonical] of Object.entries(expected)) {
    assertEqual(canonicalAnimationTarget(alias), canonical, `${alias} canonical target`);
  }
  assertEqual(canonicalAnimationTarget('Left-Elbow'), 'left_elbow', 'unknown target passes through normalized');
});

test('verbs are open vocabulary: the DSL normalizes any action token and args, not a fixed enum', () => {
  const action = parseAnimationAction('1.5, mouth, Chew-Hard, Apple Chunk, LEFT side');
  assert(action != null, 'open action parsed');
  assertEqual(action.action, 'chew_hard', 'action normalized');
  assertEqual(action.args.join('|'), 'apple_chunk|left_side', 'args normalized');
});

test('the one built-in easing curve is the sinusoidal envelope', () => {
  assertClose(sinusoidalAnimationWeight(0), 0, EPS, 'start');
  assertClose(sinusoidalAnimationWeight(0.25), Math.SQRT1_2, EPS, 'quarter');
  assertClose(sinusoidalAnimationWeight(0.5), 1, EPS, 'middle');
  assertClose(sinusoidalAnimationWeight(0.75), Math.SQRT1_2, EPS, 'three-quarter');
  assertClose(sinusoidalAnimationWeight(1), 0, 1e-12, 'end');
});

test('GAME_ANIMATION is the sealed door carrying the parser, sampler, tables, and no capture-pending status', () => {
  assert(Object.isFrozen(GAME_ANIMATION), 'door is sealed');
  assertEqual(typeof GAME_ANIMATION.parse, 'function', 'parse behind the door');
  assertEqual(typeof GAME_ANIMATION.sample, 'function', 'sample behind the door');
  assertEqual(typeof GAME_ANIMATION.canonicalTarget, 'function', 'target canonicalizer behind the door');
  assertEqual(GAME_ANIMATION.tuning, ANIMATION_DSL_TUNING, 'timing and easing rules are data');
  assertEqual(GAME_ANIMATION.targetAliases, ANIMATION_TARGET_ALIASES, 'alias table is data');
  assertEqual(GAME_ANIMATION.normalizeToken('Two Words'), normalizeAnimationToken('Two Words'), 'normalize exported');
  assert(!('status' in GAME_ANIMATION), 'capture is live, not pending');
});

finish('game/animation');
