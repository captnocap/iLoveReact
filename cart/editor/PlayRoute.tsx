// editor/PlayRoute.tsx — the /play route.
//
// WorldLoader remains the authoritative native game renderer. The dynamic editor
// route composes retained document channels over it so the Gigwork wall, personal
// phone, and identity readout can be exercised together before their dictionaries
// are baked into the no-JS ship lump.
import { useMemo } from 'react';
import { Box, Text } from '@reactjit/primitives';
import CriminalCareersPlay from './play/CriminalCareersPlay';
import {
  playerCharacterPackage,
  pushPlayerCharacter,
  resolvePlayerCharacter,
} from './world/playerCharacterLoader';
import { playerCharacterMountGate } from './world/playerCharacterGate';

const DEFAULT_GAME_FILE = 'zig-out/game/hmsc.gamefile';
const DEFAULT_STORE_DIR = 'zig-out/game/contentstore';

export default function PlayRoute() {
  // The native loader validates the immutable RJMD/RJSK pair synchronously.
  // Keep that staging above CriminalCareersPlay: its WorldLoader must never be
  // constructed when the declared player is absent, stale, or unreadable.
  const playerPackage = useMemo(() => playerCharacterPackage(), []);
  const playerResolution = useMemo(() => resolvePlayerCharacter(playerPackage), [playerPackage]);
  const playerStage = useMemo(() => pushPlayerCharacter(playerPackage), [playerPackage]);
  const gate = playerCharacterMountGate(playerResolution, playerStage);

  if (!gate.ready) {
    return (
      <Box
        testID="play-character-readiness-blocked"
        style={{
          width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center',
          backgroundColor: '#0d141f',
        }}
      >
        <Box style={{
          maxWidth: 560, paddingLeft: 18, paddingRight: 18, paddingTop: 14, paddingBottom: 14,
          borderWidth: 1, borderColor: '#70433b', borderRadius: 7, backgroundColor: '#271614',
        }}>
          <Text style={{ color: '#f0aa98', fontSize: 12, fontFamily: 'monospace', fontWeight: '700', textAlign: 'center' }}>
            PLAY BLOCKED — BOUND PLAYER REQUIRED
          </Text>
          <Text style={{ color: '#d6b0a8', fontSize: 10, fontFamily: 'monospace', textAlign: 'center', marginTop: 7 }}>
            {gate.reason}
          </Text>
          <Text style={{ color: '#9f8a86', fontSize: 9, fontFamily: 'monospace', textAlign: 'center', marginTop: 6 }}>
            Fit, bind, and save the welded player before opening /play.
          </Text>
        </Box>
      </Box>
    );
  }

  const bindingHash = playerPackage?.skeleton?.meshes?.kind === 'skinned'
    ? playerPackage.skeleton.meshes.binding?.artifactHash ?? ''
    : '';
  return (
    <CriminalCareersPlay
      key={`${playerPackage?.id ?? 'player'}:${bindingHash}:${gate.stage.boneIds.join('|')}`}
      gameFile={DEFAULT_GAME_FILE}
      storeDir={DEFAULT_STORE_DIR}
    />
  );
}
