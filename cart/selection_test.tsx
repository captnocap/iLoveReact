// selection_test — manual flow test for system text-selection bubble.
//
// Goal: prove the SelectionWatcher → IFTTT → bubble flow before committing
// to a system-overlay <Notification> window. The "bubble" rendered here
// lives inside the cart's own window (absolute-positioned), but uses the
// same coords it would use in screen space, so the position math is
// fully exercised. Move this window to the side and highlight text in any
// other app — the right pane shows live event values; the bubble preview
// shows where it WOULD appear in screen space.

import { useEffect, useRef, useState } from 'react';
import { Box, Row, Col, Text, Pressable, Window } from '@reactjit/runtime/primitives';
import { useIFTTT } from '@reactjit/runtime/hooks/useIFTTT';
import { subscribe } from '@reactjit/runtime/ffi';

type Mode = 'smart' | 'above' | 'below' | 'tl' | 'tr' | 'bl' | 'br';

type SelEvent = {
  text: string;
  textLen: number;
  downX: number; downY: number;
  upX: number; upY: number;
  screenW: number; screenH: number;
  at: number;
};

const BUBBLE_W = 220;
const BUBBLE_H = 44;
const MARGIN = 12;
const LINE_H = 24; // ballpark line height for "same-line" detection

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function cornerOf(mode: Mode, sw: number, sh: number) {
  switch (mode) {
    case 'tl': return { x: MARGIN, y: MARGIN };
    case 'tr': return { x: sw - BUBBLE_W - MARGIN, y: MARGIN };
    case 'bl': return { x: MARGIN, y: sh - BUBBLE_H - MARGIN };
    case 'br': default: return { x: sw - BUBBLE_W - MARGIN, y: sh - BUBBLE_H - MARGIN };
  }
}

function smartBbox(ev: SelEvent): { x: number; y: number; reason: string } {
  const { downX, downY, upX, upY, screenW, screenH } = ev;
  const dy = upY - downY;

  let x: number;
  let y: number;
  let reason: string;

  if (Math.abs(dy) < LINE_H) {
    // Single-line drag — place below the lower endpoint, centered between
    // the two x's.
    const cx = (downX + upX) / 2;
    x = cx - BUBBLE_W / 2;
    y = Math.max(downY, upY) + MARGIN;
    reason = 'same-line below';
  } else if (dy > 0) {
    // Forward / downward drag — place below the end (mouseup).
    x = upX - BUBBLE_W / 2;
    y = upY + MARGIN;
    reason = 'forward drag → below mouseup';
  } else {
    // Reverse / upward drag — place above the start (mousedown was lower).
    x = downX - BUBBLE_W / 2;
    y = downY - BUBBLE_H - MARGIN;
    reason = 'reverse drag → above mousedown';
  }

  // Edge clipping → fall back to bottom-right corner.
  if (
    x < 0 || y < 0 ||
    x + BUBBLE_W > screenW || y + BUBBLE_H > screenH
  ) {
    const c = cornerOf('br', screenW, screenH);
    return { x: c.x, y: c.y, reason: reason + ' (clipped → corner)' };
  }
  return { x, y, reason };
}

function resolveBubbleXY(mode: Mode, ev: SelEvent): { x: number; y: number; reason: string } {
  switch (mode) {
    case 'smart': return smartBbox(ev);
    case 'above': return {
      x: clamp(ev.upX - BUBBLE_W / 2, 0, ev.screenW - BUBBLE_W),
      y: clamp(ev.upY - BUBBLE_H - MARGIN, 0, ev.screenH - BUBBLE_H),
      reason: 'above cursor',
    };
    case 'below': return {
      x: clamp(ev.upX - BUBBLE_W / 2, 0, ev.screenW - BUBBLE_W),
      y: clamp(ev.upY + MARGIN, 0, ev.screenH - BUBBLE_H),
      reason: 'below cursor',
    };
    default: {
      const c = cornerOf(mode, ev.screenW, ev.screenH);
      return { x: c.x, y: c.y, reason: `corner:${mode}` };
    }
  }
}

const MODES: { id: Mode; label: string }[] = [
  { id: 'smart',  label: 'Smart' },
  { id: 'above',  label: 'Above cursor' },
  { id: 'below',  label: 'Below cursor' },
  { id: 'tl',     label: 'Top-left' },
  { id: 'tr',     label: 'Top-right' },
  { id: 'bl',     label: 'Bottom-left' },
  { id: 'br',     label: 'Bottom-right' },
];

export default function SelectionTest() {
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<Mode>('smart');
  const [event, setEvent] = useState<SelEvent | null>(null);
  const [bubble, setBubble] = useState<{ x: number; y: number; reason: string } | null>(null);
  const [dismissReason, setDismissReason] = useState<string>('—');
  const [fireCount, setFireCount] = useState(0);
  const [lastClipboard, setLastClipboard] = useState<string>('');
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Selection fired (debounced — drag complete).
  useIFTTT('select:nonempty', (ev: SelEvent) => {
    if (!enabledRef.current) return;
    setEvent(ev);
    setBubble(resolveBubbleXY(modeRef.current, ev));
    setDismissReason('—');
    setFireCount((n) => n + 1);
  });

  // Selection cleared (PRIMARY went empty).
  useIFTTT('select:cleared', () => {
    if (!enabledRef.current) return;
    if (bubble) setDismissReason('selection cleared');
    setBubble(null);
  });

  // Clipboard copy → dismiss (the user moved on).
  useIFTTT('clipboard:copy', (e: any) => {
    setLastClipboard(typeof e?.text === 'string' ? e.text.slice(0, 80) : '');
    if (!enabledRef.current) return;
    if (bubble) setDismissReason('clipboard copy');
    setBubble(null);
  });

  // Click anywhere outside the bubble → dismiss. We listen on the global
  // bus channel '__click' (same one ifttt 'click' source uses); engine fires
  // it for clicks landing in our window. (Clicks in OTHER apps don't reach
  // us — that's a known limitation of in-window test mode; the OS-overlay
  // version will solve it via XInput2 raw button events.)
  useEffect(() => {
    const off = subscribe('__click', () => {
      if (bubble) {
        setDismissReason('click in app window');
        setBubble(null);
      }
    });
    return off;
  }, [bubble]);

  return (
    <Box style={{ width: '100%', height: '100%', flexDirection: 'row', backgroundColor: '#0b1020' }}>
      {/* Controls + log */}
      <Col style={{ width: 420, height: '100%', padding: 16, gap: 12, backgroundColor: '#111827' }}>
        <Text style={{ fontSize: 20, color: '#f8fafc', fontWeight: 700 }}>Selection Bubble — Test</Text>
        <Text style={{ fontSize: 12, color: '#9ca3af' }}>
          Highlight text in any other app. Watch the right pane.
        </Text>

        <Row style={{ gap: 8, alignItems: 'center' }}>
          <Pressable onPress={() => setEnabled((v) => !v)}>
            <Box style={{
              paddingTop: 6, paddingBottom: 6, paddingLeft: 12, paddingRight: 12,
              borderRadius: 6,
              backgroundColor: enabled ? '#16a34a' : '#374151',
            }}>
              <Text style={{ color: '#fff', fontSize: 13 }}>
                {enabled ? 'ENABLED' : 'disabled'}
              </Text>
            </Box>
          </Pressable>
          <Text style={{ fontSize: 12, color: '#9ca3af' }}>fires: {fireCount}</Text>
        </Row>

        <Col style={{ gap: 4 }}>
          <Text style={{ fontSize: 12, color: '#cbd5e1', fontWeight: 600 }}>Position mode</Text>
          <Row style={{ gap: 6, flexWrap: 'wrap' }}>
            {MODES.map((m) => (
              <Pressable key={m.id} onPress={() => {
                setMode(m.id);
                if (event) setBubble(resolveBubbleXY(m.id, event));
              }}>
                <Box style={{
                  paddingTop: 4, paddingBottom: 4, paddingLeft: 8, paddingRight: 8,
                  borderRadius: 4,
                  backgroundColor: mode === m.id ? '#2563eb' : '#1f2937',
                }}>
                  <Text style={{ color: '#fff', fontSize: 11 }}>{m.label}</Text>
                </Box>
              </Pressable>
            ))}
          </Row>
        </Col>

        <Box style={{ height: 1, backgroundColor: '#1f2937' }} />

        <Col style={{ gap: 4 }}>
          <Text style={{ fontSize: 12, color: '#cbd5e1', fontWeight: 600 }}>Last selection</Text>
          <Text style={{ fontSize: 11, color: '#94a3b8' }}>
            text ({event?.textLen ?? 0} chars):
          </Text>
          <Box style={{
            padding: 8, borderRadius: 4, backgroundColor: '#0f172a',
            minHeight: 60, maxHeight: 120,
          }}>
            <Text style={{ fontSize: 12, color: '#e2e8f0' }}>
              {event?.text ? event.text.slice(0, 240) : '(none yet)'}
            </Text>
          </Box>
        </Col>

        <Col style={{ gap: 2 }}>
          <Text style={{ fontSize: 11, color: '#94a3b8' }}>
            mousedown: ({event?.downX?.toFixed(0) ?? '–'}, {event?.downY?.toFixed(0) ?? '–'})
          </Text>
          <Text style={{ fontSize: 11, color: '#94a3b8' }}>
            mouseup:   ({event?.upX?.toFixed(0) ?? '–'}, {event?.upY?.toFixed(0) ?? '–'})
          </Text>
          <Text style={{ fontSize: 11, color: '#94a3b8' }}>
            screen:    {event?.screenW?.toFixed(0) ?? '–'} × {event?.screenH?.toFixed(0) ?? '–'}
          </Text>
          <Text style={{ fontSize: 11, color: '#94a3b8' }}>
            bubble at: ({bubble?.x?.toFixed(0) ?? '–'}, {bubble?.y?.toFixed(0) ?? '–'})
          </Text>
          <Text style={{ fontSize: 11, color: '#94a3b8' }}>
            reason: {bubble?.reason ?? '–'}
          </Text>
          <Text style={{ fontSize: 11, color: bubble ? '#10b981' : '#f87171' }}>
            bubble: {bubble ? 'visible' : `dismissed (${dismissReason})`}
          </Text>
        </Col>

        <Box style={{ height: 1, backgroundColor: '#1f2937' }} />

        <Col style={{ gap: 2 }}>
          <Text style={{ fontSize: 11, color: '#94a3b8' }}>last clipboard:</Text>
          <Text style={{ fontSize: 11, color: '#e2e8f0' }}>{lastClipboard || '(none)'}</Text>
        </Col>
      </Col>

      {/* Screen-space preview */}
      <Box style={{ flexGrow: 1, height: '100%', position: 'relative', backgroundColor: '#020617' }}>
        <Box style={{ padding: 16 }}>
          <Text style={{ fontSize: 12, color: '#475569' }}>
            Screen-space preview (scaled). Bubble shown at REAL screen coords —
            its position here only matches if the screen ≈ this pane.
          </Text>
        </Box>
        {bubble && (
          <Box style={{
            position: 'absolute',
            left: Math.min(bubble.x, 600),
            top: Math.min(bubble.y, 400),
            width: BUBBLE_W,
            height: BUBBLE_H,
            backgroundColor: '#1e293b',
            borderRadius: 8,
            paddingLeft: 12, paddingRight: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}>
            <Text style={{ color: '#60a5fa', fontSize: 13, fontWeight: 600 }}>(preview-clamped)</Text>
          </Box>
        )}
        {/* Mouse-down/up marker dots so you can see the inferred drag rect */}
        {event && (
          <>
            <Box style={{
              position: 'absolute',
              left: event.downX - 4, top: event.downY - 4,
              width: 8, height: 8, borderRadius: 4,
              backgroundColor: '#10b981',
            }} />
            <Box style={{
              position: 'absolute',
              left: event.upX - 4, top: event.upY - 4,
              width: 8, height: 8, borderRadius: 4,
              backgroundColor: '#f59e0b',
            }} />
          </>
        )}
      </Box>

      {/* Real OS window bubble at screen-space coordinates */}
      {bubble && (
        <Window
          title="assistant"
          width={BUBBLE_W}
          height={BUBBLE_H}
          x={Math.round(bubble.x)}
          y={Math.round(bubble.y)}
          onClose={() => { setDismissReason('window closed'); setBubble(null); }}
        >
          <Box style={{
            width: '100%', height: '100%',
            backgroundColor: '#1e293b',
            paddingLeft: 12, paddingRight: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}>
            <Text style={{ color: '#60a5fa', fontSize: 13, fontWeight: 600 }}>?</Text>
            <Text style={{ color: '#e2e8f0', fontSize: 12 }}>Ask assistant about this</Text>
          </Box>
        </Window>
      )}
    </Box>
  );
}
