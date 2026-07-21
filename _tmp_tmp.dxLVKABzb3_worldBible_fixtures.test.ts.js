(() => {
  // runtime/host-globals.ts
  var G = globalThis;

  // runtime/ffi.ts
  var host = G;
  function callHost(name, fallback, ...args) {
    const fn = host[name];
    if (typeof fn !== "function") return fallback;
    try {
      return fn(...args);
    } catch {
      return fallback;
    }
  }
  function callHostJson(name, fallback, ...args) {
    const raw = callHost(name, null, ...args);
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  var _listeners = /* @__PURE__ */ new Map();
  var _wildcardListeners = /* @__PURE__ */ new Set();
  function dispatchListeners(channel, payload) {
    const set = _listeners.get(channel);
    if (set && set.size > 0) {
      for (const fn of Array.from(set)) {
        try {
          fn(payload);
        } catch (e) {
          console.error(`[ffi] ${channel} listener error:`, e?.message || e);
        }
      }
    }
    if (_wildcardListeners.size > 0) {
      for (const fn of Array.from(_wildcardListeners)) {
        try {
          fn(channel, payload);
        } catch (e) {
          console.error(`[ffi] wildcard listener error on ${channel}:`, e?.message || e);
        }
      }
    }
  }
  G.__ffiEmit = (channel, payload) => {
    setTimeout(() => dispatchListeners(channel, payload), 0);
  };

  // runtime/hooks/fs.ts
  function readFile(path) {
    return callHost("__fs_read", null, path);
  }
  function writeFileBytesAtomic(path, bytes) {
    return callHost("__fs_write_bytes_atomic", false, path, bytes);
  }
  function writeFileBytesAtomicIfUnchanged(path, expected, bytes) {
    const status = callHost("__fs_write_bytes_atomic_if_unchanged", -1, path, expected, bytes);
    return status === 1 ? "written" : status === 0 ? "changed" : "failed";
  }
  function listDir(path) {
    return callHostJson("__fs_list_json", [], path);
  }
  function mkdir(path) {
    return callHost("__fs_mkdir", false, path);
  }

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
  function serializeNewKnowledgePage(path, draft) {
    const diagnostics = validateKnowledgeDraft(draft, path);
    if (diagnostics.some((item) => item.severity === "error")) return { ok: false, source: "", page: null, changes: [], diagnostics };
    const logo = draft.logo ? `
  <logo>${draft.logo}</logo>` : "";
    const facts = draft.facts.map((fact) => `  <fact key="${encodeAttribute(fact.key)}" label="${encodeAttribute(fact.label)}" visibility="${fact.visibility}">${fact.value}</fact>`).join("\n");
    const authorText = draft.authorText ? `${draft.authorText}

` : "";
    const source = `# ${draft.name}

${authorText}<${draft.kind}>
  <ref>${draft.ref}</ref>
  <name>${draft.name}</name>${logo}${facts ? `

${facts}` : ""}

  <public>
${draft.publicText}
  </public>
</${draft.kind}>

<notes>
${draft.notesText}
</notes>
`;
    const page = parseKnowledgePage(source, path);
    const allDiagnostics = [...diagnostics, ...page?.diagnostics ?? []];
    if (page && !pageMatchesDraft(page, draft)) allDiagnostics.push({ severity: "error", code: "semantic-roundtrip-mismatch", message: "The serialized page reparsed to different semantics than the reviewed draft.", path });
    const changes = [{ key: "page", label: `Create ${draft.kind}`, before: null, after: draft.ref }];
    return { ok: !!page && !allDiagnostics.some((item) => item.severity === "error"), source, page, changes, diagnostics: allDiagnostics };
  }
  function referencesIn(value) {
    const refs = [];
    REF_PATTERN.lastIndex = 0;
    let match;
    while (match = REF_PATTERN.exec(value)) refs.push(match[1]);
    return refs;
  }
  function sourcePatchPreview(before, after) {
    if (before === null) return after.split("\n").map((line) => `+ ${line}`).join("\n");
    const a = before.split("\n");
    const b = after.split("\n");
    const rows = ["@@ reviewed file @@"];
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
          if (a[i + distance] === b[j]) {
            deleteCount = distance;
            break;
          }
        }
      }
      if (i < a.length) {
        for (let distance = 1; distance <= LOOKAHEAD && j + distance < b.length; distance += 1) {
          if (b[j + distance] === a[i]) {
            insertCount = distance;
            break;
          }
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
    return rows.join("\n");
  }
  function kindIs(value) {
    return KIND_SET.has(value);
  }

  // cart/editor/worldBible/canonical.ts
  var canonicalPages = /* @__PURE__ */ new WeakSet();
  var CANONICAL_PATH = /^world\/knowledge\/[A-Za-z0-9][A-Za-z0-9._~-]*\.md$/;
  function readCanonicalKnowledgePage(path) {
    if (!CANONICAL_PATH.test(path) || path.includes("..")) return null;
    const source = readFile(path);
    if (source === null) return null;
    const page = parseKnowledgePage(source, path);
    if (!page) return null;
    canonicalPages.add(page);
    return page;
  }
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
  function buildKnowledgeCatalog(pages2) {
    const byRef = /* @__PURE__ */ new Map();
    const backlinks = /* @__PURE__ */ new Map();
    const diagnostics = pages2.flatMap((page) => page.diagnostics);
    for (const page of pages2) {
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
    for (const page of pages2) {
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
    return { pages: [...pages2], byRef, backlinks, diagnostics };
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
  function publicProjectionText(page) {
    const publicPage = publicKnowledgeProjection(page);
    if (!publicPage) return "";
    return [
      publicPage.identity.name,
      publicPage.prose,
      ...publicPage.facts.map((fact) => `${fact.label}: ${fact.value}`)
    ].join("\n");
  }

  // runtime/workspace/lumps.ts
  var LUMP_ENCODING = {
    raw: 0,
    rle8: 1,
    rle16: 2,
    text: 3
  };
  var ENCODING_BY_ID = {
    [LUMP_ENCODING.raw]: "raw",
    [LUMP_ENCODING.rle8]: "rle8",
    [LUMP_ENCODING.rle16]: "rle16",
    [LUMP_ENCODING.text]: "text"
  };
  function textBytes(text) {
    const encoder = globalThis.TextEncoder;
    if (typeof encoder === "function") return new encoder().encode(text);
    const binary = unescape(encodeURIComponent(text));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i) & 255;
    return out;
  }

  // runtime/workspace/sha256.ts
  var K = new Uint32Array([
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ]);
  function rotr(x, n) {
    return x >>> n | x << 32 - n;
  }
  function sha256(input) {
    const h = new Uint32Array([
      1779033703,
      3144134277,
      1013904242,
      2773480762,
      1359893119,
      2600822924,
      528734635,
      1541459225
    ]);
    const bitLen = input.length * 8;
    const withOne = input.length + 1;
    const blockCount = Math.ceil((withOne + 8) / 64);
    const padded = new Uint8Array(blockCount * 64);
    padded.set(input, 0);
    padded[input.length] = 128;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, Math.floor(bitLen / 4294967296) >>> 0, false);
    dv.setUint32(padded.length - 4, bitLen >>> 0, false);
    const w = new Uint32Array(64);
    for (let block = 0; block < blockCount; block += 1) {
      const base = block * 64;
      for (let i = 0; i < 16; i += 1) w[i] = dv.getUint32(base + i * 4, false);
      for (let i = 16; i < 64; i += 1) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ w[i - 15] >>> 3;
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ w[i - 2] >>> 10;
        w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i += 1) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = e & f ^ ~e & g;
        const t1 = hh + S1 + ch + K[i] + w[i] >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = a & b ^ a & c ^ b & c;
        const t2 = S0 + maj >>> 0;
        hh = g;
        g = f;
        f = e;
        e = d + t1 >>> 0;
        d = c;
        c = b;
        b = a;
        a = t1 + t2 >>> 0;
      }
      h[0] = h[0] + a >>> 0;
      h[1] = h[1] + b >>> 0;
      h[2] = h[2] + c >>> 0;
      h[3] = h[3] + d >>> 0;
      h[4] = h[4] + e >>> 0;
      h[5] = h[5] + f >>> 0;
      h[6] = h[6] + g >>> 0;
      h[7] = h[7] + hh >>> 0;
    }
    const out = new Uint8Array(32);
    const outDv = new DataView(out.buffer);
    for (let i = 0; i < 8; i += 1) outDv.setUint32(i * 4, h[i], false);
    return out;
  }
  var HEX = "0123456789abcdef";
  function toHex(bytes) {
    let out = "";
    for (const byte of bytes) out += HEX[byte >>> 4 & 15] + HEX[byte & 15];
    return out;
  }
  function sha256Hex(input) {
    return toHex(sha256(input));
  }

  // cart/editor/worldBible/session.ts
  var KNOWLEDGE_PATH_PREFIX = "world/knowledge/";
  function isKnowledgeSourcePath(path) {
    if (!path.startsWith(KNOWLEDGE_PATH_PREFIX) || path.includes("\\") || path.includes("\0")) return false;
    const name = path.slice(KNOWLEDGE_PATH_PREFIX.length);
    return !!name && !name.includes("/") && !name.includes("..") && /^[A-Za-z0-9][A-Za-z0-9._~-]*\.md$/.test(name);
  }
  function sourceHash(source) {
    return source === null ? null : sha256Hex(textBytes(source));
  }
  function openKnowledgeSession(path, source) {
    const page = parseKnowledgePage(source, path);
    if (!page) throw new Error(`${path} does not contain one supported World Bible entity`);
    const hash = sourceHash(source);
    return {
      path,
      baseSource: source,
      baseHash: hash,
      basePage: page,
      diskSource: source,
      diskHash: hash,
      draft: draftFromPage(page)
    };
  }
  function newKnowledgeSession(path, draft) {
    return {
      path,
      baseSource: null,
      baseHash: null,
      basePage: null,
      diskSource: null,
      diskHash: null,
      draft: cloneDraft(draft)
    };
  }
  function cloneDraft(draft) {
    return { ...draft, facts: draft.facts.map((fact) => ({ ...fact })) };
  }
  function setKnowledgeDraft(session, draft) {
    return { ...session, draft: cloneDraft(draft) };
  }
  function refreshKnowledgeDisk(session, currentSource) {
    return { ...session, diskSource: currentSource, diskHash: sourceHash(currentSource) };
  }
  function knowledgeDraftChanged(session) {
    if (!session.basePage) return true;
    return semanticChanges(session.basePage, session.draft).length > 0;
  }
  function knowledgeSourceState(session) {
    const draftChanged = knowledgeDraftChanged(session);
    const diskChanged = session.diskHash !== session.baseHash;
    if (draftChanged && diskChanged) return "CONFLICT";
    if (diskChanged) return "DISK CHANGED";
    if (draftChanged) return "DRAFT CHANGED";
    return "DISK";
  }
  function revertKnowledgeDraft(session) {
    if (!session.basePage) return session;
    return { ...session, draft: draftFromPage(session.basePage) };
  }
  function reloadKnowledgeFromDisk(session) {
    if (session.diskSource === null) throw new Error(`${session.path} no longer exists on disk`);
    return openKnowledgeSession(session.path, session.diskSource);
  }
  function renderProposal(session) {
    return session.basePage ? patchKnowledgePage(session.basePage, session.draft) : serializeNewKnowledgePage(session.path, session.draft);
  }
  function proposalDigest(proposal) {
    return sha256Hex(textBytes(JSON.stringify({
      path: proposal.path,
      expectedDiskHash: proposal.expectedDiskHash,
      before: proposal.before,
      after: proposal.after,
      patch: proposal.patch,
      changes: proposal.changes,
      diagnostics: proposal.diagnostics
    })));
  }
  function frozenProposal(body) {
    const changes = Object.freeze(body.changes.map((change) => Object.freeze({ ...change })));
    const diagnostics = Object.freeze(body.diagnostics.map((item) => Object.freeze({ ...item })));
    const frozenBody = { ...body, changes, diagnostics };
    return Object.freeze({ id: proposalDigest(frozenBody), ...frozenBody });
  }
  function prepareKnowledgeWrite(session, currentDiskSource) {
    const refreshed = refreshKnowledgeDisk(session, currentDiskSource);
    const state = knowledgeSourceState(refreshed);
    if (!isKnowledgeSourcePath(refreshed.path)) {
      return { ok: false, session: refreshed, state, error: "The proposed World Bible path is outside the canonical one-page directory.", diagnostics: [] };
    }
    if (refreshed.diskHash !== refreshed.baseHash) {
      return {
        ok: false,
        session: refreshed,
        state,
        error: state === "CONFLICT" ? "Both the draft and the canonical file changed. Reload or resolve the text outside the writer." : "The canonical file changed on disk. Reload it before preparing a write.",
        diagnostics: []
      };
    }
    if (!knowledgeDraftChanged(refreshed)) {
      return { ok: false, session: refreshed, state, error: "The draft matches disk; there is nothing to write.", diagnostics: [] };
    }
    const rendered = renderProposal(refreshed);
    if (!rendered.ok || !rendered.page) {
      return { ok: false, session: refreshed, state, error: "The proposed source does not pass World Bible validation.", diagnostics: rendered.diagnostics };
    }
    const body = {
      path: refreshed.path,
      expectedDiskHash: refreshed.baseHash,
      before: refreshed.baseSource,
      after: rendered.source,
      patch: sourcePatchPreview(refreshed.baseSource, rendered.source),
      changes: rendered.changes,
      diagnostics: rendered.diagnostics
    };
    return {
      ok: true,
      session: refreshed,
      proposal: frozenProposal(body)
    };
  }
  function confirmKnowledgeWrite(session, proposal, port) {
    if (!isKnowledgeSourcePath(session.path) || !isKnowledgeSourcePath(proposal.path) || proposal.path !== session.path) {
      return { ok: false, session, state: knowledgeSourceState(session), error: "The proposal targets a different file." };
    }
    if (proposal.id !== proposalDigest(proposal)) {
      return { ok: false, session, state: knowledgeSourceState(session), error: "The reviewed proposal payload was altered. Nothing was written." };
    }
    if (proposal.before !== session.baseSource || proposal.expectedDiskHash !== session.baseHash) {
      return { ok: false, session, state: knowledgeSourceState(session), error: "The proposal no longer belongs to this loaded disk base." };
    }
    const rerendered = renderProposal(session);
    if (!rerendered.ok || !rerendered.page || rerendered.source !== proposal.after || sourcePatchPreview(session.baseSource, rerendered.source) !== proposal.patch || JSON.stringify(rerendered.changes) !== JSON.stringify(proposal.changes) || JSON.stringify(rerendered.diagnostics) !== JSON.stringify(proposal.diagnostics)) {
      return { ok: false, session, state: knowledgeSourceState(session), error: "The draft changed after review. Prepare a fresh exact patch." };
    }
    const current = port.read(session.path);
    const refreshed = refreshKnowledgeDisk(session, current);
    if (sourceHash(current) !== proposal.expectedDiskHash) {
      return { ok: false, session: refreshed, state: knowledgeSourceState(refreshed), error: "Canonical disk bytes changed after review. Nothing was written." };
    }
    const reparsed = parseKnowledgePage(proposal.after, session.path);
    if (!reparsed || reparsed.diagnostics.some((item) => item.severity === "error")) {
      return { ok: false, session: refreshed, state: knowledgeSourceState(refreshed), error: "The reviewed proposal no longer parses cleanly." };
    }
    const compareWrite = port.writeAtomicIfUnchanged ? port.writeAtomicIfUnchanged(session.path, proposal.before, proposal.after) : sourceHash(port.read(session.path)) !== proposal.expectedDiskHash ? "changed" : port.writeAtomic(session.path, proposal.after) ? "written" : "failed";
    if (compareWrite === "changed") {
      const changed = refreshKnowledgeDisk(refreshed, port.read(session.path));
      return { ok: false, session: changed, state: knowledgeSourceState(changed), error: "Canonical disk bytes changed during the final expected-content check. Nothing was written." };
    }
    if (compareWrite === "failed") {
      const afterFailure = refreshKnowledgeDisk(refreshed, port.read(session.path));
      return {
        ok: false,
        session: afterFailure,
        state: knowledgeSourceState(afterFailure),
        error: afterFailure.diskSource === proposal.after ? "Reviewed bytes reached canonical disk, but the durability check failed. Reload and verify before continuing." : "Atomic write failed; canonical disk bytes were not accepted."
      };
    }
    const persisted = port.read(session.path);
    if (persisted !== proposal.after) {
      const afterFailure = refreshKnowledgeDisk(refreshed, persisted);
      return { ok: false, session: afterFailure, state: knowledgeSourceState(afterFailure), error: "Write verification failed: disk does not contain the reviewed bytes." };
    }
    const next = openKnowledgeSession(session.path, persisted);
    return { ok: true, session: next, page: next.basePage };
  }

  // cart/editor/worldBible/controller.ts
  var WORLD_KNOWLEDGE_ROOT = "world/knowledge";
  var WORLD_BIBLE_RECOVERY_FILE = "zig-out/game/editor/world-bible-drafts/session.json";
  var hostPort = {
    read: (path) => readFile(path),
    list: (path) => listDir(path),
    writeAtomic: (path, source) => writeFileBytesAtomic(path, textBytes(source)),
    writeAtomicIfUnchanged: (path, expectedSource, source) => writeFileBytesAtomicIfUnchanged(
      path,
      expectedSource === null ? null : textBytes(expectedSource),
      textBytes(source)
    )
  };
  function pathForRef(ref) {
    const trimmed = ref.trim();
    const stem = /^[a-z0-9][a-z0-9._:-]*$/.test(trimmed) ? trimmed.replace(/:/g, "~c") : [...trimmed].map((character) => /[a-z0-9-]/.test(character) ? character : `~${character.codePointAt(0).toString(16)}~`).join("") || "untitled";
    return `${WORLD_KNOWLEDGE_ROOT}/${stem}.md`;
  }
  function directoryEntries(port) {
    let entries = [];
    try {
      entries = port.list ? port.list(WORLD_KNOWLEDGE_ROOT) : listDir(WORLD_KNOWLEDGE_ROOT);
    } catch {
      entries = [];
    }
    return entries;
  }
  function pageFiles(port) {
    const entries = directoryEntries(port);
    return entries.filter((entry) => entry.endsWith(".md") && !entry.startsWith(".") && !entry.startsWith("_")).sort().map((entry) => `${WORLD_KNOWLEDGE_ROOT}/${entry}`);
  }
  function emptyDraft(kind, sequence) {
    const prefix = kind === "business" ? "biz" : kind === "person" ? "npc" : kind;
    const ref = `${prefix}.untitled_${sequence}`;
    return {
      kind,
      ref,
      name: `Untitled ${kind[0].toUpperCase()}${kind.slice(1)}`,
      logo: "",
      authorText: "",
      publicText: "",
      notesText: "",
      facts: []
    };
  }
  function sortSessions(sessions) {
    return [...sessions].sort((a, b) => a.draft.name.localeCompare(b.draft.name) || a.draft.ref.localeCompare(b.draft.ref));
  }
  function recoveryDraft(value) {
    if (!value || typeof value !== "object") return null;
    const raw = value;
    if (typeof raw.kind !== "string" || !kindIs(raw.kind) || typeof raw.ref !== "string" || typeof raw.name !== "string") return null;
    if (typeof raw.logo !== "string" || typeof raw.publicText !== "string" || typeof raw.notesText !== "string" || !Array.isArray(raw.facts)) return null;
    const authorText = raw.authorText === void 0 ? "" : raw.authorText;
    if (typeof authorText !== "string") return null;
    const facts = [];
    for (const valueFact of raw.facts) {
      if (!valueFact || typeof valueFact !== "object") return null;
      const fact = valueFact;
      if (typeof fact.key !== "string" || typeof fact.label !== "string" || typeof fact.value !== "string") return null;
      if (fact.visibility !== "public" && fact.visibility !== "secret" && fact.visibility !== "author") return null;
      facts.push({ key: fact.key, label: fact.label, value: fact.value, visibility: fact.visibility });
    }
    return { kind: raw.kind, ref: raw.ref, name: raw.name, logo: raw.logo, authorText, publicText: raw.publicText, notesText: raw.notesText, facts };
  }
  var WORLD_BIBLE_CONTROLLER_TUNING = {
    recoveryDebounceMs: 240,
    diagnosticsDebounceMs: 180,
    diskRefreshCoalesceMs: 90
  };
  function scheduleTask(callback, delayMs) {
    const schedule = globalThis.setTimeout;
    return typeof schedule === "function" ? schedule(callback, delayMs) : null;
  }
  function cancelTask(id) {
    const cancel = globalThis.clearTimeout;
    if (typeof cancel === "function") cancel(id);
  }
  function catalogPageForSession(session) {
    return {
      ...session.basePage ?? {},
      ...session.draft,
      path: session.path,
      source: session.diskSource ?? session.baseSource ?? "",
      diagnostics: session.basePage?.diagnostics ?? []
    };
  }
  function dedupeDiagnostics(diagnostics) {
    const seen = /* @__PURE__ */ new Set();
    const result = [];
    for (const diagnostic of diagnostics) {
      const key = `${diagnostic.severity}\0${diagnostic.code}\0${diagnostic.path ?? ""}\0${diagnostic.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(diagnostic);
    }
    return result;
  }
  var WorldBibleController = class {
    constructor(port = hostPort) {
      this.port = port;
    }
    port;
    sessions = [];
    selectedRef = null;
    selectedPath = null;
    query = "";
    kindFilter = "all";
    mode = "read";
    proposal = null;
    pendingDiscard = null;
    pendingDiscardPath = null;
    notice = "";
    diagnostics = [];
    transientDiagnostics = [];
    controllerDiagnostics = /* @__PURE__ */ new Map();
    recoveryTimer = null;
    diagnosticsTimer = null;
    diskRefreshTimer = null;
    recoveryRewriteBlockReason = null;
    recoverySource = null;
    recoveryNeedsWrite = false;
    loaded = false;
    revision = 0;
    listeners = /* @__PURE__ */ new Set();
    subscribe(listener) {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    }
    snapshot() {
      return {
        loaded: this.loaded,
        sessions: this.sessions,
        selectedRef: this.selectedRef,
        selectedPath: this.selectedPath,
        query: this.query,
        kindFilter: this.kindFilter,
        mode: this.mode,
        proposal: this.proposal,
        pendingDiscard: this.pendingDiscard,
        notice: this.notice,
        diagnostics: this.diagnostics,
        revision: this.revision
      };
    }
    publish() {
      this.revision += 1;
      for (const listener of this.listeners) listener();
    }
    replaceSession(previous, next) {
      const replaced = this.sessions.map((session) => session === previous ? next : session);
      this.sessions = previous.draft.name !== next.draft.name || previous.draft.ref !== next.draft.ref ? sortSessions(replaced) : replaced;
      if (this.selectedPath === previous.path) this.selectedPath = next.path;
      if (this.selectedPath === next.path) this.selectedRef = next.draft.ref;
    }
    recomputeDiagnostics() {
      if (this.diagnosticsTimer !== null) {
        cancelTask(this.diagnosticsTimer);
        this.diagnosticsTimer = null;
      }
      const catalog = buildKnowledgeCatalog(this.sessions.map(catalogPageForSession));
      const pathOwners = /* @__PURE__ */ new Map();
      for (const session of this.sessions) {
        const owners = pathOwners.get(session.path) ?? [];
        owners.push(session);
        pathOwners.set(session.path, owners);
      }
      const pathDiagnostics = [];
      for (const [path, owners] of pathOwners) {
        if (owners.length < 2) continue;
        pathDiagnostics.push({
          severity: "error",
          code: "path-duplicate",
          message: `Canonical path "${path}" is targeted by ${owners.map((owner) => owner.draft.ref).join(", ")}.`,
          path
        });
      }
      this.diagnostics = dedupeDiagnostics([
        ...this.controllerDiagnostics.values(),
        ...catalog.diagnostics,
        ...pathDiagnostics,
        ...this.transientDiagnostics
      ]);
    }
    scheduleDiagnostics() {
      if (this.diagnosticsTimer !== null) cancelTask(this.diagnosticsTimer);
      const timer = scheduleTask(() => {
        this.diagnosticsTimer = null;
        this.recomputeDiagnostics();
        this.publish();
      }, WORLD_BIBLE_CONTROLLER_TUNING.diagnosticsDebounceMs);
      if (timer === null) this.recomputeDiagnostics();
      else this.diagnosticsTimer = timer;
    }
    clearTransientDiagnostics() {
      this.transientDiagnostics = [];
    }
    clearPendingDiscard() {
      this.pendingDiscard = null;
      this.pendingDiscardPath = null;
    }
    recoveryEntries() {
      return this.sessions.filter(knowledgeDraftChanged).map((session) => ({ path: session.path, baseSource: session.baseSource, draft: session.draft }));
    }
    writeRecoveryNow() {
      if (this.recoveryTimer !== null) {
        cancelTask(this.recoveryTimer);
        this.recoveryTimer = null;
      }
      if (this.recoveryRewriteBlockReason) {
        const hadDiagnostic = this.controllerDiagnostics.has("recovery-rewrite-blocked");
        this.controllerDiagnostics.set("recovery-rewrite-blocked", {
          severity: "error",
          code: "draft-recovery-rewrite-blocked",
          message: `${this.recoveryRewriteBlockReason} The existing recovery file was preserved byte-for-byte. Resolve ${WORLD_BIBLE_RECOVERY_FILE} manually before relying on new draft recovery.`,
          path: WORLD_BIBLE_RECOVERY_FILE
        });
        if (!hadDiagnostic) this.recomputeDiagnostics();
        return false;
      }
      const hadFailure = this.controllerDiagnostics.has("recovery-write") || this.controllerDiagnostics.has("recovery-concurrent-change");
      const nextSource = JSON.stringify({ version: 1, entries: this.recoveryEntries() });
      let result = "failed";
      try {
        mkdir("zig-out/game/editor/world-bible-drafts");
        result = this.port.writeAtomicIfUnchanged ? this.port.writeAtomicIfUnchanged(WORLD_BIBLE_RECOVERY_FILE, this.recoverySource, nextSource) : this.port.read(WORLD_BIBLE_RECOVERY_FILE) !== this.recoverySource ? "changed" : this.port.writeAtomic(WORLD_BIBLE_RECOVERY_FILE, nextSource) ? "written" : "failed";
      } catch {
        result = "failed";
      }
      const ok = result === "written";
      if (ok) {
        this.recoverySource = nextSource;
        this.recoveryNeedsWrite = false;
        this.controllerDiagnostics.delete("recovery-write");
        this.controllerDiagnostics.delete("recovery-concurrent-change");
      } else if (result === "changed") {
        this.recoveryRewriteBlockReason = "Another editor process changed the recovery envelope after this process loaded it.";
        this.controllerDiagnostics.set("recovery-concurrent-change", {
          severity: "error",
          code: "draft-recovery-concurrent-change",
          message: `Another editor process changed ${WORLD_BIBLE_RECOVERY_FILE}; its drafts were preserved and this process will not overwrite them.`,
          path: WORLD_BIBLE_RECOVERY_FILE
        });
      } else {
        if (this.port.read(WORLD_BIBLE_RECOVERY_FILE) === nextSource) {
          this.recoverySource = nextSource;
          this.recoveryNeedsWrite = true;
        }
        this.controllerDiagnostics.set("recovery-write", {
          severity: "error",
          code: "draft-recovery-write-failed",
          message: this.recoverySource === nextSource ? `Draft recovery bytes reached ${WORLD_BIBLE_RECOVERY_FILE}, but the durability check failed. The draft remains in memory and will be retried.` : `Draft recovery could not be written to ${WORLD_BIBLE_RECOVERY_FILE}. The in-memory draft is still present, but it will not survive a restart.`,
          path: WORLD_BIBLE_RECOVERY_FILE
        });
      }
      const hasFailure = this.controllerDiagnostics.has("recovery-write") || this.controllerDiagnostics.has("recovery-concurrent-change");
      if (hadFailure !== hasFailure) this.recomputeDiagnostics();
      return ok;
    }
    scheduleRecovery() {
      if (this.recoveryTimer !== null) cancelTask(this.recoveryTimer);
      this.recoveryTimer = scheduleTask(() => {
        this.recoveryTimer = null;
        const hadFailure = this.controllerDiagnostics.has("recovery-write");
        const ok = this.writeRecoveryNow();
        if (!ok || hadFailure) this.publish();
      }, WORLD_BIBLE_CONTROLLER_TUNING.recoveryDebounceMs);
    }
    /** Force the coalesced noncanonical recovery envelope to durable storage. */
    flushRecovery() {
      const ok = this.writeRecoveryNow();
      this.publish();
      return ok;
    }
    persistRecovery() {
      this.recoveryNeedsWrite = true;
      this.scheduleRecovery();
    }
    recoverDrafts(sessions, diagnostics) {
      const source = this.port.read(WORLD_BIBLE_RECOVERY_FILE);
      this.recoverySource = source;
      if (source === null) return { sessions, count: 0 };
      const rejectRecovery = (code, message, path = WORLD_BIBLE_RECOVERY_FILE) => {
        this.recoveryRewriteBlockReason = message;
        diagnostics.push({
          severity: "error",
          code,
          message: `${message} The original recovery file was preserved and automatic rewrites are blocked.`,
          path
        });
      };
      let raw;
      try {
        raw = JSON.parse(source);
      } catch {
        rejectRecovery("draft-recovery-invalid", `Could not parse ${WORLD_BIBLE_RECOVERY_FILE}.`);
        return { sessions, count: 0 };
      }
      if (!raw || typeof raw !== "object" || raw.version !== 1 || !Array.isArray(raw.entries)) {
        rejectRecovery("draft-recovery-version-unsupported", `Unsupported recovery envelope in ${WORLD_BIBLE_RECOVERY_FILE}.`);
        return { sessions, count: 0 };
      }
      let next = [...sessions];
      let count = 0;
      const recoveredPaths = /* @__PURE__ */ new Set();
      for (const value of raw.entries) {
        if (!value || typeof value !== "object") {
          rejectRecovery("draft-recovery-entry-invalid", "A recovery entry is not an object.");
          continue;
        }
        const entry = value;
        if (typeof entry.path !== "string" || !isKnowledgeSourcePath(entry.path) || !entry.path.startsWith(`${WORLD_KNOWLEDGE_ROOT}/`)) {
          rejectRecovery("draft-recovery-path-invalid", "A recovered draft targets a path outside the canonical World Bible directory.");
          continue;
        }
        if (recoveredPaths.has(entry.path)) {
          rejectRecovery("draft-recovery-path-duplicate", `A second recovered draft targets ${entry.path}.`, entry.path);
          continue;
        }
        recoveredPaths.add(entry.path);
        const draft = recoveryDraft(entry.draft);
        const baseSource = typeof entry.baseSource === "string" ? entry.baseSource : entry.baseSource === null ? null : void 0;
        if (!draft || baseSource === void 0) {
          rejectRecovery("draft-recovery-entry-invalid", `The recovered draft for ${entry.path} has an unsupported shape.`, entry.path);
          continue;
        }
        try {
          let recovered = baseSource === null ? newKnowledgeSession(entry.path, draft) : setKnowledgeDraft(openKnowledgeSession(entry.path, baseSource), draft);
          recovered = refreshKnowledgeDisk(recovered, this.port.read(entry.path));
          const existing = next.findIndex((session) => session.path === entry.path);
          if (existing >= 0) next[existing] = recovered;
          else next.push(recovered);
          count += 1;
        } catch {
          rejectRecovery("draft-recovery-entry-invalid", `The recovered draft for ${entry.path} is invalid.`, entry.path);
        }
      }
      return { sessions: sortSessions(next), count };
    }
    /**
     * The native conditional writer leaves a synchronized `<temp, previous>`
     * pair if the process dies after claiming the canonical pathname but before
     * installing the reviewed proposal. Restore only that explicit pair. A lone
     * history backup never resurrects a file intentionally deleted on disk.
     */
    recoverInterruptedCanonicalClaims(diagnostics) {
      const claims = directoryEntries(this.port).map((entry) => {
        const match = /^([A-Za-z0-9][A-Za-z0-9._~-]*\.md)\.tmp\.([0-9]+)\.previous$/.exec(entry);
        return match ? { canonical: match[1], stamp: match[2], backup: entry, temp: entry.slice(0, -".previous".length) } : null;
      }).filter((claim) => claim !== null).sort((left, right) => right.stamp.length - left.stamp.length || right.stamp.localeCompare(left.stamp));
      let restored = 0;
      for (const claim of claims) {
        const canonicalPath = `${WORLD_KNOWLEDGE_ROOT}/${claim.canonical}`;
        if (this.port.read(canonicalPath) !== null) continue;
        const tempPath = `${WORLD_KNOWLEDGE_ROOT}/${claim.temp}`;
        const backupPath = `${WORLD_KNOWLEDGE_ROOT}/${claim.backup}`;
        if (this.port.read(tempPath) === null) continue;
        const source = this.port.read(backupPath);
        if (source === null) continue;
        const result = this.port.writeAtomicIfUnchanged ? this.port.writeAtomicIfUnchanged(canonicalPath, null, source) : this.port.read(canonicalPath) === null && this.port.writeAtomic(canonicalPath, source) ? "written" : "changed";
        if (result === "written") {
          restored += 1;
          diagnostics.push({
            severity: "warning",
            code: "canonical-claim-restored",
            message: `Restored ${canonicalPath} from a durable interrupted-write claim. The reviewed proposal temp and prior-version backup were preserved for inspection.`,
            path: canonicalPath
          });
        } else if (result === "failed" && this.port.read(canonicalPath) === source) {
          diagnostics.push({
            severity: "error",
            code: "canonical-claim-restore-durability",
            message: `Restored bytes reached ${canonicalPath}, but directory durability could not be confirmed. Verify the source before continuing.`,
            path: canonicalPath
          });
        } else if (this.port.read(canonicalPath) === null) {
          diagnostics.push({
            severity: "error",
            code: "canonical-claim-restore-failed",
            message: `Could not restore the interrupted canonical claim at ${backupPath}; both recovery artifacts were preserved.`,
            path: canonicalPath
          });
        }
      }
      return restored;
    }
    ensureLoaded() {
      if (this.loaded) return;
      mkdir(WORLD_KNOWLEDGE_ROOT);
      const sessions = [];
      const diagnostics = [];
      const restoredClaims = this.recoverInterruptedCanonicalClaims(diagnostics);
      for (const path of pageFiles(this.port)) {
        const source = this.port.read(path);
        if (source === null) continue;
        const page = parseKnowledgePage(source, path);
        if (!page) {
          diagnostics.push({ severity: "error", code: "entity-missing", message: "No supported entity block found.", path });
          continue;
        }
        sessions.push(openKnowledgeSession(path, source));
      }
      const recovered = this.recoverDrafts(sortSessions(sessions), diagnostics);
      this.sessions = recovered.sessions;
      if (!this.recoveryRewriteBlockReason && this.recoverySource !== null) {
        this.recoveryNeedsWrite = this.recoverySource !== JSON.stringify({ version: 1, entries: this.recoveryEntries() });
      }
      for (let index = 0; index < diagnostics.length; index += 1) {
        const diagnostic = diagnostics[index];
        const key = diagnostic.code === "entity-missing" && diagnostic.path ? `source:${diagnostic.path}` : `load:${index}`;
        this.controllerDiagnostics.set(key, diagnostic);
      }
      const priorSelection = this.selectedPath ? this.sessions.find((session) => session.path === this.selectedPath) : null;
      const selected = priorSelection ?? this.sessions[0] ?? null;
      this.selectedPath = selected?.path ?? null;
      this.selectedRef = selected?.draft.ref ?? null;
      this.loaded = true;
      this.notice = restoredClaims ? `${restoredClaims} interrupted canonical write claim${restoredClaims === 1 ? "" : "s"} restored from durable prior bytes` : recovered.count ? `${recovered.count} noncanonical draft${recovered.count === 1 ? "" : "s"} recovered; disk remains source of truth` : sessions.length ? `${sessions.length} canonical World Bible pages loaded` : `No pages found in ${WORLD_KNOWLEDGE_ROOT}`;
      this.recomputeDiagnostics();
      this.publish();
    }
    selectedSession() {
      this.ensureLoaded();
      if (this.selectedPath) {
        const selected = this.sessions.find((session) => session.path === this.selectedPath);
        if (selected) return selected;
      }
      if (this.selectedRef) {
        const matches = this.sessions.filter((session) => session.draft.ref === this.selectedRef);
        if (matches.length === 1) return matches[0];
      }
      return this.sessions[0] ?? null;
    }
    select(ref) {
      this.ensureLoaded();
      const matches = this.sessions.filter((session) => session.draft.ref === ref);
      if (matches.length !== 1) {
        if (matches.length > 1) {
          this.notice = `Ref ${ref} is ambiguous; select the page by canonical path.`;
          this.publish();
        }
        return;
      }
      this.selectedPath = matches[0].path;
      this.selectedRef = ref;
      this.mode = "read";
      this.proposal = null;
      this.clearPendingDiscard();
      this.clearTransientDiagnostics();
      this.notice = `Opened ${ref}`;
      this.recomputeDiagnostics();
      this.publish();
    }
    selectPath(path) {
      this.ensureLoaded();
      const session = this.sessions.find((candidate) => candidate.path === path);
      if (!session) return;
      this.selectedPath = session.path;
      this.selectedRef = session.draft.ref;
      this.mode = "read";
      this.proposal = null;
      this.clearPendingDiscard();
      this.clearTransientDiagnostics();
      this.notice = `Opened ${session.draft.ref}`;
      this.recomputeDiagnostics();
      this.publish();
    }
    setQuery(query) {
      this.query = query;
      this.publish();
    }
    setKindFilter(filter) {
      if (filter !== "all" && !kindIs(filter)) return;
      this.kindFilter = filter;
      this.publish();
    }
    setMode(mode) {
      this.mode = mode;
      this.proposal = null;
      this.clearPendingDiscard();
      this.publish();
    }
    beginNew(kind = "business") {
      this.ensureLoaded();
      let sequence = 1;
      let draft = emptyDraft(kind, sequence);
      while (this.sessions.some((session2) => session2.draft.ref === draft.ref || session2.path === pathForRef(draft.ref))) {
        sequence += 1;
        draft = emptyDraft(kind, sequence);
      }
      const session = newKnowledgeSession(pathForRef(draft.ref), draft);
      this.sessions = sortSessions([...this.sessions, session]);
      this.selectedPath = session.path;
      this.selectedRef = draft.ref;
      this.mode = "edit";
      this.proposal = null;
      this.clearPendingDiscard();
      this.clearTransientDiagnostics();
      this.notice = `New ${kind} draft \u2014 no file exists until Write to Disk is confirmed`;
      this.persistRecovery();
      this.recomputeDiagnostics();
      this.publish();
    }
    updateDraft(update) {
      const session = this.selectedSession();
      if (!session) return;
      const priorRef = session.draft.ref;
      const nextDraft = update({ ...session.draft, facts: session.draft.facts.map((fact) => ({ ...fact })) });
      if (nextDraft.ref !== priorRef && this.sessions.some((candidate) => candidate !== session && candidate.draft.ref === nextDraft.ref)) {
        this.notice = `Ref ${nextDraft.ref} is already owned by another page`;
        this.publish();
        return;
      }
      let next = setKnowledgeDraft(session, nextDraft);
      if (session.baseSource === null && nextDraft.ref !== priorRef) {
        const nextPath = pathForRef(nextDraft.ref);
        const pathOwner = this.sessions.find((candidate) => candidate !== session && candidate.path === nextPath);
        if (pathOwner) {
          this.notice = `Path ${nextPath} is already targeted by ${pathOwner.draft.ref}`;
          this.publish();
          return;
        }
        next = { ...next, path: nextPath };
      }
      this.replaceSession(session, next);
      this.selectedRef = nextDraft.ref;
      this.mode = "edit";
      this.proposal = null;
      this.clearPendingDiscard();
      this.clearTransientDiagnostics();
      this.notice = `${nextDraft.ref} is a draft; canonical disk is unchanged`;
      this.persistRecovery();
      this.scheduleDiagnostics();
      this.publish();
    }
    patchDraft(patch) {
      this.updateDraft((draft) => ({ ...draft, ...patch }));
    }
    updateFact(key, patch) {
      this.updateDraft((draft) => ({
        ...draft,
        facts: draft.facts.map((fact) => fact.key === key ? { ...fact, ...patch } : fact)
      }));
    }
    renameFactKey(key, nextKey) {
      const normalized = nextKey.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
      const session = this.selectedSession();
      if (!session || !normalized || normalized !== key && session.draft.facts.some((fact) => fact.key === normalized)) {
        this.notice = normalized ? `Fact key ${normalized} already exists` : "Fact key cannot be empty";
        this.publish();
        return;
      }
      this.updateDraft((draft) => ({
        ...draft,
        facts: draft.facts.map((fact) => fact.key === key ? { ...fact, key: normalized } : fact)
      }));
    }
    addFact() {
      const session = this.selectedSession();
      if (!session) return;
      let sequence = 1;
      let key = "new_fact";
      const keys = new Set(session.draft.facts.map((fact) => fact.key));
      while (keys.has(key)) {
        sequence += 1;
        key = `new_fact_${sequence}`;
      }
      this.updateDraft((draft) => ({ ...draft, facts: [...draft.facts, { key, label: "New fact", value: "", visibility: "author" }] }));
    }
    removeFact(key) {
      this.updateDraft((draft) => ({ ...draft, facts: draft.facts.filter((fact) => fact.key !== key) }));
    }
    refreshDisk() {
      if (this.diskRefreshTimer !== null) {
        cancelTask(this.diskRefreshTimer);
        this.diskRefreshTimer = null;
      }
      this.ensureLoaded();
      this.clearPendingDiscard();
      this.clearTransientDiagnostics();
      for (const key of [...this.controllerDiagnostics.keys()]) {
        if (key.startsWith("source:") || key.startsWith("external:")) this.controllerDiagnostics.delete(key);
      }
      const diskPaths = pageFiles(this.port);
      const next = [];
      for (const session of this.sessions) {
        const source = this.port.read(session.path);
        if (source === null) {
          if (knowledgeDraftChanged(session)) next.push(refreshKnowledgeDisk(session, null));
          continue;
        }
        const page = parseKnowledgePage(source, session.path);
        if (!page || page.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
          next.push(refreshKnowledgeDisk(session, source));
          this.controllerDiagnostics.set(`external:${session.path}`, {
            severity: "error",
            code: "external-reload-malformed",
            message: `Canonical bytes changed at ${session.path}, but they do not parse cleanly. The current draft was preserved.`,
            path: session.path
          });
          continue;
        }
        next.push(refreshKnowledgeDisk(session, source));
      }
      const existingPaths = new Set(next.map((session) => session.path));
      for (const path of diskPaths) {
        if (existingPaths.has(path)) continue;
        const source = this.port.read(path);
        const page = source === null ? null : parseKnowledgePage(source, path);
        if (source !== null && page && !page.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
          next.push(openKnowledgeSession(path, source));
          existingPaths.add(path);
        } else if (source !== null) {
          this.controllerDiagnostics.set(`source:${path}`, {
            severity: "error",
            code: "entity-missing",
            message: "Canonical World Bible source does not contain one clean supported entity block.",
            path
          });
        }
      }
      this.sessions = sortSessions(next);
      const selected = (this.selectedPath ? this.sessions.find((session) => session.path === this.selectedPath) : null) ?? this.sessions[0] ?? null;
      this.selectedPath = selected?.path ?? null;
      this.selectedRef = selected?.draft.ref ?? null;
      this.proposal = null;
      if (this.mode === "review") this.mode = selected && knowledgeDraftChanged(selected) ? "edit" : "read";
      this.notice = "Canonical files rechecked";
      this.recomputeDiagnostics();
      this.publish();
    }
    /** Coalesce one filesystem save's create/rename/modify burst into one pass. */
    requestDiskRefresh() {
      if (this.diskRefreshTimer !== null) return;
      const timer = scheduleTask(() => {
        this.diskRefreshTimer = null;
        this.refreshDisk();
      }, WORLD_BIBLE_CONTROLLER_TUNING.diskRefreshCoalesceMs);
      if (timer === null) this.refreshDisk();
      else this.diskRefreshTimer = timer;
    }
    /** Settle authoring-only work before the shell enters live /play. */
    settleBeforePlay() {
      if (this.diskRefreshTimer !== null) {
        cancelTask(this.diskRefreshTimer);
        this.diskRefreshTimer = null;
      }
      if (this.diagnosticsTimer !== null) {
        cancelTask(this.diagnosticsTimer);
        this.diagnosticsTimer = null;
      }
      if (!this.loaded) return true;
      if (!this.sessions.some(knowledgeDraftChanged)) {
        if (this.recoveryTimer !== null) {
          cancelTask(this.recoveryTimer);
          this.recoveryTimer = null;
        }
        return true;
      }
      const ok = this.writeRecoveryNow();
      this.notice = ok ? "Noncanonical World Bible recovery settled before play; disk remains canonical." : "Play blocked because the noncanonical World Bible recovery draft could not be secured.";
      this.publish();
      return ok;
    }
    collisionDiagnosticsFor(session) {
      const diagnostics = [];
      const refOwners = this.sessions.filter((candidate) => candidate.draft.ref === session.draft.ref);
      if (refOwners.length > 1) {
        diagnostics.push({
          severity: "error",
          code: "ref-duplicate",
          message: `Ref "${session.draft.ref}" is owned by ${refOwners.map((owner) => owner.path).join(", ")}. Resolve the collision before review.`,
          path: session.path
        });
      }
      const pathOwners = this.sessions.filter((candidate) => candidate.path === session.path);
      const unbasedDraftTargetsExistingFile = session.baseSource === null && this.port.read(session.path) !== null;
      if (pathOwners.length > 1 || unbasedDraftTargetsExistingFile) {
        diagnostics.push({
          severity: "error",
          code: "path-duplicate",
          message: unbasedDraftTargetsExistingFile ? `New draft ${session.draft.ref} targets ${session.path}, but that canonical file already exists. Resolve the collision before review.` : `Canonical path "${session.path}" is targeted by ${pathOwners.map((owner) => owner.draft.ref).join(", ")}. Resolve the collision before review.`,
          path: session.path
        });
      }
      return diagnostics;
    }
    reviewSelected() {
      const session = this.selectedSession();
      if (!session) return false;
      this.writeRecoveryNow();
      this.clearPendingDiscard();
      const collisions = this.collisionDiagnosticsFor(session);
      if (collisions.length) {
        this.proposal = null;
        this.mode = "edit";
        this.transientDiagnostics = collisions;
        this.notice = "Review blocked: this draft has an ambiguous ref or canonical target path.";
        this.recomputeDiagnostics();
        this.publish();
        return false;
      }
      const prepared = prepareKnowledgeWrite(session, this.port.read(session.path));
      this.replaceSession(session, prepared.session);
      if (!prepared.ok) {
        this.proposal = null;
        this.mode = knowledgeDraftChanged(prepared.session) ? "edit" : "read";
        this.transientDiagnostics = prepared.diagnostics;
        this.notice = prepared.error;
        this.recomputeDiagnostics();
        this.publish();
        return false;
      }
      this.proposal = prepared.proposal;
      this.mode = "review";
      this.transientDiagnostics = prepared.proposal.diagnostics;
      this.notice = `Reviewing exact patch for ${prepared.proposal.path}`;
      this.recomputeDiagnostics();
      this.publish();
      return true;
    }
    confirmSelected(proposalId) {
      const session = this.selectedSession();
      const proposal = this.proposal;
      if (!session || !proposal || proposal.id !== proposalId) {
        this.notice = "That write proposal is no longer current.";
        this.publish();
        return false;
      }
      const result = confirmKnowledgeWrite(session, proposal, this.port);
      this.replaceSession(session, result.session);
      if (!result.ok) {
        this.proposal = null;
        this.mode = knowledgeDraftChanged(result.session) ? "edit" : "read";
        this.notice = result.error;
        this.writeRecoveryNow();
        this.recomputeDiagnostics();
        this.publish();
        return false;
      }
      this.selectedPath = result.session.path;
      this.selectedRef = result.page.ref;
      this.proposal = null;
      this.mode = "read";
      this.clearPendingDiscard();
      this.clearTransientDiagnostics();
      this.notice = `Wrote and re-parsed ${result.session.path}`;
      this.writeRecoveryNow();
      this.recomputeDiagnostics();
      this.publish();
      return true;
    }
    requestDiscard(action) {
      const session = this.selectedSession();
      if (!session) return false;
      this.writeRecoveryNow();
      if (action === "revert" && !knowledgeDraftChanged(session)) {
        this.notice = "The selected page has no draft changes to discard.";
        this.publish();
        return false;
      }
      if (action === "reload") {
        const refreshed = refreshKnowledgeDisk(session, this.port.read(session.path));
        this.replaceSession(session, refreshed);
        if (refreshed.diskSource === null) {
          this.notice = `${session.path} no longer exists on disk; the draft was preserved.`;
          this.recomputeDiagnostics();
          this.publish();
          return false;
        }
        const page = parseKnowledgePage(refreshed.diskSource, refreshed.path);
        if (!page || page.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
          this.controllerDiagnostics.set(`external:${session.path}`, {
            severity: "error",
            code: "external-reload-malformed",
            message: `Cannot reload ${session.path}: canonical bytes are malformed. The draft was preserved.`,
            path: session.path
          });
          this.notice = `Cannot reload malformed canonical bytes from ${session.path}; the draft was preserved.`;
          this.recomputeDiagnostics();
          this.publish();
          return false;
        }
      }
      this.pendingDiscard = action;
      this.pendingDiscardPath = session.path;
      this.proposal = null;
      this.notice = action === "reload" ? `Confirmation required: reload disk and discard the in-app draft for ${session.path}.` : `Confirmation required: discard the in-app draft for ${session.path}.`;
      this.recomputeDiagnostics();
      this.publish();
      return true;
    }
    cancelDiscard() {
      if (!this.pendingDiscard) return;
      this.writeRecoveryNow();
      this.clearPendingDiscard();
      this.notice = "Discard canceled; the in-app draft remains unchanged.";
      this.recomputeDiagnostics();
      this.publish();
    }
    confirmDiscard() {
      const action = this.pendingDiscard;
      const path = this.pendingDiscardPath;
      const session = path ? this.sessions.find((candidate) => candidate.path === path) ?? null : null;
      if (!action || !session) {
        this.notice = "There is no current discard request to confirm.";
        this.clearPendingDiscard();
        this.publish();
        return false;
      }
      if (this.recoveryRewriteBlockReason) {
        this.notice = `Discard is blocked because ${WORLD_BIBLE_RECOVERY_FILE} could not be safely interpreted. Its original bytes and the in-app draft were preserved.`;
        this.recomputeDiagnostics();
        this.publish();
        return false;
      }
      if (action === "reload") {
        const source = this.port.read(session.path);
        const refreshed = refreshKnowledgeDisk(session, source);
        if (source === null) {
          this.replaceSession(session, refreshed);
          this.notice = `${session.path} no longer exists on disk; the draft was preserved.`;
          this.clearPendingDiscard();
          this.recomputeDiagnostics();
          this.publish();
          return false;
        }
        const page = parseKnowledgePage(source, session.path);
        if (!page || page.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
          this.replaceSession(session, refreshed);
          this.controllerDiagnostics.set(`external:${session.path}`, {
            severity: "error",
            code: "external-reload-malformed",
            message: `Cannot reload ${session.path}: canonical bytes are malformed. The draft was preserved.`,
            path: session.path
          });
          this.notice = `Cannot reload malformed canonical bytes from ${session.path}; the draft was preserved.`;
          this.clearPendingDiscard();
          this.recomputeDiagnostics();
          this.publish();
          return false;
        }
        let next;
        try {
          next = reloadKnowledgeFromDisk(refreshed);
        } catch {
          this.notice = `Could not reload ${session.path}; the draft was preserved.`;
          this.clearPendingDiscard();
          this.recomputeDiagnostics();
          this.publish();
          return false;
        }
        this.replaceSession(session, next);
        this.selectedPath = next.path;
        this.selectedRef = next.draft.ref;
        this.controllerDiagnostics.delete(`external:${session.path}`);
        this.notice = `Reloaded canonical disk bytes from ${next.path}`;
      } else if (session.baseSource === null) {
        this.sessions = this.sessions.filter((candidate) => candidate !== session);
        const selected = this.sessions[0] ?? null;
        this.selectedPath = selected?.path ?? null;
        this.selectedRef = selected?.draft.ref ?? null;
        this.notice = "Unwritten new page draft discarded; disk was never touched";
      } else {
        const next = revertKnowledgeDraft(session);
        this.replaceSession(session, next);
        this.selectedPath = next.path;
        this.selectedRef = next.draft.ref;
        this.notice = `Draft reverted to loaded disk base for ${next.path}`;
      }
      this.clearPendingDiscard();
      this.proposal = null;
      this.mode = "read";
      this.clearTransientDiagnostics();
      this.writeRecoveryNow();
      this.recomputeDiagnostics();
      this.publish();
      return true;
    }
    /** Compatibility shims remain request-only: neither can erase a draft. */
    revertSelected() {
      this.requestDiscard("revert");
    }
    reloadSelected() {
      return this.requestDiscard("reload");
    }
    stateFor(session) {
      return knowledgeSourceState(session);
    }
    hasDrafts() {
      if (!this.loaded) return false;
      const dirty = this.sessions.some(knowledgeDraftChanged);
      if (this.recoveryRewriteBlockReason) return dirty;
      if (!dirty && this.recoveryTimer === null && !this.recoveryNeedsWrite && !this.controllerDiagnostics.has("recovery-write")) return false;
      const recoveryOk = this.writeRecoveryNow();
      return dirty || !recoveryOk;
    }
    requestReviewFirstDraft() {
      this.ensureLoaded();
      const session = this.sessions.find(knowledgeDraftChanged);
      if (!session) return false;
      this.selectedPath = session.path;
      this.selectedRef = session.draft.ref;
      return this.reviewSelected();
    }
    supportedKinds() {
      return KNOWLEDGE_KINDS;
    }
  };
  var worldBibleController = new WorldBibleController();

  // cart/editor/worldBible/fixtures.test.ts
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
  var pages = listDir(WORLD_KNOWLEDGE_ROOT).filter((entry) => entry.endsWith(".md")).map((entry) => {
    const path = `${WORLD_KNOWLEDGE_ROOT}/${entry}`;
    const source = readFile(path);
    return source === null ? null : parseKnowledgePage(source, path);
  }).filter((page) => page !== null);
  test("the complete hand-editable fixture parses without hard errors", () => {
    const requiredRefs = [
      "biz.cropduster_labs",
      "place.east_mercer_depot",
      "npc.rowena_pike",
      "place.rowena_apartment",
      "position.cropduster_site_manager",
      "shift.cropduster_weekday_day",
      "mechanic.evidence_visibility"
    ];
    for (const ref of requiredRefs) assert(pages.some((page) => page.ref === ref), `required seed page ${ref} is missing`);
    const errors = pages.flatMap((page) => page.diagnostics).filter((item) => item.severity === "error");
    assert(errors.length === 0, errors.map((item) => `${item.path}: ${item.message}`).join("; "));
  });
  test("fixture links resolve and form backlinks", () => {
    const catalog = buildKnowledgeCatalog(pages);
    const unresolved = catalog.diagnostics.filter((item) => item.code === "ref-unresolved");
    assert(unresolved.length === 0, unresolved.map((item) => item.message).join("; "));
    assert(catalog.backlinks.get("biz.cropduster_labs")?.some((row) => row.fromRef === "place.east_mercer_depot"), "business backlink from depot missing");
    assert(catalog.backlinks.get("npc.rowena_pike")?.some((row) => row.fromRef === "position.cropduster_site_manager"), "person backlink from position missing");
  });
  test("public fixture excludes the disposal reveal and designer instructions", () => {
    const page = pages.find((candidate) => candidate.ref === "biz.cropduster_labs");
    assert(page, "CropDuster page missing");
    const canonical = readCanonicalKnowledgePage(page.path);
    assert(canonical, "CropDuster canonical bytes could not be loaded");
    const projection = publicProjectionText(canonical);
    assert(projection.includes("municipal pest-control services"), "benign description missing");
    assert(!projection.includes("storm-drain dumping"), "secret disposal fact leaked");
    assert(!projection.includes("mission reveal"), "designer notes leaked");
  });
  log(`
world bible fixtures: ${passed} passed, ${failed} failed`);
  if (failed) throw new Error(`${failed} world-bible fixture test(s) failed`);
})();
