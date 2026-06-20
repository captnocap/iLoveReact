// editors/model/studio/dialogs/AiTextureDialog.tsx — lifted verbatim from editors/model/Studio.tsx (req_1390). No behavior change.
import { useMemo, useRef, useState } from 'react';
import { Box, Col, Pressable, Row, Text, TextInput } from '@reactjit/primitives';
import { STEP_BTN, STUDIO, T } from '../config';
import { Z } from '../chrome/zlayers';
import { buildTexturePrompt, enhanceViaNano, generateTexture, getNanoKey, setNanoKey, ENHANCE_SYSTEM } from '../../textureGen';
import { useAssistant } from '@reactjit/hooks/useAssistant';
import { processCwd } from '../../../../assist3d/scene';
import type { RasterSlice } from '../../textureize';
import { LCField } from './dialogControls';


// AI Fill (req_1070/1110, Phase 5d): automated image-to-image. The prompt is OPTIONALLY
// enhanced (a nano-gpt TEXT model OR Claude via the useAssistant worker — or bypassed and
// sent raw), then the nano-gpt image client (cart/image-gen, reused) generates ONE image
// with the CURRENT atlas as the img2img reference. The parent composites the result
// through the same slot path as import (the cookie cutter is the UV slot). See 5.6b.
export function AiTextureDialog(props: {
  slice?: RasterSlice;
  target: string;
  getReference: () => string;
  onGenerated: (b64: string) => void;
  onCancel: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [enhance, setEnhance] = useState(true);
  const [backend, setBackend] = useState<'nano' | 'claude'>('nano');
  const [textModel, setTextModel] = useState(STUDIO.aiTextModel);
  const [imageModel, setImageModel] = useState(STUDIO.aiImageModel);
  const [img2img, setImg2img] = useState(true);
  const [status, setStatus] = useState('ready');
  const [busy, setBusy] = useState(false);
  // The nano-gpt key lives in hmsc-int's native localstore (req_1118); editing the
  // field persists it so it's entered once and remembered across sessions.
  const [apiKey, setApiKey] = useState(getNanoKey());
  const saveKey = (v: string) => { setApiKey(v); setNanoKey(v); };

  // Claude is spawned ONLY when picked (lazy); the worker closes when the dialog unmounts.
  const cwd = useMemo(processCwd, []);
  const claudeOn = enhance && backend === 'claude';
  const assistant = useAssistant({ backend: claudeOn ? 'claude_code' : undefined, cwd, model: 'claude-opus-4-7', persistAcrossUnmount: false, pollMs: 120 });
  const eventsRef = useRef(assistant.events);
  eventsRef.current = assistant.events;

  // Bridge the useAssistant event stream to a promise: wait until the worker is ready, ask
  // once, then accumulate assistant_message text up to the turn's completion event.
  const enhanceViaClaude = (text: string): Promise<string> => new Promise((resolve, reject) => {
    let waited = 0;
    const tryAsk = () => {
      if (assistant.ready()) {
        const start = eventsRef.current.length;
        if (!assistant.ask(`${ENHANCE_SYSTEM}\n\nDescription: ${text}\n\nExpanded prompt:`)) { reject(new Error('claude not ready')); return; }
        let polls = 0;
        const iv = setInterval(() => {
          polls += 1;
          const evs = eventsRef.current;
          let acc = '', done = false;
          for (let i = start; i < evs.length; i += 1) {
            const e = evs[i];
            if (e.kind === 'assistant_message' && e.text) acc += e.text;
            else if (e.kind === 'completion') done = true;
            else if (e.kind === 'error_') { clearInterval(iv); reject(new Error(e.text || 'claude error')); return; }
          }
          if (done) { clearInterval(iv); resolve(acc.trim() || text); }
          else if (polls > 900) { clearInterval(iv); reject(new Error('claude timed out')); }
        }, 100);
        return;
      }
      waited += 1;
      if (waited > 300) { reject(new Error('claude worker did not start (is the claude CLI on PATH?)')); return; }
      setTimeout(tryAsk, 100);
    };
    tryAsk();
  });

  const run = async () => {
    const base = prompt.trim();
    if (!base && !img2img) { setStatus('enter a prompt (or turn on “use current art”)'); return; }
    if (!apiKey.trim()) { setStatus('enter your nano-gpt API key below'); return; }
    setBusy(true);
    try {
      let finalPrompt = buildTexturePrompt(props.target, base);
      if (enhance && base) {
        setStatus(backend === 'claude' ? 'enhancing (claude)…' : 'enhancing…');
        try {
          finalPrompt = backend === 'claude' ? await enhanceViaClaude(finalPrompt) : await enhanceViaNano(finalPrompt, textModel, apiKey.trim());
        } catch (e: any) {
          // enhancement is optional — fall back to the raw prompt, but say what happened.
          setStatus(`enhance failed (${e?.message ?? e}) — using raw prompt`);
        }
      }
      setStatus('generating…');
      const ref = img2img ? props.getReference() : null;
      const b64 = await generateTexture(finalPrompt, imageModel, STUDIO.aiTextureSize, ref || null, apiKey.trim());
      setStatus('done ✓');
      props.onGenerated(b64);
    } catch (e: any) {
      setStatus(`failed: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const target = props.slice ? `face ${props.slice.faceIndex} (slice)` : 'the whole sprite sheet';
  const field = { height: 24, fontSize: 11, color: T.ink, backgroundColor: T.page, borderWidth: 1, borderColor: '#2c4a6a', borderRadius: 4, paddingHorizontal: 6, fontFamily: 'monospace' } as const;
  const toggle = (on: boolean) => ({ ...STEP_BTN, backgroundColor: on ? '#2a3f5e' : '#13233aee', borderColor: on ? '#5b8fd6' : '#2c4a6a' });
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#03060caa', zIndex: Z.modal }}>
      <Col style={{ width: 480, gap: 10, padding: 16, borderRadius: 10, backgroundColor: T.panelSolid, borderWidth: 1, borderColor: '#6a4fb0' }}>
        <Text fontSize={13} color={T.text} style={{ fontWeight: '800' }}>✦ AI Fill</Text>
        <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>{`generate ${target} — the current atlas guides it (img2img), masked to the UV slot.`}</Text>

        <LCField label="prompt">
          <Box style={{ flexGrow: 1 }}>
            <TextInput value={prompt} onChangeText={setPrompt} style={field} />
          </Box>
        </LCField>
        <LCField label="image model">
          <Box style={{ flexGrow: 1 }}>
            <TextInput value={imageModel} onChangeText={setImageModel} style={field} />
          </Box>
        </LCField>
        {/* nano-gpt API key — stored natively in hmsc-int's localstore (req_1118), entered
            once and remembered. The one key powers both image gen + text enhance. */}
        <LCField label="api key">
          <Box style={{ flexGrow: 1 }}>
            <TextInput value={apiKey} onChangeText={saveKey} style={{ ...field, borderColor: apiKey.trim() ? '#2c4a6a' : '#7a4f4f' }} />
          </Box>
        </LCField>
        {/* reference — img2img off the current atlas art, or text-to-image only. */}
        <LCField label="reference">
          <Row style={{ gap: 4 }}>
            <Pressable onPress={() => setImg2img(true)} style={toggle(img2img)}><Text fontSize={9} color={img2img ? '#cfe2ff' : T.dim}>use current art</Text></Pressable>
            <Pressable onPress={() => setImg2img(false)} style={toggle(!img2img)}><Text fontSize={9} color={!img2img ? '#cfe2ff' : T.dim}>from prompt only</Text></Pressable>
          </Row>
        </LCField>
        {/* enhancement — off (raw), a nano-gpt text model, or Claude (the bypass toggle). */}
        <LCField label="enhance">
          <Row style={{ gap: 4 }}>
            <Pressable onPress={() => setEnhance(false)} style={toggle(!enhance)}><Text fontSize={9} color={!enhance ? '#cfe2ff' : T.dim}>off</Text></Pressable>
            <Pressable onPress={() => { setEnhance(true); setBackend('nano'); }} style={toggle(enhance && backend === 'nano')}><Text fontSize={9} color={enhance && backend === 'nano' ? '#cfe2ff' : T.dim}>nano text</Text></Pressable>
            <Pressable onPress={() => { setEnhance(true); setBackend('claude'); }} style={toggle(enhance && backend === 'claude')}><Text fontSize={9} color={enhance && backend === 'claude' ? '#cfe2ff' : T.dim}>claude</Text></Pressable>
          </Row>
        </LCField>
        {enhance && backend === 'nano' ? (
          <LCField label="text model">
            <Box style={{ flexGrow: 1 }}>
              <TextInput value={textModel} onChangeText={setTextModel} style={field} />
            </Box>
          </LCField>
        ) : null}

        <Row style={{ gap: 8, alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
          <Box style={{ flexShrink: 1 }}>
            <Text fontSize={10} color={busy ? '#cdbcff' : T.dim} style={{ fontFamily: 'monospace' }}>{status}</Text>
          </Box>
          <Row style={{ gap: 8 }}>
            <Pressable onPress={props.onCancel} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' }}><Text fontSize={11} color={T.dim}>Cancel</Text></Pressable>
            <Pressable onPress={busy ? undefined : run} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: busy ? '#241a3a' : '#2a1c4a', borderWidth: 1, borderColor: '#6a4fb0' }}><Text fontSize={11} color={busy ? T.dim : '#cdbcff'} style={{ fontWeight: '800' }}>{busy ? '…' : 'Generate'}</Text></Pressable>
          </Row>
        </Row>
      </Col>
    </Box>
  );
}
