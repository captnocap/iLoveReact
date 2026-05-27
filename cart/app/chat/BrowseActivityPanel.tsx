// Live browser activity panel for the /chat route.
//
// Spawns the stealth Firefox session via useProcess, points the cart's
// browse tools at it via setBrowsePort, and surfaces the live window
// (captured by name via XShm) whenever a browse-* tool fires. Idle
// state collapses to a thin status pill.
//
// The session is owned by THIS panel — once the user navigates away
// from /chat the useProcess effect tears the python process down.
// Sweatshop and other research surfaces will mount their own panel (or
// import this one) when they want browser capability.

import { useEffect, useRef, useState } from 'react';
import { Box, Text, RenderTarget } from '@reactjit/runtime/primitives';
import { useProcess } from '@reactjit/runtime/hooks/useProcess';
import { setBrowsePort } from '@reactjit/runtime/hooks/useBrowse';
import { busOn } from '@reactjit/runtime/hooks/useIFTTT';

const BROWSE_PORT = 7332;
const ACTIVE_WINDOW_MS = 30_000;
const RENDER_SRC = 'window:Firefox';

interface ActivityEvent {
  tool: string;
  summary: string;
  phase: 'start' | 'end' | 'error';
  error?: string;
  at: number;
}

export function BrowseActivityPanel() {
  const proc = useProcess({
    cmd: 'python',
    args: ['-m', 'browse.session', '--port', String(BROWSE_PORT)],
    stdin: 'ignore',
  });
  const [last, setLast] = useState<ActivityEvent | null>(null);
  // tick re-renders once a second so the "active for 30s" window decays
  // even when no new events arrive.
  const [, force] = useState(0);
  const lastRef = useRef<ActivityEvent | null>(null);
  lastRef.current = last;

  // Point the cart's browse tools at our session. Process-wide global —
  // if another panel mounts with a different port later, the last one
  // wins. For now /chat is the only panel.
  useEffect(() => {
    setBrowsePort(BROWSE_PORT);
  }, []);

  useEffect(() => busOn('browse:activity', (p: any) => {
    if (!p || typeof p !== 'object') return;
    setLast({
      tool: String(p.tool || ''),
      summary: String(p.summary || ''),
      phase: (p.phase as ActivityEvent['phase']) || 'end',
      error: p.error,
      at: Number(p.at) || Date.now(),
    });
  }), []);

  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const active = last !== null && (Date.now() - last.at) < ACTIVE_WINDOW_MS;
  const status = proc.state === 'running'
    ? (active ? 'live' : 'ready')
    : proc.state;

  return (
    <Box style={{
      flexDirection: 'column',
      borderRadius: 8,
      backgroundColor: 'theme:surface-1',
      marginBottom: 12,
      overflow: 'hidden',
    }}>
      <Box style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: 8,
        paddingBottom: 8,
        paddingLeft: 12,
        paddingRight: 12,
      }}>
        <Text style={{
          color: proc.state === 'running' ? 'theme:success' : 'theme:muted',
          marginRight: 8,
        }}>
          {proc.state === 'running' ? (active ? '●' : '○') : '×'}
        </Text>
        <Text style={{ marginRight: 12 }}>{`Browser ${status}`}</Text>
        {last && (
          <Text style={{ color: 'theme:muted', flexGrow: 1 }}>
            {`${last.tool}${last.summary ? ' · ' + last.summary : ''}${last.phase === 'error' ? ' — ' + (last.error || 'error') : ''}`}
          </Text>
        )}
      </Box>
      {active && proc.state === 'running' && (
        <RenderTarget src={RENDER_SRC} style={{ height: 480, width: '100%' }} />
      )}
    </Box>
  );
}
