// carve_lab — drop an image, get a carved 3D piece.
//
// The cutout→inflate pipeline (Geometry.Carve): the image's transparent pixels
// are carved away, the remaining silhouette is inflated into a rounded 3D piece
// (depth/inflate knobs), and the image itself textures the front and back. PNGs
// with transparency read best — cut a shape out of any photo with the cutout
// cart first, then drop the result here. Opaque images carve as a full slab.
//
//   drop image → magick pads it square → alpha mask grid + texture PNG
//             → <Scene3D.Mesh geometry={Geometry.Carve}> + textureKey
//
// Drag orbits. Knobs: grid resolution / depth / inflate.
//
// Ship: ./scripts/ship carve_lab      Dev: ./scripts/dev carve_lab

import { useMemo, useRef, useState } from 'react';
import { Box, Col, Row, Image, Pressable, Text, Scene3D, StaticSurface } from '@reactjit/runtime/primitives';
import { useFileDrop } from '@reactjit/runtime/hooks/useFileDrop';
import { run } from '@reactjit/runtime/hooks/process';
import { readFile, mkdir } from '@reactjit/runtime/hooks/fs';
import * as Geometry from '@reactjit/geometries';
import { OrbitCamera } from '@reactjit/cameras';
import { parseTxt } from './pixel_icons/matrix';
import type { PixelMatrix } from './pixel_icons/PixelIcon';

const BG = '#0b1018';
const INK = '#e8eef8';
const DIM = '#7f93b1';
const ACCENT = '#3da9ff';

const SCRATCH_DIR = '/tmp/_reactjit_carve';
const TEX_PX = 512;
const RESOLUTIONS = [32, 48, 64] as const;

// ── ingestion: image → padded-square mask grid + texture PNG ────────────────

// Both outputs use the same resize-then-pad framing (aspect preserved, centered,
// transparent padding), so mask cell (x,y) and texture UV (x,y) always line up.
async function imageToGrid(srcPath: string, size: number): Promise<PixelMatrix> {
  mkdir(SCRATCH_DIR);
  const out = `${SCRATCH_DIR}/grid_${size}.txt`;
  const r = await run('magick', [
    srcPath,
    '-resize', `${size}x${size}`,
    '-background', 'none', '-gravity', 'center', '-extent', `${size}x${size}`,
    '+dither', '-colors', '32', '-depth', '8',
    `txt:${out}`,
  ]);
  if (r.code !== 0) throw new Error(`magick grid failed (${r.code}): ${r.stderr.slice(0, 160)}`);
  const txt = readFile(out);
  if (!txt) throw new Error(`could not read ${out}`);
  return parseTxt(txt, size);
}

async function imageToTexture(srcPath: string, outPath: string): Promise<void> {
  mkdir(SCRATCH_DIR);
  const r = await run('magick', [
    srcPath,
    '-resize', `${TEX_PX}x${TEX_PX}`,
    '-background', 'none', '-gravity', 'center', '-extent', `${TEX_PX}x${TEX_PX}`,
    `PNG32:${outPath}`,
  ]);
  if (r.code !== 0) throw new Error(`magick texture failed (${r.code}): ${r.stderr.slice(0, 160)}`);
}

// ── starter shape: a heart, so the lab carves something before any drop ─────

function heartMask(size: number): number[] {
  const m: number[] = new Array(size * size).fill(0);
  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      const x = ((gx + 0.5) / size - 0.5) * 2.9;
      const y = (0.5 - (gy + 0.5) / size) * 2.9 - 0.15;
      const a = x * x + y * y - 1;
      if (a * a * a - x * x * y * y * y <= 0) m[gy * size + gx] = 1;
    }
  }
  return m;
}

// ── UI bits ──────────────────────────────────────────────────────────────────

function Knob(props: { label: string; value: string; onMinus: () => void; onPlus: () => void }) {
  const btn = { width: 26, height: 26, borderRadius: 5, borderWidth: 1, borderColor: '#22324a', backgroundColor: '#101a2a', alignItems: 'center' as const, justifyContent: 'center' as const };
  return (
    <Row style={{ alignItems: 'center', gap: 8 }}>
      <Text fontSize={12} color={DIM} style={{ width: 78 }}>{props.label}</Text>
      <Pressable onPress={props.onMinus} style={btn}><Text fontSize={14} color={INK}>-</Text></Pressable>
      <Text fontSize={13} color={INK} style={{ width: 52, textAlign: 'center' }}>{props.value}</Text>
      <Pressable onPress={props.onPlus} style={btn}><Text fontSize={14} color={INK}>+</Text></Pressable>
    </Row>
  );
}

export default function CarveLab() {
  const [srcPath, setSrcPath] = useState<string | null>(null);
  const [matrix, setMatrix] = useState<PixelMatrix | null>(null);
  const [texSeq, setTexSeq] = useState(0); // bumps per ingest; versions path + staticKey
  const [res, setRes] = useState<number>(48);
  const [depth, setDepth] = useState(0.55);
  const [inflate, setInflate] = useState(0.7);
  const [status, setStatus] = useState('drop an image to carve it (transparent PNGs read best)');
  const [yaw, setYaw] = useState(24);
  const [pitch, setPitch] = useState(18);
  const [dist, setDist] = useState(3.4);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const busyRef = useRef(false);

  const ingest = async (path: string, gridSize: number) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setStatus('carving…');
    try {
      const seq = texSeq + 1;
      const texPath = `${SCRATCH_DIR}/tex_${seq}.png`;
      await imageToTexture(path, texPath);
      const grid = await imageToGrid(path, gridSize);
      setSrcPath(path);
      setMatrix(grid);
      setTexSeq(seq);
      const cells = grid.pixels.filter((px) => px != null).length;
      setStatus(`${path.split('/').pop()} — ${gridSize}×${gridSize} grid, ${cells} solid cells`);
    } catch (err) {
      setStatus(String(err));
    } finally {
      busyRef.current = false;
    }
  };

  useFileDrop((path) => { void ingest(path, res); });

  const changeRes = (next: number) => {
    setRes(next);
    if (srcPath) void ingest(srcPath, next);
  };

  // Geometry params — stable identities so the interned mesh only regenerates
  // when the mask or a knob actually changes.
  const mask = useMemo<number[]>(
    () => (matrix ? matrix.pixels.map((px) => (px == null ? 0 : 1)) : heartMask(res)),
    [matrix, res],
  );
  const params = useMemo(
    () => ({ mask, cols: matrix?.size ?? res, rows: matrix?.size ?? res, width: 2, height: 2, depth, inflate }),
    [mask, matrix, res, depth, inflate],
  );

  const texPath = matrix ? `${SCRATCH_DIR}/tex_${texSeq}.png` : null;
  const texKey = matrix ? `carve.lab.tex.${texSeq}` : undefined;
  const texStyle = useMemo(() => ({ width: 256, height: 256 }), []);
  const surfaceStyle = useMemo(
    () => ({ position: 'absolute' as const, left: -99999, top: 0, width: 256, height: 256 }),
    [],
  );

  const onDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; };
  const onMove = (e: any) => {
    const d = dragRef.current;
    if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    const dx = nx - d.x, dy = ny - d.y;
    d.x = nx; d.y = ny;
    setYaw((v) => v + dx * 0.4);
    setPitch((v) => Math.max(4, Math.min(85, v - dy * 0.3)));
  };
  const onUp = () => { dragRef.current = null; };

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: BG }}>
      <Pressable
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}
      >
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={BG} showGrid={false} showAxes={false}>
          <OrbitCamera target={[0, 1.1, 0]} yaw={yaw} pitch={pitch} dist={dist} fov={45} />
          <Scene3D.AmbientLight color="#aab8d6" intensity={0.6} />
          <Scene3D.DirectionalLight direction={[0.4, 0.9, 0.35]} color="#fff0d6" intensity={0.85} />
          <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 7, height: 0.03, depth: 7 }} material="#0e1726" position={[0, -0.015, 0]} />
          <Scene3D.Mesh
            geometry={Geometry.Carve}
            params={params}
            material={texKey ? '#ffffff' : '#c2455a'}
            textureKey={texKey}
            position={[0, 1.1, 0]}
          />
        </Scene3D>

        {/* offscreen: the padded source image baked to the mesh's texture */}
        {texPath && texKey ? (
          <StaticSurface staticKey={texKey} style={surfaceStyle}>
            <Image src={texPath} style={texStyle} />
          </StaticSurface>
        ) : null}

        <Box style={{ position: 'absolute', top: 14, left: 14, width: 320, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#1c2a40', backgroundColor: '#08111fee' }}>
          <Col style={{ gap: 10 }}>
            <Text fontSize={15} color={INK} style={{ fontWeight: 900 }}>CARVE LAB</Text>
            <Text fontSize={11} color={DIM}>{status}</Text>
            <Row style={{ alignItems: 'center', gap: 8 }}>
              <Text fontSize={12} color={DIM} style={{ width: 78 }}>grid</Text>
              {RESOLUTIONS.map((r) => (
                <Pressable
                  key={r}
                  onPress={() => changeRes(r)}
                  style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4, borderRadius: 5, borderWidth: 1, borderColor: res === r ? ACCENT : '#22324a', backgroundColor: res === r ? '#11263d' : '#101a2a' }}
                >
                  <Text fontSize={12} color={res === r ? ACCENT : INK}>{r}</Text>
                </Pressable>
              ))}
            </Row>
            <Knob label="depth" value={depth.toFixed(2)} onMinus={() => setDepth((v) => Math.max(0.05, v - 0.05))} onPlus={() => setDepth((v) => Math.min(2, v + 0.05))} />
            <Knob label="inflate" value={inflate.toFixed(1)} onMinus={() => setInflate((v) => Math.max(0, v - 0.1))} onPlus={() => setInflate((v) => Math.min(1, v + 0.1))} />
            <Knob label="zoom" value={dist.toFixed(1)} onMinus={() => setDist((v) => Math.max(1.2, v - 0.4))} onPlus={() => setDist((v) => Math.min(12, v + 0.4))} />
            <Text fontSize={11} color={DIM}>drag to orbit. cut shapes from photos with the cutout cart, then drop them here.</Text>
          </Col>
        </Box>
      </Pressable>
    </Box>
  );
}
