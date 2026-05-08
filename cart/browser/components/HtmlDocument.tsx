import * as React from 'react';
import { Box, Col, Image, Pressable, Row, Text, TextEditor, TextInput } from '@reactjit/runtime/primitives';
import { COLORS } from '../constants';
import {
  CssRule,
  HtmlElementNode,
  HtmlNode,
  HtmlStyle,
  getClassList,
  isBlockTag,
  parseCssRules,
  parseHtmlDocument,
  resolveDocumentUrl,
  styleFromHtmlAttrs,
  textStyleFromHtmlAttrs,
} from '../html';

const HEADING_SIZE: Record<string, number> = {
  h1: 30,
  h2: 26,
  h3: 22,
  h4: 19,
  h5: 17,
  h6: 15,
};

const INLINE_WIDGET_TAGS = new Set(['img', 'input', 'textarea', 'button', 'select']);
const TEXT_STYLE_KEYS = new Set([
  'color',
  'fontSize',
  'lineHeight',
  'textAlign',
  'backgroundColor',
  'fontWeight',
  'fontStyle',
  'textDecoration',
  'textDecorationLine',
  'letterSpacing',
]);

const INLINE_TEXT_STYLE: HtmlStyle = {
  color: COLORS.viewportInk,
  fontSize: 13,
  lineHeight: 21,
};

function isElement(node: HtmlNode): node is HtmlElementNode {
  return node.kind === 'element';
}

function isInlineNode(node: HtmlNode): boolean {
  return node.kind === 'text' || (!isBlockTag(node.tag) && !INLINE_WIDGET_TAGS.has(node.tag));
}

function normalizeInlineText(text: string): string {
  return text.replace(/\s+/g, ' ');
}

function tokenizeInlineText(text: string): string[] {
  const normalized = normalizeInlineText(text);
  if (!normalized) return [];
  return normalized.match(/\S+\s*|\s+/g) || [];
}

function mergeTextStyle(...styles: HtmlStyle[]): HtmlStyle {
  return Object.assign({}, ...styles);
}

function normalizeTextStyle(style: HtmlStyle): HtmlStyle {
  if (typeof style.fontSize === 'number' && typeof style.lineHeight === 'number' && style.lineHeight < style.fontSize) {
    return {
      ...style,
      lineHeight: Math.ceil(style.fontSize * 1.15),
    };
  }
  return style;
}

function hasAnyStyle(style: HtmlStyle): boolean {
  return Object.keys(style).length > 0;
}

function splitInlineStyle(style: HtmlStyle): { textStyle: HtmlStyle; boxStyle: HtmlStyle } {
  const textStyle: HtmlStyle = {};
  const boxStyle: HtmlStyle = {};
  for (const [key, value] of Object.entries(style)) {
    if (TEXT_STYLE_KEYS.has(key)) textStyle[key] = value;
    else boxStyle[key] = value;
  }
  return { textStyle, boxStyle };
}

function elementStyle(node: HtmlElementNode, cssRules: CssRule[], extra: HtmlStyle = {}): HtmlStyle {
  return { ...styleFromHtmlAttrs(node.tag, node.attrs, cssRules), ...extra };
}

function elementTextStyle(node: HtmlElementNode, cssRules: CssRule[], inherited: HtmlStyle = {}, extra: HtmlStyle = {}): HtmlStyle {
  return normalizeTextStyle(mergeTextStyle(inherited, textStyleFromHtmlAttrs(node.tag, node.attrs, cssRules), extra));
}

function collectText(node: HtmlNode, preserveWhitespace = false): string {
  if (node.kind === 'text') {
    return preserveWhitespace ? node.text : normalizeInlineText(node.text);
  }
  if (node.tag === 'br') return '\n';
  const childPreserve = preserveWhitespace || node.tag === 'pre' || node.tag === 'code';
  return node.children.map((child) => collectText(child, childPreserve)).join('');
}

function renderInlineNodes(
  nodes: HtmlNode[],
  baseAddress: string,
  onOpenAddress: (address: string) => void,
  keyPrefix: string,
  cssRules: CssRule[],
  inheritedTextStyle: HtmlStyle = {},
): any[] {
  const out: any[] = [];
  let textIndex = 0;

  const pushTokens = (text: string, style: HtmlStyle, onClick?: () => void) => {
    for (const token of tokenizeInlineText(text)) {
      if (!token) continue;
      out.push(
        <Text
          key={`${keyPrefix}-${textIndex++}`}
          style={style}
          onClick={onClick}
        >
          {token}
        </Text>,
      );
    }
  };

  for (const node of nodes) {
    if (node.kind === 'text') {
      pushTokens(node.text, inheritedTextStyle);
      continue;
    }

    const key = `${keyPrefix}-${textIndex++}`;
    const classList = getClassList(node.attrs);
    switch (node.tag) {
      case 'br':
        out.push(<Box key={key} style={{ width: '100%', height: 0 }} />);
        break;
      case 'a': {
        const href = resolveDocumentUrl(baseAddress, node.attrs.href || '');
        const linkStyle = elementTextStyle(node, cssRules, inheritedTextStyle, {
          color: href ? '#1e5bb8' : inheritedTextStyle.color || COLORS.viewportInk,
          textDecorationLine: href ? 'underline' : 'none',
        });
        const { textStyle: linkTextStyle, boxStyle: linkBoxStyle } = splitInlineStyle(linkStyle);
        const action = href ? () => onOpenAddress(href) : undefined;
        if (node.children.length === 1 && isElement(node.children[0]) && getClassList(node.children[0].attrs).includes('votearrow')) {
          out.push(
            <Pressable
              key={key}
              onPress={action}
              style={{
                width: 14,
                height: 14,
                alignItems: 'center',
                justifyContent: 'center',
                ...linkBoxStyle,
              }}
            >
              <Text style={{ color: '#737373', fontSize: 10 }}>
                ▲
              </Text>
            </Pressable>,
          );
          break;
        }

        const rendered = renderInlineNodes(node.children, baseAddress, onOpenAddress, `${key}-a`, cssRules, linkTextStyle);
        const content = rendered.length > 0
          ? rendered
          : tokenizeInlineText(collectText(node) || '').map((token, idx) => (
            <Text key={`${key}-token-${idx}`} style={linkTextStyle} onClick={action}>
              {token}
            </Text>
          ));

        if (hasAnyStyle(linkBoxStyle)) {
          out.push(
            <Pressable key={key} onPress={action} style={{ flexDirection: 'row', ...linkBoxStyle }}>
              {content}
            </Pressable>,
          );
        } else {
          for (const child of content) {
            if (action && child?.type === Text) {
              out.push(React.cloneElement(child, { onClick: action }));
            } else {
              out.push(child);
            }
          }
        }
        break;
      }
      case 'strong':
      case 'b':
      case 'em':
      case 'i':
      case 'small':
      case 'mark':
      case 'abbr':
      case 'cite':
      case 'q':
      case 'time':
      case 'sub':
      case 'sup':
      case 'span':
      case 'font': {
        const inlineStyle = elementTextStyle(node, cssRules, inheritedTextStyle, node.tag === 'mark'
          ? { backgroundColor: '#f0deb1' }
          : node.tag === 'small'
            ? { fontSize: 11, lineHeight: 16 }
            : {});
        const { textStyle, boxStyle } = splitInlineStyle(inlineStyle);
        const rendered = renderInlineNodes(node.children, baseAddress, onOpenAddress, `${key}-inline`, cssRules, textStyle);
        if (hasAnyStyle(boxStyle)) {
          out.push(
            <Row key={key} style={{ ...boxStyle }}>
              {rendered}
            </Row>,
          );
        } else {
          out.push(...rendered);
        }
        break;
      }
      case 'code':
      case 'kbd':
      case 'samp': {
        const inlineStyle = elementTextStyle(node, cssRules, inheritedTextStyle, {
          backgroundColor: '#ece2cf',
          borderRadius: 6,
          paddingLeft: 4,
          paddingRight: 4,
          fontSize: 12,
        });
        pushTokens(collectText(node, true), inlineStyle);
        break;
      }
      case 'img':
        out.push(renderImageNode(node, baseAddress, key, cssRules));
        break;
      case 'input':
        out.push(renderInputNode(node, key, cssRules));
        break;
      case 'textarea':
        out.push(renderTextareaNode(node, key, cssRules));
        break;
      case 'button':
        out.push(renderButtonNode(node, key, cssRules));
        break;
      case 'select':
        out.push(renderSelectNode(node, key, cssRules));
        break;
      case 'div':
        if (classList.includes('votearrow')) {
          out.push(
            <Text key={key} style={{ color: '#737373', fontSize: 10 }}>
              ▲
            </Text>,
          );
          break;
        }
        out.push(...renderInlineNodes(node.children, baseAddress, onOpenAddress, `${key}-inline`, cssRules, inheritedTextStyle));
        break;
      default: {
        const inlineStyle = elementTextStyle(node, cssRules, inheritedTextStyle);
        const { textStyle, boxStyle } = splitInlineStyle(inlineStyle);
        const rendered = renderInlineNodes(node.children, baseAddress, onOpenAddress, `${key}-inline`, cssRules, textStyle);
        if (hasAnyStyle(boxStyle)) {
          out.push(
            <Row key={key} style={{ ...boxStyle }}>
              {rendered}
            </Row>,
          );
        } else {
          out.push(...rendered);
        }
        break;
      }
    }
  }

  return out;
}

function renderParagraph(
  nodes: HtmlNode[],
  baseAddress: string,
  onOpenAddress: (address: string) => void,
  key: string,
  cssRules: CssRule[],
  inheritedTextStyle: HtmlStyle = {},
  style: HtmlStyle = {},
) {
  const mergedStyle = mergeTextStyle(INLINE_TEXT_STYLE, inheritedTextStyle, style);
  const { textStyle, boxStyle } = splitInlineStyle(normalizeTextStyle(mergedStyle));
  const content = renderInlineNodes(nodes, baseAddress, onOpenAddress, `${key}-inline`, cssRules, textStyle);
  if (content.length === 0) return null;
  const justifyContent = textStyle.textAlign === 'center'
    ? 'center'
    : textStyle.textAlign === 'right'
      ? 'flex-end'
      : 'flex-start';
  return (
    <Row
      key={key}
      style={{
        width: '100%',
        minWidth: 0,
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        justifyContent,
        ...boxStyle,
      }}
    >
      {content}
    </Row>
  );
}

function collectTableRows(node: HtmlElementNode): HtmlElementNode[] {
  const rows: HtmlElementNode[] = [];
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (child.tag === 'tr') {
      rows.push(child);
      continue;
    }
    if (child.tag === 'thead' || child.tag === 'tbody' || child.tag === 'tfoot') {
      rows.push(...collectTableRows(child));
    }
  }
  return rows;
}

function inferFixedCellWidth(cell: HtmlElementNode, cssRules: CssRule[]): number | null {
  const style = elementStyle(cell, cssRules, {});
  if (typeof style.width === 'number') return style.width;
  if (typeof style.minWidth === 'number') return style.minWidth;

  const classes = getClassList(cell.attrs);
  if (classes.includes('votelinks')) return 22;
  if (classes.includes('title') && cell.attrs.align === 'right') return 28;

  const text = collectText(cell).trim();
  if (cell.attrs.align === 'right' && text.length > 0 && text.length <= 4) {
    return 24 + text.length * 4;
  }

  if (cell.children.length === 1 && isElement(cell.children[0]) && cell.children[0].tag === 'img') {
    const imgStyle = elementStyle(cell.children[0], cssRules, {});
    if (typeof imgStyle.width === 'number') return imgStyle.width + 6;
  }

  return null;
}

function buildColumnWidths(rows: HtmlElementNode[], cssRules: CssRule[]): Array<number | null> {
  const widths: Array<number | null> = [];

  for (const row of rows) {
    const cells = row.children.filter((child) => isElement(child) && (child.tag === 'td' || child.tag === 'th')) as HtmlElementNode[];
    let colIndex = 0;
    for (const cell of cells) {
      const colspan = Math.max(1, Number.parseInt(cell.attrs.colspan || '1', 10) || 1);
      const width = inferFixedCellWidth(cell, cssRules);
      if (width != null && colspan === 1) {
        widths[colIndex] = Math.max(widths[colIndex] || 0, width);
      }
      colIndex += colspan;
    }
  }

  return widths;
}

function renderImageNode(node: HtmlElementNode, baseAddress: string, key: string, cssRules: CssRule[]) {
  const src = resolveDocumentUrl(baseAddress, node.attrs.src || '') || node.attrs.src || '';
  const alt = node.attrs.alt || '';
  const imageStyle = elementStyle(node, cssRules, {
    minWidth: 24,
    minHeight: 24,
  });
  const frameStyle = {
    borderRadius: typeof imageStyle.borderRadius === 'number' ? imageStyle.borderRadius : 12,
    borderWidth: imageStyle.borderWidth ?? 0,
    borderColor: imageStyle.borderColor || '#d9cfbc',
    backgroundColor: imageStyle.backgroundColor || 'transparent',
    padding: 0,
    gap: 6,
    width: imageStyle.width,
    height: imageStyle.height,
  };

  return (
    <Col key={key} style={frameStyle}>
      {src ? <Image source={src} style={imageStyle} /> : null}
      {alt ? (
        <Text style={{ color: COLORS.viewportMuted, fontSize: 11 }}>
          {alt}
        </Text>
      ) : null}
    </Col>
  );
}

function renderInputNode(node: HtmlElementNode, key: string, cssRules: CssRule[]) {
  const type = (node.attrs.type || 'text').toLowerCase();
  const baseStyle = elementStyle(node, cssRules, {
    height: 30,
    minWidth: 120,
    backgroundColor: '#fffaf1',
    borderWidth: 1,
    borderColor: '#cdbb9d',
    borderRadius: 8,
    paddingLeft: 8,
    paddingRight: 8,
    fontSize: 12,
    color: COLORS.viewportInk,
  });

  if (type === 'hidden') return null;

  if (type === 'submit' || type === 'button' || type === 'reset') {
    return (
      <Pressable
        key={key}
        style={{
          backgroundColor: baseStyle.backgroundColor || '#ece2cf',
          borderWidth: baseStyle.borderWidth ?? 1,
          borderColor: baseStyle.borderColor || '#cdbb9d',
          borderRadius: baseStyle.borderRadius ?? 8,
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 6,
          paddingBottom: 6,
        }}
      >
        <Text style={{ color: COLORS.viewportInk, fontSize: 12, fontWeight: 'bold' }}>
          {node.attrs.value || node.attrs.name || 'Button'}
        </Text>
      </Pressable>
    );
  }

  if (type === 'checkbox' || type === 'radio') {
    const checked = 'checked' in node.attrs;
    return (
      <Row key={key} style={{ gap: 8, alignItems: 'center' }}>
        <Box
          style={{
            width: 16,
            height: 16,
            borderWidth: 1,
            borderColor: '#a48e69',
            borderRadius: type === 'radio' ? 999 : 4,
            backgroundColor: checked ? '#d7a74c' : '#fffaf1',
          }}
        />
        {node.attrs.value ? (
          <Text style={INLINE_TEXT_STYLE}>
            {node.attrs.value}
          </Text>
        ) : null}
      </Row>
    );
  }

  return (
    <TextInput
      key={key}
      value={node.attrs.value || ''}
      placeholder={node.attrs.placeholder || node.attrs.name || ''}
      style={baseStyle}
    />
  );
}

function renderTextareaNode(node: HtmlElementNode, key: string, cssRules: CssRule[]) {
  const baseStyle = elementStyle(node, cssRules, {
    minWidth: 180,
    minHeight: 90,
    backgroundColor: '#fffaf1',
    borderWidth: 1,
    borderColor: '#cdbb9d',
    borderRadius: 10,
    paddingLeft: 8,
    paddingRight: 8,
    paddingTop: 8,
    paddingBottom: 8,
    fontSize: 12,
    color: COLORS.viewportInk,
  });
  return (
    <TextEditor
      key={key}
      value={collectText(node, true)}
      placeholder={node.attrs.placeholder || node.attrs.name || ''}
      style={baseStyle}
    />
  );
}

function renderButtonNode(node: HtmlElementNode, key: string, cssRules: CssRule[]) {
  const label = collectText(node).trim() || 'Button';
  const style = elementStyle(node, cssRules, {
    backgroundColor: '#ece2cf',
    borderWidth: 1,
    borderColor: '#cdbb9d',
    borderRadius: 8,
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 6,
    paddingBottom: 6,
  });
  return (
    <Pressable key={key} style={style}>
      <Text style={{ color: COLORS.viewportInk, fontSize: 12, fontWeight: 'bold' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function renderSelectNode(node: HtmlElementNode, key: string, cssRules: CssRule[]) {
  const options = node.children.filter((child) => isElement(child) && child.tag === 'option') as HtmlElementNode[];
  const selected = options.find((option) => 'selected' in option.attrs) || options[0];
  const label = selected ? collectText(selected).trim() : 'Select';
  return (
    <Box
      key={key}
      style={{
        ...elementStyle(node, cssRules, {
          minWidth: 120,
          backgroundColor: '#fffaf1',
          borderWidth: 1,
          borderColor: '#cdbb9d',
          borderRadius: 8,
          paddingLeft: 10,
          paddingRight: 10,
          paddingTop: 6,
          paddingBottom: 6,
        }),
      }}
    >
      <Text style={{ color: COLORS.viewportInk, fontSize: 12 }}>
        {label}
      </Text>
    </Box>
  );
}

function renderTable(
  node: HtmlElementNode,
  baseAddress: string,
  onOpenAddress: (address: string) => void,
  key: string,
  cssRules: CssRule[],
  inheritedTextStyle: HtmlStyle,
) {
  const tableStyle = elementStyle(node, cssRules, {});
  const cellPadding = typeof tableStyle.padding === 'number' ? tableStyle.padding : 8;
  const tableGap = typeof tableStyle.gap === 'number' ? tableStyle.gap : 0;
  const rows = collectTableRows(node);
  const columnWidths = buildColumnWidths(rows, cssRules);
  if (rows.length === 0) return null;

  return (
    <Col
      key={key}
      style={{
        ...tableStyle,
        gap: tableGap,
      }}
    >
      {rows.map((row, rowIndex) => {
        const rawRowStyle = elementStyle(row, cssRules, {});
        const rowStyle = { ...rawRowStyle } as HtmlStyle;
        if (rowStyle.height != null && rowStyle.minHeight == null) {
          rowStyle.minHeight = rowStyle.height;
        }
        delete rowStyle.height;
        const rowTextStyle = elementTextStyle(row, cssRules, inheritedTextStyle);
        const cells = row.children.filter((child) => isElement(child) && (child.tag === 'td' || child.tag === 'th')) as HtmlElementNode[];
        return (
          <Row key={`${key}-row-${rowIndex}`} style={{ ...rowStyle }}>
            {cells.map((cell, cellIndex) => {
              const rawCellStyle = elementStyle(cell, cssRules, {});
              const cellStyle = { ...rawCellStyle } as HtmlStyle;
              if (cellStyle.height != null && cellStyle.minHeight == null) {
                cellStyle.minHeight = cellStyle.height;
              }
              delete cellStyle.height;
              const cellTextStyle = elementTextStyle(cell, cssRules, rowTextStyle);
              const colspan = Number.parseInt(cell.attrs.colspan || '1', 10);
              let colIndex = 0;
              for (let i = 0; i < cellIndex; i += 1) {
                colIndex += Math.max(1, Number.parseInt(cells[i].attrs.colspan || '1', 10) || 1);
              }
              let computedWidth = 0;
              let allKnown = true;
              for (let i = 0; i < Math.max(1, colspan || 1); i += 1) {
                const width = columnWidths[colIndex + i];
                if (typeof width !== 'number') {
                  allKnown = false;
                  break;
                }
                computedWidth += width;
              }
              const lastCell = cellIndex === cells.length - 1;
              const fixedWidth = inferFixedCellWidth(cell, cssRules);
              const widthHint = typeof cellStyle.width === 'number'
                ? cellStyle.width
                : fixedWidth != null
                  ? fixedWidth
                  : allKnown
                    ? computedWidth
                    : null;
              return (
                <Box
                  key={`${key}-cell-${rowIndex}-${cellIndex}`}
                  style={{
                    padding: cellStyle.padding ?? cellPadding,
                    flexGrow: lastCell && widthHint == null ? 1 : 0,
                    flexBasis: lastCell && widthHint == null ? 0 : undefined,
                    width: lastCell && widthHint == null ? undefined : widthHint ?? cellStyle.width,
                    minWidth: lastCell && widthHint == null ? 0 : widthHint ?? cellStyle.width,
                    ...cellStyle,
                  }}
                >
                  <Col style={{ gap: 8 }}>
                    {renderFlow(cell.children, baseAddress, onOpenAddress, `${key}-cellflow-${rowIndex}-${cellIndex}`, cssRules, cellTextStyle)}
                  </Col>
                </Box>
              );
            })}
          </Row>
        );
      })}
    </Col>
  );
}

function renderList(
  node: HtmlElementNode,
  ordered: boolean,
  baseAddress: string,
  onOpenAddress: (address: string) => void,
  key: string,
  cssRules: CssRule[],
  inheritedTextStyle: HtmlStyle,
) {
  const items = node.children.filter((child) => isElement(child) && child.tag === 'li') as HtmlElementNode[];
  if (items.length === 0) return null;
  return (
    <Col key={key} style={{ ...elementStyle(node, cssRules, { gap: 8, paddingLeft: 4 }) }}>
      {items.map((item, index) => (
        <Row key={`${key}-item-${index}`} style={{ gap: 10, alignItems: 'flex-start' }}>
          <Text style={{ ...INLINE_TEXT_STYLE, ...inheritedTextStyle, fontWeight: 'bold', width: 24 }}>
            {ordered ? `${index + 1}.` : '•'}
          </Text>
          <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 8 }}>
            {renderFlow(
              item.children,
              baseAddress,
              onOpenAddress,
              `${key}-itemflow-${index}`,
              cssRules,
              elementTextStyle(item, cssRules, inheritedTextStyle),
            )}
          </Col>
        </Row>
      ))}
    </Col>
  );
}

function renderBlockNode(
  node: HtmlElementNode,
  baseAddress: string,
  onOpenAddress: (address: string) => void,
  key: string,
  cssRules: CssRule[],
  inheritedTextStyle: HtmlStyle,
): any {
  const nodeStyle = elementStyle(node, cssRules);
  const nodeTextStyle = elementTextStyle(node, cssRules, inheritedTextStyle);

  switch (node.tag) {
    case 'p':
      return renderParagraph(node.children, baseAddress, onOpenAddress, key, cssRules, nodeTextStyle);
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return renderParagraph(node.children, baseAddress, onOpenAddress, key, cssRules, nodeTextStyle, {
        fontSize: HEADING_SIZE[node.tag] || 18,
        lineHeight: (HEADING_SIZE[node.tag] || 18) + 8,
        fontWeight: 'bold',
      });
    case 'blockquote':
      return (
        <Box
          key={key}
          style={{
            borderLeftWidth: 4,
            borderColor: '#d7b98a',
            backgroundColor: '#f7f0e2',
            paddingLeft: 14,
            paddingRight: 10,
            paddingTop: 10,
            paddingBottom: 10,
            gap: 8,
            borderRadius: 14,
            ...nodeStyle,
          }}
        >
          {renderFlow(node.children, baseAddress, onOpenAddress, `${key}-quote`, cssRules, nodeTextStyle)}
        </Box>
      );
    case 'pre':
      return (
        <Box
          key={key}
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: '#ddd1bb',
            backgroundColor: '#f8f1e2',
            padding: 14,
            ...nodeStyle,
          }}
        >
          <Text style={mergeTextStyle({ color: COLORS.viewportInk, fontSize: 12, lineHeight: 18 }, nodeTextStyle)}>
            {collectText(node, true)}
          </Text>
        </Box>
      );
    case 'ul':
      return renderList(node, false, baseAddress, onOpenAddress, key, cssRules, nodeTextStyle);
    case 'ol':
      return renderList(node, true, baseAddress, onOpenAddress, key, cssRules, nodeTextStyle);
    case 'img':
      return renderImageNode(node, baseAddress, key, cssRules);
    case 'input':
      return renderInputNode(node, key, cssRules);
    case 'textarea':
      return renderTextareaNode(node, key, cssRules);
    case 'button':
      return renderButtonNode(node, key, cssRules);
    case 'select':
      return renderSelectNode(node, key, cssRules);
    case 'hr':
      return <Box key={key} style={{ height: 1, backgroundColor: '#d9cfbc', ...nodeStyle }} />;
    case 'table':
      return renderTable(node, baseAddress, onOpenAddress, key, cssRules, nodeTextStyle);
    case 'dt':
      return renderParagraph(node.children, baseAddress, onOpenAddress, key, cssRules, nodeTextStyle, { fontWeight: 'bold' });
    case 'dd':
      return (
        <Box key={key} style={{ paddingLeft: 16, ...nodeStyle }}>
          {renderParagraph(node.children, baseAddress, onOpenAddress, `${key}-dd`, cssRules, nodeTextStyle)}
        </Box>
      );
    case 'figcaption':
      return renderParagraph(node.children, baseAddress, onOpenAddress, key, cssRules, nodeTextStyle, {
        fontSize: 11,
        color: COLORS.viewportMuted,
      });
    case 'form':
      return (
        <Col key={key} style={{ gap: 10, ...nodeStyle }}>
          {renderFlow(node.children, baseAddress, onOpenAddress, `${key}-form`, cssRules, nodeTextStyle)}
        </Col>
      );
    case 'body':
    case 'main':
    case 'article':
    case 'section':
    case 'aside':
    case 'nav':
    case 'header':
    case 'footer':
    case 'div':
    case 'figure':
    case 'thead':
    case 'tbody':
    case 'tfoot':
    case 'tr':
    case 'td':
    case 'th':
    case 'center':
    default:
      return (
        <Col key={key} style={{ gap: 12, ...nodeStyle }}>
          {renderFlow(node.children, baseAddress, onOpenAddress, `${key}-flow`, cssRules, nodeTextStyle)}
        </Col>
      );
  }
}

function renderFlow(
  nodes: HtmlNode[],
  baseAddress: string,
  onOpenAddress: (address: string) => void,
  keyPrefix: string,
  cssRules: CssRule[],
  inheritedTextStyle: HtmlStyle = {},
): any[] {
  const out: any[] = [];
  let inlineBuffer: HtmlNode[] = [];
  let blockIndex = 0;

  const flushInline = () => {
    if (inlineBuffer.length === 0) return;
    const paragraph = renderParagraph(
      inlineBuffer,
      baseAddress,
      onOpenAddress,
      `${keyPrefix}-paragraph-${blockIndex++}`,
      cssRules,
      inheritedTextStyle,
    );
    inlineBuffer = [];
    if (paragraph) out.push(paragraph);
  };

  for (const node of nodes) {
    if (isInlineNode(node)) {
      inlineBuffer.push(node);
      continue;
    }

    flushInline();
    const block = renderBlockNode(node, baseAddress, onOpenAddress, `${keyPrefix}-block-${blockIndex++}`, cssRules, inheritedTextStyle);
    if (block) out.push(block);
  }

  flushInline();
  return out;
}

export default function HtmlDocument({
  html,
  cssText,
  baseAddress,
  onOpenAddress,
}: {
  html: string;
  cssText?: string;
  baseAddress: string;
  onOpenAddress: (address: string) => void;
}) {
  const cssRules = parseCssRules(cssText || '');
  const nodes = parseHtmlDocument(html);
  const content = renderFlow(nodes, baseAddress, onOpenAddress, 'doc', cssRules);

  if (content.length === 0) {
    return (
      <Text style={INLINE_TEXT_STYLE}>
        This document did not expose any renderable HTML body content.
      </Text>
    );
  }

  return (
    <Col style={{ gap: 14 }}>
      {content}
    </Col>
  );
}
