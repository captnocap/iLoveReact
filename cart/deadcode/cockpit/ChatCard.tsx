// ChatCard — conversation view driven by props from the cockpit.

import { useState } from 'react';
import { ScrollView, Box, Text, Pressable, TextInput } from '@reactjit/runtime/primitives';
import { C } from './style.cls';

type Segment = {
  type: 'text' | 'code';
  lang: string;
  text: string;
};

const KIND_META: Record<string, { label: string; glyph: string; color: string; bubble: string; glyphBg: string }> = {
  user:      { label: 'you',       glyph: '↳', color: '#60A5FA', bubble: 'theme:bgAlt',    glyphBg: 'rgba(96,165,250,0.14)' },
  assistant: { label: 'worker',    glyph: '◌', color: '#AAB4C2', bubble: 'theme:bgRaised', glyphBg: 'rgba(168,180,194,0.12)' },
  thinking:  { label: 'thinking',  glyph: '✦', color: '#FBBF24', bubble: 'theme:bgSunken', glyphBg: 'rgba(251,191,36,0.14)' },
  tool:      { label: 'tool',      glyph: '⌘', color: '#F59E0B', bubble: 'theme:bgSunken', glyphBg: 'rgba(245,158,11,0.14)' },
  result:    { label: 'result',    glyph: '✓', color: '#34D399', bubble: 'theme:bgRaised', glyphBg: 'rgba(52,211,153,0.14)' },
  system:    { label: 'status',    glyph: '·', color: '#7DD3FC', bubble: 'theme:bgSunken', glyphBg: 'rgba(125,211,252,0.14)' },
};

function trimBlock(text: string): string {
  return (text || '').replace(/^\s+|\s+$/g, '');
}

function compactInline(text: string, maxLen: number): string {
  const clean = trimBlock(text).replace(/\s+/g, ' ');
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, Math.max(0, maxLen - 1)) + '…';
}

function looksLikeDiff(text: string): boolean {
  const lines = trimBlock(text).split(/\r?\n/);
  let hits = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('diff ') || line.startsWith('@@') || line.startsWith('+++') || line.startsWith('---')) return true;
    if (line.startsWith('+') || line.startsWith('-')) hits = hits + 1;
    if (hits >= 2) return true;
  }
  return false;
}

function splitSegments(text: string): Segment[] {
  const source = text || '';
  if (source.indexOf('```') < 0) {
    const clean = trimBlock(source);
    if (!clean) return [];
    return [{ type: looksLikeDiff(clean) ? 'code' : 'text', lang: looksLikeDiff(clean) ? 'diff' : '', text: clean }];
  }

  const rawParts = source.split('```');
  const out: Segment[] = [];
  for (let i = 0; i < rawParts.length; i++) {
    const raw = rawParts[i];
    if (i % 2 === 0) {
      const clean = trimBlock(raw);
      if (clean) out.push({ type: 'text', lang: '', text: clean });
      continue;
    }
    let lang = '';
    let code = raw;
    const nl = raw.indexOf('\n');
    if (nl >= 0) {
      const first = trimBlock(raw.slice(0, nl));
      if (first && first.length <= 24 && first.indexOf(' ') < 0) {
        lang = first;
        code = raw.slice(nl + 1);
      }
    }
    const clean = trimBlock(code);
    if (!clean) continue;
    out.push({ type: 'code', lang: lang || (looksLikeDiff(clean) ? 'diff' : 'code'), text: clean });
  }
  return out;
}

function parseToolCall(text: string): { name: string; args: string } | null {
  const clean = trimBlock(text);
  const open = clean.indexOf('(');
  const close = clean.lastIndexOf(')');
  if (open <= 0 || close <= open) return null;
  return {
    name: clean.slice(0, open),
    args: trimBlock(clean.slice(open + 1, close)),
  };
}

function prettyJson(text: string): string {
  const clean = trimBlock(text);
  if (!clean) return '';
  try { return JSON.stringify(JSON.parse(clean), null, 2); } catch {}
  return clean;
}

function toolTargetText(text: string): string {
  const clean = trimBlock(text);
  if (!clean) return '';
  try {
    const parsed = JSON.parse(clean);
    if (parsed.path) return String(parsed.path);
    if (parsed.file) return String(parsed.file);
    if (parsed.target) return String(parsed.target);
    if (parsed.name) return String(parsed.name);
  } catch {}
  return compactInline(clean, 36);
}

function isDiffOnly(text: string): boolean {
  const segments = splitSegments(text);
  return segments.length === 1 && segments[0].type === 'code' && segments[0].lang === 'diff';
}

function codeLineColor(line: string): string {
  if (line.startsWith('+')) return '#86EFAC';
  if (line.startsWith('-')) return '#FCA5A5';
  if (line.startsWith('@@') || line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) {
    return '#7DD3FC';
  }
  return '#D6DCE5';
}

function MessageText(props: any) {
  return (
    <Text fontSize={11} color={props.color} style={{ lineHeight: 16 }}>
      {props.text}
    </Text>
  );
}

function CodePanel(props: any) {
  const lang = props.lang || 'code';
  const lines = (props.text || '').split(/\r?\n/);
  return (
    <C.MsgCodeBlock>
      <C.MsgCodeHeader>
        <Text fontSize={9} color={props.accent}>{lang}</Text>
        <C.Spacer />
        <Text fontSize={9} color="theme:textDim">{props.badgeText || (lang === 'diff' ? 'patch' : 'block')}</Text>
      </C.MsgCodeHeader>
      <Box style={{ flexDirection: 'column', gap: 1 }}>
        {lines.map((line: string, index: number) => (
          <Text key={index} fontSize={10} color={codeLineColor(line)} style={{ lineHeight: 14 }}>
            {line === '' ? ' ' : line.replace(/\t/g, '  ')}
          </Text>
        ))}
      </Box>
    </C.MsgCodeBlock>
  );
}

function renderSegments(text: string, accent: string, baseColor: string) {
  const segments = splitSegments(text);
  return segments.map((segment, index) => {
    if (segment.type === 'code') {
      return <CodePanel key={index} text={segment.text} lang={segment.lang} accent={accent} />;
    }
    return <MessageText key={index} text={segment.text} color={baseColor} />;
  });
}

function Lane(props: any) {
  return (
    <C.MsgLane>
      <C.MsgLaneGlyph style={{ borderColor: props.color, backgroundColor: props.bg }}>
        <Text fontSize={10} color={props.color}>{props.glyph}</Text>
      </C.MsgLaneGlyph>
      {!props.isLast ? <C.MsgLaneLine /> : null}
    </C.MsgLane>
  );
}

function MetaBadge(props: any) {
  return (
    <C.MsgMetaBadge style={{ borderColor: props.color || 'theme:borderMid', backgroundColor: props.bg || 'theme:bgSunken' }}>
      <Text fontSize={9} color={props.color || 'theme:textDim'}>{props.text}</Text>
    </C.MsgMetaBadge>
  );
}

export function WorkerQuestAttachment(props: any) {
  const quest = props.quest;
  const [addingStep, setAddingStep] = useState(false);
  const [draftStep, setDraftStep] = useState('');
  if (!quest || !quest.steps || quest.steps.length === 0) return null;
  let completed = 0;
  for (let i = 0; i < quest.steps.length; i++) if (quest.steps[i].status === 'completed') completed = completed + 1;
  const total = quest.steps.length;
  const remaining = Math.max(0, total - completed);
  const submitStep = () => {
    const clean = trimBlock(draftStep);
    if (!clean) {
      setAddingStep(false);
      setDraftStep('');
      return;
    }
    if (typeof props.onAddQuestStep === 'function') props.onAddQuestStep(clean);
    setDraftStep('');
    setAddingStep(false);
  };

  return (
    <C.WorkerQuestCard>
      <C.WorkerQuestHeader>
        <Text fontSize={12} color="#E8ECEF">{quest.title}</Text>
        <C.Spacer />
        <Text fontSize={10} color="theme:textDim">{String(completed) + '/' + String(total)}</Text>
      </C.WorkerQuestHeader>
      <C.WorkerQuestBar>
        <C.WorkerQuestBarFill style={{ flexGrow: completed, flexBasis: 0 }} />
        <C.WorkerQuestBarGap style={{ flexGrow: remaining, flexBasis: 0 }} />
      </C.WorkerQuestBar>
      <ScrollView style={{ flexGrow: 1, flexBasis: 0 }}>
        <C.WorkerQuestStepList>
          {quest.steps.map((step: any, index: number) => {
            const isDone = step.status === 'completed';
            const isActive = step.status === 'active';
            const isRejected = step.status === 'rejected';
            const color = isRejected ? '#F87171' : isActive ? '#34D399' : isDone ? '#64748B' : '#94A3B8';
            const glyph = isRejected ? '✕' : isActive ? '↻' : isDone ? '✓' : '○';
            const row = (
              <C.WorkerQuestStepRow style={{
                backgroundColor: isActive ? 'rgba(52,211,153,0.08)' : isRejected ? 'rgba(248,113,113,0.08)' : 'transparent',
                borderColor: isActive ? 'rgba(52,211,153,0.20)' : isRejected ? 'rgba(248,113,113,0.20)' : 'transparent',
              }}>
                <Text fontSize={10} color={color}>{glyph}</Text>
                <Text
                  fontSize={10}
                  color={isRejected ? '#FCA5A5' : isActive ? '#A7F3D0' : isDone ? '#64748B' : '#94A3B8'}
                  style={{ flexGrow: 1, flexBasis: 0 }}
                >
                  {step.text}
                </Text>
                {isDone ? <Text fontSize={9} color="#F87171">wrong</Text> : null}
                {isRejected ? <Text fontSize={9} color="#FCA5A5">incomplete</Text> : null}
              </C.WorkerQuestStepRow>
            );
            if (isDone && typeof props.onRejectQuestStep === 'function') {
              return (
                <Pressable key={step.id || index} onPress={() => props.onRejectQuestStep(step.id)}>
                  {row}
                </Pressable>
              );
            }
            return <Box key={step.id || index}>{row}</Box>;
          })}
        </C.WorkerQuestStepList>
      </ScrollView>
      {addingStep ? (
        <C.WorkerQuestComposer>
          <Text fontSize={10} color="#34D399">+</Text>
          <TextInput
            value={draftStep}
            placeholder="Add another step..."
            onChangeText={(text: string) => setDraftStep(text)}
            onSubmit={submitStep}
            style={{ flexGrow: 1, flexBasis: 0, fontSize: 10, color: '#E8ECEF' }}
          />
          <Pressable onPress={submitStep}>
            <Text fontSize={10} color="#34D399">add</Text>
          </Pressable>
          <Pressable onPress={() => { setAddingStep(false); setDraftStep(''); }}>
            <Text fontSize={10} color="#6B7585">x</Text>
          </Pressable>
        </C.WorkerQuestComposer>
      ) : (
        <Pressable onPress={() => setAddingStep(true)}>
          <C.WorkerQuestAddRow>
            <Text fontSize={10} color="#64748B">+</Text>
            <Text fontSize={10} color="#64748B">Add more steps...</Text>
          </C.WorkerQuestAddRow>
        </Pressable>
      )}
    </C.WorkerQuestCard>
  );
}

function Block(props: any) {
  const kind = props.kind;
  const meta = KIND_META[kind] || KIND_META.assistant;
  const isError = kind === 'result' && trimBlock(props.text || '').toLowerCase().startsWith('error:');
  const accent = isError ? '#F87171' : meta.color;
  const textColor = kind === 'thinking' || kind === 'system' ? 'theme:textSecondary' : 'theme:textPrimary';
  const toolCall = kind === 'tool' ? parseToolCall(props.text || '') : null;
  const modelBadge = props.modelLabel ? compactInline(props.modelLabel, 22) : '';
  const diffOnly = (kind === 'assistant' || kind === 'result') && isDiffOnly(props.text || '');

  if (kind === 'thinking') {
    return (
      <C.MsgTimelineRow>
        <Lane glyph="✦" color={accent} bg={meta.glyphBg} isLast={props.isLast} />
        <Box style={{ flexGrow: 1, flexBasis: 0, paddingBottom: 8 }}>
          <Pressable onPress={props.onToggleThinking}>
            <C.MsgLabelRow>
              <Text fontSize={10} color={accent}>{props.thinkingOpen ? '▾ THINKING' : '▸ THINKING'}</Text>
              {modelBadge ? <MetaBadge text={modelBadge} color="#7A8594" bg="rgba(0,0,0,0.18)" /> : null}
            </C.MsgLabelRow>
          </Pressable>
          {props.thinkingOpen ? (
            <C.MsgThinkingPanel>
              <MessageText text={props.text || ''} color="theme:textSecondary" />
            </C.MsgThinkingPanel>
          ) : null}
        </Box>
      </C.MsgTimelineRow>
    );
  }

  if (kind === 'tool') {
    const target = toolTargetText(toolCall?.args || '');
    return (
      <C.MsgTimelineRow>
        <Lane glyph="⌘" color={accent} bg={meta.glyphBg} isLast={props.isLast} />
        <Box style={{ flexGrow: 1, flexBasis: 0, paddingBottom: 8 }}>
          <C.MsgToolBar>
            <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexGrow: 1, flexBasis: 0 }}>
              <Text fontSize={12} color="#F472B6">{toolCall?.name || 'tool'}</Text>
              {target ? <Text fontSize={10} color="theme:textDim">{'(' + target + ')'}</Text> : null}
            </Box>
            {modelBadge ? <MetaBadge text={modelBadge} color="#7A8594" bg="rgba(0,0,0,0.18)" /> : null}
          </C.MsgToolBar>
        </Box>
      </C.MsgTimelineRow>
    );
  }

  if (kind === 'user') {
    return (
      <C.MsgTimelineRow>
        <Lane glyph="⌂" color={accent} bg={meta.glyphBg} isLast={props.isLast} />
        <Box style={{ flexGrow: 1, flexBasis: 0, paddingBottom: 10 }}>
          <Text fontSize={10} color={accent}>YOU</Text>
          <Box style={{ paddingTop: 4 }}>
            <MessageText text={props.text || ''} color="theme:textPrimary" />
          </Box>
        </Box>
      </C.MsgTimelineRow>
    );
  }

  return (
    <C.MsgTimelineRow>
      <Lane glyph={kind === 'assistant' ? '◌' : kind === 'result' ? '✓' : '·'} color={accent} bg={meta.glyphBg} isLast={props.isLast} />
      <Box style={{ flexGrow: 1, flexBasis: 0, paddingBottom: 10 }}>
        <C.MsgLabelRow>
          <Text fontSize={10} color={accent}>{kind === 'assistant' ? compactInline(props.workerLabel || 'Worker', 18).toUpperCase() : meta.label.toUpperCase()}</Text>
          {kind === 'assistant' && modelBadge ? <MetaBadge text={modelBadge} color="#7A8594" bg="rgba(0,0,0,0.18)" /> : null}
          {kind === 'result' ? <MetaBadge text={isError ? 'error' : 'complete'} color={accent} bg={meta.glyphBg} /> : null}
        </C.MsgLabelRow>
        <Box style={{ paddingTop: 4, flexDirection: 'column', gap: 6 }}>
          {diffOnly ? <CodePanel text={props.text || ''} lang="diff" accent={accent} badgeText="patch" /> : renderSegments(props.text || '', accent, textColor)}
        </Box>
      </Box>
    </C.MsgTimelineRow>
  );
}

// ── Spawn panel — grid layout matching the AI project example ───────────

const LIVE_MODELS = [
  { vid: 'opus-4-7', brand: 'Claude', status: 'live', name: 'Opus 4.7', modelId: 'claude-opus-4-7', desc: 'Deep reasoning', color: '#D97757', onPress: 'onSpawnClaudeOpus' },
  { vid: 'sonnet-4-6', brand: 'Claude', status: 'live', name: 'Sonnet 4.6', modelId: 'claude-sonnet-4-6', desc: 'Default coding lane', color: '#D97757', onPress: 'onSpawnClaudeSonnet' },
  { vid: 'haiku-4-5', brand: 'Claude', status: 'live', name: 'Haiku 4.5', modelId: 'claude-haiku-4-5', desc: 'Fastest Claude', color: '#D97757', onPress: 'onSpawnClaudeHaiku' },
  { vid: 'kimi-k2.5', brand: 'Kimi', status: 'live', name: 'K2.5', modelId: 'kimi-k2.5', desc: 'Current flagship', color: '#C4B5FD', onPress: 'onSpawnKimiK25' },
  { vid: 'kimi-k2', brand: 'Kimi', status: 'live', name: 'K2', modelId: 'kimi-k2', desc: 'Base code model', color: '#C4B5FD', onPress: 'onSpawnKimiK2' },
  { vid: 'kimi-k2-thinking', brand: 'Kimi', status: 'live', name: 'K2 Thinking', modelId: 'kimi-k2-thinking', desc: 'Longer reasoning', color: '#C4B5FD', onPress: 'onSpawnKimiThinking' },
];

const SOON_MODELS = [
  { vid: 'gpt-5-codex', brand: 'OpenAI', status: 'soon', name: 'GPT-5-Codex', modelId: 'gpt-5-codex', desc: '', color: '#10a37f', onPress: 'onSpawnGpt5Codex' },
  { vid: 'gpt-5-4', brand: 'OpenAI', status: 'soon', name: 'GPT-5.4', modelId: 'gpt-5.4', desc: '', color: '#10a37f', onPress: 'onSpawnGpt54' },
  { vid: 'gpt-5-4-mini', brand: 'OpenAI', status: 'soon', name: 'GPT-5.4 mini', modelId: 'gpt-5.4-mini', desc: '', color: '#10a37f', onPress: 'onSpawnGpt54Mini' },
  { vid: 'gemini-pro', brand: 'Gemini', status: 'soon', name: 'Pro', modelId: 'gemini-2.5-pro', desc: 'Deep reasoning', color: '#4285f4', onPress: 'onSpawnGeminiPro' },
  { vid: 'gemini-flash', brand: 'Gemini', status: 'soon', name: 'Flash', modelId: 'gemini-2.5-flash', desc: 'Fast reasoning', color: '#4285f4', onPress: 'onSpawnGeminiFlash' },
  { vid: 'gemini-flash-lite', brand: 'Gemini', status: 'soon', name: 'Flash-Lite', modelId: 'gemini-2.5-flash-lite', desc: 'Budget lane', color: '#4285f4', onPress: 'onSpawnGeminiFlashLite' },
  { vid: 'codex', brand: 'OpenAI', status: 'soon', name: 'Codex', modelId: 'offline', desc: 'CLI lane pending', color: '#10a37f', onPress: 'onSpawnCodexLegacy' },
];

function GridItem(props: any) {
  const [hovered, setHovered] = useState(false);
  const { m, active, handlers, small } = props;
  const isLive = m.status === 'live';
  const onPress = typeof handlers[m.onPress] === 'function' ? handlers[m.onPress] : () => {};

  const baseStyle: any = {
    borderLeftWidth: 2,
    borderLeftColor: m.color,
    borderColor: active ? m.color : 'theme:borderMid',
    borderWidth: active ? 2 : 1,
    backgroundColor: active ? 'theme:bgRaised' : isLive ? 'theme:bgAlt' : 'theme:bgSunken',
    shadowColor: active || hovered ? m.color : 'transparent',
    shadowBlur: active || hovered ? 10 : 0,
    shadowOffsetY: active || hovered ? 1 : 0,
  };
  if (hovered) {
    baseStyle.backgroundColor = isLive ? 'theme:bgFloat' : 'theme:bgAlt';
    baseStyle.borderColor = m.color;
  }
  if (!isLive) {
    baseStyle.opacity = 0.95;
  }

  const Item = small ? C.SpawnGridItemSmall : C.SpawnGridItem;
  const descText = m.desc || (isLive ? 'Ready' : 'Queued');

  return (
    <Item
      hoverable={1}
      onPress={onPress}
      onHoverEnter={() => setHovered(true)}
      onHoverExit={() => setHovered(false)}
      style={baseStyle}
    >
      <C.GridItemBrandRow>
      <Text fontSize={10} color={m.color} fontWeight="500">{m.brand}</Text>
      </C.GridItemBrandRow>
      <Text fontSize={17} color="#E8ECEF" fontWeight="700">{m.name}</Text>
      <Text fontSize={11} color="#A0A8B5">{m.modelId}</Text>
      <Text fontSize={9} color="#6B7585">{descText}</Text>
      {active ? <Text fontSize={9} color="#34D399" fontWeight="500">selected</Text> : null}
    </Item>
  );
}

function SpawnPanel(props: any) {
  if (!props.show) return null;
  const handlers: Record<string, any> = {
    onSpawnClaudeOpus: props.onSpawnClaudeOpus,
    onSpawnClaudeSonnet: props.onSpawnClaudeSonnet,
    onSpawnClaudeHaiku: props.onSpawnClaudeHaiku,
    onSpawnKimiK25: props.onSpawnKimiK25,
    onSpawnKimiK2: props.onSpawnKimiK2,
    onSpawnKimiThinking: props.onSpawnKimiThinking,
    onSpawnGpt5Codex: props.onSpawnGpt5Codex,
    onSpawnGpt54: props.onSpawnGpt54,
    onSpawnGpt54Mini: props.onSpawnGpt54Mini,
    onSpawnGeminiPro: props.onSpawnGeminiPro,
    onSpawnGeminiFlash: props.onSpawnGeminiFlash,
    onSpawnGeminiFlashLite: props.onSpawnGeminiFlashLite,
    onSpawnCodexLegacy: props.onSpawnCodexLegacy,
  };
  const sv = props.selectedVariant;
  return (
    <C.SpawnPanel>
      <C.SpawnPanelHeader>
        <C.SpawnPanelTitle>spawn agent</C.SpawnPanelTitle>
        <C.SpawnPanelStatus>{props.statusText}</C.SpawnPanelStatus>
        <Box style={{ flexGrow: 1, flexBasis: 0 }} />
        <C.SpawnPanelDismiss onPress={props.onToggle}>
          <Text fontSize={10} color="#6B7585">✕</Text>
        </C.SpawnPanelDismiss>
      </C.SpawnPanelHeader>
      <C.SpawnSection>
        <C.SpawnSectionHeader>
          <C.SpawnSectionTitle>live lanes</C.SpawnSectionTitle>
          <C.SpawnSectionDivider />
        </C.SpawnSectionHeader>
      </C.SpawnSection>
      <C.SpawnPanelGrid>
        <C.SpawnLiveGrid>
          {LIVE_MODELS.map((m) => (
            <GridItem key={m.vid} m={m} active={sv === m.vid} handlers={handlers} />
          ))}
        </C.SpawnLiveGrid>
        <C.SpawnSection>
          <C.SpawnSectionHeader>
            <C.SpawnSectionTitle>coming soon</C.SpawnSectionTitle>
            <C.SpawnSectionDivider />
          </C.SpawnSectionHeader>
        </C.SpawnSection>
        <C.SpawnSoonGrid>
          {SOON_MODELS.map((m) => (
            <GridItem key={m.vid} m={m} active={sv === m.vid} handlers={handlers} small />
          ))}
        </C.SpawnSoonGrid>
      </C.SpawnPanelGrid>
    </C.SpawnPanel>
  );
}

// ── Card header with square brand-color logo ────────────────────────────

const BACKEND_BRAND: Record<string, { color: string; logo: string }> = {
  claude: { color: '#D97757', logo: 'A' },
  kimi:   { color: '#C4B5FD', logo: 'K' },
  local:  { color: '#10a37f', logo: 'L' },
};

export function ChatCard(props: any) {
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
  const slots: Array<{ kind: string; text: string }> = [];
  for (let i = 0; i < 20; i++) {
    const k = props['mk' + i];
    if (k && k !== '') slots.push({ kind: k, text: props['mt' + i] });
  }

  const brand = BACKEND_BRAND[props.backendLabel?.toLowerCase() === 'claude' ? 'claude'
    : props.backendLabel?.toLowerCase() === 'kimi' ? 'kimi'
    : props.backendLabel?.toLowerCase() === 'local' ? 'local'
    : ''] || { color: '#6B7585', logo: props.backendLetter || 'W' };

  return (
    <C.MsgCard>
      <C.MsgHeader>
        <C.HeaderAvatar onPress={props.onToggleSpawnMenu} style={{ backgroundColor: brand.color, borderColor: brand.color }}>
          <C.HeaderAvatarLetter>{brand.logo}</C.HeaderAvatarLetter>
        </C.HeaderAvatar>
        <C.HeaderTextCol>
          <Text fontSize={13} color={brand.color}>{props.backendLabel || 'Worker'}</Text>
          <C.HeaderModel>{props.modelLabel || 'no model selected'}</C.HeaderModel>
        </C.HeaderTextCol>
        {props.isConnecting ? (
          <C.HeaderStatusConnecting />
        ) : props.isStreaming === 1 ? (
          <C.HeaderStatusDot />
        ) : null}
      </C.MsgHeader>

      <C.MsgBody>
        <SpawnPanel
          show={props.showSpawnMenu}
          onToggle={props.onToggleSpawnMenu}
          statusText={props.spawnStatusText}
          selectedVariant={props.selectedVariant}
          onSpawnClaudeOpus={props.onSpawnClaudeOpus}
          onSpawnClaudeSonnet={props.onSpawnClaudeSonnet}
          onSpawnClaudeHaiku={props.onSpawnClaudeHaiku}
          onSpawnKimiK25={props.onSpawnKimiK25}
          onSpawnKimiK2={props.onSpawnKimiK2}
          onSpawnKimiThinking={props.onSpawnKimiThinking}
          onSpawnGpt5Codex={props.onSpawnGpt5Codex}
          onSpawnGpt54={props.onSpawnGpt54}
          onSpawnGpt54Mini={props.onSpawnGpt54Mini}
          onSpawnGeminiPro={props.onSpawnGeminiPro}
          onSpawnGeminiFlash={props.onSpawnGeminiFlash}
          onSpawnGeminiFlashLite={props.onSpawnGeminiFlashLite}
          onSpawnCodexLegacy={props.onSpawnCodexLegacy}
        />
        <ScrollView style={{ flexGrow: 1, flexBasis: 0 }}>
          <C.MsgStack>
            {slots.length === 0 ? (
              <C.MsgEmptyState>
                <Text fontSize={11} color="theme:textDim">Select a lane from the gutters, then type below</Text>
                <Text fontSize={10} color="theme:textDim" style={{ marginTop: 4 }}>worker-local conversation and task progress will attach here</Text>
              </C.MsgEmptyState>
            ) : (
              slots.map((s, i) => (
                (() => {
                  const thinkingKey = String(i);
                  const thinkingOpen = expandedThinking[thinkingKey] !== false;
                  return (
                    <Block
                      key={i}
                      kind={s.kind}
                      text={s.text}
                      modelLabel={props.modelLabel}
                      workerLabel={props.backendLabel || 'Worker'}
                      isLast={i === slots.length - 1}
                      thinkingOpen={thinkingOpen}
                      onToggleThinking={() => setExpandedThinking((prev) => ({
                        ...prev,
                        [thinkingKey]: !thinkingOpen,
                      }))}
                    />
                  );
                })()
              ))
            )}
          </C.MsgStack>
        </ScrollView>
      </C.MsgBody>

      <C.MsgFoot>
        <C.MsgFootLabelRow>
          <C.MsgFootLabel>{props.turnText}</C.MsgFootLabel>
          <C.Spacer />
          <C.MsgFootValue>{props.costText}</C.MsgFootValue>
        </C.MsgFootLabelRow>
      </C.MsgFoot>
    </C.MsgCard>
  );
}
