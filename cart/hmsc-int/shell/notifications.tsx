// shell/notifications.tsx - root overlay channel for persistent app notices.

import { useEffect, useState } from 'react';
import { Box, Text } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import { subscribe } from '@reactjit/ffi';
import { CHROME_H, accentFor } from './workbench.cls';

export interface OverlayNotice {
  id: string;
  type: string;
  kind?: string;
  title: string;
  message: string;
  detail?: string;
  persistent?: boolean;
  runningBuildId?: string;
  currentBuildId?: string;
  inputCount?: number;
}

export function normalizeOverlayNotice(payload: unknown): OverlayNotice | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  const type = typeof value.type === 'string' ? value.type : '';
  if (!type) return null;
  if (type === 'clear') {
    const id = typeof value.id === 'string' ? value.id : '';
    return id ? { id, type, title: '', message: '' } : null;
  }
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const message = typeof value.message === 'string' ? value.message.trim() : '';
  if (!title || !message) return null;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : type,
    type,
    kind: typeof value.kind === 'string' ? value.kind : undefined,
    title,
    message,
    detail: typeof value.detail === 'string' ? value.detail : undefined,
    persistent: value.persistent === true,
    runningBuildId: typeof value.runningBuildId === 'string' ? value.runningBuildId : undefined,
    currentBuildId: typeof value.currentBuildId === 'string' ? value.currentBuildId : undefined,
    inputCount: typeof value.inputCount === 'number' ? value.inputCount : undefined,
  };
}

function simulatedRebuildNotice(): OverlayNotice {
  return {
    id: 'dev-host-stale',
    type: 'rebuild-required',
    kind: 'native-build-id-mismatch',
    title: 'Rebuild needed',
    message: 'The running dev host was built from different native engine or wire-format sources. Restart rjit dev before hot reload can continue.',
    detail: 'running demo-old / disk demo-new',
    persistent: true,
    runningBuildId: 'demo-old',
    currentBuildId: 'demo-new',
    inputCount: 42,
  };
}

export function NotificationOverlayHost(props: { simulateRebuildNotice?: boolean }) {
  const [notices, setNotices] = useState<OverlayNotice[]>([]);

  useEffect(() => subscribe('system:notification', (payload) => {
    const notice = normalizeOverlayNotice(payload);
    if (!notice) return;
    setNotices((prev) => {
      if (notice.type === 'clear') return prev.filter((item) => item.id !== notice.id);
      return [notice, ...prev.filter((item) => item.id !== notice.id)].slice(0, 3);
    });
  }), []);

  useEffect(() => {
    if (!props.simulateRebuildNotice) return;
    setNotices([simulatedRebuildNotice()]);
  }, [props.simulateRebuildNotice]);

  if (notices.length === 0) return null;
  const notice = notices[0];
  const isRebuild = notice.type === 'rebuild-required';

  return (
    <Box style={{ position: 'absolute', left: 0, right: 0, top: CHROME_H, alignItems: 'center', paddingTop: 10 }}>
      <Box style={{ width: 620, maxWidth: '92%', flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: accentFor('surface'), borderWidth: 2, borderColor: accentFor(isRebuild ? 'error' : 'controlBorder'), borderRadius: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10 }}>
        <Box style={{ width: 28, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: accentFor(isRebuild ? 'error' : 'controlBg') }}>
          <Icon name={isRebuild ? 'Hammer' : 'Bell'} size={16} color={accentFor('text')} />
        </Box>
        <Box style={{ flexGrow: 1, minWidth: 0, flexDirection: 'column', gap: 4 }}>
          <Text fontSize={13} color={accentFor('text')} style={{ fontWeight: 800 }}>{notice.title}</Text>
          <Text fontSize={11} color={accentFor('textSecondary')} style={{ lineHeight: 15 }}>{notice.message}</Text>
          {notice.detail ? (
            <Text fontSize={9} color={accentFor(isRebuild ? 'warning' : 'textDim')} style={{ fontFamily: 'monospace' }}>{notice.detail}</Text>
          ) : null}
        </Box>
      </Box>
    </Box>
  );
}
