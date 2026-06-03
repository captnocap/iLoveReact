// assist3d/BackendBar — pick the assistant backend + edit its connection config.
//
// Three providers, all behind useAssistant: Claude (claude_code subprocess), HTTP
// (any OpenAI-compatible …/v1 endpoint), and Local GGUF (embedded llama.cpp). The
// chips switch backend; the fields below edit just the active one's connection.

import { Box, Col, Row, Pressable, Text, TextInput } from '@reactjit/primitives';
import { accentFor } from '../studio.cls';
import {
  BACKEND_LABELS, configReady, LOCAL_DEFAULT_N_CTX, LOCAL_DEFAULT_MAX_TOKENS,
  type Backend, type BackendConfig,
} from './backends';
import { modelLabel } from './modelHistory';

const BACKENDS: Backend[] = ['claude_code', 'openai_compat', 'local_ai'];

function Field(props: { label: string; value: string; placeholder?: string; onChange: (s: string) => void }) {
  return (
    <Col style={{ gap: 2 }}>
      <Text fontSize={8} color={accentFor('textDim')} style={{ fontFamily: 'monospace', letterSpacing: 0.5 }}>{props.label}</Text>
      <Box style={{ backgroundColor: accentFor('controlBg'), borderColor: accentFor('border'), borderWidth: 1, borderRadius: 5, paddingLeft: 7, paddingRight: 7, paddingTop: 4, paddingBottom: 4 }}>
        <TextInput value={props.value} onChangeText={props.onChange} placeholder={props.placeholder} style={{ color: accentFor('text'), fontSize: 11, fontFamily: 'monospace' }} />
      </Box>
    </Col>
  );
}

// Digits-only field for the token/context knobs. Empty shows as blank (commits 0,
// which buildAssistantOpts floors back to the default) so the user can clear+retype.
function NumField(props: { label: string; value?: number; placeholder?: string; onChange: (n: number) => void }) {
  return (
    <Col style={{ gap: 2 }}>
      <Text fontSize={8} color={accentFor('textDim')} style={{ fontFamily: 'monospace', letterSpacing: 0.5 }}>{props.label}</Text>
      <Box style={{ backgroundColor: accentFor('controlBg'), borderColor: accentFor('border'), borderWidth: 1, borderRadius: 5, paddingLeft: 7, paddingRight: 7, paddingTop: 4, paddingBottom: 4 }}>
        <TextInput
          value={props.value ? String(props.value) : ''}
          onChangeText={(s) => { const d = s.replace(/[^0-9]/g, ''); props.onChange(d === '' ? 0 : parseInt(d, 10)); }}
          placeholder={props.placeholder}
          style={{ color: accentFor('text'), fontSize: 11, fontFamily: 'monospace' }}
        />
      </Box>
    </Col>
  );
}

export function BackendBar(props: {
  config: BackendConfig;
  onPickBackend: (b: Backend) => void;
  onPatch: (patch: Partial<BackendConfig>) => void;
  modelHistory?: string[];
  onForgetModel?: (path: string) => void;
}) {
  const { config, onPatch } = props;
  const ACCENT = accentFor('primary'), BORDER = accentFor('border');

  return (
    <Col style={{ paddingTop: 8, paddingBottom: 8, paddingLeft: 10, paddingRight: 10, gap: 8, borderColor: BORDER, borderBottomWidth: 1, backgroundColor: accentFor('surface') }}>
      <Row style={{ gap: 5 }}>
        {BACKENDS.map((b) => {
          const on = config.backend === b;
          return (
            <Pressable key={b} onPress={() => props.onPickBackend(b)} style={{ flexGrow: 1, alignItems: 'center', paddingTop: 5, paddingBottom: 5, borderRadius: 5, borderWidth: 1, borderColor: on ? ACCENT : BORDER, backgroundColor: on ? accentFor('bgElevated') : accentFor('controlBg') }}>
              <Text fontSize={10} color={on ? ACCENT : accentFor('textDim')} style={{ fontWeight: on ? 'bold' : 'normal' }}>{BACKEND_LABELS[b]}</Text>
            </Pressable>
          );
        })}
      </Row>

      {config.backend === 'claude_code' ? (
        <Field label="MODEL" value={config.model ?? ''} placeholder="claude-opus-4-7" onChange={(v) => onPatch({ model: v })} />
      ) : null}

      {config.backend === 'openai_compat' ? (
        <Col style={{ gap: 6 }}>
          <Field label="BASE URL" value={config.baseUrl ?? ''} placeholder="http://localhost:7781/v1" onChange={(v) => onPatch({ baseUrl: v })} />
          <Row style={{ gap: 6 }}>
            <Box style={{ flexGrow: 1 }}><Field label="MODEL" value={config.model ?? ''} placeholder="disk-claude" onChange={(v) => onPatch({ model: v })} /></Box>
            <Box style={{ width: 96 }}><Field label="API KEY" value={config.apiKey ?? ''} placeholder="bridge" onChange={(v) => onPatch({ apiKey: v })} /></Box>
          </Row>
        </Col>
      ) : null}

      {config.backend === 'local_ai' ? (
        <Col style={{ gap: 6 }}>
          <Field label="GGUF PATH" value={config.modelPath ?? ''} placeholder="/abs/path/model.gguf" onChange={(v) => onPatch({ modelPath: v })} />
          {props.modelHistory && props.modelHistory.length > 0 ? (
            <Col style={{ gap: 3 }}>
              <Text fontSize={8} color={accentFor('textDim')} style={{ fontFamily: 'monospace', letterSpacing: 0.5 }}>RECENT</Text>
              <Row style={{ flexWrap: 'wrap', gap: 4 }}>
                {props.modelHistory.map((p) => {
                  const on = p === config.modelPath;
                  return (
                    <Pressable key={p} onPress={() => onPatch({ modelPath: p })} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 6, paddingRight: 5, paddingTop: 3, paddingBottom: 3, borderRadius: 4, borderWidth: 1, borderColor: on ? ACCENT : BORDER, backgroundColor: on ? accentFor('bgElevated') : accentFor('controlBg') }}>
                      <Text fontSize={9} color={on ? ACCENT : accentFor('textDim')} style={{ fontFamily: 'monospace' }} numberOfLines={1}>{modelLabel(p)}</Text>
                      {props.onForgetModel ? (
                        <Pressable onPress={() => props.onForgetModel!(p)} style={{ paddingLeft: 1, paddingRight: 1 }}>
                          <Text fontSize={9} color={accentFor('textFaint')}>×</Text>
                        </Pressable>
                      ) : null}
                    </Pressable>
                  );
                })}
              </Row>
            </Col>
          ) : null}
          <Row style={{ gap: 6 }}>
            <Box style={{ flexGrow: 1 }}><NumField label="MAX TOKENS" value={config.maxTokens} placeholder={String(LOCAL_DEFAULT_MAX_TOKENS)} onChange={(n) => onPatch({ maxTokens: n })} /></Box>
            <Box style={{ flexGrow: 1 }}><NumField label="CONTEXT" value={config.nCtx} placeholder={String(LOCAL_DEFAULT_N_CTX)} onChange={(n) => onPatch({ nCtx: n })} /></Box>
          </Row>
        </Col>
      ) : null}

      {!configReady(config) ? (
        <Text fontSize={9} color={accentFor('warning')} style={{ fontFamily: 'monospace' }}>
          {config.backend === 'local_ai' ? 'enter a .gguf path to connect' : 'enter base url + model to connect'}
        </Text>
      ) : null}
    </Col>
  );
}
