import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { Building } from '../design';
import { buildingFootprint, buildingHeightMeters, resolveFaceSkin } from '../world/buildings';
import { buildingYawDegrees, yawAboutCenter } from './buildingTransform';
import { Glass } from './materials';

// Real glass windows on a building's FRONT wall — actual translucent, breakable
// panes (Glass material), proud of the wall so you see through them into the
// flat-shaded shell behind. This is the 3D-mesh counterpart to the painted
// facade skins (BuildingFacades.tsx, which bakes windows into a wall texture):
// we only draw mesh windows where there is NO painted facade, i.e. a 'plain'
// front face, so the two never double up. The panes sit a hair off the wall to
// avoid z-fighting; a tidy grid is sized to the wall so windows stay roughly
// square whatever the building's footprint.

const WINDOW_GLASS = Glass({ color: '#bcd3dd', opacity: 0.3 });

// Pane geometry, in meters.
const THICKNESS = 0.1; // depth into/out of the wall
const PROUD = 0.05; // how far the pane stands off the wall face
const MAX_PANE_W = 1.4;
const MAX_PANE_H = 1.5;

export function BuildingWindows(props: { building: Building }) {
  const b = props.building;
  // Only plain front faces get mesh windows; facade-skinned faces already paint
  // their own windows into the wall texture.
  if (resolveFaceSkin(b, b.doorSide) !== 'plain') return null;

  const f = buildingFootprint(b);
  const height = buildingHeightMeters(b);
  const horizontal = b.doorSide === 'north' || b.doorSide === 'south';

  // The wall the front faces, and the outward offset that lifts the pane proud.
  const wallZ = b.doorSide === 'north' ? f.maxZ + PROUD : f.minZ - PROUD;
  const wallX = b.doorSide === 'east' ? f.maxX + PROUD : f.minX - PROUD;

  // Span the wall runs along (X for north/south, Z for east/west).
  const acrossMin = horizontal ? f.minX : f.minZ;
  const acrossMax = horizontal ? f.maxX : f.maxZ;
  const span = acrossMax - acrossMin;

  // A grid sized to the wall: ~one window per 2.4 m across, ~one row per 3 m up.
  const cols = Math.max(1, Math.min(5, Math.round(span / 2.4)));
  const rows = Math.max(1, Math.min(4, Math.floor(height / 3)));
  const cellW = span / cols;
  const cellH = height / (rows + 1); // +1 leaves a header/sill margin top and bottom
  const paneW = Math.min(MAX_PANE_W, cellW * 0.62);
  const paneH = Math.min(MAX_PANE_H, cellH * 0.66);

  const panes: { x: number; y: number; z: number }[] = [];
  for (let r = 0; r < rows; r++) {
    const y = b.y + (r + 1) * cellH; // row centers, skipping the ground sill band
    for (let c = 0; c < cols; c++) {
      const across = acrossMin + (c + 0.5) * cellW;
      panes.push(
        horizontal ? { x: across, y, z: wallZ } : { x: wallX, y, z: across },
      );
    }
  }

  const scale: [number, number, number] = horizontal
    ? [paneW, paneH, THICKNESS]
    : [THICKNESS, paneH, paneW];

  const yaw = buildingYawDegrees(b);
  return (
    <>
      {panes.map((p, i) => {
        const [wx, wz] = yawAboutCenter(b, p.x, p.z);
        return (
          <Scene3D.Mesh
            key={i}
            geometry={Geometry.Box}
            params={{ width: 1, height: 1, depth: 1 }}
            scale={scale}
            rotation={[0, yaw, 0]}
            material={WINDOW_GLASS}
            position={[wx, p.y, wz]}
          />
        );
      })}
    </>
  );
}
