// editorbus/event.ts — the authoring-event CONTRACT.
//
// This is the central seam of the whole editor foundation. Every meaningful
// authoring action (place, move, delete, paint, material.slot.fill, compile, …)
// is one of these events, and EVERY foundation system is built against this
// shape: workstream A (the Zig spine) orders and persists them, C (commands)
// emits them, D/E (chunk cache + hot index) consume their `targets` to dirty
// and fold, G (defaults) emits material.* edits through them.
//
// It is DISTINCT from runtime/eventBus.ts — that is the diagnostics/observability
// bus (logging, sampled, fire-and-forget). THIS bus is the source of truth for
// edits, and is built multiplayer-shaped: every event carries an authoritative
// monotonic `seq` and a peer `origin`, so a remote peer's events interleave by
// `seq` and the same log replays identically on every machine. V20 is dead; this
// log + autosave snapshots + backup is its replacement.
//
// The type list is NOT hardcoded here. Each workstream registers its own event
// types once via defineEventType() — the registry is the seam that lets parallel
// workers add events without editing a shared switch.

/** Who produced an event. One stable id per editing peer; `'local'` until a
 *  session/server assigns a real one. Multiplayer ordering keys on (seq, origin). */
export type PeerId = string;

/** Authoritative monotonic order assigned by the bus authority (workstream A).
 *  A freshly-made local event is SEQ_PENDING until the authority confirms it —
 *  optimistic apply uses the pending event, then reconciles when the seq lands. */
export type Seq = number;
export const SEQ_PENDING: Seq = -1;

/** A stable reference to a thing an event affects. This is what makes one edit
 *  cost the same on an empty vs a rich map: the bus carries refs, and D/E turn
 *  refs into dirty chunks + index deltas WITHOUT scanning the world.
 *
 *  `kind` is an open vocabulary owned by the systems that author it
 *  ('piece' | 'tile' | 'prop' | 'material' | 'marker' | 'chunk' | …). `chunk`
 *  refs let an event declare its dirty region directly; object refs are resolved
 *  to chunks by the hot index. */
export interface TargetRef {
  kind: string;
  id: string;
}

/** The one envelope every authoring event shares. `payload` is the per-type
 *  body, described and (optionally) validated by its registered EventTypeDef. */
export interface EditorEvent<P = unknown> {
  /** Authoritative order. SEQ_PENDING on an unconfirmed local/optimistic event. */
  seq: Seq;
  /** Producing peer. */
  origin: PeerId;
  /** Wall-clock ms when produced. Metadata only — `seq` is the authority. */
  ts: number;
  /** Registered event type, e.g. 'piece.place'. */
  type: string;
  /** Everything this event touches; drives dirty-tracking and the hot index. */
  targets: TargetRef[];
  /** Type-specific body. */
  payload: P;
}

/** What a registered event type knows about itself. Kept deliberately small:
 *  the bus stays a deep module behind a narrow surface. */
export interface EventTypeDef<P = unknown> {
  /** Stable type string (the registry key). */
  type: string;
  /** Whether normal undo can invert this via an inverse event. Full historical
   *  rewind is a separate cold path (compiled-chunk history, V31). */
  undoable: boolean;
  /** Compact human label for the console / eventbus dock, e.g. "place Wall Kit". */
  describe: (payload: P, targets: TargetRef[]) => string;
  /** Optional guard run before emit; throw to reject a malformed payload. */
  validate?: (payload: P, targets: TargetRef[]) => void;
}

const REGISTRY = new Map<string, EventTypeDef<any>>();

/** A bound factory for one event type. Workstreams keep this and call it to
 *  produce well-formed (but not-yet-ordered) events. */
export interface EventFactory<P> {
  type: string;
  /** Build a local event: stamps origin + ts, seq = SEQ_PENDING. */
  (payload: P, targets?: TargetRef[]): EditorEvent<P>;
  def: EventTypeDef<P>;
}

/** The current peer id. Set once by the session/server layer (workstream A);
 *  defaults to 'local' so everything works single-peer today. */
let g_origin: PeerId = 'local';
export function setPeerId(id: PeerId): void { g_origin = id || 'local'; }
export function peerId(): PeerId { return g_origin; }

/** Register an event type ONCE (at module load of the owning workstream) and get
 *  back a typed factory. Re-registering the same type is an error — it means two
 *  systems are fighting over one name, which the seam exists to prevent. */
export function defineEventType<P>(def: EventTypeDef<P>): EventFactory<P> {
  if (REGISTRY.has(def.type)) {
    throw new Error(`editorbus: event type '${def.type}' already registered`);
  }
  REGISTRY.set(def.type, def);
  const make = ((payload: P, targets: TargetRef[] = []): EditorEvent<P> => {
    def.validate?.(payload, targets);
    return { seq: SEQ_PENDING, origin: g_origin, ts: Date.now(), type: def.type, targets, payload };
  }) as EventFactory<P>;
  make.type = def.type;
  make.def = def;
  return make;
}

/** Look up a registered type (the console/dock uses this to describe events read
 *  back from the log, which arrive as plain envelopes without their factory). */
export function eventTypeDef(type: string): EventTypeDef | undefined {
  return REGISTRY.get(type);
}

/** Best-effort human label for any event, registered or not. */
export function describeEvent(e: EditorEvent): string {
  const def = REGISTRY.get(e.type);
  if (def) { try { return def.describe(e.payload, e.targets); } catch { /* fall through */ } }
  return e.type;
}

/** All registered type strings — for settings UIs and validation tooling. */
export function registeredEventTypes(): string[] {
  return Array.from(REGISTRY.keys()).sort();
}
