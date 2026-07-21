//! mem_breakdown — per-subsystem memory attribution for the editor's memory
//! popover. Pull-model: each engine subsystem exposes a cheap `*Bytes()` reader
//! over its own globals, and this module polls them once per telemetry sample
//! (~1 Hz). Nothing is bookkept in hot allocation paths.
//!
//! Two pools, kept deliberately distinct: `host` fields describe allocations in
//! the editor process, while `gpu` fields describe device resources (which a
//! shared-memory/driver backend may also back with process RSS). A host
//! `*_capacity_bytes` value can include lazily committed address space, so the JS
//! consumer displays it but reconciles RSS only with the populated/used value.
//! GPU bytes never get folded into RSS. The still-unassigned process remainder
//! stays explicit and must never be labeled "driver": these counters identify
//! only allocations whose owners can state their sizes directly.

const geo3d = @import("../gpu/3d.zig");
const text = @import("../gpu/text.zig");
const rects = @import("../gpu/rects.zig");
const paintable = @import("../gpu/paintable.zig");
const v8rt = @import("../v8_runtime.zig");
const map_chunks = @import("../game/map/chunks.zig");
const map_engine = @import("../game/map/engine.zig");
const world_loader = @import("../world_loader.zig");
const system_memory = @import("system_memory.zig");
const compile_progress = @import("../gpu/compile_progress.zig");

pub const Breakdown = struct {
    // ── GPU / VRAM (device-local) ───────────────────────────────────────────
    geom_intern_bytes: u64 = 0, // origin: world  — interned meshes, never evicts
    glyph_atlas_bytes: u64 = 0, // origin: shell  — 4096² RGBA font atlas
    glyph_buffer_bytes: u64 = 0, // origin: shell — per-glyph instance buffer
    ui_rect_bytes: u64 = 0, // origin: shell      — instanced-rect chrome buffer
    paint_texture_bytes: u64 = 0, // origin: shell — paintable surfaces
    gpu_map_static_instances_used_bytes: u64 = 0,
    gpu_map_static_instances_capacity_bytes: u64 = 0,
    gpu_map_slim_instances_used_bytes: u64 = 0,
    gpu_map_slim_instances_capacity_bytes: u64 = 0,
    gpu_render3d_core_capacity_bytes: u64 = 0,
    gpu_render3d_target_bytes: u64 = 0,
    gpu_render3d_diffuse_texture_bytes: u64 = 0,
    // ── Host-owned process allocations ──────────────────────────────────────
    js_heap_used_bytes: u64 = 0, // origin: runtime
    js_heap_total_bytes: u64 = 0, // origin: runtime
    js_external_bytes: u64 = 0, // origin: runtime — ArrayBuffers / external
    js_malloced_bytes: u64 = 0, // origin: runtime — V8 internal C++ malloc
    host_mesh_stash_bytes: u64 = 0, // origin: world — host-parked vertex copies
    host_map_chunks_bytes: u64 = 0,
    host_map_foliage_rows_used_bytes: u64 = 0,
    host_map_foliage_rows_capacity_bytes: u64 = 0,
    host_map_foliage_snapshot_bytes: u64 = 0,
    host_map_paint_residency_bytes: u64 = 0,
    host_map_roads_bytes: u64 = 0,
    host_map_history_bytes: u64 = 0,
    // Overlapping native-process diagnostics. These are displayed as evidence,
    // but the cart must not add/subtract them alongside V8/subsystem owners.
    host_libc_in_use_bytes: u64 = 0,
    host_libc_arena_bytes: u64 = 0,
    host_libc_mmap_bytes: u64 = 0,
    host_libc_free_bytes: u64 = 0,
    host_libc_releasable_bytes: u64 = 0,
    shader_compile_count: u64 = 0,
    shader_compile_last_peak_growth_bytes: u64 = 0,
    shader_compile_last_retained_growth_bytes: u64 = 0,
    shader_compile_last_trim_released_bytes: u64 = 0,
};

pub fn read() Breakdown {
    const loader_map = world_loader.mapMemoryStats();
    const gpu_instances = geo3d.staticInstanceMemoryStats();
    const gpu3d = geo3d.gpuMemoryStats();
    const native = system_memory.readAllocatorSnapshot();
    const shader_compile = compile_progress.memoryStats();
    var b = Breakdown{
        .geom_intern_bytes = geo3d.retainedGeometryBytes(),
        .host_mesh_stash_bytes = geo3d.hostStashBytes(),
        .glyph_atlas_bytes = text.atlasTextureBytes(),
        .glyph_buffer_bytes = text.glyphBufferBytes(),
        .ui_rect_bytes = rects.instanceBufferBytes(),
        .paint_texture_bytes = paintable.residentTextureBytes(),
        .gpu_map_static_instances_used_bytes = gpu_instances.standard_used_bytes,
        .gpu_map_static_instances_capacity_bytes = gpu_instances.standard_capacity_bytes,
        .gpu_map_slim_instances_used_bytes = gpu_instances.slim_used_bytes,
        .gpu_map_slim_instances_capacity_bytes = gpu_instances.slim_capacity_bytes,
        .gpu_render3d_core_capacity_bytes = gpu3d.core_buffer_capacity_bytes,
        .gpu_render3d_target_bytes = gpu3d.render_target_bytes,
        .gpu_render3d_diffuse_texture_bytes = gpu3d.diffuse_texture_bytes,
        .host_map_chunks_bytes = map_chunks.allocatedBytes(),
        .host_map_foliage_rows_used_bytes = loader_map.foliage_rows_used_bytes,
        .host_map_foliage_rows_capacity_bytes = loader_map.foliage_rows_capacity_bytes,
        .host_map_foliage_snapshot_bytes = loader_map.foliage_snapshot_bytes,
        .host_map_paint_residency_bytes = loader_map.paint_residency_bytes,
        .host_map_roads_bytes = map_engine.roadAllocatedBytes(),
        .host_map_history_bytes = map_engine.mapHistoryAllocatedBytes(),
        .host_libc_in_use_bytes = native.in_use_bytes,
        .host_libc_arena_bytes = native.arena_bytes,
        .host_libc_mmap_bytes = native.mmap_bytes,
        .host_libc_free_bytes = native.free_bytes,
        .host_libc_releasable_bytes = native.releasable_bytes,
        .shader_compile_count = shader_compile.compile_count,
        .shader_compile_last_peak_growth_bytes = shader_compile.last_peak_growth_bytes,
        .shader_compile_last_retained_growth_bytes = shader_compile.last_retained_growth_bytes,
        .shader_compile_last_trim_released_bytes = shader_compile.last_trim_released_bytes,
    };
    if (v8rt.jsHeap()) |h| {
        b.js_heap_used_bytes = h.used;
        b.js_heap_total_bytes = h.total;
        b.js_external_bytes = h.external;
        b.js_malloced_bytes = h.malloced;
    }
    return b;
}
