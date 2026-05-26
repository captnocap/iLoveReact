// Terrain height — PURE PRESENTATION, sourced from the baked world atlas.
//
// Movement and pathfinding stay 2D and tile-based (pathfinding never sees
// elevation), so relief CANNOT break navigation. heightAt comes from bake()'s
// flattened relief field — 0 on flat ground and outside any entity. Re-exported
// here so camera/picking/render keep importing it from one place.

export { heightAt } from './atlas';
