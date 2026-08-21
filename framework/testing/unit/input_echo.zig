//! Unit tests for the TextInput controlled-value echo ring (req_4713).
//!
//! The bug being pinned: fast typing puts several onChange dispatches in
//! flight before their controlled-value echoes drain back through syncValue.
//! Replaying those stale echoes over the advanced buffer converged on the
//! right text but dragged the caret backwards via the cursor clamp, so the
//! next keystroke inserted mid-string ("industrial" → "inustriald"). The
//! ring lets syncValue classify an incoming value as the input's own echo
//! (ack — hands off the buffer) vs a cart-authored value (rewrite).

const std = @import("std");
const input_echo = @import("input_echo");
const EchoRing = input_echo.EchoRing;

test "single dispatch echoes back and is consumed" {
    var ring = EchoRing{};
    ring.noteDispatched("i");
    try std.testing.expectEqual(input_echo.Verdict.echo, ring.classify("i"));
    try std.testing.expectEqual(@as(u32, 0), ring.count);
}

test "req_4713: stale burst replay is acked, never authored" {
    // Keystrokes 'i','n','d' land in one pump window; the drain then replays
    // their echoes in order while the buffer already holds "ind". Every one
    // of them must classify as echo — the authored path is what rewound the
    // caret and produced "inustriald".
    var ring = EchoRing{};
    ring.noteDispatched("i");
    ring.noteDispatched("in");
    ring.noteDispatched("ind");
    try std.testing.expectEqual(input_echo.Verdict.echo, ring.classify("i"));
    try std.testing.expectEqual(input_echo.Verdict.echo, ring.classify("in"));
    try std.testing.expectEqual(input_echo.Verdict.echo, ring.classify("ind"));
    try std.testing.expectEqual(@as(u32, 0), ring.count);
}

test "React-batched commit skips intermediates and consumes older entries" {
    // React may batch three setStates into one commit — only "ind" ever
    // echoes. Matching it must consume the never-echoed "i" and "in" too.
    var ring = EchoRing{};
    ring.noteDispatched("i");
    ring.noteDispatched("in");
    ring.noteDispatched("ind");
    try std.testing.expectEqual(input_echo.Verdict.echo, ring.classify("ind"));
    try std.testing.expectEqual(@as(u32, 0), ring.count);
}

test "cart-authored value is authored and clears the ring" {
    // Clear-on-submit: cart sets value to "" which the input never
    // dispatched. It must rewrite — and drop the in-flight history, since
    // commits apply in order.
    var ring = EchoRing{};
    ring.noteDispatched("ind");
    try std.testing.expectEqual(input_echo.Verdict.authored, ring.classify(""));
    try std.testing.expectEqual(@as(u32, 0), ring.count);
    // The previously-dispatched text no longer acks after an authored write.
    try std.testing.expectEqual(input_echo.Verdict.authored, ring.classify("ind"));
}

test "delete-and-retype round trip keeps distinct entries in order" {
    var ring = EchoRing{};
    ring.noteDispatched("a");
    ring.noteDispatched("");
    ring.noteDispatched("a");
    try std.testing.expectEqual(input_echo.Verdict.echo, ring.classify("a"));
    try std.testing.expectEqual(input_echo.Verdict.echo, ring.classify(""));
    try std.testing.expectEqual(input_echo.Verdict.echo, ring.classify("a"));
    try std.testing.expectEqual(@as(u32, 0), ring.count);
}

test "overflow evicts oldest; evicted echo degrades to authored" {
    var ring = EchoRing{};
    var buf: [8]u8 = undefined;
    var i: u32 = 0;
    while (i < input_echo.CAPACITY + 3) : (i += 1) {
        const text = std.fmt.bufPrint(&buf, "t{d}", .{i}) catch unreachable;
        ring.noteDispatched(text);
    }
    try std.testing.expectEqual(@as(u32, input_echo.CAPACITY), ring.count);
    // "t0".."t2" were evicted — their late echoes fall back to the
    // pre-ring behavior (authored rewrite), which also clears the ring.
    try std.testing.expectEqual(input_echo.Verdict.authored, ring.classify("t0"));
    try std.testing.expectEqual(@as(u32, 0), ring.count);
}

test "reset drops all in-flight history" {
    var ring = EchoRing{};
    ring.noteDispatched("ind");
    ring.reset();
    try std.testing.expectEqual(@as(u32, 0), ring.count);
    try std.testing.expectEqual(input_echo.Verdict.authored, ring.classify("ind"));
}
