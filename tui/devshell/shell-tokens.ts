// Devshell theme tokens.
//
// Pushed into the runtime theme store on shell mount so style props can
// reference 'theme:bg', 'theme:ink', etc. — same convention as the
// gallery, no hex literals scattered through the chrome.
//
// The flat namespace mirrors gallery/themes (bg/bg1/bg2, ink/inkDim,
// rule, accent, ok/warn/bad). When TUI gains a theme bridge that maps
// tokens to ANSI palette indices these names are what it'll resolve.

import { setTokens } from '@reactjit/runtime/theme';

export const SHELL_TOKENS: Record<string, string> = {
  bg:          '#0b1020',
  bg1:         '#111827',
  bg2:         '#0f172a',
  pinBg:       '#1e293b',

  ink:         '#e5e7eb',
  inkDim:      '#94a3b8',
  inkDimmer:   '#64748b',
  inkFaint:    '#475569',

  rule:        '#1f2937',
  ruleBright:  '#334155',

  accent:      '#fbbf24',
  ok:          '#34d399',
  warn:        '#fbbf24',
  bad:         '#f87171',
  info:        '#60a5fa',
};

let installed = false;
export function installShellTokens(): void {
  if (installed) return;
  installed = true;
  setTokens(SHELL_TOKENS);
}
