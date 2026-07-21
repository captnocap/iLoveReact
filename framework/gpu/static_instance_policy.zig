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

/// Resolve an opt-in populated-prefix hint against a retained source allocation.
/// Zero preserves the whole-array default used by streamed families. A non-zero
/// hint must fit inside the source reservation; malformed callers fall back to the
/// renderer's dynamic path instead of reading beyond the source slice.
pub fn populatedRowCount(source_rows: u32, populated_hint: u32) ?u32 {
    if (source_rows == 0) return null;
    if (populated_hint == 0) return source_rows;
    if (populated_hint > source_rows) return null;
    return populated_hint;
}
