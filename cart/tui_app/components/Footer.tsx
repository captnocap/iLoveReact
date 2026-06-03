// Footer — active chat switcher pinned to the bottom of the shell.
//
// This is deliberately NOT the historical session list. It renders only
// sessions opened/created during the current TUI runtime, so the bottom
// row behaves like active chat tabs rather than a recents drawer.

import * as React from 'react';
import { Box, Row, Text, TextInput, Pressable } from '@reactjit/primitives';
import {
  loadSession,
  renameSession,
  startNewSession,
  useActiveChatSessions,
  useCurrentSessionId,
} from '../../app/chat/store';
import { useNavigate } from '../../app/gallery/local-router';

function clipTitle(raw: string, max = 18): string {
  const s = (raw || '(untitled)').trim() || '(untitled)';
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function Footer() {
  const activeSessions = useActiveChatSessions();
  const sessions = React.useMemo(() => {
    const seen = new Set<string>();
    return activeSessions.filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
  }, [activeSessions]);
  const currentId = useCurrentSessionId();
  const nav = useNavigate();
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const draftRef = React.useRef('');
  draftRef.current = draft;

  const openSession = (id: string) => {
    if (renamingId) return;
    loadSession(id);
    nav.push('/chat');
  };

  const openFresh = () => {
    if (renamingId) return;
    startNewSession();
    nav.push('/chat');
  };

  const startRename = (session: { id: string; title: string }) => {
    setRenamingId(session.id);
    setDraft(session.title || '');
    draftRef.current = session.title || '';
  };

  const commitRename = () => {
    if (!renamingId) return;
    renameSession(renamingId, draftRef.current);
    setRenamingId(null);
    setDraft('');
    draftRef.current = '';
  };

  const cancelRename = () => {
    setRenamingId(null);
    setDraft('');
    draftRef.current = '';
  };

  return (
    <Row style={{ width: '100%', backgroundColor: '#111827', paddingLeft: 1, paddingRight: 1, gap: 1 }}>
      {sessions.map((session, index) => {
        const active = session.id === currentId;
        const isRenaming = renamingId === session.id;
        return (
          <Box key={session.id}>
            {isRenaming ? (
              <Box style={{
                paddingLeft: 1,
                paddingRight: 1,
                backgroundColor: '#0b1020',
                borderWidth: 1,
                borderColor: '#fbbf24',
              }}>
                <Row style={{ gap: 1 }}>
                  <Text style={{ color: '#fbbf24' }}>[{index + 1}</Text>
                  <Box style={{ width: 18 }}>
                    <TextInput
                      value={draft}
                      onChangeText={setDraft}
                      onSubmit={commitRename}
                      placeholder="chat title"
                      style={{
                        width: '100%',
                        color: '#e7eaff',
                        backgroundColor: 'transparent',
                        borderWidth: 0,
                      }}
                    />
                  </Box>
                  <Pressable onPress={commitRename}>
                    <Text style={{ color: '#22d3ee' }}>save</Text>
                  </Pressable>
                  <Pressable onPress={cancelRename}>
                    <Text style={{ color: '#94a3b8' }}>x]</Text>
                  </Pressable>
                </Row>
              </Box>
            ) : (
              <Pressable
                onPress={() => openSession(session.id)}
                onRightClick={() => startRename(session)}
              >
                <Box style={{
                  paddingLeft: 1,
                  paddingRight: 1,
                  backgroundColor: active ? '#fbbf24' : '#1f2937',
                }}>
                  <Text style={{
                    color: active ? '#000000' : '#94a3b8',
                    fontWeight: active ? 'bold' : 'normal',
                  }}>
                    [{index + 1} {clipTitle(session.title)}]
                  </Text>
                </Box>
              </Pressable>
            )}
          </Box>
        );
      })}
      <Pressable onPress={openFresh}>
        <Box style={{ paddingLeft: 1, paddingRight: 1, backgroundColor: '#1f2937' }}>
          <Text style={{ color: '#22d3ee', fontWeight: 'bold' }}>[+]</Text>
        </Box>
      </Pressable>
    </Row>
  );
}
