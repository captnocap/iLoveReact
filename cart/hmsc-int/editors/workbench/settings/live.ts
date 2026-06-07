// editors/workbench/settings/live.ts — the SETTINGS store's LIVE singleton
// (WBSET9-0606; the paint/live.ts split: store.ts stays P4-bundleable, this
// module touches the editor singletons).
//
// Wiring parity with SettingsRoute.tsx:67-74: the source opens its OWN V20
// session on the 'tuning' channel ('/workbench' route id), error captured —
// a corrupt sessions stream leaves the registry editable (writes still land
// in the live tables) with the store-unavailable warning surfaced, exactly
// like the route. Coexists with /settings until the flip: same registry,
// same values, additive.

import { editorChannel } from '../../store';
import { editorSessions, type RouteSession, type SessionsState } from '../../sessions';
import { editorTunables, tuningStream, type TuningEvent } from '../../tunables';
import { createSettingsStore, type SettingsStore } from './store';

let live: SettingsStore | null = null;

export function settingsWorkbenchStore(): SettingsStore {
  if (live) return live;
  let session: RouteSession<TuningEvent> | null = null;
  let error: string | null = null;
  try {
    session = editorSessions().open('/workbench', editorChannel(tuningStream));
  } catch (e: any) {
    error = String(e?.message ?? e);
  }
  live = createSettingsStore({
    tunables: editorTunables(),
    session,
    error,
    bus: (): SessionsState | null => {
      try { return editorSessions().state(); } catch { return null; }
    },
  });
  return live;
}
