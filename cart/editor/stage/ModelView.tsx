// Editor-owned host-resident mesh editing, paint atlas, and package surface.
// Pick or drop a .glb/.obj, edit it, and persist it into the active package.
//
// The whole point of this cart is what it DOESN'T do: it never ships geometry across
// the JS bridge and never re-renders to move the camera. The chosen file is parsed
// ENTIRELY in the host (framework/world/mesh_import.zig via __mesh_load_file), uploaded
// to the GPU once, and handed back as a short intern key. The <Scene3D.Mesh hostKey>
// node carries only that key — the host redraws the resident mesh every frame. The
// camera is the host's orbit camera (<Scene3D.Camera orbit>): drag and wheel feed raw
// deltas straight to gpu/3d.zig (__model_orbit_drag/zoom), which repaints WITHOUT a
// React render. So no matter how heavy the model, orbiting stays smooth — React does
// exactly one render per file load and nothing per frame.
//
// A file is chosen with the native OS picker (the shared runtime pickFile — the same
// zenity dialog the Studio import uses), or by dropping it on the window.
//
// Verify headless: `./tools/rjit shot modelview` renders the empty prompt; open a real
// model under `./tools/rjit dev modelview`, or `RJIT_MODEL=path ./tools/rjit shot
// modelview` to render one headlessly.
import { useState, useRef, useEffect } from 'react';
import { Box, Col, Row, Text, Pressable, Slider, Scene3D } from '@reactjit/runtime/primitives';
import type { LightRig } from '../model/editMesh';
import type { ModelTextureSlot } from '../data/types';
import { buildRegionData } from '../render3d/regionFormula';
import { ensureRegionFormula } from '../render3d/liveRegions';
import { useFileDrop } from '@reactjit/runtime/hooks/useFileDrop';
import { pickFile } from '@reactjit/runtime/hooks/pickFile';
import { BackdropsPanel, BackdropSurface, backdropQuad, backdropTexKey, loadBackdrops, saveBackdrops, pickBackdrop, type Backdrop } from './Backdrops';
import { useModifiers } from '@reactjit/runtime/hooks/useModifiers';
import { getHotState, setHotState } from '@reactjit/runtime/hooks/useHotState';
import { callHost } from '@reactjit/runtime/ffi';
import {
  loadLedger, putEntry, recordImport, exportCredits, pendingCount,
  AttributionPanel, AttributionStatusBadge, type Attribution, type Ledger,
} from '@reactjit/runtime/attribution';
// The ONE brush system (runtime/paint) — the same kit Color Studio, MaterialFocus,
// brush_studio and the Studio pixel-painter use. The model viewer adopts it too: BrushKit
// is the shared UI/state (tools, dials, colour wheel, palette); the actual per-face-safe 3D
// stamping is a Zig host capability (model_paint.zig via the __model_paint_* doors), so this
// is the brush MODEL driving a host backend, not a second brush implementation.
import {
  blendModeIndex, BrushKit, BRUSH_SHAPE_ID, DEFAULT_BRUSH, defaultPalette, hexToRgb01, inkColorHex, DARK_THEME, PenPathOverlay,
  type Brush, type BrushTool, type Palette,
} from '@reactjit/runtime/paint';
// The shader catalog — the "paint buckets". A shader ink names a spec here; the host bakes
// its WGSL recipe (+ tuned params) into pixels the brush samples (paint-with-a-shader).
import { shaderSpec, defaultShaderData } from '../textures/shaders';
import {
  ensureImportedTexturePaintVariant,
  importedTextureVariantNeedsUvUpgrade,
  IMPORTED_TEXTURE_UV_MAPPING_VERSION,
  listPaintVariants,
  type PaintTarget,
  type PaintVariant,
} from '../data/paintVariants';
import { ensureModelUvResetBaseline, hasStoredModelPaint, modelPaintLayoutIsStale, readModelBasePaint, readModelRasterBase, resolvePackageDir, writeLiveModelAtlas, writeModelArtifacts, writeModelUvWireframe } from '../data/modelPackageStore';
import { readFileBase64 } from '../../../runtime/hooks/fs';
import { encode as encodeImage, image as imageOps } from '../../../runtime/image';
import { flattenUvFaceCorners, parseUvIslandRects, type UvIslandRect } from '../model/uvLayout';
import { planUvAtlasResize, UV_ATLAS_SIZE_TUNING } from '../model/uvAtlasSize';
import {
  setUvTextureLayerLocked,
  updateUvTextureWorkspace,
  type UvTextureWorkspaceDoc,
} from '../data/uvTextureWorkspace';
import {
  commitUvTextureWorkspaceCompile,
  ensureUvTextureWorkspace,
  importUvTextureWorkspaceLayer,
  rasterizeUvTextureWorkspace,
  readUvTextureWorkspace,
  writeUvTextureWorkspace,
} from '../data/uvTextureWorkspaceStore';
import { rasterizeUvWireframe } from '../model/uvWireframe';
import { hydratePersistedModelPaint, residentPaintResumeAction, type DecodedPaintRaster, type PaintHydrationPort } from '../model/paintHydration';
import { triangleWireframeVisible } from '../model/viewportPresentation';
import {
  JOURNAL_UV_ATLAS_MUTATION,
  UV_ATLAS_IMPORT_LABEL,
  UV_ATLAS_RELOAD_LABEL,
  UV_ATLAS_RESIZE_LABEL,
  isUvDocumentHistoryLabel,
  parsePaintHistory,
  parseModelHistory,
  uvHistoryActionOrdinal,
  type ModelHistoryDepths,
  type UvHistoryAction,
} from '../model/uvHistory';
import { syntheticKeyEdge } from '../data/keymap';
// Headless harness only (RJIT_MESHOPS addpart) — builds a primitive's grouped soup so the
// gesture script can exercise the REAL appendPart path without the outliner UI (req_2644).
import { primitiveMeshData, U_PER_TILE } from '../data/assetCatalog';
import type { PathArrayParams } from '../data/pathArray';
// The fixed-region layout contract (req_2627): popup control grids share the editor's
// ONE column grid instead of inventing local cell widths.
import { REGIONS } from '../shell/regions';

const host = globalThis as any;

type LoadedTexture = { imageIndex: number; width: number; height: number };
type Loaded = {
  key: string;
  count: number;
  radius: number;
  faces?: number;
  name: string;
  texture?: LoadedTexture;
};
export type ModelViewInitialMesh = {
  key: string;
  name: string;
  vertices: Float32Array | number[];
  count?: number;
  // One face-group id per triangle (same order as vertices): triangles that share
  // an id came from the same authored n-gon face, so the host mesh editor selects /
  // outlines whole faces instead of fan slivers. Absent for plain triangle imports.
  faceGroups?: Uint32Array | number[];
  /** stable texture-role index per render triangle (RJMD v3) */
  faceMaterials?: Uint32Array | number[];
  // Per-part colour ranges (multi-part models): paint each part its outliner colour on load,
  // so a bare studio mesh reads as coloured parts instead of blank white.
  partColors?: { lo: number; hi: number; color: string }[];
  // Saved visibility is applied only AFTER the complete document is resident and its
  // ownership ranges are installed. Hidden is presentation state, never missing seed data.
  hiddenRanges?: { lo: number; hi: number }[];
  /** doc.blob's trailing-glass boundary (RJMD v2+). Glass's durable truth —
   * the paint baseline/program are RGB-only (req_2928), so the mount re-applies
   * the glass alpha from THIS after paint hydration (req_3402). */
  glassFirstVertex?: number | null;
};
// The live tool state, mirrored out so an embedding shell (the editor) can drive
// the SAME host-native tools from its own toolbar / context menu instead of the
// viewer's floating buttons. selMode: 0 view · 1 vertex · 2 edge · 3 face.
// gizmoTool: 0 move · 1 scale · 2 rotate.
// sel: count of selected elements in the current mode. quality: live decimation
// slider (0..1). tris: the resident triangle count (for the quality readout).
// brushTool: 'fill' (per-face flood) · 'brush' (free-form disc). safety: 0 clip · 1 lock.
// detail: the paint density in texels/meter (1 = fill-only look). brush/palette: the shared kit model,
// mirrored out so the editor's BrushKit dock is a controlled view of the viewer's brush.
// litFlat/Key/Fill: the viewer light-rig switches, mirrored out so the editor's View menu +
// right-click flyout can host + highlight them.
export type LightId = 'flat' | 'key' | 'fill';
// blocking: the viewer-owned BLOCKING session currently unresolved (req_2626 gap HH —
// modal discipline): host-captured bevel/loop-cut/quadify popup sessions, the Create
// Paint Atlas prompt, or the unsafe-face-edit guard. The shell reads it off this
// snapshot and holds every other input surface inert until it resolves.
export type ModelBlockingSession = 'bevel' | 'loop-cut' | 'tris-to-quads' | 'paint-atlas' | 'face-guard' | null;
export type ModelToolSnapshot = { selMode: number; gizmoTool: number; paint: boolean; pathPlane: boolean; pathEdges: boolean; focus: boolean; wire: boolean; camLock: boolean; camSaved: boolean; sel: number; quality: number; tris: number; brushTool: BrushTool; safety: number; detail: number; brush: Brush; palette: Palette; litFlat: boolean; litKey: boolean; litFill: boolean; litRim: boolean; blocking: ModelBlockingSession; mirror: number };
// ── Model-focus bridge (req_2643 OO / req_2618 G) ────────────────────────────────
// The FOCUS PANEL (Inspector) renders the UV atlas section + SHAPE readouts, but their
// truth lives in this viewer. Same global-door pattern as __modelPartRangesChanged:
// the viewer publishes a snapshot on globalThis.__modelFocusBridge and pings
// __modelFocusBridgeChanged; the Inspector subscribes. Deliberately OUTSIDE the
// ModelToolSnapshot prop path (data/types.ts + AppFrame own that plumbing).
// `scope` is the honest readout of what the preview FILTERS to (req_2619 P): the active
// part's group range when island group ids let us tell its islands apart, else 'whole model'.
export type ModelFocusUv = {
  key: string;
  revision: number;
  rgba: Uint8Array | null;
  islands: UvIslandRect[];
  selectedIslands: number[];
  selectedFaces: number[];
  w: number;
  h: number;
  detail: number;
  note: string | null;
  scope: string;
  atlasOriginX: number;
  atlasOriginY: number;
  workspace: UvTextureWorkspaceDoc | null;
  packageDir?: string;
  diskPath?: string;
};
export type UvTextureLayerEdit =
  | { kind: 'position'; x: number; y: number }
  | { kind: 'visible'; visible: boolean }
  | { kind: 'locked'; locked: boolean }
  | { kind: 'raise' }
  | { kind: 'lower' }
  | { kind: 'remove' };
export type ModelFocusShape = {
  verts: number; // welded verts (0 until the host builds topology in vertex/edge mode — read '—')
  edges: number; // welded edges (same honesty rule)
  faces: number; // authored faces when grouping exists, else triangles
  tris: number;
  uvd: number; // faces carrying an atlas island — the whole-model atlas covers all once it exists, 0 before
  mounts: number; // honest 0 until the rig slice lands
  radius: number; // host bounding-sphere radius (load-time)
  center: [number, number, number] | null; // cart-side bounds center (primitive/studio loads only)
};
// View bookmarks on the bridge (req_3074): the focus panel lists them below the UV
// card — row click recalls, the trash verb removes, the + verb pins the current view.
export type ModelFocusBridge = {
  uv: ModelFocusUv | null;
  paintLive: boolean;
  readUvHistory: () => Readonly<{ uv: ModelHistoryDepths; paint: ModelHistoryDepths }>;
  refreshUv: () => void;
  applyUvLayout: (rects: Uint32Array) => boolean;
  applyUvGeometry: (corners: Float32Array, action: UvHistoryAction) => boolean;
  restoreUvShapes: (islandIndices: Uint32Array) => boolean;
  autoUvSize: (islandIndices: Uint32Array) => boolean;
  projectUvFromView: (islandIndices: Uint32Array) => boolean;
  undoUvHistory: () => string;
  redoUvHistory: () => string;
  selectUvIsland: (index: number, additive: boolean) => boolean;
  selectUvIslands: (indices: Uint32Array) => boolean;
  selectUvFace: (face: number, additive: boolean) => boolean;
  selectUvOrientation: () => number;
  saveUvAtlas: () => { path: string | null; note: string };
  exportUvWireframe: (islands?: readonly UvIslandRect[]) => { path: string | null; note: string };
  importUvAtlas: () => Promise<string>;
  resizeUvAtlas: (width: number, height: number) => Promise<string>;
  addUvTextureLayer: (x: number, y: number) => Promise<string>;
  editUvTextureLayer: (id: string, edit: UvTextureLayerEdit) => string;
  compileUvTextureLayers: (onProgress?: (completed: number, total: number, label: string) => void) => Promise<string>;
  reloadUvAtlas: () => string;
  resetUvLayout: () => string;
  // Restore a saved paint variant's whole look onto the resident model (req_3439):
  // texture + UV layout + strokes for full looks, program/atlas replay for legacy ones.
  loadPaintVariant: (variant: PaintVariant) => boolean;
  shape: ModelFocusShape | null;
  camMarks: { name: string; active: boolean }[];
  camStore: () => void;
  camRecallAt: (index: number) => void;
  camRemoveAt: (index: number) => void;
};
// The handlers the viewer owns, handed out so an external surface can invoke
// them. Same functions the floating buttons and hotkeys call — one owner, no
// split-brain: the shell remote-controls; the viewer stays the source of truth.
// extrude / createFace / weld / bevel are the contextual topology ops; setQuality
// drives the live decimation knob.
export type ModelToolApi = {
  selMode: (m: number) => void;
  gizmo: (t: number) => void;
  scaleBy: (factor: number) => boolean;
  // The cart half of the integrity roll call (req_3484): re-read key, selection,
  // and part ranges from host truth after the host reports (or heals) a ledger
  // fault. Returns false when the host carries no ranges to mirror.
  resyncFromHost: () => boolean;
  paint: () => void;
  pathPlane: () => void;
  pathEdges: () => void;
  focus: () => void;
  wire: () => void;
  // Camera lock toggle (req_2893): freeze/unfreeze the orbit view host-side.
  camLock: () => void;
  // View bookmarks (req_3067/req_3074): pin the current orbit pose; camRecall (the H
  // key) returns to the active one; the indexed pair drives the focus panel's list.
  camStore: () => void;
  camRecall: () => void;
  camRecallAt: (index: number) => void;
  camRemoveAt: (index: number) => void;
  extrudeEdge: () => void;
  extrudeFace: () => void;
  createFace: () => void;
  weld: () => void;
  bevel: () => void;
  selectUvOrientation: () => number;
  flipSelection: () => boolean;
  loopCut: () => void;
  basicCut: () => void;
  deleteSelection: () => void;
  // Live mirror editing (req_2758): flip one symmetry plane (0 = X, 1 = Y, 2 = Z) on/off.
  toggleMirror: (axis: number) => void;
  // Reference images (req_2758 — the studio's tracing backdrops): toggle the setup panel.
  referenceImages: () => void;
  // Host-authoritative part ops: append a new part (returns its group range), hide/show a
  // part's range, delete a part's range. The host mesh is the source of truth.
  appendPart: (positions: Float32Array, faceGroups: Uint32Array, color: string, expectedPartCount: number) => { lo: number; hi: number } | null;
  // Both return the host op's outcome ({ok, count} — count = triangles remaining) so the
  // shell reports it loudly; null = the door itself failed.
  setPartHidden: (lo: number, hi: number, hidden: boolean) => { ok: boolean; count: number } | null;
  deletePartRange: (lo: number, hi: number) => { ok: boolean; count: number } | null;
  // ── Studio-parity part ops (host-native, journaled for undo/redo) ─────────────
  duplicatePart: (lo: number, hi: number, mirrorAxis: number) => { lo: number; hi: number } | null;
  pathArraySpans: (ranges: { lo: number; hi: number }[]) => { xU: number; zU: number } | null;
  pathArray: (ranges: { lo: number; hi: number }[], params: PathArrayParams) => { ranges: { lo: number; hi: number }[] } | null;
  detachSelection: () => { lo: number; hi: number } | null;
  mergeParts: (aLo: number, aHi: number, bLo: number, bHi: number) => { lo: number; hi: number } | null;
  mergeFaces: () => boolean;
  trisToQuads: () => boolean;
  glassSelection: () => boolean;
  solidifySelection: () => boolean;
  appendModelFile: (path: string, color: string, expectedPartCount: number) => { lo: number; hi: number } | null;
  undoMesh: () => { ok: boolean; label: string; note: string | null } | null;
  redoMesh: () => { ok: boolean; label: string; note: string | null } | null;
  setPartRangesMirror: (ranges: { lo: number; hi: number }[]) => void;
  setQuality: (q: number) => void;
  // Brush controls — the editor toolbar drives tool/safety/detail, the BrushKit dock drives
  // the brush + palette. The viewer stays the single owner of the live brush state.
  brushTool: (t: BrushTool) => void;
  cycleSafety: () => void;
  cycleDetail: () => void;
  changeDetail: (px: number) => number; // set an exact paint resolution; returns the level the host ACTUALLY applied (budget may clamp)
  setBrush: (b: Brush) => void;
  setPalette: (p: Palette) => void;
  // Light-rig switches — flip a light on/off (Flat is the even paint-true master).
  toggleLight: (which: LightId) => void;
};
// A FILE-BACKED multi-part model: the base part is an imported .glb/.obj the HOST parses
// (geometry never crosses the bridge), and `appends` replay the doc's other parts
// (primitives added next to the import) into the live mesh on mount. The base import
// becomes ONE outliner part: per-triangle face groups + a part range over the whole file,
// so scope/hide/delete/weld treat it like any composed part.
export type ModelViewFileParts = {
  path: string;
  basePartId: string;
  baseColor: string;
  baseHidden?: boolean;
  appends: { partId: string; color: string; positions: Float32Array; faceGroups: Uint32Array }[];
};
export type PartRange = { partId: string; lo: number; hi: number };
export type ModelViewProps = {
  initialPath?: string;
  initialTitle?: string;
  initialMesh?: ModelViewInitialMesh;
  initialFileParts?: ModelViewFileParts;
  /** Original GLB/OBJ retained beside a saved meshdoc. Used only for a one-time
   * embedded-texture provenance repair before the saved document is restored. */
  importedTextureSourcePath?: string;
  allowFilePicker?: boolean;
  trackAttribution?: boolean;
  // When the editor hosts the viewer, its toolbar + context menu own the tool
  // chrome — so the viewer drops its own floating button rows and the surface
  // goes bland. The shell drives the tools through onToolApi / onToolState.
  hostChrome?: boolean;
  onToolApi?: (api: ModelToolApi) => void;
  onToolState?: (state: ModelToolSnapshot) => void;
  // Fired after a file-parts mount with each part's authored-group range in the freshly
  // loaded host mesh — the shell stamps these onto its outliner parts (lo/hi).
  onPartRanges?: (ranges: PartRange[]) => void;
  // A path-plane / pen-edges append is born inside the host; report its fresh range so
  // the shell can add the matching outliner row without recreating geometry. `kind`
  // names which pen tool committed it ('plane' fills a face, 'edges' is wire only).
  onPathPlaneCreated?: (range: PartRange, kind?: 'plane' | 'edges') => void;
  // The model's package identity, so the viewer can find its saved paintings on disk and
  // restore the latest instead of re-prompting for a new atlas every open (req_2526).
  paintTarget?: PaintTarget;
  /** A paint atlas is durable model content. A never-saved model must acquire
   * its manifest first; the shell supplies the one canonical Save entrance. */
  paintTargetOnDisk?: boolean;
  onRequireFirstSave?: () => boolean;
  onDocumentMutated?: () => void;
  /** Model-local emitted lights from the Rig draft. They illuminate the same
   * geometry here that each placed instance illuminates in World. */
  authoredLights?: readonly LightRig[];
  /** The model's texture-slot table (Rig draft ?? manifest). Slots wearing a
   * `liveMaterial` become LIVE MATERIAL REGIONS (req_3397): the host renders
   * their faces per-frame over object-space position; membership binds BY SLOT
   * so face re-assignment/cuts/undo never need a JS re-push. */
  textureSlots?: readonly ModelTextureSlot[];
};

/** sha256 of the file bytes (host door) — keys attribution to the content. */
const fileSha = (path: string): string => {
  const s = host.__file_sha256?.(path);
  return typeof s === 'string' ? s : '';
};

/** Parse a dropped file in the host and get back its intern key + stats. Returns null
 *  if the door is missing (non-V8 host) or the file failed to parse. */
function loadModelFile(path: string): Loaded | null {
  const fn = host.__mesh_load_file;
  if (typeof fn !== 'function') return null;
  const json = fn(path);
  if (typeof json !== 'string' || json.length === 0) return null;
  try {
    const o = JSON.parse(json);
    if (!o || typeof o.key !== 'string') return null;
    const name = path.split('/').pop() || path;
    const texture = o.texture
      && Number.isSafeInteger(o.texture.imageIndex) && o.texture.imageIndex >= 0
      && Number.isSafeInteger(o.texture.width) && o.texture.width > 0
      && Number.isSafeInteger(o.texture.height) && o.texture.height > 0
      ? {
        imageIndex: o.texture.imageIndex as number,
        width: o.texture.width as number,
        height: o.texture.height as number,
      }
      : null;
    return {
      key: o.key,
      count: o.count | 0,
      radius: o.radius || 1,
      faces: o.faces | 0,
      name,
      ...(texture ? { texture } : {}),
    };
  } catch {
    return null;
  }
}

/** Adopt already-cooked triangle data into the same resident host-mesh path as
 *  file imports. This is for editor-owned assets: after import, the source file is
 *  no longer the model, the interleaved vertex factor is. */
function loadModelVertices(mesh: ModelViewInitialMesh): Loaded | null {
  const fn = host.__mesh_load_vertices;
  if (typeof fn !== 'function') return null;
  const verts = mesh.vertices instanceof Float32Array ? mesh.vertices : new Float32Array(mesh.vertices);
  const count = mesh.count ?? Math.floor(verts.length / 8);
  const json = fn(mesh.key, verts, count);
  if (typeof json !== 'string' || json.length === 0) return null;
  try {
    const o = JSON.parse(json);
    if (!o || typeof o.key !== 'string') return null;
    // Hand the host the authored-face grouping (studio models) so face select /
    // outline works on real n-gons, not the fan triangles. Absent = plain soup.
    const groups = mesh.faceGroups instanceof Uint32Array
      ? mesh.faceGroups
      : mesh.faceGroups ? new Uint32Array(mesh.faceGroups) : null;
    if (groups && groups.length > 0) host.__mesh_set_face_groups?.(groups);
    const materials = mesh.faceMaterials instanceof Uint32Array
      ? mesh.faceMaterials
      : mesh.faceMaterials ? new Uint32Array(mesh.faceMaterials) : null;
    if (materials && materials.length > 0) host.__mesh_set_face_materials?.(materials);
    // Tint each part its outliner colour (multi-part models) so a bare studio mesh isn't a
    // blank white blob and the model matches the outliner swatches.
    for (const pc of mesh.partColors ?? []) {
      const [r, g, b] = hexToRgb01(pc.color);
      host.__model_paint_group_range?.(pc.lo, pc.hi, Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
    }
    return { key: o.key, count: o.count | 0, radius: o.radius || 1, name: mesh.name };
  } catch {
    return null;
  }
}

/** Bounds CENTER from interleaved vertex data (stride 8, position first) — one pass
 *  at load time (req_2618 G). Only primitive/studio loads have vertices cart-side;
 *  file imports keep the host's radius and read center as honest-empty. */
const meshBoundsCenter = (mesh: ModelViewInitialMesh): [number, number, number] | null => {
  const v = mesh.vertices instanceof Float32Array ? mesh.vertices : new Float32Array(mesh.vertices);
  if (v.length < 8) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i + 2 < v.length; i += 8) {
    const x = v[i]!, y = v[i + 1]!, z = v[i + 2]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
};

// Wheel zoom is the one orbit door the cart still calls directly — from the paint-mode
// Pressable's onScroll (in paint mode that surface owns the wheel; everywhere else the
// host's native loop handles it). Orbit/pan/select/marquee/focus are ALL native now.
const orbitZoom = (delta: number) => host.__model_orbit_zoom?.(delta);

// ── Host-native mesh editor (the editor surface) ─────────────────────────────────
// Mode: 0 = view, 1 = vertex, 2 = edge, 3 = face. Everything below the toolbar level is
// the host's: welded topology, selection sets, AND the input loop (engine.zig). The cart
// only sets mode/tool/capture and reads counts for the HUD — never a per-event handler.
type SelInfo = { mode: number; verts: number; edges: number; sel: number };
type TopoResult = { ok: number; key?: string; count?: number; changed?: number; lo?: number; hi?: number; ranges?: [number, number][]; label?: string; undo?: number; redo?: number; fallbackReason?: string };
type QuadifyPlan = TopoResult & {
  evaluation: number;
  evaluationCount: number;
  authoredBefore: number;
  authoredAfter: number;
  triangleFaces: number;
  candidatePairs: number;
  ambiguousTriangles: number;
  quads: number;
  planSignature: number;
};
type GuardInfo = { pending: number; bad: number; faces: number; canSplit: number };
const meshSetMode = (m: number) => host.__mesh_edit_mode?.(m);
// Live mirror editing (req_2758): bit 0/1/2 = X/Y/Z symmetry plane at each outliner part's local center.
const meshSetMirror = (mask: number) => host.__mesh_edit_mirror?.(mask);
// Symmetry trust layer (studio req_1190-1192 ported, req_2831): the live off-count badge
// + the keep+/keep− repair, against the SAME plane the armed mirror overlay draws.
type SymReport = { center: number; unmatched: number; total: number };
const meshSymmetryReport = (axis: number): SymReport | null => {
  const j = host.__mesh_symmetry_report?.(axis);
  if (typeof j !== 'string' || !j) return null;
  try { return JSON.parse(j) as SymReport; } catch { return null; }
};
const meshSymmetrize = (axis: number, keepPositive: boolean): TopoResult | null => {
  const j = host.__mesh_symmetrize?.(axis, keepPositive ? 1 : 0);
  if (typeof j !== 'string' || !j) return null;
  try { return JSON.parse(j) as TopoResult; } catch { return null; }
};
const meshClearSel = () => host.__mesh_edit_clear?.();
const meshGizmoTool = (t: number) => host.__mesh_gizmo_tool?.(t);
const meshScaleBy = (factor: number) => host.__mesh_gizmo_scale_by?.(factor) === 1;
const meshSelectEdge = (idx: number, additive = false) => host.__mesh_edit_select_edge?.(idx, additive ? 1 : 0) === 1;
// Hand the model-editor input loop to the host (native orbit/select/marquee/zoom/focus,
// zero JS per event), and toggle the Focus tool (left-drag pans the pivot).
const meshCapture = (on: boolean) => host.__mesh_edit_capture?.(on ? 1 : 0);
const meshFocusTool = (on: boolean) => host.__mesh_edit_focus?.(on ? 1 : 0);
// Camera lock (req_2893): while on, the host no-ops EVERY orbit motion (drag/zoom/
// pan/focus/compass) so a stray drag can't nudge the angle the user set.
const orbitSetLocked = (on: boolean) => host.__model_orbit_lock?.(on ? 1 : 0);

// ── Hot-reload survival (req_2898) ───────────────────────────────────────────────
// A dev hot reload tears down the JS world but the HOST keeps everything that
// matters: the live edit mesh, its undo journal, the paint atlas, and the orbit
// camera. Two hot twigs (framework/state/hotstate.zig — in-process, gone on a cold
// restart) let the remounted viewer pick that session back up instead of wiping it:
//   DOC twig  — which document owns the host's resident mesh, and under what key.
//               Matching doc + matching host key ⇒ ADOPT the live session (edits,
//               selection, journal, atlas, camera all survive); mismatch ⇒ normal load.
//   TOOL twig — how you were holding the tool (wire/lock/brush/palette/lights…),
//               re-seeded into fresh React state on mount.
const DOC_TWIG_KEY = 'editor:meshdoc:v1';
const TOOL_TWIG_KEY = 'editor:meshtool:v1';
type DocTwig = { docId: string; key: string };
// A view bookmark (req_3067/req_3074): a named orbit pose, exactly what
// __model_cam_pose read — [yaw, pitch, dist, target x/y/z].
export type CamBookmark = { name: string; pose: number[] };
type ToolTwig = {
  wire: boolean; camLock: boolean; camMarks: CamBookmark[]; camMark: number; gizmoTool: number; mirrorMask: number;
  brush: Brush; brushTool: BrushTool; palette: Palette; safety: number; detail: number;
  litFlat: boolean; litKey: boolean; litFill: boolean; paint: boolean;
};
type HostSession = { key: string; count: number; radius: number; undo: number; redo: number; atlas: boolean; paintStale?: boolean };
const readModelSession = (): HostSession | null => {
  const j = host.__model_session_json?.();
  if (typeof j !== 'string' || !j) return null;
  try { return JSON.parse(j) as HostSession; } catch { return null; }
};
const paintLayoutIsStale = () => host.__model_paint_layout_stale?.() === 1;
const readSelInfo = (): SelInfo | null => {
  try {
    const j = host.__mesh_edit_counts?.();
    return typeof j === 'string' && j ? (JSON.parse(j) as SelInfo) : null;
  } catch {
    return null;
  }
};
const readTopoResult = (json: any): TopoResult | null => {
  try {
    return typeof json === 'string' && json ? (JSON.parse(json) as TopoResult) : null;
  } catch {
    return null;
  }
};
const readQuadifyPlan = (json: any): QuadifyPlan | null => {
  const plan = readTopoResult(json) as QuadifyPlan | null;
  if (!plan || plan.ok !== 1 || typeof plan.key !== 'string' || !Number.isSafeInteger(plan.count) || (plan.count ?? -1) < 0) return null;
  const counts = [
    plan.evaluation, plan.evaluationCount, plan.authoredBefore, plan.authoredAfter,
    plan.triangleFaces, plan.candidatePairs, plan.ambiguousTriangles, plan.quads,
    plan.planSignature,
  ];
  if (counts.some((value) => !Number.isSafeInteger(value) || value < 0)) return null;
  if (plan.evaluationCount < 1 || plan.evaluation >= plan.evaluationCount) return null;
  if (plan.authoredAfter !== plan.authoredBefore - plan.quads) return null;
  if (plan.quads * 2 > plan.triangleFaces || plan.candidatePairs < plan.quads || plan.ambiguousTriangles > plan.triangleFaces) return null;
  return plan;
};
const meshExtrudeEdge = (distance: number) => readTopoResult(host.__mesh_topo_extrude_edge?.(distance));
const meshExtrudeFace = (distance: number) => readTopoResult(host.__mesh_topo_extrude_face?.(distance));
const meshCreateFace = () => readTopoResult(host.__mesh_topo_create_face?.());
const meshFlipFaces = () => readTopoResult(host.__mesh_topo_flip_faces?.());
// Weld (req_3382): merge the selected vertices at their center (host op).
const meshWeld = () => readTopoResult(host.__mesh_topo_weld?.());
// Loop cut: slice the mesh by the plane perpendicular to the ONE selected edge (host op).
const meshLoopCut = () => readTopoResult(host.__mesh_topo_loop_cut?.());
// Bevel: a host-owned captured-base session shared by one vertex or one edge.
type BevelInfo = { ok: number; kind?: 'edge' | 'vertex'; defaultWidth?: number; minimumWidth?: number; maxWidth?: number };
const meshBevelBegin = (): BevelInfo | null => {
  try {
    const j = host.__mesh_bevel_begin?.();
    return typeof j === 'string' && j ? (JSON.parse(j) as BevelInfo) : null;
  } catch {
    return null;
  }
};
const meshBevelPreview = (width: number) => readTopoResult(host.__mesh_bevel_preview?.(width));
const meshBevelEnd = (commit: boolean) => readTopoResult(host.__mesh_bevel_end?.(commit ? 1 : 0));
// ── Face loop cut (the studio's Blockbench treatment): a host-owned popup session ──
// begin captures the base mesh + the clicked face's two in-plane axes; preview installs
// the cut live at (direction, cuts, offset); end commits ONE journal entry or restores
// the base exactly. size0/size1 are the face's spans for direction 0/1.
type LcInfo = { ok: number; size0?: number; size1?: number };
const meshLcBegin = (basic: boolean): LcInfo | null => {
  try {
    const j = host.__mesh_lc_begin?.(basic ? 1 : 0);
    return typeof j === 'string' && j ? (JSON.parse(j) as LcInfo) : null;
  } catch {
    return null;
  }
};
const meshLcPreview = (dir: number, cuts: number, offsetFrac: number) =>
  readTopoResult(host.__mesh_lc_preview?.(dir, cuts, offsetFrac));
const meshLcEnd = (commit: boolean) => readTopoResult(host.__mesh_lc_end?.(commit ? 1 : 0));
// Read back the LIVE session's last-previewed params: a host-side handle drag re-previews
// internally (engine.zig → meshLcHandleDrag), so the popup polls this while open.
type LcState = { ok: number; dir?: number; cuts?: number; offsetFrac?: number; key?: string; count?: number; fallbackReason?: string };
const meshLcState = (): LcState | null => {
  try {
    const j = host.__mesh_lc_state?.();
    return typeof j === 'string' && j ? (JSON.parse(j) as LcState) : null;
  } catch {
    return null;
  }
};
// Delete exactly the selected elements (faces, or faces touching a selected vert/edge).
const meshDeleteSelection = () => readTopoResult(host.__mesh_delete_selection?.());
// ── Host-authoritative part ops ──────────────────────────────────────────────────
// A part is metadata + a group range; its geometry lives in the host mesh. Adding APPENDS to
// the live edit mesh (preserving prior edits — no JS recompose); hide/delete are host ops on
// the range. Only the new part's geometry (append) or a range (hide/delete) crosses the bridge.
const meshAppendGroup = (positions: Float32Array, faceGroups: Uint32Array, expectedPartCount: number) => {
  const floatCount = positions?.length ?? 0;
  const vertexCount = floatCount / 8;
  const triangleCount = vertexCount / 3;
  if (floatCount < 24 || !Number.isInteger(vertexCount) || !Number.isInteger(triangleCount) || faceGroups?.length !== triangleCount) {
    console.error(`[model-parts] append rejected before host call — floats=${floatCount} groups=${faceGroups?.length ?? 0}`);
    return null;
  }
  return readTopoResult(host.__mesh_append_group?.(positions, vertexCount, faceGroups, expectedPartCount));
};
const meshAppendPathPlane = (points: Float32Array, expectedPartCount: number) =>
  readTopoResult(host.__mesh_append_path_plane?.(points, expectedPartCount));
const meshAppendPathEdges = (points: Float32Array, closed: boolean, expectedPartCount: number) =>
  readTopoResult(host.__mesh_append_path_edges?.(points, closed ? 1 : 0, expectedPartCount));
const meshSetGroupHidden = (lo: number, hi: number, hidden: boolean, journal = true) =>
  readTopoResult(host.__mesh_set_group_hidden?.(lo, hi, hidden ? 1 : 0, journal ? 1 : 0));
// ── Studio-parity part ops (all journaled host-side for undo/redo) ────────────────
const meshDuplicateRange = (lo: number, hi: number, mirrorAxis: number) =>
  readTopoResult(host.__mesh_duplicate_range?.(lo, hi, mirrorAxis));
const meshRangePairs = (ranges: { lo: number; hi: number }[]) => {
  const pairs = new Uint32Array(ranges.length * 2);
  ranges.forEach((range, index) => { pairs[index * 2] = range.lo; pairs[index * 2 + 1] = range.hi; });
  return pairs;
};
const meshPathArraySpans = (ranges: { lo: number; hi: number }[]) => {
  try {
    const json = host.__mesh_path_array_spans?.(meshRangePairs(ranges));
    if (typeof json !== 'string' || !json) return null;
    const value = JSON.parse(json);
    return value?.ok === 1 && Number.isFinite(value.x) && Number.isFinite(value.z)
      ? { xU: value.x * U_PER_TILE, zU: value.z * U_PER_TILE }
      : null;
  } catch { return null; }
};
const meshPathArray = (ranges: { lo: number; hi: number }[], params: PathArrayParams) => {
  const pairs = meshRangePairs(ranges);
  if (params.points && params.points.length >= 2) {
    const points = new Float32Array(params.points.length * 3);
    params.points.forEach((point, index) => {
      points[index * 3] = point.xU / U_PER_TILE;
      points[index * 3 + 1] = point.yU / U_PER_TILE;
      points[index * 3 + 2] = point.zU / U_PER_TILE;
    });
    return readTopoResult(host.__mesh_path_array_points?.(pairs, params.axis, points));
  }
  return readTopoResult(host.__mesh_path_array?.(pairs, params.axis, params.bays, params.turnDegrees, params.riseU / U_PER_TILE, params.profile === 'linear' ? 0 : 1));
};
const meshDetach = () => readTopoResult(host.__mesh_topo_detach?.());
const meshMergePartsDoor = (aLo: number, aHi: number, bLo: number, bHi: number) =>
  readTopoResult(host.__mesh_merge_parts?.(aLo, aHi, bLo, bHi));
const meshMergeFaces = () => readTopoResult(host.__mesh_topo_merge_faces?.());
const meshTrisToQuads = () => readTopoResult(host.__mesh_topo_tris_to_quads?.());
const meshQuadifyBegin = () => readTopoResult(host.__mesh_quadify_begin?.());
const meshQuadifyPreview = (evaluation: number): QuadifyPlan | null =>
  readQuadifyPlan(host.__mesh_quadify_preview?.(evaluation));
const meshQuadifyEnd = (commit: boolean) => readTopoResult(host.__mesh_quadify_end?.(commit ? 1 : 0));
const meshGlass = () => readTopoResult(host.__mesh_topo_glass?.());
const meshSolidify = () => readTopoResult(host.__mesh_topo_solidify?.(0));
const meshAppendFile = (path: string, expectedPartCount: number) => readTopoResult(host.__mesh_append_file?.(path, expectedPartCount));
const meshUndoDoor = () => readTopoResult(host.__mesh_undo?.());
const meshRedoDoor = () => readTopoResult(host.__mesh_redo?.());
const readMeshHistory = (): ModelHistoryDepths => parseModelHistory(host.__mesh_history?.());
const readPaintHistory = (): ModelHistoryDepths => parsePaintHistory(host.__mesh_paint_history?.());
// The parts-metadata note the restored snapshot carried (the shell sets it after every
// part-structure change; read back after an undo/redo to resync the outliner).
const meshJournalNote = (): string | null => {
  const s = host.__mesh_journal_note?.();
  return typeof s === 'string' && s.length > 0 ? s : null;
};
// Tell the weld which group ranges are PARTS: coincident verts in different parts stay
// separate logical verts, so editing a focused part can't drag a stacked twin with it.
// Sent (full list) after every load and part op; empty clears to position-only welding.
const meshSetPartRanges = (ranges: { lo: number; hi: number }[]) => {
  const sorted = ranges.slice().sort((a, b) => a.lo - b.lo);
  const pairs = new Uint32Array(sorted.length * 2);
  sorted.forEach((r, i) => { pairs[i * 2] = r.lo; pairs[i * 2 + 1] = r.hi; });
  // rangetrace (req_3056, TEMPORARY): the merged-parts save corruption reproduces on a
  // plain open→export, so every host range push logs its size and caller until the
  // clearing path is caught. Remove with the fix.
  const stack = (new Error().stack || '').split('\n').slice(2, 5).map((s) => s.trim()).join(' « ');
  console.error(`[rangetrace] push ${sorted.length} range(s) [${sorted.map((r) => `${r.lo},${r.hi}`).join(' ')}] → host « ${stack}`);
  host.__mesh_set_part_ranges?.(pairs);
};
// Host part-range truth (req_2644): after every topology op / undo / redo the cart
// re-derives its part ranges FROM the host instead of patching lo/hi incrementally —
// a loop cut renumbers authored group ids (the +side pieces get fresh ids), so any
// cart-side arithmetic on stale lo/hi selects the wrong slab, tears the mesh on part
// moves, and mis-ranges appended parts. Returns the host ranges (ascending lo), or
// null when the mesh carries no part ranges (plain imports / unparted viewers).
const meshPartRangesRead = (): { lo: number; hi: number }[] | null => {
  try {
    const j = host.__mesh_part_ranges?.();
    if (typeof j !== 'string' || !j) return null;
    const o = JSON.parse(j);
    if (!o?.ok || !Array.isArray(o.ranges)) return null;
    return (o.ranges as [number, number][]).map((p) => ({ lo: p[0] | 0, hi: p[1] | 0 }));
  } catch {
    return null;
  }
};
// Structural part delete — its own host door, NOT select-then-delete: the selection
// doors are inert while the paint session owns the surface (req_2662), which made an
// outliner delete mid-paint silently no-op while the row still left the list (req_2981).
const meshDeleteGroupRange = (lo: number, hi: number) =>
  readTopoResult(host.__mesh_delete_group_range?.(lo, hi));
const readGuard = (): GuardInfo | null => {
  try {
    const j = host.__mesh_edit_guard?.();
    return typeof j === 'string' && j ? (JSON.parse(j) as GuardInfo) : null;
  } catch {
    return null;
  }
};
const resolveGuard = (action: number) => host.__mesh_edit_guard_resolve?.(action);
const SEL_MODES = ['Object', 'Vertex', 'Edge', 'Face'];
const GIZMO_TOOLS = ['Move', 'Scale', 'Rotate'];
// Re-decimate the model to clustering resolution `grid` (8..256, higher = more detail)
// and return the new {key,count}, or null. The host re-meshes from the retained full-res
// source — nothing but the key + count crosses the bridge.
function setModelQuality(grid: number): { key: string; count: number } | null {
  const json = host.__model_set_quality?.(grid);
  if (typeof json !== 'string' || !json) return null;
  try {
    const o = JSON.parse(json);
    return typeof o?.key === 'string' ? { key: o.key, count: o.count | 0 } : null;
  } catch {
    return null;
  }
}
// Slider position 0..1 → clustering grid. Squared so the low end (coarse "just the
// shape") gets fine control, which is where the game LoD lives. Quantized to a fixed
// set of levels so scrubbing the slider can't intern an unbounded number of distinct
// meshes into the retained GPU buffer — revisiting a level reuses its resident mesh.
const QUALITY_STEPS = 20;
const qualityToGrid = (q: number) => {
  const snapped = Math.round(q * QUALITY_STEPS) / QUALITY_STEPS;
  return Math.round(8 + snapped * snapped * 248);
};
type RGB = [number, number, number];

// The two brush behaviours, both host-backed (model_paint.zig). FILL raycasts the resident
// mesh and floods the whole face hit (__model_paint_at). BRUSH lays a disc in the face's UV
// ISLAND (__model_paint_stamp) — one continuous space per authored face, so strokes cross a
// quad's diagonal cleanly but never bleed onto a neighbour face. No verts or UVs cross the
// bridge; only the pixel + colour do.
const fillFaceAt = (x: number, y: number, rgb: RGB) => host.__model_paint_at?.(x, y, rgb[0], rgb[1], rgb[2]) === 1;
// The dab carries the brush FOOTPRINT (req_2831): shape kind (BRUSH_SHAPE_ID contract),
// hardness, angle, aspect, scatter — model_paint rasterizes the same 11 bristle shapes
// paintable.zig does, so the shape icon on the preset is finally the shape that lands.
const stampAt = (x: number, y: number, rgb: RGB, radius: number, b: Brush) =>
  host.__model_paint_stamp?.(
    x, y, rgb[0], rgb[1], rgb[2], radius, b.flow,
    b.stamp.kind === 'analytic' ? BRUSH_SHAPE_ID[b.stamp.shape] : 0,
    b.hardness, b.angleDeg, b.aspect, b.scatter, blendModeIndex(b.blend),
  ) === 1;
const strokeBeginAt = (x: number, y: number) => host.__model_paint_stroke_begin?.(x, y) ?? -1;
// Eyedropper read (req_3097): the painted atlas colour under the viewport pixel as
// #rrggbb, null on a miss. The host raycasts + reads the texel; JS just formats.
const samplePaintHexAt = (x: number, y: number): string | null => {
  const packed = host.__model_paint_sample?.(x, y);
  if (typeof packed !== 'number' || packed < 0) return null;
  return `#${(packed >>> 0).toString(16).padStart(6, '0')}`;
};
// Face-safety mode for free-form: 0 = clip (paint whatever face the dab is over), 1 = lock
// (mask the whole stroke to the face pressed at stroke-begin).
const setPaintSafety = (mode: number) => host.__model_paint_mode?.(mode);
// Set the paint DENSITY (texels per meter, Blockbench 16x semantics); returns the ACTUAL
// density after the host's budget guard (an over-budget pick halves until it fits).
const applyPaintDetail = (px: number): number => host.__model_set_paint_detail?.(px) ?? px;
// Set the paint fidelity by ATLAS BUDGET — the proven painter's law (req_2518): the whole
// model's islands fit a texels² atlas and the density falls out of the model's own size
// (a lone cube ≈330 texels/m from 1024²; a car divides the same budget). Returns the
// derived density so the UI can show it.
const applyPaintFit = (texels: number): number => host.__model_set_paint_fit?.(texels) ?? 1;
type AtlasEstimate = { w: number; h: number; density: number };
// Dry-run an atlas-budget fit: the dims + derived density, without adopting it.
const estimatePaintFit = (texels: number): AtlasEstimate | null => {
  const j = host.__model_paint_fit_estimate?.(texels);
  if (typeof j !== 'string' || !j) return null;
  try { return JSON.parse(j); } catch { return null; }
};

// The RGB (0..255) a colour-ink brush deposits — texture/shader inks fall back to white until
// the host dest-sampling pass lands. Mirrors runtime/paint's brushDabRgb, scaled to bytes.
const brushRgb = (b: Brush): RGB => {
  const [r, g, bl] = hexToRgb01(inkColorHex(b.ink) ?? '#ffffff');
  return [Math.round(r * 255), Math.round(g * 255), Math.round(bl * 255)];
};

// Paint-atlas budgets (texels per side). The fidelity dial is the atlas SIZE — the model's
// faces split it by physical size, so a lone cube gets writing-grade texels and a many-face
// model divides the same budget (the reference's paintAtlasTexels law, req_1299/req_2518).
const FIT_LEVELS = [512, 1024, 2048, 4096] as const;
const DEFAULT_FIT = 1024; // the proven painter shipped at 1024²
// BrushKit size is a DIRECT texel diameter: size N → an N-texel-wide dab (radius N/2), so the
// slider gives real fine-motor control — size 1 is a single texel (for writing text on a face),
// and 1 vs 9 are visibly different. The disc clips to the face's island silhouette; the host
// floors the radius at ~0.6 (one texel). Higher density = more texels to the meter, so the
// SAME size brush paints finer there — exactly what you want when the strokes need to get small.
const brushRadius = (size: number) => Math.max(0.5, size / 2);
const MODEL_STROKE_TUNING = {
  defaultScreenSpacingPx: 3,
  minScreenSpacingPx: 1,
  maxDabsPerPointerMove: 24,
} as const;
const modelScreenSpacing = (spacing: number) => Math.max(
  MODEL_STROKE_TUNING.minScreenSpacingPx,
  MODEL_STROKE_TUNING.defaultScreenSpacingPx * (spacing / DEFAULT_BRUSH.spacing),
);

// Loop-cut popup control grid (req_2626 II / req_2643 MM): the SHARED editor grid —
// one FIXED label column + fixed − / value / + stepper columns straight from
// REGIONS.grid, so every row shares the panel-wide cell widths and ONE right edge.
// The card's width IS the sum of its content columns — no dead interior space.
const LC_GAP = 6;
const LC_BTN_W = REGIONS.grid.stepBtn;
const LC_VAL_W = REGIONS.grid.valueWidth;
const LC_LABEL_W = REGIONS.grid.labelWidth;
const LC_STEP_W = LC_BTN_W + LC_GAP + LC_VAL_W + LC_GAP + LC_BTN_W; // the stepper zone width
const LC_PAD = 12;
const LC_CARD_W = LC_PAD * 2 + LC_LABEL_W + LC_GAP + LC_STEP_W; // content columns = the card
// Compact axis-span readout for the direction toggle labels ("U 2.0u").
const lcSpanLabel = (s: number) => `${s >= 10 ? s.toFixed(0) : s.toFixed(1)}u`;
const BEVEL_POPUP_TUNING = {
  stepUnits: 0.5,
  widthDecimals: 1,
} as const;
const QUADIFY_PREVIEW_TUNING = {
  scanStartDelayMs: 32,
  loaderPulseMs: 140,
  loaderSteps: [0, 1, 2, 3] as const,
  cardExtraWidth: 104,
  evaluations: [
    { label: 'Balanced', note: 'regular corners and opposite edges first' },
    { label: 'Short seams', note: 'prefer removing shorter shared edges' },
    { label: 'Alternate flow', note: 'choose a different maximum through ambiguous runs' },
  ],
} as const;
const roundBevelUnits = (value: number) => {
  const scale = 10 ** BEVEL_POPUP_TUNING.widthDecimals;
  return Math.round(value * scale) / scale;
};
// Create Paint Atlas size-picker grid (req_2643 NN): fixed columns — size label,
// density, recommended-chip (ALWAYS reserved, empty for others), bytes right-aligned
// to the row's one right edge. Single-line cells, loud truncation.
const AP_SIZE_W = 68;
const AP_DENS_W = 88;
const AP_REC_W = 76;

export default function ModelView({ initialPath, initialTitle, initialMesh, initialFileParts, importedTextureSourcePath, allowFilePicker = true, trackAttribution = true, hostChrome = false, onToolApi, onToolState, onPartRanges, onPathPlaneCreated, paintTarget, paintTargetOnDisk = true, onRequireFirstSave, onDocumentMutated, authoredLights = [], textureSlots = [] }: ModelViewProps = {}) {
  // How you were holding the tool before the last hot reload (req_2898) — read ONCE
  // per mount and used to seed the states below. Null on a cold process start.
  const toolTwig = useRef<ToolTwig | null>(getHotState<ToolTwig | null>(TOOL_TWIG_KEY, null)).current;
  const [model, setModel] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wire, setWire] = useState(toolTwig?.wire ?? false);
  const [paintMode, setPaintMode] = useState(false); // twig-restored in the boot effect (needs the atlas)
  const [pathPlaneMode, setPathPlaneMode] = useState(false);
  const [pathEdgesMode, setPathEdgesMode] = useState(false); // Pen Edges: wire-only pen commits
  const [focusMode, setFocusMode] = useState(false); // Focus tool: drag pans the pivot
  const [camLock, setCamLock] = useState(toolTwig?.camLock ?? false); // Camera lock (req_2893): view frozen where set
  // View bookmarks (req_3067/req_3074): named orbit poses the user pins and jumps back
  // to. The HOST owns the pose verbs (__model_cam_pose/__model_cam_set_pose); this list
  // is authored data — names, order, which one is active — twig-restored across hot
  // reloads, reset (with the rest of the view state) on a cold start. camMark tracks
  // the last stored/recalled bookmark: it's what the H key returns to.
  const [camMarks, setCamMarks] = useState<CamBookmark[]>(toolTwig?.camMarks ?? []);
  const [camMark, setCamMark] = useState(toolTwig?.camMark ?? -1);
  const [selMode, setSelMode] = useState(0); // 0 view · 1 vertex · 2 edge · 3 face
  const [gizmoTool, setGizmoTool] = useState(toolTwig?.gizmoTool ?? 0); // 0 move · 1 scale · 2 rotate
  // Live mirror editing (req_2758): enabled symmetry planes, bit 0/1/2 = X/Y/Z. The host
  // owns the reflection (mesh_edit.zig twin table); this is the toggle's UI truth.
  const [mirrorMask, setMirrorMask] = useState(toolTwig?.mirrorMask ?? 0);
  // Reference-image backdrops (req_2758 — the studio's req_1280 tracing planes). TWIG:
  // localstore-backed working state, never model data. bdEpoch is a fresh nonce per
  // MOUNT folded into texture/geometry keys, so a remount re-bakes the static surfaces
  // instead of sampling a stale host texture (the studio's req_1541 lesson).
  const [backdrops, setBackdropsState] = useState<Backdrop[]>(() => loadBackdrops());
  const setBackdrops = (u: Backdrop[] | ((p: Backdrop[]) => Backdrop[])) =>
    setBackdropsState((prev) => { const next = typeof u === 'function' ? (u as (p: Backdrop[]) => Backdrop[])(prev) : u; saveBackdrops(next); return next; });
  const [backdropPanel, setBackdropPanel] = useState(false);
  const [bdStatus, setBdStatus] = useState<string | null>(null);
  // The panel's one expanded backdrop (req_3080): it wears the in-viewport MOVE gizmo —
  // the host session draws/drags the arms (gpu/3d.zig bdGizmo*), and the poll below
  // mirrors the dragged pose back into state. Owned here, not in the panel, because
  // the session's lifetime IS this id.
  const [bdOpenId, setBdOpenId] = useState<string | null>(null);
  const bdEpochRef = useRef(Math.floor(Math.random() * 1e6));
  const addBackdrop = async () => {
    const r = await pickBackdrop(backdrops.length);
    if (r == null) return; // picker cancelled
    if (typeof r === 'string') { setBdStatus(r); return; }
    setBdStatus(null);
    setBackdrops((list) => [...list, r]);
    setBdOpenId(r.id); // a fresh image opens expanded, gizmo ready
  };
  // The backdrop wearing the gizmo: panel open + row expanded + still visible.
  const bdActive = backdropPanel ? backdrops.find((b) => b.id === bdOpenId && b.visible) ?? null : null;
  // What the HOST last knew as the session pose — the seam that keeps the two writers
  // apart: JS-originated pos changes (plane badge re-seat) push host-ward only when
  // they differ from this; host-originated drags come back through the poll and land
  // here first, so the push effect never snaps a live drag back.
  const bdHostPosRef = useRef('');
  useEffect(() => {
    if (!bdActive) {
      bdHostPosRef.current = '';
      host.__model_bd_gizmo_clear?.();
      return;
    }
    const key = bdActive.pos.join(',');
    if (key !== bdHostPosRef.current) {
      bdHostPosRef.current = key;
      host.__model_bd_gizmo_set?.(bdActive.pos[0], bdActive.pos[1], bdActive.pos[2]);
    }
    // No per-run cleanup: a poll-mirrored pos change re-runs this effect mid-drag, and
    // clearing here would kill the live session. The no-session branch above and the
    // unmount effect below are the only closers.
  }, [bdActive?.id, bdActive ? bdActive.pos.join(',') : '']);
  useEffect(() => () => { host.__model_bd_gizmo_clear?.(); }, []);
  // ── Live material regions (req_3397) ──────────────────────────────────────
  // Texture slots wearing a liveMaterial render per-frame over OBJECT-SPACE
  // position through the host's region pipeline — one continuous animated field
  // across the slot's faces (the lavalamp's goo), never per-face restarts. The
  // formula is composed from ONLY the bound material fns (req_3400 — composing
  // the whole catalog froze the app for minutes in naga) and is hash-gated
  // host-side, so re-binding the same set is free; variant/seed/palette/scale
  // changes are pure data. Binding is BY SLOT INDEX (__model_region_bind_slot),
  // so face re-assignment, cuts, and undo stay host-truth with no JS re-push.
  const regionSig = (textureSlots ?? []).map((s, i) => (s.liveMaterial ? `${i}:${s.id}:${JSON.stringify(s.liveMaterial)}` : '')).filter(Boolean).join('|');
  useEffect(() => {
    if (!model || typeof host.__model_region_bind_slot !== 'function') return;
    const key = model.key;
    host.__model_region_clear?.(key, -1);
    if (!regionSig) return;
    const boundFns = (textureSlots ?? []).filter((s) => s.liveMaterial).map((s) => s.liveMaterial!.fn);
    // Shared union with the world's placed-prop bindings (render3d/liveRegions):
    // the host holds ONE formula, so pushers must never clobber each other.
    if (!ensureRegionFormula(boundFns)) return; // loud error already emitted — keep the old pipeline
    (textureSlots ?? []).forEach((slot, index) => {
      if (!slot.liveMaterial) return;
      const data = buildRegionData(slot.liveMaterial);
      if (data) host.__model_region_bind_slot(key, index, index, data);
    });
    return () => { host.__model_region_clear?.(key, -1); };
  }, [model?.key, regionSig]);
  // colorFrom (req_3396): a rig light bound to a live-material slot hands its
  // color to the host, which steps it from the region's palette each frame.
  const liveRegionIdOf = (light: LightRig): number => {
    if (!light.colorFrom) return -1;
    return (textureSlots ?? []).findIndex((s) => s.id === light.colorFrom && s.liveMaterial);
  };
  useEffect(() => {
    if (!bdActive) return;
    const id = bdActive.id;
    const t = setInterval(() => {
      const j = host.__model_bd_gizmo_pos?.();
      if (typeof j !== 'string' || !j) return;
      let p: number[];
      try { p = JSON.parse(j) as number[]; } catch { return; }
      if (!Array.isArray(p) || p.length !== 3) return;
      const key = p.join(',');
      if (key === bdHostPosRef.current) return;
      bdHostPosRef.current = key;
      setBackdrops((list) => list.map((b) => (b.id === id ? { ...b, pos: [p[0]!, p[1]!, p[2]!] } : b)));
    }, 50);
    return () => clearInterval(t);
  }, [bdActive?.id]);
  const [selInfo, setSelInfo] = useState<SelInfo>({ mode: 0, verts: 0, edges: 0, sel: 0 });
  const [guard, setGuard] = useState<GuardInfo | null>(null);
  // Shader-ink bake failure — surfaced LOUD. The old shape discarded the door's
  // return code, so a failed bake silently painted flat white (req_2482).
  const [inkWarn, setInkWarn] = useState<string | null>(null);
  // Brush state (the ONE brush system). `brush`/`palette` are the shared kit model; `brushTool`
  // picks the behaviour ('fill' = per-face flood · 'brush' = free-form disc); `safety` is the
  // free-form face-safety mode (0 clip · 1 lock); `detail` is the patch resolution.
  const [brush, setBrush] = useState<Brush>(() => toolTwig?.brush ?? { ...DEFAULT_BRUSH, ink: { kind: 'color', hex: '#e0463f' } });
  const [brushTool, setBrushTool] = useState<BrushTool>(toolTwig?.brushTool ?? 'fill');
  const [penRevision, setPenRevision] = useState(0);
  const [palette, setPalette] = useState<Palette>(() => toolTwig?.palette ?? defaultPalette());
  const [safety, setSafety] = useState(toolTwig?.safety ?? 0); // 0 clip · 1 lock
  const [detail, setDetail] = useState(toolTwig?.detail ?? 1); // paint density, texels/meter (1 = fill-only look)
  const [fit, setFit] = useState<number | null>(null); // the active atlas budget (null = explicit density)
  // Light rig — flip via the View menu / right-click Lighting flyout. Flat = even paint-true
  // light (no shading); otherwise a neutral ambient + a single Key directional, and Fill raises
  // ambient so the orbited-away side isn't black. (The shader supports one directional + ambient.)
  const [litFlat, setLitFlat] = useState(toolTwig?.litFlat ?? false);
  const [litKey, setLitKey] = useState(toolTwig?.litKey ?? true);
  const [litFill, setLitFill] = useState(toolTwig?.litFill ?? true);
  const [quality, setQuality] = useState(1); // slider 0..1; 1 = full detail on load
  // Attribution: the shared ledger + the current model's entry + the panel toggle.
  const [ledger, setLedger] = useState<Ledger>(() => loadLedger());
  const [attribution, setAttribution] = useState<Attribution | null>(null);
  const [attrOpen, setAttrOpen] = useState(false);

  // Record (or fetch) the attribution for a just-loaded file, keyed by its content sha.
  const recordAttribution = (path: string) => {
    if (!trackAttribution) return;
    const sha = fileSha(path);
    if (!sha) { setAttribution(null); return; }
    const next = { ...ledger };
    const entry = recordImport(sha, path, next);
    setLedger(next);
    setAttribution(entry);
    if (entry.status === 'pending') setAttrOpen(true); // surface the obligation immediately
  };

  const saveAttribution = (patch: Pick<Attribution, 'title' | 'author' | 'source' | 'license'>) => {
    if (!attribution) return;
    const next = { ...ledger };
    const saved = putEntry(next, { ...attribution, ...patch });
    setLedger(next);
    setAttribution(saved);
  };

  const doExportCredits = () => {
    const r = exportCredits(ledger);
    setError(r.ok
      ? (r.pending > 0 ? `Credits exported — ⚠ ${r.pending} asset(s) still need attribution` : 'Credits exported ✓')
      : 'Could not write credits file');
  };

  // Apply a new quality (slider 0..1): re-decimate in the host and swap the resident
  // mesh. The host keeps the baseline only so further slider changes remain reversible;
  // Save persists this chosen resident topology and reopening adopts it as the new source.
  // Therefore quality is a real document mutation, not a cosmetic viewport preference.
  const applyQuality = (q: number) => {
    setQuality(q);
    const r = setModelQuality(qualityToGrid(q));
    if (r) {
      setModel((m) => (m ? { ...m, key: r.key, count: r.count } : m));
      setSelInfo({ mode: selMode, verts: 0, edges: 0, sel: 0 }); // host re-meshed → selection cleared
      onDocumentMutated?.();
    }
  };

  const applyTopo = (r: TopoResult | null, fail: string) => {
    if (r?.ok && typeof r.key === 'string' && typeof r.count === 'number') {
      setModel((m) => (m ? { ...m, key: r.key!, count: r.count! } : m));
      // The host operation owns its result mode/selection (Create Face returns the
      // new face focused; Face Extrude returns its cap; edge ops remain in Edge).
      adoptHostSelection({ mode: 2, verts: 0, edges: 0, sel: 0 });
      setError(null);
      resyncPartRanges(); // the op may have renumbered groups — mirror the host's ranges (req_2644)
      refreshUvIfLive(); // the op rewrote the atlas layout — the UV panel must follow (req_2625 GG)
    } else {
      setError(fail);
    }
  };

  // Adopt a host op's new mesh key WITHOUT forcing a select mode (append/hide/delete-part just
  // change the resident mesh; they don't imply an edit mode like the topo ops do).
  // Every adopt re-keys the mesh, which is exactly the "topology/paint layout changed"
  // signal — the live UV panel refreshes off it (req_2625 GG: no manual refresh click),
  // and the part-range mirror resyncs from host truth on the same signal (req_2644).
  const adoptMesh = (r: TopoResult | null): boolean => {
    if (r?.ok && typeof r.key === 'string' && typeof r.count === 'number') {
      setModel((m) => (m ? { ...m, key: r.key!, count: r.count! } : m));
      adoptHostSelection(selInfo);
      resyncPartRanges();
      const paintStale = paintLayoutIsStale();
      if (paintStale) {
        atlasReadyRef.current = false;
        atlasInvalidatedRef.current = true;
        setPaintMode(false);
      } else if (atlasInvalidatedRef.current) {
        // Undo restored the pre-structural mesh and its still-valid atlas.
        atlasInvalidatedRef.current = false;
        atlasReadyRef.current = true;
      }
      refreshUvIfLive();
      return true;
    }
    return false;
  };

  const closeGuard = (action: number) => {
    const changed = resolveGuard(action);
    setGuard(null);
    adoptHostSelection(selInfo);
    if (action === 0 && changed) {
      // The split renumbered groups + part ranges and re-islanded the paint layout —
      // the outliner mirror and the live UV panel must re-read host truth.
      resyncPartRanges();
      refreshUvIfLive();
    }
  };

  // ── Bevel popup: exactly one selected edge or vertex, one shared native session.
  // Width is displayed in modeling units (16 u = 1 m), while the host keeps geometry
  // and limits in metres. Every step rebuilds from the captured base; Apply commits
  // one journal entry and Cancel restores the base plus its original selection.
  const [bv, setBv] = useState<null | {
    kind: 'edge' | 'vertex';
    width: number;
    min: number;
    max: number;
    fallbackReason: string | null;
  }>(null);
  const openBevel = () => {
    const info = meshBevelBegin();
    if (!info?.ok || (info.kind !== 'edge' && info.kind !== 'vertex') ||
        typeof info.defaultWidth !== 'number' || typeof info.minimumWidth !== 'number' || typeof info.maxWidth !== 'number') {
      setError('Select one sharp manifold edge, or one corner with at least 3 edges');
      return;
    }
    const min = roundBevelUnits(info.minimumWidth * U_PER_TILE);
    const max = Math.max(min, roundBevelUnits(info.maxWidth * U_PER_TILE));
    const width = Math.max(min, Math.min(max, roundBevelUnits(info.defaultWidth * U_PER_TILE)));
    const preview = meshBevelPreview(width / U_PER_TILE);
    setBv({ kind: info.kind, width, min, max, fallbackReason: preview?.fallbackReason ?? null });
    adoptMesh(preview);
  };
  const changeBevel = (widthRaw: number) => {
    if (!bv) return;
    const width = Math.max(bv.min, Math.min(bv.max, roundBevelUnits(widthRaw)));
    const preview = meshBevelPreview(width / U_PER_TILE);
    setBv({ ...bv, width, fallbackReason: preview?.fallbackReason ?? null });
    adoptMesh(preview);
  };
  const closeBevel = (commit: boolean) => {
    if (!bv) return;
    adoptMesh(meshBevelEnd(commit));
    setBv(null);
  };

  // ── Face loop cut popup (the studio treatment): direction picks which of the clicked
  // face's two in-plane axes, cuts 1..64, offset as a fraction of the face's span on that
  // axis (50% = even slabs). Non-null = a host session is live; every change re-previews.
  // `unit` (req_2625 EE) picks how the offset cell READS — 'units' (the studio default:
  // real mesh units along the face's span, from the lc_begin sizes) or 'percent'. The
  // internal offset stays a percent; the door always takes the 0..1 frac (offset/100).
  //
  // HANDLE DRAG (req_2625 gap DD, WIRED): grab the translate-style handle on the middle
  // cut plane and drag — engine.zig hit-tests it FIRST while a session is live
  // (meshLcHandleHit; a live session is modal, so no press falls through to a face pick)
  // and routes the motion to meshLcHandleDrag, which re-previews HOST-side. The popup
  // polls `__mesh_lc_state` (~4 Hz, effect below) to adopt each drag's new mesh key and
  // mirror dir/cuts/offset back into this state WITHOUT re-previewing.
  const [lc, setLc] = useState<null | { basic: boolean; dir: 0 | 1; cuts: number; offset: number; unit: 'units' | 'percent'; sizes: [number, number]; fallbackReason: string | null }>(null);
  const openLoopCut = (basic = false) => {
    const info = meshLcBegin(basic);
    if (!info?.ok) {
      setError('Select a face to loop-cut (face mode)');
      return;
    }
    const preview = meshLcPreview(0, 1, 0.5);
    const next = { basic, dir: 0 as 0 | 1, cuts: 1, offset: 50, unit: 'units' as const, sizes: [info.size0 ?? 0, info.size1 ?? 0] as [number, number], fallbackReason: preview?.fallbackReason ?? null };
    setLc(next);
    adoptMesh(preview);
  };
  const changeLoopCut = (patch: Partial<{ dir: 0 | 1; cuts: number; offset: number; unit: 'units' | 'percent' }>) => {
    if (!lc) return;
    const next = { ...lc, ...patch };
    const preview = meshLcPreview(next.dir, next.cuts, next.offset / 100);
    next.fallbackReason = preview?.fallbackReason ?? null;
    setLc(next);
    adoptMesh(preview);
  };
  const closeLoopCut = (commit: boolean) => {
    if (!lc) return;
    adoptMesh(meshLcEnd(commit));
    setLc(null);
  };
  // While the popup is live: poll the host session (~4 Hz) and adopt what a handle drag
  // did — every host re-preview installs a NEW mesh key (adoptMesh, the steppers' path),
  // and dir/cuts/offset mirror into `lc` WITHOUT re-previewing (the host already did).
  // Functional setLc — this timer closure is mount-frozen (same trap as the meshops
  // harness). lastKey seeds on the first tick so the open-preview's key isn't re-adopted.
  useEffect(() => {
    if (!lc) return;
    let live = true;
    let lastKey: string | null = null;
    const poll = () => {
      if (!live) return;
      const st = meshLcState();
      if (st?.ok && typeof st.offsetFrac === 'number' && typeof st.key === 'string' && typeof st.count === 'number') {
        if (lastKey !== null && st.key !== lastKey) adoptMesh({ ok: 1, key: st.key, count: st.count });
        lastKey = st.key;
        const pct = Math.round(st.offsetFrac * 10000) / 100;
        const dir = (st.dir === 1 ? 1 : 0) as 0 | 1;
        const cuts = Math.max(1, st.cuts ?? 1);
        const fallbackReason = st.fallbackReason ?? null;
        setLc((prev) => (prev && (prev.offset !== pct || prev.dir !== dir || prev.cuts !== cuts || prev.fallbackReason !== fallbackReason)
          ? { ...prev, dir, cuts, offset: pct, fallbackReason }
          : prev));
      }
      setTimeout(poll, 250);
    };
    setTimeout(poll, 250);
    return () => { live = false; };
  }, [lc !== null]);

  // ── Whole-topology Tris → Quads dry run ────────────────────────────────────
  // Opening paints the scanning card first, then yields one frame before the host
  // imports/welds the complete topology and solves an exact maximum matching.
  // Preview changes only authored grouping, so the real wire overlay shows the
  // proposed quads while Cancel still restores the base with no undo entry.
  type QuadifyUi =
    | { phase: 'scanning'; evaluation: number; pulse: number }
    | { phase: 'preview'; evaluation: number; pulse: number; plan: QuadifyPlan };
  const [quadify, setQuadify] = useState<QuadifyUi | null>(null);
  const quadifyGeneration = useRef(0);
  const scanQuadifyEvaluation = (evaluationRaw: number, begin: boolean) => {
    const evaluationCount = QUADIFY_PREVIEW_TUNING.evaluations.length;
    const evaluation = ((evaluationRaw % evaluationCount) + evaluationCount) % evaluationCount;
    const generation = ++quadifyGeneration.current;
    setQuadify({ phase: 'scanning', evaluation, pulse: 0 });
    setTimeout(() => {
      if (generation !== quadifyGeneration.current) return;
      if (begin) {
        const started = meshQuadifyBegin();
        if (!started?.ok) {
          setQuadify(null);
          setError('Tris to Quads needs an open grouped model in Face mode');
          return;
        }
      }
      const plan = meshQuadifyPreview(evaluation);
      if (generation !== quadifyGeneration.current) return;
      if (!plan?.ok || plan.evaluationCount !== evaluationCount || !adoptMesh(plan)) {
        adoptMesh(meshQuadifyEnd(false));
        setQuadify(null);
        setError('The topology scan returned an incompatible dry run; the model was restored');
        return;
      }
      setError(null);
      setQuadify({ phase: 'preview', evaluation, pulse: 0, plan });
    }, QUADIFY_PREVIEW_TUNING.scanStartDelayMs);
  };
  const openQuadify = (): boolean => {
    if (quadify || selMode !== 3 || !model) {
      setError('Enter Face mode with a model open, then run Tris to Quads');
      return false;
    }
    scanQuadifyEvaluation(0, true);
    return true;
  };
  const changeQuadifyEvaluation = (delta: number) => {
    if (!quadify || quadify.phase !== 'preview') return;
    scanQuadifyEvaluation(quadify.evaluation + delta, false);
  };
  const closeQuadify = (commit: boolean) => {
    if (!quadify) return;
    const plan = quadify.phase === 'preview' ? quadify.plan : null;
    ++quadifyGeneration.current;
    const shouldCommit = commit && Boolean(plan && plan.quads > 0);
    const result = meshQuadifyEnd(shouldCommit);
    const adopted = result?.ok ? adoptMesh(result) : quadify.phase === 'scanning';
    if (shouldCommit && adopted && plan) {
      setAuthoredFaces(plan.authoredAfter);
      onDocumentMutated?.();
    }
    setQuadify(null);
    setError(adopted ? null : 'Could not close the Tris to Quads preview safely');
  };
  useEffect(() => {
    if (quadify?.phase !== 'scanning') return;
    let live = true;
    const pulse = () => {
      if (!live) return;
      setQuadify((current) => current?.phase === 'scanning'
        ? { ...current, pulse: (current.pulse + 1) % QUADIFY_PREVIEW_TUNING.loaderSteps.length }
        : current);
      setTimeout(pulse, QUADIFY_PREVIEW_TUNING.loaderPulseMs);
    };
    setTimeout(pulse, QUADIFY_PREVIEW_TUNING.loaderPulseMs);
    return () => { live = false; };
  }, [quadify?.phase]);

  // Offset stepping in the CURRENT unit: percent steps 5; size units step 0.1u converted
  // to the internal percent (clamped 0..100 and kept to 2dp so the cell reads clean).
  // The unit step is CAPPED at 5% of the span: on a small face (the record player's
  // 0.1u spindle, req_3435) a raw 0.1u step was a 100% jump that rammed the offset
  // straight into the degenerate 0%/100% ends in one click.
  const lcSpan = lc ? (lc.sizes[lc.dir] || 0) : 0;
  const lcStepOffset = (dir: -1 | 1) => {
    if (!lc) return;
    const stepPct = lc.unit === 'percent' ? 5 : (lcSpan > 0 ? Math.max(0.5, Math.min((0.1 / lcSpan) * 100, 5)) : 5);
    const next = Math.max(0, Math.min(100, lc.offset + dir * stepPct));
    changeLoopCut({ offset: Math.round(next * 100) / 100 });
  };
  const lcOffsetDisplay = lc
    ? (lc.unit === 'percent' ? `${Math.round(lc.offset)}` : `${(lcSpan * lc.offset / 100).toFixed(2)}`)
    : '';

  // The outliner part ranges currently resident in the host mesh — a MIRROR of the host's
  // part-range truth (req_2644). Seeded from initialMesh.partColors on load, then re-read
  // from __mesh_part_ranges after every mesh adopt: the host maintains the ranges through
  // every topology op (loop cut renumbers groups; append/detach/merge grow/fuse ranges),
  // so the cart never patches lo/hi incrementally again.
  const partRangesRef = useRef<{ lo: number; hi: number }[]>([]);

  // Re-read the host's part ranges into the mirror; when they moved, tell the shell
  // (global door — AppFrame re-stamps its outliner rows' lo/hi and re-scopes the active
  // part). Returns false when the host carries no ranges (unparted mesh) so callers can
  // fall back to establishing them with a push.
  const partRangeAliasesRef = useRef<Map<string, { lo: number; hi: number }>>(new Map());
  const partRangeKey = (range: { lo: number; hi: number }) => `${range.lo}:${range.hi}`;
  const resolveLivePartRange = (lo: number, hi: number): { lo: number; hi: number } => {
    let candidate = { lo, hi };
    // Same-count topology edits preserve part rank while renumbering group ids.
    // Follow the bounded alias chain until it reaches an exact CURRENT range;
    // the native duplicate boundary rejects it if it cannot be resolved.
    for (let depth = 0; depth < 32; depth += 1) {
      if (partRangesRef.current.some((range) => range.lo === candidate.lo && range.hi === candidate.hi)) return candidate;
      const next = partRangeAliasesRef.current.get(partRangeKey(candidate));
      if (!next) break;
      candidate = next;
    }
    return candidate;
  };
  const resyncPartRanges = (): boolean => {
    const ranges = meshPartRangesRead();
    if (!ranges) return false;
    const prev = partRangesRef.current;
    const changed = ranges.length !== prev.length || ranges.some((r, i) => r.lo !== prev[i]?.lo || r.hi !== prev[i]?.hi);
    if (changed) {
      if (prev.length === ranges.length) {
        prev.forEach((oldRange, index) => {
          const nextRange = ranges[index];
          if (nextRange && (oldRange.lo !== nextRange.lo || oldRange.hi !== nextRange.hi)) {
            partRangeAliasesRef.current.set(partRangeKey(oldRange), nextRange);
          }
        });
      } else {
        // Append/detach/merge changes partition cardinality; old ranks no longer
        // identify parts safely, so only the strict native boundary may decide.
        partRangeAliasesRef.current.clear();
      }
    }
    partRangesRef.current = ranges;
    if (changed) (globalThis as any).__modelPartRangesChanged?.(ranges);
    return true;
  };

  // Only the paint stroke is JS-driven now (and only while in paint mode). Orbit, select,
  // marquee, focus, and zoom are owned entirely by the host's native input loop — there is
  // no per-move React state for them, which is the whole point (no JS in the loop).
  const paintingRef = useRef(false);
  // Last painted viewport point, so a fast drag interpolates dabs along the segment instead of
  // leaving gaps (the host stamps one disc per call; JS walks the segment between moves).
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);
  // Eyedropper drag (req_3097): sampling live while the pointer is down. Dedupe by hex so a
  // hold over one face doesn't spam the color-select command per mouse-move.
  const dropperRef = useRef(false);
  const dropperHexRef = useRef<string | null>(null);
  const sampleColorAt = (x: number, y: number) => {
    const hex = samplePaintHexAt(x, y);
    if (!hex || hex === dropperHexRef.current) return;
    dropperHexRef.current = hex;
    (globalThis as any).__modelColorSampled?.(hex);
  };

  // Native selection can change mode without going through chooseSelMode: engine clicks,
  // marquee, Ctrl+A, and the shell's outliner group-select all mutate host state directly.
  // Counts already carry the host's authoritative mode; mirror both so toolbar highlights
  // cannot drift from the active native tool.
  const adoptHostSelection = (fallback: SelInfo = { mode: 0, verts: 0, edges: 0, sel: 0 }): SelInfo => {
    const info = readSelInfo() ?? fallback;
    const mode = Math.max(0, Math.min(3, info.mode | 0));
    const next = mode === info.mode ? info : { ...info, mode };
    setSelInfo(next);
    setSelMode(mode);
    if (mode !== 0) {
      setPaintMode(false);
      setPathPlaneMode(false);
      setPathEdgesMode(false);
      setFocusMode(false);
      meshFocusTool(false);
    }
    return next;
  };

  // Switch tool: selecting a mesh mode (or going back to view) is the active tool, so it
  // turns off Paint/Focus, and pushes the mode to the host. Mode 0 = plain view/orbit.
  const chooseSelMode = (m: number) => {
    setSelMode(m);
    setPaintMode(false);
    setPathPlaneMode(false);
    setPathEdgesMode(false);
    setFocusMode(false);
    meshFocusTool(false);
    // Topology is shown by the host's boundary-edge overlay (real model edges, no
    // triangulation diagonals). The raw GPU wireframe remains a View-mode diagnostic;
    // while an edit tool owns the pane ModelView suppresses it at the Scene3D boundary.
    meshSetMode(m);
    adoptHostSelection({ mode: m, verts: 0, edges: 0, sel: 0 });
  };
  const chooseGizmoTool = (t: number) => {
    setGizmoTool(t);
    meshGizmoTool(t);
  };
  // Paint and Focus are tools too — turning one on drops the mesh-select mode back to view
  // so only one tool owns the drag at a time. The Focus tool flag also goes to the host
  // (it owns the left-drag = pan-pivot gesture natively).
  //
  // Paint is GATED on atlas creation: the first entry per loaded model opens the
  // Create Paint Atlas prompt (pick a resolution, see the real texture cost) instead of
  // silently painting on whatever detail carried over — the step every paint tool makes
  // explicit. atlasReadyRef survives edit-op key changes and resets on a fresh load.
  const atlasReadyRef = useRef(false);
  // Unlike a never-painted model, a structurally edited model must not auto-load
  // an older saved painting. Its UV contract is stale and requires an explicit
  // Remake Paint Atlas decision first.
  const atlasInvalidatedRef = useRef(false);
  const [atlasPrompt, setAtlasPrompt] = useState(false);
  // The atlas base TYPE (Blockbench's Create Texture "Type"), picked in the SAME gate as the
  // size since both gate painting (req_2546): Texture Template = per-island colours, Solid =
  // one flat colour (the current ink), Blank = bare sheet.
  const [baseType, setBaseType] = useState<'template' | 'solid' | 'blank'>('template');
  // AUTHORED face count (a cube has 6, not its 12 triangles) — from the mesh's face
  // groups when it carries authored grouping; null for plain/per-triangle imports. The
  // prompt reads faces to the user and triangles to the byte math, never conflating them.
  const [authoredFaces, setAuthoredFaces] = useState<number | null>(null);
  // Model-space bounds CENTER, computed one-shot from the composed vertices at load
  // (req_2618 G). File imports have no vertices cart-side → null (honest-empty).
  const [boundsCenter, setBoundsCenter] = useState<[number, number, number] | null>(null);
  // ── UV / atlas inspector ─────────────────────────────────────────────────────
  // The LIVE atlas bytes + island geometry. The raster is uploaded directly to a
  // Paintable by the focus panel; outlines, selection and handles stay live geometry.
  // No temp PNG and no UI state baked into the pixels.
  const [uvPanel, setUvPanel] = useState<ModelFocusUv | null>(null);
  const uvRevisionRef = useRef(0);
  const UV_PREVIEW_BYTE_CAP = UV_ATLAS_SIZE_TUNING.maxRgbaBytes; // reading a 100MB atlas into JS would stall the app
  // No atob/btoa in this runtime (they're Web APIs, not V8 builtins) — decode the atlas
  // door's base64 by hand. ~1MB for a 512² atlas; one-shot per refresh, not per frame.
  const B64_REV = (() => {
    const rev = new Int8Array(128).fill(-1);
    const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    for (let i = 0; i < alpha.length; i++) rev[alpha.charCodeAt(i)] = i;
    return rev;
  })();
  const bytesFromB64 = (s: string): Uint8Array | null => {
    let n = s.length;
    while (n > 0 && s.charCodeAt(n - 1) === 61) n--; // trailing '='
    const out = new Uint8Array(Math.floor((n * 3) / 4));
    let acc = 0;
    let bits = 0;
    let w = 0;
    for (let i = 0; i < n; i++) {
      const v = B64_REV[s.charCodeAt(i) & 127] ?? -1;
      if (v < 0) return null;
      acc = (acc << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[w++] = (acc >> bits) & 0xff;
      }
    }
    return out;
  };
  const readUvSelection = (): { islands: number[]; faces: number[] } => {
    const empty = { islands: [], faces: [] };
    const validIndices = (value: unknown): number[] => Array.isArray(value)
      ? value.filter((index): index is number => Number.isInteger(index) && index >= 0)
      : [];
    try {
      const json = host.__model_uv_selection_read?.();
      if (typeof json !== 'string' || !json) return empty;
      const parsed = JSON.parse(json);
      if (!parsed || typeof parsed !== 'object') return empty;
      return {
        islands: validIndices((parsed as any).islands),
        faces: validIndices((parsed as any).faces),
      };
    } catch {
      return empty;
    }
  };
  const buildUvPanel = () => {
    const fail = (w: number, h: number, d: number, note: string) => setUvPanel({
      key: `${model?.key ?? 'none'}-${w}x${h}`,
      revision: ++uvRevisionRef.current,
      rgba: null,
      islands: [],
      selectedIslands: [],
      selectedFaces: [],
      w,
      h,
      detail: d,
      note,
      scope: 'whole model',
      atlasOriginX: 0,
      atlasOriginY: 0,
      workspace: null,
    });
    const j = host.__model_atlas_read?.();
    if (typeof j !== 'string' || !j) {
      fail(0, 0, 0, 'the host returned no atlas (is a mesh loaded?)');
      return;
    }
    let o: { w: number; h: number; detail: number; islands?: number[]; groups?: number[]; triangles?: number[]; cornerVertices?: number[]; data: string };
    try {
      o = JSON.parse(j);
    } catch {
      fail(0, 0, 0, 'atlas read returned malformed JSON');
      return;
    }
    if (o.w * o.h * 4 > UV_PREVIEW_BYTE_CAP) {
      fail(o.w, o.h, o.detail, `atlas is ${o.w}×${o.h} — too large to preview live`);
      return;
    }
    const rgba = bytesFromB64(o.data);
    if (!rgba || rgba.length < o.w * o.h * 4) {
      fail(o.w, o.h, o.detail, 'atlas pixel decode failed');
      return;
    }
    const selection = readUvSelection();
    const packageDir = paintTarget ? resolvePackageDir(paintTarget.kind, paintTarget.id) : null;
    const workspace = packageDir ? readUvTextureWorkspace(packageDir) : null;
    const compiled = workspace?.compiled;
    const compiledMatchesAtlas = Boolean(compiled && compiled.width === o.w && compiled.height === o.h);
    const atlasOriginX = compiledMatchesAtlas ? compiled!.originX : 0;
    const atlasOriginY = compiledMatchesAtlas ? compiled!.originY : 0;
    const islands = parseUvIslandRects(o.islands, o.groups, o.triangles, o.cornerVertices).map((rect) => (
      atlasOriginX === 0 && atlasOriginY === 0
        ? rect
        : { ...rect, x: rect.x + atlasOriginX, y: rect.y + atlasOriginY }
    ));
    setUvPanel({
      key: `${model?.key ?? 'model'}-${o.w}x${o.h}-${atlasOriginX},${atlasOriginY}`,
      revision: ++uvRevisionRef.current,
      rgba,
      islands,
      selectedIslands: selection.islands,
      selectedFaces: selection.faces,
      w: o.w,
      h: o.h,
      detail: o.detail,
      note: islands.length ? null : 'atlas has no editable island metadata',
      scope: `whole model · ${islands.length} islands`,
      atlasOriginX,
      atlasOriginY,
      workspace,
      ...(packageDir ? { diskPath: `${packageDir}/atlases/base.png`, packageDir } : {}),
    });
  };
  const syncUvSelection = () => {
    const selection = readUvSelection();
    setUvPanel((current) => {
      if (!current) return current;
      const sameIslands = current.selectedIslands.length === selection.islands.length
        && current.selectedIslands.every((index, at) => index === selection.islands[at]);
      const sameFaces = current.selectedFaces.length === selection.faces.length
        && current.selectedFaces.every((index, at) => index === selection.faces[at]);
      return sameIslands && sameFaces ? current : {
        ...current,
        selectedIslands: selection.islands,
        selectedFaces: selection.faces,
      };
    });
  };
  const applyUvLayout = (rects: Uint32Array): boolean => {
    const ok = host.__model_uv_layout_apply?.(rects) === 1;
    if (!ok) return false;
    onDocumentMutated?.();
    buildUvPanel();
    return true;
  };
  const applyUvGeometry = (corners: Float32Array, action: UvHistoryAction): boolean => {
    const originX = uvPanel?.atlasOriginX ?? 0;
    const originY = uvPanel?.atlasOriginY ?? 0;
    let localCorners = corners;
    if (originX !== 0 || originY !== 0) {
      localCorners = new Float32Array(corners);
      for (let coordinate = 0; coordinate < localCorners.length; coordinate += 2) {
        localCorners[coordinate + 0] -= originX;
        localCorners[coordinate + 1] -= originY;
      }
    }
    const ok = host.__model_uv_geometry_apply?.(localCorners, uvHistoryActionOrdinal(action)) === 1;
    if (!ok) return false;
    onDocumentMutated?.();
    buildUvPanel();
    return true;
  };
  const restoreUvShapes = (islandIndices: Uint32Array): boolean => {
    if (islandIndices.length === 0) return false;
    const ok = host.__model_uv_restore_shape?.(islandIndices) === 1;
    if (!ok) return false;
    onDocumentMutated?.();
    buildUvPanel();
    return true;
  };
  const autoUvSize = (islandIndices: Uint32Array): boolean => {
    if (islandIndices.length === 0) return false;
    const ok = host.__model_uv_auto_size?.(islandIndices) === 1;
    if (!ok) return false;
    onDocumentMutated?.();
    buildUvPanel();
    return true;
  };
  const projectUvFromView = (islandIndices: Uint32Array): boolean => {
    if (islandIndices.length === 0) return false;
    const ok = host.__model_uv_project_view?.(islandIndices) === 1;
    if (!ok) return false;
    onDocumentMutated?.();
    buildUvPanel();
    return true;
  };
  const selectUvIsland = (index: number, additive: boolean): boolean => {
    if (!Number.isInteger(index) || index < 0) return false;
    // Paint owns the 3D surface and deliberately has no edit-selection tint. Keep
    // this UV selection panel-local while painting so moving a sliver does not
    // silently disarm the brush. Outside Paint, route through the native face
    // selection so the UV and 3D outlines remain one authoritative selection.
    if (paintMode) return true;
    // A UV face click is an authored-face selection action. Leave the mutually
    // exclusive paint/path/focus tools immediately so the host door cannot be
    // rejected by a paint session that React has not torn down yet.
    host.__mesh_paint_session?.(0);
    setPaintMode(false);
    setPathPlaneMode(false);
    setPathEdgesMode(false);
    setFocusMode(false);
    meshFocusTool(false);
    const ok = host.__model_uv_island_select?.(index, additive ? 1 : 0) === 1;
    if (!ok) return false;
    setSelMode(3);
    adoptHostSelection({ mode: 3, verts: 0, edges: 0, sel: 1 });
    syncUvSelection();
    return true;
  };
  const selectUvIslands = (indices: Uint32Array): boolean => {
    // Paint deliberately keeps UV selection panel-local; outside Paint, a
    // marquee replaces the complete native face selection in one host call.
    if (paintMode) return true;
    host.__mesh_paint_session?.(0);
    setPaintMode(false);
    setPathPlaneMode(false);
    setPathEdgesMode(false);
    setFocusMode(false);
    meshFocusTool(false);
    const ok = host.__model_uv_islands_select?.(indices) === 1;
    if (!ok) return false;
    setSelMode(3);
    adoptHostSelection({ mode: 3, verts: 0, edges: 0, sel: indices.length });
    syncUvSelection();
    return true;
  };
  const selectUvFace = (face: number, additive: boolean): boolean => {
    if (!Number.isInteger(face) || face < 0) return false;
    if (paintMode) return true;
    host.__mesh_paint_session?.(0);
    setPaintMode(false);
    setPathPlaneMode(false);
    setPathEdgesMode(false);
    setFocusMode(false);
    meshFocusTool(false);
    const ok = host.__mesh_edit_select_face?.(face, additive ? 1 : 0) === 1;
    if (!ok) return false;
    setSelMode(3);
    adoptHostSelection({ mode: 3, verts: 0, edges: 0, sel: 1 });
    syncUvSelection();
    return true;
  };
  const selectUvOrientation = (): number => {
    if (paintMode) return 0;
    host.__mesh_paint_session?.(0);
    setPaintMode(false);
    setPathPlaneMode(false);
    setPathEdgesMode(false);
    setFocusMode(false);
    meshFocusTool(false);
    const count = Math.max(0, Number(host.__mesh_edit_select_uv_orientation?.() ?? 0) | 0);
    if (count === 0) return 0;
    setSelMode(3);
    adoptHostSelection({ mode: 3, verts: 0, edges: 0, sel: count });
    syncUvSelection();
    return count;
  };
  const reloadUvAtlas = (): string => {
    if (!paintTarget) return 'Reload refused — this viewer has no package-backed paint target.';
    const dir = resolvePackageDir(paintTarget.kind, paintTarget.id);
    if (!dir) return 'Reload refused — save the model package first.';
    const encoded = readFileBase64(`${dir}/atlases/base.png`);
    if (!encoded) return 'Reload refused — atlases/base.png does not exist yet.';
    const decoded = imageOps(encoded).raw();
    const atlas = uvPanel;
    if (!decoded || !atlas) return 'Reload refused — base.png could not be decoded.';
    if (decoded.width !== atlas.w || decoded.height !== atlas.h) {
      return `Reload refused — PNG is ${decoded.width}×${decoded.height}; the live atlas is ${atlas.w}×${atlas.h}.`;
    }
    if (host.__model_atlas_replace?.(decoded.rgba, JOURNAL_UV_ATLAS_MUTATION) !== 1) return 'Reload refused by the live paint target or its undo snapshot.';
    // Persist the imported raster as the program's true baseline immediately;
    // this is texture data, not a screenshot or a transient preview artifact.
    writeModelArtifacts(paintTarget);
    onDocumentMutated?.();
    buildUvPanel();
    return 'Reloaded atlases/base.png into the live model.';
  };
  const resetUvLayout = (): string => {
    if (!paintTarget) return 'Reset refused — this viewer has no package-backed paint target.';
    const atlas = uvPanel;
    if (!atlas || atlas.islands.length === 0) return 'Reset refused — there is no authored UV layout to restore.';
    const liveWorkspaceCorners = flattenUvFaceCorners(atlas.islands);
    if (!liveWorkspaceCorners) return 'Reset refused — the live UV corner table is incomplete.';
    const baseline = ensureModelUvResetBaseline(
      paintTarget,
      liveWorkspaceCorners,
      atlas.atlasOriginX,
      atlas.atlasOriginY,
    );
    if (!baseline) {
      return 'Reset refused — this atlas has no compatible saved starting layout. Remake the atlas once to establish one.';
    }
    if (!applyUvGeometry(new Float32Array(baseline.cornerUv), 'reset')) {
      return 'Reset refused — the saved atlas-start layout does not match the live mesh.';
    }
    const saved = writeModelArtifacts(paintTarget);
    return saved
      ? `Reset ${baseline.cornerUv.length / 2} UV corners to the saved atlas-start layout.`
      : 'Reset the live UV layout, but its current package record could not be saved.';
  };
  const saveUvAtlas = (): { path: string | null; note: string } => {
    if (!paintTarget) return { path: null, note: 'Export refused — this viewer has no package-backed paint target.' };
    const result = writeLiveModelAtlas(paintTarget);
    return result.ok
      ? { path: result.path, note: `saved base.png · ${result.width}×${result.height}` }
      : { path: null, note: result.error };
  };
  const exportUvWireframe = (islands?: readonly UvIslandRect[]): { path: string | null; note: string } => {
    if (!paintTarget) return { path: null, note: 'Export refused — this viewer has no package-backed paint target.' };
    const atlas = uvPanel;
    const authoredIslands = islands ?? atlas?.islands ?? [];
    if (!atlas || authoredIslands.length === 0 || atlas.w < 1 || atlas.h < 1) {
      return { path: null, note: 'Export refused — there is no authored UV geometry to draw.' };
    }
    const localIslands = atlas.atlasOriginX === 0 && atlas.atlasOriginY === 0
      ? authoredIslands
      : authoredIslands.map((rect) => ({
        ...rect,
        x: rect.x - atlas.atlasOriginX,
        y: rect.y - atlas.atlasOriginY,
      }));
    const raster = rasterizeUvWireframe(localIslands, atlas.w, atlas.h);
    if (!raster) return { path: null, note: 'Export refused — the UV wireframe exceeded the live atlas limit.' };
    const result = writeModelUvWireframe(paintTarget, raster.rgba, raster.width, raster.height);
    return result.ok
      ? {
        path: result.path,
        note: `exported transparent uv-wireframe.png · ${result.width}×${result.height} · ${raster.authoredEdges} authored edges`,
      }
      : { path: null, note: result.error };
  };
  const importUvAtlas = async (): Promise<string> => {
    if (!paintTarget || !resolvePackageDir(paintTarget.kind, paintTarget.id)) {
      return 'Import refused — save the model package first.';
    }
    if (uvPanel?.workspace) {
      return 'Import Texture would replace the compiled atlas behind an editable image workspace. Use Add Image Layer instead.';
    }
    const path = await pickFile({
      title: 'Import a texture for UV mapping',
      filters: [
        { name: 'Texture images', patterns: ['*.png', '*.jpg', '*.jpeg', '*.webp', '*.bmp'] },
        { name: 'All files', patterns: ['*'] },
      ],
    });
    if (!path) return 'Texture import canceled.';
    const encoded = readFileBase64(path);
    if (!encoded) return 'Import refused — the selected image could not be read.';
    const pipeline = imageOps(encoded);
    const metadata = pipeline.metadata();
    if (!metadata || metadata.width < 1 || metadata.height < 1) {
      return 'Import refused — the selected file is not a decodable image.';
    }
    const decodedBytes = metadata.width * metadata.height * 4;
    if (!Number.isSafeInteger(decodedBytes) || decodedBytes > UV_PREVIEW_BYTE_CAP) {
      return `Import refused — ${metadata.width}×${metadata.height} is too large for the live UV editor.`;
    }
    const decoded = pipeline.raw();
    if (!decoded || decoded.width !== metadata.width || decoded.height !== metadata.height) {
      return 'Import refused — the selected image could not be decoded to RGBA.';
    }
    if (host.__model_atlas_import?.(decoded.rgba, decoded.width, decoded.height, JOURNAL_UV_ATLAS_MUTATION) !== 1) {
      return 'Import refused by the live paint target or its undo snapshot.';
    }
    atlasReadyRef.current = true;
    writeModelArtifacts(paintTarget);
    const persisted = writeLiveModelAtlas(paintTarget);
    onDocumentMutated?.();
    buildUvPanel();
    const name = path.replace(/\\/g, '/').split('/').pop() || 'texture';
    return persisted.ok
      ? `Imported ${name} · ${decoded.width}×${decoded.height} — replaced the LIVE atlas only (saved paint variants keep theirs); remap UVs over the image.`
      : `Imported ${name} live, but ${persisted.error.toLowerCase()}`;
  };

  const markUvTextureWorkspaceStale = (): string => {
    const dir = paintTarget ? resolvePackageDir(paintTarget.kind, paintTarget.id) : null;
    const workspace = dir ? readUvTextureWorkspace(dir) : null;
    if (!dir || !workspace) return '';
    try {
      const stale = updateUvTextureWorkspace(workspace, workspace.layers);
      return writeUvTextureWorkspace(dir, stale)
        ? ' · image sources kept native; Compile is now stale'
        : ' · image sources stayed intact, but their stale marker could not be saved';
    } catch {
      return ' · image sources stayed intact, but their stale marker could not be created';
    }
  };

  const resizeUvAtlas = async (width: number, height: number): Promise<string> => {
    if (!paintTarget || !resolvePackageDir(paintTarget.kind, paintTarget.id)) {
      return 'Resize refused — save the model package first.';
    }
    const atlas = uvPanel;
    if (!atlas?.rgba || atlas.rgba.length !== atlas.w * atlas.h * 4) {
      return 'Resize refused — the live UV atlas pixels are unavailable.';
    }
    const result = planUvAtlasResize(atlas.w, atlas.h, width, height);
    if (!result.ok) return `Resize refused — ${result.error}`;
    const plan = result.plan;
    if (!plan.changed) return `UV total is already ${plan.targetWidth}×${plan.targetHeight}.`;
    if (typeof host.__model_atlas_resize !== 'function') {
      return 'Resize refused — this editor host does not expose atlas coordinate resizing.';
    }

    // Yield once so the inspector can paint its RESIZING state before the two
    // codec passes. Image sources remain untouched; only the current composite
    // base is resampled to keep the model continuously textured until import.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const sourcePng = encodeImage(atlas.rgba, atlas.w, atlas.h, { format: 'png' });
    if (!sourcePng) return 'Resize refused — the current atlas could not be staged for resampling.';
    const resizedPng = imageOps(sourcePng)
      .resize(plan.targetWidth, plan.targetHeight, { fit: 'fill' })
      .png()
      .toBuffer();
    const resized = resizedPng ? imageOps(resizedPng).raw() : null;
    if (!resized
      || resized.width !== plan.targetWidth
      || resized.height !== plan.targetHeight
      || resized.rgba.length !== plan.targetRgbaBytes) {
      return 'Resize refused — the resampled atlas did not match the requested UV total.';
    }
    if (host.__model_atlas_resize(
      resized.rgba,
      resized.width,
      resized.height,
      JOURNAL_UV_ATLAS_MUTATION,
    ) !== 1) {
      return 'Resize refused by the live paint target or its undo snapshot.';
    }

    atlasReadyRef.current = true;
    const workspaceNote = markUvTextureWorkspaceStale();
    writeModelArtifacts(paintTarget);
    const persisted = writeLiveModelAtlas(paintTarget);
    onDocumentMutated?.();
    buildUvPanel();
    const scale = `X ${plan.scaleX.toFixed(UV_ATLAS_SIZE_TUNING.scaleDigits)} · Y ${plan.scaleY.toFixed(UV_ATLAS_SIZE_TUNING.scaleDigits)}`;
    return persisted.ok
      ? `UV total ${plan.sourceWidth}×${plan.sourceHeight} → ${plan.targetWidth}×${plan.targetHeight} · ${scale}${workspaceNote}.`
      : `Resized the live UV total to ${plan.targetWidth}×${plan.targetHeight}, but ${persisted.error.toLowerCase()}${workspaceNote}.`;
  };

  const addUvTextureLayer = async (x: number, y: number): Promise<string> => {
    if (!paintTarget) return 'Add Image refused — this viewer has no package-backed paint target.';
    const dir = resolvePackageDir(paintTarget.kind, paintTarget.id);
    const atlas = uvPanel;
    if (!dir || !atlas) return 'Add Image refused — save and load the model package first.';
    // The first workspace source is the durable raster beneath the editable
    // paint program, never a transient JS preview. Persist before addressing it.
    writeModelArtifacts(paintTarget);
    const persisted = writeLiveModelAtlas(paintTarget);
    if (!persisted.ok) return `Add Image refused — ${persisted.error}`;
    const doc = ensureUvTextureWorkspace(dir, atlas.w, atlas.h);
    if (!doc) return 'Add Image refused — the current base.png could not seed the editable workspace.';
    const path = await pickFile({
      title: 'Add an image layer to the UV workspace',
      filters: [
        { name: 'Texture images', patterns: ['*.png', '*.jpg', '*.jpeg', '*.webp', '*.bmp'] },
        { name: 'All files', patterns: ['*'] },
      ],
    });
    if (!path) return 'Add Image canceled.';
    try {
      const result = importUvTextureWorkspaceLayer(dir, doc, path, x, y);
      onDocumentMutated?.();
      buildUvPanel();
      return `Added ${result.layer.name} at ${result.layer.x}, ${result.layer.y} · ${result.layer.width}×${result.layer.height} native pixels. Compile when the image layout is ready.`;
    } catch (error) {
      return `Add Image refused — ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  const editUvTextureLayer = (id: string, edit: UvTextureLayerEdit): string => {
    const dir = paintTarget ? resolvePackageDir(paintTarget.kind, paintTarget.id) : null;
    const doc = dir ? readUvTextureWorkspace(dir) : null;
    if (!dir || !doc) return 'Image-layer edit refused — this model has no editable UV workspace yet.';
    const index = doc.layers.findIndex((layer) => layer.id === id);
    if (index < 0) return 'Image-layer edit refused — that source layer no longer exists.';
    const current = doc.layers[index]!;
    if (edit.kind === 'position' && current.locked) {
      return `${current.name} is locked — unlock its layer before moving the image.`;
    }
    if (edit.kind === 'locked') {
      try {
        const next = setUvTextureLayerLocked(doc, id, edit.locked);
        if (!writeUvTextureWorkspace(dir, next)) return 'Image-layer lock could not be saved.';
        onDocumentMutated?.();
        buildUvPanel();
        return `${current.name} ${edit.locked ? 'locked against canvas movement' : 'unlocked for image placement'} · the compiled texture remains current.`;
      } catch (error) {
        return `Image-layer lock refused — ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    const layers = [...doc.layers];
    if (edit.kind === 'position') {
      layers[index] = { ...layers[index]!, x: Math.round(edit.x), y: Math.round(edit.y) };
    } else if (edit.kind === 'visible') {
      layers[index] = { ...layers[index]!, visible: edit.visible };
    } else if (edit.kind === 'raise' && index < layers.length - 1) {
      [layers[index], layers[index + 1]] = [layers[index + 1]!, layers[index]!];
    } else if (edit.kind === 'lower' && index > 0) {
      [layers[index], layers[index - 1]] = [layers[index - 1]!, layers[index]!];
    } else if (edit.kind === 'remove') {
      if (layers.length === 1) return 'The workspace must retain at least one source image.';
      layers.splice(index, 1);
    } else {
      return 'Image layer is already at that boundary.';
    }
    try {
      const next = updateUvTextureWorkspace(doc, layers);
      if (!writeUvTextureWorkspace(dir, next)) return 'Image-layer edit could not be saved.';
      onDocumentMutated?.();
      buildUvPanel();
      return edit.kind === 'position'
        ? `Moved ${doc.layers[index]!.name} to ${Math.round(edit.x)}, ${Math.round(edit.y)} · texture compile is now stale.`
        : `${doc.layers[index]!.name} updated · texture compile is now stale.`;
    } catch (error) {
      return `Image-layer edit refused — ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  const compileUvTextureLayers = async (
    onProgress?: (completed: number, total: number, label: string) => void,
  ): Promise<string> => {
    if (!paintTarget) return 'Compile refused — this viewer has no package-backed paint target.';
    const dir = resolvePackageDir(paintTarget.kind, paintTarget.id);
    const doc = dir ? readUvTextureWorkspace(dir) : null;
    if (!dir || !doc) return 'Compile refused — add an image layer to create the editable workspace first.';
    if (typeof host.__model_atlas_workspace_apply !== 'function') {
      return 'Compile refused — this editor host does not expose the UV workspace compiler.';
    }
    try {
      const visibleLayerCount = doc.layers.filter((layer) => layer.visible).length;
      const raster = await rasterizeUvTextureWorkspace(dir, doc, onProgress);
      onProgress?.(visibleLayerCount + 1, visibleLayerCount + 2, 'Applying atlas and UV origin');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (host.__model_atlas_workspace_apply(
        raster.rgba,
        raster.width,
        raster.height,
        raster.shiftX,
        raster.shiftY,
        1,
      ) !== 1) return 'Compile refused by the live model or its UV geometry.';
      atlasReadyRef.current = true;
      writeModelArtifacts(paintTarget);
      const persisted = writeLiveModelAtlas(paintTarget);
      if (!persisted.ok || !persisted.path) {
        buildUvPanel();
        return `Compiled the live texture, but ${persisted.error.toLowerCase()}`;
      }
      const atlasSha256 = fileSha(persisted.path);
      if (!/^[0-9a-f]{64}$/.test(atlasSha256)
        || !commitUvTextureWorkspaceCompile(dir, doc, raster, atlasSha256)) {
        buildUvPanel();
        return 'Compiled and saved base.png, but the editable workspace could not commit its new origin.';
      }
      onDocumentMutated?.();
      buildUvPanel();
      return `Compiled ${doc.layers.filter((layer) => layer.visible).length} visible image layers to ${raster.width}×${raster.height} with transparent unused space · origin ${raster.x}, ${raster.y}. Sources remain editable.`;
    } catch (error) {
      return `Compile refused — ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  const adoptMeshHistoryResult = (result: TopoResult | null): boolean => {
    if (!result?.ok || !adoptMesh(result)) return false;
    const label = result.label ?? '';
    // adoptMesh already refreshes a live Paint panel. This extra branch covers app-wide
    // UV undo outside Paint without doing a second expensive atlas read in Paint.
    if (isUvDocumentHistoryLabel(label) && !paintMode) buildUvPanel();
    if ((label === UV_ATLAS_IMPORT_LABEL
      || label === UV_ATLAS_RELOAD_LABEL
      || label === UV_ATLAS_RESIZE_LABEL) && paintTarget) {
      // These raster actions write the package immediately, so their inverse
      // must keep base.png (and editable-workspace staleness) in lockstep too.
      if (label === UV_ATLAS_RESIZE_LABEL) markUvTextureWorkspaceStale();
      writeModelArtifacts(paintTarget);
      writeLiveModelAtlas(paintTarget);
    }
    return true;
  };
  const stepUvHistory = (redo: boolean): string => {
    const history = readMeshHistory();
    const label = redo ? history.redoLabel : history.undoLabel;
    const depth = redo ? history.redo : history.undo;
    const verb = redo ? 'redo' : 'undo';
    if (depth <= 0) return `Nothing to ${verb} in UV history.`;
    if (!isUvDocumentHistoryLabel(label)) {
      return `${verb === 'undo' ? 'Undo' : 'Redo'} is currently owned by “${label || 'another model edit'}”; use the app-wide history control.`;
    }
    const paintHistory = readPaintHistory();
    const paintBarrier = redo ? paintHistory.redo : paintHistory.undo;
    if (paintBarrier > 0) {
      const reopen = paintMode ? '' : ' (re-enter Paint)';
      return redo
        ? `Redo ${paintBarrier} paint ${paintBarrier === 1 ? 'step' : 'steps'} first${reopen}; they were undone after this UV step.`
        : `Undo ${paintBarrier} newer paint ${paintBarrier === 1 ? 'step' : 'steps'} first${reopen}.`;
    }
    const result = redo ? meshRedoDoor() : meshUndoDoor();
    if (!adoptMeshHistoryResult(result)) return `${verb === 'undo' ? 'Undo' : 'Redo'} ${label} failed; the live model was left unchanged.`;
    onDocumentMutated?.();
    return `${redo ? 'Redid' : 'Undid'} ${label}.`;
  };
  // Refresh the UV/atlas panel when it is LIVE (paint mode) — invoked off every mesh
  // adopt / topo op and at stroke end, so the panel tracks the real atlas without the
  // manual refresh click (req_2625 GG). The Inspector's refresh verb stays a fallback.
  const refreshUvIfLive = () => { if (paintMode) buildUvPanel(); };

  const enterPaint = () => {
    setPathPlaneMode(false);
    setPathEdgesMode(false);
    setFocusMode(false);
    meshFocusTool(false);
    setSelMode(0);
    meshSetMode(0);
    setPaintMode(true);
    buildUvPanel();
  };
  // ONE hydration port for every path that restores persisted paint onto the resident
  // model — cold load and variant load go through the same engine (paintHydration).
  const paintHydrationPort: PaintHydrationPort = {
    invalidateLayout: () => { host.__model_paint_layout_invalidate?.(); },
    setDetail: (savedDetail) => { changeDetail(savedDetail); },
    importAtlas: (raster) => host.__model_atlas_import?.(raster.rgba, raster.width, raster.height) === 1,
    applyLayout: (layout) => host.__model_uv_layout_apply?.(layout) === 1,
    // Hydration restores authored UV GEOMETRY, not only each island's bounding
    // rectangle. Omit a history ordinal: loading disk truth is not a new undoable
    // edit in this session.
    applyCornerUv: (cornerUv) => host.__model_uv_geometry_apply?.(cornerUv) === 1,
    applyProgram: (program) => host.__model_paint_program_apply?.(program) === 1,
    applyProgramOverBase: (program) => host.__model_paint_program_apply_over_base?.(program) === 1,
    applyAtlas: (savedDetail, data) => host.__model_atlas_apply?.(savedDetail, data) === 1,
  };
  // A full-look variant restores from its own raster base: the baseline png beneath
  // its strokes when one exists, else its composite substrate png (req_3439).
  const readVariantRasterBase = (variant: PaintVariant): DecodedPaintRaster | null => {
    const path = variant.basePng ?? variant.png;
    const encoded = path ? readFileBase64(path) : null;
    const decoded = encoded ? imageOps(encoded).raw() : null;
    return decoded ? { width: decoded.width, height: decoded.height, rgba: decoded.rgba } : null;
  };
  // Hydrate authored paint as DOCUMENT state. This is deliberately independent of
  // Paint mode: opening a model must publish its existing UV atlas immediately, while
  // the Paint button only decides which tool owns viewport input (req_3349).
  const hydratePersistedAtlas = (): boolean => {
    if (!paintTarget || !paintTargetOnDisk || !resolvePackageDir(paintTarget.kind, paintTarget.id)) return false;
    const result = hydratePersistedModelPaint({
      stale: modelPaintLayoutIsStale(paintTarget),
      basePaint: readModelBasePaint(paintTarget),
      readRasterBase: () => {
        const encoded = readModelRasterBase(paintTarget);
        const decoded = encoded ? imageOps(encoded).raw() : null;
        return decoded ? { width: decoded.width, height: decoded.height, rgba: decoded.rgba } : null;
      },
      readLatestVariant: () => {
        const saved = listPaintVariants(paintTarget);
        return saved.length > 0 ? saved[saved.length - 1]! : null;
      },
      readVariantRasterBase,
    }, paintHydrationPort);
    if (result.status === 'ready') {
      atlasReadyRef.current = true;
      atlasInvalidatedRef.current = false;
      return true;
    }
    atlasReadyRef.current = false;
    if (result.status === 'stale') {
      atlasInvalidatedRef.current = true;
      setPaintMode(false);
    } else if (result.status === 'failed') {
      console.error(`[paint] persisted atlas for ${paintTarget.id} exists but could not be hydrated`);
    }
    return false;
  };
  // Restore one SAVED LOOK onto the resident model (req_3439): the PAINT VARIANTS
  // panel's Load. Same hydration engine as cold load, pointed at the chosen variant —
  // full looks bring back their texture + UV layout + strokes; legacy variants keep
  // their program/atlas replay. Refuses while the package's paint layout is stale.
  const loadPaintVariant = (variant: PaintVariant): boolean => {
    if (!paintTarget) return false;
    const result = hydratePersistedModelPaint({
      stale: modelPaintLayoutIsStale(paintTarget),
      basePaint: null,
      readRasterBase: () => null,
      readLatestVariant: () => variant,
      readVariantRasterBase,
    }, paintHydrationPort);
    if (result.status !== 'ready') return false;
    atlasReadyRef.current = true;
    atlasInvalidatedRef.current = false;
    buildUvPanel();
    return true;
  };

  // Model adoption happens in the mount effect below. Once its host-resident key lands,
  // hydrate any saved atlas and publish it to the UV bridge without arming the brush.
  // Glass restore (req_3402) runs AFTER hydration in the same pass: hydration
  // rebuilds the atlas from the RGB-only baseline + program (req_2928), so the
  // saved trailing-glass run (doc.blob glassFirstVertex) must be re-applied on
  // top — before this, every restart silently un-glassed the model.
  const glassRestoredRef = useRef(false);
  useEffect(() => {
    if (!model) return;
    if (!atlasReadyRef.current && !atlasInvalidatedRef.current) {
      if (hydratePersistedAtlas()) buildUvPanel();
    }
    const gv = initialMesh?.glassFirstVertex;
    if (!glassRestoredRef.current && typeof gv === 'number' && gv >= 0) {
      glassRestoredRef.current = true;
      host.__model_glass_restore?.(gv);
    }
  }, [model?.key, paintTarget?.kind, paintTarget?.id, paintTargetOnDisk]);

  const togglePaint = () => {
    if (paintMode) {
      setPaintMode(false);
      return;
    }
    if (!model) return;
    if (!atlasReadyRef.current) {
      if (hydratePersistedAtlas()) {
        enterPaint();
        return;
      }
      setAtlasPrompt(true);
      return;
    }
    enterPaint();
  };
  const togglePathPlane = () => {
    if (!model) return;
    setPaintMode(false);
    setFocusMode(false);
    meshFocusTool(false);
    setSelMode(0);
    meshSetMode(0);
    setPathEdgesMode(false);
    setPathPlaneMode((active) => !active);
  };
  const togglePathEdges = () => {
    if (!model) return;
    setPaintMode(false);
    setFocusMode(false);
    meshFocusTool(false);
    setSelMode(0);
    meshSetMode(0);
    setPathPlaneMode(false);
    setPathEdgesMode((active) => !active);
  };
  // Both pen commits land their anchors as welded verts; dropping straight into vertex
  // mode makes every pen point immediately draggable with the move gizmo (the depth
  // story: lay the outline flat, then pull real depth vertex by vertex).
  const enterVertexModeOnPenCommit = () => {
    setPathPlaneMode(false);
    setPathEdgesMode(false);
    chooseGizmoTool(0);
    chooseSelMode(1);
  };
  // Fill only (density 1) vs an atlas-budget fit — the prompt's two shapes of pick.
  const createAtlasAndPaint = (fillOnly: boolean, fitTexels: number) => {
    if (paintTarget && !paintTargetOnDisk && !(onRequireFirstSave?.() ?? false)) return;
    if (fillOnly) changeDetail(1);
    else changeFit(fitTexels);
    // Lay the chosen base TYPE onto the fresh atlas (req_2546): 0 template, 1 solid, 2 blank.
    // Solid uses the current ink colour so "flat colour" means the one you're holding.
    const mode = baseType === 'solid' ? 1 : baseType === 'blank' ? 2 : 0;
    const [sr, sg, sb] = baseType === 'solid' ? brushRgb(brush) : [220, 220, 225];
    host.__model_atlas_base?.(mode, sr, sg, sb);
    atlasReadyRef.current = true;
    atlasInvalidatedRef.current = false;
    // The moment the atlas is made + coloured, persist it as the model's base atlas + mesh
    // (req_2551) — the freshly laid base is exactly what atlases/base.png should hold.
    if (paintTarget) writeModelArtifacts(paintTarget, undefined, undefined, { captureUvResetBaseline: true });
    setAtlasPrompt(false);
    enterPaint();
  };
  const toggleFocus = () => setFocusMode((v) => { const nv = !v; meshFocusTool(nv); if (nv) { setPaintMode(false); setPathPlaneMode(false); setPathEdgesMode(false); setSelMode(0); meshSetMode(0); } return nv; });
  // Camera lock is a pure view toggle — it doesn't leave the current tool/mode; the
  // host gate is what freezes the orbit. Pushed on every change AND at mount, so a
  // hot-reloaded cart (fresh false state) re-syncs a host that was left locked.
  const toggleCamLock = () => setCamLock((v) => !v);
  useEffect(() => { orbitSetLocked(camLock); }, [camLock]);
  // View bookmarks (req_3067/req_3074). Store reads the live pose through the host door
  // and appends a named bookmark; a recall applies one back (the host refuses under the
  // camera lock, matching every other motion). The action-bar Store button and the
  // focus panel's + verb both land in camStoreView; the H key returns to the ACTIVE
  // bookmark — the one last stored or clicked.
  const camStoreView = () => {
    const j = host.__model_cam_pose?.();
    if (typeof j !== 'string' || !j) return;
    let pose: number[];
    try { pose = JSON.parse(j) as number[]; } catch { return; }
    if (!Array.isArray(pose) || pose.length !== 6) return;
    // Number past the highest existing "View N" so a removed bookmark's name is
    // never silently reissued to a different pose.
    const top = camMarks.reduce((n, m) => Math.max(n, Number(m.name.match(/^View (\d+)$/)?.[1] ?? 0)), 0);
    setCamMarks([...camMarks, { name: `View ${top + 1}`, pose }]);
    setCamMark(camMarks.length);
  };
  const camRecallAt = (index: number) => {
    const mark = camMarks[index];
    if (!mark) return;
    const p = mark.pose;
    host.__model_cam_set_pose?.(p[0], p[1], p[2], p[3], p[4], p[5]);
    setCamMark(index);
  };
  const camRecallView = () => camRecallAt(camMark >= 0 && camMark < camMarks.length ? camMark : camMarks.length - 1);
  const camRemoveAt = (index: number) => {
    setCamMarks((marks) => marks.filter((_, i) => i !== index));
    setCamMark((active) => (active === index ? -1 : active > index ? active - 1 : active));
  };

  // Mirror the tool-holding state into its hot twig on every change (req_2898) —
  // cheap (one small JSON into the host map), and the next mount seeds from it.
  useEffect(() => {
    setHotState<ToolTwig>(TOOL_TWIG_KEY, { wire, camLock, camMarks, camMark, gizmoTool, mirrorMask, brush, brushTool, palette, safety, detail, litFlat, litKey, litFill, paint: paintMode });
  }, [wire, camLock, camMarks, camMark, gizmoTool, mirrorMask, brush, brushTool, palette, safety, detail, litFlat, litKey, litFill, paintMode]);

  // Stamp which document owns the host's resident mesh, under its CURRENT key —
  // topology ops re-key the mesh, so this tracks every adopt. The next mount
  // resumes the live session only when doc AND key both still match the host.
  const hotDocId = paintTarget ? `${paintTarget.kind}:${paintTarget.id}` : initialPath ?? null;
  useEffect(() => {
    if (model && hotDocId) setHotState<DocTwig>(DOC_TWIG_KEY, { docId: hotDocId, key: model.key });
  }, [model?.key, hotDocId]);

  // ── Brush behaviour handlers ─────────────────────────────────────────────────
  // Apply an exact density through the host (it rebuilds the paint atlas and re-uploads
  // the mesh); the door returns the ACTUAL density after its memory-budget guard.
  const changeDetail = (px: number): number => {
    const applied = applyPaintDetail(px);
    setDetail(applied);
    setFit(null); // an explicit density leaves fit mode
    // The atlas was rebuilt — the UV panel is showing the OLD layout; refresh it.
    if (paintMode) buildUvPanel();
    return applied;
  };
  // Apply an atlas-budget fit; the returned DERIVED density becomes the live readout.
  const changeFit = (texels: number): number => {
    const applied = applyPaintFit(texels);
    setDetail(applied);
    setFit(texels);
    if (paintMode) buildUvPanel();
    return applied;
  };
  // The Density button cycles the atlas budgets (512² → 1024² → 2048² → 4096²); the
  // label shows the density each budget derives for THIS model.
  const cycleDetail = () => {
    const i = FIT_LEVELS.indexOf((fit ?? DEFAULT_FIT) as (typeof FIT_LEVELS)[number]);
    changeFit(FIT_LEVELS[(i + 1) % FIT_LEVELS.length]!);
  };
  // Entering the brush from fill-only auto-raises to the standard atlas budget — the
  // proven painter's baseline; the density falls out of the model's own size.
  const chooseBrushTool = (t: BrushTool) => {
    setBrushTool(t);
    if (t !== 'fill' && detail <= 1) changeFit(DEFAULT_FIT);
  };
  const cycleSafety = () => setSafety((v) => (v === 0 ? 1 : 0));

  // Push the free-form face-safety mode to the host whenever it (or paint mode) changes.
  useEffect(() => { if (paintMode) setPaintSafety(safety); }, [safety, paintMode]);
  // Mirror paint mode to the host (req_2662): the mode row is ONE exclusive state
  // machine. While the session is live the host holds every edit-selection affordance
  // quiet — selection doors inert, face wash/tint/gizmo undrawn — and entering it
  // RESETS the selection host-side (documented choice: paint entry clears; leaving
  // paint starts clean in Object mode, nothing to restore). Covers every entry/exit
  // path (toolbar, hotkey, focus toggle, fresh-load reset) because they all flow
  // through this one state.
  useEffect(() => {
    host.__mesh_paint_session?.(paintMode ? 1 : 0);
    if (paintMode) setSelInfo(readSelInfo() ?? { mode: 0, verts: 0, edges: 0, sel: 0 }); // the entry reset zeroed the selection — the HUD count must follow
    // Unmounting mid-paint (doc switch) must not leave the host session stuck on —
    // the next viewer would boot with every selection door inert.
    return () => { if (paintMode) host.__mesh_paint_session?.(0); };
  }, [paintMode]);
  // NOTE: the host CARRIES the paint density across mesh adopts (edits and fresh loads
  // rebuild the island atlas at the last-chosen density), so the JS mirror deliberately
  // survives model key changes too — no reset-to-1 here.

  // Live mirror editing (req_2758): push the enabled symmetry planes to the host. The
  // host mask outlives model loads, so unmount clears it — the next viewer must start
  // with what its toggles show (all off), never an inherited invisible symmetry.
  useEffect(() => {
    meshSetMirror(mirrorMask);
    return () => { if (mirrorMask) meshSetMirror(0); };
  }, [mirrorMask]);

  // Symmetry trust layer (studio req_1190-1192 ported, req_2831): while mirror planes
  // are armed, poll the live report per armed axis — the "⚠ N off Y" / "✓ clean" badge
  // and the keep+/keep− symmetrize verbs beside it. Poll, not per-edit hooks: edits land
  // host-side (gizmo drags, topo ops) where no JS callback fires.
  const [symReports, setSymReports] = useState<Record<number, SymReport>>({});
  useEffect(() => {
    if (!mirrorMask || !model || paintMode) { setSymReports({}); return; }
    let alive = true;
    const read = () => {
      if (!alive) return;
      const out: Record<number, SymReport> = {};
      for (let axis = 0; axis < 3; axis += 1) {
        if (!(mirrorMask & (1 << axis))) continue;
        const rep = meshSymmetryReport(axis);
        if (rep) out[axis] = rep;
      }
      setSymReports((prev) => {
        const same = [0, 1, 2].every((a) => (prev[a]?.unmatched === out[a]?.unmatched) && ((prev[a] == null) === (out[a] == null)));
        return same ? prev : out;
      });
      setTimeout(read, 600);
    };
    read();
    return () => { alive = false; };
  }, [mirrorMask, model?.key, paintMode]);

  const runSymmetrize = (axis: number, keepPositive: boolean) => {
    if (!adoptMesh(meshSymmetrize(axis, keepPositive))) setError('symmetrize: no mesh half to keep');
  };

  // ── Editor bridge ──────────────────────────────────────────────────────────
  // Hand the tool handlers out (once) and mirror the live tool state back, so an
  // embedding shell can drive the SAME tools its toolbar/context-menu present.
  // The exposed api wraps a ref to the latest handlers so it stays referentially
  // stable while always closing over fresh state — one owner, no split-brain.
  const toolApiRef = useRef<ModelToolApi | null>(null);
  toolApiRef.current = {
    selMode: chooseSelMode,
    gizmo: chooseGizmoTool,
    scaleBy: meshScaleBy,
    resyncFromHost: () => {
      const session = readModelSession();
      if (session?.key) setModel((m) => (m && m.key !== session.key ? { ...m, key: session.key, count: session.count } : m));
      adoptHostSelection(selInfo);
      return resyncPartRanges();
    },
    paint: togglePaint,
    pathPlane: togglePathPlane,
    pathEdges: togglePathEdges,
    focus: toggleFocus,
    wire: () => setWire((v) => !v),
    camLock: toggleCamLock,
    camStore: camStoreView,
    camRecall: camRecallView,
    camRecallAt,
    camRemoveAt,
    extrudeEdge: () => { if (model) applyTopo(meshExtrudeEdge(model.radius * 0.08), 'Select exactly one edge to extrude'); },
    extrudeFace: () => { if (model) applyTopo(meshExtrudeFace(model.radius * 0.08), 'Select exactly one face to extrude'); },
    createFace: () => applyTopo(meshCreateFace(), 'Select two separate edges or a closed 3/4-edge loop'),
    weld: () => applyTopo(meshWeld(), 'Select at least two vertices (or an edge) to weld'),
    bevel: openBevel,
    selectUvOrientation,
    flipSelection: () => adoptMesh(meshFlipFaces()),
    // Mode-aware: face mode opens the studio-style popup session (direction/cuts/offset
    // with live preview); edge mode keeps the one-shot perpendicular-plane cut.
    loopCut: () => {
      if (selMode === 3) { openLoopCut(); return; }
      applyTopo(meshLoopCut(), 'Select exactly one edge to loop-cut across');
    },
    basicCut: () => {
      if (selMode === 3) { openLoopCut(true); return; }
      setError('Select a face to cut (face mode)');
    },
    deleteSelection: () => applyTopo(meshDeleteSelection(), 'Nothing selected to delete'),
    toggleMirror: (axis) => setMirrorMask((m) => m ^ (1 << axis)),
    referenceImages: () => setBackdropPanel((v) => !v),
    // Host-authoritative part ops (the outliner). Append preserves prior edits; hide/delete
    // act on the part's group range. All adopt the new host mesh key without a JS recompose.
    // The HOST maintains the part-range truth through each op (req_2644); adoptMesh resyncs
    // the mirror from __mesh_part_ranges. The push fallback only fires when the mesh had no
    // ranges yet (first part op on an unparted mesh — the cart still authors the seed).
    appendPart: (positions, faceGroups, color, expectedPartCount) => {
      const r = meshAppendGroup(positions, faceGroups, expectedPartCount);
      if (!adoptMesh(r) || r?.lo == null || r?.hi == null) {
        // The host's refusal reason previously died in the terminal log while the
        // UI said only "could not add mesh" (req_3461). Read the host's own range
        // truth and say EXACTLY what disagrees, where the user is looking.
        const hostRanges = meshPartRangesRead();
        setError(hostRanges && hostRanges.length !== expectedPartCount
          ? `Add Part refused — the outliner lists ${expectedPartCount} part(s) but the live mesh carries ${hostRanges.length} range(s). Save + reopen the model to rebuild both from disk.`
          : 'Add Part refused by the live mesh — save + reopen the model, then try again.');
        return null;
      }
      // The appended part's authored grouping IS cart-side here — keep the authored
      // face count true through Add Part (req_2618 G: the SHAPE strip must not keep
      // reading the load-time count after the model grew).
      setAuthoredFaces((prev) => (prev != null ? prev + new Set(faceGroups).size : prev));
      const [rr, gg, bb] = hexToRgb01(color);
      host.__model_paint_group_range?.(r.lo, r.hi, Math.round(rr * 255), Math.round(gg * 255), Math.round(bb * 255));
      if (!resyncPartRanges()) {
        partRangesRef.current = [...partRangesRef.current, { lo: r.lo, hi: r.hi }];
        meshSetPartRanges(partRangesRef.current);
      }
      return { lo: r.lo, hi: r.hi };
    },
    setPartHidden: (lo, hi, hidden) => {
      const r = meshSetGroupHidden(lo, hi, hidden);
      const ok = adoptMesh(r) && Boolean(r?.ok);
      return r ? { ok, count: Math.floor((r.count ?? 0) / 3) } : null;
    },
    deletePartRange: (lo, hi) => {
      const live = resolveLivePartRange(lo, hi);
      const r = meshDeleteGroupRange(live.lo, live.hi);
      const ok = adoptMesh(r) && Boolean(r?.ok);
      // Deleting a PART is a structural change the cart authors: the pair leaves the
      // range list (the host kept the id-span — its faces are gone, the row follows).
      // Only on a host-confirmed delete — a failed op keeps the mirror true to the mesh.
      if (ok) {
        partRangesRef.current = partRangesRef.current.filter((pr) => pr.lo !== live.lo || pr.hi !== live.hi);
        meshSetPartRanges(partRangesRef.current);
      }
      return r ? { ok, count: Math.floor((r.count ?? 0) / 3) } : null;
    },
    // ── Studio-parity part ops. Each adopts the host's new mesh key; the host grew or
    // fused its range truth inside the op, so the mirror resyncs (fallback: seed push).
    duplicatePart: (lo, hi, mirrorAxis) => {
      const live = resolveLivePartRange(lo, hi);
      const r = meshDuplicateRange(live.lo, live.hi, mirrorAxis);
      if (!adoptMesh(r) || r?.lo == null || r?.hi == null) return null;
      // No tint here — the host copied the source part's per-face paint onto the twin.
      if (!resyncPartRanges()) {
        partRangesRef.current = [...partRangesRef.current, { lo: r.lo, hi: r.hi }];
        meshSetPartRanges(partRangesRef.current);
      }
      return { lo: r.lo, hi: r.hi };
    },
    pathArraySpans: (ranges) => meshPathArraySpans(ranges),
    pathArray: (ranges, params) => {
      const r = meshPathArray(ranges, params);
      if (!adoptMesh(r) || !Array.isArray(r?.ranges)) return null;
      const fresh = r.ranges
        .map((pair) => ({ lo: Number(pair?.[0]), hi: Number(pair?.[1]) }))
        .filter((range) => Number.isInteger(range.lo) && Number.isInteger(range.hi) && range.hi > range.lo);
      if (fresh.length !== r.ranges.length) return null;
      resyncPartRanges();
      return { ranges: fresh };
    },
    detachSelection: () => {
      const r = meshDetach();
      if (!adoptMesh(r) || r?.lo == null || r?.hi == null) return null;
      if (!resyncPartRanges()) {
        partRangesRef.current = [...partRangesRef.current, { lo: r.lo, hi: r.hi }];
        meshSetPartRanges(partRangesRef.current);
      }
      return { lo: r.lo, hi: r.hi };
    },
    mergeParts: (aLo, aHi, bLo, bHi) => {
      const r = meshMergePartsDoor(aLo, aHi, bLo, bHi);
      if (!adoptMesh(r) || r?.lo == null || r?.hi == null) return null;
      if (!resyncPartRanges()) {
        partRangesRef.current = [
          ...partRangesRef.current.filter((pr) => !(pr.lo === aLo && pr.hi === aHi) && !(pr.lo === bLo && pr.hi === bHi)),
          { lo: r.lo, hi: r.hi },
        ];
        meshSetPartRanges(partRangesRef.current);
      }
      return { lo: r.lo, hi: r.hi };
    },
    mergeFaces: () => adoptMesh(meshMergeFaces()),
    trisToQuads: openQuadify,
    glassSelection: () => adoptMesh(meshGlass()),
    solidifySelection: () => adoptMesh(meshSolidify()),
    appendModelFile: (path, color, expectedPartCount) => {
      const r = meshAppendFile(path, expectedPartCount);
      if (!adoptMesh(r) || r?.lo == null || r?.hi == null) return null;
      const [rr, gg, bb] = hexToRgb01(color);
      host.__model_paint_group_range?.(r.lo, r.hi, Math.round(rr * 255), Math.round(gg * 255), Math.round(bb * 255));
      if (!resyncPartRanges()) {
        partRangesRef.current = [...partRangesRef.current, { lo: r.lo, hi: r.hi }];
        meshSetPartRanges(partRangesRef.current);
      }
      return { lo: r.lo, hi: r.hi };
    },
    undoMesh: () => {
      const r = meshUndoDoor();
      if (!r?.ok || !adoptMeshHistoryResult(r)) return { ok: false, label: '', note: null };
      return { ok: true, label: r.label ?? 'mesh edit', note: meshJournalNote() };
    },
    redoMesh: () => {
      const r = meshRedoDoor();
      if (!r?.ok || !adoptMeshHistoryResult(r)) return { ok: false, label: '', note: null };
      return { ok: true, label: r.label ?? 'mesh edit', note: meshJournalNote() };
    },
    setPartRangesMirror: (ranges) => {
      partRangesRef.current = ranges.slice();
      meshSetPartRanges(partRangesRef.current);
    },
    setQuality: (q) => applyQuality(q),
    brushTool: chooseBrushTool,
    cycleSafety,
    cycleDetail,
    changeDetail,
    setBrush,
    setPalette,
    toggleLight: (which) => {
      if (which === 'flat') setLitFlat((v) => !v);
      else if (which === 'key') setLitKey((v) => !v);
      else setLitFill((v) => !v);
    },
  };
  // Hand the LIVE api object straight to the editor, re-registering every render. The old
  // approach registered a one-shot wrapper that hand-listed every method — a duplicate list
  // that silently drifted, so a method on the real api (toggleLight) missing from the wrapper
  // made the editor call "X is not a function". Registering the real object can't drift.
  // onModelToolApi only stores a ref, so this is a cheap assignment with no re-render.
  useEffect(() => { onToolApi?.(toolApiRef.current!); });

  // Paint-with-a-shader: keep the HOST paint-material in sync with the brush ink. A shader
  // ink bakes its recipe (spec WGSL + tuned params) into a pixel bucket the brush samples;
  // any other ink clears it back to flat-colour painting. Runs only when the ink changes —
  // never per dab — so the one-shot GPU bake + readback stays off the paint hot path.
  useEffect(() => {
    const ink = brush.ink;
    if (ink.kind === 'shader') {
      const spec = shaderSpec(ink.surface);
      if (!spec) {
        console.error(`[paint] shader ink '${ink.surface}' is not in the catalog — painting flat color instead`);
        setInkWarn(`Shader '${ink.surface}' not found in the catalog — the brush will paint flat color.`);
        host.__model_paint_material_clear?.();
        return;
      }
      const data = ink.data && ink.data.length ? ink.data : defaultShaderData(spec);
      const tiles = ink.tiles && ink.tiles > 0 ? ink.tiles : 1;
      // Vary the bake key per param set — the host materialize() caches per key, so a
      // fixed key would keep re-serving the first look after the user tunes the shader.
      const key = `paint:${ink.surface}:${data.map((n) => Math.round(n * 1000)).join(',')}`;
      const bytes = new Uint8Array(new Float32Array(data).buffer);
      const ok = host.__model_paint_material?.(key, spec.shader, bytes, 256, tiles) === 1;
      if (!ok) {
        // Never fail into silent white: report it where the user paints.
        console.error(`[paint] shader ink bake FAILED for '${ink.surface}' (door returned 0) — painting flat color instead`);
        setInkWarn(`Shader ink '${spec.label}' failed to bake — the brush will paint flat color. Host log has details.`);
      } else {
        setInkWarn(null);
        // A material ink can't READ at fill-only density: a face's island is a
        // couple of texels, so a fill degrades to a near-flat sample (req_2503).
        // Dipping a shader auto-raises the paint fidelity to the standard atlas
        // budget — the same auto-pick entering the brush tool uses.
        if (detail === 1) {
          const applied = changeFit(DEFAULT_FIT);
          if (applied <= 1) {
            setInkWarn('The paint atlas could not leave fill-only density — the shader will paint as one flat color. Lower the mesh density or paint resolution budget.');
          }
        }
      }
      return;
    }
    setInkWarn(null);
    host.__model_paint_material_clear?.();
  }, [brush.ink]);
  // The viewer's unresolved BLOCKING session, mirrored up with the tool state so the
  // shell can enforce modal discipline (req_2626 HH): while one is live, the shell
  // holds every other input surface inert until the user resolves it HERE.
  const blocking: ModelBlockingSession = bv ? 'bevel' : lc ? 'loop-cut' : quadify ? 'tris-to-quads' : atlasPrompt ? 'paint-atlas' : guard?.pending ? 'face-guard' : null;
  useEffect(() => {
    onToolState?.({ selMode, gizmoTool, paint: paintMode, pathPlane: pathPlaneMode, pathEdges: pathEdgesMode, focus: focusMode, wire, camLock, camSaved: camMarks.length > 0, sel: selInfo.sel, quality, tris: model ? Math.floor(model.count / 3) : 0, brushTool, safety, detail, brush, palette, litFlat, litKey, litFill, litRim: false, blocking, mirror: mirrorMask });
  }, [selMode, gizmoTool, paintMode, pathPlaneMode, pathEdgesMode, focusMode, wire, camLock, camMarks.length, selInfo.sel, quality, model?.count, brushTool, safety, detail, brush, palette, litFlat, litKey, litFill, blocking, mirrorMask]);

  // Publish the focus-panel snapshot (UV atlas + SHAPE counts) through the global
  // door (req_2643 OO / req_2618 G) — the Inspector's UV/SHAPE sections subscribe.
  // Only what is ALREADY real cart-side goes out: counts from the host counts door,
  // faces from the authored grouping, uv'd derived from the whole-model atlas,
  // mounts an honest 0 until the rig slice lands. Never invented.
  useEffect(() => {
    const g = globalThis as any;
    const tris = model ? Math.floor(model.count / 3) : 0;
    const faces = authoredFaces ?? tris;
    const bridge: ModelFocusBridge = {
      uv: uvPanel,
      paintLive: paintMode,
      readUvHistory: () => ({ uv: readMeshHistory(), paint: readPaintHistory() }),
      refreshUv: buildUvPanel,
      applyUvLayout,
      applyUvGeometry,
      restoreUvShapes,
      autoUvSize,
      projectUvFromView,
      undoUvHistory: () => stepUvHistory(false),
      redoUvHistory: () => stepUvHistory(true),
      selectUvIsland,
      selectUvIslands,
      selectUvFace,
      selectUvOrientation,
      saveUvAtlas,
      exportUvWireframe,
      importUvAtlas,
      resizeUvAtlas,
      addUvTextureLayer,
      editUvTextureLayer,
      compileUvTextureLayers,
      reloadUvAtlas,
      resetUvLayout,
      loadPaintVariant,
      shape: model
        ? {
          verts: selInfo.verts,
          edges: selInfo.edges,
          faces,
          tris,
          uvd: atlasReadyRef.current ? faces : 0,
          mounts: 0,
          radius: model.radius,
          center: boundsCenter,
        }
        : null,
      camMarks: camMarks.map((mark, i) => ({ name: mark.name, active: i === camMark })),
      // Route through the api ref so the bridge's verbs always close over fresh state,
      // exactly like the shell's tool dispatch.
      camStore: () => toolApiRef.current?.camStore(),
      camRecallAt: (index) => toolApiRef.current?.camRecallAt(index),
      camRemoveAt: (index) => toolApiRef.current?.camRemoveAt(index),
    };
    g.__modelFocusBridge = bridge;
    g.__modelFocusBridgeChanged?.();
  }, [uvPanel, paintMode, model, selInfo.verts, selInfo.edges, authoredFaces, boundsCenter, camMarks, camMark]);

  // Viewport hotkeys. In the editor embed (hostChrome) the shell's central keymap owns every tool
  // key (W/P/F/G/S/R/1/2/3 and the topology/face/paint keys the shell adds), dispatching them
  // through runCommand → this same tool api — so binding them here too would double-fire and cancel
  // the toggles. Standalone (no shell) keeps the full local map. Delete/Backspace/Escape are
  // viewport-native (not registry commands) and stay bound in both modes. They only fire when no
  // text field is focused (the engine routes the key to inputs first), so they never fight editing.
  useModifiers({
    ...(hostChrome ? {} : {
      w: () => setWire((v) => !v), W: () => setWire((v) => !v),
      p: togglePaint, P: togglePaint,
      f: toggleFocus, F: toggleFocus,
      g: () => chooseGizmoTool(0), G: () => chooseGizmoTool(0),
      s: () => chooseGizmoTool(1), S: () => chooseGizmoTool(1),
      r: () => chooseGizmoTool(2), R: () => chooseGizmoTool(2),
      '1': () => chooseSelMode(1), '2': () => chooseSelMode(2), '3': () => chooseSelMode(3),
    }),
    // Delete is inert while a blocking session is unresolved (req_2626 HH) — deleting
    // faces over a loop-cut's captured base mesh is exactly the stacked-state bug.
    delete: () => { if (blocking) return; if (selMode !== 0) applyTopo(meshDeleteSelection(), 'Nothing selected to delete'); },
    backspace: () => { if (blocking) return; if (selMode !== 0) applyTopo(meshDeleteSelection(), 'Nothing selected to delete'); },
    // NOTE: the key name is LOWERCASE 'escape' — the active key bridge (useIFTTT's)
    // emits lowercase names, so the old 'Escape' binding never fired (dead Esc was
    // part of the req_2620 undo-path break; same normalization story as keymap.ts).
    escape: () => {
      if (bv) { closeBevel(false); return; } // restore the captured pre-bevel mesh + selection
      if (lc) { closeLoopCut(false); return; } // an open loop-cut popup cancels first
      if (quadify) { closeQuadify(false); return; } // discard the dry run and restore grouping
      if (atlasPrompt) { setAtlasPrompt(false); return; } // the atlas gate cancels next
      if (selMode !== 0) { meshClearSel(); adoptHostSelection(selInfo); }
    },
  });

  // A fresh model NEVER inherits paint state: paint mode drops (the live atlas belonged
  // to the PREVIOUS mesh — painting straight onto a new one is how the oversized-atlas
  // crash was triggered) and the old preview disappears. The model-key effect above
  // then hydrates THIS document's persisted atlas, if it has one.
  const freshModelPaintReset = () => {
    setPaintMode(false);
    setAtlasPrompt(false);
    setUvPanel(null);
    atlasReadyRef.current = false;
    atlasInvalidatedRef.current = false;
    setBv(null); // the host drops a live bevel session with the old mesh's journal
    setLc(null); // the host drops a live loop-cut session with the old mesh's journal
    setQuadify(null); // the host drops a whole-topology dry run with the old mesh
  };

  // One load path for every source (picker, drop, CLI): validate the extension, hand
  // the path to the host parser, and surface a clean error if it can't be read.
  const applyPath = (path: string) => {
    // .gltf is intentionally NOT accepted: it's JSON with an external .bin, while the
    // host parser reads the self-contained binary .glb container.
    const ext = path.toLowerCase();
    if (!(ext.endsWith('.glb') || ext.endsWith('.obj'))) {
      setError('Unsupported file — pick a .glb or .obj');
      return;
    }
    const loaded = loadModelFile(path);
    if (loaded) {
      setModel(loaded);
      setError(null);
      setQuality(1); // a fresh model loads full-res
      setSelInfo({ mode: selMode, verts: 0, edges: 0, sel: 0 }); // new mesh → selection cleared
      freshModelPaintReset();
      // Standalone/session-only loads have nowhere durable to put a variant, but
      // the native importer still installed an honest live atlas.
      if (loaded.texture) atlasReadyRef.current = true;
      setAuthoredFaces(null); // a raw import carries no authored n-gon grouping
      setBoundsCenter(null); // the file's vertices never cross the bridge — no cart-side center
      partRangesRef.current = []; // a plain file import is one unstructured mesh, no parts
      recordAttribution(path); // account for where this asset came from
    } else {
      setError(`Could not load ${path.split('/').pop()}`);
    }
  };

  const applyMesh = (mesh: ModelViewInitialMesh) => {
    const loaded = loadModelVertices(mesh);
    if (loaded) {
      setError(null);
      setQuality(1);
      setSelInfo({ mode: selMode, verts: 0, edges: 0, sel: 0 });
      freshModelPaintReset();
      // Distinct authored-face ids (a studio cube: 6 quads over 12 triangles) — what the
      // atlas prompt reads to the user as "faces".
      setAuthoredFaces(mesh.faceGroups && mesh.faceGroups.length > 0 ? new Set(mesh.faceGroups).size : null);
      setBoundsCenter(meshBoundsCenter(mesh)); // vertices are cart-side here — real center, one pass
      // Seed the weld's part ranges from the composed parts (partColors carries every
      // part's [lo,hi)) so stacked parts stay independently editable from the first frame.
      partRangesRef.current = (mesh.partColors ?? []).map((pc) => ({ lo: pc.lo, hi: pc.hi }));
      meshSetPartRanges(partRangesRef.current);
      let current = loaded;
      for (const range of mesh.hiddenRanges ?? []) {
        const result = meshSetGroupHidden(range.lo, range.hi, true, false);
        if (result?.ok && typeof result.key === 'string' && typeof result.count === 'number') {
          current = { ...current, key: result.key, count: result.count };
        } else {
          console.error(`[model-parts] could not restore saved hidden range [${range.lo},${range.hi})`);
        }
      }
      setModel(current);
    } else {
      setError(`Could not load ${mesh.name}`);
    }
  };

  /** Persist the pristine embedded texture without disturbing an established
   * package look. A brand-new import adopts it as both base + variant; an older
   * package gets the original variant while its saved base/latest look remains
   * the one hydrated for display. */
  const registerImportedTextureLook = (
    sourcePath: string,
    hasAppendedParts: boolean,
    loaded: Loaded,
    options: { allowBaseAdoption?: boolean } = {},
  ): boolean => {
    const texture = loaded.texture;
    if (!texture) return false;
    if (hasAppendedParts) {
      // A base-only UV table cannot be advertised against a composed topology.
      // The source image remains visible on its base rows until the explicit
      // structural-atlas gate asks the user to remake the combined layout.
      return false;
    }
    if (!paintTarget || !paintTargetOnDisk) return true;

    const variantsBefore = listPaintVariants(paintTarget);
    const storedPaintBefore = hasStoredModelPaint(paintTarget);
    const sourceIdentity = fileSha(sourcePath) || sourcePath;
    const captured = ensureImportedTexturePaintVariant(paintTarget, {
      kind: 'model-import',
      fingerprint: `${sourceIdentity}:${texture.imageIndex}`,
      imageIndex: texture.imageIndex,
      uvMappingVersion: IMPORTED_TEXTURE_UV_MAPPING_VERSION,
    });
    if (!captured.variant) {
      console.error(`[paint-import] ${loaded.name}: embedded texture is live but its paint variant could not be written`);
      return !storedPaintBefore && variantsBefore.length === 0;
    }
    if (captured.created) {
      console.warn(
        `[paint-import] ${loaded.name}: ${texture.width}×${texture.height} embedded texture saved as ${captured.variant.name}`,
      );
    } else if (captured.upgraded) {
      console.warn(
        `[paint-import] ${loaded.name}: refreshed ${captured.variant.name} with the corrected source UV mapping`,
      );
    }

    if (options.allowBaseAdoption === false) return false;
    if (!storedPaintBefore && variantsBefore.length === 0) {
      // First import: this source look is also the model's current/base look.
      writeModelArtifacts(paintTarget);
      return true;
    }
    if (!storedPaintBefore && variantsBefore.length > 0) {
      // Legacy package with variants but no base record: adding the pristine
      // source variant must not make it the new implicit "latest" look.
      const priorLatest = variantsBefore[variantsBefore.length - 1]!;
      return loadPaintVariant(priorLatest);
    }
    // The model-key effect will hydrate the already-authored base after mount.
    return false;
  };

  /** A saved meshdoc wins over its source file, but a still-provenance-bearing
   * v1 Imported Texture row needs one last source-resident capture. Load the
   * source only long enough to refresh that generated variant; applyMesh runs
   * immediately afterward and restores the saved geometry/base as document
   * truth. Current provenance skips both parsing and native state churn. */
  const refreshLegacyImportedTextureLook = (sourcePath: string) => {
    if (!paintTarget || !paintTargetOnDisk) return;
    const sourceIdentity = fileSha(sourcePath) || sourcePath;
    if (!importedTextureVariantNeedsUvUpgrade(paintTarget, sourceIdentity)) return;
    const loaded = loadModelFile(sourcePath);
    if (!loaded?.texture) {
      console.error(`[paint-import] could not refresh legacy source UVs from ${sourcePath}`);
      return;
    }
    registerImportedTextureLook(sourcePath, false, loaded, { allowBaseAdoption: false });
  };

  // Mount a FILE-BACKED multi-part model: host-parse the imported file as the base part,
  // preserve its recovered authored-face groups + give it a part range over the whole import (so the outliner
  // can scope/hide/delete it and the weld keeps it separate), then replay the doc's other
  // parts as appends. Reports every part's landed range up so the shell stamps its outliner.
  const applyFileParts = (spec: ModelViewFileParts) => {
    const loaded = loadModelFile(spec.path);
    if (!loaded) {
      setError(`Could not load ${spec.path.split('/').pop()}`);
      return;
    }
    const faces = loaded.faces && loaded.faces > 0 ? loaded.faces : Math.floor(loaded.count / 3);
    // The outliner swatch is the fallback for an untextured file. Flooding a
    // compatible embedded atlas here was the old seam that erased it immediately.
    if (!loaded.texture) {
      const [br, bg, bb] = hexToRgb01(spec.baseColor);
      host.__model_paint_group_range?.(0, faces, Math.round(br * 255), Math.round(bg * 255), Math.round(bb * 255));
    }
    const ranges: PartRange[] = [{ partId: spec.basePartId, lo: 0, hi: faces }];
    partRangesRef.current = [{ lo: 0, hi: faces }];
    // Establish the base ownership boundary before replaying appended parts;
    // each append now proves the resident host partition before it mutates.
    meshSetPartRanges(partRangesRef.current);
    let current = loaded;
    for (const ap of spec.appends) {
      const r = meshAppendGroup(ap.positions, ap.faceGroups, ranges.length);
      if (!r?.ok || r.lo == null || r.hi == null) continue;
      const [ar, ag, ab] = hexToRgb01(ap.color);
      host.__model_paint_group_range?.(r.lo, r.hi, Math.round(ar * 255), Math.round(ag * 255), Math.round(ab * 255));
      ranges.push({ partId: ap.partId, lo: r.lo, hi: r.hi });
      partRangesRef.current = [...partRangesRef.current, { lo: r.lo, hi: r.hi }];
      if (typeof r.key === 'string' && typeof r.count === 'number') current = { ...current, key: r.key, count: r.count };
    }
    meshSetPartRanges(partRangesRef.current);
    if (spec.baseHidden) meshSetGroupHidden(0, faces, true, false);
    freshModelPaintReset();
    if (registerImportedTextureLook(spec.path, spec.appends.length > 0, loaded)) {
      atlasReadyRef.current = true;
      atlasInvalidatedRef.current = false;
    }
    setModel(current);
    setError(null);
    setQuality(1);
    setSelInfo({ mode: selMode, verts: 0, edges: 0, sel: 0 });
    setAuthoredFaces(faces);
    setBoundsCenter(null); // the base import's vertices are host-side only
    onPartRanges?.(ranges);
  };

  // Open the native OS file picker (zenity, via the shared runtime pickFile). Async —
  // the dialog runs in a subprocess and resolves with the chosen path, or null on
  // cancel. This is the primary way in; drag-drop below is a bonus.
  const chooseModel = async () => {
    const path = await pickFile({
      title: 'Open a 3D model',
      filters: [
        { name: '3D models', patterns: ['*.glb', '*.obj'] },
        { name: 'All files', patterns: ['*'] },
      ],
    });
    if (path) applyPath(path);
  };

  // Open-from-CLI: `RJIT_MODEL=path/to/file.glb ./zig-out/bin/modelview` loads a model
  // at boot (no picker needed). Also the headless self-shot path —
  // `RJIT_MODEL=... ./tools/rjit shot modelview` renders the loaded model.
  useEffect(() => {
    // Hand the model-editor input loop to the host (native orbit/select/marquee/zoom/focus).
    meshCapture(true);
    // The host calls this once per committed selection change (a click or a marquee release,
    // NOT per drag-move) so the count HUD refreshes without any JS in the interaction loop.
    (globalThis as any).__meshEditSelChanged = () => {
      adoptHostSelection();
      syncUvSelection();
    };
    (globalThis as any).__meshEditGuardChanged = () => setGuard(readGuard());
    // Hot-reload resume (req_2898): if the host is STILL holding this document's live
    // mesh from before the reload (doc twig matches AND the host session key matches),
    // adopt it — edits, undo journal, selection, paint atlas, and camera all survive.
    // Any mismatch (other doc, cold boot, saved-and-rekeyed) falls through to a normal
    // load, exactly as before.
    const resumeHostSession = (): boolean => {
      if (!hotDocId) return false;
      const twig = getHotState<DocTwig | null>(DOC_TWIG_KEY, null);
      if (!twig || twig.docId !== hotDocId) return false;
      const session = readModelSession();
      if (!session || session.key !== twig.key) return false;
      setModel({ key: session.key, count: session.count, radius: session.radius, name: initialTitle ?? initialMesh?.name ?? 'model' });
      setError(null);
      atlasInvalidatedRef.current = session.paintStale === true;
      atlasReadyRef.current = session.atlas && !atlasInvalidatedRef.current;
      // Part ranges + selection are host truth — mirror them instead of re-seeding.
      resyncPartRanges();
      // Resume HEAL (req_3058): the host process outlives window "restarts", so a
      // session whose range truth was cleared once resumes DEGRADED forever — the
      // mirror inherits nothing, no load path ever re-pushes, and every save writes
      // a doc that reopens with merged parts. The doc's saved ranges are recovery
      // truth: when the resumed host answers with fewer parts than the doc declares,
      // re-seed the doc's ranges instead of mirroring the damage forward.
      const docRanges = (initialMesh?.partColors ?? []).map((pc) => ({ lo: pc.lo, hi: pc.hi }));
      if (docRanges.length > partRangesRef.current.length) {
        console.error(`[rangetrace] resumed host session carries ${partRangesRef.current.length} part range(s) but the doc declares ${docRanges.length} — re-seeding the doc's ranges (req_3058)`);
        partRangesRef.current = docRanges;
        meshSetPartRanges(docRanges);
      }
      const sel = adoptHostSelection();
      if (initialMesh?.faceGroups && initialMesh.faceGroups.length > 0) setAuthoredFaces(new Set(initialMesh.faceGroups).size);
      // A loop-cut POPUP can't survive the reload (its JS state died with the old
      // world), so a still-armed host lc session is an orphan — cancel it rather
      // than leave the input loop half-captured by a dialog that no longer exists.
      try {
        const lcj = host.__mesh_lc_state?.();
        if (typeof lcj === 'string' && lcj && JSON.parse(lcj)?.ok === 1) host.__mesh_lc_end?.(0);
      } catch { /* no lc door / malformed state — nothing to cancel */ }
      // Same orphan rule for the whole-topology dry run: its popup state lived in
      // the old JS world, so the retained host base must be restored immediately.
      host.__mesh_quadify_end?.(0);
      // The host atlas is document state, not Paint-tool state. A remount must
      // publish its UV preview even when the brush was inactive; otherwise the
      // model renders the retained texture while the inspector falsely says none.
      const paintResume = residentPaintResumeAction({
        atlasReady: session.atlas,
        atlasStale: atlasInvalidatedRef.current,
        paintToolActive: toolTwig?.paint === true,
      });
      if (paintResume === 'paint') enterPaint();
      else if (paintResume === 'preview') buildUvPanel();
      console.warn(`[modelview] resumed live host session for ${hotDocId} (${session.undo} undo · atlas ${session.atlas ? 'live' : 'none'} · mode ${sel.mode} · ${sel.sel} selected)`);
      return true;
    };
    if (initialFileParts) {
      if (!resumeHostSession()) applyFileParts(initialFileParts);
    } else if (initialMesh) {
      if (!resumeHostSession()) {
        if (importedTextureSourcePath) refreshLegacyImportedTextureLook(importedTextureSourcePath);
        applyMesh(initialMesh);
      }
    } else {
      const path = initialPath ?? callHost<string | null>('__env_get', null, 'RJIT_MODEL');
      if (path && !resumeHostSession()) applyPath(path);
    }
    // Persist the topology/atlas contract across a full process restart. The old
    // paint assets stay recoverable, but neither UI nor host may apply them until
    // Remake Paint Atlas establishes a new layout for this document revision.
    if (paintTarget && modelPaintLayoutIsStale(paintTarget)) {
      host.__model_paint_layout_invalidate?.();
      atlasReadyRef.current = false;
      atlasInvalidatedRef.current = true;
      setPaintMode(false);
    }
    // Re-push the twig-seeded gizmo tool so the host matches the restored UI even
    // when the host session did NOT survive (cold start with a warm twig).
    meshGizmoTool(gizmoTool);
    // RJIT_WIRE=1 boots in wireframe mode — the headless self-shot path for it.
    if (callHost<string | null>('__env_get', null, 'RJIT_WIRE')) setWire(true);
    // RJIT_GIZMO=move|scale|rotate (or 0|1|2) selects the transform sub-tool at boot.
    const gt = callHost<string | null>('__env_get', null, 'RJIT_GIZMO');
    if (gt) {
      const t = gt === 'scale' ? 1 : gt === 'rotate' ? 2 : Number(gt) || 0;
      chooseGizmoTool(Math.max(0, Math.min(2, t)));
    }
    // RJIT_ZOOM=N dollies the camera in N notches at boot — the headless way to prove
    // the wireframe stays locked to the surface when you get in close.
    const zoom = Number(callHost<string | null>('__env_get', null, 'RJIT_ZOOM') ?? 0);
    for (let i = 0; i < zoom; i += 1) orbitZoom(1);
    // RJIT_PAINT=1 paints every face by index in a rainbow — the headless proof that
    // painting is per-face and independent (no congruent-face fusion). Each face shows
    // its OWN colour, which is exactly the bug the old UV-atlas dedup couldn't avoid.
    if (callHost<string | null>('__env_get', null, 'RJIT_PAINT')) {
      setPaintMode(true);
      const proof: RGB[] = [[222, 70, 64], [238, 142, 48], [240, 206, 74], [112, 196, 96], [66, 158, 226], [126, 112, 222], [226, 120, 196], [244, 244, 248]];
      const n = Number(host.__model_face_count?.() ?? 0);
      for (let f = 0; f < n; f += 1) {
        const c = proof[f % proof.length]!;
        host.__model_paint_face?.(f, c[0], c[1], c[2]);
      }
    }
    // RJIT_PAINTONE=1 paints exactly ONE face bright red — the proof that a single-face
    // change shows immediately (the content-hash texture cache used to drop it).
    if (callHost<string | null>('__env_get', null, 'RJIT_PAINTONE')) {
      setPaintMode(true);
      host.__model_paint_face?.(40, 230, 40, 40);
    }
    // RJIT_ATTRIB_EXPORT=1 writes CREDITS.md from the current ledger at boot — the
    // headless proof the credits export works (and reports pending obligations).
    if (callHost<string | null>('__env_get', null, 'RJIT_ATTRIB_EXPORT')) doExportCredits();
    // RJIT_QUALITY=grid re-decimates at boot — the headless proof the quality knob works.
    const q = Number(callHost<string | null>('__env_get', null, 'RJIT_QUALITY') ?? 0);
    if (q > 0) {
      const r = setModelQuality(q);
      if (r) setModel((m) => (m ? { ...m, key: r.key, count: r.count } : m));
    }
    // RJIT_QUALITYSTRESS=1 scrubs 30 distinct quality levels (>16 stash slots) then
    // settles — proof the stash no longer overflows and the model still draws (req_2137).
    if (callHost<string | null>('__env_get', null, 'RJIT_QUALITYSTRESS')) {
      let last: { key: string; count: number } | null = null;
      for (let g = 10; g < 40; g += 1) last = setModelQuality(g) ?? last;
      if (last) setModel((m) => (m ? { ...m, key: last!.key, count: last!.count } : m));
    }
    // RJIT_SELECTFACE=N selects face N (face mode) at boot — the headless proof that
    // selection HIGHLIGHTS show. Index select needs no camera, so it works pre-render.
    const sf = callHost<string | null>('__env_get', null, 'RJIT_SELECTFACE');
    if (sf != null) {
      host.__mesh_edit_select_face?.(Number(sf) || 0, 0);
      setSelMode(3);
      setSelInfo(readSelInfo() ?? { mode: 3, verts: 0, edges: 0, sel: 1 });
    }
    // RJIT_SELECTEDGE=N or RJIT_SELECTEDGES=A,B selects welded edges by index for
    // deterministic topology screenshots; RJIT_EDGEOP=extrude|face|loopcut then runs the op.
    const edgeText = callHost<string | null>('__env_get', null, 'RJIT_SELECTEDGES')
      ?? callHost<string | null>('__env_get', null, 'RJIT_SELECTEDGE');
    if (edgeText != null) {
      edgeText.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)).forEach((idx, i) => {
        meshSelectEdge(idx, i > 0);
      });
      setSelMode(2);
      setSelInfo(readSelInfo() ?? { mode: 2, verts: 0, edges: 0, sel: 1 });
    }
    const edgeOp = callHost<string | null>('__env_get', null, 'RJIT_EDGEOP');
    if (edgeOp) {
      const r = edgeOp === 'face' ? meshCreateFace() : edgeOp === 'loopcut' ? meshLoopCut() : meshExtrudeEdge(0);
      if (r?.ok && r.key && typeof r.count === 'number') {
        setModel((m) => (m ? { ...m, key: r.key!, count: r.count! } : m));
        const fallbackMode = edgeOp === 'face' ? 3 : 2;
        adoptHostSelection({ mode: fallbackMode, verts: 0, edges: 0, sel: edgeOp === 'face' ? 1 : 0 });
      }
    }
    // RJIT_NUDGE=x,0.25 (or y/z) translates the active selection headlessly after
    // index-based selection. It proves host-native geometry mutation without a mouse drag.
    const nudge = callHost<string | null>('__env_get', null, 'RJIT_NUDGE');
    if (nudge) {
      const [axisName, amountText] = nudge.split(',');
      const axis = axisName === 'y' ? 1 : axisName === 'z' ? 2 : 0;
      host.__mesh_gizmo_nudge?.(axis, Number(amountText) || 0);
      setSelInfo(readSelInfo() ?? { mode: 3, verts: 0, edges: 0, sel: 1 });
    }
    // RJIT_MESHMODE=1|2|3 enters vertex/edge/face mode at boot — the headless proof that
    // the vertex dots / edge highlights / overlay draw (vertex mode shows every vert).
    const mm = Number(callHost<string | null>('__env_get', null, 'RJIT_MESHMODE') ?? 0);
    if (mm >= 1 && mm <= 3) chooseSelMode(mm);
    // RJIT_MESHOPS: a ';'-separated gesture script run against the live host doors — the
    // headless repro harness for selection/tint bugs (req_2613). Each op waits a few
    // frames so camera-dependent doors (pick/box) act on a drawn viewport. Ops:
    //   mode:N sel:N vertex:N edge:N add:N range:lo,hi pick:x,y pickadd:x,y box:x0,y0,x1,y1 snap revert
    //   clear scope:lo,hi nudge:axis,amt scaleby:factor gizmo:N undo redo del flip glass spiketrace:0|1
    //   grouppaint:lo,hi,r,g,b
    //   detail:px wait:frames report atlas:/path.png parts historylog duprange:lo,hi dupalias:lo,hi addpart:kind orbit:dx,dy
    //   lcbegin lcprev:dir,cuts,off lcend:0|1 lcstate  (loop-cut session; off = 0..1 frac)
    //   paintend paintundo paintredo painthist layers layerop:op,id[,arg] progread
    //   progapply  (stroke journal + paint layers, req_2672)
    //   patharc:lo,hi,axis,bays,turnDeg,riseModel
    //   patharcmulti:axis,bays,turnDeg,riseModel,lo,hi[,lo,hi…]
    //   pathpoints:lo,hi,axis,x,y,z,... solidify merge trisquads extrudeface:distance extrudeedge:distance
    //   detach contract:/absolute/output-prefix (port-parity fixture dump)
    // `RJIT_MESHOPS=@/path/ops.txt` reads the script from a FILE — re-read on every
    // eval, so a reload-torture run (req_2914) can rewrite the file between reloads
    // and script a DIFFERENT phase per remount (env vars are fixed for the process).
    const opsEnv = callHost<string | null>('__env_get', null, 'RJIT_MESHOPS');
    const opsText = opsEnv?.startsWith('@')
      ? callHost<string | null>('__fs_read', null, opsEnv.slice(1))
      : opsEnv;
    if (opsText) {
      const num = (s: string | undefined) => Number(s ?? 0) || 0;
      // progread stashes the serialized stroke program here; progapply replays it —
      // the in-session round-trip proof for the layer-carrying blob (req_2672).
      const progRef = { current: null as string | null };
      const dumpAtlasPng = (path: string) => {
        const j = host.__model_atlas_read?.();
        if (typeof j !== 'string' || !j) { console.error('[meshops] atlas: no atlas'); return; }
        try {
          const o = JSON.parse(j) as { w: number; h: number; data: string };
          const rgba = bytesFromB64(o.data);
          const png = rgba ? host.__imageops_encode_raw?.(rgba, o.w, o.h, '{"format":"png"}') : null;
          if (png instanceof Uint8Array && host.__imageops_write_file?.(path, png) === true) {
            console.error(`[meshops] atlas → ${path} (${o.w}x${o.h})`);
          } else console.error('[meshops] atlas: decode/encode/write failed');
        } catch (e) { console.error(`[meshops] atlas threw: ${e}`); }
      };
      const runOp = (op: string) => {
        const sepIdx = op.indexOf(':');
        const name = sepIdx < 0 ? op : op.slice(0, sepIdx);
        const a = (sepIdx < 0 ? '' : op.slice(sepIdx + 1)).split(',').map((s) => s.trim());
        if (name === 'mode') chooseSelMode(num(a[0]));
        else if (name === 'sel') host.__mesh_edit_select_face?.(num(a[0]), 0);
        else if (name === 'vertex') host.__mesh_edit_select_vertex?.(num(a[0]), 0);
        else if (name === 'edge') host.__mesh_edit_select_edge?.(num(a[0]), 0);
        else if (name === 'add') host.__mesh_edit_select_face?.(num(a[0]), 1);
        else if (name === 'range') host.__mesh_edit_select_group_range?.(num(a[0]), num(a[1]), 0);
        else if (name === 'pick') host.__mesh_edit_pick?.(num(a[0]), num(a[1]), 0);
        else if (name === 'pickadd') host.__mesh_edit_pick?.(num(a[0]), num(a[1]), 1);
        else if (name === 'box') host.__mesh_edit_box?.(num(a[0]), num(a[1]), num(a[2]), num(a[3]), 0);
        else if (name === 'snap') host.__mesh_edit_snapshot?.();
        else if (name === 'revert') host.__mesh_edit_revert?.();
        else if (name === 'clear') meshClearSel();
        else if (name === 'scope') host.__mesh_edit_scope?.(num(a[0]), num(a[1]));
        else if (name === 'nudge') host.__mesh_gizmo_nudge?.(a[0] === 'y' ? 1 : a[0] === 'z' ? 2 : 0, Number(a[1]) || 0);
        else if (name === 'scaleby') console.error(`[meshops] scaleby:${a[0]} → ${meshScaleBy(Number(a[0]))}`);
        else if (name === 'mirror') { const m = num(a[0]); setMirrorMask(m); meshSetMirror(m); } // mirror:mask (bit 0/1/2 = X/Y/Z) — pushed immediately so a same-tick nudge reflects
        else if (name === 'gizmo') chooseGizmoTool(num(a[0]));
        // undo/redo adopt like the app's undo (the door returns a NEW mesh key) and LOG the
        // door result + __mesh_history depths — the headless proof the journal moved.
        else if (name === 'undo') { const r = meshUndoDoor(); adoptMesh(r); console.error(`[meshops] undo → ${JSON.stringify(r)} history=${host.__mesh_history?.() ?? 'n/a'}`); }
        else if (name === 'redo') { const r = meshRedoDoor(); adoptMesh(r); console.error(`[meshops] redo → ${JSON.stringify(r)} history=${host.__mesh_history?.() ?? 'n/a'}`); }
        else if (name === 'history') console.error(`[meshops] history → ${host.__mesh_history?.() ?? 'n/a'}`);
        else if (name === 'historylog') console.error(`[meshops] historylog → ${host.__mesh_history_log?.() ?? 'n/a'}`);
        // key:z / key:ctrl,z — synthesize a REAL SDL key edge through the live bridge
        // (__ifttt_onKeyDown, the exact global engine.zig pumps). This drives the FULL
        // keyboard path headlessly: bridge → __keydown bus → AppFrame's normalized
        // subscription → keymap chord → runCommand → host door. The repro that proved
        // Ctrl+Z dead and the fix live (req_2620 gap W).
        else if (name === 'key') {
          const parts = a.filter(Boolean);
          const { sym, mod } = syntheticKeyEdge(parts);
          console.error(`[meshops] key ${parts.join('+')} → sym=${sym} mod=${mod} history=${host.__mesh_history?.() ?? 'n/a'}`);
        }
        // Loop-cut session ops (req_2625 DD / req_2627): drive the host lc doors headlessly
        // so a shot proves the cyan cut accents + plane handle with the popup tracking.
        // lcbegin mirrors openLoopCut (session on the current face selection, even 1-cut
        // preview); lcprev re-previews at (dir, cuts, offset-frac 0..1) and mirrors the frac
        // into the popup as its percent; lcend:0|1 cancels/commits. State goes through
        // setLc's FUNCTIONAL form — this harness closure is mount-frozen, so the `lc`
        // snapshot inside changeLoopCut/closeLoopCut is stale (null) here.
        else if (name === 'lcbegin') {
          const basic = num(a[0]) !== 0;
          const info = meshLcBegin(basic);
          if (info?.ok) {
            const preview = meshLcPreview(0, 1, 0.5);
            setLc({ basic, dir: 0, cuts: 1, offset: 50, unit: 'units', sizes: [info.size0 ?? 0, info.size1 ?? 0], fallbackReason: preview?.fallbackReason ?? null });
            adoptMesh(preview);
          }
          console.error(`[meshops] lcbegin → ${JSON.stringify(info)}`);
        }
        else if (name === 'lcprev') {
          const dir = (num(a[0]) >= 1 ? 1 : 0) as 0 | 1;
          const cuts = Math.max(1, Math.min(64, num(a[1])));
          const off = Math.max(0, Math.min(1, num(a[2])));
          const preview = meshLcPreview(dir, cuts, off);
          adoptMesh(preview);
          setLc((prev) => (prev ? { ...prev, dir, cuts, offset: Math.round(off * 10000) / 100, fallbackReason: preview?.fallbackReason ?? null } : prev));
        }
        else if (name === 'lcend') { adoptMesh(meshLcEnd(num(a[0]) === 1)); setLc(null); }
        // lcstate: log the raw __mesh_lc_state JSON — the headless proof the read-back
        // door echoes the session's last-previewed dir/cuts/offsetFrac + live key.
        else if (name === 'lcstate') console.error(`[meshops] lcstate → ${host.__mesh_lc_state?.() ?? 'n/a'}`);
        // Native-op parity harness doors. These deliberately stay in the existing
        // headless replay language: the UI continues to own the normal buttons,
        // while a fixture can drive the identical resident operation and capture its
        // observable mesh document + journal topology without a screenshot.
        else if (name === 'solidify') { const r = meshSolidify(); adoptMesh(r); console.error(`[meshops] solidify → ${JSON.stringify(r)}`); }
        else if (name === 'merge') { const r = meshMergeFaces(); adoptMesh(r); console.error(`[meshops] merge → ${JSON.stringify(r)}`); }
        else if (name === 'trisquads') { const r = meshTrisToQuads(); adoptMesh(r); console.error(`[meshops] trisquads → ${JSON.stringify(r)}`); }
        else if (name === 'quadbegin') console.error(`[meshops] quadbegin → ${JSON.stringify(meshQuadifyBegin())}`);
        else if (name === 'quadpreview') {
          const r = meshQuadifyPreview(num(a[0]));
          adoptMesh(r);
          console.error(`[meshops] quadpreview:${a[0]} → ${JSON.stringify(r)}`);
        }
        else if (name === 'quadend') {
          const r = meshQuadifyEnd(num(a[0]) === 1);
          adoptMesh(r);
          console.error(`[meshops] quadend:${a[0]} → ${JSON.stringify(r)}`);
        }
        else if (name === 'extrudeface') { const r = meshExtrudeFace(Number(a[0]) || 0); adoptMesh(r); console.error(`[meshops] extrudeface:${a[0]} → ${JSON.stringify(r)}`); }
        else if (name === 'extrudeedge') { const r = meshExtrudeEdge(Number(a[0]) || 0); adoptMesh(r); console.error(`[meshops] extrudeedge:${a[0]} → ${JSON.stringify(r)}`); }
        else if (name === 'detach') { const r = meshDetach(); adoptMesh(r); console.error(`[meshops] detach → ${JSON.stringify(r)}`); }
        else if (name === 'contract') {
          const prefix = a.join(',');
          const mesh = prefix ? host.__model_meshdoc_write?.(`${prefix}.rjmd`) : 0;
          const journal = prefix ? host.__fs_write?.(`${prefix}.json`, host.__mesh_history_log?.() ?? '') : false;
          console.error(`[meshops] contract → mesh=${mesh} journal=${journal} prefix=${prefix}`);
        }
        else if (name === 'del') adoptMesh(meshDeleteSelection());
        else if (name === 'flip') { const r = meshFlipFaces(); adoptMesh(r); console.error(`[meshops] flip → ${JSON.stringify(r)}`); }
        // glass — toggle the selected faces as glass through the real door (req_2928's
        // headless repro: glass must survive atlas creation/re-island/painting; the
        // atlas:<path> dump's ALPHA channel is the assertion).
        else if (name === 'glass') { const r = meshGlass(); adoptMesh(r); console.error(`[meshops] glass → ${JSON.stringify(r)}`); }
        else if (name === 'spiketrace') host.__hmsc_spike_trace?.(num(a[0]) === 1 ? 1 : 0);
        else if (name === 'grouppaint') host.__model_paint_group_range?.(num(a[0]), num(a[1]), num(a[2]), num(a[3]), num(a[4]));
        else if (name === 'patharc') {
          const pairs = new Uint32Array([num(a[0]), num(a[1])]);
          const r = readTopoResult(host.__mesh_path_array?.(pairs, num(a[2]), num(a[3]), Number(a[4]) || 0, Number(a[5]) || 0, 1));
          adoptMesh(r);
          console.error(`[meshops] patharc → ${JSON.stringify(r)} spans=${host.__mesh_path_array_spans?.(pairs) ?? 'n/a'}`);
        }
        else if (name === 'patharcmulti') {
          const pairs = new Uint32Array(a.slice(4).map((value) => num(value)));
          const r = readTopoResult(host.__mesh_path_array?.(pairs, num(a[0]), num(a[1]), Number(a[2]) || 0, Number(a[3]) || 0, 1));
          adoptMesh(r);
          console.error(`[meshops] patharcmulti → ${JSON.stringify(r)}`);
        }
        else if (name === 'pathpoints') {
          const pairs = new Uint32Array([num(a[0]), num(a[1])]);
          const coords = new Float32Array(a.slice(3).map((value) => Number(value) || 0));
          const r = readTopoResult(host.__mesh_path_array_points?.(pairs, num(a[2]), coords));
          adoptMesh(r);
          console.error(`[meshops] pathpoints → ${JSON.stringify(r)}`);
        }
        else if (name === 'detail') applyPaintDetail(num(a[0]));
        // hidepart:lo,hi / showpart:lo,hi — the outliner eye, headless (req_2660 repro:
        // paint → hide → paint → show; the stroke made while hidden must SURVIVE).
        else if (name === 'hidepart' || name === 'showpart') {
          const r = toolApiRef.current?.setPartHidden(num(a[0]), num(a[1]), name === 'hidepart');
          console.error(`[meshops] ${name}:${a[0]},${a[1]} → ${JSON.stringify(r)}`);
        }
        // paint:1|0 — enter/leave paint mode DIRECTLY (bypasses the Create Paint Atlas
        // gate, which is interactive UI; the host atlas always exists). Flows through the
        // same paintMode state, so the __mesh_paint_session mirror + selection reset fire
        // exactly as the real toggle (req_2662's headless proof).
        else if (name === 'paint') { if (num(a[0]) === 1) { setSelMode(0); meshSetMode(0); setPaintMode(true); buildUvPanel(); } else setPaintMode(false); }
        // stamp:x,y,r,g,b,radius,flow — one free-form brush dab at viewport px (the
        // sub-face stroke the flat per-face carry could never preserve). Logs the hit
        // face (or -1) so a scripted stamp is verifiable.
        else if (name === 'stamp') {
          const hit = host.__model_paint_stamp?.(num(a[0]), num(a[1]), num(a[2]), num(a[3]), num(a[4]), Number(a[5]) || 4, Number(a[6]) || 1, num(a[7]), a[8] === undefined ? 1 : num(a[8]), num(a[9]), a[10] === undefined ? 1 : num(a[10]), num(a[11]));
          console.error(`[meshops] stamp @${a[0]},${a[1]} → face ${hit}`);
        }
        // ── Stroke journal + paint layers (req_2672) ────────────────────────────────
        // paintend commits the open stroke as ONE undo unit (the pointer-up twin);
        // paintundo/paintredo drive the STROKE journal (program replay, not the mesh
        // journal); painthist/layers log the door JSON; layerop:<op>,<id>[,<arg>] runs
        // one layer verb through the real door (add/delete/up/down/visible/active/
        // rename/mergedown) and logs the refreshed table.
        else if (name === 'paintend') console.error(`[meshops] paintend → ${host.__mesh_paint_stroke_end?.() ?? 'n/a'}`);
        else if (name === 'paintundo') console.error(`[meshops] paintundo → ${host.__mesh_paint_undo?.() ?? 'n/a'} hist=${host.__mesh_paint_history?.() ?? 'n/a'}`);
        else if (name === 'paintredo') console.error(`[meshops] paintredo → ${host.__mesh_paint_redo?.() ?? 'n/a'} hist=${host.__mesh_paint_history?.() ?? 'n/a'}`);
        else if (name === 'painthist') console.error(`[meshops] painthist → ${host.__mesh_paint_history?.() ?? 'n/a'}`);
        else if (name === 'layers') console.error(`[meshops] layers → ${host.__mesh_paint_layers?.() ?? 'n/a'}`);
        else if (name === 'layerop') {
          const argRaw = a.slice(2).join(','); // rename args may carry commas
          const arg: string | number = a[0] === 'rename' ? argRaw : num(a[2]);
          console.error(`[meshops] layerop:${a[0]},${a[1]} → ${host.__mesh_paint_layer_op?.(a[0] ?? '', num(a[1]), arg) ?? 'n/a'}`);
        }
        // progread/progapply — round-trip the serialized stroke program through the
        // real save/load doors (the persistence-coherence proof without disk state).
        // progsave:/path / progload:/path do the same THROUGH A FILE, so a second
        // process (RJIT restart) can prove layers survive a real reload.
        else if (name === 'progread') { progRef.current = host.__model_paint_program_read?.() || null; console.error(`[meshops] progread → ${progRef.current ? `${progRef.current.length} b64 chars` : 'EMPTY'}`); }
        else if (name === 'progapply') console.error(`[meshops] progapply → ${progRef.current ? host.__model_paint_program_apply?.(progRef.current) : 'no stored program'} layers=${host.__mesh_paint_layers?.() ?? 'n/a'}`);
        else if (name === 'progsave') {
          const prog = host.__model_paint_program_read?.() || '';
          const ok = prog ? host.__fs_write?.(a.join(','), prog) : false;
          console.error(`[meshops] progsave → ${prog ? `${prog.length} b64 chars` : 'EMPTY'} write=${ok}`);
        }
        else if (name === 'progload') {
          const prog = host.__fs_read?.(a.join(',')) || '';
          const ok = prog ? host.__model_paint_program_apply?.(prog) : 0;
          console.error(`[meshops] progload → apply=${ok} layers=${host.__mesh_paint_layers?.() ?? 'n/a'}`);
        }
        // rangeadd:lo,hi — ADDITIVE group-range select (the outliner's shift-click, host
        // side); scopes:lo,hi[,lo,hi…] — the multi-range union scope door (req_2659).
        else if (name === 'rangeadd') host.__mesh_edit_select_group_range?.(num(a[0]), num(a[1]), 1);
        else if (name === 'scopes') {
          const nums = a.map((s) => num(s)).filter((_, i, arr) => i < arr.length - (arr.length % 2));
          const ok = host.__mesh_edit_scope_ranges?.(new Uint32Array(nums));
          console.error(`[meshops] scopes [${nums.join(',')}] → ${ok}`);
        }
        else if (name === 'report') console.error(`[meshops] report → ${JSON.stringify(readSelInfo())}`);
        // parts: log the HOST's part-range truth + a partition audit — every triangle
        // must be owned by exactly one range (req_2644's contract, headlessly checkable).
        else if (name === 'parts') {
          const ranges = meshPartRangesRead();
          const total = Number(host.__model_face_count?.() ?? 0);
          let owned = 0;
          for (const pr of ranges ?? []) owned += Number(host.__mesh_group_face_count?.(pr.lo, pr.hi) ?? 0);
          console.error(`[meshops] parts → ${JSON.stringify(ranges)} ownedFaces=${owned} totalFaces=${total} partition=${ranges && owned === total ? 'OK' : 'BROKEN'}`);
        }
        // duprange:lo,hi — raw native duplicate boundary, useful for proving a stale
        // cart range is rejected instead of silently cloning a partial part.
        else if (name === 'duprange') {
          const r = meshDuplicateRange(num(a[0]), num(a[1]), -1);
          adoptMesh(r);
          console.error(`[meshops] duprange:${a[0]},${a[1]} → ${JSON.stringify(r)}`);
        }
        // dupalias uses the viewer boundary (the same one the outliner calls), so
        // a pre-renumber pair proves it resolves to the complete current part.
        else if (name === 'dupalias') {
          const r = toolApiRef.current?.duplicatePart(num(a[0]), num(a[1]), -1) ?? null;
          console.error(`[meshops] dupalias:${a[0]},${a[1]} → ${JSON.stringify(r)}`);
        }
        // addpart:<kind> — append a primitive as a NEW PART through the real appendPart
        // path (host append + range truth + tint), the headless twin of outliner Add.
        else if (name === 'addpart') {
          const kind = (a[0] || 'cube') as Parameters<typeof primitiveMeshData>[0];
          const geo = primitiveMeshData(kind);
          const r = toolApiRef.current?.appendPart(geo.positions, geo.faceGroups, '#8fb6c9', partRangesRef.current.length);
          console.error(`[meshops] addpart:${kind} → ${JSON.stringify(r)}`);
        }
        // orbit:dx,dy — swing the host orbit camera (for POV-dependent shots, e.g. the
        // gizmo's side-on growth).
        else if (name === 'orbit') host.__model_orbit_drag?.(num(a[0]), num(a[1]));
        // camlock:0|1 — the req_2893 camera lock, straight at the host gate (headless
        // proof: camlock:1;orbit:...;shot must equal the no-orbit shot).
        else if (name === 'camlock') orbitSetLocked(num(a[0]) !== 0);
        // session — log the host's resident session + the hot doc twig (req_2898): the
        // headless proof that the resume precondition (doc twig key == host session key)
        // holds mid-edit, exactly what the next remount checks before adopting.
        else if (name === 'session') {
          const s = readModelSession();
          const t = getHotState<DocTwig | null>(DOC_TWIG_KEY, null);
          console.error(`[meshops] session=${JSON.stringify(s)} twig=${JSON.stringify(t)} match=${!!(s && t && s.key === t.key)}`);
        }
        else if (name === 'atlas') dumpAtlasPng(a.join(','));
        else if (name !== 'wait') console.error(`[meshops] unknown op: ${name}`);
      };
      const ops = opsText.split(';').map((s) => s.trim()).filter(Boolean);
      let step = 0;
      const runNext = () => {
        if (step >= ops.length) {
          adoptHostSelection();
          console.error(`[meshops] DONE → ${JSON.stringify(readSelInfo())}`);
          return;
        }
        const op = ops[step++]!;
        console.error(`[meshops] ${op}`);
        try { runOp(op); } catch (e) { console.error(`[meshops] ${op} threw: ${e}`); }
        setTimeout(runNext, op.startsWith('wait') ? num(op.slice(5)) * 16 : 80);
      };
      setTimeout(runNext, 600); // let the first frames draw so pick/box have a live camera
    }
    return () => {
      paintingRef.current = false;
      meshFocusTool(false);
      meshCapture(false);
      // The viewer is gone — retract the focus-panel snapshot so the Inspector's
      // UV/SHAPE sections read honest-empty instead of a stale model's truth.
      (globalThis as any).__modelFocusBridge = null;
      (globalThis as any).__modelFocusBridgeChanged?.();
    };
  }, []);

  useFileDrop((path) => {
    if (allowFilePicker) applyPath(path);
  });

  return (
    <Box style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: '#0b0d12' }}>
      <Scene3D
        style={{ width: '100%', height: '100%' }}
        backgroundColor="#0b0d12"
        showAxes={false}
        wireframe={triangleWireframeVisible(wire, selMode)}
      >
        {/* The host owns this camera: position comes from orbit state seeded by the
            load door and driven by the overlay's drag/wheel — never from props here. */}
        <Scene3D.Camera orbit fov={50} />
        {/* A clean object-viewer wants no distance fade. */}
        <Scene3D.Fog enabled={false} />
        {/* Light rig — neutral WHITE, and the TOTAL budget never exceeds 1.0 (req_2545).
            The r3d shader is a plain sum (ambient×base + key×base×N·L, no tone map), so any
            rig over 1.0 CLAMPS per channel and SHIFTS HUE — the old ambient 1.3 + key 1.3
            drove a facing orange face to 2.2× and rendered it yellow. Now light can only
            darken, never recolour: Flat = exact paint colour; Key/Fill trade shading depth
            inside the 1.0 budget. PAINT MODE always renders flat — while judging colour the
            light must not editorialize; the rig comes back when you leave paint. */}
        <Scene3D.AmbientLight color="#ffffff" intensity={paintMode || litFlat ? 1.0 : (litFill ? 0.65 : 0.45)} />
        {/* The key is ALWAYS mounted, zeroed when off: with no directional child the host
            keeps its DEFAULT warm sun (light_color (1.0, 0.95, 0.9), 3d.zig) — which is why
            "Flat" never actually looked flat. Only an explicit intensity 0 kills it. */}
        <Scene3D.DirectionalLight direction={[-0.5, -0.8, -0.5]} color="#ffffff" intensity={paintMode || litFlat || !litKey ? 0 : (litFill ? 0.35 : 0.55)} />
        {/* Rig emitters stay mounted in ordinary model view so placement-local
            positions, aim, color, reach, and cone are judged against the mesh.
            Paint mode suppresses them: authored atlas color remains exact. */}
        {!paintMode ? authoredLights.map((light) => light.kind === 'spot' ? (
          <Scene3D.SpotLight
            key={light.id}
            position={light.position}
            direction={light.dir ?? [0, -1, 0]}
            color={light.color}
            intensity={light.intensity}
            range={light.range}
            cone={light.spread ?? 32}
            castsShadow={light.castsShadow !== false}
            colorFromRegion={liveRegionIdOf(light)}
          />
        ) : (
          <Scene3D.PointLight
            key={light.id}
            position={light.position}
            color={light.color}
            intensity={light.intensity}
            range={light.range}
            colorFromRegion={liveRegionIdOf(light)}
          />
        )) : null}
        {/* White material: all colour comes from the host's per-face paint atlas
            (default grey until painted), so painted colours render true. */}
        {model && <Scene3D.Mesh hostKey={model.key} material="#ffffff" />}
        {/* Reference backdrops (req_2758): translucent trace planes. White material so the
            picture (sampled via textureKey) reads true; alpha<1 routes them through the
            back-to-front transparent pass. The quad is centered at origin and PLACED via
            `position`, so the panel's sliders move it with no geometry re-bake; the
            geometry id carries the SHAPE signature (plane/scale/aspect/flip) because the
            intern cache serves by id and never re-runs generate for a known key. */}
        {backdrops.filter((b) => b.visible).map((bd, i) => (
          <Scene3D.Mesh
            key={`${bd.id}~${bdEpochRef.current}`}
            geometry={{ id: `editor.bd.${bd.id}.${bdEpochRef.current}.${bd.plane}.${bd.scale.toFixed(1)}.${bd.aspect.toFixed(3)}.${bd.flipU ? 1 : 0}`, generate: () => backdropQuad(bd), defaults: {} }}
            dynamicKey={`editor.bd${i}~${bd.id}.${bdEpochRef.current}.${bd.plane}.${bd.scale}.${bd.aspect}.${bd.flipU ? 1 : 0}`}
            material={{ color: '#ffffff', opacity: bd.opacity }}
            textureKey={backdropTexKey(`${bd.id}.${bdEpochRef.current}`)}
            position={bd.pos}
          />
        ))}
      </Scene3D>

      {/* Backdrop texture bakes — offscreen 2D surfaces the quads sample. Keyed on the
          mount epoch so a remount re-bakes instead of sampling a stale host texture.
          Mounted for EVERY backdrop, hidden or not (req_3079): unmounting on hide freed
          the surface, and the re-bake on show could capture the image mid-load — the
          quad then sampled a placeholder/misplaced picture. The quads filter on
          visible; the bakes stay warm. */}
      {backdrops.map((b) => (
        <BackdropSurface key={`${b.id}~${bdEpochRef.current}`} id={`${b.id}.${bdEpochRef.current}`} source={b.source} aspect={b.aspect} />
      ))}

      {/* Paint input surface — mounted ONLY in paint mode. Every other interaction (orbit
          on middle-drag, vertex/edge/face select + marquee on left, wheel zoom, double-click
          recenter, Focus-tool pan) is owned by the HOST's native model-editor input loop in
          engine.zig — zero JS per event, no React render per move. When this Pressable isn't
          mounted, viewport mouse events reach that native loop directly. */}
      {model && paintMode && brushTool !== 'pen' && (
        <Pressable
          onMouseDown={(p: any) => {
            const x = p?.x ?? 0, y = p?.y ?? 0;
            // Eyedropper: SAMPLE the painted atlas under the cursor (req_3097 — the
            // tool used to fall through and stamp paint). Drag keeps sampling live;
            // the pick funnels through the spine via the announce global.
            if (brushTool === 'eyedropper') { dropperRef.current = true; sampleColorAt(x, y); return; }
            paintingRef.current = true;
            lastPtRef.current = { x, y };
            const rgb = brushRgb(brush);
            if (brushTool === 'fill') { fillFaceAt(x, y, rgb); return; }
            strokeBeginAt(x, y); // capture the pressed face for LOCK-mode masking
            stampAt(x, y, rgb, brushRadius(brush.size), brush);
          }}
          onMouseMove={(p: any) => {
            if (dropperRef.current) { sampleColorAt(p?.x ?? 0, p?.y ?? 0); return; }
            if (!paintingRef.current) return;
            const x = p?.x ?? 0, y = p?.y ?? 0;
            const rgb = brushRgb(brush);
            if (brushTool === 'fill') { fillFaceAt(x, y, rgb); lastPtRef.current = { x, y }; return; }
            // Free-form: walk the screen segment at the brush's authored spacing (bounded)
            // so the Spacing dial is real here too, not only on flat Paintables.
            const last = lastPtRef.current ?? { x, y };
            const dx = x - last.x, dy = y - last.y;
            const steps = Math.min(
              MODEL_STROKE_TUNING.maxDabsPerPointerMove,
              Math.max(1, Math.floor(Math.hypot(dx, dy) / modelScreenSpacing(brush.spacing))),
            );
            const radius = brushRadius(brush.size);
            for (let i = 1; i <= steps; i += 1) {
              const t = i / steps;
              stampAt(last.x + dx * t, last.y + dy * t, rgb, radius, brush);
            }
            lastPtRef.current = { x, y };
          }}
          // Stroke END: commit the gesture as ONE stroke-journal undo unit (req_2672 —
          // pointer-down→up is one stroke, fills included), then refresh the live UV
          // panel (req_2625 GG) — once per stroke, never per dab (a read+encode per dab
          // would drag the brush).
          onMouseUp={() => { dropperRef.current = false; const was = paintingRef.current; paintingRef.current = false; lastPtRef.current = null; if (was) { host.__mesh_paint_stroke_end?.(); onDocumentMutated?.(); refreshUvIfLive(); } }}
          onMouseLeave={() => { dropperRef.current = false; const was = paintingRef.current; paintingRef.current = false; lastPtRef.current = null; if (was) { host.__mesh_paint_stroke_end?.(); onDocumentMutated?.(); refreshUvIfLive(); } }}
          onScroll={(e: any) => orbitZoom(e?.deltaY ?? 0)}
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.001)' }}
        />
      )}

      {model && paintMode && brushTool === 'pen' ? (
        <PenPathOverlay
          resetKey={`${model.key}:${penRevision}`}
          label="Pen fill · keep every anchor on one authored face"
          onCancel={() => setPenRevision((revision) => revision + 1)}
          onConfirm={(points) => {
            const rgb = brushRgb(brush);
            const ok = host.__model_paint_polygon?.(points, rgb[0], rgb[1], rgb[2], brush.flow, blendModeIndex(brush.blend)) === 1;
            if (!ok) {
              setError('Pen fill refused — keep the complete outline on one visible authored face');
              return;
            }
            host.__mesh_paint_stroke_end?.();
            onDocumentMutated?.();
            refreshUvIfLive();
            setError(null);
            setPenRevision((revision) => revision + 1);
          }}
        />
      ) : null}

      {model && pathPlaneMode ? (
        <PenPathOverlay
          resetKey={`path-plane:${model.key}:${penRevision}`}
          accent="#ad77ff"
          label="Path Plane · draw its outline on the focus plane"
          onCancel={() => setPathPlaneMode(false)}
          onConfirm={(points) => {
            const result = meshAppendPathPlane(points, partRangesRef.current.length);
            if (!adoptMesh(result) || result?.lo == null || result?.hi == null) {
              setError('Path Plane refused — use a simple closed outline and keep the model document active');
              return;
            }
            const range = { lo: result.lo, hi: result.hi };
            const [rr, gg, bb] = hexToRgb01('#ad77ff');
            host.__model_paint_group_range?.(range.lo, range.hi, Math.round(rr * 255), Math.round(gg * 255), Math.round(bb * 255));
            if (!resyncPartRanges()) {
              partRangesRef.current = [...partRangesRef.current, range];
              meshSetPartRanges(partRangesRef.current);
            }
            onPathPlaneCreated?.(range, 'plane');
            onDocumentMutated?.();
            setError(null);
            enterVertexModeOnPenCommit();
          }}
        />
      ) : null}

      {model && pathEdgesMode ? (
        <PenPathOverlay
          resetKey={`path-edges:${model.key}:${penRevision}`}
          accent="#58e8a6"
          label="Pen Edges · open or closed path · commits edges only, no face"
          allowOpenConfirm
          onCancel={() => setPathEdgesMode(false)}
          onConfirm={(points, closedPath) => {
            const result = meshAppendPathEdges(points, closedPath, partRangesRef.current.length);
            if (!adoptMesh(result) || result?.lo == null || result?.hi == null) {
              setError('Pen Edges refused — draw at least one segment and keep the model document active');
              return;
            }
            const range = { lo: result.lo, hi: result.hi };
            if (!resyncPartRanges()) {
              partRangesRef.current = [...partRangesRef.current, range];
              meshSetPartRanges(partRangesRef.current);
            }
            onPathPlaneCreated?.(range, 'edges');
            onDocumentMutated?.();
            setError(null);
            enterVertexModeOnPenCommit();
          }}
        />
      ) : null}

      {/* Title strip — only changes on load, so this render is the one-and-only. */}
      <Row
        style={{
          position: 'absolute', left: 0, top: 0, right: 0, height: 34,
          alignItems: 'center', paddingLeft: 14, paddingRight: 14,
          backgroundColor: 'rgba(12,14,20,0.72)', borderBottomWidth: 1, borderColor: '#1d2330',
        }}
      >
        <Text style={{ color: '#e8edf6', fontSize: 13, fontWeight: 600 }}>
          {model ? model.name : initialTitle ?? 'Model Viewer'}
        </Text>
        {model && (
          <Text style={{ color: '#7d899c', fontSize: 12, marginLeft: 12 }}>
            {selMode !== 0
              ? `${selInfo.sel} selected`
              : `${(model.count / 3).toLocaleString()} tris`}
          </Text>
        )}
        <Box style={{ flexGrow: 1 }} />
        {model && attribution && (
          <Pressable
            onPress={() => setAttrOpen((v) => !v)}
            tooltip="Attribution & credits"
            style={{ marginRight: 8, flexDirection: 'row', alignItems: 'center' }}
          >
            <AttributionStatusBadge status={attribution.status} />
          </Pressable>
        )}
        {!hostChrome && model && (
          <Pressable
            onPress={togglePaint}
            tooltip="Toggle paint mode (P)"
            style={{
              marginRight: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
              backgroundColor: paintMode ? '#2a466e' : '#16233aee', borderWidth: 1, borderColor: paintMode ? '#5a86c0' : '#2c4a6a',
            }}
          >
            <Text style={{ color: paintMode ? '#eaf2ff' : '#cfe0f5', fontSize: 12, fontWeight: 600 }}>Paint</Text>
          </Pressable>
        )}
        {!hostChrome && model && (
          <Pressable
            onPress={toggleFocus}
            tooltip="Focus tool (F) — drag to move the pivot; double-click the model to recenter"
            style={{
              marginRight: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
              backgroundColor: focusMode ? '#2a466e' : '#16233aee', borderWidth: 1, borderColor: focusMode ? '#5a86c0' : '#2c4a6a',
            }}
          >
            <Text style={{ color: focusMode ? '#eaf2ff' : '#cfe0f5', fontSize: 12, fontWeight: 600 }}>Focus</Text>
          </Pressable>
        )}
        {!hostChrome && model && (
          <Pressable
            onPress={() => setWire((w) => !w)}
            tooltip="Toggle render-triangle wireframe in View mode (W); edit modes show authored edges"
            style={{
              marginRight: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
              backgroundColor: wire ? '#2a466e' : '#16233aee', borderWidth: 1, borderColor: wire ? '#5a86c0' : '#2c4a6a',
            }}
          >
            <Text style={{ color: wire ? '#eaf2ff' : '#cfe0f5', fontSize: 12, fontWeight: 600 }}>Wireframe</Text>
          </Pressable>
        )}
        {!hostChrome && model && (
          <Pressable
            onPress={toggleCamLock}
            tooltip="Lock camera (K) — freeze the view exactly where you set it; orbit/zoom/pan/focus all no-op until unlocked"
            style={{
              marginRight: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
              backgroundColor: camLock ? '#2a466e' : '#16233aee', borderWidth: 1, borderColor: camLock ? '#5a86c0' : '#2c4a6a',
            }}
          >
            <Text style={{ color: camLock ? '#eaf2ff' : '#cfe0f5', fontSize: 12, fontWeight: 600 }}>{camLock ? 'Cam Locked' : 'Lock Cam'}</Text>
          </Pressable>
        )}
        {allowFilePicker ? (
          <Pressable
            onPress={chooseModel}
            style={{
              paddingLeft: 12, paddingRight: 12, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
              backgroundColor: '#16233aee', borderWidth: 1, borderColor: '#2c4a6a',
            }}
          >
            <Text style={{ color: '#cfe0f5', fontSize: 12, fontWeight: 600 }}>Open…</Text>
          </Pressable>
        ) : null}
      </Row>

      {/* Standalone brush panel — the ONE brush kit (runtime/paint), mounted on the left in
          paint mode. In the editor embed (hostChrome) the kit lives in the Model Focus dock and
          the tool/safety/detail toggles live in the top toolbar, so this whole panel is
          suppressed there. The two mandatory behaviours (fill · free-form) plus the clip/lock
          safety toggle and the 8/16/32 detail toggle are surfaced here for standalone use. */}
      {!hostChrome && model && paintMode && (
        <Col
          style={{
            position: 'absolute', left: 10, top: 44, width: 238,
            backgroundColor: 'rgba(12,14,20,0.92)', borderWidth: 1, borderColor: '#1d2330',
            borderRadius: 8, padding: 10, gap: 10,
          }}
        >
          <Row style={{ alignItems: 'center', gap: 8 }}>
            <Pressable
              onPress={cycleSafety}
              tooltip="Face safety: clip paints the face under the dab; lock masks the whole stroke to the pressed face"
              style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: '#16233aee', borderWidth: 1, borderColor: '#2c4a6a' }}
            >
              <Text style={{ color: '#cfe0f5', fontSize: 11, fontWeight: 700 }}>{safety === 0 ? 'Clip' : 'Lock'}</Text>
            </Pressable>
            <Pressable
              onPress={cycleDetail}
              tooltip="Paint atlas budget — cycles 512²/1024²/2048²/4096²; the model derives its texels-per-meter from the budget (bigger atlas = finer strokes)"
              style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: '#16233aee', borderWidth: 1, borderColor: '#2c4a6a' }}
            >
              <Text style={{ color: '#cfe0f5', fontSize: 11, fontWeight: 700 }}>
                {detail <= 1 ? 'Atlas —' : fit ? `Atlas ${fit}² · ${detail}x` : `Density ${detail}x`}
              </Text>
            </Pressable>
          </Row>
          <BrushKit
            brush={brush} onBrushChange={setBrush}
            tool={brushTool} onToolChange={chooseBrushTool}
            palette={palette} onPaletteChange={setPalette}
            tools={['fill', 'brush', 'pen', 'eyedropper']}
            theme={DARK_THEME} width={218}
          />
        </Col>
      )}

      {/* Mode toolbar — Object / Vertex / Edge / Face. The host-native selection modes;
          picking happens against the resident mesh with the exact render camera. Shares the
          under-title row with the paint palette (they're mutually-exclusive tools).
          Suppressed under hostChrome: the editor's toolbar + context menu own these. */}
      {!hostChrome && model && !paintMode && (
        <Row
          style={{
            position: 'absolute', left: 0, top: 34, right: 0, height: 40,
            alignItems: 'center', paddingLeft: 12, paddingRight: 12, gap: 6,
            backgroundColor: 'rgba(12,14,20,0.82)', borderBottomWidth: 1, borderColor: '#1d2330',
          }}
        >
          {SEL_MODES.map((label, m) => {
            const active = selMode === m && !focusMode;
            return (
              <Pressable
                key={label}
                onPress={() => chooseSelMode(m)}
                tooltip={m === 0 ? 'View / orbit' : `${label} select (${m})`}
                style={{
                  paddingLeft: 12, paddingRight: 12, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
                  backgroundColor: active ? '#2a466e' : '#16233aee',
                  borderWidth: 1, borderColor: active ? '#5a86c0' : '#2c4a6a',
                }}
              >
                <Text style={{ color: active ? '#eaf2ff' : '#cfe0f5', fontSize: 12, fontWeight: 600 }}>{label}</Text>
              </Pressable>
            );
          })}
          {selMode !== 0 && (
            <>
              <Box style={{ width: 1, height: 22, backgroundColor: '#2a3446', marginLeft: 4, marginRight: 4 }} />
              {GIZMO_TOOLS.map((label, t) => {
                const active = gizmoTool === t;
                const key = t === 0 ? 'G' : t === 1 ? 'S' : 'R';
                return (
                  <Pressable
                    key={label}
                    onPress={() => chooseGizmoTool(t)}
                    tooltip={`${label} gizmo (${key})`}
                    style={{
                      paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
                      backgroundColor: active ? '#42305f' : '#16233aee',
                      borderWidth: 1, borderColor: active ? '#8a6ac0' : '#2c4a6a',
                    }}
                  >
                    <Text style={{ color: active ? '#f0eaff' : '#cfe0f5', fontSize: 12, fontWeight: 600 }}>{label}</Text>
                  </Pressable>
                );
              })}
              {selMode === 1 && selInfo.sel === 1 && (
                <>
                  <Box style={{ width: 1, height: 22, backgroundColor: '#2a3446', marginLeft: 4, marginRight: 4 }} />
                  <Pressable
                    onPress={openBevel}
                    tooltip="Bevel selected corner — opens a live width preview (3+ incident edges)"
                    style={{
                      paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
                      backgroundColor: '#203a2fee', borderWidth: 1, borderColor: '#3d765c',
                    }}
                  >
                    <Text style={{ color: '#ddf5e8', fontSize: 12, fontWeight: 600 }}>Bevel</Text>
                  </Pressable>
                </>
              )}
              {selMode === 2 && selInfo.sel > 0 && (
                <>
                  <Box style={{ width: 1, height: 22, backgroundColor: '#2a3446', marginLeft: 4, marginRight: 4 }} />
                  {selInfo.sel === 1 && (
                    <Pressable
                      onPress={() => applyTopo(meshExtrudeEdge(model.radius * 0.08), 'Select exactly one edge to extrude')}
                      tooltip="Extrude selected edge"
                      style={{
                        paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
                        backgroundColor: '#203a2fee', borderWidth: 1, borderColor: '#3d765c',
                      }}
                    >
                      <Text style={{ color: '#ddf5e8', fontSize: 12, fontWeight: 600 }}>Extrude</Text>
                    </Pressable>
                  )}
                  {selInfo.sel === 1 && (
                    <Pressable
                      onPress={openBevel}
                      tooltip="Bevel selected sharp manifold edge — opens a live width preview"
                      style={{
                        paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
                        backgroundColor: '#203a2fee', borderWidth: 1, borderColor: '#3d765c',
                      }}
                    >
                      <Text style={{ color: '#ddf5e8', fontSize: 12, fontWeight: 600 }}>Bevel</Text>
                    </Pressable>
                  )}
                  {selInfo.sel === 1 && (
                    <Pressable
                      onPress={() => applyTopo(meshLoopCut(), 'Select exactly one edge to loop-cut across')}
                      tooltip="Loop cut across the ring perpendicular to this edge"
                      style={{
                        paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
                        backgroundColor: '#203a2fee', borderWidth: 1, borderColor: '#3d765c',
                      }}
                    >
                      <Text style={{ color: '#ddf5e8', fontSize: 12, fontWeight: 600 }}>Loop Cut</Text>
                    </Pressable>
                  )}
                  {selInfo.sel >= 2 && (
                    <Pressable
                      onPress={() => applyTopo(meshCreateFace(), 'Select two separate edges or a closed 3/4-edge loop')}
                      tooltip="Create face from selected edges"
                      style={{
                        paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
                        backgroundColor: '#203a2fee', borderWidth: 1, borderColor: '#3d765c',
                      }}
                    >
                      <Text style={{ color: '#ddf5e8', fontSize: 12, fontWeight: 600 }}>Create Face</Text>
                    </Pressable>
                  )}
                </>
              )}
              {selMode === 3 && selInfo.sel > 0 && (
                <>
                  <Box style={{ width: 1, height: 22, backgroundColor: '#2a3446', marginLeft: 4, marginRight: 4 }} />
                  {selInfo.sel === 1 && (
                    <Pressable
                      onPress={() => applyTopo(meshExtrudeFace(model.radius * 0.08), 'Select exactly one face to extrude')}
                      tooltip="Extrude selected face (E)"
                      style={{
                        paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
                        backgroundColor: '#203a2fee', borderWidth: 1, borderColor: '#3d765c',
                      }}
                    >
                      <Text style={{ color: '#ddf5e8', fontSize: 12, fontWeight: 600 }}>Extrude</Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => { if (!adoptMesh(meshFlipFaces())) setError('Select face(s) to flip'); }}
                    tooltip="Flip selected face(s) to the opposite side (X)"
                    style={{
                      paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
                      backgroundColor: '#203a2fee', borderWidth: 1, borderColor: '#3d765c',
                    }}
                  >
                    <Text style={{ color: '#ddf5e8', fontSize: 12, fontWeight: 600 }}>Flip</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => openLoopCut()}
                    tooltip="Loop cut across this face — popup picks direction, cuts, and offset (L)"
                    style={{
                      paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
                      backgroundColor: lc ? '#2a4a3aee' : '#203a2fee', borderWidth: 1, borderColor: lc ? '#57a87f' : '#3d765c',
                    }}
                  >
                    <Text style={{ color: '#ddf5e8', fontSize: 12, fontWeight: 600 }}>Loop Cut</Text>
                  </Pressable>
                </>
              )}
              <Box style={{ flexGrow: 1 }} />
              <Text style={{ color: '#7d899c', fontSize: 12, fontFamily: 'monospace' }}>
                {`${selInfo.sel} sel · ${selMode === 1 ? `${selInfo.verts} verts` : selMode === 2 ? `${selInfo.edges} edges` : `${(model.count / 3).toLocaleString()} faces`}`}
              </Text>
              <Pressable
                onPress={() => { meshClearSel(); adoptHostSelection(selInfo); }}
                tooltip="Clear selection (Esc)"
                style={{ marginLeft: 8, paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: '#16233aee', borderWidth: 1, borderColor: '#2c4a6a' }}
              >
                <Text style={{ color: '#cfe0f5', fontSize: 12, fontWeight: 600 }}>Clear</Text>
              </Pressable>
            </>
          )}
        </Row>
      )}

      {/* Reference Images panel (req_2758) — setup card for the tracing backdrops. The
          viewport stays live behind it (orbit while you line the trace up); close and
          the planes stay. Opened from View → Reference Images via the tool api. */}
      {backdropPanel ? (
        <BackdropsPanel
          backdrops={backdrops}
          status={bdStatus}
          openId={bdOpenId}
          onOpen={setBdOpenId}
          onAdd={() => { void addBackdrop(); }}
          onUpdate={(id, patch) => setBackdrops((list) => list.map((b) => (b.id === id ? { ...b, ...patch } : b)))}
          onRemove={(id) => setBackdrops((list) => list.filter((b) => b.id !== id))}
          onClose={() => setBackdropPanel(false)}
        />
      ) : null}

      {/* Whole-topology triangle→quad planner. The host preview changes authored
          grouping only, so the viewport's real edge overlay is the visualization:
          proposed source diagonals disappear while this card remains reversible. */}
      {quadify ? (
        <Box style={{ position: 'absolute', left: 8, right: 8, bottom: 62, alignItems: 'center', overflow: 'hidden' }}>
          <Col
            style={{
              width: LC_CARD_W + QUADIFY_PREVIEW_TUNING.cardExtraWidth, maxWidth: '100%', paddingLeft: LC_PAD, paddingRight: LC_PAD, paddingTop: 12, paddingBottom: 12,
              backgroundColor: 'rgba(11,19,32,0.97)', borderWidth: 1, borderColor: '#36597d',
              borderRadius: 8, gap: 9,
            }}
          >
            <Row style={{ alignItems: 'center' }}>
              <Text numberOfLines={1} noWrap style={{ color: '#e6eefb', fontSize: 13, fontWeight: 700, flexGrow: 1, minWidth: 0 }}>
                Tris to Quads · Whole Topology
              </Text>
              <Pressable
                onPress={() => closeQuadify(false)}
                tooltip="Cancel (Esc) — restore the exact pre-scan topology and selection"
                style={{ width: LC_BTN_W, alignItems: 'center', paddingTop: 3, paddingBottom: 3, borderRadius: 6, backgroundColor: '#303747', borderWidth: 1, borderColor: '#566176' }}
              >
                <Text style={{ color: '#b9c4d4', fontSize: 11 }}>✕</Text>
              </Pressable>
            </Row>

            {quadify.phase === 'scanning' ? (
              <>
                <Text style={{ color: '#b9c8dc', fontSize: 12 }}>
                  {`Scanning adjacency and solving the maximum quad set${'.'.repeat(quadify.pulse + 1)}`}
                </Text>
                <Row style={{ gap: 5 }}>
                  {QUADIFY_PREVIEW_TUNING.loaderSteps.map((step) => (
                    <Box
                      key={step}
                      style={{
                        height: 5, flexGrow: 1, borderRadius: 3,
                        backgroundColor: step === quadify.pulse ? '#68a9e8' : '#203754',
                      }}
                    />
                  ))}
                </Row>
                <Text style={{ color: '#7d899c', fontSize: 10, fontFamily: 'monospace' }}>
                  {`evaluation ${quadify.evaluation + 1}/${QUADIFY_PREVIEW_TUNING.evaluations.length} · dry run only`}
                </Text>
                <Pressable
                  onPress={() => closeQuadify(false)}
                  style={{ paddingTop: 6, paddingBottom: 6, borderRadius: 6, alignItems: 'center', backgroundColor: '#303747', borderWidth: 1, borderColor: '#566176' }}
                >
                  <Text style={{ color: '#d1d8e3', fontSize: 12, fontWeight: 700 }}>Cancel Scan</Text>
                </Pressable>
              </>
            ) : (() => {
              const plan = quadify.plan;
              const evaluation = QUADIFY_PREVIEW_TUNING.evaluations[quadify.evaluation]!;
              const pairedTriangles = plan.quads * 2;
              const remainingTriangles = Math.max(0, plan.triangleFaces - pairedTriangles);
              const hasPlan = plan.quads > 0;
              return (
                <>
                  <Row style={{ alignItems: 'baseline' }}>
                    <Text style={{ color: hasPlan ? '#7fd6a0' : '#e7b96b', fontSize: 24, fontWeight: 800 }}>
                      {plan.quads.toLocaleString()}
                    </Text>
                    <Text style={{ color: '#c7d2e3', fontSize: 12, marginLeft: 7 }}>
                      {`quad${plan.quads === 1 ? '' : 's'} in this maximum set`}
                    </Text>
                  </Row>
                  <Text style={{ color: '#8fa1b8', fontSize: 11 }}>
                    {hasPlan
                      ? 'Live dry run: proposed triangle diagonals are hidden in the topology view. Nothing is committed yet.'
                      : 'No safe adjacent triangle pairs were found. The model is unchanged.'}
                  </Text>
                  {([
                    ['triangles paired', pairedTriangles.toLocaleString()],
                    ['triangles left single', remainingTriangles.toLocaleString()],
                    ['authored faces', `${plan.authoredBefore.toLocaleString()} → ${plan.authoredAfter.toLocaleString()}`],
                    ['possible pairings', plan.candidatePairs.toLocaleString()],
                    ['triangles with choices', plan.ambiguousTriangles.toLocaleString()],
                  ] as const).map(([label, value]) => (
                    <Row key={label} style={{ alignItems: 'center' }}>
                      <Text style={{ color: '#8798ad', fontSize: 11, flexGrow: 1 }}>{label}</Text>
                      <Text style={{ color: '#dce6f4', fontSize: 11, fontFamily: 'monospace' }}>{value}</Text>
                    </Row>
                  ))}
                  <Row style={{ alignItems: 'center', gap: LC_GAP }}>
                    <Pressable
                      onPress={() => changeQuadifyEvaluation(-1)}
                      tooltip="Preview the previous maximum-cardinality evaluation"
                      style={{ width: LC_BTN_W, alignItems: 'center', paddingTop: 4, paddingBottom: 4, borderRadius: 6, backgroundColor: '#16233aee', borderWidth: 1, borderColor: '#2c4a6a' }}
                    >
                      <Text style={{ color: '#cfe0f5', fontSize: 12, fontWeight: 700 }}>‹</Text>
                    </Pressable>
                    <Col style={{ flexGrow: 1, minWidth: 0, alignItems: 'center' }}>
                      <Text numberOfLines={1} noWrap style={{ color: '#e6eefb', fontSize: 11, fontWeight: 700 }}>
                        {`${evaluation.label} · ${quadify.evaluation + 1}/${plan.evaluationCount}`}
                      </Text>
                      <Text numberOfLines={1} noWrap style={{ color: '#75879e', fontSize: 9 }}>
                        {`${evaluation.note} · plan ${Math.trunc(plan.planSignature).toString(16).padStart(8, '0')}`}
                      </Text>
                    </Col>
                    <Pressable
                      onPress={() => changeQuadifyEvaluation(1)}
                      tooltip="Preview the next maximum-cardinality evaluation"
                      style={{ width: LC_BTN_W, alignItems: 'center', paddingTop: 4, paddingBottom: 4, borderRadius: 6, backgroundColor: '#16233aee', borderWidth: 1, borderColor: '#2c4a6a' }}
                    >
                      <Text style={{ color: '#cfe0f5', fontSize: 12, fontWeight: 700 }}>›</Text>
                    </Pressable>
                  </Row>
                  <Row style={{ gap: LC_GAP }}>
                    <Pressable
                      onPress={() => closeQuadify(false)}
                      style={{ flexGrow: 1, paddingTop: 6, paddingBottom: 6, borderRadius: 6, alignItems: 'center', backgroundColor: '#303747', borderWidth: 1, borderColor: '#566176' }}
                    >
                      <Text style={{ color: '#d1d8e3', fontSize: 12, fontWeight: 700 }}>{hasPlan ? 'Cancel' : 'Close'}</Text>
                    </Pressable>
                    {hasPlan ? (
                      <Pressable
                        onPress={() => closeQuadify(true)}
                        tooltip={`Commit ${plan.quads} quads as one undo step`}
                        style={{ flexGrow: 1, paddingTop: 6, paddingBottom: 6, borderRadius: 6, alignItems: 'center', backgroundColor: '#1c3a2a', borderWidth: 1, borderColor: '#2f7a4f' }}
                      >
                        <Text style={{ color: '#7fd6a0', fontSize: 12, fontWeight: 700 }}>{`Apply ${plan.quads.toLocaleString()} Quads`}</Text>
                      </Pressable>
                    ) : null}
                  </Row>
                </>
              );
            })()}
          </Col>
        </Box>
      ) : null}

      {/* Bevel sizing: the old Studio edge/vertex chamfer brought onto the current
          host-native indexed mesh. Width is modeling u; every step is a fresh preview
          from the captured base. Apply journals once, while ✕ / Esc restores the base
          and the exact original selection. */}
      {bv ? (
        <Box style={{ position: 'absolute', left: 8, right: 8, bottom: 62, alignItems: 'center', overflow: 'hidden' }}>
          <Col
            style={{
              width: LC_CARD_W, maxWidth: '100%', paddingLeft: LC_PAD, paddingRight: LC_PAD, paddingTop: 10, paddingBottom: 10,
              backgroundColor: 'rgba(11,19,32,0.96)', borderWidth: 1, borderColor: '#2c4a6a',
              borderRadius: 8, gap: 8,
            }}
          >
            <Row style={{ alignItems: 'center' }}>
              <Text numberOfLines={1} noWrap style={{ color: '#e6eefb', fontSize: 13, fontWeight: 700, flexGrow: 1, minWidth: 0 }}>
                {`Bevel ${bv.kind === 'edge' ? 'Edge' : 'Vertex'}`}
              </Text>
              <Pressable
                onPress={() => closeBevel(false)}
                tooltip="Cancel (Esc) — restore the unbeveled mesh and selection"
                style={{ width: LC_BTN_W, alignItems: 'center', paddingTop: 3, paddingBottom: 3, borderRadius: 6, backgroundColor: '#303747', borderWidth: 1, borderColor: '#566176' }}
              >
                <Text style={{ color: '#b9c4d4', fontSize: 11 }}>✕</Text>
              </Pressable>
            </Row>
            {bv.fallbackReason ? (
              <Text style={{ color: '#e7b96b', fontSize: 11 }}>{bv.fallbackReason}</Text>
            ) : null}
            <Row style={{ alignItems: 'center' }}>
              <Text numberOfLines={1} noWrap style={{ color: '#8fa1b8', fontSize: 12, width: LC_LABEL_W }}>width u</Text>
              <Box style={{ flexGrow: 1 }} />
              <Pressable
                onPress={() => changeBevel(bv.width - BEVEL_POPUP_TUNING.stepUnits)}
                style={{ width: LC_BTN_W, alignItems: 'center', paddingTop: 3, paddingBottom: 3, borderRadius: 6, backgroundColor: '#16233aee', borderWidth: 1, borderColor: '#2c4a6a' }}
              >
                <Text style={{ color: '#cfe0f5', fontSize: 12, fontWeight: 700 }}>−</Text>
              </Pressable>
              <Text numberOfLines={1} noWrap style={{ color: '#e6eefb', fontSize: 12, fontFamily: 'monospace', width: LC_VAL_W, marginLeft: LC_GAP, marginRight: LC_GAP, textAlign: 'center' }}>
                {bv.width.toFixed(BEVEL_POPUP_TUNING.widthDecimals)}
              </Text>
              <Pressable
                onPress={() => changeBevel(bv.width + BEVEL_POPUP_TUNING.stepUnits)}
                style={{ width: LC_BTN_W, alignItems: 'center', paddingTop: 3, paddingBottom: 3, borderRadius: 6, backgroundColor: '#16233aee', borderWidth: 1, borderColor: '#2c4a6a' }}
              >
                <Text style={{ color: '#cfe0f5', fontSize: 12, fontWeight: 700 }}>+</Text>
              </Pressable>
            </Row>
            <Text style={{ color: '#7d899c', fontSize: 10, fontFamily: 'monospace' }}>{`max ${bv.max.toFixed(BEVEL_POPUP_TUNING.widthDecimals)}u`}</Text>
            <Pressable
              onPress={() => closeBevel(!bv.fallbackReason)}
              tooltip={bv.fallbackReason ? 'Close without changing the mesh' : 'Commit the bevel as one undo step'}
              style={{ marginTop: 2, paddingTop: 6, paddingBottom: 6, borderRadius: 6, alignItems: 'center', backgroundColor: bv.fallbackReason ? '#303747' : '#1c3a2a', borderWidth: 1, borderColor: bv.fallbackReason ? '#566176' : '#2f7a4f' }}
            >
              <Text style={{ color: bv.fallbackReason ? '#c8d1df' : '#7fd6a0', fontSize: 12, fontWeight: 700 }}>{bv.fallbackReason ? 'Close' : 'Apply'}</Text>
            </Pressable>
          </Col>
        </Box>
      ) : null}

      {/* Loop-cut popup (the studio's Blockbench panel): direction (which in-plane axis),
          cuts, offset along the face's span (size units or percent — req_2625 EE). Every
          change re-previews live through the host session; Apply commits one journal
          entry, ✕ (or Esc) restores the base.
          Anchored bottom-center and CLAMPED fully on-screen (req_2625 FF): the wrapper
          spans the viewport minus an 8px inset so the panel can never hang off an edge.
          overflow:'hidden' also forces a GPU scissor segment, which lifts the panel above
          the mesh overlay capsules (capsules flush after rects WITHIN a segment — the
          same stacking law as req_2618 gap K).
          Control grid (req_2626 II): one flexing label column + fixed − / value / +
          stepper columns; every row shares the SAME cell widths, so all controls end on
          one right edge; the unit toggle and Apply span the stepper zone / full grid. */}
      {lc ? (
        <Box style={{ position: 'absolute', left: 8, right: 8, bottom: 62, alignItems: 'center', overflow: 'hidden' }}>
          <Col
            style={{
              width: LC_CARD_W, maxWidth: '100%', paddingLeft: LC_PAD, paddingRight: LC_PAD, paddingTop: 10, paddingBottom: 10,
              backgroundColor: 'rgba(11,19,32,0.96)', borderWidth: 1, borderColor: '#2c4a6a',
              borderRadius: 8, gap: 8,
            }}
          >
            <Row style={{ alignItems: 'center' }}>
              <Text numberOfLines={1} noWrap style={{ color: '#e6eefb', fontSize: 13, fontWeight: 700, flexGrow: 1, minWidth: 0 }}>{lc.basic ? 'Cut' : 'Loop Cut'}</Text>
              <Pressable
                onPress={() => closeLoopCut(false)}
                tooltip="Cancel (Esc) — restore the uncut mesh"
                style={{ width: LC_BTN_W, alignItems: 'center', paddingTop: 3, paddingBottom: 3, borderRadius: 6, backgroundColor: '#303747', borderWidth: 1, borderColor: '#566176' }}
              >
                <Text style={{ color: '#b9c4d4', fontSize: 11 }}>✕</Text>
              </Pressable>
            </Row>
            {lc.fallbackReason ? (
              <Text style={{ color: '#e7b96b', fontSize: 11 }}>{lc.fallbackReason}</Text>
            ) : null}
            {/* Direction — a TWO-STATE toggle labeled by the face's two in-plane axes
                (U/V) with each axis's real span, not a 0/1 stepper in a wide container
                (req_2643 MM). Same treatment as [Size | %]; both pairs span exactly the
                stepper zone, so every control ends on the one right edge. */}
            <Row style={{ alignItems: 'center' }}>
              <Text numberOfLines={1} noWrap style={{ color: '#8fa1b8', fontSize: 12, width: LC_LABEL_W }}>direction</Text>
              <Box style={{ flexGrow: 1 }} />
              {([0, 1] as const).map((d) => {
                const on = lc.dir === d;
                return (
                  <Pressable
                    key={d}
                    onPress={() => changeLoopCut({ dir: d })}
                    tooltip={`Cut across the face's ${d === 0 ? 'U' : 'V'} axis — ${(lc.sizes[d] || 0).toFixed(2)}u span`}
                    style={{ width: (LC_STEP_W - LC_GAP) / 2, marginLeft: d === 0 ? 0 : LC_GAP, alignItems: 'center', paddingTop: 3, paddingBottom: 3, borderRadius: 6,
                      backgroundColor: on ? '#244164' : '#16233aee', borderWidth: 1, borderColor: on ? '#4e75a4' : '#2c4a6a' }}
                  >
                    <Text numberOfLines={1} noWrap style={{ color: on ? '#e6f1ff' : '#cfe0f5', fontSize: 10, fontWeight: 700 }}>{`${d === 0 ? 'U' : 'V'} ${lcSpanLabel(lc.sizes[d] || 0)}`}</Text>
                  </Pressable>
                );
              })}
            </Row>
            {/* Unit toggle — Size Units (studio default) vs Percent. Occupies exactly the
                stepper zone so its right edge lines up with every stepper below. */}
            <Row style={{ alignItems: 'center' }}>
              <Text numberOfLines={1} noWrap style={{ color: '#8fa1b8', fontSize: 12, width: LC_LABEL_W }}>units</Text>
              <Box style={{ flexGrow: 1 }} />
              {(['units', 'percent'] as const).map((u, i) => {
                const on = lc.unit === u;
                return (
                  <Pressable
                    key={u}
                    onPress={() => changeLoopCut({ unit: u })}
                    tooltip={u === 'units' ? 'Offset in mesh size units along the face span' : 'Offset as a percent of the face span'}
                    style={{ width: (LC_STEP_W - LC_GAP) / 2, marginLeft: i === 0 ? 0 : LC_GAP, alignItems: 'center', paddingTop: 3, paddingBottom: 3, borderRadius: 6,
                      backgroundColor: on ? '#244164' : '#16233aee', borderWidth: 1, borderColor: on ? '#4e75a4' : '#2c4a6a' }}
                  >
                    <Text numberOfLines={1} noWrap style={{ color: on ? '#e6f1ff' : '#cfe0f5', fontSize: 11, fontWeight: 700 }}>{u === 'units' ? 'Size' : '%'}</Text>
                  </Pressable>
                );
              })}
            </Row>
            {([
              { label: 'cuts', display: `${lc.cuts}`, dec: () => changeLoopCut({ cuts: Math.max(1, lc.cuts - 1) }), inc: () => changeLoopCut({ cuts: Math.min(64, lc.cuts + 1) }) },
              { label: lc.unit === 'units' ? 'offset u' : 'offset %', display: lcOffsetDisplay, dec: () => lcStepOffset(-1), inc: () => lcStepOffset(1) },
            ]).map((field) => (
              <Row key={field.label} style={{ alignItems: 'center' }}>
                <Text numberOfLines={1} noWrap style={{ color: '#8fa1b8', fontSize: 12, width: LC_LABEL_W }}>{field.label}</Text>
                <Box style={{ flexGrow: 1 }} />
                <Pressable
                  onPress={field.dec}
                  style={{ width: LC_BTN_W, alignItems: 'center', paddingTop: 3, paddingBottom: 3, borderRadius: 6, backgroundColor: '#16233aee', borderWidth: 1, borderColor: '#2c4a6a' }}
                >
                  <Text style={{ color: '#cfe0f5', fontSize: 12, fontWeight: 700 }}>−</Text>
                </Pressable>
                <Text numberOfLines={1} noWrap style={{ color: '#e6eefb', fontSize: 12, fontFamily: 'monospace', width: LC_VAL_W, marginLeft: LC_GAP, marginRight: LC_GAP, textAlign: 'center' }}>{field.display}</Text>
                <Pressable
                  onPress={field.inc}
                  style={{ width: LC_BTN_W, alignItems: 'center', paddingTop: 3, paddingBottom: 3, borderRadius: 6, backgroundColor: '#16233aee', borderWidth: 1, borderColor: '#2c4a6a' }}
                >
                  <Text style={{ color: '#cfe0f5', fontSize: 12, fontWeight: 700 }}>+</Text>
                </Pressable>
              </Row>
            ))}
            <Pressable
              onPress={() => closeLoopCut(!lc.fallbackReason)}
              tooltip={lc.fallbackReason ? 'Close without changing the mesh' : "Commit the cut (one undo step); the clicked face's near side stays selected"}
              style={{ marginTop: 2, paddingTop: 6, paddingBottom: 6, borderRadius: 6, alignItems: 'center', backgroundColor: lc.fallbackReason ? '#303747' : '#1c3a2a', borderWidth: 1, borderColor: lc.fallbackReason ? '#566176' : '#2f7a4f' }}
            >
              <Text style={{ color: lc.fallbackReason ? '#c8d1df' : '#7fd6a0', fontSize: 12, fontWeight: 700 }}>{lc.fallbackReason ? 'Close' : 'Apply'}</Text>
            </Pressable>
          </Col>
        </Box>
      ) : null}

      {inkWarn ? (
        <Col
          style={{
            position: 'absolute', left: 18, bottom: 62, width: 360,
            paddingLeft: 14, paddingRight: 14, paddingTop: 12, paddingBottom: 12,
            backgroundColor: 'rgba(29,17,17,0.96)', borderWidth: 1, borderColor: '#8d4b50',
            borderRadius: 8,
          }}
        >
          <Text style={{ color: '#ffd7d9', fontSize: 13, fontWeight: 700 }}>Shader ink failed</Text>
          <Text style={{ color: '#b9c4d4', fontSize: 12, marginTop: 6 }}>{inkWarn}</Text>
          <Row style={{ marginTop: 12 }}>
            <Pressable
              onPress={() => setInkWarn(null)}
              style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#303747', borderWidth: 1, borderColor: '#566176' }}
            >
              <Text style={{ color: '#e1e7f1', fontSize: 12, fontWeight: 700 }}>Dismiss</Text>
            </Pressable>
          </Row>
        </Col>
      ) : null}

      {/* Wrapped in a transparent overflow:'hidden' Box: the scissor push starts a new GPU
          segment, so the prompt paints ABOVE the mesh overlay capsules (which flush after
          rects within a segment) — same stacking law as the atlas dialog (req_2618 K).
          The wrapper (not the panel) carries the overflow because a node's own background
          rect paints BEFORE the scissor that wraps its children. */}
      {guard?.pending ? (
        <Box style={{ position: 'absolute', left: 18, bottom: 62, width: 360, overflow: 'hidden' }}>
        <Col
          style={{
            width: '100%',
            paddingLeft: 14, paddingRight: 14, paddingTop: 12, paddingBottom: 12,
            backgroundColor: 'rgba(17,20,29,0.96)', borderWidth: 1, borderColor: '#805f3c',
            borderRadius: 8,
          }}
        >
          {/* Studio concave Auto-Fix wording (req_0949 port, req_2823): counts authored
              FACES newly buckled — the host predicate is editMesh.ts isFaceConcave ported
              to the indexed ordered-face table, not the old per-triangle heuristics. */}
          <Text style={{ color: '#ffe1bf', fontSize: 13, fontWeight: 700 }}>⚠ Concave face</Text>
          <Text style={{ color: '#b9c4d4', fontSize: 12, marginTop: 6 }}>
            {`${guard.bad} face${guard.bad === 1 ? '' : 's'} buckled — not convex`}
          </Text>
          <Row style={{ marginTop: 12, gap: 8 }}>
            {guard.canSplit ? (
            <Pressable
              onPress={() => closeGuard(0)}
              style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#244164', borderWidth: 1, borderColor: '#4e75a4' }}
            >
              <Text style={{ color: '#e6f1ff', fontSize: 12, fontWeight: 700 }}>Split Quads</Text>
            </Pressable>
            ) : null}
            <Pressable
              onPress={() => closeGuard(1)}
              style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#303747', borderWidth: 1, borderColor: '#566176' }}
            >
              <Text style={{ color: '#e1e7f1', fontSize: 12, fontWeight: 700 }}>Ignore</Text>
            </Pressable>
            <Pressable
              onPress={() => closeGuard(2)}
              style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#4a2729', borderWidth: 1, borderColor: '#8d4b50' }}
            >
              <Text style={{ color: '#ffe3e4', fontSize: 12, fontWeight: 700 }}>Revert</Text>
            </Pressable>
          </Row>
          {guard.canSplit ? (
            <Text style={{ color: '#8b95a7', fontSize: 10, marginTop: 8 }}>Split Quads is recommended — keeps the surface valid.</Text>
          ) : null}
        </Col>
        </Box>
      ) : null}

      {/* Symmetry trust strip (studio req_1190-1192 ported, req_2831): one row per ARMED
          mirror axis — the live badge ("⚠ N off Y" / "✓ clean") + the keep+/keep−
          symmetrize verbs. Only while mirror planes are armed, never in paint. */}
      {model && !paintMode && mirrorMask !== 0 ? (
        <Col style={{ position: 'absolute', left: 18, top: 44, gap: 6 }}>
          {[0, 1, 2].filter((a) => mirrorMask & (1 << a)).map((axis) => {
            const label = 'XYZ'[axis];
            const rep = symReports[axis];
            const off = rep ? rep.unmatched : null;
            return (
              <Row key={`sym${axis}`} style={{ alignItems: 'center', gap: 6, paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5, borderRadius: 7, backgroundColor: 'rgba(17,20,29,0.92)', borderWidth: 1, borderColor: off ? '#805f3c' : '#2c4a3a' }}>
                <Text style={{ color: off ? '#ffb454' : '#7fd6a0', fontSize: 11, fontWeight: 700 }}>
                  {off == null ? `· ${label}` : off ? `⚠ ${off} off ${label}` : `✓ ${label} clean`}
                </Text>
                <Pressable onPress={() => runSymmetrize(axis, true)} tooltip={`symmetrize — keep the +${label} half, rebuild −${label} as its mirror`} style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3, borderRadius: 5, backgroundColor: '#1c3a2a', borderWidth: 1, borderColor: '#2f7a4f' }}>
                  <Text style={{ color: '#7fd6a0', fontSize: 10, fontWeight: 700 }}>{`keep +${label}`}</Text>
                </Pressable>
                <Pressable onPress={() => runSymmetrize(axis, false)} tooltip={`symmetrize — keep the −${label} half, rebuild +${label} as its mirror`} style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3, borderRadius: 5, backgroundColor: '#1c3a2a', borderWidth: 1, borderColor: '#2f7a4f' }}>
                  <Text style={{ color: '#7fd6a0', fontSize: 10, fontWeight: 700 }}>{`keep −${label}`}</Text>
                </Pressable>
              </Row>
            );
          })}
        </Col>
      ) : null}

      {/* Create Paint Atlas — the explicit step between modeling and painting (every paint
          tool has it). Entering paint the first time on a loaded model picks the atlas
          resolution HERE, with the real texture cost shown; options the GPU can't take are
          disabled (the host clamps regardless — this is the honest preview of that).
          overflow:'hidden' on the (transparent) full-viewport wrapper fixes req_2618 gap K:
          the dialog rendered UNDERNEATH the mesh wireframe overlay because overlay capsules
          flush AFTER rects within one GPU segment — the scissor push starts a fresh segment,
          so every dialog rect/glyph now paints above the wireframe. */}
      {atlasPrompt && model && (
        <Col style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <Col
            style={{
              width: 420, paddingLeft: 16, paddingRight: 16, paddingTop: 14, paddingBottom: 14,
              backgroundColor: 'rgba(17,20,29,0.97)', borderWidth: 1, borderColor: '#3c5a80', borderRadius: 8,
            }}
          >
            <Text style={{ color: '#dbe7ff', fontSize: 14, fontWeight: 700 }}>
              {atlasInvalidatedRef.current ? 'Remake Paint Atlas' : 'Create Paint Atlas'}
            </Text>
            <Text style={{ color: '#b9c4d4', fontSize: 12, marginTop: 6 }}>
              {atlasInvalidatedRef.current
                ? 'Geometry changed after the previous UV layout. Painting is locked until you explicitly build a new atlas for the current outliners.'
                : `${authoredFaces && authoredFaces !== Math.floor(model.count / 3)
                ? `${authoredFaces} faces (${Math.floor(model.count / 3)} triangles)`
                : `${Math.floor(model.count / 3)} triangles`} — the whole model shares ONE paint atlas; its faces split it by real-world size. Bigger atlas = finer strokes on this model.`}
            </Text>
            {/* Type — WHAT the fresh atlas starts as (Blockbench's Create Texture "Type"). Same
                gate as the size below; both gate painting (req_2546). */}
            <Text style={{ color: '#8b97ab', fontSize: 10, fontWeight: 700, letterSpacing: 1, marginTop: 12 }}>TYPE</Text>
            {/* TYPE buttons sit on equal-width columns (req_2643 NN): flexBasis 0 splits
                the row evenly regardless of label length; labels never wrap. */}
            <Row style={{ marginTop: 6, gap: 6 }}>
              {([['template', 'Texture Template'], ['solid', 'Solid Color'], ['blank', 'Blank']] as const).map(([t, label]) => {
                const on = baseType === t;
                return (
                  <Pressable key={t} onPress={() => setBaseType(t)}
                    style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, alignItems: 'center', paddingTop: 6, paddingBottom: 6, borderRadius: 6,
                      backgroundColor: on ? '#244164' : '#252b3a', borderWidth: 1, borderColor: on ? '#4e75a4' : '#3a4356' }}>
                    <Text numberOfLines={1} noWrap style={{ color: on ? '#e6f1ff' : '#9fb4cf', fontSize: 11, fontWeight: '700' }}>{label}</Text>
                  </Pressable>
                );
              })}
            </Row>
            <Text style={{ color: '#8b97ab', fontSize: 10, marginTop: 4 }}>
              {baseType === 'template' ? 'each UV island a distinct colour — faces stay readable while you paint'
                : baseType === 'solid' ? 'the whole model one flat colour (your current ink)'
                : 'a bare sheet — paint from scratch'}
            </Text>
            <Text style={{ color: '#8b97ab', fontSize: 10, fontWeight: 700, letterSpacing: 1, marginTop: 12 }}>SIZE</Text>
            {(() => {
              // The HOST's island layout is the truth: each budget asks it what the
              // atlas would actually be and what density this model derives from it.
              const options: (number | null)[] = [null, ...FIT_LEVELS];
              return options.map((ft) => {
                const est = ft ? estimatePaintFit(ft) : null;
                const rec = ft === DEFAULT_FIT;
                const mbLabel = est
                  ? (() => {
                      const mb = (est.w * est.h * 4) / (1024 * 1024);
                      return mb >= 1 ? `${Math.round(mb)} MB` : `${Math.max(1, Math.round(mb * 1024))} KB`;
                    })()
                  : null;
                // The size picker is a FIXED column grid (req_2643 NN): size label,
                // density, recommended-chip (column ALWAYS reserved — empty for the
                // others, so no row blows out), bytes right-aligned to ONE edge.
                return (
                  <Pressable
                    key={ft ?? 'fill'}
                    onPress={() => createAtlasAndPaint(ft == null, ft ?? DEFAULT_FIT)}
                    style={{
                      marginTop: 6, paddingLeft: 10, paddingRight: 10, paddingTop: 7, paddingBottom: 7, borderRadius: 6,
                      backgroundColor: rec ? '#244164' : '#252b3a',
                      borderWidth: 1, borderColor: rec ? '#4e75a4' : '#3a4356',
                    }}
                  >
                    <Row style={{ alignItems: 'center', gap: 8 }}>
                      <Text numberOfLines={1} noWrap style={{ width: AP_SIZE_W, color: '#e6f1ff', fontSize: 12, fontWeight: 700 }}>
                        {ft == null ? 'Fill only' : `${ft}²`}
                      </Text>
                      <Text numberOfLines={1} noWrap style={{ width: AP_DENS_W, color: '#9fb4cf', fontSize: 11 }}>
                        {ft == null ? '1 color/face' : est ? `${est.density} tx/m` : '—'}
                      </Text>
                      <Text numberOfLines={1} noWrap style={{ width: AP_REC_W, color: '#8fc9bb', fontSize: 10, fontWeight: 700 }}>
                        {rec ? 'recommended' : ''}
                      </Text>
                      <Text numberOfLines={1} noWrap style={{ flexGrow: 1, minWidth: 0, color: '#8b97ab', fontSize: 10, textAlign: 'right' }}>
                        {ft == null ? 'tiny' : est ? `${est.w}×${est.h} · ${mbLabel}` : '—'}
                      </Text>
                    </Row>
                  </Pressable>
                );
              });
            })()}
            <Row style={{ marginTop: 12, gap: 8, justifyContent: 'flex-end' }}>
              <Pressable
                onPress={() => setAtlasPrompt(false)}
                style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#303747', borderWidth: 1, borderColor: '#566176' }}
              >
                <Text style={{ color: '#e1e7f1', fontSize: 12, fontWeight: 700 }}>Cancel</Text>
              </Pressable>
            </Row>
          </Col>
        </Col>
      )}

      {/* The UV / atlas inspector lives in the FOCUS PANEL now (Inspector's UV section,
          req_2643 OO) — fed by the model-focus bridge above. The floating viewport card
          is REMOVED, not hidden. */}

      {/* Quality strip — commit-only decimation. Drag to trade detail for triangles; the
          host owns the thumb mid-drag and re-meshes from the retained full-res source ONCE
          on release (decimating every onChange frame melted the app). Lower end is "just the
          shape" for the game (and the basis for baked LoD by render distance).
          Suppressed under hostChrome: the editor tucks Quality into its context menu. */}
      {!hostChrome && model && (
        <Row
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, height: 46,
            alignItems: 'center', paddingLeft: 14, paddingRight: 16,
            backgroundColor: 'rgba(12,14,20,0.82)', borderTopWidth: 1, borderColor: '#1d2330',
          }}
        >
          <Text style={{ color: '#cfe0f5', fontSize: 12, fontWeight: 600, marginRight: 12 }}>Quality</Text>
          <Box style={{ flexGrow: 1, marginRight: 14 }}>
            <Slider
              value={quality}
              min={0}
              max={1}
              onCommit={(v: number) => applyQuality(v)}
              style={{ height: 24 }}
            />
          </Box>
          <Text style={{ color: '#7d899c', fontSize: 12, fontFamily: 'monospace' }}>
            {`${(model.count / 3).toLocaleString()} tris`}
          </Text>
        </Row>
      )}

      {/* Attribution panel — the shared editor (same one the Studio will use). Keyed by
          the entry id so switching models re-seeds the fields. */}
      {attrOpen && attribution && (
        <AttributionPanel
          key={attribution.id}
          entry={attribution}
          onSave={saveAttribution}
          onExport={doExportCredits}
          onClose={() => setAttrOpen(false)}
        />
      )}

      {/* Center prompt until something is loaded. */}
      {!model && (
        <Col style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#9aa6ba', fontSize: 22, fontWeight: 600 }}>
            {error ? 'Model could not load' : initialPath || initialMesh || initialFileParts ? `Loading ${initialTitle ?? initialMesh?.name ?? 'model'}` : 'Open a model to view'}
          </Text>
          <Text style={{ color: '#5d6878', fontSize: 14, marginTop: 8 }}>.glb · .obj — parsed and rendered entirely in the host</Text>
          {allowFilePicker ? (
            <>
              <Pressable
                onPress={chooseModel}
                style={{
                  marginTop: 22, paddingLeft: 22, paddingRight: 22, paddingTop: 11, paddingBottom: 11, borderRadius: 8,
                  backgroundColor: '#1d3a5fee', borderWidth: 1, borderColor: '#3a5f8a',
                }}
              >
                <Text style={{ color: '#e6f0fb', fontSize: 15, fontWeight: 600 }}>Choose a model…</Text>
              </Pressable>
              <Text style={{ color: '#465162', fontSize: 12, marginTop: 14 }}>…or drop a file anywhere</Text>
            </>
          ) : null}
          {error && <Text style={{ color: '#e2706a', fontSize: 13, marginTop: 16 }}>{error}</Text>}
        </Col>
      )}
    </Box>
  );
}
