// model/buildPieceStarter.ts — semantic build pieces opened as editable meshes.
//
// The world build palette already owns each piece's real visual decomposition
// (boxes for plates/frames/steps, wedges for ramps and roof slopes). This module
// is only the adapter from that established shape vocabulary to EditMesh. It does
// not carry a second set of floor/wall/stair dimensions.
import {
  cuboid,
  fullFaceUV,
  mergeMesh,
  rotateVerts,
  translateVerts,
  type EditMesh,
  type V3,
} from './editMesh';
import { buildPieceStarter, type BuildPieceStarterId } from '../data/buildStarters';
import { catalogRowFor, rowHex } from '../world/buildCatalog';
import { pieceVisualShapes, type VisualBox, type VisualRamp, type VisualShape } from '../world/pieceShapes';
import type { ModelPart } from '../data/types';

const DEG = Math.PI / 180;

function allVerts(mesh: EditMesh): number[] {
  return mesh.verts.map((_, index) => index);
}

/** The editable twin of pieceThumbMesh's wedge: low at local -Z, high at +Z. */
function rampMesh(ramp: VisualRamp): EditMesh {
  const halfW = ramp.width / 2;
  const halfD = ramp.depth / 2;
  const height = Math.max(ramp.height, ramp.slabThickness);
  const verts: V3[] = [
    [-halfW, 0, -halfD], [halfW, 0, -halfD],
    [halfW, 0, halfD], [-halfW, 0, halfD],
    [halfW, height, halfD], [-halfW, height, halfD],
  ];
  let mesh = fullFaceUV({
    verts,
    faces: [
      { loop: [0, 5, 4, 1] }, // slope
      { loop: [2, 4, 5, 3] }, // high wall
      { loop: [0, 1, 2, 3] }, // bottom
      { loop: [1, 4, 2] },    // right
      { loop: [0, 3, 5] },    // left
    ],
  });
  if (ramp.yawDegrees !== 0) {
    mesh = rotateVerts(mesh, allVerts(mesh), [0, 0, 0], 1, ramp.yawDegrees * DEG);
  }
  return translateVerts(mesh, allVerts(mesh), [ramp.x, ramp.y, ramp.z]);
}

function boxMesh(box: VisualBox): EditMesh {
  let mesh = cuboid(box.sx, box.sy, box.sz);
  if (box.yawDegrees !== 0) {
    mesh = rotateVerts(mesh, allVerts(mesh), [0, 0, 0], 1, box.yawDegrees * DEG);
  }
  return translateVerts(mesh, allVerts(mesh), [box.cx, box.cy, box.cz]);
}

function editableShape(shape: VisualShape): EditMesh {
  const opacity = shape.kind === 'box' ? shape.box.opacity : shape.ramp.opacity;
  const mesh = shape.kind === 'box' ? boxMesh(shape.box) : rampMesh(shape.ramp);
  if (opacity === undefined || opacity >= 1) return mesh;
  return { ...mesh, faces: mesh.faces.map((face) => ({ ...face, glass: true })) };
}

/**
 * Seed one ordinary model part from the existing catalog piece. Compound pieces
 * remain disconnected face islands inside that part (steps stay steps, an
 * elevator stays a frame), so they are immediately selectable and sculptable
 * without filling the Outliner with renderer-internal rows.
 */
export function buildPieceStarterParts(starterId: BuildPieceStarterId): ModelPart[] {
  const starter = buildPieceStarter(starterId);
  if (!starter) return [];
  const row = catalogRowFor(starter.catalogPieceId);
  if (!row || row.kind !== starter.kind) return [];

  const shapes = pieceVisualShapes({
    id: `build-starter:${starterId}`,
    pieceId: row.id,
    x: 0,
    y: 0,
    z: 0,
    yawDegrees: 0,
  }, rowHex(row));
  const mergeShapes = (source: readonly VisualShape[]): EditMesh | null => {
    let mesh: EditMesh | null = null;
    for (const shape of source) {
      const next = editableShape(shape);
      mesh = mesh ? mergeMesh(mesh, next, [0, 0, 0]) : next;
    }
    return mesh;
  };

  // Door variants preserve the old Studio compiler's deep contract: the static
  // wall frame and movable panel are separate, meaningfully named Outliner parts.
  // `VisualBox.door` comes from the semantic wall edit decomposition; no tile
  // kind or geometry guess participates in this split.
  if (starter.edit === 'door' || starter.edit === 'garageDoor') {
    const leafShapes = shapes.filter((shape) => shape.kind === 'box' && shape.box.door === true);
    const frameShapes = shapes.filter((shape) => !(shape.kind === 'box' && shape.box.door === true));
    const frame = mergeShapes(frameShapes);
    const leaf = mergeShapes(leafShapes);
    if (!frame || !leaf) return [];
    return [
      {
        id: `part:build-starter:${starterId}:frame`,
        name: 'Door Frame',
        mesh: frame,
        visible: true,
        color: rowHex(row),
      },
      {
        id: `part:build-starter:${starterId}:leaf`,
        name: 'Door Leaf',
        mesh: leaf,
        visible: true,
        color: leafShapes[0]?.kind === 'box' ? leafShapes[0].box.color : '#0c1018',
      },
    ];
  }

  const mesh = mergeShapes(shapes);
  if (!mesh) return [];

  return [{
    id: `part:build-starter:${starterId}`,
    name: starter.name.replace(/ Piece$/, ''),
    mesh,
    visible: true,
    color: rowHex(row),
  }];
}
