import { useState } from 'react';
import { Image } from '../../../runtime/primitives';
import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import { useContextMenu } from '../../../runtime/hooks/useContextMenu';
import type { Asset, ContentFolderId, ContentNode, LibraryTab, EditorState, ModelPackage, WorldObject } from '../data/types';
import { assetPageSizeFor, CATALOG_DIAGNOSTICS, MATERIAL_ASSET_COUNT, MODEL_PACKAGE_COUNT } from '../data/catalog';
import {
  contentFolderLabel,
  countAssetsForFolder,
  isMaterialFolder,
  isModelFolder,
  isModelSubfolder,
  subfolderFilesForFolder,
  tabForContentFolder,
} from '../data/content';
import ContentTree from './ContentTree';
import ModelPackageBrowser from './ModelPackageBrowser';
import ModelActionMenu from './ModelActionMenu';
import MaterialCatalogRow from './MaterialCatalogRow';
import FolderSummary from './FolderSummary';
import MaterialControls from './MaterialControls';
import ContextToolControls from './ContextToolControls';

export default function LibraryPanel(props: {
  state: EditorState;
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
  onFocusMaterial: (variant?: number) => void;
  onModel: (model: ModelPackage) => void;
  contentTree: ContentNode[];
  models: ModelPackage[];
  modelRenamingId: string | null;
  onModelStartRename: (id: string) => void;
  onModelRename: (id: string, name: string) => void;
  onModelFinishRename: () => void;
  onModelFavorite: (id: string) => void;
  onModelDuplicate: (model: ModelPackage) => void;
  onModelDelete: (id: string) => void;
}) {
  const modelMenu = useContextMenu();
  const [menuModel, setMenuModel] = useState<ModelPackage | null>(null);
  const renamingModel = props.modelRenamingId
    ? props.models.find((model) => model.id === props.modelRenamingId) ?? null
    : null;
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
  // A model subdir (…/mesh|atlases|paints|shaders) lists FILES, not model
  // thumbnails, so it gets its own branch and is excluded from the gallery.
  const showModelSubfolder = isModelSubfolder(props.contentFolder);
  const subfolderView = showModelSubfolder ? subfolderFilesForFolder(props.contentFolder, props.models) : null;
  const showModelPackages = isModelFolder(props.contentFolder) && !showModelSubfolder;
  const showMaterialCatalog = isMaterialFolder(props.contentFolder);
  const canBrowseAssets = showMaterialCatalog || Boolean(folderTab);
  const selectedFolderCount = countAssetsForFolder(props.catalogAssets, props.contentFolder, props.models);
  return (
    <C.HW_SidePanel>
      <C.HW_PanelHead>
        <Icon name="FolderOpen" size={13} color={accentFor('primary')} />
        <C.HW_Kicker>CONTENT BROWSER</C.HW_Kicker>
        <C.HW_Spacer />
        <C.HW_StatusText>M {props.models.length} · MAT {MATERIAL_ASSET_COUNT} · PKG {CATALOG_DIAGNOSTICS.modelPackages}</C.HW_StatusText>
      </C.HW_PanelHead>
      <C.HW_Search placeholder="search models, paints, materials..." value={props.state.search} onChange={props.onSearch} />
      {renamingModel ? (
        <C.HW_RenameBar>
          <Icon name="Pencil" size={12} color={accentFor('primary')} />
          <C.HW_RenameInput value={renamingModel.name} onChange={(name: string) => props.onModelRename(renamingModel.id, name)} />
          <C.HW_IconMiniButton onPress={props.onModelFinishRename}><Icon name="Check" size={13} color={accentFor('primary')} /></C.HW_IconMiniButton>
        </C.HW_RenameBar>
      ) : null}
      <ContentTree
        nodes={props.contentTree}
        assets={props.catalogAssets}
        selected={props.contentFolder}
        expanded={props.expandedFolders}
        onFolder={props.onFolder}
        onToggle={props.onToggleFolder}
        onNodeContext={(id, event) => {
          // Only model-home rows (whose id is a model's folderId) open the menu.
          const model = props.models.find((item) => item.folderId === id);
          if (!model) return;
          setMenuModel(model);
          modelMenu.triggerProps.onRightClick(event);
        }}
      />
      <C.HW_ContentCrumb>
        <C.HW_Kicker>{title}</C.HW_Kicker>
        <C.HW_Spacer />
        <C.HW_StatusText>{selectedFolderCount} items</C.HW_StatusText>
      </C.HW_ContentCrumb>
      {canBrowseAssets ? (
        <C.HW_PageBar>
          <C.HW_Pill onPress={() => props.onPage(-1)}><Icon name="ChevronLeft" size={11} color={accentFor('textDim')} /></C.HW_Pill>
          <C.HW_PageText>{firstAsset}-{lastAsset} / {props.assets.length}</C.HW_PageText>
          <C.HW_Spacer />
          <C.HW_PageText>{page + 1}/{maxPage + 1}</C.HW_PageText>
          <C.HW_Pill onPress={() => props.onPage(1)}><Icon name="ChevronRight" size={11} color={accentFor('textDim')} /></C.HW_Pill>
        </C.HW_PageBar>
      ) : null}
      {showModelSubfolder ? (
        <C.HW_AssetGrid>
          {(subfolderView?.files.length ?? 0) === 0 ? (
            <C.HW_EmptyState>
              <Icon name="Inbox" size={16} color={accentFor('textFaint')} />
              <C.HW_StatusText>{`empty — Save the model to populate ${subfolderView?.sub ?? 'this'}`}</C.HW_StatusText>
            </C.HW_EmptyState>
          ) : subfolderView!.files.map((file) => {
            // Image files (painted atlases, atlas exports) preview as their actual
            // picture; everything else (stroke json, mesh blobs, wgsl) shows a chip.
            const isImage = /\.(png|jpg|jpeg|webp|bmp)$/i.test(file.name);
            return (
              <C.HW_AssetCard key={file.path}>
                {isImage
                  ? <Image src={file.path} style={{ height: 42, width: '100%' }} />
                  : <C.HW_AssetSwatch style={{ backgroundColor: '#1b2130' }} />}
                <C.HW_AssetLabel numberOfLines={1} noWrap>{file.name}</C.HW_AssetLabel>
                <C.HW_AssetMeta numberOfLines={1} noWrap>{file.sub}</C.HW_AssetMeta>
              </C.HW_AssetCard>
            );
          })}
        </C.HW_AssetGrid>
      ) : showModelPackages ? (
        <ModelPackageBrowser
          folder={props.contentFolder}
          search={props.state.search}
          page={props.state.assetPage}
          activeDocumentId={props.state.activeWorkspaceDocumentId}
          models={props.models}
          onPage={props.onPage}
          onModel={props.onModel}
          onModelRightClick={(model, event) => { setMenuModel(model); modelMenu.triggerProps.onRightClick(event); }}
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
          onFavorite={props.onFavorite}
          onRename={props.onRename}
        />
      ) : folderTab ? (
        <ContextToolControls mode={props.mode} activeObject={props.activeObject} />
      ) : null}
      <modelMenu.ContextMenu>
        {menuModel ? (
          <ModelActionMenu
            model={menuModel}
            onRename={props.onModelStartRename}
            onFavorite={props.onModelFavorite}
            onDuplicate={props.onModelDuplicate}
            onDelete={props.onModelDelete}
            onClose={modelMenu.close}
          />
        ) : null}
      </modelMenu.ContextMenu>
    </C.HW_SidePanel>
  );
}
