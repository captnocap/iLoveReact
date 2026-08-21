//! Echo ring for the TextInput controlled-value round-trip (req_4713).
//!
//! The live text of an input is owned natively (primitive/input.zig). Every
//! edit dispatches onChange(text) to JS, the cart stores it in React state,
//! and the `value` prop echoes the same text back through syncValue — one or
//! more paint frames later, because reconciler commits are queued and drained
//! at the start of the next frame (v8_bindings_reconciler .queue mode).
//!
//! Fast typing therefore puts several edits in flight at once, and one drain
//! replays their echoes in sequence over a buffer that has already moved on.
//! The replayed text converges, but syncValue's cursor clamp only ever pulls
//! the caret BACKWARDS — replaying "i","in","ind" over buffer "ind" leaves
//! the caret at 1, and the next keystroke inserts mid-string. That is the
//! fast-typing shuffle that turned "industrial" into "inustriald".
//!
//! The ring remembers (hash, len) of every text the input dispatched. An
//! incoming synced value matching a pending entry is the input's own words
//! coming back around — an acknowledgment that must not touch the buffer or
//! caret. A value matching nothing pending was authored by the cart
//! (clear-on-submit, programmatic set) and rewrites the buffer as before.

const std = @import("std");

pub const CAPACITY = 64;

pub const Verdict = enum { echo, authored };

pub const EchoRing = struct {
    hashes: [CAPACITY]u64 = [_]u64{0} ** CAPACITY,
    lens: [CAPACITY]u32 = [_]u32{0} ** CAPACITY,
    head: u32 = 0,
    count: u32 = 0,

    fn hash(bytes: []const u8) u64 {
        return std.hash.Wyhash.hash(0, bytes);
    }

    /// Record a text the input just dispatched to JS. When full the oldest
    /// entry is evicted — if its echo ever arrives it will be classified as
    /// cart-authored, which is exactly the pre-ring behavior.
    pub fn noteDispatched(self: *EchoRing, bytes: []const u8) void {
        if (self.count == CAPACITY) {
            self.head = (self.head + 1) % CAPACITY;
            self.count -= 1;
        }
        const idx = (self.head + self.count) % CAPACITY;
        self.hashes[idx] = hash(bytes);
        self.lens[idx] = @intCast(bytes.len);
        self.count += 1;
    }

    /// Classify an incoming synced value. A match consumes the matched entry
    /// AND everything older, because React batches state updates — echoes for
    /// intermediate texts may never arrive at all. A cart-authored value
    /// clears the ring: commits apply in order, so nothing dispatched before
    /// an authored rewrite can legitimately echo after it.
    pub fn classify(self: *EchoRing, bytes: []const u8) Verdict {
        if (self.count != 0) {
            const h = hash(bytes);
            var i: u32 = 0;
            while (i < self.count) : (i += 1) {
                const idx = (self.head + i) % CAPACITY;
                if (self.lens[idx] == bytes.len and self.hashes[idx] == h) {
                    self.head = (idx + 1) % CAPACITY;
                    self.count -= i + 1;
                    return .echo;
                }
            }
        }
        self.count = 0;
        return .authored;
    }

    /// Forget everything in flight. Called at focus boundaries: the buffer
    /// cannot advance without focus, so a late echo after a focus change is
    /// harmlessly re-applied as authored, and dropping the history closes the
    /// window where a batched-away intermediate text lingers and false-acks a
    /// coincidentally equal cart-authored value much later.
    pub fn reset(self: *EchoRing) void {
        self.head = 0;
        self.count = 0;
    }
};
