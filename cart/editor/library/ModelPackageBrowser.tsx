import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { ContentFolderId, ModelPackage } from '../data/types';
import { exactModelForFolder, modelPackagesForFolder } from '../data/content';
import ModelPackageDetail from './ModelPackageDetail';
import ModelThumbnail from './ModelThumbnail';

export default function ModelPackageBrowser({
  folder,
  search,
  page,
  activeDocumentId,
  onFolder,
  onPage,
  onAction,
  onModel,
}: {
  folder: ContentFolderId;
  search: string;
  page: number;
  activeDocumentId: string;
  onFolder: (folder: ContentFolderId) => void;
  onPage: (delta: number) => void;
  onAction: (label: string) => void;
  onModel: (model: ModelPackage) => void;
}) {
  const exactModel = exactModelForFolder(folder);
  const models = modelPackagesForFolder(folder, search);
  const pageSize = 5;
  const maxPage = Math.max(0, Math.ceil(models.length / pageSize) - 1);
  const safePage = Math.min(page, maxPage);
  const pageModels = models.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const firstModel = models.length === 0 ? 0 : safePage * pageSize + 1;
  const lastModel = Math.min(models.length, firstModel + pageModels.length - 1);
  if (exactModel) {
    return <ModelPackageDetail model={exactModel} onAction={onAction} onOpen={() => onModel(exactModel)} />;
  }
  return (
    <C.HW_ModelBrowser>
      <C.HW_GroupTitle>
        <Icon name="Box" size={12} color={accentFor('primary')} />
        <C.HW_GroupText>MODEL HOMES</C.HW_GroupText>
        <C.HW_Spacer />
        <C.HW_IconMiniButton onPress={() => onPage(-1)}><Icon name="ChevronLeft" size={11} color={accentFor('textDim')} /></C.HW_IconMiniButton>
        <C.HW_StatusText>{firstModel}-{lastModel} / {models.length}</C.HW_StatusText>
        <C.HW_IconMiniButton onPress={() => onPage(1)}><Icon name="ChevronRight" size={11} color={accentFor('textDim')} /></C.HW_IconMiniButton>
      </C.HW_GroupTitle>
      {models.length === 0 ? (
        <C.HW_EmptyState>
          <Icon name="SearchX" size={16} color={accentFor('textFaint')} />
          <C.HW_StatusText>no model homes</C.HW_StatusText>
        </C.HW_EmptyState>
      ) : pageModels.map((model) => {
        const Card = activeDocumentId === `model:${model.id}` ? C.HW_ModelCardOn : C.HW_ModelCard;
        return (
        <Card key={model.id} onPress={() => onModel(model)}>
          <C.HW_ModelThumb style={{ backgroundColor: model.color }}>
            <ModelThumbnail model={model} />
          </C.HW_ModelThumb>
          <C.HW_ModelCardMain>
            <C.HW_MaterialTitleRow>
              <C.HW_MaterialName>{model.name}</C.HW_MaterialName>
              <C.HW_Spacer />
              <C.HW_MaterialStat>{model.stage}</C.HW_MaterialStat>
            </C.HW_MaterialTitleRow>
            <C.HW_ModelPath>{model.path}</C.HW_ModelPath>
            <C.HW_ModelMetaRow>
              <C.HW_MaterialStat>{model.atlases.length} atlases</C.HW_MaterialStat>
              <C.HW_MaterialStat>{model.paints.length} paints</C.HW_MaterialStat>
              <C.HW_MaterialStat>{model.decompositions.length} decomps</C.HW_MaterialStat>
            </C.HW_ModelMetaRow>
          </C.HW_ModelCardMain>
          <C.HW_IconMiniButton onPress={() => onFolder(model.folderId)}>
            <Icon name="FolderOpen" size={13} color={accentFor('primary')} />
          </C.HW_IconMiniButton>
        </Card>
        );
      })}
      {Array.from({ length: Math.max(0, pageSize - pageModels.length) }, (_, index) => (
        <C.HW_MaterialSlotEmpty key={`model-empty-${safePage}-${index}`}>
          <C.HW_StatusText>empty model slot</C.HW_StatusText>
        </C.HW_MaterialSlotEmpty>
      ))}
    </C.HW_ModelBrowser>
  );
}
