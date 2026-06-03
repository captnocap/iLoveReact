// head_lab — paint a head into existence.
//
// The user's pipeline, verbatim: take a face picture, put it on a HEAD-SHAPED
// unwrap (not a flat plane), paint depth over it with a brush, and the painted
// rectangle wraps back around a 3D head. The paint surface IS the unwrap —
// photo, depth strokes, and the head's texture all live in the same 2:1
// equirect space (Geometry.Globe), so nothing ever needs un/re-wrapping.
//
//   left:  the unwrap canvas — skin base, dropped photo (position/scale knobs),
//          blue heat overlay = your painted depth strokes
//   right: the live 3D head — drag orbits; mesh re-sculpts on stroke release
//
// Depth strokes displace the head outward along its surface (nose, brow,
// chin...); erase mode flattens back. `amount` scales how far full-blue pushes.
//
// Ship: ./scripts/ship head_lab      Dev: ./scripts/dev head_lab

import { useMemo, useRef, useState } from 'react';
import { Box, Col, Row, Image, Pressable, Text, Scene3D, StaticSurface } from '@reactjit/runtime/primitives';
import { useFileDrop } from '@reactjit/runtime/hooks/useFileDrop';
import * as Geometry from '@reactjit/geometries';
import { OrbitCamera } from '@reactjit/cameras';

const BG = '#0b1018';
const INK = '#e8eef8';
const DIM = '#7f93b1';
const ACCENT = '#3da9ff';

// Unwrap canvas + bake share these dims (2:1 equirect).
const UNWRAP_W = 512;
const UNWRAP_H = 256;
// Depth grid resolution (cells, unwrap space). Coarse on purpose: strokes are
// sculpting gestures, not pixels, and the overlay stays under the layout's
// child cap even fully painted.
const GRID_W = 48;
const GRID_H = 24;

const SKINS = ['#caa07a', '#8d5a3c', '#e0b48c', '#a9785a'];

type Photo = { path: string; stamp: number };

// ── the unwrap composition — rendered TWICE: once as the visible paint canvas
// (with heat overlay on top) and once inside the StaticSurface bake that the
// head samples. One component, so display and texture can never disagree.
function UnwrapContent(props: { skin: string; photo: Photo | null; photoScale: number; photoY: number }) {
  const side = props.photoScale * UNWRAP_W;
  return (
    <Box style={{ width: UNWRAP_W, height: UNWRAP_H, backgroundColor: props.skin, position: 'relative', overflow: 'hidden' }}>
      {props.photo ? (
        <Image
          src={props.photo.path}
          style={{
            position: 'absolute',
            left: UNWRAP_W / 2 - side / 2,
            top: UNWRAP_H / 2 - side / 2 + props.photoY,
            width: side,
            height: side,
          }}
        />
      ) : null}
    </Box>
  );
}

// Heat overlay: one box per painted cell, alpha bucketed by depth. Reads the
// grid by reference — the per-dab strokeTick re-render keeps it live without
// copying the grid into state.
function DepthOverlay(props: { grid: number[] }) {
  const cellW = UNWRAP_W / GRID_W;
  const cellH = UNWRAP_H / GRID_H;
  const boxes: any[] = [];
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const d = props.grid[gy * GRID_W + gx];
      if (d < 0.03) continue;
      const alpha = d < 0.25 ? '40' : d < 0.5 ? '70' : d < 0.75 ? 'a0' : 'd0';
      boxes.push(
        <Box
          key={gy * GRID_W + gx}
          style={{ position: 'absolute', left: gx * cellW, top: gy * cellH, width: cellW, height: cellH, backgroundColor: `${ACCENT}${alpha}` }}
        />,
      );
    }
  }
  return <>{boxes}</>;
}

function Knob(props: { label: string; value: string; onMinus: () => void; onPlus: () => void }) {
  const btn = { width: 24, height: 24, borderRadius: 5, borderWidth: 1, borderColor: '#22324a', backgroundColor: '#101a2a', alignItems: 'center' as const, justifyContent: 'center' as const };
  return (
    <Row style={{ alignItems: 'center', gap: 6 }}>
      <Text fontSize={11} color={DIM} style={{ width: 84 }}>{props.label}</Text>
      <Pressable onPress={props.onMinus} style={btn}><Text fontSize={13} color={INK}>-</Text></Pressable>
      <Text fontSize={12} color={INK} style={{ width: 46, textAlign: 'center' }}>{props.value}</Text>
      <Pressable onPress={props.onPlus} style={btn}><Text fontSize={13} color={INK}>+</Text></Pressable>
    </Row>
  );
}

export default function HeadLab() {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoScale, setPhotoScale] = useState(0.4);
  const [photoY, setPhotoY] = useState(0);
  const [skin, setSkin] = useState(SKINS[0]);
  const [brush, setBrush] = useState(4);
  const [strength, setStrength] = useState(0.5);
  const [erase, setErase] = useState(false);
  const [amount, setAmount] = useState(0.35);
  const [scaleY, setScaleY] = useState(1.2);
  const [yaw, setYaw] = useState(20);
  const [pitch, setPitch] = useState(12);
  const [dist, setDist] = useState(4.2);
  // grid lives in a ref (strokes are per-mousemove); ticks drive re-renders:
  // strokeTick per dab (overlay), meshTick on release (geometry rebuild).
  const gridRef = useRef<number[]>(new Array(GRID_W * GRID_H).fill(0));
  const [strokeTick, setStrokeTick] = useState(0);
  const [meshTick, setMeshTick] = useState(0);
  const paintingRef = useRef(false);
  const canvasRect = useRef({ x: 0, y: 0, width: UNWRAP_W, height: UNWRAP_H });
  const orbitRef = useRef<{ x: number; y: number } | null>(null);

  useFileDrop((path) => setPhoto({ path, stamp: Date.now() }));

  const dab = (sx: number, sy: number) => {
    const r = canvasRect.current;
    const gx = ((sx - r.x) / r.width) * GRID_W;
    const gy = ((sy - r.y) / r.height) * GRID_H;
    const grid = gridRef.current;
    const rad = brush;
    const x0 = Math.max(0, Math.floor(gx - rad)), x1 = Math.min(GRID_W - 1, Math.ceil(gx + rad));
    const y0 = Math.max(0, Math.floor(gy - rad)), y1 = Math.min(GRID_H - 1, Math.ceil(gy + rad));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - gx, y + 0.5 - gy);
        if (d > rad) continue;
        const fall = strength * 0.25 * (1 - d / rad);
        const i = y * GRID_W + x;
        grid[i] = Math.max(0, Math.min(1, grid[i] + (erase ? -fall * 2 : fall)));
      }
    }
    setStrokeTick((t) => t + 1);
  };

  const onPaintDown = (e: any) => { paintingRef.current = true; dab(Number(e?.x ?? 0), Number(e?.y ?? 0)); };
  const onPaintMove = (e: any) => { if (paintingRef.current) dab(Number(e?.x ?? 0), Number(e?.y ?? 0)); };
  const onPaintUp = () => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    setMeshTick((t) => t + 1);
  };

  const clearStrokes = () => {
    gridRef.current = new Array(GRID_W * GRID_H).fill(0);
    setStrokeTick((t) => t + 1);
    setMeshTick((t) => t + 1);
  };

  // Geometry: identity changes only on stroke release / knob change, so the
  // interned mesh regenerates exactly then — never per mousemove.
  const params = useMemo(
    () => ({
      radius: 1, segments: 48, rings: 24,
      displace: gridRef.current.slice(), dCols: GRID_W, dRows: GRID_H,
      amount, scaleY,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- meshTick stands in for gridRef content
    [meshTick, amount, scaleY],
  );

  // Content-addressed texture key: the bake is a pure function of these values,
  // so a key can never serve a stale image (the carve_lab hot-reload lesson),
  // and stepping a knob back reuses the earlier bake.
  const texKey = `head.lab.${photo?.stamp ?? 'bare'}.${skin}.${photoScale.toFixed(2)}.${photoY}`;
  const surfaceStyle = useMemo(
    () => ({ position: 'absolute' as const, left: -99999, top: 0, width: UNWRAP_W, height: UNWRAP_H }),
    [],
  );

  const orbitDown = (e: any) => { orbitRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; };
  const orbitMove = (e: any) => {
    const d = orbitRef.current;
    if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    setYaw((v) => v + (nx - d.x) * 0.4);
    setPitch((v) => Math.max(4, Math.min(85, v - (ny - d.y) * 0.3)));
    d.x = nx; d.y = ny;
  };
  const orbitUp = () => { orbitRef.current = null; };

  return (
    <Row style={{ width: '100%', height: '100%', backgroundColor: BG }}>
      {/* ── left: the unwrap painter ── */}
      <Col style={{ width: UNWRAP_W + 28, padding: 14, gap: 10 }}>
        <Text fontSize={15} color={INK} style={{ fontWeight: 900 }}>HEAD LAB</Text>
        <Text fontSize={11} color={DIM}>
          {photo ? 'paint depth over the face — blue = pushed out on the head' : 'drop a face picture, then paint depth over it'}
        </Text>
        <Pressable
          onLayout={(lr: any) => { canvasRect.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
          onMouseDown={onPaintDown}
          onMouseMove={onPaintMove}
          onMouseUp={onPaintUp}
          style={{ width: UNWRAP_W, height: UNWRAP_H, borderWidth: 1, borderColor: '#22324a', position: 'relative' }}
        >
          <UnwrapContent skin={skin} photo={photo} photoScale={photoScale} photoY={photoY} />
          <Box style={{ position: 'absolute', left: 0, top: 0, width: UNWRAP_W, height: UNWRAP_H }}>
            <DepthOverlay grid={gridRef.current} />
          </Box>
        </Pressable>
        <Row style={{ gap: 8, alignItems: 'center' }}>
          <Pressable
            onPress={() => setErase((v) => !v)}
            style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 5, borderWidth: 1, borderColor: erase ? '#f59e0b' : ACCENT, backgroundColor: '#101a2a' }}
          >
            <Text fontSize={12} color={erase ? '#f59e0b' : ACCENT}>{erase ? 'erasing' : 'raising'}</Text>
          </Pressable>
          <Pressable onPress={clearStrokes} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 5, borderWidth: 1, borderColor: '#22324a', backgroundColor: '#101a2a' }}>
            <Text fontSize={12} color={DIM}>clear</Text>
          </Pressable>
          <Row style={{ gap: 6, alignItems: 'center' }}>
            {SKINS.map((s) => (
              <Pressable key={s} onPress={() => setSkin(s)} style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: s, borderWidth: 2, borderColor: skin === s ? ACCENT : '#22324a' }} />
            ))}
          </Row>
        </Row>
        <Knob label="brush size" value={String(brush)} onMinus={() => setBrush((v) => Math.max(2, v - 1))} onPlus={() => setBrush((v) => Math.min(14, v + 1))} />
        <Knob label="strength" value={strength.toFixed(1)} onMinus={() => setStrength((v) => Math.max(0.1, v - 0.1))} onPlus={() => setStrength((v) => Math.min(1, v + 0.1))} />
        <Knob label="depth amount" value={amount.toFixed(2)} onMinus={() => setAmount((v) => Math.max(0.05, v - 0.05))} onPlus={() => setAmount((v) => Math.min(0.8, v + 0.05))} />
        <Knob label="skull stretch" value={scaleY.toFixed(2)} onMinus={() => setScaleY((v) => Math.max(0.9, v - 0.05))} onPlus={() => setScaleY((v) => Math.min(1.6, v + 0.05))} />
        <Knob label="photo size" value={photoScale.toFixed(2)} onMinus={() => setPhotoScale((v) => Math.max(0.15, v - 0.05))} onPlus={() => setPhotoScale((v) => Math.min(0.95, v + 0.05))} />
        <Knob label="photo up/down" value={String(photoY)} onMinus={() => setPhotoY((v) => v - 8)} onPlus={() => setPhotoY((v) => v + 8)} />
      </Col>

      {/* ── right: the live head ── */}
      <Pressable
        onMouseDown={orbitDown}
        onMouseMove={orbitMove}
        onMouseUp={orbitUp}
        style={{ flexGrow: 1, height: '100%', position: 'relative', overflow: 'hidden' }}
      >
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={BG} showGrid={false} showAxes={false}>
          <OrbitCamera target={[0, 1.4, 0]} yaw={yaw} pitch={pitch} dist={dist} fov={45} />
          <Scene3D.AmbientLight color="#aab8d6" intensity={0.6} />
          <Scene3D.DirectionalLight direction={[0.4, 0.9, 0.35]} color="#fff0d6" intensity={0.85} />
          <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 8, height: 0.03, depth: 8 }} material="#0e1726" position={[0, -0.015, 0]} />
          <Scene3D.Mesh
            geometry={Geometry.Globe}
            params={params}
            material="#ffffff"
            textureKey={texKey}
            position={[0, 1.4, 0]}
          />
        </Scene3D>
        <Box style={{ position: 'absolute', right: 14, bottom: 14 }}>
          <Knob label="zoom" value={dist.toFixed(1)} onMinus={() => setDist((v) => Math.max(1.6, v - 0.4))} onPlus={() => setDist((v) => Math.min(12, v + 0.4))} />
        </Box>
      </Pressable>

      {/* offscreen: the unwrap baked to the head's texture (no overlay) */}
      <StaticSurface staticKey={texKey} style={surfaceStyle}>
        <UnwrapContent skin={skin} photo={photo} photoScale={photoScale} photoY={photoY} />
      </StaticSurface>
    </Row>
  );
}
