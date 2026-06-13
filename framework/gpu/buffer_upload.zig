//! Typed GPU buffer uploads — the ONE sanctioned path for queue.writeBuffer.
//!
//! AD-HOC BYTE MATH IS BANNED (req_0842 / req_0871). The painted roads rendered as
//! concrete for days because a single upload computed its size as `n * @sizeOf(f32)`
//! WITHOUT a wide cast: for n=14528 that overflowed to 25344 instead of 58112, so
//! writeBuffer uploaded only ~6336 of 14528 floats and every cell past it read zero
//! (tile kind 0 = water = concrete material). The vertex/instance writes happened to
//! cast `@as(u64, …)`; that one didn't. The bug is a class, not an instance.
//!
//! So: NO caller writes `count * @sizeOf(T)` by hand. Upload a typed slice (or a
//! single value) and let these helpers compute the byte size from the slice's own
//! element type — the count and the element size can never disagree, and the multiply
//! is always done in u64 so it cannot overflow for any real buffer. In a safety build
//! they also assert the write stays within the destination buffer and log the offender.

const std = @import("std");
const wgpu = @import("wgpu");

/// Byte size of a typed slice, computed WIDE (u64). Use this instead of
/// `slice.len * @sizeOf(T)` anywhere a byte count is needed (writeBuffer sizes,
/// setVertexBuffer ranges, mapped copies, …).
pub inline fn bytesOf(comptime T: type, slice: []const T) u64 {
    return @as(u64, slice.len) * @as(u64, @sizeOf(T));
}

/// Byte size of `count` elements of type T, WIDE (u64) — for the cases where the data
/// is a raw pointer + count rather than a slice. Prefer bytesOf(T, slice) when you
/// have a slice.
pub inline fn bytesOfCount(comptime T: type, count: usize) u64 {
    return @as(u64, count) * @as(u64, @sizeOf(T));
}

fn assertFits(buffer: *wgpu.Buffer, offset_bytes: u64, bytes: u64, comptime T: type) void {
    if (!std.debug.runtime_safety) return;
    const cap = buffer.getSize();
    if (offset_bytes + bytes > cap) {
        std.debug.print(
            "[buffer_upload] OVERRUN: {d} bytes of {s} at offset {d} exceeds {d}-byte buffer\n",
            .{ bytes, @typeName(T), offset_bytes, cap },
        );
        std.debug.assert(false);
    }
}

/// Upload a typed slice to `buffer` at `offset_bytes`. The byte size is derived from
/// the slice (len × element size, in u64) — the caller never does the multiply. A
/// zero-length slice is a no-op. In a safety build the write is bounds-checked.
pub fn writeTypedBuffer(
    queue: *wgpu.Queue,
    buffer: *wgpu.Buffer,
    offset_bytes: u64,
    comptime T: type,
    slice: []const T,
) void {
    if (slice.len == 0) return;
    const bytes = bytesOf(T, slice);
    assertFits(buffer, offset_bytes, bytes, T);
    queue.writeBuffer(buffer, offset_bytes, @ptrCast(slice.ptr), bytes);
}

/// Upload a SINGLE value (one struct — uniforms, a lone instance row, …) to `buffer`
/// at `offset_bytes`. `value` is a pointer to the value; the size is exactly
/// @sizeOf of the pointee. Bounds-checked in a safety build.
pub fn writeValue(
    queue: *wgpu.Queue,
    buffer: *wgpu.Buffer,
    offset_bytes: u64,
    value: anytype,
) void {
    // `value` must be a single-item pointer; `value.*` is a compile error otherwise.
    const T = @TypeOf(value.*);
    const bytes: u64 = @sizeOf(T);
    assertFits(buffer, offset_bytes, bytes, T);
    queue.writeBuffer(buffer, offset_bytes, @ptrCast(value), bytes);
}
