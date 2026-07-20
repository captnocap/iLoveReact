import { useState } from 'react';
import { Box, Image, Text, TextArea } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { classifiers as W } from '../../../runtime/classifier';
import { exists } from '../../../runtime/hooks/fs';
import { useFileWatch } from '../../../runtime/hooks/useFileWatch';
import { accentFor } from '../workspace.cls';
import {
  WORLD_KNOWLEDGE_ROOT,
  stateColor,
  worldBibleController,
} from './controller';
import { renderInlineRefs, type KnowledgeDiagnostic, type KnowledgeDraft, type KnowledgeVisibility } from './blockFormat';
import { linksFromDraft, publicKnowledgeDraftPreview } from './model';
import { knowledgeDraftChanged, type KnowledgeSourceState } from './session';
import { useWorldBibleSnapshot } from './useWorldBible';
import './worldBible.cls';

const NEXT_VISIBILITY: Record<KnowledgeVisibility, KnowledgeVisibility> = {
  public: 'secret',
  secret: 'author',
  author: 'public',
};

const DRAFT_LINK_CACHE = new WeakMap<KnowledgeDraft, string[]>();

function cachedDraftLinks(draft: KnowledgeDraft): string[] {
  const cached = DRAFT_LINK_CACHE.get(draft);
  if (cached) return cached;
  const links = linksFromDraft(draft);
  DRAFT_LINK_CACHE.set(draft, links);
  return links;
}

function visibilityColor(visibility: KnowledgeVisibility): string {
  if (visibility === 'public') return accentFor('success');
  if (visibility === 'secret') return accentFor('error');
  return accentFor('info');
}

function monogram(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]![0]}${parts[1]![0]}` : name.slice(0, 2)).toUpperCase();
}

function declaredMonogram(logo: string): string | null {
  if (!logo.toLowerCase().startsWith('monogram:')) return null;
  const declared = logo.slice('monogram:'.length).trim().replace(/\s+/g, '').slice(0, 4);
  return declared ? declared.toUpperCase() : null;
}

function diagnosticColor(diagnostic: KnowledgeDiagnostic): string {
  return accentFor(diagnostic.severity === 'error' ? 'error' : 'warning');
}

function sourceStateLabel(state: KnowledgeSourceState): string {
  if (state === 'DISK') return 'SAVED';
  if (state === 'DRAFT CHANGED') return 'UNSAVED';
  if (state === 'DISK CHANGED') return 'FILE CHANGED';
  return 'CONFLICT';
}

function InlineReferences(props: { text: string; resolve: (ref: string) => string | null }) {
  const parts = renderInlineRefs(props.text, props.resolve);
  return (
    <W.WB_LinkLine>
      {parts.map((part, index) => part.ref ? (
        <W.WB_Link key={`${part.ref}-${index}`} onPress={() => worldBibleController.select(part.ref!)}>
          <W.WB_LinkText>{part.text}</W.WB_LinkText>
        </W.WB_Link>
      ) : (
        <Text key={`text-${index}`} fontSize={11} color={accentFor('textSecondary')} style={{ lineHeight: 18 }}>{part.text}</Text>
      ))}
    </W.WB_LinkLine>
  );
}

function Paragraphs(props: { text: string; resolve: (ref: string) => string | null }) {
  const paragraphs = props.text.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  if (!paragraphs.length) return <W.WB_Paragraph>No text.</W.WB_Paragraph>;
  return <>{paragraphs.map((paragraph, index) => <InlineReferences key={index} text={paragraph} resolve={props.resolve} />)}</>;
}

function NewFactKeyEditor(props: { factKey: string }) {
  const [pendingKey, setPendingKey] = useState(props.factKey);
  return (
    <W.WB_Field style={{ flexGrow: 0, width: 230 }}>
      <W.WB_FieldLabel>KEY</W.WB_FieldLabel>
      <W.WB_FormRow>
        <W.WB_Input style={{ flexGrow: 1, minWidth: 0 }} value={pendingKey} onChange={setPendingKey} />
        <W.WB_Action onPress={() => worldBibleController.renameFactKey(props.factKey, pendingKey)}>
          <W.WB_ActionText>SET</W.WB_ActionText>
        </W.WB_Action>
      </W.WB_FormRow>
    </W.WB_Field>
  );
}

export default function WorldBibleSurface() {
  const snapshot = useWorldBibleSnapshot();
  useFileWatch(WORLD_KNOWLEDGE_ROOT, () => worldBibleController.requestDiskRefresh(), {
    recursive: false,
    pattern: '*.md',
    intervalMs: 500,
  });
  const session = snapshot.sessions.find((candidate) => candidate.path === snapshot.selectedPath)
    ?? snapshot.sessions.find((candidate) => candidate.draft.ref === snapshot.selectedRef)
    ?? snapshot.sessions[0]
    ?? null;
  if (!session) {
    return (
      <W.WB_Surface testID="world-bible-surface">
        <W.WB_PageHead>
          <W.WB_HeadCopy>
            <W.WB_Title>No pages</W.WB_Title>
          </W.WB_HeadCopy>
          <W.WB_ActionOn onPress={() => worldBibleController.beginNew('business')}>
            <Icon name="Plus" size={12} color={accentFor('primary')} />
            <W.WB_ActionText>NEW PAGE</W.WB_ActionText>
          </W.WB_ActionOn>
        </W.WB_PageHead>
      </W.WB_Surface>
    );
  }

  const draft = session.draft;
  const state = worldBibleController.stateFor(session);
  const resolve = (ref: string) => snapshot.sessions.find((candidate) => candidate.draft.ref === ref)?.draft.name ?? null;
  const backlinks = snapshot.sessions
    .filter((candidate) => candidate !== session && cachedDraftLinks(candidate.draft).includes(draft.ref))
    .map((candidate) => ({ path: candidate.path, ref: candidate.draft.ref, name: candidate.draft.name }));
  const publicPage = publicKnowledgeDraftPreview(draft);
  const canReload = state === 'DISK CHANGED' || state === 'CONFLICT';
  const canReview = knowledgeDraftChanged(session);
  const proposed = snapshot.mode === 'review' ? snapshot.proposal : null;
  const pendingDiscard = snapshot.pendingDiscard;
  const baseFactKeys = new Set(session.basePage?.facts.map((fact) => fact.key) ?? []);
  const logoIsMonogram = draft.logo.toLowerCase().startsWith('monogram:');
  const declaredLogo = declaredMonogram(draft.logo);
  const logoPathExists = !!draft.logo && !logoIsMonogram && exists(draft.logo);
  const logoCaption = declaredLogo
    ? ''
    : logoIsMonogram
      ? `Invalid logo · ${draft.logo}`
      : logoPathExists
        ? draft.logo
        : draft.logo
          ? `Image not found · ${draft.logo}`
          : '';

  return (
    <W.WB_Surface testID="world-bible-surface">
      <W.WB_SourceBanner testID="world-bible-source-state">
        <W.WB_StateBadge style={{ borderColor: stateColor(state) }}>
          <W.WB_StateText style={{ color: stateColor(state) }}>{sourceStateLabel(state)}</W.WB_StateText>
        </W.WB_StateBadge>
        {snapshot.notice ? <W.WB_BannerText>{snapshot.notice}</W.WB_BannerText> : null}
        {canReload && pendingDiscard !== 'reload' ? (
          <W.WB_ActionDanger onPress={() => worldBibleController.requestDiscard('reload')} testID="world-bible-reload">
            <W.WB_ActionText>{state === 'CONFLICT' ? 'DISCARD DRAFT + RELOAD FILE' : 'RELOAD FILE'}</W.WB_ActionText>
          </W.WB_ActionDanger>
        ) : null}
      </W.WB_SourceBanner>
      {pendingDiscard ? (
        <W.WB_DiscardConfirm testID="world-bible-discard-confirmation">
          <Icon name="TriangleAlert" size={13} color={accentFor('error')} />
          <W.WB_DiscardCopy>
            <W.WB_FieldLabel style={{ color: accentFor('error') }}>
              {pendingDiscard === 'reload' ? 'RELOAD FILE?' : session.baseSource === null ? 'DISCARD NEW PAGE?' : 'REVERT CHANGES?'}
            </W.WB_FieldLabel>
            <W.WB_SourcePath>
              {pendingDiscard === 'reload'
                ? 'Replace this draft with the file on disk?'
                : session.baseSource === null
                  ? 'Delete this unwritten draft?'
                  : 'Discard changes made since this page was opened?'}
            </W.WB_SourcePath>
          </W.WB_DiscardCopy>
          <W.WB_Action onPress={() => worldBibleController.cancelDiscard()} testID="world-bible-cancel-discard">
            <W.WB_ActionText>CANCEL</W.WB_ActionText>
          </W.WB_Action>
          <W.WB_ActionDanger onPress={() => worldBibleController.confirmDiscard()} testID="world-bible-confirm-discard">
            <W.WB_ActionText>{pendingDiscard === 'reload' ? 'RELOAD FILE' : 'DISCARD DRAFT'}</W.WB_ActionText>
          </W.WB_ActionDanger>
        </W.WB_DiscardConfirm>
      ) : null}
      {snapshot.diagnostics.length ? (
        <W.WB_DiagnosticPanel testID="world-bible-diagnostics">
          <W.WB_DiagnosticHead>
            <Icon name="CircleAlert" size={12} color={snapshot.diagnostics.some((item) => item.severity === 'error') ? accentFor('error') : accentFor('warning')} />
            <W.WB_FieldLabel>{snapshot.diagnostics.length} AUTHORING DIAGNOSTIC{snapshot.diagnostics.length === 1 ? '' : 'S'}</W.WB_FieldLabel>
          </W.WB_DiagnosticHead>
          <W.WB_DiagnosticList showScrollbar>
            {snapshot.diagnostics.map((diagnostic, index) => {
              const target = diagnostic.path
                ? snapshot.sessions.find((candidate) => candidate.path === diagnostic.path)
                : session;
              return (
                <W.WB_DiagnosticRow key={`${diagnostic.code}-${diagnostic.path ?? 'global'}-${index}`} style={{ borderLeftColor: diagnosticColor(diagnostic) }}>
                  <W.WB_DiagnosticCopy>
                    <W.WB_FactKey style={{ color: diagnosticColor(diagnostic) }}>{diagnostic.severity.toUpperCase()} · {diagnostic.code}</W.WB_FactKey>
                    <W.WB_SourcePath>{diagnostic.message}</W.WB_SourcePath>
                    {diagnostic.path ? <W.WB_MicroText>{diagnostic.path}</W.WB_MicroText> : null}
                  </W.WB_DiagnosticCopy>
                  {target ? (
                    <W.WB_Action onPress={() => {
                      worldBibleController.selectPath(target.path);
                      worldBibleController.setMode('edit');
                    }}>
                      <W.WB_ActionText>{target === session ? 'EDIT PAGE' : 'OPEN + EDIT'}</W.WB_ActionText>
                    </W.WB_Action>
                  ) : (
                    <W.WB_ScopeText style={{ color: accentFor('warning') }}>FIX FILE</W.WB_ScopeText>
                  )}
                </W.WB_DiagnosticRow>
              );
            })}
          </W.WB_DiagnosticList>
        </W.WB_DiagnosticPanel>
      ) : null}
      <W.WB_PageHead>
        <W.WB_HeadCopy>
          <W.WB_Kicker>{draft.kind.toUpperCase()} · {draft.ref}</W.WB_Kicker>
          <W.WB_Title>{draft.name}</W.WB_Title>
          <W.WB_Subtitle>{session.path}</W.WB_Subtitle>
        </W.WB_HeadCopy>
        <W.WB_ActionRow>
          <W.WB_ActionOn onPress={() => worldBibleController.setMode('read')}>
            <Icon name="BookOpen" size={12} color={accentFor(snapshot.mode === 'read' ? 'primary' : 'textDim')} />
            <W.WB_ActionText>READ</W.WB_ActionText>
          </W.WB_ActionOn>
          <W.WB_Action onPress={() => worldBibleController.setMode('edit')} testID="world-bible-edit">
            <Icon name="Pencil" size={12} color={accentFor(snapshot.mode === 'edit' ? 'primary' : 'textDim')} />
            <W.WB_ActionText>EDIT</W.WB_ActionText>
          </W.WB_Action>
          {canReview && !proposed ? (
            <W.WB_Action onPress={() => worldBibleController.reviewSelected()} testID="world-bible-review">
              <Icon name="FileDiff" size={12} color={accentFor('warning')} />
              <W.WB_ActionText>REVIEW CHANGES</W.WB_ActionText>
            </W.WB_Action>
          ) : null}
        </W.WB_ActionRow>
      </W.WB_PageHead>

      {proposed ? (
        <W.WB_Review testID="world-bible-review-panel">
          <W.WB_ReviewMeta>
            <W.WB_SourcePath>{proposed.path}</W.WB_SourcePath>
          </W.WB_ReviewMeta>
          <W.WB_ReviewCols>
            <W.WB_ReviewCol>
              <W.WB_SectionHead>Semantic changes</W.WB_SectionHead>
              <W.WB_ReviewScroll showScrollbar>
                {proposed.changes.map((change) => (
                  <W.WB_ChangeRow key={change.key}>
                    <W.WB_FactKey>{change.label}</W.WB_FactKey>
                    <W.WB_MicroText>BEFORE · {change.before ?? '∅'}</W.WB_MicroText>
                    <W.WB_MicroText style={{ color: accentFor('textSecondary') }}>AFTER · {change.after ?? '∅'}</W.WB_MicroText>
                  </W.WB_ChangeRow>
                ))}
              </W.WB_ReviewScroll>
            </W.WB_ReviewCol>
            <W.WB_ReviewCol>
              <W.WB_SectionHead>Exact text patch</W.WB_SectionHead>
              <W.WB_ReviewScroll showScrollbar>
                <W.WB_DiffText>{proposed.patch}</W.WB_DiffText>
              </W.WB_ReviewScroll>
            </W.WB_ReviewCol>
          </W.WB_ReviewCols>
          <W.WB_ActionRow style={{ justifyContent: 'flex-end' }}>
            <W.WB_Action onPress={() => worldBibleController.setMode('edit')}>
              <W.WB_ActionText>BACK TO EDIT</W.WB_ActionText>
            </W.WB_Action>
            <W.WB_ActionDanger onPress={() => worldBibleController.confirmSelected(proposed.id)} testID="world-bible-confirm-write">
              <Icon name="HardDriveUpload" size={12} color={accentFor('error')} />
              <W.WB_ActionText>WRITE FILE</W.WB_ActionText>
            </W.WB_ActionDanger>
          </W.WB_ActionRow>
        </W.WB_Review>
      ) : snapshot.mode === 'edit' ? (
        <W.WB_EditScroll showScrollbar testID="world-bible-editor">
          <W.WB_EditBody>
            <W.WB_Section>
              <W.WB_SectionHead>Identity</W.WB_SectionHead>
              <W.WB_FormRow>
                <W.WB_Field>
                  <W.WB_FieldLabel>NAME</W.WB_FieldLabel>
                  <W.WB_Input value={draft.name} onChange={(name: string) => worldBibleController.patchDraft({ name })} />
                </W.WB_Field>
                <W.WB_Field>
                  <W.WB_FieldLabel>KIND</W.WB_FieldLabel>
                  <W.WB_InputReadOnly><W.WB_SourcePath>{draft.kind}</W.WB_SourcePath></W.WB_InputReadOnly>
                </W.WB_Field>
              </W.WB_FormRow>
              <W.WB_FormRow>
                <W.WB_Field>
                  <W.WB_FieldLabel>REF</W.WB_FieldLabel>
                  {session.baseSource === null ? (
                    <W.WB_Input value={draft.ref} onChange={(ref: string) => worldBibleController.patchDraft({ ref })} />
                  ) : (
                    <W.WB_InputReadOnly><W.WB_SourcePath>{draft.ref}</W.WB_SourcePath></W.WB_InputReadOnly>
                  )}
                </W.WB_Field>
                <W.WB_Field>
                  <W.WB_FieldLabel>LOGO</W.WB_FieldLabel>
                  <W.WB_Input value={draft.logo} placeholder="monogram:CDL or world/knowledge/assets/..." onChange={(logo: string) => worldBibleController.patchDraft({ logo })} />
                </W.WB_Field>
              </W.WB_FormRow>
            </W.WB_Section>

            <W.WB_Section>
              <W.WB_SectionHead>Facts</W.WB_SectionHead>
              {draft.facts.map((fact) => (
                <W.WB_FactEdit key={fact.key}>
                  <W.WB_FactEditHead>
                    {baseFactKeys.has(fact.key) ? (
                      <W.WB_Field style={{ flexGrow: 0, width: 180 }}>
                        <W.WB_FieldLabel>KEY</W.WB_FieldLabel>
                        <W.WB_InputReadOnly><W.WB_SourcePath>{fact.key}</W.WB_SourcePath></W.WB_InputReadOnly>
                      </W.WB_Field>
                    ) : <NewFactKeyEditor factKey={fact.key} />}
                    <W.WB_Field>
                      <W.WB_FieldLabel>LABEL</W.WB_FieldLabel>
                      <W.WB_Input value={fact.label} onChange={(label: string) => worldBibleController.updateFact(fact.key, { label })} />
                    </W.WB_Field>
                    <W.WB_Action onPress={() => worldBibleController.updateFact(fact.key, { visibility: NEXT_VISIBILITY[fact.visibility] })}>
                      <W.WB_ScopeText style={{ color: visibilityColor(fact.visibility) }}>{fact.visibility.toUpperCase()}</W.WB_ScopeText>
                    </W.WB_Action>
                    <W.WB_IconButton tooltip={`Remove ${fact.key}`} onPress={() => worldBibleController.removeFact(fact.key)}>
                      <Icon name="Trash2" size={12} color={accentFor('error')} />
                    </W.WB_IconButton>
                  </W.WB_FactEditHead>
                  <W.WB_Field>
                    <W.WB_FieldLabel>VALUE</W.WB_FieldLabel>
                    <W.WB_Input value={fact.value} placeholder="Text or @[ref]" onChange={(value: string) => worldBibleController.updateFact(fact.key, { value })} />
                  </W.WB_Field>
                </W.WB_FactEdit>
              ))}
              <W.WB_Action onPress={() => worldBibleController.addFact()}>
                <Icon name="Plus" size={12} color={accentFor('primary')} />
                <W.WB_ActionText>ADD FACT</W.WB_ActionText>
              </W.WB_Action>
            </W.WB_Section>

            <W.WB_AuthorMarkdown>
              <W.WB_FormRow>
                <W.WB_SectionHead>Author text</W.WB_SectionHead>
                <W.WB_ScopeText style={{ color: accentFor('warning') }}>PRIVATE</W.WB_ScopeText>
              </W.WB_FormRow>
              <TextArea
                value={draft.authorText}
                onChange={(authorText: string) => worldBibleController.patchDraft({ authorText })}
                style={{ height: 170, padding: 9, borderRadius: 3, backgroundColor: accentFor('controlBg'), borderWidth: 1, borderColor: accentFor('warning'), color: accentFor('textSecondary'), fontSize: 10, fontFamily: 'monospace' }}
                testID="world-bible-author-markdown"
              />
            </W.WB_AuthorMarkdown>
            <W.WB_Section>
              <W.WB_FormRow>
                <W.WB_SectionHead>Public text</W.WB_SectionHead>
                <W.WB_ScopeText style={{ color: accentFor('success') }}>PUBLIC</W.WB_ScopeText>
              </W.WB_FormRow>
              <TextArea
                value={draft.publicText}
                onChange={(publicText: string) => worldBibleController.patchDraft({ publicText })}
                style={{ height: 130, padding: 9, borderRadius: 3, backgroundColor: accentFor('controlBg'), borderWidth: 1, borderColor: accentFor('controlBorder'), color: accentFor('textSecondary'), fontSize: 10, fontFamily: 'monospace' }}
              />
            </W.WB_Section>
            <W.WB_Section>
              <W.WB_FormRow>
                <W.WB_SectionHead>Designer notes</W.WB_SectionHead>
                <W.WB_ScopeText style={{ color: accentFor('info') }}>PRIVATE</W.WB_ScopeText>
              </W.WB_FormRow>
              <TextArea
                value={draft.notesText}
                onChange={(notesText: string) => worldBibleController.patchDraft({ notesText })}
                style={{ height: 170, padding: 9, borderRadius: 3, backgroundColor: accentFor('controlBg'), borderWidth: 1, borderColor: accentFor('info'), color: accentFor('textSecondary'), fontSize: 10, fontFamily: 'monospace' }}
              />
            </W.WB_Section>
            {canReview ? (
              <W.WB_ActionRow style={{ justifyContent: 'flex-end' }}>
                <W.WB_ActionDanger onPress={() => worldBibleController.requestDiscard('revert')} testID="world-bible-revert">
                  <W.WB_ActionText>{session.baseSource === null ? 'DISCARD NEW PAGE' : 'REVERT CHANGES'}</W.WB_ActionText>
                </W.WB_ActionDanger>
              </W.WB_ActionRow>
            ) : null}
          </W.WB_EditBody>
        </W.WB_EditScroll>
      ) : (
        <W.WB_Content>
          <W.WB_ArticleScroll showScrollbar>
            <W.WB_Article>
              <W.WB_AuthorMarkdown testID="world-bible-author-markdown-read">
                <W.WB_FormRow>
                  <W.WB_SectionHead>Author text</W.WB_SectionHead>
                  <W.WB_ScopeText style={{ color: accentFor('warning') }}>PRIVATE</W.WB_ScopeText>
                </W.WB_FormRow>
                <Paragraphs text={draft.authorText} resolve={resolve} />
              </W.WB_AuthorMarkdown>
              <W.WB_Section>
                <W.WB_SectionHead>Overview</W.WB_SectionHead>
                <Paragraphs text={draft.publicText} resolve={resolve} />
              </W.WB_Section>
              <W.WB_Notes>
                <W.WB_FormRow>
                  <W.WB_SectionHead>Designer notes</W.WB_SectionHead>
                  <W.WB_ScopeText style={{ color: accentFor('info') }}>PRIVATE</W.WB_ScopeText>
                </W.WB_FormRow>
                <Paragraphs text={draft.notesText} resolve={resolve} />
              </W.WB_Notes>
              <W.WB_PublicPreview style={{ borderColor: accentFor(publicPage.eligible ? 'success' : 'error') }} testID="world-bible-draft-public-preview">
                <W.WB_FieldLabel style={{ color: accentFor(publicPage.eligible ? 'success' : 'error') }}>PUBLIC PREVIEW{publicPage.eligible ? '' : ' · BLOCKED'}</W.WB_FieldLabel>
                {!publicPage.eligible ? (
                  <W.WB_Paragraph>{publicPage.diagnostics.length} validation issue{publicPage.diagnostics.length === 1 ? '' : 's'}.</W.WB_Paragraph>
                ) : null}
                {publicPage.eligible ? (
                  <>
                    <Paragraphs text={publicPage.prose} resolve={resolve} />
                    {publicPage.facts.map((fact) => (
                      <W.WB_PublicPreviewFact key={fact.key}>
                        <W.WB_FactLabel>{fact.label.toUpperCase()}</W.WB_FactLabel>
                        <Box style={{ flexGrow: 1, minWidth: 0 }}>
                          <InlineReferences text={fact.value || '—'} resolve={resolve} />
                        </Box>
                      </W.WB_PublicPreviewFact>
                    ))}
                  </>
                ) : null}
              </W.WB_PublicPreview>
              <W.WB_Section>
                <W.WB_SectionHead>Backlinks</W.WB_SectionHead>
                {backlinks.length ? backlinks.map((backlink) => (
                  <W.WB_Backlink key={backlink.path} onPress={() => worldBibleController.selectPath(backlink.path)}>
                    <Icon name="CornerDownLeft" size={11} color={accentFor('textFaint')} />
                    <W.WB_PageCopy>
                      <W.WB_PageName>{backlink.name}</W.WB_PageName>
                      <W.WB_PageRef>{backlink.ref}</W.WB_PageRef>
                    </W.WB_PageCopy>
                  </W.WB_Backlink>
                )) : <W.WB_MicroText>No incoming links yet.</W.WB_MicroText>}
              </W.WB_Section>
            </W.WB_Article>
          </W.WB_ArticleScroll>
          <W.WB_Aside showScrollbar>
            <W.WB_Logo>
              {declaredLogo ? (
                <W.WB_Monogram><W.WB_MonogramText>{declaredLogo}</W.WB_MonogramText></W.WB_Monogram>
              ) : logoPathExists ? (
                <Image source={draft.logo} style={{ width: 92, height: 92 }} />
              ) : (
                <W.WB_Monogram><W.WB_MonogramText>{monogram(draft.name)}</W.WB_MonogramText></W.WB_Monogram>
              )}
              {logoCaption ? <W.WB_SourcePath>{logoCaption}</W.WB_SourcePath> : null}
            </W.WB_Logo>
            <W.WB_Infobox>
              <W.WB_InfoHead>
                <W.WB_InfoTitle>{draft.name}</W.WB_InfoTitle>
                <W.WB_InfoKind>{draft.kind.toUpperCase()}</W.WB_InfoKind>
              </W.WB_InfoHead>
              {draft.facts.map((fact) => (
                <W.WB_FactRow key={fact.key}>
                  <W.WB_FactLabelCol>
                    <W.WB_FactLabel>{fact.label.toUpperCase()}</W.WB_FactLabel>
                    <W.WB_ScopeText style={{ color: visibilityColor(fact.visibility) }}>{fact.visibility.toUpperCase()}</W.WB_ScopeText>
                  </W.WB_FactLabelCol>
                  <Box style={{ flexGrow: 1, minWidth: 0 }}>
                    <InlineReferences text={fact.value || '—'} resolve={resolve} />
                  </Box>
                </W.WB_FactRow>
              ))}
            </W.WB_Infobox>
          </W.WB_Aside>
        </W.WB_Content>
      )}
    </W.WB_Surface>
  );
}
