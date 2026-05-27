// profile_variants — same JSX, five compositions.
//
// Click a variant; the global classifier variant flips and the card
// recomposes — slots get lifted out of flow, demoted to attribution,
// promoted to backdrop, or removed entirely. The JSX below never moves.

import { useState } from 'react';
import { ThemeProvider, classifiers as C, setVariant } from '../runtime/classifier';
import type { ThemeColors, StylePalette } from '../runtime/classifier';
import './profile_variants.cls';

const COLORS: Partial<ThemeColors> = {
  bg: '#0b1117',
  bgAlt: '#111a24',
  bgElevated: '#162231',
  surface: '#1a2533',
  surfaceHover: '#22314a',
  border: '#2a3a52',
  borderFocus: '#facc15',
  text: '#eef5ff',
  textSecondary: '#b6c4d7',
  textDim: '#7d8ba1',
  primary: '#8b5cf6',
  accent: '#facc15',
};

const STYLES: Partial<StylePalette> = {
  radiusSm: 4,
  radiusMd: 8,
  radiusLg: 14,
};

const PERSON = {
  initial: 'M',
  name: 'Mira Sato',
  title: 'SOUND DESIGNER · LICHTBLICK',
  bio: 'Builds generative instruments for live performance. Currently obsessed with granular synthesis of field recordings from underwater hydrophones in the Sea of Japan.',
  followers: '12.4k followers',
  works: '38 works',
};

const VARIANTS: Array<{ id: string | null; label: string }> = [
  { id: null,        label: 'stack' },
  { id: 'idcard',    label: 'idcard' },
  { id: 'magazine',  label: 'magazine' },
  { id: 'quote',     label: 'quote' },
  { id: 'trading',   label: 'trading' },
];

function ProfileCard() {
  // This block is IDENTICAL for every variant. Nothing here changes.
  return (
    <C.PC_Card>
      <C.PC_Avatar>
        <C.PC_Initial>{PERSON.initial}</C.PC_Initial>
      </C.PC_Avatar>
      <C.PC_Name>{PERSON.name}</C.PC_Name>
      <C.PC_Title>{PERSON.title}</C.PC_Title>
      <C.PC_Bio>{PERSON.bio}</C.PC_Bio>
      <C.PC_Stats>
        <C.PC_Stat>{PERSON.followers}</C.PC_Stat>
        <C.PC_Stat>{PERSON.works}</C.PC_Stat>
      </C.PC_Stats>
    </C.PC_Card>
  );
}

function Switcher({ active, onPick }: { active: string | null; onPick: (id: string | null) => void }) {
  return (
    <C.PC_Switcher>
      {VARIANTS.map((v) => {
        const isActive = v.id === active;
        const Btn = isActive ? C.PC_SwitchBtnActive : C.PC_SwitchBtn;
        const Txt = isActive ? C.PC_SwitchTextActive : C.PC_SwitchText;
        return (
          <Btn key={v.label} onPress={() => onPick(v.id)}>
            <Txt>{v.label}</Txt>
          </Btn>
        );
      })}
    </C.PC_Switcher>
  );
}

function Stage() {
  const [active, setActive] = useState<string | null>(null);
  return (
    <C.PC_Stage>
      <C.PC_CardSlot>
        <ProfileCard />
      </C.PC_CardSlot>
      <Switcher
        active={active}
        onPick={(id) => {
          setActive(id);
          setVariant(id);
        }}
      />
    </C.PC_Stage>
  );
}

export default function App() {
  return (
    <ThemeProvider colors={COLORS} styles={STYLES}>
      <Stage />
    </ThemeProvider>
  );
}
