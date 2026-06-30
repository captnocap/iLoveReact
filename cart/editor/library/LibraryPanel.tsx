import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { Asset, ContentFolderId, LibraryTab, MockState, ModelPackage, WorldObject } from '../data/types';
import { assetPageSizeFor, CATALOG_DIAGNOSTICS, MATERIAL_ASSET_COUNT, MODEL_PACKAGE_COUNT } from '../data/catalog';
import {
  CONTENT_TREE,
  contentFolderLabel,
  countAssetsForFolder,
  isMaterialFolder,
  isModelFolder,
  tabForContentFolder,
} from '../data/content';
import ContentTree from './ContentTree';
import ModelPackageBrowser from './ModelPackageBrowser';
import MaterialCatalogRow from './MaterialCatalogRow';
import FolderSummary from './FolderSummary';
import MaterialControls from './MaterialControls';
import ContextToolControls from './ContextToolControls';

export default function LibraryPanel(props: {
  state: MockState;
  catalogAssets: Asset[];
  assets: Asset[];
  mode: LibraryTab;
  activeAsset: Asset;
  activeObject: WorldObject;
  contentFolder: ContentFolderId;
  expandedFolders: Partial<Record<ContentFolderId, boolean>>;
  onSearch: (search: string) => void;
  onAsset: (asset: Asset) => void;
  onFolder: (folder: ContentFolderId) => void;
  onToggleFolder: (folder: ContentFolderId) => void;
  onFavorite: (assetId: string) => void;
  onRename: (assetId: string, name: string) => void;
  onPage: (delta: number) => void;
  onFocusMaterial: () => void;
  onMaterialAction: (label: string) => void;
  onModel: (model: ModelPackage) => void;
}) {
  const pageSize = assetPageSizeFor(props.mode);
  const maxPage = Math.max(0, Math.ceil(props.assets.length / pageSize) - 1);
  const page = Math.min(props.state.assetPage, maxPage);
  const pageAssets = props.assets.slice(page * pageSize, page * pageSize + pageSize);
  const firstAsset = props.assets.length === 0 ? 0 : page * pageSize + 1;
  const lastAsset = Math.min(props.assets.length, firstAsset + pageAssets.length - 1);
  const emptySlots = Math.max(0, pageSize - pageAssets.length);
  const title = props.mode === 'Skins'
    ? contentFolderLabel(props.contentFolder).toUpperCase()
    : props.mode === 'Build'
      ? contentFolderLabel(props.contentFolder).toUpperCase()
      : contentFolderLabel(props.contentFolder).toUpperCase();
  const folderTab = tabForContentFolder(props.contentFolder);
  const showModelPackages = isModelFolder(props.contentFolder);
  const showMaterialCatalog = isMaterialFolder(props.contentFolder);
  const canBrowseAssets = showMaterialCatalog || Boolean(folderTab);
  const selectedFolderCount = countAssetsForFolder(props.catalogAssets, props.contentFolder);
  return (
    <C.HW_SidePanel>
      <C.HW_PanelHead>
        <Icon name="FolderOpen" size={13} color={accentFor('primary')} />
        <C.HW_Kicker>CONTENT BROWSER</C.HW_Kicker>
        <C.HW_Spacer />
        <C.HW_StatusText>M {MODEL_PACKAGE_COUNT} · MAT {MATERIAL_ASSET_COUNT} · C {CATALOG_DIAGNOSTICS.cookedAssets}</C.HW_StatusText>
      </C.HW_PanelHead>
      <C.HW_Search placeholder="search models, paints, materials..." value={props.state.search} onChange={props.onSearch} />
      <ContentTree
        nodes={CONTENT_TREE}
        assets={props.catalogAssets}
        selected={props.contentFolder}
        expanded={props.expandedFolders}
        onFolder={props.onFolder}
        onToggle={props.onToggleFolder}
      />
      <C.HW_ContentCrumb>
        <C.HW_Kicker>{title}</C.HW_Kicker>
        <C.HW_Spacer />
        <C.HW_StatusText>{selectedFolderCount} items</C.HW_StatusText>
      </C.HW_ContentCrumb>
      {canBrowseAssets ? (
        <C.HW_PageBar>
          <C.HW_Pill onPress={() => props.onPage(-1)}><Icon name="ChevronLeft" size={11} color={accentFor('textDim')} /></C.HW_Pill>
          <C.HW_PageText>{firstAsset}-{lastAsset} / {props.assets.length} - {pageSize} fixed slots</C.HW_PageText>
          <C.HW_Spacer />
          <C.HW_PageText>{page + 1}/{maxPage + 1}</C.HW_PageText>
          <C.HW_Pill onPress={() => props.onPage(1)}><Icon name="ChevronRight" size={11} color={accentFor('textDim')} /></C.HW_Pill>
        </C.HW_PageBar>
      ) : null}
      {showModelPackages ? (
        <ModelPackageBrowser
          folder={props.contentFolder}
          search={props.state.search}
          page={props.state.assetPage}
          activeDocumentId={props.state.activeWorkspaceDocumentId}
          onFolder={props.onFolder}
          onPage={props.onPage}
          onAction={props.onMaterialAction}
          onModel={props.onModel}
        />
      ) : showMaterialCatalog ? (
        <C.HW_MaterialGrid>
          {pageAssets.length === 0 ? (
            <C.HW_EmptyState>
              <Icon name="SearchX" size={16} color={accentFor('textFaint')} />
              <C.HW_StatusText>no catalog entries</C.HW_StatusText>
            </C.HW_EmptyState>
          ) : pageAssets.map((asset) => (
            <MaterialCatalogRow
              key={asset.id}
              asset={asset}
              active={props.state.activeAssetId === asset.id}
              onAsset={props.onAsset}
              onFavorite={props.onFavorite}
              onVariant={props.onMaterialAction}
            />
          )).concat(
            Array.from({ length: emptySlots }, (_, index) => (
              <C.HW_MaterialTileEmpty key={`empty-slot-${page}-${index}`} />
            )),
          )}
        </C.HW_MaterialGrid>
      ) : folderTab ? (
        <C.HW_AssetGrid>
          {pageAssets.length === 0 ? (
          <C.HW_EmptyState>
            <Icon name="SearchX" size={16} color={accentFor('textFaint')} />
            <C.HW_StatusText>no catalog entries</C.HW_StatusText>
          </C.HW_EmptyState>
          ) : pageAssets.map((asset) => {
            const Card = props.state.activeAssetId === asset.id ? C.HW_AssetCardOn : C.HW_AssetCard;
            return (
              <Card key={asset.id} onPress={() => props.onAsset(asset)}>
                <C.HW_AssetSwatch style={{ backgroundColor: asset.color }} />
                <C.HW_AssetLabel numberOfLines={1} noWrap>{asset.name}</C.HW_AssetLabel>
                <C.HW_AssetMeta numberOfLines={1} noWrap>{asset.semanticKind ?? asset.sourceKind ?? 'indexed'}</C.HW_AssetMeta>
              </Card>
            );
          })}
        </C.HW_AssetGrid>
      ) : (
        <FolderSummary folder={props.contentFolder} />
      )}
      {showMaterialCatalog ? (
        <MaterialControls
          asset={props.activeAsset}
          onFocus={props.onFocusMaterial}
          onAction={props.onMaterialAction}
          onFavorite={props.onFavorite}
          onRename={props.onRename}
        />
      ) : folderTab ? (
        <ContextToolControls mode={props.mode} activeObject={props.activeObject} onAction={props.onMaterialAction} />
      ) : null}
    </C.HW_SidePanel>
  );
}
