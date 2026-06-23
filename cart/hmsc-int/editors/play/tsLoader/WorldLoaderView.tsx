// WorldLoaderView.tsx — render a world the way world_loader.zig does: from BAKED
// FLAT DATA, not live GameState derivation.
//
// This is the editor-side experiment behind req_1695. /test (PlayRoute) re-derives
// its geometry/colliders from the GameState every render; the no-V8 /compiled
// loader instead reads one packed instance buffer and draws it. This view takes
// the SAME path inside V8: bake the GameState to the RJMP map container
// (createHmscMapfile — the exact encoder the bake uses), decode it with the TS
// constructor twin (tsLoader/decode), group the flat rows into instanced batches
// (tsLoader/buildBuckets), and draw. The camera is the host-side native FreeFly
// (no per-frame React), the same controller IsoPreview/ObjectInspect3D use — so
// once the scene mounts, the frame loop touches no JS reconciliation, mirroring
// the native loader. A HUD reports the LOAD cost (decode + batch build) so we can
// compare it against /compiled.

import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { Box, Pressable, Scene3D, Text } from '@reactjit/primitives';
import { Heightfield } from '@reactjit/geometries';
import { busOn } from '@reactjit/hooks/useIFTTT';
import type { GameState } from '../../../design';
import type { ChunkFloor } from '../../../chunkFloor';
import { GAME_CAMERA, GAME_NATIVE_CAMERA, GAME_LOOP, buildingsStream, piecesForMap, withBuildingPieces, worldStream } from '@game';
import { editorChannel } from '../../store';
import { createHmscMapfile } from '../../../packageMap';
import { sceneEnvironmentFromSky } from '../../../compile/sceneEnv';
import { buildHmscSky } from '../../../render3d/sky';
import { loadSceneFromMapContainer, type LoadedEnvironment } from './decode';
import { buildSceneBuckets } from './buildBuckets';

const FLY_SPEED = 45;
const FAR_CLIP = 4000;
const FOV = 65;

function hex(rgb: [number, number, number]): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
  return `#${c(rgb[0])}${c(rgb[1])}${c(rgb[2])}`;
}

export const WorldLoaderView = memo(function WorldLoaderView(props: {
  state: GameState;
  mapName: string;
  legacyPieceMapName?: string | null;
  floors?: readonly ChunkFloor[];
  wasdFocused?: boolean;
  onWasdFocus?: () => void;
}) {
  const { state } = props;
  const floors = props.floors ?? [];

  // Resolve the placed pieces the SAME way PlayRoute does (the one pieces view,
  // req_0513): loose world pieces ⊕ derived building stamps, scoped to the map.
  // Read once at mount — the loader takes a snapshot of the world, like /compiled
  // bakes a snapshot. (If this view graduates past an experiment, extract a shared
  // usePlacedPieces hook so it and PlayRoute can't drift.)
  const pieces = useMemo(() => {
    try {
      const worldState = editorChannel(worldStream).state();
      let buildingsState: any = null;
      try { buildingsState = editorChannel(buildingsStream).state(); } catch { buildingsState = null; }
      return withBuildingPieces(
        piecesForMap(worldState, props.mapName, { legacyMapName: props.legacyPieceMapName }),
        buildingsState,
        props.mapName,
      );
    } catch {
      return [];
    }
  }, [props.mapName, props.legacyPieceMapName]);

  // ── THE LOAD: bake → decode → batch, exactly the loader's path, timed. The
  // heavy lift (createHmscMapfile) is the derivation /compiled pays at bake time;
  // we measure decode + buildBuckets separately as the loader's true LOAD cost. ──
  const loaded = useMemo(() => {
    const sky = buildHmscSky(state.config.sky.hour, state.config.sky.weather, state.config.sky.gloom);
    const env = sceneEnvironmentFromSky(sky);
    const tBake = GAME_LOOP.now();
    const container = createHmscMapfile(state, pieces, floors, env, { includePlayerLumps: false });
    const tDecode = GAME_LOOP.now();
    const scene = loadSceneFromMapContainer(container);
    const tBuild = GAME_LOOP.now();
    const built = buildSceneBuckets(scene);
    const tDone = GAME_LOOP.now();
    const stats = {
      bytes: container.byteLength,
      bakeMs: tDecode - tBake,
      decodeMs: tBuild - tDecode,
      buildMs: tDone - tBuild,
      loadMs: tDone - tDecode, // decode + batch = the loader's LOAD (bake is /compiled's offline step)
      instances: scene.instanceCount,
      buckets: built.buckets.length,
      colliderRects: scene.colliders ? scene.colliders.rects.length / 9 : 0,
      heightfields: scene.heightfields.length,
    };
    // eslint-disable-next-line no-console
    console.warn(`[tsLoader] ${stats.instances} inst → ${stats.buckets} batch | decode ${stats.decodeMs.toFixed(1)}ms + build ${stats.buildMs.toFixed(1)}ms = LOAD ${stats.loadMs.toFixed(1)}ms (bake ${stats.bakeMs.toFixed(0)}ms, ${(stats.bytes / 1024).toFixed(0)}KB)`);
    for (const note of built.notes) console.warn(`[tsLoader]   note: ${note}`);
    return { scene, buckets: built.buckets, stats };
  }, [state, pieces, floors]);

  const env: LoadedEnvironment | null = loaded.scene.environment;
  const ambientColor = env ? hex(env.ambientColor) : '#ffffff';
  const ambientIntensity = env ? env.ambientIntensity : 0.5;
  const dir = env ? env.dir : [0.4, 1, 0.3];
  const dirColor = env ? hex(env.dirColor) : '#ffffff';
  const dirIntensity = env ? env.dirIntensity : 0.8;

  // ── native FreeFly camera (host-driven, no per-frame React) — IsoPreview rig ──
  const lookRef = useRef({ yaw: 200, pitch: -22 });
  const posRef = useRef<[number, number, number]>([0, 60, 160]);
  const cameraRef = useRef<any>(null);
  const cameraCtlRef = useRef<ReturnType<typeof GAME_NATIVE_CAMERA.forNode> | null>(null);
  const keysRef = useRef<Record<string, boolean>>({});
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const active = !!props.wasdFocused;
  const bootCam = useRef(GAME_CAMERA.solve(GAME_CAMERA.rigs.FreeFly, {
    position: posRef.current,
    yaw: lookRef.current.yaw,
    pitch: lookRef.current.pitch,
    fov: FOV,
  })).current;

  const sendMoveAxes = useCallback(() => {
    const ctl = cameraCtlRef.current;
    if (!ctl || !active) { ctl?.setMoveAxes(0, 0, 0, 0); return; }
    const k = keysRef.current;
    const forward = (k['w'] ? 1 : 0) + (k['s'] ? -1 : 0);
    const strafe = (k['d'] ? 1 : 0) + (k['a'] ? -1 : 0);
    const lift = ((k['e'] || k['space']) ? 1 : 0) + ((k['q'] || k['__shift']) ? -1 : 0);
    ctl.setMoveAxes(forward, strafe, lift, FLY_SPEED);
  }, [active]);

  useEffect(() => {
    const ctl = GAME_NATIVE_CAMERA.forNode(cameraRef.current);
    cameraCtlRef.current = ctl;
    ctl.setMode('freefly');
    ctl.setSmoothing(0);
    ctl.setFreeFly({ position: posRef.current, yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, fov: FOV });
    ctl.setMoveAxes(0, 0, 0, 0);
    return () => { ctl.setMoveAxes(0, 0, 0, 0); ctl.disable(); cameraCtlRef.current = null; };
  }, []);

  useEffect(() => { sendMoveAxes(); }, [sendMoveAxes]);

  useEffect(() => {
    const setk = (e: any, v: boolean) => {
      const k = String(e?.key ?? '').toLowerCase();
      if (k) keysRef.current[k] = v;
      if (typeof e?.shiftKey === 'boolean') keysRef.current['__shift'] = e.shiftKey;
      sendMoveAxes();
    };
    const offD = busOn('__keydown', (e: any) => setk(e, true));
    const offU = busOn('__keyup', (e: any) => setk(e, false));
    return () => { offD(); offU(); };
  }, [sendMoveAxes]);

  const onDown = (e: any) => { props.onWasdFocus?.(); dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; };
  const onMove = (e: any) => {
    const d = dragRef.current; if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    const dx = nx - d.x, dy = ny - d.y; d.x = nx; d.y = ny;
    const look = lookRef.current;
    const nextYaw = look.yaw + dx * 0.3;
    const nextPitch = Math.max(-89, Math.min(89, look.pitch - dy * 0.3));
    cameraCtlRef.current?.setInputDeltas(nextYaw - look.yaw, nextPitch - look.pitch);
    lookRef.current = { yaw: nextYaw, pitch: nextPitch };
  };
  const onUp = () => { dragRef.current = null; };

  const s = loaded.stats;
  return (
    <Box style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0a1018" showGrid={false} showAxes={false}>
        <Scene3D.Camera nativeCamera ref={cameraRef} position={bootCam.pos} target={bootCam.target} fov={bootCam.fov} far={FAR_CLIP} />
        <Scene3D.AmbientLight color={ambientColor} intensity={ambientIntensity} />
        <Scene3D.DirectionalLight direction={dir} color={dirColor} intensity={dirIntensity} />
        {/* the loaded city — one instanced batch per shape, the loader's draw */}
        {loaded.buckets.map((bk) => (
          <Scene3D.Instances
            key={bk.key}
            geometry={bk.geometry}
            params={bk.params}
            data={bk.data}
            count={bk.count}
            stride={12}
            textureKey={bk.textureKey}
            center={bk.center}
            boundsRadius={bk.boundsRadius}
          />
        ))}
        {/* the loaded terrain — each decoded heightfield as a lit mesh */}
        {loaded.scene.heightfields.map((f) => {
          const width = (f.cols - 1) * f.cellSizeMeters;
          const depth = (f.rows - 1) * f.cellSizeMeters;
          return (
            <Scene3D.Mesh
              key={`hf:${f.slot}`}
              geometry={Heightfield}
              params={{ heights: f.heights, cols: f.cols, rows: f.rows, width, depth, base: 0 }}
              material="#3a4a3e"
              position={[f.originX + width / 2, f.baseY, f.originZ + depth / 2]}
            />
          );
        })}
      </Scene3D>

      <Pressable
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001' }}
      />
      <Box style={{ position: 'absolute', left: 8, top: 8, padding: 6, backgroundColor: '#0a1018cc', borderRadius: 4 }}>
        <Text fontSize={10} color="#7dd3fc" style={{ fontFamily: 'monospace' }}>
          {`TS LOADER · ${s.instances} inst → ${s.buckets} batch`}
        </Text>
        <Text fontSize={10} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>
          {`LOAD ${s.loadMs.toFixed(1)}ms (decode ${s.decodeMs.toFixed(1)} + build ${s.buildMs.toFixed(1)})`}
        </Text>
        <Text fontSize={10} color="#64748b" style={{ fontFamily: 'monospace' }}>
          {`${s.colliderRects} colliders · ${s.heightfields} fields · ${(s.bytes / 1024).toFixed(0)}KB`}
        </Text>
      </Box>
      <Text fontSize={9} color={active ? '#7dd3fc' : '#475569'} style={{ fontFamily: 'monospace', position: 'absolute', left: 8, bottom: 8 }}>
        {active ? 'drag look · WASD fly · Q/E up/down' : 'click to focus · drag look · WASD fly'}
      </Text>
    </Box>
  );
});
