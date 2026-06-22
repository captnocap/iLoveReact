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
import { useHotState, getHotState, setHotState, useInterval, useRerender } from '@reactjit/hooks';
import { Box, Col, patchDynSlot, Pressable, Row, Scene3D, ScrollView, Text, TextInput } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import { GAME_CAMERA, GAME_CHROME, GAME_FIGURE, GAME_NATIVE_CAMERA } from '../../../game';
import { CharacterCaptures, FigureMeshes, buildPartRender } from '../../../game/figure/render';
import { HMSC_SCALE } from '../../../world/scale';
import { busOn } from '@reactjit/runtime/hooks/useIFTTT';
import { editorTunables } from '../../tunables';
import { useEditorControls, useHeldModifiers } from '../../useEditorControls';
import { chordHintFor } from '../../controls';
import { KeyLegend } from '../../KeyLegend';
import { loadKeybinds } from '../../keybinds';
import { HotkeysPanel } from './dialogs/HotkeysPanel';
import { addMount, addMountReflections, bevelEdge, bevelVertex, clampSides, clearFaceTags, clearPivot, cone, connectVerts, createFaceFromEdges, createFaceFromVerts, cuboid, cylinder, deleteFaces, detachPanel, editMeshToGeometry, extrudeEdge, extrudeFace, faceCentroid, centerMesh, faceNormal, facesGeometry, facesWithTag, findConcaveFaces, newConcaveFaces, fitWheelCenter, addTextureSlot, assignFacesToSlot, clearFaceSlot, facesInSlot, slotOfFace, renameSlot, removeSlot, wheelMesh, icosphere, mergeFaces, mergeMesh, flipFace, hasPivot, loopCutPositions, loopCutRange, meshEdges, meshHealth, mirrorEditAxes, pivotOf, plane, pyramid, removeMount, rotateVerts, scaleVerts, setFaceGlass, setPivot, solidifyFaces, sphere, splitConcaveFaces, symmetrize, symmetryReport, tagOneFace, translateVerts, updateMount, updateMountMirrored, vertsBounds, vertsCentroid, vertsHalfExtent, ICOSPHERE_SUBDIV_MAX, SHAPE_SIDES_MAX, SHAPE_SIDES_MIN, type EditMesh, type V3 as MV3 } from '../editMesh';
import { addAnchor, isAnchor, nextAnchorName } from '../anchors';
import { axleSpinAxis, buildWheelPart, faceWheelFit, mirroredCenters } from '../wheelMount';
import { useStudioModel, type StudioModel, type StudioPart } from '../studioModel';
import { glbToEditMesh, base64ToBytes } from '../importMesh';
import { cookProp, type PropDescriptorInput, type CookedAsset } from '../cookedAsset';
import { useCookedAssets, cookedTextureBlob } from '../cookedAssets';
import { StudioOutliner } from '../Outliner';
import { SceneTextureAtlas, STUDIO_TEXTURE_KEY } from '../TextureAtlas';
import { BackdropSurface, BackdropsPanel, backdropQuad, backdropTexKey, defaultBackdropPos, imageDims, type Backdrop } from '../Backdrops';
import * as localstore from '@reactjit/hooks/localstore';
import { textureizeScene, rasterizeAtlas, DEFAULT_TEXTURE_OPTIONS, PIXEL_DENSITIES, type TextureOptions, type TextureType, type RasterSlice } from '../textureize';
import { encodePng } from '../png';
import { exists, mkdir, readFileBase64, writeFileBase64Atomic } from '@reactjit/hooks/fs';
import { bytesToBase64, base64ToBytes } from '@reactjit/workspace';
import { useAssistant } from '@reactjit/hooks/useAssistant';
import { processCwd } from '../../../assist3d/scene';
import { buildTexturePrompt, enhanceViaNano, generateTexture, getNanoKey, setNanoKey, hashHex, pngDataUrl, stripDataUrl, ENHANCE_SYSTEM } from '../textureGen';
import { useFrameProbe } from '../frameProbe';
import {
  SelectionOverlay, makeProjector, orbitalEyeJS, pickElement, applyPick, emptySelection, selectionCount,
  type SelMode, type Selection, type CameraSnap,
} from '../meshSelect';
import { pickFaceUV, paintUVsNeedRepack, mirrorPaintDabs, faceUvPerWorld, surfaceBrushDabs, type PaintCells, type PaintTarget, type FaceHit, type TexelRect } from '../meshPaint';
import { STUDIO_PAINT_KEY, PAINT_TEX, paintTex, baseCoat, stampUV, faceIslandPx, savePaint, restorePaint, setPaintActive, paintActive, canPaintUndo, canPaintRedo, paintSnapshotBegin, paintDropUndoSnapshot, paintUndo, paintRedo, clearPaintHistory, paintInited, markPaintInited } from '../meshPaintTexture';
import { Paintable } from '@reactjit/runtime/primitives';
// The PAINT panel + stamping are now the UNIVERSAL kit (runtime/paint) — the same
// brush/tool/colour vocabulary every cart shares, instead of a Studio one-off
// (USER ASK req_1487). BrushKit is the control surface; useBrushStroke is the
// optimistic host-owned stamping engine; the model's saved palette stays the
// source of truth, synthesised into the kit's palette shape.
import {
  BrushKit, useBrushStroke, DEFAULT_BRUSH,
  pushRecent, stampBrushDab, brushDabRgb, pressureRadius, layoutText, GLYPH_H,
  type Brush, type BrushTool, type ClipRect, type PaintTheme, type Palette as KitPalette, type PaletteEntry,
} from '@reactjit/runtime/paint';
import { defaultPalette, paletteWithColor, slotColor, type Palette } from '../modelStream';
import {
  TransformGizmo, NormalHandle, AXIS_DIR, axisScreen, dragWorldDistance, pickGizmoHandle, pickNormalHandle, rotationSign, selectionVertIndices, selectionFaceIndices,
  type GizmoTool, type GizmoHit,
} from '../meshGizmo';
import { RigOverlay, pickRigHandle, rigHandles, type RigSel } from '../meshRig';
import { T, STEP_BTN, SMOOTH_PRESETS, SCALE_FIGURE_SEED, SCALE_FIGURE_CART_KEY, STUDIO, type Vec3, type Rect } from './config';
import { Z } from './chrome/zlayers';
import './registerTunables';
import { clamp, sameRigSel, nextJointName, snapToStep, unitsToMeters, metersToUnits, fmtUnits, nowMs, schedFrame, partPlacement, loopCutAxisInfo, lcKeptFace, type LoopCutAxis } from './helpers';
import { GroundGrid, OriginAxes, DragReadout } from './scene/staging';
import { NumberField } from './panels/NumberField';
import { ViewCompass } from './overlays/ViewCompass';
import { FrameDiagBar } from './overlays/FrameDiagBar';
import { ConcaveFixPopup } from './dialogs/ConcaveFixPopup';
import { BevelPopup } from './dialogs/BevelPopup';
import { LoopCutPopup } from './dialogs/LoopCutPopup';
import { AiTextureDialog } from './dialogs/AiTextureDialog';
import { ImportModelDialog } from './dialogs/ImportModelDialog';
import { ImportTextureDialog } from './dialogs/ImportTextureDialog';
import { CompileAssetDialog } from './dialogs/CompileAssetDialog';
import { CreateTextureDialog } from './dialogs/CreateTextureDialog';
import { AddShapeDialog } from './dialogs/AddShapeDialog';
import { ImportPartDialog } from './dialogs/ImportPartDialog';



// ── The viewport ─────────────────────────────────────────────────────────────

// The paint kit is theme-agnostic; this maps it onto Studio's chrome so BrushKit
// reads native in the viewport (dark navy panels, the same blue accent).
const PAINT_THEME: PaintTheme = {
  page: '#0a111c', panel: '#0c1626', control: '#13233a', frame: '#23364f',
  ink: '#cfe2ff', dim: '#7f93b1', accent: '#4a90e2', bad: '#a14545',
};
// Studio's paint brush opens a touch smaller than the kit default (prop-scale
// work wants a finer dab) and on a warm red so the first stroke is obvious.
const STUDIO_DEFAULT_BRUSH: Brush = { ...DEFAULT_BRUSH, size: 18, ink: { kind: 'color', hex: '#c64b53' } };
// The paint tools Studio surfaces in the kit — the host-supported set PLUS `text`
// (click-to-stamp a typed string into the texture, req_1600). text isn't a stroke,
// so it's handled Studio-side in the press handler (like faceFill), not by the kit.
const STUDIO_PAINT_TOOLS: BrushTool[] = ['brush', 'eraser', 'line', 'rect', 'ellipse', 'eyedropper', 'text'];

// The PIXEL paint texture (STUDIO_PAINT_KEY) is ONE shared GPU texture for every
// model, so it must be RELOADED whenever the open model changes — these track which
// model's pixels currently sit in it and whether a real saved blob was loaded for it.
// Module-scoped so they survive re-renders but reset on a full remount (texture
// destroyed) and on hot reload (module re-eval). Keyed by model ID (names repeat).
// This replaces the old once-per-session restore gate that left the shared texture
// holding the PREVIOUS model's paint and never re-restored after a switch / restart
// (the "paint carries over / goes white / lost on restart" bugs — req_1488/1492).
let g_loadedPaintModel: string | null = null;
let g_loadedHadBlob = false;

export function StudioViewport(props: { parts: StudioPart[]; allParts?: StudioPart[]; revision: number; meshRev: number; activeName: string | null; sceneName: string | null; partCount: number; activePart: StudioPart | null; onEditMesh: (id: string, mesh: EditMesh) => void; onAddPart: (mesh: EditMesh, name: string, lift?: number) => string; onMergeActive: () => void; mergeTargetName: string | null; onSelectFaces: (ids: number[]) => void; palette: Palette | null; onEditPaint: (id: string, paint: PaintCells) => void; onSetPalette: (p: Palette) => void; sceneId: string | null; paintRef: string | null; paintBlob: (ref: string | null) => string | null; onBakePaint: (paintRef: string, blobB64: string) => void; canUndo: boolean; onUndo: () => void; canRedo: boolean; onRedo: () => void; onImportModel: () => void }) {
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
  // A fresh nonce per MOUNT. Folded into the backdrop geometry id, texture key,
  // and React key so every mount (incl. the one after a hot reload) bakes the
  // trace image FRESH instead of reusing a host-cached bake keyed by the stable
  // bd.id — which is what was leaving the image offset/reshaped after an update
  // (req_1444: "just play it dumb, on updates unmount and remount it").
  const mountEpoch = useRef(Math.floor(nowMs())).current;
  // BACKDROP RESET DIAGNOSTIC (req_1541): the trace image resets on a .ts hot reload
  // but not a .tsx one. Theory: a .ts reload RE-MOUNTS StudioViewport, minting a new
  // mountEpoch, which rotates every backdrop slot/version/texture key → the host
  // re-bakes the image (the reset). A .tsx reload renders in place (same epoch → no
  // re-bake). Trace mount/unmount with the epoch so a .ts edit prints a NEW epoch and
  // a .tsx edit prints nothing — and mirror the epoch into an on-screen readout below
  // (cart console may not reach the terminal). REMOVE once root-caused.
  useEffect(() => {
    console.warn(`[bd-diag] StudioViewport MOUNT epoch=${mountEpoch}`);
    return () => console.warn(`[bd-diag] StudioViewport UNMOUNT epoch=${mountEpoch}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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

  // WORKING-VIEW PERSISTENCE (req_1435/1437): the camera is twig state — it must
  // survive a hot reload so a code update never throws away where you were
  // looking. Restored EXACTLY (yaw/pitch/dist/fov), because an approximate manual
  // re-aim shifts the parallax between the near model and the far trace backdrop,
  // so the reference image lands offset. Read once at mount (resets on cold
  // restart — hotstate is in-process); persistCam() writes it back on every move.
  const camSaved = useRef(getHotState<{ yaw: number; pitch: number; dist: number; fov: number } | null>('studio:cam', null)).current;
  const lookRef = useRef(camSaved ? { yaw: camSaved.yaw, pitch: camSaved.pitch } : { yaw: STUDIO.bootYaw, pitch: STUDIO.bootPitch });
  const distRef = useRef(camSaved ? camSaved.dist : fitDistance());
  const fovRef = useRef<number>(camSaved ? camSaved.fov : STUDIO.fov);
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
  // PAINT mode — now driven by the UNIVERSAL kit (req_1487). The brush (footprint,
  // ink colour, size/hardness/flow/scatter/angle/blend) and the active tool ARE the
  // kit's model, held as TWIG so they survive a hot reload but reset cold. `faceFill`
  // keeps Studio's one-click whole-face flat-fill (a model-texture op the kit doesn't
  // own); `paintRecents` backs the kit palette's recents ring. The model's saved
  // palette (props.palette) stays the BRANCH source of truth for swatches + materials.
  const [brush, setBrush] = useHotState<Brush>('studio:brush', STUDIO_DEFAULT_BRUSH);
  const [tool, setTool] = useHotState<BrushTool>('studio:tool', 'brush');
  const [faceFill, setFaceFill] = useHotState<boolean>('studio:paintFill', false);
  // CONTAIN-TO-FACE (req_1611): the freehand brush/eraser cross atlas seams smoothly by
  // default (req_1580), which is great for big surfaces but makes clean edge work hard —
  // there's no way to keep paint inside ONE face. This toggle routes the brush through
  // the per-face island-clipped path instead, so a dab only paints the face it's over
  // (paint right up to an edge, no bleed onto the neighbour). Off = the smooth surface path.
  const [lockFace, setLockFace] = useHotState<boolean>('studio:paintLockFace', false);
  const [paintRecents, setPaintRecents] = useHotState<PaletteEntry[]>('studio:paintRecents', []);
  // The string the TEXT tool stamps (req_1600). Twig — survives a hot reload but
  // resets cold; the click point + brush size/colour place and scale each stamp.
  const [textValue, setTextValue] = useHotState<string>('studio:paintText', 'TEXT');
  // The TEXT LAYER (req_1609): text is placed as a MOVABLE layer, like a normal
  // editor. `textLayerRef` holds the texture state BELOW the text (a base snapshot)
  // plus the live anchor UV + face; dragging re-raycasts and re-composites
  // (restore base → re-stamp) so the text glides over the surface. `textDragRef`
  // gates the live move; `textPlacing` drives the panel's place/cancel buttons.
  const textLayerRef = useRef<{ base: Uint8Array; u: number; v: number; partIndex: number; faceIndex: number } | null>(null);
  const textDragRef = useRef(false);
  const textComposeAtRef = useRef(0); // throttle the per-move full-texture re-composite
  const [textPlacing, setTextPlacing] = useState(false);
  // PAINT cell size in MODEL UNITS (req_1301): kept for the pre-paint atlas preview
  // (SceneTextureAtlas) only — the pixel painter resolution is fixed (PAINT_TEX) and
  // the kit's size dial is the real detail control now, so there's no UI for this.
  const [paintCell] = useHotState<number>('studio:paintCell', 0.06);
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
  // 3D-SURFACE freehand stroke (req_1580): brush/eraser interpolate in SCREEN space and
  // stamp a world-radius brush onto every face it touches (surfaceBrushDabs), so a stroke
  // stays continuous across atlas-island seams. surfaceStrokeActiveRef gates move/up to
  // this path vs the kit (which owns the atlas-space shape tools + eyedropper). paintUpw
  // is the hit face's uv↔world scale latched on press, so the brush is one world size.
  const surfaceStrokeActiveRef = useRef(false);
  const lastPaintScreenRef = useRef<{ x: number; y: number } | null>(null);
  const paintUpwRef = useRef(0);
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
  // Load-from-prop picker (req_1667/1668): a painting compiled into a prop carries the
  // SAME content-addressed texture blob (texRef === the model's paintRef), and the
  // cooked-asset store NEVER GCs those blobs (unlike the model stream, req_1556) — so a
  // compiled prop is the DURABLE backup of a painting. This picker pulls a prop's
  // texture blob back onto the OPEN model so painting is never a one-shot: open the
  // model, load its prop's texture, keep painting. null = closed.
  const [loadPropOpen, setLoadPropOpen] = useState(false);
  // Re-attach a compiled prop's painted texture to the open model. Persists onto THIS
  // model (paintRef + interned blob) AND uploads into the live <Paintable> so it shows
  // at once — works from any mode (the display path keys on the model's paintRef now).
  const loadPaintFromAsset = (asset: CookedAsset) => {
    if (!asset.texRef) { toast('that prop has no painted texture to load'); return; }
    const blob = cookedTextureBlob(asset.texRef);
    if (!blob) { toast(`"${asset.name}" texture is missing from the store`); return; }
    props.onBakePaint(asset.texRef, blob); // persist onto the open model + intern the blob
    restorePaint(blob);                    // show it now (parks until the Paintable mounts)
    markPaintInited(props.sceneName ?? null);
    setPaintBakeTick((t) => t + 1);
    setLoadPropOpen(false);
    toast(`loaded "${asset.name}" onto this model — paint away`);
  };

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

  // Selection is twig state too (req_1435/1437): a hot reload must NOT throw away
  // what you had selected — it's the one thing you can't re-aim by hand (the gizmo
  // is just gone). Restored from hotstate as arrays (Sets aren't JSON), valid
  // because the mesh indices are unchanged across a reload.
  const [sel, setSel] = useState<Selection>(() => {
    const s = getHotState<{ v: number[]; e: number[]; f: number[] } | null>('studio:sel', null);
    return s ? { verts: new Set(s.v), edges: new Set(s.e), faces: new Set(s.f) } : emptySelection();
  });
  useEffect(() => { setHotState('studio:sel', { v: [...sel.verts], e: [...sel.edges], f: [...sel.faces] }); }, [sel]);
  // mouse-press events don't carry modifier flags here — held shift/ctrl come
  // from the key bus (req_0979). This is the same ref IsoAuthor uses.
  const heldMods = useHeldModifiers();
  // selection is per-part — drop it when the active part changes. The mount run
  // is SKIPPED so a restored selection survives a hot reload (req_1437); it only
  // clears on a real part switch.
  const skipFirstSelClear = useRef(true);
  useEffect(() => {
    if (skipFirstSelClear.current) { skipFirstSelClear.current = false; return; }
    setSel(emptySelection());
  }, [activePart?.id]);
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
  const [allParts, setAllParts] = useState(false);
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
  // TEXTURE SLOTS (req_1542): rename drafts keyed by slot id, committed on submit so
  // a rename isn't an undo entry per keystroke (the FacePainter sign-text pattern).
  const [slotDrafts, setSlotDrafts] = useState<Record<string, string>>({});
  // Declare the current face selection as a new texture slot (a re-skinnable surface
  // the cook carries → the iso editor skins). Auto-named; rename inline. Selects it.
  const newSlotFromSelection = () => {
    if (!activePart || selMode !== 'face' || sel.faces.size === 0) return;
    const n = (activePart.mesh.slots?.length ?? 0) + 1;
    const { mesh } = addTextureSlot(activePart.mesh, `surface ${n}`, sel.faces);
    props.onEditMesh(activePart.id, mesh);
  };
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
  useEffect(() => { if (selMode !== 'paint') { paintHoverRef.current = null; paintingRef.current = false; if (textLayerRef.current) commitTextLayer(); } }, [selMode]);
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

  // Self-serve rebinding (req_1433): a Hotkeys panel reads/writes the control
  // contract. Hydrate the user's saved overrides once at mount.
  const [hotkeysOpen, setHotkeysOpen] = useState(false);
  useEffect(() => { loadKeybinds(); }, []);

  // MESH OPS as shared functions (req_1446 follow-up): one body each, called by
  // BOTH the rail button and the hotkey, so a key and its button never drift
  // (rule of two). Each re-checks its own gate, so a key press in the wrong mode
  // is a safe no-op.
  const opExtrude = () => {
    if (selMode !== 'face' || !activePart || sel.faces.size !== 1) return;
    const faceIndex = [...sel.faces][0];
    props.onEditMesh(activePart.id, splitConcaveFaces(extrudeFace(activePart.mesh, faceIndex, STUDIO.extrudeMeters)));
    setGizmoTool('move'); // ready to drag the new cap in/out
  };
  const opLoopCut = () => {
    if (selMode !== 'face' || !activePart || sel.faces.size !== 1) return;
    const faceIndex = [...sel.faces][0];
    const info = loopCutAxisInfo(activePart.mesh, faceIndex, 0);
    if (!info) return;
    setLc({ faceIndex, dir: 0, cuts: 1, offset: Math.round(info.sizeUnits / 2), unit: 'units' });
  };
  const opFlip = () => {
    if (selMode !== 'face' || !activePart || sel.faces.size < 1) return;
    let out = activePart.mesh;
    for (const fi of sel.faces) out = flipFace(out, fi);
    props.onEditMesh(activePart.id, out);
  };
  const opGlass = () => {
    if (selMode !== 'face' || !activePart || sel.faces.size < 1) return;
    const faceList = [...sel.faces];
    const allGlass = faceList.every((i) => activePart.mesh.faces[i]?.glass);
    props.onEditMesh(activePart.id, setFaceGlass(activePart.mesh, faceList, !allGlass));
  };
  const opDetach = () => {
    if (selMode !== 'face' || !activePart || sel.faces.size < 1) return;
    const { panel, body } = detachPanel(activePart.mesh, [...sel.faces], STUDIO.shellThicknessMeters);
    props.onEditMesh(activePart.id, body);
    props.onAddPart(panel, 'panel', activePart.lift);
    setSel(emptySelection());
  };
  const opSolidify = () => {
    if (selMode !== 'face' || !activePart || sel.faces.size < 1) return;
    const out = solidifyFaces(activePart.mesh, [...sel.faces], STUDIO.shellThicknessMeters);
    if (out !== activePart.mesh) { props.onEditMesh(activePart.id, out); setSel(emptySelection()); }
  };
  const opSymmetrize = (keepPos: boolean) => {
    if (!activePart || !symReport || selMode === 'paint') return;
    props.onEditMesh(activePart.id, symmetrize(activePart.mesh, symReport.axis, keepPos));
    setSel(emptySelection()); setRigSel(null);
  };
  // Center (req_1538): slide the part so its bounds center sits on the origin, so the
  // x=0/y=0/z=0 mirror plane bisects it — the prerequisite for true mirror editing AND
  // mirror painting. A no-op when already centered (centerMesh returns the same mesh).
  const opCenter = () => {
    if (!activePart) return;
    const out = centerMesh(activePart.mesh);
    if (out !== activePart.mesh) { props.onEditMesh(activePart.id, out); toast('centered on origin'); }
    else toast('already centered');
  };

  // Selection keys — folded into the EDITOR CONTROL CONTRACT ('studio' scope,
  // editors/controls.ts). The dispatcher owns the typing gate, so the old
  // hand-written "a focused TextInput eats the key" guard (req_0978) is gone,
  // not copied. Defaults reproduce the prior bindings; F now actually reframes
  // (it was advertised in the tooltip but never wired). Ctrl+Z/Y stay OUT of
  // this scope — see the controls.ts note (bench owns history).
  useEditorControls('studio', {
    active: true,
    handlers: {
      // Esc: finish moving a backdrop → drop an open bevel preview → clear the selection.
      'selection.cancel': () => {
        if (moveBackdropId) { setMoveBackdropId(null); return; }
        if (bv) { setBv(null); setDraft(null); return; }
        setSel(emptySelection()); setRigSel(null);
      },
      // Ctrl/Cmd+A: select every element of the active mode (vertex/edge/face only).
      'selection.all': () => {
        if (selMode === 'rig' || selMode === 'object' || selMode === 'paint' || !activePart || lc || bv || autoFix) return;
        const mesh = activePart.mesh;
        if (selMode === 'face') setSel({ verts: new Set(), edges: new Set(), faces: new Set(mesh.faces.map((_, i) => i)) });
        else if (selMode === 'vertex') setSel({ verts: new Set(mesh.verts.map((_, i) => i)), edges: new Set(), faces: new Set() });
        else setSel({ verts: new Set(), edges: new Set(meshEdges(mesh).map((_, i) => i)), faces: new Set() });
        // The host's Ctrl+A also lights up every text label app-wide (selection.zig
        // sel_all); we handled it for the mesh, so drop that highlight (req_1058).
        callHost('__selection_clear', null);
      },
      // Delete/Backspace: in rig mode remove the selected joint (or drop the pivot,
      // req_1054); otherwise delete the faces the selection belongs to (req_1020).
      'selection.delete': () => {
        if (selMode === 'rig') {
          if (!activePart) return;
          if (rigSel?.kind === 'joint') { props.onEditMesh(activePart.id, removeMount(activePart.mesh, rigSel.name)); setRigSel(null); }
          else if (rigSel?.kind === 'pivot') { props.onEditMesh(activePart.id, clearPivot(activePart.mesh)); setRigSel(null); }
          return;
        }
        if (selMode === 'object' || selMode === 'paint' || !activePart || lc || bv || autoFix) return;
        const mesh = activePart.mesh;
        const faces = selectionFaceIndices(mesh, selMode, sel);
        if (faces.length === 0) return;
        props.onEditMesh(activePart.id, deleteFaces(mesh, faces));
        setSel(emptySelection());
      },
      // F / Home: reframe the camera on the model (reframe() is defined below).
      'view.recenter': () => reframe(),
      // Modes (1–6): same gate as the tab (non-object needs a part; paint mints a texture).
      'mode.object': () => setSelMode('object'),
      'mode.vertex': () => { if (activePart) setSelMode('vertex'); },
      'mode.edge': () => { if (activePart) setSelMode('edge'); },
      'mode.face': () => { if (activePart) setSelMode('face'); },
      'mode.rig': () => { if (activePart) setSelMode('rig'); },
      'mode.paint': () => { if (activePart) { ensureTexture(); setSelMode('paint'); } },
      // Transform tools (G/R/S): only in the geometry modes, like the rail buttons.
      'tool.move': () => { if (selMode !== 'rig' && selMode !== 'paint') setGizmoTool('move'); },
      'tool.rotate': () => { if (selMode !== 'rig' && selMode !== 'paint') setGizmoTool('rotate'); },
      'tool.resize': () => { if (selMode !== 'rig' && selMode !== 'paint') setGizmoTool('resize'); },
      // Mesh ops — each gates itself, so the key is a no-op outside its context.
      'op.extrude': opExtrude,
      'op.loop-cut': opLoopCut,
      'op.flip': opFlip,
      'op.glass': opGlass,
      'op.detach': opDetach,
      'op.solidify': opSolidify,
      'op.symmetrize': () => opSymmetrize(true),
    },
  });
  // Pick a paint tool (hotkey or BrushKit) — also drops the faceFill overlay so the
  // tool actually applies (faceFill is checked before the tool in the press handler).
  const selectTool = (t: BrushTool) => {
    // leaving the text tool with a layer still up → bake it in place (don't lose work).
    if (tool === 'text' && t !== 'text' && textLayerRef.current) commitTextLayer();
    setTool(t); setFaceFill(false);
  };
  // PAINT tool family hotkeys — a SEPARATE scope, live only while painting, so the
  // kit's native b/e/l/r/o/i don't collide with the mesh-op letters in 'studio'.
  useEditorControls('studio-paint', {
    active: selMode === 'paint',
    handlers: {
      'paint.brush': () => selectTool('brush'),
      'paint.eraser': () => selectTool('eraser'),
      'paint.line': () => selectTool('line'),
      'paint.rect': () => selectTool('rect'),
      'paint.ellipse': () => selectTool('ellipse'),
      'paint.eyedropper': () => selectTool('eyedropper'),
      'paint.text': () => selectTool('text'),
    },
  });
  // Tooltip prefix for a keyed action, read from the LIVE contract so it shows
  // the current (possibly rebound) chord — "F · ", "Ctrl+Z · ", or "" if unbound.
  const keyHint = (action: string, scope: 'studio' | 'bench' = 'studio') => {
    const c = chordHintFor(scope, action);
    return c ? `${c} · ` : '';
  };
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
  // box-atlas StaticSurface isn't needed and isn't baked for it. A REOPENED painted
  // model carries its content-addressed blob (paintRef → paintBlob) even before any
  // paint texture is built, so treat it as painted the moment its blob is resolvable
  // — otherwise object/rig mode showed a blank block until you re-entered paint
  // (the texture `tex` is only built on paint-enter; on reopen it's null). req_1661.
  const havePaintBlob = !!props.paintRef && !!props.paintBlob(props.paintRef);
  const modelPainted = havePaintBlob || (!!tex && paintInited(props.sceneName ?? null));
  // A signature of the scene's FACE topology: parts + per-part face counts. The paint
  // atlas must allocate one distinct slot per (part, face); when this changes (a part
  // added, a face extruded/mirrored), faces created AFTER the last pack carry their
  // default full-square UV — which all overlap at one atlas region, so painting one
  // such face shows on every other (the mirrored-prong bug, req_1320). A mismatch vs
  // the packed tex's faceSig means "re-slot needed".
  // The paint atlas must be packed over ALL parts (visible + hidden), not just the
  // visible set the viewport renders (req_1613): the viewport receives only visibleParts,
  // so hiding a part used to shrink the pack set and re-slot the survivors' UV islands —
  // their paint (and any stamped text) then sampled different texels and appeared to
  // SHIFT. Packing over the full set keeps every part's island invariant to visibility.
  // Falls back to the visible set if the host didn't pass allParts.
  const atlasParts = props.allParts ?? props.parts;
  const paintFaceSig = atlasParts.map((p) => `${p.id}:${p.mesh.faces.length}`).join('|');
  // req_1375: faces sharing an atlas island (congruent-face dedup, or a default
  // full-square UV) make one click paint several faces. faceSig only sees the face
  // COUNT, so it can't catch a shared/default UV layout — this does. When true, the
  // pack below MUST run (dedup off) so every face owns a unique, isolated island.
  const paintRepackNeeded = painting && paintUVsNeedRepack(atlasParts.map((p) => p.mesh));
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
    const result = textureizeScene(atlasParts.map((p) => p.mesh), paintOpts, STUDIO.unitsPerTile, STUDIO.paintAtlasTexels);
    // Apply only the meshes whose UVs actually changed (textureize is idempotent now),
    // so re-slotting after adding ONE face doesn't churn every part. Paint is keyed in
    // face-relative cells, so it survives a re-slot — DON'T wipe it (it was being lost
    // on every repack, req_1320); the seed effect re-reads it from the branch. Packs over
    // ALL parts (atlasParts) so hidden parts keep their slot and visible paint stays put.
    result.meshes.forEach((mesh, i) => { if (mesh !== atlasParts[i].mesh) props.onEditMesh(atlasParts[i].id, mesh); });
    setTex({ ...(tex ?? {}), texels: result.texels, type: 'solid', color: '#c8ccd2', name: 'paint-v4', paintRev: (tex?.paintRev ?? 0), paintFit: true, faceSig: paintFaceSig });
    setTexView(true);
  };
  // The colour the brush lays down — straight off the kit brush's ink (req_1487). A
  // texture/shader ink (Phase B) resolves to a neutral until the host stamp pass
  // lands, so the fill / face-fill / base-coat ops always have a real hex.
  const brushHex = (): string => (brush.ink.kind === 'color' ? brush.ink.hex : '#c8ccd2');
  // Track the face under the cursor (cursor pump reads this ref). Returns a FaceHit
  // (cu/cv unused by the pixel painter) so the existing in/out hover logic is intact.
  const paintProbe = (sx: number, sy: number): FaceHit | null => {
    if (!tex) { paintHoverRef.current = null; return null; }
    const hit = pickFaceUV(paintTargets(), camSnap(), sx, sy);
    const fh = hit ? { partIndex: hit.partIndex, faceIndex: hit.faceIndex, cu: 0, cv: 0 } : null;
    paintHoverRef.current = fh;
    return fh;
  };
  // Whole-face flat-fill (the faceFill toggle, req_1487): raycast → the hit face's
  // UV island → stamp a disc large enough to cover it, SCISSOR-clamped to the island
  // so it can't bleed onto the neighbour packed beside it. A Studio model-texture op
  // (the kit's flood-fill is a Phase-B host pass); returns whether a face was filled.
  const faceFillAt = (sx: number, sy: number): boolean => {
    if (!tex) return false;
    const hit = pickFaceUV(paintTargets(), camSnap(), sx, sy);
    if (!hit) return false;
    const tgt = paintTargets()[hit.partIndex];
    if (!tgt) return false;
    const island = faceIslandPx(tgt.mesh, hit.faceIndex);
    const r = island ? Math.hypot(island.x1 - island.x0, island.y1 - island.y0) : PAINT_TEX;
    stampUV(hit.u, hit.v, brushHex(), r, island);
    touchedRef.current.add(tgt.partId);
    paintDirtyRef.current = true;
    return true;
  };
  // ── TEXT as a movable LAYER (req_1600/1609) ──
  // Text behaves like a normal editor's text layer: clicking captures the texture
  // BELOW it (a base snapshot) and lays the typed string on top; dragging re-raycasts
  // and re-composites (restore base → re-stamp) so the text glides over the surface.
  // "place" bakes it (one undo entry removes the whole text); "cancel" restores the
  // base. Brush SIZE scales the glyphs, brush COLOUR inks them, editing the field
  // re-stamps live. The string is laid out as 5×7 bitmap glyphs (runtime/paint glyphs),
  // one filled SQUARE dab per lit cell, SCISSOR-clamped to the face's UV island.
  //
  // Stamp the typed string centred on (u,v) of one face, clipped to its island.
  const stampTextAtUV = (u: number, v: number, mesh: EditMesh, faceIndex: number): void => {
    if (!tex || !textValue.trim()) return;
    const layout = layoutText(textValue);
    if (!layout.cells.length) return;
    const island = faceIslandPx(mesh, faceIndex);
    let cx0 = 0, cy0 = 0, cw = 0, ch = 0;
    if (island) {
      cx0 = Math.max(0, Math.floor(island.x0));
      cy0 = Math.max(0, Math.floor(island.y0));
      cw = Math.max(1, Math.ceil(island.x1) - cx0);
      ch = Math.max(1, Math.ceil(island.y1) - cy0);
    }
    const cell = Math.max(1, Math.round(brush.size / 4)); // texture px per font pixel
    const [r, g, b] = brushDabRgb(brush, tool, tex?.color ?? '#c8ccd2');
    // centre the block on the anchor so the text sits where you aimed
    const ox = u * PAINT_TEX - (layout.width * cell) / 2;
    const oy = v * PAINT_TEX - (layout.height * cell) / 2;
    const radius = cell * 0.6; // square half-extent: cells in a glyph merge seamlessly
    const lineStep = GLYPH_H + 1; // matches glyphs.ts LINE_STEP (glyph height + 1px gap)
    for (const c of layout.cells) {
      const px = ox + (c.x + 0.5) * cell;
      // flip each glyph's rows: atlas-Y runs opposite to surface-up, so without this the
      // text lands upside down (req_1609). Flip WITHIN the line so multi-line order holds.
      const line = Math.floor(c.y / lineStep);
      const fy = line * lineStep + (GLYPH_H - 1 - (c.y - line * lineStep));
      const py = oy + (fy + 0.5) * cell;
      // kind 2 = square, hardness 1, aspect 1 → a crisp filled cell, clipped to the island.
      paintTex().brushColor(px, py, radius, r, g, b, 2, 0, 1, 1, 1, 0, 0, cx0, cy0, cw, ch);
    }
  };
  // Re-composite the active layer: restore the base (the texture below the text), then
  // re-stamp the text on top at its current anchor. The single source of the live look.
  const composeTextLayer = (): void => {
    const L = textLayerRef.current;
    if (!L) return;
    const tgt = paintTargets()[L.partIndex];
    if (!tgt) return;
    paintTex().upload(L.base);
    stampTextAtUV(L.u, L.v, tgt.mesh, L.faceIndex);
    touchedRef.current.add(tgt.partId);
    paintDirtyRef.current = true;
  };
  // Begin (or move) the layer at a screen point — raycast → UV anchor. On first
  // placement it snapshots the texture below (for cancel + one undo entry). Returns
  // true on a model hit (so the caller can begin a move drag), false on a miss.
  const textPlaceAt = (sx: number, sy: number): boolean => {
    if (!tex) return false;
    const hit = pickFaceUV(paintTargets(), camSnap(), sx, sy);
    if (!hit) return false;
    const tgt = paintTargets()[hit.partIndex];
    if (!tgt) return false;
    let L = textLayerRef.current;
    if (!L) {
      paintSnapshotBegin(); // pre-text state → undo ring (one undo removes the placed text)
      const base = paintTex().readback();
      if (!base) return false;
      L = { base, u: hit.u, v: hit.v, partIndex: hit.partIndex, faceIndex: hit.faceIndex };
      textLayerRef.current = L;
      setTextPlacing(true);
    } else {
      L.u = hit.u; L.v = hit.v; L.partIndex = hit.partIndex; L.faceIndex = hit.faceIndex;
    }
    if (!texView) setTexView(true);
    composeTextLayer();
    return true;
  };
  // Move the live layer to a screen point during a drag — re-raycast (cheap) every move
  // but THROTTLE the re-composite (a full-texture upload) to ~30fps so dragging stays
  // smooth. A miss keeps the last anchor (no jump off the model).
  const textMoveTo = (sx: number, sy: number): void => {
    const L = textLayerRef.current;
    if (!L || !tex) return;
    const hit = pickFaceUV(paintTargets(), camSnap(), sx, sy);
    if (!hit) return;
    L.u = hit.u; L.v = hit.v; L.partIndex = hit.partIndex; L.faceIndex = hit.faceIndex;
    const t = nowMs();
    if (t - textComposeAtRef.current >= 33) { textComposeAtRef.current = t; composeTextLayer(); }
  };
  // Place (bake) the active layer: it's already composited into the texture, so just
  // persist + clear. The pre-text undo snapshot stays, so one undo lifts the whole text.
  const commitTextLayer = (): void => {
    if (!textLayerRef.current) return;
    textLayerRef.current = null; textDragRef.current = false; setTextPlacing(false);
    paintDirtyRef.current = true; commitPaint();
  };
  // Cancel the active layer: restore the base (remove the text), drop the undo snapshot
  // we pushed on begin (nothing was placed), and persist the restored state.
  const cancelTextLayer = (): void => {
    const L = textLayerRef.current;
    if (!L) return;
    textLayerRef.current = null; textDragRef.current = false; setTextPlacing(false);
    paintTex().upload(L.base);
    paintDropUndoSnapshot();
    paintDirtyRef.current = true; commitPaint();
  };
  // Re-stamp the live layer when the TEXT / SIZE / COLOUR changes (not mid-drag — the
  // move handler composites then). Keeps the preview in sync with edits in the panel.
  useEffect(() => {
    if (textLayerRef.current && !textDragRef.current) composeTextLayer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textValue, brush, textPlacing]);
  // FILL ALL (req_1352): one click to make the whole model one colour. The PIXEL
  // painter flat-fills the entire texture (every face samples it) in one clear —
  // no per-face/per-cell walk, no orphans, no leak. Erase fills the base coat.
  const fillAllFaces = () => {
    baseCoat(brushHex());
    for (const tgt of paintTargets()) touchedRef.current.add(tgt.partId);
    paintDirtyRef.current = true;
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
  // Switching models shares ONE paint texture (STUDIO_PAINT_KEY) — drop the undo ring
  // so a new model doesn't inherit the previous model's stroke history.
  useEffect(() => { clearPaintHistory(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [props.sceneId]);
  // Reset the shared-texture load tracker when the viewport unmounts (the <Paintable>
  // is destroyed with it, so on return the texture is blank and MUST be reloaded).
  useEffect(() => () => { g_loadedPaintModel = null; g_loadedHadBlob = false; }, []);
  // PIXEL painter init + paint-active (req_1488/1492). The shared STUDIO_PAINT_KEY
  // texture holds ONE model's pixels at a time, so RELOAD it from the open model's
  // saved blob whenever the open model changes — OR when that model's blob first
  // arrives async (restart: the model opens before its paintRef materialises). The OLD
  // once-per-session gate left the texture holding the previous model's paint and never
  // re-restored, so paint carried over / got wiped / vanished on restart. We must NOT
  // reload our OWN just-saved strokes (commitPaint advances g_loadedPaintModel/HadBlob),
  // and never mid-stroke (paintingRef guard).
  useEffect(() => {
    setPaintActive(painting);
    if (paintingRef.current) return;
    // Restore the shared paint texture either when ENTERING paint (tex built) OR when a
    // painted model is (re)opened in ANY mode (req_1661): its blob must land in the
    // <Paintable> so object/rig show the painting too — not a blank block. With neither
    // a live paint texture nor a saved blob there's nothing to restore.
    if (!tex && !havePaintBlob) return;
    const model = props.sceneId ?? null;
    const base = tex?.color ?? '#c8ccd2';
    const modelChanged = g_loadedPaintModel !== model;
    const blobArrived = !modelChanged && !g_loadedHadBlob && !!props.paintRef; // first saved blob for this model
    if (!modelChanged && !blobArrived) { markPaintInited(props.sceneName ?? null); return; }
    const blob = props.paintRef ? props.paintBlob(props.paintRef) : null;
    const id = setTimeout(() => {
      if (paintingRef.current) return; // a stroke started while we waited — don't clobber it
      const loaded = !!(blob && restorePaint(blob));
      // Only lay the base coat for an ACTIVE paint session; never clobber a reopened
      // view to grey when its blob simply hasn't resolved.
      if (!loaded && painting) baseCoat(base);
      g_loadedPaintModel = model;
      g_loadedHadBlob = loaded;
      markPaintInited(props.sceneName ?? null);
    }, 60);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [painting, props.sceneId, props.sceneName, !!tex, props.paintRef, props.paintBlob, havePaintBlob]);
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
    // savePaint returns the content hash it just wrote. The shared texture already
    // holds exactly that, so advance the load tracker to it — otherwise the incoming
    // props.paintRef change (our own save) would trigger the restore effect to reload
    // and clobber the live painting. (req_1488/1492)
    const ref = savePaint(props.onBakePaint);
    if (ref) { g_loadedPaintModel = props.sceneId ?? null; g_loadedHadBlob = true; }
  };
  // resolve paint against the model palette, falling back to the default so a stroke
  // shows live BEFORE the first commit mints the real (persisted) palette.
  const livePalette: Palette = props.palette ?? defaultPalette();

  // ── The UNIVERSAL kit stamping engine (req_1487) ──
  // mapPoint is the ONE thing a 3D paint surface has to supply: screen pixel →
  // raycast the model → the hit face's interpolated UV in texture pixels, PLUS the
  // face's UV-island as the dab scissor clip (so a round brush stays on the face it
  // landed on, never bleeding onto the neighbour island). The kit's useBrushStroke
  // then owns the whole experience — brush/eraser/line/rect/oval/pick, shift-straight
  // lines, gap-free optimistic dabs straight to the host — identical to every other
  // cart. The clip rect mirrors meshPaintTexture.stampUV's island rounding exactly.
  const paintMapPoint = (screenX: number, screenY: number) => {
    if (!tex) return null;
    const r = rectRef.current;
    const hit = pickFaceUV(paintTargets(), camSnap(), screenX - r.x, screenY - r.y);
    if (!hit) return null;
    const tgt = paintTargets()[hit.partIndex];
    if (!tgt) return null;
    if (tool !== 'eyedropper') touchedRef.current.add(tgt.partId);
    return { x: hit.u * PAINT_TEX, y: hit.v * PAINT_TEX, clip: islandToClip(faceIslandPx(tgt.mesh, hit.faceIndex)) ?? undefined };
  };
  const pickPaintColor = (hex: string) => {
    const ink = { kind: 'color' as const, hex };
    setBrush((b) => ({ ...b, ink }));
    setPaintRecents((recents) => pushRecent({ swatches: [], recents }, ink).recents);
  };

  // ── 3D-SURFACE freehand brush/eraser (req_1580) ──
  // A UV-island rect → the host clip rect (rounded so a dab can't spill past the face).
  const islandToClip = (r: TexelRect | null): ClipRect | null => {
    if (!r) return null;
    const x = Math.max(0, Math.floor(r.x0)), y = Math.max(0, Math.floor(r.y0));
    return { x, y, w: Math.max(1, Math.ceil(r.x1) - x), h: Math.max(1, Math.ceil(r.y1) - y) };
  };
  const SURFACE_STEP_PX = 3; // screen-space interpolation step (gap-free, cheap raycasts)
  const pressureOf = (e: any): number | undefined => { const p = Number(e?.pressure); return Number.isFinite(p) && p > 0 ? p : undefined; };
  // Stamp the brush at ONE screen point: raycast → 3D surface point → every face within
  // the brush's WORLD radius gets a disc in its own UV island (continuous across seams),
  // plus the mirror image(s) when a symmetry plane is on. Returns false on a miss.
  const surfaceStampAt = (sx: number, sy: number, pressure?: number): boolean => {
    if (!tex) return false;
    const hit = pickFaceUV(paintTargets(), camSnap(), sx, sy);
    if (!hit) return false;
    const tgt = paintTargets()[hit.partIndex];
    if (!tgt) return false;
    touchedRef.current.add(tgt.partId);
    const upw = paintUpwRef.current > 1e-9 ? paintUpwRef.current : faceUvPerWorld(tgt.mesh, hit.faceIndex);
    // World radius from the brush's pixel radius at the hit face's scale, so the on-screen
    // size matches the kit AND the brush is one uniform WORLD size across every face.
    const worldR = upw > 1e-9 ? pressureRadius(brush.size, pressure) / PAINT_TEX / upw : 0;
    if (!(worldR > 0)) return true;
    const rgb = brushDabRgb(brush, tool, tex?.color ?? '#c8ccd2');
    for (const d of surfaceBrushDabs(tgt.mesh, tgt.lift, hit.world, worldR, PAINT_TEX)) {
      // CONTAIN-TO-FACE (req_1611): when locked, only paint the face under the cursor —
      // skip the other faces the brush sphere also reaches, so a stroke near an edge
      // never bleeds onto the neighbour. Off = the smooth cross-seam brush (req_1580).
      if (lockFace && d.faceIndex !== hit.faceIndex) continue;
      const px = d.u * PAINT_TEX, py = d.v * PAINT_TEX;
      stampBrushDab(paintTex(), brush, rgb, px, py, d.radiusPx, islandToClip(d.clip));
      if (mirrorAxes.length) {
        for (const md of mirrorPaintDabs(paintTargets(), px, py, mirrorAxes, PAINT_TEX)) {
          stampBrushDab(paintTex(), brush, rgb, md.x, md.y, d.radiusPx, islandToClip(md.clip));
        }
      }
    }
    return true;
  };
  const surfaceStrokeBegin = (sx: number, sy: number, pressure?: number) => {
    const hit = pickFaceUV(paintTargets(), camSnap(), sx, sy);
    const tgt = hit ? paintTargets()[hit.partIndex] : null;
    paintUpwRef.current = hit && tgt ? faceUvPerWorld(tgt.mesh, hit.faceIndex) : 0;
    lastPaintScreenRef.current = { x: sx, y: sy };
    surfaceStampAt(sx, sy, pressure);
  };
  const surfaceStrokeMove = (sx: number, sy: number, pressure?: number) => {
    const last = lastPaintScreenRef.current;
    lastPaintScreenRef.current = { x: sx, y: sy };
    if (!last) { surfaceStampAt(sx, sy, pressure); return; }
    const dx = sx - last.x, dy = sy - last.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / SURFACE_STEP_PX));
    for (let i = 1; i <= steps; i += 1) surfaceStampAt(last.x + (dx * i) / steps, last.y + (dy * i) / steps, pressure);
  };

  const paintCtl = useBrushStroke({
    paint: paintTex(),
    texW: PAINT_TEX, texH: PAINT_TEX,
    brush, tool,
    mapPoint: paintMapPoint,
    // MIRROR PAINTING (req_1538): when a mirror plane is on, every dab is also stamped
    // on the symmetric face(s). Reflects in LOCAL space about c=0 (same as mirror-edit),
    // so the model must be centered first (the Center button). Returns the atlas point +
    // island clip per image; the controller stamps them with the same brush/colour.
    mirror: mirrorAxes.length
      ? (dab: { x: number; y: number; radius: number }) =>
          mirrorPaintDabs(paintTargets(), dab.x, dab.y, mirrorAxes, PAINT_TEX).map((md) => ({ x: md.x, y: md.y, clip: islandToClip(md.clip) }))
      : undefined,
    // erase reveals the texture's base coat (no host alpha-erase until Phase B).
    eraseColor: tex?.color ?? '#c8ccd2',
    onPickColor: pickPaintColor,
    onStrokeEnd: () => { paintDirtyRef.current = true; commitPaint(); },
  });
  // The kit palette the BrushKit renders: the model's saved COLOUR slots are the
  // swatches (so saved palettes survive), backed by a twig recents ring. Materials
  // stay a Studio-side row (the pixel painter stamps their flat pseudo colour).
  const kitPalette: KitPalette = {
    swatches: livePalette.slots
      .filter((s) => s.kind === 'color')
      .map((s) => ({ id: `c${s.id}`, ink: { kind: 'color' as const, hex: slotColor(livePalette, s.id) ?? s.pseudo } })),
    recents: paintRecents,
  };
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

  // Save the live camera as twig state (survives a hot reload, req_1435/1437).
  const persistCam = () => setHotState('studio:cam', { yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, dist: distRef.current, fov: fovRef.current });
  const sendOrbit = () => { ctlRef.current?.setOrbit({ target, yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, distance: distRef.current, fov: fovRef.current, zoom: 1 }); persistCam(); };

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
  // Re-frame when the scene changes (part added/removed/reordered/toggled) — but
  // NOT on the mount that follows a hot reload when a camera was restored, or the
  // re-fit would clobber the user's saved zoom (req_1437).
  const skipFirstFit = useRef(!!camSaved);
  useEffect(() => {
    if (skipFirstFit.current) { skipFirstFit.current = false; sendOrbit(); return; }
    distRef.current = fitDistance(); sendOrbit();
    /* eslint-disable-next-line */
  }, [revision]);

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
      // A press that MISSES the model falls through to orbit (spin the camera).
      if (!pickFaceUV(paintTargets(), camSnap(), sx, sy)) {
        dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; lastMoveRef.current = nowMs();
        return;
      }
      // faceFill is Studio's one-click whole-face flat-fill (snapshot → fill → persist).
      if (faceFill) {
        paintSnapshotBegin();
        faceFillAt(sx, sy);
        if (!texView) setTexView(true);
        commitPaint();
        return;
      }
      // The text tool places a MOVABLE layer (req_1609): a press places/moves it and
      // begins a move-drag; it bakes only when you hit "place" in the panel. No commit
      // here — the layer stays live so you can drag it around and edit the string.
      if (tool === 'text') {
        if (textPlaceAt(sx, sy)) textDragRef.current = true;
        return;
      }
      // The eyedropper just samples — no stroke, no undo snapshot, no orbit.
      if (tool === 'eyedropper') { paintCtl.handlers.onMouseDown(e); return; }
      // Snapshot the PRE-stroke texture for undo (req_1379) BEFORE any dab queues
      // (readback drains pending ops, so it must run first).
      paintSnapshotBegin();
      // Freehand brush/eraser go through the 3D-SURFACE path (screen-space interpolation,
      // multi-face stamping) so strokes stay continuous across atlas seams (req_1580). The
      // "lock face" toggle (req_1611) lives INSIDE that path — it just restricts each stamp
      // to the face under the cursor — so locking keeps the same smooth brush, only
      // contained. The atlas-space shape tools (line/rect/ellipse) stay on the kit.
      if (tool === 'brush' || tool === 'eraser') {
        surfaceStrokeActiveRef.current = true;
        surfaceStrokeBegin(sx, sy, pressureOf(e));
      } else {
        surfaceStrokeActiveRef.current = false;
        paintCtl.handlers.onMouseDown(e);
      }
      paintingRef.current = true;
      if (!texView) setTexView(true); // the act of painting reveals the texture (req_1226)
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
      // TEXT tool: drag the live layer — re-raycast and re-composite so the text glides
      // over the surface. A miss keeps the last position (no jump off the model).
      if (tool === 'text' && textDragRef.current) { textMoveTo(sx, sy); return; }
      if (paintingRef.current) {
        if (surfaceStrokeActiveRef.current) surfaceStrokeMove(sx, sy, pressureOf(e)); // 3D-surface freehand
        else paintCtl.handlers.onMouseMove(e); // kit owns the atlas-space shape tools
        return;
      }
      if (!dragRef.current) { paintProbe(sx, sy); return; } // hover → ref
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
  const onUp = (e: any) => {
    // end a TEXT-layer move: drop the drag but KEEP the layer live (place/cancel are
    // explicit panel actions). Force a final composite so the resting position is exact
    // (the drag throttles intermediate frames). A single click placed it; drag moved it.
    if (textDragRef.current) { textDragRef.current = false; composeTextLayer(); return; }
    // end a paint stroke. Surface path: commit directly; kit path: it stamps the final
    // dab + fires onStrokeEnd → commitPaint.
    if (paintingRef.current) {
      paintingRef.current = false; lastPaintRef.current = null;
      if (surfaceStrokeActiveRef.current) {
        surfaceStrokeActiveRef.current = false; lastPaintScreenRef.current = null;
        paintDirtyRef.current = true; commitPaint();
      } else paintCtl.handlers.onMouseUp(e);
      return;
    }
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
      // resolve. A clean edit commits straight through. Diff vs the START mesh
      // (req_1514): only faces this edit NEWLY buckled count — a rigid object-move
      // of an organic mesh that already holds concave quads must not re-flag them.
      const offenders = newConcaveFaces(g.startMesh, result);
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
    // orbit drag ended — the host accumulated the angle via setInputDeltas, so
    // sendOrbit never fired; save the final camera as twig state (req_1437).
    if (dragRef.current) { dragRef.current = null; persistCam(); return; }
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
      onMouseLeave={(e: any) => { if (paintingRef.current) { paintingRef.current = false; lastPaintRef.current = null; if (surfaceStrokeActiveRef.current) { surfaceStrokeActiveRef.current = false; lastPaintScreenRef.current = null; paintDirtyRef.current = true; commitPaint(); } else paintCtl.handlers.onMouseLeave(e); } }}
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
              key={`${bd.id}~${mountEpoch}`}
              geometry={{ id: `studio.bd.${bd.id}.${mountEpoch}`, generate: () => q.geo, defaults: {} }}
              dynamicKey={`studio.bd${i}~${bd.id}.${mountEpoch}.${bd.plane}.${bd.scale}.${bd.aspect}.${bd.flipU ? 1 : 0}`}
              material={{ color: '#ffffff', opacity: bd.opacity }}
              textureKey={backdropTexKey(`${bd.id}.${mountEpoch}`)}
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
        <BackdropSurface key={`${b.id}~${mountEpoch}`} id={`${b.id}.${mountEpoch}`} source={b.source} aspect={b.aspect} />
      ))}

      {/* PIXEL painter (req_1372): the RGBA paint texture the model samples while in
          paint mode. Brush dabs (paintAt) and base coat (fillAllFaces) write straight
          into this GPU texture — no boxes, no StaticSurface capture. */}
      {tex || havePaintBlob ? <Paintable id={STUDIO_PAINT_KEY} w={PAINT_TEX} h={PAINT_TEX} rgba /> : null}

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
          pseudo={false}
          paintCell={paintCell}
          sig={`${props.meshRev}.${props.revision}.${tex.texels}.${tex.type}.${tex.color}.${tex.imageRev ?? 0}.${paintBakeTick}.${livePalette.variant}.${livePalette.slots.length}`}
        />
      ) : null}

      {/* ── TOOLBAR tier 1 (req_1184): info + view toggles (left) · diagnostics
          (right) on ONE strip, space-between so they never overlap. The tools sit
          on tier 2 below; the old three same-row absolute bars piled on top of each
          other (scale text over the mode buttons, fps over the export row). */}
      <Row style={{ position: 'absolute', left: 8, right: 8, top: 8, alignItems: 'center', justifyContent: 'space-between', zIndex: Z.chrome }}>
        <Row style={{ gap: 8, alignItems: 'center' }}>
          {/* Branch-history verbs + import — first in the bar (they used to be a
              SEPARATE absolute row pinned to the same top:8/left:8 corner as this
              strip, so they sat ON TOP of the STUDIO info; folded in here as one
              bar, req_1430). undo/redo/import handlers come from the model owner. */}
          <Row style={{ gap: 4, alignItems: 'center' }}>
            {([['Undo2', `${keyHint('bench.undo', 'bench')}Undo`, props.canUndo, props.onUndo], ['Redo2', `${keyHint('bench.redo', 'bench')}Redo`, props.canRedo, props.onRedo]] as const).map(([icon, tip, on, run]) => (
              <Pressable key={icon} onPress={on ? run : undefined} tooltip={tip} style={{ paddingLeft: 7, paddingRight: 7, paddingTop: 4, paddingBottom: 4, borderRadius: 5, borderWidth: 1, backgroundColor: on ? '#13233aee' : '#0e1726aa', borderColor: on ? '#2c4a6a' : '#1c2a3c' }}>
                <Icon name={icon} size={13} color={on ? '#cfe2ff' : T.dim} />
              </Pressable>
            ))}
            <Pressable onPress={props.onImportModel} tooltip="Import a 3D model (.glb / .obj — e.g. InstantMesh) — converts it to an editable, paintable Studio model" style={{ paddingLeft: 7, paddingRight: 7, paddingTop: 4, paddingBottom: 4, borderRadius: 5, borderWidth: 1, backgroundColor: '#1a1330ee', borderColor: '#6a4fb0' }}>
              <Icon name="FileUp" size={13} color="#cdbcff" />
            </Pressable>
          </Row>
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
            <Row style={{ gap: 4, alignItems: 'center' }}>
              <Icon name="PersonStanding" size={13} color={showScale ? '#7fd6a0' : T.dim} />
              {showScale ? <Text fontSize={10} color="#7fd6a0" style={{ fontFamily: 'monospace' }}>{`${HMSC_SCALE.playerCapsuleHeightMeters.toFixed(2)} m`}</Text> : null}
            </Row>
          </Pressable>
          {/* BACKDROPS (req_1280): reference images on the walls/floor to trace over. */}
          {(() => { const shown = backdrops.filter((b) => b.visible).length; return (
            <Pressable
              onPress={() => setBackdropPanel(true)}
              tooltip="Reference backdrops — drop a blueprint/photo on a wall or the floor and model straight over it"
              style={{ ...STEP_BTN, backgroundColor: shown ? '#16324a' : '#0b1320dd', borderColor: shown ? '#4a7fb0' : '#27364a' }}
            >
              <Row style={{ gap: 4, alignItems: 'center' }}>
                <Icon name="Image" size={13} color={shown ? '#9fcfff' : T.dim} />
                {shown ? <Text fontSize={10} color="#9fcfff" style={{ fontFamily: 'monospace' }}>{shown}</Text> : null}
              </Row>
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
          <Pressable onPress={() => setLogOn((v) => !v)} tooltip="Log camera angles to the terminal (debug aid for chasing camera jitter)" style={{ ...STEP_BTN, backgroundColor: logOn ? '#1c3a2a' : '#13233aee', borderColor: logOn ? '#2f7a4f' : '#2c4a6a' }}><Icon name="ScrollText" size={12} color={logOn ? '#7fd6a0' : T.dim} /></Pressable>
          <Pressable onPress={() => setDiagOn((v) => !v)} tooltip="Show/hide the FRAMES performance readout (fps · frame ms · skips · gc · present)" style={{ ...STEP_BTN, backgroundColor: diagOn ? '#1c3a2a' : '#13233aee', borderColor: diagOn ? '#2f7a4f' : '#2c4a6a' }}><Icon name="Gauge" size={12} color={diagOn ? '#7fd6a0' : T.dim} /></Pressable>
          <Pressable onPress={() => setHotkeysOpen(true)} tooltip="Hotkeys — view and rebind the keyboard shortcuts yourself" style={STEP_BTN}><Icon name="Keyboard" size={12} color={T.dim} /></Pressable>
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
        <Box style={{ position: 'absolute', right: 12, bottom: 84, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 6, backgroundColor: '#0b0d13ee', borderWidth: 1, borderColor: '#2c4a6a', zIndex: Z.overlay }}>
          <Text fontSize={11} color="#9fe0ff" style={{ fontFamily: 'monospace' }}>{`paintdiag · ${paintDiag}`}</Text>
        </Box>
      ) : null}

      {/* PAINT controls (req_1487): the floating panel IS the universal kit now —
          BrushKit (tools · brush shapes · size/hardness/flow/scatter/angle dials ·
          blend · the colour wheel · the saved palette), plus a Studio strip for the
          model-texture ops the kit doesn't own (materials, whole-face fill, fill-all,
          clear). Scrolls so the full kit fits any viewport height. Paint mode only. */}
      {selMode === 'paint' && tex ? (
        <ScrollView style={{ position: 'absolute', left: 8, top: 72, width: 276, height: Math.max(280, (rectRef.current?.height ?? 700) - 128) }}>
          <Col style={{ gap: 8, paddingRight: 4 }}>
            <BrushKit
              brush={brush}
              onBrushChange={setBrush}
              tool={tool}
              onToolChange={selectTool}
              tools={STUDIO_PAINT_TOOLS}
              palette={kitPalette}
              onPaletteChange={(p) => setPaintRecents(p.recents)}
              theme={PAINT_THEME}
              width={264}
            />
            {/* TEXT tool (req_1600): type a string, then click the model to stamp it.
                Brush SIZE scales the glyphs, brush COLOUR inks them. Only while the
                text tool is active — the rest of the panel is unchanged. */}
            {tool === 'text' ? (
              <Col style={{ gap: 6, padding: 10, backgroundColor: PAINT_THEME.panel, borderWidth: 1, borderColor: PAINT_THEME.frame, borderRadius: 8 }}>
                <Text fontSize={9} color={PAINT_THEME.dim} style={{ fontFamily: 'monospace', letterSpacing: 1 }}>TEXT</Text>
                <TextInput
                  value={textValue}
                  onChangeText={setTextValue}
                  placeholder="type, then click the model"
                  style={{ height: 26, paddingLeft: 8, paddingRight: 8, borderRadius: 5, backgroundColor: PAINT_THEME.control, borderWidth: 1, borderColor: PAINT_THEME.frame, color: PAINT_THEME.ink, fontFamily: 'monospace', fontSize: 12 }}
                />
                {textPlacing ? (
                  <>
                    <Text fontSize={9} color="#9fe0ff" style={{ fontFamily: 'monospace' }}>drag on the model to move · then place it</Text>
                    <Row style={{ gap: 6 }}>
                      <Pressable tooltip="Bake the text into the texture here (one undo lifts the whole text)" onPress={commitTextLayer} style={{ flexGrow: 1, height: 26, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: PAINT_THEME.accent, borderWidth: 1, borderColor: PAINT_THEME.accent }}>
                        <Text fontSize={11} color={PAINT_THEME.page} style={{ fontFamily: 'monospace', fontWeight: '800' }}>place</Text>
                      </Pressable>
                      <Pressable tooltip="Discard the text and restore the surface underneath" onPress={cancelTextLayer} style={{ paddingLeft: 10, paddingRight: 10, height: 26, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: PAINT_THEME.control, borderWidth: 1, borderColor: '#a14545' }}>
                        <Text fontSize={11} color="#f0a0a0" style={{ fontFamily: 'monospace', fontWeight: '800' }}>cancel</Text>
                      </Pressable>
                    </Row>
                  </>
                ) : (
                  <Text fontSize={9} color={PAINT_THEME.dim} style={{ fontFamily: 'monospace' }}>click a face to place · drag to move · size = scale · colour = ink</Text>
                )}
              </Col>
            ) : null}
            {/* Studio model-texture strip */}
            <Col style={{ gap: 8, padding: 10, backgroundColor: PAINT_THEME.panel, borderWidth: 1, borderColor: PAINT_THEME.frame, borderRadius: 8 }}>
              {livePalette.slots.some((s) => s.kind === 'material') ? (
                <Col style={{ gap: 5 }}>
                  <Text fontSize={9} color={PAINT_THEME.dim} style={{ fontFamily: 'monospace', letterSpacing: 1 }}>MATERIALS</Text>
                  <Row style={{ flexWrap: 'wrap', gap: 5 }}>
                    {livePalette.slots.filter((s) => s.kind === 'material').map((s) => (
                      <Pressable key={s.id} tooltip={`${s.name} (paints flat ${s.pseudo})`} onPress={() => setBrush((b) => ({ ...b, ink: { kind: 'color', hex: s.pseudo } }))} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 5, paddingRight: 7, height: 22, borderRadius: 4, backgroundColor: PAINT_THEME.control, borderWidth: 1, borderColor: brushHex().toLowerCase() === s.pseudo.toLowerCase() ? PAINT_THEME.accent : PAINT_THEME.frame }}>
                        <Box style={{ width: 11, height: 11, borderRadius: 3, backgroundColor: s.pseudo }} />
                        <Text fontSize={10} color={PAINT_THEME.dim} style={{ fontFamily: 'monospace' }}>{s.name}</Text>
                      </Pressable>
                    ))}
                  </Row>
                </Col>
              ) : null}
              <Row style={{ flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                <Pressable tooltip="Sample a colour from the painted model under the next click" onPress={() => selectTool('eyedropper')} style={{ paddingLeft: 8, paddingRight: 8, height: 24, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: tool === 'eyedropper' ? PAINT_THEME.accent : PAINT_THEME.control, borderWidth: 1, borderColor: tool === 'eyedropper' ? PAINT_THEME.accent : PAINT_THEME.frame }}>
                  <Text fontSize={10} color={tool === 'eyedropper' ? PAINT_THEME.page : PAINT_THEME.dim} style={{ fontFamily: 'monospace', fontWeight: '800' }}>sample</Text>
                </Pressable>
                <Pressable tooltip="Fill the WHOLE hovered face one colour per click (the 'this face is just one colour' path)" onPress={() => setFaceFill((v) => !v)} style={{ paddingLeft: 8, paddingRight: 8, height: 24, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: faceFill ? PAINT_THEME.accent : PAINT_THEME.control, borderWidth: 1, borderColor: faceFill ? PAINT_THEME.accent : PAINT_THEME.frame }}>
                  <Text fontSize={10} color={faceFill ? PAINT_THEME.page : PAINT_THEME.dim} style={{ fontFamily: 'monospace', fontWeight: '800' }}>face fill</Text>
                </Pressable>
                <Pressable tooltip="Lock the brush to ONE face — paint right up to an edge with no bleed onto the neighbour (off = strokes cross faces smoothly)" onPress={() => setLockFace((v) => !v)} style={{ paddingLeft: 8, paddingRight: 8, height: 24, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: lockFace ? PAINT_THEME.accent : PAINT_THEME.control, borderWidth: 1, borderColor: lockFace ? PAINT_THEME.accent : PAINT_THEME.frame }}>
                  <Text fontSize={10} color={lockFace ? PAINT_THEME.page : PAINT_THEME.dim} style={{ fontFamily: 'monospace', fontWeight: '800' }}>lock face</Text>
                </Pressable>
                <Pressable tooltip="Save the current colour as a palette swatch (grows the model's saved palette)" onPress={() => { const { palette } = paletteWithColor(livePalette, brushHex()); props.onSetPalette(palette); }} style={{ paddingLeft: 8, paddingRight: 8, height: 24, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: PAINT_THEME.control, borderWidth: 1, borderColor: PAINT_THEME.frame }}>
                  <Text fontSize={10} color={PAINT_THEME.dim} style={{ fontFamily: 'monospace', fontWeight: '800' }}>+ save</Text>
                </Pressable>
                <Pressable tooltip="Fill the ENTIRE model with the current colour in one click (base coat)" onPress={() => { paintSnapshotBegin(); fillAllFaces(); if (!texView) setTexView(true); commitPaint(); }} style={{ paddingLeft: 8, paddingRight: 8, height: 24, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: PAINT_THEME.control, borderWidth: 1, borderColor: PAINT_THEME.frame }}>
                  <Text fontSize={10} color={PAINT_THEME.dim} style={{ fontFamily: 'monospace', fontWeight: '800' }}>fill all</Text>
                </Pressable>
                <Pressable tooltip="Load a painting back from a prop you compiled from this (or any) model — the compiled prop is the durable backup of its texture" onPress={() => setLoadPropOpen(true)} style={{ paddingLeft: 8, paddingRight: 8, height: 24, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: PAINT_THEME.control, borderWidth: 1, borderColor: PAINT_THEME.frame }}>
                  <Text fontSize={10} color={PAINT_THEME.dim} style={{ fontFamily: 'monospace', fontWeight: '800' }}>load from prop</Text>
                </Pressable>
                <Pressable tooltip="Clear all paint on this model (back to the base coat)" onPress={() => { paintSnapshotBegin(); baseCoat(tex?.color ?? '#c8ccd2'); props.parts.forEach((p) => { if (p.paint && Object.keys(p.paint).length) props.onEditPaint(p.id, {}); }); paintRef.current = {}; touchedRef.current.clear(); commitPaint(); }} style={{ paddingLeft: 8, paddingRight: 8, height: 24, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: PAINT_THEME.control, borderWidth: 1, borderColor: '#a14545' }}>
                  <Text fontSize={10} color="#f0a0a0" style={{ fontFamily: 'monospace', fontWeight: '800' }}>clear</Text>
                </Pressable>
              </Row>
            </Col>
          </Col>
        </ScrollView>
      ) : null}

      {/* PAINT diagnostics (req_1197): a compact readout — is a texture made + shown,
          and how many cells are painted. Bottom-centre, paint mode only. */}
      {selMode === 'paint' ? (
        <Box style={{ position: 'absolute', left: 0, right: 0, bottom: 92, alignItems: 'center', zIndex: Z.overlay }}>
          <Box style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4, borderRadius: 6, backgroundColor: '#0b1320ee', borderWidth: 1, borderColor: tex ? '#2f7a4f' : '#a14545' }}>
            <Text fontSize={10} color={tex ? '#7fd6a0' : '#f0a0a0'} style={{ fontFamily: 'monospace' }}>
              paint · {tex ? `atlas ${tex.texels}²` : 'NO TEXTURE'} · {texView ? 'textured' : 'solid'} · {Object.values(paintRef.current).reduce((n, m) => n + Object.keys(m).length, 0)} cells
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
        <Box style={{ position: 'absolute', left: 0, right: 0, top: 44, alignItems: 'center', zIndex: Z.overlay }}>
          <Row style={{ gap: 8, alignItems: 'center', paddingLeft: 10, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 6, backgroundColor: '#0b1320ee', borderWidth: 1, borderColor: '#9b7fd6' }}>
            <Text fontSize={10} color="#e0d4ff" style={{ fontFamily: 'monospace' }}>{`moving · ${moveBackdrop.name} · drag the arrows · scroll to orbit`}</Text>
            <Pressable onPress={() => setMoveBackdropId(null)} tooltip="Done positioning (Esc) " style={STEP_BTN}><Text fontSize={10} color="#7fd6a0">done</Text></Pressable>
          </Row>
        </Box>
      ) : null}

      {/* BACKDROP RESET DIAGNOSTIC (req_1541): on-screen so you can WATCH it change.
          Shows the live mountEpoch + each backdrop's host slot / version / texture key
          / pos. Edit a .ts file → if epoch changes, the viewport re-mounted (that's the
          reset). Edit a .tsx file → epoch should hold. REMOVE once root-caused. */}
      {backdrops.length > 0 ? (
        <Box style={{ position: 'absolute', left: 8, bottom: 8, paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: '#1a0b20ee', borderWidth: 1, borderColor: '#9b7fd6', zIndex: Z.floating, pointerEvents: 'none' }}>
          <Text fontSize={10} color="#e0c4ff" style={{ fontFamily: 'monospace', fontWeight: '800' }}>{`bd-diag · epoch=${mountEpoch}`}</Text>
          {backdrops.map((b, i) => (
            <Text key={b.id} fontSize={9} color="#b79fd6" style={{ fontFamily: 'monospace' }}>
              {`slot studio.bd${i} v=${mountEpoch} · tex=studio.backdrop.${b.id}.${mountEpoch} · pos=[${b.pos.map((n) => n.toFixed(2)).join(', ')}]`}
            </Text>
          ))}
        </Box>
      ) : null}

      {/* Live drag readout (req_1024): floats by the gizmo anchor while dragging so
          the step amount can be read off and mirrored on the other side. */}
      {gizmoReadout ? (() => {
        // Anchor to the BACKDROP while moving one (its gizmo is the live handle then,
        // and the model gizmo is hidden) — otherwise the readout floated at the model
        // and sat ON TOP of the backdrop arrows. pointerEvents:'none' so the readout
        // can never eat the drag (the "tooltip blocks the gizmo, can't move" bug, req_1537).
        const anchor = moveBackdrop ? (moveBackdrop.pos as MV3) : lc ? lcGizmoAnchor : selMode === 'rig' ? rigAnchorWorld : gizmoAnchorWorld;
        if (!anchor) return null;
        const p = makeProjector(camSnap())(anchor);
        if (!p.front) return null;
        return (
          <Box style={{ position: 'absolute', left: p.x + 14, top: p.y - 34, paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRadius: 5, backgroundColor: '#0b1320ee', borderWidth: 1, borderColor: '#5b8fd6', zIndex: Z.floating, pointerEvents: 'none' }}>
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
      <Row style={{ position: 'absolute', left: 8, top: 40, gap: 4, rowGap: 4, alignItems: 'center', flexWrap: 'wrap', paddingLeft: 6, paddingRight: 6, paddingTop: 5, paddingBottom: 5, borderRadius: 7, backgroundColor: '#0a111caa', borderWidth: 1, borderColor: '#1c2940', zIndex: Z.chrome }}>
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
            <Pressable key={m} onPress={() => { if (disabled) return; if (m === 'paint') ensureTexture(); setSelMode(m); }} tooltip={`${keyHint(`mode.${m}`)}${modeTip[m]}`} style={{ ...STEP_BTN, opacity: disabled ? 0.4 : 1, backgroundColor: on ? '#2a3f5e' : '#13233aee', borderColor: on ? '#5b8fd6' : '#2c4a6a' }}>
              <Text fontSize={10} color={on ? '#cfe2ff' : T.dim} style={{ fontFamily: 'monospace' }}>{m}{on && n > 0 ? ` ·${n}` : ''}</Text>
            </Pressable>
          );
        })}
        {/* PAINT controls moved OUT of this toolbar into the floating PaintPanel
            (req_1297 — the bar was overcrowded); only the mode tabs stay here. */}
      </Row>

      {/* ── CONTEXT RAIL (req_1427): the per-mode + per-selection edit ops, docked
          as a vertical rail on the LEFT instead of wrapping the top bar DOWN into
          the 3D scene (the original cram the user called out). Every cluster here is
          selection-gated, so the rail is empty — and invisible — until a part or a
          selection makes its ops relevant. */}
      <Row style={{ position: 'absolute', left: 8, top: 72, width: 168, gap: 4, rowGap: 4, flexWrap: 'wrap', alignItems: 'flex-start', alignContent: 'flex-start', zIndex: Z.chrome }}>
        {/* CENTER (req_1538): drop the part onto the origin so the mirror plane bisects
            it — do this BEFORE symmetrize / mirror-edit / mirror-paint. Shown in every
            mode (it's the prerequisite for all the symmetric tools, paint included). */}
        {activePart ? (
          <Pressable onPress={opCenter} tooltip="Center on origin — slide the part so its bounds center sits at (0,0,0), so the X/Y/Z mirror plane bisects it. Do this before mirror editing or mirror painting." style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#3a6a9a' }}>
            <Row style={{ gap: 4, alignItems: 'center' }}>
              <Icon name="Crosshair" size={12} color="#9fcfff" />
              <Text fontSize={10} color="#9fcfff" style={{ fontFamily: 'monospace' }}>center</Text>
            </Row>
          </Pressable>
        ) : null}
        {/* SYMMETRIZE (req_1190/1201): a WHOLE-MESH op, so shown in EVERY mode (it
            used to be nested in the non-rig tool block → invisible in rig mode, where
            the user went looking for it). Pick the GOOD half → it rebuilds the other
            as an exact mirror; the badge shows live ✓ / ⚠ for the symmetry axis. */}
        {activePart && symReport && selMode !== 'paint' ? (() => {
          const symAxis = symReport.axis; // explicit mirror plane, else the auto-detected most-symmetric axis
          const ax = STUDIO.mirrorAxisLabels[symAxis];
          const col = STUDIO.mirrorAxisColors[symAxis];
          // shares opSymmetrize with the hotkey (rule of two)
          return (
            <>
              <Box style={{ height: 1, width: '100%', backgroundColor: '#2c4a6a', marginTop: 3, marginBottom: 3 }} />
              <Text fontSize={9} color={T.dim} style={{ width: '100%', fontFamily: 'monospace' }}>symmetrize</Text>
              <Pressable onPress={() => opSymmetrize(true)} tooltip={`${keyHint('op.symmetrize')}Symmetrize — keep the +${ax} half and rebuild the other side as its exact mirror (kills any drift)`} style={{ ...STEP_BTN, backgroundColor: '#241c3a', borderColor: col }}>
                <Text fontSize={10} color={col} style={{ fontFamily: 'monospace' }}>keep +{ax}</Text>
              </Pressable>
              <Pressable onPress={() => opSymmetrize(false)} tooltip={`Symmetrize — keep the −${ax} half and rebuild the other side as its exact mirror (kills any drift)`} style={{ ...STEP_BTN, backgroundColor: '#241c3a', borderColor: col }}>
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
        {activePart && health && selMode !== 'paint' ? (() => {
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
              <Box style={{ height: 1, width: '100%', backgroundColor: '#2c4a6a', marginTop: 3, marginBottom: 3 }} />
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
            <Box style={{ height: 1, width: '100%', backgroundColor: '#2c4a6a', marginTop: 3, marginBottom: 3 }} />
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
            <Box style={{ height: 1, width: '100%', backgroundColor: '#2c4a6a', marginTop: 3, marginBottom: 3 }} />
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
            <Box style={{ height: 1, width: '100%', backgroundColor: '#2c4a6a', marginTop: 3, marginBottom: 3 }} />
            <Row style={{ gap: 4, width: '100%' }}>
              {(['move', 'resize', 'rotate'] as GizmoTool[]).map((tl) => {
                const on = gizmoTool === tl;
                return (
                  <Pressable key={tl} onPress={() => setGizmoTool(tl)} tooltip={`${keyHint(`tool.${tl}`)}${tl === 'move' ? 'Move tool — drag the arrows to slide the selection (in face mode an orange arrow extrudes along the normal)' : tl === 'resize' ? 'Resize tool — drag the square handles to scale the selection per-axis' : 'Rotate tool — drag the rings to spin the selection about an axis'}`} style={{ ...STEP_BTN, flexGrow: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? '#3a2f5e' : '#13233aee', borderColor: on ? '#9b7fd6' : '#2c4a6a' }}>
                    <Icon name={tl === 'move' ? 'Move' : tl === 'resize' ? 'Maximize' : 'RotateCw'} size={13} color={on ? '#e0d4ff' : T.dim} />
                  </Pressable>
                );
              })}
            </Row>
            {/* ALL-PARTS toggle (req_1287): in object mode with 2+ parts, transform the
                WHOLE model together about its common center (so resizing keeps the
                assembly's proportions instead of scaling one layer about its own hub). */}
            {selMode === 'object' && props.partCount >= 2 ? (
              <Pressable
                onPress={() => setAllParts((v) => !v)}
                tooltip="All parts — move/resize/rotate EVERY layer together about the model's shared center, so the whole thing scales as one and proportions hold"
                style={{ ...STEP_BTN, backgroundColor: allParts ? '#1c3a2a' : '#13233aee', borderColor: allParts ? '#2f7a4f' : '#2c4a6a' }}
              >
                <Text fontSize={10} color={allParts ? '#7fd6a0' : T.dim} style={{ fontFamily: 'monospace' }}>{allParts ? `▣ all · ${props.partCount}` : '▢ all parts'}</Text>
              </Pressable>
            ) : null}
            {/* face-only edit ops: extrude + loop cut (a single selected face). */}
            {selMode === 'face' && activePart && sel.faces.size === 1 ? (
              <>
                <Box style={{ height: 1, width: '100%', backgroundColor: '#2c4a6a', marginTop: 3, marginBottom: 3 }} />
                {/* extrude — commits a thin lip; the move gizmo then pulls it in/out
                    (req_1015). The cap stays at the same index so it stays selected. */}
                <Pressable
                  onPress={opExtrude}
                  tooltip={`${keyHint('op.extrude')}Extrude — pull a new lip out of the selected face; then drag the orange normal arrow to set depth (push IN to inset/cut a recess)`}
                  style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#2c4a6a' }}
                >
                  <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>extrude</Text>
                </Pressable>
                {/* loop cut — a face click + this opens the cut popup (req_0984/0985) */}
                <Pressable
                  onPress={opLoopCut}
                  tooltip={`${keyHint('op.loop-cut')}Loop cut — slice parallel rings around the part to add edge loops (opens a popup for count + offset)`}
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
                  <Box style={{ height: 1, width: '100%', backgroundColor: '#2c4a6a', marginTop: 3, marginBottom: 3 }} />
                  {/* flip — reverse the selected face(s) so the normal points the other
                      way (fixes an upside-down Create Face). */}
                  <Pressable
                    onPress={opFlip}
                    tooltip={`${keyHint('op.flip')}Flip — reverse the selected face(s) so the normal points the other way (un-inverts an upside-down Create Face)`}
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
                    onPress={opGlass}
                    tooltip={`${keyHint('op.glass')}Glass — toggle the face(s) as a translucent window pane (renders see-through, skips texturing). For windshields/windows`}
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
                    onPress={opDetach}
                    tooltip={`${keyHint('op.detach')}Detach — peel the selected faces off the body into their own thin panel part (hood / door / trunk), pivot seated, ready to hinge`}
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
                    onPress={opSolidify}
                    tooltip={`${keyHint('op.solidify')}Solidify — give the selected faces thickness IN PLACE (inner skin + walled rim). Wraps a hollow box shell into solid walls; open holes (doors/windows) stay open with a thickness frame`}
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
            {/* TEXTURE SLOTS (req_1542): declare the selected face(s) as a named
                re-skinnable surface. The slot rides the cook, so the iso build
                editor exposes it as a texture target (skin it with any shader/image)
                — the per-face texture placement now reaches mesh-editor props, not
                just paint mode. Shown in face mode whenever there's a selection to
                slot OR slots to manage; "pick" reselects a slot's faces to see it. */}
            {selMode === 'face' && activePart && ((activePart.mesh.slots?.length ?? 0) > 0 || sel.faces.size > 0) ? (() => {
              const slots = activePart.mesh.slots ?? [];
              const faceList = [...sel.faces];
              const selSlot = faceList.length ? slotOfFace(activePart.mesh, faceList[0]) : null;
              return (
                <>
                  <Box style={{ height: 1, width: '100%', backgroundColor: '#2c4a6a', marginTop: 3, marginBottom: 3 }} />
                  <Text fontSize={9} color={T.dim} style={{ width: '100%', fontFamily: 'monospace' }}>texture slots</Text>
                  {/* new slot from the current face selection */}
                  <Pressable
                    onPress={newSlotFromSelection}
                    tooltip="Declare the selected face(s) as a new texture slot — a re-skinnable surface the cook carries, so the iso build editor can drop any texture/shader on it"
                    style={{ ...STEP_BTN, opacity: faceList.length ? 1 : 0.45, backgroundColor: '#1a2740', borderColor: '#3a6a9a' }}
                  >
                    <Text fontSize={10} color="#9fcfff" style={{ fontFamily: 'monospace' }}>+ slot from selection</Text>
                  </Pressable>
                  {slots.map((s) => {
                    const count = facesInSlot(activePart.mesh, s.id).length;
                    const isSel = selSlot === s.id && faceList.length > 0;
                    return (
                      <Row key={s.id} style={{ width: '100%', gap: 3, alignItems: 'center' }}>
                        <TextInput
                          text={slotDrafts[s.id] ?? s.label}
                          onChangeText={(v: string) => setSlotDrafts((d) => ({ ...d, [s.id]: v }))}
                          onSubmitEditing={() => { props.onEditMesh(activePart.id, renameSlot(activePart.mesh, s.id, slotDrafts[s.id] ?? s.label)); setSlotDrafts((d) => { const n = { ...d }; delete n[s.id]; return n; }); }}
                          style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, backgroundColor: '#0f1a2e', borderWidth: 1, borderColor: isSel ? '#7dd3fc' : '#2c4a6a', borderRadius: 3, paddingLeft: 5, paddingRight: 4, paddingTop: 2, paddingBottom: 2, color: '#e2e8f0', fontSize: 9, fontFamily: 'monospace' }}
                        />
                        <Text fontSize={8} color={T.dim} style={{ fontFamily: 'monospace' }}>{`${count}f`}</Text>
                        {/* pick — reselect this slot's faces so you SEE what it covers */}
                        <Pressable onPress={() => setSel({ verts: new Set(), edges: new Set(), faces: new Set(facesInSlot(activePart.mesh, s.id)) })} tooltip={`Select the ${count} face(s) in "${s.label}"`} style={{ ...STEP_BTN, paddingLeft: 5, paddingRight: 5 }}>
                          <Icon name="MousePointerClick" size={11} color={T.dim} />
                        </Pressable>
                        {/* add — assign the current selection to this slot */}
                        <Pressable onPress={() => { if (faceList.length) props.onEditMesh(activePart.id, assignFacesToSlot(activePart.mesh, sel.faces, s.id)); }} tooltip="Add the selected face(s) to this slot" style={{ ...STEP_BTN, opacity: faceList.length ? 1 : 0.45, paddingLeft: 5, paddingRight: 5 }}>
                          <Text fontSize={10} color="#7fd6a0" style={{ fontFamily: 'monospace' }}>+</Text>
                        </Pressable>
                        {/* delete the slot (faces lose membership, later slots re-key) */}
                        <Pressable onPress={() => props.onEditMesh(activePart.id, removeSlot(activePart.mesh, s.id))} tooltip={`Delete the "${s.label}" slot (its faces become unslotted)`} style={{ ...STEP_BTN, paddingLeft: 5, paddingRight: 5, borderColor: '#a14545' }}>
                          <Text fontSize={10} color="#f0a0a0" style={{ fontFamily: 'monospace' }}>×</Text>
                        </Pressable>
                      </Row>
                    );
                  })}
                  {/* clear — drop the selection's slot membership without deleting a slot */}
                  {selSlot ? (
                    <Pressable onPress={() => props.onEditMesh(activePart.id, clearFaceSlot(activePart.mesh, sel.faces))} tooltip="Remove the selected face(s) from their slot (back to unslotted)" style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#2c4a6a' }}>
                      <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>unslot selection</Text>
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
                <Box style={{ height: 1, width: '100%', backgroundColor: '#2c4a6a', marginTop: 3, marginBottom: 3 }} />
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
      </Row>

      {/* ── FILE / TEXTURE OPS (req_1427): scene-level actions (textureize, compile,
          export / import / AI fill) — pinned top-RIGHT, content-sized, so they never
          collide with the mode tabs on the left and don't balloon the bar. */}
      <Row style={{ position: 'absolute', right: 8, top: 40, gap: 4, rowGap: 4, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', zIndex: Z.chrome }}>
        {/* TEXTURE (req_1068): the GLOBAL "textureize" — takes the whole scene and
            builds one packed sprite-map atlas via the Create Texture dialog (the
            Blockbench flow). The toggle flips between the textured atlas and solid
            once a texture exists. Painting the islands is the deferred next step. */}
        {props.parts.length > 0 ? (
          <>
            <Pressable
              onPress={() => setTexDialog(true)}
              tooltip="Textureize — unwrap the whole model into one packed sprite-sheet atlas you can paint / export / AI-fill"
              style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#2c6a4a' }}
            >
              <Icon name="Grid2x2" size={13} color="#7fd6a0" />
            </Pressable>
            {/* COMPILE (req_1122, Part 7): cook this model into a typed, installed
                game asset (prop first). Choose the kind → fill its descriptor →
                validate → cook → it lands in the kind's catalog. */}
            <Pressable
              onPress={() => setCompileOpen(true)}
              tooltip="Compile — cook this model into a typed, installed game asset (prop/vehicle): pick the kind, fill its descriptor, it lands in the catalog"
              style={{ ...STEP_BTN, backgroundColor: '#16132aee', borderColor: '#8a6f3a' }}
            >
              <Icon name="Package" size={13} color="#e9c77f" />
            </Pressable>
            {tex ? (
              <>
                <Pressable
                  onPress={() => setTexView((v) => !v)}
                  tooltip="Toggle the textured atlas vs solid part colours in the viewport"
                  style={{ ...STEP_BTN, backgroundColor: texView ? '#1c3a2a' : '#13233aee', borderColor: texView ? '#2f7a4f' : '#2c4a6a' }}
                >
                  <Icon name="Eye" size={13} color={texView ? '#7fd6a0' : T.dim} />
                </Pressable>
                {/* export PNG (req_1072): the whole sprite sheet, or ONE slice (the
                    selected face's island) — to cart/hmsc-int/exports/<name>.png. */}
                <Pressable onPress={() => exportSprite()} tooltip="Export the whole texture atlas as a PNG (to cart/hmsc-int/exports/) to edit externally" style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#2c4a6a' }}>
                  <Icon name="ImageDown" size={13} color={T.dim} />
                </Pressable>
                {/* re-upload PNG (req_1079): the edited/AI-generated sheet slips back
                    onto the model (cookie-cutter via the UVs), or one face's slice. */}
                <Pressable onPress={() => setImportTex({})} tooltip="Import an edited/AI PNG back onto the model — re-applied through the UVs (cookie-cutter)" style={{ ...STEP_BTN, backgroundColor: '#13233aee', borderColor: '#3a2c6a' }}>
                  <Icon name="ImageUp" size={13} color="#b9a8e9" />
                </Pressable>
                {/* AI fill (req_1070/1110): generate the whole sheet via image-to-image
                    (the current atlas is the reference) — no leaving the app. */}
                <Pressable onPress={() => setAiTex({})} tooltip="AI fill — generate the whole texture sheet via image-to-image (current atlas as reference), without leaving the app" style={{ ...STEP_BTN, backgroundColor: '#1a1330ee', borderColor: '#6a4fb0' }}>
                  <Icon name="Sparkles" size={13} color="#cdbcff" />
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
        <Box style={{ position: 'absolute', left: 0, right: 0, bottom: 54, alignItems: 'center', zIndex: Z.overlay }}>
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
          <Box style={{ position: 'absolute', left: 14, bottom: 100, paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: '#0b1320ee', borderWidth: 1, borderColor: '#2c4a6a', zIndex: Z.overlay }}>
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

      {/* Discoverable keymap — renders straight from the 'studio' control table
          (editors/controls.ts), so it can never drift from what the keys do. */}
      <Box style={{ position: 'absolute', left: 0, right: 0, bottom: 8, alignItems: 'center', zIndex: Z.overlay }}>
        <KeyLegend scope="studio" dimmed />
      </Box>

      {/* The selected joint's METADATA (name/type/axis/limit) is edited in workspace
          column 3 (RigMetaPanel, req_1053) — the viewport just places it. */}

      {/* Camera framing controls (fov + reframe) — kept bottom-right. */}
      <Col style={{ position: 'absolute', right: 12, bottom: 12, gap: 6, alignItems: 'flex-end', zIndex: Z.chrome }}>
        <Row style={{ gap: 4, alignItems: 'center' }}>
          <Pressable onPress={() => setFov(fovRef.current - 2)} tooltip="Narrower field of view (zoom in / less perspective)" style={STEP_BTN}><Text fontSize={13} color={T.text}>−</Text></Pressable>
          <Box style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5, borderRadius: 5, backgroundColor: '#0b1320dd', borderWidth: 1, borderColor: '#27364a' }}>
            <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>fov {Math.round(fovRef.current)}</Text>
          </Box>
          <Pressable onPress={() => setFov(fovRef.current + 2)} tooltip="Wider field of view (zoom out / more perspective)" style={STEP_BTN}><Text fontSize={13} color={T.text}>+</Text></Pressable>
        </Row>
        <Pressable onPress={reframe} tooltip={`${keyHint('view.recenter')}Reframe — recenter the camera on the model`} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 5, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' }}>
          <Icon name="Frame" size={13} color={T.text} />
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
            // Carry the model's painted texture into the cooked asset (req_1496): the
            // paint atlas (1024² PNG) is content-addressed by props.paintRef, and the
            // baked mesh keeps its per-face UVs into that atlas — so texRef + the blob
            // are exactly the texture factor the render/bake sample. Unpainted → no tex.
            const texB64 = props.paintRef ? props.paintBlob(props.paintRef) : null;
            const texRef = texB64 ? props.paintRef ?? undefined : undefined;
            const result = cookProp({ id: `studio.${base}`, name: props.sceneName || 'Asset', parts: props.parts, descriptor, texRef });
            if (result.errors.length > 0) { toast(`can't compile: ${result.errors[0]}`); return; }
            cooked.install(result, texB64 ?? undefined);
            const d = result.asset.descriptor;
            const nature = d.dynamics ? `kickable r${d.dynamics.bodyRadiusMeters.toFixed(2)} b${d.dynamics.restitution.toFixed(2)}` : (d.solid ? 'static' : 'foliage');
            toast(`compiled ${result.asset.name} → prop · ${nature}  ${d.footprintWidthMeters.toFixed(1)}×${d.footprintDepthMeters.toFixed(1)}×${d.heightMeters.toFixed(1)}m`);
            setCompileOpen(false);
          }}
        />
      ) : null}

      {/* Load-from-prop picker (req_1667/1668): pull a compiled prop's painted texture
          back onto the open model. The compiled prop is the durable backup of a
          painting (the cooked store never GCs texture blobs), so a painting is never a
          one-shot — open the model, load its prop's texture, keep painting. */}
      {loadPropOpen ? (() => {
        const textured = cooked.all.filter((a) => !!a.texRef);
        return (
          <Box style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000a', zIndex: Z.modal }}>
            <Col style={{ width: 420, maxHeight: 420, backgroundColor: PAINT_THEME.panel, borderWidth: 1, borderColor: PAINT_THEME.frame, borderRadius: 8, padding: 14, gap: 10 }}>
              <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Text fontSize={13} color={PAINT_THEME.ink} style={{ fontWeight: '800' }}>Load painting from a compiled prop</Text>
                <Pressable onPress={() => setLoadPropOpen(false)} tooltip="Close"><Icon name="X" size={15} color={PAINT_THEME.dim} /></Pressable>
              </Row>
              <Text fontSize={10} color={PAINT_THEME.dim}>Pulls the prop's texture onto "{props.sceneName ?? 'this model'}" so you can keep editing. Works best on the model the prop was compiled from (its faces match the texture).</Text>
              {textured.length === 0 ? (
                <Text fontSize={11} color={PAINT_THEME.dim} style={{ paddingTop: 8, paddingBottom: 8 }}>No compiled props carry a painted texture yet. Paint a model, then Compile it to a prop — that prop becomes the painting's durable backup.</Text>
              ) : (
                <ScrollView style={{ maxHeight: 300 }}>
                  <Col style={{ gap: 5 }}>
                    {textured.map((a) => (
                      <Pressable key={a.id} onPress={() => loadPaintFromAsset(a)} tooltip={`Load "${a.name}" texture onto this model`} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 7, paddingBottom: 7, borderRadius: 6, backgroundColor: PAINT_THEME.control, borderWidth: 1, borderColor: PAINT_THEME.frame }}>
                        <Row style={{ alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <Text fontSize={11} color={PAINT_THEME.ink} style={{ fontWeight: '700' }}>{a.name}</Text>
                          <Text fontSize={9} color={PAINT_THEME.dim} style={{ fontFamily: 'monospace' }}>{a.kind} · {a.texRef?.slice(0, 8)}</Text>
                        </Row>
                      </Pressable>
                    ))}
                  </Col>
                </ScrollView>
              )}
            </Col>
          </Box>
        );
      })() : null}

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

      {/* Self-serve rebind panel (req_1433): view + change the Studio shortcuts. */}
      {hotkeysOpen ? <HotkeysPanel scope={selMode === 'paint' ? ['studio', 'studio-paint'] : 'studio'} onClose={() => setHotkeysOpen(false)} /> : null}
    </Pressable>
  );
}

// ── The editor: outliner (the layers component) docked beside the viewport ─────

export function StudioEditor() {
  const model: StudioModel = useStudioModel();
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importPartOpen, setImportPartOpen] = useState(false); // cross-model part picker (req_1583)
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
      <StudioViewport parts={model.visibleParts} allParts={model.parts} revision={model.revision} meshRev={model.meshRev} activeName={model.activePart?.name ?? null} sceneName={model.modelName} partCount={model.parts.length} activePart={model.activePart} onEditMesh={model.updatePartMesh} onAddPart={model.addPart} onMergeActive={model.mergeActive} mergeTargetName={model.mergeTargetName} onSelectFaces={model.setSelectedFaces} palette={model.palette} onEditPaint={model.editPaint} onSetPalette={model.setPalette} sceneId={model.openModelId} paintRef={model.paintRef} paintBlob={model.paintBlob} onBakePaint={model.bakePaint} canUndo={model.canUndo} onUndo={() => model.undo()} canRedo={model.canRedo} onRedo={() => model.redo()} onImportModel={() => setImportOpen(true)} />
      {/* Branch-history verbs + import now live INSIDE the viewport's top bar
          (req_1430) — they used to be a separate absolute row colliding with the
          STUDIO info strip at the same corner. */}
      {/* the OUTLINER (layers) docks on the RIGHT of the viewport (req_0981). */}
      <Box style={{ width: 236, minWidth: 236, height: '100%', borderLeftWidth: 1, borderColor: '#1c2a3c', backgroundColor: T.page }}>
        <StudioOutliner model={model} height="100%" onAdd={() => setAddOpen(true)} onImport={() => setImportPartOpen(true)} />
      </Box>
      {addOpen ? (
        <AddShapeDialog
          onCancel={() => setAddOpen(false)}
          onConfirm={(mesh, name) => { model.addPart(mesh, name); setAddOpen(false); }}
        />
      ) : null}
      {importOpen ? (
        <ImportModelDialog
          defaultPath={'cart/hmsc-int/data/generated/model.glb'}
          onCancel={() => setImportOpen(false)}
          onConfirm={(mesh, name) => { model.newModel(); model.addPart(mesh, name); setImportOpen(false); }}
        />
      ) : null}
      {importPartOpen ? (
        <ImportPartDialog
          onClose={() => setImportPartOpen(false)}
          onImport={(mesh, name, lift) => model.addPart(mesh, name, lift)}
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
