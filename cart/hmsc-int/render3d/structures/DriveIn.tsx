import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { Building } from '../../design';
import { driveInSpec, driveInScreenTextureKey } from '../../world/structures';
import { buildingPart, buildingYawDegrees } from '../buildingTransform';
import { Glass } from '../materials';
import { boxFaceParts, type Part, TexturedParts } from '../parts';

// A drive-in movie theatre, drawn from driveInSpec — a big screen wall raised on
// two legs at the back of an open lot, plus a small projector/concession booth
// out in the lot you press E at (state/useBuildingInteract opens a file picker)
// and a marquee pole at the entrance. The screen's -Z ('back') face samples the
// live video texture captured in render3d/driveInScreen (NO SIGNAL until a movie
// is picked). The wall slab is the solid mass (structureSolids); the lot in
// front (toward -Z / minZ) is bare walkable ground.
//
// Every solid piece is a PART (render3d/parts.tsx) for the click-to-pick
// inspector. The screen's UNTEXTURED look is itself a texture (the live video),
// carried as defaultTextureKey — an applied texture overrides the movie; clearing
// it brings the movie back. The warm-lit booth window (an object material) stays
// inline. Turns with its yaw like any building via buildingPart (+ rotation).

const FRAME_DARK = '#161b22'; // structural wall behind the screen
const SCREEN_BORDER = '#eef2f6'; // bright white frame around the lit panel
const LEG = '#272d35';
const BOOTH_WALL = '#b5463a'; // red ticket/projector booth
const BOOTH_TRIM = '#e9d8b0';
const BOOTH_ROOF = '#7c2c23';
const BOOTH_DOOR = '#211913';
const BOOTH_GLASS = Glass({ color: '#ffd479', opacity: 0.5 }); // warm-lit window
const POLE = '#3a3f45';
const MARQUEE_BOARD = '#f4c20d';
const MARQUEE_TEXT_BAR = '#c0392b';

// The drive-in's texturable parts. Geometry mirrors what the old inline JSX drew —
// one source of the boxes; the part ids are what Building.partTextures keys on.
export function driveInParts(b: Building): Part[] {
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
  const unit = { width: 1, height: 1, depth: 1 };
  const rot: [number, number, number] = [0, yaw, 0];

  return [
    ...s.legs.map((leg): Part => ({
      id: 'leg', label: 'Screen legs', geometry: 'Box', params: unit,
      scale: [1.8, leg.topY - b.y, 1.8], texturedFaces: ['front', 'back', 'left', 'right'], material: LEG, rotation: rot,
      position: buildingPart(b, leg.x, (b.y + leg.topY) / 2, leg.z),
    })),
    {
      // The big ass wall — the dark structural slab behind the screen.
      id: 'wall', label: 'Screen wall', geometry: 'Box', params: unit,
      scale: [wallW, s.wall.topY - b.y, wallD], texturedFaces: ['front', 'back'], material: FRAME_DARK, rotation: rot,
      position: buildingPart(b, wallCx, (b.y + s.wall.topY) / 2, wallCz),
    },
    {
      // White border frame, just behind the lit panel (toward +Z / the wall).
      id: 'screenFrame', label: 'Screen frame', geometry: 'Box', params: unit,
      scale: [sc.width + 1.6, sc.height + 1.6, 0.3], texturedFaces: ['front', 'back'], material: SCREEN_BORDER, rotation: rot,
      position: buildingPart(b, sc.cx, screenCy, sc.faceZ + 0.18),
    },
    {
      // The lit screen panel: its -Z 'back' face samples the live video capture
      // by default (material stays white — the shader multiplies material × texture,
      // so any tint would darken the movie). Only that face is textured; the thin
      // edges pin to a texel so there's no smear.
      id: 'screen', label: 'Screen', geometry: 'Box', params: unit,
      scale: [sc.width, sc.height, 0.12], texturedFaces: ['back'],
      defaultTextureKey: driveInScreenTextureKey(b.id), material: '#ffffff', rotation: rot,
      position: buildingPart(b, sc.cx, screenCy, sc.faceZ),
    },
    // The booth's four wall faces as separate targets (boothFront/Back/Left/Right)
    // — the solid booth box renders inline in the component (structural).
    ...boxFaceParts({
      id: 'booth', label: 'Booth',
      minX: booth.minX, maxX: booth.maxX, minZ: booth.minZ, maxZ: booth.maxZ,
      bottomY: b.y, topY: booth.topY,
      material: BOOTH_WALL, yaw,
      place: (x, y, z) => buildingPart(b, x, y, z),
    }),
    {
      id: 'boothRoof', label: 'Booth roof', geometry: 'Box', params: unit,
      scale: [boothW + 0.4, 0.3, boothD + 0.4], texturedFaces: ['top'], material: BOOTH_ROOF, rotation: rot,
      position: buildingPart(b, booth.cx, booth.topY + 0.05, booth.cz),
    },
    {
      id: 'boothTrim', label: 'Booth trim', geometry: 'Box', params: unit,
      scale: [boothW + 0.1, 0.35, boothD + 0.1], material: BOOTH_TRIM, rotation: rot,
      position: buildingPart(b, booth.cx, booth.topY - 0.5, booth.cz),
    },
    {
      // Door on the -Z face (the lot side, where the player walks up).
      id: 'boothDoor', label: 'Booth door', geometry: 'Box', params: unit,
      scale: [1.0, 2.0, 0.12], texturedFaces: ['front', 'back'], material: BOOTH_DOOR, rotation: rot,
      position: buildingPart(b, booth.cx, b.y + 1.0, booth.minZ - 0.02),
    },
    {
      id: 'marqueePole', label: 'Marquee pole', geometry: 'Cylinder',
      params: { radius: 0.2, height: s.marquee.topY - b.y, segments: 10 }, material: POLE, rotation: rot,
      position: buildingPart(b, s.marquee.x, (b.y + s.marquee.topY) / 2, s.marquee.z),
    },
    {
      id: 'marqueeBoard', label: 'Marquee board', geometry: 'Box', params: unit,
      scale: [3.6, 2.0, 0.3], texturedFaces: ['front', 'back'], material: MARQUEE_BOARD, rotation: rot,
      position: buildingPart(b, s.marquee.x, s.marquee.topY - 1.1, s.marquee.z),
    },
    {
      id: 'marqueeBar', label: 'Marquee title bar', geometry: 'Box', params: unit,
      scale: [3.4, 0.6, 0.36], texturedFaces: ['front', 'back'], material: MARQUEE_TEXT_BAR, rotation: rot,
      position: buildingPart(b, s.marquee.x, s.marquee.topY - 0.5, s.marquee.z),
    },
  ];
}

export function DriveIn(props: { building: Building }) {
  const b = props.building;
  const yaw = buildingYawDegrees(b);
  const s = driveInSpec(b);
  const booth = s.booth;
  const boothD = booth.maxZ - booth.minZ;

  return (
    <>
      {/* Legs + wall + screen + booth + marquee — texturable parts. */}
      <TexturedParts parts={driveInParts(b)} textures={b.partTextures} />

      {/* Warm-lit serving window on the −X side — object material, inline. */}
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 1, height: 1, depth: 1 }}
        scale={[0.12, 0.9, Math.min(1.8, boothD * 0.6)]}
        material={BOOTH_GLASS}
        rotation={[0, yaw, 0]}
        position={buildingPart(b, booth.minX - 0.02, b.y + 1.7, booth.cz)}
      />
    </>
  );
}
