// AppFrame — the editor workspace composition root. Owns the (mock) authoring
// state and slots every region component in. Extracted verbatim from the mock
// god-file; only the imports changed (one component per file, shared data/cls).
// State will migrate onto the real foundation systems (editorbus / hot index /
// commands / tunables) incrementally; this is the faithful layout first.
import { useState, useMemo, useEffect, useRef } from 'react';
import { C } from '../workspace.cls';
import Chrome from './Chrome';
import DropdownMenu from './DropdownMenu';
import LeftRail from './LeftRail';
import BuildDock from './BuildDock';
import EventBusPopover from './EventBusPopover';
import BuildJournalDialog from './BuildJournalDialog';
import NewMeshDialog from './NewMeshDialog';
import PerformancePopover from './PerformancePopover';
import MemoryPopover from './MemoryPopover';
import LibraryPanel from '../library/LibraryPanel';
import Workspace from '../stage/Workspace';
import Inspector from '../inspector/Inspector';
import FileExplorerDialog from '../dialogs/FileExplorerDialog';
import ModelContextMenu from '../stage/ModelContextMenu';
import RenderProbe from '../../../runtime/render_tracker';
import PlayRoute from '../PlayRoute';
import { useRoute } from '../../../runtime/router';
import { useContextMenu } from '../../../runtime/hooks/useContextMenu';
import type { EditorState, Command, Asset, WorldObject, ContentFolderId, ColorStudioMaterialKey, ModelOverride, ModelPackage, ModelPart, PrimitiveKind, ModelToolApi, ModelToolSnapshot } from '../data/types';
import type { ExplorerFolderId, ExplorerHistoryEntry } from '../data/fileExplorer';
import { loadPersistedState, persistState } from '../data/persistView';
import { dispatchEdit } from '../data/editorEvents';
import { commandById, isMeshToolCommand, PRIMITIVE_MESHES } from '../data/commands';
import { primitivePartMesh, composeModelParts, storedModelParts, type PrimitiveParams } from '../data/hmscAssetCatalog';
import { ASSETS, applyAssetOverrides, assetById, assetPageSizeFor } from '../data/catalog';
import { selectedObject, panelModeFor, tabForContentFolder, assetMatchesContentFolder, rankAssets, folderForAsset, contentFolderLabel, isModelFolder, modelPackagesForFolder, visibleModelPackages, liveContentTree, primitiveModelPackage, MODEL_GALLERY_PAGE_SIZE, SNAP_MODES, FLOORS } from '../data/content';
import { SHADER_MATERIALS, colorStudioMaterial, colorStudioOverrideKey, QUALITY_LABELS } from '../data/colorStudio';
import { oklchName, type ColorLens } from '../data/colorSpine';
import type { OklchColor } from '../../../runtime/paint/colors';
import { useBuildJournal } from '../data/journal';
import { EXPLORER_FILES, explorerMatchesFolder, explorerFolderLabel, explorerFileById } from '../data/fileExplorer';
import { WORLD_DOCUMENT_ID, materialDocument, modelDocument, upsertDocument } from '../data/documents';

export default function AppFrame() {
  // The shell for BOTH routes. AppFrame stays mounted across the Editor/Play
  // switch (it's rendered directly under <Router>, not swapped by a <Route>), so
  // the top chrome — and its Editor/Play toggle — persists on /play and the
  // authoring state survives a round trip. The body is what swaps: editor panels
  // on /editor, the host-native WorldLoader on /play.
  const { path } = useRoute();
  const playing = path === '/play';
  const [state, setState] = useState<EditorState>(loadPersistedState);
  const { snapshot: journal, actions: journalActions } = useBuildJournal();

  // The embedded model viewer hands its host-native tool handlers up here; the
  // toolbar + context menu remote-control the SAME tools through this ref, and
  // the viewer mirrors its live state back into state.modelTool for highlights.
  const modelToolApiRef = useRef<ModelToolApi | null>(null);

  // The model surface's right-click menu. Lives at the app ROOT (rendered below,
  // as the last child of HW_App) so it lands at the cursor — an absolutely-placed
  // menu positions relative to its parent, and only the root sits at window origin
  // (the stage is offset right by the rail + content browser). The trigger spreads
  // onto the model surface deep in the tree.
  const modelMenu = useContextMenu();

  // Mirror the active view into hot-state so a dev hot reload rehydrates exactly
  // what you were looking at instead of snapping back to defaults.
  useEffect(() => { persistState(state); }, [state]);

  // Board the bus: every recorded edit (state.seq bumps once per edit; undo/redo
  // don't) is dispatched onto the real editorbus door as it happens. history[0] is
  // always the newest entry. The first run just baselines seq so a restored session's
  // prior history isn't re-emitted onto the durable log (req_2424).
  const lastBusSeq = useRef<number | null>(null);
  useEffect(() => {
    if (lastBusSeq.current === null) { lastBusSeq.current = state.seq; return; }
    if (state.seq <= lastBusSeq.current) return;
    lastBusSeq.current = state.seq;
    const latest = state.history[0];
    if (latest) dispatchEdit(latest);
  }, [state.seq]);

  const activeCommand = commandById(state.activeCommandId);
  const activeObject = selectedObject(state);
  const catalogAssets = useMemo(() => applyAssetOverrides(ASSETS, state.assetOverrides), [state.assetOverrides]);
  const activeAsset = assetById(state.activeAssetId, state.assetOverrides);
  const contextPanelMode = panelModeFor(state, activeObject);
  const panelMode = tabForContentFolder(state.contentFolder) ?? contextPanelMode;

  const filteredAssets = useMemo(() => {
    const needle = state.search.trim().toLowerCase();
    return catalogAssets
      .filter((asset) => assetMatchesContentFolder(asset, state.contentFolder))
      .filter((asset) => {
        if (!needle) return true;
        const haystack = [
          asset.name,
          asset.recipe ?? '',
          asset.sourceKind ?? '',
          asset.sourceId ?? '',
          asset.semanticKind ?? '',
          ...(asset.stats ?? []),
        ].join(' ').toLowerCase();
        return haystack.includes(needle);
      })
      .sort(rankAssets);
  }, [catalogAssets, panelMode, state.contentFolder, state.search]);

  // editMs is the REAL measured apply time of this edit (Date.now around the
  // reducer). emptyMs/richMs mirror it — we don't yet measure the empty-vs-rich
  // distinction, so that delta is an honest 0 (never a fabricated number).
  const pushHistory = (prev: EditorState, command: Command, target: string, meta: string, editMs: number): Pick<EditorState, 'history' | 'redo' | 'seq'> => ({
    history: [
      { id: `h-${prev.seq}`, verb: command.name.split(' ')[0]!.toLowerCase(), target, meta, undoable: command.undoable, editMs, emptyMs: editMs, richMs: editMs },
      ...prev.history,
    ].slice(0, 8),
    redo: command.undoable ? [] : prev.redo,
    seq: prev.seq + 1,
  });

  const runCommand = (commandId: string, source: string) => {
    const command = commandById(commandId);
    // Paint resolution (File → Paint Resolution): set exact texels/face on the viewer. The host
    // clamps dense meshes to the atlas budget; the detail readout reflects what actually took.
    if (commandId.startsWith('paint-res-')) {
      const px = Number(commandId.slice('paint-res-'.length));
      const applied = modelToolApiRef.current?.changeDetail(px) ?? px;
      // Shout when the atlas budget clamped the pick — otherwise a plateau at high detail looks
      // like a brush bug when it's really "this mesh has too many faces for that many texels".
      const status = applied < px
        ? `Paint resolution ${px} clamped → ${applied}×${applied} (atlas budget — fewer faces or lower detail for finer than this)`
        : `Paint resolution → ${px}×${px} texels/face`;
      setState((prev) => ({ ...prev, openMenu: null, status }));
      return;
    }
    // Model-surface tools route to the viewer's host-native tool api; the viewer
    // owns the state and reports it back, so we don't mutate world state here.
    if (isMeshToolCommand(commandId)) {
      const api = modelToolApiRef.current;
      if (api) {
        if (commandId === 'mesh-vertex') api.selMode(1);
        else if (commandId === 'mesh-edge') api.selMode(2);
        else if (commandId === 'mesh-face') api.selMode(3);
        else if (commandId === 'mesh-move') api.gizmo(0);
        else if (commandId === 'mesh-scale') api.gizmo(1);
        else if (commandId === 'mesh-rotate') api.gizmo(2);
        else if (commandId === 'mesh-paint') api.paint();
        else if (commandId === 'mesh-focus') api.focus();
        else if (commandId === 'mesh-wire') api.wire();
        else if (commandId === 'mesh-extrude') api.extrudeEdge();
        else if (commandId === 'mesh-create-face') api.createFace();
        else if (commandId === 'mesh-loopcut') api.loopCut();
        else if (commandId === 'mesh-paint-fill') api.brushTool('fill');
        else if (commandId === 'mesh-paint-brush') api.brushTool('brush');
        else if (commandId === 'mesh-paint-safety') api.cycleSafety();
        else if (commandId === 'mesh-paint-detail') api.cycleDetail();
      }
      setState((prev) => ({ ...prev, status: `${command.name} - ${source}` }));
      return;
    }
    // Delete Selection on a model document deletes the mesh selection (not a world object).
    if (command.id === 'delete-selection') {
      const doc = state.workspaceDocuments.find((d) => d.id === state.activeWorkspaceDocumentId);
      if (doc?.kind === 'model') {
        modelToolApiRef.current?.deleteSelection();
        setState((prev) => ({ ...prev, status: 'deleted mesh selection' }));
        return;
      }
    }
    if (command.id === 'undo-local') {
      undoLocal();
      return;
    }
    if (command.id === 'redo-local') {
      redoLocal();
      return;
    }
    if (command.id.startsWith('new-mesh-')) {
      // Don't drop a fixed unit primitive — prompt for its size + resolution FIRST (the old
      // studio mesh editor's add dialog). createPrimitive builds it at the chosen params when
      // the dialog confirms; the part-vs-new-model branch is decided there.
      const kind = command.id.slice('new-mesh-'.length) as PrimitiveKind;
      setState((prev) => ({ ...prev, openMenu: null, actionMenu: 'File', newMeshPrompt: kind }));
      return;
    }
    if (command.id === 'open-map' || command.id === 'open-file-explorer' || command.id === 'find-import-source') {
      setState((prev) => ({
        ...prev,
        openMenu: null,
        actionMenu: 'File',
        fileExplorerOpen: true,
        fileExplorerQuery: command.id === 'find-import-source' ? 'imports' : prev.fileExplorerQuery,
        status: command.id === 'find-import-source'
          ? 'in-app file explorer opened for import search'
          : 'in-app file explorer opened',
      }));
      return;
    }
    if (command.id === 'compile-rle') {
      setState((prev) => ({
        ...prev,
        openMenu: null,
        actionMenu: 'File',
        status: 'compile output unavailable - validation 0/0',
      }));
      return;
    }

    setState((prev) => {
      const t0 = Date.now();
      const object = selectedObject(prev);
      const asset = assetById(prev.activeAssetId, prev.assetOverrides);
      let next: EditorState = {
        ...prev,
        openMenu: source === 'stage' ? prev.openMenu : null,
        actionMenu: command.menu,
        activeCommandId: command.tool ? command.id : prev.activeCommandId,
        status: `${command.name} - ${source}`,
        contextOpen: source === 'context' ? false : prev.contextOpen,
      };

      if (command.id === 'toggle-view-mode') {
        next = { ...next, viewMode: prev.viewMode === '3D' ? '2D' : '3D' };
      } else if (command.id === 'cycle-floor') {
        next = { ...next, floorIndex: (prev.floorIndex + 1) % FLOORS.length };
      } else if (command.id === 'toggle-minimap') {
        next = { ...next, rightPane: prev.rightPane === 'grid' ? 'inspector' : 'grid' };
      } else if (command.id === 'focus-selection') {
        next = { ...next, cursor: { x: object.left, y: 0, z: object.top } };
      } else if (command.id === 'place-piece') {
        const placed: WorldObject = {
          id: `obj-${prev.seq}`,
          kind: asset.tab === 'Props' ? 'PROP' : asset.tab === 'Build' ? 'PIECE' : 'TILE',
          name: asset.name,
          assetId: asset.id,
          left: 160 + (prev.seq % 5) * 42,
          top: 112 + (prev.seq % 4) * 32,
          width: asset.tab === 'Props' ? 42 : 64,
          height: asset.tab === 'Props' ? 30 : 52,
          metrics: [],
        };
        next = { ...next, objects: [...prev.objects, placed], selectedObjectId: placed.id, cursor: { x: placed.left, y: 0, z: placed.top } };
      } else if (command.id === 'move-selection') {
        next = {
          ...next,
          objects: prev.objects.map((item) => item.id === object.id ? { ...item, left: item.left + 18, top: item.top + 10 } : item),
          cursor: { x: object.left + 18, y: 0, z: object.top + 10 },
        };
      } else if (command.id === 'paint-material') {
        next = {
          ...next,
          objects: prev.objects.map((item) => item.id === object.id ? { ...item, assetId: asset.id, name: item.kind === 'TILE' ? asset.name : item.name } : item),
        };
      } else if (command.id === 'open-color-studio') {
        const doc = materialDocument(asset);
        next = {
          ...next,
          materialFocused: true,
          workspaceDocuments: upsertDocument(prev.workspaceDocuments, doc),
          activeWorkspaceDocumentId: doc.id,
          contextOpen: false,
          openMenu: null,
        };
      } else if (command.id === 'sample-material') {
        next = { ...next, activeAssetId: object.assetId, activeTab: assetById(object.assetId, prev.assetOverrides).tab };
      } else if (command.id === 'duplicate-selection') {
        const duplicate: WorldObject = { ...object, id: `obj-${prev.seq}`, name: `${object.name} copy`, left: object.left + 32, top: object.top + 22 };
        next = { ...next, objects: [...prev.objects, duplicate], selectedObjectId: duplicate.id };
      } else if (command.id === 'delete-selection') {
        const remaining = prev.objects.filter((item) => item.id !== object.id && !item.hidden);
        next = {
          ...next,
          objects: prev.objects.map((item) => item.id === object.id ? { ...item, hidden: true } : item),
          selectedObjectId: remaining[0]?.id ?? object.id,
        };
      } else if (command.id === 'add-trigger' || command.id === 'mission-point') {
        const placed: WorldObject = {
          id: `obj-${prev.seq}`,
          kind: command.id === 'add-trigger' ? 'TRIGGER' : 'MISSION_POINT',
          name: command.id === 'add-trigger' ? 'Trigger Volume' : 'Mission Point',
          assetId: object.assetId,
          left: object.left + 24,
          top: object.top + 18,
          width: command.id === 'add-trigger' ? 56 : 24,
          height: command.id === 'add-trigger' ? 40 : 24,
          metrics: [],
        };
        next = { ...next, rightPane: 'mission', objects: [...prev.objects, placed], selectedObjectId: placed.id, cursor: { x: placed.left, y: prev.floorIndex, z: placed.top } };
      } else if (command.id === 'set-spawn' || command.id === 'author-sequence') {
        next = { ...next, rightPane: 'mission' };
      } else if (command.id === 'show-pipeline') {
        next = { ...next, activeDomain: 'pipeline', rightPane: 'routes' };
      }

      const target = command.id === 'paint-material' || command.id === 'place-piece' ? asset.name : object.name;
      const editMs = Date.now() - t0;
      const event = command.id === 'sample-material'
        ? { history: prev.history, redo: prev.redo, seq: prev.seq }
        : pushHistory(prev, command, target, `${source} - ${command.native ? 'native-ready' : 'design-only'}`, editMs);
      return { ...next, ...event };
    });
  };

  const undoLocal = () => {
    setState((prev) => {
      const event = prev.history.find((item) => item.undoable);
      if (!event) return { ...prev, status: 'nothing undoable in local history' };
      return {
        ...prev,
        history: prev.history.filter((item) => item.id !== event.id),
        redo: [event, ...prev.redo].slice(0, 8),
        status: `undo ${event.verb} - ${event.target}`,
      };
    });
  };

  const redoLocal = () => {
    setState((prev) => {
      const [event, ...rest] = prev.redo;
      if (!event) return { ...prev, status: 'nothing to redo in local history' };
      return {
        ...prev,
        history: [event, ...prev.history].slice(0, 8),
        redo: rest,
        status: `redo ${event.verb} - ${event.target}`,
      };
    });
  };

  const selectAsset = (asset: Asset) => {
    setState((prev) => ({
      ...prev,
      activeAssetId: asset.id,
      activeTab: asset.tab,
      contentFolder: folderForAsset(asset),
      status: `selected ${asset.name} - context preserved`,
    }));
  };

  const selectObject = (id: string) => {
    setState((prev) => {
      const object = prev.objects.find((item) => item.id === id) ?? selectedObject(prev);
      return {
        ...prev,
        selectedObjectId: object.id,
        activeAssetId: object.assetId,
        activeTab: assetById(object.assetId, prev.assetOverrides).tab,
        contentFolder: folderForAsset(assetById(object.assetId, prev.assetOverrides)),
        cursor: { x: object.left, y: 0, z: object.top },
        status: `selected ${object.name}`,
      };
    });
  };

  const selectContentFolder = (contentFolder: ContentFolderId) => {
    setState((prev) => {
      const tab = tabForContentFolder(contentFolder);
      return {
        ...prev,
        contentFolder,
        activeTab: tab ?? prev.activeTab,
        assetPage: 0,
        expandedFolders: { ...prev.expandedFolders, [contentFolder]: true },
        status: `content browser: ${contentFolderLabel(contentFolder)}`,
      };
    });
  };

  const toggleContentFolder = (folder: ContentFolderId) => {
    setState((prev) => ({
      ...prev,
      expandedFolders: { ...prev.expandedFolders, [folder]: !prev.expandedFolders[folder] },
      status: `${prev.expandedFolders[folder] ? 'collapsed' : 'expanded'} ${contentFolderLabel(folder)}`,
    }));
  };

  const toggleFavorite = (assetId: string) => {
    setState((prev) => {
      const t0 = Date.now();
      const asset = assetById(assetId, prev.assetOverrides);
      const nextFavorite = !asset.favorite;
      const editMs = Date.now() - t0;
      return {
        ...prev,
        assetOverrides: {
          ...prev.assetOverrides,
          [assetId]: { ...prev.assetOverrides[assetId], favorite: nextFavorite },
        },
        history: [
          { id: `h-${prev.seq}`, verb: nextFavorite ? 'favorite' : 'unfavorite', target: asset.name, meta: 'catalog metadata override', undoable: true, editMs, emptyMs: editMs, richMs: editMs },
          ...prev.history,
        ].slice(0, 8),
        redo: [],
        seq: prev.seq + 1,
        status: `${nextFavorite ? 'favorited' : 'unfavorited'} ${asset.name}`,
      };
    });
  };

  const renameAsset = (assetId: string, name: string) => {
    setState((prev) => {
      const asset = assetById(assetId, prev.assetOverrides);
      return {
        ...prev,
        assetOverrides: {
          ...prev.assetOverrides,
          [assetId]: { ...prev.assetOverrides[assetId], name },
        },
        objects: prev.objects.map((object) => object.assetId === assetId && object.kind === 'TILE' ? { ...object, name } : object),
        status: `renamed ${asset.name} -> ${name || 'untitled material'}`,
      };
    });
  };

  const selectExplorerFolder = (fileExplorerFolder: ExplorerFolderId) => {
    setState((prev) => {
      const firstFile = EXPLORER_FILES.find((file) => explorerMatchesFolder(file, fileExplorerFolder));
      return {
        ...prev,
        fileExplorerFolder,
        fileExplorerSelectedId: firstFile?.id ?? prev.fileExplorerSelectedId,
        fileExplorerExpanded: { ...prev.fileExplorerExpanded, [fileExplorerFolder]: true },
        fileExplorerDirectoryHistory: [
          {
            id: `dh-${prev.seq}`,
            folderId: fileExplorerFolder,
            label: explorerFolderLabel(fileExplorerFolder),
            path: explorerFolderLabel(fileExplorerFolder),
            at: 'now',
          },
          ...prev.fileExplorerDirectoryHistory.filter((entry) => entry.folderId !== fileExplorerFolder),
        ].slice(0, 4),
        seq: prev.seq + 1,
        status: `file explorer folder: ${fileExplorerFolder} - directory memory retained`,
      };
    });
  };

  const toggleExplorerFolder = (folder: ExplorerFolderId) => {
    setState((prev) => ({
      ...prev,
      fileExplorerExpanded: { ...prev.fileExplorerExpanded, [folder]: !prev.fileExplorerExpanded[folder] },
      status: `${prev.fileExplorerExpanded[folder] ? 'collapsed' : 'expanded'} file folder ${folder}`,
    }));
  };

  const openExplorerFile = (fileId: string, action: string) => {
    setState((prev) => {
      const file = explorerFileById(fileId);
      const historyEntry: ExplorerHistoryEntry = {
        id: `fh-${prev.seq}`,
        fileId,
        action,
        query: prev.fileExplorerQuery.trim() || file.name,
        at: 'now',
      };
      return {
        ...prev,
        fileExplorerSelectedId: fileId,
        fileExplorerHistory: [
          historyEntry,
          ...prev.fileExplorerHistory.filter((entry) => entry.fileId !== fileId),
        ].slice(0, 5),
        seq: prev.seq + 1,
        status: `${action} ${file.path} - in-app explorer history retained`,
      };
    });
  };

  const selectColorStudioMaterial = (materialKey: ColorStudioMaterialKey) => {
    setState((prev) => {
      const material = SHADER_MATERIALS[materialKey];
      return {
        ...prev,
        colorStudioMaterial: materialKey,
        colorStudioVariant: 0,
        colorStudioActiveSlot: material.heroSlot,
        status: `Color Studio material: ${material.name} - hero slot selected`,
      };
    });
  };

  const setColorStudioVariant = (variant: number) => {
    setState((prev) => {
      const material = colorStudioMaterial(prev);
      return {
        ...prev,
        colorStudioVariant: variant,
        colorStudioActiveSlot: Math.min(prev.colorStudioActiveSlot, material.slots.length - 1),
        status: `Color Studio variant v${variant}: ${material.name}`,
      };
    });
  };

  const rollColorStudioSeed = () => {
    setState((prev) => {
      const nextSeed = ((prev.colorStudioSeed * 37 + 19) % 97) + 1;
      return {
        ...prev,
        colorStudioSeed: nextSeed,
        status: `Color Studio seed rolled: ${nextSeed}`,
      };
    });
  };

  const setColorStudioQuality = (quality: number) => {
    setState((prev) => ({
      ...prev,
      colorStudioQuality: quality,
      status: `Color Studio quality D[${quality}]: ${QUALITY_LABELS[quality] ?? quality}`,
    }));
  };

  const activateColorStudioSlot = (slot: number) => {
    setState((prev) => {
      const material = colorStudioMaterial(prev);
      const slotName = material.slots[slot]?.name ?? 'slot';
      return {
        ...prev,
        colorStudioActiveSlot: slot,
        status: `Color Studio active slot: ${material.name} / ${slotName}`,
      };
    });
  };

  const fillColorStudioSlot = (color: string, source: string) => {
    setState((prev) => {
      const t0 = Date.now();
      const material = colorStudioMaterial(prev);
      const slot = Math.min(prev.colorStudioActiveSlot, material.slots.length - 1);
      const slotName = material.slots[slot]?.name ?? 'slot';
      const key = colorStudioOverrideKey(material.key, prev.colorStudioVariant, slot);
      const editMs = Date.now() - t0;
      return {
        ...prev,
        colorStudioOverrides: { ...prev.colorStudioOverrides, [key]: color },
        history: [
          { id: `h-${prev.seq}`, verb: 'slot', target: `${material.name} ${slotName}`, meta: `${source} -> ${color}`, undoable: true, editMs, emptyMs: editMs, richMs: editMs },
          ...prev.history,
        ].slice(0, 8),
        redo: [],
        seq: prev.seq + 1,
        status: `filled ${material.name} ${slotName} from ${source}`,
      };
    });
  };

  const resetColorStudioSlots = () => {
    setState((prev) => {
      const t0 = Date.now();
      const material = colorStudioMaterial(prev);
      const nextOverrides = { ...prev.colorStudioOverrides };
      material.slots.forEach((_, slot) => delete nextOverrides[colorStudioOverrideKey(material.key, prev.colorStudioVariant, slot)]);
      const editMs = Date.now() - t0;
      return {
        ...prev,
        colorStudioOverrides: nextOverrides,
        history: [
          { id: `h-${prev.seq}`, verb: 'reset', target: `${material.name} v${prev.colorStudioVariant}`, meta: 'Color Studio reset to baked vec3f defaults', undoable: true, editMs, emptyMs: editMs, richMs: editMs },
          ...prev.history,
        ].slice(0, 8),
        redo: [],
        seq: prev.seq + 1,
        status: `reset ${material.name} v${prev.colorStudioVariant} to baked defaults`,
      };
    });
  };

  const setColorStudioView = (view: EditorState['colorStudioView']) => {
    setState((prev) => ({ ...prev, colorStudioView: view, status: `Color Studio view: ${view}` }));
  };

  const setColorSpineCurrent = (color: OklchColor) => {
    setState((prev) => ({ ...prev, colorSpineCurrent: color, status: `Color Studio current: ${oklchName(color)}` }));
  };

  const addColorSpineToTray = () => {
    setState((prev) => ({ ...prev, colorSpinePalette: [...prev.colorSpinePalette, { ...prev.colorSpineCurrent }], status: 'added current color to palette' }));
  };

  const pickColorSpineTray = (color: OklchColor) => {
    setState((prev) => ({ ...prev, colorSpineCurrent: color, status: `Color Studio current: ${oklchName(color)}` }));
  };

  const setColorSpineLens = (lens: ColorLens) => {
    setState((prev) => ({ ...prev, colorSpineLens: lens, status: `Color Studio lens: ${lens}` }));
  };

  const setColorSpineLibraryFilter = (filter: 'match' | 'all') => {
    setState((prev) => ({ ...prev, colorSpineLibraryFilter: filter }));
  };

  const setColorSpineRampSteps = (steps: number) => {
    setState((prev) => ({ ...prev, colorSpineRampSteps: steps }));
  };

  const pickColorSpineScene = (color: OklchColor, css: string) => {
    setState((prev) => ({ ...prev, colorSpineCurrent: color, colorSpineScenePick: css, status: `Color Studio current: ${oklchName(color)} (from scene)` }));
  };

  const loadColorSpineLibrarySet = (colors: OklchColor[]) => {
    setState((prev) => ({
      ...prev,
      colorSpinePalette: colors.map((c) => ({ ...c })),
      colorSpineCurrent: colors[0] ? { ...colors[0] } : prev.colorSpineCurrent,
      status: 'loaded library palette into tray',
    }));
  };

  const focusMaterialDocument = () => {
    setState((prev) => {
      const asset = assetById(prev.activeAssetId, prev.assetOverrides);
      const doc = materialDocument(asset);
      return {
        ...prev,
        materialFocused: true,
        workspaceDocuments: upsertDocument(prev.workspaceDocuments, doc),
        activeWorkspaceDocumentId: doc.id,
        status: `opened material document: ${asset.name}`,
      };
    });
  };

  // ── Model outliner (multi-part authoring) ───────────────────────────────────
  // A model in view is a list of PARTS (each its own mesh). These handlers own the parts
  // state; the surface composes them into the host mesh and reloads on change.
  const PART_TINTS = ['#c9b48f', '#8fb6c9', '#c98f9b', '#9cc98f', '#b49bc9', '#c9c08f', '#8fc9bb'];
  const activePartsModelId = (s: EditorState): string | null => {
    const doc = s.workspaceDocuments.find((d) => d.id === s.activeWorkspaceDocumentId);
    return doc?.kind === 'model' && doc.sourceId && s.modelParts[doc.sourceId] ? doc.sourceId : null;
  };
  const makePart = (kind: PrimitiveKind, existing: ModelPart[], seq: number, params?: PrimitiveParams): ModelPart => {
    const meta = PRIMITIVE_MESHES.find((p) => p.kind === kind)!;
    const n = existing.filter((p) => p.kind === kind).length + 1;
    return { id: `part:${kind}:${seq}`, name: `${meta.name} ${n}`, kind, mesh: primitivePartMesh(kind, params), visible: true, color: PART_TINTS[existing.length % PART_TINTS.length]! };
  };
  // Adding a mesh (menu or outliner) opens the size/resolution dialog instead of dropping a
  // fixed unit primitive — you author the dimensions upfront, like the old studio mesh editor.
  const addPart = (kind: PrimitiveKind) => setState((prev) => ({ ...prev, newMeshPrompt: kind }));
  // The dialog confirmed: build the primitive at the chosen params — a new PART on the model in
  // view, or a fresh model document seeded with it. Same part-vs-new-model split as before, now
  // decided here so both entry points (File → New Mesh and the outliner +) share it.
  const createPrimitive = (kind: PrimitiveKind, params: PrimitiveParams) => setState((prev) => {
    const activeModel = activePartsModelId(prev);
    if (activeModel) {
      const parts = prev.modelParts[activeModel] ?? [];
      const part = makePart(kind, parts, prev.seq, params);
      return { ...prev, seq: prev.seq + 1, modelParts: { ...prev.modelParts, [activeModel]: [...parts, part] }, modelActivePartId: part.id, newMeshPrompt: null, status: `added ${part.name}` };
    }
    const docSeq = prev.workspaceDocuments.filter((doc) => doc.id.startsWith('model:primitive:')).length + 1;
    const mid = `primitive:${kind}:${docSeq}`;
    const doc = modelDocument(primitiveModelPackage(mid));
    const part = makePart(kind, [], prev.seq, params);
    return {
      ...prev, seq: prev.seq + 1,
      workspaceDocuments: upsertDocument(prev.workspaceDocuments, doc),
      activeWorkspaceDocumentId: doc.id,
      modelParts: { ...prev.modelParts, [mid]: [part] },
      modelActivePartId: part.id,
      materialFocused: false, contextOpen: false, newMeshPrompt: null,
      status: `new ${kind} mesh`,
    };
  });
  const selectPart = (id: string) => {
    // Focus a part = SCOPE editing to it: only its verts/edges/faces show + select, and the
    // gizmo drives just it. Clicking the already-focused part toggles back to the whole model.
    const host = globalThis as any;
    const mid = activePartsModelId(state);
    const alreadyFocused = state.modelActivePartId === id;
    if (mid && !alreadyFocused) {
      const range = composeModelParts(state.modelParts[mid] ?? []).ranges.find((r) => r.id === id);
      if (range) {
        host.__mesh_edit_scope?.(range.lo, range.hi);
        host.__mesh_edit_select_group_range?.(range.lo, range.hi, 0);
      }
    } else {
      host.__mesh_edit_scope?.(0, 0); // toggle off → edit the whole model
      host.__mesh_edit_clear?.();
    }
    setState((prev) => ({ ...prev, modelActivePartId: alreadyFocused ? null : id }));
  };
  const toggleVisiblePart = (id: string) => setState((prev) => {
    const mid = activePartsModelId(prev);
    if (!mid) return prev;
    return { ...prev, modelParts: { ...prev.modelParts, [mid]: (prev.modelParts[mid] ?? []).map((p) => (p.id === id ? { ...p, visible: !p.visible } : p)) } };
  });
  const deletePart = (id: string) => setState((prev) => {
    const mid = activePartsModelId(prev);
    if (!mid) return prev;
    const parts = (prev.modelParts[mid] ?? []).filter((p) => p.id !== id);
    return { ...prev, modelParts: { ...prev.modelParts, [mid]: parts }, modelActivePartId: prev.modelActivePartId === id ? (parts[0]?.id ?? null) : prev.modelActivePartId };
  });
  // After a mesh edit (delete), drop any part whose geometry is entirely gone: ask the host
  // how many faces survive in each part's group range and remove the empties from the
  // outliner. Visible parts only (a hidden part isn't in the host mesh — it's hidden, not
  // deleted). Runs off the triangle-count drop below.
  const reconcileEmptyParts = () => {
    const mid = activePartsModelId(state);
    if (!mid) return;
    const parts = state.modelParts[mid] ?? [];
    if (parts.length === 0) return;
    const hostFns = globalThis as any;
    const empty = new Set<string>();
    for (const r of composeModelParts(parts).ranges) {
      if ((hostFns.__mesh_group_face_count?.(r.lo, r.hi) ?? -1) === 0) empty.add(r.id);
    }
    if (empty.size === 0) return;
    setState((prev) => {
      const list = (prev.modelParts[mid] ?? []).filter((p) => !empty.has(p.id));
      return {
        ...prev,
        modelParts: { ...prev.modelParts, [mid]: list },
        modelActivePartId: prev.modelActivePartId && empty.has(prev.modelActivePartId) ? (list[0]?.id ?? null) : prev.modelActivePartId,
        status: `removed ${empty.size} emptied part${empty.size === 1 ? '' : 's'}`,
      };
    });
  };
  // The model's live triangle count is mirrored up via onToolState. A DROP means faces were
  // removed (a delete) — reconcile emptied parts. Decimation/hide also drop tris but never
  // zero a part, so those are harmless no-ops.
  const prevTrisRef = useRef(0);
  useEffect(() => {
    const tris = state.modelTool.tris;
    if (tris < prevTrisRef.current) reconcileEmptyParts();
    prevTrisRef.current = tris;
  }, [state.modelTool.tris]);

  const openModelDocument = (model: ModelPackage) => {
    const doc = modelDocument(model);
    // Focus moves across the screen into the center/inspector document — the
    // content browser stays on its list so you can pick the next model without
    // re-navigating back into the folder. (Do NOT touch contentFolder here.)
    // Parts are seeded by the effect below (covers both click-open and reload-of-open).
    setState((prev) => ({
      ...prev,
      workspaceDocuments: upsertDocument(prev.workspaceDocuments, doc),
      activeWorkspaceDocumentId: doc.id,
      materialFocused: false,
      contextOpen: false,
      status: `opened model document: ${model.name}`,
    }));
  };

  // Seed the outliner from a Studio model's stored parts the first time it's the active doc
  // (covers a fresh click AND a hot reload of an already-open model). A model the user has
  // already edited this session keeps its parts. Primitive models seed themselves on create.
  useEffect(() => {
    const doc = state.workspaceDocuments.find((d) => d.id === state.activeWorkspaceDocumentId);
    const mid = doc?.kind === 'model' ? doc.sourceId : undefined;
    if (!mid || state.modelParts[mid]) return;
    const bareId = mid.startsWith('studio:') ? mid.slice('studio:'.length) : mid;
    const seeded = storedModelParts(bareId);
    if (!seeded) return;
    setState((prev) => (prev.modelParts[mid] ? prev : { ...prev, modelParts: { ...prev.modelParts, [mid]: seeded }, modelActivePartId: seeded[0]?.id ?? prev.modelActivePartId }));
  }, [state.activeWorkspaceDocumentId]);

  const selectWorkspaceDocument = (activeWorkspaceDocumentId: string) => {
    setState((prev) => {
      const doc = prev.workspaceDocuments.find((item) => item.id === activeWorkspaceDocumentId);
      if (!doc) return prev;
      return {
        ...prev,
        activeWorkspaceDocumentId,
        materialFocused: doc.kind === 'material',
        activeAssetId: doc.kind === 'material' && doc.sourceId ? doc.sourceId : prev.activeAssetId,
        contextOpen: false,
        status: `workspace document: ${doc.title}`,
      };
    });
  };

  const closeWorkspaceDocument = (documentId: string) => {
    if (documentId === WORLD_DOCUMENT_ID) return;
    setState((prev) => {
      const remaining = prev.workspaceDocuments.filter((doc) => doc.id !== documentId);
      const nextActive = prev.activeWorkspaceDocumentId === documentId
        ? WORLD_DOCUMENT_ID
        : prev.activeWorkspaceDocumentId;
      const activeDoc = remaining.find((doc) => doc.id === nextActive);
      return {
        ...prev,
        workspaceDocuments: remaining,
        activeWorkspaceDocumentId: activeDoc?.id ?? WORLD_DOCUMENT_ID,
        materialFocused: activeDoc?.kind === 'material',
        contextOpen: false,
        status: 'workspace document closed',
      };
    });
  };

  // Live model list + tree. Right-click actions (rename/favorite/duplicate/
  // delete) are UI overrides applied on read, so the gallery, the tree, and the
  // counts all read one resolved list and stay consistent.
  const visibleModels = useMemo(
    () => visibleModelPackages(state.modelOverrides, state.modelDupes),
    [state.modelOverrides, state.modelDupes],
  );
  const contentTreeNodes = useMemo(() => liveContentTree(visibleModels), [visibleModels]);

  const favoriteModel = (id: string) =>
    setState((prev) => {
      const next = !(prev.modelOverrides[id]?.favorite ?? false);
      return {
        ...prev,
        modelOverrides: { ...prev.modelOverrides, [id]: { ...prev.modelOverrides[id], favorite: next } },
        status: next ? 'favorited model' : 'unfavorited model',
      };
    });

  const deleteModel = (id: string) =>
    setState((prev) => ({
      ...prev,
      modelOverrides: { ...prev.modelOverrides, [id]: { ...prev.modelOverrides[id], hidden: true } },
      status: 'deleted model (hidden from browser)',
    }));

  const startRenameModel = (id: string) => setState((prev) => ({ ...prev, modelRenamingId: id, status: 'renaming model' }));
  const renameModel = (id: string, name: string) =>
    setState((prev) => ({ ...prev, modelOverrides: { ...prev.modelOverrides, [id]: { ...prev.modelOverrides[id], name } } }));
  const finishRenameModel = () => setState((prev) => ({ ...prev, modelRenamingId: null, status: 'renamed model' }));

  const duplicateModel = (model: ModelPackage) =>
    setState((prev) => {
      const dupe: ModelPackage = {
        ...model,
        id: `${model.id}::dup-${prev.seq}`,
        folderId: `model-dup-${prev.seq}` as ContentFolderId,
        name: `${model.name} copy`,
        favorite: false,
      };
      return { ...prev, modelDupes: [...prev.modelDupes, dupe], seq: prev.seq + 1, status: `duplicated ${model.name}` };
    });

  return (
    <C.HW_App>
      <RenderProbe id="Chrome">
        <Chrome
          state={state}
          activeCommand={activeCommand}
          onMenu={(menu) => setState((prev) => ({ ...prev, actionMenu: menu, openMenu: prev.openMenu === menu ? null : menu }))}
          onCommand={runCommand}
        />
      </RenderProbe>
      {playing ? (
        <C.HW_PlayBody>
          <PlayRoute />
        </C.HW_PlayBody>
      ) : (
      <>
      <C.HW_Body>
        <RenderProbe id="Left Rail">
          <LeftRail state={state} onDomain={(activeDomain) => setState((prev) => ({ ...prev, activeDomain, status: `workspace context: ${activeDomain}` }))} />
        </RenderProbe>
        <RenderProbe id="Content Browser">
          <LibraryPanel
            state={state}
            catalogAssets={catalogAssets}
            assets={filteredAssets}
            mode={panelMode}
            activeAsset={activeAsset}
            activeObject={activeObject}
            contentFolder={state.contentFolder}
            expandedFolders={state.expandedFolders}
            onSearch={(search) => setState((prev) => ({ ...prev, search, assetPage: 0 }))}
            onAsset={selectAsset}
            onFolder={selectContentFolder}
            onToggleFolder={toggleContentFolder}
            onFavorite={toggleFavorite}
            onRename={renameAsset}
            onPage={(delta) => setState((prev) => {
              const itemCount = isModelFolder(prev.contentFolder)
                ? modelPackagesForFolder(prev.contentFolder, prev.search, visibleModelPackages(prev.modelOverrides, prev.modelDupes)).length
                : filteredAssets.length;
              const pageSize = isModelFolder(prev.contentFolder) ? MODEL_GALLERY_PAGE_SIZE : assetPageSizeFor(panelMode);
              const maxPage = Math.max(0, Math.ceil(itemCount / pageSize) - 1);
              return { ...prev, assetPage: Math.max(0, Math.min(maxPage, prev.assetPage + delta)) };
            })}
            onFocusMaterial={focusMaterialDocument}
            onModel={openModelDocument}
            contentTree={contentTreeNodes}
            models={visibleModels}
            modelRenamingId={state.modelRenamingId}
            onModelStartRename={startRenameModel}
            onModelRename={renameModel}
            onModelFinishRename={finishRenameModel}
            onModelFavorite={favoriteModel}
            onModelDuplicate={duplicateModel}
            onModelDelete={deleteModel}
          />
        </RenderProbe>
        <RenderProbe id="Workspace">
          <Workspace
            state={state}
            activeCommand={activeCommand}
            activeAsset={activeAsset}
            onCommand={runCommand}
            onModelToolApi={(api: ModelToolApi) => { modelToolApiRef.current = api; }}
            onModelToolState={(modelTool: ModelToolSnapshot) => setState((prev) => ({ ...prev, modelTool }))}
            modelContextTrigger={modelMenu.triggerProps}
            outlinerHandlers={{ onSelectPart: selectPart, onToggleVisiblePart: toggleVisiblePart, onDeletePart: deletePart, onAddPart: addPart }}
            onTool={(id) => setState((prev) => ({ ...prev, actionMenu: commandById(id).menu, activeCommandId: id, status: `armed ${commandById(id).name}` }))}
            onSnap={() => setState((prev) => ({ ...prev, snapIndex: (prev.snapIndex + 1) % SNAP_MODES.length, status: `snap: ${SNAP_MODES[(prev.snapIndex + 1) % SNAP_MODES.length]}` }))}
            onFloor={() => runCommand('cycle-floor', 'toolbar')}
            onViewMode={(viewMode) => setState((prev) => ({ ...prev, viewMode, status: `view mode: ${viewMode}` }))}
            onWorkspaceDocument={selectWorkspaceDocument}
            onCloseWorkspaceDocument={closeWorkspaceDocument}
            onStage={() => runCommand(state.activeCommandId, 'stage')}
            onContext={() => setState((prev) => ({ ...prev, contextOpen: !prev.contextOpen, openMenu: null, status: prev.contextOpen ? 'context menu closed' : 'context menu opened' }))}
            onObject={selectObject}
            onExitMaterialFocus={() => setState((prev) => ({ ...prev, materialFocused: false, activeWorkspaceDocumentId: WORLD_DOCUMENT_ID, status: `returned to world with ${assetById(prev.activeAssetId, prev.assetOverrides).name}` }))}
            onSelectColorStudioMaterial={selectColorStudioMaterial}
            onColorStudioVariant={setColorStudioVariant}
            onColorStudioSeed={rollColorStudioSeed}
            onColorStudioQuality={setColorStudioQuality}
            onColorStudioSlot={activateColorStudioSlot}
            onColorStudioFill={fillColorStudioSlot}
            onColorStudioReset={resetColorStudioSlots}
            onColorStudioView={setColorStudioView}
            onColorSpineCurrent={setColorSpineCurrent}
            onColorSpineAddToTray={addColorSpineToTray}
            onColorSpineTrayPick={pickColorSpineTray}
            onColorSpineLens={setColorSpineLens}
            onColorSpineLibraryFilter={setColorSpineLibraryFilter}
            onColorSpineRampSteps={setColorSpineRampSteps}
            onColorSpineScenePick={pickColorSpineScene}
            onColorSpineLoadLibrarySet={loadColorSpineLibrarySet}
          />
        </RenderProbe>
        <RenderProbe id="Inspector">
          <Inspector
            state={state}
            activeObject={activeObject}
            activeAsset={assetById(activeObject.assetId, state.assetOverrides)}
            onPane={(rightPane) => setState((prev) => ({ ...prev, rightPane, status: `inspector pane: ${rightPane}` }))}
            onCommand={runCommand}
            onPreset={() => setState((prev) => ({ ...prev, presetMenuOpen: !prev.presetMenuOpen, status: prev.presetMenuOpen ? 'surface preset menu closed' : 'surface preset menu opened' }))}
            onPresetOption={(surfacePreset) => setState((prev) => ({ ...prev, surfacePreset, presetMenuOpen: false, status: `surface preset: ${surfacePreset}` }))}
            onModelBrush={(brush) => modelToolApiRef.current?.setBrush(brush)}
            outlinerHandlers={{ onSelectPart: selectPart, onToggleVisiblePart: toggleVisiblePart, onDeletePart: deletePart, onAddPart: addPart }}
            colorSpine={{
              onSetCurrent: setColorSpineCurrent,
              onAddToTray: addColorSpineToTray,
              onPickTray: pickColorSpineTray,
              onSetLens: setColorSpineLens,
              onSetLibraryFilter: setColorSpineLibraryFilter,
              onSetRampSteps: setColorSpineRampSteps,
              onScenePick: pickColorSpineScene,
              onLoadLibrarySet: loadColorSpineLibrarySet,
            }}
          />
        </RenderProbe>
      </C.HW_Body>
      <RenderProbe id="Bottom Dock">
        <BuildDock
          state={state}
          journal={journal}
          onBuild={() => setState((prev) => ({ ...prev, buildDialogOpen: true, eventbusPopoverOpen: false, perfPopoverOpen: false, memoryPopoverOpen: false, status: `opened build journal ${journal.activeBuild}` }))}
          onEventbus={() => setState((prev) => ({ ...prev, eventbusPopoverOpen: !prev.eventbusPopoverOpen, perfPopoverOpen: false, memoryPopoverOpen: false, status: prev.eventbusPopoverOpen ? 'eventbus review closed' : 'eventbus review opened' }))}
          onUndo={undoLocal}
          onRedo={redoLocal}
          onPerf={() => setState((prev) => ({ ...prev, perfPopoverOpen: !prev.perfPopoverOpen, memoryPopoverOpen: false, eventbusPopoverOpen: false, buildDialogOpen: false, status: prev.perfPopoverOpen ? 'performance churn closed' : 'performance churn opened' }))}
          onMemory={() => setState((prev) => ({ ...prev, memoryPopoverOpen: !prev.memoryPopoverOpen, perfPopoverOpen: false, eventbusPopoverOpen: false, buildDialogOpen: false, status: prev.memoryPopoverOpen ? 'memory accumulation closed' : 'memory accumulation opened' }))}
        />
      </RenderProbe>
      {state.eventbusPopoverOpen ? (
        <RenderProbe id="Eventbus Popover">
          <EventBusPopover
            state={state}
            onClose={() => setState((prev) => ({ ...prev, eventbusPopoverOpen: false, status: 'eventbus review closed' }))}
          />
        </RenderProbe>
      ) : null}
      {state.perfPopoverOpen ? (
        <RenderProbe id="Performance Popover">
          <PerformancePopover
            onClose={() => setState((prev) => ({ ...prev, perfPopoverOpen: false, status: 'performance churn closed' }))}
          />
        </RenderProbe>
      ) : null}
      {state.memoryPopoverOpen ? (
        <RenderProbe id="Memory Popover">
          <MemoryPopover
            onClose={() => setState((prev) => ({ ...prev, memoryPopoverOpen: false, status: 'memory accumulation closed' }))}
          />
        </RenderProbe>
      ) : null}
      {state.buildDialogOpen ? (
        <RenderProbe id="Build Journal Dialog">
          <BuildJournalDialog journal={journal} actions={journalActions} onClose={() => setState((prev) => ({ ...prev, buildDialogOpen: false, eventbusPopoverOpen: false, perfPopoverOpen: false, memoryPopoverOpen: false, status: 'build journal closed' }))} />
        </RenderProbe>
      ) : null}
      {state.newMeshPrompt ? (
        <NewMeshDialog
          kind={state.newMeshPrompt}
          onCancel={() => setState((prev) => ({ ...prev, newMeshPrompt: null, status: 'add mesh cancelled' }))}
          onAdd={(params) => createPrimitive(state.newMeshPrompt!, params)}
        />
      ) : null}
      {state.fileExplorerOpen ? (
        <RenderProbe id="File Explorer Dialog">
          <FileExplorerDialog
            query={state.fileExplorerQuery}
            selectedFolder={state.fileExplorerFolder}
            expandedFolders={state.fileExplorerExpanded}
            selectedFileId={state.fileExplorerSelectedId}
            history={state.fileExplorerHistory}
            folderHistory={state.fileExplorerDirectoryHistory}
            onQuery={(fileExplorerQuery) => setState((prev) => ({ ...prev, fileExplorerQuery, status: `file search: ${fileExplorerQuery || 'all indexed files'}` }))}
            onFolder={selectExplorerFolder}
            onToggleFolder={toggleExplorerFolder}
            onSelectFile={(fileExplorerSelectedId) => setState((prev) => ({ ...prev, fileExplorerSelectedId, status: `selected file ${explorerFileById(fileExplorerSelectedId).path}` }))}
            onOpenFile={openExplorerFile}
            onClose={() => setState((prev) => ({ ...prev, fileExplorerOpen: false, status: 'file explorer closed' }))}
          />
        </RenderProbe>
      ) : null}
      {state.openMenu ? (
        <RenderProbe id="Menu Dropdown">
          <DropdownMenu state={state} onCommand={runCommand} onToggleLight={(which) => modelToolApiRef.current?.toggleLight(which)} />
        </RenderProbe>
      ) : null}
      {/* Model context menu — rendered LAST at the root so it lands at the cursor
          (window origin) and hit-tests above everything (paint order). Self-gates
          on right-click; the kind check keeps it out of non-model surfaces. */}
      {state.workspaceDocuments.find((doc) => doc.id === state.activeWorkspaceDocumentId)?.kind === 'model' ? (
        <modelMenu.ContextMenu>
          <ModelContextMenu
            modelTool={state.modelTool}
            onCommand={runCommand}
            onQuality={(quality: number) => modelToolApiRef.current?.setQuality(quality)}
            onToggleLight={(which) => modelToolApiRef.current?.toggleLight(which)}
            onClose={modelMenu.close}
          />
        </modelMenu.ContextMenu>
      ) : null}
      </>
      )}
    </C.HW_App>
  );
}
