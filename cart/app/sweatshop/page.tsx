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

import { Box, Col, Row, Text } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import { useEffect, useRef, useState } from 'react';
import { FlowEditor } from '../gallery/components/flow-editor/FlowEditor';
import type { FlowNode, FlowEdge } from '../gallery/components/flow-editor/types';
import { PaletteSidebar } from './canvas/PaletteSidebar';
import type { PaletteItem } from './canvas/palette';
import { compileGraph, applyBindings } from './canvas/compile';
import { useUser, useLatestGoal } from './data';
import {
  installVmBridges, uninstallVmBridges,
  installClaimEngine, uninstallClaimEngine,
  installMechanicalWires, uninstallMechanicalWires,
  bindRules, unbindAllRules,
} from '../db';
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

  const [nodes, setNodes] = useState<FlowNode[]>(() => seedNodesWithGoal(goalText));
  const [edges, setEdges] = useState<FlowEdge[]>(SEED_EDGES);
  const [bindingCount, setBindingCount] = useState<number>(0);

  // ── Boot the supervisor engines for the lifetime of the cartridge.
  // Each install is independent + idempotent; wrap in try/catch so a
  // missing dependency in one (e.g. `bindRules` if the DB has no rule
  // rows yet) doesn't kill the others.
  useEffect(() => {
    try { installVmBridges(); } catch (e: any) { console.warn('[sweatshop] installVmBridges:', e?.message ?? e); }
    try { installClaimEngine(); } catch (e: any) { console.warn('[sweatshop] installClaimEngine:', e?.message ?? e); }
    try { installMechanicalWires(); } catch (e: any) { console.warn('[sweatshop] installMechanicalWires:', e?.message ?? e); }
    bindRules().catch((e: any) => console.warn('[sweatshop] bindRules:', e?.message ?? e));
    return () => {
      try { unbindAllRules(); } catch { /* ignore */ }
      try { uninstallMechanicalWires(); } catch { /* ignore */ }
      try { uninstallClaimEngine(); } catch { /* ignore */ }
      try { uninstallVmBridges(); } catch { /* ignore */ }
    };
  }, []);

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
        </Row>

        {/* Canvas */}
        <Box style={{ flexGrow: 1 }}>
          <FlowEditor
            nodes={nodes}
            edges={edges}
            onNodesChange={setNodes}
            onEdgesChange={setEdges}
            allowDelete={true}
          />
        </Box>
      </Col>
    </S.Page>
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
