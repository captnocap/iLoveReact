// StatusBar — bottom strip with current status + autosave indicator.

import { Row, Box, Text } from '@reactjit/runtime/primitives';
import { COLORS, SIZES } from '../theme';
import type { ComposerState } from '../state';

interface Props {
  s: ComposerState;
}

export function StatusBar({ s }: Props) {
  const savedAgo = s.lastSavedAt ? formatAgo(Date.now() - s.lastSavedAt) : null;
  const restored = s.restoredFrom ? `restored from ${s.restoredFrom}` : null;

  return (
    <Row style={{
      height: SIZES.statusBar,
      backgroundColor: COLORS.bgSoft,
      borderTopWidth: 1,
      borderTopColor: COLORS.border,
      paddingLeft: 12,
      paddingRight: 12,
      alignItems: 'center',
      gap: 10,
    }}>
      <Text style={{ color: COLORS.ink, fontSize: 11, flexGrow: 1 }}>
        {s.status}
      </Text>

      {restored ? (
        <Text style={{ color: COLORS.inkMuted, fontSize: 10 }}>{restored}</Text>
      ) : null}

      {savedAgo ? (
        <Row style={{ alignItems: 'center', gap: 5 }}>
          <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.good }} />
          <Text style={{ color: COLORS.inkDim, fontSize: 10 }}>saved {savedAgo}</Text>
        </Row>
      ) : (
        <Text style={{ color: COLORS.inkMuted, fontSize: 10 }}>unsaved</Text>
      )}
    </Row>
  );
}

function formatAgo(ms: number): string {
  if (ms < 1500) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
