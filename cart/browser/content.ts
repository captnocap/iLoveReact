import { BrowserPageResponse } from '@reactjit/runtime/hooks/browser_page';
import {
  collapseHtmlWhitespace,
  decodeHtmlEntities,
  extractHtmlTitle,
  htmlToPlainText,
  resolveDocumentUrl,
} from './html';
import { BrowserDocumentKind, BrowserPageDocument } from './types';
import { titleFromAddress } from './utils';

function capText(text: string, limit = 28000): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trim()}\n\n[content truncated]`;
}

function detectDocumentKind(contentType: string, body: string): BrowserDocumentKind {
  const lowerType = (contentType || '').toLowerCase();
  if (lowerType.includes('html') || /<html[\s>]|<!doctype html/i.test(body)) return 'html';
  if (lowerType.includes('json')) return 'json';
  if (lowerType.startsWith('text/') || lowerType.includes('xml') || lowerType.includes('javascript')) return 'text';
  return 'unknown';
}

function formatPlainText(body: string): string {
  return collapseHtmlWhitespace(decodeHtmlEntities(body));
}

export function extractDocumentStyleRefs(html: string, baseAddress: string): { inline: string; links: string[] } {
  const inline: string[] = [];
  const links: string[] = [];

  for (const match of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (match[1]) inline.push(match[1]);
  }

  for (const match of html.matchAll(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    const href = match[1];
    if (!href) continue;
    const resolved = resolveDocumentUrl(baseAddress, href);
    if (resolved) links.push(resolved);
  }

  return { inline: inline.join('\n'), links };
}

export function interpretPageResponse(address: string, response: BrowserPageResponse): BrowserPageDocument {
  const finalAddress = response.finalUrl || address;
  const contentType = response.contentType || '';
  const statusCode = response.status || 0;
  const error = response.error || null;
  const documentKind = detectDocumentKind(contentType, response.body || '');

  if (error) {
    return {
      title: `Failed: ${titleFromAddress(finalAddress)}`,
      finalAddress,
      statusCode,
      contentType,
      documentKind,
      source: response.body || '',
      styles: '',
      text: error,
      error,
      truncated: !!response.truncated,
    };
  }

  let title = titleFromAddress(finalAddress);
  let text = '';

  switch (documentKind) {
    case 'html': {
      title = extractHtmlTitle(response.body) || title;
      text = htmlToPlainText(response.body);
      break;
    }
    case 'json':
      text = formatPlainText(response.body);
      break;
    case 'text':
    case 'unknown':
    default:
      text = formatPlainText(response.body);
      break;
  }

  if (!text) {
    text = response.body ? capText(response.body) : 'No page content returned.';
  } else {
    text = capText(text);
  }

  return {
    title,
    finalAddress,
    statusCode,
    contentType,
    documentKind,
    source: response.body || '',
    styles: '',
    text,
    error: null,
    truncated: !!response.truncated,
  };
}
