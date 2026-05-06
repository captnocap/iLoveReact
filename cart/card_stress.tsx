// card_stress — three architectural strategies for "many interactive
// animated cards" measured side-by-side at 100/500/1000/2000 cards.
//
//   EACH-FX  : per-card React component + per-card <Effect> shader.
//              Each card has its own GPU instance (sharing the
//              pipeline by shader-source hash). React state per card
//              for hover; tooltip subtree mounts on hover.
//   EACH-BOX : per-card React component + plain colored Box (no
//              Effect, no shader). Isolates the React-tree cost at
//              scale without any per-card GPU work. Useful baseline
//              to see how much of EACH-FX's cost is React vs Effect.
//   ONE-FX   : ONE <Effect> shader renders all card visuals in a
//              single GPU pass (chart_stress-SHADER pattern). On top
//              of it, an invisible overlay of hit-zone Boxes provides
//              hover state + tooltip. Best-of-both: GPU does the
//              visual work once for all N cards, React handles only
//              the interaction layer.
//
// All three preserve identical UX: hover any card → border highlights,
// tooltip "card N" appears below it. The only thing that varies is
// HOW the visual gets to the screen.

import { useMemo, useState } from 'react';
import { Box, Effect, Pressable, ScrollView, Text } from '@reactjit/runtime/primitives';

const COLOR_BG = '#050b16';
const COLOR_INK = '#e8eef8';
const COLOR_DIM = '#92a8c4';
const COLOR_BORDER = '#1d2c45';
const COLOR_BORDER_HOVER = '#facc15';
const COUNTS = [100, 500, 1000, 2000];

const CARD_W = 64;
const CARD_H = 64;
const CARD_GAP = 4;
const GRID_PAD = 6;
// Fixed cols-per-row so the ONE-FX shader can compute the card grid
// from uv coordinates and the React-tree overlay can match exactly.
// All three modes use the same value so the visual is comparable.
const COLS_PER_ROW = 18;

type Mode = 'each-fx' | 'each-box' | 'one-fx';

// Shared shader source for the per-card Effect. The framework keys
// pipelines by source hash, so all instances share one GPU pipeline.
const CARD_WGSL = `
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let t = U.time;
  let dx = in.uv.x - 0.5;
  let dy = in.uv.y - 0.5;
  let dist = sqrt(dx * dx + dy * dy);
  let pulse = sin(t * 2.0 - dist * 8.0) * 0.5 + 0.5;
  return vec4f(0.10 + pulse * 0.45, 0.18 + pulse * 0.30, 0.42 + pulse * 0.50, 1.0);
}
`;

// ─── EACH-FX: per-card React + per-card Effect ────────────────────────
function CardEachFx({ idx }: { idx: number }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onHoverEnter={() => setHovered(true)}
      onHoverExit={() => setHovered(false)}
      style={cardWrapperStyle(hovered)}
    >
      <Effect shader={CARD_WGSL} style={{ width: '100%', height: '100%' }} />
      {hovered ? <CardTooltip idx={idx} /> : null}
    </Pressable>
  );
}

// ─── EACH-BOX: per-card React + colored Box (no shader) ───────────────
function CardEachBox({ idx }: { idx: number }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onHoverEnter={() => setHovered(true)}
      onHoverExit={() => setHovered(false)}
      style={cardWrapperStyle(hovered)}
    >
      <Box style={{ width: '100%', height: '100%', backgroundColor: '#3da9ff' }} />
      {hovered ? <CardTooltip idx={idx} /> : null}
    </Pressable>
  );
}

// ─── ONE-FX: invisible hit-zone overlay paired with one big Effect ──
function HitZoneOnly({ idx }: { idx: number }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onHoverEnter={() => setHovered(true)}
      onHoverExit={() => setHovered(false)}
      style={{
        width: CARD_W,
        height: CARD_H,
        marginRight: CARD_GAP,
        marginBottom: CARD_GAP,
        // Hovered: render a border on the hit-zone overlay; otherwise
        // the underlying shader fills the cell. This is the "React
        // owns interaction, GPU owns visual" split.
        borderWidth: hovered ? 2 : 0,
        borderColor: hovered ? COLOR_BORDER_HOVER : 'transparent',
        borderRadius: 6,
      }}
    >
      {hovered ? <CardTooltip idx={idx} /> : null}
    </Pressable>
  );
}

function CardTooltip({ idx }: { idx: number }) {
  return (
    <Box style={{
      position: 'absolute',
      left: 0, right: 0, bottom: -18,
      alignItems: 'center',
    }}>
      <Box style={{
        paddingLeft: 4, paddingRight: 4, paddingTop: 1, paddingBottom: 1,
        backgroundColor: '#000000cc',
        borderRadius: 3,
      }}>
        <Text style={{ fontSize: 9, color: COLOR_INK, fontFamily: 'monospace' }}>{`card ${idx}`}</Text>
      </Box>
    </Box>
  );
}

function cardWrapperStyle(hovered: boolean) {
  return {
    width: CARD_W,
    height: CARD_H,
    marginRight: CARD_GAP,
    marginBottom: CARD_GAP,
    borderWidth: hovered ? 2 : 1,
    borderColor: hovered ? COLOR_BORDER_HOVER : COLOR_BORDER,
    borderRadius: 6,
    position: 'relative' as const,
  };
}

function Toggle({ label, on, onPress, accent }: { label: string; on: boolean; onPress: () => void; accent: string }) {
  return (
    <Pressable onPress={onPress}>
      <Box style={{
        paddingLeft: 14, paddingRight: 14, paddingTop: 8, paddingBottom: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: on ? accent : '#2a2a2e',
        backgroundColor: on ? '#1a1a1d' : '#121215',
      }}>
        <Text style={{ fontSize: 12, color: on ? accent : '#bdbdc4' }}>
          {label}
        </Text>
      </Box>
    </Pressable>
  );
}

export default function CardStress() {
  const [count, setCount] = useState(100);
  const [mode, setMode] = useState<Mode>('each-fx');
  const [scrollable, setScrollable] = useState(false);
  const cards: number[] = [];
  for (let i = 0; i < count; i++) cards.push(i);

  // ONE-FX shader: renders all `count` cards in one fragment pass.
  // The grid layout (cols × rows, card size, gap, padding) is baked
  // into the WGSL via string interpolation. The hit-zone overlay
  // uses the SAME constants so the React layout aligns pixel-for-pixel
  // with what the shader draws.
  const numRows = Math.ceil(count / COLS_PER_ROW);
  const gridW = COLS_PER_ROW * CARD_W + (COLS_PER_ROW - 1) * CARD_GAP + GRID_PAD * 2;
  const gridH = numRows * CARD_H + Math.max(0, numRows - 1) * CARD_GAP + GRID_PAD * 2;
  const oneFxWgsl = useMemo(() => `
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let cols = ${COLS_PER_ROW}.0;
  let rows = ${numRows}.0;
  let total = ${count}.0;
  let pad = ${GRID_PAD}.0;
  let card_w = ${CARD_W}.0;
  let card_h = ${CARD_H}.0;
  let gap = ${CARD_GAP}.0;
  let stride_x = card_w + gap;
  let stride_y = card_h + gap;

  let px = in.uv.x * U.size_w - pad;
  let py = in.uv.y * U.size_h - pad;
  if (px < 0.0 || py < 0.0) { return vec4f(0.0, 0.0, 0.0, 0.0); }

  let col = floor(px / stride_x);
  let row = floor(py / stride_y);
  if (col >= cols || row >= rows) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  let card_idx = row * cols + col;
  if (card_idx >= total) { return vec4f(0.0, 0.0, 0.0, 0.0); }

  // Position WITHIN the card cell (0..card_w, 0..card_h).
  let cx_in = px - col * stride_x;
  let cy_in = py - row * stride_y;
  if (cx_in > card_w || cy_in > card_h) { return vec4f(0.0, 0.0, 0.0, 0.0); }

  // Normalized coordinates within the card (0..1) — same as a per-
  // card Effect's in.uv would be.
  let u = cx_in / card_w;
  let v = cy_in / card_h;
  let t = U.time;
  let dx = u - 0.5;
  let dy = v - 0.5;
  let dist = sqrt(dx * dx + dy * dy);
  let pulse = sin(t * 2.0 - dist * 8.0) * 0.5 + 0.5;
  return vec4f(0.10 + pulse * 0.45, 0.18 + pulse * 0.30, 0.42 + pulse * 0.50, 1.0);
}
`, [count, numRows]);

  return (
    <Box style={{
      flexGrow: 1, width: '100%', height: '100%',
      backgroundColor: COLOR_BG,
      paddingTop: 16, paddingLeft: 16, paddingRight: 16, paddingBottom: 16,
      flexDirection: 'column', gap: 10,
    }}>
      <Box style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 16, color: COLOR_INK, fontWeight: 'bold' }}>
          Card-stress · 3 architectures × 4 scales
        </Text>
        <Box style={{ flexDirection: 'row', gap: 16 }}>
          <Text style={{ fontSize: 11, color: COLOR_DIM }}>{`mode ${mode}`}</Text>
          <Text style={{ fontSize: 11, color: COLOR_DIM }}>{`cards ${count}`}</Text>
        </Box>
      </Box>

      {/* Mode + count toggles */}
      <Box style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Toggle label="EACH-FX" on={mode === 'each-fx'} onPress={() => setMode('each-fx')} accent="#ff7a3d" />
        <Toggle label="EACH-BOX" on={mode === 'each-box'} onPress={() => setMode('each-box')} accent="#34d399" />
        <Toggle label="ONE-FX" on={mode === 'one-fx'} onPress={() => setMode('one-fx')} accent="#facc15" />
        <Box style={{ width: 12 }} />
        {COUNTS.map((c) => (
          <Toggle key={c} label={String(c)} on={c === count} onPress={() => setCount(c)} accent="#3da9ff" />
        ))}
        <Box style={{ width: 12 }} />
        <Toggle label="SCROLL" on={scrollable} onPress={() => setScrollable(!scrollable)} accent="#a78bfa" />
      </Box>

      <Box style={{
        flexGrow: 1,
        position: 'relative',
        backgroundColor: '#0a0a0d',
        borderWidth: 1, borderColor: COLOR_BORDER,
        borderRadius: 6,
        padding: GRID_PAD,
      }}>
        {(() => {
          const grid = mode === 'one-fx' ? (
            // Outer Box is sized to the EXACT total grid dimensions so
            // both the underlying Effect and the hit-zone overlay can
            // reference the same coordinate space. The shader's grid
            // math (cols / rows / card_w / gap) lines up with the
            // overlay's flex-wrap layout because both use the same
            // pixel constants.
            <Box style={{ position: 'relative', width: gridW, height: gridH }}>
              <Effect shader={oneFxWgsl} style={{
                position: 'absolute',
                left: 0, top: 0,
                width: gridW, height: gridH,
              }} />
              <Box style={{
                position: 'absolute',
                left: GRID_PAD, top: GRID_PAD,
                width: gridW - GRID_PAD * 2,
                height: gridH - GRID_PAD * 2,
                flexDirection: 'row',
                flexWrap: 'wrap',
                alignContent: 'flex-start',
              }}>
                {cards.map((i) => <HitZoneOnly key={i} idx={i} />)}
              </Box>
            </Box>
          ) : (
            <Box style={{ flexDirection: 'row', flexWrap: 'wrap', alignContent: 'flex-start' }}>
              {cards.map((i) => mode === 'each-fx'
                ? <CardEachFx key={i} idx={i} />
                : <CardEachBox key={i} idx={i} />
              )}
            </Box>
          );
          return scrollable
            ? <ScrollView style={{ width: '100%', height: '100%' }}>{grid}</ScrollView>
            : grid;
        })()}
      </Box>
    </Box>
  );
}
