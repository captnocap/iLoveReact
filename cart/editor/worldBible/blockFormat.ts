// Lossless-enough concrete syntax for the first World Bible slice.
//
// The parser owns UTF-16 source spans because that is the coordinate system
// String.slice uses in V8.  The writer never serializes an already-authored
// page wholesale: it replaces only spans whose semantic keys changed.  Human
// prose, comments, whitespace, ordering, and unknown future blocks therefore
// remain byte-for-byte untouched.

export const KNOWLEDGE_KINDS = [
  'business',
  'person',
  'place',
  'position',
  'shift',
  'mechanic',
] as const;

export type KnowledgeKind = typeof KNOWLEDGE_KINDS[number];
export type KnowledgeVisibility = 'public' | 'secret' | 'author';
export type DiagnosticSeverity = 'error' | 'warning';

export type KnowledgeDiagnostic = {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  path?: string;
};

export type SourceSpan = { start: number; end: number };

type TagSpan = {
  full: SourceSpan;
  open: SourceSpan;
  content: SourceSpan;
  close: SourceSpan;
  rawContent: string;
};

type TagNode = TagSpan & {
  tag: string;
  parent: TagNode | null;
};

type TagScan = {
  nodes: TagNode[];
  diagnostics: Array<{ code: string; message: string }>;
};

type AttributeSpan = {
  name: string;
  value: string;
  valueSpan: SourceSpan;
};

type LooseTextSpan = {
  content: SourceSpan;
  rawContent: string;
};

export type KnowledgeFact = {
  key: string;
  label: string;
  value: string;
  visibility: KnowledgeVisibility;
};

export type KnowledgeFactNode = KnowledgeFact & {
  fullSpan: SourceSpan;
  lineSpan: SourceSpan;
  contentSpan: SourceSpan;
  rawContent: string;
  labelSpan: SourceSpan | null;
  visibilitySpan: SourceSpan | null;
};

export type KnowledgePage = {
  path: string;
  source: string;
  kind: KnowledgeKind;
  ref: string;
  name: string;
  logo: string;
  authorText: string;
  publicText: string;
  notesText: string;
  facts: KnowledgeFact[];
  diagnostics: KnowledgeDiagnostic[];
  syntax: {
    root: TagSpan;
    ref: TagSpan | null;
    name: TagSpan | null;
    logo: TagSpan | null;
    heading: LooseTextSpan | null;
    authorText: LooseTextSpan | null;
    publicText: TagSpan | null;
    notesText: TagSpan | null;
    facts: KnowledgeFactNode[];
  };
};

export type KnowledgeDraft = {
  kind: KnowledgeKind;
  ref: string;
  name: string;
  logo: string;
  authorText: string;
  publicText: string;
  notesText: string;
  facts: KnowledgeFact[];
};

export type SemanticChange = {
  key: string;
  label: string;
  before: string | null;
  after: string | null;
};

export type PatchResult = {
  ok: boolean;
  source: string;
  page: KnowledgePage | null;
  changes: SemanticChange[];
  diagnostics: KnowledgeDiagnostic[];
};

const KIND_SET = new Set<string>(KNOWLEDGE_KINDS);
const VISIBILITY_SET = new Set<string>(['public', 'secret', 'author']);
const ENTITY_CHILD_TAGS = new Set(['ref', 'name', 'logo', 'fact', 'public']);
const STRUCTURAL_TAGS = new Set([...KNOWLEDGE_KINDS, ...ENTITY_CHILD_TAGS, 'notes']);
const REF_VALUE_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/;
const FACT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const REF_PATTERN = /@\[([A-Za-z0-9][A-Za-z0-9._:-]*)(?:\|[^\]]+)?\]/g;
const STRUCTURAL_MARKUP_PATTERN = new RegExp(`<\\/?(?:${[...STRUCTURAL_TAGS].join('|')})(?:\\s|>)`, 'i');

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function encodeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function displayBlockValue(raw: string): string {
  return raw.trim();
}

function replacementBlockValue(raw: string, value: string): string {
  if (!raw) return value;
  const leading = raw.match(/^\s*/)?.[0] ?? '';
  const trailing = raw.match(/\s*$/)?.[0] ?? '';
  if (leading.length + trailing.length > raw.length) return value;
  return `${leading}${value}${trailing}`;
}

type MarkdownFence = { marker: '`' | '~'; length: number };

function markdownFenceAtLine(line: string): MarkdownFence | null {
  const opening = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!opening) return null;
  const run = opening[1]!;
  const marker = run[0] as MarkdownFence['marker'];
  // CommonMark does not treat a backtick run as a fence when its info string
  // contains another backtick. Keeping that distinction prevents ordinary
  // prose from unexpectedly masking the canonical entity which follows it.
  if (marker === '`' && opening[2]!.includes('`')) return null;
  return { marker, length: run.length };
}

function closesMarkdownFence(line: string, fence: MarkdownFence): boolean {
  const indentation = /^[ \t]{0,3}/.exec(line)?.[0].length ?? 0;
  let cursor = indentation;
  while (line[cursor] === fence.marker) cursor += 1;
  return cursor - indentation >= fence.length && /^[ \t]*$/.test(line.slice(cursor));
}

/**
 * Replace HTML comments and Markdown fenced-code regions with same-length
 * whitespace before scanning block tags. Newlines remain in place and all
 * semantic spans still address the untouched source. This makes literal block
 * examples inert without destroying the human-owned bytes the writer must
 * preserve. An unclosed comment or fence masks through EOF, which fails closed:
 * a structural close hidden inside it cannot complete a canonical entity.
 */
function maskInertMarkdown(source: string): string {
  let masked: string[] | null = null;
  const mask = (start: number, end: number) => {
    masked ??= source.split('');
    for (let index = start; index < end; index += 1) {
      if (masked[index] !== '\n' && masked[index] !== '\r') masked[index] = ' ';
    }
  };
  const lineEndAfter = (start: number) => {
    const newline = source.indexOf('\n', start);
    return newline < 0 ? source.length : newline + 1;
  };
  const lineBody = (start: number, end: number) => source
    .slice(start, end)
    .replace(/\r?\n$/, '');

  let cursor = 0;
  let fence: MarkdownFence | null = null;
  while (cursor < source.length) {
    const atLineStart = cursor === 0 || source[cursor - 1] === '\n';
    if (fence) {
      const end = lineEndAfter(cursor);
      const closes = closesMarkdownFence(lineBody(cursor, end), fence);
      mask(cursor, end);
      cursor = end;
      if (closes) fence = null;
      continue;
    }
    if (atLineStart) {
      const end = lineEndAfter(cursor);
      const opening = markdownFenceAtLine(lineBody(cursor, end));
      if (opening) {
        fence = opening;
        mask(cursor, end);
        cursor = end;
        continue;
      }
    }
    if (source.startsWith('<!--', cursor)) {
      const close = source.indexOf('-->', cursor + 4);
      const end = close < 0 ? source.length : close + 3;
      mask(cursor, end);
      cursor = end;
      continue;
    }
    cursor += 1;
  }
  return masked?.join('') ?? source;
}

/**
 * Build a tiny depth-aware concrete-syntax tree. Unknown paired tags still
 * participate in depth, so a future block cannot smuggle a known block into
 * the entity's direct-child allowlist. This is deliberately not HTML: the
 * World Bible grammar only needs balanced, explicitly closed block tags.
 */
function scanTags(source: string): TagScan {
  const diagnostics: TagScan['diagnostics'] = [];
  const nodes: Array<TagNode & { complete?: boolean }> = [];
  const stack: Array<TagNode & { complete?: boolean }> = [];
  const semanticSource = maskInertMarkdown(source);
  const pattern = /<(\/)?([A-Za-z][A-Za-z0-9_-]*)(?:\s[^<>]*?)?(\/?)>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(semanticSource))) {
    const closing = !!match[1];
    const tag = match[2]!.toLowerCase();
    const selfClosing = !closing && !!match[3];
    const token = { start: match.index, end: match.index + match[0].length };
    if (!closing) {
      const node: TagNode & { complete?: boolean } = {
        tag,
        parent: stack[stack.length - 1] ?? null,
        full: { ...token },
        open: { ...token },
        content: { start: token.end, end: token.end },
        close: { start: token.end, end: token.end },
        rawContent: '',
        complete: selfClosing,
      };
      nodes.push(node);
      if (!selfClosing) stack.push(node);
      continue;
    }

    let matching = stack.length - 1;
    while (matching >= 0 && stack[matching]!.tag !== tag) matching -= 1;
    if (matching < 0) {
      if (STRUCTURAL_TAGS.has(tag)) diagnostics.push({ code: 'block-close-unmatched', message: `Unmatched </${tag}> block close.` });
      continue;
    }
    for (let index = stack.length - 1; index > matching; index -= 1) {
      const unclosed = stack[index]!;
      if (STRUCTURAL_TAGS.has(unclosed.tag)) diagnostics.push({ code: 'block-unclosed', message: `<${unclosed.tag}> is not closed before </${tag}>.` });
    }
    stack.length = matching + 1;
    const node = stack.pop()!;
    node.close = { ...token };
    node.content = { start: node.open.end, end: token.start };
    node.full = { start: node.open.start, end: token.end };
    node.rawContent = source.slice(node.content.start, node.content.end);
    node.complete = true;
  }
  for (const node of stack) {
    if (STRUCTURAL_TAGS.has(node.tag)) diagnostics.push({ code: 'block-unclosed', message: `<${node.tag}> is missing </${node.tag}>.` });
  }
  const recognizedFactStarts = new Set(nodes.filter((node) => node.tag === 'fact').map((node) => node.open.start));
  const factCandidate = /<fact(?=[\s/>])/gi;
  while ((match = factCandidate.exec(semanticSource))) {
    if (!recognizedFactStarts.has(match.index)) {
      diagnostics.push({ code: 'fact-tag-malformed', message: 'Malformed <fact> opening tag; fact syntax must be fully parseable.' });
    }
  }
  return { nodes: nodes.filter((node) => node.complete), diagnostics };
}

const FACT_ATTRIBUTE_NAMES = new Set(['key', 'label', 'visibility']);

function parseFactAttributes(
  source: string,
  open: SourceSpan,
  path: string,
  diagnostics: KnowledgeDiagnostic[],
): AttributeSpan[] {
  const tagName = 'fact';
  const prefixEnd = open.start + tagName.length + 1;
  let attributesEnd = open.end - 1;
  if (source[attributesEnd - 1] === '/') attributesEnd -= 1;
  const attributes: AttributeSpan[] = [];
  const seen = new Set<string>();
  let cursor = prefixEnd;
  while (cursor < attributesEnd) {
    const separatorStart = cursor;
    while (source[cursor] === ' ' || source[cursor] === '\t') cursor += 1;
    if (cursor >= attributesEnd) break;
    if (cursor === separatorStart) {
      diagnostics.push({ severity: 'error', code: 'fact-attribute-malformed', message: 'Fact attributes must be whitespace-separated name="value" pairs.', path });
      break;
    }
    const attributeStart = cursor;
    const match = /^([A-Za-z_][A-Za-z0-9_-]*)[ \t]*=[ \t]*(["'])([\s\S]*?)\2/.exec(source.slice(attributeStart, attributesEnd));
    if (!match || /[<>\r\n]/.test(match[3]!)) {
      diagnostics.push({ severity: 'error', code: 'fact-attribute-malformed', message: 'Fact attributes require quoted, single-line values and fully valid syntax.', path });
      break;
    }
    const next = attributeStart + match[0].length;
    if (next < attributesEnd && source[next] !== ' ' && source[next] !== '\t') {
      diagnostics.push({ severity: 'error', code: 'fact-attribute-malformed', message: 'Fact attributes must be separated by whitespace with no trailing syntax.', path });
      break;
    }
    const name = match[1]!;
    if (!FACT_ATTRIBUTE_NAMES.has(name)) {
      diagnostics.push({ severity: 'error', code: 'fact-attribute-unknown', message: `Unknown fact attribute "${name}".`, path });
    }
    if (seen.has(name)) {
      diagnostics.push({ severity: 'error', code: 'fact-attribute-duplicate', message: `Fact attributes may declare "${name}" only once.`, path });
    }
    seen.add(name);
    const quoteAt = match[0].indexOf(match[2]!, name.length);
    const valueStart = attributeStart + quoteAt + 1;
    attributes.push({
      name,
      value: decodeAttribute(match[3]!),
      valueSpan: { start: valueStart, end: valueStart + match[3]!.length },
    });
    cursor = next;
  }
  return attributes;
}

function lineOwnedSpan(source: string, span: SourceSpan): SourceSpan {
  const lineStart = source.lastIndexOf('\n', Math.max(0, span.start - 1)) + 1;
  const before = source.slice(lineStart, span.start);
  if (before.trim()) return span;
  const newline = source.indexOf('\n', span.end);
  const afterEnd = newline < 0 ? source.length : newline + 1;
  const after = source.slice(span.end, newline < 0 ? source.length : newline);
  return after.trim() ? span : { start: lineStart, end: afterEnd };
}

function parseFacts(source: string, factTags: readonly TagNode[], path: string, diagnostics: KnowledgeDiagnostic[]): KnowledgeFactNode[] {
  const facts: KnowledgeFactNode[] = [];
  const seen = new Set<string>();
  for (const tag of factTags) {
    const attrs = parseFactAttributes(source, tag.open, path, diagnostics);
    const keyAttr = attrs.find((attr) => attr.name === 'key');
    const labelAttr = attrs.find((attr) => attr.name === 'label');
    const visibilityAttr = attrs.find((attr) => attr.name === 'visibility');
    const key = keyAttr?.value.trim() ?? '';
    const label = labelAttr?.value.trim() || humanizeKey(key);
    const rawVisibility = visibilityAttr?.value.trim() ?? '';
    const visibility: KnowledgeVisibility = VISIBILITY_SET.has(rawVisibility)
      ? rawVisibility as KnowledgeVisibility
      : 'author';
    if (!key) diagnostics.push({ severity: 'error', code: 'fact-key-missing', message: 'Every fact requires a stable key.', path });
    else if (seen.has(key)) diagnostics.push({ severity: 'error', code: 'fact-key-duplicate', message: `Duplicate fact key "${key}".`, path });
    else seen.add(key);
    if (!visibilityAttr || !VISIBILITY_SET.has(rawVisibility)) {
      diagnostics.push({ severity: 'error', code: 'fact-visibility-invalid', message: `Fact "${key || '?'}" needs visibility="public", "secret", or "author".`, path });
    }
    const contentSpan = tag.content;
    const rawContent = source.slice(contentSpan.start, contentSpan.end);
    facts.push({
      key,
      label,
      value: displayBlockValue(rawContent),
      visibility,
      fullSpan: tag.full,
      lineSpan: lineOwnedSpan(source, tag.full),
      contentSpan,
      rawContent,
      labelSpan: labelAttr?.valueSpan ?? null,
      visibilitySpan: visibilityAttr?.valueSpan ?? null,
    });
  }
  return facts;
}

function findPresentationHeading(source: string, root: TagSpan): LooseTextSpan | null {
  if (root.open.start <= 0) return null;
  const prefix = source.slice(0, root.open.start);
  const heading = /^((?:\uFEFF)?[ \t]*#[ \t]+)([^\r\n]*)(?:\r?\n|$)/.exec(prefix);
  if (!heading) return null;
  const start = heading[1]!.length;
  const content = { start, end: start + heading[2]!.length };
  return { content, rawContent: source.slice(content.start, content.end) };
}

function findAuthorPreamble(source: string, root: TagSpan): LooseTextSpan | null {
  if (root.open.start <= 0) return null;
  const prefix = source.slice(0, root.open.start);
  // A leading Markdown H1 is page presentation owned by <name>; the literal
  // prose after it is the author-text field. If no H1 exists, the entire
  // preamble remains editable author-only text.
  const heading = /^(?:\uFEFF)?[ \t]*#[^\r\n]*(?:\r?\n|$)/.exec(prefix);
  const start = heading?.[0].length ?? 0;
  const content = { start, end: root.open.start };
  return { content, rawContent: source.slice(content.start, content.end) };
}

function expectedPrefixes(kind: KnowledgeKind): readonly string[] {
  if (kind === 'business') return ['biz.'];
  if (kind === 'person') return ['npc.', 'person.'];
  return [`${kind}.`];
}

function validateScalar(value: string, label: string, path: string, diagnostics: KnowledgeDiagnostic[]): void {
  if (!value) diagnostics.push({ severity: 'error', code: `${label}-missing`, message: `Missing <${label}> value.`, path });
  if (/[<>]/.test(value)) diagnostics.push({ severity: 'error', code: `${label}-markup`, message: `<${label}> cannot contain nested markup.`, path });
  if (/\r|\n/.test(value)) diagnostics.push({ severity: 'error', code: `${label}-multiline`, message: `<${label}> must stay on one line.`, path });
}

function addCardinalityDiagnostic(
  tags: readonly TagNode[],
  tag: string,
  path: string,
  diagnostics: KnowledgeDiagnostic[],
  required: boolean,
): TagNode | null {
  const matches = tags.filter((node) => node.tag === tag);
  if (required && matches.length === 0) {
    diagnostics.push({ severity: 'error', code: `${tag}-missing`, message: `Every entity requires exactly one <${tag}> direct child.`, path });
  }
  if (matches.length > 1) {
    diagnostics.push({ severity: 'error', code: `${tag}-duplicate`, message: `An entity can have at most one direct <${tag}> block.`, path });
  }
  return matches[0] ?? null;
}

export function humanizeKey(key: string): string {
  return key
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Fact';
}

function freezeKnowledgePage(page: KnowledgePage): KnowledgePage {
  const freezeSpan = (span: SourceSpan | null | undefined) => { if (span) Object.freeze(span); };
  const freezeTag = (tag: TagSpan | null) => {
    if (!tag) return;
    freezeSpan(tag.full);
    freezeSpan(tag.open);
    freezeSpan(tag.content);
    freezeSpan(tag.close);
    Object.freeze(tag);
  };
  for (const fact of page.facts) Object.freeze(fact);
  Object.freeze(page.facts);
  for (const diagnostic of page.diagnostics) Object.freeze(diagnostic);
  Object.freeze(page.diagnostics);
  freezeTag(page.syntax.root);
  freezeTag(page.syntax.ref);
  freezeTag(page.syntax.name);
  freezeTag(page.syntax.logo);
  freezeTag(page.syntax.publicText);
  freezeTag(page.syntax.notesText);
  if (page.syntax.heading) {
    freezeSpan(page.syntax.heading.content);
    Object.freeze(page.syntax.heading);
  }
  if (page.syntax.authorText) {
    freezeSpan(page.syntax.authorText.content);
    Object.freeze(page.syntax.authorText);
  }
  for (const fact of page.syntax.facts) {
    freezeSpan(fact.fullSpan);
    freezeSpan(fact.lineSpan);
    freezeSpan(fact.contentSpan);
    freezeSpan(fact.labelSpan);
    freezeSpan(fact.visibilitySpan);
    Object.freeze(fact);
  }
  Object.freeze(page.syntax.facts);
  Object.freeze(page.syntax);
  return Object.freeze(page);
}

export function parseKnowledgePage(source: string, path = '<memory>'): KnowledgePage | null {
  const diagnostics: KnowledgeDiagnostic[] = [];
  const scan = scanTags(source);
  diagnostics.push(...scan.diagnostics.map((item) => ({ severity: 'error' as const, ...item, path })));
  const roots = scan.nodes.filter((node) => node.parent === null && KIND_SET.has(node.tag));
  if (!roots.length) return null;
  const root = roots[0]!;
  const kind = root.tag as KnowledgeKind;
  if (roots.length > 1) diagnostics.push({ severity: 'error', code: 'multiple-entities', message: 'A World Bible file owns exactly one top-level entity block.', path });

  for (const node of scan.nodes) {
    if (!STRUCTURAL_TAGS.has(node.tag) || node === root) continue;
    const valid = node.tag === 'notes'
      ? node.parent === null
      : ENTITY_CHILD_TAGS.has(node.tag)
        ? node.parent === root
        : false;
    if (!valid) {
      diagnostics.push({
        severity: 'error',
        code: 'block-nesting-invalid',
        message: `<${node.tag}> is structurally nested; entity fields must be direct children and <notes> must be a top-level sibling.`,
        path,
      });
    }
  }

  const children = scan.nodes.filter((node) => node.parent === root);
  const topLevel = scan.nodes.filter((node) => node.parent === null);
  const refTag = addCardinalityDiagnostic(children, 'ref', path, diagnostics, true);
  const nameTag = addCardinalityDiagnostic(children, 'name', path, diagnostics, true);
  const logoTag = addCardinalityDiagnostic(children, 'logo', path, diagnostics, false);
  const publicTag = addCardinalityDiagnostic(children, 'public', path, diagnostics, false);
  const notesTag = addCardinalityDiagnostic(topLevel, 'notes', path, diagnostics, false);
  const heading = findPresentationHeading(source, root);
  const authorText = findAuthorPreamble(source, root);
  const ref = displayBlockValue(refTag?.rawContent ?? '');
  const name = displayBlockValue(nameTag?.rawContent ?? '');
  const logo = displayBlockValue(logoTag?.rawContent ?? '');
  validateScalar(ref, 'ref', path, diagnostics);
  validateScalar(name, 'name', path, diagnostics);
  if (ref && !REF_VALUE_PATTERN.test(ref)) {
    diagnostics.push({ severity: 'error', code: 'ref-invalid', message: 'Refs use lowercase letters, numbers, dot, underscore, colon, and hyphen only.', path });
  }
  if (ref && !expectedPrefixes(kind).some((prefix) => ref.startsWith(prefix))) {
    diagnostics.push({
      severity: 'warning',
      code: 'ref-prefix-kind-mismatch',
      message: `Ref "${ref}" does not follow the ${kind} prefix convention; <${kind}> remains authoritative.`,
      path,
    });
  }
  const factNodes = parseFacts(source, children.filter((node) => node.tag === 'fact'), path, diagnostics);
  return freezeKnowledgePage({
    path,
    source,
    kind,
    ref,
    name,
    logo,
    authorText: displayBlockValue(authorText?.rawContent ?? ''),
    publicText: displayBlockValue(publicTag?.rawContent ?? ''),
    notesText: displayBlockValue(notesTag?.rawContent ?? ''),
    facts: factNodes.map(({ key, label, value, visibility }) => ({ key, label, value, visibility })),
    diagnostics,
    syntax: {
      root,
      ref: refTag,
      name: nameTag,
      logo: logoTag,
      heading,
      authorText,
      publicText: publicTag,
      notesText: notesTag,
      facts: factNodes,
    },
  });
}

export function draftFromPage(page: KnowledgePage): KnowledgeDraft {
  return {
    kind: page.kind,
    ref: page.ref,
    name: page.name,
    logo: page.logo,
    authorText: page.authorText,
    publicText: page.publicText,
    notesText: page.notesText,
    facts: page.facts.map((fact) => ({ ...fact })),
  };
}

function factMap(facts: readonly KnowledgeFact[]): Map<string, KnowledgeFact> {
  return new Map(facts.map((fact) => [fact.key, fact]));
}

export function semanticChanges(base: KnowledgePage | KnowledgeDraft, draft: KnowledgeDraft): SemanticChange[] {
  const changes: SemanticChange[] = [];
  const scalar = (key: string, label: string, before: string, after: string) => {
    if (before !== after) changes.push({ key, label, before, after });
  };
  scalar('kind', 'Kind', base.kind, draft.kind);
  scalar('ref', 'Stable ref', base.ref, draft.ref);
  scalar('name', 'Name', base.name, draft.name);
  scalar('logo', 'Logo', base.logo, draft.logo);
  scalar('author', 'Author Markdown', base.authorText, draft.authorText);
  scalar('public', 'Public prose', base.publicText, draft.publicText);
  scalar('notes', 'Author notes', base.notesText, draft.notesText);
  const beforeFacts = factMap(base.facts);
  const afterFacts = factMap(draft.facts);
  const keys = new Set([...beforeFacts.keys(), ...afterFacts.keys()]);
  for (const key of [...keys].sort()) {
    const before = beforeFacts.get(key);
    const after = afterFacts.get(key);
    if (!before && after) {
      changes.push({ key: `fact.${key}`, label: `Add fact · ${after.label}`, before: null, after: `${after.value} [${after.visibility}]` });
      continue;
    }
    if (before && !after) {
      changes.push({ key: `fact.${key}`, label: `Remove fact · ${before.label}`, before: `${before.value} [${before.visibility}]`, after: null });
      continue;
    }
    if (!before || !after) continue;
    if (before.label !== after.label) changes.push({ key: `fact.${key}.label`, label: `Fact label · ${key}`, before: before.label, after: after.label });
    if (before.value !== after.value) changes.push({ key: `fact.${key}.value`, label: `Fact value · ${after.label}`, before: before.value, after: after.value });
    if (before.visibility !== after.visibility) changes.push({ key: `fact.${key}.visibility`, label: `Fact visibility · ${after.label}`, before: before.visibility, after: after.visibility });
  }
  return changes;
}

type Replacement = { span: SourceSpan; value: string; owner: string };

function addContentReplacement(replacements: Replacement[], tag: TagSpan | null, value: string, owner: string): boolean {
  if (!tag) return false;
  replacements.push({ span: tag.content, value: replacementBlockValue(tag.rawContent, value), owner });
  return true;
}

function applyReplacements(source: string, replacements: Replacement[]): string {
  const sorted = [...replacements].sort((a, b) => b.span.start - a.span.start || b.span.end - a.span.end);
  let cursor = source.length;
  for (const replacement of sorted) {
    if (replacement.span.start < 0 || replacement.span.end < replacement.span.start || replacement.span.end > source.length) {
      throw new Error(`invalid source span for ${replacement.owner}`);
    }
    if (replacement.span.end > cursor) throw new Error(`overlapping source spans at ${replacement.owner}`);
    cursor = replacement.span.start;
  }
  let out = source;
  for (const replacement of sorted) out = out.slice(0, replacement.span.start) + replacement.value + out.slice(replacement.span.end);
  return out;
}

function validateStructuralText(value: string, label: string, path: string, diagnostics: KnowledgeDiagnostic[]): void {
  if (STRUCTURAL_MARKUP_PATTERN.test(maskInertMarkdown(value))) {
    diagnostics.push({
      severity: 'error',
      code: `${label}-structural-markup`,
      message: `${label} cannot contain World Bible block tags; write them as plain words instead.`,
      path,
    });
  }
}

export function validateKnowledgeDraft(draft: KnowledgeDraft, path: string): KnowledgeDiagnostic[] {
  const diagnostics: KnowledgeDiagnostic[] = [];
  validateScalar(draft.ref.trim(), 'ref', path, diagnostics);
  validateScalar(draft.name.trim(), 'name', path, diagnostics);
  if (!KIND_SET.has(draft.kind)) diagnostics.push({ severity: 'error', code: 'kind-invalid', message: `Unsupported entity kind "${String(draft.kind)}".`, path });
  if (draft.ref && !REF_VALUE_PATTERN.test(draft.ref)) {
    diagnostics.push({ severity: 'error', code: 'ref-invalid', message: 'Refs use lowercase letters, numbers, dot, underscore, colon, and hyphen only.', path });
  }
  if (draft.ref && KIND_SET.has(draft.kind) && !expectedPrefixes(draft.kind).some((prefix) => draft.ref.startsWith(prefix))) {
    diagnostics.push({ severity: 'warning', code: 'ref-prefix-kind-mismatch', message: `Ref "${draft.ref}" does not follow the ${draft.kind} prefix convention; kind remains authoritative.`, path });
  }
  if (draft.logo) validateScalar(draft.logo, 'logo', path, diagnostics);
  validateStructuralText(draft.authorText, 'Author Markdown', path, diagnostics);
  validateStructuralText(draft.publicText, 'Public prose', path, diagnostics);
  validateStructuralText(draft.notesText, 'Author notes', path, diagnostics);
  const seen = new Set<string>();
  for (const fact of draft.facts) {
    if (!fact.key.trim()) diagnostics.push({ severity: 'error', code: 'fact-key-missing', message: 'Every fact requires a stable key.', path });
    else if (seen.has(fact.key)) diagnostics.push({ severity: 'error', code: 'fact-key-duplicate', message: `Duplicate fact key "${fact.key}".`, path });
    else seen.add(fact.key);
    if (fact.key && !FACT_KEY_PATTERN.test(fact.key)) diagnostics.push({ severity: 'error', code: 'fact-key-invalid', message: `Fact key "${fact.key}" uses lowercase letters, numbers, underscore, and hyphen only.`, path });
    if (!VISIBILITY_SET.has(fact.visibility)) diagnostics.push({ severity: 'error', code: 'fact-visibility-invalid', message: `Invalid visibility on fact "${fact.key}".`, path });
    validateStructuralText(fact.value, `Fact "${fact.key}"`, path, diagnostics);
  }
  return diagnostics;
}

function pageMatchesDraft(page: KnowledgePage, draft: KnowledgeDraft): boolean {
  const same = (left: string, right: string) => left.trim() === right.trim();
  if (page.kind !== draft.kind || !same(page.ref, draft.ref) || !same(page.name, draft.name)
    || !same(page.logo, draft.logo) || !same(page.authorText, draft.authorText)
    || !same(page.publicText, draft.publicText) || !same(page.notesText, draft.notesText)
    || page.facts.length !== draft.facts.length) return false;
  const expected = factMap(draft.facts);
  return page.facts.every((fact) => {
    const wanted = expected.get(fact.key);
    return !!wanted && same(fact.label, wanted.label) && same(fact.value, wanted.value) && fact.visibility === wanted.visibility;
  });
}

export function patchKnowledgePage(base: KnowledgePage, draft: KnowledgeDraft): PatchResult {
  const changes = semanticChanges(base, draft);
  const draftDiagnostics = validateKnowledgeDraft(draft, base.path);
  if (draft.kind !== base.kind || draft.ref !== base.ref) {
    draftDiagnostics.push({
      severity: 'error',
      code: 'identity-edit-refused',
      message: 'Kind and ref are stable identity in this slice; create a new page instead of rewriting them.',
      path: base.path,
    });
  }
  if (draftDiagnostics.some((item) => item.severity === 'error')) {
    return { ok: false, source: base.source, page: null, changes, diagnostics: draftDiagnostics };
  }
  const replacements: Replacement[] = [];
  const insertions: string[] = [];
  if (base.name !== draft.name) {
    if (!addContentReplacement(replacements, base.syntax.name, draft.name, 'name')) insertions.push(`  <name>${draft.name}</name>`);
    if (base.syntax.heading) {
      replacements.push({ span: base.syntax.heading.content, value: draft.name, owner: 'Markdown heading' });
    }
  }
  if (base.logo !== draft.logo) {
    if (!addContentReplacement(replacements, base.syntax.logo, draft.logo, 'logo')) insertions.push(`  <logo>${draft.logo}</logo>`);
  }
  if (base.authorText !== draft.authorText) {
    if (base.syntax.authorText) {
      replacements.push({
        span: base.syntax.authorText.content,
        value: replacementBlockValue(base.syntax.authorText.rawContent, draft.authorText),
        owner: 'author Markdown',
      });
    } else {
      replacements.push({
        span: { start: base.syntax.root.open.start, end: base.syntax.root.open.start },
        value: draft.authorText ? `${draft.authorText}\n\n` : '',
        owner: 'author Markdown insertion',
      });
    }
  }
  if (base.publicText !== draft.publicText) {
    if (!addContentReplacement(replacements, base.syntax.publicText, draft.publicText, 'public')) {
      insertions.push(`\n  <public>\n${draft.publicText}\n  </public>`);
    }
  }
  if (base.notesText !== draft.notesText) {
    if (!addContentReplacement(replacements, base.syntax.notesText, draft.notesText, 'notes')) {
      replacements.push({ span: { start: base.syntax.root.full.end, end: base.syntax.root.full.end }, value: `\n\n<notes>\n${draft.notesText}\n</notes>`, owner: 'notes insertion' });
    }
  }

  const baseFacts = new Map(base.syntax.facts.map((fact) => [fact.key, fact]));
  const draftFacts = factMap(draft.facts);
  for (const [key, node] of baseFacts) {
    const next = draftFacts.get(key);
    if (!next) {
      replacements.push({ span: node.lineSpan, value: '', owner: `fact.${key} removal` });
      continue;
    }
    if (node.value !== next.value) replacements.push({ span: node.contentSpan, value: replacementBlockValue(node.rawContent, next.value), owner: `fact.${key}.value` });
    if (node.visibility !== next.visibility) {
      if (!node.visibilitySpan) draftDiagnostics.push({ severity: 'error', code: 'fact-visibility-span-missing', message: `Cannot safely patch visibility for fact "${key}".`, path: base.path });
      else replacements.push({ span: node.visibilitySpan, value: encodeAttribute(next.visibility), owner: `fact.${key}.visibility` });
    }
    if (node.label !== next.label) {
      if (!node.labelSpan) draftDiagnostics.push({ severity: 'error', code: 'fact-label-span-missing', message: `Cannot safely patch label for fact "${key}" because the source has no label attribute.`, path: base.path });
      else replacements.push({ span: node.labelSpan, value: encodeAttribute(next.label), owner: `fact.${key}.label` });
    }
  }
  const newFacts = draft.facts.filter((fact) => !baseFacts.has(fact.key));
  const factInsertions = new Map<number, string[]>();
  for (const fact of newFacts) {
    const draftIndex = draft.facts.indexOf(fact);
    const nextExisting = draft.facts.slice(draftIndex + 1).find((candidate) => baseFacts.has(candidate.key) && draftFacts.has(candidate.key));
    const nextNode = nextExisting ? baseFacts.get(nextExisting.key) : null;
    const fallback = base.syntax.publicText?.full.start ?? base.syntax.root.close.start;
    const target = nextNode?.lineSpan.start ?? (base.source.lastIndexOf('\n', Math.max(0, fallback - 1)) + 1);
    const rows = factInsertions.get(target) ?? [];
    rows.push(`  <fact key="${encodeAttribute(fact.key)}" label="${encodeAttribute(fact.label)}" visibility="${fact.visibility}">${fact.value}</fact>`);
    factInsertions.set(target, rows);
  }
  for (const [at, rows] of factInsertions) {
    replacements.push({ span: { start: at, end: at }, value: `${rows.join('\n')}\n`, owner: 'keyed fact insertion' });
  }
  if (insertions.length) {
    const at = base.syntax.publicText?.full.start ?? base.syntax.root.close.start;
    const prefix = at > 0 && base.source[at - 1] === '\n' ? '' : '\n';
    replacements.push({ span: { start: at, end: at }, value: `${prefix}${insertions.join('\n')}\n`, owner: 'keyed field insertion' });
  }
  if (draftDiagnostics.some((item) => item.severity === 'error')) {
    return { ok: false, source: base.source, page: null, changes, diagnostics: draftDiagnostics };
  }
  let source: string;
  try { source = applyReplacements(base.source, replacements); }
  catch (error) {
    const diagnostics = [...draftDiagnostics, { severity: 'error' as const, code: 'patch-overlap', message: (error as Error).message, path: base.path }];
    return { ok: false, source: base.source, page: null, changes, diagnostics };
  }
  const page = parseKnowledgePage(source, base.path);
  const diagnostics = [...draftDiagnostics, ...(page?.diagnostics ?? [{ severity: 'error' as const, code: 'reparse-failed', message: 'Proposed text did not parse.', path: base.path }])];
  if (page && !pageMatchesDraft(page, draft)) diagnostics.push({ severity: 'error', code: 'semantic-roundtrip-mismatch', message: 'The exact patch reparsed to different semantics than the reviewed draft.', path: base.path });
  return { ok: !!page && !diagnostics.some((item) => item.severity === 'error'), source, page, changes, diagnostics };
}

export function serializeNewKnowledgePage(path: string, draft: KnowledgeDraft): PatchResult {
  const diagnostics = validateKnowledgeDraft(draft, path);
  if (diagnostics.some((item) => item.severity === 'error')) return { ok: false, source: '', page: null, changes: [], diagnostics };
  const logo = draft.logo ? `\n  <logo>${draft.logo}</logo>` : '';
  const facts = draft.facts.map((fact) => `  <fact key="${encodeAttribute(fact.key)}" label="${encodeAttribute(fact.label)}" visibility="${fact.visibility}">${fact.value}</fact>`).join('\n');
  const authorText = draft.authorText ? `${draft.authorText}\n\n` : '';
  const source = `# ${draft.name}\n\n${authorText}<${draft.kind}>\n  <ref>${draft.ref}</ref>\n  <name>${draft.name}</name>${logo}${facts ? `\n\n${facts}` : ''}\n\n  <public>\n${draft.publicText}\n  </public>\n</${draft.kind}>\n\n<notes>\n${draft.notesText}\n</notes>\n`;
  const page = parseKnowledgePage(source, path);
  const allDiagnostics = [...diagnostics, ...(page?.diagnostics ?? [])];
  if (page && !pageMatchesDraft(page, draft)) allDiagnostics.push({ severity: 'error', code: 'semantic-roundtrip-mismatch', message: 'The serialized page reparsed to different semantics than the reviewed draft.', path });
  const changes = [{ key: 'page', label: `Create ${draft.kind}`, before: null, after: draft.ref }];
  return { ok: !!page && !allDiagnostics.some((item) => item.severity === 'error'), source, page, changes, diagnostics: allDiagnostics };
}

export function referencesIn(value: string): string[] {
  const refs: string[] = [];
  REF_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REF_PATTERN.exec(value))) refs.push(match[1]!);
  return refs;
}

export function renderInlineRefs(value: string, resolve: (ref: string) => string | null): Array<{ text: string; ref: string | null }> {
  const parts: Array<{ text: string; ref: string | null }> = [];
  REF_PATTERN.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = REF_PATTERN.exec(value))) {
    if (match.index > cursor) parts.push({ text: value.slice(cursor, match.index), ref: null });
    const authoredLabel = match[0].includes('|') ? match[0].slice(match[0].indexOf('|') + 1, -1) : null;
    parts.push({ text: authoredLabel || resolve(match[1]!) || match[1]!, ref: match[1]! });
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) parts.push({ text: value.slice(cursor), ref: null });
  return parts;
}

export function sourcePatchPreview(before: string | null, after: string): string {
  if (before === null) return after.split('\n').map((line) => `+ ${line}`).join('\n');
  const a = before.split('\n');
  const b = after.split('\n');
  const rows: string[] = ['@@ reviewed file @@'];
  let i = 0;
  let j = 0;
  const LOOKAHEAD = 24;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      rows.push(`  ${a[i]}`);
      i += 1;
      j += 1;
      continue;
    }
    let deleteCount = 0;
    let insertCount = 0;
    if (j < b.length) {
      for (let distance = 1; distance <= LOOKAHEAD && i + distance < a.length; distance += 1) {
        if (a[i + distance] === b[j]) { deleteCount = distance; break; }
      }
    }
    if (i < a.length) {
      for (let distance = 1; distance <= LOOKAHEAD && j + distance < b.length; distance += 1) {
        if (b[j + distance] === a[i]) { insertCount = distance; break; }
      }
    }
    if (deleteCount && (!insertCount || deleteCount <= insertCount)) {
      for (let count = 0; count < deleteCount; count += 1) rows.push(`- ${a[i++]}`);
      continue;
    }
    if (insertCount) {
      for (let count = 0; count < insertCount; count += 1) rows.push(`+ ${b[j++]}`);
      continue;
    }
    if (i < a.length) rows.push(`- ${a[i++]}`);
    if (j < b.length) rows.push(`+ ${b[j++]}`);
  }
  return rows.join('\n');
}

export function kindIs(value: string): value is KnowledgeKind {
  return KIND_SET.has(value);
}
