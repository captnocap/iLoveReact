// game/animation - GAME_ANIMATION: the V6 action layer.
//
// Captured fresh from the ruled DSL semantics. The bracket string is an import
// format only; consumers should traffic in the parsed action timeline. The
// later RLE/relational storage can grow behind this same surface without
// changing what a program means.

export type TimelineAction = {
  duration: number;
  target: string;
  action: string;
  args: string[];
};

export type TimelineStep = {
  duration: number;
  actions: TimelineAction[];
};

export type AnimationTimeline = {
  steps: TimelineStep[];
  total: number;
  error?: string;
};

export type SampledAction = {
  target: string;
  action: string;
  phase: number;
  weight: number;
  args: string[];
};

export const ANIMATION_DSL_TUNING = Object.freeze({
  emptyTimelineError: 'no timeline actions parsed',
  nonLoopEndClampOffsetSeconds: 0.000001,
  parallelActionSeparator: ';',
  actionFieldSeparator: ',',
  sequenceSeparator: /\s*\|\s*/,
  bracketGroup: /\[([^\]]+)\]/g,
  normalizeTokenPattern: /[\s-]+/g,
  normalizeTokenReplacement: '_',
  loopingActionSuffix: '_loop',
  loopingActionNames: ['shake_in_air'] as const,
  weightCurve: 'sinusoidal' as const,
});

export const ANIMATION_TARGET_ALIASES = Object.freeze({
  arm: 'both_arms',
  arms: 'both_arms',
  both_arm: 'both_arms',
  l_arm: 'left_arm',
  r_arm: 'right_arm',
  hand: 'both_hands',
  hands: 'both_hands',
  both_hand: 'both_hands',
  l_hand: 'left_hand',
  r_hand: 'right_hand',
  wrist: 'both_wrists',
  wrists: 'both_wrists',
  both_wrist: 'both_wrists',
  l_wrist: 'left_wrist',
  r_wrist: 'right_wrist',
  fist: 'both_fists',
  fists: 'both_fists',
  both_fist: 'both_fists',
  l_fist: 'left_fist',
  r_fist: 'right_fist',
  finger: 'both_fingers',
  fingers: 'both_fingers',
  both_finger: 'both_fingers',
  l_finger: 'left_finger',
  r_finger: 'right_finger',
  leg: 'both_legs',
  legs: 'both_legs',
  both_leg: 'both_legs',
  l_leg: 'left_leg',
  r_leg: 'right_leg',
  foot: 'both_feet',
  feet: 'both_feet',
  both_foot: 'both_feet',
  l_foot: 'left_foot',
  r_foot: 'right_foot',
  head_face: 'face',
  face_target: 'face',
  grab_face: 'face_grab',
  car: 'vehicle',
  auto: 'vehicle',
  body_shell: 'vehicle',
  front_wheel: 'front_wheels',
  rear_wheel: 'rear_wheels',
  tire: 'wheels',
  tires: 'wheels',
  wheel: 'wheels',
  steering: 'front_wheels',
  shocks: 'suspension',
  shock: 'suspension',
} as const);

type TargetAlias = keyof typeof ANIMATION_TARGET_ALIASES;

export function normalizeAnimationToken(source: string): string {
  return source
    .trim()
    .toLowerCase()
    .replace(ANIMATION_DSL_TUNING.normalizeTokenPattern, ANIMATION_DSL_TUNING.normalizeTokenReplacement);
}

export function canonicalAnimationTarget(target: string): string {
  const normalized = normalizeAnimationToken(target);
  return ANIMATION_TARGET_ALIASES[normalized as TargetAlias] ?? normalized;
}

export function parseAnimationAction(source: string): TimelineAction | null {
  const parts = source
    .split(ANIMATION_DSL_TUNING.actionFieldSeparator)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) return null;

  const duration = Number(parts[0]);
  if (!Number.isFinite(duration) || duration <= 0) return null;

  return {
    duration,
    target: canonicalAnimationTarget(parts[1]),
    action: normalizeAnimationToken(parts[2]),
    args: parts.slice(3).map(normalizeAnimationToken),
  };
}

export function parseAnimationDsl(source: string): AnimationTimeline {
  const steps: TimelineStep[] = [];
  const text = source.trim();
  if (!text) return { steps, total: 0 };

  const groups = [...text.matchAll(ANIMATION_DSL_TUNING.bracketGroup)].map((match) => match[1]);
  const chunks = groups.length > 0 ? groups : text.split(ANIMATION_DSL_TUNING.sequenceSeparator);
  for (const chunk of chunks) {
    const actions = chunk
      .split(ANIMATION_DSL_TUNING.parallelActionSeparator)
      .map(parseAnimationAction)
      .filter((action): action is TimelineAction => action != null);
    if (actions.length === 0) continue;

    steps.push({
      duration: Math.max(...actions.map((action) => action.duration)),
      actions,
    });
  }

  const total = steps.reduce((sum, step) => sum + step.duration, 0);
  return {
    steps,
    total,
    error: steps.length === 0 ? ANIMATION_DSL_TUNING.emptyTimelineError : undefined,
  };
}

export function sinusoidalAnimationWeight(phase: number): number {
  return Math.sin(phase * Math.PI);
}

export function isAnimationTimelineLooping(timeline: AnimationTimeline): boolean {
  return timeline.steps.some((step) =>
    step.actions.some((action) =>
      action.action.endsWith(ANIMATION_DSL_TUNING.loopingActionSuffix) ||
      ANIMATION_DSL_TUNING.loopingActionNames.includes(action.action as any),
    ),
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

export function sampleAnimationTimeline(timeline: AnimationTimeline, seconds: number): SampledAction[] {
  if (timeline.total <= 0 || timeline.steps.length === 0) return [];

  const looping = isAnimationTimelineLooping(timeline);
  let t = looping
    ? seconds % timeline.total
    : clamp(seconds, 0, Math.max(0, timeline.total - ANIMATION_DSL_TUNING.nonLoopEndClampOffsetSeconds));
  if (t < 0) t += timeline.total;

  for (const step of timeline.steps) {
    if (t > step.duration) {
      t -= step.duration;
      continue;
    }

    return step.actions.map((action) => {
      const phase = clamp01(t / action.duration);
      return {
        target: action.target,
        action: action.action,
        phase,
        weight: sinusoidalAnimationWeight(phase),
        args: action.args,
      };
    });
  }

  return [];
}

export const GAME_ANIMATION = Object.freeze({
  tuning: ANIMATION_DSL_TUNING,
  targetAliases: ANIMATION_TARGET_ALIASES,
  normalizeToken: normalizeAnimationToken,
  canonicalTarget: canonicalAnimationTarget,
  parseAction: parseAnimationAction,
  parse: parseAnimationDsl,
  sample: sampleAnimationTimeline,
  isLooping: isAnimationTimelineLooping,
  weight: sinusoidalAnimationWeight,
});
