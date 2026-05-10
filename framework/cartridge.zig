//! Cartridge manager — loads, tracks, ticks, and hot-reloads multiple .tsz app .so files.
//!
//! Each cartridge is a dynamically loaded shared library exporting the standard
//! tsz app ABI: app_get_root, app_get_init, app_get_tick, app_get_title, plus
//! state preservation exports (app_state_count, app_state_get_int, etc.).

const std = @import("std");
const log = @import("diag/log.zig");
const layout = @import("layout.zig");
const Node = layout.Node;

// ── Crash isolation — catch SIGSEGV/SIGBUS from hostile cartridges ──
//
// Uses sigsetjmp/siglongjmp to recover from crashes inside .so code.
// When a cartridge segfaults, the signal handler jumps back to the
// recovery point, and the cartridge is marked as faulted (skipped).

const c = @cImport({
    @cInclude("setjmp.h");
    @cInclude("signal.h");
});

var g_recovery_jmpbuf: c.sigjmp_buf = undefined;
var g_in_cartridge_call: bool = false;
var g_fault_caught: bool = false;

/// SIGSEGV/SIGBUS handler — longjmp back to the recovery point
fn crashHandler(_: c_int) callconv(.c) void {
    if (g_in_cartridge_call) {
        g_fault_caught = true;
        c.siglongjmp(&g_recovery_jmpbuf, 1);
    }
    // If not in a cartridge call, this is a real crash — let it die
    _ = c.raise(c.SIGABRT);
}

var g_handlers_installed: bool = false;

fn installCrashHandlers() void {
    if (g_handlers_installed) return;
    // Use C sigaction directly — portable across glibc and musl
    var sa: c.struct_sigaction = std.mem.zeroes(c.struct_sigaction);
    if (@hasField(c.struct_sigaction, "__sigaction_handler")) {
        sa.__sigaction_handler = .{ .sa_handler = crashHandler }; // glibc
    } else if (@hasField(c.struct_sigaction, "__sigaction_u")) {
        sa.__sigaction_u = .{ .__sa_handler = crashHandler }; // macOS
    } else {
        sa.__sa_handler = .{ .sa_handler = crashHandler }; // musl
    }
    sa.sa_flags = c.SA_NODEFER;
    _ = c.sigaction(c.SIGSEGV, &sa, null);
    _ = c.sigaction(c.SIGBUS, &sa, null);
    g_handlers_installed = true;
}

/// Call a function inside crash isolation. Returns true if it completed,
/// false if it crashed.
fn safeCall(func: anytype, args: anytype) bool {
    installCrashHandlers();
    g_in_cartridge_call = true;
    g_fault_caught = false;

    if (c.sigsetjmp(&g_recovery_jmpbuf, 1) != 0) {
        // We got here via longjmp from the crash handler
        g_in_cartridge_call = false;
        return false;
    }

    @call(.auto, func, args);

    g_in_cartridge_call = false;
    return true;
}

// ── Exported function pointer types (C ABI from generated app .so) ──

const GetRootFn = *const fn () callconv(.c) *Node;
const GetInitFn = *const fn () callconv(.c) ?*const fn () void;
const GetTickFn = *const fn () callconv(.c) ?*const fn (u32) void;
const GetTitleFn = *const fn () callconv(.c) [*:0]const u8;
const GetLogicPtrFn = *const fn () callconv(.c) [*]const u8;
const GetLogicLenFn = *const fn () callconv(.c) usize;
const StateCountFn = *const fn () callconv(.c) usize;
const SlotTypeFn = *const fn (usize) callconv(.c) u8;
const GetIntFn = *const fn (usize) callconv(.c) i64;
const SetIntFn = *const fn (usize, i64) callconv(.c) void;
const GetFloatFn = *const fn (usize) callconv(.c) f64;
const SetFloatFn = *const fn (usize, f64) callconv(.c) void;
const GetBoolFn = *const fn (usize) callconv(.c) u8;
const SetBoolFn = *const fn (usize, u8) callconv(.c) void;
const GetStrPtrFn = *const fn (usize) callconv(.c) [*]const u8;
const GetStrLenFn = *const fn (usize) callconv(.c) usize;
const SetStrFn = *const fn (usize, [*]const u8, usize) callconv(.c) void;
const MarkDirtyFn = *const fn () callconv(.c) void;

// ── State snapshot ──

const MAX_SNAP_SLOTS = 256;
const MAX_SNAP_STR = 512;

const SlotSnapshot = struct {
    slot_type: u8, // 0=int, 1=float, 2=bool, 3=string
    int_val: i64 = 0,
    float_val: f64 = 0,
    bool_val: u8 = 0,
    str_buf: [MAX_SNAP_STR]u8 = undefined,
    str_len: usize = 0,
};

// ── Cartridge ──

pub const MAX_CARTRIDGES = 16;

pub const Cartridge = struct {
    lib: std.DynLib,
    root: *Node,
    init_fn: ?*const fn () void,
    tick_fn: ?*const fn (u32) void,
    title: [64]u8 = undefined,
    title_len: usize = 0,
    so_path: [512]u8 = undefined,
    so_path_len: usize = 0,
    last_mtime: i128 = 0,
    loaded: bool = false,
    faulted: bool = false,
    fault_count: u32 = 0,

    // State snapshot (per cartridge)
    snapshot: [MAX_SNAP_SLOTS]SlotSnapshot = undefined,
    snapshot_count: usize = 0,

    pub fn titleSlice(self: *const Cartridge) []const u8 {
        return self.title[0..self.title_len];
    }

    pub fn soPathSlice(self: *const Cartridge) []const u8 {
        return self.so_path[0..self.so_path_len];
    }
};

var carts: [MAX_CARTRIDGES]Cartridge = undefined;
var cart_count: usize = 0;
var active: usize = 0;
var shadow_counter: u32 = 0;

// ── Public API ──

pub fn count() usize {
    return cart_count;
}

pub fn activeIndex() usize {
    return active;
}

pub fn get(idx: usize) ?*Cartridge {
    if (idx >= cart_count) return null;
    if (!carts[idx].loaded) return null;
    return &carts[idx];
}

pub fn getActiveRoot() ?*Node {
    if (cart_count == 0) return null;
    if (!carts[active].loaded) return null;
    return carts[active].root;
}

pub fn load(so_path: []const u8) !usize {
    if (cart_count >= MAX_CARTRIDGES) return error.TooMany;

    const idx = cart_count;
    carts[idx] = .{
        .lib = undefined,
        .root = undefined,
        .init_fn = null,
        .tick_fn = null,
    };

    // Store path
    const pl = @min(so_path.len, 512);
    @memcpy(carts[idx].so_path[0..pl], so_path[0..pl]);
    carts[idx].so_path_len = pl;

    // Record mtime
    if (std.fs.cwd().statFile(so_path)) |stat| {
        carts[idx].last_mtime = stat.mtime;
    } else |_| {}

    // Load the library
    try loadCartridgeLib(idx);

    cart_count += 1;
    return idx;
}

pub fn setActive(idx: usize) void {
    if (idx < cart_count and carts[idx].loaded) {
        active = idx;
    }
}

pub fn tickAll(now: u32) void {
    for (0..cart_count) |i| {
        if (!carts[i].loaded or carts[i].faulted) continue;
        if (carts[i].tick_fn) |tick| {
            if (!safeCall(tick, .{now})) {
                carts[i].faulted = true;
                carts[i].fault_count += 1;
                log.print("[cartridge] CRASH in tick of '{s}' — cartridge disabled (fault #{d})\n", .{
                    carts[i].titleSlice(), carts[i].fault_count,
                });
            }
        }
    }
}

/// Check if a cartridge is faulted. The shell can display an error state.
pub fn isFaulted(idx: usize) bool {
    if (idx >= cart_count) return false;
    return carts[idx].faulted;
}

/// Clear fault state (e.g., after a hot-reload fixes the bug)
pub fn clearFault(idx: usize) void {
    if (idx >= cart_count) return;
    carts[idx].faulted = false;
}

/// Check all cartridges for .so file changes. Returns index of reloaded cartridge, or null.
pub fn checkReloads() ?usize {
    for (0..cart_count) |i| {
        if (!carts[i].loaded) continue;
        const path = carts[i].soPathSlice();
        const stat = std.fs.cwd().statFile(path) catch continue;
        if (stat.mtime == carts[i].last_mtime) continue;

        // Change detected
        std.Thread.sleep(100 * std.time.ns_per_ms);
        const stat2 = std.fs.cwd().statFile(path) catch continue;
        carts[i].last_mtime = stat2.mtime;

        // Snapshot state
        snapshotState(i);

        // Reload — clear fault state (the fix might be in this reload)
        carts[i].faulted = false;
        loadCartridgeLib(i) catch |err| {
            log.print("[cartridge] Reload failed for {s}: {}\n", .{ carts[i].titleSlice(), err });
            continue;
        };

        // Restore state
        restoreState(i);

        if (carts[i].faulted) {
            log.print("[cartridge] Reloaded {s} but init crashed again\n", .{carts[i].titleSlice()});
        } else {
            log.print("[cartridge] Reloaded: {s} (fault cleared)\n", .{carts[i].titleSlice()});
        }
        return i;
    }
    return null;
}

// ── Internal ──

fn loadCartridgeLib(idx: usize) !void {
    // Close existing
    if (carts[idx].loaded) carts[idx].lib.close();
    carts[idx].loaded = false;

    const path = carts[idx].soPathSlice();

    // Shadow copy
    var shadow_buf: [256]u8 = undefined;
    const shadow = std.fmt.bufPrint(&shadow_buf, "/tmp/tsz_cart_{d}_{d}.so", .{ idx, shadow_counter }) catch
        return error.FileNotFound;
    shadow_counter += 1;

    // Copy file
    const src = std.fs.cwd().openFile(path, .{}) catch return error.FileNotFound;
    defer src.close();
    const dst = std.fs.createFileAbsolute(shadow, .{}) catch return error.FileNotFound;
    defer dst.close();
    var buf: [65536]u8 = undefined;
    while (true) {
        const n = src.read(&buf) catch return error.FileNotFound;
        if (n == 0) break;
        dst.writeAll(buf[0..n]) catch return error.FileNotFound;
    }

    // dlopen
    var lib = std.DynLib.open(shadow) catch return error.FileNotFound;

    // Look up symbols
    const get_root = lib.lookup(GetRootFn, "app_get_root") orelse return error.FileNotFound;
    const get_init = lib.lookup(GetInitFn, "app_get_init") orelse return error.FileNotFound;
    const get_tick = lib.lookup(GetTickFn, "app_get_tick") orelse return error.FileNotFound;
    const get_title = lib.lookup(GetTitleFn, "app_get_title");

    carts[idx].lib = lib;
    carts[idx].root = get_root();
    carts[idx].init_fn = get_init();
    carts[idx].tick_fn = get_tick();
    carts[idx].loaded = true;

    // Title
    if (get_title) |tf| {
        const t = std.mem.span(tf());
        const tl = @min(t.len, 64);
        @memcpy(carts[idx].title[0..tl], t[0..tl]);
        carts[idx].title_len = tl;
    }

    // QJS / LuaJIT eval paths archived (archive/qjs-stack/). The cartridge
    // .so format used to embed `app_get_js_logic` / `app_get_lua_logic`
    // blobs that the QJS engine ran at boot; V8 carts use @embedFile +
    // v8_runtime.eval directly. If a future cart genuinely needs script
    // evaluation from a .so blob, route it through v8_runtime here.

    // Init (crash-isolated — a bad init doesn't kill the host)
    if (carts[idx].init_fn) |init_fn| {
        if (!safeCall(init_fn, .{})) {
            carts[idx].faulted = true;
            carts[idx].fault_count += 1;
            log.print("[cartridge] CRASH in init of '{s}' — cartridge disabled\n", .{carts[idx].titleSlice()});
        }
    }
}

fn snapshotState(idx: usize) void {
    if (!carts[idx].loaded) return;
    var lib = carts[idx].lib;

    const count_fn = lib.lookup(StateCountFn, "app_state_count") orelse return;
    const type_fn = lib.lookup(SlotTypeFn, "app_state_slot_type") orelse return;
    const sc = count_fn();
    if (sc > MAX_SNAP_SLOTS) return;

    const gi = lib.lookup(GetIntFn, "app_state_get_int");
    const gf = lib.lookup(GetFloatFn, "app_state_get_float");
    const gb = lib.lookup(GetBoolFn, "app_state_get_bool");
    const gsp = lib.lookup(GetStrPtrFn, "app_state_get_string_ptr");
    const gsl = lib.lookup(GetStrLenFn, "app_state_get_string_len");

    for (0..sc) |i| {
        const t = type_fn(i);
        carts[idx].snapshot[i] = .{ .slot_type = t };
        switch (t) {
            0 => {
                if (gi) |f| carts[idx].snapshot[i].int_val = f(i);
            },
            1 => {
                if (gf) |f| carts[idx].snapshot[i].float_val = f(i);
            },
            2 => {
                if (gb) |f| carts[idx].snapshot[i].bool_val = f(i);
            },
            3 => {
                if (gsp) |fp| {
                    if (gsl) |fl| {
                        const len = fl(i);
                        const ptr = fp(i);
                        const cl = @min(len, MAX_SNAP_STR);
                        @memcpy(carts[idx].snapshot[i].str_buf[0..cl], ptr[0..cl]);
                        carts[idx].snapshot[i].str_len = cl;
                    }
                }
            },
            else => {},
        }
    }
    carts[idx].snapshot_count = sc;
}

// ── Cross-cartridge state access (used by the shell for inter-cart communication) ──

pub fn getStateInt(cart_idx: usize, slot: usize) i64 {
    if (cart_idx >= cart_count or !carts[cart_idx].loaded) return 0;
    var lib = carts[cart_idx].lib;
    const f = lib.lookup(GetIntFn, "app_state_get_int") orelse return 0;
    return f(slot);
}

pub fn setStateInt(cart_idx: usize, slot: usize, val: i64) void {
    if (cart_idx >= cart_count or !carts[cart_idx].loaded) return;
    var lib = carts[cart_idx].lib;
    const f = lib.lookup(SetIntFn, "app_state_set_int") orelse return;
    f(slot, val);
    // Mark dirty so the cartridge's tick rebuilds its UI
    const md = lib.lookup(MarkDirtyFn, "app_state_mark_dirty") orelse return;
    md();
}

pub fn setStateString(cart_idx: usize, slot: usize, val: []const u8) void {
    if (cart_idx >= cart_count or !carts[cart_idx].loaded) return;
    var lib = carts[cart_idx].lib;
    const f = lib.lookup(SetStrFn, "app_state_set_string") orelse return;
    f(slot, val.ptr, val.len);
    const md = lib.lookup(MarkDirtyFn, "app_state_mark_dirty") orelse return;
    md();
}

fn restoreState(idx: usize) void {
    if (!carts[idx].loaded) return;
    if (carts[idx].snapshot_count == 0) return;
    var lib = carts[idx].lib;

    const count_fn = lib.lookup(StateCountFn, "app_state_count") orelse return;
    const nc = count_fn();
    const rc = @min(carts[idx].snapshot_count, nc);

    const si = lib.lookup(SetIntFn, "app_state_set_int");
    const sf = lib.lookup(SetFloatFn, "app_state_set_float");
    const sb = lib.lookup(SetBoolFn, "app_state_set_bool");
    const ss = lib.lookup(SetStrFn, "app_state_set_string");
    const md = lib.lookup(MarkDirtyFn, "app_state_mark_dirty");

    for (0..rc) |i| {
        const snap = carts[idx].snapshot[i];
        switch (snap.slot_type) {
            0 => {
                if (si) |f| f(i, snap.int_val);
            },
            1 => {
                if (sf) |f| f(i, snap.float_val);
            },
            2 => {
                if (sb) |f| f(i, snap.bool_val);
            },
            3 => {
                if (ss) |f| f(i, &snap.str_buf, snap.str_len);
            },
            else => {},
        }
    }
    if (md) |f| f();
}
