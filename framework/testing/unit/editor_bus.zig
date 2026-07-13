//! Unit proof for framework/events/editor_bus.zig — the authoring eventbus spine.
//!
//! Run: zig build test-editor-bus
//!
//! Exercises the three contract guarantees the runtime/editorbus door depends on:
//!   1. append() stamps a STRICTLY MONOTONIC authoritative seq (1, 2, 3, …),
//!      overwriting whatever SEQ_PENDING the client sent.
//!   2. head() tracks the highest committed seq (0 when empty).
//!   3. since(afterSeq) round-trips: returns exactly the confirmed envelopes with
//!      seq > afterSeq, oldest-first, each carrying its stamped seq.
//!
//! Ring-only (in-memory) so the test never touches the user's real db.

const std = @import("std");
const testing = std.testing;
const bus = @import("../../events/editor_bus.zig");

fn envelope(kind: []const u8) []const u8 {
    // A client envelope as bus.ts/event.ts builds it: seq = SEQ_PENDING (-1),
    // the authority replaces it on append.
    return std.fmt.allocPrint(
        testing.allocator,
        "{{\"seq\":-1,\"origin\":\"local\",\"ts\":1234,\"type\":\"{s}\",\"targets\":[],\"payload\":{{}}}}",
        .{kind},
    ) catch unreachable;
}

/// Count top-level array elements by counting envelope objects (`{` at depth 1).
fn countEvents(json: []const u8) usize {
    var depth: usize = 0;
    var n: usize = 0;
    for (json) |c| {
        switch (c) {
            '{' => {
                if (depth == 0) n += 1;
                depth += 1;
            },
            '}' => depth -= 1,
            else => {},
        }
    }
    return n;
}

test "seq is monotonic and head tracks it" {
    bus.initInMemoryForTest();
    defer bus.deinit();

    try testing.expectEqual(@as(i64, 0), bus.head());

    var i: usize = 0;
    var expected_seq: i64 = 1;
    while (i < 5) : (i += 1) {
        const env = envelope("piece.place");
        defer testing.allocator.free(env);
        const seq = bus.append(env);
        try testing.expectEqual(expected_seq, seq);
        try testing.expectEqual(expected_seq, bus.head());
        expected_seq += 1;
    }
}

test "since round-trips confirmed events after a given seq" {
    bus.initInMemoryForTest();
    defer bus.deinit();

    // Append three events: seqs 1, 2, 3.
    inline for (.{ "a.one", "b.two", "c.three" }) |kind| {
        const env = envelope(kind);
        defer testing.allocator.free(env);
        _ = bus.append(env);
    }

    // since(0) → all three.
    {
        const all = try bus.since(testing.allocator, 0);
        defer testing.allocator.free(all);
        try testing.expectEqual(@as(usize, 3), countEvents(all));
        // The authoritative seq was stamped into the persisted envelope.
        try testing.expect(std.mem.indexOf(u8, all, "\"seq\":1") != null);
        try testing.expect(std.mem.indexOf(u8, all, "\"seq\":3") != null);
        // The SEQ_PENDING the client sent must NOT survive.
        try testing.expect(std.mem.indexOf(u8, all, "\"seq\":-1") == null);
    }

    // since(2) → only the tail (seq 3).
    {
        const tail = try bus.since(testing.allocator, 2);
        defer testing.allocator.free(tail);
        try testing.expectEqual(@as(usize, 1), countEvents(tail));
        try testing.expect(std.mem.indexOf(u8, tail, "\"seq\":3") != null);
        try testing.expect(std.mem.indexOf(u8, tail, "\"seq\":2") == null);
    }

    // since(head) → empty.
    {
        const none = try bus.since(testing.allocator, bus.head());
        defer testing.allocator.free(none);
        try testing.expectEqual(@as(usize, 0), countEvents(none));
        try testing.expectEqualStrings("[]", none);
    }
}

test "append rejects a non-object payload" {
    bus.initInMemoryForTest();
    defer bus.deinit();
    try testing.expectEqual(@as(i64, -1), bus.append("[1,2,3]"));
    try testing.expectEqual(@as(i64, -1), bus.append("not json"));
    // A rejected append must not advance the authoritative order.
    try testing.expectEqual(@as(i64, 0), bus.head());
}

test "append accepts the legacy common envelope while command outcomes migrate" {
    bus.initInMemoryForTest();
    defer bus.deinit();

    // Existing cart receipts do not yet carry command invocation, action, source,
    // or outcome-phase metadata. Keep that envelope valid while commands migrate
    // one at a time; the native bus owns only common-envelope integrity here.
    const env = envelope("editor.edit");
    defer testing.allocator.free(env);
    try testing.expectEqual(@as(i64, 1), bus.append(env));

    const confirmed = try bus.since(testing.allocator, 0);
    defer testing.allocator.free(confirmed);
    try testing.expect(std.mem.indexOf(u8, confirmed, "\"type\":\"editor.edit\"") != null);
    try testing.expect(std.mem.indexOf(u8, confirmed, "invocationId") == null);
    try testing.expect(std.mem.indexOf(u8, confirmed, "actionId") == null);
}

test "append rejects malformed common envelope fields without consuming seq" {
    bus.initInMemoryForTest();
    defer bus.deinit();

    const malformed = [_][]const u8{
        "{}",
        "{\"origin\":\"\",\"ts\":1,\"type\":\"editor.edit\",\"targets\":[],\"payload\":{}}",
        "{\"origin\":\"local\",\"ts\":1,\"type\":\"\",\"targets\":[],\"payload\":{}}",
        "{\"origin\":\"local\",\"ts\":1.5,\"type\":\"editor.edit\",\"targets\":[],\"payload\":{}}",
        "{\"origin\":\"local\",\"ts\":1,\"type\":\"editor.edit\",\"targets\":{},\"payload\":{}}",
        "{\"origin\":\"local\",\"ts\":1,\"type\":\"editor.edit\",\"targets\":[],\"payload\":[]}",
    };

    for (malformed) |json| try testing.expectEqual(@as(i64, -1), bus.append(json));
    try testing.expectEqual(@as(i64, 0), bus.head());

    const valid = envelope("editor.edit");
    defer testing.allocator.free(valid);
    try testing.expectEqual(@as(i64, 1), bus.append(valid));
}
