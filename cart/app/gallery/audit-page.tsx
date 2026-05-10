// audit-page — show every "suspect" gallery entry on its own tab so we can
// see at a glance what's a real component vs. what's a page/dashboard/scene
// in disguise. For each suspect, render EVERY variant from its story file
// (stacked vertically with labels) so the full surface area is visible.
// For storyless suspects, render the dir's primary component directly.
//
// Source list: scripts/gallery-suspects.js (score ≥ 3).

import { Component, useState } from 'react';
import type { ReactNode } from 'react';
import { Box, Col, Pressable, Row, ScrollView, Text } from '@reactjit/runtime/primitives';
import { useMeasure } from '@reactjit/runtime/hooks/useMeasure';
import { getStoryVariants, type GallerySection } from './types';

// ───── sections (24 — story-backed suspects) ─────
import { sweatshopMatrixDisplaySection } from './stories/sweatshop-matrix-display.story';
import { astQuiltSection } from './stories/ast-quilt.story';
import { documentViewerSection } from './stories/document-viewer.story';
import { easingsSection } from './stories/easings.story';
import { socialImageGallerySection } from './stories/social-image-gallery.story';
import { animatedTextSection } from './stories/animated-text.story';
import { genericChatCardSection } from './stories/generic-chat-card.story';
import { blockFacesSection } from './stories/block-faces.story';
import { conditionalGuttersSection } from './stories/conditional-gutters.story';
import { flowEditorSection } from './stories/flow-editor.story';
import { gitLanesSection } from './stories/git-lanes.story';
import { spreadsheetSection } from './stories/spreadsheet.story';
import { genericCardSection } from './stories/generic-card.story';
import { intentSurfaceSection } from './stories/intent-surface.story';
import { newsFeedSection } from './stories/news-feed.story';
import { commandComposerSection } from './stories/command-composer.story';
import { skeletonTilesSection } from './stories/skeleton-tiles.story';
import { latexSection } from './stories/latex.story';
import { toolbarSection } from './stories/toolbar.story';
import { galleryDisplayContainerSection } from './stories/gallery-display-container.story';
import { gridSpinnersSection } from './stories/grid-spinners.story';
import { iconCatalogSection } from './stories/icon-catalog.story';

// ───── storyless suspects: 3 dirs with no .story.tsx ─────
import { MenuTileShell } from './components/menu-tile-shell/MenuTileShell';

// ──────────────────────────────────────────────────────────────────────────
// Per-render error boundary so a broken variant doesn't kill the whole page.
// A render that throws is itself the verdict — surface it inline.
// ──────────────────────────────────────────────────────────────────────────

class TabBoundary extends Component<{ children: ReactNode }, { err: any }> {
  state = { err: null as any };
  static getDerivedStateFromError(err: any) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <Col style={{ padding: 12, gap: 4, borderWidth: 1, borderColor: 'theme:flag', borderRadius: 4 }}>
          <Text style={{ color: 'theme:flag', fontWeight: 'bold' }}>render failed</Text>
          <Text style={{ color: 'theme:inkDim', fontSize: 12 }}>
            {String(this.state.err?.message || this.state.err)}
          </Text>
        </Col>
      );
    }
    return this.props.children as any;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Suspect list — score from scripts/gallery-suspects.js, in score order
// ──────────────────────────────────────────────────────────────────────────

type Suspect = {
  id: string;
  score: number;
  /** Story-backed: render every variant. */
  section?: GallerySection;
  /** Storyless fallback: just render this. */
  render?: () => ReactNode;
};

const SUSPECTS: Suspect[] = [
  { id: 'sweatshop-matrix-display', score: 13, section: sweatshopMatrixDisplaySection },
  { id: 'ast-quilt',                score: 10, section: astQuiltSection },
  { id: 'document-viewer',          score: 10, section: documentViewerSection },
  { id: 'easings',                  score: 10, section: easingsSection },
  { id: 'social-image-gallery',     score: 10, section: socialImageGallerySection },
  { id: 'animated-text',            score:  9, section: animatedTextSection },
  { id: 'generic-chat-card',        score:  9, section: genericChatCardSection },
  { id: 'block-faces',              score:  7, section: blockFacesSection },
  { id: 'conditional-gutters',      score:  7, section: conditionalGuttersSection },
  { id: 'flow-editor',              score:  7, section: flowEditorSection },
  { id: 'git-lanes',                score:  7, section: gitLanesSection },
  { id: 'spreadsheet',              score:  7, section: spreadsheetSection },
  { id: 'generic-card',             score:  6, section: genericCardSection },
  { id: 'intent-surface',           score:  6, section: intentSurfaceSection },
  { id: 'news-feed',                score:  6, section: newsFeedSection },
  { id: 'command-composer',         score:  5, section: commandComposerSection },
  { id: 'skeleton-tiles',           score:  5, section: skeletonTilesSection },
  { id: 'latex',                    score:  4, section: latexSection },
  { id: 'toolbar',                  score:  4, section: toolbarSection },
  { id: 'gallery-display-container',score:  3, section: galleryDisplayContainerSection },
  { id: 'grid-spinners',            score:  3, section: gridSpinnersSection },
  { id: 'icon-catalog',             score:  3, section: iconCatalogSection },
  { id: 'menu-tile-shell',          score:  3, render: () => (
      <MenuTileShell id="M0" title="Tile" kind="audit">
        <Box style={{ flex: 1, backgroundColor: 'theme:bg2' }} />
      </MenuTileShell>
    ) },
];

// ──────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────

function fmtRect(rect: { width: number; height: number } | null): string {
  if (!rect) return 'measuring…';
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  return `${w} × ${h}`;
}

// MeasuredBlock — renders one variant inside a Box wired to useMeasure, then
// sizes the outer card to match the rendered footprint, clamped to a sane
// min/max. Anything bigger than max scrolls inside its card; anything smaller
// than min still gets a readable card.
const STAGE_MIN_W = 160;
const STAGE_MIN_H = 80;
const STAGE_MAX_W = 1200;
const STAGE_MAX_H = 720;
const STAGE_PAD = 12;
const HEADER_RESERVE = 28;

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function MeasuredBlock(props: {
  index: string;
  id: string;
  name: string;
  children: ReactNode;
}) {
  const { rect, version, onLayout } = useMeasure();
  const stageW = rect
    ? clamp(rect.width + STAGE_PAD * 2, STAGE_MIN_W, STAGE_MAX_W)
    : STAGE_MIN_W;
  const stageH = rect
    ? clamp(rect.height + STAGE_PAD * 2 + HEADER_RESERVE, STAGE_MIN_H, STAGE_MAX_H)
    : STAGE_MIN_H;
  return (
    <Col
      style={{
        width: stageW,
        height: stageH,
        gap: 6,
        padding: STAGE_PAD,
        borderWidth: 1,
        borderColor: 'theme:rule',
        borderRadius: 4,
      }}
    >
      <Row style={{ gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Text style={{ color: 'theme:accent', fontWeight: 'bold', fontSize: 11 }}>{props.index}</Text>
        <Text style={{ color: 'theme:ink', fontWeight: 'bold', fontSize: 12 }}>{props.name}</Text>
        <Text style={{ color: 'theme:inkDimmer', fontSize: 11 }}>{props.id}</Text>
        <Text style={{ color: 'theme:ok', fontSize: 11, fontWeight: 'bold' }}>
          {fmtRect(rect)}{version > 0 ? ` (v${version})` : ''}
        </Text>
      </Row>
      <ScrollView style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
        <Box onLayout={onLayout} style={{ alignSelf: 'flex-start' }}>
          <TabBoundary>{props.children}</TabBoundary>
        </Box>
      </ScrollView>
    </Col>
  );
}

function ActiveSuspect({ suspect }: { suspect: Suspect }) {
  if (!suspect.section) {
    return (
      <Col style={{ gap: 12 }}>
        <Text style={{ color: 'theme:inkDim', fontSize: 11 }}>(no story file — direct render)</Text>
        <MeasuredBlock index={`${suspect.score}.0`} id="(direct)" name="direct render">
          {suspect.render!()}
        </MeasuredBlock>
      </Col>
    );
  }
  const blocks: ReactNode[] = [];
  let n = 1;
  for (const story of suspect.section.stories) {
    const variants = getStoryVariants(story);
    if (variants.length === 0) {
      blocks.push(
        <Col key={`${story.id}-data`} style={{ gap: 6, padding: 12, borderWidth: 1, borderColor: 'theme:rule', borderRadius: 4 }}>
          <Text style={{ color: 'theme:inkDim', fontSize: 11 }}>{story.id} (data/theme story — no render variants)</Text>
        </Col>
      );
      continue;
    }
    for (const v of variants) {
      const idx = `${suspect.score}.${n++}`;
      blocks.push(
        <MeasuredBlock
          key={`${story.id}::${v.id}`}
          index={idx}
          id={`${story.id}::${v.id}`}
          name={v.name}
        >
          {v.render() as any}
        </MeasuredBlock>
      );
    }
  }
  return <Col style={{ gap: 16 }}>{blocks}</Col>;
}

export function AuditPage() {
  const [activeId, setActiveId] = useState<string>(SUSPECTS[0].id);
  const active = SUSPECTS.find((s) => s.id === activeId) || SUSPECTS[0];

  const variantCount = active.section
    ? active.section.stories.reduce((sum, st) => sum + getStoryVariants(st).length, 0)
    : 1;

  return (
    <Col style={{ width: '100%', height: '100%', backgroundColor: 'theme:bg' }}>
      <Box style={{ padding: 12, borderBottomWidth: 1, borderColor: 'theme:rule' }}>
        <Text style={{ fontWeight: 'bold', color: 'theme:ink' }}>
          Suspect audit — {SUSPECTS.length} entries flagged by gallery-suspects.js
        </Text>
        <Text style={{ color: 'theme:inkDim', fontSize: 12 }}>
          Click a tab → see every variant from that suspect's story file (or direct render if no story). Higher score = more dashboard-shaped.
        </Text>
      </Box>

      <Box style={{ borderBottomWidth: 1, borderColor: 'theme:rule' }}>
        <ScrollView horizontal style={{ width: '100%' }}>
          <Row style={{ padding: 6, gap: 4 }}>
            {SUSPECTS.map((s) => {
              const isActive = s.id === activeId;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => setActiveId(s.id)}
                  style={{
                    paddingTop: 6,
                    paddingBottom: 6,
                    paddingLeft: 10,
                    paddingRight: 10,
                    borderRadius: 4,
                    borderWidth: 1,
                    borderColor: isActive ? 'theme:accent' : 'theme:rule',
                    backgroundColor: isActive ? 'theme:bg2' : 'theme:bg',
                  }}
                >
                  <Row style={{ gap: 6, alignItems: 'center' }}>
                    <Text style={{
                      fontSize: 10,
                      color: isActive ? 'theme:accent' : 'theme:inkDimmer',
                      fontWeight: 'bold',
                    }}>
                      {s.score}
                    </Text>
                    <Text style={{
                      fontSize: 12,
                      color: isActive ? 'theme:ink' : 'theme:inkDim',
                    }}>
                      {s.id}
                    </Text>
                  </Row>
                </Pressable>
              );
            })}
          </Row>
        </ScrollView>
      </Box>

      <Box style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
        <ScrollView style={{ width: '100%', height: '100%' }}>
          <Box style={{ padding: 16 }}>
            <Row style={{ gap: 12, alignItems: 'baseline', paddingBottom: 12 }}>
              <Text style={{ color: 'theme:ink', fontWeight: 'bold' }}>{active.id}</Text>
              <Text style={{ color: 'theme:inkDim', fontSize: 11 }}>
                score {active.score} · {variantCount} variant{variantCount === 1 ? '' : 's'}
              </Text>
            </Row>
            <ActiveSuspect key={active.id} suspect={active} />
          </Box>
        </ScrollView>
      </Box>
    </Col>
  );
}
