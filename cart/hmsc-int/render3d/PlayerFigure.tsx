import type { Vec3 } from '../design';
import { drivePose, solveHumanoid, Figure, PLAYER_PALETTE, PLAYER_FACE_KEY } from './humanoid';
import type { Vec3Tuple } from './humanoid';

// The HMSC player model. As of the humanoid extraction this is a thin wrapper:
// it solves the shared humanoid skeleton (render3d/humanoid) with the gait pose
// and draws it with the player palette plus the teal position marker. The body
// shape, articulation, and hitbox all live in the shared module, so the player
// and every NPC are literally the same skeleton — a fix to the walk cycle or a
// limb proportion lands on both at once.
//
// The prop signature is unchanged for its consumers: hmsc gameplay,
// hmsc_scale_lab, hmsc_massive_map_lab.

// The head wears the player's baked face decal (humanoid/face.tsx). Any mount
// that draws this must also mount <HumanoidFaceCaptures /> as a 2D sibling of
// its Scene3D so the key resolves — HmscGameplayRig and both labs do.
export function PlayerFigure(props: { position: Vec3; yawDegrees: number; animationSeconds: number; moving: boolean; running: boolean }) {
  const pose = drivePose(props.animationSeconds, props.moving, props.running);
  const base: Vec3Tuple = [props.position.x, props.position.y, props.position.z];
  const rig = solveHumanoid(base, props.yawDegrees, pose, PLAYER_FACE_KEY);
  return <Figure rig={rig} palette={PLAYER_PALETTE} marker={base} />;
}
