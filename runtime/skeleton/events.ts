// runtime/skeleton/events.ts — the skeleton AUTHORING events.
//
// Authoring a skeleton (add a bone, set a joint, assign a mesh, drop a mount, pin
// a contact, set a behavior/physics/animation) is a stream of editorbus events —
// the SAME envelope every editor system shares (runtime/editorbus/event.ts). Each
// type is registered ONCE here (the anti-collision seam), and every event carries
// the skeleton id as a `skeleton` TargetRef so the hot index (E) can dirty-track
// the authored object O(1) regardless of map richness.
//
// This is data DECLARATION only: these factories build well-formed events and the
// dispatch helpers emit them through the authoring bus. The actual edit semantics
// (apply, fold, validate the formation) live in the host — the Zig bones_loader /
// hot index — never in React. See EDITOR_FOUNDATION_CONTRACTS.md seam 1.

import { defineEventType, type EventFactory, type TargetRef } from '../editorbus/event';
import { dispatch, type Seq } from '../editorbus/bus';
import type {
  Bone, Joint, Mount, Contact, NamedBehavior, Collider, CapabilityRef,
} from './schema';

/** TargetRef.kind vocabulary owned by the skeleton authoring system. The skeleton
 *  id rides on EVERY skeleton event; finer refs (bone/mount/contact) ride along so
 *  the index can dirty exactly what changed. */
export const SKELETON = 'skeleton';
export const BONE = 'bone';
export const MOUNT = 'mount';
export const CONTACT = 'contact';

export function skeletonTarget(id: string): TargetRef { return { kind: SKELETON, id }; }

/** Every skeleton event targets its skeleton; callers add finer refs. */
function targets(skeletonId: string, ...extra: TargetRef[]): TargetRef[] {
  return [skeletonTarget(skeletonId), ...extra];
}

// ── registered event types (each registered ONCE at module load) ──────────────

export const boneAdd: EventFactory<{ bone: Bone }> = defineEventType({
  type: 'skeleton.bone.add', undoable: true,
  describe: (p) => `add bone ${p.bone.id}`,
});

export const boneRemove: EventFactory<{ boneId: string }> = defineEventType({
  type: 'skeleton.bone.remove', undoable: true,
  describe: (p) => `remove bone ${p.boneId}`,
});

export const jointSet: EventFactory<{ boneId: string; joint: Joint }> = defineEventType({
  type: 'skeleton.joint.set', undoable: true,
  describe: (p) => `set ${p.joint.kind} joint on ${p.boneId}`,
});

export const meshAssign: EventFactory<{ boneId?: string; geometryKey: string; skinned?: boolean }> = defineEventType({
  type: 'skeleton.mesh.assign', undoable: true,
  describe: (p) => (p.skinned ? `skin mesh ${p.geometryKey}` : `assign mesh ${p.geometryKey} → ${p.boneId}`),
});

export const collisionAdd: EventFactory<{ collider: Collider }> = defineEventType({
  type: 'skeleton.collision.add', undoable: true,
  describe: (p) => `add collider ${p.collider.capability.name}`,
});

export const physicsSet: EventFactory<{ physics: CapabilityRef }> = defineEventType({
  type: 'skeleton.physics.set', undoable: true,
  describe: (p) => `set physics ${p.physics.name}`,
});

export const animationSet: EventFactory<{ animation: CapabilityRef }> = defineEventType({
  type: 'skeleton.animation.set', undoable: true,
  describe: (p) => `set animation ${p.animation.name}`,
});

export const mountAdd: EventFactory<{ mount: Mount }> = defineEventType({
  type: 'skeleton.mount.add', undoable: true,
  describe: (p) => `add mount ${p.mount.name} @ ${p.mount.boneId}`,
});

export const contactPin: EventFactory<{ contact: Contact }> = defineEventType({
  type: 'skeleton.contact.pin', undoable: true,
  describe: (p) => `pin contact ${p.contact.name} @ ${p.contact.boneId}`,
});

export const behaviorSet: EventFactory<{ behavior: NamedBehavior }> = defineEventType({
  type: 'skeleton.behavior.set', undoable: true,
  describe: (p) => `set behavior ${p.behavior.name} (${p.behavior.capability.name})`,
});

export const staticSet: EventFactory<{ static: boolean }> = defineEventType({
  type: 'skeleton.static.set', undoable: true,
  describe: (p) => (p.static ? 'mark static' : 'mark articulated'),
});

// ── dispatch helpers (emit through the authoring bus, carry the skeleton id) ──

export function addBone(skeletonId: string, bone: Bone): Seq {
  return dispatch(boneAdd({ bone }, targets(skeletonId, { kind: BONE, id: bone.id })));
}

export function removeBone(skeletonId: string, boneId: string): Seq {
  return dispatch(boneRemove({ boneId }, targets(skeletonId, { kind: BONE, id: boneId })));
}

export function setJoint(skeletonId: string, boneId: string, joint: Joint): Seq {
  return dispatch(jointSet({ boneId, joint }, targets(skeletonId, { kind: BONE, id: boneId })));
}

export function assignMesh(skeletonId: string, geometryKey: string, boneId?: string): Seq {
  const extra = boneId ? [{ kind: BONE, id: boneId }] : [];
  return dispatch(meshAssign({ boneId, geometryKey, skinned: boneId == null }, targets(skeletonId, ...extra)));
}

export function addCollision(skeletonId: string, collider: Collider): Seq {
  const extra = collider.boneId ? [{ kind: BONE, id: collider.boneId }] : [];
  return dispatch(collisionAdd({ collider }, targets(skeletonId, ...extra)));
}

export function setPhysics(skeletonId: string, physics: CapabilityRef): Seq {
  return dispatch(physicsSet({ physics }, targets(skeletonId)));
}

export function setAnimation(skeletonId: string, animation: CapabilityRef): Seq {
  return dispatch(animationSet({ animation }, targets(skeletonId)));
}

export function addMount(skeletonId: string, mount: Mount): Seq {
  return dispatch(mountAdd({ mount }, targets(skeletonId, { kind: MOUNT, id: mount.name }, { kind: BONE, id: mount.boneId })));
}

export function pinContact(skeletonId: string, contact: Contact): Seq {
  return dispatch(contactPin({ contact }, targets(skeletonId, { kind: CONTACT, id: contact.name }, { kind: BONE, id: contact.boneId })));
}

export function setBehavior(skeletonId: string, behavior: NamedBehavior): Seq {
  const extra = behavior.mount ? [{ kind: MOUNT, id: behavior.mount }] : [];
  return dispatch(behaviorSet({ behavior }, targets(skeletonId, ...extra)));
}

export function setStatic(skeletonId: string, isStatic: boolean): Seq {
  return dispatch(staticSet({ static: isStatic }, targets(skeletonId)));
}
