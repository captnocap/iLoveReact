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
  // ── Per-subsystem attribution (framework/diag/mem_breakdown.zig) ──────────
  // GPU fields are device-local (VRAM); js_*/host_* fields are process RSS.
  gpu_geom_intern_bytes?: number;
  gpu_glyph_atlas_bytes?: number;
  gpu_glyph_buffer_bytes?: number;
  gpu_ui_rect_bytes?: number;
  gpu_paint_texture_bytes?: number;
  js_heap_used_bytes?: number;
  js_heap_total_bytes?: number;
  js_external_bytes?: number;
  js_malloced_bytes?: number;
  host_mesh_stash_bytes?: number;
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
  return { ...baseline, ...memorySubsystemBaseline(system) };
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

// ── Per-subsystem attribution ────────────────────────────────────────────────
// What *inside the app* holds the memory, grouped by where it originates (World/
// map vs Shell/UI vs JS Runtime) and which pool it lives in (gpu = device-local
// VRAM, host = process RSS). The two pools are NOT summed together against RSS —
// see memoryReconcile.

export type Pool = 'gpu' | 'host';
export type Origin = 'World' | 'Shell' | 'Runtime';

type Subsystem = {
  id: string;
  key: keyof SystemTelemetry;
  label: string;
  origin: Origin;
  pool: Pool;
  detail: string;
  warnBytes?: number;
};

const SUBSYSTEMS: Subsystem[] = [
  { id: 'geom', key: 'gpu_geom_intern_bytes', label: 'geometry intern', origin: 'World', pool: 'gpu', detail: 'interned world meshes (props, buildings, chunks) - never evicts', warnBytes: 256 * MiB },
  { id: 'stash', key: 'host_mesh_stash_bytes', label: 'mesh stash', origin: 'World', pool: 'host', detail: 'host-parked vertex copies awaiting intern' },
  { id: 'atlas', key: 'gpu_glyph_atlas_bytes', label: 'glyph atlas', origin: 'Shell', pool: 'gpu', detail: '4096-square RGBA font atlas texture' },
  { id: 'glyphbuf', key: 'gpu_glyph_buffer_bytes', label: 'glyph buffer', origin: 'Shell', pool: 'gpu', detail: 'per-glyph GPU instance buffer capacity' },
  { id: 'uirect', key: 'gpu_ui_rect_bytes', label: 'ui rect buffer', origin: 'Shell', pool: 'gpu', detail: 'instanced-rect chrome buffer capacity' },
  { id: 'paint', key: 'gpu_paint_texture_bytes', label: 'paint surfaces', origin: 'Shell', pool: 'gpu', detail: 'paintable RGBA textures (Studio, decals)' },
  { id: 'jsheap', key: 'js_heap_total_bytes', label: 'v8 js heap', origin: 'Runtime', pool: 'host', detail: 'managed JS object heap (React tree + cart state)', warnBytes: 256 * MiB },
  { id: 'jsext', key: 'js_external_bytes', label: 'v8 external', origin: 'Runtime', pool: 'host', detail: 'ArrayBuffers + external bytes outside the JS heap', warnBytes: 256 * MiB },
  { id: 'jsmalloc', key: 'js_malloced_bytes', label: 'v8 malloced', origin: 'Runtime', pool: 'host', detail: 'V8 internal C++ malloc (zone, parser, compiler)' },
];

const ORIGIN_LABEL: Record<Origin, string> = {
  World: 'World / Map',
  Shell: 'Shell / UI',
  Runtime: 'JS Runtime',
};

export function memorySubsystemBaseline(system: SystemTelemetry | null | undefined): Record<string, number> {
  const baseline: Record<string, number> = {};
  for (const sub of SUBSYSTEMS) baseline[`sub:${sub.id}`] = memoryNumber(system, sub.key);
  return baseline;
}

/** Subsystem rows for the drill-down list — what holds memory, ranked by growth. */
export function memorySubsystems(system: SystemTelemetry | null, baseline: Record<string, number> | null): DiagnosticConsumer[] {
  if (!system) return [];
  const rows: DiagnosticConsumer[] = [];
  for (const sub of SUBSYSTEMS) {
    const current = memoryNumber(system, sub.key);
    if (current <= 0) continue;
    const start = baseline?.[`sub:${sub.id}`] ?? current;
    const delta = current - start;
    const growthScore = Math.max(0, delta) / MiB;
    const residentScore = current / (64 * MiB);
    rows.push({
      id: `subsystem:${sub.id}`,
      source: sub.pool,
      label: sub.label,
      value: formatMemory(current),
      detail: `${ORIGIN_LABEL[sub.origin]} - ${formatSignedMemory(delta)} since reset - ${sub.detail}`,
      score: growthScore * 8 + residentScore,
      hot: current >= (sub.warnBytes ?? Number.POSITIVE_INFINITY),
    });
  }
  return rows.sort((a, b) => b.score - a.score);
}

/** Top-line origin buckets: how much the map vs the shell vs the runtime holds. */
export function memoryOriginBuckets(system: SystemTelemetry | null, baseline: Record<string, number> | null): DiagnosticConsumer[] {
  if (!system) return [];
  const origins: Origin[] = ['World', 'Shell', 'Runtime'];
  const rows: DiagnosticConsumer[] = [];
  for (const origin of origins) {
    const subs = SUBSYSTEMS.filter((s) => s.origin === origin);
    let bytes = 0;
    let delta = 0;
    let gpu = 0;
    let host = 0;
    for (const sub of subs) {
      const current = memoryNumber(system, sub.key);
      bytes += current;
      delta += current - (baseline?.[`sub:${sub.id}`] ?? current);
      if (sub.pool === 'gpu') gpu += current; else host += current;
    }
    if (bytes <= 0) continue;
    const pool = gpu > 0 && host > 0 ? 'mixed' : gpu > 0 ? 'gpu' : 'host';
    const poolNote = pool === 'mixed' ? `${formatMemory(gpu)} vram + ${formatMemory(host)} rss` : pool === 'gpu' ? 'device-local vram' : 'process rss';
    rows.push({
      id: `origin:${origin}`,
      source: pool,
      label: ORIGIN_LABEL[origin],
      value: formatMemory(bytes),
      detail: `${formatSignedMemory(delta)} since reset - ${poolNote}`,
      score: bytes,
      hot: false,
    });
  }
  // Native/driver remainder: process RSS the host-side subsystems do NOT explain.
  const rss = memoryNumber(system, 'process_rss_bytes');
  const reconcile = memoryReconcile(system);
  if (rss > 0) {
    rows.push({
      id: 'origin:unattributed',
      source: 'native',
      label: 'Native / driver',
      value: formatMemory(reconcile.unattributed),
      detail: `process rss not held by tracked host allocations (Dawn/GPU driver, libc, V8 zones)`,
      score: reconcile.unattributed,
      hot: reconcile.unattributed >= 512 * MiB,
    });
  }
  return rows.sort((a, b) => b.score - a.score);
}

export type MemoryReconcile = {
  rss: number;
  hostTracked: number;
  gpuTracked: number;
  unattributed: number;
};

/**
 * Reconcile tracked subsystems against the OS-reported RSS. Only host-pool
 * subsystems count against RSS; GPU-pool bytes live in VRAM and are reported
 * on their own. `unattributed` is the honest host remainder (native/driver).
 */
export function memoryReconcile(system: SystemTelemetry | null | undefined): MemoryReconcile {
  let hostTracked = 0;
  let gpuTracked = 0;
  for (const sub of SUBSYSTEMS) {
    const bytes = memoryNumber(system, sub.key);
    if (sub.pool === 'gpu') gpuTracked += bytes; else hostTracked += bytes;
  }
  const rss = memoryNumber(system, 'process_rss_bytes');
  return { rss, hostTracked, gpuTracked, unattributed: Math.max(0, rss - hostTracked) };
}
