// editor/shell/destinations.ts — WHERE YOU CAN GO (req_4464).
//
// The editor had documents but no DESTINATIONS. You could end up in the model
// studio, the animation foundry or the material lab — but only sideways, by
// clicking a model in the asset tree or finding the right row inside the
// Globals menu. There was no front door to any of them, and the top-right of
// the chrome had grown into an undifferentiated row of buttons (a book, a map
// pill, Editor, Play) that mixed three unrelated jobs together.
//
// A DESTINATION is a place you work, not a document you happen to have open.
// One strip in the chrome lists them all, each one labelled, keyed, and lit
// when you are standing in it — the same idea as a DCC's workspace tabs and as
// V24's "mode-switch = alt-tab instant action-bar strip (F1..F6)" ruling.
//
// The strip answers "where am I working". The map pill and the Editor/Play
// toggle answer "which map" and "which route", so they keep their own group at
// the far right, beside the window controls. Three jobs, three groups.
//
// SUBJECT RULE: a destination that needs a subject and has none does NOT do
// nothing — it lands on Home filtered to that subject, which is where the
// recents and favorites with thumbnails live. Every destination always goes
// somewhere.
import type { WorkspaceDocument, WorkspaceDocumentKind } from '../data/types';
import {
  ANIMATION_DOCUMENT_ID,
  HOME_DOCUMENT_ID,
  PLAYTEST_DOCUMENT_ID,
  WORLD_BIBLE_DOCUMENT_ID,
  WORLD_DOCUMENT_ID,
} from '../data/documents';

export type DestinationId = 'home' | 'world' | 'model' | 'motion' | 'material' | 'bible' | 'playtest';

/** What Home filters to when a destination cannot open without one. */
export type SubjectKind = 'model' | 'material' | 'map' | null;

export type Destination = {
  id: DestinationId;
  /** The name on the strip. A place, never a verb. */
  label: string;
  icon: string;
  /** Function key that goes here. F1..F7, in strip order. */
  key: string;
  /** What it needs before it can open; null destinations always open. */
  needs: SubjectKind;
  /** One line for the tooltip — what you actually do there. */
  does: string;
};

export const DESTINATIONS: readonly Destination[] = [
  { id: 'home', label: 'Home', icon: 'Home', key: 'F1', needs: null, does: 'recent work, favorites, and the map you were in' },
  { id: 'world', label: 'World', icon: 'Globe2', key: 'F2', needs: null, does: 'build and paint the map' },
  { id: 'model', label: 'Model', icon: 'Boxes', key: 'F3', needs: 'model', does: 'edit a mesh — parts, topology, UV, paint, rig' },
  { id: 'motion', label: 'Motion', icon: 'Clapperboard', key: 'F4', needs: null, does: 'capture and generate animation on the rig' },
  { id: 'material', label: 'Material', icon: 'FlaskConical', key: 'F5', needs: 'material', does: 'build a material recipe and its colour takes' },
  { id: 'playtest', label: 'Playtest', icon: 'Gamepad2', key: 'F6', needs: null, does: 'drop into this world on foot with live globals' },
  { id: 'bible', label: 'Bible', icon: 'BookOpen', key: 'F7', needs: null, does: 'the world knowledge index' },
];

export function destinationById(id: string): Destination | null {
  return DESTINATIONS.find((destination) => destination.id === id) ?? null;
}

/** F-key → destination. The strip's own labels advertise these, so the key a
 *  tooltip shows is the key that fires (the keymap.ts law). */
export function destinationForKey(key: string): Destination | null {
  const upper = key.toUpperCase();
  return DESTINATIONS.find((destination) => destination.key === upper) ?? null;
}

/**
 * Which destination the OPEN DOCUMENT means you are standing in.
 *
 * Derived from the live document rather than stored, so the strip can never
 * disagree with the stage — closing a tab or switching one moves the highlight
 * without a second piece of state to keep in sync.
 */
export function activeDestination(document: WorkspaceDocument | null): DestinationId | null {
  if (!document) return null;
  switch (document.id) {
    case HOME_DOCUMENT_ID: return 'home';
    case WORLD_DOCUMENT_ID: return 'world';
    case ANIMATION_DOCUMENT_ID: return 'motion';
    case PLAYTEST_DOCUMENT_ID: return 'playtest';
    case WORLD_BIBLE_DOCUMENT_ID: return 'bible';
    default: break;
  }
  const byKind: Partial<Record<WorkspaceDocumentKind, DestinationId>> = {
    model: 'model',
    material: 'material',
    facade: 'material',
    world: 'world',
  };
  return byKind[document.kind] ?? null;
}

/**
 * The already-open document a destination should return you to, if any.
 *
 * Going to Model when a model is already open must land on THAT model, not on
 * a picker — a destination you have already used is a place you go back to.
 * Most-recently-activated wins, which is what `order` carries (the caller
 * passes the tab list; later entries are more recent openings).
 */
export function openDocumentForDestination(
  destination: DestinationId,
  documents: readonly WorkspaceDocument[],
  preferredId: string | null,
): WorkspaceDocument | null {
  const matches = documents.filter((document) => activeDestination(document) === destination);
  if (matches.length === 0) return null;
  const preferred = matches.find((document) => document.id === preferredId);
  return preferred ?? matches[matches.length - 1]!;
}

/** The recent-history key family a destination's subject uses. */
export function recentKeyPrefixFor(subject: SubjectKind): string | null {
  if (subject === 'model') return 'model:';
  if (subject === 'material') return 'asset:';
  return null;
}

/** The newest recent-history entry a destination could open, or null when the
 *  user has never opened one of those. */
export function newestRecentFor(subject: SubjectKind, recentKeys: readonly string[]): string | null {
  const prefix = recentKeyPrefixFor(subject);
  if (!prefix) return null;
  const hit = recentKeys.find((key) => key.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}
