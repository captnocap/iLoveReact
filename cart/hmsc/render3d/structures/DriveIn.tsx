import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { Building } from '../../design';
import { driveInSpec, driveInScreenTextureKey } from '../../world/structures';
import { buildingPart, buildingYawDegrees } from '../buildingTransform';
import { Glass } from '../materials';

// A drive-in movie theatre, drawn from driveInSpec — a big screen wall raised on
// two legs at the back of an open lot, plus a small projector/concession booth
// out in the lot you press E at (state/useBuildingInteract opens a file picker)
// and a marquee pole at the entrance. The screen's -Z ('back') face samples the
// live video texture captured in render3d/driveInScreen (NO SIGNAL until a movie
// is picked). The wall slab is the solid mass (structureSolids); the lot in
// front (toward -Z / minZ) is bare walkable ground.
//
// Turns with its yaw like any building: every part places through buildingPart
// (anchor rotated about the building centre) + rotation.

const FRAME_DARK = '#161b22'; // structural wall behind the screen
const SCREEN_BORDER = '#eef2f6'; // bright white frame around the lit panel
// The screen panel's material MUST be white: the scene3d shader multiplies the
// sampled texture by the material color (base = inst_color.rgb * tex.rgb), so any
// non-white material tints/darkens the captured video. White = texture passes
// through unmodified (matches FloorMesh and billboard_demo).
const SCREEN_MATERIAL = '#ffffff';
const LEG = '#272d35';
const BOOTH_WALL = '#b5463a'; // red ticket/projector booth
const BOOTH_TRIM = '#e9d8b0';
const BOOTH_ROOF = '#7c2c23';
const BOOTH_DOOR = '#211913';
const BOOTH_GLASS = Glass({ color: '#ffd479', opacity: 0.5 }); // warm-lit window
const POLE = '#3a3f45';
const MARQUEE_BOARD = '#f4c20d';
const MARQUEE_TEXT_BAR = '#c0392b';

export function DriveIn(props: { building: Building }) {
  const b = props.building;
  const yaw = buildingYawDegrees(b);
  const s = driveInSpec(b);
  const sc = s.screen;

  const wallW = s.wall.maxX - s.wall.minX;
  const wallD = s.wall.maxZ - s.wall.minZ;
  const wallCx = (s.wall.minX + s.wall.maxX) / 2;
  const wallCz = (s.wall.minZ + s.wall.maxZ) / 2;
  const screenCy = (sc.bottomY + sc.topY) / 2;

  const booth = s.booth;
  const boothW = booth.maxX - booth.minX;
  const boothD = booth.maxZ - booth.minZ;

  return (
    <>
      {/* Legs the screen stands on. */}
      {s.legs.map((leg, i) => (
        <Scene3D.Mesh
          key={`leg-${i}`}
          geometry={Geometry.Box}
          params={{ width: 1, height: 1, depth: 1 }}
          scale={[1.8, leg.topY - b.y, 1.8]}
          material={LEG}
          rotation={[0, yaw, 0]}
          position={buildingPart(b, leg.x, (b.y + leg.topY) / 2, leg.z)}
        />
      ))}

      {/* The big ass wall — the dark structural slab behind the screen. */}
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 1, height: 1, depth: 1 }}
        scale={[wallW, s.wall.topY - b.y, wallD]}
        material={FRAME_DARK}
        rotation={[0, yaw, 0]}
        position={buildingPart(b, wallCx, (b.y + s.wall.topY) / 2, wallCz)}
      />

      {/* White border frame, just behind the lit panel (toward +Z / the wall). */}
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 1, height: 1, depth: 1 }}
        scale={[sc.width + 1.6, sc.height + 1.6, 0.3]}
        material={SCREEN_BORDER}
        rotation={[0, yaw, 0]}
        position={buildingPart(b, sc.cx, screenCy, sc.faceZ + 0.18)}
      />

      {/* The lit screen panel: a thin box whose -Z 'back' face samples the live
          video texture (NO SIGNAL card until a movie is picked). Only that face
          is textured; the thin edges pin to a texel so there's no smear. */}
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 1, height: 1, depth: 1, texturedFaces: ['back'] }}
        scale={[sc.width, sc.height, 0.12]}
        material={SCREEN_MATERIAL}
        textureKey={driveInScreenTextureKey(b.id)}
        rotation={[0, yaw, 0]}
        position={buildingPart(b, sc.cx, screenCy, sc.faceZ)}
      />

      {/* Projector / concession booth out in the lot (the E-interact anchor). */}
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 1, height: 1, depth: 1 }}
        scale={[boothW, booth.topY - b.y, boothD]}
        material={BOOTH_WALL}
        rotation={[0, yaw, 0]}
        position={buildingPart(b, booth.cx, (b.y + booth.topY) / 2, booth.cz)}
      />
      {/* Roof cap + trim band. */}
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 1, height: 1, depth: 1 }}
        scale={[boothW + 0.4, 0.3, boothD + 0.4]}
        material={BOOTH_ROOF}
        rotation={[0, yaw, 0]}
        position={buildingPart(b, booth.cx, booth.topY + 0.05, booth.cz)}
      />
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 1, height: 1, depth: 1 }}
        scale={[boothW + 0.1, 0.35, boothD + 0.1]}
        material={BOOTH_TRIM}
        rotation={[0, yaw, 0]}
        position={buildingPart(b, booth.cx, booth.topY - 0.5, booth.cz)}
      />
      {/* Door on the -Z face (the lot side, where the player walks up). */}
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 1, height: 1, depth: 1 }}
        scale={[1.0, 2.0, 0.12]}
        material={BOOTH_DOOR}
        rotation={[0, yaw, 0]}
        position={buildingPart(b, booth.cx, b.y + 1.0, booth.minZ - 0.02)}
      />
      {/* Warm-lit serving window on the −X side. */}
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 1, height: 1, depth: 1 }}
        scale={[0.12, 0.9, Math.min(1.8, boothD * 0.6)]}
        material={BOOTH_GLASS}
        rotation={[0, yaw, 0]}
        position={buildingPart(b, booth.minX - 0.02, b.y + 1.7, booth.cz)}
      />

      {/* Marquee: a pole + a yellow board with a red title bar, at the entrance. */}
      <Scene3D.Mesh
        geometry={Geometry.Cylinder}
        params={{ radius: 0.2, height: s.marquee.topY - b.y, segments: 10 }}
        material={POLE}
        rotation={[0, yaw, 0]}
        position={buildingPart(b, s.marquee.x, (b.y + s.marquee.topY) / 2, s.marquee.z)}
      />
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 1, height: 1, depth: 1 }}
        scale={[3.6, 2.0, 0.3]}
        material={MARQUEE_BOARD}
        rotation={[0, yaw, 0]}
        position={buildingPart(b, s.marquee.x, s.marquee.topY - 1.1, s.marquee.z)}
      />
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 1, height: 1, depth: 1 }}
        scale={[3.4, 0.6, 0.36]}
        material={MARQUEE_TEXT_BAR}
        rotation={[0, yaw, 0]}
        position={buildingPart(b, s.marquee.x, s.marquee.topY - 0.5, s.marquee.z)}
      />
    </>
  );
}
