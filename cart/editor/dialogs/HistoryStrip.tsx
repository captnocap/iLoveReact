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
        <C.HW_StatusText>model files open through the native GLB/OBJ importer</C.HW_StatusText>
      </C.HW_FileHistoryHead>
      <C.HW_FileHistoryCards>
        {props.history.map((entry) => {
          // A rescan can drop a file that was deleted from disk — skip its card.
          const file = explorerFileById(entry.fileId);
          if (!file) return null;
          return (
            <C.HW_FileHistoryCard key={entry.id} onPress={() => props.onOpenFile(file.id, file.importable ? 'opened' : 'pinned')}>
              <C.HW_FileResultTitleRow>
                <Icon name={explorerFileIcon(file)} size={12} color={accentFor('primary')} />
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
