//! Rooted at framework/ so the live integration proof imports production code.

test {
    _ = @import("testing/integration/lore_snapshot.zig");
}
