import { useEffect, useRef, useState } from 'react';
import { busOn } from '@reactjit/hooks/useIFTTT';
import { runCommandLine } from '../commands/registry';
import type { GameState } from '../design';
import { cellEventRef, playerEventActor, recordAndPublishGameEvent } from '../events/gameEvents';
import { canOccupyWorldPosition, cellKey, placedCellAt, triggerCellAtWorldPosition, worldToCell } from '../world/grid';
import { currentZone } from '../world/zones';
import { isInteriorSceneStep } from '../world/interiors';
import { MIN_DRIVE_FRAME_SECONDS, MOVEMENT_INTENT_DEADZONE, NOCLIP_MIN_HEIGHT_METERS } from './defaults';
import { advanceHostPhysics, movementSurfaceForPlayer } from './hostPhysics';

type PlayerDriveFrame = {
  animationSeconds: number;
  moving: boolean;
  running: boolean;
  hostPhysicsUs: number;
};

const SDL_SCANCODE_C = 6;
const SDL_SCANCODE_SPACE = 44;
const SDL_SCANCODE_LCTRL = 224;
const SDL_SCANCODE_LSHIFT = 225;
const SDL_SCANCODE_RCTRL = 228;
const SDL_SCANCODE_RSHIFT = 229;

function radians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function hostScancodeDown(scancode: number): boolean {
  const host: any = globalThis;
  const fn = host.isKeyDown;
  if (typeof fn !== 'function') return false;
  const value = Number(fn(scancode));
  return Number.isFinite(value) && value > 0;
}

function normalizeYawDegrees(yawDegrees: number): number {
  return ((yawDegrees % 360) + 360) % 360;
}

// World cell triggers (doors, building entry/exit pads) fire in the outer city
// console scene AND inside building interiors (so the exit pad's wv_leave works);
// lab scenes intentionally do not fire them.
function triggersActive(sceneStep: string): boolean {
  return sceneStep === 'boot.console' || isInteriorSceneStep(sceneStep);
}

function runEnteredCellTrigger(state: GameState, lastTriggerKeyRef: { current: string | null }): GameState {
  if (!triggersActive(state.sceneStep)) {
    lastTriggerKeyRef.current = null;
    return state;
  }
  const triggerCell = triggerCellAtWorldPosition(state, state.player.position);
  if (!triggerCell?.triggerCommand) {
    lastTriggerKeyRef.current = null;
    return state;
  }
  const triggerKey = `${triggerCell.key}:${triggerCell.triggerCommand}`;
  if (lastTriggerKeyRef.current === triggerKey) return state;
  lastTriggerKeyRef.current = triggerKey;
  const triggerEvent = recordAndPublishGameEvent(state, {
    type: 'world.trigger.entered',
    source: 'player-drive',
    actor: playerEventActor(),
    subject: { kind: 'cell', id: triggerCell.key, label: triggerCell.triggerLabel },
    tags: ['world', 'trigger', 'story'],
    payload: {
      command: triggerCell.triggerCommand,
      label: triggerCell.triggerLabel ?? null,
      kind: triggerCell.kind,
    },
  });
  const result = runCommandLine(triggerCell.triggerCommand, triggerEvent.state, {
    source: 'world-trigger',
    parentEventId: triggerEvent.event.id,
  });
  return result.output.some((line) => line.startsWith('error:')) ? triggerEvent.state : result.state;
}

function recordEnteredPlayerCell(state: GameState, lastPlayerCellKeyRef: { current: string | null }): GameState {
  if (!triggersActive(state.sceneStep)) {
    lastPlayerCellKeyRef.current = null;
    return state;
  }
  const cell = worldToCell(state.player.position, state.world.cellSizeMeters);
  const key = cellKey(cell);
  if (lastPlayerCellKeyRef.current == null) {
    lastPlayerCellKeyRef.current = key;
    return state;
  }
  if (lastPlayerCellKeyRef.current === key) return state;
  lastPlayerCellKeyRef.current = key;
  const placedCell = placedCellAt(state, cell);
  return recordAndPublishGameEvent(state, {
    type: 'player.cell.entered',
    source: 'player-drive',
    actor: playerEventActor(),
    subject: cellEventRef(cell),
    tags: ['player', 'movement', 'cell'],
    payload: {
      cell,
      tileKind: placedCell?.kind ?? null,
      triggerCommand: placedCell?.triggerCommand ?? null,
    },
  }).state;
}

// Fire zone enter/exit on boundary crossings, the zones twin of
// runEnteredCellTrigger but at REGION granularity (innermost zone wins). The
// emitted zone.entered event is what drives the GTA name-flash HUD, so the flash
// happens for every zone regardless of onEnterCommand; the commands are EXTRA
// behavior. Debounced via lastZoneIdRef so it fires once per crossing.
function runZoneTransitions(state: GameState, lastZoneIdRef: { current: string | null }): GameState {
  if (!triggersActive(state.sceneStep)) {
    lastZoneIdRef.current = null;
    return state;
  }
  const zone = currentZone(state, state.player.position);
  const zoneId = zone?.id ?? null;
  if (zoneId === lastZoneIdRef.current) return state;
  const previousId = lastZoneIdRef.current;
  lastZoneIdRef.current = zoneId;

  let nextState = state;
  const previousZone = previousId != null ? nextState.world.zones.find((z) => z.id === previousId) : undefined;
  if (previousZone) {
    const exitEvent = recordAndPublishGameEvent(nextState, {
      type: 'zone.exited',
      source: 'player-drive',
      actor: playerEventActor(),
      subject: { kind: 'zone', id: previousZone.id, label: previousZone.name },
      tags: ['world', 'zone'],
      payload: { name: previousZone.name, flags: previousZone.flags },
    });
    nextState = exitEvent.state;
    if (previousZone.onExitCommand) {
      const result = runCommandLine(previousZone.onExitCommand, nextState, { source: 'world-zone', parentEventId: exitEvent.event.id });
      if (!result.output.some((line) => line.startsWith('error:'))) nextState = result.state;
    }
  }
  if (zone) {
    const enterEvent = recordAndPublishGameEvent(nextState, {
      type: 'zone.entered',
      source: 'player-drive',
      actor: playerEventActor(),
      subject: { kind: 'zone', id: zone.id, label: zone.name },
      tags: ['world', 'zone'],
      payload: { name: zone.name, flags: zone.flags, private: zone.flags.includes('private') },
    });
    nextState = enterEvent.state;
    if (zone.onEnterCommand) {
      const result = runCommandLine(zone.onEnterCommand, nextState, { source: 'world-zone', parentEventId: enterEvent.event.id });
      if (!result.output.some((line) => line.startsWith('error:'))) nextState = result.state;
    }
  }
  return nextState;
}

export function usePlayerDrive(
  enabled: boolean,
  cameraYawDegrees: number,
  setGameState: (updater: (current: GameState) => GameState) => void,
): PlayerDriveFrame {
  const enabledRef = useRef(enabled);
  const cameraYawRef = useRef(cameraYawDegrees);
  const keysRef = useRef<Record<string, boolean>>({});
  const lastTriggerKeyRef = useRef<string | null>(null);
  const lastPlayerCellKeyRef = useRef<string | null>(null);
  const lastZoneIdRef = useRef<string | null>(null);
  const [driveFrame, setDriveFrame] = useState<PlayerDriveFrame>({
    animationSeconds: 0,
    moving: false,
    running: false,
    hostPhysicsUs: 0,
  });
  // Last frame actually pushed to React state, so the idle tick can skip
  // redundant setDriveFrame calls that would re-reconcile the whole 3D tree.
  const lastEmittedFrameRef = useRef<PlayerDriveFrame>(driveFrame);

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
      const rawDt = Math.max(MIN_DRIVE_FRAME_SECONDS, (now - lastNow) / 1000);
      lastNow = now;

      let moving = false;
      let hostPhysicsUs = 0;
      let frameSeconds = rawDt;
      const running = !!(
        keysRef.current.__shift ||
        hostScancodeDown(SDL_SCANCODE_LSHIFT) ||
        hostScancodeDown(SDL_SCANCODE_RSHIFT)
      );
      if (enabledRef.current) {
        setGameState((current) => {
          const dt = Math.min(current.config.physics.maxDriveFrameSeconds, rawDt);
          frameSeconds = dt;
          const keys = keysRef.current;
          const cameraYaw = cameraYawRef.current;
          const cameraYawRadians = radians(cameraYaw);
          const forwardX = Math.sin(cameraYawRadians);
          const forwardZ = Math.cos(cameraYawRadians);
          const rightX = -Math.cos(cameraYawRadians);
          const rightZ = Math.sin(cameraYawRadians);
          const baseSpeed = running ? current.player.runSpeedMetersPerSecond : current.player.walkSpeedMetersPerSecond;
          const surface = movementSurfaceForPlayer(current, running);
          const speed = baseSpeed * surface.speedMultiplier;
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
          const jumpDown = !!(keys[' '] || keys.space || keys.spacebar || hostScancodeDown(SDL_SCANCODE_SPACE));
          const crouchDown = !!(
            keys.control ||
            keys.ctrl ||
            keys.c ||
            hostScancodeDown(SDL_SCANCODE_LCTRL) ||
            hostScancodeDown(SDL_SCANCODE_RCTRL) ||
            hostScancodeDown(SDL_SCANCODE_C)
          );

          let position = current.player.position;
          let yawDegrees = current.player.yawDegrees;
          const intentLength = Math.hypot(intentX, intentZ);
          if (current.player.noclip) {
            const moveX = intentLength > MOVEMENT_INTENT_DEADZONE ? intentX / intentLength : 0;
            const moveZ = intentLength > MOVEMENT_INTENT_DEADZONE ? intentZ / intentLength : 0;
            const verticalIntent = (jumpDown ? 1 : 0) - (crouchDown ? 1 : 0);
            const proposedPosition = {
              x: position.x + moveX * speed * dt,
              y: Math.max(NOCLIP_MIN_HEIGHT_METERS, position.y + verticalIntent * speed * dt),
              z: position.z + moveZ * speed * dt,
            };
            moving = intentLength > MOVEMENT_INTENT_DEADZONE || verticalIntent !== 0;
            if (intentLength > MOVEMENT_INTENT_DEADZONE) {
              yawDegrees = normalizeYawDegrees(Math.atan2(-moveX, -moveZ) * 180 / Math.PI);
            }
            if (!moving && yawDegrees === current.player.yawDegrees) return current;
            const nextState = {
              ...current,
              player: {
                ...current.player,
                position: proposedPosition,
                yawDegrees,
                physics: {
                  ...current.player.physics,
                  velocity: { x: 0, y: 0, z: 0 },
                  grounded: false,
                },
              },
            };
            return runZoneTransitions(runEnteredCellTrigger(recordEnteredPlayerCell(nextState, lastPlayerCellKeyRef), lastTriggerKeyRef), lastZoneIdRef);
          }
          const hostResult = advanceHostPhysics(
            current,
            dt,
            intentX,
            intentZ,
            speed,
            jumpDown,
            surface.accelerationMultiplier,
            surface.friction,
            surface.restitution,
          );
          if (hostResult) {
            hostPhysicsUs = hostResult.hostUs;
            moving = hostResult.moving;
            if (intentLength > MOVEMENT_INTENT_DEADZONE) {
              const moveX = intentX / intentLength;
              const moveZ = intentZ / intentLength;
              yawDegrees = normalizeYawDegrees(Math.atan2(-moveX, -moveZ) * 180 / Math.PI);
              const nextState = {
                ...hostResult.state,
                player: {
                  ...hostResult.state.player,
                  yawDegrees,
                },
              };
              return runZoneTransitions(runEnteredCellTrigger(recordEnteredPlayerCell(nextState, lastPlayerCellKeyRef), lastTriggerKeyRef), lastZoneIdRef);
            }
            return runZoneTransitions(runEnteredCellTrigger(recordEnteredPlayerCell(hostResult.state, lastPlayerCellKeyRef), lastTriggerKeyRef), lastZoneIdRef);
          }
          if (intentLength > MOVEMENT_INTENT_DEADZONE) {
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

          if (position === current.player.position && yawDegrees === current.player.yawDegrees) {
            return runZoneTransitions(runEnteredCellTrigger(recordEnteredPlayerCell(current, lastPlayerCellKeyRef), lastTriggerKeyRef), lastZoneIdRef);
          }
          const nextState = {
            ...current,
            player: {
              ...current.player,
              position,
              yawDegrees,
            },
          };
          return runZoneTransitions(runEnteredCellTrigger(recordEnteredPlayerCell(nextState, lastPlayerCellKeyRef), lastTriggerKeyRef), lastZoneIdRef);
        });
      }

      animationSeconds += frameSeconds;
      // Only push a new driveFrame when the rendered scene actually changes.
      // While idle, drivePose() ignores animationSeconds (fixed idle pose), so
      // advancing the clock into React state would re-reconcile the whole 3D
      // tree every frame for no visible effect. Emit while moving (the gait
      // needs the clock), and on any change to moving/running/hostPhysicsUs so
      // the moving->idle snap and physics readout still land.
      const nextRunning = moving && running;
      const last = lastEmittedFrameRef.current;
      if (moving || moving !== last.moving || nextRunning !== last.running || hostPhysicsUs !== last.hostPhysicsUs) {
        const frame = { animationSeconds, moving, running: nextRunning, hostPhysicsUs };
        lastEmittedFrameRef.current = frame;
        setDriveFrame(frame);
      }
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
