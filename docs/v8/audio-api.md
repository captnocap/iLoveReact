# V8 audio API

This is the reference for the V8-facing audio surface. For the callback,
threading, graph order, and sharp edges, see [audio-pipeline.md](./audio-pipeline.md).

## Runtime Surfaces

There are two active V8-facing APIs.

The declarative wrapper:

```tsx
import { Audio } from '@reactjit/runtime/primitives';
import { useAudio } from '@reactjit/runtime/hooks';

function Instrument() {
  return (
    <Audio gain={0.8}>
      <Audio.Module id="voice" type="instrument" voice={0} tone={0.5} />
      <Audio.Module id="delay" type="delay" time={0.18} feedback={0.35} mix={0.25} />
      <Audio.Connection from="voice" to="delay" fromPort={0} toPort={0} />
    </Audio>
  );
}
```

The direct host-function surface:

```ts
globalThis.__audio_init?.();
globalThis.__audio_add_module?.(10, 10);      // id=10, instrument
globalThis.__audio_add_module?.(20, 4);       // id=20, delay
globalThis.__audio_connect?.(10, 0, 20, 0);
globalThis.__audio_set_param?.(10, 0, 0);     // voice = kick
globalThis.__audio_note_on?.(10, 60, 1);
```

`cart/pocket_operator.tsx` uses the direct path because it needs explicit
engine lifetime control and telemetry polling.

## Initialization

| Function | Meaning |
| --- | --- |
| `__audio_init()` | Open default playback device, create SDL stream, bind callback, resume device. Returns `1` or `0`. |
| `__audio_deinit()` | Destroy stream/device, free owned beat/sample buffers, mark uninitialized. |
| `__audio_is_initialized()` | Return `1` when `g_engine.initialized` is true. |
| `__audio_pause()` | Pause the SDL playback device. |
| `__audio_resume()` | Resume the SDL playback device. |

Known-working direct setup:

```ts
const host = globalThis as any;

const ok =
  (host.__audio_init?.() ?? 0) > 0 ||
  (host.__audio_is_initialized?.() ?? 0) > 0;

if (ok) {
  host.__audio_add_module?.(1, 10);
  host.__audio_resume?.();
}
```

## React Wrapper

`runtime/primitives.tsx` lazily loads `runtime/audio.tsx` for:

| JSX API | Implementation |
| --- | --- |
| `Audio` | Context provider plus master gain prop handling. |
| `Audio.Module` | Allocates a numeric id, adds/removes a host module, maps named param props to indices. |
| `Audio.Connection` | Resolves string ids and connects/disconnects ports after sibling module effects run. |

The `Audio` context stores string id to numeric id, numeric id to module type,
and a per-tree id allocator. Children render `null`.

`useAudio()` returns the imperative surface. Most methods are 1:1 wrappers over
the matching `__audio*` host function below. The methods with extra behavior
are:

| Method | Extra behavior |
| --- | --- |
| `getId(name)` | Context lookup only; no host call. |
| `setParam(target, name, value)` / `setModuleParam(...)` | Resolves string ids, looks up module type, maps param name to index, then calls `__audioSetParam`. |
| `getParam(target, param)` | Accepts param name or numeric index; name lookup uses local metadata. |
| `getParamDefinitions(target)` | Returns local metadata for a module type or module instance. |
| `setTempo(startTempo, start, endTempo?, end?)` | Uses 1-based measures and supports fixed tempo points or linear ramps. |
| `makePattern(...)` / `makeSlicePattern(...)` | Preferred aliases for `makeBeat` / `makeBeatSlice`. |
| `setStep(sequencer, track, step, active, note?, velocity?)` | Module-level sequencer step write; velocity accepts `0..1` or `0..127`. |
| `setTrackTarget(sequencer, track, target)` | Resolves both sequencer and target ids before host call. |
| `loadSample(target, slot, path, mode?)` | Resolves sampler id and loads a WAV into a 1-based slot. |
| `loadSound(path)` | Loads a WAV as a `Sound` handle for duration queries, slice/stretch, patterns, and media placement. |
| `noteOff(target, note?)` | Optional note is needed to stop looped sampler voices. |
| `setMasterEffect(...)` | Reserved no-op. |

## Host Functions

`framework/v8_bindings_core.zig` registers both camelCase and snake_case names.
CamelCase names are used by `runtime/audio.tsx`; snake_case names match the
legacy QuickJS/direct-cart shape.

| CamelCase | Snake_case | Command / return |
| --- | --- | --- |
| `__audioAddModule(id, type)` | `__audio_add_module(id, type)` | `add_module` |
| `__audioRemoveModule(id)` | `__audio_remove_module(id)` | `remove_module` |
| `__audioConnect(from, fromPort, to, toPort)` | `__audio_connect(...)` | `connect` |
| `__audioDisconnect(from, fromPort, to, toPort)` | `__audio_disconnect(...)` | `disconnect` |
| `__audioSetParam(id, index, value)` | `__audio_set_param(...)` | `set_param` |
| `__audioGetParam(id, index)` | `__audio_get_param(...)` | query |
| `__audioNoteOn(id, midi, velocity?)` | `__audio_note_on(...)` | `note_on` |
| `__audioNoteOff(id, midi?)` | `__audio_note_off(...)` | `note_off` |
| `__audioMasterGain(gain)` | `__audio_set_master_gain(gain)` | `set_master_gain` |
| `__audioSetMasterVolume(gain)` | `__audio_set_master_volume(gain)` | alias |
| `__audioPlay()` | `__audio_play()` | `transport_play` |
| `__audioPause()` | `__audio_transport_pause()` | `transport_pause` |
| `__audioStop()` | `__audio_stop()` | `transport_stop` |
| `__audioSetPlayhead(measure)` | `__audio_set_playhead(measure)` | `transport_set_playhead` |
| `__audioGetPlayhead()` | `__audio_get_playhead()` | query |
| `__audioIsPlaying()` | `__audio_is_playing()` | query |
| `__audioSetTempo(startTempo, start, endTempo?, end?)` | `__audio_set_tempo(...)` | `set_tempo` |
| `__audioMakeBeat(soundSpec, track, start, beat, stepsPerMeasure?)` | `__audio_make_beat(...)` | `make_beat` |
| `__audioMakeBeatSlice(soundSpec, track, start, beat, sliceSpec, stepsPerMeasure?)` | `__audio_make_beat_slice(...)` | `make_beat_slice` |
| `__audioMakePattern(...)` | `__audio_make_pattern(...)` | alias for `make_beat` |
| `__audioMakeSlicePattern(...)` | `__audio_make_slice_pattern(...)` | alias for `make_beat_slice` |
| `__audioSetStepVelocity(track, step, velocity)` | `__audio_set_step_velocity(...)` | `set_step_velocity` |
| `__audioSetStepProbability(track, step, probability)` | `__audio_set_step_probability(...)` | `set_step_probability` |
| `__audioSetStepOffset(track, step, offset)` | `__audio_set_step_offset(...)` | `set_step_offset` |
| `__audioSetStep(sequencer, track, step, active, note?, velocity?)` | `__audio_set_step(...)` | `sequencer_set_step` |
| `__audioSetTrackTarget(sequencer, track, target)` | `__audio_set_track_target(...)` | `sequencer_set_track_target` |
| `__audioClearPattern(sequencer)` | `__audio_clear_pattern(...)` | `sequencer_clear_pattern` |
| `__audioClockPulse(clock?)` | `__audio_clock_pulse(...)` | `clock_pulse` |
| `__audioClockStart(clock?)` | `__audio_clock_start(...)` | `clock_start` |
| `__audioClockStop(clock?)` | `__audio_clock_stop(...)` | `clock_stop` |
| `__audioInsertMedia(soundSpec, track, start)` | `__audio_insert_media(...)` | `insert_media` |
| `__audioFitMedia(soundSpec, track, start, end)` | `__audio_fit_media(...)` | `fit_media` |
| `__audioInsertMediaSection(soundSpec, track, start, sliceStart, sliceEnd)` | `__audio_insert_media_section(...)` | `insert_media` |
| `__audioClearTrack(track, start?, end?)` | `__audio_clear_track(...)` | `clear_track` |
| `__audioSetTrackVolume(track, volume)` | `__audio_set_track_volume(...)` | `set_track_volume` |
| `__audioSetTrackPan(track, pan)` | `__audio_set_track_pan(...)` | `set_track_pan` |
| `__audioSetTrackMute(track, muted)` | `__audio_set_track_mute(...)` | `set_track_mute` |
| `__audioSetTrackSolo(track, soloed)` | `__audio_set_track_solo(...)` | `set_track_solo` |
| `__audioDur(soundSpec)` | `__audio_dur(soundSpec)` | query |
| `__audioCreateAudioStretch(soundSpec, factor)` | `__audio_create_audio_stretch(...)` | query / handle allocation |
| `__audioCreateAudioSlice(soundSpec, start, end)` | `__audio_create_audio_slice(...)` | query / handle allocation |
| `__audioStretchSound(soundSpec, factor)` | `__audio_stretch_sound(...)` | alias |
| `__audioSliceSound(soundSpec, start, end)` | `__audio_slice_sound(...)` | alias |
| `__audioLoadSound(path)` | `__audio_load_sound(path)` | decode WAV, return Sound handle |
| `__audioLoadSample(module, slot, path, mode?)` | `__audio_load_sample(...)` | decode WAV, enqueue sampler slot update |
| `__audioClearSample(module, slot)` | `__audio_clear_sample(...)` | clear sampler slot |

Telemetry and metadata:

| Function | Return |
| --- | --- |
| `__audio_get_module_count()` | Module slot watermark. |
| `__audio_get_connection_count()` | Connection slot watermark. |
| `__audio_get_callback_count()` | Completed SDL callback count. |
| `__audio_get_callback_us()` | Last callback duration in microseconds. |
| `__audio_get_sample_rate()` | `44100`. |
| `__audio_get_buffer_size()` | `512`. |
| `__audio_get_peak_level()` | Peak absolute value in the current master buffer. |
| `__audio_get_param_count(id)` | Active module param count or `0`. |
| `__audio_get_port_count(id)` | Active module port count or `0`. |
| `__audio_get_module_type(id)` | Module enum number or `-1`. |
| `__audio_get_param_min(id, index)` | Param metadata min or `0`. |
| `__audio_get_param_max(id, index)` | Param metadata max or `0`. |

## Command Semantics

`setTempo(startTempo, start, endTempo?, end?)`: BPM values use 1-based measure
positions. Supplying only `startTempo` and `start` creates a tempo point that
persists until the next point. Supplying all four values creates a linear ramp.

`play`, `pause`, `stop`, `setPlayhead`: control timeline scheduling. The SDL
callback may continue while paused, but media/pattern scheduling and transport
advancement are gated. `stop` resets to measure `1`.

`makeBeat(sound, track, start, beat, stepsPerMeasure?)`: writes a beat string to
a host-managed instrument track. `0..9` and `A..F` select sounds from the sound
array, `+` ties, and `-` rests. Default `stepsPerMeasure` is `16`.

`makeBeatSlice(sound, track, start, beat, sliceStarts, stepsPerMeasure?)`: same
timing as `makeBeat`, but pattern characters select 1-based slice-start
positions inside one source sound.

`setStepVelocity`, `setStepProbability`, `setStepOffset`: mutate metadata for
the most recent host-managed track pattern.

`setStep`, `setTrackTarget`, `clearPattern`: operate on a module-level
`sequencer`, not the host-managed `makeBeat` track system.

`clockPulse`, `clockStart`, `clockStop`: operate on a module-level `clock`.
Passing `0` or omitting the clock target broadcasts to all clock modules.
`clockPulse` consumes MIDI-style 24-PPQN clock pulses and emits module ticks at
the selected clock division.

`insertMedia(sound, track, start)`: schedules one whole sound at a 1-based
measure. Generated sounds and `loadSound()` handles both work.

`fitMedia(sound, track, start, end)`: repeats or shortens sound triggers to fill
a 1-based measure span.

`insertMediaSection(sound, track, start, sliceStart, sliceEnd)`: creates a
sliced sound view, then schedules it as a one-shot insert.

`dur`, `createAudioStretch`, `createAudioSlice`: operate on generated sounds and
decoded WAV handles returned by `loadSound(path)`.

`loadSound(path)`: decodes a WAV on the control side and returns an opaque
`Sound` handle. The handle can be passed to `dur`, `createAudioSlice`,
`createAudioStretch`, `makeBeat`, `makeBeatSlice`, `insertMedia`, and
`fitMedia`.

`loadSample(module, slot, path, mode?)`: loads WAV data on the control side and
stores it in a sampler slot. `mode` is `"oneshot"` or `"loop"`.

## Module Types

| Number | Type |
| --- | --- |
| `0` | `oscillator` |
| `1` | `filter` |
| `2` | `amplifier` |
| `3` | `mixer` |
| `4` | `delay` |
| `5` | `envelope` |
| `6` | `lfo` |
| `7` | `sequencer` |
| `8` | `sampler` |
| `9` | `custom` |
| `10` | `instrument` (`pocket_voice` in Zig) |
| `11` | `clock` |

The V8 add-module binding clamps incoming type values to `0..11`.

## Ports And Params

Param order is the ABI. JSX names are converted to these indices.

| Type | Ports | Params |
| --- | --- | --- |
| `oscillator` | `0 audio_out`, `1 freq_in`, `2 fm_in` | `0 waveform`, `1 frequency`, `2 detune`, `3 gain`, `4 fm_amount` |
| `filter` | `0 audio_in`, `1 audio_out`, `2 cutoff_in` | `0 cutoff`, `1 resonance`, `2 mode` |
| `amplifier` | `0 audio_in`, `1 audio_out`, `2 gain_in` | `0 gain` |
| `mixer` | `0 in_1`, `1 in_2`, `2 in_3`, `3 in_4`, `4 audio_out` | `0 gain_1`, `1 gain_2`, `2 gain_3`, `3 gain_4` |
| `delay` | `0 audio_in`, `1 audio_out` | `0 time`, `1 feedback`, `2 mix` |
| `envelope` | `0 audio_in`, `1 audio_out`, `2 gate_in` | `0 attack`, `1 decay`, `2 sustain`, `3 release` |
| `lfo` | `0 control_out` | `0 rate`, `1 depth`, `2 waveform` |
| `clock` | `0 gate_out`, `1 audio_out` | `0 bpm`, `1 division`, `2 swing`, `3 running` |
| `sequencer` | `0 clock_in`, `1 gate_out` | `0 steps`, `1 tracks`, `2 bpm`, `3 running` |
| `sampler` | `0 audio_out`, `1 gate_in` | `0 gain`, `1 loop`, `2 slot` |
| `custom` | none | none |
| `instrument` / `pocket_voice` | `0 audio_out` | `0 voice`, `1 tone`, `2 decay`, `3 color`, `4 drive`, `5 gain` |

Inline enum values:

- Oscillator waveform: `0=sine`, `1=saw`, `2=square`, `3=triangle`, `4=noise`.
- Filter mode: `0=lowpass`, `1=highpass`, `2=bandpass`.
- Clock division: `0=1/4`, `1=1/8`, `2=1/16`, `3=1/32`, `4=1/2`, `5=1/1`.
- Instrument voice: `0=kick`, `1=snare`, `2=hat`, `3=bass`, `4=lead`.

## MIDI And Audio Input

MIDI host calls:

| Function | Meaning |
| --- | --- |
| `__midi_start()` / `__midiStart()` | Open ALSA sequencer input and auto-connect readable ports. |
| `__midi_stop()` / `__midiStop()` | Close the sequencer and clear state. |
| `__midi_is_available()` / `__midiIsAvailable()` | Return `1` after successful start. |
| `__midi_poll()` / `__midiPoll()` | Drain ALSA events into the host event ring. |
| `__midi_devices_json()` / `__midiDevicesJson()` | Return detected input ports as JSON. |
| `__midi_next_event_json()` / `__midiNextEventJson()` | Pop one normalized event JSON string. |

`useMIDI()` exposes devices, event subscription, note routing, CC learn, CC map,
and CC unmap. It can also route MIDI clock/start/stop:

```ts
useMIDI({
  clockTarget: 'clock',
  syncTransport: true,
});
```

`clockTarget` sends MIDI clock pulses into a clock module. `syncTransport`
maps MIDI start to `play()` and MIDI stop to `pause()`.

Audio input host calls:

| Function | Meaning |
| --- | --- |
| `__audio_input_devices_json()` | Return SDL recording devices as JSON. |
| `__voice_recording_devices_json()` | Compatibility alias. |

`useAudioInput()` wraps the voice capture backend for non-speech callers.

## Minimal Sequences

Generated instrument:

```ts
const host = globalThis as any;

if ((host.__audio_init?.() ?? 0) > 0) {
  host.__audio_add_module(1, 10); // instrument
  host.__audio_set_param(1, 0, 0); // kick
  host.__audio_note_on(1, 36, 1);
}
```

Sampler:

```ts
const audio = useAudio();

audio.initAudio();
audio.addModule(1, 'sampler');
audio.loadSample(1, 1, '/absolute/path/kick.wav', 'oneshot');
audio.noteOn(1, 36, 1);  // slot 1
```

Timeline sample:

```ts
const audio = useAudio();

audio.initAudio();
const loop = audio.loadSound('/absolute/path/drum-loop.wav');
audio.fitMedia(loop, 0, 1, 5);
audio.play();
```

Module-level sequencer:

```ts
const audio = useAudio();

audio.initAudio();
audio.addModule(3, 'clock');
audio.addModule(1, 'sequencer');
audio.addModule(2, 'instrument');
audio.setTrackTarget(1, 0, 2);
audio.setStep(1, 0, 0, true, 36, 100);
audio.setStep(1, 0, 4, true, 38, 100);
audio.connectModules(3, 1, 0, 0); // clock.gate_out -> sequencer.clock_in
audio.clockStart(3);
audio.play();
```

Direct pocket-operator-style flow:

```text
mount:
  __audio_init()
  __audio_add_module(MIXER_ID, mixer)
  __audio_add_module(DELAY_ID, delay)
  for each track:
    __audio_add_module(track.moduleId, instrument)
    __audio_connect(track.moduleId, 0, MIXER_ID, trackIndex)
    __audio_set_param(MIXER_ID, trackIndex, 1)
  __audio_connect(MIXER_ID, 4, DELAY_ID, 0)
  __audio_resume()

controls:
  master gain -> __audio_set_master_gain
  delay knobs -> __audio_set_param(DELAY_ID, ...)
  track knobs -> __audio_set_param(track.moduleId, ...)

sequencer tick:
  accent params -> __audio_set_param(...)
  trigger voice -> __audio_note_on(track.moduleId, midiNote)

telemetry:
  poll __audio_get_peak_level()
  poll __audio_get_callback_us()

unmount:
  remove track modules, delay, mixer
  __audio_deinit()
```
