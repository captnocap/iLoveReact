import { Icon } from '../../../runtime/icons/Icon';
import { classifiers as W } from '../../../runtime/classifier';
import { accentFor } from '../workspace.cls';
import { worldBibleController, stateColor, type WorldBibleKindFilter } from './controller';
import { KNOWLEDGE_KINDS, type KnowledgeDraft, type KnowledgeKind } from './blockFormat';
import type { KnowledgeSession, KnowledgeSourceState } from './session';
import { useWorldBibleSnapshot } from './useWorldBible';
import './worldBible.cls';

const LABELS: Record<KnowledgeKind, string> = {
  business: 'Businesses',
  person: 'People',
  place: 'Places',
  position: 'Positions',
  shift: 'Shifts',
  mechanic: 'Mechanics',
};

const KIND_COLORS: Record<KnowledgeKind, string> = {
  business: 'theme:accent',
  person: 'theme:info',
  place: 'theme:warning',
  position: 'theme:primary',
  shift: 'theme:textDim',
  mechanic: 'theme:success',
};

const SEARCH_TEXT_CACHE = new WeakMap<KnowledgeDraft, string>();
const SOURCE_STATE_CACHE = new WeakMap<KnowledgeSession, KnowledgeSourceState>();

function searchText(draft: KnowledgeDraft): string {
  const cached = SEARCH_TEXT_CACHE.get(draft);
  if (cached !== undefined) return cached;
  const text = [
    draft.name,
    draft.ref,
    draft.kind,
    draft.authorText,
    draft.publicText,
    draft.notesText,
    ...draft.facts.flatMap((fact) => [fact.key, fact.label, fact.value]),
  ].join('\n').toLowerCase();
  SEARCH_TEXT_CACHE.set(draft, text);
  return text;
}

function sourceState(session: KnowledgeSession): KnowledgeSourceState {
  const cached = SOURCE_STATE_CACHE.get(session);
  if (cached) return cached;
  const state = worldBibleController.stateFor(session);
  SOURCE_STATE_CACHE.set(session, state);
  return state;
}

export default function WorldBibleIndexPanel() {
  const snapshot = useWorldBibleSnapshot();
  const needle = snapshot.query.trim().toLowerCase();
  const visible = snapshot.sessions
    .filter((session) => snapshot.kindFilter === 'all' || session.draft.kind === snapshot.kindFilter)
    .filter((session) => !needle || searchText(session.draft).includes(needle));
  const newKind = snapshot.kindFilter === 'all' ? 'business' : snapshot.kindFilter;
  const filters: WorldBibleKindFilter[] = ['all', ...KNOWLEDGE_KINDS];
  return (
    <W.WB_IndexPanel testID="world-bible-index">
      <W.WB_IndexHead>
        <Icon name="BookOpen" size={14} color={accentFor('primary')} />
        <W.WB_IndexTitle>WORLD BIBLE</W.WB_IndexTitle>
        <W.WB_MicroText>{snapshot.sessions.length} PAGES</W.WB_MicroText>
        <W.WB_IconButton tooltip={`New ${newKind} page draft`} onPress={() => worldBibleController.beginNew(newKind)} testID="world-bible-new-page">
          <Icon name="Plus" size={13} color={accentFor('primary')} />
        </W.WB_IconButton>
        <W.WB_IconButton tooltip="Recheck canonical files" onPress={() => worldBibleController.refreshDisk()} testID="world-bible-refresh">
          <Icon name="RefreshCw" size={12} color={accentFor('textDim')} />
        </W.WB_IconButton>
      </W.WB_IndexHead>
      <W.WB_SearchWrap>
        <W.WB_SearchBox>
          <Icon name="Search" size={12} color={accentFor('textFaint')} />
          <W.WB_SearchInput
            value={snapshot.query}
            placeholder="Search names, refs, lore..."
            onChange={(query: string) => worldBibleController.setQuery(query)}
            testID="world-bible-search"
          />
        </W.WB_SearchBox>
      </W.WB_SearchWrap>
      <W.WB_FilterBar>
        {filters.map((filter) => {
          const active = snapshot.kindFilter === filter;
          const Button = active ? W.WB_FilterOn : W.WB_Filter;
          const Label = active ? W.WB_FilterTextOn : W.WB_FilterText;
          return (
            <Button key={filter} onPress={() => worldBibleController.setKindFilter(filter)}>
              <Label>{filter === 'all' ? 'ALL' : LABELS[filter as KnowledgeKind].toUpperCase()}</Label>
            </Button>
          );
        })}
      </W.WB_FilterBar>
      <W.WB_PageList showScrollbar testID="world-bible-page-list">
        {visible.map((session) => {
          const active = snapshot.selectedPath === session.path;
          const Row = active ? W.WB_PageRowOn : W.WB_PageRow;
          const state = sourceState(session);
          return (
            <Row key={session.path} onPress={() => worldBibleController.selectPath(session.path)}>
              <W.WB_KindMark style={{ backgroundColor: KIND_COLORS[session.draft.kind] }} />
              <W.WB_PageCopy>
                <W.WB_PageName>{session.draft.name}</W.WB_PageName>
                <W.WB_PageRef>{session.draft.ref}</W.WB_PageRef>
              </W.WB_PageCopy>
              <W.WB_StateTiny style={{ color: stateColor(state) }}>{state === 'DRAFT CHANGED' ? 'DRAFT' : state === 'DISK CHANGED' ? 'DISK Δ' : state}</W.WB_StateTiny>
            </Row>
          );
        })}
      </W.WB_PageList>
      <W.WB_IndexFoot>
        <W.WB_MicroText>{visible.length} SHOWN</W.WB_MicroText>
        <W.WB_MicroText style={{ marginLeft: 'auto' }}>DISK IS CANONICAL</W.WB_MicroText>
      </W.WB_IndexFoot>
    </W.WB_IndexPanel>
  );
}
