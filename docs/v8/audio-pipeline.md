# V8 audio pipeline

This is the end-to-end path from cart code to speakers for the V8 runtime.

```text
Cart TSX / globalThis.__audio_* call
  -> runtime/audio.tsx or direct host function
  -> framework/v8_bindings_core.zig host callback
  -> framework/audio.zig command ring or explicit engine call
  -> SDL3 audio stream callback
  -> process queued graph commands
  -> topological module order
  -> route port buffers
  -> DSP module processors
  -> terminal audio outputs mixed into master_buffer
  -> SDL_PutAudioStreamData(...)
```

Audio is not a layout or paint primitive. The React wrappers render `null`;
they translate lifecycle and events into host commands consumed by the audio
engine.

## Threading Model

V8/JS host callbacks run on the control thread. Most of them validate arguments
and call `audio.pushCommand(...)`; they do not directly mutate module DSP state.

The SDL audio callback runs on its own thread. It is the sole consumer of the
command ring and the sole writer of module graph state, module DSP state,
transport position, scheduling cursors, and the master output buffer.

There are exceptions worth keeping visible: `audio.init()` / `audio.deinit()`
own SDL device lifetime on the control side, `loadSample()` and `loadSound()`
decode and store sample buffers before enqueueing or returning handles, and
several telemetry queries read engine fields from JS. Treat new cross-thread
reads or writes as a design decision, not a convenience.

The audio callback must not allocate, lock, perform file I/O, or log.

## Initialization

The SDL audio device is created only by `audio.init()` in
`framework/audio.zig`, exposed to V8 as `__audio_init()`.

```text
buffer_pool.data = &buffer_storage
SDL_OpenAudioDevice(default playback, F32 stereo 44100)
SDL_CreateAudioStream(&spec, &spec)
SDL_SetAudioStreamGetCallback(stream, audioCallback, null)
SDL_BindAudioStream(device, stream)
SDL_ResumeAudioDevice(device)
initialized = true
```

The declarative wrapper does not initialize the engine; see
[Sharp Edges](#sharp-edges).

## Command Queue

`framework/audio.zig` uses a fixed atomic ring:

```text
pushCommand:
  tail = cmd_tail
  next = (tail + 1) % MAX_COMMAND_QUEUE
  if next == cmd_head: queue full -> false
  commands[tail] = cmd
  cmd_tail = next

popCommand:
  if cmd_head == cmd_tail: empty
  cmd = commands[cmd_head]
  cmd_head = (cmd_head + 1) % MAX_COMMAND_QUEUE
```

The comments call this both MPSC and SPSC in different places. The current V8
path behaves as a single JS producer and one audio-thread consumer.

V8 command host functions mostly ignore the `pushCommand` boolean return, so
queue overflow is not reported to JS.

## SDL Callback

When SDL requests data, `audioCallback(...)` renders one fixed block:

```text
if additional_amount <= 0: return

processCommands()
if order_dirty: rebuildExecOrder()

num_samples = BUFFER_SIZE
current_tempo = tempoAtMeasure(transport_measure)
if transport_playing:
  scheduleMediaEvents()
  scheduleBeatPatterns()

clearInputBuffers(num_samples)
routeConnections(num_samples)

for idx in exec_order:
  processModule(modules[idx], num_samples)

clear master_buffer
for every active module audio out port:
  if that out port has no active downstream connection:
    master_buffer[L/R] += port_buffer * master_gain * track volume/pan
mix active decoded-sample timeline voices into master_buffer

SDL_PutAudioStreamData(...)
update callback telemetry
advance transport when playing
```

Two details matter:

- `additional_amount` is only used as a positive/zero signal; the callback
  always renders `BUFFER_SIZE` samples.
- `routeConnections()` currently runs before module processing. A downstream
  module can therefore receive the upstream buffer from the previous callback.
  Current-buffer semantics would require routing as each module finishes.

## Graph Order

`rebuildExecOrder()` computes a simple topological order:

```text
count active incoming connections per active module
queue modules with zero incoming edges
pop queue, append to exec_order
for outgoing edges: decrement downstream in_degree
when downstream reaches zero: queue it
```

Cycles are not reported. Modules left with nonzero in-degree after the BFS do
not enter `exec_order`, so they do not process.

`routeConnections(num_samples)` then loops active connections and adds source
samples into destination input buffers. Multiple connections into one input are
additive.

Master output is implicit. There is no real module id `0` in `audio.zig`;
terminal audio output ports are mixed automatically.

## Engine State

`g_engine` preallocates the hot-path state:

| Field | Meaning |
| --- | --- |
| `device_id`, `stream` | SDL3 playback device and stream. |
| `modules[MAX_MODULES]` | Fixed module slots, max `64`. |
| `connections[MAX_CONNECTIONS]` | Fixed patch-cable slots, max `256`. |
| `exec_order[MAX_MODULES]` | Topological sort result. |
| `master_buffer[BUFFER_SIZE * MAX_CHANNELS]` | Interleaved F32 stereo output. |
| `tempo_segments[MAX_TEMPO_POINTS]` | Sorted tempo points/ramps. |
| `beat_patterns[MAX_BEAT_PATTERNS]` | Track pattern strings from `makeBeat`. |
| `beat_tracks[MAX_BEAT_TRACKS]` | Host-managed instrument track state. |
| `media_events[MAX_MEDIA_EVENTS]` | `insertMedia` / `fitMedia` timeline events. |
| `sound_handles[MAX_AUDIO_SOUND_HANDLES]` | Generated and decoded-sample sound views from load/slice/stretch. |
| `samples[MAX_AUDIO_SAMPLES]` | Decoded WAV buffers loaded on the control side. |
| `sample_voices[MAX_SAMPLE_VOICES]` | Host-managed timeline/pattern playback voices for decoded `Sound` handles. |
| `buffer_storage` | Fixed port-buffer pool. |
| `commands[MAX_COMMAND_QUEUE]` | Atomic command ring, max `1024`. |
| `callback_count`, `callback_us` | Callback telemetry. |

Key constants:

| Constant | Value |
| --- | --- |
| `SAMPLE_RATE` | `44100` |
| `BUFFER_SIZE` | `512` |
| `MAX_CHANNELS` | `2` |
| `MAX_MODULES` | `64` |
| `MAX_CONNECTIONS` | `256` |
| `MAX_COMMAND_QUEUE` | `1024` |
| `MAX_BEAT_TRACKS` | `16` |
| `MAX_AUDIO_SOUND_HANDLES` | `256` |
| `MAX_AUDIO_SAMPLES` | `128` |
| `MAX_SAMPLE_VOICES` | `64` |
| `MAX_SAMPLER_SLOTS` | `16` |
| `MAX_SAMPLER_VOICES` | `16` |
| `MAX_SEQUENCER_TRACKS` | `8` |
| `MAX_SEQUENCER_STEPS` | `64` |

Removal marks module/connection slots inactive but does not compact arrays or
decrement count telemetry.

## DSP Modules

`oscillator`: sine/saw/square/triangle/noise oscillator with frequency, detune,
gain, FM input, and optional positive `freq_in` override.

`filter`: simple state-variable-style lowpass/highpass/bandpass filter.

`amplifier`: mono gain stage with optional positive `gain_in` override.

`mixer`: sums four mono inputs into one mono output.

`delay`: dry/wet delay with feedback. Delay storage is preallocated globally for
eight delay modules, max two seconds each.

`envelope`: ADSR processor driven by `gate_in` and note command state.

`lfo`: control-rate waveform generator.

`clock`: Lua parity clock module with `gate_out` and audio-rate pulse output.
It supports BPM, division, swing, running state, internal transport-clocked
ticks, and external MIDI-style 24-PPQN pulses via `clockPulse`.

`sequencer`: module-level Lua parity sequencer with an 8-track x 64-step fixed
pattern matrix. It advances on `clock_in` rising edges or, when unconnected,
falls back to an internal transport clock. Every tick releases prior track
notes, triggers active steps on track targets, and pulses `gate_out`.

`sampler`: 16-slot WAV sample player. MIDI note 36 maps to slot 1 through note
51 mapping to slot 16. Playback is polyphonic, velocity-scaled, linearly
interpolated, and pitch-shifted around MIDI note 60. Looping samples stop on
`noteOff(target, note)`.

`instrument` / `pocket_voice`: generated one-shot voices for kick, snare, hat,
bass, and lead.

`custom`: reserved module type, no ports, params, or DSP implementation.

## External Sources

`framework/audio/midi.zig` ports the old Love2D ALSA sequencer input to V8. It is
Linux-only and returns unavailable elsewhere. The React `useMIDI()` hook owns a
singleton poller so multiple components do not race-drain the host event queue.
It can route note events to `useAudio().noteOn/noteOff`, map CC values onto
module params, send MIDI clock pulses into a clock module, and map MIDI
start/stop to transport play/pause.

General audio input currently reuses the voice capture backend. `useAudioInput()`
wraps that path for non-speech callers and exposes SDL recording devices, input
level, listening state, and captured utterance ids. It is not yet a full DAW
recorder or sampler source.

## Where This Lives

- `framework/audio/`: SDL device, command queue, graph, port buffers, DSP,
  mixer, timeline scheduling, sampler storage, and MIDI input.
- `framework/audio.zig`: re-export facade.
- `framework/v8_bindings_core.zig`: V8 host functions and argument conversion.
- `runtime/audio.tsx`: declarative `Audio` wrapper and `useAudio()` hook.
- `runtime/audio-controls.tsx`: visual control surfaces.
- `framework/audio/midi.zig` and `runtime/hooks/useMIDI.ts`: ALSA MIDI input and
  React routing/CC learn.
- `runtime/hooks/useAudioInput.ts`, `framework/voice.zig`, and
  `framework/v8_bindings_voice.zig`: current audio-input capture path.
- `cart/pocket_operator.tsx`: practical direct-host audio cart.

## Sharp Edges

- The declarative `Audio` wrapper does not call `__audio_init()`.
- V8 command host functions do not return queue success/failure.
- `master_gain` and many params are not clamped when command values are stored.
- Output is F32 stereo, but individual module ports are mono.
- `routeConnections()` happens before module processing, so connected graphs can
  behave one callback behind.
- Query functions such as `getParam` read live engine fields from JS without a
  snapshot protocol.
- `custom` is registered but not implemented.
- `runtime/synth.tsx` has a master-id convention that the Zig engine does not
  implement.
- `setMasterEffect` is a reserved hook-level no-op.
- `framework/audio.zig` still has stale header comments describing LuaJIT DSP.
  The active callback path is Zig DSP.
