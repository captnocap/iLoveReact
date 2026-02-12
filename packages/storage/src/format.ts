/**
 * Format parsers for storage data.
 *
 * Supports JSON, Markdown (frontmatter + body), and plain text (key:value).
 * Used by file-based adapters (Love2D, filesystem) to read/write
 * human-readable data.
 */

import type { StorageFormat } from './types';

// ── JSON format ─────────────────────────────────────────

function parseJSON(content: string): any {
  return JSON.parse(content);
}

function serializeJSON(data: any): string {
  return JSON.stringify(data, null, 2);
}

// ── Markdown format (frontmatter + body) ────────────────

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;

function parseMarkdown(content: string): any {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) {
    // No frontmatter — treat whole file as content
    return { content: content.trim() };
  }

  const [, frontmatter, body] = match;
  const data: Record<string, any> = { content: body.trim() };

  // Parse frontmatter as simple YAML-like key:value lines
  for (const line of frontmatter.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const rawValue = trimmed.slice(colonIdx + 1).trim();

    data[key] = parseYAMLValue(rawValue);
  }

  return data;
}

/** Parse a simple YAML value (strings, numbers, booleans, arrays). */
function parseYAMLValue(raw: string): any {
  // Boolean
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  // Null
  if (raw === 'null' || raw === '~') return null;

  // Number
  const num = Number(raw);
  if (raw !== '' && !isNaN(num)) return num;

  // JSON array or object (e.g. [foo, bar] or {"key": "val"})
  if ((raw.startsWith('[') && raw.endsWith(']')) || (raw.startsWith('{') && raw.endsWith('}'))) {
    try { return JSON.parse(raw); } catch { /* fall through */ }
    // Try YAML-style array: [foo, bar] without quotes
    if (raw.startsWith('[') && raw.endsWith(']')) {
      const inner = raw.slice(1, -1);
      return inner.split(',').map(s => {
        const v = s.trim();
        return parseYAMLValue(v);
      });
    }
  }

  // Quoted string
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }

  // Plain string
  return raw;
}

function serializeMarkdown(data: any): string {
  const lines: string[] = [];
  let body = '';

  for (const [key, value] of Object.entries(data)) {
    if (key === 'content') {
      body = String(value ?? '');
      continue;
    }

    if (Array.isArray(value)) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else if (typeof value === 'object' && value !== null) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  if (lines.length === 0) return body;
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}

// ── Plain text format (key:value lines) ─────────────────

function parseText(content: string): any {
  const data: Record<string, any> = {};
  let hasKeyValue = false;

  for (const line of content.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    // Only treat as key:value if key looks like an identifier
    if (/^[a-zA-Z_]\w*$/.test(key)) {
      data[key] = parseYAMLValue(value);
      hasKeyValue = true;
    }
  }

  // If no key:value pairs found, treat entire content as a single "content" field
  if (!hasKeyValue) {
    return { content: content.trim() };
  }

  return data;
}

function serializeText(data: any): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    lines.push(`${key}: ${value}`);
  }
  return lines.join('\n');
}

// ── Public API ──────────────────────────────────────────

export function parseContent(content: string, format: StorageFormat): any {
  switch (format) {
    case 'json': return parseJSON(content);
    case 'markdown': return parseMarkdown(content);
    case 'text': return parseText(content);
    default: return parseJSON(content);
  }
}

export function serializeContent(data: any, format: StorageFormat): string {
  switch (format) {
    case 'json': return serializeJSON(data);
    case 'markdown': return serializeMarkdown(data);
    case 'text': return serializeText(data);
    default: return serializeJSON(data);
  }
}

export function formatExtension(format: StorageFormat): string {
  switch (format) {
    case 'json': return '.json';
    case 'markdown': return '.md';
    case 'text': return '.txt';
    default: return '.json';
  }
}

export function detectFormat(filename: string): StorageFormat {
  if (filename.endsWith('.md')) return 'markdown';
  if (filename.endsWith('.txt')) return 'text';
  return 'json';
}
