// A deluxe modern bed. A bed should read BIGGER than the player (≈1 tile wide, ~2.5
// tall), so the footprint is 4×2. The mesh below is authored in the original 2×1
// design space and scaled 2× across the floor plane (S) — heights are left alone so
// the bed stays low, just longer + wider. Tune the look by editing the design numbers;
// tune the size by editing S + the footprint together.
import { Fragment } from 'react';
import { Scene3D } from '@reactjit/runtime/primitives';
import { defineThingymajigger } from './kit';

const S = 2; // 2×1 design space → 4×2 footprint

export default defineThingymajigger({
  kind: 'bed',
  size: [4, 2],
  stash: 1, // plenty of room under the slatted frame
  examine: 'A sturdy hardwood bed with a plush mattress, a thick duvet, and way too many pillows. The gap underneath is perfect for hiding things.',
  Mesh: ({ x, z, baseY }) => {
    // lx/lz = design-space floor offset (scaled by S); ly = height (kept 1:1).
    const part = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color: string) => (
      <Scene3D.Mesh geometry="box" material={color}
        position={[x + lx * S, baseY + ly, z + lz * S]} sizeX={sx * S} sizeY={sy} sizeZ={sz * S} />
    );
    return (
      <Fragment>
        {/* HARDWOOD FRAME */}
        {part(0.1, 0.45, 0.5, 0.1, 0.9, 0.9, '#3d2314')}   {/* headboard */}
        {part(1.9, 0.25, 0.5, 0.1, 0.5, 0.9, '#3d2314')}   {/* footboard */}
        {part(1.0, 0.15, 0.05, 1.8, 0.2, 0.05, '#3d2314')} {/* side rail */}
        {part(1.0, 0.15, 0.95, 1.8, 0.2, 0.05, '#3d2314')} {/* side rail */}
        {part(1.0, 0.2, 0.5, 1.75, 0.05, 0.88, '#2b180d')} {/* base platform */}

        {/* PLUSH MATTRESS */}
        {part(1.0, 0.3, 0.5, 1.7, 0.2, 0.86, '#e8e4dc')}

        {/* BEDDING: SLATE BLUE DUVET */}
        {part(1.25, 0.42, 0.5, 1.2, 0.05, 0.88, '#2c3e50')}  {/* covers the lower half */}
        {part(1.84, 0.325, 0.5, 0.05, 0.24, 0.88, '#2c3e50')} {/* drapes over the footboard */}

        {/* PILLOWS */}
        {part(0.35, 0.44, 0.25, 0.3, 0.08, 0.38, '#ffffff')} {/* left */}
        {part(0.35, 0.44, 0.75, 0.3, 0.08, 0.38, '#ffffff')} {/* right */}
        {part(0.5, 0.45, 0.5, 0.15, 0.15, 0.25, '#c0392b')}  {/* throw pillow */}
      </Fragment>
    );
  },
});
