import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import {
  EXPLORER_FILES,
  type ExplorerFolder,
  type ExplorerFolderId,
  explorerMatchesFolder,
} from '../data/fileExplorer';

function folderCount(folder: ExplorerFolderId): number {
  return EXPLORER_FILES.filter((file) => explorerMatchesFolder(file, folder)).length;
}

export default function ExplorerTreeNode(props: {
  folder: ExplorerFolder;
  depth: number;
  selectedFolder: ExplorerFolderId;
  expandedFolders: Partial<Record<ExplorerFolderId, boolean>>;
  onFolder: (folder: ExplorerFolderId) => void;
  onToggleFolder: (folder: ExplorerFolderId) => void;
}) {
  const hasChildren = Boolean(props.folder.children?.length);
  const isExpanded = Boolean(props.expandedFolders[props.folder.id]);
  const Row = props.selectedFolder === props.folder.id ? C.HW_FileTreeRowOn : C.HW_FileTreeRow;
  return (
    <>
      <Row onPress={() => props.onFolder(props.folder.id)}>
        {Array.from({ length: props.depth }, (_, index) => <C.HW_TreeIndent key={index} />)}
        <C.HW_TreeToggle onPress={() => hasChildren ? props.onToggleFolder(props.folder.id) : props.onFolder(props.folder.id)}>
          <Icon name={hasChildren ? (isExpanded ? 'ChevronDown' : 'ChevronRight') : 'Minus'} size={11} color={accentFor('textDim')} />
        </C.HW_TreeToggle>
        <Icon name={props.folder.icon ?? 'Folder'} size={13} color={accentFor(props.selectedFolder === props.folder.id ? 'primary' : 'textDim')} />
        <C.HW_FileTreeLabel>{props.folder.label}</C.HW_FileTreeLabel>
        <C.HW_Spacer />
        <C.HW_TreeCount>{folderCount(props.folder.id)}</C.HW_TreeCount>
      </Row>
      {hasChildren && isExpanded ? props.folder.children!.map((child) => (
        <ExplorerTreeNode
          key={child.id}
          folder={child}
          depth={props.depth + 1}
          selectedFolder={props.selectedFolder}
          expandedFolders={props.expandedFolders}
          onFolder={props.onFolder}
          onToggleFolder={props.onToggleFolder}
        />
      )) : null}
    </>
  );
}
