// A grimy, detailed toilet. 1×1 footprint.
import { Fragment } from 'react';
import { Scene3D } from '@reactjit/primitives';
import { defineThingymajigger } from './kit';

export default defineThingymajigger({
  kind: 'toilet',
  size: [1, 1],
  stash: 1, // the cistern — a classic place to tape something behind
  examine: 'A grimy toilet with a crooked tank lid and a dubious seat. Plenty of room behind the cistern.',
  Mesh: ({ x, z, baseY }) => (
    <Fragment>
      {/* Base / Pedestal */}
      <Scene3D.Mesh geometry="box" material="#c5cad1" position={[x + 0.5, baseY + 0.1, z + 0.5]} sizeX={0.25} sizeY={0.2} sizeZ={0.35} />

      {/* Main Bowl */}
      <Scene3D.Mesh geometry="box" material="#d8dde2" position={[x + 0.5, baseY + 0.25, z + 0.55]} sizeX={0.4} sizeY={0.15} sizeZ={0.5} />

      {/* Seat (closed, slightly discolored) */}
      <Scene3D.Mesh geometry="box" material="#e2e6e9" position={[x + 0.5, baseY + 0.34, z + 0.58]} sizeX={0.42} sizeY={0.04} sizeZ={0.52} />

      {/* Tank / Cistern (Back wall) */}
      <Scene3D.Mesh geometry="box" material="#d8dde2" position={[x + 0.5, baseY + 0.45, z + 0.18]} sizeX={0.46} sizeY={0.35} sizeZ={0.22} />

      {/* Tank Lid (Crooked/Off-center as requested) */}
      <Scene3D.Mesh geometry="box" material="#d8dde2" position={[x + 0.53, baseY + 0.64, z + 0.20]} sizeX={0.48} sizeY={0.04} sizeZ={0.26} />

      {/* Flush Handle (Dull Metal) */}
      <Scene3D.Mesh geometry="box" material="#95a5a6" position={[x + 0.24, baseY + 0.55, z + 0.3]} sizeX={0.06} sizeY={0.03} sizeZ={0.06} />

      {/* Plumbing pipe connecting to back/floor */}
      <Scene3D.Mesh geometry="box" material="#7f8c8d" position={[x + 0.5, baseY + 0.05, z + 0.15]} sizeX={0.12} sizeY={0.1} sizeZ={0.25} />
    </Fragment>
  ),
});
