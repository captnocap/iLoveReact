import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { HumanoidRig, Vec3Tuple } from './skeleton';
import type { HumanoidPalette } from './palette';

// Renders a solved humanoid rig with a palette. This is the ONE renderer for
// every humanoid in HMSC — player and NPC both pass through here, differing only
// by palette and by whether the teal position marker is drawn. Body shape,
// articulation, and proportions live entirely in skeleton.ts, so this file never
// decides what a humanoid looks like, only what color it is.

export function Figure(props: { rig: HumanoidRig; palette: HumanoidPalette; marker?: Vec3Tuple }) {
  const { rig, palette } = props;
  return (
    <>
      {props.marker ? (
        <>
          <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.08, height: 0.035, segments: 16 }} material={palette.marker} position={[props.marker[0], props.marker[1] + 0.02, props.marker[2]]} />
          <Scene3D.Mesh geometry={Geometry.Torus} params={{ radius: 0.26, tube: 0.012, segments: 24, sides: 6 }} material={palette.marker} position={[props.marker[0], props.marker[1] + 0.04, props.marker[2]]} />
        </>
      ) : null}
      {rig.parts.map((part, index) => (
        <Scene3D.Mesh
          key={index}
          geometry={part.geometry}
          params={part.params}
          // A textured part (the face-decal head) renders white so the baked
          // texture reads true — same rule as PartMesh in render3d/parts.tsx.
          material={part.textureKey ? '#ffffff' : palette[part.slot]}
          textureKey={part.textureKey}
          position={part.position}
          rotation={part.rotation}
        />
      ))}
    </>
  );
}
