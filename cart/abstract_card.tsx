// abstract_card — three abstract blocks, two orthogonal dims, four layouts.
//
// The JSX [Corner, Thin, Thick] never moves. Picking different combinations
// of `anchor` + `lead` rearranges the visual stack without touching the tree.

import { useState } from 'react';
import { ThemeProvider, classifiers as C, setDim } from '../runtime/classifier';
import type { ThemeColors, StylePalette } from '../runtime/classifier';
import './abstract_card.cls';

// Colors picked to match the diagram in the request — flat, abstract, not
// project-semantic. Mapped onto the standard theme token names so the
// classifier sheet still references them through `theme:NAME`.
const COLORS: Partial<ThemeColors> = {
  bg: '#0b0b0e',
  surface: '#1d3b66',     // card fill
  border: '#aab9c6',      // card border
  bgElevated: '#0e3624',  // corner / thin fill
  accent: '#a85a18',      // corner / thin border
  bgAlt: '#3a3416',       // thick fill
  primary: '#d18a8a',     // thick border (pink)
  text: '#eef5ff',
  textDim: '#7d8ba1',
  borderFocus: '#facc15',
};

const STYLES: Partial<StylePalette> = { radiusSm: 4, radiusMd: 6 };

type Choice = { id: string | null; label: string };

const ANCHORS: ReadonlyArray<Choice> = [
  { id: 'left',  label: 'left' },
  { id: 'right', label: 'right' },
];

const LEADS: ReadonlyArray<Choice> = [
  { id: 'thin',  label: 'thin' },
  { id: 'thick', label: 'thick' },
];

function Switcher({
  choices, active, onPick,
}: {
  choices: ReadonlyArray<Choice>;
  active: string | null;
  onPick: (id: string | null) => void;
}) {
  return (
    <C.AC_Switcher>
      {choices.map((v) => {
        const isActive = v.id === active;
        const Btn = isActive ? C.AC_SwitchBtnActive : C.AC_SwitchBtn;
        const Txt = isActive ? C.AC_SwitchTextActive : C.AC_SwitchText;
        return (
          <Btn key={v.label} onPress={() => onPick(v.id)}>
            <Txt>{v.label}</Txt>
          </Btn>
        );
      })}
    </C.AC_Switcher>
  );
}

// This JSX never changes.
function Card() {
  return (
    <C.AC_Card>
      <C.AC_Corner />
      <C.AC_Thin />
      <C.AC_Thick />
    </C.AC_Card>
  );
}

function Stage() {
  const [anchor, setAnchor] = useState<string | null>('left');
  const [lead, setLead]     = useState<string | null>('thin');
  return (
    <C.AC_Stage>
      <Card />
      <C.AC_SwitcherRow>
        <C.AC_SwitcherLabel>ANCHOR</C.AC_SwitcherLabel>
        <Switcher
          choices={ANCHORS}
          active={anchor}
          onPick={(id) => { setAnchor(id); setDim('anchor', id); }}
        />
      </C.AC_SwitcherRow>
      <C.AC_SwitcherRow>
        <C.AC_SwitcherLabel>LEAD</C.AC_SwitcherLabel>
        <Switcher
          choices={LEADS}
          active={lead}
          onPick={(id) => { setLead(id); setDim('lead', id); }}
        />
      </C.AC_SwitcherRow>
    </C.AC_Stage>
  );
}

export default function App() {
  // Seed both dims so the first paint reflects the active button state.
  setDim('anchor', 'left');
  setDim('lead', 'thin');
  return (
    <ThemeProvider colors={COLORS} styles={STYLES}>
      <Stage />
    </ThemeProvider>
  );
}
