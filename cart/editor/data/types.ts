// editor/data/types.ts — shared type vocabulary for the editor workspace.
//
// Cloned from the hmsc-workspace-mock god-file (its types/data/helpers region).
// Pure type declarations; no runtime values. Component files import these.
import type {
  ExplorerDirectoryHistoryEntry,
  ExplorerFolderId,
  ExplorerHistoryEntry,
} from './fileExplorer';
import type { DecalDoc } from '../textures/decal';
import type { OklchColor } from '../../../runtime/paint/colors';
import type { Brush, BrushTool, Palette } from '../../../runtime/paint/model';
import type { EditMesh } from '../model/editMesh';
import type { MapPaintState } from '../stage/mapPaint';
import type { PlacedPiece } from '../world/pieces';
import type { AuthoredBuildPiece } from '../world/authoredRegistry';
import type { BuildKind, WallEdit } from '../world/buildCatalog';
import type { Skeleton, PropRig } from '../../../runtime/skeleton';
import type { WorldGlobals } from './globals';
import type { PathArrayParams } from './pathArray';
import type { PropExportRole } from './propExports';

export type Menu = 'File' | 'Edit' | 'View' | 'Map' | 'Build' | 'Globals' | 'Window';
// The starter primitives under File → New Mesh. Each maps to an in-cart editMesh generator
// (cuboid/cylinder/…); see PRIMITIVE_MESHES (commands.ts) + primitiveMeshData (catalog).
export type PrimitiveKind = 'cube' | 'cylinder' | 'cone' | 'pyramid' | 'plane' | 'sphere' | 'icosphere';
// One sub-mesh of a multi-part model — the outliner concept ported from the Studio
// (StudioPart). A model is a list of parts, each its own EditMesh; they compose into ONE
// host mesh (composeModelParts) where each part owns a contiguous face-group range so the
// outliner can select/highlight a whole part. Mirrors the Studio's parts + outliner.
export type ModelPart = {
  id: string;
  name: string;
  // Organizational outliner folder only — never topology. Members stay independent
  // authored-group ranges and may be selected/edited alone after expanding the folder.
  // The label is repeated so parts.json + the host journal need no parallel group table.
  groupId?: string;
  groupName?: string;
  // The primitive it was spawned from (naming/icons); absent for a Studio-authored part,
  // which is an arbitrary mesh, not a primitive.
  kind?: PrimitiveKind;
  // Seed geometry for the INITIAL compose (studio/primitive parts loaded at open). A part
  // ADDED after load lives only in the host mesh (appended), so it has no mesh here — its
  // geometry is identified by its authored-group range [lo, hi) instead. The host mesh is the
  // source of truth once editing starts; parts are metadata + a group range.
  mesh?: EditMesh;
  // A file-backed part (imported .glb/.obj): the HOST parses this path into the mesh on
  // mount (__mesh_load_file) — its geometry never exists in JS. The whole import is ONE
  // part; its [lo, hi) range is stamped from the viewer's load and every part op
  // (scope/hide/delete/append-next-to-it) works over that range like any other part.
  sourcePath?: string;
  visible: boolean;
  color: string;
  // Vertical offset applied on compose (Studio parts carry one); 0/absent for primitives.
  lift?: number;
  // The part's authored-group range in the composed host mesh — set after the initial compose
  // and by an append. Drives scope/select/hide/delete for the part (host-authoritative).
  lo?: number;
  hi?: number;
};
export type LibraryTab = 'Build' | 'Props' | 'Skins';
// 'playtest' (GLOBALS req_2770): the embodied drop-in tab — the SAME editor world
// mounted with the loader's built-in player instead of the iso authoring camera,
// where global tunables (Globals → Physics) are tested live.
// 'animation' (req_2786): the CAPTURE tab — webcam feed beside the exported
// player model with live pose sync; the animation workbench arc's surface.
export type WorkspaceDocumentKind = 'world' | 'model' | 'material' | 'playtest' | 'animation' | 'facade';
export type WorkspaceDocument = {
  id: string;
  kind: WorkspaceDocumentKind;
  title: string;
  subtitle?: string;
  sourceId?: string;
};
export type ContentFolderId =
  | 'game'
  | 'audio'
  | 'characters'
  | 'locations'
  | 'missions'
  | 'bankheist'
  | 'mission-assets'
  | 'scripts'
  | 'ui'
  | 'models'
  | 'models-build'
  | 'models-props'
  | 'models-props-wip'
  | 'models-characters'
  | 'models-vehicles'
  | `model-${string}`
  | 'materials'
  | 'materials-core'
  | 'materials-generated'
  | 'materials-favorites'
  | 'materials-recent'
  | 'architecture'
  | 'build-pieces'
  | 'prefabs'
  | 'vehicles'
  | 'weapons'
  | 'props'
  | 'fx';

export type Command = {
  id: string;
  menu: Menu;
  name: string;
  icon: string;
  key: string;
  context: boolean;
  native: boolean;
  undoable: boolean;
  tool?: boolean;
  // Which authoring surface this command is RELEVANT on — the one source of truth for
  // menu enable/disable (see commandEnabled). 'global' = always (New Map, Open, Undo…);
  // 'world'/'model'/'material' = only when that surface is loaded in view. Everything off
  // the active surface renders grayed-with-reason, never hidden (sane-app behaviour).
  scope: 'global' | 'world' | 'model' | 'material';
  // This command operates on an existing selection → disabled when nothing is selected on
  // its surface (Duplicate/Delete/Move/Paint/Sample/Focus…). Placement tools do NOT set this.
  needsSelection?: boolean;
  // Groups this command under an expandable parent flyout in its menu dropdown
  // (e.g. File → New Mesh → Cube, Edit → Mesh → Topology). Rows without a submenu render
  // at the top level. `section` is a non-interactive header inside a submenu flyout.
  submenu?: string;
};

// Mirror of the model viewer's live tool state (host-native mesh editor), held
// in editor state so the toolbar + context menu can highlight the active tool.
// Shapes match modelview's exported ModelToolSnapshot / ModelToolApi (structural).
export type LightId = 'flat' | 'key' | 'fill' | 'rim';
// A BLOCKING session the model viewer owns (req_2626 gap HH — modal discipline).
// While one is live, every other input surface must be inert until it resolves:
// 'loop-cut' = the host-side lc_begin…lc_end popup session (captured base mesh),
// 'paint-atlas' = the Create Paint Atlas prompt, 'face-guard' = the unsafe-face-
// edit confirmation. Mirrored up through ModelToolSnapshot so the shell's central
// gate (AppFrame) can see it without owning the session.
export type ModelBlockingSession = 'loop-cut' | 'paint-atlas' | 'face-guard' | null;
export type ModelToolSnapshot = { selMode: number; gizmoTool: number; paint: boolean; focus: boolean; wire: boolean; camLock: boolean; camSaved: boolean; sel: number; quality: number; tris: number; brushTool: BrushTool; safety: number; detail: number; brush: Brush; palette: Palette; litFlat: boolean; litKey: boolean; litFill: boolean; litRim: boolean; blocking: ModelBlockingSession };
/** Shared studio-paint controls while a flat facade document is active. The
 *  durable painting lives on Facade.layers; this is session/view state only. */
export type FacadePaintState = { brush: Brush; tool: BrushTool; detail: number };
export type ModelToolApi = {
  selMode: (m: number) => void;
  gizmo: (t: number) => void;
  /** Exact uniform factor around the active host selection pivot. */
  scaleBy: (factor: number) => boolean;
  paint: () => void;
  focus: () => void;
  wire: () => void;
  // Camera lock toggle (req_2893): freeze/unfreeze the mesh editor's orbit view.
  camLock: () => void;
  // Saved view (req_3067): bookmark the current orbit pose / jump the camera back to it.
  camStore: () => void;
  camRecall: () => void;
  extrudeEdge: () => void;
  extrudeFace: () => void;
  createFace: () => void;
  // Reverse selected face winding so its normal points to the opposite side.
  flipSelection: () => boolean;
  loopCut: () => void;
  deleteSelection: () => void;
  appendPart: (positions: Float32Array, faceGroups: Uint32Array, color: string) => { lo: number; hi: number } | null;
  // Returns the host op's outcome (count = triangles remaining in the live mesh) so the
  // shell can report it LOUDLY — a part op that silently no-ops reads as "it all vanished".
  setPartHidden: (lo: number, hi: number, hidden: boolean) => { ok: boolean; count: number } | null;
  deletePartRange: (lo: number, hi: number) => { ok: boolean; count: number } | null;
  // ── Studio-parity part ops (host-native; all journaled for undo/redo) ─────────
  // Duplicate a part's range; mirrorAxis 0/1/2 reflects the copy across that origin
  // plane (-1 = plain copy). Returns the new part's group range.
  duplicatePart: (lo: number, hi: number, mirrorAxis: number) => { lo: number; hi: number } | null;
  // Read-only source size for the coordinate-path editor, expressed in u (16 u = 1 tile).
  pathArraySpans: (ranges: { lo: number; hi: number }[]) => { xU: number; zU: number } | null;
  // Append bays along a curved/rising path from complete source-part ranges. The
  // host returns one fresh independent range per source member per generated bay.
  pathArray: (ranges: { lo: number; hi: number }[], params: PathArrayParams) => { ranges: { lo: number; hi: number }[] } | null;
  // Peel the selected faces (face mode) into a NEW part (pure group remap).
  detachSelection: () => { lo: number; hi: number } | null;
  // Merge two parts' faces into ONE fresh range (the old studio's "merge down").
  mergeParts: (aLo: number, aHi: number, bLo: number, bHi: number) => { lo: number; hi: number } | null;
  // Fuse the selected faces (2+ authored faces) into one authored face.
  mergeFaces: () => boolean;
  // Toggle the selected faces as translucent glass (re-toggle to un-glass).
  glassSelection: () => boolean;
  // Thicken the selected faces in place (inner skin + rim walls).
  solidifySelection: () => boolean;
  // Parse a .glb/.obj in the host and append it as a new part (cross-model reuse).
  appendModelFile: (path: string, color: string) => { lo: number; hi: number } | null;
  // Undo/redo the host mesh journal. note = the parts-metadata JSON the restored
  // snapshot carried (set via the journal-note door), for outliner resync.
  undoMesh: () => { ok: boolean; label: string; note: string | null } | null;
  redoMesh: () => { ok: boolean; label: string; note: string | null } | null;
  // Overwrite the viewer's part-range mirror after an undo/redo restored host ranges.
  setPartRangesMirror: (ranges: { lo: number; hi: number }[]) => void;
  setQuality: (q: number) => void;
  brushTool: (t: BrushTool) => void;
  cycleSafety: () => void;
  cycleDetail: () => void;
  setBrush: (b: Brush) => void;
  setPalette: (p: Palette) => void;
  toggleLight: (which: LightId) => void;
};

export type BuildNote = {
  request: string;
  build: string;
  title: string;
  status: string;
  agent: string;
  ask: string;
  // The agent's CLAIM of what it did (resolution). Empty when nobody wrote one.
  // Rendered as a claim, never as fact — commits + recurrence are the evidence.
  claim: string;
  // Commit shas behind the attempt. length === 0 ⇒ "nothing shipped".
  commits: string[];
  trace: string[];
  threadIds: string[];
};

// One attempt at a bug, as it appears ranked inside a thread. Carries its own
// rating (1..10, 0 = unrated) and gospel flag so the thread can sort the pile:
// gospel first, then rating desc — the needle floats above the drunk stabs.
export type ThreadAttempt = {
  request: string;
  build: string;
  ask: string;
  claim: string;
  agent: string;
  status: string;
  commits: string[];
  rating: number;
  gospel: boolean;
};

export type JournalCapture = {
  id: string;
  name: string;
  channels: string[];
  range: string;
  build: string;
  context: string;
  note: string;
};

export type BuildThread = {
  id: string;
  title: string;
  description: string;
  status: string;
  aliases: string[];
  tags: string[];
  // Ranked attempts (gospel first, then rating desc). Replaces the old flat
  // `deliveries: string[]` — a thread is a ranked haystack, not a list of ids.
  attempts: ThreadAttempt[];
  captures: JournalCapture[];
  history: string[];
  // Tally shown in the header — the anti-bullshit meter. Commits burned across
  // every attempt; whether a gospel has been crowned yet.
  commitsBurned: number;
  hasGospel: boolean;
};

export type BuildJournalSnapshot = {
  activeBuild: string;
  notes: BuildNote[];
  threads: BuildThread[];
  requestCount: number;
  deliveryCount: number;
  source: string;
  loadedAt: string;
  error?: string;
};

export type Asset = {
  id: string;
  tab: LibraryTab;
  name: string;
  color: string;
  favorite?: boolean;
  recent?: boolean;
  used: number;
  recipe?: string;
  seed?: number;
  variants?: string[];
  sourceKind?: 'shader-recipe' | 'shader-preset';
  sourceId?: string;
  sourcePath?: string;
  semanticKind?: string;
  stats?: string[];
  preview?: AssetPreview;
};

export type AssetPreview =
  | { kind: 'shader'; shader: string; data: number[] }
  | { kind: 'image'; source: string }
  | { kind: 'decal'; doc: DecalDoc }
  | { kind: 'color'; color: string };

export type AssetOverride = {
  name?: string;
  favorite?: boolean;
};

export type MaterialSource = {
  name: string;
  color: string;
  recipe: string;
  variants: string[];
};

export type ModelAtlas = {
  id: string;
  label: string;
  scope: string;
  resolution: string;
  paints: number;
  color: string;
};

export type ModelPaintVariant = {
  id: string;
  name: string;
  atlas: string;
  used: number;
  shaderRefs: string[];
  imageRefs: string[];
  color: string;
};

// Per-model UI mutations (right-click actions). Package manifests are disk truth;
// these overrides are the live projection used during the current render cycle.
export type ModelOverride = { name?: string; favorite?: boolean; hidden?: boolean };

// What a model is EXPORTED AS — declared in its own on-disk manifest (USER
// RULING req_2718: the package is the ENTIRE source of truth for placeability;
// localstore is only ever a rebuildable cache). A build piece carries its snap
// affinity; a prop free-places; a character declares its ROLE — the game's ONE
// played model, or an NPC population model (req_2771). Characters never join
// the build palette: the compile bake is their consumer, not the build bar.
export type CharacterRole = 'player' | 'npc';
export type ModelPlaceable =
  // A meaningful wall edit survives export as semantic data. Door/garageDoor
  // additionally require the named Door Leaf Outliner contract at export.
  | { as: 'build-piece'; kind: BuildKind; edit?: WallEdit }
  // Role defaults to scenery for manifests written before semantic prop export.
  | { as: 'prop'; role?: PropExportRole }
  | { as: 'character'; role: CharacterRole };

export type ModelPackage = {
  id: string;
  folderId: ContentFolderId;
  name: string;
  path: string;
  kind: 'build' | 'prop' | 'character' | 'vehicle';
  stage: 'wip' | 'ready' | 'locked';
  favorite?: boolean;
  // Deleted-from-browser, as recorded in the on-disk manifest (req_2620 U). Kept in
  // the loaded roster (so name-dedupe still sees it) but filtered from every list.
  hidden?: boolean;
  color: string;
  source: string;
  viewerPath?: string;
  viewerMeshRef?: string;
  rig: string;
  data: string;
  triangles: number;
  lods: number;
  decompositions: string[];
  atlases: ModelAtlas[];
  paints: ModelPaintVariant[];
  sourceKind?: 'cooked-asset' | 'studio-model' | 'imported-prop' | 'source-file' | 'primitive' | 'build-starter';
  semanticKind?: string;
  // Exported-as declaration + the RIG (req_2712/2713): what the model places as,
  // and the skeleton (bones + pockets/placements/seats/grips carried data) it
  // exports with. Both live in the manifest — disk truth (req_2718).
  placeable?: ModelPlaceable;
  skeleton?: Skeleton;
  // A freshly-authored primitive (File → New Mesh → …). The viewer builds the geometry
  // from the in-cart EditMesh generators (cuboid/cylinder/…, via editMeshToGeometry), the
  // same path studio models take, so it opens as clean grouped faces and edits in the host.
  primitive?: PrimitiveKind;
};

export type Rgb = [number, number, number];

export type ContentNode = {
  id: ContentFolderId;
  label: string;
  icon?: string;
  children?: ContentNode[];
};

export type WorldObject = {
  id: string;
  kind: string;
  name: string;
  assetId: string;
  left: number;
  top: number;
  width: number;
  height: number;
  metrics: Array<[string, string]>;
  hidden?: boolean;
};

export type HistoryEvent = {
  id: string;
  actionId?: string;
  commandId?: string;
  verb: string;
  target: string;
  meta: string;
  undoable: boolean;
  /** Set when a richer typed editorbus event owns the durable log entry. */
  eventType?: string;
  atMs?: number;
  editMs?: number;
  emptyMs?: number;
  richMs?: number;
};

// ── Real world-surface undo (req_2620 gap W) ──────────────────────────────────
// One reversible edit over the world surface: the minimal state slices the edit
// touched, captured before/after (references into the immutable-update chain, so
// an entry costs pointers, not copies). undoLocal/redoLocal apply these — the
// history FEED above (HistoryEvent) stays a display feed and is no longer
// conflated with the undo mechanism. Host-side map paint strokes are NOT covered
// (they never flow through EditorState); the empty-stack status says so.
export type WorldUndoSlices = Partial<Pick<EditorState,
  'worldPieces' | 'objects' | 'authoredBuildPieces' | 'selectedPieceId' | 'selectedPieceIds' | 'selectedObjectId' | 'armedPieceId'>>;
export type WorldUndoEntry = {
  label: string;
  before: WorldUndoSlices;
  after: WorldUndoSlices;
  /** Present for commands migrated behind CommandAuthority. Undo/redo reports
   * retain this identity instead of inventing a second unrelated action. */
  actionId?: string;
  commandId?: string;
};

// The editor's whole authoring state — one plain object threaded through every
// panel, reduced by AppFrame. (Was `MockState` while the shell was a design
// mock; it drives the real editor now, so the name reflects that.)
export type EditorState = {
  openMenu: Menu | null;
  // When set, the size/resolution dialog is open for this primitive. `mode` splits the two
  // verbs that used to share one command: 'new' always spawns a FRESH model document; 'add'
  // appends a part to the model already in view (the outliner + and Edit → Mesh → Add Primitive).
  newMeshPrompt?: { kind: PrimitiveKind; mode: 'new' | 'add' } | null;
  // When true, the character-export dialog is open for the ACTIVE model doc —
  // the player-vs-NPC role choice that File → Export → Player / NPC Model
  // gates on (req_2771). The confirmed role lands in manifest.placeable.
  exportCharacterPrompt?: boolean | null;
  presetMenuOpen: boolean;
  actionMenu: Menu;
  activeDomain: string;
  activeTab: LibraryTab;
  activeCommandId: string;
  activeAssetId: string;
  // Graffiti facades on the active map (req_3057) — persisted with world.json.
  worldFacades: import('../world/facades').Facade[];
  facadePaint: FacadePaintState;
  // Place Sticker (req_3025): the armed stamp — an imported texture's spec id,
  // quarter turns clockwise, and a uniform multiplier of the sticker's meter size.
  stickerArm: { textureId: string | null; rot: number; scale: number };
  assetPage: number;
  materialFocused: boolean;
  colorStudioMaterial: string; // ShaderSpec id (textures/shaders.ts catalog)
  colorStudioVariant: number;
  colorStudioSeed: number;
  colorStudioQuality: number; // detail grade, D[3] (FILL_GRADES index)
  colorStudioActiveSlot: number;
  // Slot overrides keyed `${specId}:${variant}:${slot}` → RGB 0..1. Resolution:
  // override ?? the slot's baked constant from the registry.
  colorStudioOverrides: Record<string, Rgb>;
  // req_2501: the five lens tabs + the No-Modes orbit consolidated into ONE
  // 'library' surface (ColorLibraryPanel) — lens/filter/step state died with them.
  colorStudioView: 'materialPalette' | 'library';
  colorSpineCurrent: OklchColor;
  colorSpinePalette: OklchColor[];
  colorSpineScenePick: string | null;
  buildDialogOpen: boolean;
  /** Named map-document picker. Map documents own BOTH native painting and
   * React-authored placements; switching replaces those concerns together. */
  mapDocumentOpen: boolean;
  /** Directory stem below zig-out/game/editor/maps/. */
  activeMapStem: string;
  /** Friendly title from the stable document directory's metadata. */
  activeMapName: string;
  /** Map → Add Chunk… topology dialog (req_2703) */
  addChunkOpen: boolean;
  eventbusPopoverOpen: boolean;
  perfPopoverOpen: boolean;
  memoryPopoverOpen: boolean;
  fileExplorerOpen: boolean;
  fileExplorerQuery: string;
  fileExplorerFolder: ExplorerFolderId;
  fileExplorerExpanded: Partial<Record<ExplorerFolderId, boolean>>;
  fileExplorerSelectedId: string;
  fileExplorerHistory: ExplorerHistoryEntry[];
  fileExplorerDirectoryHistory: ExplorerDirectoryHistoryEntry[];
  selectedObjectId: string;
  contentFolder: ContentFolderId;
  expandedFolders: Partial<Record<ContentFolderId, boolean>>;
  search: string;
  surfacePreset: string;
  snapIndex: number;
  floorIndex: number;
  /** Storey cutaway extra (req_2567): also hide the ACTIVE floor's walls, for
   *  interior editing / prop placement. Floors above are always cut away. */
  wallsDown: boolean;
  workspaceDocuments: WorkspaceDocument[];
  activeWorkspaceDocumentId: string;
  rightPane: string;
  contextOpen: boolean;
  modelTool: ModelToolSnapshot;
  status: string;
  cursor: { x: number; y: number; z: number };
  history: HistoryEvent[];
  redo: HistoryEvent[];
  seq: number;
  // Real world-surface undo/redo stacks (req_2620 gap W; bounded ~32). See
  // WorldUndoEntry above. `history`/`redo` remain the display FEED only.
  worldUndo: WorldUndoEntry[];
  worldRedo: WorldUndoEntry[];
  // ── The REAL world model (req_2563 Phase 1) — the unified source of truth for
  // the world surface. `worldPieces` is the authored placed-piece list (was
  // WorldEditorSurface-local state); `selectedPieceId` is the focused instance
  // the Inspector edits; `armedPieceId` is the palette piece Build mode drops.
  // These retire the phantom `objects`/`selectedObjectId` mock for world work.
  worldPieces: PlacedPiece[];
  selectedPieceId: string | null;
  /** Additive world selection. `selectedPieceId` remains the primary/focused
   *  member for the existing Inspector and edit commands. */
  selectedPieceIds: string[];
  armedPieceId: string | null;
  /** User turn applied to the next placement ghost (R). Edge snaps add this
   *  to their natural edge-facing instead of losing their snap orientation. */
  armedYawDegrees: number;
  // Copy stamp (req_2733): Copy on a placed piece arms its definition AND carries its
  // per-instance slots/overrides here, so every subsequent placement drops a true clone
  // (a copy that loses its materials isn't a copy). Cleared by a palette arm.
  armedStamp: Pick<PlacedPiece, 'slots' | 'overrides'> | null;
  // Recently USED materials (req_2737), most recent first, capped — every slot
  // assign pushes here, and the quick menu surfaces them as its RECENT row.
  // Live usage, distinct from the catalog's static `recent` flag.
  recentMaterialIds: string[];
  // Authored placeables (req_2578 build pieces + req_2712 props): meshes exported
  // "as a wall piece" / "as a prop", placeable alongside the catalog. DISK is the
  // source of truth (manifest.placeable, req_2718) — this list is seeded from the
  // boot scan of materialized packages and mirrored into authoredRegistry;
  // localstore only caches it.
  authoredBuildPieces: AuthoredBuildPiece[];
  // Per-model RIG drafts (req_2712/2713) keyed by package id — the Inspector's
  // Rig section edits these (pockets/placements/seats/cover/dynamics); export
  // compiles the draft into the manifest's skeleton. Session-live projection:
  // the manifest skeleton is the durable record (skeletonToPropRig re-projects).
  modelRigs: Record<string, PropRig>;
  objects: WorldObject[];
  assetOverrides: Record<string, AssetOverride>;
  modelOverrides: Record<string, ModelOverride>;
  modelDupes: ModelPackage[];
  modelRenamingId: string | null;
  // Unsaved-work flag per model id (req_2620 T): true once mesh/paint/parts/name
  // changed since the last materialize; cleared by Save (and by doc-switch
  // autosave for models already on disk). Drives the focus panel's save chip.
  modelDirty: Record<string, boolean>;
  // Multi-part model authoring (the outliner). Parts per model id; the active part is the
  // one the outliner highlights + the gizmo drives. Only primitive-authored models carry
  // parts; imported single meshes have none (their outliner is a follow-up).
  modelParts: Record<string, ModelPart[]>;
  modelActivePartId: string | null;
  // Map Paint (MAPPAINT req_2473/req_2484): the chrome mirror of the host map
  // painter's armed tool — rendered by MapPaintBar in the workspace action bar;
  // strokes/render/colliders are host-side (framework/game/map).
  mapPaint: MapPaintState;
  // World GLOBALS (GLOBALS req_2770): the game's global tunables — physics/player
  // for now (data/globals.ts is the canonical table). Edited in the playtest tab's
  // focus panel, pushed live through __compiled_world_set_physics, micro-saved to
  // world-globals.json (data/globalsStore.ts), and destined for the Compile bake's
  // PHYSICS_CONFIG lump.
  worldGlobals: WorldGlobals;
};
