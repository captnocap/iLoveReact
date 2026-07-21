(() => {
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

  // cart/editor/worldBible/canonical.ts
  var canonicalPages = /* @__PURE__ */ new WeakSet();
  function hasCanonicalDiskProvenance(page) {
    return canonicalPages.has(page);
  }

  // cart/editor/worldBible/model.ts
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

  // cart/editor/worldBible/session.test.ts
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
  var SOURCE = `<business>
  <ref>biz.example</ref>
  <name>Example, Inc.</name>
  <fact key="location" label="Location" visibility="public">@[place.example]</fact>
  <public>
An ordinary company.
  </public>
</business>

<notes>
Designer-only context.
</notes>
`;
  var MemoryPort = class {
    constructor(source) {
      this.source = source;
    }
    source;
    writes = 0;
    failWrite = false;
    raceSource = void 0;
    read() {
      return this.source;
    }
    writeAtomic(_path, source) {
      this.writes += 1;
      if (this.failWrite) return false;
      this.source = source;
      return true;
    }
    writeAtomicIfUnchanged(_path, expected, source) {
      if (this.raceSource !== void 0) {
        this.source = this.raceSource;
        this.raceSource = void 0;
      }
      if (this.source !== expected) return "changed";
      if (this.failWrite) return "failed";
      this.writes += 1;
      this.source = source;
      return "written";
    }
  };
  function editedSession() {
    const opened = openKnowledgeSession("world/knowledge/example.md", SOURCE);
    const draft = { ...opened.draft, facts: opened.draft.facts.map((fact) => ({ ...fact })) };
    draft.name = "Example Municipal";
    return setKnowledgeDraft(opened, draft);
  }
  test("open is DISK and draft mutation never calls the writer", () => {
    const port = new MemoryPort(SOURCE);
    const opened = openKnowledgeSession("world/knowledge/example.md", SOURCE);
    assert(knowledgeSourceState(opened) === "DISK", "open was not disk-clean");
    const edited = setKnowledgeDraft(opened, { ...opened.draft, name: "Changed", facts: opened.draft.facts });
    assert(knowledgeSourceState(edited) === "DRAFT CHANGED", "edit did not become a divergent draft");
    assert(port.writes === 0 && port.source === SOURCE, "draft edit touched canonical bytes");
  });
  test("review freezes the exact path, hash, semantic changes, and text patch", () => {
    const session = editedSession();
    const result = prepareKnowledgeWrite(session, SOURCE);
    assert(result.ok, result.ok ? "" : result.error);
    assert(result.proposal.path === "world/knowledge/example.md", "proposal hid its target path");
    assert(result.proposal.expectedDiskHash === session.baseHash, "proposal did not freeze the base hash");
    assert(result.proposal.changes.some((change) => change.key === "name"), "semantic change missing");
    assert(result.proposal.patch.includes("-   <name>Example, Inc.</name>") && result.proposal.patch.includes("+   <name>Example Municipal</name>"), "exact text patch missing");
  });
  test("confirmation is the only write door and reparses accepted bytes", () => {
    const port = new MemoryPort(SOURCE);
    const session = editedSession();
    const prepared = prepareKnowledgeWrite(session, port.read(""));
    assert(prepared.ok, prepared.ok ? "" : prepared.error);
    assert(port.writes === 0, "review wrote before confirmation");
    const confirmed = confirmKnowledgeWrite(prepared.session, prepared.proposal, port);
    assert(confirmed.ok, confirmed.ok ? "" : confirmed.error);
    assert(port.writes === 1, "confirmation did not use exactly one atomic write");
    assert(confirmed.page.name === "Example Municipal", "confirmed bytes did not reparse");
    assert(knowledgeSourceState(confirmed.session) === "DISK", "confirmed session did not reset its base");
  });
  test("external edit becomes DISK CHANGED or CONFLICT and cannot be overwritten", () => {
    const clean = openKnowledgeSession("world/knowledge/example.md", SOURCE);
    const external = SOURCE.replace("ordinary company", "externally changed company");
    assert(knowledgeSourceState(refreshKnowledgeDisk(clean, external)) === "DISK CHANGED", "clean external edit was not detected");
    const local = editedSession();
    const conflict = refreshKnowledgeDisk(local, external);
    assert(knowledgeSourceState(conflict) === "CONFLICT", "two-sided edit was not a conflict");
    const blocked = prepareKnowledgeWrite(local, external);
    assert(!blocked.ok && blocked.state === "CONFLICT", "review prepared over an external edit");
  });
  test("a disk change after review invalidates confirmation without a write", () => {
    const port = new MemoryPort(SOURCE);
    const session = editedSession();
    const prepared = prepareKnowledgeWrite(session, SOURCE);
    assert(prepared.ok, prepared.ok ? "" : prepared.error);
    port.source = SOURCE.replace("ordinary company", "late external edit");
    const confirmed = confirmKnowledgeWrite(prepared.session, prepared.proposal, port);
    assert(!confirmed.ok && confirmed.state === "CONFLICT", "stale proposal was accepted");
    assert(port.writes === 0, "stale proposal invoked the writer");
  });
  test("an edit at the final expected-content check is rejected", () => {
    const port = new MemoryPort(SOURCE);
    const session = editedSession();
    const prepared = prepareKnowledgeWrite(session, SOURCE);
    assert(prepared.ok, prepared.ok ? "" : prepared.error);
    port.raceSource = SOURCE.replace("ordinary company", "boundary race");
    const confirmed = confirmKnowledgeWrite(prepared.session, prepared.proposal, port);
    assert(!confirmed.ok && confirmed.error.includes("final expected-content check"), "boundary race overwrote canonical source");
    assert(port.writes === 0 && port.source?.includes("boundary race"), "expected-content check did not preserve the racing edit");
  });
  test("confirmation authenticates the complete reviewed proposal payload", () => {
    const port = new MemoryPort(SOURCE);
    const session = editedSession();
    const prepared = prepareKnowledgeWrite(session, SOURCE);
    assert(prepared.ok, prepared.ok ? "" : prepared.error);
    const tampered = { ...prepared.proposal, after: prepared.proposal.after.replace("Example Municipal", "Injected Name") };
    const confirmed = confirmKnowledgeWrite(prepared.session, tampered, port);
    assert(!confirmed.ok && confirmed.error.includes("altered"), "mutated proposal retained write authority");
    assert(port.writes === 0 && port.source === SOURCE, "mutated proposal reached the writer");
  });
  test("confirmation rejects a draft changed after review", () => {
    const port = new MemoryPort(SOURCE);
    const session = editedSession();
    const prepared = prepareKnowledgeWrite(session, SOURCE);
    assert(prepared.ok, prepared.ok ? "" : prepared.error);
    const changedAgain = setKnowledgeDraft(prepared.session, { ...prepared.session.draft, name: "Changed Again", facts: prepared.session.draft.facts });
    const confirmed = confirmKnowledgeWrite(changedAgain, prepared.proposal, port);
    assert(!confirmed.ok && confirmed.error.includes("draft changed"), "stale reviewed semantics retained write authority");
    assert(port.writes === 0, "changed draft reached the writer");
  });
  test("failed atomic write leaves canonical bytes and draft divergence intact", () => {
    const port = new MemoryPort(SOURCE);
    port.failWrite = true;
    const session = editedSession();
    const prepared = prepareKnowledgeWrite(session, SOURCE);
    assert(prepared.ok, prepared.ok ? "" : prepared.error);
    const confirmed = confirmKnowledgeWrite(prepared.session, prepared.proposal, port);
    assert(!confirmed.ok, "failed writer was reported as success");
    assert(port.source === SOURCE, "failed writer changed canonical bytes");
    assert(knowledgeSourceState(confirmed.session) === "DRAFT CHANGED", "draft was discarded after failed write");
  });
  test("revert is explicit and restores the loaded base", () => {
    const reverted = revertKnowledgeDraft(editedSession());
    assert(reverted.draft.name === "Example, Inc." && knowledgeSourceState(reverted) === "DISK", "revert did not restore base");
  });
  test("a new page still requires review and confirmation against file absence", () => {
    const port = new MemoryPort(null);
    const session = newKnowledgeSession("world/knowledge/new-place.md", {
      kind: "place",
      ref: "place.new_place",
      name: "New Place",
      logo: "",
      authorText: "",
      publicText: "A newly established place.",
      notesText: "Still only a draft.",
      facts: []
    });
    const prepared = prepareKnowledgeWrite(session, port.read(""));
    assert(prepared.ok && prepared.proposal.expectedDiskHash === null, prepared.ok ? "new proposal expected an existing file" : prepared.error);
    assert(port.writes === 0 && port.source === null, "new page appeared before confirmation");
    const confirmed = confirmKnowledgeWrite(prepared.session, prepared.proposal, port);
    assert(confirmed.ok && confirmed.page.ref === "place.new_place", confirmed.ok ? "wrong page written" : confirmed.error);
  });
  test("canonical path policy rejects recovery traversal before review", () => {
    const malicious = newKnowledgeSession("world/knowledge/../../docs/game/DECISIONS.md", {
      kind: "mechanic",
      ref: "mechanic.bad_path",
      name: "Bad Path",
      logo: "",
      authorText: "",
      publicText: "",
      notesText: "Never write outside the root.",
      facts: []
    });
    const prepared = prepareKnowledgeWrite(malicious, null);
    assert(!prepared.ok && prepared.error.includes("outside"), "path traversal reached proposal creation");
  });
  test("identity-only drift is divergent and cannot masquerade as disk", () => {
    const opened = openKnowledgeSession("world/knowledge/example.md", SOURCE);
    const drifted = setKnowledgeDraft(opened, { ...opened.draft, kind: "person", ref: "npc.example", facts: opened.draft.facts });
    assert(knowledgeSourceState(drifted) === "DRAFT CHANGED", "kind/ref drift was reported as DISK");
    const prepared = prepareKnowledgeWrite(drifted, SOURCE);
    assert(!prepared.ok, "existing identity rewrite reached confirmation review");
  });
  test("a parsed session base cannot claim canonical public provenance", () => {
    const session = editedSession();
    assert(session.basePage, "base page missing");
    const projection = publicKnowledgeProjection(session.basePage);
    assert(projection === null, "a caller assertion manufactured canonical public provenance");
  });
  log(`
world bible session: ${passed} passed, ${failed} failed`);
  if (failed) throw new Error(`${failed} world-bible session test(s) failed`);
})();
