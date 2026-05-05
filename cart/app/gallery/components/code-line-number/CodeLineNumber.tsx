// CodeLineNumber — gallery atom bound to the `CodeLine` data shape.
//
// Source of truth: cart/app/gallery/data/code-line.ts

import { classifiers as S } from '@reactjit/core';
import { Text } from '@reactjit/runtime/primitives';
import type { CodeLine } from '../../data/overstock/code-line';

export type CodeLineNumberProps = {
  row: CodeLine;
};

export function CodeLineNumber({ row }: CodeLineNumberProps) {
  const LineNumber = S.CodeLineNumber || Text;
  return <LineNumber>{String(row.lineNumber).padStart(2, ' ')}</LineNumber>;
}
