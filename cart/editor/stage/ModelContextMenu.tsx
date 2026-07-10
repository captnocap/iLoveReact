// The model surface's right-click menu content — the canonical home for every
// mesh tool (select / gizmo / toggles), the contextual topology ops, and the
// tucked-away Quality slider. Rendered at the app ROOT (see AppFrame) via
// useContextMenu so it lands at the cursor: the menu positions relative to its
// parent, and only the root sits at window origin (the stage is offset by the
// rail + content browser). The toolbar mirrors the quick subset of this.
import { useState } from 'react';
import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import { Slider } from '../../../runtime/primitives';
import { meshToolCommands, meshToolActive, meshTopoCommands, meshPartCommands } from '../data/commands';
import type { LightId, ModelToolSnapshot } from '../data/types';

// The viewer light-rig switches. Flat is the even paint-true master; Key/Fill only apply when
// Flat is off. `field` reads the on-state off the tool snapshot.
const LIGHT_ROWS: { id: LightId; label: string; field: 'litFlat' | 'litKey' | 'litFill' }[] = [
  { id: 'flat', label: 'Flat (even, paint-true)', field: 'litFlat' },
  { id: 'key', label: 'Key light', field: 'litKey' },
  { id: 'fill', label: 'Fill (lift shadows)', field: 'litFill' },
];

export default function ModelContextMenu({ modelTool, hasActivePart, selectedPartCount, onCommand, onQuality, onToggleLight, onClose }: {
  modelTool: ModelToolSnapshot;
  // Whether the outliner has a FOCUSED part (unlocks duplicate / mirror) and how
  // many rows are explicitly selected (2+ unlocks structural merge).
  hasActivePart: boolean;
  selectedPartCount: number;
  onCommand: (id: string, source: string) => void;
  onQuality: (quality: number) => void;
  onToggleLight: (which: LightId) => void;
  onClose: () => void;
}) {
  // Lighting is a nested, collapsible flyout so a right-click stays compact — it's "in there
  // somewhere" without making the menu a wall. Expanding keeps the menu open.
  const [lightsOpen, setLightsOpen] = useState(false);
  return (
    <C.HW_StageContextMenu>
      {meshToolCommands().map((command) => {
        const active = meshToolActive(command.id, modelTool);
        return (
          <C.HW_ContextRow key={command.id} onPress={() => { onCommand(command.id, 'context'); onClose(); }}>
            <Icon name={command.icon} size={12} color={accentFor(active ? 'primary' : 'textDim')} />
            <C.HW_ContextText>{command.name}</C.HW_ContextText>
            <C.HW_Spacer />
            <C.HW_KeyText>{command.key}</C.HW_KeyText>
          </C.HW_ContextRow>
        );
      })}
      {meshTopoCommands(modelTool, selectedPartCount).map((command) => (
        <C.HW_ContextRow key={command.id} onPress={() => { onCommand(command.id, 'context'); onClose(); }}>
          <Icon name={command.icon} size={12} color={accentFor('primary')} />
          <C.HW_ContextText>{command.name}</C.HW_ContextText>
          <C.HW_Spacer />
          <C.HW_KeyText>{command.key}</C.HW_KeyText>
        </C.HW_ContextRow>
      ))}
      {/* Part verbs for the FOCUSED outliner part (duplicate / mirrored twin / merge
          the explicit selected set) + the library import — host-native. */}
      {meshPartCommands(hasActivePart, selectedPartCount).map((command) => (
        <C.HW_ContextRow key={command.id} onPress={() => { onCommand(command.id, 'context'); onClose(); }}>
          <Icon name={command.icon} size={12} color={accentFor('primary')} />
          <C.HW_ContextText>{command.name}</C.HW_ContextText>
          <C.HW_Spacer />
          <C.HW_KeyText>{command.key}</C.HW_KeyText>
        </C.HW_ContextRow>
      ))}
      {/* Lighting — a nested flyout. Collapsed by default (the menu stays compact); expand to
          flip the switches. Also lives in the View menu bar. Toggling keeps this menu open. */}
      <C.HW_ContextRow onPress={() => setLightsOpen((v) => !v)}>
        <Icon name="Sun" size={12} color={accentFor('primary')} />
        <C.HW_ContextText>Lighting</C.HW_ContextText>
        <C.HW_Spacer />
        <Icon name={lightsOpen ? 'ChevronDown' : 'ChevronRight'} size={12} color={accentFor('textDim')} />
      </C.HW_ContextRow>
      {lightsOpen ? LIGHT_ROWS.map((row) => {
        const disabled = row.id !== 'flat' && modelTool.litFlat;
        const on = modelTool[row.field] && !disabled;
        return (
          <C.HW_ContextRow key={row.id} onPress={() => { if (!disabled) onToggleLight(row.id); }} style={{ paddingLeft: 26 }}>
            <Icon name={on ? 'Lightbulb' : 'LightbulbOff'} size={12} color={accentFor(on ? 'primary' : 'textDim')} />
            <C.HW_ContextText>{row.label}</C.HW_ContextText>
            <C.HW_Spacer />
            <C.HW_KeyText>{disabled ? '—' : on ? 'on' : 'off'}</C.HW_KeyText>
          </C.HW_ContextRow>
        );
      }) : null}
      {/* Quality lives here — tucked away, only present when the menu is called.
          Dragging stays inside the menu, so it doesn't dismiss. */}
      <C.HW_StageMenuQuality>
        <C.HW_StageMenuQualityHead>
          <C.HW_ContextText>Quality</C.HW_ContextText>
          <C.HW_Spacer />
          <C.HW_KeyText>{modelTool.tris.toLocaleString()} tris</C.HW_KeyText>
        </C.HW_StageMenuQualityHead>
        {/* Commit-only: the host owns the thumb mid-drag; decimation runs ONCE on
            release. Re-decimating on every onChange frame melted the app. */}
        <Slider value={modelTool.quality} min={0} max={1} onCommit={(v: number) => onQuality(v)} style={{ height: 22 }} />
      </C.HW_StageMenuQuality>
    </C.HW_StageContextMenu>
  );
}
