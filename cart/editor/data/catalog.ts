// Editor catalog helpers backed by local model packages and shader recipes.
import { EDITOR_ASSET_CATALOG } from './assetCatalog';
import type { Asset, AssetOverride, LibraryTab, ModelPackage } from './types';
import type { MaterialRef } from '../world/pieces';

export const ASSET_PAGE_SIZE = 12;
export const MATERIAL_PAGE_SIZE = 16;

export const ASSETS: Asset[] = EDITOR_ASSET_CATALOG.assets;
export const MODEL_PACKAGES: ModelPackage[] = EDITOR_ASSET_CATALOG.modelPackages;
export const MODEL_PACKAGE_COUNT = MODEL_PACKAGES.length;
export const MATERIAL_ASSET_COUNT = ASSETS.filter((asset) => asset.tab === 'Skins').length;
export const DEFAULT_ASSET_ID = EDITOR_ASSET_CATALOG.defaultAssetId;
export const DEFAULT_CONTENT_FOLDER = EDITOR_ASSET_CATALOG.defaultContentFolder;
export const CATALOG_DIAGNOSTICS = EDITOR_ASSET_CATALOG.diagnostics;

export function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, value));
}

export function shadeHex(hex: string, offset: number): string {
  const clean = hex.replace('#', '');
  const parts = [0, 2, 4].map((start) => {
    const channel = parseInt(clean.slice(start, start + 2), 16);
    return clampChannel(channel + offset).toString(16).padStart(2, '0');
  });
  return `#${parts.join('')}`;
}

export function variantColor(asset: Asset, index: number): string {
  return shadeHex(asset.color, (index - 1) * 13);
}

export function applyAssetOverride(asset: Asset, override?: AssetOverride): Asset {
  return {
    ...asset,
    name: override?.name ?? asset.name,
    favorite: override?.favorite ?? asset.favorite,
  };
}

export function applyAssetOverrides(assets: Asset[], overrides: Record<string, AssetOverride>): Asset[] {
  return assets.map((asset) => applyAssetOverride(asset, overrides[asset.id]));
}

export function assetById(id: string, overrides: Record<string, AssetOverride> = {}): Asset {
  const asset = ASSETS.find((item) => item.id === id) ?? ASSETS[0]!;
  return applyAssetOverride(asset, overrides[asset.id]);
}

export function assetPageSizeFor(tab: LibraryTab): number {
  return tab === 'Skins' ? MATERIAL_PAGE_SIZE : ASSET_PAGE_SIZE;
}

/** Resolve a piece slot's MaterialRef to a display label + swatch colour — the ONE
 *  resolver behind the Inspector's slot rows and the world quick menu (req_2733). */
export function resolveMaterialRef(ref: MaterialRef, overrides: Record<string, AssetOverride> = {}): { label: string; color: string } {
  if ('assetId' in ref) {
    const asset = assetById(ref.assetId, overrides);
    return { label: asset.name, color: asset.color };
  }
  return { label: `${ref.fn}·${ref.variant}`, color: '#7d858d' };
}
