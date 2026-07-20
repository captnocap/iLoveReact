// Pure editing rules for brush readouts. Kept outside React so the interaction
// can be meaning-tested without mounting the host TextInput.

/** Recover what the user inserted into a controlled input. On the first edit
 * after a click, that insertion becomes the whole draft, giving instrument-like
 * “click, type, Enter” behavior regardless of where the host placed the cursor. */
export function replacementDraftAfterEdit(previous: string, next: string): string {
  if (previous === next) return next;
  let prefix = 0;
  const prefixLimit = Math.min(previous.length, next.length);
  while (prefix < prefixLimit && previous[prefix] === next[prefix]) prefix += 1;

  let suffix = 0;
  const suffixLimit = Math.min(previous.length - prefix, next.length - prefix);
  while (
    suffix < suffixLimit
    && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) suffix += 1;

  return next.slice(prefix, next.length - suffix);
}

/** Parse an Enter commit and clamp it to the control's public range. */
export function parseClampedNumericDraft(draft: string, min: number, max: number): number | null {
  const value = Number(draft.trim());
  if (!Number.isFinite(value)) return null;
  return Math.max(min, Math.min(max, value));
}
