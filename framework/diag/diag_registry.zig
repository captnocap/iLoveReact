//! diag_registry.zig — the host authority behind the diagnostics CHANNEL
//! contract (runtime/diag/channel.ts, Seam 3).
//!
//! Why this exists: "First-class instrumentation is part of every feature's
//! contract, not a later cleanup pass." A system registers its debug channels
//! ONCE on the JS side (channel.ts), and from then on the settings UI renders
//! toggles and the in-app raw console reads the feed. The two doors the JS
//! contract declares — `__diag_emit` and `__diag_set_enabled` — land here.
//! Crucially this captures Zig HOST events too: any framework system can call
//! `emit()` directly (the same ring, the same console), so a hot native path's
//! timing shows up next to the JS-side lines without a rebuild-only probe.
//!
//! Design (mirrors event_bus.zig's ring discipline, but self-contained):
//!   - A bounded in-memory ring (RING_SIZE). Newest entries evict oldest.
//!     Inline fixed buffers — zero allocation on the emit path, so leaving a
//!     channel enabled during authoring costs a memcpy, not a malloc.
//!   - A small per-channel table: enabled flag + cost-tier sample divisor +
//!     emitted/dropped counters. Lookup is a linear scan (channel count is
//!     tiny — one per registered stream).
//!   - Sink routing via ONE installed function pointer. The v8 binding installs
//!     a sink that (a) re-broadcasts each line on the `diag.feed` ffi channel so
//!     the console live-tails it, and (b) mirrors to event_bus.zig as a
//!     secondary sink. Keeping the sink a pointer (not a hard import of
//!     v8_runtime/event_bus) is what lets the unit test exercise the ring +
//!     sampling with no V8 and no sqlite linked.
//!
//! Cost tiers (channel.ts `costTier`): the registry can't see the tier across
//! the bridge (the contract only passes id/severity/msg/fields), so a hot
//! `sampled`/`heavy` channel sets a sample divisor host-side via
//! `setSampleDiv(id, n)` — keep 1 of every N accepted lines. `cheap` channels
//! leave the divisor at 1. Disabled channels never reach the ring at all.
//!
//! Contract note (see report): channel.ts mirrors the ENABLED state on toggle
//! (setChannelEnabled → __diag_set_enabled) but does NOT mirror a channel's
//! `defaultOn` at defineChannel time, and never mirrors `costTier`. So a
//! host-originated channel starts life enabled here (divisor 1) until JS says
//! otherwise — JS-originated `__diag_emit` calls are already pre-gated by
//! channel.ts, so an arriving call always means "JS thinks this is on."

const std = @import("std");

// ── Tunables ────────────────────────────────────────────────────────────────

/// Ring capacity. ~2k lines is minutes of human-rate authoring traffic and
/// the console's catch-up window. At ~784B/entry this is ~1.6MB of BSS.
pub const RING_SIZE: usize = 2048;
/// Max distinct channels tracked. One slot per registered diagnostics stream.
pub const MAX_CHANNELS: usize = 128;
/// Inline per-entry buffer caps. Messages/fields beyond these truncate (LOUD:
/// a trailing `…`/`"_trunc":1` marker), never overflow.
const MAX_ID: usize = 64;
const MAX_MSG: usize = 240;
const MAX_FIELDS: usize = 512;
/// Stack buffer for one serialized feed line handed to the sink.
const LINE_JSON_CAP: usize = 1536;

/// The ffi channel the console subscribes to for the live feed. The v8 binding
/// broadcasts each emitted line here via `__ffiEmit`; the TS console subscribes
/// with `ffi.subscribe(DIAG_FEED_CHANNEL, ...)`. Kept in lockstep with
/// runtime/diag/console/feed.ts.
pub const DIAG_FEED_CHANNEL = "diag.feed";

// ── Severity ────────────────────────────────────────────────────────────────

/// Matches channel.ts `Severity` ('trace'|'debug'|'info'|'warn'|'error').
/// `err` avoids the reserved word; `name()` maps back to the wire string.
pub const Severity = enum(u8) {
    trace = 0,
    debug = 1,
    info = 2,
    warn = 3,
    err = 4,

    pub fn name(self: Severity) []const u8 {
        return switch (self) {
            .trace => "trace",
            .debug => "debug",
            .info => "info",
            .warn => "warn",
            .err => "error",
        };
    }

    pub fn rank(self: Severity) u8 {
        return @intFromEnum(self);
    }
};

/// Parse the JS-side severity string. Unknown → .info (never reject a line for
/// a typo — diagnostics infra must not be the thing that drops data).
pub fn severityFromStr(s: []const u8) Severity {
    if (std.mem.eql(u8, s, "trace")) return .trace;
    if (std.mem.eql(u8, s, "debug")) return .debug;
    if (std.mem.eql(u8, s, "info")) return .info;
    if (std.mem.eql(u8, s, "warn")) return .warn;
    if (std.mem.eql(u8, s, "error")) return .err;
    return .info;
}

// ── Sink ────────────────────────────────────────────────────────────────────

/// A line sink receives the already-serialized single-line JSON (the same
/// shape recentJson emits per element). The v8 binding installs one that
/// forwards to `__ffiEmit(DIAG_FEED_CHANNEL, json)` + event_bus.emit. Pure
/// pointer → the registry stays free of V8/sqlite for the unit test.
pub const FeedSink = *const fn (line_json: []const u8) void;
var g_sink: ?FeedSink = null;

pub fn setFeedSink(sink: ?FeedSink) void {
    g_sink = sink;
}

// ── Channel table ───────────────────────────────────────────────────────────

const Channel = struct {
    id: [MAX_ID]u8 = undefined,
    id_len: u8 = 0,
    enabled: bool = true,
    /// Cost-tier sampling: keep 1 of every `sample_div` accepted lines.
    /// 1 = keep all (cheap channels). >1 = throttle a hot channel.
    sample_div: u32 = 1,
    sample_count: u32 = 0,
    emitted: u64 = 0,
    dropped: u64 = 0,

    fn idSlice(self: *const Channel) []const u8 {
        return self.id[0..self.id_len];
    }
};

var g_channels: [MAX_CHANNELS]Channel = undefined;
var g_channel_count: usize = 0;

// ── Ring ────────────────────────────────────────────────────────────────────

const Entry = struct {
    seq: u64 = 0,
    ts_ms: i64 = 0,
    severity: Severity = .info,
    ch_idx: u16 = 0,
    msg_len: u16 = 0,
    fields_len: u16 = 0,
    msg_trunc: bool = false,
    fields_trunc: bool = false,
    msg: [MAX_MSG]u8 = undefined,
    fields: [MAX_FIELDS]u8 = undefined,
};

var g_ring: [RING_SIZE]Entry = undefined;
var g_ring_count: u64 = 0;
var g_seq: u64 = 0;
var g_inited: bool = false;

pub fn init() void {
    if (g_inited) return;
    g_channel_count = 0;
    g_ring_count = 0;
    g_seq = 0;
    g_inited = true;
}

/// Test/relaunch helper — wipe channels + ring without touching the sink.
pub fn reset() void {
    g_channel_count = 0;
    g_ring_count = 0;
    g_seq = 0;
    g_inited = true;
}

pub fn isInitialized() bool {
    return g_inited;
}

// ── Channel lookup ──────────────────────────────────────────────────────────

fn findChannel(id: []const u8) ?usize {
    var i: usize = 0;
    while (i < g_channel_count) : (i += 1) {
        if (std.mem.eql(u8, g_channels[i].idSlice(), id)) return i;
    }
    return null;
}

/// Find a channel index, creating it (enabled, divisor 1) on first sight.
/// Returns null only when the table is full (id too long ids are truncated,
/// not rejected — a truncated id still tracks consistently).
fn findOrCreate(id: []const u8) ?usize {
    if (findChannel(id)) |idx| return idx;
    if (g_channel_count >= MAX_CHANNELS) return null;
    const idx = g_channel_count;
    var ch = &g_channels[idx];
    const n: usize = @min(id.len, MAX_ID);
    @memcpy(ch.id[0..n], id[0..n]);
    ch.id_len = @intCast(n);
    ch.enabled = true;
    ch.sample_div = 1;
    ch.sample_count = 0;
    ch.emitted = 0;
    ch.dropped = 0;
    g_channel_count += 1;
    return idx;
}

// ── Channel control (mirrors of the JS registry / cost-tier config) ──────────

/// Mirror a channel's enabled state (the `__diag_set_enabled` door). Auto-
/// creates the channel so the host knows about a stream JS toggled before it
/// has emitted anything.
pub fn setEnabled(id: []const u8, on: bool) void {
    if (!g_inited) init();
    const idx = findOrCreate(id) orelse return;
    g_channels[idx].enabled = on;
}

pub fn isEnabled(id: []const u8) bool {
    if (findChannel(id)) |idx| return g_channels[idx].enabled;
    // Unknown channel: host-side emitters get an enabled default so a stream
    // that hasn't been toggled yet still records (JS path is pre-gated anyway).
    return true;
}

/// Cost-tier sampling: keep 1 of every `div` accepted lines on this channel.
/// `div <= 1` keeps everything. A `sampled`/`heavy` channel calls this once at
/// registration (host-side) to throttle a hot path.
pub fn setSampleDiv(id: []const u8, div: u32) void {
    if (!g_inited) init();
    const idx = findOrCreate(id) orelse return;
    g_channels[idx].sample_div = if (div == 0) 1 else div;
    g_channels[idx].sample_count = 0;
}

// ── Emit ────────────────────────────────────────────────────────────────────

/// The one emit path. Returns the assigned monotonic seq, or 0 when the line
/// was suppressed (disabled channel, sampled-out, table full, or uninited).
///
/// Order is deliberately cheapest-gate-first: channel lookup, enabled check,
/// then the sampling counter — only a line that clears all three touches the
/// ring or the sink.
pub fn emit(channel_id: []const u8, severity: Severity, msg: []const u8, fields_json: []const u8) u64 {
    if (!g_inited) init();
    const idx = findOrCreate(channel_id) orelse return 0;
    var ch = &g_channels[idx];
    if (!ch.enabled) return 0; // disabled = cheap branch

    // Cost-tier sampling. Keep when the running count hits a multiple of the
    // divisor (deterministic: with div=N, lines N, 2N, 3N… survive).
    if (ch.sample_div > 1) {
        ch.sample_count +%= 1;
        if (ch.sample_count % ch.sample_div != 0) {
            ch.dropped += 1;
            return 0;
        }
    }

    g_seq += 1;
    const seq = g_seq;
    ch.emitted += 1;

    const slot: usize = @intCast(g_ring_count % RING_SIZE);
    var e = &g_ring[slot];
    e.seq = seq;
    e.ts_ms = std.Io.Clock.now(.real, std.Io.Threaded.global_single_threaded.io()).toMilliseconds();
    e.severity = severity;
    e.ch_idx = @intCast(idx);

    const mlen: usize = @min(msg.len, MAX_MSG);
    @memcpy(e.msg[0..mlen], msg[0..mlen]);
    e.msg_len = @intCast(mlen);
    e.msg_trunc = msg.len > MAX_MSG;

    const safe_fields = if (fields_json.len == 0) "{}" else fields_json;
    const flen: usize = @min(safe_fields.len, MAX_FIELDS);
    @memcpy(e.fields[0..flen], safe_fields[0..flen]);
    e.fields_len = @intCast(flen);
    e.fields_trunc = safe_fields.len > MAX_FIELDS;

    g_ring_count += 1;

    // Fan out one serialized line to the sink (console live feed + event_bus).
    if (g_sink) |sink| {
        var buf: [LINE_JSON_CAP]u8 = undefined;
        var writer: std.Io.Writer = .fixed(&buf);
        writeEntryJson(&writer, e, ch.idSlice()) catch {
            return seq; // sink skipped on overflow; ring already has the line
        };
        sink(writer.buffered());
    }

    return seq;
}

/// String-severity convenience for the v8 binding (the JS door passes a string).
pub fn emitStr(channel_id: []const u8, severity_str: []const u8, msg: []const u8, fields_json: []const u8) u64 {
    return emit(channel_id, severityFromStr(severity_str), msg, fields_json);
}

// ── Serialization ───────────────────────────────────────────────────────────

fn writeJsonString(writer: anytype, s: []const u8) !void {
    try writer.writeByte('"');
    for (s) |c| {
        switch (c) {
            '"' => try writer.writeAll("\\\""),
            '\\' => try writer.writeAll("\\\\"),
            '\n' => try writer.writeAll("\\n"),
            '\r' => try writer.writeAll("\\r"),
            '\t' => try writer.writeAll("\\t"),
            else => {
                if (c < 0x20) {
                    try writer.print("\\u{x:0>4}", .{c});
                } else {
                    try writer.writeByte(c);
                }
            },
        }
    }
    try writer.writeByte('"');
}

/// One ring entry as a JSON object. `fields` is already-valid JSON, emitted
/// verbatim. Shape is the console's row contract (feed.ts DiagLine):
///   {"seq":N,"ts":N,"ch":"id","sev":"info","msg":"...","fields":{...},"trunc":0|1}
fn writeEntryJson(writer: anytype, e: *const Entry, ch_id: []const u8) !void {
    try writer.print("{{\"seq\":{d},\"ts\":{d},\"ch\":", .{ e.seq, e.ts_ms });
    try writeJsonString(writer, ch_id);
    try writer.writeAll(",\"sev\":");
    try writeJsonString(writer, e.severity.name());
    try writer.writeAll(",\"msg\":");
    try writeJsonString(writer, e.msg[0..e.msg_len]);
    try writer.writeAll(",\"fields\":");
    if (e.fields_len == 0) {
        try writer.writeAll("{}");
    } else {
        try writer.writeAll(e.fields[0..e.fields_len]);
    }
    const trunc: u8 = if (e.msg_trunc or e.fields_trunc) 1 else 0;
    try writer.print(",\"trunc\":{d}}}", .{trunc});
}

/// Chronological (oldest→newest) JSON array of the last `max_n` ring entries.
/// Used by the console's `__diag_recent` catch-up door on mount. Caller owns
/// the returned slice.
pub fn recentJson(allocator: std.mem.Allocator, max_n: usize) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(allocator);
    try out.append(allocator, '[');

    if (g_inited and g_ring_count > 0) {
        const live: u64 = @min(g_ring_count, RING_SIZE);
        const want: u64 = @min(@as(u64, max_n), live);
        const start: u64 = g_ring_count - want;
        var first = true;
        var i: u64 = start;
        while (i < g_ring_count) : (i += 1) {
            const slot: usize = @intCast(i % RING_SIZE);
            const e = &g_ring[slot];
            const ch = &g_channels[e.ch_idx];
            if (!first) try out.append(allocator, ',');
            first = false;
            var aw: std.Io.Writer.Allocating = .fromArrayList(allocator, &out);
            defer out = aw.toArrayList();
            try writeEntryJson(&aw.writer, e, ch.idSlice());
        }
    }

    try out.append(allocator, ']');
    return out.toOwnedSlice(allocator);
}

/// Per-channel host-side state as a JSON array. Lets the console show which
/// channels the host knows about and how many lines a sampled channel dropped.
///   [{"id":"editor.place","enabled":true,"sampleDiv":4,"emitted":12,"dropped":36}]
pub fn channelsJson(allocator: std.mem.Allocator) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(allocator);
    try out.append(allocator, '[');
    var i: usize = 0;
    while (i < g_channel_count) : (i += 1) {
        const ch = &g_channels[i];
        if (i > 0) try out.append(allocator, ',');
        var aw: std.Io.Writer.Allocating = .fromArrayList(allocator, &out);
        defer out = aw.toArrayList();
        const w = &aw.writer;
        try w.writeAll("{\"id\":");
        try writeJsonString(w, ch.idSlice());
        try w.print(
            ",\"enabled\":{},\"sampleDiv\":{d},\"emitted\":{d},\"dropped\":{d}}}",
            .{ ch.enabled, ch.sample_div, ch.emitted, ch.dropped },
        );
    }
    try out.append(allocator, ']');
    return out.toOwnedSlice(allocator);
}

// Counters for tests / diagnostics.
pub fn ringCount() u64 {
    return g_ring_count;
}
pub fn channelCount() usize {
    return g_channel_count;
}
pub fn droppedFor(id: []const u8) u64 {
    if (findChannel(id)) |idx| return g_channels[idx].dropped;
    return 0;
}
pub fn emittedFor(id: []const u8) u64 {
    if (findChannel(id)) |idx| return g_channels[idx].emitted;
    return 0;
}
