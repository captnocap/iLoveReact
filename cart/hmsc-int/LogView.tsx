// LogView — the /log route. Reads the churn log perfLog dumps and shows it live
// inside the app, so you can read the paint-perf trace without tailing
// /tmp/hmsc-int-churn.log. Newest line first (a tail view), auto-refreshing on
// each flush. A "key only" filter hides the per-render noise and leaves the
// signal lines (stroke verdicts, landform rebuilt/reused, region-sync FIRE).
//
// Pure diagnostics, like the rest of perfLog — rip out with it.

import { useEffect, useReducer, useState } from 'react';
import { Box, Pressable, ScrollView, Text } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import {
  getLogLines, subscribeLog, clearLog,
  isLoggingEnabled, setLoggingEnabled, logFilePath,
} from './perfLog';

// Pull the tag out of `[t +dt] tag: msg` to colour the line.
function tagOf(line: string): string {
  const m = /\]\s+([a-zA-Z]+):/.exec(line);
  return m ? m[1] : '';
}

const TAG_COLOR: Record<string, string> = {
  stroke: '#86efac',
  landforms: '#fbbf24',
  regionSync: '#7dd3fc',
  buildFloors: '#a78bfa',
  previewWorld: '#f472b6',
  floors: '#38bdf8',
  edit: '#e2e8f0',
  render: '#64748b',
  chunkSurface: '#475569',
  autosave: '#475569',
};

// The signal lines worth seeing at a glance (the rest is per-render churn).
const KEY_TAGS = new Set(['stroke', 'landforms', 'buildFloors', 'floors', 'previewWorld']);
function isKeyLine(line: string): boolean {
  const t = tagOf(line);
  if (KEY_TAGS.has(t)) return true;
  return t === 'regionSync' && line.includes('FIRE'); // keep FIRE, drop schedule/coalesce
}

function lineColor(line: string): string {
  if (line.includes('⚠')) return '#fca5a5';
  if (line.includes('✓')) return '#86efac';
  if (line.startsWith('====')) return '#64748b';
  return TAG_COLOR[tagOf(line)] ?? '#cbd5e1';
}

function HeaderBtn(props: { icon?: string; label: string; on?: boolean; danger?: boolean; onPress: () => void }) {
  const border = props.danger ? '#7f1d1d' : props.on ? '#f8fafc' : '#27364a';
  const bg = props.danger ? '#3d1414' : props.on ? '#1e293b' : '#0f1a2e';
  const fg = props.danger ? '#fca5a5' : props.on ? '#f8fafc' : '#cbd5e1';
  return (
    <Pressable onPress={props.onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 9, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6, borderWidth: 1, borderColor: border, backgroundColor: bg }}>
      {props.icon ? <Icon name={props.icon} size={13} color={fg} /> : null}
      <Text fontSize={11} color={fg} style={{ fontWeight: 700 }}>{props.label}</Text>
    </Pressable>
  );
}

export function LogView() {
  // Re-render on each flush (subscribeLog) so the view tails the log live.
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeLog(bump), []);
  const [keyOnly, setKeyOnly] = useState(true);
  const on = isLoggingEnabled();

  const all = getLogLines();
  const shown = keyOnly ? all.filter(isKeyLine) : all;
  const rows = shown.slice().reverse(); // newest first (tail view)

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#080d16', flexDirection: 'column' }}>
      {/* Header */}
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10, paddingRight: 10, paddingTop: 8, paddingBottom: 8, backgroundColor: '#0b1320', borderBottomWidth: 1, borderBottomColor: '#1e293b' }}>
        <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="Activity" size={14} color="#7dd3fc" />
          <Text fontSize={11} color="#cbd5e1" style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1 }}>CHURN LOG</Text>
          <Text fontSize={10} color="#64748b" style={{ fontFamily: 'monospace' }}>{shown.length}/{all.length} lines</Text>
        </Box>
        <Box style={{ flexGrow: 1 }} />
        <HeaderBtn label={keyOnly ? 'key only' : 'all lines'} on={keyOnly} onPress={() => setKeyOnly((v) => !v)} />
        <HeaderBtn icon={on ? 'Pause' : 'Play'} label={on ? 'logging' : 'paused'} on={on} onPress={() => setLoggingEnabled(!on)} />
        <HeaderBtn icon="Trash2" label="clear" danger onPress={clearLog} />
      </Box>

      {/* The file path, so it's findable for a real tail too. */}
      <Box style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 4, paddingBottom: 4, backgroundColor: '#0a1018' }}>
        <Text fontSize={8} color="#475569" style={{ fontFamily: 'monospace' }}>tail -f {logFilePath()}  ·  newest first</Text>
      </Box>

      {/* The lines */}
      {rows.length === 0 ? (
        <Box style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text fontSize={11} color="#475569" style={{ fontFamily: 'monospace' }}>{on ? 'no log lines yet — paint something' : 'logging paused'}</Text>
        </Box>
      ) : (
        <ScrollView showScrollbar style={{ flexGrow: 1, minHeight: 0 }} contentContainerStyle={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 12, gap: 1 }}>
          {rows.map((line, i) => (
            <Text key={`${i}_${line.length}`} fontSize={9} color={lineColor(line)} style={{ fontFamily: 'monospace' }}>{line}</Text>
          ))}
        </ScrollView>
      )}
    </Box>
  );
}
