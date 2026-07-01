import { C } from '../workspace.cls';
import type { Asset, ContentFolderId, ContentNode } from '../data/types';
import ContentTreeNode from './ContentTreeNode';

export default function ContentTree(props: {
  nodes: ContentNode[];
  assets: Asset[];
  selected: ContentFolderId;
  expanded: Partial<Record<ContentFolderId, boolean>>;
  onFolder: (folder: ContentFolderId) => void;
  onToggle: (folder: ContentFolderId) => void;
  onNodeContext?: (id: ContentFolderId, event: { x: number; y: number }) => void;
}) {
  return (
    <C.HW_ContentTree>
      {props.nodes.map((node) => (
        <ContentTreeNode
          key={node.id}
          node={node}
          depth={0}
          assets={props.assets}
          selected={props.selected}
          expanded={props.expanded}
          onFolder={props.onFolder}
          onToggle={props.onToggle}
          onNodeContext={props.onNodeContext}
        />
      ))}
    </C.HW_ContentTree>
  );
}
