import { defineGallerySection, defineGalleryStory } from '../types';
import { menuEntryMockData } from '../data/overstock/menu-entry';

import { MenuListBasic } from '../components/menu-list-basic/MenuListBasic';
import { MenuListKeyed } from '../components/menu-list-keyed/MenuListKeyed';
import { MenuListMarker } from '../components/menu-list-marker/MenuListMarker';
import { MenuPie } from '../components/menu-pie/MenuPie';
import { MenuFan } from '../components/menu-fan/MenuFan';
import { MenuGridSquare } from '../components/menu-grid-square/MenuGridSquare';
import { MenuBrick } from '../components/menu-brick/MenuBrick';
import { MenuMasonry } from '../components/menu-masonry/MenuMasonry';
import { MenuSpineLeft } from '../components/menu-spine-left/MenuSpineLeft';
import { MenuRibbon } from '../components/menu-ribbon/MenuRibbon';
import { MenuDock } from '../components/menu-dock/MenuDock';
import { MenuMarquee } from '../components/menu-marquee/MenuMarquee';
import { MenuDossier } from '../components/menu-dossier/MenuDossier';
import { MenuFolder } from '../components/menu-folder/MenuFolder';
import { MenuCliTree } from '../components/menu-cli-tree/MenuCliTree';
import { MenuFlow } from '../components/menu-flow/MenuFlow';
import { MenuDepth } from '../components/menu-depth/MenuDepth';
import { MenuTerminal } from '../components/menu-terminal/MenuTerminal';
import { MenuConsole } from '../components/menu-console/MenuConsole';
import { MenuCurtain } from '../components/menu-curtain/MenuCurtain';
import { MenuBarcode } from '../components/menu-barcode/MenuBarcode';
import { MenuPeriodic } from '../components/menu-periodic/MenuPeriodic';
import { MenuTypeStack } from '../components/menu-type-stack/MenuTypeStack';

const GROUP = { id: 'compositions', title: 'Compositions' };
const TAGS_LIST    = ['menu', 'launcher', 'list'];
const TAGS_RADIAL  = ['menu', 'launcher', 'radial', 'svg'];
const TAGS_GRID    = ['menu', 'launcher', 'grid'];
const TAGS_RAIL    = ['menu', 'launcher', 'rail'];
const TAGS_CARD    = ['menu', 'launcher', 'card'];
const TAGS_DIAG    = ['menu', 'launcher', 'diagram'];
const TAGS_SPATIAL = ['menu', 'launcher', 'spatial', 'diegetic'];
const TAGS_WEIRD   = ['menu', 'launcher', 'experimental'];

function entry(id: string, title: string, source: string, render: () => any, tags: string[]) {
  return defineGallerySection({
    id,
    title,
    group: GROUP,
    kind: 'atom',
    stories: [
      defineGalleryStory({
        id: `${id}/default`,
        title,
        source,
        status: 'draft',
        tags,
        variants: [{ id: 'default', name: 'Default', render }],
      }),
    ],
  });
}

// ── A · Lists ────────────────────────────────────────────────
export const menuListBasicSection = entry(
  'menu-list-basic',
  'Menu · A1 · List with caret',
  'cart/app/gallery/components/menu-list-basic/MenuListBasic.tsx',
  () => <MenuListBasic rows={menuEntryMockData} />,
  TAGS_LIST,
);

export const menuListKeyedSection = entry(
  'menu-list-keyed',
  'Menu · A3 · Keyed list',
  'cart/app/gallery/components/menu-list-keyed/MenuListKeyed.tsx',
  () => <MenuListKeyed rows={menuEntryMockData} />,
  TAGS_LIST,
);

export const menuListMarkerSection = entry(
  'menu-list-marker',
  'Menu · A5 · Sliding marker',
  'cart/app/gallery/components/menu-list-marker/MenuListMarker.tsx',
  () => <MenuListMarker rows={menuEntryMockData} />,
  TAGS_LIST,
);

// ── B · Radials ──────────────────────────────────────────────
export const menuPieSection = entry(
  'menu-pie',
  'Menu · B2 · Pie wedges',
  'cart/app/gallery/components/menu-pie/MenuPie.tsx',
  () => <MenuPie rows={menuEntryMockData} />,
  TAGS_RADIAL,
);

export const menuFanSection = entry(
  'menu-fan',
  'Menu · B4 · Fan',
  'cart/app/gallery/components/menu-fan/MenuFan.tsx',
  () => <MenuFan rows={menuEntryMockData} />,
  TAGS_RADIAL,
);

// ── C · Grids ────────────────────────────────────────────────
export const menuGridSquareSection = entry(
  'menu-grid-square',
  'Menu · C1 · 4-up tiles',
  'cart/app/gallery/components/menu-grid-square/MenuGridSquare.tsx',
  () => <MenuGridSquare rows={menuEntryMockData} />,
  TAGS_GRID,
);

export const menuBrickSection = entry(
  'menu-brick',
  'Menu · C3 · Brick',
  'cart/app/gallery/components/menu-brick/MenuBrick.tsx',
  () => <MenuBrick rows={menuEntryMockData} />,
  TAGS_GRID,
);

export const menuMasonrySection = entry(
  'menu-masonry',
  'Menu · C5 · Masonry',
  'cart/app/gallery/components/menu-masonry/MenuMasonry.tsx',
  () => <MenuMasonry rows={menuEntryMockData} />,
  TAGS_GRID,
);

// ── D · Rails ────────────────────────────────────────────────
export const menuSpineLeftSection = entry(
  'menu-spine-left',
  'Menu · D1 · Left rail + preview',
  'cart/app/gallery/components/menu-spine-left/MenuSpineLeft.tsx',
  () => <MenuSpineLeft rows={menuEntryMockData} />,
  TAGS_RAIL,
);

export const menuRibbonSection = entry(
  'menu-ribbon',
  'Menu · D2 · Ribbon tabs',
  'cart/app/gallery/components/menu-ribbon/MenuRibbon.tsx',
  () => <MenuRibbon rows={menuEntryMockData} />,
  TAGS_RAIL,
);

export const menuDockSection = entry(
  'menu-dock',
  'Menu · D3 · Bottom dock',
  'cart/app/gallery/components/menu-dock/MenuDock.tsx',
  () => <MenuDock rows={menuEntryMockData} />,
  TAGS_RAIL,
);

export const menuMarqueeSection = entry(
  'menu-marquee',
  'Menu · D4 · Marquee ticker',
  'cart/app/gallery/components/menu-marquee/MenuMarquee.tsx',
  () => <MenuMarquee rows={menuEntryMockData} />,
  TAGS_RAIL,
);

// ── E · Cards ────────────────────────────────────────────────
export const menuDossierSection = entry(
  'menu-dossier',
  'Menu · E1 · Dossier fan',
  'cart/app/gallery/components/menu-dossier/MenuDossier.tsx',
  () => <MenuDossier rows={menuEntryMockData} />,
  TAGS_CARD,
);

export const menuFolderSection = entry(
  'menu-folder',
  'Menu · E2 · File folder',
  'cart/app/gallery/components/menu-folder/MenuFolder.tsx',
  () => <MenuFolder rows={menuEntryMockData} />,
  TAGS_CARD,
);

// ── F · Diagrams ─────────────────────────────────────────────
export const menuCliTreeSection = entry(
  'menu-cli-tree',
  'Menu · F2 · CLI tree',
  'cart/app/gallery/components/menu-cli-tree/MenuCliTree.tsx',
  () => <MenuCliTree rows={menuEntryMockData} />,
  TAGS_DIAG,
);

export const menuFlowSection = entry(
  'menu-flow',
  'Menu · F3 · Linear flow',
  'cart/app/gallery/components/menu-flow/MenuFlow.tsx',
  () => <MenuFlow rows={menuEntryMockData} />,
  TAGS_DIAG,
);

// ── G · Spatial ──────────────────────────────────────────────
export const menuDepthSection = entry(
  'menu-depth',
  'Menu · G1 · Depth tiers',
  'cart/app/gallery/components/menu-depth/MenuDepth.tsx',
  () => <MenuDepth rows={menuEntryMockData} />,
  TAGS_SPATIAL,
);

export const menuTerminalSection = entry(
  'menu-terminal',
  'Menu · G2 · Terminal prompt',
  'cart/app/gallery/components/menu-terminal/MenuTerminal.tsx',
  () => <MenuTerminal rows={menuEntryMockData} />,
  TAGS_SPATIAL,
);

export const menuConsoleSection = entry(
  'menu-console',
  'Menu · G3 · Control panel',
  'cart/app/gallery/components/menu-console/MenuConsole.tsx',
  () => <MenuConsole rows={menuEntryMockData} />,
  TAGS_SPATIAL,
);

export const menuCurtainSection = entry(
  'menu-curtain',
  'Menu · G4 · Curtain reveal',
  'cart/app/gallery/components/menu-curtain/MenuCurtain.tsx',
  () => <MenuCurtain rows={menuEntryMockData} />,
  TAGS_SPATIAL,
);

// ── H · Weird ────────────────────────────────────────────────
export const menuBarcodeSection = entry(
  'menu-barcode',
  'Menu · H2 · Barcode',
  'cart/app/gallery/components/menu-barcode/MenuBarcode.tsx',
  () => <MenuBarcode rows={menuEntryMockData} />,
  TAGS_WEIRD,
);

export const menuPeriodicSection = entry(
  'menu-periodic',
  'Menu · H3 · Periodic',
  'cart/app/gallery/components/menu-periodic/MenuPeriodic.tsx',
  () => <MenuPeriodic rows={menuEntryMockData} />,
  TAGS_WEIRD,
);

export const menuTypeStackSection = entry(
  'menu-type-stack',
  'Menu · H5 · Type stack',
  'cart/app/gallery/components/menu-type-stack/MenuTypeStack.tsx',
  () => <MenuTypeStack rows={menuEntryMockData} />,
  TAGS_WEIRD,
);

export const menuGallerySections = [
  menuListBasicSection,
  menuListKeyedSection,
  menuListMarkerSection,
  menuPieSection,
  menuFanSection,
  menuGridSquareSection,
  menuBrickSection,
  menuMasonrySection,
  menuSpineLeftSection,
  menuRibbonSection,
  menuDockSection,
  menuMarqueeSection,
  menuDossierSection,
  menuFolderSection,
  menuCliTreeSection,
  menuFlowSection,
  menuDepthSection,
  menuTerminalSection,
  menuConsoleSection,
  menuCurtainSection,
  menuBarcodeSection,
  menuPeriodicSection,
  menuTypeStackSection,
];
