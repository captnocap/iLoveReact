import { useEffect, useMemo, useState } from 'react';
import { Box } from '@reactjit/runtime/primitives';
import {
  CommandEntry,
  DEFAULT_AUTOSAVE_INTERVAL_MS,
  GameState,
} from './design';
import { runCommandLine } from './commands/registry';
import {
  createInitialGameState,
  markGameStateUpdated,
  mirrorGameStateForHotReload,
  readStoredGameState,
  saveGameState,
} from './state/gameState';
import { Console } from './ui/Console';
import { MapCanvas } from './ui/MapCanvas';

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
  const [entries, setEntries] = useState<CommandEntry[]>([
    commandEntry('output', 'HMSC console online. Run help.'),
  ]);

  useEffect(() => {
    mirrorGameStateForHotReload(gameState);
  }, [gameState]);

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

  const shellWidth = useMemo(() => ({ width: 420 }), []);

  return (
    <Box style={{ width: '100%', height: '100%', flexDirection: 'row', backgroundColor: '#020617' }}>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <MapCanvas state={gameState} />
      </Box>
      <Box style={shellWidth}>
        <Console
          entries={entries}
          commandLine={commandLine}
          onCommandLineChange={setCommandLine}
          onSubmitCommand={submitCommand}
        />
      </Box>
    </Box>
  );
}
