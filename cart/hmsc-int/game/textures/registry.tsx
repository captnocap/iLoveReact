import { memo, useMemo } from 'react';
import { Effect, StaticSurface } from '@reactjit/primitives';
// GAP(V15): the PerceptionState type rides the legacy design module until hmsc
// becomes compile/'s output.
import type { PerceptionState } from '../../design';
// GAP(buildings): the React facade catalog stays with the legacy building
// renderer — these REACT_TEXTURES entries retire WITH the hand-coded buildings
// (the V24 build mode replaces them); only the import path keeps them alive.
import { BUILDING_SKINS, type BuildingSkin, skinCapturePx } from '../../render3d/buildingSkins';
import { HMSC_SHADERS, defaultShaderData, shaderSpec } from './shaders';
import { type CustomTexture, loadCustomTextures } from './materials';
import { DecalSurface } from './decalRender';

// game/textures/registry.tsx — THE TEXTURE REGISTRY: one flat list of bakeable
// surface looks. (Lineage: cart/hmsc/render3d/textures.tsx; TEXPORT-0606 moved
// the texture pipeline behind the game/textures door. Export names unchanged.)
//
// To everyone downstream a texture is ONE thing: a named look that bakes to a
// GPU texture and gets sampled by `textureKey` on a tile, a prop, or a building
// face. There are two ways to AUTHOR one — paint a SHADER (a WGSL `<Effect>`) or
// lay out 2D REACT UI (`Box`/`Text`) — but that distinction is purely how it was
// made. Both bake the identical way (render the child into a `<StaticSurface>`,
// which the engine captures to a texture), so the source kind never leaks past
// this file into the picker, the tree, or the world data. See feedback memory
// "texture is one concept": the user sees a texture, not a shader-vs-skin split.
//
// This is the single source of truth the game renders from AND the editor
// browses. Shader entries derive from the ./shaders catalog (texture id ==
// spec id, default data == defaultShaderData — no hand-written data arrays), and
// the studio's saved materials (./materials) hydrate in via allTextures().

export type TextureRenderCtx = {
  widthMeters: number;
  heightMeters: number;
  widthPx?: number;
  heightPx?: number;
  cols: number;
  floors: number;
  perception: PerceptionState;
};

// How a texture bakes. `react` renders 2D UI; `shader` runs a WGSL fragment with
// a packed data[] array. Same `<StaticSurface>` capture wraps either child.
export type TextureSource =
  | { kind: 'react'; render: (ctx: TextureRenderCtx) => any }
  | { kind: 'shader'; shader: string; data: number[] };

export type TextureDef = {
  id: string;
  label: string;
  source: TextureSource;
};

function titleCase(id: string): string {
  return id
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

// The 2D-React textures: every building-skin facade, lifted into the one list.
// `plain` is intentionally absent (it means "no texture — bare wall"). Each
// facade's own (skin, cols, floors, …) context is filled from the render ctx.
const REACT_TEXTURES: TextureDef[] = Object.keys(BUILDING_SKINS).map((id) => ({
  id,
  label: titleCase(id),
  source: {
    kind: 'react',
    render: (ctx: TextureRenderCtx) =>
      BUILDING_SKINS[id as BuildingSkin]!({ skin: id as BuildingSkin, ...ctx }),
  },
}));

// The shader textures: every catalog recipe (./shaders.ts) at its
// default look — texture id == spec id, so the editor opens the matching lab and
// `defaultShaderData` is THE default (no hand-written data arrays). The studio's
// tuned saves land in customTextures and hydrate below.
const SHADER_TEXTURES: TextureDef[] = HMSC_SHADERS.map((spec) => ({
  id: spec.id,
  label: spec.label,
  source: { kind: 'shader', shader: spec.shader, data: defaultShaderData(spec) },
}));

export const TEXTURE_REGISTRY: TextureDef[] = [...SHADER_TEXTURES, ...REACT_TEXTURES];

// A stored material (studio Materialize) → a regular TextureDef: same shader as
// its recipe, frozen data. Unknown shaderId (a spec that was removed) → null.
function customTextureDef(t: CustomTexture): TextureDef | null {
  // DECAL source (DECALEDIT-0606): the composed Box/Text/Image doc renders
  // through DecalSurface, stretched to the capture's pixel bucket — a plain
  // react-source TextureDef, so TextureCapture/pickers need no decal knowledge.
  if (t.decal) {
    const doc = t.decal;
    return {
      id: t.id,
      label: t.label,
      source: {
        kind: 'react',
        render: (ctx: TextureRenderCtx) => (
          <DecalSurface doc={doc} width={ctx.widthPx ?? skinCapturePx(ctx.cols)} height={ctx.heightPx ?? skinCapturePx(ctx.floors)} />
        ),
      },
    };
  }
  if (t.shaderId === undefined || t.data === undefined) return null;
  const spec = shaderSpec(t.shaderId);
  if (!spec) return null;
  return { id: t.id, label: t.label, source: { kind: 'shader', shader: spec.shader, data: t.data } };
}

// Every texture an id can resolve to: built-ins + the stored materials. Reads the
// store each call — pair with useCustomTextures() when a component must re-render
// on save/remove.
export function allTextures(): TextureDef[] {
  const customs = loadCustomTextures().map(customTextureDef).filter((t): t is TextureDef => t !== null);
  return [...TEXTURE_REGISTRY, ...customs];
}

export function textureById(id: string): TextureDef | undefined {
  const builtin = TEXTURE_REGISTRY.find((t) => t.id === id);
  if (builtin) return builtin;
  const stored = loadCustomTextures().find((t) => t.id === id);
  return stored ? customTextureDef(stored) ?? undefined : undefined;
}

export const TEXTURE_IDS: string[] = TEXTURE_REGISTRY.map((t) => t.id);

// ── Baking ──────────────────────────────────────────────────────────────────
//
// One capture for BOTH sources: wrap the source's child in a `<StaticSurface>`
// keyed by `staticKey`; the engine hands every mesh sampling that key a texture.
// This generalizes what BuildingFacades' FacadeCapture and tileSurface's
// RegionCapture each did by hand — same memoization discipline (stable data/
// style identities) so the heavy bake happens once and the cache holds across
// player/camera churn (the StaticSurface inline-prop rebake trap).
export const TextureCapture = memo(function TextureCapture(props: {
  textureId: string;
  staticKey: string;
  widthPx: number;
  heightPx: number;
  cols: number;
  floors: number;
  perception: PerceptionState;
  data?: number[];
}) {
  const def = textureById(props.textureId);
  const { widthPx: w, heightPx: h } = props;
  const surfaceStyle = useMemo(
    () => ({ position: 'absolute' as const, left: -99999, top: 0, width: w, height: h }),
    [w, h],
  );
  const childStyle = useMemo(() => ({ width: w, height: h }), [w, h]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- perception excluded on
  // purpose: the static catalog does not read it, so it must not trigger a re-bake.
  const child = useMemo(() => {
    if (!def) return null;
    if (def.source.kind === 'shader') {
      return <Effect shader={def.source.shader} data={props.data ?? def.source.data} style={childStyle} />;
    }
    return def.source.render({
      widthMeters: props.cols * 3,
      heightMeters: props.floors * 3,
      widthPx: props.widthPx,
      heightPx: props.heightPx,
      cols: props.cols,
      floors: props.floors,
      perception: props.perception,
    });
  }, [props.textureId, props.cols, props.floors, props.data, childStyle]);
  if (!def) return null;
  return (
    <StaticSurface staticKey={props.staticKey} style={surfaceStyle}>
      {child}
    </StaticSurface>
  );
});

// Re-export the px sizing helper so capture mounts can size consistently.
export { skinCapturePx };
