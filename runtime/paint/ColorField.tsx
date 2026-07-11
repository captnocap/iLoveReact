// runtime/paint/ColorField.tsx — the universal HSV color picker: wheel +
// value bar + hex entry. Generalized from hmsc-int's ColorWheel and decoupled
// from GAME_CHROME so color picking is identical in every cart and tool
// (USER ASK req_1447 — "some places have a color wheel, some don't").

import { useEffect, useRef, useState } from 'react';
import { Box, Col, Effect, Pressable, Row, TextInput } from '../primitives';
import { type PaintTheme, DARK_THEME } from './theme';
import { hexToHsv, hsvToHex, isFullHexColor, isHexColor, normalizeHexColor, type HsvColor } from './colors';

const TAU = Math.PI * 2;

// The framework auto-prepends Uniforms/VsOut/vs_main + effect_math.wgsl
// (hsv2rgb etc). Surfaces declare only their bindings + fs_main.
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

type Rect = { x: number; y: number; width: number; height: number };
type DragTarget = 'wheel' | 'value';

function clamp01(n: number): number { return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0)); }

function hsvFromWheel(hsv: HsvColor, p: any, rect: Rect): HsvColor {
  const x = Number(p?.x) - rect.x;
  const y = Number(p?.y) - rect.y;
  const dx = x - rect.width / 2;
  const dy = y - rect.height / 2;
  const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
  return {
    h: ((Math.atan2(dy, dx) / TAU) + 1) % 1,
    s: clamp01(Math.hypot(dx, dy) / radius),
    v: hsv.v <= 0.001 ? 1 : hsv.v,
  };
}

function hsvFromValue(hsv: HsvColor, p: any, rect: Rect): HsvColor {
  return { ...hsv, v: clamp01((Number(p?.x) - rect.x) / Math.max(1, rect.width)) };
}

export interface HexColorInputProps {
  value: string;
  onChange?: (hex: string) => void;
  onCommit?: (hex: string) => void;
  showSwatch?: boolean;
  width?: number | string;
  theme?: PaintTheme;
  style?: Record<string, unknown>;
}

/** The paint kit's one editable hex control. Full six-digit values apply as
 *  soon as they are valid; Enter also accepts three-digit shorthand. */
export function HexColorInput(props: HexColorInputProps) {
  const T = props.theme ?? DARK_THEME;
  const value = normalizeHexColor(props.value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value.toUpperCase());
  useEffect(() => { if (!editing) setDraft(value.toUpperCase()); }, [value, editing]);
  const editingRef = useRef(false);
  const dirtyRef = useRef(false);
  const lastLiveHexRef = useRef<string | null>(null);

  const beginEditing = () => {
    if (editingRef.current) return;
    editingRef.current = true;
    dirtyRef.current = false;
    lastLiveHexRef.current = null;
    setEditing(true);
  };

  const updateDraft = (nextDraft: string) => {
    beginEditing();
    dirtyRef.current = true;
    setDraft(nextDraft);
    if (isFullHexColor(nextDraft)) {
      const next = normalizeHexColor(nextDraft);
      if (props.onChange && next !== value && next !== lastLiveHexRef.current) {
        lastLiveHexRef.current = next;
        props.onChange(next);
      }
    }
  };

  const finishEditing = () => {
    // The host may emit submit, submitEditing, and then blur for one Enter.
    // Close the editing session once so commits/history never triple-fire.
    if (!editingRef.current) return;
    editingRef.current = false;
    const changed = dirtyRef.current;
    dirtyRef.current = false;
    setEditing(false);

    if (isHexColor(draft)) {
      const next = normalizeHexColor(draft);
      if (props.onChange && next !== value && next !== lastLiveHexRef.current) props.onChange(next);
      setDraft(next.toUpperCase());
      if (changed) props.onCommit?.(next);
      return;
    }
    setDraft(value.toUpperCase());
  };

  return (
    <Row style={{ width: props.width ?? '100%', gap: 6, alignItems: 'center', ...(props.style ?? {}) }}>
      {props.showSwatch === false ? null : (
        <Box style={{ width: 18, height: 14, borderRadius: 3, backgroundColor: value, borderWidth: 1, borderColor: T.frame }} />
      )}
      <TextInput
        value={draft}
        onMouseDown={beginEditing}
        onChangeText={updateDraft}
        onSubmit={finishEditing}
        onSubmitEditing={finishEditing}
        onBlur={finishEditing}
        placeholder="#RRGGBB"
        style={{
          flexGrow: 1,
          minWidth: 0,
          height: 22,
          fontSize: 10,
          fontWeight: '800',
          color: isHexColor(draft) ? T.ink : T.bad,
          backgroundColor: T.control,
          borderWidth: 1,
          borderColor: isHexColor(draft) ? T.frame : T.bad,
          borderRadius: 4,
          paddingHorizontal: 6,
        }}
      />
    </Row>
  );
}

export interface ColorFieldProps {
  value: string;
  onChange: (hex: string) => void;
  /** Fired when a colour is SETTLED ON — pointer-up after a wheel/value drag (or
   *  a single click), and on hex-entry submit. `onChange` fires continuously while
   *  dragging (for live preview); `onCommit` fires once, at the end. Use this to
   *  record a "recent" so dragging the value slider doesn't flood the recents ring
   *  with every intermediate step (req_1729). Falls back to onChange behaviour if
   *  omitted. */
  onCommit?: (hex: string) => void;
  size?: number;
  showHex?: boolean;
  theme?: PaintTheme;
  style?: Record<string, unknown>;
}

export function ColorField(props: ColorFieldProps) {
  const T = props.theme ?? DARK_THEME;
  const size = Math.max(80, props.size ?? 132);
  const valueHeight = 16;
  const marker = 10;
  const value = normalizeHexColor(props.value);
  const hsv = hexToHsv(value);
  const hsvRef = useRef(hsv);
  hsvRef.current = hsv;

  const [wheelRect, setWheelRect] = useState<Rect | null>(null);
  const [valueRect, setValueRect] = useState<Rect | null>(null);
  // Drag is tracked in a REF, not state, and handled on the wheel/value
  // Pressables themselves — no global drag overlay. The old overlay mounted
  // only `when dragging`, so a no-move CLICK (down+up before it mounted) left
  // `dragging` stuck true and the leftover overlay ate the next click — the
  // long-standing "click a color, can't pick another until you leave & return"
  // bug. Per-element handlers can't get stuck (req_1455).
  const dragRef = useRef<DragTarget | null>(null);

  const commit = (next: HsvColor) => props.onChange(hsvToHex(next));
  const commitWheel = (p: any) => { if (wheelRect) commit(hsvFromWheel(hsvRef.current, p, wheelRect)); };
  const commitValue = (p: any) => { if (valueRect) commit(hsvFromValue(hsvRef.current, p, valueRect)); };
  const startDrag = (t: DragTarget, p: any) => { dragRef.current = t; if (t === 'wheel') commitWheel(p); else commitValue(p); };
  const moveDrag = (t: DragTarget, p: any) => { if (dragRef.current !== t) return; if (t === 'wheel') commitWheel(p); else commitValue(p); };
  // Pointer-up (or leave) ends the drag and COMMITS the settled colour once — the
  // recents ring records the colour you landed on, not every value-slider step.
  const endDrag = () => { if (dragRef.current) props.onCommit?.(hsvToHex(hsvRef.current)); dragRef.current = null; };

  const radius = size / 2;
  const markerX = radius + Math.cos(hsv.h * TAU) * hsv.s * radius - marker / 2;
  const markerY = radius + Math.sin(hsv.h * TAU) * hsv.s * radius - marker / 2;
  const valueX = Math.round(hsv.v * size) - 2;

  return (
    <Col style={{ gap: 5, alignItems: 'center', position: 'relative', ...(props.style ?? {}) }}>
      <Box style={{ width: size, height: size, position: 'relative' }}>
        <Pressable
          tooltip="Hue / saturation"
          onMouseDown={(p: any) => startDrag('wheel', p)}
          onMouseMove={(p: any) => moveDrag('wheel', p)}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
        >
          <Box
            onLayout={(r: any) => setWheelRect(r)}
            style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', position: 'relative', backgroundColor: T.page, borderWidth: 1, borderColor: T.frame }}
          >
            <Effect shader={WHEEL_SHADER} data={[hsv.v]} style={{ position: 'absolute', left: 0, top: 0, width: size, height: size }} />
            <Box style={{ position: 'absolute', left: markerX, top: markerY, width: marker, height: marker, borderRadius: marker / 2, borderWidth: 2, borderColor: '#ffffff', backgroundColor: '#00000001' }} />
          </Box>
        </Pressable>
      </Box>

      <Box style={{ width: size, height: valueHeight, position: 'relative' }}>
        <Pressable
          tooltip="Value"
          onMouseDown={(p: any) => startDrag('value', p)}
          onMouseMove={(p: any) => moveDrag('value', p)}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
        >
          <Box
            onLayout={(r: any) => setValueRect(r)}
            style={{ width: size, height: valueHeight, borderRadius: 4, overflow: 'hidden', position: 'relative', borderWidth: 1, borderColor: T.frame, backgroundColor: T.page }}
          >
            <Effect shader={VALUE_SHADER} data={[hsv.h, hsv.s]} style={{ position: 'absolute', left: 0, top: 0, width: size, height: valueHeight }} />
            <Box style={{ position: 'absolute', left: valueX, top: -1, width: 4, height: valueHeight + 2, borderRadius: 2, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#0b1018' }} />
          </Box>
        </Pressable>
      </Box>

      {props.showHex === false ? null : (
        <HexColorInput value={value} onChange={props.onChange} onCommit={props.onCommit} width={size} theme={T} />
      )}
    </Col>
  );
}
