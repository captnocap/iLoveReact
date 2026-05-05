// Start — the welcome surface.
//
// Feels like opening an IDE: New project / Add project / Recent projects.
// At the bottom, a single text input wired to an agent that can answer
// questions immediately, resume projects, or kick off new ones.
//
// This is the default route. Composer/Sequencer/Trace are project-scoped;
// you don't see them until you've picked or created a project.
//
// Scaffold-stage: project-action buttons and the agent input are stubbed.
// "Recent projects" reads from the persisted `Workspace` collection
// (namespace `app`) so a returning user with onboarding done sees their
// real workspace listed, not a mock.

import { useState } from 'react';
import { Box, Col, Pressable, Row, ScrollView, Text, TextInput } from '@reactjit/runtime/primitives';
import { useNavigate } from '@reactjit/runtime/router';
import { Icon } from '@reactjit/runtime/icons/Icon';
import { FilePlus, FolderOpen, History, MessageSquare, SendHorizontal } from '@reactjit/runtime/icons/icons';
import type { Workspace } from '../../gallery/data/overstock/workspace';
import { useRecentWorkspaces, useUser } from '../data';

// ── Action tile ──────────────────────────────────────────────────────────

type ActionDef = {
  id: 'new' | 'add';
  title: string;
  hint: string;
  icon: number[][];
};

const ACTIONS: ActionDef[] = [
  { id: 'new', title: 'New project',  hint: 'Start a fresh canvas',         icon: FilePlus   },
  { id: 'add', title: 'Add project',  hint: 'Point at an existing folder',  icon: FolderOpen },
];

function ActionTile({ action, onPress }: { action: ActionDef; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{
      flexGrow: 1,
      flexBasis: 0,
      flexDirection: 'column',
      gap: 8,
      padding: 20,
      backgroundColor: 'theme:surface',
      borderColor: 'theme:lineSoft',
      borderWidth: 1,
      borderRadius: 12,
    }}>
      <Icon icon={action.icon} size={20} color="theme:ink" />
      <Text size={14} color="theme:ink" bold={true}>{action.title}</Text>
      <Text size={11} color="theme:inkMuted">{action.hint}</Text>
    </Pressable>
  );
}

// ── Recent project row ───────────────────────────────────────────────────

function RecentRow({ ws, onPress }: { ws: Workspace; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 8,
      backgroundColor: 'theme:surfaceSubtle',
    }}>
      <Icon icon={FolderOpen} size={14} color="theme:inkMuted" />
      <Col style={{ flexGrow: 1, gap: 2 }}>
        <Text size={12} color="theme:ink" bold={true}>{ws.label}</Text>
        <Text size={10} color="theme:inkMuted">{ws.rootPath}</Text>
      </Col>
      <Text size={9} color="theme:inkMuted">{ws.kind}</Text>
    </Pressable>
  );
}

function RecentList() {
  const recent = useRecentWorkspaces(8);
  const nav = useNavigate();
  if (recent.loading) return <Text size={11} color="theme:inkMuted">Loading…</Text>;
  if (!recent.data.length) {
    return (
      <Box style={{
        padding: 20,
        borderColor: 'theme:lineSoft',
        borderWidth: 1,
        borderStyle: 'dashed',
        borderRadius: 8,
      }}>
        <Text size={11} color="theme:inkMuted">
          No recent projects. Pick "New" or "Add" above to get started.
        </Text>
      </Box>
    );
  }
  return (
    <Col style={{ gap: 6 }}>
      {recent.data.map((ws) => (
        <RecentRow key={ws.id} ws={ws} onPress={() => nav.push('/canvas')} />
      ))}
    </Col>
  );
}

// ── Agent dock ───────────────────────────────────────────────────────────

const AGENT_SUGGESTIONS = [
  'Resume my last project',
  'What was I working on?',
  'Start something new',
];

function AgentDock() {
  const [text, setText] = useState('');
  const [history, setHistory] = useState<string[]>([]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setHistory((h) => [...h, trimmed]);
    setText('');
    // TODO: route through an agent — for now, the message is just remembered.
  };

  return (
    <Col style={{
      gap: 10,
      padding: 16,
      backgroundColor: 'theme:surface',
      borderColor: 'theme:lineSoft',
      borderWidth: 1,
      borderRadius: 12,
    }}>
      <Row style={{ alignItems: 'center', gap: 8 }}>
        <Icon icon={MessageSquare} size={12} color="theme:inkMuted" />
        <Text size={11} color="theme:inkMuted" bold={true}>Ask the agent</Text>
      </Row>

      {history.length ? (
        <Col style={{ gap: 4 }}>
          {history.slice(-3).map((line, i) => (
            <Text key={i} size={11} color="theme:inkMuted">— {line}</Text>
          ))}
        </Col>
      ) : (
        <Row style={{ gap: 6, flexWrap: 'wrap' }}>
          {AGENT_SUGGESTIONS.map((s) => (
            <Pressable key={s} onPress={() => setText(s)} style={{
              paddingVertical: 4,
              paddingHorizontal: 10,
              borderRadius: 999,
              backgroundColor: 'theme:surfaceSubtle',
              borderColor: 'theme:lineSoft',
              borderWidth: 1,
            }}>
              <Text size={10} color="theme:inkMuted">{s}</Text>
            </Pressable>
          ))}
        </Row>
      )}

      <Row style={{ gap: 8, alignItems: 'center' }}>
        <TextInput
          value={text}
          onChange={setText}
          onSubmit={submit}
          placeholder="Ask anything, or describe what you want to build…"
          style={{
            flexGrow: 1,
            height: 36,
            fontSize: 13,
            color: 'theme:ink',
            backgroundColor: 'theme:bg2',
            borderWidth: 1,
            borderColor: 'theme:rule',
            borderRadius: 8,
            paddingLeft: 12,
            paddingRight: 12,
          }}
        />
        <Pressable onPress={submit} style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          backgroundColor: 'theme:accent',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Icon icon={SendHorizontal} size={14} color="theme:onAccent" />
        </Pressable>
      </Row>
    </Col>
  );
}

// ── Surface ──────────────────────────────────────────────────────────────

export default function StartPage() {
  const user = useUser();
  const name = user.data?.displayName ?? '';

  return (
    <Col style={{ flexGrow: 1, backgroundColor: 'theme:bg' }}>
      <ScrollView style={{ flexGrow: 1 }}>
        <Col style={{ padding: 32, gap: 24, maxWidth: 880, width: '100%', alignSelf: 'center' }}>
          <Col style={{ gap: 4 }}>
            <Text size={24} color="theme:ink" bold={true}>
              {name ? `Welcome back, ${name}.` : 'Welcome to Sweatshop.'}
            </Text>
            <Text size={12} color="theme:inkMuted">
              Pick up where you left off, or set up a new canvas.
            </Text>
          </Col>

          <Row style={{ gap: 12 }}>
            {ACTIONS.map((a) => (
              <ActionTile key={a.id} action={a} onPress={() => {/* TODO */}} />
            ))}
          </Row>

          <Col style={{ gap: 10 }}>
            <Row style={{ alignItems: 'center', gap: 8 }}>
              <Icon icon={History} size={12} color="theme:inkMuted" />
              <Text size={11} color="theme:inkMuted" bold={true}>Recent projects</Text>
            </Row>
            <RecentList />
          </Col>
        </Col>
      </ScrollView>

      <Box style={{ padding: 16, borderTopWidth: 1, borderTopColor: 'theme:lineSoft' }}>
        <Box style={{ maxWidth: 880, width: '100%', alignSelf: 'center' }}>
          <AgentDock />
        </Box>
      </Box>
    </Col>
  );
}
