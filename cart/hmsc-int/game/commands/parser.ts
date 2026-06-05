// game/commands/parser.ts — command-line tokenizing + value parsing.
//
// The dialect hmsc's console speaks today (cart/hmsc/commands/parser.ts is the
// behavior reference, rewritten fresh per V17-TRIAGE): whitespace splits
// tokens, single or double quotes protect spaces, and values read as
// true/false/null/number/JSON before falling back to the raw string.

export function tokenizeCommandLine(line: string): string[] {
  const tokens: string[] = [];
  let token = '';
  let quote: '"' | "'" | null = null;

  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else token += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (token.length > 0) {
        tokens.push(token);
        token = '';
      }
      continue;
    }
    token += ch;
  }
  if (token.length > 0) tokens.push(token);
  return tokens;
}

export function parseCommandValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && raw.trim() !== '') return numeric;
  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}
