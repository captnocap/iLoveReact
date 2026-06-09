// IsoAuthor — the Sims-style whole-map BUILD view. Same world the FreeFly inspect
// pane shows (preview==game), but authored from a locked iso camera: rotate in 90°
// detents, zoom, pan, pick a FLOOR LEVEL, and drop catalog pieces by clicking the
// ground. The whole point over the on-foot F2 build mode is scale + reach — lay out
// a city block, or skin a 4th-floor wall, without walking there.
//
// IN SYNC BY CONSTRUCTION: this pane authors the SAME model F2 does. It renders the
// standing city with the SAME PlacedPieceMeshes (extracted to editors/build), snaps
// with the SAME resolveSnapTarget (editors/build/snap), validates with the SAME
// GAME_BUILD.placed.validatePlacement, and commits the SAME piecePlaced WorldEvent
// to the SAME worldStream (via the onCommit the cart already uses for F2). The only
// thing different from F2 is the camera + that the ray comes from the cursor, not a
// crosshair. Place a wall here, it stands in F2 and in the game.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Pressable, Scene3D, Text } from '@reactjit/primitives';
import { busOn } from '@reactjit/hooks/useIFTTT';
import { GAME_BUILD } from './game';
import type { BuildPieceKind, PlacedBuildPiece, Rect, WorldEvent } from './game';
import { resolveSnapTarget, SNAP_TUNING_DEFAULTS, type SnapTarget } from './editors/build/snap';
import { pieceVisualShapes, VisualShapeMesh, PlacedPieceMeshes } from './editors/build/pieceMeshes';
import { BUILD_UI } from './editors/build/buildUi';
import { IsoStage } from './isoStage';
import type { GameState } from '../hmsc/design';
import { WorldStatics } from '../hmsc/render3d/GameWorld3D';
import { LandformSurfaceCaptures } from '../hmsc/render3d/Landform';
import { PropSurfaceCaptures } from '../hmsc/render3d/PropCaptures';
import { CHUNK_TILES } from './chunks';

const FAR_CLIP = 4000;
// The iso eye sits BASE_DIST/zoom (~90–257m) from the ground, far past F2's 14m
// crosshair reach — so the ground march has to travel much further before it dips
// under the terrain. A coarser step keeps the per-move cost sane at that range.
const ISO_SNAP_TUNING = { ...SNAP_TUNING_DEFAULTS, reachMeters: 600, groundMarchStepMeters: 0.5 };

// The build palette, ruled-hotkey order first (floor, wall, ramp, roof), then the
// rest — same kinds F2's palette leads with. Each tab lists its catalog entries.
const PALETTE_KINDS: BuildPieceKind[] = ['floor', 'wall', 'ramp', 'roof', 'stairs', 'pillar', 'prop'];

type Armed = { id: string } | null;

export interface IsoAuthorProps {
  // The world to draw UNDER the pieces (terrain + props), same GameState the inspect
  // pane renders — preview==game.
  state: GameState;
  // The standing pieces (the cart's materialized worldStream truth) + the commit the
  // cart already funnels F2 placements through. This pane is just another caller.
  pieces: readonly PlacedBuildPiece[];
  onCommit: (event: WorldEvent, label: string) => void;
  // World (x,z) -> ground height (m). Level-0 picks follow it; absent = flat ground.
  groundTopAt?: (x: number, z: number) => number;
  // WASD/key focus is owned by the cart (shared across panes); true = this pane
  // drives input. A click here claims it.
  focused?: boolean;
  onFocus?: () => void;
}

export const IsoAuthor = memo(function IsoAuthor(props: IsoAuthorProps) {
  const { state, pieces, onCommit } = props;
  const groundTopAt = props.groundTopAt ?? (() => 0);

  // The camera controller, seeded centred on the seed chunk. Pose lives in the ref;
  // a tick forces the Scene3D.Camera to re-read the solved pose on any pan/zoom/turn.
  const stageRef = useRef<IsoStage | null>(null);
  if (!stageRef.current) {
    stageRef.current = new IsoStage({ centerX: CHUNK_TILES / 2, centerZ: CHUNK_TILES / 2, facing: 0, zoom: 1, level: 0 }, groundTopAt);
  }
  const stage = stageRef.current;
  useEffect(() => { stage.setHeightSampler(groundTopAt); }, [stage, groundTopAt]);
  const [, bump] = useState(0);
  const redraw = useCallback(() => bump((n) => (n + 1) & 0xffff), []);

  const [armed, setArmed] = useState<Armed>(null);
  const armedRef = useRef<Armed>(armed);
  armedRef.current = armed;
  const [ghostYaw, setGhostYaw] = useState(0);
  const ghostYawRef = useRef(ghostYaw);
  ghostYawRef.current = ghostYaw;
  const [snap, setSnap] = useState<SnapTarget | null>(null);
  const piecesRef = useRef(pieces);
  piecesRef.current = pieces;
  const rectRef = useRef<Rect>({ x: 0, y: 0, width: 800, height: 600 });

  // Resolve the cursor to a snap target with the SAME inputs F2 uses (the armed
  // catalog entry's snap mode + size, the ghost yaw, the standing pieces).
  const resolveAt = useCallback((sx: number, sy: number): SnapTarget | null => {
    const a = armedRef.current;
    if (!a) return null;
    const def = GAME_BUILD.catalog.get(a.id);
    return resolveSnapTarget({
      ray: stage.pieceRay(sx, sy, rectRef.current),
      pieces: piecesRef.current,
      groundTopAt,
      snap: def.snap,
      size: def.size,
      yawDegrees: ghostYawRef.current,
      tuning: ISO_SNAP_TUNING,
    });
  }, [stage, groundTopAt]);

  // Pointer: when armed, the cursor previews a ghost (move) and a click commits a
  // piecePlaced event. When NOT armed, a left-drag pans the map ("grab the ground").
  const dragRef = useRef<{ x: number; y: number; panning: boolean } | null>(null);
  const local = (e: any): { x: number; y: number } => {
    const r = rectRef.current;
    return { x: Number(e?.x ?? 0) - r.x, y: Number(e?.y ?? 0) - r.y };
  };

  const onDown = (e: any) => {
    props.onFocus?.();
    const p = local(e);
    if (armedRef.current) {
      const t = resolveAt(p.x, p.y);
      setSnap(t);
      if (t) placeAt(t);
      dragRef.current = { x: p.x, y: p.y, panning: false };
    } else {
      dragRef.current = { x: p.x, y: p.y, panning: true };
    }
  };
  const onMove = (e: any) => {
    const p = local(e);
    const d = dragRef.current;
    if (d?.panning) {
      stage.dragPan(d.x, d.y, p.x, p.y, rectRef.current);
      d.x = p.x; d.y = p.y;
      redraw();
      return;
    }
    if (armedRef.current) setSnap(resolveAt(p.x, p.y));
  };
  const onUp = () => { dragRef.current = null; };

  const placeAt = (t: SnapTarget) => {
    const a = armedRef.current;
    if (!a) return;
    const def = GAME_BUILD.catalog.get(a.id);
    const placement = { pieceId: def.id, x: t.placement.x, y: t.placement.y, z: t.placement.z, yawDegrees: t.placement.yawDegrees };
    if (GAME_BUILD.placed.validatePlacement(placement).length > 0) return;
    onCommit({ kind: 'piecePlaced', placement }, `placed ${def.label} @ ${t.placement.x.toFixed(1)},${t.placement.z.toFixed(1)}`);
  };

  // Keys: R rotates the ghost 90° (like F2), Esc disarms. Only while focused.
  useEffect(() => {
    if (!props.focused) return;
    const off = busOn('__keydown', (e: any) => {
      const k = String(e?.key ?? '').toLowerCase();
      if (k === 'r') setGhostYaw((y) => (y + 90) % 360);
      else if (k === 'escape') setArmed(null);
      else if (k === 'q') { stage.rotate(-1); redraw(); }
      else if (k === 'e') { stage.rotate(1); redraw(); }
    });
    return off;
  }, [props.focused, stage, redraw]);

  const cam = stage.solve();
  const level = stage.pose.level;

  // The placement ghost: the armed piece drawn translucent at the snapped pose,
  // tinted blocked-red when validatePlacement refuses it — F2's ghost, in iso.
  const ghostMeshes = useMemo(() => {
    const a = armedRef.current;
    if (!a || !snap) return null;
    const placement = { pieceId: a.id, x: snap.placement.x, y: snap.placement.y, z: snap.placement.z, yawDegrees: snap.placement.yawDegrees };
    const blocked = GAME_BUILD.placed.validatePlacement(placement).length > 0;
    const color = blocked ? BUILD_UI.ghostBlockedColor : BUILD_UI.ghostColor;
    return pieceVisualShapes(placement, 'isoGhost').map((shape) => (
      <VisualShapeMesh key={shape.kind === 'ramp' ? shape.ramp.key : shape.box.key} shape={shape} colorOverride={color} opacityOverride={BUILD_UI.ghostOpacity} />
    ));
  }, [snap, armed]);

  const noIds = useMemo(() => new Set<string>(), []);

  return (
    <Box style={{ width: '100%', height: '100%', position: 'relative' }}>
      <LandformSurfaceCaptures landforms={state.world.landforms ?? []} />
      <PropSurfaceCaptures props={state.world.props} />
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0a1018" showGrid showAxes={false}>
        <Scene3D.Camera position={cam.pos} target={cam.target} fov={cam.fov} far={FAR_CLIP} />
        <Scene3D.Fog enabled={false} />
        <WorldStatics world={state.world} skyConfig={state.config.sky} />
        {/* the standing city — the SAME renderer F2 uses */}
        <PlacedPieceMeshes pieces={pieces} markedIds={noIds} targetId={null} occludedIds={noIds} />
        {ghostMeshes}
      </Scene3D>

      {/* pointer capture (near-transparent so it's hittable) */}
      <Pressable onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001' }} />

      {/* ── Sims control cluster (top-right): rotate · zoom · floor ────────── */}
      <Box style={{ position: 'absolute', right: 8, top: 8, flexDirection: 'row', gap: 4 }}>
        <IsoBtn label="⟲" onPress={() => { stage.rotate(-1); redraw(); }} />
        <IsoBtn label="⟳" onPress={() => { stage.rotate(1); redraw(); }} />
        <IsoBtn label="−" onPress={() => { stage.zoomBy(1 / 1.25); redraw(); }} />
        <IsoBtn label="+" onPress={() => { stage.zoomBy(1.25); redraw(); }} />
        <IsoBtn label="▼" onPress={() => { stage.lowerLevel(); redraw(); }} />
        <Box style={{ paddingLeft: 6, paddingRight: 6, paddingTop: 4, paddingBottom: 4, backgroundColor: BUILD_UI.panelBg, borderRadius: 4 }}>
          <Text fontSize={10} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>{`F${level}`}</Text>
        </Box>
        <IsoBtn label="▲" onPress={() => { stage.raiseLevel(); redraw(); }} />
      </Box>

      {/* ── catalog rail (bottom): pick a piece to place ───────────────────── */}
      <CatalogRail armed={armed} onArm={(id) => setArmed((cur) => (cur?.id === id ? null : { id }))} />

      <Text fontSize={9} color={props.focused ? '#7dd3fc' : '#475569'} style={{ fontFamily: 'monospace', position: 'absolute', left: 8, top: 34 }}>
        {armed ? `place: ${GAME_BUILD.catalog.get(armed.id).label} · R rotate · drag empty to pan · Esc cancel` : 'pick a piece below · Q/E turn · drag to pan'}
      </Text>
    </Box>
  );
});

function IsoBtn(props: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress}>
      <Box style={{ width: 26, height: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: BUILD_UI.panelBg, borderRadius: 4 }}>
        <Text fontSize={12} color="#cbd5e1">{props.label}</Text>
      </Box>
    </Pressable>
  );
}

// The bottom build palette. A row of kind tabs (floor/wall/ramp/...) and, under the
// active tab, that kind's catalog entries as chips — the Sims bottom bar, fed by the
// SAME BUILD_CATALOG the F2 palette reads.
const CatalogRail = memo(function CatalogRail(props: { armed: Armed; onArm: (id: string) => void }) {
  const [kind, setKind] = useState<BuildPieceKind>('wall');
  const entries = useMemo(() => GAME_BUILD.catalog.byKind(kind), [kind]);
  return (
    <Box style={{ position: 'absolute', left: 8, right: 8, bottom: 8, backgroundColor: BUILD_UI.panelBg, borderRadius: 6, padding: 6, gap: 5 }}>
      <Box style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
        {PALETTE_KINDS.map((k) => (
          <Pressable key={k} onPress={() => setKind(k)}>
            <Box style={{ paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRadius: 4, backgroundColor: k === kind ? '#1d4ed8' : '#1e293b' }}>
              <Text fontSize={10} color={k === kind ? '#e0f2fe' : '#94a3b8'} style={{ fontFamily: 'monospace' }}>{k}</Text>
            </Box>
          </Pressable>
        ))}
      </Box>
      <Box style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
        {entries.map((def) => (
          <Pressable key={def.id} onPress={() => props.onArm(def.id)}>
            <Box style={{ paddingLeft: 7, paddingRight: 7, paddingTop: 4, paddingBottom: 4, borderRadius: 4, borderWidth: 1, borderColor: props.armed?.id === def.id ? '#38bdf8' : '#334155', backgroundColor: props.armed?.id === def.id ? '#0c4a6e' : '#0f172a' }}>
              <Text fontSize={10} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>{def.label}</Text>
            </Box>
          </Pressable>
        ))}
      </Box>
    </Box>
  );
});
