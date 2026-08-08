//! proc_lifetime.zig — tie a spawned process's lifetime to its launcher's.
//!
//! `rjit dev` already installs SIGINT/SIGTERM/SIGHUP handlers that kill every
//! child it spawned (v8_bindings_cli.zig installSignalHandlers). That covers a
//! polite death: Ctrl-C, or a terminal that hangs up its foreground group. It
//! cannot cover the deaths that skip signal delivery entirely — a SIGKILL, an
//! OOM kill, a launcher that crashed, a close that never reached the process
//! group. Those are exactly the deaths that leave a dev host reparented to
//! init, holding a gigabyte of RSS and a window nobody launched (the nine found
//! on 2026-08-08, req_4074; the pair still running at req_4109).
//!
//! The kernel already answers this: PR_SET_PDEATHSIG makes the KERNEL signal
//! the child when its parent dies, whatever killed the parent. Arming it in the
//! child needs no cooperation from the launcher's exit path, so there is no
//! death it can miss.
//!
//! It is opt-in by environment rather than always-on, because "die with my
//! launcher" is a contract between one launcher and one child. `rjit ship`'s
//! zig build, the editor's own tool spawns, and anything a user starts by hand
//! must NOT inherit it — a build that outlives the shell that started it is
//! correct, a dev host that outlives its supervisor is the bug.

const std = @import("std");
const linux = std.os.linux;
const posix = std.posix;

/// Launchers set this on children that must not outlive them. `rjit dev` sets
/// it on the dev host and on the bundle watcher; nothing else does.
pub const ENV_KEY = "RJIT_DIE_WITH_PARENT";

pub const Verdict = enum {
    /// The launcher did not ask for this; the process runs unattached.
    not_requested,
    /// The kernel will SIGTERM us when our launcher dies.
    armed,
    /// The launcher was already gone before we could arm. The caller should
    /// exit rather than become the orphan this module exists to prevent.
    launcher_already_gone,
    /// prctl refused. Nothing is tying us to the launcher; say so out loud
    /// rather than pretend the contract holds.
    unavailable,
};

/// Arm the kernel's parent-death signal when the launcher asked for it.
/// Call once, as early in main as the environment is readable.
pub fn dieWithParent(environ: anytype) Verdict {
    const requested = environ.get(ENV_KEY) orelse return .not_requested;
    if (requested.len == 0 or requested[0] == '0') return .not_requested;

    const rc = linux.prctl(@intFromEnum(linux.PR.SET_PDEATHSIG), @intFromEnum(posix.SIG.TERM), 0, 0, 0);
    if (posix.errno(rc) != .SUCCESS) return .unavailable;

    // The window between our fork and this call belongs to nobody: if the
    // launcher died inside it, PR_SET_PDEATHSIG has already missed its only
    // chance to fire. Re-reading our parent after arming closes that window —
    // ppid 1 means we were reparented to init while we were still starting up.
    if (posix.getppid() == 1) return .launcher_already_gone;
    return .armed;
}

/// The whole contract in one call: arm, and exit immediately if the launcher
/// already died. Returns the verdict for callers that want to log it.
pub fn dieWithParentOrExit(environ: anytype) Verdict {
    const verdict = dieWithParent(environ);
    if (verdict == .launcher_already_gone) std.process.exit(0);
    return verdict;
}

// Run: tools/zig/zig test framework/proc_lifetime.zig
//
// `environ` is `anytype`, so nothing in the body is compiled until something
// instantiates it — a module-boundary decl this file never calls itself would
// ship unchecked. These tests exist to force that instantiation as much as to
// pin the behaviour.
const TestEnviron = struct {
    value: ?[]const u8,
    fn get(self: TestEnviron, name: []const u8) ?[]const u8 {
        return if (std.mem.eql(u8, name, ENV_KEY)) self.value else null;
    }
};

test "an unset variable leaves the process unattached" {
    try std.testing.expectEqual(Verdict.not_requested, dieWithParent(TestEnviron{ .value = null }));
}

test "an explicit 0 is a refusal, not a truthy string" {
    try std.testing.expectEqual(Verdict.not_requested, dieWithParent(TestEnviron{ .value = "0" }));
    try std.testing.expectEqual(Verdict.not_requested, dieWithParent(TestEnviron{ .value = "" }));
}

test "asking for the contract arms it — the test runner is our live launcher" {
    // The runner is a real parent, so the only honest outcomes are `armed` or,
    // on a kernel without PR_SET_PDEATHSIG, `unavailable`. Arming here affects
    // nothing: the signal can only fire once this process's parent exits, and
    // by then the test binary is done.
    const verdict = dieWithParent(TestEnviron{ .value = "1" });
    try std.testing.expect(verdict == .armed or verdict == .unavailable);
}
