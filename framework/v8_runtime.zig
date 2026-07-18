//! V8 Runtime — thin VM-facing wrapper mirroring qjs_runtime's surface.
//!
//! Only the JS VM lifecycle + calls. SDL/paint/telemetry stays in qjs_runtime.zig;
//! the app layer can import both and route JS work through here when -Dvm=v8.
//!
//! Host functions: register a `v8.c.FunctionCallback` (signature
//! `fn(?*const v8.c.FunctionCallbackInfo) callconv(.c) void`). Each callback
//! reads its own args via FunctionCallbackInfo and writes its return via the
//! `getReturnValue()` setter. Very different from qjs's (ctx, this, argc, argv)
//! → JSValue pattern — callers must provide v8-shaped versions.

const std = @import("std");
const HostContext = @import("host_context.zig");
const v8 = @import("v8");

// ── V8 GC timing shim (framework/ffi/v8_gc_shim.cpp) ────────────────────────
// Real GC wall-time measured at V8's prologue/epilogue callbacks — feeds the
// spikewatch's definitive "what fired" line instead of the old GC/native guess.
extern fn rjit_v8_gc_install(iso: *anyopaque) void;
extern fn rjit_v8_gc_take_ns() u64;
extern fn rjit_v8_gc_take_count() c_uint;
extern fn rjit_v8_gc_last_type() c_int;

/// GC NANOSECONDS accumulated since the last call (resets the accumulator).
/// Call once per frame. Nanoseconds so a sub-µs scavenge isn't floored to a
/// misleading "0us". Covers GC wherever it fired in the frame — V8's callbacks
/// fire on this thread synchronously around every pause.
pub fn gcTakeNs() u64 {
    return rjit_v8_gc_take_ns();
}

/// GC invocation count since the last call (resets). The disambiguator for a
/// zero time: "fired N times, tiny" vs "fired 0 times, binding dead."
pub fn gcTakeCount() u32 {
    return @intCast(rjit_v8_gc_take_count());
}

/// GCType bitmask of the most recent GC: 1=scavenge, 2=minor-mark-sweep,
/// 4=mark-sweep-compact, 8=incremental, 16=process-weak-callbacks.
pub fn gcLastType() i32 {
    return @intCast(rjit_v8_gc_last_type());
}

// ── V8 heap statistics (memory breakdown telemetry) ─────────────────────────
pub const JsHeap = struct {
    /// Live (used) bytes in the managed JS object heap.
    used: u64 = 0,
    /// Committed bytes of the managed JS heap — closer to what RSS reflects.
    total: u64 = 0,
    /// ArrayBuffer + registered-external bytes held outside the JS heap.
    external: u64 = 0,
    /// V8's own C++ malloc (zone/parser/compiler memory).
    malloced: u64 = 0,
    /// Peak of `malloced` since isolate start.
    peak_malloced: u64 = 0,
    /// V8's self-imposed heap ceiling.
    limit: u64 = 0,
};

/// V8 isolate heap statistics, or null before the VM is up. All fields are
/// host/RSS memory (the managed heap is anonymous mmap in this process), NOT
/// VRAM — so the breakdown groups these under "JS Runtime" and they DO count
/// against the OS-reported process RSS.
pub fn jsHeap() ?JsHeap {
    const iso = g_isolate orelse return null;
    const s = iso.getHeapStatistics();
    return .{
        .used = @intCast(s.used_heap_size),
        .total = @intCast(s.total_heap_size),
        .external = @intCast(s.external_memory),
        .malloced = @intCast(s.malloced_memory),
        .peak_malloced = @intCast(s.peak_malloced_memory),
        .limit = @intCast(s.heap_size_limit),
    };
}

// ── Bridge (Zig→JS) wall-time accumulator ───────────────────────────────────
// Every host-initiated cross into JS funnels through callGlobalWithArgs (app
// tick __jsTick, event dispatch, etc). We time the call + microtask drain and
// sum it per frame, so the spikewatch can attribute "outside-render" time to the
// bridge instead of guessing. Single-threaded; plain global is fine.
var g_bridge_us_accum: i64 = 0;

/// Bridge microseconds accumulated since the last call (resets). Call once per
/// frame. Covers callGlobal* crossings (Zig→JS), which is where the V8 dev-host
/// spends its per-frame JS time — V8 runs synchronously inside event callbacks,
/// not on a per-frame VM pump (QuickJS needed one; V8 doesn't, which is why the
/// old `tick()` no-op was deleted along with its bogus `tick_us` metric).
pub fn bridgeTakeUs() u64 {
    const v = g_bridge_us_accum;
    g_bridge_us_accum = 0;
    return if (v > 0) @intCast(v) else 0;
}

var g_platform: ?v8.Platform = null;
var g_isolate_params: v8.CreateParams = undefined;
var g_isolate: ?v8.Isolate = null;
// Top-level HandleScope lives for the whole session — keeps g_context valid.
var g_hscope_storage: v8.HandleScope = undefined;
var g_hscope_alive: bool = false;
var g_context: ?v8.Context = null;

const host_context_slot = 0;

/// Recover the process capabilities installed by the application root. V8's
/// C callback ABI cannot carry Zig parameters, so the isolate embedder slot is
/// the explicit callback boundary; ordinary Zig functions still receive the
/// context in their signatures.
pub fn hostContext(isolate: v8.Isolate) *HostContext {
    const raw = isolate.getData(host_context_slot) orelse
        @panic("V8 isolate has no HostContext");
    return @ptrCast(@alignCast(raw));
}

pub fn initVM(host: *HostContext) void {
    if (g_isolate != null) return;

    const platform = v8.Platform.initDefault(0, true);
    g_platform = platform;
    v8.initV8Platform(platform);
    v8.initV8();

    g_isolate_params = v8.initCreateParams();
    g_isolate_params.array_buffer_allocator = v8.createDefaultArrayBufferAllocator();

    var isolate = v8.Isolate.init(&g_isolate_params);
    isolate.enter();
    isolate.setData(host_context_slot, host);
    // ── V8 stack budget ────────────────────────────────────────────────
    // Without this call V8 falls back to a tiny default budget (~700KB)
    // measured downward from whatever the C++ SP happens to be at isolate
    // creation. Our binding surface (every INGREDIENTS row's register fn,
    // each opening a HandleScope; comptime-unrolled inline-for in
    // v8_app.appInit; static init for claude/kimi/local_ai/net_http
    // imports) puts SP deep enough at this point that 700KB doesn't
    // survive the 1MB+ bundle parse + React first render. V8 throws
    // StackOverflow, and inside the throw path V8 14 (and newer) trips an
    // IsOnCentralStack invariant. The visible failure looks like:
    //
    //   # Fatal error in , line 0
    //   # Check failed: IsOnCentralStack().
    //
    // …which sent prior debugging in circles — bisecting INGREDIENTS to
    // "it's the websockets binding," then to "it's the sdk binding,"
    // when in reality any binding crosses the threshold. The fix is here,
    // not in any binding's tickDrain. addr2line on the crashing IP lands
    // in v8::internal::Isolate::StackOverflow → the throw-path central-
    // stack check, not in promise/callback machinery.
    //
    // We allocate 64MB of OS stack (build.zig: exe.stack_size). 16MB to
    // V8 is comfortable and still leaves headroom for native callbacks
    // and the engine main loop's own frames.
    //
    // libc_v8.a doesn't ship the SetStackLimit binding; framework/ffi/
    // v8_stack_shim.cpp provides a shim that calls V8's mangled symbol.
    const sp_marker: u8 = 0;
    const sp_addr = @intFromPtr(&sp_marker);
    const STACK_BUDGET: usize = 16 * 1024 * 1024;
    isolate.setStackLimit(sp_addr - STACK_BUDGET);

    // Install the GC prologue/epilogue timers once per process. The isolate
    // persists across hot-reload (only the Context is rebuilt), so this never
    // double-registers. Gives the spikewatch real GC wall-time + type.
    rjit_v8_gc_install(@ptrCast(isolate.handle));

    g_hscope_storage.init(isolate);
    g_hscope_alive = true;

    const context = v8.Context.init(isolate, null, null);
    context.enter();

    g_isolate = isolate;
    g_context = context;
}

pub const deinit = teardownVM;
// (Removed `pub fn tick() void {}` 2026-06-25 — a vestigial QuickJS-era frame
// pump. V8 has no per-frame VM tick; its work runs synchronously inside event
// callbacks. The engine no longer calls it.)

/// Dev-mode hot reload. V8's platform lifecycle is ONE-SHOT per process —
/// `DisposePlatform` is terminal and `InitializePlatform` cannot be called a
/// second time. So on hot reload we tear down only the Context + top-level
/// HandleScope and build a fresh Context inside the same Isolate. Host-fn
/// bindings are installed on the global template per Context, so the caller
/// must re-run its `registerHostFn(...)` sequence after this returns (v8_app's
/// appInit() already does this).
pub fn resetContextForReload(host: *HostContext) void {
    if (g_isolate == null) {
        // Nothing running yet — fall back to a full init.
        initVM(host);
        return;
    }
    if (g_context) |ctx| {
        ctx.exit();
        g_context = null;
    }
    if (g_hscope_alive) {
        g_hscope_storage.deinit();
        g_hscope_alive = false;
    }
    const iso = g_isolate.?;
    g_hscope_storage.init(iso);
    g_hscope_alive = true;
    const context = v8.Context.init(iso, null, null);
    context.enter();
    g_context = context;

    // Slot-keyed framework state must be cleared so the new cart's
    // TextInputs don't pick up leftover buffers from slot ids that the
    // previous cart happened to mount in the same order. hotstate is
    // explicitly preserved (that's the whole point of useHotState
    // hydration after reload).
    @import("primitive/input.zig").clearAll();
}

pub fn teardownVM() void {
    if (g_context) |ctx| {
        ctx.exit();
        g_context = null;
    }
    if (g_hscope_alive) {
        g_hscope_storage.deinit();
        g_hscope_alive = false;
    }
    if (g_isolate) |*iso| {
        iso.exit();
        iso.deinit();
        g_isolate = null;
    }
    if (g_isolate_params.array_buffer_allocator) |abi| {
        v8.destroyArrayBufferAllocator(abi);
    }
    _ = v8.deinitV8();
    if (g_platform) |plat| {
        v8.deinitV8Platform();
        plat.deinit();
        g_platform = null;
    }
}

pub fn registerHostFn(name: [*:0]const u8, callback: v8.c.FunctionCallback) void {
    const iso = g_isolate orelse return;
    const ctx = g_context orelse return;

    var hscope: v8.HandleScope = undefined;
    hscope.init(iso);
    defer hscope.deinit();

    const tmpl = v8.FunctionTemplate.initCallback(iso, callback);
    const func = tmpl.getFunction(ctx);
    const global = ctx.getGlobal();
    const key = v8.String.initUtf8(iso, std.mem.span(name));
    _ = global.setValue(ctx, key, func);
}

pub fn evalScript(host: *HostContext, js_logic: []const u8) void {
    _ = evalScriptChecked(host, js_logic);
}

/// Like evalScript, but returns true iff compile+run both succeeded with no
/// uncaught JS exception. Used by the dev host to detect a bad hot-reload and
/// roll back to the last good bundle.
pub fn evalScriptChecked(host: *HostContext, js_logic: []const u8) bool {
    const iso = g_isolate orelse {
        std.log.err("[v8 evalScriptChecked] g_isolate is null — VM not initialized or torn down", .{});
        return false;
    };
    const ctx = g_context orelse {
        std.log.err("[v8 evalScriptChecked] g_context is null — context not restored after resetContextForReload", .{});
        return false;
    };

    var hscope: v8.HandleScope = undefined;
    hscope.init(iso);
    defer hscope.deinit();

    var try_catch: v8.TryCatch = undefined;
    try_catch.init(iso);
    defer try_catch.deinit();

    const src = v8.String.initUtf8(iso, js_logic);
    const script = v8.Script.compile(ctx, src, null) catch {
        logException(host, iso, ctx, try_catch, "compile");
        return false;
    };
    _ = script.run(ctx) catch {
        logException(host, iso, ctx, try_catch, "run");
        return false;
    };
    return true;
}

pub fn evalExpr(host: *HostContext, code: []const u8) void {
    if (code.len == 0) return;
    evalScript(host, code);
}

pub fn evalToString(code: []const u8, buf: []u8) []const u8 {
    const iso = g_isolate orelse return buf[0..0];
    const ctx = g_context orelse return buf[0..0];

    var hscope: v8.HandleScope = undefined;
    hscope.init(iso);
    defer hscope.deinit();

    const src = v8.String.initUtf8(iso, code);
    const script = v8.Script.compile(ctx, src, null) catch return buf[0..0];
    const result = script.run(ctx) catch return buf[0..0];
    const str = result.toString(ctx) catch return buf[0..0];
    const need = str.lenUtf8(iso);
    const n = @min(need, buf.len);
    _ = str.writeUtf8(iso, buf[0..n]);
    return buf[0..n];
}

pub fn hasGlobal(name: [*:0]const u8) bool {
    const iso = g_isolate orelse return false;
    const ctx = g_context orelse return false;

    var hscope: v8.HandleScope = undefined;
    hscope.init(iso);
    defer hscope.deinit();

    const global = ctx.getGlobal();
    const key = v8.String.initUtf8(iso, std.mem.span(name));
    const val = global.getValue(ctx, key) catch return false;
    return !val.isUndefined();
}

fn callGlobalWithArgs(host: *HostContext, name: [*:0]const u8, argv: []const v8.Value) void {
    const iso = g_isolate orelse return;
    const ctx = g_context orelse return;

    var try_catch: v8.TryCatch = undefined;
    try_catch.init(iso);
    defer try_catch.deinit();

    const global = ctx.getGlobal();
    const key = v8.String.initUtf8(iso, std.mem.span(name));
    const val = global.getValue(ctx, key) catch return;
    if (val.isUndefined() or !val.isFunction()) return;
    const func = val.castTo(v8.Function);
    // Time the whole cross-into-JS (call + microtask drain) so the spikewatch
    // can attribute frame time to the bridge with a measured number.
    const bridge_t0 = std.Io.Clock.Timestamp.now(host.io, .awake);
    const ret = func.call(ctx, global.toValue(), argv);
    if (ret == null) {
        g_bridge_us_accum += @max(0, bridge_t0.untilNow(host.io).raw.toMicroseconds());
        logException(host, iso, ctx, try_catch, std.mem.span(name));
        return;
    }
    // Explicit microtask drain (kExplicit policy set in initVM). Promises
    // resolved during the call (fetch, async hooks) get their .then()
    // continuations to run here on our central stack, dodging V8 14's auto-
    // drain IsOnCentralStack check.
    iso.performMicrotasksCheckpoint();
    g_bridge_us_accum += @max(0, bridge_t0.untilNow(host.io).raw.toMicroseconds());
}

pub fn callGlobal(host: *HostContext, name: [*:0]const u8) void {
    const iso = g_isolate orelse return;
    var hscope: v8.HandleScope = undefined;
    hscope.init(iso);
    defer hscope.deinit();
    callGlobalWithArgs(host, name, &.{});
}

pub fn callGlobalStr(host: *HostContext, name: [*:0]const u8, arg: [*:0]const u8) void {
    const iso = g_isolate orelse return;
    var hscope: v8.HandleScope = undefined;
    hscope.init(iso);
    defer hscope.deinit();
    const s = v8.String.initUtf8(iso, std.mem.span(arg));
    callGlobalWithArgs(host, name, &.{s.toValue()});
}

pub fn callGlobal2Str(host: *HostContext, name: [*:0]const u8, a: [*:0]const u8, b: [*:0]const u8) void {
    const iso = g_isolate orelse return;
    var hscope: v8.HandleScope = undefined;
    hscope.init(iso);
    defer hscope.deinit();
    callGlobalWithArgs(host, name, &.{
        v8.String.initUtf8(iso, std.mem.span(a)).toValue(),
        v8.String.initUtf8(iso, std.mem.span(b)).toValue(),
    });
}

pub fn callGlobalInt(host: *HostContext, name: [*:0]const u8, arg: i64) void {
    const iso = g_isolate orelse return;
    var hscope: v8.HandleScope = undefined;
    hscope.init(iso);
    defer hscope.deinit();
    const n = v8.Number.init(iso, @floatFromInt(arg));
    callGlobalWithArgs(host, name, &.{n.toValue()});
}

pub fn callGlobal2Int(host: *HostContext, name: [*:0]const u8, a: i64, b: i64) void {
    const iso = g_isolate orelse return;
    var hscope: v8.HandleScope = undefined;
    hscope.init(iso);
    defer hscope.deinit();
    callGlobalWithArgs(host, name, &.{
        v8.Number.init(iso, @floatFromInt(a)).toValue(),
        v8.Number.init(iso, @floatFromInt(b)).toValue(),
    });
}

pub fn callGlobalFloat(host: *HostContext, name: [*:0]const u8, arg: f32) void {
    const iso = g_isolate orelse return;
    var hscope: v8.HandleScope = undefined;
    hscope.init(iso);
    defer hscope.deinit();
    const n = v8.Number.init(iso, @floatCast(arg));
    callGlobalWithArgs(host, name, &.{n.toValue()});
}

pub fn callGlobal2Float(host: *HostContext, name: [*:0]const u8, a: f32, b: f32) void {
    const iso = g_isolate orelse return;
    var hscope: v8.HandleScope = undefined;
    hscope.init(iso);
    defer hscope.deinit();
    callGlobalWithArgs(host, name, &.{
        v8.Number.init(iso, @floatCast(a)).toValue(),
        v8.Number.init(iso, @floatCast(b)).toValue(),
    });
}

pub fn callGlobal3Int(host: *HostContext, name: [*:0]const u8, a: i64, b: i64, c: i64) void {
    const iso = g_isolate orelse return;
    var hscope: v8.HandleScope = undefined;
    hscope.init(iso);
    defer hscope.deinit();
    callGlobalWithArgs(host, name, &.{
        v8.Number.init(iso, @floatFromInt(a)).toValue(),
        v8.Number.init(iso, @floatFromInt(b)).toValue(),
        v8.Number.init(iso, @floatFromInt(c)).toValue(),
    });
}

pub fn callGlobal5Int(host: *HostContext, name: [*:0]const u8, a: i64, b: i64, c: i64, d: i64, e: i64) void {
    const iso = g_isolate orelse return;
    var hscope: v8.HandleScope = undefined;
    hscope.init(iso);
    defer hscope.deinit();
    callGlobalWithArgs(host, name, &.{
        v8.Number.init(iso, @floatFromInt(a)).toValue(),
        v8.Number.init(iso, @floatFromInt(b)).toValue(),
        v8.Number.init(iso, @floatFromInt(c)).toValue(),
        v8.Number.init(iso, @floatFromInt(d)).toValue(),
        v8.Number.init(iso, @floatFromInt(e)).toValue(),
    });
}

fn noopBackingStoreDeleter(_: ?*anyopaque, _: usize, _: ?*anyopaque) callconv(.c) void {}

/// Dispatch a per-frame Effect render into JS. Mirrors qjs_runtime.dispatchEffectRender:
/// wraps `ctx.buf` as an ArrayBuffer via a no-op deleter (Zig still owns the
/// memory — the effect Instance allocates/frees via page_alloc) and calls the
/// `__dispatchEffectRender(id, buffer, w, h, stride, time, dt, mx, my, inside,
/// frame)` global registered by runtime/index.tsx.
///
/// The BackingStore is held via a SharedPtr that drops at scope exit — if the
/// JS handler retains a typed-array reference past the call, V8 keeps the
/// SharedPtr alive and the pointer remains valid until Instance.deinit() frees
/// the CPU pixel buffer. That matches the QJS path (which used an explicit
/// detach) in practice: instances are swept after STALE_INSTANCE_GRACE frames,
/// so JS holding a stale ref reads live pixels, not freed memory.
pub fn dispatchEffectRender(
    host: *HostContext,
    id: u32,
    buf_ptr: [*]u8,
    buf_len: usize,
    width: u32,
    height: u32,
    stride: u32,
    time: f32,
    dt: f32,
    mouse_x: f32,
    mouse_y: f32,
    mouse_inside: bool,
    frame: u32,
) void {
    const iso = g_isolate orelse return;
    const ctx = g_context orelse return;

    var hscope: v8.HandleScope = undefined;
    hscope.init(iso);
    defer hscope.deinit();

    var try_catch: v8.TryCatch = undefined;
    try_catch.init(iso);
    defer try_catch.deinit();

    const bs_raw = v8.c.v8__ArrayBuffer__NewBackingStore2(
        @ptrCast(buf_ptr),
        buf_len,
        noopBackingStoreDeleter,
        null,
    ) orelse return;
    var shared = v8.c.v8__BackingStore__TO_SHARED_PTR(bs_raw);
    defer v8.BackingStore.sharedPtrReset(&shared);
    const ab = v8.ArrayBuffer.initWithBackingStore(iso, &shared);
    const ab_val = v8.Value{ .handle = ab.handle };

    const global = ctx.getGlobal();
    const key = v8.String.initUtf8(iso, "__dispatchEffectRender");
    const val = global.getValue(ctx, key) catch return;
    if (val.isUndefined() or !val.isFunction()) return;
    const func = val.castTo(v8.Function);

    const inside_bool = if (mouse_inside) iso.initTrue() else iso.initFalse();
    const inside_val = v8.Value{ .handle = @ptrCast(inside_bool.handle) };

    const args = [_]v8.Value{
        v8.Integer.initU32(iso, id).toValue(),
        ab_val,
        v8.Integer.initU32(iso, width).toValue(),
        v8.Integer.initU32(iso, height).toValue(),
        v8.Integer.initU32(iso, stride).toValue(),
        v8.Number.init(iso, @as(f64, @floatCast(time))).toValue(),
        v8.Number.init(iso, @as(f64, @floatCast(dt))).toValue(),
        v8.Number.init(iso, @as(f64, @floatCast(mouse_x))).toValue(),
        v8.Number.init(iso, @as(f64, @floatCast(mouse_y))).toValue(),
        inside_val,
        v8.Integer.initU32(iso, frame).toValue(),
    };
    _ = func.call(ctx, global.toValue(), &args) orelse {
        logException(host, iso, ctx, try_catch, "__dispatchEffectRender");
        return;
    };
}

fn appendV8ErrorLog(host: *HostContext, tag: []const u8, message: []const u8) void {
    const io = host.io;
    const home = host.environ.get("HOME") orelse return;
    var path_buf: [std.fs.max_path_bytes]u8 = undefined;
    const dir_path = std.fmt.bufPrint(&path_buf, "{s}/.cache/reactjit", .{home}) catch return;
    std.Io.Dir.cwd().createDirPath(io, dir_path) catch {};
    const file_path = std.fmt.bufPrint(&path_buf, "{s}/.cache/reactjit/v8-errors.jsonl", .{home}) catch return;
    const file = std.Io.Dir.cwd().openFile(io, file_path, .{ .mode = .write_only }) catch |e| blk: {
        if (e == error.FileNotFound) {
            break :blk std.Io.Dir.cwd().createFile(io, file_path, .{}) catch return;
        } else return;
    };
    defer file.close(io);
    // Compose the whole JSONL line, then one positional write at EOF (0.16 has
    // no seekFromEnd on File; append = stat size + positional write).
    var allocating = std.Io.Writer.Allocating.init(host.gpa);
    defer allocating.deinit();
    const w = &allocating.writer;
    const ts = std.Io.Clock.now(.real, io).toMilliseconds();
    w.print("{{\"ts\":{d},\"tag\":\"{s}\",\"msg\":\"", .{ ts, tag }) catch return;
    for (message) |ch| {
        switch (ch) {
            '\\' => w.writeAll("\\\\") catch return,
            '"' => w.writeAll("\\\"") catch return,
            '\n' => w.writeAll("\\n") catch return,
            '\r' => w.writeAll("\\r") catch return,
            '\t' => w.writeAll("\\t") catch return,
            0x00...0x08, 0x0b, 0x0c, 0x0e...0x1f => w.print("\\u{x:0>4}", .{ch}) catch return,
            else => w.writeByte(ch) catch return,
        }
    }
    w.writeAll("\"}}\n") catch return;
    const end = (file.stat(io) catch return).size;
    file.writePositionalAll(io, allocating.written(), end) catch return;
}

fn logException(host: *HostContext, iso: v8.Isolate, ctx: v8.Context, try_catch: v8.TryCatch, tag: []const u8) void {
    std.log.err("[v8 {s}] failure detected (hasCaught={})", .{ tag, try_catch.hasCaught() });

    const ex_opt = try_catch.getException();
    if (ex_opt == null) {
        std.log.err("[v8 {s}] no exception object exposed by V8", .{tag});
    }

    // Run toString inside a nested TryCatch so a stack-overflow re-throw doesn't
    // make us look like we have nothing to say.
    if (ex_opt) |ex| {
        var inner_tc: v8.TryCatch = undefined;
        inner_tc.init(iso);
        defer inner_tc.deinit();
        if (ex.toString(ctx)) |str| {
            var buf: [2048]u8 = undefined;
            const n = @min(str.lenUtf8(iso), buf.len);
            _ = str.writeUtf8(iso, buf[0..n]);
            std.log.err("[v8 {s}] {s}", .{ tag, buf[0..n] });
            appendV8ErrorLog(host, tag, buf[0..n]);
        } else |err| {
            std.log.err("[v8 {s}] exception toString() failed: {s} — falling back to type tags", .{ tag, @errorName(err) });
            std.log.err("[v8 {s}] ex isObject={} isString={} isNumber={} isNull={} isUndefined={}", .{
                tag, ex.isObject(), ex.isString(), ex.isNumber(), ex.isNull(), ex.isUndefined(),
            });
        }
    }

    if (try_catch.getMessage()) |msg| {
        if (msg.getSourceLine(ctx)) |line_str| {
            var lbuf: [512]u8 = undefined;
            const n = @min(line_str.lenUtf8(iso), lbuf.len);
            _ = line_str.writeUtf8(iso, lbuf[0..n]);
            std.log.err("[v8 {s} source-line] {s}", .{ tag, lbuf[0..n] });
        }
        const ln: i64 = if (msg.getLineNumber(ctx)) |v| @intCast(v) else -1;
        const col: i64 = if (msg.getStartColumn()) |v| @intCast(v) else -1;
        std.log.err("[v8 {s} location] line={d} col={d}", .{ tag, ln, col });
    } else {
        std.log.err("[v8 {s}] no Message object available", .{tag});
    }

    // Frame-by-frame stack trace. Prefer the StackTrace captured on the
    // exception itself (full async stack) over the TryCatch's, then fall back.
    var st_opt: ?v8.StackTrace = null;
    if (ex_opt) |ex| st_opt = v8.Exception.getStackTrace(ex);
    if (st_opt == null) {
        if (try_catch.getStackTrace(ctx)) |sv| {
            // sv is a Value (string-rendered). Print it as a fallback.
            var inner_tc: v8.TryCatch = undefined;
            inner_tc.init(iso);
            defer inner_tc.deinit();
            if (sv.toString(ctx)) |s| {
                var sbuf: [8192]u8 = undefined;
                const n = @min(s.lenUtf8(iso), sbuf.len);
                _ = s.writeUtf8(iso, sbuf[0..n]);
                std.log.err("[v8 {s} stack-string] {s}", .{ tag, sbuf[0..n] });
            } else |_| {}
        }
    }

    if (st_opt) |st| {
        const fc = st.getFrameCount();
        std.log.err("[v8 {s} frames] count={d}", .{ tag, fc });
        var i: u32 = 0;
        while (i < fc and i < 24) : (i += 1) {
            const frame = st.getFrame(iso, i);
            var name_buf: [256]u8 = undefined;
            var name_slice: []const u8 = "<anon>";
            if (frame.getFunctionName()) |fname| {
                const n = @min(fname.lenUtf8(iso), name_buf.len);
                _ = fname.writeUtf8(iso, name_buf[0..n]);
                name_slice = name_buf[0..n];
            }
            var script_buf: [256]u8 = undefined;
            var script_slice: []const u8 = "<no-script>";
            if (frame.getScriptName()) |sname| {
                const n = @min(sname.lenUtf8(iso), script_buf.len);
                _ = sname.writeUtf8(iso, script_buf[0..n]);
                script_slice = script_buf[0..n];
            }
            std.log.err("[v8 {s} frame {d}] {s} at {s}:{d}:{d}", .{
                tag, i, name_slice, script_slice, frame.getLineNumber(), frame.getColumn(),
            });
        }
    } else {
        std.log.err("[v8 {s}] no StackTrace object on exception", .{tag});
    }
}
