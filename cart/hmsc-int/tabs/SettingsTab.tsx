// SettingsTab — the editor's settings home. Real, working controls live here as
// the features they govern land; today it surfaces the canvas grid toggle, the
// pane-layout reset, the notepad clear, and the autosave status. New settings
// append as rows/sections — this is the one place editor preferences live.

import { Box, Pressable, Text } from '@reactjit/primitives';

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <Box style={{ gap: 8, borderTopWidth: 1, borderTopColor: '#16202f', paddingTop: 10 }}>
      <Text fontSize={9} color="#38bdf8" style={{ fontWeight: 800, letterSpacing: 1 }}>{props.title}</Text>
      {props.children}
    </Box>
  );
}

function Toggle(props: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => props.onChange(!props.value)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <Text fontSize={11} color="#cbd5e1">{props.label}</Text>
      <Box style={{ width: 36, height: 20, borderRadius: 10, backgroundColor: props.value ? '#0f3d2e' : '#1e293b', borderWidth: 1, borderColor: props.value ? '#22c55e' : '#334155', justifyContent: 'center', paddingLeft: 2, paddingRight: 2 }}>
        <Box style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: props.value ? '#86efac' : '#64748b', alignSelf: props.value ? 'flex-end' : 'flex-start' }} />
      </Box>
    </Pressable>
  );
}

function ActionRow(props: { label: string; action: string; tone?: 'default' | 'danger'; onPress: () => void }) {
  const danger = props.tone === 'danger';
  return (
    <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <Text fontSize={11} color="#cbd5e1">{props.label}</Text>
      <Pressable onPress={props.onPress} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4, borderRadius: 4, borderWidth: 1, borderColor: danger ? '#7f1d1d' : '#334155', backgroundColor: danger ? '#3d1414' : '#0f1a2e' }}>
        <Text fontSize={10} color={danger ? '#fca5a5' : '#cbd5e1'} style={{ fontWeight: 700 }}>{props.action}</Text>
      </Pressable>
    </Box>
  );
}

export function SettingsTab(props: {
  showGrid: boolean;
  onShowGrid: (v: boolean) => void;
  onResetLayout: () => void;
  onClearNotes: () => void;
  lastSavedAt: number | null;
}) {
  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0a111d', padding: 12, gap: 10 }}>
      <Text fontSize={10} color="#64748b" style={{ fontWeight: 800, letterSpacing: 1 }}>SETTINGS</Text>

      <Section title="CANVAS">
        <Toggle label="Show grid" value={props.showGrid} onChange={props.onShowGrid} />
      </Section>

      <Section title="LAYOUT">
        <ActionRow label="Reset panes to even split" action="Reset" onPress={props.onResetLayout} />
      </Section>

      <Section title="SESSION">
        <ActionRow label="Clear notepad" action="Clear" tone="danger" onPress={props.onClearNotes} />
        <Box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text fontSize={11} color="#cbd5e1">Autosave</Text>
          <Text fontSize={10} color="#475569" style={{ fontFamily: 'monospace' }}>{props.lastSavedAt ? 'saved' : 'pending'}</Text>
        </Box>
      </Section>
    </Box>
  );
}
