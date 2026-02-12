/**
 * lint.mjs — Static linter for iLoveReact layout patterns
 *
 * Uses TypeScript's ts.createSourceFile() for fast AST parsing (no type checker).
 * Catches layout mistakes before they reach the renderer.
 *
 * Rules:
 *   no-text-without-fontsize    (error)   Text without fontSize cannot be measured
 *   no-block-char-in-text       (error)   █ in Text renders as glyph, not filled pixel
 *   no-mixed-text-children      (error)   Mixed text + expressions create overlapping __TEXT__ nodes
 *   no-row-justify-without-width (error)  Row with justifyContent but no width
 *   no-uncontexted-flexgrow     (warning) flexGrow where siblings lack explicit sizing
 *   no-deep-flex-nesting        (warning) 3+ flex container levels without explicit dimensions
 *   no-flexrow-flexcolumn       (warning) Prefer Box with flexDirection
 *   no-implicit-container-sizing (warning) >5 children without explicit container size
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';

// ── Constants ────────────────────────────────────────────────

const CONTAINER_TAGS = new Set(['Box', 'view', 'FlexRow', 'FlexColumn']);
const TEXT_TAGS = new Set(['Text']); // Only uppercase — grid targets use <text> which doesn't need fontSize

// ── Color helpers ────────────────────────────────────────────

const color = (code) => (s) => `\x1b[${code}m${s}\x1b[0m`;
const red    = color('31');
const yellow = color('33');
const cyan   = color('36');
const dim    = color('2');
const bold   = color('1');

// ── Find .tsx files recursively ──────────────────────────────

function findTsxFiles(dir) {
  const files = [];
  const skip = new Set(['node_modules', 'dist', '.git', 'build', 'out']);
  function walk(d) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.tsx')) files.push(full);
    }
  }
  walk(dir);
  return files;
}

// ── Style extraction from JSX ────────────────────────────────

/**
 * Extract style property info from a JSX opening/self-closing element.
 * Returns null if no style attr, { analyzable: false } if style is a variable,
 * or a full StyleInfo object if it's an inline object literal.
 */
function extractStyleInfo(element, ts) {
  const attrs = element.attributes;
  if (!attrs) return null;

  for (const attr of attrs.properties) {
    if (!ts.isJsxAttribute(attr)) continue;
    if (!attr.name || attr.name.text !== 'style') continue;

    const init = attr.initializer;
    if (!init) return null;

    // style="string" — not a valid pattern in React, skip
    if (ts.isStringLiteral(init)) return null;

    // style={expr}
    if (ts.isJsxExpression(init) && init.expression) {
      const expr = init.expression;

      // style={{ ... }} — analyzable
      if (ts.isObjectLiteralExpression(expr)) {
        return extractFromObjectLiteral(expr, ts);
      }

      // style={variable} or style={fn()} — not analyzable
      return { analyzable: false };
    }

    return null;
  }

  return null; // no style attribute found
}

/**
 * Extract property names and key values from an object literal.
 */
function extractFromObjectLiteral(objLit, ts) {
  const info = {
    analyzable: true,
    hasSpread: false,
    props: new Set(),
    flexDirection: null,
    justifyContent: null,
  };

  for (const prop of objLit.properties) {
    if (ts.isSpreadAssignment(prop) || ts.isSpreadElement?.(prop)) {
      info.hasSpread = true;
      continue;
    }
    if (!ts.isPropertyAssignment(prop)) continue;

    const name = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
        ? prop.name.text
        : null;
    if (!name) continue;

    info.props.add(name);

    // Extract flexDirection value for sibling analysis
    if (name === 'flexDirection' && ts.isStringLiteral(prop.initializer)) {
      info.flexDirection = prop.initializer.text;
    }
    // Extract justifyContent value for row-width rule
    if (name === 'justifyContent' && ts.isStringLiteral(prop.initializer)) {
      info.justifyContent = prop.initializer.text;
    }
  }

  return info;
}

// ── AST walking — build JsxContext tree ──────────────────────

function getTagName(element, ts) {
  const tag = element.tagName;
  if (ts.isIdentifier(tag)) return tag.text;
  if (ts.isPropertyAccessExpression(tag)) return tag.name.text;
  return null;
}

/**
 * Walk a source file's AST and build a flat list of JsxContext objects,
 * with parent/children/sibling links for rule analysis.
 */
function buildContexts(sourceFile, filePath, ts) {
  const contexts = [];
  const sourceLines = sourceFile.getFullText().split('\n');

  // Check if the line before a node contains an ignore comment
  function isIgnored(lineNum) {
    // lineNum is 1-based
    if (lineNum < 2) return false;
    const prevLine = sourceLines[lineNum - 2]; // -2: 1-based to 0-based, then -1 for previous
    return prevLine && /ilr-ignore-next-line/.test(prevLine);
  }

  function visit(node, jsxParent, flexDepth, isDirectChild) {
    if (ts.isJsxElement(node)) {
      const opening = node.openingElement;
      const tagName = getTagName(opening, ts);
      const style = extractStyleInfo(opening, ts);
      const pos = ts.getLineAndCharacterOfPosition(sourceFile, opening.getStart(sourceFile));
      const line = pos.line + 1;

      const ctx = {
        tagName,
        style,
        parent: jsxParent,
        directChildren: [],
        file: filePath,
        line,
        col: pos.character + 1,
        flexDepth,
        ignored: isIgnored(line),
      };

      // Extract text content for Text elements so rules can inspect it
      if (TEXT_TAGS.has(tagName)) {
        let textContent = '';
        let hasNonWhitespaceJsxText = false;
        let hasJsxExpression = false;
        for (const child of node.children) {
          if (ts.isJsxText(child)) {
            textContent += child.text;
            if (child.text.trim() !== '') hasNonWhitespaceJsxText = true;
          } else if (ts.isJsxExpression(child) && child.expression) {
            if (ts.isStringLiteral(child.expression) || ts.isNoSubstitutionTemplateLiteral(child.expression)) {
              textContent += child.expression.text;
            }
            hasJsxExpression = true;
          }
        }
        ctx.textContent = textContent;
        ctx.hasMixedTextChildren = hasNonWhitespaceJsxText && hasJsxExpression;
      }

      contexts.push(ctx);
      if (jsxParent && isDirectChild) {
        jsxParent.directChildren.push(ctx);
      }

      // Compute child flex depth:
      // - Reset to 1 if this container has explicit width AND height (new sizing context)
      // - Reset to 1 if this container has a direct child with explicit main-axis sizing
      //   (sibling establishes the sizing context for all children)
      // - Otherwise increment
      const hasExplicitSize = style && style.analyzable
        && style.props.has('width') && style.props.has('height');

      let hasAnchoredChild = false;
      if (CONTAINER_TAGS.has(tagName) && !hasExplicitSize) {
        const isRow = (style && style.analyzable && style.flexDirection === 'row')
          || tagName === 'FlexRow';
        const mainProp = isRow ? 'width' : 'height';
        for (const child of node.children) {
          let cs = null;
          if (ts.isJsxElement(child)) {
            cs = extractStyleInfo(child.openingElement, ts);
          } else if (ts.isJsxSelfClosingElement(child)) {
            cs = extractStyleInfo(child, ts);
          }
          if (cs && cs.analyzable && cs.props.has(mainProp)) {
            hasAnchoredChild = true;
            break;
          }
        }
      }

      const childDepth = CONTAINER_TAGS.has(tagName)
        ? ((hasExplicitSize || hasAnchoredChild) ? 1 : flexDepth + 1)
        : flexDepth;

      // Walk JSX children
      for (const child of node.children) {
        if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
          // Direct JSX child
          visit(child, ctx, childDepth, true);
        } else {
          // JsxExpression, JsxText, JsxFragment — walk into, but elements
          // found inside are NOT direct children (they're in expressions)
          ts.forEachChild(child, (c) => visit(c, ctx, childDepth, false));
        }
      }
      return;
    }

    if (ts.isJsxSelfClosingElement(node)) {
      const tagName = getTagName(node, ts);
      const style = extractStyleInfo(node, ts);
      const pos = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile));
      const line = pos.line + 1;

      const ctx = {
        tagName,
        style,
        parent: jsxParent,
        directChildren: [],
        file: filePath,
        line,
        col: pos.character + 1,
        flexDepth,
        ignored: isIgnored(line),
      };

      contexts.push(ctx);
      if (jsxParent && isDirectChild) {
        jsxParent.directChildren.push(ctx);
      }
      return;
    }

    // Non-JSX nodes: keep walking to find nested JSX
    ts.forEachChild(node, (child) => visit(child, jsxParent, flexDepth, false));
  }

  visit(sourceFile, null, 0, false);
  return contexts;
}

// ── Rules ────────────────────────────────────────────────────

const rules = [

  // Every <Text> must have fontSize for Love2D/Web measurement
  {
    name: 'no-text-without-fontsize',
    severity: 'error',
    check(ctx) {
      if (!TEXT_TAGS.has(ctx.tagName)) return null;

      // No style attribute at all
      if (!ctx.style) {
        return 'Text element has no style attribute — fontSize is required for Love2D/Web targets';
      }

      // Style is a variable — can't verify, skip
      if (!ctx.style.analyzable) return null;

      // Has spread — fontSize might be in the spread, skip
      if (ctx.style.hasSpread && !ctx.style.props.has('fontSize')) return null;

      // Has fontSize — OK
      if (ctx.style.props.has('fontSize')) return null;

      return 'Text element missing fontSize in style — required for text measurement on Love2D/Web';
    },
  },

  // █ (FULL BLOCK) in Text renders as a font glyph with gaps, not a filled pixel.
  // Use Box with backgroundColor instead.
  {
    name: 'no-block-char-in-text',
    severity: 'error',
    check(ctx) {
      if (!TEXT_TAGS.has(ctx.tagName)) return null;
      if (!ctx.textContent) return null;
      if (ctx.textContent.includes('\u2588')) {
        return 'Text contains \u2588 (U+2588 FULL BLOCK) which renders as a font glyph, not a filled pixel — use Box with backgroundColor instead';
      }
      return null;
    },
  },

  // Mixed text and expressions in <Text> creates multiple __TEXT__ nodes.
  // The layout engine lays them out as separate flex items at y=0, causing overlap.
  // Fix: use a template literal {`text ${value}`} to produce a single __TEXT__ node.
  {
    name: 'no-mixed-text-children',
    severity: 'error',
    check(ctx) {
      if (!TEXT_TAGS.has(ctx.tagName)) return null;
      if (!ctx.hasMixedTextChildren) return null;

      return 'Mixed text and expressions in <Text> creates multiple __TEXT__ nodes that overlap in layout — use a template literal instead: {`text ${value}`}';
    },
  },

  // Row containers NEED explicit width for justifyContent to work.
  // Without it, the layout engine has no definite main axis and justifyContent is ignored.
  {
    name: 'no-row-justify-without-width',
    severity: 'error',
    check(ctx) {
      if (!CONTAINER_TAGS.has(ctx.tagName)) return null;
      if (!ctx.style || !ctx.style.analyzable) return null;
      if (ctx.style.hasSpread) return null;

      const isRow = ctx.style.flexDirection === 'row' || ctx.tagName === 'FlexRow';
      if (!isRow) return null;
      if (!ctx.style.props.has('justifyContent')) return null;
      if (ctx.style.props.has('width')) return null;

      // "start" is the default — it doesn't distribute space, so no width needed
      if (ctx.style.justifyContent === 'start' || ctx.style.justifyContent === 'flex-start') return null;

      return "Row with justifyContent but no width — justifyContent is ignored without an explicit width (e.g. width: '100%'). Box nodes have no intrinsic width, so the layout engine cannot distribute space along the main axis";
    },
  },

  // Prefer <Box style={{ flexDirection: 'row' }}> over <FlexRow>
  {
    name: 'no-flexrow-flexcolumn',
    severity: 'warning',
    check(ctx) {
      if (ctx.tagName === 'FlexRow') {
        return "Use <Box style={{ flexDirection: 'row' }}> instead of <FlexRow> — keeps the layout tree transparent";
      }
      if (ctx.tagName === 'FlexColumn') {
        return 'Use <Box> instead of <FlexColumn> — column is the default flexDirection';
      }
      return null;
    },
  },

  // flexGrow where siblings lack explicit main-axis sizing, OR all siblings grow with no sizes
  {
    name: 'no-uncontexted-flexgrow',
    severity: 'warning',
    check(ctx) {
      if (!ctx.style || !ctx.style.analyzable) return null;
      if (!ctx.style.props.has('flexGrow')) return null;

      // Need a parent with multiple direct children for sibling analysis
      if (!ctx.parent || ctx.parent.directChildren.length < 2) return null;

      // Determine parent's flex direction
      let parentDir = 'column'; // default
      if (ctx.parent.tagName === 'FlexRow') {
        parentDir = 'row';
      } else if (ctx.parent.style && ctx.parent.style.analyzable && ctx.parent.style.flexDirection) {
        parentDir = ctx.parent.style.flexDirection;
      }

      const mainProp = parentDir === 'row' ? 'width' : 'height';
      const siblings = ctx.parent.directChildren.filter((s) => s !== ctx);

      // Case 1: ALL siblings also grow and NONE have explicit main-axis size
      // (all-grow-no-size = layout depends entirely on content measurement)
      const analyzableSibs = siblings.filter(
        (s) => s.style && s.style.analyzable && !s.style.hasSpread,
      );
      if (analyzableSibs.length > 0) {
        const allGrow = analyzableSibs.every((s) => s.style.props.has('flexGrow'));
        const noneHaveSize = analyzableSibs.every((s) => !s.style.props.has(mainProp));
        const selfLacksSize = !ctx.style.props.has(mainProp);

        if (allGrow && noneHaveSize && selfLacksSize) {
          return `All ${ctx.parent.directChildren.length} siblings use flexGrow without explicit ${mainProp} — layout will depend on content measurement which is unreliable. Add ${mainProp} or use justifyContent on the parent`;
        }
      }

      // Case 2: Some siblings don't grow and lack explicit sizing
      for (const sib of siblings) {
        // Skip siblings that also grow
        if (sib.style && sib.style.analyzable && sib.style.props.has('flexGrow')) continue;
        // Skip unanalyzable siblings (styled via variable)
        if (!sib.style || !sib.style.analyzable || sib.style.hasSpread) continue;

        if (!sib.style.props.has(mainProp)) {
          return `flexGrow used but sibling at line ${sib.line} lacks explicit ${mainProp} — in a ${parentDir} container, non-growing siblings need ${mainProp} for predictable layout`;
        }
      }

      return null;
    },
  },

  // Root container should use width/height '100%', not flexGrow
  {
    name: 'no-flexgrow-root',
    severity: 'error',
    check(ctx) {
      if (!CONTAINER_TAGS.has(ctx.tagName)) return null;
      // Only check top-level returned elements (no JSX parent)
      if (ctx.parent) return null;
      if (!ctx.style || !ctx.style.analyzable) return null;

      // Has flexGrow but no width/height — classic mistake
      if (ctx.style.props.has('flexGrow') && !ctx.style.props.has('width') && !ctx.style.props.has('height')) {
        return "Root container uses flexGrow without width/height — use width: '100%', height: '100%' instead. flexGrow on the root has no parent to grow into";
      }

      return null;
    },
  },

  // Invalid style properties that don't exist in iLoveReact
  // Only checks iLoveReact primitives (Box, Text, Image, view, text) — not HTML elements
  {
    name: 'no-invalid-style-props',
    severity: 'error',
    check(ctx) {
      if (!ctx.style || !ctx.style.analyzable) return null;

      // Only lint iLoveReact primitives, not HTML elements like div/span/nav
      const ILOVE_TAGS = new Set([...CONTAINER_TAGS, ...TEXT_TAGS, 'Image', 'image', 'Pressable', 'ScrollView', 'TextInput']);
      if (!ILOVE_TAGS.has(ctx.tagName)) return null;

      const VALID_PROPS = new Set([
        // Sizing
        'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'aspectRatio',
        // Flexbox
        'display', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignSelf',
        'flexGrow', 'flexShrink', 'flexBasis', 'gap',
        // Spacing
        'padding', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
        'margin', 'marginLeft', 'marginRight', 'marginTop', 'marginBottom',
        // Visual
        'backgroundColor', 'borderRadius', 'borderWidth',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
        'borderColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
        'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
        'overflow', 'opacity', 'zIndex', 'scrollX', 'scrollY',
        'visibility',
        // Shadow
        'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'shadowBlur',
        // Gradient
        'backgroundGradient',
        // Transform
        'transform',
        // Text
        'color', 'fontSize', 'fontFamily', 'fontWeight', 'textAlign',
        'textOverflow', 'textDecorationLine', 'lineHeight', 'letterSpacing',
        // Text shadow
        'textShadowColor', 'textShadowOffsetX', 'textShadowOffsetY',
        // Image
        'objectFit',
        // Position
        'position', 'top', 'bottom', 'left', 'right',
        // Outline
        'outlineColor', 'outlineWidth', 'outlineOffset',
        // Transitions & Animations (Lua-side)
        'transition', 'animation',
      ]);

      const invalid = [];
      for (const prop of ctx.style.props) {
        if (!VALID_PROPS.has(prop)) {
          invalid.push(prop);
        }
      }

      if (invalid.length > 0) {
        return `Invalid style propert${invalid.length > 1 ? 'ies' : 'y'}: ${invalid.join(', ')} — not recognized by iLoveReact's style system`;
      }
      return null;
    },
  },

  // Deep flex nesting without explicit dimensions
  {
    name: 'no-deep-flex-nesting',
    severity: 'warning',
    check(ctx) {
      if (!CONTAINER_TAGS.has(ctx.tagName)) return null;
      if (ctx.flexDepth < 4) return null;

      // Has explicit dimensions — OK
      if (ctx.style && ctx.style.analyzable) {
        if (ctx.style.props.has('width') && ctx.style.props.has('height')) return null;
        // Spread might contain dimensions
        if (ctx.style.hasSpread) return null;
      }

      return `Flex container nested ${ctx.flexDepth} levels deep without explicit width and height — may produce unexpected layout`;
    },
  },

  // Large number of children without explicit container sizing
  // Skips the outermost returned element (it fills its parent naturally)
  {
    name: 'no-implicit-container-sizing',
    severity: 'warning',
    check(ctx) {
      if (!CONTAINER_TAGS.has(ctx.tagName)) return null;
      if (ctx.directChildren.length <= 5) return null;
      // Outermost element fills its parent naturally
      if (!ctx.parent) return null;

      // Has explicit dimensions — OK
      if (ctx.style && ctx.style.analyzable) {
        if (ctx.style.props.has('width') && ctx.style.props.has('height')) return null;
        if (ctx.style.hasSpread) return null;
      }

      return `Container with ${ctx.directChildren.length} direct children has no explicit width/height — add explicit dimensions for deterministic layout`;
    },
  },

];

// ── Public API ───────────────────────────────────────────────

/**
 * Run the linter on all .tsx files under `cwd/src/`.
 * Returns { errors, warnings, diagnostics }.
 */
export async function runLint(cwd, options = {}) {
  const _require = createRequire(import.meta.url);
  let ts;
  try {
    ts = _require('typescript');
  } catch {
    console.error('  typescript not found — install it: npm install -D typescript');
    return { errors: 0, warnings: 0, diagnostics: [] };
  }

  const srcDir = join(cwd, 'src');
  if (!existsSync(srcDir)) {
    if (!options.silent) console.error('  No src/ directory found.');
    return { errors: 0, warnings: 0, diagnostics: [] };
  }

  const files = findTsxFiles(srcDir);
  if (files.length === 0) {
    if (!options.silent) console.log('  No .tsx files found in src/.');
    return { errors: 0, warnings: 0, diagnostics: [] };
  }

  const diagnostics = [];

  for (const filePath of files) {
    const source = readFileSync(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(
      filePath,
      source,
      ts.ScriptTarget.ES2020,
      /* setParentNodes */ true,
      ts.ScriptKind.TSX,
    );

    const contexts = buildContexts(sourceFile, filePath, ts);

    for (const ctx of contexts) {
      if (ctx.ignored) continue; // ilr-ignore-next-line
      for (const rule of rules) {
        const message = rule.check(ctx);
        if (message) {
          diagnostics.push({
            rule: rule.name,
            severity: rule.severity,
            message,
            file: filePath,
            line: ctx.line,
            col: ctx.col,
          });
        }
      }
    }
  }

  // Sort diagnostics by file, then line
  diagnostics.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  // Report
  let errors = 0;
  let warnings = 0;

  if (diagnostics.length > 0 && !options.silent) {
    console.log('');

    let lastFile = null;
    for (const d of diagnostics) {
      const relPath = relative(cwd, d.file);

      // Group by file
      if (relPath !== lastFile) {
        if (lastFile) console.log('');
        console.log(`  ${bold(relPath)}`);
        lastFile = relPath;
      }

      const sev = d.severity === 'error' ? red('error') : yellow('warn ');
      const loc = dim(`${d.line}:${d.col}`);
      const ruleName = dim(`[${d.rule}]`);

      console.log(`    ${loc}  ${sev}  ${d.message}  ${ruleName}`);

      if (d.severity === 'error') errors++;
      else warnings++;
    }

    console.log('');
    const parts = [];
    if (errors > 0) parts.push(red(`${errors} error${errors !== 1 ? 's' : ''}`));
    if (warnings > 0) parts.push(yellow(`${warnings} warning${warnings !== 1 ? 's' : ''}`));
    console.log(`  ${parts.join(', ')} in ${files.length} file${files.length !== 1 ? 's' : ''}`);
    console.log('');
  } else if (!options.silent) {
    console.log(`\n  ${dim('OK')} ${files.length} file${files.length !== 1 ? 's' : ''} checked, no issues\n`);
  }

  return { errors, warnings, diagnostics };
}

/**
 * CLI entry point for `ilovereact lint`.
 */
export async function lintCommand(args) {
  const cwd = process.cwd();
  console.log('\n  iLoveReact lint\n');
  const { errors } = await runLint(cwd);
  if (errors > 0) process.exit(1);
}
