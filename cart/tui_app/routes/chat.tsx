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
import { Box, Col, Row, Text, TextInput } from '@reactjit/runtime/primitives';
import { askAssistant, useChatTurns, useCurrentSessionId } from '../../app/chat/store';
import type { AssistantTurn as TurnT } from '../../app/chat/types';

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
  if (turn.author === 'asst' && turn.pending && !turn.body) return '…';
  return turn.body || '';
}

function TurnRow({ turn }: { turn: TurnT }) {
  const { label, color } = authorBadge(turn);
  const body = turnBody(turn);
  return (
    <Col style={{ width: '100%', paddingLeft: 1, paddingRight: 1, paddingBottom: 1 }}>
      <Row style={{ gap: 2 }}>
        <Text style={{ color }}>{label}</Text>
        <Text style={{ color: '#64748b' }}>{turn.timestamp}</Text>
      </Row>
      <Box style={{ paddingLeft: 6 }}>
        <Text style={{ color: '#e7eaff' }}>{body || '(empty)'}</Text>
      </Box>
    </Col>
  );
}

export function ChatRoute() {
  const turns = useChatTurns();
  const currentId = useCurrentSessionId();
  const [draft, setDraft] = React.useState('');
  const draftRef = React.useRef('');
  draftRef.current = draft;

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
      <Col style={{ flexGrow: 1, width: '100%', paddingTop: 1 }}>
        {turns.length === 0 ? (
          <Box style={{ paddingLeft: 2, paddingTop: 1 }}>
            <Text style={{ color: '#64748b' }}>
              {currentId
                ? 'this chat has no messages yet — type below to pick it back up.'
                : 'type below to start a new chat.'}
            </Text>
          </Box>
        ) : (
          turns.map((t) => <TurnRow key={t.id} turn={t} />)
        )}
      </Col>

      {/* Input — single-line TextInput, Enter submits. Same askAssistant
          seam the GUI's InputStrip uses. */}
      <Row style={{ width: '100%', backgroundColor: '#0b1020', paddingLeft: 1, paddingRight: 1, gap: 1 }}>
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
