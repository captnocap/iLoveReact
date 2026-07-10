//! Map-engine test aggregation rooted at `framework/`.
//!
//! The engine correctly consumes the sibling world/ foliage recipe contract;
//! rooting `zig test` down at `framework/game/map/` would make that legitimate
//! import look like an escape from the module. Keep the production dependency
//! intact and aggregate its inline tests plus boundary tests from here.

comptime {
    _ = @import("game/map/engine.zig");
    _ = @import("testing/unit/game_map.zig");
}
