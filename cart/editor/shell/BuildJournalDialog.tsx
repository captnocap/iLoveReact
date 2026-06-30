import { useState } from 'react';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import './journalThreads.cls';
import type { JournalActions } from '../data/journal';
import type { BuildJournalSnapshot, BuildNote, BuildThread, JournalCapture } from '../data/types';

function statusAccent(status: string): string {
  if (status === 'active') return 'primary';
  if (status === 'watch' || status === 'linked') return 'warning';
  return 'textDim';
}

function matchThreads(threads: BuildThread[], query: string): BuildThread[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return threads;
  const tokens = needle.split(/\s+/);
  return threads.filter((thread) => {
    const haystack = [thread.title, thread.id, ...thread.aliases, ...thread.tags, ...thread.deliveries].join(' ').toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

export default function BuildJournalDialog({ journal, actions, onClose }: { journal: BuildJournalSnapshot; actions: JournalActions; onClose: () => void }) {
  const [attachRequest, setAttachRequest] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [captureFor, setCaptureFor] = useState<string | null>(null);

  const threadById = new Map(journal.threads.map((thread) => [thread.id, thread]));
  const attached = journal.threads.reduce((count, thread) => count + thread.deliveries.length, 0);

  const openAttach = (request: string) => { setAttachRequest(request); setQuery(''); setCaptureFor(null); };
  const note = attachRequest ? journal.notes.find((item) => item.request === attachRequest) : undefined;

  return (
    <C.HW_DialogScrim>
      <C.HW_BuildDialog>
        <C.HW_DialogHead>
          <Icon name="FileClock" size={15} color={accentFor('primary')} />
          <C.HW_HeadTitle>Build Journal</C.HW_HeadTitle>
          <C.HW_PillOn><C.HW_PillTextOn>{journal.activeBuild}</C.HW_PillTextOn></C.HW_PillOn>
          <C.HW_Spacer />
          <C.HW_Pill onPress={onClose}><C.HW_PillText>close</C.HW_PillText></C.HW_Pill>
        </C.HW_DialogHead>
        <C.HW_DialogBody>
          <C.HW_JournalIntro>
            <C.HW_HeadTitle>Send deliveries into ongoing threads</C.HW_HeadTitle>
            <C.HW_StatusText>{journal.deliveryCount} deliveries from {journal.requestCount} request files at {journal.loadedAt} · {attached} linked across {journal.threads.length} threads. Use "thread it" on a delivery to link it to a remembered bug thread; threads persist across sessions.</C.HW_StatusText>
          </C.HW_JournalIntro>
          <C.HW_JournalLayout>
            <C.HW_JournalColumn>
              <C.HW_GroupTitle>
                <Icon name="ListChecks" size={12} color={accentFor('primary')} />
                <C.HW_GroupText>RECENT DELIVERIES</C.HW_GroupText>
              </C.HW_GroupTitle>
              {journal.notes.length === 0 ? (
                <C.HW_BuildNoteCard>
                  <C.HW_HistoryTitle>No delivered request resolutions available</C.HW_HistoryTitle>
                  <C.HW_HistoryMeta>The editor found no request entries with a resolution field in the live ledger path.</C.HW_HistoryMeta>
                </C.HW_BuildNoteCard>
              ) : null}
              {journal.notes.map((item) => (
                <DeliveryCard
                  key={item.request}
                  note={item}
                  threadById={threadById}
                  active={attachRequest === item.request}
                  onAttachOpen={openAttach}
                />
              ))}
            </C.HW_JournalColumn>
            {attachRequest ? (
              <C.HW_JAttachPanel>
                <C.HW_GroupTitle>
                  <Icon name="GitBranchPlus" size={12} color={accentFor('primary')} />
                  <C.HW_GroupText>SEND {attachRequest} TO A THREAD</C.HW_GroupText>
                  <C.HW_Spacer />
                  <C.HW_JMini onPress={() => setAttachRequest(null)}><C.HW_JMiniText>cancel</C.HW_JMiniText></C.HW_JMini>
                </C.HW_GroupTitle>
                <C.HW_StatusText>Type a remembered name. Pick an ongoing thread to inherit its history, or open a new one.</C.HW_StatusText>
                <C.HW_FileSearch placeholder="search threads by name, alias, tag..." value={query} onChange={setQuery} />
                <C.HW_JCreateBtn onPress={() => { actions.createThreadFromRequest(attachRequest, query); setAttachRequest(null); }}>
                  <Icon name="Plus" size={12} color={accentFor('primary')} />
                  <C.HW_HistoryMeta>open new thread "{query.trim() || note?.title || attachRequest}"</C.HW_HistoryMeta>
                </C.HW_JCreateBtn>
                <C.HW_JResults>
                  {matchThreads(journal.threads, query).map((thread) => (
                    <C.HW_JRow key={thread.id} onPress={() => { actions.attachRequest(thread.id, attachRequest); setAttachRequest(null); }}>
                      <C.HW_AccentBar style={{ backgroundColor: accentFor(statusAccent(thread.status)) }} />
                      <C.HW_JRowMain>
                        <C.HW_HistoryTitle>{thread.title}</C.HW_HistoryTitle>
                        <C.HW_HistoryMeta>{thread.deliveries.length} deliveries · {thread.captures.length} captures · {thread.tags.join(' ')}</C.HW_HistoryMeta>
                      </C.HW_JRowMain>
                      <C.HW_DockLabel>{thread.status}</C.HW_DockLabel>
                    </C.HW_JRow>
                  ))}
                  {matchThreads(journal.threads, query).length === 0 ? (
                    <C.HW_HistoryMeta>no thread matches "{query}" — open a new one above</C.HW_HistoryMeta>
                  ) : null}
                </C.HW_JResults>
              </C.HW_JAttachPanel>
            ) : (
              <C.HW_JournalColumn>
                <C.HW_GroupTitle>
                  <Icon name="Bug" size={12} color={accentFor('warning')} />
                  <C.HW_GroupText>ONGOING THREADS</C.HW_GroupText>
                </C.HW_GroupTitle>
                {journal.threads.length === 0 ? (
                  <C.HW_ThreadCard>
                    <C.HW_BuildNoteHead>
                      <C.HW_HistoryTitle>No threads yet</C.HW_HistoryTitle>
                    </C.HW_BuildNoteHead>
                    <C.HW_ReadRow>
                      <C.HW_AccentBar style={{ backgroundColor: accentFor('warning') }} />
                      <C.HW_ReadValue>Pick "thread it" on any delivery to start an ongoing bug/build thread.</C.HW_ReadValue>
                    </C.HW_ReadRow>
                  </C.HW_ThreadCard>
                ) : null}
                {journal.threads.map((thread) => (
                  <ThreadCard
                    key={thread.id}
                    thread={thread}
                    renaming={renameId === thread.id}
                    draft={draft}
                    pickingCapture={captureFor === thread.id}
                    captureShelf={actions.captureShelf}
                    onRenameStart={() => { setRenameId(thread.id); setDraft(thread.title); }}
                    onDraft={setDraft}
                    onRenameCommit={() => { actions.renameThread(thread.id, draft); setRenameId(null); }}
                    onDetach={(request) => actions.detachRequest(thread.id, request)}
                    onCaptureToggle={() => setCaptureFor(captureFor === thread.id ? null : thread.id)}
                    onCaptureAttach={(captureId) => { actions.attachCapture(thread.id, captureId); setCaptureFor(null); }}
                    onCaptureDetach={(captureId) => actions.detachCapture(thread.id, captureId)}
                  />
                ))}
              </C.HW_JournalColumn>
            )}
          </C.HW_JournalLayout>
        </C.HW_DialogBody>
      </C.HW_BuildDialog>
    </C.HW_DialogScrim>
  );
}

function DeliveryCard({ note, threadById, active, onAttachOpen }: { note: BuildNote; threadById: Map<string, BuildThread>; active: boolean; onAttachOpen: (request: string) => void }) {
  const Card = active ? C.HW_JNoteCardOn : C.HW_BuildNoteCard;
  const threads = note.threadIds.map((id) => threadById.get(id)).filter(Boolean) as BuildThread[];
  return (
    <Card>
      <C.HW_BuildNoteHead>
        <C.HW_DockValue>{note.build}</C.HW_DockValue>
        <C.HW_Spacer />
        <C.HW_DockLabel>{note.request}</C.HW_DockLabel>
        <C.HW_Tag><C.HW_TagText>{note.status}</C.HW_TagText></C.HW_Tag>
      </C.HW_BuildNoteHead>
      <C.HW_HistoryTitle>{note.title}</C.HW_HistoryTitle>
      <C.HW_HistoryMeta>delivery by {note.agent}: {note.handled}</C.HW_HistoryMeta>
      <C.HW_HistoryMeta>request: {note.ask}</C.HW_HistoryMeta>
      <C.HW_TraceRow>
        {note.trace.map((trace) => <C.HW_TraceChip key={`${note.request}-${trace}`}><C.HW_KeyText>{trace}</C.HW_KeyText></C.HW_TraceChip>)}
      </C.HW_TraceRow>
      <C.HW_JFoot>
        {threads.length > 0 ? (
          <>
            <Icon name="GitMerge" size={11} color={accentFor('primary')} />
            {threads.map((thread) => (
              <C.HW_JThreadChip key={thread.id} onPress={() => onAttachOpen(note.request)}>
                <C.HW_JMiniTextOn>{thread.title}</C.HW_JMiniTextOn>
              </C.HW_JThreadChip>
            ))}
            <C.HW_Spacer />
            <C.HW_JMini onPress={() => onAttachOpen(note.request)}><C.HW_JMiniText>+ thread</C.HW_JMiniText></C.HW_JMini>
          </>
        ) : (
          <>
            <Icon name="GitBranchPlus" size={11} color={accentFor('textDim')} />
            <C.HW_KeyText>no thread</C.HW_KeyText>
            <C.HW_Spacer />
            <C.HW_JMiniOn onPress={() => onAttachOpen(note.request)}><C.HW_JMiniTextOn>thread it</C.HW_JMiniTextOn></C.HW_JMiniOn>
          </>
        )}
      </C.HW_JFoot>
    </Card>
  );
}

function ThreadCard(props: {
  thread: BuildThread;
  renaming: boolean;
  draft: string;
  pickingCapture: boolean;
  captureShelf: JournalCapture[];
  onRenameStart: () => void;
  onDraft: (text: string) => void;
  onRenameCommit: () => void;
  onDetach: (request: string) => void;
  onCaptureToggle: () => void;
  onCaptureAttach: (captureId: string) => void;
  onCaptureDetach: (captureId: string) => void;
}) {
  const { thread } = props;
  const accent = statusAccent(thread.status);
  const attachedIds = new Set(thread.captures.map((capture) => capture.id));
  const available = props.captureShelf.filter((capture) => !attachedIds.has(capture.id));
  return (
    <C.HW_ThreadCard>
      <C.HW_BuildNoteHead>
        {props.renaming ? (
          <C.HW_JNameInput placeholder="semantic name" value={props.draft} onChange={props.onDraft} />
        ) : (
          <C.HW_HistoryTitle>{thread.title}</C.HW_HistoryTitle>
        )}
        <C.HW_Spacer />
        {props.renaming ? (
          <C.HW_JMiniOn onPress={props.onRenameCommit}><C.HW_JMiniTextOn>save</C.HW_JMiniTextOn></C.HW_JMiniOn>
        ) : (
          <C.HW_JMini onPress={props.onRenameStart}><C.HW_JMiniText>rename</C.HW_JMiniText></C.HW_JMini>
        )}
        <C.HW_DockLabel>{thread.status}</C.HW_DockLabel>
      </C.HW_BuildNoteHead>
      <C.HW_JIdRow>
        <C.HW_KeyText>{thread.id}</C.HW_KeyText>
        {thread.aliases.map((alias) => <C.HW_JAlias key={alias}><C.HW_KeyText>aka {alias}</C.HW_KeyText></C.HW_JAlias>)}
      </C.HW_JIdRow>
      {thread.tags.length > 0 ? (
        <C.HW_TraceRow>
          {thread.tags.map((tag) => <C.HW_TraceChip key={tag}><C.HW_KeyText>{tag}</C.HW_KeyText></C.HW_TraceChip>)}
        </C.HW_TraceRow>
      ) : null}
      {thread.deliveries.map((request) => (
        <C.HW_JDelivery key={request}>
          <Icon name="GitCommitHorizontal" size={11} color={accentFor('primary')} />
          <C.HW_JDeliveryMain>
            <C.HW_ReadValue>{request}</C.HW_ReadValue>
          </C.HW_JDeliveryMain>
          <C.HW_JMini onPress={() => props.onDetach(request)}><C.HW_JMiniText>detach</C.HW_JMiniText></C.HW_JMini>
        </C.HW_JDelivery>
      ))}
      {thread.history.map((build) => (
        <C.HW_ReadRow key={build}>
          <C.HW_AccentBar style={{ backgroundColor: accentFor(accent) }} />
          <C.HW_ReadValue>build {build}</C.HW_ReadValue>
        </C.HW_ReadRow>
      ))}
      {thread.captures.map((capture) => (
        <C.HW_JCapture key={capture.id}>
          <Icon name="FileText" size={11} color={accentFor('warning')} />
          <C.HW_JCaptureMain>
            <C.HW_ReadValue>{capture.name}</C.HW_ReadValue>
            <C.HW_HistoryMeta>{capture.channels.join(', ')} · {capture.range} · {capture.build} · {capture.context}</C.HW_HistoryMeta>
          </C.HW_JCaptureMain>
          <C.HW_JMini onPress={() => props.onCaptureDetach(capture.id)}><C.HW_JMiniText>remove</C.HW_JMiniText></C.HW_JMini>
        </C.HW_JCapture>
      ))}
      {props.pickingCapture ? (
        <C.HW_JCaptureAttach>
          {available.map((capture) => (
            <C.HW_JRow key={capture.id} onPress={() => props.onCaptureAttach(capture.id)}>
              <Icon name="Paperclip" size={11} color={accentFor('primary')} />
              <C.HW_JRowMain>
                <C.HW_ReadValue>{capture.name}</C.HW_ReadValue>
                <C.HW_HistoryMeta>{capture.channels.join(', ')} · {capture.build}</C.HW_HistoryMeta>
              </C.HW_JRowMain>
            </C.HW_JRow>
          ))}
          {available.length === 0 ? <C.HW_HistoryMeta>no unattached captures available yet</C.HW_HistoryMeta> : null}
        </C.HW_JCaptureAttach>
      ) : (
        <C.HW_JCaptureBtn onPress={props.onCaptureToggle}>
          <Icon name="Paperclip" size={11} color={accentFor('textDim')} />
          <C.HW_JMiniText>attach diagnostic capture</C.HW_JMiniText>
        </C.HW_JCaptureBtn>
      )}
    </C.HW_ThreadCard>
  );
}
