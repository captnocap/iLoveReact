// CookedProp — renders a Studio-compiled prop's baked mesh (req_1134, Part 7).
//
// A cooked prop is the imported-prop pattern applied to a Studio model: the cook
// flattened the model to ONE content-addressed triangle soup ([px,py,pz,nx,ny,nz,
// u,v], the engine's vertex layout), interned in the cooked-asset content store by
// its `meshRef`. At render this is just a static geometry def, interned like every
// other mesh — exactly what ImportedProp does for an OBJ/GLB import. The mesh sits
// with its base at y=0 (the cook baked each part's ground lift in), so it places at
// the prop anchor like an imported prop.
//
// v1 is UNTEXTURED — a flat material colour. The compressed-WebP texture factor
// (texRef → a sampled atlas) folds in with the @reactjit/image cook + the loader
// texture wiring (the rebuild slice).

import { Scene3D } from '@reactjit/primitives';
import type { GeometryData, GeometryDef } from '@reactjit/geometries';
import type { WorldProp } from '../../design';
import { cookedAssetById, cookedMeshBlob, cookedTextureBlob } from '../../editors/model/cookedAssets';

const GEOMS = new Map<string, GeometryDef>();

function geometryFor(meshRef: string, verts: Float32Array): GeometryDef {
  const existing = GEOMS.get(meshRef);
  if (existing) return existing;
  let r2 = 0;
  for (let i = 0; i + 2 < verts.length; i += 8) {
    const d = verts[i] * verts[i] + verts[i + 1] * verts[i + 1] + verts[i + 2] * verts[i + 2];
    if (d > r2) r2 = d;
  }
  const def: GeometryDef = {
    id: `CookedProp:${meshRef}`,
    defaults: {},
    generate: (): GeometryData => ({ positions: verts, count: verts.length / 8, bounds: { radius: Math.sqrt(r2) } }),
  };
  GEOMS.set(meshRef, def);
  return def;
}

const COOKED_PROP_TINT = '#c2c6cf';

export function CookedProp(props: { prop: WorldProp }) {
  const asset = cookedAssetById(props.prop.kind);
  if (!asset) return null;
  const verts = cookedMeshBlob(asset.meshRef);
  if (!verts || verts.length === 0) return null;
  // The painted atlas (req_1496): when the asset cooked WITH a texture, sample it by
  // texRef (the GPU texture <CookedTexture> in PropSurfaceCaptures uploaded) with a
  // white material so the paint shows true; otherwise the flat grey tint. The baked
  // mesh's per-face UVs map straight into the atlas.
  const textured = !!asset.texRef && !!cookedTextureBlob(asset.texRef);
  return (
    <Scene3D.Mesh
      geometry={geometryFor(asset.meshRef, verts)}
      params={{}}
      position={[props.prop.x, props.prop.y ?? 0, props.prop.z]}
      rotation={[0, props.prop.yawDegrees ?? 0, 0]}
      material={textured ? '#ffffff' : COOKED_PROP_TINT}
      textureKey={textured ? asset.texRef : undefined}
    />
  );
}
