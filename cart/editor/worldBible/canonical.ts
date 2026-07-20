// Public/player-facing compilation starts here, not at parseKnowledgePage.
// Parsing proves syntax; this loader proves that the exact bytes came from a
// canonical on-disk World Bible path. The WeakSet keeps a type assertion from
// manufacturing that provenance at runtime.
import { readFile } from '../../../runtime/hooks/fs';
import { parseKnowledgePage, type KnowledgePage } from './blockFormat';

declare const CANONICAL_KNOWLEDGE_PAGE: unique symbol;

export type CanonicalKnowledgePage = KnowledgePage & {
  readonly [CANONICAL_KNOWLEDGE_PAGE]: true;
};

const canonicalPages = new WeakSet<object>();
const CANONICAL_PATH = /^world\/knowledge\/[A-Za-z0-9][A-Za-z0-9._~-]*\.md$/;

export function readCanonicalKnowledgePage(path: string): CanonicalKnowledgePage | null {
  if (!CANONICAL_PATH.test(path) || path.includes('..')) return null;
  const source = readFile(path);
  if (source === null) return null;
  const page = parseKnowledgePage(source, path);
  if (!page) return null;
  canonicalPages.add(page);
  return page as CanonicalKnowledgePage;
}

export function hasCanonicalDiskProvenance(page: KnowledgePage): page is CanonicalKnowledgePage {
  return canonicalPages.has(page);
}
