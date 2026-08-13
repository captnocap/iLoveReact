//! Test/module root for strict saved-character runtime construction. Keeping the
//! root at `framework/` lets the loader consume sibling GPU and skeleton modules
//! without widening Zig's module path for the focused unit suite.

const implementation = @import("world_loader/character_assets.zig");
const meshdoc = @import("gpu/meshdoc_format.zig");

pub const schema = @import("skeleton/skeleton.zig");
pub const canonical_humanoid = @import("skeleton/generated/humanoid_v1.zig");
pub const MeshDocSnapshot = meshdoc.Snapshot;
pub const loadBytes = implementation.loadBytes;
pub const objectBindingsCoverRangeIds = implementation.objectBindingsCoverRangeIds;
pub const facingYawOffsetDegrees = implementation.facingYawOffsetDegrees;
pub const rig_pose = @import("skeleton/rig_pose.zig");
pub const encodeGeometryWithRangeObjectIds = meshdoc.encodeSnapshotWithRangeObjectIdsAlloc;

/// Structural proof surface: the runtime loader must stay solver-free. The test
/// checks this exact compiled source rather than relying on a mock call counter.
pub const runtime_loader_source = @embedFile("world_loader/character_assets.zig");
