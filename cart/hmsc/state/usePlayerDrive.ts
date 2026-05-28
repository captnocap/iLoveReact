import { useEffect, useRef, useState } from 'react';
import { busOn } from '@reactjit/runtime/hooks/useIFTTT';
import type { GameState } from '../design';
import { canOccupyWorldPosition } from '../world/grid';

type PlayerDriveFrame = {
  animationSeconds: number;
  moving: boolean;
  running: boolean;
};

const MAX_FRAME_SECONDS = 0.05;

function radians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function normalizeYawDegrees(yawDegrees: number): number {
  return ((yawDegrees % 360) + 360) % 360;
}

export function usePlayerDrive(
  enabled: boolean,
  cameraYawDegrees: number,
  setGameState: (updater: (current: GameState) => GameState) => void,
): PlayerDriveFrame {
  const enabledRef = useRef(enabled);
  const cameraYawRef = useRef(cameraYawDegrees);
  const keysRef = useRef<Record<string, boolean>>({});
  const [driveFrame, setDriveFrame] = useState<PlayerDriveFrame>({
    animationSeconds: 0,
    moving: false,
    running: false,
  });

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    cameraYawRef.current = cameraYawDegrees;
  }, [cameraYawDegrees]);

  useEffect(() => {
    const setKey = (event: any, down: boolean) => {
      const key = String(event?.key ?? '').toLowerCase();
      if (key) keysRef.current[key] = down;
      if (typeof event?.shiftKey === 'boolean') keysRef.current.__shift = event.shiftKey;
    };
    const offDown = busOn('__keydown', (event: any) => setKey(event, true));
    const offUp = busOn('__keyup', (event: any) => setKey(event, false));

    const host: any = globalThis;
    const schedule = host.requestAnimationFrame ? host.requestAnimationFrame.bind(host) : (fn: any) => setTimeout(fn, 16);
    const cancel = host.cancelAnimationFrame ? host.cancelAnimationFrame.bind(host) : clearTimeout;
    let handle: any = 0;
    let lastNow = host.performance?.now?.() ?? Date.now();
    let animationSeconds = 0;

    const tick = () => {
      const now = host.performance?.now?.() ?? Date.now();
      const dt = Math.max(0.001, Math.min(MAX_FRAME_SECONDS, (now - lastNow) / 1000));
      lastNow = now;

      let moving = false;
      const running = !!keysRef.current.__shift;
      if (enabledRef.current) {
        setGameState((current) => {
          const keys = keysRef.current;
          const cameraYaw = cameraYawRef.current;
          const cameraYawRadians = radians(cameraYaw);
          const forwardX = Math.sin(cameraYawRadians);
          const forwardZ = Math.cos(cameraYawRadians);
          const rightX = Math.cos(cameraYawRadians);
          const rightZ = -Math.sin(cameraYawRadians);
          const speed = running ? current.player.runSpeedMetersPerSecond : current.player.walkSpeedMetersPerSecond;
          let intentX = 0;
          let intentZ = 0;
          if (keys.w || keys.up) {
            intentX += forwardX;
            intentZ += forwardZ;
          }
          if (keys.s || keys.down) {
            intentX -= forwardX;
            intentZ -= forwardZ;
          }
          if (keys.d || keys.right) {
            intentX += rightX;
            intentZ += rightZ;
          }
          if (keys.a || keys.left) {
            intentX -= rightX;
            intentZ -= rightZ;
          }

          let position = current.player.position;
          let yawDegrees = current.player.yawDegrees;
          const intentLength = Math.hypot(intentX, intentZ);
          if (intentLength > 0.001) {
            const moveX = intentX / intentLength;
            const moveZ = intentZ / intentLength;
            const proposedPosition = {
              x: position.x + moveX * speed * dt,
              y: position.y,
              z: position.z + moveZ * speed * dt,
            };
            if (canOccupyWorldPosition(current, proposedPosition)) {
              position = proposedPosition;
              moving = true;
              yawDegrees = normalizeYawDegrees(Math.atan2(-moveX, -moveZ) * 180 / Math.PI);
            }
          }

          if (position === current.player.position && yawDegrees === current.player.yawDegrees) return current;
          return {
            ...current,
            player: {
              ...current.player,
              position,
              yawDegrees,
            },
          };
        });
      }

      animationSeconds += dt;
      setDriveFrame({ animationSeconds, moving, running: moving && running });
      handle = schedule(tick);
    };

    handle = schedule(tick);
    return () => {
      cancel(handle);
      offDown();
      offUp();
    };
  }, [setGameState]);

  return driveFrame;
}
