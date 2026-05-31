// desktop — the reactjit desktop, rendered with NO display server.
//
// This cart is the payload for os/desktop: booted on bare Alpine in QEMU, it
// drives the screen directly through DRM/KMS (framework/render/kms.zig). There
// is no X, no Wayland, no compositor — reactjit IS the display server.
//
// A live desktop: plasma wallpaper, a top bar with a ticking clock, a window,
// and a clickable dock. Pointer input arrives over evdev (framework/render/
// evdev.zig) since the dummy SDL video driver delivers none — click a dock
// icon and it lifts + rings, and the top bar names the open app.

import { useEffect, useState } from 'react';
import { Box, Row, Col, Text, Pressable } from '@reactjit/primitives';
import { Plasma, PLASMA_DEFAULTS } from '@reactjit/effects';

const DOCK = [
  { label: 'Files', color: '#5b8cff' },
  { label: 'Chat', color: '#ff7eb6' },
  { label: 'Notes', color: '#ffd166' },
  { label: 'Music', color: '#5be0b5' },
  { label: 'Settings', color: '#c792ea' },
];

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

function TopBar({ active }: { active: string }) {
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
      <Box style={{ width: 14 }} />
      <Text style={{ color: '#8ea2ff', fontSize: 14 }}>{active}</Text>
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
          {'Alpine kernel -> /dev/dri/card0 -> reactjit drew this straight to the framebuffer.'}
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

function Dock({ selected, onSelect }: { selected: number; onSelect: (i: number) => void }) {
  return (
    <Row
      style={{
        height: 64,
        backgroundColor: 'rgba(12,14,24,0.7)',
        borderRadius: 18,
        alignItems: 'center',
        paddingLeft: 12,
        paddingRight: 12,
      }}
    >
      {DOCK.map((item, i) => {
        const on = i === selected;
        return (
          <Pressable key={item.label} onPress={() => onSelect(i)}>
            <Box
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                backgroundColor: item.color,
                marginLeft: i === 0 ? 0 : 10,
                marginBottom: on ? 8 : 0, // selected icon lifts
                borderWidth: on ? 2 : 0,
                borderColor: '#ffffff',
              }}
            />
          </Pressable>
        );
      })}
    </Row>
  );
}

export default function Desktop() {
  const [selected, setSelected] = useState(0);
  const active = `${DOCK[selected].label} open`;
  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#05060c' }}>
      {/* Wallpaper */}
      <Plasma params={PLASMA_DEFAULTS} style={{ position: 'absolute', width: '100%', height: '100%' }} />

      {/* Foreground UI */}
      <Col style={{ position: 'absolute', width: '100%', height: '100%' }}>
        <TopBar active={active} />
        <Box style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Window />
        </Box>
        <Box style={{ alignItems: 'center', paddingBottom: 18 }}>
          <Dock selected={selected} onSelect={setSelected} />
        </Box>
      </Col>
    </Box>
  );
}
