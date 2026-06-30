// runtime/attribution/credits.ts — turn the attribution ledger into shippable credits.
// "Accounted for when due" lives here: a human-readable CREDITS.md plus the count of
// still-pending obligations so a build can warn before it ships an unattributed asset.
import { writeFile, mkdir } from '@reactjit/runtime/hooks/fs';
import type { Ledger, Attribution } from './ledger';

export const DEFAULT_CREDITS_PATH = 'cart/hmsc-int/data/CREDITS.md';

export function entries(ledger: Ledger): Attribution[] {
  return Object.values(ledger).sort((a, b) => a.title.localeCompare(b.title));
}

/** How many imported assets still owe an author + license. Zero ⇒ safe to ship. */
export function pendingCount(ledger: Ledger): number {
  return entries(ledger).filter((e) => e.status === 'pending').length;
}

/** Render the ledger as CREDITS.md — third-party imports grouped by license (with the
 *  attribution each one's license demands), original/self-made work in its own section,
 *  and any unresolved obligations called out at the top so they can't ship silently. */
export function renderCredits(ledger: Ledger): string {
  const all = entries(ledger);
  const lines: string[] = ['# Credits & Attributions', ''];

  const pending = all.filter((e) => e.status === 'pending');
  if (pending.length) {
    lines.push(`> ⚠ ${pending.length} asset(s) still need attribution before shipping:`);
    for (const e of pending) lines.push(`> - ${e.title} (${e.file ?? e.id})`);
    lines.push('');
  }

  const imports = all.filter((e) => e.kind === 'import');
  if (imports.length) {
    lines.push('## Third-party assets', '');
    const byLicense = new Map<string, Attribution[]>();
    for (const e of imports) {
      const k = e.license.trim() || '(license unspecified)';
      (byLicense.get(k) ?? byLicense.set(k, []).get(k)!).push(e);
    }
    for (const [license, list] of byLicense) {
      lines.push(`### ${license}`, '');
      for (const e of list) {
        const by = e.author.trim() ? ` — by ${e.author.trim()}` : ' — author unknown';
        const src = e.source.trim() ? ` — ${e.source.trim()}` : '';
        lines.push(`- **${e.title}**${by}${src}`);
      }
      lines.push('');
    }
  }

  const studio = all.filter((e) => e.kind === 'studio');
  if (studio.length) {
    lines.push('## Original assets', '');
    for (const e of studio) {
      const by = e.author.trim() ? ` — ${e.author.trim()}` : '';
      lines.push(`- **${e.title}**${by}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/** Write CREDITS.md. Returns {ok, pending} so the caller can warn when pending > 0. */
export function exportCredits(ledger: Ledger, path: string = DEFAULT_CREDITS_PATH): { ok: boolean; pending: number } {
  const slash = path.lastIndexOf('/');
  if (slash > 0) mkdir(path.slice(0, slash));
  const ok = writeFile(path, renderCredits(ledger));
  return { ok, pending: pendingCount(ledger) };
}
