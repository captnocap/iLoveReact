const std = @import("std");

pub const default_capacity: usize = 4096;

/// One click sample. Timestamps are monotonic nanoseconds captured at the
/// important hop boundaries. Later phases overwrite the same slot as the click
/// progresses through the chain.
pub const ClickLatencySample = struct {
    seq: u64 = 0,
    press_ns: u64 = 0,
    dispatch_ns: u64 = 0,
    handler_ns: u64 = 0,
    state_update_ns: u64 = 0,
    flush_ns: u64 = 0,
    apply_done_ns: u64 = 0,

    pub fn isComplete(self: *const ClickLatencySample) bool {
        return self.seq != 0 and self.press_ns != 0 and self.apply_done_ns >= self.press_ns;
    }
};

pub const Percentiles = struct {
    count: usize = 0,
    p50_ns: u64 = 0,
    p95_ns: u64 = 0,
    max_ns: u64 = 0,
};

pub const ClickLatencyRing = struct {
    samples: [default_capacity]ClickLatencySample = [_]ClickLatencySample{.{}} ** default_capacity,
    head: usize = 0,
    len: usize = 0,
    next_seq: u64 = 1,

    pub fn nowNs() u64 {
        return @intCast(std.time.nanoTimestamp());
    }

    fn slotForSeq(self: *ClickLatencyRing, seq: u64) ?*ClickLatencySample {
        if (seq == 0) return null;
        const idx: usize = @intCast((seq - 1) % @as(u64, default_capacity));
        const slot = &self.samples[idx];
        if (slot.seq != seq) return null;
        return slot;
    }

    /// Reserve a slot for a click, stamp the press edge, and return a stable
    /// sequence handle. The host uses this handle to stamp later hops.
    pub fn beginClick(self: *ClickLatencyRing) u64 {
        const seq = self.next_seq;
        const slot = &self.samples[@intCast((seq - 1) % @as(u64, default_capacity))];
        self.head = (self.head + 1) % default_capacity;
        if (self.len < default_capacity) self.len += 1;

        slot.* = .{
            .seq = seq,
            .press_ns = ClickLatencyRing.nowNs(),
        };
        self.next_seq += 1;
        return seq;
    }

    fn reverseIndex(self: *const ClickLatencyRing, newer_index: usize) usize {
        return (self.head + default_capacity - 1 - newer_index) % default_capacity;
    }

    pub fn latest(self: *const ClickLatencyRing, newer_index: usize) ?*const ClickLatencySample {
        if (newer_index >= self.len) return null;
        return &self.samples[self.reverseIndex(newer_index)];
    }

    pub fn stampDispatch(self: *ClickLatencyRing, seq: u64) bool {
        const sample = self.slotForSeq(seq) orelse return false;
        sample.dispatch_ns = ClickLatencyRing.nowNs();
        return true;
    }

    pub fn stampHandler(self: *ClickLatencyRing, seq: u64) bool {
        const sample = self.slotForSeq(seq) orelse return false;
        sample.handler_ns = ClickLatencyRing.nowNs();
        return true;
    }

    pub fn stampStateUpdate(self: *ClickLatencyRing, seq: u64) bool {
        const sample = self.slotForSeq(seq) orelse return false;
        sample.state_update_ns = ClickLatencyRing.nowNs();
        return true;
    }

    pub fn stampFlush(self: *ClickLatencyRing, seq: u64) bool {
        const sample = self.slotForSeq(seq) orelse return false;
        sample.flush_ns = ClickLatencyRing.nowNs();
        return true;
    }

    pub fn stampApplyDone(self: *ClickLatencyRing, seq: u64) bool {
        const sample = self.slotForSeq(seq) orelse return false;
        sample.apply_done_ns = ClickLatencyRing.nowNs();
        return true;
    }

    fn durationNs(sample: *const ClickLatencySample, stage: Stage) ?u64 {
        if (!sample.isComplete()) return null;
        return switch (stage) {
            .press_to_dispatch => if (sample.dispatch_ns >= sample.press_ns and sample.dispatch_ns != 0)
                sample.dispatch_ns - sample.press_ns
            else
                null,
            .dispatch_to_handler => if (sample.handler_ns >= sample.dispatch_ns and sample.dispatch_ns != 0 and sample.handler_ns != 0)
                sample.handler_ns - sample.dispatch_ns
            else
                null,
            .handler_to_state_update => if (sample.state_update_ns >= sample.handler_ns and sample.handler_ns != 0 and sample.state_update_ns != 0)
                sample.state_update_ns - sample.handler_ns
            else
                null,
            .state_update_to_flush => if (sample.flush_ns >= sample.state_update_ns and sample.state_update_ns != 0 and sample.flush_ns != 0)
                sample.flush_ns - sample.state_update_ns
            else
                null,
            .flush_to_apply => if (sample.apply_done_ns >= sample.flush_ns and sample.flush_ns != 0 and sample.apply_done_ns != 0)
                sample.apply_done_ns - sample.flush_ns
            else
                null,
            .total => if (sample.apply_done_ns >= sample.press_ns and sample.apply_done_ns != 0)
                sample.apply_done_ns - sample.press_ns
            else
                null,
        };
    }

    fn sortAscending(values: []u64) void {
        var i: usize = 1;
        while (i < values.len) : (i += 1) {
            const key = values[i];
            var j = i;
            while (j > 0 and values[j - 1] > key) : (j -= 1) {
                values[j] = values[j - 1];
            }
            values[j] = key;
        }
    }

    fn percentile(sorted: []const u64, pct: u64) u64 {
        if (sorted.len == 0) return 0;
        const scaled = (sorted.len * pct + 99) / 100;
        const idx = if (scaled == 0) 0 else @min(sorted.len - 1, scaled - 1);
        return sorted[idx];
    }

    fn summarize(values: []u64) Percentiles {
        if (values.len == 0) return .{};
        sortAscending(values);
        return .{
            .count = values.len,
            .p50_ns = percentile(values, 50),
            .p95_ns = percentile(values, 95),
            .max_ns = values[values.len - 1],
        };
    }

    pub const Stage = enum {
        press_to_dispatch,
        dispatch_to_handler,
        handler_to_state_update,
        state_update_to_flush,
        flush_to_apply,
        total,
    };

    pub fn summarizeRecent(self: *const ClickLatencyRing, stage: Stage, last_n: usize, scratch: []u64) Percentiles {
        var out_len: usize = 0;
        const limit = @min(@min(last_n, self.len), scratch.len);
        var i: usize = 0;
        while (i < limit) : (i += 1) {
            const sample = self.latest(i) orelse break;
            if (durationNs(sample, stage)) |dur| {
                scratch[out_len] = dur;
                out_len += 1;
            }
        }
        return summarize(scratch[0..out_len]);
    }

    pub fn dumpRecent(self: *const ClickLatencyRing, writer: anytype, last_n: usize) !void {
        var scratch: [default_capacity]u64 = undefined;
        const stages = [_]struct {
            label: []const u8,
            stage: Stage,
        }{
            .{ .label = "press->dispatch", .stage = .press_to_dispatch },
            .{ .label = "dispatch->handler", .stage = .dispatch_to_handler },
            .{ .label = "handler->state", .stage = .handler_to_state_update },
            .{ .label = "state->flush", .stage = .state_update_to_flush },
            .{ .label = "flush->apply", .stage = .flush_to_apply },
            .{ .label = "total", .stage = .total },
        };

        try writer.print("click-latency last {d} samples (completed only)\n", .{last_n});
        try writer.print("{s:>18}  {s:>12}  {s:>12}  {s:>12}  {s:>8}\n", .{ "stage", "p50(ns)", "p95(ns)", "max(ns)", "count" });

        for (stages) |item| {
            const stats = self.summarizeRecent(item.stage, last_n, scratch[0..]);
            try writer.print("{s:>18}  {d:>12}  {d:>12}  {d:>12}  {d:>8}\n", .{
                item.label,
                stats.p50_ns,
                stats.p95_ns,
                stats.max_ns,
                stats.count,
            });
        }
    }
};
