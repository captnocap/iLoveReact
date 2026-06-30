import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { type ExplorerFile, explorerFileIcon } from '../data/fileExplorer';

export default function FileResultRow(props: {
  file: ExplorerFile;
  active: boolean;
  recent: boolean;
  onSelectFile: (fileId: string) => void;
  onOpenFile: (fileId: string, action: string) => void;
}) {
  const Row = props.active ? C.HW_FileResultOn : C.HW_FileResult;
  return (
    <Row onPress={() => props.onSelectFile(props.file.id)}>
      <Icon name={explorerFileIcon(props.file.kind)} size={15} color={accentFor(props.active ? 'primary' : 'textSecondary')} />
      <C.HW_FileResultMain>
        <C.HW_FileResultTitleRow>
          <C.HW_FileName>{props.file.name}</C.HW_FileName>
          <C.HW_Spacer />
          <C.HW_FileStat>0 opens</C.HW_FileStat>
          {props.recent ? <C.HW_FileBadge><C.HW_KeyText>recent</C.HW_KeyText></C.HW_FileBadge> : null}
        </C.HW_FileResultTitleRow>
        <C.HW_FilePath>{props.file.path}</C.HW_FilePath>
        <C.HW_FileSummary>{props.file.summary}</C.HW_FileSummary>
      </C.HW_FileResultMain>
      <C.HW_IconMiniButton onPress={() => props.onOpenFile(props.file.id, 'opened')}>
        <Icon name="Import" size={12} color={accentFor('primary')} />
      </C.HW_IconMiniButton>
    </Row>
  );
}
