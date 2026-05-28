import { useEffect, useRef, useState } from 'react';
import { Box, Pressable, Text } from '@reactjit/runtime/primitives';
import {
  CommandEntry,
  DEFAULT_AUTOSAVE_INTERVAL_MS,
  DEFAULT_LIVE_SYNC_INTERVAL_MS,
  GameState,
} from './design';
import { runCommandLine } from './commands/registry';
import {
  createInitialGameState,
  markGameStateUpdated,
  publishLiveGameState,
  readStoredGameState,
  saveGameState,
} from './state/gameState';
import { usePlayerDrive } from './state/usePlayerDrive';
import { GameWorld3D } from './render3d/GameWorld3D';
import { Hud } from './render/Hud';
import { Console } from './ui/Console';

const CAMERA_YAW_RADIANS_PER_PIXEL = 0.0032;
const CAMERA_PITCH_RADIANS_PER_PIXEL = 0.0024;
const CAMERA_SMOOTHING_PER_SECOND = 24;
const MAX_CAMERA_FRAME_SECONDS = 0.05;

function nextCommandEntryId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 100_000).toString(36)}`;
}

function commandEntry(kind: CommandEntry['kind'], text: string): CommandEntry {
  return { id: nextCommandEntryId(), kind, text };
}

function initialGameState(): GameState {
  return readStoredGameState() ?? createInitialGameState();
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function angleDeltaDegrees(fromDegrees: number, toDegrees: number): number {
  const deltaRadians = (toDegrees - fromDegrees) * Math.PI / 180;
  return Math.atan2(Math.sin(deltaRadians), Math.cos(deltaRadians)) * 180 / Math.PI;
}

export default function HmscCart() {
  const [gameState, setGameState] = useState<GameState>(initialGameState);
  const [commandLine, setCommandLine] = useState('');
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [cameraYawDegrees, setCameraYawDegrees] = useState(0);
  const [cameraPitchRadians, setCameraPitchRadians] = useState(0.05);
  const cameraDragRef = useRef<{ x: number; y: number } | null>(null);
  const cameraAimRef = useRef({ yawDegrees: 0, pitchRadians: 0.05 });
  const liveGameStateRef = useRef(gameState);
  const [entries, setEntries] = useState<CommandEntry[]>([
    commandEntry('output', 'HMSC console online. Run help.'),
  ]);
  const driveFrame = usePlayerDrive(!consoleOpen, cameraYawDegrees, setGameState);

  useEffect(() => {
    liveGameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    publishLiveGameState(liveGameStateRef.current);
    const liveSyncTimer = setInterval(() => {
      publishLiveGameState(liveGameStateRef.current);
    }, DEFAULT_LIVE_SYNC_INTERVAL_MS);
    return () => clearInterval(liveSyncTimer);
  }, []);

  useEffect(() => {
    const host: any = globalThis;
    const schedule = host.requestAnimationFrame ? host.requestAnimationFrame.bind(host) : (fn: any) => setTimeout(fn, 16);
    const cancel = host.cancelAnimationFrame ? host.cancelAnimationFrame.bind(host) : clearTimeout;
    let handle: any = 0;
    let lastNow = host.performance?.now?.() ?? Date.now();

    const tickCamera = () => {
      const now = host.performance?.now?.() ?? Date.now();
      const dt = Math.max(0.001, Math.min(MAX_CAMERA_FRAME_SECONDS, (now - lastNow) / 1000));
      lastNow = now;
      const smoothing = 1 - Math.exp(-CAMERA_SMOOTHING_PER_SECOND * dt);
      setCameraYawDegrees((yaw) => {
        const nextYaw = yaw + angleDeltaDegrees(yaw, cameraAimRef.current.yawDegrees) * smoothing;
        return Math.abs(angleDeltaDegrees(nextYaw, yaw)) < 0.001 ? yaw : nextYaw;
      });
      setCameraPitchRadians((pitch) => {
        const nextPitch = pitch + (cameraAimRef.current.pitchRadians - pitch) * smoothing;
        return Math.abs(nextPitch - pitch) < 0.0001 ? pitch : nextPitch;
      });
      handle = schedule(tickCamera);
    };

    handle = schedule(tickCamera);
    return () => cancel(handle);
  }, []);

  useEffect(() => {
    const autosaveTimer = setInterval(() => {
      setGameState((current) => saveGameState(current));
      setEntries((current) => [
        ...current.slice(-80),
        commandEntry('output', `autosaved ${new Date().toISOString()}`),
      ]);
    }, DEFAULT_AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(autosaveTimer);
  }, []);

  const submitCommand = (line: string) => {
    const result = runCommandLine(line, gameState);
    const nextState = result.state === gameState ? gameState : markGameStateUpdated(result.state);
    setGameState(nextState);
    setCommandLine('');
    setEntries((current) => [
      ...current.slice(-100),
      commandEntry('input', line),
      ...result.output.map((text) => commandEntry(text.startsWith('error:') ? 'error' : 'output', text)),
    ]);
  };

  const beginCameraDrag = (event: any) => {
    if (consoleOpen) return;
    cameraDragRef.current = { x: Number(event?.x ?? 0), y: Number(event?.y ?? 0) };
  };

  const moveCameraDrag = (event: any) => {
    const drag = cameraDragRef.current;
    if (!drag || consoleOpen) return;
    const x = Number(event?.x ?? drag.x);
    const y = Number(event?.y ?? drag.y);
    cameraAimRef.current.yawDegrees -= (x - drag.x) * CAMERA_YAW_RADIANS_PER_PIXEL * 180 / Math.PI;
    cameraAimRef.current.pitchRadians = clampNumber(
      cameraAimRef.current.pitchRadians + (y - drag.y) * CAMERA_PITCH_RADIANS_PER_PIXEL,
      -0.65,
      0.85,
    );
    drag.x = x;
    drag.y = y;
  };

  const endCameraDrag = () => {
    cameraDragRef.current = null;
  };

  return (
    <Pressable
      style={{ width: '100%', height: '100%', backgroundColor: '#020617' }}
      onMouseDown={beginCameraDrag}
      onMouseMove={moveCameraDrag}
      onMouseUp={endCameraDrag}
    >
      <GameWorld3D
        state={gameState}
        animationSeconds={driveFrame.animationSeconds}
        playerMoving={driveFrame.moving}
        playerRunning={driveFrame.running}
        cameraYawDegrees={cameraYawDegrees}
        cameraPitchRadians={cameraPitchRadians}
      />
      <Hud state={gameState} />
      <Box style={{ position: 'absolute', top: 16, left: 18, zIndex: 2 }}>
        <Pressable
          onPress={() => setConsoleOpen((open) => !open)}
          style={{
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 8,
            paddingBottom: 8,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: '#334155',
            backgroundColor: '#0f172a',
          }}
        >
          <Text fontSize={12} color="#f8fafc" style={{ fontWeight: 800 }}>
            {consoleOpen ? 'CLOSE CONSOLE' : 'CONSOLE'}
          </Text>
        </Pressable>
      </Box>
      {consoleOpen ? (
        <Box style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 420, zIndex: 1, borderBottomWidth: 1, borderBottomColor: '#334155' }}>
          <Console
            title="HMSC COMMAND"
            entries={entries}
            commandLine={commandLine}
            onCommandLineChange={setCommandLine}
            onSubmitCommand={submitCommand}
          />
        </Box>
      ) : null}
    </Pressable>
  );
}
