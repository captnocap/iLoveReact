import { useEffect, useRef, useState } from 'react';
import { Box, Pressable, Text } from '@reactjit/primitives';
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
  mirrorGameStateForHotReload,
  publishLiveGameState,
  readStoredGameState,
  saveGameState,
} from './state/gameState';
import { recordAndPublishGameEvent } from './events/gameEvents';
import { useHmscEventRules } from './events/useHmscEventRules';
import { HmscGameplayRig } from './gameplay/HmscGameplayRig';
import { normalizeSkyHour } from './render3d/sky';
import {
  REAL_MILLISECONDS_PER_MINUTE,
  SKY_TICK_INTERVAL_MS,
} from './state/defaults';
import { Console } from './ui/Console';

function nextCommandEntryId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 100_000).toString(36)}`;
}

function commandEntry(kind: CommandEntry['kind'], text: string): CommandEntry {
  return { id: nextCommandEntryId(), kind, text };
}

function initialGameState(): GameState {
  return readStoredGameState() ?? createInitialGameState();
}

export default function HmscCart() {
  const [gameState, setGameState] = useState<GameState>(initialGameState);
  const [commandLine, setCommandLine] = useState('');
  const [consoleOpen, setConsoleOpen] = useState(false);
  const liveGameStateRef = useRef(gameState);
  const [entries, setEntries] = useState<CommandEntry[]>([
    commandEntry('output', 'HMSC console online. Run cmd_help.'),
  ]);

  useHmscEventRules(setGameState);

  useEffect(() => {
    liveGameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    setGameState((current) => recordAndPublishGameEvent(current, {
      type: 'game.booted',
      source: 'hmsc-cart',
      actor: { kind: 'system', id: 'hmsc' },
      tags: ['game'],
      payload: {
        sessionName: current.sessionName,
        sceneStep: current.sceneStep,
      },
    }).state);
  }, []);

  useEffect(() => {
    publishLiveGameState(liveGameStateRef.current);
    const liveSyncTimer = setInterval(() => {
      publishLiveGameState(liveGameStateRef.current);
    }, DEFAULT_LIVE_SYNC_INTERVAL_MS);
    // Full-state hot-reload mirror on a slow cadence — the heavy
    // JSON.stringify(whole-state) must NOT ride the 100ms live-sync loop or it
    // periodically stalls a frame past the vblank (fps variance). 2s is plenty
    // fresh for dev hot reload.
    const hotMirrorTimer = setInterval(() => {
      mirrorGameStateForHotReload(liveGameStateRef.current);
    }, 2000);
    return () => {
      clearInterval(liveSyncTimer);
      clearInterval(hotMirrorTimer);
    };
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

  useEffect(() => {
    const skyTimer = setInterval(() => {
      setGameState((current) => {
        const sky = current.config.sky;
        if (!sky.dayCycleEnabled || sky.cycleHoursPerRealMinute === 0) return current;
        const hourDelta = sky.cycleHoursPerRealMinute * SKY_TICK_INTERVAL_MS / REAL_MILLISECONDS_PER_MINUTE;
        const nextHour = normalizeSkyHour(sky.hour + hourDelta);
        return markGameStateUpdated({
          ...current,
          config: {
            ...current.config,
            sky: {
              ...sky,
              hour: nextHour,
            },
          },
        });
      });
    }, SKY_TICK_INTERVAL_MS);
    return () => clearInterval(skyTimer);
  }, []);

  const submitCommand = (line: string) => {
    const result = runCommandLine(line, gameState, { source: 'console' });
    const nextState = result.state === gameState ? gameState : markGameStateUpdated(result.state);
    setGameState(nextState);
    setCommandLine('');
    setEntries((current) => [
      ...current.slice(-100),
      commandEntry('input', line),
      ...result.output.map((text) => commandEntry(text.startsWith('error:') ? 'error' : 'output', text)),
    ]);
  };

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#020617' }}>
      <HmscGameplayRig
        state={gameState}
        setGameState={setGameState}
        inputBlocked={consoleOpen}
      />
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
    </Box>
  );
}
