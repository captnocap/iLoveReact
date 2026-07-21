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
  memoryDelta,
  memoryMappingBuckets,
  memoryNumber,
  memoryReconcile,
  memorySignature,
  memorySubsystems,
  type SystemTelemetry,
} from './memoryDiagnostics';

const MiB = 1024 * 1024;

export default function MemoryPopover({ onClose }: { onClose: () => void }) {
  const { data: system } = useTelemetry<SystemTelemetry>({ kind: 'system', pollMs: 1000 });
  const [baseline, setBaseline] = useState<Record<string, number> | null>(null);
  const memoryKey = memorySignature(system);

  const buckets = memoryMappingBuckets(system, baseline);
  const subsystems = memorySubsystems(system, baseline);
  const reconcile = memoryReconcile(system);
  const bucketMax = Math.max(1, ...buckets.map((row) => row.score));
  const subsystemMax = Math.max(1, ...subsystems.map((row) => row.score));

  const rss = memoryNumber(system, 'process_rss_bytes');
  const rssDelta = memoryDelta(system, baseline, 'rss', 'process_rss_bytes');
  const shaderRetained = memoryNumber(system, 'shader_compile_last_retained_growth_bytes');
  const hot = subsystems[0]?.hot || buckets[0]?.hot || shaderRetained >= 256 * MiB;
  const bucketValue = (id: string) => buckets.find((row) => row.id === id)?.value ?? formatMemory(0);

  useEffect(() => {
    if (baseline || !system) return;
    setBaseline(memoryBaselineFor(system));
  }, [baseline, memoryKey]);

  return (
    <C.HW_MemoryPopover>
      <C.HW_DockPopoverHead>
        <Icon name="MemoryStick" size={14} color={accentFor(hot ? 'warning' : 'primary')} />
        <C.HW_HeadTitle>Memory Accumulation</C.HW_HeadTitle>
        <C.HW_PillOn><C.HW_PillTextOn>rss {formatMemory(rss)}</C.HW_PillTextOn></C.HW_PillOn>
        <C.HW_Pill><C.HW_PillText>gpu alloc {formatMemory(reconcile.gpuTracked)}</C.HW_PillText></C.HW_Pill>
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
            <C.HW_PerfValue>{bucketValue('mapping:anonymous')}</C.HW_PerfValue>
            <C.HW_PerfLabel>anonymous mappings</C.HW_PerfLabel>
          </C.HW_PerfTile>
          <C.HW_PerfTile>
            <C.HW_PerfValue>{bucketValue('mapping:heap')}</C.HW_PerfValue>
            <C.HW_PerfLabel>main native heap</C.HW_PerfLabel>
          </C.HW_PerfTile>
          <C.HW_PerfTile>
            <C.HW_PerfValue>{bucketValue('mapping:file')}</C.HW_PerfValue>
            <C.HW_PerfLabel>file mappings</C.HW_PerfLabel>
          </C.HW_PerfTile>
          <C.HW_PerfTile>
            <C.HW_PerfValue>{formatMemory(reconcile.gpuTracked)}</C.HW_PerfValue>
            <C.HW_PerfLabel>known gpu allocations</C.HW_PerfLabel>
          </C.HW_PerfTile>
          <C.HW_PerfTile>
            <C.HW_PerfValue>{formatMemory(shaderRetained)}</C.HW_PerfValue>
            <C.HW_PerfLabel>shader retained</C.HW_PerfLabel>
          </C.HW_PerfTile>
        </C.HW_DockPerfGrid>
      </C.HW_PerfSummarySurface>
      <C.HW_ChurnSummarySurface staticKey="editor:memory:summary-row">
        <C.HW_ChurnSummary>
          <Icon name={hot ? 'TriangleAlert' : 'CircleCheck'} size={13} color={accentFor(hot ? 'warning' : 'success')} />
          <C.HW_FormValue numberOfLines={1} noWrap>kernel mapping partition {formatMemory(system?.process_map_total_rss_bytes)} across {formatCount(system?.process_map_count ?? 0)} VMAs - {formatMemory(reconcile.gpuTracked)} known gpu allocations shown separately because driver backing can overlap rss</C.HW_FormValue>
          <C.HW_Spacer />
          <C.HW_StatusText numberOfLines={1} noWrap>peak {formatMemory(system?.process_rss_peak_bytes)} - swap {formatMemory(system?.process_vm_swap_bytes)} - threads {formatCount(system?.process_threads ?? 0)}</C.HW_StatusText>
        </C.HW_ChurnSummary>
      </C.HW_ChurnSummarySurface>
      <C.HW_MemoryBreakdown>
        <C.HW_GroupTitle>
          <Icon name="Boxes" size={12} color={accentFor('primary')} />
          <C.HW_GroupText>BY KERNEL MAPPING</C.HW_GroupText>
          <C.HW_Spacer />
          <C.HW_StatusText>{buckets[0] ? 'disjoint - rows sum to mapped rss' : 'waiting for system telemetry'}</C.HW_StatusText>
        </C.HW_GroupTitle>
        <C.HW_TopConsumerRows>
          {buckets.map((row, index) => (
            <DiagnosticConsumerRow key={row.id} consumer={row} maxScore={bucketMax} rank={index + 1} />
          ))}
        </C.HW_TopConsumerRows>
        <C.HW_GroupTitle>
          <Icon name="ListOrdered" size={12} color={accentFor(subsystems[0]?.hot ? 'warning' : 'primary')} />
          <C.HW_GroupText>SUBSYSTEMS</C.HW_GroupText>
          <C.HW_Spacer />
          <C.HW_StatusText>ranked by growth since reset, then resident</C.HW_StatusText>
        </C.HW_GroupTitle>
        <C.HW_TopConsumerScroll showScrollbar>
          <C.HW_TopConsumerRows>
            {subsystems.map((row, index) => (
              <DiagnosticConsumerRow key={row.id} consumer={row} maxScore={subsystemMax} rank={index + 1} />
            ))}
          </C.HW_TopConsumerRows>
        </C.HW_TopConsumerScroll>
      </C.HW_MemoryBreakdown>
    </C.HW_MemoryPopover>
  );
}
