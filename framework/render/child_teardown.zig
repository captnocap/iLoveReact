//! Non-parking teardown for capture/display child processes (req_3503, req_3504).
//!
//! `std.process.Child.kill` in Zig 0.16 is ONE SIGTERM followed by an
//! UNCANCELABLE blocking wait4 retry loop (Threaded childKillPosix). A camera
//! child — ffmpeg grabbing a V4L2 device — that is blocked writing a raw
//! frame into a pipe nobody drains, or parked inside a V4L2 ioctl, never
//! exits from one SIGTERM: ffmpeg installs handlers with signal(), i.e.
//! SA_RESTART, so the blocked syscall transparently restarts and the exit
//! flag is never checked. The calling thread then waits forever. Called from
//! the frame thread, this froze the entire app so hard that even SIGTERM to
//! US was ignored (SDL converts it to an SDL_QUIT event that only the frozen
//! thread could pump); kill -9 was the only way out — the req_3503 bug.
//!
//! The rule this module enforces: THE FRAME THREAD NEVER WAITS ON A CHILD.
//! - Terminate = SIGKILL via the platform `kill` utility. The std process
//!   capability models termination only fused with the blocking wait, and
//!   this repo's ruled pattern for out-of-band signals is an explicitly
//!   spawned, injected-Io `kill` process (see render_surfaces.setSuspended)
//!   rather than reaching around Io with raw syscalls. kill(1) itself exits
//!   immediately after the kill(2) syscall, so the spawn+wait here is bounded
//!   by the utility, never by the signaled child.
//! - Reap = a detached `std.Io.Group` task owns the Child value and performs
//!   the blocking wait there. SIGKILL cannot be ignored or blocked by a full
//!   pipe, so the reap normally completes in microseconds; a child wedged in
//!   kernel D-state strands only that task, never a frame.

const std = @import("std");

const log = std.log.scoped(.child_teardown);
const page_alloc = std.heap.page_allocator;

var g_reap_tasks: std.Io.Group = .init;

const DetachedReap = struct {
    io: std.Io,
    child: std.process.Child,

    fn run(state: *DetachedReap) std.Io.Cancelable!void {
        defer page_alloc.destroy(state);
        _ = state.child.wait(state.io) catch |err| switch (err) {
            error.Canceled => return error.Canceled,
            else => {},
        };
    }
};

/// Send `sig` ("-KILL" / "-STOP" / "-CONT") to `pid` via the platform `kill`
/// utility. Bounded: waits only for kill(1) itself, never for the signaled
/// process. Returns false when the utility could not be spawned or reported
/// failure (e.g. the pid is already fully gone).
pub fn signalPid(io: std.Io, environ: *const std.process.Environ.Map, pid: std.process.Child.Id, sig: []const u8) bool {
    var pid_buf: [32]u8 = undefined;
    const pid_arg = std.fmt.bufPrint(&pid_buf, "{d}", .{pid}) catch return false;
    const argv = [_][]const u8{ "kill", sig, pid_arg };
    var child = std.process.spawn(io, .{
        .argv = &argv,
        .stdin = .ignore,
        .stdout = .ignore,
        .stderr = .ignore,
        .environ_map = environ,
    }) catch return false;
    const term = child.wait(io) catch return false;
    return switch (term) {
        .exited => |code| code == 0,
        else => false,
    };
}

fn closePipes(io: std.Io, child: *std.process.Child) void {
    if (child.stdout) |f| f.close(io);
    if (child.stderr) |f| f.close(io);
    if (child.stdin) |f| f.close(io);
    child.stdout = null;
    child.stderr = null;
    child.stdin = null;
}

/// Forcibly terminate `child_value` without ever letting the caller wait on
/// it: synchronous SIGKILL, then the reap runs on a detached task. Takes the
/// Child BY VALUE — the caller must null its own copy and never wait/kill it
/// again. Safe on an already-reaped child (`id == null` no-ops) and on an
/// exited-but-unreaped zombie (the detached wait reaps it).
pub fn terminateDetached(io: std.Io, environ: *const std.process.Environ.Map, child_value: std.process.Child) void {
    var child = child_value;
    const pid = child.id orelse return;
    // A failed signal (e.g. the process is a zombie — signals succeed there,
    // but belt-and-suspenders) is reported, not fatal: the reap below still
    // owns the wait either way.
    if (!signalPid(io, environ, pid, "-KILL"))
        log.warn("SIGKILL pid={d} did not confirm — reaping anyway", .{pid});
    const state = page_alloc.create(DetachedReap) catch {
        // No memory for the reaper. The child is already SIGKILLed; leaving a
        // zombie until process exit beats parking this thread on a wait.
        closePipes(io, &child);
        return;
    };
    state.* = .{ .io = io, .child = child };
    g_reap_tasks.concurrent(io, DetachedReap.run, .{state}) catch {
        page_alloc.destroy(state);
        closePipes(io, &child);
        log.warn("no reaper task for pid={d} — zombie until process exit", .{pid});
    };
}

/// Release reaper resources at shutdown. Cancels rather than awaits so a
/// child wedged in kernel D-state can never block process exit — SIGKILL was
/// already sent and any straggling zombie dies with the process.
pub fn shutdown(io: std.Io) void {
    g_reap_tasks.cancel(io);
}
