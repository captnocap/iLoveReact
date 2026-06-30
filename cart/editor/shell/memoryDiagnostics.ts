import type { DiagnosticConsumer } from './diagnosticConsumers';

export type SystemTelemetry = {
  process_rss_bytes?: number;
  process_rss_peak_bytes?: number;
  process_rss_anon_bytes?: number;
  process_rss_file_bytes?: number;
  process_rss_shmem_bytes?: number;
  process_vsize_bytes?: number;
  process_vsize_peak_bytes?: number;
  process_vm_data_bytes?: number;
  process_vm_stack_bytes?: number;
  process_vm_exe_bytes?: number;
  process_vm_lib_bytes?: number;
  process_vm_swap_bytes?: number;
  process_threads?: number;
  mem_total_bytes?: number;
  mem_available_bytes?: number;
};

type MemoryField = {
  id: string;
  key: keyof SystemTelemetry;
  label: string;
  detail: string;
  warnBytes?: number;
  warnDeltaBytes?: number;
};

const KiB = 1024;
const MiB = KiB * 1024;
const GiB = MiB * 1024;

const MEMORY_FIELDS: MemoryField[] = [
  {
    id: 'rss',
    key: 'process_rss_bytes',
    label: 'process rss',
    detail: 'total resident memory held by the editor process',
    warnBytes: GiB,
    warnDeltaBytes: 64 * MiB,
  },
  {
    id: 'anon',
    key: 'process_rss_anon_bytes',
    label: 'anon rss',
    detail: 'private anonymous resident pages: JS/native heaps, stacks, JIT pages',
    warnBytes: 512 * MiB,
    warnDeltaBytes: 32 * MiB,
  },
  {
    id: 'file',
    key: 'process_rss_file_bytes',
    label: 'file rss',
    detail: 'file-backed resident pages: libraries, mapped assets, caches',
    warnBytes: 512 * MiB,
    warnDeltaBytes: 64 * MiB,
  },
  {
    id: 'shmem',
    key: 'process_rss_shmem_bytes',
    label: 'shared rss',
    detail: 'shared resident pages owned with the OS or GPU stack',
    warnDeltaBytes: 32 * MiB,
  },
  {
    id: 'rss-peak',
    key: 'process_rss_peak_bytes',
    label: 'rss peak',
    detail: 'OS high-water resident set since this process started',
    warnBytes: GiB,
  },
  {
    id: 'vm-data',
    key: 'process_vm_data_bytes',
    label: 'vm data',
    detail: 'virtual data/heap reservation reported by the kernel',
    warnDeltaBytes: 64 * MiB,
  },
  {
    id: 'vm-size',
    key: 'process_vsize_bytes',
    label: 'vm size',
    detail: 'total virtual address space reservation, not all resident',
    warnDeltaBytes: 128 * MiB,
  },
  {
    id: 'swap',
    key: 'process_vm_swap_bytes',
    label: 'swap',
    detail: 'process memory currently swapped out',
    warnBytes: MiB,
  },
  {
    id: 'vm-stack',
    key: 'process_vm_stack_bytes',
    label: 'vm stack',
    detail: 'thread stack reservation',
    warnDeltaBytes: 8 * MiB,
  },
  {
    id: 'vm-lib',
    key: 'process_vm_lib_bytes',
    label: 'vm libs',
    detail: 'mapped library reservation',
    warnDeltaBytes: 32 * MiB,
  },
];

export function memoryNumber(system: SystemTelemetry | null | undefined, key: keyof SystemTelemetry): number {
  const value = system?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function formatMemory(bytes: number | undefined): string {
  const n = Math.max(0, Math.round(bytes ?? 0));
  if (n >= GiB) return `${(n / GiB).toFixed(n >= 10 * GiB ? 1 : 2)}G`;
  if (n >= MiB) return `${(n / MiB).toFixed(n >= 100 * MiB ? 0 : 1)}M`;
  if (n >= KiB) return `${(n / KiB).toFixed(n >= 100 * KiB ? 0 : 1)}K`;
  return `${n}B`;
}

export function formatSignedMemory(bytes: number): string {
  if (!bytes) return '+0B';
  return `${bytes > 0 ? '+' : '-'}${formatMemory(Math.abs(bytes))}`;
}

export function memoryBaselineFor(system: SystemTelemetry | null | undefined): Record<string, number> {
  const baseline: Record<string, number> = {};
  for (const field of MEMORY_FIELDS) {
    baseline[field.id] = memoryNumber(system, field.key);
  }
  return baseline;
}

export function memorySignature(system: SystemTelemetry | null): string {
  if (!system) return 'none';
  return MEMORY_FIELDS.map((field) => `${field.id}:${memoryNumber(system, field.key)}`).join('|');
}

export function memoryDelta(system: SystemTelemetry | null, baseline: Record<string, number> | null, id: string, key: keyof SystemTelemetry): number {
  const current = memoryNumber(system, key);
  return current - (baseline?.[id] ?? current);
}

export function memoryConsumers(system: SystemTelemetry | null, baseline: Record<string, number> | null): DiagnosticConsumer[] {
  if (!system) return [];
  const rows: DiagnosticConsumer[] = [];
  const base = baseline ?? memoryBaselineFor(system);
  for (const field of MEMORY_FIELDS) {
    const current = memoryNumber(system, field.key);
    if (current <= 0) continue;
    const start = base[field.id] ?? current;
    const delta = current - start;
    const growthScore = Math.max(0, delta) / MiB;
    const residentScore = current / (128 * MiB);
    const score = growthScore * 8 + residentScore;
    rows.push({
      id: `memory:${field.id}`,
      source: 'mem',
      label: field.label,
      value: formatMemory(current),
      detail: `${formatSignedMemory(delta)} since reset - ${field.detail}`,
      score,
      hot: current >= (field.warnBytes ?? Number.POSITIVE_INFINITY) || delta >= (field.warnDeltaBytes ?? Number.POSITIVE_INFINITY),
    });
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, 12);
}
