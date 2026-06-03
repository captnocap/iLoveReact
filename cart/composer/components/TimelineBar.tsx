// TimelineBar — horizontal at-a-glance view of what's scheduled.
//
// Time is the primary axis: measures run left → right, with tracks as
// stacked lanes. compile.ts instruments sandbox scheduling calls and
// provides lightweight event metadata; playback still goes through the
// audio engine unchanged.

import { Row, Col, Box, Text, ScrollView } from '@reactjit/primitives';
import { COLORS, SIZES } from '../theme';
import type { ComposerState } from '../state';
import type { TimelineEvent } from '../compiler';

const MIN_MEASURES = 8;
const MEASURE_W = 72;
const TRACK_LABEL_W = 48;
const LANE_H = 22;

interface Props {
  s: ComposerState;
}

export function TimelineBar({ s }: Props) {
  const compiled = s.lastCompile?.ok ?? false;
  const events = compiled ? s.lastCompile!.events : [];
  const maxEnd = events.reduce((m, ev) => Math.max(m, ev.end), MIN_MEASURES);
  const measureCount = Math.max(MIN_MEASURES, Math.ceil(maxEnd));
  const measures = Array.from({ length: measureCount }, (_, i) => i + 1);
  const tracks = events.length
    ? Array.from(new Set(events.map((ev) => ev.track))).sort((a, b) => a - b)
    : [0, 1, 2];

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
          {compiled ? `${events.length} events · ${measureCount} measures` : 'no compile'}
        </Text>
      </Row>

      <ScrollView style={{ flexGrow: 1, flexBasis: 0 }} showScrollbar={true}>
        <Col style={{ paddingTop: 5, paddingBottom: 5 }}>
          <Row style={{ height: 16, alignItems: 'center' }}>
            <Box style={{ width: TRACK_LABEL_W }} />
            {measures.map((m) => (
              <Box
                key={`measure:${m}`}
                style={{
                  width: MEASURE_W,
                  borderLeftWidth: 1,
                  borderLeftColor: COLORS.border,
                  paddingLeft: 5,
                }}
              >
                <Text style={{ color: COLORS.inkMuted, fontSize: 9, fontFamily: 'monospace' }}>{m}</Text>
              </Box>
            ))}
          </Row>

          {tracks.map((track) => (
            <TrackLane
              key={`track:${track}`}
              track={track}
              events={events.filter((ev) => ev.track === track)}
              measureCount={measureCount}
              compiled={compiled}
            />
          ))}
        </Col>
      </ScrollView>
    </Col>
  );
}

function TrackLane({
  track,
  events,
  measureCount,
  compiled,
}: {
  track: number;
  events: TimelineEvent[];
  measureCount: number;
  compiled: boolean;
}) {
  return (
    <Row style={{ height: LANE_H, alignItems: 'center' }}>
      <Box style={{
        width: TRACK_LABEL_W,
        paddingLeft: 10,
        paddingRight: 6,
      }}>
        <Text style={{ color: COLORS.inkMuted, fontSize: 9, letterSpacing: 1 }}>T{track}</Text>
      </Box>
      <Box style={{
        width: measureCount * MEASURE_W,
        height: LANE_H - 4,
        backgroundColor: compiled ? COLORS.bgSoft : COLORS.bg,
        borderRadius: 3,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {Array.from({ length: measureCount }, (_, i) => (
          <Box
            key={`grid:${track}:${i}`}
            style={{
              position: 'absolute',
              left: i * MEASURE_W,
              top: 0,
              bottom: 0,
              width: 1,
              backgroundColor: COLORS.border,
            }}
          />
        ))}
        {events.map((ev, i) => (
          <TimelineClip key={`${track}:${i}:${ev.start}:${ev.end}`} event={ev} />
        ))}
      </Box>
    </Row>
  );
}

function TimelineClip({ event }: { event: TimelineEvent }) {
  const left = Math.max(0, (event.start - 1) * MEASURE_W);
  const width = Math.max(12, (event.end - event.start) * MEASURE_W);
  const fill = event.kind === 'pattern'
    ? COLORS.accentDim
    : event.kind === 'section'
      ? COLORS.warn
      : COLORS.good;
  return (
    <Box style={{
      position: 'absolute',
      left,
      top: 3,
      width,
      height: LANE_H - 10,
      backgroundColor: fill,
      borderRadius: 3,
      paddingLeft: 5,
      justifyContent: 'center',
    }}>
      <Text style={{
        color: event.kind === 'section' ? COLORS.bg : COLORS.ink,
        fontSize: 9,
        fontFamily: 'monospace',
      }}>
        {event.label}
      </Text>
    </Box>
  );
}
