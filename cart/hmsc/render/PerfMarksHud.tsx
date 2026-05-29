import { useEffect, useState } from 'react';
import { Box, Text } from '@reactjit/runtime/primitives';
import { perfSnapshot, startPerfMonitor, type PerfSnapshot } from '../state/perfMarks';

// On-screen probe for diagnosing idle frame spikes. Shows the worst frame time
// and slow-frame count over the last second, what the most recent spike
// coincided with, and a log of recent heavy operations. Polls 5x/sec so the
// numbers stay readable instead of flickering every frame.
const SLOW_FRAME_MS = 14;

export function PerfMarksHud() {
  const [snap, setSnap] = useState<PerfSnapshot>(() => perfSnapshot());
  useEffect(() => {
    const stop = startPerfMonitor();
    const poll = setInterval(() => setSnap(perfSnapshot()), 200);
    return () => {
      clearInterval(poll);
      stop();
    };
  }, []);

  const spiking = snap.slowFramesPerSec > 0;
  return (
    <Box
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 5,
        paddingLeft: 10,
        paddingRight: 10,
        paddingTop: 8,
        paddingBottom: 8,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: spiking ? '#f87171' : '#334155',
        backgroundColor: '#020617e6',
        minWidth: 230,
      }}
    >
      <Text fontSize={11} color="#94a3b8" style={{ fontWeight: 800 }}>PERF PROBE</Text>
      <Text fontSize={12} color={snap.worstGapMs > SLOW_FRAME_MS ? '#fca5a5' : '#cbd5e1'}>
        {`worst frame  ${snap.worstGapMs.toFixed(1)}ms`}
      </Text>
      <Text fontSize={12} color={spiking ? '#fca5a5' : '#cbd5e1'}>
        {`slow frames/s  ${snap.slowFramesPerSec}`}
      </Text>
      <Text fontSize={11} color="#fcd34d">{`last spike: ${snap.lastSpikeDuring || '—'}`}</Text>
      {snap.recentNotable.length === 0 ? (
        <Text fontSize={11} color="#64748b">no heavy ops yet</Text>
      ) : (
        snap.recentNotable.map((op, index) => (
          <Text key={`${op.atMs}-${index}`} fontSize={11} color="#7dd3fc">
            {`${op.label}  ${op.ms.toFixed(1)}ms`}
          </Text>
        ))
      )}
    </Box>
  );
}
