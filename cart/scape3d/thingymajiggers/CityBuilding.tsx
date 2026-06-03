// A city building: textured facade from ground to roof (so it fills any relief it
// stands on) + roof cap + neon rim cage. A building is just a thingymajigger with a
// big footprint; it owns its own height scale and facade textures here.
import { Fragment } from 'react';
import { Scene3D } from '@reactjit/primitives';
import { HEIGHTS } from '../world/citymap';
import { buildingFacade, buildingRoof, neonRim, windowGlow } from '../render3d/palette3d';
import { facadeTex } from '../render3d/textures';
import { defineThingymajigger, type ThingProps } from './kit';

// SCALE CONTRACT: 1 tile = 1 metre, and the PLAYER (~2.0 units, the human anchor)
// is never rescaled — only the vertical world. A storey ≈ 3.5 m.
const HEIGHT_SCALE = 4.6; // HEIGHTS[1.6..4.4] → 7.4 m (≈2-storey trap house) … 20.2 m (≈6-storey tower)

// Per-style facade textures (built once, host-cached by content hash).
const FACADE_TEX = [0, 1, 2, 3].map((s) => facadeTex(buildingFacade(s), windowGlow(s), 6, 16));

interface BuildingProps extends ThingProps { w: number; d: number; tier: number; style: number; }

export default defineThingymajigger<BuildingProps>({
  kind: 'cityBuilding',
  size: [1, 1], // authored footprint comes from the citymap; size here is nominal
  blocks: true,
  // x,z = the building's corner origin (ax,ay); baseY = terrain under its centre.
  Mesh: ({ x, z, baseY, w, d, tier, style }) => {
    const cx = x + w / 2;
    const cz = z + d / 2;
    const top = baseY + HEIGHTS[tier] * HEIGHT_SCALE;
    const t = 0.12;
    return (
      <Fragment>
        <Scene3D.Mesh geometry="box" material="#ffffff" texture={FACADE_TEX[style]}
          position={[cx, top / 2, cz]} sizeX={w} sizeY={top} sizeZ={d} />
        <Scene3D.Mesh geometry="box" material={buildingRoof(style)}
          position={[cx, top + 0.05, cz]} sizeX={w - 0.04} sizeY={0.14} sizeZ={d - 0.04} />
        {/* neon rim: top frame + corner posts */}
        <Scene3D.Mesh geometry="box" material={neonRim(style)} position={[cx, top, cz - d / 2]} sizeX={w + t} sizeY={t} sizeZ={t} />
        <Scene3D.Mesh geometry="box" material={neonRim(style)} position={[cx, top, cz + d / 2]} sizeX={w + t} sizeY={t} sizeZ={t} />
        <Scene3D.Mesh geometry="box" material={neonRim(style)} position={[cx - w / 2, top, cz]} sizeX={t} sizeY={t} sizeZ={d + t} />
        <Scene3D.Mesh geometry="box" material={neonRim(style)} position={[cx + w / 2, top, cz]} sizeX={t} sizeY={t} sizeZ={d + t} />
        {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz], k) => (
          <Scene3D.Mesh key={k} geometry="box" material={neonRim(style)}
            position={[cx + (sx * w) / 2, top / 2, cz + (sz * d) / 2]} sizeX={t} sizeY={top} sizeZ={t} />
        ))}
      </Fragment>
    );
  },
});
