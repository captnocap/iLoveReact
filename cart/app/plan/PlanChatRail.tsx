// PlanChatRail — replaces the rail's AssistantChat slot when on
// /sweatshop/plan. Mirrors the assistant chat header shape ("01
// ASSISTANT" → "02 PLANNING") so the two surfaces feel like
// numbered tabs of the same chrome, not like two separate things.
//
// State lives in plan/chatStore.ts so the rail and the page both
// read it without prop drilling.

import { Box, Col, Pressable, Row, ScrollView, Text } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import { setDraft, useChatTurns, useDraft } from './chatStore';

function ActivePill() {
  return (
    <Row style={{
      alignItems: 'center', gap: 6,
      paddingTop: 3, paddingBottom: 3, paddingLeft: 8, paddingRight: 8,
      borderRadius: 999, backgroundColor: 'theme:accent',
    }}>
      <Box style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: 'theme:paper' }} />
      <Text size={11} bold color="theme:paper">ACTIVE INPUT</Text>
    </Row>
  );
}

export function PlanChatRail() {
  const turns = useChatTurns();
  const draft = useDraft();
  const plannerActive = draft === null;

  return (
    <S.AppChatPanel>
      <S.AppChatPanelHeader>
        <S.AppChatPanelHeaderLeft>
          <S.AppChatPanelHeaderDot />
          <S.AppChatPanelHeaderTitle>02 PLANNING</S.AppChatPanelHeaderTitle>
          <S.AppChatPanelHeaderState>
            <S.AppChatPanelHeaderStateText>
              {plannerActive ? 'PLANNER' : 'STAGING'}
            </S.AppChatPanelHeaderStateText>
          </S.AppChatPanelHeaderState>
          {plannerActive ? <ActivePill /> : null}
        </S.AppChatPanelHeaderLeft>
      </S.AppChatPanelHeader>

      <S.AppChatPanelSubline>
        <S.AppChatPanelSublineText>
          {plannerActive
            ? 'Type → talk to the planner.'
            : `Type → comment on @${draft.label}.`}
        </S.AppChatPanelSublineText>
      </S.AppChatPanelSubline>

      {!plannerActive ? (
        <Box style={{
          marginLeft: 12, marginRight: 12, marginTop: 8,
          padding: 10, borderRadius: 4,
          borderWidth: 1, borderColor: 'theme:accent',
          backgroundColor: 'theme:bg2',
          gap: 6,
        }}>
          <Row style={{ alignItems: 'center', gap: 8 }}>
            <Text size={11} bold color="theme:accent">@TARGET</Text>
            <Text size={13} bold color="theme:ink" style={{ flexGrow: 1 }}>{draft.label}</Text>
            <Pressable onPress={() => setDraft(null)}>
              <Text size={11} color="theme:inkDim">cancel</Text>
            </Pressable>
          </Row>
        </Box>
      ) : null}

      <ScrollView style={{ flexGrow: 1, width: '100%', minHeight: 0 }}>
        <Col style={{ padding: 12, gap: 14 }}>
          {turns.length === 0 ? (
            <Text size={13} color="theme:inkDim">
              No chat yet — type below to talk to the planner. Click any node on the plan to comment instead.
            </Text>
          ) : null}
          {turns.map((t) => (
            <Col key={t.id} style={{ gap: 4 }}>
              <Text size={11} bold color={t.author === 'user' ? 'theme:accent' : 'theme:inkDim'}>
                {t.author === 'user' ? 'YOU' : 'PLANNER'}
              </Text>
              <Text size={14} color="theme:ink" style={{ lineHeight: 21 }}>
                {t.body}
              </Text>
            </Col>
          ))}
        </Col>
      </ScrollView>
    </S.AppChatPanel>
  );
}
