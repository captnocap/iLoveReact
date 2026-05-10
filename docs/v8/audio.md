# V8 audio

The V8 audio docs are split by reader path.

- [audio-pipeline.md](./audio-pipeline.md): architecture, threading, command
  queue, SDL callback, graph order, DSP modules, and sharp edges.
- [audio-api.md](./audio-api.md): React wrapper, `useAudio()` behavior, host
  functions, module type ids, ports, params, and minimal working sequences.

Start with the pipeline doc when changing `framework/audio.zig`. Start with the
API doc when wiring cart code, V8 bindings, or React hooks.
