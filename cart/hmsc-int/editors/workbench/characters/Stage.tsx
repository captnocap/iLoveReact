// editors/workbench/characters/Stage.tsx — the MESH context's column 4
// (WBCHAR-0606; parity rows C2-C3, D1-D8, E1, G3, I1-I10, J1-J2, K1, B7).
//
// CharactersRoute.tsx's render+input half, re-hung on the store. LAW 1 holds:
// everything in here DEMONSTRATES or direct-manipulates (grab-sculpt, depth
// strokes, outline lathe — workspace input owned by the surface); every
// PARAMETER edit lives in gutter 3. The viewport chips (grid/mirror/fly/
// hitboxes/undo/redo) are workspace controls, the route's own convention.
//
// CLOTHSPLIT-0606 phase 2 (USER RULING req_0040): this stage shows MESH
// THINGS ONLY — the figure renders UNDRESSED (buildMeshFrame; no garments,
// no held prop) and NO animation clock ever ticks here (the face pins
// 'still'). Dressing lives in the CLOTHING context, posing/animating in the
// ANIMATION context (both DressedStage.tsx); the relocation ledger is
// ../WBCLOTH.CAPTURE.md.
//
// Lenses:
//   FIGURE — the assembled rig, grab-sculpt live (grabbing a part selects it)
//   PART   — the selected part alone, grab-sculpt live
//   SCULPT — the unwrap depth canvas / outline lathe + the 3D part beside it
//   PAINT  — the shared painter on the selected part (PaintLens.tsx)
//
// GPU truth: per-part Paintables ride 'wbchr-*' ids (workbench-scoped — the
// /characters route keeps its 'chr-*' set; blast-radius isolation, the same
// instinct as the K5 ruling). Grids upload on installRev; strokes read back
// on release into store.setPartGrid — the ONE truth the panel also edits.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRerender } from '@reactjit/runtime/hooks';
import { Box, Col, Effect, Paintable, Pressable, Row, Scene3D, ScrollView, Text } from '@reactjit/runtime/primitives';
import { usePaintable, type PaintableHandle } from '@reactjit/runtime/hooks/usePaintable';
import { useFileDrop } from '@reactjit/runtime/hooks/useFileDrop';
import { type Solved } from '../../../game/camera';
import { GAME_CHROME } from '../../../game/chrome';
import { buildMeshFrame } from '../../../game/figure/rig';
import { PART_IDS, PROFILE_N, type PartId } from '../../../game/figure/shapes';
import { PAINT } from '../../paint';
import * as Geometry from '@reactjit/geometries';
import {
  DEPTH_OVERLAY_WGSL, GREATER_POINTS, PAINT_EDITOR_TUNING, SCULPT_CANVAS, bytesFromGrid, depthOverlayData, gridFromBytes,
  gridNodeAt, gridNodeFromSurfaceHit, reliefBytesFromGrid, sculptDabSnap, sculptEngineBrushPx, sculptModeValue, withNodeValue,
  type GridNode,
} from '../../characters/paintKit';
import { useRouteTwigState } from '../../twigs';
import {
  GrabGridCapture, GrabGridMeshes, GrabMarker, PartMeshes, UnwrapContent,
  type GrabMarkerInfo, type PreviewView,
} from '../../characters/preview';
import { FigureCaptures, useFigureRender } from './figureFrame';
import {
  GRAB_TUNING, applyGrabStamp, buildGrabClouds, grabDragAxis, grabInstancesFor, grabPointWorld, gridDeltaFor,
  pickGrab, screenAxisFor, stampRadiusUv, stampWorldRadius,
  type GrabCloud, type GrabHit, type GrabInstance, type ScreenAxis,
} from '../../characters/grabKit';
import { useSculptCamera } from '../../sculptCamera';
// SCULPTKIT-0606: the painter rail's OWN pieces — one tile, one slider, one
// label/divider language; a second implementation is a rejection (§8)
import { IconTile, LinearRailSlider, RailDivider, SectionLabel } from '../../cutout/ToolRail';
// MESHSMOOTH-0606: the relax verb + the matrix data door (Route.tsx parity)
import { SMOOTH_TUNING, gridRoughness, relaxGrid, relaxStamp } from '../../characters/smoothKit';
import { fileToGrid, gridToFile, listGridSamples, readGridSample, saveGridSample, type GridSampleEntry } from '../../characters/gridData';
import type { CharacterStore, CharacterLens } from './store';
import { CharacterPaintLens } from './PaintLens';

const { Chip, Knob, LabEnvironment } = GAME_CHROME;
const T = GAME_CHROME.tokens.color;
const TUNE = PAINT_EDITOR_TUNING;
const EDITOR_W = TUNE.editor.width;
const EDITOR_H = TUNE.editor.height;
const PAINT_W = TUNE.paint.width;
const PAINT_H = TUNE.paint.height;
const GRID_W = TUNE.grid.width;
const GRID_H = TUNE.grid.height;
const NEUTRAL = TUNE.neutral;
// SCULPTSPLIT-0606 v2 (USER RULING): VERTICAL STACK — "put the mesh up top
// and then a row of the two other tools below it. this side by side column
// approach is ass." The divider drags the top/bottom split; minima keep the
// mesh a real view and the tool row usable at any window size.
// SCULPTKIT-0606: the tool column is the painter RAIL's width — one chrome.
const SCULPT_SPLIT = { default: 0.55, min: 0.3, max: 0.75, meshMinPx: 220, rowMinPx: 240, toolColPx: 200 };
// the mesh context's face moment: always still (stable identity — never
// re-triggers the derivation's memos)
const STILL_FACE = { anim: null, phase: 0 } as const;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function setLatch(key: string, value: number): void {
  const fn = (globalThis as any).__latchSet;
  if (typeof fn === 'function') fn(key, value);
}

export function CharacterStage(props: { store: CharacterStore; lens: CharacterLens }) {
  const s = props.store;
  const lens = props.lens;
  // re-render on every store tick (draft edits, view changes, status)
  const rerender = useRerender();
  useEffect(() => s.subscribe(rerender), [s]);

  const draft = s.draft;
  const v = s.view;
  const selPart = v.selPart;
  const isHead = selPart === 'head';
  // the 3D side's view: FIGURE lens shows the rig; PART + SCULPT show the part
  const view: PreviewView = lens === 'figure' ? 'figure' : 'part';

  const paintingRef = useRef(false);
  const strokeEngineRef = useRef<ReturnType<typeof PAINT.createStrokeEngine> | null>(null);
  // MESHSMOOTH-0606: the smooth brush's working stroke (Route.tsx parity)
  const smoothStrokeRef = useRef<null | { base: number[]; work: number[]; lastSync: number }>(null);
  const [samples, setSamples] = useState<GridSampleEntry[]>(() => {
    try { return listGridSamples(); } catch { return []; }
  });
  const profileDraftRef = useRef<number[] | null>(null);
  const canvasRect = useRef({ x: 0, y: 0, width: EDITOR_W, height: EDITOR_H });
  // DEADSPACE-0606 (Law 3): the unwrap canvas EARNS THE COLUMN — it aspect-
  // fits the measured space instead of a fixed 768×384 island over a void.
  // All stroke/lathe math is rect-normalized already; only the profile
  // latches need the live width (canvasFitRef).
  const [canvasBox, setCanvasBox] = useState({ w: EDITOR_W, h: EDITOR_H });
  const canvasFit = (() => {
    const aspect = EDITOR_W / EDITOR_H;
    let w = canvasBox.w;
    let h = w / aspect;
    if (h > canvasBox.h) { h = canvasBox.h; w = h * aspect; }
    return { w: Math.max(192, Math.floor(w)), h: Math.max(96, Math.floor(h)) };
  })();
  const canvasFitRef = useRef(canvasFit);
  canvasFitRef.current = canvasFit;
  // SCULPTSPLIT-0606 v2: the mesh⇄tools split is YOURS to set — a drag
  // divider (the Inspector's resizable-panel pattern), the TOP fraction
  // twigged as view state on the character route's keys.
  const [sculptSplit, setSculptSplit] = useRouteTwigState<number>('/characters', 'sculptSplitY', SCULPT_SPLIT.default);
  const [splitDragging, setSplitDragging] = useState(false);
  const stageRect = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const resizeSplit = (screenY: number) => {
    const r = stageRect.current;
    if (r.height <= 0) return;
    setSculptSplit(clamp((screenY - r.y) / r.height, SCULPT_SPLIT.min, SCULPT_SPLIT.max));
  };
  // GRIDNODES-0606: every grid point is a clickable NODE — the 'nodes' chip
  // routes canvas clicks to selection (twigged: a mode survives the reload),
  // the selected node fine-tunes through ONE slider riding the grid truth
  const [nodesMode, setNodesMode] = useRouteTwigState<boolean>('/characters', 'nodesMode', false);
  const [selNode, setSelNode] = useRouteTwigState<GridNode | null>('/characters', 'selectedNode', null);
  const nodeGestureRef = useRef(false); // one undo entry per node-edit gesture
  const prevSelPartRef = useRef(selPart);
  useEffect(() => {
    if (prevSelPartRef.current === selPart) return;
    prevSelPartRef.current = selPart;
    setSelNode(null);
    nodeGestureRef.current = false;
  }, [selPart, setSelNode]);
  // the brush footprint (Q3) + the display-mode trigger: chunky while the
  // brush is OVER THE CANVAS or mid-stroke; smooth the moment the cursor
  // leaves it — WITHOUT leaving the page (USER: "this never resolves to
  // smooth at all until i leave the interface"). Moves landing anywhere
  // else (the 3D pane, the stage) clear the hover; a short settle timer
  // backstops surfaces that emit no events at all.
  const [brushHover, setBrushHover] = useState<{ u: number; v: number } | null>(null);
  const brushHoverFade = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SETTLE_MS = 450;
  const canvasHoverMove = (sx: number, sy: number) => {
    const r = canvasRect.current;
    if (r.width <= 0 || r.height <= 0) return;
    if (sx < r.x || sx > r.x + r.width || sy < r.y || sy > r.y + r.height) {
      setBrushHover((cur) => (cur === null ? cur : null));
      return;
    }
    const u = clamp((sx - r.x) / r.width, 0, 1);
    const v2 = clamp((sy - r.y) / r.height, 0, 1);
    setBrushHover((cur) => (cur && Math.abs(cur.u - u) < 0.002 && Math.abs(cur.v - v2) < 0.004 ? cur : { u, v: v2 }));
    if (brushHoverFade.current) clearTimeout(brushHoverFade.current);
    brushHoverFade.current = setTimeout(() => setBrushHover((cur) => (paintingRef.current ? cur : null)), SETTLE_MS);
  };
  const clearBrushHover = () => setBrushHover((cur) => (cur === null ? cur : null));
  const viewRect = useRef({ x: 0, y: 0, width: 1, height: 1 });
  const [grabHover, setGrabHover] = useState<
    { part: PartId; instanceIndex: number; gx: number; gy: number; cu: number; cv: number; grabRadius: number; state: 'hover' | 'raise' | 'carve' | 'smooth' } | null
  >(null);
  const grabCloudsRef = useRef<{ sig: unknown[]; clouds: GrabCloud[]; instances: GrabInstance[] } | null>(null);
  const grabRef = useRef<null | {
    hit: GrabHit; baseGrid: number[]; axis: ScreenAxis;
    startX: number; startY: number; delta: number; rx: number; ry: number;
    lastSync: number; timer: ReturnType<typeof setTimeout> | null; applied: boolean;
  }>(null);

  // ── per-part GPU paint surfaces ('wbchr-*' — workbench-scoped ids) ─────────
  const paints = {} as Record<PartId, PaintableHandle>;
  for (const id of PART_IDS) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- fixed-length constant list
    paints[id] = usePaintable({ id: `wbchr-${id}`, w: PAINT_W, h: PAINT_H });
  }
  const relief = usePaintable({ id: 'wbchr-relief', w: GRID_W, h: GRID_H });
  const uploadGrid = (id: PartId, g: number[]) => paints[id].paint.upload(bytesFromGrid(g));

  // installRev → re-upload every grid (mount restore, roster load, undo, reset).
  // GRIDNODES-0606 fix (HOT-UPDATE GRID DESYNC): the host paintable entry is
  // created when the <Paintable> CREATE command DRAINS (next frame) — an
  // upload queued before that is silently dropped (paintable.zig queueUpload:
  // findEntry orelse return), so a mount/hot-reload restore left the canvas
  // reading an all-zero texture while the mesh read store truth. Re-assert
  // the uploads until the entry answers readback (existence probe), then stop.
  const selDisplaceRef = useRef<number[]>([]);
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const push = () => {
      if (cancelled) return;
      for (const id of PART_IDS) uploadGrid(id, s.draft.grids[id]);
      relief.paint.upload(reliefBytesFromGrid(selDisplaceRef.current));
      const probe = paints[PART_IDS[0]].paint.readback();
      if ((!probe || probe.length < PAINT_W * PAINT_H) && tries < 30) {
        tries += 1;
        setTimeout(push, 40);
      }
    };
    push();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the rev IS the signal
  }, [s.installRev]);

  // ── file drops (E1, J1-J2) — live only while mounted. Keyboard undo/redo
  // belongs to the Workbench shell so every source/lens hits the same actions.
  useFileDrop((path) => s.dropFile(path));

  // ── the render derivation (figureFrame.tsx — the ONE copy). The mesh
  // context NEVER animates: the face pins 'still', no clock state exists
  // here at all (CLOTHSPLIT-0606; the clocks live in DressedStage). ─────────
  const fr = useFigureRender(s, STILL_FACE);
  const shownDoc = fr.shownDoc;
  const partRender = fr.partRender;
  const selDisplace = isHead ? fr.headDisplace : fr.regionedGrids[selPart];
  useEffect(() => { relief.paint.upload(reliefBytesFromGrid(selDisplace)); }, [selDisplace]);

  // ── the UNDRESSED rig (parity S6): the body alone — bones + parts +
  // sockets, NO garments. PartMeshes' contract wants a clothing list; the
  // mesh context's is empty BY RULING, not by accident. ─────────────────────
  const rig = useMemo(
    () => ({ ...buildMeshFrame(draft.bodyShape, draft.bodyPose, 0, []), clothing: [] }),
    [draft.bodyShape, draft.bodyPose],
  );

  // ── the depth-paint stroke (Route.tsx:384-444 — the shared stroke engine).
  // BRUSHFLOOR-0606: v.brush is the DIAMETER — sculptEngineBrushPx halves it
  // into the engine's radius scale so the landed disc is exactly nominal
  // width; at the single-cell floor the dab snaps to the cell center. ───────
  const dab = (sx: number, sy: number, pressure?: number) => {
    const engine = strokeEngineRef.current;
    if (!engine) return;
    const r = canvasRect.current;
    const p = sculptDabSnap(v.brush, ((sx - r.x) / r.width) * PAINT_W, ((sy - r.y) / r.height) * PAINT_H);
    const value = sculptModeValue(v.sculptMode, v.strength);
    for (const d of engine.move(p.x, p.y, pressure)) {
      paints[selPart].paint.circle(d.x, d.y, d.radius, value);
    }
  };
  const syncGrid = () => {
    const bytes = paints[selPart].paint.readback();
    if (!bytes || bytes.length < PAINT_W * PAINT_H) return;
    s.setPartGrid(selPart, gridFromBytes(bytes));
  };
  // MESHSMOOTH-0606: a smooth dab relaxes the GRID under the brush (Route.tsx
  // parity — working copy per dab, mesh sync throttled, one undo on release)
  const smoothDab = (sx: number, sy: number) => {
    const st = smoothStrokeRef.current;
    if (!st) return;
    const r = canvasRect.current;
    const cx = clamp((sx - r.x) / r.width, 0, 1);
    const cy = clamp((sy - r.y) / r.height, 0, 1);
    const { rx, ry } = stampRadiusUv(v.brush, PAINT_W);
    st.work = relaxStamp(st.work, cx, cy, rx, ry, v.strength, 1, v.mirror);
    if (Date.now() - st.lastSync >= GRAB_TUNING.liveSyncMs) {
      st.lastSync = Date.now();
      s.setPartGrid(selPart, st.work);
    }
  };

  // GRIDNODES-0606: in nodes mode a canvas click SELECTS the node under it
  // (never paints); the knob writes that one cell through the same one-truth
  // doors as every other sculpt verb (setPartGrid + texture upload + undo)
  const onCanvasDown = (e: any) => {
    if (nodesMode) {
      const r = canvasRect.current;
      if (r.width <= 0 || r.height <= 0) return;
      const u = clamp((Number(e?.x ?? 0) - r.x) / r.width, 0, 0.9999);
      const v2 = clamp((Number(e?.y ?? 0) - r.y) / r.height, 0, 0.9999);
      setSelNode(gridNodeAt(u, v2));
      nodeGestureRef.current = false; // the next edit opens a fresh undo entry
      return;
    }
    onPaintDown(e);
  };
  const setNodeValue = (value: number) => {
    const n = selNode;
    if (!n) return;
    if (!nodeGestureRef.current) {
      nodeGestureRef.current = true;
      s.history.commit(s.snapDraft);
      s.note(`node edit · ${n.gx},${n.gy} · ${selPart}`);
    }
    const g = withNodeValue(s.draft.grids[selPart], n.idx, value);
    s.setPartGrid(selPart, g);
    uploadGrid(selPart, g); // one-truth: the paint texture carries it
  };

  const onPaintDown = (e: any) => {
    paintingRef.current = true;
    if (v.sculptMode === 'smooth') {
      smoothStrokeRef.current = { base: s.draft.grids[selPart].slice(), work: s.draft.grids[selPart].slice(), lastSync: 0 };
      smoothDab(Number(e?.x ?? 0), Number(e?.y ?? 0));
      return;
    }
    strokeEngineRef.current = PAINT.createStrokeEngine({ brushPx: sculptEngineBrushPx(v.brush), mirrorAxisX: v.mirror ? PAINT_W / 2 : null });
    strokeEngineRef.current.begin();
    dab(Number(e?.x ?? 0), Number(e?.y ?? 0), Number(e?.pressure) || undefined);
  };
  const onPaintMove = (e: any) => {
    if (!paintingRef.current) return;
    if (v.sculptMode === 'smooth') { smoothDab(Number(e?.x ?? 0), Number(e?.y ?? 0)); return; }
    dab(Number(e?.x ?? 0), Number(e?.y ?? 0), Number(e?.pressure) || undefined);
  };
  const onPaintUp = () => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    const smooth = smoothStrokeRef.current;
    if (smooth) {
      smoothStrokeRef.current = null;
      s.history.commit(() => {
        const pre = s.snapDraft();
        pre.grids[selPart] = smooth.base.slice();
        return pre;
      });
      s.setPartGrid(selPart, smooth.work);
      uploadGrid(selPart, smooth.work); // one-truth: the paint texture carries it
      s.note(`smooth stroke · ${v.brush}px · ${selPart}`);
      return;
    }
    strokeEngineRef.current?.end();
    strokeEngineRef.current = null;
    s.history.commit(s.snapDraft); // the draft mutates HERE (release readback)
    syncGrid();
    s.note(`sculpt stroke · ${v.sculptMode} · ${v.brush}px · ${selPart}`);
  };

  const fillAll = () => {
    s.history.commit(s.snapDraft);
    const value = sculptModeValue(v.sculptMode, v.strength);
    paints[selPart].paint.clear(value);
    s.setPartGrid(selPart, new Array(GRID_W * GRID_H).fill((value - NEUTRAL) * 2));
    s.note(`fill · ${v.sculptMode} · ${selPart}`);
  };
  const soften = () => {
    const src = paints[selPart].paint.readback();
    if (!src || src.length < PAINT_W * PAINT_H) return;
    s.history.commit(s.snapDraft);
    const out = PAINT.soften3x3(src, PAINT_W, PAINT_H);
    paints[selPart].paint.upload(out);
    s.setPartGrid(selPart, gridFromBytes(out));
    s.note(`soften · ${selPart}`);
  };
  const clearStrokes = () => {
    s.history.commit(s.snapDraft);
    paints[selPart].paint.clear(NEUTRAL);
    s.setPartGrid(selPart, s.draft.grids[selPart].map(() => 0));
    s.note(`clear sculpt · ${selPart}`);
  };

  // ── MESHSMOOTH-0606: smooth part + the matrix data door (Route.tsx parity) ──
  const smoothPart = () => {
    s.history.commit(s.snapDraft);
    const before = gridRoughness(s.draft.grids[selPart]);
    const g = relaxGrid(s.draft.grids[selPart], v.strength, v.smoothIterations);
    uploadGrid(selPart, g);
    s.setPartGrid(selPart, g);
    s.note(`smooth part · ${selPart} · s${v.strength.toFixed(1)} ×${v.smoothIterations}`);
    s.setStatus(`${selPart} smoothed — roughness ${before.mean.toFixed(3)} → ${gridRoughness(g).mean.toFixed(3)} (ctrl+z undoes)`);
  };
  const saveSample = () => {
    try {
      const saved = saveGridSample(gridToFile(selPart, s.draft.grids[selPart], `${s.draftName} ${selPart}`));
      setSamples(listGridSamples());
      s.note(`grid sample saved · ${saved.name} · ${selPart}`);
      s.setStatus(`sample → ${saved.path} — hand-edit the rows, then press its chip to reapply`);
    } catch (error: any) {
      s.setStatus(`sample save failed: ${error?.message ?? error}`);
    }
  };
  const applySample = (name: string) => {
    try {
      const file = readGridSample(name);
      const g = fileToGrid(file);
      s.history.commit(s.snapDraft);
      uploadGrid(selPart, g);
      s.setPartGrid(selPart, g);
      s.note(`grid sample applied · ${name} → ${selPart}`);
      s.setStatus(`${name} applied to ${selPart} (authored on ${file.part}; ctrl+z undoes)`);
    } catch (error: any) {
      s.setStatus(`sample apply failed: ${error?.message ?? error}`);
    }
  };

  // ── the outline lathe (Route.tsx:490-536 — latch previews, commit on up) ──
  const profileLatchKey = (part: PartId, row: number, axis: 'left' | 'width') => `chr.profile.${part}.${row}.${axis}`;
  const writeProfileLatch = (part: PartId, row: number, value: number) => {
    const cw = canvasFitRef.current.w;
    const width = value * cw * 0.9;
    setLatch(profileLatchKey(part, row, 'width'), width);
    setLatch(profileLatchKey(part, row, 'left'), cw / 2 - width / 2);
  };
  useEffect(() => {
    for (let i = 0; i < PROFILE_N; i++) writeProfileLatch(selPart, i, draft.profiles[selPart][i]);
  }, [selPart, draft.profiles, canvasFit.w]);

  const profDab = (sx: number, sy: number) => {
    const r = canvasRect.current;
    const row = clamp(Math.floor(((sy - r.y) / r.height) * PROFILE_N), 0, PROFILE_N - 1);
    const val = clamp(Math.abs(sx - r.x - r.width / 2) / (r.width * 0.45), 0.08, 1);
    const next = profileDraftRef.current ?? draft.profiles[selPart].slice();
    const touch = (idx: number, value: number) => {
      next[idx] = clamp(value, 0.06, 1.35);
      writeProfileLatch(selPart, idx, next[idx]);
    };
    touch(row, val);
    if (row > 0) touch(row - 1, (next[row - 1] + val) / 2);
    if (row < PROFILE_N - 1) touch(row + 1, (next[row + 1] + val) / 2);
    profileDraftRef.current = next;
  };
  const onProfDown = (e: any) => {
    profileDraftRef.current = draft.profiles[selPart].slice();
    paintingRef.current = true;
    profDab(Number(e?.x ?? 0), Number(e?.y ?? 0));
  };
  const onProfMove = (e: any) => { if (paintingRef.current) profDab(Number(e?.x ?? 0), Number(e?.y ?? 0)); };
  const onProfUp = () => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    const next = profileDraftRef.current;
    profileDraftRef.current = null;
    if (next) {
      s.editDraft((d) => ({ ...d, profiles: { ...d.profiles, [selPart]: next } }));
      s.note(`outline drag · ${selPart}`);
    }
  };

  // ── the camera: the shared sculpt rig — '/characters' twig keys carry ──────
  const viewCenter: [number, number, number] = view === 'figure' ? [0, 1.05, 0] : [0, 1.4, 0];
  const camera = useSculptCamera({
    route: '/characters',
    center: viewCenter,
    viewRect,
    pickWorld: (sx, sy, cam) => (pickAtCam(sx, sy, cam).hit?.world as [number, number, number] | undefined) ?? null,
    defaults: { dist: 4.2, look: { yaw: 20, pitch: 12 }, flyPose: { pos: [0, 1.5, -3.4], yaw: 0, pitch: -4 }, mode: 'fly' },
  });

  // ── grab-sculpt (Route.tsx:652-791 — pick, pull, one-truth compose) ────────
  const partParamsFor = (id: PartId) => partRender[id].params as any;
  const grabClouds = () => {
    const sig: unknown[] = [view, selPart, partRender, rig];
    const cached = grabCloudsRef.current;
    if (cached && cached.sig.length === sig.length && cached.sig.every((x, i) => x === sig[i])) return cached;
    const instances = grabInstancesFor(view, selPart, rig.assembly);
    const next = { sig, clouds: buildGrabClouds(instances, partParamsFor), instances };
    grabCloudsRef.current = next;
    return next;
  };
  const pickAtCam = (sx: number, sy: number, cam: Solved) => {
    const r = viewRect.current;
    const { clouds, instances } = grabClouds();
    const rect = { x: 0, y: 0, width: r.width, height: r.height };
    return { hit: pickGrab(sx - r.x, sy - r.y, rect, cam, clouds), instances };
  };
  const pickAt = (sx: number, sy: number) => pickAtCam(sx, sy, camera.solvedCam());

  const hoverMove = (e: any) => {
    const { hit } = pickAt(Number(e?.x ?? 0), Number(e?.y ?? 0));
    setGrabHover((cur) => {
      if (!hit) return cur === null ? cur : null;
      if (cur && cur.part === hit.part && cur.instanceIndex === hit.instanceIndex && cur.gx === hit.gx && cur.gy === hit.gy && cur.state === 'hover') return cur;
      return { part: hit.part, instanceIndex: hit.instanceIndex, gx: hit.gx, gy: hit.gy, cu: hit.cu, cv: hit.cv, grabRadius: hit.grabRadius, state: 'hover' };
    });
  };

  const startGrab = (hit: GrabHit, instances: GrabInstance[], e: any) => {
    // grabbing a part in figure view selects it (C3 — two views, one truth)
    if (view === 'figure' && hit.part !== selPart) s.setSelPart(hit.part);
    // SCULPTPICK-0606: a 3D node click selects the same grid cell
    // immediately, before any pull distance exists.
    if (lens === 'sculpt') {
      setSelNode(gridNodeFromSurfaceHit(hit));
      nodeGestureRef.current = false;
    }
    const inst = instances[hit.instanceIndex];
    const r = viewRect.current;
    const axisWorld = grabDragAxis(hit, partParamsFor(hit.part), inst);
    const axis = screenAxisFor(hit.world, axisWorld, { x: 0, y: 0, width: r.width, height: r.height }, camera.solvedCam());
    const { rx, ry } = stampRadiusUv(v.brush, PAINT_W);
    grabRef.current = {
      hit, baseGrid: s.draft.grids[hit.part].slice(), axis,
      startX: Number(e?.x ?? 0), startY: Number(e?.y ?? 0), delta: 0, rx, ry,
      lastSync: 0, timer: null, applied: false,
    };
    setGrabHover({ part: hit.part, instanceIndex: hit.instanceIndex, gx: hit.gx, gy: hit.gy, cu: hit.cu, cv: hit.cv, grabRadius: hit.grabRadius, state: v.sculptMode === 'smooth' ? 'smooth' : 'raise' });
  };

  // MESHSMOOTH-0606: smooth mode turns a drag's distance into a smoothing
  // dose at the grabbed cell — recomputed from base, never compounding
  const smoothDose = (delta: number) => Math.min(1, Math.abs(delta) * SMOOTH_TUNING.dragDoseFactor);
  const grabbedGrid = (g: NonNullable<typeof grabRef.current>) =>
    v.sculptMode === 'smooth'
      ? relaxStamp(g.baseGrid, g.hit.cu, g.hit.cv, g.rx, g.ry, smoothDose(g.delta), SMOOTH_TUNING.drag.iterations, v.mirror)
      : applyGrabStamp(g.baseGrid, g.hit.cu, g.hit.cv, g.rx, g.ry, g.delta, v.mirror);

  const applyGrabLive = () => {
    const g = grabRef.current;
    if (!g) return;
    g.lastSync = Date.now();
    g.applied = true;
    s.setPartGrid(g.hit.part, grabbedGrid(g));
    setGrabHover((cur) => (cur ? { ...cur, state: v.sculptMode === 'smooth' ? 'smooth' : g.delta < 0 ? 'carve' : 'raise' } : cur));
  };

  const grabMove = (e: any) => {
    const g = grabRef.current;
    if (!g) return;
    g.delta = gridDeltaFor(Number(e?.x ?? 0) - g.startX, Number(e?.y ?? 0) - g.startY, g.axis);
    const since = Date.now() - g.lastSync;
    if (since >= GRAB_TUNING.liveSyncMs) {
      applyGrabLive();
    } else if (!g.timer) {
      g.timer = setTimeout(() => {
        if (grabRef.current === g) { g.timer = null; applyGrabLive(); }
      }, GRAB_TUNING.liveSyncMs - since);
    }
  };

  const endGrab = () => {
    const g = grabRef.current;
    if (!g) return;
    grabRef.current = null;
    if (g.timer) clearTimeout(g.timer);
    if (Math.abs(g.delta) < 0.01) {
      // a click, not a drag — undo any live tick, write nothing to the chain
      if (g.applied) {
        s.setPartGrid(g.hit.part, g.baseGrid);
        uploadGrid(g.hit.part, g.baseGrid);
      }
    } else {
      // the undo entry is the PRE-DRAG state (Route.tsx:741-747)
      s.history.commit(() => {
        const pre = s.snapDraft();
        pre.grids[g.hit.part] = g.baseGrid.slice();
        return pre;
      });
      const final = grabbedGrid(g);
      s.setPartGrid(g.hit.part, final);
      // ONE-TRUTH compose law: the paint texture carries the dragged grid
      uploadGrid(g.hit.part, final);
      s.note(v.sculptMode === 'smooth'
        ? `smooth drag · ${g.hit.part} · cell ${g.hit.gx},${g.hit.gy} · dose ${smoothDose(g.delta).toFixed(2)}`
        : `grab drag · ${g.hit.part} · cell ${g.hit.gx},${g.hit.gy} · ${g.delta > 0 ? 'raise' : 'carve'} ${Math.abs(g.delta).toFixed(2)}`);
    }
    setGrabHover((cur) => (cur ? { ...cur, state: 'hover' } : cur));
  };

  // grab beats orbit on the same Pressable (Route.tsx:761-774)
  const previewDown = (e: any) => {
    const { hit, instances } = pickAt(Number(e?.x ?? 0), Number(e?.y ?? 0));
    if (hit) startGrab(hit, instances, e);
    else camera.orbitDown(e);
  };
  const previewMove = (e: any) => {
    clearBrushHover(); // the cursor is in the 3D pane — the canvas settles smooth
    if (grabRef.current) { grabMove(e); return; }
    if (camera.dragging()) { camera.orbitMove(e); return; }
    hoverMove(e);
  };
  const previewUp = () => {
    if (grabRef.current) endGrab();
    else camera.orbitUp();
  };

  const grabMarker: GrabMarkerInfo | null = useMemo(() => {
    if (!grabHover) return null;
    const instances = grabInstancesFor(view, selPart, rig.assembly);
    const inst = instances[grabHover.instanceIndex];
    if (!inst || inst.part !== grabHover.part) return null;
    const params = partRender[grabHover.part].params as any;
    return {
      world: grabPointWorld(params, inst, grabHover.cu, grabHover.cv) as [number, number, number],
      grabRadius: grabHover.grabRadius,
      stampWorldRadius: stampWorldRadius(params, inst, grabHover.cu, grabHover.cv, stampRadiusUv(v.brush, PAINT_W).rx),
      state: grabHover.state,
    };
  }, [grabHover, partRender, rig, view, selPart, v.brush]);

  // ── GRIDNODES-0606: the 2D↔3D correspondence flags — each greater-grid
  // crossing gets a same-color marker ON the model at the SAME surface uv
  // the canvas dot rides (grabPointWorld is the one mapping), and the
  // selected node flies its own flag so "where is this point" reads instantly
  const flagWorld = (cu: number, cv: number): [number, number, number] => {
    const inst = grabInstancesFor('part', selPart, rig.assembly)[0];
    return grabPointWorld(partRender[selPart].params as any, inst, cu, cv) as [number, number, number];
  };
  const sculptFlags = lens === 'sculpt' ? (
    <>
      {GREATER_POINTS.map((p) => (
        <Scene3D.Mesh
          key={`gp-${p.u}`}
          geometry={Geometry.Sphere}
          params={{ radius: 1, segments: 12, rings: 8 }}
          material={p.color}
          position={flagWorld(p.u, p.v)}
          scale={0.045}
        />
      ))}
      {selNode ? (
        <Scene3D.Mesh
          geometry={Geometry.Sphere}
          params={{ radius: 1, segments: 12, rings: 8 }}
          material="#33e6ff"
          position={flagWorld(selNode.u, selNode.v)}
          scale={0.055}
        />
      ) : null}
    </>
  ) : null;

  // ── the 3D viewport pane (LENSCLARITY-0606: ONE pane, three captioned
  // mounts — FIGURE full-bleed body · PART full-bleed close-up · SCULPT's
  // full-width TOP view (v2 stack); the caption makes each unmistakable) ────
  const viewportPane = (caption: string) => (
    <Pressable
      onLayout={(lr: any) => { viewRect.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
      onMouseDown={previewDown}
      onMouseMove={previewMove}
      onMouseUp={previewUp}
      onScroll={camera.onWheel}
      style={{ flexGrow: 1, minWidth: 0, height: '100%', position: 'relative', overflow: 'hidden' }}
    >
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={T.panelSolid} showGrid={false} showAxes={false}>
        {/* LENSCLARITY-0606: CAMERA MOUNT — pane 2 (a2ae) lands the non-head
            binding fix HERE; this node did not move in the restructure. */}
        <Scene3D.Camera nativeCamera ref={camera.cameraRef} position={camera.bootCam.pos} target={camera.bootCam.target} fov={camera.bootCam.fov} />
        <LabEnvironment preset="studio" ground={false} />
        <PartMeshes view={view} selPart={selPart} parts={partRender} rig={rig} showHitboxes={v.showHitboxes} paint={draft.paint} skin={draft.skin} />
        {/* CLOTHSPLIT-0606: no HeldItemMeshes here — the prop demonstrates
            in the CLOTHING/ANIMATION contexts (WBCLOTH row S7) */}
        {v.showGrabGrid ? <GrabGridMeshes view={view} selPart={selPart} parts={partRender} rig={rig} /> : null}
        <GrabMarker marker={grabMarker} />
        {/* GRIDNODES-0606: the greater-point + selected-node flags */}
        {sculptFlags}
      </Scene3D>
      {/* SCULPTSPLIT-0606: workspace chips (I6/G3) + the lens caption share
          ONE wrapping strip — at any pane width content wraps to new lines;
          the two-layer toolbar collision (chips over the caption) is dead */}
      <Row style={{ position: 'absolute', left: 14, top: 14, right: 14, flexWrap: 'wrap', gap: 8, rowGap: 6, alignItems: 'center' }}>
        <Chip label="grid" active={v.showGrabGrid} color="cyan" onPress={() => s.setShowGrabGrid(!v.showGrabGrid)} />
        {/* SCULPTKIT-0606 no-duplication law: in the SCULPT lens mirror's
            one home is the rail's toggle tile — the chip yields there */}
        {lens !== 'sculpt' ? <Chip label="mirror" active={v.mirror} onPress={() => s.setMirror(!v.mirror)} /> : null}
        <Chip label="hitboxes" active={v.showHitboxes} color="cyan" onPress={() => s.setShowHitboxes(!v.showHitboxes)} />
        <Chip label="fly" active={camera.camMode === 'fly'} color="good" onPress={() => camera.setCamMode(camera.camMode === 'fly' ? 'orbit' : 'fly')} />
        <Chip label="undo ⌃Z" onPress={s.undo} />
        <Chip label="redo ⌃Y" onPress={s.redo} />
        <Box style={{ flexGrow: 1 }} />
        {/* the lens identity caption — which composition you are looking at */}
        <Text fontSize={9} color={T.dim} style={{ fontWeight: 800, letterSpacing: 1 }}>{caption}</Text>
      </Row>
      {camera.camMode === 'fly' ? (
        <Text fontSize={10} color={T.dim} style={{ position: 'absolute', right: 14, bottom: 14 }}>
          wasd move · q/e down/up · drag look · drag the mesh to pull · wheel dolly
        </Text>
      ) : (
        <Box style={{ position: 'absolute', right: 14, bottom: 14 }}>
          <Knob label="zoom" value={camera.zoomReflect - camera.dist} spec={TUNE.knobs.zoom} onChange={(x: number) => camera.zoomTo(camera.zoomReflect - x)} />
        </Box>
      )}
    </Pressable>
  );

  // ── the SCULPT rail (SCULPTKIT-0606, USER VERDICT): the painter rail's
  // OWN language — IconTile verbs with mode tints, SectionLabels, dividers,
  // and the ONE Workbench/studio slider for every range (steppers are dead). The
  // chrome laws hold: every tile grid's width DIVIDES its set size (no wrap
  // orphans), sections render only when the context consumes them, and no
  // control appears twice on the surface (mirror's sculpt home is HERE —
  // the viewport chip yields on this lens). From the brushes lab: the
  // verb-color-per-mode, visual-first presentation; its shape gallery is
  // the paint lane's brush-kind WIP, not chrome.
  const detailTools = isHead || v.sculptTab === 'detail';
  const fmtPx = (n: number) => `${n}px`;
  const sculptRail = (
    <ScrollView style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
      <Col style={{ padding: 8, gap: 9, alignItems: 'center' }}>
        {!isHead ? (
          <>
            <SectionLabel>SURFACE</SectionLabel>
            {/* 2 tiles (3 with the conditional reset) — both divide their row */}
            <Row style={{ gap: 6, justifyContent: 'center' }}>
              <IconTile icon="PenLine" label="Outline lathe — drag the silhouette rows" active={v.sculptTab === 'outline'} color={T.accent} onPress={() => s.setSculptTab('outline')} />
              <IconTile icon="Brush" label="Sculpt detail — paint depth on the unwrap" active={v.sculptTab === 'detail'} color={T.accent} onPress={() => s.setSculptTab('detail')} />
              {v.sculptTab === 'outline' ? (
                <IconTile icon="RotateCcw" label="Reset outline" active={false} color={T.accent} onPress={s.resetOutline} />
              ) : null}
            </Row>
            <RailDivider />
          </>
        ) : null}
        {detailTools ? (
          <>
            <SectionLabel>MODE</SectionLabel>
            {/* the four sculpt verbs — 4 wide, 4 items (MESHSMOOTH's relax rides) */}
            <Row style={{ gap: 6, justifyContent: 'center' }}>
              <IconTile icon="ArrowBigUp" label="Raise — blue pushes out" active={v.sculptMode === 'raise'} color="#3da8ff" onPress={() => s.setSculptMode('raise')} />
              <IconTile icon="ArrowBigDown" label="Carve in — orange digs" active={v.sculptMode === 'lower'} color="#ff9445" onPress={() => s.setSculptMode('lower')} />
              <IconTile icon="Minus" label="Flatten toward the base" active={v.sculptMode === 'flatten'} color="#94a3b8" onPress={() => s.setSculptMode('flatten')} />
              <IconTile icon="Waves" label="Smooth — relax the surface (paint or grab-drag)" active={v.sculptMode === 'smooth'} color="#34d399" onPress={() => s.setSculptMode('smooth')} />
            </Row>
            <SectionLabel>ACTIONS</SectionLabel>
            {/* four one-shot verbs — 4 wide, 4 items */}
            <Row style={{ gap: 6, justifyContent: 'center' }}>
              <IconTile icon="PaintBucket" label="Fill the whole part at the current mode/strength" active={false} color={T.accent} onPress={fillAll} />
              <IconTile icon="Droplets" label="Soften — 3×3 blur over the sculpt" active={false} color={T.accent} onPress={soften} />
              <IconTile icon="Sparkles" label="Smooth part — relax everything (strength × passes)" active={false} color="#34d399" onPress={smoothPart} />
              <IconTile icon="X" label="Clear the sculpt strokes" active={false} color={T.bad} onPress={clearStrokes} />
            </Row>
            <SectionLabel>TOGGLES</SectionLabel>
            {/* two toggles — 2 wide, 2 items; mirror's ONE sculpt home */}
            <Row style={{ gap: 6, justifyContent: 'center' }}>
              <IconTile icon="FlipHorizontal" label="Mirror painting across the front meridian" active={v.mirror} color="#22d3ee" onPress={() => s.setMirror(!v.mirror)} />
              <IconTile icon="Grid3x3" label="Nodes — click a grid point, fine-tune its depth" active={nodesMode} color="#22d3ee" onPress={() => setNodesMode(!nodesMode)} />
            </Row>
            <RailDivider />
          </>
        ) : null}
        <SectionLabel>BRUSH</SectionLabel>
        <LinearRailSlider
          value={v.brush}
          min={TUNE.knobs.brush.min} max={TUNE.knobs.brush.max} step={TUNE.knobs.brush.step}
          onChange={s.setBrush}
          format={fmtPx}
          tooltip={`brush diameter — the floor (${TUNE.knobs.brush.min}px) is exactly one cell`}
        />
        <SectionLabel>STRENGTH</SectionLabel>
        <LinearRailSlider
          value={v.strength}
          min={TUNE.knobs.strength.min} max={TUNE.knobs.strength.max} step={TUNE.knobs.strength.step}
          onChange={s.setStrength}
          format={(n) => n.toFixed(1)}
        />
        {detailTools ? (
          <>
            <SectionLabel>PASSES</SectionLabel>
            <LinearRailSlider
              value={v.smoothIterations}
              min={SMOOTH_TUNING.knobs.iterations.min} max={SMOOTH_TUNING.knobs.iterations.max} step={SMOOTH_TUNING.knobs.iterations.step}
              onChange={s.setSmoothIterations}
              format={(n) => `×${Math.round(n)}`}
              tooltip="smooth passes — how many relax iterations per smooth-part"
            />
          </>
        ) : null}
        {/* GRIDNODES-0606 — only while the nodes toggle consumes the space */}
        {detailTools && nodesMode ? (
          <>
            <RailDivider />
            <SectionLabel>{selNode ? `NODE ${selNode.gx},${selNode.gy}` : 'NODES'}</SectionLabel>
            {selNode ? (
              <Row style={{ gap: 6, alignItems: 'center' }}>
                <LinearRailSlider
                  value={s.draft.grids[selPart][selNode.idx]}
                  min={-1} max={1} step={0.02}
                  onChange={setNodeValue}
                  format={(n) => n.toFixed(2)}
                  tooltip="this point's depth — minus carves, plus raises"
                />
                <IconTile icon="X" label="Deselect the node" active={false} color={T.bad} onPress={() => setSelNode(null)} />
              </Row>
            ) : (
              <Text fontSize={9} color={T.dim}>click a grid point…</Text>
            )}
          </>
        ) : null}
        {/* the matrix data door (MESHSMOOTH) — Law 3's demonstrative filler */}
        {detailTools ? (
          <>
            <RailDivider />
            <SectionLabel>GRID SAMPLES</SectionLabel>
            <Row style={{ gap: 5, rowGap: 5, flexWrap: 'wrap', justifyContent: 'center' }}>
              <Chip label="save sample" color="good" onPress={saveSample} />
              {samples.map((sample) => (
                <Chip key={sample.name} label={sample.name} color="cyan" onPress={() => applySample(sample.name)} />
              ))}
            </Row>
          </>
        ) : null}
      </Col>
    </ScrollView>
  );

  const CW = canvasFit.w;
  const CH = canvasFit.h;
  const sculptCanvas = !isHead && v.sculptTab === 'outline' ? (
    <Pressable
      onLayout={(lr: any) => { canvasRect.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
      onMouseDown={onProfDown}
      onMouseMove={onProfMove}
      onMouseUp={onProfUp}
      style={{ width: CW, height: CH, borderWidth: 1, borderColor: T.frame, position: 'relative', backgroundColor: SCULPT_CANVAS.base }}
    >
      {draft.profiles[selPart].map((_p, i) => {
        const rowH = CH / PROFILE_N;
        return (
          <Box
            key={i}
            style={{ position: 'absolute', left: ('latch:' + profileLatchKey(selPart, i, 'left')) as any, top: i * rowH, width: ('latch:' + profileLatchKey(selPart, i, 'width')) as any, height: rowH - 1, backgroundColor: SCULPT_CANVAS.silhouette, borderRadius: 4 }}
          />
        );
      })}
      <Box style={{ position: 'absolute', left: CW / 2 - 1, top: 0, width: 2, height: CH, backgroundColor: T.frame }} />
    </Pressable>
  ) : (
    <Pressable
      onLayout={(lr: any) => { canvasRect.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
      onMouseDown={onCanvasDown}
      onMouseMove={(e: any) => { canvasHoverMove(Number(e?.x ?? 0), Number(e?.y ?? 0)); onPaintMove(e); }}
      onMouseUp={onPaintUp}
      style={{ width: CW, height: CH, borderWidth: 1, borderColor: T.frame, position: 'relative' }}
    >
      {/* SCULPTSPLIT-0606 addendum (USER RULING): the unwrap is a MEASUREMENT
          surface — its base is FIXED ink, never draft.skin; skin tone shows
          in the 3D views and the PAINT lens, not on the sculpt grid */}
      <UnwrapContent
        skin={SCULPT_CANVAS.base}
        photo={isHead ? v.photo : null}
        photoScale={v.photoScale}
        photoY={v.photoY}
        layers={isHead ? shownDoc?.layers ?? null : null}
        overlay={draft.paint?.[selPart] ?? null}
        width={CW}
        height={CH}
      />
      <Effect
        shader={DEPTH_OVERLAY_WGSL}
        data={depthOverlayData({
          hover: brushHover, brushPx: v.brush, mode: v.sculptMode, mirror: v.mirror,
          selected: selNode ? { u: selNode.u, v: selNode.v } : null,
        })}
        textures={[paints[selPart].id, relief.id]}
        style={{ position: 'absolute', left: 0, top: 0, width: CW, height: CH }}
      />
    </Pressable>
  );

  // ── the surface by lens + the status strip (B7) ────────────────────────────
  const hint = s.status ?? (v.photo || draft.face
    ? 'paint depth — blue pushes out, orange carves in · or grab the mesh in 3D and pull'
    : 'drop a face picture (or generate one in the panel), then paint depth — or grab the mesh and pull');

  return (
    <Col style={{ flexGrow: 1, minHeight: 0 }}>
      <Row style={{ flexGrow: 1, minHeight: 0 }}>
        {lens === 'sculpt' ? (
          /* SCULPTSPLIT-0606 v2 (USER RULING): VERTICAL STACK — the 3D mesh
             full-width on TOP, ONE ROW below it holding the two other tools
             (the unwrap canvas + the sculpt toolset/samples). The divider
             drags the top/bottom split (fraction twigged); side-by-side
             columns are dead on this lens. */
          <Col
            onLayout={(lr: any) => { stageRect.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
            style={{ flexGrow: 1, minWidth: 0, height: '100%', position: 'relative' }}
          >
            <Box style={{ flexGrow: Math.round(sculptSplit * 100), flexBasis: 0, minHeight: SCULPT_SPLIT.meshMinPx, flexDirection: 'row', minWidth: 0 }}>
              {viewportPane(`LIVE 3D · ${selPart.toUpperCase()}`)}
            </Box>
            {/* the divider — the mesh⇄tools split is yours to set */}
            <Pressable
              onMouseDown={(p: any) => { setSplitDragging(true); resizeSplit(Number(p?.y ?? 0)); }}
              onMouseMove={(p: any) => { if (splitDragging) resizeSplit(Number(p?.y ?? 0)); }}
              onMouseUp={() => setSplitDragging(false)}
              style={{ height: 10, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderBottomWidth: 1, borderColor: T.frame }}
            >
              <Box style={{ width: 48, height: 2, borderRadius: 1, backgroundColor: T.dim }} />
            </Pressable>
            <Row style={{ flexGrow: 100 - Math.round(sculptSplit * 100), flexBasis: 0, minHeight: SCULPT_SPLIT.rowMinPx, minWidth: 0 }}>
              <Box
                onLayout={(lr: any) => setCanvasBox((b) => (Math.abs(b.w - lr.width) > 1 || Math.abs(b.h - lr.height) > 1 ? { w: lr.width, h: lr.height } : b))}
                style={{ flexGrow: 1, minWidth: 0, height: '100%', alignItems: 'center', justifyContent: 'center' }}
              >
                {sculptCanvas}
              </Box>
              {/* SCULPTKIT-0606: the sculpt RAIL — the painter rail's own
                  surface (same width, same bg, same border discipline) */}
              <Col style={{ width: SCULPT_SPLIT.toolColPx, height: '100%', minHeight: 0, backgroundColor: T.panelSolid, borderLeftWidth: 1, borderColor: T.frame }}>
                {sculptRail}
              </Col>
            </Row>
            {splitDragging ? (
              /* full-stage capture while dragging (Inspector.tsx:141-147) */
              <Pressable
                style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001', zIndex: 50 }}
                onMouseMove={(p: any) => resizeSplit(Number(p?.y ?? 0))}
                onMouseUp={() => setSplitDragging(false)}
              />
            ) : null}
          </Col>
        ) : lens === 'paint' ? (
          /* the shared painter + live ModelPreview (K2/K4) — paint without
             leaving the page; save lands on the characters channel (K3) */
          <CharacterPaintLens store={s} />
        ) : (
          /* LENSCLARITY-0606: FIGURE = the whole body posed; PART = the
             isolated selected part close-up — captioned, never the same */
          viewportPane(lens === 'figure' ? 'BODY MESH · UNDRESSED' : `ISOLATED PART · ${selPart.toUpperCase()}`)
        )}
      </Row>
      {/* the status strip — every store status lands here (Route.tsx:812-816) */}
      <Row style={{ alignItems: 'center', gap: 10, paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4, backgroundColor: T.panelSolid, borderTopWidth: 1, borderColor: T.frame }}>
        <Text fontSize={10} color={T.dim} numberOfLines={1}>{hint}</Text>
        <Box style={{ flexGrow: 1 }} />
        {s.sessionError ? <Text fontSize={10} color={T.bad}>{`store offline — ${s.sessionError}`}</Text> : null}
      </Row>

      {/* offscreen: per-part GPU paint textures + the texture-capture stack
          (Route.tsx:1114-1138 — outside the flex flow, the layout law) */}
      <Box style={{ position: 'absolute', left: -99999, top: 0, width: 1, height: 1 }}>
        {PART_IDS.map((id) => (
          <Paintable key={id} id={paints[id].id} w={PAINT_W} h={PAINT_H} />
        ))}
        <Paintable id={relief.id} w={GRID_W} h={GRID_H} />
      </Box>
      <FigureCaptures store={s} r={fr} />
      <GrabGridCapture hover={grabHover} selected={selNode} mirror={v.mirror} />
    </Col>
  );
}
