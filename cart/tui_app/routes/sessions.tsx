// sessions route — past chats, switchable.
//
// useChatSessions returns the newest-first list of every ChatSession
// row in the assistant bucket. Same rows the GUI's rail history list
// reads. Clicking a row calls loadSession(id) which swaps the live
// turn-store contents to that session's turns — open /chat after and
// you'll see the picked transcript.
//
// "+ new" starts a fresh session pointer; first turn typed in /chat
// will mint the actual row.

import * as React from 'react';
import { Box, Col, Row, Text, Pressable } from '@reactjit/primitives';
import {
  loadSession,
  startNewSession,
  deleteSession,
  useChatSessions,
  useCurrentSessionId,
} from '../../app/chat/store';
import { useNavigate } from '../../app/gallery/local-router';

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

export function SessionsRoute() {
  const sessions = useChatSessions();
  const currentId = useCurrentSessionId();
  const nav = useNavigate();

  const onPick = (id: string) => {
    loadSession(id);
    nav.push('/chat');
  };
  const onNew = () => {
    startNewSession();
    nav.push('/chat');
  };

  return (
    <Col style={{ width: '100%', padding: 1 }}>
      <Row style={{ gap: 2, paddingBottom: 1 }}>
        <Text style={{ color: '#fbbf24', fontWeight: 'bold' }}>sessions</Text>
        <Text style={{ color: '#64748b' }}>
          {sessions.length} total
        </Text>
        <Box style={{ flexGrow: 1 }} />
        <Pressable onPress={onNew}>
          <Box style={{ paddingLeft: 2, paddingRight: 2, backgroundColor: '#22d3ee' }}>
            <Text style={{ color: '#000000', fontWeight: 'bold' }}>+ new</Text>
          </Box>
        </Pressable>
      </Row>

      {sessions.length === 0 ? (
        <Box style={{ paddingTop: 2, paddingLeft: 2 }}>
          <Text style={{ color: '#64748b' }}>
            no past chats yet — open /chat and type to start one.
          </Text>
        </Box>
      ) : (
        <Col style={{ width: '100%' }}>
          {sessions.map((s) => {
            const isActive = s.id === currentId;
            const titleColor = isActive ? '#fbbf24' : '#e7eaff';
            const turnsWord = s.turn_count === 1 ? 'turn' : 'turns';
            return (
              <Row key={s.id} style={{ width: '100%', paddingBottom: 1, gap: 1 }}>
                <Pressable onPress={() => onPick(s.id)}>
                  <Box style={{ flexGrow: 1, paddingLeft: 2, paddingRight: 2 }}>
                    <Row style={{ gap: 2 }}>
                      <Text style={{ color: isActive ? '#fbbf24' : '#475569' }}>{isActive ? '▸' : '·'}</Text>
                      <Text style={{ color: titleColor, fontWeight: isActive ? 'bold' : 'normal' }}>
                        {truncate(s.title || '(untitled)', 60)}
                      </Text>
                      <Text style={{ color: '#64748b' }}>
                        {s.turn_count} {turnsWord} · {relTime(s.updated_at)}
                      </Text>
                    </Row>
                  </Box>
                </Pressable>
                <Pressable onPress={() => deleteSession(s.id)}>
                  <Box style={{ paddingLeft: 1, paddingRight: 1 }}>
                    <Text style={{ color: '#f87171' }}>×</Text>
                  </Box>
                </Pressable>
              </Row>
            );
          })}
        </Col>
      )}
    </Col>
  );
}
