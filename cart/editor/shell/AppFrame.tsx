// AppFrame — the editor workspace composition root. Owns the (mock) authoring
// state and slots every region component in. Extracted verbatim from the mock
// god-file; only the imports changed (one component per file, shared data/cls).
// State will migrate onto the real foundation systems (editorbus / hot index /
// commands / tunables) incrementally; this is the faithful layout first.
import { useState, useMemo } from 'react';
import { C } from '../workspace.cls';
import Chrome from './Chrome';
import LeftRail from './LeftRail';
import BuildDock from './BuildDock';
import EventBusPopover from './EventBusPopover';
import BuildJournalDialog from './BuildJournalDialog';
import LibraryPanel from '../library/LibraryPanel';
import Workspace from '../stage/Workspace';
import Inspector from '../inspector/Inspector';
import FileExplorerDialog from '../dialogs/FileExplorerDialog';
import type { MockState, Command, Asset, WorldObject, ContentFolderId, ColorStudioMaterialKey } from '../data/types';
import type { ExplorerFolderId, ExplorerHistoryEntry } from '../data/fileExplorer';
import { initialState } from '../data/initialState';
import { commandById } from '../data/commands';
import { ASSETS, applyAssetOverrides, assetById, assetPageSizeFor } from '../data/catalog';
import { selectedObject, panelModeFor, tabForContentFolder, assetMatchesContentFolder, rankAssets, folderForAsset, contentFolderLabel, isModelFolder, modelPackagesForFolder, SNAP_MODES, FLOORS } from '../data/content';
import { SHADER_MATERIALS, colorStudioMaterial, colorStudioOverrideKey, QUALITY_LABELS } from '../data/colorStudio';
import { useBuildJournalSnapshot } from '../data/journal';
import { EXPLORER_FILES, explorerMatchesFolder, explorerFolderLabel, explorerFileById } from '../data/fileExplorer';

export default function AppFrame() {
  const [state, setState] = useState<MockState>(initialState);
  const journal = useBuildJournalSnapshot();

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
  const pushHistory = (prev: MockState, command: Command, target: string, meta: string, editMs: number): Pick<MockState, 'history' | 'redo' | 'seq'> => ({
    history: [
      { id: `h-${prev.seq}`, verb: command.name.split(' ')[0]!.toLowerCase(), target, meta, undoable: command.undoable, editMs, emptyMs: editMs, richMs: editMs },
      ...prev.history,
    ].slice(0, 8),
    redo: command.undoable ? [] : prev.redo,
    seq: prev.seq + 1,
  });

  const runCommand = (commandId: string, source: string) => {
    const command = commandById(commandId);
    if (command.id === 'undo-local') {
      undoLocal();
      return;
    }
    if (command.id === 'redo-local') {
      redoLocal();
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
      let next: MockState = {
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
        next = { ...next, materialFocused: true, contextOpen: false, openMenu: null };
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

  return (
    <C.HW_App>
      <Chrome
        state={state}
        activeCommand={activeCommand}
        onMenu={(menu) => setState((prev) => ({ ...prev, actionMenu: menu, openMenu: prev.openMenu === menu ? null : menu }))}
        onCommand={runCommand}
        onUndo={undoLocal}
        onRedo={redoLocal}
      />
      <C.HW_Body>
        <LeftRail state={state} onDomain={(activeDomain) => setState((prev) => ({ ...prev, activeDomain, status: `workspace context: ${activeDomain}` }))} />
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
              ? modelPackagesForFolder(prev.contentFolder, prev.search).length
              : filteredAssets.length;
            const pageSize = isModelFolder(prev.contentFolder) ? 5 : assetPageSizeFor(panelMode);
            const maxPage = Math.max(0, Math.ceil(itemCount / pageSize) - 1);
            return { ...prev, assetPage: Math.max(0, Math.min(maxPage, prev.assetPage + delta)) };
          })}
          onFocusMaterial={() => setState((prev) => ({ ...prev, materialFocused: true, status: `focused material editor: ${assetById(prev.activeAssetId, prev.assetOverrides).name}` }))}
          onMaterialAction={(label) => setState((prev) => ({ ...prev, status: `${label}: ${assetById(prev.activeAssetId, prev.assetOverrides).name}` }))}
        />
        <Workspace
          state={state}
          activeCommand={activeCommand}
          activeAsset={activeAsset}
          onCommand={runCommand}
          onTool={(id) => setState((prev) => ({ ...prev, actionMenu: commandById(id).menu, activeCommandId: id, status: `armed ${commandById(id).name}` }))}
          onSnap={() => setState((prev) => ({ ...prev, snapIndex: (prev.snapIndex + 1) % SNAP_MODES.length, status: `snap: ${SNAP_MODES[(prev.snapIndex + 1) % SNAP_MODES.length]}` }))}
          onFloor={() => runCommand('cycle-floor', 'toolbar')}
          onViewMode={(viewMode) => setState((prev) => ({ ...prev, viewMode, status: `view mode: ${viewMode}` }))}
          onStage={() => runCommand(state.activeCommandId, 'stage')}
          onContext={() => setState((prev) => ({ ...prev, contextOpen: !prev.contextOpen, openMenu: null, status: prev.contextOpen ? 'context menu closed' : 'context menu opened' }))}
          onObject={selectObject}
          onExitMaterialFocus={() => setState((prev) => ({ ...prev, materialFocused: false, status: `returned to world with ${assetById(prev.activeAssetId, prev.assetOverrides).name}` }))}
          onMaterialAction={(label) => setState((prev) => ({ ...prev, status: `${label}: ${assetById(prev.activeAssetId, prev.assetOverrides).name}` }))}
          onSelectColorStudioMaterial={selectColorStudioMaterial}
          onColorStudioVariant={setColorStudioVariant}
          onColorStudioSeed={rollColorStudioSeed}
          onColorStudioQuality={setColorStudioQuality}
          onColorStudioSlot={activateColorStudioSlot}
          onColorStudioFill={fillColorStudioSlot}
          onColorStudioReset={resetColorStudioSlots}
        />
        <Inspector
          state={state}
          activeObject={activeObject}
          activeAsset={assetById(activeObject.assetId, state.assetOverrides)}
          onPane={(rightPane) => setState((prev) => ({ ...prev, rightPane, status: `inspector pane: ${rightPane}` }))}
        onCommand={runCommand}
        onPreset={() => setState((prev) => ({ ...prev, presetMenuOpen: !prev.presetMenuOpen, status: prev.presetMenuOpen ? 'surface preset menu closed' : 'surface preset menu opened' }))}
        onPresetOption={(surfacePreset) => setState((prev) => ({ ...prev, surfacePreset, presetMenuOpen: false, status: `surface preset: ${surfacePreset}` }))}
        />
      </C.HW_Body>
      <BuildDock
        state={state}
        journal={journal}
        onBuild={() => setState((prev) => ({ ...prev, buildDialogOpen: true, eventbusPopoverOpen: false, status: `opened build journal ${journal.activeBuild}` }))}
        onEventbus={() => setState((prev) => ({ ...prev, eventbusPopoverOpen: !prev.eventbusPopoverOpen, status: prev.eventbusPopoverOpen ? 'eventbus review closed' : 'eventbus review opened' }))}
      />
      {state.eventbusPopoverOpen ? (
        <EventBusPopover
          state={state}
          onClose={() => setState((prev) => ({ ...prev, eventbusPopoverOpen: false, status: 'eventbus review closed' }))}
        />
      ) : null}
      {state.buildDialogOpen ? (
        <BuildJournalDialog journal={journal} onClose={() => setState((prev) => ({ ...prev, buildDialogOpen: false, eventbusPopoverOpen: false, status: 'build journal closed' }))} />
      ) : null}
      {state.fileExplorerOpen ? (
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
      ) : null}
    </C.HW_App>
  );
}
