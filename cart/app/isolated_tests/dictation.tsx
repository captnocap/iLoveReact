/**
 * dictation.tsx — voice-to-text via 3-model ROVER ensemble.
 *
 * Speak a phrase; watch tiny lay down a fast preview, then the ensemble
 * tightens up as base and small finish. Words are coloured by vote
 * count: dimmer = less confidence, brighter = full agreement.
 *
 * Setup:
 *   ./scripts/fetch-whisper-models             # tiny + base + small
 *   ./scripts/dev dictation
 */

import { useEffect, useState } from 'react';
import { Box, Row, Col, Text, Pressable, ScrollView } from '@reactjit/runtime/primitives';
import { useEnsembleTranscript } from '@reactjit/runtime/hooks/useEnsembleTranscript';
import * as fs from '@reactjit/runtime/hooks/fs';
import * as http from '@reactjit/runtime/hooks/fetch';
import * as process from '@reactjit/runtime/hooks/process';

const C = {
  bg: '#08090d',
  surface: '#11141d',
  surfaceHi: '#181c28',
  border: '#222637',
  text: '#e7eaf3',
  dim: '#7a8294',
  amp: '#7dd3fc',
  vad: '#22c55e',
  hot: '#fb7185',
  warn: '#fbbf24',
};

// Vote-count → text shade. With 3 models: 1 = low confidence, 3 = full
// agreement. Dim words signal "verify this; only one model said it."
const SHADES = ['#475569', '#94a3b8', '#cbd5e1', '#f8fafc'];

// Consensus → colour mapping. Low-confidence words pop visually so the
// reader can spot likely hallucinations at a glance.
function consensusColor(votes: number, max: number): string {
  const ratio = votes / max;
  if (ratio >= 0.99) return '#f8fafc';        // full agreement → bright white
  if (ratio >= 0.66) return '#cbd5e1';        // strong → light grey
  if (ratio >= 0.5) return '#fbbf24';         // mid → amber (verify)
  return '#fb7185';                           // weak → rose (probably wrong)
}

interface WordCandidate { word: string; sources: string[] }

function EnsembleWordView({
  word, votes, candidates, max, fontSize = 18,
}: {
  word: string;
  votes: number;
  candidates: WordCandidate[];
  max: number;
  fontSize?: number;
}) {
  const color = consensusColor(votes, max);
  const isLow = votes < max;
  // Show alternates only when the winning slot didn't sweep AND there are
  // actually losing candidates with different words.
  const losers = candidates.filter((c) => c.word !== word);
  const showAlts = isLow && losers.length > 0;
  return (
    <Row style={{ alignItems: 'baseline', gap: 4 }}>
      <Text fontSize={fontSize} color={color}>{word}</Text>
      {showAlts && (
        <Row style={{ alignItems: 'baseline', gap: 2 }}>
          <Text fontSize={Math.max(10, fontSize - 8)} color={C.dim}>(</Text>
          {losers.map((c, i) => (
            <Row key={c.word + i} style={{ alignItems: 'baseline' }}>
              {i > 0 && <Text fontSize={Math.max(10, fontSize - 8)} color={C.dim}>|</Text>}
              <Text fontSize={Math.max(10, fontSize - 8)} color={C.dim}>{c.word}</Text>
            </Row>
          ))}
          <Text fontSize={Math.max(10, fontSize - 8)} color={C.dim}>)</Text>
        </Row>
      )}
    </Row>
  );
}

// Model registry: filename + HuggingFace URL + approx size for the
// download UI. URLs from https://huggingface.co/ggerganov/whisper.cpp.
// medium.en only has q5_0 on HF (q5_1 returns 404), so it's hardcoded.
const HF_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

interface ModelDef {
  name: string;
  filename: string;
  approxBytes: number;
}

const MODEL_REGISTRY: ModelDef[] = [
  { name: 'tiny',   filename: 'ggml-tiny.en-q5_1.bin',   approxBytes:  31 * 1024 * 1024 },
  { name: 'base',   filename: 'ggml-base.en-q5_1.bin',   approxBytes:  58 * 1024 * 1024 },
  { name: 'small',  filename: 'ggml-small.en-q5_1.bin',  approxBytes: 190 * 1024 * 1024 },
  { name: 'medium', filename: 'ggml-medium.en-q5_0.bin', approxBytes: 514 * 1024 * 1024 },
];

const BASE_TIER = ['tiny', 'base', 'small'];
const ESCALATION_TIER = ['medium'];

function modelPath(name: string): string {
  const def = MODEL_REGISTRY.find((m) => m.name === name)!;
  return `~/.reactjit/models/${def.filename}`;
}

function modelUrl(name: string): string {
  const def = MODEL_REGISTRY.find((m) => m.name === name)!;
  return `${HF_BASE}/${def.filename}`;
}

const MODELS = BASE_TIER.map((name) => ({ name, path: modelPath(name) }));
const ESCALATION = ESCALATION_TIER.map((name) => ({ name, path: modelPath(name) }));

interface SavedUtterance {
  id: number;
  ms: number;
  individual: Record<string, string>;
  ensembleWords: import('../runtime/hooks/useEnsembleTranscript').EnsembleWord[];
  anchor: string;
  modelCount: number;
  escalatedWith: string[];
}

// ── Pre-flight: check models on disk, download missing ones inline ─

function expandHome(p: string): string {
  if (!p.startsWith('~/')) return p;
  const home = process.envGet('HOME') ?? '';
  return home + p.slice(1);
}

interface DownloadState {
  bytes: number;
  total: number;
  done: boolean;
  err?: string;
}

function DownloadGate({ onReady }: { onReady: () => void }) {
  // All models the cart wants — base tier + escalation. Only download
  // what's missing; existing files are untouched.
  const allModels = [...MODELS, ...ESCALATION];
  const [missing, setMissing] = useState<typeof allModels | null>(null);
  const [progress, setProgress] = useState<Record<string, DownloadState>>({});
  const [running, setRunning] = useState(false);

  // First pass: stat each path. Anything missing goes in the missing list.
  useEffect(() => {
    const missList = allModels.filter((m) => !fs.exists(expandHome(m.path)));
    setMissing(missList);
    if (missList.length === 0) onReady();
  }, []);

  if (missing === null) {
    return (
      <Col style={{ width: '100%', height: '100%', backgroundColor: C.bg, padding: 18, justifyContent: 'center', alignItems: 'center' }}>
        <Text fontSize={12} color={C.dim}>checking models…</Text>
      </Col>
    );
  }

  const totalApprox = missing.reduce((s, m) => {
    const def = MODEL_REGISTRY.find((d) => d.name === m.name);
    return s + (def?.approxBytes ?? 0);
  }, 0);

  const startDownload = async () => {
    setRunning(true);
    // Make sure ~/.reactjit/models exists. fs.mkdir creates parents.
    fs.mkdir(expandHome('~/.reactjit/models'));

    for (const m of missing) {
      const url = modelUrl(m.name);
      const dest = expandHome(m.path);
      setProgress((prev) => ({ ...prev, [m.name]: { bytes: 0, total: 0, done: false } }));
      try {
        await http.download({
          url,
          destPath: dest,
          onProgress: ({ bytes, total }) => {
            setProgress((prev) => ({ ...prev, [m.name]: { bytes, total, done: false } }));
          },
        });
        setProgress((prev) => ({ ...prev, [m.name]: { ...prev[m.name], done: true } }));
      } catch (e: any) {
        setProgress((prev) => ({
          ...prev,
          [m.name]: { ...prev[m.name], done: false, err: String(e?.message ?? e) },
        }));
      }
    }

    // Verify all present now.
    const stillMissing = allModels.filter((m) => !fs.exists(expandHome(m.path)));
    if (stillMissing.length === 0) {
      onReady();
    } else {
      setMissing(stillMissing);
      setRunning(false);
    }
  };

  const fmtMb = (n: number) => `${(n / 1024 / 1024).toFixed(0)} MB`;

  return (
    <Col style={{ width: '100%', height: '100%', backgroundColor: C.bg, padding: 24, gap: 18 }}>
      <Col style={{ gap: 6 }}>
        <Text fontSize={20} color={C.text}>Whisper models needed</Text>
        <Text fontSize={12} color={C.dim}>
          Voice-to-text uses local whisper.cpp models. {missing.length} of {allModels.length} aren't on disk yet.
          They live in ~/.reactjit/models/ and only need to be fetched once.
        </Text>
      </Col>

      <Col style={{
        gap: 10, padding: 16, backgroundColor: C.surface,
        borderRadius: 10, borderWidth: 1, borderColor: C.border,
      }}>
        {missing.map((m) => {
          const def = MODEL_REGISTRY.find((d) => d.name === m.name)!;
          const p = progress[m.name];
          const ratio = p && p.total > 0 ? p.bytes / p.total : (p ? Math.min(1, p.bytes / def.approxBytes) : 0);
          return (
            <Col key={m.name} style={{ gap: 4 }}>
              <Row style={{ gap: 8, alignItems: 'baseline' }}>
                <Text fontSize={13} color={C.text} style={{ width: 80 }}>{m.name}</Text>
                <Text fontSize={10} color={C.dim} style={{ width: 80 }}>{fmtMb(def.approxBytes)}</Text>
                {p?.err && <Text fontSize={10} color={C.hot}>{p.err}</Text>}
                {p?.done && <Text fontSize={10} color={C.vad}>done</Text>}
                {p && !p.done && !p.err && (
                  <Text fontSize={10} color={C.dim}>
                    {`${fmtMb(p.bytes)}${p.total > 0 ? ` / ${fmtMb(p.total)}` : ''}`}
                  </Text>
                )}
              </Row>
              <Box style={{ height: 6, backgroundColor: C.surfaceHi, borderRadius: 3, overflow: 'hidden' }}>
                <Box style={{
                  height: 6,
                  width: `${Math.round(ratio * 100)}%`,
                  backgroundColor: p?.done ? C.vad : (p?.err ? C.hot : C.amp),
                }} />
              </Box>
            </Col>
          );
        })}
      </Col>

      <Pressable
        onPress={startDownload}
        disabled={running}
        style={{
          height: 48,
          borderRadius: 8,
          backgroundColor: running ? C.surfaceHi : C.amp,
          borderWidth: 1,
          borderColor: running ? C.border : C.amp,
          justifyContent: 'center',
          alignItems: 'center',
          opacity: running ? 0.6 : 1,
        }}
      >
        <Text fontSize={13} color={running ? C.dim : '#0b1220'}>
          {running
            ? 'downloading…'
            : `download ${missing.length} model${missing.length === 1 ? '' : 's'} (~${fmtMb(totalApprox)})`}
        </Text>
      </Pressable>

      <Text fontSize={10} color={C.dim}>
        Source: huggingface.co/ggerganov/whisper.cpp · once downloaded, this prompt won't appear again.
      </Text>
    </Col>
  );
}

// ── Core dictation experience (renders only after models are present) ─

function DictationCore() {
  const [armed, setArmed] = useState(false);
  const [history, setHistory] = useState<SavedUtterance[]>([]);

  const e = useEnsembleTranscript({
    models: MODELS,
    escalateTo: ESCALATION,
    escalationThreshold: 2,
    mode: 1,
    floor: 0.333,
    // Live preview: while the user is mid-utterance, the Zig side fires a
    // snapshot every previewStrideMs into a stable buffer; we feed it to
    // base.en for a "watch it transcribe as I talk" UX. tiny is faster
    // (no swap penalty when the ensemble starts) but base picks up
    // punctuation and is what the user wants to see live.
    livePreviewModel: { name: 'base', path: modelPath('base') },
    previewStrideMs: 1500,
  });

  // Snapshot completed utterances so they don't get clobbered when the
  // hook resets for the next phrase.
  useEffect(() => {
    if (e.isProcessing) return;
    if (!e.ensemble) return;
    if (e.utteranceId === 0) return;
    if (history.some((h) => h.id === e.utteranceId)) return;
    setHistory((prev) => [{
      id: e.utteranceId,
      ms: e.utteranceMs,
      individual: { ...e.individual },
      ensembleWords: e.ensemble!.words.slice(),
      anchor: e.ensemble!.anchor,
      modelCount: e.ensemble!.modelCount,
      escalatedWith: e.escalatedWith.slice(),
    }, ...prev].slice(0, 6));
  }, [e.isProcessing, e.utteranceId]);

  return (
    <Col style={{ width: '100%', height: '100%', backgroundColor: C.bg, padding: 18, gap: 14 }}>

      <Col style={{ gap: 4 }}>
        <Text fontSize={18} color={C.text}>Dictation — 3-model ensemble</Text>
        <Text fontSize={11} color={C.dim}>
          Speak a phrase. tiny lays down a fast preview, then base and small vote on each word.
          Brighter words = more model agreement. Dim words mean only one model produced them.
        </Text>
      </Col>

      <Pressable
        onPress={() => {
          if (armed) e.stop();
          else e.start();
          setArmed((x) => !x);
        }}
        style={{
          height: 48,
          borderRadius: 8,
          backgroundColor: armed ? C.vad : C.surfaceHi,
          borderWidth: 1,
          borderColor: armed ? C.vad : C.border,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Text fontSize={13} color={armed ? '#0b1220' : C.text}>
          {armed ? '◉ listening — speak, then pause' : '○ tap to start dictating'}
        </Text>
      </Pressable>

      <Row style={{ gap: 8, alignItems: 'center' }}>
        <Box style={{
          paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
          backgroundColor: e.isSpeaking ? C.vad : C.surfaceHi,
          borderWidth: 1, borderColor: e.isSpeaking ? C.vad : C.border,
        }}>
          <Text fontSize={10} color={e.isSpeaking ? '#0b1220' : C.dim}>
            {e.isSpeaking ? 'speaking' : 'silent'}
          </Text>
        </Box>
        {e.isProcessing && !e.isEscalating && (
          <Box style={{
            paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
            backgroundColor: C.warn, borderWidth: 1, borderColor: C.warn,
          }}>
            <Text fontSize={10} color="#0b1220">transcribing…</Text>
          </Box>
        )}
        {e.isEscalating && (
          <Box style={{
            paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
            backgroundColor: C.hot, borderWidth: 1, borderColor: C.hot,
          }}>
            <Text fontSize={10} color="#0b1220">↑ escalating to medium</Text>
          </Box>
        )}
        {e.escalatedWith.length > 0 && !e.isProcessing && (
          <Text fontSize={10} color={C.dim}>{`(escalated: ${e.escalatedWith.join(', ')})`}</Text>
        )}
        <Text fontSize={10} color={C.dim}>{`level=${e.level.toFixed(2)}`}</Text>
      </Row>

      {/* Live preview row. Two phases:
            - while speaking: livePreview (base.en on rolling chunks);
            - after speech-end: ensemble overrides as models land. */}
      <Col style={{
        gap: 10,
        padding: 16,
        backgroundColor: C.surface,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: C.border,
        minHeight: 110,
      }}>
        <Row style={{ gap: 8, alignItems: 'baseline' }}>
          <Text fontSize={10} color={C.dim}>live</Text>
          {e.isSpeaking && e.livePreview && (
            <Text fontSize={9} color={C.amp}>{`◉ ${e.livePreviewModelName} preview`}</Text>
          )}
        </Row>
        {e.isSpeaking && e.livePreview && !e.ensemble ? (
          // Mid-utterance, base has produced a chunk: show it in amber so
          // the user knows it's a preview, not the final answer.
          <Text fontSize={18} color={C.warn}>{e.livePreview}</Text>
        ) : e.ensemble ? (
          <Row style={{ flexWrap: 'wrap', gap: 8 }}>
            {e.ensemble.words.map((w, i) => (
              <EnsembleWordView
                key={i}
                word={w.word}
                votes={w.votes}
                candidates={w.candidates}
                max={e.ensemble!.modelCount}
                fontSize={18}
              />
            ))}
          </Row>
        ) : e.partial ? (
          <Text fontSize={18} color={SHADES[1]}>{e.partial}</Text>
        ) : e.livePreview ? (
          <Text fontSize={18} color={C.warn}>{e.livePreview}</Text>
        ) : (
          <Text fontSize={14} color={C.dim}>
            {armed ? '— waiting for speech —' : '— tap to start, then say something —'}
          </Text>
        )}

        {e.ensemble && (
          <Row style={{ gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            {Object.entries(e.individual).map(([name, text]) => (
              <Row key={name} style={{ gap: 6, alignItems: 'baseline' }}>
                <Text fontSize={9} color={C.dim} style={{ width: 36 }}>{name}</Text>
                <Text fontSize={11} color={C.dim} fontFamily="monospace">{text || '…'}</Text>
              </Row>
            ))}
            <Text fontSize={9} color={C.dim}>{`anchor=${e.ensemble.anchor}`}</Text>
          </Row>
        )}
      </Col>

      {/* History */}
      <Col style={{
        flexGrow: 1,
        gap: 0,
        padding: 14,
        backgroundColor: C.surface,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: C.border,
      }}>
        <Text fontSize={10} color={C.dim} style={{ marginBottom: 8 }}>history</Text>
        <ScrollView style={{ flexGrow: 1 }}>
          {history.length === 0 ? (
            <Text fontSize={11} color={C.dim}>— nothing yet —</Text>
          ) : history.map((h) => (
            <Col key={h.id} style={{
              gap: 6,
              padding: 12,
              marginBottom: 8,
              backgroundColor: C.bg,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: C.border,
            }}>
              <Row style={{ flexWrap: 'wrap', gap: 6 }}>
                {h.ensembleWords.map((w, i) => (
                  <EnsembleWordView
                    key={i}
                    word={w.word}
                    votes={w.votes}
                    candidates={w.candidates}
                    max={h.modelCount}
                    fontSize={14}
                  />
                ))}
              </Row>
              <Row style={{ gap: 14, flexWrap: 'wrap' }}>
                {Object.entries(h.individual).map(([name, text]) => (
                  <Row key={name} style={{ gap: 6, alignItems: 'baseline' }}>
                    <Text fontSize={9} color={C.dim} style={{ width: 36 }}>{name}</Text>
                    <Text fontSize={10} color={C.dim} fontFamily="monospace">{text}</Text>
                  </Row>
                ))}
                <Text fontSize={9} color={C.dim}>
                  {`#${h.id} · ${h.ms.toFixed(0)}ms · anchor=${h.anchor}${h.escalatedWith.length ? ` · ↑${h.escalatedWith.join(',')}` : ''}`}
                </Text>
              </Row>
            </Col>
          ))}
        </ScrollView>
      </Col>

    </Col>
  );
}

// ── Top-level entry: gate on models, then render core ─────────────

export default function Dictation() {
  const [ready, setReady] = useState(false);
  if (!ready) return <DownloadGate onReady={() => setReady(true)} />;
  return <DictationCore />;
}
