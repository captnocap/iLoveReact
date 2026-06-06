// editors/items/ — the ITEM sculpt editor route (ITEMSCULPT-0606).
//
// "take a model i can make in the voxel editor, and then bring this into an
// item editor that behaves just like the character editor for the mesh of
// it, so i can smooth out the blocky shape for game items" — the user.
//
//   left:  the item roster + import-from-/voxels + the unwrap depth painter
//          (blue = raised, orange = carved) + knobs + color
//   right: the sculpted item in 3D — hover shows the grab handle, drag pulls
//          the surface, the lattice shell shows every pull point, orbit/fly
//          camera, wheel zoom-to-cursor. THE SAME HANDS as /characters: the
//          route reuses grabKit/paintKit/sculptCamera outright (no parallel
//          re-implementation).
//
// ONE TRUTH: the 48×24 signed grid is the only deformation store — grab
// drags stamp it, paint strokes read back into it, the mesh and the lattice
// both generate from it through @reactjit/geometries globeSurface.
//
// Import = bake (editors/items/bake.ts): the LATEST /voxels blockout
// ray-marches into the radial field. Star-shape limit surfaced in the status
// line — concave overhangs flatten to their hull.
//
// Persistence is V20 from day one: every micro change auto-commits the
// document to the 'items' stream (ONE store with /voxels — the import reads
// the same channel /voxels autosaves). Saved items join GAME_ITEMS consumers
// through sculptedItemDefinition (the /characters prop chips list them).
//
// Route surfaces OVERLAY the shell body: absolute full-area + opaque bg.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Col, Effect, Paintable, Pressable, Row, ScrollView, Scene3D, Text, TextInput } from '@reactjit/runtime/primitives';
import { usePaintable } from '@reactjit/runtime/hooks/usePaintable';
import { useIFTTT } from '@reactjit/runtime/hooks/useIFTTT';
import * as Geometry from '@reactjit/geometries';
import { type Solved } from '../../game/camera';
import { GAME_CHROME } from '../../game/chrome';
import { editorChannel } from '../store';
import { editorSessions, type RouteSession } from '../sessions';
import { useRouteTwigState } from '../twigs';
import { useSculptCamera } from '../sculptCamera';
import { PAINT } from '../paint';
import { voxelsStream } from '../voxels/stream';
import {
  DEPTH_OVERLAY_WGSL, PAINT_EDITOR_TUNING, bytesFromGrid, gridFromBytes, reliefBytesFromGrid, sculptModeValue,
  type SculptMode,
} from '../characters/paintKit';
import {
  GRAB_GRID_TEXTURE_KEY, GRAB_TUNING, applyGrabStamp, buildGrabClouds, grabDragAxis, grabPointWorld,
  gridDeltaFor, gridOverlayParams, pickGrab, screenAxisFor, stampRadiusUv, stampWorldRadius,
  type GrabCloud, type GrabHit, type GrabInstance, type ScreenAxis,
} from '../characters/grabKit';
import { ChipRow, SwatchRow } from '../characters/controls';
import { GrabGridCapture, GrabMarker, type GrabMarkerInfo } from '../characters/preview';
import { ITEM_DRAFT_DEFAULTS, bakeBlockoutToGlobe, emptyItemGrid, itemGlobeParams } from './bake';
import { itemsStream, mintItemId, type ItemsEvent, type ItemsStreamState, type SculptedItemDoc } from './stream';

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

/** item-shaped knob ranges — a baked blockout's radius/amount run meters,
 *  past the character presets' band */
const ITEM_KNOBS = Object.freeze({
  radius: { min: 0.1, max: 4, step: 0.05, precision: 2 },
  amount: { min: 0.05, max: 3, step: 0.05, precision: 2 },
});

/** the sculpted item's stage placement (eye-ish height, no ground to clip) */
const ITEM_PLACEMENT: [number, number, number] = [0, 1.2, 0];

/** the one grab slot — grabKit is generic over the key (ITEMSCULPT-0606) */
type ItemSlot = 'item';

type ItemDraft = {
  radius: number;
  amount: number;
  /** signed −1..1 displacement, 48×24 row-major — THE one sculpt truth */
  grid: number[];
  color: string;
  source: SculptedItemDoc['source'];
};

function emptyItemDraft(): ItemDraft {
  return {
    radius: ITEM_DRAFT_DEFAULTS.radius,
    amount: ITEM_DRAFT_DEFAULTS.amount,
    grid: emptyItemGrid(),
    color: ITEM_DRAFT_DEFAULTS.color,
    source: null,
  };
}

function draftToDoc(draft: ItemDraft, name: string): SculptedItemDoc {
  return {
    kind: 'sculpted-item', version: 1, name,
    radius: draft.radius, amount: draft.amount,
    cols: GRID_W, rows: GRID_H, grid: draft.grid.slice(),
    color: draft.color, source: draft.source,
    metadata: { title: name },
  };
}

function draftFromDoc(doc: SculptedItemDoc): ItemDraft {
  return {
    radius: doc.radius, amount: doc.amount,
    grid: doc.grid.length === GRID_W * GRID_H ? doc.grid.slice() : emptyItemGrid(),
    color: doc.color, source: doc.source ?? null,
  };
}

export function ItemsRoute(props: { onExit: () => void }) {
  // ── the V20 roster channel + this visit's session ──────────────────────────
  const live = useMemo(() => {
    try {
      const channel = editorChannel(itemsStream);
      return { channel, session: editorSessions().open('/items', channel) as RouteSession<ItemsEvent>, error: null as string | null };
    } catch (e) {
      return { channel: null, session: null, error: String(e) };
    }
  }, []);
  useEffect(() => () => live.session?.close(), [live]);
  const [rosterRev, setRosterRev] = useState(0);
  const rosterState: ItemsStreamState = useMemo(
    () => live.channel?.state() ?? { items: {}, order: [] },
    [live, rosterRev],
  );

  // ── the working item ───────────────────────────────────────────────────────
  const [draft, setDraft] = useState<ItemDraft>(emptyItemDraft);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('new item');
  const [seq, setSeq] = useState(0);
  const [mode, setMode] = useRouteTwigState<SculptMode>('/items', 'sculptMode', 'raise');
  // mirror defaults OFF: a baked blockout is rarely meridian-symmetric, and a
  // surprise twin stamp on an asymmetric item reads as a bug
  const [mirror, setMirror] = useRouteTwigState('/items', 'mirror', false);
  const [brush, setBrush] = useRouteTwigState('/items', 'brush', 14);
  const [strength, setStrength] = useRouteTwigState('/items', 'strength', 0.5);
  const [showGrabGrid, setShowGrabGrid] = useRouteTwigState('/items', 'showGrabGrid', true);
  const [status, setStatus] = useState<string | null>(null);

  const draftRef = useRef(draft); draftRef.current = draft;
  const draftIdRef = useRef(draftId); draftIdRef.current = draftId;
  const draftNameRef = useRef(draftName); draftNameRef.current = draftName;

  // ── AUTOSAVE (V20 "saved at every micro change") ───────────────────────────
  const autosaveSkipRef = useRef(true); // the mount render never autosaves
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (autosaveSkipRef.current) { autosaveSkipRef.current = false; return; }
    if (!live.session) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      autosaveTimer.current = null;
      const id = draftIdRef.current ?? mintItemId();
      if (!draftIdRef.current) setDraftId(id);
      live.session!.commit(
        { kind: 'authored', id, doc: draftToDoc(draftRef.current, draftNameRef.current) },
        `autosave · ${draftNameRef.current}`,
      );
      setRosterRev((r) => r + 1);
    }, TUNE.autosaveDebounceMs);
  }, [draft]);
  useEffect(() => () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); }, []);

  // ── the GPU paint surface (the unwrap depth canvas) + relief contours ──────
  const paint = usePaintable({ id: 'itm-sculpt', w: PAINT_W, h: PAINT_H });
  const relief = usePaintable({ id: 'itm-relief', w: GRID_W, h: GRID_H });
  useEffect(() => { paint.paint.clear(NEUTRAL); }, []);
  useEffect(() => { relief.paint.upload(reliefBytesFromGrid(draft.grid)); }, [draft.grid]);

  const uploadGrid = (g: number[]) => paint.paint.upload(bytesFromGrid(g));
  const setGrid = (g: number[]) => {
    setDraft((d) => ({ ...d, grid: g }));
    setSeq((s) => s + 1);
  };

  /** Replace the whole draft + sync the paint texture and the mesh slot.
   *  Restoring/importing arms the autosave skip unless told otherwise. */
  const installDraft = (next: ItemDraft) => {
    autosaveSkipRef.current = true;
    setDraft(next);
    uploadGrid(next.grid);
    setSeq((s) => s + 1);
  };

  // ── UNDO/REDO — the shared painter's history over the draft ───────────────
  const history = useRef(PAINT.createPaintHistory<ItemDraft>()).current;
  const snapDraft = () => JSON.parse(JSON.stringify(draftRef.current)) as ItemDraft;
  const editDraft = (updater: (d: ItemDraft) => ItemDraft) => {
    history.commit(snapDraft);
    setDraft(updater);
    setSeq((s) => s + 1);
  };
  const editDraftCoalesced = (updater: (d: ItemDraft) => ItemDraft) => {
    history.commitCoalesced(snapDraft);
    setDraft(updater);
    setSeq((s) => s + 1);
  };
  const restoreDraft = (state: ItemDraft | null, label: string) => {
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

  // ── mount restore (V20 stateless): reopen where authoring left off ────────
  useEffect(() => {
    const lastId = rosterState.order[rosterState.order.length - 1];
    const doc = lastId ? rosterState.items[lastId] : null;
    if (!doc) return;
    installDraft(draftFromDoc(doc));
    setDraftId(lastId);
    setDraftName(doc.metadata?.title ?? doc.name);
    setStatus(`restored "${doc.metadata?.title ?? doc.name}" — the draft autosaves as you work`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount restore only
  }, []);

  // ── import: the LATEST /voxels blockout → the sculptable field ─────────────
  const importBlockout = () => {
    let doc = null;
    try { doc = editorChannel(voxelsStream).state().doc; } catch { doc = null; }
    if (!doc || doc.blocks.length === 0) {
      setStatus('no blockout in /voxels yet — build a shape there, it autosaves, then import here');
      return;
    }
    const bake = bakeBlockoutToGlobe(doc);
    if (!bake) { setStatus('the blockout is empty'); return; }
    history.commit(snapDraft);
    installDraft({
      ...draftRef.current,
      radius: bake.radius,
      amount: bake.amount,
      grid: bake.grid,
      source: { blocks: doc.blocks.length, dims: { ...doc.dims } },
    });
    autosaveSkipRef.current = false; // imported content is authored content — autosave it
    setDraftId(null); // a NEW item, not an overwrite of the loaded one
    setDraftName('blockout item');
    setStatus(`imported ${doc.blocks.length} blocks — grab the mesh and pull it smooth. Star-shape wrap: concave overhangs flatten to their hull.`);
    live.session?.note(`import blockout · ${doc.blocks.length} blocks · ${doc.dims.w}×${doc.dims.d}×${doc.dims.h}`);
  };

  // ── roster save / load / remove ────────────────────────────────────────────
  const saveToRoster = () => {
    if (!live.session) { setStatus(`save unavailable — ${live.error ?? 'no session'}`); return; }
    const id = draftId ?? mintItemId();
    live.session.commit({ kind: 'authored', id, doc: draftToDoc(draft, draftName) }, `${draftName}: saved`);
    setDraftId(id);
    setRosterRev((r) => r + 1);
    setStatus(`saved "${draftName}" — it shows up as a prop in /characters`);
  };
  const loadFromRoster = (id: string) => {
    const doc = rosterState.items[id];
    if (!doc) return;
    history.commit(snapDraft);
    installDraft(draftFromDoc(doc));
    setDraftId(id);
    setDraftName(doc.metadata?.title ?? doc.name);
    setStatus(`loaded "${doc.metadata?.title ?? doc.name}"`);
  };
  const removeFromRoster = (id: string) => {
    if (!live.session) return;
    live.session.commit({ kind: 'removed', id }, `${id}: removed`);
    setRosterRev((r) => r + 1);
    if (draftId === id) setDraftId(null);
    setStatus('removed from the roster (its history stays in the log)');
  };
  const newItem = () => {
    history.commit(snapDraft);
    installDraft(emptyItemDraft());
    autosaveSkipRef.current = false;
    setDraftId(null);
    setDraftName('new item');
    setStatus('blank sphere — sculpt from scratch, or import a blockout');
  };

  // ── painting (the unwrap depth canvas — identical plumbing to /characters) ─
  const paintingRef = useRef(false);
  const strokeEngineRef = useRef<ReturnType<typeof PAINT.createStrokeEngine> | null>(null);
  const canvasRect = useRef({ x: 0, y: 0, width: EDITOR_W, height: EDITOR_H });

  const dab = (sx: number, sy: number, pressure?: number) => {
    const engine = strokeEngineRef.current;
    if (!engine) return;
    const r = canvasRect.current;
    const tx = ((sx - r.x) / r.width) * PAINT_W;
    const ty = ((sy - r.y) / r.height) * PAINT_H;
    const value = sculptModeValue(mode, strength);
    for (const d of engine.move(tx, ty, pressure)) {
      paint.paint.circle(d.x, d.y, d.radius, value);
    }
  };
  const syncGrid = () => {
    const bytes = paint.paint.readback();
    if (!bytes || bytes.length < PAINT_W * PAINT_H) return;
    setGrid(gridFromBytes(bytes));
  };
  const onPaintDown = (e: any) => {
    paintingRef.current = true;
    strokeEngineRef.current = PAINT.createStrokeEngine({ brushPx: brush, mirrorAxisX: mirror ? PAINT_W / 2 : null });
    strokeEngineRef.current.begin();
    dab(Number(e?.x ?? 0), Number(e?.y ?? 0), Number(e?.pressure) || undefined);
  };
  const onPaintMove = (e: any) => {
    if (!paintingRef.current) return;
    dab(Number(e?.x ?? 0), Number(e?.y ?? 0), Number(e?.pressure) || undefined);
  };
  const onPaintUp = () => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    strokeEngineRef.current?.end();
    strokeEngineRef.current = null;
    history.commit(snapDraft); // the draft mutates HERE (release readback)
    syncGrid();
    live.session?.note(`sculpt stroke · ${mode} · ${brush}px`);
  };
  const soften = () => {
    const src = paint.paint.readback();
    if (!src || src.length < PAINT_W * PAINT_H) return;
    history.commit(snapDraft);
    const out = PAINT.soften3x3(src, PAINT_W, PAINT_H);
    paint.paint.upload(out);
    setGrid(gridFromBytes(out));
    live.session?.note('soften');
  };
  const clearSculpt = () => {
    history.commit(snapDraft);
    paint.paint.clear(NEUTRAL);
    setGrid(emptyItemGrid());
    live.session?.note('clear sculpt');
  };

  // ── the mesh + the grab machinery (grabKit, generic key 'item') ───────────
  const params = useMemo(() => itemGlobeParams(draft), [draft.radius, draft.amount, draft.grid]);
  const dynKey = `itm.main~${seq}.${draft.amount.toFixed(2)}.${draft.radius.toFixed(2)}`;
  const instances: GrabInstance<ItemSlot>[] = useMemo(
    () => [{ part: 'item', position: ITEM_PLACEMENT, scale: [1, 1, 1] }],
    [],
  );

  const viewRect = useRef({ x: 0, y: 0, width: 1, height: 1 });
  const grabCloudsRef = useRef<{ sig: unknown; clouds: GrabCloud<ItemSlot>[] } | null>(null);
  const grabClouds = () => {
    const cached = grabCloudsRef.current;
    if (cached && cached.sig === params) return cached.clouds;
    const clouds = buildGrabClouds<ItemSlot>(instances, () => params);
    grabCloudsRef.current = { sig: params, clouds };
    return clouds;
  };

  const pickAtCam = (sx: number, sy: number, cam: Solved) => {
    const r = viewRect.current;
    return pickGrab<ItemSlot>(sx - r.x, sy - r.y, { x: 0, y: 0, width: r.width, height: r.height }, cam, grabClouds());
  };

  // ── the camera: the SHARED sculpt rig (orbit + noclip fly + zoom-to-cursor) ─
  const camera = useSculptCamera({
    route: '/items',
    center: ITEM_PLACEMENT,
    viewRect,
    pickWorld: (sx, sy, cam) => (pickAtCam(sx, sy, cam)?.world as [number, number, number] | undefined) ?? null,
    defaults: { dist: 3.4, look: { yaw: 20, pitch: 12 }, flyPose: { pos: [0, 1.4, -3.0], yaw: 0, pitch: -4 }, mode: 'orbit' },
  });
  const pickAt = (sx: number, sy: number) => pickAtCam(sx, sy, camera.solvedCam());

  const [grabHover, setGrabHover] = useState<
    { gx: number; gy: number; cu: number; cv: number; grabRadius: number; state: 'hover' | 'raise' | 'carve' } | null
  >(null);
  const grabRef = useRef<null | {
    hit: GrabHit<ItemSlot>; baseGrid: number[]; axis: ScreenAxis;
    startX: number; startY: number; delta: number; rx: number; ry: number;
    lastSync: number; timer: ReturnType<typeof setTimeout> | null; applied: boolean;
  }>(null);

  const hoverMove = (e: any) => {
    const hit = pickAt(Number(e?.x ?? 0), Number(e?.y ?? 0));
    setGrabHover((cur) => {
      if (!hit) return cur === null ? cur : null;
      if (cur && cur.gx === hit.gx && cur.gy === hit.gy && cur.state === 'hover') return cur;
      return { gx: hit.gx, gy: hit.gy, cu: hit.cu, cv: hit.cv, grabRadius: hit.grabRadius, state: 'hover' };
    });
  };

  const startGrab = (hit: GrabHit<ItemSlot>, e: any) => {
    const r = viewRect.current;
    const axisWorld = grabDragAxis(hit, params, instances[0]);
    const axis = screenAxisFor(hit.world, axisWorld, { x: 0, y: 0, width: r.width, height: r.height }, camera.solvedCam());
    const { rx, ry } = stampRadiusUv(brush, PAINT_W);
    grabRef.current = {
      hit, baseGrid: draft.grid.slice(), axis,
      startX: Number(e?.x ?? 0), startY: Number(e?.y ?? 0), delta: 0, rx, ry,
      lastSync: 0, timer: null, applied: false,
    };
    setGrabHover({ gx: hit.gx, gy: hit.gy, cu: hit.cu, cv: hit.cv, grabRadius: hit.grabRadius, state: 'raise' });
  };
  const applyGrabLive = () => {
    const g = grabRef.current;
    if (!g) return;
    g.lastSync = Date.now();
    g.applied = true;
    setGrid(applyGrabStamp(g.baseGrid, g.hit.cu, g.hit.cv, g.rx, g.ry, g.delta, mirror));
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
        setGrid(g.baseGrid);
        uploadGrid(g.baseGrid);
      }
    } else {
      // the undo entry is the PRE-DRAG state (live ticks already moved the draft)
      history.commit(() => ({ ...snapDraft(), grid: g.baseGrid.slice() }));
      const final = applyGrabStamp(g.baseGrid, g.hit.cu, g.hit.cv, g.rx, g.ry, g.delta, mirror);
      setGrid(final);
      // ONE-TRUTH compose law: the paint texture must carry the dragged grid
      uploadGrid(final);
      live.session?.note(`grab drag · cell ${g.hit.gx},${g.hit.gy} · ${g.delta > 0 ? 'raise' : 'carve'} ${Math.abs(g.delta).toFixed(2)}`);
    }
    setGrabHover((cur) => (cur ? { ...cur, state: 'hover' } : cur));
  };

  // grab beats orbit on the same Pressable
  const previewDown = (e: any) => {
    const hit = pickAt(Number(e?.x ?? 0), Number(e?.y ?? 0));
    if (hit) startGrab(hit, e);
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

  // the marker rides the CURRENT surface (it follows the drag)
  const grabMarker: GrabMarkerInfo | null = useMemo(() => {
    if (!grabHover) return null;
    return {
      world: grabPointWorld(params, instances[0], grabHover.cu, grabHover.cv) as [number, number, number],
      grabRadius: grabHover.grabRadius,
      stampWorldRadius: stampWorldRadius(params, instances[0], grabHover.cu, grabHover.cv, stampRadiusUv(brush, PAINT_W).rx),
      state: grabHover.state,
    };
  }, [grabHover, params, instances, brush]);

  const shellParams = useMemo(() => gridOverlayParams(params), [params]);

  // ── the surface ────────────────────────────────────────────────────────────
  return (
    <Row style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', backgroundColor: T.panelSolid }}>
      {/* ── left: roster + import + the unwrap depth painter ── */}
      <ScrollView showScrollbar={true} style={{ width: EDITOR_W + 36, height: '100%' }}>
        <Col style={{ width: EDITOR_W + 28, padding: 14, gap: 10 }}>
          <Row style={{ gap: 8, alignItems: 'center' }}>
            <Text fontSize={15} color={T.ink} style={{ fontWeight: 900 }}>ITEMS</Text>
            <Box style={{ flexGrow: 1 }} />
            <Chip label="back to editor" onPress={props.onExit} />
          </Row>
          <Text fontSize={11} color={T.dim}>
            {status ?? 'block a shape in /voxels, import it here, then grab the mesh in 3D and pull it smooth — or paint depth on the unwrap (blue raises, orange carves)'}
          </Text>

          {/* roster: every saved item, one click to load */}
          <ChipRow label="items">
            {rosterState.order.length === 0 ? <Text fontSize={11} color={T.dim}>empty — sculpt one</Text> : null}
            {rosterState.order.map((id) => (
              <Chip
                key={id}
                label={rosterState.items[id]?.metadata?.title ?? rosterState.items[id]?.name ?? id}
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
              style={{ height: 28, width: 200, backgroundColor: '#0f172a', borderWidth: 1, borderColor: T.frame, borderRadius: 5, paddingLeft: 8, paddingRight: 8, color: T.ink }}
            />
            <Chip label="save" color="good" onPress={saveToRoster} />
            <Chip label="new" onPress={newItem} />
          </Row>
          <ChipRow label="import">
            <Chip label="import /voxels blockout" color="cyan" onPress={importBlockout} />
            {draft.source ? (
              <Text fontSize={10} color={T.dim}>
                from {draft.source.blocks} blocks · {draft.source.dims.w}×{draft.source.dims.d}×{draft.source.dims.h}
              </Text>
            ) : null}
          </ChipRow>

          {/* ── the unwrap depth painter (one part — the whole item) ── */}
          <Row style={{ gap: 8, alignItems: 'center' }}>
            <Chip label="raise" active={mode === 'raise'} onPress={() => setMode('raise')} />
            <Chip label="carve in" active={mode === 'lower'} color="#ff9445" onPress={() => setMode('lower')} />
            <Chip label="flatten" active={mode === 'flatten'} color="#94a3b8" onPress={() => setMode('flatten')} />
            <Chip label="soften" onPress={soften} />
            <Chip label="clear" onPress={clearSculpt} />
          </Row>
          <Pressable
            onLayout={(lr: any) => { canvasRect.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
            onMouseDown={onPaintDown}
            onMouseMove={onPaintMove}
            onMouseUp={onPaintUp}
            style={{ width: EDITOR_W, height: EDITOR_H, borderWidth: 1, borderColor: T.frame, position: 'relative' }}
          >
            <Box style={{ width: EDITOR_W, height: EDITOR_H, backgroundColor: draft.color }} />
            <Effect
              shader={DEPTH_OVERLAY_WGSL}
              data={[0]}
              textures={[paint.id, relief.id]}
              style={{ position: 'absolute', left: 0, top: 0, width: EDITOR_W, height: EDITOR_H }}
            />
          </Pressable>

          <Knob label="brush size" value={brush} spec={TUNE.knobs.brush} onChange={setBrush} />
          <Knob label="strength" value={strength} spec={TUNE.knobs.strength} onChange={setStrength} />
          <Knob label="depth amount" value={draft.amount} spec={ITEM_KNOBS.amount} onChange={(amount) => editDraftCoalesced((d) => ({ ...d, amount }))} />
          <Knob label="base radius" value={draft.radius} spec={ITEM_KNOBS.radius} onChange={(radius) => editDraftCoalesced((d) => ({ ...d, radius }))} />
          <ChipRow label="color">
            <SwatchRow colors={ITEM_DRAFT_DEFAULTS.colors} active={draft.color} onPick={(color) => editDraft((d) => ({ ...d, color }))} />
          </ChipRow>
        </Col>
      </ScrollView>

      {/* ── right: the sculpted item ── */}
      <Pressable
        onLayout={(lr: any) => { viewRect.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
        onMouseDown={previewDown}
        onMouseMove={previewMove}
        onMouseUp={previewUp}
        onScroll={camera.onWheel}
        style={{ flexGrow: 1, height: '100%', position: 'relative', overflow: 'hidden' }}
      >
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={T.panelSolid} showGrid={false} showAxes={false}>
          {/* boot frame only — the host writes this node every frame (V23) */}
          <Scene3D.Camera nativeCamera ref={camera.cameraRef} position={camera.bootCam.pos} target={camera.bootCam.target} fov={camera.bootCam.fov} />
          <LabEnvironment preset="studio" ground={false} />
          <Scene3D.Mesh
            geometry={Geometry.Globe}
            params={params as any}
            dynamicKey={dynKey}
            material={draft.color}
            position={ITEM_PLACEMENT}
          />
          {/* the pullable lattice: a normal-offset shell of the item wearing
              the shared grid texture (every intersection dot IS a pull point) */}
          {showGrabGrid ? (
            <Scene3D.Mesh
              geometry={Geometry.Globe}
              params={shellParams as any}
              dynamicKey={dynKey.replace('~', '.grid~')}
              material={{ color: GRAB_TUNING.grid.color, opacity: GRAB_TUNING.grid.opacity }}
              textureKey={GRAB_GRID_TEXTURE_KEY}
              position={ITEM_PLACEMENT}
            />
          ) : null}
          <GrabMarker marker={grabMarker} />
        </Scene3D>
        <Row style={{ position: 'absolute', left: 14, top: 14, gap: 8 }}>
          <Chip label="grid" active={showGrabGrid} color="cyan" onPress={() => setShowGrabGrid((v) => !v)} />
          <Chip label="mirror" active={mirror} onPress={() => setMirror((v) => !v)} />
          <Chip label="fly" active={camera.camMode === 'fly'} color="good" onPress={() => camera.setCamMode(camera.camMode === 'fly' ? 'orbit' : 'fly')} />
          <Chip label="undo ⌃Z" onPress={undoDraft} />
          <Chip label="redo ⌃Y" onPress={redoDraft} />
        </Row>
        {camera.camMode === 'fly' ? (
          <Text fontSize={10} color={T.dim} style={{ position: 'absolute', right: 14, bottom: 14 }}>
            wasd move · q/e down/up · drag look · drag the mesh to pull · wheel dolly
          </Text>
        ) : (
          <Box style={{ position: 'absolute', right: 14, bottom: 14 }}>
            <Knob label="zoom" value={camera.zoomReflect - camera.dist} spec={TUNE.knobs.zoom} onChange={(v) => camera.zoomTo(camera.zoomReflect - v)} />
          </Box>
        )}
      </Pressable>

      {/* offscreen: the paint textures + the shared lattice capture.
          Paintables MUST sit outside the flex flow. */}
      <Box style={{ position: 'absolute', left: -99999, top: 0, width: 1, height: 1 }}>
        <Paintable id={paint.id} w={PAINT_W} h={PAINT_H} />
        <Paintable id={relief.id} w={GRID_W} h={GRID_H} />
      </Box>
      <GrabGridCapture hover={grabHover} mirror={mirror} />
    </Row>
  );
}
