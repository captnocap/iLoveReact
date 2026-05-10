//! Crash logger — writes to a file for debugging file-explorer launches.
//! Uses sigaction with SA_SIGINFO to capture faulting address + return address.

const std = @import("std");
const builtin = @import("builtin");

var g_fd: ?std.posix.fd_t = null;
var g_initialized = false;
var g_clean_shutdown = false;

/// Call this from engine.zig when the event loop exits normally.
pub fn markCleanShutdown() void {
    g_clean_shutdown = true;
}

// macOS: sigaction struct has different layout and fields.
// Linux paths (/run/user/) and ucontext register offsets are x86_64-linux-specific.
// On non-Linux, the crash logger is a no-op (signals still work via std.posix).
const is_linux = builtin.os.tag == .linux;

// C externs for sigaction-based signal handling (Linux only)
const siginfo_t = extern struct {
    si_signo: c_int,
    si_errno: c_int,
    si_code: c_int,
    _pad1: c_int = 0,
    si_addr: ?*anyopaque, // faulting address for SIGSEGV
    _pad: [128 - 24]u8 = undefined,
};

const SA_SIGINFO: c_uint = 4;
const SA_RESETHAND: c_uint = if (is_linux) 0x80000000 else 0x0004;

const SigactionFn = *const fn (c_int, *siginfo_t, ?*anyopaque) callconv(.c) void;

const Sigaction = if (is_linux) extern struct {
    handler: extern union {
        sa_handler: ?*const fn (c_int) callconv(.c) void,
        sa_sigaction: ?SigactionFn,
    },
    sa_mask: [32]u32 = [_]u32{0} ** 32,
    sa_flags: c_uint = 0,
    sa_restorer: ?*anyopaque = null,
} else extern struct {
    // macOS sigaction layout
    __sigaction_u: extern union {
        __sa_handler: ?*const fn (c_int) callconv(.c) void,
        __sa_sigaction: ?SigactionFn,
    },
    sa_mask: u32 = 0,
    sa_flags: c_int = 0,
};

extern fn sigaction(sig: c_int, act: *const Sigaction, oldact: ?*Sigaction) c_int;
extern fn _exit(status: c_int) noreturn;

pub fn init() void {
    if (g_initialized) return;
    g_initialized = true;

    if (is_linux) {
        const uid = std.os.linux.getuid();
        var path_buf: [256]u8 = undefined;
        const path = std.fmt.bufPrint(&path_buf, "/run/user/{d}/claude-sessions/supervisor-crash.log", .{uid}) catch return;
        path_buf[path.len] = 0;
        const path_z: [*:0]const u8 = @ptrCast(path_buf[0..path.len]);

        g_fd = std.posix.openZ(
            path_z,
            .{ .ACCMODE = .WRONLY, .CREAT = true, .TRUNC = true },
            0o644,
        ) catch null;
    } else {
        // macOS: write to ~/Library/Logs/
        var path_buf: [256]u8 = undefined;
        const home = std.posix.getenv("HOME") orelse return;
        const path = std.fmt.bufPrint(&path_buf, "{s}/Library/Logs/reactjit-crash.log", .{home}) catch return;
        path_buf[path.len] = 0;
        const path_z: [*:0]const u8 = @ptrCast(path_buf[0..path.len]);

        g_fd = std.posix.openZ(
            path_z,
            .{ .ACCMODE = .WRONLY, .CREAT = true, .TRUNC = true },
            0o644,
        ) catch null;
    }

    // Install crash handlers with SA_SIGINFO for faulting address
    const signals = [_]c_int{ 11, 6, 7, 8, 4, 5 }; // SIGSEGV, SIGABRT, SIGBUS, SIGFPE, SIGILL, SIGTRAP
    for (signals) |sig| {
        if (is_linux) {
            var sa = Sigaction{
                .handler = .{ .sa_sigaction = &crashHandlerSiginfo },
                .sa_flags = SA_SIGINFO | SA_RESETHAND,
            };
            @memset(&sa.sa_mask, 0);
            _ = sigaction(sig, &sa, null);
        } else {
            var sa = Sigaction{
                .__sigaction_u = .{ .__sa_sigaction = &crashHandlerSiginfo },
                .sa_flags = @intCast(SA_SIGINFO | SA_RESETHAND),
            };
            sa.sa_mask = 0;
            _ = sigaction(sig, &sa, null);
        }
    }

    // Hook atexit to catch clean exits (e.g. some library calling exit())
    const atexit_fn = @extern(*const fn (?*const fn () callconv(.c) void) callconv(.c) c_int, .{ .name = "atexit" });
    _ = atexit_fn(&atexitHandler);
}

fn atexitHandler() callconv(.c) void {
    if (g_clean_shutdown) return;
    // If the engine didn't mark clean shutdown, something called exit() directly
    // (SDL init failure, wgpu panic, C library assertion, etc.)
    logRaw("EXIT: abnormal — exit() called without engine shutdown\n");
    const stderr = 2;
    _ = std.posix.write(stderr, "\n[CRASH] Process called exit() without clean shutdown.\n") catch {};
    _ = std.posix.write(stderr, "[CRASH] Likely cause: SDL init failure, wgpu error, or C library abort.\n") catch {};
    _ = std.posix.write(stderr, "[CRASH] Check stderr output above for the actual error.\n\n") catch {};
}

/// Install a normal (non-SA_SIGINFO) signal handler. Use for SIGINT/SIGTERM
/// where we want graceful shutdown — the handler should set a flag the main
/// loop polls so deferred cleanup (SDL_Quit, geometry.save, etc.) runs.
pub fn installQuitHandler(sig: c_int, handler: *const fn (c_int) callconv(.c) void) void {
    if (is_linux) {
        var sa = Sigaction{
            .handler = .{ .sa_handler = handler },
        };
        @memset(&sa.sa_mask, 0);
        _ = sigaction(sig, &sa, null);
    } else {
        var sa: Sigaction = std.mem.zeroes(Sigaction);
        sa.__sigaction_u = .{ .__sa_handler = handler };
        _ = sigaction(sig, &sa, null);
    }
}

pub fn ignoreSignal(sig: c_int) void {
    // SIG_IGN = (void (*)(int))1 — an intentionally misaligned sentinel value.
    // Use our own Sigaction struct + C extern to avoid Zig std lib type mismatches.
    if (is_linux) {
        var sa = Sigaction{
            .handler = .{ .sa_handler = @ptrFromInt(1) }, // SIG_IGN
        };
        @memset(&sa.sa_mask, 0);
        _ = sigaction(sig, &sa, null);
    } else {
        // On macOS, bypass the typed function pointer entirely — write the
        // raw SIG_IGN value (1) into the union via memset + direct memory write.
        var sa: Sigaction = std.mem.zeroes(Sigaction);
        // sa.__sigaction_u is at offset 0, and __sa_handler is a pointer field.
        // Write the integer 1 as a pointer value directly.
        const ptr_bytes = std.mem.asBytes(&sa.__sigaction_u);
        const one: usize = 1;
        @memcpy(ptr_bytes[0..@sizeOf(usize)], std.mem.asBytes(&one));
        _ = sigaction(sig, &sa, null);
    }
}

fn crashHandlerSiginfo(sig: c_int, info: *siginfo_t, ctx: ?*anyopaque) callconv(.c) void {
    const name: []const u8 = switch (sig) {
        11 => "SIGSEGV (null ptr / bad memory access)",
        6 => "SIGABRT (assertion / panic / abort())",
        7 => "SIGBUS (bad alignment / unmapped memory)",
        8 => "SIGFPE (divide by zero / arithmetic overflow)",
        4 => "SIGILL (illegal instruction / bad codegen)",
        5 => "SIGTRAP (breakpoint / unreachable hit)",
        else => "UNKNOWN SIGNAL",
    };

    // Write to stderr — this is the only output Claude will see.
    // Must be unmissable. Signal handler context: no allocator, no formatting
    // beyond bufPrint, only write() is async-signal-safe.
    const stderr = 2;
    _ = std.posix.write(stderr, "\n\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n") catch {};
    _ = std.posix.write(stderr, "!!!  CRASH: ") catch {};
    _ = std.posix.write(stderr, name) catch {};
    _ = std.posix.write(stderr, "  !!!\n") catch {};
    _ = std.posix.write(stderr, "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n") catch {};

    if (info.si_addr) |addr| {
        var buf: [80]u8 = undefined;
        const s = std.fmt.bufPrint(&buf, "fault address: 0x{x}\n", .{@intFromPtr(addr)}) catch "fault address: ?\n";
        _ = std.posix.write(stderr, s) catch {};
    }

    if (ctx) |uctx| {
        const uctx_bytes: [*]const u8 = @ptrCast(uctx);
        if (is_linux) {
            const mctx_offset: usize = 40;
            const rip_offset: usize = mctx_offset + 16 * 8;
            const rip_ptr: *const u64 = @ptrCast(@alignCast(uctx_bytes + rip_offset));
            var buf2: [80]u8 = undefined;
            const s2 = std.fmt.bufPrint(&buf2, "instruction ptr: 0x{x}\n", .{rip_ptr.*}) catch "instruction ptr: ?\n";
            _ = std.posix.write(stderr, s2) catch {};
        } else {
            var buf2: [80]u8 = undefined;
            const s2 = std.fmt.bufPrint(&buf2, "ucontext: 0x{x}\n", .{@intFromPtr(uctx_bytes)}) catch "ucontext: ?\n";
            _ = std.posix.write(stderr, s2) catch {};
        }
    }

    _ = std.posix.write(stderr, "Rebuild with --debug for symbols, then:\n") catch {};
    _ = std.posix.write(stderr, "  addr2line -e zig-out/bin/APP 0xADDRESS\n") catch {};
    _ = std.posix.write(stderr, "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n\n") catch {};

    // Also write to log file
    logRaw("CRASH: signal ");
    logRaw(name);
    logRaw("\n");
    if (info.si_addr) |addr| {
        var buf: [64]u8 = undefined;
        const s = std.fmt.bufPrint(&buf, "fault_addr: 0x{x}\n", .{@intFromPtr(addr)}) catch "fault_addr: ?\n";
        logRaw(s);
    }
    if (ctx) |uctx| {
        const uctx_bytes: [*]const u8 = @ptrCast(uctx);
        if (is_linux) {
            const mctx_offset: usize = 40;
            const rip_offset: usize = mctx_offset + 16 * 8;
            const rip_ptr: *const u64 = @ptrCast(@alignCast(uctx_bytes + rip_offset));
            var buf2: [64]u8 = undefined;
            const s2 = std.fmt.bufPrint(&buf2, "rip: 0x{x}\n", .{rip_ptr.*}) catch "rip: ?\n";
            logRaw(s2);
        }
    }

    _exit(128 + sig);
}

pub fn log(msg: []const u8) void {
    logRaw(msg);
    logRaw("\n");
}

fn logRaw(msg: []const u8) void {
    if (g_fd) |fd| {
        _ = std.posix.write(fd, msg) catch {};
    }
}

pub fn logFmt(comptime fmt: []const u8, args: anytype) void {
    var buf: [1024]u8 = undefined;
    const msg = std.fmt.bufPrint(&buf, fmt, args) catch return;
    log(msg);
}
