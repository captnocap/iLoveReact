//! RJAN v1 — the durable, role-addressed motion document (req_4285).
//!
//! One format for every motion source: hand-authored keyframes, migrated
//! built-in clips, and recorded capture takes. A document is a set of KEYS
//! (role-addressed poses at declared times, partial coverage first-class) plus
//! DENSE RUNS (dictated frame ranges — capture's native tongue). Sparse where
//! an author was sparse, dense where a take was dense; V6's "RLE'd, relational
//! animation data" landing.
//!
//! Channel values are BIND-RELATIVE ROTATION DELTAS addressed by semantic role
//! wire id (the canonical retarget names — see humanoid_clips.CHANNEL_IDS and
//! character_assets.retargetBoneIds). A body answers to a channel exactly when
//! its rig bound that role; rebasing onto a target is
//! `normalize(target_bind_local * delta)`, the same transport `sampleForBind`
//! always applied. Root translation is the one non-rotation channel. Documents
//! never clamp: the constraint clamp lives downstream in rig_pose.evaluate,
//! so an in-between can never bend a joint past its authored range.
//!
//! Fixed header (little-endian):
//!   0  magic[4] "RJAN"       4  version:u16          6  headerBytes:u16
//!   8  flags:u32 (bit0 loop) 12  durationSeconds:f32 16  channelCount:u16
//!  18  keyCount:u16         20  runCount:u16         22  sourceKind:u8
//!  23  reserved:u8          24  nameBytes:u16        26  reserved:u16
//!  28  totalRunFrames:u32   32  reserved[8]
//! Body: name bytes, then `{u16 len, UTF-8}` channel ids, then keys, then runs.
//! The artifact hash is SHA-256 of the encoded bytes and lives with the
//! referencing manifest, never inside the artifact (the RJSK/RJMD law).

const std = @import("std");
pub const fk = @import("fk_pose.zig");

pub const Vec3 = fk.Vec3;
pub const Quat = fk.Quat;

pub const MAGIC = "RJAN";
pub const VERSION: u16 = 1;
pub const HEADER_BYTES: usize = 40;
pub const MAX_CHANNELS: usize = 32;
pub const MAX_NAME_BYTES: usize = 255;
pub const MAX_KEYS: usize = std.math.maxInt(u16);
pub const MAX_RUNS: usize = std.math.maxInt(u16);
pub const MAX_RUN_FRAMES: usize = 1 << 20;

const FLAG_LOOPING: u32 = 1;
const KEY_FLAG_ROOT: u32 = 1;
const RUN_FLAG_ROOT: u32 = 1;

pub const SourceKind = enum(u8) {
    hand = 0,
    capture = 1,
    clip_migration = 2,
};

/// Fill-in policy for the transition OUT of a key. Runs always interpolate
/// linearly between their own frames. Per-role easing needs no format feature:
/// partial keys per role already carry their own easing.
pub const Easing = enum(u8) {
    slerp = 0,
    smooth = 1,
    hold = 2,
};

pub const Error = std.mem.Allocator.Error || fk.Error || error{
    BadMagic,
    UnsupportedVersion,
    BadHeader,
    Truncated,
    TrailingBytes,
    SizeOverflow,
    InvalidName,
    InvalidChannelCount,
    InvalidChannelId,
    DuplicateChannelId,
    InvalidDuration,
    InvalidTime,
    InvalidCoverage,
    InvalidEasing,
    InvalidSourceKind,
    KeysOutOfOrder,
    DuplicateChannelKey,
    InvalidRunFrames,
    RunTimesNotIncreasing,
    OverlappingRuns,
    KeyInsideRun,
    EmptyDocument,
    InvalidSampleTime,
};

/// One authored key: a partial pose at a declared time. `coverage` selects the
/// document channels this key speaks for ("I only pose the left arm and the
/// rest is not my problem"); `deltas` holds one bind-relative rotation per set
/// coverage bit, ascending. `planted` is a ground-contact annotation for the
/// later contact/IK layer — recorded now, solved never (under this req).
pub const Key = struct {
    time_seconds: f32,
    coverage: u32,
    planted: u32 = 0,
    easing: Easing = .slerp,
    root_translation: ?Vec3 = null,
    deltas: []const Quat,
};

/// One dictated dense range — a capture take or an author digging all the way
/// in. Frame times are REAL elapsed offsets from `start_seconds` (strictly
/// increasing, first exactly 0): capture jitter is preserved, never resampled
/// away. `deltas` is frame-major: frame f's rotations occupy
/// `deltas[f*channels .. (f+1)*channels]` in ascending coverage-bit order.
pub const Run = struct {
    start_seconds: f32,
    coverage: u32,
    times: []const f32,
    root_translations: ?[]const Vec3 = null,
    deltas: []const Quat,

    pub fn frameCount(self: *const Run) usize {
        return self.times.len;
    }

    pub fn channelCount(self: *const Run) usize {
        return @popCount(self.coverage);
    }

    pub fn endSeconds(self: *const Run) f32 {
        return self.start_seconds + self.times[self.times.len - 1];
    }
};

pub const Document = struct {
    allocator: std.mem.Allocator,
    name: []const u8,
    looping: bool,
    duration_seconds: f32,
    source: SourceKind,
    channel_ids: []const []const u8,
    /// Sorted by time (ties allowed across disjoint channels).
    keys: []const Key,
    /// Sorted by start; per-channel non-overlapping.
    runs: []const Run,

    pub fn deinit(self: *Document) void {
        const allocator = self.allocator;
        allocator.free(self.name);
        for (self.channel_ids) |id| allocator.free(id);
        allocator.free(self.channel_ids);
        for (self.keys) |key| allocator.free(key.deltas);
        allocator.free(self.keys);
        for (self.runs) |run| {
            allocator.free(run.times);
            if (run.root_translations) |roots| allocator.free(roots);
            allocator.free(run.deltas);
        }
        allocator.free(self.runs);
        self.* = undefined;
    }

    pub fn channelIndex(self: *const Document, channel_id: []const u8) ?u5 {
        for (self.channel_ids, 0..) |id, index| {
            if (std.mem.eql(u8, id, channel_id)) return @intCast(index);
        }
        return null;
    }
};

/// A document evaluated at one instant: per-channel bind-relative deltas for
/// every channel the document speaks for at that time. Channels outside
/// `coverage` are the consumer's business (ride a lower layer, or the bind).
pub const Sample = struct {
    coverage: u32 = 0,
    has_root: bool = false,
    root_translation: Vec3 = .{ 0, 0, 0 },
    deltas: [MAX_CHANNELS]Quat = @splat(fk.IDENTITY_QUAT),
};

// ── validation ────────────────────────────────────────────────────────────────

fn validChannelIds(channel_ids: []const []const u8) Error!void {
    if (channel_ids.len == 0 or channel_ids.len > MAX_CHANNELS) return error.InvalidChannelCount;
    for (channel_ids, 0..) |id, index| {
        if (id.len == 0 or id.len > std.math.maxInt(u16) or !std.unicode.utf8ValidateSlice(id)) {
            return error.InvalidChannelId;
        }
        for (channel_ids[0..index]) |prior| {
            if (std.mem.eql(u8, prior, id)) return error.DuplicateChannelId;
        }
    }
}

fn coverageValid(coverage: u32, channel_count: usize) bool {
    if (coverage == 0) return false;
    const usable: u32 = if (channel_count >= 32)
        std.math.maxInt(u32)
    else
        (@as(u32, 1) << @intCast(channel_count)) - 1;
    return (coverage & ~usable) == 0;
}

fn finiteTime(seconds: f32) bool {
    return std.math.isFinite(seconds) and seconds >= 0;
}

/// Every structural invariant of a document, enforced identically on authored
/// values and decoded bytes: coverage within the channel table, keys sorted,
/// at most one event per channel per instant, run times strictly increasing
/// from zero, runs per-channel non-overlapping, no key strictly inside a run
/// that speaks the same channel (a dictated range owns its interior; the
/// system blends at its edges).
pub fn validate(document: *const Document) Error!void {
    if (document.name.len > MAX_NAME_BYTES or !std.unicode.utf8ValidateSlice(document.name)) {
        return error.InvalidName;
    }
    try validChannelIds(document.channel_ids);
    if (!std.math.isFinite(document.duration_seconds) or document.duration_seconds <= 0) {
        return error.InvalidDuration;
    }
    if (document.keys.len == 0 and document.runs.len == 0) return error.EmptyDocument;
    if (document.keys.len > MAX_KEYS) return error.SizeOverflow;
    if (document.runs.len > MAX_RUNS) return error.SizeOverflow;

    var previous_time: f32 = 0;
    for (document.keys, 0..) |key, index| {
        if (!finiteTime(key.time_seconds) or key.time_seconds > document.duration_seconds) {
            return error.InvalidTime;
        }
        if (index > 0 and key.time_seconds < previous_time) return error.KeysOutOfOrder;
        previous_time = key.time_seconds;
        if (!coverageValid(key.coverage, document.channel_ids.len)) return error.InvalidCoverage;
        if ((key.planted & ~key.coverage) != 0) return error.InvalidCoverage;
        if (key.deltas.len != @popCount(key.coverage)) return error.InvalidCoverage;
        for (key.deltas) |delta| _ = try fk.normalizeQuat(delta);
        if (key.root_translation) |root| if (!fk.finiteVec3(root)) return error.InvalidTime;
        // Keys are sorted, so same-instant keys are adjacent; two keys may
        // share an instant only across disjoint channels (partial keys).
        var back = index;
        while (back > 0) {
            back -= 1;
            const prior = document.keys[back];
            if (prior.time_seconds != key.time_seconds) break;
            if ((prior.coverage & key.coverage) != 0) return error.DuplicateChannelKey;
        }
    }

    var total_frames: usize = 0;
    for (document.runs, 0..) |run, index| {
        if (!finiteTime(run.start_seconds)) return error.InvalidTime;
        if (!coverageValid(run.coverage, document.channel_ids.len)) return error.InvalidCoverage;
        const frames = run.times.len;
        if (frames < 2 or frames > MAX_RUN_FRAMES) return error.InvalidRunFrames;
        total_frames += frames;
        if (run.times[0] != 0) return error.RunTimesNotIncreasing;
        for (run.times[1..], run.times[0 .. frames - 1]) |later, earlier| {
            if (!std.math.isFinite(later) or later <= earlier) return error.RunTimesNotIncreasing;
        }
        if (run.endSeconds() > document.duration_seconds) return error.InvalidTime;
        if (run.deltas.len != frames * run.channelCount()) return error.InvalidRunFrames;
        for (run.deltas) |delta| _ = try fk.normalizeQuat(delta);
        if (run.root_translations) |roots| {
            if (roots.len != frames) return error.InvalidRunFrames;
            for (roots) |root| if (!fk.finiteVec3(root)) return error.InvalidTime;
        }
        if (index > 0 and run.start_seconds < document.runs[index - 1].start_seconds) {
            return error.OverlappingRuns;
        }
        for (document.runs[0..index]) |prior| {
            if ((prior.coverage & run.coverage) == 0) continue;
            if (run.start_seconds < prior.endSeconds() and prior.start_seconds < run.endSeconds()) {
                return error.OverlappingRuns;
            }
        }
    }
    if (total_frames > MAX_RUN_FRAMES) return error.SizeOverflow;

    for (document.keys) |key| {
        for (document.runs) |run| {
            if ((key.coverage & run.coverage) == 0) continue;
            if (key.time_seconds > run.start_seconds and key.time_seconds < run.endSeconds()) {
                return error.KeyInsideRun;
            }
        }
    }
}

// ── encode ────────────────────────────────────────────────────────────────────

fn writeU16(bytes: []u8, at: usize, value: u16) void {
    std.mem.writeInt(u16, bytes[at..][0..2], value, .little);
}

fn writeU32(bytes: []u8, at: usize, value: u32) void {
    std.mem.writeInt(u32, bytes[at..][0..4], value, .little);
}

fn writeF32(bytes: []u8, at: usize, value: f32) void {
    std.mem.writeInt(u32, bytes[at..][0..4], @bitCast(value), .little);
}

fn readU16(bytes: []const u8, at: usize) u16 {
    return std.mem.readInt(u16, bytes[at..][0..2], .little);
}

fn readU32(bytes: []const u8, at: usize) u32 {
    return std.mem.readInt(u32, bytes[at..][0..4], .little);
}

fn readF32(bytes: []const u8, at: usize) f32 {
    return @bitCast(std.mem.readInt(u32, bytes[at..][0..4], .little));
}

const KEY_FIXED_BYTES: usize = 4 + 4 + 4 + 4; // time, coverage, planted+easing packed, flags
const RUN_FIXED_BYTES: usize = 4 + 4 + 4 + 4; // start, coverage, flags, frameCount
const QUAT_BYTES: usize = 16;
const VEC3_BYTES: usize = 12;

fn encodedSize(document: *const Document) Error!usize {
    var total: usize = HEADER_BYTES + document.name.len;
    for (document.channel_ids) |id| total += 2 + id.len;
    for (document.keys) |key| {
        total += KEY_FIXED_BYTES + key.deltas.len * QUAT_BYTES;
        if (key.root_translation != null) total += VEC3_BYTES;
    }
    for (document.runs) |run| {
        total += RUN_FIXED_BYTES + run.times.len * 4 + run.deltas.len * QUAT_BYTES;
        if (run.root_translations) |roots| total += roots.len * VEC3_BYTES;
    }
    return total;
}

pub fn encodeAlloc(allocator: std.mem.Allocator, document: *const Document) Error![]u8 {
    try validate(document);
    const bytes = try allocator.alloc(u8, try encodedSize(document));
    errdefer allocator.free(bytes);
    @memset(bytes, 0);
    @memcpy(bytes[0..4], MAGIC);
    writeU16(bytes, 4, VERSION);
    writeU16(bytes, 6, @intCast(HEADER_BYTES));
    writeU32(bytes, 8, if (document.looping) FLAG_LOOPING else 0);
    writeF32(bytes, 12, document.duration_seconds);
    writeU16(bytes, 16, @intCast(document.channel_ids.len));
    writeU16(bytes, 18, @intCast(document.keys.len));
    writeU16(bytes, 20, @intCast(document.runs.len));
    bytes[22] = @intFromEnum(document.source);
    writeU16(bytes, 24, @intCast(document.name.len));
    var total_frames: u32 = 0;
    for (document.runs) |run| total_frames += @intCast(run.times.len);
    writeU32(bytes, 28, total_frames);

    var at: usize = HEADER_BYTES;
    @memcpy(bytes[at .. at + document.name.len], document.name);
    at += document.name.len;
    for (document.channel_ids) |id| {
        writeU16(bytes, at, @intCast(id.len));
        at += 2;
        @memcpy(bytes[at .. at + id.len], id);
        at += id.len;
    }
    for (document.keys) |key| {
        writeF32(bytes, at, key.time_seconds);
        writeU32(bytes, at + 4, key.coverage);
        writeU32(bytes, at + 8, key.planted);
        var key_flags: u32 = @intFromEnum(key.easing);
        if (key.root_translation != null) key_flags |= KEY_FLAG_ROOT << 8;
        writeU32(bytes, at + 12, key_flags);
        at += KEY_FIXED_BYTES;
        if (key.root_translation) |root| {
            for (root, 0..) |component, axis| writeF32(bytes, at + axis * 4, component);
            at += VEC3_BYTES;
        }
        for (key.deltas) |delta| {
            for (delta, 0..) |component, lane| writeF32(bytes, at + lane * 4, component);
            at += QUAT_BYTES;
        }
    }
    for (document.runs) |run| {
        writeF32(bytes, at, run.start_seconds);
        writeU32(bytes, at + 4, run.coverage);
        writeU32(bytes, at + 8, if (run.root_translations != null) RUN_FLAG_ROOT else 0);
        writeU32(bytes, at + 12, @intCast(run.times.len));
        at += RUN_FIXED_BYTES;
        for (run.times) |time| {
            writeF32(bytes, at, time);
            at += 4;
        }
        if (run.root_translations) |roots| for (roots) |root| {
            for (root, 0..) |component, axis| writeF32(bytes, at + axis * 4, component);
            at += VEC3_BYTES;
        };
        for (run.deltas) |delta| {
            for (delta, 0..) |component, lane| writeF32(bytes, at + lane * 4, component);
            at += QUAT_BYTES;
        }
    }
    std.debug.assert(at == bytes.len);
    return bytes;
}

// ── decode ────────────────────────────────────────────────────────────────────

const Cursor = struct {
    bytes: []const u8,
    at: usize = 0,

    fn take(self: *Cursor, count: usize) Error![]const u8 {
        if (self.at + count > self.bytes.len) return error.Truncated;
        const slice = self.bytes[self.at .. self.at + count];
        self.at += count;
        return slice;
    }

    fn takeU16(self: *Cursor) Error!u16 {
        return readU16(try self.take(2), 0);
    }

    fn takeU32(self: *Cursor) Error!u32 {
        return readU32(try self.take(4), 0);
    }

    fn takeF32(self: *Cursor) Error!f32 {
        return readF32(try self.take(4), 0);
    }

    fn takeVec3(self: *Cursor) Error!Vec3 {
        const raw = try self.take(VEC3_BYTES);
        return .{ readF32(raw, 0), readF32(raw, 4), readF32(raw, 8) };
    }

    fn takeQuat(self: *Cursor) Error!Quat {
        const raw = try self.take(QUAT_BYTES);
        return .{ readF32(raw, 0), readF32(raw, 4), readF32(raw, 8), readF32(raw, 12) };
    }
};

pub fn decodeAlloc(allocator: std.mem.Allocator, bytes: []const u8) Error!Document {
    if (bytes.len < HEADER_BYTES) return error.Truncated;
    if (!std.mem.eql(u8, bytes[0..4], MAGIC)) return error.BadMagic;
    if (readU16(bytes, 4) != VERSION) return error.UnsupportedVersion;
    if (readU16(bytes, 6) != HEADER_BYTES) return error.BadHeader;
    const flags = readU32(bytes, 8);
    if ((flags & ~FLAG_LOOPING) != 0) return error.BadHeader;
    const duration = readF32(bytes, 12);
    const channel_count = readU16(bytes, 16);
    const key_count = readU16(bytes, 18);
    const run_count = readU16(bytes, 20);
    const source: SourceKind = switch (bytes[22]) {
        0 => .hand,
        1 => .capture,
        2 => .clip_migration,
        else => return error.InvalidSourceKind,
    };
    const name_bytes = readU16(bytes, 24);
    if (name_bytes > MAX_NAME_BYTES) return error.InvalidName;

    var cursor = Cursor{ .bytes = bytes, .at = HEADER_BYTES };
    const name = try allocator.dupe(u8, try cursor.take(name_bytes));
    errdefer allocator.free(name);

    var channel_ids = try std.ArrayList([]const u8).initCapacity(allocator, channel_count);
    errdefer {
        for (channel_ids.items) |id| allocator.free(id);
        channel_ids.deinit(allocator);
    }
    for (0..channel_count) |_| {
        const id_len = try cursor.takeU16();
        const id = try allocator.dupe(u8, try cursor.take(id_len));
        errdefer allocator.free(id);
        channel_ids.appendAssumeCapacity(id);
    }

    var keys = try std.ArrayList(Key).initCapacity(allocator, key_count);
    errdefer {
        for (keys.items) |key| allocator.free(key.deltas);
        keys.deinit(allocator);
    }
    for (0..key_count) |_| {
        const time_seconds = try cursor.takeF32();
        const coverage = try cursor.takeU32();
        const planted = try cursor.takeU32();
        const key_flags = try cursor.takeU32();
        const easing: Easing = switch (key_flags & 0xff) {
            0 => .slerp,
            1 => .smooth,
            2 => .hold,
            else => return error.InvalidEasing,
        };
        if ((key_flags & ~(@as(u32, 0xff) | (KEY_FLAG_ROOT << 8))) != 0) return error.BadHeader;
        const has_root = (key_flags & (KEY_FLAG_ROOT << 8)) != 0;
        const root: ?Vec3 = if (has_root) try cursor.takeVec3() else null;
        if (!coverageValid(coverage, channel_count)) return error.InvalidCoverage;
        const deltas = try allocator.alloc(Quat, @popCount(coverage));
        errdefer allocator.free(deltas);
        for (deltas) |*delta| delta.* = try cursor.takeQuat();
        keys.appendAssumeCapacity(.{
            .time_seconds = time_seconds,
            .coverage = coverage,
            .planted = planted,
            .easing = easing,
            .root_translation = root,
            .deltas = deltas,
        });
    }

    var runs = try std.ArrayList(Run).initCapacity(allocator, run_count);
    errdefer {
        for (runs.items) |run| {
            allocator.free(run.times);
            if (run.root_translations) |roots| allocator.free(roots);
            allocator.free(run.deltas);
        }
        runs.deinit(allocator);
    }
    for (0..run_count) |_| {
        const start_seconds = try cursor.takeF32();
        const coverage = try cursor.takeU32();
        const run_flags = try cursor.takeU32();
        if ((run_flags & ~RUN_FLAG_ROOT) != 0) return error.BadHeader;
        const frame_count = try cursor.takeU32();
        if (frame_count < 2 or frame_count > MAX_RUN_FRAMES) return error.InvalidRunFrames;
        if (!coverageValid(coverage, channel_count)) return error.InvalidCoverage;
        const times = try allocator.alloc(f32, frame_count);
        errdefer allocator.free(times);
        for (times) |*time| time.* = try cursor.takeF32();
        var roots: ?[]Vec3 = null;
        errdefer if (roots) |owned| allocator.free(owned);
        if ((run_flags & RUN_FLAG_ROOT) != 0) {
            const owned = try allocator.alloc(Vec3, frame_count);
            for (owned) |*root| root.* = try cursor.takeVec3();
            roots = owned;
        }
        const deltas = try allocator.alloc(Quat, frame_count * @popCount(coverage));
        errdefer allocator.free(deltas);
        for (deltas) |*delta| delta.* = try cursor.takeQuat();
        runs.appendAssumeCapacity(.{
            .start_seconds = start_seconds,
            .coverage = coverage,
            .times = times,
            .root_translations = roots,
            .deltas = deltas,
        });
    }
    if (cursor.at != bytes.len) return error.TrailingBytes;

    var document = Document{
        .allocator = allocator,
        .name = name,
        .looping = (flags & FLAG_LOOPING) != 0,
        .duration_seconds = duration,
        .source = source,
        .channel_ids = try channel_ids.toOwnedSlice(allocator),
        .keys = try keys.toOwnedSlice(allocator),
        .runs = try runs.toOwnedSlice(allocator),
    };
    errdefer document.deinit();
    try validate(&document);
    return document;
}

// ── sampling ──────────────────────────────────────────────────────────────────

const Event = struct {
    time: f32,
    delta: Quat,
    root: ?Vec3,
    easing: Easing,
};

fn keyChannelDelta(key: *const Key, channel: u5) ?Quat {
    const bit = @as(u32, 1) << channel;
    if ((key.coverage & bit) == 0) return null;
    const before = key.coverage & (bit - 1);
    return key.deltas[@popCount(before)];
}

fn runChannelDelta(run: *const Run, frame: usize, channel: u5) ?Quat {
    const bit = @as(u32, 1) << channel;
    if ((run.coverage & bit) == 0) return null;
    const before = run.coverage & (bit - 1);
    return run.deltas[frame * run.channelCount() + @popCount(before)];
}

fn runEvent(run: *const Run, frame: usize, channel: u5) Event {
    return .{
        .time = run.start_seconds + run.times[frame],
        .delta = runChannelDelta(run, frame, channel) orelse fk.IDENTITY_QUAT,
        .root = if (run.root_translations) |roots| roots[frame] else null,
        .easing = .slerp,
    };
}

const Bracket = struct {
    previous: ?Event = null,
    next: ?Event = null,

    fn offerPrevious(self: *Bracket, event: Event) void {
        if (self.previous == null or event.time >= self.previous.?.time) self.previous = event;
    }

    fn offerNext(self: *Bracket, event: Event) void {
        if (self.next == null or event.time < self.next.?.time) self.next = event;
    }
};

/// events for `channel` at document time `seconds`, root-only when
/// `channel` is null. Runs contribute their bracketing frames; a time inside
/// a run therefore interpolates the dictated frames and a time near an edge
/// blends the run boundary against the adjacent authored key.
fn bracketChannel(document: *const Document, channel: ?u5, seconds: f32) Bracket {
    var bracket = Bracket{};
    for (document.keys) |*key| {
        if (channel) |lane| {
            if (keyChannelDelta(key, lane) == null) continue;
        } else if (key.root_translation == null) continue;
        const event = Event{
            .time = key.time_seconds,
            .delta = if (channel) |lane| keyChannelDelta(key, lane).? else fk.IDENTITY_QUAT,
            .root = key.root_translation,
            .easing = key.easing,
        };
        if (key.time_seconds <= seconds) bracket.offerPrevious(event) else bracket.offerNext(event);
    }
    for (document.runs) |*run| {
        if (channel) |lane| {
            const bit = @as(u32, 1) << lane;
            if ((run.coverage & bit) == 0) continue;
        } else if (run.root_translations == null) continue;
        const frames = run.frameCount();
        if (seconds < run.start_seconds) {
            bracket.offerNext(runEvent(run, 0, channel orelse 0));
            continue;
        }
        if (seconds >= run.endSeconds()) {
            bracket.offerPrevious(runEvent(run, frames - 1, channel orelse 0));
            continue;
        }
        const offset = seconds - run.start_seconds;
        var low: usize = 0;
        var high: usize = frames - 1;
        while (low + 1 < high) {
            const mid = (low + high) / 2;
            if (run.times[mid] <= offset) low = mid else high = mid;
        }
        bracket.offerPrevious(runEvent(run, low, channel orelse 0));
        bracket.offerNext(runEvent(run, high, channel orelse 0));
    }
    return bracket;
}

fn easedAlpha(easing: Easing, alpha_raw: f32) f32 {
    const alpha = std.math.clamp(alpha_raw, 0, 1);
    return switch (easing) {
        .slerp => alpha,
        .smooth => alpha * alpha * (3 - 2 * alpha),
        .hold => 0,
    };
}

fn interpolate(previous: Event, next: Event, seconds: f32) Error!Event {
    const span = next.time - previous.time;
    if (span <= 0) return previous;
    const alpha = easedAlpha(previous.easing, (seconds - previous.time) / span);
    var out = previous;
    out.time = seconds;
    out.delta = try fk.slerpQuat(previous.delta, next.delta, alpha);
    if (previous.root != null and next.root != null) {
        const from = previous.root.?;
        const to = next.root.?;
        out.root = .{
            from[0] + (to[0] - from[0]) * alpha,
            from[1] + (to[1] - from[1]) * alpha,
            from[2] + (to[2] - from[2]) * alpha,
        };
    }
    return out;
}

fn resolveBracket(bracket: Bracket, document: *const Document, channel: ?u5, seconds: f32) Error!?Event {
    if (bracket.previous) |previous| {
        if (bracket.next) |next| return try interpolate(previous, next, seconds);
        if (document.looping) {
            // Wrap: the first covered event re-approaches through the seam.
            const wrapped = bracketChannel(document, channel, -1);
            if (wrapped.next) |first| {
                var shifted = first;
                shifted.time += document.duration_seconds;
                return try interpolate(previous, shifted, seconds);
            }
        }
        return previous;
    }
    if (bracket.next) |next| {
        if (document.looping) {
            const wrapped = bracketChannel(document, channel, document.duration_seconds + 1);
            if (wrapped.previous) |last| {
                var shifted = last;
                shifted.time -= document.duration_seconds;
                return try interpolate(shifted, next, seconds);
            }
        }
        return next;
    }
    return null;
}

/// Evaluate the document at one instant. Looping documents wrap; non-looping
/// documents clamp (hold-first before the first event, hold-last after the
/// last). Channels covered nowhere in the document are absent from the sample.
pub fn sample(document: *const Document, seconds_raw: f32) Error!Sample {
    if (!std.math.isFinite(seconds_raw)) return error.InvalidSampleTime;
    const duration = document.duration_seconds;
    if (!std.math.isFinite(duration) or duration <= 0) return error.InvalidDuration;
    const seconds = if (document.looping)
        seconds_raw - @floor(seconds_raw / duration) * duration
    else
        std.math.clamp(seconds_raw, 0, duration);

    var out = Sample{};
    for (document.channel_ids, 0..) |_, index| {
        const channel: u5 = @intCast(index);
        const bracket = bracketChannel(document, channel, seconds);
        const resolved = try resolveBracket(bracket, document, channel, seconds) orelse continue;
        out.coverage |= @as(u32, 1) << channel;
        out.deltas[channel] = try fk.normalizeQuat(resolved.delta);
    }
    const root_bracket = bracketChannel(document, null, seconds);
    if (try resolveBracket(root_bracket, document, null, seconds)) |resolved| {
        if (resolved.root) |root| {
            out.has_root = true;
            out.root_translation = root;
        }
    }
    return out;
}
