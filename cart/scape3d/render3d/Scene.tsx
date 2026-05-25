// The Scene3D root for scape3d. ONE <Scene3D> — camera derived from the same
// cameraFor() that the click-picker inverts, dusk lighting, the meshed city, the
// boxy player + NPCs, and click-to-move path markers laid on the ground.

import { Scene3D } from '@reactjit/runtime/primitives';
import { cameraFor, type Cam } from '../world/projection';
import { hex, PATH_DOT, PATH_TARGET } from './palette3d';
import { HAZE } from '../render/palette';
import { City3D } from './City3D';
import { Player3D, Npcs3D } from './Characters3D';
import type { Door } from '../systems/doors';
import type { Ent } from '../state/world';
import type { ScapePlayerState } from '../state/player';

const SKY = hex(HAZE);

function PathMarkers({ path }: { path: { x: number; y: number }[] }) {
  const steps = path.slice(0, 16);
  return (
    <>
      {steps.map((p, i) => {
        const last = i === steps.length - 1;
        return (
          <Scene3D.Mesh
            key={`path-${i}`}
            geometry="cylinder"
            material={last ? PATH_TARGET : PATH_DOT}
            position={[p.x, 0.04, p.y]}
            radius={last ? 0.26 : 0.1}
            sizeY={0.06}
          />
        );
      })}
    </>
  );
}

function resolveCostume(color: string): string {
  return color && color.startsWith('#') ? color : '#b53a8a';
}

export function Scene({
  sim, cam, doors, entities,
}: {
  sim: ScapePlayerState;
  cam: Cam;
  doors: Door[];
  entities: Ent[];
}) {
  const c = cameraFor(cam);
  return (
    <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={SKY} showGrid={false} showAxes={false}>
      <Scene3D.Camera position={c.pos} target={c.target} fov={c.fov} />
      {/* dusk: low warm key, cool fill, a neon-pink point over the plaza */}
      <Scene3D.AmbientLight color="#6a5a7e" intensity={0.7} />
      <Scene3D.DirectionalLight direction={[0.4, 0.85, 0.35]} color="#ffc89a" intensity={0.8} />
      <Scene3D.PointLight position={[25, 8, 22]} color="#ff2d95" intensity={0.5} />
      <Scene3D.PointLight position={[40, 6, 16]} color="#18e0d8" intensity={0.35} />

      <City3D doors={doors} entities={entities} />
      <Npcs3D entities={entities} />
      <Player3D px={sim.px} py={sim.py} facing={sim.body.facing} costumeColor={resolveCostume(sim.body.costume.color)} />
      <PathMarkers path={sim.path} />
    </Scene3D>
  );
}
