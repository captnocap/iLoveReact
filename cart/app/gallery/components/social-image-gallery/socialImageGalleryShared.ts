import type { NewsFeedPost } from '../../data/overstock/news-feed-post';
import { newsFeedPostMockData } from '../../data/overstock/news-feed-post';
import { resolveGalleryColor } from '../../theme-color';

export type SocialImageItem = {
  id: string;
  title: string;
  caption: string;
  source: string;
  alt: string;
  location: string;
  aspectLabel: string;
  viewCount: number;
};

export type SocialImageInteractionState = {
  liked: boolean;
  reposted: boolean;
  bookmarked: boolean;
  likeCount: number;
  repostCount: number;
  commentCount: number;
  shareCount: number;
};

type Palette = {
  background: string;
  panel: string;
  accent: string;
  line: string;
  ink: string;
};

const IMAGE_PALETTES: Palette[] = [
  { background: 'theme:bg', panel: 'theme:bg2', accent: 'theme:accent', line: 'theme:ruleBright', ink: 'theme:ink' },
  { background: 'theme:bg1', panel: 'theme:bg2', accent: 'theme:ok', line: 'theme:inkGhost', ink: 'theme:ink' },
  { background: 'theme:bg2', panel: 'theme:bg2', accent: 'theme:lilac', line: 'theme:paperInkDim', ink: 'theme:ink' },
  { background: 'theme:bg2', panel: 'theme:bg2', accent: 'theme:blue', line: 'theme:paperInkDim', ink: 'theme:ink' },
];

export const DEFAULT_SOCIAL_IMAGE_POST =
  newsFeedPostMockData.find((post) => post.attachment?.kind === 'image') || newsFeedPostMockData[0];

function svgImageSource(title: string, subtitle: string, index: number, palette: Palette): string {
  const bandY = 128 + index * 18;
  const safeTitle = escapeSvgText(title);
  const safeSubtitle = escapeSvgText(subtitle);
  const resolved = resolveSvgPalette(palette);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720">
  <rect width="960" height="720" fill="${resolved.background}"/>
  <rect x="54" y="54" width="852" height="612" rx="34" fill="${resolved.panel}" stroke="${resolved.line}" stroke-width="2"/>
  <rect x="92" y="92" width="776" height="72" rx="14" fill="${resolved.background}" stroke="${resolved.line}" stroke-width="2"/>
  <rect x="120" y="112" width="184" height="12" rx="6" fill="${resolved.accent}"/>
  <rect x="120" y="138" width="352" height="10" rx="5" fill="${resolved.line}"/>
  <rect x="724" y="112" width="116" height="28" rx="14" fill="${resolved.accent}"/>
  <rect x="92" y="${bandY + 78}" width="776" height="326" rx="26" fill="${resolved.background}" stroke="${resolved.line}" stroke-width="2"/>
  <path d="M118 ${bandY + 352} C230 ${bandY + 236}, 330 ${bandY + 420}, 438 ${bandY + 306} S650 ${bandY + 244}, 842 ${bandY + 346}" fill="none" stroke="${resolved.accent}" stroke-width="16" stroke-linecap="round"/>
  <path d="M132 ${bandY + 398} L290 ${bandY + 270} L438 ${bandY + 376} L566 ${bandY + 244} L830 ${bandY + 406}" fill="none" stroke="${resolved.line}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="132" y="${bandY + 438}" width="218" height="14" rx="7" fill="${resolved.accent}"/>
  <rect x="132" y="${bandY + 470}" width="398" height="10" rx="5" fill="${resolved.line}"/>
  <rect x="132" y="${bandY + 496}" width="276" height="10" rx="5" fill="${resolved.line}"/>
  <text x="118" y="604" fill="${resolved.ink}" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="700">${safeTitle}</text>
  <text x="118" y="642" fill="${resolved.ink}" font-family="Inter, Arial, sans-serif" font-size="18">${safeSubtitle}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function resolveSvgPalette(palette: Palette): Palette {
  return {
    background: resolveGalleryColor(palette.background) || resolveGalleryColor('theme:bg') || palette.background,
    panel: resolveGalleryColor(palette.panel) || resolveGalleryColor('theme:bg2') || palette.panel,
    accent: resolveGalleryColor(palette.accent) || resolveGalleryColor('theme:accent') || palette.accent,
    line: resolveGalleryColor(palette.line) || resolveGalleryColor('theme:rule') || palette.line,
    ink: resolveGalleryColor(palette.ink) || resolveGalleryColor('theme:ink') || palette.ink,
  };
}

export function makeSocialImageSet(post: NewsFeedPost = DEFAULT_SOCIAL_IMAGE_POST): SocialImageItem[] {
  const attachmentTitle = post.attachment?.title || 'Gallery capture';
  const attachmentDescription = post.attachment?.description || post.body;
  const base = post.id.replace(/[^a-zA-Z0-9_]/g, '_');

  return [
    {
      id: `${base}_hero`,
      title: attachmentTitle,
      caption: attachmentDescription,
      source: svgImageSource('Media frame', 'primary post image', 0, IMAGE_PALETTES[0]),
      alt: `${attachmentTitle} primary image`,
      location: 'Desk capture',
      aspectLabel: '4:3',
      viewCount: 8420,
    },
    {
      id: `${base}_detail`,
      title: 'Detail pass',
      caption: 'Close crop for interaction state, inline counters, and saved context.',
      source: svgImageSource('Detail pass', 'interaction state crop', 1, IMAGE_PALETTES[1]),
      alt: 'Close detail of the gallery interaction state',
      location: 'Preview bench',
      aspectLabel: '4:3',
      viewCount: 5190,
    },
    {
      id: `${base}_thread`,
      title: 'Thread context',
      caption: 'The image is paired with comments and repost intent without leaving the viewer.',
      source: svgImageSource('Thread context', 'comments remain attached', 2, IMAGE_PALETTES[2]),
      alt: 'Gallery image with thread context',
      location: 'Social review',
      aspectLabel: '4:3',
      viewCount: 6330,
    },
    {
      id: `${base}_archive`,
      title: 'Archive view',
      caption: 'A saved-state variant for returning to a post after it moves through the feed.',
      source: svgImageSource('Archive view', 'saved post variant', 3, IMAGE_PALETTES[3]),
      alt: 'Saved gallery image variant',
      location: 'Saved posts',
      aspectLabel: '4:3',
      viewCount: 2740,
    },
  ];
}

export function formatSocialCount(value: number): string {
  if (value >= 1_000_000) return `${trimDecimal(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimDecimal(value / 1_000)}K`;
  return String(value);
}

export function formatSocialTimestamp(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return 'now';
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function visibilityLabel(value: NewsFeedPost['visibility']): string {
  if (value === 'followers') return 'Followers';
  if (value === 'private') return 'Private';
  return 'Public';
}

export function initialsFromName(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function trimDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
