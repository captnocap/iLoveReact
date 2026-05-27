// ChatFrame — wraps ChatCard with left config gutters + right signal gutter.
// Gutter 1: model variant   Gutter 2: effort   Gutter 3: context / reset

import { ChatCard, WorkerQuestAttachment } from './ChatCard';
import { Box, Text } from '@reactjit/runtime/primitives';
import { C } from './style.cls';

const MODEL_VARIANTS = [
  { id: 'opus-4-7', label: '7', tooltip: 'Opus 4.7', color: '#D97757' },
  { id: 'opus-4-7-1m', label: 'M', tooltip: 'Opus 4.7 [1M]', color: '#D97757' },
  { id: 'opus-4-6', label: '6', tooltip: 'Opus 4.6', color: '#D97757' },
  { id: 'sonnet-4-6', label: 'S', tooltip: 'Sonnet 4.6', color: '#D97757' },
  { id: 'sonnet-4-5', label: 's', tooltip: 'Sonnet 4.5', color: '#D97757' },
  { id: 'haiku-4-5', label: 'H', tooltip: 'Haiku 4.5', color: '#D97757' },
  { id: 'kimi-coding', label: 'K', tooltip: 'Kimi for Coding', color: '#C4B5FD' },
  { id: 'codex', label: 'C', tooltip: 'Codex', color: '#10a37f' },
  { id: 'gpt-5-4', label: 'G', tooltip: 'GPT-5.4', color: '#10a37f' },
  { id: 'gpt-5-4-mini', label: 'm', tooltip: 'GPT-5.4 mini', color: '#10a37f' },
  { id: 'gemini-pro', label: 'P', tooltip: 'Gemini 2.5 Pro', color: '#4285f4' },
  { id: 'gemini-flash', label: 'F', tooltip: 'Gemini 2.5 Flash', color: '#4285f4' },
  { id: 'gemini-flash-lite', label: 'L', tooltip: 'Gemini 2.5 Flash-Lite', color: '#4285f4' },
];

const EFFORT_LEVELS = [
  { id: 'low', label: 'L', tooltip: 'Low effort', color: '#7DD3FC' },
  { id: 'med', label: 'M', tooltip: 'Medium effort', color: '#7DD3FC' },
  { id: 'high', label: 'H', tooltip: 'High effort', color: '#7DD3FC' },
  { id: 'xhigh', label: 'X', tooltip: 'Extra high effort', color: '#7DD3FC' },
  { id: 'max', label: 'A', tooltip: 'Max effort', color: '#7DD3FC' },
];

const CONTEXT_OPTIONS = [
  { id: '200k', label: '2', tooltip: '200k context', color: '#60A5FA' },
  { id: '1m', label: '1', tooltip: '1M context', color: '#60A5FA' },
  { id: 'reset', label: 'R', tooltip: 'Reset context', color: '#F87171' },
];

function GutterItem(props: any) {
  const { active, label, tooltip, onPress, color } = props;
  const Item = active ? C.ChatGutterItemActive : C.ChatGutterItem;
  const itemStyle = active
    ? { backgroundColor: color, borderColor: color }
    : { borderColor: color };
  const textColor = active ? '#0b0f16' : color;

  return (
    <Item hoverable={1} tooltip={tooltip} onPress={onPress} style={itemStyle}>
      <Text fontSize={9} color={textColor}>{label}</Text>
    </Item>
  );
}

export function ChatFrame(props: any) {
  const {
    selectedVariant, onSelectVariant,
    selectedEffort, onSelectEffort,
    selectedContext, onSelectContext,
    isConnecting,
    ...cardProps
  } = props;

  return (
    <C.ChatFrame>
      <C.ChatGutterLeft>
        <C.ChatGutterCol>
          {MODEL_VARIANTS.map((v) => (
            <GutterItem
              key={v.id}
              active={selectedVariant === v.id ? 1 : 0}
              label={v.label}
              tooltip={v.tooltip}
              color={v.color}
              onPress={() => onSelectVariant(v.id)}
            />
          ))}
        </C.ChatGutterCol>
        <C.ChatGutterDivider />
        <C.ChatGutterCol>
          {EFFORT_LEVELS.map((e) => (
            <GutterItem
              key={e.id}
              active={selectedEffort === e.id ? 1 : 0}
              label={e.label}
              tooltip={e.tooltip}
              color={e.color}
              onPress={() => onSelectEffort(e.id)}
            />
          ))}
        </C.ChatGutterCol>
        <C.ChatGutterDivider />
        <C.ChatGutterCol>
          {CONTEXT_OPTIONS.map((c) => (
            <GutterItem
              key={c.id}
              active={selectedContext === c.id ? 1 : 0}
              label={c.label}
              tooltip={c.tooltip}
              color={c.color}
              onPress={() => onSelectContext(c.id)}
            />
          ))}
        </C.ChatGutterCol>
      </C.ChatGutterLeft>

      <C.ChatCenterCol>
        <ChatCard {...cardProps} selectedVariant={selectedVariant} isConnecting={isConnecting} />
        <WorkerQuestAttachment
          quest={cardProps.quest}
          onRejectQuestStep={cardProps.onRejectQuestStep}
          onAddQuestStep={cardProps.onAddQuestStep}
        />
      </C.ChatCenterCol>

      <C.ChatGutterRight>
        <C.ChatSignalOn />
        <C.ChatSignalOn />
        <C.ChatSignalOn />
        <C.ChatSignalOn />
        <C.ChatSignalOn />
        <C.ChatSignalOff />
        <C.ChatSignalOff />
        <C.ChatSignalOff />
        <C.ChatSignalOff />
        <C.ChatSignalOff />
        <C.ChatSignalOff />
        <C.ChatSignalOff />
        <C.ChatSignalOff />
        <C.ChatSignalOff />
        <C.ChatSignalOff />
        <C.ChatSignalOff />
      </C.ChatGutterRight>
    </C.ChatFrame>
  );
}
