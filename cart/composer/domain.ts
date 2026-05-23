// domain.ts — canonical cross-cutting types for the composer cart.
//
// Mirrors cart/cutout/domain.ts's role: every other module imports its
// shared shapes from here so the in-memory and on-disk representations
// stay in sync.

/** One entry in the cart's sample library. The library is project-
 *  scoped — these refs are persisted in the session payload, the WAV
 *  binaries live alongside under `cart/composer/samples/<stem>/<id>.wav`.
 *
 *  `id` is what the user references in code. The compiler binds each
 *  loaded sample under its id so `makeBeat(kick_03, ...)` resolves to
 *  the loaded handle for the sample with id `kick_03`. */
export interface SampleRef {
  id: string;             // filename-safe identifier; what code references
  label: string;          // display name in the library UI
  path: string;           // repo-relative WAV path
  durationMs: number;     // measured at import; informational
  source: 'imported' | 'captured';
  capturedAt?: number;    // unix ms; set when source === 'captured'
}

/** Composer-cart-specific session payload. Wrapped in
 *  SessionEnvelope<ComposerPayload> for persistence. */
export interface ComposerPayload {
  /** The current editor text. Source of truth for what the user typed. */
  source: string;
  /** Default project tempo. Code can override via setTempo(); this is
   *  the value the cart restores on open before any compile has run. */
  tempo: number;
  /** Project sample library. Code-facing ids become global bindings in
   *  the compile sandbox. */
  samples: SampleRef[];
  /** Mic capture source — persisted by device NAME (not id) because
   *  SDL3 assigns ids dynamically at boot, so ids don't survive
   *  restarts. On restore, the cart looks up the current device list
   *  and resolves this name to whatever id it has now. null = use the
   *  SDL3 default recording device. */
  inputDeviceName: string | null;
  /** Master output volume (0..1). Applied via audio.setMasterVolume on
   *  restore and on every change. Defaults to 0.8 so a fresh project
   *  isn't immediately ear-splitting on first compile. */
  masterVolume: number;
  /** UI preferences that persist with the project. */
  uiPrefs: UiPrefs;
}

export const DEFAULT_MASTER_VOLUME = 0.8;

export interface UiPrefs {
  fontSize: number;
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  fontSize: 14,
};

/** Default starter source for a fresh project. Plays a basic 4/4 beat
 *  using built-in synths so the cart has audible output without
 *  requiring sample files. */
export const DEFAULT_SOURCE = `// Composer — Ctrl+S to compile and play. Z/Y to undo/redo.
//
// Pattern syntax: '0'..'9' = trigger nth sound, '-' = rest, '+' = sustain.
// Built-in synths: kick, snare, hat, bass, lead.

setTempo(120);

makeBeat(kick,  0, 1, '0---0---0---0---');
makeBeat(snare, 1, 1, '----0-------0---');
makeBeat(hat,   2, 1, '--0---0---0---0-');
`;

/** Identifier sanitizer: keep only [A-Za-z0-9_], collapse runs, prefix
 *  with `s_` if the result starts with a digit. Used to derive a sample
 *  id from a filename so the result is always a valid JS identifier. */
export function sanitizeSampleId(input: string): string {
  let s = input.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!s) s = 'sample';
  if (/^[0-9]/.test(s)) s = `s_${s}`;
  return s;
}

/** JS reserved words a `new Function(...)` body can't use as a parameter
 *  name. The composer compiles user text via `new Function(...keys, body)`
 *  so any binding id has to clear this list — otherwise the compile
 *  throws SyntaxError before the user's code runs. */
const JS_RESERVED_WORDS: ReadonlySet<string> = new Set([
  'break','case','catch','class','const','continue','debugger','default','delete',
  'do','else','enum','export','extends','false','finally','for','function','if',
  'implements','import','in','instanceof','interface','let','new','null','package',
  'private','protected','public','return','static','super','switch','this','throw',
  'true','try','typeof','var','void','while','with','yield','await','async',
  'arguments','eval',
]);

/** Validate a sample id against (a) JS identifier rules, (b) JS reserved
 *  words, (c) names already bound by the compile sandbox (built-in synths
 *  + API functions), and (d) ids already in the project library.
 *  `ownId` is the sample's current id when validating a rename — lets the
 *  caller keep the same id without tripping the "already in use" check. */
export function validateSampleId(
  id: string,
  reserved: ReadonlySet<string>,
  existing: ReadonlySet<string>,
  ownId?: string,
): string | null {
  if (!id) return 'name is empty';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) {
    return 'name must start with a letter or _ and contain only letters, digits, underscores';
  }
  if (JS_RESERVED_WORDS.has(id)) return `"${id}" is a JavaScript reserved word`;
  if (reserved.has(id)) return `"${id}" is a built-in name (synth or API function)`;
  if (existing.has(id) && id !== ownId) return `"${id}" is already used in this project`;
  return null;
}

/** Strip the directory portion and extension from a file path. */
export function basenameStem(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}
