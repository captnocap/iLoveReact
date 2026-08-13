// runtime/skeleton/index.ts — the skeleton object-model shared contract.
//
// The TS side of the SKELETON OBJECT MODEL (docs/game/SKELETON_OBJECT_MODEL.md):
//   - schema.ts — the authoring shapes (Bone/Joint + carried-data sections),
//     mirroring framework/skeleton/skeleton.zig. Pure data declaration.
//   - events.ts — the skeleton authoring event types + dispatch helpers, emitted
//     through the editorbus (runtime/editorbus). React declares; the host (Zig
//     bones_loader / hot index) applies and validates.
//   - rigs.ts — the canonical RIG vocabulary (pocket/placement/seat/grip contact
//     names, container/seat/cover/door/dynamics capability params) + the vehicle
//     formation template and prop/item rig draft ⇄ Skeleton mapping.
//   - generated/humanoid-v1.ts — the single code-generated canonical character
//     template; characterRig.ts / capture.ts — the two deep native session doors.
//
// INTEGRATION: the editor cart imports from here via '@reactjit/skeleton'.

export * from './schema';
export * from './events';
export * from './rigs';
export * from './characterRig';
export * from './capture';
export * from './skinBinding';
export * from './readiness';
export * from './generated/humanoid-v1';
