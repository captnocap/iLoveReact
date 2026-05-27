// Tools — left vertical tool palette. Two-column square tools first, then
// MASK mode toggles, then a live color section bound to the active effect
// surface's color slots (default = global `effectColors` on s; per-layer
// overrides come from the Inspector Properties tab).

import { useState } from 'react';
import { Box, Col, Pressable, Row, Text } from '@reactjit/runtime/primitives';
import { Icon } from '@reactjit/runtime/icons/Icon';
import { COLORS, SIZES } from '../theme';
import type { CutoutState, Mode, Tool } from '../state';
import { NUM_COLOR_SLOTS, SLOT_LABELS } from './MaskQuad';

const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: 'hand', label: 'Move', icon: 'Hand' },
  { id: 'brush', label: 'Brush', icon: 'Brush' },
  { id: 'refine', label: 'Refine brush', icon: 'ScanLine' },
  { id: 'lasso', label: 'Lasso', icon: 'Spline' },
  { id: 'smart', label: 'Smart select', icon: 'WandSparkles' },
];

const MODES: { id: Mode; label: string; icon: string; color: string }[] = [
  { id: 'erase', label: 'Remove', icon: 'Eraser', color: COLORS.warn },
  { id: 'restore', label: 'Restore', icon: 'RotateCcw', color: COLORS.good },
];

const PALETTE = [
  '#ffffff', '#111827',
  '#ff4040', '#ff9f43',
  '#ffdd55', '#34d399',
  '#3da9ff', '#7c5cff',
  '#ff70cc', '#8b5a2b',
];

export function Tools({ s }: { s: CutoutState }) {
  // `activeSlot` is the slot index the next palette tap will overwrite.
  // The slot grid is sized by NUM_COLOR_SLOTS, so adding a 3rd/4th slot in
  // MaskQuad automatically grows this panel.
  const [activeSlot, setActiveSlot] = useState(0);
  const safeSlot = Math.min(Math.max(activeSlot, 0), NUM_COLOR_SLOTS - 1);
  const slotColors: string[] = Array.from({ length: NUM_COLOR_SLOTS }, (_, i) =>
    s.effectColors[i] ?? '#ffffff'
  );
  const pickColor = (color: string) => {
    s.setEffectColor(safeSlot, color);
  };

  return (
    <Col style={{
      width: SIZES.toolPalette,
      backgroundColor: COLORS.panel,
      borderRightWidth: 1,
      borderColor: COLORS.border,
      padding: 8,
      gap: 9,
      alignItems: 'center',
    }}>
      <SectionLabel>TOOLS</SectionLabel>
      <Row style={{ gap: 6, flexWrap: 'wrap', width: 76 }}>
        {TOOLS.map((t) => (
          <IconTile
            key={t.id}
            icon={t.icon}
            label={t.label}
            active={s.tool === t.id}
            color={COLORS.accent}
            onPress={() => s.setTool(t.id)}
          />
        ))}
      </Row>

      <Divider />
      <SectionLabel>MASK</SectionLabel>
      <Row style={{ gap: 6, flexWrap: 'wrap', width: 76 }}>
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
        <IconTile icon="X" label="Clear mask" active={false} color={COLORS.bad} onPress={s.clearMask} />
        <IconTile icon="RefreshCcw" label="Invert mask" active={false} color={COLORS.accent} onPress={s.invertMask} />
      </Row>

      <Divider />
      <SectionLabel>COLOR</SectionLabel>
      <Col style={{ gap: 7, width: 76, alignItems: 'center' }}>
        <Row style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
          {slotColors.map((color, i) => (
            <ColorSlot
              key={i}
              label={(SLOT_LABELS[i] ?? `S${i + 1}`).slice(0, 1).toUpperCase()}
              tooltip={`${SLOT_LABELS[i] ?? `Slot ${i + 1}`} color`}
              color={color}
              active={safeSlot === i}
              onPress={() => setActiveSlot(i)}
            />
          ))}
        </Row>
        <Row style={{ gap: 5, flexWrap: 'wrap', width: 73 }}>
          {PALETTE.map((color) => (
            <ColorSwatch
              key={color}
              color={color}
              active={slotColors[safeSlot] === color}
              onPress={() => pickColor(color)}
            />
          ))}
        </Row>
      </Col>
    </Col>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text style={{ color: COLORS.inkMuted, fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>
      {children}
    </Text>
  );
}

function IconTile(props: {
  icon: string;
  label: string;
  active: boolean;
  color: string;
  onPress: () => void;
}) {
  const fg = props.active ? '#0b1018' : COLORS.inkDim;
  return (
    <Pressable onPress={props.onPress} tooltip={props.label}>
      <Box style={{
        width: 35,
        height: 35,
        borderRadius: 6,
        backgroundColor: props.active ? props.color : COLORS.bgSoft,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: props.active ? props.color : COLORS.borderStrong,
      }}>
        <Icon name={props.icon} size={17} color={fg} strokeWidth={2} />
      </Box>
    </Pressable>
  );
}

function ColorSlot(props: {
  label: string;
  tooltip?: string;
  color: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={props.onPress} tooltip={props.tooltip ?? (props.label === 'P' ? 'Primary color' : 'Secondary color')}>
      <Col style={{
        width: 35,
        height: 42,
        borderRadius: 6,
        backgroundColor: COLORS.bgSoft,
        borderWidth: 1,
        borderColor: props.active ? COLORS.accent : COLORS.borderStrong,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
      }}>
        <Box style={{
          width: 23,
          height: 18,
          borderRadius: 4,
          backgroundColor: props.color,
          borderWidth: 1,
          borderColor: props.color === '#ffffff' ? COLORS.borderStrong : props.color,
        }} />
        <Text style={{
          color: props.active ? COLORS.accent : COLORS.inkDim,
          fontSize: 9,
          fontWeight: '800',
        }}>
          {props.label}
        </Text>
      </Col>
    </Pressable>
  );
}

function ColorSwatch(props: { color: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} tooltip={props.color}>
      <Box style={{
        width: 17,
        height: 17,
        borderRadius: 4,
        backgroundColor: props.color,
        borderWidth: props.active ? 2 : 1,
        borderColor: props.active ? COLORS.accent : (props.color === '#ffffff' ? COLORS.borderStrong : COLORS.border),
      }} />
    </Pressable>
  );
}

function Divider() {
  return <Box style={{ width: 70, height: 1, backgroundColor: COLORS.border, marginVertical: 1 }} />;
}
