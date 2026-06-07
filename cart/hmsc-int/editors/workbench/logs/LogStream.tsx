// editors/workbench/logs/LogStream.tsx — the LOGS stage (WBSET9-0606), the
// W3 wireframe's big-surface treatment made real (LAW 3: the stream IS the
// page — terminal-size rows, idle width spent on the dashboard band):
//
//   StatBand  — one card per feed, REAL numbers (ring lines + logging state;
//               per-channel commits/sessions) with an activity sparkline;
//               the selected feed's card highlights.
//   SelBar    — rows select on click (keep clicking = multi-select); COPY
//               puts the selection on the real system clipboard
//               (__clipboard_set via the runtime clipboard door), CLEAR
//               drops it. Only exists while a selection does.
//   stream    — newest first, channel edge-stripes + chips, alternating row
//               shading; churn lines keep their /log tag colors (churn.ts).
//
// LAW 1 holds: everything here RECEIVES from the store; the pause/clear
// verbs live in the hero bar (panel.ts actions), not in this surface.

import { useEffect, useState } from 'react';
import { Box, ScrollView, Text } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import { set as clipboardSet } from '@reactjit/hooks/clipboard';
import { C, accentFor } from '../../../shell/workbench.cls';
import { toneFor } from '../tone';
import { WORKBENCH_VIEW } from '../livePoll';
import { CHURN_ID, type LogsStore } from './store';

export function LogStream(props: { store: LogsStore; channelId: string; lens: string }) {
  const { store, channelId, lens } = props;
  const rows = store.rowsFor(channelId, lens, WORKBENCH_VIEW.logRowCap);
  const stats = store.stats();

  const [selKeys, setSelKeys] = useState<Set<string>>(() => new Set());
  const [copied, setCopied] = useState(0);
  // the lens/feed is how you LOOK — switching drops a selection it may hide
  useEffect(() => { setSelKeys(new Set()); setCopied(0); }, [channelId, lens]);

  const toggleRow = (key: string) => {
    setSelKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setCopied(0);
  };
  const copySelected = () => {
    const text = store.copyText(rows, selKeys);
    if (!text) return;
    clipboardSet(text);
    setCopied(rows.filter((r) => selKeys.has(r.key)).length);
  };

  const churn = channelId === CHURN_ID;
  const empty = churn
    ? (store.deps.ring.enabled() ? 'no log lines yet — paint something' : 'logging paused')
    : store.busError()
      ? `store unavailable: ${store.busError()}`
      : 'no session activity yet — edit on any route and it lands here';

  return (
    <C.LogPane>
      <C.StatBand>
        {stats.map((s) => {
          const on = s.id === channelId;
          const Card = on ? C.StatCardOn : C.StatCard;
          const color = toneFor(s.label);
          return (
            <Card key={s.id}>
              <C.StatHead>
                <C.LogChip style={{ backgroundColor: color }}>
                  <C.LogChipText>{s.label}</C.LogChipText>
                </C.LogChip>
                <C.StatSub>{s.sub}</C.StatSub>
              </C.StatHead>
              <C.StatBig>{s.big}</C.StatBig>
              <C.Spark>
                {s.spark.map((h, i) => (
                  <C.SparkBar key={i} style={{ height: 4 + Math.round(h * 20), backgroundColor: color }} />
                ))}
              </C.Spark>
            </Card>
          );
        })}
      </C.StatBand>

      {selKeys.size > 0 ? (
        <C.SelBar>
          <C.PreviewTag>{`${selKeys.size} SELECTED`}</C.PreviewTag>
          <C.ChromePill onPress={copySelected}>
            <Icon name="Copy" size={12} color={accentFor('success')} />
            <C.ChromePillText>Copy</C.ChromePillText>
          </C.ChromePill>
          <C.ChromePill onPress={() => { setSelKeys(new Set()); setCopied(0); }}>
            <Icon name="X" size={12} color={accentFor('textDim')} />
            <C.ChromePillText>Clear</C.ChromePillText>
          </C.ChromePill>
          {copied > 0 ? (
            <Text fontSize={9} color={accentFor('success')} style={{ fontFamily: 'monospace' }}>
              {`copied ${copied} row${copied === 1 ? '' : 's'} to clipboard ✓`}
            </Text>
          ) : null}
        </C.SelBar>
      ) : null}

      {rows.length === 0 ? (
        <Box style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text fontSize={11} color={accentFor('textFaint')} style={{ fontFamily: 'monospace' }}>{empty}</Text>
        </Box>
      ) : (
        <ScrollView showScrollbar style={{ flexGrow: 1, minHeight: 0 }}>
          <Box style={{ flexDirection: 'column' }}>
            {rows.map((r, i) => {
              const on = selKeys.has(r.key);
              const Row = on ? C.LogRowSel : C.LogRow;
              const color = r.color ?? toneFor(r.channel);
              return (
                <Row
                  key={r.key}
                  onPress={() => toggleRow(r.key)}
                  style={on ? undefined : { backgroundColor: i % 2 ? 'transparent' : accentFor('bg') }}
                >
                  <C.LogStripe style={{ backgroundColor: color }} />
                  <C.LogTime>{r.time}</C.LogTime>
                  <C.LogChip style={{ backgroundColor: color }}>
                    <C.LogChipText>{r.channel}</C.LogChipText>
                  </C.LogChip>
                  <C.LogText color={r.color ?? undefined}>{r.text}</C.LogText>
                </Row>
              );
            })}
          </Box>
        </ScrollView>
      )}
    </C.LogPane>
  );
}
