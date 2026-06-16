// editors/model/UVPanel.tsx — the UV preview (req_0981 → Part 5/req_0997). The
// atlas is drawn from the active part's STORED per-corner UVs (`storedUVLayout`),
// NOT a live box-projection — so it is STABLE under vertex/edge moves and only
// restructures when a topology edit (a cut) rewrote the UVs, exactly like
// Blockbench (Part 5.1 of the playbook). The fixed texture square is `texSize`
// texels (STUDIO.unitsPerTile = 16). Each face draws its packed rect (tinted by
// the live normal's axis — X red / Y green / Z blue) with its UV corner loop
// outlined on top. Read-only — a pure VIEW of the stored UVs; the per-island
// UV-edit ops (and the downstream box-net "create texture" step) are the
// design-gated next step (req_1013 removed the "Reset UV" button — resetting the
// mapping to the full-square default was never part of the authoring flow).
//
// It reads the SHARED studio store (studioModel.ts) — the same parts the
// viewport renders in column 4 — so col 3 and col 4 never diverge.

import { useMemo, useState } from 'react';
import { Box, Col, Row, Text } from '@reactjit/primitives';
import { GAME_CHROME } from '../../game';
import { storedUVLayout, type UVLayout, type V2 } from './editMesh';
import { islandColorFor } from './textureize';
import { useStudioModel } from './studioModel';
import { STUDIO } from './Studio';

const T = GAME_CHROME.tokens.color;

const PANEL = {
  /** atlas inset inside the panel column. */
  pad: 10,
  /** fallback width before the first onLayout. */
  fallbackWidth: 248,
  /** the checkerboard backdrop cell size, in px. */
  checker: 8,
} as const;

// one outline segment between two atlas points (already in px, v flipped).
// `transform: rotate` rotates around the box CENTER (the framework ignores a
// transformOrigin — same as ViewCompass), so the box is positioned CENTERED on
// the segment midpoint, then spun to its angle. (Positioning by the start point
// + a 0% origin drew the stray offset lines this replaced.)
const SEG_TH = 1.5;
function Seg(props: { a: V2; b: V2; color: string }) {
  const [ax, ay] = props.a, [bx, by] = props.b;
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 0.001;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const midx = (ax + bx) / 2, midy = (ay + by) / 2;
  return (
    <Box style={{ position: 'absolute', left: midx - len / 2, top: midy - SEG_TH / 2, width: len, height: SEG_TH, backgroundColor: props.color, borderRadius: 1, transform: { rotate: angle } }} />
  );
}

export function StudioUVPanel() {
  const model = useStudioModel();
  const part = model.activePart;
  const [boxW, setBoxW] = useState(PANEL.fallbackWidth);

  const texSize = STUDIO.unitsPerTile;
  // STORED UVs, not a live projection — so the atlas holds still under geometry
  // edits. The version bump only changes it when a topology edit rewrote the UVs.
  const layout: UVLayout | null = useMemo(
    () => (part ? storedUVLayout(part.mesh, texSize) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [part?.id, part?.version, texSize],
  );

  if (!part) {
    return (
      <Box style={{ padding: 14, borderRadius: 8, backgroundColor: '#0b1320aa', borderWidth: 1, borderColor: '#27364a' }}>
        <Text fontSize={11} color={T.dim} style={{ fontFamily: 'monospace' }}>select a part to see its UV layout</Text>
      </Box>
    );
  }
  if (!layout || layout.faces.length === 0) {
    return (
      <Box style={{ padding: 14, borderRadius: 8, backgroundColor: '#0b1320aa', borderWidth: 1, borderColor: '#27364a' }}>
        <Text fontSize={11} color={T.dim} style={{ fontFamily: 'monospace' }}>part has no unwrapped faces yet</Text>
      </Box>
    );
  }

  // SELECTION-SCOPED (Part 5.2): when faces are selected in the viewport, show only
  // their islands (Blockbench shows the selected face's UV — full square on a base
  // cube, half-square after a loop cut). Nothing selected → the whole atlas.
  const sel = model.selectedFaces;
  const faces = sel.length ? layout.faces.filter((f) => sel.includes(f.faceIndex)) : layout.faces;
  // fit the atlas to the column width; never upscale past 1px/unit·zoom so a tiny
  // part doesn't balloon. The atlas is square-ish, so height follows from scale.
  const avail = Math.max(40, boxW - PANEL.pad * 2);
  const scale = layout.width > 0 ? avail / layout.width : 1;
  const atlasPxW = layout.width * scale;
  const atlasPxH = layout.height * scale;
  // flip v so +v (model up / +z) reads UP in the atlas (Blockbench convention).
  const toPx = (p: V2): V2 => [p[0] * scale, (layout.height - p[1]) * scale];

  return (
    <Col
      style={{ gap: 8, width: '100%' }}
      onLayout={(lr: any) => { const w = Number(lr.width ?? 0); if (w > 0) setBoxW(w); }}
    >
      <Row style={{ gap: 8, alignItems: 'center' }}>
        <Text fontSize={10} color={T.text} style={{ fontFamily: 'monospace', fontWeight: '800' }}>
          {`${layout.width.toFixed(0)}×${layout.height.toFixed(0)}`}
        </Text>
        <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>
          {sel.length ? `${faces.length} selected` : `${layout.faces.length} face${layout.faces.length === 1 ? '' : 's'}`}
        </Text>
      </Row>

      {/* the atlas surface — checkerboard backdrop + one rect per face */}
      <Box style={{ width: atlasPxW, height: atlasPxH, position: 'relative', backgroundColor: '#070b12', borderWidth: 1, borderColor: '#27364a', borderRadius: 4, overflow: 'hidden' }}>
        {faces.map((f) => {
          // SAME color as the 3D model + the PNG export (req_1072): islandColorFor,
          // per (part, face) — so the UV panel reads EXACTLY what's on the model.
          const color = islandColorFor(part.id, f.faceIndex);
          const rx = f.rect.x * scale;
          const rw = f.rect.w * scale;
          const rh = f.rect.h * scale;
          // rect top in flipped space.
          const ry = (layout.height - f.rect.y - f.rect.h) * scale;
          return (
            <Box key={f.faceIndex} style={{ position: 'absolute', left: rx, top: ry, width: rw, height: rh, backgroundColor: `${color}55` }}>
              {rw > 18 && rh > 12 ? (
                <Text fontSize={8} color={color} style={{ position: 'absolute', left: 2, top: 1, fontFamily: 'monospace', opacity: 0.95 }}>
                  {`${f.faceIndex}${f.sign < 0 ? '−' : '+'}${f.axis}`}
                </Text>
              ) : null}
            </Box>
          );
        })}
        {/* projected face outlines drawn over the rects (the real UV shape) */}
        {faces.map((f) => {
          const color = islandColorFor(part.id, f.faceIndex);
          const pts = f.poly.map(toPx);
          return pts.map((p, i) => (
            <Seg key={`${f.faceIndex}-${i}`} a={p} b={pts[(i + 1) % pts.length]} color={color} />
          ));
        })}
      </Box>
    </Col>
  );
}
