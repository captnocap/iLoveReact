# game/textures — the texture pipeline capture (TEXPORT-0606)

**What moved (2026-06-06, USER ASK "properly port that into the correct
space"):** the texture pipeline lived in `cart/hmsc/render3d/` while its whole
authoring surface (TextureStudio, ShaderLab, the cutout painter, the objects
tab) lives in hmsc-int — every consumer was reaching across carts. A faithful
MOVE, not a rewrite: export names, ids, store keys, and behavior unchanged.

| here | lineage |
| --- | --- |
| `shaders.ts` | `cart/hmsc/render3d/textureShaders.ts` (before that `hmsc-int/shaderCatalog.ts`) |
| `materials.ts` | `cart/hmsc/render3d/customTextures.ts` |
| `registry.tsx` | `cart/hmsc/render3d/textures.tsx` |
| `index.ts` | new — the door (the game/world pattern: own module, not a 20th ruled `game/index.ts` entry) |

**Stability contract:** stored materials keep the `custom:<slug>` ids and the
shared 'hmsc' store key `custom-textures` — maps and saves made before the move
resolve unchanged. `TextureDef` / `TextureCapture` / `allTextures` signatures
untouched.

**GAP edges (marked at the import sites):**
- `shaders.ts` ← `hmsc/render3d/{roadTileFill,fillShader}` — the raw WGSL sits
  with the W-2 world-render fills (tileFill prelude family); moves with that lane.
- `registry.tsx` ← `hmsc/render3d/buildingSkins` — the React facade catalog
  (REACT_TEXTURES) retires WITH the hand-coded buildings; the V24 build mode +
  the decal editor replace them.
- `registry.tsx` ← `hmsc/design` (PerceptionState) and `materials.ts` ←
  `hmsc/state/gameState` (store wires) — V15 (hmsc becomes compile/'s output).

**Remaining legacy consumer:** `cart/hmsc/render3d/parts.tsx` imports
`../../hmsc-int/game/textures/registry` — the legacy renderer reading the
captured ground floor, the same direction the V15 compile contract points.

**Why a door here:** the decal editor (the composed Box/Text/Image source) and
the V24 piece/voxel-item texture slots land on THIS registry; authoring routes
and the game must read one list.
