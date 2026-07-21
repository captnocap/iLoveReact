(() => {
  // cart/editor/shell/memoryDiagnostics.ts
  var KiB = 1024;
  var MiB = KiB * 1024;
  var GiB = MiB * 1024;
  var MEMORY_FIELDS = [
    {
      id: "rss",
      key: "process_rss_bytes",
      label: "process rss",
      detail: "total resident memory held by the editor process",
      warnBytes: GiB,
      warnDeltaBytes: 64 * MiB
    },
    {
      id: "anon",
      key: "process_rss_anon_bytes",
      label: "anon rss",
      detail: "private anonymous resident pages: JS/native heaps, stacks, JIT pages",
      warnBytes: 512 * MiB,
      warnDeltaBytes: 32 * MiB
    },
    {
      id: "file",
      key: "process_rss_file_bytes",
      label: "file rss",
      detail: "file-backed resident pages: libraries, mapped assets, caches",
      warnBytes: 512 * MiB,
      warnDeltaBytes: 64 * MiB
    },
    {
      id: "shmem",
      key: "process_rss_shmem_bytes",
      label: "shared rss",
      detail: "shared resident pages owned with the OS or GPU stack",
      warnDeltaBytes: 32 * MiB
    },
    {
      id: "rss-peak",
      key: "process_rss_peak_bytes",
      label: "rss peak",
      detail: "OS high-water resident set since this process started",
      warnBytes: GiB
    },
    {
      id: "vm-data",
      key: "process_vm_data_bytes",
      label: "vm data",
      detail: "virtual data/heap reservation reported by the kernel",
      warnDeltaBytes: 64 * MiB
    },
    {
      id: "vm-size",
      key: "process_vsize_bytes",
      label: "vm size",
      detail: "total virtual address space reservation, not all resident",
      warnDeltaBytes: 128 * MiB
    },
    {
      id: "swap",
      key: "process_vm_swap_bytes",
      label: "swap",
      detail: "process memory currently swapped out",
      warnBytes: MiB
    },
    {
      id: "vm-stack",
      key: "process_vm_stack_bytes",
      label: "vm stack",
      detail: "thread stack reservation",
      warnDeltaBytes: 8 * MiB
    },
    {
      id: "vm-lib",
      key: "process_vm_lib_bytes",
      label: "vm libs",
      detail: "mapped library reservation",
      warnDeltaBytes: 32 * MiB
    }
  ];
  function memoryNumber(system, key) {
    const value = system?.[key];
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
  }
  function formatMemory(bytes) {
    const n = Math.max(0, Math.round(bytes ?? 0));
    if (n >= GiB) return `${(n / GiB).toFixed(n >= 10 * GiB ? 1 : 2)}G`;
    if (n >= MiB) return `${(n / MiB).toFixed(n >= 100 * MiB ? 0 : 1)}M`;
    if (n >= KiB) return `${(n / KiB).toFixed(n >= 100 * KiB ? 0 : 1)}K`;
    return `${n}B`;
  }
  function formatSignedMemory(bytes) {
    if (!bytes) return "+0B";
    return `${bytes > 0 ? "+" : "-"}${formatMemory(Math.abs(bytes))}`;
  }
  function memoryBaselineFor(system) {
    const baseline = {};
    for (const field of MEMORY_FIELDS) {
      baseline[field.id] = memoryNumber(system, field.key);
    }
    return { ...baseline, ...memorySubsystemBaseline(system) };
  }
  var SUBSYSTEMS = [
    { id: "file-rss", key: "process_rss_file_bytes", label: "file-backed rss", origin: "Process", pool: "host", detail: "resident executable, shared-library, and file-mapped pages reported by the kernel", warnBytes: 256 * MiB },
    { id: "shared-rss", key: "process_rss_shmem_bytes", label: "shared-memory rss", origin: "Process", pool: "host", detail: "resident shared-memory pages reported by the kernel", warnBytes: 128 * MiB },
    { id: "geom", key: "gpu_geom_intern_bytes", label: "geometry intern", origin: "World", pool: "gpu", detail: "interned world meshes (props, buildings, chunks) - never evicts", warnBytes: 256 * MiB },
    { id: "stash", key: "host_mesh_stash_bytes", label: "mesh stash", origin: "World", pool: "host", detail: "host-parked vertex copies awaiting intern" },
    { id: "map-chunks", key: "host_map_chunks_bytes", label: "map chunks", origin: "World", pool: "host", detail: "canonical native map chunk storage", warnBytes: 256 * MiB },
    {
      id: "map-foliage-rows",
      key: "host_map_foliage_rows_used_bytes",
      capacityKey: "host_map_foliage_rows_capacity_bytes",
      label: "foliage rows",
      origin: "World",
      pool: "host",
      detail: "populated 12-float (48-byte) source rows for the streaming-resident foliage bubble across both ping-pong sets",
      warnBytes: 256 * MiB
    },
    { id: "map-foliage-snapshot", key: "host_map_foliage_snapshot_bytes", label: "foliage snapshot", origin: "World", pool: "host", detail: "worker-facing compact data for streaming-resident foliage chunks only", warnBytes: 64 * MiB },
    { id: "map-paint-residency", key: "host_map_paint_residency_bytes", label: "paint residency", origin: "World", pool: "host", detail: "active-bubble Map Paint mirrors and render-ready cells", warnBytes: 128 * MiB },
    { id: "map-roads", key: "host_map_roads_bytes", label: "road plan", origin: "World", pool: "host", detail: "compiled native road and transport plan", warnBytes: 64 * MiB },
    { id: "map-history", key: "host_map_history_bytes", label: "map history", origin: "World", pool: "host", detail: "bounded native Map Paint undo and redo snapshots", warnBytes: 64 * MiB },
    {
      id: "map-static-instances",
      key: "gpu_map_static_instances_used_bytes",
      capacityKey: "gpu_map_static_instances_capacity_bytes",
      label: "static retained pool",
      origin: "World",
      pool: "gpu",
      detail: "reserved retained GPU prefix; populated-prefix producers upload only initialized rows; superseded reservations persist until world reload",
      warnBytes: 256 * MiB
    },
    {
      id: "map-slim-instances",
      key: "gpu_map_slim_instances_used_bytes",
      capacityKey: "gpu_map_slim_instances_capacity_bytes",
      label: "slim retained pool",
      origin: "World",
      pool: "gpu",
      detail: "24-byte packed GPU row reservations; active previews upload only populated prefixes; stable ping-pong capacities and superseded reservations persist until world reload",
      warnBytes: 256 * MiB
    },
    { id: "atlas", key: "gpu_glyph_atlas_bytes", label: "glyph atlas", origin: "Shell", pool: "gpu", detail: "4096-square RGBA font atlas texture" },
    { id: "glyphbuf", key: "gpu_glyph_buffer_bytes", label: "glyph buffer", origin: "Shell", pool: "gpu", detail: "per-glyph GPU instance buffer capacity" },
    { id: "uirect", key: "gpu_ui_rect_bytes", label: "ui rect buffer", origin: "Shell", pool: "gpu", detail: "instanced-rect chrome buffer capacity" },
    { id: "paint", key: "gpu_paint_texture_bytes", label: "paint surfaces", origin: "Shell", pool: "gpu", detail: "paintable RGBA textures (Studio, decals)" },
    { id: "jsheap", key: "js_heap_total_bytes", label: "v8 js heap", origin: "Runtime", pool: "host", detail: "managed JS object heap (React tree + cart state)", warnBytes: 256 * MiB },
    { id: "jsext", key: "js_external_bytes", label: "v8 external", origin: "Runtime", pool: "host", detail: "ArrayBuffers + external bytes outside the JS heap", warnBytes: 256 * MiB },
    { id: "jsmalloc", key: "js_malloced_bytes", label: "v8 malloced", origin: "Runtime", pool: "host", detail: "V8 internal C++ malloc (zone, parser, compiler)" }
  ];
  var ORIGIN_LABEL = {
    World: "World / Map",
    Shell: "Shell / UI",
    Runtime: "JS Runtime",
    Process: "Process / OS"
  };
  function memorySubsystemBaseline(system) {
    const baseline = {};
    for (const sub of SUBSYSTEMS) {
      baseline[`sub:${sub.id}`] = memoryNumber(system, sub.key);
      if (sub.capacityKey) baseline[`sub:${sub.id}:capacity`] = memoryNumber(system, sub.capacityKey);
    }
    return baseline;
  }
  function memorySubsystems(system, baseline) {
    if (!system) return [];
    const rows = [];
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
      const capacityDetail = sub.capacityKey ? `used of ${formatMemory(capacity)} capacity (${formatSignedMemory(capacityDelta)} capacity; capacity is informational and is not subtracted from rss) - ` : "";
      rows.push({
        id: `subsystem:${sub.id}`,
        source: sub.pool,
        label: sub.label,
        value: formatMemory(current),
        detail: `${ORIGIN_LABEL[sub.origin]} - ${formatSignedMemory(delta)} used since reset - ${capacityDetail}${sub.detail}`,
        score: growthScore * 8 + residentScore,
        hot: Math.max(current, capacity) >= (sub.warnBytes ?? Number.POSITIVE_INFINITY)
      });
    }
    return rows.sort((a, b) => b.score - a.score);
  }
  function memoryOriginBuckets(system, baseline) {
    if (!system) return [];
    const origins = ["World", "Shell", "Runtime", "Process"];
    const rows = [];
    for (const origin of origins) {
      const subs = SUBSYSTEMS.filter((s) => s.origin === origin);
      let gpu = 0;
      let host = 0;
      let gpuDelta = 0;
      let hostDelta = 0;
      for (const sub of subs) {
        const current = memoryNumber(system, sub.key);
        const subDelta = current - (baseline?.[`sub:${sub.id}`] ?? current);
        if (sub.pool === "gpu") {
          gpu += current;
          gpuDelta += subDelta;
        } else {
          host += current;
          hostDelta += subDelta;
        }
      }
      if (gpu <= 0 && host <= 0) continue;
      const pool = gpu > 0 && host > 0 ? "mixed" : gpu > 0 ? "gpu" : "host";
      const value = pool === "mixed" ? `${formatMemory(host)} rss` : formatMemory(gpu > 0 ? gpu : host);
      const poolNote = pool === "mixed" ? `${formatMemory(host)} process rss; ${formatMemory(gpu)} tracked gpu use is a separate pool and is not added` : pool === "gpu" ? "tracked gpu use" : "process rss";
      const deltaNote = pool === "mixed" ? `${formatSignedMemory(hostDelta)} rss / ${formatSignedMemory(gpuDelta)} gpu since reset` : `${formatSignedMemory(gpu > 0 ? gpuDelta : hostDelta)} since reset`;
      rows.push({
        id: `origin:${origin}`,
        source: pool,
        label: ORIGIN_LABEL[origin],
        value,
        detail: `${deltaNote} - ${poolNote}`,
        score: Math.max(host, gpu),
        hot: false
      });
    }
    const rss = memoryNumber(system, "process_rss_bytes");
    const reconcile = memoryReconcile(system);
    if (rss > 0) {
      rows.push({
        id: "origin:unattributed",
        source: "rss",
        label: "Unattributed anonymous RSS",
        value: formatMemory(reconcile.unattributed),
        detail: `anonymous process rss not yet assigned to an explicit host owner; capacity-only figures and separate gpu fields are not subtracted`,
        score: reconcile.unattributed,
        hot: reconcile.unattributed >= 512 * MiB
      });
    }
    return rows.sort((a, b) => b.score - a.score);
  }
  function memoryReconcile(system) {
    let hostTracked = 0;
    let gpuTracked = 0;
    for (const sub of SUBSYSTEMS) {
      const bytes = memoryNumber(system, sub.key);
      if (sub.pool === "gpu") gpuTracked += bytes;
      else hostTracked += bytes;
    }
    const rss = memoryNumber(system, "process_rss_bytes");
    return { rss, hostTracked, gpuTracked, unattributed: Math.max(0, rss - hostTracked) };
  }

  // cart/editor/shell/memoryDiagnostics.test.ts
  var passed = 0;
  var failed = 0;
  var log = globalThis.print ?? ((s) => globalThis.__writeStdout?.(`${s}
`));
  function test(name, fn) {
    try {
      fn();
      passed += 1;
      log(`  ok  ${name}`);
    } catch (error) {
      failed += 1;
      log(`FAIL  ${name}: ${error.message}`);
    }
  }
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
  var MiB2 = 1024 * 1024;
  var mib = (value) => value * MiB2;
  var attributed = {
    process_rss_bytes: mib(1e3),
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
    gpu_map_slim_instances_capacity_bytes: mib(300)
  };
  test("reconcile subtracts explicit used host owners but never capacity or separate gpu fields", () => {
    const reconcile = memoryReconcile(attributed);
    assert(reconcile.hostTracked === mib(690), `host owners were ${reconcile.hostTracked / MiB2} MiB`);
    assert(reconcile.gpuTracked === mib(100), `gpu used bytes were ${reconcile.gpuTracked / MiB2} MiB`);
    assert(reconcile.unattributed === mib(310), `unattributed rss was ${reconcile.unattributed / MiB2} MiB`);
  });
  test("mixed world origin keeps rss and gpu as separate pools", () => {
    const rows = memoryOriginBuckets(attributed, null);
    const world = rows.find((row) => row.id === "origin:World");
    assert(world?.value === "590M rss", `world bucket was ${world?.value}`);
    assert(world?.detail.includes("590M process rss; 90.0M tracked gpu use is a separate pool and is not added") === true, `world pools were ${world?.detail}`);
    const remainder = rows.find((row) => row.id === "origin:unattributed");
    assert(remainder?.label === "Unattributed anonymous RSS", `remainder label was ${remainder?.label}`);
    assert(remainder?.value === "310M", `remainder was ${remainder?.value}`);
  });
  test("kernel file and shared rss are named process owners instead of anonymous remainder", () => {
    const system = {
      process_rss_bytes: mib(1e3),
      process_rss_file_bytes: mib(170),
      process_rss_shmem_bytes: mib(2),
      host_map_chunks_bytes: mib(300)
    };
    const reconcile = memoryReconcile(system);
    assert(reconcile.hostTracked === mib(472), `named host owners were ${reconcile.hostTracked / MiB2} MiB`);
    assert(reconcile.unattributed === mib(528), `anonymous remainder was ${reconcile.unattributed / MiB2} MiB`);
    const process = memoryOriginBuckets(system, null).find((row) => row.id === "origin:Process");
    assert(process?.value === "172M", `process/os bucket was ${process?.value}`);
  });
  test("paired rows show used and capacity while baselining both", () => {
    const baseline = memoryBaselineFor(attributed);
    const later = {
      ...attributed,
      host_map_foliage_rows_used_bytes: mib(320),
      host_map_foliage_rows_capacity_bytes: mib(1024)
    };
    const foliage = memorySubsystems(later, baseline).find((row) => row.id === "subsystem:map-foliage-rows");
    assert(foliage?.value === "320M", `foliage used value was ${foliage?.value}`);
    assert(foliage?.detail.includes("1.00G capacity") === true, `capacity was missing: ${foliage?.detail}`);
    assert(foliage?.detail.includes("+124M capacity") === true, `capacity delta was missing: ${foliage?.detail}`);
    assert(foliage?.detail.includes("not subtracted from rss") === true, `capacity accounting rule was missing: ${foliage?.detail}`);
    assert(foliage?.detail.includes("48-byte") === true, `host source-row layout was missing: ${foliage?.detail}`);
    const slim = memorySubsystems(later, baseline).find((row) => row.id === "subsystem:map-slim-instances");
    assert(slim?.label === "slim retained pool", `slim pool label was ${slim?.label}`);
    assert(slim?.detail.includes("24-byte packed GPU row reservations") === true, `slim packing was missing: ${slim?.detail}`);
    assert(slim?.detail.includes("upload only populated prefixes") === true, `retained upload behavior was missing: ${slim?.detail}`);
  });
  test("missing and invalid telemetry degrades to zero without phantom owners", () => {
    const system = { process_rss_bytes: mib(64), host_map_chunks_bytes: Number.NaN };
    const reconcile = memoryReconcile(system);
    assert(reconcile.hostTracked === 0 && reconcile.gpuTracked === 0, "missing owners did not degrade to zero");
    assert(reconcile.unattributed === mib(64), "rss remainder disappeared");
    assert(memorySubsystems(system, null).length === 0, "missing owners produced subsystem rows");
    const buckets = memoryOriginBuckets(system, null);
    assert(buckets.length === 1 && buckets[0]?.id === "origin:unattributed", "missing owners produced origin buckets");
  });
  log(`
${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} test(s) failed`);
})();
