//! Smoke test for framework/v8_runtime.zig.
//! Builds standalone — no SDL, no framework. Proves the V8 link+init works.

const std = @import("std");
const v8rt = @import("framework/v8_runtime.zig");
const v8 = @import("v8");

comptime {
    _ = @import("framework/v8_bindings_fs.zig");
}

fn hostLog(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    var hs: v8.HandleScope = undefined;
    hs.init(iso);
    defer hs.deinit();
    const ctx = iso.getCurrentContext();
    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(std.heap.c_allocator);
    var i: u32 = 0;
    while (i < info.length()) : (i += 1) {
        const arg = info.getArg(i);
        const s = arg.toString(ctx) catch continue;
        const n = s.lenUtf8(iso);
        const buf = std.heap.c_allocator.alloc(u8, n) catch continue;
        defer std.heap.c_allocator.free(buf);
        _ = s.writeUtf8(iso, buf);
        if (i > 0) out.append(std.heap.c_allocator, ' ') catch {};
        out.appendSlice(std.heap.c_allocator, buf) catch {};
    }
    std.debug.print("[js] {s}\n", .{out.items});
}

pub fn main() !void {
    v8rt.initVM();
    defer v8rt.teardownVM();

    v8rt.registerHostFn("hostLog", hostLog);

    v8rt.evalScript(
        \\hostLog('hello from v8', 1 + 2, 'pi=' + Math.PI);
        \\globalThis.__tick = function(n) { hostLog('tick', n); };
    );

    v8rt.callGlobalInt("__tick", 42);

    // ── GC-binding proof (req_0301 GAP 1) ───────────────────────────────────
    // Allocate hard in JS to force V8 to collect, then read the shim's counters.
    // If the mangled-symbol registration in v8_gc_shim.cpp is alive, the GC
    // prologue/epilogue callbacks fire and the count comes back > 0. A 0 here is
    // the real bug (wrong isolate handle / mangled name / callbacks not invoked).
    _ = v8rt.gcTakeNs();
    _ = v8rt.gcTakeCount();
    v8rt.evalScript(
        \\(function () {
        \\  var sink = [];
        \\  for (var i = 0; i < 2000000; i++) {
        \\    sink.push({ a: i, b: 'x' + i, c: [i, i + 1] });
        \\    if ((i & 8191) === 0) sink.length = 0; // drop refs → garbage to collect
        \\  }
        \\  return sink.length;
        \\})();
    );
    const gc_ns = v8rt.gcTakeNs();
    const gc_count = v8rt.gcTakeCount();
    const gc_type = v8rt.gcLastType();
    std.debug.print("v8_hello GC PROBE: count={d} ns={d} last_type={d} (1=scavenge 2=minor-ms 4=mark-sweep 8=incremental)\n", .{ gc_count, gc_ns, gc_type });
    if (gc_count == 0) {
        std.debug.print("v8_hello GC PROBE: FAIL — callback never fired; the mangled-symbol binding is dead\n", .{});
    } else {
        std.debug.print("v8_hello GC PROBE: PASS — the GC binding is alive and timing real collections\n", .{});
    }

    std.debug.print("v8_hello: ok\n", .{});
}
