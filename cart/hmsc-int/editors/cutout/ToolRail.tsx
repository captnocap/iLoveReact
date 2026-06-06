// editors/cutout/ToolRail.tsx — the reference app's left tool palette,
// ported faithfully (USER VERDICT CUTOUTQOL2-0605: "no icons on the tools,
// no brush size sliding bar"): square ICON tiles with tooltips for every
// tool and mask action, the draggable brush-size slider with detents +
// nudge buttons + px readout, and the live color slots + palette. Route
// chrome over the shared painter's state — the engine is consumed, never
// forked (PaintToolRail stays the generic chrome-kit for other embedders).
//
// Behavior reference: cart/cutout/components/Tools.tsx (icon tiles, modes,
// color slots) + cart/cutout/components/TopBar.tsx BrushSlider (read, never
// imported).

import { useState } from 'react';
import { Box, Col, Pressable, Row, Text } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import { GAME_CHROME } from '@game';
import { ColorWheel, PAINT, type PaintEditorState } from '../paint';
import type { PaintMode, PaintTool } from '../paint';

const T = GAME_CHROME.tokens.color;

// Rail chrome sizes (P2 — view tuning only; paint behavior numbers live in
// editors/paint/tuning.ts, which also owns brushSizes and the palette).
const RAIL = Object.freeze({
  width: 200,
  tile: 35,
  tileIcon: 17,
  slotW: 35,
  slotH: 42,
  swatch: 17,
  sliderTrack: 96,
  nudge: 22,
} as const);

const TOOLS: { id: PaintTool; label: string; icon: string }[] = [
  { id: 'hand', label: 'Move (H) — drag to pan, wheel to zoom', icon: 'Hand' },
  { id: 'brush', label: 'Brush (B)', icon: 'Brush' },
  { id: 'refine', label: 'Refine brush (F) — edge-aware', icon: 'ScanLine' },
  { id: 'lasso', label: 'Lasso (L) — Enter closes, Esc cancels', icon: 'Spline' },
  { id: 'smart', label: 'Smart select (S)', icon: 'WandSparkles' },
];

const MODES: { id: PaintMode; label: string; icon: string; color: string }[] = [
  { id: 'erase', label: 'Paint / remove (E)', icon: 'Eraser', color: '#ff9f43' },
  { id: 'restore', label: 'Restore (R)', icon: 'RotateCcw', color: '#34d399' },
];

/** the keyboard map, visible (the engine binds these in usePaintEditor) */
const KEY_HINT = 'B brush · E paint · R restore · H hand · L lasso · F refine · [ ] size · Ctrl+Z/Y undo/redo';

export function CutoutToolRail({ s }: { s: PaintEditorState }) {
  const target = s.activeLayer;
  const colors = target >= 0 && target < s.layers.length
    ? (s.layers[target].config.colors ?? s.defaults.colors)
    : s.defaults.colors;
  const safeSlot = Math.min(Math.max(s.activeColorSlot, 0), PAINT.NUM_COLOR_SLOTS - 1);

  return (
    <Col style={{
      width: RAIL.width, padding: 8, gap: 9, alignItems: 'center',
      backgroundColor: T.panelSolid, borderRightWidth: 1, borderColor: T.frame,
    }}>
      <SectionLabel>TOOLS</SectionLabel>
      <Row style={{ gap: 6, flexWrap: 'wrap', width: RAIL.tile * 4 + 18, justifyContent: 'center' }}>
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
      <SectionLabel>MASK</SectionLabel>
      <Row style={{ gap: 6, flexWrap: 'wrap', width: RAIL.tile * 4 + 18, justifyContent: 'center' }}>
        {MODES.map((m) => (
          <IconTile
            key={m.id}
            icon={m.icon}
            label={m.label}
            active={s.mode === m.id}
            color={m.color}
            onPress={() => s.setMode(m.id)}
          />
        ))}
        <IconTile icon="X" label="Clear layer mask" active={false} color={T.bad} onPress={s.clearMask} />
        <IconTile icon="RefreshCcw" label="Invert layer mask" active={false} color={T.accent} onPress={s.invertMask} />
        <IconTile icon="FlipHorizontal" label="Mirror painting across the vertical center" active={s.mirror} color="#22d3ee" onPress={() => s.setMirror(!s.mirror)} />
        {s.tool === 'lasso' && s.lassoPoints.length > 0 ? (
          <IconTile icon="Check" label={`Close lasso (${s.lassoPoints.length} points)`} active={false} color={T.good} onPress={s.commitLasso} />
        ) : null}
      </Row>

      <RailDivider />
      <SectionLabel>BRUSH</SectionLabel>
      <BrushSlider value={s.brushPx} onChange={s.setBrushPx} />

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
      <Box style={{ flexGrow: 1 }} />
      {/* the keyboard map, visible at the rail's foot */}
      <Text style={{ color: T.dim, fontSize: 8, fontFamily: 'monospace', textAlign: 'center', width: RAIL.width - 16 }}>
        {KEY_HINT}
      </Text>
    </Col>
  );
}

// ── the brush-size slider (the reference TopBar interaction) ─────────────────
// A draggable track with one detent per brush size, +/- nudge buttons, and a
// live px readout. Detents come from PAINT.tuning.brushSizes (P2).

export function BrushSlider({ value, onChange }: { value: number; onChange: (px: number) => void }) {
  const sizes = PAINT.tuning.brushSizes;
  const [rect, setRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  // nearest detent for an off-list value ([/] step keys keep it on-list)
  let index = 0;
  for (let i = 0; i < sizes.length; i++) {
    if (Math.abs(sizes[i] - value) < Math.abs(sizes[index] - value)) index = i;
  }
  const pct = sizes.length <= 1 ? 0 : index / (sizes.length - 1);
  const step = (delta: number) => {
    const next = Math.max(0, Math.min(sizes.length - 1, index + delta));
    onChange(sizes[next]);
  };
  const updateFromX = (x: number) => {
    if (!rect || rect.width <= 0) return;
    const raw = (x - rect.x) / rect.width;
    const nextIndex = Math.max(0, Math.min(sizes.length - 1, Math.round(raw * (sizes.length - 1))));
    onChange(sizes[nextIndex]);
  };
  const trackInset = 8;
  const span = RAIL.sliderTrack - trackInset * 2;
  return (
    <Col style={{ gap: 4, alignItems: 'center' }}>
      <Row style={{ gap: 6, alignItems: 'center' }}>
        <NudgeButton label="-" disabled={index === 0} onPress={() => step(-1)} />
        <Pressable
          tooltip={`${value}px brush — drag, or [ and ] to step`}
          onMouseDown={(p: any) => { setDragging(true); updateFromX(p.x); }}
          onMouseMove={(p: any) => { if (dragging) updateFromX(p.x); }}
          onMouseUp={() => setDragging(false)}
          onMouseLeave={() => setDragging(false)}
        >
          <Box
            onLayout={(r: any) => setRect(r)}
            style={{
              width: RAIL.sliderTrack, height: 28, borderRadius: 5,
              backgroundColor: T.page, borderWidth: 1, borderColor: T.frame,
              justifyContent: 'center', position: 'relative',
            }}
          >
            <Box style={{ position: 'absolute', left: trackInset, right: trackInset, top: 13, height: 2, borderRadius: 1, backgroundColor: T.frame }} />
            <Box style={{ position: 'absolute', left: trackInset, top: 13, width: Math.max(2, Math.round(span * pct)), height: 2, borderRadius: 1, backgroundColor: T.accent }} />
            {sizes.map((px, i) => (
              <Box
                key={px}
                style={{
                  position: 'absolute',
                  left: trackInset - 2 + Math.round((span * i) / (sizes.length - 1)),
                  top: 10, width: 8, height: 8, borderRadius: 4,
                  backgroundColor: i <= index ? T.accent : T.control,
                  borderWidth: 1, borderColor: i === index ? T.ink : T.frame,
                }}
              />
            ))}
            <Box style={{
              position: 'absolute',
              left: trackInset - 6 + Math.round(span * pct),
              top: 6, width: 16, height: 16, borderRadius: 8,
              backgroundColor: T.accent, borderWidth: 2, borderColor: T.ink,
            }} />
          </Box>
        </Pressable>
        <NudgeButton label="+" disabled={index === sizes.length - 1} onPress={() => step(1)} />
      </Row>
      <Text style={{ color: T.ink, fontSize: 10, fontWeight: '800' }}>{`${value}px`}</Text>
    </Col>
  );
}

// ── pieces ────────────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: string }) {
  return (
    <Text style={{ color: T.dim, fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>{children}</Text>
  );
}

function RailDivider() {
  return <Box style={{ width: RAIL.width - 40, height: 1, backgroundColor: T.frame }} />;
}

function IconTile(props: {
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

function NudgeButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={() => { if (!disabled) onPress(); }}>
      <Box style={{
        width: RAIL.nudge, height: 24, borderRadius: 5,
        backgroundColor: T.control, borderWidth: 1, borderColor: T.frame,
        opacity: disabled ? 0.45 : 1, alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ color: T.dim, fontSize: 12, fontWeight: '900' }}>{label}</Text>
      </Box>
    </Pressable>
  );
}
