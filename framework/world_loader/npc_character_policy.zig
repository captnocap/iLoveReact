//! NPC character staging policy during the welded-rig cutover.
//!
//! Legacy NPC model/spawn lumps describe segmented mesh groups and have no
//! saved RJMD v5/RJSK v1 binding. Until a native NPC character owner consumes
//! the shared strict CharacterAsset loader, their presence is a hard load
//! error—not an invisible skip and never a compatibility fallback.

pub const Error = error{RetiredNpcCharacterStaging};

pub fn requireSupportedStaging(has_retired_models: bool, has_retired_spawns: bool) Error!void {
    if (has_retired_models or has_retired_spawns) return error.RetiredNpcCharacterStaging;
}

test "retired segmented NPC staging is rejected explicitly" {
    try requireSupportedStaging(false, false);
    try @import("std").testing.expectError(
        error.RetiredNpcCharacterStaging,
        requireSupportedStaging(true, false),
    );
    try @import("std").testing.expectError(
        error.RetiredNpcCharacterStaging,
        requireSupportedStaging(false, true),
    );
    try @import("std").testing.expectError(
        error.RetiredNpcCharacterStaging,
        requireSupportedStaging(true, true),
    );
}
