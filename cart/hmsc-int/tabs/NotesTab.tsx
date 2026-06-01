// NotesTab — a plain scratch pad. Controlled by the parent so its text persists
// through the workspace layer across hot reloads like the rest of the view state.

import { Box, TextArea } from '@reactjit/primitives';

export function NotesTab(props: { notes: string; onNotes: (s: string) => void }) {
  return (
    <Box style={{ width: '100%', height: '100%', padding: 8 }}>
      <TextArea
        text={props.notes}
        onChangeText={props.onNotes}
        placeholder="Notes…"
        style={{
          width: '100%', height: '100%', flexGrow: 1,
          backgroundColor: '#0a111d', borderWidth: 1, borderColor: '#16202f', borderRadius: 4,
          padding: 10, color: '#cbd5e1', fontSize: 12, fontFamily: 'monospace',
        }}
      />
    </Box>
  );
}
