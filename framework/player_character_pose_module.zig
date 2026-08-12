//! Test/build root for mounted character posing. Keeping the module root at
//! `framework/` permits the implementation to share skeleton modules without
//! widening their public contracts.

const implementation = @import("world_loader/player_character_pose.zig");

pub const pose_stream = implementation.pose_stream;
pub const clips = implementation.clips;
pub const rig_pose = implementation.rig_pose;
pub const motion_document = implementation.motion_document;
pub const clip_documents = @import("skeleton/clip_documents.zig");
pub const MAX_OWNER_BYTES = implementation.MAX_OWNER_BYTES;
pub const HOST_OWNER = implementation.HOST_OWNER;
pub const Error = implementation.Error;
pub const OwnerId = implementation.OwnerId;
pub const ActiveMotion = implementation.ActiveMotion;
pub const State = implementation.State;
