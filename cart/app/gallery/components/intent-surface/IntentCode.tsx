import '../../components.cls';
import { CodeBlock } from '../code-block/CodeBlock';
import type { CodeSnippet } from '../../data/overstock/code-snippet';

export function IntentCode({ lang, children }: { lang?: string; children?: any }) {
  const language = normalizeLanguage(lang);
  const label = lang ? lang.trim() : 'text';
  return (
    <CodeBlock
      row={{
        id: `intent-code-${language}`,
        title: 'Code',
        filename: label,
        language,
        code: textContent(children),
        showLineNumbers: false,
        wrap: true,
      }}
    />
  );
}

function normalizeLanguage(value: string | undefined): CodeSnippet['language'] {
  const lang = (value || '').trim().toLowerCase();
  if (lang === 'tsx') return 'tsx';
  if (lang === 'typescript' || lang === 'ts') return 'ts';
  if (lang === 'javascript' || lang === 'js') return 'js';
  if (lang === 'json') return 'json';
  if (lang === 'zig') return 'zig';
  if (lang === 'python' || lang === 'py') return 'python';
  if (lang === 'shell' || lang === 'sh' || lang === 'bash') return 'shell';
  return 'text';
}

function textContent(value: any): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(textContent).join('');
  return String(value);
}
