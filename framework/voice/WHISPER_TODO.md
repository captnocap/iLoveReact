# Whisper integration — next-pass plan

The voice subsystem (`framework/voice.zig` + `runtime/hooks/useVoiceInput.ts`)
is end-to-end runnable today: SDL3 mic → libfvad → utterance buffers stored
by id, with `__voice_onSpeechEnd(id, lenSamples)` firing on every confirmed
phrase. **The PCM is captured. The transcript path is the only thing missing.**

## What's reserved and ready

- `__voice_onTranscript(text)` — JS-side handler installed in `useVoiceInput`,
  reactively binds to the hook's `transcript` field. Wire whisper to call it
  from Zig and the cart updates with no JS change.
- `voice.getBuffer(id) → []const i16` — stable PCM access by id.
- `voice.releaseBuffer(id)` — exposed via `__voice_release_buffer`. Hook
  releases automatically by default; the JS option `autoRelease: false` keeps
  the buffer alive for an out-of-band transcribe call.

## Build path

1. Vendor `whisper.cpp` under `deps/whisper.cpp/` (mirror libfvad shape, but
   bigger — ggml + whisper.cpp src is ~16MB). Skip CUDA/Vulkan/Metal backends
   for the first pass; CPU-only is fine for `base.en` and `small.en`.
2. Add a `has-whisper` build option in `build.zig` analogous to `has-voice`.
   Compile whisper + ggml into the main binary only when the cart references
   `__voice_transcribe` (which is what scripts/ship-metafile-gate.js will grep
   for once a whisper-aware hook lands).
3. Add `framework/whisper.zig` — owns a single `whisper_context *`, loaded
   lazily on first `transcribe(id)` call. Path resolution: env
   `RJIT_WHISPER_MODEL` → `~/.reactjit/models/ggml-base.en-q5_1.bin` →
   download stub.
4. Add `framework/v8_bindings_whisper.zig`:
   - `__whisper_load_model(path) → bool`
   - `__whisper_transcribe(buf_id) → void` (async — fires
     `__voice_onTranscript(text)` when done)
5. Worker thread for inference. Whisper `base` is realtime-ish on CPU but
   blocking it on the engine tick will stall paint. Single worker pulling jobs
   off a small queue. On completion, queue the text and have engine tick fire
   the JS callback (mirrors how voice.tick fires events today — same thread
   discipline).
6. Optionally bolt on Silero VAD via the same path if libfvad turns out to be
   too noisy in any user's room. Whisper.cpp ships an ONNX-free Silero loader
   (added mid-2025); we'd just point it at `ggml-silero-v5.1.2.bin`.

## Why the VAD-first split

WebRTC VAD is the part that's hard to get right (libfvad with the right
debounce parameters is much better than the energy thresholds whisper.cpp's
`stream` example uses). Validating the VAD in someone's actual room before
investing in whisper integration prevents the classic "transcripts cut off
the front of every sentence" failure mode. The user explicitly flagged that
they hit this with a previous PulseAudio + whisper attempt — the bad part
was the VAD, not the mic stack.

## Cart contract that survives integration

```tsx
const v = useVoiceInput();         // unchanged today / post-whisper
v.start(); /* ... */ v.stop();
// `v.transcript` updates automatically once `__voice_onTranscript` starts firing.
```

No cart code needs to change when whisper lands.
