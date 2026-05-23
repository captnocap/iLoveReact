// TopBar — transport, project identity, compile/undo, cheat-sheet trigger.
//
// Each button wears a Tooltip annotation so the hover layer matches the
// cheat-sheet model: skim labels first, hover for the why and the
// keyboard shortcut. The Tooltip surface comes from the framework's
// runtime/tooltip module (TooltipRoot is mounted in index.tsx).

import { useRef } from 'react';
import { Row, Box, Text, Pressable, TextInput } from '@reactjit/runtime/primitives';
import { Tooltip } from '@reactjit/runtime/tooltip/Tooltip';
import { useMeasure } from '@reactjit/runtime/hooks';
import { COLORS, SIZES } from '../theme';
import type { ComposerState } from '../state';

interface Props {
  s: ComposerState;
}

export function TopBar({ s }: Props) {
  return (
    <Row style={{
      height: SIZES.topBar,
      backgroundColor: COLORS.panel,
      borderBottomWidth: 1,
      borderBottomColor: COLORS.border,
      paddingLeft: 12,
      paddingRight: 12,
      alignItems: 'center',
      gap: 10,
    }}>
      <Text style={{ color: COLORS.inkDim, fontSize: 11, letterSpacing: 1 }}>COMPOSER</Text>

      <Box style={{ width: 1, height: 24, backgroundColor: COLORS.border }} />

      <Tooltip variant="sweatshop-ui" title="Project name" label="Renaming switches autosave to a new session file under cart/composer/sessions/. Filename-safe characters only.">
        <TextInput
          value={s.stem}
          onChange={(v: string) => s.setStem(v.replace(/[^A-Za-z0-9_-]+/g, '_') || 'untitled')}
          style={{
            backgroundColor: COLORS.bgSoft,
            color: COLORS.ink,
            borderWidth: 1,
            borderColor: COLORS.border,
            borderRadius: 4,
            paddingLeft: 8,
            paddingRight: 8,
            paddingTop: 4,
            paddingBottom: 4,
            fontSize: 12,
            fontFamily: 'monospace',
            minWidth: 140,
          }}
        />
      </Tooltip>

      <Box style={{ width: 1, height: 24, backgroundColor: COLORS.border }} />

      <Tooltip variant="sweatshop-ui" title={s.isPlaying ? 'Pause' : 'Play'} label={s.isPlaying ? 'Pause transport without resetting the playhead.' : 'Resume the most recently compiled arrangement.'}>
        <Pressable onPress={s.togglePlay} style={btnStyle(s.isPlaying ? COLORS.good : COLORS.panelAlt)}>
          <Text style={btnText(s.isPlaying ? COLORS.bg : COLORS.ink)}>{s.isPlaying ? '⏸ pause' : '▶ play'}</Text>
        </Pressable>
      </Tooltip>
      <Tooltip variant="sweatshop-ui" title="Stop" label="Stop transport and reset the playhead to measure 1.">
        <Pressable onPress={s.stop} style={btnStyle(COLORS.panelAlt)}>
          <Text style={btnText(COLORS.ink)}>⏹ stop</Text>
        </Pressable>
      </Tooltip>

      <Box style={{ width: 1, height: 24, backgroundColor: COLORS.border }} />

      <Tooltip variant="sweatshop-ui" title="Project tempo" label="The default BPM used until your code calls setTempo(...). The code's setTempo wins once it runs.">
        <Row style={{ alignItems: 'center', gap: 6 }}>
          <Text style={{ color: COLORS.inkDim, fontSize: 11 }}>tempo</Text>
          <Text style={{ color: COLORS.ink, fontSize: 13, fontFamily: 'monospace', minWidth: 36 }}>
            {s.tempo}
          </Text>
        </Row>
      </Tooltip>

      <Box style={{ width: 1, height: 24, backgroundColor: COLORS.border }} />

      <Tooltip
        variant="sweatshop-ui"
        title="Master volume"
        label="Output gain applied after every track. Slider is 0..1 — drag, then your code's setMasterVolume(...) on the next compile can override it."
      >
        <Row style={{ alignItems: 'center', gap: 6 }}>
          <Text style={{ color: COLORS.inkDim, fontSize: 11 }}>vol</Text>
          <MasterVolumeSlider value={s.masterVolume} onChange={s.setMasterVolume} />
          <Text style={{ color: COLORS.ink, fontSize: 11, fontFamily: 'monospace', minWidth: 30 }}>
            {Math.round(s.masterVolume * 100)}
          </Text>
        </Row>
      </Tooltip>

      <Box style={{ flexGrow: 1 }} />

      <Tooltip variant="sweatshop-ui" title="Undo" label="Step back to the previous workspace snapshot." shortcut="Ctrl+Z">
        <Pressable
          onPress={s.canUndo ? s.undo : undefined}
          style={btnStyle(s.canUndo ? COLORS.panelAlt : COLORS.bgSoft)}
        >
          <Text style={btnText(s.canUndo ? COLORS.ink : COLORS.inkMuted)}>↶ undo</Text>
        </Pressable>
      </Tooltip>
      <Tooltip variant="sweatshop-ui" title="Redo" label="Re-apply the snapshot that undo just rolled back." shortcut="Ctrl+Y">
        <Pressable
          onPress={s.canRedo ? s.redo : undefined}
          style={btnStyle(s.canRedo ? COLORS.panelAlt : COLORS.bgSoft)}
        >
          <Text style={btnText(s.canRedo ? COLORS.ink : COLORS.inkMuted)}>↷ redo</Text>
        </Pressable>
      </Tooltip>

      <Box style={{ width: 1, height: 24, backgroundColor: COLORS.border }} />

      <Tooltip variant="sweatshop-ui" title="API reference" label="Toggle the docked reference rail. Examples can be inserted directly into the editor." shortcut="?">
        <Pressable onPress={s.toggleCheatSheet} style={btnStyle(s.isCheatSheetOpen ? COLORS.accent : COLORS.panelAlt)}>
          <Text style={btnText(s.isCheatSheetOpen ? COLORS.bg : COLORS.ink)}>ref</Text>
        </Pressable>
      </Tooltip>

      <Tooltip variant="sweatshop-ui" title="Compile + play" label="Wipe the audio framework's tracks, run the editor source against the sandbox, then start transport. Errors surface in the editor gutter." shortcut="Ctrl+S">
        <Pressable onPress={s.compile} style={btnStyle(COLORS.accent)}>
          <Text style={btnText(COLORS.bg)}>compile</Text>
        </Pressable>
      </Tooltip>
    </Row>
  );
}

function btnStyle(bg: string) {
  return {
    backgroundColor: bg,
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 6,
    paddingBottom: 6,
    borderRadius: 4,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };
}

// Horizontal master-volume slider. Same pattern as AudioControls.Slider
// (drag pointer events all on the SAME node per the pointer-capture rule:
// onMouseDown sets dragging, onMouseMove updates while dragging,
// onMouseUp/Leave releases) but themed for the TopBar and stripped of the
// label / +- buttons that don't belong in a slim toolbar.
function MasterVolumeSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const { rect, onLayout } = useMeasure();
  const draggingRef = useRef(false);
  const TRACK_W = 96;
  const TRACK_H = 10;

  const emit = (payload: any) => {
    if (!rect || typeof payload?.x !== 'number') return;
    const pct = Math.max(0, Math.min(1, (payload.x - rect.x) / Math.max(1, rect.width)));
    onChange(pct);
  };

  return (
    <Box
      onLayout={onLayout}
      onMouseDown={(p: any) => { draggingRef.current = true; emit(p); }}
      onMouseMove={(p: any) => { if (draggingRef.current) emit(p); }}
      onMouseUp={() => { draggingRef.current = false; }}
      onMouseLeave={() => { draggingRef.current = false; }}
      style={{
        width: TRACK_W,
        height: TRACK_H,
        backgroundColor: COLORS.bgSoft,
        borderRadius: TRACK_H / 2,
        borderWidth: 1,
        borderColor: COLORS.border,
        overflow: 'hidden',
        justifyContent: 'center',
      }}
    >
      <Box style={{
        width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`,
        height: '100%',
        backgroundColor: COLORS.accent,
      }} />
    </Box>
  );
}

function btnText(color: string) {
  return { color, fontSize: 12, fontWeight: '600' as const };
}
