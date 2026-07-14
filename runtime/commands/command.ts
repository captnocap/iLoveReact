// commands/command.ts — one command identity, one authority entrance.
//
// CommandRegistry owns declarations and chord indexes. CommandAuthority is the
// only public execution door. Menus, toolbars, palettes, context menus, native
// input, and remote peers receive frozen CommandProjection data; handlers and
// guard functions stay in this module's private WeakMap.

import { type TargetRef } from '../editorbus/event';
import { normalizeChord, tryNormalizeChord } from './keychord';

export type Menu = string;

export type CommandEffect =
  | 'action'
  | 'project-action'
  | 'report-only'
  | 'control';

export type CommandSource =
  | 'menu'
  | 'hotkey'
  | 'toolbar'
  | 'dock'
  | 'context-menu'
  | 'palette'
  | 'viewport'
  | 'native'
  | 'remote'
  | 'automation';

export type UndoScope =
  | 'none'
  | Readonly<{
      kind: 'document' | 'project' | 'workspace' | 'native';
      /** Optional stable scope key when one command declaration serves many documents. */
      key?: string;
    }>;

export type ModeValue = string | number | boolean | null;
export type ModePredicate = Readonly<Record<string, ModeValue>>;
export type CommandMode = Readonly<Record<string, ModeValue>>;

export interface CommandKeybinding {
  chord: string;
  /** Exact mode facts required for this binding, e.g. { surface: 'world' }. */
  when?: ModePredicate;
}

export interface CommandProjectionDeclaration {
  /** Full menu path. The first segment is the top-level menu. */
  menu?: readonly [string, ...string[]];
  /** Stable toolbar slots that may project this command, e.g. 'D.world'. */
  toolbar?: readonly string[];
  /** Stable context surfaces that may project this command. */
  contextMenu?: readonly string[];
  palette?: boolean;
  /** Required when a command intentionally has no user-facing projection. */
  hiddenReason?: string;
}

export interface CommandProjection {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly effect: CommandEffect;
  readonly undoScope: UndoScope;
  readonly native: boolean;
  readonly projections: Readonly<CommandProjectionDeclaration>;
  readonly requiredCapabilities: readonly string[];
  readonly keybindings: readonly Readonly<CommandKeybinding>[];

  /** Compatibility views for the original menu registry. */
  readonly menu: Menu;
  readonly defaultKey?: string;
  readonly undoable: boolean;
}

export type ArgsValidation<Args> =
  | { ok: true; value: Args }
  | { ok: false; reason: string };

export interface CommandGuardContext<Args> {
  readonly invocationId: string;
  /** Stable authored-action identity resolved by the authority before the
   * handler commits. Undefined for report-only commands unless explicitly used
   * to correlate a control such as undo/redo. */
  readonly actionId?: string;
  readonly commandId: string;
  readonly args: Args;
  readonly origin?: string;
  readonly causedBy?: string;
}

export type Enablement = boolean | { enabled: boolean; reason?: string };

/** Private registration data. None of its functions are returned by a public
 * registry query or projection. */
export interface CommandRegistration<Args> {
  id: string;
  label: string;
  icon: string;
  effect: CommandEffect;
  undoScope: UndoScope;
  native?: boolean;
  projections: CommandProjectionDeclaration;
  keybindings?: readonly CommandKeybinding[];
  requiredCapabilities?: readonly string[];
  /** Controls such as undo/redo publish their semantic outcome phase while
   * still using the same applied-command return shape. */
  outcomePhase?: 'applied' | 'undone' | 'redone';
  validateArgs(args: unknown): ArgsValidation<Args>;
  isEnabled?(ctx: CommandGuardContext<Args>): Enablement;
}

/** Domain handlers must prepare all fallible work before atomically committing
 * their mutation. The authority can reject a thrown handler, but TypeScript
 * cannot roll back arbitrary side effects already performed by a closure. */
export type CommandHandler<Args, Result> = (ctx: CommandGuardContext<Args>) => Result;

interface RegisteredCommand {
  projection: CommandProjection;
  validateArgs(args: unknown): ArgsValidation<unknown>;
  isEnabled?(ctx: CommandGuardContext<unknown>): Enablement;
  handler(ctx: CommandGuardContext<unknown>): unknown;
  outcomePhase: 'applied' | 'undone' | 'redone';
}

interface IndexedBinding {
  id: string;
  chord: string;
  when: ModePredicate;
}

interface RegistryState {
  commands: Map<string, RegisteredCommand>;
  bindings: Map<string, IndexedBinding[]>;
  effectiveBindings: Map<string, IndexedBinding[]>;
  overridden: Set<string>;
}

const REGISTRIES = new WeakMap<CommandRegistry, RegistryState>();

function stateFor(registry: CommandRegistry): RegistryState {
  const state = REGISTRIES.get(registry);
  if (!state) throw new Error('commands: invalid registry');
  return state;
}

function freezeObject<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function freezePredicate(predicate: ModePredicate | undefined): ModePredicate {
  return freezeObject({ ...(predicate ?? {}) });
}

function freezeUndoScope(scope: UndoScope): UndoScope {
  return scope === 'none' ? scope : freezeObject({ ...scope });
}

function freezeProjections(value: CommandProjectionDeclaration): Readonly<CommandProjectionDeclaration> {
  const menu = value.menu ? freezeObject([...value.menu]) as unknown as readonly [string, ...string[]] : undefined;
  const toolbar = value.toolbar ? freezeObject([...value.toolbar]) : undefined;
  const contextMenu = value.contextMenu ? freezeObject([...value.contextMenu]) : undefined;
  return freezeObject({ ...value, menu, toolbar, contextMenu });
}

function predicatesOverlap(a: ModePredicate, b: ModePredicate): boolean {
  for (const key of Object.keys(a)) {
    if (Object.prototype.hasOwnProperty.call(b, key) && a[key] !== b[key]) return false;
  }
  return true;
}

function predicateMatches(predicate: ModePredicate, mode: CommandMode): boolean {
  return Object.keys(predicate).every((key) =>
    Object.prototype.hasOwnProperty.call(mode, key) && mode[key] === predicate[key]);
}

function projectionDeclared(value: CommandProjectionDeclaration): boolean {
  return Boolean(
    value.menu?.length || value.toolbar?.length || value.contextMenu?.length ||
    value.palette || value.hiddenReason?.trim(),
  );
}

function commandRecord(registry: CommandRegistry, id: string): RegisteredCommand | undefined {
  return stateFor(registry).commands.get(id);
}

/** An instance-capable, side-effect-free declaration/index module. It owns no
 * application state and exposes no executable callbacks. */
export class CommandRegistry {
  constructor() {
    REGISTRIES.set(this, {
      commands: new Map(), bindings: new Map(), effectiveBindings: new Map(), overridden: new Set(),
    });
  }

  register<Args, Result>(
    registration: CommandRegistration<Args>,
    handler: CommandHandler<Args, Result>,
  ): CommandProjection {
    const state = stateFor(this);
    const id = registration.id.trim();
    if (!id) throw new Error('commands: command id cannot be empty');
    if (state.commands.has(id)) throw new Error(`commands: command id '${id}' already registered`);
    if (!projectionDeclared(registration.projections)) {
      throw new Error(`commands: command '${id}' must declare a projection or hiddenReason`);
    }
    if (typeof registration.validateArgs !== 'function') {
      throw new Error(`commands: command '${id}' must validate its arguments`);
    }
    if (typeof handler !== 'function') throw new Error(`commands: command '${id}' has no handler`);

    const bindings: IndexedBinding[] = (registration.keybindings ?? []).map((binding) => ({
      id,
      chord: normalizeChord(binding.chord),
      when: freezePredicate(binding.when),
    }));

    for (let i = 0; i < bindings.length; i++) {
      const binding = bindings[i]!;
      const candidates = [
        ...(state.bindings.get(binding.chord) ?? []),
        ...bindings.slice(0, i).filter((other) => other.chord === binding.chord),
      ];
      const conflict = candidates.find((other) => predicatesOverlap(binding.when, other.when));
      if (conflict) {
        throw new Error(
          `commands: HOTKEY CONFLICT — '${binding.chord}' can select both ${conflict.id} and ${id}`,
        );
      }
    }

    const frozenBindings = freezeObject(bindings.map((binding) => freezeObject({
      chord: binding.chord,
      when: binding.when,
    })));
    const frozenCapabilities = freezeObject([...(registration.requiredCapabilities ?? [])]);
    const projections = freezeProjections(registration.projections);
    const menu = projections.menu?.[0] ?? '';
    const undoScope = freezeUndoScope(registration.undoScope);
    const projection: CommandProjection = freezeObject({
      id,
      label: registration.label,
      icon: registration.icon,
      effect: registration.effect,
      undoScope,
      native: registration.native ?? false,
      projections,
      requiredCapabilities: frozenCapabilities,
      keybindings: frozenBindings,
      menu,
      defaultKey: frozenBindings.find((binding) => Object.keys(binding.when ?? {}).length === 0)?.chord
        ?? frozenBindings[0]?.chord,
      undoable: registration.undoScope !== 'none',
    });

    state.commands.set(id, {
      projection,
      validateArgs: registration.validateArgs as (args: unknown) => ArgsValidation<unknown>,
      isEnabled: registration.isEnabled as ((ctx: CommandGuardContext<unknown>) => Enablement) | undefined,
      handler: handler as CommandHandler<unknown, unknown>,
      outcomePhase: registration.outcomePhase ?? 'applied',
    });
    for (const binding of bindings) {
      const list = state.bindings.get(binding.chord) ?? [];
      list.push(binding);
      state.bindings.set(binding.chord, list);
    }
    state.effectiveBindings.set(id, bindings);
    return projection;
  }

  command(id: string): CommandProjection | undefined {
    return stateFor(this).commands.get(id)?.projection;
  }

  list(): readonly CommandProjection[] {
    return freezeObject([...stateFor(this).commands.values()].map((entry) => entry.projection));
  }

  byMenu(menu: Menu): readonly CommandProjection[] {
    return freezeObject(this.list().filter((command) => command.projections.menu?.[0] === menu));
  }

  resolveChord(chord: string, mode: CommandMode = {}): CommandProjection | undefined {
    const normalized = tryNormalizeChord(chord);
    if (normalized == null) return undefined;
    const matches = (stateFor(this).bindings.get(normalized) ?? [])
      .filter((binding) => predicateMatches(binding.when, mode));
    if (matches.length !== 1) return undefined;
    return this.command(matches[0]!.id);
  }

  hotkeyFor(id: string): string {
    return stateFor(this).effectiveBindings.get(id)?.[0]?.chord ?? '';
  }

  rebind(id: string, chord: string): RebindResult {
    const state = stateFor(this);
    if (!state.commands.has(id)) return { ok: false, conflict: `no command '${id}'` };
    const normalized = tryNormalizeChord(chord);
    if (normalized == null) return { ok: false, conflict: `'${chord}' is not a valid chord` };

    const conflict = (state.bindings.get(normalized) ?? []).find((binding) => binding.id !== id);
    if (conflict) return { ok: false, conflict: `'${normalized}' is already bound to ${conflict.id}` };

    for (const [boundChord, bindings] of state.bindings) {
      const remaining = bindings.filter((binding) => binding.id !== id);
      if (remaining.length) state.bindings.set(boundChord, remaining);
      else state.bindings.delete(boundChord);
    }
    const binding: IndexedBinding = { id, chord: normalized, when: freezePredicate(undefined) };
    state.bindings.set(normalized, [binding]);
    state.effectiveBindings.set(id, [binding]);
    state.overridden.add(id);
    return { ok: true };
  }

  exportHotkeys(): Record<string, string> {
    const state = stateFor(this);
    const result: Record<string, string> = {};
    for (const id of state.overridden) result[id] = state.effectiveBindings.get(id)?.[0]?.chord ?? '';
    return result;
  }

  loadHotkeys(saved: Record<string, string> | null | undefined): void {
    for (const [id, chord] of Object.entries(saved ?? {})) {
      if (typeof chord === 'string') this.rebind(id, chord);
    }
  }
}

export interface CommandInvocation {
  invocationId: string;
  commandId: string;
  args: unknown;
  source: CommandSource;
  /** Stable authored-action identity. Action/project-action commands default
   * this to invocationId; controls may provide it to correlate undo/redo. */
  actionId?: string;
  origin?: string;
  causedBy?: string;
}

interface CommandOutcomeBase {
  readonly invocationId: string;
  readonly commandId: string;
  readonly source: CommandSource;
  readonly origin?: string;
  readonly causedBy?: string;
}

export interface CommandAppliedOutcome<Result = unknown> extends CommandOutcomeBase {
  readonly status: 'applied';
  readonly phase: 'applied' | 'undone' | 'redone';
  readonly effect: CommandEffect;
  readonly undoScope: UndoScope;
  readonly actionId?: string;
  readonly result: Result;
}

export type CommandRejectionCode =
  | 'unknown-command'
  | 'invalid-args'
  | 'disabled'
  | 'unauthorized'
  | 'handler-failed';

export interface CommandRejectedOutcome extends CommandOutcomeBase {
  readonly status: 'rejected';
  readonly phase: 'rejected';
  readonly code: CommandRejectionCode;
  readonly reason: string;
}

export type CommandOutcome<Result = unknown> = CommandAppliedOutcome<Result> | CommandRejectedOutcome;

export interface CapabilityContext {
  readonly commandId: string;
  readonly invocationId: string;
  readonly origin?: string;
}

export interface CommandAuthorityOptions {
  hasCapability?(capability: string, context: CapabilityContext): boolean;
  /** One authority-owned publication seam for durable logs, replication, and
   * diagnostics. It is attempted exactly once for every invocation outcome. */
  outcomeSink?(outcome: CommandOutcome): void;
}

function reject(invocation: CommandInvocation, code: CommandRejectionCode, reason: string): CommandRejectedOutcome {
  return freezeObject({
    invocationId: invocation.invocationId,
    commandId: invocation.commandId,
    source: invocation.source,
    origin: invocation.origin,
    causedBy: invocation.causedBy,
    status: 'rejected' as const,
    phase: 'rejected' as const,
    code,
    reason,
  });
}

/** The only execution entrance. Invocation source is copied to the outcome for
 * audit purposes but is deliberately withheld from guards and handlers, so it
 * cannot select a second implementation. */
export class CommandAuthority {
  constructor(
    private readonly registry: CommandRegistry,
    private readonly options: CommandAuthorityOptions = {},
  ) {}

  private finish<Result>(outcome: CommandOutcome<Result>): CommandOutcome<Result> {
    try {
      this.options.outcomeSink?.(outcome);
    } catch {
      // Outcome observation must not turn an already-applied command into a
      // second outcome or run its handler again. Production sinks own their
      // own failure diagnostics and retry policy.
    }
    return outcome;
  }

  invoke<Result = unknown>(invocation: CommandInvocation): CommandOutcome<Result> {
    const record = commandRecord(this.registry, invocation.commandId);
    if (!record) return this.finish(reject(invocation, 'unknown-command', `no command '${invocation.commandId}'`));

    let validation: ArgsValidation<unknown>;
    try {
      validation = record.validateArgs(invocation.args);
    } catch (error) {
      return this.finish(reject(invocation, 'invalid-args', `argument validation failed: ${errorMessage(error)}`));
    }
    if (!validation.ok) return this.finish(reject(invocation, 'invalid-args', validation.reason));

    const actionId = invocation.actionId ??
      (record.projection.effect === 'action' || record.projection.effect === 'project-action'
        ? invocation.invocationId
        : undefined);
    const context: CommandGuardContext<unknown> = freezeObject({
      invocationId: invocation.invocationId,
      actionId,
      commandId: invocation.commandId,
      args: validation.value,
      origin: invocation.origin,
      causedBy: invocation.causedBy,
    });

    for (const capability of record.projection.requiredCapabilities) {
      const allowed = this.options.hasCapability?.(capability, {
        commandId: invocation.commandId,
        invocationId: invocation.invocationId,
        origin: invocation.origin,
      }) ?? false;
      if (!allowed) return this.finish(reject(invocation, 'unauthorized', `missing capability '${capability}'`));
    }

    if (record.isEnabled) {
      let enablement: Enablement;
      try {
        enablement = record.isEnabled(context);
      } catch (error) {
        return this.finish(reject(invocation, 'disabled', `enablement check failed: ${errorMessage(error)}`));
      }
      const enabled = typeof enablement === 'boolean' ? enablement : enablement.enabled;
      if (!enabled) {
        const reason = typeof enablement === 'boolean' ? undefined : enablement.reason;
        return this.finish(reject(invocation, 'disabled', reason ?? `command '${invocation.commandId}' is disabled`));
      }
    }

    try {
      const result = record.handler(context) as Result;
      return this.finish(freezeObject({
        invocationId: invocation.invocationId,
        commandId: invocation.commandId,
        source: invocation.source,
        origin: invocation.origin,
        causedBy: invocation.causedBy,
        status: 'applied' as const,
        phase: record.outcomePhase,
        effect: record.projection.effect,
        undoScope: record.projection.undoScope,
        ...(actionId == null ? {} : { actionId }),
        result,
      }));
    } catch (error) {
      return this.finish(reject(invocation, 'handler-failed', errorMessage(error)));
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ── Compatibility facade over one default instance ─────────────────────────

export interface CommandContext {
  targets?: TargetRef[];
  args?: Record<string, unknown>;
}

/** Original registration shape. The returned value is now a projection and no
 * longer leaks `run`; execution must use runCommand / CommandAuthority.invoke. */
export interface CommandDef {
  id: string;
  menu: Menu;
  label: string;
  icon: string;
  defaultKey?: string;
  undoable: boolean;
  native: boolean;
  run(ctx: CommandContext): void;
}

const DEFAULT_REGISTRY = new CommandRegistry();
const DEFAULT_AUTHORITY = new CommandAuthority(DEFAULT_REGISTRY);
let legacyInvocationSequence = 0;

export function defineCommand(def: CommandDef): CommandProjection {
  return DEFAULT_REGISTRY.register<CommandContext, void>({
    id: def.id,
    label: def.label,
    icon: def.icon,
    effect: def.undoable ? 'action' : 'report-only',
    undoScope: def.undoable ? { kind: 'document' } : 'none',
    native: def.native,
    projections: { menu: [def.menu], palette: true },
    keybindings: def.defaultKey ? [{ chord: def.defaultKey }] : [],
    validateArgs: (args) => ({ ok: true, value: (args ?? {}) as CommandContext }),
  }, (ctx) => def.run(ctx.args));
}

export function commandById(id: string): CommandProjection | undefined {
  return DEFAULT_REGISTRY.command(id);
}

export function commandsByMenu(menu: Menu): readonly CommandProjection[] {
  return DEFAULT_REGISTRY.byMenu(menu);
}

export function resolveHotkey(keyChord: string, mode: CommandMode = {}): CommandProjection | undefined {
  return DEFAULT_REGISTRY.resolveChord(keyChord, mode);
}

export function runCommand(id: string, ctx: CommandContext = {}): void {
  const outcome = DEFAULT_AUTHORITY.invoke({
    invocationId: `legacy:${++legacyInvocationSequence}`,
    commandId: id,
    args: ctx,
    source: 'automation',
  });
  if (outcome.status === 'rejected') throw new Error(`commands: ${outcome.reason}`);
}

export function hotkeyFor(id: string): string {
  return DEFAULT_REGISTRY.hotkeyFor(id);
}

export function registeredCommands(): readonly CommandProjection[] {
  return DEFAULT_REGISTRY.list();
}

export type RebindResult = { ok: true } | { ok: false; conflict: string };

export function rebindHotkey(id: string, keyChord: string): RebindResult {
  return DEFAULT_REGISTRY.rebind(id, keyChord);
}

export function exportHotkeys(): Record<string, string> {
  return DEFAULT_REGISTRY.exportHotkeys();
}

export function loadHotkeys(saved: Record<string, string> | null | undefined): void {
  DEFAULT_REGISTRY.loadHotkeys(saved);
}
