// parts.ts — the model PART, the unit the inspector picks and a texture applies to.
//
// A model (a box building, an open structure like a parking garage, a prop like a
// street sign) is, underneath, a list of meshes. The assist3d inspector
// (assist3d/SceneSurface + picking.ts) already proves the right interaction: orbit
// a scene, ray-AABB pick the mesh under the cursor, apply to THAT mesh — geometry-
// agnostic, so a flat deck, a pillar, and a sign panel all pick identically. That
// generalizes texturing to shapes that have no "front/back/left/right/top" face
// (the old box-only face-skin model could not texture a garage or a sign at all).
//
// A `Part` is deliberately the SAME shape assist3d's MeshSpec picks against
// (geometry/params/position/rotation/scale), so cart/hmsc-int/assist3d/picking.ts
// picks a Part[] with no changes. It adds three things a texture needs: a stable
// `id` (the key a per-part texture is stored under), a human `label`, and the
// `texturedFaces` + grid sizing a capture bakes at.
//
// PER-PART TEXTURES are stored as Record<partId, textureId> on the placed object
// (Building.partTextures / WorldProp.partTextures, design.ts). The texture id is a
// TEXTURE_REGISTRY id (hmsc-int/game/textures — the pipeline moved behind the
// captured ground floor's door, TEXPORT-0606) — the SAME one flat list the
// editor browses; see the "texture is one concept" rule.

import { memo, useMemo } from 'react';
import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { BoxFace } from '@reactjit/geometries';
import type { PerceptionState } from '../design';
import { skinCapturePx, skinGridCols, skinGridFloors } from './buildingSkins';
// The legacy renderer reads the captured ground floor's registry — the same
// direction the V15 compile contract points (hmsc consumes hmsc-int's output).
import { TextureCapture, textureById } from '../game/textures/registry';

export type Vec3 = [number, number, number];

// partId -> texture id (a TEXTURE_REGISTRY id). The map a placed object carries.
export type PartTextures = Record<string, string>;

export type Part = {
  id: string;                  // stable within a model: 'front','deck','pole','panel'
  label: string;              // human: 'Front wall','Upper deck','Pole'
  geometry: string;           // a GEOMETRIES key
  params: Record<string, any>;
  position: Vec3;             // world-space (the descriptor bakes yaw translation)
  rotation?: Vec3;            // degrees (the descriptor bakes yaw)
  scale?: number | Vec3;
  material: string;           // default colour shown when no texture is applied
  texturedFaces?: BoxFace[];  // which box faces sample the texture (broad faces)
  tex?: { cols: number; floors: number }; // capture grid; derived from scale if absent
  textureable?: boolean;      // false = structural-only (heightfield floor, a car) — not a texture target
  // A part whose UNTEXTURED look is itself a texture, not a flat colour — e.g. a
  // street sign's route plate. Used as the textureKey until an override is applied;
  // its capture is mounted by the model's own existing capture pass, not the part
  // bucket pass (only overrides get a part bucket).
  defaultTextureKey?: string;
  // A decorative OVERLAY on an inline structural mesh (a box's wall-face panel):
  // rendered ONLY when a texture resolves, so the bare look stays the structural
  // mesh and wall accents (a door, glass, a sign band) aren't covered/z-fought by
  // an idle panel. Still always PICKABLE — picking runs on the part list, not on
  // what happens to be drawn.
  overlay?: boolean;
};

// True when a part can carry a texture (the default). The inspector only offers
// the texture flow on these, and the capture pass only buckets these.
export function isTextureable(part: Part): boolean {
  return part.textureable !== false;
}

// The capture grid for a part: explicit `tex`, else derived from its world dims —
// the two in-plane extents drive cols, the up extent drives floors (the same
// 1-cell-per-3m convention skins use).
function partGrid(part: Part): { cols: number; floors: number } {
  if (part.tex) return part.tex;
  const s = part.scale;
  const sx = Array.isArray(s) ? s[0] : (s ?? 1);
  const sy = Array.isArray(s) ? s[1] : (s ?? 1);
  const sz = Array.isArray(s) ? s[2] : (s ?? 1);
  return { cols: skinGridCols(Math.max(sx, sz)), floors: skinGridFloors(sy) };
}

// The texture-capture key a part samples for a given texture id. Every part of the
// same (textureId, cols, floors) shape shares ONE baked texture (the FacadeCapture
// bucket discipline), so the heavy bake happens once per distinct look+size.
export function partTextureKey(textureId: string, cols: number, floors: number): string {
  return `part:${textureId}:${cols}x${floors}`;
}

// The texture a part resolves to under a placed object's partTextures, or null.
export function resolvePartTexture(
  part: Part,
  textures: PartTextures | undefined,
): { textureId: string; key: string; cols: number; floors: number } | null {
  if (!textures || !isTextureable(part)) return null;
  const textureId = textures[part.id];
  if (!textureId || !textureById(textureId)) return null;
  const { cols, floors } = partGrid(part);
  return { textureId, key: partTextureKey(textureId, cols, floors), cols, floors };
}

// One part → one <Scene3D.Mesh>. With a texture applied the material goes white so
// the sampled texture reads true and `texturedFaces` route the UVs (the broad
// faces of a thin panel); without one it shows the part's default colour.
export const PartMesh = memo(function PartMesh(props: { part: Part; textureKey?: string }) {
  const p = props.part;
  const key = props.textureKey ?? p.defaultTextureKey;
  const params = key && p.texturedFaces ? { ...p.params, texturedFaces: p.texturedFaces } : p.params;
  return (
    <Scene3D.Mesh
      geometry={Geometry.GEOMETRIES[p.geometry] ?? Geometry.Box}
      params={params}
      position={p.position}
      rotation={p.rotation ?? [0, 0, 0]}
      scale={p.scale ?? 1}
      material={key ? '#ffffff' : p.material}
      textureKey={key}
    />
  );
});

// A whole part list, each mesh textured by the object's partTextures. The one
// renderer the model components AND the editor inspector share (describe == render
// — no second copy of the geometry to drift out of sync).
export const TexturedParts = memo(function TexturedParts(props: {
  parts: Part[];
  textures?: PartTextures;
}) {
  return (
    <>
      {props.parts.map((part, i) => {
        // Index-keyed: several meshes may SHARE a part id (a part GROUP, e.g. all
        // of a garage's pillars), so the id is not unique — but each mesh is.
        const t = resolvePartTexture(part, props.textures);
        // Overlay panels only exist to carry a texture — skip idle ones so the
        // structural mesh (and its door/glass/sign accents) shows bare.
        if (part.overlay && !t && !part.defaultTextureKey) return null;
        return <PartMesh key={part.id + '#' + i} part={part} textureKey={t?.key} />;
      })}
    </>
  );
});

// Per-FACE wall parts for a solid box (a structure's store / kiosk / booth): one
// thin OVERLAY panel nudged off each of the four wall faces, so each wall is its
// own texture target — texturing the back wall doesn't wrap the whole box. This is
// the BuildingFacades panel trick (the box-building face path), generalized to any
// axis-aligned box inside a structure model. The SOLID box itself stays an inline
// structural mesh (not a part); the panels render only when textured (overlay).
// At yaw 0: front = -Z (the side storefronts/doors face), back = +Z, left = -X,
// right = +X; the `place` transform bakes the building's yaw, like every part.
//
// The nudge is deliberately TIGHTER than the accents that sit on these walls (a
// booth door's front lands ~0.08 out, a kiosk sign ~0.14, storefront glass spans
// ~0.01..0.11): the panel spans 0.01..0.05 off the wall, so a textured wall slides
// UNDER its door/sign/glass instead of covering them.
const FACE_PANEL_NUDGE = 0.03;
const FACE_PANEL_THICKNESS = 0.04;

export function boxFaceParts(opts: {
  id: string;     // id prefix: 'store' → storeFront / storeBack / storeLeft / storeRight
  label: string;  // label prefix: 'Store' → 'Store front wall' …
  minX: number; maxX: number; minZ: number; maxZ: number;
  bottomY: number; topY: number;
  material: string;
  yaw: number;
  place: (x: number, y: number, z: number) => Vec3;
}): Part[] {
  const { minX, maxX, minZ, maxZ, bottomY, topY } = opts;
  const w = maxX - minX, d = maxZ - minZ, h = topY - bottomY;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, cy = (bottomY + topY) / 2;
  const rot: Vec3 = [0, opts.yaw, 0];
  const unit = { width: 1, height: 1, depth: 1 };
  const faces: Array<{ suffix: string; name: string; x: number; z: number; horizontal: boolean; span: number }> = [
    { suffix: 'Front', name: 'front', x: cx, z: minZ - FACE_PANEL_NUDGE, horizontal: true, span: w },
    { suffix: 'Back', name: 'back', x: cx, z: maxZ + FACE_PANEL_NUDGE, horizontal: true, span: w },
    { suffix: 'Left', name: 'left', x: minX - FACE_PANEL_NUDGE, z: cz, horizontal: false, span: d },
    { suffix: 'Right', name: 'right', x: maxX + FACE_PANEL_NUDGE, z: cz, horizontal: false, span: d },
  ];
  return faces.map((f): Part => ({
    id: opts.id + f.suffix,
    label: `${opts.label} ${f.name} wall`,
    geometry: 'Box',
    params: unit,
    scale: f.horizontal ? [f.span, h, FACE_PANEL_THICKNESS] : [FACE_PANEL_THICKNESS, h, f.span],
    texturedFaces: f.horizontal ? ['front', 'back'] : ['left', 'right'],
    material: opts.material,
    rotation: rot,
    position: opts.place(f.x, cy, f.z),
    tex: { cols: skinGridCols(f.span), floors: skinGridFloors(h) },
    overlay: true,
  }));
}

// The distinct (textureId, cols, floors) buckets a part list needs baked. Shared
// by the capture mount (one StaticSurface per bucket, sampled by every matching
// part) — the BuildingSurfaceCaptures pattern, generalized to any part.
export type PartTextureBucket = { textureId: string; cols: number; floors: number; key: string };

export function partTextureBuckets(parts: Part[], textures: PartTextures | undefined): PartTextureBucket[] {
  const map = new Map<string, PartTextureBucket>();
  for (const part of parts) {
    const t = resolvePartTexture(part, textures);
    if (t && !map.has(t.key)) map.set(t.key, { textureId: t.textureId, cols: t.cols, floors: t.floors, key: t.key });
  }
  return Array.from(map.values());
}

// Offscreen captures for a set of buckets — mount as a 2D sibling of <Scene3D>,
// exactly like BuildingSurfaceCaptures / TileSurfaceCaptures. Each bucket bakes the
// texture once at its grid size; every part sampling that key reads it.
export const PartTextureCaptures = memo(function PartTextureCaptures(props: {
  buckets: PartTextureBucket[];
  perception: PerceptionState;
}) {
  return (
    <>
      {props.buckets.map((b) => (
        <TextureCapture
          key={b.key}
          textureId={b.textureId}
          staticKey={b.key}
          widthPx={skinCapturePx(b.cols)}
          heightPx={skinCapturePx(b.floors)}
          cols={b.cols}
          floors={b.floors}
          perception={props.perception}
        />
      ))}
    </>
  );
});
