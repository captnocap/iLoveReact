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
const v8 = @import("v8");

var g_platform: ?v8.Platform = null;
var g_isolate_params: v8.CreateParams = undefined;
var g_isolate: ?v8.Isolate = null;
// Top-level HandleScope lives for the whole session — keeps g_context valid.
var g_hscope_storage: v8.HandleScope = undefined;
var g_hscope_alive: bool = false;
var g_context: ?v8.Context = null;

pub fn initVM() void {
    if (g_isolate != null) return;

    const platform = v8.Platform.initDefault(0, true);
    g_platform = platform;
    v8.initV8Platform(platform);
    v8.initV8();

    g_isolate_params = v8.initCreateParams();
    g_isolate_params.array_buffer_allocator = v8.createDefaultArrayBufferAllocator();

    var isolate = v8.Isolate.init(&g_isolate_params);
    isolate.enter();
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

    g_hscope_storage.init(isolate);
    g_hscope_alive = true;

    const context = v8.Context.init(isolate, null, null);
    context.enter();

    g_isolate = isolate;
    g_context = context;
}

pub const deinit = teardownVM;
pub fn tick() void {}

/// Dev-mode hot reload. V8's platform lifecycle is ONE-SHOT per process —
/// `DisposePlatform` is terminal and `InitializePlatform` cannot be called a
/// second time. So on hot reload we tear down only the Context + top-level
/// HandleScope and build a fresh Context inside the same Isolate. Host-fn
/// bindings are installed on the global template per Context, so the caller
/// must re-run its `registerHostFn(...)` sequence after this returns (v8_app's
/// appInit() already does this).
pub fn resetContextForReload() void {
    if (g_isolate == null) {
        // Nothing running yet — fall back to a full init.
        initVM();
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

pub fn evalScript(js_logic: []const u8) void {
    _ = evalScriptChecked(js_logic);
}

/// Like evalScript, but returns true iff compile+run both succeeded with no
/// uncaught JS exception. Used by the dev host to detect a bad hot-reload and
/// roll back to the last good bundle.
pub fn evalScriptChecked(js_logic: []const u8) bool {
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
        logException(iso, ctx, try_catch, "compile");
        return false;
    };
    _ = script.run(ctx) catch {
        logException(iso, ctx, try_catch, "run");
        return false;
    };
    return true;
}

pub fn evalExpr(code: []const u8) void {
    if (code.len == 0) return;
    evalScript(code);
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

fn callGlobalWithArgs(name: [*:0]const u8, argv: []const v8.Value) void {
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
    _ = func.call(ctx, global.toValue(), argv) orelse {
        logException(iso, ctx, try_catch, std.mem.span(name));
        return;
    };
    // Explicit microtask drain (kExplicit policy set in initVM). Promises
    // resolved during the call (fetch, async hooks) get their .then()
    // continuations to run here on our central stack, dodging V8 14's auto-
    // drain IsOnCentralStack check.
    iso.performMicrotasksCheckpoint();
}

pub fn callGlobal(name: [*:0]const u8) void {
    const iso = g_isolate orelse return;
    var hscope: v8.HandleScope = undefined;
    hscope.init(iso);
    defer hscope.deinit();
    callGlobalWithArgs(name, &.{});
}

pub fn callGlobalStr(name: [*:0]const u8, arg: [*:0]const u8) void {
    const iso = g_isolate orelse return;
    var hscope: v8.HandleScope = undefined;
    hscope.init(iso);
    defer hscope.deinit();
    const s = v8.String.initUtf8(iso, std.mem.span(arg));
    callGlobalWithArgs(name, &.{s.toValue()});
}

pub fn callGlobal2Str(name: [*:0]const u8, a: [*:0]const u8, b: [*:0]const u8) void {
    const iso = g_isolate orelse return;
    var hscope: v8.HandleScope = undefined;
    hscope.init(iso);
    defer hscope.deinit();
    callGlobalWithArgs(name, &.{
        v8.String.initUtf8(iso, std.mem.span(a)).toValue(),
        v8.String.initUtf8(iso, std.mem.span(b)).toValue(),
    });
}

pub fn callGlobalInt(name: [*:0]const u8, arg: i64) void {
    const iso = g_isolate orelse return;
    var hscope: v8.HandleScope = undefined;
    hscope.init(iso);
    defer hscope.deinit();
    const n = v8.Number.init(iso, @floatFromInt(arg));
    callGlobalWithArgs(name, &.{n.toValue()});
}

pub fn callGlobal2Int(name: [*:0]const u8, a: i64, b: i64) void {
    const iso = g_isolate orelse return;
    var hscope: v8.HandleScope = undefined;
    hscope.init(iso);
    defer hscope.deinit();
    callGlobalWithArgs(name, &.{
        v8.Number.init(iso, @floatFromInt(a)).toValue(),
        v8.Number.init(iso, @floatFromInt(b)).toValue(),
    });
}

pub fn callGlobalFloat(name: [*:0]const u8, arg: f32) void {
    const iso = g_isolate orelse return;
    var hscope: v8.HandleScope = undefined;
    hscope.init(iso);
    defer hscope.deinit();
    const n = v8.Number.init(iso, @floatCast(arg));
    callGlobalWithArgs(name, &.{n.toValue()});
}

pub fn callGlobal2Float(name: [*:0]const u8, a: f32, b: f32) void {
    const iso = g_isolate orelse return;
    var hscope: v8.HandleScope = undefined;
    hscope.init(iso);
    defer hscope.deinit();
    callGlobalWithArgs(name, &.{
        v8.Number.init(iso, @floatCast(a)).toValue(),
        v8.Number.init(iso, @floatCast(b)).toValue(),
    });
}

pub fn callGlobal3Int(name: [*:0]const u8, a: i64, b: i64, c: i64) void {
    const iso = g_isolate orelse return;
    var hscope: v8.HandleScope = undefined;
    hscope.init(iso);
    defer hscope.deinit();
    callGlobalWithArgs(name, &.{
        v8.Number.init(iso, @floatFromInt(a)).toValue(),
        v8.Number.init(iso, @floatFromInt(b)).toValue(),
        v8.Number.init(iso, @floatFromInt(c)).toValue(),
    });
}

pub fn callGlobal5Int(name: [*:0]const u8, a: i64, b: i64, c: i64, d: i64, e: i64) void {
    const iso = g_isolate orelse return;
    var hscope: v8.HandleScope = undefined;
    hscope.init(iso);
    defer hscope.deinit();
    callGlobalWithArgs(name, &.{
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
        logException(iso, ctx, try_catch, "__dispatchEffectRender");
        return;
    };
}

fn appendV8ErrorLog(tag: []const u8, message: []const u8) void {
    const home = std.process.getEnvVarOwned(std.heap.c_allocator, "HOME") catch return;
    defer std.heap.c_allocator.free(home);
    var path_buf: [std.fs.max_path_bytes]u8 = undefined;
    const dir_path = std.fmt.bufPrint(&path_buf, "{s}/.cache/reactjit", .{home}) catch return;
    std.fs.cwd().makePath(dir_path) catch {};
    const file_path = std.fmt.bufPrint(&path_buf, "{s}/.cache/reactjit/v8-errors.jsonl", .{home}) catch return;
    var file = std.fs.cwd().openFile(file_path, .{ .mode = .write_only }) catch |e| blk: {
        if (e == error.FileNotFound) {
            break :blk std.fs.cwd().createFile(file_path, .{}) catch return;
        } else return;
    };
    defer file.close();
    file.seekFromEnd(0) catch return;
    var json_buf: [2048]u8 = undefined;
    const ts = std.time.milliTimestamp();
    const json = std.fmt.bufPrint(&json_buf, "{{\"ts\":{d},\"tag\":\"{s}\",\"msg\":\"", .{ ts, tag }) catch return;
    file.writeAll(json) catch return;
    // Escape the message for JSON
    for (message) |ch| {
        switch (ch) {
            '\\' => file.writeAll("\\\\") catch return,
            '"' => file.writeAll("\\\"") catch return,
            '\n' => file.writeAll("\\n") catch return,
            '\r' => file.writeAll("\\r") catch return,
            '\t' => file.writeAll("\\t") catch return,
            0x00...0x08, 0x0b, 0x0c, 0x0e...0x1f => {
                var hex_buf: [6]u8 = undefined;
                const hex = std.fmt.bufPrint(&hex_buf, "\\u{x:0>4}", .{ch}) catch return;
                file.writeAll(hex) catch return;
            },
            else => file.writeAll(&[_]u8{ch}) catch return,
        }
    }
    file.writeAll("\"}}\n") catch return;
}

fn logException(iso: v8.Isolate, ctx: v8.Context, try_catch: v8.TryCatch, tag: []const u8) void {
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
            appendV8ErrorLog(tag, buf[0..n]);
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
