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
  onNodeContext?: (id: ContentFolderId, event: { x: number; y: number }) => void;
}) {
  const hasChildren = Boolean(props.node.children?.length);
  const isExpanded = Boolean(props.expanded[props.node.id]);
  const selected = props.selected === props.node.id;
  const Row = selected ? C.HW_TreeRowOn : C.HW_TreeRow;
  // The selected row is a solid accent fill — every glyph on it goes dark.
  const Label = selected ? C.HW_TreeLabelOn : C.HW_TreeLabel;
  const Count = selected ? C.HW_TreeCountOn : C.HW_TreeCount;
  const glyph = selected ? accentFor('stageBadgeText') : accentFor('textDim');
  const count = countAssetsForFolder(props.assets, props.node.id);
  return (
    <>
      <Row
        onPress={() => props.onFolder(props.node.id)}
        onRightClick={(event: { x: number; y: number }) => props.onNodeContext?.(props.node.id, event)}
      >
        {Array.from({ length: props.depth }, (_, index) => <C.HW_TreeIndent key={index} />)}
        <C.HW_TreeToggle onPress={() => hasChildren ? props.onToggle(props.node.id) : props.onFolder(props.node.id)}>
          <Icon name={hasChildren ? (isExpanded ? 'ChevronDown' : 'ChevronRight') : 'Minus'} size={11} color={glyph} />
        </C.HW_TreeToggle>
        <Icon name={props.node.icon ?? 'Folder'} size={13} color={glyph} />
        <Label>{props.node.label}</Label>
        <C.HW_Spacer />
        {count > 0 ? <Count>{count}</Count> : null}
      </Row>
      {hasChildren && isExpanded ? (
        // The child list gets its own container (req_3246): rendered bare beside
        // the Row, a grow/reorder of this keyed array shifts every later sibling's
        // index and the reconciler ghosts rows (the array-sibling hazard).
        <C.HW_TreeChildren>
          {props.node.children!.map((child) => (
            <ContentTreeNode
              key={child.id}
              node={child}
              depth={props.depth + 1}
              assets={props.assets}
              selected={props.selected}
              expanded={props.expanded}
              onFolder={props.onFolder}
              onToggle={props.onToggle}
              onNodeContext={props.onNodeContext}
            />
          ))}
        </C.HW_TreeChildren>
      ) : null}
    </>
  );
}
