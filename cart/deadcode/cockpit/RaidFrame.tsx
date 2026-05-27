// RaidFrame — WoW-style agent status card. One card per claude/codex/kimi
// agent. Clicking fires props.onPress so the parent can target the matching
// Canvas.Node (pan the camera onto it).

import { C } from './style.cls';

export function RaidFrame(props: any) {
  const isActive = props.active === 1;
  const online = props.online === 1;
  const hpPct = props.hpPct;
  const powerPct = props.powerPct;
  const hpRem = 100 - hpPct;
  const powerRem = 100 - powerPct;

  return (
    <C.RaidFrame hoverable={1} onPress={props.onPress}>
      {isActive ? <C.RaidFrameBorderActive /> : <C.RaidFrameBorderIdle />}
      <C.RaidFrameHead>
        <C.RaidFrameClassPill style={{ backgroundColor: props.classColor }}>
          <C.RaidFrameClassLetter>{props.classLetter}</C.RaidFrameClassLetter>
        </C.RaidFrameClassPill>
        <C.RaidFrameNameCol>
          <C.RaidFrameName>{props.name}</C.RaidFrameName>
          <C.RaidFrameMeta>{props.meta}</C.RaidFrameMeta>
        </C.RaidFrameNameCol>
        {online ? <C.RaidFrameStatusOn /> : <C.RaidFrameStatusOff />}
      </C.RaidFrameHead>

      <C.RaidFrameHpBar>
        <C.RaidFrameHpFill style={{ flexGrow: hpPct, flexBasis: 0 }} />
        <C.RaidFrameHpGap style={{ flexGrow: hpRem, flexBasis: 0 }} />
      </C.RaidFrameHpBar>

      <C.RaidFramePowerBar>
        <C.RaidFramePowerFill style={{ flexGrow: powerPct, flexBasis: 0 }} />
        <C.RaidFramePowerGap style={{ flexGrow: powerRem, flexBasis: 0 }} />
      </C.RaidFramePowerBar>

      <C.RaidFrameFoot>
        <C.RaidFrameFootText>{props.role}</C.RaidFrameFootText>
        <C.Spacer />
        <C.RaidFrameFootText>{props.stat}</C.RaidFrameFootText>
      </C.RaidFrameFoot>
    </C.RaidFrame>
  );
}

export function RaidFrameEmpty(props: any) {
  return (
    <C.RaidFrameEmpty hoverable={1} onPress={props.onPress}>
      <C.RaidFrameEmptyPlus>+</C.RaidFrameEmptyPlus>
      <C.RaidFrameEmptyText>{props.label || 'summon agent'}</C.RaidFrameEmptyText>
    </C.RaidFrameEmpty>
  );
}
