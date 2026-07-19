import { memo } from 'react';
import { P } from './surfaces.cls';
import { channelTextureKey, formatCredits, gigById, type PlayChannelState } from './channelModel';

const METER_COLORS = {
  health: 'theme:error',
  sanity: 'theme:info',
  compliance: 'theme:primary',
  notoriety: 'theme:warning',
} as const;

function Meter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <P.PL_MeterRow>
      <P.PL_MeterLabel>{label}</P.PL_MeterLabel>
      <P.PL_MeterTrack><P.PL_MeterFill style={{ width: `${value}%`, backgroundColor: color }} /></P.PL_MeterTrack>
      <P.PL_MeterValue>{value}%</P.PL_MeterValue>
    </P.PL_MeterRow>
  );
}

function IdentitySurfaceView({ state }: { state: PlayChannelState }) {
  const active = gigById(state.activeGigId);
  return (
    <P.PL_IdentitySurface staticKey={channelTextureKey('identity', 'player')} scale={1} testID="play-identity-channel">
      <P.PL_IdentityHead>
        <P.PL_IdentityLabel>PLAYER IDENTITY</P.PL_IdentityLabel>
        <P.PL_PlayerMeta style={{ marginLeft: 'auto' }}>CH {state.revisions.identity}</P.PL_PlayerMeta>
      </P.PL_IdentityHead>
      <P.PL_IdentityBody>
        <P.PL_Portrait><P.PL_PortraitHead /><P.PL_PortraitShoulders /></P.PL_Portrait>
        <P.PL_Stats>
          <P.PL_PlayerName>EXHAUSTABLE ASSET</P.PL_PlayerName>
          <P.PL_PlayerMeta>CLASS: DISPOSABLE · LVL 7</P.PL_PlayerMeta>
          <Meter label="HEALTH" value={state.health} color={METER_COLORS.health} />
          <Meter label="SANITY" value={state.sanity} color={METER_COLORS.sanity} />
          <Meter label="COMPLY" value={state.compliance} color={METER_COLORS.compliance} />
          <Meter label="NOTORIETY" value={state.notoriety} color={METER_COLORS.notoriety} />
        </P.PL_Stats>
      </P.PL_IdentityBody>
      <P.PL_IdentityFoot>
        <P.PL_DebtText>DEBTS: -{formatCredits(482_311)} · CASH: {formatCredits(state.creditsCents)}</P.PL_DebtText>
        <P.PL_StatusLine>{active ? `ACTIVE: ${active.title}` : 'ACTIVE: SEEKING REPLACEMENT INCOME'} · WARRANTS {state.warrants} · UNREAD {state.unread}</P.PL_StatusLine>
      </P.PL_IdentityFoot>
    </P.PL_IdentitySurface>
  );
}

export const IdentitySurface = memo(
  IdentitySurfaceView,
  (before, after) => before.state.revisions.identity === after.state.revisions.identity,
);
