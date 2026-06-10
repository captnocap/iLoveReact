// tileField.wgsl.ts — the painted tile-map shader for the editor's 2D canvas.
//
// This IS the game's terrain-surface shader: a painted chunk compiles to a real
// heightfield landform, and the game draws that landform's tile texture with the
// same shader (cart/hmsc/render3d/heightfieldSurface). To keep ONE source — what
// you paint is what the world boots with — the shader lives in the game package
// and this re-exports it under the editor's historical name. D[] layout: [0]cols
// [1]rows [2]paletteCount, then paletteCount*3 palette rgb floats, then the cells.

// roadRibbonSection rides along (ROADCURVE-0610): the optional analytic-road
// section appended after the cells, shared by the 2D chunk quads and the 3D
// drape capture so roads curve identically in both views.
export { HEIGHTFIELD_TILE_SHADER as TILE_FIELD_WGSL, roadRibbonSection } from '../hmsc/render3d/heightfieldSurface';
