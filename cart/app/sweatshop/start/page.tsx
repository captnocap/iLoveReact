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
import { classifiers as S } from '@reactjit/core';
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
      backgroundColor: 'theme:bg1',
      borderColor: 'theme:rule',
      borderWidth: 1,
      borderRadius: 12,
    }}>
      <Icon icon={action.icon} size={20} color="theme:ink" />
      <S.Heading>{action.title}</S.Heading>
      <S.Caption>{action.hint}</S.Caption>
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
      backgroundColor: 'theme:bg2',
    }}>
      <Icon icon={FolderOpen} size={14} color="theme:inkDim" />
      <Col style={{ flexGrow: 1, gap: 2 }}>
        <S.Subheading>{ws.label}</S.Subheading>
        <S.Caption>{ws.rootPath}</S.Caption>
      </Col>
      <S.MicroDim>{ws.kind}</S.MicroDim>
    </Pressable>
  );
}

function RecentList() {
  const recent = useRecentWorkspaces(8);
  const nav = useNavigate();
  if (recent.loading) return <S.Caption>Loading…</S.Caption>;
  if (!recent.data.length) {
    return (
      <Box style={{
        padding: 20,
        borderColor: 'theme:rule',
        borderWidth: 1,
        borderStyle: 'dashed',
        borderRadius: 8,
      }}>
        <S.Caption>
          No recent projects. Pick "New" or "Add" above to get started.
        </S.Caption>
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
    <S.Card>
      <Row style={{ alignItems: 'center', gap: 8 }}>
        <Icon icon={MessageSquare} size={12} color="theme:inkDim" />
        <S.Label>Ask the agent</S.Label>
      </Row>

      {history.length ? (
        <Col style={{ gap: 4 }}>
          {history.slice(-3).map((line, i) => (
            <S.Caption key={i}>— {line}</S.Caption>
          ))}
        </Col>
      ) : (
        <Row style={{ gap: 6, flexWrap: 'wrap' }}>
          {AGENT_SUGGESTIONS.map((s) => (
            <Pressable key={s} onPress={() => setText(s)} style={{
              paddingVertical: 4,
              paddingHorizontal: 10,
              borderRadius: 999,
              backgroundColor: 'theme:bg2',
              borderColor: 'theme:rule',
              borderWidth: 1,
            }}>
              <S.TinyDim>{s}</S.TinyDim>
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
        <S.Button onPress={submit} style={{
          width: 36,
          height: 36,
          padding: 0,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Icon icon={SendHorizontal} size={14} color="theme:paper" />
        </S.Button>
      </Row>
    </S.Card>
  );
}

// ── Surface ──────────────────────────────────────────────────────────────

export default function StartPage() {
  const user = useUser();
  const name = user.data?.displayName ?? '';

  return (
    <S.Page style={{ flexDirection: 'column' }}>
      <ScrollView style={{ flexGrow: 1 }}>
        <Col style={{ padding: 32, gap: 24, maxWidth: 880, width: '100%', alignSelf: 'center' }}>
          <Col style={{ gap: 4 }}>
            <S.Title>
              {name ? `Welcome back, ${name}.` : 'Welcome to Sweatshop.'}
            </S.Title>
            <S.Caption>
              Pick up where you left off, or set up a new canvas.
            </S.Caption>
          </Col>

          <Row style={{ gap: 12 }}>
            {ACTIONS.map((a) => (
              <ActionTile key={a.id} action={a} onPress={() => {/* TODO */}} />
            ))}
          </Row>

          <Col style={{ gap: 10 }}>
            <Row style={{ alignItems: 'center', gap: 8 }}>
              <Icon icon={History} size={12} color="theme:inkDim" />
              <S.Label>Recent projects</S.Label>
            </Row>
            <RecentList />
          </Col>
        </Col>
      </ScrollView>

      <Box style={{ padding: 16, borderTopWidth: 1, borderTopColor: 'theme:rule' }}>
        <Box style={{ maxWidth: 880, width: '100%', alignSelf: 'center' }}>
          <AgentDock />
        </Box>
      </Box>
    </S.Page>
  );
}
