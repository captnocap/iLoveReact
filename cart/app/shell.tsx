// Shell-level UI state for cart/app.
//
// One store lives here: inputClaim. The InputStrip is shared by chat
// and any activity that wants to capture text. Activities call
// `claimInput({...})` in response to a user gesture (clicking a card,
// opening a field). While a claim is held, the strip's onSubmit
// routes to that claim instead of askAssistant() and the strip morphs
// to its full-bottom position. Releasing pops back to the previous
// owner (chat).
//
// Side-rail visibility is NOT stored here — it's derived in ShellBody
// from `(route.path !== '/') || hasChatAny`. That keeps rail-on-home
// gated on the user actually having a chat, so revisiting home after
// poking around in Settings doesn't strand the rail visible.
//
// Plain module-level stores + subscribe pattern, mirroring the theme
// variant store in runtime/theme.tsx.

import * as React from 'react';

// ── Input claim stack ────────────────────────────────────────────────

export interface InputClaim {
  /** Stable id so claim/release pairs survive re-renders. */
  id: string;
  /** Receives the submitted text. Should be sync; the strip awaits the
   *  Promise to clear its draft. */
  onSubmit: (text: string) => void | Promise<void>;
  /** Optional placeholder shown while this claim is active. */
  placeholder?: string;
  /** Called when the claim is released by the strip (Escape, blur,
   *  external releaseClaim()). Lets the activity drop focus / close
   *  affordances. */
  onCancel?: () => void;
}

let _claim: InputClaim | null = null;
const _claimSubs = new Set<() => void>();

function _notifyClaim(): void {
  for (const s of _claimSubs) s();
}

function _subscribeClaim(fn: () => void): () => void {
  _claimSubs.add(fn);
  return () => { _claimSubs.delete(fn); };
}

function _getClaim(): InputClaim | null {
  return _claim;
}

/** Activity-side: take the InputStrip. The previous owner (chat or a
 *  prior claim) is dropped. There's only one slot — claims don't stack
 *  in v1 because no two activities can be visible at once. */
export function claimInput(c: InputClaim): void {
  if (_claim && _claim.id !== c.id && _claim.onCancel) _claim.onCancel();
  _claim = c;
  _notifyClaim();
}

/** Activity-side: release a specific claim by id. No-op if a different
 *  claim is currently held (the activity that pushed it has already
 *  been replaced). */
export function releaseInputClaim(id: string): void {
  if (!_claim || _claim.id !== id) return;
  _claim = null;
  _notifyClaim();
}

/** Read-only accessor for non-React callers (e.g. InputStrip.submit). */
export function getInputClaim(): InputClaim | null {
  return _claim;
}

/** Hook — returns the current claim or null. */
export function useInputClaim(): InputClaim | null {
  return React.useSyncExternalStore(_subscribeClaim, _getClaim, _getClaim);
}

// ── Shelved input ────────────────────────────────────────────────────
//
// User-triggered toggle that collapses the InputStrip into a thin
// handle along its edge. Bound to `Ctrl+\` at the App level. Useful
// when the user wants more screen room without leaving the route or
// killing the chat session — flip the bit, the strip tucks; flip
// back, it returns to whichever slot the route+claim derivation
// places it in.

let _shelved = false;
const _shelvedSubs = new Set<() => void>();
function _notifyShelved(): void { for (const s of _shelvedSubs) s(); }
function _subscribeShelved(fn: () => void): () => void {
  _shelvedSubs.add(fn);
  return () => { _shelvedSubs.delete(fn); };
}
function _getShelved(): boolean { return _shelved; }

export function setInputShelved(value: boolean): void {
  if (_shelved === value) return;
  _shelved = value;
  _notifyShelved();
}
export function toggleInputShelved(): void { setInputShelved(!_shelved); }
export function getInputShelved(): boolean { return _shelved; }
export function useInputShelved(): boolean {
  return React.useSyncExternalStore(_subscribeShelved, _getShelved, _getShelved);
}

// ── HUD insets ───────────────────────────────────────────────────────
//
// Shell publishes the animated bottom (BottomInputBar reserved height)
// and left (SideMenuInput reserved width) insets each render tick. Pages
// consume `useHudInsets()` to apply matching internal padding so their
// content stays clear of the HUD overlays while their bg paints
// edge-to-edge underneath. This is what lets the bar carry transparent
// bg without flashing during the full→side morph — the page bg shows
// through the bar's vacated area.

interface HudInsets { bottom: number; left: number }

let _insets: HudInsets = { bottom: 0, left: 0 };
const _insetSubs = new Set<() => void>();

export function setHudInsets(bottom: number, left: number): void {
  if (_insets.bottom === bottom && _insets.left === left) return;
  _insets = { bottom, left };
  for (const s of _insetSubs) s();
}

function _subscribeInsets(fn: () => void): () => void {
  _insetSubs.add(fn);
  return () => { _insetSubs.delete(fn); };
}

function _getInsets(): HudInsets { return _insets; }

export function useHudInsets(): HudInsets {
  return React.useSyncExternalStore(_subscribeInsets, _getInsets);
}

// Max fraction of the assistant rail that a HUD-promoted page sub-nav
// (settings nav, etc.) can claim at the top of the column. The shell
// resolves this to a pixel height (= viewport_h * fraction) and passes
// it as a prop to the nav — '%'-string maxHeight on a flex child of
// `S.AppSideMenuInput` doesn't resolve through the framework's layout
// engine and the nav collapses to 0. Pair with flexShrink:0 on the
// InputStrip so the chat absorbs any leftover squeeze, not the input.
export const RAIL_SUBNAV_MAX_FRAC = 0.4;

// ── Settings active section ──────────────────────────────────────────
//
// /settings is now multi-section but stays on a single route path. The
// sub-nav (Profile, Preferences, Providers, …) lives at the HUD level —
// it's rendered as a shell-owned rail beside the assistant rail, not
// inside the iframe — so the active section needs a shell-level store
// the page and the HUD nav can both read/write.

let _settingsSection = 'user';
const _sectionSubs = new Set<() => void>();

export function setSettingsSection(value: string): void {
  if (_settingsSection === value) return;
  _settingsSection = value;
  for (const s of _sectionSubs) s();
}

export function getSettingsSection(): string { return _settingsSection; }

function _subscribeSection(fn: () => void): () => void {
  _sectionSubs.add(fn);
  return () => { _sectionSubs.delete(fn); };
}

export function useSettingsSection(): [string, (v: string) => void] {
  const value = React.useSyncExternalStore(_subscribeSection, getSettingsSection);
  return [value, setSettingsSection];
}
