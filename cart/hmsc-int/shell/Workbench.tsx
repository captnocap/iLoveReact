// shell/Workbench.tsx — THE four-gutter frame (WORKBENCH.md §1–2).
//
//   |1|2 |3   |4         |
//   1 CatRail    — one icon per WorkbenchSource
//   2 ItemRail   — the active source's roster (live filter + scroll)
//   3 PropsCol   — hero + the source's PanelSpec through the ONE renderer
//   4 PreviewCol — the demonstration surface + its lenses
//
// Pure layout: this file knows ZERO category names (the LabsRoute rule —
// shell/ imports nothing game-specific). Categories arrive as WorkbenchSource
// values; the frame owns only ephemeral view state (active source, selection
// per source, lens per source, roster filter, edit revision). Persistence
// stays in each source's backing stores — the Workbench never saves anything.

import { useEffect, useState, type ReactNode } from 'react';
import { Box, ScrollView } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
// twigs are workspace-persistence INFRA, not game knowledge — the LabsRoute
// precedent (shell/LabsRoute.tsx imports the same hook)
import { useRouteTwigState } from '../editors/twigs';
import { C, accentFor } from './workbench.cls';
import { PanelGroups, panelFieldCount, type PanelSpec } from './fields';
import { LensBar, EmptyStage, type LensSpec } from './stage';

export interface RosterRow { id: string; label: string; icon?: string }
export interface ActionSpec { id: string; label: string; icon?: string; run(): void }

export interface WorkbenchSource<S = unknown> {
  /** stable id — selection/lens state is keyed by it */
  id: string;
  /** gutter-1 icon + gutter-2 kicker */
  icon: string;
  kicker: string;
  /** gutter 2 — the roster */
  list(): RosterRow[];
  /** resolve a roster row to the subject the panel/stage consume */
  select(rowId: string): S;
  /** gutter 3 — a SPEC, not JSX; rendered by the one field renderer */
  panel(subject: S): PanelSpec;
  /** column 4 — receives values, never edits (LAW 1); null → EmptyStage */
  stage(subject: S, lens: string): ReactNode;
  /** the preview bar's lenses (LAW 2); absent/single → no segment shown */
  lenses?(subject: S): LensSpec[];
  /** hero-bar verbs (save / export / clone …) */
  actions?(subject: S): ActionSpec[];
  // ── WBCHAR-0606 contract additions (declared in WBCHAR.CAPTURE.md) ──
  /** roster click as an EVENT (load is a side effect — never in render).
   *  Sources with mutable working state (drafts) install the row here. */
  onPick?(rowId: string): void;
  /** the row to select when the frame has no memory (characters: the LAST
   *  roster entry is the working draft — AUTOSAVE-0605 mount restore) */
  defaultRow?(rows: RosterRow[]): string | undefined;
  /** controlled lens: a source whose SETTERS flip the view (wardrobe edits
   *  jump to the figure) owns the active lens; absent → frame-owned state */
  activeLens?(subject: S): string | undefined;
  onLens?(subject: S, id: string): void;
  /** live sources notify here (autosave landed → roster row appears); the
   *  frame re-reads every get() on each tick */
  subscribe?(fn: () => void): () => void;
}

export function Workbench(props: { sources: Array<WorkbenchSource<any>>; onExit?: () => void }) {
  const sources = props.sources;
  // TWIGSTATE-0606: the frame's view state is ephemeral-but-TWIGGED — a hot
  // reload (or leave-and-return) restores the exact source, roster row, and
  // lens the user was on ("painting on a texture → reload → staring at a 3D
  // model", never again). Stale ids degrade gracefully below (find ?? first).
  // The roster FILTER stays deliberately transient (a search box, like hover).
  const [srcId, setSrcId] = useRouteTwigState('/workbench', 'source', sources[0]?.id ?? '');
  const [selBySrc, setSelBySrc] = useRouteTwigState<Record<string, string>>('/workbench', 'selBySource', {});
  const [lensBySrc, setLensBySrc] = useRouteTwigState<Record<string, string>>('/workbench', 'lensBySource', {});
  const [filter, setFilter] = useState('');
  // edit revision: setters are the only write path; bumping re-reads every get()
  const [, setRev] = useState(0);
  const onEdit = () => setRev((r) => r + 1);

  // live sources tick the same revision (autosave → roster rows appear)
  useEffect(() => {
    const offs = sources
      .map((s) => s.subscribe?.(() => setRev((r) => r + 1)))
      .filter((off): off is () => void => typeof off === 'function');
    return () => { for (const off of offs) off(); };
  }, [sources]);

  const source = sources.find((s) => s.id === srcId) ?? sources[0];
  if (!source) return <EmptyStage title="WORKBENCH" hint="no sources registered" />;

  const roster = source.list();
  const shown = filter ? roster.filter((r) => r.label.toLowerCase().includes(filter.toLowerCase())) : roster;
  const selId = selBySrc[source.id] ?? source.defaultRow?.(roster) ?? roster[0]?.id ?? '';
  const selRow = roster.find((r) => r.id === selId) ?? roster[0];

  const pickSource = (id: string) => { setSrcId(id); setFilter(''); };
  const pickRow = (id: string) => {
    source.onPick?.(id); // the load event — render stays pure
    setSelBySrc((s) => ({ ...s, [source.id]: id }));
  };

  if (!selRow) {
    return (
      <Box style={{ flexGrow: 1, minHeight: 0, flexDirection: 'row' }}>
        <SourceRail sources={sources} active={source.id} onPick={pickSource} onExit={props.onExit} />
        <EmptyStage title={source.kicker} hint="nothing here yet — the source's roster is empty" />
      </Box>
    );
  }

  const subject = source.select(selRow.id);
  const spec = source.panel(subject);
  const lenses = source.lenses?.(subject) ?? [];
  // controlled lens (source-owned) wins; else the frame's own per-source state
  const lens = source.activeLens?.(subject) ?? lensBySrc[source.id] ?? lenses[0]?.id ?? 'default';
  const setLens = (id: string) => {
    if (source.onLens) { source.onLens(subject, id); onEdit(); return; }
    setLensBySrc((s) => ({ ...s, [source.id]: id }));
  };
  const actions = source.actions?.(subject) ?? [];
  const stage = source.stage(subject, lens);

  return (
    <Box style={{ flexGrow: 1, minHeight: 0, flexDirection: 'row' }}>
      {/* 1 — category gutter */}
      <SourceRail sources={sources} active={source.id} onPick={pickSource} onExit={props.onExit} />

      {/* 2 — roster gutter */}
      <C.ItemRail>
        <C.RailKicker>{`${source.kicker} · ${roster.length}`}</C.RailKicker>
        <C.RailSearchInput text={filter} onChangeText={setFilter} placeholder="filter…" />
        <ScrollView showScrollbar style={{ flexGrow: 1, minHeight: 0 }}>
          <Box style={{ flexDirection: 'column', gap: 2, paddingBottom: 8 }}>
            {shown.map((r) => {
              const on = r.id === selRow.id;
              const Row = on ? C.ItemRowOn : C.ItemRow;
              const T = on ? C.ItemRowTextOn : C.ItemRowText;
              return (
                <Row key={r.id} onPress={() => pickRow(r.id)}>
                  <Icon name={r.icon ?? source.icon} size={13} color={on ? accentFor('primary') : accentFor('textFaint')} />
                  <T>{r.label}</T>
                </Row>
              );
            })}
          </Box>
        </ScrollView>
      </C.ItemRail>

      {/* 3 — the properties panel (the ONE edit surface).
          HEROBAR-0606: identity row → metadata columns → the full-width
          wrapping ACTIONS row (bottom — identity, facts, then verbs, with
          the verbs adjacent to the panel they act on). Same data, every
          button always visible. */}
      <C.PropsCol>
        <C.Hero>
          <C.HeroTopRow>
            <Icon name={source.icon} size={16} color={accentFor('primary')} />
            <C.HeroName>{selRow.label}</C.HeroName>
          </C.HeroTopRow>
          <C.HeroMetaRow>
            <C.HeroMetaCell>
              <C.HeroMetaValue>{source.id}</C.HeroMetaValue>
              <C.HeroMetaLabel>SOURCE</C.HeroMetaLabel>
            </C.HeroMetaCell>
            <C.HeroMetaCell>
              <C.HeroMetaValue>{`${spec.groups.length}`}</C.HeroMetaValue>
              <C.HeroMetaLabel>GROUPS</C.HeroMetaLabel>
            </C.HeroMetaCell>
            <C.HeroMetaCell>
              <C.HeroMetaValue>{`${panelFieldCount(spec)}`}</C.HeroMetaValue>
              <C.HeroMetaLabel>FIELDS</C.HeroMetaLabel>
            </C.HeroMetaCell>
          </C.HeroMetaRow>
          {actions.length ? (
            <C.HeroActionsRow>
              {actions.map((a) => (
                <C.ChromePill key={a.id} onPress={a.run}>
                  {a.icon ? <Icon name={a.icon} size={12} color={accentFor('success')} /> : null}
                  <C.ChromePillText>{a.label}</C.ChromePillText>
                </C.ChromePill>
              ))}
            </C.HeroActionsRow>
          ) : null}
        </C.Hero>
        <ScrollView showScrollbar style={{ flexGrow: 1, minHeight: 0 }}>
          <PanelGroups spec={spec} onEdit={onEdit} />
        </ScrollView>
      </C.PropsCol>

      {/* 4 — the demonstration surface */}
      <C.PreviewCol>
        <LensBar
          tag={`${selRow.label.toUpperCase()} · ${source.id}`}
          lenses={lenses}
          active={lens}
          onLens={setLens}
        />
        {stage ?? (
          <EmptyStage
            title="DEMO RIG"
            hint={`${source.id} hasn't built its stage yet — the panel is live (edits write through)`}
          />
        )}
      </C.PreviewCol>
    </Box>
  );
}

function SourceRail(props: { sources: Array<WorkbenchSource<any>>; active: string; onPick: (id: string) => void; onExit?: () => void }) {
  return (
    <C.CatRail>
      {props.sources.map((s) => {
        const B = s.id === props.active ? C.CatBtnOn : C.CatBtn;
        return (
          <B key={s.id} onPress={() => props.onPick(s.id)}>
            <Icon name={s.icon} size={15} color={s.id === props.active ? accentFor('primary') : accentFor('textSecondary')} />
          </B>
        );
      })}
      {props.onExit ? (
        <>
          <Box style={{ flexGrow: 1 }} />
          <C.CatBtn onPress={props.onExit}>
            <Icon name="LayoutGrid" size={15} color={accentFor('textDim')} />
          </C.CatBtn>
        </>
      ) : null}
    </C.CatRail>
  );
}
