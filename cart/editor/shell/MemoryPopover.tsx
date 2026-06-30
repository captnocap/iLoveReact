import { useEffect, useState } from 'react';
import { Icon } from '../../../runtime/icons/Icon';
import { useTelemetry } from '../../../runtime/hooks/useTelemetry';
import { C, accentFor } from '../workspace.cls';
import { formatCount } from '../data/readouts';
import DiagnosticConsumerRow from './DiagnosticConsumerRow';
import {
  formatMemory,
  formatSignedMemory,
  memoryBaselineFor,
  memoryConsumers,
  memoryDelta,
  memoryNumber,
  memorySignature,
  type SystemTelemetry,
} from './memoryDiagnostics';

export default function MemoryPopover({ onClose }: { onClose: () => void }) {
  const { data: system } = useTelemetry<SystemTelemetry>({ kind: 'system', pollMs: 1000 });
  const [baseline, setBaseline] = useState<Record<string, number> | null>(null);
  const memoryKey = memorySignature(system);
  const rows = memoryConsumers(system, baseline);
  const maxScore = Math.max(1, ...rows.map((row) => row.score));
  const rss = memoryNumber(system, 'process_rss_bytes');
  const rssDelta = memoryDelta(system, baseline, 'rss', 'process_rss_bytes');

  useEffect(() => {
    if (baseline || !system) return;
    setBaseline(memoryBaselineFor(system));
  }, [baseline, memoryKey]);

  return (
    <C.HW_MemoryPopover>
      <C.HW_DockPopoverHead>
        <Icon name="MemoryStick" size={14} color={accentFor(rows[0]?.hot ? 'warning' : 'primary')} />
        <C.HW_HeadTitle>Memory Accumulation</C.HW_HeadTitle>
        <C.HW_PillOn><C.HW_PillTextOn>rss {formatMemory(rss)}</C.HW_PillTextOn></C.HW_PillOn>
        <C.HW_Pill><C.HW_PillText>{formatSignedMemory(rssDelta)} since reset</C.HW_PillText></C.HW_Pill>
        <C.HW_Spacer />
        <C.HW_Pill onPress={() => setBaseline(system ? memoryBaselineFor(system) : null)}><C.HW_PillText>reset</C.HW_PillText></C.HW_Pill>
        <C.HW_Pill onPress={onClose}><C.HW_PillText>close</C.HW_PillText></C.HW_Pill>
      </C.HW_DockPopoverHead>
      <C.HW_PerfSummarySurface staticKey="editor:memory:summary">
        <C.HW_DockPerfGrid>
          <C.HW_PerfTile>
            <C.HW_PerfValue>{formatMemory(rss)}</C.HW_PerfValue>
            <C.HW_PerfLabel>process rss</C.HW_PerfLabel>
          </C.HW_PerfTile>
          <C.HW_PerfTile>
            <C.HW_PerfValue>{formatSignedMemory(rssDelta)}</C.HW_PerfValue>
            <C.HW_PerfLabel>rss delta</C.HW_PerfLabel>
          </C.HW_PerfTile>
          <C.HW_PerfTile>
            <C.HW_PerfValue>{formatMemory(system?.process_rss_anon_bytes)}</C.HW_PerfValue>
            <C.HW_PerfLabel>anon rss</C.HW_PerfLabel>
          </C.HW_PerfTile>
          <C.HW_PerfTile>
            <C.HW_PerfValue>{formatMemory(system?.process_rss_file_bytes)}</C.HW_PerfValue>
            <C.HW_PerfLabel>file rss</C.HW_PerfLabel>
          </C.HW_PerfTile>
          <C.HW_PerfTile>
            <C.HW_PerfValue>{formatMemory(system?.process_vm_data_bytes)}</C.HW_PerfValue>
            <C.HW_PerfLabel>vm data</C.HW_PerfLabel>
          </C.HW_PerfTile>
          <C.HW_PerfTile>
            <C.HW_PerfValue>{formatMemory(system?.mem_available_bytes)}</C.HW_PerfValue>
            <C.HW_PerfLabel>available</C.HW_PerfLabel>
          </C.HW_PerfTile>
        </C.HW_DockPerfGrid>
      </C.HW_PerfSummarySurface>
      <C.HW_ChurnSummarySurface staticKey="editor:memory:summary-row">
        <C.HW_ChurnSummary>
          <Icon name={rssDelta > 64 * 1024 * 1024 ? 'TriangleAlert' : 'CircleCheck'} size={13} color={accentFor(rssDelta > 64 * 1024 * 1024 ? 'warning' : 'success')} />
          <C.HW_FormValue numberOfLines={1} noWrap>ranked by growth since reset, then resident pressure</C.HW_FormValue>
          <C.HW_Spacer />
          <C.HW_StatusText numberOfLines={1} noWrap>peak {formatMemory(system?.process_rss_peak_bytes)} - swap {formatMemory(system?.process_vm_swap_bytes)} - threads {formatCount(system?.process_threads ?? 0)}</C.HW_StatusText>
        </C.HW_ChurnSummary>
      </C.HW_ChurnSummarySurface>
      <C.HW_MemoryBreakdown>
        <C.HW_GroupTitle>
          <Icon name="ListOrdered" size={12} color={accentFor(rows[0]?.hot ? 'warning' : 'primary')} />
          <C.HW_GroupText>ACCUMULATING BUCKETS</C.HW_GroupText>
          <C.HW_Spacer />
          <C.HW_StatusText>{rows[0] ? 'current sample' : 'waiting for system telemetry'}</C.HW_StatusText>
        </C.HW_GroupTitle>
        <C.HW_TopConsumerScroll showScrollbar>
          <C.HW_TopConsumerRows>
            {rows.map((row, index) => (
              <DiagnosticConsumerRow key={row.id} consumer={row} maxScore={maxScore} rank={index + 1} />
            ))}
          </C.HW_TopConsumerRows>
        </C.HW_TopConsumerScroll>
      </C.HW_MemoryBreakdown>
    </C.HW_MemoryPopover>
  );
}
