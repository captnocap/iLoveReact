import { C, accentFor } from '../workspace.cls';
import type { DiagnosticConsumer } from './diagnosticConsumers';

export default function DiagnosticConsumerRow({ consumer, maxScore, rank }: { consumer: DiagnosticConsumer; maxScore: number; rank: number }) {
  const pct = maxScore > 0 ? Math.max(2, Math.min(100, (consumer.score / maxScore) * 100)) : 0;
  const color = consumer.hot ? accentFor('warning') : accentFor('primary');
  return (
    <C.HW_TopConsumerRow style={{ borderColor: consumer.hot ? accentFor('warning') : accentFor('borderSoft') }}>
      <C.HW_DockLabel style={{ width: 22, color }}>#{rank}</C.HW_DockLabel>
      <C.HW_FormValue numberOfLines={1} noWrap style={{ width: 112 }}>{consumer.label}</C.HW_FormValue>
      <C.HW_DockValue style={{ width: 58, textAlign: 'right', color }}>{consumer.value}</C.HW_DockValue>
      <C.HW_ChurnBar><C.HW_ChurnFill style={{ width: `${pct}%`, backgroundColor: color }} /></C.HW_ChurnBar>
      <C.HW_DockLabel style={{ width: 48 }}>{consumer.source}</C.HW_DockLabel>
      <C.HW_StatusText numberOfLines={1} noWrap style={{ flexGrow: 1, minWidth: 0 }}>{consumer.detail}</C.HW_StatusText>
    </C.HW_TopConsumerRow>
  );
}
