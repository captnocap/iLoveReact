// editors/cutout/ToolRail.tsx — the reference app's left tool palette,
// ported faithfully (USER VERDICT CUTOUTQOL2-0605: "no icons on the tools,
// no brush size sliding bar"): square ICON tiles with tooltips for every
// tool and mask action, the Workbench/studio brush-size slider + px readout,
// and the live color slots + palette. Route
// chrome over the shared painter's state — the engine is consumed, never
// forked (PaintToolRail stays the generic chrome-kit for other embedders).
//
// Behavior reference: cart/cutout/components/Tools.tsx (icon tiles, modes,
// color slots) + cart/cutout/components/TopBar.tsx BrushSlider (read, never
// imported).

import { Box, Col, Pressable, Row, Text } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import { GAME_CHROME } from '@game';
import { WorkbenchSlider } from '../../shell/fields';
import { ColorWheel, PAINT, type PaintEditorState } from '../paint';
import type { PaintMode, PaintTool } from '../paint';

const T = GAME_CHROME.tokens.color;

// Rail chrome sizes (P2 — view tuning only; paint behavior numbers live in
// editors/paint/tuning.ts, which also owns brushSizes and the palette).
const RAIL = Object.freeze({
  width: 200,
  // 34: five tiles + 3px gaps ride ONE row inside the rail (the no-orphan
  // law) — 5×34 + 4×3 = 182 ≤ the rail's 184 inner width
  tile: 34,
  tileIcon: 17,
  slotW: 35,
  slotH: 42,
  swatch: 17,
} as const);

const TOOLS: { id: PaintTool; label: string; icon: string }[] = [
  { id: 'hand', label: 'Move (H) — drag to pan, wheel to zoom', icon: 'Hand' },
  { id: 'brush', label: 'Brush (B)', icon: 'Brush' },
  { id: 'refine', label: 'Refine brush (F) — edge-aware', icon: 'ScanLine' },
  { id: 'lasso', label: 'Lasso (L) — Enter closes, Esc cancels', icon: 'Spline' },
  { id: 'smart', label: 'Smart select (S)', icon: 'WandSparkles' },
];

// The two stroke modes, in the CANVAS's vocabulary (the user: "paint and
// remove are the same tool?" — no more). On a color canvas (blank, model,
// material) the additive stroke is PAINT and the subtractive one is the
// ERASER; on an image source (the cutout extraction flow) the same two
// bands mean REMOVE and KEEP. The DATA vocabulary stays the mask's
// ('erase'/'restore' bands — document compatibility); only the surface
// speaks paint.
function modesFor(hasImage: boolean): { id: PaintMode; label: string; icon: string; color: string }[] {
  return hasImage
    ? [
        { id: 'erase', label: 'Remove from image (B)', icon: 'Eraser', color: '#ff9f43' },
        { id: 'restore', label: 'Keep — undo removal (E)', icon: 'RotateCcw', color: '#34d399' },
      ]
    : [
        { id: 'erase', label: 'Paint (B)', icon: 'Paintbrush', color: '#ff9f43' },
        { id: 'restore', label: 'Eraser (E)', icon: 'Eraser', color: '#34d399' },
      ];
}

/** the keyboard map, visible (the engine binds these in usePaintEditor) */
const KEY_HINT = 'B paint · E eraser · H hand · L lasso · F refine · S smart · [ ] size · Ctrl+Z/Y undo/redo';

export function CutoutToolRail({ s }: { s: PaintEditorState }) {
  const target = s.activeLayer;
  const colors = target >= 0 && target < s.layers.length
    ? (s.layers[target].config.colors ?? s.defaults.colors)
    : s.defaults.colors;
  const safeSlot = Math.min(Math.max(s.activeColorSlot, 0), PAINT.NUM_COLOR_SLOTS - 1);
  const hasImage = !!s.srcPath;
  const modes = modesFor(hasImage);

  return (
    <Col style={{
      width: RAIL.width, padding: 8, gap: 9, alignItems: 'center',
      backgroundColor: T.panelSolid, borderRightWidth: 1, borderColor: T.frame,
    }}>
      <SectionLabel>TOOLS</SectionLabel>
      {/* SCULPTKIT-0606 chrome law (USER: "4 buttons wide and then the 5th
          one wrapping below. horrible approach"): a tile grid's width
          DIVIDES its set size — the 5 tools ride ONE row, never 4+1 */}
      <Row style={{ gap: 3, justifyContent: 'center' }}>
        {TOOLS.map((t) => {
          const disabled = t.id === 'smart' && !s.smartAvailable;
          return (
            <IconTile
              key={t.id}
              icon={t.icon}
              label={disabled ? 'Smart select — load an image source first' : t.label}
              active={s.tool === t.id}
              color={T.accent}
              disabled={disabled}
              onPress={() => s.setTool(t.id)}
            />
          );
        })}
      </Row>

      <RailDivider />
      <SectionLabel>{hasImage ? 'MASK' : 'MODE'}</SectionLabel>
      {/* 5 tiles, one row (the same divides-law); the transient lasso
          confirm is its own row below — never a wrap orphan */}
      <Row style={{ gap: 3, justifyContent: 'center' }}>
        {modes.map((m) => (
          <IconTile
            key={m.id}
            icon={m.icon}
            label={m.label}
            active={s.mode === m.id}
            color={m.color}
            onPress={() => s.setMode(m.id)}
          />
        ))}
        <IconTile icon="X" label={hasImage ? 'Clear layer mask' : 'Clear layer paint'} active={false} color={T.bad} onPress={s.clearMask} />
        <IconTile icon="RefreshCcw" label={hasImage ? 'Invert layer mask' : 'Invert layer paint'} active={false} color={T.accent} onPress={s.invertMask} />
        <IconTile icon="FlipHorizontal" label="Mirror painting across the vertical center" active={s.mirror} color="#22d3ee" onPress={() => s.setMirror(!s.mirror)} />
      </Row>
      {s.tool === 'lasso' && s.lassoPoints.length > 0 ? (
        <Row style={{ gap: 3, justifyContent: 'center' }}>
          <IconTile icon="Check" label={`Close lasso (${s.lassoPoints.length} points)`} active={false} color={T.good} onPress={s.commitLasso} />
        </Row>
      ) : null}

      <RailDivider />
      <SectionLabel>BRUSH</SectionLabel>
      <BrushSlider value={s.brushPx} onChange={s.setBrushPx} />

      {/* SCULPTKIT-0606 conditional-section law (USER: "you just
          conditionally render this instead of all the time"): COLOR shows
          only when the active mode CONSUMES color — the paint band on a
          color canvas; mask work on an image source never reads it */}
      {!hasImage && s.mode === 'erase' ? (
        <>
          <RailDivider />
          <SectionLabel>COLOR</SectionLabel>
          <Row style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            {PAINT.SLOT_LABELS.slice(0, PAINT.NUM_COLOR_SLOTS).map((label, i) => (
              <ColorSlot
                key={label}
                label={label.slice(0, 1).toUpperCase()}
                tooltip={`${label} color slot`}
                color={colors[i] ?? '#ffffff'}
                active={safeSlot === i}
                onPress={() => s.setActiveColorSlot(i)}
              />
            ))}
          </Row>
          <ColorWheel
            value={colors[safeSlot] ?? '#ffffff'}
            onChange={(hex) => s.setLayerColor(target, safeSlot, hex)}
            size={150}
            showHex
          />
          <Row style={{ gap: 5, flexWrap: 'wrap', width: RAIL.width - 30, justifyContent: 'center' }}>
            {PAINT.tuning.palette.map((hex) => (
              <Pressable key={hex} onPress={() => s.setLayerColor(target, safeSlot, hex)} tooltip={hex}>
                <Box style={{
                  width: RAIL.swatch, height: RAIL.swatch, borderRadius: 4, backgroundColor: hex,
                  borderWidth: colors[safeSlot] === hex ? 2 : 1,
                  borderColor: colors[safeSlot] === hex ? T.accent : (hex === '#ffffff' ? T.dim : T.frame),
                }} />
              </Pressable>
            ))}
          </Row>
        </>
      ) : null}
      <Box style={{ flexGrow: 1 }} />
      {/* the keyboard map, visible at the rail's foot */}
      <Text style={{ color: T.dim, fontSize: 8, fontFamily: 'monospace', textAlign: 'center', width: RAIL.width - 16 }}>
        {KEY_HINT}
      </Text>
    </Col>
  );
}

// ── the brush-size slider (the reference TopBar interaction) ─────────────────
// The paint ladder over the Workbench/studio slider: log-mapped track (strokes.ts
// brushTrackToPx — the low end is fine-grained for tattoo lines), the
// brushSizes ladder as ticks, [/] stepping the ladder.

export function BrushSlider({ value, onChange }: { value: number; onChange: (px: number) => void }) {
  const sizes = PAINT.tuning.brushSizes;
  return (
    <WorkbenchSlider
      value={value}
      min={sizes[0]}
      max={sizes[sizes.length - 1]}
      show={(v) => `${v}px`}
      onChange={onChange}
      toTrack={(v) => PAINT.brushPxToTrack(v)}
      fromTrack={(t) => PAINT.brushTrackToPx(t)}
      tooltip={`${value}px brush — drag the studio slider, or [ and ] to step`}
    />
  );
}

/** Linear adapter for sculpt ranges. The chrome is the Workbench/studio slider;
 *  this wrapper only applies range quantization for old call sites. */
export function LinearRailSlider(props: {
  value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  tooltip?: string;
}) {
  const { min, max, step } = props;
  const quant = (v: number) => {
    const snapped = Math.round((v - min) / step) * step + min;
    const fixed = Number(snapped.toFixed(4));
    return Math.max(min, Math.min(max, fixed));
  };
  const fmt = props.format ?? ((v: number) => String(v));
  return (
    <WorkbenchSlider
      value={props.value}
      min={min}
      max={max}
      show={fmt}
      onChange={(v) => props.onChange(quant(v))}
      toTrack={(v) => (v - min) / (max - min)}
      fromTrack={(t) => quant(min + t * (max - min))}
      tooltip={props.tooltip}
    />
  );
}

// ── pieces (SCULPTKIT-0606: exported — the sculpt rail speaks THIS language;
// a second tile/label/divider implementation is a rejection) ─────────────────

export function SectionLabel({ children }: { children: string }) {
  return (
    <Text style={{ color: T.dim, fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>{children}</Text>
  );
}

export function RailDivider() {
  return <Box style={{ width: RAIL.width - 40, height: 1, backgroundColor: T.frame }} />;
}

export function IconTile(props: {
  icon: string;
  label: string;
  active: boolean;
  color: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const fg = props.active ? '#0b1018' : T.dim;
  return (
    <Pressable onPress={() => { if (!props.disabled) props.onPress(); }} tooltip={props.label}>
      <Box style={{
        width: RAIL.tile, height: RAIL.tile, borderRadius: 6,
        backgroundColor: props.active ? props.color : T.control,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: props.active ? props.color : T.frame,
        opacity: props.disabled ? 0.35 : 1,
      }}>
        <Icon name={props.icon} size={RAIL.tileIcon} color={fg} strokeWidth={2} />
      </Box>
    </Pressable>
  );
}

function ColorSlot(props: {
  label: string;
  tooltip: string;
  color: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={props.onPress} tooltip={props.tooltip}>
      <Col style={{
        width: RAIL.slotW, height: RAIL.slotH, borderRadius: 6,
        backgroundColor: T.control, borderWidth: 1,
        borderColor: props.active ? T.accent : T.frame,
        alignItems: 'center', justifyContent: 'center', gap: 4,
      }}>
        <Box style={{
          width: 23, height: 18, borderRadius: 4, backgroundColor: props.color,
          borderWidth: 1, borderColor: props.color === '#ffffff' ? T.dim : props.color,
        }} />
        <Text style={{ color: props.active ? T.accent : T.dim, fontSize: 9, fontWeight: '800' }}>{props.label}</Text>
      </Col>
    </Pressable>
  );
}
