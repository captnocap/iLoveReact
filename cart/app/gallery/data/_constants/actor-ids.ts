// Reserved numeric actor IDs.
//
// Per the supervisor architecture spec: 0/1/2/3 are not table rows, they
// are constants. Use these instead of free strings whenever code needs
// to discriminate "who is acting" without joining to an Assistant /
// Supervisor / Worker row.
//
// 0 = no actor identity (bare prompt — system probes, eval harnesses)
// 1 = Assistant   — long-term identity, can wear a Character
// 2 = Supervisor  — task-local enforcer
// 3 = Worker      — disposable executor
//
// New actor classes do NOT extend this enum. They go in their own table
// (Assistant, Supervisor, Worker have their own rows; Character attaches
// to Assistant). The numeric IDs are only the four reserved roles.

export const RESERVED_ACTOR_IDS = {
  none: 0,
  assistant: 1,
  supervisor: 2,
  worker: 3,
} as const;

export type ReservedActorId = (typeof RESERVED_ACTOR_IDS)[keyof typeof RESERVED_ACTOR_IDS];

export type ReservedActorRole = keyof typeof RESERVED_ACTOR_IDS;

export const ACTOR_ID_TO_ROLE: Record<ReservedActorId, ReservedActorRole> = {
  0: 'none',
  1: 'assistant',
  2: 'supervisor',
  3: 'worker',
};

export const ROLE_TO_ACTOR_ID: Record<ReservedActorRole, ReservedActorId> =
  RESERVED_ACTOR_IDS;

/** Throws if the value is not one of 0/1/2/3 — call at boundary points
 *  where the value comes from JSON / IPC and the type cannot be trusted. */
export function assertReservedActorId(v: unknown): ReservedActorId {
  if (v === 0 || v === 1 || v === 2 || v === 3) return v as ReservedActorId;
  throw new Error(`Not a reserved actor id: ${String(v)}`);
}
