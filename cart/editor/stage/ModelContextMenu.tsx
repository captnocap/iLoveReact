// The model surface's right-click menu content — the canonical home for every
// mesh tool (select / gizmo / toggles), the contextual topology ops, and the
// tucked-away Quality slider. Rendered at the app ROOT (see AppFrame) via
// useContextMenu so it lands at the cursor: the menu positions relative to its
// parent, and only the root sits at window origin (the stage is offset by the
// rail + content browser). The toolbar mirrors the quick subset of this.
import { Fragment, useState } from 'react';
import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import { Slider } from '../../../runtime/primitives';
import {
  meshToolCommands, meshToolActive, meshTopoCommands, modelContextMenuLayout,
  type ModelContextMenuGroup,
} from '../data/commands';
import type { Command, LightId, ModelToolSnapshot } from '../data/types';

// The viewer light-rig switches. Flat is the even paint-true master; Key/Fill only apply when
// Flat is off. `field` reads the on-state off the tool snapshot.
const LIGHT_ROWS: { id: LightId; label: string; field: 'litFlat' | 'litKey' | 'litFill' }[] = [
  { id: 'flat', label: 'Flat (even, paint-true)', field: 'litFlat' },
  { id: 'key', label: 'Key light', field: 'litKey' },
  { id: 'fill', label: 'Fill (lift shadows)', field: 'litFill' },
];

const STATEFUL_TOOL_IDS = new Set(meshToolCommands().map((command) => command.id));

function CommandRow({ command, modelTool, indented = false, onPress }: {
  command: Command;
  modelTool: ModelToolSnapshot;
  indented?: boolean;
  onPress: () => void;
}) {
  const active = STATEFUL_TOOL_IDS.has(command.id) && meshToolActive(command.id, modelTool);
  const color = STATEFUL_TOOL_IDS.has(command.id)
    ? accentFor(active ? 'primary' : 'textDim')
    : accentFor('primary');
  // Classifier user props are authoritative: `style={undefined}` erases the
  // classified row style instead of meaning "no override". Omit the prop for
  // direct rows; only expanded submenu children receive an indent override.
  const indentProps = indented ? { style: { paddingLeft: 26 } } : {};
  return (
    <C.HW_ContextRow onPress={onPress} {...indentProps}>
      <Icon name={command.icon} size={12} color={color} />
      <C.HW_ContextText>{command.name}</C.HW_ContextText>
      <C.HW_Spacer />
      <C.HW_KeyText>{command.key}</C.HW_KeyText>
    </C.HW_ContextRow>
  );
}

function GroupRow({ group, open, onToggle }: { group: ModelContextMenuGroup; open: boolean; onToggle: () => void }) {
  return (
    <C.HW_ContextRow onPress={onToggle}>
      <Icon name={group.icon} size={12} color={accentFor('primary')} />
      <C.HW_ContextText>{group.label}</C.HW_ContextText>
      <C.HW_Spacer />
      <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={12} color={accentFor('textDim')} />
    </C.HW_ContextRow>
  );
}

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
  // One family at a time keeps the right-click menu short even after expansion.
  // Child commands preserve the canonical dispatch path; this component only lays them out.
  const [openGroup, setOpenGroup] = useState<ModelContextMenuGroup['id'] | null>(null);
  const layout = modelContextMenuLayout(hasActivePart, selectedPartCount);
  const toolGroups = layout.groups.filter((group) => group.id !== 'view');
  const viewGroup = layout.groups.find((group) => group.id === 'view')!;
  const run = (command: Command) => { onCommand(command.id, 'context'); onClose(); };

  const renderGroup = (group: ModelContextMenuGroup) => {
    const open = openGroup === group.id;
    return (
      <Fragment key={group.id}>
        <GroupRow group={group} open={open} onToggle={() => setOpenGroup((current) => current === group.id ? null : group.id)} />
        {open ? group.commands.map((command) => (
          <CommandRow key={command.id} command={command} modelTool={modelTool} indented onPress={() => run(command)} />
        )) : null}
      </Fragment>
    );
  };

  return (
    <C.HW_StageContextMenu>
      {toolGroups.map(renderGroup)}
      {layout.directToolCommands.map((command) => (
        <CommandRow key={command.id} command={command} modelTool={modelTool} onPress={() => run(command)} />
      ))}
      {meshTopoCommands(modelTool, selectedPartCount).map((command) => (
        <CommandRow key={command.id} command={command} modelTool={modelTool} onPress={() => run(command)} />
      ))}
      {renderGroup(viewGroup)}
      {openGroup === 'view' ? LIGHT_ROWS.map((row) => {
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
      {/* Part verbs for the FOCUSED outliner part (duplicate / mirrored twin / merge
          the explicit selected set) + the library import. Mirrored twins live in
          the Mirror family above; these primary actions stay one click away. */}
      {layout.directPartCommands.map((command) => (
        <CommandRow key={command.id} command={command} modelTool={modelTool} onPress={() => run(command)} />
      ))}
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
