// Run with:
//   tools/esbuild cart/editor/inspector/uvWorkspace.test.ts --bundle --outfile=/tmp/editor-uv-workspace.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-uv-workspace.test.js
import { REGIONS } from '../shell/regions';
import { uvPanelWidthFromDrag, uvWorkspaceLayout } from './uvWorkspace';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const panel = uvWorkspaceLayout(false);
assert(panel.panelWidth === REGIONS.focusPanel.atlasWidth, 'normal paint mode lost the standard atlas width');
assert(panel.showIdentity && panel.showPaintVariants && panel.showScope, 'normal paint mode hid required panel content');
assert(panel.toggleLabel === 'FOCUS', 'normal paint mode lost its explicit focus action');

const focus = uvWorkspaceLayout(true);
assert(focus.panelWidth === REGIONS.focusPanel.atlasFocusWidth, 'UV focus mode did not claim the authored focus width');
assert(focus.panelWidth >= panel.panelWidth * 2, 'UV focus mode is not materially larger than the paint panel');
assert(!focus.showIdentity && !focus.showPaintVariants && !focus.showScope, 'UV focus mode retained competing vertical chrome');
assert(focus.panelTitle === 'UV WORKSPACE' && focus.toggleLabel === 'RETURN', 'UV focus mode has no obvious way home');

const authored = uvWorkspaceLayout(false, 812);
assert(authored.panelWidth === 812, 'manual UV width was replaced by a hard-coded panel shape');
assert(uvPanelWidthFromDrag(480, 1000, 800, 1920) === 680, 'dragging the left edge left did not grow the panel');
assert(uvPanelWidthFromDrag(480, 1000, 1400, 1920) === REGIONS.focusPanel.resizeMinWidth, 'panel drag escaped its minimum width');
assert(uvPanelWidthFromDrag(960, 1000, 0, 1280) === 720, 'panel drag failed to retain the minimum outside workspace');

console.log('PASS UV workspace layout policy');
