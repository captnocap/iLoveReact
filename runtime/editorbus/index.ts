// editorbus — the authoring eventbus contract + runtime door.
//
// The source of truth for editor edits. Multiplayer-shaped: every event carries
// an authoritative monotonic `seq` and a peer `origin`. Distinct from
// runtime/eventBus.ts (diagnostics). See event.ts for the envelope + the
// defineEventType() registration seam; bus.ts for dispatch/subscribe.
export * from './event';
export * from './bus';
