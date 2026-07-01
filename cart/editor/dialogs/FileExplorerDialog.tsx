import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import {
  EXPLORER_FILES,
  type ExplorerDirectoryHistoryEntry,
  type ExplorerFile,
  type ExplorerFolderId,
  type ExplorerHistoryEntry,
  explorerFileById,
  explorerFolderLabel,
  explorerMatchesFolder,
  explorerSearchText,
} from '../data/fileExplorer';
import ExplorerTree from './ExplorerTree';
import FileResultRow from './FileResultRow';
import FilePreview from './FilePreview';
import DirectoryMemory from './DirectoryMemory';
import HistoryStrip from './HistoryStrip';

type Props = {
  query: string;
  selectedFolder: ExplorerFolderId;
  expandedFolders: Partial<Record<ExplorerFolderId, boolean>>;
  selectedFileId: string;
  history: ExplorerHistoryEntry[];
  folderHistory: ExplorerDirectoryHistoryEntry[];
  onQuery: (query: string) => void;
  onFolder: (folder: ExplorerFolderId) => void;
  onToggleFolder: (folder: ExplorerFolderId) => void;
  onSelectFile: (fileId: string) => void;
  onOpenFile: (fileId: string, action: string) => void;
  onClose: () => void;
};

const RESULT_SLOTS = 9;

function rankFile(file: ExplorerFile, query: string, recentIds: Set<string>): number {
  const q = query.trim().toLowerCase();
  const pathHit = q && file.path.toLowerCase().includes(q) ? 800 : 0;
  const nameHit = q && file.name.toLowerCase().includes(q) ? 1200 : 0;
  const tagHit = q && file.tags.some((tag) => tag.toLowerCase().includes(q)) ? 500 : 0;
  return file.opens + pathHit + nameHit + tagHit + (recentIds.has(file.id) ? 600 : 0);
}

function visibleFiles(props: Props): ExplorerFile[] {
  const query = props.query.trim().toLowerCase();
  const recentIds = new Set(props.history.map((entry) => entry.fileId));
  return EXPLORER_FILES
    .filter((file) => explorerMatchesFolder(file, props.selectedFolder))
    .filter((file) => !query || explorerSearchText(file).includes(query))
    .sort((a, b) => rankFile(b, query, recentIds) - rankFile(a, query, recentIds) || a.path.localeCompare(b.path));
}

export default function FileExplorerDialog(props: Props) {
  const files = visibleFiles(props);
  const selected = files.find((file) => file.id === props.selectedFileId)
    ?? explorerFileById(props.selectedFileId);
  const recentIds = new Set(props.history.map((entry) => entry.fileId));
  const slots = files.slice(0, RESULT_SLOTS);
  const emptySlots = Math.max(0, RESULT_SLOTS - slots.length);
  return (
    <C.HW_DialogScrim>
      <C.HW_FileExplorerDialog>
        <C.HW_FileExplorerHead>
          <Icon name="FolderSearch" size={16} color={accentFor('primary')} />
          <C.HW_HeadTitle>Project File Explorer</C.HW_HeadTitle>
          <C.HW_PillOn><C.HW_PillTextOn>in-app index</C.HW_PillTextOn></C.HW_PillOn>
          <C.HW_Pill><C.HW_PillText>{files.length} matches</C.HW_PillText></C.HW_Pill>
          <C.HW_Spacer />
          <C.HW_Pill onPress={props.onClose}><C.HW_PillText>close</C.HW_PillText></C.HW_Pill>
        </C.HW_FileExplorerHead>
        <C.HW_FileExplorerSearchRow>
          <Icon name="SearchCode" size={13} color={accentFor('textDim')} />
          <C.HW_FileSearch placeholder="search directories, imports, models, tags..." value={props.query} onChange={props.onQuery} />
          <C.HW_Pill onPress={() => props.onQuery('model')}><C.HW_PillText>models</C.HW_PillText></C.HW_Pill>
          <C.HW_Pill onPress={() => props.onQuery('vehicle')}><C.HW_PillText>vehicle</C.HW_PillText></C.HW_Pill>
          <C.HW_Pill onPress={() => props.onQuery('material')}><C.HW_PillText>material</C.HW_PillText></C.HW_Pill>
        </C.HW_FileExplorerSearchRow>
        <C.HW_FileExplorerBody>
          <C.HW_FileExplorerNav>
            <C.HW_GroupTitle>
              <Icon name="FolderTree" size={12} color={accentFor('primary')} />
              <C.HW_GroupText>PROJECT</C.HW_GroupText>
            </C.HW_GroupTitle>
            <ExplorerTree {...props} />
            <DirectoryMemory history={props.folderHistory} selectedFolder={props.selectedFolder} onFolder={props.onFolder} />
          </C.HW_FileExplorerNav>
          <C.HW_FileResults>
            <C.HW_FileResultsHead>
              <C.HW_Kicker>{explorerFolderLabel(props.selectedFolder).toUpperCase()}</C.HW_Kicker>
              <C.HW_Spacer />
              <C.HW_StatusText>{slots.length} of {files.length}</C.HW_StatusText>
            </C.HW_FileResultsHead>
            {slots.map((file) => (
              <FileResultRow
                key={file.id}
                file={file}
                active={selected.id === file.id}
                recent={recentIds.has(file.id)}
                onSelectFile={props.onSelectFile}
                onOpenFile={props.onOpenFile}
              />
            ))}
            {Array.from({ length: emptySlots }, (_, index) => (
              <C.HW_FileResultEmpty key={index}>
                <C.HW_StatusText>empty indexed row</C.HW_StatusText>
              </C.HW_FileResultEmpty>
            ))}
          </C.HW_FileResults>
          <FilePreview file={selected} query={props.query} onOpenFile={props.onOpenFile} />
        </C.HW_FileExplorerBody>
        <HistoryStrip history={props.history} onOpenFile={props.onOpenFile} />
      </C.HW_FileExplorerDialog>
    </C.HW_DialogScrim>
  );
}
