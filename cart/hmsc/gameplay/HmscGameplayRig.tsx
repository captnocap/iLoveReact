import { useEffect, useRef, useState } from 'react';
import { busOn } from '@reactjit/runtime/hooks/useIFTTT';
import { Box, Pressable, Text } from '@reactjit/runtime/primitives';
import type { GameState } from '../design';
import { HmscDebugHud } from '../render/DebugHud';
import { Hud } from '../render/Hud';
import { GameWorld3D } from '../render3d/GameWorld3D';
import { HmscTileTextureSources } from '../render3d/tileTextures';
import { usePlayerDrive } from '../state/usePlayerDrive';
import { angleDeltaDegrees, clampCameraValue, HMSC_GAMEPLAY_CAMERA } from './camera';

type HmscGameplayRigProps = {
  state: GameState;
  setGameState: (updater: (current: GameState) => GameState) => void;
  inputBlocked: boolean;
  sceneChildren?: any | ((context: HmscGameplayRigSceneContext) => any);
};

export type HmscGameplayRigSceneContext = {
  cameraYawDegrees: number;
  cameraPitchRadians: number;
  aiming: boolean;
  animationSeconds: number;
  playerMoving: boolean;
  playerRunning: boolean;
};

function readHostNumber(name: string, fallback = 0): number {
  const host: any = globalThis;
  const fn = host[name];
  if (typeof fn !== 'function') return fallback;
  const value = Number(fn());
  return Number.isFinite(value) ? value : fallback;
}

function readHostMouseDelta(): { dx: number; dy: number } {
  const host: any = globalThis;
  const fn = host.__mouse_delta;
  if (typeof fn !== 'function') return { dx: 0, dy: 0 };
  const value = fn();
  const dx = Number(value?.dx ?? 0);
  const dy = Number(value?.dy ?? 0);
  return {
    dx: Number.isFinite(dx) ? dx : 0,
    dy: Number.isFinite(dy) ? dy : 0,
  };
}

function setHostMouseCapture(enabled: boolean): void {
  const host: any = globalThis;
  if (typeof host.__mouse_capture === 'function') {
    host.__mouse_capture(enabled ? 1 : 0);
  }
}

function HmscAimCrosshair(props: { aiming: boolean }) {
  if (!props.aiming) return null;
  const size = 42;
  const line = 12;
  const color = '#f8fafc';
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
      <Box style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Box style={{ position: 'absolute', left: 0, top: size / 2 - 1, width: line, height: 2, backgroundColor: '#020617' }} />
        <Box style={{ position: 'absolute', right: 0, top: size / 2 - 1, width: line, height: 2, backgroundColor: '#020617' }} />
        <Box style={{ position: 'absolute', top: 0, left: size / 2 - 1, width: 2, height: line, backgroundColor: '#020617' }} />
        <Box style={{ position: 'absolute', bottom: 0, left: size / 2 - 1, width: 2, height: line, backgroundColor: '#020617' }} />
        <Box style={{ position: 'absolute', left: 1, top: size / 2 - 1, width: line - 2, height: 2, backgroundColor: color }} />
        <Box style={{ position: 'absolute', right: 1, top: size / 2 - 1, width: line - 2, height: 2, backgroundColor: color }} />
        <Box style={{ position: 'absolute', top: 1, left: size / 2 - 1, width: 2, height: line - 2, backgroundColor: color }} />
        <Box style={{ position: 'absolute', bottom: 1, left: size / 2 - 1, width: 2, height: line - 2, backgroundColor: color }} />
        <Box style={{ width: 6, height: 6, borderRadius: 3, borderWidth: 1, borderColor: color, backgroundColor: '#020617' }} />
      </Box>
    </Box>
  );
}

export function HmscGameplayRig(props: HmscGameplayRigProps) {
  const [cameraYawDegrees, setCameraYawDegrees] = useState(0);
  const [cameraPitchRadians, setCameraPitchRadians] = useState(HMSC_GAMEPLAY_CAMERA.defaultPitchRadians);
  const [aiming, setAiming] = useState(false);
  const [mouseFocused, setMouseFocused] = useState(false);
  const aimingRef = useRef(false);
  const mouseFocusedRef = useRef(false);
  const cameraPointerRef = useRef<{ x: number; y: number; ready: boolean }>({ x: 0, y: 0, ready: false });
  const cameraAimRef = useRef({
    yawDegrees: 0,
    pitchRadians: HMSC_GAMEPLAY_CAMERA.defaultPitchRadians,
  });
  const driveFrame = usePlayerDrive(!props.inputBlocked, cameraYawDegrees, props.setGameState);

  useEffect(() => {
    mouseFocusedRef.current = mouseFocused;
    setHostMouseCapture(mouseFocused && !props.inputBlocked);
    if (!mouseFocused || props.inputBlocked) cameraPointerRef.current.ready = false;
    return () => setHostMouseCapture(false);
  }, [mouseFocused, props.inputBlocked]);

  useEffect(() => {
    return busOn('__keydown', (event: any) => {
      if (String(event?.key ?? '').toLowerCase() === 'escape') {
        setMouseFocused(false);
      }
    });
  }, []);

  useEffect(() => {
    const host: any = globalThis;
    const schedule = host.requestAnimationFrame ? host.requestAnimationFrame.bind(host) : (fn: any) => setTimeout(fn, 16);
    const cancel = host.cancelAnimationFrame ? host.cancelAnimationFrame.bind(host) : clearTimeout;
    let handle: any = 0;
    let lastNow = host.performance?.now?.() ?? Date.now();

    const tickCamera = () => {
      const now = host.performance?.now?.() ?? Date.now();
      const frameSeconds = Math.max(
        HMSC_GAMEPLAY_CAMERA.minFrameSeconds,
        Math.min(HMSC_GAMEPLAY_CAMERA.maxFrameSeconds, (now - lastNow) / 1000),
      );
      lastNow = now;
      const smoothing = 1 - Math.exp(-HMSC_GAMEPLAY_CAMERA.smoothingPerSecond * frameSeconds);
      const nextAiming = !props.inputBlocked && readHostNumber('getMouseRightDown', 0) > 0;
      if (aimingRef.current !== nextAiming) {
        aimingRef.current = nextAiming;
        setAiming(nextAiming);
      }
      const pointer = cameraPointerRef.current;
      if (props.inputBlocked) {
        pointer.ready = false;
      } else if (mouseFocusedRef.current) {
        const { dx, dy } = readHostMouseDelta();
        if (Math.abs(dx) < HMSC_GAMEPLAY_CAMERA.maxMouseDeltaPixels && Math.abs(dy) < HMSC_GAMEPLAY_CAMERA.maxMouseDeltaPixels) {
          cameraAimRef.current.yawDegrees -= dx * HMSC_GAMEPLAY_CAMERA.yawRadiansPerPixel * 180 / Math.PI;
          cameraAimRef.current.pitchRadians = clampCameraValue(
            cameraAimRef.current.pitchRadians + dy * HMSC_GAMEPLAY_CAMERA.pitchRadiansPerPixel,
            HMSC_GAMEPLAY_CAMERA.minPitchRadians,
            HMSC_GAMEPLAY_CAMERA.maxPitchRadians,
          );
        }
      } else {
        const x = readHostNumber('getMouseX', pointer.x);
        const y = readHostNumber('getMouseY', pointer.y);
        if (!pointer.ready) {
          pointer.x = x;
          pointer.y = y;
          pointer.ready = true;
        } else {
          const dx = x - pointer.x;
          const dy = y - pointer.y;
          if (Math.abs(dx) < HMSC_GAMEPLAY_CAMERA.maxMouseDeltaPixels && Math.abs(dy) < HMSC_GAMEPLAY_CAMERA.maxMouseDeltaPixels) {
            cameraAimRef.current.yawDegrees -= dx * HMSC_GAMEPLAY_CAMERA.yawRadiansPerPixel * 180 / Math.PI;
            cameraAimRef.current.pitchRadians = clampCameraValue(
              cameraAimRef.current.pitchRadians + dy * HMSC_GAMEPLAY_CAMERA.pitchRadiansPerPixel,
              HMSC_GAMEPLAY_CAMERA.minPitchRadians,
              HMSC_GAMEPLAY_CAMERA.maxPitchRadians,
            );
          }
          pointer.x = x;
          pointer.y = y;
        }
      }
      setCameraYawDegrees((yaw) => {
        const nextYaw = yaw + angleDeltaDegrees(yaw, cameraAimRef.current.yawDegrees) * smoothing;
        return Math.abs(angleDeltaDegrees(nextYaw, yaw)) < HMSC_GAMEPLAY_CAMERA.settledYawDegrees ? yaw : nextYaw;
      });
      setCameraPitchRadians((pitch) => {
        const nextPitch = pitch + (cameraAimRef.current.pitchRadians - pitch) * smoothing;
        return Math.abs(nextPitch - pitch) < HMSC_GAMEPLAY_CAMERA.settledPitchRadians ? pitch : nextPitch;
      });
      handle = schedule(tickCamera);
    };

    handle = schedule(tickCamera);
    return () => cancel(handle);
  }, [props.inputBlocked]);

  const resetCameraPointer = () => {
    cameraPointerRef.current.ready = false;
  };

  const focusMouseLook = () => {
    if (props.inputBlocked) return;
    resetCameraPointer();
    setMouseFocused(true);
  };

  const sceneContext: HmscGameplayRigSceneContext = {
    cameraYawDegrees,
    cameraPitchRadians,
    aiming,
    animationSeconds: driveFrame.animationSeconds,
    playerMoving: driveFrame.moving,
    playerRunning: driveFrame.running,
  };
  const sceneChildren = typeof props.sceneChildren === 'function'
    ? props.sceneChildren(sceneContext)
    : props.sceneChildren;

  return (
    <Pressable
      style={{ width: '100%', height: '100%', backgroundColor: '#020617' }}
      onMouseDown={focusMouseLook}
      onMouseUp={resetCameraPointer}
      onMouseLeave={resetCameraPointer}
    >
      <GameWorld3D
        state={props.state}
        animationSeconds={driveFrame.animationSeconds}
        playerMoving={driveFrame.moving}
        playerRunning={driveFrame.running}
        cameraYawDegrees={cameraYawDegrees}
        cameraPitchRadians={cameraPitchRadians}
        aiming={aiming}
        sceneChildren={sceneChildren}
      />
      <HmscAimCrosshair aiming={aiming} />
      {!mouseFocused && !props.inputBlocked ? (
        <Box style={{ position: 'absolute', left: 18, bottom: 18, paddingLeft: 10, paddingRight: 10, paddingTop: 7, paddingBottom: 7, borderRadius: 6, borderWidth: 1, borderColor: '#334155', backgroundColor: '#020617cc', zIndex: 2 }}>
          <Text fontSize={11} color="#cbd5e1">click to focus mouse look - Esc releases</Text>
        </Box>
      ) : null}
      <Hud state={props.state} />
      {props.state.command.debugHudEnabled ? (
        <HmscDebugHud
          state={props.state}
          cameraYawDegrees={cameraYawDegrees}
          cameraPitchRadians={cameraPitchRadians}
          aiming={aiming}
          mouseFocused={mouseFocused}
          playerMoving={driveFrame.moving}
          playerRunning={driveFrame.running}
          hostPhysicsUs={driveFrame.hostPhysicsUs}
        />
      ) : null}
      <HmscTileTextureSources />
    </Pressable>
  );
}
