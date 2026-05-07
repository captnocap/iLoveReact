// Sweatshop canvas — the open scene.
//
// Per docs/02-canvas-and-substrates.md: the canvas is the substrate
// every cart's logic composes onto. Three palette tiers (capability /
// domain / rules) drop nodes onto a FlowEditor surface; clicking a
// palette item spawns a node at the canvas center, drag to lay out,
// click ports to wire.
//
// The palette is data-driven: capability nodes come from the IFTTT
// registry (every registered source/action prefix becomes a draggable
// node), domain nodes come from the gallery shape catalog, rule
// stamps come from a curated library that will eventually read from
// the `rule` table.
//
// The seed scene shows a Goal node (pulled from the persisted
// onboarding row, so cross-cartridge identity continuity is visible)
// plus a starter trigger → action chain you can edit.

import { Box, Col, Pressable, Row, ScrollView, Text } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlowEditor } from '../gallery/components/flow-editor/FlowEditor';
import type { FlowNode, FlowEdge } from '../gallery/components/flow-editor/types';
import { PaletteSidebar } from './canvas/PaletteSidebar';
import type { PaletteItem } from './canvas/palette';
import { compileGraph, applyBindings } from './canvas/compile';
import { toCode, toProse } from './canvas/describe';
import { parseCodeToGraph } from './canvas/parse';
import { CodeEditor } from './canvas/code-editor/CodeEditor';
import { SplitDivider } from './canvas/editor-split/SplitDivider';
import {
  useUser, useLatestGoal,
  useDefaultComposition, useCompositionStore, defaultCompositionId,
} from './data';
import {
  installVmBridges, uninstallVmBridges,
  installClaimEngine, uninstallClaimEngine,
  installMechanicalWires, uninstallMechanicalWires,
  installPathologyBinder, uninstallPathologyBinder, setActivePathologies,
  bindRules, unbindAllRules,
  useCRUD,
} from '../db';
import type { Pathology } from '../gallery/data/core/pathology';
import '@reactjit/runtime/hooks/ifttt-supervisor';

// ── Seed scene ────────────────────────────────────────────────────
// A Goal node + a starter rule chain (event:goal.reframed →
// notify-user). Demonstrates the substrate in two clicks of editing.

const SEED_NODES: FlowNode[] = [
  {
    id: 'seed-goal',
    label: 'GOAL',
    x: -200,
    y: -180,
    data: {
      kind: 'token',
      role: 'GOAL',
      stripe: 'trigger',
      state: 'idle',
      ports: [
        { id: 'review', side: 'out', kind: 'flow', label: 'review socket — emit "achieved" to close' },
      ],
    },
  },
  {
    id: 'seed-trigger',
    label: 'event:goal.reframed',
    x: 100,
    y: -100,
    data: {
      kind: 'trigger',
      role: 'TRG',
      stripe: 'trigger',
      state: 'idle',
    },
  },
  {
    id: 'seed-action',
    label: 'notify-user:Goal reframed',
    x: 380,
    y: -100,
    data: {
      kind: 'action',
      role: 'NOT',
      state: 'idle',
    },
  },
];

const SEED_EDGES: FlowEdge[] = [
  {
    id: 'seed-edge-trigger-action',
    from: 'seed-trigger',
    to: 'seed-action',
    fromPort: 'out',
    toPort: 'in',
  },
];

// ── Page ──────────────────────────────────────────────────────────

export default function SweatshopPage() {
  const user = useUser();
  const goal = useLatestGoal();
  const userName = user.data?.displayName ?? '';
  const goalText = goal.data[0]?.statement ?? null;
  const userId = user.data?.id ?? 'user_local';

  const composition = useDefaultComposition(userId);
  const compositionStore = useCompositionStore();

  const [nodes, setNodes] = useState<FlowNode[]>(() => seedNodesWithGoal(goalText));
  const [edges, setEdges] = useState<FlowEdge[]>(SEED_EDGES);
  const [bindingCount, setBindingCount] = useState<number>(0);
  const [persisted, setPersisted] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [showCanvas, setShowCanvas] = useState(true);
  const [showCode, setShowCode] = useState(true);
  const [showProse, setShowProse] = useState(true);
  // Pane flex weights — dragging a SplitDivider rebalances. The "rest"
  // bucket is canvas-vs-(code+prose); inside the right group, code-vs-prose.
  const [weights, setWeights] = useState({ canvas: 2.0, code: 1.0, prose: 0.8 });
  const bumpWeight = useCallback((aKey: 'canvas' | 'code', bKey: 'rest' | 'prose', delta: number) => {
    setWeights((w) => {
      if (bKey === 'rest') {
        // canvas ↔ (code + prose). Push code+prose proportionally.
        const sumRest = w.code + w.prose;
        const newCanvas = Math.max(0.2, Math.min(8, w.canvas + delta));
        const newRest = Math.max(0.2, w.canvas + sumRest - newCanvas);
        const ratio = sumRest > 0 ? newRest / sumRest : 0.5;
        return { canvas: newCanvas, code: w.code * ratio, prose: w.prose * ratio };
      }
      // code ↔ prose direct.
      const sum = w.code + w.prose;
      const newCode = Math.max(0.2, Math.min(8, w.code + delta));
      const newProse = Math.max(0.2, sum - newCode);
      return { ...w, code: newCode, prose: newProse };
    });
  }, []);
  const hydratedRef = useRef(false);

  // Derived projections — recompute only when graph changes.
  const codeMirror = useMemo(() => toCode(nodes, edges), [nodes, edges]);
  const proseMirror = useMemo(() => toProse(nodes, edges), [nodes, edges]);

  // Local mirror of the code pane's editable text. Bidirectional:
  // canvas → code is the projection (toCode); code → canvas is the
  // parser (parseCodeToGraph), debounced 300ms after last keystroke.
  // The codeDraft===codeMirror equality check breaks the round-trip
  // — when the canvas updates the projection, the effect sees them
  // already equal and no-ops.
  const [codeDraft, setCodeDraft] = useState<string>(codeMirror);
  useEffect(() => { setCodeDraft(codeMirror); }, [codeMirror]);
  useEffect(() => {
    if (codeDraft === codeMirror) return;
    const t = setTimeout(() => {
      const parsed = parseCodeToGraph(codeDraft, nodes, edges);
      if (!parsed) return;
      setNodes(parsed.nodes);
      setEdges(parsed.edges);
    }, 300);
    return () => clearTimeout(t);
  // intentionally exclude `nodes`/`edges` — the parser uses snapshots,
  // and re-running on every node/edge change would race with the
  // canvas→code projection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeDraft, codeMirror]);

  // ── Boot the supervisor engines for the lifetime of the cartridge.
  // Each install is independent + idempotent; wrap in try/catch so a
  // missing dependency in one (e.g. `bindRules` if the DB has no rule
  // rows yet) doesn't kill the others.
  useEffect(() => {
    try { installVmBridges(); } catch (e: any) { console.warn('[sweatshop] installVmBridges:', e?.message ?? e); }
    try { installClaimEngine(); } catch (e: any) { console.warn('[sweatshop] installClaimEngine:', e?.message ?? e); }
    try { installMechanicalWires(); } catch (e: any) { console.warn('[sweatshop] installMechanicalWires:', e?.message ?? e); }
    try { installPathologyBinder(); } catch (e: any) { console.warn('[sweatshop] installPathologyBinder:', e?.message ?? e); }
    bindRules().catch((e: any) => console.warn('[sweatshop] bindRules:', e?.message ?? e));
    return () => {
      try { unbindAllRules(); } catch { /* ignore */ }
      try { uninstallPathologyBinder(); } catch { /* ignore */ }
      try { uninstallMechanicalWires(); } catch { /* ignore */ }
      try { uninstallClaimEngine(); } catch { /* ignore */ }
      try { uninstallVmBridges(); } catch { /* ignore */ }
    };
  }, []);

  // ── Push active Pathology rows into the auto-binder whenever they
  // change. The binder takes care of binding/rebinding per running
  // session; we're just the data source.
  const pathologyStore = useCRUD<Pathology>('pathology', { parse: (v: unknown) => v as any });
  const activePathologies = pathologyStore.useListQuery({ where: { active: true } });
  useEffect(() => {
    if (activePathologies.loading) return;
    setActivePathologies(activePathologies.data ?? []);
  }, [activePathologies.loading, activePathologies.data]);

  // ── Hydrate from the persisted composition row on first read. If
  //    no row exists yet, write the seed scene as the first row so
  //    later writes go through update() not create().
  useEffect(() => {
    if (hydratedRef.current) return;
    if (composition.loading) return;
    hydratedRef.current = true;
    if (composition.data) {
      setNodes((composition.data.nodes ?? SEED_NODES) as FlowNode[]);
      setEdges((composition.data.edges ?? SEED_EDGES) as FlowEdge[]);
      return;
    }
    // No row yet — seed it. Don't block; if create fails, the page
    // continues to work in-memory and we retry on the next save.
    const now = new Date().toISOString();
    const seedNodes = seedNodesWithGoal(goalText);
    compositionStore.create({
      id: defaultCompositionId(userId),
      name: 'Default canvas',
      description: 'Sweatshop open scene.',
      userId,
      nodes: seedNodes as any,
      edges: SEED_EDGES as any,
      createdAt: now,
      updatedAt: now,
    }).catch((e: any) => console.warn('[sweatshop] composition seed:', e?.message ?? e));
  }, [composition.loading, composition.data, userId, goalText, compositionStore]);

  // ── Debounced save on graph edits. 400ms quiet window so a flurry
  //    of node moves coalesces into one write.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      setPersisted('saving');
      compositionStore.update(defaultCompositionId(userId), {
        nodes: nodes as any,
        edges: edges as any,
        updatedAt: new Date().toISOString(),
      })
        .then(() => setPersisted('saved'))
        .catch((e: any) => {
          console.warn('[sweatshop] composition save:', e?.message ?? e);
          setPersisted('error');
        });
    }, 400);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [nodes, edges, userId, compositionStore]);

  // ── Live re-bind on graph edits. Compile the current graph, attach
  // every trigger→action edge as a real IFTTT subscription, tear
  // down on next change or unmount.
  const teardownRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (teardownRef.current) { teardownRef.current(); teardownRef.current = null; }
    const { bindings, warnings } = compileGraph(nodes, edges);
    if (warnings.length > 0) for (const w of warnings) console.warn('[sweatshop compile]', w);
    const { dispose, attached, warnings: applyWarnings } = applyBindings(bindings);
    if (applyWarnings.length > 0) for (const w of applyWarnings) console.warn('[sweatshop bind]', w);
    teardownRef.current = dispose;
    setBindingCount(attached);
    return () => {
      if (teardownRef.current) { teardownRef.current(); teardownRef.current = null; }
    };
  }, [nodes, edges]);

  const handleSpawn = (item: PaletteItem) => {
    // Drop near the canvas center with a small jitter so successive
    // spawns don't pile on one pixel.
    const jitter = (Math.random() - 0.5) * 80;
    const node = item.spawn(jitter, 60 + jitter);
    setNodes((prev) => [...prev, node]);
  };

  return (
    <S.Page style={{ flexDirection: 'row' }}>
      <PaletteSidebar onSpawn={handleSpawn} />

      <Col style={{ flexGrow: 1 }}>
        {/* Top strip: identity + goal */}
        <Row style={{
          padding: 12,
          gap: 12,
          alignItems: 'baseline',
          borderBottomWidth: 1,
          borderBottomColor: 'theme:rule',
          backgroundColor: 'theme:bg1',
        }}>
          <Text size={16} color="theme:ink" bold={true}>Canvas</Text>
          <S.Caption>
            {userName ? `${userName}'s open scene` : 'open scene — nothing required, everything composes'}
          </S.Caption>
          {goalText ? (
            <Text size={10} color="theme:accent">goal: {goalText}</Text>
          ) : null}
          <Text size={10} color="theme:inkDim">
            {bindingCount > 0 ? `${bindingCount} live binding${bindingCount === 1 ? '' : 's'}` : 'no live bindings'}
          </Text>
          <Text size={10} color={persisted === 'error' ? 'theme:err' : 'theme:inkDim'}>
            {persisted === 'saving' ? 'saving…' : persisted === 'saved' ? 'saved' : persisted === 'error' ? 'save failed' : ''}
          </Text>
          <Box style={{ flexGrow: 1 }} />
          <PaneToggle label="canvas"  active={showCanvas}
            onPress={() => { if (!(showCanvas && !showCode && !showProse)) setShowCanvas(v => !v); }} />
          <PaneToggle label="code"    active={showCode}
            onPress={() => { if (!(showCode && !showCanvas && !showProse)) setShowCode(v => !v); }} />
          <PaneToggle label="english" active={showProse}
            onPress={() => { if (!(showProse && !showCanvas && !showCode)) setShowProse(v => !v); }} />
        </Row>

        {/* Three horizontal panes: canvas | code | english. Each pane
            is hide-able from the top-strip toggle chips. Dividers
            between visible neighbors are drag-resizable (rAF-driven,
            weight-based). At least one pane is always visible. */}
        <Row style={{ flexGrow: 1, minHeight: 0 }}>
          {showCanvas && (
            <Box style={{ flexGrow: weights.canvas, flexBasis: 0, minWidth: 240 }}>
              <FlowEditor
                nodes={nodes}
                edges={edges}
                onNodesChange={setNodes}
                onEdgesChange={setEdges}
                allowDelete={true}
              />
            </Box>
          )}
          {showCanvas && (showCode || showProse) && (
            <SplitDivider direction="horizontal"
              onResize={(d) => bumpWeight('canvas', 'rest', d * 0.01)} />
          )}
          {(showCode || showProse) && (
            <Row style={{ flexGrow: weights.canvas > 0 && showCanvas ? (weights.code + weights.prose) : 1, flexBasis: 0, minWidth: 280 }}>
              {showCode && (
                <Box style={{ flexGrow: weights.code, flexBasis: 0, minWidth: 240 }}>
                  <CodeEditor
                    title="Canvas as code"
                    filename="canvas.tsx"
                    value={codeDraft}
                    onChange={setCodeDraft}
                  />
                </Box>
              )}
              {showCode && showProse && (
                <SplitDivider direction="horizontal"
                  onResize={(d) => bumpWeight('code', 'prose', d * 0.01)} />
              )}
              {showProse && (
                <Col style={{ flexGrow: weights.prose, flexBasis: 0, minWidth: 240, backgroundColor: 'theme:bg1' }}>
                  <Row style={{
                    paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, gap: 8,
                    borderBottomWidth: 1, borderBottomColor: 'theme:rule',
                    backgroundColor: 'theme:bg2',
                    alignItems: 'center',
                  }}>
                    <Text size={11} color="theme:ink" bold>What this does</Text>
                    <Box style={{ flexGrow: 1 }} />
                    <Text size={10} color="theme:inkDim">plain english</Text>
                  </Row>
                  <ScrollView style={{ flexGrow: 1, minHeight: 0, padding: 16 }}>
                    <Text size={13} color="theme:ink" style={{ lineHeight: 20, whiteSpace: 'pre-wrap' as any }}>
                      {proseMirror}
                    </Text>
                  </ScrollView>
                </Col>
              )}
            </Row>
          )}
        </Row>
      </Col>
    </S.Page>
  );
}

function PaneToggle({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{
      paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: active ? 'theme:accent' : 'theme:rule',
      backgroundColor: active ? 'theme:bg2' : 'transparent',
    }}>
      <Text size={10} color={active ? 'theme:accent' : 'theme:inkDim'}>{label}</Text>
    </Pressable>
  );
}

function seedNodesWithGoal(goalText: string | null): FlowNode[] {
  // If the persisted onboarding goal is set, surface it on the goal
  // node's label. Otherwise the seed scene shows the placeholder copy.
  if (!goalText) return SEED_NODES;
  return SEED_NODES.map((n) =>
    n.id === 'seed-goal'
      ? { ...n, label: goalText.length > 60 ? goalText.slice(0, 57) + '…' : goalText }
      : n,
  );
}
