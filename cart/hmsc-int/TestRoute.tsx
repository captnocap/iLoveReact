import { useEffect, useRef, useState } from 'react';
import { Box, Pressable, Scene3D, Text } from '@reactjit/primitives';
import { busOn } from '@reactjit/hooks/useIFTTT';
import type { GameState, Vec3 } from '../hmsc/design';
import { WorldStatics } from '../hmsc/render3d/GameWorld3D';
import { PlayerFigure } from '../hmsc/render3d/PlayerFigure';
import { TileSurfaceCaptures } from '../hmsc/render3d/tileSurface';
import { RoadSurfaceCaptures } from '../hmsc/render3d/Road';
import { RoadJunctionCaptures } from '../hmsc/render3d/RoadJunctions';
import { LandformSurfaceCaptures } from '../hmsc/render3d/Landform';
import { BuildingSurfaceCaptures } from '../hmsc/render3d/BuildingFacades';
import { PropSurfaceCaptures } from '../hmsc/render3d/PropCaptures';
import { WorldPartCaptures } from '../hmsc/render3d/PartCaptures';
import { DriveInScreenCaptures } from '../hmsc/render3d/driveInScreen';
import { HumanoidFaceCaptures } from '../hmsc/render3d/humanoid';
import { hmscSkyBackgroundColor } from '../hmsc/render3d/sky';
import { landformGroundTopAt } from '../hmsc/world/landforms';
import { surfaceRegionTopMeters } from '../hmsc/world/surfaceHeights';

type PlayerPose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  moving: boolean;
  running: boolean;
  anim: number;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function normalizeYawDegrees(yawDegrees: number): number {
  return ((yawDegrees % 360) + 360) % 360;
}

function groundTop(state: GameState, x: number, z: number): number {
  let top = 0;
  const c = state.world.cellSizeMeters;
  for (const r of state.world.surfaceRegions) {
    if (x >= r.x * c && x <= (r.x + r.width) * c && z >= r.z * c && z <= (r.z + r.depth) * c) {
      top = Math.max(top, surfaceRegionTopMeters(r, c));
    }
  }
  return Math.max(top, landformGroundTopAt(state, x, z) ?? top);
}

function initialPlayer(state: GameState): PlayerPose {
  const p = state.player;
  const y = groundTop(state, p.position.x, p.position.z);
  return { x: p.position.x, y, z: p.position.z, yaw: p.yawDegrees, moving: false, running: false, anim: 0 };
}

function cameraFor(p: PlayerPose, yaw: number, pitch: number): { pos: [number, number, number]; target: [number, number, number] } {
  const yr = yaw * Math.PI / 180;
  const pr = pitch * Math.PI / 180;
  const dist = 7.4;
  const flat = dist * Math.cos(pr);
  const target: [number, number, number] = [p.x, p.y + 1.45, p.z];
  return {
    pos: [
      p.x - Math.sin(yr) * flat,
      p.y + 2.5 + Math.sin(pr) * dist,
      p.z - Math.cos(yr) * flat,
    ],
    target,
  };
}

export function TestRoute(props: { state: GameState; mapName: string; onExit: () => void }) {
  const [player, setPlayer] = useState(() => initialPlayer(props.state));
  const playerRef = useRef(player);
  playerRef.current = player;
  const [look, setLook] = useState(() => ({ yaw: props.state.player.yawDegrees, pitch: 10 }));
  const lookRef = useRef(look);
  lookRef.current = look;
  const keysRef = useRef<Record<string, boolean>>({});
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const next = initialPlayer(props.state);
    playerRef.current = next;
    setPlayer(next);
    setLook((l) => ({ ...l, yaw: props.state.player.yawDegrees }));
  }, [props.state]);

  useEffect(() => {
    const setKey = (e: any, down: boolean) => {
      const k = String(e?.key ?? '').toLowerCase();
      if (k) keysRef.current[k] = down;
      if (typeof e?.shiftKey === 'boolean') keysRef.current['__shift'] = e.shiftKey;
    };
    const offD = busOn('__keydown', (e: any) => setKey(e, true));
    const offU = busOn('__keyup', (e: any) => setKey(e, false));
    return () => { offD(); offU(); };
  }, []);

  useEffect(() => {
    const g: any = globalThis;
    const sched = g.requestAnimationFrame ? g.requestAnimationFrame.bind(g) : (fn: any) => setTimeout(fn, 16);
    let alive = true;
    let last = g.performance?.now?.() ?? 0;
    const loop = () => {
      if (!alive) return;
      const now = g.performance?.now?.() ?? last + 16;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      const k = keysRef.current;
      const running = !!k['__shift'];
      const speed = (running ? props.state.player.runSpeedMetersPerSecond : props.state.player.walkSpeedMetersPerSecond) || (running ? 7 : 4);
      const yaw = lookRef.current.yaw * Math.PI / 180;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      let mx = 0, mz = 0;
      if (k['w'] || k['arrowup']) { mx += fx; mz += fz; }
      if (k['s'] || k['arrowdown']) { mx -= fx; mz -= fz; }
      if (k['d'] || k['arrowright']) { mx += rx; mz += rz; }
      if (k['a'] || k['arrowleft']) { mx -= rx; mz -= rz; }
      const mag = Math.hypot(mx, mz);
      if (mag > 0.001) {
        const prev = playerRef.current;
        const x = prev.x + (mx / mag) * speed * dt;
        const z = prev.z + (mz / mag) * speed * dt;
        const next = { x, y: groundTop(props.state, x, z), z, yaw: normalizeYawDegrees(Math.atan2(-mx, -mz) * 180 / Math.PI), moving: true, running, anim: prev.anim + dt };
        playerRef.current = next;
        setPlayer(next);
      } else if (playerRef.current.moving || playerRef.current.running) {
        const next = { ...playerRef.current, moving: false, running: false };
        playerRef.current = next;
        setPlayer(next);
      }
      sched(loop);
    };
    sched(loop);
    return () => { alive = false; };
  }, [props.state]);

  const onDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; };
  const onMove = (e: any) => {
    const d = dragRef.current;
    if (!d) return;
    const x = Number(e?.x ?? 0), y = Number(e?.y ?? 0);
    const dx = x - d.x, dy = y - d.y;
    d.x = x; d.y = y;
    setLook((l) => ({ yaw: l.yaw + dx * 0.28, pitch: clamp(l.pitch - dy * 0.22, -18, 58) }));
  };
  const onUp = () => { dragRef.current = null; };
  const resetPlayer = () => {
    const next = initialPlayer(props.state);
    playerRef.current = next;
    setPlayer(next);
    setLook((l) => ({ ...l, yaw: next.yaw }));
  };

  const cam = cameraFor(player, look.yaw, look.pitch);
  const sceneState = {
    ...props.state,
    player: {
      ...props.state.player,
      position: { x: player.x, y: player.y, z: player.z } as Vec3,
      yawDegrees: player.yaw,
    },
  };

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#080d16' }}>
      <TileSurfaceCaptures regions={sceneState.world.surfaceRegions} />
      <RoadSurfaceCaptures roads={sceneState.world.roads} />
      <RoadJunctionCaptures junctions={sceneState.world.junctions} />
      <LandformSurfaceCaptures landforms={sceneState.world.landforms ?? []} />
      <BuildingSurfaceCaptures buildings={sceneState.world.buildings} perception={sceneState.player.perception} />
      <PropSurfaceCaptures props={sceneState.world.props} />
      <WorldPartCaptures buildings={sceneState.world.buildings} props={sceneState.world.props} perception={sceneState.player.perception} />
      <DriveInScreenCaptures buildings={sceneState.world.buildings} />
      <HumanoidFaceCaptures />
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={hmscSkyBackgroundColor(sceneState.config.sky)} showGrid={false} showAxes={false}>
        <Scene3D.Camera position={cam.pos} target={cam.target} fov={52} far={sceneState.config.view.drawRadiusMeters} />
        <Scene3D.Fog enabled={false} />
        <WorldStatics world={sceneState.world} skyConfig={sceneState.config.sky} />
        <PlayerFigure position={sceneState.player.position} yawDegrees={sceneState.player.yawDegrees} animationSeconds={player.anim} moving={player.moving} running={player.running} />
      </Scene3D>

      <Pressable onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001' }} />

      <Box style={{ position: 'absolute', left: 12, top: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable onPress={props.onExit} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e' }}>
          <Text fontSize={11} color="#cbd5e1" style={{ fontWeight: 700 }}>Back</Text>
        </Pressable>
        <Pressable onPress={resetPlayer} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e' }}>
          <Text fontSize={11} color="#cbd5e1" style={{ fontWeight: 700 }}>Drop in</Text>
        </Pressable>
        <Text fontSize={10} color="#64748b" style={{ fontFamily: 'monospace' }}>{props.mapName} · WASD move · drag camera · Shift run</Text>
      </Box>
    </Box>
  );
}
