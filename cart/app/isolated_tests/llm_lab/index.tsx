// llm_lab — local text-generation, end-to-end through the unified
// worker contract (useAssistant → __worker_* → local_ai_runtime).
//
// What it validates:
//   1. framework/local_ai_runtime.zig dlopen's a llama.cpp backend at
//      runtime (default: ROCm; override RJIT_LLM_BACKEND).
//   2. The HIP runtime path coexists with the renderer's Vulkan/wgpu
//      stack — no VkInstance contention, no killed model-load.
//   3. The unified WorkerEvent stream surfaces token-by-token deltas.
//
// Edit MODEL_PATH to swap models. (Pre-Phase-1 the cart had a runtime
// picker; the unified contract locks a worker to its first opts and
// doesn't yet support swap-on-the-fly.)

import { useEffect, useRef, useState } from 'react';
import { Box, Row, Col, Text, Pressable, ScrollView, TextInput } from '@reactjit/runtime/primitives';
import { useAssistant } from '@reactjit/runtime/hooks/useAssistant';
import { callHost, hasHost } from '@reactjit/runtime/ffi';

const MODEL_PATH = '/home/siah/.lmstudio/models/OBLITERATUS/gemma-4-E4B-it-OBLITERATED/gemma-4-E4B-it-OBLITERATED-Q8_0.gguf';

const C = {
  bg: '#0d1117',
  surface: '#161b22',
  surface2: '#21262d',
  border: '#30363d',
  text: '#e6edf3',
  dim: '#7d8590',
  accent: '#2f81f7',
  good: '#3fb950',
  warn: '#d29922',
  err: '#f85149',
};

function processCwd(): string {
  if (hasHost('__cwd')) {
    try {
      const v = callHost<string>('__cwd', '');
      if (typeof v === 'string' && v.length > 0) return v;
    } catch { /* ignore */ }
  }
  if (hasHost('__env')) {
    try {
      const home = callHost<string>('__env', '', 'HOME');
      if (typeof home === 'string' && home.length > 0) return home;
    } catch { /* ignore */ }
  }
  return '/tmp';
}

export default function LlmLab() {
  const cwd = processCwd();
  const assistant = useAssistant({
    backend: 'local_ai',
    cwd,
    modelPath: MODEL_PATH,
    nCtx: 2048,
    persistAcrossUnmount: true,
  });

  const [prompt, setPrompt] = useState('Say something weirdly profound in under 15 words.');
  const [streaming, setStreaming] = useState('');
  const [reply, setReply] = useState('');
  const [askMs, setAskMs] = useState(0);
  const t0Ref = useRef(0);
  const cursorRef = useRef(0);
  const accumRef = useRef('');

  // Drain new events: accumulate assistant text, finalize on completion.
  useEffect(() => {
    if (assistant.events.length <= cursorRef.current) return;
    let liveStreaming = streaming;
    for (let i = cursorRef.current; i < assistant.events.length; i++) {
      const ev = assistant.events[i];
      if (ev.kind === 'assistant_message' && typeof ev.text === 'string') {
        accumRef.current += ev.text;
        liveStreaming = accumRef.current;
      } else if (ev.kind === 'completion') {
        setReply(accumRef.current);
        setAskMs(Date.now() - t0Ref.current);
        accumRef.current = '';
        liveStreaming = '';
      } else if (ev.kind === 'error_') {
        setReply(`error: ${ev.text || 'worker error'}`);
        accumRef.current = '';
        liveStreaming = '';
      }
    }
    cursorRef.current = assistant.events.length;
    setStreaming(liveStreaming);
  }, [assistant.events]);

  function handleAsk() {
    if (!assistant.ready()) return;
    setReply('');
    setStreaming('');
    accumRef.current = '';
    t0Ref.current = Date.now();
    setAskMs(0);
    assistant.ask(prompt);
  }

  const status = assistant.error
    ? `error: ${assistant.error}`
    : `${assistant.phase}`;
  const dot = assistant.error
    ? C.err
    : assistant.ready()
      ? C.good
      : C.warn;

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: C.bg, flexDirection: 'column' } as any}>
      <Row
        style={{
          backgroundColor: C.surface,
          borderBottomWidth: 1,
          borderBottomColor: C.border,
          padding: 16,
          alignItems: 'center',
          justifyContent: 'space-between',
        } as any}
      >
        <Col>
          <Text style={{ color: C.text, fontSize: 16, fontWeight: 600 } as any}>LLM Lab</Text>
          <Text style={{ color: C.dim, fontSize: 12 } as any}>
            local_ai backend through useAssistant · {MODEL_PATH.split('/').pop()}
          </Text>
        </Col>
        <Row style={{ alignItems: 'center', gap: 8 } as any}>
          <Box style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot } as any} />
          <Text style={{ color: C.dim, fontSize: 12 } as any}>{status}</Text>
        </Row>
      </Row>

      <Col style={{ flexGrow: 1, padding: 24, gap: 16 } as any}>
        <Col style={{ gap: 6 } as any}>
          <Text style={{ color: C.dim, fontSize: 12 } as any}>Prompt</Text>
          <TextInput
            value={prompt}
            onChange={setPrompt}
            style={{
              backgroundColor: C.surface2,
              color: C.text,
              borderWidth: 1,
              borderColor: C.border,
              paddingLeft: 10,
              paddingRight: 10,
              paddingTop: 8,
              paddingBottom: 8,
              fontSize: 13,
              height: 36,
            } as any}
          />
          <Row style={{ gap: 8 } as any}>
            <Pressable
              onPress={handleAsk}
              style={{
                backgroundColor: assistant.ready() ? C.accent : C.surface,
                paddingLeft: 16,
                paddingRight: 16,
                paddingTop: 8,
                paddingBottom: 8,
                borderRadius: 6,
              } as any}
            >
              <Text style={{ color: assistant.ready() ? '#fff' : C.dim, fontSize: 13, fontWeight: 600 } as any}>
                {assistant.phase === 'streaming' ? 'Generating…' : 'Ask'}
              </Text>
            </Pressable>
            {askMs > 0 ? (
              <Text style={{ color: C.dim, fontSize: 12, alignSelf: 'center' } as any}>
                last reply: {askMs} ms
              </Text>
            ) : null}
          </Row>
        </Col>

        <Col
          style={{
            backgroundColor: C.surface,
            borderWidth: 1,
            borderColor: C.border,
            borderRadius: 8,
            padding: 16,
            gap: 8,
            flexGrow: 1,
            minHeight: 0,
          } as any}
        >
          <Text style={{ color: C.text, fontSize: 13, fontWeight: 600 } as any}>Output</Text>
          <ScrollView style={{ flexGrow: 1, minHeight: 0 } as any}>
            <Text style={{ color: C.text, fontSize: 13 } as any}>
              {assistant.phase === 'streaming' ? streaming : reply || '(awaiting first ask)'}
            </Text>
          </ScrollView>
        </Col>
      </Col>
    </Box>
  );
}
