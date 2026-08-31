// @surface surface_corrugated
// @name Corrugated Sheet
// @tags corrugated, metal, sheet, structure
// @author fable
// @param rib_pitch: f32 = 1.0 range(0.02, 2.0) "Rib pitch (sp units per rib)"
// @param relief: f32 = 0.012 range(0.0, 0.08) "Corrugation depth"
//
// The second pilot structural field (Surface Packages v1): the sine that
// rust_sheet/corrugated_metal paint IS the surface equation — one rib phase
// drives displacement here and shading there. This module pairs with an
// ART-ONLY appearance (no adapter refactor): a package aligns the appearance
// ribs to the geometry ribs through its appearance uv scale, e.g. rust_sheet
// paints corr = sin(uv.x * 55), so uvScale.x = (2*pi / rib_pitch) / 55 makes
// both read the identical phase expression over sp.
//
// height = sin ribs, symmetric about the base plane (a corrugated sheet's
// neutral axis). feat = (corr, ridge, 0, 0); cell counts ribs along U.
fn surface_corrugated(sp: vec2f, seed: f32) -> SurfaceSample {
  let phase = sp.x * 6.28318531 / rib_pitch;
  let corr = sin(phase);
  let ridge = corr * 0.5 + 0.5;
  let cell = vec2f(floor(sp.x / rib_pitch), floor(sp.y));
  let height = corr * relief * 0.5;
  let tone = rand(cell + vec2f(seed, seed * 2.0));
  return SurfaceSample(height, cell, vec4f(corr, ridge, tone, 0.0));
}
