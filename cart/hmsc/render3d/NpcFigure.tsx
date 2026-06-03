import type { Vec3 } from '../design';
import { drivePose, solveHumanoid, Figure, npcPalette } from './humanoid';
import type { HumanoidRig, Vec3Tuple } from './humanoid';

// An NPC, drawn. Same shared humanoid skeleton as the player, recolored by a
// palette chosen deterministically from the NPC id (so a given NPC always looks
// the same and a crowd isn't all clones), and without the player's teal position
// marker. Locational damage comes for free: the rig this draws carries the same
// zone capsules the player's aim ray tests against — see humanoid/hitbox.
//
// This is the model + hitbox layer. NPC health, AI, and the damage-application
// loop are the next layer up; they hang an entity off this figure, they do not
// change it.

export type NpcDrive = {
  id: string;
  position: Vec3;
  yawDegrees: number;
  animationSeconds: number;
  moving: boolean;
  running: boolean;
};

// Solve the rig an NPC draws AND is shot against, from one set of drive inputs.
// The fire command calls this to raycast; NpcFigure calls it to render. Because
// both go through here, the hit volume can never disagree with the visible body.
export function solveNpcRig(npc: NpcDrive): HumanoidRig {
  const pose = drivePose(npc.animationSeconds, npc.moving, npc.running);
  const base: Vec3Tuple = [npc.position.x, npc.position.y, npc.position.z];
  return solveHumanoid(base, npc.yawDegrees, pose);
}

export function NpcFigure(props: NpcDrive) {
  const rig = solveNpcRig(props);
  return <Figure rig={rig} palette={npcPalette(props.id)} />;
}
