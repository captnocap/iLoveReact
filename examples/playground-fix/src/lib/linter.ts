/**
 * linter.ts — Lightweight runtime lint rules for the playground.
 */

export interface LintMessage { line: number; col: number; message: string; severity: 'error' | 'warning'; rule: string; }

const VALID_STYLE_PROPS = new Set([
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'aspectRatio',
  'display', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignSelf',
  'flexGrow', 'flexShrink', 'flexBasis', 'gap',
  'padding', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
  'margin', 'marginLeft', 'marginRight', 'marginTop', 'marginBottom',
  'backgroundColor', 'borderRadius', 'borderWidth',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'overflow', 'opacity', 'zIndex',
  'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'shadowBlur',
  'backgroundGradient', 'transform',
  'color', 'fontSize', 'fontFamily', 'fontWeight', 'textAlign',
  'textOverflow', 'textDecorationLine', 'lineHeight', 'letterSpacing',
  'objectFit', 'position', 'top', 'bottom', 'left', 'right', 'numberOfLines',
]);

export function lint(source: string): LintMessage[] {
  const messages: LintMessage[] = [];
  const lines = source.split('\n');

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const num = idx + 1;
    if (idx > 0 && lines[idx - 1].trim() === '// ilr-ignore-next-line') continue;

    let sp = 0;
    while (true) {
      const i = line.indexOf('<Text', sp);
      if (i < 0) break;
      const after = line[i + 5];
      if (after && /[a-zA-Z0-9_]/.test(after)) { sp = i + 5; continue; }
      let el = '';
      for (let j = idx; j < lines.length && j < idx + 10; j++) { el += lines[j] + '\n'; if (lines[j].includes('>')) break; }
      if (!/fontSize\s*[:=]/.test(el)) messages.push({ line: num, col: i + 1, message: 'Text needs fontSize — add fontSize: 14 to see it render', severity: 'error', rule: 'no-text-without-fontsize' });
      sp = i + 5;
    }

    const trimmed = line.trim();
    if (!trimmed.includes(':') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
    if (/^(function|const|let|var|return|import|export)\b/.test(trimmed)) continue;
    const pat = /(\w+)\s*:/g;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(line)) !== null) {
      const p = m[1];
      if (/^(background|border|flex|font|margin|padding|text|shadow|min|max|align|justify|overflow|opacity|z|gap|color|width|height|top|bottom|left|right|position|display|transform|object|aspect|line|letter|number)/.test(p) && !VALID_STYLE_PROPS.has(p))
        messages.push({ line: num, col: m.index + 1, message: `Unknown style property "${p}" — check spelling`, severity: 'warning', rule: 'no-invalid-style-props' });
    }
  }
  return messages.sort((a, b) => a.line - b.line);
}
