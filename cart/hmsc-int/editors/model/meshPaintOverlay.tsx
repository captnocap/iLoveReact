// editors/model/meshPaintOverlay.tsx — the hovered-face grid OVERLAY for PAINT mode
// (the corrected painter, req_1288). Split from meshPaint (the pure math) so the math
// stays import-clean + unit-testable; this file owns the only React/primitive deps.
//
// Draws the uniform-world cell grid on the face under the cursor (so the user SEES the
// cells they'll paint) plus the hovered cell highlighted, projected through the SAME
// view the host renders (meshSelect.makeProjector). REF-DRIVEN (req_1203): reads the
// live hover via `getHover()` and self-ticks, so moving the cursor or painting never
// re-renders the parent viewport.

import { useInterval, useRerender } from '@reactjit/hooks';
import { Box } from '@reactjit/primitives';
import { makeProjector, type CameraSnap } from './meshSelect';
import { faceCellGrid, uvToWorld, type FaceHit, type PaintTarget } from './meshPaint';
import type { V3 } from './editMesh';

const DEG = Math.PI / 180;

type Proj = { x: number; y: number; front: boolean };

function Line(props: { a: Proj; b: Proj; color: string; thick: number; opacity?: number }) {
  if (!props.a.front || !props.b.front) return null;
  const dx = props.b.x - props.a.x, dy = props.b.y - props.a.y;
  const len = Math.hypot(dx, dy) || 0.001;
  const angle = Math.atan2(dy, dx) / DEG;
  return <Box style={{ position: 'absolute', left: (props.a.x + props.b.x) / 2 - len / 2, top: (props.a.y + props.b.y) / 2 - props.thick / 2, width: len, height: props.thick, borderRadius: props.thick / 2, backgroundColor: props.color, opacity: props.opacity ?? 1, transform: { rotate: angle } }} />;
}

export function PaintGridOverlay(props: {
  parts: PaintTarget[];
  getHover: () => FaceHit | null;
  cell: number;
  color: string;
  camSnap: () => CameraSnap;
}) {
  const repaint = useRerender();
  useInterval(repaint, 33);

  const out: any[] = [];
  const hover = props.getHover();
  const target = hover ? props.parts[hover.partIndex] : null;
  const face = target && hover ? target.mesh.faces[hover.faceIndex] : null;
  if (target && hover && face) {
    const mesh = target.mesh, lift = target.lift;
    const grid = faceCellGrid(mesh, hover.faceIndex, props.cell);
    const baseProj = makeProjector(props.camSnap());
    const proj = (p: V3): Proj => { const q = baseProj([p[0], p[1] + lift, p[2]]); return { x: q.x, y: q.y, front: q.front }; };

    // the face outline (always — context, even for non-quad faces).
    const loopW = face.loop.map((vi) => mesh.verts[vi]);
    for (let i = 0; i < loopW.length; i += 1) {
      out.push(<Line key={`o${i}`} a={proj(loopW[i])} b={proj(loopW[(i + 1) % loopW.length])} color="#7fd6c0" thick={1.6} opacity={0.9} />);
    }

    if (grid) {
      // A uniform-world cell line at uv = u0 + k*cuv, CLIPPED to the face: sample along
      // it and connect only points inside the face's UV hull.
      const SAMPLES = 10;
      const gridLine = (key: string, fixed: number, lo: number, hi: number, vertical: boolean) => {
        let prev: Proj | null = null, prevIn = false;
        for (let s = 0; s <= SAMPLES; s += 1) {
          const tt = lo + ((hi - lo) * s) / SAMPLES;
          const r = vertical ? uvToWorld(mesh, face, fixed, tt) : uvToWorld(mesh, face, tt, fixed);
          const p = r ? proj(r.world) : null;
          const inside = !!r && r.inside;
          if (p && prev && inside && prevIn) out.push(<Line key={`${key}-${s}`} a={prev} b={p} color="#5fe0bf" thick={1.0} opacity={0.6} />);
          prev = p; prevIn = inside;
        }
      };
      for (let k = 0; k <= grid.nu; k += 1) gridLine(`gv${k}`, Math.min(grid.u0 + k * grid.cuv, grid.u1), grid.v0, grid.v1, true);
      for (let k = 0; k <= grid.nv; k += 1) gridLine(`gh${k}`, Math.min(grid.v0 + k * grid.cuv, grid.v1), grid.u0, grid.u1, false);

      // the cell under the cursor — outline + centre dot, through the same uv→world map.
      const cu0 = grid.u0 + hover.cu * grid.cuv, cu1 = Math.min(grid.u0 + (hover.cu + 1) * grid.cuv, grid.u1);
      const cv0 = grid.v0 + hover.cv * grid.cuv, cv1 = Math.min(grid.v0 + (hover.cv + 1) * grid.cuv, grid.v1);
      const cs = [uvToWorld(mesh, face, cu0, cv0), uvToWorld(mesh, face, cu1, cv0), uvToWorld(mesh, face, cu1, cv1), uvToWorld(mesh, face, cu0, cv1)];
      if (cs.every((r) => r)) {
        const q = cs.map((r) => proj((r as { world: V3 }).world));
        for (let i = 0; i < 4; i += 1) out.push(<Line key={`hc${i}`} a={q[i]} b={q[(i + 1) % 4]} color={props.color} thick={2.6} />);
        const cr = uvToWorld(mesh, face, (cu0 + cu1) / 2, (cv0 + cv1) / 2);
        const ctr = cr ? proj(cr.world) : null;
        if (ctr && ctr.front) out.push(<Box key="hcdot" style={{ position: 'absolute', left: ctr.x - 4, top: ctr.y - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: props.color, borderWidth: 1, borderColor: '#0008' }} />);
      }
    }
  }

  return <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, pointerEvents: 'none', overflow: 'visible' }}>{out}</Box>;
}
