// gallery — comprehensive surface tour of the TUI host. Pages walk
// through SGR text styles, 24-bit color, glyph ranges (the basis for
// thinking about <Effect> translation later), and wide-char rendering.
//
// All Rows wrap so the layout still reads on a 60-column terminal.

import * as React from 'react';
import { Box, Row, Col, Text, Pressable, ScrollView, Terminal, TextInput, Effect } from '../../runtime/primitives';
import { Router, Route, Link, useRoute } from '../../runtime/router';
import { subscribeKey } from '../host';

const palette = {
  bg:      '#0b1020',
  panel:   '#111827',
  card:    '#1e293b',
  border:  '#334155',
  ink:     '#e5e7eb',
  dim:     '#94a3b8',
  faint:   '#64748b',
  accent:  '#fbbf24',
  good:    '#34d399',
  bad:     '#f87171',
  blue:    '#60a5fa',
  purple:  '#a78bfa',
  pink:    '#f472b6',
};

const PAGES = [
  { path: '/styles', label: 'Styles' },
  { path: '/colors', label: 'Colors' },
  { path: '/glyphs', label: 'Glyphs' },
  { path: '/fonts',  label: 'Fonts' },
  { path: '/wide',   label: 'Wide' },
  { path: '/fx',     label: 'FX' },
  { path: '/term',   label: 'Term' },
  { path: '/input',  label: 'Input' },
  { path: '/chat',   label: 'Chat' },
] as const;

export default function Gallery() {
  return (
    <Router initialPath="/styles">
      <Box style={{ width: '100%', height: '100%', backgroundColor: palette.bg, color: palette.ink, flexDirection: 'column' }}>
        <Header />
        <Row style={{ flexGrow: 1, flexShrink: 1 }}>
          <Sidebar />
          <Content />
        </Row>
        <Footer />
      </Box>
    </Router>
  );
}

// Content — the FX page wants a full-bleed surface (no inner ScrollView,
// no padding) so an <Effect> can paint the entire viewport. Every other
// page wants the standard scrolling content area.
function Content() {
  const route = useRoute();
  if (route.path === '/fx') {
    return (
      <Box style={{ flexGrow: 1, flexShrink: 1 }}>
        <FxPage />
      </Box>
    );
  }
  return (
    <ScrollView style={{ flexGrow: 1, flexShrink: 1, paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1 }}>
      <Route path="/styles">{() => <StylesPage />}</Route>
      <Route path="/colors">{() => <ColorsPage />}</Route>
      <Route path="/glyphs">{() => <GlyphsPage />}</Route>
      <Route path="/fonts">{() => <FontsPage />}</Route>
      <Route path="/wide">{() => <WidePage />}</Route>
      <Route path="/term">{() => <TermPage />}</Route>
      <Route path="/input">{() => <InputPage />}</Route>
      <Route path="/chat">{() => <ChatPage />}</Route>
      <Route fallback>{() => <StylesPage />}</Route>
    </ScrollView>
  );
}

function Header() {
  return (
    <Row style={{ backgroundColor: palette.panel, paddingLeft: 1, paddingRight: 1, gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
      <Text style={{ color: palette.blue, fontWeight: 'bold' }}>tui-gallery</Text>
      <Text style={{ color: palette.faint, italic: true }}>· click links · drag to copy · Ctrl+P pause · q quit</Text>
    </Row>
  );
}

function Sidebar() {
  const route = useRoute();
  return (
    <Col style={{ width: 12, borderWidth: 1, borderColor: palette.border, paddingLeft: 1, paddingRight: 1, paddingTop: 0, paddingBottom: 0 }}>
      {PAGES.map((p) => {
        const active = route.path === p.path;
        return (
          <Link key={p.path} to={p.path}>
            <Box style={{ backgroundColor: active ? palette.card : undefined }}>
              <Text style={{
                color: active ? palette.accent : palette.dim,
                fontWeight: active ? 'bold' : undefined,
              }}>
                {active ? '› ' : '  '}{p.label}
              </Text>
            </Box>
          </Link>
        );
      })}
    </Col>
  );
}

function Footer() {
  const route = useRoute();
  return (
    <Row style={{ backgroundColor: palette.panel, paddingLeft: 1, paddingRight: 1, gap: 1, flexWrap: 'wrap' }}>
      <Text style={{ color: palette.faint }}>route:</Text>
      <Text style={{ color: palette.accent }}>{route.path}</Text>
    </Row>
  );
}

// ── Styles ─────────────────────────────────────────────────────────

function StylesPage() {
  return (
    <Col style={{ gap: 0, flexShrink: 1 }}>
      <H1>SGR text styles</H1>
      <Sub>per-cell: bold · dim · italic · underline · reverse · strikethrough · 24-bit fg/bg.</Sub>
      <Spacer />
      <StyleRow label="plain"    body={<Text style={{ color: palette.ink }}>The quick brown fox jumps over the lazy dog.</Text>} />
      <StyleRow label="bold"     body={<Text style={{ color: palette.ink, fontWeight: 'bold' }}>The quick brown fox jumps over the lazy dog.</Text>} />
      <StyleRow label="dim"      body={<Text style={{ color: palette.ink, dim: true }}>The quick brown fox jumps over the lazy dog.</Text>} />
      <StyleRow label="italic"   body={<Text style={{ color: palette.ink, italic: true }}>The quick brown fox jumps over the lazy dog.</Text>} />
      <StyleRow label="underline" body={<Text style={{ color: palette.ink, underline: true }}>The quick brown fox jumps over the lazy dog.</Text>} />
      <StyleRow label="strike"   body={<Text style={{ color: palette.ink, strike: true }}>The quick brown fox jumps over the lazy dog.</Text>} />
      <StyleRow label="reverse"  body={<Text style={{ color: palette.ink, reverse: true }}>The quick brown fox jumps over the lazy dog.</Text>} />
      <StyleRow label="combined" body={<Text style={{ color: palette.accent, fontWeight: 'bold', italic: true, underline: true }}>bold + italic + underline + accent</Text>} />
    </Col>
  );
}

function StyleRow({ label, body }: { label: string; body: any }) {
  return (
    <Row style={{ gap: 1, flexWrap: 'wrap' }}>
      <Box style={{ width: 10 }}><Text style={{ color: palette.dim }}>{label}</Text></Box>
      {body}
    </Row>
  );
}

// ── Colors ─────────────────────────────────────────────────────────

function ColorsPage() {
  return (
    <Col style={{ gap: 0, flexShrink: 1 }}>
      <H1>24-bit RGB</H1>
      <Sub>truecolor (\x1b[38;2;R;G;Bm). every cell is one of 16M colors.</Sub>
      <Spacer />

      <Caption>hue sweep (high-sat, high-value):</Caption>
      <SwatchRow cells={64} build={(i, n) => hsvToHex((i / n) * 360, 0.85, 0.95)} />
      <Spacer />

      <Caption>hue sweep (low-sat, high-value):</Caption>
      <SwatchRow cells={64} build={(i, n) => hsvToHex((i / n) * 360, 0.4, 0.95)} />
      <Spacer />

      <Caption>hue sweep (high-sat, low-value):</Caption>
      <SwatchRow cells={64} build={(i, n) => hsvToHex((i / n) * 360, 0.85, 0.45)} />
      <Spacer />

      <Caption>greyscale ramp:</Caption>
      <SwatchRow cells={64} build={(i, n) => hsvToHex(0, 0, i / (n - 1))} />
      <Spacer />

      <Caption>saturation × value @ hue 220°:</Caption>
      <Col style={{ gap: 0 }}>
        {Array.from({ length: 8 }).map((_, row) => (
          <SwatchRow key={row} cells={48} build={(i, n) => hsvToHex(220, row / 7, i / (n - 1))} />
        ))}
      </Col>
      <Spacer />

      <Caption>saturation × value @ hue 30° (warm):</Caption>
      <Col style={{ gap: 0 }}>
        {Array.from({ length: 8 }).map((_, row) => (
          <SwatchRow key={row} cells={48} build={(i, n) => hsvToHex(30, row / 7, i / (n - 1))} />
        ))}
      </Col>
      <Spacer />

      <Caption>standard 16 ANSI palette (named):</Caption>
      <Row style={{ flexWrap: 'wrap' }}>
        {ANSI_16.map((c, i) => (
          <Box key={i} style={{ backgroundColor: c.hex, paddingLeft: 1, paddingRight: 1 }}>
            <Text style={{ color: pickFg(c.hex), fontWeight: 'bold' }}>{c.name}</Text>
          </Box>
        ))}
      </Row>
      <Spacer />

      <Caption>256-color cube (xterm 6×6×6):</Caption>
      <Col style={{ gap: 0 }}>
        {Array.from({ length: 6 }).map((_, r) => (
          <Row key={r}>
            {Array.from({ length: 36 }).map((_, c) => {
              const ri = r;
              const gi = Math.floor(c / 6);
              const bi = c % 6;
              const hex = `#${twoHex(ri * 51)}${twoHex(gi * 51)}${twoHex(bi * 51)}`;
              return <Box key={c} style={{ backgroundColor: hex, width: 2, height: 1 }} />;
            })}
          </Row>
        ))}
      </Col>
      <Spacer />

      <Caption>fg-on-bg pairs across hue:</Caption>
      <Row style={{ flexWrap: 'wrap' }}>
        {Array.from({ length: 24 }).map((_, col) => {
          const bg = hsvToHex((col / 24) * 360, 0.55, 0.35);
          const fg = hsvToHex((col / 24) * 360, 0.95, 0.95);
          return (
            <Box key={col} style={{ backgroundColor: bg, paddingLeft: 1, paddingRight: 1 }}>
              <Text style={{ color: fg, fontWeight: 'bold' }}>Aa</Text>
            </Box>
          );
        })}
      </Row>
      <Spacer />

      <Caption>two-color gradients (lerp R/G/B):</Caption>
      <Col style={{ gap: 0 }}>
        <SwatchRow cells={64} build={(i, n) => lerpHex('#ef4444', '#fbbf24', i / (n - 1))} />
        <SwatchRow cells={64} build={(i, n) => lerpHex('#3b82f6', '#a78bfa', i / (n - 1))} />
        <SwatchRow cells={64} build={(i, n) => lerpHex('#0ea5e9', '#22c55e', i / (n - 1))} />
        <SwatchRow cells={64} build={(i, n) => lerpHex('#0b1020', '#fbbf24', i / (n - 1))} />
      </Col>
      <Spacer />

      <Caption>text on tinted bg:</Caption>
      <Col style={{ gap: 0 }}>
        {['error', 'warn', 'info', 'success', 'debug'].map((kind, i) => {
          const tints = ['#7f1d1d', '#78350f', '#1e3a8a', '#14532d', '#1e1b4b'];
          const fgs   = ['#fecaca', '#fde68a', '#bfdbfe', '#bbf7d0', '#c7d2fe'];
          return (
            <Row key={kind}>
              <Box style={{ backgroundColor: tints[i], paddingLeft: 1, paddingRight: 1 }}>
                <Text style={{ color: fgs[i], fontWeight: 'bold' }}>{kind.padEnd(8)}</Text>
              </Box>
              <Box style={{ paddingLeft: 1, paddingRight: 1 }}>
                <Text style={{ color: palette.dim }}>example message body for {kind} state</Text>
              </Box>
            </Row>
          );
        })}
      </Col>
    </Col>
  );
}

const ANSI_16 = [
  { name: 'black  ', hex: '#000000' },
  { name: 'red    ', hex: '#cd0000' },
  { name: 'green  ', hex: '#00cd00' },
  { name: 'yellow ', hex: '#cdcd00' },
  { name: 'blue   ', hex: '#0000ee' },
  { name: 'magenta', hex: '#cd00cd' },
  { name: 'cyan   ', hex: '#00cdcd' },
  { name: 'white  ', hex: '#e5e5e5' },
  { name: 'br.blk ', hex: '#7f7f7f' },
  { name: 'br.red ', hex: '#ff0000' },
  { name: 'br.grn ', hex: '#00ff00' },
  { name: 'br.yel ', hex: '#ffff00' },
  { name: 'br.blu ', hex: '#5c5cff' },
  { name: 'br.mag ', hex: '#ff00ff' },
  { name: 'br.cya ', hex: '#00ffff' },
  { name: 'br.wht ', hex: '#ffffff' },
];

function twoHex(n: number): string {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
}
function pickFg(bgHex: string): string {
  // Pick black or white fg based on luminance for legibility.
  const m = /^#?([0-9a-f]{6})$/i.exec(bgHex);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // Simple luminance approximation.
  const Y = (r * 299 + g * 587 + b * 114) / 1000;
  return Y > 128 ? '#000000' : '#ffffff';
}
function lerpHex(a: string, b: string, t: number): string {
  const ma = /^#?([0-9a-f]{6})$/i.exec(a)!;
  const mb = /^#?([0-9a-f]{6})$/i.exec(b)!;
  const na = parseInt(ma[1], 16);
  const nb = parseInt(mb[1], 16);
  const ar = (na >> 16) & 255, ag = (na >> 8) & 255, ab = na & 255;
  const br = (nb >> 16) & 255, bg = (nb >> 8) & 255, bb = nb & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return '#' + twoHex(r) + twoHex(g) + twoHex(bl);
}

function SwatchRow({ cells, build }: { cells: number; build: (i: number, n: number) => string }) {
  return (
    <Row style={{ flexWrap: 'wrap' }}>
      {Array.from({ length: cells }).map((_, i) => (
        <Box key={i} style={{ backgroundColor: build(i, cells), width: 1, height: 1 }} />
      ))}
    </Row>
  );
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  const to = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return '#' + to(r) + to(g) + to(b);
}

// ── Glyphs (the big one) ──────────────────────────────────────────
//
// Comprehensive Unicode coverage tour. Each section names the
// approximate code-point range so you can spot what's available when
// designing primitive translations (e.g., box-drawing for outlines,
// blocks for fills, braille for fine raster, dingbats for icons).

function GlyphsPage() {
  return (
    <Col style={{ gap: 0, flexShrink: 1 }}>
      <H1>Glyph coverage</H1>
      <Sub>raw chars in cells. each section: code-point range · sample.</Sub>
      <Spacer />

      <Section title="ASCII printable (U+0020–U+007E)">
        {asciiPrintable()}
      </Section>

      <Section title="Latin-1 supplement (U+00A0–U+00FF)">
        {rangeChars(0x00A1, 0x00FF)}
      </Section>

      <Section title="Latin extended-A (U+0100–U+017F)">
        {rangeChars(0x0100, 0x017F)}
      </Section>

      <Section title="Greek (U+0391–U+03C9)">
        {rangeChars(0x0391, 0x03C9)}
      </Section>

      <Section title="Cyrillic basic (U+0410–U+044F)">
        {rangeChars(0x0410, 0x044F)}
      </Section>

      <Section title="General punctuation (U+2010–U+203A)">
        {rangeChars(0x2010, 0x203A)}
      </Section>

      <Section title="Superscripts / subscripts (U+2070–U+208F)">
        {rangeChars(0x2070, 0x208F)}
      </Section>

      <Section title="Currency symbols (U+20A0–U+20BF)">
        {rangeChars(0x20A0, 0x20BF)}
      </Section>

      <Section title="Letterlike (U+2100–U+214F) · ℵ ℧ ™ № ℝ ℤ">
        {rangeChars(0x2100, 0x214F)}
      </Section>

      <Section title="Number forms / fractions (U+2150–U+218F)">
        {rangeChars(0x2150, 0x218F)}
      </Section>

      <Section title="Arrows (U+2190–U+21FF)">
        {rangeChars(0x2190, 0x21FF)}
      </Section>

      <Section title="Math operators (U+2200–U+22FF)">
        {rangeChars(0x2200, 0x22FF)}
      </Section>

      <Section title="Misc technical / control pictures (U+2300–U+23FF)">
        {rangeChars(0x2300, 0x23FF)}
      </Section>

      <Section title="Box drawing (U+2500–U+257F)">
        {rangeChars(0x2500, 0x257F)}
      </Section>

      <Section title="Block elements (U+2580–U+259F) · the fill toolkit">
        {rangeChars(0x2580, 0x259F)}
      </Section>

      <Section title="Geometric shapes (U+25A0–U+25FF)">
        {rangeChars(0x25A0, 0x25FF)}
      </Section>

      <Section title="Misc symbols (U+2600–U+26FF) · ☀ ☁ ☂ ★ ♠ ♣ ♥ ♦ ♪ ♫">
        {rangeChars(0x2600, 0x26FF)}
      </Section>

      <Section title="Dingbats (U+2700–U+27BF) · ✓ ✗ ✦ ✪ ❑ ❤ ❥ ➜">
        {rangeChars(0x2700, 0x27BF)}
      </Section>

      <Section title="Misc math A (U+27C0–U+27EF)">
        {rangeChars(0x27C0, 0x27EF)}
      </Section>

      <Section title="Supplemental arrows (U+2900–U+297F)">
        {rangeChars(0x2900, 0x297F)}
      </Section>

      <Section title="Misc math B (U+2980–U+29FF)">
        {rangeChars(0x2980, 0x29FF)}
      </Section>

      <Section title="Supplemental math operators (U+2A00–U+2AFF)">
        {rangeChars(0x2A00, 0x2AFF)}
      </Section>

      <Section title="Braille patterns (U+2800–U+28FF) · all 256 dot-patterns">
        {rangeChars(0x2800, 0x28FF)}
      </Section>

      <Section title="Block elements extra (U+1FB00 BMP, ⮕ ⮒ etc.)">
        <Text style={{ color: palette.dim }}>(non-BMP omitted; surrogate-pair-aware writeText is a follow-up)</Text>
      </Section>

      <Section title="Shaded fill ramp">
        <GlyphRow chars="░▒▓█" />
      </Section>

      <Section title="Vertical bar ramp (single-cell partial bars)">
        <GlyphRow chars="▏▎▍▌▋▊▉█" />
      </Section>

      <Section title="Horizontal bar ramp">
        <GlyphRow chars="▁▂▃▄▅▆▇█" />
      </Section>

      <Section title="Quadrant blocks (▘ ▝ ▖ ▗ etc.) · 2×2 cells per char">
        <GlyphRow chars="▘▝▖▗▙▟▛▜▚▞" />
      </Section>
    </Col>
  );
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <Col style={{ gap: 0 }}>
      <Text style={{ color: palette.purple, fontWeight: 'bold' }}>{title}</Text>
      {children}
      <Text> </Text>
    </Col>
  );
}

function GlyphRow({ chars }: { chars: string }) {
  return <Text style={{ color: palette.ink }}>{chars}</Text>;
}

function rangeChars(start: number, end: number): any {
  let s = '';
  for (let cp = start; cp <= end; cp++) s += String.fromCharCode(cp);
  return <Text style={{ color: palette.ink }}>{s}</Text>;
}

function asciiPrintable(): any {
  let s = '';
  for (let cp = 0x21; cp <= 0x7E; cp++) s += String.fromCharCode(cp);
  return <Text style={{ color: palette.ink }}>{s}</Text>;
}

// ── Fonts (Unicode pseudo-fonts) ──────────────────────────────────

function FontsPage() {
  // Map "letter index" 0..25 to a code point in each math-alphanumeric range.
  // Helper picks an offset and writes A..Z and a..z.
  function alphabet(upperStart: number, lowerStart: number): string {
    let s = '';
    for (let i = 0; i < 26; i++) {
      // BMP-friendly: most math alphanumerics are non-BMP (need surrogate
      // pairs). String.fromCodePoint handles them; many fonts cover them.
      s += String.fromCodePoint(upperStart + i);
    }
    s += ' ';
    for (let i = 0; i < 26; i++) s += String.fromCodePoint(lowerStart + i);
    return s;
  }
  return (
    <Col style={{ gap: 0, flexShrink: 1 }}>
      <H1>Pseudo-fonts via Unicode</H1>
      <Sub>terminal font is fixed; these are different code points that LOOK like font variants. coverage depends on the user's font (Cascadia/Iosevka/JetBrains/Berkeley have full coverage).</Sub>
      <Spacer />

      <FontRow label="plain" body={alphabet(0x0041, 0x0061)} />
      <FontRow label="bold"        body={alphabet(0x1D400, 0x1D41A)} />
      <FontRow label="italic"      body={alphabet(0x1D434, 0x1D44E)} />
      <FontRow label="bold-italic" body={alphabet(0x1D468, 0x1D482)} />
      <FontRow label="script"      body={alphabet(0x1D49C, 0x1D4B6)} />
      <FontRow label="bold script" body={alphabet(0x1D4D0, 0x1D4EA)} />
      <FontRow label="fraktur"     body={alphabet(0x1D504, 0x1D51E)} />
      <FontRow label="double-struck" body={alphabet(0x1D538, 0x1D552)} />
      <FontRow label="bold fraktur"  body={alphabet(0x1D56C, 0x1D586)} />
      <FontRow label="sans"        body={alphabet(0x1D5A0, 0x1D5BA)} />
      <FontRow label="sans-bold"   body={alphabet(0x1D5D4, 0x1D5EE)} />
      <FontRow label="sans-italic" body={alphabet(0x1D608, 0x1D622)} />
      <FontRow label="monospace"   body={alphabet(0x1D670, 0x1D68A)} />

      <Spacer />
      <Caption>fullwidth (each cell is 2 wide):</Caption>
      <Text style={{ color: palette.ink }}>{(() => { let s = ''; for (let i = 0; i < 26; i++) s += String.fromCharCode(0xFF21 + i); return s; })()}</Text>

      <Spacer />
      <Caption>circled letters:</Caption>
      <Text style={{ color: palette.ink }}>{(() => { let s = ''; for (let i = 0; i < 26; i++) s += String.fromCharCode(0x24B6 + i); return s; })()}</Text>

      <Spacer />
      <Caption>parenthesized small letters:</Caption>
      <Text style={{ color: palette.ink }}>{(() => { let s = ''; for (let i = 0; i < 26; i++) s += String.fromCharCode(0x249C + i); return s; })()}</Text>

      <Spacer />
      <Caption>numerals: plain, bold, sans, double-struck, mono, circled, fullwidth</Caption>
      <FontRow label="plain"   body={'0123456789'} />
      <FontRow label="bold"    body={String.fromCodePoint(...range(0x1D7CE, 0x1D7D7))} />
      <FontRow label="sans"    body={String.fromCodePoint(...range(0x1D7E2, 0x1D7EB))} />
      <FontRow label="d-struck" body={String.fromCodePoint(...range(0x1D7D8, 0x1D7E1))} />
      <FontRow label="mono"    body={String.fromCodePoint(...range(0x1D7F6, 0x1D7FF))} />
      <FontRow label="circled" body={String.fromCharCode(...range(0x2460, 0x2469))} />
      <FontRow label="fullw"   body={String.fromCharCode(...range(0xFF10, 0xFF19))} />
    </Col>
  );
}

function FontRow({ label, body }: { label: string; body: string }) {
  return (
    <Row style={{ gap: 1, flexWrap: 'wrap' }}>
      <Box style={{ width: 14 }}><Text style={{ color: palette.dim }}>{label}</Text></Box>
      <Text style={{ color: palette.ink }}>{body}</Text>
    </Row>
  );
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

// ── Wide ───────────────────────────────────────────────────────────

function WidePage() {
  return (
    <Col style={{ gap: 0, flexShrink: 1 }}>
      <H1>Wide-character layout</H1>
      <Sub>CJK / fullwidth code points are 2 cells wide. host's strWidth() handles intrinsic sizing; writeText writes a continuation cell so cursor tracking stays accurate.</Sub>
      <Spacer />

      <Caption>fullwidth ASCII:</Caption>
      <Text style={{ color: palette.ink }}>＋ － ＝ ／ ＼ ［ ］ ｛ ｝ ＜ ＞ ？ ！ ＠ ＃ ＄</Text>
      <Spacer />

      <Caption>CJK:</Caption>
      <Text style={{ color: palette.ink }}>こんにちは 世界 — 안녕하세요 — 你好世界</Text>
      <Spacer />

      <Caption>boxed wide-char content (border math counts cells, not chars):</Caption>
      <Box style={{ borderWidth: 1, borderColor: palette.accent, paddingLeft: 1, paddingRight: 1 }}>
        <Text style={{ color: palette.ink, fontWeight: 'bold' }}>状態: 良好</Text>
        <Text style={{ color: palette.dim }}>border + padding measure correctly</Text>
      </Box>
      <Spacer />

      <Caption>mixed widths in one row (wraps):</Caption>
      <Row style={{ gap: 1, flexWrap: 'wrap' }}>
        <Box style={{ borderWidth: 1, borderColor: palette.border, paddingLeft: 1, paddingRight: 1 }}>
          <Text style={{ color: palette.ink }}>english</Text>
        </Box>
        <Box style={{ borderWidth: 1, borderColor: palette.border, paddingLeft: 1, paddingRight: 1 }}>
          <Text style={{ color: palette.ink }}>日本語</Text>
        </Box>
        <Box style={{ borderWidth: 1, borderColor: palette.border, paddingLeft: 1, paddingRight: 1 }}>
          <Text style={{ color: palette.ink }}>한국어</Text>
        </Box>
        <Box style={{ borderWidth: 1, borderColor: palette.border, paddingLeft: 1, paddingRight: 1 }}>
          <Text style={{ color: palette.ink }}>中文</Text>
        </Box>
      </Row>
    </Col>
  );
}

// ── Chat (useAssistant demo) ──────────────────────────────────────

function ChatPage() {
  const useAssistant = require('@reactjit/runtime/hooks/useAssistant').useAssistant;
  const callHost = require('@reactjit/runtime/ffi').callHost;
  const hasHost = require('@reactjit/runtime/ffi').hasHost;

  const cwd = (() => {
    try {
      if (hasHost('__cwd')) return callHost('__cwd', '/tmp');
      if (hasHost('__env')) return callHost('__env', '/tmp', 'HOME');
    } catch {}
    return '/tmp';
  })();

  const [backend, setBackend] = React.useState<string>('claude_code');
  const [input, setInput] = React.useState('');
  const inputRef = React.useRef('');
  inputRef.current = input;

  const opts: any = {
    backend,
    cwd,
    persistAcrossUnmount: true,
  };
  if (backend === 'claude_code') opts.model = 'claude-sonnet-4-5';

  const assistant = useAssistant(opts);

  const submit = () => {
    const t = inputRef.current.trim();
    if (!t) return;
    if (!assistant.ask(t)) return;
    setInput('');
  };

  return (
    <Col style={{ gap: 0, flexShrink: 1, height: 30 }}>
      <H1>useAssistant</H1>
      <Sub>same hook the GPU host uses for chat — claude_code / codex_app_server / kimi_cli_wire / local_ai / openai_compat backends.</Sub>
      <Spacer />

      <Row style={{ gap: 1, flexWrap: 'wrap' }}>
        <Text style={{ color: palette.dim }}>backend:</Text>
        {(['claude_code', 'codex_app_server', 'openai_compat'] as const).map((b) => (
          <Pressable key={b} onPress={() => setBackend(b)}>
            <Box style={{
              backgroundColor: backend === b ? palette.card : undefined,
              paddingLeft: 1, paddingRight: 1,
            }}>
              <Text style={{
                color: backend === b ? palette.accent : palette.dim,
                fontWeight: backend === b ? 'bold' : undefined,
              }}>{b}</Text>
            </Box>
          </Pressable>
        ))}
        <Text style={{ color: palette.faint }}>· phase=<Text style={{ color: phasePaletteColor(assistant.phase) }}>{assistant.phase}</Text></Text>
        {assistant.workerId ? <Text style={{ color: palette.faint }}>· worker={assistant.workerId.slice(0, 8)}</Text> : null}
      </Row>

      {assistant.error ? (
        <Text style={{ color: palette.bad }}>error: {assistant.error}</Text>
      ) : null}

      <Spacer />
      <Box style={{
        flexGrow: 1, flexShrink: 1,
        borderWidth: 1, borderColor: palette.border,
        paddingLeft: 1, paddingRight: 1,
      }}>
        <ScrollView style={{ flexGrow: 1 }}>
          {assistant.events.length === 0
            ? <Text style={{ color: palette.faint }}>(no messages yet — type below and press Enter)</Text>
            : assistant.events.map((ev: any) => (
                <Col key={ev.id}>
                  <Text style={{ color: eventColor(ev.kind), dim: ev.kind === 'lifecycle' || ev.kind === 'status' }}>
                    [{ev.id}] {ev.kind}{ev.role ? ` ${ev.role}` : ''}{ev.phase ? ` (${ev.phase})` : ''}
                  </Text>
                  {ev.text ? <Text style={{ color: palette.ink }}>{ev.text}</Text> : null}
                  {ev.status_text && !ev.text ? <Text style={{ color: palette.dim }}>{ev.status_text}</Text> : null}
                </Col>
              ))}
        </ScrollView>
      </Box>

      <Row style={{ gap: 1, alignItems: 'center' }}>
        <Text style={{ color: palette.accent, fontWeight: 'bold' }}>›</Text>
        <Box style={{ flexGrow: 1, borderWidth: 1, borderColor: palette.border, paddingLeft: 1, paddingRight: 1 }}>
          <TextInput
            value={input}
            placeholder="ask anything · Enter to send"
            onChangeText={(v: string) => setInput(v)}
            onSubmitEditing={submit}
          />
        </Box>
      </Row>
    </Col>
  );
}

function phasePaletteColor(phase: string): string {
  if (phase === 'streaming') return palette.accent;
  if (phase === 'idle') return palette.good;
  if (phase === 'starting' || phase === 'init') return palette.dim;
  if (phase === 'failed') return palette.bad;
  return palette.faint;
}
function eventColor(kind: string): string {
  if (kind === 'assistant_message') return palette.good;
  if (kind === 'user_message') return palette.blue;
  if (kind === 'tool_call' || kind === 'tool_output') return palette.purple;
  if (kind === 'reasoning') return palette.dim;
  if (kind === 'error_') return palette.bad;
  if (kind === 'completion') return palette.faint;
  return palette.faint;
}

// ── Input (TextInput demo) ────────────────────────────────────────

function InputPage() {
  const [name, setName] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [submitted, setSubmitted] = React.useState<string[]>([]);
  return (
    <Col style={{ gap: 0, flexShrink: 1 }}>
      <H1>TextInput</H1>
      <Sub>click into a field, type, Backspace to delete, Enter to submit, Tab to next field, Esc to drop focus.</Sub>
      <Spacer />

      <Caption>name:</Caption>
      <Box style={{ borderWidth: 1, borderColor: palette.border, paddingLeft: 1, paddingRight: 1, width: 40 }}>
        <TextInput
          value={name}
          placeholder="type a name…"
          onChangeText={(v: string) => setName(v)}
        />
      </Box>
      <Text style={{ color: palette.dim }}>echo: {name || '(empty)'}</Text>
      <Spacer />

      <Caption>search (Enter to submit):</Caption>
      <Box style={{ borderWidth: 1, borderColor: palette.border, paddingLeft: 1, paddingRight: 1, width: 50 }}>
        <TextInput
          value={search}
          placeholder="press Enter when done…"
          onChangeText={(v: string) => setSearch(v)}
          onSubmitEditing={({ value }: any) => {
            if (typeof value === 'string' && value.length > 0) {
              setSubmitted((prev) => [...prev, value]);
              setSearch('');
            }
          }}
        />
      </Box>
      <Spacer />

      <Caption>submitted history:</Caption>
      {submitted.length === 0
        ? <Text style={{ color: palette.faint }}>(none yet)</Text>
        : submitted.map((s, i) => (
            <Text key={i} style={{ color: palette.ink }}>{i + 1}. {s}</Text>
          ))}
    </Col>
  );
}

// ── Term ───────────────────────────────────────────────────────────

function TermPage() {
  return (
    <Col style={{ gap: 0, flexShrink: 1 }}>
      <H1>Embedded shell (vterm)</H1>
      <Sub>libvterm-backed PTY rendered as cells. click in to focus → keystrokes go to the shell. Ctrl+] returns to the cart. resize the box (or terminal) and the PTY follows.</Sub>
      <Spacer />
      <Box style={{
        borderWidth: 1, borderColor: palette.border, padding: 0,
        height: 18,
      }}>
        <Terminal style={{ width: '100%', height: '100%' }} />
      </Box>
      <Spacer />
      <Sub>spawned with $SHELL or /bin/sh. supports ANSI / xterm-256color / SGR — same wire format the host uses for our own paint.</Sub>
    </Col>
  );
}

// ── FX (WGSL shaders compiled and sampled per cell) ───────────────
//
// Full-screen viewer that cycles through shaders with ←/→ arrow keys. The
// shaders are the same `<Effect shader={WGSL}>` elements you'd use on the
// GPU host; the TUI compiles each one once (memoized) into a JS sampler
// and renders via the upper-half-block (▀) trick. Hover the mouse over
// the surface and shaders that read U.mouse_x / U.mouse_y track it.

const FX_PLASMA = `
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let x = in.uv.x * U.size_w;
  let y = in.uv.y * U.size_h;
  let t = U.time;
  let fx = x * 0.18;
  let fy = y * 0.18;
  let v1 = sin(fx + t);
  let v2 = sin(fy + t * 0.7);
  let v3 = sin(fx + fy + t * 0.5);
  let v4 = sin(sqrt(fx * fx + fy * fy) + t);
  let v = (v1 + v2 + v3 + v4) * 0.25 + 0.5;
  let r = sin(v * 3.14159) * 0.5 + 0.5;
  let g = sin(v * 3.14159 + 2.094) * 0.5 + 0.5;
  let b = sin(v * 3.14159 + 4.189) * 0.5 + 0.5;
  return vec4f(r, g, b, 1.0);
}
`;

const FX_RINGS = `
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let p = (in.uv - vec2f(0.5, 0.5)) * 2.0;
  let d = sqrt(p.x * p.x + p.y * p.y);
  let t = U.time;
  let band = sin(d * 18.0 - t * 3.0) * 0.5 + 0.5;
  let hue_t = d + t * 0.15;
  let r = sin(hue_t * 6.28318) * 0.5 + 0.5;
  let g = sin(hue_t * 6.28318 + 2.094) * 0.5 + 0.5;
  let b = sin(hue_t * 6.28318 + 4.189) * 0.5 + 0.5;
  let edge = 1.0 - smoothstep(0.92, 1.02, d);
  let v = band * edge;
  return vec4f(r * v, g * v, b * v, edge);
}
`;

const FX_VORTEX = `
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let p = (in.uv - vec2f(0.5, 0.5)) * 2.0;
  let r = sqrt(p.x * p.x + p.y * p.y);
  let a = atan2(p.y, p.x);
  let t = U.time;
  let arm = sin(a * 4.0 + r * 8.0 - t * 2.0) * 0.5 + 0.5;
  let pulse = sin(r * 6.0 - t * 1.5) * 0.5 + 0.5;
  let mask = 1.0 - smoothstep(0.85, 1.05, r);
  let cr = 0.10 + arm * 0.9;
  let cg = 0.05 + pulse * 0.6;
  let cb = 0.50 + arm * 0.5;
  return vec4f(cr * mask, cg * mask, cb * mask, mask);
}
`;

// Animated sunset gradient that drifts horizontally and pulses the vignette.
// The earlier version was time-independent — looked correct but felt dead in
// a viewer that's supposed to show off motion. Now everything in the FX page
// is alive.
const FX_GRADIENT = `
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let t = U.time;
  // Sliding offset so the color bands drift left/right with a slow sine.
  let slide = sin(t * 0.35) * 0.20 + sin(t * 0.11) * 0.10;
  let u = in.uv.x + slide;
  let c0 = vec3f(0.04, 0.05, 0.20);
  let c1 = vec3f(0.50, 0.10, 0.45);
  let c2 = vec3f(0.95, 0.36, 0.20);
  let c3 = vec3f(1.00, 0.84, 0.30);
  // wrap into [0,3) so the gradient is a continuous loop.
  let ts0 = u * 3.0;
  let ts = ts0 - floor(ts0 / 3.0) * 3.0;
  var rgb = c0;
  if (ts < 1.0) { rgb = mix(c0, c1, ts); }
  else if (ts < 2.0) { rgb = mix(c1, c2, ts - 1.0); }
  else { rgb = mix(c2, c3, ts - 2.0); }
  // Vignette breathes with time, plus a soft horizontal scan-line shimmer.
  let pulse = 0.85 + 0.15 * sin(t * 1.6);
  let v = (1.0 - abs(in.uv.y - 0.5) * 0.6) * pulse;
  let shimmer = 0.06 * sin(in.uv.y * 60.0 + t * 4.0);
  return vec4f(rgb.x * v + shimmer, rgb.y * v + shimmer, rgb.z * v + shimmer, 1.0);
}
`;

const FX_CHECKER = `
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let p = in.uv * 8.0;
  let cx = floor(p.x);
  let cy = floor(p.y);
  let parity = (cx + cy) - 2.0 * floor((cx + cy) * 0.5);
  let t = U.time;
  let hue = (cx * 0.07 + cy * 0.11 + t * 0.2);
  let r = sin(hue * 6.28318) * 0.5 + 0.5;
  let g = sin(hue * 6.28318 + 2.094) * 0.5 + 0.5;
  let b = sin(hue * 6.28318 + 4.189) * 0.5 + 0.5;
  let k = 0.20 + parity * 0.80;
  return vec4f(r * k, g * k, b * k, 1.0);
}
`;

// Storage-binding example: a multi-blob field with isolines, same shape the
// real contour_demo.tsx uses on the GPU.
const FX_CONTOUR = `
@group(0) @binding(1) var<storage, read> ys: array<f32>;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let n = u32(ys[0]);
  let level_step = ys[1];

  let p = (in.uv - vec2f(0.5, 0.5)) * 2.0;
  var f = 0.0;
  for (var i = 0u; i < n; i = i + 1u) {
    let base = 4u + i * 4u;
    let cx = ys[base + 0u];
    let cy = ys[base + 1u];
    let strength = ys[base + 2u];
    let sigma = ys[base + 3u];
    let dx = p.x - cx;
    let dy = p.y - cy;
    let r2 = dx * dx + dy * dy;
    f = f + strength * exp(-r2 / (sigma * sigma));
  }

  let c0 = vec3f(0.04, 0.06, 0.16);
  let c1 = vec3f(0.18, 0.30, 0.62);
  let c2 = vec3f(0.22, 0.66, 0.74);
  let c3 = vec3f(0.55, 0.85, 0.45);
  let c4 = vec3f(0.96, 0.86, 0.30);
  let c5 = vec3f(0.96, 0.42, 0.30);

  let tcl = clamp(f, 0.0, 1.0);
  let ts = tcl * 5.0;
  var bg = c0;
  if (ts < 1.0) { bg = mix(c0, c1, ts); }
  else if (ts < 2.0) { bg = mix(c1, c2, ts - 1.0); }
  else if (ts < 3.0) { bg = mix(c2, c3, ts - 2.0); }
  else if (ts < 4.0) { bg = mix(c3, c4, ts - 3.0); }
  else { bg = mix(c4, c5, ts - 4.0); }

  let nearest = round(f / level_step) * level_step;
  let dist = abs(f - nearest);
  let line = 1.0 - smoothstep(0.008, 0.020, dist);
  let col = mix(bg, vec3f(0.95, 0.97, 1.00), line * 0.7);
  return vec4f(col.x, col.y, col.z, 1.0);
}
`;

// Parallax dots — same pattern as runtime/background.tsx (the GPU cart's
// cursor-glow background). Three layers of dots translate inversely to mouse
// position, a soft radial glow follows the cursor, and ghost glows orbit the
// surface when the mouse is outside. Hover the FX viewport and move; when
// you leave, the ghost lights take over.
const FX_DOTS = `
fn rand2(x: f32, y: f32) -> f32 {
  let d = sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return d - floor(d);
}

fn layer(x: f32, y: f32, cell: f32, ox: f32, oy: f32, radius: f32) -> f32 {
  let sx = x + ox;
  let sy = y + oy;
  let cx = floor(sx / cell);
  let cy = floor(sy / cell);
  let lx = sx - cx * cell;
  let ly = sy - cy * cell;
  let center = cell * 0.5;
  let dx = lx - center;
  let dy = ly - center;
  let dist = sqrt(dx * dx + dy * dy);
  let brightness = 0.50 + rand2(cx, cy) * 0.50;
  let edge = 1.0 - smoothstep(radius - 0.8, radius + 0.4, dist);
  return edge * brightness;
}

fn lightAt(x: f32, y: f32, lx: f32, ly: f32, sigma: f32) -> f32 {
  let dx = x - lx;
  let dy = y - ly;
  return exp(-(dx * dx + dy * dy) / (2.0 * sigma * sigma));
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let x = in.uv.x * U.size_w;
  let y = in.uv.y * U.size_h;
  let t = U.time;

  let mxN = ((U.mouse_x / U.size_w) * 2.0 - 1.0) * U.mouse_inside;
  let myN = ((U.mouse_y / U.size_h) * 2.0 - 1.0) * U.mouse_inside;
  let idle = 1.0 - U.mouse_inside;

  // Background — vertical lerp from deep navy to a hint of magenta.
  let bg0 = vec3f(0.04, 0.05, 0.14);
  let bg1 = vec3f(0.10, 0.06, 0.22);
  var col = mix(bg0, bg1, in.uv.y);

  // Glow under the cursor scales with the surface short edge so it reads on
  // both a 40-row terminal and a 10-row preview pane. Kept tight (~12% of
  // short edge) so the lit region feels like a flashlight cone, not a full-
  // surface wash.
  let SIGMA = clamp(min(U.size_w, U.size_h) * 0.12, 4.0, 22.0);

  let cursorPulse = 0.85 + 0.15 * sin(t * 2.4);
  let cursorGlow = lightAt(x, y, U.mouse_x, U.mouse_y, SIGMA) * U.mouse_inside * cursorPulse;

  // Ghost lights orbit when the mouse isn't here.
  let g1x = U.size_w * (0.5 + 0.36 * sin(t * 0.27));
  let g1y = U.size_h * (0.5 + 0.30 * cos(t * 0.21));
  let g2x = U.size_w * (0.5 + 0.40 * cos(t * 0.19 + 1.7));
  let g2y = U.size_h * (0.5 + 0.32 * sin(t * 0.23 + 2.3));
  let g3x = U.size_w * (0.5 + 0.30 * sin(t * 0.33 + 4.1));
  let g3y = U.size_h * (0.5 + 0.28 * cos(t * 0.29 + 5.0));
  let ghost = (lightAt(x, y, g1x, g1y, SIGMA * 1.15)
             + lightAt(x, y, g2x, g2y, SIGMA)
             + lightAt(x, y, g3x, g3y, SIGMA * 1.25)) * 0.55 * idle;

  let glow = cursorGlow + ghost;

  // Idle drift so the layers never look frozen even with no mouse over.
  let driftX = sin(t * 0.17) * 0.30 + cos(t * 0.09) * 0.22;
  let driftY = cos(t * 0.13) * 0.28 + sin(t * 0.11) * 0.24;
  let driftMix = 0.30 + 0.70 * idle;
  let pX = mxN + driftX * driftMix;
  let pY = myN + driftY * driftMix;

  // Three parallax-translated layers. Cell sizes shrunk to read in the
  // terminal: GPU shader uses 26/18/12 px cells; we use 8/5/3 sub-cell px.
  let back  = layer(x, y, 8.0, pX *  2.0, pY *  1.5, 1.5);
  let mid   = layer(x, y, 5.0, pX *  7.0, pY *  4.5, 1.2);
  let front = layer(x, y, 3.0, pX * 20.0, pY * 14.0, 0.9);

  let cool   = vec3f(0.20, 0.40, 0.70);
  let body   = vec3f(0.50, 0.55, 0.95);
  let bright = vec3f(0.95, 0.97, 1.00);
  let hot    = vec3f(1.00, 0.80, 0.45);

  let reveal = glow * 2.6;
  col = col + cool   * back  * 0.45 * reveal;
  col = col + body   * mid   * 0.70 * reveal;
  col = col + bright * front * 1.00 * reveal;
  col = col + hot    * glow  * 0.15;

  return vec4f(col.x, col.y, col.z, 1.0);
}
`;

// Tunnel — classic VJ shader. Polar coords give us (angle, radius); flipping
// 1/radius gives perspective depth. Sampling a (twist*angle + speed*depth)
// stripe pattern reads as flying down an infinite hallway. Walls hue-cycle
// with depth so it never feels static even at low frame rates.
const FX_TUNNEL = `
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let p = (in.uv - vec2f(0.5, 0.5)) * 2.0;
  let t = U.time;
  let r = sqrt(p.x * p.x + p.y * p.y);
  let a = atan2(p.y, p.x);

  // Hyperbolic depth — far away cells get r→0, near cells r→1.
  let depth = 0.6 / max(r, 0.05) + t * 0.8;
  let twist = a * 6.0 + sin(t * 0.4) * 1.5;

  // Brick pattern walking outward. Stripe x stripe gives a tile, mod 2 picks
  // light/dark.
  let sx = depth * 0.6;
  let sy = twist * (0.35 + 0.20 * sin(t * 0.3));
  let tx = sx - 2.0 * floor(sx * 0.5);
  let ty = sy - 2.0 * floor(sy * 0.5);
  let brick = step(1.0, tx) * step(1.0, ty) + step(tx, 1.0) * step(ty, 1.0);
  let line = smoothstep(0.0, 0.05, abs(tx - 1.0)) * smoothstep(0.0, 0.05, abs(ty - 1.0));

  // Hue rolls with depth + time.
  let hue = depth * 0.05 + t * 0.10;
  let cr = sin(hue * 6.28318) * 0.5 + 0.5;
  let cg = sin(hue * 6.28318 + 2.094) * 0.5 + 0.5;
  let cb = sin(hue * 6.28318 + 4.189) * 0.5 + 0.5;

  // Fog: distant cells fade to black.
  let fog = smoothstep(0.0, 0.35, r);
  let v = brick * 0.55 * line * fog;
  // Central tunnel "light" pours out of the vanishing point.
  let core = smoothstep(0.35, 0.0, r);
  return vec4f(cr * v + core * 0.9, cg * v + core * 0.7, cb * v + core * 1.0, 1.0);
}
`;

// Voronoi — F1 distance to nearest of 9 animated seeds in a 3x3 cell grid.
// Cells colorize by seed index; edges glow brighter where two seeds tie.
// No data buffer needed; the seed positions are computed analytically from
// (cellX, cellY, time) using a hash so every cell stays distinct.
const FX_VORONOI = `
fn hash21(x: f32, y: f32) -> f32 {
  let d = sin(x * 127.1 + y * 311.7) * 43758.5453;
  return d - floor(d);
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let SCALE = 6.0;
  let p = in.uv * SCALE;
  let cx = floor(p.x);
  let cy = floor(p.y);
  let fx = p.x - cx;
  let fy = p.y - cy;
  let t = U.time;

  var d1 = 1e9;
  var d2 = 1e9;
  var hueOfWinner = 0.0;

  for (var oy = -1; oy < 2; oy = oy + 1) {
    for (var ox = -1; ox < 2; ox = ox + 1) {
      let nx = cx + f32(ox);
      let ny = cy + f32(oy);
      let h1 = hash21(nx, ny);
      let h2 = hash21(nx + 7.31, ny - 3.97);
      // Seed wobbles around its cell center.
      let sx = f32(ox) + 0.5 + 0.40 * sin(t * 0.9 + h1 * 6.28);
      let sy = f32(oy) + 0.5 + 0.40 * cos(t * 0.7 + h2 * 6.28);
      let dx = sx - fx;
      let dy = sy - fy;
      let d = sqrt(dx * dx + dy * dy);
      if (d < d1) {
        d2 = d1; d1 = d;
        hueOfWinner = h1;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }

  // Cell color from winning seed hue, plus edge glow at boundaries.
  let cr = sin(hueOfWinner * 6.28318) * 0.4 + 0.5;
  let cg = sin(hueOfWinner * 6.28318 + 2.094) * 0.4 + 0.5;
  let cb = sin(hueOfWinner * 6.28318 + 4.189) * 0.4 + 0.5;
  let interior = 1.0 - smoothstep(0.0, 0.5, d1);
  let edge = 1.0 - smoothstep(0.0, 0.08, d2 - d1);
  let v = interior * 0.55 + edge * 0.9;
  return vec4f(cr * v + edge * 0.3, cg * v + edge * 0.3, cb * v + edge * 0.3, 1.0);
}
`;

// Kaleidoscope — fold uv into a six-way symmetric wedge, then sample a
// rotating sin field inside it. The fold mirrors any radial input pattern,
// so even a simple stripe becomes a mandala. Cursor pushes the rotation
// rate so hovering swirls the field.
const FX_MANDALA = `
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let PI = 3.14159265;
  let p = (in.uv - vec2f(0.5, 0.5)) * 2.0;
  let t = U.time;
  // Cursor pushes rotation speed up to 2x; idle hold = 1x.
  let mxN = ((U.mouse_x / U.size_w) * 2.0 - 1.0) * U.mouse_inside;
  let push = 1.0 + 0.8 * abs(mxN);

  let r = sqrt(p.x * p.x + p.y * p.y);
  var a = atan2(p.y, p.x) + t * 0.20 * push;

  // 6-fold fold: bring a into [-pi/6, pi/6] and reflect via |.|.
  let SEG = PI / 6.0;
  let aMod = a - 2.0 * SEG * floor((a + SEG) / (2.0 * SEG));
  let af = abs(aMod);

  // Two rotating sin layers inside the wedge.
  let l1 = sin(r * 12.0 - t * 1.4) * sin(af * 5.0);
  let l2 = sin(r * 7.0 + t * 0.9) * cos(af * 3.0 + t * 0.5);
  let pat = (l1 + l2) * 0.5;

  // Hue cycles slowly; brightness tracks the pattern.
  let hue = t * 0.07 + r * 0.3;
  let cr = sin(hue * 6.28318) * 0.5 + 0.5;
  let cg = sin(hue * 6.28318 + 2.094) * 0.5 + 0.5;
  let cb = sin(hue * 6.28318 + 4.189) * 0.5 + 0.5;
  let bright = clamp(pat * 0.5 + 0.55, 0.0, 1.0);
  let edge = 1.0 - smoothstep(0.95, 1.05, r);
  let v = bright * edge;
  return vec4f(cr * v, cg * v, cb * v, edge);
}
`;

// Chladni plate — same standing-wave equation as cymatics.js in audio-canvas:
//   z(x,y) = cos(n*pi*x)*cos(m*pi*y) - cos(m*pi*x)*cos(n*pi*y)
// Particles would normally drift toward |z| ≈ 0 (nodal lines); we just render
// |z| directly. (n, m) drift over time so the pattern morphs continuously.
const FX_CHLADNI = `
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let PI = 3.14159265;
  let p = (in.uv - vec2f(0.5, 0.5)) * 2.0;
  let r2 = p.x * p.x + p.y * p.y;
  let t = U.time;

  // Non-integer (n, m) sweep through partial standing-wave modes — the
  // pattern lives most of its time between named modes which is where the
  // shape feels alive.
  let n = 3.0 + 2.5 * sin(t * 0.13);
  let m = 4.0 + 2.5 * cos(t * 0.11 + 1.4);
  let z = cos(n * PI * p.x) * cos(m * PI * p.y)
        - cos(m * PI * p.x) * cos(n * PI * p.y);
  let nodal = 1.0 - smoothstep(0.0, 0.18, abs(z));

  // Inside-plate mask, soft edge.
  let mask = 1.0 - smoothstep(0.92, 1.02, sqrt(r2));

  // Background = deep teal; lit nodal lines = pale gold over a midnight bath.
  let bg = vec3f(0.04, 0.10, 0.14);
  let line = vec3f(0.96, 0.92, 0.68);
  let col = mix(bg, line, nodal * 0.95);
  return vec4f(col.x * mask, col.y * mask, col.z * mask, mask);
}
`;

// Mandelbrot — the original fractal. Slow zoom over time + slight pan so we
// stay near the boundary where the structure is interesting. Coloring is
// smooth-iter (escape-time + log fractional part of |z|) for continuous hue
// rather than banded.
const FX_MANDELBROT = `
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let t = U.time;
  // Slow zoom on a known pretty seahorse-region target.
  let zoom = 1.6 * exp(-t * 0.08);
  let cx = -0.745 + sin(t * 0.05) * 0.02 * zoom + (in.uv.x - 0.5) * 2.0 * zoom;
  let cy =  0.113 + cos(t * 0.07) * 0.02 * zoom + (in.uv.y - 0.5) * 2.0 * zoom;

  var zx = 0.0;
  var zy = 0.0;
  var i = 0.0;
  let MAX = 48.0;
  for (var step = 0.0; step < MAX; step = step + 1.0) {
    let zx2 = zx * zx;
    let zy2 = zy * zy;
    if (zx2 + zy2 > 4.0) { break; }
    let nzx = zx2 - zy2 + cx;
    let nzy = 2.0 * zx * zy + cy;
    zx = nzx; zy = nzy;
    i = i + 1.0;
  }
  // Inside set → black; outside → smooth-iter colored.
  if (i >= MAX) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let smooth = i - log(log(sqrt(zx * zx + zy * zy)) / log(2.0)) / log(2.0);
  let h = smooth * 0.02 + t * 0.05;
  let r = sin(h * 6.28318) * 0.5 + 0.5;
  let g = sin(h * 6.28318 + 2.094) * 0.5 + 0.5;
  let b = sin(h * 6.28318 + 4.189) * 0.5 + 0.5;
  let v = clamp(smooth / MAX * 1.6, 0.0, 1.0);
  return vec4f(r * v, g * v, b * v, 1.0);
}
`;

function useContourData() {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 80);
    return () => clearInterval(id);
  }, []);
  // Six animated blobs orbiting their home positions.
  const blobs = [
    { cx: -0.40, cy: -0.20, s: 1.0, sig: 0.40, px: 0.0, py: 0.5, ax: 0.20, ay: 0.10 },
    { cx:  0.55, cy:  0.30, s: 0.8, sig: 0.32, px: 1.0, py: 1.5, ax: 0.16, ay: 0.18 },
    { cx: -0.10, cy:  0.45, s: 0.7, sig: 0.28, px: 2.0, py: 0.0, ax: 0.14, ay: 0.12 },
    { cx:  0.30, cy: -0.40, s: 0.6, sig: 0.30, px: 0.5, py: 2.5, ax: 0.22, ay: 0.08 },
    { cx: -0.55, cy:  0.25, s: 0.5, sig: 0.26, px: 1.5, py: 1.0, ax: 0.12, ay: 0.14 },
    { cx:  0.10, cy:  0.05, s: 0.6, sig: 0.24, px: 2.5, py: 2.0, ax: 0.10, ay: 0.12 },
  ];
  const t = tick * 0.08;
  const out: number[] = [blobs.length, 0.10, 0, 0];
  for (const b of blobs) {
    out.push(
      b.cx + Math.sin(t + b.px) * b.ax,
      b.cy + Math.cos(t + b.py) * b.ay,
      b.s,
      b.sig,
    );
  }
  return out;
}

type FxEntry = { title: string; note: string; shader: string; useData?: () => number[] };

const FX_LIST: FxEntry[] = [
  { title: 'dots',       note: 'parallax dots — hover/move the cursor to push the layers',     shader: FX_DOTS },
  { title: 'tunnel',     note: 'infinite VJ tunnel — polar coords + 1/r perspective depth',     shader: FX_TUNNEL },
  { title: 'voronoi',    note: 'F1 cellular noise w/ animated seeds, edge glow on F2-F1 tie',   shader: FX_VORONOI },
  { title: 'mandala',    note: 'six-fold kaleidoscope with two layered sin fields — hover swirls', shader: FX_MANDALA },
  { title: 'chladni',    note: 'standing-wave nodal pattern (same eqn as audio-canvas cymatics)', shader: FX_CHLADNI },
  { title: 'mandelbrot', note: 'slow zoom into the seahorse valley, smooth-iter coloring',       shader: FX_MANDELBROT },
  { title: 'plasma',     note: 'four-wave sin field, same shader as cart/plasma.tsx',           shader: FX_PLASMA },
  { title: 'rings',      note: 'pulsing concentric circles, hue cycles with radius',            shader: FX_RINGS },
  { title: 'vortex',     note: 'spiral arms + radial pulse, alpha mask to a disk',              shader: FX_VORTEX },
  { title: 'gradient',   note: 'animated three-stop sunset with shimmer and pulse',             shader: FX_GRADIENT },
  { title: 'checker',    note: '8x8 hue-cycling checker',                                       shader: FX_CHECKER },
  { title: 'contour',    note: 'six animated gaussian blobs + isolines (storage buffer)',       shader: FX_CONTOUR, useData: useContourData },
];

// Full-screen viewer. ←/→ cycle, hover the surface for shaders that read
// U.mouse_x / U.mouse_y. The HUD strip floats on top of the shader; the
// shader covers the entire viewport behind it.
function FxPage() {
  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => subscribeKey((k: string) => {
    // Arrow keys send CSI sequences. Also accept h/l (vim) and , / . so users
    // without an arrow-key-emitting terminal still have a way through.
    if (k === '\x1b[C' || k === 'l' || k === '.') setIdx((i) => (i + 1) % FX_LIST.length);
    else if (k === '\x1b[D' || k === 'h' || k === ',') setIdx((i) => (i - 1 + FX_LIST.length) % FX_LIST.length);
  }), []);
  const fx = FX_LIST[idx];
  return (
    <Box style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: '#000000' }}>
      <FxSurface fx={fx} />
      <FxHud idx={idx} fx={fx} />
    </Box>
  );
}

// Surface is keyed by title so React tears down + remounts when the user
// cycles. That way each shader gets a fresh hook chain — useContourData
// only runs for the contour shader, not as a parallel `if (fx.useData)`
// call that would violate React's rules of hooks across re-renders.
function FxSurface({ fx }: { fx: FxEntry }) {
  return <FxRunner key={fx.title} fx={fx} />;
}

function FxRunner({ fx }: { fx: FxEntry }) {
  const data = fx.useData ? fx.useData() : undefined;
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}>
      <Effect shader={fx.shader} data={data} style={{ width: '100%', height: '100%' }} />
    </Box>
  );
}

function FxHud({ idx, fx }: { idx: number; fx: FxEntry }) {
  return (
    <Col style={{ position: 'absolute', left: 0, top: 0, width: '100%' }}>
      <Row style={{ paddingLeft: 1, paddingRight: 1, gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Text style={{ color: '#fef3c7', fontWeight: 'bold' }}> {idx + 1}/{FX_LIST.length} </Text>
        <Text style={{ color: '#fbbf24', fontWeight: 'bold' }}>{fx.title}</Text>
        <Text style={{ color: '#e5e7eb' }}>· {fx.note}</Text>
      </Row>
      <Row style={{ paddingLeft: 1, paddingRight: 1, gap: 1 }}>
        <Text style={{ color: '#94a3b8' }}>←/→ or h/l to cycle · hover the surface to drive U.mouse_x/y</Text>
      </Row>
    </Col>
  );
}

// ── Layout primitives shared across pages ─────────────────────────

function H1({ children }: { children: any }) {
  return <Text style={{ color: palette.accent, fontWeight: 'bold' }}>{children}</Text>;
}
function Sub({ children }: { children: any }) {
  return <Text style={{ color: palette.dim }}>{children}</Text>;
}
function Caption({ children }: { children: any }) {
  return <Text style={{ color: palette.ink, fontWeight: 'bold' }}>{children}</Text>;
}
function Spacer() {
  return <Text> </Text>;
}
