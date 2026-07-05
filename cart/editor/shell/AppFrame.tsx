// AppFrame — the editor workspace composition root. Owns the (mock) authoring
// state and slots every region component in. Extracted verbatim from the mock
// god-file; only the imports changed (one component per file, shared data/cls).
// State will migrate onto the real foundation systems (editorbus / hot index /
// commands / tunables) incrementally; this is the faithful layout first.
import { useState, useMemo, useEffect, useRef } from 'react';
import { C } from '../workspace.cls';
import { Box } from '../../../runtime/primitives';
import Chrome from './Chrome';
import DropdownMenu from './DropdownMenu';
import LeftRail from './LeftRail';
import BuildDock from './BuildDock';
import EventBusPopover from './EventBusPopover';
import BuildJournalDialog from './BuildJournalDialog';
import NewMeshDialog from './NewMeshDialog';
import PaintToolbar, { PaintPopovers, type PaintPopover } from './PaintToolbar';
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
import type { EditorState, Command, Asset, Menu, WorldObject, ContentFolderId, ModelOverride, ModelPackage, ModelPart, PrimitiveKind, ModelToolApi, ModelToolSnapshot, Rgb, WorldUndoSlices } from '../data/types';
import type { ExplorerFolderId, ExplorerHistoryEntry } from '../data/fileExplorer';
import type { PlacedPiece, MaterialRef } from '../world/pieces';
import { placementSlotKey } from '../world/pieces';
import { setAuthoredPieces, authoredIdFor, type AuthoredBuildPiece } from '../world/authoredRegistry';
import { cacheAuthoredMesh, authoredMeshData } from '../world/authoredMesh';
import type { BuildKind } from '../world/buildCatalog';
import { loadPersistedState, persistState } from '../data/persistView';
import { saveAuthoredPieces } from '../data/initialState';
import { applyMapPaintEffects, defaultMapPaint } from '../stage/mapPaint';
import MapTexturePicker from '../stage/MapTexturePicker';
import { dispatchEdit } from '../data/editorEvents';
import { commandById, isMeshToolCommand, PRIMITIVE_MESHES, blockingOverlay, publishUndoDepths, undoDepths, type BlockingOverlay } from '../data/commands';
import { commandForKeyEvent, modifiersFromKeyEvent, syntheticKeyEdge } from '../data/keymap';
import { primitivePartMesh, primitiveMeshData, composeModelParts, storedModelParts, storedModelMeshData, storedModelFaceGroupData, cookedMeshBlobData, cookedMeshRefForAsset, fileModelPackage, importModelFilePackage, isViewerFile, modelPackageMeshData, type PrimitiveParams } from '../data/hmscAssetCatalog';
import { cloneMesh, mirrorMesh, mergeMesh, type EditMesh } from '../model/editMesh';
import ImportPartDialog from '../dialogs/ImportPartDialog';
// Key edges come straight off the ffi bus (not useModifiers.onKeyDown): the active key
// bridge is useIFTTT's, whose events carry ctrlKey/shiftKey flags but NO `mods` object —
// useModifiers' fallback modifiers never update off those events, which is what killed
// every Ctrl chord (see modifiersFromKeyEvent in data/keymap.ts, req_2620 gap W).
import { subscribe } from '@reactjit/runtime/ffi';
import { pickFile } from '@reactjit/runtime/hooks/pickFile';
import { ASSETS, applyAssetOverrides, assetById, assetPageSizeFor } from '../data/catalog';
import { selectedObject, panelModeFor, tabForContentFolder, assetMatchesContentFolder, rankAssets, folderForAsset, contentFolderLabel, isModelFolder, modelPackagesForFolder, visibleModelPackages, liveContentTree, primitiveModelPackage, modelPackageById, MODEL_GALLERY_PAGE_SIZE, SNAP_MODES } from '../data/content';
import { materializeModelPackage, writeModelArtifacts } from '../data/modelPackageStore';
import { colorStudioSpec, colorStudioOverrideKey, paletteForSpecVariant, rgbToCss } from '../data/colorStudio';
import { FILL_GRADES, FILL_SEED_MAX, registerImportedSpecs, shaderSpec } from '../textures/shaders';
import { image as imageOps, quantize as quantizeImage } from '../../../runtime/image';
import { encodeRows, parseQuantizeProbe } from '../textures/pixelTexture';
import { loadTexturePackages, textureSpec, savePixelTexture, saveExactImage } from '../data/texturePackage';
import ImportImageDialog, { type ImportImagePlan } from '../dialogs/ImportImageDialog';
import { readFileBase64 } from '../../../runtime/hooks/fs';
import { oklchName } from '../data/colorSpine';
import { oklchToHex, type OklchColor } from '../../../runtime/paint/colors';
import { useBuildJournal } from '../data/journal';
import { explorerIndex, refreshExplorerIndex, explorerMatchesFolder, explorerFolderLabel, explorerFileById, explorerNowLabel } from '../data/fileExplorer';
import { WORLD_DOCUMENT_ID, materialDocument, modelDocument, upsertDocument } from '../data/documents';

// FLOORCTL req_2485: floorIndex is the world viewport's REAL active storey
// (0 = Ground) — the action bar's ▼/▲ is the one control. Storeys above this
// are out of the build envelope for now.
const MAX_FLOOR = 8;

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
  // The open paint-toolbar popover (ink / brush). Local, not persisted — the popovers render
  // LATE (below) so they sit over the body; the bar (early) only toggles this.
  const [paintPopover, setPaintPopover] = useState<PaintPopover>(null);
  // A pending image import awaiting the pixel-vs-exact decision. Transient.
  const [importPlan, setImportPlan] = useState<ImportImagePlan | null>(null);
  // The Add From Library picker (append a saved model into the OPEN model as parts).
  const [importPartOpen, setImportPartOpen] = useState(false);

  // Imported textures register as dynamic ShaderSpecs at boot (and after every
  // import), so they are first-class materials everywhere a catalog material is.
  const reloadImportedTextures = () => {
    const specs = loadTexturePackages()
      .map((pkg) => textureSpec(pkg, (b64) => imageOps(b64).raw()))
      .filter((s): s is NonNullable<typeof s> => s !== null);
    registerImportedSpecs(specs);
    return specs.length;
  };
  useEffect(() => {
    const n = reloadImportedTextures();
    if (n > 0) setState((prev) => ({ ...prev, status: `${prev.status} · ${n} imported texture${n === 1 ? '' : 's'} registered` }));
  }, []);

  // The embedded model viewer hands its host-native tool handlers up here; the
  // toolbar + context menu remote-control the SAME tools through this ref, and
  // the viewer mirrors its live state back into state.modelTool for highlights.
  const modelToolApiRef = useRef<ModelToolApi | null>(null);

  // ── Modal discipline (req_2626 gap HH, USER LAW) ────────────────────────────
  // While ANY blocking session/dialog is unresolved — the viewer's loop-cut
  // session / atlas prompt / face guard (via state.modelTool.blocking), the
  // shell's newMeshPrompt / file explorer / build journal (via the shared
  // predicate in data/commands.ts), or the component-local import dialogs — every
  // other input surface is inert: runCommand refuses (with the reason in the
  // status line, never silently), the menus won't open, tools won't arm, and the
  // hotkey layer only lets Esc through to cancel. blockingNow() layers the
  // component-local dialogs over the state-visible predicate.
  const blockingNow = (s: EditorState): BlockingOverlay | null => {
    const block = blockingOverlay(s);
    if (block) return block;
    if (importPlan) return { id: 'import-image', label: 'Import Image' };
    if (importPartOpen) return { id: 'import-part', label: 'Add From Library' };
    return null;
  };
  // Live handle for the once-installed hotkey subscription (fresh closures per render).
  const blockingNowRef = useRef(blockingNow);
  blockingNowRef.current = blockingNow;
  const refuseBlocked = (block: BlockingOverlay) =>
    setState((prev) => ({ ...prev, status: `resolve ${block.label} first — finish or cancel it before doing anything else` }));
  /** Wrap a handler so it is inert (with the honest status) while a blocker is open. */
  const guarded = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => {
    const block = blockingNow(state);
    if (block) { refuseBlocked(block); return; }
    fn(...a);
  };

  // The model surface's right-click menu. Lives at the app ROOT (rendered below,
  // as the last child of HW_App) so it lands at the cursor — an absolutely-placed
  // menu positions relative to its parent, and only the root sits at window origin
  // (the stage is offset right by the rail + content browser). The trigger spreads
  // onto the model surface deep in the tree.
  const modelMenu = useContextMenu();

  // Mirror the active view into hot-state so a dev hot reload rehydrates exactly
  // what you were looking at instead of snapping back to defaults.
  useEffect(() => { persistState(state); }, [state]);

  // MAPPAINT req_2492: a hot-restored ACTIVE paint tool must RE-ARM the host on
  // boot — applyMapPaintEffects otherwise only fires on patches, so a reload
  // that rehydrated active=true left the host with no ground look and a stale
  // tool (paint strokes silently did nothing).
  useEffect(() => {
    if (state.mapPaint.active) applyMapPaintEffects(defaultMapPaint(), state.mapPaint);
  }, []);

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

  // Mirror the authored build pieces into the module registry (req_2578) so the
  // pure placement/render helpers resolve them without prop threading, AND persist
  // the list to DISK so exports survive a cold restart (req_2594).
  useEffect(() => {
    setAuthoredPieces(state.authoredBuildPieces);
    saveAuthoredPieces(state.authoredBuildPieces);
  }, [state.authoredBuildPieces]);

  // Publish the LIVE undo/redo depths (model → the host mesh journal via __mesh_history;
  // world → the real worldUndo/worldRedo stacks) so the Edit-menu rows count-annotate and
  // gray honestly. Every render is an event edge, so the menus read fresh depths whenever
  // they can possibly be looked at (req_2620 gap W).
  publishUndoDepths(undoDepths(state));

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
    // Modal discipline (req_2626 HH): while a blocking session/dialog is unresolved every
    // command is inert except the one that CLOSES the blocker. The refusal is loud (status
    // line), never a silent swallow — and never a stacked op over a captured base mesh.
    {
      const block = blockingNow(state);
      if (block && commandId !== block.closerCommandId) { refuseBlocked(block); return; }
    }
    // Paint resolution (Edit → Mesh → Paint → Paint Resolution): set exact texels/triangle on the
    // viewer. The host clamps dense meshes to the atlas budget; the readout reflects what took.
    if (commandId.startsWith('mesh-paint-res-')) {
      const px = Number(commandId.slice('mesh-paint-res-'.length));
      const applied = modelToolApiRef.current?.changeDetail(px) ?? px;
      // Shout when the atlas budget clamped the pick — otherwise a plateau at high detail looks
      // like a brush bug when it's really "this mesh has too many faces for that many texels".
      const status = applied < px
        ? `Paint resolution ${px} clamped → ${applied}×${applied} (atlas budget — fewer faces or lower detail for finer than this)`
        : `Paint resolution → ${px}×${px} texels/triangle`;
      setState((prev) => ({ ...prev, openMenu: null, status }));
      return;
    }
    // Add Primitive (Edit → Mesh → Add Primitive → <kind>): the 'add' verb — append a part to the
    // model in view. Opens the size/resolution dialog in add mode; the outliner + shares this path.
    if (commandId.startsWith('add-mesh-')) {
      const kind = commandId.slice('add-mesh-'.length) as PrimitiveKind;
      setState((prev) => ({ ...prev, openMenu: null, contextOpen: false, actionMenu: 'Edit', newMeshPrompt: { kind, mode: 'add' } }));
      return;
    }
    // Studio-parity mesh ops — these change PART structure (or journaled mesh state),
    // so they route through dedicated handlers that keep the outliner metadata true.
    // Must run BEFORE the generic model-tool router below (same 'model' surface).
    if (commandId === 'mesh-detach') { runDetachSelection(); return; }
    if (commandId === 'mesh-glass') { runFaceOp('glass'); return; }
    if (commandId === 'mesh-solidify') { runFaceOp('solidify'); return; }
    if (commandId === 'mesh-merge-faces') { runFaceOp('merge-faces'); return; }
    if (commandId === 'mesh-duplicate-part') { duplicatePartById(state.modelActivePartId, -1); return; }
    if (commandId === 'mesh-mirror-x') { duplicatePartById(state.modelActivePartId, 0); return; }
    if (commandId === 'mesh-mirror-y') { duplicatePartById(state.modelActivePartId, 1); return; }
    if (commandId === 'mesh-mirror-z') { duplicatePartById(state.modelActivePartId, 2); return; }
    if (commandId === 'mesh-merge-down') { mergeActivePartDown(); return; }
    if (commandId === 'mesh-import-part') {
      setImportPartOpen(true);
      setState((prev) => ({ ...prev, contextOpen: false, openMenu: null, status: 'pick a library model to append as part(s)' }));
      return;
    }
    // Model-surface tools route to the viewer's host-native tool api; the viewer
    // owns the state and reports it back, so we don't mutate world state here.
    // Route to the viewer's mesh-tool API — but ONLY for actual mesh TOOLS (all
    // 'mesh-' prefixed). isMeshToolCommand is `scope === 'model'`, which also
    // matches non-tool model commands (save-snapshot, export-build-piece-*); the
    // prefix guard keeps this router from swallowing them before their handlers
    // (req_2585 — the export leaf hit this and silently no-op'd).
    if (commandId.startsWith('mesh-') && isMeshToolCommand(commandId)) {
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
      // On a model document Ctrl+Z drives the HOST mesh journal (geometry, parts,
      // paint colours all restore); the world surface keeps its local history list.
      const doc = state.workspaceDocuments.find((d) => d.id === state.activeWorkspaceDocumentId);
      if (doc?.kind === 'model') { meshUndoRedo(false); return; }
      undoLocal();
      return;
    }
    if (command.id === 'redo-local') {
      const doc = state.workspaceDocuments.find((d) => d.id === state.activeWorkspaceDocumentId);
      if (doc?.kind === 'model') { meshUndoRedo(true); return; }
      redoLocal();
      return;
    }
    if (command.id === 'save-snapshot') {
      // Save Model to Library: materialize the ACTIVE model's on-disk package (its own
      // directory + manifest under cart/editor/data/models/…). Imports already do this on
      // drop; this is the explicit "commit my model to the library" for anything not yet on
      // disk. Paint variants save separately into paints/ (ModelPaintVariants). req_2523.
      const doc = state.workspaceDocuments.find((d) => d.id === state.activeWorkspaceDocumentId);
      const pkg = doc?.kind === 'model' ? modelPackageById(doc.sourceId) : null;
      if (!pkg) {
        setState((prev) => ({ ...prev, openMenu: null, actionMenu: 'File', status: 'Open a model first — Save writes the ACTIVE model to the library.' }));
        return;
      }
      const res = materializeModelPackage(pkg);
      if (res.ok) writeModelArtifacts(pkg); // also write mesh/base.blob + atlases/base.png
      setState((prev) => ({
        ...prev,
        openMenu: null,
        actionMenu: 'File',
        status: res.ok ? `Saved "${pkg.name}" to the library → ${res.dir}` : `Save failed: ${res.error ?? 'unknown error'}`,
      }));
      return;
    }
    if (command.id.startsWith('export-build-piece-')) {
      // Export → Build Piece → <kind> (req_2583): register the OPEN model as a
      // placeable build piece of the chosen base kind (its snap affinity) and arm
      // it. The mesh key is the bare stored-model id (storedModelMeshData key),
      // stripped of the 'studio:' package prefix so residency + refs agree. The
      // status ALWAYS reports — a silent no-op is what made this feel dead before.
      const kind = command.id.slice('export-build-piece-'.length) as BuildKind;
      const doc = state.workspaceDocuments.find((d) => d.id === state.activeWorkspaceDocumentId);
      const pkg = doc?.kind === 'model' ? modelPackageById(doc.sourceId) : null;
      if (!pkg) {
        setState((prev) => ({ ...prev, openMenu: null, actionMenu: 'File', status: 'Export needs a MODEL open — open one from Models, then Export → Build Piece.' }));
        return;
      }
      const modelId = pkg.id.startsWith('studio:') ? pkg.id.slice('studio:'.length) : pkg.id;
      // Resolve the geometry through the ONE resolver the viewer uses — whatever
      // form it's stored in (EditMesh parts, a content-addressed blob, a
      // primitive). Live edited-but-unsaved parts win when held; else the package
      // resolver. Cache it so the resident builder draws exactly what you see.
      const liveParts = state.modelParts[pkg.id];
      const captured = (liveParts ? composeModelParts(liveParts).positions : null) ?? modelPackageMeshData(pkg);
      if (captured && captured.length >= 8) cacheAuthoredMesh(modelId, captured);
      const verts = authoredMeshData(modelId, pkg.id);
      const vcount = verts ? Math.floor(verts.length / 8) : 0;
      const piece: AuthoredBuildPiece = { id: authoredIdFor(modelId), modelId, pkgId: pkg.id, label: pkg.name, kind, hex: pkg.color };
      setState((prev) => ({
        ...prev,
        openMenu: null,
        actionMenu: 'Build',
        authoredBuildPieces: [...prev.authoredBuildPieces.filter((p) => p.id !== piece.id), piece],
        armedPieceId: piece.id,
        status: vcount > 0
          ? `Exported "${pkg.name}" as a ${kind} build piece (${vcount} verts) — armed. Enter Build (B) to place it.`
          : `Exported "${pkg.name}" as a ${kind} piece, but its geometry isn't reachable (0 verts). Open it in the model editor and Save Model to Library, then re-export. (${modelId})`,
      }));
      return;
    }
    if (command.id.startsWith('new-mesh-')) {
      // New Mesh (File → New Mesh → <kind>): the 'new' verb — ALWAYS a fresh model document, even
      // with a model already open. Prompt for size + resolution first; createNewMeshDocument builds
      // it on confirm. (Appending a part to the model in view is the separate 'add' verb above.)
      const kind = command.id.slice('new-mesh-'.length) as PrimitiveKind;
      setState((prev) => ({ ...prev, openMenu: null, actionMenu: 'File', newMeshPrompt: { kind, mode: 'new' } }));
      return;
    }
    if (command.id === 'open-map' || command.id === 'open-file-explorer' || command.id === 'find-import-source') {
      setState((prev) => ({
        ...prev,
        openMenu: null,
        actionMenu: 'File',
        fileExplorerOpen: true,
        // Import search = jump straight to the Models import-class folder.
        fileExplorerFolder: command.id === 'find-import-source' ? 'virt:models' : prev.fileExplorerFolder,
        status: command.id === 'find-import-source'
          ? 'file explorer opened on importable models'
          : 'file explorer opened',
      }));
      return;
    }
    if (command.id === 'import-model-file') {
      setState((prev) => ({ ...prev, openMenu: null, actionMenu: 'File' }));
      void importModelFromDisk();
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
    // Window menu — real toggles over the existing dock popovers/dialog (open one, close the
    // sibling popovers so only one owns the corner at a time).
    if (command.id === 'toggle-eventbus') {
      setState((prev) => ({ ...prev, openMenu: null, eventbusPopoverOpen: !prev.eventbusPopoverOpen, perfPopoverOpen: false, memoryPopoverOpen: false, status: prev.eventbusPopoverOpen ? 'event bus closed' : 'event bus opened' }));
      return;
    }
    if (command.id === 'toggle-performance') {
      setState((prev) => ({ ...prev, openMenu: null, perfPopoverOpen: !prev.perfPopoverOpen, eventbusPopoverOpen: false, memoryPopoverOpen: false, status: prev.perfPopoverOpen ? 'performance closed' : 'performance opened' }));
      return;
    }
    if (command.id === 'toggle-memory') {
      setState((prev) => ({ ...prev, openMenu: null, memoryPopoverOpen: !prev.memoryPopoverOpen, eventbusPopoverOpen: false, perfPopoverOpen: false, status: prev.memoryPopoverOpen ? 'memory closed' : 'memory opened' }));
      return;
    }
    if (command.id === 'toggle-build-journal') {
      setState((prev) => ({ ...prev, openMenu: null, buildDialogOpen: !prev.buildDialogOpen, status: prev.buildDialogOpen ? 'build journal closed' : 'build journal opened' }));
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
        // FLOORCTL req_2485: floorIndex is the REAL active storey (0 = Ground);
        // the command steps up and wraps back to the ground past the cap.
        next = { ...next, floorIndex: prev.floorIndex >= MAX_FLOOR ? 0 : prev.floorIndex + 1 };
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
      // Any world slice this command touched becomes a REAL reversible entry
      // (recordWorldEdit self-no-ops for commands that changed none — req_2620 W).
      return recordWorldEdit(prev, { ...next, ...event }, command.name.toLowerCase());
    });
  };

  // ── Real world undo (req_2620 gap W) ─────────────────────────────────────────
  // Every world-surface mutation records the slices it changed (references — the
  // immutable-update chain makes an entry cost pointers, not copies) onto a bounded
  // stack. undoLocal/redoLocal REVERT/REAPPLY those slices. The old shape only
  // spliced entries out of the 8-deep history FEED — it reverted nothing (the
  // placebo); the feed is display-only now. NOT covered (host-side, never in
  // EditorState): map paint strokes and in-viewer mesh edits — mesh docs route to
  // the host mesh journal instead (meshUndoRedo below).
  const WORLD_UNDO_CAP = 32;
  const WORLD_UNDO_KEYS = ['worldPieces', 'objects', 'authoredBuildPieces', 'selectedPieceId', 'selectedObjectId', 'armedPieceId'] as const;
  const recordWorldEdit = (prev: EditorState, next: EditorState, label: string): EditorState => {
    const before: WorldUndoSlices = {};
    const after: WorldUndoSlices = {};
    let changed = false;
    for (const k of WORLD_UNDO_KEYS) {
      if (prev[k] !== next[k]) {
        (before as Record<string, unknown>)[k] = prev[k];
        (after as Record<string, unknown>)[k] = next[k];
        changed = true;
      }
    }
    if (!changed) return next;
    return { ...next, worldUndo: [{ label, before, after }, ...prev.worldUndo].slice(0, WORLD_UNDO_CAP), worldRedo: [] };
  };

  const undoLocal = () => {
    setState((prev) => {
      const [entry, ...rest] = prev.worldUndo;
      if (!entry) return { ...prev, status: 'nothing to undo on the world — piece/slot/object edits are covered; map paint strokes are host-side and not undoable yet' };
      return {
        ...prev,
        ...entry.before,
        worldUndo: rest,
        worldRedo: [entry, ...prev.worldRedo].slice(0, WORLD_UNDO_CAP),
        status: `undid ${entry.label} — restored ${Object.keys(entry.before).join(', ')}`,
      };
    });
  };

  const redoLocal = () => {
    setState((prev) => {
      const [entry, ...rest] = prev.worldRedo;
      if (!entry) return { ...prev, status: 'nothing to redo on the world' };
      return {
        ...prev,
        ...entry.after,
        worldRedo: rest,
        worldUndo: [entry, ...prev.worldUndo].slice(0, WORLD_UNDO_CAP),
        status: `redid ${entry.label} — reapplied ${Object.keys(entry.after).join(', ')}`,
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

  // ── World pieces (req_2563 Phase 1): the real placed-piece model lives in
  // EditorState now. WorldEditorSurface reports placements/picks up here; the
  // Inspector reads state.selectedPieceId. This retires the phantom `objects`
  // path as the world surface's selection source.
  const placePiece = (piece: PlacedPiece) => {
    setState((prev) => {
      const id = `bp_${prev.seq}`;
      const placed = { ...piece, id };
      // Replace anything already occupying this footprint (req_2583): dropping a
      // window wall onto a wall REPLACES it — no two pieces fighting for the same
      // space. Different footprints (a wall vs the floor under it) don't collide.
      const key = placementSlotKey(placed);
      const kept = prev.worldPieces.filter((p) => placementSlotKey(p) !== key);
      const replaced = kept.length !== prev.worldPieces.length;
      return recordWorldEdit(prev, {
        ...prev,
        seq: prev.seq + 1,
        worldPieces: [...kept, placed],
        selectedPieceId: id,
        status: `${replaced ? 'replaced' : 'placed'} ${piece.pieceId}`,
      }, `${replaced ? 'replace' : 'place'} ${piece.pieceId}`);
    });
  };

  const selectPiece = (id: string | null) => {
    setState((prev) => ({
      ...prev,
      selectedPieceId: id,
      status: id ? `selected ${prev.worldPieces.find((p) => p.id === id)?.pieceId ?? id}` : 'cleared world selection',
    }));
  };

  const armPiece = (pieceId: string) => {
    setState((prev) => ({
      ...prev,
      armedPieceId: pieceId,
      // Arming a piece opens the focus panel on it (Build mode) and clears any
      // placed-piece selection so the panel shows the DEFINITION, not an instance.
      selectedPieceId: null,
      status: `armed ${pieceId}`,
    }));
  };

  // Per-instance override edits (req_2563 Phase 3): patch / clear one property on
  // the selected placed piece. Authoring data on the piece; the host consumes it
  // in a later world_loader slice (today it persists as intent on the instance).
  const setPieceOverride = (id: string, path: string, value: number | boolean) => {
    setState((prev) => recordWorldEdit(prev, {
      ...prev,
      worldPieces: prev.worldPieces.map((p) => (p.id === id ? { ...p, overrides: { ...p.overrides, [path]: value } } : p)),
      status: `${path} = ${value}`,
    }, `override ${path}`));
  };

  const clearPieceOverride = (id: string, path: string) => {
    setState((prev) => recordWorldEdit(prev, {
      ...prev,
      worldPieces: prev.worldPieces.map((p) => {
        if (p.id !== id) return p;
        const next = { ...p.overrides };
        delete next[path];
        return { ...p, overrides: Object.keys(next).length ? next : undefined };
      }),
      status: `${path} reset to default`,
    }, `clear override ${path}`));
  };

  // Material-slot assignment (req_2563 Phase 4): binds the CURRENTLY selected
  // content-browser material into the piece's named slot (piece.slots[role]).
  // One-click flow — pick a material on the left, click a slot on the right.
  const assignPieceSlot = (id: string, role: string) => {
    setState((prev) => {
      const ref: MaterialRef = { assetId: prev.activeAssetId };
      return recordWorldEdit(prev, {
        ...prev,
        worldPieces: prev.worldPieces.map((p) => (p.id === id ? { ...p, slots: { ...p.slots, [role]: ref } } : p)),
        status: `slot ${role} ← ${assetById(prev.activeAssetId, prev.assetOverrides).name}`,
      }, `slot ${role}`);
    });
  };

  const clearPieceSlot = (id: string, role: string) => {
    setState((prev) => recordWorldEdit(prev, {
      ...prev,
      worldPieces: prev.worldPieces.map((p) => {
        if (p.id !== id) return p;
        const next = { ...p.slots };
        delete next[role];
        return { ...p, slots: Object.keys(next).length ? next : undefined };
      }),
      status: `slot ${role} cleared`,
    }, `clear slot ${role}`));
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
      const firstFile = explorerIndex().files.find((file) => explorerMatchesFolder(file, fileExplorerFolder));
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
            at: explorerNowLabel(),
          },
          ...prev.fileExplorerDirectoryHistory.filter((entry) => entry.folderId !== fileExplorerFolder),
        ].slice(0, 4),
        seq: prev.seq + 1,
        status: `file explorer folder: ${explorerFolderLabel(fileExplorerFolder)}`,
      };
    });
  };

  const toggleExplorerFolder = (folder: ExplorerFolderId) => {
    setState((prev) => ({
      ...prev,
      fileExplorerExpanded: { ...prev.fileExplorerExpanded, [folder]: !prev.fileExplorerExpanded[folder] },
      status: `${prev.fileExplorerExpanded[folder] ? 'collapsed' : 'expanded'} file folder ${explorerFolderLabel(folder)}`,
    }));
  };

  // Open a .glb/.obj through the REAL import path: a `file:<path>` model document whose
  // viewer loads the file via the native host mesh importer (__mesh_load_file). The import
  // is seeded as ONE outliner part in the SAME state update the doc opens in, so the
  // surface mounts straight into parts mode (outliner live, part ops working) — never as
  // a view-only model. Its [lo, hi) range is stamped after the host parses the file.
  const openModelFileDocument = (path: string) => {
    // Import for keeps: copy the file into its own Model Package (content browser +
    // every future launch). A failed copy still opens the model, but session-only —
    // and the status says so LOUDLY instead of pretending it was saved.
    const imported = importModelFilePackage(path);
    const pkg = imported ?? fileModelPackage(path);
    const doc = modelDocument(pkg);
    const partPath = pkg.viewerPath ?? path;
    setState((prev) => {
      const seeded = prev.modelParts[pkg.id] ?? [filePartSeed(partPath, pkg.name)];
      return {
        ...prev,
        workspaceDocuments: upsertDocument(prev.workspaceDocuments, doc),
        activeWorkspaceDocumentId: doc.id,
        materialFocused: false,
        contextOpen: false,
        fileExplorerOpen: false,
        modelParts: { ...prev.modelParts, [pkg.id]: seeded },
        modelActivePartId: prev.modelParts[pkg.id] ? prev.modelActivePartId : (seeded[0]?.id ?? prev.modelActivePartId),
        status: imported
          ? `imported ${pkg.name} — saved to the model library (${imported.path})`
          : `opened ${pkg.name} — NOT saved to the library (file copy failed)`,
      };
    });
  };

  const openExplorerFile = (fileId: string, action: string) => {
    const file = explorerFileById(fileId);
    if (!file) {
      setState((prev) => ({ ...prev, status: `${fileId} is no longer on disk — rescan the index` }));
      return;
    }
    setState((prev) => {
      const historyEntry: ExplorerHistoryEntry = {
        id: `fh-${prev.seq}`,
        fileId,
        action,
        query: prev.fileExplorerQuery.trim() || file.name,
        at: explorerNowLabel(),
      };
      return {
        ...prev,
        fileExplorerSelectedId: fileId,
        fileExplorerHistory: [
          historyEntry,
          ...prev.fileExplorerHistory.filter((entry) => entry.fileId !== fileId),
        ].slice(0, 5),
        seq: prev.seq + 1,
        status: `${action} ${file.path}`,
      };
    });
    // Model files actually OPEN: into a model document on the stage via the native
    // importer. Everything else just records (pin/history) — there is no text-file
    // document surface yet.
    if (file.importable && action === 'opened') openModelFileDocument(file.path);
  };

  // File → Import Model: the OS picker (zenity) for a .glb/.obj anywhere on disk,
  // routed through the same native import path as in-project explorer rows.
  // The ONE import door: models open as documents; images run the quantize
  // probe and land in the dual-preview decision dialog (pixel texture vs
  // exact image — see ImportImageDialog).
  const IMAGE_EXT_RE = /\.(png|jpe?g|webp)$/i;
  const importModelFromDisk = async () => {
    const path = await pickFile({
      title: 'Import a model or image',
      filters: [
        { name: '3D models', patterns: ['*.glb', '*.obj'] },
        { name: 'Images', patterns: ['*.png', '*.jpg', '*.jpeg', '*.webp'] },
        { name: 'All files', patterns: ['*'] },
      ],
    });
    if (!path) return;
    if (IMAGE_EXT_RE.test(path)) {
      probeImageImport(path);
      return;
    }
    if (!isViewerFile(path)) {
      setState((prev) => ({ ...prev, status: `cannot import ${path.split('/').pop()} — pick a .glb/.obj model or a .png/.jpg/.webp image` }));
      return;
    }
    openModelFileDocument(path);
  };

  const probeImageImport = (path: string) => {
    const name = path.split('/').pop() ?? path;
    const base64 = readFileBase64(path);
    if (!base64) {
      setState((prev) => ({ ...prev, status: `cannot read ${name}` }));
      return;
    }
    const meta = imageOps(base64).metadata();
    const probe = parseQuantizeProbe(quantizeImage(base64, 64, 128));
    if (!meta || !probe) {
      setState((prev) => ({ ...prev, status: `cannot decode ${name} — not a supported image` }));
      return;
    }
    // Serialized pixel payload size — the decision-facing number; computed for
    // real (probe → RLE JSON) rather than guessed.
    const pixelJson = JSON.stringify(encodeRows(probe.indices, probe.width, probe.height));
    setImportPlan({
      sourcePath: path,
      name,
      probe,
      sourceWidth: meta.width,
      sourceHeight: meta.height,
      sourceKb: Math.max(1, Math.round((base64.length * 0.75) / 1024)),
      pixelKb: Math.max(1, Math.round(pixelJson.length / 1024)),
    });
  };

  const commitImageImport = (form: 'pixel' | 'exact') => {
    const plan = importPlan;
    if (!plan) return;
    setImportPlan(null);
    const manifest = form === 'pixel'
      ? savePixelTexture(plan.name, plan.name, plan.probe)
      : saveExactImage(plan.name, plan.sourcePath, plan.sourceWidth, plan.sourceHeight);
    if (!manifest) {
      setState((prev) => ({ ...prev, status: `import FAILED for ${plan.name} — could not write the texture package` }));
      return;
    }
    reloadImportedTextures();
    setState((prev) => ({
      ...prev,
      status: `imported ${manifest.name} as ${form === 'pixel' ? `pixel texture (${manifest.colors} colors)` : 'exact image'} → ${manifest.id}`,
    }));
  };

  const rescanExplorerIndex = () => {
    const index = refreshExplorerIndex();
    setState((prev) => ({
      ...prev,
      status: `file index rescanned: ${index.files.length} files${index.truncated ? ' (CAPPED — deeper files not listed)' : ''}`,
    }));
  };

  const selectColorStudioMaterial = (specId: string) => {
    setState((prev) => {
      const spec = shaderSpec(specId);
      if (!spec) return { ...prev, status: `Color Studio: unknown material '${specId}'` };
      return {
        ...prev,
        colorStudioMaterial: specId,
        colorStudioVariant: 0,
        colorStudioActiveSlot: 0,
        status: `Color Studio material: ${spec.label} (${spec.slots?.length ?? 0} slots)`,
      };
    });
  };

  const setColorStudioVariant = (variant: number) => {
    setState((prev) => {
      const spec = colorStudioSpec(prev);
      return {
        ...prev,
        colorStudioVariant: variant,
        colorStudioActiveSlot: Math.min(prev.colorStudioActiveSlot, Math.max(0, (spec.slots?.length ?? 1) - 1)),
        status: `Color Studio variant ${spec.variants[variant]?.label ?? variant}: ${spec.label}`,
      };
    });
  };

  const rollColorStudioSeed = () => {
    setState((prev) => {
      const nextSeed = ((prev.colorStudioSeed * 37 + 19) % FILL_SEED_MAX) + 1;
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
      status: `Color Studio quality D[3]=${quality}: ${FILL_GRADES[quality] ?? quality}`,
    }));
  };

  const activateColorStudioSlot = (slot: number) => {
    setState((prev) => {
      const spec = colorStudioSpec(prev);
      const slotName = spec.slots?.[slot]?.name ?? 'slot';
      return {
        ...prev,
        colorStudioActiveSlot: slot,
        status: `Color Studio active slot: ${spec.label} / ${slotName}`,
      };
    });
  };

  const fillColorStudioSlot = (rgb: Rgb, source: string) => {
    setState((prev) => {
      const t0 = Date.now();
      const spec = colorStudioSpec(prev);
      const slot = Math.min(prev.colorStudioActiveSlot, Math.max(0, (spec.slots?.length ?? 1) - 1));
      const slotName = spec.slots?.[slot]?.name ?? 'slot';
      const key = colorStudioOverrideKey(spec.id, prev.colorStudioVariant, slot);
      const editMs = Date.now() - t0;
      return {
        ...prev,
        colorStudioOverrides: { ...prev.colorStudioOverrides, [key]: rgb },
        history: [
          { id: `h-${prev.seq}`, verb: 'slot', target: `${spec.label} ${slotName}`, meta: `${source} -> ${rgbToCss(rgb)}`, undoable: true, editMs, emptyMs: editMs, richMs: editMs },
          ...prev.history,
        ].slice(0, 8),
        redo: [],
        seq: prev.seq + 1,
        status: `filled ${spec.label} ${slotName} from ${source}`,
      };
    });
  };

  const resetColorStudioSlots = () => {
    setState((prev) => {
      const t0 = Date.now();
      const spec = colorStudioSpec(prev);
      const nextOverrides = { ...prev.colorStudioOverrides };
      (spec.slots ?? []).forEach((_, slot) => delete nextOverrides[colorStudioOverrideKey(spec.id, prev.colorStudioVariant, slot)]);
      const editMs = Date.now() - t0;
      return {
        ...prev,
        colorStudioOverrides: nextOverrides,
        history: [
          { id: `h-${prev.seq}`, verb: 'reset', target: `${spec.label} v${prev.colorStudioVariant}`, meta: 'Color Studio reset to baked vec3f defaults', undoable: true, editMs, emptyMs: editMs, richMs: editMs },
          ...prev.history,
        ].slice(0, 8),
        redo: [],
        seq: prev.seq + 1,
        status: `reset ${spec.label} v${prev.colorStudioVariant} to baked defaults`,
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

  const focusMaterialDocument = (variant?: number) => {
    setState((prev) => {
      const asset = assetById(prev.activeAssetId, prev.assetOverrides);
      const doc = materialDocument(asset);
      // Route the selection INTO the Color Studio: a shader-recipe asset's
      // recipe IS a catalog spec id, so focusing lands the studio on that
      // material (and on the take, when a variant chip was the entry point).
      const spec = asset.recipe ? shaderSpec(asset.recipe) : undefined;
      const studio = spec
        ? {
            colorStudioMaterial: spec.id,
            colorStudioVariant: Math.min(variant ?? prev.colorStudioVariant, Math.max(0, spec.variants.length - 1)),
            colorStudioActiveSlot: 0,
            colorStudioView: 'materialPalette' as const,
          }
        : {};
      return {
        ...prev,
        materialFocused: true,
        workspaceDocuments: upsertDocument(prev.workspaceDocuments, doc),
        activeWorkspaceDocumentId: doc.id,
        ...studio,
        status: spec ? `opened Color Studio: ${asset.name}` : `opened material document: ${asset.name}`,
      };
    });
  };

  // The ink popover's "open in Color Studio" — jump from a dipped shader ink to
  // its editing page (selecting the matching library asset when there is one).
  const openColorStudioForSpec = (specId: string) => {
    const spec = shaderSpec(specId);
    if (!spec) return;
    setState((prev) => {
      const match = catalogAssets.find((a) => a.recipe === specId);
      const asset = match ?? assetById(prev.activeAssetId, prev.assetOverrides);
      const doc = materialDocument(asset);
      return {
        ...prev,
        materialFocused: true,
        activeAssetId: match ? match.id : prev.activeAssetId,
        workspaceDocuments: upsertDocument(prev.workspaceDocuments, doc),
        activeWorkspaceDocumentId: doc.id,
        colorStudioMaterial: spec.id,
        colorStudioActiveSlot: 0,
        colorStudioView: 'materialPalette' as const,
        status: `opened Color Studio: ${spec.label}`,
      };
    });
    setPaintPopover(null);
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
  // The single seed for an imported file's base part — used by both the open handler (atomic
  // with the doc open) and the activate effect (restored/persisted docs missing their parts).
  const filePartSeed = (path: string, name: string): ModelPart =>
    ({ id: 'part:file:1', name, sourcePath: path, visible: true, color: PART_TINTS[0]! });
  // Adding a mesh (menu or outliner) opens the size/resolution dialog instead of dropping a
  // fixed unit primitive — you author the dimensions upfront, like the old studio mesh editor.
  // The outliner + adds a part to the model in view → the 'add' verb (append), never a new document.
  const addPart = (kind: PrimitiveKind) => setState((prev) => ({ ...prev, newMeshPrompt: { kind, mode: 'add' } }));
  // Range of a part in the host mesh: its stored [lo, hi) (set on seed/append). The host mesh
  // is authoritative — these ids are stable across deletes and appends within a session.
  const partRange = (part: ModelPart): { lo: number; hi: number } | null =>
    part.lo != null && part.hi != null ? { lo: part.lo, hi: part.hi } : null;

  // 'add' verb — APPEND the primitive as a new PART to the model in view (preserving every prior
  // edit; no JS recompose). Reached from Edit → Mesh → Add Primitive and the outliner +.
  const addPrimitivePart = (kind: PrimitiveKind, params: PrimitiveParams) => {
    const activeModel = activePartsModelId(state);
    if (!activeModel) {
      setState((prev) => ({ ...prev, newMeshPrompt: null, status: 'Open a model first — Add Primitive appends a part to the model in view.' }));
      return;
    }
    const parts = state.modelParts[activeModel] ?? [];
    const part = makePart(kind, parts, state.seq, params);
    // An EMPTIED model has no live viewer to append into (the workspace shows NO
    // VISIBLE PARTS and ModelView is unmounted, host mesh gone with it) — seed the
    // part as the new base instead; the viewer remounts composing it, the same way
    // a fresh document mounts (req_2560).
    if (composeModelParts(parts).positions.length === 0) {
      const seedRange = composeModelParts([{ ...part, visible: true }]).ranges[0];
      const placed: ModelPart = { ...part, lo: seedRange?.lo ?? 0, hi: seedRange?.hi ?? 0 };
      setState((prev) => ({ ...prev, seq: prev.seq + 1, modelParts: { ...prev.modelParts, [activeModel]: [...(prev.modelParts[activeModel] ?? []), placed] }, modelActivePartId: placed.id, newMeshPrompt: null, status: `added ${placed.name} to the empty model` }));
      return;
    }
    const api = modelToolApiRef.current;
    if (!api) {
      setState((prev) => ({ ...prev, newMeshPrompt: null, status: 'Open a model first — Add Primitive appends a part to the model in view.' }));
      return;
    }
    const geo = composeModelParts([{ ...part, visible: true }]);
    const range = geo.positions.length > 0 ? api.appendPart(geo.positions, geo.faceGroups, part.color) : null;
    if (!range) {
      setState((prev) => ({ ...prev, newMeshPrompt: null, status: 'could not add mesh' }));
      return;
    }
    const placed: ModelPart = { ...part, lo: range.lo, hi: range.hi };
    setState((prev) => ({ ...prev, seq: prev.seq + 1, modelParts: { ...prev.modelParts, [activeModel]: [...(prev.modelParts[activeModel] ?? []), placed] }, modelActivePartId: placed.id, newMeshPrompt: null, status: `added ${placed.name}` }));
  };

  // 'new' verb — ALWAYS a fresh model document seeded with this one part (mount composes it), even
  // when a model is already open. This is what makes New ≠ Add: File → New Mesh never appends to
  // whatever's in view; it spawns its own document (req_2542).
  const createNewMeshDocument = (kind: PrimitiveKind, params: PrimitiveParams) => {
    setState((prev) => {
      const docSeq = prev.workspaceDocuments.filter((doc) => doc.id.startsWith('model:primitive:')).length + 1;
      const mid = `primitive:${kind}:${docSeq}`;
      const doc = modelDocument(primitiveModelPackage(mid));
      const base = makePart(kind, [], prev.seq, params);
      const range = composeModelParts([base]).ranges[0];
      const part: ModelPart = { ...base, lo: range?.lo ?? 0, hi: range?.hi ?? 0 };
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
  };

  // The size/resolution dialog's confirm routes to the verb it was opened for.
  const submitMeshPrompt = (prompt: { kind: PrimitiveKind; mode: 'new' | 'add' }, params: PrimitiveParams) => {
    if (prompt.mode === 'add') addPrimitivePart(prompt.kind, params);
    else createNewMeshDocument(prompt.kind, params);
  };

  // RJIT_MODELDOC=<primitive kind> boots straight into a fresh model document seeded with
  // that primitive — the headless gesture-repro path (`rjit shot editor` + RJIT_MESHOPS in
  // ModelView drives real select gestures and captures the result). Unset = no-op.
  useEffect(() => {
    const kind = (globalThis as any).__env_get?.('RJIT_MODELDOC') as PrimitiveKind | null | undefined;
    if (kind) createNewMeshDocument(kind, { size: 1, height: 1, resolution: 1 });
  }, []);
  const selectPart = (id: string) => {
    // Focus a part = SCOPE editing to it: only its verts/edges/faces show + select, and the
    // gizmo drives just it. Clicking the already-focused part toggles back to the whole model.
    const host = globalThis as any;
    const mid = activePartsModelId(state);
    const part = mid ? (state.modelParts[mid] ?? []).find((p) => p.id === id) : null;
    const range = part ? partRange(part) : null;
    const alreadyFocused = state.modelActivePartId === id;
    if (range && !alreadyFocused) {
      host.__mesh_edit_scope?.(range.lo, range.hi);
      host.__mesh_edit_select_group_range?.(range.lo, range.hi, 0);
    } else {
      host.__mesh_edit_scope?.(0, 0); // toggle off → edit the whole model
      host.__mesh_edit_clear?.();
    }
    setState((prev) => ({ ...prev, modelActivePartId: alreadyFocused ? null : id }));
  };
  const toggleVisiblePart = (id: string) => {
    const mid = activePartsModelId(state);
    const part = mid ? (state.modelParts[mid] ?? []).find((p) => p.id === id) : null;
    const range = part ? partRange(part) : null;
    // Mark the part hidden in the ref BEFORE the host op: the hide drops the displayed
    // tri count, which fires reconcileEmptyParts against state where this part still
    // reads visible:true — without the ref it prunes the just-hidden part like a delete.
    if (part && range) {
      if (part.visible) hiddenPartIdsRef.current.add(id);
      else hiddenPartIdsRef.current.delete(id);
    }
    // Hide if currently shown. The outcome is reported LOUDLY: a silent no-op here reads
    // as "everything vanished" with no trail. verb+range+remaining tris tell the story.
    const r = range ? modelToolApiRef.current?.setPartHidden(range.lo, range.hi, part!.visible) : null;
    if (part && range && !r?.ok) {
      // Host op failed — undo the ref move so reconcile semantics match reality.
      if (part.visible) hiddenPartIdsRef.current.delete(id);
      else hiddenPartIdsRef.current.add(id);
    }
    const verb = part?.visible ? 'hid' : 'showed';
    const status = !part
      ? 'part not found'
      : !range
        ? `cannot ${part.visible ? 'hide' : 'show'} ${part.name} — its host range is not stamped yet`
        : r?.ok
          ? `${verb} ${part.name} [${range.lo},${range.hi}) — ${r.count} tris remain in the mesh`
          : `could not ${part.visible ? 'hide' : 'show'} ${part.name} [${range.lo},${range.hi}) — host op failed`;
    setState((prev) => ({ ...prev, status, modelParts: { ...prev.modelParts, [mid!]: (prev.modelParts[mid!] ?? []).map((p) => (p.id === id ? { ...p, visible: !p.visible } : p)) } }));
  };
  const deletePart = (id: string) => {
    const mid = activePartsModelId(state);
    const allParts = mid ? (state.modelParts[mid] ?? []) : [];
    const part = allParts.find((p) => p.id === id) ?? null;
    const range = part ? partRange(part) : null;
    // Deleting the LAST visible part: the host refuses to empty a mesh (its guard),
    // so don't ask it — removing the part unmounts the viewer, which drops the host
    // mesh with it. Empty model IS the outcome we want here (req_2560).
    const lastVisible = Boolean(part?.visible) && composeModelParts(allParts.filter((p) => p.id !== id)).positions.length === 0;
    const r = !lastVisible && range && part!.visible ? modelToolApiRef.current?.deletePartRange(range.lo, range.hi) : null;
    const status = part && range && part.visible
      ? (lastVisible
        ? `deleted ${part.name} — model is now empty`
        : r?.ok
          ? `deleted ${part.name} [${range.lo},${range.hi}) — ${r.count} tris remain`
          : `could not delete ${part.name} [${range.lo},${range.hi}) — host op failed`)
      : `removed ${part?.name ?? id} from the outliner`;
    hiddenPartIdsRef.current.delete(id);
    setState((prev) => {
      const parts = (prev.modelParts[mid!] ?? []).filter((p) => p.id !== id);
      return { ...prev, status, modelParts: { ...prev.modelParts, [mid!]: parts }, modelActivePartId: prev.modelActivePartId === id ? (parts[0]?.id ?? null) : prev.modelActivePartId };
    });
  };
  // The host mesh is authoritative, so a delete just changes it — parts are metadata. After a
  // delete, drop any part whose group range now has ZERO surviving faces (metadata only; no
  // geometry crosses the bridge, no recompose). Visible parts only (a hidden part is stashed in
  // the host, not deleted). Runs off the full-quality triangle drop below.
  //
  // hiddenPartIdsRef is the SYNCHRONOUS twin of each part's `visible` flag: hiding a part
  // drops the tri count and fires this reconcile BEFORE the visible:false state flip lands,
  // so the flag alone reads stale (visible:true, 0 surviving faces) and the just-hidden
  // part would be pruned like a delete. toggleVisiblePart writes the ref before the host op.
  const hiddenPartIdsRef = useRef(new Set<string>());
  const reconcileEmptyParts = () => {
    const mid = activePartsModelId(state);
    if (!mid) return;
    const hostFns = globalThis as any;
    const empty = new Set<string>();
    for (const p of state.modelParts[mid] ?? []) {
      const r = partRange(p);
      if (!p.visible || hiddenPartIdsRef.current.has(p.id) || !r) continue;
      if ((hostFns.__mesh_group_face_count?.(r.lo, r.hi) ?? -1) === 0) empty.add(p.id);
    }
    if (empty.size === 0) return;
    setState((prev) => {
      const list = (prev.modelParts[mid] ?? []).filter((p) => !empty.has(p.id));
      return {
        ...prev,
        modelParts: { ...prev.modelParts, [mid]: list },
        modelActivePartId: prev.modelActivePartId && empty.has(prev.modelActivePartId) ? (list[0]?.id ?? null) : prev.modelActivePartId,
        status: `removed ${empty.size} emptied part(s)`,
      };
    });
  };
  // The model's live triangle count is mirrored up via onToolState. A DROP at FULL quality means
  // faces were deleted (loop cut only grows; gizmo moves don't change the count) → drop any part
  // left empty. The full-quality gate matters: decimation drops the DISPLAYED count without
  // touching source faces, so a group's count could read 0 mid-decimation and falsely prune.
  const prevTrisRef = useRef(0);
  useEffect(() => {
    const tris = state.modelTool.tris;
    if (tris < prevTrisRef.current && state.modelTool.quality >= 0.999) reconcileEmptyParts();
    prevTrisRef.current = tris;
  }, [state.modelTool.tris]);

  // ── Studio-parity part ops (req_2520) ────────────────────────────────────────
  // Duplicate a part (mirrorAxis 0/1/2 = mirrored twin across that origin plane;
  // -1 = plain copy). The host copies geometry + paint and returns the new range;
  // the outliner gains a row. A mirrored/cloned SEED mesh rides along when the
  // source part has one, so the copy survives a document remount.
  const duplicatePartById = (id: string | null, mirrorAxis: number) => {
    const mid = activePartsModelId(state);
    const api = modelToolApiRef.current;
    const part = mid && id ? (state.modelParts[mid] ?? []).find((p) => p.id === id) : null;
    const range = part ? partRange(part) : null;
    if (!mid || !api || !part || !range) {
      setState((prev) => ({ ...prev, status: 'duplicate needs a focused part with a stamped range' }));
      return;
    }
    if (!part.visible) {
      setState((prev) => ({ ...prev, status: `cannot duplicate ${part.name} while it is hidden — show it first` }));
      return;
    }
    const r = api.duplicatePart(range.lo, range.hi, mirrorAxis);
    if (!r) {
      setState((prev) => ({ ...prev, status: `could not duplicate ${part.name} [${range.lo},${range.hi}) — host op failed` }));
      return;
    }
    const axisName = mirrorAxis >= 0 ? ` mirror ${'XYZ'[mirrorAxis]}` : ' copy';
    const seed = part.mesh ? (mirrorAxis >= 0 ? mirrorMesh(part.mesh, mirrorAxis as 0 | 1 | 2) : cloneMesh(part.mesh)) : undefined;
    const placed: ModelPart = { id: `part:dup:${state.seq}`, name: `${part.name}${axisName}`, kind: part.kind, ...(seed ? { mesh: seed } : {}), visible: true, color: part.color, lift: part.lift, lo: r.lo, hi: r.hi };
    setState((prev) => ({
      ...prev,
      seq: prev.seq + 1,
      modelParts: { ...prev.modelParts, [mid]: [...(prev.modelParts[mid] ?? []), placed] },
      modelActivePartId: placed.id,
      status: `${mirrorAxis >= 0 ? 'mirrored' : 'duplicated'} ${part.name} → ${placed.name} [${r.lo},${r.hi})`,
    }));
  };

  // Detach the face-mode selection into a NEW part (host group remap — geometry and
  // paint stay put). The panel becomes the focused part, ready to grab with the gizmo.
  const runDetachSelection = () => {
    const mid = activePartsModelId(state);
    const api = modelToolApiRef.current;
    if (!mid || !api) {
      setState((prev) => ({ ...prev, status: 'detach needs an open multi-part model document' }));
      return;
    }
    const r = api.detachSelection();
    if (!r) {
      setState((prev) => ({ ...prev, status: 'detach: select faces first (face mode) — and the whole mesh cannot detach from itself' }));
      return;
    }
    const parts = state.modelParts[mid] ?? [];
    const n = parts.filter((p) => p.id.startsWith('part:detach:')).length + 1;
    const placed: ModelPart = { id: `part:detach:${state.seq}`, name: `Detached ${n}`, visible: true, color: PART_TINTS[parts.length % PART_TINTS.length]!, lo: r.lo, hi: r.hi };
    setState((prev) => ({
      ...prev,
      seq: prev.seq + 1,
      modelParts: { ...prev.modelParts, [mid]: [...(prev.modelParts[mid] ?? []), placed] },
      modelActivePartId: placed.id,
      status: `detached selection → ${placed.name} [${r.lo},${r.hi})`,
    }));
  };

  // Merge the focused part DOWN into the part above it in the outliner (the old
  // studio's durable re-attach path). Host fuses the ranges; seeds merge when both
  // parts carry one so the union survives a remount.
  const mergeActivePartDown = () => {
    const mid = activePartsModelId(state);
    const api = modelToolApiRef.current;
    const parts = mid ? (state.modelParts[mid] ?? []) : [];
    const idx = parts.findIndex((p) => p.id === state.modelActivePartId);
    if (!mid || !api || idx < 1) {
      setState((prev) => ({ ...prev, status: 'merge down needs a focused part with another part above it' }));
      return;
    }
    const above = parts[idx - 1]!;
    const active = parts[idx]!;
    const ra = partRange(above);
    const rb = partRange(active);
    if (!ra || !rb) {
      setState((prev) => ({ ...prev, status: 'merge down: both parts need stamped host ranges' }));
      return;
    }
    const r = api.mergeParts(ra.lo, ra.hi, rb.lo, rb.hi);
    if (!r) {
      setState((prev) => ({ ...prev, status: `could not merge ${active.name} into ${above.name} — host op failed` }));
      return;
    }
    const seed = above.mesh && active.mesh
      ? mergeMesh(above.mesh, active.mesh, [0, (active.lift ?? 0) - (above.lift ?? 0), 0])
      : undefined;
    const merged: ModelPart = { ...above, ...(seed ? { mesh: seed } : { mesh: undefined, kind: undefined }), lo: r.lo, hi: r.hi };
    setState((prev) => {
      const list = (prev.modelParts[mid] ?? []).filter((p) => p.id !== active.id).map((p) => (p.id === above.id ? merged : p));
      return {
        ...prev,
        modelParts: { ...prev.modelParts, [mid]: list },
        modelActivePartId: merged.id,
        status: `merged ${active.name} into ${above.name} [${r.lo},${r.hi})`,
      };
    });
  };

  // Face-selection ops that don't change part structure: glass / solidify / merge-faces.
  const runFaceOp = (kind: 'glass' | 'solidify' | 'merge-faces') => {
    const api = modelToolApiRef.current;
    const ok = kind === 'glass' ? api?.glassSelection() : kind === 'solidify' ? api?.solidifySelection() : api?.mergeFaces();
    const okMsg = kind === 'glass' ? 'toggled glass on the selected faces' : kind === 'solidify' ? 'solidified the selected faces (inner skin + rim walls)' : 'merged the selection into one face';
    const failMsg = kind === 'merge-faces'
      ? 'merge faces: select 2+ faces (face mode) first'
      : `${kind}: select faces first (face mode)`;
    setState((prev) => ({ ...prev, status: ok ? okMsg : failMsg }));
  };

  // Cross-model reuse: append a saved library model into the OPEN model as new part(s).
  // Studio models import per authored part (seeds ride along); cooked assets append
  // their triangle blob; file-backed models host-parse via __mesh_append_file. Pick the
  // same model again to reuse it any number of times.
  const importModelAsParts = (pkg: ModelPackage) => {
    setImportPartOpen(false);
    const mid = activePartsModelId(state);
    const api = modelToolApiRef.current;
    if (!mid || !api) {
      setState((prev) => ({ ...prev, status: 'open a model document first — library imports land as parts of the open model' }));
      return;
    }
    const existing = state.modelParts[mid] ?? [];
    let tint = existing.length;
    const nextColor = () => PART_TINTS[tint++ % PART_TINTS.length]!;
    const added: ModelPart[] = [];
    const bareId = pkg.id.startsWith('studio:') ? pkg.id.slice('studio:'.length) : pkg.id;
    const sparts = pkg.sourceKind === 'studio-model' ? storedModelParts(bareId) : null;
    if (sparts && sparts.length > 0) {
      for (const sp of sparts) {
        if (!sp.mesh) continue;
        const geo = composeModelParts([{ ...sp, visible: true }]);
        if (geo.positions.length === 0) continue;
        const color = sp.color ?? nextColor();
        const r = api.appendPart(geo.positions, geo.faceGroups, color);
        if (!r) continue;
        added.push({ id: `part:imp:${state.seq}:${added.length}`, name: `${pkg.name} · ${sp.name}`, mesh: cloneMesh(sp.mesh), visible: true, color, lift: sp.lift, lo: r.lo, hi: r.hi });
      }
    } else if (pkg.primitive) {
      const built = primitiveMeshData(pkg.primitive);
      const color = nextColor();
      const r = built.positions.length > 0 ? api.appendPart(built.positions, built.faceGroups, color) : null;
      if (r) added.push({ id: `part:imp:${state.seq}:0`, name: pkg.name, kind: pkg.primitive, mesh: primitivePartMesh(pkg.primitive), visible: true, color, lo: r.lo, hi: r.hi });
    } else {
      const cookedId = pkg.id.startsWith('cooked:') ? pkg.id.slice('cooked:'.length) : pkg.id;
      const meshRef = pkg.viewerMeshRef ?? (pkg.sourceKind === 'cooked-asset' ? cookedMeshRefForAsset(cookedId) : null);
      const blob = meshRef ? cookedMeshBlobData(meshRef) : (pkg.sourceKind === 'studio-model' ? storedModelMeshData(bareId) : null);
      if (blob && blob.length >= 24) {
        const tris = Math.floor(blob.length / 24);
        const stored = pkg.sourceKind === 'studio-model' ? storedModelFaceGroupData(bareId) : null;
        let groups: Uint32Array;
        if (stored && stored.length === tris) {
          groups = stored;
        } else {
          groups = new Uint32Array(tris);
          for (let i = 0; i < tris; i++) groups[i] = i;
        }
        const color = nextColor();
        const r = api.appendPart(blob, groups, color);
        if (r) added.push({ id: `part:imp:${state.seq}:0`, name: pkg.name, visible: true, color, lo: r.lo, hi: r.hi });
      } else if (pkg.viewerPath && isViewerFile(pkg.viewerPath)) {
        const color = nextColor();
        const r = api.appendModelFile(pkg.viewerPath, color);
        if (r) added.push({ id: `part:imp:${state.seq}:0`, name: pkg.name, visible: true, color, lo: r.lo, hi: r.hi });
      }
    }
    if (added.length === 0) {
      setState((prev) => ({ ...prev, status: `could not import ${pkg.name} — no usable geometry (studio parts, cooked mesh blob, or a .glb/.obj file)` }));
      return;
    }
    setState((prev) => ({
      ...prev,
      seq: prev.seq + 1,
      modelParts: { ...prev.modelParts, [mid]: [...(prev.modelParts[mid] ?? []), ...added] },
      modelActivePartId: added[added.length - 1]!.id,
      status: `imported ${pkg.name} as ${added.length} part(s) — pick it again to reuse it`,
    }));
  };

  // ── Mesh undo/redo (host journal; req_2520) ──────────────────────────────────
  // Seed meshes by part id, kept for the session so a restored part row regains its
  // seed (the journal note carries part METADATA only — meshes never ride the note).
  const partMeshSeedsRef = useRef<Record<string, EditMesh>>({});
  const meshUndoRedo = (redo: boolean) => {
    const api = modelToolApiRef.current;
    const mid = activePartsModelId(state);
    const r = redo ? api?.redoMesh() : api?.undoMesh();
    const verb = redo ? 'redo' : 'undo';
    if (!r?.ok) {
      setState((prev) => ({ ...prev, status: `nothing to ${verb} on this model` }));
      return;
    }
    let restored: ModelPart[] | null = null;
    if (r.note && mid) {
      try {
        const o = JSON.parse(r.note);
        if (o?.modelId === mid && Array.isArray(o.parts)) {
          restored = (o.parts as ModelPart[]).map((p) => {
            const seed = partMeshSeedsRef.current[p.id];
            return seed ? { ...p, mesh: seed } : p;
          });
        }
      } catch { /* stale/foreign note — the geometry restored; part rows stay as-is */ }
    }
    if (restored && mid) {
      api!.setPartRangesMirror(restored.filter((p) => p.lo != null && p.hi != null).map((p) => ({ lo: p.lo!, hi: p.hi! })));
      setState((prev) => {
        const keep = restored!;
        return {
          ...prev,
          modelParts: { ...prev.modelParts, [mid]: keep },
          modelActivePartId: keep.some((p) => p.id === prev.modelActivePartId) ? prev.modelActivePartId : (keep[0]?.id ?? null),
          status: `${verb} ${r.label}`,
        };
      });
    } else {
      setState((prev) => ({ ...prev, status: `${verb} ${r.label}` }));
    }
  };

  // Mirror the outliner's parts metadata into the host journal note after EVERY parts
  // change, so the snapshot taken by the NEXT op carries the pre-op outliner state.
  // Meshes stay out of the note (session seed cache above); only metadata crosses.
  useEffect(() => {
    const mid = activePartsModelId(state);
    if (!mid) return;
    const parts = state.modelParts[mid] ?? [];
    for (const p of parts) {
      if (p.mesh) partMeshSeedsRef.current[p.id] = p.mesh;
    }
    const lite = parts.map(({ mesh: _mesh, ...rest }) => rest);
    (globalThis as any).__mesh_journal_note?.(JSON.stringify({ modelId: mid, parts: lite }));
  }, [state.modelParts, state.activeWorkspaceDocumentId]);

  // One central, surface-aware hotkey layer (req_2540). Every key edge resolves through the keymap
  // against the surface in view — so the key a menu advertises is the key that fires. World tools
  // (B/V/P/…), the model mesh tools (routed to the host api / face-op handlers), global chords
  // (Ctrl+Z/S/O/…) and undo/redo all dispatch through the same runCommand path as the menus.
  // ModelView keeps only viewport-native Esc/Delete. Refs keep the once-installed subscription
  // reading live state + the current runCommand. (The engine routes keys to focused text inputs
  // first, so typing in a field never triggers a command.)
  const stateRef = useRef(state);
  stateRef.current = state;
  const runCommandRef = useRef(runCommand);
  runCommandRef.current = runCommand;
  // Subscribed DIRECTLY to the __keydown bus and normalized through modifiersFromKeyEvent:
  // the winning key bridge (useIFTTT's) emits ctrlKey/shiftKey flags with no `mods` object,
  // so useModifiers.onKeyDown handed every chord all-false modifiers — Ctrl+Z arrived as
  // bare 'z' and the whole keyboard undo path was dead (req_2620 gap W root cause).
  useEffect(() => subscribe('__keydown', (e: any) => {
    const s = stateRef.current;
    const key = typeof e?.key === 'string' ? e.key : '';
    if (!key) return;
    const mods = modifiersFromKeyEvent(e);
    // An open menu owns input — don't leak a hotkey to a command behind it (same reason
    // overlays block clicks, req_2167).
    if (s.openMenu) return;
    // Modal discipline (req_2626 HH): while a blocker is unresolved, Esc CANCELS the
    // shell-owned dialogs (the viewer-owned sessions handle their own Esc inside
    // ModelView), and any other command-shaped key gets the honest refusal — not silence.
    const block = blockingNowRef.current(s);
    if (block) {
      if (key === 'escape') {
        if (block.id === 'new-mesh') setState((prev) => ({ ...prev, newMeshPrompt: null, status: `${prev.newMeshPrompt?.mode === 'add' ? 'add' : 'new'} mesh cancelled` }));
        else if (block.id === 'file-explorer') setState((prev) => ({ ...prev, fileExplorerOpen: false, status: 'file explorer closed' }));
        else if (block.id === 'build-journal') setState((prev) => ({ ...prev, buildDialogOpen: false, status: 'build journal closed' }));
        else if (block.id === 'import-image') setImportPlan(null);
        else if (block.id === 'import-part') setImportPartOpen(false);
        return;
      }
      if (key.length === 1 || ['enter', 'delete', 'backspace', 'tab', 'space'].includes(key)) {
        setState((prev) => ({ ...prev, status: `resolve ${block.label} first — finish or cancel it before doing anything else` }));
      }
      return;
    }
    const id = commandForKeyEvent(s, key, mods);
    if (id) runCommandRef.current(id, 'hotkey');
  }), []);

  // RJIT_EDKEYS: ';'-separated synthetic key edges driven through the LIVE bridge
  // (syntheticKeyEdge → __ifttt_onKeyDown), 300ms apart — the headless proof of the
  // WORLD-surface undo path (`rjit shot editor` + RJIT_EDKEYS="b;ctrl,z"): the world
  // has no RJIT_MESHOPS host, so this is its gesture harness. Each step logs the
  // post-dispatch state a beat later (setState flushes between steps). Unset = no-op.
  useEffect(() => {
    const script = (globalThis as any).__env_get?.('RJIT_EDKEYS') as string | null | undefined;
    if (!script) return;
    const steps = script.split(';').map((sp) => sp.trim()).filter(Boolean);
    steps.forEach((step, i) => {
      setTimeout(() => {
        const parts = step.split(',').map((p) => p.trim()).filter(Boolean);
        const { sym, mod } = syntheticKeyEdge(parts);
        console.error(`[edkeys] ${parts.join('+')} (sym=${sym} mod=${mod})`);
        setTimeout(() => {
          const s = stateRef.current;
          console.error(`[edkeys] after ${parts.join('+')} → status="${s.status}" worldUndo=${s.worldUndo.length} worldRedo=${s.worldRedo.length} objects=${s.objects.filter((o) => !o.hidden).length} pieces=${s.worldPieces.length}`);
        }, 150);
      }, 800 + i * 300);
    });
  }, []);

  // Studio colour → brush ink. The viewer owns the live brush; this is the ONE
  // sync point pouring the spine's current colour into a colour-kind ink.
  // It reconciles on EITHER side changing (req_2538): keying only on spine picks
  // left the mount gap — a fresh ModelView starts on its default coral ink while
  // the swatch shows the spine's colour (its default is orange, colorSpine.ts),
  // so the toolbar displayed one colour and the brush deposited another until the
  // first pick. Converges then no-ops (equal hexes bail), so no feedback loop.
  useEffect(() => {
    const brush = state.modelTool.brush;
    if (!brush || brush.ink.kind !== 'color') return;
    const hex = oklchToHex(state.colorSpineCurrent);
    if (brush.ink.hex.toLowerCase() === hex.toLowerCase()) return;
    modelToolApiRef.current?.setBrush({ ...brush, ink: { kind: 'color', hex } });
  }, [state.colorSpineCurrent, state.modelTool.brush]);

  // Color Studio slot overrides for the PAINT path: the shader-ink pickers ask
  // for (specId, variant) and fold the user's palette into the ink data[].
  const paintPaletteFor = (specId: string, variant: number): Rgb[] | null => {
    const spec = shaderSpec(specId);
    return spec ? paletteForSpecVariant(state.colorStudioOverrides, spec, variant) : null;
  };

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

  // On a model doc activating: seed its parts (Studio models bring stored parts; primitive
  // models seed themselves on create; an imported file doc seeds ONE file-backed part) AND
  // stamp each part's [lo, hi] group range from the compose that the viewer loads on THIS
  // mount. Refreshing on every activate keeps the ranges matched to the freshly-composed
  // host mesh after a doc switch (the host is authoritative only within a session; a
  // remount rebuilds the seed). Fires once per activate.
  useEffect(() => {
    const doc = state.workspaceDocuments.find((d) => d.id === state.activeWorkspaceDocumentId);
    const mid = doc?.kind === 'model' ? doc.sourceId : undefined;
    if (!mid) return;
    const existing = state.modelParts[mid];
    let parts = existing;
    if (!parts) {
      // Any package whose viewer source is a raw .glb/.obj file (import: packages,
      // file: opens, content-browser loose files, imported props) is a model OF ONE
      // PART (the whole file) — outliner-first, like everything else. Its range is
      // stamped by the viewer after the host parses it.
      const filePath = modelPackageById(mid)?.viewerPath;
      if (filePath && isViewerFile(filePath)) {
        parts = [filePartSeed(filePath, modelPackageById(mid)!.name)];
      } else {
        const bareId = mid.startsWith('studio:') ? mid.slice('studio:'.length) : mid;
        parts = storedModelParts(bareId) ?? undefined;
      }
      if (!parts) return;
    }
    if (parts.some((p) => p.sourcePath)) {
      // File-backed docs get their TRUE ranges from the viewer's onStampRanges after the
      // host load — a JS compose can't know where the file's triangles land. Seed only.
      if (!existing) {
        const seeded = parts;
        setState((prev) => ({
          ...prev,
          modelParts: { ...prev.modelParts, [mid]: seeded },
          modelActivePartId: seeded[0]?.id ?? prev.modelActivePartId,
        }));
      }
      return;
    }
    const rangeById = new Map(composeModelParts(parts).ranges.map((r) => [r.id, r]));
    const withRanges = parts.map((p) => { const r = rangeById.get(p.id); return { ...p, lo: r?.lo, hi: r?.hi }; });
    setState((prev) => ({
      ...prev,
      modelParts: { ...prev.modelParts, [mid]: withRanges },
      modelActivePartId: existing ? prev.modelActivePartId : (withRanges[0]?.id ?? prev.modelActivePartId),
    }));
  }, [state.activeWorkspaceDocumentId]);

  // A file-backed mount reports where each part landed in the host mesh (base import =
  // [0, tris); replayed appends get host-assigned ranges) — stamp them onto the outliner.
  const stampModelPartRanges = (modelId: string, ranges: { partId: string; lo: number; hi: number }[]) => {
    setState((prev) => ({
      ...prev,
      modelParts: {
        ...prev.modelParts,
        [modelId]: (prev.modelParts[modelId] ?? []).map((p) => {
          const r = ranges.find((x) => x.partId === p.id);
          return r ? { ...p, lo: r.lo, hi: r.hi } : p;
        }),
      },
    }));
  };

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

  // MAPPAINT req_2484: one patch door for the Map Paint bar. The controller
  // (stage/mapPaint.ts) mirrors every change into the host tool — arming loads
  // the saved painting + pushes the ground look; a zone-list change re-pushes
  // the zone palette; the armed tool always re-pushes.
  const patchMapPaint = (patch: Partial<EditorState['mapPaint']>) => {
    setState((prev) => {
      const mapPaint = { ...prev.mapPaint, ...patch };
      applyMapPaintEffects(prev.mapPaint, mapPaint);
      return { ...prev, mapPaint };
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

  // The ONE outliner handler set (Workspace + Inspector mount the same object). Part
  // mutations are guarded: they must not fire over an unresolved blocking session
  // (req_2626 HH — e.g. adding/deleting parts mid loop-cut stacks state on a captured
  // base mesh). onStampRanges stays unguarded — it's the viewer REPORTING ranges, not input.
  const outlinerHandlers = {
    onSelectPart: guarded(selectPart),
    onToggleVisiblePart: guarded(toggleVisiblePart),
    onDeletePart: guarded(deletePart),
    onAddPart: guarded(addPart),
    onDuplicatePart: guarded((id: string) => duplicatePartById(id, -1)),
    onImportModel: guarded(() => setImportPartOpen(true)),
    onStampRanges: stampModelPartRanges,
  };

  return (
    <C.HW_App>
      <RenderProbe id="Chrome">
        <Chrome
          state={state}
          activeCommand={activeCommand}
          onMenu={guarded((menu: Menu) => setState((prev) => ({ ...prev, actionMenu: menu, openMenu: prev.openMenu === menu ? null : menu })))}
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
            activeAsset={activeAsset}
            onCommand={runCommand}
            onModelToolApi={(api: ModelToolApi) => { modelToolApiRef.current = api; }}
            onModelToolState={(modelTool: ModelToolSnapshot) => setState((prev) => ({ ...prev, modelTool }))}
            modelContextTrigger={modelMenu.triggerProps}
            outlinerHandlers={outlinerHandlers}
            // Mode row / action-bar controls are guarded (req_2626 HH): arming tools or
            // flipping view state while a blocking session is unresolved is the exact
            // "switch up to paint mid loop-cut" the user ruled WRONG.
            onTool={guarded((id: string) => setState((prev) => ({ ...prev, actionMenu: commandById(id).menu, activeCommandId: id, status: `armed ${commandById(id).name}` })))}
            onSnap={guarded(() => setState((prev) => ({ ...prev, snapIndex: (prev.snapIndex + 1) % SNAP_MODES.length, status: `snap: ${SNAP_MODES[(prev.snapIndex + 1) % SNAP_MODES.length]}` })))}
            onFloor={guarded((delta: number) => setState((prev) => {
              const floorIndex = Math.max(0, Math.min(MAX_FLOOR, prev.floorIndex + delta));
              return { ...prev, floorIndex, status: floorIndex === 0 ? 'floor: Ground' : `floor: Floor ${floorIndex}` };
            }))}
            onWallsDown={guarded(() => setState((prev) => ({ ...prev, wallsDown: !prev.wallsDown, status: prev.wallsDown ? 'walls up — this floor\'s walls show again' : 'walls down — this floor\'s walls hidden for interior editing' })))}
            onViewMode={guarded((viewMode: EditorState['viewMode']) => setState((prev) => ({ ...prev, viewMode, status: `view mode: ${viewMode}` })))}
            onMapPaint={patchMapPaint}
            paintBar={
              /* The paint controls segment for the ACTION BAR (ToolOptions) — the row the
                 Paint/Vertex/wireframe buttons live in, which is THE toolbar for tools
                 (req_2552; the chrome/menu row was the wrong gutter). Popovers still
                 render late at the root so they paint over the body. */
              state.modelTool.paint ? (
                <PaintToolbar
                  brush={state.modelTool.brush}
                  brushTool={state.modelTool.brushTool}
                  detail={state.modelTool.detail}
                  onBrush={(b) => modelToolApiRef.current?.setBrush(b)}
                  onBrushTool={(t) => modelToolApiRef.current?.brushTool(t)}
                  onCycleDetail={() => modelToolApiRef.current?.cycleDetail()}
                  popover={paintPopover}
                  onToggle={guarded((which: PaintPopover) => setPaintPopover((p) => (p === which ? null : which)))}
                  current={state.colorSpineCurrent}
                  palette={state.colorSpinePalette}
                  scenePick={state.colorSpineScenePick}
                  paletteFor={paintPaletteFor}
                  spine={{
                    onSetCurrent: setColorSpineCurrent,
                    onAddToTray: addColorSpineToTray,
                    onPickTray: pickColorSpineTray,
                    onScenePick: pickColorSpineScene,
                    onLoadLibrarySet: loadColorSpineLibrarySet,
                  }}
                />
              ) : null
            }
            // Doc switching mid-blocking-session would unmount the surface that owns the
            // session (loop cut's captured base mesh dies with it) — guarded (req_2626 HH).
            onWorkspaceDocument={guarded(selectWorkspaceDocument)}
            onCloseWorkspaceDocument={guarded(closeWorkspaceDocument)}
            onStage={() => runCommand(state.activeCommandId, 'stage')}
            onContext={guarded(() => setState((prev) => ({ ...prev, contextOpen: !prev.contextOpen, openMenu: null, status: prev.contextOpen ? 'context menu closed' : 'context menu opened' })))}
            onObject={selectObject}
            onPlacePiece={placePiece}
            onSelectPiece={selectPiece}
            onArmPiece={armPiece}
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
            onSetPieceOverride={setPieceOverride}
            onClearPieceOverride={clearPieceOverride}
            onAssignSlot={assignPieceSlot}
            onClearSlot={clearPieceSlot}
            outlinerHandlers={outlinerHandlers}
            colorSpine={{
              onSetCurrent: setColorSpineCurrent,
              onAddToTray: addColorSpineToTray,
              onPickTray: pickColorSpineTray,
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
          onBuild={guarded(() => setState((prev) => ({ ...prev, buildDialogOpen: true, eventbusPopoverOpen: false, perfPopoverOpen: false, memoryPopoverOpen: false, status: `opened build journal ${journal.activeBuild}` })))}
          onEventbus={guarded(() => setState((prev) => ({ ...prev, eventbusPopoverOpen: !prev.eventbusPopoverOpen, perfPopoverOpen: false, memoryPopoverOpen: false, status: prev.eventbusPopoverOpen ? 'eventbus review closed' : 'eventbus review opened' })))}
          // Toolbar undo/redo route EXACTLY like Ctrl+Z — through runCommand, which
          // sends a model doc to the host mesh journal and the world to the real
          // world undo stacks (req_2620 W). Never the old feed-splice placebo.
          onUndo={() => runCommand('undo-local', 'dock')}
          onRedo={() => runCommand('redo-local', 'dock')}
          onPerf={guarded(() => setState((prev) => ({ ...prev, perfPopoverOpen: !prev.perfPopoverOpen, memoryPopoverOpen: false, eventbusPopoverOpen: false, buildDialogOpen: false, status: prev.perfPopoverOpen ? 'performance churn closed' : 'performance churn opened' })))}
          onMemory={guarded(() => setState((prev) => ({ ...prev, memoryPopoverOpen: !prev.memoryPopoverOpen, perfPopoverOpen: false, eventbusPopoverOpen: false, buildDialogOpen: false, status: prev.memoryPopoverOpen ? 'memory accumulation closed' : 'memory accumulation opened' })))}
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
          kind={state.newMeshPrompt.kind}
          mode={state.newMeshPrompt.mode}
          onCancel={() => setState((prev) => ({ ...prev, newMeshPrompt: null, status: `${prev.newMeshPrompt?.mode === 'add' ? 'add' : 'new'} mesh cancelled` }))}
          onAdd={(params) => submitMeshPrompt(state.newMeshPrompt!, params)}
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
            onSelectFile={(fileExplorerSelectedId) => setState((prev) => ({ ...prev, fileExplorerSelectedId, status: `selected file ${explorerFileById(fileExplorerSelectedId)?.path ?? fileExplorerSelectedId}` }))}
            onOpenFile={openExplorerFile}
            onImportFromDisk={() => { void importModelFromDisk(); }}
            onRescan={rescanExplorerIndex}
            onClose={() => setState((prev) => ({ ...prev, fileExplorerOpen: false, status: 'file explorer closed' }))}
          />
        </RenderProbe>
      ) : null}
      {state.openMenu ? (
        <RenderProbe id="Menu Dropdown">
          <DropdownMenu state={state} onCommand={runCommand} onToggleLight={(which) => modelToolApiRef.current?.toggleLight(which)} />
        </RenderProbe>
      ) : null}
      {!playing && state.modelTool.paint && paintPopover ? (
        <RenderProbe id="Paint Popovers">
          <PaintPopovers
            popover={paintPopover}
            onClose={() => setPaintPopover(null)}
            brush={state.modelTool.brush}
            onBrush={(b) => modelToolApiRef.current?.setBrush(b)}
            current={state.colorSpineCurrent}
            palette={state.colorSpinePalette}
            scenePick={state.colorSpineScenePick}
            paletteFor={paintPaletteFor}
            onEditMaterial={openColorStudioForSpec}
            spine={{
              onSetCurrent: setColorSpineCurrent,
              onAddToTray: addColorSpineToTray,
              onPickTray: pickColorSpineTray,
              onScenePick: pickColorSpineScene,
              onLoadLibrarySet: loadColorSpineLibrarySet,
            }}
          />
        </RenderProbe>
      ) : null}
      {importPlan ? (
        <RenderProbe id="Import Image Dialog">
          <ImportImageDialog plan={importPlan} onPick={commitImageImport} onCancel={() => setImportPlan(null)} />
        </RenderProbe>
      ) : null}
      {importPartOpen ? (
        <RenderProbe id="Import Part Dialog">
          <ImportPartDialog
            models={visibleModels}
            onPick={importModelAsParts}
            onCancel={() => setImportPartOpen(false)}
          />
        </RenderProbe>
      ) : null}
      {!playing && state.mapPaint.active && state.mapPaint.channel === 'tile' && state.mapPaint.texturePickerOpen ? (
        <RenderProbe id="Map Texture Picker">
          <MapTexturePicker state={state.mapPaint} onPatch={patchMapPaint} />
        </RenderProbe>
      ) : null}
      {/* Model context menu — rendered LAST at the root so it lands at the cursor
          (window origin) and hit-tests above everything (paint order). Self-gates
          on right-click; the kind check keeps it out of non-model surfaces. */}
      {state.workspaceDocuments.find((doc) => doc.id === state.activeWorkspaceDocumentId)?.kind === 'model' ? (
        <modelMenu.ContextMenu>
          <ModelContextMenu
            modelTool={state.modelTool}
            hasActivePart={Boolean(activePartsModelId(state) && state.modelActivePartId && (state.modelParts[activePartsModelId(state)!] ?? []).some((p) => p.id === state.modelActivePartId))}
            partCount={(state.modelParts[activePartsModelId(state) ?? ''] ?? []).length}
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
