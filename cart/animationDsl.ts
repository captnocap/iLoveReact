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

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, '_');
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const TARGET_ALIASES: Record<string, string> = {
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
};

function canonicalTarget(target: string): string {
  const t = norm(target);
  return TARGET_ALIASES[t] ?? t;
}

function parseAction(src: string): TimelineAction | null {
  const parts = src.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  const duration = Number(parts[0]);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return {
    duration,
    target: canonicalTarget(parts[1]),
    action: norm(parts[2]),
    args: parts.slice(3).map(norm),
  };
}

export function parseAnimationDsl(source: string): AnimationTimeline {
  const steps: TimelineStep[] = [];
  const text = source.trim();
  if (!text) return { steps, total: 0 };

  const groups = [...text.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
  const chunks = groups.length > 0 ? groups : text.split(/\s*\|\s*/);
  for (const chunk of chunks) {
    const actions = chunk.split(';').map(parseAction).filter((a): a is TimelineAction => !!a);
    if (actions.length === 0) continue;
    steps.push({
      duration: Math.max(...actions.map((a) => a.duration)),
      actions,
    });
  }

  const total = steps.reduce((sum, step) => sum + step.duration, 0);
  return {
    steps,
    total,
    error: steps.length === 0 ? 'no timeline actions parsed' : undefined,
  };
}

export function sampleAnimationTimeline(timeline: AnimationTimeline, seconds: number): SampledAction[] {
  if (timeline.total <= 0 || timeline.steps.length === 0) return [];
  const looping = isAnimationTimelineLooping(timeline);
  let t = looping
    ? seconds % timeline.total
    : Math.min(Math.max(0, seconds), Math.max(0, timeline.total - 0.000001));
  if (t < 0) t += timeline.total;

  for (const step of timeline.steps) {
    if (t > step.duration) {
      t -= step.duration;
      continue;
    }
    return step.actions.map((a) => {
      const phase = clamp01(t / a.duration);
      return {
        target: a.target,
        action: a.action,
        phase,
        weight: Math.sin(phase * Math.PI),
        args: a.args,
      };
    });
  }
  return [];
}

export function isAnimationTimelineLooping(timeline: AnimationTimeline): boolean {
  return timeline.steps.some((step) =>
    step.actions.some((a) => a.action.endsWith('_loop') || a.action === 'shake_in_air'),
  );
}
