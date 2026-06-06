// editors/workbench/characters/Stage.tsx — the character source's column 4
// (WBCHAR-0606; parity rows C2-C3, D1-D8, E1, G3, G6, I1-I10, J1-J2, K1, B7).
//
// CharactersRoute.tsx's render+input half, re-hung on the store. LAW 1 holds:
// everything in here DEMONSTRATES or direct-manipulates (grab-sculpt, depth
// strokes, outline lathe — workspace input owned by the surface); every
// PARAMETER edit lives in gutter 3. The viewport chips (grid/mirror/fly/
// hitboxes/undo/redo) are workspace controls, the route's own convention.
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
import { Box, Col, Effect, Paintable, Pressable, Row, Scene3D, Text } from '@reactjit/runtime/primitives';
import { usePaintable, type PaintableHandle } from '@reactjit/runtime/hooks/usePaintable';
import { useFileDrop } from '@reactjit/runtime/hooks/useFileDrop';
import { useIFTTT } from '@reactjit/runtime/hooks/useIFTTT';
import { type Solved } from '../../../game/camera';
import { GAME_ANIMATION } from '../../../game/animation';
import { GAME_CHROME } from '../../../game/chrome';
import { HED_ANIM_FRAMES, animateHed, hedDepthGrid, type HedAnimation } from '../../../game/figure/hed';
import { buildRigFrame } from '../../../game/figure/rig';
import { PART_IDS, PROFILE_N, type PartId } from '../../../game/figure/shapes';
import type { PartRender } from '../../../game/figure/render';
import { applyRegionValues, regionSignature } from '../../characters/regions';
import { PAINT } from '../../paint';
import {
  DEPTH_OVERLAY_WGSL, PAINT_EDITOR_TUNING, bytesFromGrid, editorPartParams, gridFromBytes,
  headTextureKey, partDynKey, reliefBytesFromGrid, sculptModeValue,
  skinTextureKey,
} from '../../characters/paintKit';
import {
  CharacterEditorCaptures, GrabGridCapture, GrabGridMeshes, GrabMarker, HeldItemMeshes, PartMeshes, UnwrapContent,
  type GrabMarkerInfo, type PreviewView,
} from '../../characters/preview';
import {
  GRAB_TUNING, applyGrabStamp, buildGrabClouds, grabDragAxis, grabInstancesFor, grabPointWorld, gridDeltaFor,
  pickGrab, screenAxisFor, stampRadiusUv, stampWorldRadius,
  type GrabCloud, type GrabHit, type GrabInstance, type ScreenAxis,
} from '../../characters/grabKit';
import { useSculptCamera } from '../../sculptCamera';
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
  const [, setTick] = useState(0);
  useEffect(() => s.subscribe(() => setTick((t) => t + 1)), [s]);

  const draft = s.draft;
  const v = s.view;
  const selPart = v.selPart;
  const isHead = selPart === 'head';
  // the 3D side's view: FIGURE lens shows the rig; PART + SCULPT show the part
  const view: PreviewView = lens === 'figure' ? 'figure' : 'part';

  // clocks are stage-local (Route.tsx:119-124, 288-314)
  const [animFrame, setAnimFrame] = useState(0);
  const [rigFrame, setRigFrame] = useState(0);
  const [scriptFrame, setScriptFrame] = useState(0);

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

  // installRev → re-upload every grid (mount restore, roster load, undo, reset)
  useEffect(() => {
    for (const id of PART_IDS) uploadGrid(id, s.draft.grids[id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the rev IS the signal
  }, [s.installRev]);

  // ── hotkeys (K1) + file drops (E1, J1-J2) — live only while mounted.
  // In the PAINT lens the shared painter owns ctrl+z/y (its own hotkey map);
  // the draft undo would double-fire — gate through the live lens. ──────────
  const lensRef = useRef(lens);
  lensRef.current = lens;
  useIFTTT('key:ctrl+z', () => { if (lensRef.current !== 'paint') s.undo(); });
  useIFTTT('key:ctrl+y', () => { if (lensRef.current !== 'paint') s.redo(); });
  useIFTTT('key:ctrl+shift+z', () => { if (lensRef.current !== 'paint') s.redo(); });
  useFileDrop((path) => s.dropFile(path));

  // ── animation clocks (Route.tsx:288-314 — no rAF in the cart host) ─────────
  useEffect(() => {
    if (!v.faceAnim || !draft.face) return;
    const iv = setInterval(() => setAnimFrame((f) => f + 1), 150);
    return () => clearInterval(iv);
  }, [v.faceAnim, !!draft.face]);
  useEffect(() => {
    if (!v.bodyRigAnim) return;
    const iv = setInterval(() => setRigFrame((f) => f + 1), 90);
    return () => clearInterval(iv);
  }, [v.bodyRigAnim]);
  useEffect(() => {
    if (!v.scriptPlaying) return;
    const iv = setInterval(() => setScriptFrame((f) => f + 1), 50);
    return () => clearInterval(iv);
  }, [v.scriptPlaying]);
  // a fresh script starts from frame zero (the route's reset chip semantics)
  useEffect(() => { setScriptFrame(0); }, [v.animScript]);

  const timeline = useMemo(() => GAME_ANIMATION.parse(v.animScript), [v.animScript]);
  const timelineLoops = useMemo(() => GAME_ANIMATION.isLooping(timeline), [timeline]);
  const scriptActions = useMemo(
    () => ((v.scriptPlaying || scriptFrame > 0) ? GAME_ANIMATION.sample(timeline, scriptFrame / 20) : []),
    [v.scriptPlaying, timeline, scriptFrame],
  );
  useEffect(() => {
    if (!v.scriptPlaying || timelineLoops || timeline.total <= 0) return;
    if (scriptFrame / 20 >= timeline.total) s.setScriptPlaying(false);
  }, [v.scriptPlaying, timelineLoops, timeline.total, scriptFrame]);

  const scriptMouth = scriptActions.find((a: any) => a.target === 'mouth' && (['talk', 'chew', 'cry', 'yell'] as string[]).includes(a.action));
  const activeAnim: HedAnimation | null = scriptMouth ? scriptMouth.action as HedAnimation : v.faceAnim;
  const phase = activeAnim
    ? scriptMouth
      ? Math.min(HED_ANIM_FRAMES[activeAnim] - 1, Math.floor(scriptMouth.phase * HED_ANIM_FRAMES[activeAnim]))
      : animFrame % HED_ANIM_FRAMES[activeAnim]
    : 0;
  const faceId = draft.face?.metadata?.seed != null ? `s${draft.face.metadata.seed}` : draft.face ? `f${draft.face.layers.length}` : 'noface';
  const shownDoc = useMemo(
    () => (draft.face ? (activeAnim ? animateHed(draft.face, activeAnim, phase) : draft.face) : null),
    [draft.face, activeAnim, phase],
  );

  // ── geometry: composited displacement per part (Route.tsx:331-382) ─────────
  const regionedGrids = useMemo(
    () => Object.fromEntries(PART_IDS.map((id) => [id, applyRegionValues(id, draft.grids[id], draft.regions[id])])) as Record<PartId, number[]>,
    [draft.grids, draft.regions],
  );
  const faceDepth = useMemo(() => (shownDoc ? hedDepthGrid(shownDoc) : null), [shownDoc]);
  const headDisplace = useMemo(
    () => (faceDepth ? regionedGrids.head.map((x, i) => clamp(x + faceDepth[i], -1, 1)) : regionedGrids.head),
    [regionedGrids.head, faceDepth],
  );
  const selDisplace = isHead ? headDisplace : regionedGrids[selPart];
  useEffect(() => { relief.paint.upload(reliefBytesFromGrid(selDisplace)); }, [selDisplace]);

  const paintStamp = (id: PartId) => (draft.paint?.[id] ? `.p${draft.paint[id]!.stamp}` : '');
  const headTexKey = headTextureKey({
    photoStamp: v.photo?.stamp ?? null, faceId, anim: activeAnim ?? 'still', phase,
    skin: draft.skin, photoScale: v.photoScale, photoY: v.photoY,
  }) + paintStamp('head');
  const skinTexKeyFor = (id: PartId) =>
    skinTextureKey(id, { skin: draft.skin, clothing: draft.clothing, bottoms: draft.bottoms, bodyShape: draft.bodyShape }) + paintStamp(id);

  const seqs = s.seqs;
  const partRender = useMemo(() => {
    const out = {} as Record<PartId, PartRender>;
    for (const id of PART_IDS) {
      const displace = id === 'head' ? headDisplace : regionedGrids[id];
      const headBits = id === 'head' ? `${faceId}.${activeAnim ?? 'still'}.${phase}.${draft.headScaleY.toFixed(2)}` : 'x';
      out[id] = {
        params: editorPartParams(id, draft, displace),
        dynKey: partDynKey(id, seqs[id], headBits, draft.amount, regionSignature(draft.regions[id])),
        texKey: id === 'head' ? headTexKey : skinTexKeyFor(id),
        bareTexKey: id === 'head'
          ? headTexKey
          : skinTextureKey(id, { skin: draft.skin, clothing: draft.clothing, bottoms: draft.bottoms, bodyShape: draft.bodyShape }),
      };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the helpers read exactly these
  }, [regionedGrids, headDisplace, seqs, draft.profiles, faceId, activeAnim, phase, draft.amount, draft.headScaleY, draft.skin, headTexKey, draft.clothing, draft.bottoms, draft.bodyShape, draft.regions, draft.paint]);

  const bodyPhase = v.scriptPlaying ? scriptFrame / 20 : v.bodyRigAnim ? rigFrame / 24 : 0;
  const rig = useMemo(
    () => buildRigFrame(draft.bodyShape, draft.bodyPose, bodyPhase, scriptActions, draft.clothing, draft.clothingSkin, draft.accessories, draft.bottoms),
    [draft.bodyShape, draft.bodyPose, bodyPhase, scriptActions, draft.clothing, draft.clothingSkin, draft.accessories, draft.bottoms],
  );
  const sculpted = s.sculptedItems();

  // ── the depth-paint stroke (Route.tsx:384-444 — the shared stroke engine) ──
  const dab = (sx: number, sy: number, pressure?: number) => {
    const engine = strokeEngineRef.current;
    if (!engine) return;
    const r = canvasRect.current;
    const tx = ((sx - r.x) / r.width) * PAINT_W;
    const ty = ((sy - r.y) / r.height) * PAINT_H;
    const value = sculptModeValue(v.sculptMode, v.strength);
    for (const d of engine.move(tx, ty, pressure)) {
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

  const onPaintDown = (e: any) => {
    paintingRef.current = true;
    if (v.sculptMode === 'smooth') {
      smoothStrokeRef.current = { base: s.draft.grids[selPart].slice(), work: s.draft.grids[selPart].slice(), lastSync: 0 };
      smoothDab(Number(e?.x ?? 0), Number(e?.y ?? 0));
      return;
    }
    strokeEngineRef.current = PAINT.createStrokeEngine({ brushPx: v.brush, mirrorAxisX: v.mirror ? PAINT_W / 2 : null });
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

  // ── the 3D viewport (shared by FIGURE / PART / SCULPT lenses) ──────────────
  const viewport = (
    <Pressable
      onLayout={(lr: any) => { viewRect.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
      onMouseDown={previewDown}
      onMouseMove={previewMove}
      onMouseUp={previewUp}
      onScroll={camera.onWheel}
      style={{ flexGrow: 1, minWidth: 0, height: '100%', position: 'relative', overflow: 'hidden' }}
    >
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={T.panelSolid} showGrid={false} showAxes={false}>
        <Scene3D.Camera nativeCamera ref={camera.cameraRef} position={camera.bootCam.pos} target={camera.bootCam.target} fov={camera.bootCam.fov} />
        <LabEnvironment preset="studio" ground={false} />
        <PartMeshes view={view} selPart={selPart} parts={partRender} rig={rig} showHitboxes={v.showHitboxes} paint={draft.paint} skin={draft.skin} />
        {view === 'figure' && draft.heldItem !== 'none' ? <HeldItemMeshes itemId={draft.heldItem} rig={rig} extraItems={sculpted} /> : null}
        {v.showGrabGrid ? <GrabGridMeshes view={view} selPart={selPart} parts={partRender} rig={rig} /> : null}
        <GrabMarker marker={grabMarker} />
      </Scene3D>
      {/* workspace chips ON the viewport (I6/G3 — the route's convention) */}
      <Row style={{ position: 'absolute', left: 14, top: 14, gap: 8 }}>
        <Chip label="grid" active={v.showGrabGrid} color="cyan" onPress={() => s.setShowGrabGrid(!v.showGrabGrid)} />
        <Chip label="mirror" active={v.mirror} onPress={() => s.setMirror(!v.mirror)} />
        <Chip label="hitboxes" active={v.showHitboxes} color="cyan" onPress={() => s.setShowHitboxes(!v.showHitboxes)} />
        <Chip label="fly" active={camera.camMode === 'fly'} color="good" onPress={() => camera.setCamMode(camera.camMode === 'fly' ? 'orbit' : 'fly')} />
        <Chip label="undo ⌃Z" onPress={s.undo} />
        <Chip label="redo ⌃Y" onPress={s.redo} />
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

  // ── the SCULPT lens (DEADSPACE-0606): tools = ONE compact wrapping strip
  // on TOP (the canvas is 2:1 — width is the scarce axis, so a side rail
  // would cost more canvas than a top strip); the canvas aspect-fills the
  // rest; the samples strip rides UNDER it (Law 3's demonstrative filler,
  // never a black void). Same verbs, same data — layout only.
  const sculptTools = (
    <Row style={{ flexWrap: 'wrap', gap: 8, rowGap: 6, alignItems: 'center', paddingLeft: 10, paddingRight: 10, paddingTop: 8, paddingBottom: 8 }}>
      {!isHead ? (
        <>
          <Chip label="outline" active={v.sculptTab === 'outline'} onPress={() => s.setSculptTab('outline')} />
          <Chip label="sculpt detail" active={v.sculptTab === 'detail'} onPress={() => s.setSculptTab('detail')} />
          {v.sculptTab === 'outline' ? <Chip label="reset outline" onPress={s.resetOutline} /> : null}
        </>
      ) : null}
      {isHead || v.sculptTab === 'detail' ? (
        <>
          <Chip label="raise" active={v.sculptMode === 'raise'} onPress={() => s.setSculptMode('raise')} />
          <Chip label="carve in" active={v.sculptMode === 'lower'} color="#ff9445" onPress={() => s.setSculptMode('lower')} />
          <Chip label="flatten" active={v.sculptMode === 'flatten'} color="#94a3b8" onPress={() => s.setSculptMode('flatten')} />
          {/* MESHSMOOTH-0606: the relax brush — paint OR grab-drag it */}
          <Chip label="smooth" active={v.sculptMode === 'smooth'} color="#34d399" onPress={() => s.setSculptMode('smooth')} />
          <Chip label="fill" onPress={fillAll} />
          <Chip label="soften" onPress={soften} />
          <Chip label="smooth part" color="#34d399" onPress={smoothPart} />
          <Chip label="mirror" active={v.mirror} onPress={() => s.setMirror(!v.mirror)} />
          <Chip label="clear" onPress={clearStrokes} />
        </>
      ) : null}
      <Knob label="brush size" value={v.brush} spec={TUNE.knobs.brush} onChange={s.setBrush} />
      <Knob label="strength" value={v.strength} spec={TUNE.knobs.strength} onChange={s.setStrength} />
      {isHead || v.sculptTab === 'detail' ? (
        <Knob label="smooth passes" value={v.smoothIterations} spec={SMOOTH_TUNING.knobs.iterations} onChange={s.setSmoothIterations} />
      ) : null}
    </Row>
  );

  // the matrix data door (MESHSMOOTH): the strip under the canvas — the
  // leftover space demonstrates the grid samples instead of going black
  const sampleStrip = (isHead || v.sculptTab === 'detail') ? (
    <Row style={{ flexWrap: 'wrap', gap: 8, rowGap: 6, alignItems: 'center', paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 8 }}>
      <Text fontSize={9} color={T.dim} style={{ fontWeight: 800, letterSpacing: 1 }}>GRID SAMPLES</Text>
      <Chip label="save sample" color="good" onPress={saveSample} />
      {samples.map((sample) => (
        <Chip key={sample.name} label={sample.name} color="cyan" onPress={() => applySample(sample.name)} />
      ))}
    </Row>
  ) : null;

  const CW = canvasFit.w;
  const CH = canvasFit.h;
  const sculptCanvas = !isHead && v.sculptTab === 'outline' ? (
    <Pressable
      onLayout={(lr: any) => { canvasRect.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
      onMouseDown={onProfDown}
      onMouseMove={onProfMove}
      onMouseUp={onProfUp}
      style={{ width: CW, height: CH, borderWidth: 1, borderColor: T.frame, position: 'relative', backgroundColor: '#0a1322' }}
    >
      {draft.profiles[selPart].map((_p, i) => {
        const rowH = CH / PROFILE_N;
        return (
          <Box
            key={i}
            style={{ position: 'absolute', left: ('latch:' + profileLatchKey(selPart, i, 'left')) as any, top: i * rowH, width: ('latch:' + profileLatchKey(selPart, i, 'width')) as any, height: rowH - 1, backgroundColor: draft.skin, borderRadius: 4 }}
          />
        );
      })}
      <Box style={{ position: 'absolute', left: CW / 2 - 1, top: 0, width: 2, height: CH, backgroundColor: T.frame }} />
    </Pressable>
  ) : (
    <Pressable
      onLayout={(lr: any) => { canvasRect.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
      onMouseDown={onPaintDown}
      onMouseMove={onPaintMove}
      onMouseUp={onPaintUp}
      style={{ width: CW, height: CH, borderWidth: 1, borderColor: T.frame, position: 'relative' }}
    >
      <UnwrapContent
        skin={draft.skin}
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
        data={[0]}
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
          <>
            {/* DEADSPACE-0606: the canvas COLUMN (flex 3 against the 3D's 2);
                tools strip on top, the measured box aspect-fills with the
                canvas, samples demonstrate the tail — zero black void */}
            <Col style={{ flexGrow: 3, flexBasis: 0, minWidth: 0, height: '100%' }}>
              {sculptTools}
              <Box
                onLayout={(lr: any) => setCanvasBox((b) => (Math.abs(b.w - lr.width) > 1 || Math.abs(b.h - lr.height) > 1 ? { w: lr.width, h: lr.height } : b))}
                style={{ flexGrow: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center' }}
              >
                {sculptCanvas}
              </Box>
              {sampleStrip}
            </Col>
            <Box style={{ flexGrow: 2, flexBasis: 0, minWidth: 0, height: '100%', flexDirection: 'row' }}>
              {viewport}
            </Box>
          </>
        ) : lens === 'paint' ? (
          /* the shared painter + live ModelPreview (K2/K4) — paint without
             leaving the page; save lands on the characters channel (K3) */
          <CharacterPaintLens store={s} />
        ) : (
          viewport
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
      <CharacterEditorCaptures
        headTexKey={headTexKey}
        skinTexKeyFor={skinTexKeyFor}
        skin={draft.skin}
        photo={v.photo}
        photoScale={v.photoScale}
        photoY={v.photoY}
        layers={shownDoc?.layers ?? null}
        clothing={draft.clothing}
        bottoms={draft.bottoms}
        bodyShape={draft.bodyShape}
        parts={PART_IDS}
        paint={draft.paint}
      />
      <GrabGridCapture hover={grabHover} mirror={v.mirror} />
    </Col>
  );
}
