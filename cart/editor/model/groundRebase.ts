// editor/model/groundRebase.ts — the PLACEABLE frame shift (req_2751), moved
// out of world/authoredMesh so the package store can bake placeable-frame
// collision (req_3431) without importing the world layer's resolver cycle.
//
// GROUND-REBASE: a placeable's mesh is based at y=0 no matter where it sat in
// the studio editor — a wall picture authored 1.5m up is the same placeable as
// one authored on the floor. Placement y IS the base; vertical position in the
// WORLD comes from terrain + storey + the place-time lift, never from
// studio-space authoring. Copies before shifting (the source array belongs to
// the package resolver / live edit state).
export function groundRebase(vertices: Float32Array): Float32Array {
  let minY = Infinity;
  for (let i = 1; i + 1 < vertices.length; i += 8) if (vertices[i]! < minY) minY = vertices[i]!;
  if (!Number.isFinite(minY) || Math.abs(minY) < 1e-4) return vertices;
  const out = new Float32Array(vertices);
  for (let i = 1; i + 1 < out.length; i += 8) out[i]! -= minY;
  return out;
}
