import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { ContentFolderId } from '../data/types';
import { exactModelForFolder, modelPackagesForFolder } from '../data/content';
import ModelPackageDetail from './ModelPackageDetail';

export default function ModelPackageBrowser({
  folder,
  search,
  onFolder,
  onAction,
}: {
  folder: ContentFolderId;
  search: string;
  onFolder: (folder: ContentFolderId) => void;
  onAction: (label: string) => void;
}) {
  const exactModel = exactModelForFolder(folder);
  const models = modelPackagesForFolder(folder, search);
  if (exactModel) {
    return <ModelPackageDetail model={exactModel} onAction={onAction} />;
  }
  return (
    <C.HW_ModelBrowser>
      <C.HW_GroupTitle>
        <Icon name="Box" size={12} color={accentFor('primary')} />
        <C.HW_GroupText>MODEL HOMES</C.HW_GroupText>
        <C.HW_Spacer />
        <C.HW_StatusText>{models.length} folders</C.HW_StatusText>
      </C.HW_GroupTitle>
      {models.length === 0 ? (
        <C.HW_EmptyState>
          <Icon name="SearchX" size={16} color={accentFor('textFaint')} />
          <C.HW_StatusText>no model homes</C.HW_StatusText>
        </C.HW_EmptyState>
      ) : models.map((model) => (
        <C.HW_ModelCard key={model.id} onPress={() => onFolder(model.folderId)}>
          <C.HW_ModelThumb style={{ backgroundColor: model.color }} />
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
          <C.HW_IconMiniButton onPress={() => onAction(`open model home ${model.name}`)}>
            <Icon name="FolderOpen" size={13} color={accentFor('primary')} />
          </C.HW_IconMiniButton>
        </C.HW_ModelCard>
      ))}
      {Array.from({ length: Math.max(0, 4 - models.length) }, (_, index) => (
        <C.HW_MaterialSlotEmpty key={`model-empty-${index}`}>
          <C.HW_StatusText>empty model slot</C.HW_StatusText>
        </C.HW_MaterialSlotEmpty>
      ))}
    </C.HW_ModelBrowser>
  );
}
