// editors/characters/preview.tsx — the route's 3D side: the selected part
// alone or the assembled dressed figure, hit volumes + anchors overlay, the
// held item, and the texture captures the meshes sample.
//
// Perf discipline carried from the reference (cart/head_lab/index.tsx, read
// never imported): the meshes are memo'd HARD — an orbit drag re-renders only
// the camera node; every mesh carries the full sculpt vertex payload through
// the reconciler, so re-diffing ~14 of them per mousemove is the lag.
//
// Captures: the kit's CharacterCaptures (game/figure/render) covers the bare
// head+skin pair; the EDITOR needs more (photo on the head, underwear stamps
// on the torso, clothing-print bakes), so this file owns the richer capture
// stack — the ruled editors-reach-into-figure-internals exception at work.

import { memo, useMemo } from 'react';
import { Box, Effect, Image, Scene3D, StaticSurface, Text } from '@reactjit/runtime/primitives';
import * as Geometry from '@reactjit/geometries';
import type { BodyRigFrame } from '../../game/figure/rig';
import type { HedLayer } from '../../game/figure/hed';
import { FaceLayerPaint, UNWRAP_H, UNWRAP_W, type FigurePaint, type PartRender } from '../../game/figure/render';
import { PaintedOverlayPaint } from '../../game/paintedRender';
import type { PaintedOverlay } from '../../game/painted';
import { BOTTOMS, clothingSkinTextureKey, type BodyShapeId, type BottomsId, type ClothingId, type ClothingSkinId, type PartId, CLOTHING_SKINS } from '../../game/figure/shapes';
import type { ClothingInstance } from '../../game/figure/clothing';
import { ITEM_DEFINITIONS, ITEM_GEOMETRIES, type ItemPart } from '../../game/items';
import { GRAB_GRID_TEXTURE_KEY, GRAB_GRID_WGSL, GRAB_TUNING, PART_VIEW_PLACEMENT, gridOverlayParams, instanceScaleVec } from './grabKit';
import { PAINT_EDITOR_TUNING } from './paintKit';

export type PreviewView = 'part' | 'figure';
export type Photo = { path: string; stamp: number };

const clothingGeometry = (kind: ClothingInstance['geometry']) =>
  kind === 'sphere' ? Geometry.Sphere : kind === 'cone' ? Geometry.Cone : kind === 'cylinder' ? Geometry.Cylinder : Geometry.Box;

// ── the meshes (memo'd hard — see header) ────────────────────────────────────

export const PartMeshes = memo(function PartMeshes(props: {
  view: PreviewView;
  selPart: PartId;
  parts: Record<PartId, PartRender>;
  rig: BodyRigFrame;
  showHitboxes: boolean;
}) {
  if (props.view === 'part') {
    const p = props.parts[props.selPart];
    return (
      <Scene3D.Mesh
        geometry={Geometry.Globe}
        params={p.params}
        dynamicKey={p.dynKey}
        material="#ffffff"
        textureKey={p.texKey}
        position={PART_VIEW_PLACEMENT.position}
      />
    );
  }
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
            position={inst.position}
            rotation={inst.rotation ?? [0, 0, 0]}
            scale={instanceScaleVec(inst.scale, inst.thickness)}
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
          position={inst.position}
          rotation={inst.rotation ?? [0, 0, 0]}
          scale={inst.scale ?? 1}
        />
      ))}
      {props.rig.anatomy.map((inst, i) => {
        const p = props.parts[inst.part];
        return (
          <Scene3D.Mesh
            key={`n${i}`}
            geometry={Geometry.Globe}
            params={p.params}
            dynamicKey={`${p.dynKey}.anatomy.${i}`}
            material="#ffffff"
            textureKey={p.texKey}
            position={inst.position}
            rotation={inst.rotation ?? [0, 0, 0]}
            scale={instanceScaleVec(inst.scale, inst.thickness)}
          />
        );
      })}
      {props.showHitboxes ? props.rig.hitboxes.map((box) => (
        <Scene3D.Mesh
          key={`hitbox-${box.id}`}
          geometry={Geometry.Box}
          params={{ width: box.size[0], height: box.size[1], depth: box.size[2] }}
          material={{ color: '#35d0ff', opacity: 0.18 }}
          position={box.position}
          rotation={box.rotation}
        />
      )) : null}
      {props.showHitboxes ? props.rig.anchors.map((anchor) => (
        <Scene3D.Mesh
          key={`anchor-${anchor.id}`}
          geometry={Geometry.Sphere}
          params={{ radius: 0.5, segments: 12, rings: 8 }}
          material={anchor.id === 'face_grab' ? '#f97316' : anchor.role === 'origin' ? '#a78bfa' : '#34d399'}
          position={anchor.position}
          rotation={anchor.rotation}
          scale={anchor.radius}
        />
      )) : null}
    </>
  );
});

// ── the grab affordance (GRABSHAPE-0605) ─────────────────────────────────────

export type GrabMarkerInfo = {
  /** the grabbable cell's surface point (world) — rides the rendered skin */
  world: [number, number, number];
  /** the handle dot scales off the pick radius */
  grabRadius: number;
  /** the influence shell: how much surface the drag's stamp will move */
  stampWorldRadius: number;
  /** hover = "you can grab here"; raise/carve = mid-drag direction */
  state: 'hover' | 'raise' | 'carve';
};

/** The "you can grab HERE" handle: a solid dot snapped to the grid cell under
 *  the cursor + a translucent shell showing the stamp's reach. Mid-drag it
 *  takes the raise/carve color (the same blue/orange the paint canvas speaks). */
export const GrabMarker = memo(function GrabMarker(props: { marker: GrabMarkerInfo | null }) {
  const m = props.marker;
  if (!m) return null;
  const T = GRAB_TUNING;
  const color = m.state === 'carve' ? T.colors.carve : m.state === 'raise' ? T.colors.raise : T.colors.hover;
  return (
    <>
      <Scene3D.Mesh
        geometry={Geometry.Sphere}
        params={{ radius: 1, segments: 12, rings: 8 }}
        material={color}
        position={m.world}
        scale={m.grabRadius * T.handleScale}
      />
      <Scene3D.Mesh
        geometry={Geometry.Sphere}
        params={{ radius: 1, segments: 16, rings: 10 }}
        material={{ color, opacity: T.shellOpacity }}
        position={m.world}
        scale={m.stampWorldRadius}
      />
    </>
  );
});

// The grid overlay's texture: ONE Effect bake (transparent except the
// cell-center hairlines + intersection dots), re-baked ONLY when the hovered
// cell changes — the data array is memo'd on (cu, cv, mirror), so an idle or
// orbiting frame never re-captures (the tileSurface inline-identity hazard,
// inverted on purpose: identity change IS the re-bake signal here).
const GRID_EFFECT_STYLE = { position: 'absolute' as const, left: 0, top: 0, width: PAINT_EDITOR_TUNING.editor.width, height: PAINT_EDITOR_TUNING.editor.height };
const GRID_CAPTURE_STYLE = { position: 'absolute' as const, left: -99999, top: 0, width: PAINT_EDITOR_TUNING.editor.width, height: PAINT_EDITOR_TUNING.editor.height };

/** The lattice texture + its hover highlight: the hovered pull point lights
 *  up hot in the lattice itself (and its meridian twin when mirror is on), so
 *  "am I about to pull the right node" is answered in the same visual layer
 *  as the grid — not just by the marker sphere. */
export const GrabGridCapture = memo(function GrabGridCapture(props: {
  hover: { cu: number; cv: number } | null;
  mirror: boolean;
}) {
  const data = useMemo(
    () => [props.hover?.cu ?? -1, props.hover?.cv ?? -1, props.mirror ? 1 : 0],
    [props.hover?.cu, props.hover?.cv, props.mirror],
  );
  return (
    <StaticSurface staticKey={GRAB_GRID_TEXTURE_KEY} style={GRID_CAPTURE_STYLE}>
      <Effect shader={GRAB_GRID_WGSL} data={data} style={GRID_EFFECT_STYLE} />
    </StaticSurface>
  );
});

/** The "grid" toggle: a NORMAL-OFFSET SHELL of every visible instance of the
 *  SELECTED part, wearing the grid texture — the skin's own params with a
 *  constant lift on the displacement grid (grabKit gridOverlayParams), so
 *  the lattice floats the same few millimeters above EVERY point, concave
 *  carves included (a center-scale inflate dipped under bends — the
 *  "grid mesh is being swallowed" report). Its UVs are unwrap space, so the
 *  lattice runs through the exact 48×24 pull points and stretches as a drag
 *  deforms the surface. Figure view grids the assembly's instances of that
 *  part (all of them — one sculpt, many placements; watching every limb pipe
 *  move at once IS the shared-part truth). The shell is its own dyn slot
 *  (`.grid` on the slot id) — different verts than the skin's. */
export const GrabGridMeshes = memo(function GrabGridMeshes(props: {
  view: PreviewView;
  selPart: PartId;
  parts: Record<PartId, PartRender>;
  rig: BodyRigFrame;
}) {
  const G = GRAB_TUNING.grid;
  const p = props.parts[props.selPart];
  const shellParams = useMemo(() => gridOverlayParams(p.params as any), [p.params]);
  const shellKey = p.dynKey.replace('~', '.grid~');
  const mat = { color: G.color, opacity: G.opacity };
  if (props.view === 'part') {
    return (
      <Scene3D.Mesh
        geometry={Geometry.Globe}
        params={shellParams}
        dynamicKey={shellKey}
        material={mat}
        textureKey={GRAB_GRID_TEXTURE_KEY}
        position={PART_VIEW_PLACEMENT.position}
      />
    );
  }
  return (
    <>
      {props.rig.assembly.map((inst, i) => {
        if (inst.part !== props.selPart) return null;
        return (
          <Scene3D.Mesh
            key={`g${i}`}
            geometry={Geometry.Globe}
            params={shellParams}
            dynamicKey={shellKey}
            material={mat}
            textureKey={GRAB_GRID_TEXTURE_KEY}
            position={inst.position}
            rotation={inst.rotation ?? [0, 0, 0]}
            scale={instanceScaleVec(inst.scale, inst.thickness)}
          />
        );
      })}
    </>
  );
});

// ── the held item (game/items part tables → meshes) ──────────────────────────

export const HELD_ITEM_TUNING = Object.freeze({
  /** offset from the right hand's assembly position to the item origin */
  handOffset: [0.08, -0.18, -0.18] as [number, number, number],
  /** item yaw in the hand — the reference's ctx number, carried verbatim
   *  (positions rotate by it as radians; the rotation prop receives it raw,
   *  exactly as the gallery's Part() did) */
  yaw: -0.45,
  /** per-item hand scale; anything else gets `default` */
  scale: {
    vehicle: 0.1, sailboat: 0.12, surfboard: 0.16, pitchfork: 0.18,
    bat: 0.2, tv: 0.12, backpack: 0.14, basketball: 0.18, football: 0.18,
    default: 0.16,
  } as Record<string, number>,
});

/** One item from the registry, posed into the figure's right hand. Texture
 *  CONTENT for textured parts is the materials lane's (game/items CAPTURE) —
 *  until it lands, textured parts read as their material color. */
export const HeldItemMeshes = memo(function HeldItemMeshes(props: {
  itemId: string;
  rig: BodyRigFrame;
}) {
  const item = ITEM_DEFINITIONS.find((d) => d.id === props.itemId) ?? null;
  const hand = props.rig.assembly.find((inst) => inst.bone === 'rHand');
  if (!item || !hand) return null;
  const T = HELD_ITEM_TUNING;
  const scale = T.scale[item.id] ?? T.scale.default;
  const origin: [number, number, number] = [
    hand.position[0] + T.handOffset[0],
    hand.position[1] + T.handOffset[1],
    hand.position[2] + T.handOffset[2],
  ];
  const c = Math.cos(T.yaw), s = Math.sin(T.yaw);
  const place = (p: ItemPart['position']): [number, number, number] => {
    const x = p[0] * scale, y = p[1] * scale, z = p[2] * scale;
    return [origin[0] + x * c - z * s, origin[1] + y, origin[2] + x * s + z * c];
  };
  const partScale = (sc: ItemPart['scale']): [number, number, number] => {
    if (typeof sc === 'number') return [sc * scale, sc * scale, sc * scale];
    if (!sc) return [scale, scale, scale];
    return [sc[0] * scale, sc[1] * scale, sc[2] * scale];
  };
  return (
    <>
      {item.parts.map((part, i) => (
        <Scene3D.Mesh
          key={`item-${i}`}
          geometry={ITEM_GEOMETRIES[part.geometry]}
          params={part.params}
          material={part.material}
          textureKey={part.textureKey}
          position={place(part.position)}
          rotation={[part.rotation?.[0] ?? 0, (part.rotation?.[1] ?? 0) + T.yaw, part.rotation?.[2] ?? 0]}
          scale={partScale(part.scale)}
        />
      ))}
    </>
  );
});

// ── the texture captures (the editor's richer stack) ─────────────────────────

/** The head unwrap composition: skin base → dropped photo → face layers. The
 *  SAME component renders the visible canvas and the StaticSurface bake, so
 *  canvas and texture can never disagree. */
export function UnwrapContent(props: {
  skin: string;
  photo: Photo | null;
  photoScale: number;
  photoY: number;
  layers: HedLayer[] | null;
  /** MODELPAINT-0605: the part's painted overlay (authored in /cutout) —
   *  composited where the photo sits: over the skin, UNDER the shape
   *  layers (the ruled z-order). */
  overlay?: PaintedOverlay | null;
  width?: number;
  height?: number;
}) {
  const width = props.width ?? UNWRAP_W;
  const height = props.height ?? UNWRAP_H;
  const side = props.photoScale * width;
  return (
    <Box style={{ width, height, backgroundColor: props.skin, position: 'relative', overflow: 'hidden' }}>
      {props.photo ? (
        <Image
          src={props.photo.path}
          style={{
            position: 'absolute',
            left: width / 2 - side / 2,
            top: height / 2 - side / 2 + props.photoY * (height / UNWRAP_H),
            width: side,
            height: side,
          }}
        />
      ) : null}
      {props.overlay ? <PaintedOverlayPaint overlay={props.overlay} w={width} h={height} /> : null}
      {props.layers ? (
        <Box style={{ position: 'absolute', left: 0, top: 0, width, height }}>
          <ScaledLayerPaint layers={props.layers} width={width} height={height} />
        </Box>
      ) : null}
    </Box>
  );
}

/** FaceLayerPaint paints at the kit's UNWRAP dims; the visible canvas is a
 *  different size, so scale the layer boxes to the target rect. */
function ScaledLayerPaint(props: { layers: HedLayer[]; width: number; height: number }) {
  if (props.width === UNWRAP_W && props.height === UNWRAP_H) return <FaceLayerPaint layers={props.layers} />;
  const boxes: any[] = [];
  for (const layer of props.layers) {
    if (!layer.color) continue;
    layer.shapes.forEach((s, si) => {
      const centers = s.mirror ? [s.cx, 1 - s.cx] : [s.cx];
      centers.forEach((cx, ci) => {
        const w = s.rx * 2 * props.width;
        const h = s.ry * 2 * props.height;
        boxes.push(
          <Box
            key={`${layer.id}.${si}.${ci}`}
            style={{
              position: 'absolute',
              left: cx * props.width - w / 2,
              top: s.cy * props.height - h / 2,
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

/** Torso texture stamps when the figure wears underwear: briefs front/back +
 *  bands, bra for the feminine shape. Texture stamps, not scene meshes —
 *  torso and pelvis globes share these unwrap coordinates. */
export function UnderwearTexturePaint(props: { part: PartId; clothing: ClothingId; bottoms: BottomsId; bodyShape: BodyShapeId }) {
  if (props.clothing !== 'underwear' || props.part !== 'torso') return null;
  const feminine = props.bodyShape === 'female';
  const main = BOTTOMS[props.bottoms].primary;
  const trim = BOTTOMS[props.bottoms].secondary;
  const boxes: any[] = [];
  const add = (key: string, left: number, top: number, width: number, height: number, color: string, radius = 2) => {
    boxes.push(
      <Box
        key={key}
        style={{
          position: 'absolute',
          left: left * UNWRAP_W,
          top: top * UNWRAP_H,
          width: width * UNWRAP_W,
          height: height * UNWRAP_H,
          backgroundColor: color,
          borderRadius: radius,
        }}
      />,
    );
  };

  const short = props.bottoms === 'shorts';
  add('brief-front', feminine ? 0.32 : 0.29, short ? 0.69 : 0.75, feminine ? 0.36 : 0.42, short ? 0.2 : 0.14, main, 3);
  add('brief-back', feminine ? 0.32 : 0.29, short ? 0.06 : 0.08, feminine ? 0.36 : 0.42, short ? 0.19 : 0.14, main, 3);
  add('front-band', feminine ? 0.29 : 0.27, short ? 0.675 : 0.735, feminine ? 0.42 : 0.46, 0.022, trim, 1);
  add('back-band', feminine ? 0.29 : 0.27, short ? 0.045 : 0.065, feminine ? 0.42 : 0.46, 0.022, trim, 1);
  add('front-left-cut', feminine ? 0.28 : 0.27, short ? 0.86 : 0.87, 0.16, 0.025, trim, 1);
  add('front-right-cut', feminine ? 0.56 : 0.57, short ? 0.86 : 0.87, 0.16, 0.025, trim, 1);

  if (feminine) {
    add('bra-band', 0.28, 0.33, 0.44, 0.03, trim, 1);
    add('bra-left', 0.34, 0.25, 0.17, 0.105, main, 4);
    add('bra-right', 0.49, 0.25, 0.17, 0.105, main, 4);
    add('strap-left', 0.36, 0.13, 0.025, 0.19, trim, 1);
    add('strap-right', 0.615, 0.13, 0.025, 0.19, trim, 1);
  }

  return <>{boxes}</>;
}

const TEE_CAPTURE_W = 256;
const TEE_CAPTURE_H = 192;

/** One clothing print's artwork (sampled by tee/hoodie clothing meshes). */
function ClothingSkinSurface(props: { skin: ClothingSkinId }) {
  if (props.skin === 'plain') return <Box style={{ width: '100%', height: '100%', backgroundColor: '#ffffff' }} />;
  if (props.skin === 'designer') {
    return (
      <Box style={{ width: '100%', height: '100%', backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', borderWidth: 10, borderColor: '#d4af37' }}>
        <Text fontSize={28} color="#d4af37" style={{ fontWeight: 900 }}>FAUX</Text>
        <Text fontSize={18} color="#f5e6a7" style={{ fontWeight: 900 }}>COUTURE</Text>
      </Box>
    );
  }
  if (props.skin === 'stupid') {
    return (
      <Box style={{ width: '100%', height: '100%', backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
        <Text fontSize={25} color="#111827" style={{ fontWeight: 900 }}>I AM</Text>
        <Text fontSize={21} color="#111827" style={{ fontWeight: 900 }}>WITH</Text>
        <Text fontSize={30} color="#dc2626" style={{ fontWeight: 900 }}>STUPID</Text>
        <Text fontSize={22} color="#111827">-&gt;</Text>
      </Box>
    );
  }
  if (props.skin === 'fourtwenty') {
    return (
      <Box style={{ width: '100%', height: '100%', backgroundColor: '#14532d', alignItems: 'center', justifyContent: 'center', padding: 10 }}>
        <Text fontSize={32} color="#bbf7d0" style={{ fontWeight: 900 }}>4:20</Text>
        <Text fontSize={19} color="#fef3c7" style={{ fontWeight: 900 }}>SOMEWHERE</Text>
      </Box>
    );
  }
  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0f172a', padding: 10, gap: 8 }}>
      {[0, 1, 2, 3].map((row) => (
        <Box key={row} style={{ flexGrow: 1, flexDirection: 'row', gap: 8 }}>
          {[0, 1, 2, 3].map((col) => (
            <Box key={col} style={{ flexGrow: 1, backgroundColor: (row + col) % 2 === 0 ? '#22d3ee' : '#f97316' }} />
          ))}
        </Box>
      ))}
    </Box>
  );
}

/** Every non-plain print baked once under its kit texture key. */
export const ClothingSkinCaptures = memo(function ClothingSkinCaptures() {
  const surfaceStyle = useMemo(
    () => ({ position: 'absolute' as const, left: -99999, top: 0, width: TEE_CAPTURE_W, height: TEE_CAPTURE_H }),
    [],
  );
  return (
    <>
      {(Object.keys(CLOTHING_SKINS) as ClothingSkinId[]).filter((id) => id !== 'plain').map((id) => (
        <StaticSurface key={id} staticKey={clothingSkinTextureKey(id)} style={surfaceStyle}>
          <ClothingSkinSurface skin={id} />
        </StaticSurface>
      ))}
    </>
  );
});

/** The route's offscreen texture stack: the head's composition + one skin
 *  bake per non-head part (the torso's carries underwear stamps). */
export function CharacterEditorCaptures(props: {
  headTexKey: string;
  skinTexKeyFor: (id: PartId) => string;
  skin: string;
  photo: Photo | null;
  photoScale: number;
  photoY: number;
  layers: HedLayer[] | null;
  clothing: ClothingId;
  bottoms: BottomsId;
  bodyShape: BodyShapeId;
  parts: readonly PartId[];
  /** MODELPAINT-0605: the document's painted overlays — the head's rides
   *  the unwrap composition (photo slot); painted body parts composite
   *  under their stamps. The route folds the stamps into the texture keys
   *  (content-addressing), so paintless renders are byte-identical. */
  paint?: FigurePaint;
}) {
  const surfaceStyle = useMemo(
    () => ({ position: 'absolute' as const, left: -99999, top: 0, width: UNWRAP_W, height: UNWRAP_H }),
    [],
  );
  return (
    <>
      <StaticSurface staticKey={props.headTexKey} style={surfaceStyle}>
        <UnwrapContent skin={props.skin} photo={props.photo} photoScale={props.photoScale} photoY={props.photoY} layers={props.layers} overlay={props.paint?.head ?? null} />
      </StaticSurface>
      {props.parts.filter((id) => id !== 'head').map((id) => (
        <StaticSurface key={`skin-${id}`} staticKey={props.skinTexKeyFor(id)} style={surfaceStyle}>
          <Box style={{ width: UNWRAP_W, height: UNWRAP_H, backgroundColor: props.skin, position: 'relative', overflow: 'hidden' }}>
            {props.paint?.[id] ? <PaintedOverlayPaint overlay={props.paint[id]!} w={UNWRAP_W} h={UNWRAP_H} /> : null}
            <UnderwearTexturePaint part={id} clothing={props.clothing} bottoms={props.bottoms} bodyShape={props.bodyShape} />
          </Box>
        </StaticSurface>
      ))}
      <ClothingSkinCaptures />
    </>
  );
}
