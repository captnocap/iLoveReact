import type { NpcState } from '../../design';
import { ZONE_DAMAGE, type DamageZone, type HumanoidHit } from '../../render3d/humanoid';

// Applies a resolved shot to an NPC. This is the join point of the two shot
// paths: the player's aim ray (geometric — arrives as a HumanoidHit with its zone
// already chosen) and the chance roll (probabilistic — arrives as a DamageZone
// picked by systems/chance). Both funnel to one health subtraction, so death is
// decided in exactly one place. An NPC at zero goes `down` (the figure stops
// driving and it's no longer a threat); the despawn/ragdoll choice is the AI
// layer's, not this function's.
//
// Player health is a plain number on PlayerState and is mutated by the command/AI
// layer directly — this file is NPC-side only, by design (player damage is always
// the chance path, never a raycast).

export type NpcDamageResult = {
  npc: NpcState;
  damage: number;
  died: boolean;
};

// Base weapon damage scaled by where it landed.
export function zoneDamage(baseDamage: number, zone: DamageZone): number {
  return baseDamage * ZONE_DAMAGE[zone];
}

export function applyDamageToNpc(npc: NpcState, amount: number): NpcDamageResult {
  if (npc.posture === 'down') return { npc, damage: 0, died: false };
  const current = Math.max(0, npc.health.current - amount);
  const died = current <= 0;
  return {
    npc: { ...npc, health: { ...npc.health, current }, posture: died ? 'down' : npc.posture },
    damage: amount,
    died,
  };
}

// The player landed an aim-ray shot on this NPC. The HumanoidHit already carries
// the zone's multiplier (it came from the same ZONE_DAMAGE table), so scale the
// weapon's base by it directly — do not re-multiply.
export function applyAimHitToNpc(npc: NpcState, hit: HumanoidHit, baseDamage: number): NpcDamageResult {
  return applyDamageToNpc(npc, baseDamage * hit.damageMultiplier);
}

// A chance-resolved shot landed on this NPC in `zone`.
export function applyZoneShotToNpc(npc: NpcState, zone: DamageZone, baseDamage: number): NpcDamageResult {
  return applyDamageToNpc(npc, zoneDamage(baseDamage, zone));
}
