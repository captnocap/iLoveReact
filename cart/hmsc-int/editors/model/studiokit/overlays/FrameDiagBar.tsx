// editors/model/studio/overlays/FrameDiagBar.tsx — the thin frame-diagnostics
// strip (req_0981). Lifted verbatim from editors/model/Studio.tsx (req_1390).
//
// Isolated so its 5 Hz probe re-renders never touch the Scene3D tree. A THIN
// horizontal strip — the key frame stats inline (fps · frame/worst ms · skips ·
// gc · present) so the readout sits in the top-right toolbar beside the
// smooth/log/fps levers rather than as a tall corner box. The once-per-second
// [studio-frames] terminal warn stays gated behind `logToTerminal` (the 'log cam'
// toggle), default OFF so the dev terminal stays silent until re-armed.

import { useState } from 'react';
import { Pressable, Row, Text } from '@reactjit/primitives';
import { STEP_BTN, T } from '../config';
import { useFrameProbe } from '../../frameProbe';
import { StatCell } from '../panels/StatCell';

export function FrameDiagBar(props: { logToTerminal: boolean }) {
  const [resetSeq, setResetSeq] = useState(0);
  const diag = useFrameProbe({ active: true, pollMs: 200, resetSeq, logToTerminal: props.logToTerminal });
  return (
    <Row style={{ gap: 8, alignItems: 'center', paddingLeft: 9, paddingRight: 6, paddingTop: 4, paddingBottom: 4, borderRadius: 6, backgroundColor: '#0b1320e8', borderWidth: 1, borderColor: '#27364a' }}>
      <Text fontSize={8} color={T.text} style={{ fontFamily: 'monospace', fontWeight: '800' }}>FRAMES</Text>
      {diag.live ? (
        <>
          <StatCell label="fps" value={`${diag.fps.toFixed(0)}`} warn={diag.fps > 0 && diag.fps < 50} />
          <StatCell label="ms" value={`${diag.medianMs.toFixed(1)}/${diag.worstMs.toFixed(1)}`} warn={diag.worstMs > diag.medianMs * 2 + 1} />
          <StatCell label="skip" value={`${diag.peakSkips}`} warn={diag.peakSkips > 0} />
          <StatCell label="gc" value={`${diag.gcMs.toFixed(1)}`} warn={diag.gcMs > 1} />
          <StatCell label="pres" value={`${diag.presentMs.toFixed(1)}`} warn={diag.presentMs > diag.medianMs + 2} />
          {/* TEXT RESOURCE gauges (req_1279): when the compass letters (or any text)
              silently vanish, one of these is at cap. glyph = per-frame buffer
              (trailing text drops); atlas = distinct-glyph cache (new combos can't
              rasterize, no eviction). warn at 90%. */}
          <StatCell label="glyph" value={`${diag.glyphCount}/${diag.glyphCap}`} warn={diag.glyphCap > 0 && diag.glyphCount >= diag.glyphCap * 0.9} />
          <StatCell label="atlas" value={`${diag.atlasCount}/${diag.atlasCap}`} warn={diag.atlasCap > 0 && diag.atlasCount >= diag.atlasCap * 0.9} />
        </>
      ) : (
        <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace' }}>no telemetry…</Text>
      )}
      <Pressable onPress={() => setResetSeq((n) => n + 1)} tooltip="Reset the FRAMES counters (clear the worst-ms / skip / gc peaks and start fresh)" style={STEP_BTN}><Text fontSize={8} color={T.dim}>↺</Text></Pressable>
    </Row>
  );
}
