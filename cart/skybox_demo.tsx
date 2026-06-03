// skybox_demo — what <Scene3D.Skybox> can and can't do.
//
// The skybox is an ANALYTIC procedural sky: one fullscreen pass that, per pixel,
// reconstructs the world view ray and evaluates a gradient + sun + haze + drifting
// clouds + night stars. Nothing is baked — every knob is a live uniform. That's
// the whole point of the design: a day cycle, weather, and per-zone mood are just
// prop values you lerp each frame. One sky; different params.
//
// CAN do (shown here, live):
//   • day cycle      — sun arcs across the sky; colors + light follow the hour
//   • weather        — cloud coverage + haze + desaturation (clear → storm)
//   • per-zone mood   — blend toward a "gloom" preset while staying ONE sky
//   • distance fog    — far geometry melts into the horizon color (free, automatic)
//   • sun-lit world   — the DirectionalLight is synced to the sun, so shadows agree
//
// CAN'T do (and why) — see the red panel bottom-right:
//   • photographic HDRI / cubemap image skies (no cubemap texture path)
//   • real reflections / image-based lighting of the sky onto objects
//   • volumetric god-rays / true 3-D clouds (the cloud layer is a 2-D dome noise)
//
// Ship:  ./scripts/ship skybox_demo
import { useEffect, useRef, useState } from 'react';
import { Box, Row, Col, Text, Pressable, Scene3D } from '@reactjit/primitives';
// Geometry generators (namespaced — `Box` here would collide with the 2D primitive).
import * as Geometry from '@reactjit/geometries';

// ── tiny color helpers (sky colors are DATA, so they're literal here) ──
type RGB = [number, number, number];
function hexToRgb(h: string): RGB {
  const s = h.replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex([r, g, b]: RGB): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex([lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)]);
}
function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
function smooth(a: number, b: number, x: number) { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }

// ── A full sky-state ──
type Sky = {
  zenith: string; horizon: string; ground: string;
  sunDir: RGB; sunColor: string;
  sunSize: number; sunGlow: number; haze: number; cloud: number; night: number;
  ambient: number; lightColor: string; lightI: number;
};

// Day keyframes by hour. We lerp the nearest two for any time-of-day.
const KEYS: { h: number; zenith: string; horizon: string; sun: string }[] = [
  { h: 0,  zenith: '#05060f', horizon: '#0a1226', sun: '#20304f' },  // deep night
  { h: 5,  zenith: '#172a55', horizon: '#7a5a6e', sun: '#ff9a5a' },  // dawn
  { h: 7,  zenith: '#2a5aa8', horizon: '#c9b27e', sun: '#ffd28a' },  // sunrise
  { h: 12, zenith: '#1f6fd6', horizon: '#bcd6f0', sun: '#fff4d6' },  // noon
  { h: 17, zenith: '#2a5fb0', horizon: '#e0b285', sun: '#ffcf86' },  // golden
  { h: 19, zenith: '#1d2f63', horizon: '#c4615a', sun: '#ff7a44' },  // sunset
  { h: 21, zenith: '#0a1330', horizon: '#2a2350', sun: '#3a4a72' },  // dusk
  { h: 24, zenith: '#05060f', horizon: '#0a1226', sun: '#20304f' },
];

function dayKey(hour: number) {
  let i = 0;
  while (i < KEYS.length - 1 && KEYS[i + 1].h <= hour) i++;
  const a = KEYS[i], b = KEYS[Math.min(i + 1, KEYS.length - 1)];
  const span = Math.max(0.0001, b.h - a.h);
  const t = clamp01((hour - a.h) / span);
  return {
    zenith: mixHex(a.zenith, b.zenith, t),
    horizon: mixHex(a.horizon, b.horizon, t),
    sun: mixHex(a.sun, b.sun, t),
  };
}

// Sun arc: rises ~6h in the east (+x), peaks at noon, sets ~18h in the west (-x).
function sunDirFor(hour: number): RGB {
  const a = ((hour - 6) / 12) * Math.PI; // 0 at 06:00, PI at 18:00
  return [Math.cos(a), Math.sin(a), 0.22];
}

// Weather + gloom are TARGET skies we lerp toward — proving "one sky, params lerped".
function buildSky(hour: number, weather: number, gloom: number): Sky {
  const k = dayKey(hour);
  const sd = sunDirFor(hour);
  const elev = sd[1];                       // sun height, <0 at night
  const night = smooth(0.04, -0.18, elev);  // ramps in as the sun drops
  const day = clamp01(elev * 1.4);          // 0 at night, ~1 at noon

  let sky: Sky = {
    zenith: k.zenith,
    horizon: k.horizon,
    ground: '#0c0d10',
    sunDir: sd,
    sunColor: k.sun,
    sunSize: 0.018,
    sunGlow: lerp(0.18, 0.42, day),
    haze: lerp(0.22, 0.42, day),
    cloud: 0.14,
    night,
    ambient: lerp(0.10, 0.42, day),
    lightColor: k.sun,
    lightI: lerp(0.05, 0.95, day),
  };

  // ── Weather: 0 clear → 1 storm. More cloud + haze, greyer, dimmer sun. ──
  if (weather > 0.001) {
    const grey = '#5a626e';
    sky = {
      ...sky,
      zenith: mixHex(sky.zenith, mixHex(grey, '#23262c', 0.4), weather),
      horizon: mixHex(sky.horizon, grey, weather * 0.85),
      cloud: lerp(sky.cloud, 0.9, weather),
      haze: lerp(sky.haze, 0.72, weather),
      sunGlow: lerp(sky.sunGlow, 0.85, weather),
      lightI: sky.lightI * lerp(1, 0.45, weather),
      ambient: sky.ambient * lerp(1, 0.8, weather),
    };
  }

  // ── Gloom zone: a sickly grey-green pall. Same sky, blended by position. ──
  if (gloom > 0.001) {
    const pall = '#3b4a3f';
    sky = {
      ...sky,
      zenith: mixHex(sky.zenith, '#1a221c', gloom),
      horizon: mixHex(sky.horizon, pall, gloom),
      ground: mixHex(sky.ground, '#10130f', gloom),
      cloud: lerp(sky.cloud, 0.8, gloom),
      haze: lerp(sky.haze, 0.6, gloom),
      lightI: sky.lightI * lerp(1, 0.5, gloom),
      lightColor: mixHex(sky.lightColor, '#9fb29a', gloom),
      ambient: lerp(sky.ambient, 0.22, gloom),
    };
  }
  return sky;
}

// ── A handful of props for the world so the sun + fog have something to act on ──
const PROPS: { x: number; z: number; kind: 'box' | 'sphere' | 'cylinder'; h: number; c: string }[] = [
  { x: -6, z: -2, kind: 'box', h: 2.0, c: '#8a5a3a' },
  { x: -3, z: 1, kind: 'sphere', h: 1.0, c: '#3a7a8a' },
  { x: 0, z: -4, kind: 'cylinder', h: 3.2, c: '#9a8a5a' },
  { x: 3, z: 0, kind: 'box', h: 1.4, c: '#6a4a7a' },
  { x: 6, z: -3, kind: 'box', h: 2.6, c: '#7a3a4a' },
  { x: 10, z: -8, kind: 'box', h: 4.0, c: '#4a5a6a' },   // far — should fog out
  { x: -11, z: -10, kind: 'cylinder', h: 5.0, c: '#5a5a6a' },
];

function Btn({ label, on, active }: { label: string; on: () => void; active?: boolean }) {
  return (
    <Pressable onPress={on}>
      <Box style={{
        paddingTop: 6, paddingBottom: 6, paddingLeft: 12, paddingRight: 12,
        borderRadius: 6, backgroundColor: active ? '#3a6df0' : '#1c2230',
        borderWidth: 1, borderColor: active ? '#5a8dff' : '#2c3650',
      }}>
        <Text style={{ fontSize: 14, color: '#e7ecf6' }}>{label}</Text>
      </Box>
    </Pressable>
  );
}

export default function SkyboxDemo() {
  const [hour, setHour] = useState(12);
  const [weather, setWeather] = useState(0);
  const [gloom, setGloom] = useState(0);
  const [playing, setPlaying] = useState(true);
  const playRef = useRef(playing);
  playRef.current = playing;

  // No requestAnimationFrame in the cart host — setTimeout fallback.
  useEffect(() => {
    const g: any = globalThis;
    const sched = g.requestAnimationFrame ? g.requestAnimationFrame.bind(g) : (fn: any) => setTimeout(fn, 16);
    const cancel = g.cancelAnimationFrame ? g.cancelAnimationFrame.bind(g) : clearTimeout;
    let handle: any = 0;
    const loop = () => {
      if (playRef.current) setHour((h) => (h + 0.03) % 24);
      handle = sched(loop);
    };
    handle = sched(loop);
    return () => cancel(handle);
  }, []);

  const sky = buildSky(hour, weather, gloom);
  const hh = Math.floor(hour);
  const mm = Math.floor((hour - hh) * 60);
  const clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#04060c' }}>
      <Scene3D style={{ width: '100%', height: '100%' }}>
        <Scene3D.Camera position={[0, 3.2, 13]} target={[0, 1.4, 0]} fov={56} />

        {/* The star of the show — one skybox, fully driven by the params above. */}
        <Scene3D.Skybox
          zenith={sky.zenith}
          horizon={sky.horizon}
          ground={sky.ground}
          sunDir={sky.sunDir}
          sunColor={sky.sunColor}
          sunSize={sky.sunSize}
          sunGlow={sky.sunGlow}
          haze={sky.haze}
          cloud={sky.cloud}
          night={sky.night}
        />

        {/* Light synced to the sun so the world agrees with the sky. */}
        <Scene3D.AmbientLight color={sky.horizon} intensity={sky.ambient} />
        <Scene3D.DirectionalLight direction={sky.sunDir} color={sky.lightColor} intensity={sky.lightI} />

        {/* Ground — a big thin box (a plane back-face-culls from above). */}
        <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 60, height: 0.2, depth: 60 }} material="#2b3326" position={[0, -0.1, -4]} />

        {/* Props to catch the light + recede into the horizon fog. */}
        {PROPS.map((p, i) =>
          p.kind === 'sphere' ? (
            <Scene3D.Mesh key={i} geometry={Geometry.Sphere} params={{ radius: p.h / 2 }} material={p.c} position={[p.x, p.h / 2, p.z]} />
          ) : p.kind === 'cylinder' ? (
            <Scene3D.Mesh key={i} geometry={Geometry.Cylinder} params={{ radius: 0.7, height: p.h }} material={p.c} position={[p.x, p.h / 2, p.z]} />
          ) : (
            <Scene3D.Mesh key={i} geometry={Geometry.Box} params={{ width: 1.6, height: p.h, depth: 1.6 }} material={p.c} position={[p.x, p.h / 2, p.z]} />
          ),
        )}
      </Scene3D>

      {/* ── Controls (top-left) ── */}
      <Col style={{ position: 'absolute', left: 16, top: 16, gap: 10, width: 360 }}>
        <Box style={{ backgroundColor: '#0b1018cc', borderRadius: 10, padding: 14, gap: 10, borderWidth: 1, borderColor: '#1e2740' }}>
          <Row style={{ gap: 10, alignItems: 'center' }}>
            <Text style={{ fontSize: 22, color: '#ffffff', fontWeight: 'bold' }}>Skybox</Text>
            <Text style={{ fontSize: 22, color: '#8fb6ff' }}>{clock}</Text>
          </Row>

          <Text style={{ fontSize: 12, color: '#7e8aa3' }}>TIME OF DAY</Text>
          <Row style={{ gap: 8 }}>
            <Btn label={playing ? 'Pause' : 'Play'} on={() => setPlaying((p) => !p)} active={playing} />
            <Btn label="Dawn" on={() => { setPlaying(false); setHour(5.5); }} />
            <Btn label="Noon" on={() => { setPlaying(false); setHour(12); }} />
            <Btn label="Dusk" on={() => { setPlaying(false); setHour(19); }} />
            <Btn label="Night" on={() => { setPlaying(false); setHour(1); }} />
          </Row>

          <Text style={{ fontSize: 12, color: '#7e8aa3' }}>WEATHER</Text>
          <Row style={{ gap: 8 }}>
            <Btn label="Clear" on={() => setWeather(0)} active={weather === 0} />
            <Btn label="Cloudy" on={() => setWeather(0.55)} active={weather === 0.55} />
            <Btn label="Storm" on={() => setWeather(1)} active={weather === 1} />
          </Row>

          <Text style={{ fontSize: 12, color: '#7e8aa3' }}>ZONE MOOD (one map, one sky)</Text>
          <Row style={{ gap: 8 }}>
            <Btn label="Normal" on={() => setGloom(0)} active={gloom === 0} />
            <Btn label="Gloom zone" on={() => setGloom(1)} active={gloom === 1} />
          </Row>
        </Box>
      </Col>

      {/* ── CAN / CAN'T (bottom-right) ── */}
      <Col style={{ position: 'absolute', right: 16, bottom: 16, gap: 8, width: 320 }}>
        <Box style={{ backgroundColor: '#0c1810cc', borderRadius: 10, padding: 12, gap: 4, borderWidth: 1, borderColor: '#1f3b28' }}>
          <Text style={{ fontSize: 13, color: '#7fe0a0', fontWeight: 'bold' }}>CAN — all from one shader pass</Text>
          <Text style={{ fontSize: 12, color: '#bfe9cd' }}>· day cycle: sun arc + color ramp</Text>
          <Text style={{ fontSize: 12, color: '#bfe9cd' }}>· weather: cloud + haze + desaturate</Text>
          <Text style={{ fontSize: 12, color: '#bfe9cd' }}>· per-zone mood, same sky lerped</Text>
          <Text style={{ fontSize: 12, color: '#bfe9cd' }}>· distant geometry fogs to horizon</Text>
          <Text style={{ fontSize: 12, color: '#bfe9cd' }}>· night stars; sun-synced lighting</Text>
        </Box>
        <Box style={{ backgroundColor: '#180c0ccc', borderRadius: 10, padding: 12, gap: 4, borderWidth: 1, borderColor: '#3b1f1f' }}>
          <Text style={{ fontSize: 13, color: '#ff9a8a', fontWeight: 'bold' }}>CAN'T — needs new engine work</Text>
          <Text style={{ fontSize: 12, color: '#e9c7bf' }}>· photo HDRI / cubemap image skies</Text>
          <Text style={{ fontSize: 12, color: '#e9c7bf' }}>· sky reflections / IBL on objects</Text>
          <Text style={{ fontSize: 12, color: '#e9c7bf' }}>· volumetric god-rays / 3-D clouds</Text>
        </Box>
      </Col>
    </Box>
  );
}
