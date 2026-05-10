// PlanDocument — paper-surface plan view with explicit large
// typography. Reuses the gallery's document-viewer chrome (paper
// page, outline rail) but renders block contents directly so we can
// control font sizes (the gallery's DocBodyText is too small for
// this surface) and the targeted-block indicator.
//
// Plan refs ride alongside the rendered blocks. Clicking a clickable
// block stages a comment via the page-level claim. Selection state
// shows as an explicit accent bar (left edge Box) + an inline
// TARGETED chip — paper bg stays so paperInk text stays readable.
//
// Outline navigation: each heading wrapper records its y via
// onLayout; clicking an outline entry scrolls the ScrollView to that
// y. Active outline entry is derived from current scrollY so it
// lights up the right pill as the user scrolls.

import { useCallback, useMemo, useState } from 'react';
import { Box, Col, Pressable, Row, ScrollView, Text } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import { DocumentOutline } from '../gallery/components/document-viewer/DocumentOutline';
import { DocumentPageHeader } from '../gallery/components/document-viewer/DocumentPageHeader';
import { collectOutline, type DocumentBlock as Block, type DocumentModel } from '../gallery/components/document-viewer/documentViewerShared';
import type { Plan } from './types';

type OnTarget = (ref: string, label: string) => void;

const SCROLL_SLOP = 24;

interface RefHandle { ref: string; label: string }

interface CellExtra {
  kind: 'reactive' | 'declarative';
  label: string;
  spec: string;
  note?: string;
}

interface ModExtra { label: string; detail?: string }

interface PlanBlock {
  block: Block;
  handle: RefHandle | null;
  /** Structured rendering hint — renders a cell row instead of a plain paragraph. */
  cell?: CellExtra;
  /** Structured rendering hint — renders a modifier row instead of a plain paragraph. */
  mod?: ModExtra;
}

const FONT = {
  h1: 28,
  h2: 22,
  h3: 18,
  body: 17,
  meta: 14,
};

function projectPlan(plan: Plan): { doc: DocumentModel; items: PlanBlock[] } {
  const items: PlanBlock[] = [];
  const push = (block: Block, handle: RefHandle | null): void => {
    items.push({ block, handle });
  };

  push({ type: 'heading', level: 1, id: 'intent', text: 'Intent' }, null);
  push(
    { type: 'paragraph', text: plan.intent.objective },
    { ref: 'intent.objective', label: 'Objective' },
  );

  if (plan.intent.constraints.length > 0) {
    push({ type: 'heading', level: 2, id: 'intent-constraints', text: 'Constraints' }, null);
    plan.intent.constraints.forEach((c, i) => {
      push(
        { type: 'paragraph', text: `• ${c}` },
        { ref: `intent.constraints[${i}]`, label: `Constraint ${i + 1}` },
      );
    });
  }

  if (plan.intent.exitCriteria.length > 0) {
    push({ type: 'heading', level: 2, id: 'intent-exit', text: 'Exit criteria' }, null);
    plan.intent.exitCriteria.forEach((c, i) => {
      push(
        { type: 'paragraph', text: `✓ ${c}` },
        { ref: `intent.exitCriteria[${i}]`, label: `Exit ${i + 1}` },
      );
    });
  }

  push({ type: 'divider' }, null);
  push({ type: 'heading', level: 1, id: 'phases', text: `Phases (${plan.phases.length})` }, null);

  plan.phases.forEach((phase, idx) => {
    push(
      { type: 'heading', level: 2, id: `phase-${phase.id}`, text: `${idx + 1}. ${phase.label}` },
      { ref: `phase:${phase.id}`, label: `Phase ${idx + 1}: ${phase.label}` },
    );

    if (phase.rationale) {
      push(
        { type: 'paragraph', text: phase.rationale },
        { ref: `phase:${phase.id}.rationale`, label: `${phase.label} — rationale` },
      );
    }

    if (phase.cells.length > 0) {
      push({ type: 'heading', level: 3, id: `phase-${phase.id}-cells`, text: 'Cells' }, null);
      phase.cells.forEach((cell) => {
        // Use a placeholder paragraph for outline/layout estimation;
        // BlockBody renders the structured cell row from `cell:` extra.
        items.push({
          block: { type: 'paragraph', text: cell.label },
          handle: { ref: `cell:${cell.id}`, label: `Cell — ${cell.label}` },
          cell: { kind: cell.kind, label: cell.label, spec: cell.spec, note: cell.note },
        });
      });
    }

    if (phase.modifiers.length > 0) {
      push({ type: 'heading', level: 3, id: `phase-${phase.id}-mods`, text: 'Modifiers' }, null);
      phase.modifiers.forEach((m) => {
        items.push({
          block: { type: 'paragraph', text: m.label },
          handle: { ref: `modifier:${m.id}`, label: `Modifier — ${m.label}` },
          mod: { label: m.label, detail: m.detail },
        });
      });
    }

    if (phase.exit) {
      push(
        { type: 'paragraph', text: `Exit: ${phase.exit}` },
        { ref: `phase:${phase.id}.exit`, label: `${phase.label} — exit` },
      );
    }
  });

  return {
    doc: {
      title: plan.name,
      subtitle: plan.intent.objective,
      blocks: items.map((it) => it.block),
    },
    items,
  };
}

function KindTag({ kind }: { kind: 'reactive' | 'declarative' }) {
  // Two distinct accents for the two substrates so they're visually
  // separable in a phase. Reactive (IFTTT) uses the accent, declarative
  // (Composition) uses paperInk so it reads as the structural default.
  const isReactive = kind === 'reactive';
  return (
    <Box style={{
      paddingTop: 3, paddingBottom: 3, paddingLeft: 8, paddingRight: 8,
      borderRadius: 4,
      backgroundColor: isReactive ? 'theme:accent' : 'theme:paperInk',
    }}>
      <Text size={11} bold color="theme:paper">
        {isReactive ? 'IFTTT' : 'COMP'}
      </Text>
    </Box>
  );
}

// Spec chip — monospaced, accent-tinted, paper bg. The colon-separated
// segments (e.g. tool:rg:auth-middleware) read as one identifier instead
// of disappearing into prose. Each colon segment alternates accent /
// paperInk so the structure is scannable.
function SpecChip({ spec }: { spec: string }) {
  const segments = spec.split(':');
  return (
    <Box style={{
      paddingTop: 3, paddingBottom: 3, paddingLeft: 8, paddingRight: 8,
      borderRadius: 4,
      borderWidth: 1, borderColor: 'theme:paperInkDim',
      backgroundColor: 'theme:paper',
      flexDirection: 'row',
      alignItems: 'center',
    }}>
      {segments.map((seg, i) => (
        <Box key={i} style={{ flexDirection: 'row', alignItems: 'center' }}>
          {i > 0 ? (
            <Text size={14} color="theme:paperInkDim" style={{ fontFamily: 'mono' as any }}>:</Text>
          ) : null}
          <Text
            size={14}
            bold={i === 0}
            color={i === 0 ? 'theme:accent' : 'theme:paperInk'}
            style={{ fontFamily: 'mono' as any }}
          >
            {seg}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function CellRow({ cell }: { cell: CellExtra }) {
  return (
    <Col style={{ gap: 6 }}>
      <Row style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap' as any }}>
        <KindTag kind={cell.kind} />
        <Text size={FONT.body} bold color="theme:paperInk">{cell.label}</Text>
        <SpecChip spec={cell.spec} />
      </Row>
      {cell.note ? (
        <Text size={FONT.meta} color="theme:paperInkDim" style={{ lineHeight: 20 }}>
          {cell.note}
        </Text>
      ) : null}
    </Col>
  );
}

function ModRow({ mod }: { mod: ModExtra }) {
  return (
    <Row style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap' as any }}>
      <Box style={{
        paddingTop: 3, paddingBottom: 3, paddingLeft: 8, paddingRight: 8,
        borderRadius: 4,
        borderWidth: 1, borderColor: 'theme:paperInkDim',
      }}>
        <Text size={11} bold color="theme:paperInkDim">MOD</Text>
      </Box>
      <Text size={FONT.body} color="theme:paperInk">{mod.label}</Text>
      {mod.detail ? (
        <Text size={FONT.meta} color="theme:paperInkDim" style={{ fontFamily: 'mono' as any }}>
          {mod.detail}
        </Text>
      ) : null}
    </Row>
  );
}

function BlockBody({ block, item }: { block: Block; item?: PlanBlock }) {
  if (item?.cell) return <CellRow cell={item.cell} />;
  if (item?.mod) return <ModRow mod={item.mod} />;
  if (block.type === 'heading') {
    const size = block.level === 1 ? FONT.h1 : block.level === 2 ? FONT.h2 : FONT.h3;
    return (
      <Text size={size} bold color="theme:paperInk" style={{ lineHeight: Math.round(size * 1.3) }}>
        {block.text}
      </Text>
    );
  }
  if (block.type === 'paragraph') {
    return (
      <Text size={FONT.body} color="theme:paperInk" style={{ lineHeight: Math.round(FONT.body * 1.5) }}>
        {block.text}
      </Text>
    );
  }
  if (block.type === 'list') {
    return (
      <Col style={{ gap: 6 }}>
        {block.items.map((item, i) => (
          <Row key={i} style={{ gap: 8, alignItems: 'flex-start' }}>
            <Text size={FONT.body} color="theme:paperInkDim">{block.ordered ? `${i + 1}.` : '•'}</Text>
            <Text size={FONT.body} color="theme:paperInk" style={{ lineHeight: Math.round(FONT.body * 1.5), flexGrow: 1 }}>
              {item}
            </Text>
          </Row>
        ))}
      </Col>
    );
  }
  if (block.type === 'divider') {
    return <S.DocPaperRule />;
  }
  return null;
}

interface PlanDocumentProps {
  plan: Plan;
  pendingByRef: Record<string, number>;
  onTarget: OnTarget;
}

export function PlanDocument({ plan, pendingByRef, onTarget }: PlanDocumentProps) {
  const { doc, items } = useMemo(() => projectPlan(plan), [plan]);
  const outline = useMemo(() => collectOutline(doc), [doc]);

  // Heading y-positions (measured via onLayout) for outline scroll.
  const [headingY, setHeadingY] = useState<Record<string, number>>({});
  const [scrollY, setScrollY] = useState<number>(0);

  const onHeadingLayout = useCallback((id: string, rect: any) => {
    const y = typeof rect?.y === 'number' ? rect.y : typeof rect?.top === 'number' ? rect.top : null;
    if (y === null || !Number.isFinite(y)) return;
    setHeadingY((prev) => (prev[id] === y ? prev : { ...prev, [id]: y }));
  }, []);

  const selectSection = useCallback((id: string) => {
    const y = headingY[id];
    if (typeof y === 'number') setScrollY(Math.max(0, y - SCROLL_SLOP));
  }, [headingY]);

  const onScroll = useCallback((payload: any) => {
    const next = typeof payload?.scrollY === 'number' ? payload.scrollY : 0;
    if (next !== scrollY) setScrollY(next);
  }, [scrollY]);

  // Derive active outline entry from current scroll.
  const activeId = useMemo<string | null>(() => {
    let active: string | null = outline[0]?.id ?? null;
    for (const entry of outline) {
      const y = headingY[entry.id];
      if (typeof y === 'number' && y - SCROLL_SLOP <= scrollY + SCROLL_SLOP) {
        active = entry.id;
      }
    }
    return active;
  }, [outline, headingY, scrollY]);

  return (
    <S.DocShell>
      <S.DocBody>
        {outline.length > 0 ? (
          <DocumentOutline entries={outline} activeId={activeId} onSelect={selectSection} />
        ) : null}
        <S.DocPageWrap>
          <S.DocPage>
            <ScrollView
              style={{ flexGrow: 1, width: '100%' }}
              showScrollbar={false}
              scrollY={scrollY}
              onScroll={onScroll}
            >
              <S.DocPageContent>
                <DocumentPageHeader document={doc} size="comfortable" />
                {items.map((item, idx) => {
                  const body = <BlockBody block={item.block} item={item} />;
                  const isHeading = item.block.type === 'heading';
                  const headingId = isHeading ? (item.block as any).id as string : null;

                  // Plain (non-clickable) wrapper. Captures heading y for the outline.
                  if (!item.handle) {
                    return (
                      <Box
                        key={idx}
                        onLayout={headingId ? (rect: any) => onHeadingLayout(headingId, rect) : undefined}
                      >
                        {body}
                      </Box>
                    );
                  }

                  const count = pendingByRef[item.handle.ref] || 0;
                  const selected = count > 0;

                  return (
                    <Pressable
                      key={idx}
                      onPress={() => onTarget(item.handle!.ref, item.handle!.label)}
                      onLayout={headingId ? (rect: any) => onHeadingLayout(headingId, rect) : undefined}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'stretch',
                        gap: 0,
                      }}
                    >
                      {/* Left accent bar — explicit Box because border
                          props don't always render reliably on Pressable
                          in this engine. 6px stripe spans the full
                          height of the row when selected, 2px ghost
                          stripe otherwise (so the layout doesn't jump
                          on click). */}
                      <Box style={{
                        width: selected ? 6 : 2,
                        backgroundColor: selected ? 'theme:accent' : 'theme:paperInkDim',
                        opacity: selected ? 1 : 0.15,
                        borderTopLeftRadius: 3,
                        borderBottomLeftRadius: 3,
                      }} />
                      <Box style={{
                        flexGrow: 1,
                        flexDirection: 'row',
                        alignItems: 'flex-start',
                        gap: 10,
                        paddingTop: 4,
                        paddingBottom: 4,
                        paddingLeft: 10,
                        paddingRight: 8,
                      }}>
                        <Box style={{ flexGrow: 1 }}>{body}</Box>
                        {selected ? (
                          <Row style={{ alignItems: 'center', gap: 6 }}>
                            <Box style={{
                              paddingTop: 3, paddingBottom: 3, paddingLeft: 8, paddingRight: 8,
                              borderRadius: 4, backgroundColor: 'theme:accent',
                            }}>
                              <Text size={11} bold color="theme:paper">TARGETED</Text>
                            </Box>
                            {count > 1 ? (
                              <Box style={{
                                paddingTop: 3, paddingBottom: 3, paddingLeft: 8, paddingRight: 8,
                                borderRadius: 999, backgroundColor: 'theme:accent',
                              }}>
                                <Text size={FONT.meta} bold color="theme:paper">{`${count}`}</Text>
                              </Box>
                            ) : null}
                          </Row>
                        ) : null}
                      </Box>
                    </Pressable>
                  );
                })}
              </S.DocPageContent>
            </ScrollView>
          </S.DocPage>
        </S.DocPageWrap>
      </S.DocBody>
    </S.DocShell>
  );
}
