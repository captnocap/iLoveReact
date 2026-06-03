// assist3d/Assist3DRoute — the /assist3d overlay route.
//
// The loop: you prompt the assistant → it authors the whole scene to
// assist3d/scene.json → useAssistScene hot-reloads it into the center <Scene3D> →
// click any mesh (ray-pick) or pick it from the tree → comment on the selected
// piece to send a mesh-scoped edit back. The Objects explorer reads the SAME scene
// file, so generated meshes show up there too.
//
// The backend is swappable (BackendBar): Claude writes the file itself; HTTP /
// local-GGUF models call a set_scene tool and useSceneAssistant writes the file.
// The route doesn't care which — it just calls sa.send(text).
//
// Themed through accentFor() so it sits inside the editor's skin.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Row, Col, Text, Pressable, ScrollView, TextInput } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import { type WorkerEvent } from '@reactjit/hooks/useAssistant';
import { accentFor } from '../studio.cls';
import { round } from './scene';
import { useAssistScene } from './useAssistScene';
import { SceneSurface } from './SceneSurface';
import { useSceneAssistant } from './useSceneAssistant';
import { BackendBar } from './BackendBar';
import { BACKEND_LABELS, DEFAULT_CONFIG, type Backend, type BackendConfig } from './backends';
import { loadModelHistory, rememberModelPath, forgetModelPath } from './modelHistory';

interface Block { tag: string; text: string; color: string; ts: number; dim?: boolean }

// Clean a message for display: strip harmony / chat-template control tokens
// (Qwen3 streams <|channel|>, <|message|>…) and collapse an emitted scene JSON
// to a marker so the transcript shows the resolution, not a wall of JSON.
function cleanForDisplay(raw: string): string {
  let t = raw.replace(/<\|[^|]*\|>/g, ' ');
  if (t.indexOf('"meshes"') >= 0) {
    t = t.replace(/```(?:json)?[\s\S]*?```/gi, ' ✓ scene written ');
    if (t.indexOf('"meshes"') >= 0) {
      const open = t.indexOf('{'), close = t.lastIndexOf('}');
      if (open >= 0 && close > open) t = t.slice(0, open) + ' ✓ scene written ' + t.slice(close + 1);
    }
  }
  return t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// Coalesce the worker's event stream into transcript blocks. Local backends stream
// one assistant_message per TOKEN, so consecutive assistant/reasoning events are
// merged into a single growing bubble (the fix for "every word on its own line").
// user_message events are dropped (tool_result echoes + the preamble); your prompts
// come from the local list instead.
function buildTranscript(events: WorkerEvent[], assistantTag: string): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  const flush = () => { if (cur) { blocks.push(cur); cur = null; } };
  for (const ev of events) {
    const ts = ev.created_at_ms || 0;
    if (ev.kind === 'assistant_message') {
      if (cur && cur.tag === assistantTag) cur.text += ev.text ?? '';
      else { flush(); cur = { tag: assistantTag, text: ev.text ?? '', color: accentFor('info'), ts }; }
    } else if (ev.kind === 'reasoning') {
      if (cur && cur.tag === 'thinking') cur.text += ev.text ?? '';
      else { flush(); cur = { tag: 'thinking', text: ev.text ?? '', color: accentFor('textFaint'), ts, dim: true }; }
    } else if (ev.kind === 'tool_call') {
      flush(); blocks.push({ tag: 'tool', text: 'writing scene…', color: accentFor('warning'), ts });
    } else if (ev.kind === 'error_') {
      flush(); blocks.push({ tag: 'error', text: ev.text || ev.status_text || 'error', color: accentFor('error'), ts });
    } else if (ev.kind === 'completion') {
      flush(); blocks.push({ tag: 'done', text: '— turn complete —', color: accentFor('textFaint'), ts, dim: true });
    }
  }
  flush();
  return blocks;
}

export function Assist3DRoute(props: { onBack: () => void }) {
  const { scene, loadErr, reloads, scenePath } = useAssistScene();

  // ── selection ── (camera + drag/pick live in the memo'd SceneSurface, so
  // orbiting never re-renders this route's streaming chat log)
  const [selected, setSelected] = useState<number | null>(null);
  const selMesh = selected != null ? scene.meshes[selected] : null;
  useEffect(() => { setSelected((cur) => (cur != null && cur < scene.meshes.length ? cur : null)); }, [scene]);
  // stable identity so SceneSurface's memo holds while the chat streams
  const onPick = useCallback((i: number | null) => setSelected(i), []);

  // ── assistant (swappable backend) ──
  const [config, setConfig] = useState<BackendConfig>(DEFAULT_CONFIG.claude_code);
  // remember each backend's edited config so switching away and back keeps it
  const savedRef = useRef<Record<Backend, BackendConfig>>({ ...DEFAULT_CONFIG });
  const pickBackend = (b: Backend) => {
    savedRef.current[config.backend] = config;
    setConfig(savedRef.current[b]);
  };
  const patchConfig = (patch: Partial<BackendConfig>) => setConfig((c) => ({ ...c, ...patch }));

  // Recently-used local .gguf paths (persisted), so you pick instead of paste.
  const [modelHistory, setModelHistory] = useState<string[]>(() => loadModelHistory());

  const sa = useSceneAssistant({ config, scenePath });

  const [input, setInput] = useState('');
  const inputRef = useRef(''); inputRef.current = input;
  const [comment, setComment] = useState('');
  const commentRef = useRef(''); commentRef.current = comment;
  const [myPrompts, setMyPrompts] = useState<{ text: string; ts: number }[]>([]);

  const sendToAssistant = (modelText: string, displayText: string): boolean => {
    if (!sa.send(modelText)) return false;
    setMyPrompts((p) => [...p, { text: displayText, ts: Date.now() }]);
    // a successfully-used local model earns its spot in the recents
    if (config.backend === 'local_ai' && config.modelPath) setModelHistory(rememberModelPath(config.modelPath));
    return true;
  };
  const submit = () => {
    const text = inputRef.current.trim();
    if (text && sendToAssistant(text, text)) setInput('');
  };
  const sendComment = () => {
    const c = commentRef.current.trim();
    const m = selMesh;
    if (!c || !m) return;
    const target = `the mesh whose id is "${m.id}" (a ${m.geometry} at position [${m.position.map(round).join(', ')}], material ${m.material})`;
    const modelText = `In the scene file, ${c.replace(/\.$/, '')} — applied to ${target}. Keep the rest of the scene unchanged unless the change requires it.`;
    if (sendToAssistant(modelText, `↳ ${m.id}: ${c}`)) setComment('');
  };

  // The label for assistant bubbles — the actual model, not always "claude".
  const assistantTag = useMemo(() => {
    if (config.backend === 'claude_code') return 'claude';
    if (config.backend === 'openai_compat') return (config.model || 'model').toLowerCase();
    const base = (config.modelPath || '').split('/').pop() || 'local';
    return base.replace(/\.gguf$/i, '').toLowerCase().slice(0, 22);
  }, [config]);

  const transcript = useMemo(() => {
    const blocks = buildTranscript(sa.events, assistantTag);
    for (const p of myPrompts) blocks.push({ tag: 'you', text: p.text, color: accentFor('text'), ts: p.ts });
    blocks.sort((a, b) => a.ts - b.ts);
    return blocks;
  }, [sa.events, myPrompts, assistantTag]);
  const transcriptRef = useRef<any>(null);
  useEffect(() => { try { transcriptRef.current?.scrollToEnd?.(); } catch { /* ignore */ } }, [transcript.length]);

  const phaseColor = sa.error ? accentFor('error')
    : sa.phase === 'streaming' ? accentFor('warning')
    : sa.phase === 'idle' ? accentFor('success') : accentFor('textFaint');
  const streaming = sa.phase === 'streaming';

  const BG = accentFor('bg'), PANEL = accentFor('bgAlt'), BORDER = accentFor('border');
  const INK = accentFor('text'), DIM = accentFor('textDim'), FAINT = accentFor('textFaint');
  const ACCENT = accentFor('primary');

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: BG, flexDirection: 'column' }}>
      {/* header */}
      <Row style={{ backgroundColor: accentFor('surface'), borderColor: BORDER, borderBottomWidth: 1, paddingTop: 8, paddingBottom: 8, paddingLeft: 12, paddingRight: 12, gap: 10, alignItems: 'center' }}>
        <Pressable onPress={props.onBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 8, paddingRight: 9, paddingTop: 4, paddingBottom: 4, borderRadius: 6, borderWidth: 1, borderColor: BORDER, backgroundColor: accentFor('controlBg') }}>
          <Icon name="ArrowLeft" size={13} color={INK} />
          <Text fontSize={11} color={INK} style={{ fontWeight: 600 }}>editor</Text>
        </Pressable>
        <Icon name="Sparkles" size={14} color={ACCENT} />
        <Text fontSize={13} color={INK} style={{ fontWeight: 'bold', letterSpacing: 0.5 }}>ASSISTANT 3D</Text>
        <Text fontSize={10} color={FAINT} style={{ fontFamily: 'monospace' }}>prompt → writes scene.json → hot surface → click to inspect → comment back</Text>
        <Box style={{ flexGrow: 1 }} />
        <Text fontSize={10} color={loadErr ? accentFor('error') : accentFor('success')} style={{ fontFamily: 'monospace' }}>
          {loadErr ? `⚠ ${loadErr}` : `● ${scene.meshes.length} meshes · reload #${reloads}`}
        </Text>
      </Row>

      <Row style={{ flexGrow: 1, minHeight: 0 }}>
        {/* LEFT: chat */}
        <Col style={{ width: 300, height: '100%', backgroundColor: PANEL, borderColor: BORDER, borderRightWidth: 1, minHeight: 0 }}>
          <Row style={{ paddingTop: 7, paddingBottom: 7, paddingLeft: 12, paddingRight: 12, borderColor: BORDER, borderBottomWidth: 1, gap: 8, alignItems: 'baseline' }}>
            <Text fontSize={11} color={INK} style={{ fontWeight: 'bold' }}>assistant</Text>
            <Text fontSize={9} color={phaseColor} style={{ fontFamily: 'monospace' }}>{sa.phase}</Text>
            <Box style={{ flexGrow: 1 }} />
            <Text fontSize={9} color={FAINT} style={{ fontFamily: 'monospace' }}>{BACKEND_LABELS[config.backend]}</Text>
          </Row>

          <BackendBar
            config={config}
            onPickBackend={pickBackend}
            onPatch={patchConfig}
            modelHistory={modelHistory}
            onForgetModel={(p) => setModelHistory(forgetModelPath(p))}
          />

          <ScrollView ref={transcriptRef} showScrollbar style={{ flexGrow: 1, height: '100%', minHeight: 0 }} contentContainerStyle={{ paddingTop: 8, paddingBottom: 8, paddingLeft: 12, paddingRight: 12 }}>
            {transcript.length === 0 ? (
              <Col style={{ gap: 6 }}>
                <Text fontSize={11} color={DIM}>Ask for a 3D scene. Examples:</Text>
                {['a small wooden cabin with a red roof', 'a snowman next to a pine tree', 'a tiny rocket on a launch pad', 'a park bench under a lamppost'].map((ex) => (
                  <Pressable key={ex} onPress={() => setInput(ex)} style={{ paddingTop: 5, paddingBottom: 5, paddingLeft: 8, paddingRight: 8, borderRadius: 6, borderWidth: 1, borderColor: BORDER, backgroundColor: accentFor('controlBg') }}>
                    <Text fontSize={11} color={accentFor('info')}>{ex}</Text>
                  </Pressable>
                ))}
              </Col>
            ) : (
              <Col style={{ gap: 8 }}>
                {transcript.map((l, i) => {
                  const body = l.tag === 'you' ? l.text : cleanForDisplay(l.text);
                  if (!body) return null;
                  return (
                    <Col key={i} style={{ gap: 2 }}>
                      <Text fontSize={8} color={l.color} style={{ fontFamily: 'monospace', letterSpacing: 0.5 }}>{l.tag.toUpperCase()}</Text>
                      <Text fontSize={11} color={l.tag === 'you' ? INK : l.dim ? FAINT : DIM}>{body}</Text>
                    </Col>
                  );
                })}
              </Col>
            )}
          </ScrollView>

          <Col style={{ padding: 10, gap: 8, borderColor: BORDER, borderTopWidth: 1 }}>
            <Box style={{ backgroundColor: accentFor('controlBg'), borderColor: BORDER, borderWidth: 1, borderRadius: 6, paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6 }}>
              <TextInput value={input} onChangeText={setInput} onSubmitEditing={submit} placeholder="describe a 3D scene…" style={{ color: INK, fontSize: 12 }} />
            </Box>
            <Pressable onPress={submit} style={{ paddingTop: 7, paddingBottom: 7, borderRadius: 6, alignItems: 'center', backgroundColor: streaming ? accentFor('bgElevated') : accentFor('controlBg'), borderWidth: 1, borderColor: streaming ? ACCENT : BORDER }}>
              <Text fontSize={12} color={streaming ? ACCENT : INK} style={{ fontWeight: 'bold' }}>{streaming ? 'generating…' : sa.ready ? 'generate scene' : 'configure backend ↑'}</Text>
            </Pressable>
            {sa.error ? <Text fontSize={10} color={accentFor('error')}>{sa.error}</Text>
              : sa.note ? <Text fontSize={9} color={FAINT} style={{ fontFamily: 'monospace' }}>{sa.note}</Text> : null}
          </Col>
        </Col>

        {/* CENTER: hot 3D surface — own memo'd component (camera + drag/pick
            live inside it, so orbiting never re-renders the chat log) */}
        <SceneSurface scene={scene} selected={selected} onPick={onPick} />

        {/* RIGHT: object tree + inspector + comment */}
        <Col style={{ width: 280, height: '100%', backgroundColor: PANEL, borderColor: BORDER, borderLeftWidth: 1, minHeight: 0 }}>
          <Row style={{ paddingTop: 7, paddingBottom: 7, paddingLeft: 12, paddingRight: 12, borderColor: BORDER, borderBottomWidth: 1, alignItems: 'baseline', gap: 8 }}>
            <Text fontSize={11} color={INK} style={{ fontWeight: 'bold' }}>objects</Text>
            <Box style={{ flexGrow: 1 }} />
            <Text fontSize={9} color={FAINT} style={{ fontFamily: 'monospace' }}>{scene.meshes.length}</Text>
          </Row>
          <ScrollView showScrollbar style={{ height: 168, minHeight: 0 }} contentContainerStyle={{ paddingTop: 4, paddingBottom: 4, paddingLeft: 6, paddingRight: 6 }}>
            {scene.meshes.length === 0
              ? <Text fontSize={11} color={DIM} style={{ paddingLeft: 6, paddingTop: 6 }}>no meshes yet</Text>
              : scene.meshes.map((m, i) => {
                const on = i === selected;
                return (
                  <Pressable key={m.id + '#' + i} onPress={() => setSelected(i)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4, paddingBottom: 4, paddingLeft: 6, paddingRight: 6, borderRadius: 5, backgroundColor: on ? accentFor('bgElevated') : 'transparent' }}>
                    <Box style={{ width: 11, height: 11, borderRadius: 3, backgroundColor: m.material, borderWidth: 1, borderColor: BORDER }} />
                    <Text fontSize={11} color={on ? ACCENT : INK} style={{ fontWeight: on ? 'bold' : 'normal' }}>{m.id}</Text>
                    <Box style={{ flexGrow: 1 }} />
                    <Text fontSize={9} color={FAINT} style={{ fontFamily: 'monospace' }}>{m.geometry}</Text>
                  </Pressable>
                );
              })}
          </ScrollView>

          <Row style={{ paddingTop: 7, paddingBottom: 7, paddingLeft: 12, paddingRight: 12, borderColor: BORDER, borderTopWidth: 1, borderBottomWidth: 1, alignItems: 'baseline', gap: 8 }}>
            <Text fontSize={11} color={INK} style={{ fontWeight: 'bold' }}>inspector</Text>
            <Box style={{ flexGrow: 1 }} />
            <Text fontSize={9} color={FAINT} style={{ fontFamily: 'monospace' }}>{selMesh ? `#${selected}` : '—'}</Text>
          </Row>

          <ScrollView showScrollbar style={{ flexGrow: 1, height: '100%', minHeight: 0 }} contentContainerStyle={{ paddingTop: 10, paddingBottom: 10, paddingLeft: 12, paddingRight: 12 }}>
            {!selMesh ? (
              <Text fontSize={11} color={DIM}>Click a mesh or pick one from the tree to inspect its geometry, material, and transform.</Text>
            ) : (
              <Col style={{ gap: 12 }}>
                <Row style={{ gap: 8, alignItems: 'center' }}>
                  <Box style={{ width: 18, height: 18, borderRadius: 4, backgroundColor: selMesh.material, borderWidth: 1, borderColor: BORDER }} />
                  <Text fontSize={14} color={INK} style={{ fontWeight: 'bold' }}>{selMesh.id}</Text>
                </Row>
                <InspectRow label="geometry" value={selMesh.geometry} />
                <InspectRow label="material" value={selMesh.material} mono />
                <InspectRow label="position" value={`[${selMesh.position.map((n) => round(n)).join(', ')}]`} mono />
                {selMesh.rotation && (selMesh.rotation[0] || selMesh.rotation[1] || selMesh.rotation[2])
                  ? <InspectRow label="rotation°" value={`[${selMesh.rotation.map((n) => round(n)).join(', ')}]`} mono /> : null}
                {selMesh.scale && selMesh.scale !== 1 ? <InspectRow label="scale" value={String(round(selMesh.scale))} mono /> : null}
                <Col style={{ gap: 4 }}>
                  <Text fontSize={8} color={FAINT} style={{ fontFamily: 'monospace', letterSpacing: 0.5 }}>PARAMS</Text>
                  {Object.keys(selMesh.params).length === 0
                    ? <Text fontSize={11} color={DIM}>(defaults)</Text>
                    : Object.entries(selMesh.params).map(([k, v]) => <InspectRow key={k} label={k} value={String(round(Number(v)))} mono />)}
                </Col>
                <Box style={{ height: 1, backgroundColor: BORDER }} />
                <Text fontSize={8} color={FAINT} style={{ fontFamily: 'monospace' }}>raw</Text>
                <Box style={{ backgroundColor: accentFor('controlBg'), borderRadius: 6, borderWidth: 1, borderColor: BORDER, padding: 8 }}>
                  <Text fontSize={10} color={accentFor('textSecondary')} style={{ fontFamily: 'monospace' }}>{JSON.stringify(selMesh, null, 2)}</Text>
                </Box>
              </Col>
            )}
          </ScrollView>

          {selMesh ? (
            <Col style={{ padding: 10, gap: 6, borderColor: BORDER, borderTopWidth: 1, backgroundColor: accentFor('surface') }}>
              <Text fontSize={8} color={ACCENT} style={{ fontFamily: 'monospace', letterSpacing: 0.5 }}>{`COMMENT ON "${selMesh.id}"`}</Text>
              <Box style={{ backgroundColor: accentFor('controlBg'), borderColor: BORDER, borderWidth: 1, borderRadius: 6, paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6 }}>
                <TextInput value={comment} onChangeText={setComment} onSubmitEditing={sendComment} placeholder="make it bigger, recolor, move…" style={{ color: INK, fontSize: 12 }} />
              </Box>
              <Pressable onPress={sendComment} style={{ paddingTop: 6, paddingBottom: 6, borderRadius: 6, alignItems: 'center', backgroundColor: accentFor('bgElevated'), borderWidth: 1, borderColor: ACCENT }}>
                <Text fontSize={11} color={ACCENT} style={{ fontWeight: 'bold' }}>send to assistant ↳</Text>
              </Pressable>
            </Col>
          ) : null}
        </Col>
      </Row>
    </Box>
  );
}

function InspectRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
      <Text fontSize={11} color={accentFor('textDim')}>{label}</Text>
      <Text fontSize={11} color={accentFor('text')} style={mono ? { fontFamily: 'monospace' } : undefined}>{value}</Text>
    </Row>
  );
}
