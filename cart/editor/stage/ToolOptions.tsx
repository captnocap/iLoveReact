// SECTION D — Action Bar (see shell/regions.ts SECTIONS): THE toolbar — the
// tool row pinned above the stage (mesh tools, snap, floor, view modes, paint
// segment, map-paint bar).
import { Fragment } from 'react';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { commandById, meshToolCommands, meshToolActive, meshTopoCommands, worldActionBarCommands } from '../data/commands';
import { SNAP_MODES } from '../data/content';
import type { EditorState, ViewMode } from '../data/types';
import MapPaintBar from './MapPaintBar';

// A model document owns the host-native mesh editor — the toolbar becomes the
// home for its tools (icon-only), with select / gizmo / toggle groups divided.
const MESH_GROUP_DIVIDER = new Set(['mesh-move', 'mesh-sym-x', 'mesh-paint']);
// Live mirror toggles (req_2758) read as their AXIS LETTER — the letter IS the value
// (which plane), the old studio's X/Y/Z mirror-chip treatment.
const MESH_SYM_LETTER: Record<string, string> = { 'mesh-sym-x': 'X', 'mesh-sym-y': 'Y', 'mesh-sym-z': 'Z' };

export default function ToolOptions(props: {
  state: EditorState;
  onCommand: (id: string, source: string) => void;
  onTool: (id: string) => void;
  onMapPaint: (patch: Partial<EditorState['mapPaint']>) => void;
  onSnap: () => void;
  onFloor: (delta: number) => void;
  /** toggle hiding the ACTIVE floor's walls (storey cutaway extra, req_2567) */
  onWallsDown: () => void;
  onViewMode: (mode: ViewMode) => void;
  /** The paint controls segment (AppFrame builds it — ink/size/flow/shape/resolution).
   *  THIS action bar is the toolbar paint tools belong to (req_2552: the row where the
   *  Paint/Vertex/wireframe buttons live), rendered while painting a model. */
  paintBar?: any;
  /** Explicit outliner selection size. A 2+ part selection owns Merge, so the generic
   *  face-dissolve verb must not be offered for the same host face selection. */
  selectedPartCount: number;
}) {
  const activeDoc = props.state.workspaceDocuments.find((doc) => doc.id === props.state.activeWorkspaceDocumentId)
    ?? props.state.workspaceDocuments[0]!;
  const mergePartsCommand = props.selectedPartCount >= 2 ? commandById('mesh-merge-down') : null;

  if (activeDoc.kind === 'model') {
    return (
      <C.HW_ToolOptions>
        {meshToolCommands().map((command) => {
          const active = meshToolActive(command.id, props.state.modelTool);
          const Btn = active ? C.HW_IconButtonOn : C.HW_IconButton;
          const symLetter = MESH_SYM_LETTER[command.id];
          const SymText = active ? C.HW_PillTextOn : C.HW_PillText;
          return (
            <Fragment key={command.id}>
              {MESH_GROUP_DIVIDER.has(command.id) ? <C.HW_OptionDivider /> : null}
              <Btn tooltip={symLetter ? `${command.name} — edits land mirrored across the ${symLetter} plane` : `${command.name} (${command.key})`} onPress={() => props.onCommand(command.id, 'action bar')}>
                {symLetter
                  ? <SymText>{symLetter}</SymText>
                  : <Icon name={command.icon} size={14} color={accentFor(active ? 'primary' : 'textDim')} />}
              </Btn>
            </Fragment>
          );
        })}
        {/* Contextual topology ops — surface as quick icons only when the edge
            selection makes them valid (also in the right-click context menu). */}
        {meshTopoCommands(props.state.modelTool, props.selectedPartCount).map((command) => (
          <Fragment key={command.id}>
            <C.HW_OptionDivider />
            <C.HW_IconButton tooltip={`${command.name} (${command.key})`} onPress={() => props.onCommand(command.id, 'action bar')}>
              <Icon name={command.icon} size={14} color={accentFor('primary')} />
            </C.HW_IconButton>
          </Fragment>
        ))}
        {mergePartsCommand ? (
          <Fragment key={mergePartsCommand.id}>
            <C.HW_OptionDivider />
            <C.HW_IconButton tooltip={`${mergePartsCommand.name} (${props.selectedPartCount})`} onPress={() => props.onCommand(mergePartsCommand.id, 'action bar')}>
              <Icon name={mergePartsCommand.icon} size={14} color={accentFor('primary')} />
            </C.HW_IconButton>
          </Fragment>
        ) : null}
        {/* The PAINT segment (req_2552) — the full brush controls (fill/brush/pick, ink,
            size, flow, shape, resolution) live HERE in the action bar while painting,
            plus the face-safety pill (the one control the segment doesn't carry). The
            old fill/brush icon pair + DETAIL pill died here: the segment IS those. */}
        {props.state.modelTool.paint && props.paintBar ? (
          <Fragment>
            <C.HW_OptionDivider />
            {props.paintBar}
            <C.HW_Pill tooltip="Face safety — Clip paints the face under the dab; Lock masks the stroke to the pressed face" onPress={() => props.onCommand('mesh-paint-safety', 'action bar')}>
              <C.HW_OptionLabel>SAFE</C.HW_OptionLabel>
              <C.HW_PillText>{props.state.modelTool.safety === 0 ? 'Clip' : 'Lock'}</C.HW_PillText>
            </C.HW_Pill>
          </Fragment>
        ) : null}
      </C.HW_ToolOptions>
    );
  }

  // Map Paint is a tool toggle segment, not a replacement toolbar. Keep the
  // world action bar visible while the viewport dock owns paint options.
  const mapPaint = props.state.mapPaint;
  // Section D follows the armed tool family, never whichever menu or hotkey ran
  // most recently. A report-only floor step therefore cannot replace the Build
  // controls with a dormant Map strip. Permanently unavailable roadmap rows are
  // not user-facing controls and never project into the action bar.
  // Submenu-nested commands (File → New Mesh → the seven primitives, etc.) stay in their
  // menus — mirroring them here dumped a row of context-free primitive icons onto the map
  // bar whenever File was the active menu (req_2646: "why are all these buttons here").
  const actionCommands = worldActionBarCommands(props.state);
  return (
    <C.HW_ToolOptions>
      <MapPaintBar state={mapPaint} onPatch={props.onMapPaint} />
      <C.HW_OptionDivider />
      {actionCommands.map((command) => {
        const Btn = props.state.activeCommandId === command.id ? C.HW_IconButtonOn : C.HW_IconButton;
        return (
          <Btn key={command.id} tooltip={`${command.name} (${command.key})`} onPress={() => command.tool ? props.onTool(command.id) : props.onCommand(command.id, 'action bar')}>
            <Icon name={command.icon} size={14} color={accentFor(props.state.activeCommandId === command.id ? 'primary' : 'textDim')} />
          </Btn>
        );
      })}
      <C.HW_OptionDivider />
      <C.HW_PillOn onPress={props.onSnap}>
        <C.HW_OptionLabel>SNAP</C.HW_OptionLabel>
        <C.HW_PillTextOn>{SNAP_MODES[props.state.snapIndex]}</C.HW_PillTextOn>
      </C.HW_PillOn>
      {/* FLOORCTL req_2485: the ONE floor control — drives the viewport's real
          active storey (the floating Ground chip died with the old world pane).
          Label matches the level vocabulary: Ground, Floor 1, Floor 2, … */}
      <C.HW_IconButton tooltip="Down a floor" onPress={() => props.onFloor(-1)}>
        <C.HW_PillText>▼</C.HW_PillText>
      </C.HW_IconButton>
      <C.HW_Pill tooltip="The active storey — placements land on this floor's slab">
        <Icon name="Layers" size={12} color={accentFor('textSecondary')} />
        <C.HW_PillText>{props.state.floorIndex === 0 ? 'Ground' : `Floor ${props.state.floorIndex}`}</C.HW_PillText>
      </C.HW_Pill>
      <C.HW_IconButton tooltip="Up a floor" onPress={() => props.onFloor(1)}>
        <C.HW_PillText>▲</C.HW_PillText>
      </C.HW_IconButton>
      {/* Storey cutaway (req_2567): floors ABOVE the active storey are always cut
          away; this pill additionally drops the ACTIVE floor's walls so the
          interior is editable (Sims walls-down). */}
      {props.state.wallsDown ? (
        <C.HW_PillOn tooltip="Walls down — this floor's walls are hidden for interior editing. Click to show them." onPress={props.onWallsDown}>
          <C.HW_OptionLabel>WALLS</C.HW_OptionLabel>
          <C.HW_PillTextOn>Down</C.HW_PillTextOn>
        </C.HW_PillOn>
      ) : (
        <C.HW_Pill tooltip="Walls up — click to hide this floor's walls (floors above are always cut away)." onPress={props.onWallsDown}>
          <C.HW_OptionLabel>WALLS</C.HW_OptionLabel>
          <C.HW_PillText>Up</C.HW_PillText>
        </C.HW_Pill>
      )}
      <C.HW_Spacer />
      {(['3D', '2D'] as ViewMode[]).map((mode) => {
        const Pill = props.state.viewMode === mode ? C.HW_PillOn : C.HW_Pill;
        const Label = props.state.viewMode === mode ? C.HW_PillTextOn : C.HW_PillText;
        return <Pill key={mode} onPress={() => props.onViewMode(mode)}><Label>{mode}</Label></Pill>;
      })}
    </C.HW_ToolOptions>
  );
}
