// desktop — the reactjit desktop, rendered with NO display server.
//
// This cart is the payload for os/desktop: booted on bare Alpine in QEMU, it
// drives the screen directly through DRM/KMS (framework/render/kms.zig). There
// is no X, no Wayland, no compositor — reactjit IS the display server.
//
// Milestone 1 is "see something happen": a live desktop (plasma wallpaper, a
// top bar with a ticking clock, a window, a dock). Input (evdev) comes next.

import { useEffect, useState } from 'react';
import { Box, Row, Col, Text } from '@reactjit/primitives';
import { Plasma, PLASMA_DEFAULTS } from '@reactjit/effects';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function TopBar() {
  const now = useClock();
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return (
    <Row
      style={{
        width: '100%',
        height: 36,
        backgroundColor: 'rgba(12,14,24,0.78)',
        alignItems: 'center',
        paddingLeft: 16,
        paddingRight: 16,
      }}
    >
      <Text style={{ color: '#cdd6ff', fontSize: 15, fontWeight: 600 }}>reactjit desktop</Text>
      <Box style={{ flexGrow: 1 }} />
      <Text style={{ color: '#8ea2ff', fontSize: 14 }}>no display server</Text>
      <Box style={{ width: 24 }} />
      <Text style={{ color: '#ffffff', fontSize: 15, fontWeight: 600 }}>{time}</Text>
    </Row>
  );
}

function Window() {
  return (
    <Col
      style={{
        width: 460,
        backgroundColor: 'rgba(20,22,34,0.86)',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(140,160,255,0.25)',
        overflow: 'hidden',
      }}
    >
      <Row style={{ height: 34, backgroundColor: 'rgba(30,34,52,0.95)', alignItems: 'center', paddingLeft: 12 }}>
        <Box style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: '#ff5f57' }} />
        <Box style={{ width: 8 }} />
        <Box style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: '#febc2e' }} />
        <Box style={{ width: 8 }} />
        <Box style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: '#28c840' }} />
        <Box style={{ width: 14 }} />
        <Text style={{ color: '#9aa6d8', fontSize: 13 }}>welcome.txt</Text>
      </Row>
      <Col style={{ padding: 20 }}>
        <Text style={{ color: '#eef1ff', fontSize: 20, fontWeight: 700 }}>It booted.</Text>
        <Box style={{ height: 12 }} />
        <Text style={{ color: '#b9c1e6', fontSize: 14, lineHeight: 21 }}>
          Alpine kernel → /dev/dri/card0 → reactjit drew this straight to the framebuffer.
        </Text>
        <Box style={{ height: 8 }} />
        <Text style={{ color: '#b9c1e6', fontSize: 14, lineHeight: 21 }}>
          wgpu rendered surfaceless into an offscreen texture; we read it back and scanned it out
          over KMS. No X. No Wayland. No compositor.
        </Text>
      </Col>
    </Col>
  );
}

function Dock() {
  const items = ['#5b8cff', '#ff7eb6', '#ffd166', '#5be0b5', '#c792ea'];
  return (
    <Row
      style={{
        height: 60,
        backgroundColor: 'rgba(12,14,24,0.7)',
        borderRadius: 18,
        alignItems: 'center',
        paddingLeft: 12,
        paddingRight: 12,
      }}
    >
      {items.map((c, i) => (
        <Box
          key={i}
          style={{
            width: 42,
            height: 42,
            borderRadius: 11,
            backgroundColor: c,
            marginLeft: i === 0 ? 0 : 10,
          }}
        />
      ))}
    </Row>
  );
}

export default function Desktop() {
  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#05060c' }}>
      {/* Wallpaper */}
      <Plasma params={PLASMA_DEFAULTS} style={{ position: 'absolute', width: '100%', height: '100%' }} />

      {/* Foreground UI */}
      <Col style={{ position: 'absolute', width: '100%', height: '100%' }}>
        <TopBar />
        <Box style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Window />
        </Box>
        <Box style={{ alignItems: 'center', paddingBottom: 18 }}>
          <Dock />
        </Box>
      </Col>
    </Box>
  );
}
