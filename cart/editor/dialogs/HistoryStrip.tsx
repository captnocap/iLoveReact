import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { type ExplorerHistoryEntry, explorerFileById, explorerFileIcon } from '../data/fileExplorer';

export default function HistoryStrip(props: {
  history: ExplorerHistoryEntry[];
  onOpenFile: (fileId: string, action: string) => void;
}) {
  return (
    <C.HW_FileHistory>
      <C.HW_FileHistoryHead>
        <Icon name="Clock3" size={13} color={accentFor('primary')} />
        <C.HW_GroupText>FILE HISTORY</C.HW_GroupText>
        <C.HW_Spacer />
        <C.HW_StatusText>project file picker, no system dialog dependency</C.HW_StatusText>
      </C.HW_FileHistoryHead>
      <C.HW_FileHistoryCards>
        {props.history.map((entry) => {
          const file = explorerFileById(entry.fileId);
          return (
            <C.HW_FileHistoryCard key={entry.id} onPress={() => props.onOpenFile(file.id, 'history')}>
              <C.HW_FileResultTitleRow>
                <Icon name={explorerFileIcon(file.kind)} size={12} color={accentFor('primary')} />
                <C.HW_FileName>{file.name}</C.HW_FileName>
              </C.HW_FileResultTitleRow>
              <C.HW_FilePath>{entry.query}</C.HW_FilePath>
              <C.HW_FileStat>{entry.action} - {entry.at}</C.HW_FileStat>
            </C.HW_FileHistoryCard>
          );
        })}
      </C.HW_FileHistoryCards>
    </C.HW_FileHistory>
  );
}
