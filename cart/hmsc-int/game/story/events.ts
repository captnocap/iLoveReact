// game/story/events.ts — the narrative event vocabulary + the log (V22/V20).
//
// THE DEFERRED HALF OF THE PERCEPTION CAPTURE: "MurderEvent — the event
// vocabulary belongs to story/missions; the Case references events by id"
// (perception.CAPTURE.md). This is that vocabulary. Captured from
// cart/hmsc/events/gameEvents.ts (record/publish/provenance machinery) +
// cart/hmsc/design.ts (HmscGameEvent / GameEventLogState) + cart/scape's
// MurderEvent consequence record.
//
// V22's doctrine makes the log load-bearing: the protagonist is EVENT-SOURCED
// — relationships, intros, and every story fact accumulate ONLY from
// witnessed in-log events. A story system that knows something with no event
// behind it is a bug (PROTECT THE ZERO).
//
// PURITY (the perception precedent — inert returns, nothing dispatches):
// recordEvent appends and returns; it never touches a bus. The CHANNEL NAMES
// an event publishes to are pure data (channelsFor) — the shell/loop owns the
// actual busEmit, exactly as it owns perception's event dispatch. One
// deliberate divergence from the hmsc reference: occurredAt is an INPUT, not
// a Date.now() call inside — the log is a pure function of what it is told
// (V20 determinism; tests pass fixed stamps).

import type { VisualSignature } from '../perception';
import { STORY_TUNING } from './tuning';

export type StoryEventRefKind =
  | 'player' | 'npc' | 'entity' | 'world' | 'cell' | 'command' | 'lab' | 'story' | 'system';

export type StoryEventRef = {
  kind: StoryEventRefKind;
  id: string;
  label?: string;
};

export type StoryEvent = {
  id: string;                          // `${tuning.eventIdPrefix}_%06d` — what the Case references
  serial: number;                      // monotonic; the log's order
  occurredAt: string;                  // caller-supplied stamp (ISO in the live game)
  type: string;                        // dot-namespaced: 'lab.entered', 'story.flag.set', 'murder.committed'
  source: string;                      // which system recorded it
  actor?: StoryEventRef;
  subject?: StoryEventRef;
  target?: StoryEventRef;
  parentId?: string;                   // provenance — the event this one was derived from
  tags: string[];
  payload: Record<string, unknown>;
};

export type StoryEventInput = {
  type: string;
  source: string;
  occurredAt: string;
  actor?: StoryEventRef;
  subject?: StoryEventRef;
  target?: StoryEventRef;
  parentId?: string;
  tags?: string[];
  payload?: Record<string, unknown>;
};

export type StoryEventLog = {
  nextSerial: number;
  recent: StoryEvent[];                // ring — capped at tuning.recentEventCap
};

export function createEventLog(): StoryEventLog {
  return { nextSerial: 1, recent: [] };
}

function eventId(serial: number): string {
  return `${STORY_TUNING.eventIdPrefix}_${serial.toString().padStart(6, '0')}`;
}

/** Deep-copy the payload so the log can never be mutated from outside
 *  (the hmsc safePayload rule); unserializable payloads are flagged, not thrown. */
function safePayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!payload) return {};
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch {
    return { unserializable: true };
  }
}

export type RecordedEvent = { log: StoryEventLog; event: StoryEvent };

/** Append one event: assigns id + serial, stamps nothing itself. Pure. */
export function recordEvent(log: StoryEventLog, input: StoryEventInput): RecordedEvent {
  if (!input.type) throw new Error('story: an event needs a type');
  if (!input.source) throw new Error(`story: event '${input.type}' needs a source`);
  if (typeof input.occurredAt !== 'string') {
    throw new Error(`story: event '${input.type}' needs an occurredAt stamp (the caller owns time)`);
  }
  const serial = log.nextSerial;
  const event: StoryEvent = {
    id: eventId(serial),
    serial,
    occurredAt: input.occurredAt,
    type: input.type,
    source: input.source,
    ...(input.actor ? { actor: input.actor } : {}),
    ...(input.subject ? { subject: input.subject } : {}),
    ...(input.target ? { target: input.target } : {}),
    ...(input.parentId ? { parentId: input.parentId } : {}),
    tags: input.tags ? [...input.tags] : [],
    payload: safePayload(input.payload),
  };
  return {
    log: {
      nextSerial: serial + 1,
      recent: [...log.recent, event].slice(-STORY_TUNING.recentEventCap),
    },
    event,
  };
}

export function findEvent(log: StoryEventLog, id: string): StoryEvent | undefined {
  return log.recent.find((event) => event.id === id);
}

// ── publication as data (the shell wires the bus) ────────────────────────────

/** Every channel this event publishes to — the hmsc fan-out, returned as
 *  names: root, per-type, per-actor, per-subject, per-tag. */
export function channelsFor(event: StoryEvent): string[] {
  const prefix = STORY_TUNING.channelPrefix;
  const channels = [`${prefix}:event`, `${prefix}:event:${event.type}`];
  if (event.actor) channels.push(`${prefix}:actor:${event.actor.kind}:${event.actor.id}`);
  if (event.subject) channels.push(`${prefix}:subject:${event.subject.kind}:${event.subject.id}`);
  for (const tag of event.tags) channels.push(`${prefix}:tag:${tag}`);
  return channels;
}

/** Host-bus importance by type family (the gameEvents constants, now P2). */
export function eventImportance(event: StoryEvent): number {
  const importance = STORY_TUNING.importance;
  if (event.type.startsWith('story.')) return importance.story;
  if (event.type.includes('trigger') || event.type.startsWith('lab.')) return importance.trigger;
  if (event.type.startsWith('command.')) return importance.command;
  return importance.default;
}

// ── the murder record (scape's consequence chain, anchored to the log) ───────
//
// scape design.ts's MurderEvent, recast as an event TYPE: the structured
// consequence fields ride the payload, the victim is the subject, and the id
// the recorder assigns is exactly what WitnessMemory.eventId and Case.events
// reference (game/perception.ts — already captured). Body discovery state is
// a later event with parentId provenance, not a mutated record.

export type MurderDetails = {
  victimId: string;
  murderKey: string;                   // MurderType key — the consequence profile
  position: { x: number; z: number };  // hmsc world meters (the perception convention)
  zone: string;
  perpetratorSignature: VisualSignature;
  witnesses: string[];                 // npc ids with line-of-sight at the moment
};

export function murderEventInput(
  details: MurderDetails,
  occurredAt: string,
  source: string = 'story.consequences',
): StoryEventInput {
  return {
    type: 'murder.committed',
    source,
    occurredAt,
    subject: { kind: 'npc', id: details.victimId },
    tags: ['murder', 'story'],
    payload: { ...details },
  };
}
