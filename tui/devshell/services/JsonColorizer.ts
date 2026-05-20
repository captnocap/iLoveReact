const JSON_COLORS = {
  key:   '#60a5fa',
  str:   '#34d399',
  num:   '#fbbf24',
  bool:  '#c084fc',
  punct: '#64748b',
};

interface JsonTokState { inString: boolean; }

export function colorizeJsonLines(lines: string[]): { text: string; color: string }[][] {
  const state: JsonTokState = { inString: false };
  return lines.map(line => colorizeJsonLine(line, state));
}

function colorizeJsonLine(
  line: string,
  state: JsonTokState,
): { text: string; color: string }[] {
  const tokens: { text: string; color: string }[] = [];
  const n = line.length;
  let i = 0;

  if (state.inString) {
    let j = 0;
    while (j < n) {
      if (line[j] === '\\' && j + 1 < n) { j += 2; continue; }
      if (line[j] === '"') { j++; state.inString = false; break; }
      j++;
    }
    if (j > 0) tokens.push({ text: line.slice(0, j), color: JSON_COLORS.str });
    i = j;
    if (state.inString) return tokens;
  }

  while (i < n) {
    const c = line[i];

    if (c === '"') {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (line[j] === '\\' && j + 1 < n) { j += 2; continue; }
        if (line[j] === '"') { j++; closed = true; break; }
        j++;
      }
      let isKey = false;
      if (closed) {
        let k = j;
        while (k < n && (line[k] === ' ' || line[k] === '\t')) k++;
        isKey = k < n && line[k] === ':';
      }
      tokens.push({ text: line.slice(i, j), color: isKey ? JSON_COLORS.key : JSON_COLORS.str });
      if (!closed) state.inString = true;
      i = j;
      continue;
    }

    if ((c === '-' && /[0-9]/.test(line[i + 1] ?? '')) || /[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[0-9.eE+\-]/.test(line[j])) j++;
      tokens.push({ text: line.slice(i, j), color: JSON_COLORS.num });
      i = j;
      continue;
    }

    if (line.startsWith('true', i))  { tokens.push({ text: 'true',  color: JSON_COLORS.bool }); i += 4; continue; }
    if (line.startsWith('false', i)) { tokens.push({ text: 'false', color: JSON_COLORS.bool }); i += 5; continue; }
    if (line.startsWith('null', i))  { tokens.push({ text: 'null',  color: JSON_COLORS.bool }); i += 4; continue; }

    let j = i + 1;
    while (j < n) {
      const cc = line[j];
      if (cc === '"' || cc === '-' || /[0-9]/.test(cc)) break;
      if (line.startsWith('true', j) || line.startsWith('false', j) || line.startsWith('null', j)) break;
      j++;
    }
    tokens.push({ text: line.slice(i, j), color: JSON_COLORS.punct });
    i = j;
  }
  return tokens;
}

export function wrapLines(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (para.length === 0) { out.push(''); continue; }
    for (let i = 0; i < para.length; i += width) {
      out.push(para.slice(i, i + width));
    }
  }
  return out;
}
