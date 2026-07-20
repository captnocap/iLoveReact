import {
  referencesIn,
  parseKnowledgePage,
  validateKnowledgeDraft,
  type KnowledgeDiagnostic,
  type KnowledgeDraft,
  type KnowledgeFact,
  type KnowledgeKind,
  type KnowledgePage,
} from './blockFormat';
import {
  hasCanonicalDiskProvenance,
  type CanonicalKnowledgePage,
} from './canonical';

export type KnowledgeBacklink = {
  fromRef: string;
  fromName: string;
  reason: string;
};

export type KnowledgeCatalog = {
  pages: KnowledgePage[];
  byRef: Map<string, KnowledgePage>;
  backlinks: Map<string, KnowledgeBacklink[]>;
  diagnostics: KnowledgeDiagnostic[];
};

export type PublicKnowledgePage = {
  provenance: 'CANONICAL DISK';
  identity: {
    ref: string;
    kind: KnowledgeKind;
    name: string;
    visibility: 'public-identity';
  };
  prose: string;
  facts: KnowledgeFact[];
};

export type PublicKnowledgeDraftPreview = Omit<PublicKnowledgePage, 'provenance'> & {
  provenance: 'DRAFT PREVIEW';
  eligible: boolean;
  diagnostics: KnowledgeDiagnostic[];
};

function pageReferences(page: KnowledgePage | KnowledgeDraft): Array<{ ref: string; reason: string }> {
  const refs: Array<{ ref: string; reason: string }> = [];
  for (const ref of referencesIn(page.authorText)) refs.push({ ref, reason: 'author Markdown' });
  for (const ref of referencesIn(page.publicText)) refs.push({ ref, reason: 'public prose' });
  for (const ref of referencesIn(page.notesText)) refs.push({ ref, reason: 'author notes' });
  for (const fact of page.facts) {
    for (const ref of referencesIn(fact.value)) refs.push({ ref, reason: fact.label });
  }
  return refs;
}

export function buildKnowledgeCatalog(pages: readonly KnowledgePage[]): KnowledgeCatalog {
  const byRef = new Map<string, KnowledgePage>();
  const backlinks = new Map<string, KnowledgeBacklink[]>();
  const diagnostics: KnowledgeDiagnostic[] = pages.flatMap((page) => page.diagnostics);
  for (const page of pages) {
    const prior = byRef.get(page.ref);
    if (prior) {
      diagnostics.push({
        severity: 'error',
        code: 'ref-duplicate',
        message: `Ref "${page.ref}" is owned by both ${prior.path} and ${page.path}.`,
        path: page.path,
      });
    } else if (page.ref) byRef.set(page.ref, page);
  }
  for (const page of pages) {
    for (const link of pageReferences(page)) {
      if (!byRef.has(link.ref)) {
        diagnostics.push({ severity: 'warning', code: 'ref-unresolved', message: `Unresolved reference @[` + link.ref + `].`, path: page.path });
        continue;
      }
      const rows = backlinks.get(link.ref) ?? [];
      if (!rows.some((row) => row.fromRef === page.ref && row.reason === link.reason)) {
        rows.push({ fromRef: page.ref, fromName: page.name, reason: link.reason });
      }
      backlinks.set(link.ref, rows);
    }
  }
  for (const rows of backlinks.values()) rows.sort((a, b) => a.fromName.localeCompare(b.fromName));
  return { pages: [...pages], byRef, backlinks, diagnostics };
}

/**
 * Canonical compile boundary. A KnowledgeDraft is intentionally not accepted:
 * in-app edits have a separately named preview and cannot masquerade as disk.
 * Entity identity is explicitly public routing metadata; all authored body
 * content remains allowlisted by <public> or fact visibility="public".
 */
export function publicKnowledgeProjection(page: CanonicalKnowledgePage): PublicKnowledgePage | null {
  if (!hasCanonicalDiskProvenance(page)) return null;
  // Compile from the immutable source bytes, never caller-mutated semantic
  // fields. This also makes a structurally fabricated KnowledgePage fail shut.
  const canonical = parseKnowledgePage(page.source, page.path);
  if (!canonical || canonical.diagnostics.some((item) => item.severity === 'error')) return null;
  return {
    provenance: 'CANONICAL DISK',
    identity: { ref: canonical.ref, kind: canonical.kind, name: canonical.name, visibility: 'public-identity' },
    prose: canonical.publicText,
    facts: canonical.facts.filter((fact) => fact.visibility === 'public').map((fact) => ({ ...fact })),
  };
}

export function publicKnowledgeDraftPreview(page: KnowledgeDraft): PublicKnowledgeDraftPreview {
  const diagnostics = validateKnowledgeDraft(page, '<draft-preview>');
  const eligible = !diagnostics.some((item) => item.severity === 'error');
  return {
    provenance: 'DRAFT PREVIEW',
    eligible,
    diagnostics,
    identity: { ref: page.ref, kind: page.kind, name: page.name, visibility: 'public-identity' },
    prose: eligible ? page.publicText : '',
    facts: eligible ? page.facts.filter((fact) => fact.visibility === 'public').map((fact) => ({ ...fact })) : [],
  };
}

export function publicProjectionText(page: CanonicalKnowledgePage): string {
  const publicPage = publicKnowledgeProjection(page);
  if (!publicPage) return '';
  return [
    publicPage.identity.name,
    publicPage.prose,
    ...publicPage.facts.map((fact) => `${fact.label}: ${fact.value}`),
  ].join('\n');
}

export function searchKnowledgePages(
  pages: readonly KnowledgePage[],
  query: string,
  kind: KnowledgeKind | 'all' = 'all',
): KnowledgePage[] {
  const needle = query.trim().toLowerCase();
  return pages
    .filter((page) => kind === 'all' || page.kind === kind)
    .filter((page) => {
      if (!needle) return true;
      const haystack = [
        page.name,
        page.ref,
        page.kind,
        page.authorText,
        page.publicText,
        page.notesText,
        ...page.facts.flatMap((fact) => [fact.key, fact.label, fact.value]),
      ].join('\n').toLowerCase();
      return haystack.includes(needle);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function linksFromDraft(page: KnowledgeDraft): string[] {
  return [...new Set(pageReferences(page).map((entry) => entry.ref))];
}
