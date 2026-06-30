import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { ContentFolderId } from '../data/types';
import { contentFolderLabel } from '../data/content';

export default function FolderSummary({ folder }: { folder: ContentFolderId }) {
  return (
    <C.HW_FolderSummary>
      <Icon name="FolderOpen" size={18} color={accentFor('textFaint')} />
      <C.HW_HeadTitle>{contentFolderLabel(folder)}</C.HW_HeadTitle>
      <C.HW_StatusText>no indexed assets</C.HW_StatusText>
    </C.HW_FolderSummary>
  );
}
