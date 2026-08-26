// SECTION G — Focus Panel (see shell/regions.ts SECTIONS): the contextual focus
// body + its persistent pane rail. The active rail button folds the body away.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, Row, ScrollView } from '@reactjit/runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
// Fixed-region contract (req_2627): the UV preview sizes itself from the focus
// panel's CONSTANT inner width — imported, never measured.
import { REGIONS } from '../shell/regions';
import type { ModelFocusBridge } from '../stage/ModelView';
import { commandById } from '../data/commands';
import { FLOORS, PRESETS, SNAP_MODES, effectiveModelPackage } from '../data/content';
import { resolvedPanelId, resolvedPanelIdOrNull, rightPanelsFor, type RightPanelId } from '../data/panelSystem';
import { WORLD_VIEW_SLOT_COUNT } from '../data/keymap';
import { objectMetricRows } from '../data/readouts';
import type { Asset, EditorState, ModelTextureSlot, WorkspaceDocumentKind, WorldObject } from '../data/types';
import type { MaterialRef } from '../world/pieces';
import type { WorldView } from '../world/worldViews';
import { assetByIdOrNull, resolveMaterialRef } from '../data/catalog';
import ReadOnlySection from './ReadOnlySection';
import FocusEmpty from './FocusEmpty';
import RigSection from './RigSection';
import CharacterRigSection from './CharacterRigSection';
import { skeletonToPropRig, type CharacterRigApi, type CharacterRigSnapshot, type HumanoidSemanticMembership, type PropRig } from '../../../runtime/skeleton';
import PieceBody, { type PieceEditHandlers } from './PieceBody';
import GlobalsSection from './GlobalsSection';
import GcStressSection from './GcStressSection';
import PresetSection from './PresetSection';
import ModelDetailBody from '../library/ModelDetailBody';
import ModelPaintVariants from '../library/ModelPaintVariants';
import NamesPanel from './NamesPanel';
import type { ColorSpineHandlers } from './ModelBrushDock';
import ModelOutliner from '../stage/ModelOutliner';
import WorldOutliner, { type WorldOutlinerHandlers } from '../stage/WorldOutliner';
import BlobExplorerSurface, {
  type BlobExplorerSurfaceProps,
} from '../stage/BlobExplorerSurface';
import type { OutlinerHandlers } from '../stage/ModelDocumentSurface';
import type { Brush } from '../../../runtime/paint/model';
import UvEditor from './UvEditor';
import { UV_WORKSPACE_FLEX_STYLE, uvWorkspaceLayout, type UvWorkspaceLayout } from './uvWorkspace';
import { useFocusPanelResize } from './focusPanelResize';
import type { LightRig } from '../model/editMesh';
import { blobViewportFaceSelection } from '../model/blobExplorerState';
import { semanticHorizonLines, type ModelFocusSemantics } from '../model/modelSemanticsFocus';
import { hasCharacterRigCapability } from '../skeleton/characterRigCapability';
import { ModelIdentityHeader, PartSection, SelectionSection, ShapeSection } from './ModelFocusSections';
import LabInspectorPanel from './LabInspectorPanel';
import BlueprintStatsPanel from './BlueprintStatsPanel';

// ── Model-focus bridge (req_2643 OO / req_2618 G): the model viewer publishes the
// UV-atlas + SHAPE truth on globalThis.__modelFocusBridge and pings
// __modelFocusBridgeChanged (the same global-door pattern as __modelPartRangesChanged).
// This hook subscribes so the focus panel re-reads on every ping — no AppFrame plumbing.
function useModelFocusBridge(): ModelFocusBridge | null {
  const [snap, setSnap] = useState<ModelFocusBridge | null>(() => ((globalThis as any).__modelFocusBridge ?? null));
  useEffect(() => {
    (globalThis as any).__modelFocusBridgeChanged = () => setSnap((globalThis as any).__modelFocusBridge ?? null);
    return () => { (globalThis as any).__modelFocusBridgeChanged = undefined; };
  }, []);
  return snap;
}

// SELECTION / SHAPE / PART / identity all moved to ModelFocusSections (req_4392,
// the Model Focus Handoff design): boxed-cell editing, collapsible selection
// groups, empty-section collapse. One import, no local twins.

function SemanticsSection({ semantics, onRefresh, onOpenNames }: {
  semantics: ModelFocusSemantics;
  onRefresh: () => void;
  /** The region list lives in its own pane now — this row goes there instead of
   *  printing a second, smaller copy of it (req_3889). */
  onOpenNames: () => void;
}) {
  const statusLabel = semantics.status === 'healthy' ? 'RESIDENT'
    : semantics.status === 'visibility-filtered' ? 'HIDDEN PARTS'
    : semantics.status === 'mount-mismatch' ? 'MOUNT DROP'
    : semantics.status === 'load-mismatch' ? 'LOAD MISMATCH'
      : semantics.status === 'resident-only' ? 'LIVE ONLY'
        : 'NO NAMES';
  const statusTone = semantics.status === 'healthy' || semantics.status === 'visibility-filtered' ? 'success'
    : semantics.status === 'load-mismatch' || semantics.status === 'mount-mismatch' ? 'warning'
      : 'textFaint';
  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar />
        <C.HW_SectionTitle>SEMANTICS</C.HW_SectionTitle>
        <C.HW_Spacer />
        <C.HW_Tag style={{ backgroundColor: accentFor(statusTone) }}>
          <C.HW_TagText>{statusLabel}</C.HW_TagText>
        </C.HW_Tag>
        <C.HW_MiniVerb onPress={onRefresh} tooltip="Re-read semantic names from the resident native mesh">
          <Icon name="RefreshCw" size={10} color={accentFor('textDim')} />
        </C.HW_MiniVerb>
      </C.HW_SectionHead>
      {semanticHorizonLines(semantics).map((line) => (
        <C.HW_ReadRow key={line.label}>
          <C.HW_FormLabel>{line.label}</C.HW_FormLabel>
          <C.HW_ReadValue>{line.value}</C.HW_ReadValue>
        </C.HW_ReadRow>
      ))}
      {semantics.status === 'mount-mismatch' ? (
        <C.HW_ReadRow>
          <C.HW_FormLabel>diagnosis</C.HW_FormLabel>
          <C.HW_ReadValue>viewport input dropped them</C.HW_ReadValue>
        </C.HW_ReadRow>
      ) : semantics.status === 'load-mismatch' ? (
        <C.HW_ReadRow>
          <C.HW_FormLabel>diagnosis</C.HW_FormLabel>
          <C.HW_ReadValue>native hydration lost them</C.HW_ReadValue>
        </C.HW_ReadRow>
      ) : semantics.status === 'visibility-filtered' ? (
        <C.HW_ReadRow>
          <C.HW_FormLabel>diagnosis</C.HW_FormLabel>
          <C.HW_ReadValue>hidden parts, names intact</C.HW_ReadValue>
        </C.HW_ReadRow>
      ) : null}
      {semantics.rows.length > 0 ? (
        <C.HW_ReadRow>
          <C.HW_FormLabel>names</C.HW_FormLabel>
          <Pressable
            onPress={onOpenNames}
            tooltip="Open the NAMES pane — the full region list, each row selecting its faces"
            style={{ flexGrow: 1, minWidth: 0, height: REGIONS.grid.rowHeight, flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <C.HW_ReadValue style={{ color: accentFor('primary') }}>{`${semantics.rows.length} in the NAMES pane →`}</C.HW_ReadValue>
          </Pressable>
        </C.HW_ReadRow>
      ) : null}
    </C.HW_Section>
  );
}

// UV — the atlas section relocated INTO the focus panel from the floating viewport
// card (req_2643 OO). The header carries the active OUTLINER part's name (req_2619 P:
// the UV read is per-outliner even while storage stays whole-model) plus the dims/
// density readout on one line. Atlas pixels are a raw Paintable substrate; every
// island remains live selectable geometry above it, including off-part islands.
// extraCount is the multi-select overflow (req_2659d): 'CUBE 1 +2' = primary + 2 more.
function UvSection({
  bridge,
  partName,
  extraCount,
  workspace,
  onToggleFocus,
}: {
  bridge: ModelFocusBridge | null;
  partName: string;
  extraCount: number;
  workspace: UvWorkspaceLayout;
  onToggleFocus: () => void;
}) {
  const uv = bridge?.uv ?? null;
  const FocusVerb = workspace.focused ? C.HW_UvFocusVerbOn : C.HW_UvFocusVerb;
  return (
    <C.HW_Section style={{ ...UV_WORKSPACE_FLEX_STYLE, flexDirection: 'column' }}>
      <C.HW_SectionHead>
        <C.HW_AccentBar />
        <C.HW_SectionTitle>{`UV · ${partName.toUpperCase()}${extraCount > 0 ? ` +${extraCount}` : ''}`}</C.HW_SectionTitle>
        <C.HW_Spacer />
        <C.HW_ReadValue>{uv ? `${uv.w}×${uv.h} · ${uv.detail} x/m target` : '—'}</C.HW_ReadValue>
        <FocusVerb onPress={onToggleFocus} tooltip={workspace.toggleTooltip}>
          <Icon name={workspace.focused ? 'Minimize2' : 'Maximize2'} size={10} color={accentFor(workspace.focused ? 'primary' : 'textDim')} />
          <C.HW_UvFocusVerbText>{workspace.toggleLabel}</C.HW_UvFocusVerbText>
        </FocusVerb>
        <C.HW_MiniVerb onPress={() => bridge?.refreshUv()} tooltip="Re-read the live paint atlas">
          <Icon name="RefreshCw" size={10} color={accentFor('textDim')} />
        </C.HW_MiniVerb>
      </C.HW_SectionHead>
      {uv && uv.hasAtlas && bridge ? (
        <UvEditor uv={uv} bridge={bridge} focused={workspace.focused} />
      ) : workspace.emptyState === 'workspace' ? (
        <C.HW_UvEmptyWorkspace>
          <C.HW_UvEmptyTitle>NO UV ATLAS</C.HW_UvEmptyTitle>
          <C.HW_UvEmptyCopy>{uv?.note ?? 'Use Paint or import a texture to create the editable atlas.'}</C.HW_UvEmptyCopy>
        </C.HW_UvEmptyWorkspace>
      ) : uv ? (
        <C.HW_ReadRow>
          <C.HW_UvNote>{uv.note ?? 'no atlas'}</C.HW_UvNote>
        </C.HW_ReadRow>
      ) : (
        <C.HW_ReadRow>
          <C.HW_FormLabel>atlas</C.HW_FormLabel>
          <C.HW_ReadValue>none saved — use Paint to create one</C.HW_ReadValue>
        </C.HW_ReadRow>
      )}
      {workspace.showScope ? (
        <C.HW_ReadRow>
          <C.HW_FormLabel>scope</C.HW_FormLabel>
          <C.HW_ReadValue>{uv?.scope ?? 'whole model'}</C.HW_ReadValue>
        </C.HW_ReadRow>
      ) : null}
    </C.HW_Section>
  );
}

// ── VIEW BOOKMARKS (req_3074) ───────────────────────────────────────────────────────
// The camera bookmark list, directly below the UV card. Pins come from the viewer (the
// action-bar Store View verb or the + here); clicking a row jumps the camera back to
// that pose, the trash verb drops it. The active row (last stored/recalled — what the
// H key returns to) carries the primary accent. List truth is view state in the
// viewer's hot twig: it survives hot reloads and resets on a cold start.
function ViewBookmarksSection({ bridge }: { bridge: ModelFocusBridge | null }) {
  const marks = bridge?.camMarks ?? [];
  // Empty state is ONE header line (req_4392): the section never reserves body
  // space it has nothing to say in — the + verb is the whole affordance.
  return (
    <C.HW_Section>
      <C.HW_SectionHead style={marks.length === 0 ? { marginBottom: 0 } : {}}>
        <C.HW_AccentBar style={marks.length === 0 ? { backgroundColor: accentFor('textFaint') } : {}} />
        <C.HW_SectionTitle style={marks.length === 0 ? { color: accentFor('textFaint') } : {}}>VIEWS</C.HW_SectionTitle>
        {marks.length === 0 ? (
          <C.HW_ReadValue style={{ marginLeft: 4 }}>none</C.HW_ReadValue>
        ) : null}
        <C.HW_Spacer />
        <C.HW_MiniVerb onPress={() => bridge?.camStore()} tooltip="Pin the current camera as a bookmark">
          <Icon name="BookmarkPlus" size={11} color={accentFor('textDim')} />
        </C.HW_MiniVerb>
      </C.HW_SectionHead>
      {marks.map((mark, index) => (
        <Row key={`view-mark-${index}`} style={{ alignItems: 'center', gap: 6, height: REGIONS.grid.rowHeight, width: '100%' }}>
          <Pressable
            onPress={() => bridge?.camRecallAt(index)}
            tooltip="Jump the camera to this view"
            style={{ flexGrow: 1, minWidth: 0, height: REGIONS.grid.rowHeight, flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Icon name="Bookmark" size={11} color={accentFor(mark.active ? 'primary' : 'textDim')} />
            <C.HW_ReadValue>{mark.name}</C.HW_ReadValue>
          </Pressable>
          <C.HW_MiniVerb onPress={() => bridge?.camRemoveAt(index)} tooltip="Remove this bookmark">
            <Icon name="Trash2" size={11} color={accentFor('textDim')} />
          </C.HW_MiniVerb>
        </Row>
      ))}
    </C.HW_Section>
  );
}

/** The world surface's saved-view verbs, mirroring the model surface's bookmark set. */
export type WorldViewHandlers = {
  views: readonly WorldView[];
  activeId: string | null;
  onStore: () => void;
  onRecall: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
};

// ── SAVED VIEWS (req_4168, named + slotted req_4172) ────────────────────────────────
// The world twin of the model surface's bookmark card, and deliberately the same card:
// one editor, one bookmark vocabulary. The difference is what a pin carries and how
// long it lives — a world view restores the ACTIVE STOREY along with the camera, and
// it rides world.json, so a 3 km map still knows your places after a cold restart.
//
// Each row leads with its SLOT NUMBER, because bare 1..9 on the world surface jumps
// straight to that pin: the key is only muscle memory if the panel says which digit
// belongs to which place. Past nine the badge goes quiet rather than lying about a
// key that does nothing.
//
// The name is editable on the ACTIVE row and a jump target on the others — the paint
// layers panel's convention. The bookmark icon jumps on EVERY row, so the active pin
// is still one click away after you have panned off it.
function WorldViewsSection({ handlers }: { handlers: WorldViewHandlers }) {
  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar />
        <C.HW_SectionTitle>VIEWS</C.HW_SectionTitle>
        <C.HW_Spacer />
        <C.HW_MiniVerb onPress={handlers.onStore} tooltip="Pin where you are standing — camera, facing, zoom and storey">
          <Icon name="BookmarkPlus" size={11} color={accentFor('textDim')} />
        </C.HW_MiniVerb>
      </C.HW_SectionHead>
      {handlers.views.length === 0 ? (
        <C.HW_ReadRow>
          <C.HW_FormLabel>saved</C.HW_FormLabel>
          <C.HW_ReadValue>none yet — pin one above</C.HW_ReadValue>
        </C.HW_ReadRow>
      ) : handlers.views.map((view, index) => {
        const active = view.id === handlers.activeId;
        const slot = index < WORLD_VIEW_SLOT_COUNT ? String(index + 1) : '';
        return (
          <Row key={view.id} style={{ alignItems: 'center', gap: 6, height: REGIONS.grid.rowHeight, width: '100%' }}>
            <Pressable
              onPress={() => handlers.onRecall(view.id)}
              tooltip={slot ? `Jump to ${view.name} — floor ${view.floor}, key ${slot}` : `Jump to ${view.name} — floor ${view.floor}`}
              style={{ height: REGIONS.grid.rowHeight, flexDirection: 'row', alignItems: 'center', gap: 5 }}
            >
              <Icon name="Bookmark" size={11} color={accentFor(active ? 'primary' : 'textDim')} />
              <C.HW_ViewSlotKey>{slot}</C.HW_ViewSlotKey>
            </Pressable>
            {active ? (
              <C.HW_RenameInput value={view.name} onChange={(name: string) => handlers.onRename(view.id, name)} />
            ) : (
              <Pressable
                onPress={() => handlers.onRecall(view.id)}
                tooltip={`Jump to ${view.name} — floor ${view.floor}`}
                style={{ flexGrow: 1, minWidth: 0, height: REGIONS.grid.rowHeight, flexDirection: 'row', alignItems: 'center' }}
              >
                <C.HW_ReadValue>{view.name}</C.HW_ReadValue>
              </Pressable>
            )}
            <C.HW_MiniVerb onPress={() => handlers.onRemove(view.id)} tooltip="Remove this view">
              <Icon name="Trash2" size={11} color={accentFor('textDim')} />
            </C.HW_MiniVerb>
          </Row>
        );
      })}
    </C.HW_Section>
  );
}

// The FOCUS PANEL's pane-switch rail — the fixed 40px icon column on the
// panel's right edge (REGIONS.focusPanel.railWidth). One component, every
// branch: the rail is part of the region, not of any one panel mode.
function FocusRail(props: {
  documentKind: WorkspaceDocumentKind;
  labActive: boolean;
  activePane: string;
  collapsed: boolean;
  onPane: (pane: RightPanelId) => void;
}) {
  const panes = rightPanelsFor(props.documentKind, props.labActive);
  const activePane = resolvedPanelId(panes, props.activePane);
  return (
    <C.HW_RightRail>
      {panes.map((pane) => {
        const active = activePane === pane.id;
        const Btn = active ? C.HW_RailButtonOn : C.HW_RailButton;
        return (
          <Btn
            key={pane.id}
            tooltip={active ? `${pane.label} — ${props.collapsed ? 'open panel' : 'collapse panel'}` : `Open ${pane.label}`}
            onPress={() => props.onPane(pane.id)}
          >
            <Icon name={pane.icon} size={14} color={accentFor(active ? 'primary' : 'textDim')} />
          </Btn>
        );
      })}
    </C.HW_RightRail>
  );
}

/**
 * AppFrame owns recovery coordination. When it supplies no contract, keep the
 * seam explicit: the pane is visible and truthful, but every unavailable
 * operation remains disabled and no component reaches for a host global.
 */
function unavailableBlobExplorerProps(modelId: string): BlobExplorerSurfaceProps {
  const detail = 'Recovery coordinator is unavailable in AppFrame.';
  return {
    modelId,
    widthPreset: 'compact',
    onWidthPreset: () => {},
    faceQuery: {
      source: 'resident',
      sort: { column: 'address', direction: 'asc' },
      filters: [],
      cursor: null,
      limit: 200,
    },
    facePage: null,
    faceError: { ok: false, version: 1, code: 'module_unavailable', detail },
    faceLoading: false,
    selectedAddress: null,
    selectedTriangles: null,
    onFaceQueryChange: () => {},
    onSelectFace: () => {},
    history: {
      loading: false,
      error: detail,
      rows: [],
      cursor: null,
      nextCursor: null,
      indexedRepair: 'not_needed',
    },
    recoverySnapshotEnabled: false,
    recoverySnapshotInFlight: false,
    recoverySnapshotStatus: detail,
    onRecoverySnapshot: () => {},
    onHistoryPage: () => {},
    onPin: () => {},
    onPreview: () => {},
    restoreEnabled: false,
    onRestore: () => {},
    service: {
      state: 'blocked',
      library: { available: false, version: null },
      repository: { ready: false, path: 'unavailable', revision: null },
      service: {
        healthy: false,
        healthUrl: 'unavailable',
        httpCode: null,
        unitName: 'unavailable',
        active: false,
        enabled: false,
        journalTail: [detail],
        restoreCommands: [],
      },
      stores: { snapshotRoot: 'unavailable', localBytes: 0, serverBytes: null },
      retention: {
        days: 60,
        nowMs: 0,
        lastPruneMs: null,
        nextPruneMs: null,
        immediatelyExpired: 0,
        localTombstones: 0,
        remotePendingTombstones: 0,
        logicallyRemovedEntries: 0,
        logicallyRemovedBytes: 0,
        physicallyReclaimedBytes: 0,
        remoteWatermark: null,
        legacyUnexpiredPending: 0,
        legacyCorruptPending: 0,
        legacyLayoutCutover: false,
        lastError: detail,
      },
      history: { pushed: 0, local: 0, unknown: 0 },
      probe: { lastCompletedMs: null, lastTransitionMs: null },
    },
  };
}

export default function Inspector(props: {
  state: EditorState;
  animationPanel?: ReactNode;
  /** The selected world object / material, or NULL when the user has selected
   *  nothing. Panels render their designed empty state on null; they never
   *  invent a subject (req_4435). */
  activeObject: WorldObject | null;
  activeAsset: Asset | null;
  onPane: (pane: RightPanelId) => void;
  onCollapse: () => void;
  onPreset: () => void;
  onPresetOption: (preset: string) => void;
  onModelBrush: (brush: Brush) => void;
  // Durable model identity (req_2620 S/T): the model card's editable name writes
  // through AppFrame's one rename path (manifest = disk truth); Save runs the same
  // 'save-snapshot' command as File → Save; onDisk feeds the save-state chip.
  onRenameModel: (id: string, name: string) => void;
  onSaveModel: () => void;
  /** Shoot the current viewport as this model's browser thumbnail (req_4044). */
  onStageThumbnail: () => void;
  /** Report an outcome on the shell status line (req_3894 — refusals must be seen). */
  onStatus: (message: string) => void;
  /** A real Remove happened: mint the capability that lets an emptied semantic
   *  table actually save (req_3898). */
  onSemanticRegionRemoved: () => void;
  /** A dedicated Remove Blueprint action happened; ordinary Save may consume
   * this one-shot capability, while silent loss remains blocked. */
  onBlueprintRemoved: () => void;
  modelOnDisk: boolean;
  // The RIG editor (req_2712/2713): pockets/placements/seats/cover/dynamics on
  // the open model; export compiles the draft into the manifest skeleton.
  onSetModelRig: (pkgId: string, rig: PropRig) => void;
  onSetModelTextureSlots: (pkgId: string, slots: ModelTextureSlot[]) => void;
  onSetModelLights: (pkgId: string, lights: LightRig[]) => void;
  onModelTextureMembershipChanged: (pkgId: string, message: string, dirty?: boolean) => void;
  /** Open the app-root live-material thumbnail picker for a texture slot (req_3401). */
  onOpenLiveMaterialPicker: (pkgId: string, slotIndex: number) => void;
  // World-piece focus-panel material edits — SELECTION-relative (req_3449):
  // the target piece resolves from live state at click time, never from a
  // render snapshot (the Pressable stale-closure law).
  onAssignSlot: (role: string) => void;
  onClearSlot: (role: string) => void;
  // World-piece instance edits (req_3442): the PIECE FOCUS placement/yaw/scale/
  // spin fields + verb row write through the same transaction commands as the
  // viewport gizmo and hotkeys — never a parallel mutation path.
  pieceEdit: PieceEditHandlers;
  // req_3446: the MATERIAL SLOTS `selected` row jumps the left panel to the
  // Materials library — the place the slot-bind material is actually picked.
  onBrowseMaterials: () => void;
  // Saved camera views (req_4168) — the world surface's VIEWS card.
  worldViews: WorldViewHandlers;
  // The world outliner pane's selection/locate verbs (req_4737) — every one
  // lands in the SAME selection state the viewport renders.
  worldOutliner: WorldOutlinerHandlers;
  // The Material Lab document's inspector (req_4406): recipe null = not a Lab
  // document (single-material fallback keeps the ordinary Focus panel).
  lab: {
    recipe: import('../render3d/shaders/recipe').MaterialRecipe | null;
    usage: { world: number; models: number };
    handlers: import('../stage/MaterialLabSurface').LabHandlers;
  };
  // World-globals tuning (GLOBALS req_2770) — the playtest tab's focus panel.
  onSetGlobal: (field: string, value: number) => void;
  onResetGlobal: (field: string) => void;
  colorSpine: ColorSpineHandlers;
  outlinerHandlers: OutlinerHandlers;
  stagePartFocusEnabled: boolean;
  onToggleStagePartFocus: () => void;
  // The outliner multi-select set (req_2659) — row highlights + the UV '+N' header.
  // AppFrame owns it (shell-local, not EditorState); primary stays modelActivePartId.
  selectedPartIds: string[];
  characterRigApi: CharacterRigApi | null;
  characterRigSnapshot: CharacterRigSnapshot | null;
  onCharacterRigSnapshot: (snapshot: CharacterRigSnapshot) => void;
  onCharacterRigMutated: () => void;
  onSelectCharacterRigFaces: (indices: readonly number[]) => number;
  onAssignHumanoidSemantic: (membership: HumanoidSemanticMembership) => void;
  onAttachCharacterRig: (pkgId: string) => void;
  /** AppFrame-owned, already-parsed recovery state and explicit callbacks. */
  blobExplorer?: BlobExplorerSurfaceProps;
}) {
  // Subscribed unconditionally (hook order) — only the MODEL FOCUS branch reads it.
  const focusBridge = useModelFocusBridge();
  const [uvWorkspaceFocused, setUvWorkspaceFocused] = useState(false);
  // Every focus-panel width that the user may drag, keyed by the shape it
  // belongs to. The UV workspace carries two (its panel and its focus shape);
  // MODEL · STATS carries one. They share one gesture so no pane can mint a
  // private minimum (req_4772).
  const panelResize = useFocusPanelResize({
    uvPanel: REGIONS.focusPanel.atlasWidth,
    uvFocus: REGIONS.focusPanel.atlasFocusWidth,
    stats: REGIONS.focusPanel.statsWidth,
  });
  const uvWidthKey = uvWorkspaceFocused ? 'uvFocus' : 'uvPanel';
  const uvWorkspace = uvWorkspaceLayout(uvWorkspaceFocused, panelResize.widths[uvWidthKey]);
  const activeDocument = props.state.workspaceDocuments.find((doc) => doc.id === props.state.activeWorkspaceDocumentId);
  // EFFECTIVE package (req_2620 S): session renames + dupes resolve here, so the
  // card shows the name the next save writes — never a stale synthesized one.
  const activeModel = activeDocument?.kind === 'model'
    ? effectiveModelPackage(activeDocument.sourceId, props.state.modelOverrides, props.state.modelDupes)
    : null;
  const activeCommand = commandById(props.state.activeCommandId);
  const documentKind = activeDocument?.kind ?? 'world';
  // A Lab document (recipe-backed material) swaps the rail set entirely
  // (req_4406): the world-tile Focus panel is NOT in its set.
  const labUiActive = documentKind === 'material' && !!props.lab.recipe;
  // AppFrame only mounts the Inspector for kinds that HAVE a focus rail; this
  // stays defensive so a new document kind cannot crash the shell before its
  // panes exist (req_4435).
  const focusPanes = rightPanelsFor(documentKind, labUiActive);
  const activePane = resolvedPanelIdOrNull(focusPanes, props.state.rightPane) ?? 'inspector';
  // Focus belongs to one model's Paint pane. Leaving that context makes the
  // next Paint visit predictable instead of reviving a workspace from another
  // document or panel.
  useEffect(() => {
    setUvWorkspaceFocused(false);
  }, [activeDocument?.id, activePane]);
  useEffect(() => {
    const publish = props.blobExplorer?.onViewportFaceSelection;
    if (!publish || activePane !== 'recovery' || !activeModel || !focusBridge) return;
    publish(blobViewportFaceSelection(
      focusBridge.readSelection(),
      props.state.modelParts[activeModel.id] ?? [],
    ));
  }, [focusBridge, activePane, activeModel?.id, props.state.modelParts, props.blobExplorer?.modelId]);
  // Below every hook, so the rules of hooks hold: a document kind with no focus
  // panes renders no panel at all rather than an empty rail stub.
  if (focusPanes.length === 0) return null;
  // Collapse removes only the body. The rail remains at the stage edge so the
  // same active button can restore it without a separate hidden affordance.
  if (props.state.rightPanelCollapsed) {
    return <FocusRail documentKind={documentKind} labActive={labUiActive} activePane={activePane} collapsed onPane={props.onPane} />;
  }
  // Material Lab document (req_4406): the right rail's one pane is the Lab
  // inspector — DIALS/PALETTE from the top, FACTS + SAVE pinned to the bottom.
  if (labUiActive && props.lab.recipe) {
    return (
      <C.HW_RightPanel>
        <LabInspectorPanel
          state={props.state}
          recipe={props.lab.recipe}
          usage={props.lab.usage}
          handlers={props.lab.handlers}
          onCollapse={props.onCollapse}
        />
        <FocusRail documentKind={documentKind} labActive={labUiActive} activePane={activePane} collapsed={false} onPane={props.onPane} />
      </C.HW_RightPanel>
    );
  }
  if (activeDocument?.kind === 'animation') {
    return (
      <C.HW_RightPanel>
        {props.animationPanel}
        <FocusRail documentKind={documentKind} labActive={false} activePane={activePane} collapsed={false} onPane={props.onPane} />
      </C.HW_RightPanel>
    );
  }
  const fallbackKind = props.activeObject?.kind ?? 'TILE';
  const pathRows = fallbackKind === 'TILE'
    ? [
      ['walkable', '—'],
      ['surface preset', props.state.surfacePreset],
      ['floor', FLOORS[props.state.floorIndex]!],
    ]
    : fallbackKind === 'PIECE' || fallbackKind === 'PREFAB'
      ? [
        ['collision', 'solid'],
        ['snap domain', SNAP_MODES[props.state.snapIndex]!],
        ['floor', FLOORS[props.state.floorIndex]!],
      ]
      : [
        ['snap domain', SNAP_MODES[props.state.snapIndex]!],
        ['placement', fallbackKind.toLowerCase()],
        ['floor', FLOORS[props.state.floorIndex]!],
      ];
  const visibilityRows = fallbackKind === 'PROP'
    ? [
      ['occlusion', '—'],
      ['bake', '—'],
      ['channel', fallbackKind.toLowerCase()],
    ]
    : [
      ['conceal', '—'],
      ['lightThru', '—'],
      ['soundOcc', '—'],
    ];
  // Playtest surface (GLOBALS req_2770): the focus panel IS the globals editor —
  // tune a field, the playtest viewport pushes it live, the micro-save locks it in.
  if (activeDocument?.kind === 'playtest') {
    return (
      <C.HW_RightPanel>
        <C.HW_Inspector>
          <C.HW_PanelHead>
            <C.HW_Kicker>GLOBALS · PHYSICS</C.HW_Kicker>
            <C.HW_Spacer />
            <C.HW_PanelHeadButton tooltip="Collapse focus panel" onPress={props.onCollapse}>
              <Icon name="PanelRightClose" size={12} color={accentFor('textFaint')} />
            </C.HW_PanelHeadButton>
          </C.HW_PanelHead>
          <C.HW_InspectorBody>
            <GlobalsSection
              physics={props.state.worldGlobals.physics}
              onSet={props.onSetGlobal}
              onReset={props.onResetGlobal}
            />
            <GcStressSection />
          </C.HW_InspectorBody>
        </C.HW_Inspector>
        <FocusRail documentKind={documentKind} labActive={labUiActive} activePane={activePane} collapsed={false} onPane={props.onPane} />
      </C.HW_RightPanel>
    );
  }
  // World OUTLINER pane (req_4737): everything placed on the map as one grouped
  // tree, sharing the exact selection state the world Focus panel and viewport
  // already render.
  if (activeDocument?.kind === 'world' && activePane === 'outliner') {
    return (
      <C.HW_RightPanel>
        <C.HW_Inspector>
          <C.HW_PanelHead>
            <C.HW_Kicker>WORLD · OUTLINER</C.HW_Kicker>
            <C.HW_Spacer />
            <C.HW_PanelHeadButton tooltip="Collapse focus panel" onPress={props.onCollapse}>
              <Icon name="PanelRightClose" size={12} color={accentFor('textFaint')} />
            </C.HW_PanelHeadButton>
          </C.HW_PanelHead>
          <C.HW_InspectorBodyFixed>
            <WorldOutliner
              architecture={props.state.architecture}
              pieces={props.state.worldPieces}
              worldFlora={props.state.worldFlora}
              floraSpecies={props.state.authoredFloraSpecies}
              markers={props.state.worldMarkers}
              selectedPieceIds={props.state.selectedPieceIds}
              architectureSelection={props.state.architectureSelection}
              selectedFloraPatchId={props.state.selectedFloraPatchId}
              selectedWorldMarkerId={props.state.selectedWorldMarkerId}
              handlers={props.worldOutliner}
            />
          </C.HW_InspectorBodyFixed>
        </C.HW_Inspector>
        <FocusRail documentKind={documentKind} labActive={labUiActive} activePane={activePane} collapsed={false} onPane={props.onPane} />
      </C.HW_RightPanel>
    );
  }
  // World surface (req_2563): the focus panel is PIECE-aware — the real placed
  // piece (Select/Focus) or the armed catalog piece (Build), NOT the phantom
  // `objects` mock. This is what retires the "AC & Vents" ghost header.
  if (activeDocument?.kind === 'world') {
    const selectedPiece = props.state.worldPieces.find((p) => p.id === props.state.selectedPieceId) ?? null;
    const resolveMaterial = (ref: MaterialRef) => resolveMaterialRef(ref, props.state.assetOverrides);
    const activeMaterialAsset = assetByIdOrNull(props.state.activeAssetId, props.state.assetOverrides);
    // Neither a placed piece selected nor a palette piece armed: there is no
    // subject, so the panel says what it shows and how to fill it (req_4435).
    const worldFocusEmpty = !selectedPiece && !props.state.armedPieceId;
    return (
      <C.HW_RightPanel>
        <C.HW_Inspector>
          <C.HW_PanelHead>
            <C.HW_Kicker>{selectedPiece ? 'PIECE FOCUS' : worldFocusEmpty ? 'WORLD FOCUS' : 'BUILD'}</C.HW_Kicker>
            <C.HW_Spacer />
            <C.HW_PanelHeadButton tooltip="Collapse focus panel" onPress={props.onCollapse}>
              <Icon name="PanelRightClose" size={12} color={accentFor('textFaint')} />
            </C.HW_PanelHeadButton>
          </C.HW_PanelHead>
          <C.HW_InspectorBody>
            {worldFocusEmpty ? (
              <FocusEmpty
                shows="Piece focus"
                fill="click a placed piece, or arm one from the build bar"
                icon="Boxes"
              />
            ) : <PieceBody
              armedPieceId={props.state.armedPieceId}
              selected={selectedPiece}
              onAssignSlot={props.onAssignSlot}
              onClearSlot={props.onClearSlot}
              resolveMaterial={resolveMaterial}
              activeMaterial={activeMaterialAsset ? { name: activeMaterialAsset.name, color: activeMaterialAsset.color } : null}
              onBrowseMaterials={props.onBrowseMaterials}
              edit={props.pieceEdit}
              // Session renames/dupes resolve here so the model row names what
              // the library shows NOW, not a stale synthesized id.
              modelNameFor={(pkgId) => effectiveModelPackage(pkgId, props.state.modelOverrides, props.state.modelDupes)?.name ?? null}
            />}
            <WorldViewsSection handlers={props.worldViews} />
          </C.HW_InspectorBody>
        </C.HW_Inspector>
        <FocusRail documentKind={documentKind} labActive={labUiActive} activePane={activePane} collapsed={false} onPane={props.onPane} />
      </C.HW_RightPanel>
    );
  }
  if (activeModel) {
    const blobExplorer = props.blobExplorer?.modelId === activeModel.id
      ? props.blobExplorer
      : unavailableBlobExplorerProps(activeModel.id);
    const quickRecoveryEnabled = blobExplorer.recoverySnapshotEnabled && !blobExplorer.recoverySnapshotInFlight;
    const quickRecoverySnapshot = () => blobExplorer.onRecoverySnapshot({
      kind: 'panic',
      label: 'Manual recovery snapshot',
      push: false,
    });
    const hasCharacterRig = hasCharacterRigCapability(activeModel);
    const residentHumanoidSemanticRoles = (focusBridge?.semantics.rows ?? [])
      .filter((row) => row.presence === 'resident' || row.presence === 'not-visible')
      .map((row) => row.role)
      .filter((role) => role.length > 0);
    const modelDirty = Boolean(props.state.modelDirty[activeModel.id]);
    // The ACTIVE outliner part labels the UV section header (req_2619 P): the UV read
    // is per-outliner even while the atlas storage stays whole-model.
    const modelParts = props.state.modelParts[activeModel.id];
    const activePart = modelParts?.find((p) => p.id === props.state.modelActivePartId) ?? null;
    const uvPartName = activePart?.name ?? activeModel.name;
    // Multi-select (req_2659): the set pruned to live rows; extras beyond the primary
    // surface as '+N' in the UV header, and every member's row highlights.
    const selectedSet = (props.selectedPartIds ?? []).filter((sid) => modelParts?.some((p) => p.id === sid));
    const uvExtraCount = activePart ? Math.max(0, selectedSet.filter((sid) => sid !== activePart.id).length) : 0;
    const paneTitle = activePane === 'paint' ? uvWorkspace.panelTitle
      : activePane === 'rig' ? (hasCharacterRig ? 'CHARACTER · RIG' : 'MODEL · RIG')
        : activePane === 'stats' ? 'MODEL · STATS'
        : activePane === 'names' ? 'MODEL · NAMES'
          : activePane === 'recovery' ? 'MODEL · RECOVERY'
            : 'MODEL FOCUS';
    // The panes whose content is a workspace, not a fact list, wear the drag
    // grip. Everything else keeps the fixed prop-inspector width.
    const resizableWidthKey = activePane === 'paint' ? uvWidthKey
      : activePane === 'stats' ? 'stats' as const
        : null;
    return (
      <C.HW_RightPanel style={{ width: activePane === 'paint'
        ? uvWorkspace.panelWidth
        : activePane === 'stats'
          ? panelResize.widths.stats
          : activePane === 'rig' && hasCharacterRig
            ? REGIONS.focusPanel.characterRigWidth
            : activePane === 'recovery'
              ? blobExplorer.widthPreset === 'wide'
                ? REGIONS.focusPanel.blobWideWidth
                : REGIONS.focusPanel.blobCompactWidth
              : REGIONS.focusPanel.width }}>
        {resizableWidthKey ? (
          <C.HW_RightResizeGrip
            tooltip={activePane === 'paint' ? 'Drag to resize the UV workspace' : 'Drag to resize the blueprint form'}
            {...panelResize.grip(resizableWidthKey)}
            style={panelResize.resizing ? { backgroundColor: accentFor('segActiveBg') } : undefined}
          >
            <C.HW_RightResizeLine />
          </C.HW_RightResizeGrip>
        ) : null}
        <C.HW_Inspector>
          <C.HW_PanelHead>
            <C.HW_Kicker>{paneTitle}</C.HW_Kicker>
            <C.HW_Spacer />
            {activePane === 'paint' && uvWorkspace.focused ? (
              <>
                <C.HW_PanelHeadButton tooltip="Capture native-resident recovery snapshot (does not invoke Save)" onPress={quickRecoveryEnabled ? quickRecoverySnapshot : undefined}>
                  <Icon name="DatabaseBackup" size={12} color={accentFor(quickRecoveryEnabled ? 'warning' : 'textFaint')} />
                </C.HW_PanelHeadButton>
                <C.HW_PanelHeadButton tooltip={`Save ${activeModel.name}`} onPress={props.onSaveModel}>
                  <Icon name="Save" size={12} color={accentFor(modelDirty ? 'warning' : 'textFaint')} />
                </C.HW_PanelHeadButton>
              </>
            ) : null}
            <C.HW_PanelHeadButton tooltip="Collapse focus panel" onPress={props.onCollapse}>
              <Icon name="PanelRightClose" size={12} color={accentFor('textFaint')} />
            </C.HW_PanelHeadButton>
          </C.HW_PanelHead>
          {/* Each model pane remains a fixed column of budgeted slices (req_2627).
              Lists carry their own bounded scrolling; switching panes replaces the
              body instead of stacking every authoring concern into one column. */}
          <C.HW_InspectorBodyFixed style={activePane === 'recovery'
            ? { paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0, gap: 0 }
            : {}}>
            {/* Identity + save state stay present across Model/Paint/Rig. UV Focus
                replaces the tall rows with the compact header save verb above. */}
            {activePane !== 'recovery' && (uvWorkspace.showIdentity || activePane !== 'paint') ? (
              <ModelIdentityHeader
                model={activeModel}
                onRename={props.onRenameModel}
                onStageThumbnail={props.modelOnDisk ? props.onStageThumbnail : undefined}
                onDisk={props.modelOnDisk}
                dirty={modelDirty}
                revision={blobExplorer.service.repository.revision}
                recoverEnabled={quickRecoveryEnabled}
                onRecover={quickRecoverySnapshot}
                onSave={props.onSaveModel}
              />
            ) : null}
            {activePane === 'recovery' ? (
              <BlobExplorerSurface {...blobExplorer} />
            ) : activePane === 'inspector' ? (
              <>
                <SelectionSection
                  selection={focusBridge?.readSelection() ?? null}
                  semantics={focusBridge?.semantics ?? null}
                  bridge={focusBridge}
                  onOpenNames={() => props.onPane('names')}
                />
                <ShapeSection
                  shape={focusBridge?.shape ?? null}
                  bridge={focusBridge}
                  onSelectAudit={(kind) => focusBridge?.selectAuditFaces(kind)}
                />
                {focusBridge ? (
                  <SemanticsSection
                    semantics={focusBridge.semantics}
                    onRefresh={focusBridge.refreshSemantics}
                    onOpenNames={() => props.onPane('names')}
                  />
                ) : null}
                {activePart ? (
                  <PartSection modelId={activeModel.id} part={activePart} bridge={focusBridge} />
                ) : null}
                {/* The OUTLINER is geometry/selection focus, not rig or paint state. */}
                {modelParts ? (
                  <ModelOutliner
                    parts={modelParts}
                    activeId={props.state.modelActivePartId}
                    selectedIds={selectedSet}
                    semantics={focusBridge?.semantics ?? null}
                    bridge={focusBridge}
                    stageFocusEnabled={props.stagePartFocusEnabled}
                    onToggleStageFocus={props.onToggleStagePartFocus}
                    onSelect={props.outlinerHandlers.onSelectPart}
                    onFocusSelectionOwner={props.outlinerHandlers.onFocusSelectionOwner}
                    onRename={props.outlinerHandlers.onRenamePart}
                    onToggleVisible={props.outlinerHandlers.onToggleVisiblePart}
                    onDuplicate={props.outlinerHandlers.onDuplicatePart}
                    onDelete={props.outlinerHandlers.onDeletePart}
                    onSelectGroup={props.outlinerHandlers.onSelectPartGroup}
                    onRenameGroup={props.outlinerHandlers.onRenamePartGroup}
                    onToggleVisibleGroup={props.outlinerHandlers.onToggleVisiblePartGroup}
                    onDuplicateGroup={props.outlinerHandlers.onDuplicatePartGroup}
                    onDissolveGroup={props.outlinerHandlers.onDissolvePartGroup}
                    onGroupSelected={props.outlinerHandlers.onGroupSelectedParts}
                    onUngroupSelected={props.outlinerHandlers.onUngroupSelectedParts}
                    onMoveItem={props.outlinerHandlers.onMoveOutlinerItem}
                    onAdd={props.outlinerHandlers.onAddPart}
                    onImportModel={props.outlinerHandlers.onImportModel}
                    roleNamer={activeModel.kind === 'vehicle' ? props.outlinerHandlers.roleNamer : null}
                    onStartRoleNamer={activeModel.kind === 'vehicle' ? props.outlinerHandlers.onStartRoleNamer : undefined}
                    onSkipRole={props.outlinerHandlers.onSkipRole}
                    onCancelRoleNamer={props.outlinerHandlers.onCancelRoleNamer}
                  />
                ) : null}
                <ViewBookmarksSection bridge={focusBridge} />
                {/* Authored atlas sets keep their surface below the fold; the
                    identity header above already owns the thumb/name card. */}
                <ModelDetailBody model={activeModel} headerless />
              </>
            ) : activePane === 'paint' ? (
              <>
                <UvSection
                  bridge={focusBridge}
                  partName={uvPartName}
                  extraCount={uvExtraCount}
                  workspace={uvWorkspace}
                  onToggleFocus={() => setUvWorkspaceFocused((value) => !value)}
                />
                <ModelPaintVariants key={activeModel.id} model={activeModel} bridge={focusBridge} hidden={!uvWorkspace.showPaintVariants} />
              </>
            ) : activePane === 'stats' ? (
              <BlueprintStatsPanel
                bridge={focusBridge}
                model={activeModel}
                activePart={activePart}
                onStatus={props.onStatus}
                onBlueprintRemoved={props.onBlueprintRemoved}
              />
            ) : activePane === 'names' ? (
              <NamesPanel
                semantics={focusBridge?.semantics ?? null}
                bridge={focusBridge}
                onRefresh={() => focusBridge?.refreshSemantics()}
                onStatus={props.onStatus}
                onRegionRemoved={props.onSemanticRegionRemoved}
              />
            ) : hasCharacterRig ? (
              <CharacterRigSection
                api={props.characterRigApi}
                snapshot={props.characterRigSnapshot}
                onSnapshot={props.onCharacterRigSnapshot}
                onStatus={props.onStatus}
                onMutated={props.onCharacterRigMutated}
                onSelectDetachedFaces={props.onSelectCharacterRigFaces}
                semanticRoleKeys={residentHumanoidSemanticRoles}
                onAssignSemanticRole={props.onAssignHumanoidSemantic}
              />
            ) : (
              <>
                <C.HW_RigSection>
                  <C.HW_SectionHead>
                    <C.HW_AccentBar style={{ backgroundColor: accentFor('active') }} />
                    <C.HW_SectionTitle>CHARACTER RIGGING</C.HW_SectionTitle>
                  </C.HW_SectionHead>
                  <C.HW_RigNotice>
                    <C.HW_RigNoticeLabel>OPTIONAL CAPABILITY</C.HW_RigNoticeLabel>
                    <C.HW_RigWrapText>
                      Attach the canonical humanoid skeleton to this model without replacing its geometry or changing its model category. Choose Player or NPC only when exporting.
                    </C.HW_RigWrapText>
                  </C.HW_RigNotice>
                  <C.HW_ButtonRow>
                    <C.HW_VerbPrimary tooltip="keep this mesh and add the independent humanoid bind skeleton" onPress={() => props.onAttachCharacterRig(activeModel.id)}>
                      <C.HW_VerbText>Add Humanoid Rig</C.HW_VerbText>
                    </C.HW_VerbPrimary>
                  </C.HW_ButtonRow>
                </C.HW_RigSection>
                <RigSection
                  rig={props.state.modelRigs[activeModel.id] ?? (activeModel.skeleton ? skeletonToPropRig(activeModel.skeleton) : {})}
                  onChange={(rig) => props.onSetModelRig(activeModel.id, rig)}
                  textureSlots={props.state.modelTextureSlots[activeModel.id] ?? activeModel.textureSlots ?? []}
                  onTextureSlotsChange={(slots) => props.onSetModelTextureSlots(activeModel.id, slots)}
                  onTextureMembershipChanged={(message, dirty) => props.onModelTextureMembershipChanged(activeModel.id, message, dirty)}
                  onPickLiveMaterial={(slotIndex) => props.onOpenLiveMaterialPicker(activeModel.id, slotIndex)}
                  lights={props.state.modelLights[activeModel.id] ?? activeModel.lights ?? []}
                  onLightsChange={(lights) => props.onSetModelLights(activeModel.id, lights)}
                />
              </>
            )}
          </C.HW_InspectorBodyFixed>
        </C.HW_Inspector>
        <FocusRail documentKind={documentKind} labActive={labUiActive} activePane={activePane} collapsed={false} onPane={props.onPane} />
      </C.HW_RightPanel>
    );
  }
  // The FALLBACK branch — a document kind with no focus panel of its own
  // (a plain material document, a facade). It used to render a synthetic TILE
  // object full of em-dash filler rows, driven by the placeholder that
  // selectedObject() invented when nothing was selected. With no subject there
  // is nothing to describe, so it says so (req_4435).
  const fallbackObject = props.activeObject;
  const fallbackAsset = props.activeAsset;
  return (
    <C.HW_RightPanel>
      <C.HW_Inspector>
        <C.HW_PanelHead>
          <C.HW_Kicker>{`${documentKind.toUpperCase()} FOCUS`}</C.HW_Kicker>
          <C.HW_Spacer />
          <C.HW_PanelHeadButton tooltip="Collapse focus panel" onPress={props.onCollapse}>
            <Icon name="PanelRightClose" size={12} color={accentFor('textFaint')} />
          </C.HW_PanelHeadButton>
        </C.HW_PanelHead>
        {!fallbackObject ? (
          <FocusEmpty
            shows={`${documentKind} focus`}
            fill="select something on the stage, or pick an asset in the drawer"
          />
        ) : (
          <>
            <C.HW_ObjectHead>
              <C.HW_Tag><C.HW_TagText>{fallbackObject.kind}</C.HW_TagText></C.HW_Tag>
              <C.HW_ObjectTitle>{fallbackObject.name}</C.HW_ObjectTitle>
              <C.HW_Spacer />
              {fallbackAsset ? <C.HW_Swatch style={{ backgroundColor: fallbackAsset.color }} /> : null}
            </C.HW_ObjectHead>
            <C.HW_MetricRow>
              {objectMetricRows(props.state, fallbackObject).map(([label, value]) => (
                <C.HW_Metric key={label}>
                  <C.HW_MetricValue>{value}</C.HW_MetricValue>
                  <C.HW_MetricLabel>{label}</C.HW_MetricLabel>
                </C.HW_Metric>
              ))}
            </C.HW_MetricRow>
            <ReadOnlySection title={`${fallbackObject.kind} FACTS`} color="primary" rows={[
              ['asset', fallbackAsset ? fallbackAsset.name : 'none selected'],
              ['tool', activeCommand.name],
              ['key', activeCommand.key],
            ]} />
            {fallbackObject.kind === 'TILE' ? (
              <PresetSection
                title="SURFACE DEFAULTS"
                color="warning"
                active={props.state.surfacePreset}
                options={PRESETS}
                open={props.state.presetMenuOpen}
                onPreset={props.onPreset}
                onOption={props.onPresetOption}
                rows={[
                  ['actual friction', '—'],
                  ['actual speed factor', '—'],
                ]}
              />
            ) : null}
            <ReadOnlySection title="PLACEMENT" color="primary" rows={pathRows} />
            <ReadOnlySection title="VISIBILITY" color="primary" rows={visibilityRows} />
          </>
        )}
      </C.HW_Inspector>
      <FocusRail documentKind={documentKind} labActive={labUiActive} activePane={activePane} collapsed={false} onPane={props.onPane} />
    </C.HW_RightPanel>
  );
}
