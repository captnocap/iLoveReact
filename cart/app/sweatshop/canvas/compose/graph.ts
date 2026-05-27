// Selections → the thing behind the curtain.
//
// Once the user has picked one trigger (IF) and one action (THEN), this
// module produces two artifacts:
//   1. The FlowNode/FlowEdge graph the composer reveals as an animation
//      — trigger → IF → action → done — so the user SEES the machine
//      without ever having authored it.
//   2. The recipe code: the literal `useIFTTT(trigger, action)` one-liner
//      this whole surface compiles down to, ready for recipe-store.

import type { FlowNode, FlowEdge } from '../../../gallery/components/flow-editor/types';
import { wrapScaffold } from '../../../recipes';
import { formatChain, type Suggestion } from './types';

const COL_X = [40, 320, 600, 880];
const ROW_Y = 160;

/** trigger → IF → action → done, laid out left to right in graph coords. */
export function buildFlowGraph(
  trigger: Suggestion,
  action: Suggestion,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [
    {
      id: 'n_trigger',
      label: trigger.text,
      x: COL_X[0],
      y: ROW_Y,
      data: { kind: 'trigger', stripe: 'trigger', token: formatChain(trigger.capability), sub: formatChain(trigger.capability) },
    },
    {
      id: 'n_if',
      label: 'IF',
      x: COL_X[1],
      y: ROW_Y,
      data: { kind: 'if' },
    },
    {
      id: 'n_action',
      label: action.text,
      x: COL_X[2],
      y: ROW_Y,
      data: { kind: 'action', token: formatChain(action.capability), sub: formatChain(action.capability) },
    },
    {
      id: 'n_end',
      label: 'done',
      x: COL_X[3],
      y: ROW_Y,
      data: { kind: 'end', stripe: 'end' },
    },
  ];

  const edges: FlowEdge[] = [
    { id: 'e_t_if', from: 'n_trigger', to: 'n_if', kind: 'flow' },
    { id: 'e_if_a', from: 'n_if', to: 'n_action', kind: 'cond-true', label: 'then' },
    { id: 'e_a_end', from: 'n_action', to: 'n_end', kind: 'flow' },
  ];

  return { nodes, edges };
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'rule'
  );
}

export function recipeNameFor(trigger: Suggestion, action: Suggestion): string {
  return `When ${trigger.text.toLowerCase()} → ${action.text.toLowerCase()}`;
}

export function recipePathFor(trigger: Suggestion, action: Suggestion): string {
  return `recipes/${slugify(trigger.text)}-${slugify(action.text)}.tsx`;
}

/** The rule this surface authors. For a single-step IF + single-step THEN
 *  this is the literal one-liner. Multi-step chains (gate / state:set /
 *  sequence) are NOT compiled yet — that's the dependent next step; until
 *  then we emit the entry step and document the full chain in a comment so
 *  nothing silently lies about what runs. */
export function recipeCodeFor(trigger: Suggestion, action: Suggestion): string {
  const esc = (t: string) => t.replace(/'/g, "\\'");
  const trig = trigger.capability[0] ?? '';
  const act = action.capability[0] ?? '';
  const composed = trigger.capability.length > 1 || action.capability.length > 1;
  const note = composed
    ? `  // chain: ${formatChain(trigger.capability)} → ${formatChain(action.capability)}\n` +
      '  // multi-step chain compilation (gate / state:set / sequence) is pending;\n' +
      '  // this emits the entry step only.\n'
    : '';
  return wrapScaffold(`${note}  useIFTTT('${esc(trig)}', '${esc(act)}');\n`);
}
