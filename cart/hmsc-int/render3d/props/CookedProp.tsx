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
// PAINTED ATLAS (req_1496): when the asset cooked WITH a texture, the model's paint
// atlas (PNG, content-addressed by texRef) is sampled via the mesh's per-face UVs.
// It rides the Scene3D.Mesh INLINE `texture={{width,height,hex}}` door — the same
// mechanism the player/NPC models use (host parses the hex once, caches by content
// hash). The earlier textureKey+<Paintable> attempt fell back to the 1×1 white
// default because a cross-subtree uploaded paintable didn't bind.

import { Scene3D } from '@reactjit/primitives';
import type { GeometryData, GeometryDef } from '@reactjit/geometries';
import { image } from '@reactjit/image';
import { base64ToBytes } from '@reactjit/workspace';
import type { WorldProp } from '../../design';
import { cookedAssetById, cookedMeshBlob, cookedTextureBlob } from '../../editors/model/cookedAssets';
import { resolvePartTexture, type Part } from '../parts';

const GEOMS = new Map<string, GeometryDef>();

function geometryFor(meshRef: string, verts: Float32Array, start = 0, count = verts.length / 8, flipV = false): GeometryDef {
  const whole = start === 0 && count === verts.length / 8;
  const key = `${whole ? meshRef : `${meshRef}:${start}:${count}`}${flipV ? ':flip-v' : ''}`;
  const existing = GEOMS.get(key);
  if (existing) return existing;
  const slice = whole && !flipV ? verts : verts.slice(start * 8, (start + count) * 8);
  if (flipV) {
    for (let i = 0; i + 7 < slice.length; i += 8) {
      slice[i + 7] = 1 - slice[i + 7];
    }
  }
  let r2 = 0;
  for (let i = 0; i + 2 < slice.length; i += 8) {
    const d = slice[i] * slice[i] + slice[i + 1] * slice[i + 1] + slice[i + 2] * slice[i + 2];
    if (d > r2) r2 = d;
  }
  const def: GeometryDef = {
    id: `CookedProp:${key}`,
    defaults: {},
    generate: (): GeometryData => ({ positions: slice, count: slice.length / 8, bounds: { radius: Math.sqrt(r2) } }),
  };
  GEOMS.set(key, def);
  return def;
}

const COOKED_PROP_TINT = '#c2c6cf';

// byte → 2-hex, for building the inline texture's RRGGBBAA string.
const HEX2 = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

// The inline texture (width/height/hex) for a cooked texRef, decoded from the stored
// paint PNG and downscaled to keep the hex string bounded (props are small in-world).
// Memoised per texRef — the decode + hex build runs ONCE; the host then content-hash-
// caches the GPU upload. A null is NOT cached (the blob may load async).
type InlineTex = { width: number; height: number; hex: string };
const TEX_CACHE = new Map<string, InlineTex>();
const TEX_SIZE = 512;

function cookedInlineTexture(texRef: string | undefined): InlineTex | null {
  if (!texRef) return null;
  const cached = TEX_CACHE.get(texRef);
  if (cached) return cached;
  const blob = cookedTextureBlob(texRef);
  if (!blob) return null; // not loaded yet — retry on a later render, don't cache the miss
  const raw = image(base64ToBytes(blob)).resize(TEX_SIZE, TEX_SIZE).raw();
  if (!raw || !raw.rgba || raw.rgba.length !== raw.width * raw.height * 4) return null;
  const n = raw.rgba.length;
  const parts = new Array<string>(n);
  for (let i = 0; i < n; i += 1) parts[i] = HEX2[raw.rgba[i]];
  const tex: InlineTex = { width: raw.width, height: raw.height, hex: parts.join('') };
  TEX_CACHE.set(texRef, tex);
  return tex;
}

function slotPart(prop: WorldProp, slot: { id: string; label: string; defaultMaterial: string }): Part {
  return {
    id: slot.id,
    label: slot.label,
    geometry: 'Box',
    params: { width: 1, height: 1, depth: 1 },
    position: [prop.x, prop.y ?? 0, prop.z],
    rotation: [0, prop.yawDegrees ?? 0, 0],
    material: slot.defaultMaterial,
    textureable: true,
    tex: { cols: 1, floors: 1 },
  };
}

export function CookedProp(props: { prop: WorldProp }) {
  const asset = cookedAssetById(props.prop.kind);
  if (!asset) return null;
  const verts = cookedMeshBlob(asset.meshRef);
  if (!verts || verts.length === 0) return null;
  const tex = cookedInlineTexture(asset.texRef);
  const slots = asset.slots ?? [];
  if (slots.length > 0) {
    const firstSlotStart = Math.min(...slots.map((slot) => slot.start));
    return (
      <>
        {firstSlotStart > 0 ? (
          <Scene3D.Mesh
            geometry={geometryFor(asset.meshRef, verts, 0, firstSlotStart)}
            params={{}}
            position={[props.prop.x, props.prop.y ?? 0, props.prop.z]}
            rotation={[0, props.prop.yawDegrees ?? 0, 0]}
            material={tex ? '#ffffff' : COOKED_PROP_TINT}
            texture={tex ?? undefined}
          />
        ) : null}
        {slots.map((slot) => {
          if (slot.count <= 0) return null;
          const resolved = resolvePartTexture(slotPart(props.prop, slot), props.prop.partTextures);
          return (
            <Scene3D.Mesh
              key={slot.id}
              geometry={geometryFor(asset.meshRef, verts, slot.start, slot.count, Boolean(resolved))}
              params={{}}
              position={[props.prop.x, props.prop.y ?? 0, props.prop.z]}
              rotation={[0, props.prop.yawDegrees ?? 0, 0]}
              material={resolved ? '#ffffff' : (tex ? '#ffffff' : COOKED_PROP_TINT)}
              texture={resolved ? undefined : (tex ?? undefined)}
              textureKey={resolved?.key}
            />
          );
        })}
      </>
    );
  }
  return (
    <Scene3D.Mesh
      geometry={geometryFor(asset.meshRef, verts)}
      params={{}}
      position={[props.prop.x, props.prop.y ?? 0, props.prop.z]}
      rotation={[0, props.prop.yawDegrees ?? 0, 0]}
      material={tex ? '#ffffff' : COOKED_PROP_TINT}
      texture={tex ?? undefined}
    />
  );
}
