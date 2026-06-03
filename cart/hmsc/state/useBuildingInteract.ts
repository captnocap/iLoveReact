import { useEffect, useMemo, useRef } from 'react';
import { busOn } from '@reactjit/hooks/useIFTTT';
import { execAsync } from '@reactjit/hooks/process';
import type { GameState } from '../design';
import { runCommandLine } from '../commands/registry';
import { markGameStateUpdated } from './gameState';
import { buildingDoorFrontPoint } from '../world/buildings';
import { driveInBoothPoint, DRIVEIN_BOOTH_INTERACT_RANGE_METERS } from '../world/structures';
import { setDriveInSource } from './driveInScreens';
import { isInteriorSceneStep } from '../world/interiors';

// The E/F interact system for buildings — the discoverable counterpart to the
// walk-on door mats. Outside, standing near a closed (interior) building's door
// shows a "Press E to enter" prompt; pressing E runs the same wv_enter the mat
// fires, but proximity-based so the player doesn't have to land on an exact
// cell. Inside an interior, E always leaves (so the player can never be trapped).
// A target is either a command (runs through runCommandLine) or a callback
// (`onInteract`, for the drive-in projector booth's async file picker — opening
// a picker isn't a synchronous state transform, so it can't be a command).

const INTERACT_RANGE_METERS = 3.2;

// A target carries EITHER a command (door enter/leave) OR an onInteract callback
// (the drive-in booth's file picker). One prompt + one E-key handler serve both.
type InteractTarget = { prompt: string; command?: string; onInteract?: () => void };

// Open the system file picker (zenity) and play the chosen movie on this
// drive-in's screen. Async — the booth interaction is a callback, not a command.
async function pickDriveInMovie(buildingId: string): Promise<void> {
  const r = await execAsync(
    "zenity --file-selection --title='Pick a movie' " +
    "--file-filter='Video | *.mp4 *.mov *.webm *.mkv *.avi *.m4v *.ogv' " +
    "--file-filter='All files | *'",
  );
  const path = (r.stdout || '').trim();
  if (path) setDriveInSource(buildingId, path);
}

function resolveInteractTarget(state: GameState): InteractTarget | null {
  if (isInteriorSceneStep(state.sceneStep)) {
    return { command: 'wv_leave', prompt: 'Press E to leave' };
  }
  const player = state.player.position;
  let best: { dist: number; target: InteractTarget } | null = null;
  const consider = (dist: number, range: number, target: InteractTarget) => {
    if (dist <= range && (!best || dist < best.dist)) best = { dist, target };
  };
  for (const building of state.world.buildings) {
    // Drive-in: the projector booth opens the movie file picker.
    if (building.kind === 'driveIn') {
      const booth = driveInBoothPoint(building);
      const dist = Math.hypot(player.x - booth.x, player.z - booth.z);
      const id = building.id;
      consider(dist, DRIVEIN_BOOTH_INTERACT_RANGE_METERS, {
        prompt: 'Press E to pick a movie',
        onInteract: () => { void pickDriveInMovie(id); },
      });
      continue;
    }
    if (building.enclosure !== 'interior') continue;
    const door = buildingDoorFrontPoint(building);
    const dist = Math.hypot(player.x - door.x, player.z - door.z);
    consider(dist, INTERACT_RANGE_METERS, {
      command: `wv_enter ${building.id}`,
      prompt: `Press E to enter ${building.label}`,
    });
  }
  return best ? best.target : null;
}

export function useBuildingInteract(
  state: GameState,
  setGameState: (updater: (current: GameState) => GameState) => void,
  inputBlocked: boolean,
): { prompt: string | null } {
  const target = useMemo(
    () => resolveInteractTarget(state),
    [state.sceneStep, state.player.position.x, state.player.position.z, state.world.buildings],
  );

  const targetRef = useRef(target);
  targetRef.current = target;
  const blockedRef = useRef(inputBlocked);
  blockedRef.current = inputBlocked;

  useEffect(() => {
    return busOn('__keydown', (event: any) => {
      if (blockedRef.current) return;
      const key = String(event?.key ?? '').toLowerCase();
      if (key !== 'e' && key !== 'f') return;
      const next = targetRef.current;
      if (!next) return;
      if (next.onInteract) {
        next.onInteract();
        return;
      }
      if (!next.command) return;
      const command = next.command;
      setGameState((current) => {
        const result = runCommandLine(command, current, { source: 'interact' });
        return result.state === current ? current : markGameStateUpdated(result.state);
      });
    });
  }, [setGameState]);

  return { prompt: target?.prompt ?? null };
}
