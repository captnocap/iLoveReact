import { createElement, useEffect, useReducer } from 'react';
import { useModifiers } from '../../../runtime/hooks/useModifiers';
import { envGet } from '../../../runtime/hooks/process';
import { P } from './surfaces.cls';
import { GigworkTerminal } from './GigworkTerminal';
import { PhoneSurface } from './PhoneSurface';
import { IdentitySurface } from './IdentitySurface';
import { PLAY_CHANNEL_TUNING, initialPlayChannelState, playChannelReducer } from './channelModel';

interface CriminalCareersPlayProps {
  gameFile: string;
  storeDir: string;
}

// RJIT_PLAY_CLEAR_UI=1 boots /play with the terminal and phone dismissed —
// the headless parity-shot knob (req_4294, RJIT_HIDE_WALLS's family): a shot
// of the world needs the world, not the chrome. G/P still reopen everything.
function bootChannelState() {
  const initial = initialPlayChannelState();
  if (envGet('RJIT_PLAY_CLEAR_UI') === '1') {
    return { ...initial, terminalOpen: false, phoneOpen: false };
  }
  return initial;
}

export default function CriminalCareersPlay({ gameFile, storeDir }: CriminalCareersPlayProps) {
  const [state, dispatch] = useReducer(playChannelReducer, undefined, bootChannelState);
  const { onKeyDown } = useModifiers();

  useEffect(() => {
    const timer = setInterval(() => dispatch({ type: 'tick-market' }), PLAY_CHANNEL_TUNING.marketTickMs);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const off = onKeyDown((key, mods) => {
      if (mods.ctrl || mods.alt || mods.meta) return;
      if (key === 'p') dispatch({ type: 'toggle-phone' });
      else if (key === 'g') dispatch({ type: 'toggle-terminal' });
      else if (key === 'escape') dispatch({ type: 'dismiss-surfaces' });
    });
    return off;
    // Subscribe once. onKeyDown is a stable bus door even though the hook returns
    // a new wrapper object on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <P.PL_Root testID="criminal-careers-play">
      <P.PL_Backdrop />
      {createElement('WorldLoader', {
        gameFile,
        storeDir,
        testID: 'play-world-loader',
        style: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, width: '100%', height: '100%', backgroundColor: '#0d141f' },
      })}
      <P.PL_WorldWash />

      {state.terminalOpen && <GigworkTerminal state={state} dispatch={dispatch} />}
      <IdentitySurface state={state} />
      {state.phoneOpen && <PhoneSurface state={state} dispatch={dispatch} />}

      <P.PL_WorldBadge><P.PL_WorldDot /><P.PL_WorldBadgeText>WORLD LIVE · CHANNELS EVENT-DRIVEN</P.PL_WorldBadgeText></P.PL_WorldBadge>
      <P.PL_KeyLegend><P.PL_KeyText>G  GIGWORK</P.PL_KeyText><P.PL_KeyText>P  PHONE</P.PL_KeyText><P.PL_KeyText>ESC  CLEAR UI / RELEASE WORLD INPUT</P.PL_KeyText></P.PL_KeyLegend>

      {(!state.terminalOpen || !state.phoneOpen) && (
        <P.PL_Launchers>
          {!state.terminalOpen && <P.PL_Launcher onPress={() => dispatch({ type: 'set-terminal-open', open: true })} testID="play-open-gigwork"><P.PL_LauncherHotkey><P.PL_LauncherHotkeyText>G</P.PL_LauncherHotkeyText></P.PL_LauncherHotkey><P.PL_LauncherText>GIGWORK TERMINAL</P.PL_LauncherText></P.PL_Launcher>}
          {!state.phoneOpen && <P.PL_Launcher onPress={() => dispatch({ type: 'set-phone-open', open: true })} testID="play-open-phone"><P.PL_LauncherHotkey><P.PL_LauncherHotkeyText>P</P.PL_LauncherHotkeyText></P.PL_LauncherHotkey><P.PL_LauncherText>PERSONAL PHONE · {state.unread}</P.PL_LauncherText></P.PL_Launcher>}
        </P.PL_Launchers>
      )}
    </P.PL_Root>
  );
}
