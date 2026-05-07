// ifttt-supervisor — registers the supervisor architecture's trigger
// sources and action runners with the IFTTT registry.
//
// Importing this module is sufficient to make these DSL strings work
// from any cart's useIFTTT call:
//
//   useIFTTT('event:tool-call.dispatched', 'flag-pathology:pat_X')
//   useIFTTT('rule:rule_pathology_detected_halt.fired', 'kick-to-supervisor')
//   useIFTTT('event:task.*', (e) => console.log(e.subjectId))
//   useIFTTT('verb:verb_build_dev.completed', 'queue-job:job_promote_build')
//   useIFTTT(() => convergenceCount > 3, 'send:supervisor:converged')
//
// ── Bus convention ────────────────────────────────────────────────
// Sources subscribe to bus channels emitted by the DB writers (wired
// in cart/app/db). Each writer emits one normalized channel per
// entity:
//
//   'event:append'    — every Event row insert
//   'rule:fired'      — every RuleFiring row insert
//   'verb:lifecycle'  — every VerbInvocation row insert/transition
//   'worker:lifecycle' — every Worker row lifecycle change
//   'run:lifecycle'   — every CompositionRun row state change
//
// Sources read those channels and filter to the spec the user wrote.
// This keeps the action surface small (one channel per entity) and
// pushes pattern-matching into the source layer where it belongs.
//
// ── Action convention ─────────────────────────────────────────────
// Actions emit normalized 'supervisor:*' bus events. Whoever is
// connected — the DB writer, the cockpit notifier, a mock for tests —
// listens and acts. This keeps the IFTTT layer decoupled from
// persistence: a cart can wire useIFTTT in a unit test by stubbing
// the 'supervisor:*' subscriber and never touching Postgres.

import { subscribe, emit } from '../ffi';
import {
  registerIfttSource,
  registerIfttAction,
  resolveTrigger,
} from './ifttt-registry';

// ── Spec matcher ──────────────────────────────────────────────────
// Supports exact and suffix-wildcard match: 'task.completed' is exact;
// 'task.*' matches any 'task.X'. Comma-list is intentionally not
// supported here — express it at the rule layer with multiple bindings.

function specMatches(spec: string, kind: string): boolean {
  if (spec === kind) return true;
  if (spec.endsWith('.*')) {
    const prefix = spec.slice(0, -2) + '.';
    return kind.startsWith(prefix);
  }
  return false;
}

// ── Helper: register a source whose payload comes from a single bus
// channel and whose spec is matched against `payload.kind`. The
// supervisor channels all follow this shape.

function registerKindFilteredSource(
  prefix: string,
  channel: string,
  kindOf: (payload: any) => string,
): void {
  registerIfttSource(prefix, {
    match(spec) {
      if (!spec.startsWith(prefix)) return null;
      const wanted = spec.slice(prefix.length);
      if (!wanted) return null;
      return {
        subscribe(onFire) {
          return subscribe(channel, (payload: any) => {
            const k = kindOf(payload);
            if (typeof k === 'string' && specMatches(wanted, k)) {
              onFire(payload);
            }
          });
        },
      };
    },
  });
}

// ── Trigger sources ───────────────────────────────────────────────

// 'event:<entity>.<verb>' — DB Event row append.
registerKindFilteredSource('event:', 'event:append', (row) => row?.kind);

// 'rule:<ruleId>.fired' — RuleFiring row append.
//   Spec is '<ruleId>.fired' so 'rule:foo.fired' fires when ruleId='foo'.
registerKindFilteredSource('rule:', 'rule:fired', (row) =>
  row?.ruleId ? `${row.ruleId}.fired` : '',
);

// 'verb:<verbId>.<status>' — VerbInvocation row insert/transition.
//   status = started / succeeded / failed / timed-out / killed.
registerKindFilteredSource('verb:', 'verb:lifecycle', (row) =>
  row?.verbId && row?.status ? `${row.verbId}.${row.status}` : '',
);

// 'worker:<workerId>.<lifecycle>' — Worker row lifecycle transitions.
registerKindFilteredSource('worker:', 'worker:lifecycle', (row) =>
  row?.workerId && row?.lifecycle ? `${row.workerId}.${row.lifecycle}` : '',
);

// 'run:<runId>.<status>' — CompositionRun row state changes.
registerKindFilteredSource('run:', 'run:lifecycle', (row) =>
  row?.runId && row?.status ? `${row.runId}.${row.status}` : '',
);

// ── Action runners ────────────────────────────────────────────────
// All actions emit normalized 'supervisor:<kind>' bus events. The DB
// writer (cart/app/db) listens and persists. Tests can listen and
// assert without touching the DB.

// 'queue-job:<jobId>' — append JobRun for the named Job.
registerIfttAction('queue-job:', (rest, payload) => {
  emit('supervisor:queue-job', { jobId: rest, triggerPayload: payload });
});

// 'halt-run' (no rest) — halt the active CompositionRun. The trigger
// payload should carry runId; if absent, the supervisor binder picks
// the active run for the firing rule's scope.
registerIfttAction('halt-run', (_rest, payload) => {
  emit('supervisor:halt-run', {
    runId: payload?.runId ?? payload?.compositionRunId,
    reason: payload?.reason ?? 'rule-fired',
    triggerPayload: payload,
  });
});

// 'flag-pathology:<pathologyId>' — append PathologyDetection.
registerIfttAction('flag-pathology:', (rest, payload) => {
  emit('supervisor:flag-pathology', {
    pathologyId: rest,
    triggerPayload: payload,
  });
});

// 'invoke-verb:<verbId>' — request a WorkerVerb invocation. Args come
// from the trigger payload's `args` field if present.
registerIfttAction('invoke-verb:', (rest, payload) => {
  emit('supervisor:invoke-verb', {
    verbId: rest,
    args: payload?.args,
    triggerPayload: payload,
  });
});

// 'fire-rule:<ruleId>' — chained rule fire. Resolved through the
// registry so the chained rule's trigger source picks it up.
registerIfttAction('fire-rule:', (rest, payload) => {
  emit('supervisor:fire-rule', {
    ruleId: rest,
    triggerPayload: payload,
  });
  // Also resolve+kick locally so chains land in-process when both
  // ends share a cart. Chains across processes need the DB binder.
  const sub = resolveTrigger(`rule:${rest}.fired`);
  if (sub) {
    // No subscription — the DB writer's emit on rule:fired will land
    // through the channel. We just emit the firing notification so
    // any 'rule:<id>.fired' subscriber wakes up.
    emit('rule:fired', { ruleId: rest, triggerPayload: payload });
  }
});

// 'kick-to-supervisor' — escalate to the active supervisor.
registerIfttAction('kick-to-supervisor', (_rest, payload) => {
  emit('supervisor:kick-to-supervisor', {
    triggerPayload: payload,
    surface: 'cockpit-inbox',
  });
});

// 'notify-user:<msg>' — surface a notification. `<msg>` is the title;
// the trigger payload becomes the body.
registerIfttAction('notify-user:', (rest, payload) => {
  emit('supervisor:notify-user', {
    title: rest,
    body: payload,
  });
});

// 'inject-message:<text>' — inject text into the active worker's input
// stream. `<text>` may include {{payload}} placeholders.
registerIfttAction('inject-message:', (rest, payload) => {
  emit('supervisor:inject-message', {
    text: rest,
    triggerPayload: payload,
  });
});

// 'spawn-worker:<recipe>' — spawn a worker from a recipe / verb image.
registerIfttAction('spawn-worker:', (rest, payload) => {
  emit('supervisor:spawn-worker', {
    recipe: rest,
    triggerPayload: payload,
  });
});

// 'modify-assembly:<key>=<value>' — mutate the active prompt-composition
// assembly. Format mirrors `state:set:` for parser symmetry.
registerIfttAction('modify-assembly:', (rest, payload) => {
  const eq = rest.indexOf('=');
  if (eq < 0) {
    emit('supervisor:modify-assembly', { spec: rest, triggerPayload: payload });
    return;
  }
  emit('supervisor:modify-assembly', {
    key: rest.slice(0, eq),
    value: rest.slice(eq + 1),
    triggerPayload: payload,
  });
});

// 'set-variable:<key>=<value>' — set a run-scoped variable.
registerIfttAction('set-variable:', (rest, payload) => {
  const eq = rest.indexOf('=');
  if (eq < 0) {
    emit('supervisor:set-variable', { spec: rest, triggerPayload: payload });
    return;
  }
  emit('supervisor:set-variable', {
    key: rest.slice(0, eq),
    value: rest.slice(eq + 1),
    triggerPayload: payload,
  });
});

// 'commit-state' — persist a snapshot of run state.
registerIfttAction('commit-state', (_rest, payload) => {
  emit('supervisor:commit-state', { triggerPayload: payload });
});

// 'mark-status:<entity>.<id>=<status>' — update a row's status field.
registerIfttAction('mark-status:', (rest, payload) => {
  // Parse 'entity.id=status' — entity is the prefix before the first '.',
  // id the segment between '.' and '=', status the suffix.
  const dot = rest.indexOf('.');
  const eq = rest.indexOf('=');
  if (dot < 0 || eq < 0 || eq < dot) {
    emit('supervisor:mark-status', { spec: rest, triggerPayload: payload });
    return;
  }
  emit('supervisor:mark-status', {
    entity: rest.slice(0, dot),
    id: rest.slice(dot + 1, eq),
    status: rest.slice(eq + 1),
    triggerPayload: payload,
  });
});

// ── Public emitters ───────────────────────────────────────────────
// The DB writer (cart/app/db) calls these on each row insert /
// transition. Tests can call them too. Wrapping `emit` keeps the
// channel names canonical — no string typos in writers.

export function emitEventAppend(row: { id: string; kind: string; [k: string]: unknown }): void {
  emit('event:append', row);
}

export function emitRuleFired(row: {
  id: string;
  ruleId: string;
  triggeringEventId?: string;
  [k: string]: unknown;
}): void {
  emit('rule:fired', row);
}

export function emitVerbLifecycle(row: {
  id: string;
  verbId: string;
  status: string;
  [k: string]: unknown;
}): void {
  emit('verb:lifecycle', row);
}

export function emitWorkerLifecycle(row: {
  workerId: string;
  lifecycle: string;
  [k: string]: unknown;
}): void {
  emit('worker:lifecycle', row);
}

export function emitRunLifecycle(row: {
  runId: string;
  status: string;
  [k: string]: unknown;
}): void {
  emit('run:lifecycle', row);
}

export function emitSessionLifecycle(row: {
  sessionId: string;
  status: string;
  vmid?: string;
  [k: string]: unknown;
}): void {
  emit('session:lifecycle', row);
}
