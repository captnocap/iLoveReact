// Editor memory attribution tests.
//
//   tools/esbuild cart/editor/shell/memoryDiagnostics.test.ts --bundle \
//     --outfile=/tmp/editor-memory-diagnostics.test.js --format=iife \
//     --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-memory-diagnostics.test.js
import {
  memoryBaselineFor,
  memoryMappingBuckets,
  memoryOriginBuckets,
  memoryReconcile,
  memorySubsystems,
  type SystemTelemetry,
} from './memoryDiagnostics';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

const MiB = 1024 * 1024;
const mib = (value: number): number => value * MiB;

const attributed: SystemTelemetry = {
  process_rss_bytes: mib(1_000),
  js_heap_total_bytes: mib(100),
  host_mesh_stash_bytes: mib(15),
  host_map_chunks_bytes: mib(200),
  host_map_foliage_rows_used_bytes: mib(300),
  host_map_foliage_rows_capacity_bytes: mib(900),
  host_map_foliage_snapshot_bytes: mib(40),
  host_map_paint_residency_bytes: mib(20),
  host_map_roads_bytes: mib(10),
  host_map_history_bytes: mib(5),
  gpu_geom_intern_bytes: mib(20),
  gpu_glyph_atlas_bytes: mib(10),
  gpu_map_static_instances_used_bytes: mib(30),
  gpu_map_static_instances_capacity_bytes: mib(200),
  gpu_map_slim_instances_used_bytes: mib(40),
  gpu_map_slim_instances_capacity_bytes: mib(300),
};

test('reconcile subtracts explicit host owners and accounts actual gpu capacities in a separate pool', () => {
  const reconcile = memoryReconcile(attributed);
  assert(reconcile.hostTracked === mib(690), `host owners were ${reconcile.hostTracked / MiB} MiB`);
  assert(reconcile.gpuTracked === mib(510), `gpu allocation bytes were ${reconcile.gpuTracked / MiB} MiB`);
});

test('semantic owner evidence keeps rss and gpu separate and never manufactures a remainder row', () => {
  const rows = memoryOriginBuckets(attributed, null);
  const world = rows.find((row) => row.id === 'origin:World');
  assert(world?.value === '590M rss', `world bucket was ${world?.value}`);
  assert(world?.detail.includes('590M process rss; 500M known gpu allocations are a separate, potentially driver-backed pool and are not added') === true, `world pools were ${world?.detail}`);
  assert(rows.some((row) => row.id === 'origin:unattributed') === false, 'semantic evidence manufactured a mystery owner');
});

test('kernel file and shared rss are named process owners instead of anonymous remainder', () => {
  const system: SystemTelemetry = {
    process_rss_bytes: mib(1_000),
    process_rss_file_bytes: mib(170),
    process_rss_shmem_bytes: mib(2),
    host_map_chunks_bytes: mib(300),
  };
  const reconcile = memoryReconcile(system);
  assert(reconcile.hostTracked === mib(472), `named host owners were ${reconcile.hostTracked / MiB} MiB`);
  const process = memoryOriginBuckets(system, null).find((row) => row.id === 'origin:Process');
  assert(process?.value === '172M', `process/os bucket was ${process?.value}`);
});

test('kernel mapping rows are disjoint and sum exactly to mapped rss', () => {
  const system: SystemTelemetry = {
    process_rss_bytes: mib(1_000),
    process_map_complete: true,
    process_map_total_rss_bytes: mib(1_000),
    process_map_anonymous_rss_bytes: mib(500),
    process_map_heap_rss_bytes: mib(200),
    process_map_file_rss_bytes: mib(280),
    process_map_stack_rss_bytes: mib(15),
    process_map_special_rss_bytes: mib(5),
  };
  const rows = memoryMappingBuckets(system, null);
  const sum = rows.reduce((total, row) => {
    const numeric = row.id === 'mapping:anonymous' ? 500 : row.id === 'mapping:heap' ? 200 : row.id === 'mapping:file' ? 280 : row.id === 'mapping:stack' ? 15 : row.id === 'mapping:special' ? 5 : 0;
    return total + numeric;
  }, 0);
  assert(rows.length === 5, `mapping partition had ${rows.length} rows`);
  assert(sum === 1_000, `mapping partition summed to ${sum} MiB`);
  assert(rows.some((row) => row.label.includes('not assigned')) === false, 'mapping partition retained a mystery row');
});

test('paired rows show used and capacity while baselining both', () => {
  const baseline = memoryBaselineFor(attributed);
  const later = {
    ...attributed,
    host_map_foliage_rows_used_bytes: mib(320),
    host_map_foliage_rows_capacity_bytes: mib(1_024),
  };
  const foliage = memorySubsystems(later, baseline).find((row) => row.id === 'subsystem:map-foliage-rows');
  assert(foliage?.value === '320M', `foliage used value was ${foliage?.value}`);
  assert(foliage?.detail.includes('1.00G capacity') === true, `capacity was missing: ${foliage?.detail}`);
  assert(foliage?.detail.includes('+124M capacity') === true, `capacity delta was missing: ${foliage?.detail}`);
  assert(foliage?.detail.includes('not subtracted from rss') === true, `capacity accounting rule was missing: ${foliage?.detail}`);
  assert(foliage?.detail.includes('48-byte') === true, `host source-row layout was missing: ${foliage?.detail}`);

  const slim = memorySubsystems(later, baseline).find((row) => row.id === 'subsystem:map-slim-instances');
  assert(slim?.label === 'slim retained pool', `slim pool label was ${slim?.label}`);
  assert(slim?.detail.includes('24-byte packed GPU row reservations') === true, `slim packing was missing: ${slim?.detail}`);
  assert(slim?.detail.includes('upload only populated prefixes') === true, `retained upload behavior was missing: ${slim?.detail}`);
});

test('missing and invalid telemetry degrades to zero without phantom owners', () => {
  const system = { process_rss_bytes: mib(64), host_map_chunks_bytes: Number.NaN };
  const reconcile = memoryReconcile(system);
  assert(reconcile.hostTracked === 0 && reconcile.gpuTracked === 0, 'missing owners did not degrade to zero');
  assert(memorySubsystems(system, null).length === 0, 'missing owners produced subsystem rows');
  assert(memoryMappingBuckets(system, null).length === 0, 'missing mapping telemetry produced phantom buckets');
});

test('native allocator and shader compile evidence never double-counts rss ownership', () => {
  const system: SystemTelemetry = {
    process_rss_bytes: mib(900),
    js_heap_total_bytes: mib(100),
    host_libc_in_use_bytes: mib(700),
    host_libc_free_bytes: mib(300),
    shader_compile_last_peak_growth_bytes: mib(2_500),
    shader_compile_last_retained_growth_bytes: mib(600),
    shader_compile_last_trim_released_bytes: mib(1_900),
    gpu_render3d_core_capacity_bytes: mib(320),
  };
  const reconcile = memoryReconcile(system);
  assert(reconcile.hostTracked === mib(100), `overlapping native evidence entered host sum: ${reconcile.hostTracked / MiB} MiB`);
  assert(reconcile.gpuTracked === mib(320), `known gpu allocation was not counted: ${reconcile.gpuTracked / MiB} MiB`);
  const rows = memorySubsystems(system, null);
  assert(rows.some((row) => row.id === 'subsystem:libc-live'), 'libc evidence row missing');
  assert(rows.some((row) => row.id === 'subsystem:shader-peak'), 'shader peak evidence row missing');
  assert(rows.some((row) => row.id === 'subsystem:r3d-core'), '3D allocation row missing');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
