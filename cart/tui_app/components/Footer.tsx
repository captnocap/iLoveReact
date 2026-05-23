// Footer — single-row status strip pinned to the bottom of the shell.
// Reads chat-status straight from the shared store so the indicator
// reflects the live worker phase (init/loading/idle/generating/failed)
// regardless of which route is currently rendering above.

import * as React from 'react';
import { Row, Text } from '@reactjit/runtime/primitives';
import { useChatStatus, useChatHasAny, useChatTurns } from '../../app/chat/store';

function phaseColor(phase: string, error: string | null): string {
  if (error) return '#f87171';
  if (phase === 'generating') return '#fbbf24';
  if (phase === 'failed') return '#f87171';
  if (phase === 'init' || phase === 'loading') return '#94a3b8';
  return '#22d3ee';
}

function phaseLabel(phase: string, error: string | null, lastStatus: string): string {
  if (error) return `ERROR · ${error.slice(0, 60)}`;
  if (phase === 'generating') return 'GENERATING…';
  if (phase === 'init' || phase === 'loading') return 'STARTING…';
  if (phase === 'failed') return `FAILED · ${lastStatus || 'no detail'}`;
  return lastStatus ? lastStatus.toUpperCase() : 'READY';
}

export function Footer() {
  const status = useChatStatus();
  const hasAny = useChatHasAny();
  const turns = useChatTurns();

  return (
    <Row style={{ width: '100%', backgroundColor: '#111827', paddingLeft: 1, paddingRight: 1, gap: 2 }}>
      <Text style={{ color: phaseColor(status.phase, status.error) }}>
        ●
      </Text>
      <Text style={{ color: '#94a3b8' }}>
        {phaseLabel(status.phase, status.error, status.lastStatus)}
      </Text>
      <Text style={{ color: '#475569' }}>·</Text>
      <Text style={{ color: '#94a3b8' }}>
        {turns.length} turn{turns.length === 1 ? '' : 's'} in current
      </Text>
      {hasAny ? null : (
        <>
          <Text style={{ color: '#475569' }}>·</Text>
          <Text style={{ color: '#64748b' }}>type below to start one</Text>
        </>
      )}
    </Row>
  );
}
