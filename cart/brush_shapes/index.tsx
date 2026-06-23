import { useMemo, useState } from 'react';
import { Box, Graph, Pressable, ScrollView, StaticSurface, Text } from '@reactjit/runtime/primitives';

const W = 1180;
const H = 820;
const PREVIEW_W = 248;
const PREVIEW_H = 156;

const BG = '#101218';
const PANEL = '#171b24';
const PANEL_DARK = '#0b0d12';
const RULE = '#2a3242';
const INK = '#f1f4f0';
const MUTED = '#9aa7b8';
const BLUE = '#67b7ff';
const GREEN = '#57d08b';
const AMBER = '#f3b45d';
const PINK = '#e879a8';
const CYAN = '#69d9cf';
const LIME = '#b8d76b';

type BrushKind =
  | 'round-hard'
  | 'round-soft'
  | 'square'
  | 'flat'
  | 'angle'
  | 'filbert'
  | 'fan'
  | 'rake'
  | 'dry'
  | 'calligraphy'
  | 'knife'
  | 'spray';

type BrushSpec = {
  kind: BrushKind;
  name: string;
  tag: string;
  note: string;
  color: string;
  angle: number;
};

const BRUSHES: BrushSpec[] = [
  { kind: 'round-hard', name: 'Hard round', tag: 'circle op', note: 'General blocking, masks, solid edges.', color: BLUE, angle: 0 },
  { kind: 'round-soft', name: 'Soft round', tag: 'falloff stamp', note: 'Airbrush-like value buildup.', color: CYAN, angle: 0 },
  { kind: 'square', name: 'Square block', tag: 'polygon', note: 'Pixel, gouache, chunky flats.', color: GREEN, angle: 0.12 },
  { kind: 'flat', name: 'Flat bristle', tag: 'polygon', note: 'Wide strokes with blunt ends.', color: AMBER, angle: -0.08 },
  { kind: 'angle', name: 'Angled chisel', tag: 'polygon', note: 'Beveled cuts and taper control.', color: PINK, angle: -0.34 },
  { kind: 'filbert', name: 'Filbert oval', tag: 'ellipse stamp', note: 'Soft natural paint strokes.', color: LIME, angle: 0.16 },
  { kind: 'fan', name: 'Fan bristles', tag: 'multi stamp', note: 'Grass, hair, feathers, streaks.', color: CYAN, angle: 0.05 },
  { kind: 'rake', name: 'Rake comb', tag: 'multi stamp', note: 'Parallel teeth for texture.', color: BLUE, angle: 0.02 },
  { kind: 'dry', name: 'Dry bristle', tag: 'broken stamp', note: 'Scratchy low-load paint.', color: AMBER, angle: 0.2 },
  { kind: 'calligraphy', name: 'Calligraphy nib', tag: 'angle stamp', note: 'Pressure-looking thick/thin lines.', color: PINK, angle: -0.78 },
  { kind: 'knife', name: 'Palette knife', tag: 'long polygon', note: 'Scraped paint and hard planes.', color: GREEN, angle: -0.18 },
  { kind: 'spray', name: 'Spray dots', tag: 'particle stamp', note: 'Spatter, dirt, porous masks.', color: LIME, angle: 0 },
];

function circleD(cx: number, cy: number, r: number): string {
  const c = r * 0.5522847498;
  return [
    `M ${cx} ${cy - r}`,
    `C ${cx + c} ${cy - r} ${cx + r} ${cy - c} ${cx + r} ${cy}`,
    `C ${cx + r} ${cy + c} ${cx + c} ${cy + r} ${cx} ${cy + r}`,
    `C ${cx - c} ${cy + r} ${cx - r} ${cy + c} ${cx - r} ${cy}`,
    `C ${cx - r} ${cy - c} ${cx - c} ${cy - r} ${cx} ${cy - r}`,
    'Z',
  ].join(' ');
}

function rotatePoint(x: number, y: number, cx: number, cy: number, a: number): [number, number] {
  const dx = x - cx;
  const dy = y - cy;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  return [cx + dx * ca - dy * sa, cy + dx * sa + dy * ca];
}

function rotatedRect(cx: number, cy: number, w: number, h: number, a: number): number[] {
  const pts = [
    [cx - w / 2, cy - h / 2],
    [cx + w / 2, cy - h / 2],
    [cx + w / 2, cy + h / 2],
    [cx - w / 2, cy + h / 2],
  ];
  return pts.flatMap(([x, y]) => rotatePoint(x, y, cx, cy, a));
}

function parallelogram(cx: number, cy: number, w: number, h: number, slant: number, a: number): number[] {
  const pts = [
    [cx - w / 2 + slant, cy - h / 2],
    [cx + w / 2 + slant, cy - h / 2],
    [cx + w / 2 - slant, cy + h / 2],
    [cx - w / 2 - slant, cy + h / 2],
  ];
  return pts.flatMap(([x, y]) => rotatePoint(x, y, cx, cy, a));
}

function ellipsePoints(cx: number, cy: number, rx: number, ry: number, a: number, n = 36): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = cx + Math.cos(t) * rx;
    const y = cy + Math.sin(t) * ry;
    out.push(...rotatePoint(x, y, cx, cy, a));
  }
  return out;
}

function blobPoints(cx: number, cy: number, r: number, seed: number, a: number, n = 18): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const wobble =
      0.78 +
      0.18 * Math.sin(t * 3 + seed * 1.7) +
      0.12 * Math.sin(t * 7 + seed * 0.9);
    const x = cx + Math.cos(t) * r * wobble;
    const y = cy + Math.sin(t) * r * wobble;
    out.push(...rotatePoint(x, y, cx, cy, a));
  }
  return out;
}

function stamp(spec: BrushSpec, cx: number, cy: number, size: number, key: string, alpha = 1, angle = spec.angle): any[] {
  const color = spec.color;
  switch (spec.kind) {
    case 'round-hard':
      return [<Graph.Path key={key} d={circleD(cx, cy, size * 0.46)} fill={color} fillOpacity={alpha} />];
    case 'round-soft':
      return [0.95, 0.68, 0.42, 0.22].map((op, i) => (
        <Graph.Path key={`${key}-${i}`} d={circleD(cx, cy, size * (0.52 - i * 0.085))} fill={color} fillOpacity={alpha * op} />
      ));
    case 'square':
      return [<Graph.Polygon key={key} points={rotatedRect(cx, cy, size * 0.82, size * 0.82, angle)} fill={color} />];
    case 'flat':
      return [<Graph.Polygon key={key} points={rotatedRect(cx, cy, size * 1.2, size * 0.38, angle)} fill={color} />];
    case 'angle':
      return [<Graph.Polygon key={key} points={parallelogram(cx, cy, size * 1.08, size * 0.46, size * 0.22, angle)} fill={color} />];
    case 'filbert':
      return [<Graph.Polygon key={key} points={ellipsePoints(cx, cy, size * 0.58, size * 0.34, angle, 40)} fill={color} />];
    case 'fan': {
      const out: any[] = [];
      for (let i = -3; i <= 3; i++) {
        const spread = i * size * 0.15;
        const a = angle + i * 0.13;
        out.push(<Graph.Polygon key={`${key}-${i}`} points={ellipsePoints(cx + spread, cy + Math.abs(i) * 1.8, size * 0.07, size * 0.47, a, 20)} fill={color} />);
      }
      return out;
    }
    case 'rake': {
      const out: any[] = [];
      for (let i = -3; i <= 3; i++) {
        out.push(<Graph.Polygon key={`${key}-${i}`} points={rotatedRect(cx + i * size * 0.13, cy, size * 0.06, size * 0.78, angle)} fill={color} />);
      }
      return out;
    }
    case 'dry': {
      const out: any[] = [];
      for (let i = 0; i < 9; i++) {
        const px = cx + (i - 4) * size * 0.105;
        const py = cy + Math.sin(i * 1.9) * size * 0.16;
        out.push(<Graph.Polygon key={`${key}-${i}`} points={blobPoints(px, py, size * (0.09 + (i % 3) * 0.018), i + 3, angle, 12)} fill={color} />);
      }
      return out;
    }
    case 'calligraphy':
      return [<Graph.Polygon key={key} points={rotatedRect(cx, cy, size * 1.0, size * 0.28, angle)} fill={color} />];
    case 'knife':
      return [<Graph.Polygon key={key} points={parallelogram(cx, cy, size * 1.38, size * 0.24, size * 0.13, angle)} fill={color} />];
    case 'spray': {
      const out: any[] = [];
      for (let i = 0; i < 22; i++) {
        const t = i * 12.9898;
        const rr = size * (0.1 + ((Math.sin(t) + 1) * 0.5) * 0.42);
        const aa = i * 2.39996;
        const px = cx + Math.cos(aa) * rr;
        const py = cy + Math.sin(aa) * rr * 0.82;
        const pr = size * (0.018 + (i % 4) * 0.009);
        out.push(<Graph.Path key={`${key}-${i}`} d={circleD(px, py, pr)} fill={color} fillOpacity={alpha * (0.55 + (i % 3) * 0.15)} />);
      }
      return out;
    }
  }
}

function stroke(spec: BrushSpec): any[] {
  const out: any[] = [];
  const count = spec.kind === 'spray' ? 13 : spec.kind === 'round-soft' ? 15 : 18;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const x = 30 + t * 184;
    const y = 86 + Math.sin(t * Math.PI * 1.45 - 0.55) * 18;
    const size = 24 + Math.sin(t * Math.PI) * 18;
    const alpha = spec.kind === 'dry' ? 0.96 : 0.78;
    out.push(...stamp(spec, x, y, size, `s-${spec.kind}-${i}`, alpha, spec.angle + Math.cos(t * Math.PI * 1.3) * 0.18));
  }
  return out;
}

function LabelPill({ label }: { label: string }) {
  return (
    <Box style={{
      alignSelf: 'flex-start',
      paddingLeft: 8,
      paddingRight: 8,
      paddingTop: 4,
      paddingBottom: 4,
      borderRadius: 6,
      backgroundColor: '#202837',
      borderWidth: 1,
      borderColor: '#334156',
    }}>
      <Text style={{ fontSize: 10, color: '#c9d5e4', fontWeight: 'bold' }}>{label}</Text>
    </Box>
  );
}

function BrushCard({ spec, selected, onPress }: { spec: BrushSpec; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Box style={{
        width: 540,
        height: 246,
        padding: 12,
        gap: 10,
        backgroundColor: selected ? '#1b2330' : PANEL,
        borderWidth: 1,
        borderColor: selected ? spec.color : RULE,
        borderRadius: 8,
      }}>
        <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box style={{ gap: 4 }}>
            <Text style={{ fontSize: 16, color: INK, fontWeight: 'bold' }}>{spec.name}</Text>
            <Text style={{ fontSize: 11, color: MUTED }}>{spec.note}</Text>
          </Box>
          <LabelPill label={spec.tag} />
        </Box>

        <Box style={{ flexDirection: 'row', gap: 10 }}>
          <Box style={{
            width: PREVIEW_W,
            height: PREVIEW_H,
            backgroundColor: PANEL_DARK,
            borderWidth: 1,
            borderColor: '#252d3c',
            borderRadius: 6,
            overflow: 'hidden',
          }}>
            <Graph style={{ width: PREVIEW_W, height: PREVIEW_H }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
              <Graph.Path d="M 18 126 L 230 126" stroke="#262f3f" strokeWidth={1} />
              {stamp(spec, PREVIEW_W / 2, 78, 86, `stamp-${spec.kind}`, 1)}
            </Graph>
          </Box>

          <Box style={{
            width: PREVIEW_W,
            height: PREVIEW_H,
            backgroundColor: PANEL_DARK,
            borderWidth: 1,
            borderColor: '#252d3c',
            borderRadius: 6,
            overflow: 'hidden',
          }}>
            <Graph style={{ width: PREVIEW_W, height: PREVIEW_H }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
              <Graph.Path d="M 22 88 C 74 42 126 134 224 70" stroke="#263040" strokeWidth={1.5} />
              {stroke(spec)}
            </Graph>
          </Box>
        </Box>
      </Box>
    </Pressable>
  );
}

function BigPreview({ spec }: { spec: BrushSpec }) {
  return (
    <Box style={{
      width: '100%',
      height: 250,
      backgroundColor: '#0c0f15',
      borderWidth: 1,
      borderColor: '#2b3547',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      <Graph style={{ width: '100%', height: '100%' }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
        <Graph.Path d="M 34 162 C 134 76 216 216 338 106 C 450 4 560 186 674 74 C 770 -10 870 116 1038 74" stroke="#293346" strokeWidth={2} />
        {Array.from({ length: 34 }).flatMap((_, i) => {
          const t = i / 33;
          const x = 52 + t * 980;
          const y = 150 + Math.sin(t * Math.PI * 4.2 - 0.35) * 36 + Math.sin(t * Math.PI * 1.4) * 22;
          const size = 34 + Math.sin(t * Math.PI) * 38;
          return stamp(spec, x, y, size, `big-${spec.kind}-${i}`, 0.82, spec.angle + Math.cos(t * Math.PI * 2.0) * 0.22);
        })}
      </Graph>
    </Box>
  );
}

function Header({ selected }: { selected: BrushSpec }) {
  return (
    <Box style={{
      paddingLeft: 18,
      paddingRight: 18,
      paddingTop: 14,
      paddingBottom: 14,
      backgroundColor: '#151922',
      borderBottomWidth: 1,
      borderColor: RULE,
      gap: 10,
    }}>
      <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box style={{ gap: 4 }}>
          <Text style={{ fontSize: 22, color: INK, fontWeight: 'bold' }}>Brush Shape Gallery</Text>
          <Text style={{ fontSize: 12, color: MUTED }}>
            Stamp silhouettes and repeated-stamp strokes for paint surface brush choices.
          </Text>
        </Box>
        <Box style={{ width: 180, alignItems: 'flex-end', gap: 4 }}>
          <Text style={{ fontSize: 11, color: MUTED }}>selected</Text>
          <Text style={{ fontSize: 15, color: selected.color, fontWeight: 'bold' }}>{selected.name}</Text>
        </Box>
      </Box>
      <BigPreview spec={selected} />
    </Box>
  );
}

export default function BrushShapesCart() {
  const [selectedKind, setSelectedKind] = useState<BrushKind>('round-hard');
  const selected = useMemo(
    () => BRUSHES.find((brush) => brush.kind === selectedKind) ?? BRUSHES[0],
    [selectedKind],
  );

  return (
    <Box style={{ width: W, height: H, backgroundColor: BG }}>
      <Header selected={selected} />
      <ScrollView style={{ flexGrow: 1 }} showScrollbar>
        <StaticSurface staticKey="brush-shape-gallery" scale={1}>
          <Box style={{
            paddingLeft: 18,
            paddingRight: 18,
            paddingTop: 18,
            paddingBottom: 22,
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 14,
          }}>
            {BRUSHES.map((spec) => (
              <BrushCard
                key={spec.kind}
                spec={spec}
                selected={spec.kind === selected.kind}
                onPress={() => setSelectedKind(spec.kind)}
              />
            ))}
          </Box>
        </StaticSurface>
      </ScrollView>
    </Box>
  );
}
