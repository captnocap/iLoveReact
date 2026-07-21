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
  process_map_heap_rss_bytes?: number;
  process_map_anonymous_rss_bytes?: number;
  process_map_file_rss_bytes?: number;
  process_map_stack_rss_bytes?: number;
  process_map_special_rss_bytes?: number;
  process_map_total_rss_bytes?: number;
  process_map_count?: number;
  process_map_complete?: boolean;
  mem_total_bytes?: number;
  mem_available_bytes?: number;
  // ── Per-subsystem attribution (framework/diag/mem_breakdown.zig) ──────────
  // gpu_* fields describe owned device-buffer use/capacity; js_*/host_* fields
  // describe host allocations that contribute to process memory. Capacity-only
  // fields are never treated as resident bytes by the reconciliation below.
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
  host_map_chunks_bytes?: number;
  host_map_foliage_rows_used_bytes?: number;
  host_map_foliage_rows_capacity_bytes?: number;
  host_map_foliage_snapshot_bytes?: number;
  host_map_paint_residency_bytes?: number;
  host_map_roads_bytes?: number;
  host_map_history_bytes?: number;
  gpu_map_static_instances_used_bytes?: number;
  gpu_map_static_instances_capacity_bytes?: number;
  gpu_map_slim_instances_used_bytes?: number;
  gpu_map_slim_instances_capacity_bytes?: number;
  gpu_render3d_core_capacity_bytes?: number;
  gpu_render3d_target_bytes?: number;
  gpu_render3d_diffuse_texture_bytes?: number;
  // Overlapping native-process evidence. These explain allocator/compiler
  // behavior but are not additive with subsystem/V8 ownership counters.
  host_libc_in_use_bytes?: number;
  host_libc_arena_bytes?: number;
  host_libc_mmap_bytes?: number;
  host_libc_free_bytes?: number;
  host_libc_releasable_bytes?: number;
  shader_compile_count?: number;
  shader_compile_last_peak_growth_bytes?: number;
  shader_compile_last_retained_growth_bytes?: number;
  shader_compile_last_trim_released_bytes?: number;
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
  return { ...baseline, ...memorySubsystemBaseline(system), ...memoryMappingBaseline(system) };
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
// map vs Shell/UI vs JS Runtime) and which pool it lives in (gpu = tracked GPU
// allocation or logical use, host = process RSS). The two pools are NOT summed
// together against RSS — see memoryReconcile.

export type Pool = 'gpu' | 'host';
export type Origin = 'World' | 'Shell' | 'Runtime' | 'Process';

type Subsystem = {
  id: string;
  key: keyof SystemTelemetry;
  capacityKey?: keyof SystemTelemetry;
  label: string;
  origin: Origin;
  pool: Pool;
  detail: string;
  warnBytes?: number;
  /** `none` = overlapping/event evidence; display it, never reconcile it. */
  accounting?: 'used' | 'capacity' | 'none';
};

const SUBSYSTEMS: Subsystem[] = [
  { id: 'file-rss', key: 'process_rss_file_bytes', label: 'file-backed rss', origin: 'Process', pool: 'host', detail: 'resident executable, shared-library, and file-mapped pages reported by the kernel', warnBytes: 256 * MiB },
  { id: 'shared-rss', key: 'process_rss_shmem_bytes', label: 'shared-memory rss', origin: 'Process', pool: 'host', detail: 'resident shared-memory pages reported by the kernel', warnBytes: 128 * MiB },
  { id: 'geom', key: 'gpu_geom_intern_bytes', label: 'geometry intern used', origin: 'World', pool: 'gpu', accounting: 'none', detail: 'populated prefix inside the separately-counted 3D core buffer allocation - never evicts', warnBytes: 256 * MiB },
  { id: 'stash', key: 'host_mesh_stash_bytes', label: 'mesh stash', origin: 'World', pool: 'host', detail: 'host-parked vertex copies awaiting intern' },
  { id: 'map-chunks', key: 'host_map_chunks_bytes', label: 'map chunks', origin: 'World', pool: 'host', detail: 'canonical native map chunk storage', warnBytes: 256 * MiB },
  {
    id: 'map-foliage-rows',
    key: 'host_map_foliage_rows_used_bytes',
    capacityKey: 'host_map_foliage_rows_capacity_bytes',
    label: 'foliage rows',
    origin: 'World',
    pool: 'host',
    detail: 'populated 12-float (48-byte) source rows for the streaming-resident foliage bubble across both ping-pong sets',
    warnBytes: 256 * MiB,
  },
  { id: 'map-foliage-snapshot', key: 'host_map_foliage_snapshot_bytes', label: 'foliage snapshot', origin: 'World', pool: 'host', detail: 'worker-facing compact data for streaming-resident foliage chunks only', warnBytes: 64 * MiB },
  { id: 'map-paint-residency', key: 'host_map_paint_residency_bytes', label: 'paint residency', origin: 'World', pool: 'host', detail: 'active-bubble Map Paint mirrors and render-ready cells', warnBytes: 128 * MiB },
  { id: 'map-roads', key: 'host_map_roads_bytes', label: 'road plan', origin: 'World', pool: 'host', detail: 'compiled native road and transport plan', warnBytes: 64 * MiB },
  { id: 'map-history', key: 'host_map_history_bytes', label: 'map history', origin: 'World', pool: 'host', detail: 'bounded native Map Paint undo and redo snapshots', warnBytes: 64 * MiB },
  {
    id: 'map-static-instances',
    key: 'gpu_map_static_instances_used_bytes',
    capacityKey: 'gpu_map_static_instances_capacity_bytes',
    label: 'static retained pool',
    origin: 'World',
    pool: 'gpu',
    detail: 'reserved retained GPU prefix; populated-prefix producers upload only initialized rows; superseded reservations persist until world reload',
    warnBytes: 256 * MiB,
    accounting: 'capacity',
  },
  {
    id: 'map-slim-instances',
    key: 'gpu_map_slim_instances_used_bytes',
    capacityKey: 'gpu_map_slim_instances_capacity_bytes',
    label: 'slim retained pool',
    origin: 'World',
    pool: 'gpu',
    detail: '24-byte packed GPU row reservations; active previews upload only populated prefixes; stable ping-pong capacities and superseded reservations persist until world reload',
    warnBytes: 256 * MiB,
    accounting: 'capacity',
  },
  { id: 'r3d-core', key: 'gpu_render3d_core_capacity_bytes', label: '3D core buffers', origin: 'Shell', pool: 'gpu', detail: 'actual allocated capacities: retained/frame vertices, instance buffers, ground streams, lights, and shadow resources', warnBytes: 512 * MiB },
  { id: 'r3d-targets', key: 'gpu_render3d_target_bytes', label: '3D render targets', origin: 'Shell', pool: 'gpu', detail: 'persistent Scene3D color and depth target pixels', warnBytes: 256 * MiB },
  { id: 'r3d-textures', key: 'gpu_render3d_diffuse_texture_bytes', label: '3D diffuse textures', origin: 'Shell', pool: 'gpu', detail: 'resident diffuse-cache and model-paint texture pixels', warnBytes: 256 * MiB },
  { id: 'atlas', key: 'gpu_glyph_atlas_bytes', label: 'glyph atlas', origin: 'Shell', pool: 'gpu', detail: '4096-square RGBA font atlas texture' },
  { id: 'glyphbuf', key: 'gpu_glyph_buffer_bytes', label: 'glyph buffer', origin: 'Shell', pool: 'gpu', detail: 'per-glyph GPU instance buffer capacity' },
  { id: 'uirect', key: 'gpu_ui_rect_bytes', label: 'ui rect buffer', origin: 'Shell', pool: 'gpu', detail: 'instanced-rect chrome buffer capacity' },
  { id: 'paint', key: 'gpu_paint_texture_bytes', label: 'paint surfaces', origin: 'Shell', pool: 'gpu', detail: 'paintable RGBA textures (Studio, decals)' },
  { id: 'jsheap', key: 'js_heap_total_bytes', label: 'v8 js heap', origin: 'Runtime', pool: 'host', detail: 'managed JS object heap (React tree + cart state)', warnBytes: 256 * MiB },
  { id: 'jsext', key: 'js_external_bytes', label: 'v8 external', origin: 'Runtime', pool: 'host', detail: 'ArrayBuffers + external bytes outside the JS heap', warnBytes: 256 * MiB },
  { id: 'jsmalloc', key: 'js_malloced_bytes', label: 'v8 malloced', origin: 'Runtime', pool: 'host', detail: 'V8 internal C++ malloc (zone, parser, compiler)' },
  { id: 'libc-live', key: 'host_libc_in_use_bytes', label: 'libc allocations in use', origin: 'Process', pool: 'host', accounting: 'none', detail: 'overlapping allocator-wide view across Zig, V8, wgpu, Mesa, and linked native libraries; diagnostic only, never double-counted into rss ownership' },
  { id: 'libc-free', key: 'host_libc_free_bytes', label: 'libc free arenas', origin: 'Process', pool: 'host', accounting: 'none', detail: 'free bytes still held in libc arenas; shader completion runs malloc_trim to return releasable pages', warnBytes: 256 * MiB },
  { id: 'libc-releasable', key: 'host_libc_releasable_bytes', label: 'libc immediately releasable', origin: 'Process', pool: 'host', accounting: 'none', detail: 'top-of-arena bytes glibc reports as releasable by malloc_trim' },
  { id: 'shader-peak', key: 'shader_compile_last_peak_growth_bytes', label: 'last shader compile peak', origin: 'Process', pool: 'host', accounting: 'none', detail: 'event-scoped RSS growth from just before compilation to its sampled high-water; diagnostic event, not a current owner', warnBytes: 512 * MiB },
  { id: 'shader-retained', key: 'shader_compile_last_retained_growth_bytes', label: 'last shader compile retained', origin: 'Process', pool: 'host', accounting: 'none', detail: 'RSS still above the pre-compile baseline after temporary modules/layouts were released and libc was trimmed', warnBytes: 256 * MiB },
  { id: 'shader-trim', key: 'shader_compile_last_trim_released_bytes', label: 'last shader trim returned', origin: 'Process', pool: 'host', accounting: 'none', detail: 'RSS returned to the OS by the post-compile glibc trim' },
];

function subsystemAccountingBytes(system: SystemTelemetry, sub: Subsystem): number {
  if (sub.accounting === 'none') return 0;
  if (sub.accounting === 'capacity' && sub.capacityKey) return memoryNumber(system, sub.capacityKey);
  return memoryNumber(system, sub.key);
}

const ORIGIN_LABEL: Record<Origin, string> = {
  World: 'World / Map',
  Shell: 'Shell / UI',
  Runtime: 'JS Runtime',
  Process: 'Process / OS',
};

export function memorySubsystemBaseline(system: SystemTelemetry | null | undefined): Record<string, number> {
  const baseline: Record<string, number> = {};
  for (const sub of SUBSYSTEMS) {
    baseline[`sub:${sub.id}`] = memoryNumber(system, sub.key);
    if (sub.capacityKey) baseline[`sub:${sub.id}:capacity`] = memoryNumber(system, sub.capacityKey);
  }
  return baseline;
}

const MAPPING_FIELDS: Array<{ id: string; key: keyof SystemTelemetry; label: string; detail: string; warnBytes?: number }> = [
  { id: 'anonymous', key: 'process_map_anonymous_rss_bytes', label: 'Anonymous native mappings', detail: 'unnamed and [anon:*] VMAs: V8 pages, wgpu/Mesa/LLVM arenas, direct mmap allocations, and non-main libc arenas', warnBytes: 512 * MiB },
  { id: 'heap', key: 'process_map_heap_rss_bytes', label: 'Main native heap', detail: 'resident pages in the kernel [heap] VMA used by libc-backed Zig and native allocations', warnBytes: 512 * MiB },
  { id: 'file', key: 'process_map_file_rss_bytes', label: 'Executable + file mappings', detail: 'resident executable, shared-library, shader-cache, and other file-backed VMAs' },
  { id: 'stack', key: 'process_map_stack_rss_bytes', label: 'Thread stacks', detail: 'resident pages in kernel [stack] VMAs' },
  { id: 'special', key: 'process_map_special_rss_bytes', label: 'Kernel special mappings', detail: 'resident vdso/vvar/vsyscall and other bracket-named kernel VMAs' },
];

export function memoryMappingBaseline(system: SystemTelemetry | null | undefined): Record<string, number> {
  const baseline: Record<string, number> = {};
  for (const field of MAPPING_FIELDS) baseline[`map:${field.id}`] = memoryNumber(system, field.key);
  return baseline;
}

/**
 * Exact, disjoint RSS partition from `/proc/self/smaps`. Every VMA's Rss value
 * appears in exactly one row. The status-file fallback is also disjoint, but
 * coarser, for platforms/permissions where smaps is unavailable.
 */
export function memoryMappingBuckets(system: SystemTelemetry | null, baseline: Record<string, number> | null): DiagnosticConsumer[] {
  if (!system) return [];
  const rows: DiagnosticConsumer[] = [];
  if (system.process_map_complete === true) {
    for (const field of MAPPING_FIELDS) {
      const current = memoryNumber(system, field.key);
      if (current <= 0) continue;
      const delta = current - (baseline?.[`map:${field.id}`] ?? current);
      rows.push({
        id: `mapping:${field.id}`,
        source: 'rss',
        label: field.label,
        value: formatMemory(current),
        detail: `${formatSignedMemory(delta)} since reset - exact kernel VMA RSS - ${field.detail}`,
        score: Math.max(0, delta) * 8 / MiB + current,
        hot: current >= (field.warnBytes ?? Number.POSITIVE_INFINITY),
      });
    }
  } else {
    const fallback = [
      { id: 'anonymous', key: 'process_rss_anon_bytes' as const, label: 'Anonymous RSS', detail: 'kernel RssAnon status total' },
      { id: 'file', key: 'process_rss_file_bytes' as const, label: 'File-backed RSS', detail: 'kernel RssFile status total' },
      { id: 'shared', key: 'process_rss_shmem_bytes' as const, label: 'Shared RSS', detail: 'kernel RssShmem status total' },
    ];
    for (const field of fallback) {
      const current = memoryNumber(system, field.key);
      if (current <= 0) continue;
      rows.push({ id: `mapping:${field.id}`, source: 'rss', label: field.label, value: formatMemory(current), detail: field.detail, score: current, hot: false });
    }
  }
  return rows.sort((a, b) => b.score - a.score);
}

/** Subsystem rows for the drill-down list — what holds memory, ranked by growth. */
export function memorySubsystems(system: SystemTelemetry | null, baseline: Record<string, number> | null): DiagnosticConsumer[] {
  if (!system) return [];
  const rows: DiagnosticConsumer[] = [];
  for (const sub of SUBSYSTEMS) {
    const current = memoryNumber(system, sub.key);
    const capacity = sub.capacityKey ? memoryNumber(system, sub.capacityKey) : 0;
    if (current <= 0 && capacity <= 0) continue;
    const start = baseline?.[`sub:${sub.id}`] ?? current;
    const delta = current - start;
    const capacityStart = baseline?.[`sub:${sub.id}:capacity`] ?? capacity;
    const capacityDelta = capacity - capacityStart;
    const growthScore = Math.max(0, delta) / MiB;
    const residentScore = current / (64 * MiB);
    const capacityDetail = sub.capacityKey
      ? `used of ${formatMemory(capacity)} capacity (${formatSignedMemory(capacityDelta)} capacity; capacity is informational and is not subtracted from rss) - `
      : '';
    rows.push({
      id: `subsystem:${sub.id}`,
      source: sub.pool,
      label: sub.label,
      value: formatMemory(current),
      detail: `${ORIGIN_LABEL[sub.origin]} - ${formatSignedMemory(delta)} used since reset - ${capacityDetail}${sub.detail}`,
      score: growthScore * 8 + residentScore,
      hot: Math.max(current, capacity) >= (sub.warnBytes ?? Number.POSITIVE_INFINITY),
    });
  }
  return rows.sort((a, b) => b.score - a.score);
}

/** Top-line origin buckets: how much the map vs the shell vs the runtime holds. */
export function memoryOriginBuckets(system: SystemTelemetry | null, baseline: Record<string, number> | null): DiagnosticConsumer[] {
  if (!system) return [];
  const origins: Origin[] = ['World', 'Shell', 'Runtime', 'Process'];
  const rows: DiagnosticConsumer[] = [];
  for (const origin of origins) {
    const subs = SUBSYSTEMS.filter((s) => s.origin === origin);
    let gpu = 0;
    let host = 0;
    let gpuDelta = 0;
    let hostDelta = 0;
    for (const sub of subs) {
      const current = subsystemAccountingBytes(system, sub);
      const baselineKey = sub.accounting === 'capacity' ? `sub:${sub.id}:capacity` : `sub:${sub.id}`;
      const subDelta = current - (baseline?.[baselineKey] ?? current);
      if (sub.pool === 'gpu') {
        gpu += current;
        gpuDelta += subDelta;
      } else {
        host += current;
        hostDelta += subDelta;
      }
    }
    if (gpu <= 0 && host <= 0) continue;
    const pool = gpu > 0 && host > 0 ? 'mixed' : gpu > 0 ? 'gpu' : 'host';
    const value = pool === 'mixed' ? `${formatMemory(host)} rss` : formatMemory(gpu > 0 ? gpu : host);
    const poolNote = pool === 'mixed'
      ? `${formatMemory(host)} process rss; ${formatMemory(gpu)} known gpu allocations are a separate, potentially driver-backed pool and are not added`
      : pool === 'gpu' ? 'known gpu allocations' : 'process rss';
    const deltaNote = pool === 'mixed'
      ? `${formatSignedMemory(hostDelta)} rss / ${formatSignedMemory(gpuDelta)} gpu since reset`
      : `${formatSignedMemory(gpu > 0 ? gpuDelta : hostDelta)} since reset`;
    rows.push({
      id: `origin:${origin}`,
      source: pool,
      label: ORIGIN_LABEL[origin],
      value,
      detail: `${deltaNote} - ${poolNote}`,
      score: Math.max(host, gpu),
      hot: false,
    });
  }
  return rows.sort((a, b) => b.score - a.score);
}

export type MemoryReconcile = {
  rss: number;
  hostTracked: number;
  gpuTracked: number;
};

/**
 * Reconcile tracked subsystems against the OS-reported RSS. Only host-pool
 * subsystems count against RSS; GPU-pool fields are reported separately as
 * known allocations (capacity for retained pools, use for exact-sized
 * textures). Overlapping allocator/compiler evidence has accounting='none'.
 * This function deliberately does not invent a semantic remainder: the exact
 * RSS partition comes from memoryMappingBuckets.
 */
export function memoryReconcile(system: SystemTelemetry | null | undefined): MemoryReconcile {
  let hostTracked = 0;
  let gpuTracked = 0;
  for (const sub of SUBSYSTEMS) {
    const bytes = subsystemAccountingBytes(system, sub);
    if (sub.pool === 'gpu') gpuTracked += bytes; else hostTracked += bytes;
  }
  const rss = memoryNumber(system, 'process_rss_bytes');
  return { rss, hostTracked, gpuTracked };
}
