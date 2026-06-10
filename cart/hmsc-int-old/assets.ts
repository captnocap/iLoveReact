// The asset library — the set of placeable things the world builder offers and
// the world .tsx imports. An ASSET is a React/Scene3D component that, given a
// placement (address + rotation + optional overrides), emits its meshes at that
// footprint. The library is the single list the palette renders, the ghost sizes
// against, and the world file resolves <Tag/> imports from.
//
// THE KEY PROPERTY (so the AI lane is a drop-in, not a refactor): an
// AI-generated asset is structurally identical to a hand-authored one — a
// component file under the assets dir + one entry here. Nothing downstream
// (placement, world-file serialize, bake) cares which made it. So "generate an
// asset" reduces to "write a .tsx to the authoring contract + append a registry
// line" — see assetPrompt.ts for the contract the model is given.
//
// Seeded from the existing hmsc building/prop KIND defs so the palette is real
// on day one (same sizes/colors the game already uses — one source, no dup). New
// bespoke assets (a prompted parking garage, a custom statue) append here.

import { BUILDING_KINDS, buildingKindDefinition } from '../hmsc-int/world/buildingKinds';
import { PROP_KINDS, propKindDefinition } from '../hmsc-int/world/propKinds';

export type AssetCategory = 'building' | 'prop' | 'structure' | 'custom';

export type AssetDef = {
  // The component name == the JSX tag the world file writes (<House at=... />)
  // and the named import it pulls in. Must be a valid TS identifier + unique.
  name: string;
  // Module the world file imports the component from, relative to the world file
  // (cart/hmsc/world/authoredWorld.tsx). Asset components live beside it under
  // ./assets/. Hand-authored and AI-authored assets share this convention.
  from: string;
  category: AssetCategory;
  // Default footprint in tiles (1 tile = 1 m) — sizes the placement ghost and
  // the palette chip. A placement may override via props the asset accepts.
  footprint: { w: number; d: number };
  // Palette/map swatch — the ONE color source (mirrors the kind's own swatch so
  // the builder and the game agree).
  swatch: string;
  // Short human label for the palette.
  label: string;
};

// Turn a kind id into the asset component name: 'parkingGarage' -> 'ParkingGarage'.
function pascal(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

// Building kinds → assets. The component for each lives at ./assets/<Name>; that
// adapter wraps the game's own Building3D renderer (created in the render/bake
// step — the registry is the contract those files implement).
const buildingAssets: AssetDef[] = BUILDING_KINDS.map((kind) => {
  const def = buildingKindDefinition(kind);
  const name = pascal(kind);
  return {
    name,
    from: `./assets/${name}`,
    category: 'building',
    footprint: { w: def.defaultWidthTiles, d: def.defaultDepthTiles },
    swatch: def.facadeColor,
    label: def.label,
  };
});

// Prop kinds → assets. Point furniture: footprint is the kind's collision square
// (min 1 tile so a thin sign still gets a placeable chip).
const propAssets: AssetDef[] = PROP_KINDS.map((kind) => {
  const def = propKindDefinition(kind);
  const name = pascal(kind);
  const span = Math.max(1, Math.round(def.footprintRadiusMeters * 2));
  return {
    name,
    from: `./assets/${name}`,
    category: 'prop',
    footprint: { w: span, d: span },
    swatch: '#8a8f98',
    label: def.label,
  };
});

export const ASSETS: AssetDef[] = [...buildingAssets, ...propAssets];

const ASSET_BY_NAME = new Map(ASSETS.map((a) => [a.name, a]));

export function assetByName(name: string): AssetDef | undefined {
  return ASSET_BY_NAME.get(name);
}

export function assetsForCategory(category: AssetCategory): AssetDef[] {
  return ASSETS.filter((a) => a.category === category);
}

export const ASSET_CATEGORIES: AssetCategory[] = ['building', 'prop', 'structure', 'custom'];
