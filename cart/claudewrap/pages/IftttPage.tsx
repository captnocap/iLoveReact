// IftttPage — live activity feed.
//
// Two sources merged + sorted by timestamp:
//   - useIftttTail   → claude-ss hook log file (lifecycle events)
//   - usePermissionBus → classifier permission bus (detected + answered)

import * as React from 'react';
import { Col, Text } from '../../../runtime/primitives';
import { palette } from '../ui/palette';
import { EventList } from '../ui/EventList';
import { useIftttTail } from '../ifttt/log-tail';
import { usePermissionBus } from '../ifttt/permission-bus';
import { IFTTT_LOG_PATH } from '../App';

export function IftttPage() {
  const hookEvents = useIftttTail(IFTTT_LOG_PATH);
  const permEvents = usePermissionBus();
  const events = React.useMemo(
    () => [...hookEvents, ...permEvents].sort((a, b) => a.ts - b.ts).slice(-200),
    [hookEvents, permEvents],
  );

  // Page Col is flexGrow:1 inside a Row with a 40-cell Terminal
  // (border 1 on each side = 2 painted cells) and 1-cell padding on
  // either side of the page. That leaves:
  //   outer cols − 40 (term) − 2 (border) − 2 (padding) = outer − 44
  const outerCols = (globalThis as any).process?.stdout?.columns ?? 80;
  const innerW = Math.max(20, outerCols - 44);

  if (events.length === 0) {
    return (
      <Col style={{ gap: 0, flexGrow: 1 }}>
        <Text style={{ color: palette.accent, fontWeight: 'bold' }}>ifttt activity</Text>
        <Text style={{ color: palette.dim }}>polling {IFTTT_LOG_PATH}</Text>
        <Text> </Text>
        <Text style={{ color: palette.dim }}>
          no events yet — interact with claude in the terminal pane
        </Text>
      </Col>
    );
  }

  return (
    <Col style={{ gap: 0, flexGrow: 1 }}>
      <Text style={{ color: palette.accent, fontWeight: 'bold' }}>ifttt activity</Text>
      <Text style={{ color: palette.dim }}>polling {IFTTT_LOG_PATH}</Text>
      <Text> </Text>
      <EventList events={events} innerWidth={innerW} />
    </Col>
  );
}
