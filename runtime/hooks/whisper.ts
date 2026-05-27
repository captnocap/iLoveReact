/**
 * runtime/hooks/whisper.ts — speech-to-text bindings for whisper.cpp.
 *
 * Importing this file is what triggers the build-time gate: scripts/ship's
 * metafile gate sees the import and flips `-Dhas-whisper=true`, which
 * compiles deps/whisper.cpp into a libwhisper.so and links it. Carts that
 * don't import this file pay zero (no extra source compiled, no .so).
 *
 * The capture-only side (useVoiceInput from runtime/hooks/useVoiceInput.ts)
 * is unaffected — you can use VAD without ever pulling in whisper.
 *
 * @example
 *   import { useVoiceInput } from '@reactjit/runtime/hooks';
 *   import { transcribe } from '@reactjit/runtime/hooks/whisper';
 *
 *   const v = useVoiceInput();
 *   useEffect(() => {
 *     if (v.utteranceId === 0) return;
 *     transcribe(v.utteranceId, '~/.reactjit/models/ggml-base.en-q5_1.bin')
 *       .then(({ text, elapsedMs }) => console.log(elapsedMs, 'ms:', text));
 *   }, [v.utteranceId]);
 */

import { callHost, hasHost } from '../ffi';
import { G as G_typed } from '../host-globals';

// Zig calls back into JS via __whisper_onResult — we assign it on globalThis
// below so the Zig dispatcher can find it.
const G = G_typed as any;

export interface TranscribeResult {
  bufId: number;
  model: string;
  text: string;
  elapsedMs: number;
  success: boolean;
}

// Shared promise table keyed by buf_id. The Zig side fires
// __whisper_onResult(json) async; we resolve the matching promise.
const pending = new Map<number, (r: TranscribeResult) => void>();

if (!G.__whisper_handlers_installed) {
  G.__whisper_handlers_installed = true;
  G.__whisper_onResult = (json: string) => {
    let r: TranscribeResult;
    try {
      const o = JSON.parse(json);
      r = {
        bufId: Number(o.buf_id) || 0,
        model: String(o.model ?? ''),
        text: String(o.text ?? ''),
        elapsedMs: Number(o.elapsed_ms) || 0,
        success: !!o.success,
      };
    } catch {
      return;
    }
    const resolve = pending.get(r.bufId);
    if (resolve) {
      pending.delete(r.bufId);
      resolve(r);
    }
  };
}

/**
 * Transcribe a finalised utterance buffer. `bufId` comes from
 * useVoiceInput's `utteranceId` (it increments on every speech-end edge).
 * `modelPath` must point to a `ggml-*.bin` file on disk; use
 * `./scripts/fetch-whisper-models` to download.
 *
 * Resolves with the transcript and timing. Multiple in-flight calls are
 * fine — each resolves when its `bufId` comes back. The whisper context
 * stays loaded across calls; switching models reloads (~1-3s once-per-
 * model) so back-to-back same-model calls are fast.
 */
export function transcribe(bufId: number, modelPath: string): Promise<TranscribeResult> {
  return new Promise<TranscribeResult>((resolve, reject) => {
    if (!hasHost('__whisper_transcribe')) {
      reject(new Error('__whisper_transcribe missing — was -Dhas-whisper=true set?'));
      return;
    }
    pending.set(bufId, resolve);
    const ok = callHost<boolean>('__whisper_transcribe', false, bufId, modelPath);
    if (!ok) {
      pending.delete(bufId);
      reject(new Error(`whisper.transcribe(${bufId}) refused — buffer missing or queue full`));
    }
  });
}
