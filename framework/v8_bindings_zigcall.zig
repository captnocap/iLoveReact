//! v8_bindings_zigcall.zig — comptime-reflection bridge that exposes pure-Zig
//! modules to cart JS through a single host function:
//!
//!   __zig_call(moduleName: string, fnName: string, ...args): any
//!
//! Adding a module to the whitelist makes every one of its `pub fn` decls
//! callable from JS without hand-written bindings. Arg and return types are
//! converted automatically via @typeInfo at comptime; unsupported signatures
//! are skipped (not a compile error — they just become "unknown fn" at
//! runtime). See runtime/hooks/math.ts for the Proxy-based JS facade.
//!
//! Supported types (arg and return):
//!   - bool, all int widths, f32/f64
//!   - structs of supported fields (Vec2/Vec3/BBox2/BBox3/SmoothDampResult)
//!   - optional T (null maps to null)
//!   - slice of supported T ([]const Vec2, etc. — arrays on the JS side)
//!   - void return
//!
//! Unsupported (skipped): raw pointers, non-slice pointers, function pointers,
//! unions, enums (add as needed), anytype/comptime-only fns.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");

// ── Module whitelist ────────────────────────────────────────────────────
// Each entry is a comptime `.{ "name", @import("path.zig") }` pair. Adding
// a new module here is the full wiring — no boilerplate per function.
const MODULES = .{
    .{ "math",       @import("math/root.zig") },
    .{ "easing",     @import("math/easing.zig") },
    .{ "random",     @import("math/random.zig") },
    .{ "transition", @import("gpu/transition.zig") },
    .{ "sim",        @import("sim/root.zig") },
};

// ── Type support predicate ──────────────────────────────────────────────

fn isSupported(comptime T: type) bool {
    @setEvalBranchQuota(10000);
    return switch (@typeInfo(T)) {
        .bool, .int, .float, .comptime_int, .comptime_float => true,
        .void => true,
        .optional => |o| isSupported(o.child),
        .@"struct" => |s| blk: {
            inline for (s.fields) |f| {
                if (!isSupported(f.type)) break :blk false;
            }
            break :blk true;
        },
        .pointer => |p| p.size == .slice and isSupported(p.child),
        else => false,
    };
}

fn fnIsSupported(comptime FT: type) bool {
    const fi = switch (@typeInfo(FT)) {
        .@"fn" => |f| f,
        else => return false,
    };
    const rt = fi.return_type orelse return false;
    if (!isSupported(rt)) return false;
    inline for (fi.params) |p| {
        const pt = p.type orelse return false;
        if (!isSupported(pt)) return false;
    }
    return true;
}

// ── V8 value ↔ Zig value conversion ─────────────────────────────────────

fn argFromV8(comptime T: type, iso: v8.Isolate, ctx: v8.Context, val: v8.Value) !T {
    return switch (@typeInfo(T)) {
        .bool => val.toBool(iso),
        .int => |i| blk: {
            const f = try val.toF64(ctx);
            break :blk switch (i.signedness) {
                .signed => @intFromFloat(f),
                .unsigned => @intFromFloat(@max(f, 0)),
            };
        },
        .float => @floatCast(try val.toF64(ctx)),
        .void => {},
        .optional => |o| blk: {
            if (val.isNull() or val.isUndefined()) break :blk null;
            break :blk try argFromV8(o.child, iso, ctx, val);
        },
        .@"struct" => |s| blk: {
            const obj = val.castTo(v8.Object);
            var out: T = undefined;
            inline for (s.fields) |f| {
                const key = v8.String.initUtf8(iso, f.name);
                const sub = try obj.getValue(ctx, key);
                @field(out, f.name) = try argFromV8(f.type, iso, ctx, sub);
            }
            break :blk out;
        },
        .pointer => |p| blk: {
            if (p.size != .slice) @compileError("only slice pointers supported: " ++ @typeName(T));
            const arr_obj = val.castTo(v8.Object);
            const len_key = v8.String.initUtf8(iso, "length");
            const len_v = try arr_obj.getValue(ctx, len_key);
            const len_n: usize = @intFromFloat(try len_v.toF64(ctx));
            const buf = try std.heap.c_allocator.alloc(p.child, len_n);
            errdefer std.heap.c_allocator.free(buf);
            var i: u32 = 0;
            while (i < @as(u32, @intCast(len_n))) : (i += 1) {
                const elem = try arr_obj.getAtIndex(ctx, i);
                buf[@intCast(i)] = try argFromV8(p.child, iso, ctx, elem);
            }
            break :blk buf;
        },
        else => @compileError("unsupported arg type: " ++ @typeName(T)),
    };
}

fn argFreeIfAllocated(comptime T: type, val: T) void {
    switch (@typeInfo(T)) {
        .pointer => |p| {
            if (p.size == .slice) std.heap.c_allocator.free(val);
        },
        else => {},
    }
}

fn retToV8(comptime T: type, iso: v8.Isolate, ctx: v8.Context, val: T) v8.Value {
    return switch (@typeInfo(T)) {
        .bool => v8.getValue(v8.Boolean.init(iso, val)),
        .int => v8.getValue(v8.Number.init(iso, @floatFromInt(val))),
        .float => v8.getValue(v8.Number.init(iso, @floatCast(val))),
        .void => v8.getValue(v8.initUndefined(iso)),
        .optional => |o| if (val) |v| retToV8(o.child, iso, ctx, v) else v8.getValue(v8.initNull(iso)),
        .@"struct" => |s| blk: {
            const obj = v8.Object.init(iso);
            inline for (s.fields) |f| {
                const key = v8.String.initUtf8(iso, f.name);
                const sub = retToV8(f.type, iso, ctx, @field(val, f.name));
                _ = obj.setValue(ctx, key, sub);
            }
            break :blk v8.getValue(obj);
        },
        .pointer => |p| blk: {
            if (p.size != .slice) @compileError("only slice returns supported");
            const arr = v8.Array.init(iso, @intCast(val.len));
            const obj = arr.castTo(v8.Object);
            var i: u32 = 0;
            while (i < val.len) : (i += 1) {
                const sub = retToV8(p.child, iso, ctx, val[i]);
                _ = obj.setValueAtIndex(ctx, i, sub);
            }
            break :blk v8.getValue(obj);
        },
        else => @compileError("unsupported return type: " ++ @typeName(T)),
    };
}

// ── Dispatcher ──────────────────────────────────────────────────────────

fn readCstring(iso: v8.Isolate, ctx: v8.Context, val: v8.Value, buf: []u8) ?[]const u8 {
    const s = val.toString(ctx) catch return null;
    const n = s.lenUtf8(iso);
    if (n > buf.len) return null;
    _ = s.writeUtf8(iso, buf[0..n]);
    return buf[0..n];
}

fn callOne(comptime F: anytype, info: v8.FunctionCallbackInfo) void {
    const FT = @TypeOf(F);
    const fi = @typeInfo(FT).@"fn";
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();

    var args: std.meta.ArgsTuple(FT) = undefined;
    // First two info args are (module, fnName); fn params start at index 2.
    const ARG_OFFSET: u32 = 2;

    inline for (fi.params, 0..) |p, i| {
        const PT = p.type.?;
        if (@as(u32, @intCast(i)) + ARG_OFFSET >= info.length()) {
            // Missing argument — bail with null return (caller will see null).
            info.getReturnValue().set(v8.initNull(iso));
            return;
        }
        const av = info.getArg(@as(u32, @intCast(i)) + ARG_OFFSET);
        args[i] = argFromV8(PT, iso, ctx, av) catch {
            info.getReturnValue().set(v8.initNull(iso));
            return;
        };
    }
    defer inline for (fi.params, 0..) |p, i| {
        argFreeIfAllocated(p.type.?, args[i]);
    };

    const result = @call(.auto, F, args);
    const RT = fi.return_type.?;
    const ret = retToV8(RT, iso, ctx, result);
    info.getReturnValue().set(ret);
}

fn dispatchModule(comptime Mod: type, fn_name: []const u8, info: v8.FunctionCallbackInfo) bool {
    @setEvalBranchQuota(200000);
    inline for (@typeInfo(Mod).@"struct".decls) |decl| {
        const val = @field(Mod, decl.name);
        const VT = @TypeOf(val);
        if (comptime @typeInfo(VT) != .@"fn") continue;
        if (comptime !fnIsSupported(VT)) continue;
        if (std.mem.eql(u8, decl.name, fn_name)) {
            callOne(val, info);
            return true;
        }
    }
    return false;
}

fn zigCall(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    if (info.length() < 2) {
        info.getReturnValue().set(v8.initNull(iso));
        return;
    }
    var mod_buf: [64]u8 = undefined;
    var fn_buf: [96]u8 = undefined;
    const mod_name = readCstring(iso, ctx, info.getArg(0), &mod_buf) orelse {
        info.getReturnValue().set(v8.initNull(iso));
        return;
    };
    const fn_name = readCstring(iso, ctx, info.getArg(1), &fn_buf) orelse {
        info.getReturnValue().set(v8.initNull(iso));
        return;
    };

    inline for (MODULES) |entry| {
        const name = entry[0];
        const Mod = entry[1];
        if (std.mem.eql(u8, name, mod_name)) {
            if (dispatchModule(Mod, fn_name, info)) return;
            break;
        }
    }
    info.getReturnValue().set(v8.initNull(iso));
}

// ── Registration ────────────────────────────────────────────────────────

pub fn registerZigCall(_: anytype) void {
    v8_runtime.registerHostFn("__zig_call", zigCall);
}

// ── Introspection helper ────────────────────────────────────────────────
// Exposes the list of callable (module, fn) pairs as a JSON string so the JS
// facade can populate typed surfaces at boot. Mostly useful for dev tools;
// cart code usually just uses the Proxy.

fn listCallable(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    @setEvalBranchQuota(200000);
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    var buf: std.ArrayList(u8) = .empty;
    defer buf.deinit(std.heap.c_allocator);
    buf.append(std.heap.c_allocator, '{') catch return;
    var first_mod = true;
    inline for (MODULES) |entry| {
        const name = entry[0];
        const Mod = entry[1];
        if (!first_mod) buf.append(std.heap.c_allocator, ',') catch return;
        first_mod = false;
        buf.append(std.heap.c_allocator, '"') catch return;
        buf.appendSlice(std.heap.c_allocator, name) catch return;
        buf.appendSlice(std.heap.c_allocator, "\":[") catch return;
        var first_fn = true;
        inline for (@typeInfo(Mod).@"struct".decls) |decl| {
            const val = @field(Mod, decl.name);
            const VT = @TypeOf(val);
            if (comptime @typeInfo(VT) != .@"fn") continue;
            if (comptime !fnIsSupported(VT)) continue;
            if (!first_fn) buf.append(std.heap.c_allocator, ',') catch return;
            first_fn = false;
            buf.append(std.heap.c_allocator, '"') catch return;
            buf.appendSlice(std.heap.c_allocator, decl.name) catch return;
            buf.append(std.heap.c_allocator, '"') catch return;
        }
        buf.append(std.heap.c_allocator, ']') catch return;
    }
    buf.append(std.heap.c_allocator, '}') catch return;

    info.getReturnValue().set(v8.String.initUtf8(iso, buf.items));
}

pub fn registerZigCallList(_: anytype) void {
    v8_runtime.registerHostFn("__zig_call_list", listCallable);
}
