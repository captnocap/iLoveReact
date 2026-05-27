/**
 * triggers — the type surface of the IFTTT DSL.
 *
 *   - KeyName / KeySpec      template-literal types for `key:` triggers
 *   - TriggerString          closed union of all known prefixes + escape hatch
 *   - ActionString           closed union of known action verbs (NO escape
 *                            hatch — typos to a known prefix are rejected)
 *   - PayloadOf<T>           trigger string → payload type
 *   - ComposableTrigger<P>   the value useIFTTT accepts, generic in P
 *   - IFTTTResult<P>         what useIFTTT returns
 *
 * Adding a new fixed-name trigger: extend `IFTTTEventMap` in ./events.ts.
 * Adding a new prefix-family trigger (param-suffixed, e.g. `mything:${id}`):
 * add a case to `PayloadOf` below and a member to `KnownTrigger`.
 *
 * Adding a new action verb: add a case to `ActionString` below (or augment
 * `IFTTTActionMap` from the owning module).
 */

import type { IFTTTEventMap } from './events';

/* eslint-disable @typescript-eslint/consistent-type-definitions */

// ── Key DSL ───────────────────────────────────────────────────────

/** Names accepted on the right side of a key combo. Single ASCII chars
 *  are also valid (e.g. `key:s`, `key:ctrl+a`) — represented via the
 *  generic `string` arm in `KeySpec`. */
export type KeyName =
  | 'backspace' | 'tab' | 'enter' | 'escape' | 'space' | 'delete'
  | 'left' | 'up' | 'right' | 'down'
  | 'home' | 'end' | 'pageup' | 'pagedown' | 'insert'
  | 'f1' | 'f2' | 'f3' | 'f4' | 'f5' | 'f6'
  | 'f7' | 'f8' | 'f9' | 'f10' | 'f11' | 'f12';

export type Modifier = 'ctrl' | 'shift' | 'alt' | 'meta' | 'control' | 'option' | 'cmd' | 'command';

/** A key spec: optional modifier+ chain ending in a key name or single char.
 *  We can't statically enforce "exactly one terminal key" via template
 *  literals without exploding the union, so the right side is `string` and
 *  IntelliSense surfaces the named forms through the alternative arms. */
export type KeySpec =
  | KeyName
  | `${Modifier}+${string}`
  | `${Modifier}+${Modifier}+${string}`
  | `${Modifier}+${Modifier}+${Modifier}+${string}`;

export type KeyTriggerDown = `key:${KeySpec}`;
export type KeyTriggerUp = `key:up:${KeySpec}`;
export type KeyTrigger = KeyTriggerDown | KeyTriggerUp;

export type KeyPayload = {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
};

// ── Timer DSL ─────────────────────────────────────────────────────

export type TimerEveryTrigger = `timer:every:${number}`;
export type TimerOnceTrigger = `timer:once:${number}`;
export type TimerTrigger = TimerEveryTrigger | TimerOnceTrigger;

export type TimerPayload = { at: number; interval?: number; delay?: number };

// ── State DSL ─────────────────────────────────────────────────────

export type StateTrigger = `state:${string}` | `state:${string}:${string}`;

// ── Send/match/count/firsthit/repeat — parameterised channels ────
// Payload is `unknown` because the bus channel can carry anything the
// emitter chose to send. Owning modules can narrow specific channels by
// augmenting `IFTTTEventMap`.

export type MatchTrigger = `match:${string}`;
export type CountTrigger = `count:${string}`;
export type FirsthitTrigger = `firsthit:${string}`;
export type RepeatTrigger = `repeat:${string}`;

export type MatchPayload = {
  channel: string;
  payload: unknown;
  text: string;
  match: string;
  index: number;
  groups?: string[];
};
export type CountPayload = {
  channel: string;
  count: number;
  n: number;
  windowMs: number;
  payload: unknown;
  at: number;
};
export type FirsthitPayload = MatchPayload;
export type RepeatPayload = {
  channel: string;
  current: { text: string; payload: unknown };
  prior: { text: string; payload: unknown };
  similarity: number;
  indexInLookback: number;
};

// ── Claude hook channels ──────────────────────────────────────────

export type ClaudeToolTrigger = `system:claude:${string}`;

// ── Closed-ish trigger surface ────────────────────────────────────
//
// Order matters for PayloadOf: prefix families (key:, timer:, …) match
// before the IFTTTEventMap fixed-name lookup so that `key:ctrl+s` resolves
// to KeyPayload regardless of whether anyone added it to the map.

export type KnownTrigger =
  | keyof IFTTTEventMap
  | KeyTrigger
  | TimerTrigger
  | StateTrigger
  | MatchTrigger
  | CountTrigger
  | FirsthitTrigger
  | RepeatTrigger
  | ClaudeToolTrigger;

/** The full set of strings useIFTTT will accept. The `string & {}` arm is
 *  the well-known escape hatch — it keeps IntelliSense surfacing the
 *  literal union members while still allowing arbitrary cart-defined bus
 *  channels (those resolve through the registry fallback at runtime). */
export type TriggerString = KnownTrigger | (string & {});

// ── Augmentable prefix map ────────────────────────────────────────
//
// Owning modules with parameter-suffix triggers (`proc:ram:<pid>`,
// `fs:change:<path>`, etc.) augment this interface to declare their
// payload. PayloadOf walks the registered prefixes and returns the
// matching one's payload.
//
//   declare module '@reactjit/runtime/hooks/ifttt/types/triggers' {
//     interface IFTTTPrefixMap {
//       'proc:ram:':  { pid: number; percent: number; rss: number };
//       'proc:cpu:':  { pid: number; ticks: number };
//     }
//   }
//
// Distribution-on-conditional means a trigger that prefix-matches more
// than one entry yields a union; the runtime's longest-prefix-wins
// behaviour is not modeled at the type level. Pick non-overlapping
// prefixes if you want a single resolved type.

export interface IFTTTPrefixMap {}

type ResolvePrefix<T extends string, P = keyof IFTTTPrefixMap> =
  P extends string
    ? T extends `${P}${string}`
      ? P extends keyof IFTTTPrefixMap ? IFTTTPrefixMap[P] : never
      : never
    : never;

// ── PayloadOf ─────────────────────────────────────────────────────
//
// Resolution order:
//   1. IFTTTEventMap entry — most specific, augmentable per channel.
//   2. Built-in prefix family — `key:*`, `timer:*`, `match:*`, etc.
//   3. IFTTTPrefixMap entry — augmentable per owning module.
//   4. `unknown` — anything that fell through (raw bus channels).

export type PayloadOf<T extends string> =
  T extends keyof IFTTTEventMap ? IFTTTEventMap[T] :
  T extends KeyTrigger          ? KeyPayload :
  T extends TimerTrigger        ? TimerPayload :
  T extends MatchTrigger        ? MatchPayload :
  T extends CountTrigger        ? CountPayload :
  T extends FirsthitTrigger     ? FirsthitPayload :
  T extends RepeatTrigger       ? RepeatPayload :
  T extends ClaudeToolTrigger   ? IFTTTEventMap['system:claude'] :
  [ResolvePrefix<T>] extends [never] ? unknown :
  ResolvePrefix<T> extends infer R ? R :
  unknown;

// ── Action verbs ──────────────────────────────────────────────────
//
// No `string & {}` here — actions are dispatched through a closed
// registry, so a typo like `state:tggle:foo` should fail at compile
// time. Plugin actions augment `IFTTTActionMap`:
//
//   declare module '@reactjit/runtime/hooks/ifttt/types/triggers' {
//     interface IFTTTActionMap {
//       'proc:kill:': true;
//     }
//   }
//
// The prefix ends with `:` to mark "anything after this is a parameter."
// Exact-match verbs (no parameter) omit the trailing colon.

export interface IFTTTActionMap {
  'state:set:':       true;
  'state:toggle:':    true;
  'send:':            true;
  'log:':             true;
  'clipboard:':       true;
}

/** Expand each `IFTTTActionMap` key into a template-literal arm:
 *    `'state:set:'` → `` `state:set:${string}` ``
 *    `'mount'`      → `'mount'`  (no trailing colon → exact match) */
type ExpandActionPrefix<P> =
  P extends `${string}:` ? `${P}${string}` :
  P extends string ? P :
  never;

export type ActionString = {
  [K in keyof IFTTTActionMap]: ExpandActionPrefix<K>;
}[keyof IFTTTActionMap];

// ── Reactive surface ──────────────────────────────────────────────
//
// Anything with `subscribe(fn)` is an edge source — chains across useIFTTT
// and into composable `all`/`any`/`seq` shapes. The IFTTTResult itself
// satisfies this; so does `IFTTTResult.completed`.

export interface ReactiveEdgeSource<P = unknown> {
  subscribe(fn: (event: P) => void): () => void;
}

/** A level source: window open over time, queryable via `active`. Same
 *  shape as `UseDuringHandle` (intentional — `flow1.action` is a level
 *  source consumable by useDuring with no special casing). */
export interface ReactiveLevelSource {
  readonly active: boolean;
  readonly startedAt: number;
  readonly done: Promise<void>;
  cancel(): void;
}

// ── Composable trigger value ──────────────────────────────────────

/** A trigger value useIFTTT will accept. Generic in the payload type so
 *  function-action callbacks get the right argument. */
export type ComposableTrigger<P> =
  | (TriggerString & {})                            // string leaf
  | (() => boolean)                                 // fn leaf (payload undefined)
  | ReactiveEdgeSource<P>                           // another hook's result / .completed
  | { on: ComposableTrigger<P> | ComposableTrigger<P>[]; when?: () => boolean }
  | { all: ComposableTrigger<P>[] }
  | { any: ComposableTrigger<P>[] }
  | { seq: ComposableTrigger<P>[]; within: number }
  | {
      trigger: ComposableTrigger<P>;
      debounce?: number;
      throttle?: number;
      once?: boolean;
      cooldown?: number;
    };

// ── Hook return shape ─────────────────────────────────────────────
//
// IFTTTResult is three reactive instances in one object — the caller picks
// the temporal semantics by which property they reference:
//
//   flow1            — edge on trigger fire        (subscribe / fired counter)
//   flow1.action     — level while action in flight (UseDuringHandle-shape)
//   flow1.completed  — edge on action settlement   (subscribe)
//
// No default — there is no "the" event for an IFTTT result; you pick.

export interface IFTTTResult<P = unknown> extends ReactiveEdgeSource<P> {
  /** Count of trigger-fire edges since mount. Reading subscribes the host
   *  to re-render on each fire. */
  readonly fired: number;
  /** Payload from the most recent trigger fire. */
  readonly lastEvent: P | undefined;
  /** Epoch ms of the most recent trigger fire. */
  readonly lastFiredAt: number;
  /** Manually fire as if the trigger matched. */
  fire(event?: P): void;

  /** Level source: open while the bound action is in flight.
   *  `flow.action.active` is true between trigger fire and action settle.
   *  Drop straight into `useDuring(flow.action, body)` — no wrapper needed. */
  readonly action: ReactiveLevelSource;

  /** Edge source: fires once when each action settlement happens (sync
   *  actions fire it on the same tick as the trigger edge; async actions
   *  fire it on Promise settle). Carries the original trigger payload. */
  readonly completed: ReactiveEdgeSource<P>;
}
