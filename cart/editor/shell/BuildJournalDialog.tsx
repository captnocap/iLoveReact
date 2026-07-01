import { useState } from 'react';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import './journalThreads.cls';
import type { JournalActions } from '../data/journal';
import type { BuildJournalSnapshot, BuildNote, BuildThread, JournalCapture, ThreadAttempt } from '../data/types';

function statusAccent(status: string): string {
  if (status === 'active') return 'primary';
  if (status === 'watch' || status === 'linked') return 'warning';
  return 'textDim';
}

// The band a rating lives in — this is the color language of the haystack: green
// is the needle, red is three sheets to the wind, dim is untouched.
function ratingAccent(rating: number): string {
  if (rating >= 8) return 'success';
  if (rating >= 5) return 'primary';
  if (rating >= 3) return 'warning';
  if (rating >= 1) return 'error';
  return 'textDim';
}

function matchThreads(threads: BuildThread[], query: string): BuildThread[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return threads;
  const tokens = needle.split(/\s+/);
  return threads.filter((thread) => {
    const requests = thread.attempts.map((a) => a.request);
    const haystack = [thread.title, thread.id, ...thread.aliases, ...thread.tags, ...requests].join(' ').toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

export default function BuildJournalDialog({ journal, actions, onClose }: { journal: BuildJournalSnapshot; actions: JournalActions; onClose: () => void }) {
  const [attachRequest, setAttachRequest] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [describeId, setDescribeId] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState('');
  const [captureFor, setCaptureFor] = useState<string | null>(null);

  const threadById = new Map(journal.threads.map((thread) => [thread.id, thread]));
  const attached = journal.threads.reduce((count, thread) => count + thread.attempts.length, 0);

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
            <C.HW_HeadTitle>Every prompt is a note. Name the recurring ones. Rate the fixes.</C.HW_HeadTitle>
            <C.HW_StatusText>{journal.requestCount} prompts on the ledger, {journal.notes.length} shown at {journal.loadedAt} · {attached} pulled into {journal.threads.length} threads. When a bug crawls back, "thread it" onto its remembered name — then crown the one fix that worked so next time you read the needle, not the haystack.</C.HW_StatusText>
          </C.HW_JournalIntro>
          <C.HW_JournalLayout>
            <C.HW_JournalColumn>
              <C.HW_GroupTitle>
                <Icon name="ListChecks" size={12} color={accentFor('primary')} />
                <C.HW_GroupText>EVERY PROMPT</C.HW_GroupText>
              </C.HW_GroupTitle>
              {journal.notes.length === 0 ? (
                <C.HW_BuildNoteCard>
                  <C.HW_HistoryTitle>No prompts found</C.HW_HistoryTitle>
                  <C.HW_HistoryMeta>The editor found no request entries in the live ledger path.</C.HW_HistoryMeta>
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
                        <C.HW_HistoryMeta>{thread.attempts.length} attempts · {thread.captures.length} captures{thread.hasGospel ? ' · gospel crowned' : ''} · {thread.tags.join(' ')}</C.HW_HistoryMeta>
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
                      <C.HW_ReadValue>Pick "thread it" on any prompt to start an ongoing bug/build thread.</C.HW_ReadValue>
                    </C.HW_ReadRow>
                  </C.HW_ThreadCard>
                ) : null}
                {journal.threads.map((thread) => (
                  <ThreadCard
                    key={thread.id}
                    thread={thread}
                    renaming={renameId === thread.id}
                    draft={draft}
                    describing={describeId === thread.id}
                    descDraft={descDraft}
                    pickingCapture={captureFor === thread.id}
                    captureShelf={actions.captureShelf}
                    onRenameStart={() => { setRenameId(thread.id); setDraft(thread.title); }}
                    onDraft={setDraft}
                    onRenameCommit={() => { actions.renameThread(thread.id, draft); setRenameId(null); }}
                    onDescribeStart={() => { setDescribeId(thread.id); setDescDraft(thread.description); }}
                    onDescDraft={setDescDraft}
                    onDescribeCommit={() => { actions.setDescription(thread.id, descDraft); setDescribeId(null); }}
                    onDetach={(request) => actions.detachRequest(thread.id, request)}
                    onRate={(request, rating) => actions.rateAttempt(thread.id, request, rating)}
                    onCrown={(request) => (thread.attempts.find((a) => a.request === request)?.gospel ? actions.uncrownGospel(thread.id) : actions.crownGospel(thread.id, request))}
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
      <C.HW_JAskText>{note.ask}</C.HW_JAskText>
      {note.claim ? (
        <>
          <C.HW_JClaimLabel>AGENT'S CLAIM · {note.agent}</C.HW_JClaimLabel>
          <C.HW_JClaimText>{note.title}</C.HW_JClaimText>
        </>
      ) : (
        <C.HW_JClaimLabel>NO CLAIM WRITTEN</C.HW_JClaimLabel>
      )}
      <C.HW_JAttemptMeta>
        <CommitChip commits={note.commits} />
        {note.trace.map((trace) => <C.HW_TraceChip key={`${note.request}-${trace}`}><C.HW_KeyText>{trace}</C.HW_KeyText></C.HW_TraceChip>)}
      </C.HW_JAttemptMeta>
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
  describing: boolean;
  descDraft: string;
  pickingCapture: boolean;
  captureShelf: JournalCapture[];
  onRenameStart: () => void;
  onDraft: (text: string) => void;
  onRenameCommit: () => void;
  onDescribeStart: () => void;
  onDescDraft: (text: string) => void;
  onDescribeCommit: () => void;
  onDetach: (request: string) => void;
  onRate: (request: string, rating: number) => void;
  onCrown: (request: string) => void;
  onCaptureToggle: () => void;
  onCaptureAttach: (captureId: string) => void;
  onCaptureDetach: (captureId: string) => void;
}) {
  const { thread } = props;
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
      {props.describing ? (
        <C.HW_JDescEdit>
          <C.HW_JDescInput placeholder="what is this thread about?" value={props.descDraft} onChange={props.onDescDraft} />
          <C.HW_JMiniOn onPress={props.onDescribeCommit}><C.HW_JMiniTextOn>save</C.HW_JMiniTextOn></C.HW_JMiniOn>
        </C.HW_JDescEdit>
      ) : thread.description ? (
        <C.HW_JDescRow onPress={props.onDescribeStart}>
          <C.HW_JDescText>{thread.description}</C.HW_JDescText>
        </C.HW_JDescRow>
      ) : (
        <C.HW_JDescEmpty onPress={props.onDescribeStart}>
          <Icon name="Pencil" size={10} color={accentFor('textDim')} />
          <C.HW_JMiniText>add a description</C.HW_JMiniText>
        </C.HW_JDescEmpty>
      )}
      <C.HW_JIdRow>
        <C.HW_KeyText>{thread.id}</C.HW_KeyText>
        {thread.aliases.map((alias) => <C.HW_JAlias key={alias}><C.HW_KeyText>aka {alias}</C.HW_KeyText></C.HW_JAlias>)}
      </C.HW_JIdRow>
      {thread.tags.length > 0 ? (
        <C.HW_TraceRow>
          {thread.tags.map((tag) => <C.HW_TraceChip key={tag}><C.HW_KeyText>{tag}</C.HW_KeyText></C.HW_TraceChip>)}
        </C.HW_TraceRow>
      ) : null}
      <C.HW_JTally>
        <Icon name={thread.hasGospel ? 'Crown' : 'Bug'} size={11} color={accentFor(thread.hasGospel ? 'warning' : 'textDim')} />
        <C.HW_JTallyText>{thread.attempts.length} attempts</C.HW_JTallyText>
        <C.HW_JTallyText>·</C.HW_JTallyText>
        <C.HW_JTallyText>{thread.commitsBurned} commits burned</C.HW_JTallyText>
        <C.HW_JTallyText>·</C.HW_JTallyText>
        <C.HW_JTallyText>{thread.hasGospel ? 'gospel found' : 'still hunting'}</C.HW_JTallyText>
      </C.HW_JTally>
      {thread.attempts.map((attempt) => (
        <AttemptRow
          key={attempt.request}
          attempt={attempt}
          onRate={(rating) => props.onRate(attempt.request, rating)}
          onCrown={() => props.onCrown(attempt.request)}
          onDetach={() => props.onDetach(attempt.request)}
        />
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

// Hard evidence, not prose: how many commits stood behind an attempt. Zero
// commits behind a confident claim is the tell — it gets the red frame.
function CommitChip({ commits }: { commits: string[] }) {
  if (commits.length === 0) {
    return (
      <C.HW_JCommitNone>
        <Icon name="GitCommitHorizontal" size={9} color={accentFor('error')} />
        <C.HW_JCommitText>0 commits</C.HW_JCommitText>
      </C.HW_JCommitNone>
    );
  }
  return (
    <C.HW_JCommitChip>
      <Icon name="GitCommitHorizontal" size={9} color={accentFor('success')} />
      <C.HW_JCommitText>{commits.length} commit{commits.length === 1 ? '' : 's'}</C.HW_JCommitText>
    </C.HW_JCommitChip>
  );
}

const RATING_PIPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// Ten pips, 1..10. Click a pip to score the attempt; click the current top pip
// to clear it. Filled pips carry the band color, so the score reads at a glance.
function RatingStrip({ rating, onRate }: { rating: number; onRate: (rating: number) => void }) {
  const band = accentFor(ratingAccent(rating));
  return (
    <C.HW_JRate>
      <C.HW_JRateLabel>RATE</C.HW_JRateLabel>
      {RATING_PIPS.map((pip) => (
        <C.HW_JPip
          key={pip}
          onPress={() => onRate(rating === pip ? 0 : pip)}
          style={pip <= rating ? { backgroundColor: band, borderColor: band } : {}}
        />
      ))}
      <C.HW_JScore><C.HW_JScoreText style={{ color: band }}>{rating > 0 ? `${rating}/10` : '—'}</C.HW_JScoreText></C.HW_JScore>
    </C.HW_JRate>
  );
}

// One attempt in the ranked pile. Crown it the gospel, rate it, or detach it.
// The gospel wears a gold frame + crown; everything else is just an attempt
// waiting to be scored.
function AttemptRow({ attempt, onRate, onCrown, onDetach }: { attempt: ThreadAttempt; onRate: (rating: number) => void; onCrown: () => void; onDetach: () => void }) {
  const Card = attempt.gospel ? C.HW_JAttemptGospel : C.HW_JAttempt;
  const Crown = attempt.gospel ? C.HW_JCrownOn : C.HW_JCrown;
  const crownColor = accentFor(attempt.gospel ? 'cardBg' : 'textDim');
  return (
    <Card>
      <C.HW_JAttemptHead>
        <Crown onPress={onCrown}>
          <Icon name={attempt.gospel ? 'Crown' : 'Heart'} size={12} color={crownColor} />
        </Crown>
        <C.HW_JAttemptMain>
          <C.HW_JAskText>{attempt.ask}</C.HW_JAskText>
        </C.HW_JAttemptMain>
        <C.HW_JStatusTag><C.HW_JStatusText>{attempt.status}</C.HW_JStatusText></C.HW_JStatusTag>
        <CommitChip commits={attempt.commits} />
      </C.HW_JAttemptHead>
      {attempt.claim ? (
        <>
          <C.HW_JClaimLabel>{attempt.gospel ? 'THE GOSPEL' : 'AGENT’S CLAIM'} · {attempt.request}</C.HW_JClaimLabel>
          <C.HW_JClaimText>{attempt.claim}</C.HW_JClaimText>
        </>
      ) : (
        <C.HW_JClaimLabel>NO CLAIM WRITTEN · {attempt.request}</C.HW_JClaimLabel>
      )}
      <C.HW_JAttemptMeta>
        <RatingStrip rating={attempt.rating} onRate={onRate} />
        <C.HW_Spacer />
        <C.HW_JMetaText>{attempt.build} · {attempt.agent}</C.HW_JMetaText>
        <C.HW_JMini onPress={onDetach}><C.HW_JMiniText>detach</C.HW_JMiniText></C.HW_JMini>
      </C.HW_JAttemptMeta>
    </Card>
  );
}
