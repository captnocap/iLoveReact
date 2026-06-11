// NotesTab — a plain scratch pad. Controlled by the parent so its text persists
// through the workspace layer across hot reloads like the rest of the view state.
// The clear verb lives HERE, on the thing it clears (came home from the retired
// SettingsTab — one settings door, L4).

import { Box, Pressable, Text, TextArea } from '@reactjit/primitives';

export function NotesTab(props: { notes: string; onNotes: (s: string) => void }) {
  return (
    <Box style={{ width: '100%', height: '100%', padding: 8, gap: 6 }}>
      <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text fontSize={9} color="#64748b" style={{ fontWeight: 800, letterSpacing: 1 }}>NOTES</Text>
        <Pressable onPress={() => props.onNotes('')} style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3, borderRadius: 4, borderWidth: 1, borderColor: '#7f1d1d', backgroundColor: '#3d1414' }}>
          <Text fontSize={9} color="#fca5a5" style={{ fontWeight: 700 }}>clear</Text>
        </Pressable>
      </Box>
      <TextArea
        text={props.notes}
        onChangeText={props.onNotes}
        placeholder="Notes…"
        style={{
          width: '100%', flexGrow: 1, minHeight: 0,
          backgroundColor: '#0a111d', borderWidth: 1, borderColor: '#16202f', borderRadius: 4,
          padding: 10, color: '#cbd5e1', fontSize: 12, fontFamily: 'monospace',
        }}
      />
    </Box>
  );
}
