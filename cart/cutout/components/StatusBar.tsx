// StatusBar — thin bottom strip. Left: status pill + free-form status text.
// Right: a strip of runtime stats (FPS / zoom / canvas dims / size estimate
// / mask state / layers / clicks). Stats are READ-ONLY here — the canvas
// size EDITOR lives in Inspector's Source Properties tab so each control
// has one home (no double-duty: edit-in-Properties, observe-in-StatusBar).
//
// Stats use a vertical-divider strip pattern: each cell is `label / value`
// stacked tightly, with a 1px border between cells. Drops the noisy
// inline-with-gap layout the previous version had.

import { Box, Col, Row, Text } from '@reactjit/runtime/primitives';
import { COLORS, SIZES } from '../theme';
import type { CutoutState } from '../state';
import { useTelemetry } from '@reactjit/runtime/hooks/useTelemetry';

export function StatusBar({ s }: { s: CutoutState }) {
  const statusColor = s.busy ? COLORS.warn : s.savedPath ? COLORS.good : s.srcDims ? COLORS.ink : COLORS.inkDim;
  const layerCount = s.layers.length;
  // Both telemetry channels poll at 1 Hz. Faster polling (was 500/250 ms)
  // dragged the WHOLE cart through a re-render every quarter-second —
  // during a brush stroke that compounds with the maskVersion throttle
  // and tanks framerate. The status-bar numbers don't need sub-second
  // freshness; visible value at 1 Hz is the same to the eye.
  const { value: fps } = useTelemetry({ kind: 'fps', pollMs: 1000 });
  const { data: canvas } = useTelemetry({ kind: 'canvas', pollMs: 1000 });
  const zoom = canvas && typeof canvas.cam_zoom === 'number' ? canvas.cam_zoom : 1;
  const sizeEstimate = estimateFileSize(s);

  return (
    <Row style={{
      height: SIZES.bottomBar,
      paddingLeft: 16,
      paddingRight: 0,
      alignItems: 'stretch',
      backgroundColor: COLORS.panel,
      borderTopWidth: 1,
      borderColor: COLORS.border,
    }}>
      <Row style={{ alignItems: 'center', gap: 10, flexShrink: 0, paddingRight: 14 }}>
        <StatusPill s={s} color={statusColor} />
        <Text style={{ color: statusColor, fontSize: 11 }} numberOfLines={1}>
          {s.status}
        </Text>
      </Row>

      <Box style={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }} />

      {/* Stats run flush-right with consistent cells. Always-on cells
         (FPS / ZOOM / CANVAS / SIZE / MASK / LAYERS / CLICKS / SAVED)
         render with a "—" placeholder when their value isn't meaningful,
         so the strip width stays stable as state changes instead of
         shifting around per condition. */}
      <Row style={{ alignItems: 'stretch', flexShrink: 0 }}>
        <StatCell label="FPS" value={formatFps(fps)} tone={fps > 0 && fps < 30 ? COLORS.warn : COLORS.ink} />
        <StatCell label="ZOOM" value={formatZoom(zoom)} />
        <StatCell label="CANVAS" value={s.srcDims ? `${s.srcDims.w}×${s.srcDims.h}` : '—'} />
        <StatCell label="SIZE" value={sizeEstimate} />
        <StatCell label="MASK" value={s.hasMaskEdits ? 'edited' : 'empty'} tone={s.hasMaskEdits ? COLORS.good : COLORS.inkDim} />
        <StatCell label="LAYERS" value={layerCount > 0 ? String(layerCount) : '—'} />
        <StatCell label="CLICKS" value={s.clicks.length > 0 ? String(s.clicks.length) : '—'} />
        <StatCell label="SAVED" value={s.lastSavedAt ? formatSaveAge(s.lastSavedAt) : '—'} tone={COLORS.inkDim} />
      </Row>
    </Row>
  );
}

// ── Status pill ─────────────────────────────────────────────────────
// A tight monospaced badge to the left of the free-form status text.
// One word (WORKING / SAVED / READY / WAITING) so its width is
// predictable and the status text after it doesn't shift around.

function StatusPill({ s, color }: { s: CutoutState; color: string }) {
  const label = s.busy || s.smartBusy ? 'WORKING'
    : s.savedPath ? 'SAVED'
    : s.srcPath ? 'READY'
    : 'WAITING';
  return (
    <Box style={{
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: color,
      minWidth: 70,
      alignItems: 'center',
    }}>
      <Text style={{ color, fontSize: 10, fontWeight: '900', letterSpacing: 1 }}>
        {label}
      </Text>
    </Box>
  );
}

// ── Stat cell ───────────────────────────────────────────────────────
// Vertical stack: label on top, value below. Each cell carries its own
// left-border so the strip reads as a row of compartments. Last cell
// has no right-border; container handles the rounded outer edge.

function StatCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Col style={{
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderLeftWidth: 1,
      borderColor: COLORS.border,
      justifyContent: 'center',
      minWidth: 60,
    }}>
      <Text style={{
        color: COLORS.inkMuted,
        fontSize: 8,
        fontWeight: '800',
        letterSpacing: 1,
      }}>
        {label}
      </Text>
      <Text style={{
        color: tone ?? COLORS.ink,
        fontSize: 11,
        fontWeight: '700',
      }} numberOfLines={1}>
        {value}
      </Text>
    </Col>
  );
}

// ── Formatters ──────────────────────────────────────────────────────

function formatFps(fps: number): string {
  if (!Number.isFinite(fps) || fps <= 0) return '—';
  return String(Math.round(fps));
}

function formatZoom(zoom: number): string {
  if (!Number.isFinite(zoom) || zoom <= 0) return '100%';
  return `${Math.round(zoom * 100)}%`;
}

// File-size estimate for the cutout the user would export. Based on the
// source dims + layer count — quick rule-of-thumb so the user knows
// roughly what they're sitting on without doing the actual PNG/SQI
// bake. Returns a human-readable string like "1.4 MB".
function estimateFileSize(s: CutoutState): string {
  if (!s.srcDims) return '—';
  const px = s.srcDims.w * s.srcDims.h;
  // PNG empirical estimate: ~0.6 bytes/pixel for photo content with
  // alpha. Add ~200 KB per FX layer (sqi serialization at overlayRes
  // packs tight). Rough; better than no signal.
  const layerCount = s.layers.length;
  const bytes = px * 0.6 + layerCount * 200_000;
  return formatBytes(bytes);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSaveAge(saved: number): string {
  const ageSec = Math.max(0, Math.round((Date.now() - saved) / 1000));
  if (ageSec < 2) return 'now';
  if (ageSec < 60) return `${ageSec}s`;
  if (ageSec < 3600) return `${Math.round(ageSec / 60)}m`;
  return `${Math.round(ageSec / 3600)}h`;
}
