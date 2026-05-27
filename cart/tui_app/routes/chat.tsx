// chat route — live transcript + input.
//
// Reads useChatTurns() from the shared chat store; whenever the
// provider appends a user or assistant turn (via askAssistant or
// streaming partials), this re-renders. Input fires the same
// askAssistant() the GUI's InputStrip uses. No parallel path.
//
// Surface shape is intentionally flat-text: one row per turn,
// `AUTHOR  body`. The GUI's surface card / intent renderer is
// skipped here — chat-loom <Btn>/<Form>/etc. land in turn.surface
// but render as raw markup in turn.body until a TUI-native intent
// renderer exists. Future add.

import * as React from 'react';
import { Box, Col, Row, Text, TextInput, ScrollView } from '@reactjit/runtime/primitives';
import { callHost, hasHost } from '@reactjit/runtime/ffi';
import { askAssistant, useChatTurns, useCurrentSessionId } from '../../app/chat/store';
import type { AssistantTurn as TurnT } from '../../app/chat/types';
import { SETTINGS_ID, short, useSettingsStore } from '../settings';
import { chatMetadataSettings } from './metadata';

function authorBadge(turn: TurnT): { label: string; color: string } {
  if (turn.author === 'user') return { label: 'YOU ', color: '#fbbf24' };
  if (turn.author === 'asst') return { label: 'ASST', color: '#22d3ee' };
  return { label: 'PAR ', color: '#a78bfa' };
}

function turnBody(turn: TurnT): string {
  if (turn.author === 'parallel') {
    const sel = turn.candidates.find((c) => c.selected) ?? turn.candidates[0];
    return sel?.body || '';
  }
  if (turn.author === 'asst' && turn.pending && !turn.body) return thinkingText();
  return turn.body || '';
}

function thinkingText(): string {
  const frames = ['waking up', 'thinking', 'processing', 'working'];
  return `${frames[Math.floor(Date.now() / 700) % frames.length]}…`;
}

function fmtCost(v: any): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  if (v === 0) return '$0';
  return `$${v.toFixed(v < 0.01 ? 4 : 2)}`;
}

function usageText(usage: any): string {
  if (!usage) return '';
  const parts: string[] = [];
  if (usage.input_tokens) parts.push(`in ${usage.input_tokens}`);
  if (usage.output_tokens) parts.push(`out ${usage.output_tokens}`);
  if (usage.cache_read_input_tokens) parts.push(`cache ${usage.cache_read_input_tokens}`);
  if (usage.cache_creation_input_tokens) parts.push(`cache+ ${usage.cache_creation_input_tokens}`);
  return parts.join(' / ');
}

function metadataParts(turn: TurnT, cfg: ReturnType<typeof chatMetadataSettings>): string[] {
  const m = turn.author === 'asst' ? turn.metadata : null;
  const parts: string[] = [];
  if (cfg.showTimestamp) parts.push(turn.timestamp);
  if (m) {
    if (cfg.showModel && m.model) parts.push(short(m.model, 36));
    if (cfg.showBackend && m.backend) parts.push(m.backend);
    if (cfg.showCost) {
      const c = fmtCost(m.costUsd);
      if (c) parts.push(c);
    }
    if (cfg.showUsage) {
      const u = usageText(m.usage);
      if (u) parts.push(u);
    }
    if (cfg.showSession) {
      const sid = m.externalSessionId || m.workerSessionId;
      if (sid) parts.push(short(sid, 24));
    }
  }
  return parts;
}

function TurnRow({ turn, metadataCfg, textMaxWidth }: { turn: TurnT; metadataCfg: ReturnType<typeof chatMetadataSettings>; textMaxWidth?: number }) {
  const { label, color } = authorBadge(turn);
  const body = turnBody(turn);
  const meta = metadataParts(turn, metadataCfg).join(' · ');
  return (
    <Col style={{ width: '100%', paddingLeft: 1, paddingRight: 1, paddingBottom: 1 }}>
      <Row style={{ gap: 2 }}>
        <Text style={{ color }}>{label}</Text>
        {meta ? <Text style={{ color: '#64748b' }}>{meta}</Text> : null}
      </Row>
      {/* maxWidth (concrete px from the viewport) gives the Text a bounded
          measure so it WRAPS — a ScrollView hands its content unbounded
          width, so width:'100%' alone leaves text running off the edge. */}
      <Box style={{ width: '100%', maxWidth: textMaxWidth, paddingLeft: 6 }}>
        <Text style={{ width: '100%', maxWidth: textMaxWidth, color: turn.author === 'asst' && turn.pending && !turn.body ? '#94a3b8' : '#e7eaff' }}>
          {body || (turn.author === 'asst' ? 'waiting…' : '(empty)')}
        </Text>
      </Box>
    </Col>
  );
}

// Concrete content width for wrapping. The transcript is full-width (the
// NavBar/Footer are horizontal bars, no side rail); subtract the row
// indent + a little for the scrollbar. Falls back to undefined (no clamp)
// if the host can't report a viewport width.
function useTranscriptMaxWidth(): number | undefined {
  const vw = hasHost('__viewport_width') ? (Number(callHost('__viewport_width', 0)) || 0) : 0;
  return vw > 0 ? Math.max(80, vw - 20) : undefined;
}

export function ChatRoute() {
  const turns = useChatTurns();
  const currentId = useCurrentSessionId();
  const settingsStore = useSettingsStore();
  const { data: settings } = settingsStore.useQuery(SETTINGS_ID);
  const metadataCfg = chatMetadataSettings(settings);
  const textMaxWidth = useTranscriptMaxWidth();
  const [draft, setDraft] = React.useState('');
  const [, tick] = React.useState(0);
  const draftRef = React.useRef('');
  draftRef.current = draft;

  React.useEffect(() => {
    const hasPendingBlank = turns.some((t) => t.author === 'asst' && t.pending && !t.body);
    if (!hasPendingBlank) return;
    const id = setInterval(() => tick((n) => n + 1), 700);
    return () => clearInterval(id);
  }, [turns]);

  const submit = () => {
    const text = draftRef.current.trim();
    if (!text) return;
    setDraft('');
    draftRef.current = '';
    // Fire-and-forget — the provider appends the user turn synchronously
    // and the pending asst turn; streaming partials mutate it as they
    // land. Any thrown error gets recorded on the asst turn body as
    // [error] …, so we don't need to surface rejections here.
    void askAssistant(text).catch(() => {});
  };

  return (
    <Col style={{ width: '100%', height: '100%' }}>
      {/* Transcript — fills available height, scrolls implicitly via
          the framework's row reuse. Empty state prompts the user. */}
      <ScrollView showScrollbar style={{ flexGrow: 1, flexShrink: 1, width: '100%', paddingTop: 1 }}>
        <Col style={{ width: '100%' }}>
          {turns.length === 0 ? (
            <Box style={{ paddingLeft: 2, paddingTop: 1 }}>
              <Text style={{ color: '#64748b' }}>
                {currentId
                  ? 'this chat has no messages yet — type below to pick it back up.'
                  : 'type below to start a new chat.'}
              </Text>
            </Box>
          ) : (
            turns.map((t) => <TurnRow key={t.id} turn={t} metadataCfg={metadataCfg} textMaxWidth={textMaxWidth} />)
          )}
        </Col>
      </ScrollView>

      {/* Input — single-line TextInput, Enter submits. Same askAssistant
          seam the GUI's InputStrip uses. */}
      <Row style={{ width: '100%', flexShrink: 0, backgroundColor: '#0b1020', paddingLeft: 1, paddingRight: 1, gap: 1 }}>
        <Text style={{ color: '#fbbf24' }}>{'>'}</Text>
        <Box style={{ flexGrow: 1 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmit={submit}
            placeholder="message…"
            style={{ width: '100%', color: '#e7eaff', backgroundColor: 'transparent', borderWidth: 0 }}
          />
        </Box>
      </Row>
    </Col>
  );
}
