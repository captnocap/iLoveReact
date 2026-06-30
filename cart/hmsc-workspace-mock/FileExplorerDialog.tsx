import { Icon } from '../../runtime/icons/Icon';
import { C, accentFor } from './workspace.cls';
import {
  EXPLORER_FILES,
  EXPLORER_FOLDERS,
  type ExplorerDirectoryHistoryEntry,
  type ExplorerFile,
  type ExplorerFolder,
  type ExplorerFolderId,
  type ExplorerHistoryEntry,
  explorerFileById,
  explorerFileIcon,
  explorerFolderLabel,
  explorerMatchesFolder,
  explorerSearchText,
} from './fileExplorerData';

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

function folderCount(folder: ExplorerFolderId): number {
  return EXPLORER_FILES.filter((file) => explorerMatchesFolder(file, folder)).length;
}

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

function ExplorerTree(props: Pick<Props, 'selectedFolder' | 'expandedFolders' | 'onFolder' | 'onToggleFolder'>) {
  return (
    <C.HW_FileTree>
      {EXPLORER_FOLDERS.map((folder) => (
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

function ExplorerTreeNode(props: {
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

function FileResultRow(props: {
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
          <C.HW_FileStat>{props.file.opens} opens</C.HW_FileStat>
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

function ModelImportPreview(props: {
  file: ExplorerFile;
}) {
  const preview = props.file.preview;
  if (!preview) return null;
  return (
    <C.HW_FileModelBlock>
      <C.HW_FileModelViewport>
        <C.HW_ModelViewportTop>
          <C.HW_FileBadge><C.HW_KeyText>NATIVE PREVIEW SLOT</C.HW_KeyText></C.HW_FileBadge>
          <C.HW_Spacer />
          <C.HW_StatusText>{preview.format}</C.HW_StatusText>
        </C.HW_ModelViewportTop>
        <C.HW_ModelStage>
          <C.HW_ModelGround>
            <C.HW_ModelShapeTall />
            <C.HW_ModelShapeWide />
            <C.HW_ModelShapeSmall />
          </C.HW_ModelGround>
        </C.HW_ModelStage>
        <C.HW_ModelViewportFoot>
          <C.HW_StatusText>orbit camera</C.HW_StatusText>
          <C.HW_StatusText>bounds</C.HW_StatusText>
          <C.HW_StatusText>materials</C.HW_StatusText>
        </C.HW_ModelViewportFoot>
      </C.HW_FileModelViewport>
      <C.HW_ModelMetaColumn>
        <C.HW_FileMetaGrid>
          <C.HW_StatCell>
            <C.HW_StatValue>{preview.triangles}</C.HW_StatValue>
            <C.HW_StatLabel>triangles</C.HW_StatLabel>
          </C.HW_StatCell>
          <C.HW_StatCell>
            <C.HW_StatValue>{preview.materials}</C.HW_StatValue>
            <C.HW_StatLabel>materials</C.HW_StatLabel>
          </C.HW_StatCell>
          <C.HW_StatCell>
            <C.HW_StatValue>{preview.upAxis}</C.HW_StatValue>
            <C.HW_StatLabel>up axis</C.HW_StatLabel>
          </C.HW_StatCell>
        </C.HW_FileMetaGrid>
        <C.HW_FileMiniRow>
          <C.HW_FileDot />
          <C.HW_ReadValue>{preview.bounds}</C.HW_ReadValue>
        </C.HW_FileMiniRow>
        <C.HW_FileMiniRow>
          <C.HW_FileDot />
          <C.HW_ReadValue>{preview.importAs}</C.HW_ReadValue>
        </C.HW_FileMiniRow>
        <C.HW_FileTagWrap>
          {preview.textureSlots.map((slot) => <C.HW_TraceChip key={slot}><C.HW_KeyText>{slot}</C.HW_KeyText></C.HW_TraceChip>)}
        </C.HW_FileTagWrap>
      </C.HW_ModelMetaColumn>
    </C.HW_FileModelBlock>
  );
}

function FilePreview(props: {
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
              <C.HW_StatValue>{props.file.opens}</C.HW_StatValue>
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

function DirectoryMemory(props: {
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

function HistoryStrip(props: {
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
              <C.HW_StatusText>{slots.length} / {files.length} visible fixed rows</C.HW_StatusText>
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
