// Loading the feature sheet is a runtime contract: classifier rejects unknown
// primitives and duplicate names during module evaluation.
import { classifiers as W } from '../../../runtime/classifier';
import './worldBible.cls';

const log = (globalThis as any).print ?? ((value: string) => (globalThis as any).__writeStdout?.(`${value}\n`));
if (
  typeof W.WB_Surface !== 'function'
  || typeof W.WB_IndexPanel !== 'function'
  || typeof W.WB_Review !== 'function'
  || typeof W.WB_AuthorMarkdown !== 'function'
  || typeof W.WB_DiagnosticPanel !== 'function'
  || typeof W.WB_DiscardConfirm !== 'function'
) {
  throw new Error('World Bible classifier surface did not register');
}
log('  ok  World Bible classifier sheet registers valid primitives');
