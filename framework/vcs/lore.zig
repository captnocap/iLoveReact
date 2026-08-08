//! framework/vcs/lore.zig — Zig binding for liblore, the Lore VCS C API.
//!
//! Lore (github.com/EpicGames/lore) versions the game's models. This module is the ONLY
//! place that talks to liblore; everything above it works in Zig types.
//!
//! Why this is a Zig system and not a JS one: CLAUDE.md's rule is that a capability lives
//! where the data lives. The authoritative mesh state is the live native session in
//! framework/gpu — never the JS side, and never the on-disk file. A snapshot has to read
//! that session directly, so the VCS binding sits next to it.
//!
//! ## Types come from the header, never from here
//!
//! Every struct layout and enum value is taken from the vendored `deps/lore/include/lore.h`
//! via @cImport, the same way framework/assistant takes llama.cpp's. This is not a style
//! preference. A first pass at this file hand-wrote the externs and got three things wrong
//! in a way that compiled cleanly and would have failed at runtime:
//!
//!   * `lore_error_event_data_t` was assumed to be `{ tag, message }`; it is actually
//!     `{ uint32_t error_type; lore_string_t error_inner; }`, so the message would have
//!     been read from the wrong offset.
//!   * `lore_file_stage_args_t` was assumed to take one string; it takes a string ARRAY
//!     plus a `case_change` field that did not exist in the hand-written version.
//!   * The event tag constants were invented. They are auto-numbered from a ~200-entry
//!     enum and none of the guesses lined up.
//!
//! Lore is pre-1.0 and says outright that "interfaces, on-disk formats, and APIs may change
//! between releases". A hand-maintained mirror of its ABI would rot silently on the next
//! bump; @cImport turns that same change into a compile error.
//!
//! ## The C API's shape
//!
//! Every call takes `lore_global_args_t` (repository path, identity, offline flag) plus a
//! per-call args struct, and reports results by invoking an event CALLBACK — there are no
//! return values beyond an int32 status. So each wrapper here:
//!
//!   1. builds a collector on the stack,
//!   2. passes its address as the u64 `user_context`,
//!   3. lets a `callconv(.c)` trampoline copy matching events into it.
//!
//! The callback fires synchronously on the calling thread for the non-`_async` entry
//! points used here, so a stack collector is sound. Do NOT reuse the pattern with the
//! `_async` variants without moving the collector to the heap — those return before the
//! events arrive.
//!
//! Strings handed BACK by an event point into liblore-owned memory valid only for the
//! duration of that callback, so every collector copies what it keeps.

const std = @import("std");
const log = @import("../diag/log.zig");

pub const c = @cImport({
    @cInclude("lore.h");
});

// ── string helpers ───────────────────────────────────────────────────────────────────

/// `lore_string_t` is (ptr, len) and is NOT null-terminated, so Zig slices map onto it
/// exactly — nothing here allocates just to add a sentinel.
pub fn str(slice: []const u8) c.lore_string_t {
    return .{ .string = slice.ptr, .length = slice.len };
}

pub const empty_str: c.lore_string_t = .{ .string = null, .length = 0 };

/// Borrowed view of a string owned by liblore. Only valid inside the callback that got it.
pub fn strSlice(s: c.lore_string_t) []const u8 {
    const ptr = s.string orelse return &.{};
    return ptr[0..s.length];
}

// ── globals ──────────────────────────────────────────────────────────────────────────

/// Build the per-call globals every liblore entry point needs.
///
/// `offline` is 1 deliberately. Staging and committing are local operations in Lore, and
/// the panic-snapshot path must not be blockable by something outside this process — a
/// server that is down is exactly when you most need the snapshot to work. Pushing is a
/// separate, later step that is allowed to fail.
pub fn globals(repository_path: []const u8, identity: []const u8) c.lore_global_args_t {
    var g = std.mem.zeroes(c.lore_global_args_t);
    g.repository_path = str(repository_path);
    g.identity = identity_or_empty(identity);
    g.offline = 1;
    return g;
}

fn identity_or_empty(identity: []const u8) c.lore_string_t {
    return if (identity.len == 0) empty_str else str(identity);
}

// ── error collection ─────────────────────────────────────────────────────────────────

/// Records whether an error event arrived and keeps the FIRST error message, which is the
/// one that explains the failure — later events are usually knock-on noise.
pub const StatusCollector = struct {
    failed: bool = false,
    error_type: u32 = 0,
    message_len: usize = 0,
    message_buf: [512]u8 = undefined,

    pub fn message(self: *const StatusCollector) []const u8 {
        return self.message_buf[0..self.message_len];
    }

    pub fn callback(self: *StatusCollector) c.lore_event_callback_config_t {
        return .{ .user_context = @intFromPtr(self), .func = trampoline };
    }

    fn trampoline(event: [*c]const c.lore_event_t, user_context: u64) callconv(.c) void {
        const self: *StatusCollector = @ptrFromInt(user_context);
        const ev = event orelse return;
        if (ev.*.tag != c.LORE_EVENT_ERROR) return;
        self.failed = true;
        if (self.message_len != 0) return;

        // Field names come from the header's union member, so a rename upstream is a
        // compile error rather than a wrong read.
        const payload = ev.*.unnamed_0.@"error";
        self.error_type = payload.error_type;
        const text = strSlice(payload.error_inner);
        const take = @min(text.len, self.message_buf.len);
        @memcpy(self.message_buf[0..take], text[0..take]);
        self.message_len = take;
    }
};

// ── public surface ───────────────────────────────────────────────────────────────────

pub const Error = error{ LoreCallFailed, LoreUnavailable };

/// liblore's own version string, e.g. "0.8.6+373". Also the cheapest proof that the
/// library actually loaded — if this is empty, nothing else here will work.
///
/// Note this is the one call that does NOT return a `lore_string_t`: the header declares
/// `const char *lore_version(void)`, NUL-terminated and owned by the library. Verified
/// against the real signature after an earlier version of this file assumed otherwise.
pub fn version() []const u8 {
    const ptr = c.lore_version() orelse return &.{};
    return std.mem.span(ptr);
}

/// Release liblore's global state. Safe to call once at host shutdown.
pub fn shutdown() void {
    c.lore_shutdown();
}

/// Is liblore present and callable? Callers must degrade rather than crash when Lore is
/// missing — a version-control outage must never take the editor down with it.
pub fn available() bool {
    if (version().len == 0) {
        log.print("[lore] liblore returned an empty version — treating as unavailable\n", .{});
        return false;
    }
    return true;
}
