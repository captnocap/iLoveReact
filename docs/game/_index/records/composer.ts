import type { DocIndex } from '../types';

export const composer: DocIndex = {
  name: 'composer',
  file: 'composer.md',
  cart: 'cart/composer/',
  purpose: ['scripting', 'persistence', 'networking', 'ui', 'asset_pipeline', 'format'],
  loc: 4900,
  summary:
    'A code-driven music composition workspace in the EarSketch idiom where the user types flat-API JavaScript that is compiled via new Function into the audio sequencer and played, backed by a project-scoped sample library and the workspace persistence pattern.',
  interfaces: [
    {
      name: 'compileAndRun / compiler.ts',
      purpose: ['scripting', 'format'],
      kind: 'dsl',
      sourceFile: 'cart/composer/compiler.ts',
      codeRef: 'cart/composer/compiler.ts:46',
      description:
        'The compile sandbox: stops audio and clears tracks 0-15, pre-loads every library sample, builds the sandbox object (~23 API fns + 5 synth constants + project sample bindings), runs new Function(...keys, "use strict"; + text), then audio.play(); failure returns the error for the editor red gutter. Instruments scheduling wrappers into TimelineEvent[].',
      dependsOn: ['useAudio', 'SampleRef', 'validateSampleId', 'STATIC_SANDBOX_NAMES'],
      emits: ['TimelineEvent'],
      consumers: ['useComposerState'],
      status: 'live',
    },
    {
      name: 'STATIC_SANDBOX_NAMES',
      purpose: ['scripting'],
      kind: 'registry',
      sourceFile: 'cart/composer/compiler.ts',
      description:
        'The fixed sandbox surface (API fns + synth constants) exported as the single source of truth for the highlighter and validators; adding a sandbox fn touches one file.',
      consumers: ['highlight.ts', 'domain.ts'],
      status: 'live',
    },
    {
      name: 'useComposerState',
      purpose: ['persistence', 'scripting', 'ui'],
      kind: 'hook',
      sourceFile: 'cart/composer/state.ts',
      description:
        'The single source of truth (554 lines): wraps useWorkspace, audio, capture, library, sources, transport, and keyboard. Also exposes availableSources/searchSources/addSampleFromSource/setSourceToken (currently unconsumed).',
      dependsOn: ['useWorkspace', 'useAudio', 'useAudioInput', 'compileAndRun', 'sources/index'],
      status: 'live',
    },
    {
      name: 'ComposerPayload',
      purpose: ['persistence', 'format'],
      kind: 'data_model',
      sourceFile: 'cart/composer/domain.ts',
      description:
        'Persisted payload {source, tempo, samples[], inputDeviceName, masterVolume, uiPrefs}; only the source text persists, the compiled arrangement is transient (undo restores text; user re-Ctrl+S to hear it). buildPayload/applyPayload round-trip it through useWorkspace.',
      status: 'live',
    },
    {
      name: 'SampleRef',
      purpose: ['format', 'asset_pipeline'],
      kind: 'data_model',
      sourceFile: 'cart/composer/domain.ts',
      description:
        'One library entry {id, label, path, durationMs, source: imported|captured|fetched, capturedAt?, provenance?}; the id doubles as the code-facing global bound into the sandbox.',
      status: 'live',
    },
    {
      name: 'SampleProvenance',
      purpose: ['format', 'networking'],
      kind: 'data_model',
      sourceFile: 'cart/composer/domain.ts',
      description:
        'Attribution metadata (provider, license family/url, author, attribution flag) frozen onto a fetched SampleRef at import time — the only attribution record once the file is on disk.',
      status: 'live',
    },
    {
      name: 'validateSampleId / sanitizer',
      purpose: ['scripting', 'format'],
      kind: 'utility',
      sourceFile: 'cart/composer/domain.ts',
      description:
        'Sample-id sanitizer/validator including a JS reserved-word list: sample ids become new Function parameter names so they must be legal identifiers and must not collide with sandbox names.',
      consumers: ['compileAndRun'],
      status: 'live',
    },
    {
      name: 'highlight.ts',
      purpose: ['ui', 'format'],
      kind: 'utility',
      sourceFile: 'cart/composer/highlight.ts',
      description:
        'Hand-rolled single-line JS tokenizer producing the host TextEditor colorRows spans (keyword/builtin/synth/sample/string/number/comment/punct/text); re-tokenizes the whole source per edit, memoized on [source, sampleIds].',
      dependsOn: ['STATIC_SANDBOX_NAMES'],
      consumers: ['CodeEditor'],
      status: 'live',
    },
    {
      name: 'api-cheatsheet.ts',
      purpose: ['ui'],
      kind: 'registry',
      sourceFile: 'cart/composer/api-cheatsheet.ts',
      description:
        'Hand-maintained API reference data (API_CATEGORIES, findApiEntry) feeding both the docked CheatSheet rail and editor hover tooltips.',
      consumers: ['CheatSheet', 'CodeEditor'],
      status: 'live',
    },
    {
      name: 'TimelineEvent',
      purpose: ['ui', 'format'],
      kind: 'data_model',
      sourceFile: 'cart/composer/compiler.ts',
      description:
        '{kind: pattern|media|section, track, start, end, label} recorded by the sandbox instrumented scheduling wrappers; feeds the TimelineBar lanes as a capture of what the code scheduled while audio stays playback truth.',
      consumers: ['TimelineBar'],
      status: 'live',
    },
    {
      name: 'sources/ aggregator (SourceAdapter)',
      purpose: ['networking', 'asset_pipeline'],
      kind: 'module',
      sourceFile: 'cart/composer/sources/',
      description:
        'Provider-normalization layer: SourceAdapter = {search, getById, resolveDownload} factories with an injectable HttpGet, each mapping a provider API into NormalizedSample (tri-state-null metadata). freesound/internet_archive/jamendo working, fma stubbed unavailable. Built but no component consumes its state hooks.',
      dependsOn: ['license.ts', 'credentials.ts', 'importSampleAsWav'],
      status: 'dormant',
    },
    {
      name: 'importSampleAsWav',
      purpose: ['asset_pipeline', 'networking', 'format'],
      kind: 'utility',
      sourceFile: 'cart/composer/sources/index.ts',
      codeRef: 'cart/composer/sources/index.ts:127',
      description:
        'Import bridge: resolveDownload then stream to <dest>.src via the download hook, pass WAV through with mv or transcode others via ffmpeg -ar 44100 -c:a pcm_s16le, cleanup, and record provenance on the SampleRef.',
      dependsOn: ['download', 'run'],
      status: 'dormant',
    },
    {
      name: 'NormalizedSample',
      purpose: ['networking', 'format'],
      kind: 'data_model',
      sourceFile: 'cart/composer/sources/',
      description:
        'The provider-agnostic search-result schema all source adapters emit; uid = source:sourceId, with tri-state-null license/audio metadata where null means provider did not say.',
      status: 'dormant',
    },
    {
      name: 'license.ts (LicenseFamily)',
      purpose: ['networking', 'format'],
      kind: 'utility',
      sourceFile: 'cart/composer/sources/license.ts',
      description: 'Normalizes provider license strings to a LicenseFamily enum.',
      status: 'dormant',
    },
    {
      name: 'credentials.ts (CredentialStore)',
      purpose: ['networking', 'persistence'],
      kind: 'module',
      sourceFile: 'cart/composer/sources/credentials.ts',
      description:
        'Explicitly-temporary token stash in localstore (composer.sources.credentials namespace) behind a CredentialStore interface for later replacement.',
      status: 'dormant',
    },
    {
      name: 'session.ts (CART_NAME / SESSION_VERSION / path helpers)',
      purpose: ['persistence'],
      kind: 'module',
      sourceFile: 'cart/composer/session.ts',
      description:
        'CART_NAME/SESSION_VERSION plus path helpers bound to runtime/workspace (sessionsDirFor, sessionPathFor, lastPointerPath) and the sample sidecar paths.',
      status: 'live',
    },
    {
      name: 'useWorkspace',
      purpose: ['persistence'],
      kind: 'hook',
      sourceFile: 'runtime/workspace/',
      description:
        'The workspace pattern (second consumer after cutout): envelope + 600ms debounced autosave on deps change, restore-on-mount from sessions/_last.txt, full-envelope snapshot undo/redo, ctrl+z/y/shift+z. Persists via __fs_read/__fs_write/__fs_mkdir.',
      consumers: ['composer', 'cutout'],
      status: 'live',
    },
    {
      name: 'useAudio / AUDIO_SOUND',
      purpose: ['scripting'],
      kind: 'hook',
      sourceFile: 'runtime/audio/index.tsx',
      description:
        'Wraps the host audio engine legacy un-prefixed globals (host() => globalThis, line 168): transport, sequencer (makeBeat/makePattern/makeBeatSlice/insertMedia/fitMedia/insertMediaSection), loadSound, per-track/step controls, master volume. AUDIO_SOUND provides the kick/snare/hat/bass/lead synth constants.',
      consumers: ['compileAndRun', 'useComposerState'],
      status: 'live',
    },
    {
      name: 'useAudioInput',
      purpose: ['asset_pipeline'],
      kind: 'hook',
      sourceFile: 'runtime/hooks/useAudioInput.ts',
      description:
        "Capture (kind: 'raw'): live captureLevel meter, start(deviceId)/stop(path) writes WAV; device enumeration via __audio_input_devices_json/__audio_output_devices_json; backed by framework/audio_input (SDL3, raw 44.1kHz mono, 10-min cap).",
      consumers: ['useComposerState', 'LibraryRail'],
      status: 'live',
    },
    {
      name: 'fetch.ts (getAsync / download)',
      purpose: ['networking'],
      kind: 'hook',
      sourceFile: 'runtime/hooks/fetch.ts',
      description:
        'getAsync (request -> http:<reqId> ffi-bus reply) and download (streaming to disk with http-download-progress:<rid>/http-download-end:<rid> events).',
      consumers: ['importSampleAsWav'],
      status: 'live',
    },
    {
      name: 'TextEditor (paintText + colorRows)',
      purpose: ['ui'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      description:
        'Host-rendered syntax-coloring primitive: the cart supplies per-line arrays of {text, color} spans (colorRows) and the host paints them. The load-bearing editor surface for composer.',
      consumers: ['CodeEditor'],
      status: 'live',
    },
    {
      name: 'CodeEditor (hover-docs machinery)',
      purpose: ['ui'],
      kind: 'component',
      sourceFile: 'cart/composer/components/CodeEditor.tsx',
      description:
        'TextEditor wrapper plus hover-docs: captures rect via onLayout into a ref, polls getMouseX/getMouseY on a 60ms interval while hovered, maps pointer to (line,col) using lineHeight=fontSize+6 and an approximated 0.6xfontSize monospace char width, resolves the token to an ApiEntry or SampleRef, and drives a cursor-anchored Tooltip.',
      dependsOn: ['highlight.ts', 'api-cheatsheet.ts', 'Tooltip'],
      consumes: ['getMouseX', 'getMouseY'],
      status: 'live',
    },
    {
      name: 'useIFTTT (key bindings)',
      purpose: ['input', 'ui'],
      kind: 'hook',
      sourceFile: 'runtime/hooks/useIFTTT.ts',
      description:
        'Declarative key bindings: key:ctrl+s -> compile, key:? -> cheat sheet (global bus respects focus), key:escape closes CheatSheet. Undo/redo bindings come free from useWorkspace.',
      consumers: ['useComposerState'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'Workspace-cart pattern (envelope + autosave + snapshot undo)',
      purpose: ['persistence'],
      description:
        'Stateless view over an on-disk SessionEnvelope, 600ms debounced autosave, restore-on-mount, full-envelope snapshot undo with commit/commitCoalesced. Now a proven 2-consumer abstraction (cutout -> runtime/workspace -> composer).',
      examples: ['cutout', 'composer'],
      promoteTo: 'runtime/workspace',
      status: 'resolved',
    },
    {
      name: 'new Function(...bindingNames, body) user-scripting sandbox',
      purpose: ['scripting'],
      description:
        'Flat global API, identifier-validated bindings, instrument-the-wrappers-for-UI — the cart-side mini-DSL recipe for any surface where the user writes code that drives the engine.',
      examples: ['composer'],
      promoteTo: 'reusable scripting-sandbox helper',
      status: 'promote',
    },
    {
      name: 'Wrapper-instrumentation for visualization',
      purpose: ['ui', 'telemetry'],
      description:
        'Record scheduling intents at compile time (TimelineEvent) while the engine stays playback truth — a clean way to show what the code did without engine introspection.',
      examples: ['composer'],
      status: 'recurring',
    },
    {
      name: 'Provider-adapter + normalized schema + injectable transport + offline smoke',
      purpose: ['networking', 'asset_pipeline'],
      description:
        "The repo's most complete networking-integration template: per-provider adapters mapping to one schema, injectable HttpGet for offline fixtures, tri-state-null metadata honesty, provenance capture at import. Mirrors cart/cutout/backends.",
      examples: ['composer', 'cutout'],
      status: 'recurring',
    },
    {
      name: 'Binary-file boundary shell-out',
      purpose: ['asset_pipeline'],
      description:
        'Because the fs hooks are UTF-8-string-only, binary copy goes through execAsync(cp -- src dst) with a POSIX shellQuote helper. Third sighting (composer cp, pixel_icon_demo PNM trick).',
      examples: ['composer', 'pixel_icon_demo'],
      promoteTo: '__fs_write_bytes / __fs_copy host fn',
      status: 'promote',
    },
    {
      name: 'EarSketch-flat idiom (one-liner usable by a non-coder)',
      purpose: ['scripting'],
      description:
        'Every function and sound is a bare top-level name (setTempo(120); makeBeat(kick,0,1,...)), no objects, no imports; the cheat-sheet + hover-docs + library-id-highlighting triad makes it self-teaching.',
      examples: ['composer'],
      status: 'recurring',
    },
    {
      name: 'Device persisted by name, not id',
      purpose: ['persistence'],
      description:
        'SDL3 assigns device ids dynamically per boot; the mic is persisted by name and resolved against the current device list on restore, silently falling back to default (id 0) if unplugged.',
      examples: ['composer'],
      status: 'recurring',
    },
    {
      name: 'Built-ahead-of-UI inventory',
      purpose: ['maintenance'],
      description:
        'Subsystems wired but unsurfaced (online sources, durationMs measurement, credentials) read as wired when they are not — flag for the coherence pass.',
      examples: ['composer'],
      status: 'avoid',
    },
  ],
  hazards: [
    {
      name: 'Online-sources subsystem is dark-launched (no UI)',
      purpose: ['networking', 'maintenance'],
      description:
        'state.ts exposes availableSources/searchSources/addSampleFromSource/setSourceToken but grep finds zero references in components/. ~1000 adapter lines + bridge + credentials are wired to nothing pending a search UI.',
      evidence: ['composer.md: "no component consumes them — grep finds zero references in components/"', 'cart/composer/sources/'],
      severity: 'high',
    },
    {
      name: 'durationMs is never measured (always 0)',
      purpose: ['format', 'maintenance'],
      description:
        'SampleRef.durationMs is always 0; a comment says "measured lazily on first load" but that measurement is not found in code — the field reads populated but is not.',
      evidence: ['composer.md: "always 0; comment says measured lazily on first load — not found in code"'],
      fix: 'Implement lazy duration measurement or drop the field.',
      severity: 'medium',
    },
    {
      name: 'Compile sandbox is not a security boundary',
      purpose: ['scripting'],
      description:
        'new Function runs the user text with full cart privileges; it is a binding mechanism, not isolation. Do not treat it as a sandbox in the security sense.',
      evidence: ['composer.md: "Compile sandbox is not a security boundary"'],
      severity: 'medium',
    },
    {
      name: 'Editor hover math trusts a fixed char-width ratio',
      purpose: ['ui'],
      description:
        'Pointer->token mapping uses an approximated monospace char width of 0.6xfontSize (acknowledged off-by-one risk) and lineHeight=fontSize+6; no host text-measurement API is used, so hover targeting can drift.',
      evidence: ['composer.md: "approximated monospace char width (0.6 x fontSize — acknowledged off-by-one risk)"'],
      fix: 'Use a host text-measurement API instead of a fixed ratio.',
      severity: 'low',
    },
    {
      name: 'setEffect (EarSketch effects API) is absent',
      purpose: ['scripting'],
      description:
        'No audio effects API is surfaced; the EarSketch-idiom setEffect is not present, so cheat-sheet/code suggesting it would fail. Also no autocomplete, multi-file projects, MIDI, or waveform display.',
      evidence: ['composer.md: "setEffect of the EarSketch idiom is absent"'],
      severity: 'low',
    },
    {
      name: 'Credentials store is a placeholder by design',
      purpose: ['networking', 'persistence'],
      description:
        'credentials.ts is an explicitly-temporary localstore token stash behind a CredentialStore interface meant for later replacement; do not treat it as the final secret storage.',
      evidence: ['composer.md: "an explicitly-temporary token stash in localstore ... for later replacement"'],
      severity: 'low',
    },
  ],
};
