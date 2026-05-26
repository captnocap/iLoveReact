// 3D characters for scape3d.
//
// Both player and NPCs are low-poly BOXY humanoids (Crossy-Road / PS1 register):
// every part is a box so the whole figure rotates cleanly to face its heading and
// the scene stays far under the 65k-vertex / 512-draw budget (spheres cost 2304
// verts each — we spend none on people). The player is differentiated by a hood
// (costume colour) + a cap brim; NPCs are tinted by their Ent.tint ramp; a downed
// NPC lies flat as a body. Facing maps scape's 2D angle → a Y-rotation.

import { Scene3D } from '@reactjit/runtime/primitives';
import type { V3 } from '../world/projection';
import { heightAt } from '../world/terrain';
import type { Player } from '../design';
import type { Ent } from '../state/world';
import { BODY_DOWN, EYE, NPC_PANTS, NPC_SHIRT, SKIN } from './palette3d';

// model faces +Z by default; rotate a local point around Y
function rotY([x, y, z]: V3, yaw: number): V3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x * c + z * s, y, -x * s + z * c];
}

// scape 2D facing (atan2 of dx,dy in x/y) → model Y-yaw so the model's +Z front
// points along the heading. Derived so rotY([0,0,1], yaw) == (cos f, sin f) in x/z.
function modelYaw(face: number): number {
  return Math.atan2(Math.cos(face), Math.sin(face));
}

type Box = { id: string; pos: V3; size: V3; color: string };

// Boxy humanoid, feet at y=0, ~1.95 tall. Eyes sit on +Z so they track facing.
function humanoidBoxes(colors: { skin: string; shirt: string; pants: string }): Box[] {
  const { skin, shirt, pants } = colors;
  return [
    { id: 'leg-l', pos: [-0.16, 0.46, 0], size: [0.26, 0.92, 0.3], color: pants },
    { id: 'leg-r', pos: [0.16, 0.46, 0], size: [0.26, 0.92, 0.3], color: pants },
    { id: 'torso', pos: [0, 1.2, 0], size: [0.64, 0.74, 0.36], color: shirt },
    { id: 'arm-l', pos: [-0.43, 1.2, 0], size: [0.18, 0.68, 0.24], color: shirt },
    { id: 'arm-r', pos: [0.43, 1.2, 0], size: [0.18, 0.68, 0.24], color: shirt },
    { id: 'hand-l', pos: [-0.43, 0.8, 0.02], size: [0.16, 0.16, 0.18], color: skin },
    { id: 'hand-r', pos: [0.43, 0.8, 0.02], size: [0.16, 0.16, 0.18], color: skin },
    { id: 'head', pos: [0, 1.78, 0], size: [0.36, 0.36, 0.34], color: skin },
  ];
}

function Figure({
  prefix, wx, wz, face, boxes, eyeColor = EYE, hood,
}: {
  prefix: string;
  wx: number;
  wz: number;
  face: number;
  boxes: Box[];
  eyeColor?: string;
  hood?: string; // optional hood/cap colour over the head (marks the player)
}) {
  const yaw = modelYaw(face);
  const baseY = heightAt(wx, wz); // feet ride the terrain
  const place = (p: V3): V3 => {
    const r = rotY(p, yaw);
    return [wx + r[0], baseY + r[1], wz + r[2]];
  };
  return (
    <>
      {boxes.map((b) => (
        <Scene3D.Mesh
          key={`${prefix}-${b.id}`}
          geometry="box"
          material={b.color}
          position={place(b.pos)}
          rotation={[0, yaw, 0]}
          sizeX={b.size[0]}
          sizeY={b.size[1]}
          sizeZ={b.size[2]}
        />
      ))}
      {/* eyes — two dark pips on the +Z face of the head */}
      <Scene3D.Mesh key={`${prefix}-eye-l`} geometry="box" material={eyeColor}
        position={place([-0.09, 1.82, 0.18])} rotation={[0, yaw, 0]} sizeX={0.07} sizeY={0.07} sizeZ={0.04} />
      <Scene3D.Mesh key={`${prefix}-eye-r`} geometry="box" material={eyeColor}
        position={place([0.09, 1.82, 0.18])} rotation={[0, yaw, 0]} sizeX={0.07} sizeY={0.07} sizeZ={0.04} />
      {hood ? (
        <>
          {/* hood shell over the crown */}
          <Scene3D.Mesh key={`${prefix}-hood`} geometry="box" material={hood}
            position={place([0, 1.98, -0.02])} rotation={[0, yaw, 0]} sizeX={0.42} sizeY={0.22} sizeZ={0.42} />
          {/* cap brim — the unmistakable "this one is me" tell, points forward */}
          <Scene3D.Mesh key={`${prefix}-brim`} geometry="box" material={hood}
            position={place([0, 1.84, 0.26])} rotation={[0, yaw, 0]} sizeX={0.4} sizeY={0.06} sizeZ={0.18} />
        </>
      ) : null}
    </>
  );
}

// ── Player ───────────────────────────────────────────────────────────────
export function Player3D({ px, py, facing, costumeColor }: {
  px: number; py: number; facing: number; costumeColor: string;
}) {
  const boxes = humanoidBoxes({ skin: SKIN[0], shirt: costumeColor, pants: '#1b1620' });
  return <Figure prefix="player" wx={px} wz={py} face={facing} boxes={boxes} hood={costumeColor} />;
}

// ── NPCs ───────────────────────────────────────────────────────────────
function npcFace(e: Ent): number {
  const dx = e.tx - e.x;
  const dy = e.ty - e.y;
  if (Math.hypot(dx, dy) < 0.02) return -Math.PI / 2; // idle: face the camera-ish
  return Math.atan2(dy, dx);
}

function DownedBody({ prefix, wx, wz, face }: { prefix: string; wx: number; wz: number; face: number }) {
  // a flat slab on the ground — a body
  const yaw = modelYaw(face);
  const baseY = heightAt(wx, wz);
  return (
    <>
      <Scene3D.Mesh key={`${prefix}-body`} geometry="box" material={BODY_DOWN}
        position={[wx, baseY + 0.12, wz]} rotation={[0, yaw, 0]} sizeX={0.6} sizeY={0.22} sizeZ={1.5} />
      <Scene3D.Mesh key={`${prefix}-head`} geometry="box" material={SKIN[1]}
        position={[wx + Math.cos(face) * 0.85, baseY + 0.12, wz + Math.sin(face) * 0.85]}
        rotation={[0, yaw, 0]} sizeX={0.34} sizeY={0.2} sizeZ={0.34} />
    </>
  );
}

export function Npc3D({ ent }: { ent: Ent }) {
  if (ent.dead) return <DownedBody prefix={ent.id} wx={ent.x} wz={ent.y} face={npcFace(ent)} />;
  const tint = ent.tint % NPC_SHIRT.length;
  const boxes = humanoidBoxes({
    skin: SKIN[ent.tint % SKIN.length],
    shirt: NPC_SHIRT[tint],
    pants: NPC_PANTS[tint],
  });
  // quest NPC gets a faint glow marker handled in the scene; here just the figure
  return <Figure prefix={ent.id} wx={ent.x} wz={ent.y} face={npcFace(ent)} boxes={boxes} />;
}

export function Npcs3D({ entities }: { entities: Ent[] }) {
  return (
    <>
      {entities.filter((e) => e.kind === 'npc').map((e) => (
        <Npc3D key={e.id} ent={e} />
      ))}
    </>
  );
}
