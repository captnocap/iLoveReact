import { createElement } from 'react';
import { Box, Pressable, Text } from '@reactjit/primitives';
import { callHost } from '@reactjit/ffi';
import { Icon } from '@reactjit/icons/Icon';
import { accentFor } from './shell/workbench.cls';

const DEFAULT_GAME_FILE = 'zig-out/game/hmsc.gamefile';
const DEFAULT_STORE_DIR = 'zig-out/game/contentstore';

type CompiledWorldProps = {
  gameFile?: string;
  storeDir?: string;
  style?: Record<string, unknown>;
};

export function CompiledWorld(props: CompiledWorldProps) {
  const gameFile = props.gameFile ?? DEFAULT_GAME_FILE;
  const storeDir = props.storeDir ?? DEFAULT_STORE_DIR;

  return createElement('WorldLoader', {
    gameFile,
    storeDir,
    testID: 'compiled-world-loader',
    style: {
      width: '100%',
      height: '100%',
      backgroundColor: '#0d141f',
      ...(props.style ?? {}),
    },
  });
}

// ── the pop-out window (WORLDWIN-0611, review §6/§10.2) ──────────────────────
// The compiled world in its OWN OS window — the edit→feel loop with zero
// route flips: paint on `/`, Compile, and the second window takes the new
// gamefile live. Host machinery: framework/gpu/world_window.zig (a second
// wgpu surface on the same device; the world renders to its detached RT and
// blits). Calling popOut while the window is open RELOADS it — that is the
// Compile button's wire. In the window: click captures the mouse, WASD walks,
// Esc releases, RMB aims.

export function popOutCompiledWorld(gameFile?: string, storeDir?: string): string {
  return String(callHost(
    '__compiled_world_window',
    'error:HostMissing',
    gameFile ?? DEFAULT_GAME_FILE,
    storeDir ?? DEFAULT_STORE_DIR,
    1280,
    800,
  ));
}

export function closeCompiledWorldWindow(): void {
  callHost('__compiled_world_window_close', null);
}

export function compiledWorldWindowOpen(): boolean {
  const status = String(callHost('__compiled_world_window_status', 'closed'));
  return status !== 'closed' && !status.startsWith('error:');
}

/** the Compile button's wire: a fresh gamefile re-loads an open pop-out */
export function reloadCompiledWindowIfOpen(): void {
  if (compiledWorldWindowOpen()) popOutCompiledWorld();
}

export function CompiledWorldRoute(props: { onExit: () => void; reloadKey?: number; status?: string }) {
  const status = props.status ?? 'native world_loader primitive';
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: accentFor('bg'), flexDirection: 'column' }}>
      <Box style={{ height: 34, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10, paddingRight: 10, borderBottomWidth: 1, borderBottomColor: accentFor('border'), backgroundColor: accentFor('surface') }}>
        <Pressable onPress={props.onExit} style={{ width: 26, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 5, borderWidth: 1, borderColor: accentFor('controlBorder'), backgroundColor: accentFor('controlBg') }}>
          <Icon name="ArrowLeft" size={14} color={accentFor('textSecondary')} />
        </Pressable>
        <Icon name="Box" size={14} color={accentFor('success')} />
        <Text fontSize={11} color={accentFor('text')} style={{ fontWeight: 700 }}>COMPILED WORLD</Text>
        <Box style={{ flexGrow: 1 }} />
        <Pressable
          onPress={() => { popOutCompiledWorld(); }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 5, borderWidth: 1, borderColor: accentFor('controlBorder'), backgroundColor: accentFor('controlBg') }}
        >
          <Icon name="ExternalLink" size={12} color={accentFor('textSecondary')} />
          <Text fontSize={9} color={accentFor('textSecondary')} style={{ fontWeight: 700 }}>POP OUT</Text>
        </Pressable>
        <Text fontSize={9} color={status.startsWith('error:') ? accentFor('error') : accentFor('textDim')} style={{ fontFamily: 'monospace' }}>{status}</Text>
      </Box>
      <Box style={{ flexGrow: 1, minHeight: 0 }}>
        <CompiledWorld key={props.reloadKey ?? 0} />
      </Box>
    </Box>
  );
}
