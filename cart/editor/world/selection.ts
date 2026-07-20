import { authoredPieceFor } from './authoredRegistry';
import { authoredMeshBounds } from './authoredMesh';
import { pieceLook, type PlacedPiece } from './pieces';

export type PieceSelectionIntent = 'replace' | 'toggle' | 'connected';

/** Contact is semantic, not a fuzzy proximity group. The small allowance only
 * absorbs authored/serialized float noise at faces intended to coincide. */
export const WORLD_SELECTION_TUNING = Object.freeze({
  contactToleranceMeters: 0.01,
});

type Axis2 = readonly [number, number];
type PieceVolume = {
  cx: number;
  cz: number;
  halfWidth: number;
  halfDepth: number;
  widthAxis: Axis2;
  depthAxis: Axis2;
  minY: number;
  maxY: number;
};

function rotateOffset(x: number, z: number, yawDegrees: number): [number, number] {
  const yaw = yawDegrees * Math.PI / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [x * cos + z * sin, -x * sin + z * cos];
}

/** One placement's oriented bounding volume. Authored meshes retain their
 * asymmetric local min/max offset; catalog pieces use their semantic box. */
export function pieceSelectionVolume(piece: PlacedPiece): PieceVolume | null {
  const authored = authoredPieceFor(piece.pieceId);
  const authoredBounds = authored ? authoredMeshBounds(authored.modelId, authored.pkgId) : null;
  const look = authoredBounds ? null : pieceLook(piece.pieceId);
  if (!authoredBounds && !look) return null;

  const minX = authoredBounds?.minX ?? -(look!.w / 2);
  const maxX = authoredBounds?.maxX ?? (look!.w / 2);
  const minZ = authoredBounds?.minZ ?? -(look!.d / 2);
  const maxZ = authoredBounds?.maxZ ?? (look!.d / 2);
  const localCenterX = (minX + maxX) / 2;
  const localCenterZ = (minZ + maxZ) / 2;
  const [centerX, centerZ] = rotateOffset(localCenterX, localCenterZ, piece.yawDegrees);
  const yaw = piece.yawDegrees * Math.PI / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);

  return {
    cx: piece.x + centerX,
    cz: piece.z + centerZ,
    halfWidth: (maxX - minX) / 2,
    halfDepth: (maxZ - minZ) / 2,
    widthAxis: [cos, -sin],
    depthAxis: [sin, cos],
    minY: piece.y + (authoredBounds?.minY ?? 0),
    maxY: piece.y + (authoredBounds?.maxY ?? look!.h),
  };
}

function projectionRadius(volume: PieceVolume, axis: Axis2): number {
  return volume.halfWidth * Math.abs(volume.widthAxis[0] * axis[0] + volume.widthAxis[1] * axis[1])
    + volume.halfDepth * Math.abs(volume.depthAxis[0] * axis[0] + volume.depthAxis[1] * axis[1]);
}

/** True when two placed semantic volumes overlap or touch. Four OBB axes avoid
 * an angled prop's broad world AABB gluing nearby buildings together. */
export function pieceVolumesTouch(
  a: PieceVolume,
  b: PieceVolume,
  tolerance = WORLD_SELECTION_TUNING.contactToleranceMeters,
): boolean {
  if (a.maxY + tolerance < b.minY || b.maxY + tolerance < a.minY) return false;
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  for (const axis of [a.widthAxis, a.depthAxis, b.widthAxis, b.depthAxis]) {
    const centerDistance = Math.abs(dx * axis[0] + dz * axis[1]);
    if (centerDistance > projectionRadius(a, axis) + projectionRadius(b, axis) + tolerance) return false;
  }
  return true;
}

/** Transitive touching-component selection, returned in stable world order. */
export function connectedPieceIds(pieces: readonly PlacedPiece[], rootId: string): string[] {
  const rootIndex = pieces.findIndex((piece) => piece.id === rootId);
  if (rootIndex < 0) return [];
  const volumes = pieces.map(pieceSelectionVolume);
  if (!volumes[rootIndex]) return [rootId];

  const selected = new Set<number>([rootIndex]);
  const queue = [rootIndex];
  while (queue.length > 0) {
    const index = queue.shift()!;
    const volume = volumes[index]!;
    for (let candidate = 0; candidate < pieces.length; candidate += 1) {
      if (selected.has(candidate) || !volumes[candidate]) continue;
      if (!pieceVolumesTouch(volume, volumes[candidate]!)) continue;
      selected.add(candidate);
      queue.push(candidate);
    }
  }
  return pieces.filter((_, index) => selected.has(index)).map((piece) => piece.id);
}
