export function tokenizeCommandLine(line: string): string[] {
  const tokens: string[] = [];
  let token = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        token += ch;
      }
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
    return JSON.parse(raw);
  }
  return raw;
}
