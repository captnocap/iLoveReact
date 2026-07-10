import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { type ExplorerFile, explorerFileIcon } from '../data/fileExplorer';
import ModelImportPreview from './ModelImportPreview';

export default function FilePreview(props: {
  file: ExplorerFile | null;
  onOpenFile: (fileId: string, action: string) => void;
}) {
  if (!props.file) {
    return (
      <C.HW_FilePreview>
        <C.HW_FilePreviewBody>
          <C.HW_StatusText>no file selected</C.HW_StatusText>
        </C.HW_FilePreviewBody>
      </C.HW_FilePreview>
    );
  }
  const file = props.file;
  const visualPreview = file.category === 'model' || file.category === 'texture';
  return (
    <C.HW_FilePreview>
      <C.HW_FilePreviewHead>
        <Icon name={explorerFileIcon(file)} size={18} color={accentFor('primary')} />
        <C.HW_HeadTitle>{file.name}</C.HW_HeadTitle>
        <C.HW_Spacer />
        <C.HW_FileBadge><C.HW_KeyText>{file.kind}</C.HW_KeyText></C.HW_FileBadge>
      </C.HW_FilePreviewHead>
      <C.HW_FilePreviewBody>
        <C.HW_FilePathBlock>{file.path}</C.HW_FilePathBlock>
        {file.category === 'model' ? (
          <ModelImportPreview file={file} />
        ) : file.category === 'texture' ? (
          <ImageFilePreview file={file} />
        ) : (
          <C.HW_FileMetaGrid>
            <C.HW_StatCell>
              <C.HW_StatValue>{file.sizeLabel}</C.HW_StatValue>
              <C.HW_StatLabel>size</C.HW_StatLabel>
            </C.HW_StatCell>
            <C.HW_StatCell>
              <C.HW_StatValue>{file.modifiedLabel}</C.HW_StatValue>
              <C.HW_StatLabel>modified</C.HW_StatLabel>
            </C.HW_StatCell>
            <C.HW_StatCell>
              <C.HW_StatValue>{file.category}</C.HW_StatValue>
              <C.HW_StatLabel>kind</C.HW_StatLabel>
            </C.HW_StatCell>
          </C.HW_FileMetaGrid>
        )}
        {visualPreview ? null : <C.HW_Spacer />}
        <C.HW_ButtonRow>
          {file.importable ? (
            <C.HW_SmallButton onPress={() => props.onOpenFile(file.id, 'opened')}>
              <C.HW_FormValue>open in mesh editor</C.HW_FormValue>
            </C.HW_SmallButton>
          ) : file.category === 'texture' ? (
            <C.HW_SmallButton onPress={() => props.onOpenFile(file.id, 'imported')}>
              <C.HW_FormValue>import image</C.HW_FormValue>
            </C.HW_SmallButton>
          ) : (
            <C.HW_SmallButton onPress={() => props.onOpenFile(file.id, 'pinned')}>
              <C.HW_FormValue>pin to history</C.HW_FormValue>
            </C.HW_SmallButton>
          )}
        </C.HW_ButtonRow>
      </C.HW_FilePreviewBody>
    </C.HW_FilePreview>
  );
}

function ImageFilePreview(props: { file: ExplorerFile }) {
  return (
    <C.HW_FileImageViewport>
      <C.HW_ModelViewportTop>
        <C.HW_KeyText>IMAGE PREVIEW</C.HW_KeyText>
        <C.HW_Spacer />
        <C.HW_FileStat>{props.file.kind.toUpperCase()}</C.HW_FileStat>
      </C.HW_ModelViewportTop>
      <C.HW_FileImageStage>
        <C.HW_FileImagePreview source={props.file.path} />
      </C.HW_FileImageStage>
      <C.HW_ModelViewportFoot>
        <C.HW_FileStat>{props.file.sizeLabel}</C.HW_FileStat>
        <C.HW_FileStat>{props.file.modifiedLabel}</C.HW_FileStat>
      </C.HW_ModelViewportFoot>
    </C.HW_FileImageViewport>
  );
}
