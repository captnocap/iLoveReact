// TopBar — app chrome split into an OS-like title strip and a thinner
// action toolbar. The title strip owns window controls and future tab/menu
// real estate; the toolbar owns file/export commands.

import { useState } from 'react';
import { callHost } from '@reactjit/runtime/ffi';
import { Box, Col, Pressable, Row, Text } from '@reactjit/runtime/primitives';
import { Icon } from '@reactjit/runtime/icons/Icon';
import { COLORS, SIZES } from '../theme';
import type { CutoutState } from '../state';

const BRUSH_SIZES = [2, 8, 32, 128, 512];

export function TopBar({ s }: { s: CutoutState }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const canSave = !!s.srcPath && s.hasMaskEdits && !s.busy;
  return (
    <Col style={{
      height: SIZES.topBar,
      backgroundColor: COLORS.panel,
      borderBottomWidth: 1,
      borderColor: COLORS.border,
      position: 'relative',
      zIndex: 10,
    }}>
      <Row
        windowDrag={true}
        style={{
          height: SIZES.titleBar,
          paddingLeft: 8,
          paddingRight: 4,
          alignItems: 'center',
          gap: 8,
          backgroundColor: COLORS.bgSoft,
          borderBottomWidth: 1,
          borderColor: COLORS.border,
        }}
      >
        <Pressable onPress={() => setMenuOpen((v) => !v)}>
          <Row style={{
            height: 24,
            paddingHorizontal: 7,
            borderRadius: 5,
            backgroundColor: menuOpen ? COLORS.panelHi : COLORS.panel,
            borderWidth: 1,
            borderColor: menuOpen ? COLORS.borderStrong : COLORS.border,
            alignItems: 'center',
            gap: 6,
          }}>
            <Icon name="Scissors" size={13} color={COLORS.accent} strokeWidth={2} />
            <Text style={{ color: COLORS.ink, fontSize: 11, fontWeight: '800' }}>Cutout</Text>
            <Icon name="PanelTop" size={10} color={COLORS.inkDim} strokeWidth={2} />
          </Row>
        </Pressable>

        <Row style={{
          height: 25,
          flexGrow: 1,
          flexBasis: 0,
          minWidth: 0,
          flexShrink: 1,
          alignItems: 'center',
          gap: 4,
        }}>
          <Tab label={s.srcDims ? s.stem : 'Untitled cutout'} active />
          <Pressable onPress={() => s.createBlankSurface()}>
            <Box style={{
              width: 24,
              height: 24,
              borderRadius: 5,
              backgroundColor: COLORS.panel,
              borderWidth: 1,
              borderColor: COLORS.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Icon name="Plus" size={12} color={COLORS.inkDim} strokeWidth={2} />
            </Box>
          </Pressable>
        </Row>

        <Text style={{ color: COLORS.inkMuted, fontSize: 10, flexShrink: 0 }} numberOfLines={1}>
          {s.srcDims ? '1 tab' : 'no source'}
        </Text>
        <WindowControls />
      </Row>

      <Row style={{
        height: SIZES.actionBar,
        paddingLeft: 24,
        paddingRight: 24,
        alignItems: 'center',
        gap: 10,
        backgroundColor: COLORS.panel,
        minWidth: 0,
      }}>
        <Row style={{ gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <IconAction icon="Plus" label="New blank" primary onPress={() => s.createBlankSurface()} />
          <IconAction icon="FileImage" label="Pick image" onPress={s.pickFile} />
          <IconAction icon="FolderInput" label="Import SQI" onPress={() => s.importSqi()} />
          <ActionButton
            icon="Save"
            label={s.srcDims ? `Save PNG ${s.srcDims.w}×${s.srcDims.h}` : 'Save PNG'}
            active={canSave}
            tone="good"
            onPress={s.saveCutout}
          />
          <ActionButton
            icon="Package"
            label={`Save .sqi (${s.layers.length} layer${s.layers.length === 1 ? '' : 's'})`}
            active={canSave}
            tone="accent"
            onPress={s.saveSqi}
          />
        </Row>
        {/* Stem used to live here too — duplicated with the TopBar tab
            label above + Source Properties + ContextMenu. Stripped so
            the document name has one canonical home: the tab. */}
        <Box style={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }} />
        <Box style={{ width: 1, height: 18, backgroundColor: COLORS.border }} />
        <BrushSlider value={s.brushPx} onChange={s.setBrushPx} />
        {/* WORKING / EXPORT READY / "make a selection to export" used to
           live here, but the same signal now reads off the StatusBar pill
           + status text in the bottom toolbar — keeping it in two places
           was the double-duty the user flagged. */}
      </Row>

      {menuOpen ? (
        <>
          <Pressable
            style={{
              position: 'absolute',
              left: -4000,
              top: -2000,
              width: 8000,
              height: 8000,
              zIndex: 15,
            }}
            onPress={() => setMenuOpen(false)}
          />
          <ContextMenu s={s} onClose={() => setMenuOpen(false)} />
        </>
      ) : null}
    </Col>
  );
}

function BrushSlider({ value, onChange }: { value: number; onChange: (px: number) => void }) {
  const [rect, setRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const index = Math.max(0, BRUSH_SIZES.indexOf(value));
  const pct = BRUSH_SIZES.length <= 1 ? 0 : index / (BRUSH_SIZES.length - 1);
  const step = (delta: number) => {
    const next = Math.max(0, Math.min(BRUSH_SIZES.length - 1, index + delta));
    onChange(BRUSH_SIZES[next]);
  };
  const updateFromX = (x: number) => {
    if (!rect || rect.width <= 0) return;
    const raw = (x - rect.x) / rect.width;
    const nextIndex = Math.max(0, Math.min(BRUSH_SIZES.length - 1, Math.round(raw * (BRUSH_SIZES.length - 1))));
    onChange(BRUSH_SIZES[nextIndex]);
  };
  return (
    <Row style={{ gap: 7, alignItems: 'center', flexShrink: 0 }}>
      <Text style={{ color: COLORS.inkMuted, fontSize: 10, fontWeight: '800' }}>BRUSH</Text>
      <NudgeButton label="-" disabled={index === 0} onPress={() => step(-1)} />
      <Pressable
        tooltip={`${value}px brush`}
        onMouseDown={(p: any) => { setDragging(true); updateFromX(p.x); }}
        onMouseMove={(p: any) => { if (dragging) updateFromX(p.x); }}
        onMouseUp={() => setDragging(false)}
      >
        <Box
          onLayout={(r: any) => setRect(r)}
          style={{
            width: 104,
            height: 28,
            borderRadius: 5,
            backgroundColor: COLORS.bgSoft,
            borderWidth: 1,
            borderColor: COLORS.border,
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          <Box style={{
            position: 'absolute',
            left: 8,
            right: 8,
            top: 13,
            height: 2,
            borderRadius: 1,
            backgroundColor: COLORS.borderStrong,
          }} />
          <Box style={{
            position: 'absolute',
            left: 8,
            top: 13,
            width: Math.max(2, Math.round(88 * pct)),
            height: 2,
            borderRadius: 1,
            backgroundColor: COLORS.accent,
          }} />
          {BRUSH_SIZES.map((px, i) => (
            <Box
              key={px}
              style={{
                position: 'absolute',
                left: 6 + Math.round((88 * i) / (BRUSH_SIZES.length - 1)),
                top: 10,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: i <= index ? COLORS.accent : COLORS.panelHi,
                borderWidth: 1,
                borderColor: i === index ? COLORS.ink : COLORS.border,
              }}
            />
          ))}
          <Box style={{
            position: 'absolute',
            left: 2 + Math.round(88 * pct),
            top: 6,
            width: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: COLORS.accent,
            borderWidth: 2,
            borderColor: COLORS.ink,
          }} />
        </Box>
      </Pressable>
      <NudgeButton label="+" disabled={index === BRUSH_SIZES.length - 1} onPress={() => step(1)} />
      <Text style={{ color: COLORS.ink, fontSize: 10, fontWeight: '800', width: 34 }} numberOfLines={1}>
        {value}px
      </Text>
    </Row>
  );
}

function IconAction(props: {
  icon: string;
  label: string;
  primary?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={props.onPress} tooltip={props.label}>
      <Box style={{
        width: 30,
        height: 28,
        borderRadius: 5,
        backgroundColor: props.primary ? COLORS.panelHi : COLORS.bgSoft,
        borderWidth: 1,
        borderColor: props.primary ? COLORS.borderStrong : COLORS.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <Icon name={props.icon} size={14} color={props.primary ? COLORS.accent : COLORS.inkDim} strokeWidth={2} />
      </Box>
    </Pressable>
  );
}

function NudgeButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Box style={{
        width: 22,
        height: 24,
        borderRadius: 5,
        backgroundColor: COLORS.bgSoft,
        borderWidth: 1,
        borderColor: COLORS.border,
        opacity: disabled ? 0.45 : 1,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <Text style={{ color: COLORS.inkDim, fontSize: 12, fontWeight: '900' }}>{label}</Text>
      </Box>
    </Pressable>
  );
}

function ToolbarButton(props: {
  icon: string;
  label: string;
  primary?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={props.onPress} tooltip={props.label}>
      <Row style={{
        height: 24,
        paddingLeft: 8,
        paddingRight: 10,
        borderRadius: 6,
        backgroundColor: props.primary ? COLORS.panelHi : COLORS.bgSoft,
        borderWidth: 1,
        borderColor: props.primary ? COLORS.borderStrong : COLORS.border,
        alignItems: 'center',
        gap: 6,
      }}>
        <Icon name={props.icon} size={13} color={props.primary ? COLORS.accent : COLORS.inkDim} strokeWidth={2} />
        <Text style={{
          color: props.primary ? COLORS.ink : COLORS.inkDim,
          fontSize: 10,
          fontWeight: '800',
        }}>
          {props.label}
        </Text>
      </Row>
    </Pressable>
  );
}

function Tab({ label, active }: { label: string; active?: boolean }) {
  return (
    <Row style={{
      height: 25,
      minWidth: 0,
      flexGrow: 1,
      flexBasis: 0,
      paddingLeft: 9,
      paddingRight: 8,
      borderTopLeftRadius: 6,
      borderTopRightRadius: 6,
      backgroundColor: active ? COLORS.panel : COLORS.bgSoft,
      borderWidth: 1,
      borderColor: active ? COLORS.borderStrong : COLORS.border,
      alignItems: 'center',
      gap: 7,
    }}>
      <Text style={{ color: active ? COLORS.ink : COLORS.inkDim, fontSize: 11, fontWeight: '700' }} numberOfLines={1}>
        {label}
      </Text>
      <Box style={{ flexGrow: 1 }} />
      <Icon name="X" size={10} color={COLORS.inkMuted} strokeWidth={2} />
    </Row>
  );
}

function ActionButton(props: {
  icon: string;
  label: string;
  active: boolean;
  tone: 'accent' | 'good';
  onPress: () => void;
}) {
  const color = props.tone === 'good' ? COLORS.good : COLORS.accent;
  return (
    <Pressable onPress={props.onPress} tooltip={props.label}>
      <Box style={{
        width: 30,
        height: 28,
        borderRadius: 5,
        backgroundColor: props.active && props.tone === 'good' ? color : COLORS.bgSoft,
        borderWidth: 1,
        borderColor: props.active ? color : COLORS.border,
        opacity: props.active ? 1 : 0.55,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <Icon
          name={props.icon}
          size={14}
          color={props.active ? (props.tone === 'good' ? '#0b1018' : color) : COLORS.inkDim}
          strokeWidth={2}
        />
      </Box>
    </Pressable>
  );
}

function WindowControls() {
  return (
    <Row style={{ gap: 2, alignItems: 'center', flexShrink: 0 }}>
      <ChromeButton icon="Minus" label="Minimize" onPress={() => callHost<void>('__window_minimize', undefined as any)} />
      <ChromeButton icon="Square" label="Maximize" onPress={() => callHost<void>('__window_maximize', undefined as any)} />
      <ChromeButton icon="X" label="Close" danger onPress={() => callHost<void>('__window_close', undefined as any)} />
    </Row>
  );
}

function ChromeButton({
  icon,
  label,
  danger,
  onPress,
}: {
  icon: string;
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} tooltip={label}>
      <Box style={{
        width: 28,
        height: 24,
        borderRadius: 5,
        backgroundColor: danger ? '#301822' : COLORS.panel,
        borderWidth: 1,
        borderColor: danger ? '#5a2630' : COLORS.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <Icon name={icon} size={11} color={danger ? COLORS.bad : COLORS.inkDim} strokeWidth={2} />
      </Box>
    </Pressable>
  );
}

function ContextMenu({ s, onClose }: { s: CutoutState; onClose: () => void }) {
  return (
    <Col style={{
      position: 'absolute',
      left: 8,
      top: SIZES.titleBar - 1,
      width: 260,
      backgroundColor: COLORS.panel,
      borderWidth: 1,
      borderColor: COLORS.borderStrong,
      borderRadius: 7,
      padding: 8,
      gap: 6,
      zIndex: 20,
    }}>
      <Text style={{ color: COLORS.inkMuted, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>
        WORKSPACE
      </Text>
      <MenuItem label="New blank" detail="Create a paintable canvas" onPress={() => { onClose(); s.createBlankSurface(); }} />
      <MenuItem label="Pick image" detail="Open a new source image" onPress={() => { onClose(); void s.pickFile(); }} />
      <MenuItem label="Recent files" detail="reserved for project history" disabled />
      <Divider />
      <Text style={{ color: COLORS.inkMuted, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>
        TABS
      </Text>
      <MenuItem label="Current cutout" detail={s.srcDims ? s.stem : 'Untitled'} active />
      <MenuItem label="New cutout tab" detail="reserved for multi-document editing" disabled />
      <MenuItem label="Tab overview" detail="future navigation space" disabled />
    </Col>
  );
}

function MenuItem({
  label,
  detail,
  active,
  disabled,
  onPress,
}: {
  label: string;
  detail: string;
  active?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <Row style={{
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 5,
      backgroundColor: active ? COLORS.panelHi : COLORS.bgSoft,
      borderWidth: 1,
      borderColor: active ? COLORS.borderStrong : COLORS.border,
      opacity: disabled ? 0.55 : 1,
      alignItems: 'center',
      gap: 8,
    }}>
      <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 1 }}>
        <Text style={{ color: COLORS.ink, fontSize: 11, fontWeight: '800' }} numberOfLines={1}>
          {label}
        </Text>
        <Text style={{ color: COLORS.inkDim, fontSize: 10 }} numberOfLines={1}>
          {detail}
        </Text>
      </Col>
      {active ? <Text style={{ color: COLORS.good, fontSize: 10, fontWeight: '900' }}>ACTIVE</Text> : null}
    </Row>
  );
  return onPress && !disabled ? <Pressable onPress={onPress}>{body}</Pressable> : body;
}

function Divider() {
  return <Box style={{ height: 1, backgroundColor: COLORS.border, marginVertical: 2 }} />;
}
