// Persistent assistant chat — root.
//
// Two visible shapes:
//   - 'side'     — pinned in the side rail, above the InputStrip (or
//                  alone, when the InputStrip morphed to full-bottom for
//                  an activity claim). 95% of the time the chat lives
//                  here.
//   - 'activity' — fills the activity content area. Only on the /chat
//                  route. The rail's chat slot still renders 'side' but
//                  with the history-list empty state, since live turns
//                  are visible in the activity area instead.
//
// Empty-chat state: if the current session has no turns the surface
// renders a clickable history list of past sessions. Sending the first
// message replaces that view with the live transcript.
//
// Identity: the chat may re-mount when its slot changes, but the
// thread state lives in `./store`, so the transcript content survives
// the swap.

import { classifiers as S } from '@reactjit/core';
import type { ChatShape, ParallelCandidate } from './types';
import {
  loadSession,
  startNewSession,
  useChatSessions,
  useChatStatus,
  useChatTurns,
  useCurrentSessionId,
} from './store';
import { AssistantTurn } from './AssistantTurn';
import { ParallelAssistantTurn, ParallelLaneControls } from './ParallelAssistantTurn';

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'JUST NOW';
  if (m < 60) return `${m}M AGO`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}H AGO`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}D AGO`;
  return new Date(iso).toISOString().slice(0, 10);
}

function ChatHistoryList({
  excludeId,
  activeId,
}: {
  excludeId?: string | null;
  activeId?: string | null;
}) {
  const sessions = useChatSessions();
  const visible = excludeId ? sessions.filter((s) => s.id !== excludeId) : sessions;
  if (visible.length === 0) {
    return (
      <S.AppChatHistoryEmpty>
        <S.AppChatHistoryEmptyText>
          {sessions.length === 0
            ? 'NO PAST CHATS — TYPE BELOW TO START ONE.'
            : 'NO OTHER CHATS.'}
        </S.AppChatHistoryEmptyText>
      </S.AppChatHistoryEmpty>
    );
  }
  return (
    <S.AppChatHistoryList>
      {visible.map((s) => {
        const Row = s.id === activeId ? S.AppChatHistoryRowActive : S.AppChatHistoryRow;
        const meta = `${s.turn_count} TURN${s.turn_count === 1 ? '' : 'S'} · ${relTime(s.updated_at)}`;
        return (
          <Row key={s.id} onPress={() => loadSession(s.id)}>
            <S.AppChatHistoryRowTitle>{truncate(s.title || '(untitled)', 56)}</S.AppChatHistoryRowTitle>
            <S.AppChatHistoryRowMeta>{meta}</S.AppChatHistoryRowMeta>
          </Row>
        );
      })}
    </S.AppChatHistoryList>
  );
}

/** AssistantChat renders the chat surface in one of three roles:
 *  - shape='hidden'   → null (cold home)
 *  - shape='side'     → rail slot. When `chatIsActivity` is true the
 *                       live chat is already painted in the activity
 *                       area, so the rail pivots to a history list of
 *                       OTHER chats (the current session is filtered
 *                       out so we don't show the same conversation
 *                       twice). Otherwise it shows the live transcript
 *                       (or history list when no current session).
 *  - shape='activity' → /chat's content area. Always live transcript;
 *                       empty state when there's no current session.
 */
export function AssistantChat({
  shape,
  chatIsActivity = false,
  parallel,
}: {
  shape: ChatShape;
  chatIsActivity?: boolean;
  parallel?: {
    laneCount: number;
    lanes: ParallelCandidate[];
    modelOptions: Array<{ id: string; label: string }>;
    onAddLane: () => void;
    onRemoveLane: (laneIndex: number) => void;
    onSelectLaneModel: (laneIndex: number, modelId: string) => void;
  };
}) {
  const turns = useChatTurns();
  const status = useChatStatus();
  const currentId = useCurrentSessionId();
  if (shape === 'hidden') return null;

  const isSide = shape === 'side';
  const showLift = shape === 'activity';
  const turnCount = turns.length;
  const hasActiveSession = currentId !== null && turnCount > 0;
  // The rail always shows OTHER chats when the live chat owns the
  // activity area — otherwise the user sees the same conversation
  // duplicated in two panels at once.
  const railShowsHistory = isSide && (chatIsActivity || !hasActiveSession);

  // Header subline shows live phase/error so the user can see what the
  // session is doing — esp. when the asst turn is empty (init / loading
  // / failed). Falls back to the persistent-thread tagline when chat is
  // idle and clean.
  const phaseLabel = status.error
    ? `ERROR · ${truncate(status.error, 64)}`
    : status.phase === 'init' || status.phase === 'loading'
    ? `STARTING SESSION…`
    : status.phase === 'loaded' || status.phase === 'idle'
    ? (status.lastStatus
        ? status.lastStatus.toUpperCase()
        : `READY · ${turnCount} TURN${turnCount === 1 ? '' : 'S'}`)
    : status.phase === 'generating'
    ? `GENERATING…`
    : status.phase === 'failed'
    ? `FAILED · ${truncate(status.error || status.lastStatus || 'no detail', 64)}`
    : `PERSISTENT · ${turnCount} TURNS · DRAG ANY SURFACE TO CART`;
  const panelMode = parallel
    ? `${parallel.laneCount} LANE${parallel.laneCount === 1 ? '' : 'S'}`
    : railShowsHistory ? 'HISTORY' : 'ACTIVE';

  return (
    <S.AppChatPanel>
      <S.AppChatPanelHeader>
        <S.AppChatPanelHeaderLeft>
          <S.AppChatPanelHeaderDot />
          <S.AppChatPanelHeaderTitle>01 ASSISTANT</S.AppChatPanelHeaderTitle>
          {isSide || parallel ? (
            <S.AppChatPanelHeaderState>
              <S.AppChatPanelHeaderStateText>
                {panelMode}
              </S.AppChatPanelHeaderStateText>
            </S.AppChatPanelHeaderState>
          ) : null}
        </S.AppChatPanelHeaderLeft>
        {parallel || hasActiveSession ? (
          <S.AppChatPanelHeaderToggle onPress={() => parallel ? parallel.onAddLane() : startNewSession()}>
            <S.AppChatPanelHeaderToggleText>+</S.AppChatPanelHeaderToggleText>
          </S.AppChatPanelHeaderToggle>
        ) : null}
      </S.AppChatPanelHeader>

      {isSide ? (
        <S.AppChatPanelSubline>
          <S.AppChatPanelSublineText>
            {phaseLabel}
          </S.AppChatPanelSublineText>
        </S.AppChatPanelSubline>
      ) : null}

      {parallel && parallel.lanes.length > 0 ? (
        <ParallelLaneControls
          candidates={parallel.lanes}
          modelOptions={parallel.modelOptions}
          onRemove={parallel.onRemoveLane}
          onSelectModel={parallel.onSelectLaneModel}
        />
      ) : null}

      <S.AppChatTranscript>
        {railShowsHistory ? (
          <ChatHistoryList
            excludeId={chatIsActivity ? currentId : null}
            activeId={chatIsActivity ? null : currentId}
          />
        ) : turnCount === 0 ? (
          <S.AppChatHistoryEmpty>
            <S.AppChatHistoryEmptyText>
              {currentId
                ? 'THIS CHAT HAS NO MESSAGES YET — TYPE BELOW TO PICK IT BACK UP.'
                : 'TYPE BELOW TO START A NEW CHAT.'}
            </S.AppChatHistoryEmptyText>
          </S.AppChatHistoryEmpty>
        ) : (
          turns.map((t) => (
            t.author === 'parallel'
              ? <ParallelAssistantTurn key={t.id} turn={t} compact={isSide} />
              : <AssistantTurn key={t.id} turn={t} showLift={showLift} />
          ))
        )}
      </S.AppChatTranscript>
    </S.AppChatPanel>
  );
}
