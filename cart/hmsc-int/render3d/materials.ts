// Material descriptors for hmsc.
//
// A material is more than a color: it carries how a surface LOOKS (tint +
// opacity) and how it BEHAVES (breakable + health). `<Scene3D.Mesh material={…}>`
// reads `color`/`opacity` to render it; the (future) damage system reads
// `breakable`/`health` to decide when it shatters. Until damage exists those two
// fields are inert metadata that simply travels with the surface — so glass is
// fully defined the day it is authored, with nothing waiting on a damage system.

export type Material = {
  /** Base tint, hex. */
  color: string;
  /** 0 = invisible, 1 = solid. Below 1 routes the mesh through the transparent pass. */
  opacity?: number;
  /** Can damage shatter this surface? */
  breakable?: boolean;
  /** Damage points to shatter it (inert until the damage system lands). */
  health?: number;
};

// The default pane alpha — one source so the editor (Glass()) and the compiled
// bake (worldGeometry internTranslucent) draw cooked-prop glass at the same
// see-through, no magic value drifting between them (req_1673).
export const GLASS_OPACITY = 0.34;

// The default glass TINT (cool architectural glass). One source for the editor's
// Glass() AND the compiled loader (req_2020): the no-V8 loader hand-mirrors this
// into world_loader.zig's GLASS_TINT so a cooked-prop glass pane reads as blue
// glass in /compiled instead of the prop's flat gray — a flat-translucent
// material ships opacity only, so without this the loader fell back to the prop
// tint and a window over bright sky looked hollow.
export const GLASS_TINT = '#a9c8d8';

// Glass — a translucent, tinted, breakable pane. The default reads as a neutral
// cool architectural glass; override per use:
//   material={Glass()}                                   a plain pane
//   material={Glass({ color: '#222c33', opacity: 0.5 })} dark tinted auto glass
//   material={Glass({ color: '#cfe6f2', health: 60 })}   a thick showroom front
export const Glass = (over: Partial<Material> = {}): Material => ({
  color: GLASS_TINT,
  opacity: GLASS_OPACITY,
  breakable: true,
  health: 30,
  ...over,
});

// Auto glass — darker tint, a touch more opaque, the look of a car's greenhouse.
export const AutoGlass = (over: Partial<Material> = {}): Material =>
  Glass({ color: '#222c33', opacity: 0.5, health: 20, ...over });

// Storefront glass — bright and clear, the big breakable panes on a showroom or
// store. More health than a window since it's a structural sheet.
export const Storefront = (over: Partial<Material> = {}): Material =>
  Glass({ color: '#cfe6f2', opacity: 0.26, health: 60, ...over });
