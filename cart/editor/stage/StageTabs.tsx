// SECTION F — Stage Tabs (see shell/regions.ts SECTIONS): the open-document
// tab strip along the bottom edge of the stage.
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import type { WorkspaceDocument } from '../data/types';
import { WORLD_DOCUMENT_ID } from '../data/documents';

export default function StageTabs(props: {
  documents: WorkspaceDocument[];
  activeId: string;
  onDocument: (id: string) => void;
  onCloseDocument: (id: string) => void;
}) {
  return (
    <C.HW_StageTabStrip>
      {props.documents.map((doc) => {
        const active = props.activeId === doc.id;
        if (doc.id === WORLD_DOCUMENT_ID) {
          const WorldTab = active ? C.HW_StageWorldTabOn : C.HW_StageWorldTab;
          return (
            <WorldTab key={doc.id} onPress={() => props.onDocument(doc.id)}>
              <Icon name="Globe2" size={14} color={accentFor(active ? 'segActiveText' : 'textSecondary')} />
            </WorldTab>
          );
        }
        const Tab = props.activeId === doc.id ? C.HW_StageTabOn : C.HW_StageTab;
        const Label = props.activeId === doc.id ? C.HW_StageTabTextOn : C.HW_StageTabText;
        const Meta = props.activeId === doc.id ? C.HW_StageTabMetaOn : C.HW_StageTabMeta;
        return (
          <Tab key={doc.id} onPress={() => props.onDocument(doc.id)}>
            <C.HW_StageTabTextStack>
              <Label numberOfLines={1} noWrap>{doc.title}</Label>
              {doc.subtitle ? <Meta numberOfLines={1} noWrap>{doc.subtitle}</Meta> : null}
            </C.HW_StageTabTextStack>
            {doc.id !== WORLD_DOCUMENT_ID ? (
              <C.HW_StageTabClose onPress={() => props.onCloseDocument(doc.id)}>
                <C.HW_StageTabCloseText>x</C.HW_StageTabCloseText>
              </C.HW_StageTabClose>
            ) : null}
          </Tab>
        );
      })}
    </C.HW_StageTabStrip>
  );
}
