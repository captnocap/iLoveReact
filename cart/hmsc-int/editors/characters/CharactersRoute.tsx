// editors/characters/ — the CHARACTERS editor route (V2/V17-TRIAGE).
//
// The head_lab authoring UI REMADE as a tool route inside the one app:
// authors what game/figure runs (cart/head_lab is the behavior reference —
// read, never imported; this route is the ruled editors-may-reach-into-
// figure-internals exception). Deletion contract: CAPTURE.md.
//
//   left:  roster + part tabs + the selected part's unwrap painter
//          (blue = raised, orange = carved in) or outline lathe, wardrobe,
//          pose/animation, region sliders
//   right: the selected part alone, or the ASSEMBLED FIGURE (view toggle)
//
// Strokes paint straight into a per-part GPU texture (usePaintable); the
// overlay is one <Effect> quad; React only sees a stroke on release
// (readback → 48×24 grid → mesh re-sculpt through a dynamic geometry slot).
// Persistence is V20 from day one: Save appends the document to the
// 'characters' stream and materializes the snapshot the compile consumes.
//
// Route surfaces OVERLAY the shell body (the editor stays mounted
// underneath): absolute full-area + opaque bg, like LabsRoute — a normal-
// flow root stacks BELOW the editor panes instead of covering them.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Col, Effect, Paintable, Pressable, Row, ScrollView, Scene3D, Text, TextInput } from '@reactjit/runtime/primitives';
import { usePaintable, type PaintableHandle } from '@reactjit/runtime/hooks/usePaintable';
import { useFileDrop } from '@reactjit/runtime/hooks/useFileDrop';
import { readFile, writeFile, mkdir } from '@reactjit/runtime/hooks/fs';
import { OrbitCamera } from '@reactjit/cameras';
import { GAME_ANIMATION } from '../../game/animation';
import { GAME_CHROME } from '../../game/chrome';
import { GAME_ITEMS } from '../../game/items';
import {
  HED_ANIM_FRAMES, animateHed, generateFace, hedDepthGrid, parseHed, serializeHed,
  type HedAnimation, type HedDocument, type HedLayer,
} from '../../game/figure/hed';
import { parseBody, serializeBody } from '../../game/figure/body';
import { buildRigFrame } from '../../game/figure/rig';
import {
  BODY_POSES, BODY_SHAPES, BOTTOMS, CLOTHING, CLOTHING_ACCESSORIES, CLOTHING_SKINS, DEFAULT_BOTTOMS, PART_IDS, PART_PRESETS, PROFILE_N, defaultProfile,
  type BodyPoseId, type BodyShapeId, type BottomsId, type ClothingAccessoryId, type ClothingId, type ClothingSkinId, type PartId,
} from '../../game/figure/shapes';
import type { PartRender } from '../../game/figure/render';
import {
  DRAFT_DEFAULTS, draftFromDocument, draftToDocument, draftToHed, draftWithFace, emptyDraft, emptyGrid,
  type CharacterDraft,
} from './draft';
import { generateCharacterDraft } from './generate';
import { SHAPE_REGIONS, applyRegionValues, regionSignature } from './regions';
import { editorRoster, mintCharacterId } from './roster';
import {
  DEPTH_OVERLAY_WGSL, PAINT_EDITOR_TUNING, bytesFromGrid, editorPartParams, facePaintDepth, gridFromBytes,
  headTextureKey, partDynKey, reliefBytesFromGrid, sculptModeValue, skinTextureKey, softenBytes,
  type SculptMode,
} from './paintKit';
import { ChipRow, RegionSliderRow, SwatchRow } from './controls';
import { CharacterEditorCaptures, HeldItemMeshes, PartMeshes, UnwrapContent, type Photo, type PreviewView } from './preview';
import { ANIM_PRESETS, DEFAULT_ANIM_SCRIPT } from './animPresets';

const { Chip, Knob, Panel, LabEnvironment } = GAME_CHROME;
const T = GAME_CHROME.tokens.color;
const TUNE = PAINT_EDITOR_TUNING;
const EDITOR_W = TUNE.editor.width;
const EDITOR_H = TUNE.editor.height;
const PAINT_W = TUNE.paint.width;
const PAINT_H = TUNE.paint.height;
const GRID_W = TUNE.grid.width;
const GRID_H = TUNE.grid.height;
const NEUTRAL = TUNE.neutral;

type PaintTool = 'sculpt' | 'face';
type EditTab = 'outline' | 'detail';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function setLatch(key: string, value: number): void {
  const fn = (globalThis as any).__latchSet;
  if (typeof fn === 'function') fn(key, value);
}

export function CharactersRoute(props: { onExit: () => void }) {
  // ── the character being authored + session state ──────────────────────────
  const [draft, setDraft] = useState<CharacterDraft>(emptyDraft);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('new character');
  const [rosterRev, setRosterRev] = useState(0);
  const [selPart, setSelPart] = useState<PartId>('head');
  const [view, setView] = useState<PreviewView>('part');
  const [editTab, setEditTab] = useState<EditTab>('outline');
  const [paintTool, setPaintTool] = useState<PaintTool>('sculpt');
  const [mode, setMode] = useState<SculptMode>('raise');
  const [mirror, setMirror] = useState(true);
  const [brush, setBrush] = useState(14);
  const [strength, setStrength] = useState(0.5);
  const [facePaintColor, setFacePaintColor] = useState(TUNE.facePaints[0]);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoScale, setPhotoScale] = useState(0.4);
  const [photoY, setPhotoY] = useState(0);
  const [showHitboxes, setShowHitboxes] = useState(false);
  const [anim, setAnim] = useState<HedAnimation | null>(null);
  const [animFrame, setAnimFrame] = useState(0);
  const [bodyRigAnim, setBodyRigAnim] = useState(false);
  const [rigFrame, setRigFrame] = useState(0);
  const [animScript, setAnimScript] = useState(DEFAULT_ANIM_SCRIPT);
  const [scriptPlaying, setScriptPlaying] = useState(false);
  const [scriptFrame, setScriptFrame] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [yaw, setYaw] = useState(20);
  const [pitch, setPitch] = useState(12);
  const [dist, setDist] = useState(4.2);
  // per-part sculpt versions — bumping regenerates that part's dyn mesh
  const [seqs, setSeqs] = useState<Record<PartId, number>>(
    () => Object.fromEntries(PART_IDS.map((id) => [id, 0])) as Record<PartId, number>,
  );

  const paintingRef = useRef(false);
  const faceStrokeRef = useRef<{ cx: number; cy: number }[]>([]);
  const profileDraftRef = useRef<number[] | null>(null);
  const canvasRect = useRef({ x: 0, y: 0, width: EDITOR_W, height: EDITOR_H });
  const orbitRef = useRef<{ x: number; y: number } | null>(null);

  // ── the V20 roster (persistence from version one) ──────────────────────────
  const roster = useMemo(() => editorRoster(), []);
  const rosterState = useMemo(() => roster.state(), [roster, rosterRev]);

  // ── per-part GPU paint surfaces (PART_IDS is constant → stable hook order) ─
  const paints = {} as Record<PartId, PaintableHandle>;
  for (const id of PART_IDS) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- fixed-length constant list
    paints[id] = usePaintable({ id: `chr-${id}`, w: PAINT_W, h: PAINT_H });
  }
  const relief = usePaintable({ id: 'chr-relief', w: GRID_W, h: GRID_H });
  useEffect(() => { for (const id of PART_IDS) paints[id].paint.clear(NEUTRAL); }, []);

  const uploadGrid = (id: PartId, g: number[]) => paints[id].paint.upload(bytesFromGrid(g));
  const bumpSeq = (id: PartId) => setSeqs((prev) => ({ ...prev, [id]: prev[id] + 1 }));
  const bumpAllSeqs = () => setSeqs((prev) => Object.fromEntries(PART_IDS.map((id) => [id, prev[id] + 1])) as Record<PartId, number>);

  const setPartGrid = (id: PartId, g: number[]) => {
    setDraft((d) => ({ ...d, grids: { ...d.grids, [id]: g } }));
    bumpSeq(id);
  };

  /** Replace the whole draft + sync every paint texture and mesh slot. */
  const installDraft = (next: CharacterDraft) => {
    setDraft(next);
    for (const id of PART_IDS) uploadGrid(id, next.grids[id]);
    bumpAllSeqs();
  };

  // ── animation clocks (no requestAnimationFrame in the cart host) ──────────
  useEffect(() => {
    if (!anim || !draft.face) return;
    const iv = setInterval(() => setAnimFrame((f) => f + 1), 150);
    return () => clearInterval(iv);
  }, [anim, !!draft.face]);
  useEffect(() => {
    if (!bodyRigAnim) return;
    const iv = setInterval(() => setRigFrame((f) => f + 1), 90);
    return () => clearInterval(iv);
  }, [bodyRigAnim]);
  useEffect(() => {
    if (!scriptPlaying) return;
    const iv = setInterval(() => setScriptFrame((f) => f + 1), 50);
    return () => clearInterval(iv);
  }, [scriptPlaying]);

  const timeline = useMemo(() => GAME_ANIMATION.parse(animScript), [animScript]);
  const timelineLoops = useMemo(() => GAME_ANIMATION.isLooping(timeline), [timeline]);
  const scriptActions = useMemo(
    () => ((scriptPlaying || scriptFrame > 0) ? GAME_ANIMATION.sample(timeline, scriptFrame / 20) : []),
    [scriptPlaying, timeline, scriptFrame],
  );
  useEffect(() => {
    if (!scriptPlaying || timelineLoops || timeline.total <= 0) return;
    if (scriptFrame / 20 >= timeline.total) setScriptPlaying(false);
  }, [scriptPlaying, timelineLoops, timeline.total, scriptFrame]);

  const scriptMouth = scriptActions.find((a: any) => a.target === 'mouth' && (['talk', 'chew', 'cry', 'yell'] as string[]).includes(a.action));
  const activeAnim: HedAnimation | null = scriptMouth ? scriptMouth.action as HedAnimation : anim;
  const phase = activeAnim
    ? scriptMouth
      ? Math.min(HED_ANIM_FRAMES[activeAnim] - 1, Math.floor(scriptMouth.phase * HED_ANIM_FRAMES[activeAnim]))
      : animFrame % HED_ANIM_FRAMES[activeAnim]
    : 0;
  // the face the canvas/bake/mesh SHOW: the playing animation's frame applied
  // (a pure transform — the draft's base face stays untouched)
  const faceId = draft.face?.metadata?.seed != null ? `s${draft.face.metadata.seed}` : draft.face ? `f${draft.face.layers.length}` : 'noface';
  const shownDoc = useMemo(
    () => (draft.face ? (activeAnim ? animateHed(draft.face, activeAnim, phase) : draft.face) : null),
    [draft.face, activeAnim, phase],
  );

  // ── geometry: composited displacement per part ─────────────────────────────
  const regionedGrids = useMemo(
    () => Object.fromEntries(PART_IDS.map((id) => [id, applyRegionValues(id, draft.grids[id], draft.regions[id])])) as Record<PartId, number[]>,
    [draft.grids, draft.regions],
  );
  const faceDepth = useMemo(() => (shownDoc ? hedDepthGrid(shownDoc) : null), [shownDoc]);
  const headDisplace = useMemo(
    () => (faceDepth ? regionedGrids.head.map((v, i) => clamp(v + faceDepth[i], -1, 1)) : regionedGrids.head),
    [regionedGrids.head, faceDepth],
  );

  // keep the overlay's contour texture in sync with the selected part's form
  const selDisplace = selPart === 'head' ? headDisplace : regionedGrids[selPart];
  useEffect(() => { relief.paint.upload(reliefBytesFromGrid(selDisplace)); }, [selDisplace]);

  // ── content-addressed keys + the memo'd mesh bundle ───────────────────────
  const headTexKey = headTextureKey({
    photoStamp: photo?.stamp ?? null, faceId, anim: activeAnim ?? 'still', phase,
    skin: draft.skin, photoScale, photoY,
  });
  const skinTexKeyFor = (id: PartId) =>
    skinTextureKey(id, { skin: draft.skin, clothing: draft.clothing, bottoms: draft.bottoms, bodyShape: draft.bodyShape });

  const partRender = useMemo(() => {
    const out = {} as Record<PartId, PartRender>;
    for (const id of PART_IDS) {
      const displace = id === 'head' ? headDisplace : regionedGrids[id];
      const headBits = id === 'head' ? `${faceId}.${activeAnim ?? 'still'}.${phase}.${draft.headScaleY.toFixed(2)}` : 'x';
      out[id] = {
        params: editorPartParams(id, draft, displace),
        dynKey: partDynKey(id, seqs[id], headBits, draft.amount, regionSignature(draft.regions[id])),
        texKey: id === 'head' ? headTexKey : skinTexKeyFor(id),
      };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the helpers read exactly these
  }, [regionedGrids, headDisplace, seqs, draft.profiles, faceId, activeAnim, phase, draft.amount, draft.headScaleY, draft.skin, headTexKey, draft.clothing, draft.bottoms, draft.bodyShape, draft.regions]);

  const bodyPhase = scriptPlaying ? scriptFrame / 20 : bodyRigAnim ? rigFrame / 24 : 0;
  const rig = useMemo(
    () => buildRigFrame(draft.bodyShape, draft.bodyPose, bodyPhase, scriptActions, draft.clothing, draft.clothingSkin, draft.accessories, draft.bottoms),
    [draft.bodyShape, draft.bodyPose, bodyPhase, scriptActions, draft.clothing, draft.clothingSkin, draft.accessories, draft.bottoms],
  );

  // ── painting (sculpt + face) ───────────────────────────────────────────────
  const isHead = selPart === 'head';
  const uvFromScreen = (sx: number, sy: number) => {
    const r = canvasRect.current;
    return { cx: clamp((sx - r.x) / r.width, 0, 1), cy: clamp((sy - r.y) / r.height, 0, 1) };
  };

  const dab = (sx: number, sy: number) => {
    const r = canvasRect.current;
    const tx = ((sx - r.x) / r.width) * PAINT_W;
    const ty = ((sy - r.y) / r.height) * PAINT_H;
    const value = sculptModeValue(mode, strength);
    paints[selPart].paint.circle(tx, ty, brush, value);
    // symmetry: also dab mirrored across the front meridian (u=0.5)
    if (mirror) {
      const mx = PAINT_W - tx;
      if (Math.abs(mx - tx) > 2) paints[selPart].paint.circle(mx, ty, brush, value);
    }
  };

  const appendFacePoint = (sx: number, sy: number) => {
    const p = uvFromScreen(sx, sy);
    const prev = faceStrokeRef.current[faceStrokeRef.current.length - 1];
    const minStep = Math.max(TUNE.faceStrokeMinStep, brush / PAINT_W * 0.35);
    if (prev) {
      const dx = p.cx - prev.cx;
      const dy = p.cy - prev.cy;
      if (Math.sqrt(dx * dx + dy * dy) < minStep) return;
    }
    faceStrokeRef.current.push(p);
  };

  const ensureFace = (): HedDocument => draft.face ?? {
    kind: 'hed', version: 1, cols: GRID_W, rows: GRID_H,
    skin: draft.skin, amount: draft.amount, scaleY: draft.headScaleY,
    sculpt: emptyGrid(), layers: [],
  };

  const commitFaceStroke = () => {
    const points = faceStrokeRef.current;
    faceStrokeRef.current = [];
    if (points.length === 0) return;
    const rx = clamp(brush / PAINT_W, 0.01, 0.2);
    const ry = clamp(brush / PAINT_H, 0.01, 0.2);
    const depth = facePaintDepth(mode, strength);
    const layer: HedLayer = {
      id: `paint-${Date.now()}`,
      label: 'paint stroke',
      color: facePaintColor,
      depth,
      feather: TUNE.faceStrokeFeather,
      shapes: points.map((p) => ({ kind: 'ellipse' as const, cx: p.cx, cy: p.cy, rx, ry, mirror: mirror && Math.abs(p.cx - 0.5) > 0.01 ? true : undefined })),
    };
    const doc = ensureFace();
    setDraft((d) => ({ ...d, face: { ...doc, skin: d.skin, amount: d.amount, scaleY: d.headScaleY, layers: doc.layers.concat(layer) } }));
    setStatus(`painted ${points.length} face dabs as one .hed layer`);
  };

  const syncGrid = () => {
    const bytes = paints[selPart].paint.readback();
    if (!bytes || bytes.length < PAINT_W * PAINT_H) return;
    setPartGrid(selPart, gridFromBytes(bytes));
  };

  const onPaintDown = (e: any) => {
    paintingRef.current = true;
    const sx = Number(e?.x ?? 0), sy = Number(e?.y ?? 0);
    if (isHead && paintTool === 'face') {
      faceStrokeRef.current = [];
      appendFacePoint(sx, sy);
    } else {
      dab(sx, sy);
    }
  };
  const onPaintMove = (e: any) => {
    if (!paintingRef.current) return;
    const sx = Number(e?.x ?? 0), sy = Number(e?.y ?? 0);
    if (isHead && paintTool === 'face') appendFacePoint(sx, sy);
    else dab(sx, sy);
  };
  const onPaintUp = () => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    if (isHead && paintTool === 'face') commitFaceStroke();
    else syncGrid();
  };

  const fillAll = () => {
    const value = sculptModeValue(mode, strength);
    paints[selPart].paint.clear(value);
    setPartGrid(selPart, new Array(GRID_W * GRID_H).fill((value - NEUTRAL) * 2));
  };

  const soften = () => {
    const src = paints[selPart].paint.readback();
    if (!src || src.length < PAINT_W * PAINT_H) return;
    const out = softenBytes(src);
    paints[selPart].paint.upload(out);
    setPartGrid(selPart, gridFromBytes(out));
  };

  const clearStrokes = () => {
    paints[selPart].paint.clear(NEUTRAL);
    setPartGrid(selPart, emptyGrid());
  };

  const removeLastPaintLayer = () => {
    setDraft((d) => {
      if (!d.face) return d;
      let drop = -1;
      for (let i = d.face.layers.length - 1; i >= 0; i--) {
        if (d.face.layers[i].id.startsWith('paint-')) { drop = i; break; }
      }
      if (drop < 0) return d;
      return { ...d, face: { ...d.face, layers: d.face.layers.filter((_, i) => i !== drop) } };
    });
  };

  // ── outline lathe (drag previews → latches; commit on release) ────────────
  const profileLatchKey = (part: PartId, row: number, axis: 'left' | 'width') => `chr.profile.${part}.${row}.${axis}`;
  const writeProfileLatch = (part: PartId, row: number, value: number) => {
    const width = value * EDITOR_W * 0.9;
    setLatch(profileLatchKey(part, row, 'width'), width);
    setLatch(profileLatchKey(part, row, 'left'), EDITOR_W / 2 - width / 2);
  };
  useEffect(() => {
    for (let i = 0; i < PROFILE_N; i++) writeProfileLatch(selPart, i, draft.profiles[selPart][i]);
  }, [selPart, draft.profiles]);

  const profDab = (sx: number, sy: number) => {
    const r = canvasRect.current;
    const row = clamp(Math.floor(((sy - r.y) / r.height) * PROFILE_N), 0, PROFILE_N - 1);
    const v = clamp(Math.abs(sx - r.x - r.width / 2) / (r.width * 0.45), 0.08, 1);
    const next = profileDraftRef.current ?? draft.profiles[selPart].slice();
    const touch = (idx: number, value: number) => {
      next[idx] = clamp(value, 0.06, 1.35);
      writeProfileLatch(selPart, idx, next[idx]);
    };
    touch(row, v);
    // blend the neighbors halfway so a drag carves a smooth curve
    if (row > 0) touch(row - 1, (next[row - 1] + v) / 2);
    if (row < PROFILE_N - 1) touch(row + 1, (next[row + 1] + v) / 2);
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
      setDraft((d) => ({ ...d, profiles: { ...d.profiles, [selPart]: next } }));
      bumpSeq(selPart);
    }
  };
  const resetOutline = () => {
    setDraft((d) => ({ ...d, profiles: { ...d.profiles, [selPart]: defaultProfile(selPart) } }));
    bumpSeq(selPart);
  };

  // ── generation / documents / roster ────────────────────────────────────────
  const applyFaceDoc = (doc: HedDocument, label: string) => {
    const next = draftWithFace(draft, doc);
    installDraft(next);
    setSelPart('head');
    setStatus(label);
  };

  const generateFaceOnly = () => {
    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffff)) >>> 0;
    applyFaceDoc(generateFace(seed), `generated face ${seed} — sculpt over it, or generate again`);
  };

  const generateWholeCharacter = () => {
    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffff)) >>> 0;
    const next = generateCharacterDraft(seed);
    installDraft(next);
    setSelPart('head');
    setView('figure');
    setBodyRigAnim(false);
    setStatus(`generated character ${seed} — ${BODY_SHAPES[next.bodyShape].label}, ${CLOTHING[next.clothing].label} + ${BOTTOMS[next.bottoms].label}`);
  };

  const saveToRoster = () => {
    const id = draftId ?? mintCharacterId();
    const doc = draftToDocument(draft, draftName);
    roster.save(id, doc);
    setDraftId(id);
    setRosterRev((r) => r + 1);
    setStatus(`saved "${draftName}" to the roster + snapshot (the game's view is fresh)`);
  };

  const loadFromRoster = (id: string) => {
    const doc = rosterState.characters[id];
    if (!doc) return;
    installDraft(draftFromDocument(doc));
    setDraftId(id);
    setDraftName(doc.metadata?.title ?? id);
    setView('figure');
    setStatus(`loaded "${doc.metadata?.title ?? id}" from the roster`);
  };

  const removeFromRoster = (id: string) => {
    roster.remove(id);
    setRosterRev((r) => r + 1);
    if (draftId === id) setDraftId(null);
    setStatus('removed from the roster (its history stays in the log)');
  };

  const exportHead = () => {
    mkdir('cart/heads');
    const stamp = Date.now();
    writeFile(`cart/heads/head_${stamp}.hed.json`, serializeHed(draftToHed(draft, `head ${stamp}`)));
    setStatus(`exported cart/heads/head_${stamp}.hed.json — drop it back in to reload`);
  };

  const exportBody = () => {
    mkdir('cart/heads');
    const stamp = Date.now();
    writeFile(`cart/heads/body_${stamp}.body.json`, serializeBody(draftToDocument(draft, `body ${stamp}`)));
    setStatus(`exported cart/heads/body_${stamp}.body.json — the whole character`);
  };

  // drop: .body.json = whole character, .hed.json = a head, else a face photo
  useFileDrop((path) => {
    if (path.endsWith('.body.json')) {
      const text = readFile(path);
      const doc = text ? parseBody(text) : null;
      if (!doc) { setStatus(`${path.split('/').pop()} is not a .body document`); return; }
      installDraft(draftFromDocument(doc));
      setDraftId(null);
      setDraftName(doc.metadata?.title ?? 'imported character');
      setStatus(`loaded ${path.split('/').pop()}`);
      return;
    }
    if (path.endsWith('.json')) {
      const text = readFile(path);
      const doc = text ? parseHed(text) : null;
      if (!doc) { setStatus(`${path.split('/').pop()} is not a .hed head document`); return; }
      applyFaceDoc(doc, `loaded ${path.split('/').pop()}`);
      return;
    }
    setSelPart('head');
    setPhoto({ path, stamp: Date.now() });
  });

  // ── orbit ──────────────────────────────────────────────────────────────────
  const orbitDown = (e: any) => { orbitRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; };
  const orbitMove = (e: any) => {
    const d = orbitRef.current;
    if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    setYaw((v) => v + (nx - d.x) * TUNE.orbit.yawPerPx);
    setPitch((v) => clamp(v - (ny - d.y) * TUNE.orbit.pitchPerPx, TUNE.orbit.pitchMin, TUNE.orbit.pitchMax));
    d.x = nx; d.y = ny;
  };
  const orbitUp = () => { orbitRef.current = null; };

  const camTarget: [number, number, number] = view === 'figure' ? [0, 1.05, 0] : [0, 1.4, 0];
  const setRegion = (part: PartId, regionId: string, value: number) => {
    setDraft((d) => ({
      ...d,
      regions: { ...d.regions, [part]: { ...(d.regions[part] ?? {}), [regionId]: Math.abs(value) < 0.01 ? 0 : clamp(value, -1, 1) } },
    }));
  };

  // ── the surface ────────────────────────────────────────────────────────────
  return (
    <Row style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', backgroundColor: T.panelSolid }}>
      {/* ── left: roster + part tabs + the unwrap painter ── */}
      <ScrollView showScrollbar={true} style={{ width: EDITOR_W + 36, height: '100%' }}>
        <Col style={{ width: EDITOR_W + 28, padding: 14, gap: 10 }}>
          <Row style={{ gap: 8, alignItems: 'center' }}>
            <Text fontSize={15} color={T.ink} style={{ fontWeight: 900 }}>CHARACTERS</Text>
            <Box style={{ flexGrow: 1 }} />
            <Chip label="back to editor" onPress={props.onExit} />
          </Row>
          <Text fontSize={11} color={T.dim}>
            {status ?? (photo || draft.face
              ? 'paint depth — blue pushes out, orange carves in'
              : 'drop a face picture (or generate one), then paint depth over it')}
          </Text>

          {/* roster: every saved character, one click to load */}
          <ChipRow label="roster">
            {rosterState.order.length === 0 ? <Text fontSize={11} color={T.dim}>empty — save one</Text> : null}
            {rosterState.order.map((id) => (
              <Chip
                key={id}
                label={rosterState.characters[id]?.metadata?.title ?? id}
                active={draftId === id}
                color="good"
                onPress={() => loadFromRoster(id)}
              />
            ))}
            {draftId ? <Chip label="× remove" color="bad" onPress={() => removeFromRoster(draftId)} /> : null}
          </ChipRow>
          <Row style={{ gap: 8, alignItems: 'center' }}>
            <Text fontSize={11} color={T.dim} style={{ width: 52 }}>name</Text>
            <TextInput
              value={draftName}
              onChangeText={(text: string) => setDraftName(text)}
              fontSize={11}
              style={{ height: 28, width: 220, backgroundColor: '#0f172a', borderWidth: 1, borderColor: T.frame, borderRadius: 5, paddingLeft: 8, paddingRight: 8, color: T.ink }}
            />
            <Chip label="save" color="good" onPress={saveToRoster} />
            <Chip label="generate" color="good" onPress={generateWholeCharacter} />
            <Chip label="export .body" onPress={exportBody} />
          </Row>

          <Row style={{ gap: 6, alignItems: 'center' }}>
            {PART_IDS.map((id) => (
              <Chip key={id} label={PART_PRESETS[id].label} active={selPart === id} onPress={() => setSelPart(id)} />
            ))}
            <Box style={{ width: 10 }} />
            <Chip label="figure" active={view === 'figure'} color="good" onPress={() => setView((v) => (v === 'figure' ? 'part' : 'figure'))} />
          </Row>

          <ChipRow label="body">
            {(Object.keys(BODY_SHAPES) as BodyShapeId[]).map((id) => (
              <Chip key={id} label={BODY_SHAPES[id].label} active={draft.bodyShape === id} color="good" onPress={() => { setDraft((d) => ({ ...d, bodyShape: id })); setView('figure'); }} />
            ))}
          </ChipRow>
          <ChipRow label="clothes">
            {(Object.keys(CLOTHING) as ClothingId[]).map((id) => (
              <Chip key={id} label={CLOTHING[id].label} active={draft.clothing === id} color={CLOTHING[id].accent} onPress={() => { setDraft((d) => ({ ...d, clothing: id, bottoms: DEFAULT_BOTTOMS[id] })); setView('figure'); }} />
            ))}
          </ChipRow>
          <ChipRow label="bottoms">
            {(Object.keys(BOTTOMS) as BottomsId[]).map((id) => (
              <Chip key={id} label={BOTTOMS[id].label} active={draft.bottoms === id} color={BOTTOMS[id].accent} onPress={() => { setDraft((d) => ({ ...d, bottoms: id })); setView('figure'); }} />
            ))}
          </ChipRow>
          <ChipRow label="print">
            {(Object.keys(CLOTHING_SKINS) as ClothingSkinId[]).map((id) => (
              <Chip key={id} label={CLOTHING_SKINS[id].label} active={draft.clothingSkin === id} color={id === 'plain' ? 'good' : 'warn'} onPress={() => { setDraft((d) => ({ ...d, clothingSkin: id })); setView('figure'); }} />
            ))}
          </ChipRow>
          <ChipRow label="extras">
            {(Object.keys(CLOTHING_ACCESSORIES) as ClothingAccessoryId[]).map((id) => (
              <Chip
                key={id}
                label={CLOTHING_ACCESSORIES[id].label}
                active={draft.accessories.includes(id)}
                color="#a78bfa"
                onPress={() => {
                  setDraft((d) => {
                    const cur = d.accessories;
                    if (cur.includes(id)) return { ...d, accessories: cur.filter((x) => x !== id) };
                    const cleaned = id === 'cap' ? cur.filter((x) => x !== 'beanie') : id === 'beanie' ? cur.filter((x) => x !== 'cap') : cur;
                    return { ...d, accessories: cleaned.concat(id) };
                  });
                  setView('figure');
                }}
              />
            ))}
          </ChipRow>
          <ChipRow label="prop">
            <Chip label="none" active={draft.heldItem === 'none'} color="good" onPress={() => { setDraft((d) => ({ ...d, heldItem: 'none' })); setView('figure'); }} />
            {GAME_ITEMS.definitions.map((item) => (
              <Chip key={item.id} label={item.label} active={draft.heldItem === item.id} color={item.tone} onPress={() => { setDraft((d) => ({ ...d, heldItem: item.id })); setView('figure'); }} />
            ))}
          </ChipRow>
          <ChipRow label="rig">
            {(Object.keys(BODY_POSES) as BodyPoseId[]).map((id) => (
              <Chip key={id} label={BODY_POSES[id].label} active={draft.bodyPose === id} color="good" onPress={() => { setDraft((d) => ({ ...d, bodyPose: id })); setView('figure'); }} />
            ))}
            <Chip label={bodyRigAnim ? 'anim ■' : 'anim'} active={bodyRigAnim} color="good" onPress={() => { setBodyRigAnim((v) => !v); setView('figure'); }} />
            <Chip label="hitboxes" active={showHitboxes} color="cyan" onPress={() => { setShowHitboxes((v) => !v); setView('figure'); }} />
          </ChipRow>

          <Row style={{ gap: 8, alignItems: 'center' }}>
            <Text fontSize={11} color={T.dim} style={{ width: 52 }}>script</Text>
            <TextInput
              value={animScript}
              onChangeText={(text: string) => setAnimScript(text)}
              fontSize={11}
              style={{ height: 30, flexGrow: 1, backgroundColor: '#0f172a', borderWidth: 1, borderColor: timeline.error ? '#7f1d1d' : T.frame, borderRadius: 5, paddingLeft: 8, paddingRight: 8, color: T.ink }}
            />
            <Chip label={scriptPlaying ? 'play ■' : 'play'} active={scriptPlaying} color="good" onPress={() => { setScriptPlaying((v) => !v); setBodyRigAnim(false); setView('figure'); }} />
            <Chip label="reset" onPress={() => { setScriptFrame(0); setAnimScript(DEFAULT_ANIM_SCRIPT); }} />
          </Row>
          <ChipRow label="presets">
            {Object.entries(ANIM_PRESETS).map(([label, script]) => (
              <Chip
                key={label}
                label={label}
                active={animScript === script}
                color="#f97316"
                onPress={() => {
                  setAnimScript(script);
                  setScriptFrame(0);
                  setScriptPlaying(true);
                  setBodyRigAnim(false);
                  setView('figure');
                }}
              />
            ))}
          </ChipRow>

          {!isHead ? (
            <Row style={{ gap: 8, alignItems: 'center' }}>
              <Chip label="outline" active={editTab === 'outline'} onPress={() => setEditTab('outline')} />
              <Chip label="detail paint" active={editTab === 'detail'} onPress={() => setEditTab('detail')} />
              {editTab === 'outline' ? <Chip label="reset outline" onPress={resetOutline} /> : null}
            </Row>
          ) : (
            <>
              <Row style={{ gap: 8, alignItems: 'center' }}>
                <Text fontSize={11} color={T.dim} style={{ width: 52 }}>paint</Text>
                <Chip label="sculpt" active={paintTool === 'sculpt'} onPress={() => setPaintTool('sculpt')} />
                <Chip label="face color" active={paintTool === 'face'} color="warn" onPress={() => setPaintTool('face')} />
              </Row>
              {paintTool === 'face' ? (
                <ChipRow label="color">
                  <SwatchRow colors={TUNE.facePaints} active={facePaintColor} onPick={setFacePaintColor} />
                </ChipRow>
              ) : null}
            </>
          )}

          {/* ── the canvas: outline lathe OR unwrap painter ── */}
          {!isHead && editTab === 'outline' ? (
            <Pressable
              onLayout={(lr: any) => { canvasRect.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
              onMouseDown={onProfDown}
              onMouseMove={onProfMove}
              onMouseUp={onProfUp}
              style={{ width: EDITOR_W, height: EDITOR_H, borderWidth: 1, borderColor: T.frame, position: 'relative', backgroundColor: '#0a1322' }}
            >
              {draft.profiles[selPart].map((_p, i) => {
                const rowH = EDITOR_H / PROFILE_N;
                return (
                  <Box
                    key={i}
                    style={{ position: 'absolute', left: ('latch:' + profileLatchKey(selPart, i, 'left')) as any, top: i * rowH, width: ('latch:' + profileLatchKey(selPart, i, 'width')) as any, height: rowH - 1, backgroundColor: draft.skin, borderRadius: 4 }}
                  />
                );
              })}
              <Box style={{ position: 'absolute', left: EDITOR_W / 2 - 1, top: 0, width: 2, height: EDITOR_H, backgroundColor: T.frame }} />
            </Pressable>
          ) : (
            <Pressable
              onLayout={(lr: any) => { canvasRect.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
              onMouseDown={onPaintDown}
              onMouseMove={onPaintMove}
              onMouseUp={onPaintUp}
              style={{ width: EDITOR_W, height: EDITOR_H, borderWidth: 1, borderColor: T.frame, position: 'relative' }}
            >
              <UnwrapContent
                skin={draft.skin}
                photo={isHead ? photo : null}
                photoScale={photoScale}
                photoY={photoY}
                layers={isHead ? shownDoc?.layers ?? null : null}
                width={EDITOR_W}
                height={EDITOR_H}
              />
              <Effect
                shader={DEPTH_OVERLAY_WGSL}
                data={[0]}
                textures={[paints[selPart].id, relief.id]}
                style={{ position: 'absolute', left: 0, top: 0, width: EDITOR_W, height: EDITOR_H }}
              />
            </Pressable>
          )}

          {isHead || editTab === 'detail' ? (
            <>
              <Row style={{ gap: 8, alignItems: 'center' }}>
                <Chip label="raise" active={mode === 'raise'} onPress={() => setMode('raise')} />
                <Chip label="carve in" active={mode === 'lower'} color="#ff9445" onPress={() => setMode('lower')} />
                <Chip label="flatten" active={mode === 'flatten'} color="#94a3b8" onPress={() => setMode('flatten')} />
              </Row>
              {isHead && paintTool === 'face' ? (
                <Row style={{ gap: 8, alignItems: 'center' }}>
                  <Chip label="mirror" active={mirror} onPress={() => setMirror((v) => !v)} />
                  {draft.face && draft.face.layers.some((l) => l.id.startsWith('paint-')) ? (
                    <Chip label="undo paint" color="warn" onPress={removeLastPaintLayer} />
                  ) : null}
                </Row>
              ) : (
                <Row style={{ gap: 8, alignItems: 'center' }}>
                  <Chip label="fill" onPress={fillAll} />
                  <Chip label="soften" onPress={soften} />
                  <Chip label="mirror" active={mirror} onPress={() => setMirror((v) => !v)} />
                  <Chip label="clear" onPress={clearStrokes} />
                </Row>
              )}
            </>
          ) : null}

          {isHead ? (
            <Row style={{ gap: 8, alignItems: 'center' }}>
              <Chip label="generate face" color="good" onPress={generateFaceOnly} />
              <Chip label="export .hed" onPress={exportHead} />
              {draft.face ? <Chip label="remove face" onPress={() => { setDraft((d) => ({ ...d, face: null })); setAnim(null); setStatus(null); }} /> : null}
            </Row>
          ) : null}
          {isHead && draft.face ? (
            <ChipRow label="animate">
              {(['talk', 'chew', 'cry', 'yell'] as HedAnimation[]).map((a) => (
                <Chip key={a} label={anim === a ? `${a} ■` : a} active={anim === a} color="good" onPress={() => setAnim((cur) => (cur === a ? null : a))} />
              ))}
            </ChipRow>
          ) : null}

          <ChipRow label="skin">
            <SwatchRow colors={DRAFT_DEFAULTS.skins} active={draft.skin} onPick={(skin) => setDraft((d) => ({ ...d, skin }))} />
          </ChipRow>

          <Knob label="brush size" value={brush} spec={TUNE.knobs.brush} onChange={setBrush} />
          <Knob label="strength" value={strength} spec={TUNE.knobs.strength} onChange={setStrength} />
          <Knob label="depth amount" value={draft.amount} spec={TUNE.knobs.amount} onChange={(amount) => setDraft((d) => ({ ...d, amount }))} />
          {isHead ? (
            <>
              <Knob label="skull stretch" value={draft.headScaleY} spec={TUNE.knobs.skull} onChange={(headScaleY) => setDraft((d) => ({ ...d, headScaleY }))} />
              <Knob label="photo size" value={photoScale} spec={TUNE.knobs.photoScale} onChange={setPhotoScale} />
              <Knob label="photo up/down" value={photoY} spec={TUNE.knobs.photoY} onChange={setPhotoY} />
            </>
          ) : null}

          <Col style={{ gap: 6, paddingTop: 4 }}>
            <Row style={{ gap: 8, alignItems: 'center' }}>
              <Text fontSize={11} color={T.dim} style={{ width: 84 }}>region shape</Text>
              <Chip label="reset" onPress={() => setDraft((d) => ({ ...d, regions: { ...d.regions, [selPart]: {} } }))} />
            </Row>
            {SHAPE_REGIONS[selPart].map((region) => (
              <RegionSliderRow
                key={`${selPart}.${region.id}`}
                keyBase={`chr.${selPart}.${region.id}`}
                label={region.label}
                value={draft.regions[selPart]?.[region.id] ?? 0}
                onCommit={(value) => setRegion(selPart, region.id, value)}
              />
            ))}
          </Col>
        </Col>
      </ScrollView>

      {/* ── right: the selected part, or the assembled figure ── */}
      <Pressable
        onMouseDown={orbitDown}
        onMouseMove={orbitMove}
        onMouseUp={orbitUp}
        style={{ flexGrow: 1, height: '100%', position: 'relative', overflow: 'hidden' }}
      >
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={T.panelSolid} showGrid={false} showAxes={false}>
          <OrbitCamera target={camTarget} yaw={yaw} pitch={pitch} dist={dist} fov={45} />
          <LabEnvironment preset="studio" />
          <PartMeshes view={view} selPart={selPart} parts={partRender} rig={rig} showHitboxes={showHitboxes} />
          {view === 'figure' && draft.heldItem !== 'none' ? <HeldItemMeshes itemId={draft.heldItem} rig={rig} /> : null}
        </Scene3D>
        <Box style={{ position: 'absolute', right: 14, bottom: 14 }}>
          <Knob label="zoom" value={dist} spec={TUNE.knobs.zoom} onChange={setDist} />
        </Box>
      </Pressable>

      {/* offscreen: per-part GPU paint textures + the texture-capture stack.
          Paintables MUST sit outside the flex flow — a bare host node here
          takes proportional-fallback space and blows up the layout. */}
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
        photo={photo}
        photoScale={photoScale}
        photoY={photoY}
        layers={shownDoc?.layers ?? null}
        clothing={draft.clothing}
        bottoms={draft.bottoms}
        bodyShape={draft.bodyShape}
        parts={PART_IDS}
      />
    </Row>
  );
}
