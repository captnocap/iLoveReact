// Plan-route chat store — module-level so the page (which claims the
// InputStrip) and the rail (which renders the transcript in place of
// the assistant chat) read the same state.
//
// Two stores live here:
//   - chat turns (transcript)
//   - active draft target ({ ref, label }) — when set, the InputStrip
//     onSubmit stages a comment instead of talking to the planner
//
// The plan page wires the InputStrip claim's onSubmit through these,
// and PlanChatRail subscribes to render the transcript + ACTIVE
// INPUT pill.

import * as React from 'react';

export interface ChatTurn {
  id: string;
  author: 'user' | 'planner';
  body: string;
  ts: number;
}

// ── Chat turns ────────────────────────────────────────────────────

let _turns: ChatTurn[] = [];
const _turnSubs = new Set<() => void>();
function _notifyTurns(): void { for (const s of _turnSubs) s(); }

export function getTurns(): ChatTurn[] { return _turns; }

export function appendTurn(t: ChatTurn): void {
  _turns = _turns.concat([t]);
  _notifyTurns();
}

export function clearTurns(): void {
  if (_turns.length === 0) return;
  _turns = [];
  _notifyTurns();
}

function _subTurns(fn: () => void): () => void {
  _turnSubs.add(fn);
  return () => { _turnSubs.delete(fn); };
}

export function useChatTurns(): ChatTurn[] {
  return React.useSyncExternalStore(_subTurns, getTurns, getTurns);
}

// ── Active draft target ──────────────────────────────────────────

export interface DraftTarget { ref: string; label: string }

let _draft: DraftTarget | null = null;
const _draftSubs = new Set<() => void>();
function _notifyDraft(): void { for (const s of _draftSubs) s(); }

export function getDraft(): DraftTarget | null { return _draft; }

export function setDraft(d: DraftTarget | null): void {
  if (_draft?.ref === d?.ref) return;
  _draft = d;
  _notifyDraft();
}

function _subDraft(fn: () => void): () => void {
  _draftSubs.add(fn);
  return () => { _draftSubs.delete(fn); };
}

export function useDraft(): DraftTarget | null {
  return React.useSyncExternalStore(_subDraft, getDraft, getDraft);
}
