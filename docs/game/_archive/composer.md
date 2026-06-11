# composer cart inventory

Source cart: `cart/composer/` (12 modules + 6 components + 11 source-adapter files, ~4900 lines)

Reviewed: 2026-06-04

## High-level purpose

`composer` is a code-driven music composition workspace in the **EarSketch idiom**: the user types JavaScript in a syntax-highlighted editor, hits Ctrl+S, and the text is compiled into the framework's audio sequencer and played. The API is deliberately global-flat (`setTempo(120); makeBeat(kick, 0, 1, '0---0---…')`) — every function and sound is a bare top-level name, no objects, no imports. A project-scoped **sample library** (imported WAVs, mic/system-audio captures, and — plumbing-complete, UI-pending — samples fetched from online providers) binds each sample's id as a global inside the compile sandbox, so `makeBeat(LoudKick01, …)` just works.

It is the second full **workspace cart** (after `cart/cutout`, whose 7-file shape it explicitly mirrors): stateless view over an on-disk `SessionEnvelope`, autosaved, with snapshot undo/redo, sessions under `cart/composer/sessions/`, and binary sidecars under `cart/composer/samples/<stem>/`.

## Files touched by this behavior

Cart modules:
- `index.tsx` — thin shell: `TooltipRoot` → TopBar / (LibraryRail | CodeEditor+TimelineBar | CheatSheet) / StatusBar. All state from one hook.
- `domain.ts` — canonical types (`SampleRef`, `SampleProvenance`, `ComposerPayload`, `UiPrefs`), `DEFAULT_SOURCE`, id sanitizer/validator (incl. a JS reserved-word list — sample ids become `new Function` parameter names, so they must be legal identifiers).
- `session.ts` — `CART_NAME`/`SESSION_VERSION` + path helpers bound to `runtime/workspace` (`sessionsDirFor`, `sessionPathFor`, `lastPointerPath`) and the sample sidecar paths.
- `compiler.ts` — the sandbox: text → `new Function(...sandboxKeys, '"use strict";' + text)` → invoke → `audio.play()`. Also instruments scheduling calls into `TimelineEvent[]` for the timeline UI.
- `state.ts` (554 lines) — `useComposerState()`, the single source of truth; wraps `useWorkspace`, audio, capture, library, sources, transport, keyboard.
- `highlight.ts` — hand-rolled single-line JS tokenizer → the host TextEditor's `colorRows` spans (keyword/builtin/synth/sample/string/number/comment/punct/text).
- `api-cheatsheet.ts` — hand-maintained API reference data (`API_CATEGORIES`, `findApiEntry`) feeding both the docked CheatSheet rail and editor hover tooltips.
- `theme.ts` — colors + sizes.
- `components/` — `TopBar` (transport, project name, compile/undo, tooltips on every button), `LibraryRail` (samples + capture + device picker), `CodeEditor`, `TimelineBar`, `StatusBar`, `CheatSheet`.
- `sources/` — the online-sample aggregator (see its own section).
- On disk: `sessions/<stem>.session.json` + `sessions/_last.txt` (autosave + last-project pointer), `samples/<stem>/<id>.wav`.

Runtime/framework dependencies:
- `runtime/workspace/` (`useWorkspace`, envelope, history, paths) — autosave (600ms debounce on `deps` change), restore-on-mount, **full-envelope snapshot undo/redo**, ctrl+z/y/shift+z bindings. Persistence via `__fs_read`/`__fs_write`/`__fs_mkdir`.
- `runtime/audio/index.tsx` (`useAudio`, `AUDIO_SOUND`) — wraps the host audio engine's un-prefixed legacy globals (`host(): any => globalThis`, line 168): transport (play/pause/stop/playhead/tempo), sequencer (`makeBeat`/`makePattern`/`makeBeatSlice`/`insertMedia`/`fitMedia`/`insertMediaSection`), sample loading (`loadSound`), per-track volume/pan/mute/solo, per-step velocity/probability/offset, master volume.
- `runtime/hooks/useAudioInput.ts` (`kind: 'raw'`) — capture; `__audio_input_devices_json` / `__audio_output_devices_json` device enumeration; backed by `framework/audio_input` (SDL3, raw 44.1kHz mono, 10-min cap, WAV written on `stop(path)`).
- `runtime/hooks/fetch.ts` — `getAsync` (request → `http:<reqId>` ffi-bus reply) and `download` (streaming to disk with `http-download-progress:<rid>` / `http-download-end:<rid>` events).
- `runtime/hooks/localstore.ts` — `nsGet/nsSet/nsDelete` → `__store_get/set/remove` (provider tokens).
- `runtime/hooks/process.ts` — `execAsync` (zenity pickers, `cp`), `run` (ffmpeg, mv).
- `runtime/hooks/useIFTTT.ts` — declarative key bindings (`key:ctrl+s`, `key:?`, `key:escape`).
- `runtime/hooks/clipboard.ts` — CheatSheet copy button.
- `runtime/tooltip/Tooltip.tsx` — `TooltipRoot` + `Tooltip` incl. cursor-anchored variant.
- `runtime/primitives.tsx` — notably **`TextEditor` with `paintText` + `colorRows`** (host-rendered syntax coloring) and `TextInput` (rename, project name).

## The compile sandbox (the core idea)

`compileAndRun(text, {audio, samples})` (`compiler.ts:46`):

1. `audio.stop()` + clear tracks 0–15 — every compile starts from silence (idempotent recompiles, no layering).
2. Pre-load every library sample via `audio.loadSound(path)` → `{id → handle}`; failures are deliberately silent (the user gets a clearer `ReferenceError` on the missing id).
3. Build the sandbox object: ~23 API functions + 5 synth constants (`kick/snare/hat/bass/lead` from `AUDIO_SOUND`) + the project sample bindings spread in last.
4. `new Function(...Object.keys(sandbox), '"use strict";\n' + text)` invoked with the values — the EarSketch-flat binding mechanism. **This is why sample ids are validated as JS identifiers against reserved words and sandbox names** (`domain.ts:validateSampleId`): an illegal parameter name would SyntaxError the compile before user code runs.
5. Success → `audio.play()`, return `{ok, bindings, events}`; failure → return the error message for the editor's red gutter bar, audio stays silent.

**Timeline instrumentation**: the scheduling wrappers (`makeBeat`, `fitMedia`, etc.) `record()` a `TimelineEvent {kind: pattern|media|section, track, start, end, label}` before delegating to audio. The TimelineBar renders these as labeled lane bars over a measure ruler — a *capture of what the code scheduled*, while "audio remains the source of truth for playback." `soundLabels` reverse-maps handles/synth constants to display names.

`STATIC_SANDBOX_NAMES` exports the fixed surface for the highlighter and validators — single source of truth; adding a sandbox fn touches one file.

## Persistence model (workspace pattern, second consumer)

`ComposerPayload` = `{source, tempo, samples[], inputDeviceName, masterVolume, uiPrefs}` — note **only the source text persists; the compiled arrangement is transient** (undo restores text; user re-Ctrl+S's to hear it). `buildPayload`/`applyPayload` round-trip it through `useWorkspace`, which autosaves 600ms after any dep change and restores from `sessions/_last.txt` on mount.

History discipline: `commit()` before discrete undoable mutations (sample add/remove/rename, compile, device change); `commitCoalesced()` for streams (typing — 250ms window — tempo, font size, volume drags) so undo lands on stroke boundaries, not keystrokes. Same recipe as cutout.

Device persistence subtlety: the mic is persisted **by name, not id** — SDL3 assigns ids dynamically per boot; restore resolves the name against the current device list, silently falling back to default (id 0) if unplugged.

Binary boundary again: WAV import copies via `execAsync('cp -- <src> <dst>')` with a POSIX `shellQuote` helper, **because the fs hooks are UTF-8-string-only** — same constraint that shaped pixel_icon_demo's PNM trick; third sighting, same workaround family (shell out for bytes).

## Sample library + capture

`SampleRef = {id, label, path, durationMs, source: imported|captured|fetched, capturedAt?, provenance?}`.

- **Import**: zenity file pick → sanitize filename to a code-safe id (de-duped against library + sandbox names with `_2` suffixes) → zenity entry prompt to confirm/rename (validated) → `cp` into `samples/<stem>/<id>.wav` → commit + append ref.
- **Capture**: `useAudioInput.start(deviceId)` → live `captureLevel` meter → `stop(path)` writes the WAV; id is `captured_<base36 timestamp>`; ref carries `capturedAt`; status notes the 10-minute cap if hit. The device picker pairs **recording devices with OS loopback/monitor devices** (PipeWire/PulseAudio), so "capture what the speakers are playing" works with no external routing — outputs are listed to help find the matching loopback by name.
- **Rename/remove**: inline, validator-gated; rename keeps `ownId` exempt from the collision check.

Editor integration: sample ids get the synth token color, and hovering one shows a tooltip with its origin/path and a ready-to-paste `makeBeat` line.

## sources/ — the online-sample aggregator (built, not yet surfaced)

A provider-normalization layer mirroring `cart/cutout/backends`: every adapter maps its provider's API into one schema (`NormalizedSample` with tri-state-null license/audio metadata — "provider didn't say" is modeled as `null`, never assumed). `SourceAdapter = {search, getById, resolveDownload}` factories with an **injectable `HttpGet`** so the offline smoke harness can run fixtures under `tools/v8cli` (no FFI network there). Adapters: `freesound` (token-gated search, ai_preference license field), `internet_archive`, `jamendo` working; `fma` stubbed unavailable with a reason string the UI can tooltip. `license.ts` normalizes to a `LicenseFamily` enum. `credentials.ts` is an explicitly-temporary token stash in localstore (`composer.sources.credentials` namespace) behind a `CredentialStore` interface for later replacement.

`importSampleAsWav` (the import bridge, `sources/index.ts:127`): `resolveDownload` → stream to `<dest>.src` via the `download` hook (progress → status line %) → WAV passes through with `mv`, anything else transcodes via `ffmpeg -ar 44100 -c:a pcm_s16le` (canonical format matching capture output) → cleanup. Provenance (provider, source id/url, license family/url, attribution flag, author) is recorded on the `SampleRef` at import — the only attribution record once the file is on disk.

**Status finding**: `state.ts` exposes `availableSources/searchSources/addSampleFromSource/setSourceToken`, but **no component consumes them** — grep finds zero references in `components/`. The entire subsystem (~1000 adapter lines + bridge + credentials + smoke tests) is dark-launched awaiting its search UI. `sources/smoke.sh` + `smoke.ts` are a self-contained offline test harness (esbuild bundle → `tools/v8cli`) — the only cart-local test suite seen in this review series.

## Editor: host-painted highlighting + hover docs

- `highlight.ts` tokenizes per line (line comments, quoted strings without interpolation, simple numbers, identifiers classified against KEYWORDS/SYNTHS/BUILTINS/project-sample sets, punct) and maps kinds to theme colors → `ColorRow[][]` for the **TextEditor primitive's `paintText`/`colorRows` mode** — the host paints the colored spans; the cart only supplies tokenization. Re-tokenizes the whole source per edit (memoized on `[source, sampleIds]`).
- **Hover-docs machinery** (`CodeEditor.tsx`): wrapper Box captures its rect via `onLayout` (into a ref — no re-render) and hover state via `onHoverEnter/Exit`; while hovered, a 60ms `setInterval` polls host mouse globals `getMouseX`/`getMouseY`, maps pointer → (line, col) using `lineHeight = fontSize+6` and an **approximated monospace char width** (`0.6 × fontSize` — acknowledged off-by-one risk), re-tokenizes that line, finds the token under the cursor, and resolves it to an `ApiEntry` (builtin/synth) or `SampleRef` (sample). The result drives a cursor-anchored `Tooltip` (framework anchors it; the cart only sets content), deduped by a key so state only changes when the resolved target changes.
- Compile errors render as a red bar under the editor (message from the sandbox catch).

Keyboard: `useIFTTT('key:ctrl+s')` → compile; `key:?` → cheat sheet (global key bus respects focus — typing `?` in a TextInput doesn't trigger it); `key:escape` in CheatSheet closes; undo/redo bindings come free from useWorkspace.

## What is not here

- No search UI for the online sources (the headline gap — plumbing only).
- No autocomplete, no multi-file projects, no MIDI input, no per-sample waveform display, no audio effects API surfaced (`setEffect` of the EarSketch idiom is absent).
- No lazy `durationMs` measurement actually implemented for imported/captured samples (always 0; comment says "measured lazily on first load" — not found in code).
- Editor hover math trusts a fixed char-width ratio; no host text-measurement API used.
- Compile sandbox is not a security boundary — `new Function` runs with full cart privileges; it's a *binding* mechanism, not isolation.
- No Scene3D/Canvas/Effect; this is a pure 2D tool cart.

## Integration-relevant observations

- **The workspace-cart pattern is now a proven 2-consumer abstraction** (`cutout` → generalized `runtime/workspace` → composer). Envelope + debounced autosave + snapshot undo + commit/commitCoalesced is the standard for every future tool cart; this doc + cutout's are the reference shapes.
- **`new Function(...bindingNames, body)` as a user-scripting sandbox** is the cart-side mini-DSL recipe: flat API, identifier-validated bindings, instrument-the-wrappers-for-UI. Directly reusable for any "user writes code that drives the engine" surface (the IF/THEN composer, game scripting).
- **Wrapper-instrumentation for visualization** (record scheduling intents at compile time; engine stays playback truth) is a clean pattern for any "show what the code did" UI without engine introspection.
- **Provider-adapter + normalized-schema + injectable-transport + offline-smoke-harness** (`sources/`) is the repo's most complete networking-integration template — including the tri-state-null honesty rule for third-party metadata and provenance capture at import.
- **Binary-file boundary, third sighting**: `cp` shell-out (here), PNM text trick (pixel_icon_demo), suggests `__fs_write_bytes`/`__fs_copy` host fns are overdue.
- **Built-ahead-of-UI inventory**: online sources (no UI), `durationMs` (never measured), credentials (placeholder by design). Flag for the coherence pass so these don't read as wired when they aren't.
- The EarSketch-flat idiom is a deliberate user-philosophy anchor (one-liner usable by a non-coder), and the cheat-sheet + hover-docs + library-id-highlighting triad is the discoverability layer that makes it self-teaching.

## Glossary

Binding: A name made global inside the compile sandbox — API function, synth constant, or project sample id.

Capture: Mic/loopback recording via `useAudioInput` (raw 44.1kHz mono → WAV in the project's samples dir, 10-min cap).

Coalesced commit: `ws.commitCoalesced()` — at most one history snapshot per 250ms window; used for typing/slider streams.

colorRows / paintText: The host TextEditor's syntax-coloring mode — the cart supplies per-line arrays of `{text, color}` spans; the host paints them.

Envelope: `SessionEnvelope<T>` — versioned `{kind, version, savedAt, stem, payload}` JSON written to `sessions/<stem>.session.json`.

Hover poll: The 60ms `getMouseX/getMouseY` loop mapping the pointer to a source token while the editor is hovered; drives the cursor-anchored tooltip.

Import bridge: `importSampleAsWav` — resolveDownload → stream to `.src` sidecar → mv or ffmpeg-transcode to canonical 44.1k s16le WAV.

Loopback / monitor device: An OS-exposed recording device that carries an output's audio (PipeWire/PulseAudio); lets capture record system audio.

NormalizedSample: The provider-agnostic search-result schema all source adapters emit; `uid = source:sourceId`.

Provenance: Attribution metadata (provider, license family/url, author, attribution flag) frozen onto a fetched `SampleRef` at import time.

Sandbox: The `new Function(...keys, body)` execution of the user's editor text with the flat API + sample bindings as parameters.

SampleRef: One library entry — `{id, label, path, durationMs, source, capturedAt?, provenance?}`; the id doubles as the code-facing global.

Sidecar WAV: The sample binary at `samples/<stem>/<id>.wav`, living beside (not inside) the session JSON.

Stem: The project's filename-safe name; keys the session file, the last-pointer, and the samples directory.

Synth constants: `kick/snare/hat/bass/lead` — built-in `AUDIO_SOUND` handles always bound in the sandbox, with their own token color.

TimelineEvent: `{kind, track, start, end, label}` recorded by the sandbox's instrumented scheduling wrappers; feeds the TimelineBar lanes.
