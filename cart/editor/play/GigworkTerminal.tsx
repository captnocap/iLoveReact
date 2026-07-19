import { memo, type Dispatch } from 'react';
import { P } from './surfaces.cls';
import {
  GIGS,
  channelTextureKey,
  formatCredits,
  gigById,
  type GigDefinition,
  type GigTone,
  type PlayChannelAction,
  type PlayChannelState,
} from './channelModel';

const TONE_COLOR: Record<GigTone, string> = {
  cyan: 'theme:primary',
  amber: 'theme:warning',
  violet: 'theme:info',
  red: 'theme:error',
  green: 'theme:accent',
};

function RiskDots({ gig }: { gig: GigDefinition }) {
  return (
    <>
      {[1, 2, 3, 4, 5].map((risk) => (
        <P.PL_RiskDot key={risk} style={risk <= gig.risk ? { backgroundColor: TONE_COLOR[gig.tone] } : undefined} />
      ))}
    </>
  );
}

interface GigworkTerminalProps {
  state: PlayChannelState;
  dispatch: Dispatch<PlayChannelAction>;
}

function GigworkTerminalView({ state, dispatch }: GigworkTerminalProps) {
  const selected = gigById(state.selectedGigId) ?? GIGS[0]!;
  const active = gigById(state.activeGigId);
  const completing = active?.id === selected.id;
  const actionLabel = completing ? 'SUBMIT PROOF + COLLECT' : state.completedGigIds.includes(selected.id) ? 'RUN IT AGAIN' : 'ACCEPT CONTRACT';

  return (
    <P.PL_WallSurface staticKey={channelTextureKey('gigwork')} scale={1} testID="play-gigwork-channel">
      <P.PL_WallHeader>
        <P.PL_WallId>
          <P.PL_WallIdText>GW-ID: 000-7A1B-9F3C</P.PL_WallIdText>
          <P.PL_WallIdText>CLEARANCE: E- (EXHAUSTABLE)</P.PL_WallIdText>
          <P.PL_WallIdText>STATUS: ACTIVE · CH {state.revisions.gigwork}</P.PL_WallIdText>
        </P.PL_WallId>
        <P.PL_WallBrand>
          <P.PL_WallBrandTitle>GIGWORK</P.PL_WallBrandTitle>
          <P.PL_WallBrandStrap>work. suffer. upgrade.</P.PL_WallBrandStrap>
        </P.PL_WallBrand>
        <P.PL_WallUser>
          <P.PL_WallUserText>Welcome back,</P.PL_WallUserText>
          <P.PL_WallUserText>Exhaustable Asset.</P.PL_WallUserText>
        </P.PL_WallUser>
        <P.PL_CloseButton onPress={() => dispatch({ type: 'set-terminal-open', open: false })} testID="play-close-gigwork"><P.PL_CloseText>×</P.PL_CloseText></P.PL_CloseButton>
      </P.PL_WallHeader>

      <P.PL_WallBody>
        <P.PL_WallRail>
          <P.PL_InfoCard>
            <P.PL_InfoLabel>PAYMENT RECEIVED</P.PL_InfoLabel>
            <P.PL_InfoValue>{formatCredits(state.creditsCents)}</P.PL_InfoValue>
            <P.PL_InfoMeta>FROM: CROP DUSTER LABS{`\n`}TASK: PEST REMOVAL (HUMAN)</P.PL_InfoMeta>
          </P.PL_InfoCard>
          <P.PL_InfoCard>
            <P.PL_InfoLabel>ALGORITHM UPDATE</P.PL_InfoLabel>
            <P.PL_InfoValue style={{ fontSize: 13 }}>v9.4.{state.marketTick % 10}</P.PL_InfoValue>
            <P.PL_InfoMeta>MOOD STABILITY -3%{`\n`}COMPLIANCE +7%</P.PL_InfoMeta>
            <P.PL_SmallAction onPress={() => dispatch({ type: 'set-phone-app', app: 'feed' })}><P.PL_SmallActionText>VIEW PATCH NOTES</P.PL_SmallActionText></P.PL_SmallAction>
          </P.PL_InfoCard>
          <P.PL_InfoCardDanger>
            <P.PL_InfoLabel style={{ color: 'theme:error' }}>WARRANT ISSUED</P.PL_InfoLabel>
            <P.PL_DangerText>FAILURE TO SMILE (x2){`\n`}BAIL: {formatCredits(450_000)}</P.PL_DangerText>
            <P.PL_SmallAction onPress={() => dispatch({ type: 'set-phone-app', app: 'messages' })}><P.PL_SmallActionText>PAY OR DISPUTE</P.PL_SmallActionText></P.PL_SmallAction>
          </P.PL_InfoCardDanger>
        </P.PL_WallRail>

        <P.PL_WallCenter>
          <P.PL_GridHead>
            <P.PL_GridHeadText>⚠ NEW OPPORTUNITIES FOR YOU</P.PL_GridHeadText>
            <P.PL_Ticker>
              <P.PL_TickerLabel>PROPHET MARGIN</P.PL_TickerLabel>
              <P.PL_TickerValue>{formatCredits(state.marketPriceCents)}</P.PL_TickerValue>
            </P.PL_Ticker>
          </P.PL_GridHead>
          <P.PL_GigGrid>
            {GIGS.map((gig) => {
              const selectedCard = gig.id === state.selectedGigId;
              const activeCard = gig.id === state.activeGigId;
              return (
                <P.PL_GigCard
                  key={gig.id}
                  testID={`play-gig-${gig.id}`}
                  onPress={() => dispatch({ type: 'select-gig', gigId: gig.id })}
                  style={{
                    borderColor: selectedCard ? 'theme:warning' : TONE_COLOR[gig.tone],
                    borderWidth: selectedCard ? 2 : 1,
                    backgroundColor: selectedCard ? 'theme:segActiveBg' : activeCard ? 'theme:onTrack' : 'theme:cardBg',
                  }}
                >
                  <P.PL_GigTitle>{activeCard ? `● ${gig.title}` : gig.title}</P.PL_GigTitle>
                  <P.PL_GigStrap>{gig.strap}</P.PL_GigStrap>
                  <P.PL_GigFooter>
                    <RiskDots gig={gig} />
                    <P.PL_GigPayout>{formatCredits(gig.payoutCents)}</P.PL_GigPayout>
                  </P.PL_GigFooter>
                </P.PL_GigCard>
              );
            })}
          </P.PL_GigGrid>
          <P.PL_SelectedStrip>
            <P.PL_SelectedCopy>
              <P.PL_SelectedTitle>{selected.title}</P.PL_SelectedTitle>
              <P.PL_SelectedDetail>{selected.detail}</P.PL_SelectedDetail>
              <P.PL_SelectedMeta>CLIENT: {selected.client} · RISK {selected.risk}/5 · PAY {formatCredits(selected.payoutCents)}</P.PL_SelectedMeta>
            </P.PL_SelectedCopy>
            <P.PL_PrimaryAction
              testID="play-contract-action"
              onPress={() => dispatch({ type: completing ? 'complete-active' : 'accept-selected' })}
            >
              <P.PL_PrimaryActionText>{actionLabel}</P.PL_PrimaryActionText>
            </P.PL_PrimaryAction>
          </P.PL_SelectedStrip>
        </P.PL_WallCenter>

        <P.PL_WallNoticeRail>
          <P.PL_InfoLabel>NOTIFICATIONS</P.PL_InfoLabel>
          {state.notices.slice(0, 4).map((notice) => (
            <P.PL_Notice key={notice.id} style={{ borderColor: TONE_COLOR[notice.tone] }}>
              <P.PL_NoticeTitle style={{ color: TONE_COLOR[notice.tone] }}>{notice.title}</P.PL_NoticeTitle>
              <P.PL_NoticeDetail>{notice.detail}</P.PL_NoticeDetail>
            </P.PL_Notice>
          ))}
          <P.PL_Premium>
            <P.PL_PremiumTitle>GW PREMIUM</P.PL_PremiumTitle>
            <P.PL_PremiumText>LESS SUFFERING.</P.PL_PremiumText>
            <P.PL_PremiumText>MORE PROFIT.</P.PL_PremiumText>
          </P.PL_Premium>
        </P.PL_WallNoticeRail>
      </P.PL_WallBody>
    </P.PL_WallSurface>
  );
}

export const GigworkTerminal = memo(
  GigworkTerminalView,
  (before, after) => before.state.revisions.gigwork === after.state.revisions.gigwork,
);
