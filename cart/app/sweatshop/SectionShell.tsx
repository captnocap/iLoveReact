// Sweatshop section shell — the parent surface that hosts /sweatshop
// and its sub-sections (Canvas, Plan, Composer, …). Same pattern as
// settings/page.tsx: a shell-level section store + a HUD nav rail.
//
// Routes:
//   /sweatshop            → defaults to the canvas section
//   /sweatshop/canvas     → FlowEditor wiring surface (was /activity/sweatshop)
//   /sweatshop/plan       → planning surface (was /plan)
//   /sweatshop/composer   → composition editor (was /composer)
//
// Each sub-section is a full-bleed page with its own state. Switching
// sections unmounts/remounts (matches settings); sections that need
// to survive a switch own their state at module level.
//
// `SweatshopNav` is exported for the shell rail (cart/app/index.tsx
// renders it next to the assistant rail when path starts with
// /sweatshop), mirroring SettingsNav.

import { useEffect } from 'react';
import { Box } from '@reactjit/runtime/primitives';
import { useNavigate, useRoute } from '@reactjit/runtime/router';
import { classifiers as S } from '@reactjit/core';
import { setSweatshopSection, useSweatshopSection } from '../shell';
import CanvasPage from './page';
import PlanPage from '../plan/page';
import ComposerPage from '../composer/page';

type SectionId = 'canvas' | 'plan' | 'composer';

interface NavItem {
  id: SectionId;
  label: string;
  path: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'canvas',   label: 'Canvas',   path: '/sweatshop/canvas'   },
  { id: 'plan',     label: 'Plan',     path: '/sweatshop/plan'     },
  { id: 'composer', label: 'Composer', path: '/sweatshop/composer' },
];

function pathToSection(path: string): SectionId {
  if (path === '/sweatshop/plan')     return 'plan';
  if (path === '/sweatshop/composer') return 'composer';
  return 'canvas'; // /sweatshop and /sweatshop/canvas
}

export default function SweatshopSectionShell() {
  const route = useRoute();
  const [active] = useSweatshopSection();

  // Sync the shell store when a deep-link arrives.
  useEffect(() => {
    setSweatshopSection(pathToSection(route.path));
  }, [route.path]);

  return (
    <Box style={{
      flexGrow: 1,
      flexDirection: 'column',
      width: '100%', height: '100%', minWidth: 0,
      backgroundColor: 'theme:bg1',
    }}>
      {active === 'canvas'   ? <CanvasPage   /> : null}
      {active === 'plan'     ? <PlanPage     /> : null}
      {active === 'composer' ? <ComposerPage /> : null}
    </Box>
  );
}

export function SweatshopNav({ maxHeight }: { maxHeight?: number }) {
  const [active, setActive] = useSweatshopSection();
  const navigate = useNavigate();
  return (
    <Box style={{
      width: '100%',
      maxHeight,
      flexShrink: 0,
      overflow: 'hidden',
      flexDirection: 'column',
      borderBottomWidth: 1, borderBottomColor: 'theme:rule',
      backgroundColor: 'theme:bg',
      paddingTop: 16, paddingBottom: 12,
      paddingLeft: 12, paddingRight: 12,
      gap: 2,
    }}>
      <Box style={{ paddingLeft: 8, paddingRight: 8, paddingBottom: 12 }}>
        <S.Caption>App</S.Caption>
        <S.Title>Sweatshop</S.Title>
      </Box>
      {NAV_ITEMS.map((item) => {
        const isActive = item.id === active;
        const Pill = isActive ? S.NavPillActive : S.NavPill;
        const onPress = () => {
          setActive(item.id);
          navigate.push(item.path);
        };
        return (
          <Pill key={item.id} onPress={onPress}>
            <S.Body>{item.label}</S.Body>
          </Pill>
        );
      })}
    </Box>
  );
}
