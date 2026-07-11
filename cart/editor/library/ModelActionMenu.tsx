// editor/library/ModelActionMenu.tsx — the right-click menu for a model home.
// Rename / Favorite / Duplicate / Delete. Rendered at the cursor by
// useContextMenu (LibraryPanel owns the hook + the target model). Each action
// commits then closes; AppFrame writes durable identity changes through to the
// package manifest and mirrors them in live state.
import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { ModelPackage } from '../data/types';

export default function ModelActionMenu({ model, onRename, onFavorite, onDuplicate, onDelete, onClose }: {
  model: ModelPackage;
  onRename: (id: string) => void;
  onFavorite: (id: string) => void;
  onDuplicate: (model: ModelPackage) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const act = (fn: () => void) => { fn(); onClose(); };
  return (
    <C.HW_StageContextMenu>
      <C.HW_ContextRow onPress={() => act(() => onRename(model.id))}>
        <Icon name="Pencil" size={12} color={accentFor('textDim')} />
        <C.HW_ContextText>Rename</C.HW_ContextText>
      </C.HW_ContextRow>
      <C.HW_ContextRow onPress={() => act(() => onFavorite(model.id))}>
        <Icon name="Star" size={12} color={accentFor(model.favorite ? 'primary' : 'textDim')} />
        <C.HW_ContextText>{model.favorite ? 'Unfavorite' : 'Favorite'}</C.HW_ContextText>
      </C.HW_ContextRow>
      <C.HW_ContextRow onPress={() => act(() => onDuplicate(model))}>
        <Icon name="Copy" size={12} color={accentFor('textDim')} />
        <C.HW_ContextText>Duplicate</C.HW_ContextText>
      </C.HW_ContextRow>
      <C.HW_ContextRow onPress={() => act(() => onDelete(model.id))}>
        <Icon name="Trash2" size={12} color={accentFor('warning')} />
        <C.HW_ContextText>Delete</C.HW_ContextText>
      </C.HW_ContextRow>
    </C.HW_StageContextMenu>
  );
}
