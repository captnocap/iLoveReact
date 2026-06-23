// PlayTestRoute.tsx — the /test route with a LOADER TOGGLE (req_1695).
//
// /test normally runs PlayRoute, which re-derives its world from the GameState
// every render. This wrapper adds a switch to the experimental TS world loader
// (WorldLoaderView): the SAME bake→decode→batch path /compiled's no-V8 loader
// takes, run inside V8, so we can A/B whether loading flat baked data renders as
// cheaply as the native loader. Toggle with the button (top-right) or F3.

import { useEffect, useState } from 'react';
import { Box, Pressable, Text } from '@reactjit/primitives';
import { busOn } from '@reactjit/hooks/useIFTTT';
import type { GameState } from '../../design';
import type { ChunkFloor } from '../../chunkFloor';
import { PlayRoute } from './PlayRoute';
import { WorldLoaderView } from './tsLoader/WorldLoaderView';

export function PlayTestRoute(props: {
  state: GameState;
  mapName: string;
  legacyPieceMapName?: string | null;
  floors?: readonly ChunkFloor[];
  onExit: () => void;
}) {
  const [useTsLoader, setUseTsLoader] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const off = busOn('__keydown', (e: any) => {
      if (String(e?.key ?? '').toLowerCase() === 'f3') setUseTsLoader((v) => !v);
    });
    return () => off();
  }, []);

  return (
    <Box style={{ width: '100%', height: '100%', position: 'relative' }}>
      {useTsLoader ? (
        <WorldLoaderView
          state={props.state}
          mapName={props.mapName}
          legacyPieceMapName={props.legacyPieceMapName}
          floors={props.floors}
          wasdFocused={focused}
          onWasdFocus={() => setFocused(true)}
        />
      ) : (
        <PlayRoute
          state={props.state}
          mapName={props.mapName}
          legacyPieceMapName={props.legacyPieceMapName}
          onExit={props.onExit}
        />
      )}
      <Pressable
        onClick={() => setUseTsLoader((v) => !v)}
        style={{ position: 'absolute', right: 8, top: 8, padding: 6, backgroundColor: useTsLoader ? '#1d4ed8' : '#0a1018cc', borderRadius: 4 }}
      >
        <Text fontSize={10} color="#e2e8f0" style={{ fontFamily: 'monospace' }}>
          {useTsLoader ? 'renderer: TS LOADER (F3)' : 'renderer: PlayRoute (F3)'}
        </Text>
      </Pressable>
    </Box>
  );
}
