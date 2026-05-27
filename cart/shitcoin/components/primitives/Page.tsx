// Page — site viewport. Every site rendered inside the Browser composes
// itself in a <Page>: optional hero, then arbitrary children laid out in
// a vertical column with theme-aware spacing.

import { classifiers as C } from '../../../../runtime/classifier';
import './Page.cls';

export interface PageProps {
  heroTitle?: any;
  heroSubtitle?: any;
  /** Render a custom hero in place of the title/subtitle pair. */
  hero?: any;
  children?: any;
}

export function Page({ heroTitle, heroSubtitle, hero, children }: PageProps) {
  return (
    <C.PageRoot>
      <C.PageInner>
        {hero ? hero : null}
        {!hero && (heroTitle || heroSubtitle) ? (
          <C.PageHero>
            {heroTitle ? <C.PageHeroTitle>{heroTitle}</C.PageHeroTitle> : null}
            {heroSubtitle ? <C.PageHeroSubtitle>{heroSubtitle}</C.PageHeroSubtitle> : null}
          </C.PageHero>
        ) : null}
        {children}
      </C.PageInner>
    </C.PageRoot>
  );
}
