import { memo, useMemo } from 'react';
import type { Building, PerceptionState, WorldProp } from '../design';
import { partTextureBuckets, type PartTextureBucket, PartMesh, PartTextureCaptures, resolvePartTexture } from './parts';
import { buildingParts } from './buildingParts';
import { propParts } from './propParts';
import { isOpenBuildingKind } from '../world/buildingKinds';

// Offscreen captures for every PART TEXTURE a placed world uses — the generalized
// peer of BuildingSurfaceCaptures, but for the click-to-pick part-texture channel
// (Building.partTextures / WorldProp.partTextures) rather than the legacy box
// face-skin path. Box buildings carry no partTextures (they still ride the skin
// path + BuildingSurfaceCaptures), so they contribute no buckets here; open
// structures (a garage's deck/parapet/pillar) and props (a sign's panel) do.
//
// Mount as a 2D sibling of <Scene3D>, alongside the other *SurfaceCaptures
// (HmscGameplayRig in the live game, IsoPreview in the editor). One StaticSurface
// per distinct (textureId, cols, floors) bucket; every matching part samples it.
export const WorldPartCaptures = memo(function WorldPartCaptures(props: {
  buildings: Building[];
  props: WorldProp[];
  perception: PerceptionState;
}) {
  const buckets = useMemo<PartTextureBucket[]>(() => {
    const map = new Map<string, PartTextureBucket>();
    for (const b of props.buildings) {
      for (const bucket of partTextureBuckets(buildingParts(b), b.partTextures)) map.set(bucket.key, bucket);
    }
    for (const p of props.props) {
      for (const bucket of partTextureBuckets(propParts(p), p.partTextures)) map.set(bucket.key, bucket);
    }
    return Array.from(map.values());
  }, [props.buildings, props.props]);

  return <PartTextureCaptures buckets={buckets} perception={props.perception} />;
});

// Textured facade panels for BOX buildings driven by the part-texture channel
// (Building.partTextures) — additive over BuildingFacades, which still draws the
// legacy per-face `skin`. Only faces that carry a partTexture emit a panel (a plain
// face stays bare), so this neither duplicates the wall nor the skin path. Open
// structures draw their own parts inside their model, so they're skipped here.
export const BuildingTexturedFaces = memo(function BuildingTexturedFaces(props: { buildings: Building[] }) {
  return (
    <>
      {props.buildings.map((b) => {
        if (isOpenBuildingKind(b.kind) || !b.partTextures) return null;
        return buildingParts(b).map((part, i) => {
          const t = resolvePartTexture(part, b.partTextures);
          if (!t) return null;
          return <PartMesh key={`${b.id}:${part.id}#${i}`} part={part} textureKey={t.key} />;
        });
      })}
    </>
  );
});
