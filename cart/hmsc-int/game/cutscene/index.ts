// game/cutscene/ — GAME_CUTSCENE: the live scene format (V16).
//
// A cutscene is a SIMPLE TYPESCRIPT FILE: what tile-space the camera occupies
// at what time, the dialog (head_lab talking faces), the movement of models
// (pathing + animation DSL) — ONE CLOCK drives all of it. Never baked: the
// scene evaluates live so the player's current state (clothes, model changes)
// shows. The composition is natively deterministic — motion plans are
// closed-form in t, DSL timelines sample at t, camera solves are pure — so
// scrubbing/pause/skip fall out free (V16, resolution #6 applied to scenes).
//
// V16 is a FORMAT RULING with no prior reference implementation; this file is
// exactly what the ruling describes and nothing more. The format adds ZERO
// behavior of its own beyond cue selection: every sampled value is the
// delegated system's own pure answer at the same t — GAME_CAMERA.solve,
// GAME_PATHING.sampleMotion, GAME_ANIMATION.sample. Faces/figures render
// consumer-side off the frame (V2-amended baked figures, driven live).
//
// THE ONE-CLOCK INVARIANT: `sampleCutscene(scene, t)` is the only evaluation
// entry and reads nothing but its arguments. No track owns a clock; no track
// keeps state between samples. Scrubbing backward and forward to T yields the
// identical frame.

import { GAME_CAMERA, CAMERA_RIGS } from '../camera';
import type { Modifier, Solved } from '../camera';
import { GAME_PATHING } from '../pathing';
import type { MotionPlan, MotionSample } from '../pathing';
import { GAME_ANIMATION } from '../animation';
import type { AnimationTimeline, SampledAction } from '../animation';

// ── P2: the format's constants are data ─────────────────────────────────────

export const CUTSCENE_TUNING = Object.freeze({
  /** playback rate a fresh clock starts at (1 = real time) */
  defaultRate: 1,
});

// ── THE ONE CLOCK ────────────────────────────────────────────────────────────
//
// A pure value. Advancing, scrubbing, pausing, and skipping all return a new
// clock (or the SAME reference when nothing changed — re-render citizenship).
// The clock owns its bounds: t is always within [0, duration].

export type CutsceneClock = {
  /** scene length in seconds — the clamp bounds */
  duration: number;
  /** the one time, seconds; every track samples at exactly this value */
  t: number;
  /** playback rate; advanceClock applies dt × rate (negative = reverse) */
  rate: number;
  playing: boolean;
};

function assertFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) throw new Error(`cutscene: ${what} must be finite, got ${value}`);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function createClock(durationSeconds: number, rate: number = CUTSCENE_TUNING.defaultRate): CutsceneClock {
  assertFinite(durationSeconds, 'clock duration');
  if (durationSeconds <= 0) throw new Error(`cutscene: clock duration must be > 0, got ${durationSeconds}`);
  assertFinite(rate, 'clock rate');
  return { duration: durationSeconds, t: 0, rate, playing: true };
}

/** dt seconds of wall time → t moves dt × rate, clamped. Paused clocks hold. */
export function advanceClock(clock: CutsceneClock, dtSeconds: number): CutsceneClock {
  assertFinite(dtSeconds, 'advance dt');
  if (!clock.playing) return clock;
  const t = clamp(clock.t + dtSeconds * clock.rate, 0, clock.duration);
  return t === clock.t ? clock : { ...clock, t };
}

/** Jump the one time to T (clamped). Works while paused — that's scrubbing. */
export function scrubClock(clock: CutsceneClock, t: number): CutsceneClock {
  assertFinite(t, 'scrub t');
  const clamped = clamp(t, 0, clock.duration);
  return clamped === clock.t ? clock : { ...clock, t: clamped };
}

export function setClockPlaying(clock: CutsceneClock, playing: boolean): CutsceneClock {
  return clock.playing === playing ? clock : { ...clock, playing };
}

export function setClockRate(clock: CutsceneClock, rate: number): CutsceneClock {
  assertFinite(rate, 'clock rate');
  return clock.rate === rate ? clock : { ...clock, rate };
}

/** Skip = jump straight to the end; the frame there reports done. */
export function skipClock(clock: CutsceneClock): CutsceneClock {
  return scrubClock(clock, clock.duration);
}

export function clockDone(clock: CutsceneClock): boolean {
  return clock.t >= clock.duration;
}

// ── THE TRACKS (the authored format) ─────────────────────────────────────────
//
// What the simple TypeScript file declares. Cues are sparse keyed events on
// the one clock; between cues nothing interpolates here — moving shots come
// from params-as-pure-function-of-t (camera), closed-form plans (motion), and
// the DSL's own phase math (animation). All times are scene-clock seconds.

export type CutsceneCameraCue = {
  /** scene time this cue takes the camera (last cue with at ≤ t holds it) */
  at: number;
  /** CAMERA_RIGS key — V3's registry; V16 retains the full cinematic breadth */
  rig: string;
  /** rig params: static, or a PURE function of cue-local seconds (moving shots) */
  params?: Record<string, unknown> | ((cueSeconds: number) => Record<string, unknown>);
  /** post-solve decorators (sway/shake) — must stay pure, time passed in */
  modifiers?: Modifier[];
};

export type CutsceneDialogCue = {
  at: number;
  /** seconds the line is up; active over [at, at + duration) */
  duration: number;
  /** actor id — the head_lab talking face; rendering is consumer-side */
  speaker: string;
  text: string;
};

/** An authored animation cue: from `at`, the DSL timeline samples at t − at.
 *  Non-looping timelines hold their end pose (the DSL's own clamp); looping
 *  timelines loop — both pure in t. */
export type CutsceneAnimationCue = {
  at: number;
  /** V6 animation DSL source — parsed once at createCutscene */
  dsl: string;
};

export type CutsceneActorTrack = {
  /** live instance id — a V2-amended baked figure, driven live (never the scene) */
  actor: string;
  /** closed-form motion plans (GAME_PATHING.planMotion output), each anchored at its own t0 */
  motions?: MotionPlan[];
  animations?: CutsceneAnimationCue[];
};

export type CutsceneDef = {
  id: string;
  /** scene length in seconds — the one clock's bounds */
  duration: number;
  /** required: a cutscene IS "what tile-space the camera occupies at what time" */
  camera: CutsceneCameraCue[];
  dialog?: CutsceneDialogCue[];
  actors?: CutsceneActorTrack[];
};

// The compiled scene: cues sorted, rigs resolved, DSL parsed — once, at build.
type CompiledAnimationCue = { at: number; timeline: AnimationTimeline };
type CompiledActorTrack = { actor: string; motions: MotionPlan[]; animations: CompiledAnimationCue[] };

export type Cutscene = {
  id: string;
  duration: number;
  camera: CutsceneCameraCue[];
  dialog: CutsceneDialogCue[];
  actors: CompiledActorTrack[];
};

function assertCueTime(at: number, duration: number, what: string): void {
  assertFinite(at, `${what} 'at'`);
  if (at < 0 || at > duration) {
    throw new Error(`cutscene: ${what} at ${at}s is outside the scene's [0, ${duration}]s clock`);
  }
}

/** Validate + compile the authored def. Fails loud at build time — an unknown
 *  rig or a bad DSL line is an authoring bug, not a mid-scene surprise. */
export function createCutscene(def: CutsceneDef): Cutscene {
  assertFinite(def.duration, 'scene duration');
  if (def.duration <= 0) throw new Error(`cutscene: scene duration must be > 0, got ${def.duration}`);
  if (!def.camera || def.camera.length === 0) {
    throw new Error(`cutscene '${def.id}': a cutscene declares what tile-space the camera occupies — the camera track cannot be empty (V16)`);
  }

  for (const cue of def.camera) {
    assertCueTime(cue.at, def.duration, `camera cue`);
    if (!(cue.rig in CAMERA_RIGS)) {
      throw new Error(`cutscene '${def.id}': unknown camera rig '${cue.rig}' (have: ${Object.keys(CAMERA_RIGS).join(', ')})`);
    }
  }
  const camera = [...def.camera].sort((a, b) => a.at - b.at);

  const dialog = [...(def.dialog ?? [])].sort((a, b) => a.at - b.at);
  for (const line of dialog) {
    assertCueTime(line.at, def.duration, `dialog line '${line.text}'`);
    assertFinite(line.duration, `dialog line '${line.text}' duration`);
    if (line.duration <= 0) throw new Error(`cutscene '${def.id}': dialog line '${line.text}' duration must be > 0`);
  }

  const seen = new Set<string>();
  const actors: CompiledActorTrack[] = (def.actors ?? []).map((track) => {
    if (seen.has(track.actor)) {
      throw new Error(`cutscene '${def.id}': actor '${track.actor}' has two tracks — one track per live instance`);
    }
    seen.add(track.actor);
    const animations: CompiledAnimationCue[] = (track.animations ?? []).map((cue) => {
      assertCueTime(cue.at, def.duration, `actor '${track.actor}' animation cue`);
      const timeline = GAME_ANIMATION.parse(cue.dsl);
      if (timeline.error) {
        throw new Error(`cutscene '${def.id}': actor '${track.actor}' animation at ${cue.at}s: ${timeline.error}`);
      }
      return { at: cue.at, timeline };
    });
    return {
      actor: track.actor,
      motions: [...(track.motions ?? [])].sort((a, b) => a.t0 - b.t0),
      animations: animations.sort((a, b) => a.at - b.at),
    };
  });

  return { id: def.id, duration: def.duration, camera, dialog, actors };
}

// ── SAMPLING (the one evaluation entry) ──────────────────────────────────────

export type CutsceneCameraFrame = { rig: string; solved: Solved };
export type CutsceneDialogLine = { speaker: string; text: string; /** 0..1 through the line */ phase: number };
export type CutsceneActorFrame = {
  actor: string;
  /** closed-form pose on the active plan; null when the track has no motion */
  motion: MotionSample | null;
  /** the DSL's sampled actions at t; [] before the first animation cue */
  actions: SampledAction[];
};
export type CutsceneFrame = {
  t: number;
  camera: CutsceneCameraFrame;
  /** every line active at t (overlapping chatter stays overlapping) */
  dialog: CutsceneDialogLine[];
  actors: CutsceneActorFrame[];
  done: boolean;
};

/** Last cue with at ≤ t; before the first cue's `at`, the first cue holds
 *  (a scene always has a camera; an actor simply hasn't started animating). */
function activeCue<C extends { at: number }>(cues: C[], t: number): C | null {
  if (cues.length === 0) return null;
  let active = cues[0];
  for (const cue of cues) {
    if (cue.at > t) break;
    active = cue;
  }
  return active;
}

function sampleCamera(scene: Cutscene, t: number): CutsceneCameraFrame {
  const cue = activeCue(scene.camera, t)!; // createCutscene guarantees ≥ 1
  const cueSeconds = Math.max(0, t - cue.at);
  const params = typeof cue.params === 'function' ? cue.params(cueSeconds) : cue.params ?? {};
  return { rig: cue.rig, solved: GAME_CAMERA.solve(CAMERA_RIGS[cue.rig], params, cue.modifiers ?? []) };
}

function sampleDialog(scene: Cutscene, t: number): CutsceneDialogLine[] {
  const lines: CutsceneDialogLine[] = [];
  for (const line of scene.dialog) {
    if (t < line.at || t >= line.at + line.duration) continue;
    lines.push({ speaker: line.speaker, text: line.text, phase: (t - line.at) / line.duration });
  }
  return lines;
}

function sampleActor(track: CompiledActorTrack, t: number): CutsceneActorFrame {
  let motion: MotionSample | null = null;
  if (track.motions.length > 0) {
    // last plan with t0 ≤ t; before the first plan, its start pose holds
    // (sampleMotion's own τ ≤ 0 / τ ≥ duration closed-form ends).
    const plan = activeCue(track.motions.map((m) => ({ at: m.t0, plan: m })), t)!.plan;
    motion = GAME_PATHING.sampleMotion(plan, t);
  }
  const animationCue = activeCue(track.animations, t);
  const actions = animationCue && animationCue.at <= t
    ? GAME_ANIMATION.sample(animationCue.timeline, t - animationCue.at)
    : [];
  return { actor: track.actor, motion, actions };
}

/** THE ONE CLOCK, applied: every track evaluates at exactly this t and
 *  nothing else. Pure — sampling reads only (scene, t), holds no state, and
 *  any two calls at the same t return the identical frame. */
export function sampleCutscene(scene: Cutscene, t: number): CutsceneFrame {
  assertFinite(t, 'sample t');
  const clamped = clamp(t, 0, scene.duration);
  return {
    t: clamped,
    camera: sampleCamera(scene, clamped),
    dialog: sampleDialog(scene, clamped),
    actors: scene.actors.map((track) => sampleActor(track, clamped)),
    done: clamped >= scene.duration,
  };
}

// ── THE DOOR (P3) — game/index.ts re-exports this as-is ─────────────────────

export const GAME_CUTSCENE = Object.freeze({
  tuning: CUTSCENE_TUNING,

  // the format
  create: createCutscene,
  sample: sampleCutscene,

  // the one clock
  createClock,
  advance: advanceClock,
  scrub: scrubClock,
  setPlaying: setClockPlaying,
  setRate: setClockRate,
  skip: skipClock,
  done: clockDone,
});
