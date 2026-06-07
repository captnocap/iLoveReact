// editors/workbench/tone.ts — name → stable studio tone (WBSET9-0606).
// The SettingsRoute.tsx:52-58 channel-tone hash, shared: the logs stream's
// stripes/chips and the settings rig's accents key the same way, so one
// channel reads as one color everywhere. Display only.

import { accentFor } from '../../shell/workbench.cls';

const TONES = ['primary', 'info', 'warning', 'success', 'error', 'accentTeal'];

/** a stable accent color for a channel/system name (display only) */
export function toneFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return accentFor(TONES[hash % TONES.length]);
}
