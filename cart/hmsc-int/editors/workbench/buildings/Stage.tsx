// editors/workbench/buildings/Stage.tsx — the BUILDING stage (BUILDSKIN-0606).
//
// Column 4 DEMONSTRATES (LAW 1): the building renders live from the store's
// resolved face skins — piece override > type global > bare catalog look —
// and every panel edit re-renders it that instant. The only input the stage
// owns is SELECTION (click a piece to put it in the panel — the WBCHAR C3
// "grabbing selects" precedent) and the orbit camera (ObjectInspect3D's
// proven local wire); properties never get edited here.
//
// THE FACE RULE made visible: each piece is its core box (the SIDES group —
// one uniform look all the way around) plus two thin MAJOR-FACE slabs
// (front/back for vertical pieces, top/bottom for plates) carrying their own
// skin. A material skin mounts ONE TextureCapture per distinct id and the
// slab samples it by textureKey — THE texture registry, no parallel path.
// Pieces author in 90° steps, so face normals ride the quarter turn.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Pressable, Scene3D, Text } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { GAME_CAMERA, type Solved } from '../../../game/camera';
import { GAME_NATIVE_CAMERA } from '../../../game/nativeCamera';
import { raycastPieces, faceSlotLabels, describeFaceSkin, BUILD_FACE_SLOTS } from '../../../game/build';
import { TextureCapture } from '../../../game/textures/registry';
import { accentFor } from '../../../shell/workbench.cls';
import { buildingRender, stageTextureIds, type PieceRender } from './panel';
import type { BuildingsStore } from './store';

type Vec3 = [number, number, number];
type Rect = { x: number; y: number; width: number; height: number };

const NEUTRAL_PERCEPTION = { high: 0 } as any;
const SLAB = 0.02; // a major-face slab's thickness
const LIFT = 0.012; // proud of the core so the slab wins the depth test
const TEX_PX = 256;

function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }

/** quarter-turn unit normal of the piece's FRONT (yaw 0 faces +Z; positive
 *  yaw swings toward +X — the hmsc frame) */
function quarterNormal(yawDegrees: number): { nx: number; nz: number; odd: boolean } {
  const q = ((Math.round(yawDegrees / 90) % 4) + 4) % 4;
  if (q === 0) return { nx: 0, nz: 1, odd: false };
  if (q === 1) return { nx: 1, nz: 0, odd: true };
  if (q === 2) return { nx: 0, nz: -1, odd: false };
  return { nx: -1, nz: 0, odd: true };
}

function isPlate(kind: string): boolean {
  return kind === 'floor' || kind === 'roof' || kind === 'ramp' || kind === 'stairs';
}

function faceProps(look: { color?: string; textureId?: string }): { color: string; textureKey?: string } {
  if (look.textureId) return { color: '#ffffff', textureKey: `bldskin:${look.textureId}` };
  return { color: look.color ?? '#8b8f94' };
}

function PieceMeshes({ p }: { p: PieceRender }) {
  const w = p.size.widthMeters;
  const h = p.size.heightMeters;
  const d = p.size.depthMeters;
  const { nx, nz, odd } = quarterNormal(p.yawDegrees);
  const cx = p.x;
  const cy = p.y + h / 2;
  const cz = p.z;
  const plate = isPlate(p.kind);
  // core dims follow the quarter turn (no Mesh rotation — true-placed slabs)
  const core: Vec3 = odd ? [d, h, w] : [w, h, d];
  const sides = faceProps(p.faces.sides);
  const front = faceProps(p.faces.front);
  const back = faceProps(p.faces.back);

  const meshes: any[] = [];
  meshes.push(
    <Scene3D.Mesh key="core" geometry={Geometry.Box} params={{ width: core[0], height: core[1], depth: core[2] }}
      position={[cx, cy, cz]} color={sides.color} textureKey={sides.textureKey} />,
  );
  if (plate) {
    const dims: Vec3 = odd ? [d, SLAB, w] : [w, SLAB, d];
    meshes.push(
      <Scene3D.Mesh key="top" geometry={Geometry.Box} params={{ width: dims[0], height: dims[1], depth: dims[2] }}
        position={[cx, p.y + h + LIFT, cz]} color={front.color} textureKey={front.textureKey} />,
      <Scene3D.Mesh key="bottom" geometry={Geometry.Box} params={{ width: dims[0], height: dims[1], depth: dims[2] }}
        position={[cx, p.y - LIFT, cz]} color={back.color} textureKey={back.textureKey} />,
    );
  } else {
    const dims: Vec3 = odd ? [SLAB, h, w] : [w, h, SLAB];
    const off = d / 2 + LIFT;
    meshes.push(
      <Scene3D.Mesh key="front" geometry={Geometry.Box} params={{ width: dims[0], height: dims[1], depth: dims[2] }}
        position={[cx + nx * off, cy, cz + nz * off]} color={front.color} textureKey={front.textureKey} />,
      <Scene3D.Mesh key="back" geometry={Geometry.Box} params={{ width: dims[0], height: dims[1], depth: dims[2] }}
        position={[cx - nx * off, cy, cz - nz * off]} color={back.color} textureKey={back.textureKey} />,
    );
  }
  // the meaningful cutout, visible (door/garage sit on the ground, the rest center)
  if (p.edit) {
    const low = p.edit === 'door' || p.edit === 'garage' || p.edit === 'arch';
    const ew = 1.2;
    const eh = low ? 2.2 : 1.2;
    const ey = low ? p.y + eh / 2 : p.y + h * 0.55;
    const ed: Vec3 = odd ? [d + 0.06, eh, ew] : [ew, eh, d + 0.06];
    meshes.push(
      <Scene3D.Mesh key="edit" geometry={Geometry.Box} params={{ width: ed[0], height: ed[1], depth: ed[2] }}
        position={[cx, ey, cz]} color="#0c1018" />,
    );
  }
  if (p.selected) {
    meshes.push(
      <Scene3D.Mesh key="sel" geometry={Geometry.Box}
        params={{ width: core[0] + 0.12, height: core[1] + 0.12, depth: core[2] + 0.12 }}
        position={[cx, cy, cz]} material={{ color: accentFor('primary'), opacity: 0.25 }} />,
    );
  }
  return <>{meshes}</>;
}

export function BuildingStage(props: { store: BuildingsStore; buildingId: string }) {
  const { store, buildingId } = props;
  const pieces = buildingRender(store, buildingId);
  const textureIds = stageTextureIds(pieces);

  // ── the ObjectInspect3D orbit wire (engage once, params at change rate) ────
  const lookRef = useRef({ yaw: 35, pitch: 24 });
  const distRef = useRef(12);
  const cameraRef = useRef<any>(null);
  const ctlRef = useRef<ReturnType<typeof GAME_NATIVE_CAMERA.forNode> | null>(null);
  const rectRef = useRef<Rect>({ x: 0, y: 0, width: 800, height: 600 });
  const dragRef = useRef<{ x: number; y: number; moved: number } | null>(null);

  const frame = useMemo(() => {
    if (pieces.length === 0) return { target: [0, 1.5, 0] as Vec3, dist: 12 };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = 0;
    for (const p of pieces) {
      minX = Math.min(minX, p.x - p.size.widthMeters / 2);
      maxX = Math.max(maxX, p.x + p.size.widthMeters / 2);
      minZ = Math.min(minZ, p.z - p.size.widthMeters / 2);
      maxZ = Math.max(maxZ, p.z + p.size.widthMeters / 2);
      maxY = Math.max(maxY, p.y + p.size.heightMeters);
    }
    const radius = Math.max(maxX - minX, maxZ - minZ, maxY) / 2 + 2;
    return {
      target: [(minX + maxX) / 2, maxY / 2, (minZ + maxZ) / 2] as Vec3,
      dist: Math.max(8, radius * 2.4),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- frame follows the building, not per-edit identity
  }, [buildingId, pieces.length]);

  const solveShadow = (): Solved =>
    GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, {
      target: frame.target, yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, dist: distRef.current, fov: 42,
    });
  const [bootCam] = useState(() => solveShadow());

  const sendOrbit = () => {
    ctlRef.current?.setOrbit({
      target: frame.target, yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, distance: distRef.current, fov: 42,
    });
  };

  useEffect(() => {
    const nodeId = Number(cameraRef.current?.id ?? 0);
    if (!nodeId) {
      console.warn('[workbench/buildings] native camera not engaged (node id unavailable)');
      return;
    }
    const ctl = GAME_NATIVE_CAMERA.forNode(nodeId);
    ctlRef.current = ctl;
    ctl.setMode('orbit');
    sendOrbit();
    return () => { ctlRef.current = null; ctl.disable(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- engage once; params ride sendOrbit
  }, []);
  useEffect(() => {
    distRef.current = frame.dist;
    sendOrbit();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reframe on building switch
  }, [buildingId]);

  const onDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0), moved: 0 }; };
  const onMove = (e: any) => {
    const drag = dragRef.current;
    if (!drag) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    const dx = nx - drag.x, dy = ny - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = nx; drag.y = ny;
    const l = lookRef.current;
    const nextYaw = l.yaw - dx * 0.4;
    const nextPitch = clamp(l.pitch - dy * 0.3, 4, 85);
    ctlRef.current?.setInputDeltas(nextYaw - l.yaw, nextPitch - l.pitch);
    l.yaw = nextYaw;
    l.pitch = nextPitch;
  };
  const onUp = (e: any) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.moved >= 6) return; // a drag, not a pick
    const r = rectRef.current;
    const ray = GAME_CAMERA.screenRay(Number(e?.x ?? 0) - r.x, Number(e?.y ?? 0) - r.y, { x: 0, y: 0, width: r.width, height: r.height }, solveShadow());
    const placedLike = pieces.map((p, i) => ({
      id: `${i}`, pieceId: store.building(buildingId)!.pieces[i].pieceId,
      x: p.x, y: p.y, z: p.z, yawDegrees: p.yawDegrees,
    }));
    const hit = raycastPieces({ origin: { x: ray.origin[0], y: ray.origin[1], z: ray.origin[2] }, dir: { x: ray.dir[0], y: ray.dir[1], z: ray.dir[2] } }, placedLike, 500);
    store.selectPiece(buildingId, hit ? Number(hit.piece.id) : -1);
  };
  const onWheel = (e: any) => {
    const dy = Number(e?.deltaY ?? 0);
    distRef.current = clamp(distRef.current + (dy > 0 ? 1.5 : -1.5), 4, 80);
    sendOrbit();
  };

  // provenance caption — the resolution order, readable while it happens
  const sel = store.selectedPiece(buildingId);
  const caption = sel >= 0
    ? BUILD_FACE_SLOTS.map((slot) => {
        const labels = faceSlotLabels(pieces[sel]?.kind ?? 'wall');
        return `${labels[slot]}: ${describeFaceSkin(store.resolved(buildingId, sel, slot))}`;
      }).join('  ·  ')
    : 'click a piece to override its faces · drag orbit · wheel zoom';

  return (
    <Box style={{ flexGrow: 1, minHeight: 0, flexDirection: 'column' }}>
      {/* one capture per distinct material id — the slabs sample by textureKey */}
      {textureIds.map((id) => (
        <TextureCapture key={id} textureId={id} staticKey={`bldskin:${id}`}
          widthPx={TEX_PX} heightPx={TEX_PX} cols={1} floors={1} perception={NEUTRAL_PERCEPTION} />
      ))}
      <Pressable
        onLayout={(r: any) => { rectRef.current = { x: r.x, y: r.y, width: r.width, height: r.height }; }}
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onWheel={onWheel}
        style={{ width: '100%', flexGrow: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}
      >
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={accentFor('bgElevated')} showGrid showAxes={false}>
          {/* BUILDSTAGE-FIX (user verdict req_0184): THE stage kit's studio
              lighting — ModelScene's exact rig (ModelViewer.tsx:38-42). The
              building frames at 12-25m, where the auto-fog had faded every
              face into the dark bg ("extremely dark"): fog OFF + ambient +
              key light, read flat + fully lit like every other stage. */}
          <Scene3D.Fog enabled={false} />
          <Scene3D.AmbientLight color="#ffffff" intensity={0.55} />
          <Scene3D.DirectionalLight direction={[0.5, 1, 0.35]} color="#ffffff" intensity={0.95} />
          <Scene3D.Camera nativeCamera ref={cameraRef} position={bootCam.pos} target={bootCam.target} fov={bootCam.fov} />
          {pieces.map((p) => <PieceMeshes key={`${buildingId}:${p.index}`} p={p} />)}
        </Scene3D>
      </Pressable>
      <Box style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 7 }}>
        <Text fontSize={9} color={accentFor('textSecondary')} style={{ fontFamily: 'monospace' }}>{caption}</Text>
      </Box>
    </Box>
  );
}
