// canvas/describe — project the FlowEditor graph into two parallel
// surfaces: a TypeScript code mirror + a plain-English prose
// description.
//
// Both surfaces are read-only projections of the same {nodes, edges}
// state. Editing the canvas updates both. (Bidirectional editing —
// typing in the code mirror to update the canvas — is a follow-up
// parser pass.)

import type { FlowNode, FlowEdge } from '../../gallery/components/flow-editor/types';

const TRIGGER_KINDS = new Set(['trigger', 'token']);
const ACTION_KINDS = new Set(['action']);

interface WiredPair {
  edge: FlowEdge;
  trigger: FlowNode;
  action: FlowNode;
}

function classifyEdges(nodes: FlowNode[], edges: FlowEdge[]): {
  wired: WiredPair[];
  orphans: FlowNode[];
} {
  const byId = new Map<string, FlowNode>(nodes.map((n) => [n.id, n]));
  const wired: WiredPair[] = [];
  const used = new Set<string>();
  for (const e of edges) {
    const f = byId.get(e.from);
    const t = byId.get(e.to);
    if (!f || !t) continue;
    const fKind = f.data?.kind;
    const tKind = t.data?.kind;
    if (!fKind || !tKind) continue;
    if (!TRIGGER_KINDS.has(fKind)) continue;
    if (!ACTION_KINDS.has(tKind)) continue;
    if (!f.label || !t.label) continue;
    wired.push({ edge: e, trigger: f, action: t });
    used.add(f.id);
    used.add(t.id);
  }
  const orphans = nodes.filter((n) => {
    const k = n.data?.kind;
    if (k === 'token') return false;                         // tokens are scenery
    if (!k) return false;
    if (!TRIGGER_KINDS.has(k) && !ACTION_KINDS.has(k)) return false;
    return !used.has(n.id);
  });
  return { wired, orphans };
}

// ── Code mirror ──────────────────────────────────────────────────

export function toCode(nodes: FlowNode[], edges: FlowEdge[]): string {
  const { wired, orphans, domains } = classifyEdges(nodes, edges);
  const out: string[] = [];

  out.push('// Auto-generated from your sweatshop canvas.');
  out.push('// Each rule corresponds to one trigger → action edge.');
  out.push('// Drag nodes on the canvas; this code rebuilds on every edit.');
  out.push('');
  out.push("import { useIFTTT } from '@reactjit/runtime/hooks/useIFTTT';");
  out.push('');
  out.push('export function CanvasRules() {');

  if (wired.length === 0) {
    out.push('  // No rules wired yet. Drag a trigger and an action from the');
    out.push('  // palette and connect them to create one.');
  } else {
    for (const { trigger, action } of wired) {
      out.push(`  useIFTTT(${JSON.stringify(trigger.label)}, ${JSON.stringify(action.label)});`);
    }
  }
  out.push('}');

  if (orphans.length > 0) {
    out.push('');
    out.push('// Orphan nodes (placed but unwired):');
    for (const o of orphans) {
      const tag = ACTION_KINDS.has((o.data as any)?.kind ?? '') ? 'ACTION ' : 'TRIGGER';
      out.push(`//   ${tag} ${o.label}`);
    }
  }

  if (domains.length > 0) {
    out.push('');
    out.push('// Domain references on canvas:');
    for (const d of domains) {
      out.push(`//   DOMAIN  ${d.label}`);
    }
  }

  return out.join('\n');
}

// ── English prose ────────────────────────────────────────────────

export function toProse(nodes: FlowNode[], edges: FlowEdge[]): string {
  const { wired, orphans, domains } = classifyEdges(nodes, edges);
  const out: string[] = [];

  if (wired.length === 0) {
    out.push('This canvas has no active rules yet.');
    out.push('');
    out.push('Drag a trigger and an action from the palette, then connect them to teach the system what to do.');
  } else {
    out.push(`This canvas has ${wired.length} active rule${wired.length === 1 ? '' : 's'}:`);
    out.push('');
    let n = 1;
    for (const { trigger, action } of wired) {
      out.push(`${n}. When ${describeTrigger(trigger.label)}, ${describeAction(action.label)}.`);
      n++;
    }
  }

  if (orphans.length > 0) {
    out.push('');
    out.push(`Plus ${orphans.length} unwired piece${orphans.length === 1 ? '' : 's'}:`);
    for (const o of orphans) {
      const k = (o.data as any)?.kind;
      if (ACTION_KINDS.has(k ?? '')) {
        out.push(`• "${o.label}" — an action waiting to be triggered.`);
      } else {
        out.push(`• "${o.label}" — a trigger that is not wired to an action yet.`);
      }
    }
  }

  if (domains.length > 0) {
    out.push('');
    out.push(`Domain references on canvas: ${domains.map((d) => d.label).join(', ')}.`);
  }

  return out.join('\n');
}

// ── Spec → English helpers ───────────────────────────────────────

function backtick(s: string): string {
  return '`' + s + '`';
}

function describeTrigger(spec: string): string {
  // match:<channel>::<pattern>
  if (spec.startsWith('match:')) {
    const rest = spec.slice('match:'.length);
    const sep = rest.indexOf('::');
    if (sep > 0) {
      const channel = rest.slice(0, sep);
      const pattern = rest.slice(sep + 2);
      return `text matching ${backtick(pattern)} appears on ${backtick(channel)}`;
    }
  }
  // count:<channel>::<n>:<windowMs>
  if (spec.startsWith('count:')) {
    const rest = spec.slice('count:'.length);
    const sep = rest.indexOf('::');
    if (sep > 0) {
      const channel = rest.slice(0, sep);
      const params = rest.slice(sep + 2);
      const [n, windowMs] = params.split(':');
      return `${backtick(channel)} fires ${n} or more times within ${windowMs}ms`;
    }
  }
  // firsthit:<channel>::<pattern>
  if (spec.startsWith('firsthit:')) {
    const rest = spec.slice('firsthit:'.length);
    const sep = rest.indexOf('::');
    if (sep > 0) {
      const channel = rest.slice(0, sep);
      const pattern = rest.slice(sep + 2);
      return `${backtick(pattern)} appears on ${backtick(channel)} for the first time this session`;
    }
  }
  // repeat:<channel>::<lookback>:<minSim>
  if (spec.startsWith('repeat:')) {
    const rest = spec.slice('repeat:'.length);
    const sep = rest.indexOf('::');
    if (sep > 0) {
      const channel = rest.slice(0, sep);
      return `a near-duplicate of a recent emit arrives on ${backtick(channel)}`;
    }
  }
  // vm:<vmid>:<remainder>
  if (spec.startsWith('vm:')) {
    const m = spec.match(/^vm:([^:]+):(.+)$/);
    if (m) {
      const vmid = m[1];
      const inner = m[2];
      return `inside VM ${backtick(vmid)}, ${describeTrigger(inner)}`;
    }
  }
  // event:<kind>
  if (spec.startsWith('event:')) {
    return `a ${backtick(spec.slice('event:'.length))} event is appended to the log`;
  }
  if (spec.startsWith('rule:')) {
    return `the rule ${backtick(spec.slice('rule:'.length))} fires`;
  }
  if (spec.startsWith('verb:')) {
    return `the verb ${backtick(spec.slice('verb:'.length))} transitions`;
  }
  if (spec.startsWith('worker:')) {
    return `the worker ${backtick(spec.slice('worker:'.length))} changes lifecycle`;
  }
  if (spec.startsWith('run:')) {
    return `the composition run ${backtick(spec.slice('run:'.length))} changes state`;
  }
  if (spec === 'session:lifecycle' || spec === 'claim:lifecycle') {
    return `a ${spec.replace(':', ' ')} event fires`;
  }
  if (spec.startsWith('proc:line:')) {
    return `a process line matches ${backtick(spec.slice('proc:line:'.length))}`;
  }
  if (spec.startsWith('proc:ram:')) return `a process RAM threshold is crossed (${backtick(spec)})`;
  if (spec.startsWith('proc:cpu:')) return `a process CPU threshold is crossed (${backtick(spec)})`;
  if (spec.startsWith('proc:idle:')) return `a process goes idle (${backtick(spec)})`;
  if (spec.startsWith('fs:')) return `the filesystem changes (${backtick(spec)})`;
  if (spec.startsWith('select:long:')) return `the user selects ${spec.slice('select:long:'.length)} or more characters`;
  if (spec === 'select:any') return `the user makes any text selection`;
  if (spec === 'select:nonempty') return `the user selects a non-empty range`;
  if (spec === 'select:cleared') return `the user clears their selection`;
  if (spec === 'clipboard:copy') return `the user copies something to the clipboard`;
  if (spec === 'mount') return `this scene mounts`;
  if (spec === 'click') return `something is clicked`;
  if (spec.startsWith('key:up:')) return `the key ${backtick(spec.slice('key:up:'.length))} is released`;
  if (spec.startsWith('key:')) return `the key ${backtick(spec.slice('key:'.length))} is pressed`;
  if (spec.startsWith('timer:every:')) return `every ${spec.slice('timer:every:'.length)}ms`;
  if (spec.startsWith('timer:once:')) return `${spec.slice('timer:once:'.length)}ms after mount`;
  if (spec.startsWith('state:')) {
    const rest = spec.slice('state:'.length);
    const colon = rest.indexOf(':');
    if (colon > 0) return `the state ${backtick(rest.slice(0, colon))} becomes ${backtick(rest.slice(colon + 1))}`;
    return `the state ${backtick(rest)} changes`;
  }
  if (spec === 'turn:start' || spec === 'turn:end' || spec === 'turn:tool-use' || spec === 'turn:tool-count') {
    return `the agent's turn ${spec.slice('turn:'.length)} fires`;
  }
  return `${backtick(spec)} fires`;
}

function describeAction(spec: string): string {
  if (spec.startsWith('flag-pathology:')) {
    return `flag the ${backtick(spec.slice('flag-pathology:'.length))} pathology`;
  }
  if (spec.startsWith('halt-run:')) {
    return `halt the run (reason: ${backtick(spec.slice('halt-run:'.length))})`;
  }
  if (spec === 'halt-run') return `halt the run`;
  if (spec.startsWith('invoke-verb:')) return `invoke the verb ${backtick(spec.slice('invoke-verb:'.length))}`;
  if (spec.startsWith('fire-rule:')) return `fire the rule ${backtick(spec.slice('fire-rule:'.length))}`;
  if (spec.startsWith('inject-message:')) return `inject the message "${spec.slice('inject-message:'.length)}" into the agent's input`;
  if (spec.startsWith('notify-user:')) return `notify the user: "${spec.slice('notify-user:'.length)}"`;
  if (spec.startsWith('queue-job:')) return `queue the job ${backtick(spec.slice('queue-job:'.length))}`;
  if (spec.startsWith('spawn-worker:')) return `spawn a ${backtick(spec.slice('spawn-worker:'.length))} worker`;
  if (spec.startsWith('modify-assembly:')) return `modify the prompt assembly (${backtick(spec.slice('modify-assembly:'.length))})`;
  if (spec.startsWith('set-variable:')) return `set ${backtick(spec.slice('set-variable:'.length))}`;
  if (spec.startsWith('mark-status:')) return `mark status ${backtick(spec.slice('mark-status:'.length))}`;
  if (spec === 'commit-state') return `commit the current state`;
  if (spec === 'kick-to-supervisor') return `route the next step through the supervisor`;
  if (spec.startsWith('send:')) return `relay onto the ${backtick(spec.slice('send:'.length))} bus channel`;
  if (spec.startsWith('log:')) return `log "${spec.slice('log:'.length)}"`;
  if (spec.startsWith('clipboard:')) return `copy "${spec.slice('clipboard:'.length)}" to the clipboard`;
  if (spec.startsWith('state:set:')) {
    const rest = spec.slice('state:set:'.length);
    const colon = rest.indexOf(':');
    if (colon > 0) return `set ${backtick(rest.slice(0, colon))} to ${backtick(rest.slice(colon + 1))}`;
  }
  if (spec.startsWith('state:toggle:')) return `toggle ${backtick(spec.slice('state:toggle:'.length))}`;
  if (spec.startsWith('proc:kill:')) return `kill process ${spec.slice('proc:kill:'.length)}`;
  if (spec.startsWith('proc:spawn:')) return `spawn ${backtick(spec.slice('proc:spawn:'.length))}`;
  if (spec.startsWith('proc:write:')) return `write to a process's stdin (${backtick(spec)})`;
  return `dispatch ${backtick(spec)}`;
}
