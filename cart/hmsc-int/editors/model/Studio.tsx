// editors/model/Studio.tsx — the Studio modeling viewport (req_0956 → req_0964).
//
// Scene model: an ordered LIST of EditMesh PARTS (studioModel.ts), surfaced
// through the paint editor's layers component as the OUTLINER (Outliner.tsx).
// The scene starts BLANK — the grid + axes with NO mesh (the user, req_0961:
// "start with an empty grid no mesh on it at all"); parts arrive via the
// outliner's +add. The viewport renders every VISIBLE part; the camera frames
// the combined bounds (or the grid when empty).
//
// The camera is NOT re-rolled — it drives framework/game/camera.zig's orbit
// Controller through GAME_NATIVE_CAMERA (the same host camera the compiled no-JS
// path uses, req_0957), so movement is host-solved every frame. The mesh renders
// through Scene3D's dynamic-geometry path (live verts, hot-reload, no rebuild).
//
// Diagnostics (req_0963/0964): a host-accurate frame-drop readout (frameProbe.ts
// reads the host's per-frame ring so it catches hard skips a JS timer can't see)
// + an opt-in camera-angle trace (console.warn on every drag event, so one
// smooth physical movement reveals whether the COMMANDED angle is jumping —
// i.e. bursty input — vs the host present stalling).
//
// Scale (req_0956): 1 tile = 1 m, matching the world (floors/walls are 3×3 m).
// Every value here is a named STUDIO tunable, not an inline magic number.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { callHost } from '@reactjit/runtime/ffi';
import { useHotState, useInterval, useRerender } from '@reactjit/hooks';
import { Box, Col, patchDynSlot, Pressable, Row, Scene3D, Text, TextInput } from '@reactjit/primitives';
import { GAME_CAMERA, GAME_CHROME, GAME_FIGURE, GAME_NATIVE_CAMERA } from '../../game';
import { CharacterCaptures, FigureMeshes, buildPartRender } from '../../game/figure/render';
import { HMSC_SCALE } from '../../world/scale';
import { busOn } from '@reactjit/runtime/hooks/useIFTTT';
import { editorTunables } from '../tunables';
import { useHeldModifiers } from '../useEditorControls';
import { addMount, addMountReflections, bevelEdge, bevelVertex, clampSides, clearFaceTags, clearPivot, cone, connectVerts, createFaceFromEdges, createFaceFromVerts, cuboid, cylinder, deleteFaces, detachPanel, editMeshToGeometry, extrudeEdge, extrudeFace, faceCentroid, faceNormal, facesGeometry, facesWithTag, findConcaveFaces, fitWheelCenter, wheelMesh, icosphere, mergeFaces, mergeMesh, flipFace, hasPivot, loopCutPositions, loopCutRange, meshEdges, meshHealth, mirrorEditAxes, pivotOf, plane, pyramid, removeMount, rotateVerts, scaleVerts, setFaceGlass, setPivot, solidifyFaces, sphere, splitConcaveFaces, symmetrize, symmetryReport, tagOneFace, translateVerts, updateMount, updateMountMirrored, vertsBounds, vertsCentroid, vertsHalfExtent, ICOSPHERE_SUBDIV_MAX, SHAPE_SIDES_MAX, SHAPE_SIDES_MIN, type EditMesh, type V3 as MV3 } from './editMesh';
import { addAnchor, isAnchor, nextAnchorName } from './anchors';
import { axleSpinAxis, buildWheelPart, faceWheelFit, mirroredCenters } from './wheelMount';
import { useStudioModel, type StudioModel, type StudioPart } from './studioModel';
import { glbToEditMesh, objToEditMesh, base64ToBytes } from './importMesh';
import { cookProp, type PropDescriptorInput } from './cookedAsset';
import { seedMeshFromPiece, seedNameFromPiece } from './seedFromPiece';
import { useCookedAssets } from './cookedAssets';
import { StudioOutliner } from './Outliner';
import { SceneTextureAtlas, STUDIO_TEXTURE_KEY } from './TextureAtlas';
import { BackdropSurface, BackdropsPanel, backdropQuad, backdropTexKey, defaultBackdropPos, imageDims, type Backdrop } from './Backdrops';
import * as localstore from '@reactjit/hooks/localstore';
import { textureizeScene, rasterizeAtlas, DEFAULT_TEXTURE_OPTIONS, PIXEL_DENSITIES, type TextureOptions, type TextureType, type RasterSlice } from './textureize';
import { encodePng } from './png';
import { exists, listDir, mkdir, readFile, readFileBase64, writeFileBase64Atomic } from '@reactjit/hooks/fs';
import { bytesToBase64, base64ToBytes } from '@reactjit/workspace';
import { useAssistant } from '@reactjit/hooks/useAssistant';
import { processCwd } from '../../assist3d/scene';
import { buildTexturePrompt, enhanceViaNano, generateTexture, getNanoKey, setNanoKey, hashHex, pngDataUrl, stripDataUrl, ENHANCE_SYSTEM } from './textureGen';
import { useFrameProbe } from './frameProbe';
import {
  SelectionOverlay, makeProjector, orbitalEyeJS, pickElement, applyPick, emptySelection, selectionCount,
  type SelMode, type Selection, type CameraSnap,
} from './meshSelect';
import { pickFaceCell, pickFaceUV, paintUVsNeedRepack, brushCells, faceCellGrid, resamplePaint, PAINT_CELL_UNITS, PAINT_GRID_UNITS, type PaintCells, type PaintTarget, type FaceHit, type FaceUVHit } from './meshPaint';
import { STUDIO_PAINT_KEY, PAINT_TEX, baseCoat, stampUV, faceIslandPx, samplePaintHex, savePaint, restorePaint, setPaintActive, paintActive, canPaintUndo, canPaintRedo, paintSnapshotBegin, paintUndo, paintRedo, clearPaintHistory, paintInited, markPaintInited } from './meshPaintTexture';
import { Paintable } from '@reactjit/runtime/primitives';
import { PaintGridOverlay } from './meshPaintOverlay';
import { PaintPanel } from './PaintPanel';
import { defaultPalette, paletteWithColor, slotById, slotColor, type Palette } from './modelStream';
import {
  TransformGizmo, NormalHandle, AXIS_DIR, axisScreen, dragWorldDistance, pickGizmoHandle, pickNormalHandle, rotationSign, selectionVertIndices, selectionFaceIndices,
  type GizmoTool, type GizmoHit,
} from './meshGizmo';
import { RigOverlay, pickRigHandle, rigHandles, type RigSel } from './meshRig';

const T = GAME_CHROME.tokens.color;
const STEP_BTN = { paddingLeft: 7, paddingRight: 7, paddingTop: 4, paddingBottom: 4, borderRadius: 5, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' } as const;
// camera-smoothing presets cycled by the 'smooth' button — 0 = direct (Blockbench).
const SMOOTH_PRESETS = [0, 24, 80, 160];
// PAINT mode palette (Phase 5c) — a compact spread; the user paints face texels with
// the active swatch. The eraser (null colour) clears cells. Brush sizes = texel diam.
const PAINT_SWATCHES = ['#d94c4c', '#e08c3a', '#e9d24a', '#5ec26a', '#4aa3ff', '#8a5bd6', '#1c1f26', '#f2f2f2'];
const PAINT_BRUSH_SIZES = [1, 2, 3, 5];

// SCALE GHOST (req_1165): a static reference figure — THE in-game player at its
// true height (collider 1.65 m, visual head-top ~2.04 m, RULED R4) — stood beside
// the model being made so the user can gauge real-world scale. Same seed as the
// game player so it IS the player; a unique cartKey so its face/skin captures don't
// collide with /test's, and rendered `intern` so it lives in the retained geometry
// buffer (no contention with the sculpted part's DYN slots).
const SCALE_FIGURE_SEED = 1;
const SCALE_FIGURE_CART_KEY = 'studio-scale';

type Vec3 = [number, number, number];
type Rect = { x: number; y: number; width: number; height: number };

// ── STUDIO tunables (P2 — named, registered, live-tunable in /settings) ───────
export const STUDIO = {
  /** the ground grid (req_0960): a clean 9-segment (gridTiles²) tile grid = one
   *  game floor (floors/walls are 3×3 tiles), 1 big tile = 1 game tile =
   *  tileMeters. ONLY the CENTER tile carries the fine subdivision. gridTiles
   *  must be ODD so a center tile exists. The center tile is a 16×16 line grid
   *  (`unitsPerTile`), Blockbench-style — that 16×16 IS the modeling unit ruler
   *  (req_0973): a 16-unit cube fills exactly one tile. */
  gridTiles: 3,
  tileMeters: 1,
  /** modeling units per tile (Blockbench's "pixels"): 16 units = 1 tile =
   *  tileMeters, and the same basis per-face UV/texels will use. The center
   *  tile's fine grid = this many lines, so 1 fine cell = 1 unit. */
  unitsPerTile: 16,
  fineDivisions: 16,
  gridLineMeters: 0.012,
  fineLineMeters: 0.006,
  gridLiftMeters: 0.001,
  /** origin axes: length + the thin square cross-section. */
  axisLengthMeters: 1,
  axisThicknessMeters: 0.02,
  /** Blockbench-ish boot framing: a 3/4 view looking slightly down. */
  bootYaw: 35,
  bootPitch: 28,
  fov: 38,
  /** orbit feel — degrees of camera turn per pixel of drag. */
  yawPerPixel: 0.4,
  pitchPerPixel: 0.32,
  // Full pole-to-pole so you can orbit UNDER the part (req_0960 — no camera
  // floor); just shy of ±90 to avoid the straight-up/down gimbal.
  minPitch: -89.9,
  maxPitch: 89.9,
  /** zoom (orbit distance) range + wheel step fraction. */
  minDistance: 0.4,
  maxDistance: 40,
  zoomStepFraction: 0.12,
  /** how tightly the boot distance frames the part (× its bounds radius). */
  fitDistanceFactor: 3.2,
  /** when the scene is empty, frame this radius so the 3×3 grid reads (grid
   *  half-extent is gridTiles·tileMeters/2 = 1.5 m). */
  emptyFitRadius: 1.6,
  /** SCALE GHOST (req_1165): clearance (meters) between the model's bounding
   *  radius and the reference figure, so the player stands just clear of the work. */
  scaleFigureGapMeters: 0.5,
  /** GLASS (req_1181): how the editor renders a face marked glass — a cool neutral
   *  architectural pane at the materials.ts Glass opacity (0.34). */
  glassColor: '#a9cbe0',
  glassOpacity: 0.34,
  /** WHEEL (req_1206): a generated tire's WIDTH as a fraction of its fitted radius,
   *  and its tread facet count — low-poly to match the era. Resize after if needed. */
  wheelWidthFraction: 0.5,
  wheelSides: 16,
  /** DETACH PANEL (req_1218): peel a selected face-group off the body into its own
   *  thin solid part (hood/door/trunk/light housing). `thickness` = how far the inner
   *  skin sits behind the outer skin (the panel's depth), on the 16-units basis. */
  shellThicknessMeters: 2 / 16,
  /** MIRROR (req_1183/1186): symmetric editing reflects edits across any enabled
   *  part-local plane at coord 0 — X (left↔right), Y (up↔down), Z (front↔back),
   *  multi-select for combined symmetry. The active planes live in twig state. */
  mirrorAxisLabels: ['X', 'Y', 'Z'] as const,
  mirrorAxisColors: ['#e0584e', '#5ec26a', '#4aa3ff'] as const,
  /** the SELECTED face is shaded this vivid color (req_0986) — distinct from the
   *  pastel part tints so the active face is unmistakable. */
  selectFaceColor: '#ff8a3d',
  /** push the face-highlight overlay out along the face normal so it sits just
   *  above the surface without z-fighting (meters). */
  selectFacePushMeters: 0.004,
  /** extrude's default lip: Blockbench's "Extend 1" = 1 unit on the 16-units
   *  basis (1/16 m). The button commits this thin extrusion; the move gizmo then
   *  pulls the cap in/out (req_1015). */
  extrudeMeters: 1 / 16,
  /** BEVEL (req_1265): the chamfer width a single 'bevel' commits — 2 modeling units
   *  on the 16-units basis, a visible chamfer the gizmo can then shape. */
  bevelMeters: 2 / 16,
  /** gizmo STEP (req_1023): every gizmo drag (move / resize / loop-cut slide)
   *  SNAPS by default — no modifier = whole modeling units, Shift = a finer step,
   *  Alt = freeform (no snap). On the 16-units basis 1 unit = 1/16 m. */
  gizmoStepMeters: 1 / 16,        // default: 1 modeling unit
  gizmoStepFineMeters: 1 / 64,    // Shift: a quarter unit
  /** uniform (center-hub) resize snaps the SCALE FACTOR instead of a distance. */
  gizmoUniformStep: 0.1,
  gizmoUniformStepFine: 0.05,
  /** rotate snaps in DEGREES — default 15° (orientation-friendly), Shift = 1°. */
  rotateStepDeg: 15,
  rotateStepFineDeg: 1,
  /** host camera smoothing (per-second ease). 0 = DIRECT 1:1 tracking, like
   *  Blockbench (no momentum/lag) — the default after the spin-feel hunt found
   *  the smoothing ease (24/s ≈ 42 ms lag) was the "skip"/float, not fps. The
   *  'smooth' button cycles presets live so the feel can be dialed in. */
  cameraSmoothing: 0,
  /** TEXTURE MAPPING (req_1062): the box-net atlas is rendered into one offscreen
   *  StaticSurface at this pixel resolution and the active part samples it via
   *  `textureKey` — so the UV→atlas→mesh mapping is visible on the 3D model
   *  (painting the atlas is the deferred next step). `textureCheckerCells` = the
   *  UV-test checkerboard density across the square (reads scale/stretch/seams). */
  textureAtlasPx: 512,
  textureCheckerCells: 8,
  /** PAINT mode (req_1203): throttle the atlas re-bake while a stroke is live — dabs
   *  land in a ref every mouse-move, the atlas re-bakes at most once per this many ms
   *  (the cutout painter's clock), so painting is smooth instead of re-rendering per dab. */
  paintBakeMs: 70,
  /** PAINT grid (req_1207, USER): a FIXED default grid the whole texture is divided
   *  into — NOT the model-size-dependent packed atlas resolution (which ballooned to
   *  1024 for a car, making each paint cell sub-pixel + invisible). A face sits on this
   *  global grid and clips cells at its edges (a triangle cuts through squares). 64² →
   *  4px cells on the 256px atlas, clearly visible. */
  paintGridCells: 64,
  /** PAINT cell (the corrected painter, req_1288): the uniform model-surface cell
   *  size in MODEL UNITS (16 units = 1 m), so a cell is the SAME world size on every
   *  face regardless of its atlas slot (no slivers). 2 units ≈ 0.125 m ≈ 8 cells/m. */
  paintCellUnits: 2,
  /** PAINT atlas resolution (req_1299): the paint cells are world-uniform now and
   *  INDEPENDENT of the atlas (the old `paintGridCells` fit is obsolete) — but the
   *  bake still renders into the per-face atlas slot, so the atlas must be big enough
   *  that a many-face model (a gun) gives each face real texels instead of flooring
   *  to 1 (which overlapped slots → paint landed nowhere visible). Fit the pack to
   *  this many texels so slots are well-resolved. */
  paintAtlasTexels: 1024,
  /** PAINT stroke (req_1207): a drag interpolates dabs every this-many screen px from
   *  the last point, so a fast stroke fills continuously instead of leaving gaps. */
  paintStrokeStepPx: 4,
  /** AI TEXTURE FILL (req_1070/1110, Phase 5d): the square px the image model
   *  generates at. Kept at atlas scale (NOT the model's 4096² default) so img2img
   *  results stay light; the atlas downscales them into the slot on render. */
  aiTextureSize: 1024,
  /** a re-uploaded / AI texture at or under this many bytes rides INLINE as a data:
   *  URL on the twig; anything larger is written to a content-addressed cache file
   *  and referenced by PATH instead (req_1110 — keeps big textures out of the twig
   *  while staying cache-correct, since the path's hash changes with content). */
  textureInlineMaxBytes: 256 * 1024,
  /** default text model for prompt enhancement via nano-gpt (req_1113) — any
   *  nano-gpt text model id works; the field is editable. */
  aiTextModel: 'openai/gpt-5.1',
  /** default image model for AI texture fill — any nano-gpt image model id works
   *  (seedream / nano-banana / riverflow / wan …); the field is editable. */
  aiImageModel: 'seedream-v4',
} as const;

editorTunables().register({
  system: 'studio-viewport', route: '/model', table: STUDIO,
  specs: {
    tileMeters: { label: 'tile (m)', min: 0.25, max: 8, step: 0.25, precision: 2 },
    fineDivisions: { label: 'center subdiv', min: 2, max: 32, step: 1, precision: 0 },
    bootYaw: { label: 'boot yaw°', min: -180, max: 180, step: 1, precision: 0 },
    bootPitch: { label: 'boot pitch°', min: -85, max: 85, step: 1, precision: 0 },
    fov: { label: 'fov°', min: 20, max: 80, step: 1, precision: 0 },
    yawPerPixel: { label: 'yaw / px', min: 0.05, max: 1.5, step: 0.01, precision: 2 },
    pitchPerPixel: { label: 'pitch / px', min: 0.05, max: 1.5, step: 0.01, precision: 2 },
    fitDistanceFactor: { label: 'fit dist ×r', min: 1.5, max: 6, step: 0.1, precision: 1 },
  },
});

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Same rig handle? (the pivot is singular; joints compare by name.) */
function sameRigSel(a: RigSel | null, b: RigSel | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind !== 'joint' || a.name === (b as { kind: 'joint'; name: string }).name;
}

/** A fresh joint name unique within the mesh: joint_1, joint_2, … (req_1025). */
function nextJointName(mesh: EditMesh): string {
  const used = new Set((mesh.mounts ?? []).map((m) => m.name));
  for (let i = 1; ; i += 1) { const n = `joint_${i}`; if (!used.has(n)) return n; }
}

/** Snap a value to the gizmo step grid (req_1023): no modifier → `step`, Shift →
 *  `fine`, Alt → freeform (returned unchanged). Used by every gizmo drag so the
 *  default is stepped, never freeform. */
function snapToStep(value: number, step: number, fine: number, mods: { shift: boolean; alt: boolean }): number {
  if (mods.alt) return value;
  const s = mods.shift ? fine : step;
  return s > 0 ? Math.round(value / s) * s : value;
}

/** modeling units → world meters: 16 units = 1 tile = tileMeters (req_0973). */
function unitsToMeters(u: number): number {
  return (u * STUDIO.tileMeters) / STUDIO.unitsPerTile;
}
/** world meters → modeling units (the inverse — the gizmo readout speaks units). */
function metersToUnits(m: number): number {
  return (m * STUDIO.unitsPerTile) / STUDIO.tileMeters;
}
/** a compact signed unit string for the drag readout: "+3u", "−2.5u", "+0u". */
function fmtUnits(u: number): string {
  const r = Math.round(u * 100) / 100;
  const abs = Math.abs(r);
  const body = Number.isInteger(abs) ? abs.toFixed(0) : String(abs);
  return `${r < 0 ? '−' : '+'}${body}u`;
}

function nowMs(): number {
  return (globalThis as any).performance?.now?.() ?? Date.now();
}

/** schedule one frame — host rAF if present, else a 16 ms timer (the cart V8
 *  host has no requestAnimationFrame, per reactjit_no_raf). */
function schedFrame(fn: () => void): void {
  const h = globalThis as any;
  if (h.requestAnimationFrame) h.requestAnimationFrame(fn); else setTimeout(fn, 16);
}

/** Where a part rests: lift its lowest vert to y=0 (sits ON the grid), and its
 *  rendered vertical span. Parts authored centered at origin → lift by half. */
function partPlacement(mesh: EditMesh): { lift: number; height: number } {
  let lo = Infinity, hi = -Infinity;
  for (const v of mesh.verts) { lo = Math.min(lo, v[1]); hi = Math.max(hi, v[1]); }
  if (!Number.isFinite(lo)) return { lift: 0, height: 0 };
  return { lift: -lo, height: hi - lo };
}

type LoopCutAxis = { axis: 0 | 1 | 2; lo: number; hi: number; sizeMeters: number; sizeUnits: number; unitsPerMeter: number };

/** Resolve the loop-cut axis from the clicked face + direction. The cut SPLITS
 *  the selected face, so the axis is one of the face's two IN-PLANE axes (NOT its
 *  normal — cutting ⟂ the normal would slab toward the face and leave it whole).
 *  Direction 0/1 picks which in-plane axis, matching Blockbench (req_0990). */
function loopCutAxisInfo(mesh: EditMesh, faceIndex: number, dir: 0 | 1): LoopCutAxis | null {
  const face = mesh.faces[faceIndex];
  if (!face) return null;
  const n = faceNormal(mesh, face);
  const na: 0 | 1 | 2 = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0 : Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2;
  const inPlane = ([0, 1, 2] as (0 | 1 | 2)[]).filter((a) => a !== na); // the face's two edge axes
  const axis = inPlane[dir] ?? inPlane[0];
  // The span is the SELECTED FACE's extent on the cut axis — NOT the whole mesh —
  // so a cut on an already-cut half subdivides THAT half (req_1006). Using the
  // whole mesh placed the second cut at the first cut's plane → no visible change.
  let lo = Infinity, hi = -Infinity;
  for (const vi of face.loop) { const v = mesh.verts[vi]; if (v[axis] < lo) lo = v[axis]; if (v[axis] > hi) hi = v[axis]; }
  const unitsPerMeter = STUDIO.unitsPerTile / STUDIO.tileMeters;
  return { axis, lo, hi, sizeMeters: hi - lo, sizeUnits: (hi - lo) * unitsPerMeter, unitsPerMeter };
}

/** After a loop cut, the selected face has split into pieces all carrying tag 1;
 *  keep just ONE — the piece on the −axis (lo) side — so the selection halves
 *  with the face (and shrinks as offset rises) instead of re-covering it whole. */
function lcKeptFace(cutMesh: EditMesh, axis: 0 | 1 | 2): number {
  const tagged = facesWithTag(cutMesh, 1);
  if (tagged.length <= 1) return tagged[0] ?? -1;
  let best = tagged[0], bestC = Infinity;
  for (const i of tagged) { const c = faceCentroid(cutMesh, cutMesh.faces[i])[axis]; if (c < bestC) { bestC = c; best = i; } }
  return best;
}

// ── Staging: a ground grid + origin axes as Scene3D content ───────────────────
// These will graduate to host-rendered, screen-stable overlays (Part 4b); for
// the hot-reload first slice they are thin Scene3D boxes so the stage reads now.

function GroundGrid() {
  const lines = useMemo(() => {
    const out: { key: string; pos: Vec3; size: Vec3; color: string }[] = [];
    const tiles = STUDIO.gridTiles;
    const tile = STUDIO.tileMeters;
    const total = tiles * tile;
    const half = total / 2;
    const lift = STUDIO.gridLiftMeters;
    const bw = STUDIO.gridLineMeters;
    const fw = STUDIO.fineLineMeters;
    const big = '#41526e';
    const fine = '#283648';
    for (let i = 0; i <= tiles; i += 1) {
      const p = -half + i * tile;
      out.push({ key: `bx${i}`, pos: [p, lift, 0], size: [bw, bw, total], color: big });
      out.push({ key: `bz${i}`, pos: [0, lift, p], size: [total, bw, bw], color: big });
    }
    const c = tile / 2;
    const step = tile / STUDIO.fineDivisions;
    for (let i = 1; i < STUDIO.fineDivisions; i += 1) {
      const p = -c + i * step;
      out.push({ key: `fx${i}`, pos: [p, lift, 0], size: [fw, fw, tile], color: fine });
      out.push({ key: `fz${i}`, pos: [0, lift, p], size: [tile, fw, fw], color: fine });
    }
    return out;
  }, []);
  return (
    <>
      {lines.map((l) => (
        <Scene3D.Mesh key={l.key} geometry={Geom.box} params={{ width: l.size[0], height: l.size[1], depth: l.size[2] }} material={{ color: l.color, opacity: 0.85 }} position={l.pos} />
      ))}
    </>
  );
}

function OriginAxes() {
  const len = STUDIO.axisLengthMeters;
  const th = STUDIO.axisThicknessMeters;
  const half = len / 2;
  return (
    <>
      <Scene3D.Mesh geometry={Geom.box} params={{ width: len, height: th, depth: th }} material="#e0584e" position={[half, 0, 0]} />
      <Scene3D.Mesh geometry={Geom.box} params={{ width: th, height: len, depth: th }} material="#5ec26a" position={[0, half, 0]} />
      <Scene3D.Mesh geometry={Geom.box} params={{ width: th, height: th, depth: len }} material="#4aa3ff" position={[0, 0, half]} />
    </>
  );
}

// A minimal box geometry def (a unit cube) for the staging lines/axes.
const Geom = { box: require('@reactjit/geometries').Box };

// HOST-OWNED DRAG readout (req_1270): a self-ticking tooltip for the gizmo move
// step amount. The gizmo drag streams to the host with ZERO setState, so the
// readout can't come from React state — it reads the live text + grab anchor from
// refs and re-projects every 33ms, exactly like SelectionOverlay. Mounted only
// while a gizmo drag is active (rig/loop-cut keep the inline state readout).
function DragReadout(props: { textRef: { current: string | null }; anchorRef: { current: MV3 | null }; camSnap: () => CameraSnap }) {
  const repaint = useRerender();
  useInterval(repaint, 33);
  const text = props.textRef.current;
  const anchor = props.anchorRef.current;
  if (!text || !anchor) return null;
  const p = makeProjector(props.camSnap())(anchor);
  if (!p.front) return null;
  return (
    <Box style={{ position: 'absolute', left: p.x + 14, top: p.y - 34, paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRadius: 5, backgroundColor: '#0b1320ee', borderWidth: 1, borderColor: '#5b8fd6' }}>
      <Text fontSize={11} color="#cfe2ff" style={{ fontFamily: 'monospace', fontWeight: '800' }}>{text}</Text>
    </Box>
  );
}

// ── The viewport ─────────────────────────────────────────────────────────────

export function StudioViewport(props: { parts: StudioPart[]; revision: number; meshRev: number; activeName: string | null; sceneName: string | null; partCount: number; activePart: StudioPart | null; onEditMesh: (id: string, mesh: EditMesh) => void; onAddPart: (mesh: EditMesh, name: string, lift?: number) => string; onMergeActive: () => void; mergeTargetName: string | null; onSelectFaces: (ids: number[]) => void; palette: Palette | null; onEditPaint: (id: string, paint: PaintCells) => void; onSetPalette: (p: Palette) => void; paintRef: string | null; paintBlob: (ref: string | null) => string | null; onBakePaint: (paintRef: string, blobB64: string) => void }) {
  const { parts, revision, activePart, onSelectFaces } = props;

  // Lower each visible part once per structural revision (camera drags + fov
  // tweaks don't bump `revision`, so they never re-bake the geometry).
  // Bake the per-part Scene3D inputs (def / dynamicKey / material / position) so
  // they keep a STABLE identity across viewport re-renders — a new inline
  // `material={{…}}` or `position={[…]}` each render stamps the mesh UPDATE-dirty
  // and re-bakes it (the static_surface_inline_props_rebake trap). Only a
  // structural change (revision) rebuilds these.
  const placed = useMemo(
    () => parts.map((part, index) => ({
      key: part.id,
      // dynamicKey MUST carry the '~<version>' separator or the host drops the
      // mesh. The slot id (before '~') is the RENDER INDEX, not the part id, so the
      // host's 48 DYN_SLOTS are REUSED across parts/models instead of leaking one
      // per part ever created (the slots never free — req_1008 'no highlight after
      // new'). The version part (id+version) re-uploads when the part at this slot
      // changes or edits.
      def: { id: `studio.${part.id}`, generate: () => part.geo, defaults: {} },
      dynKey: `studio.s${index}~${part.id}.${part.version}`,
      material: { color: part.color },
      // GLASS (req_1181): the part's translucent faces lowered as a separate
      // see-through pass over the opaque mesh. null when the part has no glass.
      glassDef: part.glassGeo ? { id: `studio.glass.${part.id}`, generate: () => part.glassGeo!, defaults: {} } : null,
      glassDynKey: `studio.g${index}~${part.id}.${part.version}`,
      // lift is FROZEN at mint (studioModel) — editing verts moves them in place,
      // never re-seats the whole part on the grid.
      position: [0, part.lift, 0] as Vec3,
    })),
    // rebuild on a structural change (revision) OR a committed mesh edit (meshRev);
    // both are stable numbers, so the per-render-fresh `parts` array never re-bakes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revision, props.meshRev],
  );

  // The staging (grid + axes) is built ONCE — a memoized element keeps the same
  // reference across every viewport re-render, so React skips reconciling the
  // 26 grid-line meshes (each with inline params/material) on fov tweaks, the
  // diag poll, etc. Without this the staging re-bakes on every parent render.
  const staging = useMemo(() => (<><GroundGrid /><OriginAxes /></>), []);

  // Frame the combined bounds (or the grid when empty).
  const frame = useMemo(() => {
    let radius = 0, top = 0;
    for (const part of parts) {
      radius = Math.max(radius, part.geo.bounds.radius || 0);
      top = Math.max(top, partPlacement(part.mesh).height);
    }
    return { radius: radius > 0 ? radius : STUDIO.emptyFitRadius, target: [0, top / 2, 0] as Vec3 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);
  const target = frame.target;
  const fitDistance = () => clamp(frame.radius * STUDIO.fitDistanceFactor, STUDIO.minDistance, STUDIO.maxDistance);

  // ALL-PARTS anchor (req_1287): the WORLD centroid of every part's verts (each part
  // lifted by its own `lift`), so the all-parts gizmo scales/rotates the assembly
  // about one shared point. Re-derived on a structural / committed-edit change only.
  const allAnchorWorld = useMemo<MV3 | null>(() => {
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const part of parts) for (const v of part.mesh.verts) { sx += v[0]; sy += v[1] + part.lift; sz += v[2]; n += 1; }
    return n > 0 ? [sx / n, sy / n, sz / n] : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, props.meshRev]);

  // SCALE GHOST (req_1165): the reference player, built ONCE (the seed/outfit never
  // change here), stood to the +X side of the model just clear of its bounds with
  // feet on the grid. Toggled by the 'scale' button; interned so the static figure
  // doesn't compete for the sculpt DYN slots. Twig state (survives hot reload).
  const [showScale, setShowScale] = useHotState('studio:showScale', false);
  // BACKDROPS (req_1280): reference images you trace over while modeling. Persisted
  // to DISK-backed localstore (req_1283) — NOT useHotState, which currently wipes on
  // every hot reload (see Present memory), so a reload was blowing away the image +
  // its placement. localstore survives both reload AND restart, and you don't want to
  // re-import a blueprint each session anyway. The setup panel + the gizmo selection
  // (req_1285) are transient. See ./Backdrops.tsx.
  const BACKDROPS_KEY = 'studio:backdrops';
  const [backdrops, setBackdropsState] = useState<Backdrop[]>(() => localstore.getJson<Backdrop[]>(BACKDROPS_KEY, []));
  const setBackdrops = (u: Backdrop[] | ((p: Backdrop[]) => Backdrop[])) =>
    setBackdropsState((prev) => { const next = typeof u === 'function' ? (u as (p: Backdrop[]) => Backdrop[])(prev) : u; localstore.setJson(BACKDROPS_KEY, next); return next; });
  const [backdropPanel, setBackdropPanel] = useState(false);
  // the backdrop currently being positioned by the transform gizmo (req_1285), or null.
  const [moveBackdropId, setMoveBackdropId] = useState<string | null>(null);
  const backdropIdRef = useRef(0);
  // MIRROR (req_1183/1186): symmetric editing — a gizmo transform is reflected onto
  // each moved vert's partner across every ENABLED plane (X/Y/Z, multi-select for the
  // opposite side AND another direction at once). Stored as a bitmask in twig state.
  const [mirrorMask, setMirrorMask] = useHotState('studio:mirrorMask', 0);
  const mirrorAxes = useMemo(() => ([0, 1, 2] as (0 | 1 | 2)[]).filter((a) => mirrorMask & (1 << a)), [mirrorMask]);
  // SYMMETRY CHECK (req_1191/1192): live "is it symmetric?" badge. If a mirror plane
  // is enabled, check THAT axis; otherwise AUTO-PICK the axis the model is most
  // symmetric about (a car is symmetric left↔right, not front↔back — defaulting to X
  // mis-reported "110 off"). Memoized on the committed mesh so camera moves don't
  // recompute it. `symReport.axis` drives the badge AND the symmetrize buttons.
  const symReport = useMemo(() => {
    if (!activePart) return null;
    if (mirrorAxes.length) return { axis: mirrorAxes[0], ...symmetryReport(activePart.mesh, mirrorAxes[0]) };
    const reps = ([0, 1, 2] as (0 | 1 | 2)[]).map((a) => ({ axis: a, ...symmetryReport(activePart.mesh, a) }));
    return reps.reduce((best, r) => (r.unmatched < best.unmatched ? r : best));
  }, [activePart?.id, activePart?.version, mirrorAxes]);
  // MESH LINT (req_1224): the live health of the active part — the "your shit is
  // scuffed" badge. Memoized on the committed mesh (like symReport) so camera moves
  // don't re-lint. Drives the check badge; pressing it selects the offenders.
  const health = useMemo(() => (activePart ? meshHealth(activePart.mesh) : null), [activePart?.id, activePart?.version]);
  const scaleFigure = useMemo(() => {
    const doc = GAME_FIGURE.generateFace(SCALE_FIGURE_SEED);
    const fparts = buildPartRender(doc, GAME_FIGURE.hedDepthGrid(doc), SCALE_FIGURE_CART_KEY, SCALE_FIGURE_SEED);
    const frig = GAME_FIGURE.buildRigFrame('neutral', 'stand', 0, []);
    return { doc, parts: fparts, rig: frig };
  }, []);
  // x just past the model's bounding radius; faces -X toward the model (parts face
  // -Z at yaw 0, so +90° turns them toward −X).
  const scaleOffset = useMemo<Vec3>(() => [frame.radius + STUDIO.scaleFigureGapMeters, 0, 0], [frame.radius]);

  const lookRef = useRef({ yaw: STUDIO.bootYaw, pitch: STUDIO.bootPitch });
  const distRef = useRef(fitDistance());
  const fovRef = useRef<number>(STUDIO.fov);
  const cameraRef = useRef<any>(null);
  const ctlRef = useRef<ReturnType<typeof GAME_NATIVE_CAMERA.forNode> | null>(null);
  const rectRef = useRef<Rect>({ x: 0, y: 0, width: 1000, height: 700 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  // generation token for the compass snap tween — bumping it cancels an in-flight snap.
  const snapGenRef = useRef(0);
  // camera-angle trace (req_0964) — opt-in so it only spams when asked. The
  // trace is COALESCED to one line per frame (the flush loop below): move events
  // arrive in bursts (many at +0ms in a single JS tick), and a per-event
  // console.warn flood is itself a load that pollutes the very timing we measure.
  // Per-frame we report how many events folded in (moves), the net angle change,
  // and the worst inter-event gap — which is what actually reveals a "jump".
  const logCamRef = useRef(true);
  const lastMoveRef = useRef(0);
  const camRef = useRef({ moves: 0, startYaw: STUDIO.bootYaw, startPitch: STUDIO.bootPitch, maxGap: 0 });
  const smoothRef = useRef(STUDIO.cameraSmoothing);

  const [bootCam] = useState(() => GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, { target, yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, dist: distRef.current, zoom: 1, fov: fovRef.current }));

  // ── Element selection (req_0970): persistent mode toggle + per-mode sets ──
  // TWIG (working state, survives hot reload, reset on cold restart — the
  // branch/twig law): the tool MODE + element gizmo + rig selection + camera
  // smoothing ride hotstate so a TSX edit doesn't bounce you out of rig mode or
  // drop your selection. The rig DATA itself is BRANCH (it's on the EditMesh →
  // partMeshUpdated → persisted V20 + undoable). See [[feedback_studio_branch_twig_cold_hot]].
  const [selMode, setSelMode] = useHotState<SelMode>('studio:selMode', 'object');
  // TWIG: show the scene sprite-map texture vs solid colors (req_1062/req_1068).
  // The packed UVs are BRANCH (textureize commits them) — this is just the display.
  const [texView, setTexView] = useHotState('studio:texView', false);
  // the active scene texture's atlas params (set by the Create Texture dialog) — the
  // render reads type/color/texels off this; the UVs themselves live on the meshes.
  // imageUrl = a RE-UPLOADED whole-sheet texture (a data: URL so a same-path re-import
  // still refreshes past the host's content-hashed image cache); sliceImages = per-face
  // re-uploads keyed "partId:faceIndex"; imageRev bumps each import to force a re-bake.
  const [tex, setTex] = useHotState<{ texels: number; type: TextureType; color: string; name: string; imageUrl?: string; sliceImages?: Record<string, string>; imageRev?: number; paint?: PaintCells; paintRev?: number; paintFit?: boolean; faceSig?: string } | null>('studio:tex', null);
  // PAINT mode (the corrected painter, req_1288): you paint a SLOT id (a placement),
  // not a colour — the model palette resolves slot → colour/material. Tool prefs are
  // TWIG; the painted cells are BRANCH (on the part). `paintErase` drops cells under
  // the brush; `paintView` toggles the colourless pseudo-slot view vs the painted one.
  const [activeSlot, setActiveSlot] = useHotState<number>('studio:paintSlot', 0);
  const [paintErase, setPaintErase] = useHotState<boolean>('studio:paintErase', false);
  // FILL mode (req_1298): a click fills the WHOLE hovered face one colour — the
  // 'I just want this face one colour' path, independent of cell size.
  const [paintFill, setPaintFill] = useHotState<boolean>('studio:paintFill', false);
  // PAINT cell size in MODEL UNITS (req_1301): adjustable so a small prop (a gun) can
  // be painted at fine detail while a big surface stays coarse. Default ~1.5 cm — a
  // gun face spans several cells, so brush-1 is a dab, not a whole-face fill.
  const [paintCell, setPaintCell] = useHotState<number>('studio:paintCell', 0.06);
  const [paintView, setPaintView] = useHotState<'pseudo' | 'painted'>('studio:paintView', 'painted');
  const [paintBrush, setPaintBrush] = useHotState<number>('studio:paintBrush', 1);
  const [paintSample, setPaintSample] = useHotState<boolean>('studio:paintSample', false);
  // PERF (req_1203): the lag was setTex on EVERY mouse-move (a React re-render +
  // JSON.stringify of the whole paint map per dab). The fix — the cutout painter's
  // proven shape: dabs accumulate in a REF (zero React per move); the atlas re-bakes
  // on a THROTTLED clock (paintBakeTick); the stroke commits to tex.paint on mouse-up.
  // The hover/cursor cell rides a ref too and the grid overlay self-ticks, so hovering
  // never re-renders the viewport either. paintRef is seeded from the persisted paint.
  // paint accumulates PER PART (partId → its cell layer), seeded from each part's
  // committed paint; a stroke commits each touched part via onEditPaint (one undo entry).
  const paintRef = useRef<Record<string, PaintCells>>({});
  const touchedRef = useRef<Set<string>>(new Set());
  const paintHoverRef = useRef<FaceHit | null>(null);
  const paintDirtyRef = useRef(false);
  const paintingRef = useRef(false);
  // last painted screen point — a drag INTERPOLATES dabs along the segment to here so a
  // fast stroke fills continuously instead of leaving gaps (the "pinlines", req_1207).
  const lastPaintRef = useRef<{ x: number; y: number } | null>(null);
  const [paintBakeTick, setPaintBakeTick] = useState(0);
  // DIAGNOSTIC (req_1376/1385): the model's UV layout, shown ON SCREEN in paint mode
  // (cart console.log doesn't reach the terminal). Reveals shared/overlapping islands.
  const [paintDiag, setPaintDiag] = useState<string | null>(null);
  // the Create Texture dialog (req_1068) — transient, not a twig.
  const [texDialog, setTexDialog] = useState(false);
  // the import-texture dialog (req_1079): { slice } when re-uploading ONE face, else
  // the whole sheet. null = closed.
  const [importTex, setImportTex] = useState<{ slice?: RasterSlice } | null>(null);
  // the AI-fill dialog (req_1070/1110): { slice } when filling ONE face's island, else
  // the whole sheet. null = closed. Phase 5d — automated image-to-image.
  const [aiTex, setAiTex] = useState<{ slice?: RasterSlice } | null>(null);
  // a transient toast for export/import results, cleared after a moment.
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const toast = (m: string, ms = 2600) => { setExportMsg(m); setTimeout(() => setExportMsg(null), ms); };
  // the asset compiler (Part 7, req_1122): the Compile dialog cooks this Studio
  // model into a typed, content-addressed, installed game asset. Transient (twig).
  const cooked = useCookedAssets();
  const [compileOpen, setCompileOpen] = useState(false);

  // Export the sprite sheet (req_1072): rasterize the atlas (whole, or ONE slice =
  // a selected face's island) → PNG → cart/hmsc-int/exports/<name>.png. The raster
  // uses the SHARED islandColorFor, so the PNG matches the model + the UV panel.
  // Named by the SCENE/model name (NOT the dialog's 'texture' default) + a numeric
  // suffix when the file exists, so exports never silently overwrite (req_1076).
  const exportSprite = (slice?: RasterSlice) => {
    if (!tex) return;
    const parts = props.parts.map((p) => ({ id: p.id, mesh: p.mesh }));
    const img = rasterizeAtlas(parts, tex.texels, tex.type, tex.color, slice);
    const png = encodePng(img.rgba, img.width, img.height);
    const clean = (s: string) => s.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '');
    // prefer the scene (model) name; fall back to the texture name, then 'texture'.
    const base = clean(props.sceneName || tex.name || 'texture') || 'texture';
    const stem = slice ? `${base}_face${slice.faceIndex}` : base;
    mkdir('cart/hmsc-int/exports');
    // pick the first free filename so we don't overwrite an earlier export.
    let path = `cart/hmsc-int/exports/${stem}.png`;
    for (let i = 1; exists(path) && i < 1000; i += 1) path = `cart/hmsc-int/exports/${stem}_${i}.png`;
    const ok = writeFileBase64Atomic(path, bytesToBase64(png));
    console.warn(ok ? `[studio] exported ${path} (${img.width}×${img.height})` : `[studio] export failed: ${path}`);
    setExportMsg(ok ? `saved ${path} (${img.width}×${img.height})` : 'export failed');
    setTimeout(() => setExportMsg(null), 2600);
  };

  // Turn raw base64 PNG bytes into an <Image> source for the atlas. SMALL textures ride
  // INLINE as a data: URL (the req_1079 path); LARGE ones are written to a content-
  // addressed cache file and referenced by PATH (req_1110) — keeping big textures out
  // of the twig. The host image cache is keyed on the source bytes, so the hash in the
  // filename makes the path change with content (a bare reused path would go stale).
  const texSource = (b64: string): string => {
    const approxBytes = Math.floor(b64.length * 0.75);
    if (approxBytes <= STUDIO.textureInlineMaxBytes) return pngDataUrl(b64);
    const dir = 'cart/hmsc-int/exports/.cache';
    mkdir(dir);
    const path = `${dir}/tex_${hashHex(b64)}.png`;
    if (!exists(path)) writeFileBase64Atomic(path, b64);
    return path;
  };

  // BACKDROPS (req_1280): load a reference image off disk → an <Image> source (the
  // same inline/cache split as textures, texSource) → a backdrop on the default
  // plane. The picture's pixel size (read straight from the PNG/JPEG header) sets
  // the quad's aspect so it traces without stretch. The default plane cycles per
  // add so a front/side/top set lands on three different walls automatically.
  // each new backdrop lands on the next plane in this cycle so a front/side/top set
  // auto-distributes onto different walls (the gizmo nudges from there).
  const BACKDROP_PLANE_CYCLE = ['front', 'left', 'top', 'back', 'right', 'bottom'] as const;
  const addBackdrop = (rawPath: string) => {
    const path = rawPath.trim();
    if (!path) return;
    if (!exists(path)) { toast(`not found: ${path}`); return; }
    const b64 = readFileBase64(path);
    if (!b64) { toast(`could not read: ${path}`); return; }
    const dims = imageDims(base64ToBytes(b64));
    const aspect = dims ? dims.w / dims.h : 1;
    const plane = BACKDROP_PLANE_CYCLE[backdrops.length % BACKDROP_PLANE_CYCLE.length];
    backdropIdRef.current += 1;
    const id = `bd${Math.floor(nowMs())}_${backdropIdRef.current}`;
    const name = (path.split('/').pop() || path).slice(0, 40);
    const bd: Backdrop = {
      id, name, source: texSource(b64), aspect,
      plane, scale: 4, pos: defaultBackdropPos(plane), opacity: 0.5, flipU: false, visible: true,
    };
    setBackdrops((list) => [...list, bd]);
    setBackdropPanel(true);
    toast(`backdrop · ${name}${dims ? ` (${dims.w}×${dims.h})` : ''} — hit Move to place it`);
  };
  const updateBackdrop = (id: string, patch: Partial<Backdrop>) =>
    setBackdrops((list) => list.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const removeBackdrop = (id: string) => {
    setBackdrops((list) => list.filter((b) => b.id !== id));
    setMoveBackdropId((cur) => (cur === id ? null : cur));
  };
  // start positioning a backdrop with the gizmo (req_1285): select it + close the
  // panel so the viewport (and its gizmo) is reachable.
  const startMoveBackdrop = (id: string) => { setMoveBackdropId(id); setBackdropPanel(false); };
  const moveBackdrop = moveBackdropId ? backdrops.find((b) => b.id === moveBackdropId && b.visible) ?? null : null;
  // The visible backdrops, lowered to renderable quads. Geometry re-bakes only when a
  // SHAPE field changes (plane/scale/aspect/flip) — NOT pos (applied via the mesh
  // `position`) and NOT camera moves, so orbiting + dragging never re-bake geometry.
  const backdropSig = backdrops.map((b) => `${b.id}:${b.visible ? 1 : 0}:${b.plane}:${b.scale}:${b.aspect}:${b.flipU ? 1 : 0}`).join('|');
  const backdropQuads = useMemo(
    () => backdrops.filter((b) => b.visible).map((b) => ({ id: b.id, geo: backdropQuad(b) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [backdropSig],
  );

  // Drop an <Image> source onto the tex twig — a whole-sheet replaces `imageUrl`, a
  // SLICE drops into its `sliceImages` slot (the cookie cutter is automatic: every face
  // samples only its UV slot). The one composite tail for BOTH re-upload + AI fill.
  const applyTextureImage = (url: string, slice?: RasterSlice) => {
    if (!tex) return;
    const rev = (tex.imageRev ?? 0) + 1;
    if (slice) {
      const key = `${slice.partId}:${slice.faceIndex}`;
      setTex({ ...tex, sliceImages: { ...(tex.sliceImages ?? {}), [key]: url }, imageRev: rev });
    } else {
      setTex({ ...tex, imageUrl: url, imageRev: rev });
    }
    setTexView(true);
  };

  // Read an atlas <Image> source (a data: URL OR a cache file path, per texSource) back
  // to raw base64 — so a prior upload/generation can be re-fed as an img2img reference.
  const sourceToB64 = (src: string): string =>
    src.startsWith('data:') ? stripDataUrl(src) : (readFileBase64(src) || '');

  // The CURRENT atlas art as base64, for an img2img reference (req_1070): a prior
  // upload/generation if one exists (so the model iterates on it), else the procedural
  // island raster (the shape + colors guide the result). Atlas-sized → small payload.
  const referenceB64 = (slice?: RasterSlice): string => {
    if (slice) {
      const cur = tex?.sliceImages?.[`${slice.partId}:${slice.faceIndex}`];
      if (cur) return sourceToB64(cur);
    } else if (tex?.imageUrl) {
      return sourceToB64(tex.imageUrl);
    }
    const parts = props.parts.map((p) => ({ id: p.id, mesh: p.mesh }));
    const img = rasterizeAtlas(parts, tex!.texels, tex!.type, tex!.color, slice);
    return bytesToBase64(encodePng(img.rgba, img.width, img.height));
  };

  // Re-upload a texture (req_1079): read a PNG off disk → an atlas <Image> source (inline
  // or cached, texSource) → the shared composite tail. The model captures it because every
  // face samples ONLY its UV slot (the cookie cutter): a whole-sheet upload slips back into
  // place, overshoot ignored; a SLICE upload drops one regenerated island into its slot.
  const importTexture = (pngPath: string, slice?: RasterSlice) => {
    if (!tex) return;
    const path = pngPath.trim();
    if (!path) { toast('enter a .png path', 2200); return; }
    if (!exists(path)) { toast(`not found: ${path}`); return; }
    const b64 = readFileBase64(path);
    if (!b64) { toast(`could not read: ${path}`); return; }
    applyTextureImage(texSource(b64), slice);
    setImportTex(null);
    toast(`loaded ${path}${slice ? ` → face ${slice.faceIndex}` : ''}`);
  };

  const [sel, setSel] = useState<Selection>(emptySelection);
  // mouse-press events don't carry modifier flags here — held shift/ctrl come
  // from the key bus (req_0979). This is the same ref IsoAuthor uses.
  const heldMods = useHeldModifiers();
  // selection is per-part — drop it when the active part changes.
  useEffect(() => { setSel(emptySelection()); }, [activePart?.id]);
  // publish the selected faces to the shared store so the UV panel scopes to the
  // selected face's island (Part 5.2) — only meaningful in face mode.
  useEffect(() => {
    onSelectFaces(selMode === 'face' ? [...sel.faces].sort((a, b) => a - b) : []);
  }, [sel, selMode, onSelectFaces]);

  // BACKDROP drag (req_1285): the in-flight gizmo grab for the active backdrop —
  // which axis, its start-frozen screen frame, and the backdrop's start position.
  // A self-contained parallel to gizmoDragRef/rigDragRef; commits straight to pos.
  const backdropDragRef = useRef<null | { id: string; axis: { dx: number; dy: number; pxPerUnit: number }; unit: MV3; startCx: number; startCy: number; startPos: MV3 }>(null);
  const [backdropDragAxis, setBackdropDragAxis] = useState<GizmoHit | null>(null);

  // ALL-PARTS transform (req_1287): object mode normally moves/resizes only the
  // ACTIVE part about ITS own centroid — resizing each layer one at a time scales
  // them toward different centers and breaks the assembly. With this ON, the object
  // gizmo grabs EVERY part at once and transforms them about the model's COMMON
  // centroid, so the whole thing scales/moves/rotates as one and proportions hold.
  // Twig state (req_1692): the choice STICKS across hot reloads so you set "all
  // layers" once and keep it — the prior per-session reset is why the buried
  // toggle felt missing.
  const [allParts, setAllParts] = useHotState('studio:allParts', false);
  // the in-flight all-parts grab: the frozen common anchor + screen frame + each
  // part's start mesh. A self-contained parallel to gizmoDragRef.
  const multiGizmoDragRef = useRef<null | {
    tool: GizmoTool; hit: GizmoHit; anchorW: MV3; anchorScreen: { x: number; y: number };
    axis: { dx: number; dy: number; pxPerUnit: number }; startCx: number; startCy: number; startScreenDist: number; rotSign: number; combinedHalfExt: number;
    parts: { id: string; startMesh: EditMesh; lift: number }[]; last?: Record<string, EditMesh>;
  }>(null);
  // live preview of an all-parts drag: each part's worked mesh, swapped into the
  // rendered list (commit-on-release, like the single-part draft). Parts are few, so
  // re-lowering them per move is cheap enough for an occasional whole-model resize.
  const [multiDraft, setMultiDraft] = useState<{ meshes: Record<string, EditMesh>; seq: number } | null>(null);

  // ── Transform gizmo (req_0983): move / resize the selection ──
  const [gizmoTool, setGizmoTool] = useHotState<GizmoTool>('studio:gizmoTool', 'move');
  const [activeGizmo, setActiveGizmo] = useState<GizmoHit | null>(null);
  // Live drag readout (req_1024): a small tooltip showing how far the active gizmo
  // has moved this drag (in modeling units), so the amount can be MIRRORED on the
  // other side for parity instead of mentally tracked. Set in onMove, cleared on up.
  const [gizmoReadout, setGizmoReadout] = useState<string | null>(null);
  // a live working copy of the dragged part — the viewport re-lowers THIS each
  // move (small mesh, cheap) and commits to the store on mouse-up, so a drag
  // never writes through the store per-move (the commit-on-release pattern; a
  // per-move mesh write would re-render the whole bench and melt the frame).
  const [draft, setDraft] = useState<{ partId: string; mesh: EditMesh; seq: number } | null>(null);
  const dragSeqRef = useRef(0);
  // HOST-OWNED LIVE DRAG (req_1270): a gizmo move/resize/rotate streams its baked
  // verts STRAIGHT to the host dyn slot every frame (patchDynSlot) and writes the
  // live mesh + readout to refs — ZERO setState per move. The draft is mounted
  // ONCE at grab (to claim the slot) and committed ONCE on release; in between,
  // React never re-renders the bench. Without this every move re-lowered geometry,
  // bumped the dynKey, and forced a reconciler upload — a setState storm that froze
  // the app even on a single cube (the camera orbit already does this right by
  // shipping deltas to camera.zig per frame; the drag now matches it).
  const liveDragMeshRef = useRef<EditMesh | null>(null); // the live dragged mesh (overlay reads this)
  const gizmoReadoutRef = useRef<string | null>(null);   // the live step readout text (DragReadout reads this)
  const gizmoReadoutAnchorRef = useRef<MV3 | null>(null); // world anchor the readout floats by (frozen at grab)
  const [gizmoDragActive, setGizmoDragActive] = useState(false); // mounts DragReadout; toggled at grab/release only
  // the in-flight gizmo grab (frozen at mouse-down): which handle, the verts it
  // moves, the start mesh + anchor, and the start-frozen axis screen frame (so
  // the world mapping is stable for the whole drag).
  const gizmoDragRef = useRef<null | {
    partId: string; tool: GizmoTool; hit: GizmoHit; indices: number[]; startMesh: EditMesh; mirrorAxes: (0 | 1 | 2)[];
    anchorL: MV3; anchorScreen: { x: number; y: number }; axis: { dx: number; dy: number; pxPerUnit: number };
    startCx: number; startCy: number; startScreenDist: number; halfExt: number; rotSign: number; lastMesh?: EditMesh;
  }>(null);

  // ── Rig mode (req_1025): author the part's PIVOT (rotation origin) + JOINTS ──
  // (typed sockets with a spin axis + rotation limit). The selected rig handle, a
  // live drag DRAFT of its local position (commit-on-release, like the gizmo), and
  // the in-flight grab (start-frozen axis frame, mirrors gizmoDragRef). Reuses the
  // SAME TransformGizmo + drag math — only the anchor + commit differ.
  const [rigSel, setRigSel] = useHotState<RigSel | null>('studio:rigSel', null);
  const [rigDraft, setRigDraft] = useState<{ sel: RigSel; localPos: MV3 } | null>(null);
  const [rigDragAxis, setRigDragAxis] = useState<GizmoHit | null>(null);
  const rigDragRef = useRef<null | { sel: RigSel; axis: { dx: number; dy: number; pxPerUnit: number }; unit: MV3; startCx: number; startCy: number; startLocal: MV3 }>(null);
  // A rig handle's LOCAL position, draft-aware: the live drag draft if it's the one
  // being dragged, else the stored pivot / joint position. null = the joint is gone.
  const rigLocalPos = (mesh: EditMesh, sel: RigSel): MV3 | null => {
    if (rigDraft && sameRigSel(rigDraft.sel, sel)) return rigDraft.localPos;
    if (sel.kind === 'pivot') return hasPivot(mesh) ? pivotOf(mesh) as MV3 : null; // no phantom pivot
    const mt = (mesh.mounts ?? []).find((m) => m.name === sel.name);
    return mt ? [mt.position[0], mt.position[1], mt.position[2]] : null;
  };
  // Commit a moved rig handle to the mesh (pivot → setPivot, joint → updateMount).
  // MIRROR (req_1189): with planes enabled, a dragged JOINT carries its mirror
  // partners along, so adjusting one wheel mount keeps the set symmetric.
  const commitRig = (sel: RigSel, local: MV3) => {
    if (!activePart) return;
    const m = activePart.mesh;
    if (sel.kind === 'pivot') { props.onEditMesh(activePart.id, setPivot(m, local)); return; }
    props.onEditMesh(activePart.id, mirrorAxes.length
      ? updateMountMirrored(m, sel.name, local, mirrorAxes)
      : updateMount(m, sel.name, { position: local }));
  };

  // ── Loop cut (req_0984/0985/0990): a face click → a small popup → N cuts ──
  // The clicked face + a direction (which in-plane axis) + cut count + offset,
  // splitting the SELECTED face. While the popup is open the cut is PREVIEWED
  // live (through the same draft path as the gizmo) and committed only on Apply.
  const [lc, setLc] = useState<null | { faceIndex: number; dir: 0 | 1; cuts: number; offset: number; unit: 'units' | 'percent' }>(null);
  const lcAxisInfo = lc && activePart ? loopCutAxisInfo(activePart.mesh, lc.faceIndex, lc.dir) : null;
  // ── Bevel (req_1266): chamfer a selected EDGE or VERTEX, with a live size preview ──
  // Set up like the loop cut: a 'bevel' button opens a popup bound to the picked
  // element; the chamfer is PREVIEWED live (through the same draft path) at the
  // popup's `width` (in modeling units) so you can grow/shrink it, and it commits
  // only on Apply. `index` is the edge index (into meshEdges) or the vertex index.
  const [bv, setBv] = useState<null | { kind: 'edge' | 'vertex'; index: number; width: number }>(null);
  // The previewed/committed bevel mesh at the current width — null when the op is a
  // no-op (width 0, or a non-manifold edge / degree-2 tip the chamfer declines).
  const bvMesh = (): EditMesh | null => {
    if (!bv || !activePart) return null;
    const m = activePart.mesh;
    const w = unitsToMeters(bv.width);
    const out = bv.kind === 'edge'
      ? (() => { const e = meshEdges(m)[bv.index]; return e ? bevelEdge(m, e, w) : m; })()
      : bevelVertex(m, bv.index, w);
    return out === m ? null : out;
  };
  // The widest chamfer the picked element allows, in modeling units: the bevel slides
  // each corner at most 0.45× along its edge, so the cap is the shortest incident edge
  // (× 0.45). Drives the popup's slider max so it maps 1:1 instead of going dead.
  const bevelMaxUnits = (kind: 'edge' | 'vertex', index: number): number => {
    if (!activePart) return 1;
    const m = activePart.mesh;
    const elen = (a: number, b: number) => Math.hypot(m.verts[a][0] - m.verts[b][0], m.verts[a][1] - m.verts[b][1], m.verts[a][2] - m.verts[b][2]);
    if (kind === 'edge') { const e = meshEdges(m)[index]; return e ? metersToUnits(elen(e[0], e[1]) * 0.45) : 1; }
    const inc = meshEdges(m).filter(([a, b]) => a === index || b === index);
    const minLen = inc.length ? Math.min(...inc.map(([a, b]) => elen(a, b))) : 0;
    return minLen > 0 ? metersToUnits(minLen * 0.45) : 1;
  };
  // Open the popup on the picked element, seeding the width to the default chamfer
  // (STUDIO.bevelMeters) clamped to what the element allows.
  const openBevel = (kind: 'edge' | 'vertex', index: number) => {
    const max = bevelMaxUnits(kind, index);
    const w = Math.max(0.1, Math.min(metersToUnits(STUDIO.bevelMeters), max));
    setBv({ kind, index, width: Math.round(w * 10) / 10 });
  };
  // ── Concave Auto-Fix guard (req_0949/req_1016): an edit that buckles a quad
  // into a non-convex (reflex-corner) face is ILLEGAL. Rather than silently
  // triangulating it, the commit STOPS and surfaces a dialog — the buckled mesh
  // stays previewed (the draft) so the offender is visible — and the user chooses:
  // Split Quads (recommended) / Ignore (keep it concave) / Revert (drop the edit).
  const [autoFix, setAutoFix] = useState<null | { partId: string; mesh: EditMesh; count: number }>(null);
  const resolveAutoFix = (action: 'split' | 'ignore' | 'revert') => {
    setAutoFix((af) => {
      if (af) {
        if (action === 'split') props.onEditMesh(af.partId, splitConcaveFaces(af.mesh));
        else if (action === 'ignore') props.onEditMesh(af.partId, af.mesh);
        // revert → commit nothing; the store still holds the pre-edit mesh.
      }
      return null;
    });
    setDraft(null);
  };
  // offset (in the popup's unit) → mesh-meters along the cut axis (0..size).
  const lcOffsetMetersOf = (info: LoopCutAxis, offsetUnits: number): number =>
    lc!.unit === 'percent' ? (offsetUnits / 100) * info.sizeMeters : offsetUnits / info.unitsPerMeter;
  const lcOffsetMeters = (info: LoopCutAxis): number => lcOffsetMetersOf(info, lc!.offset);
  // Build the preview: TAG the clicked face, then cut — the tag rides onto the
  // face's pieces (so the selection survives the cut, like Blockbench). lcCutMeshAt
  // takes an EXPLICIT offset so the host-owned slide (req_1277) can bake any offset
  // WITHOUT setLc (which would re-render the bench every move).
  const lcCutMeshAt = (info: LoopCutAxis, offsetUnits: number): EditMesh =>
    loopCutRange(tagOneFace(activePart!.mesh, lc!.faceIndex, 1), info.axis, info.lo, info.hi, lc!.cuts, lcOffsetMetersOf(info, offsetUnits));
  const lcCutMesh = (info: LoopCutAxis): EditMesh => lcCutMeshAt(info, lc!.offset);
  // ── Loop-cut SLIDE gizmo (req_1022): a move handle ON the cut so the offset can
  // be dragged on the model (Blockbench), not just typed in the popup. The anchor
  // sits on the (middle) cut plane; dragging the CUT-AXIS arrow drives lc.offset,
  // and the live preview + anchor follow. A separate drag ref from the vert gizmo.
  const lcDragRef = useRef<null | { axis: { dx: number; dy: number; pxPerUnit: number }; startCx: number; startCy: number; startOffset: number; info: LoopCutAxis; lastOffset?: number }>(null);
  const [lcDragAxis, setLcDragAxis] = useState<GizmoHit | null>(null);
  // The cut plane coordinate on the cut axis (the middle cut for cuts>1).
  const lcCutPlaneAt = (info: LoopCutAxis): number => {
    const ps = loopCutPositions(info.lo, info.hi, lc!.cuts, lcOffsetMeters(info));
    return ps.length ? ps[Math.floor((ps.length - 1) / 2)] : (info.lo + info.hi) / 2;
  };
  // World anchor for the slide gizmo: the face centroid pinned onto the cut plane.
  const lcGizmoAnchor: MV3 | null = (lc && lcAxisInfo && activePart && activePart.mesh.faces[lc.faceIndex])
    ? (() => {
        const info = lcAxisInfo;
        const a = faceCentroid(activePart.mesh, activePart.mesh.faces[lc.faceIndex]) as MV3;
        a[info.axis] = lcCutPlaneAt(info);
        return [a[0], a[1] + activePart.lift, a[2]] as MV3;
      })()
    : null;
  // Drive the live preview draft from the popup params. Keyed on `lc` ONLY — NOT
  // on the active part: a popup is bound to one face of one part, so switching
  // parts/models must CLOSE it (the reset effect below), never re-preview the
  // stale cut onto the new part (the "cuts persist across new" bug, req_1011).
  useEffect(() => {
    if (!lc || !activePart || !lcAxisInfo) { return; }
    dragSeqRef.current += 1;
    setDraft({ partId: activePart.id, mesh: lcCutMesh(lcAxisInfo), seq: dragSeqRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lc]);
  // Live bevel preview — re-lower the draft from the popup `width` whenever it changes
  // (same draft path as the loop cut). Keyed on `bv` only; the part-change reset below
  // tears it down so a half-open bevel never bleeds onto the next part.
  useEffect(() => {
    if (!bv || !activePart) return;
    const mesh = bvMesh();
    if (!mesh) return;
    dragSeqRef.current += 1;
    setDraft({ partId: activePart.id, mesh, seq: dragSeqRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bv]);
  // The loop-cut popup + its preview draft are transient edit state tied to the
  // ACTIVE PART. When the active part changes — selecting another part, switching
  // models, or 'new' (→ a fresh part) — tear them down so a half-open cut never
  // bleeds onto the next model (req_1011). Selection already resets on the same
  // key (above); the gizmo grab is dropped too.
  // Skip the FIRST run (mount / hot-reload remount): clearing on mount would wipe
  // the twigged rigSel/selMode that hotstate just restored. Only a REAL part change
  // tears down the transient edit state. (`prevPartId` resets to undefined on a hot
  // reload remount, so the restored twig selection survives — branch/twig law.)
  const prevPartId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const changed = prevPartId.current !== undefined && prevPartId.current !== (activePart?.id ?? null);
    prevPartId.current = activePart?.id ?? null;
    if (!changed) return;
    setLc(null);
    setBv(null);
    setDraft(null);
    setActiveGizmo(null);
    setAutoFix(null);
    lcDragRef.current = null;
    setLcDragAxis(null);
    setGizmoReadout(null);
    // rig handles are per-part too — drop the selection + any in-flight drag.
    setRigSel(null);
    setRigDraft(null);
    rigDragRef.current = null;
    setRigDragAxis(null);
    paintHoverRef.current = null;
    paintingRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePart?.id]);
  // Leaving paint mode drops the grid overlay + any in-flight stroke.
  useEffect(() => { if (selMode !== 'paint') { paintHoverRef.current = null; paintingRef.current = false; } }, [selMode]);
  // The texture (+ its paint) is per-MODEL, but the `studio:tex` twig is one global
  // store — so opening a different model used to carry the prior model's paint over
  // (req_1208). Reset the texture + paint buffer when the open model changes (NOT on
  // the first mount), so each model paints its own texture from scratch.
  const prevSceneRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const scene = props.sceneName ?? null;
    if (prevSceneRef.current !== undefined && prevSceneRef.current !== scene) {
      paintRef.current = {};
      paintHoverRef.current = null;
      setTex(null);
    }
    prevSceneRef.current = scene;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.sceneName]);
  // Entering rig mode SPAWNS the gizmo on the pivot immediately (req_1051) — the
  // pivot is always present, so default-select it so the 3-axis move gizmo is right
  // there to grab (drag the into-screen axis for depth). Runs only on mode ENTRY
  // (keyed on selMode), so Esc can still leave nothing selected while staying in rig.
  useEffect(() => {
    // select the pivot only if the part HAS one (req_1054) — a body is joints-only,
    // so don't spawn a phantom pivot gizmo; leave nothing selected to place.
    if (selMode === 'rig' && activePart) setRigSel((s) => s ?? (hasPivot(activePart.mesh) ? { kind: 'pivot' } : null));
    // turning to OBJECT mode arms ROTATE on the whole piece (USER req_1058) — the
    // common "reorient the part" move; the toggle still lets you switch to move/resize.
    if (selMode === 'object') setGizmoTool('rotate');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selMode]);
  const closeLoopCut = (commit: boolean) => {
    if (commit && lc && activePart && lcAxisInfo) {
      const cut = lcCutMesh(lcAxisInfo);
      const kept = lcKeptFace(cut, lcAxisInfo.axis); // the −side half of the split face
      props.onEditMesh(activePart.id, clearFaceTags(cut)); // store a clean mesh
      // KEEP the selection on the resulting half (index unchanged by clear).
      setSel({ verts: new Set(), edges: new Set(), faces: new Set(kept >= 0 ? [kept] : []) });
    }
    setDraft(null);
    setLc(null);
    lcDragRef.current = null;
    setLcDragAxis(null);
  };
  // Commit (Apply) or drop (Cancel) the live bevel — the chamfer at the popup's width
  // is already lowered as the draft, so Apply just stores it. Mirrors closeLoopCut.
  const closeBevel = (commit: boolean) => {
    if (commit && bv && activePart) {
      const mesh = bvMesh();
      if (mesh) { props.onEditMesh(activePart.id, mesh); setSel(emptySelection()); }
    }
    setDraft(null);
    setBv(null);
  };

  // Selection keys (a focused TextInput consumes keys before the bus, so typing a
  // name never triggers these — USER req_0978):
  //  • Esc → clear the selection (the ONE deselect-all besides picking anew).
  //  • Ctrl/Cmd+A → select EVERY element of the active mode (req_1020).
  //  • Delete/Backspace → remove the selected faces, or the faces a selected
  //    vertex/edge belongs to (Blockbench's connected-faces delete, req_1020).
  useEffect(() => {
    const off = busOn('__keydown', (e: any) => {
      const key = String(e?.key ?? '').toLowerCase();
      // Esc closes an open bevel popup first (drop the preview), like a Cancel.
      if (key === 'escape') { if (moveBackdropId) { setMoveBackdropId(null); return; } if (bv) { setBv(null); setDraft(null); return; } setSel(emptySelection()); setRigSel(null); return; }
      // RIG mode: Delete removes the selected JOINT, or drops the pivot (pivots are
      // opt-in, req_1054 — removing one makes the part joints-only again); Ctrl+A /
      // face-delete don't apply here.
      if (selMode === 'rig') {
        if ((key === 'delete' || key === 'backspace') && activePart) {
          if (rigSel?.kind === 'joint') { props.onEditMesh(activePart.id, removeMount(activePart.mesh, rigSel.name)); setRigSel(null); }
          else if (rigSel?.kind === 'pivot') { props.onEditMesh(activePart.id, clearPivot(activePart.mesh)); setRigSel(null); }
        }
        return;
      }
      if (selMode === 'object' || selMode === 'paint' || !activePart || lc || bv || autoFix) return;
      const mesh = activePart.mesh;
      if (key === 'a' && (e?.ctrlKey || e?.metaKey)) {
        if (selMode === 'face') setSel({ verts: new Set(), edges: new Set(), faces: new Set(mesh.faces.map((_, i) => i)) });
        else if (selMode === 'vertex') setSel({ verts: new Set(mesh.verts.map((_, i) => i)), edges: new Set(), faces: new Set() });
        else setSel({ verts: new Set(), edges: new Set(meshEdges(mesh).map((_, i) => i)), faces: new Set() });
        // The host's Ctrl+A ALSO lights up every text label in the whole app tree
        // (selection.zig sel_all). We handled the key for the mesh — drop that
        // app-wide highlight so it never renders (req_1058; door is a no-op on an
        // un-rebuilt host).
        callHost('__selection_clear', null);
        return;
      }
      if (key === 'delete' || key === 'backspace') {
        const faces = selectionFaceIndices(mesh, selMode, sel);
        if (faces.length === 0) return;
        props.onEditMesh(activePart.id, deleteFaces(mesh, faces));
        setSel(emptySelection());
      }
    });
    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selMode, sel, activePart?.id, activePart?.mesh, lc, bv, autoFix, rigSel, moveBackdropId]);
  // a live camera snapshot matching gpu/3d.zig (eye from camera.zig orbital math,
  // near 0.02 / fov from the Scene3D.Camera below); used by the overlay + picking.
  const camSnap = (): CameraSnap => {
    const r = rectRef.current;
    return { eye: orbitalEyeJS(target, lookRef.current.yaw, lookRef.current.pitch, distRef.current), target, fov: fovRef.current, aspect: (r.width || 1) / (r.height || 1), w: r.width || 1, h: r.height || 1, near: 0.02 };
  };

  // ── PAINT mode (Phase 5c) ──
  // every part the paint ray can hit, with its live mesh + render lift.
  const paintTargets = (): PaintTarget[] => props.parts.map((p) => ({ partId: p.id, mesh: p.mesh, lift: p.lift }));
  // Paint mode active — the PIXEL painter owns the model texture while true.
  const painting = selMode === 'paint';
  // A painted model samples its RGBA paintable in ALL modes (req_1380) — so the
  // box-atlas StaticSurface isn't needed and isn't baked for it.
  const modelPainted = !!tex && (!!props.paintRef || paintInited(props.sceneName ?? null));
  // A signature of the scene's FACE topology: parts + per-part face counts. The paint
  // atlas must allocate one distinct slot per (part, face); when this changes (a part
  // added, a face extruded/mirrored), faces created AFTER the last pack carry their
  // default full-square UV — which all overlap at one atlas region, so painting one
  // such face shows on every other (the mirrored-prong bug, req_1320). A mismatch vs
  // the packed tex's faceSig means "re-slot needed".
  const paintFaceSig = props.parts.map((p) => `${p.id}:${p.mesh.faces.length}`).join('|');
  // req_1375: faces sharing an atlas island (congruent-face dedup, or a default
  // full-square UV) make one click paint several faces. faceSig only sees the face
  // COUNT, so it can't catch a shared/default UV layout — this does. When true, the
  // pack below MUST run (dedup off) so every face owns a unique, isolated island.
  const paintRepackNeeded = painting && paintUVsNeedRepack(props.parts.map((p) => p.mesh));
  // Entering paint needs a texture (distinct per-face atlas slots — else every face
  // shares the full square and paint bleeds). Build/refresh the textureize pack, then
  // show it. Re-packs whenever the face topology changed since the last pack so NEW
  // faces always get their own slot (independently paintable).
  const ensureTexture = () => {
    // Already packed for paint AND no new faces since → just show it. The faceSig gate
    // both avoids needless re-packs and breaks the auto-ensure effect's feedback loop.
    if (tex?.paintFit && tex.name === 'paint-v4' && tex.faceSig === paintFaceSig && !paintRepackNeeded) { setTexView(true); return; }
    // PAINT pack: dedup OFF so EVERY face owns its own slot (independently paintable);
    // a SOLID neutral base so paint isn't buried in the pastel UV-debug template.
    const paintOpts = { ...DEFAULT_TEXTURE_OPTIONS, dedupIslands: false, combineIslands: false, type: 'solid' as const, color: '#c8ccd2', name: 'paint-v4' };
    const result = textureizeScene(props.parts.map((p) => p.mesh), paintOpts, STUDIO.unitsPerTile, STUDIO.paintAtlasTexels);
    // Apply only the meshes whose UVs actually changed (textureize is idempotent now),
    // so re-slotting after adding ONE face doesn't churn every part. Paint is keyed in
    // face-relative cells, so it survives a re-slot — DON'T wipe it (it was being lost
    // on every repack, req_1320); the seed effect re-reads it from the branch.
    result.meshes.forEach((mesh, i) => { if (mesh !== props.parts[i].mesh) props.onEditMesh(props.parts[i].id, mesh); });
    setTex({ ...(tex ?? {}), texels: result.texels, type: 'solid', color: '#c8ccd2', name: 'paint-v4', paintRev: (tex?.paintRev ?? 0), paintFit: true, faceSig: paintFaceSig });
    setTexView(true);
  };
  // The colour the brush lays down: the active slot resolved through the palette
  // (the painted view), the pseudo placeholder (pseudo view), or — when erasing —
  // the texture's base coat so erase reveals the background. PIXEL painter: a real
  // RGBA colour, not a slot index. (req_1372)
  const activePaintColor = (): string => {
    if (paintErase) return tex?.color ?? '#c8ccd2';
    if (paintView === 'pseudo') return slotById(livePalette, activeSlot)?.pseudo ?? '#ffffff';
    return slotColor(livePalette, activeSlot) ?? slotById(livePalette, activeSlot)?.pseudo ?? '#ffffff';
  };
  // Brush radius in TEXTURE PIXELS, from the brush-size control. The PIXEL painter
  // stamps a disc straight into the model's RGBA texture — no cell grid.
  const brushRadiusPx = (): number => Math.max(2, Math.round(3 + (paintBrush - 1) * 6));
  // Track the face under the cursor (cursor pump reads this ref). Returns a FaceHit
  // (cu/cv unused by the pixel painter) so the existing in/out hover logic is intact.
  const paintProbe = (sx: number, sy: number): FaceHit | null => {
    if (!tex) { paintHoverRef.current = null; return null; }
    const hit = pickFaceUV(paintTargets(), camSnap(), sx, sy);
    const fh = hit ? { partIndex: hit.partIndex, faceIndex: hit.faceIndex, cu: 0, cv: 0 } : null;
    paintHoverRef.current = fh;
    return fh;
  };
  const samplePaintAt = (sx: number, sy: number): FaceHit | null => {
    if (!tex) return null;
    const hit = pickFaceUV(paintTargets(), camSnap(), sx, sy);
    if (!hit) { paintHoverRef.current = null; return null; }
    const fh = { partIndex: hit.partIndex, faceIndex: hit.faceIndex, cu: 0, cv: 0 };
    paintHoverRef.current = fh;
    const hex = samplePaintHex(hit.u, hit.v);
    if (!hex) { toast('sample missed paint'); return fh; }
    const { palette, id } = paletteWithColor(livePalette, hex);
    props.onSetPalette(palette);
    setActiveSlot(id);
    setPaintErase(false);
    setPaintSample(false);
    toast(`sampled ${hex}`);
    return fh;
  };
  // Paint the texel under (sx,sy): raycast → face + interpolated UV → stamp a disc
  // of the active colour straight into the model's RGBA paint texture, SCISSOR-
  // clamped to the hit face's UV island so a round brush can't bleed onto the
  // neighbour island packed beside it. NO boxes, NO StaticSurface, NO cell grid —
  // the entire old bug class is gone (req_1372). FILL mode fills the whole face.
  const paintAt = (sx: number, sy: number): FaceHit | null => {
    if (!tex) return null;
    const hit = pickFaceUV(paintTargets(), camSnap(), sx, sy);
    if (!hit) { paintHoverRef.current = null; return null; }
    const tgt = paintTargets()[hit.partIndex];
    if (!tgt) return null;
    const island = faceIslandPx(tgt.mesh, hit.faceIndex);
    const color = activePaintColor();
    if (paintFill && island) {
      // Whole-face fill: a disc large enough to cover the island, clamped to it.
      const r = Math.hypot(island.x1 - island.x0, island.y1 - island.y0);
      stampUV((hit.u), (hit.v), color, r, island);
    } else {
      stampUV(hit.u, hit.v, color, brushRadiusPx(), island);
    }
    touchedRef.current.add(tgt.partId);
    paintDirtyRef.current = true;
    const fh = { partIndex: hit.partIndex, faceIndex: hit.faceIndex, cu: 0, cv: 0 };
    paintHoverRef.current = fh;
    return fh;
  };
  // FILL ALL (req_1352): one click to make the whole model one colour. The PIXEL
  // painter flat-fills the entire texture (every face samples it) in one clear —
  // no per-face/per-cell walk, no orphans, no leak. Erase fills the base coat.
  const fillAllFaces = () => {
    baseCoat(activePaintColor());
    for (const tgt of paintTargets()) touchedRef.current.add(tgt.partId);
    paintDirtyRef.current = true;
  };
  // Change the DETAIL grid (req_1358) — RESAMPLE every part's paint from the old cell
  // size to the new one so the picture is preserved (finer subdivides, coarser samples),
  // never scrambled. Then the bake/brush use the new grid.
  const setDetail = (next: number) => {
    if (Math.abs(next - paintCell) < 1e-6) return;
    for (const tgt of paintTargets()) {
      const p = paintRef.current[tgt.partId] ?? props.parts.find((pp) => pp.id === tgt.partId)?.paint;
      if (!p || !Object.keys(p).length) continue;
      paintRef.current[tgt.partId] = resamplePaint(tgt.mesh, p, paintCell, next);
      touchedRef.current.add(tgt.partId);
    }
    setPaintCell(next);
    paintDirtyRef.current = true;
    commitPaint();
  };
  // A drag paints a continuous STROKE: interpolate dabs along the segment from the last
  // painted point to (sx,sy), stepping a few px, so a fast move fills instead of leaving
  // gaps (the pinlines, req_1207). Each step raycasts (cheap JS, no React). The endpoint
  // hit is returned so the hover/cursor stays in sync.
  const paintStroke = (sx: number, sy: number): FaceHit | null => {
    const last = lastPaintRef.current;
    lastPaintRef.current = { x: sx, y: sy };
    if (!last) return paintAt(sx, sy);
    const dx = sx - last.x, dy = sy - last.y;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / STUDIO.paintStrokeStepPx));
    let hit: FaceHit | null = null;
    for (let i = 1; i <= steps; i += 1) hit = paintAt(last.x + (dx * i) / steps, last.y + (dy * i) / steps);
    return hit;
  };
  // Cursor pump (req_1298): a Pressable's onMouseMove only fires while a button is
  // HELD (engine.zig gates .move on dragging_left), so a free-moving cursor delivered
  // no hover → the grid overlay + hovered cell never appeared until you pressed. Poll
  // the host's live cursor (getMouseX/getMouseY) so the grid tracks on plain hover —
  // the same fix PaintCanvas uses. probeRef keeps tex/camSnap fresh (effect runs once).
  const probeRef = useRef(paintProbe);
  probeRef.current = paintProbe;
  useEffect(() => {
    if (selMode !== 'paint') return;
    const host: any = globalThis as any;
    const id = setInterval(() => {
      if (paintingRef.current) return; // a live drag is handled by onMove
      const r = rectRef.current;
      if (!r || typeof host.getMouseX !== 'function') return;
      const mx = Number(host.getMouseX()), my = Number(host.getMouseY());
      if (!Number.isFinite(mx) || !Number.isFinite(my)) return;
      if (mx >= r.x && mx <= r.x + r.width && my >= r.y && my <= r.y + r.height) probeRef.current(mx - r.x, my - r.y);
      else paintHoverRef.current = null;
    }, 33);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selMode]);
  // PIXEL painter init + paint-active (req_1379b): the <Paintable> stays MOUNTED while
  // a paint texture exists (not gated on paint mode), so the GPU texture survives
  // paint→object→paint without being destroyed. So restore/base-coat runs only ONCE
  // per model per session (paintInited) — re-running it on every paint re-entry would
  // wipe the texture that's still sitting there. On the FIRST init we RESTORE the
  // model's saved paint, else base-coat. A hot reload clears the inited set, so this
  // re-restores from localstore then (rebuilding a texture the reload may have dropped).
  // Switching models shares ONE paint texture (STUDIO_PAINT_KEY) — drop the undo ring
  // so a new model doesn't inherit the previous model's stroke history.
  useEffect(() => { clearPaintHistory(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [props.sceneName]);
  useEffect(() => {
    setPaintActive(painting);
    if (!painting || !tex) return;
    const model = props.sceneName ?? null;
    if (paintInited(model)) return; // texture already live for this model — leave it
    const base = tex.color ?? '#c8ccd2';
    // Restore the model's content-addressed paint blob (resolved from its paintRef);
    // base-coat only when the model has never been painted. (req_1382)
    const blob = props.paintRef ? props.paintBlob(props.paintRef) : null;
    const id = setTimeout(() => { if (!restorePaint(blob)) baseCoat(base); markPaintInited(model); }, 80);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [painting, props.sceneName, !!tex, props.paintRef]);
  // Seed the live buffer from the persisted paint whenever the open texture changes
  // (entering paint, a re-textureize, undo). Keyed on paintRev so an external change
  // re-syncs but our own per-dab writes (which don't touch tex) don't clobber the buffer.
  useEffect(() => {
    if (paintingRef.current) return; // don't clobber a live stroke mid-drag
    const m: Record<string, PaintCells> = {};
    for (const p of props.parts) if (p.paint) m[p.id] = { ...p.paint };
    paintRef.current = m;
    setPaintBakeTick((t) => t + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.meshRev, props.revision, selMode]);
  // DIAGNOSTIC (req_1376): log the model's UV layout on paint entry / after a re-pack
  // so we can SEE whether faces share atlas space (full-square defaults, identical
  // slots, or partial overlaps) on the real model — the probe isolates fine, so the
  // truth has to come from the live data. Remove once the bleed is understood.
  useEffect(() => {
    if (!painting) return;
    const meshes = props.parts.map((p) => p.mesh);
    type R = { part: number; face: number; x0: number; y0: number; x1: number; y1: number };
    const rects: R[] = [];
    let total = 0, noUV = 0, fullSq = 0, maxUV = 0;
    meshes.forEach((m, pi) => m.faces.forEach((f, fi) => {
      if (f.glass || f.loop.length < 3) return; total += 1;
      if (!f.uv || f.uv.length < 3) { noUV += 1; return; }
      let x0 = 9, y0 = 9, x1 = -9, y1 = -9;
      for (const [u, v] of f.uv) { if (u < x0) x0 = u; if (u > x1) x1 = u; if (v < y0) y0 = v; if (v > y1) y1 = v; if (u > maxUV) maxUV = u; if (v > maxUV) maxUV = v; }
      if (x1 - x0 > 0.97 && y1 - y0 > 0.97) fullSq += 1;
      rects.push({ part: pi, face: fi, x0, y0, x1, y1 });
    }));
    // count faces that OVERLAP at least one other face's island (partial or full).
    let overlapping = 0;
    for (let i = 0; i < rects.length; i += 1) {
      const a = rects[i];
      for (let j = 0; j < rects.length; j += 1) {
        if (i === j) continue; const b = rects[j];
        const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        if (ix > 0.001 && iy > 0.001) { overlapping += 1; break; }
      }
    }
    setPaintDiag(`faces=${total} noUV=${noUV} fullSquare=${fullSq} overlap=${overlapping} maxUV=${maxUV.toFixed(2)} repack=${paintRepackNeeded ? 'Y' : 'n'} tex=${tex?.name}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [painting, props.meshRev, paintRepackNeeded, tex?.name]);
  // The throttled bake clock (the cutout idiom): while a stroke is dirty, bump the
  // tick at most ~12×/s so the atlas re-bakes smoothly instead of per mouse-move.
  useInterval(() => { if (paintDirtyRef.current) { paintDirtyRef.current = false; setPaintBakeTick((t) => t + 1); } }, STUDIO.paintBakeMs);
  // Commit the live buffer to persisted paint (one setState) at the end of a stroke.
  // Commit the live buffer to BRANCH paint (undoable) for every part the stroke
  // touched — one onEditPaint per part. Mint the palette on the first stroke.
  // Stroke-end commit (req_1373): persist the painted RGBA texture (readback → PNG →
  // localstore) so it survives hot reload AND restart. Mints the default palette on
  // first paint so the active colour resolves. The old per-part PaintCells write is
  // gone — the pixel painter is the source of truth now.
  const commitPaint = () => {
    if (touchedRef.current.size && !props.palette) props.onSetPalette(defaultPalette());
    touchedRef.current.clear();
    savePaint(props.onBakePaint);
  };
  // resolve paint against the model palette, falling back to the default so a stroke
  // shows live BEFORE the first commit mints the real (persisted) palette.
  const livePalette: Palette = props.palette ?? defaultPalette();
  // AUTO-ENSURE the texture in paint mode (req_1220): switching models resets the
  // (global twig) texture to null, but ensureTexture only ran on the mode-button press
  // — so after a switch the new model had NO texture → no grid, no paint. This re-makes
  // it whenever paint mode is active without a (suitable) texture, so the open model is
  // always paintable. Guarded on parts existing; ensureTexture is a no-op once tex fits.
  useEffect(() => {
    if (selMode !== 'paint' || props.parts.length === 0) return;
    // paint mode REQUIRES the textured view — paint only renders through the atlas
    // (textureKey), so with texView off you'd register cells and see nothing (the
    // exact "I'm painting but no paint shows" trap, req_1226). Build the texture if
    // missing, OR re-slot when the face topology changed (a new/mirrored face needs its
    // own atlas slot — req_1320); else just force the view on.
    // …or re-pack when faces SHARE an island (req_1375) so each is independently
    // paintable; else just force the view on.
    if (!tex?.paintFit || tex.faceSig !== paintFaceSig || paintRepackNeeded) ensureTexture(); else setTexView(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selMode, tex, props.parts.length, props.sceneName, paintFaceSig, paintRepackNeeded]);

  const sendOrbit = () => ctlRef.current?.setOrbit({ target, yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, distance: distRef.current, fov: fovRef.current, zoom: 1 });

  useEffect(() => {
    const nodeId = Number(cameraRef.current?.id ?? 0);
    if (!nodeId) return;
    const ctl = GAME_NATIVE_CAMERA.forNode(nodeId);
    ctlRef.current = ctl;
    ctl.setMode('orbit');
    ctl.setSmoothing(smoothRef.current); // 0 = direct/Blockbench-like by default
    sendOrbit();
    return () => { ctlRef.current = null; ctl.disable(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Re-frame when the scene changes (part added/removed/reordered/toggled).
  useEffect(() => { distRef.current = fitDistance(); sendOrbit(); /* eslint-disable-next-line */ }, [revision]);

  // Begin a host-owned gizmo drag (req_1270): mount the draft ONCE so the host
  // claims the 'studio.draft' dyn slot, then onMove streams verts straight to it
  // (no setState per move). Called from BOTH grab sites (the axis handle + the
  // face-normal handle). The readout floats by the grab-time anchor.
  const beginGizmoDrag = (startMesh: EditMesh, anchorW: MV3) => {
    liveDragMeshRef.current = startMesh;
    gizmoReadoutRef.current = null;
    gizmoReadoutAnchorRef.current = anchorW;
    dragSeqRef.current += 1;
    setDraft({ partId: activePart!.id, mesh: startMesh, seq: dragSeqRef.current });
    setGizmoDragActive(true);
  };

  const onDown = (e: any) => {
    snapGenRef.current += 1;
    // BACKDROP gizmo (req_1285): when a backdrop is in move-mode, grabbing its 3-axis
    // move handle takes priority over everything (drag = reposition, miss = orbit). A
    // self-contained drag — no mesh selection involved.
    if (moveBackdrop) {
      const r = rectRef.current;
      const lx = Number(e?.x ?? 0) - r.x, ly = Number(e?.y ?? 0) - r.y;
      const proj = makeProjector(camSnap());
      const anchorW = moveBackdrop.pos as MV3;
      const hit = pickGizmoHandle(anchorW, 'move', proj, lx, ly);
      if (hit) {
        const ax = axisScreen(anchorW, AXIS_DIR[hit.axis], proj);
        const unit = AXIS_DIR[hit.axis] as MV3;
        backdropDragRef.current = { id: moveBackdrop.id, axis: { dx: ax.dx, dy: ax.dy, pxPerUnit: ax.pxPerUnit }, unit, startCx: lx, startCy: ly, startPos: [...moveBackdrop.pos] as MV3 };
        setBackdropDragAxis(hit);
        return;
      }
      // miss → fall through to orbit (so you can spin while placing it).
    }
    // PAINT mode: a press on a FACE paints the texel + arms drag-painting (no orbit
    // while painting — you draw on the model). The brush is clamped to the hit face's
    // atlas slot, so a stroke at the edge never bleeds onto a neighbour. A press that
    // MISSES the model falls through to orbit, so you can still spin the camera.
    if (selMode === 'paint') {
      const r = rectRef.current;
      const sx = Number(e?.x ?? 0) - r.x, sy = Number(e?.y ?? 0) - r.y;
      if (paintSample) {
        if (samplePaintAt(sx, sy)) return;
      }
      lastPaintRef.current = null; // start a fresh stroke (no interpolation from a prior one)
      // Snapshot the PRE-stroke texture for undo (req_1379) — only when over a
      // paintable face, and BEFORE paintStroke queues a dab (readback drains pending
      // ops, so it must run before the first dab is enqueued).
      if (pickFaceUV(paintTargets(), camSnap(), sx, sy)) paintSnapshotBegin();
      const hit = paintStroke(sx, sy);
      // the act of painting reveals the texture — if the view was toggled to solid,
      // turn it back on so the stroke is visible immediately (req_1226).
      if (hit) { paintingRef.current = true; if (!texView) setTexView(true); return; }
      dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; lastMoveRef.current = nowMs();
      return;
    }
    // While the loop-cut popup is open, the SLIDE gizmo on the cut comes first
    // (drag the cut-axis arrow to move the cut, req_1022); anywhere else just
    // orbits, so the user can rotate to inspect the live preview.
    if (lc) {
      if (lcGizmoAnchor && lcAxisInfo) {
        const r = rectRef.current;
        const lx = Number(e?.x ?? 0) - r.x, ly = Number(e?.y ?? 0) - r.y;
        const proj = makeProjector(camSnap());
        const hit = pickGizmoHandle(lcGizmoAnchor, 'move', proj, lx, ly);
        if (hit && hit.axis === lcAxisInfo.axis) {
          const ax = axisScreen(lcGizmoAnchor, AXIS_DIR[hit.axis], proj);
          lcDragRef.current = { axis: { dx: ax.dx, dy: ax.dy, pxPerUnit: ax.pxPerUnit }, startCx: lx, startCy: ly, startOffset: lc.offset, info: lcAxisInfo };
          setLcDragAxis(hit);
          // HOST-OWNED slide (req_1277): the preview already mounted slot
          // 'studio.draft'; from here onMove streams cut verts straight to it via
          // patchDynSlot (no setLc/setDraft per move). Seed the live refs so the
          // wireframe overlay + the readout track the slide off-React.
          liveDragMeshRef.current = lcCutMesh(lcAxisInfo);
          gizmoReadoutRef.current = null;
          gizmoReadoutAnchorRef.current = lcGizmoAnchor;
          setGizmoDragActive(true);
          return; // grabbed the slide handle → move the cut, not orbit
        }
      }
      dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; lastMoveRef.current = nowMs(); return;
    }
    // While the bevel popup is open, a press just orbits (so you can spin to inspect
    // the live chamfer) — never re-picks. The popup owns the width; Apply/Cancel close.
    if (bv) { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; lastMoveRef.current = nowMs(); return; }
    // RIG mode (req_1025): (a) if a handle is selected, grab its move gizmo first;
    // (b) else pick a rig handle (pivot / joint) — a hit selects and does NOT
    // orbit; (c) a miss falls through to orbit, so you can spin to inspect. Mirrors
    // the element-mode flow but on rig handles, reusing the SAME gizmo + drag math.
    if (selMode === 'rig' && activePart) {
      const r = rectRef.current;
      const lx = Number(e?.x ?? 0) - r.x, ly = Number(e?.y ?? 0) - r.y;
      const proj = makeProjector(camSnap());
      if (rigSel) {
        const lp = rigLocalPos(activePart.mesh, rigSel);
        if (lp) {
          const anchorW: MV3 = [lp[0], lp[1] + activePart.lift, lp[2]];
          const hit = pickGizmoHandle(anchorW, 'move', proj, lx, ly);
          if (hit) {
            const ax = axisScreen(anchorW, AXIS_DIR[hit.axis], proj);
            rigDragRef.current = { sel: rigSel, axis: { dx: ax.dx, dy: ax.dy, pxPerUnit: ax.pxPerUnit }, unit: AXIS_DIR[hit.axis] as MV3, startCx: lx, startCy: ly, startLocal: [lp[0], lp[1], lp[2]] };
            setRigDragAxis(hit);
            return; // grabbed → move the handle, not orbit
          }
        }
      }
      const h = rigHandles(activePart.mesh, hasPivot(activePart.mesh) ? pivotOf(activePart.mesh) as MV3 : null, activePart.lift);
      const picked = pickRigHandle(h.pivot, h.joints, proj, lx, ly);
      if (picked) { setRigSel(picked); return; } // selected → don't orbit
      dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; lastMoveRef.current = nowMs(); return;
    }
    // ALL-PARTS gizmo (req_1287): in object mode with "all" on, grabbing the gizmo at
    // the model's common centroid transforms EVERY part together. Takes priority over
    // the single-part gizmo; a miss falls through to orbit.
    if (selMode === 'object' && allParts && allAnchorWorld && props.parts.length > 0) {
      const r = rectRef.current;
      const lx = Number(e?.x ?? 0) - r.x, ly = Number(e?.y ?? 0) - r.y;
      const proj = makeProjector(camSnap());
      const hit = pickGizmoHandle(allAnchorWorld, gizmoTool, proj, lx, ly);
      if (hit) {
        const aS = proj(allAnchorWorld);
        const ax = axisScreen(allAnchorWorld, AXIS_DIR[hit.axis], proj);
        // combined half-extent on the grabbed axis (max |vertWorld − anchor|), so a
        // per-axis resize maps drag-distance → a scale factor for the whole assembly.
        let he = 0;
        for (const p of props.parts) for (const v of p.mesh.verts) he = Math.max(he, Math.abs((v[hit.axis] + (hit.axis === 1 ? p.lift : 0)) - allAnchorWorld[hit.axis]));
        multiGizmoDragRef.current = {
          tool: gizmoTool, hit, anchorW: allAnchorWorld, anchorScreen: { x: aS.x, y: aS.y },
          axis: { dx: ax.dx, dy: ax.dy, pxPerUnit: ax.pxPerUnit }, startCx: lx, startCy: ly,
          startScreenDist: Math.max(8, Math.hypot(lx - aS.x, ly - aS.y)), rotSign: gizmoTool === 'rotate' ? rotationSign(allAnchorWorld, hit.axis, proj) : 1,
          combinedHalfExt: he, parts: props.parts.map((p) => ({ id: p.id, startMesh: p.mesh, lift: p.lift })),
        };
        setActiveGizmo(hit);
        return;
      }
      // miss → fall through to orbit; do NOT also run the single-part gizmo below.
      dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; lastMoveRef.current = nowMs();
      return;
    }
    // GIZMO FIRST: if a transform handle is under the cursor, grab it — no pick,
    // no orbit. In OBJECT mode the target is the WHOLE piece (every vert, req_1058);
    // in element modes it's the live selection. (rig has its own handles.)
    if (selMode !== 'rig' && activePart && (selMode === 'object' || selectionCount(sel, selMode) > 0)) {
      const r = rectRef.current;
      const lx = Number(e?.x ?? 0) - r.x, ly = Number(e?.y ?? 0) - r.y;
      const mesh = activePart.mesh;
      const indices = selMode === 'object' ? mesh.verts.map((_, i) => i) : selectionVertIndices(mesh, selMode, sel);
      if (indices.length > 0) {
        const anchorL = vertsCentroid(mesh, indices);
        const anchorW: MV3 = [anchorL[0], anchorL[1] + activePart.lift, anchorL[2]];
        const proj = makeProjector(camSnap());
        // EXTRUDE-DEPTH (req_1193): a single selected face shows a normal arrow — grab
        // it to push the face along its OWN normal (pull out = extrude, push in = inset
        // a recess), straight even on an angled face (a tire), with a depth readout.
        if (gizmoTool === 'move' && selMode === 'face' && sel.faces.size === 1) {
          const face = mesh.faces[[...sel.faces][0]];
          if (face) {
            const nrm = faceNormal(mesh, face) as MV3;
            if (pickNormalHandle(anchorW, nrm, proj, lx, ly)) {
              const aS = proj(anchorW);
              const ns = axisScreen(anchorW, nrm, proj);
              const nHit: GizmoHit = { axis: 0, sign: 1, uniform: false, dir: nrm };
              gizmoDragRef.current = {
                partId: activePart.id, tool: 'move', hit: nHit, indices: face.loop.slice(), startMesh: mesh, mirrorAxes,
                anchorL, anchorScreen: { x: aS.x, y: aS.y }, axis: { dx: ns.dx, dy: ns.dy, pxPerUnit: ns.pxPerUnit },
                startCx: lx, startCy: ly, startScreenDist: Math.max(8, Math.hypot(lx - aS.x, ly - aS.y)), halfExt: 0, rotSign: 1,
              };
              setActiveGizmo(nHit);
              beginGizmoDrag(mesh, anchorW);
              return;
            }
          }
        }
        const hit = pickGizmoHandle(anchorW, gizmoTool, proj, lx, ly);
        if (hit) {
          const aS = proj(anchorW);
          const ax = axisScreen(anchorW, AXIS_DIR[hit.axis], proj);
          gizmoDragRef.current = {
            partId: activePart.id, tool: gizmoTool, hit, indices, startMesh: mesh,
            mirrorAxes, // symmetry planes snapshotted at drag start (req_1183/1186)
            anchorL, anchorScreen: { x: aS.x, y: aS.y },
            axis: { dx: ax.dx, dy: ax.dy, pxPerUnit: ax.pxPerUnit },
            startCx: lx, startCy: ly,
            startScreenDist: Math.max(8, Math.hypot(lx - aS.x, ly - aS.y)),
            halfExt: hit.uniform ? 0 : vertsHalfExtent(mesh, indices, anchorL, hit.axis),
            rotSign: gizmoTool === 'rotate' ? rotationSign(anchorW, hit.axis, proj) : 1,
          };
          setActiveGizmo(hit);
          beginGizmoDrag(mesh, anchorW);
          return; // grabbed a handle → transform, not pick/orbit
        }
      }
    }
    // In an element mode, a press first tries to PICK. A HIT changes the
    // selection (shift/ctrl = add/toggle, else replace) and does NOT orbit — so
    // you can't spin by dragging on an element (USER req_0978). A MISS leaves the
    // selection ALONE and falls through to orbit, so dragging off in empty space
    // spins the camera WITHOUT deselecting. Deselect comes only from picking a
    // new element or pressing Esc (the keydown effect below).
    if (selMode !== 'object' && activePart) {
      const r = rectRef.current;
      const lx = Number(e?.x ?? 0) - r.x, ly = Number(e?.y ?? 0) - r.y;
      const baseProj = makeProjector(camSnap());
      const lift = activePart.lift;
      const proj = (p: Vec3) => baseProj([p[0], p[1] + lift, p[2]]);
      const hit = pickElement(activePart.mesh, selMode, proj, meshEdges(activePart.mesh), lx, ly);
      if (hit != null) {
        const m = heldMods.current;
        const add = m.shift || m.ctrl || m.meta; // shift OR ctrl groups (USER req_0977/0979)
        setSel((s) => applyPick(s, selMode, hit, add));
        return; // picked → don't orbit
      }
      // miss → keep the selection; fall through to orbit
    }
    dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) };
    lastMoveRef.current = nowMs();
  };
  const onMove = (e: any) => {
    // PAINT mode: while painting, keep stamping along the drag. Otherwise, if a
    // miss-drag is orbiting (dragRef set), FALL THROUGH to the orbit handler below;
    // a plain hover just tracks the face/texel under the cursor for the grid overlay.
    if (selMode === 'paint') {
      const r = rectRef.current;
      const sx = Number(e?.x ?? 0) - r.x, sy = Number(e?.y ?? 0) - r.y;
      if (paintingRef.current) { paintStroke(sx, sy); return; } // interpolated stroke → ref (no React per move)
      if (!dragRef.current) { paintProbe(sx, sy); return; } // hover → ref (overlay self-ticks)
      // else: a miss-drag in progress → continue to the orbit block (spin the camera).
    }
    // BACKDROP drag (req_1285): slide the active backdrop along the grabbed axis.
    // Absolute from the frozen start pos; snaps to the gizmo grid. Writes pos straight
    // to state — cheap, since pos doesn't re-bake geometry (it rides the `position`).
    const bdd = backdropDragRef.current;
    if (bdd) {
      const r = rectRef.current;
      const cx = Number(e?.x ?? 0) - r.x, cy = Number(e?.y ?? 0) - r.y;
      const t = snapToStep(dragWorldDistance(bdd.axis, cx - bdd.startCx, cy - bdd.startCy), STUDIO.gizmoStepMeters, STUDIO.gizmoStepFineMeters, heldMods.current);
      const pos: [number, number, number] = [bdd.startPos[0] + bdd.unit[0] * t, bdd.startPos[1] + bdd.unit[1] * t, bdd.startPos[2] + bdd.unit[2] * t];
      updateBackdrop(bdd.id, { pos });
      setGizmoReadout(`${'XYZ'[bdd.unit[0] ? 0 : bdd.unit[1] ? 1 : 2]} ${fmtUnits(metersToUnits(t))}`);
      return;
    }
    // RIG drag: move the selected pivot/joint along the grabbed axis. Snaps by
    // default (req_1023); previews into rigDraft (commit-on-release), so the mesh
    // isn't re-written per move (pivot/joints don't change geometry anyway).
    const rd = rigDragRef.current;
    if (rd) {
      const r = rectRef.current;
      const cx = Number(e?.x ?? 0) - r.x, cy = Number(e?.y ?? 0) - r.y;
      const t = snapToStep(dragWorldDistance(rd.axis, cx - rd.startCx, cy - rd.startCy), STUDIO.gizmoStepMeters, STUDIO.gizmoStepFineMeters, heldMods.current);
      const local: MV3 = [rd.startLocal[0] + rd.unit[0] * t, rd.startLocal[1] + rd.unit[1] * t, rd.startLocal[2] + rd.unit[2] * t];
      setRigDraft({ sel: rd.sel, localPos: local });
      setGizmoReadout(`${'XYZ'[rd.unit[0] ? 0 : rd.unit[1] ? 1 : 2]} ${fmtUnits(metersToUnits(t))}`);
      return;
    }
    // LOOP-CUT SLIDE drag: map the cut-axis drag to lc.offset. Dragging toward
    // +axis moves the cut that way, which (since a higher offset shrinks the −side
    // end) DECREASES the offset by the same world distance. Absolute from the frozen
    // start offset (no drift). HOST-OWNED (req_1277): the old path called setLc EVERY
    // move, which re-rendered the bench AND re-cut the whole mesh + re-uploaded via
    // the [lc] effect — the same per-event React storm the gizmo drag used to have,
    // but heavier (re-cut > re-translate). Now it streams the freshly-cut verts
    // straight to the dyn slot and writes refs; setLc happens ONCE on release.
    const ld = lcDragRef.current;
    if (ld) {
      const r = rectRef.current;
      const cx = Number(e?.x ?? 0) - r.x, cy = Number(e?.y ?? 0) - r.y;
      // snap the slide to the gizmo step grid (req_1023): default = whole units,
      // Shift = finer, Alt = freeform.
      const tMeters = snapToStep(dragWorldDistance(ld.axis, cx - ld.startCx, cy - ld.startCy), STUDIO.gizmoStepMeters, STUDIO.gizmoStepFineMeters, heldMods.current);
      const dOffsetMeters = -tMeters;
      const info = ld.info;
      const dOffset = lc!.unit === 'percent' ? (dOffsetMeters * 100) / (info.sizeMeters || 1) : dOffsetMeters * info.unitsPerMeter;
      const max = lc!.unit === 'percent' ? 100 : Math.max(1, info.sizeUnits);
      const next = Math.round(clamp(ld.startOffset + dOffset, 0, max) * 10) / 10; // 1 dp keeps the popup tidy
      ld.lastOffset = next;
      const cut = lcCutMeshAt(info, next);
      liveDragMeshRef.current = cut;
      gizmoReadoutRef.current = `cut ${fmtUnits(metersToUnits(tMeters))}`;
      const gd = editMeshToGeometry(cut, (f) => !f.glass);
      // Until the preview slot exists (race on the first frame), fall back to setLc
      // so the [lc] effect mounts it; subsequent moves patch in place.
      if (!patchDynSlot('studio.draft', gd.positions, gd.count)) {
        setLc((s) => (s ? { ...s, offset: next } : s));
      }
      return;
    }
    // ALL-PARTS drag (req_1287): the same move/resize/rotate math as the single gizmo,
    // but applied to EVERY part about the common world anchor (mapped to each part's
    // local space by subtracting its lift). Previews via multiDraft (setState, parts
    // are few); commits all on release.
    const mg = multiGizmoDragRef.current;
    if (mg) {
      const r = rectRef.current;
      const cx = Number(e?.x ?? 0) - r.x, cy = Number(e?.y ?? 0) - r.y;
      const mods = heldMods.current;
      const axisLabel = 'XYZ'[mg.hit.axis];
      let apply: (m: EditMesh, anchorL: MV3) => EditMesh;
      let readout: string;
      if (mg.tool === 'rotate') {
        const a0 = Math.atan2(mg.startCy - mg.anchorScreen.y, mg.startCx - mg.anchorScreen.x);
        const a1 = Math.atan2(cy - mg.anchorScreen.y, cx - mg.anchorScreen.x);
        let d = a1 - a0; d = Math.atan2(Math.sin(d), Math.cos(d));
        const deg = snapToStep((d * mg.rotSign * 180) / Math.PI, STUDIO.rotateStepDeg, STUDIO.rotateStepFineDeg, mods);
        const rad = (deg * Math.PI) / 180;
        apply = (m, aL) => rotateVerts(m, m.verts.map((_, i) => i), aL, mg.hit.axis, rad);
        readout = `all · ${axisLabel} ${mods.alt ? deg.toFixed(1) : Math.round(deg)}°`;
      } else if (mg.hit.uniform) {
        const fRaw = Math.hypot(cx - mg.anchorScreen.x, cy - mg.anchorScreen.y) / mg.startScreenDist;
        const f = Math.max(0.02, snapToStep(fRaw, STUDIO.gizmoUniformStep, STUDIO.gizmoUniformStepFine, mods));
        apply = (m, aL) => scaleVerts(m, m.verts.map((_, i) => i), aL, [f, f, f]);
        readout = `all · ⤢ ×${f.toFixed(2)}`;
      } else if (mg.tool === 'move') {
        const t = snapToStep(dragWorldDistance(mg.axis, cx - mg.startCx, cy - mg.startCy), STUDIO.gizmoStepMeters, STUDIO.gizmoStepFineMeters, mods);
        const u = AXIS_DIR[mg.hit.axis];
        const delta: MV3 = [u[0] * t, u[1] * t, u[2] * t];
        apply = (m) => translateVerts(m, m.verts.map((_, i) => i), delta);
        readout = `all · ${axisLabel} ${fmtUnits(metersToUnits(t))}`;
      } else {
        if (mg.combinedHalfExt < 1e-4) return;
        const raw = dragWorldDistance(mg.axis, cx - mg.startCx, cy - mg.startCy) * mg.hit.sign;
        const targetExt = snapToStep(mg.combinedHalfExt + raw, STUDIO.gizmoStepMeters, STUDIO.gizmoStepFineMeters, mods);
        const f = Math.max(0.02, targetExt / mg.combinedHalfExt);
        const factor: MV3 = [1, 1, 1]; factor[mg.hit.axis] = f;
        apply = (m, aL) => scaleVerts(m, m.verts.map((_, i) => i), aL, factor);
        readout = `all · ${axisLabel} Δ${fmtUnits(metersToUnits(targetExt - mg.combinedHalfExt))}`;
      }
      const meshes: Record<string, EditMesh> = {};
      for (const p of mg.parts) {
        const aL: MV3 = [mg.anchorW[0], mg.anchorW[1] - p.lift, mg.anchorW[2]];
        meshes[p.id] = apply(p.startMesh, aL);
      }
      mg.last = meshes;
      dragSeqRef.current += 1;
      setMultiDraft({ meshes, seq: dragSeqRef.current });
      setGizmoReadout(readout);
      return;
    }
    // GIZMO drag: transform the selection, re-lower the working draft (committed
    // to the store only on mouse-up). Absolute from the start mesh + total delta,
    // so there's no accumulation drift.
    const g = gizmoDragRef.current;
    if (g) {
      const r = rectRef.current;
      const cx = Number(e?.x ?? 0) - r.x, cy = Number(e?.y ?? 0) - r.y;
      // Every gizmo drag SNAPS by default (req_1023): no modifier = whole modeling
      // units, Shift = finer, Alt = freeform. Move/resize snap a distance; uniform
      // snaps the scale factor.
      const mods = heldMods.current;
      const axisLabel = 'XYZ'[g.hit.axis];
      let next: EditMesh;
      let readout: string;
      if (g.tool === 'rotate') {
        // screen-angle about the anchor → world rotation about the axis. Snaps to
        // whole steps by default (15°), Shift = 1°, Alt = free (req_1023 parity).
        const a0 = Math.atan2(g.startCy - g.anchorScreen.y, g.startCx - g.anchorScreen.x);
        const a1 = Math.atan2(cy - g.anchorScreen.y, cx - g.anchorScreen.x);
        let d = a1 - a0; d = Math.atan2(Math.sin(d), Math.cos(d)); // normalize to [-π,π]
        const deg = snapToStep((d * g.rotSign * 180) / Math.PI, STUDIO.rotateStepDeg, STUDIO.rotateStepFineDeg, mods);
        next = rotateVerts(g.startMesh, g.indices, g.anchorL, g.hit.axis, (deg * Math.PI) / 180);
        readout = `${axisLabel} ${mods.alt ? deg.toFixed(1) : Math.round(deg)}°`;
      } else if (g.hit.uniform) {
        const fRaw = Math.hypot(cx - g.anchorScreen.x, cy - g.anchorScreen.y) / g.startScreenDist;
        const f = Math.max(0.02, snapToStep(fRaw, STUDIO.gizmoUniformStep, STUDIO.gizmoUniformStepFine, mods));
        next = scaleVerts(g.startMesh, g.indices, g.anchorL, [f, f, f]);
        readout = `⤢ ×${f.toFixed(2)}`;
      } else if (g.tool === 'move') {
        const t = snapToStep(dragWorldDistance(g.axis, cx - g.startCx, cy - g.startCy), STUDIO.gizmoStepMeters, STUDIO.gizmoStepFineMeters, mods);
        // EXTRUDE-DEPTH (req_1193): a normal handle drags along the face normal (g.hit.dir);
        // +out / −in, so the readout reads as a depth (negative = sunk into the surface).
        const u = g.hit.dir ?? AXIS_DIR[g.hit.axis];
        next = translateVerts(g.startMesh, g.indices, [u[0] * t, u[1] * t, u[2] * t]);
        readout = g.hit.dir ? `↕ depth ${fmtUnits(metersToUnits(t))}` : `${axisLabel} ${fmtUnits(metersToUnits(t))}`;
      } else {
        if (g.halfExt < 1e-4) return; // a point/flat axis has no extent to scale
        const raw = dragWorldDistance(g.axis, cx - g.startCx, cy - g.startCy) * g.hit.sign;
        // snap the RESULTING half-extent to the grid so the size lands on whole units.
        const target = snapToStep(g.halfExt + raw, STUDIO.gizmoStepMeters, STUDIO.gizmoStepFineMeters, mods);
        const f = Math.max(0.02, target / g.halfExt);
        const factor: MV3 = [1, 1, 1]; factor[g.hit.axis] = f;
        next = scaleVerts(g.startMesh, g.indices, g.anchorL, factor);
        readout = `${axisLabel} Δ${fmtUnits(metersToUnits(target - g.halfExt))}`;
      }
      // MIRROR (req_1183/1186): reflect the moved verts onto their partners across
      // every enabled plane — op-agnostic, so move/resize/rotate all stay symmetric.
      // Object-mode (all verts moved) self-cancels inside mirrorEditAxes.
      if (g.mirrorAxes.length) next = mirrorEditAxes(g.startMesh, next, g.indices, g.mirrorAxes);
      // HOST-OWNED (req_1270): stream the baked verts STRAIGHT to the host dyn slot
      // and push the live mesh + readout to refs — NO setState, so the bench never
      // re-renders mid-drag. The draft node mounted at grab keeps drawing slot
      // 'studio.draft'; patchDynSlot overwrites its verts in place each frame
      // WITHOUT bumping the dyn version, so the node's redraw shows our patch. The
      // self-ticking overlay + DragReadout read the refs to track live.
      g.lastMesh = next;
      liveDragMeshRef.current = next;
      gizmoReadoutRef.current = readout;
      const gd = editMeshToGeometry(next, (f) => !f.glass);
      const patched = patchDynSlot('studio.draft', gd.positions, gd.count);
      // Until the host has claimed the slot (the grab-mount node hasn't drawn a
      // frame yet), the patch finds nothing — fall back to ONE reconciler upload
      // so the verts still land; subsequent frames patch directly.
      if (!patched) {
        dragSeqRef.current += 1;
        setDraft({ partId: g.partId, mesh: next, seq: dragSeqRef.current });
      }
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    const dx = nx - d.x, dy = ny - d.y;
    d.x = nx; d.y = ny;
    const l = lookRef.current;
    const nextYaw = l.yaw - dx * STUDIO.yawPerPixel;
    const nextPitch = clamp(l.pitch - dy * STUDIO.pitchPerPixel, STUDIO.minPitch, STUDIO.maxPitch);
    // Host-owned: ship only the delta; camera.zig solves + smooths every frame
    // (applyInputDeltas ACCUMULATES, so intra-frame bursts sum correctly).
    ctlRef.current?.setInputDeltas(nextYaw - l.yaw, nextPitch - l.pitch);
    // Fold this event into the per-frame trace accumulator (flushed below).
    const t = nowMs();
    const gap = lastMoveRef.current ? t - lastMoveRef.current : 0;
    lastMoveRef.current = t;
    const c = camRef.current;
    if (c.moves === 0) { c.startYaw = l.yaw; c.startPitch = l.pitch; c.maxGap = 0; }
    c.moves += 1;
    if (gap > c.maxGap) c.maxGap = gap;
    l.yaw = nextYaw; l.pitch = nextPitch;
  };
  const onUp = () => {
    if (paintingRef.current) { paintingRef.current = false; lastPaintRef.current = null; commitPaint(); return; } // end a paint stroke → persist
    // end a BACKDROP drag (req_1285): pos was written live to state already, so just
    // drop the grab + the readout. (No commit step — backdrops persist on every patch.)
    if (backdropDragRef.current) { backdropDragRef.current = null; setBackdropDragAxis(null); setGizmoReadout(null); return; }
    setGizmoReadout(null); // the drag is ending — drop the live step readout
    // end a loop-cut slide. HOST-OWNED (req_1277): the slide streamed verts to the
    // slot without setLc, so the offset lives only in the ref — sync it to state ONCE
    // now (the [lc] effect re-previews at the final offset, matching the slot, and
    // Apply reads it). Then drop the drag + clear the live refs / readout.
    if (lcDragRef.current) {
      const ld = lcDragRef.current;
      lcDragRef.current = null;
      setLcDragAxis(null);
      liveDragMeshRef.current = null;
      gizmoReadoutRef.current = null;
      gizmoReadoutAnchorRef.current = null;
      setGizmoDragActive(false);
      if (ld.lastOffset !== undefined) setLc((s) => (s ? { ...s, offset: ld.lastOffset! } : s));
      return;
    }
    // end a RIG drag: commit the moved pivot/joint to the mesh, drop the draft.
    if (rigDragRef.current) {
      const rd = rigDragRef.current;
      rigDragRef.current = null;
      setRigDragAxis(null);
      if (rigDraft && sameRigSel(rigDraft.sel, rd.sel)) commitRig(rd.sel, rigDraft.localPos);
      setRigDraft(null);
      return;
    }
    // end an ALL-PARTS drag (req_1287): commit every changed part, drop the preview.
    // A uniform/affine whole-model transform can't buckle a convex quad, so no
    // concave-guard needed (unlike the single-part path).
    if (multiGizmoDragRef.current) {
      const mg = multiGizmoDragRef.current;
      multiGizmoDragRef.current = null;
      setActiveGizmo(null);
      setMultiDraft(null);
      if (mg.last) for (const p of mg.parts) { const nm = mg.last[p.id]; if (nm && nm !== p.startMesh) props.onEditMesh(p.id, nm); }
      return;
    }
    const g = gizmoDragRef.current;
    if (g) {
      gizmoDragRef.current = null;
      setActiveGizmo(null);
      // host-owned drag is over: drop the live refs + unmount the DragReadout.
      liveDragMeshRef.current = null;
      gizmoReadoutRef.current = null;
      gizmoReadoutAnchorRef.current = null;
      setGizmoDragActive(false);
      const result = g.lastMesh;
      if (!result) { setDraft(null); return; }
      // Concave Auto-Fix guard (req_0949/req_1016): a moved vert can buckle a quad
      // into a reflex (non-convex) face. If it did, DON'T silently triangulate —
      // keep the buckled preview on screen and raise the dialog for the user to
      // resolve. A clean edit commits straight through.
      const offenders = findConcaveFaces(result);
      if (offenders.length === 0) { setDraft(null); props.onEditMesh(g.partId, result); }
      else {
        // keep the buckled preview on screen for the dialog: sync the draft to the
        // RESULT (the host-owned drag never wrote it through React) + re-ship so the
        // dyn slot shows the final mesh even if something re-renders behind the dialog.
        dragSeqRef.current += 1;
        setDraft({ partId: g.partId, mesh: result, seq: dragSeqRef.current });
        setAutoFix({ partId: g.partId, mesh: result, count: offenders.length });
      }
      return;
    }
    dragRef.current = null;
  };
  const onWheel = (e: any) => {
    const dy = Number(e?.deltaY ?? e?.dy ?? 0);
    const step = Math.max(STUDIO.tileMeters * 0.5, distRef.current * STUDIO.zoomStepFraction);
    distRef.current = clamp(distRef.current + (dy > 0 ? -1 : 1) * step, STUDIO.minDistance, STUDIO.maxDistance);
    sendOrbit();
  };

  // fov + reframe live in refs (no per-frame state); repaint the readout on change.
  const repaint = useRerender();
  const setFov = (v: number) => { fovRef.current = clamp(v, 20, 80); sendOrbit(); repaint(); };
  const reframe = () => { lookRef.current = { yaw: STUDIO.bootYaw, pitch: STUDIO.bootPitch }; distRef.current = fitDistance(); sendOrbit(); repaint(); };

  // Snap the orbit to face an axis (the compass click — req_0969). Eased turn
  // along the SHORTEST yaw path; NaN targetYaw (the poles) keeps the current yaw.
  // A generation token cancels the tween if the user grabs the camera mid-snap.
  const faceAxis = (targetYaw: number, targetPitch: number) => {
    const start = { yaw: lookRef.current.yaw, pitch: lookRef.current.pitch };
    const tyaw = Number.isFinite(targetYaw) ? targetYaw : start.yaw;
    let dyaw = tyaw - start.yaw;
    dyaw = ((dyaw + 180) % 360 + 360) % 360 - 180; // shortest signed delta
    const dpitch = clamp(targetPitch, STUDIO.minPitch, STUDIO.maxPitch) - start.pitch;
    const gen = ++snapGenRef.current;
    const t0 = nowMs();
    const dur = 260;
    const run = () => {
      if (gen !== snapGenRef.current) return; // cancelled (a drag or newer snap)
      const k = Math.min(1, (nowMs() - t0) / dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // easeInOutQuad
      lookRef.current = { yaw: start.yaw + dyaw * e, pitch: clamp(start.pitch + dpitch * e, STUDIO.minPitch, STUDIO.maxPitch) };
      sendOrbit();
      if (k < 1) schedFrame(run);
    };
    schedFrame(run);
  };

  // Per-frame flush of the camera trace (req_0964). One warn line per frame
  // while dragging — moves folded in, net angle delta, worst inter-event gap.
  // No state, no re-render; rides the host rAF (or a 16 ms timer fallback —
  // the cart V8 host has no requestAnimationFrame, per reactjit_no_raf).
  useEffect(() => {
    const host = globalThis as any;
    const sched: (fn: () => void) => any = host.requestAnimationFrame ? host.requestAnimationFrame.bind(host) : (fn: () => void) => setTimeout(fn, 16);
    let stop = false;
    const loop = () => {
      if (stop) return;
      const c = camRef.current;
      if (c.moves > 0) {
        if (logCamRef.current) {
          const l = lookRef.current;
          console.warn(`[studio-cam] frame moves=${c.moves} gapMax=${c.maxGap.toFixed(1)}ms dyaw=${(l.yaw - c.startYaw).toFixed(2)} dpitch=${(l.pitch - c.startPitch).toFixed(2)} yaw=${l.yaw.toFixed(1)}° pitch=${l.pitch.toFixed(1)}°`);
        }
        c.moves = 0;
      }
      sched(loop);
    };
    sched(loop);
    return () => { stop = true; };
  }, []);

  // ── Frame-drop diagnostics (req_0963/0965) ──
  // diagOn/logOn live here (cheap toggle re-renders); the PROBE + its 5 Hz
  // polling live in FrameDiagBar so its re-renders never touch the Scene3D
  // tree (staging + parts) — the diag was itself re-rendering the 26 grid meshes
  // at 5 Hz, a self-inflicted stutter while the readout was on.
  // The spin-skip is fixed (direct camera), so the diagnostics default QUIET
  // (req_0968): no terminal logging. The thin FRAMES strip + the 'log cam'/'fps'
  // toggles stay so the whole probe can be re-armed in one tap if it recurs.
  const [diagOn, setDiagOn] = useState(true);
  const [logOn, setLogOn] = useState(false);
  logCamRef.current = logOn;

  // Live camera-smoothing lever (req_0967): cycle direct↔eased so the feel can
  // be dialed against Blockbench. 0 = direct 1:1 (no momentum/lag); higher =
  // more ease. Applied straight to the host controller — no re-render needed.
  const [smooth, setSmooth] = useHotState('studio:smooth', STUDIO.cameraSmoothing);
  const cycleSmooth = () => {
    const i = SMOOTH_PRESETS.indexOf(smooth);
    const next = SMOOTH_PRESETS[(i + 1) % SMOOTH_PRESETS.length] ?? 0;
    smoothRef.current = next;
    ctlRef.current?.setSmoothing(next);
    setSmooth(next);
    console.warn(`[studio-cam] smoothing=${next === 0 ? 'direct (0)' : `${next}/s`}`);
  };

  // ── Gizmo anchor + the live display mesh (req_0983) ──
  // The mesh shown for the active part: the live drag draft if dragging it, else
  // the committed store mesh. The gizmo + selection overlay both read THIS so
  // they track the deformation live.
  const activeMesh: EditMesh | null = activePart
    ? (draft && draft.partId === activePart.id ? draft.mesh : activePart.mesh)
    : null;
  // OBJECT mode → the gizmo grabs the WHOLE piece (every vert), so move/resize/
  // rotate reorient the part with no select-all (USER req_1058); rig has its own
  // handles; element modes use the live selection.
  const gizmoSelVerts = activePart && activeMesh
    ? (selMode === 'object' ? activeMesh.verts.map((_, i) => i)
      : selMode === 'rig' ? []
        : selectionVertIndices(activeMesh, selMode, sel))
    : [];
  let gizmoAnchorWorld: MV3 | null = null;
  if (activePart && activeMesh && gizmoSelVerts.length > 0) {
    const a = vertsCentroid(activeMesh, gizmoSelVerts);
    gizmoAnchorWorld = [a[0], a[1] + activePart.lift, a[2]];
  }

  // ── Rig handles + the selected-handle gizmo anchor (req_1025) ──
  // The pivot + joint world positions for the overlay (draft-aware via rigLocalPos
  // for the dragged one), and the move-gizmo anchor on the selected handle.
  // the pivot handle shows only when the part HAS a pivot (opt-in, req_1054) — a
  // body is joints-only; null = no pivot handle (rigHandles skips it).
  const rigPivotLocal: MV3 | null = activePart
    ? (rigDraft && rigDraft.sel.kind === 'pivot' ? rigDraft.localPos : (hasPivot(activePart.mesh) ? pivotOf(activePart.mesh) as MV3 : null))
    : null;
  const rig = selMode === 'rig' && activePart
    ? rigHandles(activePart.mesh, rigPivotLocal, activePart.lift)
    : null;
  if (rig && rigDraft && rigDraft.sel.kind === 'joint') {
    const j = rig.joints.find((x) => x.name === (rigDraft.sel as { kind: 'joint'; name: string }).name);
    if (j) j.pos = [rigDraft.localPos[0], rigDraft.localPos[1] + activePart!.lift, rigDraft.localPos[2]];
  }
  let rigAnchorWorld: MV3 | null = null;
  if (selMode === 'rig' && activePart && rigSel) {
    const lp = rigLocalPos(activePart.mesh, rigSel);
    if (lp) rigAnchorWorld = [lp[0], lp[1] + activePart.lift, lp[2]];
  }

  // Swap the live draft into the rendered list for the dragged part (re-lowered
  // each move; a fresh dynamicKey forces the host re-upload). Every OTHER part
  // keeps its memoized, baked entry — only the dragged part re-lowers.
  const display = useMemo(() => {
    // ALL-PARTS preview (req_1287): swap EVERY part with its worked mesh, re-using
    // each part's OWN slot (studio.s<index>, version bumped) — no extra dyn slots.
    if (multiDraft) {
      return placed.map((p) => {
        const m = multiDraft.meshes[p.key];
        return m ? { ...p, def: { id: `studio.${p.key}`, generate: () => editMeshToGeometry(m, (f) => !f.glass), defaults: {} }, dynKey: `${p.dynKey}.md${multiDraft.seq}` } : p;
      });
    }
    if (!draft) return placed;
    return placed.map((p) => (p.key === draft.partId
      // ONE fixed dyn slot ('studio.draft') for whatever part is being dragged —
      // never a per-part slot (req_1008: slots never free).
      ? { ...p, def: { id: `studio.${draft.partId}`, generate: () => editMeshToGeometry(draft.mesh, (f) => !f.glass), defaults: {} }, dynKey: `studio.draft~${draft.partId}.${draft.seq}` }
      : p));
  }, [placed, draft, multiDraft]);

  // ── Selected-face highlight (req_0986/0989): shade the active face(s) vivid ──
  // so the clicked face is unmistakable AND stays tracked THROUGH a loop cut.
  // During the cut preview the highlight follows the TAGGED pieces of the draft
  // mesh (not the stale pre-cut index); otherwise it's the live selection.
  const hiMesh: EditMesh | null = lc && draft && activePart && draft.partId === activePart.id
    ? draft.mesh
    : (activePart && selMode === 'face' ? activePart.mesh : null);
  // During the cut preview, highlight only the kept −side half (what stays
  // selected on Apply); otherwise the live selection.
  const hiIdxs = lc && hiMesh && lcAxisInfo
    ? (() => { const k = lcKeptFace(hiMesh, lcAxisInfo.axis); return k >= 0 ? [k] : []; })()
    : (hiMesh && selMode === 'face' ? [...sel.faces].sort((a, b) => a - b) : []);
  const hiSig = lc ? `lc${draft?.seq ?? 0}` : hiIdxs.join('-');
  const hiSeqRef = useRef(0);
  const faceHi = useMemo(() => {
    if (!activePart || !hiMesh || hiIdxs.length === 0) return null;
    // ONE fixed dyn slot ('studio.hi') for the highlight of WHATEVER part is
    // active — the slot id is constant (not per-part), so it never leaks a slot
    // per part over a session (req_1008: DYN_SLOTS never free). The version after
    // '~' bumps to re-upload the new highlight geometry.
    hiSeqRef.current += 1;
    const key = `studio.hi~${hiSeqRef.current}`;
    return { key, geo: facesGeometry(hiMesh, hiIdxs, STUDIO.selectFacePushMeters), lift: activePart.lift };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePart?.id, activePart?.version, activePart?.lift, hiSig]);

  return (
    <Pressable
      onLayout={(lr: any) => { rectRef.current = { x: Number(lr.x ?? 0), y: Number(lr.y ?? 0), width: Number(lr.width ?? 1000), height: Number(lr.height ?? 700) }; }}
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onScroll={onWheel}
      style={{ flexGrow: 1, height: '100%', position: 'relative', overflow: 'hidden', backgroundColor: '#0a0e14' }}
    >
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0a0e14">
        <Scene3D.Camera nativeCamera ref={cameraRef} position={bootCam.pos} target={bootCam.target} fov={bootCam.fov} near={0.02} far={200} />
        <Scene3D.Fog enabled={false} />
        <Scene3D.AmbientLight color="#dfe7ff" intensity={0.55} />
        <Scene3D.DirectionalLight direction={[0.4, 0.92, 0.32]} color="#ffe9c2" intensity={0.85} />
        {staging}
        {/* BACKDROPS (req_1280/1285): the reference-image trace planes. Translucent +
            white-material so the picture (sampled via textureKey) reads through;
            alpha<1 routes them to the back-to-front transparent pass. The quad is
            centered at origin and PLACED via `position` (bd.pos) — so the gizmo drag
            moves it without a geometry re-bake. The slot id before '~' is the backdrop
            INDEX (reused, never a per-id leak); the version after re-uploads on a
            SHAPE change (geometry), while pos rides the per-frame instance. */}
        {backdropQuads.map((q, i) => {
          const bd = backdrops.find((b) => b.id === q.id);
          if (!bd) return null;
          return (
            <Scene3D.Mesh
              key={bd.id}
              geometry={{ id: `studio.bd.${bd.id}`, generate: () => q.geo, defaults: {} }}
              dynamicKey={`studio.bd${i}~${bd.id}.${bd.plane}.${bd.scale}.${bd.aspect}.${bd.flipU ? 1 : 0}`}
              material={{ color: '#ffffff', opacity: bd.opacity }}
              textureKey={backdropTexKey(bd.id)}
              position={bd.pos}
            />
          );
        })}
        {display.map((p) => {
          // TEXTURE (req_1068): with a scene texture made + texture view on, EVERY
          // part samples the ONE shared sprite-map atlas (STUDIO_TEXTURE_KEY) —
          // material '#ffffff' lets the texture show through (the cutout idiom).
          const textured = texView && !!tex;
          // PIXEL painter (req_1372/1380): once a model is PAINTED, EVERY mode samples
          // the RGBA <Paintable> — not just paint mode — so rig/object show the same
          // painted face as paint mode (they used to sample the stale box-atlas, a
          // different texture). An unpainted model still uses the sprite-map atlas.
          const sampleKey = modelPainted ? STUDIO_PAINT_KEY : textured ? STUDIO_TEXTURE_KEY : undefined;
          return (
            <Fragment key={p.key}>
              <Scene3D.Mesh
                geometry={p.def}
                dynamicKey={p.dynKey}
                material={sampleKey ? '#ffffff' : p.material}
                textureKey={sampleKey}
                position={p.position}
              />
              {/* GLASS (req_1181): translucent pass for this part's window faces. */}
              {p.glassDef ? (
                <Scene3D.Mesh
                  geometry={p.glassDef}
                  dynamicKey={p.glassDynKey}
                  material={{ color: STUDIO.glassColor, opacity: STUDIO.glassOpacity }}
                  position={p.position}
                />
              ) : null}
            </Fragment>
          );
        })}
        {faceHi ? (
          <Scene3D.Mesh
            geometry={{ id: faceHi.key, generate: () => faceHi.geo, defaults: {} }}
            dynamicKey={faceHi.key}
            material={{ color: STUDIO.selectFaceColor }}
            position={[0, faceHi.lift, 0]}
          />
        ) : null}
        {/* SCALE GHOST (req_1165): the reference player beside the model. */}
        {showScale ? (
          <>
            <FigureMeshes rig={scaleFigure.rig} parts={scaleFigure.parts} intern yawDeg={90} offset={scaleOffset} />
            <CharacterCaptures
              headTexKey={scaleFigure.parts.head.texKey}
              skinTexKey={scaleFigure.parts.torso.texKey}
              skin={scaleFigure.doc.skin}
              layers={scaleFigure.doc.layers}
            />
          </>
        ) : null}
      </Scene3D>

      {/* BACKDROPS (req_1280): each visible backdrop's image baked into its own
          offscreen StaticSurface, sampled by the matching trace plane above. memo'd
          on (id, source) so they re-bake only when a picture is added/replaced. */}
      {backdrops.filter((b) => b.visible).map((b) => (
        <BackdropSurface key={b.id} id={b.id} source={b.source} aspect={b.aspect} />
      ))}

      {/* PIXEL painter (req_1372): the RGBA paint texture the model samples while in
          paint mode. Brush dabs (paintAt) and base coat (fillAllFaces) write straight
          into this GPU texture — no boxes, no StaticSurface capture. */}
      {tex ? <Paintable id={STUDIO_PAINT_KEY} w={PAINT_TEX} h={PAINT_TEX} rgba /> : null}

      {/* TEXTURE (req_1068): the offscreen scene SPRITE-MAP atlas every part samples
          via textureKey. Mounted while texture view is on (and NOT painting — the
          pixel painter owns the texture then); re-bakes only on UV/param change. */}
      {texView && tex && !painting && !modelPainted ? (
        <SceneTextureAtlas
          parts={props.parts.map((p) => ({ id: p.id, mesh: p.mesh, paint: paintRef.current[p.id] ?? p.paint }))}
          texels={tex.texels}
          type={tex.type}
          color={tex.color}
          imageUrl={tex.imageUrl}
          sliceImages={tex.sliceImages}
          palette={livePalette}
          pseudo={paintView === 'pseudo'}
          paintCell={paintCell}
          sig={`${props.meshRev}.${props.revision}.${tex.texels}.${tex.type}.${tex.color}.${tex.imageRev ?? 0}.${paintBakeTick}.${paintView}.${livePalette.variant}.${livePalette.slots.length}`}
        />
      ) : null}

      {/* ── TOOLBAR tier 1 (req_1184): info + view toggles (left) · diagnostics
          (right) on ONE strip, space-between so they never overlap. The tools sit
          on tier 2 below; the old three same-row absolute bars piled on top of each
          other (scale text over the mode buttons, fps over the export row). */}
      <Row style={{ position: 'absolute', left: 8, right: 8, top: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <Row style={{ gap: 8, alignItems: 'center' }}>
          <Box style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 5, backgroundColor: '#0b1320dd', borderWidth: 1, borderColor: '#27364a' }}>
            <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>
              {props.partCount === 0 ? 'STUDIO · empty grid · + add a mesh' : `STUDIO · ${props.partCount} part${props.partCount === 1 ? '' : 's'} · ${props.activeName ?? '—'}`}
            </Text>
          </Box>
          {/* SCALE GHOST (req_1165): stand the player beside the model for scale. */}
          <Pressable
            onPress={() => setShowScale((v) => !v)}
            tooltip="Scale reference — stand the in-game player (1.65 m) next to your model to size it against a real human"
            style={{ ...STEP_BTN, backgroundColor: showScale ? '#1c3a2a' : '#0b1320dd', borderColor: showScale ? '#2f7a4f' : '#27364a' }}
          >
            <Text fontSize={10} color={showScale ? '#7fd6a0' : T.dim} style={{ fontFamily: 'monospace' }}>
              {showScale ? `scale · player ${HMSC_SCALE.playerCapsuleHeightMeters.toFixed(2)} m` : '☖ scale'}
            </Text>
          </Pressable>
          {/* BACKDROPS (req_1280): reference images on the walls/floor to trace over. */}
          {(() => { const shown = backdrops.filter((b) => b.visible).length; return (
            <Pressable
              onPress={() => setBackdropPanel(true)}
              tooltip="Reference backdrops — drop a blueprint/photo on a wall or the floor and model straight over it"
              style={{ ...STEP_BTN, backgroundColor: shown ? '#16324a' : '#0b1320dd', borderColor: shown ? '#4a7fb0' : '#27364a' }}
            >
              <Text fontSize={10} color={shown ? '#9fcfff' : T.dim} style={{ fontFamily: 'monospace' }}>
                {shown ? `▦ trace · ${shown}` : '▦ trace'}
              </Text>
            </Pressable>
          ); })()}
          {/* MIRROR (req_1183/1186): symmetric editing — pick the plane(s). X=left↔right,
              Y=up↔down, Z=front↔back; enable more than one for combined symmetry. */}
          <Row style={{ gap: 3, alignItems: 'center', paddingLeft: 5, paddingRight: 4, paddingTop: 2, paddingBottom: 2, borderRadius: 5, backgroundColor: mirrorMask ? '#241c3a' : '#0b1320dd', borderWidth: 1, borderColor: mirrorMask ? '#6b54a6' : '#27364a' }}>
            <Text fontSize={9} color={mirrorMask ? '#cdbcff' : T.dim} style={{ fontFamily: 'monospace' }}>⇄</Text>
            {([0, 1, 2] as const).map((a) => {
              const on = !!(mirrorMask & (1 << a));
              return (
                <Pressable key={a} onPress={() => setMirrorMask((m) => m ^ (1 << a))} tooltip={`Mirror edits across ${STUDIO.mirrorAxisLabels[a]} (${a === 0 ? 'left↔right' : a === 1 ? 'up↔down' : 'front↔back'}) — symmetric editing; enable more than one to combine`} style={{ paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2, borderRadius: 4, backgroundColor: on ? STUDIO.mirrorAxisColors[a] + '33' : 'transparent', borderWidth: 1, borderColor: on ? STUDIO.mirrorAxisColors[a] : '#2c4a6a' }}>
                  <Text fontSize={10} color={on ? STUDIO.mirrorAxisColors[a] : T.dim} style={{ fontFamily: 'monospace', fontWeight: on ? '800' : '400' }}>{STUDIO.mirrorAxisLabels[a]}</Text>
                </Pressable>
              );
            })}
          </Row>
        </Row>
        {/* Diagnostics (req_0981): FRAMES readout + smooth/log/fps levers, far right. */}
        <Row style={{ gap: 6, alignItems: 'center' }}>
          {diagOn ? <FrameDiagBar logToTerminal={logOn} /> : null}
          <Pressable onPress={cycleSmooth} tooltip="Camera smoothing — cycle direct / eased follow (cosmetic; 'direct' is 1:1 like Blockbench)" style={STEP_BTN}><Text fontSize={9} color={T.text}>smooth: {smooth === 0 ? 'direct' : `${smooth}/s`}</Text></Pressable>
          <Pressable onPress={() => setLogOn((v) => !v)} tooltip="Log camera angles to the terminal (debug aid for chasing camera jitter)" style={{ ...STEP_BTN, backgroundColor: logOn ? '#1c3a2a' : '#13233aee', borderColor: logOn ? '#2f7a4f' : '#2c4a6a' }}><Text fontSize={9} color={logOn ? '#7fd6a0' : T.dim}>log cam</Text></Pressable>
          <Pressable onPress={() => setDiagOn((v) => !v)} tooltip="Show/hide the FRAMES performance readout (fps · frame ms · skips · gc · present)" style={{ ...STEP_BTN, backgroundColor: diagOn ? '#1c3a2a' : '#13233aee', borderColor: diagOn ? '#2f7a4f' : '#2c4a6a' }}><Text fontSize={9} color={diagOn ? '#7fd6a0' : T.dim}>fps</Text></Pressable>
        </Row>
      </Row>

      {activePart && activeMesh && selMode !== 'object' && selMode !== 'rig' && selMode !== 'paint'
        ? <SelectionOverlay
            mesh={activeMesh}
            liveMeshRef={liveDragMeshRef}
            partLift={activePart.lift}
            mode={selMode}
            /* While the loop-cut preview is live the selected face index no longer
               maps onto the freshly-cut mesh, so highlighting it would jump to a
               random face. Show the cut wireframe with NO stale highlight. */
            selection={lc || bv ? emptySelection() : sel}
            camSnap={camSnap}
          />
        : null}

      {/* PIXEL painter (req_1373): the cell-grid overlay is gone — there are no
          cells anymore, it was just noise on the model. You paint pixels. */}

      {/* DIAGNOSTIC readout (req_1385): the model's UV layout, on screen since cart
          console.log doesn't reach the terminal. overlap>0 or fullSquare>0 = shared
          islands (the bleed); repack=Y means a re-pack is pending. */}
      {selMode === 'paint' && paintDiag ? (
        <Box style={{ position: 'absolute', left: 8, bottom: 8, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 6, backgroundColor: '#0b0d13ee', borderWidth: 1, borderColor: '#2c4a6a', zIndex: 50 }}>
          <Text fontSize={11} color="#9fe0ff" style={{ fontFamily: 'monospace' }}>{`paintdiag · ${paintDiag}`}</Text>
        </Box>
      ) : null}

      {/* PAINT controls (req_1297): the floating panel — normal colours + custom
          colour, materials, brush/erase/view/variant/clear. Paint mode only. */}
      {selMode === 'paint' && tex ? (
        <PaintPanel
          palette={livePalette}
          activeSlot={activeSlot}
          erase={paintErase}
          view={paintView}
          brush={paintBrush}
          brushSizes={PAINT_BRUSH_SIZES}
          sample={paintSample}
          cell={paintCell}
          onSetCell={setDetail}
          fill={paintFill}
          onToggleFill={() => { setPaintFill(!paintFill); setPaintErase(false); setPaintSample(false); }}
          onToggleSample={() => { setPaintSample(!paintSample); setPaintErase(false); setPaintFill(false); }}
          onPickSlot={(id) => { setActiveSlot(id); setPaintErase(false); setPaintSample(false); }}
          onAddColor={(hex) => { const { palette, id } = paletteWithColor(livePalette, hex); props.onSetPalette(palette); setActiveSlot(id); setPaintErase(false); setPaintSample(false); }}
          onToggleErase={() => { setPaintErase(!paintErase); setPaintSample(false); }}
          onFillAll={fillAllFaces}
          onToggleView={() => setPaintView(paintView === 'pseudo' ? 'painted' : 'pseudo')}
          onSetBrush={(n) => { setPaintBrush(n); setPaintFill(false); }}
          onCycleVariant={() => { const max = Math.max(1, ...livePalette.slots.map((s) => (s.kind === 'color' ? (s.colors?.length ?? 1) : 1))); props.onSetPalette({ ...livePalette, variant: (livePalette.variant + 1) % max }); }}
          onClear={() => { props.parts.forEach((p) => { if (p.paint && Object.keys(p.paint).length) props.onEditPaint(p.id, {}); }); paintRef.current = {}; touchedRef.current.clear(); }}
        />
      ) : null}

      {/* PAINT diagnostics (req_1197): a compact readout — is a texture made + shown,
          and how many cells are painted. Bottom-centre, paint mode only. */}
      {selMode === 'paint' ? (
        <Box style={{ position: 'absolute', left: 0, right: 0, bottom: 92, alignItems: 'center' }}>
          <Box style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4, borderRadius: 6, backgroundColor: '#0b1320ee', borderWidth: 1, borderColor: tex ? '#2f7a4f' : '#a14545' }}>
            <Text fontSize={10} color={tex ? '#7fd6a0' : '#f0a0a0'} style={{ fontFamily: 'monospace' }}>
              paint · {tex ? `atlas ${tex.texels}²` : 'NO TEXTURE'} · {texView ? 'textured' : 'solid (toggle on!)'} · {Object.values(paintRef.current).reduce((n, m) => n + Object.keys(m).length, 0)} cells · drag off model = orbit
            </Text>
          </Box>
        </Box>
      ) : null}

      {/* The transform gizmo — drawn AFTER the selection overlay (last 2D children
          over the Scene3D), so the arrows are NEVER hidden by geometry (USER).
          Hidden while the loop-cut popup is open (the cut preview owns the view). */}
      {/* ALL-PARTS mode shows ONE gizmo at the model's common centroid; otherwise the
          single-part/selection gizmo. */}
      {(() => {
        const allMode = selMode === 'object' && allParts && !!allAnchorWorld;
        const anchor = allMode ? allAnchorWorld : gizmoAnchorWorld;
        return anchor && !lc && !bv && !autoFix && !moveBackdrop
          ? <TransformGizmo anchorW={anchor} tool={gizmoTool} camSnap={camSnap} activeAxis={activeGizmo} />
          : null;
      })()}

      {/* EXTRUDE-DEPTH (req_1193): the normal arrow on a single selected face (move
          tool) — pull out to extrude, push in to inset/cut a recess. */}
      {gizmoTool === 'move' && selMode === 'face' && activePart && activeMesh && sel.faces.size === 1 && !lc && !bv && !autoFix
        ? (() => {
            const face = activeMesh.faces[[...sel.faces][0]];
            if (!face) return null;
            const fc = faceCentroid(activeMesh, face);
            return <NormalHandle anchorW={[fc[0], fc[1] + activePart.lift, fc[2]]} dir={faceNormal(activeMesh, face) as MV3} camSnap={camSnap} active={!!activeGizmo?.dir} />;
          })()
        : null}

      {/* Loop-cut SLIDE gizmo (req_1022): drag the cut-axis arrow ON the model to
          move the cut; the cut axis is the live handle, drawn at the cut plane. */}
      {lc && lcGizmoAnchor
        ? <TransformGizmo anchorW={lcGizmoAnchor} tool="move" camSnap={camSnap} activeAxis={lcDragAxis} />
        : null}

      {/* Rig overlay (req_1025): the pivot ball + joint markers (axis arrow + the
          type·travel label). The selected handle gets the move gizmo, reused. */}
      {rig
        ? <RigOverlay pivotW={rig.pivot} joints={rig.joints} sel={rigSel} camSnap={camSnap} />
        : null}
      {rigAnchorWorld
        ? <TransformGizmo anchorW={rigAnchorWorld} tool="move" camSnap={camSnap} activeAxis={rigDragAxis} />
        : null}

      {/* BACKDROP move gizmo (req_1285): the 3-axis move handle on the active backdrop
          — drag an arrow to slide the trace into place; scroll/empty-drag still orbits. */}
      {moveBackdrop
        ? <TransformGizmo anchorW={moveBackdrop.pos as MV3} tool="move" camSnap={camSnap} activeAxis={backdropDragAxis} />
        : null}
      {moveBackdrop ? (
        <Box style={{ position: 'absolute', left: 0, right: 0, top: 44, alignItems: 'center' }}>
          <Row style={{ gap: 8, alignItems: 'center', paddingLeft: 10, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 6, backgroundColor: '#0b1320ee', borderWidth: 1, borderColor: '#9b7fd6' }}>
            <Text fontSize={10} color="#e0d4ff" style={{ fontFamily: 'monospace' }}>{`moving · ${moveBackdrop.name} · drag the arrows · scroll to orbit`}</Text>
            <Pressable onPress={() => setMoveBackdropId(null)} tooltip="Done positioning (Esc)" style={STEP_BTN}><Text fontSize={10} color="#7fd6a0">done</Text></Pressable>
          </Row>
        </Box>
      ) : null}

      {/* Live drag readout (req_1024): floats by the gizmo anchor while dragging so
          the step amount can be read off and mirrored on the other side. */}
      {gizmoReadout ? (() => {
        const anchor = lc ? lcGizmoAnchor : selMode === 'rig' ? rigAnchorWorld : gizmoAnchorWorld;
        if (!anchor) return null;
        const p = makeProjector(camSnap())(anchor);
        if (!p.front) return null;
        return (
          <Box style={{ position: 'absolute', left: p.x + 14, top: p.y - 34, paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRadius: 5, backgroundColor: '#0b1320ee', borderWidth: 1, borderColor: '#5b8fd6' }}>
            <Text fontSize={11} color="#cfe2ff" style={{ fontFamily: 'monospace', fontWeight: '800' }}>{gizmoReadout}</Text>
          </Box>
        );
      })() : null}

      {/* HOST-OWNED gizmo readout (req_1270): self-ticking + ref-driven, so the live
          step amount updates during a drag that never re-renders the bench. (The
          inline readout above stays for rig/loop-cut, which still use state.) */}
      {gizmoDragActive
        ? <DragReadout textRef={gizmoReadoutRef} anchorRef={gizmoReadoutAnchorRef} camSnap={camSnap} />
        : null}

      {/* ── TOOLBAR tier 2 (req_1184): the TOOLS — modes · transform · context edit
          ops · texture/compile — on their OWN line below tier 1 (no more piling onto
          the info/diag strip). Left-aligned + wraps so a dense selection never
          overflows off-screen; a faint bar groups them as one real toolbar. */}
      <Row style={{ position: 'absolute', left: 8, right: 8, top: 40, gap: 4, rowGap: 4, alignItems: 'center', flexWrap: 'wrap', paddingLeft: 6, paddingRight: 6, paddingTop: 5, paddingBottom: 5, borderRadius: 7, backgroundColor: '#0a111caa', borderWidth: 1, borderColor: '#1c2940' }}>
        {(['object', 'vertex', 'edge', 'face', 'rig', 'paint'] as SelMode[]).map((m) => {
          const on = selMode === m;
          const n = selectionCount(sel, m);
          const disabled = m !== 'object' && !activePart;
          const modeTip: Record<string, string> = {
            object: 'Object mode — move/resize/rotate the WHOLE part as one',
            vertex: 'Vertex mode — select & drag individual points (and build faces / fit wheels)',
            edge: 'Edge mode — select edges; extrude an edge or bridge edges into a face',
            face: 'Face mode — select faces; extrude, inset, loop-cut, flip, or mark glass',
            rig: 'Rig mode — place the pivot + joints (axles, hinges) the part rotates about',
            paint: 'Paint mode — paint texels directly onto the 3D faces',
          };
          return (
            <Pressable key={m} onPress={() => { if (disabled) return; if (m === 'paint') ensureTexture(); setSelMode(m); }} tooltip={modeTip[m]} style={{ ...STEP_BTN, opacity: disabled ? 0.4 : 1, backgroundColor: on ? '#2a3f5e' : '#13233aee', borderColor: on ? '#5b8fd6' : '#2c4a6a' }}>
              <Text fontSize={10} color={on ? '#cfe2ff' : T.dim} style={{ fontFamily: 'monospace' }}>{m}{on && n > 0 ? ` ·${n}` : ''}</Text>
            </Pressable>
          );
        })}
        {/* SCOPE toggle (req_1692): sit it RIGHT NEXT TO the object tab — the most
            prominent spot in the editor — so "size the whole model" is impossible to
            miss. It was a dim chip buried at the far end of this wrapping row, so the
            user never found it and merged every layer just to resize the assembly. In
            object mode with 2+ layers it offers "size all N layers together"; ON, the
            gizmo scales/moves/rotates the whole model about its shared center. */}
        {selMode === 'object' && props.partCount >= 2 ? (
          <>
            <Box style={{ width: 1, height: 16, backgroundColor: '#2c4a6a', marginLeft: 2, marginRight: 2 }} />
            <Pressable
              onPress={() => setAllParts((v) => !v)}
              tooltip="Size the WHOLE model — the gizmo moves/resizes/rotates every layer together about the model's shared center, so the assembly scales as one and proportions hold. Off = just the active layer. (No need to merge layers to resize the whole thing.)"
              style={{ ...STEP_BTN, paddingLeft: 9, paddingRight: 9, backgroundColor: allParts ? '#1c4a30' : '#163a2a99', borderColor: allParts ? '#39a065' : '#2f7a4f' }}
            >
              <Text fontSize={11} color={allParts ? '#9bf0bd' : '#7fd6a0'} style={{ fontFamily: 'monospace' }}>{allParts ? `▣ all ${props.partCount} layers` : `▢ size all ${props.partCount} layers`}</Text>
            </Pressable>
          </>
        ) : null}
        {/* PAINT controls moved OUT of this toolbar into the floating PaintPanel
            (req_1297 — the bar was overcrowded); only the mode tabs stay here. */}
        {/* SYMMETRIZE (req_1190/1201): a WHOLE-MESH op, so shown in EVERY mode (it
            used to be nested in the non-rig tool block → invisible in rig mode, where
            the user went looking for it). Pick the GOOD half → it rebuilds the other
            as an exact mirror; the badge shows live ✓ / ⚠ for the symmetry axis. */}
        {activePart && symReport ? (() => {
          const symAxis = symReport.axis; // explicit mirror plane, else the auto-detected most-symmetric axis
          const ax = STUDIO.mirrorAxisLabels[symAxis];
          const col = STUDIO.mirrorAxisColors[symAxis];
          const doSym = (keepPos: boolean) => {
            props.onEditMesh(activePart.id, symmetrize(activePart.mesh, symAxis, keepPos));
            setSel(emptySelection()); setRigSel(null);
          };
          return (
            <>
              <Box style={{ width: 1, height: 16, backgroundColor: '#2c4a6a', marginLeft: 4, marginRight: 4 }} />
              <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace' }}>symmetrize</Text>
              <Pressable onPress={() => doSym(true)} tooltip={`Symmetrize — keep the +${ax} half and rebuild the other side as its exact mirror (kills any drift)`} style={{ ...STEP_BTN, backgroundColor: '#241c3a', borderColor: col }}>
                <Text fontSize={10} color={col} style={{ fontFamily: 'monospace' }}>keep +{ax}</Text>
              </Pressable>
              <Pressable onPress={() => doSym(false)} tooltip={`Symmetrize — keep the −${ax} half and rebuild the other side as its exact mirror (kills any drift)`} style={{ ...STEP_BTN, backgroundColor: '#241c3a', borderColor: col }}>
                <Text fontSize={10} color={col} style={{ fontFamily: 'monospace' }}>keep −{ax}</Text>
              </Pressable>
              <Box style={{ paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRadius: 5, backgroundColor: symReport.unmatched === 0 ? '#10261a' : '#2e1616', borderWidth: 1, borderColor: symReport.unmatched === 0 ? '#2f7a4f' : '#a14545' }}>
                <Text fontSize={10} color={symReport.unmatched === 0 ? '#7fd6a0' : '#f0a0a0'} style={{ fontFamily: 'monospace' }}>
                  {symReport.unmatched === 0 ? `✓ symmetric ${ax}` : `⚠ ${symReport.unmatched} off ${ax}`}
                </Text>
              </Box>
            </>
          );
        })() : null}
        {/* MESH LINT (req_1224): the live health badge — "✓ clean" or "⚠ N" — for the
            active part. It's a whole-mesh read, so shown in every mode (beside
            symmetrize). Pressing a dirty badge SELECTS the offending faces (face mode)
            and logs the full breakdown, so the scuff is on-screen, not just counted. */}
        {activePart && health ? (() => {
          const dirty = !health.clean;
          const faceIssues = health.issues.filter((iss) => iss.faces.length);
          const showOffenders = () => {
            if (!dirty) { toast('mesh is clean — no issues'); return; }
            for (const iss of health.issues) console.warn(`[studio:lint] ${iss.severity} ${iss.kind}: ${iss.detail}`);
            const faces = [...new Set(faceIssues.flatMap((iss) => iss.faces))];
            if (faces.length) { setSelMode('face'); setSel({ verts: new Set(), edges: new Set(), faces: new Set(faces) }); }
            toast(`${health.errors} error${health.errors === 1 ? '' : 's'}, ${health.warns} warn${health.warns === 1 ? '' : 's'} — see console`);
          };
          const col = health.errors ? '#f0a0a0' : health.warns ? '#e9d24a' : '#7fd6a0';
          const bg = health.errors ? '#2e1616' : health.warns ? '#2a2410' : '#10261a';
          return (
            <>
              <Box style={{ width: 1, height: 16, backgroundColor: '#2c4a6a', marginLeft: 4, marginRight: 4 }} />
              <Pressable onPress={showOffenders} style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 5, backgroundColor: bg, borderWidth: 1, borderColor: col }}>
                <Text fontSize={10} color={col} style={{ fontFamily: 'monospace' }}>
                  {health.clean ? '✓ clean' : `⚠ ${health.errors ? `${health.errors}E` : ''}${health.errors && health.warns ? ' ' : ''}${health.warns ? `${health.warns}W` : ''}`}
                </Text>
              </Pressable>
            </>
          );
        })() : null}
        {/* MERGE / re-attach (req_1224): fold the active part DOWN into the part before
            it (the body), in object mode. The instant re-attach for a bad detach is
            undo×2; this is the durable weld — and combines any two parts. */}
        {selMode === 'object' && activePart && props.mergeTargetName ? (
          <>
            <Box style={{ width: 1, height: 16, backgroundColor: '#2c4a6a', marginLeft: 4, marginRight: 4 }} />
            <Pressable onPress={() => { props.onMergeActive(); setSel(emptySelection()); }} style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#2c4a6a' }}>
              <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>{`merge → ${props.mergeTargetName}`}</Text>
            </Pressable>
          </>
        ) : null}
        {/* RIG mode: add a joint, or opt the part into a pivot (req_1054 — pivots
            are opt-in; a body is joints-only). The gizmo on the selected handle
            does the placing — no move/resize toggle. */}
        {selMode === 'rig' && activePart ? (
          <>
            <Box style={{ width: 1, height: 16, backgroundColor: '#2c4a6a', marginLeft: 4, marginRight: 4 }} />
            {!hasPivot(activePart.mesh) ? (
              <Pressable
                onPress={() => {
                  const at = pivotOf(activePart.mesh); // lands at the bounds center; drag it onto the spin center
                  props.onEditMesh(activePart.id, setPivot(activePart.mesh, [at[0], at[1], at[2]]));
                  setRigSel({ kind: 'pivot' });
                }}
                tooltip="Add a pivot — the part's rotation origin (drag the handle onto the real spin centre). Opt-in; a body is joints-only"
                style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#a8632c' }}
              >
                <Text fontSize={10} color="#ffb37d" style={{ fontFamily: 'monospace' }}>+ pivot</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => {
                const name = nextJointName(activePart.mesh);
                const at = pivotOf(activePart.mesh); // lands at the bounds center; drag it to the armpit/axle
                props.onEditMesh(activePart.id, addMount(activePart.mesh, { name, kind: 'socket', position: [at[0], at[1], at[2]], axis: [0, 1, 0], limit: { min: -90, max: 90 } }));
                setRigSel({ kind: 'joint', name });
              }}
              tooltip="Add a joint — a typed mount point (axle, hinge, socket) the child part connects + rotates at. Drag it into place"
              style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#2c4a6a' }}
            >
              <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>+ joint</Text>
            </Pressable>
            {/* + SEAT (req_1244): a FIXED anchor — a seat / cargo slot the occupant
                attaches to (no rotation). Drag it into place; set role + facing in
                the rig panel. Distinct from a joint, which rotates. */}
            <Pressable
              onPress={() => {
                const name = nextAnchorName(activePart.mesh);
                const at = pivotOf(activePart.mesh); // lands at the bounds center; drag it onto the seat
                props.onEditMesh(activePart.id, addAnchor(activePart.mesh, { name, position: [at[0], at[1], at[2]] }));
                setRigSel({ kind: 'joint', name });
              }}
              tooltip="Add a seat — a FIXED anchor (driver/passenger/cargo) a runtime occupant attaches to, facing a direction. No rotation. Drag it into place; set role + facing in the rig panel"
              style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#2f7a6f' }}
            >
              <Text fontSize={10} color="#9fe9de" style={{ fontFamily: 'monospace' }}>+ seat</Text>
            </Pressable>
            {/* MIRROR MOUNT (req_1189; anchors req_1244): with mirror plane(s) on,
                reflect the selected mount into its partners — one tire mount → all
                four (X = left/right, X+Z = all four); one driver seat → the
                passenger (facing mirrored too). mirrorMount preserves kind + role,
                so the same op + button serves joints AND anchors — only the label
                follows the selected mount's kind. */}
            {rigSel && rigSel.kind === 'joint' && mirrorAxes.length ? (() => {
              const selName = (rigSel as { kind: 'joint'; name: string }).name;
              const selMount = (activePart.mesh.mounts ?? []).find((x) => x.name === selName);
              const anchor = !!selMount && isAnchor(selMount);
              return (
                <Pressable
                  onPress={() => props.onEditMesh(activePart.id, addMountReflections(activePart.mesh, selName, mirrorAxes))}
                  tooltip={anchor
                    ? 'Mirror this seat across the enabled plane(s) — place the driver seat, get the passenger (position + facing mirrored). X = both sides, X+Z = all four'
                    : 'Mirror this joint across the enabled plane(s) — place one wheel mount, get the matching ones (X = both sides, X+Z = all four)'}
                  style={{ ...STEP_BTN, backgroundColor: anchor ? '#163a36' : '#241c3a', borderColor: anchor ? '#2f7a6f' : '#6b54a6' }}
                >
                  <Text fontSize={10} color={anchor ? '#9fe9de' : '#cdbcff'} style={{ fontFamily: 'monospace' }}>{anchor ? '⇄ mirror seat' : '⇄ mirror joint'}</Text>
                </Pressable>
              );
            })() : null}
            <Box style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 5, backgroundColor: '#0b1320cc', borderWidth: 1, borderColor: '#27364a' }}>
              <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace' }}>{rigSel ? (rigSel.kind === 'pivot' ? 'pivot selected' : `${isAnchor((activePart.mesh.mounts ?? []).find((x) => x.name === rigSel.name) ?? { kind: 'socket' } as any) ? 'anchor' : 'joint'}: ${rigSel.name}`) : 'pick a handle, or + above'}</Text>
            </Box>
          </>
        ) : null}
        {selMode !== 'rig' && selMode !== 'paint' ? (
          <>
            <Box style={{ width: 1, height: 16, backgroundColor: '#2c4a6a', marginLeft: 4, marginRight: 4 }} />
            {(['move', 'resize', 'rotate'] as GizmoTool[]).map((tl) => {
              const on = gizmoTool === tl;
              return (
                <Pressable key={tl} onPress={() => setGizmoTool(tl)} tooltip={tl === 'move' ? 'Move tool — drag the arrows to slide the selection (in face mode an orange arrow extrudes along the normal)' : tl === 'resize' ? 'Resize tool — drag the square handles to scale the selection per-axis' : 'Rotate tool — drag the rings to spin the selection about an axis'} style={{ ...STEP_BTN, backgroundColor: on ? '#3a2f5e' : '#13233aee', borderColor: on ? '#9b7fd6' : '#2c4a6a' }}>
                  <Text fontSize={10} color={on ? '#e0d4ff' : T.dim} style={{ fontFamily: 'monospace' }}>{tl}</Text>
                </Pressable>
              );
            })}
            {/* ALL-PARTS toggle relocated next to the mode tabs (req_1692) — it was
                buried at the end of this wrapping row and vanished at 1 part, so the
                user never found it and merged layers instead. */}
            {/* face-only edit ops: extrude + loop cut (a single selected face). */}
            {selMode === 'face' && activePart && sel.faces.size === 1 ? (
              <>
                <Box style={{ width: 1, height: 16, backgroundColor: '#2c4a6a', marginLeft: 4, marginRight: 4 }} />
                {/* extrude — commits a thin lip; the move gizmo then pulls it in/out
                    (req_1015). The cap stays at the same index so it stays selected. */}
                <Pressable
                  onPress={() => {
                    const faceIndex = [...sel.faces][0];
                    const extruded = extrudeFace(activePart.mesh, faceIndex, STUDIO.extrudeMeters);
                    props.onEditMesh(activePart.id, splitConcaveFaces(extruded));
                    setGizmoTool('move'); // ready to drag the new cap in/out
                  }}
                  tooltip="Extrude — pull a new lip out of the selected face; then drag the orange normal arrow to set depth (push IN to inset/cut a recess)"
                  style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#2c4a6a' }}
                >
                  <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>extrude</Text>
                </Pressable>
                {/* loop cut — a face click + this opens the cut popup (req_0984/0985) */}
                <Pressable
                  onPress={() => {
                    const faceIndex = [...sel.faces][0];
                    const info = loopCutAxisInfo(activePart.mesh, faceIndex, 0);
                    if (!info) return;
                    setLc({ faceIndex, dir: 0, cuts: 1, offset: Math.round(info.sizeUnits / 2), unit: 'units' });
                  }}
                  tooltip="Loop cut — slice parallel rings around the part to add edge loops (opens a popup for count + offset)"
                  style={{ ...STEP_BTN, backgroundColor: lc ? '#1c3a2a' : '#13233aee', borderColor: lc ? '#2f7a4f' : '#2c4a6a' }}
                >
                  <Text fontSize={10} color={lc ? '#7fd6a0' : T.dim} style={{ fontFamily: 'monospace' }}>loop cut</Text>
                </Pressable>
              </>
            ) : null}
            {/* face ops on ANY face selection: flip winding (req_1182) + glass toggle
                (req_1181). Flip reverses the normal when Create Face guessed wrong;
                glass marks the face(s) as a translucent, un-textured pane. */}
            {selMode === 'face' && activePart && sel.faces.size >= 1 ? (() => {
              const faceList = [...sel.faces];
              const allGlass = faceList.every((i) => activePart.mesh.faces[i]?.glass);
              return (
                <>
                  <Box style={{ width: 1, height: 16, backgroundColor: '#2c4a6a', marginLeft: 4, marginRight: 4 }} />
                  {/* flip — reverse the selected face(s) so the normal points the other
                      way (fixes an upside-down Create Face). */}
                  <Pressable
                    onPress={() => {
                      let out = activePart.mesh;
                      for (const fi of faceList) out = flipFace(out, fi);
                      props.onEditMesh(activePart.id, out);
                    }}
                    tooltip="Flip — reverse the selected face(s) so the normal points the other way (un-inverts an upside-down Create Face)"
                    style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#2c4a6a' }}
                  >
                    <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>flip</Text>
                  </Pressable>
                  {/* merge — dissolve a coplanar, connected face group back into ONE
                      clean face (req_1282): the inverse of a loop cut. Shared seam
                      edges + their collinear leftover verts go away, so cuts you no
                      longer want come back as a single quad. Needs ≥2 faces. */}
                  {faceList.length >= 2 ? (
                    <Pressable
                      onPress={() => {
                        const out = mergeFaces(activePart.mesh, faceList);
                        if (!out) { toast('select a connected, coplanar face group to merge'); return; }
                        props.onEditMesh(activePart.id, out);
                        setSel(emptySelection());
                        toast(`merged ${faceList.length} faces → 1`);
                      }}
                      tooltip="Merge — fuse the selected coplanar, connected faces back into one clean face (the inverse of a loop cut); seam edges + leftover collinear verts dissolve"
                      style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#2c4a6a' }}
                    >
                      <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>merge</Text>
                    </Pressable>
                  ) : null}
                  {/* glass — toggle the face(s) between a textured surface and a
                      translucent window pane (renders see-through, skips texturing). */}
                  <Pressable
                    onPress={() => props.onEditMesh(activePart.id, setFaceGlass(activePart.mesh, faceList, !allGlass))}
                    tooltip="Glass — toggle the face(s) as a translucent window pane (renders see-through, skips texturing). For windshields/windows"
                    style={{ ...STEP_BTN, backgroundColor: allGlass ? '#16314a' : '#13233aee', borderColor: allGlass ? '#5b9fd6' : '#2c4a6a' }}
                  >
                    <Text fontSize={10} color={allGlass ? '#a9cbe0' : T.dim} style={{ fontFamily: 'monospace' }}>{allGlass ? '▣ glass' : 'glass'}</Text>
                  </Pressable>
                  {/* detach — peel the selected face-group off the body into its own
                      thin solid part (req_1218): the faces leave the body, come back
                      as a panel (outer skin + inward rim walls + inner cap) with a
                      pivot seated, ready to hinge/pop in rig mode. Hood, door, trunk,
                      light housing — every panel comes off this one button. */}
                  <Pressable
                    onPress={() => {
                      const { panel, body } = detachPanel(activePart.mesh, faceList, STUDIO.shellThicknessMeters);
                      props.onEditMesh(activePart.id, body);
                      // the panel inherits the BODY's lift so it renders in place, not
                      // re-seated on its own lowest vert (which would float it off).
                      props.onAddPart(panel, 'panel', activePart.lift);
                      setSel(emptySelection());
                    }}
                    tooltip="Detach — peel the selected faces off the body into their own thin panel part (hood / door / trunk), pivot seated, ready to hinge"
                    style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#2c4a6a' }}
                  >
                    <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>detach</Text>
                  </Pressable>
                  {/* solidify — give the selected face-group THICKNESS in place
                      (req_1230): unlike detach, the faces STAY on the body; each gets
                      an inward inner skin + the open rim (door/window holes, the shell
                      boundary) bridged with wall quads. Turns a paper-thin box shell
                      into walls you can see from inside — the cab stops reading hollow.
                      Holes you cut (a detached door's gap) DON'T get capped: solidify
                      only mirrors the faces you select and walls the open edges, so the
                      door opening stays open, just gains a real thickness frame. */}
                  <Pressable
                    onPress={() => {
                      const out = solidifyFaces(activePart.mesh, faceList, STUDIO.shellThicknessMeters);
                      if (out !== activePart.mesh) { props.onEditMesh(activePart.id, out); setSel(emptySelection()); }
                    }}
                    tooltip="Solidify — give the selected faces thickness IN PLACE (inner skin + walled rim). Wraps a hollow box shell into solid walls; open holes (doors/windows) stay open with a thickness frame"
                    style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#2c4a6a' }}
                  >
                    <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>solidify</Text>
                  </Pressable>
                  {/* WHEEL FROM FACE (req_1261): the well's back face already gives the
                      axle point (its centroid) + the spin axis (its normal), so ONE
                      click drops an axle joint at the center AND seats a connected
                      wheel part (pivot at the hub) there — mirror-aware → both/all
                      wheels at once. The wheel comes in as its OWN pivoted part (not
                      merged), set up for the articulation runtime to spin. */}
                  {faceList.length === 1 ? (
                    <Pressable
                      onPress={() => {
                        const fit = faceWheelFit(activePart.mesh, faceList[0]);
                        if (!fit) { toast('select the flat back face of the wheel well'); return; }
                        const centers = mirroredCenters(fit.center, mirrorAxes);
                        let body = activePart.mesh;
                        for (const c of centers) body = addMount(body, { name: nextJointName(body), kind: 'socket', position: c, axis: axleSpinAxis(fit.axis), limit: { full: true } });
                        props.onEditMesh(activePart.id, body);
                        for (const c of centers) props.onAddPart(buildWheelPart({ center: c, radius: fit.radius, axis: fit.axis }, STUDIO.wheelWidthFraction, STUDIO.wheelSides), 'wheel', activePart.lift);
                        setSel(emptySelection());
                        toast(`wheel${centers.length > 1 ? `s ×${centers.length}` : ''} connected · r ${fmtUnits(metersToUnits(fit.radius)).replace('+', '')}`);
                      }}
                      tooltip="Wheel from face — drop an axle joint at this face's center (axis = its normal) and seat a connected wheel part there, pivot at the hub. Mirror-aware → all wheels at once"
                      style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#2c6a4a' }}
                    >
                      <Text fontSize={10} color="#7fd6a0" style={{ fontFamily: 'monospace' }}>⊚ wheel from face</Text>
                    </Pressable>
                  ) : null}
                </>
              );
            })() : null}
            {/* edge-only edit op: extrude (a single selected edge). Mirrors the
                face extrude — pulls a new edge off + bridges with a quad, then the
                move gizmo shapes it. Selection follows the NEW edge (req_1163). */}
            {selMode === 'edge' && activePart && sel.edges.size === 1 ? (
              <>
                <Box style={{ width: 1, height: 16, backgroundColor: '#2c4a6a', marginLeft: 4, marginRight: 4 }} />
                <Pressable
                  onPress={() => {
                    const mesh = activePart.mesh;
                    const edge = meshEdges(mesh)[[...sel.edges][0]];
                    if (!edge) return;
                    const before = mesh.verts.length; // the new edge's two verts land here
                    const out = extrudeEdge(mesh, edge, STUDIO.extrudeMeters);
                    if (out === mesh) return;
                    props.onEditMesh(activePart.id, out);
                    // re-find the offset edge (before, before+1) so it stays selected.
                    const ni = meshEdges(out).findIndex((e) => e[0] === before && e[1] === before + 1);
                    setSel(ni >= 0 ? { verts: new Set(), edges: new Set([ni]), faces: new Set() } : emptySelection());
                    setGizmoTool('move'); // ready to drag the new edge in/out
                  }}
                  tooltip="Extrude edge — pull a new edge off the selected one, bridged by a quad; then drag it with the move gizmo"
                  style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#2c4a6a' }}
                >
                  <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>extrude</Text>
                </Pressable>
                {/* BEVEL (req_1265/1266): chamfer the selected edge. Opens a popup that
                    PREVIEWS the chamfer live and lets you grow/shrink the width before
                    confirming (like the loop cut). Manifold edges only. */}
                <Pressable
                  onPress={() => {
                    const edge = meshEdges(activePart.mesh)[[...sel.edges][0]];
                    if (!edge) return;
                    if (bevelEdge(activePart.mesh, edge, STUDIO.bevelMeters) === activePart.mesh) { toast('bevel needs a sharp manifold edge (2 faces at an angle — not a flat seam)'); return; }
                    openBevel('edge', [...sel.edges][0]);
                  }}
                  tooltip="Bevel edge — chamfer the selected edge into a flat face; opens a popup to size the bevel before applying (manifold edges only)"
                  style={{ ...STEP_BTN, backgroundColor: bv?.kind === 'edge' ? '#1c3a2a' : '#13233aee', borderColor: bv?.kind === 'edge' ? '#2f7a4f' : '#2c4a6a' }}
                >
                  <Text fontSize={10} color={bv?.kind === 'edge' ? '#7fd6a0' : T.dim} style={{ fontFamily: 'monospace' }}>bevel</Text>
                </Pressable>
              </>
            ) : null}
            {/* BEVEL VERTEX (req_1266): chamfer a single selected corner — cut it off,
                cap the hole. Opens the SAME sizing popup as the edge bevel. Needs a real
                corner (3+ incident edges). */}
            {selMode === 'vertex' && activePart && sel.verts.size === 1 ? (
              <Pressable
                onPress={() => {
                  const vi = [...sel.verts][0];
                  if (bevelVertex(activePart.mesh, vi, STUDIO.bevelMeters) === activePart.mesh) { toast('bevel needs a corner with 3+ edges'); return; }
                  openBevel('vertex', vi);
                }}
                tooltip="Bevel vertex — chamfer the selected corner; opens a popup to size the bevel before applying (corners with 3+ edges)"
                style={{ ...STEP_BTN, backgroundColor: bv?.kind === 'vertex' ? '#1c3a2a' : '#13233aee', borderColor: bv?.kind === 'vertex' ? '#2f7a4f' : '#2c4a6a' }}
              >
                <Text fontSize={10} color={bv?.kind === 'vertex' ? '#7fd6a0' : T.dim} style={{ fontFamily: 'monospace' }}>bevel</Text>
              </Pressable>
            ) : null}
            {/* create EDGE (req_1265): in VERTEX mode, exactly TWO non-adjacent corners
                of a face → cut a new edge across it, splitting the face (Blender's
                Connect Vertex). Edges are face-derived here, so this is how one is made. */}
            {selMode === 'vertex' && activePart && sel.verts.size === 2 ? (
              <Pressable
                onPress={() => {
                  const [vA, vB] = [...sel.verts];
                  const out = connectVerts(activePart.mesh, vA, vB);
                  if (out && out !== activePart.mesh) { props.onEditMesh(activePart.id, out); setSel(emptySelection()); }
                  else toast('pick two non-adjacent corners of one face');
                }}
                tooltip="Create edge — connect two corners of a face with a new edge, splitting the face (Blender's Connect Vertex)"
                style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#2c4a6a' }}
              >
                <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>create edge</Text>
              </Pressable>
            ) : null}
            {/* create face (req_1059, req_1164): in EDGE mode, ANY ≥2 selected edges
                — a closed loop fills as one n-gon, two chains loft a bridging strip
                (a 4-edge side to a 2-edge side); in VERTEX mode, 3–4 verts → tri/quad. */}
            {activePart && ((selMode === 'edge' && sel.edges.size >= 2) || (selMode === 'vertex' && (sel.verts.size === 3 || sel.verts.size === 4))) ? (
              <Pressable
                onPress={() => {
                  const mesh = activePart.mesh;
                  let out: EditMesh | null = null;
                  if (selMode === 'edge') {
                    const E = meshEdges(mesh);
                    const edges = [...sel.edges].map((i) => E[i]).filter(Boolean);
                    out = createFaceFromEdges(mesh, edges);
                  } else {
                    out = createFaceFromVerts(mesh, sel.verts);
                  }
                  if (out && out !== mesh) { props.onEditMesh(activePart.id, out); setSel(emptySelection()); }
                }}
                tooltip="Create face — fill the selection: 2+ edges (a loop → n-gon, two chains → a bridge) or 3–4 verts → a tri/quad"
                style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#2c4a6a' }}
              >
                <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>create face</Text>
              </Pressable>
            ) : null}
            {/* WHEEL CENTRE (req_1202): select the wheel-well arch verts → fit a circle
                to them; its centre is the exact axle, its radius the tire size. Drops
                a 'wheel' socket joint there (mirror-aware → both/all wheels at once). */}
            {selMode === 'vertex' && activePart && sel.verts.size >= 3 ? (
              <Pressable
                onPress={() => {
                  const mesh = activePart.mesh;
                  const fit = fitWheelCenter([...sel.verts].map((i) => mesh.verts[i]).filter(Boolean));
                  if (!fit) { toast('pick 3+ arch verts that form a curve'); return; }
                  const name = nextJointName(mesh);
                  // the SPIN axis IS the axle = the well's normal (fit.axis), not a
                  // hardcoded Z — so the wheel rolls correctly however the car is oriented.
                  const spin: MV3 = [fit.axis === 0 ? 1 : 0, fit.axis === 1 ? 1 : 0, fit.axis === 2 ? 1 : 0];
                  let out = addMount(mesh, { name, kind: 'socket', position: [fit.center[0], fit.center[1], fit.center[2]], axis: spin, limit: { full: true } });
                  if (mirrorAxes.length) out = addMountReflections(out, name, mirrorAxes);
                  props.onEditMesh(activePart.id, out);
                  setSel(emptySelection()); setSelMode('rig'); setRigSel({ kind: 'joint', name });
                  toast(`wheel @ centre · tire radius ≈ ${fmtUnits(metersToUnits(fit.radius)).replace('+', '')}${mirrorAxes.length ? ' (mirrored)' : ''}`);
                }}
                tooltip="Wheel center — fit a circle to the selected wheel-well arch verts and drop an axle JOINT at the exact centre (mount a wheel part here). Mirror-aware"
                style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#2c6a4a' }}
              >
                <Text fontSize={10} color="#7fd6a0" style={{ fontFamily: 'monospace' }}>⌖ wheel center</Text>
              </Pressable>
            ) : null}
            {/* MAKE WHEEL (req_1206): fit the well → GENERATE a tire of that exact
                radius at the centre, merged into the body (so it re-seats on the
                tire bottoms = ride height). Mirror-aware → both/all wheels at once. */}
            {selMode === 'vertex' && activePart && sel.verts.size >= 3 ? (
              <Pressable
                onPress={() => {
                  const mesh = activePart.mesh;
                  const fit = fitWheelCenter([...sel.verts].map((i) => mesh.verts[i]).filter(Boolean));
                  if (!fit) { toast('pick 3+ arch verts that form a curve'); return; }
                  const wheel = wheelMesh(fit.radius, fit.radius * STUDIO.wheelWidthFraction, STUDIO.wheelSides, fit.axis);
                  // every non-empty subset of the enabled mirror planes → a reflected copy.
                  const centers: MV3[] = [[fit.center[0], fit.center[1], fit.center[2]]];
                  for (let m = 1; m < (1 << mirrorAxes.length); m += 1) {
                    const c: MV3 = [fit.center[0], fit.center[1], fit.center[2]];
                    for (let k = 0; k < mirrorAxes.length; k += 1) if (m & (1 << k)) c[mirrorAxes[k]] = -c[mirrorAxes[k]];
                    centers.push(c);
                  }
                  let out = mesh;
                  for (const c of centers) out = mergeMesh(out, wheel, c);
                  props.onEditMesh(activePart.id, out);
                  setSel(emptySelection());
                  toast(`wheel${centers.length > 1 ? `s ×${centers.length}` : ''} · radius ${fmtUnits(metersToUnits(fit.radius)).replace('+', '')} — resize/split as needed`);
                }}
                tooltip="Make wheel — fit the well and GENERATE a tire of that exact radius merged into the body (car auto-seats on the tire bottoms). Mirror-aware → all wheels at once"
                style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#2c6a4a' }}
              >
                <Text fontSize={10} color="#7fd6a0" style={{ fontFamily: 'monospace' }}>⊚ make wheel</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
        {/* TEXTURE (req_1068): the GLOBAL "textureize" — takes the whole scene and
            builds one packed sprite-map atlas via the Create Texture dialog (the
            Blockbench flow). The toggle flips between the textured atlas and solid
            once a texture exists. Painting the islands is the deferred next step. */}
        {props.parts.length > 0 ? (
          <>
            <Box style={{ width: 1, height: 16, backgroundColor: '#2c4a6a', marginLeft: 4, marginRight: 4 }} />
            <Pressable
              onPress={() => setTexDialog(true)}
              tooltip="Textureize — unwrap the whole model into one packed sprite-sheet atlas you can paint / export / AI-fill"
              style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#2c6a4a' }}
            >
              <Text fontSize={10} color="#7fd6a0" style={{ fontFamily: 'monospace' }}>textureize</Text>
            </Pressable>
            {/* COMPILE (req_1122, Part 7): cook this model into a typed, installed
                game asset (prop first). Choose the kind → fill its descriptor →
                validate → cook → it lands in the kind's catalog. */}
            <Pressable
              onPress={() => setCompileOpen(true)}
              tooltip="Compile — cook this model into a typed, installed game asset (prop/vehicle): pick the kind, fill its descriptor, it lands in the catalog"
              style={{ ...STEP_BTN, backgroundColor: '#16132aee', borderColor: '#8a6f3a' }}
            >
              <Text fontSize={10} color="#e9c77f" style={{ fontFamily: 'monospace' }}>⚙ compile</Text>
            </Pressable>
            {tex ? (
              <>
                <Pressable
                  onPress={() => setTexView((v) => !v)}
                  tooltip="Toggle the textured atlas vs solid part colours in the viewport"
                  style={{ ...STEP_BTN, backgroundColor: texView ? '#1c3a2a' : '#13233aee', borderColor: texView ? '#2f7a4f' : '#2c4a6a' }}
                >
                  <Text fontSize={10} color={texView ? '#7fd6a0' : T.dim} style={{ fontFamily: 'monospace' }}>{texView ? 'textured' : 'solid'}</Text>
                </Pressable>
                {/* export PNG (req_1072): the whole sprite sheet, or ONE slice (the
                    selected face's island) — to cart/hmsc-int/exports/<name>.png. */}
                <Pressable onPress={() => exportSprite()} tooltip="Export the whole texture atlas as a PNG (to cart/hmsc-int/exports/) to edit externally" style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#2c4a6a' }}>
                  <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>export sheet</Text>
                </Pressable>
                {/* re-upload PNG (req_1079): the edited/AI-generated sheet slips back
                    onto the model (cookie-cutter via the UVs), or one face's slice. */}
                <Pressable onPress={() => setImportTex({})} tooltip="Import an edited/AI PNG back onto the model — re-applied through the UVs (cookie-cutter)" style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#3a2c6a' }}>
                  <Text fontSize={10} color="#b9a8e9" style={{ fontFamily: 'monospace' }}>import sheet</Text>
                </Pressable>
                {/* AI fill (req_1070/1110): generate the whole sheet via image-to-image
                    (the current atlas is the reference) — no leaving the app. */}
                <Pressable onPress={() => setAiTex({})} tooltip="AI fill — generate the whole texture sheet via image-to-image (current atlas as reference), without leaving the app" style={{ ...STEP_BTN, backgroundColor: '#1a1330ee', borderColor: '#6a4fb0' }}>
                  <Text fontSize={10} color="#cdbcff" style={{ fontFamily: 'monospace' }}>✦ ai fill</Text>
                </Pressable>
                {selMode === 'face' && activePart && sel.faces.size === 1 ? (
                  <>
                    <Pressable onPress={() => exportSprite({ partId: activePart.id, faceIndex: [...sel.faces][0] })} tooltip="Export just the selected face's UV island as a PNG" style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#2c4a6a' }}>
                      <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>export slice</Text>
                    </Pressable>
                    <Pressable onPress={() => setImportTex({ slice: { partId: activePart.id, faceIndex: [...sel.faces][0] } })} tooltip="Import a PNG onto just the selected face's island" style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#3a2c6a' }}>
                      <Text fontSize={10} color="#b9a8e9" style={{ fontFamily: 'monospace' }}>import slice</Text>
                    </Pressable>
                    <Pressable onPress={() => setAiTex({ slice: { partId: activePart.id, faceIndex: [...sel.faces][0] } })} tooltip="AI-fill just the selected face's island via image-to-image" style={{ ...STEP_BTN, backgroundColor: '#1a1330ee', borderColor: '#6a4fb0' }}>
                      <Text fontSize={10} color="#cdbcff" style={{ fontFamily: 'monospace' }}>✦ ai fill slice</Text>
                    </Pressable>
                  </>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </Row>

      {/* export confirmation toast (req_1072) */}
      {exportMsg ? (
        <Box style={{ position: 'absolute', left: 0, right: 0, bottom: 54, alignItems: 'center' }}>
          <Box style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#0b1320ee', borderWidth: 1, borderColor: '#2f7a4f' }}>
            <Text fontSize={10} color="#7fd6a0" style={{ fontFamily: 'monospace' }}>{exportMsg}</Text>
          </Box>
        </Box>
      ) : null}

      {/* SIZE READOUT (req_1185): the focused selection's measured dimensions, so the
          size of a face/edge/vert never has to be remembered. Reads the LIVE mesh
          (draft during a drag → updates as you resize). Units are modeling units
          (16u = 1 tile = 1 m). Stacked above the compass, bottom-left. */}
      {(() => {
        if (!activePart || !activeMesh) return null;
        // while the bevel popup is open the draft is re-topologized, so the stale
        // selection indices don't map — hide the readout (the popup shows the width).
        if (bv) return null;
        const idx = selMode === 'object'
          ? activeMesh.verts.map((_, i) => i)
          : selMode === 'rig' ? [] : selectionVertIndices(activeMesh, selMode, sel);
        if (idx.length === 0) return null;
        const b = vertsBounds(activeMesh, idx);
        const u = (mtr: number) => { const v = Math.round(metersToUnits(mtr) * 100) / 100; return Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2); };
        const cnt = selMode === 'vertex' ? sel.verts.size : selMode === 'edge' ? sel.edges.size : selMode === 'face' ? sel.faces.size : 0;
        let head: string;
        let body: string;
        if (selMode === 'edge' && sel.edges.size === 1) {
          const e = meshEdges(activeMesh)[[...sel.edges][0]];
          const a = activeMesh.verts[e[0]], c = activeMesh.verts[e[1]];
          head = 'edge';
          body = `${u(Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]))}u long`;
        } else {
          head = selMode === 'object' ? (activePart.name || 'object') : `${cnt} ${selMode}${cnt === 1 ? '' : 's'}`;
          body = `${u(b.size[0])} × ${u(b.size[1])} × ${u(b.size[2])} u`;
        }
        return (
          <Box style={{ position: 'absolute', left: 14, bottom: 100, paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: '#0b1320ee', borderWidth: 1, borderColor: '#2c4a6a' }}>
            <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace' }}>{head}</Text>
            <Row style={{ gap: 4, alignItems: 'baseline', marginTop: 1 }}>
              {selMode === 'edge' && sel.edges.size === 1
                ? <Text fontSize={12} color="#cfe2ff" style={{ fontFamily: 'monospace', fontWeight: '800' }}>{body}</Text>
                : <>
                    <Text fontSize={8} color="#e0584e" style={{ fontFamily: 'monospace' }}>X</Text>
                    <Text fontSize={12} color="#cfe2ff" style={{ fontFamily: 'monospace', fontWeight: '800' }}>{u(b.size[0])}</Text>
                    <Text fontSize={8} color="#5ec26a" style={{ fontFamily: 'monospace' }}>Y</Text>
                    <Text fontSize={12} color="#cfe2ff" style={{ fontFamily: 'monospace', fontWeight: '800' }}>{u(b.size[1])}</Text>
                    <Text fontSize={8} color="#4aa3ff" style={{ fontFamily: 'monospace' }}>Z</Text>
                    <Text fontSize={12} color="#cfe2ff" style={{ fontFamily: 'monospace', fontWeight: '800' }}>{u(b.size[2])}</Text>
                    <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace' }}>u</Text>
                  </>}
            </Row>
          </Box>
        );
      })()}

      <ViewCompass lookRef={lookRef} onFace={faceAxis} />

      {/* The selected joint's METADATA (name/type/axis/limit) is edited in workspace
          column 3 (RigMetaPanel, req_1053) — the viewport just places it. */}

      {/* Camera framing controls (fov + reframe) — kept bottom-right. */}
      <Col style={{ position: 'absolute', right: 12, bottom: 12, gap: 6, alignItems: 'flex-end' }}>
        <Row style={{ gap: 4, alignItems: 'center' }}>
          <Pressable onPress={() => setFov(fovRef.current - 2)} tooltip="Narrower field of view (zoom in / less perspective)" style={STEP_BTN}><Text fontSize={13} color={T.text}>−</Text></Pressable>
          <Box style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5, borderRadius: 5, backgroundColor: '#0b1320dd', borderWidth: 1, borderColor: '#27364a' }}>
            <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>fov {Math.round(fovRef.current)}</Text>
          </Box>
          <Pressable onPress={() => setFov(fovRef.current + 2)} tooltip="Wider field of view (zoom out / more perspective)" style={STEP_BTN}><Text fontSize={13} color={T.text}>+</Text></Pressable>
        </Row>
        <Pressable onPress={reframe} tooltip="Reframe (F) — recenter the camera on the model" style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 5, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' }}>
          <Text fontSize={10} color={T.text}>reframe (F)</Text>
        </Pressable>
      </Col>

      {lc && lcAxisInfo ? (
        <LoopCutPopup
          dir={lc.dir}
          cuts={lc.cuts}
          offset={lc.offset}
          unit={lc.unit}
          sizeUnits={lcAxisInfo.sizeUnits}
          onChange={(patch) => setLc((s) => {
            if (!s) return s;
            const next = { ...s, ...patch };
            // Changing the cut axis (direction) RE-CENTERS the offset on the NEW
            // axis. The face's extent differs per axis — after N cuts on axis A
            // the face is narrow on A but still full on B — so carrying the old
            // offset across mis-places the FIRST cut on the fresh axis as if it
            // continued A's sequence (the "5th slice on a new face" bug, req_1010).
            if (patch.dir !== undefined && patch.dir !== s.dir && activePart) {
              const info = loopCutAxisInfo(activePart.mesh, s.faceIndex, patch.dir);
              if (info) next.offset = next.unit === 'percent' ? 50 : Math.round(info.sizeUnits / 2);
            }
            return next;
          })}
          onApply={() => closeLoopCut(true)}
          onCancel={() => closeLoopCut(false)}
        />
      ) : null}

      {/* Bevel sizing (req_1266): grow/shrink the live-previewed chamfer, then Apply. */}
      {bv && activePart ? (
        <BevelPopup
          kind={bv.kind}
          width={bv.width}
          maxUnits={bevelMaxUnits(bv.kind, bv.index)}
          onChange={(w) => setBv((s) => (s ? { ...s, width: w } : s))}
          onApply={() => closeBevel(true)}
          onCancel={() => closeBevel(false)}
        />
      ) : null}

      {autoFix ? <ConcaveFixPopup count={autoFix.count} onResolve={resolveAutoFix} /> : null}

      {/* Create Texture (req_1068): the global textureize dialog. Confirm packs the
          whole scene into one sprite-map atlas, rewrites every part's UVs (a BRANCH
          edit each), records the atlas params, and shows the texture. */}
      {texDialog ? (
        <CreateTextureDialog
          onCancel={() => setTexDialog(false)}
          onConfirm={(o) => {
            const result = textureizeScene(props.parts.map((p) => p.mesh), o, STUDIO.unitsPerTile);
            result.meshes.forEach((mesh, i) => { if (mesh !== props.parts[i].mesh) props.onEditMesh(props.parts[i].id, mesh); });
            setTex({ texels: result.texels, type: o.type, color: o.color, name: o.name || 'texture' });
            setTexView(true);
            setTexDialog(false);
          }}
        />
      ) : null}

      {/* Compile Asset (req_1122, Part 7): choose the kind, fill its descriptor,
          validate, cook → install into the content store. Prop kind first; the
          texture factor (compressed WebP) folds in with the bake/rebuild slice, so
          a v1 prop cooks untextured (it still carries its per-face UVs). */}
      {compileOpen ? (
        <CompileAssetDialog
          sceneName={props.sceneName}
          onCancel={() => setCompileOpen(false)}
          onCook={(descriptor) => {
            const base = (props.sceneName || 'asset').replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
            const result = cookProp({ id: `studio.${base}`, name: props.sceneName || 'Asset', parts: props.parts, descriptor });
            if (result.errors.length > 0) { toast(`can't compile: ${result.errors[0]}`); return; }
            cooked.install(result);
            const d = result.asset.descriptor;
            const nature = d.dynamics ? `kickable r${d.dynamics.bodyRadiusMeters.toFixed(2)} b${d.dynamics.restitution.toFixed(2)}` : (d.solid ? 'static' : 'foliage');
            toast(`compiled ${result.asset.name} → prop · ${nature}  ${d.footprintWidthMeters.toFixed(1)}×${d.footprintDepthMeters.toFixed(1)}×${d.heightMeters.toFixed(1)}m`);
            setCompileOpen(false);
          }}
        />
      ) : null}

      {/* Import Texture (req_1079): re-upload an edited / AI-generated PNG. The
          default path is this scene's export, so the round-trip is one click. */}
      {importTex ? (
        <ImportTextureDialog
          slice={importTex.slice}
          defaultPath={`cart/hmsc-int/exports/${(props.sceneName || tex?.name || 'texture').replace(/[^a-z0-9_-]+/gi, '_')}${importTex.slice ? `_face${importTex.slice.faceIndex}` : ''}.png`}
          onCancel={() => setImportTex(null)}
          onConfirm={(path) => importTexture(path, importTex.slice)}
        />
      ) : null}

      {/* BACKDROPS (req_1280): the trace-image setup modal. Closing it leaves the
          planes in the viewport so you model over them. */}
      {backdropPanel ? (
        <BackdropsPanel
          backdrops={backdrops}
          activeId={moveBackdropId}
          onAdd={addBackdrop}
          onUpdate={updateBackdrop}
          onRemove={removeBackdrop}
          onMove={startMoveBackdrop}
          onClose={() => setBackdropPanel(false)}
        />
      ) : null}

      {/* AI Fill (req_1070/1110, Phase 5d): automated image-to-image. Generate the
          whole sheet or one island via the nano-gpt image client, the current atlas as
          the img2img reference; optional prompt enhancement (nano-gpt text OR Claude). */}
      {aiTex ? (
        <AiTextureDialog
          slice={aiTex.slice}
          target={aiTex.slice ? `${props.activeName ?? 'part'} face ${aiTex.slice.faceIndex}` : (props.sceneName || tex?.name || 'texture')}
          getReference={() => referenceB64(aiTex.slice)}
          onCancel={() => setAiTex(null)}
          onGenerated={(b64) => {
            applyTextureImage(texSource(b64), aiTex.slice);
            setAiTex(null);
            toast(`AI filled ${aiTex.slice ? `face ${aiTex.slice.faceIndex}` : 'the sheet'}`);
          }}
        />
      ) : null}
    </Pressable>
  );
}

// The concave Auto-Fix alert (req_0949/req_1016): an edit buckled a quad into a
// non-convex (reflex-corner) face. The mesh is NOT silently triangulated — this
// LOUD dialog (the buckled face still previewed behind it) makes the user choose:
// Split Quads (the recommended fix) / Ignore (commit it concave) / Revert (drop it).
function ConcaveFixPopup(props: { count: number; onResolve: (a: 'split' | 'ignore' | 'revert') => void }) {
  return (
    <Box style={{ position: 'absolute', left: 0, right: 0, bottom: 18, alignItems: 'center' }}>
      <Col style={{ gap: 8, paddingLeft: 14, paddingRight: 14, paddingTop: 11, paddingBottom: 11, borderRadius: 9, backgroundColor: '#1a1206f2', borderWidth: 1, borderColor: '#a86a2c', minWidth: 280 }}>
        <Row style={{ gap: 8, alignItems: 'center' }}>
          <Text fontSize={12} color="#ffb454" style={{ fontWeight: '800' }}>⚠ Concave face</Text>
          <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>
            {`${props.count} face${props.count === 1 ? '' : 's'} buckled — not convex`}
          </Text>
        </Row>
        <Row style={{ gap: 6 }}>
          <Pressable onPress={() => props.onResolve('split')} style={{ flexGrow: 1, paddingTop: 6, paddingBottom: 6, borderRadius: 6, alignItems: 'center', backgroundColor: '#1c3a2a', borderWidth: 1, borderColor: '#2f7a4f' }}>
            <Text fontSize={11} color="#7fd6a0" style={{ fontWeight: '800' }}>Split Quads</Text>
          </Pressable>
          <Pressable onPress={() => props.onResolve('ignore')} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, alignItems: 'center', backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' }}>
            <Text fontSize={11} color={T.dim}>Ignore</Text>
          </Pressable>
          <Pressable onPress={() => props.onResolve('revert')} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, alignItems: 'center', backgroundColor: '#3a1c1c', borderWidth: 1, borderColor: '#7a2f2f' }}>
            <Text fontSize={11} color="#e08a8a">Revert</Text>
          </Pressable>
        </Row>
        <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace' }}>Split Quads is recommended — keeps the surface valid.</Text>
      </Col>
    </Box>
  );
}

function StatCell(props: { label: string; value: string; warn?: boolean }) {
  return (
    <Row style={{ gap: 3, alignItems: 'baseline' }}>
      <Text fontSize={8} color={T.dim} style={{ fontFamily: 'monospace' }}>{props.label}</Text>
      <Text fontSize={9} color={props.warn ? '#ffb454' : T.text} style={{ fontFamily: 'monospace', fontWeight: '800' }}>{props.value}</Text>
    </Row>
  );
}

// ── View-orientation compass (the navigation gizmo — req_0969, playbook 4b#1) ──
// A corner widget that always shows the camera's orientation (the ±X/Y/Z axis
// ends projected through the live view basis) and snaps the view to face an axis
// when you click its ball. A 2D projection of the camera basis for now (hot-
// reload); it graduates to the host screen-stable overlay with the gizmo/grid.

const DEG = Math.PI / 180;
type V3 = [number, number, number];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

const COMPASS = { size: 78, radius: 25, posR: 9, negR: 6 } as const;
// the 6 axis ends. faceYaw/facePitch = orbit angles that look ALONG this axis
// (camera on that side, looking at the origin). NaN yaw = a pole → keep current
// yaw. Convention from camera.zig orbitalEye: yaw=atan2(-ox,-oz), pitch=asin(oy).
const COMPASS_AXES: { key: string; dir: V3; color: string; label: string; pos: boolean; faceYaw: number; facePitch: number }[] = [
  { key: '+x', dir: [1, 0, 0], color: '#e0584e', label: 'X', pos: true, faceYaw: -90, facePitch: 0 },
  { key: '-x', dir: [-1, 0, 0], color: '#e0584e', label: '', pos: false, faceYaw: 90, facePitch: 0 },
  { key: '+y', dir: [0, 1, 0], color: '#5ec26a', label: 'Y', pos: true, faceYaw: NaN, facePitch: 89.9 },
  { key: '-y', dir: [0, -1, 0], color: '#5ec26a', label: '', pos: false, faceYaw: NaN, facePitch: -89.9 },
  { key: '+z', dir: [0, 0, 1], color: '#4aa3ff', label: 'Z', pos: true, faceYaw: 180, facePitch: 0 },
  { key: '-z', dir: [0, 0, -1], color: '#4aa3ff', label: '', pos: false, faceYaw: 0, facePitch: 0 },
];

function ViewCompass(props: { lookRef: { current: { yaw: number; pitch: number } }; onFace: (yaw: number, pitch: number) => void }) {
  // Self-tick to mirror the camera live (the spin is host/ref-driven, so the
  // parent doesn't re-render). Isolated → never touches the Scene3D tree.
  const repaint = useRerender();
  useInterval(repaint, 33);

  const { yaw, pitch } = props.lookRef.current;
  const yr = yaw * DEG, pr = pitch * DEG;
  // forward = -eye_offset (camera.zig orbitalEye); right/up complete the basis.
  const F: V3 = [Math.sin(yr) * Math.cos(pr), -Math.sin(pr), Math.cos(yr) * Math.cos(pr)];
  const R = norm3(cross3(F, [0, 1, 0]));
  const U = cross3(R, F);
  const c = COMPASS.size / 2;
  const ends = COMPASS_AXES.map((ax) => {
    const sx = dot3(ax.dir, R), sy = dot3(ax.dir, U), depth = dot3(ax.dir, F);
    return { ax, px: c + sx * COMPASS.radius, py: c - sy * COMPASS.radius, depth };
  }).sort((a, b) => b.depth - a.depth); // far first → near drawn on top

  return (
    <Box style={{ position: 'absolute', left: 14, bottom: 14, width: COMPASS.size, height: COMPASS.size, borderRadius: COMPASS.size / 2, backgroundColor: '#0b1320bb', borderWidth: 1, borderColor: '#27364a' }}>
      {ends.filter((e) => e.ax.pos).map((e) => {
        const dx = e.px - c, dy = e.py - c;
        const len = Math.hypot(dx, dy) || 0.001;
        const angle = Math.atan2(dy, dx) / DEG;
        return <Box key={`l${e.ax.key}`} style={{ position: 'absolute', left: (c + e.px) / 2 - len / 2, top: (c + e.py) / 2 - 1, width: len, height: 2, borderRadius: 1, backgroundColor: e.ax.color, opacity: 0.65, transform: { rotate: angle } }} />;
      })}
      <Box style={{ position: 'absolute', left: c - 3, top: c - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: '#d98a4a' }} />
      {ends.map((e) => {
        const r = e.ax.pos ? COMPASS.posR : COMPASS.negR;
        return (
          <Pressable key={e.ax.key} onPress={() => props.onFace(e.ax.faceYaw, e.ax.facePitch)} tooltip={`face ${e.ax.key}`} style={{ position: 'absolute', left: e.px - r, top: e.py - r, width: r * 2, height: r * 2 }}>
            <Box style={{ width: r * 2, height: r * 2, borderRadius: r, alignItems: 'center', justifyContent: 'center', backgroundColor: e.ax.pos ? e.ax.color : '#0b1320', borderWidth: e.ax.pos ? 0 : 2, borderColor: e.ax.color, opacity: e.ax.pos ? 1 : 0.62 }}>
              {e.ax.label ? <Text fontSize={9} color="#08101c" style={{ fontWeight: '800', fontFamily: 'monospace' }}>{e.ax.label}</Text> : null}
            </Box>
          </Pressable>
        );
      })}
    </Box>
  );
}

// Isolated so its 5 Hz probe re-renders never touch the Scene3D tree. Now a THIN
// horizontal strip (req_0981) — the key frame stats inline (fps · frame/worst ms
// · skips · gc · present) so the readout sits in the top-right toolbar beside the
// smooth/log/fps levers rather than as a tall corner box. The once-per-second
// [studio-frames] terminal warn stays gated behind `logToTerminal` (the 'log cam'
// toggle), default OFF so the dev terminal stays silent until re-armed.
function FrameDiagBar(props: { logToTerminal: boolean }) {
  const [resetSeq, setResetSeq] = useState(0);
  const diag = useFrameProbe({ active: true, pollMs: 200, resetSeq, logToTerminal: props.logToTerminal });
  return (
    <Row style={{ gap: 8, alignItems: 'center', paddingLeft: 9, paddingRight: 6, paddingTop: 4, paddingBottom: 4, borderRadius: 6, backgroundColor: '#0b1320e8', borderWidth: 1, borderColor: '#27364a' }}>
      <Text fontSize={8} color={T.text} style={{ fontFamily: 'monospace', fontWeight: '800' }}>FRAMES</Text>
      {diag.live ? (
        <>
          <StatCell label="fps" value={`${diag.fps.toFixed(0)}`} warn={diag.fps > 0 && diag.fps < 50} />
          <StatCell label="ms" value={`${diag.medianMs.toFixed(1)}/${diag.worstMs.toFixed(1)}`} warn={diag.worstMs > diag.medianMs * 2 + 1} />
          <StatCell label="skip" value={`${diag.peakSkips}`} warn={diag.peakSkips > 0} />
          <StatCell label="gc" value={`${diag.gcMs.toFixed(1)}`} warn={diag.gcMs > 1} />
          <StatCell label="pres" value={`${diag.presentMs.toFixed(1)}`} warn={diag.presentMs > diag.medianMs + 2} />
          {/* TEXT RESOURCE gauges (req_1279): when the compass letters (or any text)
              silently vanish, one of these is at cap. glyph = per-frame buffer
              (trailing text drops); atlas = distinct-glyph cache (new combos can't
              rasterize, no eviction). warn at 90%. */}
          <StatCell label="glyph" value={`${diag.glyphCount}/${diag.glyphCap}`} warn={diag.glyphCap > 0 && diag.glyphCount >= diag.glyphCap * 0.9} />
          <StatCell label="atlas" value={`${diag.atlasCount}/${diag.atlasCap}`} warn={diag.atlasCap > 0 && diag.atlasCount >= diag.atlasCap * 0.9} />
        </>
      ) : (
        <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace' }}>no telemetry…</Text>
      )}
      <Pressable onPress={() => setResetSeq((n) => n + 1)} tooltip="Reset the FRAMES counters (clear the worst-ms / skip / gc peaks and start fresh)" style={STEP_BTN}><Text fontSize={8} color={T.dim}>↺</Text></Pressable>
    </Row>
  );
}

// ── Add-mesh dialog (req_0972/0973) ───────────────────────────────────────────
// The first shape is a cube; pick its diameter (= width = depth) and height in
// MODELING UNITS (Blockbench-style: 16 units = 1 tile = 1 m, the same basis
// per-face UV/texels use), then confirm. Default 16 fills exactly the center
// tile's 16×16 grid. This changes nothing about the grid — the grid IS the ruler
// these units read against (USER req_0973).

function NumberField(props: { label: string; value: number; onChange: (n: number) => void; min: number; max: number; step: number; snap: number; suffix?: string }) {
  const set = (n: number) => props.onChange(clamp(Math.round(n / props.snap) * props.snap, props.min, props.max));
  return (
    <Row style={{ gap: 8, alignItems: 'center' }}>
      <Text fontSize={11} color={T.dim} style={{ width: 64, fontFamily: 'monospace' }}>{props.label}</Text>
      <Pressable onPress={() => set(props.value - props.step)} style={STEP_BTN}><Text fontSize={13} color={T.text}>−</Text></Pressable>
      <Box style={{ width: 66 }}>
        <TextInput
          value={String(props.value)}
          onChangeText={(t: string) => { const n = parseFloat(t); if (Number.isFinite(n)) set(n); }}
          style={{ height: 24, fontSize: 12, color: T.ink, backgroundColor: T.page, borderWidth: 1, borderColor: '#2c4a6a', borderRadius: 4, paddingHorizontal: 6, textAlign: 'center', fontFamily: 'monospace' }}
        />
      </Box>
      <Pressable onPress={() => set(props.value + props.step)} style={STEP_BTN}><Text fontSize={13} color={T.text}>+</Text></Pressable>
      {props.suffix ? <Text fontSize={10} color={T.dim}>{props.suffix}</Text> : null}
    </Row>
  );
}

// The "Add" dialog (req_1056): pick a SHAPE beyond the cube, set its Blockbench
// params — diameter (= width = depth) + height, plus a "sides" count (3..48) for
// the round shapes — and confirm. Builds the topological EditMesh so the new part
// is fully editable (loop cut / extrude / rig), unlike the render-only geometry
// registry. cuboid/cylinder/cone/pyramid/plane share the 16-units basis.
type ShapeKind = 'cube' | 'cylinder' | 'cone' | 'pyramid' | 'plane' | 'sphere' | 'icosphere';
const SHAPE_KINDS: { kind: ShapeKind; label: string }[] = [
  { kind: 'cube', label: 'Cube' }, { kind: 'cylinder', label: 'Cylinder' }, { kind: 'cone', label: 'Cone' },
  { kind: 'pyramid', label: 'Pyramid' }, { kind: 'plane', label: 'Plane' },
  { kind: 'sphere', label: 'Sphere' }, { kind: 'icosphere', label: 'Icosphere' },
];
// round-bodied shapes (sphere/icosphere) are sized by DIAMETER alone — no separate
// height — and the 'sides' knob means longitude segments (icosphere uses subdiv).
const ROUND_BODIES: ShapeKind[] = ['sphere', 'icosphere'];

// START FROM A BUILD PRIMITIVE (req_1684/1693): the same wall/floor/stairs the iso
// world editor places, opened as an editable mesh so you can cut a window, bolt on a
// poster, or add a railing — then Compile it back out as a custom placeable piece.
// Each seed lowers a real BUILD_CATALOG piece through seedMeshFromPiece (the shared
// pieceVisualShapes decomposition), so the mesh matches what the world editor renders.
const BUILD_SEEDS: { key: string; pieceId: string; edit?: string; label: string }[] = [
  { key: 'wall', pieceId: 'wall.concrete.common', label: 'Wall' },
  { key: 'halfwall', pieceId: 'wall.concrete.common', edit: 'halfHeight', label: 'Half Wall' },
  { key: 'window', pieceId: 'wall.stucco.window', label: 'Window Wall' },
  { key: 'door', pieceId: 'wall.concrete.doorway', label: 'Door Wall' },
  { key: 'garage', pieceId: 'wall.metal.garageDoor', label: 'Garage Door' },
  { key: 'floor', pieceId: 'floor.concrete.common', label: 'Floor' },
  { key: 'stairs', pieceId: 'stairs.concrete.common', label: 'Stairs' },
  { key: 'ramp', pieceId: 'ramp.concrete.common', label: 'Ramp' },
];

function AddShapeDialog(props: { onCancel: () => void; onConfirm: (mesh: EditMesh, name: string) => void }) {
  const u = STUDIO.unitsPerTile;
  const [shape, setShape] = useState<ShapeKind>('cube');
  // When set, the part is SEEDED from a build piece instead of a parametric shape —
  // the shape sliders hide (a catalog piece carries its own authored size).
  const [seedKey, setSeedKey] = useState<string | null>(null);
  const seed = seedKey ? BUILD_SEEDS.find((s) => s.key === seedKey) ?? null : null;
  const [dia, setDia] = useState(u);   // default 16 u = one tile
  const [hgt, setHgt] = useState(u);
  const [sides, setSides] = useState(16);
  const [subdiv, setSubdiv] = useState(1); // icosphere subdivisions
  const hasHeight = !seed && shape !== 'plane' && !ROUND_BODIES.includes(shape);
  const hasSides = !seed && (shape === 'cylinder' || shape === 'cone' || shape === 'sphere');
  const hasSubdiv = !seed && shape === 'icosphere';
  const fmtTiles = (units: number) => `${(units / u).toFixed(2)} tile`;
  const meta = SHAPE_KINDS.find((s) => s.kind === shape)!;
  const confirmName = seed ? seedNameFromPiece(seed.pieceId) : meta.label;
  const build = (): EditMesh => {
    if (seed) return seedMeshFromPiece(seed.pieceId, seed.edit);
    const d = unitsToMeters(dia), h = unitsToMeters(hgt), r = unitsToMeters(dia) / 2;
    switch (shape) {
      case 'cylinder': return cylinder(r, h, sides);
      case 'cone': return cone(r, h, sides);
      case 'pyramid': return pyramid(d, h, d);
      case 'plane': return plane(d, d);
      case 'sphere': return sphere(r, sides);
      case 'icosphere': return icosphere(r, subdiv);
      default: return cuboid(d, h, d);
    }
  };
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#03060caa' }}>
      <Col style={{ width: 360, gap: 11, padding: 16, borderRadius: 10, backgroundColor: T.panelSolid, borderWidth: 1, borderColor: '#2c4a6a' }}>
        <Text fontSize={13} color={T.text} style={{ fontWeight: '800' }}>Add Shape</Text>
        <Row style={{ gap: 5, flexWrap: 'wrap' }}>
          {SHAPE_KINDS.map((s) => {
            const on = !seed && shape === s.kind;
            return <Pressable key={s.kind} onPress={() => { setShape(s.kind); setSeedKey(null); }} style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: on ? '#2a3f5e' : '#13233aee', borderWidth: 1, borderColor: on ? '#5b8fd6' : '#2c4a6a' }}><Text fontSize={11} color={on ? '#cfe2ff' : T.dim} style={{ fontFamily: 'monospace' }}>{s.label}</Text></Pressable>;
          })}
        </Row>
        {/* START FROM A BUILD PIECE (req_1693): seed the editor with a real wall/floor/
            stairs to modify + Compile back into a custom placeable piece. */}
        <Text fontSize={10} color={T.dim} style={{ marginTop: 2 }}>From build piece</Text>
        <Row style={{ gap: 5, flexWrap: 'wrap' }}>
          {BUILD_SEEDS.map((s) => {
            const on = seedKey === s.key;
            return <Pressable key={s.key} onPress={() => setSeedKey(s.key)} style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: on ? '#3a2f5e' : '#13233aee', borderWidth: 1, borderColor: on ? '#9b7fd6' : '#2c4a6a' }}><Text fontSize={11} color={on ? '#e2cfff' : T.dim} style={{ fontFamily: 'monospace' }}>{s.label}</Text></Pressable>;
          })}
        </Row>
        <Text fontSize={10} color={T.dim}>{`Units: ${u} = 1 tile (1 m). Same basis as per-face UV. The grid is unchanged.`}</Text>
        {seed ? null : <NumberField label="diameter" value={dia} onChange={setDia} min={1} max={u * STUDIO.gridTiles} step={1} snap={0.5} suffix="u" />}
        {hasHeight ? <NumberField label="height" value={hgt} onChange={setHgt} min={1} max={u * STUDIO.gridTiles * 2} step={1} snap={0.5} suffix="u" /> : null}
        {hasSides ? <NumberField label="sides" value={sides} onChange={(n) => setSides(clampSides(n))} min={SHAPE_SIDES_MIN} max={SHAPE_SIDES_MAX} step={1} snap={1} /> : null}
        {hasSubdiv ? <NumberField label="subdiv" value={subdiv} onChange={(n) => setSubdiv(Math.max(0, Math.min(ICOSPHERE_SUBDIV_MAX, Math.round(n))))} min={0} max={ICOSPHERE_SUBDIV_MAX} step={1} snap={1} /> : null}
        <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>
          {seed ? `= ${confirmName} — editable mesh from a build piece`
            : shape === 'plane' ? `= ${fmtTiles(dia)} × ${fmtTiles(dia)} flat`
            : ROUND_BODIES.includes(shape) ? `= ${fmtTiles(dia)} ∅ ${shape}${hasSides ? ` · ${clampSides(sides)} sides` : ` · subdiv ${subdiv}`}`
            : `= ${fmtTiles(dia)} ∅ × ${fmtTiles(hgt)}${hasSides ? ` · ${clampSides(sides)} sides` : ''}`}
        </Text>
        <Row style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Pressable onPress={props.onCancel} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' }}><Text fontSize={11} color={T.dim}>Cancel</Text></Pressable>
          <Pressable onPress={() => props.onConfirm(build(), confirmName)} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#1c3a2a', borderWidth: 1, borderColor: '#2f7a4f' }}><Text fontSize={11} color="#7fd6a0" style={{ fontWeight: '800' }}>Add</Text></Pressable>
        </Row>
      </Col>
    </Box>
  );
}

// ── Create Texture dialog (req_1068) ──────────────────────────────────────────
// Blockbench's "Create Texture" popup, faithfully: Name · Type · Pixel Density ·
// Color · Rearrange UV · Power-of-2 Size · Keep Multi Texture Occupancy · Combine
// Islands · Edge/Island Angle Threshold · Padding. The questions ARE the pack
// parameters (textureize.ts); Confirm packs the whole scene into one sprite-map
// atlas. The fully-wired options today: Pixel Density, Rearrange UV, Power-of-2,
// Padding; the island-merge ones (Combine + the thresholds) + Keep-Multi are
// surfaced for parity and carried through (their effect is the Phase-2 merge step).

const TEXTURE_TYPES: { type: TextureType; label: string }[] = [
  { type: 'template', label: 'Texture Template' }, { type: 'solid', label: 'Solid Color' }, { type: 'blank', label: 'Blank' },
];

function TexCheck(props: { label: string; value: boolean; onChange: (v: boolean) => void; dim?: boolean }) {
  return (
    <Row style={{ gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
      <Text fontSize={11} color={props.dim ? T.dim : T.ink} style={{ fontFamily: 'monospace' }}>{props.label}</Text>
      <Pressable onPress={() => props.onChange(!props.value)} style={{ width: 20, height: 20, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: props.value ? '#1c3a2a' : '#13233aee', borderWidth: 1, borderColor: props.value ? '#2f7a4f' : '#2c4a6a' }}>
        {props.value ? <Text fontSize={12} color="#7fd6a0">✓</Text> : null}
      </Pressable>
    </Row>
  );
}

function CreateTextureDialog(props: { onCancel: () => void; onConfirm: (o: TextureOptions) => void }) {
  const [o, setO] = useState<TextureOptions>(DEFAULT_TEXTURE_OPTIONS);
  const set = (p: Partial<TextureOptions>) => setO((prev) => ({ ...prev, ...p }));
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#03060caa' }}>
      <Col style={{ width: 420, gap: 9, padding: 16, borderRadius: 10, backgroundColor: T.panelSolid, borderWidth: 1, borderColor: '#2c4a6a' }}>
        <Text fontSize={13} color={T.text} style={{ fontWeight: '800' }}>Create Texture</Text>

        <LCField label="Name">
          <Box style={{ flexGrow: 1 }}>
            <TextInput value={o.name} onChangeText={(t: string) => set({ name: t })} style={{ height: 24, fontSize: 11, color: T.ink, backgroundColor: T.page, borderWidth: 1, borderColor: '#2c4a6a', borderRadius: 4, paddingHorizontal: 6, fontFamily: 'monospace' }} />
          </Box>
        </LCField>

        <LCField label="Type">
          <Row style={{ gap: 5, flexWrap: 'wrap' }}>
            {TEXTURE_TYPES.map((tt) => {
              const on = o.type === tt.type;
              return <Pressable key={tt.type} onPress={() => set({ type: tt.type })} style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: on ? '#2a3f5e' : '#13233aee', borderWidth: 1, borderColor: on ? '#5b8fd6' : '#2c4a6a' }}><Text fontSize={10} color={on ? '#cfe2ff' : T.dim} style={{ fontFamily: 'monospace' }}>{tt.label}</Text></Pressable>;
            })}
          </Row>
        </LCField>

        <LCField label="Pixel Density">
          <Row style={{ gap: 5 }}>
            {PIXEL_DENSITIES.map((d) => {
              const on = o.density === d;
              return <Pressable key={d} onPress={() => set({ density: d })} style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: on ? '#2a3f5e' : '#13233aee', borderWidth: 1, borderColor: on ? '#5b8fd6' : '#2c4a6a' }}><Text fontSize={10} color={on ? '#cfe2ff' : T.dim} style={{ fontFamily: 'monospace' }}>{`${d}x`}</Text></Pressable>;
            })}
          </Row>
        </LCField>

        {/* Color — only for the Solid Color type (dim otherwise, like Blockbench). */}
        <LCField label="Color">
          <Row style={{ gap: 6, alignItems: 'center' }}>
            <Box style={{ width: 20, height: 20, borderRadius: 4, backgroundColor: o.color, borderWidth: 1, borderColor: '#2c4a6a', opacity: o.type === 'solid' ? 1 : 0.4 }} />
            <Box style={{ width: 92 }}>
              <TextInput value={o.color} onChangeText={(t: string) => set({ color: t })} style={{ height: 22, fontSize: 11, color: o.type === 'solid' ? T.ink : T.dim, backgroundColor: T.page, borderWidth: 1, borderColor: '#2c4a6a', borderRadius: 4, paddingHorizontal: 6, fontFamily: 'monospace' }} />
            </Box>
          </Row>
        </LCField>

        <Box style={{ height: 1, backgroundColor: '#22344c', marginTop: 2, marginBottom: 2 }} />

        <TexCheck label="Rearrange UV" value={o.rearrangeUV} onChange={(v) => set({ rearrangeUV: v })} />
        <TexCheck label="Power-of-2 Size" value={o.powerOfTwo} onChange={(v) => set({ powerOfTwo: v })} />
        <TexCheck label="Keep Multi Texture Occupancy" value={o.keepOccupancy} onChange={(v) => set({ keepOccupancy: v })} />
        <TexCheck label="Combine Islands" value={o.combineIslands} onChange={(v) => set({ combineIslands: v })} />
        <LCField label="Edge Angle">
          <LCStepper value={o.edgeAngle} onChange={(n) => set({ edgeAngle: n })} min={0} max={180} step={1} />
        </LCField>
        <LCField label="Island Angle">
          <LCStepper value={o.islandAngle} onChange={(n) => set({ islandAngle: n })} min={0} max={180} step={1} />
        </LCField>
        <TexCheck label="Padding" value={o.padding} onChange={(v) => set({ padding: v })} />
        <TexCheck label="Dedupe Islands (shared)" value={o.dedupIslands} onChange={(v) => set({ dedupIslands: v })} />

        <Row style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Pressable onPress={props.onCancel} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' }}><Text fontSize={11} color={T.dim}>Cancel</Text></Pressable>
          <Pressable onPress={() => props.onConfirm(o)} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#1c3a2a', borderWidth: 1, borderColor: '#2f7a4f' }}><Text fontSize={11} color="#7fd6a0" style={{ fontWeight: '800' }}>Confirm</Text></Pressable>
        </Row>
      </Col>
    </Box>
  );
}

// ── Compile Asset dialog (req_1122, Part 7 — the asset compiler) ──────────────
// Turn a Studio model into a typed game asset. The FIRST question is the KIND (the
// asset's MEANING — the user's "first menu asks what the shape is becoming"); the
// kind drives a kind-specific descriptor. Prop is live; the other kinds land in
// Phase 7b–7d. The cook MEASURES footprint/height from the mesh (derive, don't
// store twice), so the descriptor here is only the gameplay meaning.

const COMPILE_KINDS: { kind: 'prop' | 'item' | 'vehiclePart' | 'clothing'; label: string; ready: boolean }[] = [
  { kind: 'prop', label: 'Prop', ready: true },
  { kind: 'item', label: 'Item', ready: false },
  { kind: 'vehiclePart', label: 'Vehicle part', ready: false },
  { kind: 'clothing', label: 'Clothing', ready: false },
];

// A prop's NATURE — the three real shapes in the prop stack (game/kinds/props.ts):
//   • static  = a fixed obstacle: solid, points at the 'wall' donor (blocks sight,
//               gives cover).
//   • foliage = walk-through scenery: non-solid, points at 'bush' (conceals).
//   • physics = a KICKABLE dynamic body (a barrel/can/ball — the KICKPROP system):
//               solid, carries `dynamics` (a sphere body + bounce); the player
//               kicks it around. The body radius is MEASURED at cook time.
// This maps the user's mental model (static / hollow / physics) onto the table's
// granular fields, instead of asking about solid + tileKind separately.
type PropNature = 'static' | 'foliage' | 'physics';
const COMPILE_NATURES: { nature: PropNature; label: string; hint: string }[] = [
  { nature: 'static', label: 'Static', hint: 'fixed — blocks movement & sight, gives cover' },
  { nature: 'foliage', label: 'Foliage', hint: 'walk-through — conceals you (a bush)' },
  { nature: 'physics', label: 'Physics', hint: 'kickable body — you knock it around (a barrel/can/ball)' },
];

// HOW THE COOKED PIECE PLACES (req_1684): 'free' is the default scenery snap; the
// others make it a piece-like placeable (a railing edge-snaps onto stairs, a wall
// panel blocks sight, a trim sticks onto a face) — the SAME behaviour built-in pieces
// have, on the uniform prop substrate. The map → PropBuildPlacement {snap,cover,blocksSight}.
type PiecePlacement = 'free' | 'railing' | 'wall' | 'trim';
const COMPILE_PLACEMENTS: { placement: PiecePlacement; label: string; hint: string; build?: PropDescriptorInput['buildPlacement'] }[] = [
  { placement: 'free', label: 'Free', hint: 'place anywhere (default scenery)' },
  { placement: 'railing', label: 'Railing', hint: 'snaps to edges (stairs/balcony) · low cover', build: { snap: 'edge', cover: 'low', blocksSight: false } },
  { placement: 'wall', label: 'Wall panel', hint: 'snaps to edges · full cover, blocks sight', build: { snap: 'edge', cover: 'full', blocksSight: true } },
  { placement: 'trim', label: 'Trim / decal', hint: 'sticks onto a face (posters, moldings)', build: { snap: 'surface', cover: 'none', blocksSight: false } },
];

/** Map a nature + bounce + placement → the granular PropDescriptorInput the cook fills. */
function natureToDescriptor(nature: PropNature, label: string, bounce: number, placement?: PropDescriptorInput['buildPlacement']): PropDescriptorInput {
  const place = placement ? { buildPlacement: placement } : {};
  if (nature === 'foliage') return { label, solid: false, tileKind: 'bush', ...place };
  if (nature === 'physics') return { label, solid: true, tileKind: 'wall', physics: { restitution: bounce }, ...place };
  return { label, solid: true, tileKind: 'wall', ...place };
}

function CompileAssetDialog(props: { sceneName: string | null; onCancel: () => void; onCook: (d: PropDescriptorInput) => void }) {
  const [kind, setKind] = useState<'prop' | 'item' | 'vehiclePart' | 'clothing'>('prop');
  const [label, setLabel] = useState(props.sceneName || 'Asset');
  const [nature, setNature] = useState<PropNature>('static');
  // bounce (restitution) for a physics body — drum/can ~0.18, a ball ~0.65.
  const [bounce, setBounce] = useState(0.3);
  // how the cooked piece SNAPS when placed (req_1684) — free scenery vs railing/wall/trim.
  const [placement, setPlacement] = useState<PiecePlacement>('free');
  const ready = COMPILE_KINDS.find((k) => k.kind === kind)?.ready ?? false;
  const natureHint = COMPILE_NATURES.find((n) => n.nature === nature)?.hint ?? '';
  const placeDef = COMPILE_PLACEMENTS.find((p) => p.placement === placement) ?? COMPILE_PLACEMENTS[0];
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#03060caa' }}>
      <Col style={{ width: 440, gap: 9, padding: 16, borderRadius: 10, backgroundColor: T.panelSolid, borderWidth: 1, borderColor: '#8a6f3a' }}>
        <Text fontSize={13} color="#e9c77f" style={{ fontWeight: '800' }}>⚙ Compile Asset</Text>
        <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>{`from "${props.sceneName || 'untitled'}" — geometry + footprint are measured from the mesh`}</Text>

        {/* The KIND — the asset's meaning, asked first. */}
        <LCField label="Kind">
          <Row style={{ gap: 5, flexWrap: 'wrap' }}>
            {COMPILE_KINDS.map((k) => {
              const on = kind === k.kind;
              return (
                <Pressable key={k.kind} onPress={() => setKind(k.kind)} style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: on ? '#3a2f16' : '#13233aee', borderWidth: 1, borderColor: on ? '#c79a3a' : '#2c4a6a', opacity: k.ready ? 1 : 0.55 }}>
                  <Text fontSize={10} color={on ? '#e9c77f' : T.dim} style={{ fontFamily: 'monospace' }}>{k.ready ? k.label : `${k.label} (soon)`}</Text>
                </Pressable>
              );
            })}
          </Row>
        </LCField>

        {ready ? (
          <>
            <LCField label="Label">
              <Box style={{ flexGrow: 1 }}>
                <TextInput value={label} onChangeText={setLabel} style={{ height: 24, fontSize: 11, color: T.ink, backgroundColor: T.page, borderWidth: 1, borderColor: '#2c4a6a', borderRadius: 4, paddingHorizontal: 6, fontFamily: 'monospace' }} />
              </Box>
            </LCField>
            <LCField label="Nature">
              <Row style={{ gap: 5, flexWrap: 'wrap' }}>
                {COMPILE_NATURES.map((n) => {
                  const on = nature === n.nature;
                  return <Pressable key={n.nature} onPress={() => setNature(n.nature)} style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: on ? '#2a3f5e' : '#13233aee', borderWidth: 1, borderColor: on ? '#5b8fd6' : '#2c4a6a' }}><Text fontSize={10} color={on ? '#cfe2ff' : T.dim} style={{ fontFamily: 'monospace' }}>{n.label}</Text></Pressable>;
                })}
              </Row>
            </LCField>
            <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace', marginTop: -3 }}>{natureHint}</Text>
            {/* Physics bodies author the BOUNCE; the body radius is MEASURED from the
                footprint at cook time (derive, don't store twice). */}
            {nature === 'physics' ? (
              <LCField label="Bounce">
                <LCStepper value={bounce} onChange={(n) => setBounce(Math.max(0, Math.min(1, Math.round(n * 100) / 100)))} min={0} max={1} step={0.05} />
              </LCField>
            ) : null}
            {/* PLACEMENT (req_1684): make the cooked model a real piece — a railing that
                edge-snaps onto stairs, a wall panel, a face decal — not just free scenery. */}
            <LCField label="Placement">
              <Row style={{ gap: 5, flexWrap: 'wrap' }}>
                {COMPILE_PLACEMENTS.map((p) => {
                  const on = placement === p.placement;
                  return <Pressable key={p.placement} onPress={() => setPlacement(p.placement)} style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: on ? '#3a2f5e' : '#13233aee', borderWidth: 1, borderColor: on ? '#9b7fd6' : '#2c4a6a' }}><Text fontSize={10} color={on ? '#e2cfff' : T.dim} style={{ fontFamily: 'monospace' }}>{p.label}</Text></Pressable>;
                })}
              </Row>
            </LCField>
            <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace', marginTop: -3 }}>{placeDef.hint}</Text>
          </>
        ) : (
          <Text fontSize={11} color={T.dim} style={{ fontFamily: 'monospace', paddingTop: 6, paddingBottom: 6 }}>This kind's cook lands in a later slice. Prop is ready now.</Text>
        )}

        <Row style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Pressable onPress={props.onCancel} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' }}><Text fontSize={11} color={T.dim}>Cancel</Text></Pressable>
          <Pressable
            onPress={() => { if (ready) props.onCook(natureToDescriptor(nature, label, bounce, placeDef.build)); }}
            style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: ready ? '#3a2f16' : '#1a2436', borderWidth: 1, borderColor: ready ? '#c79a3a' : '#2c4a6a', opacity: ready ? 1 : 0.5 }}
          >
            <Text fontSize={11} color={ready ? '#e9c77f' : T.dim} style={{ fontWeight: '800' }}>Cook + Install</Text>
          </Pressable>
        </Row>
      </Col>
    </Box>
  );
}

// ── Import Texture dialog (req_1079) ──────────────────────────────────────────
// Re-upload an edited / AI-generated PNG so the model captures the visual changes.
// Just a PNG path (pre-filled with this scene's export path, so the round-trip —
// export → edit → import — is one click); the model samples it through the existing
// UVs, so the cookie cutter is automatic (overshoot outside the islands is ignored).

function ImportTextureDialog(props: { slice?: RasterSlice; defaultPath: string; onCancel: () => void; onConfirm: (path: string) => void }) {
  const [path, setPath] = useState(props.defaultPath);
  const target = props.slice ? `face ${props.slice.faceIndex} (slice)` : 'the whole sprite sheet';
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#03060caa' }}>
      <Col style={{ width: 460, gap: 11, padding: 16, borderRadius: 10, backgroundColor: T.panelSolid, borderWidth: 1, borderColor: '#3a2c6a' }}>
        <Text fontSize={13} color={T.text} style={{ fontWeight: '800' }}>Import Texture</Text>
        <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>{`re-upload a PNG onto ${target} — it slips back via the UVs (cookie cutter).`}</Text>
        <LCField label="PNG path">
          <Box style={{ flexGrow: 1 }}>
            <TextInput value={path} onChangeText={setPath} style={{ height: 24, fontSize: 11, color: T.ink, backgroundColor: T.page, borderWidth: 1, borderColor: '#2c4a6a', borderRadius: 4, paddingHorizontal: 6, fontFamily: 'monospace' }} />
          </Box>
        </LCField>
        <Row style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Pressable onPress={props.onCancel} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' }}><Text fontSize={11} color={T.dim}>Cancel</Text></Pressable>
          <Pressable onPress={() => props.onConfirm(path)} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#2a1c4a', borderWidth: 1, borderColor: '#6a4fb0' }}><Text fontSize={11} color="#cdbcff" style={{ fontWeight: '800' }}>Import</Text></Pressable>
        </Row>
      </Col>
    </Box>
  );
}

// Import a generated/external GLB (tools/genmesh output, or any .glb) as a NEW
// paintable Studio model (req_1383/req_1384). Reads the file via the fs door,
// converts triangle soup -> EditMesh + unwraps UVs (glbToEditMesh), and on success
// hands (mesh, name) to the parent which mints a fresh model + addPart. The mesh is
// unwrapped, so the pixel painter works on it immediately.
const GENERATED_DIR = 'cart/hmsc-int/data/generated';
function ImportModelDialog(props: { onCancel: () => void; onConfirm: (mesh: EditMesh, name: string) => void }) {
  // Prefill the newest generated .glb (what `tools/genmodel` just wrote) instead
  // of a fixed name that never matches the prompt's slug.
  const [path, setPath] = useState(() => {
    try {
      const files = listDir(GENERATED_DIR).filter((f) => f.endsWith('.glb') || f.endsWith('.obj')).sort();
      if (files.length) return `${GENERATED_DIR}/${files[files.length - 1]}`;
    } catch { /* dir may not exist yet */ }
    return `${GENERATED_DIR}/model.glb`;
  });
  const [err, setErr] = useState<string | null>(null);
  const doImport = () => {
    try {
      // .obj is plain text (InstantMesh emits OBJ); .glb is binary (base64).
      let mesh;
      if (path.toLowerCase().endsWith('.obj')) {
        const text = readFile(path);
        if (!text) throw new Error(`cannot read ${path}`);
        mesh = objToEditMesh(text);
      } else {
        const b64 = readFileBase64(path);
        if (!b64) throw new Error(`cannot read ${path}`);
        mesh = glbToEditMesh(base64ToBytes(b64));
      }
      if (!mesh.faces.length) throw new Error('no triangles in mesh');
      const name = (path.split('/').pop() || 'imported').replace(/\.[^.]+$/, '');
      props.onConfirm(mesh, name);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    }
  };
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#03060caa' }}>
      <Col style={{ width: 460, gap: 11, padding: 16, borderRadius: 10, backgroundColor: T.panelSolid, borderWidth: 1, borderColor: '#3a2c6a' }}>
        <Text fontSize={13} color={T.text} style={{ fontWeight: '800' }}>Import 3D model (GLB / OBJ)</Text>
        <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>{`a generated mesh (.glb or .obj — e.g. InstantMesh) becomes a NEW editable, paintable model — UVs are unwrapped on import.`}</Text>
        <LCField label="mesh path">
          <Box style={{ flexGrow: 1 }}>
            <TextInput value={path} onChangeText={(t) => { setErr(null); setPath(t); }} style={{ height: 24, fontSize: 11, color: T.ink, backgroundColor: T.page, borderWidth: 1, borderColor: '#2c4a6a', borderRadius: 4, paddingHorizontal: 6, fontFamily: 'monospace' }} />
          </Box>
        </LCField>
        {err ? <Text fontSize={10} color="#ff9a9a" style={{ fontFamily: 'monospace' }}>{err}</Text> : null}
        <Row style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Pressable onPress={props.onCancel} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' }}><Text fontSize={11} color={T.dim}>Cancel</Text></Pressable>
          <Pressable onPress={doImport} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#2a1c4a', borderWidth: 1, borderColor: '#6a4fb0' }}><Text fontSize={11} color="#cdbcff" style={{ fontWeight: '800' }}>Import</Text></Pressable>
        </Row>
      </Col>
    </Box>
  );
}

// AI Fill (req_1070/1110, Phase 5d): automated image-to-image. The prompt is OPTIONALLY
// enhanced (a nano-gpt TEXT model OR Claude via the useAssistant worker — or bypassed and
// sent raw), then the nano-gpt image client (cart/image-gen, reused) generates ONE image
// with the CURRENT atlas as the img2img reference. The parent composites the result
// through the same slot path as import (the cookie cutter is the UV slot). See 5.6b.
function AiTextureDialog(props: {
  slice?: RasterSlice;
  target: string;
  getReference: () => string;
  onGenerated: (b64: string) => void;
  onCancel: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [enhance, setEnhance] = useState(true);
  const [backend, setBackend] = useState<'nano' | 'claude'>('nano');
  const [textModel, setTextModel] = useState(STUDIO.aiTextModel);
  const [imageModel, setImageModel] = useState(STUDIO.aiImageModel);
  const [img2img, setImg2img] = useState(true);
  const [status, setStatus] = useState('ready');
  const [busy, setBusy] = useState(false);
  // The nano-gpt key lives in hmsc-int's native localstore (req_1118); editing the
  // field persists it so it's entered once and remembered across sessions.
  const [apiKey, setApiKey] = useState(getNanoKey());
  const saveKey = (v: string) => { setApiKey(v); setNanoKey(v); };

  // Claude is spawned ONLY when picked (lazy); the worker closes when the dialog unmounts.
  const cwd = useMemo(processCwd, []);
  const claudeOn = enhance && backend === 'claude';
  const assistant = useAssistant({ backend: claudeOn ? 'claude_code' : undefined, cwd, model: 'claude-opus-4-7', persistAcrossUnmount: false, pollMs: 120 });
  const eventsRef = useRef(assistant.events);
  eventsRef.current = assistant.events;

  // Bridge the useAssistant event stream to a promise: wait until the worker is ready, ask
  // once, then accumulate assistant_message text up to the turn's completion event.
  const enhanceViaClaude = (text: string): Promise<string> => new Promise((resolve, reject) => {
    let waited = 0;
    const tryAsk = () => {
      if (assistant.ready()) {
        const start = eventsRef.current.length;
        if (!assistant.ask(`${ENHANCE_SYSTEM}\n\nDescription: ${text}\n\nExpanded prompt:`)) { reject(new Error('claude not ready')); return; }
        let polls = 0;
        const iv = setInterval(() => {
          polls += 1;
          const evs = eventsRef.current;
          let acc = '', done = false;
          for (let i = start; i < evs.length; i += 1) {
            const e = evs[i];
            if (e.kind === 'assistant_message' && e.text) acc += e.text;
            else if (e.kind === 'completion') done = true;
            else if (e.kind === 'error_') { clearInterval(iv); reject(new Error(e.text || 'claude error')); return; }
          }
          if (done) { clearInterval(iv); resolve(acc.trim() || text); }
          else if (polls > 900) { clearInterval(iv); reject(new Error('claude timed out')); }
        }, 100);
        return;
      }
      waited += 1;
      if (waited > 300) { reject(new Error('claude worker did not start (is the claude CLI on PATH?)')); return; }
      setTimeout(tryAsk, 100);
    };
    tryAsk();
  });

  const run = async () => {
    const base = prompt.trim();
    if (!base && !img2img) { setStatus('enter a prompt (or turn on “use current art”)'); return; }
    if (!apiKey.trim()) { setStatus('enter your nano-gpt API key below'); return; }
    setBusy(true);
    try {
      let finalPrompt = buildTexturePrompt(props.target, base);
      if (enhance && base) {
        setStatus(backend === 'claude' ? 'enhancing (claude)…' : 'enhancing…');
        try {
          finalPrompt = backend === 'claude' ? await enhanceViaClaude(finalPrompt) : await enhanceViaNano(finalPrompt, textModel, apiKey.trim());
        } catch (e: any) {
          // enhancement is optional — fall back to the raw prompt, but say what happened.
          setStatus(`enhance failed (${e?.message ?? e}) — using raw prompt`);
        }
      }
      setStatus('generating…');
      const ref = img2img ? props.getReference() : null;
      const b64 = await generateTexture(finalPrompt, imageModel, STUDIO.aiTextureSize, ref || null, apiKey.trim());
      setStatus('done ✓');
      props.onGenerated(b64);
    } catch (e: any) {
      setStatus(`failed: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const target = props.slice ? `face ${props.slice.faceIndex} (slice)` : 'the whole sprite sheet';
  const field = { height: 24, fontSize: 11, color: T.ink, backgroundColor: T.page, borderWidth: 1, borderColor: '#2c4a6a', borderRadius: 4, paddingHorizontal: 6, fontFamily: 'monospace' } as const;
  const toggle = (on: boolean) => ({ ...STEP_BTN, backgroundColor: on ? '#2a3f5e' : '#13233aee', borderColor: on ? '#5b8fd6' : '#2c4a6a' });
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#03060caa' }}>
      <Col style={{ width: 480, gap: 10, padding: 16, borderRadius: 10, backgroundColor: T.panelSolid, borderWidth: 1, borderColor: '#6a4fb0' }}>
        <Text fontSize={13} color={T.text} style={{ fontWeight: '800' }}>✦ AI Fill</Text>
        <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>{`generate ${target} — the current atlas guides it (img2img), masked to the UV slot.`}</Text>

        <LCField label="prompt">
          <Box style={{ flexGrow: 1 }}>
            <TextInput value={prompt} onChangeText={setPrompt} style={field} />
          </Box>
        </LCField>
        <LCField label="image model">
          <Box style={{ flexGrow: 1 }}>
            <TextInput value={imageModel} onChangeText={setImageModel} style={field} />
          </Box>
        </LCField>
        {/* nano-gpt API key — stored natively in hmsc-int's localstore (req_1118), entered
            once and remembered. The one key powers both image gen + text enhance. */}
        <LCField label="api key">
          <Box style={{ flexGrow: 1 }}>
            <TextInput value={apiKey} onChangeText={saveKey} style={{ ...field, borderColor: apiKey.trim() ? '#2c4a6a' : '#7a4f4f' }} />
          </Box>
        </LCField>
        {/* reference — img2img off the current atlas art, or text-to-image only. */}
        <LCField label="reference">
          <Row style={{ gap: 4 }}>
            <Pressable onPress={() => setImg2img(true)} style={toggle(img2img)}><Text fontSize={9} color={img2img ? '#cfe2ff' : T.dim}>use current art</Text></Pressable>
            <Pressable onPress={() => setImg2img(false)} style={toggle(!img2img)}><Text fontSize={9} color={!img2img ? '#cfe2ff' : T.dim}>from prompt only</Text></Pressable>
          </Row>
        </LCField>
        {/* enhancement — off (raw), a nano-gpt text model, or Claude (the bypass toggle). */}
        <LCField label="enhance">
          <Row style={{ gap: 4 }}>
            <Pressable onPress={() => setEnhance(false)} style={toggle(!enhance)}><Text fontSize={9} color={!enhance ? '#cfe2ff' : T.dim}>off</Text></Pressable>
            <Pressable onPress={() => { setEnhance(true); setBackend('nano'); }} style={toggle(enhance && backend === 'nano')}><Text fontSize={9} color={enhance && backend === 'nano' ? '#cfe2ff' : T.dim}>nano text</Text></Pressable>
            <Pressable onPress={() => { setEnhance(true); setBackend('claude'); }} style={toggle(enhance && backend === 'claude')}><Text fontSize={9} color={enhance && backend === 'claude' ? '#cfe2ff' : T.dim}>claude</Text></Pressable>
          </Row>
        </LCField>
        {enhance && backend === 'nano' ? (
          <LCField label="text model">
            <Box style={{ flexGrow: 1 }}>
              <TextInput value={textModel} onChangeText={setTextModel} style={field} />
            </Box>
          </LCField>
        ) : null}

        <Row style={{ gap: 8, alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
          <Box style={{ flexShrink: 1 }}>
            <Text fontSize={10} color={busy ? '#cdbcff' : T.dim} style={{ fontFamily: 'monospace' }}>{status}</Text>
          </Box>
          <Row style={{ gap: 8 }}>
            <Pressable onPress={props.onCancel} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' }}><Text fontSize={11} color={T.dim}>Cancel</Text></Pressable>
            <Pressable onPress={busy ? undefined : run} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: busy ? '#241a3a' : '#2a1c4a', borderWidth: 1, borderColor: '#6a4fb0' }}><Text fontSize={11} color={busy ? T.dim : '#cdbcff'} style={{ fontWeight: '800' }}>{busy ? '…' : 'Generate'}</Text></Pressable>
          </Row>
        </Row>
      </Col>
    </Box>
  );
}

// ── Loop-cut popup (req_0984/0985) ────────────────────────────────────────────
// The small, non-invasive Blockbench panel: Direction (which in-plane axis),
// Cuts (how many), Offset (where), Unit (size-units vs percent). Every change
// re-previews live (the parent drives the draft); Apply commits, ✕ cancels.

function LCStepper(props: { value: number; onChange: (n: number) => void; min: number; max: number; step?: number; width?: number }) {
  const step = props.step ?? 1;
  const set = (n: number) => props.onChange(clamp(n, props.min, props.max));
  return (
    <Row style={{ gap: 4, alignItems: 'center' }}>
      <Pressable onPress={() => set(props.value - step)} style={STEP_BTN}><Text fontSize={12} color={T.text}>−</Text></Pressable>
      <Box style={{ width: props.width ?? 54 }}>
        <TextInput
          value={String(props.value)}
          onChangeText={(t: string) => { const n = parseFloat(t); if (Number.isFinite(n)) set(n); }}
          style={{ height: 22, fontSize: 11, color: T.ink, backgroundColor: T.page, borderWidth: 1, borderColor: '#2c4a6a', borderRadius: 4, paddingHorizontal: 6, textAlign: 'center', fontFamily: 'monospace' }}
        />
      </Box>
      <Pressable onPress={() => set(props.value + step)} style={STEP_BTN}><Text fontSize={12} color={T.text}>+</Text></Pressable>
    </Row>
  );
}

function LCField(props: { label: string; children: any }) {
  return (
    <Row style={{ gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
      <Text fontSize={10} color={T.dim} style={{ width: 60, fontFamily: 'monospace' }}>{props.label}</Text>
      {props.children}
    </Row>
  );
}

function LoopCutPopup(props: {
  dir: 0 | 1; cuts: number; offset: number; unit: 'units' | 'percent'; sizeUnits: number;
  onChange: (patch: Partial<{ dir: 0 | 1; cuts: number; offset: number; unit: 'units' | 'percent' }>) => void;
  onApply: () => void; onCancel: () => void;
}) {
  const offMax = props.unit === 'percent' ? 100 : Math.max(1, Math.round(props.sizeUnits));
  return (
    <Box style={{ position: 'absolute', left: 0, right: 0, bottom: 18, alignItems: 'center' }}>
      <Col style={{ gap: 7, paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10, borderRadius: 9, backgroundColor: '#0b1320f2', borderWidth: 1, borderColor: '#2c4a6a', minWidth: 250 }}>
        <Row style={{ gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <Text fontSize={11} color={T.text} style={{ fontWeight: '800' }}>Loop Cut</Text>
          <Pressable onPress={props.onCancel} style={STEP_BTN}><Text fontSize={10} color={T.dim}>✕</Text></Pressable>
        </Row>
        <LCField label="direction"><LCStepper value={props.dir} min={0} max={1} onChange={(n) => props.onChange({ dir: (n ? 1 : 0) as 0 | 1 })} width={40} /></LCField>
        <LCField label="cuts"><LCStepper value={props.cuts} min={1} max={64} onChange={(n) => props.onChange({ cuts: Math.round(n) })} width={40} /></LCField>
        <LCField label="offset"><LCStepper value={props.offset} min={0} max={offMax} onChange={(n) => props.onChange({ offset: n })} width={54} /></LCField>
        <LCField label="unit">
          <Row style={{ gap: 4 }}>
            {(['units', 'percent'] as const).map((u) => {
              const on = props.unit === u;
              const lbl = u === 'units' ? 'Size Units' : 'Percent';
              return (
                <Pressable
                  key={u}
                  onPress={() => {
                    if (props.unit === u) return;
                    const off = u === 'percent'
                      ? (props.sizeUnits > 0 ? (props.offset / props.sizeUnits) * 100 : 0)
                      : (props.offset / 100) * props.sizeUnits;
                    props.onChange({ unit: u, offset: Math.round(off * 10) / 10 });
                  }}
                  style={{ ...STEP_BTN, backgroundColor: on ? '#2a3f5e' : '#13233aee', borderColor: on ? '#5b8fd6' : '#2c4a6a' }}
                >
                  <Text fontSize={9} color={on ? '#cfe2ff' : T.dim}>{lbl}</Text>
                </Pressable>
              );
            })}
          </Row>
        </LCField>
        <Pressable onPress={props.onApply} style={{ paddingTop: 6, paddingBottom: 6, borderRadius: 6, alignItems: 'center', backgroundColor: '#1c3a2a', borderWidth: 1, borderColor: '#2f7a4f', marginTop: 2 }}>
          <Text fontSize={11} color="#7fd6a0" style={{ fontWeight: '800' }}>Apply</Text>
        </Pressable>
      </Col>
    </Box>
  );
}

// The bevel sizing popup (req_1266) — set up like the loop cut: the chamfer is
// previewed live on the model and this popup grows/shrinks its WIDTH (in modeling
// units) before you confirm. `maxUnits` is the widest the picked element allows
// (the bevel can't slide a corner past its edge), so the stepper maps 1:1.
function BevelPopup(props: {
  kind: 'edge' | 'vertex'; width: number; maxUnits: number;
  onChange: (width: number) => void; onApply: () => void; onCancel: () => void;
}) {
  const max = Math.max(0.1, Math.round(props.maxUnits * 10) / 10);
  return (
    <Box style={{ position: 'absolute', left: 0, right: 0, bottom: 18, alignItems: 'center' }}>
      <Col style={{ gap: 7, paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10, borderRadius: 9, backgroundColor: '#0b1320f2', borderWidth: 1, borderColor: '#2c4a6a', minWidth: 230 }}>
        <Row style={{ gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <Text fontSize={11} color={T.text} style={{ fontWeight: '800' }}>Bevel {props.kind === 'edge' ? 'Edge' : 'Vertex'}</Text>
          <Pressable onPress={props.onCancel} style={STEP_BTN}><Text fontSize={10} color={T.dim}>✕</Text></Pressable>
        </Row>
        <LCField label="width"><LCStepper value={props.width} min={0.1} max={max} step={0.5} onChange={(n) => props.onChange(Math.round(n * 10) / 10)} width={54} /></LCField>
        <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace' }}>{`units · max ${max}`}</Text>
        <Pressable onPress={props.onApply} style={{ paddingTop: 6, paddingBottom: 6, borderRadius: 6, alignItems: 'center', backgroundColor: '#1c3a2a', borderWidth: 1, borderColor: '#2f7a4f', marginTop: 2 }}>
          <Text fontSize={11} color="#7fd6a0" style={{ fontWeight: '800' }}>Apply</Text>
        </Pressable>
      </Col>
    </Box>
  );
}

// ── The editor: outliner (the layers component) docked beside the viewport ─────

export function StudioEditor() {
  const model: StudioModel = useStudioModel();
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) step the parts-library branch history.
  // model.undo/redo are stable identities (MUTATORS) and read the live stacks,
  // so the mount-time closure stays correct. A focused TextInput consumes keys
  // before the bus (req_0978), so renaming a part never triggers undo.
  useEffect(() => {
    const off = busOn('__keydown', (e: any) => {
      if (!(e?.ctrlKey || e?.metaKey)) return;
      const key = String(e?.key ?? '').toLowerCase();
      // In paint mode, Ctrl-Z/Y step the PAINT snapshot ring (req_1379) — paint lives
      // outside the model event stream, so model.undo() would only revert a stray
      // palette mint ("brush goes white") and never the paint. The restored state is
      // re-baked (content-addressed) via model.bakePaint. Fall through to the model
      // history when there's no paint step to take.
      if (key === 'z' && !e?.shiftKey) { if (paintActive() && canPaintUndo()) paintUndo(model.bakePaint); else model.undo(); }
      else if (key === 'y' || (key === 'z' && e?.shiftKey)) { if (paintActive() && canPaintRedo()) paintRedo(model.bakePaint); else model.redo(); }
    });
    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Row style={{ flexGrow: 1, height: '100%', minHeight: 0, position: 'relative' }}>
      <StudioViewport parts={model.visibleParts} revision={model.revision} meshRev={model.meshRev} activeName={model.activePart?.name ?? null} sceneName={model.modelName} partCount={model.parts.length} activePart={model.activePart} onEditMesh={model.updatePartMesh} onAddPart={model.addPart} onMergeActive={model.mergeActive} mergeTargetName={model.mergeTargetName} onSelectFaces={model.setSelectedFaces} palette={model.palette} onEditPaint={model.editPaint} onSetPalette={model.setPalette} paintRef={model.paintRef} paintBlob={model.paintBlob} onBakePaint={model.bakePaint} />
      {/* Branch-history verbs — top-left, the one viewport corner the compass /
          toolbar / mode-toggle don't claim. Disabled when the stack is empty. */}
      <Row style={{ position: 'absolute', left: 8, top: 8, gap: 4, zIndex: 30 }}>
        {([['undo', '↶ Undo', model.canUndo, () => model.undo()], ['redo', '↷ Redo', model.canRedo, () => model.redo()]] as const).map(([k, label, on, run]) => (
          <Pressable key={k} onPress={on ? run : undefined} style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 6, borderWidth: 1, backgroundColor: on ? '#13233aee' : '#0e1726aa', borderColor: on ? '#2c4a6a' : '#1c2a3c' }}>
            <Text fontSize={10} color={on ? '#cfe2ff' : T.dim}>{label}</Text>
          </Pressable>
        ))}
        {/* Import a generated/external GLB (tools/genmesh) as a NEW paintable model. */}
        <Pressable onPress={() => setImportOpen(true)} tooltip="Import a 3D model (.glb / .obj) — converts it to an editable, paintable Studio model" style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 6, borderWidth: 1, backgroundColor: '#1a1330ee', borderColor: '#6a4fb0' }}>
          <Text fontSize={10} color="#cdbcff">⬇ Import mesh</Text>
        </Pressable>
      </Row>
      {/* the OUTLINER (layers) docks on the RIGHT of the viewport (req_0981). */}
      <Box style={{ width: 236, minWidth: 236, height: '100%', borderLeftWidth: 1, borderColor: '#1c2a3c', backgroundColor: T.page }}>
        <StudioOutliner model={model} height="100%" onAdd={() => setAddOpen(true)} />
      </Box>
      {addOpen ? (
        <AddShapeDialog
          onCancel={() => setAddOpen(false)}
          onConfirm={(mesh, name) => { model.addPart(mesh, name); setAddOpen(false); }}
        />
      ) : null}
      {importOpen ? (
        <ImportModelDialog
          onCancel={() => setImportOpen(false)}
          onConfirm={(mesh, name) => { model.newModel(); model.addPart(mesh, name); setImportOpen(false); }}
        />
      ) : null}
    </Row>
  );
}

// A self-contained route view — the same editor the workbench STUDIO tab mounts.
export function StudioRoute() {
  return (
    <Col style={{ flexGrow: 1, height: '100%', minHeight: 0, backgroundColor: T.panelSolid }}>
      <StudioEditor />
    </Col>
  );
}
