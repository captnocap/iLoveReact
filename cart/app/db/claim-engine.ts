// claim-engine — detection + verify-gate for the Claim ledger.
//
// Subscribes to event:append (host-side and per-VM) and watches for
// agent assertions that need verification: "fixed", "shipped",
// "works", "the cause is X", "the work was destroyed", etc. Each hit
// inserts a Claim row with status='unverified' and the evidence kinds
// that would resolve it.
//
// The verify-gate then watches the same bus for either:
//   - matching evidence events arriving → mark verified
//   - the agent emitting a forward action with no intervening evidence
//     → fire `supervisor:inject-message:<vmid>:<prompt>` to loop the
//     agent back through its own claim
//
// Lifecycle:
//   - installClaimEngine() subscribes; safe to call from cart/app/db
//   - uninstallClaimEngine() reverses for hot reload
//
// The detection ruleset is intentionally inline + small. As patterns
// stabilize, migrate them into a ClaimRule entity that can be edited
// at runtime — same shape as Pathology rows.

import { subscribe, emit } from '@reactjit/runtime/ffi';
import { registerGate } from '@reactjit/runtime/hooks/ifttt-gate';
import type {
  Claim,
  ClaimKind,
  ClaimEvidenceKind,
  ClaimEvidenceRecord,
} from '../gallery/data/core/claim';

// ── Detection rules ──────────────────────────────────────────────
//
// Each rule pairs a claim regex with the evidence kinds that would
// resolve it. Matching is case-insensitive. The rules fire on
// event:append payloads (which may be raw stdout lines, tool_use
// blocks, or agent text). The match is performed on the JSON
// stringification of the payload, so a regex hit anywhere in the
// payload tree counts.

interface DetectionRule {
  kind: ClaimKind;
  pattern: RegExp;
  requiredEvidence: ClaimEvidenceKind[];
  requireAll?: boolean;
  injectTemplate: string;
}

const DEFAULT_RULES: DetectionRule[] = [
  {
    kind: 'fix',
    pattern: /\b(?:fix(?:ed)?|the bug is gone|should be silenced|that should do it)\b/i,
    requiredEvidence: ['build-success', 'run-success'],
    requireAll: false,
    injectTemplate:
      'You said: "{claim}". No verification evidence ({requiredEvidence}) ' +
      'has arrived since. Run the test or reproduce the bug before reasserting.',
  },
  {
    kind: 'ship',
    pattern: /\b(?:shipped|the work is in|landed|merged)\b/i,
    requiredEvidence: ['build-success', 'test-pass'],
    requireAll: false,
    injectTemplate:
      'You said: "{claim}". Build/test evidence missing — run the verification.',
  },
  {
    kind: 'works',
    pattern: /\b(?:works(?:\s+now)?|try it(?:\s+now)?|good to go)\b/i,
    requiredEvidence: ['run-success'],
    requireAll: false,
    injectTemplate:
      'You said: "{claim}". Run the binary / hit the endpoint and confirm before claiming it works.',
  },
  {
    kind: 'cause',
    pattern: /\b(?:the cause is|happens because|the reason is|root cause is)\b/i,
    requiredEvidence: ['stack-trace', 'repro-run'],
    requireAll: false,
    injectTemplate:
      'Causal claim made: "{claim}". No upstream evidence (stack trace / repro). ' +
      'Read the trace or reproduce before asserting causality.',
  },
  {
    kind: 'recovery',
    pattern: /\b(?:work was destroyed|cannot be recovered|unrecoverable|lost forever)\b/i,
    requiredEvidence: ['reflog-read'],
    requireAll: false,
    injectTemplate:
      'Loss claim made: "{claim}". Run `git reflog` and `ls .git/` first — many losses recover in seconds.',
  },
  {
    kind: 'pre-existing',
    pattern: /\bpre-?existing\b/i,
    requiredEvidence: ['log-grep'],
    requireAll: false,
    injectTemplate:
      'You said: "{claim}". Run `git log --follow` on the relevant file to confirm you did not author the line.',
  },
  {
    kind: 'completion',
    pattern: /\b(?:all done|completely done|all (?:\d+ )?(?:tasks|steps|files)\s+(?:fixed|done|complete))\b/i,
    requiredEvidence: ['test-pass', 'run-success'],
    requireAll: false,
    injectTemplate:
      'Completion claim made: "{claim}". Verify with a test/run before stopping.',
  },
];

// ── Evidence detectors ──────────────────────────────────────────
//
// Pattern → ClaimEvidenceKind. Same surface as the claim rules: each
// looks at event:append payloads. We deliberately keep these
// permissive — the goal is to credit any reasonable verification
// activity.

interface EvidenceRule {
  kind: ClaimEvidenceKind;
  pattern: RegExp;
}

const EVIDENCE_RULES: EvidenceRule[] = [
  { kind: 'build-success', pattern: /"name":"Bash"[\s\S]*?(?:zig\s+build|cargo\s+build|npm\s+(?:run\s+)?build)[\s\S]*?(?:exitCode"\s*:\s*0|exit:\s*0)/i },
  { kind: 'test-pass', pattern: /"name":"Bash"[\s\S]*?(?:zig\s+test|cargo\s+test|npm\s+test|pytest|go\s+test)[\s\S]*?(?:exitCode"\s*:\s*0|exit:\s*0|passed)/i },
  { kind: 'run-success', pattern: /"name":"Bash"[\s\S]*?(?:exitCode"\s*:\s*0|exit:\s*0)/i },
  { kind: 'reflog-read', pattern: /"name":"Bash"[\s\S]*?git\s+reflog/i },
  { kind: 'log-grep', pattern: /"name":"Bash"[\s\S]*?git\s+(?:log\s+--follow|blame)/i },
  { kind: 'stack-trace', pattern: /"name":"Read"[\s\S]*?(?:\.log|stderr|panic|backtrace|Traceback)/i },
  { kind: 'repro-run', pattern: /"name":"Bash"[\s\S]*?(?:\.\/|bash\s|sh\s).*?(?:exitCode|exit:)/i },
];

// ── State ────────────────────────────────────────────────────────
//
// Active unverified claims, keyed by id. Garbage-collected on
// session-end (status flips to 'expired').

interface ActiveClaim {
  row: Claim;
  /** Per-claim teardown — un-registers the verify-gate. */
  dispose: () => void;
}

const _claims = new Map<string, ActiveClaim>();
const _detectorUnsubs: Array<() => void> = [];
let _installed = false;

// ── Helpers ──────────────────────────────────────────────────────

function searchableText(payload: any): string {
  if (typeof payload === 'string') return payload;
  if (payload == null) return '';
  if (typeof payload === 'object') {
    try { return JSON.stringify(payload); } catch { return String(payload); }
  }
  return String(payload);
}

function newClaimId(): string {
  return `claim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

function vmidFromChannel(channel: string): string | undefined {
  const m = channel.match(/^vm:([^:]+):/);
  return m?.[1];
}

// ── Detector ─────────────────────────────────────────────────────

interface DetectorOptions {
  /** The event:append channel to listen on. Use 'event:append' for
   *  host-side claims, or 'vm:<vmid>:event:append' for guest claims. */
  channel: string;
  /** Owning session — required so the Claim row can be tied to it. */
  sessionId: string;
  /** Owning worker, when known. */
  workerId?: string;
}

function detectClaim(payload: any, channel: string): { rule: DetectionRule; text: string; eventId?: string } | null {
  const text = searchableText(payload);
  if (!text) return null;
  for (const rule of DEFAULT_RULES) {
    const m = rule.pattern.exec(text);
    if (m) return { rule, text: m[0], eventId: typeof payload?.id === 'string' ? payload.id : undefined };
  }
  return null;
}

function detectEvidence(payload: any): ClaimEvidenceKind[] {
  const text = searchableText(payload);
  if (!text) return [];
  const kinds: ClaimEvidenceKind[] = [];
  for (const ev of EVIDENCE_RULES) {
    if (ev.pattern.test(text)) kinds.push(ev.kind);
  }
  return kinds;
}

function attachVerifyGate(claim: Claim, channel: string): () => void {
  // Each claim registers a gate keyed off the Claim row itself.
  // - after: a synthetic emit on `claim:opened:<id>` (we trigger this
  //   ourselves on row insert so the gate's window opens immediately)
  // - suspect: any forward agent action on the claim's channel that
  //   isn't matching evidence
  // - requires: matching evidence on the claim's channel
  const claimChannel = `claim:opened:${claim.id}`;
  // Open the gate's window now.
  setTimeout(() => emit(claimChannel, { id: claim.id }), 0);

  return registerGate({
    after: claimChannel,
    suspect: channel,
    suspectFilter: (payload: any) => {
      // A "forward action" is any tool_use that isn't itself the
      // verifying evidence.
      const ev = detectEvidence(payload);
      return ev.length === 0;
    },
    requires: channel,
    requiresFilter: (payload: any) => {
      const ev = detectEvidence(payload);
      // Only events providing the required evidence count as closers.
      return ev.some((k) => claim.requiredEvidence.includes(k));
    },
    onFire: ({ suspectPayload }) => {
      // Forward action without verification — inject the prompt-back.
      const prompt = fillTemplate(claim.injectTemplate ?? '', {
        claim: claim.claimText,
        scope: claim.scope ?? '',
        requiredEvidence: claim.requiredEvidence.join(', '),
      });
      const target = claim.vmid ?? '';
      const action = target
        ? `vm:${target}:supervisor:inject-message`
        : 'supervisor:inject-message';
      emit(action, { text: prompt, claimId: claim.id, suspectPayload });
    },
    reArmOnFire: false,
  });
}

function recordEvidence(claimId: string, kinds: ClaimEvidenceKind[], bus: string, payload: any): void {
  const active = _claims.get(claimId);
  if (!active) return;
  const now = new Date().toISOString();
  const row = active.row;
  for (const k of kinds) {
    const rec: ClaimEvidenceRecord = { kind: k, bus, payload: payload ?? {}, at: now };
    row.evidence.push(rec);
  }
  // Resolution: any evidence kind in requiredEvidence → verified
  // (unless requireAll, in which case all must be present).
  const observed = new Set(row.evidence.map((e) => e.kind));
  const satisfied = row.requireAll
    ? row.requiredEvidence.every((k) => observed.has(k))
    : row.requiredEvidence.some((k) => observed.has(k));
  if (satisfied && row.status === 'unverified') {
    row.status = 'verified';
    row.resolution = 'auto-verified';
    row.resolvedAt = now;
    row.updatedAt = now;
    emit('claim:lifecycle', { claimId, status: 'verified', row });
    active.dispose();
    _claims.delete(claimId);
  }
}

// ── Public API ───────────────────────────────────────────────────

/** Open detection on an event:append channel. Pair with each running
 *  WorkerSession so the engine sees host-side and per-VM event
 *  streams in one place. Returns an unsubscribe. */
export function attachDetector(opts: DetectorOptions): () => void {
  const { channel, sessionId, workerId } = opts;
  const vmid = vmidFromChannel(channel);

  const off = subscribe(channel, (payload: any) => {
    // Evidence first — an event can simultaneously be a verification
    // for an existing claim AND raise a new one (e.g. a Bash with a
    // claim-shaped command output).
    const ev = detectEvidence(payload);
    if (ev.length > 0) {
      for (const c of Array.from(_claims.values())) {
        if (c.row.sessionId !== sessionId) continue;
        recordEvidence(c.row.id, ev, channel, payload);
      }
    }

    const detected = detectClaim(payload, channel);
    if (!detected) return;

    const now = new Date().toISOString();
    const row: Claim = {
      id: newClaimId(),
      sessionId,
      workerId,
      vmid,
      claimText: detected.text,
      detectedFrom: channel,
      detectedEventId: detected.eventId,
      kind: detected.rule.kind,
      requiredEvidence: detected.rule.requiredEvidence,
      requireAll: detected.rule.requireAll ?? false,
      evidence: [],
      status: 'unverified',
      injectTemplate: detected.rule.injectTemplate,
      detectedAt: now,
      updatedAt: now,
    };
    const dispose = attachVerifyGate(row, channel);
    _claims.set(row.id, { row, dispose });
    emit('claim:lifecycle', { claimId: row.id, status: 'unverified', row });
  });

  return () => { off(); };
}

/** Subscribe to session:lifecycle and auto-attach a detector per
 *  running session. Drives detection without any per-cart wiring. */
export function installClaimEngine(): void {
  if (_installed) return;
  _installed = true;
  const perSession = new Map<string, () => void>();
  const off = subscribe('session:lifecycle', (payload: any) => {
    if (!payload || typeof payload !== 'object') return;
    const sessionId = String(payload.sessionId ?? '');
    if (!sessionId) return;
    if (payload.status === 'running') {
      if (perSession.has(sessionId)) return;
      const channel = typeof payload.vmid === 'string' && payload.vmid.length > 0
        ? `vm:${payload.vmid}:event:append`
        : 'event:append';
      const dispose = attachDetector({
        channel,
        sessionId,
        workerId: typeof payload.workerId === 'string' ? payload.workerId : undefined,
      });
      perSession.set(sessionId, dispose);
    } else {
      // Terminal status — tear down the detector for this session and
      // expire any unresolved claims it owned.
      const dispose = perSession.get(sessionId);
      if (dispose) { dispose(); perSession.delete(sessionId); }
      const now = new Date().toISOString();
      for (const c of Array.from(_claims.values())) {
        if (c.row.sessionId !== sessionId) continue;
        c.row.status = 'expired';
        c.row.resolution = 'session-ended';
        c.row.resolvedAt = now;
        c.row.updatedAt = now;
        emit('claim:lifecycle', { claimId: c.row.id, status: 'expired', row: c.row });
        c.dispose();
        _claims.delete(c.row.id);
      }
    }
  });
  _detectorUnsubs.push(off);
}

/** Reverse of installClaimEngine. Detaches every active detector and
 *  expires every unresolved claim. */
export function uninstallClaimEngine(): void {
  if (!_installed) return;
  for (const u of _detectorUnsubs) { try { u(); } catch { /* ignore */ } }
  _detectorUnsubs.length = 0;
  for (const c of Array.from(_claims.values())) {
    try { c.dispose(); } catch { /* ignore */ }
  }
  _claims.clear();
  _installed = false;
}

/** Inspect: list of currently-unresolved claims. */
export function listOpenClaims(): Claim[] {
  return Array.from(_claims.values()).map((c) => c.row);
}

/** Manual resolution. Useful for the supervisor surface — a user
 *  green-lights a claim, or a higher-priority rule rejects it. */
export function resolveClaim(claimId: string, resolution: 'supervisor-overrode' | 'user-overrode' | 'rule-rejected', note?: string): boolean {
  const c = _claims.get(claimId);
  if (!c) return false;
  const now = new Date().toISOString();
  c.row.status = resolution === 'rule-rejected' ? 'rejected' : 'verified';
  c.row.resolution = resolution;
  c.row.resolvedAt = now;
  c.row.resolutionNote = note;
  c.row.updatedAt = now;
  emit('claim:lifecycle', { claimId, status: c.row.status, row: c.row });
  c.dispose();
  _claims.delete(claimId);
  return true;
}
