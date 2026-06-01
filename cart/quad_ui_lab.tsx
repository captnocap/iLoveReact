// quad_ui_lab — "the whole UI as ONE quad" proof-of-concept.
//
// THE EXPERIMENT (see the long layout/paint thread that spawned this):
//   The thread established that a UI is structurally {style palette} +
//   {box instances indexing it} + {positions} — the same shape as the
//   pixel_icons indexed-image format, plus a position channel. ShaderPixelIcon
//   already proved the GATHER model works on the GPU for images (uv → cell →
//   palette → color, one quad). scape already proved it for a whole world.
//   This cart is the third instance of that pattern: a real, multi-box UI
//   rendered as ONE <Effect> quad whose fragment shader, per pixel, asks
//   "which boxes cover me, in z-order?" and composites them — instead of the
//   normal path where each box is an instanced rect the GPU scatters.
//
// SCOPE (deliberately the smallest decisive test — Step 1 of the ladder):
//   - Boxes only (rounded rects + borders). Text is Step 1b: it rides the
//     SDF glyph atlas through the same gather, but binding that atlas into a
//     user <Effect> is a separate question, so it's not in this PoC. The
//     "text" here is honest placeholder bars, same as a skeleton loader.
//   - Brute-force: every pixel tests every box. No tile binning yet (Step 2).
//     Fine at this box count; the point is correctness + cost SHAPE, not scale.
//   - Positions are authored in TS, not solved on the GPU (Step 3). We are
//     testing the PAINT gather half, not the layout solve half.
//
// WHAT TO LOOK FOR:
//   Left  = the one-quad gather. Right = the identical scene built from normal
//   <Box> primitives (the scatter path). They should be pixel-indistinguishable.
//   If they match, the gather model HOLDS for real UI. If it's slow / wrong /
//   ugly at the edges, that failure mode IS the "why nobody does it" lesson.

import { useMemo } from 'react';
import { Box, Text, Effect } from '@reactjit/primitives';

// ── Scene model ──────────────────────────────────────────────
// One box = one instance. Authored back-to-front: index 0 is painted first
// (furthest back), later boxes composite OVER it. This ordering is the
// "z-order" channel — in a real engine it'd come from tree traversal order.

type BoxDesc = {
  x: number; y: number; w: number; h: number;
  radius?: number;
  borderW?: number;
  bg?: string;       // '#rrggbb' or '#rrggbbaa'
  border?: string;
};

const SCENE_W = 320;
const SCENE_H = 384;

const SCENE: BoxDesc[] = [
  // panel
  { x: 0,   y: 0,   w: SCENE_W, h: SCENE_H, radius: 18, bg: '#161922' },
  // header strip
  { x: 0,   y: 0,   w: SCENE_W, h: 60,      radius: 0,  bg: '#20242f' },
  // avatar
  { x: 20,  y: 16,  w: 28,      h: 28,      radius: 14, bg: '#5a8bd6' },
  // name + subtitle (placeholder text bars)
  { x: 60,  y: 20,  w: 130,     h: 11,      radius: 5,  bg: '#cdd5e6' },
  { x: 60,  y: 37,  w: 86,      h: 8,       radius: 4,  bg: '#69718a' },
  // status dot
  { x: SCENE_W - 36, y: 26, w: 10, h: 10,   radius: 5,  bg: '#6aa37f' },
  // body card with a border
  { x: 20,  y: 80,  w: SCENE_W - 40, h: 96, radius: 12, bg: '#1d2130', borderW: 1, border: '#333a4d' },
  // three list rows inside the card (placeholder bars)
  { x: 36,  y: 98,  w: SCENE_W - 100, h: 9, radius: 4,  bg: '#8c93a6' },
  { x: 36,  y: 124, w: SCENE_W - 84,  h: 9, radius: 4,  bg: '#5b6276' },
  { x: 36,  y: 150, w: SCENE_W - 130, h: 9, radius: 4,  bg: '#5b6276' },
  // primary button
  { x: 20,  y: 196, w: SCENE_W - 40, h: 40, radius: 10, bg: '#d26a2a' },
  // button label (placeholder bar, centered-ish)
  { x: SCENE_W / 2 - 34, y: 196 + 16, w: 68, h: 8, radius: 4, bg: '#1a1206' },
  // footer hint bars
  { x: 20,  y: 256, w: SCENE_W - 40, h: 8, radius: 4,  bg: '#2a2f3d' },
  { x: 20,  y: 272, w: (SCENE_W - 40) * 0.66, h: 8, radius: 4, bg: '#2a2f3d' },
];

// ── Pack scene → flat f32 storage buffer (mirrors ShaderPixelIcon.packMatrix)
// Header: [W, H, count]. Then per box, STRIDE floats:
//   x, y, w, h, radius, borderW, bgRGBA(4), borderRGBA(4)

const STRIDE = 14;

function hexToRGBA(hex?: string): [number, number, number, number] {
  if (!hex || hex[0] !== '#') return [0, 0, 0, 0];
  const h = hex.slice(1);
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return [r, g, b, a];
}

function packScene(scene: BoxDesc[]): number[] {
  const out = new Array<number>(3 + scene.length * STRIDE);
  out[0] = SCENE_W;
  out[1] = SCENE_H;
  out[2] = scene.length;
  let o = 3;
  for (const b of scene) {
    const fill = hexToRGBA(b.bg);
    const bord = hexToRGBA(b.border);
    out[o++] = b.x;
    out[o++] = b.y;
    out[o++] = b.w;
    out[o++] = b.h;
    out[o++] = b.radius ?? 0;
    out[o++] = b.borderW ?? 0;
    out[o++] = fill[0]; out[o++] = fill[1]; out[o++] = fill[2]; out[o++] = fill[3];
    out[o++] = bord[0]; out[o++] = bord[1]; out[o++] = bord[2]; out[o++] = bord[3];
  }
  return out;
}

// ── The one-quad gather shader ───────────────────────────────
// Per pixel: walk every box back-to-front, compute its rounded-rect coverage
// via an analytic SDF (perfect AA at any scale — no stored pixels), pick fill
// vs border by the inner edge, and composite OVER. This is the entire "paint"
// of the UI, in one fragment shader, one draw call.

const SHADER = `
@group(0) @binding(1) var<storage, read> data: array<f32>;

// Signed distance to a rounded box centered at c with half-extent hs, radius r.
// <0 inside, 0 at the edge, >0 outside. The one analytic primitive the whole
// scene is drawn from — same math the rects pipeline uses, here per-pixel.
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
  var acc = vec3f(0.0, 0.0, 0.0); // premultiplied
  var accA = 0.0;

  for (var i = 0u; i < count; i = i + 1u) {
    let o = 3u + i * 14u;
    let bx = data[o];
    let by = data[o + 1u];
    let bw = data[o + 2u];
    let bh = data[o + 3u];
    let brW = data[o + 5u];
    let fill = vec4f(data[o + 6u], data[o + 7u], data[o + 8u], data[o + 9u]);
    let bord = vec4f(data[o + 10u], data[o + 11u], data[o + 12u], data[o + 13u]);

    let c = vec2f(bx + bw * 0.5, by + bh * 0.5);
    let hs = vec2f(bw * 0.5, bh * 0.5);
    let rad = min(data[o + 4u], min(hs.x, hs.y));
    let d = sdRoundBox(p, c, hs, rad);

    let cover = 1.0 - smoothstep(0.0, aa, d); // outer-edge AA
    if (cover <= 0.0) { continue; }

    // fill deep inside, border in the brW-thick band near the edge
    var col = fill;
    if (brW > 0.0) {
      let t = smoothstep(-brW - aa, -brW + aa, d);
      col = mix(fill, bord, t);
    }

    let srcA = col.a * cover;
    // src (this box, more-front) OVER acc (everything behind it)
    acc = col.rgb * srcA + acc * (1.0 - srcA);
    accA = srcA + accA * (1.0 - srcA);
  }

  return vec4f(acc, accA); // premultiplied — matches framework blend
}
`;

// ── Reference: the SAME scene via normal primitives (scatter path) ──
function PrimitiveScene() {
  return (
    <Box style={{ position: 'relative', width: SCENE_W, height: SCENE_H }}>
      {SCENE.map((b, i) => (
        <Box
          key={i}
          style={{
            position: 'absolute',
            left: b.x,
            top: b.y,
            width: b.w,
            height: b.h,
            borderRadius: b.radius ?? 0,
            backgroundColor: b.bg ?? 'transparent',
            borderWidth: b.borderW ?? 0,
            borderColor: b.border ?? 'transparent',
          }}
        />
      ))}
    </Box>
  );
}

function Panel({ label, children }: { label: string; children: any }) {
  return (
    <Box style={{ flexDirection: 'column', gap: 10, alignItems: 'center' }}>
      <Text style={{ fontSize: 11, color: '#8a92a6', letterSpacing: '0.12em' }}>{label}</Text>
      <Box style={{ width: SCENE_W, height: SCENE_H }}>{children}</Box>
    </Box>
  );
}

export default function QuadUiLab() {
  const packed = useMemo(() => packScene(SCENE), []);

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0d0f15', padding: 32, flexDirection: 'column', gap: 24 }}>
      <Box style={{ flexDirection: 'column', gap: 4 }}>
        <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#e7eaff' }}>UI as one quad — gather vs scatter</Text>
        <Text style={{ fontSize: 12, color: '#8a92a6' }}>
          {`Left: ${SCENE.length} boxes composited per-pixel in ONE <Effect> shader. Right: the same scene as ${SCENE.length} <Box> primitives. They should be identical.`}
        </Text>
      </Box>

      <Box style={{ flexDirection: 'row', gap: 48 }}>
        <Panel label="ONE QUAD (gather)">
          <Effect shader={SHADER} data={packed} style={{ width: SCENE_W, height: SCENE_H }} />
        </Panel>
        <Panel label="PRIMITIVES (scatter)">
          <PrimitiveScene />
        </Panel>
      </Box>
    </Box>
  );
}
