import { C } from '../workspace.cls';
import { explorerIndex, type ExplorerFolderId } from '../data/fileExplorer';
import ExplorerTreeNode from './ExplorerTreeNode';

export default function ExplorerTree(props: {
  selectedFolder: ExplorerFolderId;
  expandedFolders: Partial<Record<ExplorerFolderId, boolean>>;
  onFolder: (folder: ExplorerFolderId) => void;
  onToggleFolder: (folder: ExplorerFolderId) => void;
}) {
  return (
    <C.HW_FileTree>
      {explorerIndex().folders.map((folder) => (
        <ExplorerTreeNode
          key={folder.id}
          folder={folder}
          depth={0}
          selectedFolder={props.selectedFolder}
          expandedFolders={props.expandedFolders}
          onFolder={props.onFolder}
          onToggleFolder={props.onToggleFolder}
        />
      ))}
    </C.HW_FileTree>
  );
}
