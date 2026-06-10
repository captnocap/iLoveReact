import { Box, Pressable, ScrollView, Text, TextInput } from '@reactjit/primitives';
import type { CommandEntry } from '../design';

const QUICK_COMMANDS = ['cmd_help', 'gv_debug_hud', 'gv_sky', 'gv_time noon', 'gv_daycycle 1', 'gv_weather storm', 'gv_weather clear', 'gv_view', 'gv_view 80', 'gv_events', 'lab_spawn scale', 'lab_spawn textures', 'lab_spawn aim', 'lab_exit', 'pv_where', 'cmd_cheats 1', 'pv_noclip 1', 'gv_state player', 'gv_save', 'gv_reset'];

type ConsoleProps = {
  entries: CommandEntry[];
  commandLine: string;
  onCommandLineChange: (value: string) => void;
  onSubmitCommand: (line: string) => void;
  title?: string;
};

function entryColor(kind: CommandEntry['kind']): string {
  if (kind === 'input') return '#f8fafc';
  if (kind === 'error') return '#fb7185';
  return '#a7f3d0';
}

export function Console(props: ConsoleProps) {
  const submit = () => {
    const trimmed = props.commandLine.trim();
    if (!trimmed) return;
    props.onSubmitCommand(trimmed);
  };

  return (
    <Box style={{ height: '100%', backgroundColor: '#080b10', borderLeftWidth: 1, borderLeftColor: '#1f2937' }}>
      <Box style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#1f2937', gap: 8 }}>
        <Text fontSize={15} color="#f8fafc" style={{ fontWeight: 800 }}>{props.title ?? 'HMSC COMMAND'}</Text>
        <Box style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {QUICK_COMMANDS.map((command) => (
            <Pressable
              key={command}
              onPress={() => props.onSubmitCommand(command)}
              style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: '#111827', borderWidth: 1, borderColor: '#263244' }}
            >
              <Text fontSize={11} color="#cbd5e1" style={{ fontWeight: 700 }}>{command}</Text>
            </Pressable>
          ))}
        </Box>
      </Box>
      <ScrollView style={{ flex: 1, padding: 12 }} showScrollbar>
        <Box style={{ gap: 6 }}>
          {props.entries.map((entry) => (
            <Text key={entry.id} fontSize={12} color={entryColor(entry.kind)} style={{ fontFamily: 'monospace', lineHeight: 18 }}>
              {entry.kind === 'input' ? `> ${entry.text}` : entry.text}
            </Text>
          ))}
        </Box>
      </ScrollView>
      <Box style={{ padding: 12, borderTopWidth: 1, borderTopColor: '#1f2937', gap: 8 }}>
        <TextInput
          value={props.commandLine}
          onChange={props.onCommandLineChange}
          onSubmit={submit}
          onKeyDown={(event: any) => {
            if (event?.key === 'Enter') submit();
          }}
          placeholder="type a command"
          style={{
            height: 36,
            paddingLeft: 10,
            paddingRight: 10,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: '#334155',
            backgroundColor: '#020617',
            color: '#f8fafc',
            fontSize: 13,
            fontFamily: 'monospace',
          }}
        />
      </Box>
    </Box>
  );
}
