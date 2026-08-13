//! Build/test module root for the deep character-rig session. Keeping the root
//! at `framework/` lets the session consume both GPU snapshots and skeleton
//! solvers without weakening Zig's module-path boundary.

const implementation = @import("skeleton/character_rig_session.zig");

pub const schema = implementation.schema;
pub const canonical_humanoid = implementation.canonical_humanoid;
pub const CharacterRigSessionTuning = implementation.CharacterRigSessionTuning;
pub const CHARACTER_RIG_SESSION_TUNING = implementation.CHARACTER_RIG_SESSION_TUNING;
pub const ResidentContext = implementation.ResidentContext;
pub const MeshDocSnapshot = @import("gpu/meshdoc_format.zig").Snapshot;
pub const OwnedCharacterSkeleton = implementation.OwnedCharacterSkeleton;
pub const resetForTests = implementation.resetForTests;
pub const parseOwnedCharacterSkeleton = implementation.parseOwnedCharacterSkeleton;
pub const preflightOpenRangeObjectCount = implementation.preflightOpenRangeObjectCount;
pub const handle = implementation.handle;
pub const handleResident = implementation.handleResident;
pub const ExercisePoseTick = implementation.ExercisePoseTick;
pub const tickExercise = implementation.tickExercise;
