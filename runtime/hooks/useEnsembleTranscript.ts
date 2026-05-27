/**
 * useEnsembleTranscript — run N whisper models on each utterance and
 * vote at the word level. ROVER-style: errors across model sizes are
 * weakly correlated, so 2-of-3 majority typically beats any individual
 * model by 1-3 word-error-rate points.
 *
 * Sequential transcription (whisper holds one context; switching models
 * costs a 1-3s reload). The smallest model lands first → cart can show
 * `partial` for a fast preview; `ensemble` updates once all N finish.
 *
 * @example
 *   const e = useEnsembleTranscript({
 *     models: [
 *       { name: 'tiny',  path: '~/.reactjit/models/ggml-tiny.en-q5_1.bin' },
 *       { name: 'base',  path: '~/.reactjit/models/ggml-base.en-q5_1.bin' },
 *       { name: 'small', path: '~/.reactjit/models/ggml-small.en-q5_1.bin' },
 *     ],
 *   });
 *   // e.partial    — first model's text (live preview)
 *   // e.individual — { tiny, base, small } maps as each finishes
 *   // e.ensemble   — voted result, with per-word confidence
 *   // e.isProcessing — true while any model is still running
 */

import { useEffect, useRef, useState } from 'react';
import {
  useVoiceInput,
  subscribePreview,
  subscribeSpeechStart,
  type VoiceInputOptions,
} from './useVoiceInput';
import { transcribe } from './whisper';
import { callHost } from '../ffi';
import { useLatest } from './useLatest';

// ── Types ────────────────────────────────────────────────────────────

export interface EnsembleModel {
  name: string;
  path: string;
}

export interface EnsembleWord {
  word: string;
  /** Vote count: number of models that produced this word at this slot.
   *  Range 1..models.length. 1 = only spine, N = full agreement. */
  votes: number;
  /** Models that contributed this winning word. */
  sources: string[];
  /** All candidates at this slot — includes the winner plus losing
   *  alternatives from other models, sorted by vote count desc. Lets
   *  the cart show "verify: X|Y|Z" inline when confidence is low. */
  candidates: Array<{ word: string; sources: string[] }>;
}

export interface EnsembleResult {
  /** Voted output, slot-by-slot. */
  words: EnsembleWord[];
  /** Which model was picked as the alignment anchor. */
  anchor: string;
  /** Total number of models in this ensemble. */
  modelCount: number;
}

export interface UseEnsembleTranscriptOptions extends VoiceInputOptions {
  /** Always-run base tier — fast models that handle the common case. */
  models: EnsembleModel[];
  /** Optional escalation tier(s): only run when the base ensemble has
   *  any word with `votes < escalationThreshold`. Models run sequentially
   *  in order; each adds its vote and the ensemble is recomputed.
   *  Re-runs on the same full utterance — whisper pads <30s audio to 30s
   *  internally so a sub-clip wouldn't be faster, and full context gives
   *  the larger model its best shot at disambiguation. */
  escalateTo?: EnsembleModel[];
  /** Vote count below which an ensemble word triggers escalation.
   *  Default 2 (so any word only one model said triggers). */
  escalationThreshold?: number;
  /** Run a fast model on rolling in-flight snapshots WHILE the user is
   *  still speaking, surfacing the result as `livePreview`. Independent
   *  of the post-utterance ensemble flow — at speech-end, the ensemble
   *  still re-transcribes the full clip from scratch. Set to null to
   *  disable; defaults to `models[0]` (typically tiny — fastest, no
   *  model-swap penalty when the ensemble starts). Override to `base`
   *  for higher live-preview accuracy at the cost of one extra swap.
   *  Note: whisper's encoder runs a fixed 30s context regardless of
   *  clip length, so previews don't gain from sub-clipping — `base`
   *  on a 1s clip costs the same wallclock as base on the full
   *  utterance. */
  livePreviewModel?: EnsembleModel | null;
}

export interface UseEnsembleTranscriptResult {
  /** First model's transcript — fast preview. Empty until first model finishes. */
  partial: string;
  /** Per-model results map, populated as each model finishes. */
  individual: Record<string, string>;
  /** Voted ensemble. null until at least one model has finished. */
  ensemble: EnsembleResult | null;
  /** True while any model is still transcribing. */
  isProcessing: boolean;
  /** True while an escalation-tier model is currently running because
   *  the base ensemble had low-confidence words. */
  isEscalating: boolean;
  /** Names of escalation models that ran for the current utterance. */
  escalatedWith: string[];
  /** Live, in-flight transcript: the `livePreviewModel` running on rolling
   *  snapshots of the current utterance WHILE the user is still speaking.
   *  Cleared on each new speech-start. Empty when the live preview is
   *  disabled or no chunk has come back yet. */
  livePreview: string;
  /** Name of the live-preview model (so the cart can label it). Empty when
   *  the live preview is disabled. */
  livePreviewModelName: string;
  /** Pass-through from useVoiceInput so cart can render mic state. */
  isListening: boolean;
  isSpeaking: boolean;
  level: number;
  utteranceId: number;
  utteranceMs: number;
  start: () => boolean;
  stop: () => void;
}

// ── Tokenisation ─────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  // Lowercase, strip punctuation (keep apostrophes for contractions),
  // collapse whitespace, split. Punctuation gets reapplied by the
  // ensemble caller — voting cares about WORDS not styling.
  return text
    .toLowerCase()
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

// ── Anchor selection — median-agreement, not biggest model ──────────

function pickAnchor(tokens: string[][]): number {
  // Score each transcript by total word-set overlap with all others.
  // The transcript that "agrees most with others" makes the best spine
  // — it's typically the median-quality model, which avoids the failure
  // mode where the largest model drops a word the others have. Ties
  // break toward lower index (which tends to be smaller/faster, so
  // typically the live-preview model becomes anchor anyway).
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < tokens.length; i++) {
    let score = 0;
    for (let j = 0; j < tokens.length; j++) {
      if (i === j) continue;
      const setJ = new Set(tokens[j]);
      for (const w of tokens[i]) if (setJ.has(w)) score++;
    }
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}

// ── Voting — anchor word + ±2 window match against each other ───────

const ANCHOR_WINDOW = 2;

function voteOnAnchor(
  anchor: string[],
  others: { name: string; words: string[] }[],
  anchorName: string,
): EnsembleWord[] {
  return anchor.map((word, i) => {
    // Track all candidates seen at this slot (anchor + each non-anchor's
    // best window match, or its position-i word if no match).
    const candMap = new Map<string, string[]>();
    candMap.set(word, [anchorName]);

    const sources = [anchorName];
    for (const t of others) {
      const lo = Math.max(0, i - ANCHOR_WINDOW);
      const hi = Math.min(t.words.length, i + ANCHOR_WINDOW + 1);
      let matched: string | null = null;
      for (let j = lo; j < hi; j++) {
        if (t.words[j] === word) {
          matched = t.words[j];
          break;
        }
      }
      if (matched !== null) {
        // Aligned to anchor word — count for the winning candidate.
        sources.push(t.name);
        const list = candMap.get(matched) || [];
        if (!list.includes(t.name)) list.push(t.name);
        candMap.set(matched, list);
      } else {
        // Not aligned — this t has a different word at roughly position i,
        // record as a losing candidate so the cart can surface it.
        const alt = t.words[i] ?? t.words[Math.min(i, t.words.length - 1)];
        if (alt) {
          const list = candMap.get(alt) || [];
          if (!list.includes(t.name)) list.push(t.name);
          candMap.set(alt, list);
        }
      }
    }

    const candidates = Array.from(candMap.entries())
      .map(([w, src]) => ({ word: w, sources: src }))
      .sort((a, b) => b.sources.length - a.sources.length);
    return { word, votes: sources.length, sources, candidates };
  });
}

export function ensembleVote(
  transcripts: { name: string; text: string }[],
): EnsembleResult | null {
  if (transcripts.length === 0) return null;
  const tok = transcripts.map((t) => ({ name: t.name, words: tokenize(t.text) }));
  if (tok.every((t) => t.words.length === 0)) return null;

  // Single-model case: just echo it (every word "votes" 1 from itself).
  if (tok.length === 1) {
    return {
      words: tok[0].words.map((word) => ({
        word,
        votes: 1,
        sources: [tok[0].name],
        candidates: [{ word, sources: [tok[0].name] }],
      })),
      anchor: tok[0].name,
      modelCount: 1,
    };
  }

  const anchorIdx = pickAnchor(tok.map((t) => t.words));
  const anchor = tok[anchorIdx];
  const others = tok.filter((_, i) => i !== anchorIdx);

  return {
    words: voteOnAnchor(anchor.words, others, anchor.name),
    anchor: anchor.name,
    modelCount: tok.length,
  };
}

// ── The hook ─────────────────────────────────────────────────────────

export function useEnsembleTranscript(opts: UseEnsembleTranscriptOptions): UseEnsembleTranscriptResult {
  const { models, escalateTo, escalationThreshold, livePreviewModel, ...voiceOpts } = opts;
  // We manage the buffer lifetime ourselves — multiple transcribes need
  // the PCM to survive past the first call, so override autoRelease.
  const v = useVoiceInput({ ...voiceOpts, autoRelease: false });

  // Live-preview model: explicit null disables; `undefined` defaults to the
  // first ensemble model (no swap penalty when the ensemble starts).
  const livePreviewResolved: EnsembleModel | null =
    livePreviewModel === null
      ? null
      : livePreviewModel ?? (models[0] ?? null);

  const [partial, setPartial] = useState('');
  const [individual, setIndividual] = useState<Record<string, string>>({});
  const [ensemble, setEnsemble] = useState<EnsembleResult | null>(null);
  const [isProcessing, setProcessing] = useState(false);
  const [isEscalating, setEscalating] = useState(false);
  const [escalatedWith, setEscalatedWith] = useState<string[]>([]);
  const [livePreview, setLivePreview] = useState('');

  const lastIdRef = useRef(0);
  const modelsRef = useLatest(models);
  const escalateRef = useLatest(escalateTo);
  const thresholdRef = useLatest(escalationThreshold ?? 2);
  const liveModelRef = useLatest(livePreviewResolved);
  // Single in-flight preview at a time. Whisper's worker is sequential, so
  // queueing more would stall ensemble jobs without producing fresher
  // text — Zig keeps firing PreviewReady events; we just drop the ones
  // that arrive while the previous transcribe is still running.
  const previewBusyRef = useRef(false);
  // Generation token: when speech-start fires we bump this so any in-flight
  // preview from a prior utterance discards its result instead of
  // overwriting state for the new one.
  const previewGenRef = useRef(0);

  useEffect(() => {
    if (v.utteranceId === 0 || v.utteranceId === lastIdRef.current) return;
    lastIdRef.current = v.utteranceId;
    const id = v.utteranceId;
    const selected = modelsRef.current.slice();
    const escalation = (escalateRef.current ?? []).slice();
    const threshold = thresholdRef.current;

    // Reset per-utterance state.
    setPartial('');
    setIndividual({});
    setEnsemble(null);
    setProcessing(true);
    setEscalating(false);
    setEscalatedWith([]);

    (async () => {
      const collected: { name: string; text: string }[] = [];

      for (let i = 0; i < selected.length; i++) {
        const m = selected[i];
        try {
          const r = await transcribe(id, m.path);
          const text = (r.text || '').trim();
          collected.push({ name: m.name, text });
          // Live preview: first model = partial.
          if (i === 0) setPartial(text);
          setIndividual((prev) => ({ ...prev, [m.name]: text }));
          // Recompute ensemble after each model lands so the cart can
          // show the running consensus tightening as more models arrive.
          setEnsemble(ensembleVote(collected));
        } catch (e: any) {
          setIndividual((prev) => ({ ...prev, [m.name]: `(error: ${String(e?.message ?? e)})` }));
        }
      }

      // Escalation: if any word in the base ensemble has fewer than
      // `threshold` votes, run the next-tier model on the same buffer
      // and add its vote. The full utterance gets re-transcribed because
      // whisper internally pads <30s audio to 30s anyway, and the
      // larger model needs full context to disambiguate technical terms.
      if (escalation.length > 0) {
        const baseEnsemble = ensembleVote(collected);
        const anyLow =
          baseEnsemble &&
          baseEnsemble.words.some((w) => w.votes < threshold);
        if (anyLow) {
          setEscalating(true);
          for (const m of escalation) {
            try {
              const r = await transcribe(id, m.path);
              const text = (r.text || '').trim();
              collected.push({ name: m.name, text });
              setIndividual((prev) => ({ ...prev, [m.name]: text }));
              setEscalatedWith((prev) => [...prev, m.name]);
              setEnsemble(ensembleVote(collected));
              // If the escalated ensemble cleared every threshold,
              // we can stop early — no need to keep escalating.
              const updated = ensembleVote(collected);
              if (updated && updated.words.every((w) => w.votes >= threshold)) {
                break;
              }
            } catch (e: any) {
              setIndividual((prev) => ({
                ...prev,
                [m.name]: `(error: ${String(e?.message ?? e)})`,
              }));
            }
          }
          setEscalating(false);
        }
      }

      // Release the buffer now that all models are done.
      callHost('__voice_release_buffer', undefined, id);
      setProcessing(false);
    })();
  }, [v.utteranceId]);

  // Live-preview pipeline. Two subscriptions:
  //   - speech-start clears the previous utterance's livePreview so the
  //     new utterance starts blank instead of showing stale text until
  //     the first chunk lands;
  //   - preview-ready kicks off a transcribe with the live model on the
  //     in-flight snapshot, dropping the event if a prior preview is
  //     still running.
  // Both are no-ops when livePreviewModel is null.
  useEffect(() => {
    if (liveModelRef.current === null) return;

    const offStart = subscribeSpeechStart(() => {
      previewGenRef.current += 1;
      setLivePreview('');
    });

    const offPreview = subscribePreview(({ id }) => {
      const liveModel = liveModelRef.current;
      if (liveModel === null) {
        callHost('__voice_release_buffer', undefined, id);
        return;
      }
      if (previewBusyRef.current) {
        // Already running a preview — drop this snapshot to avoid
        // queueing behind the worker. The next stride will fire another.
        callHost('__voice_release_buffer', undefined, id);
        return;
      }
      previewBusyRef.current = true;
      const myGen = previewGenRef.current;
      transcribe(id, liveModel.path)
        .then((r) => {
          // Discard if a new utterance started while this was running.
          if (myGen === previewGenRef.current) {
            const text = (r.text || '').trim();
            if (text) setLivePreview(text);
          }
        })
        .catch(() => { /* swallow — live preview is best-effort */ })
        .finally(() => {
          callHost('__voice_release_buffer', undefined, id);
          previewBusyRef.current = false;
        });
    });

    return () => {
      offStart();
      offPreview();
    };
  }, [livePreviewResolved?.path ?? '']);

  return {
    partial,
    individual,
    ensemble,
    isProcessing,
    isEscalating,
    escalatedWith,
    livePreview,
    livePreviewModelName: livePreviewResolved?.name ?? '',
    isListening: v.isListening,
    isSpeaking: v.isSpeaking,
    level: v.level,
    utteranceId: v.utteranceId,
    utteranceMs: v.utteranceMs,
    start: v.start,
    stop: v.stop,
  };
}
