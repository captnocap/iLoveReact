// ImportedProp — renders OBJ/GLB-imported prop meshes.
//
// The importer bakes external model files into the same Scene3D vertex layout
// the engine already consumes: [px,py,pz,nx,ny,nz,u,v]. At runtime this is just
// a static geometry def, interned like every other mesh.

import { Scene3D } from '@reactjit/primitives';
import type { GeometryData, GeometryDef } from '@reactjit/geometries';
import type { WorldProp } from '../../design';
import { importedPropMesh, type ImportedPropMesh } from '../../game/kinds/importedProps';
import { cssColor } from '../../game/kinds/propModels';

const GEOMS = new Map<string, GeometryDef>();

function geometryFor(mesh: ImportedPropMesh): GeometryDef {
  const existing = GEOMS.get(mesh.key);
  if (existing) return existing;
  const def: GeometryDef = {
    id: `ImportedProp:${mesh.key}`,
    defaults: {},
    generate: (): GeometryData => ({
      positions: mesh.vertices,
      count: mesh.count,
      bounds: { radius: mesh.boundsRadius },
    }),
  };
  GEOMS.set(mesh.key, def);
  return def;
}

export function ImportedProp(props: { prop: WorldProp }) {
  const mesh = importedPropMesh(props.prop.kind);
  if (!mesh) return null;
  return (
    <Scene3D.Mesh
      geometry={geometryFor(mesh)}
      params={{}}
      position={[props.prop.x, props.prop.y, props.prop.z]}
      rotation={[0, props.prop.yawDegrees ?? 0, 0]}
      material={cssColor(mesh.color)}
    />
  );
}
