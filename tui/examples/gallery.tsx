// gallery — comprehensive surface tour of the TUI host. Pages walk
// through SGR text styles, 24-bit color, glyph ranges (the basis for
// thinking about <Effect> translation later), and wide-char rendering.
//
// All Rows wrap so the layout still reads on a 60-column terminal.

import * as React from 'react';
import { Box, Row, Col, Text, Pressable, ScrollView, Terminal, TextInput } from '../../runtime/primitives';
import { Router, Route, Link, useRoute } from '../../runtime/router';

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
        </Row>
        <Footer />
      </Box>
    </Router>
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
