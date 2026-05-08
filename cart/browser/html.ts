export type HtmlNode = HtmlElementNode | HtmlTextNode;

export type HtmlElementNode = {
  kind: 'element';
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
};

export type HtmlTextNode = {
  kind: 'text';
  text: string;
};

export type HtmlStyle = Record<string, any>;
export type CssRule = {
  selector: CssSelector;
  declarations: HtmlStyle;
  specificity: number;
  order: number;
};

type CssSelector = {
  tag?: string;
  id?: string;
  classes: string[];
  attrs: Array<{ name: string; value: string | null }>;
};

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const BLOCK_TAGS = new Set([
  'html', 'body', 'main', 'article', 'section', 'aside', 'nav', 'header', 'footer',
  'div', 'figure', 'figcaption', 'p', 'pre', 'blockquote', 'center', 'form',
  'fieldset', 'legend', 'details', 'summary', 'caption',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'img',
]);

const SKIP_TAGS = new Set([
  'head', 'script', 'style', 'noscript', 'template', 'svg',
]);

const FONT_SIZE_BY_HTML_SIZE: Record<string, number> = {
  '1': 10,
  '2': 12,
  '3': 14,
  '4': 16,
  '5': 20,
  '6': 24,
  '7': 28,
};

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|nbsp);|&#39;/g, (entity) => ENTITY_MAP[entity] || entity)
    .replace(/&#(\d+);/g, (_, code) => {
      const value = Number(code);
      return Number.isFinite(value) ? String.fromCharCode(value) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const value = Number.parseInt(code, 16);
      return Number.isFinite(value) ? String.fromCharCode(value) : '';
    });
}

export function collapseHtmlWhitespace(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

export function extractHtmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match || !match[1]) return null;
  const title = collapseHtmlWhitespace(decodeHtmlEntities(match[1].replace(/\s+/g, ' ')));
  return title || null;
}

export function htmlToPlainText(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|aside|header|footer|main|nav|li|tr|h1|h2|h3|h4|h5|h6|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ' ');

  return collapseHtmlWhitespace(decodeHtmlEntities(cleaned));
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([^\s=\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(raw))) {
    const name = (match[1] || '').toLowerCase();
    if (!name) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[name] = decodeHtmlEntities(value);
  }
  return attrs;
}

function extractBodyHtml(html: string): string {
  const match = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return match?.[1] || html;
}

function shouldKeepText(text: string, preserveWhitespace: boolean): boolean {
  if (preserveWhitespace) return text.length > 0;
  return text.replace(/\s+/g, '').length > 0;
}

export function isBlockTag(tag: string): boolean {
  return BLOCK_TAGS.has(tag);
}

function toCamelCaseCss(name: string): string {
  return name.trim().toLowerCase().replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function parseCssNumber(raw: string): number | null {
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

function parseCssLength(raw: string): string | number | null {
  const value = raw.trim().toLowerCase();
  if (!value || value === 'auto') return null;
  if (value.endsWith('%')) return value;
  if (value.endsWith('px')) return parseCssNumber(value.slice(0, -2));
  if (value.endsWith('pt')) {
    const n = parseCssNumber(value.slice(0, -2));
    return n == null ? null : n * 1.3333;
  }
  if (value.endsWith('rem') || value.endsWith('em')) {
    const n = parseCssNumber(value.slice(0, -3));
    return n == null ? null : n * 16;
  }
  return parseCssNumber(value);
}

function parseSpacing(value: string): Array<string | number> {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 4);
  const parsed = parts.map((part) => parseCssLength(part) ?? 0);
  if (parsed.length === 0) return [];
  if (parsed.length === 1) return [parsed[0], parsed[0], parsed[0], parsed[0]];
  if (parsed.length === 2) return [parsed[0], parsed[1], parsed[0], parsed[1]];
  if (parsed.length === 3) return [parsed[0], parsed[1], parsed[2], parsed[1]];
  return parsed;
}

function assignBoxSpacing(target: HtmlStyle, prefix: 'margin' | 'padding', value: string): void {
  const spacing = parseSpacing(value);
  if (spacing.length !== 4) return;
  target[`${prefix}Top`] = spacing[0];
  target[`${prefix}Right`] = spacing[1];
  target[`${prefix}Bottom`] = spacing[2];
  target[`${prefix}Left`] = spacing[3];
}

function parseBorder(value: string, target: HtmlStyle): void {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  for (const part of parts) {
    if (part.endsWith('px') || /^[0-9.]+$/.test(part)) {
      const n = parseCssLength(part);
      if (n != null) target.borderWidth = n;
      continue;
    }
    if (part === 'solid' || part === 'dashed' || part === 'double') continue;
    target.borderColor = part;
  }
}

function parseInlineCssValue(prop: string, value: string, target: HtmlStyle): void {
  const raw = value.trim();
  if (!raw) return;

  switch (prop) {
    case 'margin':
    case 'padding':
      assignBoxSpacing(target, prop, raw);
      return;
    case 'border':
      parseBorder(raw, target);
      return;
    case 'borderTop':
    case 'borderRight':
    case 'borderBottom':
    case 'borderLeft': {
      const side = prop.slice('border'.length);
      const width = parseCssLength(raw.split(/\s+/)[0]);
      if (width != null) target[`border${side}Width`] = width;
      const color = raw.split(/\s+/).find((part) => /#|rgb|black|white|red|blue|green|yellow|cyan|magenta|transparent/i.test(part));
      if (color) target.borderColor = color;
      return;
    }
    case 'background':
    case 'backgroundColor':
      target.backgroundColor = raw;
      return;
    case 'color':
    case 'borderColor':
    case 'textAlign':
    case 'display':
    case 'overflow':
    case 'position':
    case 'justifyContent':
    case 'alignItems':
    case 'alignSelf':
    case 'alignContent':
    case 'flexDirection':
    case 'flexWrap':
    case 'fontWeight':
    case 'fontStyle':
    case 'textDecoration':
    case 'textDecorationLine':
      target[prop] = raw;
      return;
    case 'width':
    case 'height':
    case 'minWidth':
    case 'maxWidth':
    case 'minHeight':
    case 'maxHeight':
    case 'top':
    case 'left':
    case 'right':
    case 'bottom':
    case 'flexBasis':
      target[prop] = parseCssLength(raw) ?? raw;
      return;
    case 'gap':
    case 'rowGap':
    case 'columnGap':
    case 'borderRadius':
    case 'borderWidth':
    case 'borderTopWidth':
    case 'borderRightWidth':
    case 'borderBottomWidth':
    case 'borderLeftWidth':
    case 'fontSize':
    case 'lineHeight':
    case 'opacity':
    case 'aspectRatio':
      target[prop] = parseCssLength(raw) ?? raw;
      return;
    case 'whiteSpace':
      if (raw === 'nowrap') target.noWrap = true;
      if (raw === 'pre' || raw === 'pre-wrap') target.whiteSpace = raw;
      return;
    default:
      return;
  }
}

export function parseInlineCss(styleText: string): HtmlStyle {
  const style: HtmlStyle = {};
  for (const chunk of styleText.split(';')) {
    const idx = chunk.indexOf(':');
    if (idx < 0) continue;
    const rawKey = chunk.slice(0, idx).trim();
    const rawValue = chunk.slice(idx + 1).trim();
    if (!rawKey || !rawValue) continue;
    parseInlineCssValue(toCamelCaseCss(rawKey), rawValue, style);
  }
  return style;
}

export function getClassList(attrs: Record<string, string>): string[] {
  return (attrs.class || '')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseCssSelector(selectorText: string): CssSelector | null {
  if (!selectorText || /\s/.test(selectorText.trim())) return null;
  const selector = selectorText
    .replace(/::?[a-z-]+(?:\([^)]*\))?/gi, '')
    .trim();
  if (!selector) return null;

  const attrs: Array<{ name: string; value: string | null }> = [];
  const attrRe = /\[([a-z0-9_-]+)(?:=["']?([^"'=\]]+)["']?)?\]/gi;
  let stripped = selector.replace(attrRe, (_, name: string, value: string) => {
    attrs.push({ name: name.toLowerCase(), value: value ?? null });
    return '';
  });

  let id: string | undefined;
  const idMatch = stripped.match(/#([a-z0-9_-]+)/i);
  if (idMatch) {
    id = idMatch[1];
    stripped = stripped.replace(idMatch[0], '');
  }

  const classes: string[] = [];
  stripped = stripped.replace(/\.([a-z0-9_-]+)/gi, (_, cls: string) => {
    classes.push(cls);
    return '';
  });

  const tag = stripped.trim().toLowerCase() || undefined;
  return { tag, id, classes, attrs };
}

function selectorSpecificity(selector: CssSelector): number {
  return (selector.id ? 100 : 0) + selector.classes.length * 10 + selector.attrs.length * 10 + (selector.tag ? 1 : 0);
}

export function parseCssRules(cssText: string): CssRule[] {
  const cutoff = cssText.indexOf('@media');
  const source = (cutoff >= 0 ? cssText.slice(0, cutoff) : cssText).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  let order = 0;

  for (const chunk of source.split('}')) {
    const idx = chunk.indexOf('{');
    if (idx < 0) continue;
    const selectorText = chunk.slice(0, idx).trim();
    const body = chunk.slice(idx + 1).trim();
    if (!selectorText || !body || selectorText.startsWith('@')) continue;
    const declarations = parseInlineCss(body);
    for (const rawSelector of selectorText.split(',')) {
      const selector = parseCssSelector(rawSelector.trim());
      if (!selector) continue;
      rules.push({
        selector,
        declarations,
        specificity: selectorSpecificity(selector),
        order: order++,
      });
    }
  }

  return rules;
}

function matchesCssRule(tag: string, attrs: Record<string, string>, rule: CssRule): boolean {
  const selector = rule.selector;
  if (selector.tag && selector.tag !== tag) return false;
  if (selector.id && selector.id !== (attrs.id || '')) return false;

  const classList = getClassList(attrs);
  for (const cls of selector.classes) {
    if (!classList.includes(cls)) return false;
  }

  for (const attr of selector.attrs) {
    if (!(attr.name in attrs)) return false;
    if (attr.value != null && attrs[attr.name] !== attr.value) return false;
  }

  return true;
}

export function cssStyleForNode(tag: string, attrs: Record<string, string>, rules: CssRule[]): HtmlStyle {
  const matched = rules
    .filter((rule) => matchesCssRule(tag, attrs, rule))
    .sort((a, b) => a.specificity === b.specificity ? a.order - b.order : a.specificity - b.specificity);

  const style: HtmlStyle = {};
  for (const rule of matched) Object.assign(style, rule.declarations);
  return style;
}

export function styleFromHtmlAttrs(tag: string, attrs: Record<string, string>, cssRules: CssRule[] = []): HtmlStyle {
  const style: HtmlStyle = { ...cssStyleForNode(tag, attrs, cssRules) };
  Object.assign(style, attrs.style ? parseInlineCss(attrs.style) : {});
  const width = attrs.width ? parseCssLength(attrs.width) : null;
  const height = attrs.height ? parseCssLength(attrs.height) : null;
  const border = attrs.border ? parseCssLength(attrs.border) : null;
  const padding = attrs.cellpadding ? parseCssLength(attrs.cellpadding) : null;
  const spacing = attrs.cellspacing ? parseCssLength(attrs.cellspacing) : null;

  if (width != null) style.width = style.width ?? width;
  if (height != null) style.height = style.height ?? height;
  if (attrs.bgcolor) style.backgroundColor = style.backgroundColor ?? attrs.bgcolor;
  if (attrs.color) style.color = style.color ?? attrs.color;
  if (attrs.align) style.textAlign = style.textAlign ?? attrs.align.toLowerCase();
  if (attrs.valign) {
    const v = attrs.valign.toLowerCase();
    style.alignItems = style.alignItems ?? (v === 'middle' ? 'center' : v === 'bottom' ? 'flex-end' : 'flex-start');
  }
  if (border != null) style.borderWidth = style.borderWidth ?? border;
  if (padding != null) style.padding = style.padding ?? padding;
  if (spacing != null) style.gap = style.gap ?? spacing;
  if ('hidden' in attrs) style.display = 'none';

  if (tag === 'center') {
    style.width = style.width ?? '100%';
    style.alignItems = style.alignItems ?? 'center';
  }
  if (tag === 'table') {
    style.width = style.width ?? '100%';
  }
  if (tag === 'img') {
    style.width = style.width ?? 160;
    style.height = style.height ?? 90;
  }
  if (tag === 'input' && attrs.size && style.width == null) {
    const size = parseCssNumber(attrs.size);
    if (size != null) style.width = Math.max(60, size * 9 + 18);
  }
  if (tag === 'textarea') {
    if (style.width == null && attrs.cols) {
      const cols = parseCssNumber(attrs.cols);
      if (cols != null) style.width = Math.max(120, cols * 9 + 18);
    }
    if (style.height == null && attrs.rows) {
      const rows = parseCssNumber(attrs.rows);
      if (rows != null) style.height = Math.max(56, rows * 20 + 12);
    }
  }
  if (tag === 'font' && attrs.size) {
    const fontSize = FONT_SIZE_BY_HTML_SIZE[attrs.size];
    if (fontSize) style.fontSize = style.fontSize ?? fontSize;
  }

  return style;
}

export function textStyleFromHtmlAttrs(tag: string, attrs: Record<string, string>, cssRules: CssRule[] = []): HtmlStyle {
  const style = styleFromHtmlAttrs(tag, attrs, cssRules);
  const textStyle: HtmlStyle = {};
  const keys = [
    'color',
    'fontSize',
    'lineHeight',
    'textAlign',
    'backgroundColor',
    'fontWeight',
    'fontStyle',
    'textDecoration',
    'textDecorationLine',
  ];
  for (const key of keys) {
    if (style[key] != null) textStyle[key] = style[key];
  }
  if (tag === 'strong' || tag === 'b') textStyle.fontWeight = textStyle.fontWeight ?? 'bold';
  if (tag === 'em' || tag === 'i') textStyle.fontStyle = textStyle.fontStyle ?? 'italic';
  return textStyle;
}

export function resolveDocumentUrl(baseAddress: string, href: string): string | null {
  const raw = (href || '').trim();
  if (!raw || raw.startsWith('#') || raw.startsWith('javascript:') || raw.startsWith('mailto:')) return null;
  if (/^[a-z][a-z0-9+\-.]*:/i.test(raw)) return raw;

  const baseMatch = baseAddress.match(/^([a-z][a-z0-9+\-.]*):\/\/([^\/?#]+)([^?#]*)/i);
  if (!baseMatch) return raw;
  const scheme = baseMatch[1];
  const authority = baseMatch[2];
  const basePath = baseMatch[3] || '/';

  if (raw.startsWith('//')) return `${scheme}:${raw}`;
  if (raw.startsWith('/')) return `${scheme}://${authority}${raw}`;

  const pathParts = basePath.split('/').slice(0, -1);
  const relParts = raw.split('/');
  for (const part of relParts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (pathParts.length > 1) pathParts.pop();
      continue;
    }
    pathParts.push(part);
  }
  return `${scheme}://${authority}${pathParts.join('/')}`;
}

export function parseHtmlDocument(html: string): HtmlNode[] {
  const source = extractBodyHtml(html)
    .replace(/<!doctype[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const root: HtmlElementNode = { kind: 'element', tag: 'body', attrs: {}, children: [] };
  const stack: HtmlElementNode[] = [root];
  const skipStack: string[] = [];
  const tokenRe = /<\/?([a-zA-Z0-9:-]+)([^>]*)>|([^<]+)/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(source))) {
    if (match[3] != null) {
      if (skipStack.length > 0) continue;
      const preserveWhitespace = stack.some((node) => node.tag === 'pre' || node.tag === 'code');
      const decoded = decodeHtmlEntities(match[3]);
      if (!shouldKeepText(decoded, preserveWhitespace)) continue;
      stack[stack.length - 1].children.push({ kind: 'text', text: decoded });
      continue;
    }

    const tag = (match[1] || '').toLowerCase();
    const rawAttrs = match[2] || '';
    const isClosing = match[0].startsWith('</');
    const selfClosing = /\/\s*>$/.test(match[0]) || VOID_TAGS.has(tag);

    if (!tag) continue;

    if (SKIP_TAGS.has(tag)) {
      if (!isClosing && !selfClosing) skipStack.push(tag);
      else if (isClosing && skipStack[skipStack.length - 1] === tag) skipStack.pop();
      continue;
    }
    if (skipStack.length > 0) continue;

    if (isClosing) {
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].tag === tag) {
          stack.length = index;
          break;
        }
      }
      continue;
    }

    const node: HtmlElementNode = {
      kind: 'element',
      tag,
      attrs: parseAttrs(rawAttrs),
      children: [],
    };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }

  return root.children;
}
