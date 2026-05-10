//! SVG barrel — vector path geometry feeders for the GPU pipeline.
//!
//! `path` parses SVG path-data strings (`<path d="…">`) into polylines
//! and GPU-native bezier curves. `dash` builds rounded-rect perimeters
//! and walks them with stroke-dasharray semantics for animated borders.
//! Both produce geometry consumed by `gpu.draw*`.

pub const path = @import("path.zig");
pub const dash = @import("dash.zig");
