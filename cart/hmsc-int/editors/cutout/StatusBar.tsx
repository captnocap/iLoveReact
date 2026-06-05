// editors/cutout/StatusBar.tsx — the original app's bottom strip remade:
// status pill + the painter's live status text on the left, a flush-right
// row of stat compartments (FPS / ZOOM / CANVAS / SIZE / MASK / LAYERS /
// CLICKS / SAVED) polled at 1 Hz (the reference's hard-won rate — faster
// polling dragged the whole cart through re-renders mid-stroke).
//
// Behavior reference: cart/cutout/components/StatusBar.tsx (read, never
// imported).

import { Box, Col, Row, Text } from '@reactjit/primitives';
import { useTelemetry } from '@reactjit/hooks/useTelemetry';
import { GAME_CHROME } from '@game';
import type { PaintEditorState } from '../paint';
import { formatSaveAge } from './Inspector';

const T = GAME_CHROME.tokens.color;
const BAR_H = 30;

export function CutoutStatusBar(props: {
  s: PaintEditorState;
  edited: boolean;
  lastSavedAt: number | null;
}) {
  const { s } = props;
  const { value: fps } = useTelemetry({ kind: 'fps', pollMs: 1000 });
  const { data: canvas } = useTelemetry({ kind: 'canvas', pollMs: 1000 });
  const zoom = canvas && typeof (canvas as any).cam_zoom === 'number' ? (canvas as any).cam_zoom : 1;
  const pill = s.smartBusy ? ['WORKING', T.warn] as const
    : props.lastSavedAt ? ['SAVED', T.good] as const
    : ['READY', T.ink] as const;
  return (
    <Row style={{
      height: BAR_H, paddingLeft: 12, alignItems: 'stretch',
      backgroundColor: T.panelSolid, borderTopWidth: 1, borderColor: T.frame,
    }}>
      <Row style={{ alignItems: 'center', gap: 8, flexShrink: 0, paddingRight: 12 }}>
        <Box style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: pill[1], minWidth: 62, alignItems: 'center' }}>
          <Text style={{ color: pill[1], fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>{pill[0]}</Text>
        </Box>
        <Text style={{ color: T.dim, fontSize: 10 }} numberOfLines={1}>{s.status}</Text>
      </Row>
      <Box style={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }} />
      <Row style={{ alignItems: 'stretch', flexShrink: 0 }}>
        <StatCell label="FPS" value={fps > 0 ? String(Math.round(fps)) : '—'} tone={fps > 0 && fps < 30 ? T.warn : undefined} />
        <StatCell label="ZOOM" value={`${Math.round((zoom > 0 ? zoom : 1) * 100)}%`} />
        <StatCell label="CANVAS" value={`${s.dims.w}×${s.dims.h}`} />
        <StatCell label="SIZE" value={estimateSize(s)} />
        <StatCell label="MASK" value={props.edited ? 'edited' : 'empty'} tone={props.edited ? T.good : T.dim} />
        <StatCell label="LAYERS" value={s.layers.length > 0 ? String(s.layers.length) : '—'} />
        <StatCell label="CLICKS" value={s.clicks.length > 0 ? String(s.clicks.length) : '—'} />
        <StatCell label="SAVED" value={props.lastSavedAt ? formatSaveAge(props.lastSavedAt) : '—'} tone={T.dim} />
      </Row>
    </Row>
  );
}

function StatCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Col style={{ paddingHorizontal: 10, justifyContent: 'center', borderLeftWidth: 1, borderColor: T.frame, minWidth: 54 }}>
      <Text style={{ color: T.dim, fontSize: 7, fontWeight: '800', letterSpacing: 1 }}>{label}</Text>
      <Text style={{ color: tone ?? T.ink, fontSize: 10, fontWeight: '700' }} numberOfLines={1}>{value}</Text>
    </Col>
  );
}

// Rough working-set estimate (display only): the reference's rule of thumb —
// ~0.6 bytes/pixel for photo content + ~200 KB per FX layer.
function estimateSize(s: PaintEditorState): string {
  const bytes = s.dims.w * s.dims.h * 0.6 + s.layers.length * 200_000;
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
