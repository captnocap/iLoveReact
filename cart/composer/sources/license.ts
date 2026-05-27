// license.ts — shared Creative Commons URL parser.
//
// Several providers hand us a CC deed URL rather than a human string
// (Jamendo's license_ccurl, Internet Archive's metadata.licenseurl). This
// maps those URLs to our NormalizedLicense family + permission flags so the
// adapters don't each reimplement the same parsing.

import type { LicenseFamily, NormalizedLicense } from './types';

/** Parse a Creative Commons (or CC0 / public-domain-mark) deed URL into a
 *  NormalizedLicense. Returns family 'unknown' for anything unrecognized so
 *  the UI shows "unknown — verify" rather than assuming permission. */
export function licenseFromCcUrl(url: string | null | undefined): NormalizedLicense {
  const raw = (url ?? '').trim();
  const s = raw.toLowerCase();
  const base = {
    url: raw.startsWith('http') ? raw : null,
    allowsAiTraining: null as boolean | null,
  };

  if (!s) {
    return { family: 'unknown', requiresAttribution: null, allowsCommercial: null, ...base };
  }
  if (s.includes('publicdomain/zero') || s.includes('/cc0')) {
    return { family: 'cc0', requiresAttribution: false, allowsCommercial: true, ...base };
  }
  if (s.includes('publicdomain/mark') || s.includes('publicdomain')) {
    return { family: 'public-domain', requiresAttribution: false, allowsCommercial: true, ...base };
  }
  if (s.includes('/licenses/')) {
    const nc = s.includes('-nc') || s.includes('nc-');
    let family: LicenseFamily = 'cc-by';
    if (s.includes('by-nc-nd')) family = 'cc-by-nc-nd';
    else if (s.includes('by-nc-sa')) family = 'cc-by-nc-sa';
    else if (s.includes('by-nd')) family = 'cc-by-nd';
    else if (s.includes('by-sa')) family = 'cc-by-sa';
    else if (s.includes('by-nc')) family = 'cc-by-nc';
    else if (s.includes('sampling+') || s.includes('sampling')) family = 'cc-sampling-plus';
    else family = 'cc-by';
    return { family, requiresAttribution: true, allowsCommercial: !nc, ...base };
  }
  return { family: 'custom', requiresAttribution: null, allowsCommercial: null, ...base };
}
