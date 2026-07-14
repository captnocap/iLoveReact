// stage/FacadePainterSurface.tsx — the graffiti facade painter (req_3057).
//
// One coplanar wall run, flat, meter-true, at the RULED 256 px/m. Two tools:
//   SPRAY — host GPU dabs (usePaintable brushColor, spray shape) recorded as
//           stroke rows in facade meters, deterministically replayable (the
//           paint-program ruling: the rows are the durable form, this canvas
//           is the bake).
//   STAMP — the action bar's armed sticker drops as a stamp row; stamps stay
//           overlays here (rows, never rasterized into the stroke canvas) and
//           composite at bake, so program order is stack order.
// SAVE bakes: stroke readback + stamps → cached PNG → the quad goes live on
// the wall (facadeBake).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Row, Col, Text, Pressable, Effect, Paintable } from '../../../runtime/primitives';
import { usePaintable } from '../../../runtime/hooks/usePaintable';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { hexToRgb01 } from '../../../runtime/paint/colors';
import { jitterSeed } from '../../../runtime/paint/stamp';
import { BRUSH_SHAPE_ID } from '../../../runtime/paint/model';
import { facadeCanvasSize, FACADE_TEXELS_PER_METER, type Facade, type FacadeStamp, type FacadeStroke } from '../world/facades';
import { rotatePackedTexture } from '../textures/pixelTexture';
import { stickerById, ensureStickerForTexture } from '../data/stickerStore';
import { shaderSpec } from '../textures/shaders';
import type { EditorState } from '../data/types';

// Spray tuning — constants ARE the replay contract: a stroke row stores only
// hex + radius + path, so these never drift per stroke.
const SPRAY = { kind: BRUSH_SHAPE_ID.spray, angle: 0, aspect: 1, hardness: 0.55, flow: 0.85, scatter: 1.1 };
const SPRAY_COLORS = ['#e8352a', '#ff9f1c', '#ffd23f', '#3fd069', '#2ab7ff', '#b06cf4', '#f5f0e6', '#17171b'];
const SPRAY_RADII_M = [0.02, 0.05, 0.1, 0.2];

const DISPLAY = `
@group(0) @binding(2) var tex: texture_2d<f32>;
@group(0) @binding(3) var smp: sampler;
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = textureSampleLevel(tex, smp, in.uv, 0.0);
  // Checker under the paint so transparency reads as "bare wall".
  let cell = (floor(in.uv.x * 64.0) + floor(in.uv.y * 32.0)) % 2.0;
  let wall = mix(vec3f(0.16, 0.16, 0.18), vec3f(0.20, 0.20, 0.23), cell);
  return vec4f(mix(wall, c.rgb, c.a), 1.0);
}
`;

/** Replay one stroke's dabs — the SAME calls the live drag makes, so the bake
 *  after a reload is texel-identical to the session that authored it. */
function replayStroke(paint: ReturnType<typeof usePaintable>['paint'], stroke: FacadeStroke, heightM: number): void {
  const [r, g, b] = hexToRgb01(stroke.hex);
  const radiusPx = stroke.radiusMeters * FACADE_TEXELS_PER_METER;
  for (let i = 0; i + 1 < stroke.points.length; i += 2) {
    const x = stroke.points[i]! * FACADE_TEXELS_PER_METER;
    const y = (heightM - stroke.points[i + 1]!) * FACADE_TEXELS_PER_METER;
    paint.brushColor(x, y, radiusPx, r, g, b, SPRAY.kind, SPRAY.angle, SPRAY.aspect, SPRAY.hardness, SPRAY.flow, SPRAY.scatter, jitterSeed(x, y), 0, 0, 0, 0);
  }
}

export default function FacadePainterSurface(props: {
  facade: Facade;
  stickerArm: EditorState['stickerArm'];
  onStroke: (facadeId: string, stroke: FacadeStroke) => void;
  onStamp: (facadeId: string, stamp: FacadeStamp) => void;
  onClear: (facadeId: string) => void;
  onSave: (facadeId: string, strokesRgba: Uint8Array) => void;
}) {
  const f = props.facade;
  const size = useMemo(() => facadeCanvasSize(f), [f.id, f.widthMeters, f.heightMeters]);
  const canvas = usePaintable({ id: `facade-${f.id}`, w: size.w, h: size.h });
  const [tool, setTool] = useState<'spray' | 'stamp'>('spray');
  const [hex, setHex] = useState(SPRAY_COLORS[0]!);
  const [radiusM, setRadiusM] = useState(SPRAY_RADII_M[1]!);
  const rectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const strokeRef = useRef<number[] | null>(null);
  const replayedRef = useRef<string | null>(null);

  // Replay the stored program into the canvas once per facade (strokes only —
  // stamps stay rows and composite at bake).
  useEffect(() => {
    if (replayedRef.current === f.id) return;
    replayedRef.current = f.id;
    canvas.paint.clearColor(0, 0, 0, 0);
    for (const stroke of f.strokes) replayStroke(canvas.paint, stroke, f.heightMeters);
  }, [f.id]);

  // Screen → facade meters (u across, v UP).
  const toMeters = (sx: number, sy: number): { u: number; v: number } | null => {
    const r = rectRef.current;
    if (!r || r.width < 1) return null;
    const u = ((sx - r.x) / r.width) * f.widthMeters;
    const v = f.heightMeters - ((sy - r.y) / r.height) * f.heightMeters;
    if (u < 0 || u > f.widthMeters || v < 0 || v > f.heightMeters) return null;
    return { u, v };
  };

  const dabAt = (u: number, v: number) => {
    const [r, g, b] = hexToRgb01(hex);
    const x = u * FACADE_TEXELS_PER_METER;
    const y = (f.heightMeters - v) * FACADE_TEXELS_PER_METER;
    canvas.paint.brushColor(x, y, radiusM * FACADE_TEXELS_PER_METER, r, g, b, SPRAY.kind, SPRAY.angle, SPRAY.aspect, SPRAY.hardness, SPRAY.flow, SPRAY.scatter, jitterSeed(x, y), 0, 0, 0, 0);
  };

  const onDown = (e: any) => {
    const p = toMeters(e.x, e.y);
    if (!p) return;
    if (tool === 'stamp') {
      const textureId = props.stickerArm.textureId;
      const spec = textureId ? shaderSpec(textureId) : undefined;
      const sticker = textureId && spec ? ensureStickerForTexture(textureId, spec.label) : null;
      if (!sticker) return; // the header row explains: arm a sticker first
      props.onStamp(f.id, { stickerId: sticker.id, u: p.u, v: p.v, scale: props.stickerArm.scale, rotDegrees: props.stickerArm.rot * 90 });
      return;
    }
    strokeRef.current = [p.u, p.v];
    dabAt(p.u, p.v);
  };
  const onMove = (e: any) => {
    const path = strokeRef.current;
    if (!path) return;
    const p = toMeters(e.x, e.y);
    if (!p) return;
    const lastU = path[path.length - 2]!;
    const lastV = path[path.length - 1]!;
    // Dab spacing at half the radius keeps strokes continuous AND the row small.
    if (Math.hypot(p.u - lastU, p.v - lastV) < radiusM / 2) return;
    path.push(p.u, p.v);
    dabAt(p.u, p.v);
  };
  const onUp = () => {
    const path = strokeRef.current;
    strokeRef.current = null;
    if (path && path.length >= 2) props.onStroke(f.id, { hex, radiusMeters: radiusM, points: path });
  };

  // Fit the canvas into the pane, meter-true aspect.
  const PANE_W = 980;
  const PANE_H = 560;
  const scale = Math.min(PANE_W / size.w, PANE_H / size.h);
  const viewW = Math.max(64, Math.floor(size.w * scale));
  const viewH = Math.max(64, Math.floor(size.h * scale));
  const pxPerMeter = viewW / f.widthMeters;

  const stampPreviews = f.stamps.map((stamp, i) => {
    const sticker = stickerById(stamp.stickerId);
    const spec = sticker ? shaderSpec(sticker.textureId) : undefined;
    if (!sticker || !spec) return null;
    const w = sticker.widthMeters * stamp.scale * pxPerMeter;
    const h = sticker.heightMeters * stamp.scale * pxPerMeter;
    const swapped = Math.round(stamp.rotDegrees / 90) % 2 === 1;
    const data = rotatePackedTexture(spec.buildData(), Math.round(stamp.rotDegrees / 90));
    return (
      <Effect
        key={`stamp-${i}`}
        shader={spec.shader}
        data={data}
        style={{
          position: 'absolute',
          left: stamp.u * pxPerMeter - (swapped ? h : w) / 2,
          top: (f.heightMeters - stamp.v) * pxPerMeter - (swapped ? w : h) / 2,
          width: swapped ? h : w,
          height: swapped ? w : h,
        }}
      />
    );
  });

  return (
    <Col style={{ width: '100%', height: '100%', padding: 12, gap: 10 }}>
      <Row style={{ alignItems: 'center', gap: 10 }}>
        <Icon name="SprayCan" size={14} color={accentFor('primary')} />
        <Text style={{ color: accentFor('text'), fontSize: 12, fontWeight: '700' }}>
          {`${f.widthMeters.toFixed(1)}×${f.heightMeters.toFixed(1)}m · ${size.w}×${size.h} px · ${f.pieceIds.length} piece(s)`}
        </Text>
        <Box style={{ flexGrow: 1 }} />
        {tool === 'stamp' && !props.stickerArm.textureId ? (
          <Text style={{ color: accentFor('textDim'), fontSize: 10 }}>arm a sticker in the action bar (K) to stamp</Text>
        ) : null}
        <C.HW_IconButton tooltip="Clear every stroke and stamp on this facade" onPress={() => { canvas.paint.clearColor(0, 0, 0, 0); props.onClear(f.id); }}>
          <Icon name="Trash2" size={13} color={accentFor('textDim')} />
        </C.HW_IconButton>
        <C.HW_PillOn tooltip="Bake this facade onto its wall" onPress={() => { const rgba = canvas.paint.readback(); if (rgba) props.onSave(f.id, rgba); }}>
          <C.HW_PillTextOn>SAVE</C.HW_PillTextOn>
        </C.HW_PillOn>
      </Row>
      <Row style={{ alignItems: 'center', gap: 6 }}>
        {(['spray', 'stamp'] as const).map((t) => {
          const Btn = tool === t ? C.HW_IconButtonOn : C.HW_IconButton;
          return (
            <Btn key={t} tooltip={t === 'spray' ? 'Spray (drag)' : 'Stamp the armed sticker (click)'} onPress={() => setTool(t)}>
              <Icon name={t === 'spray' ? 'SprayCan' : 'Sticker'} size={13} color={accentFor(tool === t ? 'primary' : 'textDim')} />
            </Btn>
          );
        })}
        <C.HW_OptionDivider />
        {SPRAY_COLORS.map((c) => (
          <Pressable
            key={c}
            onPress={() => setHex(c)}
            style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c, borderWidth: hex === c ? 2 : 0, borderColor: '#ffffff' }}
          />
        ))}
        <C.HW_OptionDivider />
        {SPRAY_RADII_M.map((r) => {
          const Btn = radiusM === r ? C.HW_PillOn : C.HW_Pill;
          const Txt = radiusM === r ? C.HW_PillTextOn : C.HW_PillText;
          return (
            <Btn key={r} tooltip={`Spray radius — ${Math.round(r * 100)}cm on the wall`} onPress={() => setRadiusM(r)}>
              <Txt>{`${Math.round(r * 100)}cm`}</Txt>
            </Btn>
          );
        })}
      </Row>
      <Box style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Pressable
          style={{ width: viewW, height: viewH, position: 'relative' }}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onUp}
          onLayout={(r: any) => { rectRef.current = { x: r.x, y: r.y, width: r.width, height: r.height }; }}
        >
          <Paintable id={canvas.id} w={size.w} h={size.h} rgba />
          <Effect shader={DISPLAY} textures={[canvas.id]} style={{ position: 'absolute', left: 0, top: 0, width: viewW, height: viewH }} />
          {stampPreviews}
        </Pressable>
      </Box>
    </Col>
  );
}
