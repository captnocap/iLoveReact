// editors/paint/ColorWheel.tsx - reusable HSV color wheel for paint chrome.

import { useEffect, useRef, useState } from 'react';
import { Box, Col, Effect, Pressable, Row, TextInput } from '@reactjit/primitives';
import { GAME_CHROME } from '../../game/chrome';
import { hexToHsv, hsvToHex, isFullHexColor, isHexColor, normalizeHexColor, type HsvColor } from './colors';

const T = GAME_CHROME.tokens.color;
const TAU = Math.PI * 2;

const COLOR_WHEEL = Object.freeze({
  size: 132,
  valueHeight: 16,
  marker: 10,
  valueMarker: 4,
  blackValueEpsilon: 0.001,
  wheelPickValueFromBlack: 1,
} as const);

type Rect = { x: number; y: number; width: number; height: number };
type DragTarget = 'wheel' | 'value';

const WHEEL_SHADER = `
const TAU: f32 = 6.28318530718;
@group(0) @binding(1) var<storage, read> P: array<f32>;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let p = (in.uv - vec2f(0.5, 0.5)) * 2.0;
  let r = length(p);
  let aa = max(fwidth(r), 0.001);
  let alpha = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
  if (alpha <= 0.001) { return vec4f(0.0); }
  let hue = fract(atan2(p.y, p.x) / TAU + 1.0);
  let rgb = hsv2rgb(hue, clamp(r, 0.0, 1.0), 1.0);
  return vec4f(rgb * alpha, alpha);
}
`;

const VALUE_SHADER = `
@group(0) @binding(1) var<storage, read> P: array<f32>;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let hue = P[0];
  let sat = P[1];
  let rgb = hsv2rgb(hue, sat, clamp(in.uv.x, 0.0, 1.0));
  return vec4f(rgb, 1.0);
}
`;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}

function pointerPoint(p: any): { x: number; y: number } | null {
  const x = Number(p?.x);
  const y = Number(p?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function hsvWithWheelPoint(hsv: HsvColor, p: any, rect: Rect): HsvColor {
  const point = pointerPoint(p);
  if (!point) return hsv;
  const x = point.x - rect.x;
  const y = point.y - rect.y;
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const dx = x - cx;
  const dy = y - cy;
  const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
  return {
    h: ((Math.atan2(dy, dx) / TAU) + 1) % 1,
    s: clamp01(Math.hypot(dx, dy) / radius),
    v: hsv.v <= COLOR_WHEEL.blackValueEpsilon ? COLOR_WHEEL.wheelPickValueFromBlack : hsv.v,
  };
}

function hsvWithValuePoint(hsv: HsvColor, p: any, rect: Rect): HsvColor {
  const point = pointerPoint(p);
  if (!point) return hsv;
  const x = point.x - rect.x;
  return { ...hsv, v: clamp01(x / Math.max(1, rect.width)) };
}

export function ColorWheel(props: {
  value: string;
  onChange: (hex: string) => void;
  size?: number;
  disabled?: boolean;
  showHex?: boolean;
  style?: Record<string, unknown>;
}) {
  const size = Math.max(80, props.size ?? COLOR_WHEEL.size);
  const value = normalizeHexColor(props.value);
  const hsv = hexToHsv(value);
  const displayHex = value.toUpperCase();
  const hsvRef = useRef(hsv);
  hsvRef.current = hsv;
  const [wheelRect, setWheelRect] = useState<Rect | null>(null);
  const [valueRect, setValueRect] = useState<Rect | null>(null);
  const [dragging, setDragging] = useState<DragTarget | null>(null);
  const [editingHex, setEditingHex] = useState(false);
  const [hexDraft, setHexDraft] = useState(displayHex);

  useEffect(() => {
    if (!editingHex) setHexDraft(displayHex);
  }, [displayHex, editingHex]);

  const commit = (next: HsvColor) => {
    if (!props.disabled) props.onChange(hsvToHex(next));
  };
  const commitHex = (draft: string, done = false) => {
    setEditingHex(true);
    setHexDraft(draft);
    if (isFullHexColor(draft) || (done && isHexColor(draft))) {
      const next = normalizeHexColor(draft);
      props.onChange(next);
      if (done) {
        setHexDraft(next.toUpperCase());
        setEditingHex(false);
      }
    } else if (done) {
      setHexDraft(displayHex);
      setEditingHex(false);
    }
  };
  const commitWheel = (p: any) => { if (wheelRect) commit(hsvWithWheelPoint(hsvRef.current, p, wheelRect)); };
  const commitValue = (p: any) => { if (valueRect) commit(hsvWithValuePoint(hsvRef.current, p, valueRect)); };
  const commitDrag = (p: any) => {
    if (dragging === 'wheel') commitWheel(p);
    else if (dragging === 'value') commitValue(p);
  };

  const radius = size / 2;
  const marker = COLOR_WHEEL.marker;
  const markerX = radius + Math.cos(hsv.h * TAU) * hsv.s * radius - marker / 2;
  const markerY = radius + Math.sin(hsv.h * TAU) * hsv.s * radius - marker / 2;
  const valueX = Math.round(hsv.v * size) - COLOR_WHEEL.valueMarker / 2;

  return (
    <Col style={{ gap: 5, alignItems: 'center', position: 'relative', opacity: props.disabled ? 0.45 : 1, ...(props.style ?? {}) }}>
      <Box style={{ width: size, height: size, position: 'relative' }}>
        <Pressable
          tooltip="Color wheel"
          onMouseDown={(p: any) => { setDragging('wheel'); commitWheel(p); }}
        >
          <Box
            onLayout={(r: any) => setWheelRect(r)}
            style={{
              width: size, height: size, borderRadius: radius, overflow: 'hidden',
              position: 'relative', backgroundColor: T.page,
              borderWidth: 1, borderColor: T.frame,
            }}
          >
            <Effect shader={WHEEL_SHADER} data={[hsv.v]} style={{ position: 'absolute', left: 0, top: 0, width: size, height: size }} />
            <Box style={{
              position: 'absolute', left: markerX, top: markerY,
              width: marker, height: marker, borderRadius: marker / 2,
              borderWidth: 2, borderColor: '#ffffff', backgroundColor: '#00000001',
            }} />
          </Box>
        </Pressable>
      </Box>

      <Box style={{ width: size, height: COLOR_WHEEL.valueHeight, position: 'relative' }}>
        <Pressable
          tooltip="Value"
          onMouseDown={(p: any) => { setDragging('value'); commitValue(p); }}
        >
          <Box
            onLayout={(r: any) => setValueRect(r)}
            style={{
              width: size, height: COLOR_WHEEL.valueHeight, borderRadius: 4,
              overflow: 'hidden', position: 'relative',
              borderWidth: 1, borderColor: T.frame, backgroundColor: T.page,
            }}
          >
            <Effect shader={VALUE_SHADER} data={[hsv.h, hsv.s]} style={{ position: 'absolute', left: 0, top: 0, width: size, height: COLOR_WHEEL.valueHeight }} />
            <Box style={{
              position: 'absolute', left: valueX, top: -1,
              width: COLOR_WHEEL.valueMarker, height: COLOR_WHEEL.valueHeight + 2,
              borderRadius: 2, backgroundColor: '#ffffff',
              borderWidth: 1, borderColor: '#0b1018',
            }} />
          </Box>
        </Pressable>
      </Box>

      {dragging ? (
        <Pressable
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 30, backgroundColor: '#00000001' }}
          onMouseMove={commitDrag}
          onMouseUp={(p: any) => { commitDrag(p); setDragging(null); }}
          onMouseLeave={() => setDragging(null)}
        />
      ) : null}

      {props.showHex === false ? null : (
        <Row style={{ width: size, gap: 6, alignItems: 'center' }}>
          <Box style={{ width: 18, height: 14, borderRadius: 3, backgroundColor: value, borderWidth: 1, borderColor: T.frame }} />
          <TextInput
            value={hexDraft}
            onMouseDown={() => setEditingHex(true)}
            onChangeText={(v: string) => commitHex(v)}
            onSubmit={() => commitHex(hexDraft, true)}
            onSubmitEditing={() => commitHex(hexDraft, true)}
            placeholder="#RRGGBB"
            style={{
              flexGrow: 1, height: 22, fontSize: 10, fontWeight: '800',
              color: isHexColor(hexDraft) ? T.ink : T.bad,
              backgroundColor: T.control,
              borderWidth: 1, borderColor: isHexColor(hexDraft) ? T.frame : T.bad,
              borderRadius: 4, paddingHorizontal: 6,
            }}
          />
        </Row>
      )}
    </Col>
  );
}
