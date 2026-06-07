// editors/workbench/vehicles/PaintLens.tsx -- doorway into the shared PAINT bench.

import { useEffect, useState } from 'react';
import { Col, Text } from '@reactjit/runtime/primitives';
import { GAME_CHROME } from '../../../game/chrome';
import { modelWorkId } from '../../cutout/models';
import { paintBenchStore } from '../paint/live';
import { PaintBench } from '../paint/PaintBench';
import type { VehicleStore } from './store';

const T = GAME_CHROME.tokens.color;

export function VehiclePaintLens(props: { store: VehicleStore }) {
  const s = props.store;
  const [, setTick] = useState(0);
  useEffect(() => s.subscribe(() => setTick((t) => t + 1)), [s]);

  const docId = s.activeId;
  const part = s.view.selectedPart ?? 'body';
  const bench = paintBenchStore();

  useEffect(() => {
    if (!docId) return;
    const want = modelWorkId({ family: 'vehicle', docId, part });
    if (bench.work.docId !== want) bench.open({ kind: 'vehicle-part', docId, part });
  }, [docId, part, bench]);

  if (!docId) {
    return (
      <Col style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <Text fontSize={12} color={T.dim}>PAINT works on a saved vehicle</Text>
        <Text fontSize={10} color={T.dim}>create or select a vehicle, then pick a part</Text>
      </Col>
    );
  }

  return <PaintBench store={bench} />;
}
