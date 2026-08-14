// editor/home/homeContent.ts — the Home surface's writing and its celebration
// rule (req_4435).
//
// Pure data + pure functions on purpose: the surface picks a line, it does not
// invent one, and the milestone rule is testable without a GPU.
//
// House style for the lines below: they are jokes about THIS work — meshes,
// shaders, undo, autosave, the build. Nothing motivational, nothing that reads
// like onboarding copy, nothing that congratulates the user for opening an
// application. The resume board above them is operational; these two lines are
// the only place the app is allowed to have a personality.

export type Quote = { text: string; who: string };

export const QUOTES: readonly Quote[] = [
  { text: 'A designer knows he has achieved perfection not when there is nothing left to add, but when there is nothing left to take away.', who: 'Antoine de Saint-Exupéry' },
  { text: 'Perfection is finally attained not when there is no longer anything to add, but when there is no longer anything to take away.', who: 'Antoine de Saint-Exupéry' },
  { text: 'Simplicity is the ultimate sophistication.', who: 'Leonardo da Vinci' },
  { text: 'Any sufficiently advanced bug is indistinguishable from a feature.', who: 'Rich Kulawiec' },
  { text: 'The most disastrous thing that you can ever learn is your first programming language.', who: 'Alan Kay' },
  { text: 'Premature optimization is the root of all evil.', who: 'Donald Knuth' },
  { text: 'Art is never finished, only abandoned.', who: 'Leonardo da Vinci' },
  { text: 'Make it work, make it right, make it fast.', who: 'Kent Beck' },
  { text: 'The function of good software is to make the complex appear simple.', who: 'Grady Booch' },
  { text: 'You can only fight the way you practice.', who: 'Miyamoto Musashi' },
  { text: 'Everything should be made as simple as possible, but not simpler.', who: 'Albert Einstein' },
  { text: 'Talk is cheap. Show me the code.', who: 'Linus Torvalds' },
];

export const JOKES: readonly string[] = [
  'A vertex walks into a bar. The bartender says "we do not serve your kind." The vertex says "that is fine, I am just passing through."',
  'My mesh is watertight. My deadline is not.',
  'I told the normals to face outward. Half of them identify as inward.',
  'Every quad wants to be a triangle when it grows up. Do not let it.',
  'The undo stack is the only part of this app that remembers what I actually wanted.',
  'Shader compiles first try. Something is deeply wrong.',
  'I named it final_v2_real_ACTUAL. The manifest named it untitled. The manifest won.',
  'UV unwrapping is just origami with extra steps and worse outcomes.',
  'There are two hard problems in 3D: naming things, off-by-one errors, and winding order.',
  'The fastest renderer is the one that draws nothing. Ship it.',
  'I did not lose the model. I stored it somewhere so safe that even I cannot get in.',
  'Ambient occlusion: the art of making everything slightly dirtier and calling it realism.',
  'My physics engine has a great sense of humour. Everything it touches falls flat.',
  'They said do not hardcode the magic number. So I made it a constant called MAGIC_NUMBER.',
  'Gimbal lock is just your rotation having an existential crisis at 90 degrees.',
  'The autosave fired. Somewhere, a version of this file is happier than this one.',
  'I optimised the hot loop. Now the cold loop is the hot loop. This is the circle of life.',
  'A texture atlas is a filing cabinet where every drawer is also the cabinet.',
  'Boolean operations: 20 percent geometry, 80 percent grief.',
  'The bug was not in the shader. The bug is never in the shader. The bug was in the shader.',
  'Backface culling removed the backfaces. And, mysteriously, the front ones.',
  'Every frame is a fresh start. Sixty fresh starts a second. No pressure.',
  'I gave the bone a name. Now it has opinions about where the elbow goes.',
  'Two kinds of maps: the one you painted, and the one that loads.',
];

/** Pick deterministically from a list. Same n, same line — so the boot frame is
 *  stable through a hot reload and only changes when the user rerolls or the
 *  launch count does. */
export function pick<T>(items: readonly T[], n: number): T {
  const count = items.length;
  const index = ((Math.trunc(n) % count) + count) % count;
  return items[index]!;
}

export type Celebration = {
  /** Shown on the banner. Empty means no celebration. */
  label: string;
  /** 0..1 — how much confetti. Bigger milestones throw more. */
  intensity: number;
};

/** Launch numbers that earn a burst. Round numbers, getting rarer, plus the
 *  very first one — the only launch that will ever be somebody's first. */
const MILESTONES: readonly number[] = [1, 10, 25, 50, 100, 250, 500, 1000];

/** Every hundredth launch keeps celebrating after the table runs out. */
const RECURRING_MILESTONE = 100;

/** How often an ordinary launch throws confetti anyway, so the surface stays
 *  capable of surprising you. 1 in this many. */
export const SURPRISE_ODDS = 14;

/**
 * Does this launch deserve a party?
 *
 * `roll` is a 0..1 sample the caller supplies (its own randomness — this stays
 * pure so the milestone table can be tested exactly).
 */
export function celebrationFor(launch: number, roll: number): Celebration | null {
  const n = Math.trunc(launch);
  if (n <= 0) return null;
  if (n === 1) return { label: 'first light — launch #1', intensity: 0.7 };
  if (MILESTONES.includes(n)) {
    // 1000 throws everything; 10 throws a polite handful.
    const rank = MILESTONES.indexOf(n) / (MILESTONES.length - 1);
    return { label: `launch #${n}`, intensity: 0.45 + rank * 0.55 };
  }
  if (n % RECURRING_MILESTONE === 0) return { label: `launch #${n}`, intensity: 1 };
  if (roll < 1 / SURPRISE_ODDS) return { label: `launch #${n} — no reason`, intensity: 0.4 };
  return null;
}

/** "2 minutes ago" / "3 days ago" — the resume board's age column. Absolute
 *  dates are for the map list; a resume card is about recency. */
export function relativeAge(thenMs: number, nowMs: number): string {
  if (thenMs <= 0) return 'never';
  const seconds = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/** Absolute stamp for the map list — "when was this map last touched". */
export function absoluteStamp(ms: number): string {
  if (ms <= 0) return 'never';
  const when = new Date(ms);
  return when.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: when.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** One line describing what Continue will actually restore. Says only what the
 *  session record really carries — a resume card that overpromises is worse
 *  than no resume card. */
export function resumeSummary(tabs: number, floorIndex: number, hasCamera: boolean): string {
  const parts = [`${tabs} tab${tabs === 1 ? '' : 's'}`];
  parts.push(floorIndex === 0 ? 'ground floor' : `floor ${floorIndex}`);
  if (hasCamera) parts.push('camera');
  return parts.join(' · ');
}
