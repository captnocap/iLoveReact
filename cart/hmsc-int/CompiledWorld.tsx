import { createElement, useEffect, useRef, useState } from 'react';
import { Box, Pressable, Text } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import { accentFor } from './shell/workbench.cls';

const DEFAULT_GAME_FILE = 'zig-out/game/hmsc.gamefile';
const DEFAULT_STORE_DIR = 'zig-out/game/contentstore';

type CompiledWorldProps = {
  gameFile?: string;
  storeDir?: string;
  style?: Record<string, unknown>;
  onStatus?: (status: string) => void;
};

declare const globalThis: any;

export function CompiledWorld(props: CompiledWorldProps) {
  const gameFile = props.gameFile ?? DEFAULT_GAME_FILE;
  const storeDir = props.storeDir ?? DEFAULT_STORE_DIR;
  const nodeRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: any = null;
    let mountedNode = 0;

    const mount = () => {
      const nodeId = Number(nodeRef.current?.id ?? 0);
      if (!nodeId) {
        timer = setTimeout(mount, 16);
        return;
      }
      mountedNode = nodeId;
      const host = globalThis as any;
      if (typeof host.__compiled_world_mount !== 'function') {
        props.onStatus?.('error: native compiled-world binding unavailable');
        return;
      }
      const status = String(host.__compiled_world_mount(nodeId, gameFile, storeDir) ?? '');
      if (!cancelled) props.onStatus?.(status || 'mounted');
    };

    mount();
    return () => {
      cancelled = true;
      if (timer != null) clearTimeout(timer);
      if (mountedNode > 0 && typeof globalThis.__compiled_world_unmount === 'function') {
        try { globalThis.__compiled_world_unmount(mountedNode); } catch {}
      }
    };
  }, [gameFile, storeDir, props.onStatus]);

  return createElement('View', {
    ref: nodeRef,
    scene3d: true,
    testID: 'compiled-world-native',
    style: {
      width: '100%',
      height: '100%',
      backgroundColor: '#0d141f',
      ...(props.style ?? {}),
    },
  });
}

export function CompiledWorldRoute(props: { onExit: () => void }) {
  const [status, setStatus] = useState('mounting native scene');
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: accentFor('bg'), flexDirection: 'column' }}>
      <Box style={{ height: 34, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10, paddingRight: 10, borderBottomWidth: 1, borderBottomColor: accentFor('border'), backgroundColor: accentFor('surface') }}>
        <Pressable onPress={props.onExit} style={{ width: 26, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 5, borderWidth: 1, borderColor: accentFor('controlBorder'), backgroundColor: accentFor('controlBg') }}>
          <Icon name="ArrowLeft" size={14} color={accentFor('textSecondary')} />
        </Pressable>
        <Icon name="Box" size={14} color={accentFor('success')} />
        <Text fontSize={11} color={accentFor('text')} style={{ fontWeight: 700 }}>COMPILED WORLD</Text>
        <Box style={{ flexGrow: 1 }} />
        <Text fontSize={9} color={status.startsWith('error:') ? accentFor('error') : accentFor('textDim')} style={{ fontFamily: 'monospace' }}>{status}</Text>
      </Box>
      <Box style={{ flexGrow: 1, minHeight: 0 }}>
        <CompiledWorld onStatus={setStatus} />
      </Box>
    </Box>
  );
}
