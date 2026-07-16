// editor/library/ModelPackageBrowser.tsx — the model gallery grid.
//
// req_2276: the model "menu" is a picture-only gallery — product-shot
// thumbnails, no flavor text (no name / path / atlas-paint-decomp counts /
// stage badges). Pressing a thumbnail opens that model as a workspace document.
// The directory structure lives in the content tree; this surface is just the
// pictures. req_3137: it renders inside the expanded dock's measured grid area —
// pageSize comes from that measure and the pager row is the dock's shared one
// (LibraryPanel), so this is purely the grid of cells.
import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { ContentFolderId, ModelPackage } from '../data/types';
import { modelPackagesForFolder } from '../data/content';
import ModelThumbnail from './ModelThumbnail';

export default function ModelPackageBrowser({
  folder,
  search,
  page,
  pageSize,
  activeDocumentId,
  selectedFolderId,
  models,
  onModel,
  onModelRightClick,
}: {
  folder: ContentFolderId;
  search: string;
  page: number;
  // Measured by the dock's grid area (req_3137) so a page fills the space.
  pageSize: number;
  activeDocumentId: string;
  // The tree-selected model's home folder — its cell highlights even when the
  // document isn't open (single-model selection shows its siblings, req_3137).
  selectedFolderId?: ContentFolderId;
  models: ModelPackage[];
  onModel: (model: ModelPackage) => void;
  onModelRightClick: (model: ModelPackage, event: { x: number; y: number }) => void;
}) {
  const shown = modelPackagesForFolder(folder, search, models);
  const maxPage = Math.max(0, Math.ceil(shown.length / pageSize) - 1);
  const safePage = Math.min(page, maxPage);
  const pageModels = shown.slice(safePage * pageSize, safePage * pageSize + pageSize);
  return (
    <C.HW_GalleryGrid>
      {shown.length === 0 ? (
        <C.HW_EmptyState>
          <Icon name="SearchX" size={16} color={accentFor('textFaint')} />
          <C.HW_StatusText>no models</C.HW_StatusText>
        </C.HW_EmptyState>
      ) : pageModels.map((model) => {
        const active = activeDocumentId === `model:${model.id}` || model.folderId === selectedFolderId;
        const Cell = active ? C.HW_GalleryCellOn : C.HW_GalleryCell;
        return (
          <Cell
            key={model.id}
            onPress={() => onModel(model)}
            onRightClick={(event: { x: number; y: number }) => onModelRightClick(model, event)}
            style={{ backgroundColor: model.color }}
          >
            <ModelThumbnail model={model} />
          </Cell>
        );
      })}
    </C.HW_GalleryGrid>
  );
}
