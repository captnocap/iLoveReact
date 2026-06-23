//! Retained static-instance upload policy for gpu/3d.zig.

/// True when a static instanced batch can be retained as one complete upload.
/// Partial uploads are invalid for streamed worlds because draw nodes address
/// later rows by scene3d_instance_first; those later rows must fall back to the
/// dynamic sub-range path instead of clamping to zero.
pub fn canRetainWholeBatch(row_count: u32, used_count: u32, capacity: u32) bool {
    if (row_count == 0) return false;
    if (used_count > capacity) return false;
    return row_count <= capacity - used_count;
}
