// EventList — scrollable list of IFTTT activity rows. Each row has:
//   ▶/▼ expand toggle  |  timestamp  |  event name  |  summary       [copy]
// Expanding drops a colorized JSON view of the full payload below.
//
// State (expand+copy flash) is local to the component. Width is
// passed in so the JSON wrap helper can wrap to fit.

import * as React from 'react';
import { Box, Col, Row, Text, Pressable, ScrollView } from '../../../runtime/primitives';
import { copyToClipboard } from '../../../tui/devshell/services/clipboard';
import { palette } from './palette';
import { JsonView, formatPayload } from './JsonView';
import type { IftttEvent } from '../types';

export function EventList({
  events,
  innerWidth,
}: {
  events: IftttEvent[];
  innerWidth: number;
}) {
  const [expanded, setExpanded] = React.useState<Set<number>>(new Set());
  const [copied, setCopied] = React.useState<Set<number>>(new Set());

  const toggle = React.useCallback((ts: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(ts)) next.delete(ts); else next.add(ts);
      return next;
    });
  }, []);

  const copyEvent = React.useCallback((e: IftttEvent) => {
    try { copyToClipboard(formatPayload(e.payload)); } catch {}
    setCopied(prev => { const n = new Set(prev); n.add(e.ts); return n; });
    setTimeout(() => {
      setCopied(prev => {
        if (!prev.has(e.ts)) return prev;
        const n = new Set(prev); n.delete(e.ts); return n;
      });
    }, 1000);
  }, []);

  return (
    <ScrollView style={{ flexGrow: 1 }}>
      {events.slice().reverse().slice(0, 200).map((e, i) => {
        const open = expanded.has(e.ts);
        const wasCopied = copied.has(e.ts);
        const summaryMax = Math.max(0, innerWidth - 26 - e.event.length);
        return (
          <Col key={`${e.ts}-${i}`} style={{ gap: 0 }}>
            <Row style={{ gap: 1 }}>
              <Pressable onPress={() => toggle(e.ts)}>
                <Row style={{ gap: 1 }}>
                  <Text style={{ color: palette.dim, width: 1 }}>{open ? '▼' : '▶'}</Text>
                  <Text style={{ color: palette.dim }}>{formatTs(e.ts)}</Text>
                  <Text style={{ color: eventColor(e.event), fontWeight: 'bold' }}>{e.event}</Text>
                  <Text style={{ color: palette.ink }}>
                    {truncate(eventSummary(e), summaryMax)}
                  </Text>
                </Row>
              </Pressable>
              <Box style={{ flexGrow: 1 }} />
              <Pressable onPress={() => copyEvent(e)}>
                <Text style={{
                  color: wasCopied ? '#34d399' : palette.dim,
                  fontWeight: wasCopied ? 'bold' : 'normal',
                }}>
                  {wasCopied ? '[copied]' : '[copy]'}
                </Text>
              </Pressable>
            </Row>
            {open && (
              <Box style={{ paddingLeft: 4, paddingTop: 0, paddingBottom: 1 }}>
                <JsonView payload={e.payload} width={innerWidth - 4} />
              </Box>
            )}
          </Col>
        );
      })}
    </ScrollView>
  );
}

// ── Helpers (private) ───────────────────────────────────────────────

function eventSummary(e: IftttEvent): string {
  const p = e.payload;
  if (p == null) return '';
  if (typeof p === 'string') return p;
  if (e.event === 'PreToolUse' || e.event === 'PostToolUse') return String(p.tool_name ?? '');
  if (e.event === 'UserPromptSubmit') return String(p.prompt ?? p.user_message ?? '').replace(/\s+/g, ' ');
  if (e.event === 'Permission') return `${p.tool ?? '?'}(${p.target ?? ''})`;
  if (e.event === 'PermissionAnswered') return `${p.verb} ${p.tool}(${p.target}) via ${p.via}`;
  if (e.event === 'Stop') return String(p.last_assistant_message ?? '').replace(/\s+/g, ' ');
  if (e.event === 'Notification') return String(p.message ?? p.title ?? '');
  if (e.event === 'SessionStart' || e.event === 'SessionEnd') {
    const id = String(p.session_id ?? '');
    return id ? id.slice(0, 8) : '';
  }
  try { return JSON.stringify(p); } catch { return ''; }
}

function truncate(s: string, max: number): string {
  if (max <= 0) return '';
  if (s.length <= max) return s;
  if (max <= 1) return s.slice(0, max);
  return s.slice(0, max - 1) + '…';
}

function formatTs(ms: number): string {
  if (!ms) return '--:--:--';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function eventColor(name: string): string {
  if (name.startsWith('PreTool'))    return palette.info;
  if (name.startsWith('PostTool'))   return '#34d399';
  if (name === 'UserPromptSubmit')   return palette.accent;
  if (name === 'Permission')         return palette.hot;
  if (name === 'PermissionAnswered') return palette.good;
  if (name === 'Notification')       return palette.pink;
  if (name.startsWith('Stop'))       return palette.bad;
  return palette.ink;
}
