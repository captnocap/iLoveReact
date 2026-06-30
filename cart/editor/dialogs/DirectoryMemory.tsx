import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { type ExplorerDirectoryHistoryEntry, type ExplorerFolderId } from '../data/fileExplorer';

export default function DirectoryMemory(props: {
  history: ExplorerDirectoryHistoryEntry[];
  selectedFolder: ExplorerFolderId;
  onFolder: (folder: ExplorerFolderId) => void;
}) {
  return (
    <C.HW_DirectoryMemory>
      <C.HW_FileHistoryHead>
        <Icon name="History" size={13} color={accentFor('primary')} />
        <C.HW_GroupText>DIRECTORY MEMORY</C.HW_GroupText>
      </C.HW_FileHistoryHead>
      <C.HW_DirMemoryRows>
        {props.history.map((entry) => {
          const Row = entry.folderId === props.selectedFolder ? C.HW_DirMemoryRowOn : C.HW_DirMemoryRow;
          return (
            <Row key={entry.id} onPress={() => props.onFolder(entry.folderId)}>
              <Icon name="FolderClock" size={12} color={accentFor(entry.folderId === props.selectedFolder ? 'primary' : 'textDim')} />
              <C.HW_FileResultMain>
                <C.HW_FileName>{entry.label}</C.HW_FileName>
                <C.HW_FilePath>{entry.path}</C.HW_FilePath>
              </C.HW_FileResultMain>
              <C.HW_FileStat>{entry.at}</C.HW_FileStat>
            </Row>
          );
        })}
      </C.HW_DirMemoryRows>
    </C.HW_DirectoryMemory>
  );
}
