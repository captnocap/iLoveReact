// ui_quad_stress — gather (one quad) vs scatter (N primitives), under load.
//
// The decisive benchmark from the layout/paint thread. Same scene, rendered
// two ways, animated every frame so BOTH paths pay their full per-frame cost:
//
//   SCATTER  — N real <Box> primitives. Per frame: React reconcile + Zig
//              layout + instanced rect paint. The cost climbs with N on the
//              CPU side (reconcile/layout), but the GPU draw is one batched
//              instanced call — flat.
//   GATHER   — ONE <Effect> quad. Per frame: pack N boxes into a storage
//              buffer (cheap, O(N)) + a fragment shader that, PER PIXEL, loops
//              all N boxes (rounded-rect SDF, composite). GPU cost is
//              O(pixels x N) — it should wall HARD as N grows. That wall is
//              the whole point: it's why brute-force gather needs tile binning.
//
// Read the fps. The crossover — where gather drops below scatter — is the
// number that decides whether the ergonomic <Effect ui> host feature is worth
// building, or whether tiling has to come first. Honest either way.
//
// No requestAnimationFrame in the cart host (it crashes) — drive with
// setTimeout, per the framework's rAF-absent contract.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, Pressable, Effect, Boxxx } from '@reactjit/primitives';

const VIEW_W = 900;
const VIEW_H = 560;
const STRIDE = 14;

type BoxDesc = {
  x: number; y: number; w: number; h: number;
  radius: number; borderW: number;
  bg: string; border: string;
};

// One "card" = 5 boxes (panel, header, two bars, button). Procedural — not
// hand-authored. This is the generator a real UI's reconciler+layout would
// have produced; we just know the positions because we lay the grid out here.
function genCards(cardCount: number, t: number): BoxDesc[] {
  const out: BoxDesc[] = [];
  const cols = Math.ceil(Math.sqrt(cardCount * (VIEW_W / VIEW_H)));
  const rows = Math.ceil(cardCount / cols);
  const cw = VIEW_W / cols;
  const ch = VIEW_H / rows;
  const pad = Math.min(cw, ch) * 0.08;
  let n = 0;
  for (let r = 0; r < rows && n < cardCount; r++) {
    for (let c = 0; c < cols && n < cardCount; c++, n++) {
      // gentle per-card oscillation so EVERY frame is a genuine repaint
      const wob = Math.sin(t * 0.06 + n * 0.5) * Math.min(3, pad * 0.4);
      const x = c * cw + pad + wob;
      const y = r * ch + pad;
      const w = cw - pad * 2;
      const h = ch - pad * 2;
      const hue = (n * 47 + t) % 360;
      const accent = hslHex(hue, 0.55, 0.5);
      out.push({ x, y, w, h, radius: Math.min(10, w * 0.08), borderW: 1, bg: '#1c2030', border: '#333a4d' });
      out.push({ x, y, w, h: h * 0.26, radius: Math.min(10, w * 0.08), borderW: 0, bg: '#262b3b', border: '#000000' });
      out.push({ x: x + w * 0.1, y: y + h * 0.4, w: w * 0.7, h: Math.max(3, h * 0.06), radius: 3, borderW: 0, bg: '#8c93a6', border: '#000000' });
      out.push({ x: x + w * 0.1, y: y + h * 0.54, w: w * 0.5, h: Math.max(3, h * 0.06), radius: 3, borderW: 0, bg: '#5b6276', border: '#000000' });
      out.push({ x: x + w * 0.1, y: y + h * 0.72, w: w * 0.8, h: Math.max(6, h * 0.16), radius: 6, borderW: 0, bg: accent, border: '#000000' });
    }
  }
  return out;
}

function hslHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (k0: number) => {
    const k = (k0 + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

function hexToRGBA(hex: string): [number, number, number, number] {
  const h = hex.slice(1);
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
    h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  ];
}

function packScene(boxes: BoxDesc[]): number[] {
  const out = new Array<number>(3 + boxes.length * STRIDE);
  out[0] = VIEW_W;
  out[1] = VIEW_H;
  out[2] = boxes.length;
  let o = 3;
  for (const b of boxes) {
    const f = hexToRGBA(b.bg);
    const bd = hexToRGBA(b.border);
    out[o++] = b.x; out[o++] = b.y; out[o++] = b.w; out[o++] = b.h;
    out[o++] = b.radius; out[o++] = b.borderW;
    out[o++] = f[0]; out[o++] = f[1]; out[o++] = f[2]; out[o++] = f[3];
    out[o++] = bd[0]; out[o++] = bd[1]; out[o++] = bd[2]; out[o++] = bd[3];
  }
  return out;
}

const SHADER = `
@group(0) @binding(1) var<storage, read> data: array<f32>;

fn sdRoundBox(p: vec2f, c: vec2f, hs: vec2f, r: f32) -> f32 {
  let q = abs(p - c) - hs + vec2f(r, r);
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2f(0.0, 0.0))) - r;
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let W = data[0];
  let H = data[1];
  let count = u32(data[2]);
  let p = vec2f(in.uv.x * W, in.uv.y * H);
  let aa = 0.8;
  var acc = vec3f(0.0, 0.0, 0.0);
  var accA = 0.0;
  for (var i = 0u; i < count; i = i + 1u) {
    let o = 3u + i * 14u;
    let bx = data[o]; let by = data[o + 1u];
    let bw = data[o + 2u]; let bh = data[o + 3u];
    let brW = data[o + 5u];
    let fill = vec4f(data[o + 6u], data[o + 7u], data[o + 8u], data[o + 9u]);
    let bord = vec4f(data[o + 10u], data[o + 11u], data[o + 12u], data[o + 13u]);
    let c = vec2f(bx + bw * 0.5, by + bh * 0.5);
    let hs = vec2f(bw * 0.5, bh * 0.5);
    let rad = min(data[o + 4u], min(hs.x, hs.y));
    let d = sdRoundBox(p, c, hs, rad);
    let cover = 1.0 - smoothstep(0.0, aa, d);
    if (cover <= 0.0) { continue; }
    var col = fill;
    if (brW > 0.0) {
      let t = smoothstep(-brW - aa, -brW + aa, d);
      col = mix(fill, bord, t);
    }
    let srcA = col.a * cover;
    acc = col.rgb * srcA + acc * (1.0 - srcA);
    accA = srcA + accA * (1.0 - srcA);
  }
  return vec4f(acc, accA);
}
`;

const CARD_OPTIONS = [10, 40, 150, 500];

export default function UiQuadStress() {
  const [mode, setMode] = useState<'scatter' | 'gather' | 'batch'>('batch');
  const [cards, setCards] = useState(40);
  const [frame, setFrame] = useState(0);
  const [fps, setFps] = useState(0);

  // refs so the tick loop reads live values, not first-mount closures
  const frameRef = useRef(0);
  const lastT = useRef(0);
  const acc = useRef({ frames: 0, t0: 0 });

  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const now = performance.now();
      // rolling fps over ~400ms windows
      const a = acc.current;
      if (a.t0 === 0) a.t0 = now;
      a.frames += 1;
      if (now - a.t0 >= 400) {
        setFps(Math.round((a.frames * 1000) / (now - a.t0)));
        a.frames = 0;
        a.t0 = now;
      }
      frameRef.current += 1;
      setFrame(frameRef.current);
      lastT.current = now;
      setTimeout(tick, 0); // run flat-out; fps reveals the real ceiling
    };
    setTimeout(tick, 0);
    return () => { alive = false; };
  }, []);

  const boxes = useMemo(() => genCards(cards, frame), [cards, frame]);
  const packed = useMemo(() => (mode === 'gather' ? packScene(boxes) : null), [mode, boxes]);
  const boxCount = boxes.length;

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0d0f15', flexDirection: 'column' }}>
      {/* control bar */}
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: 12, backgroundColor: '#161922' }}>
        <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#e7eaff' }}>gather vs scatter</Text>

        <Pressable onPress={() => setMode('gather')}>
          <Box style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: mode === 'gather' ? '#d26a2a' : '#262b3b' }}>
            <Text style={{ fontSize: 12, color: '#fff' }}>GATHER (1 quad)</Text>
          </Box>
        </Pressable>
        <Pressable onPress={() => setMode('scatter')}>
          <Box style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: mode === 'scatter' ? '#d26a2a' : '#262b3b' }}>
            <Text style={{ fontSize: 12, color: '#fff' }}>SCATTER (N boxes)</Text>
          </Box>
        </Pressable>
        <Pressable onPress={() => setMode('batch')}>
          <Box style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: mode === 'batch' ? '#d26a2a' : '#262b3b' }}>
            <Text style={{ fontSize: 12, color: '#fff' }}>BATCH (direct rects)</Text>
          </Box>
        </Pressable>

        <Box style={{ width: 1, height: 22, backgroundColor: '#333a4d' }} />

        {CARD_OPTIONS.map((n) => (
          <Pressable key={n} onPress={() => setCards(n)}>
            <Box style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: cards === n ? '#5a8bd6' : '#262b3b' }}>
              <Text style={{ fontSize: 12, color: '#fff' }}>{`${n * 5}`}</Text>
            </Box>
          </Pressable>
        ))}

        <Box style={{ flexGrow: 1 }} />
        <Text style={{ fontSize: 13, color: '#6aa37f' }}>{`${fps} fps`}</Text>
        <Text style={{ fontSize: 12, color: '#8a92a6' }}>{`${boxCount} boxes · ${mode}`}</Text>
      </Box>

      {/* the scene */}
      <Box style={{ width: VIEW_W, height: VIEW_H, position: 'relative' }}>
        {mode === 'gather' ? (
          <Effect shader={SHADER} data={packed!} style={{ width: VIEW_W, height: VIEW_H }} />
        ) : mode === 'batch' ? (
          <Boxxx boxes={boxes} style={{ width: VIEW_W, height: VIEW_H }} />
        ) : (
          boxes.map((b, i) => (
            <Box
              key={i}
              style={{
                position: 'absolute',
                left: b.x, top: b.y, width: b.w, height: b.h,
                borderRadius: b.radius,
                backgroundColor: b.bg,
                borderWidth: b.borderW,
                borderColor: b.border,
              }}
            />
          ))
        )}
      </Box>
    </Box>
  );
}
