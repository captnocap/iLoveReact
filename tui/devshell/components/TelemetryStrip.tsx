// Right-aligned strip of host telemetry: fps, node count, layout/paint
// times, spinner. Rendered inside the title row when the host is up;
// degrades to em-dashes when down so width is stable.

import * as React from 'react';
import { Row, Text } from '../../../runtime/primitives';
import { useTelemetry, type Telemetry } from '../services/Telemetry';

export function TelemetryStrip({ hostUp, spinner }: { hostUp: boolean; spinner: string }) {
  const tel = useTelemetry();
  const sep = <Text style={{ color: 'theme:inkFaint' }}>·</Text>;

  if (!hostUp || !tel) {
    return (
      <Row style={{ gap: 1 }}>
        <Text style={{ color: 'theme:inkFaint' }}>—fps</Text>
        {sep}
        <Text style={{ color: 'theme:inkFaint' }}>—nodes</Text>
        {sep}
        <Text style={{ color: 'theme:inkFaint' }}>L—</Text>
        {sep}
        <Text style={{ color: 'theme:inkFaint' }}>P—</Text>
        {sep}
        <Text style={{ color: 'theme:inkFaint' }}>{spinner}</Text>
      </Row>
    );
  }

  const fps = tel.fps | 0;
  const fpsColor = fps >= 55 ? 'theme:ok' : fps >= 30 ? 'theme:warn' : 'theme:bad';
  const lay = (tel.layout_us / 1000).toFixed(1);
  const pnt = (tel.paint_us / 1000).toFixed(1);
  return (
    <Row style={{ gap: 1 }}>
      <Text style={{ color: fpsColor, fontWeight: 'bold' }}>{fps}fps</Text>
      {sep}
      <Text style={{ color: 'theme:ink' }}>{tel.node_count} nodes</Text>
      {sep}
      <Text style={{ color: 'theme:ink' }}>L {lay}ms</Text>
      {sep}
      <Text style={{ color: 'theme:ink' }}>P {pnt}ms</Text>
      {sep}
      <Text style={{ color: 'theme:inkDim' }}>{spinner}</Text>
    </Row>
  );
}
