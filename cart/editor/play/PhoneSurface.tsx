import { memo, type Dispatch } from 'react';
import { P } from './surfaces.cls';
import {
  PLAY_CHANNEL_TUNING,
  channelTextureKey,
  formatCredits,
  visiblePhonePosts,
  type GigTone,
  type PhoneApp,
  type PlayChannelAction,
  type PlayChannelState,
} from './channelModel';

const TONE_COLOR: Record<GigTone, string> = {
  cyan: 'theme:primary', amber: 'theme:warning', violet: 'theme:info', red: 'theme:error', green: 'theme:accent',
};

interface PhoneSurfaceProps {
  state: PlayChannelState;
  dispatch: Dispatch<PlayChannelAction>;
}

function PhoneTabs({ state, dispatch }: PhoneSurfaceProps) {
  const tabs: readonly [PhoneApp, string][] = [['feed', 'FEED'], ['messages', 'MESSAGES'], ['market', 'MARKET']];
  return (
    <P.PL_PhoneTabs>
      {tabs.map(([app, label]) => {
        const Tab = state.phoneApp === app ? P.PL_PhoneTabOn : P.PL_PhoneTab;
        const Txt = state.phoneApp === app ? P.PL_PhoneTabTextOn : P.PL_PhoneTabText;
        return <Tab key={app} onPress={() => dispatch({ type: 'set-phone-app', app })}><Txt>{label}</Txt></Tab>;
      })}
    </P.PL_PhoneTabs>
  );
}

function FeedView({ state, dispatch }: PhoneSurfaceProps) {
  const rows = visiblePhonePosts(state);
  const last = Math.min(state.feed.length, state.phoneWindowStart + rows.length);
  return (
    <>
      <P.PL_PhoneContent>
        {rows.map((post) => (
          <P.PL_Post key={post.id}>
            <P.PL_PostAccent style={{ backgroundColor: TONE_COLOR[post.tone] }} />
            <P.PL_PostBody>
              <P.PL_PostHead><P.PL_PostAuthor>{post.author}</P.PL_PostAuthor><P.PL_PostAge>{post.age}</P.PL_PostAge></P.PL_PostHead>
              <P.PL_PostHandle>{post.handle}</P.PL_PostHandle>
              <P.PL_PostText>{post.body}</P.PL_PostText>
              <P.PL_PostStats>
                <P.PL_PostStat>♡ {post.reactions}</P.PL_PostStat>
                <P.PL_PostStat>↻ {post.reposts}</P.PL_PostStat>
                <P.PL_PostStat>◌ {post.replies}</P.PL_PostStat>
              </P.PL_PostStats>
            </P.PL_PostBody>
          </P.PL_Post>
        ))}
      </P.PL_PhoneContent>
      <P.PL_PhonePageBar>
        <P.PL_PageButton onPress={() => dispatch({ type: 'page-phone', delta: -1 })}><P.PL_PageButtonText>↑</P.PL_PageButtonText></P.PL_PageButton>
        <P.PL_PageMeta>{state.phoneWindowStart + 1}-{last} / {state.feed.length} · {PLAY_CHANNEL_TUNING.phoneWindowSize} MATERIALIZED</P.PL_PageMeta>
        <P.PL_PageButton onPress={() => dispatch({ type: 'page-phone', delta: 1 })}><P.PL_PageButtonText>↓</P.PL_PageButtonText></P.PL_PageButton>
      </P.PL_PhonePageBar>
    </>
  );
}

function MessagesView({ state }: { state: PlayChannelState }) {
  return (
    <P.PL_PhoneContent>
      {state.notices.slice(0, 6).map((notice) => (
        <P.PL_MessageCard key={notice.id} style={{ borderLeftWidth: 3, borderLeftColor: TONE_COLOR[notice.tone] }}>
          <P.PL_MessageTitle style={{ color: TONE_COLOR[notice.tone] }}>{notice.title}</P.PL_MessageTitle>
          <P.PL_MessageBody>{notice.detail}</P.PL_MessageBody>
        </P.PL_MessageCard>
      ))}
    </P.PL_PhoneContent>
  );
}

function MarketView({ state }: { state: PlayChannelState }) {
  return (
    <P.PL_PhoneContent>
      <P.PL_MarketHero>
        <P.PL_MarketLabel>PROPHET MARGIN / LIVE</P.PL_MarketLabel>
        <P.PL_MarketPrice>{formatCredits(state.marketPriceCents)}</P.PL_MarketPrice>
        <P.PL_MarketMeta>TICK {state.marketTick} · VOLATILITY IS A FEATURE</P.PL_MarketMeta>
      </P.PL_MarketHero>
      {['WHY-C +3.2%', 'AILLOTS -1.8%', 'DROWN +7.4%', 'KYC HALTED'].map((line, index) => (
        <P.PL_MessageCard key={line}>
          <P.PL_MessageTitle style={{ color: index === 1 ? 'theme:error' : 'theme:accent' }}>{line}</P.PL_MessageTitle>
          <P.PL_MessageBody>Sponsored signal. Past performance may be fabricated.</P.PL_MessageBody>
        </P.PL_MessageCard>
      ))}
    </P.PL_PhoneContent>
  );
}

function PhoneSurfaceView({ state, dispatch }: PhoneSurfaceProps) {
  return (
    <P.PL_PhoneSurface staticKey={channelTextureKey('phone', 'player')} scale={1} testID="play-phone-channel">
      <P.PL_PhoneTop>
        <P.PL_PhoneTopText>23:{String(40 + (state.marketTick % 20)).padStart(2, '0')}</P.PL_PhoneTopText>
        <P.PL_PhoneSignal>▮▮▮  ◉  87%</P.PL_PhoneSignal>
        <P.PL_PhoneClose onPress={() => dispatch({ type: 'set-phone-open', open: false })} testID="play-close-phone"><P.PL_PhoneCloseText>×</P.PL_PhoneCloseText></P.PL_PhoneClose>
      </P.PL_PhoneTop>
      <P.PL_PhoneAppHead>
        <P.PL_PhoneLogo><P.PL_PhoneLogoText>f</P.PL_PhoneLogoText></P.PL_PhoneLogo>
        <P.PL_WallId>
          <P.PL_PhoneAppTitle>FlockBook</P.PL_PhoneAppTitle>
          <P.PL_PhoneAppMeta>DROWN VERIFIED NETWORK</P.PL_PhoneAppMeta>
        </P.PL_WallId>
        <P.PL_UnreadPill onPress={() => dispatch({ type: 'mark-phone-read' })} testID="play-phone-unread"><P.PL_UnreadText>{state.unread}</P.PL_UnreadText></P.PL_UnreadPill>
      </P.PL_PhoneAppHead>
      <PhoneTabs state={state} dispatch={dispatch} />
      {state.phoneApp === 'feed' ? <FeedView state={state} dispatch={dispatch} /> : state.phoneApp === 'messages' ? <MessagesView state={state} /> : <MarketView state={state} />}
      <P.PL_PhoneNav>
        <P.PL_PhoneNavText>Feed</P.PL_PhoneNavText><P.PL_PhoneNavText>Watch</P.PL_PhoneNavText><P.PL_PhoneNavText>Market</P.PL_PhoneNavText><P.PL_PhoneNavText>Notify {state.unread}</P.PL_PhoneNavText><P.PL_PhoneNavText>Profile</P.PL_PhoneNavText>
      </P.PL_PhoneNav>
    </P.PL_PhoneSurface>
  );
}

export const PhoneSurface = memo(
  PhoneSurfaceView,
  (before, after) => before.state.revisions.phone === after.state.revisions.phone,
);
