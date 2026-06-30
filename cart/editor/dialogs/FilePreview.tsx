import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { type ExplorerFile, explorerFileIcon } from '../data/fileExplorer';
import ModelImportPreview from './ModelImportPreview';

export default function FilePreview(props: {
  file: ExplorerFile;
  query: string;
  onOpenFile: (fileId: string, action: string) => void;
}) {
  return (
    <C.HW_FilePreview>
      <C.HW_FilePreviewHead>
        <Icon name={explorerFileIcon(props.file.kind)} size={18} color={accentFor('primary')} />
        <C.HW_HeadTitle>{props.file.name}</C.HW_HeadTitle>
        <C.HW_Spacer />
        <C.HW_FileBadge><C.HW_KeyText>{props.file.kind}</C.HW_KeyText></C.HW_FileBadge>
      </C.HW_FilePreviewHead>
      <C.HW_FilePreviewBody>
        <C.HW_FilePathBlock>{props.file.path}</C.HW_FilePathBlock>
        <C.HW_FileSummaryBlock>{props.file.summary}</C.HW_FileSummaryBlock>
        {props.file.preview?.kind === 'model' ? (
          <ModelImportPreview file={props.file} />
        ) : (
          <C.HW_FileMetaGrid>
            <C.HW_StatCell>
              <C.HW_StatValue>0</C.HW_StatValue>
              <C.HW_StatLabel>opens</C.HW_StatLabel>
            </C.HW_StatCell>
            <C.HW_StatCell>
              <C.HW_StatValue>{props.file.imports.length}</C.HW_StatValue>
              <C.HW_StatLabel>imports</C.HW_StatLabel>
            </C.HW_StatCell>
            <C.HW_StatCell>
              <C.HW_StatValue>{props.file.tags.length}</C.HW_StatValue>
              <C.HW_StatLabel>tags</C.HW_StatLabel>
            </C.HW_StatCell>
          </C.HW_FileMetaGrid>
        )}
        <C.HW_FileSection>
          <C.HW_GroupTitle>
            <Icon name="SearchCode" size={12} color={accentFor('primary')} />
            <C.HW_GroupText>IMPORTS / SYMBOLS</C.HW_GroupText>
          </C.HW_GroupTitle>
          {(props.file.imports.length ? props.file.imports : ['no direct imports indexed']).map((item) => (
            <C.HW_FileMiniRow key={item}>
              <C.HW_FileDot />
              <C.HW_ReadValue>{item}</C.HW_ReadValue>
            </C.HW_FileMiniRow>
          ))}
        </C.HW_FileSection>
        <C.HW_FileSection>
          <C.HW_GroupTitle>
            <Icon name="History" size={12} color={accentFor('primary')} />
            <C.HW_GroupText>WHY THIS IS HERE</C.HW_GroupText>
          </C.HW_GroupTitle>
          <C.HW_FileTagWrap>
            {props.file.tags.map((tag) => <C.HW_TraceChip key={tag}><C.HW_KeyText>{tag}</C.HW_KeyText></C.HW_TraceChip>)}
          </C.HW_FileTagWrap>
        </C.HW_FileSection>
        {props.file.preview?.kind === 'model' ? (
          <C.HW_FileSection>
            <C.HW_GroupTitle>
              <Icon name="ShieldCheck" size={12} color={accentFor('primary')} />
              <C.HW_GroupText>IMPORT CHECKS</C.HW_GroupText>
            </C.HW_GroupTitle>
            {props.file.preview.checks.map((check) => (
              <C.HW_FileMiniRow key={check}>
                <C.HW_FileDot />
                <C.HW_ReadValue>{check}</C.HW_ReadValue>
              </C.HW_FileMiniRow>
            ))}
          </C.HW_FileSection>
        ) : null}
        <C.HW_Spacer />
        <C.HW_ButtonRow>
          {props.file.preview?.kind === 'model' ? (
            <C.HW_SmallButton onPress={() => props.onOpenFile(props.file.id, 'preview armed')}>
              <C.HW_FormValue>stage preview</C.HW_FormValue>
            </C.HW_SmallButton>
          ) : null}
          <C.HW_SmallButton onPress={() => props.onOpenFile(props.file.id, 'opened')}>
            <C.HW_FormValue>open in workspace</C.HW_FormValue>
          </C.HW_SmallButton>
          <C.HW_SmallButton onPress={() => props.onOpenFile(props.file.id, props.file.preview?.kind === 'model' ? 'import queued' : 'pinned')}>
            <C.HW_FormValue>{props.file.preview?.kind === 'model' ? 'queue import' : 'pin to history'}</C.HW_FormValue>
          </C.HW_SmallButton>
        </C.HW_ButtonRow>
        <C.HW_FileHint>query retained: {props.query || 'none'}</C.HW_FileHint>
      </C.HW_FilePreviewBody>
    </C.HW_FilePreview>
  );
}
