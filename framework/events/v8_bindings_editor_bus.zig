//! V8 bindings for the AUTHORING eventbus (framework/events/editor_bus.zig).
//!
//! Implements the three host doors the runtime/editorbus/bus.ts door calls:
//!   __editor_bus_emit(json)      → seq (number; -1 on reject)
//!   __editor_bus_since(afterSeq) → JSON array string (confirmed events seq > afterSeq)
//!   __editor_bus_head()          → number (highest committed seq, 0 if empty)
//!
//! On emit, the confirmed (seq-stamped) envelope is re-broadcast to JS on the
//! `editor.bus` channel via the host's __ffiEmit — installed below as the core's
//! broadcaster so editor_bus.zig itself stays v8-free (and headless-testable).
//!
// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION — the supervisor must add these to wire this module in.
//
// 1) framework/v8_ingredients.zig — add the import beside the other always-on
//    binding imports (near the `v8_bindings_eventbus` / `v8_bindings_ifttt` lines,
//    ~line 98):
//
//        const v8_bindings_editor_bus = @import("events/v8_bindings_editor_bus.zig");
//
//    and add ONE entry to the INGREDIENTS array, in the always-on (required=true)
//    block (e.g. right after the `eventbus` entry, ~line 310):
//
//        .{ .name = "editor_bus", .required = true, .grep_prefix = "", .reg_fn = "registerEditorBus", .mod = v8_bindings_editor_bus },
//
// 2) build.zig — NO production change needed: like `v8_bindings_eventbus` /
//    `v8_bindings_ifttt`, this binding is pulled into the root module transitively
//    via the @import above (its deps — ../v8_runtime.zig, ../storage/sqlite.zig —
//    are already in the compile graph; libsqlite3 is dlopen'd at runtime, no link
//    dep). registerEditorBus() also calls editor_bus.init(), so no separate boot
//    line in v8_app.zig is required.
//
// 3) build.zig — UNIT TEST step (required only to RUN the test, not to ship):
//
//        const editor_bus_test_mod = b.createModule(.{
//            .root_source_file = b.path("framework/testing/unit/editor_bus.zig"),
//            .target = target,
//            .optimize = optimize,
//            .link_libc = true,
//        });
//        const editor_bus_mod_for_tests = b.createModule(.{
//            .root_source_file = b.path("framework/events/editor_bus.zig"),
//            .target = target,
//            .optimize = optimize,
//            .link_libc = true,
//        });
//        editor_bus_test_mod.addImport("editor_bus", editor_bus_mod_for_tests);
//        const editor_bus_test = b.addTest(.{
//            .name = "editor-bus-test",
//            .root_module = editor_bus_test_mod,
//        });
//        const run_editor_bus_test = b.addRunArtifact(editor_bus_test);
//        const editor_bus_test_step = b.step("test-editor-bus", "Run the authoring eventbus unit tests");
//        editor_bus_test_step.dependOn(&run_editor_bus_test.step);
// ─────────────────────────────────────────────────────────────────────────────

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("../v8_runtime.zig");
const HostContext = @import("../host_context.zig");
const editor_bus = @import("editor_bus.zig");

const alloc = std.heap.c_allocator;

// ── Argument / return helpers (mirroring v8_bindings_eventbus.zig) ──────────

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

fn argToF64(info: v8.FunctionCallbackInfo, idx: u32) ?f64 {
    if (idx >= info.length()) return null;
    return info.getArg(idx).toF64(info.getIsolate().getCurrentContext()) catch null;
}

fn setReturnNumber(info: v8.FunctionCallbackInfo, value: f64) void {
    info.getReturnValue().set(v8.Number.init(info.getIsolate(), value));
}

fn setReturnString(info: v8.FunctionCallbackInfo, text: []const u8) void {
    info.getReturnValue().set(v8.String.initUtf8(info.getIsolate(), text));
}

// ── Confirmed-event broadcaster (core → JS via host __ffiEmit) ──────────────

fn broadcast(context: ?*anyopaque, json: []const u8) void {
    const host: *HostContext = @ptrCast(@alignCast(context orelse return));
    // callGlobal2Str needs nul-terminated strings.
    const z = alloc.dupeZ(u8, json) catch return;
    defer alloc.free(z);
    v8_runtime.callGlobal2Str(host, "__ffiEmit", editor_bus.CHANNEL, z);
}

// ── Host doors ──────────────────────────────────────────────────────────────

fn hostEmit(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const json = argToStringAlloc(info, 0) orelse return setReturnNumber(info, -1);
    defer alloc.free(json);
    const seq = editor_bus.append(json);
    setReturnNumber(info, @floatFromInt(seq));
}

fn hostSince(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const after_f: f64 = argToF64(info, 0) orelse 0;
    const after: i64 = if (after_f < 0) 0 else @intFromFloat(after_f);
    const json = editor_bus.since(alloc, after) catch {
        setReturnString(info, "[]");
        return;
    };
    defer alloc.free(json);
    setReturnString(info, json);
}

fn hostHead(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, @floatFromInt(editor_bus.head()));
}

pub fn registerEditorBus(host: *HostContext) void {
    editor_bus.init();
    editor_bus.setBroadcaster(.{ .context = host, .send = broadcast });
    v8_runtime.registerHostFn("__editor_bus_emit", hostEmit);
    v8_runtime.registerHostFn("__editor_bus_since", hostSince);
    v8_runtime.registerHostFn("__editor_bus_head", hostHead);
}
