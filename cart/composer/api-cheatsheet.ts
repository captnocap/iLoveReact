// api-cheatsheet.ts — reference data for the composer sandbox API.
//
// One ApiEntry per identifier the user can reference in code. Grouped
// into Categories so the cheat-sheet UI can render section headers.
// Each entry carries a one-line signature plus an expanded description
// + example shown on hover.
//
// The list is hand-maintained — kept tight enough that adding a new
// sandbox binding is one entry here. The compiler's STATIC_SANDBOX_NAMES
// is the authoritative runtime surface; this file is the human-facing
// view of it.

export type ApiKind = 'fn' | 'const' | 'note';

export interface ApiEntry {
  /** Identifier the user types. For 'note' entries, a short label (the
   *  pattern syntax mini-cheat doesn't bind a name). */
  name: string;
  /** Compact signature line, shown on the entry row. */
  signature: string;
  /** Free-form description, shown in the hover tooltip. */
  description: string;
  /** Realistic example, shown in the hover tooltip. */
  example: string;
  kind: ApiKind;
}

export interface ApiCategory {
  name: string;
  entries: ApiEntry[];
}

/** Flat lookup: identifier → entry. Built lazily so the static
 *  `API_CATEGORIES` table stays the single source of truth and adding
 *  a new entry there automatically makes it hoverable in the editor. */
let _byName: Map<string, ApiEntry> | null = null;
export function findApiEntry(name: string): ApiEntry | null {
  if (!_byName) {
    _byName = new Map();
    for (const cat of API_CATEGORIES) {
      for (const entry of cat.entries) {
        if (entry.kind !== 'note') _byName.set(entry.name, entry);
      }
    }
  }
  return _byName.get(name) ?? null;
}

export const API_CATEGORIES: ApiCategory[] = [
  {
    name: 'Transport',
    entries: [
      {
        kind: 'fn',
        name: 'setTempo',
        signature: 'setTempo(bpm, start?, endBpm?, end?)',
        description: 'Set project tempo at measure `start` (1-based, default 1). Pass `endBpm` + `end` to ramp linearly between two measures.',
        example: 'setTempo(120);\n// ramp 80 → 140 across measures 1..8\nsetTempo(80, 1, 140, 8);',
      },
      {
        kind: 'fn',
        name: 'play',
        signature: 'play()',
        description: 'Start or resume transport scheduling. Compile (Ctrl+S) calls this for you automatically.',
        example: 'play();',
      },
      {
        kind: 'fn',
        name: 'pause',
        signature: 'pause()',
        description: 'Pause transport without resetting the playhead.',
        example: 'pause();',
      },
      {
        kind: 'fn',
        name: 'stop',
        signature: 'stop()',
        description: 'Stop transport and reset the playhead to measure 1.',
        example: 'stop();',
      },
      {
        kind: 'fn',
        name: 'setPlayhead',
        signature: 'setPlayhead(measure)',
        description: 'Move the playhead to a 1-based measure.',
        example: 'setPlayhead(5);',
      },
    ],
  },
  {
    name: 'Patterns',
    entries: [
      {
        kind: 'fn',
        name: 'makeBeat',
        signature: "makeBeat(sound, track, start, pattern, steps = 16)",
        description: 'Place a beat pattern on a track starting at measure `start`. `pattern` is a string of step characters (see Pattern Syntax). `steps` is the number of steps per measure.',
        example: "makeBeat(kick, 0, 1, '0---0---0---0---');\nmakeBeat(snare, 1, 1, '----0-------0---');",
      },
      {
        kind: 'fn',
        name: 'makePattern',
        signature: 'makePattern(sound, track, start, pattern, steps = 16)',
        description: 'Alias for makeBeat using the cleaner `pattern` parameter name.',
        example: "makePattern(hat, 2, 1, '0-0-0-0-0-0-0-0-');",
      },
      {
        kind: 'fn',
        name: 'makeBeatSlice',
        signature: 'makeBeatSlice(sound, track, start, pattern, slices, steps = 16)',
        description: 'Like makeBeat, but each pattern character indexes into `slices` (an array of slice start positions). Lets one sound trigger from N different positions per step.',
        example: "makeBeatSlice(loop, 0, 1, '0123', [1, 1.25, 1.5, 1.75]);",
      },
    ],
  },
  {
    name: 'Media',
    entries: [
      {
        kind: 'fn',
        name: 'insertMedia',
        signature: 'insertMedia(sound, track, start)',
        description: 'Drop a whole sound onto a track at measure `start` — fires once at full length.',
        example: 'insertMedia(my_loop, 0, 1);',
      },
      {
        kind: 'fn',
        name: 'fitMedia',
        signature: 'fitMedia(sound, track, start, end)',
        description: 'Fit a sound to a measure span, repeating or truncating as needed.',
        example: 'fitMedia(my_pad, 1, 1, 8);  // pad runs from measure 1 through 8',
      },
      {
        kind: 'fn',
        name: 'insertMediaSection',
        signature: 'insertMediaSection(sound, track, start, sliceStart, sliceEnd)',
        description: 'Insert just a slice of a sound (from `sliceStart` to `sliceEnd` within the source).',
        example: 'insertMediaSection(my_loop, 0, 1, 1.5, 2.5);  // only seconds 1.5..2.5',
      },
    ],
  },
  {
    name: 'Samples',
    entries: [
      {
        kind: 'fn',
        name: 'loadSound',
        signature: 'loadSound(path) → handle',
        description: 'Load a WAV file as a sound handle usable by makeBeat / insertMedia. Returns an integer id. Usually you do not call this directly — library samples are auto-bound by id.',
        example: 'const mine = loadSound("./mine.wav");\nmakeBeat(mine, 0, 1, "0---");',
      },
      {
        kind: 'fn',
        name: 'createAudioSlice',
        signature: 'createAudioSlice(sound, start, end) → handle',
        description: 'Return a new sound handle representing the slice from `start` to `end` of the source.',
        example: 'const drop = createAudioSlice(my_loop, 1, 1.5);',
      },
      {
        kind: 'fn',
        name: 'createAudioStretch',
        signature: 'createAudioStretch(sound, factor) → handle',
        description: 'Return a new sound stretched by `factor` (>1 slower, <1 faster). Pitch is preserved if the host supports it.',
        example: 'const slow = createAudioStretch(my_loop, 2);  // half speed',
      },
      {
        kind: 'fn',
        name: 'dur',
        signature: 'dur(sound) → measures',
        description: 'Read a sound\'s duration in measures.',
        example: 'fitMedia(my_pad, 0, 1, 1 + dur(my_pad));',
      },
    ],
  },
  {
    name: 'Tracks',
    entries: [
      {
        kind: 'fn',
        name: 'setTrackVolume',
        signature: 'setTrackVolume(track, volume)',
        description: 'Set the track fader level. `volume` is 0..1.',
        example: 'setTrackVolume(0, 0.8);',
      },
      {
        kind: 'fn',
        name: 'setTrackPan',
        signature: 'setTrackPan(track, pan)',
        description: 'Set the track pan position. `pan` is -1 (full left) to +1 (full right).',
        example: 'setTrackPan(1, -0.3);',
      },
      {
        kind: 'fn',
        name: 'setTrackMute',
        signature: 'setTrackMute(track, muted)',
        description: 'Mute or unmute a track.',
        example: 'setTrackMute(2, true);',
      },
      {
        kind: 'fn',
        name: 'setTrackSolo',
        signature: 'setTrackSolo(track, soloed)',
        description: 'Solo a track. While any track is soloed, all unsoloed tracks are silent.',
        example: 'setTrackSolo(0, true);',
      },
    ],
  },
  {
    name: 'Per-step humanization',
    entries: [
      {
        kind: 'fn',
        name: 'setStepVelocity',
        signature: 'setStepVelocity(track, step, velocity)',
        description: 'Set per-step velocity (0..1) for the latest pattern on a track. `step` is 0-indexed.',
        example: 'makeBeat(kick, 0, 1, "0---0---0---0---");\nsetStepVelocity(0, 8, 0.5);  // softer hit on step 8',
      },
      {
        kind: 'fn',
        name: 'setStepProbability',
        signature: 'setStepProbability(track, step, p)',
        description: 'Trigger probability (0..1) per step. Defaults to 1 (always plays).',
        example: 'setStepProbability(2, 6, 0.5);  // hat step 6 plays half the time',
      },
      {
        kind: 'fn',
        name: 'setStepOffset',
        signature: 'setStepOffset(track, step, offset)',
        description: 'Micro-timing offset per step, in step-fractions (-0.5..+0.5). Negative = earlier.',
        example: 'setStepOffset(1, 4, 0.1);  // snare a touch late',
      },
    ],
  },
  {
    name: 'Master',
    entries: [
      {
        kind: 'fn',
        name: 'setMasterVolume',
        signature: 'setMasterVolume(v)',
        description: 'Master bus gain, 0..~1.5.',
        example: 'setMasterVolume(0.7);',
      },
    ],
  },
  {
    name: 'Built-in synths',
    entries: [
      { kind: 'const', name: 'kick',  signature: 'kick  = 0', description: 'Built-in kick drum synth.',  example: 'makeBeat(kick, 0, 1, "0---0---0---0---");' },
      { kind: 'const', name: 'snare', signature: 'snare = 1', description: 'Built-in snare synth.',      example: 'makeBeat(snare, 1, 1, "----0-------0---");' },
      { kind: 'const', name: 'hat',   signature: 'hat   = 2', description: 'Built-in hi-hat synth.',     example: 'makeBeat(hat, 2, 1, "--0---0---0---0-");' },
      { kind: 'const', name: 'bass',  signature: 'bass  = 3', description: 'Built-in bass synth.',       example: 'makeBeat(bass, 3, 1, "0-------0-------");' },
      { kind: 'const', name: 'lead',  signature: 'lead  = 4', description: 'Built-in lead synth.',       example: 'makeBeat(lead, 4, 1, "0---0---");' },
    ],
  },
  {
    name: 'Pattern syntax',
    entries: [
      {
        kind: 'note',
        name: "'0'..'9' / 'A'..'F'",
        signature: 'trigger Nth sound',
        description: 'A digit (or hex letter) in the pattern string triggers the Nth sound. With makeBeat(sound, ...) there is only one sound, so 0 is the only valid trigger. With makeBeat([a, b, c], ...) the digits 0/1/2 select among them.',
        example: "makeBeat([kick, snare], 0, 1, '0-1-0-1-');",
      },
      {
        kind: 'note',
        name: "'-'",
        signature: 'rest',
        description: 'A rest. The previous sound stops decaying naturally.',
        example: "makeBeat(kick, 0, 1, '0---0---');  // hits, then 3 steps of rest",
      },
      {
        kind: 'note',
        name: "'+'",
        signature: 'sustain',
        description: 'Sustain the previous trigger — keep the sound playing through this step without retriggering.',
        example: "makeBeat(bass, 3, 1, '0+++----');  // bass holds for 4 steps then rests",
      },
      {
        kind: 'note',
        name: 'steps per measure',
        signature: 'default 16',
        description: 'A 16-step pattern at 16 steps/measure = sixteenth notes. Pass a different number to use a different resolution.',
        example: "makeBeat(kick, 0, 1, '0-0-', 4);  // 4 steps/measure = quarter notes",
      },
    ],
  },
];
