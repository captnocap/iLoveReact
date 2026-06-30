import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { ACTIVE_BUILD, BUILD_NOTES, BUILD_THREADS } from '../data/journal';

export default function BuildJournalDialog({ onClose }: { onClose: () => void }) {
  return (
    <C.HW_DialogScrim>
      <C.HW_BuildDialog>
        <C.HW_DialogHead>
          <Icon name="FileClock" size={15} color={accentFor('primary')} />
          <C.HW_HeadTitle>Build Journal</C.HW_HeadTitle>
          <C.HW_PillOn><C.HW_PillTextOn>{ACTIVE_BUILD.build}</C.HW_PillTextOn></C.HW_PillOn>
          <C.HW_Spacer />
          <C.HW_Pill onPress={onClose}><C.HW_PillText>close</C.HW_PillText></C.HW_Pill>
        </C.HW_DialogHead>
        <C.HW_DialogBody>
          <C.HW_JournalIntro>
            <C.HW_HeadTitle>Requests become build notes</C.HW_HeadTitle>
            <C.HW_StatusText>Handled requests auto-increment the editor build and remain searchable history. Review is metadata, not a blocking inbox.</C.HW_StatusText>
          </C.HW_JournalIntro>
          <C.HW_JournalLayout>
            <C.HW_JournalColumn>
              <C.HW_GroupTitle>
                <Icon name="ListChecks" size={12} color={accentFor('primary')} />
                <C.HW_GroupText>RECENT BUILD NOTES</C.HW_GroupText>
              </C.HW_GroupTitle>
              {BUILD_NOTES.map((note) => (
                <C.HW_BuildNoteCard key={note.request}>
                  <C.HW_BuildNoteHead>
                    <C.HW_DockValue>{note.build}</C.HW_DockValue>
                    <C.HW_Spacer />
                    <C.HW_DockLabel>{note.request}</C.HW_DockLabel>
                    <C.HW_Tag><C.HW_TagText>{note.status}</C.HW_TagText></C.HW_Tag>
                  </C.HW_BuildNoteHead>
                  <C.HW_HistoryTitle>{note.title}</C.HW_HistoryTitle>
                  <C.HW_HistoryMeta>{note.agent}: {note.handled}</C.HW_HistoryMeta>
                  <C.HW_TraceRow>
                    {note.trace.map((trace) => <C.HW_TraceChip key={trace}><C.HW_KeyText>{trace}</C.HW_KeyText></C.HW_TraceChip>)}
                  </C.HW_TraceRow>
                </C.HW_BuildNoteCard>
              ))}
            </C.HW_JournalColumn>
            <C.HW_JournalColumn>
              <C.HW_GroupTitle>
                <Icon name="Bug" size={12} color={accentFor('warning')} />
                <C.HW_GroupText>ONGOING THREADS</C.HW_GroupText>
              </C.HW_GroupTitle>
              {BUILD_THREADS.map((thread) => (
                <C.HW_ThreadCard key={thread.id}>
                  <C.HW_BuildNoteHead>
                    <C.HW_HistoryTitle>{thread.title}</C.HW_HistoryTitle>
                    <C.HW_Spacer />
                    <C.HW_DockLabel>{thread.status}</C.HW_DockLabel>
                  </C.HW_BuildNoteHead>
                  {thread.history.map((item) => (
                    <C.HW_ReadRow key={item}>
                      <C.HW_AccentBar style={{ backgroundColor: accentFor(thread.status === 'active' ? 'primary' : 'warning') }} />
                      <C.HW_ReadValue>{item}</C.HW_ReadValue>
                    </C.HW_ReadRow>
                  ))}
                </C.HW_ThreadCard>
              ))}
            </C.HW_JournalColumn>
          </C.HW_JournalLayout>
        </C.HW_DialogBody>
      </C.HW_BuildDialog>
    </C.HW_DialogScrim>
  );
}
