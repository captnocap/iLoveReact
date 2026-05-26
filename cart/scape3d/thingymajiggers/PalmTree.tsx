// A stylised, curving palm ~4.2 m tall with dead fronds and coconuts.
import { Fragment } from 'react';
import { Scene3D } from '@reactjit/runtime/primitives';
import { PALM_TRUNK, PALM_FROND } from '../render3d/palette3d';
import { defineThingymajigger } from './kit';

// Extra materials for the upgrade
const DEAD_FROND = '#7a634c'; 
const COCONUT = '#4a2e15';

// Modified ring to accept a specific material for live/dead variations
const ring = (x: number, z: number, baseY: number, tier: number, n: number, len: number, droop: number, y: number, reach: number, mat: string) =>
  Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2 + tier * 0.4;
    return (
      <Scene3D.Mesh key={`f${tier}-${k}`} geometry="box" material={mat}
        position={[x + Math.cos(a) * reach, baseY + y, z + Math.sin(a) * reach]}
        rotation={[droop, -a, 0]} sizeX={len} sizeY={0.05} sizeZ={0.22} />
    );
  });

export default defineThingymajigger({
  kind: 'palm',
  size: [1, 1],
  blocks: true,
  examine: 'A scraggly palm, half its fronds dead. Very Miami.',
  Mesh: ({ x, z, baseY }) => {
    const cx = x + 0.5, cz = z + 0.5; // centre of the 1×1 footprint
    
    // Calculate the top of the trunk so the crown perfectly follows the lean
    const topLeanX = Math.sin(7 * 0.4) * 0.25;
    const topCx = cx + topLeanX;

    return (
      <Fragment>
        {/* SEGMENTED & LEANING TRUNK */}
        {Array.from({ length: 8 }).map((_, i) => {
          // Creates a natural sweeping curve and tapers the trunk slightly towards the top
          const leanX = Math.sin(i * 0.4) * 0.25;
          const radius = 0.16 - (i * 0.008);
          return (
            <Scene3D.Mesh 
              key={`trunk-${i}`} 
              geometry="cylinder" 
              material={PALM_TRUNK} 
              position={[cx + leanX, baseY + 0.25 + (i * 0.5), cz]} 
              radius={radius} 
              sizeY={0.52} 
            />
          );
        })}

        {/* COCONUTS */}
        <Scene3D.Mesh geometry="sphere" material={COCONUT} position={[topCx + 0.2, baseY + 3.8, cz + 0.1]} radius={0.12} />
        <Scene3D.Mesh geometry="sphere" material={COCONUT} position={[topCx - 0.1, baseY + 3.75, cz + 0.2]} radius={0.14} />
        <Scene3D.Mesh geometry="sphere" material={COCONUT} position={[topCx - 0.1, baseY + 3.8, cz - 0.2]} radius={0.11} />

        {/* CROWN BASE */}
        <Scene3D.Mesh geometry="box" material={PALM_FROND} position={[topCx, baseY + 3.9, cz]} sizeX={0.4} sizeY={0.24} sizeZ={0.4} />

        {/* DEAD / DROOPING FRONDS (Steep droop, tucked under) */}
        {ring(topCx, cz, baseY, 0, 6, 1.2, 1.3, 3.6, 0.4, DEAD_FROND)}

        {/* LIVE FRONDS (Varying lengths and outward spread) */}
        {ring(topCx, cz, baseY, 1, 5, 1.8, 0.25, 4.1, 0.9, PALM_FROND)}
        {ring(topCx, cz, baseY, 2, 4, 1.3, 0.6, 3.9, 0.75, PALM_FROND)}
        {ring(topCx, cz, baseY, 3, 3, 0.8, -0.1, 4.3, 0.3, PALM_FROND)}
      </Fragment>
    );
  },
});
