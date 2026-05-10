//! Testing barrel — re-exports the runtime test cluster.
//!
//! Single import surface for the runtime test harness, assertions,
//! input driver, node query engine, and witness record/replay.
//! Pure `zig test` compile-time tests live under `testing/unit/`.

pub const harness = @import("harness.zig");
pub const assert = @import("assert.zig");
pub const driver = @import("driver.zig");
pub const query = @import("query.zig");
pub const witness = @import("witness.zig");
