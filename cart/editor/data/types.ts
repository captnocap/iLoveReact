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

export type Menu = 'File' | 'Edit' | 'View' | 'Map' | 'Build' | 'Story' | 'Window' | 'Help';
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
export type ViewMode = '3D' | '2D';
export type WorkspaceDocumentKind = 'world' | 'model' | 'material';
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
  // Which document surface a command belongs to. Absent = the world surface
  // (the default toolset). 'model' commands only surface when a model document
  // is active — they're the host-native mesh-edit tools the model viewer brought.
  surface?: 'world' | 'model';
  // Groups this command under an expandable parent flyout in its menu dropdown
  // (e.g. File → New Mesh → Cube). Rows without a submenu render at the top level.
  submenu?: string;
};

// Mirror of the model viewer's live tool state (host-native mesh editor), held
// in editor state so the toolbar + context menu can highlight the active tool.
// Shapes match modelview's exported ModelToolSnapshot / ModelToolApi (structural).
export type LightId = 'flat' | 'key' | 'fill' | 'rim';
export type ModelToolSnapshot = { selMode: number; gizmoTool: number; paint: boolean; focus: boolean; wire: boolean; sel: number; quality: number; tris: number; brushTool: BrushTool; safety: number; detail: number; brush: Brush; palette: Palette; litFlat: boolean; litKey: boolean; litFill: boolean; litRim: boolean };
export type ModelToolApi = {
  selMode: (m: number) => void;
  gizmo: (t: number) => void;
  paint: () => void;
  focus: () => void;
  wire: () => void;
  extrudeEdge: () => void;
  createFace: () => void;
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
  sourceKind?: 'shader-recipe' | 'shader-preset' | 'stored-material' | 'texture-file' | 'cooked-asset';
  sourceId?: string;
  sourcePath?: string;
  semanticKind?: string;
  stats?: string[];
  preview?: AssetPreview;
};

export type AssetPreview =
  | { kind: 'shader'; shader: string; data: number[] }
  | { kind: 'image'; source: string }
  | { kind: 'texture-blob'; ref: string }
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

// Per-model UI mutations (right-click actions). Models are snapshot-derived and
// read-only, so rename/favorite/delete live here as overrides applied on read;
// real model-store writes arrive with package materialization (Slice 2).
export type ModelOverride = { name?: string; favorite?: boolean; hidden?: boolean };

export type ModelPackage = {
  id: string;
  folderId: ContentFolderId;
  name: string;
  path: string;
  kind: 'build' | 'prop' | 'character' | 'vehicle';
  stage: 'wip' | 'ready' | 'locked';
  favorite?: boolean;
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
  sourceKind?: 'cooked-asset' | 'studio-model' | 'imported-prop' | 'source-file' | 'primitive';
  semanticKind?: string;
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
  verb: string;
  target: string;
  meta: string;
  undoable: boolean;
  editMs?: number;
  emptyMs?: number;
  richMs?: number;
};

// The editor's whole authoring state — one plain object threaded through every
// panel, reduced by AppFrame. (Was `MockState` while the shell was a design
// mock; it drives the real editor now, so the name reflects that.)
export type EditorState = {
  openMenu: Menu | null;
  newMeshPrompt?: PrimitiveKind | null; // when set, the "add a mesh at a chosen size" dialog is open for this kind
  presetMenuOpen: boolean;
  actionMenu: Menu;
  activeDomain: string;
  activeTab: LibraryTab;
  activeCommandId: string;
  activeAssetId: string;
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
  snapGridMeters: number;
  snapAngleDegrees: number;
  floorIndex: number;
  viewMode: ViewMode;
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
  objects: WorldObject[];
  assetOverrides: Record<string, AssetOverride>;
  modelOverrides: Record<string, ModelOverride>;
  modelDupes: ModelPackage[];
  modelRenamingId: string | null;
  // Multi-part model authoring (the outliner). Parts per model id; the active part is the
  // one the outliner highlights + the gizmo drives. Only primitive-authored models carry
  // parts; imported single meshes have none (their outliner is a follow-up).
  modelParts: Record<string, ModelPart[]>;
  modelActivePartId: string | null;
  // Map Paint (MAPPAINT req_2473/req_2484): the chrome mirror of the host map
  // painter's armed tool — rendered by MapPaintBar in the workspace action bar;
  // strokes/render/colliders are host-side (framework/game/map).
  mapPaint: MapPaintState;
};
