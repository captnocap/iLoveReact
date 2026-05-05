// CodeCopyButton — gallery atom bound to the `CodeSnippet` data shape.
//
// Source of truth: cart/app/gallery/data/code-snippet.ts

import { classifiers as S } from '@reactjit/core';
import { Pressable, Text } from '@reactjit/runtime/primitives';
import type { CodeSnippet } from '../../data/overstock/code-snippet';

export type CodeCopyButtonProps = {
  row: CodeSnippet;
};

function copyToClipboard(value: string): void {
  try {
    const host = globalThis as { __clipboard_set?: (next: string) => void };
    if (typeof host.__clipboard_set === 'function') host.__clipboard_set(value);
  } catch (_error) {}
}

export function CodeCopyButton({ row }: CodeCopyButtonProps) {
  const Button = S.CodeBlockCopyButton || Pressable;
  const Label = S.CodeBlockCopyText || Text;

  return (
    <Button onPress={() => copyToClipboard(row.code)}>
      <Label>Copy</Label>
    </Button>
  );
}
