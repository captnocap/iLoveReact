//! V8 bindings for the HOT AUTHORING-STATE INDEX (framework/editor/hot_index.zig).
//!
//! React's ONLY window into the index. The fold loop is host-only and event-fed;
//! React never drives it — it reads a counts-only summary and issues selection
//! intent. Doors:
//!   __editor_index_summary()        → json  ({objects, occupiedChunks, dirtyIds,
//!                                             dirtyChunks, selected, lastSeq})
//!   __editor_index_select(id)       → void  (add id to the live selection)
//!   __editor_index_deselect(id)     → void  (remove id from the selection)
//!   __editor_index_clear_selection()→ void
//!   __editor_index_selected_count() → number
//!
//! All operate on the process-wide singleton `hot_index.instance()` — the SAME
//! instance the editor_bus append hook folds confirmed events into (below).
//!
// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION — the supervisor must add these to wire this module in.
//
// 1) THE BUS HOOK (the one line that feeds the index). In
//    framework/events/editor_bus.zig::append(), AFTER the event is committed —
//    i.e. right after the existing broadcast line near the end of append():
//
//        if (g_broadcaster) |bc| bc(confirmed);
//        @import("../editor/hot_index.zig").instance().observe(seq, confirmed); // ← ADD
//
//        return seq;
//
//    `confirmed` is the seq-stamped envelope and is still valid here (it is freed
//    only when the ring slot is later overwritten). observe() never frees it and
//    re-parses it independently, so ownership is unaffected. observe() is
//    O(targets) and allocation-bounded; it cannot fail the append (it returns a
//    bool the bus ignores). This is the ONLY edit editor_bus.zig needs — do not
//    add any other coupling.
//
//    (If editor_bus.zig prefers zero @import of an editor/ sibling, expose a
//    `pub var on_committed: ?*const fn (i64, []const u8) void` in editor_bus and
//    have registerHotIndex() install a thunk that calls observe(). Either wiring
//    satisfies the seam; the direct @import above is the minimal one.)
//
// 2) framework/v8_ingredients.zig — add the import beside the other always-on
//    binding imports (near the v8_bindings_editor_bus line):
//
//        const v8_bindings_hot_index = @import("editor/v8_bindings_hot_index.zig");
//
//    and ONE entry in the INGREDIENTS array, in the always-on (required=true)
//    block (right after the `editor_bus` entry):
//
//        .{ .name = "hot_index", .required = true, .grep_prefix = "", .reg_fn = "registerHotIndex", .mod = v8_bindings_hot_index },
//
// 3) build.zig — NO production change needed: pulled into the root module
//    transitively via the @import above. Its deps (../v8_runtime.zig,
//    framework/world/chunk_dirty.zig, framework/world/compile_cache.zig) are
//    already in the compile graph. NOTE: the production root reaches hot_index.zig
//    by RELATIVE import (this file's `@import("hot_index.zig")`), which in turn
//    imports world_chunk_dirty / world_compile_cache. For the ROOT build those two
//    are reached relative; the named-module wiring below is only for the unit test.
//
// 4) build.zig — UNIT TEST step (only to RUN the test, not to ship). Mirror the
//    world_gamefile_writer_test block (~1189). hot_index.zig imports two sibling
//    modules, so the test rig must provide both under their module names:
//
//        const world_compile_cache_mod = b.createModule(.{
//            .root_source_file = b.path("framework/world/compile_cache.zig"),
//            .target = target, .optimize = optimize, .link_libc = true,
//        });
//        const world_chunk_dirty_mod = b.createModule(.{
//            .root_source_file = b.path("framework/world/chunk_dirty.zig"),
//            .target = target, .optimize = optimize, .link_libc = true,
//        });
//        world_chunk_dirty_mod.addImport("world_compile_cache", world_compile_cache_mod);
//        const hot_index_mod_for_tests = b.createModule(.{
//            .root_source_file = b.path("framework/editor/hot_index.zig"),
//            .target = target, .optimize = optimize, .link_libc = true,
//        });
//        hot_index_mod_for_tests.addImport("world_chunk_dirty", world_chunk_dirty_mod);
//        hot_index_mod_for_tests.addImport("world_compile_cache", world_compile_cache_mod);
//        const hot_index_test_mod = b.createModule(.{
//            .root_source_file = b.path("framework/testing/unit/hot_index.zig"),
//            .target = target, .optimize = optimize, .link_libc = true,
//        });
//        hot_index_test_mod.addImport("hot_index", hot_index_mod_for_tests);
//        hot_index_test_mod.addImport("world_chunk_dirty", world_chunk_dirty_mod);
//        hot_index_test_mod.addImport("world_compile_cache", world_compile_cache_mod);
//        const hot_index_test = b.addTest(.{
//            .name = "hot-index-test", .root_module = hot_index_test_mod,
//        });
//        const run_hot_index_test = b.addRunArtifact(hot_index_test);
//        const hot_index_test_step = b.step("test-hot-index", "Run the hot authoring-state index unit tests");
//        hot_index_test_step.dependOn(&run_hot_index_test.step);
//        // and fold hot_index_test_step into the aggregate test step.
// ─────────────────────────────────────────────────────────────────────────────

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("../v8_runtime.zig");
const hot_index = @import("hot_index.zig");

const alloc = std.heap.c_allocator;

// ── arg / return helpers (mirroring v8_bindings_editor_bus.zig) ──────────────

fn argToStringAlloc(info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (idx >= info.length()) return null;
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const s = info.getArg(idx).toString(ctx) catch return null;
    const n = s.lenUtf8(iso);
    const buf = alloc.alloc(u8, n) catch return null;
    _ = s.writeUtf8(iso, buf);
    return buf;
}

fn setReturnNumber(info: v8.FunctionCallbackInfo, value: f64) void {
    info.getReturnValue().set(v8.Number.init(info.getIsolate(), value));
}

fn setReturnString(info: v8.FunctionCallbackInfo, text: []const u8) void {
    info.getReturnValue().set(v8.String.initUtf8(info.getIsolate(), text));
}

// ── host doors ───────────────────────────────────────────────────────────────

fn hostSummary(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const json = hot_index.instance().summaryJson(alloc) catch {
        setReturnString(info, "{}");
        return;
    };
    defer alloc.free(json);
    setReturnString(info, json);
}

fn hostSelect(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argToStringAlloc(info, 0) orelse return;
    defer alloc.free(id);
    hot_index.instance().select(id) catch {};
}

fn hostDeselect(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argToStringAlloc(info, 0) orelse return;
    defer alloc.free(id);
    hot_index.instance().deselect(id);
}

fn hostClearSelection(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    _ = info_c;
    hot_index.instance().clearSelection();
}

fn hostSelectedCount(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, @floatFromInt(hot_index.instance().selectedCount()));
}

pub fn registerHotIndex(_: anytype) void {
    // Touch the singleton so it exists before the first bus event folds into it.
    _ = hot_index.instance();
    v8_runtime.registerHostFn("__editor_index_summary", hostSummary);
    v8_runtime.registerHostFn("__editor_index_select", hostSelect);
    v8_runtime.registerHostFn("__editor_index_deselect", hostDeselect);
    v8_runtime.registerHostFn("__editor_index_clear_selection", hostClearSelection);
    v8_runtime.registerHostFn("__editor_index_selected_count", hostSelectedCount);
}
