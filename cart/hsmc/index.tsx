import { useEffect, useState } from 'react';
import { Box, Pressable, Text } from '@reactjit/runtime/primitives';
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

function nextCommandEntryId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 100_000).toString(36)}`;
}

function commandEntry(kind: CommandEntry['kind'], text: string): CommandEntry {
  return { id: nextCommandEntryId(), kind, text };
}

function initialGameState(): GameState {
  return readStoredGameState() ?? createInitialGameState();
}

export default function HsmcCart() {
  const [gameState, setGameState] = useState<GameState>(initialGameState);
  const [commandLine, setCommandLine] = useState('');
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [entries, setEntries] = useState<CommandEntry[]>([
    commandEntry('output', 'HSMC console online. Run help.'),
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

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#020617' }}>
      <Box style={{ position: 'absolute', top: 12, right: 12, zIndex: 2 }}>
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
            title="HSMC COMMAND"
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
