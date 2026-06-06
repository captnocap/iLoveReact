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
import { useIFTTT } from '@reactjit/runtime/hooks/useIFTTT';
import { readFile, writeFile, mkdir } from '@reactjit/runtime/hooks/fs';
import { GAME_CAMERA } from '../../game/camera';
import { GAME_NATIVE_CAMERA } from '../../game/nativeCamera';
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
import { mintCharacterId } from './roster';
import { charactersStream, type CharactersEvent, type CharactersStreamState } from '../../game/figure/stream';
import { editorChannel } from '../store';
import { editorSessions, type RouteSession } from '../sessions';
import { useRouteTwigState } from '../twigs';
import { PAINT } from '../paint';
import {
  DEPTH_OVERLAY_WGSL, PAINT_EDITOR_TUNING, bytesFromGrid, editorPartParams, gridFromBytes,
  headTextureKey, partDynKey, reliefBytesFromGrid, sculptModeValue, skinTextureKey,
  type SculptMode,
} from './paintKit';
import { ChipRow, RegionSliderRow, SwatchRow } from './controls';
import { CharacterEditorCaptures, GrabGridCapture, GrabGridMeshes, GrabMarker, HeldItemMeshes, PartMeshes, UnwrapContent, type GrabMarkerInfo, type Photo, type PreviewView } from './preview';
import {
  GRAB_TUNING, applyGrabStamp, buildGrabClouds, grabDragAxis, grabInstancesFor, grabPointWorld, gridDeltaFor,
  pickGrab, screenAxisFor, stampRadiusUv, stampWorldRadius,
  type GrabCloud, type GrabHit, type GrabInstance, type ScreenAxis,
} from './grabKit';
import { ANIM_PRESETS, DEFAULT_ANIM_SCRIPT } from './animPresets';
// MODELPAINT-0605: the deep-link mailbox into /cutout's model targets
import { setPendingModelTarget } from '../cutout/models';

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

// MODELPAINT-0605: the coupled color+depth face-paint tool is DELETED, by
// ruling ("i dont want to paint depth, i want to paint their face though") —
// texture painting lives in /cutout; this route keeps SCULPT (geometry).
type EditTab = 'outline' | 'detail';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function setLatch(key: string, value: number): void {
  const fn = (globalThis as any).__latchSet;
  if (typeof fn === 'function') fn(key, value);
}

export function CharactersRoute(props: { onExit: () => void; onPaintTexture?: () => void }) {
  // ── the character being authored + session state ──────────────────────────
  const [draft, setDraft] = useState<CharacterDraft>(emptyDraft);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('new character');
  const [rosterRev, setRosterRev] = useState(0);
  const [selPart, setSelPart] = useRouteTwigState<PartId>('/characters', 'selPart', 'head');
  const [view, setView] = useRouteTwigState<PreviewView>('/characters', 'view', 'part');
  const [editTab, setEditTab] = useRouteTwigState<EditTab>('/characters', 'editTab', 'outline');
  const [mode, setMode] = useRouteTwigState<SculptMode>('/characters', 'sculptMode', 'raise');
  const [mirror, setMirror] = useRouteTwigState('/characters', 'mirror', true);
  const [brush, setBrush] = useRouteTwigState('/characters', 'brush', 14);
  const [strength, setStrength] = useRouteTwigState('/characters', 'strength', 0.5);
  const [photo, setPhoto] = useRouteTwigState<Photo | null>('/characters', 'photo', null);
  const [photoScale, setPhotoScale] = useRouteTwigState('/characters', 'photoScale', 0.4);
  const [photoY, setPhotoY] = useRouteTwigState('/characters', 'photoY', 0);
  const [showHitboxes, setShowHitboxes] = useRouteTwigState('/characters', 'showHitboxes', false);
  const [anim, setAnim] = useRouteTwigState<HedAnimation | null>('/characters', 'faceAnim', null);
  const [animFrame, setAnimFrame] = useState(0);
  const [bodyRigAnim, setBodyRigAnim] = useRouteTwigState('/characters', 'bodyRigAnim', false);
  const [rigFrame, setRigFrame] = useState(0);
  const [animScript, setAnimScript] = useRouteTwigState('/characters', 'animScript', DEFAULT_ANIM_SCRIPT);
  const [scriptPlaying, setScriptPlaying] = useRouteTwigState('/characters', 'scriptPlaying', false);
  const [scriptFrame, setScriptFrame] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  // zoom is a KNOB (param-rate); yaw/pitch live in lookRef — drag deltas ride
  // the native controller (V23), never React state
  const [dist, setDist] = useRouteTwigState('/characters', 'orbitDistance', 4.2);
  // per-part sculpt versions — bumping regenerates that part's dyn mesh
  const [seqs, setSeqs] = useState<Record<PartId, number>>(
    () => Object.fromEntries(PART_IDS.map((id) => [id, 0])) as Record<PartId, number>,
  );

  const paintingRef = useRef(false);
  // the shared painter's input plumbing: gap-free interpolated sculpt dabs
  // (mirror riding the engine)
  const strokeEngineRef = useRef<ReturnType<typeof PAINT.createStrokeEngine> | null>(null);
  const profileDraftRef = useRef<number[] | null>(null);
  const canvasRect = useRef({ x: 0, y: 0, width: EDITOR_W, height: EDITOR_H });
  const orbitRef = useRef<{ x: number; y: number } | null>(null);
  // ── direct mesh grabbing (GRABSHAPE-0605) — see grabKit.ts ────────────────
  // hover state is the ONLY React state per pick: it changes when the snapped
  // cell changes, not per mousemove; the drag itself lives in grabRef and
  // re-sculpts on a throttle (the live grid rides setPartGrid — the SAME truth
  // the paint canvas edits).
  const [grabHover, setGrabHover] = useState<
    { part: PartId; instanceIndex: number; gx: number; gy: number; cu: number; cv: number; grabRadius: number; state: 'hover' | 'raise' | 'carve' } | null
  >(null);
  // the wireframe lattice over the selected part — every line crossing is a
  // pullable grid point (GRABGRID-0605)
  const [showGrabGrid, setShowGrabGrid] = useRouteTwigState('/characters', 'showGrabGrid', true);
  const viewRect = useRef({ x: 0, y: 0, width: 1, height: 1 });
  const grabCloudsRef = useRef<{ sig: unknown[]; clouds: GrabCloud[]; instances: GrabInstance[] } | null>(null);
  const grabRef = useRef<null | {
    hit: GrabHit; baseGrid: number[]; axis: ScreenAxis;
    startX: number; startY: number; delta: number; rx: number; ry: number;
    lastSync: number; timer: ReturnType<typeof setTimeout> | null; applied: boolean;
  }>(null);
  // V23 native camera: the route's own Scene3D.Camera node (nativeCamera prop
  // binds it host-side; the ref's id keys the per-node param/delta channel)
  const cameraRef = useRef<any>(null);
  const camCtlRef = useRef<ReturnType<typeof GAME_NATIVE_CAMERA.forNode> | null>(null);
  const [orbitLook, setOrbitLook] = useRouteTwigState('/characters', 'orbitLook', { yaw: 20, pitch: 12 });
  const lookRef = useRef(orbitLook);

  // ── the V20 roster channel + this visit's SESSION (persistence from version
  // one; every authoring interaction is a labeled commit/note on the one
  // cross-channel undo chain — the vehicles-route pattern) ───────────────────
  const live = useMemo(() => {
    try {
      const channel = editorChannel(charactersStream);
      return { channel, session: editorSessions().open('/characters', channel) as RouteSession<CharactersEvent>, error: null as string | null };
    } catch (e) {
      return { channel: null, session: null, error: String(e) };
    }
  }, []);
  useEffect(() => () => live.session?.close(), [live]);
  const rosterState: CharactersStreamState = useMemo(
    () => live.channel?.state() ?? { characters: {}, order: [] },
    [live, rosterRev],
  );

  // ── AUTOSAVE-0605 (V20: "saved at every micro change") ────────────────────
  // Every draft mutation auto-commits the resulting document to the characters
  // channel, debounced — the route is STATELESS: a hot reload, route switch,
  // or crash costs at most the debounce window, and each autosave is its own
  // labeled undo position on the one chain. installDraft (load/import/restore)
  // arms the skip flag so restoring content never re-commits it unchanged.
  const draftRef = useRef(draft); draftRef.current = draft;
  const draftIdRef = useRef(draftId); draftIdRef.current = draftId;
  const draftNameRef = useRef(draftName); draftNameRef.current = draftName;
  const autosaveSkipRef = useRef(true); // the mount render never autosaves
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (autosaveSkipRef.current) { autosaveSkipRef.current = false; return; }
    if (!live.session) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      autosaveTimer.current = null;
      const id = draftIdRef.current ?? mintCharacterId();
      if (!draftIdRef.current) setDraftId(id);
      live.session!.commit(
        { kind: 'authored', id, doc: draftToDocument(draftRef.current, draftNameRef.current) },
        `autosave · ${draftNameRef.current}`,
      );
      setRosterRev((r) => r + 1);
    }, TUNE.autosaveDebounceMs);
  }, [draft]);
  useEffect(() => () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); }, []);

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

  /** Replace the whole draft + sync every paint texture and mesh slot.
   *  Installing restored/imported content arms the autosave skip — restoring
   *  is not an edit; re-committing identical content would churn the chain. */
  const installDraft = (next: CharacterDraft) => {
    autosaveSkipRef.current = true;
    setDraft(next);
    for (const id of PART_IDS) uploadGrid(id, next.grids[id]);
    bumpAllSeqs();
  };

  // ── UNDO/REDO (GRABQOL-0605): the shared painter's history over the DRAFT ──
  // The within-tool stack (editors/paint createPaintHistory: 50-deep, 250ms
  // coalesce) — every commit-grade interaction pushes the BEFORE state, ctrl+z
  // walks back, ctrl+y / ctrl+shift+z walks forward. Restores route through
  // installDraft (textures + mesh slots resync) and DO autosave: the restored
  // state becomes the working draft on the V20 chain. The session log stays
  // the cross-visit history; this stack is what makes sculpting feel safe.
  const history = useRef(PAINT.createPaintHistory<CharacterDraft>()).current;
  const snapDraft = () => JSON.parse(JSON.stringify(draftRef.current)) as CharacterDraft;
  /** a discrete undoable edit (chip picks, resets, stroke/drag releases) */
  const editDraft = (updater: (d: CharacterDraft) => CharacterDraft) => {
    history.commit(snapDraft);
    setDraft(updater);
  };
  /** knob-style bursts coalesce — undo returns to the value before the drag */
  const editDraftCoalesced = (updater: (d: CharacterDraft) => CharacterDraft) => {
    history.commitCoalesced(snapDraft);
    setDraft(updater);
  };
  const restoreDraft = (state: CharacterDraft | null, label: string) => {
    if (!state) { setStatus(`nothing to ${label}`); return; }
    installDraft(state);
    autosaveSkipRef.current = false; // the restored state IS the working draft now
    setStatus(label);
    live.session?.note(label);
  };
  const undoDraft = () => restoreDraft(history.undo(snapDraft), 'undo');
  const redoDraft = () => restoreDraft(history.redo(snapDraft), 'redo');
  useIFTTT('key:ctrl+z', undoDraft);
  useIFTTT('key:ctrl+y', redoDraft);
  useIFTTT('key:ctrl+shift+z', redoDraft);

  // ── AUTOSAVE-0605 mount restore (V20 "stateless design"): reopen the route
  // exactly where authoring left off — the most recent roster entry IS the
  // working draft (the autosave keeps it current, so last-on-the-chain =
  // last-touched). A roster with no entries boots the blank draft. ──────────
  useEffect(() => {
    const lastId = rosterState.order[rosterState.order.length - 1];
    const doc = lastId ? rosterState.characters[lastId] : null;
    if (!doc) return;
    installDraft(draftFromDocument(doc));
    setDraftId(lastId);
    setDraftName(doc.metadata?.title ?? lastId);
    setStatus(`restored "${doc.metadata?.title ?? lastId}" — the draft autosaves as you work`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount restore only
  }, []);

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
  // MODELPAINT-0605: a painted part's overlay stamp folds into its key, so
  // /cutout saves re-bake exactly the affected captures and nothing else.
  const paintStamp = (id: PartId) => (draft.paint?.[id] ? `.p${draft.paint[id]!.stamp}` : '');
  const headTexKey = headTextureKey({
    photoStamp: photo?.stamp ?? null, faceId, anim: activeAnim ?? 'still', phase,
    skin: draft.skin, photoScale, photoY,
  }) + paintStamp('head');
  const skinTexKeyFor = (id: PartId) =>
    skinTextureKey(id, { skin: draft.skin, clothing: draft.clothing, bottoms: draft.bottoms, bodyShape: draft.bodyShape }) + paintStamp(id);

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
  }, [regionedGrids, headDisplace, seqs, draft.profiles, faceId, activeAnim, phase, draft.amount, draft.headScaleY, draft.skin, headTexKey, draft.clothing, draft.bottoms, draft.bodyShape, draft.regions, draft.paint]);

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

  // Sculpt dabs ride the shared stroke engine (editors/paint): gap-free
  // interpolation between pointer samples + pressure→radius + mirror twins
  // across the front meridian. At the no-pressure fallback the engine's
  // radius equals `brush` exactly (the hand-off's fidelity law).
  const dab = (sx: number, sy: number, pressure?: number) => {
    const engine = strokeEngineRef.current;
    if (!engine) return;
    const r = canvasRect.current;
    const tx = ((sx - r.x) / r.width) * PAINT_W;
    const ty = ((sy - r.y) / r.height) * PAINT_H;
    const value = sculptModeValue(mode, strength);
    for (const d of engine.move(tx, ty, pressure)) {
      paints[selPart].paint.circle(d.x, d.y, d.radius, value);
    }
  };

  // (the face-paint stroke — color+depth as one .hed layer — is DELETED per
  // the MODELPAINT-0605 ruling; face/body TEXTURE painting lives in /cutout)
  const paintTextureInCutout = () => {
    if (!draftId) { setStatus('save to the roster first — /cutout paints the SAVED character'); return; }
    setPendingModelTarget({ family: 'figure', docId: draftId, part: selPart });
    live.session?.note(`paint texture → /cutout · ${draftId} · ${selPart}`);
    props.onPaintTexture?.();
  };

  const syncGrid = () => {
    const bytes = paints[selPart].paint.readback();
    if (!bytes || bytes.length < PAINT_W * PAINT_H) return;
    setPartGrid(selPart, gridFromBytes(bytes));
  };

  const onPaintDown = (e: any) => {
    paintingRef.current = true;
    const sx = Number(e?.x ?? 0), sy = Number(e?.y ?? 0);
    strokeEngineRef.current = PAINT.createStrokeEngine({ brushPx: brush, mirrorAxisX: mirror ? PAINT_W / 2 : null });
    strokeEngineRef.current.begin();
    dab(sx, sy, Number(e?.pressure) || undefined);
  };
  const onPaintMove = (e: any) => {
    if (!paintingRef.current) return;
    const sx = Number(e?.x ?? 0), sy = Number(e?.y ?? 0);
    dab(sx, sy, Number(e?.pressure) || undefined);
  };
  const onPaintUp = () => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    {
      strokeEngineRef.current?.end();
      strokeEngineRef.current = null;
      history.commit(snapDraft); // the draft mutates HERE (release readback)
      syncGrid();
      live.session?.note(`sculpt stroke · ${mode} · ${brush}px · ${selPart}`);
    }
  };

  const fillAll = () => {
    history.commit(snapDraft);
    const value = sculptModeValue(mode, strength);
    paints[selPart].paint.clear(value);
    setPartGrid(selPart, new Array(GRID_W * GRID_H).fill((value - NEUTRAL) * 2));
    live.session?.note(`fill · ${mode} · ${selPart}`);
  };

  const soften = () => {
    const src = paints[selPart].paint.readback();
    if (!src || src.length < PAINT_W * PAINT_H) return;
    history.commit(snapDraft);
    const out = PAINT.soften3x3(src, PAINT_W, PAINT_H);
    paints[selPart].paint.upload(out);
    setPartGrid(selPart, gridFromBytes(out));
    live.session?.note(`soften · ${selPart}`);
  };

  const clearStrokes = () => {
    history.commit(snapDraft);
    paints[selPart].paint.clear(NEUTRAL);
    setPartGrid(selPart, emptyGrid());
    live.session?.note(`clear sculpt · ${selPart}`);
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
      editDraft((d) => ({ ...d, profiles: { ...d.profiles, [selPart]: next } }));
      bumpSeq(selPart);
      live.session?.note(`outline drag · ${selPart}`);
    }
  };
  const resetOutline = () => {
    editDraft((d) => ({ ...d, profiles: { ...d.profiles, [selPart]: defaultProfile(selPart) } }));
    bumpSeq(selPart);
  };

  // ── generation / documents / roster ────────────────────────────────────────
  const applyFaceDoc = (doc: HedDocument, label: string) => {
    history.commit(snapDraft);
    const next = draftWithFace(draft, doc);
    installDraft(next);
    autosaveSkipRef.current = false; // new content (generated/imported face) — autosave it
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
    history.commit(snapDraft);
    installDraft(next);
    autosaveSkipRef.current = false; // a generated character is authored content — autosave it
    setDraftId(null); // a NEW character, not an overwrite of the loaded one
    setDraftName(`character ${seed.toString(36)}`);
    setSelPart('head');
    setView('figure');
    setBodyRigAnim(false);
    setStatus(`generated character ${seed} — ${BODY_SHAPES[next.bodyShape].label}, ${CLOTHING[next.clothing].label} + ${BOTTOMS[next.bottoms].label}`);
  };

  const saveToRoster = () => {
    if (!live.session) { setStatus(`save unavailable — ${live.error ?? 'no session'}`); return; }
    const id = draftId ?? mintCharacterId();
    const doc = draftToDocument(draft, draftName);
    // the full V20 deal: the document event on the characters channel + a
    // labeled session commit marker + fresh snapshots, in one interaction
    live.session.commit({ kind: 'authored', id, doc }, `${draftName}: saved`);
    setDraftId(id);
    setRosterRev((r) => r + 1);
    setStatus(`saved "${draftName}" to the roster + snapshot (the game's view is fresh)`);
  };

  const loadFromRoster = (id: string) => {
    const doc = rosterState.characters[id];
    if (!doc) return;
    history.commit(snapDraft);
    installDraft(draftFromDocument(doc));
    setDraftId(id);
    setDraftName(doc.metadata?.title ?? id);
    setView('figure');
    setStatus(`loaded "${doc.metadata?.title ?? id}" from the roster`);
  };

  const removeFromRoster = (id: string) => {
    if (!live.session) return;
    live.session.commit({ kind: 'removed', id }, `${id}: removed`);
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
      history.commit(snapDraft);
      installDraft(draftFromDocument(doc));
      autosaveSkipRef.current = false; // imported content is not on the chain yet — autosave it
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

  // ── orbit — V23: THE CAMERA IS NOT JAVASCRIPT ──────────────────────────────
  // The host (framework/game/camera.zig) owns per-frame solve/smoothing of the
  // route's own camera node (per-node channel, da1730e24). JS sends params on
  // CHANGE (view target, zoom knob) and deltas per drag move; idle frames send
  // nothing and a drag never re-renders the cart.
  const camTarget: [number, number, number] = view === 'figure' ? [0, 1.05, 0] : [0, 1.4, 0];

  const sendOrbit = (target: [number, number, number], distance: number) => {
    const l = lookRef.current;
    camCtlRef.current?.setOrbit({ target, yaw: l.yaw, pitch: l.pitch, distance, fov: 45 });
  };

  // Engage: params ride the node id from the camera ref (the nativeCamera prop
  // already bound it host-side at CREATE). Disable on unmount returns the node
  // to the declarative JS-props path.
  useEffect(() => {
    const nodeId = Number(cameraRef.current?.id ?? 0);
    if (!nodeId) {
      console.warn('[characters] native camera not engaged — camera node id unavailable (rebuild the host with has-game-camera?)');
      return;
    }
    const ctl = GAME_NATIVE_CAMERA.forNode(nodeId);
    camCtlRef.current = ctl;
    ctl.setOrbit({ target: camTarget, yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, distance: dist, fov: 45 });
    ctl.setMode('orbit');
    return () => {
      camCtlRef.current = null;
      ctl.disable();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- engage once; param changes ride the effect below
  }, []);

  // Param changes (view toggle moves the target, the zoom knob moves distance)
  // re-send the rig params; yaw/pitch ride along from the ref unchanged.
  useEffect(() => { sendOrbit(camTarget, dist); }, [view, dist]);

  const orbitDown = (e: any) => { orbitRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; };
  const orbitMove = (e: any) => {
    const d = orbitRef.current;
    if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    const dx = nx - d.x, dy = ny - d.y;
    d.x = nx; d.y = ny;
    // Horizontal sign: the engine renders world +X as screen-LEFT and the rig
    // uses compass yaw, so yaw DECREASES with a rightward drag (the /test
    // USER-VERDICT-pinned sign). Clamps apply HERE so the JS shadow and the
    // host accumulate identically — only the post-clamp delta is sent.
    const l = lookRef.current;
    const nextYaw = l.yaw - dx * TUNE.orbit.yawPerPx;
    const nextPitch = clamp(l.pitch - dy * TUNE.orbit.pitchPerPx, TUNE.orbit.pitchMin, TUNE.orbit.pitchMax);
    camCtlRef.current?.setInputDeltas(nextYaw - l.yaw, nextPitch - l.pitch);
    l.yaw = nextYaw;
    l.pitch = nextPitch;
  };
  const orbitUp = () => {
    setOrbitLook({ ...lookRef.current });
    orbitRef.current = null;
  };

  // ── zoom (GRABQOL-0605): bigger number = CLOSER, and the wheel dollies ────
  // The knob shows a true zoom value (the distance REFLECTED across the spec
  // range) so + always moves in — editing raw distance read backwards. The
  // wheel rides the raw onScroll fallback (events.zig hitTestScroll: a
  // non-scrolling node's onScroll gets the wheel delta — built for exactly
  // this camera-dolly case); wheel up = in, one knob step per notch.
  const ZOOM_REFLECT = TUNE.knobs.zoom.min + TUNE.knobs.zoom.max;
  const zoomTo = (d: number) => setDist(clamp(d, TUNE.knobs.zoom.min, TUNE.knobs.zoom.max));
  const onZoomWheel = (e: any) => {
    const notches = Number(e?.deltaY ?? 0);
    if (notches) zoomTo(dist - notches * TUNE.knobs.zoom.step);
  };

  // The DECLARATIVE camera is the boot frame only — static props, so React
  // never sends camera UPDATEs after mount; the host writes the node fields
  // every frame once engaged.
  const [bootCam] = useState(() =>
    GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, {
      target: [0, 1.4, 0],
      yaw: lookRef.current.yaw,
      pitch: lookRef.current.pitch,
      dist: 4.2,
      fov: 45,
    }));
  // ── grab — see where you can grab, then pull the shape (GRABSHAPE-0605) ───
  // Picking solves the orbit rig from the JS shadow (lookRef/dist/camTarget) —
  // the SAME params the V23 host camera renders from (registry pure math is
  // sanctioned; the host owns per-frame driving). A grab stamps regions.ts's
  // ellipse into draft.grids[part] — the identical grid the depth-paint
  // canvas edits, so drags and paint strokes compose on one truth.
  const solvedCam = () =>
    GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, {
      target: camTarget, yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, dist, fov: 45,
    });
  const partParamsFor = (id: PartId) => partRender[id].params as any;

  // lazy clouds: built on first pick after (view/part/mesh/pose) change —
  // a drag invalidates them every sync tick but never picks, so the rebuild
  // cost lands once, on the next hover.
  const grabClouds = () => {
    const sig: unknown[] = [view, selPart, partRender, rig];
    const cached = grabCloudsRef.current;
    if (cached && cached.sig.length === sig.length && cached.sig.every((v, i) => v === sig[i])) return cached;
    const instances = grabInstancesFor(view, selPart, rig.assembly);
    const next = { sig, clouds: buildGrabClouds(instances, partParamsFor), instances };
    grabCloudsRef.current = next;
    return next;
  };

  const pickAt = (sx: number, sy: number) => {
    const r = viewRect.current;
    const { clouds, instances } = grabClouds();
    const rect = { x: 0, y: 0, width: r.width, height: r.height };
    return { hit: pickGrab(sx - r.x, sy - r.y, rect, solvedCam(), clouds), instances };
  };

  const hoverMove = (e: any) => {
    const { hit } = pickAt(Number(e?.x ?? 0), Number(e?.y ?? 0));
    setGrabHover((cur) => {
      if (!hit) return cur === null ? cur : null;
      if (cur && cur.part === hit.part && cur.instanceIndex === hit.instanceIndex && cur.gx === hit.gx && cur.gy === hit.gy && cur.state === 'hover') return cur;
      return { part: hit.part, instanceIndex: hit.instanceIndex, gx: hit.gx, gy: hit.gy, cu: hit.cu, cv: hit.cv, grabRadius: hit.grabRadius, state: 'hover' };
    });
  };

  const startGrab = (hit: GrabHit, instances: GrabInstance[], e: any) => {
    // grabbing a part in figure view selects it — the unwrap canvas snaps to
    // the same part (two views over one truth, made visible)
    if (view === 'figure' && hit.part !== selPart) setSelPart(hit.part);
    const inst = instances[hit.instanceIndex];
    const r = viewRect.current;
    const axisWorld = grabDragAxis(hit, partParamsFor(hit.part), inst);
    const axis = screenAxisFor(hit.world, axisWorld, { x: 0, y: 0, width: r.width, height: r.height }, solvedCam());
    const { rx, ry } = stampRadiusUv(brush, PAINT_W);
    grabRef.current = {
      hit, baseGrid: draft.grids[hit.part].slice(), axis,
      startX: Number(e?.x ?? 0), startY: Number(e?.y ?? 0), delta: 0, rx, ry,
      lastSync: 0, timer: null, applied: false,
    };
    setGrabHover({ part: hit.part, instanceIndex: hit.instanceIndex, gx: hit.gx, gy: hit.gy, cu: hit.cu, cv: hit.cv, grabRadius: hit.grabRadius, state: 'raise' });
  };

  const applyGrabLive = () => {
    const g = grabRef.current;
    if (!g) return;
    g.lastSync = Date.now();
    g.applied = true;
    setPartGrid(g.hit.part, applyGrabStamp(g.baseGrid, g.hit.cu, g.hit.cv, g.rx, g.ry, g.delta, mirror));
    setGrabHover((cur) => (cur ? { ...cur, state: g.delta < 0 ? 'carve' : 'raise' } : cur));
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
        setPartGrid(g.hit.part, g.baseGrid);
        uploadGrid(g.hit.part, g.baseGrid);
      }
    } else {
      // the undo entry is the PRE-DRAG state (live ticks already moved the
      // draft, so a plain snapshot would capture mid-drag — swap the base in)
      history.commit(() => {
        const pre = snapDraft();
        pre.grids[g.hit.part] = g.baseGrid.slice();
        return pre;
      });
      const final = applyGrabStamp(g.baseGrid, g.hit.cu, g.hit.cv, g.rx, g.ry, g.delta, mirror);
      setPartGrid(g.hit.part, final);
      // ONE-TRUTH compose law: the paint texture must carry the dragged grid,
      // or the next paint stroke's release readback would clobber the drag
      uploadGrid(g.hit.part, final);
      live.session?.note(`grab drag · ${g.hit.part} · cell ${g.hit.gx},${g.hit.gy} · ${g.delta > 0 ? 'raise' : 'carve'} ${Math.abs(g.delta).toFixed(2)}`);
    }
    setGrabHover((cur) => (cur ? { ...cur, state: 'hover' } : cur));
  };

  // grab beats orbit on the same Pressable: mousedown ON the mesh grabs,
  // anywhere else orbits; idle moves drive the hover affordance
  const previewDown = (e: any) => {
    const { hit, instances } = pickAt(Number(e?.x ?? 0), Number(e?.y ?? 0));
    if (hit) startGrab(hit, instances, e);
    else orbitDown(e);
  };
  const previewMove = (e: any) => {
    if (grabRef.current) { grabMove(e); return; }
    if (orbitRef.current) { orbitMove(e); return; }
    hoverMove(e);
  };
  const previewUp = () => {
    if (grabRef.current) endGrab();
    else orbitUp();
  };

  // The marker derives its world position from the CURRENT mesh params at
  // render time, so it sits on the rendered skin and rides the surface as a
  // drag pulls it (never a stale pick-time snapshot).
  const grabMarker: GrabMarkerInfo | null = useMemo(() => {
    if (!grabHover) return null;
    const instances = grabInstancesFor(view, selPart, rig.assembly);
    const inst = instances[grabHover.instanceIndex];
    if (!inst || inst.part !== grabHover.part) return null;
    const params = partRender[grabHover.part].params as any;
    return {
      world: grabPointWorld(params, inst, grabHover.cu, grabHover.cv) as [number, number, number],
      grabRadius: grabHover.grabRadius,
      stampWorldRadius: stampWorldRadius(params, inst, grabHover.cu, grabHover.cv, stampRadiusUv(brush, PAINT_W).rx),
      state: grabHover.state,
    };
  }, [grabHover, partRender, rig, view, selPart, brush]);

  const setRegion = (part: PartId, regionId: string, value: number) => {
    editDraftCoalesced((d) => ({
      ...d,
      regions: { ...d.regions, [part]: { ...(d.regions[part] ?? {}), [regionId]: Math.abs(value) < 0.01 ? 0 : clamp(value, -1, 1) } },
    }));
    live.session?.note(`region · ${regionId} ${value.toFixed(2)} · ${part}`);
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
              ? 'paint depth — blue pushes out, orange carves in · or hover the 3D side and grab the mesh'
              : 'drop a face picture (or generate one), then paint depth over it — or grab the mesh in 3D and pull')}
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
              <Chip key={id} label={BODY_SHAPES[id].label} active={draft.bodyShape === id} color="good" onPress={() => { editDraft((d) => ({ ...d, bodyShape: id })); setView('figure'); }} />
            ))}
          </ChipRow>
          <ChipRow label="clothes">
            {(Object.keys(CLOTHING) as ClothingId[]).map((id) => (
              <Chip key={id} label={CLOTHING[id].label} active={draft.clothing === id} color={CLOTHING[id].accent} onPress={() => { editDraft((d) => ({ ...d, clothing: id, bottoms: DEFAULT_BOTTOMS[id] })); setView('figure'); }} />
            ))}
          </ChipRow>
          <ChipRow label="bottoms">
            {(Object.keys(BOTTOMS) as BottomsId[]).map((id) => (
              <Chip key={id} label={BOTTOMS[id].label} active={draft.bottoms === id} color={BOTTOMS[id].accent} onPress={() => { editDraft((d) => ({ ...d, bottoms: id })); setView('figure'); }} />
            ))}
          </ChipRow>
          <ChipRow label="print">
            {(Object.keys(CLOTHING_SKINS) as ClothingSkinId[]).map((id) => (
              <Chip key={id} label={CLOTHING_SKINS[id].label} active={draft.clothingSkin === id} color={id === 'plain' ? 'good' : 'warn'} onPress={() => { editDraft((d) => ({ ...d, clothingSkin: id })); setView('figure'); }} />
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
                  editDraft((d) => {
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
            <Chip label="none" active={draft.heldItem === 'none'} color="good" onPress={() => { editDraft((d) => ({ ...d, heldItem: 'none' })); setView('figure'); }} />
            {GAME_ITEMS.definitions.map((item) => (
              <Chip key={item.id} label={item.label} active={draft.heldItem === item.id} color={item.tone} onPress={() => { editDraft((d) => ({ ...d, heldItem: item.id })); setView('figure'); }} />
            ))}
          </ChipRow>
          <ChipRow label="rig">
            {(Object.keys(BODY_POSES) as BodyPoseId[]).map((id) => (
              <Chip key={id} label={BODY_POSES[id].label} active={draft.bodyPose === id} color="good" onPress={() => { editDraft((d) => ({ ...d, bodyPose: id })); setView('figure'); }} />
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
            <Row style={{ gap: 8, alignItems: 'center' }}>
              <Text fontSize={11} color={T.dim} style={{ width: 52 }}>paint</Text>
              <Chip label="sculpt" active onPress={() => undefined} />
              {/* MODELPAINT-0605: texture painting migrated to /cutout */}
              <Chip label="paint texture → /cutout" color="cyan" onPress={paintTextureInCutout} />
            </Row>
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
                overlay={draft.paint?.[selPart] ?? null}
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
              <Row style={{ gap: 8, alignItems: 'center' }}>
                <Chip label="fill" onPress={fillAll} />
                <Chip label="soften" onPress={soften} />
                <Chip label="mirror" active={mirror} onPress={() => setMirror((v) => !v)} />
                <Chip label="clear" onPress={clearStrokes} />
              </Row>
            </>
          ) : null}

          {isHead ? (
            <Row style={{ gap: 8, alignItems: 'center' }}>
              <Chip label="generate face" color="good" onPress={generateFaceOnly} />
              <Chip label="export .hed" onPress={exportHead} />
              {draft.face ? <Chip label="remove face" onPress={() => { editDraft((d) => ({ ...d, face: null })); setAnim(null); setStatus(null); }} /> : null}
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
            <SwatchRow colors={DRAFT_DEFAULTS.skins} active={draft.skin} onPick={(skin) => editDraft((d) => ({ ...d, skin }))} />
          </ChipRow>

          <Knob label="brush size" value={brush} spec={TUNE.knobs.brush} onChange={setBrush} />
          <Knob label="strength" value={strength} spec={TUNE.knobs.strength} onChange={setStrength} />
          <Knob label="depth amount" value={draft.amount} spec={TUNE.knobs.amount} onChange={(amount) => editDraftCoalesced((d) => ({ ...d, amount }))} />
          {isHead ? (
            <>
              <Knob label="skull stretch" value={draft.headScaleY} spec={TUNE.knobs.skull} onChange={(headScaleY) => editDraftCoalesced((d) => ({ ...d, headScaleY }))} />
              <Knob label="photo size" value={photoScale} spec={TUNE.knobs.photoScale} onChange={setPhotoScale} />
              <Knob label="photo up/down" value={photoY} spec={TUNE.knobs.photoY} onChange={setPhotoY} />
            </>
          ) : null}

          <Col style={{ gap: 6, paddingTop: 4 }}>
            <Row style={{ gap: 8, alignItems: 'center' }}>
              <Text fontSize={11} color={T.dim} style={{ width: 84 }}>region shape</Text>
              <Chip label="reset" onPress={() => editDraft((d) => ({ ...d, regions: { ...d.regions, [selPart]: {} } }))} />
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
        onLayout={(lr: any) => { viewRect.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
        onMouseDown={previewDown}
        onMouseMove={previewMove}
        onMouseUp={previewUp}
        onScroll={onZoomWheel}
        style={{ flexGrow: 1, height: '100%', position: 'relative', overflow: 'hidden' }}
      >
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={T.panelSolid} showGrid={false} showAxes={false}>
          {/* boot frame only — static props; framework/game/camera.zig writes
              this node's fields every frame once engaged (V23 per-node) */}
          <Scene3D.Camera nativeCamera ref={cameraRef} position={bootCam.pos} target={bootCam.target} fov={bootCam.fov} />
          {/* no ground: the orbit goes pole to pole now (GRABQOL-0605 full
              360) — a studio floor turns every under-the-horizon view into a
              black box interior (the "workspace went black" report) */}
          <LabEnvironment preset="studio" ground={false} />
          <PartMeshes view={view} selPart={selPart} parts={partRender} rig={rig} showHitboxes={showHitboxes} />
          {view === 'figure' && draft.heldItem !== 'none' ? <HeldItemMeshes itemId={draft.heldItem} rig={rig} /> : null}
          {showGrabGrid ? <GrabGridMeshes view={view} selPart={selPart} parts={partRender} rig={rig} /> : null}
          <GrabMarker marker={grabMarker} />
        </Scene3D>
        {/* the grab controls live ON the viewport — visible in every tab
            (the mirror chip used to hide behind the paint tab; GRABGRID-0605) */}
        <Row style={{ position: 'absolute', left: 14, top: 14, gap: 8 }}>
          <Chip label="grid" active={showGrabGrid} color="cyan" onPress={() => setShowGrabGrid((v) => !v)} />
          <Chip label="mirror" active={mirror} onPress={() => setMirror((v) => !v)} />
          <Chip label="undo ⌃Z" onPress={undoDraft} />
          <Chip label="redo ⌃Y" onPress={redoDraft} />
        </Row>
        <Box style={{ position: 'absolute', right: 14, bottom: 14 }}>
          <Knob label="zoom" value={ZOOM_REFLECT - dist} spec={TUNE.knobs.zoom} onChange={(v) => zoomTo(ZOOM_REFLECT - v)} />
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
        paint={draft.paint}
      />
      <GrabGridCapture hover={grabHover} mirror={mirror} />
    </Row>
  );
}
