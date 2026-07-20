// SECTION D — Action Bar (see shell/regions.ts SECTIONS): THE toolbar — the
// tool row pinned above the stage (mesh tools, snap, floor, paint
// segment, map-paint bar).
import { Fragment } from 'react';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { commandById, meshToolCommands, meshToolActive, meshTopoCommands, worldActionBarCommands } from '../data/commands';
import { SNAP_MODES } from '../data/content';
import type { EditorState } from '../data/types';
import MapPaintBar from './MapPaintBar';
import { Effect } from '../../../runtime/primitives';
import { importedSpecs } from '../textures/shaders';

// Place Sticker (req_3025): the stamp scale presets the rail cycles through.
const STICKER_SCALES = [0.5, 1, 2, 4];

// A model document owns the host-native mesh editor — the toolbar becomes the
// home for its tools (icon-only), with select / gizmo / toggle groups divided.
const MESH_GROUP_DIVIDER = new Set(['mesh-move', 'mesh-sym-x', 'mesh-paint']);
// Live mirror toggles (req_2758) read as their AXIS LETTER — the letter IS the value
// (which plane), the old studio's X/Y/Z mirror-chip treatment.
const MESH_SYM_LETTER: Record<string, string> = { 'mesh-sym-x': 'X', 'mesh-sym-y': 'Y', 'mesh-sym-z': 'Z' };

export default function ToolOptions(props: {
  state: EditorState;
  onCommand: (id: string, source: string) => void;
  onMapPaint: (patch: Partial<EditorState['mapPaint']>) => void;
  /** Place Sticker (req_3025): patch the armed stamp (texture / rot / scale). */
  onStickerArm: (patch: Partial<EditorState['stickerArm']>) => void;
  onSnap: () => void;
  onFloor: (delta: number) => void;
  /** toggle hiding the ACTIVE floor's walls (storey cutaway extra, req_2567) */
  onWallsDown: () => void;
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
      </C.HW_ToolOptions>
    );
  }

  if (activeDoc.kind === 'facade') {
    return <C.HW_ToolOptions />;
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
          <Btn key={command.id} tooltip={`${command.name} (${command.key})`} onPress={() => props.onCommand(command.id, 'action bar')}>
            <Icon name={command.icon} size={14} color={accentFor(props.state.activeCommandId === command.id ? 'primary' : 'textDim')} />
          </Btn>
        );
      })}
      {props.state.activeCommandId === 'place-sticker' ? (
        <Fragment>
          <C.HW_OptionDivider />
          {importedSpecs().map((spec) => {
            const armed = props.state.stickerArm.textureId === spec.id;
            const Swatch = armed ? C.HW_IconButtonOn : C.HW_IconButton;
            return (
              <Swatch key={spec.id} tooltip={`Stamp ${spec.label}`} onPress={() => props.onStickerArm({ textureId: spec.id })}>
                <Effect shader={spec.shader} data={spec.buildData()} style={{ width: 16, height: 16 }} />
              </Swatch>
            );
          })}
          <C.HW_IconButton
            tooltip={`Rotate stamp — ${props.state.stickerArm.rot * 90}°`}
            onPress={() => props.onStickerArm({ rot: (props.state.stickerArm.rot + 1) % 4 })}
          >
            <Icon name="RotateCw" size={14} color={accentFor(props.state.stickerArm.rot === 0 ? 'textDim' : 'primary')} />
          </C.HW_IconButton>
          <C.HW_PillOn
            tooltip="Stamp size — multiplies the sticker's real meter footprint"
            onPress={() => props.onStickerArm({ scale: STICKER_SCALES[(STICKER_SCALES.indexOf(props.state.stickerArm.scale) + 1) % STICKER_SCALES.length] })}
          >
            <C.HW_PillTextOn>{`x${props.state.stickerArm.scale}`}</C.HW_PillTextOn>
          </C.HW_PillOn>
        </Fragment>
      ) : null}
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
    </C.HW_ToolOptions>
  );
}
