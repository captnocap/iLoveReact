// player_lab — media scrubber demo (MEDIASLIDER-0705).
//
// The vidstack interaction model rebuilt on host-owned widgets:
//   - <Slider media={src}> binds the scrubber to the mpv-backed video IN
//     THE ENGINE: it follows time-pos when idle, streams keyframe seeks
//     while dragging, and settles with ONE exact seek on release. React is
//     not in the loop — drag the thumb with JS blocked and video still
//     chases it.
//   - Hover tooltip: the engine writes the tooltip's left-position to a
//     latch on every motion (zero React), and dispatches onHoverValue only
//     when the hovered SECOND changes (quantize-by-meaning). The only React
//     work during hover is the 1Hz-ish tooltip text swap.
//   - Volume is a plain host slider streaming straight into
//     __video_set_volume — no state round-trip.
//
// Usage: ship/dev this cart with a video path as the first cart arg, or
// drop a clip at /tmp/rjit_player_demo.mp4. Generate a test clip with:
//   ffmpeg -f lavfi -i testsrc2=duration=60:size=1280x720:rate=30 \
//          -f lavfi -i sine=frequency=440:duration=60 \
//          -pix_fmt yuv420p /tmp/rjit_player_demo.mp4

import { useState } from 'react';
import { Box, Row, Col, Text, Pressable, Video, Slider } from '@reactjit/runtime/primitives';
import { useVideo, videoControl } from '@reactjit/runtime/hooks/useVideo';

const DEFAULT_SRC = '/tmp/rjit_player_demo.mp4';

// ── theme (vidstack-ish dark chrome) ────────────────────────────────
const BG = '#0a0d14';
const BAR = '#10141d';
const INK = '#e8ecf8';
const MUTED = '#8a94ad';
const TRACK = '#2a3145';
const FILL = '#5b8cff';
const TIP_BG = '#1a2030';
const TIP_W = 64;

const HOVER_LATCH = 'player_lab:tip:left';

function cartSrc(): string {
  const argv = (globalThis as any).process?.argv;
  return Array.isArray(argv) && typeof argv[1] === 'string' ? argv[1] : DEFAULT_SRC;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = h > 0 ? String(m % 60).padStart(2, '0') : String(m % 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function ControlButton({ label, onPress, active }: { label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 6,
        paddingBottom: 6,
        borderRadius: 6,
        backgroundColor: active ? '#26314d' : '#1a2030',
        borderWidth: 1,
        borderColor: '#2e3852',
      }}
    >
      <Text style={{ color: INK, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

export default function PlayerLab() {
  const src = cartSrc();
  const v = useVideo(src, { pollMs: 250 });
  const [hoverSec, setHoverSec] = useState(-1);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1.0);

  const ready = v.status === 'ready';
  const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;

  return (
    <Col style={{ width: '100%', height: '100%', backgroundColor: BG }}>
      {/* ── video surface ── */}
      <Box style={{ flexGrow: 1, flexBasis: 0, backgroundColor: '#000' }}>
        <Video src={src} paused={false} loop muted={muted} volume={volume} style={{ width: '100%', height: '100%' }} />
        {!ready ? (
          <Col style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: INK, fontSize: 16, fontWeight: '800' }}>
              {v.status === 'error' ? 'VIDEO FAILED TO LOAD' : 'waiting for video…'}
            </Text>
            <Text style={{ color: MUTED, fontSize: 11 }}>{src}</Text>
            <Text style={{ color: MUTED, fontSize: 11 }}>
              generate a test clip: ffmpeg -f lavfi -i testsrc2=duration=60:size=1280x720:rate=30 -pix_fmt yuv420p {DEFAULT_SRC}
            </Text>
          </Col>
        ) : null}
      </Box>

      {/* ── control bar ── */}
      <Col style={{ backgroundColor: BAR, paddingLeft: 14, paddingRight: 14, paddingTop: 10, paddingBottom: 12, gap: 10 }}>
        {/* scrubber + engine-driven hover tooltip */}
        <Box style={{ position: 'relative', width: '100%', height: 18 }}>
          {hoverSec >= 0 ? (
            <Box
              style={{
                position: 'absolute',
                left: ('latch:' + HOVER_LATCH) as any,
                top: -30,
                width: TIP_W,
                paddingTop: 3,
                paddingBottom: 3,
                borderRadius: 4,
                backgroundColor: TIP_BG,
                borderWidth: 1,
                borderColor: '#2e3852',
                alignItems: 'center',
                zIndex: 10,
              }}
            >
              <Text style={{ color: INK, fontSize: 11, fontWeight: '700' }}>{formatTime(hoverSec)}</Text>
            </Box>
          ) : null}
          <Slider
            media={src}
            hoverLatch={HOVER_LATCH}
            hoverWidth={TIP_W}
            hoverStep={1}
            onHoverValue={(sec: number) => setHoverSec(sec)}
            style={{ width: '100%', height: 18, backgroundColor: TRACK, color: FILL }}
          />
        </Box>

        {/* transport row */}
        <Row style={{ alignItems: 'center', gap: 10 }}>
          <ControlButton label={v.paused ? '▶ PLAY' : '❚❚ PAUSE'} onPress={() => v.toggle()} />
          <Text style={{ color: INK, fontSize: 12, fontWeight: '600' }}>
            {`${formatTime(v.currentTime)} / ${formatTime(dur)}`}
          </Text>
          <Box style={{ flexGrow: 1 }} />
          <ControlButton label={muted ? 'UNMUTE' : 'MUTE'} active={muted} onPress={() => setMuted(!muted)} />
          <Text style={{ color: MUTED, fontSize: 11 }}>vol</Text>
          <Slider
            value={volume}
            min={0}
            max={1}
            onChange={(x: number) => {
              // live volume straight into the host — no settle needed
              videoControl(src).setVolume(x);
            }}
            onCommit={(x: number) => setVolume(x)}
            style={{ width: 120, height: 14, backgroundColor: TRACK, color: FILL }}
          />
        </Row>
      </Col>
    </Col>
  );
}
