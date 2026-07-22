// Viewport presentation rules shared by ModelView and its headless regressions.
//
// Scene3D's wireframe shader exposes the lowered render triangles. That is useful in
// plain View mode, but it is the wrong topology vocabulary while authoring: Vertex,
// Edge, and Face modes already receive the host's authored-boundary overlay, where a
// quad is one face and its lowering diagonal stays hidden.

/** Show raw render-triangle wireframe only when no mesh-edit tool owns the viewport. */
export function triangleWireframeVisible(requested: boolean, selectionMode: number): boolean {
  return requested && selectionMode === 0;
}
