//! Module-root shim for the focused paint-program journal unit test.
//! Keeping the module root at framework/ lets paint_program's existing GPU imports
//! resolve without changing production import boundaries.

pub const paint_program = @import("gpu/paint_program.zig");
