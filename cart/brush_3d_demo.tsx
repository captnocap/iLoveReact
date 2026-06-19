/**
 * brush_3d_demo — the universal paint kit (runtime/paint) painting ON a 3D
 * surface, not a flat canvas. Proves req_1456: "you need to account for brushes
 * on 3d also." The SAME useBrushStroke + BrushKit drive it — only `mapPoint`
 * changes: instead of a screen→rect map, it raycasts the 3D plane and returns
 * the hit UV in texture pixels (plus, for a real model, the hit face's island
 * clip). The mesh samples the painted GPU texture by `textureKey`, so the brush
 * lands in perspective, on the surface, under the cursor.
 *
 * The plane auto-orbits so the 3D-ness is undeniable; it freezes while you
 * paint so a stroke maps against a stable camera. This is the exact mechanism
 * the in-repo studio pixel painter uses (raycast → UV → brushColor with the
 * face island clip; mesh textureKey), now driven entirely by the shared kit.
 *
 * Verify: ./tools/rjit shot brush_3d_demo --out /tmp/brush3d.png  (drag to paint live)
 */

import { Box, Col, Row, Text, Pressable, Scene3D, Paintable } from '@reactjit/runtime/primitives';
import { usePaintable } from '@reactjit/runtime/hooks/usePaintable';
import {
  BrushKit, useBrushStroke,
  DEFAULT_BRUSH, defaultPalette, BRUSH_SHAPE_ID, hexToRgb01,
  DARK_THEME, type Brush, type BrushTool, type Palette,
} from '@reactjit/runtime/paint';
import { orbitalEyeJS, type CameraSnap } from './hmsc-int/editors/model/meshSelect';
import { screenRay } from './hmsc-int/editors/model/meshPaint';
import { useEffect, useRef, useState } from 'react';

const TEX = 1024;
const SIZE = 600;            // viewport px (square)
const W = 4, D = 4;          // plane size, world units
const HW = W / 2, HD = D / 2;
const FOV = 45, PITCH = 52, DIST = 7;
const PAPER_RGB: [number, number, number] = [0.933, 0.945, 0.965];
const T = DARK_THEME;
const Plane = (require('@reactjit/geometries') as any).Plane;

function camAt(yawDeg: number): CameraSnap {
  return { eye: orbitalEyeJS([0, 0, 0], yawDeg, PITCH, DIST), target: [0, 0, 0], fov: FOV, aspect: 1, w: SIZE, h: SIZE, near: 0.02 };
}

export default function Brush3DDemo() {
  const canvas = usePaintable({ id: 'brush-3d', w: TEX, h: TEX });
  const [brush, setBrush] = useState<Brush>({ ...DEFAULT_BRUSH, ink: { kind: 'color', hex: '#3da9ff' } });
  const [tool, setTool] = useState<BrushTool>('brush');
  const [palette, setPalette] = useState<Palette>(() => defaultPalette());
  const [yaw, setYaw] = useState(28);
  const rectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const yawRef = useRef(yaw); yawRef.current = yaw;
  const drawingRef = useRef(false);

  useEffect(() => {
    canvas.paint.clearColor(PAPER_RGB[0], PAPER_RGB[1], PAPER_RGB[2], 1);
    paintSampler(canvas.paint);
  }, []);

  // Auto-orbit — frozen while a stroke is down so mapPoint sees a stable camera.
  useEffect(() => {
    const id = setInterval(() => { if (!drawingRef.current) setYaw((y) => (y + 0.5) % 360); }, 33);
    return () => clearInterval(id);
  }, []);

  // The 3D map: screen pixel → ray → hit the plane (y=0) → UV (matching the
  // Plane geometry's corner UVs) → texture pixels. Returns null off-surface.
  const mapPoint = (screenX: number, screenY: number) => {
    const r = rectRef.current;
    if (!r) return null;
    const cam = camAt(yawRef.current);
    const { o, d } = screenRay(cam, screenX - r.x, screenY - r.y);
    if (Math.abs(d[1]) < 1e-6) return null;
    const t = -o[1] / d[1];
    if (t <= 0) return null;
    const hx = o[0] + d[0] * t;
    const hz = o[2] + d[2] * t;
    const u = (hx + HW) / W;          // x:-HW..HW → 0..1
    const v = (HD - hz) / D;          // z:-HD..HD → 1..0 (face UV winding)
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    return { x: u * TEX, y: v * TEX };
  };

  const { handlers } = useBrushStroke({
    paint: canvas.paint,
    texW: TEX, texH: TEX,
    brush, tool, mapPoint,
    eraseColor: '#eef1f6',
    onPickColor: (hex) => setBrush((b) => ({ ...b, ink: { kind: 'color', hex } })),
  });

  const cam = camAt(yaw);
  const reset = () => canvas.paint.clearColor(PAPER_RGB[0], PAPER_RGB[1], PAPER_RGB[2], 1);

  return (
    <Row style={{ width: '100%', height: '100%', backgroundColor: T.page }}>
      <Col style={{ padding: 14, gap: 12 }}>
        <Text style={{ color: T.ink, fontSize: 14, fontWeight: '900' }}>Brush Studio — 3D</Text>
        <Text style={{ color: T.dim, fontSize: 10 }}>same kit, painting ON a 3D surface · raycast→UV · it orbits, then freezes while you paint</Text>
        <BrushKit brush={brush} onBrushChange={setBrush} tool={tool} onToolChange={setTool} palette={palette} onPaletteChange={setPalette} theme={T} />
        <Pressable onMouseDown={reset} style={{ height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: T.control, borderWidth: 1, borderColor: T.frame }}>
          <Text style={{ color: T.dim, fontSize: 10, fontWeight: '800' }}>Clear surface</Text>
        </Pressable>
      </Col>

      <Box style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, alignItems: 'center', justifyContent: 'center', padding: 18 }}>
        <Box
          onLayout={(r: any) => { rectRef.current = r; }}
          style={{ width: SIZE, height: SIZE, position: 'relative', borderRadius: 10, overflow: 'hidden', backgroundColor: '#0c0f16', borderWidth: 1, borderColor: T.frame }}
        >
          <Paintable id={canvas.id} w={TEX} h={TEX} rgba />
          <Scene3D style={{ position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE }}>
            <Scene3D.Camera position={cam.eye} target={[0, 0, 0]} fov={FOV} />
            <Scene3D.AmbientLight color="#ffffff" intensity={0.7} />
            <Scene3D.DirectionalLight direction={[0.4, 1, 0.3]} color="#ffffff" intensity={0.6} />
            <Scene3D.Fog enabled={false} />
            <Scene3D.Mesh geometry={Plane} params={{ width: W, depth: D }} material={{ color: '#ffffff' }} textureKey={canvas.id} position={[0, 0, 0]} />
          </Scene3D>
          <Pressable
            style={{ position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE, backgroundColor: '#00000000' }}
            onMouseDown={(e: any) => { drawingRef.current = true; handlers.onMouseDown(e); }}
            onMouseMove={handlers.onMouseMove}
            onMouseUp={(e: any) => { handlers.onMouseUp(e); drawingRef.current = false; }}
            onMouseLeave={(e: any) => { handlers.onMouseLeave(e); drawingRef.current = false; }}
          />
        </Box>
      </Box>
    </Row>
  );
}

// Sample strokes on mount so the surface opens with content (and a headless
// shot shows real paint on the 3D plane). Pure host calls in texture space.
function paintSampler(paint: any) {
  const colors = ['#ff4d4d', '#ff9f43', '#34d399', '#3da9ff', '#7c5cff'];
  colors.forEach((hex, i) => {
    const [r, g, b] = hexToRgb01(hex);
    const y = 200 + i * 130;
    for (let x = 160; x <= 860; x += 8) {
      paint.brushColor(x, y + Math.sin(x * 0.02) * 30, 26, r, g, b, BRUSH_SHAPE_ID.round, 0, 1, 1, 0.95, 0, 0, 0, 0, 0, 0);
    }
  });
}
