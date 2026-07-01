declare const __cwd: () => string;
declare const __fs_read: (path: string) => string | null;
declare const __writeStdout: (text: string) => void;
declare const __writeStderr: (text: string) => void;
declare const __exit: (code: number) => void;

type CheckStatus = 'pass' | 'fail';

type CheckResult = {
  status: CheckStatus;
  name: string;
  detail: string;
};

const CART = 'cart/hmsc-workspace-mock';
const CLS = `${CART}/workspace.cls.ts`;
const INDEX = `${CART}/index.tsx`;
const MANIFEST = `${CART}/cart.json`;
const FILE_EXPLORER = `${CART}/fileExplorerData.ts`;

function out(line: string): void {
  __writeStdout(`${line}\n`);
}

function err(line: string): void {
  __writeStderr(`${line}\n`);
}

function read(path: string): string {
  const full = `${__cwd()}/${path}`;
  const value = __fs_read(full);
  if (value === null) {
    err(`[layout] FAIL read ${path}`);
    __exit(1);
  }
  return value;
}

function quotedValues(raw: string): string[] {
  return Array.from(raw.matchAll(/'([^']+)'/g), (match) => match[1]);
}

function requiredMatch(source: string, pattern: RegExp, label: string): RegExpMatchArray {
  const match = source.match(pattern);
  if (!match) throw new Error(`missing ${label}`);
  return match;
}

function numberConst(source: string, name: string): number {
  const match = requiredMatch(source, new RegExp(`const\\s+${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`), name);
  return Number(match[1]);
}

function section(source: string, start: string, end: string): string {
  const a = source.indexOf(start);
  if (a < 0) throw new Error(`missing section ${start}`);
  const b = source.indexOf(end, a + start.length);
  if (b < 0) throw new Error(`missing section end ${end}`);
  return source.slice(a, b);
}

function styleBlock(classifierSource: string, name: string): string {
  const marker = `${name}:`;
  const at = classifierSource.indexOf(marker);
  if (at < 0) throw new Error(`missing classifier ${name}`);
  const styleAt = classifierSource.indexOf('style: {', at);
  if (styleAt < 0) throw new Error(`missing style for ${name}`);
  const start = styleAt + 'style: {'.length;
  let depth = 1;
  for (let i = start; i < classifierSource.length; i++) {
    const ch = classifierSource[i];
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (depth === 0) return classifierSource.slice(start, i);
  }
  throw new Error(`unterminated style for ${name}`);
}

function styleNumber(classifierSource: string, name: string, prop: string): number {
  const block = styleBlock(classifierSource, name);
  const match = block.match(new RegExp(`${prop}:\\s*(-?\\d+(?:\\.\\d+)?)`));
  if (!match) throw new Error(`missing ${name}.${prop}`);
  return Number(match[1]);
}

function optionalStyleNumber(classifierSource: string, name: string, prop: string, fallback: number): number {
  const block = styleBlock(classifierSource, name);
  const match = block.match(new RegExp(`${prop}:\\s*(-?\\d+(?:\\.\\d+)?)`));
  return match ? Number(match[1]) : fallback;
}

function styleText(classifierSource: string, name: string, prop: string): string | null {
  const block = styleBlock(classifierSource, name);
  const match = block.match(new RegExp(`${prop}:\\s*'([^']+)'`));
  return match ? match[1] : null;
}

function countMatches(source: string, pattern: RegExp): number {
  return Array.from(source.matchAll(pattern)).length;
}

function maxCommandRows(indexSource: string, menus: string[]): number {
  const counts = new Map<string, number>();
  for (const menu of menus) counts.set(menu, 0);
  for (const match of indexSource.matchAll(/\{\s*id:\s*'[^']+',\s*menu:\s*'([^']+)'/g)) {
    const menu = match[1];
    counts.set(menu, (counts.get(menu) ?? 0) + 1);
  }
  return Math.max(...Array.from(counts.values()));
}

function check(results: CheckResult[], name: string, ok: boolean, detail: string): void {
  results.push({ status: ok ? 'pass' : 'fail', name, detail });
}

function checkScrollWhenOverflow(
  results: CheckResult[],
  classifierSource: string,
  name: string,
  contentHeight: number,
  viewportHeight: number,
): void {
  const overflow = styleText(classifierSource, name, 'overflow');
  const needsScroll = contentHeight > viewportHeight;
  check(
    results,
    `${name} scroll reachability`,
    !needsScroll || overflow === 'scroll' || overflow === 'auto',
    `content ${contentHeight}px, viewport ${viewportHeight}px, overflow ${overflow ?? 'visible'}`,
  );
}

function run(): number {
  const manifest = JSON.parse(read(MANIFEST)) as { width: number; height: number };
  const indexSource = read(INDEX);
  const classifierSource = read(CLS);
  const fileExplorerSource = read(FILE_EXPLORER);
  const results: CheckResult[] = [];

  const menusMatch = requiredMatch(indexSource, /const MENUS[^\n=]*=\s*\[([^\]]+)\]/, 'MENUS');
  const menus = quotedValues(menusMatch[1]);
  const menuDropdownWidth = numberConst(indexSource, 'MENU_DROPDOWN_WIDTH');
  const menuLeftBase = numberConst(indexSource, 'MENU_LEFT_BASE');
  const menuLeftStep = numberConst(indexSource, 'MENU_LEFT_STEP');
  const menuStageGutter = numberConst(indexSource, 'MENU_STAGE_GUTTER');

  const chromeH = styleNumber(classifierSource, 'HW_Chrome', 'height');
  const dockH = styleNumber(classifierSource, 'HW_BuildDock', 'height');
  const bodyH = manifest.height - chromeH - dockH;
  const leftRailW = styleNumber(classifierSource, 'HW_LeftRail', 'width');
  const sidePanelW = styleNumber(classifierSource, 'HW_SidePanel', 'width');
  const rightPanelW = styleNumber(classifierSource, 'HW_RightPanel', 'width');
  const workspaceW = manifest.width - leftRailW - sidePanelW - rightPanelW;
  const toolOptionsH = styleNumber(classifierSource, 'HW_ToolOptions', 'height');
  const stageH = bodyH - toolOptionsH;

  check(results, 'breakpoint manifest', manifest.width === 1536 && manifest.height === 940, `${manifest.width}x${manifest.height}`);
  check(results, 'workspace horizontal budget', workspaceW >= 800, `stage/workspace width ${workspaceW}px after ${leftRailW}+${sidePanelW}+${rightPanelW}px fixed gutters`);
  check(results, 'workspace vertical budget', stageH >= 800, `stage height ${stageH}px after chrome/dock/toolbars`);

  check(results, 'menu dropdown uses clamp helper', indexSource.includes('menuDropdownLeft(state.openMenu)'), 'DropdownMenu routes left through menuDropdownLeft');
  const maxMenuRight = Math.max(...menus.map((_, index) => {
    const rawLeft = menuLeftBase + index * menuLeftStep;
    const left = Math.max(menuStageGutter, Math.min(rawLeft, workspaceW - menuDropdownWidth - menuStageGutter));
    return left + menuDropdownWidth;
  }));
  check(results, 'all file menus reachable', maxMenuRight <= workspaceW, `max menu right ${maxMenuRight}px inside ${workspaceW}px stage`);
  const menuTop = styleNumber(classifierSource, 'HW_MenuDropdown', 'top');
  const menuRowsH = maxCommandRows(indexSource, menus) * styleNumber(classifierSource, 'HW_MenuDropRow', 'minHeight');
  const menuHeadH = 31;
  check(results, 'largest dropdown vertical reach', menuTop + menuHeadH + menuRowsH <= stageH, `menu height ${menuTop + menuHeadH + menuRowsH}px inside ${stageH}px stage`);

  const contentTree = section(indexSource, 'const CONTENT_TREE', 'const SNAP_MODES');
  const contentTreeRows = countMatches(contentTree, /id:\s*'/g);
  const contentTreeRequiredH =
    contentTreeRows * styleNumber(classifierSource, 'HW_TreeRow', 'height') +
    optionalStyleNumber(classifierSource, 'HW_ContentTree', 'paddingTop', 0) +
    optionalStyleNumber(classifierSource, 'HW_ContentTree', 'paddingBottom', 0);
  checkScrollWhenOverflow(results, classifierSource, 'HW_ContentTree', contentTreeRequiredH, styleNumber(classifierSource, 'HW_ContentTree', 'height'));

  const materialPageSize = numberConst(indexSource, 'MATERIAL_PAGE_SIZE');
  const materialRequiredH =
    materialPageSize * styleNumber(classifierSource, 'HW_MaterialCard', 'height') +
    Math.max(0, materialPageSize - 1) * styleNumber(classifierSource, 'HW_MaterialList', 'gap') +
    optionalStyleNumber(classifierSource, 'HW_MaterialList', 'paddingBottom', 0);
  check(results, 'material fixed page fits', materialRequiredH <= styleNumber(classifierSource, 'HW_MaterialList', 'height'), `needs ${materialRequiredH}px inside ${styleNumber(classifierSource, 'HW_MaterialList', 'height')}px`);

  const assetPageSize = numberConst(indexSource, 'ASSET_PAGE_SIZE');
  const assetGridInnerW = sidePanelW - optionalStyleNumber(classifierSource, 'HW_AssetGrid', 'paddingLeft', 0) - optionalStyleNumber(classifierSource, 'HW_AssetGrid', 'paddingRight', 0);
  const assetCardW = styleNumber(classifierSource, 'HW_AssetCard', 'width');
  const assetCardH = styleNumber(classifierSource, 'HW_AssetCard', 'height');
  const assetGap = styleNumber(classifierSource, 'HW_AssetGrid', 'gap');
  const assetCols = Math.floor((assetGridInnerW + assetGap) / (assetCardW + assetGap));
  const assetRows = Math.ceil(assetPageSize / Math.max(1, assetCols));
  const assetRequiredH = assetRows * assetCardH + Math.max(0, assetRows - 1) * assetGap + optionalStyleNumber(classifierSource, 'HW_AssetGrid', 'paddingBottom', 0);
  check(results, 'asset fixed page has columns', assetCols >= 3, `${assetCols} columns in ${assetGridInnerW}px`);
  check(results, 'asset fixed page vertical budget', assetRequiredH <= 240, `asset grid page needs ${assetRequiredH}px`);

  const buildNotes = countMatches(section(indexSource, 'const BUILD_NOTES', 'const BUILD_THREADS'), /request:\s*'/g);
  const journalLayoutH =
    styleNumber(classifierSource, 'HW_BuildDialog', 'height') -
    styleNumber(classifierSource, 'HW_DialogHead', 'height') -
    24 -
    styleNumber(classifierSource, 'HW_JournalIntro', 'minHeight') -
    styleNumber(classifierSource, 'HW_DialogBody', 'gap');
  const journalContentH = buildNotes * styleNumber(classifierSource, 'HW_BuildNoteCard', 'minHeight') + Math.max(0, buildNotes - 1) * styleNumber(classifierSource, 'HW_JournalColumn', 'gap');
  checkScrollWhenOverflow(results, classifierSource, 'HW_JournalColumn', journalContentH, journalLayoutH);

  const historyRows = countMatches(section(indexSource, 'const INITIAL_HISTORY', 'const BUILD_NOTES'), /id:\s*'h-/g);
  checkScrollWhenOverflow(results, classifierSource, 'HW_DockHistoryRows', historyRows * styleNumber(classifierSource, 'HW_DockHistoryRow', 'height'), 128);
  const explorerFolderCount = countMatches(fileExplorerSource, /id:\s*'/g);
  check(results, 'file tree is scrollable', styleText(classifierSource, 'HW_FileTree', 'overflow') === 'scroll', `${explorerFolderCount} file explorer ids, overflow ${styleText(classifierSource, 'HW_FileTree', 'overflow') ?? 'visible'}`);

  const focusW =
    workspaceW -
    styleNumber(classifierSource, 'HW_MaterialFocus', 'left') -
    styleNumber(classifierSource, 'HW_MaterialFocus', 'right');
  const focusH =
    stageH -
    styleNumber(classifierSource, 'HW_MaterialFocus', 'top') -
    styleNumber(classifierSource, 'HW_MaterialFocus', 'bottom');
  const focusContentH = focusH - styleNumber(classifierSource, 'HW_FocusHeader', 'height') - styleNumber(classifierSource, 'HW_MaterialFocus', 'gap');
  const colorBodyH = focusContentH - styleNumber(classifierSource, 'HW_ColorMaterialStrip', 'height') - styleNumber(classifierSource, 'HW_ColorStudioShell', 'gap');
  const colorBodyW = focusW;
  const colorPreviewW = colorBodyW - styleNumber(classifierSource, 'HW_ColorAssistPanel', 'width') - styleNumber(classifierSource, 'HW_ColorStudioBody', 'gap');
  check(results, 'color studio preview width', colorPreviewW >= 360, `preview width ${colorPreviewW}px`);

  const previewGridAvailableH =
    colorBodyH -
    styleNumber(classifierSource, 'HW_ColorPreviewHead', 'height') -
    styleNumber(classifierSource, 'HW_ColorControlRow', 'height') -
    styleNumber(classifierSource, 'HW_ColorSlotHead', 'height') -
    styleNumber(classifierSource, 'HW_ColorSlotGrid', 'height');
  const previewCount = Number(requiredMatch(indexSource, /Array\.from\(\{\s*length:\s*(\d+)\s*\}/, 'materialPreviewCells length')[1]);
  const previewGap = styleNumber(classifierSource, 'HW_ColorPreviewGrid', 'gap');
  const previewPad = styleNumber(classifierSource, 'HW_ColorPreviewGrid', 'padding');
  const previewCellW = styleNumber(classifierSource, 'HW_ColorPreviewCell', 'width');
  const previewCellH = styleNumber(classifierSource, 'HW_ColorPreviewCell', 'height');
  const previewCols = Math.floor((colorPreviewW - previewPad * 2 + previewGap) / (previewCellW + previewGap));
  const previewRows = Math.ceil(previewCount / Math.max(1, previewCols));
  const previewRequiredH = previewRows * previewCellH + Math.max(0, previewRows - 1) * previewGap + previewPad * 2;
  check(results, 'color preview fixed grid fits', previewRequiredH <= previewGridAvailableH, `${previewCount} cells -> ${previewCols}x${previewRows}, needs ${previewRequiredH}px inside ${previewGridAvailableH}px`);

  const assistGridW = styleNumber(classifierSource, 'HW_ColorAssistPanel', 'width') - optionalStyleNumber(classifierSource, 'HW_ColorAssistGrid', 'paddingLeft', 0) - optionalStyleNumber(classifierSource, 'HW_ColorAssistGrid', 'paddingRight', 0);
  const assistItemW = styleNumber(classifierSource, 'HW_ColorAssistSwatch', 'width');
  const assistItemH = styleNumber(classifierSource, 'HW_ColorAssistSwatch', 'height');
  const assistGap = styleNumber(classifierSource, 'HW_ColorAssistGrid', 'gap');
  const assistCols = Math.floor((assistGridW + assistGap) / (assistItemW + assistGap));
  const assistRows = Math.ceil(6 / Math.max(1, assistCols));
  const assistRequiredH = assistRows * assistItemH + Math.max(0, assistRows - 1) * assistGap;
  check(results, 'color assist swatches fit', assistRequiredH <= styleNumber(classifierSource, 'HW_ColorAssistGrid', 'height'), `6 swatches -> ${assistCols}x${assistRows}, needs ${assistRequiredH}px`);

  const allowedWrap = new Set([
    'HW_TraceRow',
    'HW_AssetGrid',
    'HW_ChipRow',
    'HW_PreviewGrid',
    'HW_BrushGrid',
    'HW_ColorPreviewGrid',
    'HW_ColorAssistGrid',
    'HW_FileTagWrap',
  ]);
  const classifierNames = Array.from(classifierSource.matchAll(/\b(HW_[A-Za-z0-9_]+):\s*\{/g), (match) => match[1]);
  const unexpectedWrap = classifierNames.filter((name) => styleBlock(classifierSource, name).includes("flexWrap: 'wrap'") && !allowedWrap.has(name));
  check(results, 'wrap allow-list', unexpectedWrap.length === 0, unexpectedWrap.length === 0 ? `${allowedWrap.size} intentional wrap containers` : unexpectedWrap.join(', '));

  for (const result of results) {
    const line = `[layout] ${result.status.toUpperCase()} ${result.name} - ${result.detail}`;
    if (result.status === 'pass') out(line);
    else err(line);
  }

  const failures = results.filter((result) => result.status === 'fail');
  if (failures.length > 0) {
    err(`[layout] ${failures.length} failure(s). Fix the fixed budgets or add an explicit scroll/page contract.`);
    return 1;
  }
  out(`[layout] PASS ${results.length} checks`);
  return 0;
}

try {
  __exit(run());
} catch (error) {
  err(`[layout] FAIL ${(error as Error).message}`);
  __exit(1);
}
