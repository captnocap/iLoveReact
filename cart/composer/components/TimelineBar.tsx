// TimelineBar — at-a-glance view of what's currently scheduled.
//
// v1 is minimal: a row of track lanes labelled 0..N showing how many
// patterns each holds (queried from compile bindings count, not from
// the audio framework directly — that's a bigger introspection ask).
// Real per-step visualization comes after the basic loop is proven.

import { Row, Col, Box, Text } from '@reactjit/runtime/primitives';
import { COLORS, SIZES } from '../theme';
import type { ComposerState } from '../state';

const TRACK_LANES = 8;

interface Props {
  s: ComposerState;
}

export function TimelineBar({ s }: Props) {
  const compiled = s.lastCompile?.ok ?? false;
  const lanes = Array.from({ length: TRACK_LANES }, (_, i) => i);

  return (
    <Col style={{
      height: SIZES.timelineBar,
      backgroundColor: COLORS.panel,
      borderTopWidth: 1,
      borderTopColor: COLORS.border,
    }}>
      <Row style={{
        height: 22,
        paddingLeft: 12,
        paddingRight: 12,
        alignItems: 'center',
        gap: 10,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.border,
      }}>
        <Text style={{ color: COLORS.inkDim, fontSize: 10, letterSpacing: 1 }}>TIMELINE</Text>
        <Box style={{
          width: 6, height: 6, borderRadius: 3,
          backgroundColor: s.isPlaying ? COLORS.good : COLORS.inkMuted,
        }} />
        <Text style={{ color: COLORS.inkMuted, fontSize: 10 }}>
          {s.isPlaying ? 'playing' : 'idle'}
        </Text>
        <Box style={{ flexGrow: 1 }} />
        <Text style={{ color: COLORS.inkMuted, fontSize: 10 }}>
          {compiled ? `${s.lastCompile!.bindings.length} bindings` : 'no compile'}
        </Text>
      </Row>

      <Row style={{ flexGrow: 1, flexBasis: 0, padding: 6, gap: 4 }}>
        {lanes.map((i) => (
          <Col
            key={i}
            style={{
              flexGrow: 1,
              flexBasis: 0,
              backgroundColor: compiled ? COLORS.panelAlt : COLORS.bgSoft,
              borderRadius: 3,
              paddingLeft: 6,
              paddingRight: 6,
              paddingTop: 4,
              paddingBottom: 4,
              gap: 2,
            }}
          >
            <Text style={{ color: COLORS.inkMuted, fontSize: 9, letterSpacing: 1 }}>TRK {i}</Text>
            <Text style={{ color: compiled ? COLORS.ink : COLORS.inkMuted, fontSize: 11, fontFamily: 'monospace' }}>
              {compiled ? '··········' : '—'}
            </Text>
          </Col>
        ))}
      </Row>
    </Col>
  );
}
