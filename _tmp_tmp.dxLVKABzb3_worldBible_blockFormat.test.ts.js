(() => {
  // cart/editor/worldBible/blockFormat.ts
  var KNOWLEDGE_KINDS = [
    "business",
    "person",
    "place",
    "position",
    "shift",
    "mechanic"
  ];
  var KIND_SET = new Set(KNOWLEDGE_KINDS);
  var VISIBILITY_SET = /* @__PURE__ */ new Set(["public", "secret", "author"]);
  var ENTITY_CHILD_TAGS = /* @__PURE__ */ new Set(["ref", "name", "logo", "fact", "public"]);
  var STRUCTURAL_TAGS = /* @__PURE__ */ new Set([...KNOWLEDGE_KINDS, ...ENTITY_CHILD_TAGS, "notes"]);
  var REF_VALUE_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/;
  var FACT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
  var REF_PATTERN = /@\[([A-Za-z0-9][A-Za-z0-9._:-]*)(?:\|[^\]]+)?\]/g;
  var STRUCTURAL_MARKUP_PATTERN = new RegExp(`<\\/?(?:${[...STRUCTURAL_TAGS].join("|")})(?:\\s|>)`, "i");
  function decodeAttribute(value) {
    return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  }
  function encodeAttribute(value) {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function displayBlockValue(raw) {
    return raw.trim();
  }
  function replacementBlockValue(raw, value) {
    if (!raw) return value;
    const leading = raw.match(/^\s*/)?.[0] ?? "";
    const trailing = raw.match(/\s*$/)?.[0] ?? "";
    if (leading.length + trailing.length > raw.length) return value;
    return `${leading}${value}${trailing}`;
  }
  function scanTags(source) {
    const diagnostics = [];
    const nodes = [];
    const stack = [];
    const pattern = /<(\/)?([A-Za-z][A-Za-z0-9_-]*)(?:\s[^<>]*?)?(\/?)>/g;
    let match;
    while (match = pattern.exec(source)) {
      const closing = !!match[1];
      const tag = match[2].toLowerCase();
      const selfClosing = !closing && !!match[3];
      const token = { start: match.index, end: match.index + match[0].length };
      if (!closing) {
        const node2 = {
          tag,
          parent: stack[stack.length - 1] ?? null,
          full: { ...token },
          open: { ...token },
          content: { start: token.end, end: token.end },
          close: { start: token.end, end: token.end },
          rawContent: "",
          complete: selfClosing
        };
        nodes.push(node2);
        if (!selfClosing) stack.push(node2);
        continue;
      }
      let matching = stack.length - 1;
      while (matching >= 0 && stack[matching].tag !== tag) matching -= 1;
      if (matching < 0) {
        if (STRUCTURAL_TAGS.has(tag)) diagnostics.push({ code: "block-close-unmatched", message: `Unmatched </${tag}> block close.` });
        continue;
      }
      for (let index = stack.length - 1; index > matching; index -= 1) {
        const unclosed = stack[index];
        if (STRUCTURAL_TAGS.has(unclosed.tag)) diagnostics.push({ code: "block-unclosed", message: `<${unclosed.tag}> is not closed before </${tag}>.` });
      }
      stack.length = matching + 1;
      const node = stack.pop();
      node.close = { ...token };
      node.content = { start: node.open.end, end: token.start };
      node.full = { start: node.open.start, end: token.end };
      node.rawContent = source.slice(node.content.start, node.content.end);
      node.complete = true;
    }
    for (const node of stack) {
      if (STRUCTURAL_TAGS.has(node.tag)) diagnostics.push({ code: "block-unclosed", message: `<${node.tag}> is missing </${node.tag}>.` });
    }
    return { nodes: nodes.filter((node) => node.complete), diagnostics };
  }
  function parseAttributes(source, open, tagName) {
    const prefixEnd = open.start + tagName.length + 1;
    const raw = source.slice(prefixEnd, open.end - 1);
    const attributes = [];
    const pattern = /([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(["'])(.*?)\2/g;
    let match;
    while (match = pattern.exec(raw)) {
      const quoteAt = match[0].indexOf(match[2], match[1].length);
      const valueStart = prefixEnd + match.index + quoteAt + 1;
      attributes.push({
        name: match[1],
        value: decodeAttribute(match[3]),
        valueSpan: { start: valueStart, end: valueStart + match[3].length }
      });
    }
    return attributes;
  }
  function lineOwnedSpan(source, span) {
    const lineStart = source.lastIndexOf("\n", Math.max(0, span.start - 1)) + 1;
    const before = source.slice(lineStart, span.start);
    if (before.trim()) return span;
    const newline = source.indexOf("\n", span.end);
    const afterEnd = newline < 0 ? source.length : newline + 1;
    const after = source.slice(span.end, newline < 0 ? source.length : newline);
    return after.trim() ? span : { start: lineStart, end: afterEnd };
  }
  function parseFacts(source, factTags, path, diagnostics) {
    const facts = [];
    const seen = /* @__PURE__ */ new Set();
    for (const tag of factTags) {
      const attrs = parseAttributes(source, tag.open, "fact");
      const keyAttr = attrs.find((attr) => attr.name === "key");
      const labelAttr = attrs.find((attr) => attr.name === "label");
      const visibilityAttr = attrs.find((attr) => attr.name === "visibility");
      for (const attributeName of ["key", "label", "visibility"]) {
        if (attrs.filter((attr) => attr.name === attributeName).length > 1) {
          diagnostics.push({ severity: "error", code: "fact-attribute-duplicate", message: `Fact attributes may declare "${attributeName}" only once.`, path });
        }
      }
      const key = keyAttr?.value.trim() ?? "";
      const label = labelAttr?.value.trim() || humanizeKey(key);
      const rawVisibility = visibilityAttr?.value.trim() ?? "";
      const visibility = VISIBILITY_SET.has(rawVisibility) ? rawVisibility : "author";
      if (!key) diagnostics.push({ severity: "error", code: "fact-key-missing", message: "Every fact requires a stable key.", path });
      else if (seen.has(key)) diagnostics.push({ severity: "error", code: "fact-key-duplicate", message: `Duplicate fact key "${key}".`, path });
      else seen.add(key);
      if (!visibilityAttr || !VISIBILITY_SET.has(rawVisibility)) {
        diagnostics.push({ severity: "error", code: "fact-visibility-invalid", message: `Fact "${key || "?"}" needs visibility="public", "secret", or "author".`, path });
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
        visibilitySpan: visibilityAttr?.valueSpan ?? null
      });
    }
    return facts;
  }
  function findPresentationHeading(source, root) {
    if (root.open.start <= 0) return null;
    const prefix = source.slice(0, root.open.start);
    const heading = /^((?:\uFEFF)?[ \t]*#[ \t]+)([^\r\n]*)(?:\r?\n|$)/.exec(prefix);
    if (!heading) return null;
    const start = heading[1].length;
    const content = { start, end: start + heading[2].length };
    return { content, rawContent: source.slice(content.start, content.end) };
  }
  function findAuthorPreamble(source, root) {
    if (root.open.start <= 0) return null;
    const prefix = source.slice(0, root.open.start);
    const heading = /^(?:\uFEFF)?[ \t]*#[^\r\n]*(?:\r?\n|$)/.exec(prefix);
    const start = heading?.[0].length ?? 0;
    const content = { start, end: root.open.start };
    return { content, rawContent: source.slice(content.start, content.end) };
  }
  function expectedPrefixes(kind) {
    if (kind === "business") return ["biz."];
    if (kind === "person") return ["npc.", "person."];
    return [`${kind}.`];
  }
  function validateScalar(value, label, path, diagnostics) {
    if (!value) diagnostics.push({ severity: "error", code: `${label}-missing`, message: `Missing <${label}> value.`, path });
    if (/[<>]/.test(value)) diagnostics.push({ severity: "error", code: `${label}-markup`, message: `<${label}> cannot contain nested markup.`, path });
    if (/\r|\n/.test(value)) diagnostics.push({ severity: "error", code: `${label}-multiline`, message: `<${label}> must stay on one line.`, path });
  }
  function addCardinalityDiagnostic(tags, tag, path, diagnostics, required) {
    const matches = tags.filter((node) => node.tag === tag);
    if (required && matches.length === 0) {
      diagnostics.push({ severity: "error", code: `${tag}-missing`, message: `Every entity requires exactly one <${tag}> direct child.`, path });
    }
    if (matches.length > 1) {
      diagnostics.push({ severity: "error", code: `${tag}-duplicate`, message: `An entity can have at most one direct <${tag}> block.`, path });
    }
    return matches[0] ?? null;
  }
  function humanizeKey(key) {
    return key.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Fact";
  }
  function freezeKnowledgePage(page) {
    const freezeSpan = (span) => {
      if (span) Object.freeze(span);
    };
    const freezeTag = (tag) => {
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
  function parseKnowledgePage(source, path = "<memory>") {
    const diagnostics = [];
    const scan = scanTags(source);
    diagnostics.push(...scan.diagnostics.map((item) => ({ severity: "error", ...item, path })));
    const roots = scan.nodes.filter((node) => node.parent === null && KIND_SET.has(node.tag));
    if (!roots.length) return null;
    const root = roots[0];
    const kind = root.tag;
    if (roots.length > 1) diagnostics.push({ severity: "error", code: "multiple-entities", message: "A World Bible file owns exactly one top-level entity block.", path });
    for (const node of scan.nodes) {
      if (!STRUCTURAL_TAGS.has(node.tag) || node === root) continue;
      const valid = node.tag === "notes" ? node.parent === null : ENTITY_CHILD_TAGS.has(node.tag) ? node.parent === root : false;
      if (!valid) {
        diagnostics.push({
          severity: "error",
          code: "block-nesting-invalid",
          message: `<${node.tag}> is structurally nested; entity fields must be direct children and <notes> must be a top-level sibling.`,
          path
        });
      }
    }
    const children = scan.nodes.filter((node) => node.parent === root);
    const topLevel = scan.nodes.filter((node) => node.parent === null);
    const refTag = addCardinalityDiagnostic(children, "ref", path, diagnostics, true);
    const nameTag = addCardinalityDiagnostic(children, "name", path, diagnostics, true);
    const logoTag = addCardinalityDiagnostic(children, "logo", path, diagnostics, false);
    const publicTag = addCardinalityDiagnostic(children, "public", path, diagnostics, false);
    const notesTag = addCardinalityDiagnostic(topLevel, "notes", path, diagnostics, false);
    const heading = findPresentationHeading(source, root);
    const authorText = findAuthorPreamble(source, root);
    const ref = displayBlockValue(refTag?.rawContent ?? "");
    const name = displayBlockValue(nameTag?.rawContent ?? "");
    const logo = displayBlockValue(logoTag?.rawContent ?? "");
    validateScalar(ref, "ref", path, diagnostics);
    validateScalar(name, "name", path, diagnostics);
    if (ref && !REF_VALUE_PATTERN.test(ref)) {
      diagnostics.push({ severity: "error", code: "ref-invalid", message: "Refs use lowercase letters, numbers, dot, underscore, colon, and hyphen only.", path });
    }
    if (ref && !expectedPrefixes(kind).some((prefix) => ref.startsWith(prefix))) {
      diagnostics.push({
        severity: "warning",
        code: "ref-prefix-kind-mismatch",
        message: `Ref "${ref}" does not follow the ${kind} prefix convention; <${kind}> remains authoritative.`,
        path
      });
    }
    const factNodes = parseFacts(source, children.filter((node) => node.tag === "fact"), path, diagnostics);
    return freezeKnowledgePage({
      path,
      source,
      kind,
      ref,
      name,
      logo,
      authorText: displayBlockValue(authorText?.rawContent ?? ""),
      publicText: displayBlockValue(publicTag?.rawContent ?? ""),
      notesText: displayBlockValue(notesTag?.rawContent ?? ""),
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
        facts: factNodes
      }
    });
  }
  function draftFromPage(page) {
    return {
      kind: page.kind,
      ref: page.ref,
      name: page.name,
      logo: page.logo,
      authorText: page.authorText,
      publicText: page.publicText,
      notesText: page.notesText,
      facts: page.facts.map((fact) => ({ ...fact }))
    };
  }
  function factMap(facts) {
    return new Map(facts.map((fact) => [fact.key, fact]));
  }
  function semanticChanges(base, draft) {
    const changes = [];
    const scalar = (key, label, before, after) => {
      if (before !== after) changes.push({ key, label, before, after });
    };
    scalar("kind", "Kind", base.kind, draft.kind);
    scalar("ref", "Stable ref", base.ref, draft.ref);
    scalar("name", "Name", base.name, draft.name);
    scalar("logo", "Logo", base.logo, draft.logo);
    scalar("author", "Author Markdown", base.authorText, draft.authorText);
    scalar("public", "Public prose", base.publicText, draft.publicText);
    scalar("notes", "Author notes", base.notesText, draft.notesText);
    const beforeFacts = factMap(base.facts);
    const afterFacts = factMap(draft.facts);
    const keys = /* @__PURE__ */ new Set([...beforeFacts.keys(), ...afterFacts.keys()]);
    for (const key of [...keys].sort()) {
      const before = beforeFacts.get(key);
      const after = afterFacts.get(key);
      if (!before && after) {
        changes.push({ key: `fact.${key}`, label: `Add fact \xB7 ${after.label}`, before: null, after: `${after.value} [${after.visibility}]` });
        continue;
      }
      if (before && !after) {
        changes.push({ key: `fact.${key}`, label: `Remove fact \xB7 ${before.label}`, before: `${before.value} [${before.visibility}]`, after: null });
        continue;
      }
      if (!before || !after) continue;
      if (before.label !== after.label) changes.push({ key: `fact.${key}.label`, label: `Fact label \xB7 ${key}`, before: before.label, after: after.label });
      if (before.value !== after.value) changes.push({ key: `fact.${key}.value`, label: `Fact value \xB7 ${after.label}`, before: before.value, after: after.value });
      if (before.visibility !== after.visibility) changes.push({ key: `fact.${key}.visibility`, label: `Fact visibility \xB7 ${after.label}`, before: before.visibility, after: after.visibility });
    }
    return changes;
  }
  function addContentReplacement(replacements, tag, value, owner) {
    if (!tag) return false;
    replacements.push({ span: tag.content, value: replacementBlockValue(tag.rawContent, value), owner });
    return true;
  }
  function applyReplacements(source, replacements) {
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
  function validateStructuralText(value, label, path, diagnostics) {
    if (STRUCTURAL_MARKUP_PATTERN.test(value)) {
      diagnostics.push({
        severity: "error",
        code: `${label}-structural-markup`,
        message: `${label} cannot contain World Bible block tags; write them as plain words instead.`,
        path
      });
    }
  }
  function validateKnowledgeDraft(draft, path) {
    const diagnostics = [];
    validateScalar(draft.ref.trim(), "ref", path, diagnostics);
    validateScalar(draft.name.trim(), "name", path, diagnostics);
    if (!KIND_SET.has(draft.kind)) diagnostics.push({ severity: "error", code: "kind-invalid", message: `Unsupported entity kind "${String(draft.kind)}".`, path });
    if (draft.ref && !REF_VALUE_PATTERN.test(draft.ref)) {
      diagnostics.push({ severity: "error", code: "ref-invalid", message: "Refs use lowercase letters, numbers, dot, underscore, colon, and hyphen only.", path });
    }
    if (draft.ref && KIND_SET.has(draft.kind) && !expectedPrefixes(draft.kind).some((prefix) => draft.ref.startsWith(prefix))) {
      diagnostics.push({ severity: "warning", code: "ref-prefix-kind-mismatch", message: `Ref "${draft.ref}" does not follow the ${draft.kind} prefix convention; kind remains authoritative.`, path });
    }
    if (draft.logo) validateScalar(draft.logo, "logo", path, diagnostics);
    validateStructuralText(draft.authorText, "Author Markdown", path, diagnostics);
    validateStructuralText(draft.publicText, "Public prose", path, diagnostics);
    validateStructuralText(draft.notesText, "Author notes", path, diagnostics);
    const seen = /* @__PURE__ */ new Set();
    for (const fact of draft.facts) {
      if (!fact.key.trim()) diagnostics.push({ severity: "error", code: "fact-key-missing", message: "Every fact requires a stable key.", path });
      else if (seen.has(fact.key)) diagnostics.push({ severity: "error", code: "fact-key-duplicate", message: `Duplicate fact key "${fact.key}".`, path });
      else seen.add(fact.key);
      if (fact.key && !FACT_KEY_PATTERN.test(fact.key)) diagnostics.push({ severity: "error", code: "fact-key-invalid", message: `Fact key "${fact.key}" uses lowercase letters, numbers, underscore, and hyphen only.`, path });
      if (!VISIBILITY_SET.has(fact.visibility)) diagnostics.push({ severity: "error", code: "fact-visibility-invalid", message: `Invalid visibility on fact "${fact.key}".`, path });
      validateStructuralText(fact.value, `Fact "${fact.key}"`, path, diagnostics);
    }
    return diagnostics;
  }
  function pageMatchesDraft(page, draft) {
    const same = (left, right) => left.trim() === right.trim();
    if (page.kind !== draft.kind || !same(page.ref, draft.ref) || !same(page.name, draft.name) || !same(page.logo, draft.logo) || !same(page.authorText, draft.authorText) || !same(page.publicText, draft.publicText) || !same(page.notesText, draft.notesText) || page.facts.length !== draft.facts.length) return false;
    const expected = factMap(draft.facts);
    return page.facts.every((fact) => {
      const wanted = expected.get(fact.key);
      return !!wanted && same(fact.label, wanted.label) && same(fact.value, wanted.value) && fact.visibility === wanted.visibility;
    });
  }
  function patchKnowledgePage(base, draft) {
    const changes = semanticChanges(base, draft);
    const draftDiagnostics = validateKnowledgeDraft(draft, base.path);
    if (draft.kind !== base.kind || draft.ref !== base.ref) {
      draftDiagnostics.push({
        severity: "error",
        code: "identity-edit-refused",
        message: "Kind and ref are stable identity in this slice; create a new page instead of rewriting them.",
        path: base.path
      });
    }
    if (draftDiagnostics.some((item) => item.severity === "error")) {
      return { ok: false, source: base.source, page: null, changes, diagnostics: draftDiagnostics };
    }
    const replacements = [];
    const insertions = [];
    if (base.name !== draft.name) {
      if (!addContentReplacement(replacements, base.syntax.name, draft.name, "name")) insertions.push(`  <name>${draft.name}</name>`);
      if (base.syntax.heading) {
        replacements.push({ span: base.syntax.heading.content, value: draft.name, owner: "Markdown heading" });
      }
    }
    if (base.logo !== draft.logo) {
      if (!addContentReplacement(replacements, base.syntax.logo, draft.logo, "logo")) insertions.push(`  <logo>${draft.logo}</logo>`);
    }
    if (base.authorText !== draft.authorText) {
      if (base.syntax.authorText) {
        replacements.push({
          span: base.syntax.authorText.content,
          value: replacementBlockValue(base.syntax.authorText.rawContent, draft.authorText),
          owner: "author Markdown"
        });
      } else {
        replacements.push({
          span: { start: base.syntax.root.open.start, end: base.syntax.root.open.start },
          value: draft.authorText ? `${draft.authorText}

` : "",
          owner: "author Markdown insertion"
        });
      }
    }
    if (base.publicText !== draft.publicText) {
      if (!addContentReplacement(replacements, base.syntax.publicText, draft.publicText, "public")) {
        insertions.push(`
  <public>
${draft.publicText}
  </public>`);
      }
    }
    if (base.notesText !== draft.notesText) {
      if (!addContentReplacement(replacements, base.syntax.notesText, draft.notesText, "notes")) {
        replacements.push({ span: { start: base.syntax.root.full.end, end: base.syntax.root.full.end }, value: `

<notes>
${draft.notesText}
</notes>`, owner: "notes insertion" });
      }
    }
    const baseFacts = new Map(base.syntax.facts.map((fact) => [fact.key, fact]));
    const draftFacts = factMap(draft.facts);
    for (const [key, node] of baseFacts) {
      const next = draftFacts.get(key);
      if (!next) {
        replacements.push({ span: node.lineSpan, value: "", owner: `fact.${key} removal` });
        continue;
      }
      if (node.value !== next.value) replacements.push({ span: node.contentSpan, value: replacementBlockValue(node.rawContent, next.value), owner: `fact.${key}.value` });
      if (node.visibility !== next.visibility) {
        if (!node.visibilitySpan) draftDiagnostics.push({ severity: "error", code: "fact-visibility-span-missing", message: `Cannot safely patch visibility for fact "${key}".`, path: base.path });
        else replacements.push({ span: node.visibilitySpan, value: encodeAttribute(next.visibility), owner: `fact.${key}.visibility` });
      }
      if (node.label !== next.label) {
        if (!node.labelSpan) draftDiagnostics.push({ severity: "error", code: "fact-label-span-missing", message: `Cannot safely patch label for fact "${key}" because the source has no label attribute.`, path: base.path });
        else replacements.push({ span: node.labelSpan, value: encodeAttribute(next.label), owner: `fact.${key}.label` });
      }
    }
    const newFacts = draft.facts.filter((fact) => !baseFacts.has(fact.key));
    const factInsertions = /* @__PURE__ */ new Map();
    for (const fact of newFacts) {
      const draftIndex = draft.facts.indexOf(fact);
      const nextExisting = draft.facts.slice(draftIndex + 1).find((candidate) => baseFacts.has(candidate.key) && draftFacts.has(candidate.key));
      const nextNode = nextExisting ? baseFacts.get(nextExisting.key) : null;
      const fallback = base.syntax.publicText?.full.start ?? base.syntax.root.close.start;
      const target = nextNode?.lineSpan.start ?? base.source.lastIndexOf("\n", Math.max(0, fallback - 1)) + 1;
      const rows = factInsertions.get(target) ?? [];
      rows.push(`  <fact key="${encodeAttribute(fact.key)}" label="${encodeAttribute(fact.label)}" visibility="${fact.visibility}">${fact.value}</fact>`);
      factInsertions.set(target, rows);
    }
    for (const [at, rows] of factInsertions) {
      replacements.push({ span: { start: at, end: at }, value: `${rows.join("\n")}
`, owner: "keyed fact insertion" });
    }
    if (insertions.length) {
      const at = base.syntax.publicText?.full.start ?? base.syntax.root.close.start;
      const prefix = at > 0 && base.source[at - 1] === "\n" ? "" : "\n";
      replacements.push({ span: { start: at, end: at }, value: `${prefix}${insertions.join("\n")}
`, owner: "keyed field insertion" });
    }
    if (draftDiagnostics.some((item) => item.severity === "error")) {
      return { ok: false, source: base.source, page: null, changes, diagnostics: draftDiagnostics };
    }
    let source;
    try {
      source = applyReplacements(base.source, replacements);
    } catch (error) {
      const diagnostics2 = [...draftDiagnostics, { severity: "error", code: "patch-overlap", message: error.message, path: base.path }];
      return { ok: false, source: base.source, page: null, changes, diagnostics: diagnostics2 };
    }
    const page = parseKnowledgePage(source, base.path);
    const diagnostics = [...draftDiagnostics, ...page?.diagnostics ?? [{ severity: "error", code: "reparse-failed", message: "Proposed text did not parse.", path: base.path }]];
    if (page && !pageMatchesDraft(page, draft)) diagnostics.push({ severity: "error", code: "semantic-roundtrip-mismatch", message: "The exact patch reparsed to different semantics than the reviewed draft.", path: base.path });
    return { ok: !!page && !diagnostics.some((item) => item.severity === "error"), source, page, changes, diagnostics };
  }
  function referencesIn(value) {
    const refs = [];
    REF_PATTERN.lastIndex = 0;
    let match;
    while (match = REF_PATTERN.exec(value)) refs.push(match[1]);
    return refs;
  }

  // cart/editor/worldBible/canonical.ts
  var canonicalPages = /* @__PURE__ */ new WeakSet();
  function hasCanonicalDiskProvenance(page) {
    return canonicalPages.has(page);
  }

  // cart/editor/worldBible/model.ts
  function pageReferences(page) {
    const refs = [];
    for (const ref of referencesIn(page.authorText)) refs.push({ ref, reason: "author Markdown" });
    for (const ref of referencesIn(page.publicText)) refs.push({ ref, reason: "public prose" });
    for (const ref of referencesIn(page.notesText)) refs.push({ ref, reason: "author notes" });
    for (const fact of page.facts) {
      for (const ref of referencesIn(fact.value)) refs.push({ ref, reason: fact.label });
    }
    return refs;
  }
  function buildKnowledgeCatalog(pages) {
    const byRef = /* @__PURE__ */ new Map();
    const backlinks = /* @__PURE__ */ new Map();
    const diagnostics = pages.flatMap((page) => page.diagnostics);
    for (const page of pages) {
      const prior = byRef.get(page.ref);
      if (prior) {
        diagnostics.push({
          severity: "error",
          code: "ref-duplicate",
          message: `Ref "${page.ref}" is owned by both ${prior.path} and ${page.path}.`,
          path: page.path
        });
      } else if (page.ref) byRef.set(page.ref, page);
    }
    for (const page of pages) {
      for (const link of pageReferences(page)) {
        if (!byRef.has(link.ref)) {
          diagnostics.push({ severity: "warning", code: "ref-unresolved", message: `Unresolved reference @[` + link.ref + `].`, path: page.path });
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
  function publicKnowledgeProjection(page) {
    if (!hasCanonicalDiskProvenance(page)) return null;
    const canonical = parseKnowledgePage(page.source, page.path);
    if (!canonical || canonical.diagnostics.some((item) => item.severity === "error")) return null;
    return {
      provenance: "CANONICAL DISK",
      identity: { ref: canonical.ref, kind: canonical.kind, name: canonical.name, visibility: "public-identity" },
      prose: canonical.publicText,
      facts: canonical.facts.filter((fact) => fact.visibility === "public").map((fact) => ({ ...fact }))
    };
  }
  function publicKnowledgeDraftPreview(page) {
    const diagnostics = validateKnowledgeDraft(page, "<draft-preview>");
    const eligible = !diagnostics.some((item) => item.severity === "error");
    return {
      provenance: "DRAFT PREVIEW",
      eligible,
      diagnostics,
      identity: { ref: page.ref, kind: page.kind, name: page.name, visibility: "public-identity" },
      prose: eligible ? page.publicText : "",
      facts: eligible ? page.facts.filter((fact) => fact.visibility === "public").map((fact) => ({ ...fact })) : []
    };
  }

  // cart/editor/worldBible/blockFormat.test.ts
  function draftPreviewText(page) {
    const preview = publicKnowledgeDraftPreview(draftFromPage(page));
    if (!preview.eligible) return "";
    return [
      preview.identity.name,
      preview.prose,
      ...preview.facts.map((fact) => `${fact.label}: ${fact.value}`)
    ].join("\n");
  }
  var passed = 0;
  var failed = 0;
  var log = globalThis.print ?? ((value) => globalThis.__writeStdout?.(`${value}
`));
  function test(name, fn) {
    try {
      fn();
      passed += 1;
      log(`  ok  ${name}`);
    } catch (error) {
      failed += 1;
      log(`FAIL  ${name}: ${error.message}`);
    }
  }
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
  var BUSINESS = `# CropDuster Labs

This loose paragraph is author-only and must survive exactly.
<!-- human formatting stays human-owned -->

<business>
  <ref>biz.cropduster_labs</ref>
  <name>CropDuster Labs</name>
  <logo>cart/editor/assets/cropduster.png</logo>

  <fact key="legal_name" label="Legal name" visibility="public">CropDuster Laboratories LLC</fact>
  <fact key="location" label="Location" visibility="public">@[place.east_mercer_depot]</fact>
  <fact key="disposal_practice" label="Disposal practice" visibility="secret">storm-drain dumping</fact>

  <public>
CropDuster Labs provides pest-control services throughout East Mercer.
  </public>
</business>

<notes>
The disposal-practice fact is a reveal. Do not put it in player copy.
</notes>
`;
  test("entity tag is authoritative and ref prefix is only a warning", () => {
    const mismatch = BUSINESS.replace("biz.cropduster_labs", "npc.cropduster_labs");
    const page = parseKnowledgePage(mismatch, "mismatch.md");
    assert(page?.kind === "business", "ref prefix overrode the entity tag");
    assert(page.diagnostics.some((item) => item.code === "ref-prefix-kind-mismatch" && item.severity === "warning"), "prefix mismatch was not visible");
  });
  test("missing and duplicate fact keys are hard errors", () => {
    const source = BUSINESS.replace(
      "</business>",
      '  <fact key="location" label="Other location" visibility="public">somewhere</fact>\n  <fact visibility="author">unkeyed</fact>\n</business>'
    );
    const page = parseKnowledgePage(source, "bad-facts.md");
    assert(page?.diagnostics.some((item) => item.code === "fact-key-duplicate" && item.severity === "error"), "duplicate key passed");
    assert(page?.diagnostics.some((item) => item.code === "fact-key-missing" && item.severity === "error"), "missing key passed");
  });
  test("duplicate fact attributes are rejected instead of choosing a public-looking first value", () => {
    const source = BUSINESS.replace(
      'visibility="secret">storm-drain dumping',
      'visibility="public" visibility="secret">SECRET ATTRIBUTE VALUE'
    );
    const page = parseKnowledgePage(source, "duplicate-attribute.md");
    assert(page?.diagnostics.some((item) => item.code === "fact-attribute-duplicate" && item.severity === "error"), "duplicate visibility attribute passed");
    assert(page && publicKnowledgeProjection(page) === null, "parsed malformed bytes entered canonical public output");
  });
  test("middle insertion is one keyed addition and reorder is not semantic churn", () => {
    const page = parseKnowledgePage(BUSINESS, "cropduster.md");
    assert(page, "fixture did not parse");
    const draft = draftFromPage(page);
    draft.facts.splice(1, 0, { key: "founded", label: "Founded", value: "1997", visibility: "public" });
    const inserted = semanticChanges(page, draft);
    assert(inserted.length === 1 && inserted[0].key === "fact.founded", `expected one keyed addition, got ${inserted.map((item) => item.key).join(", ")}`);
    const insertedPatch = patchKnowledgePage(page, draft);
    assert(insertedPatch.ok && insertedPatch.page, insertedPatch.diagnostics.map((item) => item.message).join("; "));
    const foundedAt = insertedPatch.source.indexOf('key="founded"');
    assert(foundedAt > insertedPatch.source.indexOf('key="legal_name"') && foundedAt < insertedPatch.source.indexOf('key="location"'), "middle insertion was appended instead of preserving requested order");
    assert(insertedPatch.page.facts.some((fact) => fact.key === "founded" && fact.value === "1997"), "middle insertion did not round-trip");
    const reordered = { ...draft, facts: [...draft.facts].reverse() };
    assert(semanticChanges(draft, reordered).length === 0, "presentation order became fact identity");
    const originalDraft = draftFromPage(page);
    const reorderOnly = { ...originalDraft, facts: [...originalDraft.facts].reverse() };
    const patched = patchKnowledgePage(page, reorderOnly);
    assert(patched.ok && patched.source === BUSINESS, "reorder-only draft rewrote canonical text");
  });
  test("loose author Markdown is parsed, patchable, and remains author-only", () => {
    const page = parseKnowledgePage(BUSINESS, "cropduster.md");
    assert(page?.authorText.includes("loose paragraph"), "author Markdown preamble was invisible");
    const draft = draftFromPage(page);
    draft.authorText = "A literal mechanic rule authored before runtime code.";
    const patched = patchKnowledgePage(page, draft);
    assert(patched.ok && patched.page?.authorText === draft.authorText, patched.diagnostics.map((item) => item.message).join("; "));
    assert(patched.source.startsWith("# CropDuster Labs\n\nA literal mechanic rule"), "author Markdown patch damaged the heading boundary");
    assert(!draftPreviewText(patched.page).includes("literal mechanic rule"), "author Markdown entered the public draft preview");
  });
  test("structural blocks must be direct children and malformed pages fail closed", () => {
    const nested = BUSINESS.replace(
      "storm-drain dumping</fact>",
      "prefix <public>SECRET NEEDLE</public></fact>"
    );
    const page = parseKnowledgePage(nested, "nested.md");
    assert(page?.diagnostics.some((item) => item.code === "block-nesting-invalid" && item.severity === "error"), "nested public block was accepted");
    assert(page && publicKnowledgeProjection(page) === null, "malformed parsed page emitted canonical public text");
    const crossed = BUSINESS.replace(
      "CropDuster Labs provides pest-control services throughout East Mercer.",
      "Visible <notes>SECRET NOTE</notes>"
    );
    const crossedPage = parseKnowledgePage(crossed, "crossed.md");
    assert(crossedPage?.diagnostics.some((item) => item.code === "block-nesting-invalid"), "notes nested inside public prose were accepted");
    assert(crossedPage && publicKnowledgeProjection(crossedPage) === null, "nested notes entered canonical public text");
  });
  test("draft validation rejects unresolvable refs and structural field injection", () => {
    const page = parseKnowledgePage(BUSINESS, "cropduster.md");
    assert(page, "fixture did not parse");
    const badRef = draftFromPage(page);
    badRef.ref = "biz.bad/path";
    assert(semanticChanges(page, badRef).some((change) => change.key === "ref"), "identity drift was invisible to dirty-state semantics");
    assert(!patchKnowledgePage(page, badRef).ok, "unresolvable ref passed validation");
    const injected = draftFromPage(page);
    injected.logo = 'logo.png</logo><fact key="leak" label="Leak" visibility="public">SECRET</fact><logo>';
    assert(!patchKnowledgePage(page, injected).ok, "logo field injected unreviewed public semantics");
  });
  test("span writer changes named fields and preserves unrelated bytes", () => {
    const page = parseKnowledgePage(BUSINESS, "cropduster.md");
    assert(page, "fixture did not parse");
    const draft = draftFromPage(page);
    draft.name = "CropDuster Municipal Services";
    draft.facts.find((fact) => fact.key === "location").value = "@[place.north_mercer_depot]";
    const result = patchKnowledgePage(page, draft);
    assert(result.ok && result.page, result.diagnostics.map((item) => item.message).join("; "));
    assert(result.source.includes("This loose paragraph is author-only and must survive exactly.\n<!-- human formatting stays human-owned -->"), "unowned prose changed");
    assert(result.source.startsWith("# CropDuster Municipal Services\n"), "name-owned Markdown heading did not patch");
    assert(result.source.includes("<name>CropDuster Municipal Services</name>"), "name span did not patch");
    assert(result.source.includes('<fact key="legal_name" label="Legal name" visibility="public">CropDuster Laboratories LLC</fact>'), "untouched fact was reserialized");
    assert(result.page.name === "CropDuster Municipal Services", "patched source did not reparse to the draft");
  });
  test("public projection is allowlisted and cannot leak notes, loose prose, or secret facts", () => {
    const page = parseKnowledgePage(BUSINESS, "cropduster.md");
    assert(page, "fixture did not parse");
    const projection = draftPreviewText(page);
    assert(projection.includes("provides pest-control services"), "public prose was omitted");
    assert(projection.includes("CropDuster Laboratories LLC"), "public fact was omitted");
    assert(!projection.includes("storm-drain dumping"), "secret fact leaked");
    assert(!projection.includes("disposal-practice fact is a reveal"), "notes leaked");
    assert(!projection.includes("loose paragraph"), "unwrapped author prose leaked");
    const forged = {
      ...page,
      publicText: page.notesText,
      facts: page.facts.map((fact) => ({ ...fact, visibility: "public" }))
    };
    const forgedProjection = publicKnowledgeProjection(forged);
    assert(forgedProjection === null, "fabricated semantic fields bypassed canonical provenance");
  });
  test("links and backlinks remain anchored to refs across a display rename", () => {
    const business = parseKnowledgePage(BUSINESS, "cropduster.md");
    const place = parseKnowledgePage(`<place>
<ref>place.east_mercer_depot</ref>
<name>East Mercer Depot</name>
<public>Old depot.</public>
</place>`, "depot.md");
    assert(business && place, "catalog fixtures did not parse");
    const renamed = parseKnowledgePage(place.source.replace("East Mercer Depot", "Mercer Service Yard"), "depot.md");
    assert(renamed, "renamed page did not parse");
    const catalog = buildKnowledgeCatalog([business, renamed]);
    assert(catalog.backlinks.get("place.east_mercer_depot")?.[0]?.fromRef === "biz.cropduster_labs", "rename broke the ref backlink");
  });
  log(`
world bible format: ${passed} passed, ${failed} failed`);
  if (failed) throw new Error(`${failed} world-bible format test(s) failed`);
})();
