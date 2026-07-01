//! mem_breakdown — per-subsystem memory attribution for the editor's memory
//! popover. Pull-model: each engine subsystem exposes a cheap `*Bytes()` reader
//! over its own globals, and this module polls them once per telemetry sample
//! (~1 Hz). Nothing is bookkept in hot allocation paths.
//!
//! Two pools, kept deliberately distinct: `host` bytes are process RSS (the V8
//! managed heap is anonymous mmap in this process; the mesh stash is c_allocator
//! memory). `gpu` bytes are device-local (VRAM) — geometry intern, glyph atlas,
//! the UI rect buffer, paint textures. The two do NOT both land in the RSS the
//! OS reports, so the JS consumer must not fold them into one total: it sums host
//! bytes against RSS (the remainder = native/driver), and reports GPU separately.

const geo3d = @import("../gpu/3d.zig");
const text = @import("../gpu/text.zig");
const rects = @import("../gpu/rects.zig");
const paintable = @import("../gpu/paintable.zig");
const v8rt = @import("../v8_runtime.zig");

pub const Breakdown = struct {
    // ── GPU / VRAM (device-local) ───────────────────────────────────────────
    geom_intern_bytes: u64 = 0, // origin: world  — interned meshes, never evicts
    glyph_atlas_bytes: u64 = 0, // origin: shell  — 4096² RGBA font atlas
    glyph_buffer_bytes: u64 = 0, // origin: shell — per-glyph instance buffer
    ui_rect_bytes: u64 = 0, // origin: shell      — instanced-rect chrome buffer
    paint_texture_bytes: u64 = 0, // origin: shell — paintable surfaces
    // ── Host / RSS ──────────────────────────────────────────────────────────
    js_heap_used_bytes: u64 = 0, // origin: runtime
    js_heap_total_bytes: u64 = 0, // origin: runtime
    js_external_bytes: u64 = 0, // origin: runtime — ArrayBuffers / external
    js_malloced_bytes: u64 = 0, // origin: runtime — V8 internal C++ malloc
    host_mesh_stash_bytes: u64 = 0, // origin: world — host-parked vertex copies
};

pub fn read() Breakdown {
    var b = Breakdown{
        .geom_intern_bytes = geo3d.retainedGeometryBytes(),
        .host_mesh_stash_bytes = geo3d.hostStashBytes(),
        .glyph_atlas_bytes = text.atlasTextureBytes(),
        .glyph_buffer_bytes = text.glyphBufferBytes(),
        .ui_rect_bytes = rects.instanceBufferBytes(),
        .paint_texture_bytes = paintable.residentTextureBytes(),
    };
    if (v8rt.jsHeap()) |h| {
        b.js_heap_used_bytes = h.used;
        b.js_heap_total_bytes = h.total;
        b.js_external_bytes = h.external;
        b.js_malloced_bytes = h.malloced;
    }
    return b;
}
