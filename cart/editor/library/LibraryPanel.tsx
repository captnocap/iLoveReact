// SECTION C — Content Browser (see shell/regions.ts SECTIONS): the left panel.
//
// req_3135: the ASSET DOCK. Tucked (350) it is the concept-4 micro dock —
// Assets header, boxed search, Favorites/Recent quick rows, the content tree,
// a count footer, and the selected-asset detail card. Expanded (680) it
// attaches the concept-1 grid column (breadcrumb + thumbnail grid + pager) to
// the tree's right. Both widths are region constants (shell/regions.ts).
//
// req_3137: the grid area MEASURES itself (useMeasure/onLayout) and pages fill
// the measured space — no fixed page size leaving dead rows. Selecting a
// single model shows its parent folder's gallery with that cell highlighted,
// and the detail card resolves models as well as materials in both states.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Box, Image } from '../../../runtime/primitives';
import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import { useContextMenu } from '../../../runtime/hooks/useContextMenu';
import { useMeasure } from '../../../runtime/hooks/useMeasure';
import type { Asset, ContentFolderId, ContentNode, LibraryTab, EditorState, ModelPackage, WorldObject } from '../data/types';
import { assetPageSizeFor, CATALOG_DIAGNOSTICS, MATERIAL_ASSET_COUNT } from '../data/catalog';
import {
  contentFolderLabel,
  contentFolderTrail,
  countAssetsForFolder,
  isMaterialFolder,
  isModelFolder,
  isModelSubfolder,
  modelPackagesForFolder,
  MODEL_GALLERY_PAGE_SIZE,
  subfolderFilesForFolder,
  tabForContentFolder,
} from '../data/content';
import ContentTree from './ContentTree';
import ModelPackageBrowser from './ModelPackageBrowser';
import ModelActionMenu from './ModelActionMenu';
import ModelDetailCard from './ModelDetailCard';
import MaterialCatalogRow from './MaterialCatalogRow';
import FolderSummary from './FolderSummary';
import MaterialControls from './MaterialControls';
import ContextToolControls from './ContextToolControls';

// The grids' own inner padding (workspace.cls HW_Lib*Grid / HW_GalleryGrid).
const GRID_PAD = 10;

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
  onToggleExpanded: () => void;
  onFavorite: (assetId: string) => void;
  onRename: (assetId: string, name: string) => void;
  onPage: (delta: number, maxPage: number) => void;
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
  const gridArea = useMeasure();
  const expanded = props.state.libraryExpanded;
  const renamingModel = props.modelRenamingId
    ? props.models.find((model) => model.id === props.modelRenamingId) ?? null
    : null;
  const folderTab = tabForContentFolder(props.contentFolder);
  // A model subdir (…/mesh|atlases|paints|shaders) lists FILES, not model
  // thumbnails, so it gets its own branch and is excluded from the gallery.
  const showModelSubfolder = isModelSubfolder(props.contentFolder);
  const subfolderView = showModelSubfolder ? subfolderFilesForFolder(props.contentFolder, props.models) : null;
  const showModelPackages = isModelFolder(props.contentFolder) && !showModelSubfolder;
  const showMaterialCatalog = isMaterialFolder(props.contentFolder);
  const canBrowseAssets = showMaterialCatalog || Boolean(folderTab);
  const selectedFolderCount = countAssetsForFolder(props.catalogAssets, props.contentFolder, props.models);
  const trail = contentFolderTrail(props.contentFolder, props.contentTree);

  // ── Measured paging (req_3137): a page holds exactly what the grid area fits.
  // Cell footprints mirror the cls classes — HW_MaterialTile 68 + gap 4 (20px
  // vertical padding), HW_AssetCard 76×68 + gap 7 (20px), HW_GalleryCell 104 +
  // gap 6 (unpadded vertically). Zero until the first onLayout lands, then the
  // catalog fallbacks give way to the measured capacity.
  const capacity = (cellW: number, cellH: number, gap: number, vpad: number): number => {
    const rect = gridArea.rect;
    if (!rect) return 0;
    const cols = Math.max(1, Math.floor((rect.width - GRID_PAD * 2 + gap) / (cellW + gap)));
    const rows = Math.max(1, Math.floor((rect.height - vpad + gap) / (cellH + gap)));
    return cols * rows;
  };
  const pageSize = (showMaterialCatalog ? capacity(68, 68, 4, GRID_PAD * 2) : capacity(76, 68, 7, GRID_PAD * 2))
    || assetPageSizeFor(props.mode, true);
  const modelPageSize = capacity(104, 104, 6, 0) || MODEL_GALLERY_PAGE_SIZE;

  // Selecting a single model keeps the gallery on its PARENT folder with the
  // model's cell highlighted — one thumbnail in an empty grid is dead space.
  const selectedModel = props.models.find((model) => model.folderId === props.contentFolder) ?? null;
  const galleryFolder = selectedModel && trail && trail.length > 1 ? trail[trail.length - 2]!.id : props.contentFolder;
  const galleryModels = showModelPackages ? modelPackagesForFolder(galleryFolder, props.state.search, props.models) : null;

  // One pager for every paged branch (models page like materials/assets do).
  const pagedCount = galleryModels ? galleryModels.length : canBrowseAssets ? props.assets.length : null;
  const activePageSize = galleryModels ? modelPageSize : pageSize;
  const maxPage = Math.max(0, Math.ceil((pagedCount ?? 0) / activePageSize) - 1);
  const page = Math.min(props.state.assetPage, maxPage);
  const firstItem = !pagedCount ? 0 : page * activePageSize + 1;
  const lastItem = !pagedCount ? 0 : Math.min(pagedCount, page * activePageSize + activePageSize);
  const pageAssets = props.assets.slice(page * pageSize, page * pageSize + pageSize);

  // The detail card resolves the dock's current selection: the tree-selected
  // model home, a model subdir's owner, or the open model document.
  const docId = props.state.activeWorkspaceDocumentId;
  const docModel = typeof docId === 'string' && docId.startsWith('model:')
    ? props.models.find((model) => `model:${model.id}` === docId) ?? null
    : null;
  const detailModel = selectedModel ?? subfolderView?.model ?? docModel;

  const onNodeContext = (id: ContentFolderId, event: { x: number; y: number }) => {
    // Only model-home rows (whose id is a model's folderId) open the menu.
    const model = props.models.find((item) => item.folderId === id);
    if (!model) return;
    setMenuModel(model);
    modelMenu.triggerProps.onRightClick(event);
  };

  const favSelected = props.contentFolder === 'materials-favorites';
  const recentSelected = props.contentFolder === 'materials-recent';
  const favCount = countAssetsForFolder(props.catalogAssets, 'materials-favorites', props.models);
  const recentCount = countAssetsForFolder(props.catalogAssets, 'materials-recent', props.models);
  const FavRow = favSelected ? C.HW_QuickRowOn : C.HW_QuickRow;
  const RecentRow = recentSelected ? C.HW_QuickRowOn : C.HW_QuickRow;
  const quickRows = (
    <>
      <FavRow onPress={() => props.onFolder('materials-favorites')}>
        <Icon name="Star" size={12} color={accentFor(favSelected ? 'warning' : 'textDim')} />
        <C.HW_QuickLabel>Favorites</C.HW_QuickLabel>
        <C.HW_Spacer />
        {favCount > 0 ? <C.HW_TreeCount>{favCount}</C.HW_TreeCount> : null}
      </FavRow>
      <RecentRow onPress={() => props.onFolder('materials-recent')}>
        <Icon name="History" size={12} color={accentFor(recentSelected ? 'primary' : 'textDim')} />
        <C.HW_QuickLabel>Recent</C.HW_QuickLabel>
        <C.HW_Spacer />
        {recentCount > 0 ? <C.HW_TreeCount>{recentCount}</C.HW_TreeCount> : null}
      </RecentRow>
    </>
  );

  const tree = (
    <ContentTree
      nodes={props.contentTree}
      assets={props.catalogAssets}
      selected={props.contentFolder}
      expanded={props.expandedFolders}
      onFolder={props.onFolder}
      onToggle={props.onToggleFolder}
      onNodeContext={onNodeContext}
    />
  );

  const footer = (
    <C.HW_LibFoot>
      <C.HW_StatusText>{selectedFolderCount} items</C.HW_StatusText>
      <C.HW_Spacer />
      <C.HW_StatusText>M {props.models.length} · MAT {MATERIAL_ASSET_COUNT} · PKG {CATALOG_DIAGNOSTICS.modelPackages}</C.HW_StatusText>
    </C.HW_LibFoot>
  );

  // The expanded grid column's content: files / model gallery / material tiles /
  // asset cards / folder summary.
  const gridContent = showModelSubfolder ? (
    <C.HW_LibAssetGrid>
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
    </C.HW_LibAssetGrid>
  ) : showModelPackages ? (
    <ModelPackageBrowser
      folder={galleryFolder}
      search={props.state.search}
      page={page}
      pageSize={modelPageSize}
      activeDocumentId={props.state.activeWorkspaceDocumentId}
      selectedFolderId={selectedModel ? props.contentFolder : undefined}
      models={props.models}
      onModel={props.onModel}
      onModelRightClick={(model, event) => { setMenuModel(model); modelMenu.triggerProps.onRightClick(event); }}
    />
  ) : showMaterialCatalog ? (
    <C.HW_LibMaterialGrid>
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
      ))}
    </C.HW_LibMaterialGrid>
  ) : folderTab ? (
    <C.HW_LibAssetGrid>
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
    </C.HW_LibAssetGrid>
  ) : (
    <FolderSummary folder={props.contentFolder} />
  );

  return (
    <Panel expanded={expanded}>
      <C.HW_LibHead>
        <Icon name="FolderOpen" size={14} color={accentFor('primary')} />
        <C.HW_LibTitle>Assets</C.HW_LibTitle>
        <C.HW_Spacer />
        <C.HW_PanelHeadButton tooltip={expanded ? 'Tuck thumbnail grid' : 'Attach thumbnail grid'} onPress={props.onToggleExpanded}>
          <Icon name={expanded ? 'Minimize2' : 'Maximize2'} size={14} color={accentFor(expanded ? 'primary' : 'textDim')} />
        </C.HW_PanelHeadButton>
      </C.HW_LibHead>
      <C.HW_LibSearchRow>
        <C.HW_LibSearchBox>
          <Icon name="Search" size={12} color={accentFor('textFaint')} />
          <C.HW_LibSearchInput placeholder="Search assets..." value={props.state.search} onChange={props.onSearch} />
        </C.HW_LibSearchBox>
      </C.HW_LibSearchRow>
      {renamingModel ? (
        <C.HW_RenameBar>
          <Icon name="Pencil" size={12} color={accentFor('primary')} />
          <C.HW_RenameInput value={renamingModel.name} onChange={(name: string) => props.onModelRename(renamingModel.id, name)} />
          <C.HW_IconMiniButton onPress={props.onModelFinishRename}><Icon name="Check" size={13} color={accentFor('primary')} /></C.HW_IconMiniButton>
        </C.HW_RenameBar>
      ) : null}
      {expanded ? (
        <C.HW_LibBody>
          <C.HW_LibTreeCol>
            {quickRows}
            {tree}
          </C.HW_LibTreeCol>
          <C.HW_LibGridCol>
            <C.HW_LibCrumb>
              {trail ? trail.flatMap((node, index) => {
                const last = index === trail.length - 1;
                const Seg = last ? C.HW_CrumbTextOn : C.HW_CrumbText;
                const crumb = (
                  <C.HW_CrumbSeg key={node.id} onPress={() => props.onFolder(node.id)}>
                    <Seg>{node.label}</Seg>
                  </C.HW_CrumbSeg>
                );
                return index === 0
                  ? [crumb]
                  : [<Icon key={`${node.id}-sep`} name="ChevronRight" size={10} color={accentFor('textFaint')} />, crumb];
              }) : (
                <C.HW_CrumbTextOn>{contentFolderLabel(props.contentFolder)}</C.HW_CrumbTextOn>
              )}
            </C.HW_LibCrumb>
            {pagedCount !== null ? (
              <C.HW_PageBar>
                <C.HW_Pill onPress={() => props.onPage(-1, maxPage)}><Icon name="ChevronLeft" size={11} color={accentFor('textDim')} /></C.HW_Pill>
                <C.HW_PageText>{firstItem}-{lastItem} / {pagedCount}</C.HW_PageText>
                <C.HW_Spacer />
                <C.HW_PageText>{page + 1}/{maxPage + 1}</C.HW_PageText>
                <C.HW_Pill onPress={() => props.onPage(1, maxPage)}><Icon name="ChevronRight" size={11} color={accentFor('textDim')} /></C.HW_Pill>
              </C.HW_PageBar>
            ) : null}
            <Box
              onLayout={gridArea.onLayout}
              style={{ flexGrow: 1, minHeight: 0, flexDirection: 'column', overflow: 'hidden' }}
            >
              {gridContent}
            </Box>
            {footer}
          </C.HW_LibGridCol>
        </C.HW_LibBody>
      ) : (
        <>
          {quickRows}
          {tree}
          {footer}
        </>
      )}
      {showMaterialCatalog ? (
        <MaterialControls
          asset={props.activeAsset}
          onFocus={props.onFocusMaterial}
          onFavorite={props.onFavorite}
          onRename={props.onRename}
        />
      ) : detailModel ? (
        <ModelDetailCard model={detailModel} onOpen={props.onModel} onFavorite={props.onModelFavorite} />
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
    </Panel>
  );
}

// The dock shell: one component so the return stays a single root regardless of
// which fixed width (tucked/expanded) is active.
function Panel({ expanded, children }: { expanded: boolean; children?: ReactNode }) {
  const Shell = expanded ? C.HW_SidePanelWide : C.HW_SidePanel;
  return <Shell>{children}</Shell>;
}
