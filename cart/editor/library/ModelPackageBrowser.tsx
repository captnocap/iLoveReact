// editor/library/ModelPackageBrowser.tsx — the model gallery.
//
// req_2276: the model "menu" is a picture-only gallery — product-shot
// thumbnails, no flavor text (no name / path / atlas-paint-decomp counts /
// stage badges). Pressing a thumbnail opens that model as a workspace document.
// The directory structure lives in the content tree above (models/<category>/);
// this surface is just the pictures.
import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { ContentFolderId, ModelPackage } from '../data/types';
import { MODEL_GALLERY_PAGE_SIZE, modelPackagesForFolder } from '../data/content';
import ModelThumbnail from './ModelThumbnail';

export default function ModelPackageBrowser({
  folder,
  search,
  page,
  activeDocumentId,
  onPage,
  onModel,
}: {
  folder: ContentFolderId;
  search: string;
  page: number;
  activeDocumentId: string;
  onPage: (delta: number) => void;
  onModel: (model: ModelPackage) => void;
}) {
  const models = modelPackagesForFolder(folder, search);
  const pageSize = MODEL_GALLERY_PAGE_SIZE;
  const maxPage = Math.max(0, Math.ceil(models.length / pageSize) - 1);
  const safePage = Math.min(page, maxPage);
  const pageModels = models.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const firstModel = models.length === 0 ? 0 : safePage * pageSize + 1;
  const lastModel = Math.min(models.length, firstModel + pageModels.length - 1);
  return (
    <C.HW_ModelGallery>
      <C.HW_GalleryPager>
        <C.HW_IconMiniButton onPress={() => onPage(-1)}><Icon name="ChevronLeft" size={11} color={accentFor('textDim')} /></C.HW_IconMiniButton>
        <C.HW_StatusText>{firstModel}-{lastModel} / {models.length}</C.HW_StatusText>
        <C.HW_Spacer />
        <C.HW_StatusText>{safePage + 1}/{maxPage + 1}</C.HW_StatusText>
        <C.HW_IconMiniButton onPress={() => onPage(1)}><Icon name="ChevronRight" size={11} color={accentFor('textDim')} /></C.HW_IconMiniButton>
      </C.HW_GalleryPager>
      <C.HW_GalleryGrid>
        {models.length === 0 ? (
          <C.HW_EmptyState>
            <Icon name="SearchX" size={16} color={accentFor('textFaint')} />
            <C.HW_StatusText>no models</C.HW_StatusText>
          </C.HW_EmptyState>
        ) : pageModels.map((model) => {
          const Cell = activeDocumentId === `model:${model.id}` ? C.HW_GalleryCellOn : C.HW_GalleryCell;
          return (
            <Cell key={model.id} onPress={() => onModel(model)} style={{ backgroundColor: model.color }}>
              <ModelThumbnail model={model} />
            </Cell>
          );
        })}
      </C.HW_GalleryGrid>
    </C.HW_ModelGallery>
  );
}
