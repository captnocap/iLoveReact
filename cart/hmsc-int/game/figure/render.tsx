// game/figure/render.tsx — the figure as live Scene3D meshes.
//
// V2-AMENDED, in force: THIS IS THE EDITOR/LAB PREVIEW PATH ONLY. The game
// path is the bake (./bake.ts → host data); per-figure-per-frame JS rig
// evaluation never ships in the compiled game. Labs and editors use this to
// SEE a figure while authoring/tuning it:
//
//   buildPartRender(doc, faceDepth, cartKey, seed)
//       per-part Globe params + dyn/texture keys (params via the bake's own
//       partGlobeParams — one recipe, no fork).
//   <CharacterCaptures .../>
//       the offscreen StaticSurface bakes (face unwrap + plain skin) the part
//       meshes sample — park it once anywhere in the 2D tree.
//   <FigureMeshes rig={...} parts={...} yawDeg lift offset />
//       the dressed figure (assembly + anatomy sockets + clothing) as Scene3D
//       meshes; yawDeg turns the whole body (parts face -Z at yaw 0).
//
// Mesh transform note: the host composes rotations Ry·Rx·Rz, so prepending a
// world yaw is exactly "rotate each position about Y, add yawDeg to each ry".

import { memo, useMemo } from 'react';
import { Box, Scene3D, StaticSurface } from '@reactjit/runtime/primitives';
import * as Geometry from '@reactjit/geometries';
import { PART_IDS, type PartId } from './shapes';
import { partGlobeParams } from './bake';
import type { BodyRigFrame } from './rig';
import type { ClothingInstance } from './clothing';
import type { HedDocument, HedLayer } from './hed';
import type { V3 } from './math';

export type PartRender = { params: any; dynKey: string; texKey: string };

export function buildPartRender(
  doc: HedDocument,
  faceDepth: number[],
  cartKey: string,
  seed: number,
): Record<PartId, PartRender> {
  const out = {} as Record<PartId, PartRender>;
  const skinTexKey = `${cartKey}.skin.${doc.skin}`;
  for (const id of PART_IDS) {
    out[id] = {
      params: partGlobeParams(id, doc, faceDepth),
      // Dyn-key contract (3d.zig dynSlotLocate): "<slotId>~<version>" — the
      // '~' is REQUIRED or the host silently drops the mesh.
      dynKey: `${cartKey}.${id}~${seed}`,
      texKey: id === 'head' ? `${cartKey}.head.${seed}` : skinTexKey,
    };
  }
  return out;
}

// ── texture captures — the unwrap-composition pattern ────────────────────────
// Face layers painted as absolute boxes over the skin base; the same shapes
// that stamped the depth grid paint the texture (the .hed coherence law).

export const UNWRAP_W = 512;
export const UNWRAP_H = 256;

export function FaceLayerPaint(props: { layers: HedLayer[] }) {
  const boxes: any[] = [];
  for (const layer of props.layers) {
    if (!layer.color) continue;
    layer.shapes.forEach((s, si) => {
      const centers = s.mirror ? [s.cx, 1 - s.cx] : [s.cx];
      centers.forEach((cx, ci) => {
        const w = s.rx * 2 * UNWRAP_W;
        const h = s.ry * 2 * UNWRAP_H;
        boxes.push(
          <Box
            key={`${layer.id}.${si}.${ci}`}
            style={{
              position: 'absolute',
              left: cx * UNWRAP_W - w / 2,
              top: s.cy * UNWRAP_H - h / 2,
              width: w,
              height: h,
              backgroundColor: layer.color,
              borderRadius: s.kind === 'ellipse' ? Math.min(w, h) / 2 : 2,
            }}
          />,
        );
      });
    });
  }
  return <>{boxes}</>;
}

export const CharacterCaptures = memo(function CharacterCaptures(props: {
  headTexKey: string;
  skinTexKey: string;
  skin: string;
  layers: HedLayer[];
}) {
  const surfaceStyle = useMemo(
    () => ({ position: 'absolute' as const, left: -99999, top: 0, width: UNWRAP_W, height: UNWRAP_H }),
    [],
  );
  return (
    <>
      <StaticSurface staticKey={props.headTexKey} style={surfaceStyle}>
        <Box style={{ width: UNWRAP_W, height: UNWRAP_H, backgroundColor: props.skin, position: 'relative', overflow: 'hidden' }}>
          <FaceLayerPaint layers={props.layers} />
        </Box>
      </StaticSurface>
      <StaticSurface staticKey={props.skinTexKey} style={surfaceStyle}>
        <Box style={{ width: UNWRAP_W, height: UNWRAP_H, backgroundColor: props.skin }} />
      </StaticSurface>
    </>
  );
});

// ── the figure as Scene3D meshes ─────────────────────────────────────────────

const clothingGeometry = (kind: ClothingInstance['geometry']) =>
  kind === 'sphere' ? Geometry.Sphere : kind === 'cone' ? Geometry.Cone : kind === 'cylinder' ? Geometry.Cylinder : Geometry.Box;

function rotYVec(p: V3, rad: number): V3 {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

export function FigureMeshes(props: {
  rig: BodyRigFrame;
  parts: Record<PartId, PartRender>;
  /** turn the whole body about Y (parts face -Z at yaw 0) */
  yawDeg?: number;
  /** raise the whole body (hops) */
  lift?: number;
  /** translate the whole body */
  offset?: V3;
}) {
  const yawDeg = props.yawDeg ?? 0;
  const lift = props.lift ?? 0;
  const [ox, oy, oz] = props.offset ?? [0, 0, 0];
  const rad = yawDeg * Math.PI / 180;
  const place = (p: V3): V3 => {
    const r = rotYVec(p, rad);
    return [r[0] + ox, r[1] + lift + oy, r[2] + oz];
  };
  const turn = (r?: V3): V3 => [r?.[0] ?? 0, (r?.[1] ?? 0) + yawDeg, r?.[2] ?? 0];
  return (
    <>
      {props.rig.assembly.map((inst, i) => {
        const p = props.parts[inst.part];
        return (
          <Scene3D.Mesh
            key={`a${i}`}
            geometry={Geometry.Globe}
            params={p.params}
            dynamicKey={p.dynKey}
            material="#ffffff"
            textureKey={p.texKey}
            position={place(inst.position)}
            rotation={turn(inst.rotation)}
            scale={inst.thickness != null ? [inst.scale * inst.thickness, inst.scale, inst.scale * inst.thickness] : inst.scale}
          />
        );
      })}
      {props.rig.anatomy.map((inst, i) => {
        const p = props.parts[inst.part];
        return (
          <Scene3D.Mesh
            key={`n${i}`}
            geometry={Geometry.Globe}
            params={p.params}
            dynamicKey={p.dynKey}
            material="#ffffff"
            textureKey={p.texKey}
            position={place(inst.position)}
            rotation={turn(inst.rotation)}
            scale={inst.thickness != null ? [inst.scale * inst.thickness, inst.scale, inst.scale * inst.thickness] : inst.scale}
          />
        );
      })}
      {props.rig.clothing.map((inst, i) => (
        <Scene3D.Mesh
          key={`c${i}`}
          geometry={clothingGeometry(inst.geometry)}
          params={inst.params}
          material={inst.textureKey ? '#ffffff' : inst.color}
          textureKey={inst.textureKey}
          position={place(inst.position)}
          rotation={turn(inst.rotation)}
          scale={inst.scale ?? 1}
        />
      ))}
    </>
  );
}
