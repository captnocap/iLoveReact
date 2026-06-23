// editors/model/studio/dialogs/AddShapeDialog.tsx — lifted verbatim from editors/model/Studio.tsx (req_1390). No behavior change.
import { useState } from 'react';
import { Box, Col, Pressable, Row, Text } from '@reactjit/primitives';
import { STUDIO, T } from '../config';
import { Z } from '../chrome/zlayers';
import { unitsToMeters } from '../helpers';
import { NumberField } from '../panels/NumberField';
import { clampSides, cone, cuboid, cylinder, icosphere, ICOSPHERE_SUBDIV_MAX, plane, pyramid, SHAPE_SIDES_MAX, SHAPE_SIDES_MIN, sphere, type EditMesh } from '../../editMesh';
import { seedMeshFromPiece, seedNameFromPiece } from '../../seedFromPiece';

// ── Add-mesh dialog (req_0972/0973) ───────────────────────────────────────────
// The first shape is a cube; pick its diameter (= width = depth) and height in
// MODELING UNITS (Blockbench-style: 16 units = 1 tile = 1 m, the same basis
// per-face UV/texels use), then confirm. Default 16 fills exactly the center
// tile's 16×16 grid. This changes nothing about the grid — the grid IS the ruler
// these units read against (USER req_0973).


// The "Add" dialog (req_1056): pick a SHAPE beyond the cube, set its Blockbench
// params — diameter (= width = depth) + height, plus a "sides" count (3..48) for
// the round shapes — and confirm. Builds the topological EditMesh so the new part
// is fully editable (loop cut / extrude / rig), unlike the render-only geometry
// registry. cuboid/cylinder/cone/pyramid/plane share the 16-units basis.
type ShapeKind = 'cube' | 'cylinder' | 'cone' | 'pyramid' | 'plane' | 'sphere' | 'icosphere';
const SHAPE_KINDS: { kind: ShapeKind; label: string }[] = [
  { kind: 'cube', label: 'Cube' }, { kind: 'cylinder', label: 'Cylinder' }, { kind: 'cone', label: 'Cone' },
  { kind: 'pyramid', label: 'Pyramid' }, { kind: 'plane', label: 'Plane' },
  { kind: 'sphere', label: 'Sphere' }, { kind: 'icosphere', label: 'Icosphere' },
];
// round-bodied shapes (sphere/icosphere) are sized by DIAMETER alone — no separate
// height — and the 'sides' knob means longitude segments (icosphere uses subdiv).
const ROUND_BODIES: ShapeKind[] = ['sphere', 'icosphere'];

// START FROM A BUILD PRIMITIVE (req_1684/1693): the same wall/floor/stairs the iso
// world editor places, opened as an editable mesh so you can cut a window, bolt on a
// poster, or add a railing — then Compile it back out as a custom placeable piece.
// Each seed lowers a real BUILD_CATALOG piece through seedMeshFromPiece (the shared
// pieceVisualShapes decomposition), so the mesh matches what the world editor renders.
const BUILD_SEEDS: { key: string; pieceId: string; edit?: string; label: string }[] = [
  { key: 'wall', pieceId: 'wall.concrete.common', label: 'Wall' },
  { key: 'halfwall', pieceId: 'wall.concrete.common', edit: 'halfHeight', label: 'Half Wall' },
  { key: 'window', pieceId: 'wall.stucco.window', label: 'Window Wall' },
  { key: 'floor', pieceId: 'floor.concrete.common', label: 'Floor' },
  { key: 'stairs', pieceId: 'stairs.concrete.common', label: 'Stairs' },
  { key: 'ramp', pieceId: 'ramp.concrete.common', label: 'Ramp' },
];

export function AddShapeDialog(props: { onCancel: () => void; onConfirm: (mesh: EditMesh, name: string) => void }) {
  const u = STUDIO.unitsPerTile;
  const [shape, setShape] = useState<ShapeKind>('cube');
  // When set, the part is SEEDED from a build piece instead of a parametric shape —
  // the shape sliders hide (a catalog piece carries its own authored size).
  const [seedKey, setSeedKey] = useState<string | null>(null);
  const seed = seedKey ? BUILD_SEEDS.find((s) => s.key === seedKey) ?? null : null;
  const [dia, setDia] = useState(u);   // default 16 u = one tile
  const [hgt, setHgt] = useState(u);
  const [sides, setSides] = useState(16);
  const [subdiv, setSubdiv] = useState(1); // icosphere subdivisions
  const hasHeight = !seed && shape !== 'plane' && !ROUND_BODIES.includes(shape);
  const hasSides = !seed && (shape === 'cylinder' || shape === 'cone' || shape === 'sphere');
  const hasSubdiv = !seed && shape === 'icosphere';
  const fmtTiles = (units: number) => `${(units / u).toFixed(2)} tile`;
  const meta = SHAPE_KINDS.find((s) => s.kind === shape)!;
  const confirmName = seed ? seedNameFromPiece(seed.pieceId) : meta.label;
  const build = (): EditMesh => {
    if (seed) return seedMeshFromPiece(seed.pieceId, seed.edit);
    const d = unitsToMeters(dia), h = unitsToMeters(hgt), r = unitsToMeters(dia) / 2;
    switch (shape) {
      case 'cylinder': return cylinder(r, h, sides);
      case 'cone': return cone(r, h, sides);
      case 'pyramid': return pyramid(d, h, d);
      case 'plane': return plane(d, d);
      case 'sphere': return sphere(r, sides);
      case 'icosphere': return icosphere(r, subdiv);
      default: return cuboid(d, h, d);
    }
  };
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#03060caa', zIndex: Z.modal }}>
      <Col style={{ width: 360, gap: 11, padding: 16, borderRadius: 10, backgroundColor: T.panelSolid, borderWidth: 1, borderColor: '#2c4a6a' }}>
        <Text fontSize={13} color={T.text} style={{ fontWeight: '800' }}>Add Shape</Text>
        <Row style={{ gap: 5, flexWrap: 'wrap' }}>
          {SHAPE_KINDS.map((s) => {
            const on = !seed && shape === s.kind;
            return <Pressable key={s.kind} onPress={() => { setShape(s.kind); setSeedKey(null); }} style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: on ? '#2a3f5e' : '#13233aee', borderWidth: 1, borderColor: on ? '#5b8fd6' : '#2c4a6a' }}><Text fontSize={11} color={on ? '#cfe2ff' : T.dim} style={{ fontFamily: 'monospace' }}>{s.label}</Text></Pressable>;
          })}
        </Row>
        {/* START FROM A BUILD PIECE (req_1693): seed the editor with a real wall/floor/
            stairs to modify + Compile back into a custom placeable piece. */}
        <Text fontSize={10} color={T.dim} style={{ marginTop: 2 }}>From build piece</Text>
        <Row style={{ gap: 5, flexWrap: 'wrap' }}>
          {BUILD_SEEDS.map((s) => {
            const on = seedKey === s.key;
            return <Pressable key={s.key} onPress={() => setSeedKey(s.key)} style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: on ? '#3a2f5e' : '#13233aee', borderWidth: 1, borderColor: on ? '#9b7fd6' : '#2c4a6a' }}><Text fontSize={11} color={on ? '#e2cfff' : T.dim} style={{ fontFamily: 'monospace' }}>{s.label}</Text></Pressable>;
          })}
        </Row>
        <Text fontSize={10} color={T.dim}>{`Units: ${u} = 1 tile (1 m). Same basis as per-face UV. The grid is unchanged.`}</Text>
        {seed ? null : <NumberField label="diameter" value={dia} onChange={setDia} min={1} max={u * STUDIO.gridTiles} step={1} snap={0.5} suffix="u" />}
        {hasHeight ? <NumberField label="height" value={hgt} onChange={setHgt} min={1} max={u * STUDIO.gridTiles * 2} step={1} snap={0.5} suffix="u" /> : null}
        {hasSides ? <NumberField label="sides" value={sides} onChange={(n) => setSides(clampSides(n))} min={SHAPE_SIDES_MIN} max={SHAPE_SIDES_MAX} step={1} snap={1} /> : null}
        {hasSubdiv ? <NumberField label="subdiv" value={subdiv} onChange={(n) => setSubdiv(Math.max(0, Math.min(ICOSPHERE_SUBDIV_MAX, Math.round(n))))} min={0} max={ICOSPHERE_SUBDIV_MAX} step={1} snap={1} /> : null}
        <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>
          {seed ? `= ${confirmName} — editable mesh from a build piece`
            : shape === 'plane' ? `= ${fmtTiles(dia)} × ${fmtTiles(dia)} flat`
            : ROUND_BODIES.includes(shape) ? `= ${fmtTiles(dia)} ∅ ${shape}${hasSides ? ` · ${clampSides(sides)} sides` : ` · subdiv ${subdiv}`}`
            : `= ${fmtTiles(dia)} ∅ × ${fmtTiles(hgt)}${hasSides ? ` · ${clampSides(sides)} sides` : ''}`}
        </Text>
        <Row style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Pressable onPress={props.onCancel} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' }}><Text fontSize={11} color={T.dim}>Cancel</Text></Pressable>
          <Pressable onPress={() => props.onConfirm(build(), confirmName)} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#1c3a2a', borderWidth: 1, borderColor: '#2f7a4f' }}><Text fontSize={11} color="#7fd6a0" style={{ fontWeight: '800' }}>Add</Text></Pressable>
        </Row>
      </Col>
    </Box>
  );
}
