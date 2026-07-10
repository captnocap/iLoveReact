import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import {
  explorerIndex,
  type ExplorerDirectoryHistoryEntry,
  type ExplorerFile,
  type ExplorerFolderId,
  type ExplorerHistoryEntry,
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
  onImportFromDisk: () => void;
  onRescan: () => void;
  onClose: () => void;
};

function rankFile(file: ExplorerFile, query: string, recentIds: Set<string>): number {
  const q = query.trim().toLowerCase();
  const pathHit = q && file.path.toLowerCase().includes(q) ? 800 : 0;
  const nameHit = q && file.name.toLowerCase().includes(q) ? 1200 : 0;
  return pathHit + nameHit + (recentIds.has(file.id) ? 600 : 0);
}

function visibleFiles(props: Props): ExplorerFile[] {
  const query = props.query.trim().toLowerCase();
  const recentIds = new Set(props.history.map((entry) => entry.fileId));
  return explorerIndex().files
    .filter((file) => explorerMatchesFolder(file, props.selectedFolder))
    .filter((file) => !query || explorerSearchText(file).includes(query))
    .sort((a, b) => rankFile(b, query, recentIds) - rankFile(a, query, recentIds) || b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
}

export default function FileExplorerDialog(props: Props) {
  const index = explorerIndex();
  const files = visibleFiles(props);
  const selected = files.find((file) => file.id === props.selectedFileId)
    ?? index.files.find((file) => file.id === props.selectedFileId)
    ?? files[0]
    ?? null;
  const recentIds = new Set(props.history.map((entry) => entry.fileId));
  return (
    <C.HW_DialogScrim>
      <C.HW_FileExplorerDialog>
        <C.HW_FileExplorerHead>
          <Icon name="FolderSearch" size={16} color={accentFor('primary')} />
          <C.HW_HeadTitle>Project Asset Explorer</C.HW_HeadTitle>
          <C.HW_PillOn><C.HW_PillTextOn>{index.files.length} assets indexed</C.HW_PillTextOn></C.HW_PillOn>
          {index.truncated ? (
            <C.HW_Pill><C.HW_PillText>INDEX CAPPED — deeper files not listed</C.HW_PillText></C.HW_Pill>
          ) : null}
          <C.HW_Pill><C.HW_PillText>{files.length} matches</C.HW_PillText></C.HW_Pill>
          <C.HW_Spacer />
          <C.HW_Pill onPress={props.onRescan}><C.HW_PillText>rescan</C.HW_PillText></C.HW_Pill>
          <C.HW_Pill onPress={props.onClose}><C.HW_PillText>close</C.HW_PillText></C.HW_Pill>
        </C.HW_FileExplorerHead>
        <C.HW_FileExplorerSearchRow>
          <Icon name="SearchCode" size={13} color={accentFor('textDim')} />
          <C.HW_FileSearch placeholder="search project assets by name or path..." value={props.query} onChange={props.onQuery} />
          <C.HW_Pill onPress={() => props.onFolder('virt:models')}><C.HW_PillText>models</C.HW_PillText></C.HW_Pill>
          <C.HW_Pill onPress={() => props.onFolder('virt:textures')}><C.HW_PillText>textures</C.HW_PillText></C.HW_Pill>
          <C.HW_PillOn onPress={props.onImportFromDisk}><C.HW_PillTextOn>import from disk...</C.HW_PillTextOn></C.HW_PillOn>
        </C.HW_FileExplorerSearchRow>
        <C.HW_FileExplorerBody>
          <C.HW_FileExplorerNav>
            <C.HW_GroupTitle>
              <Icon name="FolderTree" size={12} color={accentFor('primary')} />
              <C.HW_GroupText>ASSETS</C.HW_GroupText>
            </C.HW_GroupTitle>
            <ExplorerTree {...props} />
            <DirectoryMemory history={props.folderHistory} selectedFolder={props.selectedFolder} onFolder={props.onFolder} />
          </C.HW_FileExplorerNav>
          <C.HW_FileResults>
            <C.HW_FileResultsHead>
              <C.HW_Kicker>{explorerFolderLabel(props.selectedFolder).toUpperCase()}</C.HW_Kicker>
              <C.HW_Spacer />
              <C.HW_StatusText>{files.length} visible</C.HW_StatusText>
            </C.HW_FileResultsHead>
            <C.HW_FileResultsList>
              {files.map((file) => (
                <FileResultRow
                  key={file.id}
                  file={file}
                  active={selected?.id === file.id}
                  recent={recentIds.has(file.id)}
                  onSelectFile={props.onSelectFile}
                  onOpenFile={props.onOpenFile}
                />
              ))}
            </C.HW_FileResultsList>
            {files.length === 0 ? (
              <C.HW_FileResultEmpty>
                <C.HW_StatusText>no assets match — clear the search or rescan</C.HW_StatusText>
              </C.HW_FileResultEmpty>
            ) : null}
          </C.HW_FileResults>
          <FilePreview file={selected} onOpenFile={props.onOpenFile} />
        </C.HW_FileExplorerBody>
        <HistoryStrip history={props.history} onOpenFile={props.onOpenFile} />
      </C.HW_FileExplorerDialog>
    </C.HW_DialogScrim>
  );
}
