# Audio Subsystem

## Overview

SDL3 audio stream + LuaJIT DSP engine. The runtime runs on SDL's audio callback thread, while the cart/main thread enqueues commands asynchronously.

---

## Internal File Map

| File | Responsibility |
|---|---|
| `types.zig` | Constants, enums (`ModuleType`, `Waveform`, `Command.Tag`, etc.), and structs (`Module`, `Connection`, `BeatPattern`, …). |
| `state.zig` | Global `g_engine` state and the lock-free SPSC command queue (`pushCommand` / `popCommand`). |
| `dsp.zig` | All signal-processing code: oscillators, filters, samplers, envelope, delay, reverb, graph routing, and topological sort. |
| `callback.zig` | SDL3 `audioCallback` — the interrupt-thread entry point. Processes commands, schedules beats/media, then runs the DSP graph. |
| `engine.zig` | Lifecycle (`init` / `deinit`), SDL3 device open/close, and LuaJIT VM setup. |
| `api.zig` | Public cart-facing API (`makeBeat`, `setTempo`, `loadSample`, `insertMedia`, …) and telemetry getters. |
| `sdl.zig` | Single shared `@cImport` of SDL3. All other files reference this to avoid opaque-type mismatches. |
| `audio.zig` | **Facade** — re-exports public symbols so existing importers (`v8_bindings_audio.zig`, `engine.zig`) keep working. |

---

## User-Facing API

There are **three layers** to the audio API — raw host functions, an imperative hook, and declarative JSX components.

### Layer 1: Raw Host Functions

Registered by `framework/v8_bindings_audio.zig` and exposed on `globalThis`. In practice you never call these directly; go through `useAudio()`.

**Lifecycle / Transport**
```
__audioInit() → bool
__audioDeinit()
__audioResume() / __audioPause()
__audioPlay() / __audioStop()
__audioSetPlayhead(measure)
__audioGetPlayhead() → measure
__audioIsPlaying() → bool
__audioSetTempo(startTempo, startMeasure, ?endTempo, ?endMeasure)
```

**Module Graph (DSP)**
```
__audioAddModule(id, typeNum)
__audioRemoveModule(id)
__audioConnect(fromId, fromPort, toId, toPort)
__audioDisconnect(fromId, fromPort, toId, toPort)
__audioSetParam(id, paramIdx, value)
__audioNoteOn(id, midi, velocity)
__audioNoteOff(id, ?midi)
__audioMasterGain(gain)
```

**Pattern / Sequencer / Timeline**
```
__audioMakeBeat(soundSpec, track, startMeasure, beatString, stepsPerMeasure)
__audioMakeBeatSlice(soundSpec, track, startMeasure, beatString, sliceSpec, stepsPerMeasure)
__audioInsertMedia(soundSpec, track, startMeasure)
__audioFitMedia(soundSpec, track, startMeasure, endMeasure)
__audioInsertMediaSection(soundSpec, track, startMeasure, sliceStart, sliceEnd)
__audioClearTrack(track, ?start, ?end)
__audioSetTrackVolume(track, volume)
__audioSetTrackPan(track, pan)
__audioSetTrackMute(track, muted)
__audioSetTrackSolo(track, soloed)
__audioSetStepVelocity(track, step, velocity)
__audioSetStepProbability(track, step, probability)
__audioSetStepOffset(track, step, offset)
__audioSetStep(sequencerId, track, step, active, note, velocity)
__audioSetTrackTarget(sequencerId, track, targetModuleId)
__audioClearPattern(sequencerId)
__audioClockPulse(?id) / __audioClockStart(?id) / __audioClockStop(?id)
```

**Samples / Sound Handles**
```
__audioDur(soundSpec) → measures
__audioCreateAudioStretch(soundSpec, factor) → soundHandle
__audioCreateAudioSlice(soundSpec, start, end) → soundHandle
__audioLoadSound(path) → soundHandle
__audioLoadSample(moduleId, slot, path, mode) → bool
__audioClearSample(moduleId, slot) → bool
```

**Telemetry**
```
__audioGetModuleCount() / __audioGetConnectionCount()
__audioGetPeakLevel() / __audioGetCallbackUs()
__audioGetParam(id, idx) / __audioGetParamMin(id, idx) / __audioGetParamMax(id, idx)
```

---

### Layer 2: Imperative Hook — `useAudio()`

```tsx
import { useAudio } from '@reactjit/runtime/hooks';

const audio = useAudio();
```

**Lifecycle**
```tsx
audio.initAudio()              // open SDL device + resume
audio.deinitAudio()            // close device
audio.isAudioInitialized()     // bool
```

**Transport**
```tsx
audio.play();
audio.pause();                 // pauses scheduling
audio.stop();                  // stops + resets playhead
audio.setPlayhead(measure);
audio.getPlayhead();           // current 1-based measure
audio.isPlaying();
audio.setTempo(bpm, startMeasure, ?endBpm, ?endMeasure);
```

**Module Graph (imperative)**
```tsx
audio.addModule(id, 'instrument');
audio.removeModule(id);
audio.connectModules(from, to, fromPort?, toPort?);
audio.disconnectModules(from, to, fromPort?, toPort?);
audio.noteOn('inst1', 60, 0.8);     // midi 0..127, velocity 0..1
audio.noteOff('inst1', 60);
audio.setParam('inst1', 'tone', 0.5);      // by name
audio.setParamIndex('inst1', 1, 0.5);      // by raw index
audio.getParam('inst1', 'tone');
```

**Timeline / Patterns**
```tsx
audio.makeBeat(sound, track, start, 'x-x-x-x-', 16);
audio.makeBeatSlice(sound, track, start, '0123', [0, 1, 2, 3], 16);
audio.insertMedia(sound, track, start);
audio.fitMedia(sound, track, start, end);
audio.clearTrack(track);
audio.setTrackVolume(track, 0.8);
audio.setTrackPan(track, -0.2);
audio.setTrackMute(track, true);
audio.setStepVelocity(track, step, 0.7);
audio.setStepProbability(track, step, 0.5);
audio.setStepOffset(track, step, 0.1);
audio.setStep(sequencerId, track, step, active, note, velocity);
audio.setTrackTarget(sequencerId, track, targetId);
audio.clearPattern(sequencerId);
audio.clockPulse(clockId?);
audio.clockStart(clockId?);
audio.clockStop(clockId?);
```

**Samples**
```tsx
audio.loadSound('/assets/kick.wav');      // returns a sound handle
audio.loadSample('sampler1', 1, '/assets/kick.wav', 'oneshot');
audio.dur(soundHandle);                    // duration in measures
audio.createAudioStretch(sound, 2.0);
audio.createAudioSlice(sound, 0.5, 1.5);
```

**Monitoring**
```tsx
audio.getPeakLevel();
audio.getCallbackTime();
audio.getModuleCount();
audio.getConnectionCount();
```

---

### Layer 3: Declarative JSX

```tsx
import { Audio } from '@reactjit/runtime/audio';

<Audio gain={0.8}>
  <Audio.Module id="inst1" type="instrument" voice={0} tone={0.5} decay={0.35} drive={0.2} gain={0.8} />
  <Audio.Module id="env1" type="envelope" attack={0.01} decay={0.2} sustain={0.5} release={0.3} />
  <Audio.Module id="filt1" type="filter" cutoff={1800} resonance={0.15" mode={0} />
  <Audio.Module id="lfo1" type="lfo" rate={1.5} depth={0.2" waveform={0} />

  <Audio.Connection from="inst1" to="filt1" />
  <Audio.Connection from="filt1" to="master" />
</Audio>
```

**`<Audio>` props**
| Prop | Type | Default | Description |
|---|---|---|---|
| `gain` | `number` | — | Master output gain, 0..1 |

**`<Audio.Module>` props**
| Prop | Type | Description |
|---|---|---|
| `id` | `string` | Unique handle for `useAudio()` lookups and connections |
| `type` | `AudioModuleType` | See module table below |
| `[paramName]` | `number` | Any additional numeric prop is treated as a typed param (see param tables) |

**`<Audio.Connection>` props**
| Prop | Type | Default | Description |
|---|---|---|---|
| `from` | `string \| number` | — | Source module id (or 0 for master) |
| `to` | `string \| number` | — | Destination module id (or 0 for master) |
| `fromPort` | `number` | 0 | Source output port index |
| `toPort` | `number` | 0 | Destination input port index |

---

### Module Types & Params

| Type | Params (name → index) |
|---|---|
| `oscillator` | `waveform` (0), `frequency` (1), `detune` (2), `gain` (3), `fm_amount` (4) |
| `filter` | `cutoff` (0), `resonance` (1), `mode` (2) |
| `amplifier` | `gain` (0) |
| `mixer` | `gain_1` (0), `gain_2` (1), `gain_3` (2), `gain_4` (3) |
| `delay` | `time` (0), `feedback` (1), `mix` (2) |
| `envelope` | `attack` (0), `decay` (1), `sustain` (2), `release` (3) |
| `lfo` | `rate` (0), `depth` (1), `waveform` (2) |
| `sequencer` | `steps` (0), `tracks` (1), `bpm` (2), `running` (3) |
| `sampler` | `gain` (0), `loop` (1), `slot` (2) |
| `instrument` | `voice` (0), `tone` (1), `decay` (2), `color` (3), `drive` (4), `gain` (5) |
| `clock` | `bpm` (0), `division` (1), `swing` (2), `running` (3) |
| `custom` | — |

Param ranges and defaults are defined in `runtime/audio.tsx` as `AUDIO_PARAM_DEFS`.

---

### Control Components (`AudioControls`)

```tsx
import { AudioControls } from '@reactjit/runtime/audio-controls';
```

| Component | Purpose |
|---|---|
| `AudioControls.Transport` | Play / pause / stop / BPM / position display |
| `AudioControls.Keybed` | Piano or grid keyboard for note input |
| `AudioControls.Pads` | Velocity-sensitive trigger pads |
| `AudioControls.Slider` | Vertical / horizontal / rotary param slider |
| `AudioControls.XYPad` | 2-axis param control |
| `AudioControls.StepGrid` | Editable step sequencer grid (host-managed) |
| `AudioControls.StepPattern` | Visual step pattern with levels (0/1/2) |
| `AudioControls.StepMeter` | Compact LED-style step display |
| `AudioControls.LevelMeter` | Segmented level meter |
| `AudioControls.Knob` | Rotary knob with +/- buttons |
| `AudioControls.Scope` | Waveform / spectrum visualizer |
| `AudioControls.ModulePanel` | Auto-generated panel of sliders for a module |
| `AudioControls.PatternTrack` | Declarative track that schedules itself on mount |
| `AudioControls.TrackSelector` | Tab strip for track selection |

---

### Built-in Sound Constants

```tsx
import { AUDIO_SOUND } from '@reactjit/runtime/hooks';

AUDIO_SOUND.kick   // 0
AUDIO_SOUND.snare  // 1
AUDIO_SOUND.hat    // 2
AUDIO_SOUND.bass   // 3
AUDIO_SOUND.lead   // 4
```

These are synthetic sounds built into the engine. You can also load WAV files via `audio.loadSound()` and `audio.loadSample()`.

---

## Typical Cart Lifecycle

```tsx
const audio = useAudio();

useEffect(() => {
  audio.initAudio();
  audio.setTempo(120, 1);
  audio.setMasterVolume(0.7);
  audio.play();
  return () => {
    audio.stop();
    audio.clearTrack(0);
    audio.deinitAudio();
  };
}, []);
```

The engine auto-initializes on first use, but calling `initAudio()` explicitly ensures the device is open before you start scheduling patterns.

---

## Key Internal Concepts

### Module Graph

- Up to `MAX_MODULES` (64) DSP modules.
- Modules have typed **ports** (audio/CV, input/output) and **params** (exposed to the cart).
- **Connections** wire output ports to input ports.
- `rebuildExecOrder()` topologically sorts the graph every time a connection changes.
- `routeConnections()` copies output buffers to input buffers before each block.

### Command Queue

- Single-producer / single-consumer, lock-free, atomic head/tail.
- The main thread calls `pushCommand()` to enqueue mutations.
- The audio callback calls `popCommand()` at the top of each block and applies them.
- If the queue is full, `pushCommand()` returns `false` and the command is dropped.

### Callback Thread Safety

- `audioCallback` runs on SDL's high-priority audio thread.
- All mutable state lives in `g_engine`.
- The only cross-thread communication is the command queue; no locks are held in the callback.
- `g_engine.order_dirty` is set by the main thread when the graph changes; the callback rebuilds execution order on the next block.

### Tempo & Transport

- Tempo is piecewise-linear via `TempoSegment`s.
- `transport_measure` is a `f64` that advances in musical measures.
- `scheduleBeatPatterns()` and `scheduleMediaEvents()` run inside the callback to translate measure-time into sample-time triggers.

### Sample Management

- `SampleData` owns a heap-allocated interleaved `f32` buffer.
- `SampleVoice` is a playback instance with ADSR envelope and pitch control.
- Sampler modules hold up to `MAX_SAMPLER_SLOTS` (16) sample references.

---

## Adding a New Module Type

1. Add a variant to `ModuleType` in `types.zig`.
2. In `dsp.zig`, add a `processMyModule()` function that writes to `m.output_buffers`.
3. In `dsp.zig:processModule()`, dispatch to the new function.
4. If the module needs ports or params, call `initModulePorts()` from `api.zig` when the module is created.
5. Add param definitions to `AUDIO_PARAM_DEFS` in `runtime/audio.tsx` so JSX prop names resolve.

---

## Important Constraints

- **Never allocate in the callback.** The callback must not touch the heap; all buffers are pre-allocated in `g_engine.buffer_storage`.
- **Don't call `log.print` in the hot path.** `log.print` is used sparingly in `api.zig` (main thread only). The callback uses `std.log` for errors.
- **Keep DSP functions branch-predictable.** The callback has a hard real-time deadline (`BUFFER_SIZE / SAMPLE_RATE` ≈ 11.6 ms).
- **Zig `pub` visibility matters.** Cross-file calls within `framework/audio/` still require `pub` because each file is its own struct/namespace.

---

## Dependency Graph

```
types.zig  ←── no audio deps
  ↑
state.zig  ←── types
  ↑
sdl.zig    ←── no audio deps
  ↑
dsp.zig    ←── types, state, api (circular: api also imports dsp — OK because uses are inside functions only)
api.zig    ←── types, state, dsp
callback.zig ←── types, state, dsp, api
engine.zig   ←── types, state, callback, api
audio.zig    ←── re-exports from all of the above
```

The `api.zig ↔ dsp.zig` circular import is resolved by Zig because neither file dereferences the import at namespace level (only inside function bodies).

---

## History

- 2026-05-10: Split from monolithic `framework/audio.zig` (3,553 lines) into the current directory structure. Deleted legacy QuickJS host-function bindings.
