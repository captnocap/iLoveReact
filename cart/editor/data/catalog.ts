// editor/data/catalog.ts - catalog helpers backed by hmsc-int stored data.
import { HMSC_EDITOR_CATALOG } from './hmscAssetCatalog';
import type { Asset, AssetOverride, LibraryTab, ModelPackage } from './types';

export const ASSET_PAGE_SIZE = 12;
export const MATERIAL_PAGE_SIZE = 16;

export const ASSETS: Asset[] = HMSC_EDITOR_CATALOG.assets;
export const MODEL_PACKAGES: ModelPackage[] = HMSC_EDITOR_CATALOG.modelPackages;
export const MODEL_PACKAGE_COUNT = MODEL_PACKAGES.length;
export const MATERIAL_ASSET_COUNT = ASSETS.filter((asset) => asset.tab === 'Skins').length;
export const DEFAULT_ASSET_ID = HMSC_EDITOR_CATALOG.defaultAssetId;
export const DEFAULT_CONTENT_FOLDER = HMSC_EDITOR_CATALOG.defaultContentFolder;
export const CATALOG_DIAGNOSTICS = HMSC_EDITOR_CATALOG.diagnostics;

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
