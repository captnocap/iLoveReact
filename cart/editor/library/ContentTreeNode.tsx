import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { Asset, ContentFolderId, ContentNode } from '../data/types';
import { countAssetsForFolder } from '../data/content';

export default function ContentTreeNode(props: {
  node: ContentNode;
  depth: number;
  assets: Asset[];
  selected: ContentFolderId;
  expanded: Partial<Record<ContentFolderId, boolean>>;
  onFolder: (folder: ContentFolderId) => void;
  onToggle: (folder: ContentFolderId) => void;
}) {
  const hasChildren = Boolean(props.node.children?.length);
  const isExpanded = Boolean(props.expanded[props.node.id]);
  const Row = props.selected === props.node.id ? C.HW_TreeRowOn : C.HW_TreeRow;
  const count = countAssetsForFolder(props.assets, props.node.id);
  return (
    <>
      <Row onPress={() => props.onFolder(props.node.id)}>
        {Array.from({ length: props.depth }, (_, index) => <C.HW_TreeIndent key={index} />)}
        <C.HW_TreeToggle onPress={() => hasChildren ? props.onToggle(props.node.id) : props.onFolder(props.node.id)}>
          <Icon name={hasChildren ? (isExpanded ? 'ChevronDown' : 'ChevronRight') : 'Minus'} size={11} color={accentFor('textDim')} />
        </C.HW_TreeToggle>
        <Icon name={props.node.icon ?? 'Folder'} size={13} color={accentFor(props.selected === props.node.id ? 'primary' : 'textDim')} />
        <C.HW_TreeLabel>{props.node.label}</C.HW_TreeLabel>
        <C.HW_Spacer />
        {count > 0 ? <C.HW_TreeCount>{count}</C.HW_TreeCount> : null}
      </Row>
      {hasChildren && isExpanded ? props.node.children!.map((child) => (
        <ContentTreeNode
          key={child.id}
          node={child}
          depth={props.depth + 1}
          assets={props.assets}
          selected={props.selected}
          expanded={props.expanded}
          onFolder={props.onFolder}
          onToggle={props.onToggle}
        />
      )) : null}
    </>
  );
}
