// game/textures — THE TEXTURE PIPELINE DOOR (TEXPORT-0606).
//
// The locked art→material vocabulary's machinery, behind the captured ground
// floor: tunable WGSL RECIPES (./shaders), the stored MATERIALS Materialize
// freezes (./materials), and THE ONE REGISTRY every face/tile/part samples by
// id (./registry — TextureDef, allTextures, textureById, TextureCapture).
//
// Consumers import this door (or its subpaths, the '@game/figure/render'
// idiom): the texture studio, the cutout painter, the objects tab, and the
// legacy game renderer (cart/hmsc/render3d/parts.tsx) all read the SAME list.
// Follows the game/world pattern: its own module, not a 20th entry in the
// ruled game/index.ts door list.

export {
  paramDefaults,
  defaultShaderData,
  shaderSpec,
  shaderGroups,
  HMSC_SHADERS,
  CUTOUT_STENCIL_SHADER,
  type ShaderParam,
  type ShaderVariant,
  type ShaderSpec,
} from './shaders';
export {
  loadCustomTextures,
  saveCustomTexture,
  removeCustomTexture,
  useCustomTextures,
  type CustomTexture,
} from './materials';
export {
  TEXTURE_REGISTRY,
  TEXTURE_IDS,
  allTextures,
  textureById,
  TextureCapture,
  skinCapturePx,
  type TextureRenderCtx,
  type TextureSource,
  type TextureDef,
} from './registry';
