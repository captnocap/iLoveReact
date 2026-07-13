//! Test root for events/editor_bus.zig (zig build test-editor-bus).
//! Lives at framework/ so the production-relative SQLite import stays within
//! one module path. Behavioral cases remain in framework/testing/unit/.

test {
    _ = @import("testing/unit/editor_bus.zig");
}
