// profile_bands — same data, same JSX skeleton, five compositions.
// Variants meta-shape the band tree: which bands exist, how each band
// flows internally, and which cells are nulled.

import { useState } from 'react';
import { ThemeProvider, classifiers as C, setVariant, setDim } from '../runtime/classifier';
import type { ThemeColors, StylePalette } from '../runtime/classifier';
import './profile_bands.cls';

const COLORS: Partial<ThemeColors> = {
  bg: '#0b1117',
  bgAlt: '#111a24',
  bgElevated: '#162231',
  surface: '#1a2533',
  border: '#2a3a52',
  borderFocus: '#facc15',
  text: '#eef5ff',
  textSecondary: '#b6c4d7',
  textDim: '#7d8ba1',
  accent: '#facc15',
};

const STYLES: Partial<StylePalette> = { radiusSm: 4, radiusMd: 8, radiusLg: 14 };

// ── the band vocabulary ──────────────────────────────────
// Card-scope: S.Card, S.Header / .A/.B/.C, S.Body / .A, S.Footer / .A/.B
// App-scope:  S.App, S.Shell / .Brand / .Nav / .NavItem / .Status, S.Page
const S = {
  // card
  Card: C.PB_Card,
  Header: Object.assign(C.PB_Header, {
    A: C.PB_HeaderA,
    Initial: C.PB_Initial,
    B: C.PB_HeaderB,
    C: C.PB_HeaderC,
  }),
  Body: Object.assign(C.PB_Body, { A: C.PB_BodyA }),
  Footer: Object.assign(C.PB_Footer, { A: C.PB_FooterA, B: C.PB_FooterA }),

  // shell
  App: C.PB_App,
  Page: C.PB_Page,
  Shell: Object.assign(C.PB_Shell, {
    Brand: Object.assign(C.PB_ShellBrand, { Text: C.PB_ShellBrandText }),
    Nav: Object.assign(C.PB_ShellNav, {
      Item: Object.assign(C.PB_ShellNavItem, { Text: C.PB_ShellNavText }),
    }),
    Status: C.PB_ShellStatus,
  }),
};

const PERSON = {
  initial: 'M',
  name: 'Mira Sato',
  title: 'SOUND DESIGNER · LICHTBLICK',
  bio: 'Builds generative instruments for live performance. Currently obsessed with granular synthesis of field recordings from underwater hydrophones in the Sea of Japan.',
  followers: '12.4k followers',
  works: '38 works',
};

const VARIANTS = [
  { id: null,        label: 'stack' },
  { id: 'idcard',    label: 'idcard' },
  { id: 'magazine',  label: 'magazine' },
  { id: 'quote',     label: 'quote' },
  { id: 'trading',   label: 'trading' },
] as const;

const ANCHORS = [
  { id: null,     label: 'auto' },
  { id: 'left',   label: 'left' },
  { id: 'center', label: 'center' },
  { id: 'right',  label: 'right' },
] as const;

const DENSITIES = [
  { id: null,    label: 'normal' },
  { id: 'dense', label: 'dense' },
  { id: 'airy',  label: 'airy' },
] as const;

// This JSX never changes across variants.
function ProfileCard() {
  return (
    <S.Card>
      <S.Header>
        <S.Header.A>
          <S.Header.Initial>{PERSON.initial}</S.Header.Initial>
        </S.Header.A>
        <S.Header.B>{PERSON.name}</S.Header.B>
        <S.Header.C>{PERSON.title}</S.Header.C>
      </S.Header>
      <S.Body>
        <S.Body.A>{PERSON.bio}</S.Body.A>
      </S.Body>
      <S.Footer>
        <S.Footer.A>{PERSON.followers}</S.Footer.A>
        <S.Footer.B>{PERSON.works}</S.Footer.B>
      </S.Footer>
    </S.Card>
  );
}

type Choice = { id: string | null; label: string };

function Switcher({
  choices, active, onPick,
}: {
  choices: ReadonlyArray<Choice>;
  active: string | null;
  onPick: (id: string | null) => void;
}) {
  return (
    <C.PB_Switcher>
      {choices.map((v) => {
        const isActive = v.id === active;
        const Btn = isActive ? C.PB_SwitchBtnActive : C.PB_SwitchBtn;
        const Txt = isActive ? C.PB_SwitchTextActive : C.PB_SwitchText;
        return (
          <Btn key={v.label} onPress={() => onPick(v.id)}>
            <Txt>{v.label}</Txt>
          </Btn>
        );
      })}
    </C.PB_Switcher>
  );
}

// The shell JSX — also identical across every variant. The cells inside
// are persistent regardless of which composition the variant picks.
function AppShell({ children }: { children: any }) {
  return (
    <S.App>
      <S.Shell>
        <S.Shell.Brand>
          <S.Shell.Brand.Text>R</S.Shell.Brand.Text>
        </S.Shell.Brand>
        <S.Shell.Nav>
          <S.Shell.Nav.Item>
            <S.Shell.Nav.Item.Text>Discover</S.Shell.Nav.Item.Text>
          </S.Shell.Nav.Item>
          <S.Shell.Nav.Item>
            <S.Shell.Nav.Item.Text>Library</S.Shell.Nav.Item.Text>
          </S.Shell.Nav.Item>
          <S.Shell.Nav.Item>
            <S.Shell.Nav.Item.Text>Drafts</S.Shell.Nav.Item.Text>
          </S.Shell.Nav.Item>
        </S.Shell.Nav>
        <S.Shell.Status>● online</S.Shell.Status>
      </S.Shell>
      <S.Page>{children}</S.Page>
    </S.App>
  );
}

function Stage() {
  const [variant, setActiveVariant] = useState<string | null>(null);
  const [anchor, setActiveAnchor]   = useState<string | null>(null);
  const [density, setActiveDensity] = useState<string | null>(null);
  return (
    <AppShell>
      <ProfileCard />
      <Switcher
        choices={VARIANTS}
        active={variant}
        onPick={(id) => { setActiveVariant(id); setVariant(id); }}
      />
      <Switcher
        choices={ANCHORS}
        active={anchor}
        onPick={(id) => { setActiveAnchor(id); setDim('anchor', id); }}
      />
      <Switcher
        choices={DENSITIES}
        active={density}
        onPick={(id) => { setActiveDensity(id); setDim('density', id); }}
      />
    </AppShell>
  );
}

export default function App() {
  return (
    <ThemeProvider colors={COLORS} styles={STYLES}>
      <Stage />
    </ThemeProvider>
  );
}
